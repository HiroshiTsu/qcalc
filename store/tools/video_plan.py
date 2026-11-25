#!/usr/bin/env python3
"""Writes the texts of the QCalc videos from store/tools/video-plan.json (stage M3):

    store/video/<lang>/script.md       the narration, with the time of each line, for every video
    store/video/<lang>/storyboard.md   what is on the screen, second by second
    store/video/<lang>/promo.srt       subtitles of the Google Play promo (16:9)
    store/video/<lang>/youtube.srt     subtitles of the YouTube video (16:9)
    store/video/<lang>/short-*.srt     subtitles of the shorts (9:16)
    store/video/<lang>/youtube.md      title, description with chapters, tags, thumbnail of the YouTube video

and checks that each narration fits its segment at the pace of the language. The same timing is used
by store/tools/video_render.py to burn the subtitles into the videos.
Usage: python3 store/tools/video_plan.py      (Python standard library only)
"""
import json
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.dirname(TOOLS)
PLAN = json.load(open(os.path.join(TOOLS, 'video-plan.json'), encoding='utf-8'))
VER = PLAN.get('version', '1.12.0')  # (1.16: the texts go to store/video-1.16/, PLAN['out'])
OUT = PLAN.get('out', 'video')
MANUAL = 'https://hiroshitsu.github.io/qcalc/manual/'
SOURCE = 'https://github.com/HiroshiTsu/qcalc'
CONTACT = 'hiroshitsu.apps@gmail.com'

