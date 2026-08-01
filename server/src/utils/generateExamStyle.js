// Workstream I6 — generate EXAM-STYLE questions for grades that have no board exam.
//
// Everything this file produces is `source: 'generated'`. It carries no year, no
// board and no paper, it is never labelled a past paper, and it never will be — the
// schema refuses those fields on a generated question and CI refuses any code here
// from writing source: 'pyq'. This module cannot mint a counterfeit past paper even
// if a future caller asks it to.

import { callOpenAIChat, callGroqChat } from './groqClient.js';
import { subjectScopeLabel } from '../config/taxonomy.js';

// ── OPENAI, PER THE WORKSTREAM RULE — but a cheaper tier than the parse ─────
//
// Workstream I routes every model call to OpenAI rather than Groq, and this path
// follows that. It uses a cheaper model than PYQ_MODEL deliberately, and the reason
// is worth writing down because it is the ONE place where the workstream's stated
// rationale does not fully transfer:
//
//   The parse argument rests on low volume — import is a one-off admin action, a few
//   dozen papers ever. THAT IS NOT TRUE HERE. Generating an exam-style paper is a
//   per-student, per-session runtime cost, which is the same shape as every other
//   generation path in this app, and those all run on the Groq chain.
//
//   What still holds is the quality argument, in weaker form: this output is shown to
//   a student as a rehearsal of an exam, so it should not come off the 8b tier. The
//   resolution is OpenAI (as instructed) at the cheap tier, which is the same model
//   the app-wide chain already falls back to — so this is not more expensive than the
//   existing fallback, only more predictable.
//
// If this path ever becomes hot, the honest fix is to revisit the volume assumption
// here specifically, NOT to move the parse back onto Groq. They are different calls
// with different consequences: a bad generated question wastes a student's time, a
// bad parse is cached as ground truth.
export const PYQ_GENERATION_MODEL = 'gpt-4o-mini';

const GENERATION_STAGES = {
  CALL: 'EXAMSTYLE_GENERATION_CALL_FAILED',
  JSON: 'EXAMSTYLE_GENERATION_INVALID_JSON',
  EMPTY: 'EXAMSTYLE_GENERATION_RETURNED_NOTHING'
};

/**
 * Generate the questions for ONE section of a blueprint.
 *
 * Per-section rather than whole-paper: a 39-question paper in one call is a long
 * generation that truncates mid-JSON (the failure DIAGRAM_MODEL's token cap exists
 * for), and section-at-a-time means a single bad section can be regenerated without
 * discarding the paper.
 */
