import { callGroqChat } from './groqClient.js';

// Track 3: grade a written (essay / short-answer) response. Scores content,
// grammar, spelling (0-100 each) and computes the weighted overall per the
// question's style. Returns sub-scores + overall + per-criterion feedback.
//
// Binarisation (isCorrect = overall >= threshold) is done by the CALLER, since the
// threshold differs by context (70% module quiz / 60% diagnostic; practice uses a
// lenient revision threshold). This helper NEVER throws — it short-circuits blank
// answers (no Groq call) and degrades to a 0-score with a note on any failure,
// matching the defensive posture used elsewhere in the project.
//
// ACCEPTED LIMITATION: AI grading is not perfectly deterministic — the same answer
// can score slightly differently across runs. The expectedPoints anchor + low
// temperature reduce, but don't eliminate, that variance.
const WEIGHTS = {
  essay: { content: 0.5, grammar: 0.3, spelling: 0.2 }, // English writing — mechanics matter
  short: { content: 0.8, grammar: 0.1, spelling: 0.1 }  // content subjects — a typo shouldn't fail a right answer
};
const MAX_ANSWER_LEN = 3000;
const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const clampText = (s) => String(s ?? '').slice(0, 400);

export async function gradeWritten({ questionText, expectedPoints = [], studentAnswer = '', style = 'short' }) {
  const answer = String(studentAnswer || '').slice(0, MAX_ANSWER_LEN).trim();
  const weights = WEIGHTS[style] || WEIGHTS.short;

  const zero = (msg) => ({
    content: 0, grammar: 0, spelling: 0, overall: 0,
    feedback: { content: msg, grammar: '', spelling: '' }
  });

  if (!answer) return zero('No answer was provided.');

  try {
    const raw = await callGroqChat(
      [
        { role: 'system', content: 'You are a strict but fair exam grader. Grade the student\'s written answer on three criteria, each an integer from 0 to 100: content (accuracy and completeness against the expected key points), grammar, and spelling. Give one short sentence of feedback per criterion. Output ONLY JSON.' },
        { role: 'user', content: `Question: ${questionText}

Expected key points a correct answer should cover:
${(expectedPoints || []).map((p, i) => `${i + 1}. ${p}`).join('\n') || '(use your subject knowledge)'}

Student's answer:
${answer}

Return JSON exactly: {"content":0-100,"grammar":0-100,"spelling":0-100,"feedback":{"content":"one sentence","grammar":"one sentence","spelling":"one sentence"}}` }
      ],
      { jsonMode: true, temperature: 0.2 }
    );
    const g = JSON.parse(raw);
    const content = clampScore(g.content);
    const grammar = clampScore(g.grammar);
    const spelling = clampScore(g.spelling);
    const overall = Math.round(content * weights.content + grammar * weights.grammar + spelling * weights.spelling);
    return {
      content, grammar, spelling, overall,
      feedback: {
        content: clampText(g.feedback?.content),
        grammar: clampText(g.feedback?.grammar),
        spelling: clampText(g.feedback?.spelling)
      }
    };
  } catch (err) {
    console.warn('Written grading failed:', err.message);
    return zero('This answer could not be graded automatically. Please try again.');
  }
}
