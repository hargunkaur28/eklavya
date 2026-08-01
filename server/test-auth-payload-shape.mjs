// /signup, /login and /me must return the SAME user shape.
//
// They did not, and that is exactly how a real bug shipped: the signup payload omitted
// `onboardingCompleted` while /login and /me both returned it. The client gate is
// `onboardingCompleted === false` — strict on purpose so a legacy session whose field
// is absent is never trapped — which makes ABSENCE and FALSE behave oppositely. A new
// student arrived with `undefined`, and signup walked straight past the profile flow
// into subject selection.
//
// Every check that existed passed, because they all read /me.
//
// This asserts the SHAPES MATCH rather than asserting one particular field is present.
// A field-specific test fixes this instance; a shape test prevents the next one, and
// there will be a next one — any field added to /me alone diverges the same way.
import dotenv from 'dotenv';
dotenv.config();

const API = 'http://localhost:5000/api';
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const email = `shape.${Date.now()}@t.test`;
const password = 'TestPass1!';

const signup = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Shape Test', email, password })
})).json();
if (!signup.token) { console.error('signup failed', signup); process.exit(1); }

const login = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
})).json();

const me = await (await fetch(`${API}/auth/me`, {
  headers: { Authorization: `Bearer ${signup.token}` }
})).json();

const keys = (o) => Object.keys(o || {}).sort();
const shapes = {
  '/auth/signup': keys(signup.user),
  '/auth/login': keys(login.user),
  '/auth/me': keys(me.user)
};
for (const [route, k] of Object.entries(shapes)) console.log(`   ${route.padEnd(14)} ${k.join(', ')}`);
console.log('');

const union = [...new Set(Object.values(shapes).flat())].sort();
for (const [route, k] of Object.entries(shapes)) {
  const missing = union.filter((f) => !k.includes(f));
  check(`${route} returns the full user shape`, missing.length === 0,
    missing.length ? `MISSING: ${missing.join(', ')}` : `${k.length} fields`);
}

// The field this bug was actually about, asserted by VALUE as well as presence —
// `undefined` and `false` are different states and the client treats them oppositely.
for (const [route, payload] of [['/auth/signup', signup], ['/auth/login', login], ['/auth/me', me]]) {
  check(`${route} reports onboardingCompleted as a real boolean, not undefined`,
    typeof payload.user?.onboardingCompleted === 'boolean',
    `${JSON.stringify(payload.user?.onboardingCompleted)}`);
}
check('a brand-new student is onboardingCompleted:false everywhere',
  signup.user?.onboardingCompleted === false && me.user?.onboardingCompleted === false,
  `signup=${signup.user?.onboardingCompleted} me=${me.user?.onboardingCompleted}`);


// ── ADMIN SESSION RESTORE ──────────────────────────────────────────────────
//
// Added after an admin was logged out by EVERY page refresh. GET /auth/me threw on
// the admin branch — it referenced getAdminCreds without importing it, and behind
// that referenced  before its  declaration — so it returned 500. The
// client treats any non-ok /auth/me as an invalid token and clears it, so a server
// bug presented as an auth problem and nothing in the admin panel survived a reload.
//
// Every check in this file used a STUDENT token, so the whole admin branch was
// unexercised and had evidently never run since it was written. Same blind-harness
// shape as Rule 11: the suite was green about a path it never touched.
{
  const jwt = (await import("jsonwebtoken")).default;
  const adminToken = jwt.sign({ role: "admin", adm: true }, process.env.JWT_SECRET, { expiresIn: "5m" });
  const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } });
  check('an ADMIN token can restore its session via /auth/me', res.status === 200, `HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  check("the admin session carries role:admin", body.user?.role === "admin", JSON.stringify(body.user));
  // Login and refresh must agree, which is what this whole file is about.
  check("the admin session shape matches what /admin/login returns",
    body.user && "id" in body.user && "name" in body.user && "email" in body.user && "role" in body.user,
    JSON.stringify(body.user));
  check("the admin session reports mustChangePassword as a real boolean",
    typeof body.mustChangePassword === "boolean", JSON.stringify(body.mustChangePassword));
}

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
