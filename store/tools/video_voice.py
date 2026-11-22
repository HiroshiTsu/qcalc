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
The requests are always made of every paragraph of every video of the language (made or not), so they are the
same in every kind of run. After the cut, the seconds of each paragraph per character are compared: one under
half or over twice the median stops the run with the paragraph named (the answer is set aside, .rejected.wav,
and asked for again next time), so that no narration out of place is made.
  --sample [N]    the first N paragraphs (3) of each language in one request for each voice of --voice
                  (Kore,Achird,Sulafat), written to <work>/voice-gemini/sample/<lang>-<model>-<voice>.wav, to
                  compare the voices; no video and no ffmpeg needed
  --synth-only    the audio of every paragraph of the languages into <work>/voice-gemini/cache, without the
                  videos and without ffmpeg (Python only: Cloud Shell or any computer), then
                  <work>/voice-gemini-<date>.zip with the cache, the samples and a manifest; unpacked into the
                  work folder here, the usual run with --engine gemini puts it into the videos with no request
                  and no key (store/tools/TTS-GEMINI-ja.md)
With --engine chatterbox the audio made by store/tools/chatterbox_tts.py on the owner's computer (its zips unpacked
into <work>, so that <work>/voice-chatterbox/manifest.json is there) is put into the videos: each paragraph found by
video and segment, its text checked against the plan (a different text stops the run, naming the paragraphs), put at
its start and read faster when it is longer than its room, as above; a video with paragraphs missing is not made.
With --engine tts the same for the audio of store/tools/tts_engines.py (Qwen3-TTS for the videos, 11-22): its zips
unpacked into <work>, so that <work>/voice-tts/manifest.json is there (the same manifest as chatterbox_tts.py's).
With chatterbox and tts the subtitles follow the voice: in each paragraph the pauses of the WAV between its lines
(the nearest to where the lengths of the lines put them; a longer pause is preferred) give when each line is said,
and the cues are written to <work>/cues/<lang>/<video>.json and .srt (shown from just before the line is said until
the next; the last line of a segment 0.7 s after the voice, inside its segment). store/tools/video_render.py
--voice-cues burns those cues into the videos instead of the plan's. --cues-only writes the cues without the videos
(no ffmpeg needed).
Usage: python3 store/tools/video_voice.py <work folder> [langs] [videos] [--engine local|gemini|chatterbox|tts]
       [--model M] [--voice V] [--style S] [--sample [N] | --synth-only | --cues-only]
"""
import array
import datetime
import json
import math
import os
import re
import subprocess
import sys
import wave
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import video_plan  # noqa: E402

PLAN = video_plan.PLAN

def options(argv):
    """The positional arguments (work folder, langs, videos) and the options: --engine, --model, --voice (a
    list with commas for --sample), --style, --sample [N] (3 when N is left out), --synth-only."""
    pos, opt, i = [], {'engine': 'local', 'model': None, 'voice': None, 'style': None, 'sample': None, 'synth-only': False, 'cues-only': False}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k, eq, v = a[2:].partition('=')
            if k not in opt:
                raise SystemExit('unknown option --%s' % k)
            if k in ('synth-only', 'cues-only'):
                opt[k] = True
            elif k == 'sample' and not eq:
                if i + 1 < len(argv) and argv[i + 1].isdigit():
                    i += 1
                    v = argv[i]
                else:
                    v = '3'
                opt[k] = v
            else:
                if not eq:
                    i += 1
                    if i >= len(argv):
                        raise SystemExit('--%s needs a value' % k)
                    v = argv[i]
                opt[k] = v
        else:
            pos.append(a)
        i += 1
    if opt['engine'] not in ('local', 'gemini', 'chatterbox', 'tts'):
        raise SystemExit('--engine is local, gemini, chatterbox or tts')
    if opt['cues-only'] and opt['engine'] not in ('chatterbox', 'tts'):
        raise SystemExit('--cues-only is for --engine chatterbox or tts')
    if opt['sample'] is not None or opt['synth-only']:
        opt['engine'] = 'gemini'
    if opt['sample'] is not None:
        if not str(opt['sample']).isdigit() or int(opt['sample']) < 1:
            raise SystemExit('--sample takes a number of paragraphs (1 or more)')
        opt['sample'] = int(opt['sample'])
    if opt['sample'] is not None and opt['synth-only']:
        raise SystemExit('--sample and --synth-only are separate runs')
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


def wav_peak(path):
    """The largest sample of a 16-bit WAV, from 0 to 1 (1 for other kinds: no gain then)."""
    with wave.open(path) as w:
        if w.getsampwidth() != 2:
            return 1.0
        a = array.array('h', w.readframes(w.getnframes()))
    if sys.byteorder == 'big':
        a.byteswap()
    return max(max(a, default=0), -min(a, default=0)) / 32768.0


GAIN, HEADROOM = 1.3, 0.89  # the quiet voices a little louder; the loud ones kept near -1 dBFS (resampling adds a little)


def track_gain(files):
    """The gain of a narration track: 1.3 (the voices made here are quiet), less when the loudest sample would go
    above HEADROOM (the voices of Chatterbox are already near full scale: 1.3 clipped them)."""
    peak = max((wav_peak(w) for w in files), default=0.0)
    return min(GAIN, HEADROOM / peak) if peak > 0 else GAIN


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
    mix = ';'.join(fl) + ';' + mix_tail(len(parts), total, track_gain([p[1] for p in parts]))
    track = os.path.join(d, 'voice.wav')
    make_track(ins, mix, total, track)
    mux(lang, name, src, track)
    long_ = sum(1 for p in parts if p[2] > p[3])
    print('%s %s: %d lines, %d still longer than the subtitle' % (lang, name, len(parts), long_))


def mix_tail(n, total, gain=GAIN):
    """The end of the filter of a narration track: the n paragraphs mixed, then exactly total seconds. asetpts
    comes first because after atempo the timestamps no longer count the samples, and apad,atrim alone then never
    ended (a sped-up paragraph made the track grow until the disk was full)."""
    return ''.join('[a%d]' % k for k in range(n)) + 'amix=inputs=%d:normalize=0:dropout_transition=0,asetpts=N/SR/TB,apad=whole_dur=%.3f,atrim=duration=%.3f,volume=%.4f[out]' % (n, total, total, gain)


def make_track(ins, mix, total, track):
    # -t as well: whatever the filter does, the track is never longer than the video
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', mix, '-map', '[out]', '-t', '%.3f' % total, track], check=True)


def mux(lang, name, src, track):
    od = os.path.join(WORK, 'out-voice', lang)
    os.makedirs(od, exist_ok=True)
    out, tmp = os.path.join(od, name + '.mp4'), os.path.join(od, name + '.part.mp4')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-i', track, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                    '-shortest', '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, out)


# ---- the Gemini API (--engine gemini, --sample, --synth-only)

def gemini_text(lang, lines):
    """The paragraph of a segment as it is to be read: the lines of the subtitles, without the symbol of the
    3D button; nothing else is added (the text is read word for word)."""
    sep = '' if lang in ('ja', 'zh-TW') else ' '
    return sep.join(l.replace('⟳ ', '').strip() for l in lines).strip()


def all_videos(lang):
    L = PLAN['langs'][lang]
    return [('promo', L['promo']), ('youtube', L['youtube'])] + [(s['name'], s['segments']) for s in L['shorts']]


def paragraphs_seg(lang):
    """Every segment with narration of every video of the language, in the order of the plan: (video, number of
    the segment in its video, start of its narration, its room, text)."""
    out = []
    for name, segs in all_videos(lang):
        t0 = 0.0
        for k, s in enumerate(segs):
            d = float(s['dur'])
            if s['lines']:
                out.append((name, k, t0 + 0.15, d - 0.3, gemini_text(lang, s['lines'])))
            t0 += d
    return out


def paragraphs_of(lang):
    """Every segment with narration of every video of the language, in the order of the plan: (video, start of its
    narration, its room, text). Always all of them, made or not, so that a run with the videos and a run of
    --synth-only (without them) send the same requests and find the same answers in the cache."""
    return [(name, start, room, text) for name, _k, start, room, text in paragraphs_seg(lang)]


SPEED_TOP = {'ja': 1.35}  # how much faster a paragraph may be read to fit its room (the others: 1.5)


def place_and_mux(lang, name, segs, parts, d):
    """The narration track of a video from its paragraphs, parts = [(wav file, start, room)]: each at its start,
    faster (up to 1.35 times in Japanese, 1.5 in the others) when it is longer than its room, mixed (track_gain)
    and put into the video (out-voice/). Returns [(index, seconds, speed, still too long)] (the Gemini and Chatterbox runs)."""
    total = sum(float(s['dur']) for s in segs)
    ins, mix, info = track_filter(lang, parts, total)
    os.makedirs(d, exist_ok=True)
    track = os.path.join(d, 'voice.wav')
    make_track(ins, mix, total, track)
    mux(lang, name, os.path.join(WORK, 'out', lang, name + '.mp4'), track)
    return info


def track_filter(lang, parts, total):
    """The inputs and the filter of the track of place_and_mux, with [(index, seconds, speed, still too long)]."""
    top = SPEED_TOP.get(lang, 1.5)
    ins, fl, info = [], [], []
    for j, (w, start, room) in enumerate(parts):
        dur = wav_dur(w)
        speed = min(top, dur / room) if dur > room else 1.0
        info.append((j, dur, speed, dur / speed > room + 0.05))
        tempo = ',atempo=%.4f' % speed if speed > 1.0 else ''
        ins += ['-i', w]
        fl.append('[%d:a]aresample=48000,aformat=channel_layouts=mono%s,adelay=%d:all=1[a%d]' % (j, tempo, int(start * 1000), j))
    return ins, ';'.join(fl) + ';' + mix_tail(len(parts), total, track_gain([p[0] for p in parts])), info


def gemini_settings(opt, one_voice=True):
    import gemini_tts as G
    model = G.check_model(opt.get('model') or G.DEFAULT_MODEL)
    voices = [v.strip() for v in (opt.get('voice') or G.DEFAULT_VOICE).split(',') if v.strip()]
    if one_voice and len(voices) != 1:
        raise G.TtsError('One voice, please (several voices are for --sample): %s' % ','.join(voices))
    return model, voices, opt.get('style') or G.DEFAULT_STYLE


def requests_of(lang, opt):
    """The requests of a language: [(indexes of the paragraphs, transcript)] and the paragraphs."""
    import gemini_tts as G
    _, _, style = gemini_settings(opt, one_voice=False)
    items = paragraphs_of(lang)
    texts = [it[3] for it in items]
    groups = G.split_paragraphs(texts, extra=G.estimate_tokens(style))
    return [(idx, G.transcript([texts[i] for i in idx])) for idx in groups], items


def gemini_pieces(lang, opt, tts=None, cut=None, log=print):
    """The audio of every paragraph of the language (from the cache, or by requests), cut and checked."""
    import gemini_tts as G
    tts = tts or G.synthesize
    model, (voice_name,), style = gemini_settings(opt)
    base = os.path.join(WORK, 'voice-gemini')
    rate = G.Rate(os.path.join(base, 'rate.json'))
    reqs, items = requests_of(lang, opt)
    pieces = [None] * len(items)
    files = []
    for gi, (idx, text) in enumerate(reqs):
        name = G.cache_name(model, voice_name, style, text)
        files.append(name)
        log('%s: request %d of %d (%d paragraphs, about %d tokens, %s, %s)%s' % (
            lang, gi + 1, len(reqs), len(idx), G.estimate_tokens(text), model, voice_name,
            ' — in the cache' if os.path.exists(os.path.join(base, 'cache', name)) else ''))
        wav = tts(text, model=model, voice=voice_name, style=style, rate=rate, cache_dir=os.path.join(base, 'cache'))
        samples, sr = G.read_pcm(wav)
        try:
            got = (cut or G.cut_at_pauses)(samples, sr, len(idx))
            if got is None:
                raise G.TtsError('%s: the answer could not be cut into its %d paragraphs at the pauses.' % (lang, len(idx)))
            G.check_lengths(got, sr, [items[i][3] for i in idx], ['%s %s' % (lang, items[i][0]) for i in idx])
        except G.TtsError:
            # (this answer is not used again: the next run asks anew; the file is kept beside, renamed)
            G.reject(os.path.join(base, 'cache'), name)
            raise
        for i, p in zip(idx, got):
            pieces[i] = (p, sr)
    return pieces, items, files


def gemini_voices(lang, vids, opt, tts=None, cut=None):
    """The narration of the given videos of a language by the Gemini API (only those made); returns the videos made."""
    import gemini_tts as G
    model, (voice_name,), _ = gemini_settings(opt)
    want = [n for n, _ in vids if os.path.exists(os.path.join(WORK, 'out', lang, n + '.mp4'))]
    if not want:
        return []
    pieces, items, _ = gemini_pieces(lang, opt, tts, cut)
    base = os.path.join(WORK, 'voice-gemini')
    made = []
    for name, segs in vids:
        if name not in want:
            continue
        mine = [(k, it) for k, it in enumerate(items) if it[0] == name]
        d = os.path.join(base, lang, name)
        os.makedirs(d, exist_ok=True)
        parts = []
        for j, (k, (_, start, room, _t)) in enumerate(mine):
            w = os.path.join(d, '%02d.wav' % j)
            p, sr = pieces[k]
            G.write_wav(w, p, sr)
            parts.append((w, start, room))
        info = place_and_mux(lang, name, segs, parts, d)
        long_ = sum(1 for x in info if x[3])
        print('%s %s: %d paragraphs (Gemini %s, %s), %d still longer than the segment' % (lang, name, len(mine), model, voice_name, long_))
        made.append(name)
    return made


def gemini_sample(lang, opt, tts=None):
    """--sample N: the first N paragraphs of the language in one request for each voice, written to
    voice-gemini/sample/<lang>-<model>-<voice>.wav (no video, no ffmpeg)."""
    import gemini_tts as G
    tts = tts or G.synthesize
    model, voices, style = gemini_settings(opt, one_voice=False)
    base = os.path.join(WORK, 'voice-gemini')
    rate = G.Rate(os.path.join(base, 'rate.json'))
    paras = [it[3] for it in paragraphs_of(lang)[:opt['sample']]]
    text = G.transcript(paras)
    out = []
    for v in voices:
        wav = tts(text, model=model, voice=v, style=style, rate=rate, cache_dir=os.path.join(base, 'cache'))
        d = os.path.join(base, 'sample')
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, '%s-%s-%s.wav' % (lang, model, v))
        with open(path + '.part', 'wb') as f:
            f.write(wav)
        os.replace(path + '.part', path)
        print('%s: %s (%d paragraphs, %.1f s)' % (lang, os.path.relpath(path, WORK), len(paras), G.wav_seconds(wav)))
        out.append(path)
    return out


def gemini_synth_only(langs, opt, tts=None, today=None):
    """--synth-only: the audio of every paragraph of the languages (without the videos), into voice-gemini/cache,
    checked as the run with the videos checks it; then voice-gemini-<date>.zip with the cache, the samples and a
    manifest (no ffmpeg). Returns (the zip, the languages done, the error that stopped it or None)."""
    import gemini_tts as G
    model, (voice_name,), style = gemini_settings(opt)
    base = os.path.join(WORK, 'voice-gemini')
    done, man, err = [], {'model': model, 'voice': voice_name, 'style': style, 'langs': {}}, None
    for lang in langs:
        try:
            pieces, items, files = gemini_pieces(lang, opt, tts)
        except G.DailyLimit as e:
            err = e
            break
        except G.TtsError as e:
            err = e
            print('%s: %s' % (lang, e))
            continue
        man['langs'][lang] = {'paragraphs': len(items), 'files': files,
                              'seconds': round(sum(len(p) / float(sr) for p, sr in pieces), 1)}
        print('%s: %d paragraphs, %.1f s of narration in %s' % (lang, len(items), man['langs'][lang]['seconds'], ', '.join(files)))
        done.append(lang)
    os.makedirs(base, exist_ok=True)
    with open(os.path.join(base, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    day = (today or datetime.datetime.now(G.JST)).strftime('%Y%m%d')
    zpath = os.path.join(WORK, 'voice-gemini-%s.zip' % day)
    with zipfile.ZipFile(zpath + '.part', 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(base, 'manifest.json'), 'voice-gemini/manifest.json')
        for sub in ('cache', 'sample'):
            d = os.path.join(base, sub)
            for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                if fn.endswith('.wav') and not fn.endswith('.rejected.wav'):
                    z.write(os.path.join(d, fn), 'voice-gemini/%s/%s' % (sub, fn))
    os.replace(zpath + '.part', zpath)
    print('%s (%d of %d languages)' % (os.path.relpath(zpath, WORK), len(done), len(langs)))
    return zpath, done, err


# ---- Chatterbox (--engine chatterbox): the audio made on the owner's computer (store/tools/chatterbox_tts.py)

class NarrationError(Exception):
    pass


# the folder of the audio in the work folder, and the tool that made it, for --engine chatterbox and --engine tts
VOICE_DIRS = {'chatterbox': ('voice-chatterbox', 'chatterbox_tts.py'), 'tts': ('voice-tts', 'tts_engines.py')}


def chatterbox_manifest(engine='chatterbox'):
    folder, tool = VOICE_DIRS[engine]
    path = os.path.join(WORK, folder, 'manifest.json')
    if not os.path.exists(path):
        raise NarrationError('No %s: unpack the zips of %s into the work folder.' % (path, tool))
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ---- the subtitles at the times of the voice (--engine chatterbox and tts)

def wav_levels(path, frame=0.01):
    """The loudness of a 16-bit WAV in frames of 10 ms: (seconds per frame, [RMS of each frame]); ([] for other kinds)."""
    with wave.open(path) as w:
        rate, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    if sw != 2:
        return frame, []
    a = array.array('h', raw)
    if sys.byteorder == 'big':
        a.byteswap()
    if ch > 1:
        a = a[0::ch]
    step = max(1, int(rate * frame))
    out = []
    for i in range(0, len(a) - step + 1, step):
        s = a[i:i + step]
        out.append(math.sqrt(sum(x * x for x in s) / step))
    return step / float(rate), out


def speech_spans(path, weights, min_gap=0.08):
    """When each of the lines of a paragraph is said in its WAV (seconds from the start of the WAV): [(start, end)] for
    the lines, whose lengths are weights, and how many of the boundaries between them are at a pause of the voice
    (the others where the lengths put them). A pause is a run of frames 30 dB under the loud part of the voice (its
    95th percentile), at least min_gap long; for each boundary the one nearest to where the lengths put it, a longer
    one preferred, in order and not further than a quarter of the paragraph (+ 0.3 s) from there."""
    fs, rms = wav_levels(path)
    n = len(weights)
    tot = float(sum(weights)) or 1.0
    if rms:
        thr = sorted(rms)[int(0.95 * (len(rms) - 1))] * 10 ** (-30 / 20.0)
        loud = [r >= thr and r > 0 for r in rms]
    else:
        loud = []
    if not any(loud):
        d = wav_dur(path)
        cut, cum = [], 0.0
        for w in weights:
            a = d * cum / tot
            cum += w
            cut.append((a, d * cum / tot))
        return cut, 0
    first, last = loud.index(True), len(loud) - 1 - loud[::-1].index(True)
    on, off = first * fs, (last + 1) * fs
    gaps, i = [], first
    while i <= last:
        if loud[i]:
            i += 1
            continue
        j = i
        while j <= last and not loud[j]:
            j += 1
        if (j - i) * fs >= min_gap:
            gaps.append((i * fs, j * fs))
        i = j
    span, cum, prev, bounds, found = off - on, 0.0, on, [], 0
    for k in range(n - 1):
        cum += weights[k]
        e = on + span * cum / tot
        best = None
        for g0, g1 in gaps:
            c = (g0 + g1) / 2.0
            if g0 <= prev + 0.05 or abs(c - e) > 0.25 * span + 0.3:
                continue
            score = abs(c - e) - 0.5 * min(g1 - g0, 0.6)
            if best is None or score < best[0]:
                best = (score, g0, g1)
        if best:
            bounds.append((best[1], best[2]))
            found += 1
            prev = best[2]
        else:
            e = max(e, prev + 0.05)
            bounds.append((e, e))
            prev = e
    spans, a = [], on
    for g0, g1 in bounds:
        spans.append((a, g0))
        a = g1
    spans.append((a, off))
    return spans, found


def voice_cues(lang, segs, placed):
    """The subtitle cues (start, end, line) of a video at the times of its voice. placed = {segment: (wav, start, room)}:
    each paragraph is placed and sped up as track_filter does it; each line is shown from 0.12 s before it is said (the
    first of a segment 0.15 s, not before the segment) until the next line, the last one until 0.7 s after the voice
    (0.1 s before the end of the segment at most). A segment without its audio keeps the plan's cues. Returns the cues,
    the number of boundaries found at a pause and the number of boundaries."""
    top = SPEED_TOP.get(lang, 1.5)
    plan = video_plan.cues(lang, segs)
    out, t0, found, bounds = [], 0.0, 0, 0
    for k, s in enumerate(segs):
        d = float(s['dur'])
        lines = s['lines']
        if lines and k in placed:
            w, start, room = placed[k]
            dur = wav_dur(w)
            speed = min(top, dur / room) if dur > room else 1.0
            weights = [max(1, video_plan.units(lang, spoken(lang, l))[0]) for l in lines]
            spans, f = speech_spans(w, weights)
            found += f
            bounds += len(lines) - 1
            times = [(start + a / speed, start + b / speed) for a, b in spans]
            starts = []
            for i, (a, b) in enumerate(times):
                starts.append(max(t0 + 0.05, a - 0.15) if i == 0 else max(starts[-1] + 0.3, a - 0.12))
            for i, (a, b) in enumerate(times):
                if i + 1 < len(times):
                    end = starts[i + 1] - 0.04
                else:
                    end = max(min(t0 + d - 0.1, b + 0.7), min(t0 + d - 0.02, starts[i] + 0.5))
                out.append((round(starts[i], 3), round(end, 3), lines[i]))
        elif lines:
            out += [c for c in plan if t0 <= c[0] < t0 + d]
        t0 += d
    return out, found, bounds


def write_cues(lang, name, cues):
    d = os.path.join(WORK, 'cues', lang)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump([[a, b, l] for a, b, l in cues], f, ensure_ascii=False, indent=0)
    video_plan.write_srt(os.path.join(d, name + '.srt'), cues)


def chatterbox_voices(lang, vids, man=None, report=None, engine='chatterbox', cues_only=False, cue_report=None):
    """The narration of the given videos of a language from the audio made on the owner's computer (voice-chatterbox/
    of chatterbox_tts.py, or voice-tts/ of tts_engines.py with engine='tts'): every paragraph found by (video,
    segment) in the manifest, its text the same as the plan's now (otherwise it stops with the paragraphs named: no
    old audio is used), each put at its start and faster when longer than its room (place_and_mux), and the subtitle
    cues at the times of the voice (voice_cues, written by write_cues). A video whose paragraphs are not all there is
    not made, and is told. With cues_only only the cues are written (the videos need not be there). Returns the videos
    made; report (a list) gets a row for every paragraph read faster: (lang, video, n, seg, seconds, room, speed, too
    long); cue_report (a list) a row (lang, video, boundaries at a pause, boundaries) for every video."""
    man = man if man is not None else chatterbox_manifest(engine)
    folder = VOICE_DIRS[engine][0]
    base = os.path.join(WORK, folder)
    rows = (man.get('langs') or {}).get(lang)
    want = [(n, s) for n, s in vids if cues_only or os.path.exists(os.path.join(WORK, 'out', lang, n + '.mp4'))]
    if not want:
        return []
    if not rows:
        print('%s: no audio of this language in %s/manifest.json: %s not made' % (lang, folder, ', '.join(n for n, _ in want)))
        return []
    by = {(r.get('video'), r.get('seg')): r for r in rows}
    plan = paragraphs_seg(lang)
    # the texts first: one that differs from the plan stops the language (the audio is of an older text)
    wrong = []
    for name, k, start, room, text in plan:
        r = by.get((name, k))
        if r is not None and r.get('text') != text:
            wrong.append('%s %s segment %d (paragraph %s): the audio says "%s", the plan now "%s"' % (lang, name, k, r.get('n'), (r.get('text') or '')[:40], text[:40]))
    if wrong:
        raise NarrationError('The text of the audio is not the text of the plan (make these paragraphs again):\n  ' + '\n  '.join(wrong))
    made = []
    for name, segs in want:
        mine = [(k, start, room, text) for v, k, start, room, text in plan if v == name]
        missing, parts, ns = [], [], []
        for k, start, room, text in mine:
            r = by.get((name, k))
            w = os.path.join(base, r['file']) if r and r.get('file') else None
            if not w or not os.path.exists(w):
                missing.append('segment %d%s' % (k, '' if r else ' (not in the manifest)'))
                continue
            parts.append((w, start, room))
            ns.append((r.get('n'), k))
        if missing:
            print('%s %s: not made, the audio of %s is missing' % (lang, name, ', '.join(missing)))
            continue
        cues, found, bounds = voice_cues(lang, segs, {k: p for (_n, k), p in zip(ns, parts)})
        write_cues(lang, name, cues)
        if cue_report is not None:
            cue_report.append((lang, name, found, bounds))
        label = 'Chatterbox' if engine == 'chatterbox' else ', '.join(sorted({'%s:%s' % (r.get('engine'), r.get('voice')) for r in rows}))
        if cues_only:
            print('%s %s: %d cues at the times of the voice (%s), %d of %d boundaries at a pause' % (lang, name, len(cues), label, found, bounds))
            made.append(name)
            continue
        info = place_and_mux(lang, name, segs, parts, os.path.join(base, 'mix', lang, name))
        for (j, dur, speed, too_long), (n, k), (_w, _s, room) in zip(info, ns, parts):
            if speed > 1.0 and report is not None:
                report.append((lang, name, n, k, round(dur, 2), round(room, 2), round(speed, 3), too_long))
        fast = [x for x in info if x[2] > 1.0]
        print('%s %s: %d paragraphs (%s), %d read faster, %d still longer than the segment; %d of %d subtitle boundaries at a pause' % (
            lang, name, len(parts), label, len(fast), sum(1 for x in info if x[3]), found, bounds))
        made.append(name)
    return made


def main():
    if OPT['engine'] in ('chatterbox', 'tts'):
        report, made, creport = [], 0, []
        try:
            man = chatterbox_manifest(OPT['engine'])
            for lang in LANGS:
                made += len(chatterbox_voices(lang, [(n, s) for n, s in all_videos(lang) if not ONLY or n in ONLY], man, report,
                                              engine=OPT['engine'], cues_only=OPT['cues-only'], cue_report=creport))
        except NarrationError as e:
            print(str(e))
            return 1
        f, b = sum(r[2] for r in creport), sum(r[3] for r in creport)
        print('subtitles at the times of the voice: %d of %d boundaries between lines at a pause (in %s)' % (f, b, os.path.join(WORK, 'cues')))
        if OPT['cues-only']:
            print('%d videos with cues' % made)
            return 0
        print('%d videos made; %d paragraphs read faster%s' % (made, len(report), ':' if report else ''))
        for lang, name, n, k, dur, room, speed, too_long in report:
            print('  %s %s paragraph %s (segment %d): %.2f s in %.2f s, %.2f times%s' % (lang, name, n, k, dur, room, speed, ', still too long' if too_long else ''))
        return 0
    if OPT['engine'] == 'gemini':
        import gemini_tts as G
        try:
            if OPT['synth-only']:
                _, _, err = gemini_synth_only(LANGS, OPT)
                if err:
                    print(str(err))
                    return 2 if isinstance(err, G.DailyLimit) else 1
                return 0
            for lang in LANGS:
                if OPT['sample'] is not None:
                    gemini_sample(lang, OPT)
                else:
                    gemini_voices(lang, [(n, s) for n, s in all_videos(lang) if not ONLY or n in ONLY], OPT)
        except G.DailyLimit as e:
            print(str(e))
            return 2
        except G.TtsError as e:
            print(str(e))
            return 1
        return 0
    for lang in LANGS:
        for name, segs in all_videos(lang):
            if ONLY and name not in ONLY:
                continue
            voice(lang, name, segs)
    return 0


if __name__ == '__main__':
    sys.exit(main())
