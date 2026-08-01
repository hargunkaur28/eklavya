import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import PastPaper, { isFixtureTitle } from '../models/PastPaper.js';
import PyqQuestion, { questionBlocksPublication } from '../models/PyqQuestion.js';
import { parsePastPaper, PARSE_STAGES } from '../utils/parsePastPaper.js';
import { isPdfBuffer } from '../utils/pdfExtract.js';
import {
  cloudinaryConfigured, uploadPastPaperPdf, uploadPyqPageImage, uploadPyqFigure,
  pyqDiagramUrl, deletePyqAssets
} from '../utils/cloudinary.js';
import { sniffImageMime } from '../utils/imageSniff.js';
import { BOARDS, GRADES, SUBJECTS } from '../config/taxonomy.js';

// Workstream I2/I3 — the past-paper import pipeline.
//
// ── THIS IS THE ADMIN CONSOLE'S FIRST WRITE CAPABILITY ──────────────────────
//
// routes/admin.js is deliberately read-only and says so. This router adds writes,
// and they are scoped as narrowly as the guarantee allows:
//
//   • Every route is `requireRole('admin')`, so it is behind the same three-factor
//     admin login (email + password + security code) as the rest of the console.
//   • It writes ONLY to PastPaper and PyqQuestion — content models that did not
//     exist before this workstream. No route here can touch a User, a Roadmap, or
//     any student-owned document, so the read-only guarantee that matters (an admin
//     cannot alter a student's data) is untouched.
//   • Nothing it writes is student-visible until an explicit publish.
//
// ── AND IT IS THE ONLY PLACE ALLOWED TO MINT source: 'pyq' ──────────────────
// Enforced by CI (ci-invariants.mjs #11), not by convention. A question may claim to
// come from a real paper only if this pipeline read it from one.

const router = express.Router();

// 40MB: a 40-page scanned board paper at print resolution runs 15-25MB. Memory
// storage because the buffer goes straight to Cloudinary and to the parser — writing
// it to disk first would leave copies of uploads on the server for no reason.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 }
});

