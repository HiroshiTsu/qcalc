#!/usr/bin/env python3
"""The narration of the QCalc videos by several speech engines on the owner's own computer, to compare voices and then
make all the paragraphs with the voice chosen for each language (the steps: TTS-ENGINES-ja.md).

The paragraphs, their texts and the readings (tts-readings.json) are those of chatterbox_tts.py and video_voice.py.
chatterbox_tts.py stays as it is; here Chatterbox is one engine among the others.

  engine      model (Hugging Face)                                  languages            voice
  qwen3       Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign (the voice) and   ja en de es fr ko zh  designed (female, male)
              Qwen/Qwen3-TTS-12Hz-1.7B-Base or -0.6B-Base (reading)
  ming        inclusionAI/Ming-3.0-tts-0.5B                          ja en de es fr ko zh  designed (female, male)
  irodori     Aratako/Irodori-TTS-v4.1-Small                         ja                    designed (female, male)
  chatterbox  Chatterbox Multilingual V3 (as chatterbox_tts.py)       ja en de es fr ko zh  its default voice

Every engine is installed in a Python environment of its own (see the guide); one run uses one engine. A designed voice
is made once from its description and seed (tts-voices.json) as a short reference recording in one language
(<work>/tts/voices/<engine>-<voice>.wav, with its .json), and every paragraph of every language is then read in that
voice, so that one engine sounds like the same person in all languages. No real person's voice is copied: the
reference is itself synthetic.

Qwen3 reads in the designed voice from its speaker embedding only (x-vector, --qwen-clone xvector, the default since
11-22, the author's decision): the timbre of the voice without its way of speaking, so that the reference (in English)
gives no English accent to the other languages, and every language is still the same woman's voice. --qwen-clone icl
reads as before (the reference audio and its text continued, which copied the English way of speaking into every
language). The mode is part of the names of the audio files, so audio made one way is never taken for the other.

Usage:
  python store/tools/tts_engines.py design <work> --engine E [--voice female,male] [--redesign]
  python store/tools/tts_engines.py sample <work> [langs] --engine E [--voice female,male]
  python store/tools/tts_engines.py all <work> --use ja=irodori:female,en=qwen3:female,... [--redo ja:7]
  python store/tools/tts_engines.py listen <work>
  options: --device auto|cpu|cuda  --dtype auto|fp16|fp32|bf16  --qwen-size 1.7b|0.6b  --qwen-clone xvector|icl  --seed S
           --ming-repo DIR  --irodori-model REPO[/subfolder]  --no-text-normalization (ming)

  design  makes the reference recording of each voice (when it is missing or its description or seed changed)
  sample  the paragraphs of chatterbox_tts.py --sample tricky (numbers, units and signs) of each language, in each voice
          of the engine, into <work>/tts/sample/<lang>/<lang>-<engine>-<voice>-p<NN>-<video>-<seg>.wav; then the
          listening lists <work>/tts/sample/listen.md and listen.html (all engines made so far, side by side)
  all     every paragraph of each language with the engine and voice chosen for it, into <work>/voice-tts/ (one
          manifest.json as chatterbox_tts.py writes it, with the engine and the voice of each language) and
          <work>/voice-tts-<lang>.zip for each complete language
  listen  writes the listening lists again

For every paragraph the time it took and the most memory of the GPU it used are shown and kept in the manifest.
A file is made only when it is missing, so a stopped run goes on where it stopped.
"""
import datetime
import hashlib
import html
import json
import os
import random
import re
import sys
import time
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import chatterbox_tts as C  # noqa: E402  (the paragraphs, the readings and the audio helpers)

LANGS = list(C.LANG_ID)
VOICES_FILE = os.path.join(TOOLS, 'tts-voices.json')
REDO_STEP = C.REDO_STEP


# ---- the engines (their libraries are imported only when they are loaded)

def pick_dtype(torch, device, asked, allowed=('bf16', 'fp16', 'fp32')):
    """The precision: as asked, or bf16 on a GPU that has it, fp16 on an older GPU (GTX 1650), fp32 on the CPU."""
    if asked and asked != 'auto':
        if asked not in allowed:
            raise SystemExit('this engine cannot use %s (it can use %s)' % (asked, ', '.join(allowed)))
        return asked
    if device.startswith('cuda'):
        if 'bf16' in allowed and torch.cuda.is_bf16_supported():
            return 'bf16'
        return 'fp16' if 'fp16' in allowed else 'fp32'
    return 'fp32'


