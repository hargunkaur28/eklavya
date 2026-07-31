// Workstream C acceptance pass — REAL BROWSER, 360px.
// The four tested modules (save manager, paste handler, doc validator, routes) meet
// a real editor for the first time here. Ordered by likelihood of being broken.
import { chromium, devices } from 'playwright';
import { execSync } from 'child_process';

const APP = 'http://127.0.0.1:5173';
const API = 'http://localhost:5000/api';
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const su = { token: process.env.ACC_TOKEN };
if (!su.token) { console.error('ACC_TOKEN not provided'); process.exit(1); }

// Roadmap seeded by the wrapper (server-side, where mongoose lives) — the sidebar
// and therefore the My Notes entry only render once a student has one.

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

// Count PATCH requests so "opening a page fires no save" is observable.
let patches = [];
page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/my-notes/')) patches.push(r.url()); });

await page.goto(APP);
await page.evaluate((tk) => localStorage.setItem('eklavya_token', tk), su.token);
await page.goto(APP + '/dashboard');
await page.waitForLoadState('networkidle');

console.log('\n-- 0. reach the My Notes section --');
await page.locator('text=My Notes').first().click();
await page.waitForTimeout(1200);
check('My Notes panel renders', await page.locator('.mynotes').count() > 0);
check('AI Notes (Feature 18) still present as its own entry', await page.locator('text=AI Notes').count() > 0);

console.log('\n-- 1. create a page and type; autosave persists --');
await page.locator('.mynotes-tree-head .mynotes-icon-btn').click();
await page.waitForSelector('.note-prose', { timeout: 8000 });
await page.locator('.note-prose').click();
await page.keyboard.type('Circles revision');
await page.waitForTimeout(2600);                       // past the 2s debounce
const status1 = await page.locator('.mynotes-status').innerText();
check('indicator reaches Saved', /saved|सहेजा/i.test(status1), status1);

console.log('\n-- 2. opening a page must fire NO save (setContent footgun) --');
await page.locator('.mynotes-tree-head .mynotes-icon-btn').click();   // second page
await page.waitForTimeout(1500);
patches = [];
const items = page.locator('.mynotes-item-label');
await items.first().click();                            // reopen page 1
await page.waitForTimeout(2600);                        // well past the debounce
check('opening a page fired zero PATCHes', patches.length === 0, `${patches.length} PATCH(es)`);

