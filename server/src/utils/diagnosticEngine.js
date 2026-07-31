// Workstream A2 + A3 — blueprint-grounded question generation and the
// round-based adaptive diagnostic algorithm.
//
// Two jobs live here so the route stays thin:
//   1. GROUNDING  — every generated question is pinned to a real chapter of the
//      grade's syllabus and calibrated by three exemplars (too easy / correct /
//      too hard). Output is validated and regenerated once; there is NO
//      handwritten fallback bank, because an off-level diagnostic produces an
//      off-level roadmap, which is worse than telling the student to retry.
//   2. ADAPTATION — the quiz is variable length (8..20). After every round the
//      server decides, per chapter, whether it is confident the student is weak
//      or strong; ambiguous chapters get another question.

import { callGroqChat , callOpenAIChat } from './groqClient.js';
import { subjectScopeLabel } from '../config/taxonomy.js';
import { getBlueprint, gradeAnchor, representativeChapters } from '../config/syllabusBlueprint.js';
import { referencesAFigure } from './generateDiagram.js';

// ── Algorithm constants (A3) ────────────────────────────────────────────────
export const MIN_QUESTIONS = 8;
export const MAX_QUESTIONS = 20;
export const ROUND_SIZE = 4;

const DIFFICULTY_LADDER = ['easy', 'medium', 'hard'];
const START_DIFFICULTY = 'medium';

// How many candidates to ask for per slot. Generating spares in the FIRST call and
// letting the difficulty audit choose among them is far cheaper than generating
// exactly enough and retrying whatever gets rejected: extra questions cost output
// tokens on a call already being made, whereas a retry costs a whole round-trip
// (and the audit rejects often enough that retries were the dominant latency).
const CANDIDATES_PER_SLOT = 2;

// A chapter is RESOLVED once we are confident it is weak or confident it is
// strong. Anything in between (near 50%) is ambiguous and needs another question.
const RESOLVE_MIN_ASKED = 2;
const RESOLVE_WEAK_AT = 0.25;
const RESOLVE_STRONG_AT = 0.75;

const clamp = (s, n) => String(s ?? '').slice(0, n);

// ── Blueprint resolution ────────────────────────────────────────────────────

// Normalised stem, used for duplicate detection across a session (and across a
// regeneration retry). Punctuation/casing/spacing differences are not new questions.
export function stemKey(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
}

const tokenSet = (text) => new Set(stemKey(text).split(' ').filter(Boolean));

/**
 * Is this stem a near-duplicate of one already asked?
 *
 * Exact-stem matching is not enough. A generator asked twice about the same
 * chapter reliably produces pairs like "…find the length of CD using the basic
 * proportionality theorem" and "…find the length of CD", or "what is the value of
 * cos²θ" and "find the value of cos²θ" — textually distinct, identically useless
 * to a student, and they waste questions from a budget of twenty.
 *
 * CONTAINMENT (overlap ÷ the shorter stem) is the right measure rather than
 * Jaccard: the failure mode is one stem being a subset of the other, which
 * containment scores near 1.0 while Jaccard dilutes it to ~0.4. Genuinely
 * different questions are not subsets of each other.
 */
const NEAR_DUPLICATE_CONTAINMENT = 0.85;
const NEAR_DUPLICATE_MIN_TOKENS = 6;

export function isNearDuplicate(text, seenTokenSets) {
  const a = tokenSet(text);
  if (a.size < NEAR_DUPLICATE_MIN_TOKENS) return false;
  for (const b of seenTokenSets) {
    if (b.size < NEAR_DUPLICATE_MIN_TOKENS) continue;
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    if (inter / Math.min(a.size, b.size) >= NEAR_DUPLICATE_CONTAINMENT) return true;
  }
  return false;
}

function validateChapters(list) {
  if (!Array.isArray(list) || list.length < 4) return null;
  const out = list
    .map((c) => ({
      id: clamp(c.id || c.chapterId, 80).trim(),
      name: clamp(c.name, 140).trim(),
      concepts: (Array.isArray(c.concepts) ? c.concepts : []).slice(0, 6).map((x) => clamp(x, 200).trim()).filter(Boolean),
      diagramEligible: c.diagramEligible === true
    }))
    .filter((c) => c.id && c.name && c.concepts.length >= 2);
  const unique = [...new Map(out.map((c) => [c.id, c])).values()];
  return unique.length >= 4 ? unique : null;
}

