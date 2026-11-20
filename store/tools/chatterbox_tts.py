#!/usr/bin/env python3
"""The narration of the QCalc videos by Chatterbox Multilingual V3 (Resemble AI, MIT license), made on the owner's
own computer. Free, and without a daily limit.

Each paragraph (a segment of a video that has subtitles) is made by itself, so nothing has to be cut afterwards.
The paragraphs and their texts are the same as for the Gemini narration (video_voice.py: paragraphs_of,
gemini_text): every segment with lines of every video of a language, in the order of the plan.

It runs in the Python 3.11 environment that has chatterbox-tts (the steps: TTS-CHATTERBOX-ja.md). The GPU of the
owner's computer (GTX 1650, 4 GB) is too small for the model, so the default device is the CPU (about a minute
for each paragraph).

Usage:
  python store/tools/chatterbox_tts.py <work folder> [langs] [--sample N|tricky] [--redo lang:n,...]
         [--device cpu|cuda] [--voice reference.wav] [--seed 1234]

  langs           ja,en,de,es,fr,ko,zh-TW (default: all of them)
  --sample N      only the first N paragraphs of each language, into voice-chatterbox/sample/ (to listen to first)
  --sample tricky only the paragraphs with numbers or signs (√, π, =, km/h ...), the ones most often read wrongly
  --redo ja:7     makes paragraph 7 of ja again with another seed (when it sounds wrong); several: ja:7,en:12
  --voice F       a short recording (about 10 s) whose voice is used instead of the default voice
  --seed S        the seed of the first try of every paragraph (the same seed gives the same audio)

Output in <work>/voice-chatterbox/:
  <lang>/<video>-<NN>-<hash>.wav   one file per paragraph (NN: the number of the segment in its video, from 00)
  manifest.json                    for each language, the paragraphs in order: video, segment, start, room,
                                   text, the text that was read, file, seconds, seed
and <work>/voice-chatterbox-<lang>.zip for each language that is complete (its files and the manifest).

A file is made only when it is missing, so a run that was stopped (Ctrl+C) goes on where it stopped. When a text
of the plan changes, only that paragraph is made again (the name of the file has a hash of what was read).

Readings: store/tools/tts-readings.json, if it exists, changes words before they are read, for each language, e.g.
{"ja": [["√", "ルート"], ["π", "パイ"]]}. The subtitles do not change.
"""
import datetime
import hashlib
import json
import os
import re
import sys
import time
import wave
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import video_plan  # noqa: E402

PLAN = video_plan.PLAN
ENGINE = 'chatterbox-multilingual-v3'
LANG_ID = {'ja': 'ja', 'en': 'en', 'de': 'de', 'es': 'es', 'fr': 'fr', 'ko': 'ko', 'zh-TW': 'zh'}
DEFAULT_SEED = 1234
REDO_STEP = 1000
TRICKY = re.compile(r'[0-9０-９√π=＝/×÷%^]|km|mph')
TRICKY_MAX = 6


# ---- the paragraphs (the same as video_voice.py)

def plan_text(lang, lines):
    """The paragraph of a segment: the lines of its subtitles, without the symbol of the 3D button."""
    sep = '' if lang in ('ja', 'zh-TW') else ' '
    return sep.join(l.replace('⟳ ', '').strip() for l in lines).strip()


def all_videos(lang, plan=None):
    L = (plan or PLAN)['langs'][lang]
    return [('promo', L['promo']), ('youtube', L['youtube'])] + [(s['name'], s['segments']) for s in L['shorts']]


def paragraphs_of(lang, plan=None):
    """[(video, segment number, start of its narration, its room, text)] in the order of the plan."""
    out = []
    for name, segs in all_videos(lang, plan):
        t0 = 0.0
        for k, s in enumerate(segs):
            d = float(s['dur'])
            if s['lines']:
                out.append((name, k, round(t0 + 0.15, 3), round(d - 0.3, 3), plan_text(lang, s['lines'])))
            t0 += d
    return out


# ---- readings

def load_readings(path=None):
    path = path or os.path.join(TOOLS, 'tts-readings.json')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def spoken(lang, text, readings):
    """The text as it is read: the readings of the language applied, longest first."""
    for a, b in sorted(readings.get(lang, []), key=lambda p: -len(p[0])):
        text = text.replace(a, b)
    return text


def file_key(spoken_text, voice, seed):
    h = hashlib.sha1(json.dumps([ENGINE, spoken_text, voice or 'default', seed], ensure_ascii=False).encode('utf-8'))
    return h.hexdigest()[:8]


# ---- audio

def to_int16(samples):
    """Floats in −1..1 (a list, or anything with tolist()) → little-endian 16-bit bytes."""
    import array
    vals = samples.tolist() if hasattr(samples, 'tolist') else list(samples)
    if vals and isinstance(vals[0], list):
        vals = vals[0]
    out = array.array('h', (int(max(-1.0, min(1.0, v)) * 32767) for v in vals))
    if sys.byteorder != 'little':
        out.byteswap()
    return out.tobytes()


