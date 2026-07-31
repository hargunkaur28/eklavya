// The guarantee is ABSENCE, not falsiness.
//
// `publicProfile()` omits the Aadhaar keys entirely for a parent or admin session. That
// is deliberately stronger than "no raw value leaks": a client that forgets to check
// the role cannot render a key that is not there, whereas `aadhaarMasked: null` or
// `aadhaarOnFile: false` is a field a careless component will happily bind to and
// display as an empty row labelled "Aadhaar".
//
// Worth re-asserting after Workstream F/G: /signup and /login now emit the full
// `profile` object through the shared sessionUser() builder, so they carry this
// guarantee for the first time. `test:privacy` asserts no raw value leaks, which is
// the weaker property and would pass on a null-valued key.
import dotenv from 'dotenv';
dotenv.config();

const API = 'http://localhost:5000/api';
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };
const AADHAAR_KEYS = ['aadhaarMasked', 'aadhaarOnFile', 'aadhaarConsentAt'];

const email = `abs.${Date.now()}@t.test`;
const password = 'TestPass1!';

// Student session — the keys SHOULD be present here.
const su = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Absence Test', email, password })
})).json();
const SH = { 'Content-Type': 'application/json', Authorization: `Bearer ${su.token}` };

const studentKeys = Object.keys(su.user?.profile || {});
console.log(`   student /signup profile keys: ${studentKeys.join(', ') || '(none)'}`);
check('FIXTURE: a STUDENT session does carry the Aadhaar keys (so absence below is meaningful)',
  AADHAAR_KEYS.every((k) => studentKeys.includes(k)),
  AADHAAR_KEYS.filter((k) => !studentKeys.includes(k)).join(', ') || 'all present');

// Create parent access, then sign in as the parent on the SAME email (Option B).
const gen = await (await fetch(`${API}/auth/parent/generate`, { method: 'POST', headers: SH })).json();
const tempPassword = gen.tempPassword || gen.password || gen.temporaryPassword;
check('FIXTURE: parent access was created', !!tempPassword, tempPassword ? 'temp password issued' : JSON.stringify(gen).slice(0, 80));

if (tempPassword) {
  const parentLogin = await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: tempPassword })
  })).json();

  const PH = { Authorization: `Bearer ${parentLogin.token}` };
  const parentMe = await (await fetch(`${API}/auth/me`, { headers: PH })).json();

  for (const [label, payload] of [['/auth/login (parent)', parentLogin], ['/auth/me (parent)', parentMe]]) {
    const profile = payload.user?.profile;
    const keys = Object.keys(profile || {});
    console.log(`   ${label} role=${payload.user?.role} profile keys: ${keys.join(', ') || '(none)'}`);

    const present = AADHAAR_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(profile || {}, k));
    // hasOwnProperty, NOT truthiness — a key holding null/''/false is still a key a
    // client can bind to, and that is exactly what this guarantee forbids.
    check(`${label} OMITS the Aadhaar keys entirely (absent, not falsy)`,
      present.length === 0,
      present.length ? `PRESENT: ${present.map((k) => `${k}=${JSON.stringify(profile[k])}`).join(', ')}` : 'all absent');

    check(`${label} carries no raw Aadhaar value either`,
      !/aadhaarNumber|aadhaarEncrypted/.test(JSON.stringify(payload)));
  }
}

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
