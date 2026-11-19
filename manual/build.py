#!/usr/bin/env python3
"""Makes the user manual of QCalc from its source, in two forms with the same text (1.12.0, H).

  manual/src/<lang>.txt  the source (one per language; the format is described in manual/README.md)
  manual/svg/*.svg       simple pictures, the same in every language (numbers, no words)
  ->  app/assets/manual/<lang>.js      inside the app: text and the SVG pictures only, read offline
  ->  docs/manual/<lang>/index.html    the full version on the site, with the photos of docs/manual/<lang>/img/
  ->  docs/manual/index.html           the choice of the language

Only the Python standard library is used. The made files are committed, so build-apk.sh does not run this.
The PDF is made from the web version by manual/pdf.py.

  python3 manual/build.py            make everything and check it
  python3 manual/build.py --check    only check: every UI name in [[...]] is a text of the app in that
                                     language, every link and every id the app links to is in every
                                     language, the ids are the same in every language
"""
import html, json, os, re, sys

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(R, 'manual', 'src')
SVG = os.path.join(R, 'manual', 'svg')
ASSETS = os.path.join(R, 'app', 'assets')
DOCS = os.path.join(R, 'docs', 'manual')
LANGS = ['ja', 'en', 'de', 'es', 'fr', 'ko', 'zh-TW']
NAMES = {'en': 'English', 'ja': '日本語', 'es': 'Español', 'de': 'Deutsch', 'fr': 'Français', 'ko': '한국어', 'zh-TW': '繁體中文'}
VERSION, DATE = '1.12.0', '2026-11-19'
BASE = 'https://hiroshitsu.github.io/qcalc/manual/'

# the words of the page in each language (labels of the blocks, the contents, the search)
W = {
 'ja': dict(what='できること', steps='手順', example='例', tip='ヒント', mistakes='よくある間違い', pro='QCalc Pro の機能です。',
            toc='目次', search='説明書を検索', none='見つかりません。ほかの言葉で探してください。', pdf='PDF で保存',
            index='索引', top='いちばん上へ', version='版', web='写真つきの詳しい版（Web）', photo='画面の写真', note='注意',
            lang='言語', app='アプリの中の版と同じ内容です。'),
 'en': dict(what='What it does', steps='Steps', example='Example', tip='Tip', mistakes='Common mistakes', pro='This is a QCalc Pro feature.',
            toc='Contents', search='Search the manual', none='Nothing found. Try another word.', pdf='Save as PDF',
            index='Index', top='Back to the top', version='Version', web='Detailed version with photos (web)', photo='Screen photo', note='Note',
            lang='Language', app='The same text as the manual inside the app.'),
 'de': dict(what='Was es kann', steps='Schritte', example='Beispiel', tip='Tipp', mistakes='Häufige Fehler', pro='Dies ist eine Funktion von QCalc Pro.',
            toc='Inhalt', search='In der Anleitung suchen', none='Nichts gefunden. Versuchen Sie ein anderes Wort.', pdf='Als PDF speichern',
            index='Stichwortverzeichnis', top='Nach oben', version='Version', web='Ausführliche Fassung mit Fotos (Web)', photo='Foto des Bildschirms', note='Hinweis',
            lang='Sprache', app='Derselbe Text wie die Anleitung in der App.'),
 'es': dict(what='Qué hace', steps='Pasos', example='Ejemplo', tip='Consejo', mistakes='Errores frecuentes', pro='Es una función de QCalc Pro.',
            toc='Contenido', search='Buscar en el manual', none='No se encontró nada. Prueba otra palabra.', pdf='Guardar como PDF',
            index='Índice alfabético', top='Volver arriba', version='Versión', web='Versión detallada con fotos (web)', photo='Foto de la pantalla', note='Nota',
            lang='Idioma', app='El mismo texto que el manual dentro de la app.'),
 'fr': dict(what='Ce qu’il fait', steps='Étapes', example='Exemple', tip='Astuce', mistakes='Erreurs fréquentes', pro='C’est une fonction de QCalc Pro.',
            toc='Sommaire', search='Chercher dans le mode d’emploi', none='Rien trouvé. Essayez un autre mot.', pdf='Enregistrer en PDF',
            index='Index', top='Haut de page', version='Version', web='Version détaillée avec photos (web)', photo='Photo de l’écran', note='Remarque',
            lang='Langue', app='Le même texte que le mode d’emploi dans l’app.'),
 'ko': dict(what='할 수 있는 것', steps='순서', example='예', tip='도움말', mistakes='자주 하는 실수', pro='QCalc Pro 기능입니다.',
            toc='목차', search='설명서 검색', none='찾지 못했습니다. 다른 말로 찾아 보세요.', pdf='PDF로 저장',
            index='색인', top='맨 위로', version='버전', web='사진이 있는 자세한 판(웹)', photo='화면 사진', note='주의',
            lang='언어', app='앱 안의 설명서와 같은 내용입니다.'),
 'zh-TW': dict(what='可以做什麼', steps='步驟', example='例子', tip='提示', mistakes='常見錯誤', pro='這是 QCalc Pro 的功能。',
            toc='目錄', search='搜尋說明書', none='找不到。請換個詞試試。', pdf='存成 PDF',
            index='索引', top='回到頂端', version='版本', web='附照片的詳細版（網頁）', photo='畫面照片', note='注意',
            lang='語言', app='與 App 內的說明書內容相同。'),
}


