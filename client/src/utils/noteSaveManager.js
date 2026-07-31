// Workstream C — the autosave state machine for My Notes.
//
// Extracted from the component because every bug available here is a data-loss bug,
// and a state machine can be tested without a browser. Six distinct hazards, all in
// the same family — "which page does this operation actually belong to?":
//
//  1. DEBOUNCE RACE. Student types in A, switches to B inside the 2s window. A save
//     scheduled against `currentNoteId` at FIRE time writes A's content into B,
//     destroying both. → the note id is captured at SCHEDULE time and travels with
//     the payload; nothing reads "current" when the timer fires.
//
//  2. STALE IN-FLIGHT RESPONSE. Flushing handles the *scheduled* save; it does not
//     handle one already sent whose response lands after the student is on B. A
//     handler that writes saved/dirty state unconditionally marks B saved on the
//     strength of A's response. → every request is tagged, and a response whose tag
//     is not the active note is discarded.
//
//  3. setContent FIRES onUpdate. Loading page B emits an update, which looks like a
//     user edit and schedules a write of content just read. Redundant at best;
//     combined with (1) it writes B's fresh content into A. → `beginLoad`/`endLoad`
//     suppress scheduling entirely while a load is in progress.
//
//  4. DELETE WHILE PENDING. A flush racing a DELETE either 404s (a visible error for
//     nothing) or resurrects the document. → `cancel(noteId)` drops the pending save
//     and marks in-flight responses for that id as discardable, before the DELETE.
//
//  5. NAVIGATING AWAY. Leaving the Notes section entirely loses the same work as a
//     page switch, and it is the one a student hits by clicking the sidebar.
//     → `flushAll()` for unmount, plus a `beforeunload` hook.
//
//  6. AN UNRESOLVED IMAGE UPLOAD. A document containing a placeholder node must not
//     be persisted (the server rejects it, but a rejected autosave is a visible
//     error for something that is merely not finished yet). → `setBlocked()`.

export const AUTOSAVE_DEBOUNCE_MS = 2000;

export const SAVE_STATE = {
  IDLE: 'idle',
  DIRTY: 'dirty',
  SAVING: 'saving',
  SAVED: 'saved',
  ERROR: 'error'          // a real error state: it must STOP claiming "Saved"
};

/**
 * @param {object} opts
 * @param {(noteId: string, payload: object) => Promise<{ok:boolean, code?:string, warn?:string}>} opts.save
 * @param {(state: object) => void} opts.onState
 * @param {number} [opts.debounceMs]
 */
export function createNoteSaveManager({ save, onState, debounceMs = AUTOSAVE_DEBOUNCE_MS }) {
  let activeNoteId = null;      // the page on screen
  let loading = false;          // suppresses scheduling during setContent
  let blocked = false;          // an image upload is in flight
  let timer = null;
  let pending = null;           // { noteId, payload }
  const cancelled = new Set();  // note ids whose in-flight responses must be dropped
  let inFlight = 0;
  let state = SAVE_STATE.IDLE;
  let lastError = null;
  let lastWarn = null;

  const emit = () => onState?.({ state, error: lastError, warn: lastWarn, pending: !!pending, inFlight });

  const setState = (s, { error = null, warn = undefined } = {}) => {
    state = s;
    lastError = error;
    if (warn !== undefined) lastWarn = warn;
    emit();
  };

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  async function send(noteId, payload) {
    inFlight += 1;
    setState(SAVE_STATE.SAVING);
    let result;
    try {
      result = await save(noteId, payload);
    } catch (err) {
      result = { ok: false, code: err?.code || 'NOTE_SAVE_FAILED' };
    }
    inFlight -= 1;

    // Hazard 2 + 4: a response for a page the student has left, or for a page that
    // was deleted, must not touch the indicator. Otherwise page B shows "Saved"
    // because page A's request came back.
    if (noteId !== activeNoteId || cancelled.has(noteId)) {
      cancelled.delete(noteId);
      emit();
      return result;
    }

    if (result?.ok) setState(SAVE_STATE.SAVED, { warn: result.warn || null });
    // An error must be sticky: the student is typing into a page that has stopped
    // persisting, and the only wrong thing to do is keep saying "Saved".
    else setState(SAVE_STATE.ERROR, { error: result?.code || 'NOTE_SAVE_FAILED' });
    return result;
  }

  return {
    /** Switch pages. Flushes the outgoing page's pending save FIRST. */
    async setActiveNote(noteId) {
      await this.flush();                 // hazard 1: never carry a pending save across
      activeNoteId = noteId;
      lastWarn = null;
      setState(SAVE_STATE.IDLE);
    },

    getActiveNote: () => activeNoteId,
    getState: () => ({ state, error: lastError, warn: lastWarn, pending: !!pending, inFlight }),

    /** Hazard 3: wrap the setContent call so its onUpdate cannot schedule a save. */
    beginLoad() { loading = true; clearTimer(); pending = null; },
    endLoad() { loading = false; },
    isLoading: () => loading,

    /**
     * Hazard 6: suppress autosave while an image upload placeholder is unresolved.
     *
     * On UNBLOCK the pending payload is DROPPED, not re-sent. It was captured while
     * the document still contained the placeholder, so re-scheduling it sends a
     * document the server rejects (`NOTE_UPLOAD_IN_PROGRESS`, 400) — which is exactly
     * what a real paste produced: the save was queued mid-upload and then replayed
     * stale after the swap.
     *
     * Dropping it is safe because resolving an upload MUTATES the document (the
     * placeholder is replaced by an image node, or removed on failure), and that
     * mutation fires onUpdate, which schedules a save with the CURRENT content.
     */
    setBlocked(v) {
      const wasBlocked = blocked;
      blocked = !!v;
      if (blocked) { clearTimer(); return; }
      if (wasBlocked && pending) {
        pending = null;      // stale: it still contains the placeholder
        clearTimer();
        setState(SAVE_STATE.DIRTY);   // the swap's onUpdate will schedule the real save
      }
    },

    /**
     * Schedule a debounced save. `noteId` is captured HERE and travels with the
     * payload — the timer callback never consults the active note.
     */
    schedule(noteId, payload) {
      if (loading || !noteId) return;     // hazard 3
      pending = { noteId, payload };
      setState(SAVE_STATE.DIRTY);
      if (blocked) return;                // hazard 6 — keep it pending, do not send
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        const job = pending;
        pending = null;
        if (job) send(job.noteId, job.payload);
      }, debounceMs);
    },

    /** Send any pending save now. Awaited by page switch, unmount and navigate-away. */
    async flush() {
      clearTimer();
      const job = pending;
      pending = null;
      if (!job || blocked) return null;
      return send(job.noteId, job.payload);
    },

    /** Hazard 5: unmount / beforeunload — same loss as a page switch. */
    async flushAll() { return this.flush(); },

    /**
     * Hazard 4: called BEFORE issuing a DELETE. Drops the pending save for that note
     * and marks any in-flight response for it as discardable, so the flush cannot
     * 404 noisily or resurrect the document.
     */
    cancel(noteId) {
      if (pending?.noteId === noteId) { pending = null; clearTimer(); }
      cancelled.add(noteId);
      if (activeNoteId === noteId) setState(SAVE_STATE.IDLE);
    },

    /** For beforeunload, which cannot await: a synchronous best-effort send. */
    pendingPayload() { return pending; },

    dispose() { clearTimer(); pending = null; }
  };
}
