import { callGroqChat } from './groqClient.js';
import { isEnglish, isWrittenHeavy } from '../config/taxonomy.js';

// Track 3: generate `count` written (essay or short-answer) questions with a
// grading anchor. Returns [{ type:'written', questionText, expectedPoints,
// writtenStyle, topic }] ready to store in a quiz's questions[]. Returns [] on any
// failure so callers can proceed MCQ-only.
//
// `style`: 'essay' (English writing — paragraph prompts, mechanics weighted) or
// 'short' (other subjects — 1-3 sentence answers, content-weighted).
const clamp = (s, n) => String(s ?? '').slice(0, n);

// Which written style a subject uses. English is essay-weighted; everything else
// is short-answer. (Track 4 will refine English into writing/fusion sub-tracks.)
// Track (subject-splitting): the essay/short decision now depends on the SUB-SUBJECT,
// not just "is English". English Writing/Fusion → essay; English Grammar/Reading →
// short; everything non-English → short. Defensive backward-compat: an English doc
// with NO subSubject (pre-split / legacy — shouldn't exist post-migration) keeps the
// old "all English = essay" behaviour.
export function writtenStyleFor(subject, subSubject) {
  if (!isEnglish(subject)) return 'short';
  if (!subSubject) return 'essay';
  return isWrittenHeavy(subject, subSubject) ? 'essay' : 'short';
}

// `subtopics`: the SAME canonical sub-topic list the MCQ path built for this
// quiz. When provided, written questions are tagged FROM that list (identical
// strings) instead of free-generating a label — so a written question's topic
// pins to the same canonical bucket as the MCQs, minimizing the synonym-drift
// that otherwise splits "Adjectives" from "Adjective Description" in weak-topic
// aggregation. Canonicalization still normalizes as a backstop; this just makes
// an exact match far more likely. Empty list → free-generate (e.g. practice mode).
export async function generateWritten(grade, subject, topic, count, style = 'short', subtopics = []) {
  const kind = style === 'essay' ? 'essay/paragraph-writing' : 'short written-answer';
  const len = style === 'essay' ? 'a paragraph/essay prompt (expects 3-6 sentences)' : 'a short-answer prompt (expects 1-3 sentences)';
  const list = Array.isArray(subtopics) ? subtopics.filter(s => typeof s === 'string' && s.trim()) : [];
  const topicRule = list.length
    ? `Tag each question's "topic" with EXACTLY ONE label chosen VERBATIM from this list (do not invent new labels or vary the wording): ${JSON.stringify(list)}.`
    : `Set "topic" to a specific sub-topic within "${topic}".`;
  const prompt = `Generate ${count} ${kind} question(s) for a student${grade ? ` in ${grade}` : ''} on the subject "${subject}", topic "${topic}".
Return ONLY JSON: { "questions": [ { "question": "the prompt", "expectedPoints": ["a key point a correct answer must include", "..."], "topic": "sub-topic" } ] }
Each question is ${len}. ${topicRule} Provide 3 to 5 concrete expectedPoints per question — the specific facts/ideas a correct answer should contain (used to grade it). Do NOT include multiple-choice options. Raw JSON only.`;

  try {
    const raw = await callGroqChat(
      [
        { role: 'system', content: 'You write clear exam questions with a concise grading key. Output raw JSON only.' },
        { role: 'user', content: prompt }
      ],
      { jsonMode: true, temperature: 0.5 }
    );
    const data = JSON.parse(raw);
    return (Array.isArray(data.questions) ? data.questions : [])
      .slice(0, count)
      .map((q) => ({
        type: 'written',
        questionText: clamp(q.question, 600).trim(),
        expectedPoints: (Array.isArray(q.expectedPoints) ? q.expectedPoints : [])
          .slice(0, 6).map((p) => clamp(p, 300).trim()).filter(Boolean),
        writtenStyle: style,
        topic: clamp(q.topic || topic, 80).trim()
      }))
      .filter((q) => q.questionText && q.expectedPoints.length);
  } catch (err) {
    console.warn('Written question generation failed:', err.message);
    return [];
  }
}
