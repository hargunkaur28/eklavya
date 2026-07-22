import { useState } from 'react';
import { FileText, Download, RefreshCw, Loader2, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';

// Track 2 — PDF Notes Generator (inline dashboard panel). Student enters a
// subject + topic, Groq generates structured notes, the student edits them, then
// downloads an ephemeral PDF (streamed — nothing is stored server-side).
export default function NotesGenerator() {
  const { authFetch, activeRoadmap } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [subject, setSubject] = useState(activeRoadmap?.subject || '');
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  // Editable review state (kept as raw strings so editing is smooth).
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState(null); // [{ heading, pointsText }] | null (not generated yet)
  const [keyTermsText, setKeyTermsText] = useState('');

  const generate = async () => {
    setError('');
    if (!topic.trim()) { setError(t.notesNeedTopic); return; }
    setGenerating(true);
    try {
      const res = await authFetch('/notes/generate', {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim(), topic: topic.trim(), grade: activeRoadmap?.grade || '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.notesError);
      const n = data.notes;
      setTitle(n.title || '');
      setSections((n.sections || []).map((s) => ({ heading: s.heading || '', pointsText: (s.points || []).join('\n') })));
      setKeyTermsText((n.keyTerms || []).map((k) => `${k.term}: ${k.definition}`).join('\n'));
    } catch (err) {
      setError(err.message || t.notesError);
    } finally {
      setGenerating(false);
    }
  };

  // Reconstruct the structured notes from the edited fields (server re-clamps too).
  const buildNotes = () => ({
    title: title.trim(),
    subject: subject.trim(),
    topic: topic.trim(),
    sections: (sections || []).map((s) => ({
      heading: s.heading.trim(),
      points: s.pointsText.split('\n').map((p) => p.trim()).filter(Boolean)
    })).filter((s) => s.heading || s.points.length),
    keyTerms: keyTermsText.split('\n').map((line) => {
      const i = line.indexOf(':');
      if (i > 0) return { term: line.slice(0, i).trim(), definition: line.slice(i + 1).trim() };
      return line.trim() ? { term: line.trim(), definition: '' } : null;
    }).filter(Boolean)
  });

  const download = async () => {
    setError('');
    setDownloading(true);
    try {
      const res = await authFetch('/notes/pdf', { method: 'POST', body: JSON.stringify({ notes: buildNotes() }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t.notesError);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(topic.trim() || 'eklavya-notes').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || t.notesError);
    } finally {
      setDownloading(false);
    }
  };

  const updateSection = (i, patch) => setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="notes-panel">
      <header className="notes-head">
        <span className="notes-head-icon"><FileText size={20} /></span>
        <div>
          <h2>{t.notesHeading}</h2>
          <p>{t.notesSubtitle}</p>
        </div>
      </header>

      {language === 'hi' && (
        <div className="notes-english-notice"><Info size={15} /> {t.notesEnglishOnly}</div>
      )}

      <div className="notes-form">
        <div className="notes-field">
          <label>{t.notesSubjectLabel}</label>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
        </div>
        <div className="notes-field">
          <label>{t.notesTopicLabel}</label>
          <input type="text" value={topic} placeholder={t.notesTopicPlaceholder} onChange={(e) => setTopic(e.target.value)} maxLength={120} />
        </div>
        <button type="button" className="notes-generate-btn" onClick={generate} disabled={generating}>
          {generating ? (<><Loader2 size={16} className="animate-spin" /> {t.notesGenerating}</>) : sections ? (<><RefreshCw size={16} /> {t.notesRegenerate}</>) : (<><FileText size={16} /> {t.notesGenerate}</>)}
        </button>
      </div>

      {error && <div className="notes-error">{error}</div>}

      {sections && (
        <div className="notes-review">
          <p className="notes-review-hint">{t.notesReviewHint}</p>

          <div className="notes-field">
            <label>{t.notesTitleLabel}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </div>

          {sections.map((s, i) => (
            <div key={i} className="notes-section-edit">
              <input
                type="text"
                className="notes-section-heading"
                value={s.heading}
                onChange={(e) => updateSection(i, { heading: e.target.value })}
                maxLength={160}
              />
              <textarea
                className="notes-section-points"
                value={s.pointsText}
                onChange={(e) => updateSection(i, { pointsText: e.target.value })}
                rows={Math.min(8, Math.max(3, s.pointsText.split('\n').length))}
              />
              <span className="notes-hint">{t.notesPointsHint}</span>
            </div>
          ))}

          <div className="notes-field">
            <label>{t.notesKeyTerms}</label>
            <textarea
              className="notes-terms"
              value={keyTermsText}
              onChange={(e) => setKeyTermsText(e.target.value)}
              rows={Math.min(10, Math.max(3, keyTermsText.split('\n').length))}
            />
            <span className="notes-hint">{t.notesKeyTermsHint}</span>
          </div>

          <button type="button" className="notes-download-btn" onClick={download} disabled={downloading}>
            {downloading ? (<><Loader2 size={16} className="animate-spin" /> {t.notesDownloading}</>) : (<><Download size={16} /> {t.notesDownload}</>)}
          </button>
        </div>
      )}
    </div>
  );
}