# ------------------------------------------------------------------ the texts of the app
def app_texts():
    """{lang: set of texts shown}: tr(en, ja) of app.js, and the translations of the i18n files"""
    js = open(os.path.join(ASSETS, 'app.js'), encoding='utf-8').read()
    lit = r"'((?:[^'\\]|\\.)*)'"
    en, ja = set(), set()
    for m in re.finditer(r"\btrf?\(\s*" + lit + r"\s*,\s*" + lit, js):
        en.add(unesc(m.group(1))); ja.add(unesc(m.group(2)))
    for m in re.finditer(lit, js):  # other literal texts (key labels, names)
        en.add(unesc(m.group(1)))
    out = {'en': en, 'ja': ja | {t for t in en if not re.search('[A-Za-z]{3}', t)}}
    maps = {}
    for l in ['de', 'es', 'fr', 'ko', 'zh-TW']:
        s = open(os.path.join(ASSETS, 'i18n-%s.js' % l), encoding='utf-8').read()
        a = s.index('  texts: {\n') + len('  texts: {\n'); b = s.index('\n  },\n  messages: {', a)
        m = {}
        for line in s[a:b].split('\n'):
            t = line.strip().rstrip(',')
            if not t.startswith('"'):
                continue
            k, end = json.JSONDecoder().raw_decode(t)
            rest = t[end:].lstrip()
            if rest.startswith(':'):
                v, _ = json.JSONDecoder().raw_decode(rest[1:].lstrip())
                m[k] = v
        maps[l] = m
        out[l] = set(m.values()) | {t for t in en if not re.search('[A-Za-z]{3}', t)}
    return out, maps


def unesc(s):
    return s.replace("\\'", "'").replace('\\\\', '\\').replace('\\n', '\n')


def app_ids():
    """the ids of the sections that the app links to (MANUAL_IDS of app.js)"""
    js = open(os.path.join(ASSETS, 'app.js'), encoding='utf-8').read()
    ids = set()
    for name in ['HELP', 'PRO_HELP', 'FORM_HELP']:
        m = re.search(r'const %s = \{(.*?)\};' % name, js, re.S)
        ids |= set(re.findall(r":\s*'([a-z0-9-]+)'", m.group(1)))
    m = re.search(r"const MANUAL_IDS = Array\.from\(new Set\(\[(.*?)\]", js, re.S)
    ids |= set(i for i in re.findall(r"'([a-z0-9-]*)'", m.group(1)) if i)
    return ids


# ------------------------------------------------------------------ the source
class Doc:
    def __init__(self, lang):
        self.lang = lang
        self.title, self.sub = 'QCalc', ''
        self.chapters = []   # [{id, title, level, blocks}] in order (level 1 chapter, 2 section, 3 subsection)
        self.errors = []
        self.labels = []     # (label as written, section id)
        self.links = []      # (target id, section id)