const handleUpload = (req, res, next) => upload.single('pdf')(req, res, (err) => {
  if (err) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'PDF_TOO_LARGE' : 'PDF_UPLOAD_FAILED';
    return res.status(400).json({ error: code });
  }
  next();
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Map ONE parsed question onto the document that gets stored.
 *
 * EXPORTED AND SEPARATE FROM THE HANDLER ON PURPOSE. This is an explicit field list
 * that reconstructs a document, which is the exact shape of a bug this codebase has
 * already paid for once: `canonicalizeSubtopics` omitted the Hindi and audio fields,
 * and because the lazy-migration path ran it over cached questions, one English quiz
 * fetch silently wiped a day's translations. CI invariant 8 exists for that.
 *
 * It happened again here. `choiceGroup` / `choiceIndex` were added to the schema and
 * to the parser, and this mapping — written earlier, inline in the handler — did not
 * carry them. Nothing failed: the import would have succeeded and quietly stored
 * every "OR" alternative as an independent question, which is precisely the
 * over-counting the choice modelling was added to prevent. The parse would have been
 * right and the database wrong.
 *
 * So it is a named function the CI invariant can drive with a fully-populated input,
 * and any field added to PyqQuestion and not carried here now fails the build by
 * name. Do not inline this back into the handler.
 */
export function toPyqDocument(q, { paper, board, year, pageAssets = {}, figureAssets = {} }) {
  const pageAsset = pageAssets[q.pageNumber];
  // The figure is its OWN uploaded asset, extracted from the PDF's embedded image
  // objects — not a crop of a page render. `figureIndex` is the only thing the model
  // decided, and it decided WHICH question a figure belongs to rather than where the
  // figure is, which is a far easier judgement and a far cheaper one to correct.
  const figureAsset = q.figureIndex ? figureAssets[q.figureIndex] : null;
  const diagramUrl = figureAsset?.url || '';

  return {
    // The ONE place in the codebase that writes this value.
    source: 'pyq',
    paperId: paper._id,
    board,
    year,
    sectionName: q.sectionName,
    sectionDiscipline: q.sectionDiscipline || '',
    questionNumber: q.questionNumber,
    marks: q.marks,
    questionText: q.questionText,
    options: q.options,
    correctIndex: q.correctIndex,
    correctAnswer: q.correctAnswer || '',
    explanation: '',
    // Internal choice — two alternatives of one question. Dropping these would store
    // each alternative as a separate question and inflate the paper.
    choiceGroup: q.choiceGroup || '',
    choiceIndex: q.choiceIndex || 0,
    // Sub-part linkage. Dropping these would store every part as its own question
    // and re-inflate the counts and marks this model exists to reconcile.
    parentKey: q.parentKey || '',
    isContainer: q.isContainer === true,
    partLabel: q.partLabel || '',
    partsAmbiguous: q.partsAmbiguous === true,
    partsRelation: q.partsRelation || 'all-required',
    partsRelationEvidence: q.partsRelationEvidence || '',
    figureExpected: q.figureExpected,
    diagramUrl,
    diagramPublicId: figureAsset?.publicId || '',
    // The page this question came from, so the review UI can show the source page
    // and an admin can attach a figure the parse missed.
    sourcePageUrl: pageAsset?.url || '',
    // diagramAlt is deliberately EMPTY. It is admin-entered, never AI-generated:
    // read-aloud depends on it, and a confidently wrong description of a real exam
    // figure is worse than none. The review UI asks for it and publish blocks on it.
    diagramAlt: '',
    diagramAltHindi: '',
    diagramSvg: '',
    hindiTranslated: false,
    translatedHindiQuestionText: '',
    translatedHindiOptions: [],
    translatedHindiExplanation: ''
  };
}

// A paper is only meaningful for a board grade. Class 10 and 12 are the grades with
// board exams; importing a "past paper" for Class 7 would create exactly the artefact
// I0 forbids, since no such paper exists to have been sat.
export const BOARD_EXAM_GRADES = ['Class 10', 'Class 12'];

/**
 * POST /api/pyq-admin/papers — upload a PDF and parse it into a DRAFT.
 *
 * Synchronous by design. Import is a deliberate admin action on one paper, the admin
 * is watching, and a background job would need a status-polling surface plus a way to
 * surface per-page parse failures that the admin can already see here. It is slow
 * (one vision call per page) and that is acceptable for a few dozen lifetime calls.
 */
router.post('/papers', authMiddleware, requireRole('admin'), handleUpload, async (req, res) => {
  if (!cloudinaryConfigured) {
    return res.status(503).json({ error: 'STORAGE_NOT_CONFIGURED' });
  }
  if (!req.file?.buffer) return res.status(400).json({ error: 'PDF_REQUIRED' });

  // Magic bytes, not the declared Content-Type — the same reasoning as the image
  // upload paths: the declared type is a claim by the uploader.
  if (!isPdfBuffer(req.file.buffer)) return res.status(400).json({ error: 'PDF_INVALID_MAGIC_BYTES' });

  const board = str(req.body.board);
  const grade = str(req.body.grade);
  const subject = str(req.body.subject);
  const title = str(req.body.title);
  const year = Number(req.body.year);

  if (!BOARDS.includes(board)) return res.status(400).json({ error: 'BOARD_NOT_SUPPORTED' });
  if (!GRADES.includes(grade)) return res.status(400).json({ error: 'GRADE_INVALID' });
  if (!BOARD_EXAM_GRADES.includes(grade)) return res.status(400).json({ error: 'GRADE_HAS_NO_BOARD_EXAM' });
  if (!SUBJECTS.includes(subject)) return res.status(400).json({ error: 'SUBJECT_INVALID' });
  if (!title) return res.status(400).json({ error: 'TITLE_REQUIRED' });
  // Upper bound is next calendar year: a paper "from" a year that has not happened
  // is a typo, and it would surface to students as a year filter nobody can satisfy.
  if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
    return res.status(400).json({ error: 'YEAR_INVALID' });
  }

  let paper;
  try {
    paper = await PastPaper.create({
      board, grade, subject, year, title, parseStatus: 'parsing', uploadedBy: 'admin'
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'PAPER_ALREADY_EXISTS' });
    console.error('PastPaper create failed:', err.message);
    return res.status(500).json({ error: 'PAPER_CREATE_FAILED' });
  }

  try {
    // 1. Keep the original FIRST, before anything can go wrong in the parse. A parse
    //    failure must still leave a re-parseable paper rather than forcing a re-find
    //    and re-upload of a document that may be hard to obtain again.
    const pdfAsset = await uploadPastPaperPdf(req.file.buffer, paper._id);

    // 2. Extract + parse.
    const parsed = await parsePastPaper(req.file.buffer);

    // 3. Store one image per page. These are the crop surfaces for every figure, so
    //    they are uploaded even for pages with no detected figure — a figure the
    //    parse MISSED is one the admin will crop by hand, and they need the page.
    const pageAssets = {};
    for (const page of parsed.pages) {
      const asset = await uploadPyqPageImage(page.png, paper._id, page.pageNumber);
      pageAssets[page.pageNumber] = { ...asset, width: page.width, height: page.height };
    }

    // 4. Store each extracted FIGURE as its own asset.
    const figureAssets = {};
    for (const fig of parsed.figures || []) {
      figureAssets[fig.figureIndex] = await uploadPyqFigure(fig.png, paper._id, fig.figureIndex);
    }

    // 5. Persist the draft questions.
    const docs = parsed.questions.map((q) => toPyqDocument(q, { paper, board, year, pageAssets, figureAssets }));

    await PyqQuestion.insertMany(docs);

    paper.sourcePdfUrl = pdfAsset.url || '';
    paper.sourcePdfPublicId = pdfAsset.publicId || '';
    paper.pageCount = parsed.pageCount;
    paper.sections = parsed.sections;
    paper.durationMinutes = parsed.durationMinutes;
    paper.totalMarks = parsed.totalMarks;
    paper.parsedByFallback = parsed.usedFallback;
    paper.parsedWithModel = parsed.parsedWithModel;
    // Per-page text-layer verdicts, so the review UI can point at the pages whose
    // wording came from the image rather than the (untrustworthy) text layer.
    paper.pageTrust = parsed.pageTrust || [];
    paper.parseStatus = 'draft';
    await paper.save();

    res.status(201).json({
      paper: paper.toObject(),
      questionCount: docs.length,
      failedPages: parsed.failedPages,
      truncated: parsed.truncated,
      // Surfaced so the review UI can warn LOUDLY rather than the admin discovering
      // the weaker substrate from a pattern of bad rows.
      parsedByFallback: parsed.usedFallback
    });
  } catch (err) {
    // Record the named stage on the document, so the admin sees WHICH stage died
    // instead of a blank screen, and so a retry has somewhere to start from.
    const stage = String(err.message || '').split(':')[0] || PARSE_STAGES.MODEL_CALL;
    paper.parseStatus = 'failed';
    paper.parseError = stage;
    await paper.save().catch(() => {});
    console.error(`PYQ import failed [${stage}] for paper ${paper._id}:`, err.message);
    res.status(500).json({ error: stage, paperId: paper._id });
  }
});

