import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext.jsx';
import { scrollToTop } from '../utils/scrollToTop.js';
import { translations } from '../data/translations.js';
import { Loader2, Upload, CheckCircle2, AlertTriangle, Trash2, Image as ImageIcon, Eye } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { imageFilesFrom } from '../utils/noteImagePaste.js';
import { BOARDS, GRADES, SUBJECTS } from '../data/taxonomy.js';

/** Group OR alternatives together, preserving paper order. */
function groupAlternatives(questions) {
  const groups = [];
  const byKey = new Map();
  for (const q of questions) {
    const key = q.choiceGroup || q._id;
    if (!byKey.has(key)) { const g = []; byKey.set(key, g); groups.push(g); }
    byKey.get(key).push(q);
  }
  groups.forEach((g) => g.sort((a, b) => (a.choiceIndex || 0) - (b.choiceIndex || 0)));
  return groups;
}

// Workstream I3 — the admin's import + review console.
//
// ── THE REVIEW STEP IS THE POINT OF THIS SCREEN ─────────────────────────────
//
// Automatic parsing of exam PDFs is unreliable: layout varies between boards and
// years, multi-column pages break reading order, marks land in margins, and
// automatic figure-region detection gets some wrong. None of that is visible from
// the parsed output alone — a wrong parse looks exactly like a right one.
//
// So nothing here is read-only. Every field the model guessed is editable, every
// figure is re-croppable, and the paper cannot be published while a question that
// references a figure has no figure attached.
//
// Only Class 10 and Class 12 appear in the grade picker: those are the grades with
// board exams, so they are the only grades for which a "past paper" can exist.
const BOARD_EXAM_GRADES = ['Class 10', 'Class 12'];