def parse(lang):
    d = Doc(lang)
    cur = None
    para = []

    def flush():
        if para and cur is not None:
            cur['blocks'].append(('p', ' '.join(para)))
        para.clear()

    path = os.path.join(SRC, lang + '.txt')
    for n, raw in enumerate(open(path, encoding='utf-8').read().split('\n'), 1):
        line = raw.rstrip()
        if line.startswith('//'):
            continue
        if not line.strip():
            flush(); continue
        m = re.match(r'^(#{1,3}) ([a-z0-9-]+) \| (.+)$', line)
        if m:
            flush()
            cur = {'id': m.group(2), 'title': m.group(3).strip(), 'level': len(m.group(1)), 'blocks': [], 'line': n}
            d.chapters.append(cur); continue
        if line.startswith('= '):
            d.title = line[2:].strip(); continue
        if line.startswith('@sub '):
            d.sub = line[5:].strip(); continue
        m = re.match(r'^:([a-z]+):\s?(.*)$', line)
        if m:
            flush()
            if cur is None:
                d.errors.append('%s:%d: a block before the first heading' % (lang, n)); continue
            cur['blocks'].append((m.group(1), m.group(2).strip())); continue
        if line.startswith('- ') or line.startswith('| '):
            flush(); cur['blocks'].append(('li' if line.startswith('- ') else 'tr', line[2:] if line.startswith('- ') else line)); continue
        para.append(line.strip())
    flush()
    return d


# ------------------------------------------------------------------ rendering
def inline(d, text, sec, maps, mode):
    """[[label]] (a name on the screen), **bold**, `code`, [text](#id or https://...)"""
    out, i = [], 0
    pat = re.compile(r'\[\[(.+?)\]\]|\*\*(.+?)\*\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\)')
    for m in pat.finditer(text):
        out.append(html.escape(text[i:m.start()], quote=False))
        if m.group(1) is not None:
            lab = m.group(1)
            lit = lab.startswith('!')
            if lit:
                lab = lab[1:]
            shown = lab
            if not lit and d.lang not in ('en', 'ja'):
                shown = maps[d.lang].get(lab)
                if shown is None:
                    d.errors.append('%s §%s: no translation of the app text [[%s]]' % (d.lang, sec, lab)); shown = lab
            if not lit:
                d.labels.append((shown, sec))
            out.append('<b class="ui">%s</b>' % html.escape(shown, quote=False))
        elif m.group(2) is not None:
            out.append('<b>%s</b>' % html.escape(m.group(2), quote=False))
        elif m.group(3) is not None:
            out.append('<code>%s</code>' % html.escape(m.group(3), quote=False))
        else:
            target = m.group(5)
            if target.startswith('#'):
                d.links.append((target[1:], sec))
            out.append('<a href="%s">%s</a>' % (html.escape(target), html.escape(m.group(4), quote=False)))
        i = m.end()
    out.append(html.escape(text[i:], quote=False))
    return ''.join(out)


def svg(name):
    p = os.path.join(SVG, name + '.svg')
    s = open(p, encoding='utf-8').read()
    return re.sub(r'<\?xml.*?\?>\s*', '', s).strip()


def render(d, maps, mode):
    """mode 'app' (data-sec, no photos) or 'web' (ids, photos)"""
    w = W[d.lang]
    parts = []
    # contents
    toc = ['<nav class="m-toc" aria-label="%s"><div class="m-toc-t">%s</div><ol>' % (w['toc'], w['toc'])]
    open_ch = False
    for c in d.chapters:
        if c['level'] == 1:
            if open_ch:
                toc.append('</ol></li>')
            toc.append('<li><a href="#%s">%s</a><ol>' % (c['id'], html.escape(c['title'], quote=False)))
            open_ch = True
        elif c['level'] == 2:
            toc.append('<li><a href="#%s">%s</a></li>' % (c['id'], html.escape(c['title'], quote=False)))
    if open_ch:
        toc.append('</ol></li>')
    toc.append('<li><a href="#index">%s</a></li></ol></nav>' % w['index'])
    parts.append(''.join(toc).replace('<ol></ol>', ''))  # (a chapter without sections)
    attr = (lambda i: 'data-sec="%s"' % i) if mode == 'app' else (lambda i: 'id="%s"' % i)
    depth = 0
    for c in d.chapters:
        lvl = c['level']
        while depth >= lvl:
            parts.append('</section>'); depth -= 1
        cls = {1: 'm-ch', 2: 'm-sec', 3: 'm-sub'}[lvl]
        parts.append('<section class="%s" %s>' % (cls, attr(c['id'])))
        depth = lvl
        parts.append('<h%d>%s</h%d>' % (lvl + 1, html.escape(c['title'], quote=False), lvl + 1))
        parts.append(blocks(d, c, maps, mode))
    while depth > 0:
        parts.append('</section>'); depth -= 1
    parts.append(index(d, mode))
    return '\n'.join(parts)


