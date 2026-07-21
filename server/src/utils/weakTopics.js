import { translateTextWithSarvam } from './translateAndCache.js';

// Phase 6: shared weak-topic aggregation, extracted from the roadmap route so the
// student view, the parent dashboard, and the admin panel all compute it ONE way
// (reuse, don't duplicate). Callers control whether the lazy Hindi translate is
// allowed to PERSIST via `allowSave` — students true, parents/admin false (read-only).

// Phase 4: a sub-topic is "weak" below 60% average accuracy (needs >= 2 answered
// questions so a single miss doesn't flag it). Feeds Phase 7 remediation.
export const WEAK_TOPIC_THRESHOLD = 0.6;
export const WEAK_TOPIC_MIN_QUESTIONS = 2;

// Normalize a sub-topic label so casing/whitespace drift collapses.
export function normalizeTopic(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
}

// Ensure day.subtopicsHindi mirrors day.subtopics (same order). Per-item lazy
// retry: items whose cached "Hindi" is still just the English source are
// re-attempted on each Hindi read (terse math terms can fail under rate limits),
// so a failed translation is never cached as final. Returns true if it mutated.
export async function ensureSubtopicsHindi(day) {
  const subs = day.subtopics || [];
  if (subs.length === 0) return false;
  const cur = day.subtopicsHindi || [];

  let changed = false;
  const hi = [];
  for (let i = 0; i < subs.length; i++) {
    const existing = cur[i];
    if (existing && existing.trim() && existing.trim() !== subs[i].trim()) {
      hi.push(existing); // already has a real translation
      continue;
    }
    const t = await translateTextWithSarvam(subs[i]);
    if (t && t.trim() !== subs[i].trim()) { hi.push(t); changed = true; }
    else { hi.push(subs[i]); } // fallback to English; will retry next Hindi read
  }

  if (changed || cur.length !== subs.length) { day.subtopicsHindi = hi; return true; }
  return false;
}

// Aggregate a roadmap's module-quiz results into per-sub-topic accuracy.
// `allowSave: true` lets a Hindi read populate+persist the subtopics cache
// (student's own view). Parents/admin pass `false` — they serve whatever Hindi is
// already cached and NEVER mutate the doc. Returns the exact shape the
// /roadmap/:id/weak-topics endpoint has always returned.
export async function computeWeakTopics(roadmap, { isHindi = false, allowSave = false } = {}) {
  const agg = new Map(); // normalizedKey -> { label, correct, total, days:Set }
  let hasAttempts = false;
  let mutated = false;
  const hiMap = new Map(); // normalized English sub-topic -> Hindi label

  for (const day of roadmap.days) {
    if (isHindi && (day.subtopics || []).length) {
      if (allowSave && await ensureSubtopicsHindi(day)) mutated = true;
      (day.subtopics || []).forEach((s, i) => {
        const hi = (day.subtopicsHindi || [])[i];
        if (hi) hiMap.set(normalizeTopic(s), hi);
      });
    }

    const attempt = day.moduleQuizAttempt;
    if (!attempt?.attempted || !(attempt.questions || []).length) continue;
    hasAttempts = true;

    for (const q of attempt.questions) {
      const key = normalizeTopic(q.topic || 'General');
      if (!key) continue;
      if (!agg.has(key)) {
        agg.set(key, { label: (q.topic || 'General').trim(), correct: 0, total: 0, days: new Set() });
      }
      const entry = agg.get(key);
      entry.total += 1;
      if (q.isCorrect) entry.correct += 1;
      entry.days.add(day.dayNumber);
    }
  }

  // Only students persist (allowSave); parents/admin never reach this branch.
  if (mutated && allowSave) { roadmap.markModified('days'); await roadmap.save(); }

  const allTopics = Array.from(agg.entries()).map(([key, e]) => ({
    subtopic: e.label, // English canonical (stable key)
    label: isHindi ? (hiMap.get(key) || e.label) : e.label, // localized display
    correct: e.correct,
    total: e.total,
    wrong: e.total - e.correct,
    accuracy: e.total > 0 ? e.correct / e.total : 0,
    days: Array.from(e.days).sort((a, b) => a - b)
  }));

  const weakTopics = allTopics
    .filter(tpc => tpc.total >= WEAK_TOPIC_MIN_QUESTIONS && tpc.accuracy < WEAK_TOPIC_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy);

  return {
    hasAttempts,
    threshold: WEAK_TOPIC_THRESHOLD,
    weakTopics,
    allTopics: allTopics.sort((a, b) => a.accuracy - b.accuracy)
  };
}
