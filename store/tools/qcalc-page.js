// Opens QCalc's page on a test server in Chromium (Playwright) and drives it to the screens used on the
// store pictures and in the videos (store/tools/shots.js, store/tools/video.js). Everything is the real
// app: the page of app/assets with the real engine behind the test server of the page tests (README.md).
// Needs Node.js and Playwright (as the tests and manual/shots.js).
// (1.14.0) slow motion for the scenes whose drawing is slow in this browser (the 3D drawn with WebGL 2 on SwiftShader,
// the CPU: a frame of a tank with its clear container takes about half a second): while a scene is recorded with
// setSlow(k), every wait here is k times longer, and the page's clock runs k times slower (SLOW_CLOCK below: its
// performance.now, Date.now, the times of requestAnimationFrame, setTimeout and setInterval; the CSS animations through
// the DevTools, video.js). The frames are then laid k times closer together, so that the scene has its own pace and
// k times as many frames.
let SLOW = 1;
const setSlow = (k) => { SLOW = k > 1 ? k : 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SLOW));
const SLOW_CLOCK = () => {
  const P = performance, pnow = P.now.bind(P), dnow = Date.now.bind(Date);
  let K = 1, r0 = pnow(), s0 = r0, d0 = dnow(), e0 = d0;
  const sc = () => s0 + (pnow() - r0) / K;
  window.__qcalcSetK = (k) => { const s = sc(), e = e0 + (dnow() - d0) / K; K = k > 1 ? k : 1; r0 = pnow(); s0 = s; d0 = dnow(); e0 = e; };
  P.now = () => sc();
  Date.now = () => e0 + (dnow() - d0) / K;
  const raf = window.requestAnimationFrame.bind(window), st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(sc()));
  window.setTimeout = (f, d, ...a) => st(f, (+d || 0) * K, ...a);
  window.setInterval = (f, d, ...a) => si(f, (+d || 0) * K, ...a);
};

// the sets of pictures: the language of the app and the region of the phone (number format, currency)
const SETS = {
  ja: { lang: 'ja', locale: 'ja-JP' },
  en: { lang: 'en', locale: 'en-US' },
  'en-GB': { lang: 'en', locale: 'en-GB' },
  de: { lang: 'de', locale: 'de-DE' },
  es: { lang: 'es', locale: 'es-ES' },
  'es-419': { lang: 'es', locale: 'es-MX' },
  fr: { lang: 'fr', locale: 'fr-FR' },
  'fr-CA': { lang: 'fr', locale: 'fr-CA' },
  ko: { lang: 'ko', locale: 'ko-KR' },
  'zh-TW': { lang: 'zh-TW', locale: 'zh-TW' }
};
const COMMA = { de: 1, es: 1, fr: 1, 'fr-CA': 1 };
// the history of the first picture: what people type, with an example of the region
function mainExamples(set) {
  const c = COMMA[set];
  const local = {
    ja: '12 m × 3.5 m to 坪', en: '3/4 in to mm', 'en-GB': '5 ft + 10 in to cm', 'zh-TW': '30 坪 to m²'
  }[set] || (c ? '2,4 m × 1,8 m × 0,15 m to L' : '2.4 m × 1.8 m × 0.15 m to L');
  const speed = set === 'en' ? '60 mph to km/h' : set === 'en-GB' ? '70 mph to km/h' : '100 km/h to mph';
  return [speed, 'solve(x^2 − 5x + 6 = 0)', 'integrate(x^2 sin(x), 0, pi)', local];
}