// For a (grade, subject, subSubject) with no hand-authored blueprint, synthesise
// one from the model rather than falling back to hardcoded filler. Chapters must
// come from the real syllabus of that grade — that is the whole point of A1.
async function generateBlueprint(grade, subject, subSubject) {
  const scope = subjectScopeLabel(subject, subSubject);
  const anchor = gradeAnchor(grade);
  const prompt = `List the actual syllabus chapters for a student in "${grade}" studying "${scope}" under the Indian NCERT / CBSE curriculum.

Return ONLY JSON:
{
  "chapters": [
    { "id": "short-kebab-case-id", "name": "Exact chapter name from the syllabus", "concepts": ["a specific concept an exam would test", "..."], "diagramEligible": true }
  ],
  "exemplars": {
    "tooEasy": "a question that would be far too easy for ${grade} — the level you must never produce",
    "correct": "a question at exactly the right level for a ${grade} exam on this subject",
    "tooHard": "a question well beyond the ${grade} syllabus"
  }
}

Rules:
- 6 to 12 chapters, in syllabus order, using the real chapter names — do not invent generic titles like "Fundamentals" or "Basics".
- 3 to 6 concepts per chapter: specific things an exam would actually test, not restatements of the chapter name.
- "diagramEligible" is true only for chapters where a figure (geometry, ray diagram, circuit, biological structure, graph) is often genuinely required to ask a question, and false otherwise (algebra, grammar, economics, prose).
- The exemplars must reflect this cognitive level: ${anchor}
- Raw JSON only, no markdown.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callGroqChat(
        [
          { role: 'system', content: 'You are a CBSE/NCERT curriculum expert. Output raw JSON only.' },
          { role: 'user', content: prompt }
        ],
        { jsonMode: true, temperature: 0.2 }
      );
      const data = JSON.parse(raw);
      const chapters = validateChapters(data.chapters);
      const ex = data.exemplars || {};
      if (chapters && ex.tooEasy && ex.correct && ex.tooHard) {
        return {
          chapters,
          difficultyAnchor: anchor,
          exemplars: {
            tooEasy: clamp(ex.tooEasy, 400),
            correct: clamp(ex.correct, 600),
            tooHard: clamp(ex.tooHard, 400)
          },
          generated: true
        };
      }
      console.warn(`Blueprint synthesis attempt ${attempt + 1} produced unusable output for ${grade} / ${scope}.`);
    } catch (err) {
      console.warn(`Blueprint synthesis attempt ${attempt + 1} failed for ${grade} / ${scope}:`, err.message);
    }
  }
  return null;
}

/**
 * The blueprint actually used for a diagnostic session: the hand-authored one if
 * it exists (A1), otherwise one synthesised from the real syllabus. Throws if
 * neither is available — the caller must surface a retry message, never filler.
 */
export async function resolveBlueprint(grade, subject, subSubject) {
  const staticBp = getBlueprint(grade, subject, subSubject);
  if (staticBp) return { ...staticBp, generated: false };

  const generated = await generateBlueprint(grade, subject, subSubject);
  if (generated) return generated;

  throw new Error(`No syllabus blueprint available for ${grade} / ${subject}${subSubject ? ` / ${subSubject}` : ''}.`);
}

/**
 * The probe set for a session — the chapters this diagnostic may test.
 *
 * Sized from the MAXIMUM budget, because a resolved chapter releases its
 * remaining budget to an untouched one (see planNextRound). Resolving a chapter
 * costs at least RESOLVE_MIN_ASKED questions, so `mcqMax / 2` chapters is the most
 * a run can clear; one is held back as slack so a short round (the difficulty
 * self-check rejecting a question) does not make full coverage unreachable.
 *
 * A student who answers consistently sweeps WIDE — every chapter resolved in two
 * questions — while an ambiguous student goes DEEP on fewer, because their
 * unresolved chapters keep consuming the budget that would have opened new ones.
 * That is the behaviour you want from a diagnostic, and the roadmap is grounded in
 * as much of the syllabus as the budget honestly allows.
 *
 * SELECTION IS DETERMINISTIC. `representativeChapters` takes evenly-spaced indices
 * across the blueprint's chapter list — index 0, then round(i·(n−1)/(k−1)) — so it
 * spreads across the whole syllabus instead of truncating to the opening chapters,
 * and two students on the same course ALWAYS get the same probe chapters in the
 * same order. There is no randomness anywhere in this module.
 */
export function selectWorkingChapters(chapters, mcqMax, mcqMin = MIN_QUESTIONS) {
  const cap = Math.max(ROUND_SIZE, Math.floor(mcqMax / RESOLVE_MIN_ASKED) - 1);
  return representativeChapters(chapters, cap);
}

/** How many untouched chapters the remaining budget can still afford to RESOLVE. */
function affordableOpenings(remaining, unresolvedCount) {
  return Math.max(0, Math.floor((remaining - unresolvedCount) / RESOLVE_MIN_ASKED));
}

// ── Adaptive state ──────────────────────────────────────────────────────────

export function chapterAccuracy(stat) {
  if (!stat || !stat.asked) return null;
  return stat.correct / stat.asked;
}

export function isResolved(stat) {
  const acc = chapterAccuracy(stat);
  if (acc === null || stat.asked < RESOLVE_MIN_ASKED) return false;
  return acc <= RESOLVE_WEAK_AT || acc >= RESOLVE_STRONG_AT;
}

function stepDifficulty(current, wasCorrect) {
  const i = DIFFICULTY_LADDER.indexOf(current);
  const base = i === -1 ? DIFFICULTY_LADDER.indexOf(START_DIFFICULTY) : i;
  const next = wasCorrect ? base + 1 : base - 1;
  return DIFFICULTY_LADDER[Math.min(DIFFICULTY_LADDER.length - 1, Math.max(0, next))];
}

/**
 * Should the diagnostic stop? Implements the A3 stop rule verbatim.
 *   STOP when asked >= MIN and every working chapter is touched and none is
 *   unresolved — OR when asked >= the MCQ budget.
 */
export function shouldStop({ chapters, stats, askedMcq, mcqMin, mcqMax }) {
  if (askedMcq >= mcqMax) return true;
  if (askedMcq < mcqMin) return false;

  const unresolved = chapters.filter((c) => stats[c.id]?.asked && !isResolved(stats[c.id]));
  if (unresolved.length) return false;          // still ambiguous somewhere

  // Untouched ground remains AND we can still afford to cover it properly, so
  // keep going — a resolved chapter's unspent budget belongs to a chapter we know
  // nothing about, not to an early finish.
  const untouched = chapters.filter((c) => !stats[c.id]?.asked);
  if (untouched.length && affordableOpenings(mcqMax - askedMcq, 0) >= 1) return false;

  return true;
}

/**
 * Chapter coverage for a finished (or in-flight) session — reported per run so
 * the breadth of the sample behind a roadmap is visible rather than assumed.
 */
export function coverageOf(chapters, stats) {
  const touched = chapters.filter((c) => stats[c.id]?.asked);
  const resolved = touched.filter((c) => isResolved(stats[c.id]));
  return {
    total: chapters.length,
    touched: touched.length,
    resolved: resolved.length,
    // Touched but still ambiguous when the budget ran out. These MUST fail safe
    // toward more teaching — see the roadmap hand-off in routes/diagnostic.js.
    unresolvedChapters: touched.filter((c) => !isResolved(stats[c.id])).map((c) => c.name),
    untouchedChapters: chapters.filter((c) => !stats[c.id]?.asked).map((c) => c.name)
  };
}

/**
 * A best-effort projection of the final question count, for the progress bar.
 *
 * It is deliberately NOT presented to the student as "question N of T" — the
 * count genuinely is not known in advance, and showing a total we cannot honour
 * would be a lie the next round exposes. It is exposed so the client can size an
 * indeterminate bar sensibly.
 */
export function estimateTotal({ chapters, stats, asked, askedMcq, mcqMin, mcqMax, pendingWritten = 0 }) {
  const list = Array.isArray(chapters) ? chapters : [];
  const unresolved = list.filter((c) => stats[c.id]?.asked && !isResolved(stats[c.id]));
  const untouched = list.filter((c) => !stats[c.id]?.asked);
  // Only count chapters the remaining budget can still afford to open — the same
  // rule planNextRound uses, so the projection matches what will actually happen.
  const willOpen = Math.min(untouched.length, affordableOpenings(mcqMax - askedMcq, unresolved.length));
  const needed = unresolved.length + willOpen * RESOLVE_MIN_ASKED;

  const projectedMcq = Math.min(mcqMax, Math.max(mcqMin, askedMcq + needed));
  const alreadyWritten = Math.max(0, asked - askedMcq);
  const total = projectedMcq + alreadyWritten + pendingWritten;
  return Math.min(MAX_QUESTIONS, Math.max(asked, MIN_QUESTIONS, total));
}

/**
 * Choose the chapters (and their difficulties) for the next round.
 *
 * The central rule: a RESOLVED chapter is finished and never takes another slot.
 * That is what releases budget — every question a resolved chapter would have
 * consumed goes to a chapter we still know nothing about. A consistent student
 * therefore keeps opening new ground; an ambiguous student's unresolved chapters
 * keep consuming the budget, so they go deep on fewer chapters instead.
 *
 * Unresolved and newly-opened chapters are INTERLEAVED so neither starves:
 * ambiguous chapters keep converging while new ground keeps opening. Ordering
 * within each group follows the deterministic blueprint order, so the same answers
 * always produce the same test.
 */
export function planNextRound({ chapters, stats, askedMcq, mcqMax }) {
  const remaining = mcqMax - askedMcq;
  if (remaining <= 0) return [];
  const slots = Math.min(ROUND_SIZE, remaining);

  const untouched = chapters.filter((c) => !stats[c.id]?.asked);
  const unresolved = chapters.filter((c) => stats[c.id]?.asked && !isResolved(stats[c.id]));

  // Never open a chapter the budget cannot afford to RESOLVE. Opening one and
  // abandoning it after a single question is worse than leaving it closed: one
  // question yields a 0% or 100% accuracy that reads as confident signal and is
  // not, and the roadmap would then act on it.
  const openable = untouched.slice(0, affordableOpenings(remaining, unresolved.length));

  const order = [];
  for (let i = 0; i < Math.max(unresolved.length, openable.length); i++) {
    if (unresolved[i]) order.push(unresolved[i]);
    if (openable[i]) order.push(openable[i]);
  }

  const picked = [];
  const push = (c) => { if (picked.length < slots && !picked.some((p) => p.id === c.id)) picked.push(c); };
  order.forEach(push);

  // Everything is resolved but we are still below the minimum, so the quiz has to
  // keep asking. Re-probe the least-examined chapters rather than stopping short.
  if (picked.length < slots) {
    [...chapters]
      .sort((a, b) => (stats[a.id]?.asked || 0) - (stats[b.id]?.asked || 0))
      .forEach(push);
  }

  return picked.map((ch) => {
    const stat = stats[ch.id];
    const difficulty = (stat && stat.asked)
      ? stepDifficulty(stat.lastDifficulty || START_DIFFICULTY, !!stat.lastCorrect)
      : START_DIFFICULTY;
    return { chapter: ch, difficulty };
  });
}

// ── Question generation (A2) ────────────────────────────────────────────────

// Do any two options share so long a common prefix that they read as the same
// answer? Guards against the model pasting its whole derivation into every option.
function hasNearDuplicatePrefix(options) {
  for (let i = 0; i < options.length; i++) {
    for (let k = i + 1; k < options.length; k++) {
      const a = options[i], b = options[k];
      const shorter = Math.min(a.length, b.length);
      let common = 0;
      while (common < shorter && a[common] === b[common]) common++;
      if (common >= 60 && common / shorter >= 0.6) return true;
    }
  }
  return false;
}

// ── COMPOUND_QUESTION ───────────────────────────────────────────────────────
//
// A stem that asks TWO things but ships ONE answer set. Observed in production:
//
//   "A farmer wants to sow seeds in a field of 2 hectares... how many kg of seeds
//    will he need in total? After sowing, if he has 15 kg left, how many kg did he
//    use?"   options: 65 / 75 / 85 / 55
//
// 2 x 40 = 80 kg needed; 80 - 15 = 65 used. The options answer only the SECOND
// question, so a student who correctly computes the first quantity finds no matching
// option and concludes they are wrong. Worse than an unanswerable question: it
// punishes correct work.
//
// Detected structurally rather than by a judge because it is a countable property —
// how many things the stem asks for — and a deterministic check costs nothing and
// cannot rate-limit. One question, one answer set.
const INTERROGATIVE_RE = /\b(how many|how much|what is|what will|which of|find the|calculate the|determine the|what fraction|what percentage)\b/gi;

function countInterrogativeClauses(text) {
  const t = String(text || '');
  // Question marks are the strongest signal: two '?' in one stem is two questions.
  const questionMarks = (t.match(/\?/g) || []).length;
  const asks = (t.match(INTERROGATIVE_RE) || []).length;
  return { questionMarks, asks };
}

/**
 * True when the stem asks for more than one quantity. Exported for the test suite.
 *
 * Deliberately conservative: a single '?' with two "find the" phrases is common in
 * legitimate multi-part reasoning that still resolves to ONE answer ("find the speed
 * needed to cover the distance in the time given"). Two question marks, or two
 * distinct asks each followed by its own '?', is the real signal.
 */
export function isCompoundQuestion(questionText) {
  const { questionMarks, asks } = countInterrogativeClauses(questionText);
  if (questionMarks >= 2) return true;
  // One '?' but two separate asks separated by a sentence break — the stem states a
  // second task as its own sentence and then folds both into one question mark.
  if (asks >= 2 && /[.?]\s+[A-Z]/.test(String(questionText || ''))) {
    const sentences = String(questionText).split(/(?<=[.?])\s+/);
    const asking = sentences.filter((x) => INTERROGATIVE_RE.test(x) && (INTERROGATIVE_RE.lastIndex = 0, true));
    if (asking.length >= 2) return true;
  }
  return false;
}

// ── TOPIC_NOT_IN_CHAPTER ────────────────────────────────────────────────────
//
// `chapterId` is gated against the blueprint. `topic` was not — it was taken verbatim
// from the model — so a question could declare a valid chapter and then label itself
// with something from a different subject entirely. Observed in production, on a
// Class 8 SCIENCE diagnostic:
//
//   Q1 [Area of Rectangle] "A farmer wants to sow wheat on a rectangular field.
//                           If the length is 20 m and the width is 15 m, how much
//                           area will be covered?"
//
// The chapterId was a real Crop Production chapter; the topic was geometry. The
// generated blueprint was correct — it was this ungated field that let it through.
//
// TOPIC IS NOT COSMETIC DOWNSTREAM, which is the part that makes this worth a hard
// rejection rather than a relabel. weakTopics.js aggregates by topic to decide what a
// student is weak at, and Feature 12's adaptive remediation inserts days targeting
// exactly those labels. A mislabelled topic therefore corrupts the roadmap EVEN WHEN
// THE QUESTION ITSELF IS FINE: a student who answers a Crop Production question wrong
// gets a remediation day for "Area of Rectangle".
//
// Deterministic, and deliberately conservative: rejects only when the topic shares NO
// content word with the chapter name or ANY of its concepts. Concepts are written as
// full phrases ("refractive index and Snell's law") while models emit short labels
// ("Refraction of light"), so requiring an exact match would reject correct topics.
// Zero overlap is the unambiguous case.
const TOPIC_STOPWORDS = new Set([
  'the', 'of', 'and', 'in', 'to', 'a', 'an', 'for', 'on', 'with', 'its', 'their',
  'from', 'by', 'at', 'or', 'as', 'is', 'are', 'be', 'this', 'that', 'into'
]);

const contentWords = (text) => new Set(
  String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !TOPIC_STOPWORDS.has(w))
);

/**
 * Does this topic label plausibly belong to this chapter? Exported for the tests.
 * Returns true when it shares at least one content word with the chapter name or any
 * concept — or when the chapter carries no concepts at all, in which case there is
 * nothing to check against and the question is not penalised for our missing data.
 */
export function topicBelongsToChapter(topic, chapter) {
  if (!chapter) return false;
  const t = contentWords(topic);
  if (!t.size) return true;                     // empty topic falls back to chapter name
  const haystack = [chapter.name, ...(chapter.concepts || [])].join(' ');
  const h = contentWords(haystack);
  if (!h.size) return true;                     // nothing to compare against
  for (const w of t) if (h.has(w)) return true;
  return false;
}

function validateQuestion(q, chapterById, seenStems, seenTokenSets) {
  if (!q || typeof q !== 'object') return null;
  const chapterId = clamp(q.chapterId, 80).trim();
  const chapter = chapterById.get(chapterId);
  if (!chapter) return null;                                     // no blueprint chapter

  const questionText = clamp(q.question || q.questionText, 900).trim();
  if (!questionText) return null;

  // An MCQ that opens "Prove that…" / "Show that…" cannot be answered by picking
  // an option — the model reaches for these under difficulty pressure, and the
  // result is four paragraphs of working masquerading as options. The prompt
  // forbids it; this enforces it.
  if (/^\s*(prove|show that|derive|verify|justify|explain why|discuss|describe how)\b/i.test(questionText)) return null;

  // A question that points at a figure it does not have is unanswerable, and if it
  // reaches a cached quiz it stays that way forever. Diagrams are attached AFTER
  // generation, so at validation time the only safe rule is: do not accept a stem
  // that references one at all — the diagram prompt is what adds figures, not the
  // question text. Enforced here rather than left as a checklist note.
  if (referencesAFigure(questionText)) return null;

  // Two questions, one answer set — see COMPOUND_QUESTION above.
  if (isCompoundQuestion(questionText)) return null;

  // A valid chapterId with a topic label from somewhere else — see
  // TOPIC_NOT_IN_CHAPTER above. Checked here rather than left to the subject judge:
  // it is deterministic, costs nothing, and cannot rate-limit.
  const declaredTopic = clamp(q.topic, 80).trim();
  if (declaredTopic && !topicBelongsToChapter(declaredTopic, chapter)) return null;

  const key = stemKey(questionText);
  if (!key || seenStems.has(key)) return null;                   // exact duplicate stem
  if (isNearDuplicate(questionText, seenTokenSets)) return null;  // near-duplicate

  const options = (Array.isArray(q.options) ? q.options : [])
    .map((o) => clamp(o, 300).trim())
    .filter(Boolean);
  const distinct = new Set(options.map((o) => o.toLowerCase()));
  if (options.length < 4 || distinct.size < 4) return null;      // <4 distinct options

  // Reject "restated working" options — four near-identical paragraphs that differ
  // only in their last clause. They are technically distinct but unreadable, and a
  // student cannot tell them apart on a phone screen.
  if (options.some((o) => o.length > 90) && hasNearDuplicatePrefix(options)) return null;

  const correctIndex = Number(q.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;

  const difficulty = DIFFICULTY_LADDER.includes(q.difficulty) ? q.difficulty : START_DIFFICULTY;

  // Difficulty self-check (folded in from what used to be a separate audit call).
  // A question the model itself scores as one-step is below grade level; requiring
  // it to NAME the steps is what stops the field being rubber-stamped. The question
  // is still returned — structurally it is fine, and it is kept as a last resort so
  // a run of easy generations degrades to an easy quiz rather than to no quiz.
  const steps = Number(q.stepsRequired);
  const why = clamp(q.whyAtLevel, 300).trim();
  const belowLevel = !Number.isFinite(steps) || steps < 2 || why.length < 12;

  return {
    type: 'mcq',
    questionText,
    options: options.slice(0, 4),
    correctIndex: Math.min(correctIndex, 3),
    topic: clamp(q.topic || chapter.name, 80).trim() || chapter.name,
    chapterId,
    difficulty,
    belowLevel,
    declaredSteps: Number.isFinite(steps) ? steps : 0
  };
}

/** Strip the generation-time self-check fields before a question is stored. */
function stripAudit(q) {
  const { belowLevel, declaredSteps, ...clean } = q;
  return clean;
}

function buildRoundPrompt({ grade, scope, blueprint, specs, askedStems, strict }) {
  const specLines = specs.map((s, i) => {
    const ch = s.chapter;
    return `${i + 1}. chapterId: "${ch.id}"
   chapter: "${ch.name}"
   concepts to draw from: ${JSON.stringify(ch.concepts)}
   required difficulty (relative to ${grade}): "${s.difficulty}"`;
  }).join('\n');

  const dupBlock = askedStems.length
    ? `\nAlready asked in this session — do NOT repeat or merely rephrase any of these:\n${askedStems.map((s) => `- ${s}`).join('\n')}\n`
    : '';

  const strictBlock = strict
    ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED — ${strict}\nOther things that get a question rejected: the chapterId was not copied verbatim, fewer than 4 distinct options, a missing or wrong correctIndex, options that are pasted working rather than short answers, or repeating a question already asked. Fix all of these.\n`
    : '';

  return `You are setting a diagnostic test for a student in "${grade}" studying "${scope}".

DIFFICULTY ANCHOR — the cognitive level every question must hit:
${blueprint.difficultyAnchor}

CALIBRATION EXEMPLARS for this grade and subject:
- TOO EASY (reject level): "${blueprint.exemplars.tooEasy}"
- CORRECT (this is the level you must hit): "${blueprint.exemplars.correct}"
- TOO HARD (beyond the syllabus): "${blueprint.exemplars.tooHard}"

Your question must be at the difficulty of the CORRECT exemplar. If it is as simple as the TOO EASY exemplar, it is wrong and unusable. If it is as advanced as the TOO HARD exemplar, it is off-syllabus and also unusable.
${strictBlock}
Produce ${CANDIDATES_PER_SLOT} DIFFERENT multiple-choice questions for EACH specification below (${specs.length * CANDIDATES_PER_SLOT} questions in total). The two questions for a specification must test DIFFERENT concepts from that chapter's concept list — they must not be rewordings of each other, and must not differ only in their numbers.

${specLines}
${dupBlock}
Return ONLY JSON matching this exact shape:
{"questions":[{"chapterId":"copied verbatim from the specification","difficulty":"easy|medium|hard","question":"the question text","options":["A","B","C","D"],"correctIndex":0,"topic":"short sub-topic label","stepsRequired":2,"whyAtLevel":"one clause naming the two things the student must do"}]}

DIFFICULTY SELF-CHECK — you must fill these two fields honestly for every question, and they are checked:
- "stepsRequired": how many distinct steps a competent ${grade} student needs. Recalling a definition or substituting into one formula is 1 step. **A question with stepsRequired below 2 is rejected** — write a harder one from the same chapter instead of submitting it.
- "whyAtLevel": name the specific steps, e.g. "apply the sum formula, then solve the resulting linear equation". If you cannot name two distinct steps, the question is too easy — replace it.

Rules:
- "chapterId" MUST be copied verbatim from the specification the question answers.
- "difficulty" is RELATIVE TO ${grade}: 'medium' means typical of a ${grade} exam paper, not absolute difficulty.
- Exactly 4 options, all four textually distinct, exactly one correct.
- "correctIndex" is the 0-based index of the option that is mathematically and factually true. Recheck every calculation before answering.
- "topic" is a short sub-topic label within that chapter (used for weak-topic analysis) — keep it 2-5 words.
- Every question must be answerable from the question text alone (no reference to a figure unless the figure is described in words).

CRITICAL — these are multiple-choice questions, not written ones:
- NEVER ask the student to "prove", "show that", "derive", "verify" or "explain". Those cannot be answered by picking an option. Ask for a VALUE, a RESULT, a CLASSIFICATION or a CORRECT STATEMENT instead. The reasoning is what makes it hard; the answer is what they select.
- Each option must be a short ANSWER (ideally under 15 words), not a restatement of the working. Never paste your derivation into the options.
- The four options must be distinguishable at a glance on a phone screen. Options that share a long identical opening and differ only in the last few words are rejected.
- Exactly one option is defensibly correct; the other three must be plausible but definitely wrong. Never include two options that are both true.
- The question must be fully determined — all the data needed to reach the answer is stated.
- No markdown, no commentary, raw JSON only.

FINAL CHECK before you answer — reread every question you wrote:
Could a competent student answer it in ONE step, or by recalling a single definition or fact? If yes, it is at the TOO EASY level. Replace it with a harder question from the same chapter that needs at least two steps or combines two ideas. Making a question multiple-choice does NOT mean making it easy.`;
}