def pick_device(torch, asked):
    if asked and asked != 'auto':
        return asked
    return 'cuda:0' if torch.cuda.is_available() else 'cpu'


def has_module(name):
    """Whether this environment can import name (without importing it)."""
    if name in sys.modules:
        return True
    import importlib.util
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


class Engine:
    """What every engine has: say(text, lang, voice, seed) → (16-bit PCM, rate); design(...) for a designed voice."""
    name = ''
    langs = set(LANGS)
    voices = ('female', 'male')
    models = {}
    library = ''

    def available(self):
        return has_module(self.library)

    def __init__(self, opt):
        self.opt, self.torch, self.device, self.dtype = opt, None, None, None

    def _torch(self):
        if self.torch is None:
            import torch
            self.torch = torch
            self.device = pick_device(torch, self.opt.get('device'))
        return self.torch

    def seed_all(self, seed):
        random.seed(seed)
        t = self._torch()
        t.manual_seed(seed)
        if t.cuda.is_available():
            t.cuda.manual_seed_all(seed)
        try:
            import numpy
            numpy.random.seed(seed % (2 ** 32))
        except ImportError:
            pass

    # the most memory of the GPU used since reset_peak, in MB (None on the CPU)
    def reset_peak(self):
        t = self.torch
        if t is not None and self.device and self.device.startswith('cuda'):
            t.cuda.reset_peak_memory_stats()

    def peak_mb(self):
        t = self.torch
        if t is not None and self.device and self.device.startswith('cuda'):
            return round(t.cuda.max_memory_allocated() / 2 ** 20)
        return None

    def info(self):
        return {'engine': self.name, 'models': self.models_used(), 'device': self.device, 'dtype': self.dtype}

    def file_tag(self):
        # how this engine reads, when it is a choice (Qwen3: xvector), in the names of the audio files; '' for none
        return ''

    def models_used(self):
        return dict(self.models)

    @staticmethod
    def pcm(wav):
        """A waveform (numpy array or torch tensor, any shape with one channel) → 16-bit PCM bytes."""
        if hasattr(wav, 'detach'):
            wav = wav.detach().float().cpu().numpy()
        wav = wav.reshape(-1) if hasattr(wav, 'reshape') else wav
        return C.to_int16(wav)


class Qwen3(Engine):
    """Qwen3-TTS (Alibaba Qwen, Apache-2.0): the voice designed from its description by the 1.7B VoiceDesign model, then
    every paragraph read in that voice by the Base model (1.7B, or 0.6B on a small GPU) from the reference recording:
    from its speaker embedding only (x_vector_only_mode, clone 'xvector', the default) or, with clone 'icl', from the
    reference audio and its text (in-context, which also copies the way the reference speaks)."""
    CLONES = ('xvector', 'icl')
    name = 'qwen3'
    library = 'qwen_tts'
    LANG = {'ja': 'Japanese', 'en': 'English', 'de': 'German', 'es': 'Spanish', 'fr': 'French', 'ko': 'Korean', 'zh-TW': 'Chinese'}

    def __init__(self, opt):
        super().__init__(opt)
        size = (opt.get('qwen_size') or '1.7b').upper()
        if size not in ('1.7B', '0.6B'):
            raise SystemExit('--qwen-size wants 1.7b or 0.6b')
        self.models = {'design': 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'read': 'Qwen/Qwen3-TTS-12Hz-%s-Base' % size}
        self.clone = (opt.get('qwen_clone') or 'xvector').lower()
        if self.clone not in self.CLONES:
            raise SystemExit('--qwen-clone wants xvector or icl')
        self.loaded, self.prompts = {}, {}

    def file_tag(self):
        # (in the names of the audio files: '' for the in-context reading, so that the files made before 11-22 keep their names)
        return 'xvec' if self.clone == 'xvector' else ''

    def info(self):
        i = super().info()
        i['clone'] = self.clone
        return i

    def _model(self, kind):
        t = self._torch()
        if kind not in self.loaded:
            from qwen_tts import Qwen3TTSModel
            self.dtype = pick_dtype(t, self.device, self.opt.get('dtype'))
            # (one model in the GPU at a time: the design model is let go before reading)
            for k in list(self.loaded):
                del self.loaded[k]
            if self.device.startswith('cuda'):
                t.cuda.empty_cache()
            print('loading %s on %s (%s) ...' % (self.models[kind], self.device, self.dtype))
            self.loaded[kind] = Qwen3TTSModel.from_pretrained(
                self.models[kind], device_map=self.device, dtype={'bf16': t.bfloat16, 'fp16': t.float16, 'fp32': t.float32}[self.dtype],
                attn_implementation='sdpa')
        return self.loaded[kind]

    def design(self, description, lang, text, seed):
        m = self._model('design')
        self.seed_all(seed)
        wavs, sr = m.generate_voice_design(text=text, language=self.LANG[lang], instruct=description)
        return self.pcm(wavs[0]), sr

    def say(self, text, lang, ref, seed):
        m = self._model('read')
        key = (ref['wav'], ref['text'], self.clone)
        if key not in self.prompts:
            if self.clone == 'xvector':
                # the speaker embedding of the reference only: its voice, not its way of speaking (no ref_text then)
                self.prompts[key] = m.create_voice_clone_prompt(ref_audio=ref['wav'], x_vector_only_mode=True)
            else:
                self.prompts[key] = m.create_voice_clone_prompt(ref_audio=ref['wav'], ref_text=ref['text'], x_vector_only_mode=False)
        self.seed_all(seed)
        wavs, sr = m.generate_voice_clone(text=text, language=self.LANG[lang], voice_clone_prompt=self.prompts[key])
        return self.pcm(wavs[0]), sr


