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
  // The language of the user interface: English (the default) or Japanese. Only a language the user
  // chose with "Language / 言語" (in the menu or the settings) is kept, as qalc.lang. The language
  // that test builds of 1.3.0 saved with the other settings (qalc.settings) is not used, so that the
  // app starts in English unless Japanese was chosen. It is read once when the page starts;
  // choosing another language reloads the page.
  const LANG = store.get('qalc.lang', 'en') === 'ja' ? 'ja' : 'en';
  const JA = LANG === 'ja';
  // the text in the language of the user interface
  const tr = (en, ja) => (JA ? ja : en);
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
    'det': '行列式', 'Aᵀ': '転置行列', 'A⁻¹': '逆行列', 'Iₙ': '単位行列', '▦': '行列を入力する画面を開く', 'a/b': '分数（分子と分母の欄）'
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
    'det': 'Determinant', 'Aᵀ': 'Transpose', 'A⁻¹': 'Inverse matrix', 'Iₙ': 'Identity matrix', '▦': 'Open the matrix form', 'a/b': 'Fraction (boxes for the numerator and the denominator)'
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
  function targetChanged() { if (editTarget) formChanged(); else exprChanged(); }
  function insert(text, back, isOp) {
    const f = tgt();
    if (f === exprEl) dropUndo();
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
        // a selection collapses to its start; otherwise one character back (a surrogate pair counts as one)
        let p = s;
        if (s === e && p > 0) p -= /[\uDC00-\uDFFF]/.test(v[p - 1]) && p > 1 ? 2 : 1;
        f.setSelectionRange(p, p);
        if (f === exprEl) { updateSuggest(false); updateNextBox(); }
        break;
      }
      case 'right': {
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
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: 1500, max_chars: MAX_RESULT, tail_chars: TAIL_RESULT });
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
  // The engine's messages are in English (libqalculate has no Japanese translation). In Japanese,
  // the common ones are translated, and so are the messages of the app's own Java code and engine.
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
    // the app's Java code (Engine.java, RatesUpdater.java, MainActivity.java)
    [/^Communication with the calculation engine failed \((.*)\)$/, (m, e) => '計算エンジンとのやりとりに失敗しました（' + e + '）'],
    [/^Could not start the calculation engine \((.*)\)$/, (m, e) => '計算エンジンを起動できませんでした（' + e + '）'],
    [/^The request is not valid$/, () => '要求の形式が正しくありません'],
    [/^The calculation was stopped$/, () => '計算を中止しました'],
    [/^The calculation took too long and was stopped$/, () => '時間がかかりすぎたため計算を中止しました'],
    [/^The calculation engine stopped unexpectedly\. Try a simpler expression\.$/, () => '計算エンジンが異常終了しました。式を簡単にしてお試しください'],
    [/^Could not update the exchange rates$/, () => '為替レートの更新に失敗しました'],
    [/^Could not update the exchange rates \((.*)\)$/, (m, e) => '為替レートの更新に失敗しました（' + localMessage(e) + '）'],
    [/^Could not download the exchange rates\. Check the network connection\.$/, () => '為替レートをダウンロードできませんでした。通信状態を確認してください。'],
    [/^The calculation engine could not load the new rates$/, () => '計算エンジンが新しいレートを読み込めませんでした'],
    // the engine's own messages (qalc-engine.cc)
    [/^Not enough memory for the calculation$/, () => '計算に必要なメモリが不足しました'],
    [/^The expression is nested too deeply$/, () => '式の入れ子が深すぎます'],
    [/^Enter a name and a value$/, () => '名前と内容を入力してください'],
    [/^Check the value \((.*)\)$/, (m, p) => '内容を確認してください（' + localMessage(p) + '）'],
    [/^The function name contains characters that cannot be used$/, () => '関数名に使えない文字が含まれています'],
    [/^The variable name contains characters that cannot be used$/, () => '変数名に使えない文字が含まれています'],
    [/^"(.+)" is a built-in name and cannot be used$/, (m, n) => '「' + n + '」は組み込みの名前なので使えません'],
    [/^"to" cannot be used in the expression of a function$/, () => '関数の式に「to」は使えません'],
    [/^There is no user definition "(.+)"$/, (m, n) => 'ユーザー定義の「' + n + '」が見つかりません'],
    [/^Google Play is not available on this device$/, () => 'この端末では Google Play を利用できません'],
    [/^Could not connect to Google Play\. Try again later\.$/, () => 'Google Play に接続できませんでした。しばらくしてから、もう一度お試しください。'],
    [/^QCalc Pro cannot be bought right now$/, () => '現在 QCalc Pro を購入できません'],
    [/^No purchase of QCalc Pro was found$/, () => 'QCalc Pro の購入が見つかりませんでした'],
    [/^The purchase could not be completed \((.*)\)$/, (m, c) => '購入を完了できませんでした（' + c + '）'],
    [/^The payment is pending\. QCalc Pro will be unlocked when it is complete\.$/, () => '支払いの手続き中です。完了すると QCalc Pro が使えるようになります。'],
    [/^Could not save the file$/, () => 'ファイルを保存できませんでした'],
    [/^The middle of this long result is not shown \(([\d,]+) digits\)$/, (m, n) => '長い結果のため、途中を省略しています（全 ' + n + ' 桁）'],
    [/^The middle of this long result is not shown \(([\d,]+) characters\)$/, (m, n) => '長い結果のため、途中を省略しています（全 ' + n + ' 文字）'],
    [/^The middle of this long result is not shown$/, () => '長い結果のため、途中を省略しています'],
  ];
  // a message of the engine or of the app's Java code, in the language of the user interface
  function localMessage(text) {
    if (!JA || typeof text !== 'string') return text;
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
    if (!r.ok) { previewEl.textContent = ''; msgEl.textContent = localMessage(r.error) || ''; msgEl.className = 'msg error'; return; }
    parsedEl.textContent = r.parsed || '';
    const err = (r.messages || []).find((m) => m.type === 'error');
    if (r.deferred) previewEl.textContent = tr('Press = to run it (definitions are not previewed)', '＝ を押すと実行します（定義など）');
    else if (r.timeout) previewEl.textContent = '…';
    else if (err) { previewEl.textContent = ''; msgEl.textContent = localMessage(err.text); msgEl.className = 'msg error'; }
    else {
      showResult(previewEl, resultText(r));
      fitMatrices(previewEl);
      const warn = (r.messages || []).find((m) => m.type === 'warning');
      const notes = [];
      if (warn) notes.push(localMessage(warn.text));
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
      if (s >= 1) previewEl.textContent = tr(`Calculating… ${s} s (tap here to stop)`, `計算中… ${s} 秒（ここをタップで中止）`);
    }, 1000);
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: limit * 1000, store: true, max_chars: MAX_RESULT, tail_chars: TAIL_RESULT });
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
        `制限時間（${limit} 秒）を過ぎたため計算を中止しました。制限時間は設定で変えられます`);
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
  const CF = { id: null, boxes: {}, order: [], sel: [0, 0], dir: '', seq: 0, timer: null, nodes: null };
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
  function formValue(k) {
    const d = FORMS[CF.id].boxes.find((b) => b[0] === k);
    let v = normalizeExpr(CF.boxes[k].value);
    if (k === 'v' && /^\p{L}$/u.test(v)) v = varText(v); // a variable t is written \t
    return v || (d[3] !== undefined ? d[3] : d[2] ? '□' : '');
  }
  const formMissing = () => (FORMS[CF.id].matrix ? [] : FORMS[CF.id].eqs ? CF.order.filter((k) => k[0] === 'l' && !CF.boxes[k].value.trim())
    : FORMS[CF.id].boxes.filter((b) => b[2] && !CF.boxes[b[0]].value.trim()).map((b) => b[0]));
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
    const selected = exprEl.value.slice(CF.sel[0], CF.sel[1]);
    if (!F.matrix && !F.eqs) {
      for (const [k, ph] of F.boxes) {
        const b = makeFormBox(k, ph, k === 'f' || k === 'r' ? 'wide' : '');
        b.value = init[k] !== undefined ? String(init[k]) : '';
        CF.boxes[k] = b;
      }
      if (selected && selected !== '□' && init.f === undefined && CF.boxes.f) CF.boxes.f.value = selected.trim();
    } else if (F.eqs) {
      // equations: from init.eqs, else an equation (or an expression = 0) selected in the input field
      const eqs = init.eqs || (selected && selected.trim() ? [selected.trim()] : ['']);
      CF.eq = { n: Math.min(eqs.length, EQ_MAX), vals: { v: init.vars || '' } };
      eqs.slice(0, EQ_MAX).forEach((e, i) => {
        const m = /^(.*?)\s*=\s*(.*)$/.exec(e);
        CF.eq.vals['l' + i] = m ? m[1] : e;
        CF.eq.vals['r' + i] = m ? m[2] : '';
      });
    } else {
      // a matrix: from init.matrix, else from a matrix that is selected in the input field, else 2 × 2
      const m = parseMatrix(init.matrix || (selected && selected.trim())) || { rows: [['', ''], ['', '']] };
      CF.mat = { rows: m.rows.length, cols: m.rows[0].length, op: init.op || '', vals: {} };
      m.rows.forEach((r, i) => r.forEach((x, j) => { CF.mat.vals['c' + i + '_' + j] = x; }));
    }
    const next = tapButton({ class: 'cf-next', text: tr('Next box ▶', '次の欄 ▶') }, () => formNext());
    const close = tapButton({ class: 'icon-btn', 'aria-label': tr('Close', '閉じる'), html: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>' }, () => closeForm());
    const body = el('div', { class: 'cf-body' });
    if (F.matrix) matrixLayout(body);
    else if (F.eqs) equationsLayout(body);
    else body.append(...F.layout(CF.boxes, CF.nodes));
    if (F.dirs) {
      const seg = el('div', { class: 'seg cf-seg', role: 'group', 'aria-label': tr('Direction', '近づき方') });
      for (const [d, t] of [['', tr('Both sides', '両側')], ['1', tr('From the right (+)', '右から（+）')], ['−1', tr('From the left (−)', '左から（−）')]]) {
        const b = tapButton({ text: t }, () => { CF.dir = d; for (const x of seg.children) x.classList.toggle('on', x === b); formChanged(); });
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
    CF.nodes.res = el('div', { class: 'cf-res', 'aria-live': 'polite' });
    CF.nodes.msg = el('div', { class: 'cf-msg' });
    cformEl.textContent = '';
    cformEl.append(el('div', { class: 'cf-bar' }, close, el('div', { class: 'cf-title', text: F.title }), next),
      body, CF.nodes.hint = el('div', { class: 'cf-hint', text: (F.matrix ? MAT_HINT[CF.mat.op] : F.eqs ? eqHint() : F.hint) || '' }), CF.nodes.expr, CF.nodes.res, CF.nodes.msg,
      el('div', { class: 'cf-actions' },
        CF.nodes.graph = tapButton({ class: 'btn cf-graph', text: '📈', title: tr('Graph', 'グラフ'), 'aria-label': tr('Draw a graph', 'グラフに描く') }, () => formGraph()),
        tapButton({ class: 'btn', text: tr('Insert', '式に入れる') }, () => formInsert(false)),
        tapButton({ class: 'btn primary', text: tr('Calculate', '計算する') }, () => formCalculate())));
    cformEl.hidden = false;
    document.body.classList.add('cform-open');
    const first = init.focus || formMissing()[0] || CF.order[0];
    editTarget = CF.boxes[first];
    formChanged();
    focusExpr();
  }
  function makeFormBox(k, ph, cls) {
    const b = el('input', { class: 'cf-box' + (cls ? ' ' + cls : ''), placeholder: ph, inputmode: exprEl.inputMode === 'text' ? 'text' : 'none',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': ph });
    b.dataset.k = k;
    b.addEventListener('focus', () => {
      editTarget = b;
      for (const x of formBoxes()) x.classList.toggle('on', x === b);
      if (CF.nodes && CF.nodes.vars && !FORMS[CF.id].eqs) CF.nodes.vars.hidden = k !== 'v';
    });
    b.addEventListener('input', () => { const p = b.selectionStart, q = b.value; b.value = normalizeJa(q); if (b.value !== q) b.setSelectionRange(p, p); formChanged(); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); formCalculate(); } });
    return b;
  }

  // ---- the matrix form: a grid of cells (an empty cell is 0), its size, and what to calculate
  const MAT_MAX = 8;
  const MAT_OPS = [['', tr('Matrix', '行列のまま')], ['det', tr('Determinant', '行列式')], ['inv', tr('Inverse', '逆行列')],
    ['tr', tr('Transpose', '転置')], ['rk', tr('Rank', '階数')], ['eig', tr('Eigenvalues', '固有値')], ['sys', tr('Linear system Ax = b', '連立方程式 Ax = b')]];
  const MAT_HINT = {
    '': tr('An empty cell is 0. For a product, insert the first matrix, type ×, then open this form again', '空の欄は 0 です。行列の積は、1 つ目を「式に入れる」→ × → もう一度この画面で 2 つ目を入れます'),
    eig: tr('The eigenvalues are the solutions of det(A − x·I) = 0', '固有値は det(A − x·I) = 0 の解として求めます'),
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
    const step = (dim, d) => tapButton({ class: 'cf-step', text: d > 0 ? '+' : '−', 'aria-label': (d > 0 ? tr('More ', '増やす：') : tr('Fewer ', '減らす：')) + (dim === 'rows' ? tr('rows', '行') : tr('columns', '列')) }, () => {
      const n = M[dim] + d;
      if (n < 1 || n > MAT_MAX) return;
      saveMatrixCells();
      M[dim] = n;
      buildMatrixGrid();
      formChanged();
    });
    CF.nodes.rowsN = el('b'); CF.nodes.colsN = el('b');
    body.append(el('div', { class: 'cf-size' },
      el('span', { class: 'cf-sz' }, el('span', { text: tr('Rows', '行') }), step('rows', -1), CF.nodes.rowsN, step('rows', 1)),
      el('span', { class: 'cf-sz' }, el('span', { text: tr('Columns', '列') }), step('cols', -1), CF.nodes.colsN, step('cols', 1))));
    CF.nodes.grid = el('div', { class: 'cf-mat' });
    body.append(el('div', { class: 'cf-brk' }, CF.nodes.grid));
    const ops = el('div', { class: 'cf-ops', role: 'group', 'aria-label': tr('Calculate', '計算') });
    for (const [op, label] of MAT_OPS) {
      const b = tapButton({ class: 'cf-op-btn', text: label }, () => {
        saveMatrixCells();
        M.op = op;
        for (const x of ops.children) x.classList.toggle('on', x === b);
        buildMatrixGrid();
        formChanged();
      });
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
        b.setAttribute('aria-label', tr('Row ', '') + (i + 1) + tr(', column ', '行') + (j + 1) + tr('', '列'));
        b.value = M.vals[k] || '';
        CF.boxes[k] = b; CF.order.push(k);
        CF.nodes.grid.append(b);
      }
      if (sys) {
        const k = 'b' + i;
        const b = makeFormBox(k, '0', 'cell rhs');
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
  }
  function matrixExpr() {
    const M = CF.mat;
    const v = (k) => normalizeExpr(CF.boxes[k] ? CF.boxes[k].value : '') || '0';
    const rows = [];
    for (let i = 0; i < M.rows; i++) {
      const r = [];
      for (let j = 0; j < M.cols; j++) r.push(v('c' + i + '_' + j));
      rows.push(r.join(', '));
    }
    const m = '[' + rows.join('; ') + ']';
    switch (M.op) {
      case 'det': return 'det(' + m + ')';
      case 'inv': return 'inverse(' + m + ')';
      case 'tr': return 'transpose(' + m + ')';
      case 'rk': return 'rk(' + m + ')';
      case 'eig': return 'solve(det(' + m + ' − x × identity(' + M.rows + ')) = 0)';
      case 'sys': {
        const b = [];
        for (let i = 0; i < M.rows; i++) b.push(v('b' + i));
        return 'inverse(' + m + ') × [' + b.join('; ') + ']';
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
      CF.nodes.eqs.append(cfRow(l, cfT('='), r));
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
    CF.nodes.vars.hidden = false;
    CF.nodes.eqDel.disabled = E.n < 2;
    if (CF.nodes.hint) CF.nodes.hint.textContent = eqHint();
    editTarget = CF.boxes[keep] || CF.boxes.l0;
    if (document.body.classList.contains('cform-open')) focusExpr();
  }
  const eqHint = () => (CF.eq.n > 1 ? tr('A system of equations: the result is the values of the variables in their order', '連立方程式：結果は「解く文字」の順の値です')
    : tr('An empty right side is 0', '右辺が空なら 0 です'));
  function solveExpr() {
    const E = CF.eq;
    const v = (k) => normalizeExpr(CF.boxes[k] ? CF.boxes[k].value : '');
    const eqs = [];
    for (let i = 0; i < E.n; i++) eqs.push((v('l' + i) || '□') + ' = ' + (v('r' + i) || '0'));
    const names = v('v').split(',').map((t) => t.trim()).filter(Boolean).map((t) => (/^\p{L}$/u.test(t) ? varText(t) : t));
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
    const b = CF.boxes[CF.order[(i + 1) % CF.order.length]];
    editTarget = b;
    b.focus();
    b.setSelectionRange(b.value.length, b.value.length);
  }
  function formChanged() {
    if (!CF.id) return;
    const F = FORMS[CF.id];
    for (const b of formBoxes()) {
      b.style.width = Math.max(b.classList.contains('wide') ? 7 : 3, textWidth(b.value || b.placeholder) + 1.5) + 'ch';
      b.classList.remove('missing');
    }
    if (F.update) F.update(formValue, CF.nodes);
    const expr = F.build(formValue, CF.dir);
    CF.nodes.expr.textContent = expr;
    if (CF.nodes.graph) CF.nodes.graph.hidden = !formGraphable();
    CF.nodes.msg.textContent = '';
    clearTimeout(CF.timer);
    const seq = ++CF.seq;
    const problem = F.matrix ? matrixProblem() : '';
    if (problem) {
      CF.nodes.res.textContent = '';
      CF.nodes.msg.className = 'cf-msg error';
      CF.nodes.msg.textContent = problem;
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
      else if (err || !r.result) { CF.nodes.res.textContent = ''; CF.nodes.msg.textContent = err ? localMessage(err.text) : tr('Check the boxes', '欄を確認してください'); }
      else {
        showResult(CF.nodes.res, resultText(r));
        const warn = (r.messages || []).find((m) => m.type === 'warning');
        if (warn) { CF.nodes.msg.className = 'cf-msg warning'; CF.nodes.msg.textContent = localMessage(warn.text); }
      }
    }, 250);
  }
  // puts the expression into the input field; calc: and calculates it
  function formInsert(calc) {
    if (!CF.id) return;
    const text = FORMS[CF.id].build(formValue, CF.dir);
    const [s, e] = CF.sel;
    closeForm();
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
      const cell = (i, j) => normalizeExpr(CF.boxes['c' + i + '_' + j].value) || '0';
      if (M.op === 'sys') {
        const vs = ['x', 'y', 'z'].slice(0, M.rows);
        const eqs = [];
        for (let i = 0; i < M.rows; i++) eqs.push(vs.map((v, j) => `(${cell(i, j)}) × ${v}`).join(' + ') + ` = (${normalizeExpr(CF.boxes['b' + i].value) || '0'})`);
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
      const E = CF.eq, v = (k) => normalizeExpr(CF.boxes[k].value);
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

  // ---- 📈 next to the input field: the graph of an expression in x (not an equation or a conversion)
  const plotBtnEl = $('#plotbtn');
  plotBtnEl.addEventListener('pointerdown', (e) => e.preventDefault());
  plotBtnEl.addEventListener('click', () => { vibrate(); openPlotWith(normalizeExpr(exprEl.value)); });
  function plottable(t) {
    t = normalizeExpr(t);
    return !!t && t.length < 500 && t.indexOf('□') < 0 && !/[=<>≤≥≠;[\]]| to |→|solve|dsolve|integrate\([^)]*,|diff\([^)]*,[^)]*,[^)]*,/.test(t) &&
      /(^|[^\p{L}_])x(?![\p{L}\p{Nd}_])/u.test(t);
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
    const more = fx ? [['f-diff', tr('Differentiate', '微分する')], ['f-int', tr('Integrate', '積分する')],
      ['f-plot', tr('Draw a graph', 'グラフにする')], ['f-subst', tr('Substitute a value for x', 'x に値を代入する')],
      ['f-solve', tr('Solve = 0 for x', '= 0 として x を求める')]] : [];
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
    else if (a === 'f-plot') openPlotWith(fx);
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
    ['defs', '✎', tr('User-defined variables and functions', 'ユーザー定義の変数・関数')],
    ['rates', tr('$', '¥'), tr('Update exchange rates', '為替レートの更新')],
    null,
    ['pro', '⭐', 'QCalc Pro', { when: proOffered }],
    ['settings', '⚙', tr('Settings', '設定')],
    ['language', '🌐', 'Language / 言語'],
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
    tr('With x in the expression, 📈 next to the input field draws its graph.', '式に x があるときは、入力欄の上の 📈 でグラフを描けます。'),
    tr('In the graph, "Area" finds the area between a function and the x axis or between two functions (the crossing points are offered as ranges), and "Length" the length of a curve or the perimeter between two functions. "Example" draws a circle or an ellipse.', 'グラフの「面積を求める」で、関数と x 軸の間や 2 つの関数の間の面積（交点の間の範囲を選べます）、「長さ・周」で曲線の長さや 2 つの関数に囲まれた部分の周の長さが求められます。「図形の例」で円や楕円を描けます。'),
    tr('In the 3D graph, "Volume and surface" finds the volume under a surface or between two surfaces and their surface area, over the rectangle or over a disk x² + y² ≤ R². "Example: Sphere" draws a sphere and gives 32π/3 and 16π for r = 2.', '3D グラフの「体積・表面積」で、曲面の下や 2 つの曲面の間の体積と表面積が、長方形か円 x² + y² ≤ R² の範囲で求められます。「図形の例：球」で球を描き、r = 2 なら体積 32π/3・表面積 16π が出ます。'),
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
    tr('An expression cleared with AC comes back with "Undo", which appears right after.', 'AC で消した式は、すぐ後に出る「元に戻す」で戻せます。')
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
      const ja = !JA ? '' : it._ja + ' ' + it._cat.split('/').map((c) => own(CATEGORY_JA, c) || '').join(' ');
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
        count.textContent = tr(shown.length + (shown.length === 1 ? ' item' : ' items'), shown.length + ' 件');
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
      search.addEventListener('input', debounce(() => { p.state.q = search.value; render(); }, 150));
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
        for (const t of tops) cats.append(el('button', { 'data-cat': t, text: (JA && own(CATEGORY_JA, t)) || t, onclick: () => { p.state.cat = t; render(); } }));
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
    row.append(el('div', { class: 'c', text: it._cat.split('/').map((c) => (JA && own(CATEGORY_JA, c)) || c).join(' / ') }));
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
      wrap, legend, msg, buildCalc2d(), buildArea2d(),
      el('div', { class: 'form-hint', text: tr('Drag to move, pinch to zoom, tap to show the coordinates. The functions are the same as on the calculator.', 'ドラッグで移動、2本指で拡大・縮小、タップで座標を表示します。式に使える関数は計算画面と同じです。') }));
      p.body.append(el('div', { class: 'seg', role: 'group', 'aria-label': tr('Type of graph', 'グラフの種類') }, b2, b3), f2, f3);
      P.canvas = canvas; P.tip = tip; P.legend = legend; P.msg = msg; P.wrap = wrap;
      P.ta = ta; P.go = go; P.setMode = setMode; P.xmin = xmin; P.xmax = xmax;
      go.addEventListener('click', () => {
        store.set('qalc.plot.exprs', ta.value); store.set('qalc.plot.min', xmin.value); store.set('qalc.plot.max', xmax.value);
        document.activeElement && document.activeElement.blur();
        // points and marks belong to the graph they were made for (a matrix, a form), not to one drawn by hand
        if (!P.keep) { P.points = null; P.marks = []; P.pending = null; P.guides = null; P.equal = store.get('qalc.plot.equal', false) === true; }
        P.keep = false;
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
      }
      return;
    }
    P.msg.textContent = tr('Calculating…', '計算中…');
    const r = await Bridge.send('plot', { exprs: P.exprs, min: String(min), max: String(max), steps: 600, var: 'x', opts: engineOpts(), timeout: 12000 });
    if (!r.ok) { P.msg.textContent = r.error === 'invalid range' ? tr('Check the range of x', 'x の範囲を確認してください') : (localMessage(r.error) || tr('Could not calculate the graph', 'グラフを計算できませんでした')); return; }
    if (!Array.isArray(r.series)) { P.msg.textContent = tr('The calculation took too long and was stopped', '時間がかかりすぎたため計算を中止しました'); return; }
    P.series = r.series.map((s, i) => ({ expr: P.exprs[i], x: s.x, y: s.y, color: COLORS[i % COLORS.length] }));
    const err = (r.messages || []).find((m) => m.type === 'error');
    P.msg.textContent = err ? localMessage(err.text) : '';
    let x0 = Infinity, x1 = -Infinity;
    for (const s of P.series) for (const x of s.x) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    P.dataX = isFinite(x0) ? [x0, x1] : null;
    if (!keepView) P.view = null;
    P.legend.textContent = '';
    for (const s of P.series) P.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.y.some((v) => v !== null) ? '' : tr(' (no values)', '（値なし）')) }));
    P.area = null;
    if (P.areaUI) areaFunctionsChanged();
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
  const iOpts = (more) => Object.assign(engineOpts(), { angle: 'rad', grouping: false }, more || {});
  // x and y of an expression replaced by other expressions; "2xy" (x times y) counts too
  function subXY(expr, xs, ys) {
    return expr.replace(/[\p{L}_][\p{L}\p{Nd}_]*/gu, (tok, off, str) => {
      if (str[off - 1] === '\\' || str[off - 1] === "'" || !/^[xy]+$/.test(tok)) return tok;
      return Array.from(tok, (c) => '(' + (c === 'x' ? xs : ys) + ')').join(' × ');
    });
  }
  // √(1 / (4 − x²)) as 1 / √(4 − x²): the engine integrates the second form exactly
  function recipSqrt(t) {
    for (let i = t.indexOf('√(1 / '), guard = 0; i >= 0 && guard < 20; i = t.indexOf('√(1 / '), guard++) {
      let d = 0, j = i + 1;
      for (; j < t.length; j++) { if (t[j] === '(') d++; else if (t[j] === ')' && --d === 0) break; }
      if (j >= t.length) break;
      t = t.slice(0, i) + '(1 / √(' + t.slice(i + 6, j) + '))' + t.slice(j + 1);
    }
    return t;
  }
  // an expression worked out (radians), as text for the next step, or ''
  async function symText(expr) {
    const r = await Bridge.send('calc', { expr, opts: iOpts(), timeout: 4000 });
    if (!r.ok || !r.result || r.timeout || (r.messages || []).some((m) => m.type === 'error')) return '';
    const t = r.result.split(' ≈ ')[0].trim();
    return /integrate|∫|diff\(|=/.test(t) ? '' : t;
  }
  // the exact value of an integral: { text: "8π ≈ 25.13274123", v }, or null
  async function exactIntegral(expr, ms) {
    const r = await Bridge.send('calc', { expr, opts: iOpts(), timeout: ms || 6000 });
    if (!r.ok || !r.result || r.timeout || /∫|integrate/.test(r.result)) return null;
    if ((r.messages || []).some((m) => m.type === 'error' || /integrate|approximated/i.test(m.text))) return null;
    const v = Number(numberPart(r.result));
    return isFinite(v) ? { text: r.result, exact: r.result.split(' ≈ ')[0].trim(), v } : null;
  }
  // a sum worked out by the engine with many digits (the ends of x = m + h tanh(…) come very close
  // to a and b, and 1 − tanh must not round to 0 there), as a number or NaN
  async function sumValue(expr, digits) {
    const r = await Bridge.send('calc', { expr, opts: iOpts({ approx: 'approx', precision: digits }), timeout: Math.max(20000, timeLimit() * 1000) });
    if (!r.ok || !r.result || r.timeout || (r.messages || []).some((m) => m.type === 'error')) return NaN;
    return Number(numberPart(r.result));
  }
  // ∫ F dx from a to b, numerically: t from −4 to 4 in steps of 1/50
  async function tsIntegral(F, a, b) {
    const N = 200, H = '(4/200)', t = `\\k × ${H}`;
    const m = `(((${a}) + (${b})) / 2)`, h = `(((${b}) − (${a})) / 2)`;
    const g = `(${subXY(F, `${m} + ${h} × tanh(π/2 × sinh(${t}))`, 'y')}) × ${h} × π/2 × cosh(${t}) / cosh(π/2 × sinh(${t}))^2`;
    return sumValue(`sum(${g}, −${N}, ${N}, \\k) × ${H}`, 50);
  }
  // ∬ F over the disk x² + y² ≤ R², numerically: r by the rule above (t from −3.2 to 3.2), θ in 36
  // even steps (the integrand is periodic in θ)
  async function tsDisk(F, R) {
    const N = 64, M = 36, H = '(3.2/64)', t = `\\k × ${H}`, q = `\\j × 2π/${M}`;
    const rr = `((${R}) / 2 × (1 + tanh(π/2 × sinh(${t}))))`;
    const g = `(${subXY(F, `${rr} × cos(${q})`, `${rr} × sin(${q})`)}) × ${rr} × (${R}) / 2 × π/2 × cosh(${t}) / cosh(π/2 × sinh(${t}))^2`;
    return sumValue(`sum(sum(${g}, −${N}, ${N}, \\k), 1, ${M}, \\j) × ${H} × 2π/${M}`, 40);
  }
  // ∬ F over a rectangle, numerically: Simpson's rule on 101 × 101 points (points without a value left out)
  async function simpsonRect(F, x0, x1, y0, y1) {
    const r = await Bridge.send('plot3d', { exprs: [F], xmin: x0, xmax: x1, ymin: y0, ymax: y1, nx: VOL_N, ny: VOL_N, opts: iOpts(), timeout: Math.max(15000, timeLimit() * 1000) });
    if (!r.ok || !Array.isArray(r.series) || !r.series[0] || r.series[0].complete === false) return { v: NaN, missing: 0, error: r.error };
    const nx = r.x.length, ny = r.y.length, z = r.series[0].z;
    const hx = (r.x[nx - 1] - r.x[0]) / (nx - 1), hy = (r.y[ny - 1] - r.y[0]) / (ny - 1);
    const w = (i, n) => (i === 0 || i === n - 1 ? 1 : i % 2 ? 4 : 2);
    let sum = 0, missing = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = z[j * nx + i];
      if (typeof v !== 'number' || !isFinite(v)) { missing++; continue; }
      sum += w(i, nx) * w(j, ny) * v;
    }
    return { v: sum * hx * hy / 9, missing };
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

  // the length of the curve of f from a to b: ∫ √(1 + f′²) dx
  async function curveLength(f, a, b) {
    const L = recipSqrt(await symText(`√(1 + (diff(${f}, x))^2)`));
    if (!L) return null;
    const ex = await exactIntegral(`integrate(${L}, ${a}, ${b})`);
    const num = await tsIntegral(L, a, b);
    return bestValue(ex, num);
  }
  // 2D: the length of the curve, or the perimeter of the region between two functions (both curves
  // and the vertical sides at a and b, which are 0 when the curves meet there, as for a circle)
  async function computeLength() {
    const U = P.areaUI, f = P.series[Number(U.f1.value)];
    if (!f) return;
    const a = normalizeExpr(U.a.value), b = normalizeExpr(U.b.value);
    if (!a || !b) { U.len.textContent = tr('Enter the range of x (a and b)', 'x の範囲（a と b）を入れてください'); return; }
    const g = areaG();
    U.len.textContent = tr('Calculating…', '計算中…');
    const lf = await curveLength(f.expr, a, b);
    if (!lf) { U.len.textContent = tr('Could not calculate the length', '長さを計算できませんでした'); return; }
    if (!g) { U.len.textContent = ''; showResult(U.len, tr('Length of the curve ', '曲線の長さ ') + shownValue(lf)); return; }
    const lg = await curveLength(g.expr, a, b);
    if (!lg) { U.len.textContent = tr('Could not calculate the length', '長さを計算できませんでした'); return; }
    const side = async (x) => bestValue(await exactIntegral(`abs((${f.expr}) − (${g.expr})) where x = ${x}`, 3000), await numValue(`abs((${f.expr}) − (${g.expr})) where x = ${x}`));
    const sa = await side(a), sb = await side(b);
    const parts = [lf, lg].concat([sa, sb].filter((p) => p && Math.abs(p.v) > 1e-12));
    const total = await sumValues(parts);
    U.len.textContent = '';
    showResult(U.len, tr('Perimeter ', '周の長さ ') + shownValue(total));
    U.len.append(el('div', { class: 'form-hint', text: tr('Curves: ', '曲線：') + shownValue(lf).replace(/^= /, '') + ' + ' + shownValue(lg).replace(/^= /, '') +
      (parts.length > 2 ? tr(', with the vertical sides at a and b', '、a と b の縦の辺を含む') : '') }));
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
      buildShapes2d(),
      el('div', { class: 'plot-range' }, f1, el('span', { text: tr('and', 'と') }), f2, el('span', { text: tr('', 'の間') })),
      el('div', { class: 'plot-range' }, el('span', { text: tr('x:', 'x：') }), a, el('span', { text: tr('to', '〜') }), b, go, lenBtn),
      cross, out, ins, len,
      el('div', { class: 'form-hint', text: tr('The area counts the parts below the x axis (or below the other function) as positive. Tap a range between crossing points to use it. "Length" gives the length of the curve, or the perimeter of the region between two functions.', '面積は、x 軸（またはもう一方の関数）より下の部分もプラスとして数えます。交点の間の範囲をタップすると、その範囲を使います。「長さ・周」は曲線の長さ（2 つの関数の間なら囲まれた部分の周の長さ）です。') }));
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Area ▾', '面積を求める ▾') });
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) areaFunctionsChanged(); else { P.area = null; draw(); } });
    f1.addEventListener('change', () => areaPairChanged());
    f2.addEventListener('change', () => areaPairChanged());
    go.addEventListener('click', () => computeArea());
    ins.addEventListener('click', () => { if (P.areaExpr) useExample(P.areaExpr); });
    P.areaUI = { f1, f2, a, b, cross, out, ins, box, len };
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  // shapes to draw and measure: a circle (radius r), an ellipse (half axes a and b)
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
        inputs[n] = inputs[n] || el('input', { inputmode: 'text', autocapitalize: 'off', value: d[3][i], 'aria-label': n });
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
  function buildShapes2d() {
    return buildShapes(SHAPES2D, async (k, v) => {
      // the upper and the lower half as two functions; area and perimeter between them
      const sq = async (t) => (await symText(`(${t})^2`)) || `(${t})^2`;
      let top, w;
      if (k === 'circle') { top = `√(${await sq(v.r)} − x^2)`; w = v.r; }
      else { top = `${/^[\d.]+$/.test(v.b) ? v.b : '(' + v.b + ')'} √(1 − x^2 / ${await sq(v.a)})`; w = v.a; }
      const n = await numValue(w);
      if (!(n > 0)) { toast(tr('The size must be a positive number', '大きさは正の数にしてください'), 2000); return; }
      const neg = /^[\d.]+$/.test(w) ? '−' + w : `−(${w})`;
      openPlotWith([top, '−' + top], { range: [r6(-n * 1.3), r6(n * 1.3)], equal: true, area: { a: neg, b: w, between: true, length: true } });
    });
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
    P.area = null; U.out.textContent = ''; U.ins.hidden = true; U.len.textContent = '';
    U.cross.textContent = '';
    draw();
    if (!f) return;
    const pts = await findCrossings(f, g);
    if (U.f1.value !== String(P.series.indexOf(f))) return; // changed in the meantime
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
    // the range to start with: from the first to the last crossing point, or the drawn range
    if (pts.length >= 2) { U.a.value = pts[0].text; U.b.value = pts[pts.length - 1].text; }
    else if (P.dataX) { U.a.value = String(+P.dataX[0].toPrecision(10)); U.b.value = String(+P.dataX[1].toPrecision(10)); }
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
      p.text = isFinite(v) ? (niceNumber(v) || numberPart(r.result)) : String(+p.x.toPrecision(10));
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
  async function computeArea() {
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
    let cuts = [];
    if (nums.length === 2 && nums.every(isFinite) && P.areaCross) {
      const lo = Math.min(nums[0], nums[1]), hi = Math.max(nums[0], nums[1]), eps = (hi - lo) * 1e-9;
      cuts = P.areaCross.filter((p) => p.x > lo + eps && p.x < hi - eps).map((p) => p.text);
      if (nums[0] > nums[1]) cuts.reverse();
    }
    const bounds = [a].concat(cuts, [b]);
    const pieces = [];
    for (let i = 0; i + 1 < bounds.length; i++) pieces.push(`abs(integrate(${d}, ${bounds[i]}, ${bounds[i + 1]}))`);
    const expr = pieces.length <= 8 ? pieces.join(' + ') : `integrate(abs(${d}), ${a}, ${b})`;
    const r = await Bridge.send('calc', { expr, opts: engineOpts(), timeout: timeLimit() * 1000 });
    const err = r.ok ? (r.messages || []).find((m) => m.type === 'error') : null;
    // a result the engine could not integrate exactly still has its approximate value after ≈
    if (r.ok && r.result && /∫|integrate\(/.test(r.result) && r.result.indexOf('≈') > 0) r.result = '≈ ' + r.result.split('≈').pop().trim();
    if (!r.ok || r.timeout || err || !r.result || /integrate\(|∫/.test(r.result)) {
      U.out.textContent = r.timeout ? tr('It took too long (the time limit can be changed in the settings)', '時間がかかりすぎました（制限時間は設定で変えられます）')
        : localMessage((err && err.text) || r.error) || tr('Could not calculate the area', '面積を計算できませんでした');
      P.area = null; draw();
      return;
    }
    U.out.textContent = '';
    showResult(U.out, tr('Area ', '面積 ') + (r.result.indexOf('≈ ') === 0 ? r.result : resultText(r)));
    P.areaExpr = expr;
    U.ins.hidden = false;
    if (nums.length === 2 && nums.every(isFinite)) {
      P.area = { f, g, a: Math.min(nums[0], nums[1]), b: Math.max(nums[0], nums[1]) };
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
  const VOL_N = 101;
  const SHAPES3D = [['sphere', tr('Sphere', '球'), ['r'], ['2']]];
  function buildVolume3d() {
    const s1 = el('select', { 'aria-label': tr('Surface', '曲面') }), s2 = el('select', { 'aria-label': tr('and', 'と') });
    const out = el('div', { class: 'area-out', 'aria-live': 'polite' });
    const ins = el('button', { class: 'btn', text: tr('Put the double integral into the input field', '重積分の式を入力欄に入れる'), hidden: true });
    const go = tapButton({ class: 'btn primary', text: tr('Volume', '体積') }, () => computeVolume());
    const sur = tapButton({ class: 'btn', text: tr('Surface area', '表面積') }, () => computeSurface());
    const rangeText = el('span', { class: 'form-hint' });
    const R = el('input', { inputmode: 'text', autocapitalize: 'off', placeholder: 'R', 'aria-label': tr('Radius R', '半径 R') });
    const bRect = tapButton({ text: tr('Rectangle', '長方形') }, () => setRegion('rect')), bDisk = tapButton({ text: tr('Disk', '円') }, () => setRegion('disk'));
    const diskRow = el('span', { class: 'disk-row' }, el('span', { text: 'x² + y² ≤ R²,  R =' }), R);
    const setRegion = (k) => {
      Q3.volUI.region = k;
      bRect.classList.toggle('on', k === 'rect'); bDisk.classList.toggle('on', k === 'disk');
      rangeText.hidden = k !== 'rect'; diskRow.hidden = k !== 'disk';
      out.textContent = ''; ins.hidden = true;
    };
    const box = el('div', { class: 'area-box' },
      buildShapes(SHAPES3D, (k, v) => drawSphere(v.r)),
      el('div', { class: 'plot-range' }, s1, el('span', { text: tr('and', 'と') }), s2, el('span', { text: tr('', 'の間') })),
      el('div', { class: 'plot-range' }, el('span', { text: tr('Region', '範囲') }), el('span', { class: 'seg mini' }, bRect, bDisk), rangeText, diskRow),
      el('div', { class: 'calc-btns' }, go, sur), out, ins,
      el('div', { class: 'form-hint', text: tr('Parts below the plane (or the other surface) count as positive. The surface area is that of the two surfaces (or the surface and its floor on z = 0), without side walls.', '平面（またはもう一方の曲面）より下の部分もプラスとして数えます。表面積は 2 つの曲面（または曲面と z = 0 の底面）の面積の和で、側面は含みません。') }));
    box.hidden = true;
    const toggle = el('button', { class: 'btn area-toggle', text: tr('Volume and surface ▾', '体積・表面積 ▾') });
    toggle.addEventListener('click', () => { box.hidden = !box.hidden; toggle.classList.toggle('on', !box.hidden); if (!box.hidden) volumeSurfacesChanged(); });
    ins.addEventListener('click', () => { if (Q3.volExpr) useExample(Q3.volExpr); });
    Q3.volUI = { s1, s2, out, ins, box, rangeText, R, toggle, setRegion };
    setRegion('rect');
    return el('div', { class: 'area-wrap' }, toggle, box);
  }
  // a sphere of radius r: the upper and the lower half over the disk of radius r, round (the same
  // scale on all axes), with its volume and surface area
  async function drawSphere(r) {
    const n = await numValue(r);
    if (!(n > 0)) { toast(tr('The size must be a positive number', '大きさは正の数にしてください'), 2000); return; }
    const r2 = (await symText(`(${r})^2`)) || `(${r})^2`;
    const top = `√(${r2} − x^2 − y^2)`;
    const w = n * 1.1;
    Q3.ta.value = top + '\n−' + top;
    Q3.inputs.forEach((e, i) => { e.value = r6(i % 2 ? w : -w); });
    if (Q3.resEl && Number(Q3.resEl.value) < 61) Q3.resEl.value = '61';
    setEqual3d(true);
    Q3.keep = true;
    Q3.pending = async () => {
      const U = Q3.volUI;
      U.box.hidden = false; U.toggle.classList.add('on');
      volumeSurfacesChanged();
      U.s1.value = '0'; U.s2.value = '1';
      U.setRegion('disk'); U.R.value = r;
      Q3.pendingSurface = true;
      await computeVolume();
    };
    Q3.go.click();
  }
  function volumeSurfacesChanged() {
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
    return { U, f, g, disk, R, x0, x1, y0, y1 };
  }
  const polar = (e) => subXY(e, '\\r cos(\\θ)', '\\r sin(\\θ)');
  // ∬ F over the region: the exact double integral (as text), its value if the engine finds it, the numeric value
  async function regionIntegral(S, F, signedF) {
    const exprF = signedF || F;
    const ix = S.disk ? `integrate(integrate((${polar(exprF)}) × \\r, 0, ${S.R}, \\r), 0, 2π, \\θ)`
      : `integrate(integrate(${exprF}, ${S.x0}, ${S.x1}, x), ${S.y0}, ${S.y1}, y)`;
    const ex = await exactIntegral(signedF ? `abs(${ix})` : ix, Math.min(15000, timeLimit() * 1000));
    let num, missing = 0;
    if (S.disk) num = await tsDisk(F, S.R);
    else { const r = await simpsonRect(F, S.x0, S.x1, S.y0, S.y1); num = r.v; missing = r.missing; }
    // Simpson's rule on 101 × 101 points: about 8 correct digits for a smooth surface
    return { expr: ix, val: bestValue(ex, num, S.disk ? 10 : 8), missing };
  }
  async function computeVolume() {
    const S = volumeSetup();
    if (!S) return;
    const { U, f, g } = S;
    U.out.textContent = tr('Calculating…', '計算中…');
    U.ins.hidden = true;
    const d = g ? `(${f.expr}) − (${g.expr})` : f.expr;
    const r = await regionIntegral(S, `abs(${d})`, d);
    if (!r.val) { U.out.textContent = tr('Could not calculate the volume', '体積を計算できませんでした'); return; }
    U.out.textContent = '';
    showResult(U.out, tr('Volume ', '体積 ') + shownValue(r.val));
    if (r.missing) U.out.append(el('div', { class: 'form-hint', text: tr(`${r.missing} points without a real value were left out (for a round region, choose "Disk")`, `実数の値がない ${r.missing} 点を除いています（丸い範囲なら「円」を選んでください）`) }));
    Q3.volExpr = r.expr;
    U.ins.hidden = false;
    if (Q3.pendingSurface) { Q3.pendingSurface = false; await computeSurface(true); }
  }
  // the area of the surfaces: ∬ √(1 + f_x² + f_y²), for each surface (the floor z = 0: the area of the region)
  async function computeSurface(append) {
    const S = volumeSetup();
    if (!S) return;
    const { U, f, g } = S;
    const out = append ? el('div', { class: 'area-out' }) : U.out;
    if (append) U.out.append(out); else { U.out.textContent = ''; U.ins.hidden = true; }
    out.textContent = tr('Calculating…', '計算中…');
    const parts = [], names = [];
    for (const s1 of g ? [f, g] : [f]) {
      const A = recipSqrt(await symText(`√(1 + (diff(${s1.expr}, x))^2 + (diff(${s1.expr}, y))^2)`));
      if (!A) { out.textContent = tr('Could not calculate the surface area', '表面積を計算できませんでした'); return; }
      const r = await regionIntegral(S, A);
      if (!r.val) { out.textContent = tr('Could not calculate the surface area', '表面積を計算できませんでした'); return; }
      parts.push(r.val); names.push(clip(s1.expr, 24));
    }
    if (!g) {
      const floor = S.disk ? await exactIntegral(`π × (${S.R})^2`, 3000) : await exactIntegral(`abs(((${S.x1}) − (${S.x0})) × ((${S.y1}) − (${S.y0})))`, 3000);
      if (floor) { parts.push(floor); names.push(tr('floor z = 0', '底面 z = 0')); }
    }
    const total = await sumValues(parts);
    out.textContent = '';
    showResult(out, tr('Surface area ', '表面積 ') + shownValue(total));
    out.append(el('div', { class: 'form-hint', text: parts.map((p, i) => names[i] + tr(': ', '：') + shownValue(p).replace(/^= /, '')).join(tr(' / ', ' ／ ')) }));
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
    Q3.equal = store.get('qalc.plot3d.equal', 'auto');
    const wrap = el('div', { class: 'plot-wrap' }, canvas, ctl, tip);
    const legend = el('div', { class: 'legend' });
    const msg = el('div', { class: 'form-hint' });
    Object.assign(Q3, { canvas, tip, legend, msg, ta, go, inputs: [xmin, xmax, ymin, ymax], resEl: res });
    const read = () => {
      Q3.exprs = ta.value.split('\n').map(normalizeExpr).filter(Boolean).slice(0, 4);
      Q3.range = [xmin, xmax, ymin, ymax].map((e) => normalizeExpr(e.value));
      Q3.res = Number(res.value) || 41;
    };
    go.addEventListener('click', () => {
      if (!Q3.keep) { Q3.points = null; Q3.pending = null; } // they belong to the graph they were made for
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
      wrap, legend, msg, buildPartial3d(), buildVolume3d(),
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
    const list = exprs.filter(Boolean).slice(0, 4);
    store.set('qalc.plot3d.exprs', list.join('\n'));
    if (opts.range) ['xmin', 'xmax', 'ymin', 'ymax'].forEach((k, i) => store.set('qalc.plot3d.' + k, String(opts.range[i])));
    store.set('qalc.plot.mode', '3d');
    store.set('qalc.plot3d.ok', true);
    Q3.points = opts.points || null;
    if (opts.equal) setEqual3d(true);
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
    if (!Q3.exprs.length) { Q3.msg.textContent = tr('Enter a function', '関数を入力してください'); return; }
    Q3.msg.textContent = tr('Calculating…', '計算中…');
    const seq = Q3.seq = (Q3.seq || 0) + 1;
    const [x0, x1, y0, y1] = Q3.range;
    const r = await Bridge.send('plot3d', { exprs: Q3.exprs, xmin: x0 || '-5', xmax: x1 || '5', ymin: y0 || '-5', ymax: y1 || '5', nx: Q3.res, ny: Q3.res, opts: engineOpts(), timeout: 15000 });
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
    Q3.data = { xs: r.x, ys: r.y, nx, ny, series, z0, z1 };
    clearMark3d();
    const err = (r.messages || []).find((m) => m.type === 'error');
    Q3.msg.textContent = err ? localMessage(err.text)
      : series.some((s) => !s.complete) ? tr('The calculation took too long: only part of the graph was calculated', '時間がかかりすぎたため、途中までしか計算できませんでした')
      : vals.length ? '' : tr('There are no real values (check the ranges of x and y)', '実数の値がありません（x と y の範囲を確認してください）');
    Q3.legend.textContent = '';
    if (series.length === 1 && vals.length) {
      const step = niceStep(z1 - z0, 4);
      Q3.legend.append(el('span', { class: 'zbar' }, series[0].expr + tr('   z: ', '　z：') + fmt(z0, step / 10), el('i'), fmt(z1, step / 10)));
    } else {
      for (const s of series) Q3.legend.append(el('span', { style: '--c:' + s.color, text: s.expr + (s.z.some((v) => v === v) ? '' : tr(' (no values)', '（値なし）')) }));
    }
    if (Q3.volUI && !Q3.volUI.box.hidden) volumeSurfacesChanged();
    if (Q3.partUI && !Q3.partUI.box.hidden) partialSurfacesChanged();
    store.set('qalc.plot3d.ok', false);
    draw3d();
    store.set('qalc.plot3d.ok', true);
    if (await refineRims(series, r.x, r.y, seq)) draw3d();
    if (seq !== Q3.seq) return;
    if (Q3.pending) { const run = Q3.pending; Q3.pending = null; run(); }
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
    const opts = Object.assign(engineOpts(), { approx: 'approx', precision: 12, grouping: false, complex: 'rect' });
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
  // 1:1:1 — true, false, or 'auto' (until the button is used): on when the three ranges are about
  // as long as each other (a sphere, a cone), off for flat surfaces over wide ranges
  function setEqual3d(on) {
    Q3.equal = !!on;
    store.set('qalc.plot3d.equal', Q3.equal);
  }
  function equal3dNow(rx, ry, rz) {
    if (Q3.equal !== 'auto') return !!Q3.equal;
    const a = Math.max(rx, ry) / Math.min(rx, ry), b = rz / Math.max(rx, ry);
    return a <= 1.25 && b >= 0.6 && b <= 1.6;
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
          if (z === null || z !== z) continue;
          const w = Wz(z);
          if (w > EZ * 1.0001 || w < -EZ * 1.0001) { st[k] = 2; continue; }  // outside the z range
          proj(U(xs[i]), v, w);
          px[k] = T[0]; py[k] = T[1]; pd[k] = T[2]; pw[k] = w; st[k] = 1;
        }
      }
      s.rimP = null;
      if (s.rim) {
        s.rimP = {};
        for (const key in s.rim) {
          const e = s.rim[key], w = Wz(e.z);
          if (!(w <= EZ * 1.0001 && w >= -EZ * 1.0001)) continue;
          proj(U(e.x), V(e.y), w);
          s.rimP[key] = { x: T[0], y: T[1], d: T[2], u: U(e.x), v: V(e.y), w };
        }
      }
      for (let j = 0; j < D.ny - 1; j++) {
        const dv = V(ys[j + 1]) - V(ys[j]);
        for (let i = 0; i < D.nx - 1; i++) {
          const a = j * D.nx + i, b = a + 1, c2 = a + D.nx + 1, d = a + D.nx;
          const real = (st[a] === 1) + (st[b] === 1) + (st[c2] === 1) + (st[d] === 1);
          if (!real || st[a] === 2 || st[b] === 2 || st[c2] === 2 || st[d] === 2) continue;
          const du = U(xs[i + 1]) - U(xs[i]);
          let pts, nu, nv, nw;
          if (real < 4 && s.rimP) {
            // at the edge of the real values: the cell cut along the edge that was found (refineRims)
            const cs = [a, b, c2, d], eks = ['h' + a, 'v' + b, 'h' + d, 'v' + a];
            let poly = [];
            for (let n = 0; n < 4 && poly; n++) {
              const k = cs[n], k2 = cs[(n + 1) % 4];
              if (st[k] === 1) poly.push({ x: px[k], y: py[k], d: pd[k], u: U(xs[k % D.nx]), v: V(ys[(k / D.nx) | 0]), w: pw[k] });
              if ((st[k] === 1) !== (st[k2] === 1)) { const rp = s.rimP[eks[n]]; if (rp) poly.push(rp); else poly = null; }
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
            cells.push({ s, poly, depth: dd * 4 / poly.length, shade: Math.abs(ncx * L[0] + ncy * L[1] + ncd * L[2]) / len, t: (ww / (poly.length * EZ) + 1) / 2 });
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
          cells.push({ s, pts, depth: dsum * 4 / pts.length, shade, t: (wsum / (pts.length * EZ) + 1) / 2 });
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
      if (q.poly) q.poly.forEach((p, n) => { if (n) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
      else q.pts.forEach((k, n) => { if (n) g.lineTo(pr.px[k], pr.py[k]); else g.moveTo(pr.px[k], pr.py[k]); });
      g.closePath();
      g.fillStyle = col; g.fill();
      g.lineWidth = 0.7; g.strokeStyle = mesh ? meshColor : col; g.stroke();
    }
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
            el('button', { class: 'btn', text: tr('Insert', '挿入'), onclick: () => useItem(kind === 'function' ? name + '()' : name, kind === 'function' ? 1 : 0) }),
            el('button', { class: 'btn danger', text: tr('Delete', '削除'), onclick: async () => {
              if (!(await confirmSheet(tr('Delete "' + name + '"?', '「' + name + '」を削除しますか？'), tr('Delete', '削除する')))) return;
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
      ['lang', 'Language / 言語', [['en', 'English'], ['ja', '日本語']]]
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
  $('#chip-base').addEventListener('click', () => { vibrate(); cycle('base', ['10', '16', '2', '8']); toast(tr('Results in ' + BASE_NAME[String(S.base)], '結果を ' + BASE_NAME[String(S.base)] + 'で表示'), 1200); });

  // --------------------------------------------------------------- about
  let engineName = '';
  const PRIVACY_URL = 'https://hiroshitsu.github.io/qcalc/privacy.html' + (JA ? '#ja' : ''); // English first, then Japanese
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
          '式の書き方は Qalculate! と同じです。') },
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
      card.append(el('button', { class: 'btn primary pro-buy', text: PRO.price ? tr('Buy QCalc Pro (' + PRO.price + ')', 'QCalc Pro を購入（' + PRO.price + '）') : tr('Buy QCalc Pro', 'QCalc Pro を購入'), onclick: buyPro }),
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
  // the texts of index.html are in English; in Japanese they are replaced at start
  function localizeStatic() {
    if (!JA) return;
    const set = (sel, attr, text) => { const e = $(sel); if (e) e.setAttribute(attr, text); };
    set('#btn-menu', 'aria-label', 'メニュー');
    set('#chip-angle', 'title', '角度の単位');
    set('#chip-approx', 'title', '厳密計算・近似');
    set('#chip-base', 'title', '結果の進数');
    set('#history', 'aria-label', '計算の履歴');
    set('#expr', 'placeholder', '式を入力');
    set('#pages', 'aria-label', 'キーの種類');
    set('#drawer', 'aria-label', 'メニュー');
    set('#suggest', 'aria-label', '候補');
    set('#cform', 'aria-label', '入力フォーム');
    set('#varpop', 'aria-label', '文字');
    set('#plotbtn', 'aria-label', 'この式のグラフ');
    undoEl.textContent = '↶ 元に戻す';
    nextBoxEl.textContent = '次の欄 ▶';
  }
  // "Language / 言語" in the menu and in the settings: the page is loaded again in the new language
  async function chooseLanguage() {
    const k = await sheet('Language / 言語', [['en', (JA ? '' : '✓ ') + 'English'], ['ja', (JA ? '✓ ' : '') + '日本語']]);
    if (k) setLanguage(k);
  }
  function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'ja') return;
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
