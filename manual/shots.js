// Takes the photos of the web version of the user manual (docs/manual/<lang>/img/*.jpg), each in its
// language, from the app's page on a test server, with the places of the numbered marks
// (img/<name>.json). Only for the web version: the manual inside the app has no photos.
// Needs Node.js and Playwright (as the tests); run again when the screens change, then manual/build.py.
// The Pro panel is taken before Google Play sends the price (?pro=play-noprice): the price is set in Play
// Console and shown on Google Play's purchase screen, so the manual shows none.
// Usage: node manual/shots.js <base url of the page> [langs, e.g. ja,en] [photos, e.g. tanks,profile]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const LANGS = (process.argv[3] || 'ja,en,de,es,fr,ko,zh-TW').split(',');
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const OUT = path.join(__dirname, '..', 'docs', 'manual');
const LOCALE = { ja: 'ja-JP', en: 'en-US', de: 'de-DE', es: 'es-MX', fr: 'fr-FR', ko: 'ko-KR', 'zh-TW': 'zh-TW' };
const W = 360, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIST = {
  ja: [['1/3 + 1/4', '7/12', '0.5833333333'], ['60 mph to km/h', '', '96.56064 km/h'], ['sqrt(2)', '√2', '1.414213562']],
  en: [['1/3 + 1/4', '7/12', '0.5833333333'], ['60 mph to km/h', '', '96.56064 km/h'], ['sqrt(2)', '√2', '1.414213562']]
};
async function start(browser, lang, q) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, hasTouch: true, locale: LOCALE[lang] });
  await ctx.addInitScript((l) => {
    try {
      if (sessionStorage.getItem('sh')) return;
      sessionStorage.setItem('sh', '1');
      localStorage.setItem('qalc.lang', JSON.stringify(l));
      localStorage.setItem('qalc.settings', JSON.stringify({ auto_rates: false }));
      localStorage.setItem('qalc.moved112', 'true');
      localStorage.setItem('qalc.news', JSON.stringify('1.12'));
    } catch (e) { }
  }, lang);
  const page = await ctx.newPage();
  await page.goto(BASE + (q || '?pro=all'));
  await page.waitForFunction(() => /\d+\.\d+/.test((document.getElementById('drawer-sub') || {}).textContent || ''), null, { timeout: 90000 });
  await sleep(700);
  return { ctx, page };
}
const home = (page) => page.evaluate(() => { for (let i = 0; i < 10; i++) if (!window.qalcBack()) break; });
async function menu(page, n) { await home(page); await page.evaluate(() => document.getElementById('btn-menu').click()); await sleep(400); await page.locator('#drawer > button').nth(n).click(); await sleep(1200); }
async function tool(page, k, chip) {
  await menu(page, 1);
  await page.locator('.panel.open .tool-row[data-tool="' + k + '"]').first().click(); await sleep(2200);
  if (chip !== undefined) { await page.evaluate((n) => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); const c = b.querySelectorAll('.area-chip')[n]; if (c) c.click(); }, chip); await sleep(2800); }
}
async function type(page, s) {
  await page.evaluate((s) => { const e = document.getElementById('expr'); e.value = s; e.dispatchEvent(new InputEvent('input', { bubbles: true })); }, s);
  await sleep(500);
}
async function eq(page) { await page.evaluate(() => { const k = Array.from(document.querySelectorAll('#grid .key')).find((x) => x.textContent.trim() === '='); if (k) k.click(); }); await sleep(1500); }
// the centres of elements, as fractions of the screen (for the numbered marks)
const centres = (page, sels) => page.evaluate(([sels, W, H]) => sels.map((s) => {
  const e = typeof s === 'string' ? document.querySelector(s) : null;
  if (!e) return [0.5, 0.5];
  const r = e.getBoundingClientRect();
  return [Math.min(0.97, Math.max(0.03, (r.left + r.width / 2) / W)), Math.min(0.97, Math.max(0.03, (r.top + r.height / 2) / H))];
}), [sels, W, H]);
// the results of a tool in sight (below the boxes)
const outInView = (page) => page.evaluate(async () => {
  const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop();
  const o = b && b.querySelector('.geo-out');
  if (o) { b.scrollTop += o.getBoundingClientRect().top - b.getBoundingClientRect().top - 140; }
  await new Promise((r) => setTimeout(r, 400));
});
const SHOTS = {
  async main(page) {
    for (const x of ['1/3 + 1/4', '60 mph to km/h', 'sqrt(2)']) { await type(page, x); await eq(page); }
    await type(page, '2 + 3 × 4');
    return centres(page, ['#btn-menu', '.chips', '#btn-hist', '#history', '#expr', '.pages-row', '#grid', '#grid .key:last-child']);
  },
  async tools(page) { await menu(page, 1); },
  async price(page) {
    await tool(page, 'price', 0);
    return centres(page, ['.panel.open .help-btn', '.panel.open .area-chip', '.panel.open .geo-size input', '.panel.open .geo-out .geo-row', '.panel.open .caution-line', '.panel.open .form-hint']);
  },
  async loan(page) { await tool(page, 'loan', 0); },
  async convert(page) { await tool(page, 'convert'); await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); const i = b.querySelector('.conv-row input'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(1800); },
  async stats(page) { await tool(page, 'stats', 0); },
  async notes(page) { await tool(page, 'memo', 0); await sleep(1500); },
  async tanks(page) {
    await tool(page, 'tanks');
    await page.evaluate(async () => {
      const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(), wait = (ms) => new Promise((x) => setTimeout(x, ms));
      const d = Array.from(b.querySelectorAll('button')).find((x) => /^(直径|Diameter|Durchmesser|Diámetro|Diamètre|지름|直徑)$/.test(x.textContent.trim()));
      if (d) { d.click(); await wait(300); }
      const ins = Array.from(b.querySelectorAll('.geo-size input')).slice(0, 3);
      ['1', '2', '0.3'].forEach((v, i) => { if (ins[i]) { ins[i].value = v; ins[i].dispatchEvent(new Event('input', { bubbles: true })); } });
      const u = Array.from(b.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'm'));
      if (u) { u.value = 'm'; u.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(3000);
    await outInView(page);
  },
  async profile(page) { await tool(page, 'profile', 0); await sleep(1500); await outInView(page); },
  // (1.12.0, D6) a lying tank with semi-elliptical 2:1 heads in 3D, about 62 % full (D 1.2 m, L 2.4 m, in litres)
  async shapes3d(page) {
    await tool(page, 'tanks');
    await page.evaluate(async () => {
      const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(), wait = (ms) => new Promise((x) => setTimeout(x, ms));
      const head = Array.from(b.querySelectorAll('.head-row button')).find((x) => /2:1/.test(x.textContent)); if (head) { head.click(); await wait(800); }
      const d = Array.from(b.querySelectorAll('button')).find((x) => /^(直径|Diameter|Durchmesser|Diámetro|Diamètre|지름|直徑)$/.test(x.textContent.trim()));
      if (d) { d.click(); await wait(300); }
      const u = Array.from(b.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'm'));
      if (u) { u.value = 'm'; u.dispatchEvent(new Event('change', { bubbles: true })); await wait(400); }
      const v = Array.from(b.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'L'));
      if (v) { v.value = 'L'; v.dispatchEvent(new Event('change', { bubbles: true })); await wait(400); }
      const ins = Array.from(b.querySelectorAll('.geo-size input')).slice(0, 3);
      ['1.2', '2.4', '0.711'].forEach((x, i) => { if (ins[i]) { ins[i].value = x; ins[i].dispatchEvent(new Event('input', { bubbles: true })); } });
    });
    await sleep(2500);
    await page.evaluate(() => { const b = document.querySelector('.panel.open .geo-3d'); if (b) b.click(); });
    await sleep(4500);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); b.scrollTop = 0; });
    await sleep(300);
  },
  async area(page) {
    await menu(page, 2);
    const m2 = page.locator('.panel.open .plot-mode').nth(0);
    await m2.locator('textarea').fill('√(x)'); await m2.locator('.plot-form .plot-range input').nth(0).fill('-0.5'); await m2.locator('.plot-form .plot-range input').nth(1).fill('2.5');
    await m2.locator('.plot-form .btn.primary').click(); await sleep(2500);
    await m2.locator('.area-toggles .area-toggle:not(.rev-toggle)').click(); await sleep(600);
    const ab = m2.locator('.area-box').nth(1);
    await ab.locator('input[placeholder="a"]').fill('0'); await ab.locator('input[placeholder="b"]').fill('2'); await ab.locator('input[placeholder="b"]').press('Enter');
    await sleep(4000);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); b.scrollTop = 120; });
    await sleep(400);
  },
  async solid(page) {
    await menu(page, 2);
    const m2 = page.locator('.panel.open .plot-mode').nth(0);
    await m2.locator('textarea').fill('x\nx^2'); await m2.locator('.plot-form .plot-range input').nth(0).fill('-0.5'); await m2.locator('.plot-form .plot-range input').nth(1).fill('1.5');
    await m2.locator('.plot-form .btn.primary').click(); await sleep(2500);
    await m2.locator('button.rev3d').click(); await sleep(6000);
    // (1.12.0, BG20: with Pro, ⟳ 3D shows the solid in 3D; this photo is of the 2D graph: "← Back to 2D")
    for (let i = 0; i < 100; i++) {
      const back = await page.evaluate(() => { const b = document.querySelector('.panel.open .rev3d-back'); if (b && !b.hidden && b.getClientRects().length) { b.querySelector('.btn').click(); return true; } return false; });
      if (back) { await sleep(7000); break; } // (the hint about the axes is shown on coming back: wait until it is gone)
      await sleep(200);
    }
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); b.scrollTop = 120; });
    await sleep(400);
  },
  async graph3d(page) {
    await menu(page, 2);
    await page.evaluate(() => Array.from(document.querySelectorAll('.panel.open button')).find((b) => /^3D/.test(b.textContent.trim())).click()); await sleep(1500);
    await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.panel.open .plot-mode'))[1]; const s = c && Array.from(c.querySelectorAll('.area-chip, .sample, button')).find((b) => /球|Sphere|Kugel|Esfera|Sphère|구|球體/.test(b.textContent)); if (s) s.click(); });
    await sleep(6000);
  },
  async history(page) {
    await home(page);
    for (const x of ['1500 × 1.08', '2 + 3 × 4']) { await type(page, x); await eq(page); }
    await page.evaluate(() => document.getElementById('btn-hist').click()); await sleep(800);
  },
  async form(page) {
    await home(page);
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.ptab, .pages button')).find((x) => /解析|Calculus|Analysis|Análisis|Analyse|해석|미적분|微積分|Kalkül|Cálculo|Calcul/.test(x.textContent)); if (b) b.click(); }); await sleep(500);
    await page.evaluate(() => { const k = Array.from(document.querySelectorAll('#grid .key')).find((x) => x.textContent.trim() === '∫'); if (k) k.click(); }); await sleep(1200);
    await page.keyboard.type('x^2'); await sleep(1500);
  },
  async settings(page) { await menu(page, 5); },
  async pro(page) { await menu(page, 4); }
};
(async () => {
  const browser = await chromium.launch();
  for (const lang of LANGS) {
    const dir = path.join(OUT, lang, 'img');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, run] of Object.entries(SHOTS)) {
      if (ONLY && ONLY.indexOf(name) < 0) continue;
      const { ctx, page } = await start(browser, lang, name === 'pro' ? '?pro=play-noprice' : '?pro=all');
      let marks = null;
      try { marks = await run(page); } catch (e) { console.log(lang, name, 'ERROR', e.message.split('\n')[0]); }
      await sleep(300);
      await page.screenshot({ path: path.join(dir, name + '.jpg'), type: 'jpeg', quality: 72 });
      if (marks) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ marks }));
      console.log(lang, name, fs.statSync(path.join(dir, name + '.jpg')).size);
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
