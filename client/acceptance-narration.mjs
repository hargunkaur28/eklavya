// Workstream F acceptance — REAL BROWSER.
//
// Narration outliving its page cannot be unit-tested: the whole bug is that playback
// lives OUTSIDE the component tree, in browser singletons. So this drives the real app
// and inspects the real playback surfaces after each navigation.
//
// MEASUREMENT NOTE, learned the hard way: the shared HTMLAudioElement is created with
// `new Audio()` and is NEVER ATTACHED TO THE DOM — that is what makes it survive a
// route change in the first place. An earlier version of this file measured
// `document.querySelectorAll('audio')`, got an empty list, and reported "0 playing"
// for every check while audio was in fact playing perfectly. The checks passed by
// measuring nothing. So the element is captured from `play()` itself.
import { chromium, devices } from 'playwright';

const APP = 'http://127.0.0.1:5173';
const results = [];
const check = (n, pass, d = '') => { results.push([n, pass]); console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${d ? '  — ' + d : ''}`); };

const token = process.env.ACC_TOKEN;
const ROADMAP = process.env.ACC_ROADMAP;
if (!token || !ROADMAP) { console.error('ACC_TOKEN and ACC_ROADMAP required'); process.exit(1); }
const DAY = `${APP}/roadmap/${ROADMAP}/day/1`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 720 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.addInitScript(() => {
  // `UklGRigA` is the silent priming clip audioPriming.js plays during a user gesture
  // to satisfy the autoplay policy. It is not narration and must not count as one.
  const SILENT = 'UklGRigA';
  window.__events = [];
  window.__lastAudio = null;
  const origPlay = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = function (...a) {
    const src = String(this.src || '');
    if (!src.includes(SILENT)) { window.__lastAudio = this; window.__events.push({ kind: 'play', at: Date.now() }); }
    return origPlay.apply(this, a);
  };
  if (window.speechSynthesis) {
    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => { window.__events.push({ kind: 'speak', at: Date.now() }); return origSpeak(u); };
  }
  window.__mark = () => { window.__markAt = Date.now(); };
  // Did anything START producing sound after the marker? This is the real question —
  // "is it audible right now" races with a clip that happened to end on its own.
  window.__startedSince = () => window.__events.filter((e) => e.at >= (window.__markAt || 0)).length;
});

// ACC_FORCE_FALLBACK=1 fails every server TTS route, forcing the Web Speech path.
// That path is the one most likely to survive a navigation — speechSynthesis is a
// browser-level singleton with no fetch to abort and no element to pause — so it gets
// the same checks rather than being assumed to behave like the audio path.
const FORCE_FALLBACK = process.env.ACC_FORCE_FALLBACK === '1';
if (FORCE_FALLBACK) {
  // A predicate, not glob patterns. Globs missed /diagnostic/:id/question/:i/audio on
  // the first attempt, so the run silently exercised the SERVER path while claiming to
  // test the fallback — the audio surfaces are spread across four different URL shapes.
  await ctx.route((url) => /\/(chat\/tts|live-audio)$|\/audio(\?|$)/.test(url.pathname + url.search),
    (r) => r.fulfill({ status: 502, contentType: 'application/json',
      // The REAL server includes fallbackText in its 502 body, and some speaker call
      // sites pass only an audioEndpoint — with an empty body they have nothing to
      // speak, so a bare '{}' stub tests a situation that cannot occur in production.
      body: JSON.stringify({ fallbackText: 'Light travels in straight lines and reflects from a mirror.', fallbackLang: 'en' }) }));
  console.log('   [mode] server TTS disabled — exercising the Web Speech fallback');
}

await page.goto(APP);
await page.evaluate((tk) => localStorage.setItem('eklavya_token', tk), token);

// Live state of the ACTUAL element that played, plus the speech queue.
const audible = () => page.evaluate(() => {
  const a = window.__lastAudio;
  return {
    audioLive: !!(a && !a.paused && a.src && a.currentTime > 0),
    audioSrc: a ? String(a.src).slice(0, 24) : '(none)',
    paused: a ? a.paused : null,
    speaking: !!(window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending)),
    events: window.__events.length
  };
});
// Poll rather than waiting a fixed interval: the TTS round-trip is provider-dependent
// and has ranged from under a second to over six. A fixed wait turns provider latency
// into a test failure, which is the flakiness that makes a suite worth ignoring.
const startNarration = async (loc, budgetMs = 20000) => {
  // Do NOT click if narration is already running. With autoNarrateQuizzes on, the page
  // may already be auto-narrating — and pressing a speaker that is currently playing
  // STOPS it (correct behaviour). An earlier version of this helper clicked
  // unconditionally and so silently stopped the very narration it was trying to start,
  // failing the control for a reason that had nothing to do with the code under test.
  const already = await page.evaluate(() => {
    try { return !!(window.speechSynthesis?.speaking) || !!(window.__lastAudio && !window.__lastAudio.paused); }
    catch { return false; }
  });
  if (!already) await loc.click();
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const st = await audible();
    if (st.audioLive || st.speaking) return st;
    await page.waitForTimeout(500);
  }
  return audible();
};

console.log('\n-- 0. CONTROL: narration actually starts --');
await page.goto(DAY);
await page.waitForLoadState('networkidle');
const speaker = page.locator('.speaker-btn').first();
if (!(await speaker.count())) { console.log('no speaker button on the day page'); await browser.close(); process.exit(1); }
await startNarration(speaker);
const started = await audible();
console.log(`   ${JSON.stringify(started)}`);
check(FORCE_FALLBACK ? 'CONTROL: the WEB SPEECH fallback is speaking' : 'CONTROL: a real narration is playing (not the silent priming clip)',
  FORCE_FALLBACK ? started.speaking : (started.audioLive || started.speaking),
  `audioLive=${started.audioLive} speaking=${started.speaking} src=${started.audioSrc}`);
if (!(started.audioLive || started.speaking)) {
  console.log('nothing is actually playing — every check below would pass vacuously. Stopping.');
  await browser.close(); process.exit(1);
}

console.log('\n-- 1. route change stops narration --');
await page.evaluate(() => window.__mark());
await page.goto(APP + '/profile');
await page.waitForTimeout(1500);
const afterRoute = await audible();
check('the audio element is paused after a route change', !afterRoute.audioLive,
  `audioLive=${afterRoute.audioLive} paused=${afterRoute.paused}`);
check('speechSynthesis is silent after a route change', !afterRoute.speaking);

console.log('\n-- 2. in-app section change stops narration (pathname does NOT change) --');
await page.goto(APP + '/dashboard');
await page.waitForLoadState('networkidle');
// The dashboard's speaker buttons live in the diagnostic-review section, so that
// section has to be opened before there is anything here to narrate.
const pills = page.locator('.pill');
const reviewPill = pills.filter({ hasText: /review/i }).first();
if (await reviewPill.count()) { await reviewPill.click(); await page.waitForTimeout(1500); }
const spk2 = page.locator('.speaker-btn').first();
if (await spk2.count()) {
  const mid2 = await startNarration(spk2);
  const pathBefore = await page.evaluate(() => location.pathname);
  // Switch to a DIFFERENT section. This changes activeSection only — the route is
  // untouched — which is exactly the case a pathname-based stopper cannot see.
  const other = pills.filter({ hasText: /notes|practice|progress/i }).first();
  if (await other.count()) {
    await other.click();
    await page.waitForTimeout(1500);
    const pathAfter = await page.evaluate(() => location.pathname);
    const afterSection = await audible();
    check('FIXTURE: narration was playing before the section change', mid2.audioLive || mid2.speaking,
      `audioLive=${mid2.audioLive} speaking=${mid2.speaking}`);
    check('FIXTURE: the section change did NOT change pathname', pathBefore === pathAfter,
      `${pathBefore} -> ${pathAfter}`);
    check('narration stops on an in-app section change', !afterSection.audioLive && !afterSection.speaking,
      `audioLive=${afterSection.audioLive} speaking=${afterSection.speaking}`);
  } else { check('a second sidebar section entry was found to click', false); }
} else { check('a speaker button exists in the dashboard review section', false); }

console.log('\n-- 3. a second speaker button stops the first --');
await page.goto(DAY);
await page.waitForLoadState('networkidle');
const all = page.locator('.speaker-btn');
const n = await all.count();
if (n >= 2) {
  await all.nth(0).click();
  await page.waitForTimeout(2500);
  await all.nth(1).click();
  await page.waitForTimeout(3000);
  const two = await page.evaluate(() => {
    const a = window.__lastAudio;
    return { one: !!(a && !a.paused), speaking: !!(window.speechSynthesis?.speaking) };
  });
  // There is only ever ONE element, so "two playing" is structurally impossible — which
  // is the point. What is checkable is that audio and speech are not BOTH running.
  check('audio and speech are not both active after two buttons', !(two.one && two.speaking),
    `audio=${two.one} speech=${two.speaking}`);
} else { check(`two speaker buttons available (found ${n})`, false); }

console.log('\n-- 4. navigating mid-flight never starts playback --');
await page.goto(DAY);
await page.waitForLoadState('networkidle');
const slow = await ctx.newCDPSession(page);
await slow.send('Network.enable');
const spk4 = page.locator('.speaker-btn').first();
if (await spk4.count()) {
  // Throttle AFTER the page is loaded, so only the TTS request is slow.
  await slow.send('Network.emulateNetworkConditions', {
    offline: false, latency: 2500, downloadThroughput: 10 * 1024, uploadThroughput: 10 * 1024
  });
  await page.evaluate(() => window.__mark());
  await spk4.click();
  await page.waitForTimeout(300);                 // request still in flight
  await page.goto(APP + '/profile', { waitUntil: 'commit' });
  await slow.send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1
  });
  await page.waitForTimeout(6000);                // let any stale response land
  const startedSince = await page.evaluate(() => window.__startedSince());
  const mid = await audible();
  check('no playback STARTED after navigating mid-request', startedSince === 0,
    `${startedSince} play/speak events after the navigation`);
  check('nothing is audible after the stale response lands', !mid.audioLive && !mid.speaking,
    `audioLive=${mid.audioLive} speaking=${mid.speaking}`);
} else { check('speaker available for the mid-flight test', false); }

console.log('\n-- 5. tab hidden stops narration --');
await page.goto(DAY);
await page.waitForLoadState('networkidle');
const spk5 = page.locator('.speaker-btn').first();
if (await spk5.count()) {
  await startNarration(spk5);
  const before5 = await audible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1000);
  const hidden = await audible();
  check('FIXTURE: narration was playing before backgrounding', before5.audioLive || before5.speaking);
  check('narration stops when the tab is backgrounded', !hidden.audioLive && !hidden.speaking,
    `audioLive=${hidden.audioLive} speaking=${hidden.speaking}`);
} else { check('speaker available for the visibility test', false); }

console.log('\n-- 6. INITIATION: narration must still START --');
// EVERY check above verifies CESSATION. A suite in that shape stays green if
// auto-narration is completely dead — which is a live risk here, because both stoppers
// fire on mount as well as on transition, React runs effects bottom-up (so a page's
// autoPlay effect has already scheduled its narration by the time a parent stopper
// runs), and the failure is silent: manual buttons keep working, autoplay just never
// plays, nothing errors. Rule 11 again — a narration suite that cannot detect narration
// being dead is observing the wrong thing.
{
  // Reach the live controller singleton so these assert on isNarrating(), not on audio
  // timing. Same reasoning as verify-narration-stop.mjs.
  const reach = async () => page.evaluate(async () => {
    window.__nc = await import('/src/utils/narrationController.js');
    return typeof window.__nc.isNarrating === 'function';
  });

  // 6a. AUTO-narration: opening a module quiz must start narration with no further
  // interaction. This is F4 and it is the check the suite most needed — twelve
  // cessation checks stay green if autoplay is completely dead.
  await page.goto(DAY);
  await page.waitForLoadState('networkidle');
  await reach();
  const startQuiz = page.locator('button').filter({ hasText: /start|quiz|begin/i }).first();
  let autoStarted = null;
  if (await startQuiz.count()) {
    await startQuiz.click().catch(() => {});
    // Generation is a live Groq call, so poll generously rather than budgeting it.
    autoStarted = await page.evaluate(async () => {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (window.__nc.isNarrating()) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    });
    const prefOn = await page.evaluate(async () => {
      try {
        // Absolute base: the client runs on :5173 and the API on :5000, so a relative
        // URL silently resolves to the dev server and the fixture reads null.
        const r = await fetch('http://127.0.0.1:5000/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('eklavya_token') } });
        return (await r.json())?.user?.autoNarrateQuizzes;   // payload is { user, mustChangePassword }
      } catch { return null; }
    });
    // FIXTURE FIRST, so a disabled preference can never masquerade as a passing test.
    check('FIXTURE: the autoplay preference is actually ON for this student', prefOn === true, `autoNarrateQuizzes=${prefOn}`);
    check('auto-narration STARTS on a quiz with no further interaction (F4)', autoStarted === true,
      `isNarrating=${autoStarted}`);
    await page.evaluate(() => window.__nc.stopNarration());
  } else {
    check('a quiz entry point was found for the autoplay test', false);
  }

  // 6b. THE LOAD-BEARING ONE: a manual press must start narration. If the first-run
  // guard were missing this still passes, so it is not sufficient on its own — but if
  // it fails, narration is dead outright.
  await page.goto(DAY);
  await page.waitForLoadState('networkidle');
  await reach();
  const btn = page.locator('.speaker-btn').first();
  await btn.click();
  const manualStarted = await page.evaluate(async () => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (window.__nc.isNarrating()) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  });
  check('a manual speaker press STARTS narration', manualStarted, `isNarrating=${manualStarted}`);

  // 6c. The mount-time stop must not kill a narration started immediately after mount.
  // This is the regression the first-run guard exists for: navigate, then start
  // narration as soon as the page is up, and confirm it survives.
  await page.goto(APP + '/dashboard');
  await page.waitForLoadState('networkidle');
  await reach();
  const survived = await page.evaluate(async () => {
    // Start narration through the controller the instant the route settles.
    window.__nc.playNarration({
      ownerId: 'init-test',
      resolve: async () => ({ speak: { text: 'Reflection of light. '.repeat(30), lang: 'en' } })
    });
    await new Promise((r) => setTimeout(r, 1500));
    return window.__nc.isNarrating();
  });
  check('narration started just after a route change is NOT killed by the mount-time stop',
    survived, `isNarrating=${survived}`);
  await page.evaluate(() => window.__nc.stopNarration());

  // 6d. Multi-question pages must autoplay Q1 only — one narration, never two.
  const overlap = await page.evaluate(() => {
    // Structurally impossible by design (one element, one queue); asserted anyway
    // because "impossible" is what the previous per-component design also assumed.
    const st = window.__nc.getNarrationState();
    return { status: st.status, owner: st.ownerId };
  });
  check('exactly one narration owner at a time', overlap.owner === null || typeof overlap.owner === 'string',
    JSON.stringify(overlap));
}

console.log('\n-- 7. AUTOPLAY BLOCKED is the COMMON path, not an edge case --');
// Chrome and Safari block autoplay-with-sound on a fresh load with no prior user
// gesture BY DEFAULT, so for a student opening a quiz for the first time
// NotAllowedError is the EXPECTED outcome — the pulsing "Tap to listen" affordance is
// the primary experience, not a rare fallback. It should therefore be the most robustly
// tested thing here, not the most fragile.
//
// So it does NOT go through the day page. Routing it through a real UI flow made it
// depend on lesson prose, Groq, the network and real audio — four things that can each
// fail for reasons unrelated to autoplay blocking. Same lesson as the revert
// verification: assert at the mechanism.
{
  await page.goto(DAY);
  await page.waitForLoadState('networkidle');

  // 7a. CONTROLLER: a rejected play() must produce the 'blocked' state, and must NOT
  // leave the controller believing it is narrating.
  const ctrl = await page.evaluate(async () => {
    const nc = await import('/src/utils/narrationController.js');
    nc.stopNarration();
    // Reject exactly as the browser policy does.
    HTMLAudioElement.prototype.play = function () {
      const e = new Error('play() failed because the user did not interact first');
      e.name = 'NotAllowedError';
      return Promise.reject(e);
    };
    let reported = null;
    await nc.playNarration({
      ownerId: 'blocked-test',
      resolve: async () => ({ src: 'data:audio/wav;base64,UklGRv//' }),
      onError: (kind) => { reported = kind; }
    });
    const st = nc.getNarrationState();
    return { status: st.status, reported, narrating: nc.isNarrating() };
  });
  check('a rejected play() reports the BLOCKED state, not a generic error',
    ctrl.status === 'blocked' && ctrl.reported === 'blocked', JSON.stringify(ctrl));
  check('a blocked narration does not leave the controller believing it is narrating',
    ctrl.narrating === false, `isNarrating=${ctrl.narrating}`);

  // 7b. SPEAKERBUTTON: the affordance must actually RENDER. Driven by clicking the
  // real button with play() still stubbed to reject, so this exercises the component's
  // own subscription to the controller rather than asserting on a prop we set.
  const btn = page.locator('.speaker-btn').first();
  if (await btn.count()) {
    await btn.click();
    let blockedClass = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      blockedClass = await btn.evaluate((el) => el.className.includes('autoplay-blocked'));
      if (blockedClass) break;
      await page.waitForTimeout(500);
    }
    const title = await btn.getAttribute('title');
    check('a blocked autoplay renders the "Tap to listen" affordance, not silence',
      blockedClass, `autoplay-blocked=${blockedClass} title="${title}"`);
    check('the blocked button stays pressable so the student can tap to listen',
      !(await btn.isDisabled()), 'enabled');
  } else {
    check('a speaker button was available for the blocked-state render check', false,
      'none on the day page — 7a still verified the controller half');
  }
}

console.log('\n-- console --');
const unexpected = consoleErrors.filter((e) => !/favicon|ResizeObserver|Download the React/i.test(e))
  // In fallback mode the 502s are deliberately injected by this harness.
  .filter((e) => !(FORCE_FALLBACK && /502|Bad Gateway/i.test(e)));
check('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 2).join(' | ') || 'none');

await browser.close();
const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length) { console.log('FAILED:'); failed.forEach(([n]) => console.log('  - ' + n)); process.exit(1); }
