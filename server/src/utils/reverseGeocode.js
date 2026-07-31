// Workstream B3 — reverse geocoding via Nominatim (OpenStreetMap).
//
// Nominatim needs no API key, which is why it is used. Its usage policy is a
// CONDITION of that free tier, not a suggestion: an identifying User-Agent is
// mandatory and requests are limited to roughly 1/second. Ignoring either gets the
// deployment blocked, so both are enforced here rather than left to the caller.
//
// PRIVACY: coordinates are function arguments and nothing more. They are used to
// build one outbound URL and are never returned to the client, never written to any
// database field (the schema has none), and never logged — not in success paths, not
// in error paths. Only { village, city, state } leaves this module.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

// Nominatim's policy requires a real identifying UA with contact info.
const CONTACT = process.env.NOMINATIM_CONTACT || 'contact-unset@project-eklavya.local';
const USER_AGENT = `ProjectEklavya/1.0 (educational platform; ${CONTACT})`;

const REQUEST_TIMEOUT_MS = 6000;

/**
 * Round coordinates to ~1 km before they are used as a cache key.
 *
 * Two reasons. It makes the cache actually hit for students in the same
 * village/town, and it means the in-memory key is not a precise location even
 * transiently — the cache holds a coarse grid reference, not a student's position.
 */
function coarseKey(lat, lon) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

// Small in-memory cache. Bounded and TTL'd; holds only the coarse key and the
// resolved place names, never the precise coordinates.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

// Nominatim asks for no more than ~1 request/second across a deployment.
let lastCallAt = 0;
const MIN_INTERVAL_MS = 1100;

async function respectPolicyDelay() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** Are the supplied coordinates real numbers in range? */
export function validCoords(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Resolve coordinates to { village, city, state }.
 * Returns null when the lookup fails — the caller falls back to manual entry.
 * Throws nothing that could carry the coordinates in its message.
 */
export async function reverseGeocode(lat, lon) {
  const key = coarseKey(lat, lon);
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=12&addressdetails=1&accept-language=en`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await respectPolicyDelay();
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) {
      // Status only. The URL contains the coordinates, so it is never logged.
      console.warn(`Nominatim reverse geocode returned HTTP ${res.status}.`);
      return null;
    }
    const data = await res.json();
    const a = data?.address || {};

    const value = {
      village: String(a.village || a.hamlet || a.suburb || '').slice(0, 80),
      city: String(a.city || a.town || a.municipality || a.county || '').slice(0, 80),
      state: String(a.state || '').slice(0, 80)
    };
    if (!value.village && !value.city && !value.state) return null;

    cacheSet(key, value);
    return value;
  } catch (err) {
    // err.message from an aborted fetch does not include the URL, but be explicit:
    // log a fixed string rather than the error, so no future change can leak it.
    console.warn('Nominatim reverse geocode failed (timeout or network error).');
    return null;
  } finally {
    clearTimeout(timer);
  }
}
