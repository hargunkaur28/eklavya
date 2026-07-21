// Phase 8: account-wide study streaks, computed from local 'YYYY-MM-DD' dates.
// Day boundaries use the browser's local time (an accepted simplification — a
// student's timezone is respected because the client stamps its own local date).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local YYYY-MM-DD (en-CA formats as ISO-like Y-M-D in the browser's timezone).
export function getLocalDate(d = new Date()) {
  return d.toLocaleDateString('en-CA');
}

function toLocalMidnight(str) {
  const [y, m, day] = str.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function dayDiff(a, b) {
  return Math.round((toLocalMidnight(a) - toLocalMidnight(b)) / 86400000);
}

// Returns { current, longest }. `current` counts the run ending today OR
// yesterday (so a streak stays "alive" until the day ends without study).
export function computeStreaks(dates) {
  const uniq = [...new Set(dates || [])].filter((s) => DATE_RE.test(s)).sort();
  if (uniq.length === 0) return { current: 0, longest: 0 };

  let longest = 1, run = 1;
  for (let i = 1; i < uniq.length; i++) {
    if (dayDiff(uniq[i], uniq[i - 1]) === 1) run += 1; else run = 1;
    if (run > longest) longest = run;
  }

  const today = getLocalDate();
  const yesterday = getLocalDate(new Date(Date.now() - 86400000));
  const last = uniq[uniq.length - 1];
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = uniq.length - 1; i > 0; i--) {
      if (dayDiff(uniq[i], uniq[i - 1]) === 1) current += 1; else break;
    }
  }
  return { current, longest };
}
