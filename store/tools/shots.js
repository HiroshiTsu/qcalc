// Makes the pictures of the Google Play listing from the real app (QCalc 1.12.0, stage M2; 1.14.0: the same set and
// order from the screens of 1.14.0, the 3D drawn with WebGL 2, the tank in 3D with "See-through" on; into the folders of
// 1.14, those of 1.12 kept):
//   store/screenshots-1.14/<set>/phone-1-…png … phone-8-…png   1080 × 1920 (8 phone pictures)
//   store/screenshots-1.14/<set>/landscape-1-2d-to-3d.png      1920 × 1080
//   store/screenshots-1.14/<set>/tablet7-1-…png … (5)          1200 × 1920
//   store/screenshots-1.14/<set>/tablet10-1-…png … (5)         1600 × 2560
//   store/screenshots-1.14/<set>/alt/phone-5-profile.png       1080 × 1920 (the earlier fifth phone picture, kind alt)
//   store/feature-graphic-1.14-<set>.png                       1024 × 500 (for ja, en, de, es, fr, ko, zh-TW)
// Each picture is a screen of the app (Chromium showing app/assets with the real engine through the test
// server) under a short headline (store/tools/captions.json). The pictures are put together in Chromium
// too (an HTML page made here), so nothing but Node.js, Playwright and the test server is needed.
// Usage: node store/tools/shots.js <base url of the test server> [sets: ja,en,…] [kinds: phone,land,tab,fg,alt] [phone pictures: calc,exact,…]
// e.g.   node store/tools/shots.js http://127.0.0.1:8790/ ja phone
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const Q = require('./qcalc-page.js');
const { sleep } = Q;

const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const SETS = (process.argv[3] || Object.keys(Q.SETS).join(',')).split(',');
const KINDS = (process.argv[4] || 'phone,land,tab,fg').split(',');
const ONLY = process.argv[5] ? process.argv[5].split(',') : null; // only these phone or tablet pictures (e.g. calc,exact,tank-3d)
const STORE = path.join(__dirname, '..');
const CAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'captions.json'), 'utf8'));
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(STORE, '..', 'icon', 'qcalc-icon.svg')).toString('base64');
// the feature graphic is made once per language (es-419, en-GB and fr-CA use es, en and fr)
const FG_SETS = { ja: 1, en: 1, de: 1, es: 1, fr: 1, ko: 1, 'zh-TW': 1 };

