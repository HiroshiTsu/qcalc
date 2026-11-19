#!/usr/bin/env python3
"""Checks the Google Play store listings of QCalc and writes the files to paste or import.

Reads the blocks of store/listing-<lang>.md:

    <!-- listing: ja-JP -->
    ### (app name)
    ...
    ### (short description)
    ...
    ### (full description)
    ...
    <!-- /listing -->

and the texts on the screenshots, the feature graphics and the videos (store/tools/captions.json,
store/video/<lang>/*.srt), and checks:
  - the lengths (app name 30, short description 80, full description 4000 characters);
  - the words that Google Play and the Japanese law on misleading representations do not allow
    (rank, performance, price or promotion words) in the app name, the short description and on
    the pictures; and, everywhere, superlatives without a basis and the names of other apps or makers;
  - no price of QCalc Pro, no private address, the contact address present;
and writes store/play-import/<locale>/{title,short_description,full_description}.txt (the folder
layout of fastlane "supply", one folder per Play language code).

Usage: python3 store/tools/listing_check.py [--write]
Exit status 1 when a check fails. Python standard library only.
"""
import json
import os
import re
import sys

STORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMITS = {'title': 30, 'short': 80, 'full': 4000}

# words not allowed in the app name, the short description, and on the pictures and videos
# (Google Play metadata policy; 20:45 instruction). Lower case; matched as words for Latin scripts.
STRICT = {
    'ja': ['最高', 'no.1', 'no1', 'ナンバーワン', '1位', '一位', 'ベスト', '人気', '無料', '広告なし', '広告ゼロ', 'セール', '今すぐ', 'ダウンロード',
           'お得', '最強', '最速', '最安', '一番', '史上', 'ランキング', '大人気', '話題', 'おすすめ', '激安', '割引中', 'キャンペーン', '限定'],
    'en': ['best', 'top', '#1', 'no. 1', 'no.1', 'number one', 'popular', 'free', 'no ads', 'ad-free', 'ads-free', 'ad free', 'sale', 'discount',
           'download now', 'install now', 'get it now', 'app of the year', "editor's choice", 'cheapest', 'fastest', 'most powerful', 'ultimate', 'deal'],
    'de': ['beste', 'bester', 'bestes', 'top', 'nr. 1', 'nummer 1', 'beliebt', 'beliebte', 'beliebten', 'beliebteste', 'kostenlos', 'kostenlose', 'kostenloser', 'kostenloses', 'kostenlosen', 'besten', 'gratis', 'werbefrei', 'ohne werbung', 'angebot',
           'rabatt', 'sale', 'jetzt herunterladen', 'jetzt laden', 'schnellste', 'ultimativ'],
    'es': ['mejor', 'mejores', 'top', 'n.º 1', 'nº 1', 'número 1', 'popular', 'populares', 'gratis', 'gratuita', 'gratuito', 'gratuitas', 'gratuitos', 'sin anuncios', 'sin publicidad', 'oferta', 'rebaja',
           'descuento', 'descarga ya', 'descárgala', 'descárgalo', 'más rápida', 'definitiva'],
    'fr': ['meilleur', 'meilleure', 'meilleurs', 'meilleures', 'top', 'n° 1', 'nº 1', 'numéro 1', 'populaire', 'populaires', 'gratuit', 'gratuite', 'gratuits', 'gratuites', 'sans pub', 'sans publicité', 'promo', 'solde',
           'réduction', 'téléchargez maintenant', 'la plus rapide', 'ultime'],
    'ko': ['최고', '1위', '넘버원', '베스트', '인기', '무료', '광고 없는', '광고없는', '광고 없음', '세일', '할인', '지금 다운로드', '최강', '최저가'],
    'zh': ['最佳', '最好', '第一', '第1', '排名', '熱門', '人氣', '免費', '無廣告', '特價', '折扣', '優惠', '立即下載', '馬上下載', '最強', '最快', '限時'],
}
# not allowed anywhere (also in the full description): superlatives without a basis
ANYWHERE = {
    'ja': ['最高', 'no.1', 'ナンバーワン', '1位', 'ベスト', '最強', '最速', '一番', '史上', '世界初', '業界初', '唯一', '大人気', '今すぐダウンロード', 'セール'],
    'en': ['best', '#1', 'number one', 'most popular', 'fastest', 'most powerful', 'ultimate', "world's first", 'the only', 'download now'],
    'de': ['beste', 'bester', 'nr. 1', 'beliebteste', 'schnellste', 'ultimativ', 'einzige', 'jetzt herunterladen'],
    'es': ['la mejor', 'el mejor', 'n.º 1', 'número 1', 'más popular', 'más rápida', 'definitiva', 'la única', 'descarga ya'],
    'fr': ['la meilleure', 'le meilleur', 'n° 1', 'numéro 1', 'la plus populaire', 'la plus rapide', 'ultime', 'la seule', 'téléchargez maintenant'],
    'ko': ['최고', '1위', '넘버원', '최강', '유일', '지금 다운로드'],
    'zh': ['最佳', '第一', '最強', '唯一', '最快', '立即下載'],
}
# other apps and makers (comparisons that name them are not allowed)
OTHERS = ['realcalc', 'hiper', 'panecal', 'desmos', 'geogebra', 'photomath', 'symbolab', 'mathway', 'wolfram', 'techcalc', 'clevcalc', 'ncalc',
          'casio', 'カシオ', 'texas instruments', 'ti-84', 'ti-nspire', 'sharp', 'シャープ', 'numworks', 'myscript', 'mathlab', '매스렙', 'calculator++',
          'one calculator', 'uno calculator', 'microsoft', 'apple', 'samsung', '万能電卓', '萬能計算器', 'calcpro', 'panecalst']
