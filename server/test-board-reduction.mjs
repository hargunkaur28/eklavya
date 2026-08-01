// Workstream H acceptance — the board list is CBSE + HBSE, and an account holding a
// removed board is neither broken nor trapped.
//
// The interesting cases are all about EXISTING data. Reducing a picker is easy; the
// failure modes live in what happens to the accounts that already answered, and in
// whether the server actually refuses the values the picker no longer offers (it
// previously accepted any string under 60 characters, because 'Other' unlocked free
// text — so 'ICSE' was a silent 200).
//
// Needs the server running (npm start) and MONGODB_URI set — it drives real routes
// and the real migration script, not mocks.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { execFileSync } from 'node:child_process';
import User from './src/models/User.js';
import { BOARDS } from './src/config/taxonomy.js';

dotenv.config();

// Port is overridable so this can run against an isolated instance without
// disturbing a dev server already holding 5000.
const API = `http://localhost:${process.env.TEST_PORT || 5000}/api`;
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const runScript = (...args) =>
  execFileSync(process.execPath, ['src/scripts/backfill-board.js', ...args], { encoding: 'utf8' });

const email = `board.${Date.now()}@t.test`;
const password = 'TestPass1!';

const signup = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Board Test', email, password })
})).json();
if (!signup.token) { console.error('signup failed', signup); process.exit(1); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${signup.token}` };

// ── 1. The picker offers exactly two boards ────────────────────────────────
const cfg = await (await fetch(`${API}/auth/profile-config`, { headers: H })).json();
check('profile-config offers exactly 2 boards',
  Array.isArray(cfg.studyMediums) && cfg.studyMediums.length === 2,
  JSON.stringify(cfg.studyMediums));
check('profile-config matches the taxonomy BOARDS list',
  JSON.stringify(cfg.studyMediums) === JSON.stringify(BOARDS),
  `taxonomy=${JSON.stringify(BOARDS)}`);
check("no removed board or 'Other' survives in the offered list",
  !['ICSE', 'Other', 'UP Board', 'Punjab Board (PSEB)'].some((b) => (cfg.studyMediums || []).includes(b)));

// ── 2. The server REJECTS a removed board, by name ─────────────────────────
const base = { age: 15, fatherName: 'Ram Kumar', schoolName: 'Govt Sr Sec School', schoolCity: 'Ambala' };

const rejected = await fetch(`${API}/auth/profile-details`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ ...base, studyMedium: 'ICSE' })
});
const rejectedBody = await rejected.json();
check('a removed board is rejected with 400', rejected.status === 400, `HTTP ${rejected.status}`);
check('rejection carries the named code BOARD_NOT_SUPPORTED',
  rejectedBody.fields?.studyMedium === 'BOARD_NOT_SUPPORTED',
  JSON.stringify(rejectedBody.fields));

// The old rule was a LENGTH check, so a short arbitrary string used to pass. This is
// the regression that would reappear if the closed-set check were ever softened.
const freeText = await fetch(`${API}/auth/profile-details`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ ...base, studyMedium: 'My Local Board' })
});
check('arbitrary free-text board is rejected too', freeText.status === 400, `HTTP ${freeText.status}`);

// ── 3. A served board saves ────────────────────────────────────────────────
const accepted = await fetch(`${API}/auth/profile-details`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ ...base, studyMedium: 'CBSE' })
});
check('a served board saves', accepted.ok, `HTTP ${accepted.status}`);

// ── 4. An account already holding a removed board still LOADS ──────────────
// Written straight to the DB, which is the only way it can occur now — that is the
// point: this state predates the validator and must not crash the reader.
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
const dbUser = await User.findOne({ email });
await User.updateOne({ _id: dbUser._id }, { $set: { 'profile.studyMedium': 'ICSE' } });

const meLegacy = await fetch(`${API}/auth/me`, { headers: H });
const meLegacyBody = await meLegacy.json();
check('an account holding a removed board loads without error', meLegacy.ok, `HTTP ${meLegacy.status}`);
check('the legacy board is returned as-is, not blanked or substituted',
  meLegacyBody.user?.profile?.studyMedium === 'ICSE',
  JSON.stringify(meLegacyBody.user?.profile?.studyMedium));
check('boardNeedsReselect is a real boolean before migration',
  meLegacyBody.user?.profile?.boardNeedsReselect === false,
  JSON.stringify(meLegacyBody.user?.profile?.boardNeedsReselect));

// ── 5. The backfill reports BEFORE it writes ───────────────────────────────
const dry = runScript();
check('dry-run writes nothing', (await User.findById(dbUser._id)).profile.studyMedium === 'ICSE');
check('dry-run reports the per-board counts', /ICSE\s+\d+/.test(dry), dry.split('\n').find((l) => l.includes('ICSE'))?.trim());
check('dry-run says it is a dry run', dry.includes('[DRY-RUN'));

// ── 6. --apply migrates without destroying the answer ──────────────────────
runScript('--apply');
const applied = await User.findById(dbUser._id);
check('apply empties the unsupported board', applied.profile.studyMedium === '');
check('apply PRESERVES the old value (not deleted)', applied.profile.legacyStudyMedium === 'ICSE',
  applied.profile.legacyStudyMedium);
check('apply flags the account for a one-time re-ask', applied.profile.boardNeedsReselect === true);
check('apply does NOT guess a replacement board', applied.profile.studyMedium !== 'CBSE');
check('apply does NOT reset onboardingCompleted (that would re-trap the student)',
  applied.onboardingCompleted === true, `onboardingCompleted=${applied.onboardingCompleted}`);

// ── 7. Idempotent ──────────────────────────────────────────────────────────
const second = runScript('--apply');
const afterSecond = await User.findById(dbUser._id);
check('re-running --apply is idempotent',
  afterSecond.profile.legacyStudyMedium === 'ICSE' && afterSecond.profile.studyMedium === '');
check('the second run finds 0 candidates', /Holding a REMOVED board:\s+0/.test(second),
  second.split('\n').find((l) => l.includes('REMOVED'))?.trim());

// ── 8. Rollback restores each account's OWN board ──────────────────────────
// Re-flag first: run 7 wrote a log with 0 users, which is what rollback would read.
await User.updateOne({ _id: dbUser._id }, {
  $set: { 'profile.studyMedium': 'ICSE' },
  $unset: { 'profile.legacyStudyMedium': '', 'profile.boardNeedsReselect': '' }
});
runScript('--apply');
runScript('--rollback');
const rolledBack = await User.findById(dbUser._id);
check('rollback restores the original board', rolledBack.profile.studyMedium === 'ICSE',
  rolledBack.profile.studyMedium);
check('rollback clears the re-ask flag', !rolledBack.profile.boardNeedsReselect);
check('rollback clears the legacy copy', !rolledBack.profile.legacyStudyMedium);

// ── 9. The one-time prompt route is itself closed-set ──────────────────────
// A prompt endpoint that skipped validation would be a second way in for exactly the
// values the main save refuses.
await User.updateOne({ _id: dbUser._id }, { $set: { 'profile.boardNeedsReselect': true, 'profile.studyMedium': '' } });

const badReselect = await fetch(`${API}/auth/profile/board`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ studyMedium: 'ICSE' })
});
check('re-select rejects a removed board', badReselect.status === 400, `HTTP ${badReselect.status}`);
check('re-select rejection is named', (await badReselect.json()).error === 'BOARD_NOT_SUPPORTED');

const goodReselect = await fetch(`${API}/auth/profile/board`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ studyMedium: 'Haryana Board (HBSE)' })
});
const goodBody = await goodReselect.json();
check('re-select accepts a served board', goodReselect.ok, `HTTP ${goodReselect.status}`);
check('re-select clears the flag so the prompt is genuinely one-time',
  goodBody.profile?.boardNeedsReselect === false);
check('re-select stores the chosen board', goodBody.profile?.studyMedium === 'Haryana Board (HBSE)');

// Dismiss must also clear the flag — a prompt with no exit is a trapped account.
await User.updateOne({ _id: dbUser._id }, { $set: { 'profile.boardNeedsReselect': true } });
const dismissed = await fetch(`${API}/auth/profile/board`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ dismiss: true })
});
check('dismiss clears the flag without setting a board',
  dismissed.ok && (await dismissed.json()).profile?.boardNeedsReselect === false);

check('legacyStudyMedium is NEVER sent to the client',
  !Object.keys(meLegacyBody.user?.profile || {}).includes('legacyStudyMedium'));

await User.deleteOne({ _id: dbUser._id });
await mongoose.disconnect();

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