/** GET /api/pyq-admin/papers — every paper, newest first, for the console list. */
router.get('/papers', authMiddleware, requireRole('admin'), async (req, res) => {
  const papers = await PastPaper.find().sort({ createdAt: -1 }).lean();
  const counts = await PyqQuestion.aggregate([
    { $match: { paperId: { $in: papers.map((p) => p._id) } } },
    { $group: { _id: '$paperId', n: { $sum: 1 } } }
  ]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({ papers: papers.map((p) => ({ ...p, questionCount: byId[String(p._id)] || 0 })) });
});

/** GET /api/pyq-admin/papers/:id — the paper plus every parsed question, for review. */
router.get('/papers/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  const paper = await PastPaper.findById(req.params.id).lean();
  if (!paper) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });

  const questions = await PyqQuestion.find({ paperId: paper._id }).sort({ sectionName: 1, _id: 1 }).lean();
  res.json({
    paper,
    questions,
    // Computed here rather than in the client so the publish route and the review UI
    // cannot disagree about what is blocking.
    blockers: questions.filter(questionBlocksPublication).map((q) => ({
      _id: q._id, questionNumber: q.questionNumber, reason: 'FIGURE_MISSING'
    }))
  });
});

/**
 * PATCH /api/pyq-admin/questions/:id — the admin's correction surface.
 *
 * The review step is not optional and this is what makes it real: layout varies,
 * multi-column pages break, marks land in margins, and automatic figure-region
 * detection will get some wrong. Everything the parse guessed is editable here.
 */
