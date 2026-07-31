// Workstream B5 — the step map for the profile onboarding flow.
//
// Extracted from the component because it carries real logic: when the FINAL PATCH
// returns a field-level error, the student is standing on the last step and the
// error may be about step 1. Rendering it where they are standing is unactionable —
// they can read "Age must be between 5 and 25" and not see the age input.
//
// So server errors are routed BACK to the step that owns the field, and the student
// lands on the earliest offending one (fixing in flow order rather than being
// bounced around). Client-side validation catches most of this first, but the
// server is authoritative and its errors have to land somewhere actionable.

export const STEPS = [
  { id: 'age', fields: ['age'] },
  { id: 'board', fields: ['studyMedium'] },
  { id: 'family', fields: ['fatherName'] },
  { id: 'school', fields: ['schoolName', 'schoolCity'] },
  { id: 'optional', fields: ['phoneNumber', 'location', 'aadhaarNumber'] }
];

export const TOTAL_STEPS = STEPS.length;

/** Which step owns a given field? -1 if the field is not on any step. */
export function stepForField(field) {
  return STEPS.findIndex((s) => s.fields.includes(field));
}

/**
 * Given the server's `fields` map of { fieldName: CODE }, return the index of the
 * EARLIEST step with an error — the one to jump to. Returns -1 when the errors do
 * not correspond to any step (e.g. a bare PROFILE_SAVE_FAILED), in which case the
 * caller keeps the student where they are and shows a form-level message.
 */
export function firstOffendingStep(fields) {
  if (!fields || typeof fields !== 'object') return -1;
  const indices = Object.keys(fields)
    .map(stepForField)
    .filter((i) => i >= 0);
  return indices.length ? Math.min(...indices) : -1;
}

/** Compulsory fields, per step — used for client-side gating before submit. */
export function requiredFieldsUpTo(stepIndex) {
  return STEPS.slice(0, stepIndex + 1)
    .flatMap((s) => s.fields)
    .filter((f) => !['phoneNumber', 'location', 'aadhaarNumber'].includes(f));
}
