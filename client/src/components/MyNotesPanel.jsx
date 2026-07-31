import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {
  Plus, Trash2, ChevronRight, ChevronDown, Search, ImagePlus, Loader2, AlertCircle,
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, ListChecks, Code, Quote, CornerDownRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';
import { createNoteSaveManager, SAVE_STATE } from '../utils/noteSaveManager.js';
import { createImageHandlers, hasUnresolvedPlaceholder } from '../utils/noteImagePaste.js';
import ImageUploadPlaceholder from './notes/ImageUploadPlaceholder.js';

// Workstream C — "My Notes": the student's own Notion-style pages.
//
// The hazardous logic lives OUTSIDE this component and is unit-tested:
//   • utils/noteSaveManager.js  — the autosave state machine (debounce race, stale
//     in-flight responses, the setContent-fires-onUpdate footgun, delete-while-pending,
//     navigate-away, upload blocking, sticky error state).
//   • utils/noteImagePaste.js   — paste/drop interception at the ProseMirror level, so
//     a base64 data URI never enters the document.
// This file is the surface that consumes them.
//
// ONE shared editor instance with setContent on page switch (cheaper than an instance
// per page), which is only safe because of the manager's beginLoad/endLoad bracket.
// editor.destroy() runs on unmount — otherwise every visit to the Notes section leaks
// a ProseMirror instance and its plugins.

// Mirrors AuthContext's API base resolution — the keepalive save below cannot go
// through authFetch, because it must build the request synchronously at teardown.
const API_ROOT = import.meta.env.VITE_API_BASE_URL
  || ((typeof window !== 'undefined' && ['localhost','127.0.0.1'].includes(window.location.hostname))
    ? 'http://127.0.0.1:5000/api' : '/api');

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

export default function MyNotesPanel() {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.myNotes || translations.en.myNotes;
  const errText = (code) => {
    const map = translations[language]?.myNotes?.errors || translations.en.myNotes.errors;
    return map[code] || map.GENERIC;
  };

  const [notes, setNotes] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [saveUi, setSaveUi] = useState({ state: SAVE_STATE.IDLE, error: null, warn: null });
  const [panelError, setPanelError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);   // note object
  const fileInputRef = useRef(null);
  const managerRef = useRef(null);
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  // ── the save manager ───────────────────────────────────────────────────────
  if (!managerRef.current) {
    managerRef.current = createNoteSaveManager({
      onState: setSaveUi,
      save: async (noteId, payload) => {
        const res = await authFetch(`/my-notes/${noteId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, code: data.error || 'NOTE_SAVE_FAILED' };
        // Keep the sidebar title in sync with the H1-derived title.
        setNotes((list) => list.map((n) => (n.id === noteId ? { ...n, title: data.note?.title ?? n.title, updatedAt: data.note?.updatedAt } : n)));
        return { ok: true, warn: data.warn || null };
      }
    });
  }
  const manager = managerRef.current;

  // ── image upload (paste / drop / picker all share this) ────────────────────
  const imageHandlers = useMemo(() => createImageHandlers({
    setBlocked: (b) => manager.setBlocked(b),
    onError: (code) => setPanelError(errText(code)),
    upload: async (file) => {
      const noteId = activeIdRef.current;
      if (!noteId) return null;
      const fd = new FormData();
      fd.append('image', file);
      // No Content-Type header: the browser must set the multipart boundary.
      const res = await authFetch(`/my-notes/${noteId}/image`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(data.error || 'NOTE_IMAGE_UPLOAD_FAILED'); e.code = data.error; throw e; }
      return data.url || null;
    }
  }), [authFetch, manager, language]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: false }),
      ImageUploadPlaceholder,
      Image.configure({ inline: false, allowBase64: false }),  // belt: no base64 nodes
      Placeholder.configure({ placeholder: () => t.editorPlaceholder })
    ],
    content: EMPTY_DOC,
    editorProps: {
      attributes: { class: 'note-prose' },
      // Intercepted HERE, at the ProseMirror level, returning true to consume the
      // event — so TipTap's default image paste never creates a data: URI node.
      handlePaste: (view, event) => imageHandlers.handlePaste.call({ editor }, view, event),
      handleDrop: (view, event) => imageHandlers.handleDrop.call({ editor }, view, event)
    },
    onUpdate: ({ editor: ed }) => {
      const noteId = activeIdRef.current;
      if (!noteId) return;
      const doc = ed.getJSON();
      // A document mid-upload must not be sent; the manager keeps it pending.
      manager.setBlocked(hasUnresolvedPlaceholder(doc));
      // The note id is captured HERE, at schedule time — never read at fire time.
      manager.schedule(noteId, { content: doc, title: deriveTitle(doc) });
    }
  });

  // editor.destroy() on unmount, plus a final flush — leaving the Notes section
  // loses the same work as switching pages, and it is the one a student hits by
  // clicking the sidebar.
  useEffect(() => () => {
    manager.flushAll();
    manager.dispose();
    editor?.destroy();
  }, [editor, manager]);

  // beforeunload cannot await, so the pending save goes out with `keepalive: true`,
  // which survives page teardown.
  //
  // NOT sendBeacon: it cannot set headers, so it could never carry the
  // `Authorization: Bearer` token this API requires. A beacon endpoint would have to
  // either 401 every time or bypass auth — and an auth bypass is a far worse thing to
  // own than a missing hard-close save. `fetch(keepalive)` authenticates normally
  // against the existing PATCH, so there is no new endpoint and no new auth surface.
  //
  // keepalive caps the body at ~64KB. Over that the request is refused by the
  // browser, so the save is simply dropped — the `flushAll()` on unmount already
  // covers the sidebar-click case, which is the one students actually hit. A >64KB
  // page is also exactly where losing the last two seconds hurts most, which is an
  // argument for NOTE_APPROACHING_LIMIT firing well before the hard cap.
  useEffect(() => {
    const KEEPALIVE_MAX_BYTES = 60 * 1024;   // headroom under the ~64KB limit
    const onBeforeUnload = () => {
      const job = manager.pendingPayload();
      if (!job) return;
      try {
        const body = JSON.stringify(job.payload);
        if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return;   // cannot send; drop
        const token = localStorage.getItem('eklavya_token') || sessionStorage.getItem('eklavya_token');
        if (!token) return;
        fetch(`${API_ROOT}/my-notes/${job.noteId}`, {
          method: 'PATCH',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body
        }).catch(() => { /* teardown — nothing to report to */ });
      } catch { /* best effort only */ }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [manager]);

  // ── list ───────────────────────────────────────────────────────────────────
  const refreshList = useCallback(async () => {
    try {
      const res = await authFetch('/my-notes');
      const data = await res.json();
      if (res.ok) setNotes(data.notes || []);
    } catch { setPanelError(errText('NOTE_LIST_FAILED')); }
    finally { setLoadingList(false); }
  }, [authFetch, language]);

  useEffect(() => { refreshList(); }, [refreshList]);

  // ── open a page ────────────────────────────────────────────────────────────
  const openNote = useCallback(async (id) => {
    if (!editor || id === activeIdRef.current) return;
    setPanelError('');
    await manager.setActiveNote(id);          // flushes the OUTGOING page first
    setActiveId(id);
    try {
      const res = await authFetch(`/my-notes/${id}`);
      const data = await res.json();
      if (!res.ok) { setPanelError(errText(data.error)); return; }
      // beginLoad/endLoad brackets setContent so its onUpdate cannot schedule a save
      // of content that was just read — the classic TipTap footgun.
      manager.beginLoad();
      editor.commands.setContent(data.note.content || EMPTY_DOC, false);
      manager.endLoad();
    } catch { setPanelError(errText('NOTE_GET_FAILED')); }
  }, [authFetch, editor, manager, language]);

  const createNote = async (parentNoteId = null) => {
    try {
      const res = await authFetch('/my-notes', { method: 'POST', body: JSON.stringify({ title: '', parentNoteId }) });
      const data = await res.json();
      if (!res.ok) { setPanelError(errText(data.error)); return; }
      await refreshList();
      if (parentNoteId) setExpanded((e) => ({ ...e, [parentNoteId]: true }));
      openNote(data.note.id);
    } catch { setPanelError(errText('NOTE_CREATE_FAILED')); }
  };

  const doDelete = async (note) => {
    // Cancel any pending save for this note BEFORE the DELETE, so the flush can
    // neither 404 noisily nor race the delete and resurrect the document.
    manager.cancel(note.id);
    try {
      const res = await authFetch(`/my-notes/${note.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setPanelError(errText(d.error)); return; }
      setConfirmDelete(null);
      if (activeIdRef.current === note.id) { setActiveId(null); editor?.commands.clearContent(); }
      refreshList();
    } catch { setPanelError(errText('NOTE_DELETE_FAILED')); }
  };

  // ── search ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return undefined; }
    const id = setTimeout(async () => {
      try {
        const res = await authFetch(`/my-notes/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (res.ok) setSearchHits(data.notes || []);
      } catch { /* leave the tree as-is */ }
    }, 300);
    return () => clearTimeout(id);
  }, [query, authFetch]);

  // ── tree ───────────────────────────────────────────────────────────────────
  const topLevel = notes.filter((n) => !n.parentNoteId);
  const childrenOf = (id) => notes.filter((n) => String(n.parentNoteId) === String(id));
  const displayTitle = (n) => (n.title?.trim() ? n.title : t.untitled);

  const saveLabel = () => {
    if (saveUi.state === SAVE_STATE.SAVING) return t.saving;
    if (saveUi.state === SAVE_STATE.DIRTY) return t.unsaved;
    if (saveUi.state === SAVE_STATE.SAVED) return t.saved;
    if (saveUi.state === SAVE_STATE.ERROR) return t.saveFailed;
    return '';
  };

  const activeNote = notes.find((n) => n.id === activeId);

  return (
    <div className="mynotes">
      <aside className="mynotes-tree">
        <div className="mynotes-tree-head">
          <strong>{t.title}</strong>
          <button type="button" className="mynotes-icon-btn" onClick={() => createNote(null)} aria-label={t.newPage}>
            <Plus size={16} />
          </button>
        </div>

        <label className="mynotes-search">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder} />
        </label>

        {loadingList ? (
          <p className="mynotes-muted"><Loader2 className="animate-spin" size={14} /> {t.loading}</p>
        ) : searchHits ? (
          searchHits.length ? searchHits.map((n) => (
            <button key={n.id} type="button" className={`mynotes-item ${n.id === activeId ? 'active' : ''}`} onClick={() => openNote(n.id)}>
              <span className="mynotes-emoji">{n.icon}</span> {displayTitle(n)}
            </button>
          )) : <p className="mynotes-muted">{t.noResults}</p>
        ) : topLevel.length ? topLevel.map((n) => {
          const kids = childrenOf(n.id);
          const open = !!expanded[n.id];
          return (
            <div key={n.id} className="mynotes-branch">
              <div className={`mynotes-item ${n.id === activeId ? 'active' : ''}`}>
                {kids.length > 0 ? (
                  <button type="button" className="mynotes-twisty" onClick={() => setExpanded((e) => ({ ...e, [n.id]: !open }))} aria-label={open ? t.collapse : t.expand}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                ) : <span className="mynotes-twisty-spacer" />}
                <button type="button" className="mynotes-item-label" onClick={() => openNote(n.id)}>
                  <span className="mynotes-emoji">{n.icon}</span> {displayTitle(n)}
                </button>
                <button type="button" className="mynotes-icon-btn" onClick={() => createNote(n.id)} aria-label={t.newSubPage}>
                  <CornerDownRight size={13} />
                </button>
                <button type="button" className="mynotes-icon-btn danger" onClick={() => setConfirmDelete(n)} aria-label={t.deletePage}>
                  <Trash2 size={13} />
                </button>
              </div>
              {open && kids.map((c) => (
                <div key={c.id} className={`mynotes-item child ${c.id === activeId ? 'active' : ''}`}>
                  <button type="button" className="mynotes-item-label" onClick={() => openNote(c.id)}>
                    <span className="mynotes-emoji">{c.icon}</span> {displayTitle(c)}
                  </button>
                  <button type="button" className="mynotes-icon-btn danger" onClick={() => setConfirmDelete(c)} aria-label={t.deletePage}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          );
        }) : (
          <div className="mynotes-empty">
            <p>{t.emptyTitle}</p>
            <button type="button" className="primary-button" onClick={() => createNote(null)}>{t.createFirst}</button>
          </div>
        )}
      </aside>

      <section className="mynotes-editor">
        {!activeId ? (
          <div className="mynotes-empty-editor"><p>{t.pickAPage}</p></div>
        ) : (
          <>
            <div className="mynotes-editor-head">
              <span className={`mynotes-status ${saveUi.state}`}>
                {saveUi.state === SAVE_STATE.SAVING && <Loader2 className="animate-spin" size={13} />}
                {saveUi.state === SAVE_STATE.ERROR && <AlertCircle size={13} />}
                {saveLabel()}
              </span>
              {/* The error state must STOP claiming saved and say what went wrong —
                  a student typing into a page that stopped persisting has no other clue. */}
              {saveUi.state === SAVE_STATE.ERROR && (
                <span className="mynotes-save-error">{errText(saveUi.error)}</span>
              )}
              {saveUi.warn && <span className="mynotes-warn">{errText(saveUi.warn)}</span>}
            </div>

            {editor && (
              <>
                {/* Bubble toolbar on selection, desktop only — on small viewports it
                    collides with the native selection handles, so a fixed bottom bar
                    is used there instead (see .mynotes-toolbar.fixed in styles.css). */}
                <BubbleMenu editor={editor} tippyOptions={{ duration: 120 }} className="mynotes-bubble">
                  <ToolbarButtons editor={editor} t={t} compact />
                </BubbleMenu>

                <div className="mynotes-toolbar">
                  <ToolbarButtons editor={editor} t={t} />
                  <button type="button" className="mynotes-tool" onClick={() => fileInputRef.current?.click()} title={t.insertImage}>
                    <ImagePlus size={15} />
                  </button>
                  <input
                    ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = '';
                      if (files.length) imageHandlers.handleFiles(editor, files);
                    }}
                  />
                </div>

                <EditorContent editor={editor} />
              </>
            )}
          </>
        )}

        {panelError && <div className="auth-error-banner">{panelError}</div>}
      </section>

      {confirmDelete && (
        <div className="mynotes-confirm-backdrop" role="alertdialog" aria-label={t.deleteTitle}>
          <div className="mynotes-confirm">
            <p><strong>{t.deleteTitle}</strong></p>
            {/* The CHILD COUNT is the whole point: one level of nesting means a
                collapsed parent can be hiding pages the student has forgotten. */}
            <p>{
              childrenOf(confirmDelete.id).length > 0
                ? t.deleteWithChildren(displayTitle(confirmDelete), childrenOf(confirmDelete.id).length)
                : t.deleteSingle(displayTitle(confirmDelete))
            }</p>
            <div className="mynotes-confirm-actions">
              <button type="button" className="pf-ghost" onClick={() => setConfirmDelete(null)}>{t.cancel}</button>
              <button type="button" className="pf-primary danger" onClick={() => doDelete(confirmDelete)}>{t.deleteConfirm}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The page title is DERIVED FROM THE FIRST H1, Notion-style, rather than a separate
 * field. A separate field means students treat the heading as the title and are then
 * confused when the sidebar disagrees with the document.
 */
function deriveTitle(doc) {
  const nodes = doc?.content || [];
  for (const n of nodes) {
    if (n.type === 'heading' && n.attrs?.level === 1) {
      const text = (n.content || []).map((c) => c.text || '').join('').trim();
      if (text) return text.slice(0, 200);
    }
  }
  // Fall back to the first non-empty paragraph so an untitled page still gets a label.
  for (const n of nodes) {
    if (n.type === 'paragraph') {
      const text = (n.content || []).map((c) => c.text || '').join('').trim();
      if (text) return text.slice(0, 80);
    }
  }
  return '';
}

function ToolbarButtons({ editor, t, compact = false }) {
  if (!editor) return null;
  const b = (active, onClick, Icon, label) => (
    <button type="button" className={`mynotes-tool ${active ? 'on' : ''}`} onClick={onClick} title={label} aria-label={label}>
      <Icon size={15} />
    </button>
  );
  return (
    <>
      {b(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold, t.bold)}
      {b(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic, t.italic)}
      {b(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), UnderlineIcon, t.underline)}
      {b(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), Strikethrough, t.strike)}
      {!compact && (
        <>
          <span className="mynotes-tool-sep" />
          {b(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1, t.h1)}
          {b(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2, t.h2)}
          {b(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), Heading3, t.h3)}
          <span className="mynotes-tool-sep" />
          {b(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List, t.bullets)}
          {b(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, t.numbered)}
          {b(editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), ListChecks, t.checklist)}
          <span className="mynotes-tool-sep" />
          {b(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), Code, t.codeBlock)}
          {b(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), Quote, t.quote)}
        </>
      )}
    </>
  );
}
