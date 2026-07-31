import express from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import Note, { MAX_PAGES_PER_STUDENT, MAX_IMAGES_PER_PAGE } from '../models/Note.js';
import { validateNoteDoc } from '../utils/tiptapDoc.js';
import { cloudinaryConfigured, uploadNoteImage } from '../utils/cloudinary.js';
import { sniffImageMime } from '../utils/imageSniff.js';

// Workstream C — "My Notes" (student-authored pages).
//
// A SEPARATE router from routes/notes.js, mounted at /api/my-notes, so Feature 18's
// /api/notes/generate and /api/notes/pdf are untouched. Same reasoning as splitting
// the two profile forms in Workstream B: two different concerns sharing one file is
// where a later edit merges them by accident.
//
// Every route is student-only and ownership-checked, returning 404 (never 403) on a
// mismatch — the same pattern as Feature 17's Mentor conversations, so a student
// cannot even confirm that another student's note id exists.

const router = express.Router();

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;   // 5MB per image, server-enforced
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Metadata shape for the list view — never includes `content`. */
const toListItem = (n) => ({
  id: n._id, title: n.title, icon: n.icon,
  parentNoteId: n.parentNoteId, order: n.order,
  updatedAt: n.updatedAt, createdAt: n.createdAt
});

const toFull = (n, extra = {}) => ({
  id: n._id, title: n.title, icon: n.icon,
  parentNoteId: n.parentNoteId, order: n.order,
  content: n.content, imageCount: n.imageCount,
  updatedAt: n.updatedAt, createdAt: n.createdAt, ...extra
});

// GET /api/my-notes — list, METADATA ONLY (no bodies).
// Bodies are excluded deliberately: a student with 100 pages would otherwise pull
// several MB to render a sidebar.
router.get('/', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.userId })
      .select('title icon parentNoteId order updatedAt createdAt')
      .sort({ parentNoteId: 1, order: 1, createdAt: 1 })
      .lean();
    res.json({ notes: notes.map((n) => toListItem(n)), limits: { maxPages: MAX_PAGES_PER_STUDENT } });
  } catch (error) {
    console.error('My-notes list error:', error.message);
    res.status(500).json({ error: 'NOTE_LIST_FAILED' });
  }
});

// GET /api/my-notes/search?q= — titles AND body text, scoped to this student.
router.get('/search', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (!q) return res.json({ notes: [] });
    const notes = await Note.find({ userId: req.userId, $text: { $search: q } })
      .select('title icon parentNoteId order updatedAt createdAt')
      .limit(50)
      .lean();
    res.json({ notes: notes.map((n) => toListItem(n)) });
  } catch (error) {
    console.error('My-notes search error:', error.message);
    res.status(500).json({ error: 'NOTE_SEARCH_FAILED' });
  }
});

// POST /api/my-notes — create a page.
router.post('/', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const count = await Note.countDocuments({ userId: req.userId });
    if (count >= MAX_PAGES_PER_STUDENT) {
      return res.status(400).json({ error: 'NOTE_PAGE_LIMIT', limit: MAX_PAGES_PER_STUDENT });
    }

    // ONE level of nesting: a parent may not itself have a parent.
    let parentNoteId = null;
    if (req.body?.parentNoteId) {
      if (!isValidId(req.body.parentNoteId)) return res.status(400).json({ error: 'NOTE_PARENT_INVALID' });
      const parent = await Note.findOne({ _id: req.body.parentNoteId, userId: req.userId }).select('parentNoteId');
      if (!parent) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
      if (parent.parentNoteId) return res.status(400).json({ error: 'NOTE_NESTING_TOO_DEEP' });
      parentNoteId = parent._id;
    }

    const siblings = await Note.countDocuments({ userId: req.userId, parentNoteId });
    const note = await Note.create({
      userId: req.userId,
      title: String(req.body?.title || '').slice(0, 200),
      icon: String(req.body?.icon || '📄').slice(0, 8),
      parentNoteId,
      order: siblings
    });
    res.status(201).json({ note: toFull(note) });
  } catch (error) {
    console.error('My-notes create error:', error.message);
    res.status(500).json({ error: 'NOTE_CREATE_FAILED' });
  }
});