/**
 * Independent difficulty audit — a separate call whose only job is to reject
 * below-level questions.
 *
 * This was folded into the generation call to save a round-trip, and it had to be
 * put back: with only the in-prompt self-check, a Class 10 Maths run produced
 * "Find the HCF of 48 and 18", "if sinθ = 3/5 find cos(90° − θ)" and five other
 * single-step questions, and the model declared `stepsRequired: 2` for every one
 * of them — zero self-rejections. A generator asked to grade its own output
 * rubber-stamps it. The self-check is kept as a free first filter, but the
 * decision needs a judge with no stake in defending the questions.
 *
 * The latency this costs is now paid off the critical path instead: most of a
 * round is pre-generated (and audited) while the student answers the previous one.
 *
 * Returns the Set of indices judged below grade level. On any failure it returns
 * an empty Set — an audit that cannot run must not silently discard a good round.
 */
// ── THE JUDGES RUN ON OPENAI, LIKE DIAGRAM GENERATION. DO NOT HARMONISE. ────
//
// Same reasoning as DIAGRAM_MODEL in generateDiagram.js, and measured the same way.
// A judge is low-volume (one call per round), tiny output (a list of ids), and it is
// pure JUDGEMENT — which is exactly what the rate-limited Groq chain does worst.
//
// Measured on the Groq chain, the subject-competency judge was unreliable in BOTH
// directions on the same prompt:
//   - it kept "a farmer sows 2 hectares at 40 kg/hectare, how many kg?" in some runs;
//   - it UNANIMOUSLY rejected "a speed-time graph runs from (0,0) to (5,20), what is
//     the acceleration?" (kinematics) and "how does the monsoon affect agricultural
//     practices in India?" (geography) in others.
// Both failures are expensive: the first mis-assesses a student, the second throws
// away good questions and forces regeneration.
//
// A wrong verdict here decides what a student is tested on and therefore what their
// roadmap teaches, which makes it a worse place to save money than almost anywhere
// else in this app.
const JUDGE_MODEL = 'gpt-4o';