PRIVATE = ['tsukayamahiroshi', 'tsukayamahiroshidev']
CONTACT = 'hiroshitsu.apps@gmail.com'
PRICE = [r'[¥￥]\s?\d', r'\b600\s?円', r'\$\s?\d+\.\d\d\b.*pro', r'qcalc pro.{0,40}(¥|\$|€|₩|nt\$)\s?\d']


def family(locale):
    l = locale.lower()
    if l.startswith('zh'):
        return 'zh'
    return l.split('-')[0]


def find_words(text, words, latin):
    t = text.lower()
    hits = []
    for w in words:
        if latin and re.match(r'^[a-zà-ÿ0-9#.\' º°-]+$', w):
            if re.search(r'(?<![a-zà-ÿ0-9])' + re.escape(w) + r'(?![a-zà-ÿ0-9])', t):
                hits.append(w)
        elif w in t:
            hits.append(w)
    return hits


def check_text(where, locale, text, strict, problems):
    fam = family(locale)
    latin = fam in ('en', 'de', 'es', 'fr')
    if strict:
        for w in find_words(text, STRICT.get(fam, []), latin):
            problems.append('%s: "%s" is not allowed here' % (where, w))
    for w in find_words(text, ANYWHERE.get(fam, []), latin):
        if not strict or w not in STRICT.get(fam, []):
            problems.append('%s: "%s" (a superlative or call to action)' % (where, w))
    for w in find_words(text, OTHERS, True):
        problems.append('%s: names another app or maker ("%s")' % (where, w))
    for p in PRIVATE:
        if p in text.lower():
            problems.append('%s: a private address' % where)
    for p in PRICE:
        if re.search(p, text, re.I):
            problems.append('%s: looks like a price (%s)' % (where, p))


def read_listings():
    out = []
    for name in sorted(os.listdir(STORE)):
        m = re.match(r'listing-(.+)\.md$', name)
        if not m:
            continue
        src = open(os.path.join(STORE, name), encoding='utf-8').read()
        for b in re.finditer(r'<!-- listing: (\S+) -->(.*?)<!-- /listing -->', src, re.S):
            parts = re.split(r'^### .*$', b.group(2), flags=re.M)[1:]
            if len(parts) != 3:
                raise SystemExit('%s %s: expected 3 parts (### app name, short, full), found %d' % (name, b.group(1), len(parts)))
            title, short, full = (p.strip() for p in parts)
            out.append({'file': name, 'locale': b.group(1), 'title': title, 'short': short, 'full': full})
    return out


def main():
    write = '--write' in sys.argv
    problems = []
    rows = []
    listings = read_listings()
    seen = set()
    for L in listings:
        loc = L['locale']
        if loc in seen:
            problems.append('%s: the locale %s twice' % (L['file'], loc))
        seen.add(loc)
        for k in ('title', 'short', 'full'):
            n = len(L[k])
            if n > LIMITS[k]:
                problems.append('%s %s: %s has %d characters (limit %d)' % (L['file'], loc, k, n, LIMITS[k]))
            if '\n' in L[k] and k != 'full':
                problems.append('%s %s: %s has a line break' % (L['file'], loc, k))
            check_text('%s %s %s' % (L['file'], loc, k), loc, L[k], k != 'full', problems)
        if CONTACT not in L['full']:
            problems.append('%s %s: the contact address is missing' % (L['file'], loc))
        if L['short'] in L['full']:
            problems.append('%s %s: the short description is repeated in the full description' % (L['file'], loc))
        first = L['full'].split('\n\n')[0]
        rows.append((loc, len(L['title']), len(L['short']), len(L['full']), len(first)))
        if write:
            d = os.path.join(STORE, 'play-import', loc)
            os.makedirs(d, exist_ok=True)
            for k, fn in (('title', 'title.txt'), ('short', 'short_description.txt'), ('full', 'full_description.txt')):
                with open(os.path.join(d, fn), 'w', encoding='utf-8') as f:
                    f.write(L[k] + '\n')
    # the texts on the pictures (captions.json) and in the videos (*.srt)
    cap = os.path.join(STORE, 'tools', 'captions.json')
    if os.path.exists(cap):
        C = json.load(open(cap, encoding='utf-8'))
        for lang, items in C.items():
            if lang.startswith('_'):
                continue
            for key, text in items.items():
                if isinstance(text, list):
                    text = ' '.join(text)
                check_text('captions %s %s' % (lang, key), lang, text, True, problems)
    vroot = os.path.join(STORE, 'video')
    if os.path.isdir(vroot):
        for lang in sorted(os.listdir(vroot)):
            d = os.path.join(vroot, lang)
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                if fn.endswith('.srt'):
                    txt = open(os.path.join(d, fn), encoding='utf-8').read()
                    lines = [l for l in txt.splitlines() if l.strip() and not re.match(r'^\d+$|^\d\d:\d\d', l)]
                    check_text('video %s %s' % (lang, fn), lang, '\n'.join(lines), True, problems)
    print('%-7s %5s %5s %5s %6s' % ('locale', 'name', 'short', 'full', 'first'))
    for r in rows:
        print('%-7s %5d %5d %5d %6d' % r)
    for p in problems:
        print('PROBLEM ' + p)
    print('%d listings, %d problems' % (len(rows), len(problems)))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
