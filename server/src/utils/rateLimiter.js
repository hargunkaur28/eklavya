// Phase 6: shared in-memory sliding-window rate limiter, extracted so login and
// admin-login use ONE implementation (reuse, don't duplicate the Phase 4 pattern).
// Counts only the events the caller records (we record FAILURES only), so
// successful logins never consume the budget and a shared IP isn't penalised.
//
// Note: in-memory + per-process (fine for this single-instance deploy). If the
// backend is ever horizontally scaled, this would need a shared store (e.g. Redis).
export function createFailureRateLimiter({ windowMs, max, cleanupMs = 5 * 60 * 1000 }) {
  const hits = new Map(); // key -> number[] (timestamps within the window)

  const prune = (key, now) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    hits.set(key, recent);
    return recent;
  };

  // Periodic sweep so idle keys don't leak memory.
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of hits.entries()) {
      const active = timestamps.filter((t) => now - t < windowMs);
      if (active.length === 0) hits.delete(key);
      else hits.set(key, active);
    }
  }, cleanupMs);
  if (typeof timer.unref === 'function') timer.unref(); // don't keep the process alive

  return {
    isLimited(key) {
      return prune(key, Date.now()).length >= max;
    },
    record(key) {
      const now = Date.now();
      const recent = prune(key, now);
      recent.push(now);
      hits.set(key, recent);
    }
  };
}
