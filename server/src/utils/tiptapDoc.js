// Workstream C — server-side validation of a TipTap/ProseMirror document.
//
// The client is not trusted with any of this. Three separate hazards:
//
//   1. BASE64 IMAGES. The natural TipTap paste flow inserts an image immediately as a
//      `data:` URI. If autosave fires before the Cloudinary upload resolves, that
//      base64 reaches Mongo — which blows the 500KB page cap and, at scale, the 16MB
//      document limit. So a `data:` src is REJECTED here, not trimmed or tolerated.
//   2. UNRESOLVED PLACEHOLDERS. A page mid-upload must not be persisted with a
//      placeholder node, because the placeholder would survive a reload as a
//      permanent hole. The client is expected to skip autosave while one exists; this
//      rejects it server-side too, so a client bug cannot corrupt the page.
//   3. SIZE. Measured in BYTES of serialised JSON, not characters — Devanagari is
//      3 bytes per character in UTF-8, so a character count would let a Hindi page
//      through at roughly triple the intended size.

import { MAX_PAGE_BYTES, MAX_IMAGES_PER_PAGE, PAGE_BYTES_WARN_AT } from '../models/Note.js';

const MAX_NODES = 20000;   // structural runaway guard, independent of byte size

/** Depth-first walk of a ProseMirror doc, with a hard node budget. */
function walk(node, visit, state = { count: 0 }) {
  if (!node || typeof node !== 'object') return state;
  state.count += 1;
  if (state.count > MAX_NODES) return state;
  visit(node);
  const kids = Array.isArray(node.content) ? node.content : [];
  for (const k of kids) walk(k, visit, state);
  return state;
}

/** Concatenated text of every text node — powers search without re-walking at query time. */
export function extractPlainText(doc) {
  const parts = [];
  walk(doc, (n) => { if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text); });
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 100000);
}

/**
 * Validate a document for storage.
 * Returns { ok, code, bytes, imageCount, plainText, warn } — `code` is a translatable
 * CODE, never prose, matching the Workstream B convention.
 */
export function validateNoteDoc(raw) {
  if (!raw || typeof raw !== 'object' || raw.type !== 'doc') {
    return { ok: false, code: 'NOTE_DOC_INVALID' };
  }

  let serialised;
  try {
    serialised = JSON.stringify(raw);
  } catch {
    return { ok: false, code: 'NOTE_DOC_INVALID' };   // circular / unserialisable
  }

  const bytes = Buffer.byteLength(serialised, 'utf8');
  if (bytes > MAX_PAGE_BYTES) {
    return { ok: false, code: 'NOTE_TOO_LARGE', bytes };
  }

  let imageCount = 0;
  let base64Image = false;
  let unresolvedPlaceholder = false;
  let nodeCount = 0;

  const state = walk(raw, (n) => {
    if (n.type === 'image') {
      imageCount += 1;
      const src = String(n.attrs?.src || '');
      // Reject the whole save rather than stripping the node: silently dropping a
      // student's pasted image is worse than telling them it did not upload.
      if (/^data:/i.test(src)) base64Image = true;
    }
    // The client inserts this node while an upload is in flight and replaces it on
    // success. Its presence means the document is not finished.
    if (n.type === 'imageUploadPlaceholder') unresolvedPlaceholder = true;
  });
  nodeCount = state.count;

  if (nodeCount > MAX_NODES) return { ok: false, code: 'NOTE_TOO_COMPLEX' };
  if (base64Image) return { ok: false, code: 'NOTE_INLINE_IMAGE_REJECTED' };
  if (unresolvedPlaceholder) return { ok: false, code: 'NOTE_UPLOAD_IN_PROGRESS' };
  if (imageCount > MAX_IMAGES_PER_PAGE) return { ok: false, code: 'NOTE_TOO_MANY_IMAGES', imageCount };

  return {
    ok: true,
    bytes,
    imageCount,
    plainText: extractPlainText(raw),
    // Surfaced so the client can warn while there is still room to act, rather than
    // only at the moment a save is refused.
    warn: bytes >= PAGE_BYTES_WARN_AT ? 'NOTE_APPROACHING_LIMIT' : null
  };
}
