// THE TWO PROOFS committed to for Workstream B.
//
// 1. The raw stored User document and the GET /api/auth/me payload, dumped, showing
//    no plaintext Aadhaar in either and XXXX XXXX 1234 on read.
// 2. Reverse geocode: coordinates appear in NO log line and NO database field —
//    proven by grepping the captured server log and dumping the stored document.
//
// Plus the request-body leak class: a deliberately malformed Aadhaar is submitted to
// trigger the error path, then the log is grepped for the digits.
//
// Run against a server whose stdout/stderr is captured to LOG_FILE.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { verhoeffCheckDigit } from './src/utils/verhoeff.js';
dotenv.config();

const API = `http://localhost:${process.env.TEST_PORT || 5000}/api`;
const LOG_FILE = process.env.LOG_FILE || '/tmp/srvB.log';

const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const out = [];
const check = (n, pass, d = '') => { out.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

// A checksum-valid Aadhaar, and a deliberately corrupted one for the error path.
const BASE = '23456789012';
const VALID = BASE + verhoeffCheckDigit(BASE);
const MALFORMED = BASE + ((verhoeffCheckDigit(BASE) + 1) % 10);
// Coordinates that must never appear anywhere. Distinctive so a grep is unambiguous.
const LAT = 29.9457123;
const LON = 76.8112456;

console.log(`test Aadhaar ....${VALID.slice(-4)} | malformed ....${MALFORMED.slice(-4)} | coords ${LAT},${LON}\n`);

const su = await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: 'Privacy Test', email: `priv.${Date.now()}@t.test`, password: 'TestPass1!' }) });
const token = su.body.token;
await mongoose.connect(process.env.MONGODB_URI);
const userId = new mongoose.Types.ObjectId(JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).userId);
const users = mongoose.connection.collection('users');

// ── A. Malformed Aadhaar must be rejected WITHOUT echoing the value ─────────
console.log('── A. error path must not echo or log the value ──');
const bad = await j('/auth/profile-details', {
  method: 'PATCH',
  body: JSON.stringify({
    age: 15, studyMedium: 'Haryana Board (HBSE)', fatherName: 'Ram Kumar',
    schoolName: 'Govt Sr Sec School', schoolCity: 'Kurukshetra',
    aadhaarNumber: MALFORMED, aadhaarConsent: true
  })
}, token);
check('malformed Aadhaar rejected', bad.status === 400, `status ${bad.status}`);
console.log('  response body: ' + JSON.stringify(bad.body));
check('response does NOT echo the submitted digits', !JSON.stringify(bad.body).includes(MALFORMED));
check('nothing was saved on the failed request', !(await users.findOne({ _id: userId }))?.profile?.aadhaarLast4);

// ── B. Successful save ─────────────────────────────────────────────────────
console.log('\n── B. successful save ──');
const ok = await j('/auth/profile-details', {
  method: 'PATCH',
  body: JSON.stringify({
    age: 15, studyMedium: 'Haryana Board (HBSE)', fatherName: 'Ram Kumar',
    schoolName: 'Govt Sr Sec School', schoolCity: 'Kurukshetra',
    phoneNumber: '+91 98765 43210',
    aadhaarNumber: VALID, aadhaarConsent: true
  })
}, token);
check('profile saved', ok.status === 200, `status ${ok.status}`);
check('phone normalised (+91/spaces stripped)', ok.body?.profile?.phoneNumber === '9876543210', ok.body?.profile?.phoneNumber);

