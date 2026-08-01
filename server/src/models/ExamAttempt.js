import mongoose from 'mongoose';

// Workstream I — one student's sitting of one paper.
//
// ── THE TIMER IS SERVER STATE, NOT CLIENT STATE ─────────────────────────────
//
// Only `startedAt` and `durationSeconds` are stored. Remaining time is COMPUTED from
// them on every request and is never written down, because any stored "remaining"
// value is a number that stops decreasing the moment the client stops reporting —
// which is precisely the case that has to work: the tab was closed.
//
// Consequences, all deliberate:
//   • Closing the tab does not pause anything. A real exam does not pause.
//   • Reconnecting shows true remaining time, because it is derived from a timestamp
//     the client never touched.
//   • A client with a wrong clock, or an edited one, changes nothing. It displays
//     what the server computes.
//   • Answers arriving after the deadline are rejected server-side, so a submission
//     replayed later cannot land.
//
// `status` is 'in_progress' until it is finalised; `submitted` (the student ended it)
// and `expired` (time ran out) are kept apart because they mean different things to a
// student reading their own results, even though both are final and both score the
// same answers.

const examAnswerSchema = new mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PyqQuestion', required: true },
  sectionName: { type: String, default: '' },
  selectedIndex: { type: Number, default: null },   // MCQ
  writtenAnswer: { type: String, default: '' },     // non-MCQ
  // Stamped server-side on each save. Feeds the per-section time breakdown in
  // results, and is the audit trail for a late-submission rejection.
  answeredAt: { type: Date, default: Date.now }
}, { _id: false });

const sectionScoreSchema = new mongoose.Schema({
  name: { type: String, required: true },
  marksAwarded: { type: Number, default: 0 },
  marksAvailable: { type: Number, default: 0 },
  questionsAttempted: { type: Number, default: 0 },
  questionsTotal: { type: Number, default: 0 },
  // Wall-clock seconds between the first and last answer stamped in this section.
  // A lower bound on time spent, not a measurement — a student who reads a section
  // and answers nothing registers zero. Labelled as approximate in the UI for that
  // reason rather than presented as a stopwatch.
  secondsSpent: { type: Number, default: 0 }
}, { _id: false });

const examAttemptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // A real-paper attempt points at the paper. A generated exam-style attempt points
  // at nothing and carries its blueprint key instead — the same two-source split as
  // PyqQuestion, for the same reason: results must never claim to be a past paper.
  paperId: { type: mongoose.Schema.Types.ObjectId, ref: 'PastPaper', default: null },
  source: { type: String, enum: ['pyq', 'generated'], required: true, default: undefined },
  blueprintKey: { type: String, default: '' },      // 'Class 8|CBSE|Science'

  // Snapshot of the question order for THIS attempt. Stored so a resume returns the
  // same paper in the same order, and so a later re-parse of the source paper cannot
  // change an exam a student is halfway through.
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PyqQuestion' }],

  startedAt: { type: Date, required: true, default: Date.now },
  durationSeconds: { type: Number, required: true },

  // ── Pause ────────────────────────────────────────────────────────────────
  // Added deliberately: this is a LEARNING app, not an exam hall. A student who has
  // to stop for dinner should not lose the paper, and refusing that only teaches
  // them not to start one.
  //
  // Pause is SERVER state, for the same reason the clock is. A client-side pause
  // would be a flag the server never sees — the deadline would keep advancing and
  // the student would come back to a clock that ignored their pause, or, if the
  // server trusted the client's elapsed time, to a timer they could stop by
  // tampering. Neither is acceptable, so both live here.
  //
  //   `pausedAt`  — when the CURRENT pause began, or null when running.
  //   `pausedMs`  — total time already spent paused across previous pauses.
  //
  // Remaining time is still computed, never stored: elapsed is wall-clock since
  // `startedAt` MINUS everything spent paused. So closing the tab while paused keeps
  // it paused, and closing it while running keeps it running.
  pausedAt: { type: Date, default: null },
  pausedMs: { type: Number, default: 0 },
  // How many times the student stopped the clock. Kept ALONGSIDE the duration
  // because they say different things: 41 minutes over one break is a meal, and 41
  // minutes over twelve breaks is a different way of sitting the paper. Both are
  // shown in the results so a strong score achieved with heavy pausing is visibly
  // not a straight three-hour performance — to the student, who is the person
  // entitled to know.
  pauseCount: { type: Number, default: 0 },

  answers: [examAnswerSchema],

  status: {
    type: String,
    enum: ['in_progress', 'submitted', 'expired'],
    required: true,
    default: 'in_progress'
  },
  finalisedAt: { type: Date, default: null },

  sectionScores: [sectionScoreSchema],
  marksAwarded: { type: Number, default: 0 },
  marksAvailable: { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

// "Does this student already have an attempt open on this paper?" — asked before
// every start, to enforce one active attempt per paper.
examAttemptSchema.index({ userId: 1, paperId: 1, status: 1 });

/** Is this attempt currently paused? */
export function isPaused(attempt) {
  return !!attempt.pausedAt;
}

/**
 * Milliseconds this attempt has spent paused, INCLUDING a pause still in progress.
 * The single place the two pause fields are combined — every other calculation goes
 * through this rather than re-deriving it, which is what stops one caller counting
 * the open pause and another forgetting it.
 */
export function totalPausedMs(attempt, now = Date.now()) {
  const open = attempt.pausedAt ? Math.max(0, now - new Date(attempt.pausedAt).getTime()) : 0;
  return (attempt.pausedMs || 0) + open;
}

/**
 * Unix ms at which this attempt expires. The deadline SLIDES with paused time — it
 * is no longer a pure function of `startedAt`, because a paused clock has to push
 * the end of the paper out by exactly as much as it stood still.
 */
export function deadlineOf(attempt, now = Date.now()) {
  return new Date(attempt.startedAt).getTime()
    + attempt.durationSeconds * 1000
    + totalPausedMs(attempt, now);
}

/**
 * Whole seconds left, floored at 0. The ONLY source of remaining time anywhere in
 * the app — the client renders this number and never derives its own, so a hidden
 * tab, a throttled timer and a wrong system clock are all incapable of affecting it.
 *
 * While paused this is CONSTANT: the open pause grows the deadline at exactly the
 * rate wall-clock advances, so the difference stops changing. That is the property
 * that makes pause safe to implement by sliding the deadline rather than by freezing
 * a stored countdown — there is still no number being decremented anywhere.
 */
export function secondsRemaining(attempt, now = Date.now()) {
  return Math.max(0, Math.ceil((deadlineOf(attempt, now) - now) / 1000));
}

/**
 * Has the clock run out? Independent of `status`, which lags until a write.
 * A PAUSED attempt never expires — that is the whole point of pausing.
 */
export function isExpired(attempt, now = Date.now()) {
  if (isPaused(attempt)) return false;
  return now >= deadlineOf(attempt, now);
}

export default mongoose.model('ExamAttempt', examAttemptSchema);