router.patch('/questions/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
  const q = await PyqQuestion.findById(req.params.id);
  if (!q) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });

  const b = req.body || {};
  if (typeof b.questionText === 'string') q.questionText = b.questionText.trim();
  if (typeof b.sectionName === 'string') q.sectionName = b.sectionName.trim();
  if (typeof b.questionNumber === 'string') q.questionNumber = b.questionNumber.trim();
  if (Number.isFinite(Number(b.marks))) q.marks = Number(b.marks);
  if (Array.isArray(b.options)) q.options = b.options.filter((o) => typeof o === 'string');
  if (b.correctIndex === null || Number.isInteger(b.correctIndex)) q.correctIndex = b.correctIndex;
  if (typeof b.correctAnswer === 'string') q.correctAnswer = b.correctAnswer.trim();
  if (typeof b.explanation === 'string') q.explanation = b.explanation.trim();
  if (typeof b.figureExpected === 'boolean') q.figureExpected = b.figureExpected;

  // Admin-entered alt text. Never generated — see the model.
  if (typeof b.diagramAlt === 'string') q.diagramAlt = b.diagramAlt.trim();
  if (typeof b.diagramAltHindi === 'string') q.diagramAltHindi = b.diagramAltHindi.trim();

  // Detach a figure attached to the wrong question. There is no re-crop here any
  // more: figures come out of the PDF's own image objects with exact bounds, so a
  // figure is either right, or on the wrong question, or absent — and all three are
  // handled by detaching and pasting the correct one (POST .../figure).
  if (b.clearFigure === true) {
    q.diagramUrl = '';
    q.diagramPublicId = '';
  }

  // Hindi is invalidated by an English edit rather than left stale: a corrected
  // question with its old translation is a Hindi student reading the uncorrected
  // version. Re-translation is lazy, on next fetch.
  if (typeof b.questionText === 'string' || Array.isArray(b.options)) {
    q.hindiTranslated = false;
    q.translatedHindiQuestionText = '';
    q.translatedHindiOptions = [];
  }

  try {
    await q.save();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ question: q.toObject() });
});

/**
 * POST /api/pyq-admin/questions/:id/figure — attach or replace a figure by upload.
 *
 * THE CORRECTION AFFORDANCE, and deliberately not a crop editor. Embedded extraction
 * gets the figure itself exactly right, so the only thing left to go wrong is WHICH
 * QUESTION it was attached to, or a figure the PDF did not embed as an image at all
 * (drawn with vector operators, or a scan). Both are fixed the same cheap way: the
 * admin snips the region with the OS screenshot tool and pastes it here.
 *
 * Roughly 11 figures a paper, seconds each, against building and maintaining a
 * drag-resize crop UI — and the auto-attached figure stays the default, so a correct
 * one needs no action at all and paste only replaces the wrong ones.
 *
 * Validation is the SAME path My Notes uses: memory storage, a 5MB cap, and a
 * magic-byte sniff (the extension and the Content-Type are both spoofable), with the
 * re-encode on upload stripping metadata. No second upload path.
 */
const figureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

router.post('/questions/:id/figure', authMiddleware, requireRole('admin'), (req, res) => {
  figureUpload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        return res.status(400).json({
          error: uploadErr.code === 'LIMIT_FILE_SIZE' ? 'FIGURE_TOO_LARGE' : 'FIGURE_INVALID',
          limitMb: 5
        });
      }
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
      const q = await PyqQuestion.findById(req.params.id);
      if (!q) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'FIGURE_MISSING' });

      const mime = sniffImageMime(req.file.buffer);
      if (!mime) return res.status(400).json({ error: 'FIGURE_TYPE_UNSUPPORTED' });
      if (!cloudinaryConfigured) return res.status(503).json({ error: 'STORAGE_NOT_CONFIGURED' });

      // Keyed by question id, not figure index: this is a manual replacement and must
      // never overwrite an extracted figure that another question still points at.
      const asset = await uploadPyqFigure(req.file.buffer, q.paperId, `manual-${q._id}`);
      if (!asset?.url) return res.status(502).json({ error: 'FIGURE_UPLOAD_FAILED' });

      q.diagramUrl = asset.url;
      q.diagramPublicId = asset.publicId;
      await q.save();
      res.json({ question: q.toObject() });
    } catch (error) {
      console.error('PYQ figure upload error:', error.message);
      res.status(500).json({ error: 'FIGURE_UPLOAD_FAILED' });
    }
  });
});

/** DELETE /api/pyq-admin/questions/:id — drop a row the parser invented. */
router.delete('/questions/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
  const q = await PyqQuestion.findById(req.params.id);
  if (!q) return res.status(404).json({ error: 'QUESTION_NOT_FOUND' });
  const paper = await PastPaper.findById(q.paperId);
  if (paper?.parseStatus === 'published') return res.status(409).json({ error: 'PAPER_ALREADY_PUBLISHED' });
  await q.deleteOne();
  res.json({ deleted: true });
});

