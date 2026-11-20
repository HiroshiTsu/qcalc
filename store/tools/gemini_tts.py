#!/usr/bin/env python3
"""Speech synthesis with the Gemini API for the narration of the QCalc videos (store/tools/video_voice.py
--engine gemini). Python standard library only.

The model is gemini-3.8-flash-tts; gemini-3.8-flash-lite-tts is the spare (the same API, its own daily
count); --model chooses. gemini-3.1-flash-tts-preview is not used: its requests have another form.

How the 3.8 models are asked (Gemini API docs: the model page with the guide for moving from 3.1, and
the Text-to-speech guide; the Interactions API):

    POST https://generativelanguage.googleapis.com/v1beta/interactions
    x-goog-api-key: <key>
    {"model": "gemini-3.8-flash-tts",
     "input": [{"type": "user_input",
                "content": [{"type": "text", "text": "<the words to be read, and nothing else>",
                             "annotations": [{"type": "speech_metadata", "style": "<how to read>"}]}]}],
     "response_format": {"type": "audio"},
     "generation_config": {"speech_config": [{"voice": "Kore"}]}}

  - The text is read word for word: an instruction such as "read it brightly:" in the text would be read
    out too. How to speak goes into speech_metadata (its style); the text has only the narration, with
    the point-in-time tag <short pause> between paragraphs.
  - The audio is WAV by default (audio/wav, a RIFF header, 24 kHz, mono, 16-bit). It is written as it
    comes; a WAV header is added only to headerless PCM (audio/l16), never a second time. The format is
    decided by what comes back (the mime type and the first bytes).
  - The audio is in steps[] (type "model_output") → content[] (type "audio") → data (base64).

Limits of the free tier (checked by the owner in AI Studio): 3 requests a minute, 10 a day for each
model, 10,000 input tokens a minute; one request takes at most 8,192 input tokens (the model page). The
requests are counted here in a small file (rate.json in the work folder) so that the limits are kept
before the server refuses; the daily count starts again at midnight Pacific time (17:00 in Japan in
winter, 16:00 in summer), and that time is shown when the daily limit is reached. A narration longer
than one request is split between paragraphs. The answers are kept (cache/), so making a video again
does not use the quota again.

The key is read from the environment (GEMINI_API_KEY, or GOOGLE_API_KEY) and is never printed or written.
"""
import base64
import datetime
import hashlib
import io
import json
import os
import re
import struct
import time
import urllib.error
import urllib.request
import wave

MODELS = ('gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts')
DEFAULT_MODEL = MODELS[0]
REFUSED = ('gemini-3.1-flash-tts-preview',)
URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
PER_MINUTE = 3
PER_DAY = 10
TOKENS_PER_MINUTE = 10000
TOKENS_PER_REQUEST = 8192
# what one request may hold, by the estimate below (which counts high): under both limits, with room
REQUEST_BUDGET = 7000
PAUSE = '<short pause>'
DEFAULT_VOICE = 'Kore'
DEFAULT_STYLE = 'A calm, friendly and clear narrator introducing an app, at a natural, unhurried pace.'


class TtsError(Exception):
    pass


class DailyLimit(TtsError):
    """The daily count of a model is used up; .reset is when it starts again (an aware datetime, JST)."""
    def __init__(self, model, reset, source):
        self.model, self.reset, self.source = model, reset, source
        super().__init__(daily_message(model, reset))


# ---- the key

def api_key(env=None):
    env = os.environ if env is None else env
    k = (env.get('GEMINI_API_KEY') or env.get('GOOGLE_API_KEY') or '').strip()
    if not k:
        raise TtsError('No API key: set GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment.')
    return k


def check_model(model):
    if model in REFUSED:
        raise TtsError('%s is not used (its requests have another form); use %s or %s.' % (model, MODELS[0], MODELS[1]))
    if model not in MODELS:
        raise TtsError('Unknown model %s; use %s or %s.' % (model, MODELS[0], MODELS[1]))
    return model


# ---- when the daily count starts again: midnight in Los Angeles, shown in Japan

JST = datetime.timezone(datetime.timedelta(hours=9), 'JST')


