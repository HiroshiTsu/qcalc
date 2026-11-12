'use strict';
/* QCalc — user interface.
 * All calculations are done by libqalculate (the engine of the open-source calculator
 * Qalculate!) running as a separate process; this page only sends expressions and shows results. */
(function () {

  // ------------------------------------------------------------ helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children) if (c !== null && c !== undefined) e.append(c);
    return e;
  }
  // Saved page state. In the app it is written to files at once (QalcNative.saveState), because
  // WebView writes localStorage to disk only after a delay; localStorage is kept as well (older
  // versions used only localStorage, and a desktop browser has nothing else).
  const nativeState = window.QalcNative && window.QalcNative.loadState ? window.QalcNative : null;
  const stateName = (k) => k.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  const store = {
    get(k, d) {
      try {
        let v = nativeState ? nativeState.loadState(stateName(k)) : null;
        if (v === null || v === undefined) v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch (e) { return d; }
    },
    set(k, v) {
      const text = JSON.stringify(v);
      if (nativeState) { try { nativeState.saveState(stateName(k), text); } catch (e) { } }
      try { localStorage.setItem(k, text); } catch (e) { /* storage full or blocked */ }
    }
  };
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function vibrate() { if (S.haptics && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } } }

  // a value from a table whose keys come from outside (names of functions, variables, units):
  // never something inherited from Object.prototype (a user variable may be called "constructor")
  const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

  let toastTimer;
  // A short message. With `action` ([label, function]) it also has a button, for example "元に戻す".
  function toast(msg, ms, action) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('with-action', !!action);
    if (action) t.append(el('button', { text: action[0], onclick: () => { hideToast(); action[1](); } }));
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 2200);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').classList.remove('show'); // "with-action" stays for the fade-out; only a shown toast can be tapped
  }
  function copyText(text) {
    if (window.QalcNative && QalcNative.copy) QalcNative.copy(text);
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('コピーしました'));
  }
  function openUrl(url) {
    if (window.QalcNative && QalcNative.openUrl) QalcNative.openUrl(url);
    else window.open(url, '_blank');
  }

  // ------------------------------------------------------------- bridge
  const Bridge = (() => {
    let seq = 1;
    const pending = new Map();
    function post(id, msg) {
      if (window.QalcNative) window.QalcNative.send(msg);
      else if (window.QalcDev) window.QalcDev.send(msg);
      else setTimeout(() => receive({ id, ok: false, error: '計算エンジンに接続できません' }), 0);
    }
    // Last resort if a reply never comes (the app itself gives up much earlier and restarts the engine).
    function backstop(id, ms) {
      setTimeout(() => receive({ id, ok: false, code: 'timeout', error: '計算エンジンから応答がありません' }), ms);
    }
    function send(cmd, params) {
      return new Promise((resolve) => {
        const id = seq++;
        pending.set(id, resolve);
        const t = Number((params && params.timeout) || 30000);
        const n = params && Array.isArray(params.exprs) ? Math.max(1, params.exprs.length) : 1;
        backstop(id, Math.max(120000, 2 * t * n + 60000));
        post(id, JSON.stringify(Object.assign({ id, cmd }, params || {})));
      });
    }
    function updateRates() {
      return new Promise((resolve) => {
        const id = seq++;
        pending.set(id, resolve);
        backstop(id, 300000);
        if (window.QalcNative) window.QalcNative.updateRates(id);
        else if (window.QalcDev) window.QalcDev.updateRates(id);
        else receive({ id, ok: false, error: '為替レートを更新できません' });
      });
    }
    function receive(r) {
      if (!r) return;
      const f = pending.get(r.id);
      if (f) { pending.delete(r.id); f(r); }
    }
    function receiveText(t) {
      let r = null;
      try { r = JSON.parse(t); } catch (e) { r = null; }
      if (r && typeof r === 'object') { receive(r); return; }
      // unreadable response: fail the oldest waiting request so the screen does not hang
      const first = pending.keys().next();
      if (!first.done) receive({ id: first.value, ok: false, error: '計算エンジンの応答を読み取れませんでした' });
    }
    // event lines from the engine, for example the exact text of a new "ans"
    let onEvent = null;
    function receiveEvent(t) {
      let ev = null;
      try { ev = JSON.parse(t); } catch (e) { return; }
      if (ev && onEvent) onEvent(ev);
    }
    return { send, updateRates, receive, receiveText, receiveEvent, setEventHandler: (f) => { onEvent = f; } };
  })();
  window.QalcBridge = {
    receive: (r) => Bridge.receive(r), receiveText: (t) => Bridge.receiveText(t), receiveEvent: (t) => Bridge.receiveEvent(t)
  };

  // ----------------------------------------------------------- settings
  const DEFAULTS = {
    angle: 'rad', approx: 'auto', fraction: 'auto', precision: 10, max_decimals: -1,
    base: 10, notation: 'auto', units: 'optimal', mixed_units: true, complex: 'rect',
    grouping: false, structuring: 'simplify', preview: true, haptics: true, auto_ans: true, auto_rates: true,
    text_size: 'normal'
  };
  // size of the text in the history, the input field and the preview (setting "文字の大きさ")
  const TEXT_SCALE = { normal: 1, large: 1.18, xlarge: 1.38 };
  function textScale() { return own(TEXT_SCALE, S.text_size) || 1; }
  function applyTextSize() {
    document.documentElement.dataset.textSize = own(TEXT_SCALE, S.text_size) ? S.text_size : 'normal';
    autosize();
  }
  let S = Object.assign({}, DEFAULTS, store.get('qalc.settings', {}));
  function saveSettings() { store.set('qalc.settings', S); }
  function engineOpts() {
    return {
      angle: S.angle, approx: S.approx, fraction: S.fraction, precision: Number(S.precision) || 10,
      max_decimals: Number(S.max_decimals), base: Number(S.base), notation: S.notation, units: S.units,
      mixed_units: !!S.mixed_units, complex: S.complex, grouping: !!S.grouping, structuring: S.structuring
    };
  }
  const ANGLE_LABEL = { rad: 'RAD', deg: 'DEG', gra: 'GRA' };
  const APPROX_LABEL = { auto: '自動', exact: '厳密', approx: '近似' };
  const BASE_LABEL = { 10: '10進', 16: '16進', 2: '2進', 8: '8進', 12: '12進', '-1': 'ローマ' };

  // ------------------------------------------------------------ history
  let history = store.get('qalc.history', []);
  const saveHistory = debounce(() => store.set('qalc.history', history.slice(-300)), 300);

  // ---------------------------------------------------------- elements
  const exprEl = $('#expr');
  const parsedEl = $('#parsed');
  const previewEl = $('#preview');
  const msgEl = $('#msg');
  const histEl = $('#history');
  // Keep the newest result in view when the history area gets smaller (a long preview, a taller
  // input box, the phone keyboard), unless the history has been scrolled up to read older results.
  let histPinned = true;
  histEl.addEventListener('scroll', () => { histPinned = histEl.scrollHeight - histEl.scrollTop - histEl.clientHeight < 24; }, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(() => { fitMatrices(histEl); if (histPinned) histEl.scrollTop = histEl.scrollHeight; }).observe(histEl);

  // ============================================================ keypad
  const PAGES = {
    num: [
      ['(', { ins: '(' }], [')', { ins: ')' }], ['%', { ins: '%' }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['7'], ['8'], ['9'], ['÷', { ins: '÷', op: true, cls: 'op' }], ['xʸ', { ins: '^', op: true, cls: 'op' }],
      ['4'], ['5'], ['6'], ['×', { ins: '×', op: true, cls: 'op' }], ['√', { ins: '√()', back: 1, cls: 'op' }],
      ['1'], ['2'], ['3'], ['−', { ins: '−', cls: 'op' }], ['π', { ins: 'π', cls: 'op' }],
      ['0'], ['.'], ['E', { ins: 'E', label: '×10ⁿ', small: true }], ['+', { ins: '+', op: true, cls: 'op' }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    fn: [
      ['sin', { ins: 'sin()', back: 1 }], ['cos', { ins: 'cos()', back: 1 }], ['tan', { ins: 'tan()', back: 1 }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['asin', { ins: 'asin()', back: 1 }], ['acos', { ins: 'acos()', back: 1 }], ['atan', { ins: 'atan()', back: 1 }], ['ln', { ins: 'ln()', back: 1 }], ['log', { ins: 'log10()', back: 1, label: 'log₁₀' }],
      ['x²', { ins: '^2', op: true }], ['x⁻¹', { ins: '^(−1)', op: true }], ['∛', { ins: 'cbrt()', back: 1 }], ['eˣ', { ins: 'exp()', back: 1 }], ['n!', { ins: '!', op: true }],
      ['|x|', { ins: 'abs()', back: 1 }], ['e', { ins: 'e' }], ['i', { ins: 'i' }], ['°', { ins: '°' }], ['mod', { ins: ' mod ' }],
      ['solve', { ins: 'solve()', back: 1 }], ['∫', { ins: 'integrate()', back: 1 }], ['d/dx', { ins: 'diff()', back: 1 }], ['Σ', { ins: 'sum()', back: 1 }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    // analysis: derivatives, integrals, limits, sums and products, differential equations.
    // A template such as integrate(, 0, 1) shows where the limits go; the caret is put where the
    // function is typed ("back" characters before the end).
    calc: [
      ['d/dx', { ins: 'diff()', back: 1 }], ['d²/dx²', { ins: 'diff(, x, 2)', back: 7, cls: 'fn sm' }], ['∂/∂y', { ins: 'diff(, y)', back: 4 }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['∫', { ins: 'integrate()', back: 1 }], ['∫ₐᵇ', { ins: 'integrate(, 0, 1)', back: 7, html: '∫<sub>a</sub><sup>b</sup>' }], ['lim', { ins: 'limit(, 0)', back: 4 }], ['Σ', { ins: 'sum(, 1, 10)', back: 8 }], ['Π', { ins: 'product(, 1, 10)', back: 8 }],
      ['dsolve', { ins: 'dsolve(diff(y, x) = )', back: 1, cls: 'fn sm' }], ['極値', { ins: 'extremum()', back: 1 }], ['solve', { ins: 'solve()', back: 1 }], ['∞', { ins: '∞' }], ['y', { ins: 'y' }],
      ['(', { ins: '(' }], [')', { ins: ')' }], ['xʸ', { ins: '^', op: true, cls: 'op' }], ['√', { ins: '√()', back: 1, cls: 'op' }], ['π', { ins: 'π', cls: 'op' }],
      ['sin', { ins: 'sin()', back: 1 }], ['ln', { ins: 'ln()', back: 1 }], ['e', { ins: 'e' }], ['ほか…', { act: 'more', cls: 'fn sm' }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    // matrices and vectors: [1, 2; 3, 4] is typed without leaving the page (digits, brackets, ";"
    // between rows; the "," between elements is in the row of keys above)
    mat: [
      ['[', { ins: '[' }], [']', { ins: ']' }], [';', { ins: '; ' }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['7'], ['8'], ['9'], ['det', { ins: 'det()', back: 1 }], ['Aᵀ', { ins: 'transpose()', back: 1, html: 'A<sup>T</sup>' }],
      ['4'], ['5'], ['6'], ['A⁻¹', { ins: '^(−1)', op: true }], ['×', { ins: '×', op: true, cls: 'op' }],
      ['1'], ['2'], ['3'], ['−', { ins: '−', cls: 'op' }], ['+', { ins: '+', op: true, cls: 'op' }],
      ['0'], ['.'], ['Iₙ', { ins: 'identity()', back: 1, html: 'I<sub>n</sub>' }], ['ほか…', { act: 'more', cls: 'fn sm' }], ['=', { act: 'eq', cls: 'eq' }]
    ]
  };
  // the pages of the keypad: [id, label of the tab, name for screen readers, category of the function list for "ほか…"]
  const PAGE_TABS = [
    ['num', '123', '数字と四則演算のキー', ''], ['fn', '関数', '関数のキー', ''],
    ['calc', '解析', '解析（微分・積分・極限）のキー', 'Calculus'], ['mat', '行列', '行列・ベクトルのキー', 'Matrices & Vectors']
  ];
  const TOOLBAR = [
    ['x', { ins: 'x' }], [',', { ins: ', ' }], ['a=b', { ins: ' = ', title: '等号（方程式の = を入力）' }], ['→', { ins: ' to ', op: true, title: '単位・進数の変換' }],
    ['ans', { ins: 'ans' }], ['⌨', { act: 'kbd', id: 'k-kbd' }], ['◀', { act: 'left', repeat: true }], ['▶', { act: 'right', repeat: true }]
  ];
  let page = 'num';
  const KEY_NAMES = {
    '⌫': '1文字削除', 'AC': 'すべて消去', '◀': 'カーソルを左へ', '▶': 'カーソルを右へ', '⌨': 'キーボードで入力',
    'xʸ': 'べき乗', '√': '平方根', '∛': '立方根', 'E': '×10のべき乗', '÷': '割る', '×': '掛ける', '−': '引く',
    '+': '足す', '=': '計算する', 'π': '円周率パイ', 'x²': '2乗', 'x⁻¹': '逆数', 'n!': '階乗', '|x|': '絶対値',
    'eˣ': 'eのべき乗', '∫': '積分', 'd/dx': '微分', 'Σ': '総和', ',': 'カンマ',
    '°': '度', '%': 'パーセント', '(': '左かっこ', ')': '右かっこ', '.': '小数点',
    'd²/dx²': '2階微分', '∂/∂y': 'yで偏微分', '∫ₐᵇ': '定積分', 'lim': '極限', 'Π': '総乗', 'dsolve': '微分方程式を解く',
    '極値': '極値', 'solve': '方程式を解く', '∞': '無限大', 'ほか…': 'ほかの関数を一覧から選ぶ',
    '[': '左角かっこ（行列の始まり）', ']': '右角かっこ（行列の終わり）', ';': 'セミコロン（行列の行の区切り）',
    'det': '行列式', 'Aᵀ': '転置行列', 'A⁻¹': '逆行列', 'Iₙ': '単位行列'
  };

  function makeKey(def, inToolbar) {
    const [label, o] = [def[0], def[1] || {}];
    let cls = 'key';
    if (o.cls) cls += ' ' + o.cls;
    else if (!inToolbar && !/^[0-9.]$/.test(label)) cls += ' fn';
    const b = el('button', { class: cls, id: o.id, title: o.title, 'aria-label': o.title || KEY_NAMES[label] || label });
    if (o.small) b.append(el('small', { text: o.label }));
    else if (o.html) b.innerHTML = '<span>' + o.html + '</span>'; // a fixed label with <sub>/<sup>, from the tables above
    else b.textContent = o.label || label;
    const run = () => {
      vibrate();
      if (o.act) action(o.act);
      else insert(o.ins !== undefined ? o.ins : label, o.back || 0, o.op);
    };
    bindPress(b, run, o.repeat);
    return b;
  }

  // press handling: keep the caret in the expression field, support key repeat
  function bindPress(b, run, repeat) {
    let timer = null, rep = null, fired = false, viaPointer = false;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; b.classList.remove('pressed'); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      viaPointer = true;
      b.classList.add('pressed');
      fired = false;
      if (repeat) {
        timer = setTimeout(() => { fired = true; run(); rep = setInterval(run, 70); }, 420);
      }
    });
    b.addEventListener('pointerup', (e) => {
      e.preventDefault();
      const was = fired;
      stop();
      if (!was) run();
    });
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', () => { viaPointer = false; stop(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    // screen readers (TalkBack), switch access and hardware keyboards send a plain click
    b.addEventListener('click', () => { if (viaPointer) { viaPointer = false; return; } run(); });
  }

  function buildKeypad() {
    const tb = $('#toolbar');
    tb.textContent = '';
    for (const d of TOOLBAR) tb.append(makeKey(d, true));
    const tabs = $('#pages');
    tabs.textContent = '';
    for (const [id, label, name] of PAGE_TABS) {
      const b = el('button', { class: 'ptab', id: 'tab-' + id, role: 'tab', 'aria-label': name, text: label });
      bindPress(b, () => { vibrate(); setPage(id); });
      tabs.append(b);
    }
    renderPage();
    updateToolbar();
  }
  function setPage(id) {
    if (page === id || !PAGES[id]) return;
    page = id;
    renderPage();
    updateToolbar();
  }
  function renderPage() {
    const g = $('#grid');
    g.setAttribute('aria-label', (PAGE_TABS.find((t) => t[0] === page) || [])[2] || '');
    g.textContent = '';
    for (const d of PAGES[page]) g.append(makeKey(d, false));
  }
  function updateToolbar() {
    for (const [id] of PAGE_TABS) {
      const b = $('#tab-' + id);
      if (b) { b.classList.toggle('on', id === page); b.setAttribute('aria-selected', String(id === page)); }
    }
    const k = $('#k-kbd');
    if (k) k.classList.toggle('on', exprEl.inputMode === 'text');
  }

  // ================================================== expression editing
  // ---- "元に戻す" for an expression that was cleared (AC) or replaced (history, examples)
  const undoEl = $('#undo');
  let undoText = null;
  function offerUndo(prev) {
    if (!prev || !prev.trim()) return;
    undoText = prev;
    undoEl.hidden = false;
  }
  function dropUndo() {
    if (undoText === null) return;
    undoText = null;
    undoEl.hidden = true;
  }
  undoEl.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the caret in the field
  undoEl.addEventListener('click', () => {
    if (undoText === null) return;
    const t = undoText;
    dropUndo();
    vibrate();
    exprEl.value = t;
    exprEl.setSelectionRange(t.length, t.length);
    exprChanged();
    focusExpr();
  });
  // Replaces the whole expression (a history entry, an example). What was typed can be brought back.
  function setExpr(text) {
    const prev = exprEl.value;
    exprEl.value = text;
    exprEl.setSelectionRange(text.length, text.length);
    if (prev.trim() && prev !== text) offerUndo(prev);
    exprChanged();
  }

  function insert(text, back, isOp) {
    dropUndo();
    const v = exprEl.value;
    let s = exprEl.selectionStart, e = exprEl.selectionEnd;
    if (s === undefined || s === null) { s = e = v.length; }
    if (isOp && S.auto_ans && v.trim() === '' && history.length) {
      text = 'ans' + text;
    }
    const sel = v.slice(s, e);
    if (sel && back) {
      // wrap the selection: sin() + "2" -> sin(2), integrate(, 0, 1) + "x^2" -> integrate(x^2, 0, 1)
      text = text.slice(0, text.length - back) + sel + text.slice(text.length - back);
      back = 0;
    }
    exprEl.value = v.slice(0, s) + text + v.slice(e);
    const pos = s + text.length - (back || 0);
    exprEl.setSelectionRange(pos, pos);
    exprChanged();
  }
  function action(a) {
    const v = exprEl.value;
    const s = exprEl.selectionStart, e = exprEl.selectionEnd;
    switch (a) {
      case 'del':
        if (v) dropUndo();
        if (s !== e) { exprEl.value = v.slice(0, s) + v.slice(e); exprEl.setSelectionRange(s, s); }
        else if (s > 0) {
          // delete a whole surrogate pair, or a whole template that is still empty when the caret
          // is right after its "name(":  sin(|)  integrate(|, 0, 1)  diff(|, x, 2)
          let n = 1;
          const before = v.slice(0, s);
          const m = before.match(/(?:[\p{L}_][\p{L}\p{N}_]*|[√∛∜])\($/u);
          const rest = m && /^(?:, [^(),;[\]]*)*\)/.exec(v.slice(s));
          if (rest) { n = m[0].length; exprEl.value = v.slice(0, s - n) + v.slice(s + rest[0].length); exprEl.setSelectionRange(s - n, s - n); exprChanged(); break; }
          if (/[\uDC00-\uDFFF]/.test(v[s - 1] || '')) n = 2;
          exprEl.value = v.slice(0, s - n) + v.slice(e);
          exprEl.setSelectionRange(s - n, s - n);
        }
        exprChanged();
        break;
      case 'clear':
        offerUndo(v); // AC is next to ⌫: a long expression cleared by mistake can be brought back
        exprEl.value = '';
        exprChanged();
        break;
      case 'eq': commit(); break;
      case 'more': {
        // "ほか…": the function list, showing the functions of this page's field
        const tab = PAGE_TABS.find((t) => t[0] === page);
        openCatalog('functions', tab && tab[3]);
        break;
      }
      case 'kbd': toggleKeyboard(); break;
      case 'left': {
        // a selection collapses to its start; otherwise one character back (a surrogate pair counts as one)
        let p = s;
        if (s === e && p > 0) p -= /[\uDC00-\uDFFF]/.test(v[p - 1]) && p > 1 ? 2 : 1;
        exprEl.setSelectionRange(p, p);
        break;
      }
      case 'right': {
        let p = e;
        if (s === e && p < v.length) p += /[\uD800-\uDBFF]/.test(v[p]) && p + 1 < v.length ? 2 : 1;
        exprEl.setSelectionRange(p, p);
        break;
      }
    }
  }
  let kbdMinH = 0, kbdW = 0;
  function toggleKeyboard(force) {
    const text = force !== undefined ? force : exprEl.inputMode !== 'text';
    exprEl.inputMode = text ? 'text' : 'none';
    document.body.classList.toggle('kbd', text);
    kbdMinH = window.innerHeight; kbdW = window.innerWidth;
    exprEl.blur();
    setTimeout(text ? () => exprEl.focus() : focusExpr, 30);
    updateToolbar();
  }
  // When the phone keyboard is closed (for example with the back gesture) the page grows
  // again; bring the on-screen keypad back instead of leaving an empty area.
  window.addEventListener('resize', () => {
    if (exprEl.inputMode !== 'text') return;
    if (window.innerWidth !== kbdW) { kbdW = window.innerWidth; kbdMinH = window.innerHeight; return; }
    kbdMinH = Math.min(kbdMinH, window.innerHeight);
    if (window.innerHeight > kbdMinH * 1.3) toggleKeyboard(false);
    else histEl.scrollTop = histEl.scrollHeight;
  });
  exprEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); commit(); }
  });
  // some keyboards send a line break as text instead of an Enter key press
  exprEl.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); commit(); }
  });
  exprEl.addEventListener('input', (e) => {
    dropUndo();
    if (!e.isComposing) normalizeField();
    if (/[\r\n]/.test(exprEl.value)) {
      const hadEnd = /[\r\n]\s*$/.test(exprEl.value);
      exprEl.value = exprEl.value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (hadEnd) { commit(); return; }
    }
    // same as the on-screen operator keys: "*" typed into an empty field continues from ans
    if (S.auto_ans && history.length && (!e.inputType || e.inputType.indexOf('insert') === 0) &&
        /^[*/^×÷·\uFF0A\uFF0F\uFF3E]$/.test(exprEl.value)) {
      exprEl.value = 'ans' + exprEl.value;
      exprEl.setSelectionRange(exprEl.value.length, exprEl.value.length);
    }
    exprChanged();
  });
  exprEl.addEventListener('focus', () => updateToolbar());

  function autosize() {
    exprEl.style.height = 'auto';
    const h = exprEl.scrollHeight, max = Math.round(110 * textScale());
    exprEl.style.height = Math.min(h, max) + 'px';
    exprEl.style.overflowY = h > max ? 'auto' : 'hidden';
  }
  function focusExpr() {
    // with inputmode="none" this only shows the caret, not the system keyboard
    if (document.activeElement !== exprEl) {
      try { exprEl.focus({ preventScroll: true }); } catch (e) { exprEl.focus(); }
    }
  }

  // Japanese keyboards produce full-width characters (１＋２, ｘ, （）), 円 or ￥ for yen, and
  // "ー" for minus. Each replacement is one character for one, so the caret position stays valid.
  // "ー" is only replaced next to numbers, so names such as コーヒー stay as they are.
  function normalizeJa(s) {
    return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ')
      .replace(/[\uFFE5円]/g, '¥')
      .replace(/[\u2010\u2011\u2013\u2014\u2015]/g, '−')
      .replace(/(^|[\d)\s])ー(?=[\d(\s]|$)/g, '$1−');
  }
  function normalizeExpr(s) {
    return normalizeJa(s).trim();
  }
  function normalizeField() {
    const v = exprEl.value, n = normalizeJa(v);
    if (n === v) return;
    const a = exprEl.selectionStart, b = exprEl.selectionEnd;
    exprEl.value = n;
    exprEl.setSelectionRange(a, b);
  }
  exprEl.addEventListener('compositionend', () => { normalizeField(); exprChanged(); });

  // ======================================================= live preview
  let previewBusy = false, previewAgain = false, previewTimer = null, engineReady = false;
  // the expression being typed survives closing the app or the page being reloaded
  const saveDraft = debounce(() => store.set('qalc.draft', exprEl.value), 500);
  function exprChanged() {
    saveDraft();
    autosize();
    clearTimeout(previewTimer);
    if (!exprEl.value.trim() || !S.preview) { showPreview(null); return; }
    previewTimer = setTimeout(runPreview, 160);
  }
  async function runPreview() {
    if (!engineReady) return;
    if (previewBusy) { previewAgain = true; return; }
    const raw = exprEl.value.trim();
    if (!raw) { showPreview(null); return; }
    previewBusy = true;
    const r = await Bridge.send('calc', { expr: normalizeExpr(raw), opts: engineOpts(), timeout: 1500, max_chars: 6000 });
    previewBusy = false;
    if (exprEl.value.trim() === raw && !committing) showPreview(r);
    if (previewAgain) { previewAgain = false; runPreview(); }
  }
  // Result text as shown: digit groups with commas (the Japanese convention; the engine uses
  // thin spaces), dates without the quotes the engine puts around them.
  function displayText(t) {
    if (!t) return '';
    t = t.replace(/\u202f/g, ',');
    const d = /^"(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)"$/.exec(t);
    return d ? d[1].replace('T', ' ') : t;
  }
  function displayResult(h) {
    const t = displayText(h.result);
    if (h.cmp) return t;
    return (h.approx && t.indexOf('≈') < 0 ? '≈ ' : '= ') + t;
  }
  function resultText(r) {
    if (!r || !r.result) return '';
    return displayResult({ result: r.result, approx: r.approx, cmp: r.comparison });
  }
  // ---- matrices in results
  // The engine prints a matrix on one line, "[1  2; 3  4]": rows separated by "; " and the elements
  // of a row by two spaces (an element that is more than a number or a name is in parentheses).
  // In the history and in the preview a matrix with two or more rows is drawn as a grid. Only
  // the display changes: copying and inserting a result use its text.
  // Returns the text cut into strings and { rows: [[element, …], …], text } objects.
  function splitMatrices(text) {
    if (text.length > 20000 || text.indexOf('[') < 0 || text.indexOf(';') < 0) return [text];
    const parts = [], n = text.length;
    let from = 0, i = 0, tries = 0;
    while (i < n) {
      const c = text[i];
      if (c === '"') { const q = text.indexOf('"', i + 1); if (q < 0) break; i = q + 1; continue; }
      if (c !== '[' || ++tries > 200) { i++; continue; }
      const rows = [];
      let row = [], cell = '', depth = 0, j = i + 1, closed = false;
      for (; j < n; j++) {
        const d = text[j];
        if (d === '"') { const q = text.indexOf('"', j + 1); if (q < 0) break; cell += text.slice(j, q + 1); j = q; continue; }
        if (d === '(' || d === '[') depth++;
        else if (d === ')' || d === ']') {
          if (depth === 0) { closed = d === ']'; break; }
          depth--;
        } else if (depth === 0 && d === ';') {
          row.push(cell); rows.push(row); row = []; cell = '';
          if (text[j + 1] === ' ') j++;
          continue;
        } else if (depth === 0 && d === ' ' && text[j + 1] === ' ') {
          row.push(cell); cell = ''; j++;
          continue;
        }
        cell += d;
      }
      row.push(cell); rows.push(row);
      const cols = rows[0].length;
      if (closed && rows.length >= 2 && rows.length * cols <= 400 && rows.every((r) => r.length === cols && r.every((x) => x.trim() !== ''))) {
        if (i > from) parts.push(text.slice(from, i));
        parts.push({ rows: rows.map((r) => r.map((x) => x.trim())), text: text.slice(i, j + 1) });
        i = from = j + 1;
      } else {
        i++;
      }
    }
    if (from < n) parts.push(text.slice(from));
    return parts;
  }
  function showResult(node, text) {
    const parts = splitMatrices(text);
    if (parts.every((x) => typeof x === 'string')) { node.textContent = text; return; }
    node.textContent = '';
    for (const part of parts) {
      if (typeof part === 'string') { node.append(part); continue; }
      const grid = el('span', { class: 'mx', role: 'img', 'aria-label': part.text });
      grid.style.gridTemplateColumns = 'repeat(' + part.rows[0].length + ', auto)';
      for (const r of part.rows) for (const x of r) grid.append(el('span', { text: x }));
      node.append(grid);
    }
  }
  // The engine's messages are in English (libqalculate has no Japanese translation);
  // the common ones are shown in Japanese.
  const MESSAGES_JA = [
    [/^It has been (\d+) days? since the exchange rates last were updated\.?$/, (m, d) => '為替レートが ' + d + ' 日間更新されていません（メニュー →「為替レートの更新」）'],
    [/^Misplaced operator\(s\) "(.+)" ignored\.?$/, (m, o) => '余分な演算子「' + o + '」を無視しました'],
    [/^Misplaced '(.+)' ignored\.?$/, (m, o) => '余分な「' + o + '」を無視しました'],
    [/^Division by zero\.?$/, () => 'ゼロで割っています'],
    [/^Definite integral was approximated\.?$/, () => '定積分は数値計算による近似値です'],
    [/^Empty expression in parentheses interpreted as zero\.?$/, () => '空のかっこは 0 として計算しました'],
    [/^A global unit or variable was deactivated\..*$/, () => '同じ名前の組み込みの単位・変数を一時的に置き換えました（新しい変数を削除すると元に戻ります）'],
    [/^You need at least (\d+) argument\(s\) \((.+)\) in function (.+)\(\)\.?$/, (m, n, a, f) => f + '() には引数が ' + n + ' 個以上必要です（' + a + '）'],
    [/^You need at least (\d+) argument \((.+)\) in function (.+)\(\)\.?$/, (m, n, a, f) => f + '() には引数が ' + n + ' 個以上必要です（' + a + '）'],
    [/^Did you mean "(.+)" \(instead of "(.+)"\)\?$/, (m, a, b) => '「' + b + '」ではなく「' + a + '」のことですか？'],
    [/^limit\(\) is incomplete and unreliable\.?$/, () => 'limit() は完全ではなく、結果が正しくない場合があります'],
    [/^No unknown variable\/symbol was found\.?$/, () => '解く対象の未知数（変数）が見つかりません'],
    [/^Conversion of only part of an expression is not supported.*$/, () => '式の一部だけを変換することはできません'],
    [/^Unable to find a solution\.?$/, () => '解が見つかりませんでした'],
    // analysis
    [/^Unable to integrate the expression\.?$/, () => 'この式は積分できませんでした'],
    [/^Unable to integrate the expression exactly\.?$/, () => 'この式は厳密には積分できませんでした'],
    [/^Unable to find limit\.?$/, () => '極限を求められませんでした'],
    [/^No differential equation found\.?$/, () => '微分方程式が見つかりません（例：dsolve(diff(y, x) = y)）'],
    [/^Unable to solve differential equation\.?$/, () => 'この微分方程式は解けませんでした'],
    [/^To avoid division by zero, the following must be true: (.+)\.$/, (m, c) => 'ゼロで割らないための条件：' + c],
    [/^Was unable to isolate (.+) with the current assumptions\. The assumed (?:type and )?sign was therefore temporarily set as unknown\.?$/,
      (m, x) => x + ' を実数として求められなかったため、その仮定を外して解きました（複素数の解を含むことがあります）'],
    [/^Was unable to completely isolate (.+)\.$/, (m, x) => x + ' について完全には解けませんでした'],
    [/^Was unable to isolate (.+)\.$/, (m, x) => x + ' について解けませんでした'],
    // matrices and vectors
    [/^Inverse of singular matrix\.?$/, () => '逆行列がありません（行列式が 0 の行列です）'],
    [/^Please use the cross\(\), dot\(\), and hadamard\(\) functions for vector multiplication\.?$/,
      () => 'ベクトルどうしの積は、cross()（外積）、dot()（内積）、hadamard()（要素ごとの積）を使ってください'],
    [/^The second matrix must have as many rows \(was (\d+)\) as the first has columns \(was (\d+)\) for matrix multiplication\.?$/,
      (m, r, c) => '行列の積は、左の行列の列の数（' + c + '）と右の行列の行の数（' + r + '）が同じでなければ計算できません'],
    [/^Argument (\d+), (.+), in (.+)\(\) must be a square matrix\.?$/, (m, n, a, f) => f + '() の ' + n + ' 番目の引数は正方行列（行と列の数が同じ行列）でなければなりません'],
    [/^(.+)\(\) requires that all matrices\/vectors have the same dimensions\.?$/, (m, f) => f + '() に渡す行列・ベクトルは、すべて同じ大きさでなければなりません'],
  ];
  function jaMessage(text) {
    for (const [re, f] of MESSAGES_JA) {
      const m = re.exec(text);
      if (m) return f(...m);
    }
    return text;
  }
  function showPreview(r) {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    if (!r) { parsedEl.textContent = ''; previewEl.textContent = ''; return; }
    if (!r.ok) { previewEl.textContent = ''; msgEl.textContent = r.error || ''; msgEl.className = 'msg error'; return; }
    parsedEl.textContent = r.parsed || '';
    const err = (r.messages || []).find((m) => m.type === 'error');
    if (r.deferred) previewEl.textContent = '＝ を押すと実行します（定義など）';
    else if (r.timeout) previewEl.textContent = '…';
    else if (err) { previewEl.textContent = ''; msgEl.textContent = jaMessage(err.text); msgEl.className = 'msg error'; }
    else {
      showResult(previewEl, resultText(r));
      fitMatrices(previewEl);
      const warn = (r.messages || []).find((m) => m.type === 'warning');
      if (warn) msgEl.textContent = jaMessage(warn.text);
    }
  }

  // ============================================================ commit
  let committing = false, busyTimer = null;
  async function commit() {
    const raw = exprEl.value.trim();
    if (!raw || committing) return;
    if (!engineReady) { toast('計算エンジンを準備中です'); return; }
    const expr = normalizeExpr(raw);
    committing = true;
    clearTimeout(previewTimer);
    previewEl.textContent = '計算中…';
    busyTimer = setTimeout(() => { if (committing) previewEl.textContent = '計算中…（ここをタップで中止）'; }, 1200);
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: 20000, store: true, max_chars: 200000 });
    committing = false;
    clearTimeout(busyTimer);
    clearInterval(cancelTimer);
    if (!r.ok) {
      previewEl.textContent = '';
      msgEl.textContent = r.code === 'cancelled' ? '計算を中止しました' : (r.error || '計算できませんでした');
      msgEl.className = 'msg error';
      return;
    }
    if (r.timeout) { previewEl.textContent = ''; msgEl.textContent = '時間がかかりすぎたため計算を中止しました'; msgEl.className = 'msg error'; return; }
    if (!r.result) {
      const err = (r.messages || []).find((m) => m.type === 'error');
      previewEl.textContent = '';
      msgEl.textContent = err ? jaMessage(err.text) : '式を確認してください';
      msgEl.className = 'msg error';
      return;
    }
    const entry = capEntry({
      expr, result: r.result, approx: r.approx, cmp: r.comparison, base: Number(S.base),
      msgs: (r.messages || []).filter((m) => m.type !== 'info').slice(0, 3), t: Date.now()
    });
    if (earlyInputs.has(r.id)) { setInput(entry, earlyInputs.get(r.id)); earlyInputs.delete(r.id); }
    sessionEntries.set(r.id, entry);
    history.push(entry);
    if (history.length > 300) history = history.slice(-300);
    saveHistory();
    dropUndo();
    if (exprEl.value.trim() === raw) {
      exprEl.value = '';
      showPreview(null);
      autosize();
    } else {
      previewEl.textContent = '';
      exprChanged(); // something was typed while the calculation ran: keep it
    }
    saveDraft();
    renderHistory(true);
    announce(entry);
  }

  // Very long results are kept shorter in the saved history (storage is limited).
  const MAX_SAVED_RESULT = 20000;
  function capEntry(h) {
    if (h.result && h.result.length > MAX_SAVED_RESULT) {
      h.result = h.result.slice(0, MAX_SAVED_RESULT) + '…';
      h.cut = true;
    }
    return h;
  }
  function setInput(h, input) {
    if (typeof input !== 'string' || !input) return;
    if (input.length > MAX_SAVED_RESULT) h.big = true;
    else h.input = input;
  }
  // The engine reports the exact text of each new ans after the result (see qalc-engine.cc).
  const sessionEntries = new Map(), earlyInputs = new Map();
  Bridge.setEventHandler((ev) => {
    if (ev.event !== 'ans') return;
    const h = sessionEntries.get(ev.id);
    if (h) { setInput(h, ev.input); saveHistory(); return; }
    earlyInputs.set(ev.id, ev.input);
    if (earlyInputs.size > 20) earlyInputs.delete(earlyInputs.keys().next().value);
  });
  // screen readers hear only the newest result, not the whole history again
  function announce(h) {
    const st = $('#status');
    if (st) st.textContent = h.expr + '、' + displayResult(h);
  }

  // "計算中…（ここをタップで中止）". The engine handles one request at a time, so a preview that was
  // still running may be the one that gets stopped; the request is repeated until this calculation ends.
  let cancelTimer = null;
  previewEl.addEventListener('click', () => {
    if (!committing || !window.QalcNative || !QalcNative.cancel) return;
    previewEl.textContent = '中止しています…';
    QalcNative.cancel();
    clearInterval(cancelTimer);
    cancelTimer = setInterval(() => { if (committing) QalcNative.cancel(); else clearInterval(cancelTimer); }, 400);
  });

  // ============================================================ history
  function firstPart(result) {
    // "π² − 4 ≈ 5.869604401" -> "π² − 4",  "1/2 = 0.5" -> "1/2"
    const cut = result.split(/ [≈=] /)[0];
    return cut || result;
  }
  // Text to insert when a history result is reused. Normally the engine's exact text ("7/3"
  // where the screen shows "2 + 1/3 ≈ 2.333333333", "255" for a result shown as 0xFF), in
  // parentheses unless it is a single number or name. Returns null when it cannot be reused.
  function insertText(h) {
    if (h.big || h.cut) return null;
    // the engine's text is already the value: for "x = 2" it is 2, for "x = 2 or x = −2" [2  −2]
    if (h.input) return wrapValue(h.input);
    return legacyInsertText(h);
  }
  function wrapValue(t) {
    return /^[−-]?(?:\d[\d.]*(?:E[−-]?\d+)?|[\p{L}_][\p{L}\p{N}_]*|\[[^\]]*\]|"[^"]*")$/u.test(t) ? t : '(' + t + ')';
  }
  // for history saved by older versions, which has only the displayed text
  function legacyInsertText(h) {
    let t = h.result;
    if (/^[−-]?0[xbo][0-9A-Fa-f.\s]+$/.test(t)) return t.replace(/\s/g, '');  // already has a base prefix
    if (h.base !== undefined && Number(h.base) !== 10) {
      const pre = { 16: '0x', 2: '0b', 8: '0o' }[h.base];
      const digits = t.replace(/\s/g, '');
      if (!pre || !/^[−-]?[0-9A-F.]+$/.test(digits)) return null;
      t = digits.replace(/^([−-]?)/, '$1' + pre);
    } else if (h.cmp) {
      const m = /^[\p{L}_][\p{L}\p{N}_]* = ([^|&<>≤≥≠=]+)$/u.exec(t);
      if (!m || / or | and /.test(m[1])) return null;
      t = m[1];
    } else {
      t = firstPart(t);
    }
    return wrapValue(t.replace(/\u202f/g, ''));
  }
  function insertResult(h) {
    const t = insertText(h);
    if (t === null) { toast('この結果はそのまま挿入できません（ans キーで使えます）', 2600); return; }
    insert(t, 0, false);
  }
  function renderHistory(scroll) {
    histEl.textContent = '';
    if (!history.length) {
      // nothing calculated yet: say what to do and offer a few examples to try
      const chips = el('div', { class: 'ex-chips' });
      for (const x of STARTERS) chips.append(tapButton({ class: 'ex-chip', text: x }, () => { setExpr(x); focusExpr(); }));
      histEl.append(el('div', { class: 'empty' },
        el('div', { class: 'empty-t', html: '式を入力して <b>=</b> を押すと、ここに結果が残ります' }),
        el('div', { text: '結果をタップで式に挿入、長押しでコピーできます。' }),
        el('div', { class: 'empty-try', text: '例をタップして試す' }), chips,
        tapButton({ class: 'btn', text: '式の例・使い方を見る' }, () => openExamples())));
      histEl.scrollTop = 0; // read from the top (results are followed at the bottom)
      histPinned = false;
      return;
    }
    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const res = el('div', { class: 'h-res' });
      showResult(res, displayResult(h));
      const item = el('div', { class: 'h-item' }, el('div', { class: 'h-expr', text: h.expr }), res);
      for (const m of h.msgs || []) item.append(el('div', { class: 'h-msg ' + m.type, text: jaMessage(m.text) }));
      bindLongPress(item, () => historyMenu(i), (target) => {
        if (target.closest('.h-expr')) setExpr(h.expr);
        else insertResult(h);
        focusExpr();
      });
      histEl.append(item);
    }
    fitMatrices(histEl);
    if (scroll) { histEl.scrollTop = histEl.scrollHeight; histPinned = true; }
  }
  // A matrix that is wider than the place it is shown in gets smaller characters (down to 60 %);
  // if it is still too wide it can be moved sideways.
  function fitMatrices(root) {
    for (const g of root.querySelectorAll('.mx')) {
      g.style.fontSize = '';
      let scale = 1;
      for (let i = 0; i < 4 && scale > 0.6 && g.clientWidth > 0 && g.scrollWidth > g.clientWidth + 1; i++) {
        scale = Math.max(0.6, scale * g.clientWidth / g.scrollWidth - 0.01);
        g.style.fontSize = (0.84 * scale).toFixed(3) + 'em'; // 0.84em is the size in style.css
      }
    }
  }
  function bindLongPress(node, onLong, onTap) {
    let timer = null, sx = 0, sy = 0, long = false;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // keep the focus (and the caret) in the expression field
      sx = e.clientX; sy = e.clientY; long = false;
      timer = setTimeout(() => { long = true; vibrate(); onLong(); }, 480);
    });
    node.addEventListener('pointermove', (e) => {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) { clearTimeout(timer); timer = null; }
    });
    node.addEventListener('pointerup', (e) => {
      if (timer) { clearTimeout(timer); timer = null; if (!long) onTap(e.target); }
      if (long) {
        // the browser may still send a click, which would land on the menu's dimmed background
        const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', kill, true);
        setTimeout(() => window.removeEventListener('click', kill, true), 500);
      }
    });
    node.addEventListener('pointercancel', () => { clearTimeout(timer); timer = null; });
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  async function historyMenu(i) {
    const h = history[i];
    const a = await sheet(h.expr + '\n' + h.result, [
      ['copy-res', '結果をコピー'], ['copy-expr', '式をコピー'], ['edit', '式を編集'],
      ['ins-ans', '結果を式に挿入'], ['del', 'この行を削除', 'danger']
    ]);
    if (a === 'copy-res') copyText(displayText(h.result));
    else if (a === 'copy-expr') copyText(h.expr);
    else if (a === 'edit') setExpr(h.expr);
    else if (a === 'ins-ans') insertResult(h);
    else if (a === 'del') {
      if (history[i] !== h) return; // the history changed while the menu was open
      history.splice(i, 1);
      historyChanged();
      toast('1 行を削除しました', 5000, ['元に戻す', () => {
        history.splice(Math.min(i, history.length), 0, h);
        if (history.length > 300) history = history.slice(-300);
        historyChanged();
      }]);
    }
  }
  function historyChanged() {
    saveHistory();
    renderHistory(false);
  }
  // a button that does not take the focus (and with it the caret) away from the expression field
  function tapButton(attrs, run) {
    const b = el('button', attrs);
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => { vibrate(); run(); });
    return b;
  }

  // ========================================================= sheet/menu
  let sheetResolve = null;
  function sheet(title, actions) {
    if (sheetResolve) closeSheet(null);
    return new Promise((resolve) => {
      const sh = $('#sheet');
      sh.textContent = '';
      if (title) sh.append(el('div', { class: 'stitle', text: title }));
      for (const [key, label, cls] of actions) {
        sh.append(el('button', { class: cls || '', text: label, onclick: () => closeSheet(key) }));
      }
      sh.append(el('button', { text: 'キャンセル', onclick: () => closeSheet(null) }));
      sheetResolve = resolve;
      $('#scrim').classList.add('show', 'over-panels');
      sh.classList.add('open');
      sh.inert = false;
    });
  }
  function closeSheet(key) {
    $('#sheet').classList.remove('open');
    $('#sheet').inert = true;
    $('#scrim').classList.remove('over-panels');
    if (!$('#drawer').classList.contains('open')) $('#scrim').classList.remove('show');
    const r = sheetResolve;
    sheetResolve = null;
    if (r) r(key);
  }
  function confirmSheet(title, okLabel) {
    return sheet(title, [['ok', okLabel, 'danger']]).then((k) => k === 'ok');
  }

  const MENU = [
    ['examples', '💡', '式の例・使い方'],
    ['functions', 'ƒ', '関数の一覧'],
    ['units', '㎏', '単位・通貨の一覧'],
    ['variables', 'π', '変数・定数の一覧'],
    ['plot', '📈', 'グラフ'],
    ['defs', '✎', 'ユーザー定義の変数・関数'],
    ['rates', '¥', '為替レートの更新'],
    null,
    ['settings', '⚙', '設定'],
    ['clear', '🗑', '履歴を消去'],
    ['about', 'ⓘ', 'このアプリについて']
  ];
  function buildDrawer() {
    const d = $('#drawer');
    d.append(el('div', { class: 'head' }, el('div', { class: 'name', text: 'QCalc' }),
      el('div', { class: 'sub', id: 'drawer-sub', text: '計算エンジン libqalculate' })));
    for (const m of MENU) {
      if (!m) { d.append(el('hr')); continue; }
      d.append(el('button', { onclick: () => { closeDrawer(); menuAction(m[0]); } },
        el('span', { class: 'ico', text: m[1] }), el('span', { text: m[2] })));
    }
  }
  function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').inert = false; $('#scrim').classList.add('show'); }
  function closeDrawer() {
    const d = $('#drawer');
    if (!d.classList.contains('open')) return;
    d.classList.remove('open');
    d.inert = true;
    if (!$('#sheet').classList.contains('open')) $('#scrim').classList.remove('show');
    if (!panelStack.length) focusExpr();
  }
  $('#btn-menu').addEventListener('click', openDrawer);
  $('#scrim').addEventListener('click', () => { if ($('#sheet').classList.contains('open')) closeSheet(null); closeDrawer(); });

  async function menuAction(k) {
    if (k === 'functions' || k === 'units' || k === 'variables') openCatalog(k);
    else if (k === 'plot') openPlot();
    else if (k === 'defs') openDefs();
    else if (k === 'rates') openRates();
    else if (k === 'settings') openSettings();
    else if (k === 'about') openAbout();
    else if (k === 'examples') openExamples();
    else if (k === 'clear') {
      if (!history.length) { toast('履歴はありません', 1400); return; }
      if (!(await confirmSheet('計算履歴をすべて消去しますか？', '消去する'))) return;
      const old = history;
      history = [];
      historyChanged();
      toast('履歴を消去しました', 6000, ['元に戻す', () => {
        history = old.concat(history).slice(-300); // with anything calculated in the meantime
        historyChanged();
        histEl.scrollTop = histEl.scrollHeight;
      }]);
    }
  }

  // ============================================================ panels
  const panelStack = [];
  const panels = {};
  function panel(id, title, build) {
    let p = panels[id];
    if (!p) {
      const body = el('div', { class: 'panel-body' });
      const bar = el('div', { class: 'panel-bar' },
        el('button', { class: 'icon-btn', 'aria-label': '戻る', onclick: () => closePanel(), html: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        el('div', { class: 'ptitle', text: title }));
      p = { node: el('section', { class: 'panel' }, bar, body), body, bar };
      document.body.append(p.node);
      panels[id] = p;
      build(p);
    }
    requestAnimationFrame(() => p.node.classList.add('open'));
    panelStack.push(p);
    return p;
  }
  function closePanel() {
    const p = panelStack.pop();
    if (!p) return false;
    const a = document.activeElement;
    if (a && a.blur) a.blur();
    p.node.classList.remove('open');
    if (p.onClose) p.onClose();
    if (!panelStack.length) setTimeout(focusExpr, 220);
    return true;
  }

  // ---------------------------------------------------------- examples
  // Expressions to try: tapping one puts it into the input field (the preview then shows the result).
  // They are written as the on-screen keys write them (×, −, π); a phone keyboard's * and - work too.
  const STARTERS = ['60 mph to km/h', '100 USD to JPY', 'solve(x^2 − 5x + 6 = 0)', 'diff(x^3)'];
  const EXAMPLES = [
    ['基本の計算', [
      ['1/3 + 1/4', '分数は分数のまま計算（小数も並べて表示）'],
      ['2^10', 'べき乗（xʸ キー）'],
      ['√(2) × √(8)', '平方根（√ キー）。結果は厳密に 4'],
      ['20!', '階乗（fn → n!）'],
      ['2400 × 15%', 'パーセント'],
      ['sin(30°)', '角度に ° を付けると、設定が RAD でも度で計算'],
      ['e^(i × π)', '複素数（i は虚数単位）'],
      ['(3 + 4i) × (1 − 2i)', '複素数の計算（abs は絶対値、arg は偏角）'],
      ['1000000 / 7 to fraction', '結果を分数で表示']
    ]],
    ['単位の変換', [
      ['5 km to mi', '長さ。「to」は → キーで入力'],
      ['170 cm to ft', '身長をフィートとインチで'],
      ['60 mph to km/h', '速さ'],
      ['100 °F to °C', '温度'],
      ['30 坪 to m²', '坪を平方メートルに（単位の一覧に「日本の単位」があります）'],
      ['1.5 h + 45 min', '単位の付いた値どうしの計算'],
      ['80 kg × 9.8 m/s² to N', '単位ごと計算して、別の単位で表示'],
      ['500 GB / (20 MB/s) to h', '時間の見積もり']
    ]],
    ['通貨の換算', [
      ['100 USD to JPY', 'ドルを円に（レートは「為替レートの更新」で最新に）'],
      ['50 EUR to JPY', 'ユーロを円に'],
      ['10000 JPY to USD', '円をドルに'],
      ['1 BTC to JPY', 'ビットコイン']
    ]],
    ['方程式', [
      ['solve(x^2 − 5x + 6 = 0)', '方程式を解く'],
      ['x^2 = 16', '等式をそのまま入力しても解ける'],
      ['multisolve([x + y = 5, x − y = 1], [x, y])', '連立方程式'],
      ['3x + 2 > 11', '不等式']
    ]],
    ['微分', [
      ['diff(x^3 + 2x)', '微分（「解析」のキー → d/dx）'],
      ['diff(x^2 × sin(x))', '積の微分。結果は式のまま表示'],
      ['diff(x^5, x, 2)', '2 階微分（3 つ目が階数。d²/dx² キー）'],
      ['diff(x^2 × y^3, y)', '偏微分（y で微分。∂/∂y キー）'],
      ['diff(x^3, x, 1, 2)', 'x = 2 での微分係数（4 つ目が x の値）'],
      ['extremum(x^3 − 3x)', '極値をとる x（極値 キー）']
    ]],
    ['積分', [
      ['integrate(1/x)', '不定積分（∫ キー）。C は積分定数'],
      ['integrate(x^2 × sin(x), 0, π)', '定積分（∫ₐᵇ キー）。下端、上端の順'],
      ['integrate(e^(−x^2), −∞, ∞)', '広義積分（∞ キー）。ガウス積分'],
      ['integrate(integrate(x × y, 0, 1, x), 0, 2, y)', '重積分（4 つ目が積分する変数）'],
      ['integrate(√(1 − x^2), −1, 1)', '半円の面積。結果は厳密に π/2'],
      ['romberg(sin(x)/x, 1, 2)', '数値積分（ロンバーグ法）']
    ]],
    ['極限・級数・微分方程式', [
      ['limit(sin(x)/x, 0)', '極限（lim キー）'],
      ['limit((1 + 1/x)^x, ∞)', '無限大での極限'],
      ['limit(1/x, 0, x, 1)', '右からの極限（最後の 1 が右側、−1 が左側）'],
      ['sum(x^2, 1, 10)', '総和（Σ キー）。x = 1 から 10 まで'],
      ['product(x, 1, 5)', '総乗（Π キー）'],
      ['dsolve(diff(y, x) = −2y, 5)', '微分方程式 y′ = −2y、y(0) = 5（dsolve キー）'],
      ['newtonsolve(cos(x) = x, 1)', '方程式の数値解（ニュートン法、初期値 1）']
    ]],
    ['行列', [
      ['[1, 2; 3, 4] × [5, 6; 7, 8]', '行列の積。「行列」のキーで入力（; が行の区切り）'],
      ['[1, 2; 3, 4]^−1', '逆行列（A⁻¹ キー）'],
      ['det([1, 2, 3; 4, 5, 6; 7, 8, 10])', '行列式（det キー）'],
      ['transpose([1, 2, 3; 4, 5, 6])', '転置行列（Aᵀ キー）'],
      ['[2, 1; 1, 3]^−1 × [3; 5]', '連立一次方程式 A x = b を解く'],
      ['rref([2, 1, 3; 1, 3, 5])', '行基本変形（行簡約階段形）'],
      ['rk([1, 2; 2, 4])', '階数（ランク）。trace はトレース'],
      ['solve(det([2, 1; 1, 2] − x × identity(2)) = 0)', '固有値（固有方程式を解く）']
    ]],
    ['ベクトル', [
      ['dot([1, 2, 3], [4, 5, 6])', '内積'],
      ['cross([1, 0, 0], [0, 1, 0])', '外積'],
      ['norm([3, 4])', '長さ（ノルム）'],
      ['[1, 2, 3] + 2 × [4, 5, 6]', '和とスカラー倍']
    ]],
    ['進数・整数', [
      ['255 to hex', '16進数に（to bin、to oct も）'],
      ['0xFF + 0b1010', '16進数と2進数をまぜて計算'],
      ['2026 to roman', 'ローマ数字'],
      ['factor(360)', '素因数分解'],
      ['gcd(84, 36)', '最大公約数（lcm は最小公倍数）']
    ]],
    ['日付', [
      ['today + 100 days', '100 日後の日付'],
      ['days(today, "2027-01-01")', '2 つの日付の間の日数'],
      ['"2026-12-25" − 3 weeks', '日付から期間を引く']
    ]],
    ['統計・誤差・定数', [
      ['mean(3, 5, 8, 12)', '平均（median は中央値、stdev は標準偏差）'],
      ['(5 ± 0.2) m × (3 ± 0.1) m', '誤差（不確かさ）の伝わり方'],
      ['1 g × c^2 to kWh', '物理定数（c は光速）'],
      ['planck × 500 THz to eV', 'プランク定数を使った計算'],
      ['gamma(1/2)', 'ガンマ関数（zeta、erf、besselj などの特殊関数も使えます）']
    ]]
  ];
  const TIPS = [
    '入力している間に結果が下に表示されます。= を押すと確定して、履歴に残ります。',
    '履歴の結果をタップすると式に挿入、式をタップするともう一度編集、長押しでコピーや削除ができます。',
    '→ キーは「to」（単位・通貨・進数の変換）です。例：5 km → mi',
    'キーは「123」「関数」「解析」「行列」のタブで切り替えます。⌨ キーでスマホのキーボードも使えます。',
    '「解析」には微分・積分・極限・総和・微分方程式、「行列」には行列の入力と行列式・逆行列などのキーがあります。「ほか…」でその分野の関数の一覧が開きます。',
    '方程式の「=」は a=b キーで入力します（大きい = キーは計算の確定です）。例：solve(x^2 = 16)',
    '行列は [1, 2; 3, 4] のように、要素を「,」、行を「;」で区切って入力します。結果の行列は履歴に表の形で表示されます。',
    '上の「RAD」「自動」「10進」をタップすると、角度の単位、厳密・近似、結果の進数が切り替わります。',
    '関数・単位・定数は、メニューの一覧から日本語でも探せます（例：「積分」「マイル」「光速」）。',
    'グラフはメニューの「グラフ」から。y = f(x) の 2D と、z = f(x, y) の 3D が描けます。diff(x^3 − 3x) のように、微分や積分の式もそのまま描けます。',
    'AC で消した式は、すぐ後に出る「元に戻す」で戻せます。'
  ];
  function useExample(text) {
    while (panelStack.length) closePanel();
    setExpr(text);
    focusExpr();
  }
  function openExamples() {
    return panel('examples', '式の例・使い方', (p) => {
      p.body.append(el('div', { class: 'section-title', text: '式の例（タップすると入力欄に入ります）' }));
      for (const [group, rows] of EXAMPLES) {
        const box = el('div', { class: 'card ex-group' }, el('div', { class: 'ex-title', text: group }));
        for (const [text, note] of rows) {
          box.append(el('button', { class: 'ex-row', onclick: () => useExample(text) },
            el('span', { class: 'mono ex-expr', text }), el('span', { class: 'ex-note', text: note })));
        }
        p.body.append(box);
      }
      p.body.append(el('div', { class: 'section-title', text: '使い方のヒント' }),
        el('div', { class: 'card' }, el('ul', { class: 'tips' }, ...TIPS.map((t) => el('li', { text: t })))),
        el('div', { class: 'form-hint', text: '式の書き方は Qalculate! と同じです。使える関数は「関数の一覧」、単位と通貨は「単位・通貨の一覧」にあります。' }));
    });
  }

  // ---------------------------------------------------------- catalogs
  const catalogs = {};
  async function loadCatalog(kind) {
    if (catalogs[kind]) return catalogs[kind];
    const r = await Bridge.send('catalog', { kind });
    if (!r.ok) throw new Error(r.error || 'catalog');
    const hidden = HIDDEN_ITEMS[kind] || [];
    const items = r.items.filter((it) => hidden.indexOf(it.name) < 0);
    // Japanese names: shown beside the English title and used by the search
    const names = kind === 'functions' ? FUNC_JA : kind === 'variables' ? VAR_JA : JA_NAMES;
    for (const it of items) {
      it._cat = it.category || 'その他';
      it._top = it._cat.split('/')[0];
      it._ja = own(names, it.name) || (kind === 'units' && own(names, it.abbr)) || '';
      const ja = it._ja + ' ' + it._cat.split('/').map((c) => own(CATEGORY_JA, c) || '').join(' ');
      it._q = [it.name, it.abbr, it.display, it.title, it.description, it._cat, ja].join(' ').toLowerCase();
    }
    items.sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
    catalogs[kind] = items;
    return items;
  }
  const CATALOG_TITLE = { functions: '関数の一覧', units: '単位・通貨の一覧', variables: '変数・定数の一覧' };
  // not available in this build (no gnuplot, no files or commands from expressions)
  const HIDDEN_ITEMS = { functions: ['plot', 'command', 'load', 'export'], variables: ['uptime'] };
  const CATEGORY_JA = {
    'Currency': '通貨', 'Length': '長さ', 'Area': '面積', 'Volume': '体積', 'Mass': '質量', 'Time': '時間',
    'Speed': '速さ', 'Velocity': '速さ', 'Temperature': '温度', 'Energy': 'エネルギー', 'Pressure': '圧力', 'Force': '力',
    'Information': '情報量', 'Angle': '角度', 'Acceleration': '加速度', 'Density': '密度', 'Electricity': '電気',
    'Magnetism': '磁気', 'Light': '光', 'Radioactivity': '放射線', 'Ratio': '比', 'Frequency': '周波数',
    'Fuel Consumption': '燃費', 'Mechanics': '力学', 'Thermodynamics': '熱力学',
    'Algebra': '代数', 'Calculus': '微積分', 'Combinatorics': '組合せ', 'Complex Numbers': '複素数',
    'Date & Time': '日付・時刻', 'Economics': '経済', 'Exponents & Logarithms': '指数・対数', 'Geometry': '幾何',
    'Logical': '論理', 'Matrices & Vectors': '行列・ベクトル', 'Miscellaneous': 'その他', 'Number Theory': '数論',
    'Statistics': '統計', 'Trigonometry': '三角関数', 'Special Functions': '特殊関数', 'Step Functions': 'ステップ関数',
    'Utilities': 'ユーティリティ', 'Unit Conversion': '単位変換', 'Data Sets': 'データセット', 'Physics': '物理',
    'Constants': '定数', 'Large Numbers': '大きな数', 'Small Numbers': '小さな数', 'Unknowns': '未知数',
    'User variables': 'ユーザー定義', 'User functions': 'ユーザー定義', 'Temporary': '一時的',
    'Japanese Units': '日本の単位', 'Typography': '活字', 'Substance': '物質量', 'Basic Constants': '基本の定数',
    'Physical Constants': '物理定数', 'Special Numbers': '特別な数', 'Traditional Numbers': '昔からの数え方'
  };
  // Japanese names of units and currencies, by the engine's name or abbreviation of the unit:
  // the first word is shown beside the English title, all words are found by the search
  const JA_NAMES = {
    JPY: '円 日本円', USD: 'ドル 米ドル アメリカドル', EUR: 'ユーロ', GBP: 'ポンド 英ポンド イギリス', CNY: '元 人民元 中国',
    KRW: 'ウォン 韓国', TWD: '台湾ドル', HKD: '香港ドル', AUD: '豪ドル オーストラリアドル', CAD: 'カナダドル',
    CHF: 'スイスフラン', BTC: 'ビットコイン', PEN: 'ソル ペルー', BRL: 'レアル ブラジル', INR: 'ルピー インド',
    THB: 'バーツ タイ', VND: 'ドン ベトナム', PHP: 'ペソ フィリピン', MXN: 'ペソ メキシコ', SGD: 'シンガポールドル',
    NZD: 'ニュージーランドドル', RUB: 'ルーブル ロシア', IDR: 'ルピア インドネシア', MYR: 'リンギット マレーシア',
    SEK: 'クローナ スウェーデン', NOK: 'クローネ ノルウェー', DKK: 'クローネ デンマーク', CZK: 'コルナ チェコ',
    PLN: 'ズロチ ポーランド', HUF: 'フォリント ハンガリー', TRY: 'リラ トルコ', ILS: 'シェケル イスラエル', ZAR: 'ランド 南アフリカ',
    m: 'メートル', km_c: 'キロメートル', cm_c: 'センチメートル', mm_c: 'ミリメートル', um_c: 'マイクロメートル', nm_c: 'ナノメートル',
    in: 'インチ', ft: 'フィート', yd: 'ヤード', mi: 'マイル', nmi: '海里', au: '天文単位', ly: '光年', pc: 'パーセク',
    sqm: '平方メートル', sqkm: '平方キロメートル', a: 'アール', ha: 'ヘクタール', acre: 'エーカー', sqft: '平方フィート',
    cum: '立方メートル', L: 'リットル', ml_c: 'ミリリットル', dl_c: 'デシリットル', cucm: '立方センチメートル cc', gal: 'ガロン',
    cup: 'カップ', tsp: '小さじ', tbsp: '大さじ', bbl: 'バレル',
    g: 'グラム', kg_c: 'キログラム', t: 'トン', lb: 'ポンド', oz: 'オンス', carat: 'カラット',
    s: '秒', min: '分', h: '時間', d: '日', week: '週', month: '月', year: '年',
    m_p_s: 'メートル毎秒 秒速', km_p_h: 'キロメートル毎時 時速', mph: 'マイル毎時', knot: 'ノット',
    oC: '摂氏 セルシウス度', oF: '華氏', K: 'ケルビン',
    J: 'ジュール', kJ_c: 'キロジュール', cal: 'カロリー', kcal_c: 'キロカロリー', W_h: 'ワット時', kW_h: 'キロワット時', eV: '電子ボルト',
    W: 'ワット', hp: '馬力', N: 'ニュートン', Pa: 'パスカル', bar: 'バール', atm: '気圧', mmHg: '水銀柱ミリメートル',
    V: 'ボルト', A: 'アンペア', ohm: 'オーム', F: 'ファラド', C: 'クーロン', Hz: 'ヘルツ', T: 'テスラ',
    bit: 'ビット', B: 'バイト', kbyte_c: 'キロバイト', Mbyte_c: 'メガバイト', Gbyte_c: 'ギガバイト', Tbyte_c: 'テラバイト',
    rad: 'ラジアン', deg: '度', gra: 'グラード', rpm: '回転毎分', lx: 'ルクス', lm: 'ルーメン', cd: 'カンデラ', mol: 'モル',
    Bq: 'ベクレル', Sv: 'シーベルト', Gy: 'グレイ', dB: 'デシベル', km_p_l: 'キロメートル毎リットル 燃費', pt: 'ポイント'
  };
  // functions and variables (constants): the first word is shown, all words are found by the search
  const FUNC_JA = {
    solve: '方程式を解く', multisolve: '連立方程式を解く', solve2: '2元連立方程式を解く', dsolve: '微分方程式を解く',
    newtonsolve: 'ニュートン法で解く', secantsolve: '割線法で解く', sum: '総和 シグマ', product: '総乗',
    diff: '微分', integrate: '積分', limit: '極限', extremum: '極値', romberg: '数値積分（ロンバーグ法）',
    sqrt: '平方根 ルート', cbrt: '立方根', root: 'n乗根', sq: '2乗', exp: '指数関数', ln: '自然対数', log: '対数（底を指定）',
    log2: '2を底とする対数', log10: '常用対数', exp2: '2のべき乗', exp10: '10のべき乗',
    sin: '正弦 サイン', cos: '余弦 コサイン', tan: '正接 タンジェント', arcsin: '逆正弦 アークサイン', arccos: '逆余弦 アークコサイン',
    arctan: '逆正接 アークタンジェント', sinh: '双曲線正弦', cosh: '双曲線余弦', tanh: '双曲線正接', arsinh: '逆双曲線正弦',
    arcosh: '逆双曲線余弦', artanh: '逆双曲線正接', atan2: '逆正接（2引数）', sec: '正割', csc: '余割', cot: '余接', sinc: 'sinc関数',
    factorial: '階乗', factorial2: '二重階乗', binomial: '二項係数', perm: '順列', comb: '組合せ', derangements: '完全順列',
    re: '実部', im: '虚部', arg: '偏角', conj: '共役複素数', abs: '絶対値',
    gcd: '最大公約数', lcm: '最小公倍数', divisors: '約数', factor: '因数分解 素因数分解', fibonacci: 'フィボナッチ数',
    totient: 'オイラーのトーシェント関数', bernoulli: 'ベルヌーイ数', digitSum: '各桁の和', sgn: '符号', rem: '余り（剰余）', mod: '剰余（mod）',
    powmod: 'べき剰余', parallel: '並列和（並列抵抗）', numerator: '分子', denominator: '分母', div: '整数の割り算（商）', neg: '符号反転',
    even: '偶数かどうか', odd: '奇数かどうか', isprime: '素数かどうか', primes: '素数の一覧', nextprime: '次の素数', prevprime: '前の素数',
    nthprime: 'n番目の素数', primePi: '素数の個数', round: '四捨五入 丸め', floor: '切り捨て', ceil: '切り上げ', trunc: '0の方向へ切り捨て',
    int: '整数部分', frac: '小数部分', clip: '範囲に収める', base: '進数を指定して読む', bin: '2進数として読む', oct: '8進数として読む',
    dec: '10進数として読む', hex: '16進数として読む', roman: 'ローマ数字として読む', coeff: '係数', degree: '多項式の次数',
    det: '行列式', inv: '逆行列', transpose: '転置行列', identity: '単位行列', rank: '順位', rk: '行列の階数（ランク）', adj: '余因子行列',
    cofactor: '余因子', rref: '行簡約階段形', dot: '内積', cross: '外積', norm: 'ノルム（長さ）', magnitude: '大きさ', vector: 'ベクトルを作る',
    matrix: '行列を作る', rows: '行数', columns: '列数', element: '要素を取り出す', dimension: '要素数', sort: '並べ替え', unique: '重複を除く',
    count: '出現回数', trace: 'トレース（対角成分の和） 跡', permanent: 'パーマネント', kron: 'クロネッカー積', multiply: '要素ごとの積（アダマール積）',
    divide: '要素ごとの商', pow: '要素ごとのべき乗', row: '行を取り出す', column: '列を取り出す', part: '行列の一部を取り出す',
    horzcat: '行列を横につなぐ', vertcat: '行列を縦につなぐ', reshape: '行列の形を変える', triple_product: 'スカラー三重積',
    genvector: 'ベクトルを生成', colon: '等間隔の数のベクトル', entrywise: '要素ごとに関数を適用',
    multilimit: '多変数の極限', Si: '正弦積分', Ci: '余弦積分', Ei: '指数積分', li: '対数積分', erfc: '相補誤差関数',
    digamma: 'ディガンマ関数', igamma: '不完全ガンマ関数（上側）', gammainc: '不完全ガンマ関数（下側）',
    fresnels: 'フレネル積分 S', fresnelc: 'フレネル積分 C',
    total: '合計', mean: '平均', median: '中央値', mode: '最頻値', min: '最小値', max: '最大値', range: '範囲（最大と最小の差）',
    number: 'データの個数', stdev: '標準偏差（標本）', stdevp: '標準偏差（母集団）', var: '分散（標本）', varp: '分散（母集団）',
    stderr: '標準誤差', percentile: 'パーセンタイル', quartile: '四分位数', harmmean: '調和平均', geomean: '幾何平均',
    rms: '二乗平均平方根', cov: '共分散', pearson: '相関係数（ピアソン）', spearman: '順位相関係数（スピアマン）',
    normdist: '正規分布', binomdist: '二項分布', poisson: 'ポアソン分布', tdist: 't分布', chisqdist: 'カイ二乗分布',
    rand: '乱数', randnorm: '正規乱数', randbetween: '整数の乱数（範囲を指定）', linearfit: '直線の当てはめ（回帰）',
    date: '日付を作る', days: '日数の差', weekday: '曜日', week: '週番号', month: '月', day: '日', year: '年', yearday: '年内の通算日',
    timestamp: 'UNIX時刻にする', stamptodate: 'UNIX時刻を日付にする', addDays: '日数を加える', addMonths: '月数を加える', addYears: '年数を加える',
    daysInMonth: 'その月の日数', lunarphase: '月の位相（月齢）',
    pmt: 'ローンの返済額', fv: '将来価値', pv: '現在価値', compound: '複利', rate: '投資の利率', nper: '投資の期間数',
    effect: '実効年利率', nominal: '名目年利率',
    hypot: '斜辺の長さ', circle: '円の面積', circumference: '円周', sphere: '球の体積', sphere_sa: '球の表面積', cylinder: '円柱の体積',
    cone: '円錐の体積', cube: '立方体の体積', rect: '長方形の面積', square: '正方形の面積', triangle: '三角形の面積', trapezoid: '台形の面積',
    pyramid: '角錐の体積',
    gamma: 'ガンマ関数', beta: 'ベータ関数', zeta: 'ゼータ関数', erf: '誤差関数', besselj: 'ベッセル関数（第1種）', lambertw: 'ランベルトのW関数',
    heaviside: 'ヘビサイドの階段関数', dirac: 'ディラックのデルタ関数',
    if: '条件で分ける', for: '繰り返し', xor: 'ビットごとの排他的論理和', shift: 'ビットシフト', bitcmp: 'ビット反転',
    uncertainty: '不確かさ（誤差）', interval: '区間', len: '文字数', char: '文字コードから文字', code: '文字コード', concatenate: '文字列の連結',
    bmi: 'BMI（体格指数）', geodistance: '2地点間の距離（緯度・経度）', save: '変数・関数として保存', nounit: '単位を取り除く'
  };
  const VAR_JA = {
    pi: '円周率 パイ', e: '自然対数の底 ネイピア数', i: '虚数単位', golden: '黄金比', euler: 'オイラーの定数', tau: 'タウ（2π）',
    pythagoras: 'ピタゴラスの定数（√2）', catalan: 'カタランの定数', apery: 'アペリーの定数',
    c: '光速', planck: 'プランク定数', planck2pi: '換算プランク定数（ディラック定数）', newtonian_constant: '万有引力定数',
    standard_gravity: '標準重力加速度', avogadro: 'アボガドロ定数', boltzmann: 'ボルツマン定数', gas_constant: '気体定数',
    faraday: 'ファラデー定数', stefan: 'シュテファン＝ボルツマン定数', elementary_charge: '電気素量', electric_constant: '真空の誘電率',
    magnetic_constant: '真空の透磁率', coulombs_constant: 'クーロン定数', fine_structure: '微細構造定数', rydberg: 'リュードベリ定数',
    bohr_radius: 'ボーア半径', electron_mass: '電子の質量', proton_mass: '陽子の質量', neutron_mass: '中性子の質量',
    atomic_mass_constant: '原子質量定数',
    today: '今日', yesterday: '昨日', tomorrow: '明日', now: '現在の日時',
    ans: '直前の答え', ans2: '2つ前の答え', ans3: '3つ前の答え', ans4: '4つ前の答え', ans5: '5つ前の答え',
    plus_infinity: '正の無限大', minus_infinity: '負の無限大', undefined: '未定義', true: '真', false: '偽',
    percent: 'パーセント（百分率）', permille: 'パーミル（千分率）', ppm: '百万分率', ppb: '十億分率',
    hundred: '百', thousand: '千', million: '百万', billion: '十億', trillion: '一兆', dozen: 'ダース（12）', gross: 'グロス（144）',
    googol: 'グーゴル（10の100乗）', x: '未知数', y: '未知数', z: '未知数', n: '未知数（整数）', precision: '有効桁数'
  };
  function openCatalog(kind, cat) {
    const p = panel('cat-' + kind, CATALOG_TITLE[kind], (p) => {
      const search = el('input', { class: 'search', type: 'search', placeholder: '検索（名前・説明）', autocomplete: 'off' });
      const cats = el('div', { class: 'cats' });
      const count = el('div', { class: 'count' });
      const list = el('div');
      p.body.append(search, cats, count, list);
      p.state = { cat: kind === 'units' ? 'Currency' : '', q: '' };
      const render = () => {
        const items = catalogs[kind] || [];
        const q = p.state.q.trim().toLowerCase();
        const shown = items.filter((it) => (!p.state.cat || it._top === p.state.cat) && (!q || it._q.indexOf(q) >= 0));
        // best matches first: the name itself, then names and titles that start with or contain
        // the words, then what was only found in a description or a category (the sort is stable)
        if (q) {
          const rank = (it) => {
            const name = String(it.name || '').toLowerCase(), abbr = String(it.abbr || '').toLowerCase();
            const title = String(it.title || '').toLowerCase(), ja = it._ja.toLowerCase();
            if (name === q || abbr === q || ja.split(' ').indexOf(q) >= 0) return 0;
            if (name.indexOf(q) === 0 || title.indexOf(q) === 0 || ja.indexOf(q) >= 0) return 1;
            return title.indexOf(q) >= 0 || name.indexOf(q) >= 0 ? 2 : 3;
          };
          const ranks = new Map(shown.map((it) => [it, rank(it)]));
          shown.sort((x, y) => ranks.get(x) - ranks.get(y));
        }
        count.textContent = shown.length + ' 件';
        list.textContent = '';
        const frag = document.createDocumentFragment();
        for (const it of shown.slice(0, 400)) frag.append(catalogRow(kind, it));
        if (shown.length > 400) frag.append(el('div', { class: 'card muted', text: '先頭の 400 件を表示しています。検索で絞り込んでください。' }));
        list.append(frag);
        for (const b of cats.children) {
          const on = b.dataset.cat === p.state.cat;
          b.classList.toggle('on', on);
          // the row of categories scrolls sideways: keep the chosen one in view
          if (on) {
            const cr = cats.getBoundingClientRect(), br = b.getBoundingClientRect();
            if (br.left < cr.left || br.right > cr.right) cats.scrollLeft += br.left - cr.left - (cr.width - br.width) / 2;
          }
        }
      };
      search.addEventListener('input', debounce(() => { p.state.q = search.value; render(); }, 150));
      // show one category from the start (the "ほか…" key of the 解析 and 行列 key pages)
      p.setCategory = (c) => {
        p.state.cat = c; p.state.q = ''; search.value = '';
        p.body.scrollTop = 0;
        if (catalogs[kind]) render();
      };
      const load = () => { list.textContent = ''; list.append(el('div', { class: 'spinner' })); loadCatalog(kind).then(show).catch(failed); };
      const failed = (e) => {
        list.textContent = '';
        list.append(el('div', { class: 'card muted', text: '一覧を読み込めませんでした（' + e.message + '）' }),
          el('button', { class: 'btn primary', text: 'もう一度読み込む', onclick: load }));
      };
      const show = (items) => {
        cats.textContent = '';
        const tops = Array.from(new Set(items.map((i) => i._top))).sort((a, b) => a.localeCompare(b));
        if (p.state.cat && tops.indexOf(p.state.cat) < 0) p.state.cat = '';
        cats.append(el('button', { 'data-cat': '', text: 'すべて', onclick: () => { p.state.cat = ''; render(); } }));
        for (const t of tops) cats.append(el('button', { 'data-cat': t, text: own(CATEGORY_JA, t) || t, onclick: () => { p.state.cat = t; render(); } }));
        render();
      };
      load();
    });
    if (cat) p.setCategory(cat);
    return p;
  }
  function catalogRow(kind, it) {
    const acts = el('div', { class: 'acts' });
    const row = el('div', { class: 'item' }, el('div', { class: 'row1' },
      el('div', { class: 't' }, it.title || it.name, it._ja ? el('span', { class: 'ja', text: it._ja.split(' ')[0] }) : null), acts));
    if (kind === 'functions') {
      row.append(el('div', { class: 'n', text: it.syntax }));
      acts.append(el('button', { class: 'btn primary', text: '挿入', onclick: (e) => { e.stopPropagation(); useItem(it.name + '()', 1); } }));
    } else if (kind === 'units') {
      // "abbr" is the text the engine has checked to be read as this unit (km, km/h, kW·h, $, °C);
      // the internal names of composite units (km_c, km_p_h) are not shown
      const text = it.abbr || it.name;
      const names = it.composite || text === it.name ? text : text + '  (' + it.name + ')';
      row.append(el('div', { class: 'n', text: names + (it.display && it.display !== text ? '  ' + it.display : '') }));
      acts.append(el('button', { class: 'btn', text: '変換', onclick: (e) => { e.stopPropagation(); useItem(' to ' + text, 0); } }));
      if (it.insert !== false) acts.append(el('button', { class: 'btn primary', text: '挿入', onclick: (e) => { e.stopPropagation(); useItem(text, 0); } }));
    } else {
      row.append(el('div', { class: 'n', text: it.name + (it.display && it.display !== it.name ? '  (' + it.display + ')' : '') + (it.value ? '  = ' + it.value : '') }));
      acts.append(el('button', { class: 'btn primary', text: '挿入', onclick: (e) => { e.stopPropagation(); useItem(it.name, 0); } }));
    }
    row.append(el('div', { class: 'c', text: it._cat.split('/').map((c) => own(CATEGORY_JA, c) || c).join(' / ') }));
    if (it.description) row.append(el('div', { class: 'd', text: it.description }));
    row.addEventListener('click', () => row.classList.toggle('expanded'));
    return row;
  }
  function useItem(text, back) {
    while (panelStack.length) closePanel();
    insert(text, back, false);
    focusExpr();
  }

  // -------------------------------------------------------------- plot
  const COLORS = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2'];
  const P = { series: [], view: null, dataX: null, exprs: [] };
  function openPlot() {
    const p = panel('plot', 'グラフ', (p) => {
      // 2D (y = f(x)) and 3D (z = f(x, y)); the last one used is shown
      const b2 = el('button', { text: '2D　y = f(x)' }), b3 = el('button', { text: '3D　z = f(x, y)' });
      const f2 = el('div', { class: 'plot-mode' }), f3 = build3d();
      let started2d = false;
      const setMode = (m) => {
        store.set('qalc.plot.mode', m);
        b2.classList.toggle('on', m === '2d'); b3.classList.toggle('on', m === '3d');
        b2.setAttribute('aria-pressed', String(m === '2d')); b3.setAttribute('aria-pressed', String(m === '3d'));
        f2.hidden = m !== '2d'; f3.hidden = m !== '3d';
        if (m === '3d') { Q3.start(); return; }
        if (started2d) { draw(); return; }
        started2d = true;
        if (store.get('qalc.plot.ok', true)) setTimeout(() => compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value)), 260);
        else msg.textContent = '「描画」を押すとグラフを描きます';
      };
      b2.addEventListener('click', () => setMode('2d'));
      b3.addEventListener('click', () => setMode('3d'));
      const ta = el('textarea', { rows: 2, placeholder: '関数（1行に1つ、変数は x）', spellcheck: 'false', autocapitalize: 'off' });
      ta.value = store.get('qalc.plot.exprs', 'sin(x)\nx^2/10');
      const xmin = el('input', { value: store.get('qalc.plot.min', '-10'), inputmode: 'text', autocapitalize: 'off' });
      const xmax = el('input', { value: store.get('qalc.plot.max', '10'), inputmode: 'text', autocapitalize: 'off' });
      const go = el('button', { class: 'btn primary', text: '描画' });
      const canvas = el('canvas', { role: 'img', 'aria-label': '2D グラフ' });
      const tip = el('div', { class: 'plot-tip', 'aria-live': 'polite' });
      const ctl = el('div', { class: 'plot-ctl' },
        el('button', { text: '＋', 'aria-label': '拡大', onclick: () => zoom(0.5) }),
        el('button', { text: '－', 'aria-label': '縮小', onclick: () => zoom(2) }),
        el('button', { text: '⟲', 'aria-label': '入力した範囲に戻す', onclick: () => {
          P.view = null; P.mark = null; P.tip.style.display = 'none';
          compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value));
        } }));
      const wrap = el('div', { class: 'plot-wrap' }, canvas, ctl, tip);
      const legend = el('div', { class: 'legend' });
      const msg = el('div', { class: 'form-hint' });
      f2.append(el('div', { class: 'plot-form' }, ta,
        el('div', { class: 'plot-range' }, el('span', { text: 'x：' }), xmin, el('span', { text: '〜' }), xmax, go)),
      wrap, legend, msg,
      el('div', { class: 'form-hint', text: 'ドラッグで移動、2本指で拡大・縮小、タップで座標を表示します。式に使える関数は計算画面と同じです。' }));
      p.body.append(el('div', { class: 'seg', role: 'group', 'aria-label': 'グラフの種類' }, b2, b3), f2, f3);
      P.canvas = canvas; P.tip = tip; P.legend = legend; P.msg = msg; P.wrap = wrap;
      go.addEventListener('click', () => {
        store.set('qalc.plot.exprs', ta.value); store.set('qalc.plot.min', xmin.value); store.set('qalc.plot.max', xmax.value);
        document.activeElement && document.activeElement.blur();
        P.exprs = ta.value.split('\n').map(normalizeExpr).filter(Boolean).slice(0, 6);
        P.view = null;
        P.mark = null; P.tip.style.display = 'none'; // the point that was tapped belongs to the graph before
        compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value));
      });
      setupPlotGestures(wrap);
      window.addEventListener('resize', debounce(() => { draw(); draw3d(); }, 120));
      P.exprs = ta.value.split('\n').map(normalizeExpr).filter(Boolean).slice(0, 6);
      setMode(store.get('qalc.plot.mode', '2d') === '3d' ? '3d' : '2d');
    });
    return p;
  }
  async function compute(min, max, keepView) {
    if (!P.exprs.length) return;
    P.msg.textContent = '計算中…';
    const r = await Bridge.send('plot', { exprs: P.exprs, min: String(min), max: String(max), steps: 600, var: 'x', opts: engineOpts(), timeout: 12000 });
    if (!r.ok) { P.msg.textContent = r.error === 'invalid range' ? 'x の範囲を確認してください' : (r.error || 'グラフを計算できませんでした'); return; }
    if (!Array.isArray(r.series)) { P.msg.textContent = '時間がかかりすぎたため計算を中止しました'; return; }
    P.series = r.series.map((s, i) => ({ expr: P.exprs[i], x: s.x, y: s.y, color: COLORS[i % COLORS.length] }));
    const err = (r.messages || []).find((m) => m.type === 'error');
    P.msg.textContent = err ? jaMessage(err.text) : '';
    let x0 = Infinity, x1 = -Infinity;
    for (const s of P.series) for (const x of s.x) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    P.dataX = isFinite(x0) ? [x0, x1] : null;
    if (!keepView) P.view = null;
    P.legend.textContent = '';
    for (const s of P.series) P.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.y.some((v) => v !== null) ? '' : '（値なし）') }));
    store.set('qalc.plot.ok', false);
    draw();
    store.set('qalc.plot.ok', true);
  }
  function autoView() {
    if (!P.dataX) return { x0: -10, x1: 10, y0: -10, y1: 10 };
    const ys = [];
    for (const s of P.series) for (const y of s.y) if (y !== null && isFinite(y)) ys.push(y);
    ys.sort((a, b) => a - b);
    let y0 = -1, y1 = 1;
    if (ys.length) {
      y0 = ys[Math.floor(ys.length * 0.02)];
      y1 = ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.98))];
      if (ys.length < 50) { y0 = ys[0]; y1 = ys[ys.length - 1]; }
      const eps = Math.max(Math.abs(y0), Math.abs(y1)) * 1e-9 || 1;
      if (y1 - y0 < eps) { y0 -= eps; y1 += eps; }
      const m = (y1 - y0) * 0.08;
      y0 -= m; y1 += m;
    }
    return { x0: P.dataX[0], x1: P.dataX[1], y0, y1 };
  }
  function niceStep(range, n) {
    const raw = range / n;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  // numbers sent to the engine: all digits ("e" would be Euler's number in some positions)
  function engineNum(v) {
    return String(v).replace('e', 'E');
  }
  // axis label: as many digits as needed to tell neighbouring grid lines apart
  function fmt(v, step) {
    if (Math.abs(v) < step * 1e-9) return '0';
    const a = Math.abs(v);
    if (a >= 1e-4 && a < 1e6) return v.toFixed(Math.max(0, Math.min(10, Math.ceil(-Math.log10(step) - 1e-9))));
    const d = Math.max(1, Math.min(15, Math.floor(Math.log10(a)) - Math.floor(Math.log10(step)) + 1));
    return v.toPrecision(d).replace(/e\+?/, 'E');
  }
  // grid positions between a and b; nothing when the step is too small for the numbers
  // (adding the step would no longer change the value, and a loop would never end)
  function gridValues(a, b, step, max) {
    if (!(step > 0) || !isFinite(a) || !isFinite(b)) return [];
    const i0 = Math.ceil(a / step), n = Math.floor(b / step) - i0;
    if (!(n >= 0 && n <= (max || 400)) || Math.abs(i0) > 2 ** 52) return [];
    const out = [];
    for (let k = 0; k <= n; k++) out.push((i0 + k) * step);
    return out;
  }
  // a view must stay wider than what double-precision numbers can tell apart
  function viewOk(v) {
    const okAxis = (lo, hi) => isFinite(lo) && isFinite(hi) && hi - lo > Math.max(Math.abs(lo), Math.abs(hi)) * 1e-12 && hi - lo < 1e300;
    return okAxis(v.x0, v.x1) && okAxis(v.y0, v.y1);
  }
  function draw() {
    const c = P.canvas;
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--plot-bg').trim() || '#fff';
    g.fillRect(0, 0, W, H);
    if (!P.series.length) return;
    if (!P.view) P.view = autoView();
    const v = P.view;
    const sx = (x) => (x - v.x0) / (v.x1 - v.x0) * W;
    const sy = (y) => H - (y - v.y0) / (v.y1 - v.y0) * H;
    const stepX = niceStep(v.x1 - v.x0, Math.max(3, Math.round(W / 90)));
    const stepY = niceStep(v.y1 - v.y0, Math.max(3, Math.round(H / 70)));
    g.lineWidth = 1;
    g.strokeStyle = css.getPropertyValue('--plot-grid').trim();
    g.beginPath();
    const gx = gridValues(v.x0, v.x1, stepX), gy = gridValues(v.y0, v.y1, stepY);
    for (const x of gx) { const px = Math.round(sx(x)) + .5; g.moveTo(px, 0); g.lineTo(px, H); }
    for (const y of gy) { const py = Math.round(sy(y)) + .5; g.moveTo(0, py); g.lineTo(W, py); }
    g.stroke();
    const axisColor = css.getPropertyValue('--plot-axis').trim();
    const ax = Math.min(Math.max(sx(0), 0), W), ay = Math.min(Math.max(sy(0), 0), H);
    g.strokeStyle = axisColor;
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, ay); g.lineTo(W, ay); g.moveTo(ax, 0); g.lineTo(ax, H); g.stroke();
    g.fillStyle = axisColor;
    g.font = '12px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const x of gx) {
      if (Math.abs(x) < stepX * 1e-9) continue;
      const label = fmt(x, stepX), px = sx(x), half = g.measureText(label).width / 2;
      if (px - half < 2 || px + half > W - 2) continue;
      const ty = Math.min(Math.max(ay + 4, 2), H - 16);
      g.fillText(label, px, ty);
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const y of gy) {
      if (Math.abs(y) < stepY * 1e-9) continue;
      const py = sy(y);
      if (py < 8 || py > H - 8) continue;
      const tx = Math.min(Math.max(ax + 4, 2), W - 40);
      g.fillText(fmt(y, stepY), tx, py);
    }
    g.lineWidth = 2.2;
    g.lineJoin = 'round';
    for (const s of P.series) {
      g.strokeStyle = s.color;
      g.beginPath();
      let pen = false, lastPy = 0;
      for (let i = 0; i < s.x.length; i++) {
        const y = s.y[i];
        if (y === null || !isFinite(y)) { pen = false; continue; }
        const px = sx(s.x[i]), py = sy(y);
        if (pen && Math.abs(py - lastPy) > H * 1.5) pen = false;
        const cy = Math.max(-H, Math.min(2 * H, py));
        if (pen) g.lineTo(px, cy); else g.moveTo(px, cy);
        pen = true;
        lastPy = py;
      }
      g.stroke();
    }
    if (P.mark) {
      g.fillStyle = P.mark.color;
      g.beginPath(); g.arc(sx(P.mark.x), sy(P.mark.y), 4.5, 0, Math.PI * 2); g.fill();
    }
  }
  function zoom(f, cx, cy) {
    if (!P.view) return;
    const v = P.view;
    const mx = cx !== undefined ? cx : (v.x0 + v.x1) / 2, my = cy !== undefined ? cy : (v.y0 + v.y1) / 2;
    const nv = { x0: mx + (v.x0 - mx) * f, x1: mx + (v.x1 - mx) * f, y0: my + (v.y0 - my) * f, y1: my + (v.y1 - my) * f };
    if (!viewOk(nv)) { toast('これ以上は拡大・縮小できません', 1400); return; }
    P.view = nv;
    P.mark = null; P.tip.style.display = 'none';
    draw();
    refetchIfNeeded();
  }
  const refetchIfNeeded = debounce(() => {
    if (!P.view || !P.dataX) return;
    const v = P.view, d = P.dataX;
    const w = v.x1 - v.x0;
    if (v.x0 < d[0] - w * 0.05 || v.x1 > d[1] + w * 0.05 || w < (d[1] - d[0]) / 6) {
      const pad = w * 0.5;
      compute(engineNum(v.x0 - pad), engineNum(v.x1 + pad), true);
    }
  }, 350);
  function setupPlotGestures(wrap) {
    const pts = new Map();
    let start = null, moved = false;
    const toData = (cx, cy) => {
      const r = P.canvas.getBoundingClientRect(), v = P.view;
      return { x: v.x0 + (cx - r.left) / r.width * (v.x1 - v.x0), y: v.y1 - (cy - r.top) / r.height * (v.y1 - v.y0) };
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || !P.view) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { view: Object.assign({}, P.view), pts: new Map(Array.from(pts, ([k, p]) => [k, Object.assign({}, p)])) };
      moved = false;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = P.canvas.getBoundingClientRect(), v0 = start.view;
      const ids = Array.from(pts.keys());
      if (ids.length === 1) {
        const p0 = start.pts.get(ids[0]), p1 = pts.get(ids[0]);
        if (!p0) return;
        const dx = (p1.x - p0.x) / r.width * (v0.x1 - v0.x0), dy = (p1.y - p0.y) / r.height * (v0.y1 - v0.y0);
        if (Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y) > 6) moved = true;
        const nv = { x0: v0.x0 - dx, x1: v0.x1 - dx, y0: v0.y0 + dy, y1: v0.y1 + dy };
        if (viewOk(nv)) P.view = nv;
      } else if (ids.length >= 2) {
        const a0 = start.pts.get(ids[0]), b0 = start.pts.get(ids[1]), a1 = pts.get(ids[0]), b1 = pts.get(ids[1]);
        if (!a0 || !b0) return;
        moved = true;
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        if (d0 < 10 || d1 < 10) return;
        const f = d0 / d1;
        const cx = (a0.x + b0.x) / 2, cy = (a0.y + b0.y) / 2;
        const mx = v0.x0 + (cx - r.left) / r.width * (v0.x1 - v0.x0), my = v0.y1 - (cy - r.top) / r.height * (v0.y1 - v0.y0);
        const nv = { x0: mx + (v0.x0 - mx) * f, x1: mx + (v0.x1 - mx) * f, y0: my + (v0.y0 - my) * f, y1: my + (v0.y1 - my) * f };
        if (viewOk(nv)) P.view = nv;
      }
      P.mark = null; P.tip.style.display = 'none';
      draw();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!moved && pts.size === 0 && P.view && e.type === 'pointerup') showPoint(toData(e.clientX, e.clientY));
      if (pts.size) start = { view: Object.assign({}, P.view), pts: new Map(Array.from(pts, ([k, p]) => [k, Object.assign({}, p)])) };
      else { start = null; if (moved) refetchIfNeeded(); }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }
  function showPoint(d) {
    let best = null;
    for (const s of P.series) {
      for (let i = 0; i < s.x.length; i++) {
        const y = s.y[i];
        if (y === null) continue;
        const dx = (s.x[i] - d.x) / (P.view.x1 - P.view.x0), dy = (y - d.y) / (P.view.y1 - P.view.y0);
        const dist = dx * dx + dy * dy;
        if (!best || dist < best.dist) best = { dist, x: s.x[i], y, color: s.color, expr: s.expr };
      }
    }
    if (!best || best.dist > 0.02) { P.mark = null; P.tip.style.display = 'none'; draw(); return; }
    P.mark = best;
    P.tip.textContent = best.expr + '：x = ' + Number(best.x.toPrecision(10)) + ', y = ' + Number(best.y.toPrecision(10));
    P.tip.style.display = 'block';
    draw();
  }

  // ----------------------------------------------------------- 3D plot
  // z = f(x, y). The engine computes the values on a grid (plot3d); the page draws the surface
  // back to front (painter's algorithm) on a 2D canvas, so no WebGL is needed.
  // Coordinates: the box is u, v in [-1, 1] (x, y) and w in [-ZS, ZS] (z).
  const ZS = 0.72;
  const VIEW3D = { az: -0.62, el: 0.52, zoom: 1 };
  const Q3 = Object.assign({ exprs: [], range: [], res: 41, data: null, mark: null, raf: 0, started: false }, VIEW3D);
  const VIRIDIS = [[68, 1, 84], [65, 68, 135], [42, 120, 142], [34, 168, 132], [122, 209, 81], [253, 231, 37]];
  function viridis(t) {
    t = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
    const i = Math.min(VIRIDIS.length - 2, Math.floor(t)), f = t - i, a = VIRIDIS[i], b = VIRIDIS[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function build3d() {
    const ta = el('textarea', { rows: 2, placeholder: '関数（1行に1つ、最大4つ。変数は x と y）', spellcheck: 'false', autocapitalize: 'off' });
    ta.value = store.get('qalc.plot3d.exprs', 'sin(x) cos(y)');
    const input = (key, def) => el('input', { value: store.get(key, def), inputmode: 'text', autocapitalize: 'off' });
    const xmin = input('qalc.plot3d.xmin', '-5'), xmax = input('qalc.plot3d.xmax', '5');
    const ymin = input('qalc.plot3d.ymin', '-5'), ymax = input('qalc.plot3d.ymax', '5');
    const res = el('select', { 'aria-label': '細かさ' },
      el('option', { value: '25', text: '粗い（25×25）' }), el('option', { value: '41', text: '標準（41×41）' }), el('option', { value: '61', text: '細かい（61×61）' }));
    res.value = String(store.get('qalc.plot3d.res', '41'));
    if (!res.value) res.value = '41';
    const go = el('button', { class: 'btn primary', text: '描画' });
    const canvas = el('canvas', { role: 'img', 'aria-label': '3D グラフ' });
    const tip = el('div', { class: 'plot-tip', 'aria-live': 'polite' });
    const ctl = el('div', { class: 'plot-ctl' },
      el('button', { text: '＋', 'aria-label': '拡大', onclick: () => zoom3d(1.25) }),
      el('button', { text: '－', 'aria-label': '縮小', onclick: () => zoom3d(0.8) }),
      el('button', { text: '⟲', 'aria-label': '向きと大きさを戻す', onclick: () => { Object.assign(Q3, VIEW3D); clearMark3d(); draw3d(); } }));
    const wrap = el('div', { class: 'plot-wrap' }, canvas, ctl, tip);
    const legend = el('div', { class: 'legend' });
    const msg = el('div', { class: 'form-hint' });
    Object.assign(Q3, { canvas, tip, legend, msg });
    const read = () => {
      Q3.exprs = ta.value.split('\n').map(normalizeExpr).filter(Boolean).slice(0, 4);
      Q3.range = [xmin, xmax, ymin, ymax].map((e) => normalizeExpr(e.value));
      Q3.res = Number(res.value) || 41;
    };
    go.addEventListener('click', () => {
      store.set('qalc.plot3d.exprs', ta.value); store.set('qalc.plot3d.res', res.value);
      store.set('qalc.plot3d.xmin', xmin.value); store.set('qalc.plot3d.xmax', xmax.value);
      store.set('qalc.plot3d.ymin', ymin.value); store.set('qalc.plot3d.ymax', ymax.value);
      document.activeElement && document.activeElement.blur();
      read();
      compute3d();
    });
    setup3dGestures(wrap);
    Q3.start = () => {
      if (Q3.started) { draw3d(); return; }
      Q3.started = true;
      read();
      if (store.get('qalc.plot3d.ok', true)) setTimeout(compute3d, 260);
      else msg.textContent = '「描画」を押すとグラフを描きます';
    };
    return el('div', { class: 'plot-mode' },
      el('div', { class: 'plot-form' }, ta,
        el('div', { class: 'ranges3d' },
          el('div', { class: 'plot-range' }, el('span', { text: 'x：' }), xmin, el('span', { text: '〜' }), xmax),
          el('div', { class: 'plot-range' }, el('span', { text: 'y：' }), ymin, el('span', { text: '〜' }), ymax)),
        el('div', { class: 'plot-range' }, el('span', { text: '細かさ：' }), res, go)),
      wrap, legend, msg,
      el('div', { class: 'form-hint', text: 'ドラッグで回転、2本指で拡大・縮小、タップで座標を表示します。z の範囲は自動で決まります（極端に大きな値の部分は描きません）。' }));
  }
  // the z range: all values, or without the extreme ones when a few values are huge (poles)
  function zRange3d(vals) {
    if (!vals.length) return [-1, 1];
    vals.sort((a, b) => a - b);
    let lo = vals[0], hi = vals[vals.length - 1];
    if (vals.length >= 50) {
      const plo = vals[Math.floor(vals.length * 0.01)], phi = vals[Math.ceil(vals.length * 0.99) - 1];
      if (phi > plo && hi - lo > 3 * (phi - plo)) { const m = (phi - plo) * 0.15; lo = Math.max(lo, plo - m); hi = Math.min(hi, phi + m); }
    }
    if (!(hi - lo > Math.max(Math.abs(lo), Math.abs(hi)) * 1e-9)) { const d = Math.abs(lo) * 0.5 || 1; lo -= d; hi += d; }
    return [lo, hi];
  }
  async function compute3d() {
    if (!Q3.exprs.length) { Q3.msg.textContent = '関数を入力してください'; return; }
    Q3.msg.textContent = '計算中…';
    const [x0, x1, y0, y1] = Q3.range;
    const r = await Bridge.send('plot3d', { exprs: Q3.exprs, xmin: x0 || '-5', xmax: x1 || '5', ymin: y0 || '-5', ymax: y1 || '5', nx: Q3.res, ny: Q3.res, opts: engineOpts(), timeout: 15000 });
    if (!r.ok) {
      Q3.msg.textContent = r.error === 'invalid x range' ? 'x の範囲を確認してください' : r.error === 'invalid y range' ? 'y の範囲を確認してください' : (r.error || 'グラフを計算できませんでした');
      return;
    }
    if (!Array.isArray(r.series) || !Array.isArray(r.x) || !Array.isArray(r.y)) { Q3.msg.textContent = '時間がかかりすぎたため計算を中止しました'; return; }
    const nx = r.x.length, ny = r.y.length, vals = [];
    const series = r.series.map((s, i) => {
      const z = new Float64Array(nx * ny);
      for (let k = 0; k < z.length; k++) {
        const v = s.z[k];
        z[k] = typeof v === 'number' && isFinite(v) ? v : NaN;
        if (z[k] === z[k]) vals.push(z[k]);
      }
      const color = COLORS[i % COLORS.length];
      return { expr: Q3.exprs[i], z, complete: s.complete !== false, color, rgb: hexRgb(color) };
    });
    const [z0, z1] = zRange3d(vals);
    Q3.data = { xs: r.x, ys: r.y, nx, ny, series, z0, z1 };
    clearMark3d();
    const err = (r.messages || []).find((m) => m.type === 'error');
    Q3.msg.textContent = err ? jaMessage(err.text)
      : series.some((s) => !s.complete) ? '時間がかかりすぎたため、途中までしか計算できませんでした'
      : vals.length ? '' : '実数の値がありません（x と y の範囲を確認してください）';
    Q3.legend.textContent = '';
    if (series.length === 1 && vals.length) {
      const step = niceStep(z1 - z0, 4);
      Q3.legend.append(el('span', { class: 'zbar' }, series[0].expr + '　z：' + fmt(z0, step / 10), el('i'), fmt(z1, step / 10)));
    } else {
      for (const s of series) Q3.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.z.some((v) => v === v) ? '' : '（値なし）') }));
    }
    store.set('qalc.plot3d.ok', false);
    draw3d();
    store.set('qalc.plot3d.ok', true);
  }
  function clearMark3d() { Q3.mark = null; if (Q3.tip) Q3.tip.style.display = 'none'; }
  function zoom3d(f) { Q3.zoom = Math.max(0.4, Math.min(6, Q3.zoom * f)); clearMark3d(); draw3d(); }
  function requestDraw3d() { if (!Q3.raf) Q3.raf = requestAnimationFrame(() => { Q3.raf = 0; draw3d(); }); }
  function draw3d() {
    const c = Q3.canvas;
    if (!c || !c.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--plot-bg').trim() || '#fff';
    g.fillRect(0, 0, W, H);
    const D = Q3.data;
    if (!D) return;
    const dark = document.documentElement.classList.contains('dark');
    const gridColor = css.getPropertyValue('--plot-grid').trim(), axisColor = css.getPropertyValue('--plot-axis').trim();
    const ca = Math.cos(Q3.az), sa = Math.sin(Q3.az), ce = Math.cos(Q3.el), se = Math.sin(Q3.el);
    const S = Math.min(W / 3.3, H / (2 * (ZS * Math.abs(ce) + 1.42 * Math.abs(se)) + 0.75)) * Q3.zoom;
    const cx = W / 2, cy = H / 2;
    // (u, v, w) -> screen x, screen y and depth (larger is farther away)
    const T = [0, 0, 0];
    const proj = (u, v, w) => {
      const xr = u * ca - v * sa, yr = u * sa + v * ca;
      T[0] = cx + xr * S; T[1] = cy - (w * ce + yr * se) * S; T[2] = yr * ce - w * se;
      return T;
    };
    const xs = D.xs, ys = D.ys, x0 = xs[0], x1 = xs[D.nx - 1], y0 = ys[0], y1 = ys[D.ny - 1], z0 = D.z0, z1 = D.z1;
    const U = (x) => (x - x0) / (x1 - x0) * 2 - 1, V = (y) => (y - y0) / (y1 - y0) * 2 - 1, Wz = (z) => ((z - z0) / (z1 - z0) * 2 - 1) * ZS;
    const line = (u1, v1, w1, u2, v2, w2) => { proj(u1, v1, w1); g.moveTo(T[0], T[1]); proj(u2, v2, w2); g.lineTo(T[0], T[1]); };
    // the three panes at the back of the box, with grid lines
    const ub = proj(1, 0, 0)[2] > proj(-1, 0, 0)[2] ? 1 : -1;
    const vb = proj(0, 1, 0)[2] > proj(0, -1, 0)[2] ? 1 : -1;
    const wb = proj(0, 0, ZS)[2] > proj(0, 0, -ZS)[2] ? ZS : -ZS;
    const stx = niceStep(x1 - x0, 4), sty = niceStep(y1 - y0, 4), stz = niceStep(z1 - z0, 4);
    const gx = gridValues(x0, x1, stx, 40), gy = gridValues(y0, y1, sty, 40), gz = gridValues(z0, z1, stz, 40);
    const pane = (corners) => { g.beginPath(); corners.forEach(([u, v, w], i) => { proj(u, v, w); if (i) g.lineTo(T[0], T[1]); else g.moveTo(T[0], T[1]); }); g.closePath(); g.fill(); g.stroke(); };
    g.fillStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(30,50,90,0.035)';
    g.strokeStyle = axisColor; g.lineWidth = 1;
    pane([[-1, -1, wb], [1, -1, wb], [1, 1, wb], [-1, 1, wb]]);
    pane([[ub, -1, -ZS], [ub, 1, -ZS], [ub, 1, ZS], [ub, -1, ZS]]);
    pane([[-1, vb, -ZS], [1, vb, -ZS], [1, vb, ZS], [-1, vb, ZS]]);
    g.strokeStyle = gridColor; g.beginPath();
    for (const x of gx) { line(U(x), -1, wb, U(x), 1, wb); line(U(x), vb, -ZS, U(x), vb, ZS); }
    for (const y of gy) { line(-1, V(y), wb, 1, V(y), wb); line(ub, V(y), -ZS, ub, V(y), ZS); }
    for (const z of gz) { line(ub, -1, Wz(z), ub, 1, Wz(z)); line(-1, vb, Wz(z), 1, vb, Wz(z)); }
    g.stroke();
    // the surfaces: project every grid point once, then draw the cells from back to front
    const cells = [];
    const L = [-0.42, 0.62, -0.66];  // light from the upper left, in front
    for (const s of D.series) {
      const n = D.nx * D.ny;
      if (!s.proj || s.proj.st.length !== n) s.proj = { px: new Float32Array(n), py: new Float32Array(n), pd: new Float32Array(n), pw: new Float32Array(n), st: new Uint8Array(n) };
      const { px, py, pd, pw, st } = s.proj;
      st.fill(0);
      for (let j = 0; j < D.ny; j++) {
        const v = V(ys[j]);
        for (let i = 0; i < D.nx; i++) {
          const k = j * D.nx + i, z = s.z[k];
          if (z !== z) continue;
          const w = Wz(z);
          if (w > ZS * 1.0001 || w < -ZS * 1.0001) { st[k] = 2; continue; }  // outside the z range
          proj(U(xs[i]), v, w);
          px[k] = T[0]; py[k] = T[1]; pd[k] = T[2]; pw[k] = w; st[k] = 1;
        }
      }
      for (let j = 0; j < D.ny - 1; j++) {
        const dv = V(ys[j + 1]) - V(ys[j]);
        for (let i = 0; i < D.nx - 1; i++) {
          const a = j * D.nx + i, b = a + 1, c2 = a + D.nx + 1, d = a + D.nx;
          if (st[a] !== 1 || st[b] !== 1 || st[c2] !== 1 || st[d] !== 1) continue;
          // normal from the diagonals (a -> c2) x (b -> d), in camera space, for the shading
          const du = U(xs[i + 1]) - U(xs[i]), dw1 = pw[c2] - pw[a], dw2 = pw[d] - pw[b];
          const nu = dv * dw2 - dw1 * dv, nv = dw1 * -du - du * dw2, nw = du * dv + dv * du;
          const yr = nu * sa + nv * ca;
          const ncx = nu * ca - nv * sa, ncy = nw * ce + yr * se, ncd = yr * ce - nw * se;
          const len = Math.hypot(ncx, ncy, ncd) || 1;
          const shade = Math.abs(ncx * L[0] + ncy * L[1] + ncd * L[2]) / len;
          cells.push({ s, a, b, c: c2, d, depth: pd[a] + pd[b] + pd[c2] + pd[d], shade, t: ((pw[a] + pw[b] + pw[c2] + pw[d]) / (4 * ZS) + 1) / 2 });
        }
      }
    }
    cells.sort((p, q) => q.depth - p.depth);
    const single = D.series.length === 1, mesh = D.nx <= 45;
    const meshColor = dark ? 'rgba(0,0,0,0.35)' : 'rgba(20,30,50,0.22)';
    g.lineJoin = 'round';
    for (const q of cells) {
      const pr = q.s.proj, rgb = single ? viridis(q.t) : q.s.rgb;
      const k = single ? 0.5 + 0.5 * q.shade : 0.42 + 0.58 * q.shade;
      const col = 'rgb(' + Math.round(rgb[0] * k) + ',' + Math.round(rgb[1] * k) + ',' + Math.round(rgb[2] * k) + ')';
      g.beginPath();
      g.moveTo(pr.px[q.a], pr.py[q.a]); g.lineTo(pr.px[q.b], pr.py[q.b]); g.lineTo(pr.px[q.c], pr.py[q.c]); g.lineTo(pr.px[q.d], pr.py[q.d]);
      g.closePath();
      g.fillStyle = col; g.fill();
      g.lineWidth = 0.7; g.strokeStyle = mesh ? meshColor : col; g.stroke();
    }
    // axes on the front edges of the floor and the leftmost vertical edge, with labels
    const un = -ub, vn = -vb;
    let ze = null;
    for (const [eu, ev] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { proj(eu, ev, 0); if (!ze || T[0] < ze.x) ze = { u: eu, v: ev, x: T[0] }; }
    g.strokeStyle = axisColor; g.lineWidth = 1.2; g.beginPath();
    line(-1, vn, wb, 1, vn, wb); line(un, -1, wb, un, 1, wb); line(ze.u, ze.v, -ZS, ze.u, ze.v, ZS);
    g.stroke();
    g.fillStyle = axisColor; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const x of gx) { proj(U(x), vn * 1.17, wb); g.fillText(fmt(x, stx), T[0], T[1]); }
    for (const y of gy) { proj(un * 1.17, V(y), wb); g.fillText(fmt(y, sty), T[0], T[1]); }
    g.textAlign = 'right';
    for (const z of gz) {
      if (Math.abs(Wz(z) - wb) < 0.1) continue;  // at the floor the x or y labels are there
      proj(ze.u, ze.v, Wz(z)); g.fillText(fmt(z, stz), T[0] - 7, T[1]);
    }
    g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
    proj(0, vn * 1.4, wb); g.fillText('x', T[0], T[1]);
    proj(un * 1.4, 0, wb); g.fillText('y', T[0], T[1]);
    proj(ze.u, ze.v, ZS); g.fillText('z', T[0], T[1] - 14);
    if (Q3.mark) {
      const pr = Q3.mark.s.proj;
      g.fillStyle = '#e11d48'; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(pr.px[Q3.mark.k], pr.py[Q3.mark.k], 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  // tap: the grid point nearest to the finger; among close ones, the one in front
  function pick3d(clientX, clientY) {
    const D = Q3.data;
    if (!D) return;
    const r = Q3.canvas.getBoundingClientRect(), mx = clientX - r.left, my = clientY - r.top;
    let best = null;
    for (const s of D.series) {
      const pr = s.proj;
      if (!pr) continue;
      for (let k = 0; k < pr.st.length; k++) {
        if (pr.st[k] !== 1) continue;
        const dx = pr.px[k] - mx, dy = pr.py[k] - my, d2 = dx * dx + dy * dy;
        if (d2 > 400) continue;
        if (!best || pr.pd[k] < best.depth - 0.05 || (Math.abs(pr.pd[k] - best.depth) <= 0.05 && d2 < best.d2)) best = { s, k, d2, depth: pr.pd[k] };
      }
    }
    if (!best) { clearMark3d(); draw3d(); return; }
    Q3.mark = best;
    const i = best.k % D.nx, j = Math.floor(best.k / D.nx), num = (v) => Number(v.toPrecision(10));
    Q3.tip.textContent = best.s.expr + '：x = ' + num(D.xs[i]) + ', y = ' + num(D.ys[j]) + ', z = ' + num(best.s.z[best.k]);
    Q3.tip.style.display = 'block';
    draw3d();
  }
  function setup3dGestures(wrap) {
    const pts = new Map();
    let start = null, moved = false;
    const snapshot = () => ({ az: Q3.az, el: Q3.el, zoom: Q3.zoom, pts: new Map(Array.from(pts, ([k, p]) => [k, Object.assign({}, p)])) });
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || !Q3.data) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = snapshot();
      if (pts.size > 1) moved = true; else moved = false;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const ids = Array.from(pts.keys());
      if (ids.length === 1) {
        const p0 = start.pts.get(ids[0]), p1 = pts.get(ids[0]);
        if (!p0) return;
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) <= 6) return;
        moved = true;
        Q3.az = start.az + dx * 0.01;
        Q3.el = Math.max(-1.5, Math.min(1.5, start.el + dy * 0.01));
      } else {
        const a0 = start.pts.get(ids[0]), b0 = start.pts.get(ids[1]), a1 = pts.get(ids[0]), b1 = pts.get(ids[1]);
        if (!a0 || !b0) return;
        const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
        if (d0 < 10 || d1 < 10) return;
        Q3.zoom = Math.max(0.4, Math.min(6, start.zoom * d1 / d0));
      }
      clearMark3d();
      requestDraw3d();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!moved && pts.size === 0 && e.type === 'pointerup') pick3d(e.clientX, e.clientY);
      start = pts.size ? snapshot() : null;
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  // ----------------------------------------------------- user definitions
  function openDefs() {
    const p = panel('defs', 'ユーザー定義の変数・関数', (p) => {
      const list = el('div');
      const vName = el('input', { placeholder: '例：r', autocapitalize: 'off' });
      const vVal = el('input', { placeholder: '例：5 cm、2*pi', autocapitalize: 'off' });
      const fName = el('input', { placeholder: '例：hyp', autocapitalize: 'off' });
      const fExpr = el('input', { placeholder: '例：pi*x^2（引数は x, y, z）', autocapitalize: 'off' });
      const addVar = el('button', { class: 'btn primary', text: '変数を保存' });
      const addFn = el('button', { class: 'btn primary', text: '関数を保存' });
      p.body.append(
        el('div', { class: 'section-title', text: '保存済み' }), list,
        el('div', { class: 'section-title', text: '変数を追加・変更' }),
        el('div', { class: 'form-row' }, el('label', { text: '名前' }), vName),
        el('div', { class: 'form-row' }, el('label', { text: '値（式も可）' }), vVal), addVar,
        el('div', { class: 'section-title', text: '関数を追加・変更' }),
        el('div', { class: 'form-row' }, el('label', { text: '名前' }), fName),
        el('div', { class: 'form-row' }, el('label', { text: '式' }), fExpr,
          el('div', { class: 'form-hint', text: '引数は x, y, z で書きます。例：「hyp」に sqrt(x^2 + y^2) を保存すると hyp(3, 4) = 5。' })), addFn);
      const refresh = async () => {
        list.textContent = '';
        const r = await Bridge.send('user_defs');
        if (!r.ok) { list.textContent = r.error; return; }
        if (!r.variables.length && !r.functions.length) list.append(el('div', { class: 'card muted', text: 'まだありません。' }));
        const row = (kind, name, body) => el('div', { class: 'item' }, el('div', { class: 'row1' },
          el('div', { class: 't' }, el('span', { class: 'mono', text: kind === 'function' ? name + '()' : name }), el('div', { class: 'n', text: body })),
          el('div', { class: 'acts' },
            el('button', { class: 'btn', text: '挿入', onclick: () => useItem(kind === 'function' ? name + '()' : name, kind === 'function' ? 1 : 0) }),
            el('button', { class: 'btn danger', text: '削除', onclick: async () => {
              if (!(await confirmSheet('「' + name + '」を削除しますか？', '削除する'))) return;
              const d = await Bridge.send('delete_def', { kind, name });
              if (!d.ok) toast(d.error); else { invalidateCatalogs(); refresh(); }
            } }))));
        for (const v of r.variables) list.append(row('variable', v.name, '= ' + v.value + (v.temporary ? '（一時的：アプリを閉じると消えます）' : '')));
        for (const f of r.functions) list.append(row('function', f.name, f.expr));
      };
      const save = async (cmd, params, clear) => {
        const r = await Bridge.send(cmd, params);
        if (!r.ok) { toast(r.error); return; }
        const err = (r.messages || []).find((m) => m.type === 'error');
        toast(err ? jaMessage(err.text) : (r.saved === false ? '設定しましたが、ファイルに保存できませんでした' : '保存しました'));
        clear.forEach((i) => { i.value = ''; });
        invalidateCatalogs();
        refresh();
      };
      addVar.addEventListener('click', () => save('define_var', { name: normalizeExpr(vName.value), value: normalizeExpr(vVal.value) }, [vName, vVal]));
      addFn.addEventListener('click', () => save('define_func', { name: normalizeExpr(fName.value), expr: normalizeExpr(fExpr.value) }, [fName, fExpr]));
      p.refresh = refresh;
    });
    p.refresh();
    return p;
  }
  function invalidateCatalogs() {
    for (const k of Object.keys(catalogs)) delete catalogs[k];
    for (const k of ['cat-functions', 'cat-variables', 'cat-units']) {
      const p = panels[k];
      if (!p) continue;
      delete panels[k]; // built again the next time it is opened
      if (panelStack.indexOf(p) < 0) p.node.remove();
      else p.onClose = () => setTimeout(() => p.node.remove(), 300); // still on screen: remove after closing
    }
  }

  // ------------------------------------------------------- exchange rates
  let ratesTime = 0;
  function fmtTime(sec) {
    if (!sec) return '不明';
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function openRates() {
    const p = panel('rates', '為替レートの更新', (p) => {
      const info = el('div', { class: 'card' });
      const btn = el('button', { class: 'btn primary', text: '今すぐ更新' });
      const result = el('div', { class: 'form-hint' });
      p.body.append(info, btn, result,
        el('div', { class: 'card muted', style: 'margin-top:14px', html: '通貨の換算（例：<span class="mono">100 USD to JPY</span>）には、公式の Qalculate! と同じ取得元（欧州中央銀行、Coinbase など）のレートを使います。更新にはインターネット接続が必要です。' }));
      const show = () => { info.innerHTML = ''; info.append(el('div', { text: '最終更新：' + fmtTime(ratesTime) })); };
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        result.textContent = 'ダウンロード中…';
        const r = await Bridge.updateRates();
        btn.disabled = false;
        if (r.time) ratesTime = r.time;
        show();
        if (r.ok) result.textContent = r.updated + ' / ' + r.total + ' 件の取得元から更新しました。' + (r.failed && r.failed.length ? '（取得できなかったもの：' + r.failed.join('、') + '）' : '');
        else result.textContent = r.error || '更新できませんでした';
        if (r.ok) { invalidateCatalogs(); exprChanged(); }
      });
      p.show = show;
    });
    p.show();
    return p;
  }

  // ------------------------------------------------------------ settings
  const SETTINGS = [
    ['計算', [
      ['angle', '角度の単位', [['rad', 'ラジアン'], ['deg', '度'], ['gra', 'グラード']]],
      ['approx', '厳密計算と近似', [['auto', '自動（厳密値と近似値）'], ['exact', '常に厳密'], ['approx', '常に近似（小数）']], '自動では √2 や π を含む結果に近似値も並べて表示します'],
      ['structuring', '式の整理', [['simplify', '簡約'], ['factorize', '因数分解'], ['expand', '展開']]],
      ['complex', '複素数の形式', [['rect', 'a + bi'], ['exp', '指数形式'], ['polar', '極形式'], ['cis', 'cis 形式']]],
      ['units', '単位の自動変換', [['optimal', '最適な単位'], ['si', 'SI 単位で最適'], ['base', '基本単位'], ['none', 'しない']]],
      ['mixed_units', '複合単位で表示（3 ft + 2 in など）', 'bool']
    ]],
    ['表示', [
      ['fraction', '分数の表示', [['auto', '自動'], ['decimal', '小数'], ['exact', '小数（厳密なときだけ）'], ['fraction', '分数'], ['combined', '帯分数']]],
      ['precision', '有効桁数', 'number', '計算の精度（2〜1000桁、既定 10）'],
      ['max_decimals', '小数点以下の最大桁数', [['-1', '制限なし'], ['0', '0'], ['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['10', '10']]],
      ['base', '結果の進数', [['10', '10進数'], ['16', '16進数'], ['2', '2進数'], ['8', '8進数'], ['12', '12進数'], ['-1', 'ローマ数字']]],
      ['notation', '指数表記', [['auto', '自動'], ['sci', '科学表記（1000 以上などで指数）'], ['eng', '工学表記（指数は 3 の倍数）'], ['pure', '常に指数表記'], ['none', '使わない（全桁を表示）']], '「使わない」にすると大きな整数も全桁を表示します'],
      ['grouping', '3桁ごとに区切る', 'bool'],
      ['text_size', '文字の大きさ', [['normal', '標準'], ['large', '大きめ'], ['xlarge', '特大']], '履歴・入力欄・結果の文字の大きさ']
    ]],
    ['操作', [
      ['preview', '入力中に結果を表示', 'bool'],
      ['auto_rates', '為替レートを自動更新（7日ごと）', 'bool'],
      ['auto_ans', '空欄で演算子を押すと ans から続ける', 'bool'],
      ['haptics', 'キーを押したときに振動', 'bool']
    ]]
  ];
  function openSettings() {
    const p = panel('settings', '設定', (p) => {
      for (const [group, rows] of SETTINGS) {
        p.body.append(el('div', { class: 'section-title', text: group }));
        for (const [key, label, type, sub] of rows) {
          let input;
          if (type === 'bool') {
            input = el('input', { type: 'checkbox' });
            input.checked = !!S[key];
            input.addEventListener('change', () => { S[key] = input.checked; settingsChanged(); });
          } else if (type === 'number') {
            input = el('input', { type: 'number', min: 2, max: 1000, inputmode: 'numeric' });
            input.value = S[key];
            input.addEventListener('change', () => { const n = Math.max(2, Math.min(1000, parseInt(input.value, 10) || 10)); S[key] = n; input.value = n; settingsChanged(); });
          } else {
            input = el('select');
            for (const [v, t] of type) input.append(el('option', { value: v, text: t }));
            input.value = String(S[key]);
            input.addEventListener('change', () => {
              const v = input.value;
              S[key] = (key === 'base' || key === 'max_decimals') ? Number(v) : v;
              settingsChanged();
            });
          }
          p.body.append(el('label', { class: 'setting' },
            el('div', { class: 'lbl' }, el('div', { text: label }), sub ? el('div', { class: 's', text: sub }) : null), input));
          (p.inputs = p.inputs || {})[key] = input;
        }
      }
      p.body.append(el('div', { class: 'section-title', text: '' }),
        el('button', { class: 'btn', text: '設定を初期値に戻す', onclick: async () => {
          if (!(await confirmSheet('設定を初期値に戻しますか？', '戻す'))) return;
          S = Object.assign({}, DEFAULTS); settingsChanged();
          for (const k of Object.keys(p.inputs)) { const i = p.inputs[k]; if (i.type === 'checkbox') i.checked = !!S[k]; else i.value = String(S[k]); }
        } }));
    });
    return p;
  }
  function settingsChanged() {
    saveSettings();
    updateChips();
    applyTextSize();
    exprChanged();
  }
  function updateChips() {
    $('#chip-angle').textContent = ANGLE_LABEL[S.angle] || 'RAD';
    $('#chip-approx').textContent = APPROX_LABEL[S.approx] || '自動';
    $('#chip-base').textContent = BASE_LABEL[String(S.base)] || (S.base + '進');
  }
  function cycle(key, values) {
    const i = values.indexOf(String(S[key]));
    const nv = values[(i + 1) % values.length];
    S[key] = (key === 'base') ? Number(nv) : nv;
    settingsChanged();
    if (panels.settings && panels.settings.inputs) panels.settings.inputs[key].value = String(S[key]);
  }
  for (const id of ['#chip-angle', '#chip-approx', '#chip-base']) $(id).addEventListener('pointerdown', (e) => e.preventDefault());
  $('#chip-angle').addEventListener('click', () => { vibrate(); cycle('angle', ['rad', 'deg', 'gra']); toast('角度：' + { rad: 'ラジアン', deg: '度', gra: 'グラード' }[S.angle], 1200); });
  $('#chip-approx').addEventListener('click', () => { vibrate(); cycle('approx', ['auto', 'exact', 'approx']); toast({ auto: '厳密値と近似値を自動で表示', exact: '常に厳密に計算', approx: '常に近似（小数）で計算' }[S.approx], 1400); });
  $('#chip-base').addEventListener('click', () => { vibrate(); cycle('base', ['10', '16', '2', '8']); toast('結果を ' + BASE_LABEL[String(S.base)] + '数で表示', 1200); });

  // --------------------------------------------------------------- about
  let engineName = '';
  const PRIVACY_URL = 'https://hiroshitsu.github.io/qcalc/privacy.html';
  const SOURCE_URL = 'https://github.com/HiroshiTsu/qcalc';
  function openAbout() {
    const p = panel('about', 'このアプリについて', (p) => {
      let app = {};
      try { app = JSON.parse(window.QalcNative ? QalcNative.appInfo() : '{}'); } catch (e) { }
      p.body.append(
        el('div', { class: 'card' },
          el('div', { style: 'font-weight:700;font-size:17px', text: 'QCalc' }),
          el('div', { class: 'muted', text: 'バージョン ' + (app.version || '') + ' ／ 計算エンジン ' + (engineName || 'libqalculate') }),
          el('div', { class: 'muted', text: (app.device || '') + (app.android ? '（Android ' + app.android + '）' : '') })),
        el('div', { class: 'card', html:
          '計算はすべて、オープンソースの電卓 Qalculate! の計算エンジン <b>libqalculate</b> が行います。QCalc は、その公式ソースコードを Android（arm64）向けにビルドして組み込んだ、スマホ向けの電卓です。Qalculate! の開発者が作ったアプリではありません。<br><br>' +
          '式の書き方は Qalculate! と同じです。' },
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: '式の例・使い方を見る', onclick: (e) => { e.preventDefault(); openExamples(); } }))),
        el('div', { class: 'card', html:
          '<b>プライバシー</b><br>QCalc は個人情報を集めず、どこにも送りません。インターネットを使うのは為替レートの取得（欧州中央銀行など 3 か所からのダウンロード）だけで、そのときもあなたの情報は送りません。計算の履歴や設定は端末の中に保存し、開発者に送ることはありません。' },
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: 'プライバシーポリシー', onclick: (e) => { e.preventDefault(); openUrl(PRIVACY_URL); } }))),
        el('div', { class: 'card' },
          el('div', { text: 'ライセンス：GNU GPL v2 以降（libqalculate と同じ）' }),
          el('div', { class: 'muted', style: 'font-size:13px', text: '計算エンジンには GMP・MPFR・libxml2 なども組み込んでいます。MPFR が LGPL v3 以降のため、エンジン全体は GNU GPL v3 以降の条件で配布しています。' }),
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: 'オープンソースライセンス', onclick: (e) => { e.preventDefault(); openLicenses(); } })),
          el('div', {}, el('a', { href: '#', text: 'QCalc のソースコード（GitHub）', onclick: (e) => { e.preventDefault(); openUrl(SOURCE_URL); } })),
          el('div', {}, el('a', { href: '#', text: 'Qalculate! 公式サイト', onclick: (e) => { e.preventDefault(); openUrl('https://qalculate.github.io/'); } })))
      );
    });
    return p;
  }
  // The license texts (licenses.js, made by make-licenses.py) are loaded only when this panel opens.
  function loadLicenses() {
    return new Promise((resolve, reject) => {
      if (window.QCALC_LICENSES) { resolve(window.QCALC_LICENSES); return; }
      const s = document.createElement('script');
      s.src = 'licenses.js';
      s.onload = () => (window.QCALC_LICENSES ? resolve(window.QCALC_LICENSES) : reject(new Error('licenses')));
      s.onerror = () => { s.remove(); reject(new Error('licenses')); };
      document.head.append(s);
    });
  }
  function openLicenses() {
    return panel('licenses', 'オープンソースライセンス', (p) => {
      const hint = el('div', { class: 'form-hint', text: '読み込み中…' });
      p.body.append(hint);
      loadLicenses().then((L) => {
        hint.remove();
        p.body.append(el('div', { class: 'card', text: 'QCalc には、次のオープンソースソフトウェアが含まれています。各ソフトウェアのライセンス全文は、名前の下の項目をタップすると表示されます。QCalc と計算エンジンの完全なソースコードは GitHub で公開しています。' }));
        for (const c of L.components) {
          const card = el('div', { class: 'card lic' },
            el('div', { style: 'font-weight:700', text: c.name + (c.version ? ' ' + c.version : '') }),
            el('div', { class: 'muted', text: c.license }),
            c.copyright ? el('div', { class: 'muted', style: 'font-size:12px', text: c.copyright }) : null,
            c.url ? el('div', { style: 'font-size:13px' }, el('a', { href: '#', text: c.url, onclick: (e) => { e.preventDefault(); openUrl(c.url); } })) : null);
          for (const t of c.texts) {
            const pre = el('pre', { class: 'lic-text' });
            const d = el('details', {}, el('summary', { text: L.titles[t] }), pre);
            d.addEventListener('toggle', () => { if (d.open && !pre.textContent) pre.textContent = L.texts[t]; });
            card.append(d);
          }
          p.body.append(card);
        }
      }).catch(() => { hint.textContent = 'ライセンス文を読み込めませんでした。'; });
    });
  }

  // ---------------------------------------------------------- back/pause
  window.qalcBack = function () {
    if ($('#sheet').classList.contains('open')) { closeSheet(null); return true; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return true; }
    if (panelStack.length) { closePanel(); return true; }
    if (exprEl.inputMode === 'text') { toggleKeyboard(false); return true; }
    return false;
  };
  window.qalcPause = function () {
    store.set('qalc.history', history.slice(-300));
    store.set('qalc.draft', exprEl.value);
  };

  // ---------------------------------------------------------------- boot
  function applyTheme() {
    let dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    try { if (window.QalcNative) dark = !!JSON.parse(QalcNative.appInfo()).dark; } catch (e) { }
    document.documentElement.classList.toggle('dark', dark);
  }
  // update exchange rates in the background when they are older than 7 days (at most every 6 hours)
  async function autoUpdateRates() {
    if (!S.auto_rates) return;
    const now = Date.now() / 1000;
    if (ratesTime && now - ratesTime < 7 * 86400) return;
    const lastTry = store.get('qalc.rates.try', 0);
    if (now - lastTry < 6 * 3600) return;
    store.set('qalc.rates.try', now);
    const r = await Bridge.updateRates();
    if (r && r.ok) {
      if (r.time) ratesTime = r.time;
      invalidateCatalogs();
      toast('為替レートを最新に更新しました', 1800);
      if (exprEl.value.trim()) exprChanged();
    }
  }
  async function boot() {
    applyTheme();
    applyTextSize();
    buildDrawer();
    buildKeypad();
    updateChips();
    renderHistory(true);
    const draft = store.get('qalc.draft', '');
    if (draft && typeof draft === 'string' && !exprEl.value) {
      exprEl.value = draft;
      exprEl.setSelectionRange(draft.length, draft.length);
    }
    autosize();
    focusExpr();
    startEngine();
  }
  async function startEngine() {
    previewEl.textContent = '計算エンジンを準備中…';
    const r = await Bridge.send('init');
    previewEl.textContent = '';
    if (!r.ok) {
      msgEl.textContent = (r.error || '計算エンジンを起動できませんでした') + '（ここをタップすると、もう一度試します）';
      msgEl.className = 'msg error';
      msgEl.onclick = () => { msgEl.onclick = null; msgEl.textContent = ''; msgEl.className = 'msg'; startEngine(); };
      return;
    }
    engineReady = true;
    if (r.ans_defined === false && history.length) {
      const t = insertText(history[history.length - 1]);
      if (t) Bridge.send('set_ans', { expr: t });
    }
    if (r.defs_error) toast('保存されていたユーザー定義のファイルが読めなかったため、別の場所に移しました', 5000);
    engineName = r.engine || '';
    ratesTime = r.rates_time || 0;
    autoUpdateRates();
    const sub = $('#drawer-sub');
    if (sub) sub.textContent = '計算エンジン ' + engineName;
    if (exprEl.value.trim()) exprChanged();
  }
  boot();
})();
