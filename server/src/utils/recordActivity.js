import User from '../models/User.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Phase 8: record an account-wide "studied today" marker. `localDate` is the
// student's local YYYY-MM-DD (sent by the client, so day boundaries respect the
// student's timezone). Deduped via $addToSet; never throws (fire-and-forget).
export async function recordStudyActivity(userId, localDate) {
  try {
    if (!userId || typeof localDate !== 'string' || !DATE_RE.test(localDate)) return;
    await User.updateOne({ _id: userId }, { $addToSet: { studyDates: localDate } });
  } catch (err) {
    console.warn('recordStudyActivity failed:', err.message);
  }
}
