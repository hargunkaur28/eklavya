import mongoose from 'mongoose';

// Workstream C — "My Notes": a student's own Notion-style pages.
//
// DISTINCT from Feature 18 (the AI PDF notes generator), which is ephemeral
// generate → review → download and persists nothing. This is durable, student-authored
// content. Feature 18's sidebar entry is renamed "AI Notes"; this one is "My Notes".

// Per-student and per-page limits, enforced in the routes with clear errors.
export const MAX_PAGES_PER_STUDENT = 100;
export const MAX_PAGE_BYTES = 500 * 1024;   // 500KB of TipTap JSON
export const MAX_IMAGES_PER_PAGE = 50;
// Warn the student before the hard cap, so a page that is filling up says so while
// there is still room to act rather than only at the moment a save is refused.
export const PAGE_BYTES_WARN_AT = Math.floor(MAX_PAGE_BYTES * 0.8);

const noteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: '' },
  icon: { type: String, default: '📄' },

  // The TipTap/ProseMirror document. Mixed because its shape is the editor's schema,
  // not ours — Mongoose must not try to cast or validate node internals.
  //
  // Image nodes store a Cloudinary URL. Base64 data URIs are REJECTED at the route
  // layer: a pasted image inlined as base64 would blow the 500KB page cap and, at
  // scale, MongoDB's 16MB document limit. See routes/myNotes.js.
  content: { type: mongoose.Schema.Types.Mixed, default: () => ({ type: 'doc', content: [] }) },

  // ONE level of nesting only — a page may have child pages, and a child may not.
  // Enforced in the route by rejecting a parent that itself has a parent.
  parentNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', default: null, index: true },

  order: { type: Number, default: 0 },

  // Denormalised plain text of `content`, maintained on write, so search can use a
  // text index instead of walking every document's ProseMirror tree at query time.
  plainText: { type: String, default: '' },

  // How many image nodes the document holds — checked against MAX_IMAGES_PER_PAGE
  // without having to re-walk the tree on every save.
  imageCount: { type: Number, default: 0 }
}, { timestamps: true });

// Compound index for the list view (a student's pages in display order).
noteSchema.index({ userId: 1, parentNoteId: 1, order: 1 });
// Search across titles and body text, scoped per student in the query.
noteSchema.index({ title: 'text', plainText: 'text' });

export default mongoose.model('Note', noteSchema);
