// Workstream C server-side tests, focused on the data-loss hazards.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const API = `http://localhost:${process.env.TEST_PORT || 5000}/api`;
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const out = [];
const check = (n, pass, d = '') => { out.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const mk = async (n) => (await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: n, email: `${n}.${Date.now()}@t.test`, password: 'TestPass1!' }) })).body.token;
const tkA = await mk('noteA'), tkB = await mk('noteB');

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

console.log('── Feature 18 must be untouched ──');
const f18 = await j('/notes/generate', { method: 'POST', body: JSON.stringify({ subject: 'Maths', topic: 'Circles' }) }, tkA);
check('POST /api/notes/generate still routed (not 404)', f18.status !== 404, `status ${f18.status}`);

console.log('\n── create / list / get ──');
const created = await j('/my-notes', { method: 'POST', body: JSON.stringify({ title: 'Circles', icon: '⭕' }) }, tkA);
check('create returns 201', created.status === 201, `status ${created.status}`);
const id = created.body.note?.id;
const list = await j('/my-notes', {}, tkA);
check('list returns metadata only (no content field)', list.body.notes?.length === 1 && !('content' in list.body.notes[0]));

console.log('\n── HAZARD: base64 images must never reach Mongo ──');
const b64 = { type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } }] };
const b64res = await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ content: b64 }) }, tkA);
check('base64 image REJECTED', b64res.status === 400 && b64res.body.error === 'NOTE_INLINE_IMAGE_REJECTED', b64res.body.error);
await mongoose.connect(process.env.MONGODB_URI);
const notes = mongoose.connection.collection('notes');
const stored = await notes.findOne({ _id: new mongoose.Types.ObjectId(id) });
check('nothing base64 persisted', !JSON.stringify(stored.content).includes('base64'));

console.log('\n── HAZARD: unresolved upload placeholder must not persist ──');
const ph = { type: 'doc', content: [{ type: 'imageUploadPlaceholder', attrs: { uploadId: 'x1' } }] };
const phres = await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ content: ph }) }, tkA);
check('placeholder document REJECTED', phres.status === 400 && phres.body.error === 'NOTE_UPLOAD_IN_PROGRESS', phres.body.error);

console.log('\n── HAZARD: oversized page fails VISIBLY with a distinct code ──');
const big = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(520 * 1024) }] }] };
const bigres = await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ content: big }) }, tkA);
check('over-cap save rejected with NOTE_TOO_LARGE', bigres.status === 400 && bigres.body.error === 'NOTE_TOO_LARGE', `${bigres.body.error} bytes=${bigres.body.bytes}`);
// And the warning fires BEFORE the hard cap, while there is still room to act.
const nearCap = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y'.repeat(430 * 1024) }] }] };
const warnRes = await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ content: nearCap }) }, tkA);
check('approaching-limit warning returned before rejection', warnRes.status === 200 && warnRes.body.warn === 'NOTE_APPROACHING_LIMIT', `warn=${warnRes.body.warn}`);

console.log('\n── content round-trips, search finds body text ──');
await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ content: doc('tangent perpendicular radius') }) }, tkA);
const got = await j(`/my-notes/${id}`, {}, tkA);
check('content persists exactly', got.body.note?.content?.content?.[0]?.content?.[0]?.text === 'tangent perpendicular radius');
const found = await j('/my-notes/search?q=perpendicular', {}, tkA);
check('search matches body text', (found.body.notes || []).some((n) => n.id === id), `${(found.body.notes || []).length} hit(s)`);

console.log('\n── one level of nesting only ──');
const child = await j('/my-notes', { method: 'POST', body: JSON.stringify({ title: 'Child', parentNoteId: id }) }, tkA);
check('child page allowed', child.status === 201);
const gk = await j('/my-notes', { method: 'POST', body: JSON.stringify({ title: 'Grandchild', parentNoteId: child.body.note.id }) }, tkA);
check('grandchild REJECTED', gk.status === 400 && gk.body.error === 'NOTE_NESTING_TOO_DEEP', gk.body.error);

console.log('\n── ownership: 404, never 403 ──');
check('student B cannot GET A\'s note', (await j(`/my-notes/${id}`, {}, tkB)).status === 404);
check('student B cannot PATCH A\'s note', (await j(`/my-notes/${id}`, { method: 'PATCH', body: JSON.stringify({ title: 'hacked' }) }, tkB)).status === 404);
check('student B cannot DELETE A\'s note', (await j(`/my-notes/${id}`, { method: 'DELETE' }, tkB)).status === 404);
check('unauthenticated blocked', (await j('/my-notes', {})).status === 401);

console.log('\n── delete cascades to children ──');
const del = await j(`/my-notes/${id}`, { method: 'DELETE' }, tkA);
check('delete reports the cascade', del.body.deleted === true && del.body.childrenDeleted === 1, `children=${del.body.childrenDeleted}`);
check('child is really gone', (await j(`/my-notes/${child.body.note.id}`, {}, tkA)).status === 404);

await notes.deleteMany({ userId: { $in: [] } });
await mongoose.disconnect();

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
