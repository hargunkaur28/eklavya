// Workstream I — parse an uploaded exam PDF into a structured draft.
//
// Produces a DRAFT. Nothing this file returns is ever visible to a student: the
// admin reviews and corrects it first (routes/pyqAdmin.js), and only an approved
// paper becomes queryable. That is not a nicety — automatic parsing of exam PDFs is
// unreliable in ways that are invisible from the output alone, and the review step
// is the thing that makes the corpus trustworthy.

import { callOpenAIChat, callGroqChat } from './groqClient.js';
import { extractPdfPages, pageImageDataUri, extractEmbeddedFigures, RENDER_SCALE } from './pdfExtract.js';
import { countQuestionUnits, availableMarks } from '../models/PyqQuestion.js';
import { resolveSubSubjectAlias } from '../config/taxonomy.js';

// ── THIS PATH DELIBERATELY PREFERS OPENAI. DO NOT "HARMONISE" IT. ───────────
//
// The app-wide chain is Groq first, OpenAI as a last-resort fallback. Two paths
// already invert that — DIAGRAM_MODEL (utils/generateDiagram.js) and JUDGE_MODEL
// (utils/diagnosticEngine.js) — and this is the third, for the same reasons and with
// the same protections. It is also the strongest case of the three:
//
//   - PRECISION MATTERS MORE HERE THAN ANYWHERE ELSE IN THIS APP. A misparsed
//     question, a wrong marks value, or a question filed under the wrong section
//     corrupts a student's model of what their actual board exam looks like — the
//     one thing past papers exist to convey. Unlike a roadmap lesson there is a
//     single correct answer, and it is checkable against the PDF.
//
//   - VOLUME IS LOW. Import is a one-off ADMIN action per paper, not a per-student
//     runtime cost. A few dozen papers over the life of the deployment, against a
//     per-student-per-session cost everywhere else. There is no scaling argument for
//     saving money here.
//
//   - GROQ IS RATE-LIMITED AND DEGRADES TO 8b UNDER LOAD. That is the substrate that
//     produced label-only diagrams (four labels stacked in an empty oval) and
//     off-subject questions. Parsing an exam paper on it would produce a corpus that
//     looks authoritative and is quietly wrong — and unlike a bad quiz question, a
//     bad PYQ is CACHED AS GROUND TRUTH and reviewed by an admin who is trusting the
//     parse. The failure compounds instead of passing.
//
// gpt-4o rather than a cheaper tier because this path needs VISION (see below) and
// because the whole point is accuracy on a document that will be trusted afterwards.
export const PYQ_MODEL = 'gpt-4o';

// Per-page cap. A dense exam page with 20 MCQs and their options is a lot of JSON,
// and truncation surfaces as a JSON parse error that misattributes the cause —
// exactly the failure that made DIAGRAM_MODEL's cap 8000 instead of 4000.
//
// Raised 8000 -> 12000 after a MEASURED truncation: page 11 of the CBSE Class 10
// Science SQP died with "Unterminated string in JSON at position 16256". Unlike the
// diagram case — where truncation turned out to be a degenerate runaway and raising
// the cap treated the symptom — this is a genuinely dense page: verbatim
// transcription of a full page of physics questions with options and assertion-
// reason stems. The named drop stage is what made the difference diagnosable, and it
// stays, so a future runaway is still distinguishable from a big page.
//
// CEILING: gpt-4o accepts at most 16384 completion tokens and returns a hard 400
// above that ("max_tokens is too large") — verified directly, not assumed. A 400 is
// NOT retried and returns null, which silently degrades the whole paper to the
// text-only fallback, so raising this past 16384 would look like a rate-limit
// problem and be a configuration one.
const PARSE_MAX_TOKENS = 12000;

// ── Named drop stages ───────────────────────────────────────────────────────
// Same instrumentation as the diagram pipeline. A failed import must say WHICH
// stage failed, because "parse failed" in front of an admin holding a 40-page PDF is
// not actionable.
export const PARSE_STAGES = {
  EXTRACT: 'PDF_EXTRACTION_FAILED',
  MODEL_CALL: 'PARSE_MODEL_CALL_FAILED',
  MODEL_JSON: 'PARSE_MODEL_RETURNED_INVALID_JSON',
  NO_QUESTIONS: 'PARSE_FOUND_NO_QUESTIONS',
  STRUCTURE: 'PARSE_STRUCTURE_INVALID'
};