class Ming(Engine):
    """Ming-3.0-tts-0.5B (inclusionAI, MIT): the voice designed from its description (VOICE_DESIGN), then every paragraph
    read from that reference (TTS with the reference and its text). Its code (the Ming-3.0-tts repository) computes in
    bf16 on a GPU, which a GTX 1650 does not have: there it runs on the CPU."""
    name = 'ming'
    library = 'ming_tts'
    LANG = {'ja': 'ja', 'en': 'en', 'de': 'de', 'es': 'es', 'fr': 'fr', 'ko': 'ko', 'zh-TW': 'zh'}
    models = {'tts': 'inclusionAI/Ming-3.0-tts-0.5B'}

    def __init__(self, opt):
        super().__init__(opt)
        self.model = None

    def _repo(self):
        repo = os.path.expanduser(self.opt.get('ming_repo') or '~/Ming-3.0-tts')
        if repo not in sys.path:
            sys.path.insert(0, repo)

    def available(self):
        self._repo()
        return has_module('ming_tts')

    def _model(self):
        t = self._torch()
        if self.model is None:
            if self.device.startswith('cuda') and not t.cuda.is_bf16_supported():
                raise SystemExit('Ming computes in bf16, which this GPU does not have (GTX 10xx/16xx/20xx): use --device cpu, or the RTX 4060')
            self._repo()
            from ming_tts import MingTTS
            self.dtype = 'bf16'
            print('loading %s on %s (bf16) ...' % (self.models['tts'], self.device))
            self.model = MingTTS(self.models['tts'], device=self.device, text_normalization=not self.opt.get('no_text_normalization'))
        return self.model

    def design(self, description, lang, text, seed):
        m = self._model()
        self.seed_all(seed)
        wav = m.synthesize(task='VOICE_DESIGN', text=text, language_id=self.LANG[lang], controls={'style': description}, use_zero_spk_emb=True)
        return self.pcm(wav), m.sample_rate

    def say(self, text, lang, ref, seed):
        m = self._model()
        self.seed_all(seed)
        wav = m.synthesize(task='TTS', text=text, language_id=self.LANG[lang], prompt_wav_path=ref['wav'], prompt_text=ref['text'], use_spk_emb=True)
        return self.pcm(wav), m.sample_rate


class Irodori(Engine):
    """Irodori-TTS v4.1-Small (Aratako, MIT; Japanese only): the voice from its description (the caption, no reference),
    then every paragraph with that reference and the same caption. Run from its own folder (uv run --no-sync), where
    irodori_tts can be imported. It computes in fp32 or bf16 (no fp16): fp32 on a GTX 1650."""
    name = 'irodori'
    library = 'irodori_tts'
    langs = {'ja'}

    def __init__(self, opt):
        super().__init__(opt)
        self.models = {'tts': opt.get('irodori_model') or 'Aratako/Irodori-TTS-v4.1-Small'}
        if 'v4-large' in self.models['tts'].lower():
            raise SystemExit('v4-Large is not used (its weights are under the Gemma terms)')
        self.rt = None

    def _rt(self):
        t = self._torch()
        if self.rt is None:
            from irodori_tts.inference_runtime import InferenceRuntime, RuntimeKey, download_hf_checkpoint
            self.dtype = pick_dtype(t, self.device, self.opt.get('dtype'), allowed=('bf16', 'fp32'))
            print('loading %s on %s (%s) ...' % (self.models['tts'], self.device, self.dtype))
            ckpt = download_hf_checkpoint(self.models['tts'])
            dev = 'cuda' if self.device.startswith('cuda') else self.device
            self.rt = InferenceRuntime.from_key(RuntimeKey(checkpoint=ckpt, model_device=dev, model_precision=self.dtype,
                                                           codec_device=dev, codec_precision=self.dtype))
        return self.rt

    def _run(self, **kw):
        from irodori_tts.inference_runtime import SamplingRequest
        res = self._rt().synthesize(SamplingRequest(**kw))
        return self.pcm(res.audio), int(res.sample_rate)

    def design(self, description, lang, text, seed):
        return self._run(text=text, caption=description, no_ref=True, seed=int(seed))

    def say(self, text, lang, ref, seed):
        return self._run(text=text, caption=ref.get('description'), ref_wav=ref['wav'], seed=int(seed))


