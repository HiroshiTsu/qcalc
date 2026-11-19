// Opens QCalc's page on a test server in Chromium (Playwright) and drives it to the screens used on the
// store pictures and in the videos (store/tools/shots.js, store/tools/video.js). Everything is the real
// app: the page of app/assets with the real engine behind the test server of the page tests (README.md).
// Needs Node.js and Playwright (as the tests and manual/shots.js).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      localStorage.setItem('qalc.news', JSON.stringify('1.12'));
    } catch (e) { }
  }, [S.lang, Object.assign({ auto_rates: false, appearance: o.dark ? 'dark' : 'light' }, o.settings || {})]);
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
  await m2.locator('button.rev3d').click(); await sleep(6000);
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
async function setPrecisionAndReload(page, n) {
  await page.evaluate((n) => { const s = JSON.parse(localStorage.getItem('qalc.settings') || '{}'); s.precision = n; localStorage.setItem('qalc.settings', JSON.stringify(s)); }, n);
  await page.reload(); await ready(page);
}

module.exports = { sleep, SETS, COMMA, mainExamples, start, ready, home, menu, tool, type, eq, body, scrollTo, solid2d, solid3d, graphRect, profile, manualAbout, setPrecisionAndReload };
