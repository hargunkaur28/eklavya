// Workstream B acceptance pass — REAL BROWSER observation, at 360px.
//
// Everything in B was verified at the API/storage/static-analysis level. This checks
// the things where "asserted in code" and "actually works" diverge most: timing,
// focus, platform back-navigation, layout with a keyboard, and a Hindi render that
// has never been seen. Ordered by likelihood of being broken.
import { chromium, devices } from 'playwright';

const APP = 'http://127.0.0.1:5173';
const API = 'http://localhost:5000/api';
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

// A fresh student, so onboardingCompleted is false and the gate fires.
const email = `acc.${Date.now()}@t.test`;
const su = await (await fetch(`${API}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Acceptance Student', email, password: 'TestPass1!' })
})).json();
if (!su.token) { console.error('signup failed', su); process.exit(1); }

const browser = await chromium.launch();
// Pixel-class viewport at the 360px width the spec calls out.
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 }, locale: 'en-IN' });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

// Seed the token the way the app stores it, then load.
await page.goto(APP);
await page.evaluate((tk) => localStorage.setItem('eklavya_token', tk), su.token);
await page.goto(APP + '/dashboard');
await page.waitForLoadState('networkidle');

console.log('\n── 0. the gate actually redirects ──');
check('new student redirected to /onboarding/profile', page.url().includes('/onboarding/profile'), page.url());
await page.waitForSelector('.pf-input, .pf-choice', { timeout: 10000 });

console.log('\n── 0b. THROUGH THE REAL SIGNUP FORM (not an injected token) ──');
// WHY THIS EXISTS, given check 0 above already asserts the redirect: check 0 seeds the
// token into localStorage and loads a page, so the app populates its auth state from
// GET /api/auth/me — which has always returned onboardingCompleted. A REAL new student
// never takes that path. They submit the signup form, and the app populates auth state
// from the SIGNUP RESPONSE, which omitted the field entirely. The client gate is
// `onboardingCompleted === false`, `undefined === false` is false, and every genuinely
// new student walked straight past the profile flow into subject selection.
//
// Check 0 passed the whole time it was broken. It observed the system from outside the
// mechanism that actually failed — the same shape as Design Rule 11.
{
  const freshEmail = `gate.${Date.now()}@t.test`;
  // A separate CONTEXT, not just a separate page: pages in one context share
  // localStorage for the origin, so `fresh` inherited the token seeded at the top of
  // this file and the /me check below described a DIFFERENT user. A signup test has to
  // start from an empty browser or it is not testing signup.
  const freshCtx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 }, locale: 'en-IN' });
  const fresh = await freshCtx.newPage();
  const freshErrors = [];
  fresh.on('console', (m) => { if (m.type() === 'error') freshErrors.push(m.text().slice(0, 160)); });
  fresh.on('pageerror', (e) => freshErrors.push('pageerror: ' + e.message.slice(0, 160)));
  await fresh.goto(APP + '/signup');
  await fresh.waitForLoadState('networkidle');

  // Match by INPUT TYPE, not placeholder text. The name field's placeholder is
  // "e.g. Ananya Sharma" — it contains no word a /name/i pattern would find, so a
  // placeholder-based selector silently matched nothing and the check reported the form
  // as unfillable rather than testing it.
  const nameIn = fresh.locator('input[type=text]').first();
  const mailIn = fresh.locator('input[type=email]').first();
  const passIn = fresh.locator('input[type=password]').first();
  const okName = (await nameIn.count()) > 0;
  const okMail = (await mailIn.count()) > 0;
  const okPass = (await passIn.count()) > 0;
  if (okName) await nameIn.fill('Gate Student');
  if (okMail) await mailIn.fill(freshEmail);
  if (okPass) await passIn.fill('TestPass1!');
  // The form also carries a consent checkbox; leaving it unticked keeps the submit
  // inert and the page never navigates.
  const box = fresh.locator('input[type=checkbox]').first();
  if (await box.count()) await box.check().catch(() => {});
  check('the signup form was fillable', okName && okMail && okPass,
    `name=${okName} email=${okMail} password=${okPass}`);

  if (okName && okMail && okPass) {
    // The SUBMIT button, by its role — not by text. 'Create Account' is the TAB label
    // in this form, so a text-matched click merely re-selected the already-active tab
    // and the form was never submitted, silently.
    await fresh.locator('button.auth-submit-btn, button[type=submit]').first().click();
    // Wait for the app to settle wherever it decided to send them.
    await fresh.waitForTimeout(4000);
    const landed = fresh.url();
    if (!landed.includes('/onboarding/profile')) {
      const visible = await fresh.locator('body').innerText().catch(() => '');
      console.log(`   [diag] url=${landed}`);
      console.log(`   [diag] console: ${freshErrors.slice(0, 3).join(' | ') || 'none'}`);
      console.log(`   [diag] on-screen: ${visible.replace(/\s+/g, ' ').slice(0, 180)}`);
      console.log(`   [diag] token present: ${await fresh.evaluate(() => !!localStorage.getItem('eklavya_token'))}`);
    }
    check('a student who signed up THROUGH THE FORM lands on /onboarding/profile',
      landed.includes('/onboarding/profile'), landed);

    // And the payload itself must carry the field, since that is the actual defect.
    const meUser = await fresh.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:5000/api/auth/me', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('eklavya_token') }
      });
      return (await r.json())?.user;
    });
    check('onboardingCompleted is present and false for the new student',
      meUser?.onboardingCompleted === false, `onboardingCompleted=${meUser?.onboardingCompleted}`);
  }
  await fresh.close();
  await freshCtx.close();
}

console.log('\n── 1. typing animation does NOT gate input ──');
// Reload and type IMMEDIATELY, before the avatar can finish typing.
await page.reload();
await page.waitForSelector('.pf-input', { timeout: 10000 });
const qAtStart = await page.locator('.pf-question').innerText();
await page.locator('.pf-input').first().fill('15');
const typedValue = await page.locator('.pf-input').first().inputValue();
const qLater = await page.waitForFunction(
  () => document.querySelector('.pf-question')?.innerText.length > 10, null, { timeout: 4000 }
).then(() => page.locator('.pf-question').innerText()).catch(() => qAtStart);
check('could type before the question finished', typedValue === '15',
  `question was "${qAtStart.slice(0, 18)}…" at type time, "${qLater.slice(0, 18)}…" after`);

console.log('\n── 2. focus lands on the step input after the slide ──');
const focused1 = await page.evaluate(() => document.activeElement?.className || '');
check('step 1 input is focused on load', focused1.includes('pf-input'), `activeElement: ${focused1 || '(none)'}`);

console.log('\n── 3. 360px layout: Continue reachable, no horizontal scroll ──');
const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
check('no horizontal overflow at 360px', !hScroll);
const btn = page.locator('.pf-primary').first();
check('Continue button is visible', await btn.isVisible());
const box = await btn.boundingBox();
check('Continue is inside the viewport', box && box.y + box.height <= 720, box ? `bottom at ${Math.round(box.y + box.height)}px of 720` : 'no box');

console.log('\n── 4. auto-advance + Back on the board picker ──');
await btn.click();                                   // → board step
await page.waitForSelector('.pf-choice', { timeout: 8000 });
await page.locator('.pf-choice', { hasText: 'Haryana' }).first().click();
await page.waitForTimeout(700);                      // auto-advance window
const afterAdvance = await page.locator('.pf-question').innerText();
check('board select auto-advanced', /father/i.test(afterAdvance), afterAdvance.slice(0, 30));
// Back to the picker: must NOT bounce forward, and must show the prior choice.
await page.locator('.pf-ghost', { hasText: 'Back' }).first().click();
await page.waitForTimeout(900);
const backQ = await page.locator('.pf-question').innerText();
check('Back returned to the board step and STAYED', /board/i.test(backQ), backQ.slice(0, 30));
const selectedCount = await page.locator('.pf-choice.selected').count();
check('previous board renders as selected', selectedCount === 1, `${selectedCount} selected`);
const selectedText = selectedCount ? await page.locator('.pf-choice.selected').innerText() : '';
check('the selected one is the one chosen', /Haryana/.test(selectedText), selectedText);

console.log('\n── 5. Android hardware Back (history) ──');
await page.goBack();                                  // from board step
await page.waitForTimeout(600);
const b1 = await page.locator('.pf-question').innerText();
check('hardware Back moved to the age step, not out of the flow',
  page.url().includes('/onboarding/profile') && /how old/i.test(b1), `${page.url().split('/').pop()} | ${b1.slice(0, 22)}`);
// Back from step 1 must EXIT the flow — that is the intended behaviour, not merely a
// tolerated one. Trapping a student on screen one is worse than letting them leave:
// the draft holds their answers and any protected route sends them straight back in.
// Asserted SPECIFICALLY so that if someone later adds a trap, this fails loudly
// rather than passing through a permissive "either outcome is fine" branch.
await page.goBack();
await page.waitForTimeout(700);
check('Back from step 1 EXITS the flow (intended)',
  !page.url().includes('/onboarding/profile'), `url now ${page.url()}`);
check('exit is clean — a real page rendered, not a blank',
  (await page.locator('body *').count()) > 5, `${await page.locator('body *').count()} elements`);

console.log('\n── 6. prefers-reduced-motion takes the cross-fade path ──');
const rmCtx = await browser.newContext({ viewport: { width: 360, height: 720 }, reducedMotion: 'reduce' });
const rmPage = await rmCtx.newPage();
await rmPage.goto(APP);
await rmPage.evaluate((tk) => localStorage.setItem('eklavya_token', tk), su.token);
await rmPage.goto(APP + '/onboarding/profile');
await rmPage.waitForSelector('.pf-input', { timeout: 10000 });
// With reduced motion the question is NOT typed — it appears whole immediately.
const rmQ = await rmPage.locator('.pf-question').innerText();
check('reduced motion shows the full question immediately (no typing)', rmQ.length > 15, `"${rmQ.slice(0, 34)}…"`);
const rmFocus = await rmPage.evaluate(() => document.activeElement?.className || '');
check('reduced motion still focuses the input', rmFocus.includes('pf-input'), rmFocus || '(none)');
await rmCtx.close();

console.log('\n── 7. HINDI end to end, including a validation error ──');
const hiCtx = await browser.newContext({ viewport: { width: 360, height: 720 }, locale: 'hi-IN' });
const hiPage = await hiCtx.newPage();
const hiErrors = [];
hiPage.on('pageerror', (e) => hiErrors.push(e.message));
await hiPage.goto(APP);
await hiPage.evaluate((tk) => localStorage.setItem('eklavya_token', tk), su.token);
await hiPage.goto(APP + '/onboarding/profile');
await hiPage.waitForSelector('.pf-input', { timeout: 10000 });
// Switch to Hindi via the flow's OWN header toggle.
// The toggle now lives in the SITE header (the flow renders inside PageShell). At
// 360px it is in .mobile-header-actions, visible rather than behind the hamburger —
// which is the property that matters: this is the one screen a student cannot skip
// past, so being trapped in English here would be the worst place for it.
// ':visible' matters: the header renders BOTH a desktop and a mobile toggle and hides
// one by CSS, so a plain .first() resolves to the hidden desktop button at 360px and
// the click times out against an element that is present but not clickable.
await hiPage.locator('.lang-toggle:visible').first().click();
await hiPage.waitForTimeout(800);
const hiQ = await hiPage.locator('.pf-question').innerText();
check('language toggle is reachable from the profile flow', true);
check('question renders in Devanagari', /[ऀ-ॿ]/.test(hiQ), `"${hiQ.slice(0, 30)}…"`);
const hiBtn = await hiPage.locator('.pf-primary').first().innerText();
check('buttons render in Devanagari', /[ऀ-ॿ]/.test(hiBtn), hiBtn);

// Deliberate validation error, in Hindi: age out of range.
await hiPage.locator('.pf-input').first().fill('99');
await hiPage.waitForTimeout(300);
const contDisabled = await hiPage.locator('.pf-primary').first().isDisabled();
check('client-side gate blocks age 99', contDisabled);
// Now force a SERVER error in Hindi by patching a bad age directly through the form
// path: fill a valid-looking value the client accepts but the server rejects is not
// possible here, so assert the mapped Devanagari string exists for the code instead.
const hiErrString = await hiPage.evaluate(async () => {
  const m = await import('/src/data/translations.js');
  return m.translations.hi.onboarding.errors.AGE_OUT_OF_RANGE;
});
check('server error CODE maps to a Devanagari string', /[ऀ-ॿ]/.test(hiErrString), hiErrString);
check('no page errors in Hindi mode', hiErrors.length === 0, hiErrors[0] || 'none');
await hiCtx.close();

console.log('\n── 8. console cleanliness ──');
const realErrors = consoleErrors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
check('no console errors during the flow', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'none');

await browser.close();

const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
process.exit(0);