const SYSTEM_PROMPT = `You transcribe Indian board examination papers (CBSE, HBSE) into structured JSON.

You are given ONE page of a paper, twice: as an IMAGE of the rendered page, and as the raw TEXT layer extracted from the PDF.

USE EACH FOR WHAT IT IS GOOD AT:
- Use the IMAGE for STRUCTURE: which section a question belongs to, the reading order across columns, where a marks annotation in the margin attaches, and whether a figure belongs to this question or the next one.
- Use the TEXT for the EXACT WORDING of every question and option — BUT ONLY WHERE THE TEXT AGREES WITH THE IMAGE. Where it agrees, copy it verbatim: do NOT paraphrase, do NOT fix what looks like a typo, do NOT normalise notation or units. The wording is the artefact.

- THE TEXT LAYER IS NOT ALWAYS TRUSTWORTHY, and judging that is the single most important thing you do on each page. A PDF can carry text that does not match what is printed, because the font is legacy-encoded or subsetted without a usable character map. It is not always obviously broken — it can look like plausible words.
  So FIRST compare the supplied text against what you can read in the image.
  - If they agree: use the text for wording, as above.
  - If they DISAGREE — wrong letters, mojibake, superscripts or subscripts that are clearly printed but absent from the text, scrambled or split Devanagari conjuncts, or text that simply says something else — then THE IMAGE WINS. Transcribe from the image and set "transcribedFromImage": true on every question you transcribed that way.
  Two real examples from this corpus, and they are the SAME underlying failure — printed glyphs that do not survive extraction: a Hindi paper whose text layer gave "णनम्नणिखिर्" for a page plainly printing "निम्नलिखित"; and a Maths paper where a printed "ax² + bx + c" arrived as "ax2 + bx +c" with the superscript flattened, in the very same paper where "cos²A" survived intact.
- Report ONCE PER PAGE: "textLayerTrust": "trusted" if the supplied text matched the page, or "untrusted" if you had to transcribe from the image because it did not.

RULES:
- Report ONLY what is on this page. Never invent a question, an option, an answer or a mark value. If a question starts on this page and continues onto the next, report what is here and set "continues": true.
- questionNumber is the number AS PRINTED: "14", "14(a)", "31 OR". Never renumber.
- marks: the mark value for that question as printed. Use 0 if it is not shown on this page.
- options: only for multiple-choice questions. Otherwise an empty array.
- correctIndex: ONLY if the paper itself prints an answer key. Otherwise null. Do NOT solve the question.
- figureExpected: true when the question TEXT refers to a figure ("in the given figure", "from the circuit shown", "in the diagram below"). This is about the wording, not about whether you can see a picture.
- discipline: some papers are ONE paper split by SUBJECT AREA rather than by question type — e.g. "Section A is Biology, Section B is Chemistry and Section C is Physics", or "A-History, B-Geography, C-Political Science, D-Economics". That mapping is usually stated once in the General Instructions, not repeated in the section heading. When a section covers a named subject area, put that area in "discipline" (e.g. "Biology", "Political Science"). Leave it "" for a paper split by question type (Very Short Answer, Long Answer, Case Study), which is the common case.
- figureIndex: figures on this page have ALREADY been extracted for you and are listed under PAGE FIGURES with a number and their position down the page. If a question uses one, set figureIndex to that figure's number. If it uses none, set it to null. You are only deciding WHICH QUESTION EACH FIGURE BELONGS TO — do not describe the figure and do not attempt to locate it.

WHAT IS *NOT* A NEW QUESTION — this is the most common way this task is done wrong:
- SUB-PARTS. "(a) ... (b) ...", "(i) ... (ii) ...", "(I) ... (II) ...", "17A ... 17B", or a passage followed by parts numbered I, II, III are PARTS OF ONE QUESTION that the student answers ALL of. Emit the introducing text (the stimulus, e.g. "Read the following passage: ...") as ONE entry with "isContainer": true, and each part as its own entry with "partOf" set to the parent's questionNumber and "partLabel" set to the part's printed label. Give the container the total marks printed against it and each part its own printed marks.

  MARKS OF THE PARTS. Papers often print the split next to the parent, as "(1+2+1=4)" or "(1+1+2=4)". When that split is printed, assign those numbers to the parts IN ORDER, and the parts must sum to the parent's total. If no split is printed, read each part's own marks. Do NOT give every part 1 mark by default — a case study whose parts read 1,1,1 against a printed total of 4 has lost a mark, and a lost mark is invisible to the student until the paper does not add up.

- INTERNAL CHOICE ("OR"). A question printed as "31. <text> OR <other text>" is ONE question offering two alternatives, and the student attempts only ONE. Emit it as TWO entries that share the SAME questionNumber, with "choiceIndex": 0 for the text before the OR and "choiceIndex": 1 for the text after it. Do NOT invent a new questionNumber for the second alternative.

- ***DISTINGUISHING A CHOICE FROM SUB-PARTS IS THE MOST IMPORTANT JUDGEMENT ON THE PAGE.*** They look alike — both put several bodies of text under one printed number — and getting it backwards tells a student to attempt one part of a compulsory question, which is a wrong instruction on a real paper.

  DO NOT ask "is there an OR nearby". An OR token belongs to a specific question, and the same page can hold a question whose parts are all required AND, further down, a different question offering a choice. Proximity cannot tell those apart.

  Instead, for EVERY question that has more than one body of text under one number, report a "partsRelation" describing how the parts relate, and QUOTE THE PRINTED WORDS that decided it in "partsRelationEvidence".

  "partsRelation" is exactly one of:
    "all-required"  — the student answers EVERY part. Evidence: nothing separates the parts, or an instruction says "answer all"/"all questions are compulsory". Marks of the parts typically ADD UP to the number printed against the parent.
    "choose-one"    — the student answers ONE. Evidence: a separator is PRINTED BETWEEN THESE PARTICULAR PARTS — "OR", "Or", "अथवा" on its own line between them — or wording like "attempt either", "attempt any one of the following". Alternatives are usually worth the SAME marks as each other, and that total is what the parent is worth.
    "unclear"       — you cannot point to printed evidence either way.

  SCOPE — which question an OR belongs to:
    An OR belongs to the question whose number PRECEDES it, and it separates the text immediately before it from the text immediately after it. If a new question number appears between the OR and a body of text, that OR does NOT reach past the number — it belonged to the earlier question.
    So: "17A ... 17B ... 18. ... OR ... 19." means 18 has the choice, NOT 17.
    A question may have required parts AND a later question may have a choice; these are independent and each gets its own "partsRelation".
    If a question has required parts and an OR appears INSIDE it (e.g. parts A and B are both required but B itself offers two alternatives), report the OUTER family as "all-required" and put the choice on the inner parts.
    IF YOU CANNOT TELL WHICH QUESTION AN OR BELONGS TO, that is "unclear".

  "unclear" IS A NORMAL AND EXPECTED ANSWER. It is not a failure, it carries no penalty, and a human reviews every paper anyway. On a densely laid-out page you should expect to use it several times. Choosing "choose-one" without being able to quote a printed separator is WORSE than saying "unclear", because it puts a wrong rubric on a real exam question. When in doubt, say "unclear".

  Labels prove nothing. "(I)/(II)", "A/B", "(i)/(ii)" appear as required parts in some papers and as alternatives in others. Never infer the relation from the label.
- CONTINUATIONS. If a question began on an earlier page and this page holds the rest of it, do NOT emit it again. Set "continuesPrevious": true on the first entry and give only the text that appears on THIS page; it will be appended to the question already recorded.

Return ONLY valid JSON:
{
  "pageSections": [{"name": "Section A", "instruction": "text of the instruction line, or empty", "discipline": ""}],
  "paperMeta": {"durationMinutes": 0, "totalMarks": 0},
  "textLayerTrust": "trusted",
  "questions": [{
    "questionNumber": "1",
    "sectionName": "Section A",
    "marks": 1,
    "questionText": "verbatim text",
    "options": [],
    "correctIndex": null,
    "choiceIndex": 0,
    "isContainer": false,
    "partOf": "",
    "partLabel": "",
    "partsRelation": "",
    "partsRelationEvidence": "",
    "figureExpected": false,
    "figureIndex": null,
    "continuesPrevious": false,
    "continues": false,
    "transcribedFromImage": false
  }]
}
paperMeta values are 0 unless this page actually prints them (usually only page 1). No markdown, raw JSON only.`;