/**
 * POST /api/pyq-admin/papers/:id/publish — make the paper student-visible.
 *
 * ── MISSING FIGURES AND MISSING ALT TEXT WARN, THEY NO LONGER BLOCK ────────
 *
 * Changed deliberately, at the operator's request, from the hard gate the I3 rule
 * originally specified. Recorded here rather than quietly swapped, because the
 * reasoning that produced the gate has not stopped being true:
 *
 *   • A question whose text says "in the figure below" and has no figure is
 *     UNANSWERABLE. Unlike a generated question it cannot be repaired by dropping
 *     the reference, because the reference is what the real paper said.
 *   • A figure with no alt text is skipped by read-aloud, so a student relying on
 *     narration loses that question entirely.
 *
 * What justifies the change is that a hard gate on a 40-question paper stops the
 * whole import over one row, and a corpus nobody can publish is worth less than a
 * corpus with a few known-imperfect questions in it. The protection that remains is
 * that publishing past these is EXPLICIT and RECORDED: the first attempt returns the
 * warnings and refuses, the client shows them, and only a confirmed second attempt
 * publishes — then stamps the paper with what was overridden so it can be found and
 * fixed later. Nothing is silent, and nothing is unattributable.
 *
 * `PAPER_HAS_NO_QUESTIONS` and `PAPER_STILL_PARSING` remain HARD blocks. They are not
 * quality judgements — there is simply nothing to publish.
 */
router.post('/papers/:id/publish', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  const paper = await PastPaper.findById(req.params.id);
  if (!paper) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  if (paper.parseStatus === 'parsing') return res.status(409).json({ error: 'PAPER_STILL_PARSING' });

  // A HARD block, unlike the figure/alt-text warnings below, and not confirmable
  // past. Those two are quality judgements an operator is entitled to override; this
  // is a paper explicitly labelled as a throwaway, and there is no circumstance in
  // which a student should reach one. If a paper genuinely belongs in the corpus,
  // the fix is to give it a real title, not to click through a warning.
  if (isFixtureTitle(paper.title)) {
    return res.status(409).json({
      error: 'FIXTURE_PAPER_CANNOT_BE_PUBLISHED',
      detail: 'This paper is titled as a test fixture. Rename it if it is real content.'
    });
  }

  const questions = await PyqQuestion.find({ paperId: paper._id }).lean();
  if (!questions.length) return res.status(409).json({ error: 'PAPER_HAS_NO_QUESTIONS' });

  const missingFigures = questions.filter(questionBlocksPublication);
  const missingAlt = questions.filter((q) => q.diagramUrl && !q.diagramAlt);

  const warnings = [];
  if (missingFigures.length) {
    warnings.push({
      code: 'QUESTIONS_MISSING_FIGURES',
      severity: 'high',
      message: `${missingFigures.length} question(s) refer to a figure that is not attached. A student will see "in the figure below" with no figure, which cannot be answered.`,
      questionNumbers: missingFigures.map((q) => q.questionNumber)
    });
  }
  if (missingAlt.length) {
    warnings.push({
      code: 'FIGURES_WITHOUT_ALT_TEXT',
      severity: 'medium',
      message: `${missingAlt.length} figure(s) have no alt text. Read-aloud will skip them, so a student using narration loses those questions.`,
      questionNumbers: missingAlt.map((q) => q.questionNumber)
    });
  }

  // First attempt with outstanding warnings: report and stop, so the client can put
  // them in front of the admin. This is the "pop-up", not a refusal — a confirmed
  // retry goes through.
  if (warnings.length && req.body?.confirm !== true) {
    return res.status(409).json({
      error: 'PUBLISH_NEEDS_CONFIRMATION',
      requiresConfirmation: true,
      warnings
    });
  }

  paper.parseStatus = 'published';
  paper.publishedAt = new Date();
  // Stamped so an imperfect paper is FINDABLE later rather than becoming invisible
  // debt. Cleared when a subsequent publish has nothing outstanding.
  paper.publishedWithWarnings = warnings.map((w) => ({
    code: w.code,
    questionNumbers: w.questionNumbers,
    acknowledgedAt: new Date()
  }));
  await paper.save();

  res.json({ paper: paper.toObject(), publishedWithWarnings: warnings });
});

/** POST /api/pyq-admin/papers/:id/unpublish — withdraw a paper from students. */
router.post('/papers/:id/unpublish', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  const paper = await PastPaper.findByIdAndUpdate(
    req.params.id, { parseStatus: 'draft', publishedAt: null }, { new: true }
  );
  if (!paper) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  res.json({ paper: paper.toObject() });
});

/** DELETE /api/pyq-admin/papers/:id — remove a paper, its questions and its assets. */
router.delete('/papers/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });
  const paper = await PastPaper.findById(req.params.id);
  if (!paper) return res.status(404).json({ error: 'PAPER_NOT_FOUND' });

  await PyqQuestion.deleteMany({ paperId: paper._id });
  await deletePyqAssets(paper._id);
  await paper.deleteOne();
  res.json({ deleted: true });
});

export default router;