// POST /api/my-notes/reorder — reorder a whole sibling group in ONE request.
//
// `order` is a plain integer, so rewriting siblings one PATCH at a time means an
// interrupted drag (dropped connection, closed tab, a 500 midway) leaves duplicate or
// gapped values and the tree renders in an arbitrary order. The client sends the full
// ordered id list for one parent and the SERVER assigns the indices, so the operation
// is all-or-nothing from the client's point of view and the result is always a dense
// 0..n-1 sequence.
router.post('/reorder', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
    if (!ids || !ids.length || ids.length > 200) return res.status(400).json({ error: 'NOTE_REORDER_INVALID' });
    if (!ids.every(isValidId)) return res.status(400).json({ error: 'NOTE_REORDER_INVALID' });
    if (new Set(ids.map(String)).size !== ids.length) return res.status(400).json({ error: 'NOTE_REORDER_INVALID' });

    const parentNoteId = req.body?.parentNoteId && isValidId(req.body.parentNoteId)
      ? new mongoose.Types.ObjectId(req.body.parentNoteId)
      : null;

    // Every id must belong to this student AND to the stated sibling group — otherwise
    // a crafted list could reorder (and thereby confirm the existence of) other pages.
    // A foreign id, a nonexistent id and an id from another sibling group all return
    // the SAME 404, so the response is not an existence oracle.
    const owned = await Note.find({ userId: req.userId, parentNoteId, _id: { $in: ids } }).select('_id').lean();
    if (owned.length !== ids.length) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });

    // The list must be COMPLETE for the group. A partial list assigns 0..k-1 to the
    // sent ids while the omitted siblings keep their old indices — which collides:
    // reordering 2 of 4 pages produced `Two:0 Four:0 One:1 Three:2`, two pages at
    // position 0, and the tree then renders in whatever order Mongo returns.
    // Rejecting is right rather than appending the omitted ones, because appending
    // would silently move pages the student never asked to move. The client always
    // has the full sibling list, so a partial one is a client bug and should say so.
    const siblingCount = await Note.countDocuments({ userId: req.userId, parentNoteId });
    if (siblingCount !== ids.length) {
      return res.status(400).json({ error: 'NOTE_REORDER_INCOMPLETE', expected: siblingCount, received: ids.length });
    }

    // One bulk write: the indices are assigned here, densely, from the given order.
    await Note.bulkWrite(ids.map((id, index) => ({
      updateOne: { filter: { _id: id, userId: req.userId }, update: { $set: { order: index } } }
    })));

    const notes = await Note.find({ userId: req.userId, parentNoteId })
      .select('title icon parentNoteId order updatedAt createdAt')
      .sort({ order: 1 }).lean();
    res.json({ notes: notes.map((n) => toListItem(n)) });
  } catch (error) {
    console.error('My-notes reorder error:', error.message);
    res.status(500).json({ error: 'NOTE_REORDER_FAILED' });
  }
});

// GET /api/my-notes/:id — full page including content. Ownership-checked → 404.
router.get('/:id', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });
    if (!note) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
    res.json({ note: toFull(note) });
  } catch (error) {
    console.error('My-notes get error:', error.message);
    res.status(500).json({ error: 'NOTE_GET_FAILED' });
  }
});