def _pacific(utc):
    """The offset of Pacific time at a UTC moment: zoneinfo when the system has the zone, otherwise the US
    rule (summer time from the second Sunday of March 2:00 to the first Sunday of November 2:00)."""
    try:
        from zoneinfo import ZoneInfo
        return utc.astimezone(ZoneInfo('America/Los_Angeles')).utcoffset()
    except Exception:
        y = utc.year

        def sunday(month, n):
            d = datetime.datetime(y, month, 1)
            d += datetime.timedelta(days=(6 - d.weekday()) % 7)
            return d + datetime.timedelta(weeks=n - 1)
        start = sunday(3, 2) + datetime.timedelta(hours=10)   # 2:00 PST = 10:00 UTC
        end = sunday(11, 1) + datetime.timedelta(hours=9)     # 2:00 PDT = 9:00 UTC
        naive = utc.replace(tzinfo=None)
        return datetime.timedelta(hours=-7 if start <= naive < end else -8)


def pacific_day(now=None):
    """The Pacific date of a moment (the day the daily count belongs to), as 'YYYY-MM-DD'."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    utc = now.astimezone(datetime.timezone.utc)
    return (utc + _pacific(utc)).date().isoformat()


def next_reset(now=None):
    """The next midnight Pacific time, in JST."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    utc = now.astimezone(datetime.timezone.utc)
    local = utc + _pacific(utc)
    midnight = datetime.datetime.combine(local.date() + datetime.timedelta(days=1), datetime.time())
    # the offset at that midnight (it can differ on the night the clocks change)
    guess = midnight - _pacific(utc)
    off = _pacific(guess.replace(tzinfo=datetime.timezone.utc))
    return (midnight - off).replace(tzinfo=datetime.timezone.utc).astimezone(JST)


def daily_message(model, reset):
    return ('The daily limit of %s (%d requests a day) has been reached. It starts again at %s Japan time '
            '(midnight Pacific time). The spare model is %s (--model).' % (
                model, PER_DAY, reset.strftime('%Y-%m-%d %H:%M'), MODELS[1] if model == MODELS[0] else MODELS[0]))


# ---- tokens: an estimate that counts high (there is no counting endpoint for these models in the guide)

_WIDE = re.compile('[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]')


def estimate_tokens(text):
    wide = len(_WIDE.findall(text))
    rest = _WIDE.sub('', text)
    return wide + (len(rest) + 2) // 3 + 8


def split_paragraphs(paragraphs, budget=REQUEST_BUDGET, extra=0):
    """Paragraphs into groups whose text (paragraphs joined with pauses) stays within the budget; a
    paragraph is never cut. Returns lists of indexes."""
    groups, cur, used = [], [], extra
    for i, p in enumerate(paragraphs):
        t = estimate_tokens(p) + estimate_tokens(PAUSE)
        if t + extra > budget:
            raise TtsError('Paragraph %d alone is longer than one request (about %d tokens).' % (i + 1, t))
        if cur and used + t > budget:
            groups.append(cur)
            cur, used = [], extra
        cur.append(i)
        used += t
    if cur:
        groups.append(cur)
    return groups


def transcript(paragraphs):
    return ('\n%s\n' % PAUSE).join(p.strip() for p in paragraphs)


# ---- the request and the answer

def request_body(model, text, voice=DEFAULT_VOICE, style=DEFAULT_STYLE):
    item = {'type': 'text', 'text': text}
    if style:
        item['annotations'] = [{'type': 'speech_metadata', 'style': style}]
    return {'model': check_model(model), 'input': [{'type': 'user_input', 'content': [item]}],
            'response_format': {'type': 'audio'}, 'generation_config': {'speech_config': [{'voice': voice}]}}


def audio_of(answer):
    """(bytes, mime type) of the last audio block of an answer."""
    blocks = []
    for st in answer.get('steps') or []:
        if st.get('type') not in (None, 'model_output'):
            continue
        for c in st.get('content') or []:
            if c.get('type') == 'audio' and c.get('data'):
                blocks.append(c)
    if not blocks and isinstance(answer.get('output_audio'), dict):
        blocks.append(answer['output_audio'])
    if not blocks:
        raise TtsError('The answer has no audio.')
    b = blocks[-1]
    return base64.b64decode(b['data']), (b.get('mime_type') or b.get('mimeType') or '').lower()


def is_wav(data):
    return len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WAVE'


