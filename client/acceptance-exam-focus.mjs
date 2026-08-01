// Verify the exam bar actually stays visible while scrolling — in the BROWSER, at
// desktop and phone widths. Reasoning about `position: sticky` and ancestor
// `overflow` got this wrong twice, so this measures the rendered result instead.
//
// Renders the real stylesheet against a DOM shaped like the real one (the exam lives
// inside main > .dashboard-bg > .dashboard-card > .dashboard-main), with the
// `exam-focus` class the component sets.
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const css = fs.readFileSync('./src/styles.css', 'utf8');

const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
<body class="exam-focus">
  <main>
    <div class="dashboard-bg"><div class="dashboard-card">
      <aside class="dashboard-sidebar pill-sidebar">RAIL</aside>
      <div class="dashboard-main">
        <div class="pyq-panel pyq-exam">
          <div class="pyq-exam-bar">
            <div class="pyq-exam-timer"><strong id="clock">02:29:51</strong></div>
            <span class="pyq-exam-progress">0/47 answered</span>
            <div class="pyq-exam-actions">
              <button class="ghost-button"><span class="pyq-btn-label">Pause</span></button>
              <button class="ghost-button"><span class="pyq-btn-label">Fullscreen</span></button>
              <button class="ghost-button"><span class="pyq-btn-label">Exit</span></button>
              <button class="primary-button" id="submit">Submit</button>
            </div>
          </div>
          ${Array.from({ length: 60 }, (_, i) => `<article class="pyq-question"><h4>Question ${i + 1}</h4><p>body text to make the page long enough to scroll</p></article>`).join('')}
        </div>
      </div>
    </div></div>
  </main>
  <button class="chat-toggle-btn">chat</button>
</body></html>`;

const results = [];
const check = (n, pass, detail = '') => {
  results.push([n, pass]);
  console.log(`${pass ? 'PASS' : '*** FAIL ***'}  ${n}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch();

for (const [label, opts] of [
  ['desktop 1280x800', { viewport: { width: 1280, height: 800 } }],
  ['phone 360x740', { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  // Chrome must be hidden in focus mode.
  const railHidden = await page.locator('.dashboard-sidebar').isHidden();
  const chatHidden = await page.locator('.chat-toggle-btn').isHidden();
  check(`[${label}] rail hidden`, railHidden);
  check(`[${label}] chat widget hidden`, chatHidden);

  const before = await page.locator('.pyq-exam-bar').boundingBox();

  // Scroll the exam's own container a long way down.
  await page.evaluate(() => {
    const el = document.querySelector('.pyq-exam');
    el.scrollTop = 2000;
  });
  await page.waitForTimeout(150);

  const scrolled = await page.evaluate(() => document.querySelector('.pyq-exam').scrollTop);
  const after = await page.locator('.pyq-exam-bar').boundingBox();
  const vh = opts.viewport.height;

  check(`[${label}] the exam actually scrolled`, scrolled > 500, `scrollTop=${scrolled}`);

  // THE property, stated in words first: a pinned bar DOES NOT MOVE when the content
  // behind it scrolls. Its y is unchanged.
  //
  // The first version of this asserted `y < 35% of the viewport` instead, which is
  // not the invariant — it is a guess at where the bar might end up. Verified
  // against a deliberately broken stylesheet, that version PASSED: the bar had slid
  // from y=84 to y=12, plainly unpinned, but 12 is still under the threshold. Rule 18
  // caught by its own check.
  check(`[${label}] bar does not move when content scrolls`,
    after && before && Math.abs(after.y - before.y) <= 2,
    `y ${before ? Math.round(before.y) : '?'} -> ${after ? Math.round(after.y) : 'gone'}, viewport=${vh}`);

  // FLUSH TO THE TOP — and this is the check that was missing.
  // "Does not move" was true of a bar parked 84px down with question text scrolling
  // through the strip above it, which is what shipped and what the screenshot caught.
  // Sticky pins to the scroll container's PADDING box, so any padding-top leaves a
  // gap that content shows through. The bar must sit at the very top of the scrollport.
  check(`[${label}] bar is FLUSH to the top (no gap for content to show through)`,
    after && after.y <= 2, `y=${after ? Math.round(after.y) : 'gone'}`);

  // And nothing renders above it. Measured rather than inferred: sample the pixel
  // strip between the scrollport top and the bar, and assert there is no strip.
  const gap = await page.evaluate(() => {
    const wrap = document.querySelector('.pyq-exam');
    const bar = document.querySelector('.pyq-exam-bar');
    return Math.round(bar.getBoundingClientRect().top - wrap.getBoundingClientRect().top);
  });
  check(`[${label}] no gap between scrollport top and bar`, gap <= 2, `gap=${gap}px`);

  // THE CHECK THAT WAS MISSING, and the one that would have caught the reported
  // empty band. `body` carries `padding-top: 72px` for the fixed site header; focus
  // mode hides the header but the reserved space stayed, so the exam started 72px
  // down AND its last 72px hung off the bottom. Real fullscreen never showed it
  // because a fullscreened element is promoted out of `body`.
  //
  // Asserting the bar's own position was not enough — the bar was correctly flush
  // INSIDE a container that was itself in the wrong place. The container has to be
  // checked against the viewport, not just its contents against it.
  const box = await page.evaluate(() => {
    const r = document.querySelector('.pyq-exam').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  check(`[${label}] exam starts at the very top of the viewport`, box.top <= 2, `top=${box.top}`);
  check(`[${label}] exam ends at the bottom of the viewport (nothing cut off)`,
    Math.abs(box.bottom - vh) <= 2, `bottom=${box.bottom} viewport=${vh}`);
  check(`[${label}] body reclaims the fixed-header padding`,
    await page.evaluate(() => parseInt(getComputedStyle(document.body).paddingTop, 10) === 0),
    await page.evaluate(() => getComputedStyle(document.body).paddingTop));

  // Submit must not be clipped off the right edge.
  const submit = await page.locator('#submit').boundingBox();
  check(`[${label}] Submit fully within the viewport`,
    submit && submit.x >= 0 && (submit.x + submit.width) <= opts.viewport.width + 1,
    submit ? `x=${Math.round(submit.x)} right=${Math.round(submit.x + submit.width)} vw=${opts.viewport.width}` : 'not found');

  // Labels drop to icon-only on the phone, stay on desktop.
  const labelVisible = await page.locator('.pyq-exam-actions .pyq-btn-label').first().isVisible();
  check(`[${label}] button labels ${opts.viewport.width < 760 ? 'hidden (icon-only)' : 'shown'}`,
    opts.viewport.width < 760 ? !labelVisible : labelVisible);

  await ctx.close();
}

await browser.close();
const failed = results.filter(([, p]) => !p);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