/**
 * Parse ONE page. Returns { data, usedFallback } — never throws for a model problem,
 * because one unparseable page in a 40-page paper must not discard the other 39. The
 * caller records the failure per page and the admin sees exactly which page is empty.
 */
async function parsePage(page, context = {}) {
  // ── ANCHORING ───────────────────────────────────────────────────────────
  // Each page used to be parsed in isolation, which meant section assignment was
  // RE-GUESSED from scratch on every page. Measured on the real CBSE Class 10
  // Science paper that produced 27/8/3 against a true 16/13/10: a page in the middle
  // of the Chemistry section has no local evidence that it is Chemistry, because the
  // heading is ten pages back.
  //
  // So the paper's own declared structure — read once from page 1, where it is
  // printed verbatim — travels with every subsequent page, along with where the
  // numbering has reached. This is not the model's opinion being fed back to it; it
  // is the paper's own General Instructions used as the constraint they are.
  const anchor = [];
  if (context.declaredStructure) anchor.push(`THE PAPER'S OWN GENERAL INSTRUCTIONS (from page 1, treat as authoritative):\n${context.declaredStructure}`);
  if (context.sectionNames?.length) anchor.push(`Sections in this paper, in order: ${context.sectionNames.join(' | ')}. Assign every question to one of these EXACT names — do not invent a new section name.`);
  if (context.lastQuestionNumber) {
    anchor.push(`The last question recorded before this page was "${context.lastQuestionNumber}". Numbering continues from there — a number you have already seen means a continuation or an OR alternative, not a new question.`);
  }
  if (context.currentSection) anchor.push(`The section in progress at the end of the previous page was "${context.currentSection}". It continues onto this page unless a new section heading appears.`);

  // The figures are already extracted, exactly, from the PDF's own image objects.
  // All that is left is an assignment: which question does each belong to. That is a
  // judgement about reading order and wording ("in the given circuit"), which a
  // vision model does well — unlike guessing a pixel bounding box, which it did not.
  if (context.pageFigures?.length) {
    const lines = context.pageFigures.map((f) => {
      const pct = Math.round((f.bbox[1] / (context.pageHeightPts || 842)) * 100);
      return `  figure ${f.figureIndex}: ${f.width}x${f.height}px, about ${pct}% of the way down the page`;
    });
    anchor.push(`PAGE FIGURES — ${context.pageFigures.length} figure(s) already extracted from this page, in reading order:\n${lines.join('\n')}\nAssign each to the question that uses it via figureIndex.`);
  } else {
    anchor.push('PAGE FIGURES: none on this page. Set figureIndex to null for every question.');
  }

  const userContent = [
    {
      type: 'text',
      text: `Page ${page.pageNumber}. Rendered image is ${page.width}x${page.height} pixels — express every figureBox in that coordinate space.${anchor.length ? `\n\n--- PAPER CONTEXT ---\n${anchor.join('\n')}` : ''}\n\n--- EXTRACTED TEXT LAYER ---\n${page.text || '(empty — transcribe from the image)'}`
    },
    {
      type: 'image_url',
      // `detail: high` is the point of using vision at all here. On `auto` a dense
      // A4 exam page is downsampled to the point where subscripts, degree signs and
      // marks in the margin stop being legible — which is precisely the information
      // the text layer already failed to place correctly.
      image_url: { url: pageImageDataUri(page.png), detail: 'high' }
    }
  ];

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ];

  // OPENAI FIRST — see PYQ_MODEL above for why this path inverts the app-wide chain.
  // temperature 0: this is transcription, and there is nothing to be creative about.
  let raw = null;
  let usedFallback = false;
  try {
    raw = await callOpenAIChat(messages, {
      model: PYQ_MODEL, temperature: 0, jsonMode: true, maxTokens: PARSE_MAX_TOKENS,
      // Retry before degrading. Falling back here does not cost a worse figure, it
      // costs a whole paper parsed on a text-only path and then cached as ground
      // truth — so a transient 429 must not be allowed to decide that. Import is a
      // background admin action, so spending up to ~30s of backoff to stay on the
      // vision path is trivially the right trade.
      retries: 3, retryDelayMs: 3000
    });
  } catch (err) {
    console.warn(`PYQ parse [${PARSE_STAGES.MODEL_CALL}] page ${page.pageNumber}:`, err.message);
  }

  // ── Groq fallback: AVAILABILITY ONLY, and strictly weaker ─────────────────
  // It is TEXT-ONLY. The shared Groq client's chain is a text chain, and the whole
  // reason vision is used here is that the text layer misplaces structure — so this
  // fallback is missing the exact capability the primary path was chosen for. It
  // exists so an OpenAI outage yields a rough draft the admin can fix rather than no
  // import at all, and every paper that goes through it is FLAGGED
  // (PastPaper.parsedByFallback) so the review UI can tell the admin to check it
  // harder. It is not a substitute and must never be promoted to the primary.
  if (!raw) {
    usedFallback = true;
    try {
      raw = await callGroqChat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Page ${page.pageNumber}. NO IMAGE IS AVAILABLE — work from the text layer alone and set figureBox to null everywhere.${anchor.length ? `\n\n--- PAPER CONTEXT ---\n${anchor.join('\n')}` : ''}\n\n--- EXTRACTED TEXT LAYER ---\n${page.text}` }
        ],
        { jsonMode: true, temperature: 0, maxTokens: PARSE_MAX_TOKENS }
      );
    } catch (err) {
      console.warn(`PYQ parse [${PARSE_STAGES.MODEL_CALL}] fallback page ${page.pageNumber}:`, err.message);
      return { data: null, usedFallback, stage: PARSE_STAGES.MODEL_CALL };
    }
  }

  if (!raw) return { data: null, usedFallback, stage: PARSE_STAGES.MODEL_CALL };

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.warn(`PYQ parse [${PARSE_STAGES.MODEL_JSON}] page ${page.pageNumber}:`, err.message);
    return { data: null, usedFallback, stage: PARSE_STAGES.MODEL_JSON };
  }

  return { data, usedFallback, stage: null };
}

/**
 * Cheap local smell test for a corrupt text layer. A PRE-FILTER ONLY.
 *
 * It exists to raise suspicion, never to clear a page — the authoritative test is the
 * model comparing text against the rendered image, because that is general and this
 * is not. An earlier version of this idea, shipped alone, declared a Hindi question
 * "clean" that was as corrupt as the one beside it: it only looked for split matras,
 * which was the failure mode that happened to be noticed first.
 *
 * A `true` here is never used to override a model verdict of "trusted" into a
 * failure; it downgrades to 'suspect', which the review UI surfaces and a human
 * settles.
 */
function looksLikeCorruptText(text) {
  if (!text || text.length < 40) return false;
  const deva = (text.match(/[ऀ-ॿ]/g) || []).length;
  if (deva > 20) {
    // A consonant followed by whitespace then a dependent vowel/virama is not
    // something correctly-encoded Devanagari produces.
    const splitMatras = (text.match(/[क-ह]\s+[ा-्]/g) || []).length;
    if (splitMatras > 2) return true;
  }
  // Replacement chars and long runs of private-use codepoints are the other classic
  // signature of a subsetted font with no ToUnicode map.
  if (/�/.test(text)) return true;
  if ((text.match(/[-]/g) || []).length > 3) return true;
  return false;
}

/** Coerce one model-returned question into the shape the draft stores. */
function normaliseQuestion(q, pageNumber) {
  const options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string' && o.trim()) : [];

  return {
    questionNumber: String(q.questionNumber ?? '').trim(),
    sectionName: String(q.sectionName ?? '').trim(),
    marks: Number.isFinite(Number(q.marks)) ? Number(q.marks) : 0,
    questionText: String(q.questionText ?? '').trim(),
    options,
    // correctIndex survives only if it actually indexes the options we have. A model
    // that "helpfully" solved the question despite being told not to would otherwise
    // seed the corpus with unverified answers presented as the paper's own key.
    correctIndex: Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length
      ? q.correctIndex
      : null,
    figureExpected: q.figureExpected === true,
    figureIndex: Number.isInteger(q.figureIndex) && q.figureIndex > 0 ? q.figureIndex : null,
    choiceIndex: Number.isInteger(q.choiceIndex) && q.choiceIndex > 0 ? q.choiceIndex : 0,
    isContainer: q.isContainer === true,
    partOf: String(q.partOf ?? '').trim(),
    partLabel: String(q.partLabel ?? '').trim(),
    // Only the three declared values are accepted. Anything else — including a
    // confident-sounding invention — is treated as 'unclear', because an
    // unrecognised relation is exactly the case where guessing is unsafe.
    partsRelation: ['all-required', 'choose-one', 'unclear'].includes(q.partsRelation) ? q.partsRelation : '',
    // A choice claim WITHOUT quoted evidence is downgraded to 'unclear' below. The
    // evidence string is what makes abstention checkable instead of a vibe.
    partsRelationEvidence: String(q.partsRelationEvidence ?? '').trim(),
    continuesPrevious: q.continuesPrevious === true,
    continues: q.continues === true,
    transcribedFromImage: q.transcribedFromImage === true,
    pageNumber
  };
}

/**
 * Fold the per-page entries into the questions a student would count.
 *
 * This exists because the first real measurement on a genuine board paper extracted
 * 71 questions from a 39-question paper. The over-extraction had three specific,
 * structural causes — not text ambiguity — and each is handled here as well as being
 * instructed in the prompt, because a prompt is a request and this is a guarantee:
 *
 *   1. CONTINUATIONS — a question spanning a page boundary appearing twice.
 *      Folded into the entry already recorded, appending only the new text.
 *   2. INTERNAL CHOICE — "31. ... OR ..." counted as two questions. Kept as two
 *      DOCUMENTS (each alternative has its own text, figure and translation) but
 *      tied by a shared `choiceGroup`, so they count and score as one question.
 *   3. REPEATED NUMBERS — the same number emitted twice for any other reason. The
 *      later entry is treated as a continuation rather than silently duplicating.
 */
// Exported so the fold's decisions can be tested offline, without an API call.
// The asymmetric default below is the kind of rule that has to be checkable cheaply.
export function foldQuestions(raw) {
  const out = [];
  const byKey = new Map();   // `${section}|${number}` -> array of entries

  for (const q of raw) {
    const key = `${q.sectionName}|${q.questionNumber}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, [q]);
      out.push(q);
      continue;
    }

    // A SUB-PART of a question already recorded — a sibling, not a duplicate and not
    // an alternative. Kept as its own row (it has its own text, marks and figure) and
    // linked by parentKey so counting and marks treat the family as one question.
    if (q.partOf) {
      byKey.set(key, [...existing, q]);
      out.push(q);
      continue;
    }

    // An explicit OR alternative, or an entry the model labelled as a distinct
    // choice — a real second alternative under the same number.
    if (q.choiceIndex > 0) {
      // The choice group is the printed number, scoped by section so two sections
      // numbering from 1 cannot collide.
      const groupKey = key;
      existing[0].choiceGroup = groupKey;
      existing[0].choiceIndex = existing[0].choiceIndex || 0;
      q.choiceGroup = groupKey;
      existing.push(q);
      out.push(q);
      continue;
    }

    // Otherwise this is the SAME question seen again: a continuation across a page
    // break, or a duplicate. Append any text this entry adds and drop the entry.
    const target = existing[existing.length - 1];
    if (q.continuesPrevious || q.pageNumber !== target.pageNumber) {
      if (q.questionText && !target.questionText.includes(q.questionText)) {
        target.questionText = `${target.questionText} ${q.questionText}`.trim();
      }
      // A continuation may carry the options or the figure that did not fit.
      if (!target.options.length && q.options.length) target.options = q.options;
      if (!target.figureBox && q.figureBox) { target.figureBox = q.figureBox; target.pageNumber = q.pageNumber; }
      if (q.figureExpected) target.figureExpected = true;
      if (!target.marks && q.marks) target.marks = q.marks;
    }
    // Not pushed to `out` — it is not a question of its own.
  }

  // ── Link sub-parts to their container ──────────────────────────────────
  // Done after the pass so a part can find its parent whichever order they arrived
  // in — a container on page 3 with parts running onto page 4 is normal.
  //
  // parentKey is scoped by SECTION as well as number, for the same reason the fold
  // key is: two sections can both number from 1, and a Section A part must not
  // attach itself to a Section C container.
  for (const q of out) {
    if (!q.partOf) continue;
    q.parentKey = `${q.sectionName}|${q.partOf}`;
  }
  // A container adopts the same key so it groups with its parts.
  for (const q of out) {
    if (q.isContainer) q.parentKey = `${q.sectionName}|${q.questionNumber}`;
  }

  // ── Apply partsRelation, with an ASYMMETRIC safe default ─────────────────
  //
  // The two possible errors do not cost the same, so the tie is not broken by a coin:
  //   • Treating a real CHOICE as all-required  -> the student answers both halves.
  //     They waste time. They lose no marks.
  //   • Treating real REQUIRED PARTS as a choice -> the student answers one and
  //     skips the other. They LOSE MARKS on a compulsory question, and the app told
  //     them to.
  // So 'unclear' resolves to all-required, and a 'choose-one' claim is only honoured
  // when the model quoted printed evidence for it.
  // Families are keyed by parentKey OR choiceGroup. Keying on parentKey alone was a
  // real defect: `choiceIndex > 0` above sets choiceGroup directly from the model's
  // structural answer, so a choice PAIR had no parentKey and never reached this
  // block — its evidence was never checked and `partsAmbiguous` could never be set on
  // it. That is the commonest multi-row shape on every paper, so abstention was
  // structurally impossible exactly where it mattered, and the resulting zero-
  // abstention parse read as a clean one.
  const family = {};
  for (const q of out) {
    const k = q.parentKey || q.choiceGroup;
    if (k) (family[k] ||= []).push(q);
  }

  for (const [key, rows] of Object.entries(family)) {
    // A family's relation is whatever its members agreed on; disagreement is itself
    // a reason to abstain rather than to take a majority.
    const claims = [...new Set(rows.map((r) => r.partsRelation).filter(Boolean))];
    const evidence = rows.map((r) => r.partsRelationEvidence).find(Boolean) || '';
    let relation = claims.length === 1 ? claims[0] : (claims.length ? 'unclear' : '');

    // A choice with no quoted evidence is not a choice we are willing to act on.
    if (relation === 'choose-one' && !evidence) relation = 'unclear';

    const ambiguous = relation === 'unclear' || claims.length > 1;

    for (const r of rows) {
      r.partsRelation = relation || 'all-required';
      r.partsRelationEvidence = evidence;
      r.partsAmbiguous = ambiguous;
    }

    if (relation === 'choose-one') {
      // Honoured: convert the family into a choice group so marks count ONCE and the
      // exam UI renders "attempt any one". The container, if any, is dropped from the
      // group — a stimulus is not one of the alternatives.
      const alts = rows.filter((r) => !r.isContainer);
      alts.forEach((r, i) => { r.choiceGroup = key; r.choiceIndex = i; r.parentKey = ''; });
      for (const r of rows) if (r.isContainer) r.parentKey = key;
    } else {
      // NOT a justified choice — so if an earlier step folded these as alternatives on
      // `choiceIndex` alone, UNFOLD them into required parts.
      //
      // This costs marks accuracy on purpose. Alternatives take max(); parts sum. So
      // unfolding a pair that really was a choice inflates the paper's total, which
      // shows up loudly in the marks-discrepancy check. The opposite mistake — leaving
      // required parts folded as alternatives — tells a student to skip half a
      // compulsory question, and NOTHING surfaces that. A visible over-count beats a
      // silent wrong rubric, which is the whole of Design Rule 19.
      for (const r of rows) {
        if (r.choiceGroup) { r.choiceGroup = ''; r.choiceIndex = 0; }
        if (!r.isContainer) r.parentKey = key;
      }
      for (const r of rows) if (r.isContainer) r.parentKey = key;
    }
  }
  // A container with no parts is not a container — it is an ordinary question that
  // was mislabelled. Left as a plain question rather than counted as an empty family,
  // which would show a question with no answerable content.
  const partCounts = out.reduce((m, q) => {
    if (q.partOf) m[`${q.sectionName}|${q.partOf}`] = (m[`${q.sectionName}|${q.partOf}`] || 0) + 1;
    return m;
  }, {});
  for (const q of out) {
    if (q.isContainer && !partCounts[q.parentKey]) { q.isContainer = false; q.parentKey = ''; }
  }

  return out;
}