def to_wav(data, mime):
    """The audio as WAV bytes: WAV as it is (no second header); headerless 16-bit PCM (audio/l16) wrapped."""
    if is_wav(data):
        return data
    if mime.startswith('audio/wav') or mime.startswith('audio/x-wav'):
        raise TtsError('The answer says audio/wav but has no WAV header.')
    if mime.startswith('audio/l16') or mime.startswith('audio/pcm') or not mime:
        m = re.search(r'rate=(\d+)', mime)
        rate = int(m.group(1)) if m else 24000
        out = io.BytesIO()
        with wave.open(out, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(data)
        return out.getvalue()
    raise TtsError('Unsupported audio format %s (ask for audio/wav).' % mime)


def post_json(url, body, key, timeout=180):
    """POST JSON; returns (status, parsed JSON or None, raw text)."""
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode('utf-8')
            return r.status, json.loads(raw), raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try:
            j = json.loads(raw)
        except ValueError:
            j = None
        return e.code, j, raw


def quota_kind(err):
    """'day', ('minute', seconds) or None from the body of a 429 (QuotaFailure ids, RetryInfo)."""
    e = (err or {}).get('error') or {}
    ids, delay = [], None
    for d in e.get('details') or []:
        t = d.get('@type', '')
        if t.endswith('QuotaFailure'):
            for v in d.get('violations') or []:
                ids.append('%s %s' % (v.get('quotaId', ''), v.get('quotaMetric', '')))
        elif t.endswith('RetryInfo'):
            m = re.match(r'([\d.]+)s', str(d.get('retryDelay', '')))
            if m:
                delay = float(m.group(1))
    text = ' '.join(ids + [e.get('message') or '']).lower()
    if 'perday' in text or 'per day' in text or 'requests_per_day' in text:
        return 'day'
    if ids or delay is not None or 'perminute' in text or 'per minute' in text:
        return ('minute', delay if delay is not None else 60.0)
    return None


# ---- the local count of requests (rate.json)

class Rate:
    def __init__(self, path, clock=time.time, sleep=time.sleep, log=print):
        self.path, self.clock, self.sleep, self.log = path, clock, sleep, log
        try:
            with open(path, encoding='utf-8') as f:
                self.s = json.load(f)
        except (OSError, ValueError, TypeError):
            self.s = {}
        self.s.setdefault('recent', [])
        self.s.setdefault('days', {})

    def save(self):
        if self.path:
            os.makedirs(os.path.dirname(self.path) or '.', exist_ok=True)
            tmp = self.path + '.part'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.s, f)
            os.replace(tmp, self.path)

    def now_dt(self):
        return datetime.datetime.fromtimestamp(self.clock(), datetime.timezone.utc)

    def used_today(self, model):
        return self.s['days'].get(pacific_day(self.now_dt()), {}).get(model, 0)

    def mark_day_full(self, model):
        d = self.s['days'].setdefault(pacific_day(self.now_dt()), {})
        d[model] = max(d.get(model, 0), PER_DAY)
        self.save()

    def wait_turn(self, model, tokens):
        """Waits until one more request fits the minute; raises DailyLimit when the day is used up."""
        if self.used_today(model) >= PER_DAY:
            raise DailyLimit(model, next_reset(self.now_dt()), 'count')
        while True:
            now = self.clock()
            recent = [r for r in self.s['recent'] if now - r['t'] < 60 and r['model'] == model]
            n, tok = len(recent), sum(r['tokens'] for r in recent)
            if n < PER_MINUTE and tok + tokens <= TOKENS_PER_MINUTE:
                return
            first = min(r['t'] for r in recent)
            wait = max(1.0, 60 - (now - first) + 0.5)
            self.log('  waiting %.0f s (at most %d requests and %d input tokens a minute)' % (wait, PER_MINUTE, TOKENS_PER_MINUTE))
            self.sleep(wait)

    def count(self, model, tokens):
        now = self.clock()
        self.s['recent'] = [r for r in self.s['recent'] if now - r['t'] < 120] + [{'t': now, 'model': model, 'tokens': tokens}]
        day = self.s['days'].setdefault(pacific_day(self.now_dt()), {})
        day[model] = day.get(model, 0) + 1
        # only the last few days are kept
        for k in sorted(self.s['days'])[:-3]:
            del self.s['days'][k]
        self.save()


# ---- one narration

