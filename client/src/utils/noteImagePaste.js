// Workstream C — image paste/drop/pick handling for the My Notes editor.
//
// THE POINT OF THIS FILE: TipTap's Image extension will happily insert a `data:` URI
// into the document on paste, and the server hard-rejects any document containing one
// (NOTE_INLINE_IMAGE_REJECTED). So the failure mode is not "a big document" — it is a
// student pasting a screenshot and then EVERY subsequent save failing until they
// happen to undo it, with the page silently not persisting in the meantime.
//
// The fix is to intercept at the ProseMirror level, in `editorProps.handlePaste` and
// `handleDrop`, and return `true` to consume the event. Returning true stops the
// default handler running, so the base64 node is never created in the first place —
// rather than being created and then cleaned up, which is a race.
//
// The same path serves the file picker, so all three entry points behave identically.

/** Node name the server looks for to refuse a mid-upload save (utils/tiptapDoc.js). */
export const PLACEHOLDER_NODE = 'imageUploadPlaceholder';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

let uploadSeq = 0;
const nextUploadId = () => `up-${Date.now()}-${++uploadSeq}`;

/** Image files from a clipboard or drop payload, filtered to the allowed types. */
export function imageFilesFrom(dataTransfer) {
  if (!dataTransfer) return [];
  const out = [];
  // `files` covers a screenshot paste and a drag from the desktop.
  for (const f of Array.from(dataTransfer.files || [])) {
    if (ALLOWED.includes(f.type)) out.push(f);
  }
  if (out.length) return out;
  // `items` covers some browsers' clipboard-image representation.
  for (const it of Array.from(dataTransfer.items || [])) {
    if (it.kind === 'file' && ALLOWED.includes(it.type)) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * Build the editorProps handlers.
 *
 * @param {object} deps
 * @param {(file: File, uploadId: string) => Promise<string|null>} deps.upload  resolves to a URL
 * @param {(blocked: boolean) => void} deps.setBlocked  suppresses autosave while uploading
 * @param {(code: string) => void} deps.onError
 */
export function createImageHandlers({ upload, setBlocked, onError }) {
  const activeUploads = new Set();

  const beginUpload = (id) => { activeUploads.add(id); setBlocked?.(true); };
  const endUpload = (id) => {
    activeUploads.delete(id);
    // Only release autosave once EVERY upload has settled — a second paste while the
    // first is in flight must not unblock saving for the first.
    if (activeUploads.size === 0) setBlocked?.(false);
  };

  async function handleFiles(editor, files) {
    for (const file of files) {
      const uploadId = nextUploadId();
      beginUpload(uploadId);

      // Insert a PLACEHOLDER, never the file's data. The document is now
      // unsaveable-by-design until this resolves, which the manager enforces.
      //
      // insertContentAt(pos), NOT insertContent(). `insertContent` inserts INTO the
      // current selection and replaces it when that selection is non-empty — and
      // inserting an atom leaves a NodeSelection ON the node just inserted. So a
      // second paste arriving while the first placeholder was still selected
      // REPLACED it instead of adding beside it: the first upload then resolved
      // against a node that no longer existed, its image never appeared, and its
      // Cloudinary asset was left orphaned. Silent — no error anywhere. The same
      // hazard applies between two files in a single multi-image paste, which is
      // why the position is re-read from the selection on every iteration.
      const at = editor.state.selection.to;
      editor.chain().focus().insertContentAt(at, {
        type: PLACEHOLDER_NODE,
        attrs: { uploadId, name: String(file.name || '').slice(0, 80) }
      }).run();

      try {
        const url = await upload(file, uploadId);
        if (url) replacePlaceholder(editor, uploadId, url);
        else { removePlaceholder(editor, uploadId); onError?.('NOTE_IMAGE_UPLOAD_FAILED'); }
      } catch (err) {
        // On failure the placeholder is REMOVED, not left behind: a stranded
        // placeholder would block autosave forever and corrupt nothing visibly.
        removePlaceholder(editor, uploadId);
        onError?.(err?.code || 'NOTE_IMAGE_UPLOAD_FAILED');
      } finally {
        endUpload(uploadId);
      }
    }
  }

  return {
    handleFiles,

    // Returning TRUE consumes the event, so TipTap's default image paste never runs.
    handlePaste(view, event) {
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return false;          // plain text etc. — let TipTap handle it
      event.preventDefault();
      handleFiles(this.editor, files);
      return true;
    },

    handleDrop(view, event) {
      const files = imageFilesFrom(event.dataTransfer);
      if (!files.length) return false;
      event.preventDefault();
      handleFiles(this.editor, files);
      return true;
    }
  };
}

/** Swap a resolved placeholder for a real image node carrying the Cloudinary URL. */
export function replacePlaceholder(editor, uploadId, url) {
  const { state } = editor;
  let pos = null;
  state.doc.descendants((node, p) => {
    if (node.type.name === PLACEHOLDER_NODE && node.attrs.uploadId === uploadId) { pos = p; return false; }
    return true;
  });
  if (pos === null) return false;
  editor.chain()
    .setNodeSelection(pos)
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.replaceSelectionWith(editor.schema.nodes.image.create({ src: url }));
      return true;
    })
    .run();
  return true;
}

/** Remove a placeholder whose upload failed, so autosave is never blocked forever. */
export function removePlaceholder(editor, uploadId) {
  const { state } = editor;
  let pos = null;
  state.doc.descendants((node, p) => {
    if (node.type.name === PLACEHOLDER_NODE && node.attrs.uploadId === uploadId) { pos = p; return false; }
    return true;
  });
  if (pos === null) return false;
  editor.chain().setNodeSelection(pos).deleteSelection().run();
  return true;
}

/** True if the document still holds an unresolved placeholder (autosave must wait). */
export function hasUnresolvedPlaceholder(doc) {
  let found = false;
  const walk = (n) => {
    if (found || !n) return;
    if (n.type === PLACEHOLDER_NODE) { found = true; return; }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return found;
}