def trim(pcm, rate, lead=0.03, tail=0.08):
    """The 16-bit mono audio without its silence at the start and the end (a little margin is kept)."""
    import array
    a = array.array('h')
    a.frombytes(pcm)
    if sys.byteorder != 'little':
        a.byteswap()
    win = max(1, rate // 100)
    rms = []
    for i in range(0, len(a), win):
        c = a[i:i + win]
        rms.append((sum(x * x for x in c) / max(1, len(c))) ** 0.5)
    if not rms:
        return pcm
    peak = max(rms)
    quiet = max(peak * 0.02, 30.0)
    voiced = [i for i, v in enumerate(rms) if v > quiet]
    if not voiced:
        return pcm
    s = max(0, voiced[0] * win - int(lead * rate))
    e = min(len(a), (voiced[-1] + 1) * win + int(tail * rate))
    b = a[s:e]
    if sys.byteorder != 'little':
        b.byteswap()
    return b.tobytes()


def write_wav(path, pcm, rate):
    tmp = path + '.part'
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    os.replace(tmp, path)


def wav_seconds(path):
    with wave.open(path) as w:
        return w.getnframes() / float(w.getframerate())


# ---- the model

class Engine:
    """Chatterbox Multilingual V3, loaded on first use."""

    def __init__(self, device='cpu', voice=None):
        self.device, self.voice, self.model = device, voice, None

    def load(self):
        if self.model is None:
            import torch  # noqa: F401
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            print('loading Chatterbox Multilingual V3 on %s ...' % self.device)
            self.model = ChatterboxMultilingualTTS.from_pretrained(device=self.device, t3_model='v3')
        return self.model

    def say(self, text, lang, seed):
        """(16-bit mono PCM bytes, sample rate)."""
        import torch
        m = self.load()
        torch.manual_seed(seed)
        kw = {'language_id': LANG_ID[lang]}
        if self.voice:
            kw['audio_prompt_path'] = self.voice
        wav = m.generate(text, **kw)
        return to_int16(wav.squeeze().detach().cpu().numpy()), m.sr


# ---- the runs

def options(argv):
    pos, opt, i = [], {'sample': None, 'redo': None, 'device': 'cpu', 'voice': None, 'seed': str(DEFAULT_SEED)}, 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k, eq, v = a[2:].partition('=')
            if k not in opt:
                raise SystemExit('unknown option --%s' % k)
            if not eq:
                i += 1
                if i >= len(argv):
                    raise SystemExit('--%s needs a value' % k)
                v = argv[i]
            opt[k] = v
        else:
            pos.append(a)
        i += 1
    if not pos:
        raise SystemExit(__doc__.split('Usage:')[1].split('Output')[0])
    langs = pos[1].split(',') if len(pos) > 1 else list(PLAN['langs'])
    for l in langs:
        if l not in LANG_ID:
            raise SystemExit('unknown language %s (%s)' % (l, ','.join(LANG_ID)))
    return pos[0], langs, opt


def parse_redo(text):
    out = {}
    for part in (text or '').split(','):
        if not part.strip():
            continue
        lang, _, n = part.strip().partition(':')
        if lang not in LANG_ID or not n.isdigit():
            raise SystemExit('--redo wants lang:number, e.g. ja:7 (got %s)' % part)
        out.setdefault(lang, set()).add(int(n))
    return out


def load_manifest(path):
    try:
        with open(path, encoding='utf-8') as f:
            m = json.load(f)
        m.setdefault('langs', {})
        return m
    except (OSError, ValueError):
        return {'langs': {}}


def save_manifest(path, man):
    tmp = path + '.part'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def make_sample(work, langs, opt, engine, readings, log=print):
    base = os.path.join(work, 'voice-chatterbox', 'sample')
    os.makedirs(base, exist_ok=True)
    seed = int(opt['seed'])
    made = []
    for lang in langs:
        items = paragraphs_of(lang)
        if opt['sample'] == 'tricky':
            chosen = [(i, it) for i, it in enumerate(items) if TRICKY.search(it[4])][:TRICKY_MAX]
        else:
            chosen = list(enumerate(items))[:int(opt['sample'])]
        for i, (video, k, start, room, text) in chosen:
            path = os.path.join(base, '%s-%02d.wav' % (lang, i + 1))
            said = spoken(lang, text, readings)
            if not os.path.exists(path):
                pcm, sr = engine.say(said, lang, seed)
                write_wav(path, trim(pcm, sr), sr)
            log('%s %2d (%s): %.1f s  %s' % (lang, i + 1, video, wav_seconds(path), said))
            made.append(path)
    return made


def make_all(work, langs, opt, engine, readings, log=print, clock=time.time):
    base = os.path.join(work, 'voice-chatterbox')
    os.makedirs(base, exist_ok=True)
    mpath = os.path.join(base, 'manifest.json')
    man = load_manifest(mpath)
    man.update({'engine': ENGINE, 'voice': os.path.basename(opt['voice']) if opt['voice'] else 'default'})
    seed0 = int(opt['seed'])
    redo = parse_redo(opt['redo'])
    # first what is to be made (so that the time left counts only the missing files)
    work_list = {}
    for lang in langs:
        old = {(e['video'], e['seg']): e for e in man['langs'].get(lang, [])}
        lst = []
        for n, (video, k, start, room, text) in enumerate(paragraphs_of(lang), 1):
            said = spoken(lang, text, readings)
            prev = old.get((video, k))
            seed = prev['seed'] if prev and prev.get('said') == said and prev.get('seed') else seed0
            if n in redo.get(lang, ()):
                seed += REDO_STEP
            name = '%s-%02d-%s.wav' % (video, k, file_key(said, opt['voice'], seed))
            lst.append((n, video, k, start, room, text, said, seed, name))
        work_list[lang] = lst
    missing = sum(1 for lang in langs for it in work_list[lang]
                  if not os.path.exists(os.path.join(base, lang, it[8])))
    log('%d paragraphs to make (%d languages)' % (missing, len(langs)))
    t_start, made_now = clock(), 0
    zips = []
    for lang in langs:
        d = os.path.join(base, lang)
        os.makedirs(d, exist_ok=True)
        rows = []
        lst = work_list[lang]
        for n, video, k, start, room, text, said, seed, name in lst:
            path = os.path.join(d, name)
            if not os.path.exists(path):
                t0 = clock()
                pcm, sr = engine.say(said, lang, seed)
                write_wav(path, trim(pcm, sr), sr)
                made_now += 1
                left = (missing - made_now) * (clock() - t_start) / made_now
                log('%s %2d/%d (%s): %.1f s of audio in %.0f s; about %.0f min left' % (
                    lang, n, len(lst), video, wav_seconds(path), clock() - t0, left / 60))
            secs = round(wav_seconds(path), 2)
            top = 1.35 if lang == 'ja' else 1.5
            rows.append({'n': n, 'video': video, 'seg': k, 'start': start, 'room': room, 'text': text, 'said': said,
                         'file': '%s/%s' % (lang, name), 'seconds': secs, 'seed': seed,
                         'fits': secs <= room * top})
        man['langs'][lang] = rows
        man['made'] = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
        save_manifest(mpath, man)
        for r in check(lang, rows):
            log(r)
        zips.append(zip_lang(work, lang, rows, mpath))
        log('%s: %d paragraphs, %.1f s → %s' % (lang, len(rows), sum(r['seconds'] for r in rows), os.path.basename(zips[-1])))
    return zips


def check(lang, rows):
    """Lines to show about paragraphs that may be wrong: much longer or shorter than the others for their text
    (a model can now and then add or drop words), or longer than the segment even when read faster."""
    out = []
    per = sorted(r['seconds'] / max(1, len(re.sub(r'\s+', '', r['said']))) for r in rows)
    if per:
        m = per[len(per) // 2]
        for r in rows:
            x = r['seconds'] / max(1, len(re.sub(r'\s+', '', r['said'])))
            if x < m / 2 or x > m * 2:
                out.append('  check %s:%d (%s): %.2f s a character, the median is %.2f; listen, and if it is wrong: --redo %s:%d'
                           % (lang, r['n'], r['video'], x, m, lang, r['n']))
    for r in rows:
        if not r['fits']:
            out.append('  long %s:%d (%s): %.1f s for a room of %.1f s, even read faster it does not fit' % (
                lang, r['n'], r['video'], r['seconds'], r['room']))
    return out


def zip_lang(work, lang, rows, mpath):
    zpath = os.path.join(work, 'voice-chatterbox-%s.zip' % lang)
    with zipfile.ZipFile(zpath + '.part', 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(mpath, 'voice-chatterbox/manifest.json')
        for r in rows:
            z.write(os.path.join(work, 'voice-chatterbox', r['file']), 'voice-chatterbox/' + r['file'])
    os.replace(zpath + '.part', zpath)
    return zpath


def main(argv=None):
    work, langs, opt = options(sys.argv[1:] if argv is None else argv)
    work = os.path.expanduser(work)
    if opt['voice'] and not os.path.exists(os.path.expanduser(opt['voice'])):
        raise SystemExit('no such file: %s' % opt['voice'])
    if opt['voice']:
        opt['voice'] = os.path.expanduser(opt['voice'])
    engine = Engine(opt['device'], opt['voice'])
    readings = load_readings()
    if opt['sample'] is not None:
        if opt['sample'] != 'tricky' and not opt['sample'].isdigit():
            raise SystemExit('--sample wants a number or tricky')
        make_sample(work, langs, opt, engine, readings)
        return 0
    make_all(work, langs, opt, engine, readings)
    return 0


if __name__ == '__main__':
    sys.exit(main())