async function start(browser, base, set, o) {
  o = o || {};
  const S = SETS[set];
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 384, height: 640 }, deviceScaleFactor: o.dpr || 2, hasTouch: true, locale: S.locale,
    colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduceMotion ? 'reduce' : 'no-preference',
    recordVideo: o.video ? { dir: o.video.dir, size: o.video.size } : undefined
  });
  await ctx.addInitScript(([l, st]) => {
    try {
      if (sessionStorage.getItem('st')) return;
      sessionStorage.setItem('st', '1');
      localStorage.setItem('qalc.lang', JSON.stringify(l));
      localStorage.setItem('qalc.settings', JSON.stringify(st));
      localStorage.setItem('qalc.moved112', 'true');
      localStorage.setItem('qalc.news', JSON.stringify('1.15'));
      localStorage.setItem('qalc.defaults115', 'true'); // (1.15.0: the defaults of a new phone, 15 digits in groups)
    } catch (e) { }
  }, [S.lang, Object.assign({ auto_rates: false, appearance: o.dark ? 'dark' : 'light' }, o.settings || {})]);
  if (o.slowClock) await ctx.addInitScript(SLOW_CLOCK);
  const page = await ctx.newPage();
  await page.goto(base + (o.q || '?pro=all'));
  await ready(page);
  return { ctx, page };
}
const ready = async (page) => {
  await page.waitForFunction(() => /\d+\.\d+/.test((document.getElementById('drawer-sub') || {}).textContent || ''), null, { timeout: 120000 });
  await sleep(700);
};
const home = (page) => page.evaluate(() => { for (let i = 0; i < 10; i++) if (!window.qalcBack()) break; });
async function menu(page, n) { await home(page); await page.evaluate(() => document.getElementById('btn-menu').click()); await sleep(450); await page.locator('#drawer > button').nth(n).click(); await sleep(1300); }
async function tool(page, k, chip) {
  await menu(page, 1);
  await page.locator('.panel.open .tool-row[data-tool="' + k + '"]').first().click(); await sleep(2200);
  if (chip !== undefined) { await page.evaluate((n) => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); const c = b.querySelectorAll('.area-chip')[n]; if (c) c.click(); }, chip); await sleep(2800); }
}
// typing as a person does, one character at a time (videos), or all at once (pictures)
async function type(page, s, slow) {
  if (slow) {
    await page.evaluate(() => { const e = document.getElementById('expr'); e.value = ''; e.dispatchEvent(new InputEvent('input', { bubbles: true })); });
    for (const ch of s) {
      await page.evaluate((c) => { const e = document.getElementById('expr'); e.value += c; e.dispatchEvent(new InputEvent('input', { bubbles: true })); }, ch);
      await sleep(slow);
    }
    await sleep(400);
    return;
  }
  await page.evaluate((s) => { const e = document.getElementById('expr'); e.value = s; e.dispatchEvent(new InputEvent('input', { bubbles: true })); }, s);
  await sleep(500);
}
async function eq(page) { await page.evaluate(() => { const k = Array.from(document.querySelectorAll('#grid .key')).find((x) => x.textContent.trim() === '='); if (k) k.click(); }); await sleep(1600); }
const body = (page) => page.evaluateHandle(() => Array.from(document.querySelectorAll('.panel.open .panel-body')).pop());
// scrolls the top panel so that an element is near the top
async function scrollTo(page, sel, off) {
  await page.evaluate(([sel, off]) => {
    const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop();
    const e = b && b.querySelector(sel);
    if (e) b.scrollTop += e.getBoundingClientRect().top - b.getBoundingClientRect().top - (off || 0);
  }, [sel, off]);
  await sleep(500);
}
// the 2D graph with y = x and y = x² and the solid of revolution between them ("⟳ 3D")
async function solid2d(page) {
  await menu(page, 2);
  const m2 = page.locator('.panel.open .plot-mode').nth(0);
  await m2.locator('textarea').fill('x\nx^2'); await m2.locator('.plot-form .plot-range input').nth(0).fill('-0.5'); await m2.locator('.plot-form .plot-range input').nth(1).fill('1.5');
  await m2.locator('.plot-form .btn.primary').click(); await sleep(2500);
  await m2.locator('button.rev3d').click(); await sleep(1500);
  // (1.12.0, BG20: with Pro, ⟳ 3D shows the solid in 3D at once; this picture is of the 2D graph: back to it,
  // and the hint about the axes, shown on coming back the first time, gone)
  for (let i = 0; i < 150; i++) {
    const done = await page.evaluate(() => { const b = document.querySelector('.panel.open .rev3d-back'); if (b && !b.hidden && b.getClientRects().length) { b.querySelector('.btn').click(); return true; } return false; });
    if (done) { await sleep(6800); break; }
    await sleep(200);
  }
  await scrollTo(page, '.plot-wrap', 8);
}
// then "View in 3D": the 3D graph of the solid (QCalc Pro), after it has turned from 0° to 360°
async function solid3d(page, wait) {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.panel.open button.btn')).find((x) => /3D/.test(x.textContent) && !/=/.test(x.textContent) && x.offsetParent && !x.classList.contains('rev3d'));
    if (b) b.click();
  });
  await sleep(wait || 8000);
  await scrollTo(page, '.plot-wrap', 8);
}
// the rectangle of the graph in the top panel (to cut it out of a picture), in CSS pixels
const graphRect = (page) => page.evaluate(() => {
  const ws = Array.from(document.querySelectorAll('.panel.open .plot-wrap')).filter((w) => w.offsetParent);
  const w = ws.pop();
  const r = w.getBoundingClientRect();
  return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: Math.min(r.height, innerHeight - r.top) };
});
async function profile(page) {
  await tool(page, 'profile', 0); await sleep(1500);
  await scrollTo(page, '.pf-pic', 4);
}
// (1.12.0, D6) a lying tank with semi-elliptical 2:1 heads, 1.2 m across and 2.4 m long, in litres, filled to pc %,
// shown in 3D with "⟳ 3D" (QCalc Pro): the liquid, the amount and % at the level, the scale on the wall
async function tank3d(page, set, pc) {
  await tankSetup(page, set, pc);
  await page.locator('.panel.open .geo-3d').last().click();
  await modelDone(page);
  await sleep(1200);
}
// the 3D graph of a solid or tank of "Shapes" when it has grown and the liquid has risen
const modelDone = (page) => page.waitForFunction(() => {
  const c = Array.from(document.querySelectorAll('.panel.open .plot-mode')).filter((m) => !m.hidden).pop();
  const cv = c && c.querySelector('.plot-wrap canvas[aria-label]');
  if (!cv || !cv.dataset.model) return false;
  const m = JSON.parse(cv.dataset.model); return m.grow === 1 && !m.fill;
}, null, { timeout: 30000 });
// the tank of tank3d in the tool, before "⟳ 3D"
async function tankSetup(page, set, pc) {
  await tool(page, 'tanks');
  const num = (x) => (COMMA[set] ? String(x).replace('.', ',') : String(x));
  await page.evaluate(() => { const c = document.querySelectorAll('.panel.open .geo-chip')[0]; if (c && c.getAttribute('aria-pressed') !== 'true') c.click(); }); await sleep(800);
  await page.evaluate(() => { const b = document.querySelectorAll('.panel.open .head-row button')[2]; if (b) b.click(); }); await sleep(1000);
  await page.locator('.panel.open .geo-side select').last().selectOption('m'); await sleep(500);
  await page.locator('.panel.open .geo-units select').first().selectOption('L'); await sleep(500);
  const d = page.locator('.panel.open .geo-rd button').nth(1);
  if ((await d.getAttribute('aria-pressed')) !== 'true') { await d.click(); await sleep(500); }
  // the height of the level for pc % (the volume of the lying cylinder and of the two heads, a = r / 2)
  const r = 0.6, L = 2.4, a = 0.3, f = (pc || 62) / 100;
  const V = (h) => L * (r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, 2 * r * h - h * h))) + Math.PI * a * h * h * (3 * r - h) / (3 * r);
  let lo = 0, hi = 2 * r;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (V(m) < f * V(2 * r)) lo = m; else hi = m; }
  const vals = [1.2, 2.4, +((lo + hi) / 2).toFixed(3)];
  for (let i = 0; i < vals.length; i++) await page.locator('.panel.open .geo-sizes input').nth(i).fill(num(vals[i]));
  await sleep(2500);
}
async function manualAbout(page) {
  await menu(page, 0);
  await page.evaluate(() => { const b = document.querySelector('.panel.open .manual-btn'); if (b) b.click(); });
  await sleep(1800);
  await page.evaluate(() => {
    const d = Array.from(document.querySelectorAll('.panel.open')).pop();
    const s = d && d.querySelector('[data-sec="about"]');
    const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop();
    if (s && b) b.scrollTop += s.getBoundingClientRect().top - b.getBoundingClientRect().top - 6;
  });
  await sleep(600);
}
// the first example of the calculation notes uses yen in every language; outside Japan, the amounts of its
// first three lines are typed in the money of the region (the names stay those of the app's language)
const NOTE_MONEY = {
  en: ['1450 USD', '120 USD', '60 USD'], 'en-GB': ['1250 GBP', '95 GBP', '40 GBP'], de: ['980 EUR', '85 EUR', '40 EUR'], es: ['950 EUR', '70 EUR', '30 EUR'],
  'es-419': ['12000 MXN', '600 MXN', '300 MXN'], fr: ['850 EUR', '75 EUR', '35 EUR'], 'fr-CA': ['1650 CAD', '90 CAD', '45 CAD'],
  ko: ['650000 KRW', '55000 KRW', '20000 KRW'], 'zh-TW': ['18000 TWD', '1200 TWD', '400 TWD']
};
async function localNotes(page, set) {
  const m = NOTE_MONEY[set];
  if (!m) return;
  await page.evaluate((m) => {
    const ins = Array.from(document.querySelectorAll('.panel.open .note-lines input')).slice(0, 3);
    ins.forEach((inp, i) => { const k = inp.value.split('=')[0].trim(); inp.value = k + ' = ' + m[i]; inp.dispatchEvent(new Event('input', { bubbles: true })); });
  }, m);
  await sleep(2500);
}
async function setPrecisionAndReload(page, n) {
  await page.evaluate((n) => { const s = JSON.parse(localStorage.getItem('qalc.settings') || '{}'); s.precision = n; localStorage.setItem('qalc.settings', JSON.stringify(s)); }, n);
  await page.reload(); await ready(page);
}

module.exports = { sleep, setSlow, SETS, COMMA, mainExamples, localNotes, start, ready, home, menu, tool, type, eq, body, scrollTo, solid2d, solid3d, graphRect, profile, tank3d, tankSetup, modelDone, manualAbout, setPrecisionAndReload };
