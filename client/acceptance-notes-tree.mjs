// Workstream C — the last outstanding browser check: the cascade-delete dialog.
// Create a child, collapse the parent, delete the parent, confirm the count in the
// dialog matches and the children are actually gone.
import { chromium, devices } from 'playwright';

const APP = 'http://127.0.0.1:5173';
const API = 'http://localhost:5000/api';
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };
const token = process.env.ACC_TOKEN;
if (!token) { console.error('ACC_TOKEN not provided'); process.exit(1); }
const api = async (p, o = {}) => {
  const r = await fetch(API + p, { ...o, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(o.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 } });
const page = await ctx.newPage();
await page.goto(APP);
await page.evaluate((tk) => localStorage.setItem('eklavya_token', tk), token);
await page.goto(APP + '/dashboard');
await page.waitForLoadState('networkidle');
await page.locator('text=My Notes').first().click();
await page.waitForTimeout(1200);

console.log('-- build a parent with 3 children --');
const parent = (await api('/my-notes', { method: 'POST', body: JSON.stringify({ title: 'Trigonometry' }) })).body.note;
for (const t of ['Sine rule', 'Cosine rule', 'Identities']) {
  await api('/my-notes', { method: 'POST', body: JSON.stringify({ title: t, parentNoteId: parent.id }) });
}
await page.reload();
await page.waitForTimeout(1500);
await page.locator('text=My Notes').first().click();
await page.waitForTimeout(1500);
check('parent renders in the tree', await page.locator('text=Trigonometry').count() > 0);

console.log('\n-- expand, then COLLAPSE the parent (children hidden) --');
const twisty = page.locator('.mynotes-twisty').first();
await twisty.click();                       // expand
await page.waitForTimeout(400);
check('children visible when expanded', await page.locator('text=Sine rule').count() > 0);
await twisty.click();                       // collapse — this is the dangerous state
await page.waitForTimeout(400);
check('children hidden when collapsed', await page.locator('text=Sine rule').count() === 0);

console.log('\n-- delete the COLLAPSED parent: the dialog must state the count --');
await page.locator('.mynotes-branch .mynotes-icon-btn.danger').first().click();
await page.waitForSelector('.mynotes-confirm', { timeout: 5000 });
const dialog = await page.locator('.mynotes-confirm').innerText();
console.log('  dialog text: ' + dialog.replace(/\n+/g, ' | '));
check('dialog names the page', /Trigonometry/.test(dialog));
check('dialog states the CHILD COUNT (3)', /\b3\b/.test(dialog) && /sub-page/i.test(dialog),
  'the number is the point — a collapsed parent hides pages the student forgot about');
check('dialog says it cannot be undone', /cannot be undone/i.test(dialog));

console.log('\n-- confirm: parent AND children actually gone --');
await page.locator('.mynotes-confirm .pf-primary.danger').click();
await page.waitForTimeout(1500);
const after = (await api('/my-notes')).body.notes || [];
const names = after.map((n) => n.title);
check('parent removed', !names.includes('Trigonometry'), JSON.stringify(names));
check('all 3 children removed', !['Sine rule', 'Cosine rule', 'Identities'].some((t) => names.includes(t)), JSON.stringify(names));
check('nothing orphaned (no child left pointing at a dead parent)',
  after.every((n) => !n.parentNoteId || after.some((p) => String(p.id) === String(n.parentNoteId))));

console.log('\n-- a childless page gets the SHORTER sentence --');
const solo = (await api('/my-notes', { method: 'POST', body: JSON.stringify({ title: 'Standalone' }) })).body.note;
await page.reload();
await page.waitForTimeout(1500);
await page.locator('text=My Notes').first().click();
await page.waitForTimeout(1500);
await page.locator('.mynotes-branch .mynotes-icon-btn.danger').first().click();
await page.waitForSelector('.mynotes-confirm', { timeout: 5000 });
const soloDialog = await page.locator('.mynotes-confirm').innerText();
console.log('  dialog text: ' + soloDialog.replace(/\n+/g, ' | '));
check('childless dialog does NOT mention sub-pages', !/sub-page/i.test(soloDialog));

await browser.close();
const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
