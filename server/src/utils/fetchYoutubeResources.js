// Real YouTube Data API v3 integration helper for Project Eklavya.
//
// ── DEVICE-TESTING FINDING D: a Class 1 Maths day served a video about natural,
//    whole, rational and prime numbers. ─────────────────────────────────────
//
// The query wording was the obvious suspect and it was NOT the main cause. Two
// structural defects in the selection did far more damage:
//
// 1. THE PREFERRED-CHANNEL LIST WAS SECONDARY-AND-ABOVE, ONLY.
//    `['Physics Wallah', 'Vedantu', 'Unacademy', 'Khan Academy India', 'Aakash']` —
//    Physics Wallah, Unacademy and Aakash are JEE/NEET coaching brands. There was no
//    primary-education channel in it at all. For a Class 1 search the filter therefore
//    PREFERRED the least age-appropriate results available.
//
// 2. IT WAS WINNER-TAKE-ALL.
//    `filteredPreferred.length > 0 ? filteredPreferred : sanitizedResources` — one
//    coaching-channel match ELIMINATED every other result, however much better. A
//    preferred channel should raise a result's rank, not delete its competition.
//
// Both are fixed below: the channel list is banded by grade, and preference is now a
// SCORE rather than a filter.

import { GRADES, normalizeGrade } from '../config/taxonomy.js';

// ── Grade bands ─────────────────────────────────────────────────────────────
// Primary is everything up to and including Class 5 — the same boundary the Voice
// Mentor and the day-content anchor use, because it is the same question: is this a
// child who is still learning to read?
const PRIMARY_MAX = 'Class 5';

function gradeIndex(grade) {
  const n = normalizeGrade(grade);
  return GRADES.findIndex((g) => normalizeGrade(g) === n);
}

export function isPrimaryGrade(grade) {
  const gi = gradeIndex(grade);
  const pi = gradeIndex(PRIMARY_MAX);
  // An UNKNOWN grade is treated as primary. Design Rule 19 — guess in the direction
  // whose failure is recoverable: showing a Class 10 student a children's video wastes
  // a click, showing a six-year-old a NEET video is the defect this whole file is
  // being rewritten for.
  return gi < 0 || gi <= pi;
}

// Channels that actually make primary-school content for Indian curricula. Deliberately
// NOT the coaching brands: none of them makes material for a six-year-old, and their
// presence in the list is what caused the defect.
const PRIMARY_CHANNELS = [
  'Khan Academy Kids', 'Khan Academy India', 'Peekaboo Kidz', 'ChuChu TV',
  'Magnet Brains', 'Learning Junction', 'Smile and Learn', 'Kids Learning Tube',
  'DeltaStep', 'Bodhaguru', 'Periwinkle', 'CBSE Class 1', 'EduMantra'
];

// The original list, kept for the grades it was actually right for.
const SECONDARY_CHANNELS = [
  'Physics Wallah', 'Vedantu', 'Unacademy', 'Khan Academy India', 'Aakash',
  'Magnet Brains', 'LearnoHub', 'Doubtnut'
];

// Words that mark a video as being for a much older student. Used to PUSH DOWN, never
// to hard-filter: a legitimate Class 5 video may mention "fractions" in a title
// alongside something else, and a hard filter on a noisy signal drops good results.
const TOO_ADVANCED_HINTS = [
  'rational number', 'irrational', 'integer', 'prime number', 'whole number',
  'natural number', 'jee', 'neet', 'board exam', 'class 9', 'class 10', 'class 11',
  'class 12', 'algebra', 'trigonometry', 'polynomial', 'quadratic', 'calculus'
];

