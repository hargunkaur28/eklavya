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