/**
 * Call a judge. OpenAI primary, Groq fallback — the inverse of the app-wide chain,
 * so a judge still runs (less reliably) if OpenAI is unavailable rather than not at
 * all, since a judge that does not run silently disables the check.
 */
async function callJudge(messages) {
  return (await callOpenAIChat(messages, { model: JUDGE_MODEL, temperature: 0, jsonMode: true }))
    || (await callGroqChat(messages, { jsonMode: true, temperature: 0 }));
}

/**
 * Independent SUBJECT-COMPETENCY audit — does the question actually test the subject?
 *
 * The failure this exists for, observed in production on Class 8 Science · Combined:
 *
 *   "A farmer wants to sow seeds in a field of 2 hectares. If he uses 40 kg of seeds
 *    per hectare, how many kg will he need in total?"
 *
 * It is arithmetic in costume. Nothing in it requires germination, soil, seed biology
 * or crop management — replace "seeds" with "bricks" and the question is unchanged. It
 * passed every existing validator because they all check STRUCTURE: multi-step, not
 * "prove that", not a duplicate, four distinct options. Being multi-step is exactly
 * what let it through — the difficulty audit asks "is this hard enough", never "is this
 * the subject".
 *
 * A SEPARATE call, not a self-check folded into generation. Workstream A established
 * this the hard way: a generator asked to grade its own output rubber-stamped it — 7
 * single-step questions, zero self-rejections. The judge is told it did not write these
 * and has no reason to defend them.
 *
 * SKIPPED FOR MATHS. A word problem IS the subject there; "arithmetic in costume" is
 * only a defect when the costume is standing in for another discipline.
 */