def blocks(d, c, maps, mode):
    w = W[d.lang]
    out = []
    bl = c['blocks']
    i = 0
    sec = c['id']
    while i < len(bl):
        k, t = bl[i]
        if k in ('step', 'mistake', 'li', 'tr'):
            j = i
            while j < len(bl) and bl[j][0] == k:
                j += 1
            items = [x[1] for x in bl[i:j]]
            if k == 'step':
                if len(items) > 7:
                    d.errors.append('%s §%s: %d steps (at most 7)' % (d.lang, sec, len(items)))
                out.append('<div class="m-steps"><div class="m-lbl">%s</div><ol>%s</ol></div>' % (w['steps'], ''.join('<li>%s</li>' % inline(d, x, sec, maps, mode) for x in items)))
            elif k == 'mistake':
                out.append('<div class="m-box m-mis"><div class="m-lbl">%s</div><ul>%s</ul></div>' % (w['mistakes'], ''.join('<li>%s</li>' % inline(d, x, sec, maps, mode) for x in items)))
            elif k == 'li':
                out.append('<ul>%s</ul>' % ''.join('<li>%s</li>' % inline(d, x, sec, maps, mode) for x in items))
            else:
                rows = [[x.strip() for x in r.strip().strip('|').split('|')] for r in items]
                head = rows[0]
                body = ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % inline(d, x, sec, maps, mode) for x in r) for r in rows[1:])
                out.append('<div class="m-tw"><table><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (''.join('<th>%s</th>' % inline(d, x, sec, maps, mode) for x in head), body))
            i = j; continue
        if k == 'p':
            out.append('<p>%s</p>' % inline(d, t, sec, maps, mode))
        elif k == 'what':
            out.append('<p class="m-what"><span class="m-lbl">%s</span> %s</p>' % (w['what'], inline(d, t, sec, maps, mode)))
        elif k == 'example':
            out.append('<div class="m-box m-ex"><div class="m-lbl">%s</div><p>%s</p></div>' % (w['example'], inline(d, t, sec, maps, mode)))
        elif k == 'tip':
            out.append('<div class="m-box m-tip"><div class="m-lbl">%s</div><p>%s</p></div>' % (w['tip'], inline(d, t, sec, maps, mode)))
        elif k == 'note':
            out.append('<div class="m-box m-note"><div class="m-lbl">%s</div><p>%s</p></div>' % (w['note'], inline(d, t, sec, maps, mode)))
        elif k == 'pro':
            out.append('<p class="m-pro"><span class="m-badge">Pro</span> %s %s</p>' % (w['pro'], inline(d, t, sec, maps, mode) if t else ''))
        elif k == 'svg':
            name, _, cap = t.partition('|')
            out.append('<figure class="m-fig m-svg">%s<figcaption>%s</figcaption></figure>' % (svg(name.strip()), inline(d, cap.strip(), sec, maps, mode)))
        elif k == 'shot':
            name, _, alt = t.partition('|')
            name, alt = name.strip(), alt.strip()
            if mode == 'web':
                alt = re.sub(r'\[\[!?(.+?)\]\]', lambda m: m.group(1) if d.lang in ('en', 'ja') else maps[d.lang].get(m.group(1), m.group(1)), alt)
                out.append(shot(d, name, alt))
        elif k == 'legend':
            # the numbers of the picture above: "1 text; 2 text; ..."
            items = [x.strip() for x in t.split(';') if x.strip()]
            out.append('<ol class="m-legend">%s</ol>' % ''.join('<li>%s</li>' % inline(d, re.sub(r'^\d+\s+', '', x), sec, maps, mode) for x in items))
        else:
            d.errors.append('%s §%s: unknown block :%s:' % (d.lang, sec, k))
        i += 1
    return '\n'.join(out)


def shot(d, name, alt):
    """a photo of the screen (web only), with its numbered marks from img/<name>.json when there is one"""
    img = os.path.join(DOCS, d.lang, 'img', name + '.jpg')
    if not os.path.exists(img):
        d.errors.append('%s: no photo img/%s.jpg' % (d.lang, name))
        return ''
    marks = ''
    mp = os.path.join(DOCS, d.lang, 'img', name + '.json')
    if os.path.exists(mp):
        m = json.load(open(mp, encoding='utf-8'))
        marks = ''.join('<span class="m-mark" style="left:%.1f%%;top:%.1f%%" aria-hidden="true">%d</span>' % (x * 100, y * 100, k)
                        for k, (x, y) in enumerate(m.get('marks', []), 1))
    return ('<figure class="m-fig m-shot"><div class="m-shot-in"><img src="img/%s.jpg" alt="%s" width="360">%s</div>'
            '<figcaption>%s</figcaption></figure>' % (name, html.escape(alt), marks, html.escape(alt, quote=False)))


def index(d, mode):
    w = W[d.lang]
    attr = 'data-sec="index"' if mode == 'app' else 'id="index"'
    titles = {c['id']: c['title'] for c in d.chapters}
    ent = {}
    for c in d.chapters:
        if c['level'] >= 2:
            ent.setdefault(c['title'], set()).add(c['id'])
    for lab, sec in d.labels:
        ent.setdefault(lab, set()).add(sec)
    def key(s):
        return s.casefold().lstrip('「“"(（[⟳↶☆★⋯⌨✓')
    rows = []
    for k in sorted(ent, key=key):
        secs = sorted(ent[k], key=lambda i: [c['id'] for c in d.chapters].index(i))
        rows.append('<li>%s — %s</li>' % (html.escape(k, quote=False), ', '.join('<a href="#%s">%s</a>' % (s, html.escape(titles[s], quote=False)) for s in secs[:4])))
    return '<section class="m-ch m-index" %s><h2>%s</h2><ul class="m-idx">%s</ul></section>' % (attr, w['index'], ''.join(rows))


# ------------------------------------------------------------------ the web page
CSS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manual.css'), encoding='utf-8').read() if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manual.css')) else ''
JS = r'''
(function () {
  var q = document.getElementById('m-q'), none = document.getElementById('m-none');
  var secs = Array.prototype.slice.call(document.querySelectorAll('.m-doc section.m-ch'));
  q.addEventListener('input', function () {
    var words = q.value.toLowerCase().split(/\s+/).filter(Boolean), any = false;
    secs.forEach(function (ch) {
      var subs = ch.querySelectorAll('section'), hitCh = false;
      Array.prototype.forEach.call(subs.length ? subs : [ch], function (s) {
        var hit = !words.length || words.every(function (w) { return s.textContent.toLowerCase().indexOf(w) >= 0; });
        s.hidden = !hit; hitCh = hitCh || hit;
      });
      ch.hidden = !hitCh; any = any || hitCh;
    });
    document.querySelector('.m-doc .m-toc').hidden = words.length > 0;
    none.hidden = any;
  });
})();
'''