export default function PyqAdminPanel() {
  const { authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.admin || translations.en.admin;
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState('');
  const [loadError, setLoadError] = useState('');

  // ── A FAILED REQUEST IS NOT AN EMPTY LIST ────────────────────────────────
  // This used to be `setPapers(d.papers || [])` with no status check, so ANY
  // failure — 404, 401, 500 — rendered as "No papers imported yet."
  //
  // That is a false statement about content, and it cost real diagnosis time: a
  // paper had been imported successfully and the console reported that nothing had
  // been. The admin's next move on "no papers imported" is to re-import; the right
  // move on "could not reach the server" is entirely different. Conflating them
  // sends someone to debug the import pipeline when the pipeline is fine.
  //
  // Same family as the empty-corpus rule on the student side: absence of data and
  // failure to load are different states and must never render identically.
  const refresh = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await authFetch('/pyq-admin/papers');
      if (!res.ok) {
        // 404 specifically means the route is missing, which in practice means the
        // running server predates this feature. Naming that is worth more than a
        // generic failure, because it is the likeliest cause and the fix is trivial.
        setLoadError(res.status === 404
          ? 'Could not reach the import API (404). The running server may predate this feature — restart it.'
          : `Could not load papers (HTTP ${res.status}).`);
        setPapers([]);
        return;
      }
      const d = await res.json();
      setPapers(d.papers || []);
    } catch (err) {
      setLoadError(`Could not load papers: ${err.message}`);
      setPapers([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  if (selected) {
    return <PaperReview paperId={selected} onBack={() => { setSelected(null); refresh(); scrollToTop(); }} />;
  }

  return (
    <div className="pyq-admin">
      <h3>{t.importHeading}</h3>
      <UploadForm onDone={(m) => { setMsg(m); refresh(); }} />
      {msg && <p className="pyq-admin-msg">{msg}</p>}

      <h4>{t.importedPapers}</h4>
      {loadError && (
        <div className="pyq-admin-warn">
          <AlertTriangle size={16} />
          {loadError}
        </div>
      )}
      {loading ? <Loader2 className="animate-spin" size={18} /> : (
        <table className="pyq-admin-table">
          <thead>
            <tr><th>{t.fYear}</th><th>{t.fBoard}</th><th>{t.fGrade}</th><th>{t.fSubject}</th><th>{t.fTitle}</th><th>Qs</th><th>{t.fStatus}</th><th /></tr>
          </thead>
          <tbody>
            {papers.map((p) => (
              <tr key={p._id}>
                <td>{p.year}</td><td>{p.board}</td><td>{p.grade}</td><td>{p.subject}</td>
                <td>{p.title}</td><td>{p.questionCount}</td>
                <td>
                  <span className={`pyq-status pyq-status-${p.parseStatus}`}>{p.parseStatus}</span>
                  {/* A fallback parse came off the weaker text-only substrate. The
                      admin is trusting this parse, so they are told when it needs a
                      harder look rather than discovering it from bad rows. */}
                  {p.parsedByFallback && (
                    <span className="pyq-fallback-warn" title={t.groqFallbackHint}>
                      <AlertTriangle size={13} /> fallback
                    </span>
                  )}
                  {p.publishedWithWarnings?.length > 0 && (
                    <span className="pyq-fallback-warn" title={t.publishedWithIssuesHint}>
                      <AlertTriangle size={13} /> known issues
                    </span>
                  )}
                  {p.parseError && <span className="pyq-parse-error">{p.parseError}</span>}
                </td>
                <td><button className="ghost-button" onClick={() => { setSelected(p._id); scrollToTop(); }}><Eye size={14} /> Review</button></td>
              </tr>
            ))}
            {/* Only claim "none imported" when the request actually SUCCEEDED and
                came back empty. On a failure the error above says so instead. */}
            {!papers.length && !loadError && <tr><td colSpan={8}>{t.noPapersYet}</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UploadForm({ onDone }) {
  const { authFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ board: BOARDS[0], grade: 'Class 10', subject: 'Maths', year: '', title: '' });
  const fileRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return onDone(t.choosePdfFirst);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      const res = await authFetch('/pyq-admin/papers', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) return onDone(`Import failed: ${d.error}`);
      const notes = [];
      if (d.parsedByFallback) notes.push('PARSED BY FALLBACK — review carefully');
      if (d.failedPages?.length) notes.push(`${d.failedPages.length} page(s) failed to parse`);
      if (d.truncated) notes.push('paper was truncated at the page cap');
      onDone(`Imported ${d.questionCount} questions as a DRAFT. ${notes.join('. ')}`);
    } catch (err) {
      onDone(`Import failed: ${err.message}`);
    } finally { setBusy(false); }
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form className="pyq-admin-upload" onSubmit={submit}>
      <select value={form.board} onChange={(e) => set({ board: e.target.value })}>
        {BOARDS.map((b) => <option key={b}>{b}</option>)}
      </select>
      <select value={form.grade} onChange={(e) => set({ grade: e.target.value })}>
        {GRADES.filter((g) => BOARD_EXAM_GRADES.includes(g)).map((g) => <option key={g}>{g}</option>)}
      </select>
      <select value={form.subject} onChange={(e) => set({ subject: e.target.value })}>
        {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
      </select>
      <input type="number" placeholder={t.phYear} value={form.year} onChange={(e) => set({ year: e.target.value })} required />
      <input type="text" placeholder={t.phTitle} value={form.title}
        onChange={(e) => set({ title: e.target.value })} required />
      <input type="file" accept="application/pdf" ref={fileRef} required />
      <button className="primary-button" disabled={busy}>
        {busy ? <><Loader2 size={15} className="animate-spin" /> Parsing…</> : <><Upload size={15} /> Import</>}
      </button>
      {busy && <span className="pyq-admin-hint">One vision call per page — a 30-page paper takes a few minutes.</span>}
    </form>
  );
}

function PaperReview({ paperId, onBack }) {
  const { authFetch } = useAuth();
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingWarnings, setPendingWarnings] = useState(null);

  const load = async () => {
    const res = await authFetch(`/pyq-admin/papers/${paperId}`);
    setData(await res.json());
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [paperId]);

  // Publish is a two-step when anything is outstanding: the first attempt comes back
  // with warnings, they go in front of the admin, and a confirmed retry goes through.
  // Deliberately NOT window.confirm() — the warnings name specific question numbers
  // and a native dialog cannot show them usefully.
  const publish = async (confirmed = false) => {
    setBusy(true);
    try {
      const res = await authFetch(`/pyq-admin/papers/${paperId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ confirm: confirmed })
      });
      const d = await res.json();

      if (res.status === 409 && d.requiresConfirmation) {
        setPendingWarnings(d.warnings || []);
        return;
      }
      if (!res.ok) {
        setMsg(`Cannot publish — ${d.error}`);
        return;
      }
      setPendingWarnings(null);
      setMsg((d.publishedWithWarnings || []).length
        ? 'Published with known issues — see the badge on this paper. Students can see it now.'
        : t.publishedOk);
      load();
    } finally { setBusy(false); }
  };

  if (!data) return <div className="pyq-admin"><Loader2 className="animate-spin" size={18} /></div>;

  return (
    <div className="pyq-admin">
      <button className="ghost-button" onClick={onBack}>← Back</button>
      <h3>{data.paper.year} — {data.paper.title}</h3>
      <p>{data.paper.board} · {data.paper.grade} · {data.paper.subject} · {data.paper.totalMarks} marks · {data.paper.durationMinutes} min</p>

      {data.paper.parsedByFallback && (
        <div className="pyq-admin-warn">
          <AlertTriangle size={16} />
          This paper was parsed by the <strong>{t.groqFallback}</strong>, not the vision model.
          Structure (sections, figure placement, marks in margins) is much more likely to be wrong. Check every row.
        </div>
      )}

      {data.blockers.length > 0 && (
        <div className="pyq-admin-warn">
          <AlertTriangle size={16} />
          {data.blockers.length} question(s) reference a figure that is not attached. Publishing is still
          possible — you will be asked to confirm — but a student will see &quot;in the figure below&quot;
          with no figure: Q{data.blockers.map((b) => b.questionNumber).join(', Q')}
        </div>
      )}

      {/* A paper that WAS published past its warnings says so, permanently, so it
          does not become indistinguishable from a clean one. */}
      {data.paper.publishedWithWarnings?.length > 0 && (
        <div className="pyq-admin-warn">
          <AlertTriangle size={16} />
          Published with known issues:{' '}
          {data.paper.publishedWithWarnings.map((w) => `${w.code} (Q${w.questionNumbers.join(', Q')})`).join('; ')}
        </div>
      )}

      <button className="primary-button" onClick={() => publish(false)} disabled={busy}>
        <CheckCircle2 size={15} /> {data.paper.parseStatus === 'published' ? t.rePublish : 'Publish'}
      </button>
      {msg && <p className="pyq-admin-msg">{msg}</p>}

      {/* ── The confirmation pop-up ──────────────────────────────────────────
          Shows exactly what is unresolved and which questions, so "publish anyway"
          is an informed choice rather than a shrug past a generic warning. */}
      {pendingWarnings && (
        <div className="narration-prompt-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="narration-prompt-card pyq-warn-card">
            <div className="narration-prompt-icon"><AlertTriangle size={26} /></div>
            <h3 className="narration-prompt-title">{t.publishWithIssues}</h3>

            {pendingWarnings.map((w) => (
              <div key={w.code} className={`pyq-warn-item sev-${w.severity}`}>
                <strong>{w.severity === 'high' ? t.warnBrokenQuestion : t.warnReadAloud}</strong>
                <p>{w.message}</p>
                <p className="pyq-warn-qs">Q{w.questionNumbers.join(', Q')}</p>
              </div>
            ))}

            <p className="pyq-warn-note">
              This will be recorded on the paper so you can come back to it.
            </p>

            <button className="primary-button" onClick={() => publish(true)} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : null} Publish anyway
            </button>
            <button className="narration-prompt-skip" onClick={() => setPendingWarnings(null)} disabled={busy}>
              Go back and fix them
            </button>
          </div>
        </div>
      )}

      {/* OR alternatives are shown as ONE visibly paired group, because that is what
          they are — two halves of a single question the student chooses between. Two
          adjacent independent-looking rows with the same number reads as a duplicate
          the admin should delete, which is precisely the wrong action. */}
      {groupAlternatives(data.questions).map((group) => (
        group.length === 1
          ? <QuestionEditor key={group[0]._id} q={group[0]} onSaved={load} />
          : (
            <div className="pyq-admin-choice-group" key={group[0].choiceGroup}>
              <div className="pyq-admin-choice-head">
                Q{group[0].questionNumber} — internal choice, student attempts ONE
              </div>
              {group.map((alt, i) => (
                <div key={alt._id}>
                  {i > 0 && <div className="pyq-or-divider"><span>OR</span></div>}
                  <QuestionEditor q={alt} onSaved={load} />
                </div>
              ))}
            </div>
          )
      ))}
    </div>
  );
}

function QuestionEditor({ q, onSaved }) {
  const { authFetch } = useAuth();
  const [draft, setDraft] = useState(q);
  const [busy, setBusy] = useState(false);
  const [figureBusy, setFigureBusy] = useState(false);
  const [figureError, setFigureError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Reuses My Notes' clipboard/drop extraction — the same allowed-type filter and
  // the same handling of the two ways browsers expose a pasted image. Not reimplemented.
  const onImage = (dataTransfer) => {
    const [file] = imageFilesFrom(dataTransfer);
    if (file) uploadFigure(file);
  };

  const uploadFigure = async (file) => {
    setFigureBusy(true);
    setFigureError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await authFetch(`/pyq-admin/questions/${q._id}/figure`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) { setFigureError(d.error || t.uploadFailed); return; }
      setDraft(d.question);
      onSaved();
    } catch (err) {
      setFigureError(err.message);
    } finally { setFigureBusy(false); }
  };

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const res = await authFetch(`/pyq-admin/questions/${q._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          questionText: draft.questionText, sectionName: draft.sectionName,
          questionNumber: draft.questionNumber, marks: draft.marks,
          options: draft.options, correctIndex: draft.correctIndex,
          correctAnswer: draft.correctAnswer, explanation: draft.explanation,
          figureExpected: draft.figureExpected, diagramAlt: draft.diagramAlt,
          ...extra
        })
      });
      if (res.ok) { const d = await res.json(); setDraft(d.question); onSaved(); }
    } finally { setBusy(false); }
  };

  const blocked = q.figureExpected && !q.diagramUrl;

  return (
    <div className={`pyq-admin-q ${blocked ? 'blocked' : ''}`}>
      <div className="pyq-admin-q-head">
        <input className="pyq-admin-qnum" value={draft.questionNumber}
          onChange={(e) => set({ questionNumber: e.target.value })} />
        <input className="pyq-admin-section" value={draft.sectionName}
          onChange={(e) => set({ sectionName: e.target.value })} />
        <input className="pyq-admin-marks" type="number" value={draft.marks}
          onChange={(e) => set({ marks: Number(e.target.value) })} />
        {blocked && <span className="pyq-admin-blocked"><AlertTriangle size={13} /> figure missing — blocks publish</span>}
      </div>

      {/* Grows to fit. A fixed 3-row box put a multi-part question behind an inner
          scrollbar, which is unreadable exactly where reading matters most — an
          admin cannot verify a transcription they have to scroll a 3-line window
          through. `field-sizing` handles it natively where supported; the rows
          fallback covers the rest. */}
      <textarea
        className="pyq-admin-qtext"
        rows={Math.min(24, Math.max(3, Math.ceil((draft.questionText || '').length / 90) + (draft.questionText || '').split('\n').length))}
        value={draft.questionText}
        onChange={(e) => set({ questionText: e.target.value })}
      />

      {draft.options?.length > 0 && draft.options.map((o, i) => (
        <div className="pyq-admin-opt" key={i}>
          <input type="radio" name={`correct-${q._id}`} checked={draft.correctIndex === i}
            onChange={() => set({ correctIndex: i })} />
          <input value={o} onChange={(e) => {
            const next = [...draft.options]; next[i] = e.target.value; set({ options: next });
          }} />
        </div>
      ))}

      <label className="pyq-admin-check">
        <input type="checkbox" checked={!!draft.figureExpected}
          onChange={(e) => set({ figureExpected: e.target.checked })} />
        This question refers to a figure
      </label>

      {/* ── Figure ────────────────────────────────────────────────────────
          Extracted from the PDF's own embedded image object, so the figure itself is
          exact — the only thing that can be wrong is which question it landed on.
          Shown large enough to judge that at a glance, which a 320px thumbnail was
          not. */}
      <div
        className={`pyq-admin-figure ${dragOver ? 'drop-target' : ''}`}
        onPaste={(e) => onImage(e.clipboardData)}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onImage(e.dataTransfer); }}
        tabIndex={0}
      >
        {draft.diagramUrl ? (
          <img src={draft.diagramUrl} alt="" />
        ) : (
          <p className="pyq-admin-hint">
            {draft.figureExpected
              ? 'This question refers to a figure and none was attached — publish is blocked until one is.'
              : t.noFigure}
          </p>
        )}

        {/* Paste or pick. The admin snips the region with the OS screenshot tool;
            no crop editor to build, and the auto-attached figure stays the default
            so a correct one needs no action at all. */}
        <div className="pyq-admin-figure-actions">
          <span className="pyq-admin-hint">
            {figureBusy ? t.uploading : t.pasteFigureHint}
          </span>
          <input
            type="file" accept="image/png,image/jpeg,image/webp"
            onChange={(e) => { if (e.target.files?.[0]) uploadFigure(e.target.files[0]); }}
            disabled={figureBusy}
          />
          {draft.diagramUrl && (
            <button className="ghost-button" onClick={() => save({ clearFigure: true })}>{t.removeFigure}</button>
          )}
        </div>
        {figureError && <p className="pyq-admin-figure-error">{figureError}</p>}

        {/* The source page, so the admin can confirm the assignment and snip from it. */}
        {draft.sourcePageUrl && (
          <details className="pyq-admin-crop">
            <summary><ImageIcon size={13} /> Source page</summary>
            <img className="pyq-admin-sourcepage" src={draft.sourcePageUrl} alt="" />
          </details>
        )}

        {draft.diagramUrl && (
          /* Alt text is typed by the admin, never generated. Read-aloud depends on
             it, and an invented description of a real exam figure is worse than
             none — so publish is blocked until this is filled in. */
          <input
            placeholder={t.phAltText}
            value={draft.diagramAlt || ''}
            onChange={(e) => set({ diagramAlt: e.target.value })}
          />
        )}
      </div>


      <div className="pyq-admin-q-actions">
        <button className="primary-button" onClick={() => save()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Save
        </button>
        <button className="ghost-button" onClick={async () => {
          await authFetch(`/pyq-admin/questions/${q._id}`, { method: 'DELETE' });
          onSaved();
        }}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  );
}
