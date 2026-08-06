// Feature 27 — what the Voice Mentor knows, assembled ON DEMAND from the models that
// already own it.
//
// THERE IS NO "MENTOR STATE" COLLECTION, AND THERE MUST NEVER BE ONE.
//
// The obvious design is a small document recording which roadmap and day the child was
// last on. It is obvious, it is cheap, and it is wrong: it is a SECOND record of
// something the Roadmap already knows, and two records of one fact is a state that can
// disagree.
//
// What makes the disagreement dangerous here rather than merely untidy is that the
// mentor does not fail visibly. It speaks, with complete confidence, in a voice the
// child has been told to trust — "open day four, watch the video" — about a day they
// finished last week. A child who cannot read the screen cannot see that the mentor is
// wrong, cannot check, and cannot describe the problem to anyone. Every other stale
// cache in this codebase produces something a student can notice. This one produces a
// confident instruction to do the wrong thing.
//
// So: the roadmap is authoritative about its own progress, and this module READS. It
// holds nothing, writes nothing, and is recomputed per request. It is also read-only
// with respect to progress in the strict sense Mentor chat (Feature 17) established —
// it never marks a day complete, never records a quiz result, never touches weak-topic
// data. The single signal the mentor may emit is the account-wide "studied today"
// marker, and only through the existing `recordStudyActivity` path, called by the route
// rather than from here.

import Roadmap from '../models/Roadmap.js';
import PracticeSession from '../models/PracticeSession.js';
import Note from '../models/Note.js';

/**
 * Is a day's VIDEO requirement satisfied?
 *
 * OR logic across the day's videos (Feature 8): a day counts when ANY of its videos is
 * watched. The deprecated scalar `videoWatched` is still consulted so a day recorded
 * before per-video tracking existed does not read as unwatched — a child would be sent
 * back to a video they finished months ago.
 */
function videoDone(day) {
  if (Array.isArray(day?.videoProgress) && day.videoProgress.some((v) => v?.watched)) return true;
  return !!day?.videoWatched;
}

function quizDone(day) {
  return !!day?.moduleQuizAttempt?.passed;
}

/**
 * The day the child is actually on, and precisely what it still needs.
 *
 * `completed` is the Feature 9 gate — video watched AND quiz passed — and it is
 * computed by the roadmap routes, not here. This mirrors the rule the dashboard already
 * uses (first not-completed day) so the mentor and the screen can never point at
 * different days.
 *
 * `needs` exists so the mentor speaks the RIGHT instruction rather than a generic one.
 * Telling a child who has watched the video to "watch the video" reads, to them, as the
 * mentor not knowing what they have done — which is the exact impression this whole
 * module is built to avoid.
 */
function currentDayOf(roadmap) {
  const days = roadmap?.days || [];
  const idx = days.findIndex((d) => !d.completed);
  if (idx === -1) return null;                   // every day complete

  const day = days[idx];
  const v = videoDone(day);
  const q = quizDone(day);
  return {
    dayNumber: day.dayNumber,
    topic: day.topic || '',
    // What is LEFT, not what is done — the mentor speaks in next actions.
    needs: !v && !q ? 'both' : (!v ? 'video' : 'quiz'),
    videoDone: v,
    quizDone: q,
    // Retakes are allowed, so an attempted-but-failed quiz is a different situation
    // from an untouched one and deserves a different sentence.
    quizAttempted: !!day?.moduleQuizAttempt?.attempted
  };
}

/**
 * Assemble the mentor's context for one student.
 *
 * Returns FACTS, NEVER SENTENCES. The client turns facts into line ids, and line ids
 * resolve to fixed strings that are cached forever. If this function returned prose,
 * every reply would be a new string, every string would need synthesising, and the
 * feature's entire cost model would collapse — a per-child, per-request TTS bill in
 * place of a one-time one.
 */
export async function buildMentorContext(userId) {
  const [roadmaps, practiceCount, noteCount] = await Promise.all([
    // Active courses only. An archived roadmap is a course the student regenerated or
    // replaced, and guiding them back into one would be guiding them into work that no
    // longer counts toward anything.
    Roadmap.find({ userId, archived: { $ne: true } })
      .select('grade subject subSubject totalDays days.dayNumber days.topic days.completed days.videoProgress days.videoWatched days.moduleQuizAttempt createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    PracticeSession.countDocuments({ userId }),
    Note.countDocuments({ userId })
  ]);

  const courses = roadmaps.map((r) => {
    const days = r.days || [];
    return {
      roadmapId: String(r._id),
      grade: r.grade,
      subject: r.subject,
      subSubject: r.subSubject || '',
      totalDays: r.totalDays,
      completedDays: days.filter((d) => d.completed).length,
      currentDay: currentDayOf(r)
    };
  });

  // The most recently created active roadmap is the one the dashboard opens on, so it
  // is the one the mentor should talk about by default.
  const active = courses[0] || null;

  return {
    hasRoadmap: courses.length > 0,
    active,
    courses,
    practiceSessions: practiceCount,
    notes: noteCount,
    // Every day of the active course is finished. A real state, and a different
    // sentence from "you have no roadmap" — one is an achievement, the other is a
    // starting point, and conflating them would congratulate a child who has done
    // nothing or ignore one who has done everything.
    allDone: !!active && active.currentDay === null
  };
}
