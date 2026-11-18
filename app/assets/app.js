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
  // The language of the user interface: English (the default), Japanese or Spanish (1.9.0). Only a
  // language the user chose with "Language / 言語 / Idioma" (in the menu or the settings) is kept, as
  // qalc.lang. The language that test builds of 1.3.0 saved with the other settings (qalc.settings)
  // is not used. Without a choice, the app starts in Spanish on a device set to Spanish, and in
  // English otherwise (also on a device set to Japanese, as before). It is read once when the page
  // starts; choosing another language reloads the page.
  const LANGS = ['en', 'ja', 'es'];
  const LANG = (() => {
    const chosen = store.get('qalc.lang', '');
    if (LANGS.indexOf(chosen) >= 0) return chosen;
    return /^es(?:[-_]|$)/i.test(String(navigator.language || '')) ? 'es' : 'en';
  })();
  const JA = LANG === 'ja', ES = LANG === 'es';
  // the Spanish texts by their English text (i18n-es.js, which index.html loads before this file)
  const ES_TEXT = (ES && window.QCALC_ES) || {};
  // the text in the language of the user interface. In Spanish: the Spanish text given (for texts
  // made of parts), else the one in i18n-es.js, else the English text (expressions and code-like
  // texts are the same in every language)
  const tr = (en, ja, es) => (JA ? ja : !ES ? en : es !== undefined ? es
    : Object.prototype.hasOwnProperty.call(ES_TEXT, en) ? ES_TEXT[en] : en);
  document.documentElement.lang = LANG;
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function vibrate() { if (S.haptics && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } } }

  // a value from a table whose keys come from outside (names of functions, variables, units):
  // never something inherited from Object.prototype (a user variable may be called "constructor")
  const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

  let toastTimer;
  // A short message. With `action` ([label, function]) it also has a button, for example "Undo".
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
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(tr('Copied', 'コピーしました')));
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
      else setTimeout(() => receive({ id, ok: false, error: tr('Cannot connect to the calculation engine', '計算エンジンに接続できません') }), 0);
    }
    // Last resort if a reply never comes (the app itself gives up much earlier and restarts the engine).
    function backstop(id, ms) {
      setTimeout(() => receive({ id, ok: false, code: 'timeout', error: tr('No reply from the calculation engine', '計算エンジンから応答がありません') }), ms);
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
        else receive({ id, ok: false, error: tr('Cannot update the exchange rates', '為替レートを更新できません') });
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
      if (!first.done) receive({ id: first.value, ok: false, error: tr('Could not read the reply of the calculation engine', '計算エンジンの応答を読み取れませんでした') });
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
    angle: 'rad', approx: 'auto', fraction: 'auto', precision: 10, max_decimals: -1, time_limit: 20, math_view: true,
    base: 10, notation: 'auto', units: 'optimal', mixed_units: true, complex: 'rect',
    grouping: false, structuring: 'simplify', preview: true, haptics: true, auto_ans: true, auto_rates: true,
    text_size: 'normal', lang: 'en', theme: 'blue', appearance: 'system'
  };
  // size of the text in the history, the input field and the preview (setting "Text size")
  const TEXT_SCALE = { normal: 1, large: 1.18, xlarge: 1.38 };
  function textScale() { return own(TEXT_SCALE, S.text_size) || 1; }
  function applyTextSize() {
    document.documentElement.dataset.textSize = own(TEXT_SCALE, S.text_size) ? S.text_size : 'normal';
    autosize();
  }
  let S = Object.assign({}, DEFAULTS, store.get('qalc.settings', {}));
  S.lang = LANG; // the language in use (qalc.lang), whatever qalc.settings says
  function saveSettings() { store.set('qalc.settings', S); }

  // ---------------------------------------------------------------- Pro
  // QCalc Pro is a one-time purchase in Google Play. It unlocks a precision above
  // FREE_MAX_PRECISION digits, 3D graphs, the color themes and exporting the history (and the Pro
  // features of later versions). The app reports the state with QalcNative.proInfo():
  //   billing  'play'   Pro can be bought in Google Play
  //            'debug'  a test build: Pro is unlocked (it can be locked for testing in the Pro panel)
  //            'none'   a build without Google Play Billing: Pro cannot be bought, so nothing is locked
  //   pro      true when Pro is unlocked; legacy: unlocked because QCalc was used before Pro began
  //   price    the price from Google Play ("¥300"); state 'pending' while a payment is processed
  // The highest precision is the engine's limit (MAX_PRECISION in qalc-engine.cc).
  const MAX_PRECISION = 200000, FREE_MAX_PRECISION = 1000;
  let PRO = readPro();
  function readPro() {
    let o = null;
    try {
      if (window.QalcNative && QalcNative.proInfo) o = JSON.parse(QalcNative.proInfo());
      else if (window.QalcDev && QalcDev.proInfo) o = QalcDev.proInfo();
    } catch (e) { o = null; }
    return o && typeof o === 'object' ? o : { billing: 'none' };
  }
  function proOffered() { return PRO.billing === 'play' || PRO.billing === 'debug'; }
  function hasPro() { return !proOffered() || PRO.pro === true; }
  function maxPrecision() { return hasPro() ? MAX_PRECISION : FREE_MAX_PRECISION; }
  function engineOpts() {
    return {
      angle: S.angle, approx: S.approx, fraction: S.fraction, precision: Math.min(Number(S.precision) || 10, maxPrecision()),
      max_decimals: Number(S.max_decimals), base: Number(S.base), notation: S.notation, units: S.units,
      mixed_units: !!S.mixed_units, complex: S.complex, grouping: !!S.grouping, structuring: S.structuring
    };
  }
  // The time limit of a calculation with "=" in seconds (setting "Time limit"). The engine accepts up
  // to one hour (MAX_CALC_TIMEOUT in qalc-engine.cc); the preview always stops after 1.5 s.
  const MIN_TIME_LIMIT = 1, MAX_TIME_LIMIT = 3600, DEFAULT_TIME_LIMIT = 20;
  function timeLimit() {
    return Math.max(MIN_TIME_LIMIT, Math.min(MAX_TIME_LIMIT, Math.round(Number(S.time_limit)) || DEFAULT_TIME_LIMIT));
  }
  const ANGLE_LABEL = { rad: 'RAD', deg: 'DEG', gra: 'GRA' };
  const APPROX_LABEL = { auto: tr('AUTO', '自動'), exact: tr('EXACT', '厳密'), approx: tr('APPROX', '近似') };
  const BASE_LABEL = { 10: tr('DEC', '10進'), 16: tr('HEX', '16進'), 2: tr('BIN', '2進'), 8: tr('OCT', '8進'), 12: tr('DUO', '12進'), '-1': tr('ROMAN', 'ローマ') };
  const BASE_NAME = {
    10: tr('decimal', '10進数'), 16: tr('hexadecimal', '16進数'), 2: tr('binary', '2進数'), 8: tr('octal', '8進数'),
    12: tr('duodecimal', '12進数'), '-1': tr('Roman numerals', 'ローマ数字')
  };

  // ------------------------------------------------------------ history
  // Long results: a result is shown and kept in full, in the preview as in the history (the engine
  // sends up to MAX_RESULT bytes of UTF-8: a complex number with 200000-digit parts, or 200000
  // digits with digit grouping). A longer result (100000! has 456,574 digits) is shown as its
  // beginning, "…" and its last TAIL_RESULT bytes. The newest results are kept in full until the
  // history adds up to HISTORY_BUDGET characters; older long results keep only their first
  // SHORT_RESULT characters and "…", so that the saved history stays small. A result can be
  // inserted into an expression up to MAX_INPUT characters.
  const MAX_RESULT = 450000, TAIL_RESULT = 20000, HISTORY_BUDGET = 1000000, SHORT_RESULT = 2000, MAX_INPUT = 20000;
  function fitHistory() {
    let used = 0, changed = false;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (!h || typeof h !== 'object') continue;
      if (used >= HISTORY_BUDGET) {
        if (typeof h.result === 'string' && h.result.length > SHORT_RESULT + 1) { h.result = h.result.slice(0, SHORT_RESULT) + '…'; h.cut = true; delete h.tail; changed = true; }
        if (typeof h.input === 'string' && h.input.length > SHORT_RESULT) { delete h.input; h.big = true; changed = true; }
      }
      used += String(h.result || '').length + String(h.tail || '').length + String(h.input || '').length + String(h.expr || '').length;
    }
    return changed; // an older long result was shortened (what is shown of it is out of date)
  }
  let history = store.get('qalc.history', []);
  if (!Array.isArray(history)) history = [];
  fitHistory();
  const saveHistory = debounce(() => store.set('qalc.history', history.slice(-300)), 300);
  // the beginning of a long text, for titles and announcements
  function clip(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n) + '…' : t; }

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
  // a fraction: numerator and denominator as boxes to fill in (a selection becomes the numerator)
  const FRACTION = '(□)/(□)';
  const PAGES = {
    num: [
      ['(', { ins: '(' }], [')', { ins: ')' }], ['%', { ins: '%' }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['7'], ['8'], ['9'], ['÷', { ins: '÷', op: true, cls: 'op has-more', long: () => insert(FRACTION, 0, false), title: tr('Divide (touch and hold for a fraction □/□)', '割る（長押しで分数 □/□）') }], ['xʸ', { ins: '^', op: true, cls: 'op' }],
      ['4'], ['5'], ['6'], ['×', { ins: '×', op: true, cls: 'op' }], ['√', { ins: '√()', back: 1, cls: 'op' }],
      ['1'], ['2'], ['3'], ['−', { ins: '−', cls: 'op' }], ['π', { ins: 'π', cls: 'op' }],
      ['0'], ['.'], ['E', { ins: 'E', label: '×10ⁿ', small: true }], ['+', { ins: '+', op: true, cls: 'op' }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    fn: [
      ['sin', { ins: 'sin()', back: 1 }], ['cos', { ins: 'cos()', back: 1 }], ['tan', { ins: 'tan()', back: 1 }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['asin', { ins: 'asin()', back: 1 }], ['acos', { ins: 'acos()', back: 1 }], ['atan', { ins: 'atan()', back: 1 }], ['ln', { ins: 'ln()', back: 1 }], ['log', { ins: 'log10()', back: 1, label: 'log₁₀' }],
      ['x²', { ins: '^2', op: true }], ['x⁻¹', { ins: '^(−1)', op: true }], ['∛', { ins: 'cbrt()', back: 1 }], ['eˣ', { ins: 'exp()', back: 1 }], ['n!', { ins: '!', op: true }],
      ['|x|', { ins: 'abs()', back: 1 }], ['e', { ins: 'e' }], ['i', { ins: 'i' }], ['°', { ins: '°' }],
      ['a/b', { ins: FRACTION, html: '<span class="fk"><i>□</i><i>□</i></span>', cls: 'fn' }],
      ['solve', { form: 'solve', ins: 'solve()', back: 1 }], ['∫', { form: 'int', ins: 'integrate(□)' }], ['d/dx', { form: 'diff', ins: 'diff(□)' }], ['Σ', { form: 'sum', ins: 'sum(□, □, □)' }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    // analysis: derivatives, integrals, limits, sums and products, differential equations.
    // These keys open a form (form, see "calculus forms") with the boxes laid out as the mathematics
    // is written; in a box of a form they type the template (ins) instead, with □ for each box.
    calc: [
      ['d/dx', { form: 'diff', ins: 'diff(□)' }], ['d²/dx²', { form: 'diff', init: { n: '2' }, ins: 'diff(□, x, 2)', cls: 'fn sm' }], ['∂/∂y', { form: 'diff', init: { v: 'y' }, ins: 'diff(□, y)' }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['∫', { form: 'int', ins: 'integrate(□)' }], ['∫ₐᵇ', { form: 'int', init: { focus: 'a', order: ['a', 'b', 'f', 'v'] }, ins: 'integrate(□, □, □)', html: '∫<sub>a</sub><sup>b</sup>' }], ['lim', { form: 'lim', ins: 'limit(□, □)' }], ['Σ', { form: 'sum', ins: 'sum(□, □, □)' }], ['Π', { form: 'prod', ins: 'product(□, □, □)' }],
      ['dsolve', { form: 'dsolve', ins: 'dsolve(diff(y, x) = □)', cls: 'fn sm' }], [tr('max/min', '極値'), { ins: 'extremum()', back: 1, cls: tr('fn sm', undefined) }], ['solve', { form: 'solve', ins: 'solve()', back: 1 }], ['∞', { ins: '∞' }], ['y', { ins: 'y' }],
      ['(', { ins: '(' }], [')', { ins: ')' }], ['xʸ', { ins: '^', op: true, cls: 'op' }], ['√', { ins: '√()', back: 1, cls: 'op' }], ['π', { ins: 'π', cls: 'op' }],
      ['sin', { ins: 'sin()', back: 1 }], ['ln', { ins: 'ln()', back: 1 }], ['e', { ins: 'e' }], [tr('more…', 'ほか…'), { act: 'more', cls: 'fn sm' }], ['=', { act: 'eq', cls: 'eq' }]
    ],
    // matrices and vectors: [1, 2; 3, 4] is typed without leaving the page (digits, brackets, ";"
    // between rows; the "," between elements is in the row of keys above)
    // "▦" opens the matrix form (a grid of cells); det, Aᵀ and A⁻¹ open it too when the input field
    // is empty, with that calculation chosen (formEmpty), and otherwise type the function
    mat: [
      ['▦', { form: 'mat', cls: 'fn mxk', label: tr('▦ Matrix', '▦ 行列') }], ['[', { ins: '[' }], [']', { ins: ']' }], ['⌫', { act: 'del', cls: 'ctl', repeat: true }], ['AC', { act: 'clear', cls: 'ctl' }],
      ['7'], ['8'], ['9'], ['det', { ins: 'det()', back: 1, form: 'mat', formEmpty: true, init: { op: 'det' } }], ['Aᵀ', { ins: 'transpose()', back: 1, html: 'A<sup>T</sup>', form: 'mat', formEmpty: true, init: { op: 'tr' } }],
      ['4'], ['5'], ['6'], ['A⁻¹', { ins: '^(−1)', op: true, form: 'mat', formEmpty: true, init: { op: 'inv' } }], ['×', { ins: '×', op: true, cls: 'op' }],
      ['1'], ['2'], ['3'], ['−', { ins: '−', cls: 'op' }], ['+', { ins: '+', op: true, cls: 'op' }],
      ['0'], ['.'], [';', { ins: '; ' }], [tr('more…', 'ほか…'), { act: 'more', cls: 'fn sm' }], ['=', { act: 'eq', cls: 'eq' }]
    ]
  };
  // the pages of the keypad: [id, label of the tab, name for screen readers, category of the function list for "more…"]
  const PAGE_TABS = [
    ['num', '123', tr('Digit and arithmetic keys', '数字と四則演算のキー'), ''], ['fn', tr('Functions', '関数'), tr('Function keys', '関数のキー'), ''],
    ['calc', tr('Calculus', '解析'), tr('Calculus keys (derivatives, integrals, limits)', '解析（微分・積分・極限）のキー'), 'Calculus'],
    ['mat', tr('Matrix', '行列'), tr('Matrix and vector keys', '行列・ベクトルのキー'), 'Matrices & Vectors']
  ];
  // letters for variables: touch and hold the x key to choose one (also offered in a form's variable box).
  // libqalculate knows x, y, z and n as variables; other single letters are names of units or constants
  // (t is the tonne, c the speed of light, θ the Heaviside function), so they are typed with a
  // backslash, which makes them plain unknowns: \t. Results show them without it.
  const VAR_LETTERS = ['y', 'z', 'n', 't', 'a', 'b', 'c', 'k', 'θ'];
  const PLAIN_VARS = ['x', 'y', 'z', 'n'];
  const varText = (l) => (PLAIN_VARS.indexOf(l) >= 0 || l[0] === '\\' ? l : '\\' + l);
  const TOOLBAR = [
    ['x', { ins: 'x', long: () => openVarPop(), cls: 'has-more', title: tr('x (touch and hold for y, z, t and other letters)', 'x（長押しで y・z・t などの文字）') }], [',', { ins: ', ' }], ['a=b', { ins: ' = ', title: tr('Equals sign (for equations)', '等号（方程式の = を入力）') }], ['→', { ins: ' to ', op: true, title: tr('Convert units or number bases (to)', '単位・進数の変換') }],
    ['ans', { ins: 'ans' }], ['⌨', { act: 'kbd', id: 'k-kbd' }], ['◀', { act: 'left', repeat: true }], ['▶', { act: 'right', repeat: true }]
  ];
  let page = 'num';
  // names of the keys for screen readers
  const KEY_NAMES = JA ? {
    '⌫': '1文字削除', 'AC': 'すべて消去', '◀': 'カーソルを左へ', '▶': 'カーソルを右へ', '⌨': 'キーボードで入力',
    'xʸ': 'べき乗', '√': '平方根', '∛': '立方根', 'E': '×10のべき乗', '÷': '割る', '×': '掛ける', '−': '引く',
    '+': '足す', '=': '計算する', 'π': '円周率パイ', 'x²': '2乗', 'x⁻¹': '逆数', 'n!': '階乗', '|x|': '絶対値',
    'eˣ': 'eのべき乗', '∫': '積分', 'd/dx': '微分', 'Σ': '総和', ',': 'カンマ',
    '°': '度', '%': 'パーセント', '(': '左かっこ', ')': '右かっこ', '.': '小数点',
    'd²/dx²': '2階微分', '∂/∂y': 'yで偏微分', '∫ₐᵇ': '定積分', 'lim': '極限', 'Π': '総乗', 'dsolve': '微分方程式を解く',
    '極値': '極値', 'solve': '方程式を解く', '∞': '無限大', 'ほか…': 'ほかの関数を一覧から選ぶ',
    '[': '左角かっこ（行列の始まり）', ']': '右角かっこ（行列の終わり）', ';': 'セミコロン（行列の行の区切り）',
    'det': '行列式', 'Aᵀ': '転置行列', 'A⁻¹': '逆行列', '▦': '行列を入力する画面を開く', 'a/b': '分数（分子と分母の欄）'
  } : ES ? {
    '⌫': 'Borrar', 'AC': 'Borrar todo', '◀': 'Cursor a la izquierda', '▶': 'Cursor a la derecha', '⌨': 'Escribir con el teclado',
    'xʸ': 'Potencia', '√': 'Raíz cuadrada', '∛': 'Raíz cúbica', 'E': 'Por diez elevado a', '÷': 'Dividir', '×': 'Multiplicar', '−': 'Menos',
    '+': 'Más', '=': 'Calcular', 'π': 'Pi', 'x²': 'Al cuadrado', 'x⁻¹': 'Recíproco', 'n!': 'Factorial', '|x|': 'Valor absoluto',
    'eˣ': 'e elevado a', '∫': 'Integral', 'd/dx': 'Derivada', 'Σ': 'Sumatoria', ',': 'Coma',
    '°': 'Grados', '%': 'Por ciento', '(': 'Abrir paréntesis', ')': 'Cerrar paréntesis', '.': 'Punto decimal',
    'd²/dx²': 'Segunda derivada', '∂/∂y': 'Derivada parcial respecto a y', '∫ₐᵇ': 'Integral definida', 'lim': 'Límite',
    'Π': 'Productoria', 'dsolve': 'Resolver una ecuación diferencial', 'máx/mín': 'Extremo (máximo o mínimo)', 'solve': 'Resolver una ecuación',
    '∞': 'Infinito', 'más…': 'Elegir otra función de la lista',
    '[': 'Abrir corchete (inicio de una matriz)', ']': 'Cerrar corchete (fin de una matriz)', ';': 'Punto y coma (fin de una fila de la matriz)',
    'det': 'Determinante', 'Aᵀ': 'Transpuesta', 'A⁻¹': 'Matriz inversa', '▦': 'Abrir el formulario de matrices', 'a/b': 'Fracción (casillas para el numerador y el denominador)'
  } : {
    '⌫': 'Backspace', 'AC': 'Clear all', '◀': 'Cursor left', '▶': 'Cursor right', '⌨': 'Type with the keyboard',
    'xʸ': 'Power', '√': 'Square root', '∛': 'Cube root', 'E': 'Times ten to the power', '÷': 'Divide', '×': 'Multiply', '−': 'Minus',
    '+': 'Plus', '=': 'Calculate', 'π': 'Pi', 'x²': 'Square', 'x⁻¹': 'Reciprocal', 'n!': 'Factorial', '|x|': 'Absolute value',
    'eˣ': 'e to the power', '∫': 'Integral', 'd/dx': 'Derivative', 'Σ': 'Sum', ',': 'Comma',
    '°': 'Degrees', '%': 'Percent', '(': 'Left parenthesis', ')': 'Right parenthesis', '.': 'Decimal point',
    'd²/dx²': 'Second derivative', '∂/∂y': 'Partial derivative with respect to y', '∫ₐᵇ': 'Definite integral', 'lim': 'Limit',
    'Π': 'Product', 'dsolve': 'Solve a differential equation', 'max/min': 'Extremum (maximum or minimum)', 'solve': 'Solve an equation',
    '∞': 'Infinity', 'more…': 'Choose another function from the list',
    '[': 'Left bracket (start of a matrix)', ']': 'Right bracket (end of a matrix)', ';': 'Semicolon (end of a matrix row)',
    'det': 'Determinant', 'Aᵀ': 'Transpose', 'A⁻¹': 'Inverse matrix', '▦': 'Open the matrix form', 'a/b': 'Fraction (boxes for the numerator and the denominator)'
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
      // in a form's box the template is typed instead; formEmpty: only when the input field is empty
      if (o.form && !editTarget && (!o.formEmpty || !exprEl.value.trim())) openForm(o.form, o.init);
      else if (o.act) action(o.act);
      else insert(o.ins !== undefined ? o.ins : label, o.back || 0, o.op);
    };
    bindPress(b, run, o.repeat, o.long);
    return b;
  }

  // press handling: keep the caret in the expression field, support key repeat, or another action
  // when the key is touched and held (onLong)
  function bindPress(b, run, repeat, onLong) {
    let timer = null, rep = null, fired = false, viaPointer = false;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; b.classList.remove('pressed'); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      viaPointer = true;
      b.classList.add('pressed');
      fired = false;
      if (repeat) {
        timer = setTimeout(() => { fired = true; run(); rep = setInterval(run, 70); }, 420);
      } else if (onLong) {
        timer = setTimeout(() => { fired = true; b.classList.remove('pressed'); vibrate(); onLong(b); }, 420);
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

  // The letters of the x key (touch and hold): a row of keys above it; one tap types the letter.
  const varPopEl = $('#varpop');
  function openVarPop() {
    const xKey = $('#toolbar .key');
    if (!xKey) return;
    varPopEl.textContent = '';
    for (const l of VAR_LETTERS) {
      const b = el('button', { class: 'key', text: l, 'aria-label': l });
      bindPress(b, () => { vibrate(); closeVarPop(); insert(varText(l), 0, false); });
      varPopEl.append(b);
    }
    varPopEl.hidden = false;
    const r = xKey.getBoundingClientRect(), w = varPopEl.offsetWidth;
    varPopEl.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6)) + 'px';
    varPopEl.style.top = Math.max(6, r.top - varPopEl.offsetHeight - 6) + 'px';
  }
  function closeVarPop() { varPopEl.hidden = true; }
  // a touch anywhere else closes the letters
  document.addEventListener('pointerdown', (e) => { if (!varPopEl.hidden && !varPopEl.contains(e.target)) closeVarPop(); }, true);

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
  // ---- "Undo" for an expression that was cleared (AC) or replaced (history, examples)
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

  // The keys type into the input field, or into the box of a calculus form that has the focus
  // (editTarget, see "calculus forms").
  let editTarget = null;
  const tgt = () => editTarget || exprEl;
  function targetChanged() { if (editTarget) { CF.reveal = true; CF.typing = true; CF.navSel = null; formChanged(); } else exprChanged(); }
  // a box of a form that was reached with "Next box" or the arrows and is still selected as a whole
  const boxSelected = (f) => f !== exprEl && CF.navSel === f && f.selectionStart === 0 && f.selectionEnd === f.value.length && f.value !== '';
  function insert(text, back, isOp) {
    const f = tgt();
    if (f === exprEl) dropUndo();
    // (as in a cell of a spreadsheet, what is typed takes the place of what the box held)
    if (boxSelected(f)) f.value = '';
    const v = f.value;
    let s = f.selectionStart, e = f.selectionEnd;
    if (s === undefined || s === null) { s = e = v.length; }
    if (isOp && S.auto_ans && v.trim() === '' && history.length && f === exprEl) {
      text = 'ans' + text;
    }
    const sel = v.slice(s, e);
    if (sel && sel !== '□' && !back && text.indexOf('□') >= 0) {
      // a template with boxes: the selection fills the first one ((□)/(□) + "3x" -> (3x)/(□))
      text = text.replace('□', sel);
    } else if (sel && back && sel !== '□') {
      // wrap the selection: sin() + "2" -> sin(2), integrate(, 0, 1) + "x^2" -> integrate(x^2, 0, 1)
      // (a selected □, a box still to be filled in, is replaced instead)
      text = text.slice(0, text.length - back) + sel + text.slice(text.length - back);
      back = 0;
    }
    f.value = v.slice(0, s) + text + v.slice(e);
    const pos = s + text.length - (back || 0);
    const box = text.indexOf('□');
    if (box >= 0) f.setSelectionRange(s + box, s + box + 1); // the first □ of a template, to be typed over
    else f.setSelectionRange(pos, pos);
    targetChanged();
  }
  function action(a) {
    const f = tgt();
    const v = f.value;
    const s = f.selectionStart, e = f.selectionEnd;
    switch (a) {
      case 'del':
        if (v && f === exprEl) dropUndo();
        if (s !== e) { f.value = v.slice(0, s) + v.slice(e); f.setSelectionRange(s, s); }
        else if (s > 0) {
          // delete a whole surrogate pair, or a whole template that is still empty when the caret
          // is right after its "name(":  sin(|)  integrate(|, 0, 1)  diff(|, x, 2)
          let n = 1;
          const before = v.slice(0, s);
          const m = before.match(/(?:[\p{L}_][\p{L}\p{N}_]*|[√∛∜])\($/u);
          const rest = m && /^(?:, [^(),;[\]]*)*\)/.exec(v.slice(s));
          if (rest) { n = m[0].length; f.value = v.slice(0, s - n) + v.slice(s + rest[0].length); f.setSelectionRange(s - n, s - n); targetChanged(); break; }
          if (/[\uDC00-\uDFFF]/.test(v[s - 1] || '')) n = 2;
          f.value = v.slice(0, s - n) + v.slice(e);
          f.setSelectionRange(s - n, s - n);
        }
        targetChanged();
        break;
      case 'clear':
        if (f === exprEl) offerUndo(v); // AC is next to ⌫: a long expression cleared by mistake can be brought back
        f.value = '';
        targetChanged();
        break;
      case 'eq': if (editTarget) formCalculate(); else commit(); break;
      case 'more': {
        // "more…": the function list, showing the functions of this page's field
        const tab = PAGE_TABS.find((t) => t[0] === page);
        openCatalog('functions', tab && tab[3]);
        break;
      }
      case 'kbd': toggleKeyboard(); break;
      case 'left': {
        // in a form: from the start of a box (or from a box selected as a whole) to the box before
        if (editTarget && (boxSelected(f) || (s === 0 && e === 0)) && formMove(f, 'prev')) break;
        CF.navSel = null;
        // a selection collapses to its start; otherwise one character back (a surrogate pair counts as one)
        let p = s;
        if (s === e && p > 0) p -= /[\uDC00-\uDFFF]/.test(v[p - 1]) && p > 1 ? 2 : 1;
        f.setSelectionRange(p, p);
        if (f === exprEl) { updateSuggest(false); updateNextBox(); }
        break;
      }
      case 'right': {
        if (editTarget && (boxSelected(f) || (s === v.length && e === v.length)) && formMove(f, 'next')) break;
        CF.navSel = null;
        let p = e;
        if (s === e && p < v.length) p += /[\uD800-\uDBFF]/.test(v[p]) && p + 1 < v.length ? 2 : 1;
        f.setSelectionRange(p, p);
        if (f === exprEl) { updateSuggest(false); updateNextBox(); }
        break;
      }
    }
  }
  let kbdMinH = 0, kbdW = 0;
  function toggleKeyboard(force) {
    const text = force !== undefined ? force : exprEl.inputMode !== 'text';
    exprEl.inputMode = text ? 'text' : 'none';
    for (const b of formBoxes()) b.inputMode = exprEl.inputMode; // the boxes of an open calculus form too
    document.body.classList.toggle('kbd', text);
    kbdMinH = window.innerHeight; kbdW = window.innerWidth;
    const f = tgt();
    f.blur();
    setTimeout(text ? () => f.focus() : focusExpr, 30);
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
    exprChanged(true);
  });
  exprEl.addEventListener('focus', () => updateToolbar());
  // the caret was put somewhere else by touching the field
  exprEl.addEventListener('click', () => { updateSuggest(false); updateNextBox(); });

  function autosize() {
    exprEl.style.height = 'auto';
    const h = exprEl.scrollHeight, max = Math.round(110 * textScale());
    exprEl.style.height = Math.min(h, max) + 'px';
    exprEl.style.overflowY = h > max ? 'auto' : 'hidden';
  }
  function focusExpr() {
    // with inputmode="none" this only shows the caret, not the system keyboard
    // (the box of an open calculus form gets the focus instead of the input field)
    const f = tgt();
    if (document.activeElement !== f) {
      try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
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
  exprEl.addEventListener('compositionend', () => { normalizeField(); exprChanged(true); });

  // ======================================================= live preview
  let previewBusy = false, previewAgain = false, previewTimer = null, engineReady = false;
  // the expression being typed survives closing the app or the page being reloaded
  const saveDraft = debounce(() => store.set('qalc.draft', exprEl.value), 500);
  // typed: the change was typed with the phone's keyboard (names are then offered, see updateSuggest)
  function exprChanged(typed) {
    saveDraft();
    autosize();
    updateSuggest(typed === true);
    updateMathView();
    updateNextBox();
    plotBtnEl.hidden = !plottable(exprEl.value);
    clearTimeout(previewTimer);
    if (!exprEl.value.trim() || !S.preview) { showPreview(null); return; }
    previewTimer = setTimeout(runPreview, 160);
  }
  // "5 km to" while the unit is still to be typed or chosen: what is before the "to" is calculated
  // (the engine would read a "to" at the end as units, t·o: "255 to" gave "255 B·t")
  function withoutOpenTo(expr) { return expr.replace(/\s+(?:to|→|->)$/i, ''); }
  // The expression in math notation above the input field (setting "Math notation"; mathview.js and
  // KaTeX): only when it shows more than the text does (fractions, powers, roots, integrals …).
  const mathEl = $('#mathview');
  function updateMathView() {
    const t = exprEl.value;
    let ok = false;
    if (S.math_view && t.trim() && window.QMath) ok = QMath.render(mathEl, normalizeExpr(t), { richOnly: true });
    mathEl.hidden = !ok;
    parsedEl.hidden = ok;
    if (ok) mathEl.scrollLeft = mathEl.scrollWidth;
  }
  // ---- notes on input that the engine reads in another way than it was probably meant. The
  // engine gives no message of its own in these cases:
  //   1,000 + 500      a "," outside parentheses separates values (the result is [1  500])
  //   sni(30)          a name before "(" that is not a function is letters multiplied (s × n × i × 30)
  const callKind = new Map(); // a name before "(": true when it is a function
  async function inputNotes(expr) {
    const notes = [];
    let d = 0, top = false;
    for (const c of expr) { if ('([{'.indexOf(c) >= 0) d++; else if (')]}'.indexOf(c) >= 0) d--; else if (c === ',' && d <= 0) top = true; }
    if (top) {
      const m = /(?:^|[^\d.,])(\d{1,3}(?:,\d{3})+)(?![\d,])/.exec(expr);
      notes.push(m ? tr(`The "," in ${m[1]} separates values, it does not group digits: type ${m[1].replace(/,/g, '')}`, `「${m[1]}」の「,」は桁区切りではなく、値の区切りとして扱われます。${m[1].replace(/,/g, '')} と続けて入れてください`,
        `La "," en ${m[1]} separa valores, no agrupa dígitos: escribe ${m[1].replace(/,/g, '')}`)
        : tr('"," separates values, so the result is a list of values (the decimal point is ".")', '「,」は値の区切りなので、結果は値の並びになります（小数点は「.」）'));
    }
    const names = new Set();
    for (const m of expr.matchAll(/(^|[^\p{L}\p{N}_\\])([\p{L}_][\p{L}\p{N}_]+)\(/gu)) names.add(m[2]);
    for (const n of names) {
      if (!callKind.has(n)) {
        let fn = false;
        try { fn = (await loadCatalog('functions')).some((it) => it.name === n); } catch (e) { fn = true; }
        if (!fn) {
          // (other names of a function, such as asin for arcsin, are not in the list: the engine is
          // asked. Only a name that is not a function leaves the parentheses of "name()" empty.)
          const r = await Bridge.send('calc', { expr: n + '()', opts: engineOpts(), timeout: 800 });
          fn = !r.ok || !!r.timeout || !(r.messages || []).some((x) => /Empty expression in parentheses/.test(x.text));
        }
        callKind.set(n, fn);
      }
      if (!callKind.get(n)) notes.push(tr(`"${n}" is not a function: it was read as letters multiplied (units and constants). Check the spelling`, `「${n}」という関数はありません（文字ごとの掛け算＝単位や定数として計算しました）。つづりを確認してください`,
        `"${n}" no es una función: se leyó como letras multiplicadas (unidades y constantes). Revisa cómo está escrito`));
    }
    return notes;
  }
  // the notes go with the messages of the engine, in front of them
  async function withNotes(r, expr) {
    if (!r || !r.ok || r.deferred) return r;
    let notes = [];
    try { notes = await inputNotes(expr); } catch (e) { notes = []; }
    if (notes.length) r.messages = notes.map((text) => ({ type: 'warning', text })).concat(r.messages || []);
    return r;
  }
  async function runPreview() {
    if (!engineReady) return;
    if (previewBusy) { previewAgain = true; return; }
    const raw = exprEl.value.trim();
    const expr = raw && withoutOpenTo(normalizeExpr(raw));
    if (!expr) { showPreview(null); return; }
    if (expr.indexOf('□') >= 0) { // a template with boxes still to fill in
      showPreview(null);
      msgEl.textContent = tr('Fill in the boxes □ ("Next box ▶" goes to the next one)', '□ の欄を埋めてください（「次の欄 ▶」で次の欄へ）');
      return;
    }
    previewBusy = true;
    const r = await withNotes(await Bridge.send('calc', { expr, opts: engineOpts(), timeout: 1500, max_chars: MAX_RESULT, tail_chars: TAIL_RESULT }), expr);
    previewBusy = false;
    if (exprEl.value.trim() === raw && !committing) showPreview(r);
    if (previewAgain) { previewAgain = false; runPreview(); }
  }
  // Result text as shown: dates without the quotes the engine puts around them, and digit groups.
  // With "Digit grouping" the engine separates the groups with narrow spaces (U+202F in numbers of
  // up to 20 characters, U+2009 in longer ones), in the decimals too, and puts U+202F between a
  // number and its unit. The groups before the decimal point are shown with commas (1,234,567);
  // the decimals and the space before a unit stay as they are (3.141 592 654, 12.345 km).
  // inDecimals: the text continues the decimals of a number (the end of a shortened preview).
  function displayText(t, inDecimals) {
    if (!t) return '';
    if (t.indexOf('\u202f') >= 0 || t.indexOf('\u2009') >= 0) {
      t = t.replace(/[\d\u202f\u2009.]+/g, (tok, at) => {
        if (inDecimals && at === 0) return tok;
        const dot = tok.indexOf('.');
        const int = dot < 0 ? tok : tok.slice(0, dot);
        return int.replace(/(\d)[\u202f\u2009](?=\d)/g, '$1,') + (dot < 0 ? '' : tok.slice(dot));
      });
    }
    const d = /^"(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)"$/.exec(t);
    // an unknown typed as \t is 't' in the engine's text: shown as t
    return d ? d[1].replace('T', ' ') : t.replace(/'([\p{L}_][\p{L}\p{Nd}_]*)'/gu, '$1');
  }
  // A result as shown, without "= ". One that was too long has its beginning, "…" and its end.
  function shownText(h) {
    const t = displayText(h.result);
    if (typeof h.tail !== 'string' || !h.tail) return t;
    const head = t.replace(/…$/, '');
    return head + ' … ' + displayText(h.tail, /\.[\d\u202f\u2009]*$/.test(head));
  }
  function displayResult(h) {
    const t = shownText(h);
    if (h.cmp) return t;
    return (h.approx && t.indexOf('≈') < 0 ? '≈ ' : '= ') + t;
  }
  function resultText(r) {
    if (!r || !r.result) return '';
    return displayResult({ result: r.result, tail: r.tail, approx: r.approx, cmp: r.comparison });
  }
  // ---- matrices in results
  // The engine prints a matrix on one line, "[1  2; 3  4]": rows separated by "; " and the elements
  // of a row by two spaces (an element that is more than a number or a name is in parentheses).
  // In the history and in the preview a matrix with two or more rows is drawn as a grid. Only
  // the display changes: copying and inserting a result use its text.
  // Returns the text cut into strings and { rows: [[element, …], …], text } objects.
  // (a grid for up to 30 × 30 elements, the largest matrix of the matrix form)
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
      if (closed && rows.length >= 2 && rows.length * cols <= 900 && rows.every((r) => r.length === cols && r.every((x) => x.trim() !== ''))) {
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
    const parts = splitMatrices(text); node.classList.toggle('brk', /\S{16,}/.test(text)); // a number longer than a line is cut at the end of the line (.brk in style.css); "≈" does not stand alone
    node.classList.remove('math');
    if (parts.every((x) => typeof x === 'string')) {
      // fractions, roots and powers in math notation (setting "math notation"): 1/6 as a stacked fraction
      if (S.math_view && mathResult(text) && window.QMath && QMath.render(node, text, { richOnly: true, mathml: true })) { node.classList.add('math'); return; }
      node.textContent = text;
      return;
    }
    node.textContent = '';
    for (const part of parts) {
      if (typeof part === 'string') { node.append(part); continue; }
      const grid = el('span', { class: 'mx', role: 'img', 'aria-label': part.text });
      grid.style.gridTemplateColumns = 'repeat(' + part.rows[0].length + ', auto)';
      for (const r of part.rows) for (const x of r) grid.append(el('span', { text: x }));
      node.append(grid);
    }
  }
  // A result that reads well in math notation: numbers, x, π, √, fractions and powers, functions
  // such as sin; not units (km, mph), dates, texts, matrices or very long numbers.
  const MATH_WORDS = /^(?:sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|asin|acos|atan|arcsin|arccos|arctan|ln|log|log10|log2|sqrt|cbrt|abs|exp|or|and|where)$/;
  function mathResult(t) {
    if (!t || t.length > 400 || /[[\]"…|]/.test(t) || !/[/^√∛⁰¹²³⁴⁵⁶⁷⁸⁹]|E[−-]?\d/.test(t)) return false;
    const words = t.match(/[\p{L}_][\p{L}\p{Nd}_]+/gu) || [];
    return words.every((w) => MATH_WORDS.test(w));
  }
  // The engine's messages are in English (libqalculate has no Japanese or Spanish translation). In
  // Japanese and Spanish, the common ones are translated, and so are the messages of the app's own
  // Java code and engine: [the English message, its Japanese text, its Spanish text]
  const MESSAGES = [
    [/^It has been (\d+) days? since the exchange rates last were updated\.?$/, (m, d) => '為替レートが ' + d + ' 日間更新されていません（メニュー →「為替レートの更新」）',
      (m, d) => 'Los tipos de cambio no se actualizan desde hace ' + d + (d === '1' ? ' día' : ' días') + ' (menú → "Actualizar tipos de cambio")'],
    [/^Misplaced operator\(s\) "(.+)" ignored\.?$/, (m, o) => '余分な演算子「' + o + '」を無視しました',
      (m, o) => 'Se ignoró el operador sobrante "' + o + '"'],
    [/^Misplaced '(.+)' ignored\.?$/, (m, o) => '余分な「' + o + '」を無視しました',
      (m, o) => 'Se ignoró el "' + o + '" sobrante'],
    [/^Division by zero\.?$/, () => 'ゼロで割っています',
      () => 'División entre cero'],
    [/^Misplaced decimal separator ignored\.?$/, () => '余分な小数点を無視しました',
      () => 'Se ignoró el separador decimal sobrante'],
    [/^Floating point overflow\.?$/, () => '数が大きすぎて、小数では表せません',
      () => 'El número es demasiado grande para escribirlo como decimal'],
    [/^Floating point underflow\.?$/, () => '数が小さすぎて、小数では表せません',
      () => 'El número es demasiado pequeño para escribirlo como decimal'],
    [/^log\(\) with a single argument is considered ambiguous\. Please use ln\(\) or log10\(\) instead\.?$/,
      () => 'log() は底があいまいなので、自然対数（ln）として計算しました。自然対数は ln()、常用対数は log10() を使ってください',
      () => 'log() sin base se calculó como logaritmo natural (ln). Para el logaritmo decimal, usa log10()'],
    [/^Definite integral was approximated\.?$/, () => '定積分は数値計算による近似値です',
      () => 'La integral definida es un valor aproximado, calculado numéricamente'],
    [/^Empty expression in parentheses interpreted as zero\.?$/, () => '空のかっこは 0 として計算しました',
      () => 'Los paréntesis vacíos se tomaron como 0'],
    [/^A global unit or variable was deactivated\..*$/, () => '同じ名前の組み込みの単位・変数を一時的に置き換えました（新しい変数を削除すると元に戻ります）',
      () => 'Se reemplazó por ahora la unidad o variable integrada del mismo nombre (vuelve al eliminar la nueva variable)'],
    [/^You need at least (\d+) argument\(s\) \((.+)\) in function (.+)\(\)\.?$/, (m, n, a, f) => f + '() には引数が ' + n + ' 個以上必要です（' + a + '）',
      (m, n, a, f) => f + '() necesita al menos ' + n + (n === '1' ? ' argumento (' : ' argumentos (') + a + ')'],
    [/^You need at least (\d+) argument \((.+)\) in function (.+)\(\)\.?$/, (m, n, a, f) => f + '() には引数が ' + n + ' 個以上必要です（' + a + '）',
      (m, n, a, f) => f + '() necesita al menos ' + n + (n === '1' ? ' argumento (' : ' argumentos (') + a + ')'],
    [/^Did you mean "(.+)" \(instead of "(.+)"\)\?$/, (m, a, b) => '「' + b + '」ではなく「' + a + '」のことですか？',
      (m, a, b) => '¿Quisiste decir "' + a + '" (en lugar de "' + b + '")?'],
    [/^limit\(\) is incomplete and unreliable\.?$/, () => 'limit() は完全ではなく、結果が正しくない場合があります',
      () => 'limit() no está completo y el resultado puede no ser correcto'],
    [/^No unknown variable\/symbol was found\.?$/, () => '解く対象の未知数（変数）が見つかりません',
      () => 'No se encontró la incógnita (la variable) que se debe resolver'],
    [/^Conversion of only part of an expression is not supported.*$/, () => '式の一部だけを変換することはできません',
      () => 'No se puede convertir solo una parte de la expresión'],
    [/^Unable to find a solution\.?$/, () => '解が見つかりませんでした',
      () => 'No se encontró ninguna solución'],
    // analysis
    [/^Unable to integrate the expression\.?$/, () => 'この式は積分できませんでした',
      () => 'No se pudo integrar esta expresión'],
    [/^Unable to integrate the expression exactly\.?$/, () => 'この式は厳密には積分できませんでした',
      () => 'No se pudo integrar esta expresión de forma exacta'],
    [/^Unable to find limit\.?$/, () => '極限を求められませんでした',
      () => 'No se pudo hallar el límite'],
    [/^No differential equation found\.?$/, () => '微分方程式が見つかりません（例：dsolve(diff(y, x) = y)）',
      () => 'No se encontró ninguna ecuación diferencial (por ejemplo: dsolve(diff(y, x) = y))'],
    [/^Unable to solve differential equation\.?$/, () => 'この微分方程式は解けませんでした',
      () => 'No se pudo resolver esta ecuación diferencial'],
    [/^To avoid division by zero, the following must be true: (.+)\.$/, (m, c) => 'ゼロで割らないための条件：' + c,
      (m, c) => 'Condición para no dividir entre cero: ' + c],
    [/^Was unable to isolate (.+) with the current assumptions\. The assumed (?:type and )?sign was therefore temporarily set as unknown\.?$/,
      (m, x) => x + ' を実数として求められなかったため、その仮定を外して解きました（複素数の解を含むことがあります）',
      (m, x) => 'No se pudo hallar ' + x + ' como número real, así que se resolvió sin esa suposición (puede haber soluciones complejas)'],
    [/^Was unable to completely isolate (.+)\.$/, (m, x) => x + ' について完全には解けませんでした',
      (m, x) => 'No se pudo despejar ' + x + ' por completo'],
    [/^Was unable to isolate (.+)\.$/, (m, x) => x + ' について解けませんでした',
      (m, x) => 'No se pudo despejar ' + x],
    [/^"(.+)" is not a valid variable\/function\/unit\.?$/, (m, a) => '「' + a + '」という変数・関数・単位はありません',
      (m, a) => 'No existe ninguna variable, función o unidad "' + a + '"'],
    [/^No possible solution was found \(with current assumptions\)\.?$/, () => '条件に合う解はありません',
      () => 'No hay ninguna solución que cumpla las condiciones'],
    [/^Argument (\d+), (.+), in (.+)\(\) must be an unknown variable\/symbol\.?$/, (m, n, a, f) => f + '() の ' + n + ' 番目の引数は、x のような変数（文字）でなければなりません',
      (m, n, a, f) => 'El argumento ' + n + ' de ' + f + '() debe ser una variable (una letra como x)'],
    [/^Argument (\d+), (.+), in (.+)\(\) must be an integer >= (-?\d+)(?: and <= \d+)?\.?$/, (m, n, a, f, lo) => f + '() の ' + n + ' 番目の引数は、' + lo + ' 以上の整数でなければなりません',
      (m, n, a, f, lo) => 'El argumento ' + n + ' de ' + f + '() debe ser un número entero mayor o igual que ' + lo],
    [/^Argument (\d+), (.+), in (.+)\(\) must be an integer\.?$/, (m, n, a, f) => f + '() の ' + n + ' 番目の引数は整数でなければなりません（∞ は使えません）',
      (m, n, a, f) => 'El argumento ' + n + ' de ' + f + '() debe ser un número entero (no se puede usar ∞)'],
    // matrices and vectors
    [/^Inverse of singular matrix\.?$/, () => '逆行列がありません（行列式が 0 の行列です）',
      () => 'La matriz no tiene inversa (su determinante es 0)'],
    [/^Please use the cross\(\), dot\(\), and hadamard\(\) functions for vector multiplication\.?$/,
      () => 'ベクトルどうしの積は、cross()（外積）、dot()（内積）、hadamard()（要素ごとの積）を使ってください',
      () => 'Para multiplicar vectores, usa cross() (producto vectorial), dot() (producto escalar) o hadamard() (producto elemento a elemento)'],
    [/^The second matrix must have as many rows \(was (\d+)\) as the first has columns \(was (\d+)\) for matrix multiplication\.?$/,
      (m, r, c) => '行列の積は、左の行列の列の数（' + c + '）と右の行列の行の数（' + r + '）が同じでなければ計算できません',
      (m, r, c) => 'Para multiplicar matrices, el número de columnas de la matriz de la izquierda (' + c + ') debe ser igual al número de filas de la de la derecha (' + r + ')'],
    [/^Argument (\d+), (.+), in (.+)\(\) must be a square matrix\.?$/, (m, n, a, f) => f + '() の ' + n + ' 番目の引数は正方行列（行と列の数が同じ行列）でなければなりません',
      (m, n, a, f) => 'El argumento ' + n + ' de ' + f + '() debe ser una matriz cuadrada (con tantas filas como columnas)'],
    [/^(.+)\(\) requires that all matrices\/vectors have the same dimensions\.?$/, (m, f) => f + '() に渡す行列・ベクトルは、すべて同じ大きさでなければなりません',
      (m, f) => 'Las matrices o vectores de ' + f + '() deben tener todos el mismo tamaño'],
    // the app's Java code (Engine.java, RatesUpdater.java, MainActivity.java)
    [/^Communication with the calculation engine failed \((.*)\)$/, (m, e) => '計算エンジンとのやりとりに失敗しました（' + e + '）',
      (m, e) => 'Falló la comunicación con el motor de cálculo (' + e + ')'],
    [/^Could not start the calculation engine \((.*)\)$/, (m, e) => '計算エンジンを起動できませんでした（' + e + '）',
      (m, e) => 'No se pudo iniciar el motor de cálculo (' + e + ')'],
    [/^The request is not valid$/, () => '要求の形式が正しくありません',
      () => 'La solicitud no es válida'],
    [/^The calculation was stopped$/, () => '計算を中止しました',
      () => 'Se detuvo el cálculo'],
    [/^The calculation took too long and was stopped$/, () => '時間がかかりすぎたため計算を中止しました',
      () => 'El cálculo tardó demasiado y se detuvo'],
    [/^The calculation engine stopped unexpectedly\. Try a simpler expression\.$/, () => '計算エンジンが異常終了しました。式を簡単にしてお試しください',
      () => 'El motor de cálculo se detuvo de forma inesperada. Prueba con una expresión más simple.'],
    [/^Could not update the exchange rates$/, () => '為替レートの更新に失敗しました',
      () => 'No se pudieron actualizar los tipos de cambio'],
    [/^Could not update the exchange rates \((.*)\)$/, (m, e) => '為替レートの更新に失敗しました（' + localMessage(e) + '）',
      (m, e) => 'No se pudieron actualizar los tipos de cambio (' + localMessage(e) + ')'],
    [/^Could not download the exchange rates\. Check the network connection\.$/, () => '為替レートをダウンロードできませんでした。通信状態を確認してください。',
      () => 'No se pudieron descargar los tipos de cambio. Revisa la conexión a internet.'],
    [/^The calculation engine could not load the new rates$/, () => '計算エンジンが新しいレートを読み込めませんでした',
      () => 'El motor de cálculo no pudo cargar los nuevos tipos de cambio'],
    // the engine's own messages (qalc-engine.cc)
    [/^Not enough memory for the calculation$/, () => '計算に必要なメモリが不足しました',
      () => 'No hay suficiente memoria para el cálculo'],
    [/^The expression is nested too deeply$/, () => '式の入れ子が深すぎます',
      () => 'La expresión tiene demasiados niveles anidados'],
    [/^Enter a name and a value$/, () => '名前と内容を入力してください',
      () => 'Ingresa un nombre y un valor'],
    [/^Check the value \((.*)\)$/, (m, p) => '内容を確認してください（' + localMessage(p) + '）',
      (m, p) => 'Revisa el valor (' + localMessage(p) + ')'],
    [/^The function name contains characters that cannot be used$/, () => '関数名に使えない文字が含まれています',
      () => 'El nombre de la función tiene caracteres que no se pueden usar'],
    [/^The variable name contains characters that cannot be used$/, () => '変数名に使えない文字が含まれています',
      () => 'El nombre de la variable tiene caracteres que no se pueden usar'],
    [/^"(.+)" is a built-in name and cannot be used$/, (m, n) => '「' + n + '」は組み込みの名前なので使えません',
      (m, n) => '"' + n + '" es un nombre integrado y no se puede usar'],
    [/^"to" cannot be used in the expression of a function$/, () => '関数の式に「to」は使えません',
      () => 'No se puede usar "to" en la expresión de una función'],
    [/^There is no user definition "(.+)"$/, (m, n) => 'ユーザー定義の「' + n + '」が見つかりません',
      (m, n) => 'No existe la definición del usuario "' + n + '"'],
    [/^Google Play is not available on this device$/, () => 'この端末では Google Play を利用できません',
      () => 'Google Play no está disponible en este dispositivo'],
    [/^Could not connect to Google Play\. Try again later\.$/, () => 'Google Play に接続できませんでした。しばらくしてから、もう一度お試しください。',
      () => 'No se pudo conectar con Google Play. Inténtalo de nuevo más tarde.'],
    [/^QCalc Pro cannot be bought right now$/, () => '現在 QCalc Pro を購入できません',
      () => 'Ahora mismo no se puede comprar QCalc Pro'],
    [/^No purchase of QCalc Pro was found$/, () => 'QCalc Pro の購入が見つかりませんでした',
      () => 'No se encontró ninguna compra de QCalc Pro'],
    [/^The purchase could not be completed \((.*)\)$/, (m, c) => '購入を完了できませんでした（' + c + '）',
      (m, c) => 'No se pudo completar la compra (' + c + ')'],
    [/^The payment is pending\. QCalc Pro will be unlocked when it is complete\.$/, () => '支払いの手続き中です。完了すると QCalc Pro が使えるようになります。',
      () => 'El pago está pendiente. QCalc Pro se desbloqueará cuando se complete.'],
    [/^Could not save the file$/, () => 'ファイルを保存できませんでした',
      () => 'No se pudo guardar el archivo'],
    [/^The middle of this long result is not shown \(([\d,]+) digits\)$/, (m, n) => '長い結果のため、途中を省略しています（全 ' + n + ' 桁）',
      (m, n) => 'El resultado es largo y no se muestra la parte del medio (' + n + ' dígitos en total)'],
    [/^The middle of this long result is not shown \(([\d,]+) characters\)$/, (m, n) => '長い結果のため、途中を省略しています（全 ' + n + ' 文字）',
      (m, n) => 'El resultado es largo y no se muestra la parte del medio (' + n + ' caracteres en total)'],
    [/^The middle of this long result is not shown$/, () => '長い結果のため、途中を省略しています',
      () => 'El resultado es largo y no se muestra la parte del medio'],
    // (after the more exact ones above) an argument of another kind than the function takes
    [/^Argument (\d+), (.+), in (.+)\(\) must be (.+?)\.?$/, (m, n, a, f, c) => f + '() の ' + n + ' 番目の引数が合っていません（' + c + '）',
      (m, n, a, f, c) => 'El argumento ' + n + ' de ' + f + '() no es del tipo correcto (' + c + ')'],
  ];
  // a message of the engine or of the app's Java code, in the language of the user interface
  function localMessage(text) {
    if (LANG === 'en' || typeof text !== 'string') return text;
    for (const [re, ja, es] of MESSAGES) {
      const m = re.exec(text);
      if (m) return (JA ? ja : es)(...m);
    }
    return text;
  }
  function showPreview(r) {
    msgEl.textContent = '';
    msgEl.className = 'msg';
    if (!r) { parsedEl.textContent = ''; previewEl.textContent = ''; return; }
    if (!r.ok) { previewEl.textContent = ''; msgEl.textContent = localMessage(r.error) || ''; msgEl.className = 'msg error'; return; }
    parsedEl.textContent = r.parsed || '';
    const err = (r.messages || []).find((m) => m.type === 'error');
    if (r.deferred) previewEl.textContent = tr('Press = to run it (definitions are not previewed)', '＝ を押すと実行します（定義など）');
    else if (r.timeout) previewEl.textContent = '…';
    else if (err) { previewEl.textContent = ''; msgEl.textContent = localMessage(err.text); msgEl.className = 'msg error'; }
    else {
      showResult(previewEl, resultText(r));
      fitMatrices(previewEl);
      const warns = (r.messages || []).filter((m) => m.type === 'warning').slice(0, 2), warn = warns[0];
      const notes = warns.map((m) => localMessage(m.text));
      if (r.truncated) notes.push(localMessage(cutMessage(r)));
      if (notes.length) { msgEl.textContent = notes.join(' '); if (!warn) msgEl.className = 'msg note'; }
    }
  }
  // "The middle of this long result is not shown (456,574 digits)", for a result longer than MAX_RESULT
  function cutMessage(r) {
    const digits = Number(r.digits) || 0, chars = Number(r.chars) || 0;
    const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const size = digits && digits >= chars * 0.6 ? ' (' + n(digits) + ' digits)' : chars ? ' (' + n(chars) + ' characters)' : '';
    return 'The middle of this long result is not shown' + size;
  }

  // ============================================================ commit
  let committing = false, stopping = false, busyTimer = null;
  async function commit() {
    const raw = exprEl.value.trim();
    if (!raw || committing) return;
    if (!engineReady) { toast(tr('The calculation engine is starting', '計算エンジンを準備中です')); return; }
    const expr = withoutOpenTo(normalizeExpr(raw));
    if (!expr) return;
    if (expr.indexOf('□') >= 0) {
      selectBox(false);
      msgEl.textContent = tr('Fill in the boxes □ first', '先に □ の欄を埋めてください');
      msgEl.className = 'msg error';
      return;
    }
    committing = true;
    stopping = false;
    clearTimeout(previewTimer);
    previewEl.textContent = tr('Calculating…', '計算中…');
    // from the first second: the seconds so far, and that a tap stops the calculation
    const limit = timeLimit(), started = Date.now();
    busyTimer = setInterval(() => {
      if (!committing || stopping) return;
      const s = Math.floor((Date.now() - started) / 1000);
      if (s >= 1) previewEl.textContent = tr(`Calculating… ${s} s (tap here to stop)`, `計算中… ${s} 秒（ここをタップで中止）`, `Calculando… ${s} s (toca aquí para detener)`);
    }, 1000);
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: limit * 1000, store: true, max_chars: MAX_RESULT, tail_chars: TAIL_RESULT });
    if (r.ok && r.result && !r.timeout) await withNotes(r, expr);
    committing = false;
    clearInterval(busyTimer);
    clearInterval(cancelTimer);
    if (!r.ok) {
      previewEl.textContent = '';
      msgEl.textContent = r.code === 'cancelled' ? tr('The calculation was stopped', '計算を中止しました') : (localMessage(r.error) || tr('Could not calculate', '計算できませんでした'));
      msgEl.className = 'msg error';
      return;
    }
    if (r.timeout) {
      previewEl.textContent = '';
      msgEl.textContent = tr(`The calculation took longer than the time limit (${limit} s) and was stopped. The time limit can be changed in Settings`,
        `制限時間（${limit} 秒）を過ぎたため計算を中止しました。制限時間は設定で変えられます`,
        `El cálculo superó el tiempo límite (${limit} s) y se detuvo. El tiempo límite se puede cambiar en Ajustes`);
      msgEl.className = 'msg error';
      return;
    }
    if (!r.result) {
      const err = (r.messages || []).find((m) => m.type === 'error');
      previewEl.textContent = '';
      msgEl.textContent = err ? localMessage(err.text) : tr('Check the expression', '式を確認してください');
      msgEl.className = 'msg error';
      return;
    }
    const entry = {
      expr, result: r.result, approx: r.approx, cmp: r.comparison, base: Number(S.base),
      msgs: (r.messages || []).filter((m) => m.type !== 'info').slice(0, 3), t: Date.now()
    };
    if (r.truncated) { // longer than MAX_RESULT: the engine ended it with "…" and sent its end
      entry.cut = true;
      if (typeof r.tail === 'string' && r.tail) entry.tail = r.tail;
      entry.msgs.push({ type: 'warning', text: cutMessage(r) });
    }
    if (earlyInputs.has(r.id)) { setInput(entry, earlyInputs.get(r.id)); earlyInputs.delete(r.id); }
    else {
      sessionEntries.set(r.id, entry);
      if (sessionEntries.size > 20) sessionEntries.delete(sessionEntries.keys().next().value);
    }
    history.push(entry);
    const over = history.length > 300;
    if (over) history = history.slice(-300);
    const shortened = fitHistory();
    saveHistory();
    dropUndo();
    if (exprEl.value.trim() === raw) {
      exprEl.value = '';
      showPreview(null);
      autosize();
      updateSuggest(false);
    } else {
      previewEl.textContent = '';
      exprChanged(); // something was typed while the calculation ran: keep it
    }
    saveDraft();
    // only the new line is added, unless the lines on the screen are no longer the history
    // (the first result, the oldest line dropped, an older long result shortened)
    if (over || shortened || histEl.children.length !== history.length - 1 || !histEl.querySelector('.h-item')) renderHistory(true);
    else {
      const item = historyItem(entry);
      histEl.append(item);
      fitMatrices(item);
      histEl.scrollTop = histEl.scrollHeight;
      histPinned = true;
    }
    announce(entry);
    definitionMade(r, expr);
  }
  // "x = 5" and "f(x) := x^2" define a variable or a function. From then on every expression uses
  // it (x is 5 in the forms too), which is easy to do by mistake when an equation was meant: a
  // message says so and offers to take the definition back.
  const definedVars = new Set(); // the names of the user's variables
  async function refreshDefined() {
    const r = await Bridge.send('user_defs');
    if (!r.ok) return;
    definedVars.clear();
    for (const v of r.variables || []) definedVars.add(v.name);
  }
  function definitionMade(r, expr) {
    const m = /^save\(.*?, '([^']+)',/.exec(r.parsed || '');
    if (!m) return;
    const name = m[1], kind = new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(').test(expr) ? 'function' : 'variable';
    invalidateCatalogs();
    const shown = kind === 'function' ? name + '()' : name;
    toast(kind === 'function' ? tr(`${shown} is defined`, `${shown} を定義しました`, `Se definió ${shown}`)
      : tr(`${shown} is now ${clip(r.result, 24)} in every expression`, `これ以降、${shown} は ${clip(r.result, 24)} として計算します`,
        `Desde ahora, ${shown} vale ${clip(r.result, 24)} en todas las expresiones`), 9000,
    [tr('Undo', '取り消す'), async () => {
      const d = await Bridge.send('delete_def', { kind, name });
      if (!d.ok) { toast(localMessage(d.error)); return; }
      invalidateCatalogs();
      await refreshDefined();
      toast(tr(`The definition of ${shown} was taken back`, `${shown} の定義を取り消しました`, `Se deshizo la definición de ${shown}`));
      if (CF.id) formChanged(); else exprChanged();
    }]);
  }

  function setInput(h, input) {
    if (typeof input !== 'string' || !input) return;
    if (input.length > MAX_INPUT) h.big = true;
    else h.input = input;
  }
  // The engine reports the exact text of each new ans after the result (see qalc-engine.cc).
  const sessionEntries = new Map(), earlyInputs = new Map();
  Bridge.setEventHandler((ev) => {
    if (ev.event === 'pro') { proChanged(ev); return; }
    if (ev.event === 'saved') { fileSaved(ev); return; }
    if (ev.event !== 'ans') return;
    const h = sessionEntries.get(ev.id);
    if (h) { sessionEntries.delete(ev.id); setInput(h, ev.input); saveHistory(); return; }
    earlyInputs.set(ev.id, ev.input);
    if (earlyInputs.size > 20) earlyInputs.delete(earlyInputs.keys().next().value);
  });
  // screen readers hear only the newest result (and only the beginning of a long one)
  function announce(h) {
    const st = $('#status');
    if (st) st.textContent = clip(h.expr, 200) + tr(', ', '、') + clip(displayResult(h), 200);
  }

  // "Calculating… (tap here to stop)". The engine handles one request at a time, so a preview that was
  // still running may be the one that gets stopped; the request is repeated until this calculation ends.
  let cancelTimer = null;
  previewEl.addEventListener('click', () => {
    if (!committing || !window.QalcNative || !QalcNative.cancel) return;
    stopping = true;
    previewEl.textContent = tr('Stopping…', '中止しています…');
    QalcNative.cancel();
    clearInterval(cancelTimer);
    cancelTimer = setInterval(() => { if (committing) QalcNative.cancel(); else clearInterval(cancelTimer); }, 400);
  });

  // ===================================================== calculus forms
  // Derivatives, integrals, limits, sums, products, differential equations and substituting a value
  // are entered in a form instead of a template: boxes laid out the way the mathematics is written
  // (the limits above and below ∫, the variable under lim …). The form takes the place of the history
  // and the input field, and the keys type into the box that has the focus (editTarget). "Insert"
  // puts the expression into the input field, where a needed box that is still empty becomes □ to be
  // filled in; "Calculate" (or =) inserts it and calculates it. The result is previewed while typing.
  const cformEl = $('#cform');
  const CF = { id: null, boxes: {}, order: [], sel: [0, 0], dir: '', seq: 0, timer: null, nodes: null, reveal: false,
    hist: [], hi: -1, histK: '', histT: 0, histT0: 0, typing: false, restoring: false, navSel: null, base: null };
  function formBoxes() { return CF.id ? CF.order.map((k) => CF.boxes[k]) : []; }
  // the layout: rows, columns, an operator with a box above and below it, symbols and labels
  const cfRow = (...c) => el('div', { class: 'cf-row' }, ...c);
  const cfCol = (...c) => el('div', { class: 'cf-col' }, ...c);
  const cfOp = (top, sym, bottom) => el('div', { class: 'cf-op' }, top || el('span'), sym, bottom || el('span'));
  const cfBig = (t, cls) => el('span', { class: 'cf-big' + (cls ? ' ' + cls : ''), text: t, 'aria-hidden': 'true' });
  const cfT = (t) => el('span', { class: 'cf-t', text: t });
  const cfLbl = (t, box) => el('label', { class: 'cf-lbl' }, typeof t === 'string' ? el('span', { text: t }) : t, box);
  // A form: its title, the boxes in the order "Next" goes through them ([key, placeholder, needed,
  // value when empty]), the layout, and the expression it makes (g(key) gives a box's value, □ for a
  // needed box that is empty, '' for an optional one).
  const FORMS = {
    int: {
      title: tr('Integral', '積分'),
      boxes: [['f', 'f(x)', true], ['a', tr('lower', '下端')], ['b', tr('upper', '上端')], ['v', 'x', false, 'x']],
      hint: tr('Leave both limits empty for the indefinite integral', '上端と下端を空にすると不定積分になります'),
      layout: (B) => [cfRow(cfOp(B.b, cfBig('∫', 'int'), B.a), B.f, cfT('d'), B.v)],
      build: (g) => {
        const f = g('f'), a = g('a'), b = g('b'), v = g('v');
        if (!a && !b) return v === 'x' ? `integrate(${f})` : `integrate(${f}, undefined, undefined, ${v})`;
        return `integrate(${f}, ${a || '□'}, ${b || '□'}${v === 'x' ? '' : ', ' + v})`;
      }
    },
    diff: {
      title: tr('Derivative', '微分'),
      boxes: [['f', 'f(x)', true], ['v', 'x', false, 'x'], ['n', '1', false, '1'], ['at', tr('(none)', '（なし）')]],
      hint: tr('With a value of the variable, the result is the derivative at that point', '変数の値を入れると、その点での微分係数になります'),
      layout: (B, N) => [cfRow(N.op = el('span', { class: 'cf-tex' }), B.f),
        el('div', { class: 'cf-opts' }, cfLbl(tr('variable', '変数'), B.v), cfLbl(tr('order', '階数'), B.n),
          cfLbl(N.at = el('span', { text: 'x =' }), B.at))],
      update: (g, N) => {
        const v = g('v').replace(/^\\/, ''), n = g('n');
        const d = n === '1' ? '\\frac{\\mathrm{d}}{\\mathrm{d}' + v + '}' : '\\frac{\\mathrm{d}^{' + n + '}}{\\mathrm{d}' + v + '^{' + n + '}}';
        renderTeX(N.op, d, v + ' ' + n);
        N.at.textContent = v + ' =';
      },
      build: (g) => {
        const f = g('f'), v = g('v'), n = g('n'), at = g('at');
        if (at) return `diff(${f}, ${v}, ${n}, ${at})`;
        if (n !== '1') return `diff(${f}, ${v}, ${n})`;
        return v === 'x' ? `diff(${f})` : `diff(${f}, ${v})`;
      }
    },
    lim: {
      title: tr('Limit', '極限'),
      boxes: [['f', 'f(x)', true], ['v', 'x', false, 'x'], ['a', 'a', true]],
      dirs: true,
      layout: (B) => [cfRow(cfOp(null, cfBig('lim', 'lim'), cfRow(B.v, cfT('→'), B.a)), B.f)],
      build: (g, dir) => {
        const f = g('f'), v = g('v'), a = g('a');
        return `limit(${f}, ${a}${v !== 'x' || dir ? ', ' + v : ''}${dir ? ', ' + dir : ''})`;
      }
    },
    sum: {
      title: tr('Sum', '総和'),
      boxes: [['f', 'f(x)', true], ['v', 'x', false, 'x'], ['a', tr('from', '始め'), true], ['b', tr('to', '終わり'), true]],
      layout: (B) => [cfRow(cfOp(B.b, cfBig('Σ'), cfRow(B.v, cfT('='), B.a)), B.f)],
      build: (g) => `sum(${g('f')}, ${g('a')}, ${g('b')}${g('v') === 'x' ? '' : ', ' + g('v')})`
    },
    prod: {
      title: tr('Product', '総乗'),
      boxes: [['f', 'f(x)', true], ['v', 'x', false, 'x'], ['a', tr('from', '始め'), true], ['b', tr('to', '終わり'), true]],
      layout: (B) => [cfRow(cfOp(B.b, cfBig('Π'), cfRow(B.v, cfT('='), B.a)), B.f)],
      build: (g) => `product(${g('f')}, ${g('a')}, ${g('b')}${g('v') === 'x' ? '' : ', ' + g('v')})`
    },
    dsolve: {
      title: tr('Differential equation', '微分方程式'),
      boxes: [['r', 'f(x, y)', true], ['y0', tr('(none)', '（なし）')]],
      hint: tr('y′ is dy/dx. Without y(0) the result is the general solution (with a constant C)', 'y′ は dy/dx です。y(0) を空にすると一般解（定数 C を含む）になります'),
      layout: (B) => [cfCol(cfRow(cfTeX("y' =", 'y′ ='), B.r), cfRow(cfTeX('y(0) =', 'y(0) ='), B.y0))],
      build: (g) => `dsolve(diff(y, x) = ${g('r')}${g('y0') ? ', ' + g('y0') : ''})`
    },
    solve: {
      title: tr('Solve equations', '方程式を解く'),
      eqs: true,
      boxes: [],
      build: () => solveExpr()
    },
    mat: {
      title: tr('Matrix', '行列'),
      matrix: true,
      boxes: [],
      build: () => matrixExpr()
    },
    subst: {
      title: tr('Substitute a value', '値を代入'),
      boxes: [['f', 'f(x)', true], ['v', 'x', false, 'x'], ['a', tr('value', '値'), true]],
      layout: (B) => [cfRow(B.f, cfBig('|', 'bar'), B.v, cfT('='), B.a)],
      build: (g) => `${wrapValue(g('f'))} where ${g('v')} = ${g('a')}`
    }
  };
  // the width of a text in ch: Japanese (full-width) characters count twice
  const textWidth = (t) => Array.from(t).reduce((n, c) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(c) ? 2 : 1), 0);
  // a symbol or label written in TeX (y′ =)
  const cfTeX = (texSrc, text) => { const n = el('span', { class: 'cf-t' }); renderTeX(n, texSrc, text); return n; };
  function renderTeX(node, texSrc, fallback) {
    try { if (window.katex) { window.katex.render('\\displaystyle ' + texSrc, node, { throwOnError: false, strict: 'ignore' }); return; } } catch (e) { }
    node.textContent = fallback;
  }
  // ---- what a box holds, checked. A box takes one expression. Its parentheses are closed when
  // some are missing (as "=" does for the whole input), so that "(x + 1" in the box of the function
  // does not swallow the limits that follow it; a ")" too many, or a "," or ";" outside parentheses,
  // would change what the whole expression means and is reported on the box instead (formProblems).
  function scanBox(t) {
    let d = 0, sq = 0, extra = false, comma = false, bracket = false;
    for (const c of t) {
      if (c === '(') d++;
      else if (c === ')') { if (d) d--; else extra = true; }
      else if (c === '[') { sq++; bracket = true; }
      else if (c === ']') { if (sq) sq--; bracket = true; }
      else if ((c === ',' || c === ';') && !d && !sq) comma = true;
    }
    return { open: d, extra, comma, bracket };
  }
  // the text of a box as it goes into the expression
  function boxText(k) {
    const b = CF.boxes[k];
    const t = b ? normalizeExpr(b.value) : '';
    return t ? t + ')'.repeat(scanBox(t).open) : '';
  }
  const isName = (t) => /^\\?[\p{L}_][\p{L}\p{Nd}_]*$/u.test(t);
  // A variable such as k or t is an unknown for the engine only as \k or \t (t alone is the tonne).
  // The letter typed in the other boxes means the variable of the form, so it is written the same way.
  function asUnknown(t, name) {
    if (!t || !name || name[0] !== '\\') return t;
    const l = name.slice(1);
    return t.replace(/\\?[\p{L}_][\p{L}\p{Nd}_]*/gu, (tok) => (tok === l ? name : tok));
  }
  // A letter as the unknown of a form: \t for a letter that is a unit or a constant, and also for a
  // letter that the user gave a value (after "x = 5", x is written \x: the form integrates or
  // solves for x all the same; the result then shows it as 'x').
  const formUnknown = (l) => (definedVars.has(l) ? '\\' + l : varText(l));
  // the letter of the form that the user gave a value, or ''
  function formDefinedVar() {
    const F = FORMS[CF.id];
    if (!definedVars.size) return '';
    if (F.matrix) return CF.mat.op === 'eig' && definedVars.has('x') ? 'x' : '';
    if (F.eqs) { const ns = eqNames(); return (ns.length ? ns : ['x', 'y', 'z', 'w', 'u', 'v'].slice(0, CF.eq.n)).find((l) => definedVars.has(l)) || ''; }
    if (!CF.boxes.v) return '';
    const v = normalizeExpr(CF.boxes.v.value) || 'x';
    return definedVars.has(v) ? v : '';
  }
  // the variable of the form as the engine reads it (\k), or '' (x, y, z, n as they are, or none)
  function formVar() {
    if (!CF.boxes.v || FORMS[CF.id].eqs) return '';
    const v = normalizeExpr(CF.boxes.v.value) || 'x';
    return /^\p{L}$/u.test(v) ? formUnknown(v) : '';
  }
  function formValue(k) {
    const d = FORMS[CF.id].boxes.find((b) => b[0] === k);
    let v = boxText(k);
    if (k === 'v') {
      const t = v || (d[3] !== undefined ? d[3] : '');
      return /^\p{L}$/u.test(t) ? formUnknown(t) : t; // a variable t is written \t
    }
    v = asUnknown(v, formVar());
    return v || (d[3] !== undefined ? d[3] : d[2] ? '□' : '');
  }
  // the letters to solve for in the equations form ("x, y" or "x y")
  function eqNames() {
    const v = CF.boxes.v ? normalizeExpr(CF.boxes.v.value) : '';
    return v.split(/[\s,、]+/).filter(Boolean);
  }
  const countEq = (t) => (t.match(/(^|[^<>!=])=(?!=)/g) || []).length;
  // the boxes that cannot be used as they are: [{ k, msg }]
  function formProblems() {
    const F = FORMS[CF.id], out = [];
    const add = (k, msg) => { if (CF.boxes[k] && !out.some((x) => x.k === k)) out.push({ k, msg }); };
    for (const k of CF.order) {
      const t = normalizeExpr(CF.boxes[k].value);
      if (!t) continue;
      const sc = scanBox(t), cell = CF.boxes[k].classList.contains('cell');
      if (sc.extra) add(k, tr('There is a ")" without its "("', '「)」に対応する「(」がありません'));
      else if (sc.comma && !(F.eqs && k === 'v')) {
        add(k, cell ? tr('A cell takes one number or expression: "," and ";" cannot be used (the decimal point is ".")', '1 つの欄には数か式を 1 つだけ入れます。「,」や「;」は使えません（小数点は「.」）')
          : tr('"," and ";" cannot be used in this box', 'この欄に「,」や「;」は使えません'));
      } else if (sc.bracket && cell) add(k, tr('A cell takes one number or expression, not a matrix', '欄の中に行列（[ ]）は入れられません'));
    }
    if (F.eqs) {
      for (let i = 0; i < CF.eq.n; i++) {
        const l = boxText('l' + i), r = boxText('r' + i), n = countEq(l) + countEq(r);
        if (n > (r ? 0 : 1)) add(countEq(r) ? 'r' + i : 'l' + i, tr('An equation has one "=": its left side goes into the first box and its right side into the second', '「=」は 1 つの式に 1 つだけです（左の欄に左辺、右の欄に右辺を入れます）'));
      }
      const names = eqNames(), n = CF.eq.n;
      if (names.some((x) => !isName(x))) add('v', tr('The letters to solve for are written like x, y', '解く文字は「x, y」のように文字で入れてください'));
      else if (names.length && names.length !== n) {
        add('v', n > 1 ? tr(`${n} equations are solved for ${n} letters (for example ${['x', 'y', 'z', 'w', 'u', 'v'].slice(0, n).join(', ')})`, `式が ${n} つなので、解く文字も ${n} つ入れてください（例：${['x', 'y', 'z', 'w', 'u', 'v'].slice(0, n).join(', ')}）`,
          `${n} ecuaciones se resuelven para ${n} letras (por ejemplo ${['x', 'y', 'z', 'w', 'u', 'v'].slice(0, n).join(', ')})`)
          : tr('One equation is solved for one letter', '式が 1 つのときは、解く文字も 1 つです'));
      }
    } else if (CF.boxes.v) {
      const v = normalizeExpr(CF.boxes.v.value);
      if (v && !isName(v)) add('v', tr('The variable is one letter or name, such as x or t', '変数は x や t のような文字 1 つにしてください'));
    }
    if (CF.id === 'diff') {
      const n = normalizeExpr(CF.boxes.n.value);
      if (n && !/^[1-9]\d{0,2}$/.test(n)) add('n', tr('The order is a whole number from 1', '階数は 1 以上の整数にしてください'));
    }
    return out;
  }
  // the needed boxes that are empty; for an integral, both limits or neither (one limit alone: the other is needed)
  function formMissing() {
    const F = FORMS[CF.id];
    if (F.matrix) return [];
    if (F.eqs) return CF.order.filter((k) => k[0] === 'l' && !CF.boxes[k].value.trim());
    const empty = (k) => !CF.boxes[k].value.trim();
    const out = F.boxes.filter((b) => b[2] && empty(b[0])).map((b) => b[0]);
    if (CF.id === 'int' && empty('a') !== empty('b')) out.push(empty('a') ? 'a' : 'b');
    return out;
  }
  // init: values of the boxes ({ f: 'x^2', n: '2' }), the box to start in (focus), the direction of a limit (dir)
  function openForm(id, init) {
    const F = FORMS[id];
    if (!F) return;
    init = init || {};
    if (CF.id) closeForm();
    CF.id = id;
    CF.boxes = {};
    CF.order = init.order || F.boxes.map((b) => b[0]);
    CF.dir = init.dir || '';
    CF.nodes = {};
    // the expression replaces what is selected in the input field, or goes where the caret is;
    // a selection is put into the box of the function
    const len = exprEl.value.length;
    const ss = exprEl.selectionStart, se = exprEl.selectionEnd;
    CF.sel = [Math.min(ss === null || ss === undefined ? len : ss, len), Math.min(se === null || se === undefined ? len : se, len)];
    let selected = exprEl.value.slice(CF.sel[0], CF.sel[1]);
    if (selected === '□') selected = '';
    const given = (o) => !!(o.matrix || o.eqs || o.f !== undefined || o.r !== undefined);
    // an expression that this form made, alone in the input field, is read back into the boxes
    // and replaced by the new one ("integrate(x^2, 0, 1)" and the ∫ key: x^2, 0 and 1)
    if (!given(init) && !selected.trim() && exprEl.value.trim()) {
      const back = formFromExpr(id, exprEl.value);
      if (back) { init = Object.assign({}, init, back); CF.dir = init.dir || ''; CF.sel = [0, len]; }
    }
    // else the boxes are as they were left when the form was closed without being used (formDrafts)
    // (the matrix that was used is kept for a new calculation: not while an expression is being
    // typed, where the form is opened for a second matrix: [1, 2; 3, 4] × …)
    const kept = formDrafts[id] && formDrafts[id].vals && !(formDrafts[id].used && exprEl.value.trim()) ? formDrafts[id] : null;
    const D = !given(init) && !selected.trim() ? kept : null;
    if (!F.matrix && !F.eqs) {
      for (const [k, ph] of F.boxes) {
        const b = makeFormBox(k, ph, k === 'f' || k === 'r' ? 'wide' : '');
        b.value = init[k] !== undefined ? String(init[k]) : D ? String(D.vals[k] || '') : '';
        CF.boxes[k] = b;
      }
      if (D && !init.dir && D.dir) CF.dir = D.dir;
      // (for a differential equation the box of its right side y′ = …)
      const fk = CF.boxes.f ? 'f' : CF.boxes.r ? 'r' : '';
      if (selected && fk && init[fk] === undefined) CF.boxes[fk].value = selected.trim();
    } else if (F.eqs) {
      if (D) CF.eq = { n: Math.max(1, Math.min(Number(D.n) || 1, EQ_MAX)), vals: Object.assign({}, D.vals) };
      else {
        // equations: from init.eqs, else an equation (or an expression = 0) selected in the input field
        const eqs = init.eqs || (selected && selected.trim() ? [selected.trim()] : ['']);
        CF.eq = { n: Math.min(eqs.length, EQ_MAX), vals: { v: init.vars || '' } };
        eqs.slice(0, EQ_MAX).forEach((e, i) => {
          const m = /^(.*?)\s*=\s*(.*)$/.exec(e);
          CF.eq.vals['l' + i] = m ? m[1] : e;
          CF.eq.vals['r' + i] = m ? m[2] : '';
        });
      }
    } else {
      // a matrix: from init.matrix, else from a matrix that is selected in the input field, else
      // the matrix that was entered last (kept until "Clear"), else 2 × 2
      const m = parseMatrix(init.matrix || (selected && selected.trim()));
      const size = (n) => Math.max(1, Math.min(Number(n) || 2, MAT_MAX));
      if (!m && D) CF.mat = { rows: size(D.rows), cols: size(D.cols), op: init.op !== undefined ? init.op : D.op || '', vals: Object.assign({}, D.vals) };
      else {
        const rows = m ? m.rows : [['', ''], ['', '']];
        CF.mat = { rows: rows.length, cols: rows[0].length, op: init.op || '', vals: {} };
        rows.forEach((r, i) => r.forEach((x, j) => { CF.mat.vals['c' + i + '_' + j] = x; }));
      }
    }
    CF.hist = []; CF.hi = -1; CF.typing = false; CF.navSel = null; CF.base = null;
    const next = tapButton({ class: 'cf-next', text: tr('Next box ▶', '次の欄 ▶') }, () => formNext());
    const close = tapButton({ class: 'icon-btn', 'aria-label': tr('Close', '閉じる'), html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>' }, () => closeForm());
    // undo and redo of what was done in the form, and a menu (clear; rows and columns of a matrix)
    const arrow = (d) => '<svg viewBox="0 0 24 24" width="20" height="20"' + (d > 0 ? ' style="transform:scaleX(-1)"' : '') + '><path d="M9 7L4 12l5 5M4 12h10a5 5 0 0 1 0 10h-3" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    CF.nodes.undo = tapButton({ class: 'icon-btn cf-ic', 'aria-label': tr('Undo', '元に戻す'), title: tr('Undo', '元に戻す'), html: arrow(-1) }, () => formStep(-1));
    CF.nodes.redo = tapButton({ class: 'icon-btn cf-ic', 'aria-label': tr('Redo', 'やり直す'), title: tr('Redo', 'やり直す'), html: arrow(1) }, () => formStep(1));
    const more = tapButton({ class: 'icon-btn cf-ic cf-more', 'aria-label': tr('More: clear, rows and columns', 'その他（消去、行と列）'), text: '⋯' }, () => formMenu());
    const body = el('div', { class: 'cf-body' });
    if (F.matrix) matrixLayout(body);
    else if (F.eqs) equationsLayout(body);
    else body.append(...F.layout(CF.boxes, CF.nodes));
    if (F.dirs) {
      const seg = CF.nodes.seg = el('div', { class: 'seg cf-seg', role: 'group', 'aria-label': tr('Direction', '近づき方') });
      for (const [d, t] of [['', tr('Both sides', '両側')], ['1', tr('From the right (+)', '右から（+）')], ['−1', tr('From the left (−)', '左から（−）')]]) {
        const b = tapButton({ text: t }, () => { CF.dir = d; for (const x of seg.children) x.classList.toggle('on', x === b); formChanged(); });
        b.dataset.d = d;
        b.classList.toggle('on', d === CF.dir);
        seg.append(b);
      }
      body.append(seg);
    }
    if (CF.boxes.v && !F.eqs) {
      // the variable: one tap on a letter puts it into the variable box
      CF.nodes.vars = el('div', { class: 'cf-vars', role: 'group', 'aria-label': tr('Variable', '変数') });
      for (const l of ['x'].concat(VAR_LETTERS)) {
        CF.nodes.vars.append(tapButton({ class: 'cf-var', text: l }, () => { CF.boxes.v.value = l; formChanged(); CF.boxes.v.focus(); }));
      }
      CF.nodes.vars.hidden = true;
      body.append(CF.nodes.vars);
    }
    CF.nodes.expr = el('div', { class: 'cf-expr' });
    CF.nodes.note = el('div', { class: 'cf-hint cf-note', hidden: true });
    CF.nodes.res = el('div', { class: 'cf-res', 'aria-live': 'polite' });
    CF.nodes.msg = el('div', { class: 'cf-msg' });
    cformEl.textContent = '';
    // (beside the title of the matrix form: where the cell being edited is, "row 2, column 3", as
    // the name box of a spreadsheet shows it)
    CF.nodes.pos = F.matrix ? el('small', { class: 'cf-pos' }) : null;
    cformEl.append(el('div', { class: 'cf-bar' }, close, el('div', { class: 'cf-title' }, F.title, CF.nodes.pos), CF.nodes.undo, CF.nodes.redo, more, next),
      body, CF.nodes.hint = el('div', { class: 'cf-hint', text: (F.matrix ? MAT_HINT[CF.mat.op] : F.eqs ? eqHint() : F.hint) || '' }), CF.nodes.note, CF.nodes.expr, CF.nodes.res, CF.nodes.msg,
      el('div', { class: 'cf-actions' },
        CF.nodes.graph = tapButton({ class: 'btn cf-graph', text: '📈', title: tr('Graph', 'グラフ'), 'aria-label': tr('Draw a graph', 'グラフに描く') }, () => formGraph()),
        tapButton({ class: 'btn', text: tr('Insert', '式に入れる') }, () => formInsert(false)),
        tapButton({ class: 'btn primary', text: tr('Calculate', '計算する') }, () => formCalculate())));
    cformEl.hidden = false;
    document.body.classList.add('cform-open');
    const first = init.focus || formMissing()[0] || CF.order[0];
    editTarget = CF.boxes[first] || CF.boxes[CF.order[0]];
    CF.reveal = true; // a form opened with its boxes filled in (from the history) shows its result
    // (a form as its key made it, with no draft and nothing brought along: not kept as a draft)
    CF.base = !D && !given(init) && !selected.trim() ? JSON.stringify(formSnapshot()) : null;
    formChanged();
    focusExpr();
    // what is already in the first box is selected: typing replaces it, ◀ ▶ edit it
    if (editTarget && editTarget.value) { try { editTarget.select(); CF.navSel = editTarget; } catch (e) { } }
  }
  function makeFormBox(k, ph, cls) {
    const b = el('input', { class: 'cf-box' + (cls ? ' ' + cls : ''), placeholder: ph, inputmode: exprEl.inputMode === 'text' ? 'text' : 'none',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': ph });
    b.dataset.k = k;
    b.addEventListener('focus', () => {
      editTarget = b;
      for (const x of formBoxes()) x.classList.toggle('on', x === b);
      // the letters for the variable show while its box is being edited ("Solve for" of equations too)
      if (CF.nodes && CF.nodes.vars) CF.nodes.vars.hidden = k !== 'v';
      showCellPos(b);
    });
    // a tap puts the caret into the text (a box reached with "Next box", Enter or the arrows is selected as a whole)
    b.addEventListener('pointerdown', () => { CF.navSel = null; });
    b.addEventListener('input', (e) => {
      if (e.isComposing) return;
      CF.navSel = null;
      const p = b.selectionStart, q = b.value; b.value = normalizeJa(q); if (b.value !== q) b.setSelectionRange(p, p);
      CF.reveal = true; CF.typing = true; formChanged();
    });
    b.addEventListener('compositionend', () => { b.value = normalizeJa(b.value); CF.reveal = true; CF.typing = true; formChanged(); });
    b.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey, key = e.key;
      if (mod && (key === 'z' || key === 'Z')) { e.preventDefault(); formStep(e.shiftKey ? 1 : -1); return; }
      if (mod && (key === 'y' || key === 'Y')) { e.preventDefault(); formStep(1); return; }
      if (key === 'Enter') { e.preventDefault(); formEnter(b, e); return; }
      if (key === 'Escape') { e.preventDefault(); closeForm(); return; }
      if (mod || e.altKey || e.shiftKey) return;
      // the arrow keys leave a box at the end of its text, or at once while the box is selected as
      // a whole; in a matrix ↑ and ↓ go to the row above and below
      const whole = CF.navSel === b && b.selectionStart === 0 && b.selectionEnd === b.value.length;
      const at = (pos) => b.selectionStart === pos && b.selectionEnd === pos;
      let to = '';
      if (key === 'ArrowUp' || key === 'ArrowDown') to = b.classList.contains('cell') ? (key === 'ArrowUp' ? 'up' : 'down') : '';
      else if (key === 'ArrowLeft' && (whole || at(0))) to = 'prev';
      else if (key === 'ArrowRight' && (whole || at(b.value.length))) to = 'next';
      if (to && formMove(b, to)) e.preventDefault();
    });
    // some keyboards send a line break as text instead of an Enter key press
    b.addEventListener('beforeinput', (e) => { if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); formEnter(b, null); } });
    // a table copied from a spreadsheet goes into the cells (a matrix), several lines into the equations
    b.addEventListener('paste', (e) => {
      const text = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (text && formPaste(b, text)) e.preventDefault();
    });
    return b;
  }

  // ---- the matrix form: a grid of cells (an empty cell is 0), its size, and what to calculate
  // up to 30 × 30 (the grid scrolls; determinants and inverses of that size take well under a second,
  // eigenvalues — the roots of det(A − x·I) — some seconds from about 12 × 12 on)
  const MAT_MAX = 30;
  const MAT_OPS = [['', tr('Matrix', '行列のまま')], ['det', tr('Determinant', '行列式')], ['inv', tr('Inverse', '逆行列')],
    ['tr', tr('Transpose', '転置')], ['rk', tr('Rank', '階数')], ['eig', tr('Eigenvalues', '固有値')], ['sys', tr('Linear system Ax = b', '連立方程式 Ax = b')]];
  const MAT_HINT = {
    '': tr('An empty cell is 0. A table copied in a spreadsheet can be pasted into the cells. For a product, insert the first matrix, type ×, then open this form again', '空の欄は 0 です。表計算ソフトでコピーした表は、欄に貼り付けるとまとめて入ります。行列の積は、1 つ目を「式に入れる」→ × → もう一度この画面で 2 つ目を入れます'),
    // (libqalculate's solve gives the real solutions of a cubic or higher when there are any: x³ = 1 gives 1)
    eig: tr('The eigenvalues are the solutions of det(A − x·I) = 0 (from 3 × 3 on, complex ones may be left out)', '固有値は det(A − x·I) = 0 の解として求めます（3 行以上では、複素数の固有値は出ないことがあります）'),
    sys: tr('Coefficients on the left, the right side b on the right of the line. The result is the values of x₁, x₂, …', '線の左に係数、右に右辺 b を入れます。結果は x₁, x₂, … の値です')
  };
  const squareOps = ['det', 'inv', 'eig', 'sys'];
  // "[1, 2; 3, 4]", "[−2  1; 1.5  −0.5]" (the engine's text) or "[1; 2; 3]" as rows of cells, or null
  function parseMatrix(t) {
    if (!t) return null;
    t = t.trim();
    if (outerParens(t)) t = t.slice(1, -1).trim();
    if (t[0] !== '[' || t[t.length - 1] !== ']') return null;
    const split = (s, seps) => {
      const out = []; let d = 0, cur = '';
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if ('([{'.indexOf(c) >= 0) d++;
        else if (')]}'.indexOf(c) >= 0) d--;
        if (d === 0 && seps(s, i)) { out.push(cur); cur = ''; if (s[i] === ' ') while (s[i + 1] === ' ') i++; continue; }
        cur += c;
      }
      out.push(cur);
      return out.map((x) => x.trim());
    };
    const inner = t.slice(1, -1);
    if (/[[\]]/.test(inner)) return null;
    const rows = split(inner, (s, i) => s[i] === ';').map((r) => (r.indexOf(',') >= 0 ? split(r, (s, i) => s[i] === ',') : split(r, (s, i) => s[i] === ' ' && s[i + 1] === ' ')));
    const cols = rows[0].length;
    if (!rows.length || rows.length > MAT_MAX || cols > MAT_MAX || rows.some((r) => r.length !== cols)) return null;
    return { rows };
  }
  function matrixLayout(body) {
    const M = CF.mat;
    // + and − change the number of rows or columns by one; held down, they keep going (as ⌫ does)
    const step = (dim, d) => {
      const change = () => {
        const n = M[dim] + d;
        if (n < 1 || n > MAT_MAX) return false;
        saveMatrixCells();
        M[dim] = n;
        buildMatrixGrid();
        formChanged();
        return true;
      };
      const b = el('button', { class: 'cf-step', text: d > 0 ? '+' : '−', 'aria-label': (d > 0 ? tr('More ', '増やす：') : tr('Fewer ', '減らす：')) + (dim === 'rows' ? tr('rows', '行') : tr('columns', '列')) });
      let timer = null, repeated = false;
      const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        stop();
        repeated = false;
        timer = setTimeout(() => { timer = setInterval(() => { repeated = true; if (!change()) stop(); }, 90); }, 450);
      });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, stop);
      // a click after a hold that already counted is not one more step
      b.addEventListener('click', () => { if (repeated) { repeated = false; return; } vibrate(); change(); });
      return b;
    };
    CF.nodes.rowsN = el('b'); CF.nodes.colsN = el('b');
    body.append(el('div', { class: 'cf-size' },
      el('span', { class: 'cf-sz' }, el('span', { text: tr('Rows', '行') }), step('rows', -1), CF.nodes.rowsN, step('rows', 1)),
      el('span', { class: 'cf-sz' }, el('span', { text: tr('Columns', '列') }), step('cols', -1), CF.nodes.colsN, step('cols', 1))));
    CF.nodes.grid = el('div', { class: 'cf-mat' });
    body.append(el('div', { class: 'cf-brk' }, CF.nodes.grid));
    const ops = CF.nodes.ops = el('div', { class: 'cf-ops', role: 'group', 'aria-label': tr('Calculate', '計算') });
    for (const [op, label] of MAT_OPS) {
      const b = tapButton({ class: 'cf-op-btn', text: label }, () => {
        saveMatrixCells();
        M.op = op;
        CF.reveal = 'op'; // a calculation was chosen: its result comes into view (the boxes may leave it)
        for (const x of ops.children) x.classList.toggle('on', x === b);
        buildMatrixGrid();
        formChanged();
      });
      b.dataset.op = op;
      b.classList.toggle('on', op === M.op);
      ops.append(b);
    }
    body.append(ops);
    buildMatrixGrid();
  }
  function saveMatrixCells() {
    for (const k of Object.keys(CF.boxes)) CF.mat.vals[k] = CF.boxes[k].value;
  }
  // (re)makes the cells for the current size; with "Ax = b" a column for b after a line
  function buildMatrixGrid() {
    const M = CF.mat, keep = editTarget && editTarget.dataset.k;
    const sys = M.op === 'sys';
    CF.boxes = {};
    CF.order = [];
    CF.nodes.grid.textContent = '';
    CF.nodes.grid.style.gridTemplateColumns = 'repeat(' + M.cols + ', auto)' + (sys ? ' 2px auto' : '');
    for (let i = 0; i < M.rows; i++) {
      for (let j = 0; j < M.cols; j++) {
        const k = 'c' + i + '_' + j;
        const b = makeFormBox(k, '0', 'cell');
        b.setAttribute('enterkeyhint', 'next');
        b.setAttribute('aria-label', tr('Row ', '') + (i + 1) + tr(', column ', '行') + (j + 1) + tr('', '列'));
        b.value = M.vals[k] || '';
        CF.boxes[k] = b; CF.order.push(k);
        CF.nodes.grid.append(b);
      }
      if (sys) {
        const k = 'b' + i;
        const b = makeFormBox(k, '0', 'cell rhs');
        b.setAttribute('enterkeyhint', 'next');
        b.setAttribute('aria-label', 'b' + (i + 1));
        b.value = M.vals[k] || '';
        CF.boxes[k] = b; CF.order.push(k);
        CF.nodes.grid.append(el('span', { class: 'cf-bar-v' }), b);
      }
    }
    CF.nodes.rowsN.textContent = M.rows;
    CF.nodes.colsN.textContent = M.cols;
    if (CF.nodes.hint) CF.nodes.hint.textContent = MAT_HINT[M.op] || '';
    editTarget = CF.boxes[keep] || CF.boxes[CF.order[0]];
    if (document.body.classList.contains('cform-open')) focusExpr();
    showCellPos(editTarget);
  }
  // [row, column] of a cell (the column of b: the number of columns), or null
  function cellPos(b) {
    const k = b && b.dataset ? b.dataset.k : '';
    let m = /^c(\d+)_(\d+)$/.exec(k || '');
    if (m) return [Number(m[1]), Number(m[2])];
    m = /^b(\d+)$/.exec(k || '');
    return m && CF.mat ? [Number(m[1]), CF.mat.cols] : null;
  }
  function showCellPos(b) {
    if (!CF.nodes || !CF.nodes.pos) return;
    const p = cellPos(b);
    CF.nodes.pos.textContent = !p ? '' : p[1] === CF.mat.cols ? 'b' + (p[0] + 1) : tr(`Row ${p[0] + 1}, column ${p[1] + 1}`, `${p[0] + 1} 行 ${p[1] + 1} 列`, `Fila ${p[0] + 1}, columna ${p[1] + 1}`);
  }
  function matrixExpr() {
    const M = CF.mat;
    const v = (k) => boxText(k) || '0';
    const rows = [];
    for (let i = 0; i < M.rows; i++) {
      const r = [];
      for (let j = 0; j < M.cols; j++) r.push(v('c' + i + '_' + j));
      rows.push(r.join(', '));
    }
    const m = '[' + rows.join('; ') + ']';
    switch (M.op) {
      case 'det': return 'det(' + m + ')';
      // A^(−1) rather than inverse(A): the same result, but inverse() takes seconds from about 12 × 12 on
      // and more than 30 s at 16 × 16, where ^(−1) takes milliseconds even at 30 × 30
      case 'inv': return m + '^(−1)';
      case 'tr': return 'transpose(' + m + ')';
      case 'rk': return 'rk(' + m + ')';
      case 'eig': { const x = formUnknown('x'); return 'solve(det(' + m + ' − ' + x + ' × identity(' + M.rows + ')) = 0' + (x === 'x' ? '' : ', ' + x) + ')'; }
      case 'sys': {
        const b = [];
        for (let i = 0; i < M.rows; i++) b.push(v('b' + i));
        return m + '^(−1) × [' + b.join('; ') + ']';
      }
    }
    return m;
  }
  // ---- the equations form: one equation, or a system (+ adds one), and the variables to solve for
  const EQ_MAX = 6;
  function equationsLayout(body) {
    CF.nodes.eqs = el('div', { class: 'cf-eqs' });
    CF.nodes.eqBtns = el('div', { class: 'cf-size' },
      tapButton({ class: 'cf-op-btn', text: tr('+ Add an equation', '＋ 式を追加') }, () => { if (CF.eq.n < EQ_MAX) { saveEqCells(); CF.eq.n++; buildEquations(); formChanged(); } }),
      CF.nodes.eqDel = tapButton({ class: 'cf-op-btn', text: tr('− Remove the last', '− 最後の式を消す') }, () => { if (CF.eq.n > 1) { saveEqCells(); CF.eq.n--; buildEquations(); formChanged(); } }));
    body.append(CF.nodes.eqs, CF.nodes.eqBtns);
    CF.nodes.vars = el('div', { class: 'cf-vars' });
    body.append(CF.nodes.vars);
    buildEquations();
  }
  function saveEqCells() { for (const k of Object.keys(CF.boxes)) CF.eq.vals[k] = CF.boxes[k].value; }
  function buildEquations() {
    const E = CF.eq, keep = editTarget && editTarget.dataset.k;
    CF.boxes = {};
    CF.order = [];
    CF.nodes.eqs.textContent = '';
    for (let i = 0; i < E.n; i++) {
      const l = makeFormBox('l' + i, tr('left side', '左辺'), 'wide'), r = makeFormBox('r' + i, '0', 'wide');
      l.value = E.vals['l' + i] || ''; r.value = E.vals['r' + i] || '';
      CF.boxes['l' + i] = l; CF.boxes['r' + i] = r; CF.order.push('l' + i, 'r' + i);
      // × takes this equation away (the ones below move up)
      const del = E.n > 1 ? tapButton({ class: 'cf-eq-del', text: '×', 'aria-label': tr('Remove equation ', '式を消す：') + (i + 1) }, () => removeEquation(i)) : null;
      CF.nodes.eqs.append(cfRow(l, cfT('='), r, del));
    }
    // the variables: x, or x, y (, z …) for a system; tap the letters to choose others
    const v = makeFormBox('v', E.n > 1 ? 'x, y' : 'x', '');
    v.value = E.vals.v || '';
    CF.boxes.v = v; CF.order.push('v');
    CF.nodes.eqs.append(cfRow(el('span', { class: 'cf-lbl', text: tr('Solve for', '解く文字') }), v));
    CF.nodes.vars.textContent = '';
    for (const letter of ['x'].concat(VAR_LETTERS)) {
      CF.nodes.vars.append(tapButton({ class: 'cf-var', text: letter }, () => {
        // one equation: the letter; a system: the letters tapped one after another
        const cur = v.value.split(',').map((t) => t.trim()).filter(Boolean);
        if (CF.eq.n === 1) v.value = letter;
        else if (cur.indexOf(letter) < 0) v.value = cur.concat(letter).slice(-CF.eq.n).join(', ');
        formChanged();
      }));
    }
    CF.nodes.vars.hidden = keep !== 'v';
    CF.nodes.eqDel.disabled = E.n < 2;
    if (CF.nodes.hint) CF.nodes.hint.textContent = eqHint();
    editTarget = CF.boxes[keep] || CF.boxes.l0;
    if (document.body.classList.contains('cform-open')) focusExpr();
  }
  const eqHint = () => (CF.eq.n > 1 ? tr('A system of equations: the result is the values of the variables in their order', '連立方程式：結果は「解く文字」の順の値です')
    : tr('An empty right side is 0', '右辺が空なら 0 です'));
  function removeEquation(i) {
    const E = CF.eq;
    if (E.n < 2) return;
    saveEqCells();
    for (let j = i; j + 1 < E.n; j++) { E.vals['l' + j] = E.vals['l' + (j + 1)] || ''; E.vals['r' + j] = E.vals['r' + (j + 1)] || ''; }
    delete E.vals['l' + (E.n - 1)]; delete E.vals['r' + (E.n - 1)];
    E.n--;
    buildEquations();
    formChanged();
  }
  // the letters to solve for as the engine reads them (\t)
  const eqVarNames = () => {
    const names = eqNames().map((t) => (/^\p{L}$/u.test(t) ? formUnknown(t) : t));
    // (no letter given: x, or x, y, z … in "solveExpr"; they are named when one of them has a value)
    const usual = ['x', 'y', 'z', 'w', 'u', 'v'].slice(0, CF.eq.n);
    return names.length || !usual.some((l) => definedVars.has(l)) ? names : usual.map(formUnknown);
  };
  // one side of an equation, with those letters written the same way
  function eqSide(k) {
    let t = boxText(k);
    for (const n of eqVarNames()) t = asUnknown(t, n);
    return t;
  }
  function solveExpr() {
    const E = CF.eq;
    const eqs = [];
    for (let i = 0; i < E.n; i++) {
      const l = eqSide('l' + i), r = eqSide('r' + i);
      // an equation typed as a whole into the first box ("x^2 = 4") is used as it is
      eqs.push(!r && countEq(l) === 1 ? l : (l || '□') + ' = ' + (r || '0'));
    }
    const names = eqVarNames();
    if (E.n === 1) return names.length && names[0] !== 'x' ? `solve(${eqs[0]}, ${names[0]})` : `solve(${eqs[0]})`;
    const all = names.length ? names : ['x', 'y', 'z', 'w', 'u', 'v'].slice(0, E.n).map(varText);
    return `multisolve([${eqs.join(', ')}], [${all.join(', ')}])`;
  }
  // what keeps the form from being calculated (a non-square matrix), or ''
  function matrixProblem() {
    const M = CF.mat;
    return squareOps.indexOf(M.op) >= 0 && M.rows !== M.cols ? tr('This needs a square matrix (as many rows as columns)', '行と列の数が同じ行列（正方行列）で使えます') : '';
  }
  function closeForm() {
    if (!CF.id) return;
    clearTimeout(CF.timer);
    CF.seq++;
    CF.id = null;
    editTarget = null;
    cformEl.hidden = true;
    cformEl.textContent = '';
    document.body.classList.remove('cform-open');
    focusExpr();
  }
  // "Next box": the box after the one that has the focus (from the last one back to the first)
  function formNext() {
    const i = CF.order.indexOf(editTarget && editTarget.dataset.k);
    focusBox(CF.boxes[CF.order[(i + 1) % CF.order.length]]);
  }
  // A box reached with "Next box", Enter or the arrows is selected as a whole, as a cell of a
  // spreadsheet is: what is typed replaces it, the arrows (and ◀ ▶) go on to the next box, and a
  // tap into the text edits it.
  function focusBox(b) {
    if (!b) return false;
    editTarget = b;
    b.focus();
    if (b.value) { b.select(); CF.navSel = b; } else CF.navSel = null;
    try { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
    return true;
  }
  // to: 'next' or 'prev' (the order of "Next box", without going round), 'up' or 'down' (the cells of a matrix)
  function formMove(b, to) {
    const k = b.dataset.k;
    if (to === 'next' || to === 'prev') {
      const i = CF.order.indexOf(k) + (to === 'next' ? 1 : -1);
      return i >= 0 && i < CF.order.length && focusBox(CF.boxes[CF.order[i]]);
    }
    const p = cellPos(b);
    if (!p) return false;
    const i = p[0] + (to === 'down' ? 1 : -1);
    return focusBox(CF.boxes[p[1] === CF.mat.cols ? 'b' + i : 'c' + i + '_' + p[1]]);
  }
  // Enter. In a matrix as in a spreadsheet: the cell below (Shift: above); after the last row the
  // top of the next column; after the last cell the matrix is calculated. In the other forms: the
  // next box that still has to be filled in, and when there is none, calculate. Ctrl + Enter calculates.
  function formEnter(b, e) {
    if (e && (e.ctrlKey || e.metaKey)) { formCalculate(); return; }
    const p = cellPos(b);
    if (p) {
      if (formMove(b, e && e.shiftKey ? 'up' : 'down') || (e && e.shiftKey)) return;
      if (focusBox(CF.boxes[p[1] + 1 === CF.mat.cols && CF.boxes.b0 ? 'b0' : 'c0_' + (p[1] + 1)])) return;
      formCalculate();
      return;
    }
    // (the next one after this box in the order of "Next box", going round)
    const missing = formMissing(), at = CF.order.indexOf(b.dataset.k);
    for (let d = 1; d < CF.order.length; d++) {
      const k = CF.order[(at + d) % CF.order.length];
      if (missing.indexOf(k) >= 0) { focusBox(CF.boxes[k]); return; }
    }
    formCalculate();
  }
  function formChanged() {
    if (!CF.id) return;
    const F = FORMS[CF.id];
    for (const b of formBoxes()) {
      b.style.width = Math.max(b.classList.contains('wide') ? 7 : 3, textWidth(b.value || b.placeholder) + 1.5) + 'ch';
      b.classList.remove('missing', 'bad');
    }
    if (F.update) F.update(formValue, CF.nodes);
    const expr = F.build(formValue, CF.dir);
    CF.nodes.expr.textContent = expr;
    if (CF.nodes.graph) CF.nodes.graph.hidden = !formGraphable();
    CF.nodes.msg.textContent = '';
    clearTimeout(CF.timer);
    const seq = ++CF.seq;
    if (!CF.restoring) formRemember();
    // (a letter the user gave a value stays the unknown of the form: said here, as the result shows it as 'x')
    const dv = formDefinedVar();
    CF.nodes.note.hidden = !dv;
    CF.nodes.note.textContent = dv ? tr(`${dv} has a value of its own (a user variable). Here it is the unknown all the same`, `${dv} には値が定義されています（ユーザー定義の変数）。この画面では ${dv} を文字のまま扱います`,
      `${dv} tiene un valor propio (una variable del usuario). Aquí es la incógnita de todos modos`) : '';
    // a box that cannot be used as it is: marked, with what is wrong (nothing is calculated)
    const bad = formProblems();
    if (bad.length) {
      for (const x of bad) CF.boxes[x.k].classList.add('bad');
      CF.nodes.res.textContent = '';
      CF.nodes.msg.className = 'cf-msg error';
      CF.nodes.msg.textContent = bad[0].msg;
      if (CF.nodes.graph) CF.nodes.graph.hidden = true;
      revealResult();
      return;
    }
    const problem = F.matrix ? matrixProblem() : '';
    if (problem) {
      CF.nodes.res.textContent = '';
      CF.nodes.msg.className = 'cf-msg error';
      CF.nodes.msg.textContent = problem;
      revealResult();
      return;
    }
    if (formMissing().length) {
      CF.nodes.res.textContent = '';
      CF.nodes.msg.className = 'cf-msg';
      CF.nodes.msg.textContent = tr('Fill in the boxes to see the result', '欄を埋めると結果を表示します');
      return;
    }
    CF.timer = setTimeout(async () => {
      if (!engineReady) return;
      CF.nodes.res.textContent = '…';
      const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: 1500, max_chars: 20000 });
      if (seq !== CF.seq || !CF.id) return;
      const err = r.ok ? (r.messages || []).find((m) => m.type === 'error') : null;
      CF.nodes.msg.className = 'cf-msg error';
      if (!r.ok) { CF.nodes.res.textContent = ''; CF.nodes.msg.textContent = localMessage(r.error) || ''; }
      else if (r.timeout) { CF.nodes.res.textContent = ''; CF.nodes.msg.className = 'cf-msg'; CF.nodes.msg.textContent = tr('Press "Calculate" to calculate it (it takes longer)', '時間がかかるため「計算する」で計算してください'); }
      else if (err || !r.result) { CF.nodes.res.textContent = ''; CF.nodes.msg.textContent = err ? localMessage(err.text) : tr('Check the boxes', '欄を確認してください'); markFaultyBox(seq); }
      else {
        showResult(CF.nodes.res, resultText(r));
        const warn = (r.messages || []).find((m) => m.type === 'warning');
        if (warn) { CF.nodes.msg.className = 'cf-msg warning'; CF.nodes.msg.textContent = localMessage(warn.text); }
      }
      revealResult();
    }, 250);
  }
  // A tall form (a matrix, several equations) scrolls, with its buttons kept at the bottom: the result
  // and its message are brought into view below the boxes, but only as far as the box being edited
  // stays in view, and only after typing or choosing a calculation (CF.reveal) — not after + or − of
  // the matrix size, which would move those buttons away from a finger that taps them again.
  function revealResult() {
    const f = cformEl, msg = CF.nodes && CF.nodes.msg, why = CF.reveal;
    if (!why) return;
    CF.reveal = false;
    if (!msg || f.scrollHeight <= f.clientHeight) return;
    const fr = f.getBoundingClientRect();
    const actions = f.querySelector('.cf-actions');
    const need = msg.getBoundingClientRect().bottom - (fr.bottom - (actions ? actions.offsetHeight : 0));
    if (need <= 0) return;
    const bar = f.querySelector('.cf-bar');
    const room = why !== 'op' && editTarget && f.contains(editTarget) ? editTarget.getBoundingClientRect().top - fr.top - (bar ? bar.offsetHeight : 0) - 6 : need;
    const by = Math.min(need, room);
    if (by > 0) f.scrollTop += by;
  }
  // puts the expression into the input field; calc: and calculates it
  function formInsert(calc) {
    if (!CF.id) return;
    const id = CF.id, text = FORMS[id].build(formValue, CF.dir);
    const [s, e] = CF.sel;
    closeForm();
    if (!FORMS[id].matrix) delete formDrafts[id]; else if (formDrafts[id]) formDrafts[id].used = true;
    saveDrafts();
    dropUndo();
    const v = exprEl.value;
    exprEl.value = v.slice(0, s) + text + v.slice(e);
    const box = text.indexOf('□');
    if (box >= 0) exprEl.setSelectionRange(s + box, s + box + 1);
    else exprEl.setSelectionRange(s + text.length, s + text.length);
    exprChanged();
    focusExpr();
    if (calc) commit();
  }
  function formCalculate() {
    if (!CF.id) return;
    const bad = formProblems();
    if (bad.length) { CF.reveal = true; formChanged(); focusBox(CF.boxes[bad[0].k]); CF.navSel = null; return; }
    if (FORMS[CF.id].matrix && matrixProblem()) { formChanged(); return; }
    const missing = formMissing();
    if (missing.length) {
      for (const k of missing) CF.boxes[k].classList.add('missing');
      CF.nodes.msg.className = 'cf-msg error';
      CF.nodes.msg.textContent = tr('Fill in the boxes marked in red', '赤い枠の欄を埋めてください');
      editTarget = CF.boxes[missing[0]];
      editTarget.focus();
      return;
    }
    formInsert(true);
  }

  // ---- kept, undone, redone, cleared
  // What a form holds is kept while it is edited (formDrafts, saved with the page state): a form
  // closed with × or Back, or by leaving the app, shows the same boxes when it is opened again. A
  // form that was used ("Insert", "Calculate") starts empty the next time; the matrix form keeps
  // its matrix, so that the determinant, the inverse… of the same matrix can follow one another
  // ("Clear all boxes" in the ⋯ menu empties it). Every change is also a step of Undo and Redo.
  const formDrafts = (() => { const d = store.get('qalc.forms', {}); return d && typeof d === 'object' ? d : {}; })();
  const saveDrafts = debounce(() => store.set('qalc.forms', formDrafts), 400);
  function formSnapshot() {
    const F = FORMS[CF.id], vals = {};
    const keep = (src) => { for (const k of Object.keys(src)) if (src[k]) vals[k] = src[k]; };
    if (F.matrix) { saveMatrixCells(); keep(CF.mat.vals); return { vals, rows: CF.mat.rows, cols: CF.mat.cols, op: CF.mat.op }; }
    if (F.eqs) { saveEqCells(); keep(CF.eq.vals); return { vals, n: CF.eq.n }; }
    for (const k of CF.order) if (CF.boxes[k].value) vals[k] = CF.boxes[k].value;
    return { vals, dir: CF.dir };
  }
  function formRestore(snap) {
    const F = FORMS[CF.id];
    if (F.matrix) { Object.assign(CF.mat, { rows: snap.rows, cols: snap.cols, op: snap.op || '', vals: Object.assign({}, snap.vals) }); buildMatrixGrid(); }
    else if (F.eqs) { CF.eq.n = snap.n; CF.eq.vals = Object.assign({}, snap.vals); buildEquations(); }
    else { for (const k of CF.order) CF.boxes[k].value = snap.vals[k] || ''; CF.dir = snap.dir || ''; }
    if (CF.nodes.ops) for (const x of CF.nodes.ops.children) x.classList.toggle('on', x.dataset.op === CF.mat.op);
    if (CF.nodes.seg) for (const x of CF.nodes.seg.children) x.classList.toggle('on', x.dataset.d === CF.dir);
  }
  // called for every change (formChanged): a new step, or the same step while one box is being typed in
  function formRemember() {
    const obj = formSnapshot(), snap = JSON.stringify(obj);
    const typing = CF.typing, now = Date.now(), k = editTarget ? editTarget.dataset.k : '';
    CF.typing = false;
    if (CF.hi < 0 || CF.hist[CF.hi] !== snap) {
      if (typing && CF.hi > 0 && CF.hi === CF.hist.length - 1 && k === CF.histK && now - CF.histT < 1000 && now - CF.histT0 < 4000) CF.hist[CF.hi] = snap;
      else {
        CF.hist.length = CF.hi + 1;
        CF.hist.push(snap);
        if (CF.hist.length > 200) CF.hist.shift();
        CF.hi = CF.hist.length - 1;
        CF.histT0 = now;
      }
      CF.histK = typing ? k : '';
      CF.histT = now;
    }
    keepDraft(obj);
    updateFormBar();
  }
  // The draft of the open form. None for an empty form, and none for a form that holds only what
  // its key put there (CF.base: order 2 for d²/dx², y for ∂/∂y, the determinant for det): the
  // next key then starts from its own settings, not from those of the key before.
  function keepDraft(obj) {
    const empty = !Object.keys(obj.vals).length && !obj.dir && !obj.op && (obj.n === undefined || obj.n === 1) && (obj.rows === undefined || (obj.rows === 2 && obj.cols === 2));
    if (empty || JSON.stringify(obj) === CF.base) delete formDrafts[CF.id]; else formDrafts[CF.id] = obj;
    saveDrafts();
  }
  function updateFormBar() {
    if (!CF.nodes || !CF.nodes.undo) return;
    CF.nodes.undo.disabled = CF.hi <= 0;
    CF.nodes.redo.disabled = CF.hi >= CF.hist.length - 1;
  }
  // Undo (−1) and Redo (+1)
  function formStep(d) {
    const i = CF.hi + d;
    if (!CF.id || i < 0 || i >= CF.hist.length) return;
    CF.hi = i;
    const obj = JSON.parse(CF.hist[i]);
    CF.restoring = true;
    formRestore(obj);
    CF.reveal = true; CF.navSel = null;
    formChanged();
    CF.restoring = false;
    keepDraft(obj);
    updateFormBar();
    focusExpr();
  }
  function formClear() {
    const F = FORMS[CF.id];
    if (F.matrix) { CF.mat.vals = {}; buildMatrixGrid(); }
    else if (F.eqs) { CF.eq.vals = {}; buildEquations(); }
    else { for (const k of CF.order) CF.boxes[k].value = ''; }
    editTarget = CF.boxes[CF.order[0]];
    CF.navSel = null;
    formChanged();
    focusExpr();
  }
  // the ⋯ menu of a form
  async function formMenu() {
    const F = FORMS[CF.id], items = [['clear', tr('Clear all boxes', 'すべての欄を消去')]];
    const p = F.matrix ? cellPos(editTarget) || [0, 0] : null;
    if (p) {
      const M = CF.mat, i = p[0], j = Math.min(p[1], M.cols - 1);
      if (M.rows < MAT_MAX) items.push(['rowIns', tr(`Insert a row above row ${i + 1}`, `${i + 1} 行目の上に行を入れる`, `Insertar una fila encima de la fila ${i + 1}`)]);
      if (M.rows > 1) items.push(['rowDel', tr(`Delete row ${i + 1}`, `${i + 1} 行目を削除`, `Eliminar la fila ${i + 1}`)]);
      if (M.cols < MAT_MAX) items.push(['colIns', tr(`Insert a column left of column ${j + 1}`, `${j + 1} 列目の左に列を入れる`, `Insertar una columna a la izquierda de la columna ${j + 1}`)]);
      if (M.cols > 1) items.push(['colDel', tr(`Delete column ${j + 1}`, `${j + 1} 列目を削除`, `Eliminar la columna ${j + 1}`)]);
      items.push(['copy', tr('Copy as a table (for a spreadsheet)', '表としてコピー（表計算ソフトに貼り付け用）')]);
    }
    const id = CF.id, a = await sheet(F.title, items);
    if (!a || CF.id !== id) { focusExpr(); return; }
    if (a === 'clear') formClear();
    else if (a === 'copy') {
      const c = matrixCells();
      copyText(c.rows.map((r, i) => r.map((x) => normalizeExpr(x) || '0').concat(CF.mat.op === 'sys' ? [normalizeExpr(c.b[i]) || '0'] : []).join('\t')).join('\n'));
      toast(tr('Copied: paste it into a spreadsheet', 'コピーしました（表計算ソフトに貼り付けられます）'), 2400);
      focusExpr();
    } else matrixEdit(a, p[0], Math.min(p[1], CF.mat.cols - 1));
  }
  // the cells of the matrix as rows (and the column b), and back
  function matrixCells() {
    saveMatrixCells();
    const M = CF.mat, rows = [], b = [];
    for (let i = 0; i < M.rows; i++) {
      const r = [];
      for (let j = 0; j < M.cols; j++) r.push(M.vals['c' + i + '_' + j] || '');
      rows.push(r); b.push(M.vals['b' + i] || '');
    }
    return { rows, b };
  }
  function setMatrixCells(rows, b, focus) {
    const M = CF.mat;
    M.vals = {};
    rows.forEach((r, i) => { r.forEach((x, j) => { if (x) M.vals['c' + i + '_' + j] = x; }); if (b[i]) M.vals['b' + i] = b[i]; });
    M.rows = rows.length; M.cols = rows[0].length;
    buildMatrixGrid();
    if (focus && CF.boxes[focus]) editTarget = CF.boxes[focus];
    CF.navSel = null;
    formChanged();
    focusExpr();
    showCellPos(editTarget);
  }
  // a row or a column put in or taken out at the cell that is being edited
  function matrixEdit(what, i, j) {
    const c = matrixCells(), cols = c.rows[0].length;
    if (what === 'rowIns') { c.rows.splice(i, 0, new Array(cols).fill('')); c.b.splice(i, 0, ''); }
    else if (what === 'rowDel') { c.rows.splice(i, 1); c.b.splice(i, 1); i = Math.min(i, c.rows.length - 1); }
    else if (what === 'colIns') for (const r of c.rows) r.splice(j, 0, '');
    else if (what === 'colDel') { for (const r of c.rows) r.splice(j, 1); j = Math.min(j, cols - 2); }
    setMatrixCells(c.rows, c.b, 'c' + i + '_' + j);
  }
  // Text pasted into a box. A table from a spreadsheet (cells separated by tabs, rows by line
  // breaks), a CSV, numbers separated by spaces or a matrix "[1, 2; 3, 4]" fills the cells of the
  // matrix form from the cell that is being edited, and the matrix grows as far as needed. Several
  // lines pasted into the equations form are one equation each. Returns false for anything else
  // (the text is then pasted as usual).
  const NUM_RE = /^[−+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][−+-]?\d+)?$/;
  function parseBlock(text) {
    const t = text.replace(/\r\n?/g, '\n').replace(/[\s;]+$/, '');
    const m = parseMatrix(normalizeExpr(t));
    if (m) return m.rows;
    let lines = t.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 1 && t.indexOf('\t') < 0 && t.indexOf(';') >= 0) lines = t.split(';');
    let cut;
    if (t.indexOf('\t') >= 0) cut = (l) => l.split('\t');
    else if (lines.every((l) => l.indexOf(',') >= 0)) cut = (l) => l.split(',');
    else if (lines.every((l) => l.trim().split(/\s+/).every((x) => NUM_RE.test(x)))) cut = (l) => l.trim().split(/\s+/);
    else cut = (l) => [l];
    const rows = lines.map((l) => cut(l).map((x) => normalizeExpr(x)));
    if (!rows.length || (rows.length === 1 && rows[0].length === 1)) return null;
    const w = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => r.concat(new Array(w - r.length).fill('')));
  }
  function formPaste(b, text) {
    const F = FORMS[CF.id];
    if (F.matrix) {
      const block = parseBlock(text), p = cellPos(b);
      if (!block || !p) return false;
      const c = matrixCells(), M = CF.mat, sys = M.op === 'sys';
      const i0 = p[0], j0 = p[1];
      let cut = false;
      const rowsN = Math.min(MAT_MAX, Math.max(M.rows, i0 + block.length));
      // with "Ax = b" the column after the last one is b, and the matrix does not grow sideways
      const colsN = sys ? M.cols : Math.min(MAT_MAX, Math.max(M.cols, j0 + block[0].length));
      while (c.rows.length < rowsN) { c.rows.push(new Array(M.cols).fill('')); c.b.push(''); }
      for (const r of c.rows) while (r.length < colsN) r.push('');
      block.forEach((r, di) => r.forEach((x, dj) => {
        const i = i0 + di, j = j0 + dj;
        if (i >= rowsN || j > colsN || (j === colsN && !sys)) { if (x) cut = true; return; }
        if (j === colsN) c.b[i] = x; else c.rows[i][j] = x;
      }));
      setMatrixCells(c.rows, c.b, b.dataset.k);
      if (cut) toast(tr('The part that did not fit was left out', '入りきらない分は入れていません'), 2600);
      return true;
    }
    if (F.eqs) {
      const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => normalizeExpr(l)).filter(Boolean);
      const m = /^[lr](\d+)$/.exec(b.dataset.k);
      if (lines.length < 2 || !m) return false;
      saveEqCells();
      const E = CF.eq, i0 = Number(m[1]);
      lines.slice(0, EQ_MAX - i0).forEach((l, d) => {
        const q = /^(.*?)\s*=\s*(.*)$/.exec(l);
        E.vals['l' + (i0 + d)] = countEq(l) === 1 && q ? q[1] : l;
        E.vals['r' + (i0 + d)] = countEq(l) === 1 && q ? q[2] : '';
      });
      E.n = Math.min(EQ_MAX, Math.max(E.n, i0 + lines.length));
      buildEquations();
      CF.navSel = null;
      formChanged();
      if (i0 + lines.length > EQ_MAX) toast(tr(`Up to ${EQ_MAX} equations: the rest was left out`, `式は ${EQ_MAX} つまでです（残りは入れていません）`, `Hasta ${EQ_MAX} ecuaciones: el resto se dejó fuera`), 2600);
      return true;
    }
    return false;
  }
  // An expression that a form made, read back into the boxes of that form (the values for
  // openForm), or null: "integrate(x^2, 0, 1)" is x^2, 0 and 1 in the integral form again.
  function splitTop(t, sep) {
    const out = []; let d = 0, cur = '';
    for (const c of t) {
      if ('([{'.indexOf(c) >= 0) d++;
      else if (')]}'.indexOf(c) >= 0 && --d < 0) return null;
      if (c === sep && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (d !== 0) return null;
    out.push(cur.trim());
    return out;
  }
  function formFromExpr(id, text) {
    const t = normalizeExpr(text);
    const args = (name) => (t.slice(0, name.length + 1) === name + '(' && t[t.length - 1] === ')' ? splitTop(t.slice(name.length + 1, -1), ',') : null);
    const letter = (v) => (v || '').replace(/^\\/, ''); // \k is shown as k in the variable box
    const opt = (v) => (v && v !== 'undefined' ? v : '');
    let a;
    switch (id) {
      case 'int': a = args('integrate'); return a && a.length <= 4 && a[0] ? { f: a[0], a: opt(a[1]), b: opt(a[2]), v: letter(a[3]) } : null;
      case 'diff': a = args('diff'); return a && a.length <= 4 && a[0] ? { f: a[0], v: letter(a[1]), n: a[2] || '', at: a[3] || '' } : null;
      case 'lim': a = args('limit'); return a && a.length >= 2 && a.length <= 4 ? { f: a[0], a: a[1], v: letter(a[2]), dir: a[3] === '1' ? '1' : /^[−-]1$/.test(a[3] || '') ? '−1' : '' } : null;
      case 'sum': case 'prod': a = args(id === 'sum' ? 'sum' : 'product'); return a && (a.length === 3 || a.length === 4) ? { f: a[0], a: a[1], b: a[2], v: letter(a[3]) } : null;
      case 'dsolve': {
        a = args('dsolve');
        const m = a && a.length <= 2 ? /^diff\(y(?:, x)?\) = (.*)$/.exec(a[0]) : null;
        return m ? { r: m[1], y0: a[1] || '' } : null;
      }
      case 'solve': {
        a = args('solve');
        if (a && a.length <= 2 && a[0]) return { eqs: [a[0]], vars: letter(a[1]) };
        a = args('multisolve');
        const inner = (x) => (x && x[0] === '[' && x[x.length - 1] === ']' ? splitTop(x.slice(1, -1), ',') : null);
        const es = a && a.length === 2 ? inner(a[0]) : null, vs = es ? inner(a[1]) : null;
        return es && vs && es.length <= EQ_MAX ? { eqs: es, vars: vs.map(letter).join(', ') } : null;
      }
      case 'subst': {
        const m = /^(.*) where (\\?[\p{L}_][\p{L}\p{Nd}_]*) = (.*)$/u.exec(t);
        return m ? { f: outerParens(m[1]) ? m[1].slice(1, -1) : m[1], v: letter(m[2]), a: m[3] } : null;
      }
      case 'mat': {
        const one = (name) => { const x = args(name); return x && x.length === 1 ? x[0] : ''; };
        let op = '', m = t;
        if ((a = one('det'))) { op = 'det'; m = a; }
        else if ((a = one('transpose'))) { op = 'tr'; m = a; }
        else if ((a = one('rk'))) { op = 'rk'; m = a; }
        else if (t.slice(-5) === '^(−1)') { op = 'inv'; m = t.slice(0, -5); }
        return parseMatrix(m) ? { matrix: m, op } : null;
      }
    }
    return null;
  }
  // The engine found an error in the expression of the form: the box it comes from is marked, when
  // one box alone has the error too (boxes that hold only a number are not asked about).
  async function markFaultyBox(seq) {
    const ks = CF.order.filter((k) => { const t = boxText(k); return t && !NUM_RE.test(t) && !(k === 'v'); }).slice(0, 12);
    for (const k of ks) {
      const r = await Bridge.send('calc', { expr: boxText(k), opts: engineOpts(), timeout: 800 });
      if (seq !== CF.seq || !CF.id) return;
      if (r.ok && !r.timeout && (r.messages || []).some((m) => m.type === 'error') && CF.boxes[k]) { CF.boxes[k].classList.add('bad'); return; }
    }
  }

  // ---- 📈 in a form: the graph that goes with it. A function and its derivative (with the tangent
  // at the point), a function and its integral (the area of a definite one), the point of a limit
  // or of a substitution, the solution of a differential equation, the two sides of an equation
  // with their crossing points, the lines (2D) or planes (3D) of a system with its solution, the
  // characteristic polynomial with the eigenvalues, the rows of a matrix as points.
  const hasX = (t) => /(^|[^\p{L}_])x(?![\p{L}\p{Nd}_])/u.test(t);
  const hasVar = (t, v) => new RegExp('(^|[^\\p{L}_\\\\])' + v + '(?![\\p{L}\\p{Nd}_])', 'u').test(t);
  const r6 = (v) => engineNum(+(+v).toPrecision(6));
  function eqVars() {
    const v = normalizeExpr(CF.boxes.v ? CF.boxes.v.value : '');
    return v ? v.split(',').map((t) => t.trim()).filter(Boolean) : [];
  }
  function formGraphable() {
    if (!CF.id || formMissing().length) return false;
    const F = FORMS[CF.id];
    if (F.matrix) {
      const M = CF.mat;
      if (matrixProblem()) return false;
      if (M.op === 'sys') return M.rows === M.cols && (M.rows === 2 || M.rows === 3);
      if (M.op === 'eig') return M.rows <= 4;
      return M.op === '' && (M.cols === 2 || M.cols === 3);
    }
    if (F.eqs) {
      const n = CF.eq.n, vs = eqVars();
      if (n === 1) return (!vs.length || vs[0] === 'x') && hasX(solveExpr());
      return (n === 2 || n === 3) && (!vs.length || vs.join(',') === ['x', 'y', 'z'].slice(0, n).join(','));
    }
    if (CF.boxes.v && formValue('v') !== 'x') return false;
    if (CF.id === 'dsolve') return true;
    return ['int', 'diff', 'lim', 'subst'].indexOf(CF.id) >= 0 && hasX(formValue('f'));
  }
  // the numbers in a result ("[4/5; 7/5] = [0.8; 1.4]", "[3  2]", "x = 2"), or null
  async function resultNumbers(expr) {
    const r = await Bridge.send('calc', { expr, opts: Object.assign(engineOpts(), { approx: 'approx', precision: 12, grouping: false }), timeout: 3000 });
    if (!r.ok || !r.result || /\bi\b|undefined|solve/.test(r.result)) return null;
    const t = r.result.split(' ≈ ').pop().split(' = ').pop().trim();
    const m = parseMatrix(t);
    const cells = m ? [].concat(...m.rows) : [t];
    const out = cells.map((c) => Number(c.replace(/−/g, '-').replace(/\s/g, '').replace(/E/g, 'e')));
    return out.length && out.every(isFinite) ? out : null;
  }
  const around = (xs, w) => [r6(Math.min(...xs) - w), r6(Math.max(...xs) + w)];
  const pairText = (...v) => '(' + v.map(short).join(', ') + ')';
  async function formGraph() {
    if (!formGraphable()) return;
    const id = CF.id, F = FORMS[id], g = formValue;
    const sorry = (en, ja) => toast(tr(en, ja), 2600);
    if (F.matrix) {
      const M = CF.mat, m = matrixExpr();
      const cell = (i, j) => boxText('c' + i + '_' + j) || '0';
      if (M.op === 'sys') {
        const vs = ['x', 'y', 'z'].slice(0, M.rows);
        const eqs = [];
        for (let i = 0; i < M.rows; i++) eqs.push(vs.map((v, j) => `(${cell(i, j)}) × ${v}`).join(' + ') + ` = (${boxText('b' + i) || '0'})`);
        return plotSystem(eqs, await resultNumbers(m));
      }
      if (M.op === 'eig') {
        const rows = [];
        for (let i = 0; i < M.rows; i++) { const r = []; for (let j = 0; j < M.cols; j++) r.push(cell(i, j)); rows.push(r.join(', ')); }
        const p = await exactText(`det([${rows.join('; ')}] − x × identity(${M.rows}))`);
        if (!p || !hasX(p)) return sorry('Could not draw the characteristic polynomial', '固有多項式を描けませんでした');
        const ev = await resultNumbers(m);
        return openPlotWith([p], { zeros: true, range: ev ? around(ev, Math.max(2, (Math.max(...ev) - Math.min(...ev)) * 0.3)) : null });
      }
      // the rows as points
      const rows = [];
      for (let i = 0; i < M.rows; i++) { const r = []; for (let j = 0; j < M.cols; j++) r.push(cell(i, j)); rows.push(r); }
      return plotMatrixRows(rows);
    }
    if (F.eqs) {
      const E = CF.eq, v = (k) => eqSide(k);
      if (E.n > 1) {
        const eqs = [];
        for (let i = 0; i < E.n; i++) eqs.push(v('l' + i) + ' = ' + (v('r' + i) || '0'));
        return plotSystem(eqs, await resultNumbers(solveExpr()));
      }
      const L = v('l0'), R = v('r0') || '0';
      const roots = await resultNumbers(solveExpr());
      const range = roots ? around(roots, Math.max(3, (Math.max(...roots) - Math.min(...roots)) * 0.3)) : null;
      return R === '0' ? openPlotWith([L], { zeros: true, range }) : openPlotWith([L, R], { roots: true, range });
    }
    const f = CF.boxes.f ? g('f') : '';
    const near = async (a, w) => { const x = await numValue(a); return isFinite(x) ? { x, range: around([x], w) } : null; };
    if (id === 'int') {
      const a = g('a'), b = g('b');
      if (!a && !b) return openPlotWith([f, `integrate(${f})`]);
      const an = await numValue(a), bn = await numValue(b);
      if (!isFinite(an) || !isFinite(bn)) return openPlotWith([f]);
      const w = Math.abs(bn - an) * 0.4 || 1;
      return openPlotWith([f], { area: { a, b }, range: around([an, bn], w) });
    }
    if (id === 'diff') {
      const n = g('n'), at = g('at');
      const exprs = [f, n === '1' ? `diff(${f})` : `diff(${f}, x, ${n})`];
      if (!at) return openPlotWith(exprs);
      const p = await near(at, 3);
      if (n === '1') return openPlotWith(exprs, { tangentAt: at, range: p && p.range });
      return openPlotWith(exprs, { marks: [{ x: at, label: 'x = ' + at }], range: p && p.range });
    }
    if (id === 'lim' || id === 'subst') {
      const a = g('a');
      const inf = /∞|infinity|inf\b/.test(a);
      if (inf) return openPlotWith([f], { range: /^[−-]/.test(a) ? ['-60', '0'] : ['0', '60'] });
      const p = await near(a, 5);
      const y = await numValue(F.build(g, CF.dir));
      const lbl = id === 'lim' ? tr('limit ', '極限 ') + (isFinite(y) ? short(y) : '') : pairText(p ? p.x : a, y);
      return openPlotWith([f], { range: p && p.range, pts: p && isFinite(y) ? [{ x: p.x, y, label: lbl }] : null, marks: p && !isFinite(y) ? [{ x: a }] : null });
    }
    if (id === 'dsolve') {
      const sol = await exactText(F.build(g));
      if (!sol || /dsolve|diff\(|[=|]/.test(sol) || hasVar(sol, 'y')) return sorry('Could not draw the solution', '解をグラフにできませんでした');
      if (/(^|[^\p{L}_])C(?![\p{L}\p{Nd}_])/u.test(sol)) return sorry('Enter y(0) to draw the solution (the general solution has a constant C)', 'y(0) を入れると解をグラフにできます（一般解は定数 C を含むため）');
      const y0 = await numValue(g('y0'));
      return openPlotWith([sol], { range: ['-4', '4'], pts: isFinite(y0) ? [{ x: 0, y: y0, label: 'y(0) = ' + short(y0) }] : null });
    }
  }
  // the rows of a matrix (2 or 3 columns) as points in the 2D or 3D graph
  async function plotMatrixRows(rows) {
    const pts = [];
    for (const r of rows) {
      const v = [];
      for (const c of r) v.push(await numValue(c));
      if (!v.every(isFinite)) { toast(tr('All elements must be numbers', 'すべての要素が数値のときに描けます'), 2400); return; }
      pts.push(r.length === 2 ? { x: v[0], y: v[1] } : { x: v[0], y: v[1], z: v[2] });
    }
    if (rows[0].length === 2) openPlotWith([], { points: pts });
    else openPlot3dWith([], { points: pts });
  }
  // the equations of a system in x, y (lines in 2D) or x, y, z (planes in 3D), with the solution
  async function plotSystem(eqs, sol) {
    const v = eqs.length === 2 ? 'y' : 'z';
    const fs = [];
    for (const e of eqs) {
      const t = await exactText(`solve(${e}, ${v})`);
      if (!t || /[=|[\]]|solve/.test(t) || hasVar(t, v)) {
        return toast(eqs.length === 2 ? tr('An equation cannot be written as y = …, so it cannot be drawn (a vertical line x = c)', 'y = … の形にできない式（縦の直線 x = 一定 など）があるため描けません')
          : tr('An equation cannot be written as z = …, so it cannot be drawn', 'z = … の形にできない式があるため描けません'), 3000);
      }
      fs.push(t);
    }
    const ok = sol && sol.length === eqs.length;
    if (eqs.length === 2) return openPlotWith(fs, { range: ok ? around([sol[0]], 5) : null, pts: ok ? [{ x: sol[0], y: sol[1], label: pairText(sol[0], sol[1]) }] : null });
    openPlot3dWith(fs, { range: ok ? around([sol[0]], 3).concat(around([sol[1]], 3)) : null, points: ok ? [{ x: sol[0], y: sol[1], z: sol[2], label: pairText(sol[0], sol[1], sol[2]) }] : null });
  }

  // ---- graphs from everywhere (1.8.4): an expression, an equation, a function or a matrix made in
  // the input field, in the history, in the user's functions or in a form goes to the graph that
  // fits it. graphRoute(text) says what would be drawn (null: nothing), graphOf(text) draws it.
  //  - an expression in x: the 2D graph; in y (with or without x): the 3D graph z = f(x, y)
  //  - y = f(x), f(x) = … (also the other way round): 2D; z = f(x, y), f(x, y) = …: 3D
  //  - an equation in x: its two sides in 2D with their crossing points (as the equation form does)
  //  - an equation in x and y (x² + y² = 4): solved for y by the engine, every solution in 2D;
  //    with z as well (x + y + z = 1): solved for z, in 3D
  //  - a matrix of numbers with 2 or 3 columns ([1 2; 3 4], [[1, 2], [3, 4]]): its rows as points
  // Several functions in one line (sin(x), cos(x)) are drawn together, as in the graph itself.
  function matrixRows(t) {
    const m = parseMatrix(t);
    // typed with single spaces ([1 2; 3 4]): numbers apart by spaces are the columns
    const num = /^[−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[−-]?\d+)?$/i;
    if (m && m.rows[0].length === 1 && m.rows.every((r) => r[0].split(/\s+/).every((c) => num.test(c)))) {
      const rows = m.rows.map((r) => r[0].split(/\s+/));
      return rows.every((r) => r.length === rows[0].length) ? rows : null;
    }
    if (m) return m.rows;
    if (!/^\[\s*\[/.test(t) || !/\]\s*\]$/.test(t)) return null; // [[1, 2], [3, 4]]: a list of rows
    const rows = splitTop(t.slice(1, -1), ',');
    if (!rows || !rows.every((r) => /^\[[^[\]]*\]$/.test(r))) return null;
    const out = rows.map((r) => (splitTop(r.slice(1, -1), ',') || []).map((c) => c.trim()));
    return out.length && out[0].length && out.every((r) => r.length === out[0].length) ? out : null;
  }
  function graphRoute(text) {
    let t = normalizeExpr(text || '');
    if (!t || t.length > 500 || t.indexOf('□') >= 0 || /[<>≤≥≠]| to |→|\bsolve\(|dsolve|integrate\([^)]*,|diff\([^)]*,[^)]*,[^)]*,/.test(t)) return null;
    if (outerParens(t)) t = t.slice(1, -1).trim();
    const rows = matrixRows(t);
    if (rows) return (rows[0].length === 2 || rows[0].length === 3) && rows.every((r) => r.every((c) => !/[xyz]/.test(c.replace(/[\p{L}_]{2,}/gu, '')))) ? { kind: 'points', rows, three: rows[0].length === 3 } : null;
    if (/[[\]]/.test(t)) return null;
    const vx = (s) => hasVar(s, 'x'), vy = (s) => hasVar(s, 'y'), vz = (s) => hasVar(s, 'z');
    const sides = splitTop(t.replace(/:=/g, '='), '=');
    if (!sides) return null;
    if (sides.length === 1) {
      if (vz(t)) return null;
      if (vy(t)) return { kind: 'f', exprs: [t], three: true };
      return vx(t) ? { kind: 'f', exprs: [t] } : null;
    }
    if (sides.length !== 2 || !sides[0] || !sides[1]) return null;
    const [L, R] = sides;
    // one side names the other: y = …, z = …, f(x) = …, f(x, y) = …
    const named = (a, b) => {
      const head = /^[\p{L}_][\p{L}\p{Nd}_]*\(\s*x\s*(,\s*y\s*)?\)$/u.exec(a);
      if (a === 'y' && vx(b) && !vy(b) && !vz(b)) return { kind: 'f', exprs: [b] };
      if (a === 'z' && (vx(b) || vy(b)) && !vz(b)) return { kind: 'f', exprs: [b], three: true };
      if (head && !vz(b) && (head[1] || !vy(b)) && (vx(b) || vy(b))) return { kind: 'f', exprs: [b], three: !!head[1] };
      return null;
    };
    const n = named(L, R) || named(R, L);
    if (n) return n;
    const e = L + ' = ' + R;
    if (vz(e)) return (vx(e) || vy(e)) ? { kind: 'solve', eq: e, v: 'z', three: true } : null;
    if (vy(e)) return { kind: 'solve', eq: e, v: 'y' };
    return vx(e) ? { kind: 'sides', L, R } : null;
  }
  async function graphOf(text) {
    const g = graphRoute(text);
    if (!g) return false;
    if (g.kind === 'points') { await plotMatrixRows(g.rows); return true; }
    if (g.kind === 'f') { if (g.three) openPlot3dWith(g.exprs); else openPlotWith(g.exprs); return true; }
    if (g.kind === 'sides') {
      const roots = await resultNumbers(`solve(${g.L} = ${g.R}, x)`);
      const range = roots ? around(roots, Math.max(3, (Math.max(...roots) - Math.min(...roots)) * 0.3)) : null;
      if (g.R === '0') openPlotWith([g.L], { zeros: true, range }); else openPlotWith([g.L, g.R], { roots: true, range });
      return true;
    }
    // solved for y (2D) or z (3D): one solution, or a list of them ("[√(4 − x²)  −√(4 − x²)]")
    const s = await exactText(`solve(${g.eq}, ${g.v})`);
    const m = s && parseMatrix(s);
    const fs = !s || /solve|[=|<>]/.test(s) ? null : m ? [].concat(...m.rows) : [s];
    if (!fs || !fs.length || fs.some((f) => hasVar(f, g.v))) {
      toast(g.three ? tr('This equation cannot be written as z = …, so it cannot be drawn', 'z = … の形にできない式なので描けません')
        : tr('This equation cannot be written as y = …, so it cannot be drawn (a vertical line x = c, for example)', 'y = … の形にできない式なので描けません（縦の直線 x = 一定 など）'), 3000);
      return true;
    }
    if (g.three) openPlot3dWith(fs.slice(0, 4)); else openPlotWith(fs.slice(0, 6));
    return true;
  }
  // the name of the graph that graphRoute chose, for a menu
  const graphLabel = (g) => (g.kind === 'points' ? (g.three ? tr('Draw as points (3D graph)', '点としてグラフに描く（3D）') : tr('Draw as points (2D graph)', '点としてグラフに描く（2D）'))
    : g.three ? tr('Draw a 3D graph', '3D グラフにする') : tr('Draw a graph', 'グラフにする'));

  // ---- 📈 next to the input field: the graph of what is typed (graphRoute)
  const plotBtnEl = $('#plotbtn');
  plotBtnEl.addEventListener('pointerdown', (e) => e.preventDefault());
  plotBtnEl.addEventListener('click', () => { vibrate(); graphOf(exprEl.value); });
  function plottable(t) {
    return !!graphRoute(t);
  }

  // ---- □: a box of a template to be filled in, in the input field ("Next box" goes to the next one)
  const nextBoxEl = $('#nextbox');
  nextBoxEl.addEventListener('pointerdown', (e) => e.preventDefault());
  nextBoxEl.addEventListener('click', () => { vibrate(); selectBox(true); });
  // "Next box ▶" is shown when there is a □ to fill in, or when the caret can step out of parentheses
  function updateNextBox() { nextBoxEl.hidden = exprEl.value.indexOf('□') < 0 && !beforeClose(); }
  // the caret is right before a ")" (the last box of a template was filled in: (1)/(3|))
  function beforeClose() {
    const p = exprEl.selectionEnd;
    return exprEl.selectionStart === p && /^\s*\)/.test(exprEl.value.slice(p));
  }
  // selects the next □ after the caret (from the end back to the start); with no □ left, the caret
  // goes out of the parentheses it is in, so that what follows comes after the fraction (or function)
  function selectBox(fromCaret) {
    const v = exprEl.value;
    let i = v.indexOf('□', fromCaret ? exprEl.selectionEnd : 0);
    if (i < 0) i = v.indexOf('□');
    if (i < 0) {
      if (!fromCaret || !beforeClose()) return false;
      const p = exprEl.selectionEnd + /^\s*\)/.exec(v.slice(exprEl.selectionEnd))[0].length;
      exprEl.setSelectionRange(p, p);
      exprChanged();
      focusExpr();
      return true;
    }
    exprEl.setSelectionRange(i, i + 1);
    exprChanged();
    focusExpr();
    return true;
  }

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
    if (h.input) return wrapValue(h.input.replace(/'([\p{L}_][\p{L}\p{Nd}_]*)'/gu, '\\$1')); // 't' -> \t
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
    return wrapValue(t.replace(/[\u202f\u2009]/g, ''));
  }
  function insertResult(h) {
    const t = insertText(h);
    if (t === null) { toast(tr('This result is too long to insert (use the ans key)', 'この結果はそのまま挿入できません（ans キーで使えます）'), 2600); return; }
    insert(t, 0, false);
  }
  function renderHistory(scroll) {
    histEl.textContent = '';
    if (!history.length) {
      // nothing calculated yet: say what to do and offer a few examples to try
      const chips = el('div', { class: 'ex-chips' });
      for (const x of STARTERS) chips.append(tapButton({ class: 'ex-chip', text: x }, () => { setExpr(x); focusExpr(); }));
      histEl.append(el('div', { class: 'empty' },
        el('div', { class: 'empty-t', html: tr('Type an expression and press <b>=</b>: the results stay here', '式を入力して <b>=</b> を押すと、ここに結果が残ります') }),
        el('div', { text: tr('Tap a result to insert it into the expression, or touch and hold it to copy it.', '結果をタップで式に挿入、長押しでコピーできます。') }),
        el('div', { class: 'empty-try', text: tr('Tap an example to try it', '例をタップして試す') }), chips,
        tapButton({ class: 'btn', text: tr('Examples and tips', '式の例・使い方を見る') }, () => openExamples())));
      histEl.scrollTop = 0; // read from the top (results are followed at the bottom)
      histPinned = false;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const h of history) frag.append(historyItem(h));
    histEl.append(frag);
    fitMatrices(histEl);
    if (scroll) { histEl.scrollTop = histEl.scrollHeight; histPinned = true; }
  }
  // one line of the history: the expression, the result and its warnings
  function historyItem(h) {
    const res = el('div', { class: 'h-res' });
    showResult(res, displayResult(h));
    const item = el('div', { class: 'h-item' }, el('div', { class: 'h-expr', text: h.expr }), res);
    for (const m of h.msgs || []) item.append(el('div', { class: 'h-msg ' + m.type, text: localMessage(m.text) }));
    bindLongPress(item, () => historyMenu(h), (target) => {
      if (target.closest('.h-expr')) setExpr(h.expr);
      else insertResult(h);
      focusExpr();
    });
    return item;
  }
  // A very long result (thousands of digits) scrolls inside a box at most 70 % as high as the
  // history, so that the history can still be scrolled past it (.h-res in style.css).
  function fitResultBox() {
    const hh = histEl.clientHeight;
    if (hh > 0) document.documentElement.style.setProperty('--res-max', Math.max(96, Math.round(hh * 0.7)) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(fitResultBox).observe(histEl);
  else window.addEventListener('resize', fitResultBox);
  fitResultBox();
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
  async function historyMenu(h) {
    if (history.indexOf(h) < 0) return;
    // when it was calculated, the expression and the result (the time first: the title shows 4 lines at most)
    // a result with x (a function of x): differentiate, integrate, draw it or put in a value for x
    const fx = functionOfX(h);
    // the graph that fits the result, or else the expression (1.8.4: also in x and y, equations, functions)
    const gsrc = [insertText(h), h.expr].find((s) => s && graphRoute(s)) || null, groute = gsrc ? graphRoute(gsrc) : null;
    const gItem = groute ? ['g-plot', graphLabel(groute)] : null;
    const more = fx ? [['f-diff', tr('Differentiate', '微分する')], ['f-int', tr('Integrate', '積分する')],
      gItem || ['f-plot', tr('Draw a graph', 'グラフにする')], ['f-subst', tr('Substitute a value for x', 'x に値を代入する')],
      ['f-solve', tr('Solve = 0 for x', '= 0 として x を求める')]] : [];
    if (!fx && gItem && !(groute.kind === 'points' && !h.cut && insertText(h) && parseMatrix(insertText(h)))) more.push(gItem);
    // a matrix result: edit it and calculate with it in the matrix form
    const mx = !h.cut && insertText(h);
    const mat = mx && parseMatrix(mx) ? mx : null;
    if (mat) more.push(['m-edit', tr('Matrix: edit and calculate', '行列を編集・計算する')]);
    const mcols = mat ? parseMatrix(mat).rows[0].length : 0;
    if (mcols === 2) more.push(['m-plot', tr('Draw the rows as points (2D graph)', '各行を点としてグラフに描く（2D）')]);
    else if (mcols === 3) more.push(['m-plot', tr('Draw the rows as points (3D graph)', '各行を点としてグラフに描く（3D）')]);
    const a = await sheet((h.t ? fmtTime(h.t / 1000) + '\n' : '') + clip(h.expr, 300) + '\n' + clip(displayText(h.result), 300), more.concat([
      ['copy-res', tr('Copy result', '結果をコピー')], ['copy-expr', tr('Copy expression', '式をコピー')], ['edit', tr('Edit expression', '式を編集')],
      ['ins-ans', tr('Insert result', '結果を式に挿入')], ['del', tr('Delete this line', 'この行を削除'), 'danger']
    ]));
    if (a === 'm-edit') openForm('mat', { matrix: mat });
    else if (a === 'm-plot') plotMatrixRows(parseMatrix(mat).rows);
    else if (a === 'f-diff') openForm('diff', { f: fx });
    else if (a === 'f-int') openForm('int', { f: fx });
    else if (a === 'f-plot') { if (!(await graphOf(fx))) openPlotWith(fx); }
    else if (a === 'g-plot') graphOf(gsrc);
    else if (a === 'f-solve') openForm('solve', { eqs: [fx + ' = 0'] });
    else if (a === 'f-subst') openForm('subst', { f: fx, focus: 'a' });
    else if (a === 'copy-res') copyText(shownText(h));
    else if (a === 'copy-expr') copyText(h.expr);
    else if (a === 'edit') setExpr(h.expr);
    else if (a === 'ins-ans') insertResult(h);
    else if (a === 'del') {
      const i = history.indexOf(h);
      if (i < 0) return; // the history changed while the menu was open
      history.splice(i, 1);
      historyChanged();
      toast(tr('Line deleted', '1 行を削除しました'), 5000, [tr('Undo', '元に戻す'), () => {
        history.splice(Math.min(i, history.length), 0, h);
        if (history.length > 300) history = history.slice(-300);
        historyChanged();
      }]);
    }
  }
  // The result of a history line as an expression in x (x³ − 3x, 3x² + C), or null: not for numbers,
  // equations, comparisons, matrices or results that cannot be inserted. "+ C" of an indefinite
  // integral is left out.
  function functionOfX(h) {
    if (h.cmp || h.cut) return null;
    let t = insertText(h);
    if (t === null || t.length > 2000 || /[[\]=<>≤≥≠]/.test(t) || / (?:or|and) /.test(t)) return null;
    if (outerParens(t)) t = t.slice(1, -1);
    t = t.replace(/\s*\+\s*C$/, '');
    return /(^|[^\p{L}_])x(?![\p{L}\p{Nd}_])/u.test(t) ? t : null; // 3x and x³ count, x2 is another name
  }
  // "(x + 1)" but not "(x + 1)(x − 1)": the first parenthesis is closed by the last character
  function outerParens(t) {
    if (t[0] !== '(' || t[t.length - 1] !== ')') return false;
    let d = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') d++;
      else if (t[i] === ')' && --d === 0) return i === t.length - 1;
    }
    return false;
  }
  function historyChanged() {
    fitHistory();
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
      sh.append(el('button', { text: tr('Cancel', 'キャンセル'), onclick: () => closeSheet(null) }));
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
    ['examples', '💡', tr('Examples and tips', '式の例・使い方')],
    ['functions', 'ƒ', tr('Functions', '関数の一覧')],
    ['units', '㎏', tr('Units and currencies', '単位・通貨の一覧')],
    ['variables', 'π', tr('Variables and constants', '変数・定数の一覧')],
    ['plot', '📈', tr('Graph', 'グラフ')],
    ['shapes', '📐', tr('Shapes: area, volume, length', '図形（面積・体積・長さ）')],
    ['defs', '✎', tr('User-defined variables and functions', 'ユーザー定義の変数・関数')],
    ['rates', tr('$', '¥'), tr('Update exchange rates', '為替レートの更新')],
    null,
    ['pro', '⭐', 'QCalc Pro', { when: proOffered }],
    ['settings', '⚙', tr('Settings', '設定')],
    ['language', '🌐', 'Language / 言語 / Idioma'],
    ['export', '📤', tr('Export history (CSV)', '履歴を書き出す（CSV）'), { pro: true }],
    ['clear', '🗑', tr('Clear history', '履歴を消去')],
    ['about', 'ⓘ', tr('About this app', 'このアプリについて')]
  ];
  function buildDrawer() {
    const d = $('#drawer');
    d.append(el('div', { class: 'head' }, el('div', { class: 'name', text: 'QCalc' }),
      el('div', { class: 'sub', id: 'drawer-sub', text: tr('Calculation engine libqalculate', '計算エンジン libqalculate') })));
    for (const m of MENU) {
      if (!m) { d.append(el('hr')); continue; }
      const o = m[3] || {};
      if (o.when && !o.when()) continue;
      const label = el('span', { text: m[2] });
      if (o.pro) label.dataset.pro = '';
      d.append(el('button', { onclick: () => { closeDrawer(); menuAction(m[0]); } },
        el('span', { class: 'ico', text: m[1] }), label));
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
    else if (k === 'shapes') openShapes();
    else if (k === 'defs') openDefs();
    else if (k === 'rates') openRates();
    else if (k === 'settings') openSettings();
    else if (k === 'about') openAbout();
    else if (k === 'examples') openExamples();
    else if (k === 'language') chooseLanguage();
    else if (k === 'pro') openPro();
    else if (k === 'export') exportHistory();
    else if (k === 'clear') {
      if (!history.length) { toast(tr('The history is empty', '履歴はありません'), 1400); return; }
      if (!(await confirmSheet(tr('Clear the whole history?', '計算履歴をすべて消去しますか？'), tr('Clear', '消去する')))) return;
      const old = history;
      history = [];
      historyChanged();
      toast(tr('History cleared', '履歴を消去しました'), 6000, [tr('Undo', '元に戻す'), () => {
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
        el('button', { class: 'icon-btn', 'aria-label': tr('Back', '戻る'), onclick: () => closePanel(), html: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
        el('div', { class: 'ptitle', text: title }));
      p = { node: el('section', { class: 'panel' }, bar, body), body, bar };
      document.body.append(p.node);
      panels[id] = p;
      build(p);
    }
    // a panel is on the stack once; opened again from another panel (the graph of a shape, from the
    // graph's own tools), it comes to the top instead of being counted twice for Back
    const at = panelStack.indexOf(p);
    if (at >= 0) panelStack.splice(at, 1);
    if (panelStack.length && document.body.lastElementChild !== p.node) {
      const y = p.body.scrollTop;
      document.body.append(p.node);
      p.body.scrollTop = y;
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
  const STARTERS = JA ? ['60 mph to km/h', '100 USD to JPY', 'solve(x^2 − 5x + 6 = 0)', 'diff(x^3)']
    : ['60 mph to km/h', '100 USD to EUR', 'solve(x^2 − 5x + 6 = 0)', 'diff(x^3)'];
  // [title, [[expression, note], ...]]; a few expressions differ by language (the currencies)
  const EXAMPLES = [
    [tr('Basics', '基本の計算'), [
      ['1/3 + 1/4', tr('Fractions stay fractions (the decimal is shown too)', '分数は分数のまま計算（小数も並べて表示）')],
      ['2^10', tr('Powers (xʸ key)', 'べき乗（xʸ キー）')],
      ['√(2) × √(8)', tr('Square roots (√ key). The result is exactly 4', '平方根（√ キー）。結果は厳密に 4')],
      ['20!', tr('Factorial (Functions → n!)', '階乗（fn → n!）')],
      ['2400 × 15%', tr('Percent', 'パーセント')],
      ['sin(30°)', tr('With °, the angle is in degrees even in RAD mode', '角度に ° を付けると、設定が RAD でも度で計算')],
      ['e^(i × π)', tr('Complex numbers (i is the imaginary unit)', '複素数（i は虚数単位）')],
      ['(3 + 4i) × (1 − 2i)', tr('Complex arithmetic (abs: absolute value, arg: argument)', '複素数の計算（abs は絶対値、arg は偏角）')],
      ['1000000 / 7 to fraction', tr('Show the result as a fraction', '結果を分数で表示')]
    ]],
    [tr('Unit conversion', '単位の変換'), [
      ['5 km to mi', tr('Length. Type "to" with the → key', '長さ。「to」は → キーで入力')],
      ['170 cm to ft', tr('Height in feet and inches', '身長をフィートとインチで')],
      ['60 mph to km/h', tr('Speed', '速さ')],
      ['100 °F to °C', tr('Temperature', '温度')],
      ['30 坪 to m²', tr('Traditional Japanese units: tsubo to square metres (see "Japanese Units" in the unit list)', '坪を平方メートルに（単位の一覧に「日本の単位」があります）')],
      ['1.5 h + 45 min', tr('Arithmetic with units', '単位の付いた値どうしの計算')],
      ['80 kg × 9.8 m/s² to N', tr('Calculate with units and show the result in another unit', '単位ごと計算して、別の単位で表示')],
      ['500 GB / (20 MB/s) to h', tr('Estimate a duration', '時間の見積もり')]
    ]],
    [tr('Currency conversion', '通貨の換算'), [
      [tr('100 USD to EUR', '100 USD to JPY'), tr('Dollars to euros (get the latest rates with "Update exchange rates")', 'ドルを円に（レートは「為替レートの更新」で最新に）')],
      [tr('50 EUR to GBP', '50 EUR to JPY'), tr('Euros to pounds', 'ユーロを円に')],
      ['10000 JPY to USD', tr('Yen to dollars', '円をドルに')],
      [tr('1 BTC to USD', '1 BTC to JPY'), tr('Bitcoin', 'ビットコイン')]
    ]],
    [tr('Equations', '方程式'), [
      ['solve(x^2 − 5x + 6 = 0)', tr('Solve an equation', '方程式を解く')],
      ['x^2 = 16', tr('An equation typed as it is gets solved too', '等式をそのまま入力しても解ける')],
      ['multisolve([x + y = 5, x − y = 1], [x, y])', tr('Simultaneous equations', '連立方程式')],
      ['3x + 2 > 11', tr('Inequalities', '不等式')]
    ]],
    [tr('Derivatives', '微分'), [
      ['diff(x^3 + 2x)', tr('Derivative (Calculus keys → d/dx)', '微分（「解析」のキー → d/dx）')],
      ['diff(x^2 × sin(x))', tr('Product rule. The result is shown as an expression', '積の微分。結果は式のまま表示')],
      ['diff(x^5, x, 2)', tr('Second derivative (the third argument is the order; d²/dx² key)', '2 階微分（3 つ目が階数。d²/dx² キー）')],
      ['diff(x^2 × y^3, y)', tr('Partial derivative with respect to y (∂/∂y key)', '偏微分（y で微分。∂/∂y キー）')],
      ['diff(x^3, x, 1, 2)', tr('The derivative at x = 2 (the fourth argument is the value of x)', 'x = 2 での微分係数（4 つ目が x の値）')],
      ['extremum(x^3 − 3x)', tr('The x of the extrema (max/min key)', '極値をとる x（極値 キー）')]
    ]],
    [tr('Integrals', '積分'), [
      ['integrate(1/x)', tr('Indefinite integral (∫ key). C is the constant of integration', '不定積分（∫ キー）。C は積分定数')],
      ['integrate(x^2 × sin(x), 0, π)', tr('Definite integral (∫ₐᵇ key): lower limit, then upper limit', '定積分（∫ₐᵇ キー）。下端、上端の順')],
      ['integrate(e^(−x^2), −∞, ∞)', tr('Improper integral (∞ key): the Gaussian integral', '広義積分（∞ キー）。ガウス積分')],
      ['integrate(integrate(x × y, 0, 1, x), 0, 2, y)', tr('Double integral (the fourth argument is the variable)', '重積分（4 つ目が積分する変数）')],
      ['integrate(√(1 − x^2), −1, 1)', tr('Area of a half circle. The result is exactly π/2', '半円の面積。結果は厳密に π/2')],
      ['romberg(sin(x)/x, 1, 2)', tr('Numerical integration (Romberg method)', '数値積分（ロンバーグ法）')]
    ]],
    [tr('Limits, series and differential equations', '極限・級数・微分方程式'), [
      ['limit(sin(x)/x, 0)', tr('Limit (lim key)', '極限（lim キー）')],
      ['limit((1 + 1/x)^x, ∞)', tr('Limit at infinity', '無限大での極限')],
      ['limit(1/x, 0, x, 1)', tr('Limit from the right (the last 1 means from the right, −1 from the left)', '右からの極限（最後の 1 が右側、−1 が左側）')],
      ['sum(x^2, 1, 10)', tr('Sum (Σ key) from x = 1 to 10', '総和（Σ キー）。x = 1 から 10 まで')],
      ['product(x, 1, 5)', tr('Product (Π key)', '総乗（Π キー）')],
      ['dsolve(diff(y, x) = −2y, 5)', tr('Differential equation y′ = −2y with y(0) = 5 (dsolve key)', '微分方程式 y′ = −2y、y(0) = 5（dsolve キー）')],
      ['newtonsolve(cos(x) = x, 1)', tr("Numerical solution (Newton's method, starting at 1)", '方程式の数値解（ニュートン法、初期値 1）')]
    ]],
    [tr('Matrices', '行列'), [
      ['[1, 2; 3, 4] × [5, 6; 7, 8]', tr('Matrix product. Type matrices with the Matrix keys (";" ends a row)', '行列の積。「行列」のキーで入力（; が行の区切り）')],
      ['[1, 2; 3, 4]^−1', tr('Inverse (A⁻¹ key)', '逆行列（A⁻¹ キー）')],
      ['det([1, 2, 3; 4, 5, 6; 7, 8, 10])', tr('Determinant (det key)', '行列式（det キー）')],
      ['transpose([1, 2, 3; 4, 5, 6])', tr('Transpose (Aᵀ key)', '転置行列（Aᵀ キー）')],
      ['[2, 1; 1, 3]^−1 × [3; 5]', tr('Solve the linear system A x = b', '連立一次方程式 A x = b を解く')],
      ['rref([2, 1, 3; 1, 3, 5])', tr('Reduced row echelon form', '行基本変形（行簡約階段形）')],
      ['rk([1, 2; 2, 4])', tr('Rank (trace gives the trace)', '階数（ランク）。trace はトレース')],
      ['solve(det([2, 1; 1, 2] − x × identity(2)) = 0)', tr('Eigenvalues (solve the characteristic equation)', '固有値（固有方程式を解く）')]
    ]],
    [tr('Vectors', 'ベクトル'), [
      ['dot([1, 2, 3], [4, 5, 6])', tr('Dot product', '内積')],
      ['cross([1, 0, 0], [0, 1, 0])', tr('Cross product', '外積')],
      ['norm([3, 4])', tr('Length (norm)', '長さ（ノルム）')],
      ['[1, 2, 3] + 2 × [4, 5, 6]', tr('Sum and scalar multiple', '和とスカラー倍')]
    ]],
    [tr('Number bases and integers', '進数・整数'), [
      ['255 to hex', tr('To hexadecimal (to bin and to oct too)', '16進数に（to bin、to oct も）')],
      ['0xFF + 0b1010', tr('Mix hexadecimal and binary', '16進数と2進数をまぜて計算')],
      ['2026 to roman', tr('Roman numerals', 'ローマ数字')],
      ['factor(360)', tr('Prime factorization', '素因数分解')],
      ['gcd(84, 36)', tr('Greatest common divisor (lcm: least common multiple)', '最大公約数（lcm は最小公倍数）')]
    ]],
    [tr('Dates', '日付'), [
      ['today + 100 days', tr('The date 100 days from today', '100 日後の日付')],
      ['days(today, "2027-01-01")', tr('Days between two dates', '2 つの日付の間の日数')],
      ['"2026-12-25" − 3 weeks', tr('Subtract a period from a date', '日付から期間を引く')]
    ]],
    [tr('Statistics, uncertainty and constants', '統計・誤差・定数'), [
      ['mean(3, 5, 8, 12)', tr('Mean (median: median, stdev: standard deviation)', '平均（median は中央値、stdev は標準偏差）')],
      ['(5 ± 0.2) m × (3 ± 0.1) m', tr('Propagation of uncertainty', '誤差（不確かさ）の伝わり方')],
      ['1 g × c^2 to kWh', tr('Physical constants (c is the speed of light)', '物理定数（c は光速）')],
      ['planck × 500 THz to eV', tr('With the Planck constant', 'プランク定数を使った計算')],
      ['gamma(1/2)', tr('Gamma function (special functions such as zeta, erf and besselj too)', 'ガンマ関数（zeta、erf、besselj などの特殊関数も使えます）')]
    ]]
  ];
  const TIPS = [
    tr('The result is shown below while you type. Press = to confirm it and keep it in the history.', '入力している間に結果が下に表示されます。= を押すと確定して、履歴に残ります。'),
    tr('Tap a result in the history to insert it, tap an expression to edit it again, or touch and hold to copy or delete.', '履歴の結果をタップすると式に挿入、式をタップするともう一度編集、長押しでコピーや削除ができます。'),
    tr('The → key types "to" (conversion of units, currencies and number bases). Example: 5 km → mi', '→ キーは「to」（単位・通貨・進数の変換）です。例：5 km → mi'),
    tr('After →, the units you can convert to are suggested below the input field (number formats such as hex when there is no unit): tap one to type it. With the phone keyboard, the names of functions, units and constants are suggested while you type them.', '→ の後には、変換先の候補（同じ種類の単位。単位がなければ 16 進数などの表し方）が入力欄の下に出ます。タップすると入力されます。スマホのキーボードで入力しているときは、関数・単位・定数の名前の候補も出ます。'),
    tr('Switch the keys with the tabs 123, Functions, Calculus and Matrix. The ⌨ key opens the phone keyboard.', 'キーは「123」「関数」「解析」「行列」のタブで切り替えます。⌨ キーでスマホのキーボードも使えます。'),
    tr('Touch and hold the x key for other letters: y, z, t, n, a, b, c, k, θ.', 'x キーを長押しすると、ほかの文字（y・z・t・n・a・b・c・k・θ）を選べます。'),
    tr('A fraction: the □/□ key on the Functions page, or touch and hold ÷. Type the numerator, "Next box ▶", then the denominator. Selected text becomes the numerator. Results such as 1/6 are shown as fractions.', '分数は「関数」ページの □/□ キーか、÷ キーの長押しで入力します。分子を入れて「次の欄 ▶」、分母を入れます。選んだ部分は分子になります。1/6 のような結果も分数の形で表示します。'),
    tr('The solve key opens a form for an equation (left side = right side); "+ Add an equation" makes a system of equations.', 'solve キーで方程式を入力する画面（左辺 = 右辺）が開きます。「＋ 式を追加」で連立方程式になります。'),
    tr('📈 above the input field draws the graph of what is typed: an expression in x (2D) or in x and y (3D), an equation such as y = 2x + 1, x² + y² = 4 or z = x y, or a matrix of numbers with 2 or 3 columns (points). Long-pressing a line of the history offers the same.', '入力欄の上の 📈 で、入力した式のグラフを描けます。x の式は 2D、x と y の式は 3D、y = 2x + 1、x² + y² = 4、z = x y のような方程式、2 列か 3 列の数の行列（点）も描けます。履歴の行を長押ししても同じことができます。'),
    tr('In the graph, "Area" finds the area between a function and the x axis or between two functions (the crossing points are offered as ranges), and "Length" the length of a curve or the perimeter between two functions. "Example" draws a circle or an ellipse.', 'グラフの「面積を求める」で、関数と x 軸の間や 2 つの関数の間の面積（交点の間の範囲を選べます）、「長さ・周」で曲線の長さや 2 つの関数に囲まれた部分の周の長さが求められます。「図形の例」で円や楕円を描けます。'),
    tr('In the 3D graph, "Volume and surface" shows the volume under the surface that is drawn (or between two surfaces) and the surface area as soon as it is opened, over the rectangle or over a disk x² + y² ≤ R². The solid that is measured looks like a pale gelatin in a skin of a deeper shade in the graph. The example at the bottom draws a sphere: 32π/3 and 16π for r = 2.', '3D グラフの「体積・表面積」を開くと、いま描いている曲面の下（曲面が 2 つならその間）の体積と表面積がすぐに出ます。範囲は長方形か円 x² + y² ≤ R² です。計測している立体は、グラフで濃い色の皮に包まれた薄い色のゼラチンのように見えます。下の「図形の例：球」は球を描き、r = 2 なら体積 32π/3・表面積 16π が出ます。'),
    tr('1:1 in the graph makes one unit as long on every axis, so a circle or a sphere looks round. In 3D it turns on by itself when the ranges are about the same.', 'グラフの「1:1」で、どの軸も 1 目盛りの長さがそろい、円や球が丸く見えます。3D では範囲の長さが近いときに自動でオンになります。'),
    tr('"Calculus" under a 2D graph draws f′ and ∫f, the tangent at x = a, and marks zeros and extrema; in 3D, "Partial derivatives" draws ∂f/∂x and ∂f/∂y.', '2D グラフの「微分・接線・極値」で f′ と ∫f、x = a での接線を描き、零点と極値に印を付けます。3D の「偏微分」では ∂f/∂x と ∂f/∂y を描きます。'),
    tr('📈 in the forms draws the graph that goes with them: a derivative with its tangent, the area of an integral, the lines or planes of a linear system with its solution, the rows of a matrix as points.', '入力フォームの 📈 で、その計算に合うグラフを描きます。微分なら接線、定積分なら面積、連立方程式なら直線や平面と解の点、行列なら各行の点です。'),
    tr('Calculus has keys for derivatives, integrals, limits, sums and differential equations; Matrix has keys to type matrices and for determinants, inverses and more. "more…" opens the list of the functions of that field.', '「解析」には微分・積分・極限・総和・微分方程式、「行列」には行列の入力と行列式・逆行列などのキーがあります。「ほか…」でその分野の関数の一覧が開きます。'),
    tr('The calculus keys (d/dx, ∫, lim, Σ …) open a form with boxes where the mathematics is written: the limits above and below ∫, the variable under lim. Tap a box (or "Next box ▶") and type with the keys; the result is shown at once. "Insert" puts the expression into the input field.', '解析のキー（d/dx、∫、lim、Σ など）を押すと、数式の形に欄が並んだ入力フォームが開きます（∫ の上下に上端・下端、lim の下に変数など）。欄をタップするか「次の欄 ▶」で選んでキーで入力すると、結果がすぐに表示されます。「式に入れる」で入力欄に入ります。'),
    tr('An empty box of a form becomes □ in the input field: it is selected, so the next key types over it, and "Next box ▶" goes to the next □.', 'フォームで空のままの欄は、入力欄では □ になります。□ は選ばれた状態なので、そのままキーを押すと置き換わります。「次の欄 ▶」で次の □ に移ります。'),
    tr('Above the input field the expression is shown in math notation (fractions, powers, roots, integrals), so you can check what you typed. It can be turned off in the settings.', '入力欄の上に、式が数式の形（分数・べき乗・根号・積分など）で表示されるので、入力した内容を確かめられます。設定で表示しないこともできます。'),
    tr('Touch and hold a result with x (x³ − 3x) to differentiate or integrate it, draw its graph or put in a value for x.', 'x を含む結果（x³ − 3x など）を長押しすると、微分・積分・グラフ・x への値の代入ができます。'),
    tr('Type the "=" of an equation with the a=b key (the large = key calculates). Example: solve(x^2 = 16)', '方程式の「=」は a=b キーで入力します（大きい = キーは計算の確定です）。例：solve(x^2 = 16)'),
    tr('Type a matrix as [1, 2; 3, 4]: "," between the elements and ";" between the rows. Matrix results are shown as tables in the history.', '行列は [1, 2; 3, 4] のように、要素を「,」、行を「;」で区切って入力します。結果の行列は履歴に表の形で表示されます。'),
    tr('The ▦ key of the Matrix page opens a grid of cells: set the rows and columns with + and −, type the elements and choose what to calculate (determinant, inverse, transpose, rank, eigenvalues, linear system). det, Aᵀ and A⁻¹ open it too when the input field is empty. Touch and hold a matrix result to edit it there.', '「行列」ページの ▦ キーで、行列を表の形で入力する画面が開きます。行と列の数を + と − で決めて要素を入れ、計算（行列式・逆行列・転置・階数・固有値・連立方程式）を選びます。入力欄が空のときは det・Aᵀ・A⁻¹ のキーでも開きます。結果の行列を長押しすると、その画面で編集できます。'),
    tr('Tap RAD, AUTO and DEC at the top to switch the angle unit, exact or approximate results, and the number base of results.', '上の「RAD」「自動」「10進」をタップすると、角度の単位、厳密・近似、結果の進数が切り替わります。'),
    tr('Find functions, units and constants in the lists in the menu (search by name or description, for example "integral", "mile" or "speed of light").', '関数・単位・定数は、メニューの一覧から日本語でも探せます（例：「積分」「マイル」「光速」）。'),
    tr('Draw graphs with "Graph" in the menu: 2D graphs of y = f(x) and 3D graphs of z = f(x, y). Expressions with derivatives or integrals such as diff(x^3 − 3x) can be drawn as they are.', 'グラフはメニューの「グラフ」から。y = f(x) の 2D と、z = f(x, y) の 3D が描けます。diff(x^3 − 3x) のように、微分や積分の式もそのまま描けます。'),
    tr('An expression cleared with AC comes back with "Undo", which appears right after.', 'AC で消した式は、すぐ後に出る「元に戻す」で戻せます。'),
    tr('Areas, lengths and volumes of shapes: "Shapes" in the menu. Choose a circle, a triangle, a cylinder and so on, type the sizes, and the results appear at once. In a graph, "Area and length" shades the area, and its edges can be dragged.', '図形の面積・長さ・体積は、メニューの「図形」で求められます。円・三角形・円柱などを選んで大きさを入れると、結果がすぐに出ます。グラフでは「面積・長さ」で面積に色が付き、両端をドラッグして範囲を変えられます。'),
    tr('Below a graph there is a row of samples (a heart, waves, a doughnut, a ripple …): tap one to draw it, then change its functions and ranges as you like.', 'グラフの下にサンプル（ハート、波、ドーナツ、波紋など）が並んでいます。タップすると描けるので、式や範囲を変えて試せます。'),
    tr('In a form, ↶ and ↷ undo and redo, and ⋯ clears all boxes. A form closed without being used keeps its boxes. The matrix form keeps its matrix for the next calculation, takes a table pasted from a spreadsheet, and its ⋯ menu inserts or deletes a row or a column.', 'フォームでは ↶ ↷ で「元に戻す」「やり直す」、⋯ で「すべての欄を消去」ができます。使わずに閉じたフォームは、次に開くと欄がそのまま残っています。行列の画面は入れた行列を次の計算まで覚えていて、表計算ソフトの表を貼り付けでまとめて入れられ、⋯ から行や列の挿入・削除もできます。')
  ];
  function useExample(text) {
    while (panelStack.length) closePanel();
    setExpr(text);
    focusExpr();
  }
  function openExamples() {
    return panel('examples', tr('Examples and tips', '式の例・使い方'), (p) => {
      p.body.append(el('div', { class: 'section-title', text: tr('Examples (tap one to put it in the input field)', '式の例（タップすると入力欄に入ります）') }));
      for (const [group, rows] of EXAMPLES) {
        const box = el('div', { class: 'card ex-group' }, el('div', { class: 'ex-title', text: group }));
        for (const [text, note] of rows) {
          box.append(el('button', { class: 'ex-row', onclick: () => useExample(text) },
            el('span', { class: 'mono ex-expr', text }), el('span', { class: 'ex-note', text: note })));
        }
        p.body.append(box);
      }
      p.body.append(el('div', { class: 'section-title', text: tr('Tips', '使い方のヒント') }),
        el('div', { class: 'card' }, el('ul', { class: 'tips' }, ...TIPS.map((t) => el('li', { text: t })))),
        el('div', { class: 'form-hint', text: tr('Expressions are written as in Qalculate!. See "Functions" in the menu for the functions, and "Units and currencies" for the units and currencies.', '式の書き方は Qalculate! と同じです。使える関数は「関数の一覧」、単位と通貨は「単位・通貨の一覧」にあります。') }));
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
    const names = !JA ? {} : kind === 'functions' ? FUNC_JA : kind === 'variables' ? VAR_JA : JA_NAMES;
    items.forEach((it, i) => { it._i = i; }); // the engine's order: the common units of a category come first
    for (const it of items) {
      it._cat = it.category || tr('Other', 'その他');
      it._top = it._cat.split('/')[0];
      it._ja = own(names, it.name) || (kind === 'units' && own(names, it.abbr)) || '';
      // the Japanese units have English titles and descriptions in the engine
      const jt = JA && kind === 'units' ? own(JA_UNIT_TEXT, it.name) : undefined;
      if (jt) { it.title = jt[0]; it.description = jt[1]; }
      const ja = JA ? it._ja + ' ' + it._cat.split('/').map((c) => own(CATEGORY_JA, c) || '').join(' ')
        : ES ? it._cat.split('/').map((c) => own(CATEGORY_ES, c) || '').join(' ') : '';
      it._q = [it.name, it.abbr, it.display, it.title, it.description, it._cat, ja].join(' ').toLowerCase();
    }
    items.sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
    catalogs[kind] = items;
    return items;
  }
  const CATALOG_TITLE = { functions: tr('Functions', '関数の一覧'), units: tr('Units and currencies', '単位・通貨の一覧'), variables: tr('Variables and constants', '変数・定数の一覧') };
  // titles and descriptions of the traditional Japanese units in Japanese (the engine has them in English)
  const JA_UNIT_TEXT = {
    '坪': ['坪（つぼ・tsubo）', '面積。1 坪 = 1 間 × 1 間 = 400/121 m²（約 3.3058 m²）'],
    '反': ['反（たん）', '面積。1 反 = 300 坪（約 991.74 m²）'],
    '寸': ['寸（すん）', '長さ。1 寸 = 1/10 尺（約 3.0303 cm）'],
    '尺': ['尺（しゃく）', '長さ。1 尺 = 10/33 m（約 30.303 cm）'],
    '間': ['間（けん）', '長さ。1 間 = 6 尺（約 1.8182 m）'],
    '里': ['里（り）', '長さ。1 里 = 36 町 = 2160 間（約 3.9273 km）'],
    '合': ['合（ごう）', '体積。1 合 = 1/10 升（約 180.39 mL）'],
    '升': ['升（しょう）', '体積。1 升 = 2401/1331 L（約 1.8039 L）'],
    '匁': ['匁（もんめ）', '質量。1 匁 = 3.75 g'],
    '貫': ['貫（かん）', '質量。1 貫 = 1000 匁 = 3.75 kg']
  };
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
  // the same categories in Spanish (1.9.0): shown in the lists and found by the search
  const CATEGORY_ES = {
    'Currency': 'Monedas', 'Length': 'Longitud', 'Area': 'Área', 'Volume': 'Volumen', 'Mass': 'Masa', 'Time': 'Tiempo',
    'Speed': 'Velocidad', 'Velocity': 'Velocidad', 'Temperature': 'Temperatura', 'Energy': 'Energía', 'Pressure': 'Presión', 'Force': 'Fuerza',
    'Information': 'Información', 'Angle': 'Ángulo', 'Acceleration': 'Aceleración', 'Density': 'Densidad', 'Electricity': 'Electricidad',
    'Magnetism': 'Magnetismo', 'Light': 'Luz', 'Radioactivity': 'Radiactividad', 'Ratio': 'Proporción', 'Frequency': 'Frecuencia',
    'Fuel Consumption': 'Consumo de combustible', 'Mechanics': 'Mecánica', 'Thermodynamics': 'Termodinámica',
    'Algebra': 'Álgebra', 'Calculus': 'Cálculo', 'Combinatorics': 'Combinatoria', 'Complex Numbers': 'Números complejos',
    'Date & Time': 'Fecha y hora', 'Economics': 'Economía', 'Exponents & Logarithms': 'Exponentes y logaritmos', 'Geometry': 'Geometría',
    'Logical': 'Lógica', 'Matrices & Vectors': 'Matrices y vectores', 'Miscellaneous': 'Varios', 'Number Theory': 'Teoría de números',
    'Statistics': 'Estadística', 'Trigonometry': 'Trigonometría', 'Special Functions': 'Funciones especiales', 'Step Functions': 'Funciones escalón',
    'Utilities': 'Utilidades', 'Unit Conversion': 'Conversión de unidades', 'Data Sets': 'Conjuntos de datos', 'Physics': 'Física',
    'Constants': 'Constantes', 'Large Numbers': 'Números grandes', 'Small Numbers': 'Números pequeños', 'Unknowns': 'Incógnitas',
    'User variables': 'Del usuario', 'User functions': 'Del usuario', 'Temporary': 'Temporales',
    'Japanese Units': 'Unidades japonesas', 'Typography': 'Tipografía', 'Substance': 'Cantidad de sustancia', 'Basic Constants': 'Constantes básicas',
    'Physical Constants': 'Constantes físicas', 'Special Numbers': 'Números especiales', 'Traditional Numbers': 'Números tradicionales'
  };
  // a category of the engine in the language of the user interface (English when there is no name for it)
  const catName = (c) => (JA ? own(CATEGORY_JA, c) : ES ? own(CATEGORY_ES, c) : undefined) || c;
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
      const search = el('input', { class: 'search', type: 'search', placeholder: tr('Search (name, description)', '検索（名前・説明）'), autocomplete: 'off' });
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
        count.textContent = tr(shown.length + (shown.length === 1 ? ' item' : ' items'), shown.length + ' 件', shown.length + (shown.length === 1 ? ' elemento' : ' elementos'));
        list.textContent = '';
        const frag = document.createDocumentFragment();
        for (const it of shown.slice(0, 400)) frag.append(catalogRow(kind, it));
        if (shown.length > 400) frag.append(el('div', { class: 'card muted', text: tr('Showing the first 400 items. Search to narrow them down.', '先頭の 400 件を表示しています。検索で絞り込んでください。') }));
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
      // a search looks in all the categories (the units start with the currencies, and "more…" opens
      // one category); a category can then be chosen to narrow the results down
      search.addEventListener('input', debounce(() => {
        if (!p.state.q.trim() && search.value.trim()) p.state.cat = '';
        p.state.q = search.value;
        render();
      }, 150));
      // show one category from the start (the "more…" key of the Calculus and Matrix key pages)
      p.setCategory = (c) => {
        p.state.cat = c; p.state.q = ''; search.value = '';
        p.body.scrollTop = 0;
        if (catalogs[kind]) render();
      };
      const load = () => { list.textContent = ''; list.append(el('div', { class: 'spinner' })); loadCatalog(kind).then(show).catch(failed); };
      const failed = (e) => {
        list.textContent = '';
        list.append(el('div', { class: 'card muted', text: tr('Could not load the list (', '一覧を読み込めませんでした（') + e.message + tr(')', '）') }),
          el('button', { class: 'btn primary', text: tr('Try again', 'もう一度読み込む'), onclick: load }));
      };
      const show = (items) => {
        cats.textContent = '';
        const tops = Array.from(new Set(items.map((i) => i._top))).sort((a, b) => a.localeCompare(b));
        if (p.state.cat && tops.indexOf(p.state.cat) < 0) p.state.cat = '';
        cats.append(el('button', { 'data-cat': '', text: tr('All', 'すべて'), onclick: () => { p.state.cat = ''; render(); } }));
        for (const t of tops) cats.append(el('button', { 'data-cat': t, text: catName(t), onclick: () => { p.state.cat = t; render(); } }));
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
      acts.append(el('button', { class: 'btn primary', text: tr('Insert', '挿入'), onclick: (e) => { e.stopPropagation(); const t = functionTemplate(it); useItem(t[0], t[1]); } }));
    } else if (kind === 'units') {
      // "abbr" is the text the engine has checked to be read as this unit (km, km/h, kW·h, $, °C);
      // the internal names of composite units (km_c, km_p_h) are not shown
      const text = it.abbr || it.name;
      const names = it.composite || text === it.name ? text : text + '  (' + it.name + ')';
      row.append(el('div', { class: 'n', text: names + (it.display && it.display !== text ? '  ' + it.display : '') }));
      acts.append(el('button', { class: 'btn', text: tr('Convert', '変換'), onclick: (e) => { e.stopPropagation(); useItem(' to ' + text, 0); } }));
      if (it.insert !== false) acts.append(el('button', { class: 'btn primary', text: tr('Insert', '挿入'), onclick: (e) => { e.stopPropagation(); useItem(text, 0); } }));
    } else {
      row.append(el('div', { class: 'n', text: it.name + (it.display && it.display !== it.name ? '  (' + it.display + ')' : '') + (it.value ? '  = ' + it.value : '') }));
      acts.append(el('button', { class: 'btn primary', text: tr('Insert', '挿入'), onclick: (e) => { e.stopPropagation(); useItem(it.name, 0); } }));
    }
    row.append(el('div', { class: 'c', text: it._cat.split('/').map(catName).join(' / ') }));
    if (it.description) row.append(el('div', { class: 'd', text: it.description }));
    row.addEventListener('click', () => row.classList.toggle('expanded'));
    return row;
  }
  // A function from the list: name(□, □) with a box for each needed argument when it has two or more
  // (the syntax "log(x, [base=e])" tells which are needed), else name() with the caret inside.
  function functionTemplate(it) {
    const m = /\((.*)\)$/.exec(it.syntax || '');
    let n = 0, d = 0, cur = '';
    if (m) {
      const parts = [];
      for (const c of m[1]) { if (c === '[' || c === '(') d++; else if (c === ']' || c === ')') d--; if (c === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += c; }
      parts.push(cur);
      n = parts.filter((x) => x.trim() && x.trim()[0] !== '[' && x.trim() !== '…').length;
    }
    return n >= 2 ? [it.name + '(' + Array(n).fill('□').join(', ') + ')', 0] : [it.name + '()', 1];
  }
  function useItem(text, back) {
    while (panelStack.length) closePanel();
    insert(text, back, false);
    focusExpr();
  }

  // ======================================================== suggestions
  // A row of chips under the input field (#suggest):
  //  - While a name is typed with the phone's keyboard: the functions, variables and units whose
  //    name begins with the letters typed, or whose title has a word that does ("pound" finds lb).
  //    On the Japanese screen a Japanese name finds them too (積分 finds integrate).
  //  - After "to" (the → key): what the value can be converted to. When the expression has a unit,
  //    the other units of its category in the unit list (5 km to … m, mi, ft); otherwise other ways
  //    to write a number (fraction, hex, factors).
  // Tapping a chip writes the name; a function gets its parentheses with the caret between them.
  const sugEl = $('#suggest');
  let sugData = null, sugLoading = null, sugSeq = 0;
  // the units of a category that are used most come first; the rest follow in the engine's order
  const COMMON_UNITS = {
    'Length': ['m', 'km', 'cm', 'mm', 'mi', 'ft', 'in', 'yd', 'nmi'],
    'Mass': ['kg', 'g', 'lb', 'oz', 't'],
    'Temperature': ['°C', '°F', 'K'],
    'Speed': ['km/h', 'm/s', 'mph', 'knot'],
    'Area': ['m²', 'km²', 'ha', 'acre', 'ft²'],
    'Volume': ['L', 'mL', 'm³', 'cm³'],
    'Time': ['s', 'min', 'h', 'd', 'week', 'month'],
    'Currency': JA ? ['JPY', 'USD', 'EUR', 'GBP', 'CNY', 'KRW', 'AUD', 'CAD', 'CHF'] : ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'KRW'],
    'Information': ['B', 'kB', 'MB', 'GB', 'TB', 'bit', 'KiB', 'MiB', 'GiB'],
    'Energy': ['J', 'kJ', 'cal', 'kcal', 'kW⋅h', 'W⋅h', 'eV', 'Btu'],
    'Energy/Power': ['W', 'hp', 'PS'],
    'Force/Pressure': ['Pa', 'bar', 'atm', 'psi', 'mmHg', 'Torr'],
    'Angle/Plane Angle': ['rad', 'deg', 'gra', 'arcmin', 'arcsec']
  };
  // the traditional Japanese units have a category of their own in the unit list; what they measure:
  const JP_UNIT_CATEGORY = { '坪': 'Area', '反': 'Area', '寸': 'Length', '尺': 'Length', '間': 'Length', '里': 'Length', '合': 'Volume', '升': 'Volume', '匁': 'Mass', '貫': 'Mass' };
  // after "to" when the expression has no unit: other ways to write a number
  const NUMBER_FORMS = [
    ['fraction', tr('fraction', '分数')], ['hex', tr('hexadecimal', '16進数')], ['bin', tr('binary', '2進数')], ['oct', tr('octal', '8進数')],
    ['factors', tr('prime factors', '素因数分解')], ['sci', tr('scientific notation', '指数表記')], ['roman', tr('Roman numerals', 'ローマ数字')]
  ];
  // How a unit is written in an expression: the spelling the engine has checked (abbr), but the
  // code of a currency (USD, not $) and °C, °F as they are shown (not oC, oF).
  function unitText(it) {
    if (it.currency) return it.name;
    if (it.display && it.display[0] === '°' && it.display.length === 2) return it.display;
    return it.abbr || it.name;
  }
  function loadSugData() {
    if (!sugLoading) {
      sugLoading = Promise.all([loadCatalog('functions'), loadCatalog('variables'), loadCatalog('units')]).then(buildSugData)
        .catch(() => { sugLoading = null; });
    }
    return sugLoading;
  }
  function buildSugData() {
    const units = catalogs.units.slice().sort((a, b) => a._i - b._i);
    const byText = new Map(), byTitle = new Map(), byCat = new Map();
    for (const it of units) {
      it._text = unitText(it);
      it._conv = own(JP_UNIT_CATEGORY, it.name) || it._cat;
      if (!byText.has(it._text)) byText.set(it._text, it);
      if (!byCat.has(it._conv)) byCat.set(it._conv, []);
      byCat.get(it._conv).push(it);
    }
    for (const it of units) {
      for (const k of [it.abbr, it.name, it.display]) if (k && !byText.has(k)) byText.set(k, it);
      const t = String(it.title || '').toLowerCase();
      if (t && !byTitle.has(t)) byTitle.set(t, it);
    }
    for (const [cat, list] of byCat) {
      const common = own(COMMON_UNITS, cat) || [];
      // on the Japanese screen the Japanese units follow the common ones
      const pos = (it) => { const i = common.indexOf(it._text); return i >= 0 ? i : JA && it._cat === 'Japanese Units' ? 100 : 1000; };
      list.sort((a, b) => pos(a) - pos(b) || a._i - b._i);
    }
    const names = new Set();
    for (const it of catalogs.functions) names.add(it.name);
    for (const it of catalogs.variables) names.add(it.name);
    sugData = { byText, byTitle, byCat, names };
  }
  // The place of the caret: the name being typed there (word, from start), whether it follows
  // "to" (conv), and the expression before that "to" (src). null: nothing is offered here.
  function sugContext() {
    const v = exprEl.value, s = exprEl.selectionStart;
    if (s === undefined || s === null || s !== exprEl.selectionEnd) return null;
    if (/^[\p{L}\p{N}_]/u.test(v.slice(s))) return null; // in the middle of a name or a number
    const before = v.slice(0, s);
    const m = /[\p{L}_][\p{L}\p{N}_]*$/u.exec(before);
    const word = m ? m[0] : '';
    const head = before.slice(0, before.length - word.length);
    const to = /(?:^|\s)(?:to|→|->)\s+$/i.exec(head);
    return { word, start: s - word.length, end: s, conv: !!to, src: to ? head.slice(0, to.index) : '' };
  }
  function lookupUnit(tok) {
    const d = sugData;
    let it = d.byText.get(tok);
    if (it) return it;
    if (d.names.has(tok)) return null; // a function or a variable ("sin" is not s·in)
    const low = tok.toLowerCase();
    it = d.byTitle.get(low) || (low.length > 3 && low.slice(-1) === 's' ? d.byTitle.get(low.slice(0, -1)) : undefined); // meter, miles
    if (it) return it;
    // an SI prefix that the unit list does not have with this unit: kPa, mg, GHz, μs
    if (tok.length > 1 && 'kMGmcµμn'.indexOf(tok[0]) >= 0) {
      it = d.byText.get(tok.slice(1));
      if (it && !it.currency && it._cat !== 'Japanese Units') { prefixed.add(it); return it; }
    }
    return null;
  }
  const prefixed = new Set(); // units found with a prefix in the expression being looked at (kPa: Pa)
  // the units written in an expression (a name followed by "(" is a function)
  function unitsIn(src) {
    const found = [];
    prefixed.clear();
    const re = /°[CFR]|[\p{L}$€£¥₩₿][\p{L}\p{N}_²³⋅·]*(?:\/[\p{L}][\p{L}\p{N}²³]*)?/gu;
    let m;
    while ((m = re.exec(src))) {
      const tok = m[0];
      if (src[m.index + tok.length] === '(') continue;
      const it = lookupUnit(tok);
      if (it) { found.push(it); continue; }
      if (tok.indexOf('/') > 0) for (const part of tok.split('/')) { const u = lookupUnit(part); if (u) found.push(u); }
    }
    return found;
  }
  function unitNote(it) { return (JA && it._ja ? it._ja.split(' ')[0] : it.title) || ''; }
  // after "to", before anything is typed
  function conversionChips(src) {
    const found = unitsIn(src);
    if (!found.length) return NUMBER_FORMS.map(([text, note]) => ({ kind: 'k', text, note }));
    const cats = new Set(found.map((it) => it._conv));
    if (cats.size !== 1) return []; // km and h: what the whole expression measures is not known here
    const out = [];
    for (const it of sugData.byCat.get(found[0]._conv) || []) {
      if (found.indexOf(it) >= 0 && !prefixed.has(it)) continue; // the unit it already has
      out.push({ kind: 'u', text: it._text, note: unitNote(it) });
      if (out.length >= 16) break;
    }
    return out;
  }
  // Names for the letters typed. After "to" only what a value can be converted to: units (those of
  // category cat, if the expression has a unit and any of them fits) and the ways to write a number.
  function nameChips(word, conv, cat) {
    const w = word.toLowerCase(), ascii = /^[\x20-\x7e]+$/.test(word), out = [];
    if (!conv) {
      // a variable or a unit that is already written in full (pi, kg): nothing to offer
      const d = sugData;
      const isUnit = d.byText.has(word), isFunc = catalogs.functions.some((it) => it.name === word);
      if (!isFunc && (isUnit || catalogs.variables.some((it) => it.name === word))) return [];
    }
    const rank = (text, title, ja) => {
      if (text === word) return 0;
      if (text.indexOf(word) === 0) return 1;
      if (text.toLowerCase().indexOf(w) === 0) return 2;
      if (!ascii) {
        if (!ja || ja.indexOf(word) < 0) return -1;
        const names = ja.split(' ');
        return names.indexOf(word) >= 0 ? 3 : names.some((x) => x.indexOf(word) === 0) ? 3.5 : 4;
      }
      return w.length >= 4 && title && title.toLowerCase().split(/[^a-z0-9]+/).some((x) => x.indexOf(w) === 0) ? 4 : -1;
    };
    const add = (kind, order, it, text, note) => {
      const r = rank(text, it.title, it._ja);
      if (r < 0 || (r === 0 && kind !== 'f')) return; // not found, or already written in full
      out.push({ kind, text, note, r, order, i: it._i || 0 });
    };
    if (conv) {
      const full = sugData.byText.get(word), only = cat || (full ? full._conv : ''); // a unit written in full (m²) offers only longer names of its own kind, not m²·A
      for (const it of catalogs.units) if (!only || it._conv === only) add('u', 1, it, it._text, unitNote(it));
      if (only && !out.length && !full) return nameChips(word, conv, '');
      for (const [text, note] of NUMBER_FORMS) add('k', 0, { title: '' }, text, note);
    } else {
      for (const it of catalogs.functions) add('f', 1, it, it.name, unitNote(it));
      for (const it of catalogs.variables) add('v', 2, it, it.name, unitNote(it));
      for (const it of catalogs.units) if (it.insert !== false) add('u', 3, it, it._text, unitNote(it));
    }
    out.sort((a, b) => a.r - b.r || a.order - b.order || a.text.length - b.text.length || a.i - b.i);
    const seen = new Set();
    return out.filter((c) => !seen.has(c.kind + c.text) && seen.add(c.kind + c.text)).slice(0, 8);
  }
  // the one category of the units in an expression, or '' (no unit, or units of several categories)
  function unitCategory(src) {
    const cats = new Set(unitsIn(src).map((it) => it._conv));
    return cats.size === 1 ? cats.values().next().value : '';
  }
  function showSuggest(chips, cx) {
    sugEl.textContent = '';
    for (const c of chips) {
      const b = tapButton({ class: 'sug', 'aria-label': c.text + (c.note ? tr(', ', '、') + c.note : '') }, () => applySuggest(c, cx));
      b.append(el('b', { text: c.kind === 'f' ? c.text + '()' : c.text }));
      if (c.note) b.append(el('small', { text: c.note }));
      sugEl.append(b);
    }
    sugEl.hidden = !chips.length;
    sugEl.scrollLeft = 0;
  }
  // writes the chosen name in place of the letters typed
  function applySuggest(c, cx) {
    const v = exprEl.value;
    if (v.slice(cx.start, cx.end) !== cx.word) return; // the expression changed in the meantime
    let text = c.text, pos = cx.start + text.length;
    if (c.kind === 'f') {
      if (v[cx.end] !== '(') text += '()';
      pos += 1; // between the parentheses
    }
    dropUndo();
    exprEl.value = v.slice(0, cx.start) + text + v.slice(cx.end);
    exprEl.setSelectionRange(pos, pos);
    exprChanged();
    showSuggest([]);
    focusExpr();
  }
  // typed: the last change was typed with the phone's keyboard. The on-screen keys write whole
  // names, so for them only the conversions after "to" are offered.
  function updateSuggest(typed) {
    const seq = ++sugSeq;
    const cx = sugContext();
    if (!cx || /^to$/i.test(cx.word) || (!cx.conv && (!typed || cx.word.length < 2))) { showSuggest([]); return; }
    if (!sugData) {
      showSuggest([]);
      if (engineReady) loadSugData().then(() => { if (seq === sugSeq && sugData) updateSuggest(typed); });
      return;
    }
    showSuggest(cx.word ? nameChips(cx.word, cx.conv, cx.conv ? unitCategory(cx.src) : '') : conversionChips(cx.src), cx);
  }

  // -------------------------------------------------------------- plot
  const COLORS = ['#2563eb', '#e11d48', '#059669', '#d97706', '#7c3aed', '#0891b2'];
  const P = { series: [], view: null, dataX: null, exprs: [] };
  function openPlot() {
    const p = panel('plot', tr('Graph', 'グラフ'), (p) => {
      // 2D (y = f(x)) and 3D (z = f(x, y)); the last one used is shown
      const b2 = el('button', { text: tr('2D  y = f(x)', '2D　y = f(x)') }), b3 = el('button', { text: tr('3D  z = f(x, y)', '3D　z = f(x, y)') });
      const f2 = el('div', { class: 'plot-mode' }), f3 = build3d();
      let started2d = false;
      const setMode = (m) => {
        if (m === '3d' && !hasPro()) m = '2d';
        store.set('qalc.plot.mode', m);
        b2.classList.toggle('on', m === '2d'); b3.classList.toggle('on', m === '3d');
        b2.setAttribute('aria-pressed', String(m === '2d')); b3.setAttribute('aria-pressed', String(m === '3d'));
        f2.hidden = m !== '2d'; f3.hidden = m !== '3d';
        if (m === '3d') { Q3.start(); return; }
        if (started2d) { draw(); return; }
        started2d = true;
        if (store.get('qalc.plot.ok', true)) setTimeout(() => compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value)), 260);
        else msg.textContent = tr('Press "Draw" to draw the graph', '「描画」を押すとグラフを描きます');
      };
      b2.addEventListener('click', () => setMode('2d'));
      b3.dataset.pro = '';
      b3.addEventListener('click', () => {
        if (!hasPro()) { proPrompt(tr('3D graphs are a QCalc Pro feature', '3D グラフは QCalc Pro の機能です')); return; }
        setMode('3d');
      });
      const ta = el('textarea', { rows: 2, placeholder: tr('Functions (one per line, variable x)', '関数（1行に1つ、変数は x）'), spellcheck: 'false', autocapitalize: 'off' });
      ta.value = store.get('qalc.plot.exprs', 'sin(x)\nx^2/10');
      const xmin = el('input', { value: store.get('qalc.plot.min', '-10'), inputmode: 'text', autocapitalize: 'off' });
      const xmax = el('input', { value: store.get('qalc.plot.max', '10'), inputmode: 'text', autocapitalize: 'off' });
      const go = el('button', { class: 'btn primary', text: tr('Draw', '描画') });
      const canvas = el('canvas', { role: 'img', 'aria-label': tr('2D graph', '2D グラフ') });
      const tip = el('div', { class: 'plot-tip', 'aria-live': 'polite' });
      const ctl = el('div', { class: 'plot-ctl' },
        el('button', { text: '+', 'aria-label': tr('Zoom in', '拡大'), onclick: () => zoom(0.5) }),
        el('button', { text: '−', 'aria-label': tr('Zoom out', '縮小'), onclick: () => zoom(2) }),
        el('button', { text: '⟲', 'aria-label': tr('Back to the entered range', '入力した範囲に戻す'), onclick: () => {
          P.view = null; P.mark = null; P.tip.style.display = 'none';
          compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value));
        } }),
        // the same length for one unit on both axes (a circle stays round); kept for the next graphs
        P.eqBtn = el('button', { class: 'eq', text: '1:1', 'aria-label': tr('The same scale on the x and y axes', 'x と y の目盛りの間隔をそろえる'), onclick: () => {
          P.equal = !P.equal;
          store.set('qalc.plot.equal', P.equal);
          P.view = null; P.mark = null; P.tip.style.display = 'none';
          draw();
        } }));
      P.equal = P.equal || store.get('qalc.plot.equal', false) === true;
      const wrap = el('div', { class: 'plot-wrap' }, canvas, ctl, tip);
      const legend = el('div', { class: 'legend' });
      const msg = el('div', { class: 'form-hint' });
      f2.append(el('div', { class: 'plot-form' }, ta,
        el('div', { class: 'plot-range' }, el('span', { text: tr('x:', 'x：') }), xmin, el('span', { text: tr('to', '〜') }), xmax, go)),
      wrap, legend, msg, el('div', { class: 'tools' }, buildCalc2d(), buildArea2d()), P.samples = buildSamples(SAMPLES2D, false, drawSample2d),
      el('div', { class: 'form-hint', text: tr('Drag to move, pinch to zoom, tap to show the coordinates. The functions are the same as on the calculator.', 'ドラッグで移動、2本指で拡大・縮小、タップで座標を表示します。式に使える関数は計算画面と同じです。') }));
      p.body.append(el('div', { class: 'seg', role: 'group', 'aria-label': tr('Type of graph', 'グラフの種類') }, b2, b3), f2, f3);
      P.canvas = canvas; P.tip = tip; P.legend = legend; P.msg = msg; P.wrap = wrap;
      P.ta = ta; P.go = go; P.setMode = setMode; P.xmin = xmin; P.xmax = xmax;
      go.addEventListener('click', () => {
        store.set('qalc.plot.exprs', ta.value); store.set('qalc.plot.min', xmin.value); store.set('qalc.plot.max', xmax.value);
        document.activeElement && document.activeElement.blur();
        // points and marks belong to the graph they were made for (a matrix, a form), not to one drawn by hand
        if (!P.keep) {
          P.points = null; P.marks = []; P.pending = null; P.guides = null;
          // the same scale of a sample (a circle) and the marked sample stay while the same functions
          // are drawn again with another range; other functions drop them (1.8.3)
          if (plotExprs(ta.value, 6).join('\n') !== (P.exprs || []).join('\n')) { P.equal = store.get('qalc.plot.equal', false) === true; if (P.samples) P.samples.clearChoice(); }
        }
        P.keep = false;
        P.exprs = plotExprs(ta.value, 6);
        P.view = null;
        P.mark = null; P.tip.style.display = 'none'; // the point that was tapped belongs to the graph before
        compute(normalizeExpr(xmin.value), normalizeExpr(xmax.value));
      });
      setupPlotGestures(wrap);
      window.addEventListener('resize', debounce(() => { draw(); draw3d(); }, 120));
      P.exprs = plotExprs(ta.value, 6);
      setMode(store.get('qalc.plot.mode', '2d') === '3d' ? '3d' : '2d');
    });
    return p;
  }
  // the graph of one function (a history line: "Draw a graph")
  // The 2D graph of functions from elsewhere (a history line, a form, a matrix). opts:
  //   range [min, max]   the range of x
  //   points [{x, y}]    points to draw (the rows of a matrix)
  //   marks [{x, label}] points on the first function to mark (x is an expression)
  //   area {a, b}        the area under the first function from a to b, shaded
  //   tangentAt a        the tangent of the first function at x = a
  //   roots true         the crossing points of the first two functions are marked
  function openPlotWith(exprs, opts) {
    opts = opts || {};
    // another graph than the sample whose card is marked (an example shape, a form): the mark goes (1.8.2)
    if (!opts.sample && P.samples) P.samples.clearChoice();
    const list = (Array.isArray(exprs) ? exprs : [exprs]).filter(Boolean).slice(0, 6);
    store.set('qalc.plot.exprs', list.join('\n'));
    if (opts.range) { store.set('qalc.plot.min', String(opts.range[0])); store.set('qalc.plot.max', String(opts.range[1])); }
    store.set('qalc.plot.mode', '2d');
    P.points = opts.points || null;
    P.marks = [];
    P.guides = null;
    P.equal = !!opts.equal || store.get('qalc.plot.equal', false) === true; // the same scale on both axes (a circle stays round)
    P.pending = opts;
    const built = !!panels.plot;
    if (!built) store.set('qalc.plot.ok', true);
    openPlot();
    if (built && P.ta) {
      P.ta.value = list.join('\n');
      if (opts.range) { P.xmin.value = String(opts.range[0]); P.xmax.value = String(opts.range[1]); }
      P.setMode('2d');
      P.keep = true;
      P.go.click();
    }
  }
  // a number from an expression (π/2, √2, 1/3), or NaN
  async function numValue(expr) {
    const r = await Bridge.send('calc', { expr: String(expr), opts: Object.assign(engineOpts(), { approx: 'approx', precision: 15, grouping: false }), timeout: 1500 });
    return r.ok && r.result ? Number(numberPart(r.result)) : NaN;
  }
  // the exact text of a result, as an expression (the part before ≈ or "="), or ''
  async function exactText(expr) {
    const r = await Bridge.send('calc', { expr, opts: Object.assign(engineOpts(), { grouping: false }), timeout: 3000 });
    if (!r.ok || !r.result || (r.messages || []).some((m) => m.type === 'error')) return '';
    return r.result.split(' ≈ ')[0].split(' = ')[0].trim();
  }
  // after a graph was drawn: the marks, the area, the tangent asked for by openPlotWith
  async function applyPending() {
    const o = P.pending;
    P.pending = null;
    if (!o) return;
    const f = P.series[0];
    if (o.marks && f) {
      for (const m of o.marks) {
        const x = await numValue(m.x);
        if (isFinite(x)) P.marks.push({ x, y: seriesY(f, x), label: m.label || '' });
      }
    }
    for (const p of o.pts || []) if (isFinite(p.x) && isFinite(p.y)) P.marks.push({ x: p.x, y: p.y, label: p.label || '' });
    if (o.zeros && f) {
      for (const z of await findCrossings(f, null)) P.marks.push({ x: z.x, y: 0, label: 'x = ' + (z.text.length < 12 ? z.text : short(z.x)) });
    }
    if (o.roots && P.series.length >= 2) {
      for (const p of await findCrossings(P.series[0], P.series[1])) P.marks.push({ x: p.x, y: seriesY(P.series[0], p.x), label: 'x = ' + short(p.x) });
    }
    if (o.tangentAt !== undefined && o.tangentAt !== null && o.tangentAt !== '' && f) {
      const line = await drawTangent(f, String(o.tangentAt));
      if (line) { P.ta.value = P.ta.value.trim() + '\n' + line; P.keep = true; P.go.click(); return; }
    }
    if (o.area && f && P.areaUI) {
      const U = P.areaUI;
      U.box.hidden = false; U.box.previousSibling && U.box.previousSibling.classList.add('on');
      areaFunctionsChanged();
      U.f1.value = '0'; U.f2.value = o.area.between && P.series.length > 1 ? '1' : 'axis';
      await areaPairChanged();
      U.a.value = String(o.area.a); U.b.value = String(o.area.b);
      await computeArea();
      if (o.area.length) computeLength();
    }
    draw();
  }
  async function compute(min, max, keepView) {
    if (!P.exprs.length) {
      // only points (the rows of a matrix)
      if (P.points && P.points.length) {
        P.series = [];
        const xs = P.points.map((p) => p.x);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), m = (x1 - x0) * 0.15 || 1;
        P.dataX = [x0 - m, x1 + m];
        P.view = null;
        P.legend.textContent = '';
        P.legend.append(el('span', { style: '--c:' + COLORS[0], text: tr('Points: ', '点：') + P.points.length }));
        P.msg.textContent = '';
        draw();
        applyPending();
      } else P.msg.textContent = tr('Enter a function (for example sin(x)), or tap a sample', '関数を入れてください（例：sin(x)）。下のサンプルもタップで描けます');
      return;
    }
    P.msg.textContent = tr('Calculating…', '計算中…');
    const r = await Bridge.send('plot', { exprs: P.exprs, min: String(min), max: String(max), steps: 600, var: 'x', opts: engineOpts(), timeout: 12000 });
    if (!r.ok && r.error === 'invalid range' && !keepView && !P.swapped) {
      // the range the wrong way round ("5 to 1"): the two ends change places
      const a = await numValue(min), b = await numValue(max);
      if (isFinite(a) && isFinite(b) && a > b && P.xmin) {
        const t = P.xmin.value; P.xmin.value = P.xmax.value; P.xmax.value = t;
        store.set('qalc.plot.min', P.xmin.value); store.set('qalc.plot.max', P.xmax.value);
        P.swapped = true;
        try { await compute(max, min); } finally { P.swapped = false; }
        return;
      }
    }
    if (!r.ok) { P.msg.textContent = r.error === 'invalid range' ? tr('Check the range of x', 'x の範囲を確認してください') : (localMessage(r.error) || tr('Could not calculate the graph', 'グラフを計算できませんでした')); return; }
    if (!Array.isArray(r.series)) { P.msg.textContent = tr('The calculation took too long and was stopped', '時間がかかりすぎたため計算を中止しました'); return; }
    // moving or zooming the graph only reads its values again: the shaded area and its results stay
    const kept = keepView && P.area ? [P.series.indexOf(P.area.f), P.area.g ? P.series.indexOf(P.area.g) : -1] : null;
    P.series = r.series.map((s, i) => ({ expr: P.exprs[i], x: s.x, y: s.y, color: COLORS[i % COLORS.length] }));
    const err = (r.messages || []).find((m) => m.type === 'error');
    P.msg.textContent = plotNote(err, P.exprs, P.series.filter((q) => !q.y.some((v) => v !== null)).map((q) => q.expr), 6, false);
    let x0 = Infinity, x1 = -Infinity;
    for (const s of P.series) for (const x of s.x) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    P.dataX = isFinite(x0) ? [x0, x1] : null;
    if (!keepView) P.view = null;
    P.legend.textContent = '';
    for (const s of P.series) P.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.y.some((v) => v !== null) ? '' : tr(' (no values)', '（値なし）')) }));
    if (kept && P.series[kept[0]] && (kept[1] < 0 || P.series[kept[1]])) {
      P.area.f = P.series[kept[0]]; P.area.g = kept[1] < 0 ? null : P.series[kept[1]];
    } else {
      P.area = null;
      // with the area tools open, a new graph shows its area at once (unless a form or a shape asks for its own)
      if (P.areaUI) { P.areaUI.auto = !P.areaUI.box.hidden && !(P.pending && P.pending.area); areaFunctionsChanged(); }
    }
    if (P.calcUI) calcFunctionsChanged();
    store.set('qalc.plot.ok', false);
    draw();
    store.set('qalc.plot.ok', true);
    applyPending();
  }
  function autoView() {
    if (!P.dataX) return { x0: -10, x1: 10, y0: -10, y1: 10 };
    const ys = [];
    // tangent lines do not count (a long straight line would flatten the function)
    let scaled = P.series.filter((s) => !(P.guides && P.guides.has(s.expr)));
    if (!scaled.length) scaled = P.series;
    for (const s of scaled) for (const y of s.y) if (y !== null && isFinite(y)) ys.push(y);
    for (const p of P.points || []) ys.push(p.y);
    ys.sort((a, b) => a - b);
    let y0 = -1, y1 = 1;
    if (ys.length) {
      y0 = ys[Math.floor(ys.length * 0.02)];
      y1 = ys[Math.min(ys.length - 1, Math.ceil(ys.length * 0.98))];
      if (ys.length < 50) { y0 = ys[0]; y1 = ys[ys.length - 1]; }
      const eps = Math.max(Math.abs(y0), Math.abs(y1)) * 1e-9 || 1;
      if (y1 - y0 < eps) { y0 -= eps; y1 += eps; }
      const m = (y1 - y0) * (P.points && P.points.length ? 0.15 : 0.08); // points keep off the edges
      y0 -= m; y1 += m;
    }
    let x0 = P.dataX[0], x1 = P.dataX[1];
    const W = P.canvas && P.canvas.clientWidth, H = P.canvas && P.canvas.clientHeight;
    if (P.equal && W > 0 && H > 0) {
      // the same length for one unit on both axes: the narrower range is widened
      const ux = (x1 - x0) / W, uy = (y1 - y0) / H;
      if (ux > uy) { const c = (y0 + y1) / 2, h = ux * H / 2; y0 = c - h; y1 = c + h; }
      else { const c = (x0 + x1) / 2, h = uy * W / 2; x0 = c - h; x1 = c + h; }
    }
    return { x0, x1, y0, y1 };
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
    if (P.eqBtn) { P.eqBtn.classList.toggle('on', !!P.equal); P.eqBtn.setAttribute('aria-pressed', String(!!P.equal)); }
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
    if (!P.series.length && !(P.points && P.points.length)) return;
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
    if (P.area) drawArea(g, sx, sy);
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
    // points (the rows of a matrix) and marks (crossing points, extrema, the point of a tangent)
    g.font = '12px system-ui, sans-serif'; g.textBaseline = 'bottom'; g.textAlign = 'left';
    for (const p of P.points || []) {
      g.fillStyle = COLORS[0];
      g.beginPath(); g.arc(sx(p.x), sy(p.y), 5, 0, Math.PI * 2); g.fill();
    }
    for (const m of P.marks || []) {
      if (!isFinite(m.x) || !isFinite(m.y)) continue;
      const px = sx(m.x), py = sy(m.y);
      g.fillStyle = '#e11d48'; g.strokeStyle = css.getPropertyValue('--plot-bg').trim() || '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (m.label) { g.fillStyle = axisColor; g.fillText(m.label, Math.min(px + 7, W - g.measureText(m.label).width - 2), Math.max(py - 5, 14)); }
    }
    if (P.mark) {
      g.fillStyle = P.mark.color;
      g.beginPath(); g.arc(sx(P.mark.x), sy(P.mark.y), 4.5, 0, Math.PI * 2); g.fill();
    }
    if (P.area) drawAreaEdges(g, sx, W, H, css); else delete c.dataset.area;
  }
  // The two edges of the shaded area, each with a grip to drag (setupPlotGestures), and the value
  // of the area (and of the length, when it was asked for) in the corner of the graph.
  const GRIP_Y = 0.62;
  function drawAreaEdges(g, sx, W, H, css) {
    const A = P.area, bg = css.getPropertyValue('--plot-bg').trim() || '#fff';
    g.save();
    for (const x of [A.a, A.b]) {
      const px = Math.round(sx(x)) + .5;
      if (px < -20 || px > W + 20) continue;
      g.strokeStyle = A.f.color; g.globalAlpha = 0.75; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1; g.fillStyle = bg; g.lineWidth = 2;
      g.beginPath(); g.arc(px, H * GRIP_Y, 9, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = A.f.color; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('↔', px, H * GRIP_Y + 0.5);
    }
    const lines = [A.text, A.lenText].filter(Boolean);
    P.canvas.dataset.area = lines.join(' / '); // what the graph shows, as text
    if (lines.length) {
      g.font = '600 13px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = Math.min(W - 70, Math.max(...lines.map((t) => g.measureText(t).width)) + 16), h = 20 * lines.length + 6;
      g.globalAlpha = 0.9; g.fillStyle = bg;
      g.beginPath(); g.rect(6, 6, w, h); g.fill();
      g.globalAlpha = 1; g.strokeStyle = A.f.color; g.lineWidth = 1; g.strokeRect(6.5, 6.5, w, h);
      g.fillStyle = css.getPropertyValue('--text').trim() || '#222';
      lines.forEach((t, i) => g.fillText(t, 14, 19 + 20 * i, w - 14));
    }
    g.restore();
  }
  // "Area = 4π ≈ 12.5664": a short text for the graph, from a result ("4π ≈ 12.56637061", "≈ 2.5",
  // "6"; approx: a number alone is not exact)
  function shortValue(name, result, approx) {
    const t = String(result).trim(), bare = t.replace(/^[=≈]\s*/, ''), v = Number(numberPart(bare)), ex = bare.split(' ≈ ')[0].split(' = ')[0].trim(); // "32/3 = 10 + 2/3 ≈ …": 32/3
    if (!isFinite(v)) return name + ' ' + clip(bare, 26);
    const num = (+v.toPrecision(6)).toLocaleString('en-US', { maximumSignificantDigits: 6 });
    if (bare.indexOf(' ≈ ') > 0) return name + (ex.length <= 12 ? ' = ' + ex : '') + ' ≈ ' + num;
    if (approx || t[0] === '≈') return name + ' ≈ ' + num;
    return name + ' = ' + (ex.length <= 14 ? ex : num);
  }
  function zoom(f, cx, cy) {
    if (!P.view) return;
    const v = P.view;
    const mx = cx !== undefined ? cx : (v.x0 + v.x1) / 2, my = cy !== undefined ? cy : (v.y0 + v.y1) / 2;
    const nv = { x0: mx + (v.x0 - mx) * f, x1: mx + (v.x1 - mx) * f, y0: my + (v.y0 - my) * f, y1: my + (v.y1 - my) * f };
    if (!viewOk(nv)) { toast(tr('Cannot zoom any further', 'これ以上は拡大・縮小できません'), 1400); return; }
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
    // an edge of the shaded area under the finger (within 22 px of its line), or ''
    let edge = '';
    const edgeAt = (cx) => {
      if (!P.area || !P.areaUI || P.areaUI.box.hidden) return '';
      const r = P.canvas.getBoundingClientRect(), v = P.view;
      const px = (x) => r.left + (x - v.x0) / (v.x1 - v.x0) * r.width;
      const da = Math.abs(cx - px(P.area.a)), db = Math.abs(cx - px(P.area.b));
      return Math.min(da, db) > 22 ? '' : (da <= db ? 'a' : 'b');
    };
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || !P.view) return;
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      if (!pts.size) edge = edgeAt(e.clientX);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { view: Object.assign({}, P.view), pts: new Map(Array.from(pts, ([k, p]) => [k, Object.assign({}, p)])) };
      moved = false;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = P.canvas.getBoundingClientRect(), v0 = start.view;
      const ids = Array.from(pts.keys());
      if (edge && ids.length === 1 && P.area) {
        // the edge follows the finger; the other edge stays, and the two never cross
        const A = P.area, x = toData(e.clientX, e.clientY).x, min = (v0.x1 - v0.x0) / r.width * 4;
        moved = true;
        if (edge === 'a') A.a = Math.min(x, A.b - min); else A.b = Math.max(x, A.a + min);
        A.text = A.lenText = '';
        areaEdgeMoved(edge, false);
        P.mark = null; P.tip.style.display = 'none';
        draw();
        return;
      }
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
      if (edge) {
        const k = edge;
        if (!pts.size) edge = '';
        if (moved && P.area) { start = null; areaEdgeMoved(k, true); return; }
      }
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
    P.tip.textContent = best.expr + tr(':  x = ', '：x = ') + Number(best.x.toPrecision(10)) + ', y = ' + Number(best.y.toPrecision(10));
    P.tip.style.display = 'block';
    draw();
  }

  // -------------------------------------------------- calculus in the 2D graph
  // For a function of the graph: draw its derivative or antiderivative, its tangent at x = a, and
  // mark its zeros and extrema (found in the drawn values, made precise by the engine).
  function buildCalc2d() {
    const f = el('select', { 'aria-label': tr('Function', '関数') });
    const at = el('input', { inputmode: 'text', autocapitalize: 'off', placeholder: 'a', 'aria-label': tr('x of the tangent', '接線の x') });
    const out = el('div', { class: 'area-cross' });
    const sel = () => P.series[Number(f.value)];
    const addLine = (expr) => {
      const lines = P.ta.value.split('\n').map((t) => t.trim()).filter(Boolean);
      if (lines.indexOf(expr) >= 0) return;
      if (lines.length >= 6) { toast(tr('Up to 6 functions', '関数は 6 つまでです'), 1800); return; }
      P.ta.value = lines.concat(expr).join('\n');
      P.keep = true;
      P.go.click();
    };
    const box = el('div', { class: 'area-box' },
      el('div', { class: 'plot-range calc-row' }, el('span', { text: tr('Function', '関数') }), f),
      el('div', { class: 'calc-btns' },
        tapButton({ class: 'btn', text: tr("Draw f′", 'f′（導関数）を描く') }, () => { const s1 = sel(); if (s1) addLine(`diff(${s1.expr})`); }),
        tapButton({ class: 'btn', text: tr('Draw ∫f', '∫f（原始関数）を描く') }, () => { const s1 = sel(); if (s1) addLine(`integrate(${s1.expr})`); }),
        tapButton({ class: 'btn', text: tr('Zeros and extrema', '零点・極値を表示') }, () => { const s1 = sel(); if (s1) markFeatures(s1, out); })),
      el('div', { class: 'plot-range' }, el('span', { text: tr('Tangent at x =', '接線 x =') }), at,
        tapButton({ class: 'btn primary', text: tr('Draw', '描く') }, async () => { const s1 = sel(); if (s1 && at.value.trim()) { const line = await drawTangent(s1, normalizeExpr(at.value)); if (line) addLine(line); } })),
      out);
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Calculus ▾', '微分・接線・極値 ▾') });
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) calcFunctionsChanged(); });
    P.calcUI = { f, out, box, toggle };
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  function calcFunctionsChanged() {
    const U = P.calcUI, keep = U.f.value;
    U.f.textContent = '';
    P.series.forEach((s1, i) => U.f.append(el('option', { value: String(i), text: clip(s1.expr, 34) })));
    U.f.value = keep !== '' && P.series[Number(keep)] ? keep : '0';
  }
  // the tangent of f at x = a: its line as an expression (to draw), the point marked, the equation shown
  async function drawTangent(f, a) {
    const y0 = await exactText(`(${f.expr}) where x = ${a}`), m = await exactText(`diff(${f.expr}, x, 1, ${a})`);
    if (!y0 || !m || /diff\(|where/.test(y0 + m)) { toast(tr('Could not find the tangent there', 'その点の接線を求められませんでした'), 2200); return ''; }
    const line = `(${m}) × (x − (${a})) + (${y0})`;
    const x = await numValue(a), y = await numValue(y0);
    const eq = await exactText(line);
    P.marks = (P.marks || []).filter((k) => !k.tangent);
    if (isFinite(x) && isFinite(y)) P.marks.push({ x, y, label: 'y = ' + (eq || line), tangent: true });
    // the simplified line (9x − 16) is drawn; it does not count for the y range of the view
    const drawn = eq && !/[=≈]/.test(eq) ? eq : line;
    (P.guides = P.guides || new Set()).add(normalizeExpr(drawn));
    draw();
    return drawn;
  }
  // zeros (f = 0) and extrema (f′ = 0 with a change of the slope) of f, marked and listed
  async function markFeatures(f, out) {
    out.textContent = tr('Calculating…', '計算中…');
    const zeros = await findCrossings(f, null);
    const ext = [];
    // secantsolve() does not work out diff() inside it: the derivative first, as an expression
    const df = await exactText(`diff(${f.expr})`);
    for (let k = 1; k + 1 < f.x.length && ext.length < 12; k++) {
      const a = f.y[k - 1], b = f.y[k], c = f.y[k + 1];
      if ([a, b, c].some((v) => v === null || !isFinite(v))) continue;
      const d0 = b - a, d1 = c - b;
      if ((d0 > 0 && d1 < 0) || (d0 < 0 && d1 > 0)) {
        const r = df && !/diff\(/.test(df) ? await Bridge.send('calc', { expr: `secantsolve(${df}, ${engineNum(f.x[k - 1])}, ${engineNum(f.x[k + 1])})`, opts: Object.assign(engineOpts(), { precision: 16, approx: 'approx', grouping: false }), timeout: 1500 }) : {};
        let x = r.ok && r.result ? Number(numberPart(r.result)) : NaN;
        if (!isFinite(x) || x < f.x[k - 1] - (f.x[k + 1] - f.x[k - 1]) || x > f.x[k + 1] + (f.x[k + 1] - f.x[k - 1])) x = f.x[k];
        ext.push({ x, max: d0 > 0 });
      }
    }
    P.marks = (P.marks || []).filter((k) => k.tangent);
    out.textContent = '';
    const nice = (v) => niceNumber(v) || short(v);
    const pair = (x, y) => '(' + nice(x) + ', ' + nice(y) + ')';
    for (const z of zeros) { P.marks.push({ x: z.x, y: 0, label: '' }); out.append(el('span', { class: 'area-chip', text: tr('zero x = ', '零点 x = ') + (z.text.length < 14 ? z.text : short(z.x)) })); }
    for (const e of ext) {
      const y = await numValue(`(${f.expr}) where x = ${engineNum(e.x)}`);
      const yy = isFinite(y) ? y : seriesY(f, e.x);
      P.marks.push({ x: e.x, y: yy, label: e.max ? tr('max', '極大') : tr('min', '極小') });
      out.append(el('span', { class: 'area-chip', text: (e.max ? tr('max ', '極大 ') : tr('min ', '極小 ')) + pair(e.x, yy) }));
    }
    if (!zeros.length && !ext.length) out.textContent = tr('No zeros or extrema in the drawn range', '描いた範囲に零点・極値はありません');
    draw();
  }

  // ------------------------- integrals for lengths, areas, volumes and surfaces (exact or numeric)
  // The engine is asked for the exact value first. When it cannot give one, the value is found
  // numerically with the double exponential (tanh-sinh) rule: x = m + h tanh(π/2 sinh t) and a sum
  // over even steps of t, which stays accurate with an infinite slope or 1/√ at the ends (the edge
  // of a circle or a sphere). The engine works out these sums with 40 to 50 digits.
  // The angle unit of the settings is kept, as for drawing the graph (sin(x) in degrees has its area
  // and length in degrees too); polar coordinates go round a full turn in that unit (2π, 360° or
  // 400 gradians) and are scaled to radians by 2π / (full turn).
  const iOpts = (more) => Object.assign(engineOpts(), { grouping: false }, more || {});
  const fullTurn = () => ({ deg: '360', gra: '400' })[S.angle] || '2π';
  // x and y of an expression replaced by other expressions; "2xy" (x times y) counts too
  function subXY(expr, xs, ys) {
    return absBars(expr).replace(/[\p{L}_][\p{L}\p{Nd}_]*/gu, (tok, off, str) => {
      if (str[off - 1] === '\\' || str[off - 1] === "'" || !/^[xy]+$/.test(tok)) return tok;
      return Array.from(tok, (c) => '(' + (c === 'x' ? xs : ys) + ')').join(' × ');
    });
  }
  // |x − 1| as the engine writes it, as abs(x − 1) (1.9.3): once a number is put in for x,
  // "2 |a| − b" can be read wrongly ("|" is also "or"); this kept the length of the heart from
  // being found. A bar after a number, a name or ")" closes the innermost one that is open.
  function absBars(t) {
    if (t.indexOf('|') < 0) return t;
    let out = '', depth = 0;
    for (const c of t) {
      if (c !== '|') { out += c; continue; }
      const prev = out.replace(/\s+$/, '').slice(-1);
      if (depth > 0 && /[\p{L}\p{N}_)\]}²³¹⁰⁴⁵⁶⁷⁸⁹!′°.]/u.test(prev)) { out += ')'; depth--; } else { out += 'abs('; depth++; }
    }
    return depth === 0 ? out : t;
  }
  // √(1 / (4 − x²)) as 1 / √(4 − x²): the engine integrates the second form exactly
  function recipSqrt(t) {
    t = absBars(t);
    for (let i = t.indexOf('√(1 / '), guard = 0; i >= 0 && guard < 20; i = t.indexOf('√(1 / '), guard++) {
      let d = 0, j = i + 1;
      for (; j < t.length; j++) { if (t[j] === '(') d++; else if (t[j] === ')' && --d === 0) break; }
      if (j >= t.length) break;
      t = t.slice(0, i) + '(1 / √(' + t.slice(i + 6, j) + '))' + t.slice(j + 1);
    }
    return t;
  }
  // an expression worked out, as text for the next step, or ''
  async function symText(expr) {
    const r = await Bridge.send('calc', { expr, opts: iOpts(), timeout: 4000 });
    if (!r.ok || !r.result || r.timeout || (r.messages || []).some((m) => m.type === 'error')) return '';
    const t = r.result.split(' ≈ ')[0].trim();
    return /integrate|∫|diff\(|=/.test(t) ? '' : t;
  }
  // exact values already looked for (1.8.2): drawing a surface again, or going back to a region,
  // shows them at once. Emptied when the user's definitions change (invalidateCatalogs); the
  // settings are part of the key. The oldest go when there are more than EXACT_CACHE_MAX.
  const exactCache = new Map(), EXACT_CACHE_MAX = 200;
  // the exact value of an integral: { text: "8π ≈ 25.13274123", v }, or null
  async function exactIntegral(expr, ms) {
    ms = ms || 6000;
    // the same expression with the same settings has the same answer: it is kept (exactCache), also
    // "none" when the time ran out, which is used again for a time limit that is not longer
    const key = JSON.stringify(iOpts()) + '\n' + expr;
    const kept = exactCache.get(key);
    if (kept && (kept.res || kept.ms >= ms)) { exactCache.delete(key); exactCache.set(key, kept); return kept.res; }
    const r = await Bridge.send('calc', { expr, opts: iOpts(), timeout: ms });
    let res = null;
    if (r.ok && r.result && !/∫|integrate/.test(r.result) && !(r.messages || []).some((m) => m.type === 'error' || /integrate|approximated/i.test(m.text))) {
      const v = Number(numberPart(r.result));
      if (isFinite(v)) res = { text: r.result, exact: r.result.split(' ≈ ')[0].trim(), v };
    }
    // (an engine that did not answer, after a restart or a lost request, is not remembered)
    if (r.ok || r.timeout) {
      exactCache.set(key, { res, ms: r.timeout ? ms : Infinity });
      if (exactCache.size > EXACT_CACHE_MAX) exactCache.delete(exactCache.keys().next().value);
    }
    return res;
  }
  // sums worked out by the engine with many digits (the ends of x = m + h tanh(…) come very close
  // to a and b, and 1 − tanh must not round to 0 there), several at once ("[s1, s2, …]"), or null
  async function sumVector(expr, digits) {
    const r = await Bridge.send('calc', { expr, opts: iOpts({ approx: 'approx', precision: digits }), timeout: Math.max(20000, timeLimit() * 1000) });
    if (!r.ok || !r.result || r.timeout || (r.messages || []).some((m) => m.type === 'error')) return null;
    const m = parseMatrix(numberPartVec(r.result));
    if (!m || !m.rows.length) return null;
    const v = (m.rows.length === 1 ? m.rows[0] : m.rows.map((x) => x[0])).map((x) => Number(String(x).replace(/−/g, '-').replace(/\s/g, '')));
    return v.every(isFinite) ? v : null;
  }
  // ∫ F dx from a to b, numerically: t from −4 to 4 in steps of 1/50. 1.9.3: the even and the odd
  // steps are summed apart (each is the rule with steps of 1/25: they agree when the rule is
  // accurate, and differ when the integrand is not smooth inside the range), and the terms at the
  // very ends (3.8 ≤ |t| ≤ 4) once more: they fade fast; when they do not, the integral is
  // infinite, as for the length of ln(x) from 0. { v, digits (the digits that can be trusted), inf }, or null
  async function tsIntegral(F, a, b) {
    const H = '(4/200)', hh = 4 / 200;
    const m = `(((${a}) + (${b})) / 2)`, h = `(((${b}) − (${a})) / 2)`;
    const G = (t) => `(${subXY(F, `${m} + ${h} × tanh(π/2 × sinh(${t}))`, 'y')}) × ${h} × π/2 × cosh(${t}) / cosh(π/2 × sinh(${t}))^2`;
    const ev = G(`(2\\k) × ${H}`), od = G(`(2\\k + 1) × ${H}`), any = G(`\\k × ${H}`);
    const r = await sumVector(`[sum(${ev}, −100, 100, \\k), sum(${od}, −100, 99, \\k), sum(${any}, 191, 200, \\k) + sum(${any}, −200, −191, \\k)]`, 50);
    let res = r && r.length === 3 ? tsResult(r, hh) : null;
    // a curve that bends sharply many times (the samples "Beats", "Chirp"): √(1 + f′²) is then
    // singular close to the real axis (where f′ = ±i, about 1/|f″| away), and the rule above is not
    // accurate: 1.9.2 showed 10 digits of which only 3 to 7 were right (Beats 27.39 for 27.50). The
    // range is then cut into 32 and 64, then 128 and 256 equal parts with the 15-point Kronrod rule
    // in each; the difference between the two counts of parts tells how many digits can be trusted.
    for (const [n1, n2] of [[32, 64], [128, 256]]) {
      if (!res || res.inf || res.digits >= 10) break;
      const more = await gkParts(F, a, b, n1, n2);
      if (more && more.digits > res.digits) res = more;
    }
    return res;
  }
  // the value and the digits that can be trusted, from the sums of the even and the odd steps and of
  // the terms at the very ends (step hh): the rule with the even steps alone differs by d
  function tsResult([E, O, T2], hh) {
    const v = (E + O) * hh;
    if (!isFinite(v)) return null;
    const scale = Math.max(Math.abs(v), 1e-300), tail = Math.abs(T2 * hh) / scale;
    if (tail > 1e-4) return { inf: true, v, digits: 0 };
    return { v, digits: trustedDigits(Math.max(Math.abs((O - E) * hh) / scale, tail)) };
  }
  const trustedDigits = (err) => (err <= 1e-11 ? 10 : Math.max(2, Math.min(10, Math.floor(-Math.log10(err)) - 1)));
  // the 15-point Gauss–Kronrod rule (nodes ±x and 0 on [−1, 1], with their weights)
  const GK_X = ['0.991455371120812639206854697526329', '0.949107912342758524526189684047851', '0.864864423359769072789712788640926', '0.741531185599394439863864773280788',
    '0.586087235467691130294144845693013', '0.405845151377397166906606412076961', '0.207784955007898467600689403773245'];
  const GK_W = ['0.022935322010529224963732008058970', '0.063092092629978553290700663189204', '0.104790010322250183839876322541518', '0.140653259715525918745189590510238',
    '0.169004726639267902826583426598550', '0.190350578064785409913256402421014', '0.204432940075298892414161999234649', '0.209482141084727828012999174891714'];
  // ∫ F from a to b with that rule on n1 and on n2 equal parts: { v (with n2), digits }, or null
  async function gkParts(F, a, b, n1, n2) {
    const rule = (n) => {
      const w = `(((${b}) − (${a})) / ${2 * n})`, mid = `((${a}) + (2\\p + 1) × ${w})`;
      const at = (u) => `(${subXY(F, `${mid} + ${w} × ${u}`, 'y')})`;
      const terms = GK_X.map((x, i) => `${GK_W[i]} × (${at(x)} + ${at('(−' + x + ')')})`).concat(`${GK_W[7]} × ${at('0')}`);
      return `sum(${terms.join(' + ')}, 0, ${n - 1}, \\p) × ${w}`;
    };
    const r = await sumVector(`[${rule(n1)}, ${rule(n2)}]`, 25);
    if (!r || r.length !== 2 || !r.every(isFinite)) return null;
    // (the finer one is much closer than the difference: about its power 1.5, as in QUADPACK)
    const scale = Math.max(Math.abs(r[1]), 1e-300);
    return { v: r[1], digits: trustedDigits(Math.pow(Math.abs(r[1] - r[0]) / scale, 1.5)) };
  }
  // ∬ F over the ring r0 ≤ √(x² + y²) ≤ r1 (the disk when r0 = 0), numerically: r by the rule above
  // (t from −3.2 to 3.2), θ in 36 even steps of a full turn (the integrand is periodic in θ; each
  // step is 2π/36 in radians)
  // 1.9.3: an integrand that is the same all around the origin (a sphere, the doughnut) needs one
  // angle only: 2π ∫ F(r, 0) r dr by the rule of tsIntegral, 36 times faster (the surface of the
  // doughnut took 28 s on a PC and could not be found). { v, digits }
  async function tsAnnulus(F, r0, r1) {
    if (await roundIntegrand(F, r0, r1)) {
      const r = await tsIntegral(`(${subXY(F, 'x', '0')}) × x`, r0, r1);
      return r && !r.inf ? { v: 2 * Math.PI * r.v, digits: r.digits } : { v: NaN, digits: 0 };
    }
    // (else 36 angles; also every other angle and every other step in r, to tell the digits that can
    // be trusted: |x y| has kinks where the angle crosses an axis, which 36 angles do not follow)
    const N = 64, M = 36, H = '(3.2/64)', w = `(((${r1}) − (${r0})) / 2)`;
    const g = (k, j) => {
      const t = `${k} × ${H}`, q = `${j} × ${fullTurn()}/${M}`, rr = `((${r0}) + ${w} × (1 + tanh(π/2 × sinh(${t}))))`;
      return `(${subXY(F, `${rr} × cos(${q})`, `${rr} × sin(${q})`)}) × ${rr} × ${w} × π/2 × cosh(${t}) / cosh(π/2 × sinh(${t}))^2`;
    };
    const r = await sumVector(`[sum(sum(${g('\\k', '\\j')}, −${N}, ${N}, \\k), 1, ${M}, \\j), sum(sum(${g('\\k', '(2\\j)')}, −${N}, ${N}, \\k), 1, ${M / 2}, \\j), sum(sum(${g('(2\\k)', '\\j')}, −${N / 2}, ${N / 2}, \\k), 1, ${M}, \\j)]`, 40);
    if (!r || r.length !== 3) return { v: NaN, digits: 0 };
    const hh = 3.2 / 64, v = r[0] * hh * 2 * Math.PI / M, vq = r[1] * hh * 2 * Math.PI / (M / 2), vr = r[2] * 2 * hh * 2 * Math.PI / M;
    const scale = Math.max(Math.abs(v), 1e-300);
    return { v, digits: trustedDigits(Math.max(Math.abs(v - vq) / 3, Math.abs(v - vr)) / scale) };
  }
  const tsDisk = (F, R) => tsAnnulus(F, '0', R);
  // true when F (in x and y) has the same value all around the origin, at two radii between r0 and r1
  async function roundIntegrand(F, r0, r1) {
    const vals = [];
    for (const f of ['0.31', '0.77']) {
      const r = `((${r0}) + ((${r1}) − (${r0})) × ${f})`;
      for (const k of [0, 1, 2, 3, 5, 8]) { const q = `(${k} × ${fullTurn()} / 13)`; vals.push(subXY(F, `${r} × cos(${q})`, `${r} × sin(${q})`)); }
    }
    const v = await sumVector('[' + vals.join(', ') + ']', 20);
    if (!v || v.length !== 12) return false;
    const same = (a) => a.every((x) => Math.abs(x - a[0]) <= 1e-12 * Math.max(1, Math.abs(a[0])));
    return same(v.slice(0, 6)) && same(v.slice(6));
  }
  // ∬ F over a rectangle, numerically: Simpson's rule on 101 × 101 points (points without a value left out).
  // 1.9.3: masks, the surfaces themselves: a point counts only where they have real values too
  async function simpsonRect(F, x0, x1, y0, y1, masks, smooth) {
    const exprs = [F].concat(masks || []);
    const r = await Bridge.send('plot3d', { exprs, xmin: x0, xmax: x1, ymin: y0, ymax: y1, nx: VOL_N, ny: VOL_N, opts: iOpts(), timeout: Math.max(15000, timeLimit() * 1000) });
    if (!r.ok || !Array.isArray(r.series) || r.series.length !== exprs.length || r.series.some((s) => s.complete === false)) return { v: NaN, missing: 0, error: r.error };
    const nx = r.x.length, ny = r.y.length, z = r.series[0].z;
    const hx = (r.x[nx - 1] - r.x[0]) / (nx - 1), hy = (r.y[ny - 1] - r.y[0]) / (ny - 1);
    const w = (i, n) => (i === 0 || i === n - 1 ? 1 : i % 2 ? 4 : 2);
    const real = (s, k) => typeof s.z[k] === 'number' && isFinite(s.z[k]);
    // 1.9.3: the same rule on every other point (51 × 51) too. The volume of a surface that changes
    // sign has a kink where it is 0 (abs(f)), and the rule is then good to 3 or 4 digits only (the
    // sample "Egg carton": 39.939589 for 39.943457, shown with 8 digits until 1.9.2); the
    // difference of the two tells how many digits can be trusted
    const coarse = nx % 4 === 1 && ny % 4 === 1, nx2 = (nx + 1) / 2, ny2 = (ny + 1) / 2;
    let sum = 0, sum2 = 0, missing = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, v = z[k];
      if (typeof v !== 'number' || !isFinite(v) || r.series.slice(1).some((s) => !real(s, k))) { missing++; continue; }
      sum += w(i, nx) * w(j, ny) * v;
      if (coarse && i % 2 === 0 && j % 2 === 0) sum2 += w(i / 2, nx2) * w(j / 2, ny2) * v;
    }
    const v = sum * hx * hy / 9, v2 = sum2 * hx * hy * 4 / 9, scale = Math.max(Math.abs(v), 1e-300);
    // (the error of the finer rule: about a fifteenth of the difference for a smooth integrand, a
    // third for a kink, all of it with points left out; checked on the samples against exact values)
    const err = Math.abs(v - v2) / scale / (missing ? 1 : smooth ? 15 : 3);
    const digits = !coarse ? 8 : err <= 1e-9 ? 8 : Math.max(2, Math.min(8, Math.round(-Math.log10(err))));
    return { v, missing, digits };
  }
  const fmtV = (v) => (+(+v).toPrecision(10)).toLocaleString('en-US', { maximumSignificantDigits: 10 });
  // the exact value when it agrees with the numeric one, else the numeric one: { text, exact, v }
  function bestValue(ex, num, digits) {
    if (ex && (!isFinite(num) || Math.abs(ex.v - num) <= 1e-5 * Math.max(1, Math.abs(num)))) return ex;
    return isFinite(num) ? { text: '≈ ' + fmtV(+num.toPrecision(digits || 10)), exact: '', v: num, digits: digits || 10 } : null;
  }
  // a sum of parts: exact when all parts are
  async function sumValues(parts) {
    const v = parts.reduce((t, p) => t + p.v, 0);
    if (parts.length > 1 && parts.every((p) => p.exact)) {
      const r = await exactIntegral(parts.map((p) => '(' + p.exact + ')').join(' + '), 3000);
      if (r && Math.abs(r.v - v) <= 1e-6 * Math.max(1, Math.abs(v))) return r;
    }
    const digits = Math.min(...parts.map((p) => p.digits || 10));
    return parts.length === 1 ? parts[0] : { text: '≈ ' + fmtV(+v.toPrecision(digits)), exact: '', v, digits };
  }
  const shownValue = (val) => (val.text.indexOf('≈ ') === 0 ? val.text : '= ' + val.text);

  // ------------------------- only where the functions have real values (1.9.3)
  // A range (2D) or a region (3D) can reach where a function has no real value: √(4 − x²) beyond
  // ±2, ln(x) below 0. Until 1.9.2 the engine then integrated complex numbers there: abs() made
  // them a wrong size (the area of the sample "Circle" from −2.6 to 2.6 was 12.83, not 4π), and
  // the length could not be found. Whether a value is real is told by the functions themselves,
  // not by the integrand (abs(f − g) and √(1 + f′²) can be real where f is not). The engine samples
  // them (its sampler finds the edge of the real values to about the precision of a double); a run
  // of values that are not real cuts the range, a pole (1/x at 0) does not: the imaginary part in
  // the middle of the run tells them apart. Each edge is narrowed down to about 13 digits and taken
  // exactly when a simple number lies there (2, 0, 3/2, π/2, √5).

  // the simplest number in [lo, hi] (0, an integer, p/q, a multiple of π or of a square root): { v, text }, or null
  function simpleIn(lo, hi) {
    if (!(lo <= hi) || hi - lo > 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))) return null;
    const mid = (lo + hi) / 2, inside = (v) => v >= lo && v <= hi;
    const sign = (v) => (v < 0 ? '−' : '');
    if (inside(0)) return { v: 0, text: '0' };
    for (let q = 1; q <= 12; q++) {
      const p = Math.round(mid * q);
      if (p && Math.abs(p) <= 1e6 && inside(p / q)) return { v: p / q, text: sign(p) + Math.abs(p) + (q === 1 ? '' : '/' + q) };
    }
    for (let q = 1; q <= 12; q++) {
      const p = Math.round(mid * q / Math.PI);
      if (p && Math.abs(p) <= 1000 && inside(p * Math.PI / q)) return { v: p * Math.PI / q, text: sign(p) + (Math.abs(p) === 1 ? '' : Math.abs(p)) + 'π' + (q === 1 ? '' : '/' + q) };
    }
    for (let n = 2; n <= 99; n++) {
      if (Number.isInteger(Math.sqrt(n))) continue;
      for (let q = 1; q <= 4; q++) {
        const p = Math.round(mid * q / Math.sqrt(n));
        if (p && Math.abs(p) <= 20 && inside(p * Math.sqrt(n) / q)) return { v: p * Math.sqrt(n) / q, text: sign(p) + (Math.abs(p) === 1 ? '' : Math.abs(p)) + '√(' + n + ')' + (q === 1 ? '' : '/' + q) };
      }
    }
    return null;
  }
  // the values of the functions es (in x) sampled by the engine on a..b: for each, [[x, real?]], or null
  async function realSamples(es, a, b, steps) {
    const r = await Bridge.send('plot', { exprs: es, min: String(a), max: String(b), steps: steps || 400, var: 'x', opts: iOpts({ complex: 'rect' }), timeout: 8000 });
    if (!r.ok || !Array.isArray(r.series) || r.series.length !== es.length) return null;
    return r.series.map((s) => s.x.map((x, i) => [x, s.y[i] !== null && s.y[i] !== undefined]));
  }
  // true when e (in x) has a value with an imaginary part at x = t; false at a pole (1/x at 0, ln(x) at 0)
  async function nonRealAt(e, t) {
    const r = await Bridge.send('calc', { expr: `im(${subXY(e, '(' + t + ')', 'y')})`, opts: iOpts({ approx: 'approx', precision: 12, complex: 'rect' }), timeout: 1500 });
    const v = r.ok && r.result && !(r.messages || []).some((m) => m.type === 'error') ? Number(numberPart(r.result)) : NaN;
    return isFinite(v) && Math.abs(v) > 1e-9;
  }
  // where e stops having real values, between xn (not real) and xr (real): { v, text } (the text
  // is exact when a simple number lies there, else the number on the real side)
  async function realEdge(e, xn, xr) {
    for (let round = 0; round < 10; round++) {
      if (Math.abs(xr - xn) <= 1e-13 * Math.max(1, Math.abs(xr))) break;
      const s = await realSamples([e], engineNum(Math.min(xn, xr)), engineNum(Math.max(xn, xr)), 40);
      if (!s) break;
      const pts = s[0];
      let k = -1;
      if (xn < xr) { for (let i = 0; i < pts.length; i++) if (!pts[i][1]) k = i; } // the last point that is not real
      else { for (let i = pts.length - 1; i >= 0; i--) if (!pts[i][1]) k = i; } // the first one
      const j = xn < xr ? k + 1 : k - 1;
      if (k < 0 || j < 0 || j >= pts.length || !pts[j][1]) break;
      if (pts[k][0] === xn && pts[j][0] === xr) break; // no closer
      xn = pts[k][0]; xr = pts[j][0];
    }
    return simpleIn(Math.min(xn, xr), Math.max(xn, xr)) || { v: xr, text: engineNum(xr) };
  }
  // the parts of lo..hi (texts a, b) where e is real, from its samples pts: [{ lo, hi, a, b }].
  // exact: the edges are narrowed down and made exact (else they are those of the samples, and a
  // run of one point counts as a pole without asking the engine)
  async function realIntervals(e, pts, lo, hi, a, b, exact) {
    const runs = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i][1]) continue;
      let j = i;
      while (j + 1 < pts.length && !pts[j + 1][1]) j++;
      runs.push([i, j]);
      i = j;
    }
    if (!runs.length) return [{ lo, hi, a, b }];
    const cuts = [];
    for (const [i, j] of runs.slice(0, 16)) {
      if (exact ? await nonRealAt(e, engineNum(pts[(i + j) >> 1][0])) : j > i || i === 0 || j === pts.length - 1) cuts.push([i, j]);
    }
    for (const r of runs.slice(16)) cuts.push(r);
    const edge = async (n, k) => (exact ? realEdge(e, pts[n][0], pts[k][0]) : { v: pts[k][0], text: engineNum(pts[k][0]) });
    const out = [];
    let start = { v: lo, text: a };
    for (const [i, j] of cuts) {
      if (i > 0 && start) { const end = await edge(i, i - 1); out.push({ lo: start.v, hi: end.v, a: start.text, b: end.text }); }
      start = j + 1 < pts.length ? await edge(j, j + 1) : null;
    }
    if (start) out.push({ lo: start.v, hi, a: start.text, b });
    return out.filter((p) => p.hi > p.lo);
  }
  // the parts that two lists of parts have in common
  function intersectParts(A, B) {
    const out = [];
    for (const p of A) for (const q of B) {
      const lo = Math.max(p.lo, q.lo), hi = Math.min(p.hi, q.hi);
      if (hi > lo) out.push({ lo, hi, a: p.lo >= q.lo ? p.a : q.a, b: p.hi <= q.hi ? p.b : q.b });
    }
    return out.sort((x, y) => x.lo - y.lo);
  }
  // the parts of the range a..b (lo < hi as numbers) where all the functions es are real:
  // { parts, clipped } (no parts: no real value at all), or null when it cannot be told
  // (kept for the same functions and range: the area, the length and the range to start with ask alike)
  const realPartsCache = new Map();
  async function realParts(es, a, b, lo, hi) {
    const key = JSON.stringify([es, a, b, iOpts()]);
    if (realPartsCache.has(key)) return realPartsCache.get(key);
    const s = await realSamples(es, a, b, 400);
    if (!s) return null;
    let parts = [{ lo, hi, a, b }];
    for (let i = 0; i < es.length; i++) parts = intersectParts(parts, await realIntervals(es[i], s[i], lo, hi, a, b, true));
    const res = { parts, clipped: !(parts.length === 1 && parts[0].lo === lo && parts[0].hi === hi) };
    realPartsCache.set(key, res);
    if (realPartsCache.size > 50) realPartsCache.delete(realPartsCache.keys().next().value);
    return res;
  }
  // the range a..b as numbers, smaller first, with the texts in the same order: { lo, hi, a, b }, or null
  async function rangeNums(a, b) {
    const lim = await Bridge.send('calc', { expr: `[${a}, ${b}]`, opts: Object.assign(engineOpts(), { approx: 'approx', precision: 15, grouping: false }), timeout: 1500 });
    const nums = lim.ok && lim.result ? (parseMatrix(numberPartVec(lim.result)) || { rows: [[]] }).rows[0].map((x) => Number(x.replace(/−/g, '-'))) : [];
    if (nums.length !== 2 || !nums.every(isFinite) || nums[0] === nums[1]) return null;
    return nums[0] < nums[1] ? { lo: nums[0], hi: nums[1], a, b } : { lo: nums[1], hi: nums[0], a: b, b: a };
  }
  // "x from −2 to 2", "x from 0 to 2.5 and from 3 to 4" for a note
  const partsText = (parts) => parts.slice(0, 3).map((p) => p.a + tr(' to ', ' 〜 ', ' a ') + p.b).join(tr(' and ', '、', ' y ')) + (parts.length > 3 ? '…' : '');
  const realNote = (two, parts) => tr((two ? 'Only where both functions have real values: x from ' : 'Only where the function has real values: x from ') + partsText(parts),
    (two ? '2 つの関数に実数の値がある x = ' : '関数に実数の値がある x = ') + partsText(parts) + ' の部分だけで計算しました',
    (two ? 'Solo donde ambas funciones tienen valores reales: x de ' : 'Solo donde la función tiene valores reales: x de ') + partsText(parts));
  const noRealText = () => tr('There are no real values between a and b', 'a と b の間に実数の値がありません', 'No hay valores reales entre a y b');
  const infiniteText = () => tr('The length is infinite in this range (the curve goes to infinity)', 'この範囲では長さが無限大です（曲線が無限に伸びています）', 'La longitud es infinita en este rango (la curva va al infinito)');

  // an expression worked out, with the points the engine names as "x != …" in its warnings (where
  // it divides by zero: the ends of a circle, the corner of the heart at 0): { text, points }, or null
  // (worked out exactly: with the setting "auto" the derivative of the heart's lower half came with
  // 10-digit decimals, 1 − 0.7071067812 × √(|x|), which is not real a little before x = 2)
  async function symInfo(expr) {
    let r = await Bridge.send('calc', { expr, opts: iOpts({ approx: 'exact' }), timeout: 4000 });
    const bad = (q) => !q.ok || !q.result || q.timeout || (q.messages || []).some((m) => m.type === 'error');
    if (bad(r)) r = await Bridge.send('calc', { expr, opts: iOpts(), timeout: 4000 });
    if (bad(r)) return null;
    const text = r.result.split(' ≈ ')[0].trim();
    if (/integrate|∫|diff\(|=/.test(text)) return null;
    const points = [];
    for (const m of r.messages || []) {
      const k = /must be true:\s*(.*?)\.?\s*$/.exec(m.text || '');
      if (k) for (const c of k[1].split(' and ')) { const q = /^x\s*(?:!=|≠)\s*(.+)$/.exec(c.trim()); if (q) points.push(q[1].trim()); }
    }
    return { text, points };
  }
  // the length of the curve of f from a to b: ∫ √(1 + f′²) dx. 1.9.3: cut at the points inside the
  // range where √(1 + f′²) is infinite (the rule needs a smooth integrand inside: the heart has a
  // corner at x = 0); { inf: true } when the length is infinite
  async function curveLength(f, a, b, lo, hi) {
    const s = await symInfo(`√(1 + (diff(${f}, x))^2)`);
    if (!s) return null;
    const L = recipSqrt(s.text);
    const cuts = [];
    if (isFinite(lo) && isFinite(hi)) {
      for (const p of new Set(s.points)) {
        const v = await numValue(p);
        if (!(v > lo + (hi - lo) * 1e-12 && v < hi - (hi - lo) * 1e-12) || cuts.some((c) => Math.abs(c.v - v) < 1e-12 * Math.max(1, Math.abs(v)))) continue;
        cuts.push({ v, text: /^[−-]?\d+(\.\d+)?$/.test(p) ? (niceNumber(v) || p) : p });
      }
      cuts.sort((x, y) => x.v - y.v);
    }
    const bounds = [a].concat(cuts.map((c) => c.text), [b]), pieces = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const num = await tsIntegral(L, bounds[i], bounds[i + 1]);
      if (num && num.inf) return { inf: true };
      const ex = await exactIntegral(`integrate(${L}, ${bounds[i]}, ${bounds[i + 1]})`, cuts.length ? 3000 : 6000);
      const val = bestValue(ex, num ? num.v : NaN, num ? num.digits : 10);
      if (!val) return null;
      pieces.push(val);
    }
    return sumValues(pieces);
  }
  // 2D: the length of the curve, or the perimeter of the region between two functions (both curves
  // and the vertical sides at a and b, which are 0 when the curves meet there, as for a circle).
  // 1.9.3: only where the functions have real values (on each such part of the range)
  async function computeLength() {
    const U = P.areaUI, f = P.series[Number(U.f1.value)];
    if (!f) return;
    const a = normalizeExpr(U.a.value), b = normalizeExpr(U.b.value);
    if (!a || !b) { U.len.textContent = tr('Enter the range of x (a and b)', 'x の範囲（a と b）を入れてください'); return; }
    const g = areaG();
    U.len.textContent = tr('Calculating…', '計算中…');
    const fail = (text) => { U.len.textContent = text || tr('Could not calculate the length', '長さを計算できませんでした'); };
    const rn = await rangeNums(a, b);
    let parts = [{ a, b, lo: NaN, hi: NaN }], clipped = false;
    if (rn) {
      parts = [rn];
      const rp = await realParts(g ? [f.expr, g.expr] : [f.expr], rn.a, rn.b, rn.lo, rn.hi);
      if (rp && !rp.parts.length) return fail(noRealText());
      if (rp) { parts = rp.parts; clipped = rp.clipped; }
    }
    const lfs = [], lgs = [], sides = [];
    for (const p of parts) {
      const lf = await curveLength(f.expr, p.a, p.b, p.lo, p.hi);
      if (!lf || lf.inf) return fail(lf && infiniteText());
      lfs.push(lf);
      if (!g) continue;
      const lg = await curveLength(g.expr, p.a, p.b, p.lo, p.hi);
      if (!lg || lg.inf) return fail(lg && infiniteText());
      lgs.push(lg);
      for (const x of [p.a, p.b]) {
        const e = subXY(`abs((${f.expr}) − (${g.expr}))`, '(' + x + ')', 'y');
        const n = await numValue(e);
        if (!isFinite(n)) {
          const t = await Bridge.send('calc', { expr: e, opts: iOpts({ approx: 'approx', precision: 12 }), timeout: 1500 });
          if (t.ok && /∞/.test(t.result || '')) return fail(infiniteText());
          return fail();
        }
        const side = bestValue(await exactIntegral(e, 3000), n);
        if (side && Math.abs(side.v) > 1e-12) sides.push(side);
      }
    }
    const lf = await sumValues(lfs);
    const onGraph = (name, val) => { U.lenShown = true; if (P.area) { P.area.lenText = shortValue(name, val.text); draw(); } };
    const note = () => { if (clipped) U.len.append(el('div', { class: 'form-hint', text: realNote(!!g, parts) })); };
    if (!g) { U.len.textContent = ''; showResult(U.len, tr('Length of the curve ', '曲線の長さ ') + shownValue(lf)); note(); onGraph(tr('Length', '長さ'), lf); return; }
    const lg = await sumValues(lgs);
    const total = await sumValues(lfs.concat(lgs, sides));
    U.len.textContent = '';
    showResult(U.len, tr('Perimeter ', '周の長さ ') + shownValue(total));
    onGraph(tr('Perimeter', '周の長さ'), total);
    U.len.append(el('div', { class: 'form-hint', text: tr('Curves: ', '曲線：') + shownValue(lf).replace(/^= /, '') + ' + ' + shownValue(lg).replace(/^= /, '') +
      (sides.length ? tr(', with the vertical sides at a and b', '、a と b の縦の辺を含む') : '') }));
    note();
  }

  // ------------------------------------------------------ area (2D graph)
  // The area between a function and the x axis, or between two functions, from a to b:
  // integrate(abs(f − g), a, b) by the engine (exact when it can be), shaded in the graph. The
  // crossing points are found in the drawn values and made exact with solve() or precise with
  // secantsolve(); tapping one of the ranges between them puts it into a and b.
  function buildArea2d() {
    const f1 = el('select', { 'aria-label': tr('Function', '関数') }), f2 = el('select', { 'aria-label': tr('and', 'と') });
    const a = el('input', { inputmode: 'text', autocapitalize: 'off', placeholder: 'a', 'aria-label': tr('from x =', 'x の始め') });
    const b = el('input', { inputmode: 'text', autocapitalize: 'off', placeholder: 'b', 'aria-label': tr('to x =', 'x の終わり') });
    const cross = el('div', { class: 'area-cross' });
    const out = el('div', { class: 'area-out', 'aria-live': 'polite' });
    const ins = el('button', { class: 'btn', text: tr('Put into the input field', '式を入力欄に入れる'), hidden: true });
    const go = el('button', { class: 'btn primary', text: tr('Area', '面積') });
    const lenBtn = tapButton({ class: 'btn', text: tr('Length', '長さ・周') }, () => computeLength());
    const len = el('div', { class: 'area-out', 'aria-live': 'polite' });
    const box = el('div', { class: 'area-box' },
      el('div', { class: 'plot-range' }, f1, el('span', { text: tr('and', 'と') }), f2, el('span', { text: tr('', 'の間') })),
      el('div', { class: 'plot-range' }, el('span', { text: tr('x:', 'x：') }), a, el('span', { text: tr('to', '〜') }), b, go, lenBtn),
      cross, out, ins, len,
      el('div', { class: 'form-hint', text: tr('The area is shaded in the graph. Drag one of its two edges (↔) to change the range, or tap a range between crossing points. Parts below the x axis (or below the other function) count as positive. "Length" gives the length of the curve, or the perimeter of the region between two functions.', '面積を求める部分はグラフに色が付きます。両端の ↔ をドラッグすると範囲を変えられ、交点の間の範囲はタップでも選べます。x 軸（またはもう一方の関数）より下の部分もプラスとして数えます。「長さ・周」は曲線の長さ（2 つの関数の間なら囲まれた部分の周の長さ）です。') }),
      buildShapes2d(),
      tapButton({ class: 'btn geo-link', text: tr('More shapes: rectangle, triangle, cylinder… ›', 'ほかの図形（長方形・三角形・円柱など）›') }, () => openShapes()));
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Area and length ▾', '面積・長さ ▾') });
    // opened: the area between the first function and the x axis (or the second function) is shown at once
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) { P.areaUI.auto = true; areaFunctionsChanged(); } else { P.area = null; draw(); } });
    f1.addEventListener('change', () => { P.areaUI.auto = true; areaPairChanged(); });
    f2.addEventListener('change', () => { P.areaUI.auto = true; areaPairChanged(); });
    go.addEventListener('click', () => computeArea());
    ins.addEventListener('click', () => { if (P.areaExpr) useExample(P.areaExpr); });
    P.areaUI = { f1, f2, a, b, cross, out, ins, box, len };
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  // shapes to draw and measure: a circle (radius r), an ellipse (half axes a and b)
  const PARAM_NAMES = { r: tr('radius r', '半径 r'), a: tr('half axis a (x)', 'x 方向の半径 a'), b: tr('half axis b (y)', 'y 方向の半径 b') };
  const SHAPES2D = [['circle', tr('Circle', '円'), ['r'], ['2']], ['ellipse', tr('Ellipse', '楕円'), ['a', 'b'], ['3', '2']]];
  function buildShapes(defs, run) {
    const sel = el('select', { 'aria-label': tr('Shape', '図形') });
    for (const [k, t] of defs) sel.append(el('option', { value: k, text: t }));
    const params = el('span', { class: 'shape-params' });
    const inputs = {};
    const build = () => {
      params.textContent = '';
      const d = defs.find((x) => x[0] === sel.value);
      d[2].forEach((n, i) => {
        inputs[n] = inputs[n] || el('input', { inputmode: 'text', autocapitalize: 'off', value: d[3][i] });
        inputs[n].setAttribute('aria-label', d[1] + ' ' + (PARAM_NAMES[n] || n));
        params.append(el('span', { text: n + ' =' }), inputs[n]);
      });
    };
    sel.addEventListener('change', build);
    build();
    const go = tapButton({ class: 'btn', text: tr('Draw', '描く') }, () => {
      const d = defs.find((x) => x[0] === sel.value);
      const v = {};
      for (const n of d[2]) v[n] = normalizeExpr(inputs[n].value);
      if (d[2].some((n) => !v[n])) { toast(tr('Enter the sizes', '大きさを入れてください'), 1800); return; }
      run(sel.value, v);
    });
    return el('div', { class: 'plot-range shapes' }, el('span', { text: tr('Example', '図形の例') }), sel, params, go);
  }
  function buildShapes2d() { return buildShapes(SHAPES2D, drawShape2d); }
  // a circle (v.r) or an ellipse (v.a, v.b) in the 2D graph, with its area and perimeter:
  // the upper and the lower half as two functions; area and perimeter between them
  async function drawShape2d(k, v) {
    const sq = async (t) => (await symText(`(${t})^2`)) || `(${t})^2`;
    let top, w;
    if (k === 'circle') { top = `√(${await sq(v.r)} − x^2)`; w = v.r; }
    else { top = `${/^[\d.]+$/.test(v.b) ? v.b : '(' + v.b + ')'} √(1 − x^2 / ${await sq(v.a)})`; w = v.a; }
    const n = await numValue(w);
    if (!(n > 0)) { toast(tr('The size must be a positive number', '大きさは正の数にしてください'), 2000); return; }
    const neg = /^[\d.]+$/.test(w) ? '−' + w : `−(${w})`;
    openPlotWith([top, '−' + top], { range: [r6(-n * 1.3), r6(n * 1.3)], equal: true, area: { a: neg, b: w, between: true, length: true } });
  }
  // the functions of the graph were drawn again: the lists of functions follow them
  function areaFunctionsChanged() {
    const U = P.areaUI, keep1 = U.f1.value, keep2 = U.f2.value;
    U.f1.textContent = ''; U.f2.textContent = '';
    P.series.forEach((s, i) => {
      U.f1.append(el('option', { value: String(i), text: clip(s.expr, 30) }));
      U.f2.append(el('option', { value: String(i), text: clip(s.expr, 30) }));
    });
    U.f2.prepend(el('option', { value: 'axis', text: tr('the x axis', 'x 軸') }));
    // the same choice as before while the number of functions stays the same; else the first
    // function and the second one (or the x axis)
    const same = U.count === P.series.length;
    U.count = P.series.length;
    const ok = (k) => k !== '' && !!P.series[Number(k)];
    U.f1.value = same && ok(keep1) ? keep1 : '0';
    U.f2.value = same && (keep2 === 'axis' || ok(keep2)) ? keep2 : (P.series.length > 1 ? '1' : 'axis');
    if (U.f2.value === U.f1.value) U.f2.value = 'axis';
    if (!U.box.hidden) areaPairChanged();
  }
  const areaG = () => (P.areaUI.f2.value === 'axis' ? null : P.series[Number(P.areaUI.f2.value)]);
  const areaGExpr = () => { const g = areaG(); return g ? g.expr : '0'; };
  // the crossing points of the two functions in the drawn values, then exact or precise ones
  async function areaPairChanged() {
    const U = P.areaUI, f = P.series[Number(U.f1.value)], g = areaG();
    const auto = U.auto;
    U.auto = false;
    // a newer call (another graph, another pair, an example) makes this one stop before it writes
    // a and b, whatever order the engine answers in (1.8.2)
    const seq = U.pairSeq = (U.pairSeq || 0) + 1;
    P.area = null; U.out.textContent = ''; U.ins.hidden = true; U.len.textContent = ''; U.lenShown = false;
    U.cross.textContent = '';
    draw();
    if (!f) return;
    const pts = await findCrossings(f, g);
    if (seq !== U.pairSeq || U.f1.value !== String(P.series.indexOf(f))) return; // changed in the meantime
    // 1.9.3: the part of the range on the screen where the functions have real values. Where both
    // stop together at the same height (the two halves of a circle at ±2), the curves meet without
    // crossing: that point is a crossing point too, and the range to start with is the part with
    // real values (until 1.9.2 it was the whole range on the screen: −2.6 to 2.6 for the circle)
    let real = null, view = null;
    if (P.dataX) {
      // the part of the graph on the screen (the values reach further than the screen after moving it)
      const v = P.view || {}, lo = Math.max(P.dataX[0], isFinite(v.x0) ? v.x0 : -Infinity), hi = Math.min(P.dataX[1], isFinite(v.x1) ? v.x1 : Infinity);
      view = { lo: +lo.toPrecision(6), hi: +hi.toPrecision(6) };
      if (view.hi > view.lo) real = await realParts(g ? [f.expr, g.expr] : [f.expr], engineNum(view.lo), engineNum(view.hi), view.lo, view.hi);
      if (seq !== U.pairSeq || U.f1.value !== String(P.series.indexOf(f))) return;
      if (real && real.clipped) {
        const span = P.view ? Math.abs(P.view.y1 - P.view.y0) : 1;
        for (const p of real.parts) for (const [x, t] of [[p.lo, p.a], [p.hi, p.b]]) {
          if (x <= view.lo || x >= view.hi || pts.some((c) => Math.abs(c.x - x) < 1e-9 * Math.max(1, Math.abs(x)))) continue;
          const dv = await numValue(subXY(`abs((${f.expr}) − (${g ? g.expr : '0'}))`, '(' + t + ')', 'y'));
          if (isFinite(dv) && dv <= 1e-9 * Math.max(1, span)) pts.push({ x, text: t });
        }
        pts.sort((p, q) => p.x - q.x);
        if (seq !== U.pairSeq || U.f1.value !== String(P.series.indexOf(f))) return;
      }
    }
    P.areaCross = pts;
    if (pts.length) {
      U.cross.append(el('span', { class: 'area-lbl', text: tr('Crossing points: ', '交点：') + pts.map((p) => short(p.x)).join(', ') }));
      const range = (i, j) => {
        const c = tapButton({ class: 'area-chip', text: short(pts[i].x) + ' 〜 ' + short(pts[j].x) }, () => { U.a.value = pts[i].text; U.b.value = pts[j].text; computeArea(); });
        U.cross.append(c);
      };
      for (let i = 0; i + 1 < pts.length && i < 6; i++) range(i, i + 1);
      if (pts.length > 2) range(0, pts.length - 1);
    }
    // the range to start with: from the first to the last crossing point, else the part of the
    // drawn range where the functions have real values
    if (pts.length >= 2) { U.a.value = pts[0].text; U.b.value = pts[pts.length - 1].text; }
    else if (real && real.clipped && real.parts.length) { U.a.value = real.parts[0].a; U.b.value = real.parts[real.parts.length - 1].b; }
    else if (view) { U.a.value = String(view.lo); U.b.value = String(view.hi); }
    if (auto) await computeArea(true);
  }
  // An edge of the shaded area was dragged (setupPlotGestures): a or b follows it. When the finger
  // lifts, the edge snaps to a crossing point close by (its exact value) or to a round number, and
  // the area (and the length, if it was shown) is calculated again.
  function areaEdgeMoved(k, done) {
    const U = P.areaUI, A = P.area, v = P.view, px = (v.x1 - v.x0) / (P.canvas.clientWidth || 1);
    let x = A[k], text;
    const near = (P.areaCross || []).find((c) => Math.abs(c.x - x) < px * 12);
    if (near) { x = near.x; text = near.text; }
    else {
      const q = Math.pow(10, Math.floor(Math.log10(px * 6))); // a round step of a few pixels
      x = +(Math.round(x / q) * q).toPrecision(10);
      text = String(x);
    }
    U[k].value = text;
    if (!done) return;
    A[k] = x;
    const again = !!U.lenShown;
    computeArea().then(() => { if (again) computeLength(); });
  }
  // Where f and g (or the x axis) cross, in the drawn values, made exact with solve() or precise
  // with secantsolve(): [{ x, text }] (text is the exact value when there is one)
  async function findCrossings(f, g) {
    // the functions are sampled at different points: g is read at the points of f
    const gy = (k) => seriesY(g, f.x[k]);
    const found = [];
    for (let k = 1; k < f.x.length; k++) {
      const d0 = f.y[k - 1] - gy(k - 1), d1 = f.y[k] - gy(k);
      if (!isFinite(d0) || !isFinite(d1) || f.y[k] === null || f.y[k - 1] === null) continue;
      if (d0 === 0 || (d0 < 0) !== (d1 < 0)) {
        // not across a pole (tan(x)): the values on both sides stay moderate
        const span = P.view ? (P.view.y1 - P.view.y0) : 1;
        if (Math.abs(d0 - d1) > span * 2) continue;
        found.push({ lo: f.x[k - 1], hi: f.x[k], x: d0 === 0 ? f.x[k - 1] : f.x[k - 1] + (f.x[k] - f.x[k - 1]) * d0 / (d0 - d1) });
        if (found.length > 12) break;
      }
    }
    const pts = found.filter((p, i) => i === 0 || p.x - found[i - 1].x > 1e-9);
    const fe = f.expr, ge = g ? g.expr : '0';
    // exact crossing points when the engine can solve the equation
    let exact = [];
    const rs = await Bridge.send('calc', { expr: `solve((${fe}) = (${ge}))`, opts: Object.assign(engineOpts(), { precision: 15, grouping: false }), timeout: 1500 });
    if (rs.ok && rs.result && !/solve\(/.test(rs.result)) exact = splitRoots(rs.result);
    for (const p of pts) {
      const e = exact.find((r) => Math.abs(r.v - p.x) < Math.max(1e-6, Math.abs(p.x) * 1e-6) || (Math.abs(r.v - p.x) < (p.hi - p.lo)));
      if (e) { p.text = e.text; p.x = e.v; continue; }
      const r = await Bridge.send('calc', { expr: `secantsolve((${fe}) − (${ge}), ${engineNum(p.lo)}, ${engineNum(p.hi)})`, opts: Object.assign(engineOpts(), { precision: 16, approx: 'approx', grouping: false }), timeout: 1500 });
      const v = r.ok && r.result ? Number(numberPart(r.result)) : NaN;
      p.x = isFinite(v) ? v : p.x;
      // 10 digits read well in the boxes for a and b (the area hardly changes: f − g is 0 there)
      p.text = niceNumber(p.x) || String(+p.x.toPrecision(10));
    }
    return pts;
  }
  // a precise number that is a simple fraction or a simple multiple of π (3.14159265358979 -> π,
  // 4.71238898038469 -> 3π/2, 0.25 -> 1/4), as exact text, or ''
  function niceNumber(v) {
    const tol = 1e-10 * Math.max(1, Math.abs(v));
    if (Math.abs(v) < 1e-13) return '0';
    const sign = v < 0 ? '−' : '';
    for (let q = 1; q <= 12; q++) {
      const p = Math.round(Math.abs(v) * q);
      if (p && p <= 1000 && Math.abs(Math.abs(v) - p / q) < tol) return sign + (q === 1 ? String(p) : p + '/' + q);
    }
    for (let q = 1; q <= 12; q++) {
      const p = Math.round(Math.abs(v) * q / Math.PI);
      if (p && p <= 100 && Math.abs(Math.abs(v) - p * Math.PI / q) < tol) return sign + (p === 1 ? '' : p) + 'π' + (q === 1 ? '' : '/' + q);
    }
    return '';
  }
  const short = (v) => String(+(+v).toPrecision(5));
  // "≈ 0.7390851332", "= 1" … -> the number
  function numberPart(t) {
    const m = String(t).split('≈').pop().split('=').pop().trim().replace(/−/g, '-').replace(/\s/g, '');
    return m;
  }
  // the roots in a result of solve(): "[1  0]", "[((√(5) + 5) / 2)  (5/2 − √(5) / 2)] ≈ [3.61…  1.38…]", "2"
  function splitRoots(t) {
    const parts = t.split(' ≈ ');
    const exactPart = parts[0].split(' = ')[0], approxPart = parts[parts.length - 1].split(' = ').pop();
    const list = (x) => { const m = parseMatrix(x.trim()); return m ? m.rows[0] : [x.trim()]; };
    const ex = list(exactPart), ap = list(approxPart);
    if (ex.length !== ap.length) return [];
    return ex.map((e, i) => ({ text: e.replace(/^\((.*)\)$/, '$1'), v: Number(ap[i].replace(/−/g, '-')) })).filter((r) => isFinite(r.v));
  }
  // auto: asked for by opening the tools or drawing a graph, not with the "Area" button (a short time limit)
  async function computeArea(auto) {
    const U = P.areaUI, f = P.series[Number(U.f1.value)];
    if (!f) return;
    const a = normalizeExpr(U.a.value), b = normalizeExpr(U.b.value);
    if (!a || !b) { U.out.textContent = tr('Enter the range of x (a and b)', 'x の範囲（a と b）を入れてください'); return; }
    const g = areaG();
    U.out.textContent = tr('Calculating…', '計算中…');
    U.ins.hidden = true;
    // the limits as numbers, for the shading and to find the crossing points between them
    const lim = await Bridge.send('calc', { expr: `[${a}, ${b}]`, opts: Object.assign(engineOpts(), { approx: 'approx', precision: 15, grouping: false }), timeout: 1500 });
    const nums = lim.ok && lim.result ? (parseMatrix(numberPartVec(lim.result)) || { rows: [[]] }).rows[0].map((x) => Number(x.replace(/−/g, '-'))) : [];
    // f − g keeps its sign between crossing points: the area is the sum of |∫(f − g)| over those
    // pieces, which the engine can often give exactly (with abs() inside it often cannot)
    const d = g ? `(${f.expr}) − (${g.expr})` : f.expr;
    // 1.9.3: only where the functions have real values (the parts of a..b)
    let real = null;
    if (nums.length === 2 && nums.every(isFinite) && nums[0] !== nums[1]) {
      const lo = Math.min(nums[0], nums[1]), hi = Math.max(nums[0], nums[1]);
      real = await realParts(g ? [f.expr, g.expr] : [f.expr], nums[0] < nums[1] ? a : b, nums[0] < nums[1] ? b : a, lo, hi);
      if (real && !real.parts.length) { U.out.textContent = noRealText(); P.area = null; draw(); return; }
      if (real && !real.clipped) real = null;
    }
    const pieces = [];
    const crossIn = (lo, hi) => { const eps = (hi - lo) * 1e-9; return (P.areaCross || []).filter((p) => p.x > lo + eps && p.x < hi - eps).map((p) => p.text); };
    if (real) {
      for (const p of real.parts) {
        const bounds = [p.a].concat(crossIn(p.lo, p.hi), [p.b]);
        for (let i = 0; i + 1 < bounds.length; i++) pieces.push(`abs(integrate(${d}, ${bounds[i]}, ${bounds[i + 1]}))`);
      }
    } else {
      let cuts = [];
      if (nums.length === 2 && nums.every(isFinite) && P.areaCross) {
        cuts = crossIn(Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1]));
        if (nums[0] > nums[1]) cuts.reverse();
      }
      const bounds = [a].concat(cuts, [b]);
      for (let i = 0; i + 1 < bounds.length; i++) pieces.push(`abs(integrate(${d}, ${bounds[i]}, ${bounds[i + 1]}))`);
    }
    const expr = pieces.length <= 8 ? pieces.join(' + ') : real ? real.parts.map((p) => `integrate(abs(${d}), ${p.a}, ${p.b})`).join(' + ') : `integrate(abs(${d}), ${a}, ${b})`;
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: auto ? Math.min(5000, timeLimit() * 1000) : timeLimit() * 1000 });
    const err = r.ok ? (r.messages || []).find((m) => m.type === 'error') : null;
    // a result the engine could not integrate exactly still has its approximate value after ≈
    if (r.ok && r.result && /∫|integrate\(/.test(r.result) && r.result.indexOf('≈') > 0) r.result = '≈ ' + r.result.split('≈').pop().trim();
    if (!r.ok || r.timeout || err || !r.result || /integrate\(|∫/.test(r.result)) {
      U.out.textContent = r.timeout ? (auto ? tr('Press "Area" to calculate the area', '「面積」を押すと面積を計算します') : tr('It took too long (the time limit can be changed in the settings)', '時間がかかりすぎました（制限時間は設定で変えられます）'))
        : localMessage((err && err.text) || r.error) || tr('Could not calculate the area', '面積を計算できませんでした');
      P.area = null; draw();
      return;
    }
    U.out.textContent = '';
    showResult(U.out, tr('Area ', '面積 ') + (r.result.indexOf('≈ ') === 0 ? r.result : resultText(r)));
    if (real) U.out.append(el('div', { class: 'form-hint', text: realNote(!!g, real.parts) }));
    P.areaExpr = expr;
    U.ins.hidden = false;
    if (nums.length === 2 && nums.every(isFinite)) {
      P.area = { f, g, a: Math.min(nums[0], nums[1]), b: Math.max(nums[0], nums[1]), text: shortValue(tr('Area', '面積'), r.result, r.approx) };
      draw();
    }
  }
  const numberPartVec = (t) => String(t).split(' ≈ ').pop().split(' = ').pop().trim();
  // the shaded area: along f from a to b and back along g (or the x axis)
  // the value of a drawn function at x, between its sampled points (0 for the x axis, NaN where it has none)
  function seriesY(s, x) {
    if (!s) return 0;
    const xs = s.x;
    let lo = 0, hi = xs.length - 1;
    if (hi < 0 || x < xs[0] || x > xs[hi]) return NaN;
    if (hi === 0) return s.y[0] === null ? NaN : s.y[0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const y0 = s.y[lo], y1 = s.y[hi];
    if (y0 === null || y1 === null || !isFinite(y0) || !isFinite(y1)) return NaN;
    return xs[hi] === xs[lo] ? y0 : y0 + (y1 - y0) * (x - xs[lo]) / (xs[hi] - xs[lo]);
  }
  function drawArea(g, sx, sy) {
    const A = P.area, f = A.f, gs = A.g;
    const yAt = seriesY;
    const xs = [A.a].concat(f.x.filter((x) => x > A.a && x < A.b), [A.b]);
    g.save();
    g.fillStyle = f.color;
    g.globalAlpha = 0.22;
    g.beginPath();
    let open = false;
    const close = (back) => { if (!open) return; for (let i = back.length - 1; i >= 0; i--) g.lineTo(sx(back[i]), sy(yAt(gs, back[i]))); g.closePath(); open = false; };
    let seg = [];
    for (const x of xs) {
      const y1 = yAt(f, x), y2 = yAt(gs, x);
      if (!isFinite(y1) || !isFinite(y2)) { close(seg); seg = []; continue; }
      if (!open) { g.moveTo(sx(x), sy(y1)); open = true; } else g.lineTo(sx(x), sy(y1));
      seg.push(x);
    }
    close(seg);
    g.fill();
    g.restore();
  }

  // --------------------------------------------- partial derivatives (3D graph)
  function buildPartial3d() {
    const f = el('select', { 'aria-label': tr('Surface', '曲面') });
    const add = async (v) => {
      const s1 = Q3.data && Q3.data.series[Number(f.value)];
      if (!s1) return;
      // worked out first: the 3D graph puts numbers for y into the expression before diff() could
      // see y, so diff(f, y) would be drawn wrong
      const d = await exactText(`diff(${s1.expr}, ${v})`);
      if (!d || /diff\(|undefined/.test(d)) { toast(tr('Could not find the partial derivative', '偏導関数を求められませんでした'), 2200); return; }
      const expr = normalizeExpr(d);
      const lines = Q3.ta.value.split('\n').map((t) => t.trim()).filter(Boolean);
      if (lines.indexOf(expr) >= 0) return;
      if (lines.length >= 4) { toast(tr('Up to 4 surfaces', '曲面は 4 つまでです'), 1800); return; }
      Q3.ta.value = lines.concat(expr).join('\n');
      Q3.keep = true;
      Q3.go.click();
    };
    const box = el('div', { class: 'area-box' },
      el('div', { class: 'plot-range calc-row' }, el('span', { text: tr('Surface', '曲面') }), f),
      el('div', { class: 'calc-btns' },
        tapButton({ class: 'btn', text: tr('Draw ∂f/∂x', '∂f/∂x を描く') }, () => add('x')),
        tapButton({ class: 'btn', text: tr('Draw ∂f/∂y', '∂f/∂y を描く') }, () => add('y'))));
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Partial derivatives ▾', '偏微分 ▾') });
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) partialSurfacesChanged(); });
    Q3.partUI = { f, box };
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  function partialSurfacesChanged() {
    const U = Q3.partUI;
    if (!U) return;
    const keep = U.f.value;
    U.f.textContent = '';
    (Q3.data ? Q3.data.series : []).forEach((s1, i) => U.f.append(el('option', { value: String(i), text: clip(s1.expr, 34) })));
    U.f.value = keep !== '' && Q3.data && Q3.data.series[Number(keep)] ? keep : '0';
  }

  // ---------------------------------------------------- volume (3D graph)
  // The volume between a surface and the plane z = 0, or between two surfaces, and the area of the
  // surfaces, over the drawn rectangle of x and y or over a disk x² + y² ≤ R² (a sphere: the upper
  // and the lower half). The engine is asked for the exact value (polar coordinates for a disk);
  // the numeric value checks it, or is the answer when there is no exact one. The parts below
  // count as positive.
  // The values are those of the surfaces that are drawn: when the box is opened, when another
  // surface or region is chosen and when the graph is drawn again, the volume and then the surface
  // area are calculated at once (volumeAuto). The example (a sphere) at the bottom of the box is
  // the only thing that draws another graph.
  const VOL_N = 101;
  const SHAPES3D = [['sphere', tr('Sphere', '球'), ['r'], ['2']]];
  function buildVolume3d() {
    const s1 = el('select', { 'aria-label': tr('Surface', '曲面') }), s2 = el('select', { 'aria-label': tr('and', 'と') });
    const out = el('div', { class: 'area-out', 'aria-live': 'polite' });
    const ins = el('button', { class: 'btn', text: tr('Put the double integral into the input field', '重積分の式を入力欄に入れる'), hidden: true });
    // (no "Volume" and "Surface area" buttons since 1.8.1: both values are always calculated, and
    // the buttons only replaced the two values with one of them)
    const rangeText = el('span', { class: 'form-hint' });
    const R = el('input', { inputmode: 'text', autocapitalize: 'off', placeholder: 'R', 'aria-label': tr('Radius R', '半径 R') });
    const bRect = tapButton({ text: tr('Rectangle', '長方形') }, () => setRegion('rect')), bDisk = tapButton({ text: tr('Disk', '円') }, () => setRegion('disk'));
    const diskRow = el('span', { class: 'disk-row' }, el('span', { text: 'x² + y² ≤ R²,  R =' }), R);
    // quiet: only set (the caller calculates afterwards)
    const setRegion = (k, quiet) => {
      Q3.volUI.region = k;
      bRect.classList.toggle('on', k === 'rect'); bDisk.classList.toggle('on', k === 'disk');
      rangeText.hidden = k !== 'rect'; diskRow.hidden = k !== 'disk';
      out.textContent = ''; ins.hidden = true;
      if (!quiet) volumeAuto();
    };
    // the color of the solid that is measured, as it is shown in the graph (1.8.4; draw3d sets it)
    const legend = el('div', { class: 'vol-legend', hidden: true }, el('i'), el('span', { text: tr('In the graph, the solid that is measured looks like a pale gelatin of this color in a clear, glossy skin of a deeper shade', 'グラフでは、計測している立体を、この色の薄いゼラチンを、濃い色のつやのある透明な皮で包んだように示しています') }));
    const box = el('div', { class: 'area-box' },
      el('div', { class: 'plot-range' }, s1, el('span', { text: tr('and', 'と') }), s2, el('span', { text: tr('', 'の間') })),
      el('div', { class: 'plot-range' }, el('span', { text: tr('Region', '範囲') }), el('span', { class: 'seg mini' }, bRect, bDisk), rangeText, diskRow),
      legend, out, ins,
      el('div', { class: 'form-hint', text: tr('The values are those of the graph that is drawn. Parts below the plane (or the other surface) count as positive. The surface area is that of the two surfaces (or the surface and its floor on z = 0), without side walls.', 'いま描いているグラフの値です。平面（またはもう一方の曲面）より下の部分もプラスとして数えます。表面積は 2 つの曲面（または曲面と z = 0 の底面）の面積の和で、側面は含みません。') }),
      buildShapes(SHAPES3D, (k, v) => drawSphere(v.r)),
      tapButton({ class: 'btn geo-link', text: tr('More shapes: cylinder, cone, box… ›', 'ほかの図形（円柱・円錐・直方体など）›') }, () => openShapes()));
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Volume and surface ▾', '体積・表面積 ▾') });
    // opened: the volume and the surface area of the drawn surface are shown at once
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) volumeSurfacesChanged(); else { Q3.volUI.seq++; Q3.volShade = null; Q3.liqBuf = null; requestDraw3d(); } });
    s1.addEventListener('change', () => { if (s2.value === s1.value) s2.value = 'plane'; volumeAuto(); });
    s2.addEventListener('change', () => volumeAuto());
    R.addEventListener('change', () => volumeAuto());
    R.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); R.blur(); } });
    ins.addEventListener('click', () => { if (Q3.volExpr) useExample(Q3.volExpr); });
    Q3.volUI = { s1, s2, out, ins, box, rangeText, R, toggle, setRegion, legend, seq: 0, timer: 0 };
    setRegion('rect', true);
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  // the volume and then the surface area of the surfaces that are chosen (the drawn ones), a moment
  // after the last change; a newer change or calculation stops the older one from writing its result
  function volumeAuto() {
    const U = Q3.volUI;
    if (!U || U.box.hidden) return;
    U.seq++;
    clearTimeout(U.timer);
    U.timer = setTimeout(async () => {
      if (U.box.hidden) return;
      const seq = U.seq;
      await computeVolume(seq);
      if (seq === U.seq && !U.box.hidden) await computeSurface(true, seq);
    }, 80);
  }
  // a sphere of radius r: the upper and the lower half over the disk of radius r, round (the same
  // scale on all axes), with its volume and surface area
  async function drawSphere(r) {
    clearVolume();
    const n = await numValue(r);
    if (!(n > 0)) { toast(tr('The size must be a positive number', '大きさは正の数にしてください'), 2000); return; }
    const r2 = (await symText(`(${r})^2`)) || `(${r})^2`;
    const top = `√(${r2} − x^2 − y^2)`;
    const w = n * 1.1;
    Q3.ta.value = top + '\n−' + top;
    Q3.inputs.forEach((e, i) => { e.value = r6(i % 2 ? w : -w); });
    if (Q3.resEl && Number(Q3.resEl.value) < 61) Q3.resEl.value = '61';
    Q3.equalOnce = true; // round for this drawing; the 1:1 setting itself stays as it was
    if (Q3.samples) Q3.samples.clearChoice(); // (the sphere is not the sample that was marked, 1.8.2)
    Q3.keep = true;
    Q3.pending = async () => {
      const U = Q3.volUI;
      U.box.hidden = false; U.toggle.classList.add('on');
      volumeSurfacesChanged(true);
      U.s1.value = '0'; U.s2.value = '1';
      U.setRegion('disk', true); U.R.value = r;
      clearTimeout(U.timer);
      const seq = ++U.seq;
      await computeVolume(seq);
      if (seq === U.seq) await computeSurface(true, seq);
    };
    Q3.go.click();
  }
  // a calculation that is running is given up and its place emptied (another graph is on its way)
  function clearVolume() {
    const U = Q3.volUI;
    if (!U) return;
    U.seq++;
    clearTimeout(U.timer);
    U.out.textContent = ''; U.ins.hidden = true;
    Q3.volShade = null;
  }
  // the solid that is measured, for draw3d (1.8.4): the chosen surfaces of this graph and the
  // region, with the radius of a disk as a number (the engine is asked when it is an expression)
  async function setVolumeShade(S) {
    const D = Q3.data;
    if (!S || !D) { Q3.volShade = null; requestDraw3d(); return; }
    let R = 0;
    if (S.disk) { R = Number(S.R); if (!isFinite(R)) R = await numValue(S.R); }
    Q3.volShade = S.disk && !(R > 0) ? null : { D, fi: D.series.indexOf(S.f), gi: S.g ? D.series.indexOf(S.g) : -1, disk: S.disk, R };
    requestDraw3d();
  }
  // the lists of surfaces follow the graph; quiet: without calculating (the caller does)
  function volumeSurfacesChanged(quiet) {
    const U = Q3.volUI;
    if (!U) return;
    const k1 = U.s1.value, k2 = U.s2.value, D = Q3.data;
    U.s1.textContent = ''; U.s2.textContent = '';
    const series = D ? D.series : [];
    series.forEach((s, i) => { U.s1.append(el('option', { value: String(i), text: clip(s.expr, 30) })); U.s2.append(el('option', { value: String(i), text: clip(s.expr, 30) })); });
    U.s2.prepend(el('option', { value: 'plane', text: tr('the plane z = 0', '平面 z = 0') }));
    const same = U.count === series.length;
    U.count = series.length;
    const ok = (k) => k !== '' && !!series[Number(k)];
    U.s1.value = same && ok(k1) ? k1 : '0';
    U.s2.value = same && (k2 === 'plane' || ok(k2)) ? k2 : (series.length > 1 ? '1' : 'plane');
    if (U.s2.value === U.s1.value) U.s2.value = 'plane';
    const [x0, x1, y0, y1] = Q3.range;
    U.rangeText.textContent = 'x ' + (x0 || '-5') + ' 〜 ' + (x1 || '5') + tr(', ', '、') + 'y ' + (y0 || '-5') + ' 〜 ' + (y1 || '5');
    if (!U.R.value) U.R.value = r6(Math.min(Math.abs(Number(x0) || 5), Math.abs(Number(x1) || 5), Math.abs(Number(y0) || 5), Math.abs(Number(y1) || 5)));
    U.out.textContent = ''; U.ins.hidden = true;
    if (!quiet) volumeAuto();
  }
  // the chosen surfaces and region, or null (with a message)
  function volumeSetup() {
    const U = Q3.volUI, D = Q3.data;
    if (!D || !D.series.length) { U.out.textContent = tr('Draw a graph first', '先にグラフを描いてください'); return null; }
    const f = D.series[Number(U.s1.value)], g = U.s2.value === 'plane' ? null : D.series[Number(U.s2.value)];
    if (!f) return null;
    const disk = U.region === 'disk', R = normalizeExpr(U.R.value);
    if (disk && !R) { U.out.textContent = tr('Enter the radius R', '半径 R を入れてください'); return null; }
    const [x0, x1, y0, y1] = Q3.range.map((v, i) => v || ['-5', '5', '-5', '5'][i]);
    return { U, f, g, disk, R, x0, x1, y0, y1, es: g ? [f.expr, g.expr] : [f.expr] };
  }
  // 1.9.3: the part of the region where the surfaces have real values. The sample "Doughnut" has
  // real values only on a ring: until 1.9.2 the points without them were counted all the same
  // (abs(f − g) and √(1 + f_x² + f_y²) can be real there), and its volume was 76.85, not 4π². The
  // grid of the graph tells whether a surface lacks real values somewhere in the region. Then the
  // surfaces are read along 16 rays from the origin: when every ray has the same parts with real
  // values, they are rings (or a disk) around the origin, and those rings are measured in polar
  // coordinates, between radii found exactly along the x axis. Else a rectangle counts only the
  // points where the surfaces are real (about 4 digits), and a disk is not measured.
  // Returns null (the region as it is), { rings, note }, { mask: true } or { error }.
  const realRegionCache = new Map();
  async function realRegion(S) {
    const key = JSON.stringify([S.es, S.disk, S.disk ? S.R : [S.x0, S.x1, S.y0, S.y1], iOpts()]);
    if (realRegionCache.has(key)) return realRegionCache.get(key);
    const res = await findRealRegion(S);
    if (res === undefined) return null; // (the engine did not answer: not kept)
    realRegionCache.set(key, res);
    if (realRegionCache.size > 50) realRegionCache.delete(realRegionCache.keys().next().value);
    return res;
  }
  async function findRealRegion(S) {
    const D = Q3.data, es = S.es, zs = [S.f.z].concat(S.g ? [S.g.z] : []);
    const X0 = D.xs[0], X1 = D.xs[D.nx - 1], Y0 = D.ys[0], Y1 = D.ys[D.ny - 1];
    const inner = Math.min(-X0, X1, -Y0, Y1); // the largest disk around the origin in the grid (≤ 0: the origin is outside)
    let R = NaN;
    if (S.disk) { R = Number(S.R); if (!isFinite(R)) R = await numValue(S.R); if (!(R > 0)) return null; }
    if (!S.disk || R <= inner) {
      let gap = false;
      for (let j = 0; j < D.ny && !gap; j++) for (let i = 0; i < D.nx; i++) {
        if (S.disk && D.xs[i] * D.xs[i] + D.ys[j] * D.ys[j] > R * R) continue;
        const k = j * D.nx + i;
        if (zs.some((z) => !(z[k] === z[k]))) { gap = true; break; }
      }
      if (!gap) return null;
    }
    const rmax = S.disk ? R : Math.sqrt(Math.max(X0 * X0, X1 * X1) + Math.max(Y0 * Y0, Y1 * Y1)), rmaxText = S.disk ? S.R : engineNum(rmax);
    const one = es.length === 1;
    const ringsText = (rings) => rings.map((p) => (p.lo === 0 ? 'r ≤ ' + p.b : p.a + ' ≤ r ≤ ' + p.b)).join(tr(' and ', '、', ' y '));
    const fit = (rings) => ({ rings, note: tr((one ? 'Only where the surface has real values: ' : 'Only where both surfaces have real values: ') + ringsText(rings) + ' (r = √(x² + y²))',
      (one ? '曲面に実数の値がある ' : '2 つの曲面に実数の値がある ') + ringsText(rings) + ' の部分だけで計算しました（r = √(x² + y²)）',
      (one ? 'Solo donde la superficie tiene valores reales: ' : 'Solo donde ambas superficies tienen valores reales: ') + ringsText(rings) + ' (r = √(x² + y²))') });
    const notRound = () => (S.disk ? { error: tr('The surfaces have no real values in part of this disk: choose a smaller radius R, or the rectangle', '曲面に実数の値がない部分がこの円の中にあります。半径 R を小さくするか、長方形を選んでください',
      'Las superficies no tienen valores reales en parte de este disco: elige un radio R más pequeño, o el rectángulo') } : { mask: true });
    // 16 rays: r from 0 to the edge of the disk or to the farthest corner of the rectangle
    const K = 16, exprs = [];
    for (let k = 0; k < K; k++) {
      const [c, s] = k % 4 === 0 ? [['1', '0'], ['0', '1'], ['−1', '0'], ['0', '−1']][k / 4] : [engineNum(Math.cos(2 * Math.PI * k / K)), engineNum(Math.sin(2 * Math.PI * k / K))];
      for (const e of es) exprs.push(subXY(e, `x × (${c})`, `x × (${s})`));
    }
    const pts = [];
    for (let i = 0; i < exprs.length; i += 12) {
      const s = await realSamples(exprs.slice(i, i + 12), '0', rmaxText, 300);
      if (!s) return undefined;
      pts.push(...s);
    }
    const rays = [];
    for (let k = 0; k < K; k++) {
      let parts = [{ lo: 0, hi: rmax, a: '0', b: rmaxText }];
      for (let m = 0; m < es.length; m++) parts = intersectParts(parts, await realIntervals(exprs[k * es.length + m], pts[k * es.length + m], 0, rmax, '0', rmaxText, false));
      rays.push(parts);
    }
    const tol = 2.5 * rmax / 300;
    const round = rays.every((p) => p.length === rays[0].length && p.every((q, i) => Math.abs(q.lo - rays[0][i].lo) <= tol && Math.abs(q.hi - rays[0][i].hi) <= tol));
    if (!round) return notRound();
    // the radii, exactly, along the x axis (y = 0, r = x)
    const e0 = es.map((e) => subXY(e, 'x', '0'));
    const s0 = await realSamples(e0, '0', rmaxText, 400);
    if (!s0) return undefined;
    let rings = [{ lo: 0, hi: rmax, a: '0', b: rmaxText }];
    for (let m = 0; m < es.length; m++) rings = intersectParts(rings, await realIntervals(e0[m], s0[m], 0, rmax, '0', rmaxText, true));
    if (!rings.length) return { error: tr('The surfaces have no real values in this region', 'この範囲では曲面に実数の値がありません', 'Las superficies no tienen valores reales en esta región') };
    if (rings.length === 1 && rings[0].lo === 0 && rings[0].hi === rmax) return null; // real on every ray (the gaps of the grid are poles)
    if (rings.length !== rays[0].length) return notRound();
    if (S.disk) return fit(rings);
    // a rectangle: the rings must lie in it
    const last = rings[rings.length - 1];
    return last.hi < rmax && last.hi <= inner * (1 + 1e-12) ? fit(rings) : notRound();
  }
  // true when f − g (or f) takes both signs at the points of the drawn grid (1.9.3)
  function signChanges(S) {
    const f = S.f.z, g = S.g ? S.g.z : null;
    let pos = false, neg = false;
    for (let k = 0; k < f.length && !(pos && neg); k++) {
      const v = f[k] - (g ? g[k] : 0);
      if (v > 0) pos = true; else if (v < 0) neg = true;
    }
    return pos && neg;
  }
  const polar = (e) => subXY(e, '\\r cos(\\θ)', '\\r sin(\\θ)');
  // ∬ F over the region: the exact double integral (as text), its value if the engine finds it, the numeric value
  // ∬ F over the region as an expression for the engine (polar coordinates for a disk or rings)
  function regionExpr(S, exprF) {
    const turn = fullTurn();
    const ring = (r0, r1) => `integrate(integrate((${polar(exprF)}) × \\r, ${r0}, ${r1}, \\r), 0, ${turn}, \\θ)` + (turn === '2π' ? '' : ` × 2π/${turn}`);
    if (S.real && S.real.rings) return S.real.rings.map((p) => ring(p.a, p.b)).join(' + ');
    return S.disk ? ring(0, S.R) : `integrate(integrate(${exprF}, ${S.x0}, ${S.x1}, x), ${S.y0}, ${S.y1}, y)`;
  }
  // its numeric value: { num, missing } (Simpson's rule on 101 × 101 points for a rectangle: about
  // 8 correct digits for a smooth surface)
  async function regionNumeric(S, F, smooth) {
    if (S.real && S.real.rings) {
      let t = 0, digits = 10;
      for (const p of S.real.rings) { const r = await tsAnnulus(F, p.a, p.b); t += r.v; digits = Math.min(digits, r.digits); }
      return { num: t, missing: 0, digits };
    }
    if (S.disk) { const r = await tsDisk(F, S.R); return { num: r.v, missing: 0, digits: r.digits }; }
    const r = await simpsonRect(F, S.x0, S.x1, S.y0, S.y1, S.real && S.real.mask ? S.es : null, smooth);
    return { num: r.v, missing: r.missing, digits: r.digits };
  }
  // the digits shown: a rectangle with points left out where the surfaces have no real value gives about 4
  const regionDigits = (S, n) => Math.min(S.disk || (S.real && S.real.rings) ? 10 : 8, (n && n.digits) || 10);
  // the exact value is tried for a few seconds only (some double integrals keep the engine busy).
  // 1.8.2: 3 s for the volume and 2 s for each surface (8 s until 1.8.1). Every exact value of the
  // samples is found in 0.11 s or less on a PC, and a search that finds none uses all the time, so
  // the numeric value now becomes final much sooner and no exact value of the samples is lost.
  const VOLUME_EXACT_MS = 3000, SURFACE_EXACT_MS = 2000;
  const regionExact = (S, ix, ms) => exactIntegral(ix, Math.min(ms || VOLUME_EXACT_MS, timeLimit() * 1000));
  // early(value, missing): called with the numeric value as soon as it is known, before the exact
  // value is looked for
  async function regionIntegral(S, F, signedF, early) {
    const ix = regionExpr(S, signedF || F);
    // (abs(f − g) is smooth unless f − g takes both signs in the region: then it has a kink where it is 0)
    const n = await regionNumeric(S, F, !(signedF && signChanges(S)));
    if (early) early(bestValue(null, n.num, regionDigits(S, n)), n.missing);
    // (with points left out, the exact integral over the whole rectangle would count them: not asked for)
    const ex = S.real && S.real.mask ? null : await regionExact(S, signedF ? `abs(${ix})` : ix);
    return { expr: ix, val: bestValue(ex, n.num, regionDigits(S, n)), missing: n.missing };
  }
  // a value shown before the exact one has been looked for: "about 39.939589 (checking…)"
  const aboutValue = (name, val) => name + tr(' about ', ' 約 ') + val.text.replace(/^≈ /, '') + tr(' (checking for an exact value…)', '（厳密な値を確かめています…）');
  // seq: the number of this calculation (a button press takes a new one); a result is written only
  // while no newer calculation has started
  async function computeVolume(seq) {
    const S = volumeSetup();
    if (!S) { setVolumeShade(null); return; }
    const { U, f, g } = S;
    if (seq === undefined) { clearTimeout(U.timer); seq = ++U.seq; }
    await setVolumeShade(S);
    if (seq !== U.seq) return;
    U.out.textContent = tr('Calculating…', '計算中…');
    U.ins.hidden = true;
    S.real = await realRegion(S);
    if (seq !== U.seq) return;
    if (S.real && S.real.error) { U.out.textContent = S.real.error; return; }
    const d = g ? `(${f.expr}) − (${g.expr})` : f.expr;
    const r = await regionIntegral(S, `abs(${d})`, d, (v) => { if (v && seq === U.seq) U.out.textContent = aboutValue(tr('Volume', '体積'), v); });
    if (seq !== U.seq) return;
    if (!r.val) { U.out.textContent = tr('Could not calculate the volume', '体積を計算できませんでした'); return; }
    U.out.textContent = '';
    showResult(U.out, tr('Volume ', '体積 ') + shownValue(r.val));
    if (S.real && S.real.note) U.out.append(el('div', { class: 'form-hint', text: S.real.note }));
    if (r.missing) U.out.append(el('div', { class: 'form-hint', text: tr(`${r.missing} points without a real value were left out (the value is approximate)`, `実数の値がない ${r.missing} 点を除いています（おおよその値です）`,
      `Se omitieron ${r.missing} puntos sin valor real (el valor es aproximado)`) }));
    Q3.volExpr = r.expr;
    U.ins.hidden = false;
  }
  // the area of the surfaces: ∬ √(1 + f_x² + f_y²), for each surface (the floor z = 0: the area of the region)
  // append: below the volume that is shown (else in its place)
  async function computeSurface(append, seq) {
    const S = volumeSetup();
    if (!S) return;
    const { U, f, g } = S;
    if (seq === undefined) { clearTimeout(U.timer); seq = ++U.seq; }
    const out = append ? el('div', { class: 'area-out' }) : U.out;
    if (append) U.out.append(out); else { U.out.textContent = ''; U.ins.hidden = true; }
    out.textContent = tr('Calculating the surface area…', '表面積を計算中…');
    const fail = (text) => { if (seq === U.seq) out.textContent = text || tr('Could not calculate the surface area', '表面積を計算できませんでした'); };
    const parts = [], names = [], items = [];
    let missing = 0;
    S.real = await realRegion(S);
    if (seq !== U.seq) return;
    if (S.real && S.real.error) { fail(S.real.error); return; }
    // the floor z = 0 under one surface: the region, or (1.9.3) its part where the surface has real values
    const rings = S.real && S.real.rings, mask = S.real && S.real.mask;
    // a surface usually stands upright where its real values end (√(1 − x²) at x = ±1), and the points
    // of a grid cannot follow that: √(1 − x²) on [−2, 2]² gave 19 for 4π + 8 ≈ 20.57. Not measured.
    if (mask) {
      fail(tr('The surface area cannot be measured here: the surfaces end inside the rectangle, where their real values end. Choose a rectangle inside them (or the disk, when they are round)',
        '表面積はここでは測れません。曲面が長方形の中で終わっています（実数の値がなくなる所）。曲面の内側の長方形（丸い形なら円）を選んでください',
        'El área superficial no se puede medir aquí: las superficies terminan dentro del rectángulo, donde terminan sus valores reales. Elige un rectángulo dentro de ellas (o el disco, si son redondas)'));
      return;
    }
    const floor = g ? null : rings ? await exactIntegral(rings.map((p) => `π × ((${p.b})^2 − (${p.a})^2)`).join(' + '), 3000)
      : S.disk ? await exactIntegral(`π × (${S.R})^2`, 3000) : await exactIntegral(`abs(((${S.x1}) − (${S.x0})) × ((${S.y1}) − (${S.y0})))`, 3000);
    if (seq !== U.seq) return;
    if (!g && rings && !floor) { fail(); return; }
    // the numeric value of each surface first: their sum is shown while the exact values are looked for
    for (const s1 of g ? [f, g] : [f]) {
      const A = recipSqrt(await symText(`√(1 + (diff(${s1.expr}, x))^2 + (diff(${s1.expr}, y))^2)`));
      if (seq !== U.seq) return;
      if (!A) { fail(); return; }
      const n = await regionNumeric(S, A, true);
      if (seq !== U.seq) return;
      items.push({ A, n, name: clip(s1.expr, 24) });
    }
    if (items.every((it) => isFinite(it.n.num))) {
      const sum = items.reduce((t, it) => t + it.n.num, floor ? floor.v : 0);
      out.textContent = aboutValue(tr('Surface area', '表面積'), { text: fmtV(+sum.toPrecision(Math.min(...items.map((it) => regionDigits(S, it.n))))) });
    }
    for (const it of items) {
      const val = bestValue(await regionExact(S, regionExpr(S, it.A), SURFACE_EXACT_MS), it.n.num, regionDigits(S, it.n));
      if (seq !== U.seq) return;
      if (!val) { fail(); return; }
      parts.push(val); names.push(it.name);
      missing += it.n.missing;
    }
    if (floor) { parts.push(floor); names.push(tr('floor z = 0', '底面 z = 0')); }
    const total = await sumValues(parts);
    if (seq !== U.seq) return;
    out.textContent = '';
    showResult(out, tr('Surface area ', '表面積 ') + shownValue(total));
    out.append(el('div', { class: 'form-hint', text: parts.map((p, i) => names[i] + tr(': ', '：') + shownValue(p).replace(/^= /, '')).join(tr(' / ', ' ／ ')) }));
    if (S.real && S.real.note && !append) out.append(el('div', { class: 'form-hint', text: S.real.note }));
    if (missing) out.append(el('div', { class: 'form-hint', text: tr(`${missing} points without a real value were left out (the value is approximate)`, `実数の値がない ${missing} 点を除いています（おおよその値です）`,
      `Se omitieron ${missing} puntos sin valor real (el valor es aproximado)`) }));
  }

  // the functions of a graph: one in each line; a line "sin(x), cos(x)" is two (a "," or ";" outside
  // parentheses). Returns the first `max` of them; .more is how many were left out.
  function plotExprs(text, max) {
    const all = [];
    for (const line of text.split('\n')) {
      let d = 0, cur = '';
      for (const c of line) {
        if ('([{'.indexOf(c) >= 0) d++; else if (')]}'.indexOf(c) >= 0) d--;
        if ((c === ',' || c === ';') && d <= 0) { all.push(cur); cur = ''; } else cur += c;
      }
      all.push(cur);
    }
    const list = all.map(normalizeExpr).filter(Boolean);
    const out = list.slice(0, max);
    out.more = list.length - out.length;
    return out;
  }
  // what to say below a graph: an error of the engine, functions that were left out, functions without values
  function plotNote(err, exprs, empty, max, three) {
    if (err) return localMessage(err.text);
    const notes = [], vars = three ? tr('x and y', 'x と y') : 'x';
    if (exprs.more > 0) notes.push(tr(`Up to ${max} functions are drawn: ${exprs.more} more left out`, `描けるのは ${max} つまでです（残りの ${exprs.more} つは描いていません）`,
      `Se dibujan hasta ${max} funciones: se omitieron ${exprs.more} más`));
    if (empty.length) notes.push(tr(`No values for ${empty.map((e) => '"' + clip(e, 18) + '"').join(', ')}: check the expression and the range (the variable is ${vars})`, `${empty.map((e) => '「' + clip(e, 18) + '」').join('、')}は値が出ません。式と範囲を確認してください（変数は ${vars}）`,
      `Sin valores para ${empty.map((e) => '"' + clip(e, 18) + '"').join(', ')}: revisa la expresión y el rango (la variable es ${vars})`));
    // (a letter that has a value of its own is no longer the variable of the tools below the graph)
    const dv = (three ? ['x', 'y'] : ['x']).find((l) => definedVars.has(l));
    if (dv) notes.push(tr(`${dv} has a value of its own (a user variable): the derivative, area and other tools below may be wrong until it is deleted (menu: User-defined variables and functions)`, `${dv} に値が定義されています（ユーザー定義の変数）。下の微分・面積などの計算は、${dv} を削除するまで正しく出ないことがあります（メニュー「ユーザー定義の変数・関数」）`,
      `${dv} tiene un valor propio (una variable del usuario): la derivada, el área y las otras herramientas de abajo pueden salir mal hasta que se elimine (menú: Variables y funciones del usuario)`));
    return notes.join(' ');
  }

  // ------------------------------------------------- samples for the graphs
  // Graphs to try with one tap: a row of small pictures below the graph (2D and 3D). The pictures
  // are drawn by the page itself (f: the same functions in JavaScript), so they need no image files
  // and no calculation by the engine. In an expression "@" is where the angle unit goes: nothing
  // when the angle setting is radians and " rad" otherwise, so a sample looks the same with every
  // setting ({a + b} is an angle that is a sum: a + b, or (a + b) rad). r: the range of x (2D) or of x and y (3D); eq: the same scale on all axes; y: the
  // range of y of the picture (a function with poles); n: grid points of the picture; res: the grid
  // of the 3D graph; disk: the radius of the round region for "Volume and surface".
  const hyp = Math.hypot;
  const SAMPLES2D = [
    { t: tr('Waves', '波'), e: ['sin(x@)', 'cos(x@)'], r: ['-7', '7'], f: [Math.sin, Math.cos] },
    { t: tr('Parabola & line', '放物線と直線'), e: ['x^2', 'x + 2'], r: ['-3', '3'], f: [(x) => x * x, (x) => x + 2] },
    { t: tr('Cubic', '3 次関数'), e: ['x^3 − 3x'], r: ['-2.5', '2.5'], f: [(x) => x * x * x - 3 * x] },
    { t: tr('Heart', 'ハート'), e: ['√(1 − (abs(x) − 1)^2)', '−3 √(1 − √(abs(x) / 2))'], r: ['-2', '2'], eq: true,
      f: [(x) => Math.sqrt(1 - (Math.abs(x) - 1) ** 2), (x) => -3 * Math.sqrt(1 - Math.sqrt(Math.abs(x) / 2))] },
    { t: tr('Circle', '円'), e: ['√(4 − x^2)', '−√(4 − x^2)'], r: ['-2.6', '2.6'], eq: true, f: [(x) => Math.sqrt(4 - x * x), (x) => -Math.sqrt(4 - x * x)] },
    { t: tr('Bell curve', 'ベルカーブ'), e: ['e^(−x^2 / 2) / √(2π)'], r: ['-4', '4'], f: [(x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)] },
    { t: tr('Damped wave', '減衰する波'), e: ['e^(−x / 5) sin(3x@)', 'e^(−x / 5)', '−e^(−x / 5)'], r: ['0', '15'],
      f: [(x) => Math.exp(-x / 5) * Math.sin(3 * x), (x) => Math.exp(-x / 5), (x) => -Math.exp(-x / 5)] },
    { t: tr('Square wave', '矩形波に近づく'), e: ['sin(x@)', 'sin(x@) + sin(3x@) / 3', 'sin(x@) + sin(3x@) / 3 + sin(5x@) / 5 + sin(7x@) / 7'], r: ['-7', '7'],
      f: [Math.sin, (x) => Math.sin(x) + Math.sin(3 * x) / 3, (x) => Math.sin(x) + Math.sin(3 * x) / 3 + Math.sin(5 * x) / 5 + Math.sin(7 * x) / 7] },
    { t: tr('Beats', 'うなり'), e: ['sin(10x@) + sin(11x@)'], r: ['0', '13'], f: [(x) => Math.sin(10 * x) + Math.sin(11 * x)], n: 400 },
    { t: 'sin(x) / x', e: ['sin(x@) / x'], r: ['-20', '20'], f: [(x) => (x ? Math.sin(x) / x : 1)] },
    { t: tr('Wave packet', '波のかたまり'), e: ['e^(−x^2 / 8) cos(5x@)', 'e^(−x^2 / 8)', '−e^(−x^2 / 8)'], r: ['-7', '7'],
      f: [(x) => Math.exp(-x * x / 8) * Math.cos(5 * x), (x) => Math.exp(-x * x / 8), (x) => -Math.exp(-x * x / 8)] },
    { t: tr('eˣ and ln x', '指数と対数'), e: ['e^x', 'ln(x)', 'x'], r: ['-2.5', '2.5'], y: [-4, 8], f: [Math.exp, (x) => (x > 0 ? Math.log(x) : NaN), (x) => x] },
    { t: tr('Five zeros', '5 つの零点'), e: ['x (x^2 − 1) (x^2 − 4)'], r: ['-2.3', '2.3'], f: [(x) => x * (x * x - 1) * (x * x - 4)] },
    { t: tr('S-curve', 'S 字カーブ'), e: ['1 / (1 + e^(−x))'], r: ['-6', '6'], f: [(x) => 1 / (1 + Math.exp(-x))] },
    { t: tr('Hanging chain', '懸垂線と放物線'), e: ['cosh(x)', '1 + x^2 / 2'], r: ['-2.5', '2.5'], f: [Math.cosh, (x) => 1 + x * x / 2] },
    { t: tr('Chirp', 'だんだん速い波'), e: ['sin(x^2@)'], r: ['0', '7'], f: [(x) => Math.sin(x * x)], n: 400 },
    { t: tr('Growing wave', '広がる波'), e: ['x sin(x@)', 'x', '−x'], r: ['-20', '20'], f: [(x) => x * Math.sin(x), (x) => x, (x) => -x] }
  ];
  const SAMPLES3D = [
    { t: tr('Egg carton', '波（卵パック）'), e: ['sin(x@) cos(y@)'], r: ['-5', '5', '-5', '5'], f: [(x, y) => Math.sin(x) * Math.cos(y)] },
    { t: tr('Ripple', '波紋'), e: ['cos(√(x^2 + y^2)@) e^(−(x^2 + y^2) / 60)'], r: ['-10', '10', '-10', '10'], res: '61', n: 29,
      f: [(x, y) => Math.cos(hyp(x, y)) * Math.exp(-(x * x + y * y) / 60)] },
    { t: tr('Sphere', '球'), e: ['√(4 − x^2 − y^2)', '−√(4 − x^2 − y^2)'], r: ['-2.2', '2.2', '-2.2', '2.2'], res: '61', eq: true, disk: '2', n: 41, one: true,
      f: [(x, y) => Math.sqrt(4 - x * x - y * y), (x, y) => -Math.sqrt(4 - x * x - y * y)] },
    { t: tr('Doughnut', 'ドーナツ'), e: ['√(1 − (√(x^2 + y^2) − 2)^2)', '−√(1 − (√(x^2 + y^2) − 2)^2)'], r: ['-3.3', '3.3', '-3.3', '3.3'], res: '61', eq: true, n: 45, one: true,
      f: [(x, y) => Math.sqrt(1 - (hyp(x, y) - 2) ** 2), (x, y) => -Math.sqrt(1 - (hyp(x, y) - 2) ** 2)] },
    { t: tr('Saddle', '鞍（くら）'), e: ['x^2 − y^2'], r: ['-2', '2', '-2', '2'], f: [(x, y) => x * x - y * y] },
    { t: tr('Bowl and lid', 'おわんとふた'), e: ['x^2 + y^2', '4'], r: ['-2', '2', '-2', '2'], disk: '2', f: [(x, y) => x * x + y * y, () => 4] },
    { t: tr('Hill', '山'), e: ['e^(−(x^2 + y^2))'], r: ['-2.5', '2.5', '-2.5', '2.5'], f: [(x, y) => Math.exp(-(x * x + y * y))] },
    { t: tr('Peaks', '山と谷'), e: ['3 (1 − x)^2 e^(−x^2 − (y + 1)^2) − 10 (x / 5 − x^3 − y^5) e^(−x^2 − y^2) − e^(−(x + 1)^2 − y^2) / 3'], r: ['-3', '3', '-3', '3'], res: '61', n: 25,
      f: [(x, y) => 3 * (1 - x) ** 2 * Math.exp(-x * x - (y + 1) ** 2) - 10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-x * x - y * y) - Math.exp(-((x + 1) ** 2) - y * y) / 3] },
    { t: tr('Double cone', '2 つの円錐'), e: ['√(x^2 + y^2)', '−√(x^2 + y^2)'], r: ['-2', '2', '-2', '2'], eq: true, f: [(x, y) => hyp(x, y), (x, y) => -hyp(x, y)] },
    { t: tr('Monkey saddle', 'モンキーサドル'), e: ['x^3 − 3x y^2'], r: ['-1.5', '1.5', '-1.5', '1.5'], f: [(x, y) => x * x * x - 3 * x * y * y] },
    { t: tr('Crossing waves', '交わる波'), e: ['sin(x@) + sin(y@)'], r: ['-6', '6', '-6', '6'], f: [(x, y) => Math.sin(x) + Math.sin(y)] },
    { t: tr('Twisted plane', 'ねじれた面'), e: ['x y'], r: ['-2', '2', '-2', '2'], f: [(x, y) => x * y] },
    { t: tr('Pyramid', 'ピラミッド'), e: ['2 − abs(x) − abs(y)'], r: ['-2', '2', '-2', '2'], f: [(x, y) => 2 - Math.abs(x) - Math.abs(y)] },
    { t: tr('Rings', '輪の波'), e: ['sin({x^2 + y^2}) / (1 + x^2 + y^2)'], r: ['-3', '3', '-3', '3'], res: '61', n: 33, f: [(x, y) => Math.sin(x * x + y * y) / (1 + x * x + y * y)] }
  ];
  // the expressions of a sample for the angle setting in use
  // ({…}: a sum that is an angle as a whole)
  const sampleExprs = (d) => d.e.map((t) => (S.angle === 'rad' ? t.replace(/[@{}]/g, '') : t.replace(/\{([^}]*)\}/g, '($1) rad').replace(/@/g, ' rad')));
  const THUMB_W = 84, THUMB_H = 60;
  function thumbContext(c) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(THUMB_W * dpr); c.height = Math.round(THUMB_H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, THUMB_W, THUMB_H);
    return g;
  }
  function thumb2d(c, d) {
    const g = thumbContext(c), W = THUMB_W, H = THUMB_H, N = d.n || 140;
    const x0 = Number(d.r[0]), x1 = Number(d.r[1]);
    const ys = d.f.map((f) => { const a = []; for (let i = 0; i <= N; i++) { const v = f(x0 + (x1 - x0) * i / N); a.push(isFinite(v) ? v : NaN); } return a; });
    let lo = Infinity, hi = -Infinity;
    if (d.y) { lo = d.y[0]; hi = d.y[1]; } else for (const a of ys) for (const v of a) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = 5;
    let sx = (W - 2 * pad) / (x1 - x0), sy = (H - 2 * pad) / (hi - lo);
    if (d.eq) sx = sy = Math.min(sx, sy);
    const X = (x) => W / 2 + (x - (x0 + x1) / 2) * sx, Y = (y) => H / 2 - (y - (lo + hi) / 2) * sy;
    g.strokeStyle = 'rgba(128,128,128,0.5)'; g.lineWidth = 1; g.beginPath();
    if (lo < 0 && hi > 0) { g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); }
    if (x0 < 0 && x1 > 0) { g.moveTo(X(0), 0); g.lineTo(X(0), H); }
    g.stroke();
    ys.forEach((a, si) => {
      g.strokeStyle = COLORS[si % COLORS.length]; g.lineWidth = 1.7; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
      let pen = false, prev = NaN;
      a.forEach((v, i) => {
        // outside the picture, or a jump across a pole: the line stops
        if (v !== v || v < lo - (hi - lo) * 0.2 || v > hi + (hi - lo) * 0.2 || (pen && Math.abs(v - prev) > (hi - lo) * 0.8)) { pen = false; prev = v; return; }
        const px = X(x0 + (x1 - x0) * i / N), py = Y(v);
        if (pen) g.lineTo(px, py); else g.moveTo(px, py);
        pen = true; prev = v;
      });
      g.stroke();
    });
  }
  // a small surface: the cells of a coarse grid, lit and laid over the pixels as in the 3D graph
  // (surfacePaint, 1.9.2), seen as the 3D graph is at first
  function thumb3d(c, d) {
    const g = thumbContext(c), W = THUMB_W, H = THUMB_H, n = d.n || 19;
    const ca = Math.cos(VIEW3D.az), sa = Math.sin(VIEW3D.az), ce = Math.cos(VIEW3D.el), se = Math.sin(VIEW3D.el);
    const [x0, x1, y0, y1] = d.r.map(Number);
    const surf = d.f.map((f) => { const z = []; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = f(x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * j / (n - 1)); z.push(isFinite(v) ? v : NaN); } return z; });
    let z0 = Infinity, z1 = -Infinity;
    for (const z of surf) for (const v of z) if (v === v) { if (v < z0) z0 = v; if (v > z1) z1 = v; }
    if (!(z1 > z0)) { z0 -= 1; z1 += 1; }
    let EX = 1, EY = 1, EZ = ZS;
    if (d.eq) { const M = Math.max(x1 - x0, y1 - y0, z1 - z0); EX = (x1 - x0) / M; EY = (y1 - y0) / M; EZ = (z1 - z0) / M; }
    const EH = Math.hypot(EX, EY);
    const sc = Math.min((W - 4) / (2 * EH), (H - 4) / (2 * (EZ * Math.abs(ce) + EH * Math.abs(se))));
    const X = (i) => x0 + (x1 - x0) * i / (n - 1), Y = (j) => y0 + (y1 - y0) * j / (n - 1);
    const Uu = (x) => ((x - x0) / (x1 - x0) * 2 - 1) * EX, Vv = (y) => ((y - y0) / (y1 - y0) * 2 - 1) * EY, Ww = (v) => ((v - z0) / (z1 - z0) * 2 - 1) * EZ;
    // a corner of a triangle (as for the 3D graph, 1.9.2): screen x, y, depth, the normal in the camera's
    // axes, the color and the grid coordinates
    const many = d.f.length > 1 && !d.one;
    const vert = (x, y, v, nu, nv, nw, si) => {
      const u = Uu(x), vv = Vv(y), w = Ww(v), xr = u * ca - vv * sa, yr = u * sa + vv * ca;
      const t = Math.max(0, Math.min(1, (v - z0) / (z1 - z0)));
      const col = many ? hexRgb(COLORS[si % COLORS.length]).map((c3) => c3 * (0.6 + 0.4 * t)) : viridis(t);
      return [W / 2 + xr * sc, H / 2 - (w * ce + yr * se) * sc, yr * ce - w * se,
        nu * ca - nv * sa, nu * sa * se + nv * ca * se + nw * ce, nu * sa * ce + nv * ca * ce - nw * se,
        col[0], col[1], col[2], (x - x0) / (x1 - x0) * (n - 1), (y - y0) / (y1 - y0) * (n - 1)];
    };
    const tb = triBuf(null);
    surf.forEach((z, si) => {
      const f = d.f[si];
      const ok = (k) => z[k] === z[k];
      // the normal at a grid point, from the slopes to its neighbours (in the box's axes)
      const du = 2 * EX / (n - 1), dv = 2 * EY / (n - 1);
      const nrm = (k) => {
        const i = k % n, j = (k / n) | 0, il = i > 0 && ok(k - 1) ? i - 1 : i, ir = i < n - 1 && ok(k + 1) ? i + 1 : i;
        const jl = j > 0 && ok(k - n) ? j - 1 : j, jr = j < n - 1 && ok(k + n) ? j + 1 : j;
        const gu = ir > il ? (Ww(z[j * n + ir]) - Ww(z[j * n + il])) / ((ir - il) * du) : 0, gv = jr > jl ? (Ww(z[jr * n + i]) - Ww(z[jl * n + i])) / ((jr - jl) * dv) : 0;
        return [-gu, -gv, 1];
      };
      const vk = (k) => { const nn = nrm(k); return vert(X(k % n), Y((k / n) | 0), z[k], nn[0], nn[1], nn[2], si); };
      // the edge of the real values (a sphere, 1.8.3): on a cell side from a corner with a value to one
      // without, the last point with a value, found by halving (as refineRims does for the 3D graph),
      // so that the two halves of a sphere meet instead of leaving a torn band between them; there the
      // surface stands upright (its normal is level)
      const rim = (ka, kb) => {
        const xa = X(ka % n), ya = Y(Math.floor(ka / n)), xb = X(kb % n), yb = Y(Math.floor(kb / n));
        let lo = 0, hi = 1;
        for (let it = 0; it < 20; it++) { const m = (lo + hi) / 2; if (isFinite(f(xa + (xb - xa) * m, ya + (yb - ya) * m))) lo = m; else hi = m; }
        const x = xa + (xb - xa) * lo, y = ya + (yb - ya) * lo, nn = nrm(ka), h = Math.hypot(nn[0], nn[1]);
        return h > 0.05 ? vert(x, y, f(x, y), nn[0] / h, nn[1] / h, 0, si) : vert(x, y, f(x, y), Uu(xb) - Uu(xa), Vv(yb) - Vv(ya), 0, si);
      };
      for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
        const ks = [j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i];
        const real = ks.filter(ok).length;
        if (!real) continue;
        const poly = [];
        ks.forEach((k, m) => {
          const k2 = ks[(m + 1) % 4];
          if (ok(k)) poly.push(vk(k));
          if (ok(k) !== ok(k2) && real < 4) poly.push(ok(k) ? rim(k, k2) : rim(k2, k));
        });
        for (let m = 1; m + 1 < poly.length; m++) tb.add(poly[0], poly[m], poly[m + 1]);
      }
    });
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    surfacePaint(g, tb, { W, H, q: dpr, dark: document.documentElement.classList.contains('dark'), mesh: [0, 0, 0, 0.16, 0.5], fade: null, cache: null });
  }
  // the row of samples; run(sample) draws one
  function buildSamples(defs, is3d, run) {
    const row = el('div', { class: 'samples', role: 'group', 'aria-label': tr('Samples', 'サンプル') });
    for (const d of defs) {
      const c = el('canvas', { 'aria-hidden': 'true' });
      const b = tapButton({ class: 'sample', title: d.t }, () => {
        for (const x of row.children) x.classList.toggle('on', x === b);
        run(d);
      });
      b.append(c, el('span', { text: d.t }));
      row.append(b);
      try { (is3d ? thumb3d : thumb2d)(c, d); } catch (e) { /* a picture is not needed to use the sample */ }
    }
    const wrap = el('div', { class: 'smp-wrap' }, el('div', { class: 'smp-cap', text: tr('Samples (tap one to draw it)', 'サンプル（タップすると描きます）') }), row);
    wrap.clearChoice = () => { for (const x of row.children) x.classList.remove('on'); };
    return wrap;
  }
  function drawSample2d(d) {
    openPlotWith(sampleExprs(d), { range: d.r, equal: !!d.eq, sample: true });
  }
  function drawSample3d(d) {
    Q3.ta.value = sampleExprs(d).join('\n');
    Q3.inputs.forEach((e, i) => { e.value = d.r[i]; });
    if (Q3.resEl) Q3.resEl.value = d.res || '41';
    Q3.points = null; Q3.pending = null;
    Q3.equalOnce = !!d.eq; // round for this drawing; the 1:1 setting itself stays as it was
    // "Volume and surface" measures over the region that fits the sample (a disk for a sphere)
    const U = Q3.volUI;
    if (U) { U.setRegion(d.disk ? 'disk' : 'rect', true); if (d.disk) U.R.value = d.disk; }
    Q3.keep = true;
    Q3.go.click();
  }

  // ----------------------------------------------------------- 3D plot
  // z = f(x, y). The engine computes the values on a grid (plot3d); the page lays the surfaces over
  // the pixels itself with a depth buffer (surfacePaint, 1.9.2; until 1.9.1 the cells were painted
  // from back to front) on a 2D canvas, so no WebGL is needed.
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
    const ta = el('textarea', { rows: 2, placeholder: tr('Functions (one per line, up to 4, variables x and y)', '関数（1行に1つ、最大4つ。変数は x と y）'), spellcheck: 'false', autocapitalize: 'off' });
    ta.value = store.get('qalc.plot3d.exprs', 'sin(x) cos(y)');
    const input = (key, def) => el('input', { value: store.get(key, def), inputmode: 'text', autocapitalize: 'off' });
    const xmin = input('qalc.plot3d.xmin', '-5'), xmax = input('qalc.plot3d.xmax', '5');
    const ymin = input('qalc.plot3d.ymin', '-5'), ymax = input('qalc.plot3d.ymax', '5');
    const res = el('select', { 'aria-label': tr('Grid', '細かさ') },
      el('option', { value: '25', text: tr('Coarse (25×25)', '粗い（25×25）') }), el('option', { value: '41', text: tr('Normal (41×41)', '標準（41×41）') }), el('option', { value: '61', text: tr('Fine (61×61)', '細かい（61×61）') }));
    res.value = String(store.get('qalc.plot3d.res', '41'));
    if (!res.value) res.value = '41';
    const go = el('button', { class: 'btn primary', text: tr('Draw', '描画') });
    const canvas = el('canvas', { role: 'img', 'aria-label': tr('3D graph', '3D グラフ') });
    const tip = el('div', { class: 'plot-tip', 'aria-live': 'polite' });
    const ctl = el('div', { class: 'plot-ctl' },
      el('button', { text: '+', 'aria-label': tr('Zoom in', '拡大'), onclick: () => zoom3d(1.25) }),
      el('button', { text: '−', 'aria-label': tr('Zoom out', '縮小'), onclick: () => zoom3d(0.8) }),
      el('button', { text: '⟲', 'aria-label': tr('Reset the view', '向きと大きさを戻す'), onclick: () => { Object.assign(Q3, VIEW3D); clearMark3d(); draw3d(); } }),
      Q3.eqBtn = el('button', { class: 'eq', text: '1:1', 'aria-label': tr('The same scale on the x, y and z axes', 'x・y・z の目盛りの間隔をそろえる'), onclick: () => { setEqual3d(!Q3.equalNow); clearMark3d(); draw3d(); } }));
    // (the choice made with 1:1 for the functions it was made for; a value saved before 1.9.3 for all
    // graphs, true or false, counts as no choice)
    const eq = store.get('qalc.plot3d.equal', 'auto');
    Q3.equal = eq && typeof eq === 'object' && typeof eq.on === 'boolean' && typeof eq.exprs === 'string' ? eq : 'auto';
    const wrap = el('div', { class: 'plot-wrap' }, canvas, ctl, tip);
    const legend = el('div', { class: 'legend' });
    const msg = el('div', { class: 'form-hint' });
    Object.assign(Q3, { canvas, tip, legend, msg, ta, go, inputs: [xmin, xmax, ymin, ymax], resEl: res });
    const read = () => {
      Q3.exprs = plotExprs(ta.value, 4);
      Q3.range = [xmin, xmax, ymin, ymax].map((e) => normalizeExpr(e.value));
      Q3.res = Number(res.value) || 41;
    };
    go.addEventListener('click', () => {
      if (!Q3.keep) {
        Q3.points = null; Q3.pending = null; // they belong to the graph they were made for
        // the round shape of a sample or a sphere (1:1) and the marked sample stay while the same
        // surfaces are drawn again with another grid or range; other surfaces drop them (1.8.3)
        if (plotExprs(ta.value, 4).join('\n') !== Q3.exprs.join('\n')) { Q3.equalOnce = false; if (Q3.samples) Q3.samples.clearChoice(); }
      }
      Q3.keep = false;
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
      else msg.textContent = tr('Press "Draw" to draw the graph', '「描画」を押すとグラフを描きます');
    };
    return el('div', { class: 'plot-mode' },
      el('div', { class: 'plot-form' }, ta,
        el('div', { class: 'ranges3d' },
          el('div', { class: 'plot-range' }, el('span', { text: tr('x:', 'x：') }), xmin, el('span', { text: tr('to', '〜') }), xmax),
          el('div', { class: 'plot-range' }, el('span', { text: tr('y:', 'y：') }), ymin, el('span', { text: tr('to', '〜') }), ymax)),
        el('div', { class: 'plot-range' }, el('span', { text: tr('Grid:', '細かさ：') }), res, go)),
      wrap, legend, msg, el('div', { class: 'tools' }, buildPartial3d(), buildVolume3d()), Q3.samples = buildSamples(SAMPLES3D, true, drawSample3d),
      el('div', { class: 'form-hint', text: tr('Drag to rotate, pinch to zoom, tap to show the coordinates. The range of z is chosen automatically (extremely large values are not drawn).', 'ドラッグで回転、2本指で拡大・縮小、タップで座標を表示します。z の範囲は自動で決まります（極端に大きな値の部分は描きません）。') }));
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
  // The 3D graph of surfaces and points from elsewhere (a matrix: planes of a linear system, rows as
  // points). opts: points [{x, y, z, label}], range [x0, x1, y0, y1]. 3D graphs are a QCalc Pro feature.
  function openPlot3dWith(exprs, opts) {
    if (!hasPro()) { proPrompt(tr('3D graphs are a QCalc Pro feature', '3D グラフは QCalc Pro の機能です')); return; }
    opts = opts || {};
    if (Q3.samples) Q3.samples.clearChoice(); // (another graph than a sample, 1.8.2)
    const list = exprs.filter(Boolean).slice(0, 4);
    store.set('qalc.plot3d.exprs', list.join('\n'));
    if (opts.range) ['xmin', 'xmax', 'ymin', 'ymax'].forEach((k, i) => store.set('qalc.plot3d.' + k, String(opts.range[i])));
    store.set('qalc.plot.mode', '3d');
    store.set('qalc.plot3d.ok', true);
    Q3.points = opts.points || null;
    Q3.equalOnce = !!opts.equal;
    Q3.pending = null;
    const built = !!panels.plot;
    openPlot();
    if (built && Q3.ta) {
      Q3.ta.value = list.join('\n');
      if (opts.range) Q3.inputs.forEach((e, i) => { e.value = String(opts.range[i]); });
      P.setMode('3d');
      Q3.keep = true;
      Q3.go.click();
    }
  }
  // the box of the graph around points only (no surface)
  function points3dData() {
    const ps = Q3.points;
    const lo = (k) => Math.min(...ps.map((p) => p[k])), hi = (k) => Math.max(...ps.map((p) => p[k]));
    const pad = (a, b) => { const m = (b - a) * 0.15 || 1; return [a - m, b + m]; };
    const [x0, x1] = pad(lo('x'), hi('x')), [y0, y1] = pad(lo('y'), hi('y')), [z0, z1] = pad(lo('z'), hi('z'));
    return { xs: [x0, x1], ys: [y0, y1], nx: 2, ny: 2, series: [], z0, z1 };
  }
  async function compute3d() {
    if (!Q3.exprs.length && Q3.points && Q3.points.length) {
      Q3.data = points3dData();
      Q3.legend.textContent = '';
      Q3.legend.append(el('span', { style: '--c:' + COLORS[0], text: tr('Points: ', '点：') + Q3.points.length }));
      Q3.msg.textContent = '';
      clearMark3d();
      draw3d();
      return;
    }
    if (!Q3.exprs.length) { Q3.msg.textContent = tr('Enter a function (for example sin(x) cos(y)), or tap a sample', '関数を入れてください（例：sin(x) cos(y)）。下のサンプルもタップで描けます'); return; }
    Q3.msg.textContent = tr('Calculating…', '計算中…');
    // (the 1:1 chosen for other functions is dropped: these are automatic until 1:1 is pressed, 1.9.3)
    if (Q3.equal && Q3.equal.exprs !== undefined && Q3.equal.exprs !== Q3.exprs.join('\n')) { Q3.equal = 'auto'; store.set('qalc.plot3d.equal', 'auto'); }
    clearVolume();
    const seq = Q3.seq = (Q3.seq || 0) + 1;
    const [x0, x1, y0, y1] = Q3.range;
    const r = await Bridge.send('plot3d', { exprs: Q3.exprs, xmin: x0 || '-5', xmax: x1 || '5', ymin: y0 || '-5', ymax: y1 || '5', nx: Q3.res, ny: Q3.res, opts: engineOpts(), timeout: 15000 });
    if (!r.ok && /^invalid [xy] range$/.test(r.error || '') && !Q3.swapped) {
      const k = r.error === 'invalid x range' ? 0 : 2;
      const a = await numValue(Q3.range[k] || '-5'), b = await numValue(Q3.range[k + 1] || '5');
      if (seq === Q3.seq && isFinite(a) && isFinite(b) && a > b) {
        const t = Q3.inputs[k].value; Q3.inputs[k].value = Q3.inputs[k + 1].value; Q3.inputs[k + 1].value = t;
        const q = Q3.range[k]; Q3.range[k] = Q3.range[k + 1]; Q3.range[k + 1] = q;
        ['xmin', 'xmax', 'ymin', 'ymax'].forEach((n, i) => store.set('qalc.plot3d.' + n, Q3.inputs[i].value));
        Q3.swapped = true;
        try { await compute3d(); } finally { Q3.swapped = false; }
        return;
      }
    }
    if (!r.ok) {
      Q3.msg.textContent = r.error === 'invalid x range' ? tr('Check the range of x', 'x の範囲を確認してください') : r.error === 'invalid y range' ? tr('Check the range of y', 'y の範囲を確認してください') : (localMessage(r.error) || tr('Could not calculate the graph', 'グラフを計算できませんでした'));
      return;
    }
    if (!Array.isArray(r.series) || !Array.isArray(r.x) || !Array.isArray(r.y)) { Q3.msg.textContent = tr('The calculation took too long and was stopped', '時間がかかりすぎたため計算を中止しました'); return; }
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
    for (const p of Q3.points || []) vals.push(p.z);
    const [z0, z1] = zRange3d(vals);
    const data = { xs: r.x, ys: r.y, nx, ny, series, z0, z1 };
    solidColors(data);
    const err = (r.messages || []).find((m) => m.type === 'error');
    const note = err ? localMessage(err.text)
      : series.some((s) => !s.complete) ? tr('The calculation took too long: only part of the graph was calculated', '時間がかかりすぎたため、途中までしか計算できませんでした')
      : !vals.length ? tr('There are no real values (check the expression and the ranges of x and y)', '実数の値がありません（式と、x と y の範囲を確認してください）')
      : plotNote(null, Q3.exprs, series.filter((q) => !q.z.some((v) => v === v)).map((q) => q.expr), 4, true);
    let shown = false;
    const show = () => {
      if (shown || seq !== Q3.seq) return;
      shown = true;
      Q3.data = data;
      clearMark3d();
      Q3.msg.textContent = note;
      legend3d(data, vals.length > 0);
      if (Q3.volUI && !Q3.volUI.box.hidden) volumeSurfacesChanged();
      if (Q3.partUI && !Q3.partUI.box.hidden) partialSurfacesChanged();
      store.set('qalc.plot3d.ok', false);
      draw3d();
      store.set('qalc.plot3d.ok', true);
    };
    // A surface with an edge (a sphere) is shown when its edge has been found (refineRims), and one
    // that leaves the box when the places where it does are found (refineClips, 1.9.5), so that it
    // does not appear torn first and whole a moment later. If that takes more than 2.5 seconds, the
    // surface is shown as it is and drawn again afterwards.
    const late = setTimeout(show, 2500);
    const refined = await refineRims(series, r.x, r.y, seq);
    if (seq !== Q3.seq) { clearTimeout(late); return; }
    // (surfaces that close up into one solid are known when their edges are, 1.9.3)
    data.groups = refined ? joinedSolid(series, r.x, r.y, z0, z1) : [];
    solidColors(data);
    // the range of z reaches the edges that were found (half a sphere alone: its rim at z = 0 lies
    // below the lowest grid value, and was cut off; 1.9.3), unless that would widen it by more than half
    if (refined) {
      let lo = data.z0, hi = data.z1;
      for (const s of series) for (const key in s.rim || {}) { const v = s.rim[key].z; if (v === v && v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      if ((lo < data.z0 || hi > data.z1) && hi - lo <= 1.5 * (data.z1 - data.z0)) { data.z0 = lo; data.z1 = hi; }
    }
    // where the surfaces leave the box at its top or bottom (1.9.5)
    const clipped = await refineClips(series, r.x, r.y, data.z0, data.z1, seq);
    clearTimeout(late);
    if (seq !== Q3.seq) return;
    if (shown) { if (refined || clipped) { legend3d(data, vals.length > 0); draw3d(); } } else show();
    if (Q3.pending) { const run = Q3.pending; Q3.pending = null; run(); }
  }
  // The legend of the 3D graph: for one surface, or surfaces that all close up into one solid (1.9.3),
  // the function(s) and the colors of the heights; otherwise each function in its color, and the
  // surfaces of a solid together in its one color (1.9.5).
  function legend3d(data, any) {
    const series = data.series;
    Q3.legend.textContent = '';
    if (data.oneSolid && any) {
      const step = niceStep(data.z1 - data.z0, 4);
      Q3.legend.append(el('span', { class: 'zbar' }, series.map((s) => s.expr).join(tr(', ', '、')) + tr('   z: ', '　z：') + fmt(data.z0, step / 10), el('i'), fmt(data.z1, step / 10)));
      return;
    }
    const done = new Set();
    series.forEach((s, i) => {
      if (done.has(i)) return;
      const g = (data.groups || []).find((m) => m.includes(i));
      if (g) {
        g.forEach((m) => done.add(m));
        Q3.legend.append(el('span', { style: '--c:' + s.color, text: g.map((m) => series[m].expr).join(tr(', ', '、')) }));
      } else {
        Q3.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.z.some((v) => v === v) ? '' : tr(' (no values)', '（値なし）')) }));
      }
    });
  }
  // Which surfaces close up into a solid, as the two halves of a sphere or of a doughnut do? Each of
  // them ends at an edge (refineRims), and most of its edge points are those of the other surfaces of
  // the solid, at the same place and height (1.9.3). A solid is drawn as one object, whatever other
  // surfaces are drawn with it (1.9.5: until then, adding ∂f/∂x to a sphere made it two-colored
  // again). Gives the solids as lists of the numbers of their surfaces.
  function joinedSolid(series, xs, ys, z0, z1) {
    if (series.length < 2) return [];
    const rx = Math.abs(xs[xs.length - 1] - xs[0]) || 1, ry = Math.abs(ys[ys.length - 1] - ys[0]) || 1, tz = 0.02 * (z1 - z0);
    const up = series.map((s, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
    const whole = series.map((s, i) => {
      const keys = s.rim ? Object.keys(s.rim).filter((k) => s.rim[k].z === s.rim[k].z && s.rim[k].z !== undefined) : [];
      if (keys.length < 4) return false;
      const by = series.map(() => 0);
      let met = 0;
      for (const k of keys) {
        const e = s.rim[k];
        let any = false;
        series.forEach((o, j) => {
          if (j !== i && o.rim && o.rim[k] && Math.abs(o.rim[k].z - e.z) <= tz && Math.abs(o.rim[k].x - e.x) / rx + Math.abs(o.rim[k].y - e.y) / ry < 2e-3) { by[j]++; any = true; }
        });
        if (any) met++;
      }
      // (joined to each surface that has a fair share of its edge)
      by.forEach((c, j) => { if (c >= 0.2 * keys.length) up[find(i)] = find(j); });
      return met >= 0.8 * keys.length;
    });
    const groups = new Map();
    series.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    return [...groups.values()].filter((g) => g.length >= 2 && g.every((i) => whole[i]));
  }
  // The colors of the surfaces (1.9.5): one surface alone, or surfaces that all make one solid, are
  // colored by height (oneSolid); the surfaces of a solid drawn with others share the color of its
  // first surface (drawRgb); the rest keep their own.
  function solidColors(data) {
    const series = data.series, groups = data.groups || [];
    data.oneSolid = series.length === 1 || (groups.length === 1 && groups[0].length === series.length);
    series.forEach((s, i) => { const g = groups.find((m) => m.includes(i)); s.drawRgb = g ? series[g[0]].rgb : s.rgb; s.drawColor = g ? series[g[0]].color : s.color; });
  }
  // Where a surface leaves the box, above z1 or below z0. The cells with a corner beyond the range were
  // left out, so a steep surface ended in steps, which looked like spikes (∂f/∂x of a sphere,
  // −x/√(4 − x² − y²), rises without end toward its rim). On each grid line from a point inside the
  // range to one beyond it, or to an edge found by refineRims that lies beyond it, the place where the
  // surface reaches z1 or z0 is found by halving the step 12 times (all such lines at once, in one
  // calculation per step), and draw3d cuts the cells there, along the top or the bottom of the box
  // (1.9.5). Sets s.clip (key of the grid line → { x, y, z }, z being z0 or z1); false if nothing was
  // found or it could not be calculated.
  async function refineClips(series, xs, ys, z0, z1, seq) {
    // (a little stricter than draw3d, which keeps points up to 1/20000 of the range beyond it)
    const nx = xs.length, ny = ys.length, jobs = [], tol = (z1 - z0) * 4e-5;
    const inR = (v) => v === v && v >= z0 - tol && v <= z1 + tol;
    series.forEach((s, si) => {
      s.clip = null;
      const z = s.z;
      const add = (key, ka, kb) => {
        const a = inR(z[ka]), b = inR(z[kb]);
        if (a === b) return;
        const p = a ? ka : kb, q = a ? kb : ka;
        let qx = xs[q % nx], qy = ys[(q / nx) | 0], zq = z[q];
        if (!(zq === zq)) {
          // (no value beyond: the edge found by refineRims, when its height is beyond the range)
          const e = s.rim && s.rim[key];
          if (!e || !(e.z === e.z) || e.z === undefined || inR(e.z)) return;
          qx = e.x; qy = e.y; zq = e.z;
        }
        jobs.push({ si, key, px: xs[p % nx], py: ys[(p / nx) | 0], zp: z[p], qx, qy, zq, top: zq > z1 });
      };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i + 1 < nx) add('h' + k, k, k + 1);
        if (j + 1 < ny) add('v' + k, k, k + nx);
      }
    });
    if (!jobs.length || jobs.length > 2400) return false;
    const opts = Object.assign(engineOpts(), { approx: 'approx', precision: 12, grouping: false, complex: 'rect', base: 10, notation: 'auto', max_decimals: -1 });
    const B = 300;
    for (let step = 0; step < 12; step++) {
      for (let b0 = 0; b0 < jobs.length; b0 += B) {
        const part = jobs.slice(b0, b0 + B);
        const mids = part.map((jb) => [(jb.px + jb.qx) / 2, (jb.py + jb.qy) / 2]);
        const expr = '[' + part.map((jb, n) => '(' + subXY(series[jb.si].expr, engineNum(mids[n][0]), engineNum(mids[n][1])) + ')').join(', ') + ']';
        const r = await Bridge.send('calc', { expr, opts, timeout: 5000, max_chars: 200000 });
        if (seq !== Q3.seq || !r.ok || !r.result || r.timeout) return false;
        const t = r.result.split(' ≈ ').pop().split(' = ').pop().trim();
        if (t[0] !== '[' || t[t.length - 1] !== ']') return false;
        const cells = t.slice(1, -1).trim().split(/\s{2,}/);
        if (cells.length !== part.length) return false;
        part.forEach((jb, n) => {
          const v = Number(cells[n].replace(/−/g, '-'));
          if (inR(v)) { jb.px = mids[n][0]; jb.py = mids[n][1]; jb.zp = v; } else { jb.qx = mids[n][0]; jb.qy = mids[n][1]; jb.zq = isFinite(v) ? v : NaN; }
        });
      }
    }
    for (const jb of jobs) {
      const s = series[jb.si], zt = jb.top ? z1 : z0;
      // (between the last point inside and the first beyond, where the straight line reaches the range)
      const f = jb.zq === jb.zq && jb.zq !== jb.zp ? Math.max(0, Math.min(1, (zt - jb.zp) / (jb.zq - jb.zp))) : 0;
      if (!s.clip) s.clip = {};
      s.clip[jb.key] = { x: jb.px + f * (jb.qx - jb.px), y: jb.py + f * (jb.qy - jb.py), z: zt };
    }
    return true;
  }
  // The edge of a surface with no real values beyond it (a sphere: √(r² − x² − y²)). On each grid
  // line from a point with a value to one without, the last point with a real value is found by
  // halving the step 12 times (all such lines at once, in one calculation per step), so the drawing
  // reaches the edge, and the two halves of a sphere meet instead of leaving a torn band between them.
  async function refineRims(series, xs, ys, seq) {
    const nx = xs.length, ny = ys.length, jobs = [];
    series.forEach((s, si) => {
      const z = s.z, ok = (k) => z[k] === z[k];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (i + 1 < nx && ok(k) !== ok(k + 1)) jobs.push({ si, key: 'h' + k, p: ok(k) ? k : k + 1, q: ok(k) ? k + 1 : k });
        if (j + 1 < ny && ok(k) !== ok(k + nx)) jobs.push({ si, key: 'v' + k, p: ok(k) ? k : k + nx, q: ok(k) ? k + nx : k });
      }
    });
    if (!jobs.length || jobs.length > 2400) return false;
    for (const jb of jobs) {
      jb.px = xs[jb.p % nx]; jb.py = ys[(jb.p / nx) | 0]; jb.qx = xs[jb.q % nx]; jb.qy = ys[(jb.q / nx) | 0];
      jb.z = series[jb.si].z[jb.p];
    }
    // (plain decimal numbers whatever the settings of the results are: base 16 or 2 decimals, 1.8.3)
    const opts = Object.assign(engineOpts(), { approx: 'approx', precision: 12, grouping: false, complex: 'rect', base: 10, notation: 'auto', max_decimals: -1 });
    const B = 300;
    for (let step = 0; step < 12; step++) {
      for (let b0 = 0; b0 < jobs.length; b0 += B) {
        const part = jobs.slice(b0, b0 + B);
        const mids = part.map((jb) => [(jb.px + jb.qx) / 2, (jb.py + jb.qy) / 2]);
        const expr = '[' + part.map((jb, n) => '(' + subXY(series[jb.si].expr, engineNum(mids[n][0]), engineNum(mids[n][1])) + ')').join(', ') + ']';
        const r = await Bridge.send('calc', { expr, opts, timeout: 5000, max_chars: 200000 });
        if (seq !== Q3.seq || !r.ok || !r.result || r.timeout) return false;
        const t = r.result.split(' ≈ ').pop().split(' = ').pop().trim();
        if (t[0] !== '[' || t[t.length - 1] !== ']') return false;
        const cells = t.slice(1, -1).trim().split(/\s{2,}/);
        if (cells.length !== part.length) return false;
        part.forEach((jb, n) => {
          const v = Number(cells[n].replace(/−/g, '-'));
          if (isFinite(v)) { jb.px = mids[n][0]; jb.py = mids[n][1]; jb.z = v; } else { jb.qx = mids[n][0]; jb.qy = mids[n][1]; }
        });
      }
    }
    series.forEach((s) => { s.rim = {}; });
    for (const jb of jobs) series[jb.si].rim[jb.key] = { x: jb.px, y: jb.py, z: jb.z };
    return true;
  }
  // 1:1:1 — automatic: on when the three ranges are about as long as each other (a sphere, a cone),
  // off for flat surfaces over wide ranges. The button sets it on or off for the functions being drawn
  // ({ exprs, on }); other functions are automatic again (1.9.3: until 1.9.2 the choice held for every
  // graph, so after 1:1 was turned off once, every sphere came out flattened).
  function setEqual3d(on) {
    Q3.equal = { exprs: Q3.exprs.join('\n'), on: !!on };
    Q3.equalOnce = false;
    store.set('qalc.plot3d.equal', Q3.equal);
  }
  function equal3dNow(rx, ry, rz) {
    if (Q3.equalOnce) return true; // a sphere drawn from the examples
    if (Q3.equal && Q3.equal.exprs === Q3.exprs.join('\n')) return Q3.equal.on;
    const a = Math.max(rx, ry) / Math.min(rx, ry), b = rz / Math.max(rx, ry);
    return a <= 1.25 && b >= 0.6 && b <= 1.6;
  }
  function clearMark3d() { Q3.mark = null; if (Q3.tip) Q3.tip.style.display = 'none'; }
  function zoom3d(f) { Q3.zoom = Math.max(0.4, Math.min(6, Q3.zoom * f)); clearMark3d(); draw3d(); }
  function requestDraw3d() { if (!Q3.raf) Q3.raf = requestAnimationFrame(() => { Q3.raf = 0; draw3d(); }); }
  // ---- the solid that is measured by "Volume and surface" (1.8.4)
  const VOL_FADE = 0.5; // how far the parts that are not measured fade into the background
  // a CSS color (#rgb, #rrggbb or rgb()) as [r, g, b], or null
  const cssRgb = (s) => { let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return m[1].split('').map((h) => parseInt(h + h, 16)); m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return hexRgb(s); m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
  const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hslRgb = (h, s, l) => {
    const a = s * Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  };
  // Its color is chosen for each graph: the hue farthest from the colors of the surfaces in the
  // picture (the hues of the cells, weighted by how colorful they are; the measured surfaces count
  // twice), so that it stands out from them. Among equally good hues, the one farthest from every
  // color (the middle of the widest gap). The gelatin is a pale shade of it, and its skin a deep one (liquidPaint).
  function volumeColor(D, cells, single, dark, vf, vg) {
    const key = [dark, single, D.series.indexOf(vf), vg ? D.series.indexOf(vg) : -1].join();
    if (Q3.volColor && Q3.volColor.D === D && Q3.volColor.key === key) return Q3.volColor;
    const bins = new Float64Array(72);
    let total = 0;
    for (const q of cells) {
      const [r, gr, b] = single ? viridis(q.t) : q.s.drawRgb || q.s.rgb;
      const mx = Math.max(r, gr, b), c = mx - Math.min(r, gr, b);
      if (c < 10) continue; // grey: no hue
      let h = mx === r ? ((gr - b) / c) % 6 : mx === gr ? (b - r) / c + 2 : (r - gr) / c + 4;
      h = (h * 60 + 360) % 360;
      const w = (c / mx) * (q.s === vf || q.s === vg ? 2 : 1);
      bins[Math.floor(h / 5) % 72] += w; total += w;
    }
    let best = 350, bestP = Infinity, bestGap = -1;
    for (let h = 0; h < 360; h += 5) {
      let p = 0, gap = 180;
      for (let b = 0; b < 72; b++) {
        if (!bins[b]) continue;
        let d = Math.abs(h - (b * 5 + 2.5));
        if (d > 180) d = 360 - d;
        if (d < 75) p += bins[b] * (1 - d / 75) * (1 - d / 75);
        if (bins[b] > total * 0.01) gap = Math.min(gap, d);
      }
      if (p < bestP - total * 1e-6 || (p <= bestP + total * 1e-6 && gap > bestGap)) { bestP = p; best = h; bestGap = gap; }
    }
    // the gelatin in a pale (pastel) shade of the hue (the box in the panel); a deep one for the edge of
    // the box (the skin, 1.9.2) and a deeper one for the shadow
    const rgb = hslRgb(best, 0.7, dark ? 0.74 : 0.72), cs = rgb.join(','), ln = hslRgb(best, 0.75, dark ? 0.5 : 0.3).join(','), deep = hslRgb(best, 0.75, dark ? 0.58 : 0.52);
    return (Q3.volColor = { D, key, hue: best, rgb, css: 'rgb(' + cs + ')', swatch: 'rgba(' + cs + ',0.5)', deep, line: 'rgba(' + ln + ',0.9)' });
  }
  // ---- the surfaces as real, smooth surfaces (1.9.2)
  // The surfaces are laid over the pixels with a depth buffer instead of being painted cell by cell
  // from back to front, so that each pixel shows what is in front: where two surfaces meet or cross
  // (the two halves of a sphere at its rim, the inside of a doughnut) there are no saw teeth from
  // cells sorted as a whole. The normal is taken at every point of the grid (from the slopes) and
  // blended across each cell, so the light changes smoothly instead of in rings of flat cells, and
  // there are no seams between the cells. The surface is lit like a smooth, glossy object: light from
  // the sky above and less from the floor, a lamp at the upper left with a highlight, and a little of
  // the bright surroundings mirrored at a slant. The lines of the grid (a coarse grid) are drawn in
  // the same pass, so the ones that are hidden stay hidden. The edges are smoothed.
  // The triangles: 11 numbers for each corner (CV), x and y (CSS pixels), depth (larger is farther),
  // the normal in the camera's axes (x right, y up, z away from the eye; any length: it is blended in a
  // straight line across the triangle and then made of length 1), the color (r, g, b) and the grid
  // coordinates gi and gj (for the lines of the grid; NaN: no lines).
  const CV = 11, CT = 3 * CV;
  function triBuf(holder) {
    let a = holder && holder.triBuf;
    if (!a) { a = { f: new Float32Array(CT * 4096), n: 0 }; if (holder) holder.triBuf = a; }
    a.n = 0;
    a.add = function (p, q, r) {
      if ((this.n + 1) * CT > this.f.length) { const b = new Float32Array(this.f.length * 2); b.set(this.f); this.f = b; }
      this.f.set(p, this.n * CT); this.f.set(q, this.n * CT + CV); this.f.set(r, this.n * CT + 2 * CV); this.n++;
    };
    return a;
  }
  // tb: the triangles (triBuf); o: W and H of the canvas (CSS pixels), q (pixels of the layer for each
  // CSS pixel), dark, mesh (the color of the grid lines [r, g, b, alpha] and their width, or null), fade
  // (a color the surfaces fade halfway to, or null), cache (an object that keeps the buffers)
  function surfacePaint(g, tb, o) {
    const T = tb.f, nt = tb.n, q = o.q, none = { shown: 0, q };
    if (!nt) return none;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let v = 0; v < nt * 3; v++) {
      const x = T[v * CV], y = T[v * CV + 1];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
    // (the layer starts on a whole pixel of itself, so that with q equal to the device's pixels it
    // lies exactly on them)
    const lx0 = Math.max(0, Math.floor(Math.max(0, mnx) * q) - 2), ly0 = Math.max(0, Math.floor(Math.max(0, mny) * q) - 2);
    const lx1 = Math.min(Math.ceil(o.W * q), Math.ceil(mxx * q) + 2), ly1 = Math.min(Math.ceil(o.H * q), Math.ceil(mxy * q) + 2);
    if (!(lx1 > lx0 && ly1 > ly0)) return none;
    const LW = lx1 - lx0, LH = ly1 - ly0, NP = LW * LH;
    const C = o.cache || {};
    if (!C.surfBuf || C.surfBuf.n < NP) C.surfBuf = { n: NP, zb: new Float32Array(NP), id: new Int32Array(NP), b0: new Float32Array(NP), b1: new Float32Array(NP) };
    const { zb, id, b0, b1 } = C.surfBuf;
    zb.fill(Infinity, 0, NP); id.fill(-1, 0, NP);
    // the depth buffer: for each pixel the nearest triangle, and where in it (the weights of two corners)
    let t = 0, ad = 0, bd = 0, cd = 0;
    const px = (i, l0, l1, l2) => { const d = l0 * ad + l1 * bd + l2 * cd; if (d < zb[i]) { zb[i] = d; id[i] = t; b0[i] = l0; b1[i] = l1; } };
    const B = CV, C2 = 2 * CV;  // (where the second and the third corner start)
    for (t = 0; t < nt; t++) {
      const k = t * CT;
      ad = T[k + 2]; bd = T[k + B + 2]; cd = T[k + C2 + 2];
      rasterTri(T[k] * q - lx0, T[k + 1] * q - ly0, T[k + B] * q - lx0, T[k + B + 1] * q - ly0, T[k + C2] * q - lx0, T[k + C2 + 1] * q - ly0, LW, LH, px);
    }
    // the lines of the grid: how fast gi and gj change across the screen in each triangle (per pixel of
    // the layer), so that the lines have the same width everywhere and fade at the edges
    let GI = null;
    const mesh = o.mesh;
    if (mesh) {
      GI = new Float32Array(nt * 2);
      for (let s = 0; s < nt; s++) {
        const k = s * CT;
        const x0 = T[k] * q, y0 = T[k + 1] * q, ex1 = T[k + B] * q - x0, ey1 = T[k + B + 1] * q - y0, ex2 = T[k + C2] * q - x0, ey2 = T[k + C2 + 1] * q - y0;
        const det = ex1 * ey2 - ex2 * ey1;
        if (!(Math.abs(det) > 1e-9)) { GI[2 * s] = GI[2 * s + 1] = 0; continue; }
        for (let m = 0; m < 2; m++) {
          const f0 = T[k + 9 + m], f1 = T[k + B + 9 + m] - f0, f2 = T[k + C2 + 9 + m] - f0;
          const gx = (f1 * ey2 - f2 * ey1) / det, gy = (ex1 * f2 - ex2 * f1) / det;
          GI[2 * s + m] = Math.hypot(gx, gy);
        }
      }
    }
    // the light (camera's axes): a lamp at the upper left in front, the eye looking along +z
    const dark = !!o.dark;
    let Lx = -0.42, Ly = 0.62, Lz = -0.66;
    const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    let Hx = Lx, Hy = Ly, Hz = Lz - 1;
    const hl = Math.hypot(Hx, Hy, Hz); Hx /= hl; Hy /= hl; Hz /= hl;
    const AMB = dark ? 0.3 : 0.34, SKY = 0.08, DIF = dark ? 0.66 : 0.62, KS = dark ? 0.42 : 0.38, SH = 56;
    // (and a weaker light from the lower right in front, as from a bright floor, so that faces turned
    // down are not black)
    let Fx = 0.45, Fy = -0.45, Fz = -0.77;
    const fl = Math.hypot(Fx, Fy, Fz); Fx /= fl; Fy /= fl; Fz /= fl;
    const FILL = 0.22;
    const env = dark ? [150, 165, 190] : [236, 241, 250], ENV = dark ? 0.42 : 0.5;
    const fade = o.fade, FADE = VOL_FADE;
    const out = new ImageData(LW, LH), od = out.data;
    let shown = 0;
    const halfW = mesh ? mesh[4] * q / 2 : 0;
    for (let i = 0; i < NP; i++) {
      const s = id[i];
      if (s < 0) continue;
      const l0 = b0[i], l1 = b1[i], l2 = 1 - l0 - l1, k = s * CT;
      let nx = l0 * T[k + 3] + l1 * T[k + B + 3] + l2 * T[k + C2 + 3];
      let ny = l0 * T[k + 4] + l1 * T[k + B + 4] + l2 * T[k + C2 + 4];
      let nz = l0 * T[k + 5] + l1 * T[k + B + 5] + l2 * T[k + C2 + 5];
      let nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      if (nz > 0) nl = -nl;  // (both sides of a surface: the one turned to the eye)
      nx /= nl; ny /= nl; nz /= nl;
      let r = l0 * T[k + 6] + l1 * T[k + B + 6] + l2 * T[k + C2 + 6];
      let gg = l0 * T[k + 7] + l1 * T[k + B + 7] + l2 * T[k + C2 + 7];
      let b = l0 * T[k + 8] + l1 * T[k + B + 8] + l2 * T[k + C2 + 8];
      // diffuse light from the lamp, light from the sky (more on faces that look up), a highlight, and
      // the surroundings mirrored more at a slant (Fresnel)
      const dif = nx * Lx + ny * Ly + nz * Lz, nh = nx * Hx + ny * Hy + nz * Hz;
      const fil = nx * Fx + ny * Fy + nz * Fz;
      const kd = AMB + SKY * ny + DIF * (dif > 0 ? dif : 0) + FILL * (fil > 0 ? fil : 0);
      const sp = nh > 0 ? KS * Math.pow(nh, SH) * 255 : 0;
      const c = -nz, om = 1 - (c > 0 ? c : 0), fr = ENV * (0.04 + 0.96 * om * om * om * om * om);
      r = (r * kd) * (1 - fr) + env[0] * fr + sp; gg = (gg * kd) * (1 - fr) + env[1] * fr + sp; b = (b * kd) * (1 - fr) + env[2] * fr + sp;
      // the lines of the grid
      if (mesh) {
        const gi = l0 * T[k + 9] + l1 * T[k + B + 9] + l2 * T[k + C2 + 9], gj = l0 * T[k + 10] + l1 * T[k + B + 10] + l2 * T[k + C2 + 10];
        if (gi === gi) {
          const di = Math.abs(gi - Math.round(gi)), dj = Math.abs(gj - Math.round(gj));
          const pi = GI[2 * s] > 1e-6 ? di / GI[2 * s] : 1e9, pj = GI[2 * s + 1] > 1e-6 ? dj / GI[2 * s + 1] : 1e9;
          const dd = (pi < pj ? pi : pj) - halfW;
          if (dd < 1) {
            const a = mesh[3] * (dd <= 0 ? 1 : 1 - dd);
            r += (mesh[0] - r) * a; gg += (mesh[1] - gg) * a; b += (mesh[2] - b) * a;
          }
        }
      }
      if (fade) { r += (fade[0] - r) * FADE; gg += (fade[1] - gg) * FADE; b += (fade[2] - b) * FADE; }
      const o4 = i * 4;
      od[o4] = r; od[o4 + 1] = gg; od[o4 + 2] = b; od[o4 + 3] = 255;
      shown++;
    }
    // smoothing: a pixel with no surface between two with one (a hair-thin gap where two surfaces meet)
    // takes their color; a pixel at the edge against the background lets some of it through; where a
    // surface lies in front of another one, the two colors are blended across the edge
    const src = new Uint8ClampedArray(od);
    const NB = [0, 0, 0, 0];
    for (let y = 1; y < LH - 1; y++) {
      for (let x = 1; x < LW - 1; x++) {
        const i = y * LW + x, s = id[i];
        NB[0] = i - 1; NB[1] = i + 1; NB[2] = i - LW; NB[3] = i + LW;
        if (s < 0) {
          if ((id[i - 1] >= 0 && id[i + 1] >= 0) || (id[i - LW] >= 0 && id[i + LW] >= 0)) {
            let n = 0, r = 0, gg = 0, b = 0;
            for (let m = 0; m < 4; m++) { const j = NB[m]; if (id[j] >= 0) { r += src[j * 4]; gg += src[j * 4 + 1]; b += src[j * 4 + 2]; n++; } }
            od[i * 4] = r / n; od[i * 4 + 1] = gg / n; od[i * 4 + 2] = b / n; od[i * 4 + 3] = 255;
          }
          continue;
        }
        const z = zb[i];
        // (a far surface seen through a gap one pixel wide between two near ones: the gap takes their color)
        let cj = -1, ck = -1;
        if (id[i - 1] >= 0 && id[i + 1] >= 0 && zb[i - 1] < z - 0.04 && zb[i + 1] < z - 0.04) { cj = i - 1; ck = i + 1; }
        else if (id[i - LW] >= 0 && id[i + LW] >= 0 && zb[i - LW] < z - 0.04 && zb[i + LW] < z - 0.04) { cj = i - LW; ck = i + LW; }
        if (cj >= 0) {
          const o4 = i * 4;
          od[o4] = (src[cj * 4] + src[ck * 4]) / 2; od[o4 + 1] = (src[cj * 4 + 1] + src[ck * 4 + 1]) / 2; od[o4 + 2] = (src[cj * 4 + 2] + src[ck * 4 + 2]) / 2;
          continue;
        }
        let e = 0, n = 0, r = 0, gg = 0, b = 0;
        for (let m = 0; m < 4; m++) {
          const j = NB[m];
          if (id[j] < 0) { e++; continue; }
          const dz = zb[j] - z;
          // (an edge in front of another surface, or between two surfaces of different colors)
          let edge = dz > 0.04 || dz < -0.04;
          if (!edge && id[j] !== s) { const ka = s * CT + 6, kb = id[j] * CT + 6; edge = Math.abs(T[ka] - T[kb]) + Math.abs(T[ka + 1] - T[kb + 1]) + Math.abs(T[ka + 2] - T[kb + 2]) > 120; }
          if (edge) { r += src[j * 4]; gg += src[j * 4 + 1]; b += src[j * 4 + 2]; n++; }
        }
        if (n) {
          const w = 0.12 * n, o4 = i * 4;
          od[o4] = src[o4] * (1 - w) + r / n * w; od[o4 + 1] = src[o4 + 1] * (1 - w) + gg / n * w; od[o4 + 2] = src[o4 + 2] * (1 - w) + b / n * w;
        }
        if (e) od[i * 4 + 3] = 255 - 56 * e;
      }
    }
    const off = C.surfCanvas || (C.surfCanvas = document.createElement('canvas'));
    off.width = LW; off.height = LH;
    off.getContext('2d').putImageData(out, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(off, lx0 / q, ly0 / q, LW / q, LH / q);
    g.restore();
    return { shown, q };
  }
  // the slope at p0 (value w0) from the points on its two sides, [place, value] (a: before, b: after;
  // null if none): the parabola through the three, or the line to the one there is
  function parabolaSlope(p0, w0, a, b) {
    if (a && b) {
      const h1 = p0 - a[0], h2 = b[0] - p0;
      if (h1 > 1e-9 && h2 > 1e-9) return (-h2 / (h1 * (h1 + h2))) * a[1] + ((h2 - h1) / (h1 * h2)) * w0 + (h1 / (h2 * (h1 + h2))) * b[1];
    }
    if (b && b[0] - p0 > 1e-9) return (b[1] - w0) / (b[0] - p0);
    if (a && p0 - a[0] > 1e-9) return (w0 - a[1]) / (p0 - a[0]);
    return 0;
  }
  // the normal of a surface at the points of its grid (in the box's axes u, v, w), for the points with
  // st 1: the slopes from a parabola through the point and its two neighbours, or (where the surface
  // ends, as a sphere at its rim) through the edge that refineRims found, which keeps the steep slopes
  // near an edge right; one-sided where there is a neighbour on one side only
  function gridNormals(s, D, U, V, Wz) {
    const nx = D.nx, ny = D.ny, n = nx * ny, st = s.proj.st, w = s.proj.pw, xs = D.xs, ys = D.ys, rim = s.rim || {};
    const N = s.nrm && s.nrm.length === 3 * n ? s.nrm : (s.nrm = new Float32Array(3 * n));
    const slope = parabolaSlope;
    const fromRim = (key, along) => { const e = rim[key]; return e && e.z === e.z ? [along(e), Wz(e.z)] : null; };
    for (let k = 0; k < n; k++) {
      if (st[k] !== 1) continue;
      const i = k % nx, j = (k / nx) | 0, u0 = U(xs[i]), v0 = V(ys[j]);
      const L = i > 0 ? (st[k - 1] === 1 ? [U(xs[i - 1]), w[k - 1]] : fromRim('h' + (k - 1), (e) => U(e.x))) : null;
      const R = i < nx - 1 ? (st[k + 1] === 1 ? [U(xs[i + 1]), w[k + 1]] : fromRim('h' + k, (e) => U(e.x))) : null;
      const Dn = j > 0 ? (st[k - nx] === 1 ? [V(ys[j - 1]), w[k - nx]] : fromRim('v' + (k - nx), (e) => V(e.y))) : null;
      const Up = j < ny - 1 ? (st[k + nx] === 1 ? [V(ys[j + 1]), w[k + nx]] : fromRim('v' + k, (e) => V(e.y))) : null;
      const du = slope(u0, w[k], L, R), dv = slope(v0, w[k], Dn, Up);
      const l = Math.sqrt(du * du + dv * dv + 1);
      N[3 * k] = -du / l; N[3 * k + 1] = -dv / l; N[3 * k + 2] = 1 / l;
    }
    return N;
  }

  // ---- the light near the edge where a surface ends (1.9.3)
  // A sphere √(r² − x² − y²) ends at its rim, where it stands upright: near the rim its height rises
  // as the square root of the distance to the rim, and its normal turns from level to tilted within
  // the last cell. Blending the normals of the corners of that cell in a straight line (1.9.2) made
  // the light wrong by an amount that depended on how far each grid point happened to be from the rim,
  // which showed as streaks across the band next to the rim. The square of the height above the rim,
  // G = (w − w_rim)², changes smoothly there instead (on a sphere it is r² − x² − y²), so G and its
  // slopes can be blended across a cell in a straight line. For a surface that ends this way (tested
  // on the grid lines that cross its edge), the grid points within a few cells of the edge get the
  // normal (−∂G/∂u, −∂G/∂v, 2·|w − w_rim|) (turned to +w), and the cells there are cut into smaller
  // triangles whose corners are lifted to the height w_rim ± √G (draw3d, rimTri), so that near the rim
  // they lie on the rounded surface instead of on the flat cell below it. Sets s.rm
  // (G, the side of the edge and the level part at the grid points, or null) and, at the edge points
  // of s.rimP, G = 0, the side and the level part; improves s.nrm and s.cnrm at those grid points.
  // camN: from the box's axes to the camera's.
  function rimModel(s, D, U, V, camN) {
    s.rm = null;
    const rp = s.rimP, P = s.proj;
    if (!rp || !P) return null;
    const nx = D.nx, ny = D.ny, n = nx * ny, xs = D.xs, ys = D.ys, st = P.st, pw = P.pw;
    const keys = Object.keys(rp);
    if (keys.length < 4) return null;
    // (the grid point inside the surface on the grid line of an edge point, and the next one inward)
    const inner = (key) => {
      const ka = +key.slice(1), hz = key[0] === 'h', kb = hz ? ka + 1 : ka + nx;
      const kin = st[ka] === 1 ? ka : kb, k2 = 2 * kin - (kin === ka ? kb : ka);
      const ok2 = k2 >= 0 && k2 < n && st[k2] === 1 && (!hz || ((k2 / nx) | 0) === ((kin / nx) | 0));
      return { kin, k2: ok2 ? k2 : -1, hz };
    };
    // Does the surface end as a square root? Along a grid line into it from its edge, G grows in a
    // straight line, so G / d (d: the distance to the edge) is about the same at the first two grid
    // points; for a surface that ends at a slant, with its height in a straight line, G / d grows by
    // the ratio of the two distances. The test passes when it is nearer the first.
    let tested = 0, passed = 0;
    for (const key of keys) {
      const e = rp[key], { kin, k2, hz } = inner(key);
      if (k2 < 0) continue;
      const at = (k) => (hz ? U(xs[k % nx]) : V(ys[(k / nx) | 0]));
      const pe = hz ? e.u : e.v, d1 = Math.abs(at(kin) - pe), d2 = Math.abs(at(k2) - pe);
      if (!(d1 > 0.05 * (d2 - d1)) || !(d2 > d1)) continue;  // (an edge point too near a grid point says nothing)
      tested++;
      const h1 = pw[kin] - e.w, h2 = pw[k2] - e.w;
      if (!(h1 * h2 > 0 && Math.abs(h2) > Math.abs(h1))) continue;
      if (Math.abs(Math.log((h2 * h2 / d2) / (h1 * h1 / d1))) < 0.5 * Math.log(d2 / d1)) passed++;
    }
    if (tested < 4 || passed < 0.7 * tested) return null;
    // the height of the edge near each grid point: the edge points within RM cells, weighted by
    // 1 / distance² (on a sphere the rim lies at one height; elsewhere it may change along the edge)
    const RM = 3, zs = new Float64Array(n), ws = new Float64Array(n);
    for (const key of keys) {
      const e = rp[key], i0 = Math.round(e.gi), j0 = Math.round(e.gj);
      for (let j = Math.max(0, j0 - RM); j <= Math.min(ny - 1, j0 + RM); j++) {
        for (let i = Math.max(0, i0 - RM); i <= Math.min(nx - 1, i0 + RM); i++) {
          const k = j * nx + i, dd = (i - e.gi) * (i - e.gi) + (j - e.gj) * (j - e.gj);
          if (st[k] !== 1 || dd > RM * RM) continue;
          const wt = 1 / (dd + 0.01);
          zs[k] += wt * e.w; ws[k] += wt;
        }
      }
    }
    const G = new Float32Array(n).fill(-1), SG = new Int8Array(n), GU = new Float32Array(n), GV = new Float32Array(n), ZR = new Float32Array(n);
    const N = s.nrm, CN = s.cnrm;
    for (let k = 0; k < n; k++) {
      if (!(ws[k] > 0)) continue;
      const zr = zs[k] / ws[k], h = pw[k] - zr;
      if (!(h !== 0)) continue;
      const i = k % nx, j = (k / nx) | 0, sq = (w) => (w - zr) * (w - zr);
      // the neighbours on the four sides: grid points with a value, or the edge points between
      const side = (kk, place, key) => (st[kk] === 1 ? [place, sq(pw[kk])] : rp[key] ? [key[0] === 'h' ? rp[key].u : rp[key].v, sq(rp[key].w)] : null);
      const Lf = i > 0 ? side(k - 1, U(xs[i - 1]), 'h' + (k - 1)) : null, Rt = i < nx - 1 ? side(k + 1, U(xs[i + 1]), 'h' + k) : null;
      const Dn = j > 0 ? side(k - nx, V(ys[j - 1]), 'v' + (k - nx)) : null, Up = j < ny - 1 ? side(k + nx, V(ys[j + 1]), 'v' + k) : null;
      const gu = parabolaSlope(U(xs[i]), h * h, Lf, Rt), gv = parabolaSlope(V(ys[j]), h * h, Dn, Up);
      const sg = h > 0 ? 1 : -1;
      G[k] = h * h; SG[k] = sg; GU[k] = -sg * gu; GV[k] = -sg * gv; ZR[k] = zr;
      // the normal at the point (+w), in the box's axes and in the camera's
      const nu = -sg * gu, nv = -sg * gv, nw = 2 * Math.abs(h), l = Math.hypot(nu, nv, nw) || 1;
      N[3 * k] = nu / l; N[3 * k + 1] = nv / l; N[3 * k + 2] = nw / l;
      const c3 = camN(nu / l, nv / l, nw / l);
      CN[3 * k] = c3[0]; CN[3 * k + 1] = c3[1]; CN[3 * k + 2] = c3[2];
    }
    // the edge points: G = 0, and the level part from the slopes of G, carried on in a straight line
    // from the two grid points inside on the same grid line (G changes smoothly; on a sphere its slopes
    // change in a straight line, so this is exact), or from the one there is
    for (const key of keys) {
      const e = rp[key], { kin, k2, hz } = inner(key);
      if (!(G[kin] >= 0)) continue;
      let gu = GU[kin], gv = GV[kin];
      if (k2 >= 0 && G[k2] >= 0 && SG[k2] === SG[kin]) {
        const at = (k) => (hz ? U(xs[k % nx]) : V(ys[(k / nx) | 0]));
        const t = (at(kin) - (hz ? e.u : e.v)) / (at(k2) - at(kin));  // (how far beyond kin, in steps from k2 to kin)
        if (t >= 0 && t < 1.5) { gu += t * (GU[kin] - GU[k2]); gv += t * (GV[kin] - GV[k2]); }
      }
      const h = Math.hypot(gu, gv);
      e.G = 0; e.sg = SG[kin]; e.L = camN(gu, gv, 0); e.zr = e.w;
      if (h > 1e-9) e.n = camN(gu / h, gv / h, 0);
    }
    return (s.rm = { G, SG, ZR, L: (k) => camN(GU[k], GV[k], 0) });
  }

  // ---- the measured solid as a real liquid (1.9.1), a pale gelatin in a deep-colored skin (1.9.2)
  // While "Volume and surface" is open, the solid that is measured looks like a pale gelatin held by a
  // clear, glossy skin of a deeper shade of the same color: its top (the measured part of the
  // surface), its side walls and its floor. It is traced for every pixel instead of being painted face
  // by face: a closed mesh of the solid is laid over the pixels with the depth of every face it
  // crosses, so that the thickness of gelatin along each line of sight is known, and the other
  // surfaces in front of it hide it. As in a real gelatin, the light is absorbed a little on its way
  // (Beer–Lambert) and scattered in its pale color, more where it is thicker; the skin is thin and
  // clear where it is looked at straight and deep in color at a slant, where the line of sight goes
  // through more of it, so that the outline of the solid shows in the deep color; it mirrors a bright
  // room (a sky above, a floor below, a large soft lamp and a sharp glint), more at a slant (Fresnel);
  // and what lies behind is seen bent (refraction).

  // The mesh: the cells of the grid inside the region, cut along the circle of a disk and along the
  // edge found for a surface that ends (a sphere, refineRims), each with a face on sheet A (the
  // measured surface) and on sheet B (the second surface, or the floor z = 0), and walls where the
  // region ends. Neighbouring cells share their points, so that the mesh has no gaps: every line of
  // sight goes in and out of the liquid by turns. Values outside the box are taken at its top or
  // bottom. The normals of the sheets come from the slopes at the grid points (a smooth surface).
  function liquidMesh(D, VS, vf, vg, M) {
    const { U, V, Wz, EZ } = M, xs = D.xs, ys = D.ys, nx = D.nx, ny = D.ny, n = nx * ny;
    const cw = (z) => Math.max(-EZ, Math.min(EZ, Wz(z)));
    const real = (z) => z !== null && z !== undefined && z === z;
    const R2 = VS.disk ? VS.R * VS.R : Infinity, w0 = cw(0);
    const okA = new Uint8Array(n), okB = new Uint8Array(n), inside = new Uint8Array(n);
    const wa = new Float64Array(n), wb = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const za = vf.z[k], zb = vg ? vg.z[k] : 0, x = xs[k % nx], y = ys[(k / nx) | 0];
      okA[k] = real(za) ? 1 : 0; okB[k] = real(zb) ? 1 : 0;
      if (okA[k]) wa[k] = cw(za);
      if (okB[k]) wb[k] = vg ? cw(zb) : w0;
      inside[k] = okA[k] && okB[k] && x * x + y * y <= R2 ? 1 : 0;
    }
    // the normal of a sheet at a grid point: the one found for the surface (gridNormals, 1.9.2: a
    // parabola through the neighbours or the rim) where the point is in the box; otherwise from the
    // slopes to its neighbours (all of length 1, so that they mix evenly along a face)
    const gridNormal = (w, ok, k) => {
      const sv = w === wa ? vf : vg, sn = sv && sv.nrm, sst = sv && sv.proj && sv.proj.st;
      if (sn && sst && sst[k] === 1 && sn.length === 3 * n) return [sn[3 * k], sn[3 * k + 1], sn[3 * k + 2]];
      const i = k % nx, j = (k / nx) | 0;
      const il = i > 0 && ok[k - 1] ? i - 1 : i, ir = i < nx - 1 && ok[k + 1] ? i + 1 : i;
      const jl = j > 0 && ok[k - nx] ? j - 1 : j, jr = j < ny - 1 && ok[k + nx] ? j + 1 : j;
      const du = ir > il ? (w[j * nx + ir] - w[j * nx + il]) / (U(xs[ir]) - U(xs[il])) : 0;
      const dv = jr > jl ? (w[jr * nx + i] - w[jl * nx + i]) / (V(ys[jr]) - V(ys[jl])) : 0, l = Math.sqrt(du * du + dv * dv + 1);
      return [-du / l, -dv / l, 1 / l];
    };
    const lerp = (a, b, t) => a + (b - a) * t, lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    // the points: x, y, the values on sheets A and B, and their normals
    const PX = [], PY = [], PA = [], PB = [], NA = [], NB = [];
    const add = (x, y, a, b, na, nb) => { PX.push(x); PY.push(y); PA.push(a); PB.push(b); NA.push(na); NB.push(nb); return PX.length - 1; };
    const gid = new Int32Array(n).fill(-1);
    const gridPoint = (k) => {
      if (gid[k] < 0) gid[k] = add(xs[k % nx], ys[(k / nx) | 0], wa[k], wb[k], gridNormal(wa, okA, k), vg ? gridNormal(wb, okB, k) : [0, 0, 1]);
      return gid[k];
    };
    // where a grid edge leaves the region: the nearest of the circle and the edges of the two surfaces
    const cuts = new Map();
    const cutPoint = (key, k1, k2) => {
      let c = cuts.get(key);
      if (c) return c;
      const p = inside[k1] ? k1 : k2, q = p === k1 ? k2 : k1;
      const xp = xs[p % nx], yp = ys[(p / nx) | 0], xq = xs[q % nx], yq = ys[(q / nx) | 0];
      const along = (e) => (xq !== xp ? (e.x - xp) / (xq - xp) : (e.y - yp) / (yq - yp));
      let t = 1, circ = false;
      if (xq * xq + yq * yq > R2) {
        const dx = xq - xp, dy = yq - yp, A = dx * dx + dy * dy, B = 2 * (xp * dx + yp * dy), C = xp * xp + yp * yp - R2;
        t = Math.max(0, Math.min(1, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A))); circ = true;
      }
      const rimA = !okA[q] ? (vf.rim && vf.rim[key]) || null : null, rimB = vg && !okB[q] ? (vg.rim && vg.rim[key]) || null : null;
      const tA = !okA[q] ? (rimA ? Math.max(0, Math.min(1, along(rimA))) : 0) : 2, tB = vg && !okB[q] ? (rimB ? Math.max(0, Math.min(1, along(rimB))) : 0) : 2;
      if (tA < t) { t = tA; circ = false; }
      if (tB < t) { t = tB; circ = false; }
      // the values at t: along the edge to the far end, or to the edge of the surface that was found
      const at = (w, ok, rim, tr, k) => (ok[q] ? lerp(w[p], w[q], t) : rim && tr > 0 ? lerp(w[p], cw(rim.z), Math.min(1, t / tr)) : w[p]);
      const a = at(wa, okA, rimA, tA), b = vg ? at(wb, okB, rimB, tB) : w0;
      // (where a surface ends, as a sphere at its rim, it stands upright: its normal is level, the way
      // the surface falls toward its edge)
      const level = (n) => { const h = Math.hypot(n[0], n[1]); return h > 0.05 ? [n[0] / h, n[1] / h, 0] : [U(xq) - U(xp), V(yq) - V(yp), 0]; };
      const na = okA[q] ? lerp3(gridNormal(wa, okA, p), gridNormal(wa, okA, q), t) : rimA ? level(gridNormal(wa, okA, p)) : gridNormal(wa, okA, p);
      const nb = !vg ? [0, 0, 1] : okB[q] ? lerp3(gridNormal(wb, okB, p), gridNormal(wb, okB, q), t) : rimB ? level(gridNormal(wb, okB, p)) : gridNormal(wb, okB, p);
      c = { id: add(lerp(xp, xq, t), lerp(yp, yq, t), a, b, na, nb), circ };
      cuts.set(key, c);
      return c;
    };
    const TV = [], TN = [], TK = [];   // triangles: 3 points (2 × point + sheet), 9 normal values, kind (1 A, 2 B, 3 wall)
    const tri = (v0, v1, v2, n0, n1, n2, kind) => { TV.push(v0, v1, v2); TN.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n2[0], n2[1], n2[2]); TK.push(kind); };
    const kx = (D.xs[nx - 1] - D.xs[0]) / (2 * M.EX), ky = (D.ys[ny - 1] - D.ys[0]) / (2 * M.EY);
    let walls = 0, floor = 0;
    // a disk with hardly any grid points inside it: rings and sectors of its own, with the values
    // between the grid points (bilinear), and the normals of the nearest grid point
    if (VS.disk) {
      let pin = 0;
      for (let k = 0; k < n; k++) if (xs[k % nx] ** 2 + ys[(k / nx) | 0] ** 2 <= R2) pin++;
      if (pin < 9) {
        const at = (x, y) => {
          const fi = (x - xs[0]) / (xs[nx - 1] - xs[0]) * (nx - 1), fj = (y - ys[0]) / (ys[ny - 1] - ys[0]) * (ny - 1);
          if (!(fi >= 0 && fi <= nx - 1 && fj >= 0 && fj <= ny - 1)) return null;
          const i = Math.min(nx - 2, Math.floor(fi)), j = Math.min(ny - 2, Math.floor(fj)), fa = fi - i, fb = fj - j, k = j * nx + i, C = [k, k + 1, k + nx + 1, k + nx];
          if (!C.every((c) => okA[c] && okB[c])) return null;
          const bil = (w) => w[C[0]] * (1 - fa) * (1 - fb) + w[C[1]] * fa * (1 - fb) + w[C[2]] * fa * fb + w[C[3]] * (1 - fa) * fb;
          const kn = Math.round(fj) * nx + Math.round(fi);
          return add(x, y, bil(wa), bil(wb), gridNormal(wa, okA, kn), vg ? gridNormal(wb, okB, kn) : [0, 0, 1]);
        };
        const NR = 6, NS = 64, ids = [at(0, 0)];
        for (let r = 1; r <= NR; r++) for (let m = 0; m < NS; m++) ids.push(at(VS.R * r / NR * Math.cos(2 * Math.PI * m / NS), VS.R * r / NR * Math.sin(2 * Math.PI * m / NS)));
        if (ids.some((v) => v === null)) return { PX, PY, PA, PB, TV, TN, TK, walls, floor, tris: 0 };
        const id = (r, m) => (r ? ids[1 + (r - 1) * NS + (m % NS)] : ids[0]);
        const face = (a, b, c) => { tri(2 * a, 2 * b, 2 * c, NA[a], NA[b], NA[c], 1); tri(2 * a + 1, 2 * b + 1, 2 * c + 1, NB[a], NB[b], NB[c], 2); if (!vg) floor++; };
        for (let m = 0; m < NS; m++) {
          face(id(0, 0), id(1, m), id(1, m + 1));
          for (let r = 1; r < NR; r++) { face(id(r, m), id(r + 1, m), id(r + 1, m + 1)); face(id(r, m), id(r + 1, m + 1), id(r, m + 1)); }
          const p = id(NR, m), q = id(NR, m + 1), np = [PX[p] * kx, PY[p] * ky, 0], nq = [PX[q] * kx, PY[q] * ky, 0];
          tri(2 * p, 2 * q, 2 * q + 1, np, nq, nq, 3); tri(2 * p, 2 * q + 1, 2 * p + 1, np, nq, np, 3); walls++;
        }
        return { PX, PY, PA, PB, TV, TN, TK, walls, floor, tris: TK.length };
      }
    }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const k0 = j * nx + i, K = [k0, k0 + 1, k0 + nx + 1, k0 + nx];
        const nIn = inside[K[0]] + inside[K[1]] + inside[K[2]] + inside[K[3]];
        if (!nIn) continue;
        const E = [['h' + k0, k0, k0 + 1], ['v' + (k0 + 1), k0 + 1, k0 + 1 + nx], ['h' + (k0 + nx), k0 + nx, k0 + nx + 1], ['v' + k0, k0, k0 + nx]];
        const outer = (j === 0 ? 1 : 0) | (i === nx - 2 ? 2 : 0) | (j === ny - 2 ? 4 : 0) | (i === 0 ? 8 : 0);
        // the outline of the part inside, around the cell (corners, then where an edge leaves or enters)
        let poly = [];
        for (let e = 0; e < 4; e++) {
          const kc = K[e], kn = K[(e + 1) % 4];
          if (inside[kc]) poly.push({ id: gridPoint(kc), mask: (1 << e) | (1 << ((e + 3) % 4)), cut: false });
          if (inside[kc] !== inside[kn]) { const c = cutPoint(E[e][0], E[e][1], E[e][2]); poly.push({ id: c.id, mask: 1 << e, cut: true, circ: c.circ, enter: !inside[kc] }); }
        }
        // along the circle between where it leaves the cell's part and where it comes back: points of the arc
        if (VS.disk && nIn < 4) {
          const out = [];
          poly.forEach((p, m) => {
            out.push(p);
            const q = poly[(m + 1) % poly.length];
            if (!(p.cut && p.circ && !p.enter && q.cut && q.circ && q.enter)) return;
            const ta = Math.atan2(PY[p.id], PX[p.id]);
            let dt = Math.atan2(PY[q.id], PX[q.id]) - ta;
            while (dt <= 0) dt += 2 * Math.PI;
            if (dt > Math.PI) return;
            const steps = Math.ceil(dt / 0.05);
            const all = (ok) => ok[K[0]] && ok[K[1]] && ok[K[2]] && ok[K[3]];
            const xa = xs[i], xb = xs[i + 1], ya = ys[j], yb = ys[j + 1];
            for (let s = 1; s < steps; s++) {
              const th = ta + dt * s / steps, x = VS.R * Math.cos(th), y = VS.R * Math.sin(th), f = s / steps;
              const fa = (x - xa) / (xb - xa), fb = (y - ya) / (yb - ya);
              const bil = (w) => w[K[0]] * (1 - fa) * (1 - fb) + w[K[1]] * fa * (1 - fb) + w[K[2]] * fa * fb + w[K[3]] * (1 - fa) * fb;
              const a = all(okA) ? bil(wa) : lerp(PA[p.id], PA[q.id], f), b = !vg ? w0 : all(okB) ? bil(wb) : lerp(PB[p.id], PB[q.id], f);
              out.push({ id: add(x, y, a, b, lerp3(NA[p.id], NA[q.id], f), lerp3(NB[p.id], NB[q.id], f)), mask: 0, cut: true, circ: true, arc: true });
            }
          });
          poly = out;
        }
        if (poly.length < 3) continue;
        // the faces on the two sheets (fans: the outline is convex in x and y)
        for (let m = 1; m + 1 < poly.length; m++) {
          const a = poly[0].id, b = poly[m].id, c = poly[m + 1].id;
          tri(2 * a, 2 * b, 2 * c, NA[a], NA[b], NA[c], 1);
          tri(2 * a + 1, 2 * b + 1, 2 * c + 1, NB[a], NB[b], NB[c], 2);
          if (!vg) floor++;
        }
        // walls along the edge of the region
        for (let m = 0; m < poly.length; m++) {
          const p = poly[m], q = poly[(m + 1) % poly.length];
          if (!(p.cut && q.cut) && !(p.mask & q.mask & outer)) continue;
          let np, nq;
          if (p.circ && q.circ) { np = [PX[p.id] * kx, PY[p.id] * ky, 0]; nq = [PX[q.id] * kx, PY[q.id] * ky, 0]; }
          else { const du = U(PX[q.id]) - U(PX[p.id]), dv = V(PY[q.id]) - V(PY[p.id]); np = nq = [dv, -du, 0]; }
          tri(2 * p.id, 2 * q.id, 2 * q.id + 1, np, nq, nq, 3);
          tri(2 * p.id, 2 * q.id + 1, 2 * p.id + 1, np, nq, np, 3);
          walls++;
        }
      }
    }
    return { PX, PY, PA, PB, TV, TN, TK, walls, floor, tris: TK.length };
  }

  // A triangle laid over the pixels of a layer: calls px(index, l0, l1, l2) for every pixel whose
  // centre it covers, with the weights of its corners (pixels on an edge shared by two triangles go
  // to one of them only, so that a line of sight crosses a closed mesh an even number of times).
  function rasterTri(ax, ay, bx, by, cx, cy, LW, LH, px) {
    // (the corners on a grid of 1/256 pixel: the sums below are then exact, and the same for the two
    // triangles beside an edge)
    ax = Math.round(ax * 256) / 256; ay = Math.round(ay * 256) / 256; bx = Math.round(bx * 256) / 256;
    by = Math.round(by * 256) / 256; cx = Math.round(cx * 256) / 256; cy = Math.round(cy * 256) / 256;
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!(Math.abs(area) > 1e-12)) return;
    let sw = false;
    if (area < 0) { let t = bx; bx = cx; cx = t; t = by; by = cy; cy = t; area = -area; sw = true; }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(LW - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(LH - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    if (x0 > x1 || y0 > y1) return;
    // edge functions (b, c), (c, a), (a, b); a pixel exactly on an edge counts for the "top-left" ones
    const e0x = cx - bx, e0y = cy - by, e1x = ax - cx, e1y = ay - cy, e2x = bx - ax, e2y = by - ay;
    const b0 = e0y < 0 || (e0y === 0 && e0x > 0) ? 0 : -1e-300, b1 = e1y < 0 || (e1y === 0 && e1x > 0) ? 0 : -1e-300;
    const b2 = e2y < 0 || (e2y === 0 && e2x > 0) ? 0 : -1e-300, inv = -1 / area;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5, row = y * LW, qx = x0 + 0.5;
      const v0 = (qx - bx) * e0y - (py - by) * e0x, v1 = (qx - cx) * e1y - (py - cy) * e1x, v2 = (qx - ax) * e2y - (py - ay) * e2x;
      // the pixels of the row inside: from where all three edge functions are ≤ 0 (with y down and the
      // corners turned so that the area is positive), found for each edge, then tested exactly
      let lo = 0, hi = x1 - x0;
      if (e0y > 0) hi = Math.min(hi, Math.floor(-v0 / e0y) + 1); else if (e0y < 0) lo = Math.max(lo, Math.ceil(-v0 / e0y) - 1); else if (v0 > b0) continue;
      if (e1y > 0) hi = Math.min(hi, Math.floor(-v1 / e1y) + 1); else if (e1y < 0) lo = Math.max(lo, Math.ceil(-v1 / e1y) - 1); else if (v1 > b1) continue;
      if (e2y > 0) hi = Math.min(hi, Math.floor(-v2 / e2y) + 1); else if (e2y < 0) lo = Math.max(lo, Math.ceil(-v2 / e2y) - 1); else if (v2 > b2) continue;
      if (lo < 0) lo = 0;
      if (hi > x1 - x0) hi = x1 - x0;
      let w0 = v0 + lo * e0y, w1 = v1 + lo * e1y, w2 = v2 + lo * e2y;
      for (let x = x0 + lo; x <= x0 + hi; x++, w0 += e0y, w1 += e1y, w2 += e2y) {
        if (w0 > b0 || w1 > b1 || w2 > b2) continue;
        if (sw) px(row + x, w0 * inv, w2 * inv, w1 * inv); else px(row + x, w0 * inv, w1 * inv, w2 * inv);
      }
    }
  }

  let EXPT = null;
  // The gelatin: laid over the pixels of the part of the canvas it covers (q pixels for each CSS
  // pixel), then shaded and put over what is drawn behind it. Along each line of sight, from the eye:
  // at every face of the skin a little light is mirrored (more at a slant), and the skin shows its own
  // deep color and lets the rest through in that color (both more at a slant); between a face where
  // it goes in and the next where it comes out, the gelatin scatters its pale color (more where it is
  // thick, and what comes through is that much less) and absorbs a little; at the end, what is drawn
  // behind, seen bent by the gelatin in front of it.
  function liquidPaint(g, c, M, mesh, opaque, vc, dark, q) {
    const { proj, T, U, V, dpr, W, H, ca, sa, ce, se, S } = M;
    const np = mesh.PX.length, none = { shown: 0, odd: 0, q, thick: 0 };
    if (!np) return none;
    const sx = new Float64Array(2 * np), sy = new Float64Array(2 * np), sd = new Float64Array(2 * np);
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let p = 0; p < np; p++) {
      const u = U(mesh.PX[p]), v = V(mesh.PY[p]);
      for (let h = 0; h < 2; h++) {
        proj(u, v, h ? mesh.PB[p] : mesh.PA[p]);
        const k = 2 * p + h;
        sx[k] = T[0]; sy[k] = T[1]; sd[k] = T[2];
        if (T[0] < mnx) mnx = T[0]; if (T[0] > mxx) mxx = T[0]; if (T[1] < mny) mny = T[1]; if (T[1] > mxy) mxy = T[1];
      }
    }
    const bx0 = Math.max(0, Math.floor(mnx) - 2), by0 = Math.max(0, Math.floor(mny) - 2), bx1 = Math.min(W, Math.ceil(mxx) + 2), by1 = Math.min(H, Math.ceil(mxy) + 2);
    if (bx1 <= bx0 || by1 <= by0) return none;
    const LW = Math.ceil((bx1 - bx0) * q), LH = Math.ceil((by1 - by0) * q), NP = LW * LH;
    const lx = (x) => (x - bx0) * q, ly = (y) => (y - by0) * q;
    // (the buffers are kept for the next drawing: the graph is drawn again and again while it is turned)
    const K = 6, B = Q3.liqBuf && Q3.liqBuf.n >= NP ? Q3.liqBuf : (Q3.liqBuf = { n: NP, zop: new Float32Array(NP), cnt: new Uint8Array(NP), dep: new Float32Array(NP * K), shd: new Uint32Array(NP * K), near: new Float32Array(NP), nrm: new Float32Array(NP * 2) });
    const zop = B.zop, cnt = B.cnt, dep = B.dep, shd = B.shd, near = B.near, nrm = B.nrm;
    zop.fill(Infinity, 0, NP); cnt.fill(0, 0, NP); near.fill(Infinity, 0, NP);
    // the nearest of the other surfaces at each pixel (what is drawn in front of the liquid hides it)
    let ad, bd, cd;
    const opx = (i, l0, l1, l2) => { const d = l0 * ad + l1 * bd + l2 * cd; if (d < zop[i]) zop[i] = d; };
    for (const o of opaque) {
      const pr = o.s && o.s.proj;
      const P = o.poly ? o.poly.map((p) => [p.x, p.y, p.d]) : o.pts.map((k) => [pr.px[k], pr.py[k], pr.pd[k]]);
      for (let m = 1; m + 1 < P.length; m++) {
        ad = P[0][2]; bd = P[m][2]; cd = P[m + 1][2];
        rasterTri(lx(P[0][0]), ly(P[0][1]), lx(P[m][0]), ly(P[m][1]), lx(P[m + 1][0]), ly(P[m + 1][1]), LW, LH, opx);
      }
    }
    // the room mirrored by the skin: sky above and floor below, a large soft lamp at the upper left (the
    // light of the graph) with a sharp glint, and a smaller lamp at the right; much brighter than the
    // page, as real lamps are
    const skyI = dark ? 0.42 : 0.98, groundI = dark ? 0.12 : 0.58;
    const Lx = -0.42, Ly = 0.62, Lz = -0.66, F0 = 0.035, lampI = dark ? 24 : 18;
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    // a lamp: a lit rectangle (half width w, half height h, seen from the liquid, with soft edges) in
    // the direction (x, y, z) of the camera's axes, upright
    const lamp = (x, y, z, w, h) => {
      const l = Math.sqrt(x * x + y * y + z * z); x /= l; y /= l; z /= l;
      const e = Math.sqrt(z * z + x * x), ax = z / e, az = -x / e;      // across: level, at right angles to it
      const bx = y * az, by = z * ax - x * az, bz = -y * ax;            // up: at right angles to both
      return [x, y, z, ax, az, bx, by, bz, w, h];
    };
    const [A0, A1, A2, A3, A4, A5, A6, A7, A8, A9] = lamp(-0.42, 0.62, -0.66, 0.26, 0.36), [B0, B1, B2, B3, B4, B5, B6, B7, B8, B9] = lamp(0.8, 0.22, -0.55, 0.07, 0.42);
    const edge = (lim, v) => { v = v < 0 ? -v : v; if (v >= lim) return 0; const t = (lim - v) / (lim * 0.28); return t >= 1 ? 1 : t * t * (3 - 2 * t); };
    const lampAt = (rx, ry, rz) => {
      let s = 0, d = rx * A0 + ry * A1 + rz * A2;
      if (d > 0.2) s += edge(A8, (rx * A3 + rz * A4) / d) * edge(A9, (rx * A5 + ry * A6 + rz * A7) / d);
      d = rx * B0 + ry * B1 + rz * B2;
      if (d > 0.2) s += 0.5 * edge(B8, (rx * B3 + rz * B4) / d) * edge(B9, (rx * B5 + ry * B6 + rz * B7) / d);
      return s;
    };
    // The light of a face depends only on its normal in the camera's axes (x right, y up, z away, toward
    // the eye): it is worked out once for a grid of normals (x and y from −1 to 1) for this view: the
    // light the skin mirrors, the share of the light that goes into it, how much of the skin the line of
    // sight goes through (1 looked at straight, more at a slant), and how much light falls on it.
    const NL = q < 1 ? 128 : 256, lutKey = [NL, ce, se, dark, 'skin3'].join();
    if (!Q3.liqLut || Q3.liqLut.key !== lutKey) {
      const lut = new Float32Array(NL * NL * 4);
      for (let iy = 0; iy < NL; iy++) {
        for (let ix = 0; ix < NL; ix++) {
          let cx = ix / (NL - 1) * 2 - 1, cy = iy / (NL - 1) * 2 - 1, r2 = cx * cx + cy * cy;
          if (r2 > 1) { const r = Math.sqrt(r2); cx /= r; cy /= r; r2 = 1; }
          const cz = -Math.sqrt(1 - r2), cosT = -cz, om = 1 - cosT, fr = F0 + (1 - F0) * om * om * om * om * om;
          const rx = 2 * cosT * cx, ry = 2 * cosT * cy, rz = 2 * cosT * cz + 1;
          const rl = rx * Lx + ry * Ly + rz * Lz;
          const env = groundI + (skyI - groundI) * sm(-0.3, 0.45, ry * ce - rz * se) + lampI * lampAt(rx, ry, rz) + (rl > 0.99 ? 60 * Math.pow(rl, 1500) : 0);
          const o = (iy * NL + ix) * 4;
          lut[o] = fr * env; lut[o + 1] = 1 - fr; lut[o + 2] = 1 / Math.max(cosT * cosT, 0.006);
          lut[o + 3] = 0.42 + 0.58 * Math.max(0, cx * Lx + cy * Ly + cz * Lz);
        }
      }
      Q3.liqLut = { key: lutKey, lut };
    }
    const lut = Q3.liqLut.lut, half = (NL - 1) / 2;
    // each face crossed: its depth and its light; for the nearest, its normal (for the bending of what is behind)
    const TV = mesh.TV, TN = mesh.TN, CN = new Float64Array(9);
    const lpx = (i, l0, l1, l2) => {
      const d = l0 * ad + l1 * bd + l2 * cd;
      let cx = l0 * CN[0] + l1 * CN[3] + l2 * CN[6], cy = l0 * CN[1] + l1 * CN[4] + l2 * CN[7], cz = l0 * CN[2] + l1 * CN[5] + l2 * CN[8];
      const nl = Math.sqrt(cx * cx + cy * cy + cz * cz), sg = cz > 0 ? -1 / nl : 1 / nl;
      cx *= sg; cy *= sg;
      const pk = ((cy + 1) * half + 0.5 | 0) * NL + ((cx + 1) * half + 0.5 | 0);
      const n0 = cnt[i];
      if (n0 < K) { dep[i * K + n0] = d; shd[i * K + n0] = pk; cnt[i] = n0 + 1; }
      else {
        // (more faces than kept: the farthest one gives way)
        let far = 0;
        for (let m = 1; m < K; m++) if (dep[i * K + m] > dep[i * K + far]) far = m;
        if (d < dep[i * K + far]) { dep[i * K + far] = d; shd[i * K + far] = pk; }
      }
      if (d < near[i]) { near[i] = d; nrm[2 * i] = cx; nrm[2 * i + 1] = cy; }
    };
    for (let t = 0; t < mesh.TK.length; t++) {
      const a = TV[3 * t], b = TV[3 * t + 1], cc = TV[3 * t + 2];
      ad = sd[a]; bd = sd[b]; cd = sd[cc];
      // the normals of the corners in the camera's axes
      for (let m = 0; m < 3; m++) {
        const nu = TN[9 * t + 3 * m], nv = TN[9 * t + 3 * m + 1], nw = TN[9 * t + 3 * m + 2];
        CN[3 * m] = nu * ca - nv * sa; CN[3 * m + 1] = nu * sa * se + nv * ca * se + nw * ce; CN[3 * m + 2] = nu * sa * ce + nv * ca * ce - nw * se;
      }
      rasterTri(lx(sx[a]), ly(sy[a]), lx(sx[b]), ly(sy[b]), lx(sx[cc]), ly(sy[cc]), LW, LH, lpx);
    }
    // what is drawn behind (device pixels), to be seen through the liquid
    const DX0 = Math.floor(bx0 * dpr), DY0 = Math.floor(by0 * dpr), DW = Math.min(c.width, Math.ceil(bx1 * dpr)) - DX0, DH = Math.min(c.height, Math.ceil(by1 * dpr)) - DY0;
    const bg = g.getImageData(DX0, DY0, DW, DH).data;
    // inside, a pale gelatin (1.9.2): a strong color for what it absorbs, a pale one for the light it
    // scatters (a little cloudy, paler where it is thick); the skin: a deep shade of the same color (the
    // light it scatters, SS), and what it absorbs (a little of every color, SN, and more of the others,
    // SD), for each time the line of sight goes through it straight
    const ab = hslRgb(vc.hue, 0.9, 0.5).map((v) => 1 - v / 255), sc = hslRgb(vc.hue, dark ? 0.5 : 0.55, dark ? 0.82 : 0.9).map((v) => v / 255);
    const skin = hslRgb(vc.hue, 0.75, dark ? 0.34 : 0.3).map((v) => v / 255), tint = dark ? [0.92, 0.96, 1.08] : [0.97, 0.99, 1.03];
    const SN = 0.02, SD = 0.08, SS = 0.06, SA0 = SN + SD * ab[0] + SS, SA1 = SN + SD * ab[1] + SS, SA2 = SN + SD * ab[2] + SS;
    const KAP = 0.1, BETA = 1.4, SCAT = dark ? 0.48 : 0.35, ETA = 0.25, KA0 = KAP * ab[0], KA1 = KAP * ab[1], KA2 = KAP * ab[2];
    // e^−x from a table (x from 0 to 16 in steps of 1/64, between them on a straight line): far quicker
    // than Math.exp for every stretch of liquid
    if (!EXPT) { EXPT = new Float64Array(1026); for (let n = 0; n < 1026; n++) EXPT[n] = Math.exp(-n / 64); }
    const ex = (x) => { x *= 64; if (x >= 1024) return EXPT[1024]; const n = x | 0, f = x - n; return EXPT[n] + (EXPT[n + 1] - EXPT[n]) * f; };
    const out = new ImageData(LW, LH), od = out.data, idx = new Uint8Array(K);
    let shown = 0, odd = 0, thick = 0;
    for (let i = 0; i < NP; i++) {
      const n0 = cnt[i];
      if (n0 & 1) odd++;  // (a line of sight that goes in and does not come out: a gap in the mesh; for the tests)
      // (a face of the liquid that meets another surface, as along the circle of a disk, counts as in front of it)
      const z = zop[i] + 0.01;
      if (!n0 || near[i] >= z) continue;
      // the faces in order from the eye
      for (let m = 0; m < n0; m++) idx[m] = m;
      for (let m = 1; m < n0; m++) { const v = idx[m], dv = dep[i * K + v]; let r = m - 1; while (r >= 0 && dep[i * K + idx[r]] > dv) { idx[r + 1] = idx[r]; r--; } idx[r + 1] = v; }
      let t0 = 1, t1 = 1, t2 = 1, c0 = 0, c1 = 0, c2 = 0, inl = false, from = 0, th = 0, m = 0;
      for (; m <= n0; m++) {
        const k = i * K + idx[m], d = m < n0 ? dep[k] : Infinity, end = d >= z;
        // (with no face left before what is drawn behind: an odd number of faces in all is a gap at an
        // edge, not counted; otherwise the liquid goes on to what is drawn behind)
        if (end && (!inl || m === n0)) break;
        // two faces at nearly the same depth (a sliver, where two sheets meet at an edge): neither counts
        if (!end && m + 1 < n0 && dep[i * K + idx[m + 1]] - d < 0.004 && dep[i * K + idx[m + 1]] < z) { m++; continue; }
        if (inl) {
          // a stretch of gelatin: it scatters its pale color, and what comes through is less by that and by what it absorbs
          const len = (end ? z : d) - from, s = SCAT * (1 - ex(BETA * len));
          c0 += t0 * sc[0] * s; c1 += t1 * sc[1] * s; c2 += t2 * sc[2] * s;
          t0 *= (1 - s) * ex(KA0 * len); t1 *= (1 - s) * ex(KA1 * len); t2 *= (1 - s) * ex(KA2 * len);
          th += len;
        }
        if (end) break;
        // the skin: the light it mirrors, its own deep color (where light falls on it), and what goes
        // through it, in its color (pf: how much of the skin the line of sight goes through)
        const o = shd[k] * 4, refl = lut[o], pass = lut[o + 1], pf = lut[o + 2], lit = pass * (1 - ex(SS * pf)) * lut[o + 3];
        c0 += t0 * (refl * tint[0] + lit * skin[0]); c1 += t1 * (refl * tint[1] + lit * skin[1]); c2 += t2 * (refl * tint[2] + lit * skin[2]);
        t0 *= pass * ex(SA0 * pf); t1 *= pass * ex(SA1 * pf); t2 *= pass * ex(SA2 * pf);
        inl = !inl; from = d;
      }
      // what is behind, seen bent: toward the middle of a rounded front, more where the liquid is thicker
      let X = ((i % LW) + 0.5) / q + bx0, Y = (((i / LW) | 0) + 0.5) / q + by0;
      const k = ETA * Math.min(th, 2.2) * S * 0.3, ox = -nrm[2 * i] * k, oy = nrm[2 * i + 1] * k;
      const li = Math.round(lx(X + ox) - 0.5), lj = Math.round(ly(Y + oy) - 0.5);
      if (li >= 0 && lj >= 0 && li < LW && lj < LH && zop[lj * LW + li] > near[i]) { X += ox; Y += oy; }
      let bxp = X * dpr - DX0 - 0.5, byp = Y * dpr - DY0 - 0.5;
      bxp = bxp < 0 ? 0 : bxp > DW - 1.001 ? DW - 1.001 : bxp; byp = byp < 0 ? 0 : byp > DH - 1.001 ? DH - 1.001 : byp;
      const xi = bxp | 0, yi = byp | 0, fx = bxp - xi, fy = byp - yi, b4 = (yi * DW + xi) * 4, o4 = i * 4;
      const w00 = (1 - fx) * (1 - fy) / 255, w10 = fx * (1 - fy) / 255, w01 = (1 - fx) * fy / 255, w11 = fx * fy / 255, r4 = DW * 4;
      const r = c0 + t0 * (bg[b4] * w00 + bg[b4 + 4] * w10 + bg[b4 + r4] * w01 + bg[b4 + r4 + 4] * w11);
      const gg = c1 + t1 * (bg[b4 + 1] * w00 + bg[b4 + 5] * w10 + bg[b4 + r4 + 1] * w01 + bg[b4 + r4 + 5] * w11);
      const bb = c2 + t2 * (bg[b4 + 2] * w00 + bg[b4 + 6] * w10 + bg[b4 + r4 + 2] * w01 + bg[b4 + r4 + 6] * w11);
      // (a soft knee instead of a hard clip, so that bright glints keep their shape)
      od[o4] = 255 * (r < 0.9 ? r : 1 - 0.1 * ex((r - 0.9) * 10)) + 0.5; od[o4 + 1] = 255 * (gg < 0.9 ? gg : 1 - 0.1 * ex((gg - 0.9) * 10)) + 0.5;
      od[o4 + 2] = 255 * (bb < 0.9 ? bb : 1 - 0.1 * ex((bb - 0.9) * 10)) + 0.5;
      od[o4 + 3] = 255;
      shown++; thick += th;
    }
    // soft edges: a pixel of the liquid beside pixels without it lets a little of the background through
    const DS = [];
    for (let i = 0; i < NP; i++) {
      if (!od[i * 4 + 3]) continue;
      const x = i % LW;
      let e = 0;
      if (x > 0 && !od[(i - 1) * 4 + 3]) e++; if (x < LW - 1 && !od[(i + 1) * 4 + 3]) e++;
      if (i >= LW && !od[(i - LW) * 4 + 3]) e++; if (i + LW < NP && !od[(i + LW) * 4 + 3]) e++;
      if (e) DS.push(i, e);
    }
    for (let m = 0; m < DS.length; m += 2) od[DS[m] * 4 + 3] = Math.round(255 * (1 - 0.2 * DS[m + 1]));
    const off = document.createElement('canvas');
    off.width = LW; off.height = LH;
    off.getContext('2d').putImageData(out, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(off, bx0, by0, LW / q, LH / q);
    g.restore();
    return { shown, odd, q, thick: shown ? Math.round(thick / shown * 1000) / 1000 : 0 };
  }
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
    const xs = D.xs, ys = D.ys, x0 = xs[0], x1 = xs[D.nx - 1], y0 = ys[0], y1 = ys[D.ny - 1], z0 = D.z0, z1 = D.z1;
    // the half sizes of the box: x and y from −1 to 1 and z from −ZS to ZS, or (1:1:1) the same length
    // for one unit on all axes, the longest side from −1 to 1
    let EX = 1, EY = 1, EZ = ZS;
    Q3.equalNow = equal3dNow(x1 - x0, y1 - y0, z1 - z0);
    if (Q3.eqBtn) { Q3.eqBtn.classList.toggle('on', Q3.equalNow); Q3.eqBtn.setAttribute('aria-pressed', String(Q3.equalNow)); }
    if (Q3.equalNow) {
      const M = Math.max(x1 - x0, y1 - y0, z1 - z0);
      EX = (x1 - x0) / M; EY = (y1 - y0) / M; EZ = Math.max(0.03, (z1 - z0) / M);
    }
    const EH = Math.hypot(EX, EY);
    const S = Math.min(W / (3.3 * EH / Math.SQRT2), H / (2 * (EZ * Math.abs(ce) + EH * Math.abs(se)) + 0.75)) * Q3.zoom;
    const cx = W / 2, cy = H / 2;
    // (u, v, w) -> screen x, screen y and depth (larger is farther away)
    const T = [0, 0, 0];
    const proj = (u, v, w) => {
      const xr = u * ca - v * sa, yr = u * sa + v * ca;
      T[0] = cx + xr * S; T[1] = cy - (w * ce + yr * se) * S; T[2] = yr * ce - w * se;
      return T;
    };
    const U = (x) => ((x - x0) / (x1 - x0) * 2 - 1) * EX, V = (y) => ((y - y0) / (y1 - y0) * 2 - 1) * EY, Wz = (z) => ((z - z0) / (z1 - z0) * 2 - 1) * EZ;
    const line = (u1, v1, w1, u2, v2, w2) => { proj(u1, v1, w1); g.moveTo(T[0], T[1]); proj(u2, v2, w2); g.lineTo(T[0], T[1]); };
    // the three panes at the back of the box, with grid lines
    const ub = proj(EX, 0, 0)[2] > proj(-EX, 0, 0)[2] ? EX : -EX;
    const vb = proj(0, EY, 0)[2] > proj(0, -EY, 0)[2] ? EY : -EY;
    const wb = proj(0, 0, EZ)[2] > proj(0, 0, -EZ)[2] ? EZ : -EZ;
    const stx = niceStep(x1 - x0, 4), sty = niceStep(y1 - y0, 4), stz = niceStep(z1 - z0, 4);
    const gx = gridValues(x0, x1, stx, 40), gy = gridValues(y0, y1, sty, 40), gz = gridValues(z0, z1, stz, 40);
    // a path on the floor of the box (z at its bottom), from points (u, v)
    const pane0 = (pts) => { pts.forEach(([u, v], i) => { proj(u, v, -EZ); if (i) g.lineTo(T[0], T[1]); else g.moveTo(T[0], T[1]); }); g.closePath(); };
    const pane = (corners) => { g.beginPath(); corners.forEach(([u, v, w], i) => { proj(u, v, w); if (i) g.lineTo(T[0], T[1]); else g.moveTo(T[0], T[1]); }); g.closePath(); g.fill(); g.stroke(); };
    g.fillStyle = dark ? 'rgba(255,255,255,0.035)' : 'rgba(30,50,90,0.035)';
    g.strokeStyle = axisColor; g.lineWidth = 1;
    pane([[-EX, -EY, wb], [EX, -EY, wb], [EX, EY, wb], [-EX, EY, wb]]);
    pane([[ub, -EY, -EZ], [ub, EY, -EZ], [ub, EY, EZ], [ub, -EY, EZ]]);
    pane([[-EX, vb, -EZ], [EX, vb, -EZ], [EX, vb, EZ], [-EX, vb, EZ]]);
    g.strokeStyle = gridColor; g.beginPath();
    for (const x of gx) { line(U(x), -EY, wb, U(x), EY, wb); line(U(x), vb, -EZ, U(x), vb, EZ); }
    for (const y of gy) { line(-EX, V(y), wb, EX, V(y), wb); line(ub, V(y), -EZ, ub, V(y), EZ); }
    for (const z of gz) { line(ub, -EY, Wz(z), ub, EY, Wz(z)); line(-EX, vb, Wz(z), EX, vb, Wz(z)); }
    g.stroke();
    // the surfaces: project every grid point once, then lay the cells over the pixels with a depth
    // buffer (surfacePaint, 1.9.2)
    const cells = [];
    // a normal in the box's axes (u, v, w) in the camera's axes; grid coordinates of u and v
    const camN = (nu, nv, nw) => [nu * ca - nv * sa, nu * sa * se + nv * ca * se + nw * ce, nu * sa * ce + nv * ca * ce - nw * se];
    const giOf = (u) => (u / EX + 1) / 2 * (D.nx - 1), gjOf = (v) => (v / EY + 1) / 2 * (D.ny - 1);
    const L = [-0.42, 0.62, -0.66];  // light from the upper left, in front
    // the solid that is measured while "Volume and surface" is open (1.8.4): drawn as a liquid (1.9.1,
    // liquidPaint); the measured parts of the surfaces are not drawn as cells (inR)
    const VS = Q3.volUI && !Q3.volUI.box.hidden && Q3.volShade && Q3.volShade.D === D ? Q3.volShade : null;
    const vf = VS ? D.series[VS.fi] || null : null, vg = vf && VS.gi >= 0 ? D.series[VS.gi] || null : null;
    // a cell counts as inside the region when any part of it is (its point nearest to the centre of a disk)
    const inRegion = (i, j) => { if (!VS.disk) return true; const cx = Math.max(xs[i], Math.min(xs[i + 1], 0)), cy = Math.max(ys[j], Math.min(ys[j + 1], 0)); return cx * cx + cy * cy <= VS.R * VS.R; };
    // a cell partly inside and partly outside the disk (its nearest point inside, its farthest corner outside)
    const crossing = (i, j) => VS.disk && inRegion(i, j) && Math.max(Math.hypot(xs[i], ys[j]), Math.hypot(xs[i + 1], ys[j]), Math.hypot(xs[i], ys[j + 1]), Math.hypot(xs[i + 1], ys[j + 1])) > VS.R;
    for (const s of D.series) {
      const n = D.nx * D.ny;
      const chosen = !!vf && (s === vf || s === vg);
      if (!s.proj || s.proj.st.length !== n) s.proj = { px: new Float32Array(n), py: new Float32Array(n), pd: new Float32Array(n), pw: new Float32Array(n), st: new Uint8Array(n) };
      const { px, py, pd, pw, st } = s.proj;
      st.fill(0);
      for (let j = 0; j < D.ny; j++) {
        const v = V(ys[j]);
        for (let i = 0; i < D.nx; i++) {
          const k = j * D.nx + i, z = s.z[k];
          if (z === null || z !== z) continue;
          const w = Wz(z);
          if (w > EZ * 1.0001 || w < -EZ * 1.0001) { st[k] = 2; continue; }  // outside the z range
          proj(U(xs[i]), v, w);
          px[k] = T[0]; py[k] = T[1]; pd[k] = T[2]; pw[k] = w; st[k] = 1;
        }
      }
      // the normals at the grid points (1.9.2), in the box's axes and in the camera's
      const NM = gridNormals(s, D, U, V, Wz);
      if (!s.cnrm || s.cnrm.length !== NM.length) s.cnrm = new Float32Array(NM.length);
      for (let k = 0; k < n; k++) if (st[k] === 1) { const c3 = camN(NM[3 * k], NM[3 * k + 1], NM[3 * k + 2]); s.cnrm[3 * k] = c3[0]; s.cnrm[3 * k + 1] = c3[1]; s.cnrm[3 * k + 2] = c3[2]; }
      s.rimP = null;
      if (s.rim) {
        s.rimP = {};
        for (const key in s.rim) {
          const e = s.rim[key], w = Wz(e.z);
          if (!(w <= EZ * 1.0001 && w >= -EZ * 1.0001)) continue;
          proj(U(e.x), V(e.y), w);
          // (where a surface ends, as a sphere at its rim, it stands upright: its normal is level, the
          // way the surface falls toward its edge from the grid point inside)
          const ka = +key.slice(1), kb = key[0] === 'h' ? ka + 1 : ka + D.nx, kin = st[ka] === 1 ? ka : kb;
          let lu = NM[3 * kin], lv = NM[3 * kin + 1];
          const lh = Math.hypot(lu, lv);
          if (lh > 0.05) { lu /= lh; lv /= lh; } else { lu = U(e.x) - U(xs[kin % D.nx]); lv = V(e.y) - V(ys[(kin / D.nx) | 0]); }
          s.rimP[key] = { x: T[0], y: T[1], d: T[2], u: U(e.x), v: V(e.y), w, n: camN(lu, lv, 0), gi: giOf(U(e.x)), gj: gjOf(V(e.y)) };
        }
      }
      // where the surface leaves the box (refineClips, 1.9.5): on its top or bottom, with the normal of
      // the grid point inside
      s.clipP = null;
      if (s.clip) {
        s.clipP = {};
        for (const key in s.clip) {
          const e = s.clip[key], w = e.z > (D.z0 + D.z1) / 2 ? EZ : -EZ;
          const ka = +key.slice(1), kb = key[0] === 'h' ? ka + 1 : ka + D.nx, kin = st[ka] === 1 ? ka : kb;
          if (st[kin] !== 1) continue;
          proj(U(e.x), V(e.y), w);
          s.clipP[key] = { x: T[0], y: T[1], d: T[2], u: U(e.x), v: V(e.y), w, n: [s.cnrm[3 * kin], s.cnrm[3 * kin + 1], s.cnrm[3 * kin + 2]], gi: giOf(U(e.x)), gj: gjOf(V(e.y)) };
        }
      }
      for (let j = 0; j < D.ny - 1; j++) {
        const dv = V(ys[j + 1]) - V(ys[j]);
        for (let i = 0; i < D.nx - 1; i++) {
          const a = j * D.nx + i, b = a + 1, c2 = a + D.nx + 1, d = a + D.nx;
          const real = (st[a] === 1) + (st[b] === 1) + (st[c2] === 1) + (st[d] === 1);
          const out = st[a] === 2 || st[b] === 2 || st[c2] === 2 || st[d] === 2;
          if (!real || (out && !s.clipP)) continue;
          const du = U(xs[i + 1]) - U(xs[i]);
          let pts, nu, nv, nw;
          if (real < 4 && (s.rimP || s.clipP)) {
            // at the edge of the real values: the cell cut along the edge that was found (refineRims);
            // where the surface leaves the box: cut along the top or the bottom of the box (refineClips)
            const cs = [a, b, c2, d], eks = ['h' + a, 'v' + b, 'h' + d, 'v' + a];
            let poly = [];
            for (let n = 0; n < 4 && poly; n++) {
              const k = cs[n], k2 = cs[(n + 1) % 4];
              if (st[k] === 1) poly.push({ k, x: px[k], y: py[k], d: pd[k], u: U(xs[k % D.nx]), v: V(ys[(k / D.nx) | 0]), w: pw[k], n: [s.cnrm[3 * k], s.cnrm[3 * k + 1], s.cnrm[3 * k + 2]], gi: k % D.nx, gj: (k / D.nx) | 0 });
              if ((st[k] === 1) !== (st[k2] === 1)) {
                const rp = (s.rimP && s.rimP[eks[n]]) || (s.clipP && s.clipP[eks[n]]);
                if (rp) poly.push(rp); else poly = null;
              }
            }
            if (!poly || poly.length < 3) continue;
            let su = 0, sv = 0, sw = 0, dd = 0, ww = 0;
            for (let n = 0; n < poly.length; n++) {
              const p1 = poly[n], p2 = poly[(n + 1) % poly.length];
              su += (p1.v - p2.v) * (p1.w + p2.w); sv += (p1.w - p2.w) * (p1.u + p2.u); sw += (p1.u - p2.u) * (p1.v + p2.v);
              dd += p1.d; ww += p1.w;
            }
            const yr = su * sa + sv * ca;
            const ncx = su * ca - sv * sa, ncy = sw * ce + yr * se, ncd = yr * ce - sw * se;
            const len = Math.hypot(ncx, ncy, ncd) || 1;
            cells.push({ s, poly, depth: dd * 4 / poly.length, shade: Math.abs(ncx * L[0] + ncy * L[1] + ncd * L[2]) / len, t: (ww / (poly.length * EZ) + 1) / 2, inR: chosen && inRegion(i, j) });
            continue;
          }
          if (real < 3) continue;
          if (real === 4) {
            // normal from the diagonals (a -> c2) x (b -> d), in camera space, for the shading
            const dw1 = pw[c2] - pw[a], dw2 = pw[d] - pw[b];
            nu = dv * dw2 - dw1 * dv; nv = dw1 * -du - du * dw2; nw = du * dv + dv * du;
            pts = [a, b, c2, d];
          } else {
            // one corner has no real value (the edge of a sphere): the triangle of the other three
            pts = [a, b, c2, d].filter((k) => st[k] === 1);
            const P0 = pts[0], P1 = pts[1], P2 = pts[2];
            const uu = (k) => (k % D.nx === i ? 0 : du), vv = (k) => (k >= a + D.nx ? dv : 0);
            const e1 = [uu(P1) - uu(P0), vv(P1) - vv(P0), pw[P1] - pw[P0]], e2 = [uu(P2) - uu(P0), vv(P2) - vv(P0), pw[P2] - pw[P0]];
            nu = e1[1] * e2[2] - e1[2] * e2[1]; nv = e1[2] * e2[0] - e1[0] * e2[2]; nw = e1[0] * e2[1] - e1[1] * e2[0];
          }
          const yr = nu * sa + nv * ca;
          const ncx = nu * ca - nv * sa, ncy = nw * ce + yr * se, ncd = yr * ce - nw * se;
          const len = Math.hypot(ncx, ncy, ncd) || 1;
          const shade = Math.abs(ncx * L[0] + ncy * L[1] + ncd * L[2]) / len;
          let dsum = 0, wsum = 0;
          for (const k of pts) { dsum += pd[k]; wsum += pw[k]; }
          if (chosen && real === 4 && crossing(i, j)) {
            // a cell across the circle of the disk (1.9.1): the part outside it is drawn as the surface,
            // cut along the circle at the same points as the liquid (liquidMesh), so that the two meet
            // without a gap; the part inside is the liquid's
            const K4 = [a, b, c2, d], R2 = VS.R * VS.R, xa = xs[i], xb = xs[i + 1], ya = ys[j], yb = ys[j + 1];
            const X = (k) => xs[k % D.nx], Y = (k) => ys[(k / D.nx) | 0], isIn = (k) => X(k) * X(k) + Y(k) * Y(k) <= R2;
            // (the normal between the four corners, as the values)
            const pt = (x, y, w) => {
              const fa = (x - xa) / (xb - xa), fb = (y - ya) / (yb - ya), wt = [(1 - fa) * (1 - fb), fa * (1 - fb), fa * fb, (1 - fa) * fb], nn = [0, 0, 0];
              for (let m = 0; m < 4; m++) for (let c3 = 0; c3 < 3; c3++) nn[c3] += wt[m] * s.cnrm[3 * K4[m] + c3];
              proj(U(x), V(y), w);
              return { x: T[0], y: T[1], d: T[2], w, gx: x, gy: y, n: nn, gi: giOf(U(x)), gj: gjOf(V(y)) };
            };
            const cut = (k1, k2) => {
              const p = isIn(k1) ? k1 : k2, q = p === k1 ? k2 : k1, xp = X(p), yp = Y(p), xq = X(q), yq = Y(q);
              const ddx = xq - xp, ddy = yq - yp, A = ddx * ddx + ddy * ddy, B = 2 * (xp * ddx + yp * ddy), C = xp * xp + yp * yp - R2;
              const t = Math.max(0, Math.min(1, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)));
              return pt(xp + (xq - xp) * t, yp + (yq - yp) * t, pw[p] + (pw[q] - pw[p]) * t);
            };
            let poly = [];
            for (let e = 0; e < 4; e++) {
              const kc = K4[e], kn = K4[(e + 1) % 4];
              if (!isIn(kc)) poly.push(Object.assign(pt(X(kc), Y(kc), pw[kc]), { corner: true }));
              if (isIn(kc) !== isIn(kn)) poly.push(Object.assign(cut(kc, kn), { leave: !isIn(kc) }));
            }
            // along the circle, from where the outline leaves the outside part to where it comes back:
            // the points of the liquid's arc (from the second to the first), in the opposite order
            const full = [];
            poly.forEach((p, m) => {
              full.push(p);
              const q = poly[(m + 1) % poly.length];
              if (p.leave !== true || q.leave !== false) return;
              const ta = Math.atan2(q.gy, q.gx);
              let dt = Math.atan2(p.gy, p.gx) - ta;
              while (dt <= 0) dt += 2 * Math.PI;
              if (dt > Math.PI) return;
              const steps = Math.ceil(dt / 0.05), arc = [];
              for (let n = 1; n < steps; n++) {
                const th = ta + dt * n / steps, x = VS.R * Math.cos(th), y = VS.R * Math.sin(th);
                const fa = (x - xa) / (xb - xa), fb = (y - ya) / (yb - ya);
                arc.push(pt(x, y, pw[K4[0]] * (1 - fa) * (1 - fb) + pw[K4[1]] * fa * (1 - fb) + pw[K4[2]] * fa * fb + pw[K4[3]] * (1 - fa) * fb));
              }
              full.push(...arc.reverse());
            });
            if (full.length >= 3) {
              // (starting at the corner farthest from the circle, from which the whole part is seen: the
              // depths of the other surfaces are laid over the pixels as a fan from there)
              let f0 = 0;
              full.forEach((p, m) => { if (p.corner && p.gx * p.gx + p.gy * p.gy > full[f0].gx * full[f0].gx + full[f0].gy * full[f0].gy) f0 = m; });
              const ring = full.slice(f0).concat(full.slice(0, f0));
              cells.push({ s, poly: ring, piece: true, depth: ring.reduce((t, p) => t + p.d, 0) * 4 / ring.length, shade, t: (ring.reduce((t, p) => t + p.w, 0) / (ring.length * EZ) + 1) / 2, inR: false });
            }
            cells.push({ s, pts, depth: dsum * 4 / pts.length, shade, t: (wsum / (pts.length * EZ) + 1) / 2, inR: true });
            continue;
          }
          cells.push({ s, pts, depth: dsum * 4 / pts.length, shade, t: (wsum / (pts.length * EZ) + 1) / 2, inR: chosen && inRegion(i, j) });
        }
      }
    }
    // where two surfaces end at the same place (the two halves of a sphere at its rim), their edges are
    // made to meet exactly: the edges found for each surface differ a little in height (a square root
    // near 0), which left a hair-thin gap through which the far side of the solid showed (1.9.2)
    if (D.series.length > 1) {
      const byKey = new Map();
      for (const s of D.series) if (s.rimP) for (const key in s.rimP) { const a = byKey.get(key); if (a) a.push(s.rimP[key]); else byKey.set(key, [s.rimP[key]]); }
      for (const ps of byKey.values()) {
        for (let a = 0; a < ps.length; a++) {
          for (let b = a + 1; b < ps.length; b++) {
            const p = ps[a], r = ps[b];
            if (!(Math.abs(p.u - r.u) + Math.abs(p.v - r.v) < 2e-3 && Math.abs(p.w - r.w) < 0.04 * EZ)) continue;
            const u = (p.u + r.u) / 2, v = (p.v + r.v) / 2, w = (p.w + r.w) / 2;
            proj(u, v, w);
            for (const o of [p, r]) { o.u = u; o.v = v; o.w = w; o.x = T[0]; o.y = T[1]; o.d = T[2]; o.gi = giOf(u); o.gj = gjOf(v); }
          }
        }
      }
    }
    // the light near the edges where surfaces end, as on a sphere (1.9.3)
    for (const s of D.series) rimModel(s, D, U, V, camN);
    // one surface, or surfaces that close up into one solid (the two halves of a sphere, 1.9.3): colored
    // by height, as one object
    const single = !!D.oneSolid, mesh = D.nx <= 45;
    const vc = vf ? volumeColor(D, cells, single, dark, vf, vg) : null;
    const lmesh = vf ? liquidMesh(D, VS, vf, vg, { U, V, Wz, EZ, EX, EY }) : null;
    // a soft shadow of the measured solid on the floor of the box, seen from above (1.8.4), tinted
    // by the liquid as the light that goes through a colored liquid is (1.9.1)
    if (vc && se > 0.05) {
      g.save();
      g.filter = 'blur(7px)';
      g.fillStyle = dark ? 'rgba(0,0,0,0.32)' : 'rgba(' + vc.deep.map((v) => Math.round(v * 0.55)).join(',') + ',0.16)';
      g.beginPath();
      if (!Q3.volShade.disk) pane0([[-EX, -EY], [EX, -EY], [EX, EY], [-EX, EY]]);
      else {
        const R = Q3.volShade.R, ok = [];
        for (let n = 0; n <= 72; n++) { const th = 2 * Math.PI * n / 72, x = Math.max(x0, Math.min(x1, R * Math.cos(th))), y = Math.max(y0, Math.min(y1, R * Math.sin(th))); ok.push([U(x), V(y)]); }
        pane0(ok);
      }
      g.fill();
      g.restore();
    }
    // the parts that are not measured (other surfaces, outside the disk) fade into the background
    let fadeTo = null;
    if (vc && cells.some((q) => !q.vol && !q.inR)) fadeTo = cssRgb(css.getPropertyValue('--plot-bg').trim()) || (dark ? [24, 26, 32] : [255, 255, 255]);
    // the cells as triangles with the normal, the color (by height for one surface) and the grid
    // coordinates at their corners, laid over the pixels with a depth buffer (1.9.2)
    const tb = triBuf(Q3);
    const colorAt = (s, w) => (single ? viridis((w / EZ + 1) / 2) : s.drawRgb || s.rgb);
    // (a corner, and for rimModel its G, its side of the edge and the level part of its normal)
    const vtxK = (s, k) => {
      const P = s.proj, N = s.cnrm, c3 = colorAt(s, P.pw[k]), rm = s.rm;
      const v = [P.px[k], P.py[k], P.pd[k], N[3 * k], N[3 * k + 1], N[3 * k + 2], c3[0], c3[1], c3[2], k % D.nx, (k / D.nx) | 0];
      if (rm && rm.G[k] >= 0) { v.G = rm.G[k]; v.sg = rm.SG[k]; v.L = rm.L(k); v.zr = rm.ZR[k]; v.u = U(xs[k % D.nx]); v.v = V(ys[(k / D.nx) | 0]); }
      return v;
    };
    const vtxP = (s, p) => {
      const c3 = colorAt(s, p.w), v = [p.x, p.y, p.d, p.n[0], p.n[1], p.n[2], c3[0], c3[1], c3[2], p.gi, p.gj];
      if (p.G >= 0 && p.L) { v.G = p.G; v.sg = p.sg; v.L = p.L; v.zr = p.zr; v.u = p.u; v.v = p.v; }
      return v;
    };
    // a triangle near the edge of a surface (rimModel), cut into RS × RS smaller ones whose corners lie
    // on the rounded surface: G (and the edge's height, the level part of the normal and the grid
    // coordinates) in a straight line between the corners, the height zr ± √G, and the normal (not
    // made of length 1) the level part plus 2·√G up. On a sphere this normal is in proportion to the
    // place itself, so blending it in a straight line across each small triangle is right, and the light
    // stays smooth across the rim, where the two halves meet.
    // (fewer while the graph is turned)
    const RS = Q3.turning ? 2 : 3, rsub = new Array((RS + 1) * (RS + 2) / 2), upN = camN(0, 0, 2);
    const rimTri = (s, A, B, C) => {
      let m = 0;
      for (let j = 0; j <= RS; j++) {
        for (let i = 0; i + j <= RS; i++) {
          const b = i / RS, c = j / RS, a = 1 - b - c, L3 = (o) => a * A[o] + b * B[o] + c * C[o];
          const G = a * A.G + b * B.G + c * C.G, w = a * A.zr + b * B.zr + c * C.zr + A.sg * Math.sqrt(G > 0 ? G : 0);
          proj(a * A.u + b * B.u + c * C.u, a * A.v + b * B.v + c * C.v, w);
          const c3 = colorAt(s, w), h = Math.sqrt(G > 0 ? G : 0);
          rsub[m++] = [T[0], T[1], T[2], a * A.L[0] + b * B.L[0] + c * C.L[0] + h * upN[0], a * A.L[1] + b * B.L[1] + c * C.L[1] + h * upN[1], a * A.L[2] + b * B.L[2] + c * C.L[2] + h * upN[2], c3[0], c3[1], c3[2], L3(9), L3(10)];
        }
      }
      // (the point (i, j) is number j·(RS + 1) − j·(j − 1)/2 + i)
      const at = (i, j) => rsub[j * (RS + 1) - (j * (j - 1)) / 2 + i];
      for (let j = 0; j < RS; j++) {
        for (let i = 0; i + j < RS; i++) {
          tb.add(at(i, j), at(i + 1, j), at(i, j + 1));
          if (i + j + 1 < RS) tb.add(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
        }
      }
    };
    let jelly = 0, faded = 0, rimTris = 0;
    for (const cl of cells) {
      // the measured parts of the surfaces: drawn as the liquid, below
      if (cl.inR) { jelly++; continue; }
      if (fadeTo) faded++;
      // (the grid points of a cell cut at an edge as the other grid points: their normals may have been
      // improved since the cell was made, rimModel)
      const vs = cl.poly ? cl.poly.map((p) => (p.k !== undefined ? vtxK(cl.s, p.k) : vtxP(cl.s, p))) : cl.pts.map((k) => vtxK(cl.s, k));
      // a cell near the edge of a surface whose corners all have G, on the same side of the edge: the
      // light from G for each pixel (rimModel)
      if (vs.every((v) => v.G >= 0 && v.sg === vs[0].sg)) {
        for (let m = 1; m + 1 < vs.length; m++) rimTri(cl.s, vs[0], vs[m], vs[m + 1]);
        rimTris += vs.length - 2;
        continue;
      }
      for (let m = 1; m + 1 < vs.length; m++) tb.add(vs[0], vs[m], vs[m + 1]);
    }
    const surf = surfacePaint(g, tb, { W, H, q: Q3.turning ? Math.min(dpr, 1) : Math.min(dpr, 3), dark, mesh: mesh ? (dark ? [0, 0, 0, 0.38, 0.7] : [20, 30, 50, 0.28, 0.7]) : null, fade: fadeTo, cache: Q3 });
    // (what was drawn, for the tests)
    c.dataset.surf = JSON.stringify({ tris: tb.n, shown: surf.shown, q: surf.q, mesh, rimTris, groups: D.groups || [], oneSolid: !!D.oneSolid });
    // the liquid, over what is drawn behind it (fewer pixels while the graph is turned)
    let liquid = null;
    if (vc) liquid = liquidPaint(g, c, { proj, T, U, V, dpr, W, H, ca, sa, ce, se, S }, lmesh, cells.filter((q) => !q.inR), vc, dark, Q3.turning ? Math.min(dpr, 1) : Math.min(dpr, 2));
    // the color of the solid in the box, and what was drawn (for the tests)
    const lg = Q3.volUI && Q3.volUI.legend;
    if (lg) { lg.hidden = !vc; if (vc) { lg.firstChild.style.background = vc.swatch; lg.firstChild.style.borderColor = vc.line; } }
    if (vc) c.dataset.vol = JSON.stringify({ hue: vc.hue, color: vc.css, walls: lmesh.walls, floor: lmesh.floor, tris: lmesh.tris, jelly, liquid: liquid.shown, thick: liquid.thick, odd: liquid.odd, q: liquid.q, faded });
    else delete c.dataset.vol;
    // axes on the front edges of the floor and the leftmost vertical edge, with labels
    const un = -ub, vn = -vb;
    let ze = null;
    for (const [eu, ev] of [[-EX, -EY], [-EX, EY], [EX, -EY], [EX, EY]]) { proj(eu, ev, 0); if (!ze || T[0] < ze.x) ze = { u: eu, v: ev, x: T[0] }; }
    g.strokeStyle = axisColor; g.lineWidth = 1.2; g.beginPath();
    line(-EX, vn, wb, EX, vn, wb); line(un, -EY, wb, un, EY, wb); line(ze.u, ze.v, -EZ, ze.u, ze.v, EZ);
    g.stroke();
    g.fillStyle = axisColor; g.font = '11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const out = (e, d) => e + Math.sign(e) * d; // a little outside the edge of the box
    for (const x of gx) { proj(U(x), out(vn, 0.17), wb); g.fillText(fmt(x, stx), T[0], T[1]); }
    for (const y of gy) { proj(out(un, 0.17), V(y), wb); g.fillText(fmt(y, sty), T[0], T[1]); }
    g.textAlign = 'right';
    for (const z of gz) {
      if (Math.abs(Wz(z) - wb) < 0.1) continue;  // at the floor the x or y labels are there
      proj(ze.u, ze.v, Wz(z)); g.fillText(fmt(z, stz), T[0] - 7, T[1]);
    }
    g.font = 'bold 13px system-ui, sans-serif'; g.textAlign = 'center';
    proj(0, out(vn, 0.4), wb); g.fillText('x', T[0], T[1]);
    proj(out(un, 0.4), 0, wb); g.fillText('y', T[0], T[1]);
    proj(ze.u, ze.v, EZ); g.fillText('z', T[0], T[1] - 14);
    // points (the rows of a matrix, the solution of a linear system), in front of the surfaces
    for (const p of Q3.points || []) {
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      // a thin line down to the floor shows where the point is
      const pw = Math.max(-EZ, Math.min(EZ, Wz(p.z)));
      g.strokeStyle = axisColor; g.lineWidth = 1; g.setLineDash([3, 3]);
      g.beginPath(); line(U(p.x), V(p.y), pw, U(p.x), V(p.y), wb); g.stroke();
      g.setLineDash([]);
      proj(U(p.x), V(p.y), wb); g.fillStyle = axisColor; g.fillRect(T[0] - 1.5, T[1] - 1.5, 3, 3);
      proj(U(p.x), V(p.y), pw);
      g.fillStyle = p.label ? '#e11d48' : COLORS[0]; g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(T[0], T[1], 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (p.label) { g.fillStyle = axisColor; g.font = '12px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(p.label, T[0] + 8, T[1] - 8); }
    }
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
    Q3.tip.textContent = best.s.expr + tr(':  x = ', '：x = ') + num(D.xs[i]) + ', y = ' + num(D.ys[j]) + ', z = ' + num(best.s.z[best.k]);
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
      // while the graph is turned, the surfaces and the liquid are drawn with fewer pixels; in full
      // when the finger is lifted
      Q3.turning = true;
      requestDraw3d();
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!moved && pts.size === 0 && e.type === 'pointerup') pick3d(e.clientX, e.clientY);
      start = pts.size ? snapshot() : null;
      if (!pts.size && Q3.turning) { Q3.turning = false; requestDraw3d(); }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  // ------------------------------------------- shapes: area, length, volume
  // Menu "Shapes": choose a shape, type its sizes, and its area, lengths, volume and surface area
  // are shown at once, with a picture that names the sizes. Every value is calculated by the engine
  // from a formula with the sizes put in ({r} and so on), so exact values (4π), units (2 cm gives
  // cm²) and the precision of the settings work as on the calculator. A circle, an ellipse and a
  // sphere can also be shown in the graph, where the same values come from integrals.
  // A shape: k key, d 2 (flat) or 3 (solid), name, p sizes [key, label, kind, symbol] (kind: '' a
  // length, 'deg' an angle in degrees, 'n' a count), def the first values, out results [label,
  // formula as shown, expression, power of the length (1 a length, 2 an area, 3 a volume), true: a
  // number only], pic the picture (SVG, 160 × 110), graph: it can be drawn.
  const GEO_TRI = '<path class="g" d="M20 90H140L95 20Z"/>';
  const GEO_S = '(({a} + {b} + {c}) / 2)';
  const GEO = [
    { k: 'circle', d: 2, name: tr('Circle', '円'), graph: true, p: [['r', tr('Radius', '半径')]], def: ['2'],
      out: [[tr('Area', '面積'), 'π r²', 'π × {r}^2', 2], [tr('Circumference', '円周'), '2π r', '2π × {r}', 1], [tr('Diameter', '直径'), '2 r', '2 × {r}', 1]],
      pic: '<circle class="g" cx="80" cy="55" r="42"/><path class="d" d="M80 55H122"/><circle class="c" cx="80" cy="55" r="2.5"/><text x="97" y="49">r</text>' },
    { k: 'ellipse', d: 2, name: tr('Ellipse', '楕円'), graph: true, p: [['a', tr('Half width', '横の半径')], ['b', tr('Half height', '縦の半径')]], def: ['3', '2'],
      out: [[tr('Area', '面積'), 'π a b', 'π × {a} × {b}', 2],
        [tr('Perimeter', '周の長さ'), tr('no simple formula: by a sum', '簡単な公式がないため数値で計算'), 'sum(√({a}^2 × sin(\\k × {turn}/360)^2 + {b}^2 × cos(\\k × {turn}/360)^2), 1, 360, \\k) × 2π/360', 1, true]],
      pic: '<ellipse class="g" cx="80" cy="55" rx="62" ry="38"/><path class="d" d="M80 55H142M80 55V17"/><circle class="c" cx="80" cy="55" r="2.5"/><text x="108" y="50">a</text><text x="66" y="38">b</text>' },
    { k: 'sector', d: 2, name: tr('Sector', '扇形'), p: [['r', tr('Radius', '半径')], ['t', tr('Angle (degrees)', '中心角（度）'), 'deg', 'θ']], def: ['3', '60'],
      out: [[tr('Area', '面積'), 'π r² × θ/360', 'π × {r}^2 × {t} / 360', 2], [tr('Arc length', '弧の長さ'), '2π r × θ/360', '2π × {r} × {t} / 360', 1], [tr('Perimeter', '周の長さ'), tr('arc + 2 r', '弧 + 2 r'), '2π × {r} × {t} / 360 + 2 × {r}', 1]],
      pic: '<path class="g" d="M36 92H132A96 96 0 0 0 97.7 18.5Z"/><path class="d" d="M62 92A26 26 0 0 0 52.7 72.1"/><text x="80" y="106">r</text><text x="66" y="80">θ</text>' },
    { k: 'rect', d: 2, name: tr('Rectangle', '長方形'), p: [['a', tr('Width', '横')], ['b', tr('Height', '縦')]], def: ['4', '3'],
      out: [[tr('Area', '面積'), 'a b', '{a} × {b}', 2], [tr('Perimeter', '周の長さ'), '2 (a + b)', '2 × ({a} + {b})', 1], [tr('Diagonal', '対角線'), '√(a² + b²)', '√({a}^2 + {b}^2)', 1]],
      pic: '<rect class="g" x="24" y="22" width="108" height="62"/><path class="d" d="M24 84L132 22"/><text x="76" y="100">a</text><text x="139" y="58">b</text>' },
    { k: 'tri', d: 2, name: tr('Triangle (base, height)', '三角形（底辺と高さ）'), p: [['b', tr('Base', '底辺')], ['h', tr('Height', '高さ')]], def: ['4', '3'],
      out: [[tr('Area', '面積'), 'b h / 2', '{b} × {h} / 2', 2]],
      pic: GEO_TRI + '<path class="d" d="M95 20V90"/><text x="74" y="105">b</text><text x="101" y="62">h</text>' },
    { k: 'tri3', d: 2, name: tr('Triangle (3 sides)', '三角形（3 辺）'), p: [['a', tr('Side', '辺')], ['b', tr('Side', '辺')], ['c', tr('Side', '辺')]], def: ['3', '4', '5'],
      out: [[tr('Area', '面積'), tr("Heron's formula", 'ヘロンの公式') + ' √(s(s−a)(s−b)(s−c))', `√(${GEO_S} × (${GEO_S} − {a}) × (${GEO_S} − {b}) × (${GEO_S} − {c}))`, 2], [tr('Perimeter', '周の長さ'), 'a + b + c', '{a} + {b} + {c}', 1]],
      pic: GEO_TRI + '<text x="46" y="52">a</text><text x="123" y="54">b</text><text x="76" y="105">c</text>' },
    { k: 'rtri', d: 2, name: tr('Right triangle', '直角三角形'), p: [['a', tr('Base', '底辺')], ['b', tr('Height', '高さ')]], def: ['3', '4'],
      out: [[tr('Hypotenuse c', '斜辺 c'), '√(a² + b²)', '√({a}^2 + {b}^2)', 1], [tr('Area', '面積'), 'a b / 2', '{a} × {b} / 2', 2], [tr('Perimeter', '周の長さ'), 'a + b + c', '{a} + {b} + √({a}^2 + {b}^2)', 1]],
      pic: '<path class="g" d="M30 90H135L30 22Z"/><path class="e" d="M30 79H41V90"/><text x="78" y="105">a</text><text x="15" y="60">b</text><text x="88" y="50">c</text>' },
    { k: 'trap', d: 2, name: tr('Trapezoid', '台形'), p: [['a', tr('Top', '上底')], ['b', tr('Bottom', '下底')], ['h', tr('Height', '高さ')]], def: ['2', '4', '3'],
      out: [[tr('Area', '面積'), '(a + b) h / 2', '({a} + {b}) × {h} / 2', 2]],
      pic: '<path class="g" d="M20 90H140L112 28H52Z"/><path class="d" d="M52 28V90"/><text x="78" y="22">a</text><text x="76" y="105">b</text><text x="58" y="64">h</text>' },
    { k: 'poly', d: 2, name: tr('Regular polygon', '正多角形'), p: [['n', tr('Number of sides', '辺の数'), 'n'], ['a', tr('Side', '1 辺の長さ')]], def: ['6', '2'],
      out: [[tr('Area', '面積'), 'n a² / (4 tan(180°/n))', '{n} × {a}^2 / (4 × tan({turn} / (2 × {n})))', 2], [tr('Perimeter', '周の長さ'), 'n a', '{n} × {a}', 1]],
      pic: (v) => {
        const n = /^\d+$/.test(v.n) && +v.n >= 3 && +v.n <= 24 ? +v.n : 6, pt = [];
        for (let i = 0; i < n; i++) { const t = Math.PI / 2 + Math.PI / n + i * 2 * Math.PI / n; pt.push((80 + 44 * Math.cos(t)).toFixed(1) + ' ' + (52 + 44 * Math.sin(t)).toFixed(1)); }
        return `<path class="g" d="M${pt.join('L')}Z"/><text x="76" y="${(52 + 44 * Math.cos(Math.PI / n) + 13).toFixed(0)}">a</text>`;
      } },
    { k: 'sphere', d: 3, name: tr('Sphere', '球'), graph: true, p: [['r', tr('Radius', '半径')]], def: ['2'],
      out: [[tr('Volume', '体積'), '4/3 π r³', '4/3 × π × {r}^3', 3], [tr('Surface area', '表面積'), '4π r²', '4π × {r}^2', 2]],
      pic: '<circle class="g" cx="80" cy="55" r="44"/><path class="e" d="M36 55A44 13 0 0 0 124 55"/><path class="e h" d="M36 55A44 13 0 0 1 124 55"/><path class="d" d="M80 55H124"/><circle class="c" cx="80" cy="55" r="2.5"/><text x="98" y="49">r</text>' },
    { k: 'cyl', d: 3, name: tr('Cylinder', '円柱'), p: [['r', tr('Radius', '半径')], ['h', tr('Height', '高さ')]], def: ['2', '5'],
      out: [[tr('Volume', '体積'), 'π r² h', 'π × {r}^2 × {h}', 3], [tr('Surface area', '表面積'), '2π r (r + h)', '2π × {r} × ({r} + {h})', 2], [tr('Side area', '側面積'), '2π r h', '2π × {r} × {h}', 2]],
      pic: '<path class="g" d="M38 24V88A42 12 0 0 0 122 88V24"/><ellipse class="g" cx="80" cy="24" rx="42" ry="12"/><path class="e h" d="M38 88A42 12 0 0 1 122 88"/><path class="d" d="M80 24H122"/><text x="96" y="20">r</text><text x="128" y="62">h</text>' },
    { k: 'cone', d: 3, name: tr('Cone', '円錐'), p: [['r', tr('Radius', '半径')], ['h', tr('Height', '高さ')]], def: ['3', '4'],
      out: [[tr('Volume', '体積'), 'π r² h / 3', 'π × {r}^2 × {h} / 3', 3], [tr('Surface area', '表面積'), 'π r (r + s)', 'π × {r} × ({r} + √({r}^2 + {h}^2))', 2], [tr('Side area', '側面積'), 'π r s', 'π × {r} × √({r}^2 + {h}^2)', 2], [tr('Slant height s', '母線 s'), '√(r² + h²)', '√({r}^2 + {h}^2)', 1]],
      pic: '<path class="g" d="M34 88L80 12L126 88A46 12 0 0 1 34 88"/><path class="e h" d="M34 88A46 12 0 0 1 126 88"/><path class="d" d="M80 12V88H126"/><text x="85" y="54">h</text><text x="99" y="82">r</text><text x="110" y="46">s</text>' },
    { k: 'box', d: 3, name: tr('Box', '直方体'), p: [['a', tr('Width', '横')], ['b', tr('Depth', '奥行き')], ['c', tr('Height', '高さ')]], def: ['4', '3', '2'],
      out: [[tr('Volume', '体積'), 'a b c', '{a} × {b} × {c}', 3], [tr('Surface area', '表面積'), '2 (a b + b c + c a)', '2 × ({a} × {b} + {b} × {c} + {c} × {a})', 2], [tr('Diagonal', '対角線'), '√(a² + b² + c²)', '√({a}^2 + {b}^2 + {c}^2)', 1]],
      pic: '<path class="g" d="M22 42H112V94H22ZM22 42L48 20H138L112 42M138 20V72L112 94"/><text x="62" y="108">a</text><text x="130" y="94">b</text><text x="144" y="50">c</text>' },
    { k: 'pyr', d: 3, name: tr('Square pyramid', '正四角錐'), p: [['a', tr('Side of the base', '底面の 1 辺')], ['h', tr('Height', '高さ')]], def: ['4', '3'],
      out: [[tr('Volume', '体積'), 'a² h / 3', '{a}^2 × {h} / 3', 3], [tr('Surface area', '表面積'), 'a² + 2 a √((a/2)² + h²)', '{a}^2 + 2 × {a} × √(({a} / 2)^2 + {h}^2)', 2]],
      pic: '<path class="g" d="M22 88H104L136 66L80 12Z"/><path class="g" d="M80 12L104 88"/><path class="e h" d="M22 88L54 66H136M80 12L54 66"/><path class="d" d="M80 12V77"/><text x="58" y="103">a</text><text x="85" y="52">h</text>' },
    { k: 'torus', d: 3, name: tr('Torus (ring)', 'トーラス（輪）'), p: [['R', tr('Radius of the ring', '輪の半径')], ['r', tr('Radius of the tube', '管の半径')]], def: ['3', '1'],
      out: [[tr('Volume', '体積'), '2π² R r²', '2π^2 × {R} × {r}^2', 3], [tr('Surface area', '表面積'), '4π² R r', '4π^2 × {R} × {r}', 2]],
      pic: '<ellipse class="g" cx="80" cy="55" rx="66" ry="38"/><path class="g hole" d="M52 52Q80 72 108 52Q80 38 52 52Z"/><path class="d" d="M80 55H127"/><path class="d r" d="M127 55H146"/><text x="98" y="49">R</text><text x="133" y="49">r</text>' }
  ];
  const GEO_UNITS = ['', 'mm', 'cm', 'm', 'km', 'in', 'ft'];
  // a size as it goes into an expression: with the unit of the panel when it has none of its own
  function geoValue(v, kind, unit) {
    v = normalizeExpr(v);
    v += ')'.repeat(scanBox(v).open); // a "(" that was not closed
    if (!kind && unit && !/\p{L}/u.test(v.replace(/π/g, ''))) return `(${v} ${unit})`;
    return /^[\d.]+$/.test(v) ? v : `(${v})`;
  }
  // A size that is not a plain number (√2, 1/3, 2 cm, −2, abc): the engine works it out. It must
  // be a positive number, or (a length) a positive number with a unit of length. Returns what is
  // wrong, or ''. (Without this, a negative radius gave an area, and letters were read as units.)
  async function geoSizeProblem(t, kind) {
    const sc = scanBox(t);
    if (sc.extra || sc.comma || sc.bracket) return tr('A size is one number or expression (the decimal point is ".")', '大きさは 1 つの数か式で入れてください（小数点は「.」）');
    if (/^[\d.]+$/.test(t)) return '';
    const txt = t + ')'.repeat(sc.open);
    const val = async (e) => {
      const r = await Bridge.send('calc', { expr: e, opts: Object.assign(engineOpts(), { approx: 'approx', precision: 12, grouping: false, base: 10 }), timeout: 1500 });
      if (!r.ok || r.timeout || !r.result || (r.messages || []).some((m) => m.type === 'error')) return null;
      const m = /^(?:≈\s*)?([−-]?(?:\d+\.?\d*|\.\d+)(?:E[−+-]?\d+)?)\s*(.*)$/.exec(r.result.replace(/[\u202f\u2009]/g, '').trim());
      return m ? { n: Number(m[1].replace(/−/g, '-')), unit: m[2].trim() } : null;
    };
    const check = tr('Check the sizes: a size is a positive number, such as 2, 1/3 or √2', '大きさを確認してください（2、1/3、√2 のような正の数で入れます）');
    const a = await val(txt);
    if (!a || !isFinite(a.n)) return check;
    if (!(a.n > 0)) return tr('The sizes must be positive numbers', '大きさは正の数にしてください');
    if (!a.unit) return '';
    if (kind) return check;
    // with a unit: it must be a length (2 cm, 1 in), not a mass or letters read as units
    const b = await val(`(${txt}) to m`);
    return b && b.unit === 'm' && b.n > 0 ? '' : tr('A size with a unit needs a unit of length, such as cm, m or in', '単位を付けるときは、cm・m・in のような長さの単位にしてください');
  }
  // what is wrong with the sizes that are plain numbers (the others: geoSizeProblem), or ''
  function geoProblem(sh, v) {
    const num = {};
    for (const [n, , kind] of sh.p) {
      if (!/^[\d.]+$/.test(v[n])) continue;
      num[n] = Number(v[n]);
      if (!(num[n] > 0)) return tr('The sizes must be positive numbers', '大きさは正の数にしてください');
      if (kind === 'n' && (num[n] < 3 || num[n] % 1)) return tr('The number of sides is a whole number from 3', '辺の数は 3 以上の整数にしてください');
      if (kind === 'deg' && num[n] > 360) return tr('The angle is from 0 to 360 degrees', '中心角は 0〜360 度にしてください');
    }
    const { a, b, c } = num;
    if (sh.k === 'tri3' && [a, b, c].every(isFinite) && (a + b <= c || b + c <= a || c + a <= b)) return tr('These three sides do not make a triangle (each side must be shorter than the other two together)', 'この 3 辺では三角形になりません（どの辺も、ほかの 2 辺の和より短くします）');
    if (sh.k === 'torus' && isFinite(num.R) && isFinite(num.r) && num.r > num.R) return tr('The tube must not be wider than the ring (r ≤ R)', '管の半径は輪の半径以下にしてください（r ≤ R）');
    return '';
  }
  function openShapes() {
    const p = panel('shapes', tr('Shapes: area, length, volume', '図形：面積・長さ・体積'), (p) => {
      const saved = store.get('qalc.shapes', {}) || {};
      const G = { k: GEO.some((s) => s.k === saved.k) ? saved.k : 'circle', unit: GEO_UNITS.indexOf(saved.unit) >= 0 ? saved.unit : '', vals: saved.v || {}, seq: 0, last: {} };
      const cur = () => GEO.find((s) => s.k === G.k);
      const save = () => store.set('qalc.shapes', { k: G.k, unit: G.unit, v: G.vals });
      const b2 = el('button', { text: tr('Flat shapes', '平面の図形') }), b3 = el('button', { text: tr('Solids', '立体の図形') });
      const chips = el('div', { class: 'geo-chips', role: 'group', 'aria-label': tr('Shape', '図形') });
      const pic = el('div', { class: 'geo-pic' }), sizes = el('div', { class: 'geo-sizes' });
      const outs = el('div', { class: 'geo-out', 'aria-live': 'polite' });
      const unit = el('select', { 'aria-label': tr('Unit of the lengths', '長さの単位') });
      for (const u of GEO_UNITS) unit.append(el('option', { value: u, text: u || tr('no unit', '単位なし') }));
      unit.value = G.unit;
      const graph = tapButton({ class: 'btn geo-graph', text: tr('📈 Show in a graph', '📈 グラフで見る') }, () => {
        const sh = cur(), v = values();
        if (sh.p.some(([n]) => !v[n] || /\p{L}/u.test(v[n].replace(/π/g, '')))) { toast(tr('The graph is drawn from sizes that are numbers without units', 'グラフは、単位のない数の大きさで描きます'), 2600); return; }
        if (sh.k === 'sphere') showSphere(v.r); else drawShape2d(sh.k, v);
      });
      let inputs = {}, rows = [];
      const values = () => { const v = {}; for (const [n] of cur().p) v[n] = normalizeExpr(inputs[n].value); return v; };
      const svg = (sh, v, small) => {
        let t = typeof sh.pic === 'function' ? sh.pic(v || {}) : sh.pic;
        if (small) t = t.replace(/<text[^>]*>[^<]*<\/text>/g, '').replace(/<path class="d[^>]*>/g, '').replace(/<circle class="c"[^>]*>/g, '');
        return `<svg viewBox="0 0 160 110" ${small ? 'aria-hidden="true"' : 'role="img" aria-label="' + sh.name + '"'}>${t}</svg>`;
      };
      // the results: one request for each, in the order of the list; an older run is given up
      const run = debounce(async () => {
        const sh = cur(), v = values(), seq = ++G.seq;
        G.vals[sh.k] = sh.p.map(([n]) => inputs[n].value);
        save();
        if (typeof sh.pic === 'function') pic.innerHTML = svg(sh, v);
        let problem = sh.p.some(([n]) => !v[n]) ? tr('Enter the sizes', '大きさを入れてください') : geoProblem(sh, v);
        if (!problem) {
          for (const [n, , kind] of sh.p) {
            problem = await geoSizeProblem(v[n], kind);
            if (seq !== G.seq) return;
            if (problem) break;
          }
        }
        outs.classList.toggle('bad', !!problem);
        msg.textContent = problem;
        for (const row of rows) { row.expr = ''; row.result = ''; row.node.dataset.value = ''; if (problem) { row.val.textContent = '—'; row.val.classList.remove('math'); } }
        if (problem) return;
        // Units: sizes that are plain numbers are calculated as numbers, so that exact values stay
        // (12π), and the unit of the panel is written after the result (cm³). Sizes with units of
        // their own are calculated with them; the result is asked for in their unit when they all
        // have the same one (else the engine chooses, and "2π × 2 in" would come out in feet and inches).
        const own = Array.from(new Set([].concat(...sh.p.map(([n, , kind]) => (kind ? [] : v[n].replace(/π/g, '').match(/\p{L}+/gu) || [])))));
        const target = own.length === 1 ? own[0] : G.unit;
        for (const row of rows) {
          const pow = row.def[3], to = (u) => ' to ' + u + (pow > 1 ? '^' + pow : '');
          const sub = (unit) => row.def[2].replace(/\{(\w+)\}/g, (m, n) => (n === 'turn' ? fullTurn() : geoValue(v[n], (sh.p.find((q) => q[0] === n) || [])[2], unit)));
          let expr = sub(''), full = expr, suffix = '';
          if (!own.length && G.unit) { full = `(${sub(G.unit)})` + to(G.unit); suffix = ' ' + G.unit + ['', '', '²', '³'][pow]; }
          else if (own.length) { expr = sub(G.unit || target); if (target) expr = `(${expr})` + to(target); full = expr; } // "2 in" and "4": both in inches
          const r = await Bridge.send('calc', { expr, opts: Object.assign(engineOpts(), row.def[4] ? { approx: 'approx' } : {}), timeout: 4000 });
          if (seq !== G.seq) return;
          const bad = !r.ok || !r.result || r.timeout || (r.messages || []).some((m) => m.type === 'error') || /(^|[^\p{L}])i($|[^\p{L}])|undefined/u.test(r.result);
          if (bad) { row.val.textContent = '—'; row.val.classList.remove('math'); continue; }
          row.expr = full; row.result = r.result + suffix; row.shown = resultText(r) + suffix;
          row.node.dataset.value = row.shown;
          showResult(row.val, row.shown);
        }
      }, 220);
      const choose = (k) => {
        G.k = k;
        const sh = cur();
        G.last[sh.d] = k;
        b2.classList.toggle('on', sh.d === 2); b3.classList.toggle('on', sh.d === 3);
        b2.setAttribute('aria-pressed', String(sh.d === 2)); b3.setAttribute('aria-pressed', String(sh.d === 3));
        chips.textContent = '';
        for (const s of GEO.filter((x) => x.d === sh.d)) {
          chips.append(tapButton({ class: 'geo-chip' + (s.k === k ? ' on' : ''), 'aria-pressed': String(s.k === k), html: svg(s, null, true) + '<span></span>' }, () => { if (s.k !== G.k) { typed(); choose(s.k); } }));
          chips.lastChild.lastChild.textContent = s.name;
        }
        const old = G.vals[k] || [];
        inputs = {}; sizes.textContent = '';
        sh.p.forEach(([n, label, kind, sym], i) => {
          inputs[n] = el('input', { inputmode: 'text', autocapitalize: 'off', spellcheck: 'false', value: old[i] !== undefined ? old[i] : sh.def[i], 'aria-label': label });
          inputs[n].addEventListener('input', run);
          inputs[n].addEventListener('focus', () => inputs[n].select());
          sizes.append(el('label', { class: 'geo-size' }, el('span', { class: 'geo-lbl' }, label, kind === 'n' ? '' : el('i', { text: ' ' + (sym || n) })), inputs[n],
            el('span', { class: 'geo-unit', text: kind ? (kind === 'deg' ? '°' : '') : G.unit })));
        });
        pic.innerHTML = svg(sh, values());
        rows = sh.out.map((def) => {
          const val = el('span', { class: 'geo-val', text: '…' });
          const row = { def, val, expr: '', result: '' };
          row.node = tapButton({ class: 'geo-row' }, async () => {
            if (!row.expr) return;
            const key = await sheet(def[0] + '  ' + clip(row.shown, 60), [['use', tr('Put the expression into the input field', '式を入力欄に入れる'), 'accent'], ['copy', tr('Copy the result', '結果をコピー')]]);
            if (key === 'use') useExample(row.expr);
            else if (key === 'copy') copyText(row.result);
          });
          row.node.append(el('span', { class: 'geo-name' }, def[0], el('small', { text: def[1] })), val);
          return row;
        });
        outs.textContent = '';
        for (const row of rows) outs.append(row.node);
        graph.hidden = !sh.graph;
        if (sh.k === 'sphere') graph.dataset.pro = ''; else delete graph.dataset.pro;
        run();
      };
      const msg = el('div', { class: 'geo-msg', role: 'status' });
      const typed = () => { G.vals[G.k] = cur().p.map(([n]) => inputs[n].value); };
      unit.addEventListener('change', () => { G.unit = unit.value; typed(); choose(G.k); });
      b2.addEventListener('click', () => { if (cur().d !== 2) { typed(); choose(G.last[2] || 'circle'); } });
      b3.addEventListener('click', () => { if (cur().d !== 3) { typed(); choose(G.last[3] || 'sphere'); } });
      p.body.append(el('div', { class: 'seg', role: 'group', 'aria-label': tr('Kind of shape', '図形の種類') }, b2, b3), chips,
        el('div', { class: 'geo-main' }, pic, el('div', { class: 'geo-side' }, sizes,
          el('label', { class: 'geo-size' }, el('span', { class: 'geo-lbl', text: tr('Unit', '単位') }), unit))),
        msg, outs, graph,
        el('div', { class: 'form-hint', text: tr('The results follow the sizes as you type. A size can be an expression or have its own unit (1/3, √2, 2 cm, 5 in). Tap a result to put its expression into the input field or to copy it.', '大きさを入れると、結果がすぐに出ます。大きさには式や単位も使えます（1/3、√2、2 cm、5 in）。結果をタップすると、その式を入力欄に入れたり、結果をコピーしたりできます。') }));
      p.run = run;
      choose(G.k);
    });
    // opened again: the precision or the angle unit of the settings may have changed
    if (p.run) p.run();
    return p;
  }
  // a sphere of radius r in the 3D graph, with its volume and surface area (a QCalc Pro feature)
  async function showSphere(r) {
    if (!hasPro()) { proPrompt(tr('3D graphs are a QCalc Pro feature', '3D グラフは QCalc Pro の機能です')); return; }
    const built = !!panels.plot;
    if (!built) { store.set('qalc.plot.mode', '3d'); store.set('qalc.plot3d.ok', false); }
    openPlot();
    if (built) P.setMode('3d');
    drawSphere(r);
  }

  // ----------------------------------------------------- user definitions
  function openDefs() {
    const p = panel('defs', tr('User-defined variables and functions', 'ユーザー定義の変数・関数'), (p) => {
      const list = el('div');
      const vName = el('input', { placeholder: tr('e.g. r', '例：r'), autocapitalize: 'off' });
      const vVal = el('input', { placeholder: tr('e.g. 5 cm, 2*pi', '例：5 cm、2*pi'), autocapitalize: 'off' });
      const fName = el('input', { placeholder: tr('e.g. hyp', '例：hyp'), autocapitalize: 'off' });
      const fExpr = el('input', { placeholder: tr('e.g. pi*x^2 (arguments x, y, z)', '例：pi*x^2（引数は x, y, z）'), autocapitalize: 'off' });
      const addVar = el('button', { class: 'btn primary', text: tr('Save variable', '変数を保存') });
      const addFn = el('button', { class: 'btn primary', text: tr('Save function', '関数を保存') });
      p.body.append(
        el('div', { class: 'section-title', text: tr('Saved', '保存済み') }), list,
        el('div', { class: 'section-title', text: tr('Add or change a variable', '変数を追加・変更') }),
        el('div', { class: 'form-row' }, el('label', { text: tr('Name', '名前') }), vName),
        el('div', { class: 'form-row' }, el('label', { text: tr('Value (an expression is fine)', '値（式も可）') }), vVal), addVar,
        el('div', { class: 'section-title', text: tr('Add or change a function', '関数を追加・変更') }),
        el('div', { class: 'form-row' }, el('label', { text: tr('Name', '名前') }), fName),
        el('div', { class: 'form-row' }, el('label', { text: tr('Expression', '式') }), fExpr,
          el('div', { class: 'form-hint', text: tr('Write the arguments as x, y and z. Example: save sqrt(x^2 + y^2) as "hyp", and hyp(3, 4) = 5.', '引数は x, y, z で書きます。例：「hyp」に sqrt(x^2 + y^2) を保存すると hyp(3, 4) = 5。') })), addFn);
      const refresh = async () => {
        list.textContent = '';
        const r = await Bridge.send('user_defs');
        if (!r.ok) { list.textContent = localMessage(r.error); return; }
        if (!r.variables.length && !r.functions.length) list.append(el('div', { class: 'card muted', text: tr('None yet.', 'まだありません。') }));
        const row = (kind, name, body) => el('div', { class: 'item' }, el('div', { class: 'row1' },
          el('div', { class: 't' }, el('span', { class: 'mono', text: kind === 'function' ? name + '()' : name }), el('div', { class: 'n', text: body })),
          el('div', { class: 'acts' },
            // a function of x (and y): its graph, 2D or 3D (1.8.4)
            kind === 'function' && hasVar(body, 'x') && !hasVar(body, 'z') ? el('button', { class: 'btn', text: tr('Graph', 'グラフ'), onclick: () => graphOf(name + (hasVar(body, 'y') ? '(x, y)' : '(x)')) }) : '',
            el('button', { class: 'btn', text: tr('Insert', '挿入'), onclick: () => useItem(kind === 'function' ? name + '()' : name, kind === 'function' ? 1 : 0) }),
            el('button', { class: 'btn danger', text: tr('Delete', '削除'), onclick: async () => {
              if (!(await confirmSheet(tr('Delete "' + name + '"?', '「' + name + '」を削除しますか？', '¿Eliminar "' + name + '"?'), tr('Delete', '削除する')))) return;
              const d = await Bridge.send('delete_def', { kind, name });
              if (!d.ok) toast(localMessage(d.error)); else { invalidateCatalogs(); refresh(); }
            } }))));
        for (const v of r.variables) list.append(row('variable', v.name, '= ' + v.value + (v.temporary ? tr(' (temporary: gone when the app is closed)', '（一時的：アプリを閉じると消えます）') : '')));
        for (const f of r.functions) list.append(row('function', f.name, f.expr));
      };
      const save = async (cmd, params, clear) => {
        const r = await Bridge.send(cmd, params);
        if (!r.ok) { toast(localMessage(r.error)); return; }
        const err = (r.messages || []).find((m) => m.type === 'error');
        toast(err ? localMessage(err.text) : (r.saved === false ? tr('Set, but it could not be saved to a file', '設定しましたが、ファイルに保存できませんでした') : tr('Saved', '保存しました')));
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
    callKind.clear();
    exactCache.clear(); // (a name in a kept integral may mean something else now)
    realRegionCache.clear(); realPartsCache.clear(); // (and a name in a function or a surface)
    refreshDefined(); // (the user's variables may have changed)
    for (const k of Object.keys(catalogs)) delete catalogs[k];
    sugData = null; sugLoading = null; // the suggestions read the lists again when they are needed
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
    if (!sec) return tr('unknown', '不明');
    const d = new Date(sec * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    if (ES) return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (!JA) return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function openRates() {
    const p = panel('rates', tr('Update exchange rates', '為替レートの更新'), (p) => {
      const info = el('div', { class: 'card' });
      const btn = el('button', { class: 'btn primary', text: tr('Update now', '今すぐ更新') });
      const result = el('div', { class: 'form-hint' });
      p.body.append(info, btn, result,
        el('div', { class: 'card muted', style: 'margin-top:14px', html: tr('Currency conversion (for example <span class="mono">100 USD to EUR</span>) uses rates from the same sources as the official Qalculate! (the European Central Bank, Coinbase and others). Updating needs an internet connection.', '通貨の換算（例：<span class="mono">100 USD to JPY</span>）には、公式の Qalculate! と同じ取得元（欧州中央銀行、Coinbase など）のレートを使います。更新にはインターネット接続が必要です。') }));
      const show = () => { info.innerHTML = ''; info.append(el('div', { text: tr('Last updated: ', '最終更新：') + fmtTime(ratesTime) })); };
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        result.textContent = tr('Downloading…', 'ダウンロード中…');
        const r = await Bridge.updateRates();
        btn.disabled = false;
        if (r.time) ratesTime = r.time;
        show();
        if (r.ok) {
          const failed = r.failed && r.failed.length ? r.failed : null;
          result.textContent = JA
            ? r.updated + ' / ' + r.total + ' 件の取得元から更新しました。' + (failed ? '（取得できなかったもの：' + failed.join('、') + '）' : '')
            : 'Updated from ' + r.updated + ' of ' + r.total + ' sources.' + (failed ? ' (Not available: ' + failed.join(', ') + ')' : '');
        } else result.textContent = localMessage(r.error) || tr('Could not update', '更新できませんでした');
        if (r.ok) { invalidateCatalogs(); exprChanged(); }
      });
      p.show = show;
    });
    p.show();
    return p;
  }

  // ------------------------------------------------------------ settings
  // color themes (QCalc Pro): the colors of the keys and the highlights (style.css)
  const THEMES = [['blue', tr('Blue', 'ブルー')], ['green', tr('Green', 'グリーン')], ['teal', tr('Teal', 'ティール')],
    ['purple', tr('Purple', 'パープル')], ['rose', tr('Rose', 'ローズ')], ['orange', tr('Orange', 'オレンジ')], ['graphite', tr('Graphite', 'グラファイト')]];
  const SETTINGS = [
    [tr('Language', '言語'), [
      ['lang', 'Language / 言語 / Idioma', [['en', 'English'], ['ja', '日本語'], ['es', 'Español']]]
    ]],
    [tr('Calculation', '計算'), [
      ['angle', tr('Angle unit', '角度の単位'), [['rad', tr('Radians', 'ラジアン')], ['deg', tr('Degrees', '度')], ['gra', tr('Gradians', 'グラード')]]],
      ['approx', tr('Exact or approximate', '厳密計算と近似'), [['auto', tr('Automatic (exact and approximate)', '自動（厳密値と近似値）')], ['exact', tr('Always exact', '常に厳密')], ['approx', tr('Always approximate (decimals)', '常に近似（小数）')]],
        tr('Automatic also shows an approximate value for results with √2, π and the like', '自動では √2 や π を含む結果に近似値も並べて表示します')],
      ['structuring', tr('Simplification', '式の整理'), [['simplify', tr('Simplify', '簡約')], ['factorize', tr('Factorize', '因数分解')], ['expand', tr('Expand', '展開')]]],
      ['complex', tr('Complex number form', '複素数の形式'), [['rect', 'a + bi'], ['exp', tr('Exponential', '指数形式')], ['polar', tr('Polar', '極形式')], ['cis', tr('cis', 'cis 形式')]]],
      ['units', tr('Automatic unit conversion', '単位の自動変換'), [['optimal', tr('Best unit', '最適な単位')], ['si', tr('Best SI unit', 'SI 単位で最適')], ['base', tr('Base units', '基本単位')], ['none', tr('None', 'しない')]]],
      ['mixed_units', tr('Mixed units (3 ft + 2 in and the like)', '複合単位で表示（3 ft + 2 in など）'), 'bool'],
      ['time_limit', tr('Time limit (seconds)', '計算の制限時間（秒）'), 'number',
        tr('1 to 3600 seconds (default 20). A calculation with = is stopped after this time; tap "Calculating…" to stop it sooner',
          '1〜3600 秒（既定 20）。「=」の計算がこの時間を過ぎると中止します。「計算中…」をタップすれば途中でも止められます')]
    ]],
    [tr('Display', '表示'), [
      ['fraction', tr('Fractions', '分数の表示'), [['auto', tr('Automatic', '自動')], ['decimal', tr('Decimal', '小数')], ['exact', tr('Decimal (when exact)', '小数（厳密なときだけ）')], ['fraction', tr('Fraction', '分数')], ['combined', tr('Mixed fraction', '帯分数')]]],
      ['precision', tr('Precision (significant digits)', '有効桁数'), 'number', proOffered()
        ? tr('2 to 200000 digits (default 10; above 1000 with QCalc Pro). Higher values take longer to calculate', '計算の精度（2〜200000桁、既定 10。1000 桁を超えるには QCalc Pro）。大きくするほど計算に時間がかかります')
        : tr('2 to 200000 digits (default 10). Higher values take longer to calculate', '計算の精度（2〜200000桁、既定 10）。大きくするほど計算に時間がかかります')],
      ['max_decimals', tr('Maximum decimal places', '小数点以下の最大桁数'), [['-1', tr('No limit', '制限なし')], ['0', '0'], ['2', '2'], ['4', '4'], ['6', '6'], ['8', '8'], ['10', '10']]],
      ['base', tr('Number base of results', '結果の進数'), [['10', tr('Decimal', '10進数')], ['16', tr('Hexadecimal', '16進数')], ['2', tr('Binary', '2進数')], ['8', tr('Octal', '8進数')], ['12', tr('Duodecimal', '12進数')], ['-1', tr('Roman numerals', 'ローマ数字')]]],
      ['notation', tr('Exponential notation', '指数表記'), [['auto', tr('Automatic', '自動')], ['sci', tr('Scientific (exponent from about 1000)', '科学表記（1000 以上などで指数）')], ['eng', tr('Engineering (exponent a multiple of 3)', '工学表記（指数は 3 の倍数）')], ['pure', tr('Always', '常に指数表記')], ['none', tr('Never (all digits)', '使わない（全桁を表示）')]],
        tr('"Never" shows all digits of large integers too', '「使わない」にすると大きな整数も全桁を表示します')],
      ['grouping', tr('Digit grouping (1,000)', '3桁ごとに区切る'), 'bool'],
      ['math_view', tr('Math notation for expressions and results', '式と結果を数式の形で表示'), 'bool',
        tr('Fractions, powers, roots, integrals and the like: the expression above the input field, and results', '分数・べき乗・根号・積分などを、入力欄の上の式と結果に使います')],
      ['appearance', tr('Light or dark', 'ライト／ダーク'), [['system', tr('Same as the phone', '端末の設定と同じ')], ['light', tr('Light', 'ライト')], ['dark', tr('Dark', 'ダーク')]]],
      ['text_size', tr('Text size', '文字の大きさ'), [['normal', tr('Normal', '標準')], ['large', tr('Large', '大きめ')], ['xlarge', tr('Extra large', '特大')]], tr('Text in the history, the input field and the result', '履歴・入力欄・結果の文字の大きさ')],
      ['theme', tr('Color theme', '配色テーマ'), THEMES, tr('The color of the keys and the highlights, in the light and the dark theme', 'キーや強調表示の色（ライト・ダークの両方）')]
    ]],
    [tr('Input', '操作'), [
      ['preview', tr('Show the result while typing', '入力中に結果を表示'), 'bool'],
      ['auto_rates', tr('Update exchange rates automatically (every 7 days)', '為替レートを自動更新（7日ごと）'), 'bool'],
      ['auto_ans', tr('An operator in an empty field continues from ans', '空欄で演算子を押すと ans から続ける'), 'bool'],
      ['haptics', tr('Vibrate when a key is pressed', 'キーを押したときに振動'), 'bool']
    ]]
  ];
  // the settings that are numbers: smallest, largest (now, and with QCalc Pro) and default value
  const NUMBER_RANGE = {
    precision: { min: 2, max: maxPrecision, limit: MAX_PRECISION, def: 10 },
    time_limit: { min: MIN_TIME_LIMIT, max: () => MAX_TIME_LIMIT, limit: MAX_TIME_LIMIT, def: DEFAULT_TIME_LIMIT }
  };
  function openSettings() {
    const p = panel('settings', tr('Settings', '設定'), (p) => {
      for (const [group, rows] of SETTINGS) {
        p.body.append(el('div', { class: 'section-title', text: group }));
        for (const [key, label, type, sub] of rows) {
          let input;
          if (type === 'bool') {
            input = el('input', { type: 'checkbox' });
            input.checked = !!S[key];
            input.addEventListener('change', () => { S[key] = input.checked; settingsChanged(); });
          } else if (type === 'number') {
            const R = NUMBER_RANGE[key];
            input = el('input', { type: 'number', min: R.min, max: R.max(), inputmode: 'numeric' });
            input.value = S[key];
            input.addEventListener('change', () => {
              const v = parseInt(input.value, 10);
              let n = Number.isNaN(v) ? R.def : Math.max(R.min, Math.min(R.limit, v));
              const locked = key === 'precision' && n > maxPrecision();
              if (locked) n = maxPrecision();
              S[key] = n; input.value = n; settingsChanged();
              if (locked) proPrompt(tr('A precision above 1000 digits is a QCalc Pro feature', '1000 桁を超える有効桁数は QCalc Pro の機能です'));
            });
          } else {
            input = el('select');
            for (const [v, t] of type) input.append(el('option', { value: v, text: t }));
            input.value = String(own(S, key));
            input.addEventListener('change', () => {
              const v = input.value;
              if (key === 'theme' && v !== 'blue' && !hasPro()) {
                input.value = 'blue'; S.theme = 'blue'; settingsChanged();
                proPrompt(tr('Color themes are a QCalc Pro feature', '配色テーマは QCalc Pro の機能です'));
                return;
              }
              S[key] = (key === 'base' || key === 'max_decimals') ? Number(v) : v;
              settingsChanged();
            });
          }
          const name = el('div', { text: label });
          if (key === 'theme' || key === 'precision') name.dataset.pro = '';
          p.body.append(el('label', { class: 'setting' },
            el('div', { class: 'lbl' }, name, sub ? el('div', { class: 's', text: sub }) : null), input));
          (p.inputs = p.inputs || {})[key] = input;
        }
      }
      p.body.append(el('div', { class: 'section-title', text: '' }),
        el('button', { class: 'btn', text: tr('Reset all settings', '設定を初期値に戻す'), onclick: async () => {
          if (!(await confirmSheet(tr('Reset all settings to their defaults?', '設定を初期値に戻しますか？'), tr('Reset', '戻す')))) return;
          S = Object.assign({}, DEFAULTS, { lang: LANG }); settingsChanged(); // the language stays
          for (const k of Object.keys(p.inputs)) { const i = p.inputs[k]; if (i.type === 'checkbox') i.checked = !!S[k]; else i.value = String(S[k]); }
        } }));
    });
    return p;
  }
  function settingsChanged() {
    saveSettings();
    if (S.lang !== LANG) { setLanguage(S.lang); return; }
    updateChips();
    applyTextSize();
    applyTheme();
    exprChanged();
    if (CF.id) formChanged();
    if (mathShown !== S.math_view) { mathShown = S.math_view; renderHistory(false); }
  }
  let mathShown = S.math_view;
  function updateChips() {
    $('#chip-angle').textContent = ANGLE_LABEL[S.angle] || 'RAD';
    $('#chip-approx').textContent = APPROX_LABEL[S.approx] || APPROX_LABEL.auto;
    $('#chip-base').textContent = BASE_LABEL[String(S.base)] || String(S.base);
  }
  function cycle(key, values) {
    const i = values.indexOf(String(S[key]));
    const nv = values[(i + 1) % values.length];
    S[key] = (key === 'base') ? Number(nv) : nv;
    settingsChanged();
    if (panels.settings && panels.settings.inputs) panels.settings.inputs[key].value = String(S[key]);
  }
  for (const id of ['#chip-angle', '#chip-approx', '#chip-base']) $(id).addEventListener('pointerdown', (e) => e.preventDefault());
  $('#chip-angle').addEventListener('click', () => { vibrate(); cycle('angle', ['rad', 'deg', 'gra']); toast(tr('Angle: ', '角度：') + { rad: tr('radians', 'ラジアン'), deg: tr('degrees', '度'), gra: tr('gradians', 'グラード') }[S.angle], 1200); });
  $('#chip-approx').addEventListener('click', () => { vibrate(); cycle('approx', ['auto', 'exact', 'approx']); toast({ auto: tr('Exact and approximate values, automatically', '厳密値と近似値を自動で表示'), exact: tr('Always exact', '常に厳密に計算'), approx: tr('Always approximate (decimals)', '常に近似（小数）で計算') }[S.approx], 1400); });
  $('#chip-base').addEventListener('click', () => { vibrate(); cycle('base', ['10', '16', '2', '8']); toast(tr('Results in ' + BASE_NAME[String(S.base)], '結果を ' + BASE_NAME[String(S.base)] + 'で表示', 'Resultados en ' + BASE_NAME[String(S.base)]), 1200); });

  // --------------------------------------------------------------- about
  let engineName = '';
  const PRIVACY_URL = 'https://hiroshitsu.github.io/qcalc/privacy.html' + (JA ? '#ja' : ''); // English first, then Japanese (English for Spanish)
  const SOURCE_URL = 'https://github.com/HiroshiTsu/qcalc';
  function openAbout() {
    const p = panel('about', tr('About this app', 'このアプリについて'), (p) => {
      let app = {};
      try { app = JSON.parse(window.QalcNative ? QalcNative.appInfo() : '{}'); } catch (e) { }
      p.body.append(
        el('div', { class: 'card' },
          el('div', { style: 'font-weight:700;font-size:17px', text: 'QCalc' }),
          el('div', { class: 'muted', text: tr('Version ', 'バージョン ') + (app.version || '') + tr(' / engine ', ' ／ 計算エンジン ') + (engineName || 'libqalculate') }),
          el('div', { class: 'muted', text: (app.device || '') + (app.android ? tr(' (Android ', '（Android ') + app.android + tr(')', '）') : '') })),
        el('div', { class: 'card', html: tr(
          'All calculations are done by <b>libqalculate</b>, the calculation engine of the open-source calculator Qalculate!. QCalc builds its official source code for Android (arm64) and adds a user interface for phones. It is not made by the developers of Qalculate!.<br><br>' +
          'Expressions are written in the same way as in Qalculate!.',
          '計算はすべて、オープンソースの電卓 Qalculate! の計算エンジン <b>libqalculate</b> が行います。QCalc は、その公式ソースコードを Android（arm64）向けにビルドして組み込んだ、スマホ向けの電卓です。Qalculate! の開発者が作ったアプリではありません。<br><br>' +
          '式の書き方は Qalculate! と同じです。',
          'Todos los cálculos los hace <b>libqalculate</b>, el motor de cálculo de la calculadora de código abierto Qalculate!. QCalc compila su código fuente oficial para Android (arm64) y le añade una interfaz para teléfonos. No es obra de los desarrolladores de Qalculate!.<br><br>' +
          'Las expresiones se escriben igual que en Qalculate!.') },
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: tr('Examples and tips', '式の例・使い方を見る'), onclick: (e) => { e.preventDefault(); openExamples(); } }))),
        el('div', { class: 'card', html: tr(
          '<b>Privacy</b><br>QCalc collects no personal data and sends nothing anywhere. It uses the internet only to download exchange rates (from three sources such as the European Central Bank), and sends no information about you then either. The history and the settings are kept on your device and are never sent to the developer.',
          '<b>プライバシー</b><br>QCalc は個人情報を集めず、どこにも送りません。インターネットを使うのは為替レートの取得（欧州中央銀行など 3 か所からのダウンロード）だけで、そのときもあなたの情報は送りません。計算の履歴や設定は端末の中に保存し、開発者に送ることはありません。') },
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: tr('Privacy policy', 'プライバシーポリシー'), onclick: (e) => { e.preventDefault(); openUrl(PRIVACY_URL); } }))),
        el('div', { class: 'card' },
          el('div', { text: tr('License: GNU GPL v2 or later (the same as libqalculate)', 'ライセンス：GNU GPL v2 以降（libqalculate と同じ）') }),
          el('div', { class: 'muted', style: 'font-size:13px', text: tr('The calculation engine also contains GMP, MPFR, libxml2 and more. Because MPFR is LGPL v3 or later, the engine as a whole is distributed under the GNU GPL v3 or later.', '計算エンジンには GMP・MPFR・libxml2 なども組み込んでいます。MPFR が LGPL v3 以降のため、エンジン全体は GNU GPL v3 以降の条件で配布しています。') }),
          el('div', { style: 'margin-top:6px' }, el('a', { href: '#', text: tr('Open source licenses', 'オープンソースライセンス'), onclick: (e) => { e.preventDefault(); openLicenses(); } })),
          el('div', {}, el('a', { href: '#', text: tr('QCalc source code (GitHub)', 'QCalc のソースコード（GitHub）'), onclick: (e) => { e.preventDefault(); openUrl(SOURCE_URL); } })),
          el('div', {}, el('a', { href: '#', text: tr('Qalculate! website', 'Qalculate! 公式サイト'), onclick: (e) => { e.preventDefault(); openUrl('https://qalculate.github.io/'); } })))
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
    return panel('licenses', tr('Open source licenses', 'オープンソースライセンス'), (p) => {
      const hint = el('div', { class: 'form-hint', text: tr('Loading…', '読み込み中…') });
      p.body.append(hint);
      loadLicenses().then((L) => {
        hint.remove();
        p.body.append(el('div', { class: 'card', text: tr('QCalc contains the following open source software. Tap an item under a name to read the full license text. The complete source code of QCalc and of its calculation engine is published on GitHub.', 'QCalc には、次のオープンソースソフトウェアが含まれています。各ソフトウェアのライセンス全文は、名前の下の項目をタップすると表示されます。QCalc と計算エンジンの完全なソースコードは GitHub で公開しています。') }));
        for (const c of L.components) {
          const card = el('div', { class: 'card lic' },
            el('div', { style: 'font-weight:700', text: c.name + (c.version ? ' ' + ((JA && c.version_ja) || c.version) : '') }),
            el('div', { class: 'muted', text: (JA && c.license_ja) || c.license }),
            c.copyright ? el('div', { class: 'muted', style: 'font-size:12px', text: c.copyright }) : null,
            c.url ? el('div', { style: 'font-size:13px' }, el('a', { href: '#', text: c.url, onclick: (e) => { e.preventDefault(); openUrl(c.url); } })) : null);
          for (const t of c.texts) {
            const pre = el('pre', { class: 'lic-text' });
            const d = el('details', {}, el('summary', { text: (JA && L.titles_ja && L.titles_ja[t]) || L.titles[t] }), pre);
            d.addEventListener('toggle', () => { if (d.open && !pre.textContent) pre.textContent = L.texts[t]; });
            card.append(d);
          }
          p.body.append(card);
        }
      }).catch(() => { hint.textContent = tr('Could not load the license texts.', 'ライセンス文を読み込めませんでした。'); });
    });
  }

  // ----------------------------------------------------------------- Pro
  async function proPrompt(what) {
    const k = await sheet(what, [['pro', tr('About QCalc Pro', 'QCalc Pro について'), 'accent']]);
    if (k === 'pro') openPro();
  }
  const PRO_FEATURES = [
    ['🎯', tr('High precision', '高精度'), tr('Up to 200000 significant digits (free: up to 1000)', '有効桁数は最大 200000 桁（無料版は 1000 桁まで）')],
    ['🧊', tr('3D graphs', '3D グラフ'), tr('Surfaces z = f(x, y) that you can turn with a finger', '指で回せる曲面 z = f(x, y)')],
    ['🎨', tr('Color themes', '配色テーマ'), tr('Seven colors for the keys and the highlights, in the light and the dark theme', 'キーや強調表示を 7 色から選べます（ライト・ダークの両方）')],
    ['📤', tr('Export the history', '履歴の書き出し'), tr('Save the history as a CSV file that spreadsheets can open', '履歴を CSV ファイルに保存（表計算ソフトで開けます）')],
    ['✨', tr('Future Pro features', '今後の Pro 機能'), tr('The Pro features of later updates, at no extra cost', '今後のアップデートで増える Pro 機能も、追加料金なしで使えます')]
  ];
  function openPro() {
    const p = panel('pro', 'QCalc Pro', (p) => { p.refresh = () => { p.body.textContent = ''; fillPro(p.body); }; });
    p.refresh();
    // the price and the purchases again (a purchase may have been made outside the app)
    if (window.QalcNative && QalcNative.refreshPro) QalcNative.refreshPro();
    return p;
  }
  function fillPro(body) {
    const card = el('div', { class: 'card pro-state' });
    if (PRO.pro) {
      card.append(el('div', { class: 'pro-title', text: tr('✓ QCalc Pro is unlocked', '✓ QCalc Pro が使えます') }),
        el('div', { class: 'muted', text: PRO.legacy
          ? tr('It is free for you, because you used QCalc before QCalc Pro began. Thank you!', 'QCalc Pro が始まる前から QCalc を使っていただいているので、無料で使えます。ありがとうございます！')
          : PRO.billing === 'debug' ? tr('Unlocked in this test build.', 'このテスト版では最初から使えます。')
            : tr('Thank you for your purchase!', 'ご購入ありがとうございます！') }));
    } else {
      card.append(el('div', { class: 'pro-title', text: tr('Unlock all features with a one-time purchase', '1 回の購入で、すべての機能が使えます') }),
        el('div', { class: 'muted', text: tr('No subscription and no ads. The purchase belongs to your Google account, so it also works on your other devices.', 'サブスクリプションも広告もありません。購入は Google アカウントに記録されるので、ほかの端末でも使えます。') }));
      if (PRO.state === 'pending') card.append(el('div', { class: 'form-hint', text: tr('Your payment is being processed. QCalc Pro will be unlocked when it is complete.', '支払いの手続き中です。完了すると QCalc Pro が使えるようになります。') }));
      card.append(el('button', { class: 'btn primary pro-buy', text: PRO.price ? tr('Buy QCalc Pro (' + PRO.price + ')', 'QCalc Pro を購入（' + PRO.price + '）', 'Comprar QCalc Pro (' + PRO.price + ')') : tr('Buy QCalc Pro', 'QCalc Pro を購入'), onclick: buyPro }),
        el('button', { class: 'btn pro-restore', text: tr('Restore a purchase', '購入を復元'), onclick: restorePro }));
    }
    body.append(card);
    const list = el('div', { class: 'card' });
    for (const [ico, name, desc] of PRO_FEATURES) {
      list.append(el('div', { class: 'pro-feat' }, el('span', { class: 'ico', text: ico }),
        el('div', {}, el('div', { class: 'n', text: name }), el('div', { class: 'muted', text: desc }))));
    }
    body.append(list, el('div', { class: 'form-hint', text: tr('Everything else in QCalc stays free.', 'そのほかの機能は、すべて無料のまま使えます。') }));
    if (PRO.billing === 'debug') {
      // test builds: see the app as without Pro
      const box = el('input', { type: 'checkbox' });
      box.checked = !!PRO.pro;
      box.addEventListener('change', () => {
        if (window.QalcNative && QalcNative.setTestPro) QalcNative.setTestPro(box.checked);
        else if (window.QalcDev && QalcDev.setTestPro) QalcDev.setTestPro(box.checked);
      });
      body.append(el('div', { class: 'section-title', text: tr('Test build', 'テスト版') }),
        el('label', { class: 'setting' }, el('div', { class: 'lbl' }, el('div', { text: tr('Pro unlocked (for testing)', 'Pro を有効にする（テスト用）') })), box));
    }
  }
  function buyPro() {
    if (window.QalcNative && QalcNative.buyPro) QalcNative.buyPro();
    else if (window.QalcDev && QalcDev.buyPro) QalcDev.buyPro();
  }
  function restorePro() {
    toast(tr('Checking your purchases…', '購入を確認しています…'), 1500);
    if (window.QalcNative && QalcNative.restorePro) QalcNative.restorePro();
    else if (window.QalcDev && QalcDev.restorePro) QalcDev.restorePro();
  }
  // the app reports a change: unlocked, a price, a pending payment or a message
  function proChanged(ev) {
    const before = hasPro();
    PRO = readPro();
    applyTheme();
    if (panels.settings && panels.settings.inputs && panels.settings.inputs.precision) panels.settings.inputs.precision.max = maxPrecision();
    if (!before && hasPro()) toast(tr('QCalc Pro is unlocked. Thank you!', 'QCalc Pro が使えるようになりました。ありがとうございます！'), 4000);
    else if (ev && typeof ev.message === 'string' && ev.message) toast(localMessage(ev.message), 4500);
    if (panels.pro && panels.pro.refresh) panels.pro.refresh();
    if (before !== hasPro() && exprEl.value.trim()) exprChanged(); // the precision may be different
  }

  // -------------------------------------------------------------- export
  // The history as a CSV file (UTF-8 with a byte order mark, which Excel needs to read it as UTF-8):
  // date and time, expression, result as shown, and the value as a plain number when it is one.
  function historyCsv() {
    const cell = (v, guard) => {
      let t = String(v == null ? '' : v);
      if (guard && /^[=+\-@\t\r]/.test(t)) t = "'" + t; // not read as a formula by spreadsheets
      return '"' + t.replace(/"/g, '""') + '"';
    };
    const z = (n) => String(n).padStart(2, '0');
    const when = (t) => { const d = new Date(t); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); };
    const rows = [[tr('Date', '日時'), tr('Expression', '式'), tr('Result', '結果'), tr('Number', '数値')].map((x) => cell(x)).join(',')];
    for (const h of history) {
      if (!h || typeof h !== 'object' || typeof h.expr !== 'string') continue;
      const shown = displayResult(h).replace(/^= /, '');
      rows.push([h.t ? when(h.t) : '', cell(h.expr, true), cell(shown, true), plainNumber(h)].map((x, i) => (i === 1 || i === 2 ? x : cell(x))).join(','));
    }
    return '\ufeff' + rows.join('\r\n') + '\r\n';
  }
  // The value of a decimal result as a number that spreadsheets read ("-0.6666666667"), or "".
  function plainNumber(h) {
    if (typeof h.result !== 'string' || h.cmp || h.cut || Number(h.base) !== 10) return '';
    const t = h.result.split(/ [≈=] /).pop().replace(/[\u202f\u2009]/g, '').replace(/−/g, '-');
    return /^-?\d+(?:\.\d+)?(?:E-?\d+)?$/.test(t) ? t : '';
  }
  function exportHistory() {
    if (!hasPro()) { proPrompt(tr('Exporting the history is a QCalc Pro feature', '履歴の書き出しは QCalc Pro の機能です')); return; }
    if (!history.length) { toast(tr('The history is empty', '履歴はありません'), 1400); return; }
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const name = 'QCalc-history-' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '.csv';
    const csv = historyCsv();
    // the app asks where to save the file (Android's file picker) and reports with a "saved" event
    if (window.QalcNative && QalcNative.saveFile) { QalcNative.saveFile(name, 'text/csv', csv); return; }
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    fileSaved({ ok: true });
  }
  function fileSaved(ev) {
    if (ev.ok) toast(tr('History exported', '履歴を書き出しました'), 2000);
    else if (!ev.cancelled) toast(localMessage(ev.error) || tr('Could not save the file', 'ファイルを保存できませんでした'), 3500);
  }

  // ---------------------------------------------------------- back/pause
  window.qalcBack = function () {
    if (!varPopEl.hidden) { closeVarPop(); return true; }
    if ($('#sheet').classList.contains('open')) { closeSheet(null); return true; }
    if ($('#drawer').classList.contains('open')) { closeDrawer(); return true; }
    if (panelStack.length) { closePanel(); return true; }
    if (CF.id) { closeForm(); return true; }
    if (exprEl.inputMode === 'text') { toggleKeyboard(false); return true; }
    return false;
  };
  window.qalcPause = function () {
    store.set('qalc.history', history.slice(-300));
    store.set('qalc.draft', exprEl.value);
  };

  // ---------------------------------------------------------------- boot
  // The setting "Light or dark" (S.appearance): the phone's setting, or always light or dark. The app
  // colors the system bars to match: it reads the setting at its start and is told when it changes.
  let appearanceTold = S.appearance;
  function applyTheme() {
    let dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    try { if (window.QalcNative) dark = !!JSON.parse(QalcNative.appInfo()).dark; } catch (e) { }
    if (S.appearance === 'dark') dark = true;
    else if (S.appearance === 'light') dark = false;
    if (S.appearance !== appearanceTold) {
      appearanceTold = S.appearance;
      try { if (window.QalcNative && QalcNative.setAppearance) QalcNative.setAppearance(String(S.appearance)); } catch (e) { }
    }
    const root = document.documentElement;
    const was = root.classList.contains('dark');
    root.classList.toggle('dark', dark);
    if (was !== dark) { draw(); draw3d(); } // graphs that are already drawn take the new colors
    // the color theme (QCalc Pro); blue is the default of style.css
    const theme = hasPro() && THEMES.some(([v]) => v === S.theme) && S.theme !== 'blue' ? S.theme : '';
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    root.classList.toggle('pro-locked', !hasPro()); // "PRO" marks on the locked features
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
      toast(tr('Exchange rates updated', '為替レートを最新に更新しました'), 1800);
      if (exprEl.value.trim()) exprChanged();
    }
  }
  // the texts of index.html are in English; in Japanese and Spanish they are replaced at start
  function localizeStatic() {
    if (LANG === 'en') return;
    const set = (sel, attr, ja, es) => { const e = $(sel); if (e) e.setAttribute(attr, JA ? ja : es); };
    set('#btn-menu', 'aria-label', 'メニュー', 'Menú');
    set('#chip-angle', 'title', '角度の単位', 'Unidad de ángulo');
    set('#chip-approx', 'title', '厳密計算・近似', 'Exacto o aproximado');
    set('#chip-base', 'title', '結果の進数', 'Base numérica de los resultados');
    set('#history', 'aria-label', '計算の履歴', 'Historial de cálculos');
    set('#expr', 'placeholder', '式を入力', 'Escribe una expresión');
    set('#pages', 'aria-label', 'キーの種類', 'Tipos de teclas');
    set('#drawer', 'aria-label', 'メニュー', 'Menú');
    set('#suggest', 'aria-label', '候補', 'Sugerencias');
    set('#cform', 'aria-label', '入力フォーム', 'Formulario');
    set('#varpop', 'aria-label', '文字', 'Letras');
    set('#plotbtn', 'aria-label', 'この式のグラフ', 'Gráfico de esta expresión');
    undoEl.textContent = JA ? '↶ 元に戻す' : '↶ Deshacer';
    nextBoxEl.textContent = JA ? '次の欄 ▶' : 'Siguiente ▶';
  }
  // "Language / 言語 / Idioma" in the menu and in the settings: the page is loaded again in the new language
  async function chooseLanguage() {
    const mark = (l) => (l === LANG ? '✓ ' : '');
    const k = await sheet('Language / 言語 / Idioma', [['en', mark('en') + 'English'], ['ja', mark('ja') + '日本語'], ['es', mark('es') + 'Español']]);
    if (k) setLanguage(k);
  }
  function setLanguage(lang) {
    if (LANGS.indexOf(lang) < 0) return;
    store.set('qalc.lang', lang); // the user's own choice (see LANG)
    S.lang = lang;
    saveSettings();
    if (lang === LANG) return;
    window.qalcPause(); // the history and the expression being typed
    location.reload();
  }
  async function boot() {
    localizeStatic();
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
    previewEl.textContent = tr('Starting the calculation engine…', '計算エンジンを準備中…');
    const r = await Bridge.send('init');
    previewEl.textContent = '';
    if (!r.ok) {
      msgEl.textContent = (localMessage(r.error) || tr('Could not start the calculation engine', '計算エンジンを起動できませんでした')) + tr(' (tap here to try again)', '（ここをタップすると、もう一度試します）');
      msgEl.className = 'msg error';
      msgEl.onclick = () => { msgEl.onclick = null; msgEl.textContent = ''; msgEl.className = 'msg'; startEngine(); };
      return;
    }
    engineReady = true;
    refreshDefined();
    if (r.ans_defined === false && history.length) {
      const t = insertText(history[history.length - 1]);
      if (t) Bridge.send('set_ans', { expr: t });
    }
    if (r.defs_error) toast(tr('The saved user definitions could not be read, so their file was moved aside', '保存されていたユーザー定義のファイルが読めなかったため、別の場所に移しました'), 5000);
    engineName = r.engine || '';
    ratesTime = r.rates_time || 0;
    autoUpdateRates();
    const sub = $('#drawer-sub');
    if (sub) sub.textContent = tr('Calculation engine ', '計算エンジン ') + engineName;
    if (exprEl.value.trim()) exprChanged();
    // the lists of names for the suggestions, once the first calculations are out of the way
    setTimeout(() => { if (!sugData) loadSugData(); }, 2500);
  }
  boot();
})();