export async function auditSubjectCompetency(questions, { grade, scope, subject, blueprint }) {
  if (!questions.length) return new Set();
  // Maths is exempt — see above.
  if (/^maths?$/i.test(String(subject || '').trim())) return new Set();

  const payload = questions.map((q, i) => ({ id: i, question: q.questionText, chapter: q.topic || '' }));
  const prompt = `You are auditing a diagnostic test for a student in "${grade}" studying "${scope}". Your ONLY job is to reject questions that do not actually test this subject. You did not write these questions and have no reason to defend them.

THE TEST, applied to every question:
Does answering it require a CONCEPT from this subject — a law, formula, mechanism, property, classification or fact taught in the chapter?
- NO, the given numbers can be combined by general arithmetic, or common sense answers it -> REJECT.
- YES -> KEEP, even when the answer is a number and the working is long.

THE DISTINCTION THAT MATTERS — read both before judging:

KEEP: "A train's speed changes from 30 m/s to 50 m/s in 4 s. What is its acceleration?"
  Numeric, but it needs the DEFINITION of acceleration (change in velocity over time).
  A student who never studied motion does not know which quantities to combine.

REJECT: "A farmer sows seeds in a field of 2 hectares using 40 kg per hectare. How many kg will he need in total?"
  Also numeric and superficially similar — but the only operation is "rate x quantity",
  which any student can do without the chapter. Swap "seeds" for "bricks" and nothing
  changes. No germination, soil or crop concept is used. THIS is the failure to catch.

The difference is NOT whether the question calculates. Physics and Chemistry are
quantitative subjects and their questions SHOULD calculate. The difference is whether a
subject concept is needed to know WHAT to calculate. Applying Snell's law, Ohm's law,
kinetic energy, molarity or a rate equation IS subject knowledge. Multiplying a given
rate by a given area is not.

Do NOT reject a question merely for containing numbers, units, or several steps.

Example of a question to KEEP (conceptual):
"Why is sowing seeds too close together harmful to the crop?"
Why: it requires knowing that plants compete for water, nutrients and sunlight.

Questions:
${JSON.stringify(payload)}

Return ONLY JSON: { "reject": [ids] } — the ids of questions answerable WITHOUT subject knowledge. Return { "reject": [] } if every question genuinely tests the subject.`;

  try {
    const raw = await callJudge([
      { role: 'system', content: 'You are a strict subject examiner. You reject questions that do not test the stated subject. Output raw JSON only.' },
      { role: 'user', content: prompt }
    ]);
    const parsed = JSON.parse(raw || '{}');
    const flagged = Array.isArray(parsed.reject) ? parsed.reject : [];
    return new Set(flagged.filter((i) => Number.isInteger(i) && i >= 0 && i < questions.length));
  } catch (err) {
    // Same posture as the difficulty audit: a failed judge must not empty the round.
    console.warn('Subject-competency audit failed — keeping the round as generated:', err.message);
    return new Set();
  }
}