def web_page(d, body):
    w = W[d.lang]
    langs = ' · '.join(('<b>%s</b>' % NAMES[l]) if l == d.lang else '<a href="../%s/" hreflang="%s" lang="%s">%s</a>' % (l, l, l, NAMES[l]) for l in LANGS)
    pdf = 'QCalc-manual-%s.pdf' % d.lang
    return '''<!doctype html>
<html lang="%(lang)s">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>%(title)s</title>
<style>%(css)s</style>
</head>
<body class="m-web">
<header class="m-cover">
  <img src="../../icon-512.png" alt="" width="64" height="64">
  <div><h1>%(title)s</h1><p class="m-subt">%(sub)s</p><p class="m-ver">%(vlabel)s %(version)s · %(date)s</p></div>
</header>
<div class="m-bar">
  <p class="m-dl"><a href="%(pdf)s" download>%(pdflabel)s</a> <span class="m-dl-n">(A4)</span></p>
  <p class="m-langs" aria-label="%(langlabel)s">%(langs)s</p>
  <input id="m-q" type="search" class="manual-search" placeholder="%(search)s" aria-label="%(search)s">
  <p id="m-none" class="m-none" hidden>%(none)s</p>
</div>
<main class="m-doc">
%(body)s
</main>
<p class="m-foot"><a href="#">%(top)s</a></p>
<script>%(js)s</script>
</body>
</html>
''' % dict(lang=d.lang, title=html.escape(d.title), sub=html.escape(d.sub), css=CSS, vlabel=w['version'], version=VERSION, date=DATE,
           pdf=pdf, pdflabel=w['pdf'], langlabel=w['lang'], langs=langs, search=w['search'], none=w['none'], body=body, top=w['top'], js=JS)


def chooser():
    links = '\n'.join('<li><a href="%s/" hreflang="%s" lang="%s">%s</a></li>' % (l, l, l, NAMES[l]) for l in LANGS)
    return '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>QCalc user manual</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:32px 16px;line-height:1.7;background:Canvas;color:CanvasText}a{font-size:1.15em}li{margin:.4em 0}</style>
