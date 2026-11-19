// Records the scenes of the QCalc videos (stage M3) from the real app: Chromium shows app/assets with
// the real engine through the test server, a person's taps are shown as a circle, and the frames of
// the screen are taken as JPEG (quality 92) with their times (the DevTools screencast). Each scene is
// then made into a portrait clip with ffmpeg: <work>/<lang>/<scene>.mp4 (786 × 1746, 30 fps).
// store/tools/video_render.py puts the clips into the videos.
// Usage: node store/tools/video.js <base url of the test server> <work folder> [langs] [scenes]
// e.g.   node store/tools/video.js http://127.0.0.1:8790/ /tmp/qcalc-video ja rev,type
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Q = require('./qcalc-page.js');
const { sleep } = Q;

const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const WORK = process.argv[3] || '/tmp/qcalc-video';
const LANGS = (process.argv[4] || 'ja,en,de,es,fr,ko,zh-TW').split(',');
const SCENE_LIST = process.argv[5] ? process.argv[5].split(',') : null;
const SET = { ja: 'ja', en: 'en', de: 'de', es: 'es', fr: 'fr', ko: 'ko', 'zh-TW': 'zh-TW' };
const VW = 393, VH = 873, DPR = 2;

// a circle where a person taps, then the tap
async function tap(page, target) {
  const box = typeof target === 'string' ? await page.locator(target).first().boundingBox() : await target.boundingBox();
  if (!box) return false;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.evaluate(([x, y]) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);z-index:99999;pointer-events:none;transition:transform .45s,opacity .45s;transform:scale(.6)';
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.15)'; });
    setTimeout(() => { d.style.opacity = '0'; }, 380);
    setTimeout(() => d.remove(), 900);
  }, [x, y]);
  await sleep(260);
  if (typeof target === 'string') await page.locator(target).first().click(); else await target.click();
  return true;
}
const eqKey = (page) => page.locator('#grid .key').filter({ hasText: /^=$/ }).first();
async function typeAndEq(page, s) { await Q.type(page, s, 70); await sleep(300); await tap(page, eqKey(page)); await sleep(1500); }
// turns the 3D graph a little, as a finger does
async function turn3d(page, ms) {
  const r = await Q.graphRect(page);
  const x0 = r.x + r.width * 0.3, y0 = r.y + r.height * 0.55, steps = Math.round((ms || 1600) / 33);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + r.width * 0.4 * i / steps, y0 - r.height * 0.06 * Math.sin(Math.PI * i / steps)); await sleep(33); }
  await page.mouse.up();
}
async function view3d(page) {
  const v = page.locator('.panel.open button.btn').filter({ hasText: /3D/ }).filter({ hasNotText: /=/ });
  let b = null; for (let i = 0; i < await v.count(); i++) { const x = v.nth(i); if (await x.isVisible() && !(await x.evaluate((e) => e.classList.contains('rev3d')))) { b = x; break; } }
  if (b) { await b.scrollIntoViewIfNeeded(); await sleep(300); await tap(page, b); }
}
const panelBody = 'xpath=(//section[contains(@class,"panel") and contains(@class,"open")])[last()]//div[contains(@class,"panel-body")]';
async function openTool(page, k) {
  await Q.home(page);
  await tap(page, '#btn-menu'); await sleep(500);
  await tap(page, page.locator('#drawer > button').nth(1)); await sleep(1200);
  await tap(page, page.locator('.panel.open .tool-row[data-tool="' + k + '"]').first()); await sleep(1800);
}
const chip = (page, n) => page.locator('.panel.open .panel-body .area-chip').nth(n);
async function smoothScroll(page, sel, off, ms) {
  await page.evaluate(async ([sel, off, ms]) => {
    const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop();
    const e = b && b.querySelector(sel);
    if (!e) return;
    const from = b.scrollTop, to = from + e.getBoundingClientRect().top - b.getBoundingClientRect().top - (off || 0);
    const t0 = performance.now();
    await new Promise((res) => { const f = (t) => { const k = Math.min(1, (t - t0) / ms); b.scrollTop = from + (to - from) * (1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  }, [sel, off, ms || 700]);
  await sleep(300);
}
async function graphReady(page, fns) {
  await Q.menu(page, 2);
  const m2 = page.locator('.panel.open .plot-mode').nth(0);
  await m2.locator('textarea').fill(fns); await m2.locator('.plot-form .plot-range input').nth(0).fill('-0.5'); await m2.locator('.plot-form .plot-range input').nth(1).fill('1.5');
  return m2;
}

// each scene: prepare (not recorded), then run (recorded)
const SCENES = {
  rev: {
    prep: async (page) => { await graphReady(page, 'x\nx^2'); },
    run: async (page) => {
      const m2 = page.locator('.panel.open .plot-mode').nth(0);
      await sleep(500); await tap(page, m2.locator('.plot-form .btn.primary')); await sleep(2200);
      await tap(page, m2.locator('button.rev3d')); await sleep(4200);
      await smoothScroll(page, '.plot-wrap', 8); await sleep(800);
      await view3d(page);
      await sleep(4500); await smoothScroll(page, '.plot-wrap', 8); await sleep(600); await turn3d(page, 1800); await sleep(1500);
    }
  },
  // the region already turned; View in 3D at once (for the first seconds of a video)
  rev3d: {
    prep: async (page) => { const m2 = await graphReady(page, 'x\nx^2'); await m2.locator('.plot-form .btn.primary').click(); await sleep(2200); await m2.locator('button.rev3d').click(); await sleep(4500); await Q.scrollTo(page, '.plot-wrap', 8); },
    run: async (page) => { await sleep(700); await view3d(page); await sleep(4300); await smoothScroll(page, '.plot-wrap', 8); await sleep(300); await turn3d(page, 1600); await sleep(800); }
  },
  type: {
    prep: async () => {},
    run: async (page, lang) => {
      await sleep(400);
      for (const x of [lang === 'en' || lang === 'ja' ? '60 mph to km/h' : '100 km/h to mph', 'solve(x^2 − 5x + 6 = 0)', 'integrate(x^2 sin(x), 0, pi)']) await typeAndEq(page, x);
      await sleep(1200);
    }
  },
  exact: {
    prep: async () => {},
    run: async (page) => { await sleep(400); for (const x of ['sqrt(8)', '1/3 + 1/4', 'solve(x^2 = 2)']) await typeAndEq(page, x); await sleep(1200); }
  },
  price: {
    prep: async () => {},
    run: async (page) => { await sleep(300); await openTool(page, 'price'); await tap(page, chip(page, 0)); await sleep(1600); await smoothScroll(page, '.geo-out', 160, 900); await sleep(2500); }
  },
  loan: {
    prep: async () => {},
    run: async (page) => { await sleep(300); await openTool(page, 'loan'); await tap(page, chip(page, 0)); await sleep(1800); await smoothScroll(page, '.geo-out', 120, 900); await sleep(1500); await smoothScroll(page, 'table', 60, 1500); await sleep(2000); }
  },
  convert: {
    prep: async () => {},
    run: async (page) => {
      await sleep(300); await openTool(page, 'convert');
      const inp = page.locator('.panel.open .conv-row input').first();
      await tap(page, inp); await inp.fill(''); await inp.type('5', { delay: 120 }); await sleep(1800);
      const cats = page.locator('.panel.open .conv-cats button, .panel.open .seg button').filter({ hasText: /./ });
      if (await cats.count() > 2) { await tap(page, cats.nth(3)); await sleep(1500); await tap(page, cats.nth(0)); }
      await sleep(1800);
    }
  },
  axis: {
    prep: async (page) => { const m2 = await graphReady(page, 'x\nx^2'); await m2.locator('.plot-form .btn.primary').click(); await sleep(2200); await m2.locator('button.rev3d').click(); await sleep(4500); await Q.scrollTo(page, '.plot-wrap', 8); },
    run: async (page) => {
      await sleep(600);
      // the y axis of the graph: tap on its line (14 px from it counts)
      const r = await Q.graphRect(page);
      const x = r.x + r.width * (0.5 / 2.0), y = r.y + r.height * 0.3; // x = 0 in the range −0.5 … 1.5
      await page.evaluate(([x, y]) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);z-index:99999;pointer-events:none'; document.body.appendChild(d); setTimeout(() => d.remove(), 650); }, [x, y]);
      await sleep(250); await page.mouse.click(x, y); await sleep(3500);
      // back to the x axis with its button (the lines of the method are on: shells, then disks)
      const xBtn = page.locator('.panel.open .seg:has(button:text-is("y = k")) button').first();
      if (await xBtn.count()) { await xBtn.scrollIntoViewIfNeeded(); await sleep(300); await tap(page, xBtn); await sleep(1200); await smoothScroll(page, '.plot-wrap', 8); }
      await sleep(3000);
    }
  },
  profile: {
    prep: async () => {},
    run: async (page) => {
      await sleep(300); await openTool(page, 'profile'); await tap(page, chip(page, 0)); await sleep(1800);
      await smoothScroll(page, '.pf-pic', 4, 900); await sleep(2200);
      const v = page.locator('.panel.open button.btn').filter({ hasText: /3D/ });
      let b = null; for (let i = 0; i < await v.count(); i++) if (await v.nth(i).isVisible()) { b = v.nth(i); break; }
      if (b) { await b.scrollIntoViewIfNeeded(); await sleep(300); await tap(page, b); await sleep(5000); await smoothScroll(page, '.plot-wrap', 8); await turn3d(page, 1500); }
      await sleep(1500);
    }
  },
  tank: {
    prep: async () => {},
    run: async (page) => {
      await sleep(300); await openTool(page, 'tanks');
      await page.evaluate(async () => {
        const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(), wait = (ms) => new Promise((x) => setTimeout(x, ms));
        const d = Array.from(b.querySelectorAll('button')).find((x) => /^(直径|Diameter|Durchmesser|Diámetro|Diamètre|지름|直徑)$/.test(x.textContent.trim()));
        if (d) { d.click(); await wait(300); }
        const u = Array.from(b.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => o.value === 'm'));
        if (u) { u.value = 'm'; u.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      const ins = page.locator('.panel.open .panel-body .geo-size input');
      for (const [i, v] of [[0, '1'], [1, '2'], [2, '0.3']]) { const e = ins.nth(i); await tap(page, e); await e.fill(''); await e.type(v, { delay: 120 }); await sleep(500); }
      await sleep(1500); await smoothScroll(page, '.geo-out', 200, 900); await sleep(2500);
    }
  },
  notes: {
    prep: async () => {},
    run: async (page, lang) => { await sleep(300); await openTool(page, 'memo'); await tap(page, chip(page, 0)); await sleep(300); await Q.localNotes(page, lang); await sleep(1000); await smoothScroll(page, '.panel-body > *:nth-child(3)', 40, 900); await sleep(2000); }
  },
  manual: {
    prep: async () => {},
    run: async (page) => { await sleep(300); await openTool(page, 'price'); await sleep(600); await tap(page, page.locator('.panel.open .help-btn').last()); await sleep(2500); await sleep(2800); }
  }
};

async function record(browser, lang, name) {
  const sc = SCENES[name];
  const { ctx, page } = await Q.start(browser, BASE, SET[lang], { viewport: { width: VW, height: VH }, dpr: DPR, dark: name === 'rev' || name === 'rev3d' || name === 'axis' || name === 'notes' });
  await sc.prep(page, lang);
  await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * DPR, maxHeight: VH * DPR, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  try { await sc.run(page, lang); } catch (e) { console.log(lang, name, 'ERROR', e.message.split('\n')[0]); }
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await ctx.close();
  // the frames and their times → a clip at 30 frames a second
  const dir = path.join(WORK, lang, name + '.frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  frames.forEach((f, i) => {
    const fn = String(i).padStart(5, '0') + '.jpg';
    fs.writeFileSync(path.join(dir, fn), Buffer.from(f.data, 'base64'));
    const next = i + 1 < frames.length ? frames[i + 1].t : Math.max(f.t + 0.5, t1);
    list.push("file '" + fn + "'", 'duration ' + Math.max(0.001, next - f.t).toFixed(4));
  });
  if (frames.length) list.push("file '" + String(frames.length - 1).padStart(5, '0') + ".jpg'");
  fs.writeFileSync(path.join(dir, 'list.txt'), 'ffconcat version 1.0\n' + list.join('\n') + '\n');
  const out = path.join(WORK, lang, name + '.mp4'), tmp = path.join(WORK, lang, name + '.part.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=786:1746:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', tmp]);
  fs.renameSync(tmp, out);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(lang, name, frames.length, 'frames', (t1 - t0).toFixed(1) + ' s');
}

(async () => {
  const browser = await chromium.launch();
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(WORK, lang), { recursive: true });
    for (const name of Object.keys(SCENES)) {
      if (SCENE_LIST && SCENE_LIST.indexOf(name) < 0) continue;
      await record(browser, lang, name);
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
