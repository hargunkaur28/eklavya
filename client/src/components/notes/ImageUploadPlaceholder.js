import { Node, mergeAttributes } from '@tiptap/core';

// Workstream C — the node that stands in for an image while it uploads.
//
// Its whole purpose is to be UNSAVEABLE. The server refuses any document containing
// it (NOTE_UPLOAD_IN_PROGRESS) and the save manager keeps the save pending while one
// exists, so a half-uploaded page can never be persisted with a permanent hole in it.
// It is replaced by a real `image` node carrying a Cloudinary URL on success, and
// removed outright on failure — a stranded placeholder would block autosave forever.
//
// `atom: true` so it behaves as a single indivisible unit: the student can select and
// delete it, but not type inside it or split it.
export const PLACEHOLDER_NODE = 'imageUploadPlaceholder';

export const ImageUploadPlaceholder = Node.create({
  name: PLACEHOLDER_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      uploadId: { default: null },
      name: { default: '' }
    };
  },

  parseHTML() {
    return [{ tag: `div[data-type="${PLACEHOLDER_NODE}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': PLACEHOLDER_NODE, class: 'note-img-uploading' }),
      ['span', { class: 'note-img-spinner' }],
      ['span', { class: 'note-img-uploading-label' }, HTMLAttributes.name || 'Uploading image…']
    ];
  }
});

export default ImageUploadPlaceholder;