def synthesize(text, model=DEFAULT_MODEL, voice=DEFAULT_VOICE, style=DEFAULT_STYLE, key=None, rate=None,
               cache_dir=None, url=URL, post=post_json, log=print, tries=3):
    """WAV bytes of the text read by the model (from the cache when the same request was answered)."""
    check_model(model)
    tokens = estimate_tokens(text) + estimate_tokens(style or '')
    if tokens > TOKENS_PER_REQUEST:
        raise TtsError('The text is too long for one request (about %d tokens, at most %d); split it.' % (tokens, TOKENS_PER_REQUEST))
    body = request_body(model, text, voice, style)
    h = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()[:20]
    cached = os.path.join(cache_dir, '%s-%s.wav' % (model, h)) if cache_dir else None
    if cached and os.path.exists(cached):
        with open(cached, 'rb') as f:
            return f.read()
    key = key or api_key()
    rate = rate or Rate(None)
    for attempt in range(tries):
        rate.wait_turn(model, tokens)
        rate.count(model, tokens)
        status, ans, raw = post(url, body, key)
        if status == 200 and ans is not None:
            data, mime = audio_of(ans)
            wav = to_wav(data, mime)
            if cached:
                os.makedirs(cache_dir, exist_ok=True)
                with open(cached + '.part', 'wb') as f:
                    f.write(wav)
                os.replace(cached + '.part', cached)
            return wav
        if status == 429:
            kind = quota_kind(ans)
            if kind == 'day':
                rate.mark_day_full(model)
                raise DailyLimit(model, next_reset(rate.now_dt()), 'server')
            delay = kind[1] if kind else 60.0
            if attempt + 1 < tries:
                log('  429 from the server: trying again in %.0f s' % delay)
                rate.sleep(delay)
                continue
            # still refused after waiting a minute: most likely the day (the count here may be behind)
            rate.mark_day_full(model)
            raise DailyLimit(model, next_reset(rate.now_dt()), 'server')
        if status in (500, 502, 503, 504, 408) and attempt + 1 < tries:
            log('  %d from the server: trying again in %d s' % (status, 5 * (attempt + 1)))
            rate.sleep(5 * (attempt + 1))
            continue
        msg = ((ans or {}).get('error') or {}).get('message') or raw[:300]
        raise TtsError('The server answered %d: %s' % (status, msg))
    raise TtsError('No answer after %d tries.' % tries)


# ---- the audio of several paragraphs, cut at its pauses

def read_pcm(wav_bytes):
    with wave.open(io.BytesIO(wav_bytes)) as w:
        if w.getsampwidth() != 2:
            raise TtsError('Expected 16-bit audio.')
        ch, rate, frames = w.getnchannels(), w.getframerate(), w.readframes(w.getnframes())
    s = struct.unpack('<%dh' % (len(frames) // 2), frames)
    if ch > 1:
        s = [sum(s[i:i + ch]) // ch for i in range(0, len(s), ch)]
    return list(s), rate


def write_wav(path, samples, rate):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack('<%dh' % len(samples), *samples))


def cut_at_pauses(samples, rate, parts, min_gap=0.25):
    """Cuts speech of `parts` paragraphs at the parts − 1 longest silences (each at least min_gap seconds),
    in time order; returns the pieces with their silence trimmed, or None when there are not enough."""
    win = max(1, rate // 100)  # 10 ms
    rms = []
    for i in range(0, len(samples), win):
        c = samples[i:i + win]
        rms.append((sum(x * x for x in c) / max(1, len(c))) ** 0.5)
    if not rms:
        return None
    peak = sorted(rms)[int(len(rms) * 0.98)] if len(rms) > 50 else max(rms)
    quiet = max(peak * 0.03, 30.0)
    voiced = [i for i, v in enumerate(rms) if v > quiet]
    if not voiced:
        return None
    lo, hi = voiced[0], voiced[-1]
    gaps, run = [], None
    for i in range(lo, hi + 1):
        if rms[i] <= quiet:
            run = i if run is None else run
        elif run is not None:
            if (i - run) * win / rate >= min_gap:
                gaps.append((i - run, run, i))
            run = None
    if len(gaps) < parts - 1:
        return None
    chosen = sorted(sorted(gaps, reverse=True)[:parts - 1], key=lambda g: g[1])
    bounds = [lo] + [x for g in chosen for x in (g[1], g[2])] + [hi + 1]
    pieces = []
    for k in range(parts):
        a, b = bounds[2 * k], bounds[2 * k + 1]
        a = max(0, a - 3)
        b = min(len(rms), b + 5)
        pieces.append(samples[a * win:b * win])
    return pieces
