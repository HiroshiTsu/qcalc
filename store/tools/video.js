// Records the scenes of the QCalc videos (stage M3) from the real app: Chromium shows app/assets with
// the real engine through the test server, a person's taps are shown as a circle, and the frames of
// the screen are taken as JPEG (quality 92) with their times (the DevTools screencast). Each scene is
// then made into a portrait clip with ffmpeg: <work>/<lang>/<scene>.mp4 (786 × 1746, 30 fps).
// store/tools/video_render.py puts the clips into the videos.
// Usage: node store/tools/video.js <base url of the test server> <work folder> [langs] [scenes]
// e.g.   node store/tools/video.js http://127.0.0.1:8790/ /tmp/qcalc-video ja rev,type
// (1.16: the frames go to ffmpeg through a pipe, at 30 a second, the last frame for each moment; no folder of frames is
// written or deleted. A new work folder for each recording: a clip there is not written over. The scenes of 1.16: histtype,
// histsel, hist, margin, possize, avgcost, notestable, notespaste, pastesum; the test server with the money of the region
// for the stocks and the notes, as for the pictures.)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Q = require('./qcalc-page.js');
const { sleep } = Q;

const BASE = process.argv[2] || 'http://127.0.0.1:8790/';
const WORK = process.argv[3] || '/tmp/qcalc-video';
const LANGS = (process.argv[4] || 'ja,en,de,es,fr,ko,zh-TW').split(',');
const SCENE_LIST = process.argv[5] ? process.argv[5].split(',') : null;
const SET = { ja: 'ja', en: 'en', de: 'de', es: 'es', fr: 'fr', ko: 'ko', 'zh-TW': 'zh-TW' };
const VW = 393, VH = 873, DPR = 2;