L10N = {
    'ja': {'promo': 'Google Play の宣伝動画（16:9、約 {d} 秒）', 'youtube': 'YouTube の紹介動画（16:9、{m}）', 'short': 'ショート動画 {n}（9:16、{d} 秒）',
           'time': '時刻', 'screen': '画面', 'text': '画面の見出し', 'say': 'ナレーション（字幕）', 'chapters': 'チャプター',
           'manual': '取扱説明書', 'source': 'ソースコード', 'contact': '不具合・要望', 'note': 'ナレーションは字幕と同じ文です。音声は仮の音声合成（本人の許可が要る）か本人の録音で付けます。',
           'pro': 'QCalc Pro の機能です'},
    'en': {'promo': 'Google Play promo video (16:9, about {d} s)', 'youtube': 'YouTube video (16:9, {m})', 'short': 'Short {n} (9:16, {d} s)',
           'time': 'Time', 'screen': 'Screen', 'text': 'Headline on screen', 'say': 'Narration (subtitle)', 'chapters': 'Chapters',
           'manual': 'User manual', 'source': 'Source code', 'contact': 'Bugs and ideas', 'note': 'The narration is the same as the subtitles. The voice is added later (text to speech, which needs the owner\'s permission, or the owner\'s recording).',
           'pro': 'QCalc Pro feature'},
}
SCENE_JA = {
    'rev': '2D グラフ（y = x と y = x²）で「描画」→「⟳ 3D」（すぐ 3D になり、立体が 0° から 360° まで伸びて、体積 V がグラフの上に大きく出る。QCalc Pro。1.12.0、BG20）→ 指で回す',
    'rev3d': '面を回した 2D グラフ（「⟳ 3D」→「← 2D に戻る」）で「3D で見る」（立体が 0° から 360° まで伸び、指で回す。QCalc Pro）',
    'type': '計算画面：60 mph to km/h（ja・en。ほかは 100 km/h to mph）、solve(x^2 − 5x + 6 = 0)、integrate(x^2 sin(x), 0, pi) を 1 文字ずつ打ち、そのたびに「=」',
    'exact': '計算画面：sqrt(8)、1/3 + 1/4、solve(x^2 = 2)。厳密な答え',
    'price': '道具 →「値段：割引と税」→ 最初の例',
    'loan': '道具 →「ローン」→ 最初の例 → 下の返済表まで',
    'convert': '道具 →「単位・通貨の換算」→ 5 を打つ（km → mi）→ 種類のボタン',
    'axis': '回転体を出した 2D グラフ（「⟳ 3D」→「← 2D に戻る」）で、y 軸をタップ（軸が変わる）→「方法を線で見せる」',
    'profile': '道具 →「輪郭から回転体」（QCalc Pro）→ 最初の例 →「3D で見る」',
    'tank': '道具 →「容器の液量」→ 横置きの円筒 直径 1 m・長さ 2 m・液面 0.3 m → 結果',
    'tank3d': '道具 →「容器の液量」→ 横置きの円筒・鏡板 半楕円 2:1、直径 1.2 m・長さ 2.4 m・液 30 %、L →「⟳ 3D」（タンクが伸び、液体が上がる。液面のそばに量と %、壁に量の目盛り）→ 指で液面を上へドラッグ（量が変わる）→ 指で回す（QCalc Pro。1.12.0、D6）',
    'notes': '道具 →「計算メモ」→ 最初の例（名前と合計）',
    'manual': '道具 →「値段」→「？」→ 取扱説明書のその節（アプリの中、ネットなし）',
    'end': '終わりのカード：アイコン、QCalc、その言語の 1 行（アプリの画面ではない）',
    # (1.16)
    'histtype': '計算画面：1280 × 3、980 × 2 を打ち、そのたびに「=」。履歴の行に #1・#2 の番号',
    'histsel': '同じ履歴：#1 の番号をタップ →「+」→ #2 の番号をタップ →「=」（#1 + #2）。履歴のボタン →「行を選んで合計・平均・コピー」→ 1 行目と 2 行目：合計・平均のバー →「表でコピー」',
    'hist': '計算画面：1280 × 3、980 × 2、行の番号のタップで #1 + #2。「行を選んで合計…」→ 2 行：合計・平均 →「表でコピー」',
    'margin': '道具 →「信用取引：維持率と追証」→ 最初の例 → 結果（維持率、追証の株価。QCalc Pro）',
    'possize': '道具 →「損切りから株数」→ 最初の例 → 結果（株数、損切りの損失、損益比。QCalc Pro）',
    'avgcost': '道具 →「平均取得単価」→ 最初の例 → 結果（平均取得単価、目標の平均にする株数。QCalc Pro）',
    'notestable': '道具 →「計算メモ」→「表」（QCalc Pro）→ 例（品目・数量・単価、列「金額 = 数量 × 単価」）：数量を変えると金額と合計が変わる →「詳しく」→「CSV で保存」',
    'notespaste': '道具 →「計算メモ」→ 新しいメモ →「表」（QCalc Pro）：表計算ソフトの表を最初のセルに貼る → セルに分かれ、1 行目が列の名前、合計と平均',
    'pastesum': '計算画面：表計算ソフトの列（1200、850、−300）を入力欄に貼る → シート →「＋でつないで合計」→ 1200 + 850 + (−300) = 1750',
    # (1.16.3, short-6-view and the promo's segment of 4 s)
    'wholeview': '計算画面：1280 × 3 と長い式（2,500,000 を年 1.5 %・120 か月で借りたときの毎月の返済額）が 2 行に。番号の下の ⤢ をタップ →「全体を見る」：2 本指で大きく →「式を直す」：120 を 180 に、答えがすぐ下に →「決定」：その行がその場で計算し直される',
    'wrapzoom': '計算画面（3 行、最後は 1 か月の支出の合計で長い）：履歴を 2 本指で広げる（履歴の文字 150%）→ 設定 →「折り返し」：80 文字で折り返す → 戻る：長い行が 1 行になり、指で横に動かす',
}


def units(lang, text):
    pace, kind = PLAN['pace'][lang]
    n = len(text.replace(' ', '')) if kind == 'chars' else len(text.split())
    return n, n / pace


def cues(lang, segs):
    """The subtitle cues: (start, end, text) for every line, spread over its segment by length."""
    out, t0 = [], 0.0
    for s in segs:
        d = float(s['dur'])
        lines = s['lines']
        w = [max(1, units(lang, l)[0]) for l in lines]
        tot = sum(w)
        t = t0 + 0.15
        span = d - 0.3
        for l, wi in zip(lines, w):
            dd = span * wi / tot
            out.append((t, t + dd - 0.12, l))
            t += dd
        t0 += d
    return out


