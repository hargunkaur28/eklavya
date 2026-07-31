// Does the narration suite actually CATCH the bug, or does it merely pass?
//
// This is deliberately NOT driven through real narration. Two earlier attempts at this
// check went through a real TTS round-trip and both came back inconclusive — once on a
// server hiccup, once because the audio never started inside the timing budget. That is
// the same mistake as asserting "a figure appeared" instead of "an attempt was
// recorded": it tests a downstream effect that provider variance can mask.
//
// So it asserts the thing the bug made impossible, at the mechanism itself: after a
// navigation, is the controller still narrating? The narration is started with a
// resolve() that returns text directly — no network, no provider, no timing budget.
import { chromium, devices } from 'playwright';

const APP = 'http://127.0.0.1:5173';
const token = process.env.ACC_TOKEN;
if (!token) { console.error('ACC_TOKEN required'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 } });
const page = await ctx.newPage();
await page.goto(APP);
await page.evaluate((t) => localStorage.setItem('eklavya_token', t), token);
await page.goto(APP + '/dashboard');
await page.waitForLoadState('networkidle');

// Same module instance the app uses — Vite serves one ESM record per URL, so this is
// the live singleton, not a copy.
const ok = await page.evaluate(async () => {
  const nc = await import('/src/utils/narrationController.js');
  window.__nc = nc;
  return typeof nc.playNarration === 'function' && typeof nc.isNarrating === 'function';
});
if (!ok) { console.error('could not reach the controller module'); await browser.close(); process.exit(1); }

const start = async () => page.evaluate(async () => {
  // Long text so the Web Speech queue is still running when we navigate.
  const text = 'Light travels in straight lines. '.repeat(40);
  window.__nc.playNarration({
    ownerId: 'verify', resolve: async () => ({ speak: { text, lang: 'en' } })
  });
  await new Promise((r) => setTimeout(r, 600));
  return window.__nc.isNarrating();
});

const navigate = async () => page.evaluate(async () => {
  // In-app navigation: pushState + popstate is what react-router listens to, so this
  // changes the route WITHOUT a page reload — a reload would tear the module down and
  // the check would pass for the wrong reason.
  window.history.pushState({}, '', '/profile');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await new Promise((r) => setTimeout(r, 800));
  return { narrating: window.__nc.isNarrating(), path: location.pathname };
});

const startedBefore = await start();
console.log(`narrating after start: ${startedBefore}`);
if (!startedBefore) {
  console.error('FIXTURE FAILURE: narration did not start, so the check below is vacuous.');
  await browser.close(); process.exit(2);
}

const after = await navigate();
console.log(`route now: ${after.path}`);
console.log(`narrating after navigation: ${after.narrating}`);

const pass = after.narrating === false;
console.log(pass
  ? '\nPASS  narration stopped on route change'
  : '\n*** FAIL ***  narration SURVIVED the route change');
await browser.close();
process.exit(pass ? 0 : 1);
