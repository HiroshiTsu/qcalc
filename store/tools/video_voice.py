#!/usr/bin/env python3
"""Adds a placeholder narration to the QCalc videos (stage M3), made by speech synthesis on the work
machine, at the times of the subtitles (store/tools/video-plan.json, the same cues as the SRT files):

    <work>/out-voice/<lang>/<video>.mp4    the video of <work>/out/<lang>/ with the narration (AAC)

The picture is not encoded again (-c:v copy). The voices are placeholders, to be replaced by the
owner's recording or a voice service before publishing if they are not good enough:
  ja      Open JTalk with the HTS voice nitech_jp_atr503_m001 (Ubuntu packages open-jtalk,
          open-jtalk-mecab-naist-jdic, hts-voice-nitech-jp-atr503-m001)
  en, de, es, fr   eSpeak NG with MBROLA voices us2, de6, es2, fr4 (packages espeak-ng, mbrola,
          mbrola-us2, mbrola-de6, mbrola-es2, mbrola-fr4)
  ko, zh-TW        eSpeak NG (ko, cmn)
A line that comes out longer than its subtitle is spoken faster (up to 1.35 times in Japanese, 1.5 in
the others).

With --engine gemini the narration is made by the Gemini API instead (store/tools/gemini_tts.py; the key
from GEMINI_API_KEY or GOOGLE_API_KEY): one request for all the videos of a language (split between
paragraphs when it would be longer than one request), each segment a paragraph with a pause between, the
answer cut at its pauses into the segments, and each segment put at the start of its narration (faster,
as above, when it is longer). --model gemini-3.8-flash-tts (the default) or gemini-3.8-flash-lite-tts (the
spare, with its own daily count); --voice (a prebuilt voice, Kore by default); --style (how to read, sent
as speech_metadata, never in the text). The answers are kept in <work>/voice-gemini/cache, so a video made
again uses no request. When the daily limit is reached, it says when it starts again (Japan time).
Usage: python3 store/tools/video_voice.py <work folder> [langs] [videos] [--engine local|gemini]
       [--model M] [--voice V] [--style S]
"""
import os
import re
import subprocess
import sys
import wave

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import video_plan  # noqa: E402

PLAN = video_plan.PLAN

def options(argv):
    """The positional arguments (work folder, langs, videos) and the --name value options."""
    pos, opt, i = [], {'engine': 'local', 'model': None, 'voice': None, 'style': None}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k, _, v = a[2:].partition('=')
            if k not in opt:
                raise SystemExit('unknown option --%s' % k)
            if not _:
                i += 1
                if i >= len(argv):
                    raise SystemExit('--%s needs a value' % k)
                v = argv[i]
            opt[k] = v
        else:
            pos.append(a)
        i += 1
    if opt['engine'] not in ('local', 'gemini'):
        raise SystemExit('--engine is local or gemini')
    return pos, opt