const font = (set) => {
  const l = Q.SETS[set].lang;
  const cjk = l === 'ja' ? 'Noto Sans CJK JP' : l === 'ko' ? 'Noto Sans CJK KR' : l === 'zh-TW' ? 'Noto Sans CJK TC' : 'Noto Sans CJK JP';
  return `"Inter", "${cjk}", sans-serif`;
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const png = (buf) => 'data:image/png;base64,' + buf.toString('base64');

// ---- screens of the app (raw pictures, PNG buffers)
async function screen(browser, set, o, run, clip) {
  const { ctx, page } = await Q.start(browser, BASE, set, o);
  try { await run(page); } catch (e) { console.log(set, 'ERROR', e.message.split('\n')[0]); }
  await sleep(400);
  const opt = { type: 'png' };
  if (clip) opt.clip = await Q.graphRect(page);
  const buf = await page.screenshot(opt);
  await ctx.close();
  return buf;
}
const PH = { viewport: { width: 384, height: 640 } };
const SCENES = {
  calc: { dark: false, run: async (page, set) => { for (const x of Q.mainExamples(set)) { await Q.type(page, x); await Q.eq(page); } await Q.type(page, '1/3 + 1/4'); } },
  everyday: { dark: true, run: async (page) => { await Q.tool(page, 'price', 0); await Q.scrollTo(page, '.geo-out', 150); } },
  convert: {
    dark: false, run: async (page) => {
      await Q.tool(page, 'convert');
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop(); const i = b.querySelector('.conv-row input'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await sleep(1800);
    }
  },
  solid2d: { dark: true, run: Q.solid2d },
  solid3d: { dark: true, run: async (page) => { await Q.solid2d(page); await Q.solid3d(page); } },
  profile: { dark: false, run: Q.profile },
  // (1.14.0) the tank with "See-through" on: its container clear, the liquid seen through it
  'tank-3d': { dark: false, run: async (page, set) => { await Q.tank3d(page, set, 62); await seeThrough(page); } },
  notes: { dark: true, run: async (page, set) => { await Q.tool(page, 'memo', 0); await sleep(1500); await Q.localNotes(page, set); } },
  exact: {
    // exact answers, then π with 100 digits (the precision setting goes up to 200,000)
    dark: false, run: async (page) => {
      for (const x of ['1/3 + 1/4', 'sqrt(8)', 'integrate(x^2 sin(x), 0, pi)']) { await Q.type(page, x); await Q.eq(page); }
      await Q.setPrecisionAndReload(page, 100);
      await Q.type(page, 'pi'); await Q.eq(page); await sleep(1000);
    }
  },
  offline: { dark: true, run: Q.manualAbout },
  tools: { dark: true, run: async (page) => { await Q.menu(page, 1); } }
};

// (1.14.0) "See-through" on under the 3D view, and the drawing done (WebGL 2 is slow in this browser)
async function seeThrough(page) {
  const b = page.locator('.panel.open .see-btn').last();
  if (!(await b.count()) || !(await b.isVisible())) { console.log('no See-through button'); return; }
  await b.click();
  await sleep(2500);
  // (the switches of 1.14.0 are wider: on a phone "Box and axes" goes to the next line, so the panel is scrolled up as
  // far as the chips of what is see-through, Container and Liquid, need to be seen whole)
  await page.evaluate(() => {
    const body = Array.from(document.querySelectorAll('.panel.open .panel-body')).pop();
    const ch = body && body.querySelector('.see-chips:not([hidden])');
    if (!ch) return;
    const over = ch.getBoundingClientRect().bottom + 10 - body.getBoundingClientRect().bottom;
    if (over > 0) body.scrollTop += over;
  });
  await sleep(600);
}

// ---- putting a picture together (HTML in Chromium)
function frameHtml(set, k) {
  const F = font(set), dark = k.dark;
  const bg = dark ? 'radial-gradient(120% 90% at 20% 0%, #2B47C9 0%, #18237A 45%, #0B1046 100%)' : 'linear-gradient(180deg, #EEF2FF 0%, #D9E1FF 100%)';
  const fg = dark ? '#FFFFFF' : '#0B1046';
  const lines = k.lines.map((l) => `<div class="l">${esc(l)}</div>`).join('');
  const tag = k.tag ? `<div class="tag">${esc(k.tag)}</div>` : '';
  const imgs = k.imgs.map((m, i) => `<div class="shot" style="left:${m.x}px;top:${m.y}px;width:${m.w}px;height:${m.h}px;border-radius:${m.r || 36}px"><img src="${m.src}"></div>`).join('');
  const arrow = k.arrow ? `<div class="arrow" style="left:${k.arrow.x}px;top:${k.arrow.y}px">⟳ 3D</div>` : '';
  const brand = k.brand ? `<div class="brand"><img src="${ICON}"><span>QCalc</span></div>` : '';
  return `<!doctype html><html lang="${Q.SETS[set].lang}"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    body{width:${k.W}px;height:${k.H}px;overflow:hidden;background:${bg};font-family:${F};color:${fg};position:relative}
    .head{position:absolute;left:${k.hx}px;top:${k.hy}px;width:${k.hw}px;text-align:${k.align || 'center'}}
    .l{font-size:${k.fs}px;font-weight:800;line-height:1.2;letter-spacing:-0.01em;white-space:nowrap}
    .tag{display:inline-block;margin-top:${Math.round(k.fs * 0.28)}px;font-size:${Math.round(k.fs * 0.46)}px;font-weight:800;padding:.18em .7em .24em;border-radius:999px;background:#FFC233;color:#1A1300}
    .shot{position:absolute;overflow:hidden;box-shadow:0 18px 50px rgba(3,8,40,${dark ? '.55' : '.25'});outline:2px solid rgba(${dark ? '255,255,255,.18' : '11,16,70,.10'})}
    .shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
    .arrow{position:absolute;transform:translate(-50%,-50%);font-size:${Math.round(k.fs * 0.62)}px;font-weight:800;padding:.2em .8em;border-radius:999px;background:#3A60EE;color:#fff;box-shadow:0 8px 24px rgba(3,8,40,.4)}
    .brand{display:flex;align-items:center;gap:${Math.round(k.fs * 0.35)}px;margin-bottom:${Math.round(k.fs * 0.5)}px;justify-content:${k.align === 'left' ? 'flex-start' : 'center'}}
    .brand img{width:${Math.round(k.fs * 1.5)}px;height:${Math.round(k.fs * 1.5)}px;border-radius:22%}
    .brand span{font-size:${Math.round(k.fs * 1.1)}px;font-weight:800;letter-spacing:-.02em}
  </style></head><body>${imgs}${arrow}<div class="head">${brand}${lines}${tag}</div>
  <script>
    // shrink the headline until every line fits
    for (const l of document.querySelectorAll('.l')) { let f = ${k.fs}; while (l.scrollWidth > ${k.hw} && f > 20) { f -= 2; l.style.fontSize = f + 'px'; } }
  </script></body></html>`;
}
async function compose(browser, set, k, out) {
  const ctx = await browser.newContext({ viewport: { width: k.W, height: k.H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(frameHtml(set, k));
  await page.evaluate(() => document.fonts.ready);
  await sleep(300);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  await ctx.close();
  console.log(path.relative(STORE, out));
}
const cap = (set, key) => (CAP[set] || CAP[Q.SETS[set].lang])[key];

(async () => {
  const browser = await chromium.launch();
  for (const set of SETS) {
    const dir = path.join(STORE, 'screenshots-1.14', set);
    // ---- 8 phone pictures, 1080 × 1920
    if (KINDS.indexOf('phone') >= 0) {
      const order = [['calc', 'p1', null], ['everyday', 'p2', null], ['convert', 'p3', null], ['2d-to-3d', 'p4', 'tag_3d'], ['tank-3d', 'p5', 'tag_pro'], ['notes', 'p6', null], ['exact', 'p7', 'tag_digits'], ['offline', 'p8', null]];
      for (let i = 0; i < order.length; i++) {
        const [name, key, tagKey] = order[i];
        if (ONLY && ONLY.indexOf(name) < 0) continue;
        const k = { W: 1080, H: 1920, hx: 60, hy: 70, hw: 960, fs: 70, lines: cap(set, key), tag: tagKey ? cap(set, tagKey) : null };
        if (name === '2d-to-3d') {
          // the 2D graph with the region turned, and the solid in 3D: two pictures of the graph
          const a = await screen(browser, set, Object.assign({ dpr: 2.2, dark: true }, PH), SCENES.solid2d.run, true);
          const b = await screen(browser, set, Object.assign({ dpr: 2.2, dark: true }, PH), SCENES.solid3d.run, true);
          Object.assign(k, { dark: true, imgs: [{ src: png(a), x: 180, y: 380, w: 720, h: 705 }, { src: png(b), x: 180, y: 1150, w: 720, h: 705 }], arrow: { x: 540, y: 1117 } });
        } else {
          const sc = SCENES[name];
          // the app at the size of a phone (393 × 873 CSS px, 20:9), 720 × 1600 on the picture
          const buf = await screen(browser, set, { viewport: { width: 393, height: 873 }, dpr: 1600 / 873, dark: sc.dark, settings: sc.settings }, (p) => sc.run(p, set));
          Object.assign(k, { dark: sc.dark, hy: 48, fs: 66, imgs: [{ src: png(buf), x: 180, y: 290, w: 720, h: 1600, r: 48 }] });
        }
        await compose(browser, set, k, path.join(dir, `phone-${i + 1}-${name}.png`));
      }
    }
    // ---- the earlier fifth phone picture (a solid from a profile), kept as an alternative to the tank in 3D
    if (KINDS.indexOf('alt') >= 0) {
      const sc = SCENES.profile;
      const buf = await screen(browser, set, { viewport: { width: 393, height: 873 }, dpr: 1600 / 873, dark: sc.dark }, (p) => sc.run(p, set));
      const k = { W: 1080, H: 1920, hx: 60, hy: 48, hw: 960, fs: 66, dark: sc.dark, lines: cap(set, 'p5_profile'), tag: cap(set, 'tag_pro'), imgs: [{ src: png(buf), x: 180, y: 290, w: 720, h: 1600, r: 48 }] };
      await compose(browser, set, k, path.join(dir, 'alt', 'phone-5-profile.png'));
    }
    // ---- 16:9, 1920 × 1080: the headline at the left, the 2D graph and the solid in 3D at the right
    if (KINDS.indexOf('land') >= 0) {
      const o = Object.assign({ dpr: 833 / 640, dark: true }, PH);
      const a = await screen(browser, set, o, SCENES.solid2d.run);
      const b = await screen(browser, set, o, SCENES.solid3d.run);
      const k = { W: 1920, H: 1080, hx: 90, hy: 300, hw: 720, fs: 64, align: 'left', brand: true, dark: true, lines: cap(set, 'land'), tag: cap(set, 'tag_3d'),
        imgs: [{ src: png(a), x: 860, y: 123, w: 500, h: 833, r: 32 }, { src: png(b), x: 1380, y: 123, w: 500, h: 833, r: 32 }] };
      await compose(browser, set, k, path.join(dir, 'landscape-1-2d-to-3d.png'));
    }
    // ---- tablets: 7 inch 1200 × 1920 (the app at 600 × 800) and 10 inch 1600 × 2560 (the app at 800 × 1080)
    if (KINDS.indexOf('tab') >= 0) {
      const T = [['calc', 'p1', null, 'calc'], ['tools', 't2', null, 'tools'], ['solid2d', 'p4', null, '2d-graph'], ['solid3d', 't4', 'tag_pro', '3d'], ['tank-3d', 't5', 'tag_pro', 'tank-3d']];
      for (const [W, H, vw, vh, dpr, x, y, fs, nm] of [[1200, 1920, 600, 800, 1.8, 60, 420, 80, 'tablet7'], [1600, 2560, 800, 1080, 1.8, 80, 540, 104, 'tablet10']]) {
        for (let i = 0; i < T.length; i++) {
          const [scene, key, tagKey, file] = T[i];
          if (ONLY && ONLY.indexOf(file) < 0) continue;
          const sc = SCENES[scene];
          const buf = await screen(browser, set, { viewport: { width: vw, height: vh }, dpr, dark: sc.dark }, (p) => sc.run(p, set));
          const k = { W, H, hx: x, hy: Math.round(y * 0.2), hw: W - 2 * x, fs, dark: sc.dark, lines: cap(set, key), tag: tagKey ? cap(set, tagKey) : null,
            imgs: [{ src: png(buf), x, y, w: Math.round(vw * dpr), h: Math.round(vh * dpr), r: 36 }] };
          await compose(browser, set, k, path.join(dir, `${nm}-${i + 1}-${file}.png`));
        }
      }
    }
    // ---- the feature graphic, 1024 × 500: the icon, the name, two short lines, and the solid in 3D
    if (KINDS.indexOf('fg') >= 0 && FG_SETS[set]) {
      const b = await screen(browser, set, Object.assign({ dpr: 1.6, dark: true }, PH), SCENES.solid3d.run, true);
      const k = { W: 1024, H: 500, hx: 56, hy: 92, hw: 470, fs: 40, align: 'left', brand: true, dark: true, lines: cap(set, 'fg'),
        imgs: [{ src: png(b), x: 560, y: 40, w: 420, h: 420, r: 28 }] };
      await compose(browser, set, k, path.join(STORE, `feature-graphic-1.14-${set}.png`));
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