// PATCH /api/my-notes/:id — autosave target (title, icon, content, order, parent).
//
// Rejects a document containing base64 images or an unresolved upload placeholder,
// and rejects one over the 500KB cap with a distinct code so the client can stop
// claiming "Saved" instead of only logging the failure.
router.patch('/:id', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId });
    if (!note) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });

    let warn = null;
    if (req.body?.content !== undefined) {
      const v = validateNoteDoc(req.body.content);
      if (!v.ok) {
        return res.status(400).json({
          error: v.code,
          ...(v.bytes ? { bytes: v.bytes, limit: 500 * 1024 } : {}),
          ...(v.imageCount ? { imageCount: v.imageCount, limit: MAX_IMAGES_PER_PAGE } : {})
        });
      }
      note.content = req.body.content;
      note.plainText = v.plainText;
      note.imageCount = v.imageCount;
      warn = v.warn;
    }

    if (typeof req.body?.title === 'string') note.title = req.body.title.slice(0, 200);
    if (typeof req.body?.icon === 'string') note.icon = req.body.icon.slice(0, 8);
    if (Number.isInteger(req.body?.order)) note.order = req.body.order;

    if (req.body?.parentNoteId !== undefined) {
      if (req.body.parentNoteId === null) note.parentNoteId = null;
      else {
        if (!isValidId(req.body.parentNoteId)) return res.status(400).json({ error: 'NOTE_PARENT_INVALID' });
        if (String(req.body.parentNoteId) === String(note._id)) return res.status(400).json({ error: 'NOTE_PARENT_INVALID' });
        const parent = await Note.findOne({ _id: req.body.parentNoteId, userId: req.userId }).select('parentNoteId');
        if (!parent) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
        if (parent.parentNoteId) return res.status(400).json({ error: 'NOTE_NESTING_TOO_DEEP' });
        // A page that already has children cannot become a child itself.
        const hasChildren = await Note.countDocuments({ userId: req.userId, parentNoteId: note._id });
        if (hasChildren) return res.status(400).json({ error: 'NOTE_NESTING_TOO_DEEP' });
        note.parentNoteId = parent._id;
      }
    }

    await note.save();
    res.json({ note: toFull(note), warn });
  } catch (error) {
    console.error('My-notes update error:', error.message);
    res.status(500).json({ error: 'NOTE_SAVE_FAILED' });
  }
});

// DELETE /api/my-notes/:id — cascade-deletes children.
router.delete('/:id', authMiddleware, requireRole('student'), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
    const note = await Note.findOne({ _id: req.params.id, userId: req.userId }).select('_id');
    if (!note) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });

    const children = await Note.deleteMany({ userId: req.userId, parentNoteId: note._id });
    await Note.deleteOne({ _id: note._id, userId: req.userId });
    res.json({ deleted: true, childrenDeleted: children.deletedCount || 0 });
  } catch (error) {
    console.error('My-notes delete error:', error.message);
    res.status(500).json({ error: 'NOTE_DELETE_FAILED' });
  }
});

// POST /api/my-notes/:id/image — upload an image for a page.
//
// The client inserts a PLACEHOLDER node while this is in flight and swaps in the
// returned URL on success, so no base64 ever enters the document. Validation is by
// MAGIC BYTES, never the filename or the client's Content-Type.
router.post('/:id/image', authMiddleware, requireRole('student'), (req, res) => {
  imageUpload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        return res.status(400).json({
          error: uploadErr.code === 'LIMIT_FILE_SIZE' ? 'NOTE_IMAGE_TOO_LARGE' : 'NOTE_IMAGE_INVALID',
          limitMb: 5
        });
      }
      if (!isValidId(req.params.id)) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });
      const note = await Note.findOne({ _id: req.params.id, userId: req.userId }).select('imageCount');
      if (!note) return res.status(404).json({ error: 'NOTE_NOT_FOUND' });

      if (!req.file?.buffer?.length) return res.status(400).json({ error: 'NOTE_IMAGE_MISSING' });

      // Magic-byte sniff: the extension and Content-Type are both spoofable.
      const mime = sniffImageMime(req.file.buffer);
      if (!mime) return res.status(400).json({ error: 'NOTE_IMAGE_TYPE_UNSUPPORTED' });

      if ((note.imageCount || 0) >= MAX_IMAGES_PER_PAGE) {
        return res.status(400).json({ error: 'NOTE_TOO_MANY_IMAGES', limit: MAX_IMAGES_PER_PAGE });
      }

      // Matches the existing degradation pattern: text editing keeps working, image
      // upload alone reports unavailable.
      if (!cloudinaryConfigured) return res.status(503).json({ error: 'NOTE_IMAGE_STORAGE_UNAVAILABLE' });

      const url = await uploadNoteImage(req.file.buffer, req.userId, req.params.id);
      if (!url) return res.status(502).json({ error: 'NOTE_IMAGE_UPLOAD_FAILED' });

      res.json({ url });
    } catch (error) {
      console.error('My-notes image error:', error.message);
      res.status(500).json({ error: 'NOTE_IMAGE_UPLOAD_FAILED' });
    }
  });
});

export default router;