// ── PROOF 1: the raw stored document ───────────────────────────────────────
console.log('\n══ PROOF 1a — RAW STORED User DOCUMENT (straight from MongoDB) ══');
const raw = await users.findOne({ _id: userId });
console.log(JSON.stringify({ name: raw.name, onboardingCompleted: raw.onboardingCompleted, profile: raw.profile }, null, 2));
const rawStr = JSON.stringify(raw);
check('plaintext Aadhaar absent from the stored document', !rawStr.includes(VALID));
check('ciphertext IS stored (so it was encrypted, not dropped)', !!raw.profile?.aadhaarEncrypted?.ciphertext);
check('only last4 is stored in plaintext', raw.profile?.aadhaarLast4 === VALID.slice(-4), raw.profile?.aadhaarLast4);
check('consent timestamp recorded', !!raw.profile?.aadhaarConsentAt);
check('no coordinate field exists on the document', !/latitude|longitude/i.test(rawStr));

console.log('\n══ PROOF 1b — GET /api/auth/me PAYLOAD (what the client receives) ══');
const me = await j('/auth/me', {}, token);
console.log(JSON.stringify(me.body.user.profile, null, 2));
const meStr = JSON.stringify(me.body);
check('plaintext Aadhaar absent from /me', !meStr.includes(VALID));
check('/me shows the masked form', me.body.user.profile.aadhaarMasked === `XXXX XXXX ${VALID.slice(-4)}`, me.body.user.profile.aadhaarMasked);
check('encrypted envelope absent from /me', !meStr.includes('ciphertext') && !meStr.includes('authTag'));
check('/me reports onboardingCompleted', me.body.user.onboardingCompleted === true);

// ── PROOF 2: reverse geocode ───────────────────────────────────────────────
console.log('\n══ PROOF 2 — REVERSE GEOCODE: coordinates in no log line, no DB field ══');
const geo = await j('/auth/reverse-geocode', { method: 'POST', body: JSON.stringify({ latitude: LAT, longitude: LON }) }, token);
console.log(`  response: ${JSON.stringify(geo.body)}`);
check('reverse-geocode responds without coordinates in the body',
  !JSON.stringify(geo.body).includes(String(LAT)) && !JSON.stringify(geo.body).includes(String(LON)));

if (geo.body?.resolved && geo.body.location) {
  await j('/auth/profile-details', {
    method: 'PATCH',
    body: JSON.stringify({
      age: 15, studyMedium: 'Haryana Board (HBSE)', fatherName: 'Ram Kumar',
      schoolName: 'Govt Sr Sec School', schoolCity: 'Kurukshetra',
      location: geo.body.location
    })
  }, token);
}
const raw2 = await users.findOne({ _id: userId });
console.log(`  stored location: ${JSON.stringify(raw2.profile?.location)}`);
const raw2Str = JSON.stringify(raw2);
check('latitude absent from the stored document', !raw2Str.includes(String(LAT)) && !raw2Str.includes(String(LAT).replace('.', '')));
check('longitude absent from the stored document', !raw2Str.includes(String(LON)) && !raw2Str.includes(String(LON).replace('.', '')));
check('only village/city/state stored', Object.keys(raw2.profile?.location || {}).every((k) => ['village', 'city', 'state'].includes(k)),
  Object.keys(raw2.profile?.location || {}).join(','));

// ── LOG GREP: the class of bug that catches request-body leaks ──────────────
console.log('\n══ LOG GREP — the captured server log must contain none of it ══');
if (!existsSync(LOG_FILE)) {
  check('server log available to grep', false, `LOG_FILE not found at ${LOG_FILE}`);
} else {
  const log = readFileSync(LOG_FILE, 'utf8');
  console.log(`  scanned ${log.split('\n').length} log lines from ${LOG_FILE}`);
  check('valid Aadhaar digits absent from the log', !log.includes(VALID));
  check('MALFORMED Aadhaar digits absent from the log (error path)', !log.includes(MALFORMED));
  check('first 8 Aadhaar digits absent from the log', !log.includes(VALID.slice(0, 8)));
  check('latitude absent from the log', !log.includes(String(LAT)));
  check('longitude absent from the log', !log.includes(String(LON)));
  check('no request body was dumped', !/aadhaarNumber/.test(log));
}

await users.deleteOne({ _id: userId });
await mongoose.disconnect();

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