ARGS, OPT = options(sys.argv[1:])
WORK = ARGS[0] if len(ARGS) > 0 else '/tmp/qcalc-video'
LANGS = ARGS[1].split(',') if len(ARGS) > 1 else list(PLAN['langs'])
ONLY = ARGS[2].split(',') if len(ARGS) > 2 else None
JDIC = '/var/lib/mecab/dic/open-jtalk/naist-jdic'
HTS = '/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice'
ESPEAK = {'en': ('mb-us2', 150), 'de': ('mb-de6', 145), 'es': ('mb-es2', 150), 'fr': ('mb-fr4', 150), 'ko': ('ko', 165), 'zh-TW': ('cmn', 190)}
# how the narration is read aloud (the subtitles keep the written form)
SAY = {
    'ja': [('QCalc Pro', 'キューカルク・プロ'), ('QCalc', 'キューカルク'), ('⟳ 3D', 'スリーディー'), ('3D', 'スリーディー'), ('2D', 'ツーディー'), ('STL', 'エスティーエル'),
           ('60 mph to km/h', '60マイル毎時を、キロメートル毎時に'), ('km/h', 'キロメートル毎時'), ('mph', 'マイル毎時'), ('√', 'ルート'), ('π', 'パイ'),
           ('家賃 = 85000 円', '家賃イコール8万5千円'), ('20 万桁', '20万桁'), ('「', ''), ('」', ''), ('……', '、'), ('？', '')],
    'en': [('QCalc Pro', 'Q-Calc Pro'), ('QCalc', 'Q-Calc'), ('⟳ 3D', 'the 3D button'), ('60 mph to km/h', '60 miles per hour to kilometers per hour'),
           ('60 mph in km/h', '60 miles per hour in kilometers per hour'), ('rent = 1450 USD', 'rent equals 1450 dollars'), ('π', 'pi'), ('STL', 'S T L'), ('Tap ?', 'Tap the question mark')],
    'de': [('QCalc Pro', 'Kju-Kalk Pro'), ('QCalc', 'Kju-Kalk'), ('⟳ 3D', '3D'), ('100 km/h to mph', '100 Kilometer pro Stunde in Meilen pro Stunde'), ('100 km/h', '100 Kilometer pro Stunde'),
           ('mph', 'Meilen pro Stunde'), ('MwSt.', 'Mehrwertsteuer'), ('Miete = 980 EUR', 'Miete gleich 980 Euro'), ('π', 'Pi'), ('STL', 'S T L'), ('Das ?', 'Das Fragezeichen')],
    'es': [('QCalc Pro', 'Kiu-Calc Pro'), ('QCalc', 'Kiu-Calc'), ('⟳ 3D', '3D'), ('100 km/h to mph', '100 kilómetros por hora a millas por hora'), ('100 km/h', '100 kilómetros por hora'),
           ('mph', 'millas por hora'), ('alquiler = 950 EUR', 'alquiler igual a 950 euros'), ('π', 'pi'), ('STL', 'S T L'), ('Toca ?', 'Toca el signo de interrogación'), ('«', ''), ('»', '')],
    'fr': [('QCalc Pro', 'Ku-Calc Pro'), ('QCalc', 'Ku-Calc'), ('⟳ 3D', '3D'), ('100 km/h to mph', '100 kilomètres par heure en miles par heure'), ('100 km/h', '100 kilomètres par heure'),
           ('mph', 'miles par heure'), ('loyer = 850 EUR', 'loyer égale 850 euros'), ('π', 'pi'), ('STL', 'S T L'), ('Touchez ?', 'Touchez le point d’interrogation'), ('« ', ''), (' »', '')],
    'ko': [('QCalc Pro', '큐캘크 프로'), ('QCalc', '큐캘크'), ('⟳ 3D', '3D'), ('100 km/h to mph', '시속 100킬로미터를 마일로'), ('100 km/h', '시속 100킬로미터'), ('mph', '마일'),
           ("'월세 = 650000 KRW'", '월세 65만 원'), ('π', '파이'), ('STL', '에스티엘'), ('?에서', '물음표에서'), ('?를', '물음표를')],
    'zh-TW': [('QCalc Pro', 'Q Calc Pro'), ('⟳ 3D', '3D'), ('「100 km/h to mph」', '每小時100公里換成英里'), ('100 km/h', '每小時100公里'), ('mph', '英里'),
              ('「房租 = 18000 TWD」', '房租等於一萬八千元'), ('π', '派'), ('STL', 'S T L'), ('「？」', '問號'), ('「', ''), ('」', '')],
}


def spoken(lang, text):
    for a, b in SAY.get(lang, []):
        text = text.replace(a, b)
    return re.sub(r'\s+', ' ', text).strip()


def wav_dur(path):
    with wave.open(path) as w:
        return w.getnframes() / float(w.getframerate())


def synth(lang, text, out, speed):
    if lang == 'ja':
        src = out + '.txt'
        open(src, 'w', encoding='utf-8').write(text)
        subprocess.run(['open_jtalk', '-x', JDIC, '-m', HTS, '-r', '%.2f' % speed, '-ow', out, src], check=True, capture_output=True)
    else:
        v, rate = ESPEAK[lang]
        subprocess.run(['espeak-ng', '-v', v, '-s', str(int(rate * speed)), '-w', out, text], check=True, capture_output=True)
    return wav_dur(out)


def voice(lang, name, segs):
    src = os.path.join(WORK, 'out', lang, name + '.mp4')
    if not os.path.exists(src):
        return
    d = os.path.join(WORK, 'voice', lang, name)
    os.makedirs(d, exist_ok=True)
    cues = video_plan.cues(lang, segs)
    parts = []
    for i, (a, b, line) in enumerate(cues):
        slot = (cues[i + 1][0] if i + 1 < len(cues) else b + 0.4) - a - 0.05
        text = spoken(lang, line)
        w = os.path.join(d, '%02d.wav' % i)
        speed = 1.0
        dur = synth(lang, text, w, speed)
        top = 1.35 if lang == 'ja' else 1.5
        while dur > slot and speed < top:
            speed = min(top, speed * dur / slot + 0.02)
            dur = synth(lang, text, w, speed)
        parts.append((a, w, dur, slot))
    total = sum(float(s['dur']) for s in segs)
    ins, fl = [], []
    for k, (a, w, dur, slot) in enumerate(parts):
        ins += ['-i', w]
        fl.append('[%d:a]aresample=48000,aformat=channel_layouts=mono,adelay=%d:all=1[a%d]' % (k, int(a * 1000), k))
    mix = ';'.join(fl) + ';' + ''.join('[a%d]' % k for k in range(len(parts))) + 'amix=inputs=%d:normalize=0:dropout_transition=0,apad,atrim=duration=%.3f,volume=1.3[out]' % (len(parts), total)
    track = os.path.join(d, 'voice.wav')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', mix, '-map', '[out]', track], check=True)
    mux(lang, name, src, track)
    long_ = sum(1 for p in parts if p[2] > p[3])
    print('%s %s: %d lines, %d still longer than the subtitle' % (lang, name, len(parts), long_))