async function auditDifficulty(questions, { grade, scope, blueprint }) {
  if (!questions.length) return new Set();

  const payload = questions.map((q, i) => ({ id: i, question: q.questionText }));
  const prompt = `You are auditing a diagnostic test for a student in "${grade}" studying "${scope}". Your ONLY job is to reject questions that are below grade level. You did not write these questions and have no reason to defend them.

EXPECTED COGNITIVE LEVEL:
${blueprint.difficultyAnchor}

- TOO EASY (this level must be rejected): "${blueprint.exemplars.tooEasy}"
- CORRECT (this level is acceptable): "${blueprint.exemplars.correct}"

QUESTIONS TO AUDIT:
${JSON.stringify(payload, null, 1)}

For each question, work out how a student would actually solve it and count the DISTINCT steps.
Reject it if it can be answered by:
  - recalling a single definition, formula or fact;
  - one substitution into one formula;
  - a single arithmetic or factorisation operation with no follow-up.
Accept it only if it needs at least two distinct steps, or combines two concepts.

Examples of REJECT: "Find the HCF of 48 and 18." (one factorisation) · "If sin θ = 3/5, find cos(90° − θ)." (one identity) · "Find the area of a sector of radius 10 cm and angle 120°." (one formula).
Examples of ACCEPT: "Find the roots of 2x² − 5x + 3 = 0 and state the nature of its roots." (solve, then classify) · "From a point the angle of elevation is 60°, and from 30 m further it is 30°; find the height." (two triangles, then eliminate).

Return ONLY JSON: { "tooEasy": [the "id" values that are below grade level] }
Raw JSON only.`;

  try {
    const raw = await callGroqChat(
      [
        { role: 'system', content: 'You are a strict examination moderator. You reject below-level questions. Output raw JSON only.' },
        { role: 'user', content: prompt }
      ],
      { jsonMode: true, temperature: 0.1 }
    );
    const data = JSON.parse(raw);
    const flagged = Array.isArray(data?.tooEasy) ? data.tooEasy : [];
    return new Set(flagged.filter((i) => Number.isInteger(i) && i >= 0 && i < questions.length));
  } catch (err) {
    console.warn('Difficulty audit failed — keeping the round as generated:', err.message);
    return new Set();
  }
}