<script>
(function () {
  var have = %s, l = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  l = /^zh-(TW|HK|MO|Hant)/i.test(l) ? 'zh-TW' : l.split('-')[0];
  if (!/[?&]stay/.test(location.search) && have.indexOf(l) >= 0) location.replace(l + '/' + location.hash);
})();
</script>
</head>
<body>
<h1>QCalc user manual</h1>
<ul>
%s
</ul>
</body>
</html>
''' % (json.dumps(LANGS), links)


def app_file(d, body):
    data = {'v': VERSION, 'lang': d.lang, 'title': d.title, 'html': body}
    return ('// The user manual of QCalc in %s, made by manual/build.py from manual/src/%s.txt (do not edit).\n'
            'window.QCALC_MANUAL = window.QCALC_MANUAL || {};\nwindow.QCALC_MANUAL[%s] = %s;\n'
            % (NAMES[d.lang], d.lang, json.dumps(d.lang), json.dumps(data, ensure_ascii=False, separators=(',', ':'))))


# ------------------------------------------------------------------ checks
WARN = []


def norm(t):
    """a text of the app without its marks: ' ▾', ' ›', '…', a colon at the end, '☆ ' or '↶ ' in front"""
    t = re.sub(r'\s*[▾›…]+\s*$', '', t.strip())
    t = re.sub(r'[：:]\s*$', '', t)
    return re.sub(r'^[☆★↶⟳]\s*', '', t).strip()


def check(docs, texts):
    errs = []
    need = app_ids()
    ref = None
    for d in docs:
        ids = [c['id'] for c in d.chapters]
        dup = sorted(set(i for i in ids if ids.count(i) > 1))
        if dup:
            errs.append('%s: ids twice: %s' % (d.lang, dup))
        have = set(ids) | {'index'}
        miss = sorted(i for i in need if i not in have)
        if miss:
            errs.append('%s: ids the app links to are missing: %s' % (d.lang, miss))
        bad = sorted(set(t for t, s in d.links if t not in have))
        if bad:
            errs.append('%s: links to no section: %s' % (d.lang, bad))
        if ref is None:
            ref = ids
        elif ids != ref:
            errs.append('%s: the ids differ from %s: %s / %s' % (d.lang, docs[0].lang, sorted(set(ids) ^ set(ref)), 'order' if set(ids) == set(ref) else ''))
        T = texts[d.lang]
        N = {norm(t) for t in T}
        for lab, sec in sorted(set(d.labels)):
            l2 = lab.strip()
            if l2 in T or norm(l2) in N:
                continue
            if any(len(l2) >= 2 and l2 in t for t in T):
                WARN.append('%s §%s: [[%s]] is only a part of a text of the app' % (d.lang, sec, lab))
            else:
                errs.append('%s §%s: [[%s]] is not a text of the app' % (d.lang, sec, lab))
        errs.extend(d.errors)
    return errs


def main():
    only_check = '--check' in sys.argv
    langs = [l for l in LANGS if os.path.exists(os.path.join(SRC, l + '.txt'))]
    texts, maps = app_texts()
    docs = [parse(l) for l in langs]
    for d in docs:
        d.app_html = render(d, maps, 'app')
        d.labels, d.links = [], []
        d.web_html = render(d, maps, 'web')
    errs = check(docs, texts)
    for e in WARN:
        print('WARN ', e)
    for e in errs:
        print('ERROR', e)
    if only_check:
        sys.exit(1 if errs else 0)
    os.makedirs(os.path.join(ASSETS, 'manual'), exist_ok=True)
    total = 0
    for d in docs:
        p = os.path.join(ASSETS, 'manual', d.lang + '.js')
        open(p, 'w', encoding='utf-8').write(app_file(d, d.app_html))
        total += os.path.getsize(p)
        os.makedirs(os.path.join(DOCS, d.lang), exist_ok=True)
        open(os.path.join(DOCS, d.lang, 'index.html'), 'w', encoding='utf-8').write(web_page(d, d.web_html))
        print('%-6s %3d sections  app %7d bytes  web %7d bytes' % (d.lang, len(d.chapters), os.path.getsize(p), os.path.getsize(os.path.join(DOCS, d.lang, 'index.html'))))
    open(os.path.join(DOCS, 'index.html'), 'w', encoding='utf-8').write(chooser())
    print('inside the app, all languages: %d bytes (limit 1.5 MB)' % total)
    if total > 1500000:
        print('ERROR the manuals inside the app are larger than 1.5 MB'); errs.append('size')
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