def ts(t):
    ms = int(round(t * 1000))
    return '%02d:%02d:%02d,%03d' % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def mmss(t):
    t = int(round(t))
    return '%d:%02d' % (t // 60, t % 60)


def write_srt(path, cs):
    with open(path, 'w', encoding='utf-8') as f:
        for i, (a, b, l) in enumerate(cs, 1):
            f.write('%d\n%s --> %s\n%s\n\n' % (i, ts(a), ts(b), l))


def videos(lang):
    L = PLAN['langs'][lang]
    v = [('promo', 'promo', L['promo'])]
    if L.get('youtube'):
        v.append(('youtube', 'youtube', L['youtube']))
    for i, sh in enumerate(L['shorts'], 1):
        v.append((sh['name'], 'short', sh['segments']))
    return v


def main():
    problems = []
    for lang, L in PLAN['langs'].items():
        T = L10N['ja'] if lang == 'ja' else L10N['en']
        d = os.path.join(STORE, OUT, lang)
        os.makedirs(d, exist_ok=True)
        script, board = [], []
        title = 'QCalc ' + VER + ' — ' + ('動画の台本' if lang == 'ja' else 'video scripts') + ' (' + lang + ')'
        script += ['# ' + title, '', T['note'], '']
        board += ['# QCalc ' + VER + ' — ' + ('絵コンテ' if lang == 'ja' else 'storyboard') + ' (' + lang + ')', '',
                  ('画面はすべて実際のアプリ（作業環境の Chromium に出した app/assets と本物の計算エンジン）を録画したものです。終わりのカードだけがアプリの画面ではありません（どの動画もアプリの画面が 8 割以上）。'
                   if lang == 'ja' else 'Every screen is a recording of the real app (app/assets in Chromium with the real engine). Only the closing card is not the app (the app is more than 80 % of every video).'), '']
        n_short = 0
        for name, kind, segs in videos(lang):
            total = sum(float(s['dur']) for s in segs)
            if kind == 'promo':
                head = T['promo'].format(d=int(total))
            elif kind == 'youtube':
                head = T['youtube'].format(m=mmss(total))
            else:
                n_short += 1
                head = T['short'].format(n=n_short, d=int(total))
            cs = cues(lang, segs)
            write_srt(os.path.join(d, name + '.srt'), cs)
            # the script: the narration with times
            script += ['## ' + head + ' — ' + name + '.srt', '']
            t0 = 0.0
            ci = 0
            for s in segs:
                need = sum(units(lang, l)[1] for l in s['lines'])
                if need > float(s['dur']) - 0.3:
                    problems.append('%s %s %s: the narration needs %.1f s, the segment has %s s' % (lang, name, s['scene'], need, s['dur']))
                chap = (' 【' + s['chapter'] + '】') if s.get('chapter') else ''
                script.append('**%s–%s**%s' % (mmss(t0), mmss(t0 + float(s['dur'])), chap))
                for l in s['lines']:
                    a, b, _ = cs[ci]
                    ci += 1
                    script.append('- %s–%s %s' % (ts(a)[3:8], ts(b)[3:8], l))
                script.append('')
                t0 += float(s['dur'])
            # the storyboard: the screen, the headline and the label for every segment, second by second
            board += ['## ' + head, '', '| %s | %s | %s | %s |' % (T['time'], T['screen'], T['text'], T['say']), '|---|---|---|---|']
            t0 = 0.0
            for s in segs:
                screen = SCENE_JA[s['scene']] if lang == 'ja' else PLAN['scenes'][s['scene']]
                head_txt = ' / '.join(s['title']) if s['title'] else ' / '.join(L['end'])
                if s.get('tag'):
                    head_txt += '（' + s['tag'] + '）' if lang == 'ja' else ' (' + s['tag'] + ')'
                board.append('| %s–%s | %s | %s | %s |' % (mmss(t0), mmss(t0 + float(s['dur'])), screen, head_txt, ' '.join(s['lines'])))
                t0 += float(s['dur'])
            board.append('')
        open(os.path.join(d, 'script.md'), 'w', encoding='utf-8').write('\n'.join(script))
        open(os.path.join(d, 'storyboard.md'), 'w', encoding='utf-8').write('\n'.join(board))
        # youtube.md: title, description with the chapters, tags, thumbnail
        M = L['youtube_meta']
        chapters, t0 = [], 0.0
        for s in L.get('youtube') or []:
            if s.get('chapter'):
                chapters.append('%s %s' % (mmss(t0), s['chapter']))
            t0 += float(s['dur'])
        desc = [M['description'], ''] + ([T['chapters'] + ':' if lang != 'ja' else T['chapters'] + '：'] + chapters + [''] if chapters else []) + [
                T['manual'] + ('：' if lang == 'ja' else ': ') + MANUAL, T['source'] + ('：' if lang == 'ja' else ': ') + SOURCE,
                T['contact'] + ('：' if lang == 'ja' else ': ') + CONTACT]
        tags = ', '.join(M['tags'])
        if len(M['title']) > 100:
            problems.append('%s youtube title has %d characters (limit 100)' % (lang, len(M['title'])))
        if len(tags) > 500:
            problems.append('%s youtube tags have %d characters (limit 500)' % (lang, len(tags)))
        y = ['# YouTube — QCalc (' + lang + ')', '',
             ('YouTube の Studio で動画を上げるときに貼り付けます（本人が行います。設定は store/launch-plan-ja.md）。'
              if lang == 'ja' else 'Paste these in YouTube Studio when uploading (done by the owner; settings in store/launch-plan-ja.md).'), '',
             '## ' + ('題名' if lang == 'ja' else 'Title') + ' (%d / 100)' % len(M['title']), '', M['title'], '',
             '## ' + ('説明' if lang == 'ja' else 'Description'), '', '```', '\n'.join(desc), '```', '',
             '## ' + ('タグ' if lang == 'ja' else 'Tags') + ' (%d / 500)' % len(tags), '', tags, '',
             '## ' + ('サムネイル' if lang == 'ja' else 'Thumbnail'), '', 'thumbnail.png (1280 × 720): ' + ' / '.join(M['thumb']), '',
             '## ' + ('字幕' if lang == 'ja' else 'Subtitles'), '', ('youtube.srt' if L.get('youtube') else 'promo.srt') + ' (' + lang + ')', '']
        if not L.get('youtube'):
            # (1.16) the promo is the video on YouTube (its link goes into Google Play); the shorts, with a title each
            y[2] = ('Google Play の宣伝動画（promo.mp4）を YouTube に上げるときに貼り付けます（本人が行います）。ショート動画の題名は下にあります。'
                    if lang == 'ja' else 'Paste these in YouTube Studio when uploading the promo (promo.mp4; done by the owner). The titles of the shorts are below.')
            y += ['## ' + ('ショート動画' if lang == 'ja' else 'Shorts'), '']
            for sh in L['shorts']:
                st = ''.join(sh['segments'][0]['title']) if lang in ('ja', 'zh-TW') else ' '.join(sh['segments'][0]['title'])
                st = st + ' | QCalc #Shorts'
                if len(st) > 100:
                    problems.append('%s %s title has %d characters (limit 100)' % (lang, sh['name'], len(st)))
                y += ['- ' + sh['name'] + '.mp4（' + sh['name'] + '.srt）：' + st if lang == 'ja' else '- ' + sh['name'] + '.mp4 (' + sh['name'] + '.srt): ' + st]
            y.append('')
        open(os.path.join(d, 'youtube.md'), 'w', encoding='utf-8').write('\n'.join(y))
        print(lang, 'ok')
    for p in problems:
        print('PROBLEM ' + p)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