console.log('\n-- 3. switch pages fast while typing (the corruption case) --');
await items.first().click();
await page.waitForTimeout(600);
await page.locator('.note-prose').click();
await page.keyboard.type(' PAGE-ONE-MARKER');
await page.waitForTimeout(200);                         // still inside the debounce
await items.nth(1).click();                             // switch immediately
await page.waitForTimeout(600);
await page.locator('.note-prose').click();
await page.keyboard.type('PAGE-TWO-MARKER');
await page.waitForTimeout(2800);
// Read both pages back from the API — the ground truth.
const listRes = await (await fetch(`${API}/my-notes`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
const bodies = [];
for (const n of listRes.notes) {
  const full = await (await fetch(`${API}/my-notes/${n.id}`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
  bodies.push(JSON.stringify(full.note.content));
}
const p1HasOwn = bodies.some((b) => b.includes('PAGE-ONE-MARKER') && !b.includes('PAGE-TWO-MARKER'));
const p2HasOwn = bodies.some((b) => b.includes('PAGE-TWO-MARKER') && !b.includes('PAGE-ONE-MARKER'));
check('each page kept ONLY its own text', p1HasOwn && p2HasOwn,
  `page1-clean=${p1HasOwn} page2-clean=${p2HasOwn}`);
check('no page contains the other page\'s marker',
  !bodies.some((b) => b.includes('PAGE-ONE-MARKER') && b.includes('PAGE-TWO-MARKER')));

console.log('\n-- 4. paste a REAL screenshot end to end --');
// A genuine 1x1 PNG placed on the clipboard as a File, exactly like a screenshot paste.
await page.evaluate(async () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], 'shot.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const el = document.querySelector('.note-prose');
  el.focus();
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(500);
const sawPlaceholder = await page.locator('.note-img-uploading').count();
await page.waitForTimeout(4000);                        // upload + swap + autosave
const html = await page.locator('.note-prose').innerHTML();
check('placeholder appeared during upload', sawPlaceholder > 0, `${sawPlaceholder} placeholder(s)`);
const stillPlaceholder = await page.locator('.note-img-uploading').count();
const imgSrc = await page.locator('.note-prose img').first().getAttribute('src').catch(() => null);

// STRICT. This branch used to accept "placeholder removed, no image" as clean
// degradation, which meant the test passed whether or not uploads worked — the same
// shape as a fake that cannot express the outcome it is meant to verify. Cloudinary
// works now, so the ONLY acceptable result is a real Cloudinary URL in the document.
// Degradation is covered separately, below.
check('placeholder was replaced (none left behind)', stillPlaceholder === 0, `${stillPlaceholder} remaining`);
check('image src is a real Cloudinary URL',
  /^https:\/\/res\.cloudinary\.com\//.test(imgSrc || ''), imgSrc ? imgSrc.slice(0, 60) : 'NO IMAGE NODE — upload silently did not happen');
check('image src is not base64', !!imgSrc && !/^data:/i.test(imgSrc));
check('no base64 anywhere in the editor DOM', !/src="data:/i.test(html));

// The save must fire AFTER the swap and persist the URL. The stale-payload fix drops
// the payload captured while the placeholder was present, so correctness depends on
// the swap's own onUpdate scheduling a fresh save — under real, variable upload
// latency rather than a fake's fixed delay.
await page.waitForTimeout(3000);
const afterSwap = await (await fetch(`${API}/my-notes`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
let persistedUrl = null;
for (const n of afterSwap.notes) {
  const full = await (await fetch(`${API}/my-notes/${n.id}`, { headers: { Authorization: `Bearer ${su.token}` } })).json();
  const s = JSON.stringify(full.note.content);
  if (s.includes('res.cloudinary.com')) { persistedUrl = s.match(/https:\/\/res\.cloudinary\.com\/[^"]+/)?.[0]; break; }
}
check('a save fired AFTER the swap and persisted the URL', !!persistedUrl,
  persistedUrl ? persistedUrl.slice(0, 60) : 'no Cloudinary URL reached the database');
check('the persisted URL matches what is on screen', persistedUrl === imgSrc,
  persistedUrl === imgSrc ? 'identical' : `db=${(persistedUrl || '').slice(-24)} dom=${(imgSrc || '').slice(-24)}`);

console.log('\n-- 4b. TWO pastes in quick succession (block/unblock ordering) --');
// setBlocked(false) only fires once EVERY upload settles. Under real variable latency
// the second can resolve first, which is the ordering the fakes could not exercise.
const beforeCount = await page.locator('.note-prose img').count();
// ~300ms apart, NOT the same tick. Dispatching two ClipboardEvents synchronously is
// not an input any human or OS clipboard can produce, so a failure there would say
// nothing about real concurrency. This spacing is fast enough that the first upload
// is still in flight when the second starts, which is the case that actually
// exercises the block/unblock ordering.
const pasteOne = (name) => page.evaluate((n) => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAKUlEQVR42mNkYPhfz0AEYBxVSF+FjIyM/xkYGBgYSVFIlEIYIEohAM5rC/1r5s6GAAAAAElFTkSuQmCC';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([arr], n, { type: 'image/png' }));
  const el = document.querySelector('.note-prose');
  el.focus();
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  // handlePaste calls preventDefault() when it consumes an image, so this reports
  // whether ProseMirror's handler ran at all — the difference between "the event
  // never arrived" and "the handler ran but the insert did not take".
  return { consumed: ev.defaultPrevented, files: dt.files.length, active: document.activeElement?.className || '' };
}, name);

// Click first: ProseMirror needs a live selection to handle a paste, and the API
// waits above cost the editor its focus. A real user's cursor is in the document.
await page.locator('.note-prose').click();
await page.waitForTimeout(200);
const r1 = await pasteOne('a.png');
console.log(`    [probe] paste 1 ${JSON.stringify(r1)}`);
await page.waitForTimeout(300);
const r2 = await pasteOne('b.png');
console.log(`    [probe] paste 2 ${JSON.stringify(r2)}`);
// Probe BEFORE the uploads settle. This separates the two failure modes that both
// end as "one image short": the second paste never produced a node at all, versus
// both placeholders appearing and one being lost during the swap.
await page.waitForTimeout(400);
const midPlaceholders = await page.locator('.note-img-uploading').count();
console.log(`    [probe] placeholders in flight after both pastes: ${midPlaceholders}`);
await page.waitForTimeout(12000);

const afterCount = await page.locator('.note-prose img').count();
const leftover = await page.locator('.note-img-uploading').count();
const expected = beforeCount + 2;
check('both pastes produced image nodes', afterCount === expected, `${beforeCount} -> ${afterCount} (expected ${expected})`);
check('no placeholder stranded after concurrent uploads', leftover === 0, `${leftover} remaining`);

const srcs = await page.locator('.note-prose img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
// Assert the COUNT explicitly. "1 image, 1 distinct" passed vacuously on a set of one
// — the same weak-assertion shape as the degradation branch this file just lost.
check('exactly the expected number of images, all distinct Cloudinary URLs',
  srcs.length === expected
    && new Set(srcs).size === expected
    && srcs.every((s) => /^https:\/\/res\.cloudinary\.com\//.test(s || '')),
  `${srcs.length} images, ${new Set(srcs).size} distinct, expected ${expected}`);
// And the block/unblock cycle must have released, so the final state persists.
await page.waitForTimeout(3000);
const finalStatus = await page.locator('.mynotes-status').innerText();
check('autosave released after both uploads (not stuck)', !/saving|सहेजा जा रहा/i.test(finalStatus), finalStatus);

console.log('\n-- 5. sticky ERROR state when the server dies mid-edit --');
try { execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"', { stdio: 'ignore' }); } catch { /* ignore */ }
await page.waitForTimeout(800);
await page.locator('.note-prose').click();
await page.keyboard.type(' after-server-death');

// POLL rather than sleeping a fixed 3.5s. The old fixed wait sampled while the
// request was still in flight and reported "Saving…" as a failure, then the very next
// assertion saw "Not saved" — an intermittently-red test for pure timing reasons.
// That trains you to ignore red, which undoes the whole point of the suite.
const reachedError = await page
  .waitForFunction(() => /not saved|सहेजा नहीं/i.test(document.querySelector('.mynotes-status')?.innerText || ''),
    null, { timeout: 20000 })
  .then(() => true).catch(() => false);
const errStatus = await page.locator('.mynotes-status').innerText();
check('indicator reaches the error state', reachedError, errStatus);
check('indicator is NOT claiming saved', !/^saved$|^सहेजा गया$/i.test(errStatus.trim()), errStatus);

// Sticky: it must still say so well after the failure, not flicker back.
await page.waitForTimeout(4000);
const stillErr = await page.locator('.mynotes-status').innerText();
check('error state is STICKY, not transient', /not saved|सहेजा नहीं/i.test(stillErr), stillErr);

console.log('\n-- 6. sticky bottom toolbar at 360px --');
const tb = page.locator('.mynotes-toolbar');
const tbBox = await tb.boundingBox();
check('toolbar visible at 360px', await tb.isVisible());
check('toolbar within the viewport width', tbBox && tbBox.x >= -1 && tbBox.width <= 361, tbBox ? `x=${Math.round(tbBox.x)} w=${Math.round(tbBox.width)}` : 'no box');
const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
check('no horizontal page overflow', noHScroll);
// Simulate the keyboard by shrinking the viewport.
await page.setViewportSize({ width: 360, height: 400 });
await page.waitForTimeout(400);
const tbBox2 = await tb.boundingBox();
check('toolbar still reachable with a ~320px keyboard', tbBox2 && tbBox2.y < 400, tbBox2 ? `y=${Math.round(tbBox2.y)} of 400` : 'no box');
await page.setViewportSize({ width: 360, height: 720 });

console.log('\n-- console --');
const real = consoleErrors.filter((e) => !/favicon|404|Failed to fetch|net::ERR/i.test(e));
check('no unexpected console errors', real.length === 0, real.slice(0, 2).join(' | ') || 'none');

await browser.close();
const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