def mux(lang, name, src, track):
    od = os.path.join(WORK, 'out-voice', lang)
    os.makedirs(od, exist_ok=True)
    out, tmp = os.path.join(od, name + '.mp4'), os.path.join(od, name + '.part.mp4')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-i', track, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                    '-shortest', '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, out)


# ---- the Gemini API (--engine gemini)

def gemini_text(lang, lines):
    """The paragraph of a segment as it is to be read: the lines of the subtitles, without the symbol of the
    3D button; nothing else is added (the text is read word for word)."""
    sep = '' if lang in ('ja', 'zh-TW') else ' '
    return sep.join(l.replace('⟳ ', '').strip() for l in lines).strip()


def segments_of(lang, vids):
    """Every segment with narration of the videos made so far: (video, start of its narration, its room, text)."""
    out = []
    for name, segs in vids:
        if not os.path.exists(os.path.join(WORK, 'out', lang, name + '.mp4')):
            continue
        t0 = 0.0
        for s in segs:
            d = float(s['dur'])
            if s['lines']:
                out.append((name, t0 + 0.15, d - 0.3, gemini_text(lang, s['lines'])))
            t0 += d
    return out


def gemini_voices(lang, vids, opt, tts=None, cut=None):
    """The narration of every video of a language by the Gemini API; returns the videos made."""
    import gemini_tts as G
    tts = tts or G.synthesize
    model = G.check_model(opt.get('model') or G.DEFAULT_MODEL)
    voice_name, style = opt.get('voice') or G.DEFAULT_VOICE, opt.get('style') or G.DEFAULT_STYLE
    items = segments_of(lang, vids)
    if not items:
        return []
    base = os.path.join(WORK, 'voice-gemini')
    rate = G.Rate(os.path.join(base, 'rate.json'))
    texts = [it[3] for it in items]
    groups = G.split_paragraphs(texts, extra=G.estimate_tokens(style))
    pieces = [None] * len(items)
    for gi, idx in enumerate(groups):
        text = G.transcript([texts[i] for i in idx])
        print('%s: request %d of %d (%d paragraphs, about %d tokens, %s)' % (lang, gi + 1, len(groups), len(idx), G.estimate_tokens(text), model))
        wav = tts(text, model=model, voice=voice_name, style=style, rate=rate, cache_dir=os.path.join(base, 'cache'))
        samples, sr = G.read_pcm(wav)
        got = (cut or G.cut_at_pauses)(samples, sr, len(idx))
        if got is None:
            raise G.TtsError('%s: the answer could not be cut into its %d paragraphs at the pauses.' % (lang, len(idx)))
        for i, p in zip(idx, got):
            pieces[i] = (p, sr)
    made = []
    for name, segs in vids:
        mine = [(k, it) for k, it in enumerate(items) if it[0] == name]
        if not mine:
            continue
        d = os.path.join(base, lang, name)
        os.makedirs(d, exist_ok=True)
        ins, fl, long_ = [], [], 0
        for j, (k, (_, start, room, _t)) in enumerate(mine):
            w = os.path.join(d, '%02d.wav' % j)
            p, sr = pieces[k]
            G.write_wav(w, p, sr)
            dur = len(p) / float(sr)
            top = 1.35 if lang == 'ja' else 1.5
            speed = min(top, dur / room) if dur > room else 1.0
            if dur / speed > room + 0.05:
                long_ += 1
            tempo = ',atempo=%.4f' % speed if speed > 1.0 else ''
            ins += ['-i', w]
            fl.append('[%d:a]aresample=48000,aformat=channel_layouts=mono%s,adelay=%d:all=1[a%d]' % (j, tempo, int(start * 1000), j))
        total = sum(float(s['dur']) for s in segs)
        mix = ';'.join(fl) + ';' + ''.join('[a%d]' % j for j in range(len(mine))) + 'amix=inputs=%d:normalize=0:dropout_transition=0,apad,atrim=duration=%.3f,volume=1.3[out]' % (len(mine), total)
        track = os.path.join(d, 'voice.wav')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', mix, '-map', '[out]', track], check=True)
        mux(lang, name, os.path.join(WORK, 'out', lang, name + '.mp4'), track)
        print('%s %s: %d paragraphs (Gemini %s, %s), %d still longer than the segment' % (lang, name, len(mine), model, voice_name, long_))
        made.append(name)
    return made


def main():
    for lang in LANGS:
        L = PLAN['langs'][lang]
        vids = [('promo', L['promo']), ('youtube', L['youtube'])] + [(s['name'], s['segments']) for s in L['shorts']]
        vids = [(n, s) for n, s in vids if not ONLY or n in ONLY]
        if OPT['engine'] == 'gemini':
            import gemini_tts as G
            try:
                gemini_voices(lang, vids, OPT)
            except G.DailyLimit as e:
                print(str(e))
                return 2
            except G.TtsError as e:
                print('%s: %s' % (lang, e))
                return 1
            continue
        for name, segs in vids:
            voice(lang, name, segs)
    return 0


if __name__ == '__main__':
    sys.exit(main())
