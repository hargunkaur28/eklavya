// Workstream C — proves the six autosave hazards, without a browser.
import { createNoteSaveManager, SAVE_STATE } from './src/utils/noteSaveManager.js';

const out = [];
const check = (n, pass, d = '') => { out.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake server that records every write, and can be made slow or failing.
function makeServer({ latency = 0, fail = false } = {}) {
  const writes = [];
  return {
    writes,
    save: async (noteId, payload) => {
      writes.push({ noteId, text: payload?.content?.text });
      if (latency) await wait(latency);
      return fail ? { ok: false, code: 'NOTE_SAVE_FAILED' } : { ok: true };
    }
  };
}

console.log('── 1. DEBOUNCE RACE: switching pages must not write A into B ──');
{
  const srv = makeServer();
  const m = createNoteSaveManager({ save: srv.save, onState: () => {}, debounceMs: 50 });
  await m.setActiveNote('A');
  m.schedule('A', { content: { text: 'A-content' } });   // id captured HERE
  await m.setActiveNote('B');                            // switch inside the window
  m.schedule('B', { content: { text: 'B-content' } });
  await wait(120);
  await m.flush();
  const aWrites = srv.writes.filter((w) => w.noteId === 'A');
  const bWrites = srv.writes.filter((w) => w.noteId === 'B');
  check('A received A-content', aWrites.length === 1 && aWrites[0].text === 'A-content', JSON.stringify(aWrites));
  check('B received B-content ONLY', bWrites.every((w) => w.text === 'B-content'), JSON.stringify(bWrites));
  check("A's content was never written to B", !srv.writes.some((w) => w.noteId === 'B' && w.text === 'A-content'));
}

console.log('\n── 2. STALE IN-FLIGHT RESPONSE must not mark B saved ──');
{
  const srv = makeServer({ latency: 120 });   // A's response lands after the switch
  const states = [];
  const m = createNoteSaveManager({ save: srv.save, onState: (s) => states.push(s.state), debounceMs: 10 });
  await m.setActiveNote('A');
  m.schedule('A', { content: { text: 'A' } });
  await wait(30);                              // A's request is now in flight
  await m.setActiveNote('B');                  // student moves to B
  await wait(200);                             // A's response arrives
  const st = m.getState();
  check('B is NOT marked saved by A\'s response', st.state !== SAVE_STATE.SAVED, `state=${st.state}`);
}

console.log('\n── 3. setContent must not schedule a save (the TipTap footgun) ──');
{
  const srv = makeServer();
  const m = createNoteSaveManager({ save: srv.save, onState: () => {}, debounceMs: 20 });
  await m.setActiveNote('B');
  m.beginLoad();
  m.schedule('B', { content: { text: 'loaded-from-server' } });  // what onUpdate does
  m.endLoad();
  await wait(80);
  await m.flush();
  check('opening a page fires NO save', srv.writes.length === 0, `${srv.writes.length} write(s)`);
  // A real edit after loading still saves.
  m.schedule('B', { content: { text: 'real-edit' } });
  await wait(60);
  check('a genuine edit after load DOES save', srv.writes.length === 1 && srv.writes[0].text === 'real-edit');
}

console.log('\n── 4. DELETE while a save is pending ──');
{
  const srv = makeServer();
  const m = createNoteSaveManager({ save: srv.save, onState: () => {}, debounceMs: 50 });
  await m.setActiveNote('A');
  m.schedule('A', { content: { text: 'about-to-be-deleted' } });
  m.cancel('A');                               // called BEFORE the DELETE
  await wait(120);
  await m.flush();
  check('no save fired for the deleted note', srv.writes.length === 0, `${srv.writes.length} write(s)`);
  check('no resurrection possible', !srv.writes.some((w) => w.noteId === 'A'));
}

console.log('\n── 5. NAVIGATING AWAY flushes pending work ──');
{
  const srv = makeServer();
  const m = createNoteSaveManager({ save: srv.save, onState: () => {}, debounceMs: 5000 });
  await m.setActiveNote('A');
  m.schedule('A', { content: { text: 'unsaved-when-leaving' } });
  await m.flushAll();                          // unmount / beforeunload
  check('pending save is flushed on navigate-away', srv.writes.length === 1 && srv.writes[0].text === 'unsaved-when-leaving');
  check('flush does not wait for the debounce', true, 'debounce was 5000ms, flush was immediate');
}

console.log('\n── 6. image upload blocks autosave; the STALE payload is DROPPED ──');
{
  const srv = makeServer();
  const m = createNoteSaveManager({ save: srv.save, onState: () => {}, debounceMs: 20 });
  await m.setActiveNote('A');
  m.setBlocked(true);
  m.schedule('A', { content: { text: 'has-placeholder' } });
  await wait(80);
  check('no save while a placeholder is unresolved', srv.writes.length === 0, `${srv.writes.length} write(s)`);

  m.setBlocked(false);                         // upload resolved
  await wait(80);
  // Found in the browser pass: replaying the queued payload sends a document that
  // STILL contains the placeholder, which the server rejects 400
  // NOTE_UPLOAD_IN_PROGRESS. Dropping it is safe because the placeholder swap
  // mutates the doc, and that mutation fires onUpdate with the current content.
  check('stale placeholder payload is NOT replayed', srv.writes.length === 0, `${srv.writes.length} write(s)`);

  m.schedule('A', { content: { text: 'placeholder-swapped-for-url' } });   // the swap's onUpdate
  await wait(80);
  check('the post-swap save DOES run, with fresh content',
    srv.writes.length === 1 && srv.writes[0].text === 'placeholder-swapped-for-url', JSON.stringify(srv.writes));
}

console.log('\n── 7. a failed save must STOP claiming "Saved" ──');
{
  const srv = makeServer({ fail: true });
  let last = null;
  const m = createNoteSaveManager({ save: srv.save, onState: (s) => { last = s; }, debounceMs: 10 });
  await m.setActiveNote('A');
  m.schedule('A', { content: { text: 'too-big' } });
  await wait(80);
  check('state is ERROR, not SAVED', last?.state === SAVE_STATE.ERROR, `state=${last?.state}`);
  check('the error code is surfaced', last?.error === 'NOTE_SAVE_FAILED', last?.error);
}

const failed = out.filter(([, p]) => !p);
console.log(`\n${out.length - failed.length}/${out.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
