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
// (1.14.0) the scenes recorded in slow motion, and how much slower (qcalc-page.js, setSlow): the 3D drawn with WebGL 2 is
// slow in this browser (SwiftShader); VIDEO_SLOW=0 records them at their own speed
const SLOW = process.env.VIDEO_SLOW === '0' ? {} : { rev: 4, rev3d: 4, profile: 4, tank3d: 8 };

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
// (1.14.0) a tap on "See-through" under the 3D view; when the button is below the screen, the page is first scrolled
// smoothly just enough to show it (the 3D view stays in sight)
async function tapSee(page) {
  const b = page.locator('.panel.open .see-btn').last();
  if (!(await b.isVisible())) return false;
  const r = await b.boundingBox();
  if (!r) return false;
  const over = r.y + r.height + 14 - VH;
  if (over > 0) {
    await page.evaluate(async (d) => {
      const p = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(), from = p.scrollTop, t0 = performance.now();
      await new Promise((res) => { const f = (t) => { const k = Math.min(1, (t - t0) / 450); p.scrollTop = from + d * (1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    }, over);
    await sleep(250);
  }
  return tap(page, b);
}
// (1.14.0) a tap on a chip of the see-through (0: the first thing, as a tank's "Container"; 1: its "Liquid")
async function tapSeeChip(page, n) {
  const c = page.locator('.panel.open .see-chip').nth(n);
  if (!(await c.count()) || !(await c.isVisible())) return false;
  return tap(page, c);
}
// turns the 3D graph a little, as a finger does
async function turn3d(page, ms) {
  const r = await Q.graphRect(page);
  const x0 = r.x + r.width * 0.3, y0 = r.y + r.height * 0.55, steps = Math.round((ms || 1600) / 33);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + r.width * 0.4 * i / steps, y0 - r.height * 0.06 * Math.sin(Math.PI * i / steps)); await sleep(33); }
  await page.mouse.up();
}
// a finger (the circle shown all along) drags the 3D graph by dx, dy CSS pixels in ms, easing out
// (1 px turns the view 0.01: across, around the axis; down, toward looking from above)
async function fingerDrag(page, x0, y0, dx, dy, ms) {
  await page.evaluate(([x, y]) => {
    const d = document.createElement('div'); d.id = 'finger';
    d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);z-index:99999;pointer-events:none;transition:opacity .4s';
    document.body.appendChild(d);
  }, [x0, y0]);
  await sleep(350);
  await page.mouse.move(x0, y0); await page.mouse.down();
  const steps = Math.max(10, Math.round(ms / 40));
  for (let i = 1; i <= steps; i++) {
    const k = 1 - Math.pow(1 - i / steps, 2), x = x0 + dx * k, y = y0 + dy * k;
    await page.mouse.move(x, y);
    await page.evaluate(([x, y]) => { const d = document.getElementById('finger'); if (d) { d.style.left = (x - 22) + 'px'; d.style.top = (y - 22) + 'px'; } }, [x, y]);
    await sleep(25);
  }
  await page.mouse.up();
  await page.evaluate(() => { const d = document.getElementById('finger'); if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 500); } });
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
// (1.12.0, BG20) with Pro, ⟳ 3D shows the solid in 3D at once: back to the 2D graph ("← Back to 2D"), and
// the hint about the axes (shown on coming back, the first time) gone
async function back2d(page) {
  for (let i = 0; i < 150; i++) {
    const done = await page.evaluate(() => { const b = document.querySelector('.panel.open .rev3d-back'); if (b && !b.hidden && b.getClientRects().length) { b.querySelector('.btn').click(); return true; } return false; });
    if (done) { await sleep(6800); return; }
    await sleep(200);
  }
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
      // (1.12.0, BG20: ⟳ 3D goes to the 3D view at once; the solid grows from 0° to 360° with its volume above)
      await tap(page, m2.locator('button.rev3d')); await sleep(1500);
      await smoothScroll(page, '.rev3d-back', 8); await sleep(4200);
      await smoothScroll(page, '.plot-wrap', 8); await sleep(600); await turn3d(page, 1800); await sleep(1500);
    }
  },
  // the region already turned; View in 3D at once (for the first seconds of a video)
  rev3d: {
    prep: async (page) => { const m2 = await graphReady(page, 'x\nx^2'); await m2.locator('.plot-form .btn.primary').click(); await sleep(2200); await m2.locator('button.rev3d').click(); await sleep(1500); await back2d(page); await Q.scrollTo(page, '.plot-wrap', 8); },
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
    prep: async (page) => { const m2 = await graphReady(page, 'x\nx^2'); await m2.locator('.plot-form .btn.primary').click(); await sleep(2200); await m2.locator('button.rev3d').click(); await sleep(1500); await back2d(page); await Q.scrollTo(page, '.plot-wrap', 8); },
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
  // (1.13.0) the stepped shaft (the first example) in 3D: it turns into being (the solid grows from 0° to 360°),
  // then a finger tilts it toward the eye, so that the flat ring of the step, where the shaft gets thinner, is
  // seen from above (the shadow of the thin part lies on its far side); the view held there. (1.14.0) Then
  // "See-through" for a moment (the inside of the shaft seen through it), in the same length of the scene
  profile: {
    prep: async () => {},
    run: async (page) => {
      await sleep(200); await openTool(page, 'profile'); await tap(page, chip(page, 0)); await sleep(1200);
      await smoothScroll(page, '.pf-pic', 4, 900); await sleep(1500);
      const v = page.locator('.panel.open button.btn').filter({ hasText: /3D/ });
      let b = null; for (let i = 0; i < await v.count(); i++) if (await v.nth(i).isVisible()) { b = v.nth(i); break; }
      if (b) {
        await b.scrollIntoViewIfNeeded(); await sleep(300); await tap(page, b);
        await Q.modelDone(page); await sleep(300); await smoothScroll(page, '.plot-wrap', 8); await sleep(400);
        const r = await Q.graphRect(page);
        await fingerDrag(page, r.x + r.width * 0.35, r.y + r.height * 0.5, 44, 46, 1800); // the view 0.44 around, 0.46 down
        await sleep(500); await tapSee(page); await sleep(1500);
      } else await sleep(2000);
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
  // (1.12.0, D6) the lying tank with 2:1 heads at 30 % in the tool: ⟳ 3D (the tank grows, the liquid rises), then
  // a finger drags the level up to about 85 % (the amount and % at the level follow), then turns the graph (QCalc Pro).
  // (1.14.0) Before the turn, "See-through", and its chip "Liquid" too: the liquid see-through as well as the container
  tank3d: {
    prep: async (page, lang) => { await Q.tankSetup(page, SET[lang], 30); await Q.scrollTo(page, '.geo-main', 4); },
    run: async (page) => {
      await sleep(1200);
      await tap(page, page.locator('.panel.open .geo-3d').last());
      await Q.modelDone(page); await sleep(900);
      const m = await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.panel.open .plot-mode')).filter((q) => !q.hidden).pop(); const cv = c.querySelector('.plot-wrap canvas[aria-label]'); const r = cv.getBoundingClientRect(); return { x: r.left, y: r.top, box: JSON.parse(cv.dataset.model).level.box }; });
      const x0 = m.x + m.box[0] + m.box[2] / 2, y0 = m.y + m.box[1] + m.box[3] / 2;
      await page.evaluate(([x, y]) => {
        const d = document.createElement('div'); d.id = 'finger';
        d.style.cssText = 'position:fixed;left:' + (x - 22) + 'px;top:' + (y - 22) + 'px;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);z-index:99999;pointer-events:none;transition:opacity .4s';
        document.body.appendChild(d);
      }, [x0, y0]);
      await sleep(350);
      await page.mouse.move(x0, y0); await page.mouse.down();
      const steps = 40, dy = 40;
      for (let i = 1; i <= steps; i++) {
        const y = y0 - dy * (1 - Math.pow(1 - i / steps, 2));
        await page.mouse.move(x0, y);
        await page.evaluate(([x, y]) => { const d = document.getElementById('finger'); if (d) { d.style.left = (x - 22) + 'px'; d.style.top = (y - 22) + 'px'; } }, [x0, y]);
        await sleep(15);
      }
      await page.mouse.up();
      await page.evaluate(() => { const d = document.getElementById('finger'); if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 500); } });
      await sleep(300); await tapSee(page); await sleep(450); await tapSeeChip(page, 1); await sleep(600); await turn3d(page, 1500); await sleep(900);
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
  const K = SLOW[name] || 1;
  const { ctx, page } = await Q.start(browser, BASE, SET[lang], { viewport: { width: VW, height: VH }, dpr: DPR, dark: name === 'rev' || name === 'rev3d' || name === 'axis' || name === 'notes', slowClock: K > 1 });
  await sc.prep(page, lang);
  await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  if (K > 1) {
    await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K });
    await page.evaluate((k) => window.__qcalcSetK(k), K);
    Q.setSlow(K);
  }
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VW * DPR, maxHeight: VH * DPR, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  try { await sc.run(page, lang); } catch (e) { console.log(lang, name, 'ERROR', e.message.split('\n')[0]); }
  const t1 = Date.now() / 1000;
  Q.setSlow(1);
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
    list.push("file '" + fn + "'", 'duration ' + Math.max(0.001, (next - f.t) / K).toFixed(4));
  });
  if (frames.length) list.push("file '" + String(frames.length - 1).padStart(5, '0') + ".jpg'");
  fs.writeFileSync(path.join(dir, 'list.txt'), 'ffconcat version 1.0\n' + list.join('\n') + '\n');
  const out = path.join(WORK, lang, name + '.mp4'), tmp = path.join(WORK, lang, name + '.part.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', 'fps=30,scale=786:1746:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', tmp]);
  fs.renameSync(tmp, out);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(lang, name, frames.length, 'frames', (t1 - t0).toFixed(1) + ' s' + (K > 1 ? ' (slow motion ×' + K + ': ' + ((t1 - t0) / K).toFixed(1) + ' s)' : ''));
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
