// QCalc math view: an expression as it is typed (integrate(x^2, 0, 1), diff(x^3), √(2)/3 …) turned
// into TeX for KaTeX (assets/katex), so that it can be seen in the usual mathematical notation.
// QMath.toTeX(text) returns { tex, rich } or null when the text cannot be read (it is then shown as
// text). rich is true when the notation shows more than the text (fractions, powers, roots,
// integrals …). An expression that is still being typed works too: missing ")" are added at the
// end, and a missing operand (x^, an empty function argument, a □ to fill in) is shown as □.
(function () {
  'use strict';
  const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
  const SUP_RE = /^[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/;
  const OPS = '+-−×*·÷/^!%=≠<>≤≥±(),;[]√∛∜°→∞□≈';

  function tokenize(s) {
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i], rest = s.slice(i);
      if (/\s/.test(c)) { i++; continue; }
      let m;
      // (1.15.0) a number of a result may have its digits in groups (a narrow space between them, as the engine writes
      // them): one number, not numbers multiplied (that was drawn 0.583 · 333 · 333)
      if ((m = /^(?:\d+(?:[\u202f\u2009]\d+)*(?:\.(?:\d+(?:[\u202f\u2009]\d+)*)?)?|\.\d+(?:[\u202f\u2009]\d+)*)(?:E[−-]?\d+)?/.exec(rest))) { t.push({ k: 'num', v: m[0] }); i += m[0].length; continue; }
      if ((m = SUP_RE.exec(rest))) { t.push({ k: 'sup', v: Array.from(m[0]).map((x) => SUP[x]).join('') }); i += m[0].length; continue; }
      // an unknown written \t or 't' (a letter that would otherwise be a unit or a constant)
      if ((m = /^\\([\p{L}_][\p{L}\p{Nd}_]*)/u.exec(rest)) || (m = /^'([\p{L}_][\p{L}\p{Nd}_]*)'/u.exec(rest))) { t.push({ k: 'id', v: m[1] }); i += m[0].length; continue; }
      // a name (π stands alone: iπ is i × π; ² after a name is a power, not part of it)
      if (c === 'π') { t.push({ k: 'id', v: 'π' }); i++; continue; }
      if ((m = /^[\p{L}_][\p{L}\p{Nd}_]*/u.exec(rest))) { const v = m[0].split('π')[0]; t.push({ k: 'id', v }); i += v.length; continue; }
      if ((m = /^"[^"]*"/.exec(rest))) { t.push({ k: 'str', v: m[0].slice(1, -1) }); i += m[0].length; continue; }
      if (rest.startsWith('->')) { t.push({ k: 'op', v: '→' }); i += 2; continue; }
      if (rest.startsWith('<=')) { t.push({ k: 'op', v: '≤' }); i += 2; continue; }
      if (rest.startsWith('>=')) { t.push({ k: 'op', v: '≥' }); i += 2; continue; }
      if (rest.startsWith('!=')) { t.push({ k: 'op', v: '≠' }); i += 2; continue; }
      if (rest.startsWith('**')) { t.push({ k: 'op', v: '^' }); i += 2; continue; }
      if (OPS.indexOf(c) >= 0) { t.push({ k: 'op', v: c === '-' ? '−' : c === '*' || c === '·' ? '×' : c }); i++; continue; }
      if (c === '′' || c === "'") { t.push({ k: 'op', v: '′' }); i++; continue; }
      throw new Error('char');
    }
    return t;
  }

  // ---------------------------------------------------------------- parser (precedence climbing)
  const FUNCS_1 = new Set(['f', 'g', 'h', 'O']); // single letters that are written as functions: f(x); O(x⁶), the remainder of a Taylor series (1.15.0)
  function parse(tokens) {
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => tokens[p] && tokens[p].k === 'op' && tokens[p].v === v;
    const isId = (v) => tokens[p] && tokens[p].k === 'id' && tokens[p].v === v;
    const next = () => tokens[p++];
    const startsOperand = (tk) => tk && (tk.k === 'num' || tk.k === 'id' || tk.k === 'str' ||
      (tk.k === 'op' && '([√∛∜∞□'.indexOf(tk.v) >= 0));
    const KEYWORDS = new Set(['to', 'where', 'mod', 'and', 'or']);

    function args(close) {
      const a = [];
      if (isOp(close)) { next(); return [{ t: 'hole' }]; }
      for (;;) {
        a.push(isOp(',') || isOp(close) || !peek() ? { t: 'hole' } : expr(0));
        if (isOp(',')) { next(); continue; }
        if (isOp(close)) { next(); return a; }
        if (!peek()) return a;
        throw new Error('args');
      }
    }
    function matrix() {
      const rows = [[]];
      if (isOp(']')) { next(); return { t: 'mat', rows: [[{ t: 'hole' }]] }; }
      for (;;) {
        rows[rows.length - 1].push(isOp(',') || isOp(';') || isOp(']') ? { t: 'hole' } : expr(0));
        if (isOp(',')) { next(); continue; }
        if (isOp(';')) { next(); rows.push([]); continue; }
        if (isOp(']') || !peek()) { if (peek()) next(); return { t: 'mat', rows }; }
        throw new Error('matrix');
      }
    }
    function primary() {
      const tk = next();
      if (!tk) return { t: 'hole' };
      if (tk.k === 'num') return { t: 'num', v: tk.v };
      if (tk.k === 'str') return { t: 'str', v: tk.v };
      if (tk.k === 'id') {
        if (KEYWORDS.has(tk.v)) throw new Error('keyword');
        if (isOp('(') && (tk.v.length > 1 || FUNCS_1.has(tk.v))) { next(); return { t: 'call', name: tk.v, args: args(')') }; }
        return { t: 'id', v: tk.v };
      }
      switch (tk.v) {
        case '(': { const e = isOp(')') ? { t: 'hole' } : expr(0); if (isOp(')')) next(); else if (peek()) throw new Error('paren'); return { t: 'paren', e }; }
        case '[': return matrix();
        case '√': case '∛': case '∜': {
          const name = { '√': 'sqrt', '∛': 'cbrt', '∜': 'root4' }[tk.v];
          if (isOp('(')) { next(); return { t: 'call', name, args: args(')') }; }
          return { t: 'call', name, args: [unary(40)] };
        }
        case '∞': return { t: 'inf' };
        case '□': return { t: 'hole' };
        case '−': return { t: 'neg', e: unary(22) };
        case '+': return { t: 'pos', e: unary(22) };
        case ')': case ',': case ';': case ']': p--; return { t: 'hole' };
      }
      throw new Error('primary');
    }
    function unary(rbp) { return expr(rbp); }
    // binding powers: relations 5, ± 9, + − 10, mod 15, × ÷ / 20, implicit multiplication 25, ^ 30, postfix 40
    function expr(rbp) {
      let left = primary();
      for (;;) {
        const tk = peek();
        if (!tk) break;
        if (tk.k === 'op') {
          const v = tk.v;
          if ('=≠<>≤≥≈'.indexOf(v) >= 0) { if (rbp >= 5) break; next(); left = { t: 'rel', op: v, a: left, b: expr(5) }; continue; }
          if (v === '±') { if (rbp >= 9) break; next(); left = { t: 'bin', op: '±', a: left, b: expr(9) }; continue; }
          if (v === '+' || v === '−') { if (rbp >= 10) break; next(); left = { t: 'bin', op: v, a: left, b: expr(10) }; continue; }
          if (v === '×' || v === '÷' || v === '/') { if (rbp >= 20) break; next(); left = { t: v === '/' ? 'frac' : 'bin', op: v, a: left, b: expr(20) }; continue; }
          if (v === '^') { if (rbp >= 30) break; next(); left = { t: 'pow', a: left, b: expr(29) }; continue; }
          if (v === '!' || v === '%' || v === '°' || v === '′') { if (rbp >= 40) break; next(); left = { t: 'post', op: v, a: left }; continue; }
          if (v === '→') break;
        }
        if (tk.k === 'sup') { if (rbp >= 40) break; next(); left = { t: 'pow', a: left, b: { t: 'num', v: tk.v }, sup: true }; continue; }
        if (tk.k === 'id' && tk.v === 'mod') { if (rbp >= 15) break; next(); left = { t: 'bin', op: 'mod', a: left, b: expr(15) }; continue; }
        if (tk.k === 'id' && KEYWORDS.has(tk.v)) break;
        if (startsOperand(tk)) { if (rbp >= 25) break; left = { t: 'imul', a: left, b: expr(25) }; continue; }
        break;
      }
      return left;
    }
    // top level: an expression, "to" a unit, or "where" a condition
    let e = expr(0);
    for (;;) {
      if (isId('to') || isOp('→')) { next(); e = { t: 'conv', a: e, b: peek() ? expr(0) : { t: 'hole' } }; continue; }
      if (isId('where')) { next(); e = { t: 'where', a: e, b: peek() ? expr(0) : { t: 'hole' } }; continue; }
      if (isId('and') || isId('or')) { const op = next().v; e = { t: 'bin', op, a: e, b: expr(0) }; continue; }
      break;
    }
    if (p < tokens.length) throw new Error('rest');
    return e;
  }

  // ---------------------------------------------------------------- TeX
  const GREEK = { alpha: 1, beta: 1, gamma: 1, delta: 1, epsilon: 1, theta: 1, lambda: 1, mu: 1, sigma: 1, tau: 1, phi: 1, omega: 1 };
  const NAMED = {
    O: '\\operatorname{O}', // (1.15.0: the remainder of a Taylor series)
    sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
    sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth',
    asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
    ln: '\\ln', exp: null, det: '\\det', gcd: '\\gcd', max: '\\max', min: '\\min', arg: '\\arg', lg: '\\lg'
  };
  const esc = (s) => s.replace(/[\\{}_^#$%&~]/g, (c) => ({ '\\': '\\backslash{}', '~': '\\sim{}', '^': '\\hat{}' }[c] || '\\' + c));
  const word = (s) => /^[A-Za-z0-9_]+$/.test(s) ? '\\mathrm{' + esc(s) + '}' : '\\text{' + esc(s) + '}';
  const strip = (n) => (n && n.t === 'paren' ? n.e : n);

  function texId(v) {
    if (v === 'pi' || v === 'π') return '\\pi';
    if (v === 'e' || v === 'i') return v;
    if (GREEK[v]) return '\\' + v;
    if (Array.from(v).length === 1) return /[A-Za-z\u0370-\u03ff]/.test(v) ? v : '\\text{' + esc(v) + '}';
    return word(v);
  }
  // does the node need parentheses as the base of a power or the argument of a postfix operator?
  const complexBase = (n) => ['bin', 'imul', 'neg', 'pos', 'frac', 'rel', 'pow', 'conv', 'where'].indexOf(n.t) >= 0 ||
    (n.t === 'num' && /E|^\d+\.\d|[−-]/.test(n.v));
  // a function's argument that is shown without parentheses when it is simple (∫ x² dx, d/dx sin(x))
  const simpleArg = (n) => ['num', 'id', 'call', 'paren', 'inf', 'hole', 'mat'].indexOf(n.t) >= 0 ||
    (n.t === 'pow' && ['num', 'id', 'paren', 'call'].indexOf(n.a.t) >= 0) || n.t === 'frac' || n.t === 'post';
  const paren = (s) => '\\left(' + s + '\\right)';
  const BIN = { '+': '+', '−': '-', '×': '\\times', '÷': '\\div', '±': '\\pm', mod: '\\bmod', and: '\\;\\text{and}\\;', or: '\\;\\text{or}\\;' };
  const REL = { '=': '=', '≠': '\\ne', '<': '<', '>': '>', '≤': '\\le', '≥': '\\ge', '≈': '\\approx' };

  // (1.15.0) the signs of a number as shown (opts.nf of render: the decimal sign and the sign between groups of
  // digits of the app's number format); the groups of the decimals are always narrow spaces (0.583 333 333)
  let SEP = { dec: '.', group: '\\,' };
  const SEP_TEX = { '.': '{.}', ',': '{,}', '\u202f': '\\,', '\u2009': '\\,', ' ': '\\,', '': '' };
  function setSep(nf) {
    SEP = nf ? { dec: nf.dec === ',' ? '{,}' : '.', group: Object.prototype.hasOwnProperty.call(SEP_TEX, nf.group) ? SEP_TEX[nf.group] : '\\,' } : { dec: '.', group: '\\,' };
  }
  function numTeX(v) {
    const k = v.indexOf('.'), i = k < 0 ? v : v.slice(0, k), f = k < 0 ? null : v.slice(k + 1);
    const g = (s, j) => s.split(/[\u202f\u2009]/).join(j);
    return g(i, SEP.group) + (f === null ? '' : SEP.dec + g(f, '\\,'));
  }

  function tex(n, rich) {
    const T = (x) => tex(x, rich);
    const arg = (x) => (simpleArg(x) ? T(x) : paren(T(strip(x))));
    switch (n.t) {
      case 'num': {
        const m = /^(.*)E([−-]?\d+)$/.exec(n.v);
        if (m) { rich.v = true; return numTeX(m[1]) + '\\times 10^{' + m[2].replace('−', '-') + '}'; }
        return numTeX(n.v);
      }
      case 'id': return texId(n.v);
      case 'str': return '\\text{“' + esc(n.v) + '”}';
      case 'inf': return '\\infty';
      case 'hole': return '\\square';
      case 'paren': return paren(T(n.e));
      case 'neg': return '-' + T(n.e);
      case 'pos': return '+' + T(n.e);
      case 'bin': return T(n.a) + ' ' + BIN[n.op] + ' ' + T(n.b);
      case 'imul': {
        // (2/3)x³: the fraction needs no parentheses in front of what it multiplies
        const a = n.a.t === 'paren' && n.a.e.t === 'frac' ? T(n.a.e) : T(n.a), b = T(n.b);
        const sep = /\d$/.test(a) && /^[\d.]/.test(b) ? '\\cdot ' : (n.a.t === 'num' && (n.b.t === 'id' && n.b.v.length === 1 || n.b.t === 'paren' || n.b.t === 'pow')) ? '' : '\\,';
        return a + sep + b;
      }
      case 'frac': rich.v = true; return '\\frac{' + T(strip(n.a)) + '}{' + T(strip(n.b)) + '}';
      case 'pow': {
        rich.v = true;
        const b = complexBase(n.a) ? paren(T(n.a)) : T(n.a);
        return b + '^{' + T(strip(n.b)).replace('−', '-') + '}';
      }
      case 'post': {
        const a = complexBase(n.a) ? paren(T(n.a)) : T(n.a);
        return a + { '!': '!', '%': '\\%', '°': '^{\\circ}', '′': "'" }[n.op];
      }
      case 'rel': return T(n.a) + ' ' + REL[n.op] + ' ' + T(n.b);
      case 'conv': return T(n.a) + ' \\;\\rightarrow\\; ' + T(n.b);
      case 'where': rich.v = true; return '\\left.' + T(n.a) + '\\right|_{' + T(n.b) + '}';
      case 'mat': rich.v = true; return '\\begin{bmatrix}' + n.rows.map((r) => r.map(T).join(' & ')).join(' \\\\ ') + '\\end{bmatrix}';
      case 'call': return call(n, rich, T, arg);
    }
    throw new Error('node');
  }

  function call(n, rich, T, arg) {
    const a = n.args, name = n.name;
    const A = (i) => (a[i] ? T(strip(a[i])) : '\\square');
    const has = (i) => a[i] && a[i].t !== 'hole';
    const isVar = (x) => x && x.t === 'id' && Array.from(x.v).length === 1;
    const d = '\\mathrm{d}';
    switch (name) {
      case 'sqrt': rich.v = true; return '\\sqrt{' + A(0) + '}';
      case 'cbrt': rich.v = true; return '\\sqrt[3]{' + A(0) + '}';
      case 'root4': rich.v = true; return '\\sqrt[4]{' + A(0) + '}';
      case 'root': rich.v = true; return '\\sqrt[' + A(1) + ']{' + A(0) + '}';
      case 'abs': rich.v = true; return '\\left|' + A(0) + '\\right|';
      case 'exp': rich.v = true; return 'e^{' + A(0) + '}';
      case 'floor': return '\\left\\lfloor ' + A(0) + '\\right\\rfloor';
      case 'ceil': return '\\left\\lceil ' + A(0) + '\\right\\rceil';
      case 'factorial': return (complexBase(strip(a[0]) || { t: 'hole' }) ? paren(A(0)) : A(0)) + '!';
      case 'log10': rich.v = true; return '\\log_{10}' + paren(A(0));
      case 'log2': rich.v = true; return '\\log_{2}' + paren(A(0));
      case 'log': if (a.length > 1) { rich.v = true; return '\\log_{' + A(1) + '}' + paren(A(0)); } return '\\log' + paren(A(0));
      case 'integrate': case 'integral': {
        rich.v = true;
        // integrate(f, lower, upper, variable); "undefined" limits make an indefinite integral
        const lo = 1, hi = 2, v = 3;
        const undef = (i) => a[i] && a[i].t === 'id' && a[i].v === 'undefined';
        const lim = !undef(lo) && (has(lo) || has(hi) || a.length > hi) ? '_{' + A(lo) + '}^{' + A(hi) + '}' : '';
        return '\\int' + lim + ' ' + arg(a[0] || { t: 'hole' }) + '\\,' + d + (has(v) ? A(v) : 'x');
      }
      case 'diff': case 'derivative': {
        rich.v = true;
        const v = has(1) ? A(1) : 'x', order = has(2) ? A(2) : '1';
        const op = order === '1' ? '\\frac{' + d + '}{' + d + v + '}' : '\\frac{' + d + '^{' + order + '}}{' + d + v + '^{' + order + '}}';
        const body = op + arg(a[0] || { t: 'hole' });
        return has(3) ? '\\left.' + body + '\\right|_{' + v + '=' + A(3) + '}' : body;
      }
      case 'limit': {
        rich.v = true;
        const v = has(2) ? A(2) : 'x';
        const dir = has(3) ? ({ '1': '^{+}', '-1': '^{-}', '−1': '^{-}' }[T(strip(a[3])).replace(/\s/g, '')] || '') : '';
        return '\\lim_{' + v + ' \\to ' + A(1) + dir + '} ' + arg(a[0] || { t: 'hole' });
      }
      case 'sum': case 'product': {
        rich.v = true;
        const v = has(3) ? A(3) : 'x';
        return (name === 'sum' ? '\\sum' : '\\prod') + '_{' + v + '=' + A(1) + '}^{' + A(2) + '} ' + arg(a[0] || { t: 'hole' });
      }
      case 'dsolve': {
        rich.v = true;
        // diff(y, x) is shown as y′; the second argument is the value of y at x = 0
        const show = (x) => (x && x.t === 'call' && (x.name === 'diff' || x.name === 'derivative') && x.args[0] && x.args[0].t === 'id' && (!x.args[1] || isVar(x.args[1]))
          ? texId(x.args[0].v) + "'" : null);
        const eq = (x) => {
          if (!x) return '\\square';
          const s = show(x);
          if (s) return s;
          if (x.t === 'rel') return eq(x.a) + ' ' + REL[x.op] + ' ' + eq(x.b);
          if (x.t === 'bin') return eq(x.a) + ' ' + BIN[x.op] + ' ' + eq(x.b);
          return T(x);
        };
        let s = eq(strip(a[0]));
        if (has(1)) s += ',\\quad y(0) = ' + A(1);
        return '\\operatorname{dsolve}' + paren(s);
      }
    }
    const fn = NAMED[name];
    if (name === 'O') return fn + '(' + a.map((x) => T(strip(x))).join(',\\, ') + ')'; // (O(x⁸) close to its parentheses)
    const head = fn ? fn : Array.from(name).length === 1 ? texId(name) : '\\operatorname{' + esc(name) + '}';
    return head + paren(a.map((x) => T(strip(x))).join(',\\, '));
  }

  function toTeX(text, opts) {
    if (!text || !text.trim() || text.length > 2000) return null;
    setSep(opts && opts.nf);
    try {
      let s = text, lead = '';
      // a result begins with "= " or "≈ "
      const m0 = /^\s*([=≈])\s*/.exec(s);
      if (m0) { lead = m0[1] === '=' ? '= ' : '\\approx '; s = s.slice(m0[0].length); }
      // missing ")" at the end (the expression is still being typed)
      let depth = 0;
      for (const c of s) { if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1); }
      s += ')'.repeat(Math.min(depth, 20));
      const tokens = tokenize(s);
      if (!tokens.length) return null;
      const rich = { v: false };
      const out = tex(parse(tokens), rich);
      return { tex: lead + out, rich: rich.v };
    } catch (e) {
      return null;
    }
  }

  // Renders text into el with KaTeX; false (and nothing changed) when it cannot be read or KaTeX is missing.
  function render(el, text, opts) {
    const r = toTeX(text, opts);
    if (!r || !window.katex || (opts && opts.richOnly && !r.rich)) return false;
    try {
      window.katex.render('\\displaystyle ' + r.tex, el, { throwOnError: false, strict: 'ignore', output: opts && opts.mathml ? 'htmlAndMathml' : 'html' });
      return true;
    } catch (e) {
      return false;
    }
  }

  window.QMath = { toTeX, render };
})();
