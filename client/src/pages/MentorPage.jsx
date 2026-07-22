import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Send, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { translations } from '../data/translations.js';

const AVATAR_SRC = '/chatbot-avatar.png'; // same asset as ChatWidget

// Assistant message body: renders Markdown (so **bold**, lists, etc. format
// properly) and, for a freshly-received reply (animate), reveals it progressively
// like typing. Reloaded history renders fully at once (animate=false). Reveal is
// chunked and scaled to length so long answers still finish in a couple seconds.
function AssistantContent({ content, animate, onTick }) {
  const [shown, setShown] = useState(animate ? '' : content);
  useEffect(() => {
    if (!animate) { setShown(content); return; }
    let i = 0;
    const step = Math.max(4, Math.ceil(content.length / 150));
    const id = setInterval(() => {
      i += step;
      if (i >= content.length) { setShown(content); clearInterval(id); }
      else setShown(content.slice(0, i));
      onTick?.();
    }, 16);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, animate]);
  return <div className="mentor-md"><ReactMarkdown>{shown}</ReactMarkdown></div>;
}

// Track 1 — "Your Mentor": persistent long-form AI tutor. ChatGPT-style layout:
// left = conversation list, right = message thread. Single-shot request pattern
// (matching ChatWidget — POST then render the full reply), student-only.
export default function MentorPage() {
  const { user, authFetch } = useAuth();
  const { language } = useLanguage();
  const t = translations[language]?.dashboard || translations.en.dashboard;

  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const scrollRef = useRef(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  };

  // Load the conversation list on mount, and open the most recent one (if any).
  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await authFetch('/mentor/conversations');
      const data = await res.json().catch(() => ({}));
      const list = data.conversations || [];
      setConversations(list);
      return list;
    } catch {
      setConversations([]);
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [authFetch]);

  const openConversation = useCallback(async (id) => {
    setActiveId(id);
    setError('');
    setLoadingThread(true);
    try {
      const res = await authFetch(`/mentor/conversations/${id}`);
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setMessages(data.messages || []);
      scrollToBottom();
    } catch {
      setMessages([]);
      setError(t.mentorError);
    } finally {
      setLoadingThread(false);
    }
  }, [authFetch, t]);

  useEffect(() => {
    let active = true;
    loadList().then((list) => {
      if (active && list.length > 0) openConversation(list[0].id);
    });
    return () => { active = false; };
  }, [loadList, openConversation]);

  useEffect(scrollToBottom, [messages, sending]);

  const startNewChat = () => {
    setActiveId(null);      // deferred creation — the conversation is created on the first send
    setMessages([]);
    setError('');
    setInput('');
  };

  const deleteConversation = async (id, e) => {
    e?.stopPropagation();
    if (!window.confirm(t.mentorConfirmDelete)) return;
    try {
      await authFetch(`/mentor/conversations/${id}`, { method: 'DELETE' });
    } catch { /* ignore — still drop it from the UI */ }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) { setActiveId(null); setMessages([]); }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setError('');
    setSending(true);
    setInput('');

    // Optimistically show the user's message.
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    scrollToBottom();

    try {
      // Deferred creation: make the conversation on the first message only.
      let convId = activeId;
      if (!convId) {
        const created = await authFetch('/mentor/conversations', { method: 'POST' });
        if (!created.ok) throw new Error('create failed');
        const cdata = await created.json();
        convId = cdata.id;
        setActiveId(convId);
        setConversations((prev) => [{ id: convId, title: '', updatedAt: cdata.updatedAt }, ...prev]);
      }

      const res = await authFetch(`/mentor/conversations/${convId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: text })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'send failed');

      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, animate: true }]);
      // Title arrives on the first exchange → reflect it in the list, and bump to top.
      setConversations((prev) => {
        const updated = prev.map((c) => (c.id === convId ? { ...c, title: data.title || c.title, updatedAt: new Date().toISOString() } : c));
        return [...updated].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });
    } catch (err) {
      setError(err.message || t.mentorError);
      // Roll back the optimistic user message so a retry is clean.
      setMessages((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'user' && m.content === text)));
      setInput(text);
    } finally {
      setSending(false);
      scrollToBottom();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
  };

  // Student-only page (the sidebar entry is student-only; guard direct navigation too).
  if (user && user.role !== 'student') return <Navigate to="/dashboard" replace />;

  const avatar = (cls) => (avatarFailed
    ? <span className={`${cls} mentor-avatar-fallback`}><MessageSquare size={18} /></span>
    : <img className={cls} src={AVATAR_SRC} alt="" onError={() => setAvatarFailed(true)} />);

  const showEmptyThread = !loadingThread && messages.length === 0;

  return (
    <div className="mentor-page">
      {/* Left: conversation list */}
      <aside className="mentor-list">
        <button type="button" className="mentor-new-btn" onClick={startNewChat}>
          <Plus size={16} /> {t.mentorNewChat}
        </button>
        <div className="mentor-convos">
          {loadingList ? (
            <div className="mentor-loading"><Loader2 size={18} className="animate-spin" /></div>
          ) : conversations.length === 0 ? (
            <p className="mentor-empty-list">{t.mentorEmptyList}</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mentor-convo ${c.id === activeId ? 'active' : ''}`}
                onClick={() => openConversation(c.id)}
              >
                <MessageSquare size={15} className="mentor-convo-icon" />
                <span className="mentor-convo-title">{c.title || t.mentorNewChat}</span>
                <span className="mentor-convo-del" role="button" aria-label={t.mentorDelete} onClick={(e) => deleteConversation(c.id, e)}>
                  <Trash2 size={14} />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Right: message thread */}
      <section className="mentor-thread">
        <header className="mentor-thread-head">
          {avatar('mentor-head-avatar')}
          <div>
            <h2>{t.mentor}</h2>
            <p>{t.mentorSubtitle}</p>
          </div>
        </header>

        <div className="mentor-messages" ref={scrollRef}>
          {loadingThread ? (
            <div className="mentor-loading"><Loader2 size={22} className="animate-spin" /></div>
          ) : showEmptyThread ? (
            <div className="mentor-empty-thread">
              {avatar('mentor-empty-avatar')}
              <p>{t.mentorEmptyThread}</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`mentor-msg ${m.role}`}>
                {m.role === 'assistant' && avatar('mentor-msg-avatar')}
                <div className="mentor-bubble">
                  {m.role === 'assistant'
                    ? <AssistantContent content={m.content} animate={m.animate} onTick={scrollToBottom} />
                    : m.content}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="mentor-msg assistant">
              {avatar('mentor-msg-avatar')}
              <div className="mentor-bubble mentor-thinking"><Loader2 size={15} className="animate-spin" /> {t.mentorThinking}</div>
            </div>
          )}
        </div>

        {error && <div className="mentor-error">{error}</div>}

        <form className="mentor-input" onSubmit={sendMessage}>
          <textarea
            rows={1}
            placeholder={t.mentorPlaceholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="submit" className="mentor-send" disabled={!input.trim() || sending} aria-label="Send">
            <Send size={18} />
          </button>
        </form>
      </section>
    </div>
  );
}