async function generateSection({ grade, subject, subSubject, section, topics }) {
  const scope = subjectScopeLabel(subject, subSubject);
  const topicLine = topics?.length
    ? `Focus on these topics: ${topics.join(', ')}.`
    : 'Cover a representative spread of the year\'s syllabus.';

  const prompt = `Write ${section.questionCount} examination questions for a student in ${grade} studying ${scope}.

These are for "${section.name}" of an exam-style practice paper. ${section.instruction}
Each question is worth ${section.marksPerQuestion} mark(s), so pitch the depth to that weight: a 1-mark question is a single recall or one-step application, a 5-mark question has several parts and expects working.
${topicLine}

${section.marksPerQuestion === 1
    ? 'Every question must be multiple choice with exactly 4 options and one correct answer.'
    : 'These are written-answer questions. Do NOT provide options. Give a model answer instead.'}

Return ONLY valid JSON:
{"questions":[{"questionText":"...","options":${section.marksPerQuestion === 1 ? '["A","B","C","D"]' : '[]'},"correctIndex":${section.marksPerQuestion === 1 ? '0' : 'null'},"correctAnswer":"${section.marksPerQuestion === 1 ? '' : 'model answer'}","explanation":"why the answer is right"}]}

Exactly ${section.questionCount} questions. ACCURACY IS CRITICAL: verify every fact and that correctIndex points to the genuinely correct option. No markdown.`;

  const messages = [{ role: 'user', content: prompt }];

  let raw = null;
  try {
    raw = await callOpenAIChat(messages, {
      model: PYQ_GENERATION_MODEL, temperature: 0.7, jsonMode: true, maxTokens: 4000
    });
  } catch (err) {
    console.warn(`Exam-style [${GENERATION_STAGES.CALL}]:`, err.message);
  }

  // Availability fallback only, exactly as for the parse.
  if (!raw) {
    try {
      raw = await callGroqChat(messages, { jsonMode: true, temperature: 0.7, maxTokens: 4000 });
    } catch (err) {
      console.warn(`Exam-style [${GENERATION_STAGES.CALL}] fallback:`, err.message);
      return [];
    }
  }
  if (!raw) return [];

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.warn(`Exam-style [${GENERATION_STAGES.JSON}]:`, err.message);
    return [];
  }

  const out = [];
  for (const q of Array.isArray(data.questions) ? data.questions : []) {
    const questionText = String(q.questionText ?? '').trim();
    if (!questionText) continue;
    const options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string' && o.trim()) : [];
    out.push({
      // The ONLY source value this file can produce. There is no branch here that
      // sets 'pyq', and CI asserts there never will be.
      source: 'generated',
      // year / board / paperId are NOT set — the schema refuses them on a generated
      // question, so an accidental addition fails at save rather than shipping.
      sectionName: section.name,
      questionNumber: String(out.length + 1),
      marks: section.marksPerQuestion,
      questionText,
      options,
      correctIndex: Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < options.length
        ? q.correctIndex : null,
      correctAnswer: String(q.correctAnswer ?? '').trim(),
      explanation: String(q.explanation ?? '').trim()
    });
  }
  return out.slice(0, section.questionCount);
}

/**
 * Build a whole exam-style paper from a blueprint.
 * Returns { questions, sections, shortfall } — `shortfall` names any section the
 * generator under-filled, so the UI can say the paper is short rather than quietly
 * presenting a 31-question paper as the 39-question one it claims to be.
 */
export async function generateExamStylePaper({ grade, subject, subSubject, blueprint, topics }) {
  const questions = [];
  const shortfall = [];

  for (const section of blueprint.sections) {
    // A section is either uniform or MIXED. Real Class 10 Science is mixed: each
    // discipline section runs from 1-mark MCQs to a 5-mark long answer, so asking
    // for "13 questions of N marks" would produce a paper that is the right length
    // and the wrong shape. A mixed section is generated one marks-tier at a time,
    // which also keeps the depth instruction in the prompt honest — the prompt tells
    // the model to pitch depth to the mark value, and that only works if a single
    // call has a single mark value.
    const tiers = Array.isArray(section.marksMix) && section.marksMix.length
      ? section.marksMix.map((m) => ({
        ...section,
        questionCount: m.count,
        marksPerQuestion: m.marks
      }))
      : [section];

    let got = 0;
    let want = 0;
    for (const tier of tiers) {
      want += tier.questionCount;
      const produced = await generateSection({ grade, subject, subSubject, section: tier, topics });
      // Renumber within the SECTION, not the tier, so a mixed section still reads
      // 1..13 rather than restarting at 1 for every marks tier.
      for (const q of produced) {
        got += 1;
        questions.push({ ...q, sectionName: section.name, questionNumber: String(got) });
      }
    }

    if (got < want) shortfall.push({ section: section.name, expected: want, got });
  }

  if (!questions.length) throw new Error(GENERATION_STAGES.EMPTY);
  return { questions, sections: blueprint.sections, shortfall };
}

/** A practice-mode set (no sections, no timer) for a non-board grade. */
export async function generateExamStylePractice({ grade, subject, subSubject, topics, count }) {
  const section = {
    name: 'Practice',
    instruction: 'Exam-style practice questions.',
    questionCount: count,
    marksPerQuestion: 1
  };
  const questions = await generateSection({ grade, subject, subSubject, section, topics });
  if (!questions.length) throw new Error(GENERATION_STAGES.EMPTY);
  return questions;
}

export { GENERATION_STAGES };