/**
 * Parse a whole paper.
 *
 * Returns { sections, questions, durationMinutes, totalMarks, usedFallback,
 *           pages, failedPages } — a DRAFT for admin review, never publishable output.
 *
 * Throws only for failures that make the whole import meaningless (the PDF could not
 * be read, or not one question was found anywhere). Everything else degrades to a
 * per-page note, because a paper that parsed 38 of 40 pages is worth reviewing.
 */
export async function parsePastPaper(pdfBuffer) {
  let extracted;
  try {
    extracted = await extractPdfPages(pdfBuffer);
  } catch (err) {
    // Carries pdfExtract's own named stage through rather than flattening it.
    throw new Error(`${PARSE_STAGES.EXTRACT}: ${err.message}`);
  }

  const sections = [];
  const rawQuestions = [];
  const failedPages = [];
  const pageTrust = [];
  let durationMinutes = 0;
  let totalMarks = 0;
  let usedFallback = false;

  // The paper's own declared structure, read once from page 1 and then carried as a
  // CONSTRAINT into every later page — see the anchoring note in parsePage(). The
  // General Instructions are the first ~1200 characters of page 1 on every board
  // paper checked, and they are printed verbatim, so this is quoting the paper at
  // itself rather than feeding it the model's earlier guesses.
  const declaredStructure = (extracted.pages[0]?.text || '').slice(0, 1200);
  let lastQuestionNumber = '';
  let currentSection = '';

  // Figures come from the PDF's own embedded image objects — exact bounds, original
  // resolution, no crop and nothing for the model to locate. Extracted once, up
  // front, and indexed by page so each page's prompt carries only its own.
  let figures = [];
  try {
    figures = extractEmbeddedFigures(pdfBuffer);
  } catch (err) {
    // Not fatal: a paper whose figures cannot be read still yields usable text, and
    // the I3 rule then holds figure-referencing questions back from publication.
    console.warn(`Embedded figure extraction failed (${err.message}) — parsing text only.`);
  }
  const figuresByPage = {};
  for (const f of figures) (figuresByPage[f.pageNumber] ||= []).push(f);

  // Sequential, not parallel. A 40-page paper fanned out concurrently is 40
  // simultaneous high-detail vision calls — an instant rate-limit on the paid key,
  // and import is a background admin action where wall-clock is not the constraint.
  // The anchoring above makes the sequencing load-bearing as well as polite: each
  // page is parsed knowing where the previous one left off.
  for (const page of extracted.pages) {
    const { data, usedFallback: pageFallback, stage } = await parsePage(page, {
      declaredStructure,
      sectionNames: sections.map((s) => s.name),
      lastQuestionNumber,
      currentSection,
      pageFigures: figuresByPage[page.pageNumber] || [],
      pageHeightPts: page.height / RENDER_SCALE
    });
    if (pageFallback) usedFallback = true;

    if (!data) {
      failedPages.push({ pageNumber: page.pageNumber, stage: stage || PARSE_STAGES.MODEL_CALL });
      continue;
    }

    for (const s of Array.isArray(data.pageSections) ? data.pageSections : []) {
      const name = String(s?.name ?? '').trim();
      if (!name) continue;
      // The discipline is stated once in the General Instructions and rarely repeated
      // on the section heading, so a LATER page may name it when the first did not.
      // Fill it in whenever it arrives rather than only on first sight of the section.
      const printed = String(s?.discipline ?? '').trim();
      const resolved = resolveSubSubjectAlias(printed) || resolveSubSubjectAlias(name);
      const existing = sections.find((x) => x.name === name);
      if (existing) {
        if (!existing.discipline && resolved) { existing.discipline = resolved; existing.disciplinePrinted = printed || name; }
      } else {
        sections.push({
          name,
          instruction: String(s?.instruction ?? '').trim(),
          discipline: resolved,
          disciplinePrinted: resolved ? (printed || name) : ''
        });
      }
    }

    const meta = data.paperMeta || {};
    if (!durationMinutes && Number(meta.durationMinutes) > 0) durationMinutes = Number(meta.durationMinutes);
    if (!totalMarks && Number(meta.totalMarks) > 0) totalMarks = Number(meta.totalMarks);

    // ── PER-PAGE text-layer trust ───────────────────────────────────────────
    // Per PAGE, not per paper: a bilingual or mixed-font paper can have a clean
    // English page and a corrupt Devanagari one, and a paper-level verdict would
    // either condemn the good pages or excuse the bad ones.
    //
    // The verdict comes from the model comparing the supplied text against the
    // rendered page — disagreement-with-vision, which is general. A cheap local
    // heuristic (split matras, say) only catches the one failure mode it was written
    // for: the first version of that heuristic called a Hindi question "clean" when
    // it was as corrupt as the one it flagged. It is kept below ONLY as a
    // pre-filter that can RAISE suspicion, never as the thing that clears a page.
    const modelTrust = String(data.textLayerTrust || '').toLowerCase() === 'untrusted' ? 'untrusted' : 'trusted';
    const transcribed = (Array.isArray(data.questions) ? data.questions : []).some((q) => q.transcribedFromImage === true);
    const suspect = looksLikeCorruptText(page.text);
    const trust = (modelTrust === 'untrusted' || transcribed) ? 'untrusted' : (suspect ? 'suspect' : 'trusted');
    pageTrust.push({ pageNumber: page.pageNumber, trust, heuristicSuspect: suspect });

    for (const q of Array.isArray(data.questions) ? data.questions : []) {
      const n = normaliseQuestion(q, page.pageNumber);
      // A question with no text is not a question. Dropping it here keeps the admin
      // reviewing real rows instead of blank ones.
      if (n.questionText) {
        // Denormalise the section's discipline onto the question so practice mode can
        // filter without a join. Resolved at fold time below for sections whose
        // discipline only became known on a later page.
        rawQuestions.push(n);
        if (n.questionNumber) lastQuestionNumber = n.questionNumber;
        if (n.sectionName) currentSection = n.sectionName;
      }
    }
  }

  // Fold continuations and OR alternatives BEFORE anything counts questions.
  const questions = foldQuestions(rawQuestions);

  // Stamp each question with its section's discipline. Done AFTER all pages, because
  // "Section A is Biology" is stated once on page 1 while Section A's questions may
  // be parsed from pages 2-6 — resolving per page would leave most of them blank.
  const disciplineBySection = Object.fromEntries(sections.map((s) => [s.name, s.discipline || '']));
  for (const q of questions) q.sectionDiscipline = disciplineBySection[q.sectionName] || '';

  if (!questions.length) {
    throw new Error(`${PARSE_STAGES.NO_QUESTIONS}: parsed ${extracted.pageCount} page(s) and found no questions`);
  }

  // Derive section stats from the questions actually found rather than trusting the
  // paper's own "Section A consists of 20 questions" line — the count that matters
  // downstream is what we can really serve, and the admin is about to see both.
  const sectionStats = sections.map((s) => {
    const inSection = questions.filter((q) => q.sectionName === s.name);
    const marks = inSection.map((q) => q.marks).filter((m) => m > 0);
    const uniformMarks = marks.length && marks.every((m) => m === marks[0]) ? marks[0] : 0;
    return {
      name: s.name,
      instruction: s.instruction,
      discipline: s.discipline || '',
      // Choice groups, not documents — an "OR" pair is one question to a student,
      // and this count is compared against the paper's own stated total below.
      questionCount: countQuestionUnits(inSection),
      marksPerQuestion: uniformMarks,
      totalMarks: availableMarks(inSection)
    };
  });

  // ── Self-check against the paper's own numbers ───────────────────────────
  // The paper states how many questions and marks it contains. Comparing our parse
  // to that is free, and it is the single most useful thing the review UI can tell
  // an admin: "this paper says 39 questions, we extracted 71" is immediately
  // actionable in a way that a list of 71 rows is not. It is a WARNING, not a
  // rejection — the admin corrects the parse, and a paper that disagrees is exactly
  // the one that most needs reviewing rather than the one to throw away.
  const declaredCount = Number((declaredStructure.match(/(?:contains|consists of|are)\s+(\d+)\s+questions/i) || [])[1]) || 0;
  const parsedCount = countQuestionUnits(questions);
  const discrepancy = declaredCount && declaredCount !== parsedCount
    ? { declaredQuestions: declaredCount, parsedQuestions: parsedCount, delta: parsedCount - declaredCount }
    : null;
  if (discrepancy) {
    console.warn(`PYQ parse: paper states ${declaredCount} questions, parse produced ${parsedCount}.`);
  }

  // ── MARKS SELF-CONSISTENCY ────────────────────────────────────────────────
  // The paper states its own total on page 1; the sections sum to something. When
  // those disagree, the parse is incomplete — and it is the CHEAPEST possible signal,
  // because it needs no ground truth beyond the paper itself.
  //
  // Caught exactly this on CBSE Class 10 Maths: header says 80, sections summed to 78,
  // because Section E came out 10 marks instead of 12. The question count was
  // PERFECT (38/38), so a count-only check said the paper was clean while two marks
  // were missing. One number agreeing is not the paper agreeing.
  const declaredMarks = Number((declaredStructure.match(/Max(?:imum)?\.?\s*Marks\s*[:.]?\s*(\d+)/i)
    || declaredStructure.match(/M\.?\s*M\.?\s*[:.]?\s*(\d+)/i) || [])[1]) || 0;
  const sectionMarksSum = sectionStats.reduce((a, s) => a + (s.totalMarks || 0), 0);
  const marksDiscrepancy = declaredMarks && declaredMarks !== sectionMarksSum
    ? { declaredMarks, sectionMarksSum, delta: sectionMarksSum - declaredMarks }
    : null;
  if (marksDiscrepancy) {
    console.warn(`PYQ parse: paper states ${declaredMarks} marks, sections sum to ${sectionMarksSum}.`);
  }

  // Figures nobody claimed. Surfaced rather than dropped: an unassigned figure means
  // either a decorative asset (fine) or a question whose figure went missing (not
  // fine), and only the admin can tell which. The review UI offers them for manual
  // attachment instead of silently discarding them.
  const claimed = new Set(questions.map((q) => q.figureIndex).filter(Boolean));
  const unassignedFigures = figures.filter((f) => !claimed.has(f.figureIndex)).map((f) => f.figureIndex);

  return {
    sections: sectionStats,
    questions,
    figures,
    unassignedFigures,
    questionCount: parsedCount,
    rawEntryCount: rawQuestions.length,   // before folding — how much the fold saved
    discrepancy,
    marksDiscrepancy,
    pageTrust,
    untrustedPages: pageTrust.filter(p=>p.trust==="untrusted").map(p=>p.pageNumber),
    suspectPages: pageTrust.filter(p=>p.trust==="suspect").map(p=>p.pageNumber),
    declaredMarks,
    durationMinutes,
    totalMarks: totalMarks || availableMarks(questions),
    usedFallback,
    // NOT "groq-fallback": callGroqChat has its own internal chain that ends at
    // OpenAI gpt-4o-mini, so a fallback parse may not have touched Groq at all.
    // Naming the provider here was wrong for precisely the reader who depends on it
    // — the admin deciding whether to re-import. What actually matters, and what is
    // true either way, is that it was TEXT-ONLY: no vision, which is the capability
    // the primary path exists for.
    parsedWithModel: usedFallback ? 'fallback: text-only (no vision)' : PYQ_MODEL,
    pages: extracted.pages,          // carries the rendered PNGs for figure cropping
    pageCount: extracted.pageCount,
    truncated: extracted.truncated,
    failedPages
  };
}
