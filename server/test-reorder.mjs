// Workstream C — the reorder endpoint. A mutation doing a bulkWrite behind a
// cross-student ownership check: it returns success either way, so a leak here
// survives review. Tested for the three things that actually go wrong.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const API = `http://localhost:${process.env.TEST_PORT || 5000}/api`;
const j = async (p, o = {}, tk) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}), ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const out = [];
const check = (n, p, d = '') => { out.push([n, p]); console.log(`${p ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };
const mk = async (n) => (await j('/auth/signup', { method: 'POST', body: JSON.stringify({ name: n, email: `${n}.${Date.now()}@t.test`, password: 'TestPass1!' }) })).body.token;

const tkA = await mk('reoA'), tkB = await mk('reoB');
const mkNote = async (tk, title, parent = null) =>
  (await j('/my-notes', { method: 'POST', body: JSON.stringify({ title, ...(parent ? { parentNoteId: parent } : {}) }) }, tk)).body.note.id;

const p1 = await mkNote(tkA, 'One'), p2 = await mkNote(tkA, 'Two');
const p3 = await mkNote(tkA, 'Three'), p4 = await mkNote(tkA, 'Four');
const parent = await mkNote(tkA, 'Parent');
const c1 = await mkNote(tkA, 'ChildA', parent), c2 = await mkNote(tkA, 'ChildB', parent);
const bNote = await mkNote(tkB, 'B-private');

await mongoose.connect(process.env.MONGODB_URI);
const col = mongoose.connection.collection('notes');
const orders = async (ids) => {
  const docs = await col.find({ _id: { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) } }).project({ order: 1, title: 1 }).toArray();
  return docs.sort((a, b) => a.order - b.order).map((d) => `${d.title}:${d.order}`).join(' ');
};
const topOrderValues = async () => {
  const docs = await col.find({ parentNoteId: null, title: { $in: ['One', 'Two', 'Three', 'Four'] } }).project({ order: 1 }).toArray();
  return docs.map((d) => d.order);
};

console.log('-- happy path: full sibling list, dense 0..n-1 --');
const ok = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p4, p1, parent, p3, p2], parentNoteId: null }) }, tkA);
check('reorder succeeds', ok.status === 200, `status ${ok.status}`);
check('indices dense and in the sent order', (await orders([p1, p2, p3, p4, parent])) === 'Four:0 One:1 Parent:2 Three:3 Two:4', await orders([p1, p2, p3, p4, parent]));

console.log('\n-- FOREIGN id must 404, and must not be an existence oracle --');
const foreign = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p4, p1, parent, p3, bNote], parentNoteId: null }) }, tkA);
check('foreign id rejected 404', foreign.status === 404, `${foreign.status} ${foreign.body.error}`);
const bAfter = await col.findOne({ _id: new mongoose.Types.ObjectId(bNote) });
check("student B's page untouched", bAfter.order === 0, `order=${bAfter.order}`);
const ghost = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p4, p1, parent, p3, '000000000000000000000000'], parentNoteId: null }) }, tkA);
check('nonexistent id gives the SAME response as a foreign one',
  ghost.status === foreign.status && ghost.body.error === foreign.body.error, `${ghost.status} ${ghost.body.error}`);

console.log('\n-- ids from a DIFFERENT sibling group rejected --');
const cross = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p4, p1, parent, p3, c1], parentNoteId: null }) }, tkA);
check('child mixed into the top-level group rejected', cross.status === 404, `${cross.status} ${cross.body.error}`);
const childGroup = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [c2, c1], parentNoteId: parent }) }, tkA);
check('reordering within the child group works', childGroup.status === 200, `status ${childGroup.status}`);
check('child indices dense', (await orders([c1, c2])) === 'ChildB:0 ChildA:1', await orders([c1, c2]));

console.log('\n-- PARTIAL list must be REFUSED, not silently collide --');
// Before the fix this produced `Two:0 Four:0 One:1 Three:2` — two pages at position 0.
const before = await orders([p1, p2, p3, p4, parent]);
const partial = await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p2, p1], parentNoteId: null }) }, tkA);
check('partial list rejected', partial.status === 400 && partial.body.error === 'NOTE_REORDER_INCOMPLETE',
  `${partial.status} ${partial.body.error} expected=${partial.body.expected} received=${partial.body.received}`);
check('nothing renumbered by the refused request', (await orders([p1, p2, p3, p4, parent])) === before, await orders([p1, p2, p3, p4, parent]));
const vals = await topOrderValues();
check('no duplicate order values', vals.length === new Set(vals).size, `orders=[${[...vals].sort((a, b) => a - b).join(',')}]`);
check('every top-level sibling holds a distinct position', new Set(vals).size === vals.length, `${new Set(vals).size} distinct of ${vals.length}`);

console.log('\n-- malformed input --');
check('empty list rejected', (await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [] }) }, tkA)).status === 400);
check('duplicate ids rejected', (await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p1, p1] }) }, tkA)).status === 400);
check('non-ObjectId rejected', (await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: ['nope'] }) }, tkA)).status === 400);
check('unauthenticated rejected', (await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p1] }) })).status === 401);
check("student B cannot reorder A's group",
  [400, 404].includes((await j('/my-notes/reorder', { method: 'POST', body: JSON.stringify({ orderedIds: [p4, p1, parent, p3, p2], parentNoteId: null }) }, tkB)).status));

await col.deleteMany({ title: { $in: ['One', 'Two', 'Three', 'Four', 'Parent', 'ChildA', 'ChildB', 'B-private'] } });
await mongoose.disconnect();
const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
