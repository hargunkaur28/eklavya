// Track 3: additive schema fields for WRITTEN (essay / short-answer) questions,
// shared across all five quiz/attempt sub-schemas (diagnostic, practice, module
// quiz + their stored attempts) so the shape is defined ONCE. Everything defaults
// to MCQ behaviour, so existing documents (which have no `type`) are unaffected —
// no migration needed (same backward-compat pattern as the auth `role` default).

// For a GENERATED question. Written questions carry no options/correctIndex;
// instead they store the grading anchor (expectedPoints) + the weighting profile.
export const writtenQuestionFields = {
  type: { type: String, enum: ['mcq', 'written'], default: 'mcq' },
  expectedPoints: { type: [String], default: [] },
  writtenStyle: { type: String, enum: ['essay', 'short'], default: 'short' }
};

// For a STORED attempt. Copied at grade-time (a snapshot — never a live re-fetch)
// so a revisited review always reflects exactly what was graded, even if the
// question were later regenerated. `writtenOverall` is the weighted 0-100 score;
// `isCorrect` (on the parent schema) is binarised from it against the quiz's
// existing threshold (70% module / 60% diagnostic).
export const writtenAttemptFields = {
  type: { type: String, enum: ['mcq', 'written'], default: 'mcq' },
  // Snapshot the weighting profile used to grade (essay 50/30/20 vs short 80/10/10).
  // Persisted on the ATTEMPT, not just the question, because the diagnostic's source
  // session (which carries writtenStyle) is ephemeral (24h TTL) — a revisited review
  // reads DiagnosticResult independently, so the style couldn't be reconstructed.
  writtenStyle: { type: String, enum: ['essay', 'short'], default: 'short' },
  writtenAnswer: { type: String, default: '' },
  writtenScores: {
    content: { type: Number, default: 0 },
    grammar: { type: Number, default: 0 },
    spelling: { type: Number, default: 0 }
  },
  writtenOverall: { type: Number, default: 0 },
  writtenFeedback: {
    content: { type: String, default: '' },
    grammar: { type: String, default: '' },
    spelling: { type: String, default: '' }
  },
  expectedPoints: { type: [String], default: [] }
};

// ── Cached Hindi for a question (Workstream I) ──────────────────────────────
// These five fields were already declared, character for character, on
// Roadmap.moduleQuiz.questions and on PracticeSession.questions. PyqQuestion is the
// THIRD model to need them, and a third hand-copy is how the set drifts — which has
// already cost this codebase once: `hindiRegisterVersion` was added to some question
// schemas and not others, and translateAndCache's staleness check reads it by name,
// so the register fix silently applied to only part of the app.
//
// The field NAMES matter beyond storage: translateQuestionsArray() returns
// { questionText, options, explanation } and hindiIsStale() reads
// hindiRegisterVersion, so anything that wants the existing translation machinery
// must spell them exactly this way.
//
// The two existing declarations are deliberately left in place rather than
// retrofitted here — that is a migration-shaped change to two live schemas for no
// behavioural gain. This is the canonical copy for anything new.
export const hindiQuestionFields = {
  translatedHindiQuestionText: { type: String, default: '' },
  translatedHindiOptions: { type: [String], default: [] },
  translatedHindiExplanation: { type: String, default: '' },
  hindiTranslated: { type: Boolean, default: false },
  // Intentionally NO default: absent means "translated before the register was
  // versioned", which hindiIsStale() must be able to tell apart from version 0.
  hindiRegisterVersion: { type: Number }
};