class Chatterbox(Engine):
    """Chatterbox Multilingual V3 with its default voice, as chatterbox_tts.py makes it (no designed voice)."""
    name = 'chatterbox'
    library = 'chatterbox'
    voices = ('default',)
    models = {'tts': C.ENGINE}

    def __init__(self, opt):
        super().__init__(opt)
        self.engine = None

    def say(self, text, lang, ref, seed):
        if self.engine is None:
            # (the CPU unless a GPU is asked for: a GTX 1650 is too small for it, as chatterbox_tts.py says)
            asked = self.opt.get('device') or 'auto'
            self.device, self.dtype = ('cpu' if asked == 'auto' else asked), 'fp32'
            self.engine = C.Engine('cuda' if self.device.startswith('cuda') else 'cpu')
            try:
                import torch
                self.torch = torch
            except ImportError:
                pass
        return self.engine.say(text, lang, seed)


ENGINES = {e.name: e for e in (Qwen3, Ming, Irodori, Chatterbox)}


# ---- the voices

def load_voices(path=None):
    with open(path or VOICES_FILE, encoding='utf-8') as f:
        return json.load(f)


def voice_spec(voices, engine, voice):
    e = voices['engines'].get(engine) or {}
    if voice not in e:
        raise SystemExit('no voice %s for %s in tts-voices.json (%s)' % (voice, engine, ', '.join(e) or 'none'))
    v = dict(e[voice])
    v.setdefault('anchor_lang', 'en')
    v['anchor_text'] = v.get('anchor_text') or voices['anchor'][v['anchor_lang']]
    return v


def voice_paths(work, engine, voice):
    base = os.path.join(work, 'tts', 'voices', '%s-%s' % (engine, voice))
    return base + '.wav', base + '.json'


