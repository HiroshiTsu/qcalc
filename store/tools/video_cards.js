// Draws the still parts of the QCalc videos (stage M3) in Chromium, from store/tools/video-plan.json:
//   <work>/<lang>/bg/<video>-<n>.png   the background of each segment: the headline, the label of a QCalc
//                                      Pro feature and the frame of the phone (16:9: 1920 × 1080, shorts:
//                                      1080 × 1920); for the closing card, the icon, the name and a line
//   store/video/<lang>/thumbnail.png   the YouTube thumbnail, 1280 × 720 (the solid in 3D from the app)
// The recorded screens of the app go into the frame (store/tools/video_render.py).
// Usage: node store/tools/video_cards.js <base url of the test server> <work folder> [langs]
//        (THUMB_ONLY=1: only the thumbnails, the backgrounds as they are)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const Q = require('./qcalc-page.js');
const { sleep } = Q;

const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const WORK = process.argv[3] || '/tmp/qcalc-video';
const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'video-plan.json'), 'utf8'));
const LANGS = (process.argv[4] || Object.keys(PLAN.langs).join(',')).split(',');
const STORE = path.join(__dirname, '..');
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(STORE, '..', 'icon', 'qcalc-icon.svg')).toString('base64');
// where the phone goes (the same numbers are in video_render.py)
const WIDE = { W: 1920, H: 1080, phone: { x: 300, y: 60, w: 432, h: 960 } };
const TALL = { W: 1080, H: 1920, phone: { x: 225, y: 470, w: 630, h: 1400 } };
const font = (l) => `"Inter", "${l === 'ko' ? 'Noto Sans CJK KR' : l === 'zh-TW' ? 'Noto Sans CJK TC' : 'Noto Sans CJK JP'}", sans-serif`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function html(lang, F, seg, endLines, extra) {
  const bg = 'radial-gradient(120% 90% at 20% 0%, #2B47C9 0%, #18237A 45%, #0B1046 100%)';
  const P = F.phone, wide = F.W > F.H;
  const end = seg.scene === 'end';
  const lines = (end ? [] : seg.title).map((l) => `<div class="l">${esc(l)}</div>`).join('');
  const tag = seg.tag && !end ? `<div class="tag">${esc(seg.tag)}</div>` : '';
  const head = wide ? `left:880px;top:240px;width:920px;text-align:left` : `left:60px;top:50px;width:960px;text-align:center`;
  const fs0 = wide ? 76 : 70;
  const phone = end ? '' : `<div class="bezel" style="left:${P.x - 12}px;top:${P.y - 12}px;width:${P.w + 24}px;height:${P.h + 24}px"></div>`;
  const brand = wide && !end ? `<div class="brand" style="left:880px;top:84px"><img src="${ICON}"><span>QCalc</span></div>` : '';
  const card = end ? `<div class="end"><img src="${ICON}"><div class="n">${esc(endLines[0])}</div><div class="t">${esc(endLines[1])}</div></div>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    body{width:${F.W}px;height:${F.H}px;overflow:hidden;background:${bg};font-family:${font(lang)};color:#fff;position:relative}
    .head{position:absolute;${head}}
    .l{font-size:${fs0}px;font-weight:800;line-height:1.18;letter-spacing:-.01em;white-space:nowrap}
    .tag{display:inline-block;margin-top:22px;font-size:${Math.round(fs0 * 0.44)}px;font-weight:800;padding:.18em .7em .24em;border-radius:999px;background:#FFC233;color:#1A1300}
    .bezel{position:absolute;border-radius:44px;background:#05081F;box-shadow:0 24px 60px rgba(0,0,0,.5),0 0 0 2px rgba(255,255,255,.16)}
    .brand{position:absolute;display:flex;align-items:center;gap:18px}
    .brand img{width:64px;height:64px;border-radius:15px}
    .brand span{font-size:46px;font-weight:800;letter-spacing:-.02em}
    .end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px}
    .end img{width:${wide ? 220 : 260}px;height:${wide ? 220 : 260}px;border-radius:22%;box-shadow:0 20px 50px rgba(0,0,0,.45)}
    .end .n{font-size:${wide ? 120 : 130}px;font-weight:800;letter-spacing:-.03em;margin-top:30px}
    .end .t{font-size:${wide ? 54 : 58}px;font-weight:700;margin-top:18px;opacity:.95}
    ${extra || ''}
  </style></head><body>${phone}${brand}<div class="head">${lines}${tag}</div>${card}
  <script>for (const l of document.querySelectorAll('.l')) { let f = ${fs0}; const w = ${wide ? 920 : 960}; while (l.scrollWidth > w && f > 24) { f -= 2; l.style.fontSize = f + 'px'; } }</script>
  </body></html>`;
}
async function shot(browser, W, H, content, out) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(content);
  await page.evaluate(() => document.fonts.ready);
  await sleep(200);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, type: 'png' });
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  for (const lang of LANGS) {
    const L = PLAN.langs[lang];
    const vids = [['promo', WIDE, L.promo]].concat(L.youtube ? [['youtube', WIDE, L.youtube]] : [], L.shorts.map((s) => [s.name, TALL, s.segments])); // (1.16: no long video)
    for (const [name, F, segs] of process.env.THUMB_ONLY ? [] : vids) {
      for (let i = 0; i < segs.length; i++) await shot(browser, F.W, F.H, html(lang, F, segs[i], L.end), path.join(WORK, lang, 'bg', `${name}-${i + 1}.png`));
      console.log(lang, name, segs.length);
    }
    // the YouTube thumbnail: two short lines and the solid in 3D from the app
    const { ctx, page } = await Q.start(browser, BASE, lang, { viewport: { width: 384, height: 640 }, dpr: 2, dark: true });
    await Q.solid2d(page); await Q.solid3d(page);
    const solid = await page.screenshot({ type: 'png', clip: await Q.graphRect(page) });
    await ctx.close();
    const M = L.youtube_meta;
    const t = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><style>
      html,body{margin:0}body{width:1280px;height:720px;overflow:hidden;font-family:${font(lang)};color:#fff;background:radial-gradient(120% 120% at 15% 10%, #3A60EE 0%, #1F31A8 45%, #0B1046 100%);position:relative}
      .b{position:absolute;left:64px;top:64px;display:flex;align-items:center;gap:22px}.b img{width:96px;height:96px;border-radius:22px}.b span{font-size:72px;font-weight:800;letter-spacing:-.03em}
      .t{position:absolute;left:64px;top:230px;width:600px}.t div{font-size:74px;font-weight:900;line-height:1.12;white-space:nowrap;text-wrap-style:balance;word-break:keep-all}
      .t div:nth-child(2){color:#FFC233}
      .s{position:absolute;right:56px;top:96px;width:520px;height:528px;border-radius:30px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5);outline:3px solid rgba(255,255,255,.2)}
      .s img{width:100%;height:100%;object-fit:cover}
    </style></head><body><div class="b"><img src="${ICON}"><span>QCalc</span></div>
    <div class="t">${M.thumb.map((x) => `<div>${esc(x)}</div>`).join('')}</div>
    <div class="s"><img src="data:image/png;base64,${solid.toString('base64')}"></div>
    <script>{ // each line on one line if it fits at 58 px or more (40 px from the solid); if not, big words over two lines rather than small
      // ones on one (not in ja and zh-TW, which have no spaces to break at)
      const t = document.querySelector('.t'), ls = [...t.children], cjk = ${lang === 'ja' || lang === 'zh-TW'};
      let f = 74; const fit = () => { for (const l of ls) l.style.fontSize = f + 'px'; }; const wide = () => ls.some((l) => l.scrollWidth > 600);
      while (wide() && f > (cjk ? 30 : 58)) { f -= 2; fit(); }
      if (wide()) {
        for (const l of ls) l.style.whiteSpace = 'normal';
        f = 74; fit();
        const lines = (l) => Math.round(l.getBoundingClientRect().height / (f * 1.12));
        while ((t.scrollHeight > 440 || wide() || ls.some((l) => lines(l) > 2)) && f > 30) { f -= 2; fit(); }
      } }</script></body></html>`;
    await shot(browser, 1280, 720, t, path.join(STORE, PLAN.out || 'video', lang, 'thumbnail.png')); // (1.16: store/video-1.16/<lang>/)
    console.log(lang, 'thumbnail');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