export async function fetchYoutubeResources(topic, subject, grade) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'YOUR_REGENERATED_YOUTUBE_API_KEY' || apiKey.trim() === '') {
    console.warn('YouTube API Key not configured or placeholder used. Returning empty resources array.');
    return [];
  }

  const primary = isPrimaryGrade(grade);

  try {
    // Track 4.1 fix: `grade` already carries "Class N", so no literal "class " prefix.
    // For primary the query says WHO it is for, in the words a channel would use in its
    // own title — "for kids" matches far more primary material than a class number does,
    // because primary content is rarely labelled by CBSE class.
    const query = primary
      ? `${topic} ${subject} for kids ${grade} easy explanation`
      : `${topic} ${subject} ${grade} explanation`;

    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      regionCode: 'IN',
      relevanceLanguage: 'hi',
      // Ask for more than we need so ranking has something to rank. With maxResults=5
      // and a winner-take-all filter there was often only one candidate.
      maxResults: '15',
      // `strict` on every grade, not just primary: this is a state-government
      // deployment for schoolchildren and there is no grade at which the moderate
      // setting is the right default.
      safeSearch: 'strict',
      videoEmbeddable: 'true',
      key: apiKey
    });
    // A small child will not watch a 40-minute lecture, and length is a strong proxy
    // for "this was made for an exam candidate".
    if (primary) params.set('videoDuration', 'short');

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    if (!response.ok) {
      console.warn(`YouTube Data API responded with status ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.items)) return [];

    const allResources = data.items
      .filter((item) => item?.id?.videoId && item?.snippet?.title && item?.snippet?.channelTitle)
      .map((item) => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        type: 'youtube',
        channel: item.snippet.channelTitle
      }));

    // Explicit brand exclusion, unchanged.
    let sanitized = allResources.filter((r) => !r.channel.toLowerCase().includes('byju'));
    if (!sanitized.length) return [];

    // ── SHORTS ARE NOT TEACHING VIDEOS (primary grades) ────────────────────
    //
    // A live check for Class 1 returned a promo Short in the top three: "Here's a fun
    // way to teach your kids their numbers. #MathsTeacher #MathsFun #TuitionCentre".
    //
    // That is a CATEGORY error, not a ranking one, which is why it is filtered rather
    // than down-weighted. A Short is an advertisement for teaching; the day page tells a
    // child "watch this video all the way through, then answer the questions", and a
    // 30-second clip cannot carry a lesson. No amount of title scoring fixes a thing
    // that is the wrong kind of object.
    //
    // Detected by DURATION, not by hashtags — the observed Short carried none. One
    // extra API call (`videos.list` accepts up to 50 ids at once), and it fails OPEN:
    // if the lookup errors, every candidate is kept. A filter that empties the list on
    // a network blip would turn a degraded day into a video-less one.
    if (primary && sanitized.length) {
      try {
        const ids = sanitized.map((r) => r.url.split('v=')[1]).filter(Boolean).slice(0, 50);
        const detailUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids.join(',')}&key=${apiKey}`;
        const dRes = await fetch(detailUrl);
        if (dRes.ok) {
          const dData = await dRes.json();
          const seconds = new Map();
          for (const item of dData.items || []) {
            // ISO-8601 duration, e.g. PT4M13S.
            const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(item?.contentDetails?.duration || '');
            if (m) seconds.set(item.id, (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
          }
          // 90s. Comfortably above the Shorts ceiling and below any real lesson —
          // the shortest genuine primary videos in the live check (a counting song,
          // a place-value explainer) run several minutes.
          const MIN_LESSON_SECONDS = 90;
          const kept = sanitized.filter((r) => {
            const id = r.url.split('v=')[1];
            const s = seconds.get(id);
            return s === undefined || s >= MIN_LESSON_SECONDS;   // unknown duration is kept
          });
          // Never empty the list on this filter alone: a day with no video at all is a
          // worse outcome than a day whose third video is short.
          if (kept.length) sanitized = kept;
        }
      } catch {
        // Fail open — see above.
      }
    }

    const preferred = primary ? PRIMARY_CHANNELS : SECONDARY_CHANNELS;

    // ── Ranking, not filtering ──────────────────────────────────────────────
    // Search order is itself a signal, so it is the baseline and the adjustments move
    // results around it. Nothing is eliminated: the worst outcome of a bad score is a
    // lower position, never an empty list.
    const scored = sanitized.map((r, idx) => {
      let score = -idx;                                     // keep YouTube's own ordering as the base
      const chan = r.channel.toLowerCase();
      const title = r.title.toLowerCase();

      if (preferred.some((p) => chan.includes(p.toLowerCase()))) score += 20;

      if (primary) {
        // Being explicitly for children counts for as much as a known channel: the good
        // primary material is long-tail and mostly comes from channels not on any list.
        if (/\b(kids?|children|beginner|toddler|nursery|primary)\b/.test(title)) score += 12;
        if (/\bclass\s*[1-5]\b/.test(title)) score += 8;
        // The actual observed failure: a title that is plainly for an older student.
        if (TOO_ADVANCED_HINTS.some((h) => title.includes(h))) score -= 25;
        // A class number four years above is the clearest possible mismatch.
        if (/\bclass\s*(6|7|8|9|1[012])\b/.test(title)) score -= 30;
      }
      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Deduplicate. The live check returned the SAME title from the same channel twice
    // in the top three for "Class 2 Addition" — YouTube serves genuinely distinct video
    // ids for re-uploads and near-identical cuts, so id-uniqueness is not enough. A day
    // offering the same video twice looks broken, and for a child being told "watch the
    // videos" it is worse than that: they watch one, are told to watch the next, and it
    // is the one they just watched.
    const seen = new Set();
    const unique = scored.filter((r) => {
      const key = `${r.channel}::${r.title}`.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, 3).map(({ score, ...r }) => r);   // drop the internal score
  } catch (error) {
    console.warn('fetchYoutubeResources error:', error.message);
    return [];
  }
}

export default fetchYoutubeResources;