def ensure_voice(work, eng, voice, voices, redesign=False, log=print):
    """The reference recording of a designed voice: made again only when it is missing or its description, seed,
    language or model changed (or --redesign). Returns the reference for say(): {wav, text, lang, description}."""
    if eng.name == 'chatterbox':
        return None
    spec = voice_spec(voices, eng.name, voice)
    wav, meta = voice_paths(work, eng.name, voice)
    want = {'engine': eng.name, 'voice': voice, 'description': spec['description'], 'seed': spec['seed'],
            'lang': spec['anchor_lang'], 'text': spec['anchor_text'], 'model': eng.models_used().get('design') or eng.models_used().get('tts')}
    old = None
    if os.path.exists(meta) and os.path.exists(wav):
        with open(meta, encoding='utf-8') as f:
            old = json.load(f)
    if redesign or not old or any(old.get(k) != v for k, v in want.items()):
        os.makedirs(os.path.dirname(wav), exist_ok=True)
        log('designing the voice %s-%s from its description (seed %d) ...' % (eng.name, voice, spec['seed']))
        eng.reset_peak()
        t0 = time.time()
        pcm, sr = eng.design(spec['description'], spec['anchor_lang'], spec['anchor_text'], spec['seed'])
        C.write_wav(wav, C.trim(pcm, sr), sr)
        rec = dict(want, seconds=round(C.wav_seconds(wav), 2), time_s=round(time.time() - t0, 1), vram_mb=eng.peak_mb(),
                   device=eng.device, dtype=eng.dtype, made=datetime.datetime.now().astimezone().isoformat(timespec='seconds'))
        with open(meta + '.part', 'w', encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        os.replace(meta + '.part', meta)
        log('  %s: %.1f s of audio in %.0f s%s' % (os.path.basename(wav), rec['seconds'], rec['time_s'], vram_text(rec['vram_mb'])))
    with open(wav, 'rb') as f:
        rid = hashlib.sha1(f.read()).hexdigest()[:8]
    return {'wav': wav, 'text': spec['anchor_text'], 'lang': spec['anchor_lang'], 'description': spec['description'], 'id': rid}


def vram_text(mb):
    return '' if mb is None else ', GPU memory at most %d MB' % mb


# ---- readings: those of the language, then those of the engine for it ("qwen3:ja")

def spoken(engine, lang, text, readings):
    return C.spoken(engine + ':' + lang, C.spoken(lang, text, readings), readings)


# ---- what to listen for in a paragraph

NUM = re.compile(r'\d[\d,.\u00a0\u202f ]*(?:\s?(?:万|億))?(?:\s?(?:mph|km/h|km|USD|EUR|JPY|GBP|KRW|TWD|cm³|mm|cm|m³|円|桁|元|원|%|つ|行|本|回))?(?![A-Za-z\d])')
SYM = re.compile(r'km/h|mph|\b[23]D\b|[√π=×÷^]')
KANJI = re.compile(r'[一-鿿々]{2,}')


def listen_for(lang, text):
    """[(what, the words)] to listen for in this paragraph."""
    out = []
    signs = [m.strip(' ,.  ') for m in NUM.findall(text)] + SYM.findall(text)
    if re.search(r'\d\s*[\w/]+\s+to\s+[a-z]', text):
        signs.append('to')
    signs = [x for x in dict.fromkeys(signs) if x]
    if signs:
        out.append(('数字・単位・記号', '、'.join(signs)))
    if lang == 'ja':
        k = list(dict.fromkeys(KANJI.findall(text)))
        if k:
            out.append(('漢字の読み', '、'.join(k[:10])))
    n_sent = len([x for x in re.split(r'[。.!?！？]+', text) if x.strip()])
    if '……' in text or '...' in text or n_sent >= 3:
        out.append(('文の抑揚', '文の切れ目と終わり方（%d 文%s）' % (n_sent, '、「……」' if '……' in text else '')))
    return out


# ---- the runs

def tricky(lang):
    """The paragraphs of chatterbox_tts.py --sample tricky: [(n, video, seg, start, room, text)]."""
    items = C.paragraphs_of(lang)
    return [(i + 1,) + tuple(it) for i, it in enumerate(items) if C.TRICKY.search(it[4])][:C.TRICKY_MAX]


def sample_name(lang, engine, voice, n, video, seg):
    return '%s-%s-%s-p%02d-%s-%02d.wav' % (lang, engine, voice, n, video, seg)


def read_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, data):
    with open(path + '.part', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(path + '.part', path)


def synth(eng, text, lang, ref, seed):
    eng.reset_peak()
    t0 = time.time()
    pcm, sr = eng.say(text, lang, ref, seed)
    return pcm, sr, round(time.time() - t0, 1), eng.peak_mb()


def make_sample(work, langs, eng, voices_wanted, voices, opt, readings, log=print):
    base = os.path.join(work, 'tts', 'sample')
    mpath = os.path.join(base, 'manifest.json')
    man = read_json(mpath, {'rows': []})
    keep = {(r['lang'], r['engine'], r['voice'], r['n']): r for r in man['rows']}
    vtag = ('-' + eng.file_tag()) if eng.file_tag() else ''
    seed = int(opt.get('seed') or C.DEFAULT_SEED)
    for voice in voices_wanted:
        ref = ensure_voice(work, eng, voice, voices, opt.get('redesign'), log)
        for lang in langs:
            if lang not in eng.langs:
                continue
            os.makedirs(os.path.join(base, lang), exist_ok=True)
            for n, video, seg, start, room, text in tricky(lang):
                said = spoken(eng.name, lang, text, readings)
                name = sample_name(lang, eng.name, voice + vtag, n, video, seg)
                path = os.path.join(base, lang, name)
                old = keep.get((lang, eng.name, voice + vtag, n))
                if os.path.exists(path) and old and old.get('said') == said:
                    continue
                pcm, sr, secs, vram = synth(eng, said, lang, ref, seed)
                C.write_wav(path, C.trim(pcm, sr), sr)
                row = {'lang': lang, 'engine': eng.name, 'voice': voice + vtag, 'n': n, 'video': video, 'seg': seg, 'text': text, 'said': said,
                       'file': '%s/%s' % (lang, name), 'seconds': round(C.wav_seconds(path), 2), 'room': room, 'seed': seed,
                       'time_s': secs, 'vram_mb': vram, 'device': eng.device, 'dtype': eng.dtype}
                keep[(lang, eng.name, voice + vtag, n)] = row
                log('%s: %.1f s of audio in %.1f s%s' % (name, row['seconds'], secs, vram_text(vram)))
                man['rows'] = sorted(keep.values(), key=lambda r: (LANGS.index(r['lang']), r['n'], r['engine'], r['voice']))
                write_json(mpath, man)
    man['rows'] = sorted(keep.values(), key=lambda r: (LANGS.index(r['lang']), r['n'], r['engine'], r['voice']))
    man.setdefault('engines', {})[eng.name] = eng.info()
    write_json(mpath, man)
    return write_listen(work, log)


def write_listen(work, log=print):
    """listen.md and listen.html: for each language and paragraph, what to listen for and the files of every engine and
    voice made so far, side by side, with the time and the GPU memory of each."""
    base = os.path.join(work, 'tts', 'sample')
    man = read_json(os.path.join(base, 'manifest.json'), {'rows': []})
    md, h = ['# 声のサンプルの聞き比べ', '', 'ファイルは `%s` の中です。段落ごとに、下の「聞く所」を注意して聞いてください。' % base, ''], []
    h.append('<!doctype html><meta charset="utf-8"><title>QCalc voices</title><style>body{font-family:sans-serif;max-width:60rem;margin:auto;padding:1rem}'
             'td,th{border-bottom:1px solid #ccc;padding:.3rem;vertical-align:top}audio{width:16rem}</style><h1>声のサンプルの聞き比べ</h1>')
    for lang in LANGS:
        rows = [r for r in man['rows'] if r['lang'] == lang]
        if not rows:
            continue
        md += ['## %s' % lang, '']
        h.append('<h2>%s</h2>' % lang)
        for n in sorted(set(r['n'] for r in rows)):
            rs = [r for r in rows if r['n'] == n]
            r0 = rs[0]
            what = listen_for(lang, r0['text'])
            md += ['### 段落 %d（%s の %d 番目の場面、%.1f 秒の枠）' % (n, r0['video'], r0['seg'], r0['room']), '', '> ' + r0['text'], '']
            md += ['- 聞く所：%s' % ('／'.join('%s（%s）' % w for w in what) if what else '自然さ・速さ')]
            if r0['said'] != r0['text']:
                md += ['- 読ませた文（tts-readings.json で変えたもの）：%s' % r0['said']]
            md += ['', '| エンジン | 声 | ファイル | 長さ | 作った時間 | GPU メモリ |', '| --- | --- | --- | --- | --- | --- |']
            h.append('<h3>段落 %d（%s・%d、枠 %.1f 秒）</h3><p>%s</p><p>聞く所：%s</p><table><tr><th>エンジン</th><th>声</th><th></th><th>長さ</th><th>時間</th><th>GPU</th></tr>'
                     % (n, html.escape(r0['video']), r0['seg'], r0['room'], html.escape(r0['text']),
                        html.escape('／'.join('%s（%s）' % w for w in what) if what else '自然さ・速さ')))
            for r in sorted(rs, key=lambda r: (r['engine'], r['voice'])):
                fit = '' if r['seconds'] <= r['room'] * (1.35 if lang == 'ja' else 1.5) else '（枠に入らない）'
                vr = '%d MB' % r['vram_mb'] if r.get('vram_mb') is not None else 'CPU'
                md.append('| %s | %s | `%s` | %.1f 秒%s | %.1f 秒 | %s |' % (r['engine'], r['voice'], r['file'], r['seconds'], fit, r['time_s'], vr))
                h.append('<tr><td>%s</td><td>%s</td><td><audio controls preload="none" src="%s"></audio></td><td>%.1f 秒%s</td><td>%.1f 秒</td><td>%s</td></tr>'
                         % (r['engine'], r['voice'], html.escape(r['file']), r['seconds'], fit, r['time_s'], vr))
            md.append('')
            h.append('</table>')
    with open(os.path.join(base, 'listen.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    with open(os.path.join(base, 'listen.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(h) + '\n')
    log('listening lists: %s, listen.html' % os.path.join(base, 'listen.md'))
    return os.path.join(base, 'listen.md')


def parse_use(text, langs):
    """--use ja=irodori:female,en=qwen3:male or qwen3:female (every language) → {lang: (engine, voice)}."""
    out = {}
    for part in (text or '').split(','):
        part = part.strip()
        if not part:
            continue
        lang, eq, ev = part.partition('=')
        if not eq:
            lang, ev = None, part
        engine, _, voice = ev.partition(':')
        if engine not in ENGINES:
            raise SystemExit('unknown engine %s (%s)' % (engine, ', '.join(ENGINES)))
        voice = voice or ENGINES[engine].voices[0]
        if voice not in ENGINES[engine].voices:
            raise SystemExit('%s has the voices %s' % (engine, ', '.join(ENGINES[engine].voices)))
        for l in ([lang] if lang else langs):
            if l not in LANGS:
                raise SystemExit('unknown language %s' % l)
            if l not in ENGINES[engine].langs:
                raise SystemExit('%s cannot read %s' % (engine, l))
            out[l] = (engine, voice)
    return out


def make_all(work, use, engines, voices, opt, readings, log=print, clock=time.time):
    """Every paragraph of each language in use with its engine and voice. engines: {name: Engine} (only those of this
    run's environment); the languages of other engines are left for their own runs."""
    base = os.path.join(work, 'voice-tts')
    os.makedirs(base, exist_ok=True)
    mpath = os.path.join(base, 'manifest.json')
    man = read_json(mpath, {'langs': {}, 'use': {}})
    seed0 = int(opt.get('seed') or C.DEFAULT_SEED)
    redo = C.parse_redo(opt.get('redo'))
    zips = []
    for lang in [l for l in LANGS if l in use]:
        engine, voice = use[lang]
        eng = engines.get(engine)
        if eng is None:
            log('%s: %s is made in its own environment (skipped here)' % (lang, engine))
            continue
        ref = ensure_voice(work, eng, voice, voices, opt.get('redesign'), log)
        old = {(e['video'], e['seg']): e for e in man['langs'].get(lang, []) if e.get('engine') == engine and e.get('voice') == voice
               and e.get('clone') == (eng.info().get('clone') if eng.file_tag() else None)}
        d = os.path.join(base, lang)
        os.makedirs(d, exist_ok=True)
        rows, items = [], C.paragraphs_of(lang)
        t_start, made, missing = clock(), 0, None
        plan = []
        for n, (video, k, start, room, text) in enumerate(items, 1):
            said = spoken(engine, lang, text, readings)
            prev = old.get((video, k))
            seed = prev['seed'] if prev and prev.get('said') == said and prev.get('seed') else seed0
            if n in redo.get(lang, ()):
                seed += REDO_STEP
            tag = eng.file_tag()
            parts = [engine, voice, said, seed, ref['id'] if ref else 'default'] + ([tag] if tag else [])
            key = hashlib.sha1(json.dumps(parts, ensure_ascii=False).encode('utf-8')).hexdigest()[:8]
            plan.append((n, video, k, start, room, text, said, seed, '%s-%s%s-%s-%02d-%s.wav' % (engine, voice, '-' + tag if tag else '', video, k, key), prev))
        missing = sum(1 for p in plan if not os.path.exists(os.path.join(d, p[8])))
        log('%s: %s %s, %d of %d paragraphs to make' % (lang, engine, voice, missing, len(plan)))
        for n, video, k, start, room, text, said, seed, name, prev in plan:
            path = os.path.join(d, name)
            secs, vram = (prev or {}).get('time_s'), (prev or {}).get('vram_mb')
            if not os.path.exists(path):
                pcm, sr, secs, vram = synth(eng, said, lang, ref, seed)
                C.write_wav(path, C.trim(pcm, sr), sr)
                made += 1
                left = (missing - made) * (clock() - t_start) / made
                log('%s %2d/%d (%s): %.1f s of audio in %.1f s%s; about %.0f min left' % (
                    lang, n, len(plan), video, C.wav_seconds(path), secs, vram_text(vram), left / 60))
            s = round(C.wav_seconds(path), 2)
            rows.append({'n': n, 'video': video, 'seg': k, 'start': start, 'room': room, 'text': text, 'said': said,
                         'file': '%s/%s' % (lang, name), 'seconds': s, 'seed': seed, 'fits': s <= room * (1.35 if lang == 'ja' else 1.5),
                         'engine': engine, 'voice': voice, 'time_s': secs, 'vram_mb': vram})
            if eng.file_tag():
                rows[-1]['clone'] = eng.info().get('clone')
        man['langs'][lang] = rows
        man['use'][lang] = '%s:%s' % (engine, voice)
        man.setdefault('engines', {})[engine] = eng.info()
        man['made'] = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
        write_json(mpath, man)
        for line in C.check(lang, rows):
            log(line)
        zpath = os.path.join(work, 'voice-tts-%s.zip' % lang)
        with zipfile.ZipFile(zpath + '.part', 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(mpath, 'voice-tts/manifest.json')
            for r in rows:
                z.write(os.path.join(base, r['file']), 'voice-tts/' + r['file'])
            for f in voice_paths(work, engine, voice):
                if os.path.exists(f):
                    z.write(f, 'tts/voices/' + os.path.basename(f))
        os.replace(zpath + '.part', zpath)
        zips.append(zpath)
        times = [r['time_s'] for r in rows if r.get('time_s') is not None]
        vrams = [r['vram_mb'] for r in rows if r.get('vram_mb') is not None]
        log('%s: %d paragraphs, %.1f s of audio, %.0f s to make%s → %s' % (lang, len(rows), sum(r['seconds'] for r in rows), sum(times),
                                                                          vram_text(max(vrams)) if vrams else '', os.path.basename(zpath)))
    return zips


# ---- the command line

OPTS = {'engine': None, 'voice': None, 'use': None, 'redo': None, 'device': 'auto', 'dtype': 'auto', 'qwen_size': '1.7b', 'qwen_clone': 'xvector', 'seed': str(C.DEFAULT_SEED),
        'ming_repo': None, 'irodori_model': None}
FLAGS = {'redesign', 'no_text_normalization'}


def options(argv):
    if not argv or argv[0] not in ('design', 'sample', 'all', 'listen'):
        raise SystemExit(__doc__.split('Usage:')[1].split('  design  makes')[0])
    cmd, pos, opt, i = argv[0], [], dict(OPTS), 1
    for f in FLAGS:
        opt[f] = False
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            k, eq, v = a[2:].replace('-', '_').partition('=')
            if k in FLAGS:
                opt[k] = True
            elif k in OPTS:
                if not eq:
                    i += 1
                    if i >= len(argv):
                        raise SystemExit('--%s needs a value' % k)
                    v = argv[i]
                opt[k] = v
            else:
                raise SystemExit('unknown option --%s' % k.replace('_', '-'))
        else:
            pos.append(a)
        i += 1
    if not pos:
        raise SystemExit('give the work folder (for example ~/qcalc-voice)')
    langs = pos[1].split(',') if len(pos) > 1 else list(LANGS)
    for l in langs:
        if l not in LANGS:
            raise SystemExit('unknown language %s (%s)' % (l, ','.join(LANGS)))
    return cmd, os.path.expanduser(pos[0]), langs, opt


def make_engine(name, opt):
    if name not in ENGINES:
        raise SystemExit('--engine wants one of %s' % ', '.join(ENGINES))
    return ENGINES[name](opt)


def main(argv=None, engines=None, log=print):
    cmd, work, langs, opt = options(sys.argv[1:] if argv is None else argv)
    readings = C.load_readings()
    voices = load_voices()
    if cmd == 'listen':
        write_listen(work, log)
        return 0
    if cmd == 'all':
        if not opt['use']:
            raise SystemExit('--use wants the engine and voice of each language, e.g. ja=irodori:female,en=qwen3:female')
        use = parse_use(opt['use'], langs)
        names = sorted(set(e for e, v in use.values()))
        if opt['engine']:
            names = [n for n in names if n == opt['engine']]
        if engines is None:
            # (the engines that this environment has; the others are made in their own environments)
            engines = {}
            for n in names:
                e = make_engine(n, opt)
                if e.available():
                    engines[n] = e
            if not engines:
                raise SystemExit('this environment has none of %s: activate the environment of one of them (TTS-ENGINES-ja.md)' % ', '.join(names))
        make_all(work, use, engines, voices, opt, readings, log)
        return 0
    if not opt['engine']:
        raise SystemExit('--engine wants one of %s' % ', '.join(ENGINES))
    eng = (engines or {}).get(opt['engine'])
    if eng is None:
        eng = make_engine(opt['engine'], opt)
        if not eng.available():
            raise SystemExit('this environment cannot import %s: activate the environment of %s first (TTS-ENGINES-ja.md)' % (eng.library, eng.name))
    wanted = opt['voice'].split(',') if opt['voice'] else list(eng.voices)
    for v in wanted:
        if v not in eng.voices:
            raise SystemExit('%s has the voices %s' % (eng.name, ', '.join(eng.voices)))
    if cmd == 'design':
        for v in wanted:
            ensure_voice(work, eng, v, voices, opt['redesign'], log)
        return 0
    make_sample(work, langs, eng, wanted, voices, opt, readings, log)
    return 0


if __name__ == '__main__':
    sys.exit(main())