// a circle where a person taps, then the tap (ring: the circle alone, for a control whose choice is then made by the script,
// such as a list that opens outside the page)
async function tap(page, target) {
  if (!(await ring(page, target))) return false;
  if (typeof target === 'string') await page.locator(target).first().click(); else await target.click();
  return true;
}
async function ring(page, target) {
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

// ---- 1.16: the history as a spreadsheet, the stock tools, the notes as a table, pasting from a spreadsheet
const keyOf = (page, t) => page.locator('#grid .key').filter({ hasText: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first();
async function lineOf(page, n) {
  await page.evaluate((n) => { for (const it of document.querySelectorAll('#history .h-item')) it.removeAttribute('data-v'); const it = Array.from(document.querySelectorAll('#history .h-item')).find((x) => x._h && x._h.n === n); if (it) { it.setAttribute('data-v', '1'); it.scrollIntoView({ block: 'nearest' }); } }, n);
  return '#history .h-item[data-v="1"]';
}
async function twoLines(page) { for (const x of ['1280 × 3', '980 × 2']) await typeAndEq(page, x); }
// #1 + #2 by tapping the numbers of the lines and the + key
async function sumByNumbers(page) {
  await tap(page, (await lineOf(page, 1)) + ' .h-no'); await sleep(450);
  await tap(page, keyOf(page, '+')); await sleep(350);
  await tap(page, (await lineOf(page, 2)) + ' .h-no'); await sleep(500);
  await tap(page, eqKey(page)); await sleep(1500);
}
// the history button → Select lines → lines 1 and 2: the bar of their sum and average
async function selectTwo(page) {
  await tap(page, '#btn-hist'); await sleep(700);
  await tap(page, page.locator('#sheet.open button').nth(1)); await sleep(900);
  await tap(page, await lineOf(page, 1)); await sleep(450);
  await tap(page, await lineOf(page, 2)); await sleep(1300);
}
async function copyAsTable(page) {
  await tap(page, page.locator('.hselbar .hs-btns .btn').nth(1)); await sleep(900);
  await tap(page, page.locator('#sheet.open button').first()); await sleep(1400);
}
async function stockScene(page, id) {
  await sleep(300); await openTool(page, id); await tap(page, chip(page, 0)); await sleep(1700);
  await smoothScroll(page, '.geo-out', 150, 900); await sleep(2200);
}
async function notesTableMode(page) {
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.panel.open .note-mode button')).find((x) => x.dataset.mode === 'table'); if (b) b.click(); });
  await sleep(2200);
}
async function tableScroll(page, to, ms) {
  await page.evaluate(async ([to, ms]) => {
    const w = document.querySelector('.panel.open .note-tbl-wrap'); if (!w) return;
    const from = w.scrollLeft, end = to === 'end' ? w.scrollWidth - w.clientWidth : 0, t0 = performance.now();
    await new Promise((res) => { const f = (t) => { const k = Math.min(1, (t - t0) / ms); w.scrollLeft = from + (end - from) * (1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  }, [to, ms || 800]);
  await sleep(300);
}
// a paste where a person has tapped (the text of the clipboard given to the element, as the system does)
async function pasteInto(page, target, text) {
  await tap(page, target); await sleep(500);
  await page.evaluate(([sel, text]) => {
    const e = typeof sel === 'string' ? document.querySelector(sel) : null; const b = e || document.activeElement; b.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    b.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [typeof target === 'string' ? target : null, text]);
  await sleep(900);
}
// a table of a spreadsheet in the language of the set (the groups of digits of the region)
const PASTE_TABLE = {
  ja: '品目\t金額\nりんご\t1,200\nパン\t850\n牛乳\t300', en: 'Item\tAmount\napples\t1,200\nbread\t850\nmilk\t300',
  de: 'Artikel\tBetrag\nÄpfel\t1.200\nBrot\t850\nMilch\t300', es: 'Artículo\tImporte\nmanzanas\t1.200\npan\t850\nleche\t300',
  fr: 'Article\tMontant\npommes\t1 200\npain\t850\nlait\t300', ko: '품목\t금액\n사과\t1,200\n빵\t850\n우유\t300',
  'zh-TW': '品項\t金額\n蘋果\t1,200\n麵包\t850\n牛奶\t300'
};

// (1.16.3) fingers on the screen as circles that follow them (null: lifted)
async function fingers(page, pts) {
  await page.evaluate((pts) => {
    let d = document.getElementById('v-fingers');
    if (!pts) { if (d) { d.id = ''; for (const c of d.children) c.style.opacity = '0'; setTimeout(() => d.remove(), 450); } return; }
    if (!d) { d = document.createElement('div'); d.id = 'v-fingers'; d.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none'; document.body.appendChild(d); }
    while (d.children.length < pts.length) { const c = document.createElement('div'); c.style.cssText = 'position:absolute;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);transition:opacity .4s'; d.appendChild(c); }
    pts.forEach((p, i) => { const c = d.children[i]; c.style.left = (p.x - 22) + 'px'; c.style.top = (p.y - 22) + 'px'; });
  }, pts);
}
// two fingers spread (d0 → d1 px apart) about a point, as real touches (the DevTools protocol), shown as two circles
async function pinch(page, cx, cy, d0, d1, ms) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  const steps = Math.max(8, Math.round((ms || 700) / 45));
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await fingers(page, pts(d0)); await sleep(250);
  await touch('touchStart', [pts(d0)[0]]); await sleep(40);
  await touch('touchStart', pts(d0)); await sleep(40);
  for (let i = 1; i <= steps; i++) { const p = pts(d0 + (d1 - d0) * (1 - Math.pow(1 - i / steps, 2))); await touch('touchMove', p); await fingers(page, p); await sleep(30); }
  await sleep(450);
  await touch('touchEnd', [pts(d1)[1]]); await sleep(40);
  await touch('touchEnd', []);
  await fingers(page, null);
  await cdp.detach();
}
// one finger moving a line sideways (its own scrolling, as the finger does it), shown as a circle
async function swipeX(page, target, ms) {
  const h = await target.elementHandle();
  if (!h) return;
  await page.evaluate(async ([e, ms]) => {
    const r = e.getBoundingClientRect(), max = e.scrollWidth - e.clientWidth, y = r.top + Math.min(r.height / 2, 24);
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;width:44px;height:44px;border-radius:50%;background:rgba(58,96,238,.35);border:3px solid rgba(58,96,238,.9);z-index:99999;pointer-events:none;transition:opacity .4s';
    document.body.appendChild(c);
    const x0 = r.right - 40, x1 = Math.max(r.left + 40, x0 - Math.min(max, r.width - 80));
    const put = (x) => { c.style.left = (x - 22) + 'px'; c.style.top = (y - 22) + 'px'; };
    put(x0);
    await new Promise((res) => setTimeout(res, 250));
    const t0 = performance.now();
    await new Promise((res) => { const f = (t) => { const k = Math.min(1, (t - t0) / ms), q = 1 - Math.pow(1 - k, 2); put(x0 + (x1 - x0) * q); e.scrollLeft = max * q; if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    c.style.opacity = '0'; setTimeout(() => c.remove(), 450);
  }, [h, ms || 1000]);
  await sleep(300);
}
// (1.16.3) the long lines of short-6-view: a loan's monthly payment (2,500,000 at 1.5 % for 120 months), a month's spending
const LOAN = (lang) => (Q.COMMA[lang] ? '2500000 × 0,015 / 12 / (1 − (1 + 0,015 / 12)^−120)' : '2500000 × 0.015 / 12 / (1 − (1 + 0.015 / 12)^−120)');
const SPEND = '85000 + 12800 + 6400 + 23500 + 9800 + 4200 + 15000 + 7300';
// the item of the menu with ⚙ (Settings), in every language
const settingsItem = (page) => page.locator('#drawer > button').filter({ has: page.locator('.ico', { hasText: '⚙' }) }).first();

// (1.16.3) the steps of the scenes wholeview and wholeviewp (w: the waits in ms): ⤢ of the long line → "View whole" → two fingers ×1.5
// → Edit expression: 120 months → 180, the answer under it at once → Done
async function wholeRun(page, w) {
  await sleep(w.start);
  await tap(page, page.locator('#history .h-item.wv-on .h-wv').last()); await sleep(w.open);
  const b = await page.locator('.panel.open .wv-box').boundingBox();
  await pinch(page, b.x + b.width * 0.4, b.y + Math.min(b.height / 2, 160), 90, 135, w.pinch); await sleep(w.afterPinch); // (×1.5: the formula still fits the width)
  await tap(page, page.locator('.panel.open .wv-edit')); await sleep(w.edit);
  // (the months chosen, then typed again as a person does)
  await page.evaluate(() => { const t = document.querySelector('.panel.open .wv-ta'), i = t.value.lastIndexOf('120'); t.focus(); t.setSelectionRange(i, i + 3); });
  await sleep(w.choose);
  for (const [k, ch] of [[0, '1'], [1, '8'], [2, '0']]) {
    await page.evaluate(([k, ch]) => { const t = document.querySelector('.panel.open .wv-ta'); const s = t.selectionStart, e = t.selectionEnd; t.setRangeText(ch, s, k === 0 ? e : s, 'end'); t.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' })); }, [k, ch]);
    await sleep(w.key);
  }
  await sleep(w.read);
  await tap(page, page.locator('.panel.open .wv-ok')); await sleep(w.end);
}
// each scene: prepare (not recorded), then run (recorded)
const SCENES = {
  // (1.16) 1280 × 3 and 980 × 2: the lines get #1 and #2
  histtype: { prep: async () => {}, run: async (page) => { await sleep(300); await twoLines(page); await sleep(500); } },
  // (1.16) #1 + #2 by the numbers, then two lines selected (sum and average) and copied as a table
  histsel: {
    prep: async (page) => { for (const x of ['1280 × 3', '980 × 2']) { await Q.type(page, x); await Q.eq(page); } },
    run: async (page) => { await sleep(300); await sumByNumbers(page); await selectTwo(page); await copyAsTable(page); }
  },
  // (1.16) the whole: typed, #1 + #2, selected, copied as a table (short 1)
  hist: { prep: async () => {}, run: async (page) => { await sleep(300); await twoLines(page); await sumByNumbers(page); await selectTwo(page); await sleep(900); await copyAsTable(page); await sleep(900); } },
  margin: { prep: async () => {}, run: async (page) => stockScene(page, 'margin') },
  possize: { prep: async () => {}, run: async (page) => stockScene(page, 'possize') },
  avgcost: { prep: async () => {}, run: async (page) => stockScene(page, 'avgcost') },
  // (1.16) the notes as a table: its example, a quantity changed (the amounts and totals follow), then Save as CSV
  notestable: {
    prep: async (page) => { await Q.tool(page, 'memo', 0); await sleep(600); await notesTableMode(page); },
    run: async (page) => {
      await sleep(900);
      const q = page.locator('.panel.open .note-tbl tbody tr').first().locator('input').nth(1);
      await tap(page, q); await q.fill(''); await q.type('5', { delay: 160 }); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(1600);
      await tableScroll(page, 'end', 900); await sleep(1800);
      await smoothScroll(page, '.note-more', 160, 800);
      await tap(page, page.locator('.panel.open .note-more > summary')); await sleep(700);
      await tap(page, page.locator('.panel.open .note-more .tool-tbl-btns .btn').nth(2)); await sleep(2200);
    }
  },
  // (1.16) a table of a spreadsheet pasted into the first cell of a new table memo: cells, names of the columns, totals
  notespaste: {
    prep: async (page) => { await Q.tool(page, 'memo'); await sleep(600); await page.locator('.panel.open .note-pick .btn').first().click(); await sleep(1200); await notesTableMode(page); },
    run: async (page, lang) => { await sleep(700); await pasteInto(page, page.locator('.panel.open .note-tbl tbody input').first(), PASTE_TABLE[lang]); await sleep(2600); }
  },
  // (1.16) a column of a spreadsheet pasted into the field: the sheet, Add them up, =
  pastesum: {
    prep: async () => {},
    run: async (page) => {
      await sleep(500); await pasteInto(page, '#expr', '1200\n850\n-300'); await sleep(1300);
      await tap(page, page.locator('#sheet.open button.accent').first()); await sleep(1300);
      await tap(page, eqKey(page)); await sleep(2000);
    }
  },
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
  // (1.12.0, D6) the lying tank with 2:1 heads at 30 % in the tool: ⟳ 3D (the tank grows, the liquid rises), then
  // a finger drags the level up to about 85 % (the amount and % at the level follow), then turns the graph (QCalc Pro)
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
      await sleep(1600); await turn3d(page, 1500); await sleep(900);
    }
  },
  notes: {
    prep: async () => {},
    run: async (page, lang) => { await sleep(300); await openTool(page, 'memo'); await tap(page, chip(page, 0)); await sleep(300); await Q.localNotes(page, lang); await sleep(1000); await smoothScroll(page, '.panel-body > *:nth-child(3)', 40, 900); await sleep(2000); }
  },
  manual: {
    prep: async () => {},
    run: async (page) => { await sleep(300); await openTool(page, 'price'); await sleep(600); await tap(page, page.locator('.panel.open .help-btn').last()); await sleep(2500); await sleep(2800); }
  },
  // (1.16.3, short-6-view) ⤢ of a long line → "View whole": two fingers make it larger → Edit expression: 120 months → 180,
  // the answer under it at once → Done: the line worked out again in its place ((the review of 11-25 14:27, as the store picture)
  // 2 decimal places as for money and ×1.5, so that the answer is on one line and no number is cut in two)
  wholeview: {
    settings: { max_decimals: 2 },
    prep: async (page, lang) => { for (const x of ['1280 × 3', LOAN(lang)]) { await Q.type(page, x); await Q.eq(page); } },
    run: async (page) => wholeRun(page, { start: 500, open: 1400, pinch: 650, afterPinch: 700, edit: 800, choose: 500, key: 150, read: 1300, end: 1900 })
  },
  // ((the owner's question of 11-25 18:56) the same in about 6 s for the 4 s of the promo, so that Done and the new answer are seen
  // there too (wholeview takes 10 s, and the promo plays a scene at most 1.7 times as fast): the same steps, shorter waits)
  wholeviewp: {
    settings: { max_decimals: 2 },
    prep: async (page, lang) => { for (const x of ['1280 × 3', LOAN(lang)]) { await Q.type(page, x); await Q.eq(page); } },
    run: async (page) => wholeRun(page, { start: 150, open: 650, pinch: 400, afterPinch: 250, edit: 450, choose: 250, key: 90, read: 500, end: 1400 })
  },
  // (1.16.3, short-6-view) two fingers spread on the history: its text larger → Settings → Wrap: after 80 characters → the long
  // line on one line, moved sideways with a finger
  wrapzoom: {
    prep: async (page) => { for (const x of ['1280 × 3', '980 × 2', SPEND]) { await Q.type(page, x); await Q.eq(page); } },
    run: async (page) => {
      await sleep(400);
      const h = await page.locator('#history').boundingBox();
      await pinch(page, h.x + h.width / 2, h.y + h.height * 0.55, 100, 150, 650); await sleep(450);
      await tap(page, '#btn-menu'); await sleep(450);
      await tap(page, settingsItem(page)); await sleep(900);
      await smoothScroll(page, '.setting-wrap', 150, 700); await sleep(300);
      const sel = page.locator('.panel.open .setting-wrap select');
      await ring(page, sel); await sleep(250);
      await sel.evaluate((s) => { s.value = 'chars'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(1100);
      await tap(page, page.locator('.panel.open .panel-bar .icon-btn').first()); await sleep(700);
      const wide = page.locator('#history .h-item > .h-expr').filter({ hasText: /85/ }).last();
      await swipeX(page, wide, 1100); await sleep(800);
    }
  }
};

async function record(browser, lang, name) {
  const sc = SCENES[name];
  const { ctx, page } = await Q.start(browser, BASE, SET[lang], { viewport: { width: VW, height: VH }, dpr: DPR, dark: ['rev', 'rev3d', 'axis', 'notes', 'notestable', 'notespaste'].indexOf(name) >= 0, settings: sc.settings });
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
  // the frames and their times → a clip at 30 frames a second: for each 1/30 s the last frame shown by then, through a pipe
  const out = path.join(WORK, lang, name + '.mp4'), tmp = path.join(WORK, lang, name + '.part.mp4');
  if (fs.existsSync(out)) { console.log(lang, name, 'kept: ' + out + ' is there already (a new work folder for a new recording)'); return; }
  if (frames.length) {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-vf', 'scale=786:1746:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-r', '30', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
    const tStart = frames[0].t, tEnd = Math.max(frames[frames.length - 1].t + 0.2, t1);
    let k = 0;
    for (let i = 0; tStart + i / 30 <= tEnd; i++) {
      const at = tStart + i / 30;
      while (k + 1 < frames.length && frames[k + 1].t <= at) k++;
      if (!ff.stdin.write(Buffer.from(frames[k].data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    fs.renameSync(tmp, out);
  }
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