/**
 * Generate one adaptive round: generate → structurally validate → in-prompt
 * self-check → independent difficulty audit → regenerate whatever did not survive.
 *
 * Throws only when nothing usable came back at all — the caller turns that into a
 * "please retry" error rather than substituting filler.
 */
export async function generateRound({ grade, subject, subSubject, blueprint, specs, askedStems }) {
  if (!specs.length) return [];
  const scope = subjectScopeLabel(subject, subSubject);
  const chapterById = new Map(blueprint.chapters.map((c) => [c.id, c]));
  const seen = new Set(askedStems.map(stemKey));
  const seenTokens = askedStems.map(tokenSet);
  // Structurally valid questions we could not place: either the model declared them
  // below level, or they answered a chapter whose slot was already filled. Served
  // only if nothing better exists, so a bad generation run degrades to an easy quiz
  // rather than to no quiz at all.
  const belowLevelReserve = [];

  const remember = (q) => { seen.add(stemKey(q.questionText)); seenTokens.push(tokenSet(q.questionText)); };

  // Slots are tracked POSITIONALLY, one per spec. Counting accepted questions
  // instead would refill the wrong slots as soon as a non-final question is
  // rejected — leaving one chapter permanently untested while another got two
  // questions, which then makes the "all chapters touched" stop condition
  // unreachable and runs every student to MAX.
  const filled = new Array(specs.length).fill(null);
  const unfilled = () => specs.map((s, i) => ({ s, i })).filter(({ i }) => !filled[i]);

  // Telling the model WHY the last attempt failed is what makes the retry worth
  // making — a generic "try again" reproduces the same mistake, and unfilled slots
  // mean short rounds and a longer quiz for the student.
  let rejectionReason = '';

  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const missing = unfilled();
    if (!missing.length) break;
    const pending = missing.map(({ s }) => s);

    let data;
    try {
      const raw = await callGroqChat(
        [
          { role: 'system', content: 'You are a strict CBSE/NCERT examiner. You never ask below-grade questions. Output raw JSON only.' },
          { role: 'user', content: buildRoundPrompt({ grade, scope, blueprint, specs: pending, askedStems: [...seen].slice(-25), strict: attempt > 0 ? rejectionReason : '' }) }
        ],
        { jsonMode: true, temperature: attempt === 0 ? 0.35 : 0.55 }
      );
      data = JSON.parse(raw);
    } catch (err) {
      console.warn(`Diagnostic round generation attempt ${attempt + 1} failed:`, err.message);
      continue;
    }

    // The model returns CANDIDATES_PER_SLOT candidates per slot; keep every valid
    // one so the audit has something to choose between instead of forcing a retry.
    const candidates = [];
    const tooEasy = [];
    for (const raw of Array.isArray(data?.questions) ? data.questions : []) {
      const q = validateQuestion(raw, chapterById, seen, seenTokens);
      if (!q) continue;
      remember(q);   // never regenerate this stem, or a near-variant of it
      if (q.belowLevel) { tooEasy.push(q); belowLevelReserve.push(q); continue; }
      candidates.push(q);
    }

    // TWO independent judges, run together over the whole candidate pool. They ask
    // different questions and a question can fail either: "is this hard enough" and
    // "is this the subject". The sowing question passed the first and failed the
    // second, which is why one judge was not enough.
    const [flagged, offSubject] = candidates.length
      ? await Promise.all([
        auditDifficulty(candidates, { grade, scope, blueprint }),
        auditSubjectCompetency(candidates, { grade, scope, subject, blueprint })
      ])
      : [new Set(), new Set()];
    const survivors = [];
    const offSubjectRejects = [];
    candidates.forEach((q, i) => {
      // Off-subject is NOT put in belowLevelReserve. That reserve exists so a bad
      // generation run degrades to an easy quiz rather than no quiz — but a question
      // that does not test the subject is not a weak question, it is the wrong
      // question, and serving it would mis-assess the student and produce a roadmap
      // for a chapter they were never actually tested on.
      if (offSubject.has(i)) { offSubjectRejects.push(q); return; }
      if (flagged.has(i)) { tooEasy.push(q); belowLevelReserve.push(q); }
      else survivors.push(q);
    });

    if (offSubjectRejects.length) {
      const ex = offSubjectRejects.slice(0, 2).map((q) => `"${q.questionText}"`).join(' and ');
      rejectionReason = `${offSubjectRejects.length} of your questions did not test ${scope} at all — they could be answered with arithmetic or common sense by a student who never studied the chapter. Rejected: ${ex}. Ask about a fact, mechanism, cause or classification FROM THE CHAPTER, not a calculation dressed in subject vocabulary.`;
      console.warn(`Subject-competency check rejected ${offSubjectRejects.length}/${candidates.length} candidate(s) as not testing ${scope}.`);
    }

    if (tooEasy.length) {
      const examples = tooEasy.slice(0, 2).map((q) => `"${q.questionText}"`).join(' and ');
      rejectionReason = `${tooEasy.length} of your questions were BELOW ${grade} level — they can be answered in a single step, from one formula or one remembered fact. Rejected: ${examples}. Write harder questions on the same chapters: at least two distinct steps, or two concepts combined.`;
      console.warn(`Difficulty check rejected ${tooEasy.length}/${tooEasy.length + survivors.length} candidate(s) as below ${grade} level.`);
    }
    if (!survivors.length) {
      if (!tooEasy.length) {
        rejectionReason = 'every question you returned failed structural validation (bad chapterId, fewer than 4 distinct options, missing correctIndex, or a duplicate of one already asked).';
      }
      continue;
    }

    // Place each surviving question into the slot for ITS chapter.
    survivors.forEach((q) => {
      const slot = missing.find(({ s, i: idx }) => !filled[idx] && s.chapter.id === q.chapterId);
      if (slot) filled[slot.i] = q;
      else belowLevelReserve.push(q);   // right level, wrong chapter — keep as reserve
    });
  }

  const accepted = filled.filter(Boolean);

  // Every candidate was flagged below level. Those are still valid, on-syllabus
  // questions — just easy ones — so serving them beats blocking the student, but
  // only as a last resort, and it is logged so the pattern stays visible.
  if (!accepted.length && belowLevelReserve.length) {
    console.warn(`Diagnostic round: every candidate was below level after ${MAX_ATTEMPTS} attempts — serving them rather than blocking the student.`);
    return belowLevelReserve.slice(0, specs.length).map(stripAudit);
  }

  if (!accepted.length) {
    throw new Error('Groq returned no usable diagnostic questions after retries.');
  }
  if (accepted.length < specs.length) {
    console.warn(`Diagnostic round: filled ${accepted.length}/${specs.length} chapter slots — proceeding with a shorter round.`);
  }
  return accepted.map(stripAudit);
}