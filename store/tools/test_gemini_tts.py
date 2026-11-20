#!/usr/bin/env python3
"""Tests of store/tools/gemini_tts.py and video_voice.py --engine gemini, with made-up answers of the server
(no key and no network needed; a local HTTP server stands in for the API). Python standard library only
(ffmpeg for the last test, as video_voice.py needs it anyway).
Usage: python3 store/tools/test_gemini_tts.py [-v]
"""
import base64
import datetime
import http.server
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
import unittest.mock
import wave

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import gemini_tts as G  # noqa: E402

KEY = 'test-key-1234567890'


def pcm(seconds_on_off, rate=24000, amp=8000):
    """16-bit PCM: a tone for each 'on' length, silence for each 'off' length, alternating."""
    out = []
    for i, sec in enumerate(seconds_on_off):
        n = int(sec * rate)
        if i % 2 == 0:
            out += [int(amp * math.sin(2 * math.pi * 220 * k / rate)) for k in range(n)]
        else:
            out += [0] * n
    return struct.pack('<%dh' % len(out), *out)


def wav_bytes(raw, rate=24000):
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(raw)
    return b.getvalue()


def answer(data, mime='audio/wav'):
    block = {'type': 'audio', 'data': base64.b64encode(data).decode('ascii')}
    if mime:
        block['mime_type'] = mime
    return {'id': 'x', 'steps': [{'type': 'user_input'}, {'type': 'model_output', 'content': [block]}]}


class Clock:
    def __init__(self, t):
        self.t = t
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def utc(*a):
    return datetime.datetime(*a, tzinfo=datetime.timezone.utc)


class Models(unittest.TestCase):
    def test_models(self):
        self.assertEqual(G.DEFAULT_MODEL, 'gemini-3.8-flash-tts')
        self.assertEqual(G.check_model('gemini-3.8-flash-lite-tts'), 'gemini-3.8-flash-lite-tts')
        with self.assertRaises(G.TtsError):
            G.check_model('gemini-3.1-flash-tts-preview')
        with self.assertRaises(G.TtsError):
            G.check_model('gemini-2.5-flash-preview-tts')

    def test_request_body(self):
        b = G.request_body('gemini-3.8-flash-tts', 'こんにちは。', voice='Puck', style='bright and warm')
        self.assertEqual(b['model'], 'gemini-3.8-flash-tts')
        item = b['input'][0]['content'][0]
        self.assertEqual(b['input'][0]['type'], 'user_input')
        # the text is only the words to be read; how to read is in speech_metadata
        self.assertEqual(item, {'type': 'text', 'text': 'こんにちは。', 'annotations': [{'type': 'speech_metadata', 'style': 'bright and warm'}]})
        self.assertEqual(b['response_format'], {'type': 'audio'})
        self.assertEqual(b['generation_config'], {'speech_config': [{'voice': 'Puck'}]})
        self.assertNotIn('bright', item['text'])

    def test_transcript_has_only_narration_and_pauses(self):
        t = G.transcript(['One.', 'Two.'])
        # the documented tag for a long pause, once (stacking tags is not documented)
        self.assertEqual(t, 'One.\n<long pause>\nTwo.')
        self.assertEqual(t.count('<'), 1)


class Formats(unittest.TestCase):
    def test_wav_as_it_comes(self):
        w = wav_bytes(pcm([0.2]))
        data, mime = G.audio_of(answer(w))
        out = G.to_wav(data, mime)
        self.assertEqual(out, w)
        self.assertEqual(out.count(b'RIFF'), 1)  # no second header

    def test_wav_without_mime(self):
        w = wav_bytes(pcm([0.2]))
        self.assertEqual(G.to_wav(*G.audio_of(answer(w, mime=None))), w)

    def test_l16_wrapped(self):
        raw = pcm([0.3], rate=16000)
        out = G.to_wav(*G.audio_of(answer(raw, 'audio/l16; rate=16000')))
        with wave.open(io.BytesIO(out)) as r:
            self.assertEqual((r.getnchannels(), r.getsampwidth(), r.getframerate()), (1, 2, 16000))
            self.assertEqual(r.readframes(r.getnframes()), raw)

    def test_l16_default_rate(self):
        out = G.to_wav(pcm([0.1]), 'audio/l16')
        with wave.open(io.BytesIO(out)) as r:
            self.assertEqual(r.getframerate(), 24000)

    def test_wav_claimed_without_header(self):
        with self.assertRaises(G.TtsError):
            G.to_wav(pcm([0.1]), 'audio/wav')

    def test_last_audio_block(self):
        a = answer(wav_bytes(pcm([0.1])))
        last = wav_bytes(pcm([0.2]))
        a['steps'][1]['content'].append({'type': 'audio', 'mime_type': 'audio/wav', 'data': base64.b64encode(last).decode()})
        self.assertEqual(G.audio_of(a)[0], last)

    def test_no_audio(self):
        with self.assertRaises(G.TtsError):
            G.audio_of({'steps': [{'type': 'model_output', 'content': [{'type': 'text', 'text': 'no'}]}]})


class Reset(unittest.TestCase):
    def test_winter_17(self):
        r = G.next_reset(utc(2026, 11, 20, 3, 0))  # 12:00 in Japan
        self.assertEqual(r.strftime('%Y-%m-%d %H:%M'), '2026-11-20 17:00')
        r = G.next_reset(utc(2026, 11, 20, 9, 0))  # 18:00 in Japan, after the reset
        self.assertEqual(r.strftime('%Y-%m-%d %H:%M'), '2026-11-21 17:00')

    def test_summer_16(self):
        self.assertEqual(G.next_reset(utc(2026, 7, 1, 3, 0)).strftime('%Y-%m-%d %H:%M'), '2026-07-01 16:00')

    def test_rule_without_zoneinfo(self):
        import zoneinfo
        real = zoneinfo.ZoneInfo
        try:
            zoneinfo.ZoneInfo = None  # the fallback rule
            self.assertEqual(G.next_reset(utc(2026, 11, 20, 3, 0)).strftime('%H:%M'), '17:00')
            self.assertEqual(G.next_reset(utc(2026, 7, 1, 3, 0)).strftime('%H:%M'), '16:00')
            self.assertEqual(G.pacific_day(utc(2026, 11, 20, 7, 59)), '2026-11-19')
            self.assertEqual(G.pacific_day(utc(2026, 11, 20, 8, 0)), '2026-11-20')
        finally:
            zoneinfo.ZoneInfo = real

    def test_message(self):
        m = G.daily_message('gemini-3.8-flash-tts', G.next_reset(utc(2026, 11, 20, 3, 0)))
        self.assertIn('17:00', m)
        self.assertIn('gemini-3.8-flash-lite-tts', m)


class Tokens(unittest.TestCase):
    def test_estimate_counts_high(self):
        self.assertGreaterEqual(G.estimate_tokens('液面をドラッグすると量が変わります。'), 18)
        self.assertGreaterEqual(G.estimate_tokens('Drag the level, and the amount follows.'), 13)

    def test_split_between_paragraphs(self):
        paras = ['あ' * 900 for _ in range(20)]  # about 18,000 tokens in all
        groups = G.split_paragraphs(paras)
        self.assertGreater(len(groups), 2)
        self.assertEqual([i for g in groups for i in g], list(range(20)))  # in order, none cut or lost
        for g in groups:
            self.assertLessEqual(G.estimate_tokens(G.transcript([paras[i] for i in g])), G.TOKENS_PER_REQUEST)
            self.assertLessEqual(G.estimate_tokens(G.transcript([paras[i] for i in g])), G.TOKENS_PER_MINUTE)

    def test_paragraph_too_long(self):
        with self.assertRaises(G.TtsError):
            G.split_paragraphs(['あ' * 9000])

    def test_each_language_of_the_plan_fits(self):
        """The narration of all the videos of each language: how many requests it takes (one when it fits)."""
        import video_plan
        for lang, L in video_plan.PLAN['langs'].items():
            segs = L['promo'] + L['youtube'] + [s for sh in L['shorts'] for s in sh['segments']]
            paras = [' '.join(s['lines']) for s in segs if s['lines']]
            groups = G.split_paragraphs(paras, extra=G.estimate_tokens(G.DEFAULT_STYLE))
            total = G.estimate_tokens(G.transcript(paras))
            self.assertEqual(len(groups), 1, '%s: %d tokens' % (lang, total))
            self.assertLess(total, G.REQUEST_BUDGET)


class Rate(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.clock = Clock(utc(2026, 11, 20, 3, 0).timestamp())
        self.rate = G.Rate(os.path.join(self.dir, 'rate.json'), clock=self.clock, sleep=self.clock.sleep, log=lambda *a: None)

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_three_a_minute(self):
        for _ in range(3):
            self.rate.wait_turn(G.DEFAULT_MODEL, 100)
            self.rate.count(G.DEFAULT_MODEL, 100)
        self.assertEqual(self.clock.slept, [])
        self.rate.wait_turn(G.DEFAULT_MODEL, 100)
        self.assertEqual(len(self.clock.slept), 1)
        self.assertGreaterEqual(self.clock.slept[0], 59)

    def test_tokens_a_minute(self):
        for _ in range(2):
            self.rate.wait_turn(G.DEFAULT_MODEL, 4500)
            self.rate.count(G.DEFAULT_MODEL, 4500)
        self.rate.wait_turn(G.DEFAULT_MODEL, 4500)  # 13,500 > 10,000 in a minute
        self.assertEqual(len(self.clock.slept), 1)

    def test_ten_a_day_then_the_spare(self):
        for _ in range(10):
            self.rate.wait_turn(G.DEFAULT_MODEL, 100)
            self.rate.count(G.DEFAULT_MODEL, 100)
            self.clock.t += 61
        with self.assertRaises(G.DailyLimit) as c:
            self.rate.wait_turn(G.DEFAULT_MODEL, 100)
        self.assertIn('17:00', str(c.exception))
        self.rate.wait_turn('gemini-3.8-flash-lite-tts', 100)  # its own count
        # kept in the file
        again = G.Rate(os.path.join(self.dir, 'rate.json'), clock=self.clock, sleep=self.clock.sleep)
        self.assertEqual(again.used_today(G.DEFAULT_MODEL), 10)
        # the next Pacific day (after 17:00 in Japan) starts again
        self.clock.t = utc(2026, 11, 20, 8, 1).timestamp()
        self.assertEqual(again.used_today(G.DEFAULT_MODEL), 0)


class Server(unittest.TestCase):
    """synthesize() against a local HTTP server standing in for the API."""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.seen = []
        self.replies = []
        test = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.seen.append({'path': self.path, 'key': self.headers.get('x-goog-api-key'), 'body': body})
                code, reply = test.replies.pop(0)
                data = json.dumps(reply).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass
        self.httpd = http.server.HTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = 'http://127.0.0.1:%d/v1beta/interactions' % self.httpd.server_port
        self.clock = Clock(utc(2026, 11, 20, 3, 0).timestamp())
        self.logs = []
        self.rate = G.Rate(os.path.join(self.dir, 'rate.json'), clock=self.clock, sleep=self.clock.sleep, log=self.logs.append)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.dir)

    def run_tts(self, text='Hello.', **kw):
        return G.synthesize(text, key=KEY, rate=self.rate, url=self.url, cache_dir=os.path.join(self.dir, 'cache'), log=self.logs.append, **kw)

    def test_request_and_cache(self):
        w = wav_bytes(pcm([0.2]))
        self.replies.append((200, answer(w)))
        self.assertEqual(self.run_tts(style='calm'), w)
        s = self.seen[0]
        self.assertEqual(s['path'], '/v1beta/interactions')
        self.assertEqual(s['key'], KEY)
        self.assertEqual(s['body']['model'], 'gemini-3.8-flash-tts')
        self.assertEqual(s['body']['input'][0]['content'][0]['annotations'][0], {'type': 'speech_metadata', 'style': 'calm'})
        # the same request again: from the cache, no request and no count
        self.assertEqual(self.run_tts(style='calm'), w)
        self.assertEqual(len(self.seen), 1)
        self.assertEqual(self.rate.used_today(G.DEFAULT_MODEL), 1)

    def test_lite_model(self):
        self.replies.append((200, answer(pcm([0.1]), 'audio/l16')))
        out = self.run_tts(model='gemini-3.8-flash-lite-tts')
        self.assertEqual(self.seen[0]['body']['model'], 'gemini-3.8-flash-lite-tts')
        self.assertTrue(G.is_wav(out))

    def test_minute_limit_then_ok(self):
        err = {'error': {'code': 429, 'status': 'RESOURCE_EXHAUSTED', 'message': 'Quota exceeded',
                         'details': [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]},
                                     {'@type': 'type.googleapis.com/google.rpc.RetryInfo', 'retryDelay': '17s'}]}}
        w = wav_bytes(pcm([0.1]))
        self.replies += [(429, err), (200, answer(w))]
        self.assertEqual(self.run_tts(), w)
        self.assertIn(17.0, self.clock.slept)

    def test_day_limit(self):
        err = {'error': {'code': 429, 'status': 'RESOURCE_EXHAUSTED', 'message': 'Quota exceeded',
                         'details': [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}}
        self.replies.append((429, err))
        with self.assertRaises(G.DailyLimit) as c:
            self.run_tts()
        self.assertIn('2026-11-20 17:00', str(c.exception))
        # counted as full here, so the next try does not ask the server
        with self.assertRaises(G.DailyLimit):
            self.run_tts('Another text.')
        self.assertEqual(len(self.seen), 1)

    def test_bad_request_not_retried(self):
        self.replies.append((400, {'error': {'code': 400, 'message': 'Invalid JSON payload'}}))
        with self.assertRaises(G.TtsError) as c:
            self.run_tts()
        self.assertIn('Invalid JSON payload', str(c.exception))
        self.assertEqual(len(self.seen), 1)

    def test_key_never_shown(self):
        err = {'error': {'code': 403, 'status': 'PERMISSION_DENIED', 'message': 'denied'}}
        self.replies.append((403, err))
        with self.assertRaises(G.TtsError) as c:
            self.run_tts()
        self.assertNotIn(KEY, str(c.exception))
        self.assertFalse(any(KEY in str(l) for l in self.logs))
        with open(os.path.join(self.dir, 'rate.json')) as f:
            self.assertNotIn(KEY, f.read())

    def test_key_from_environment(self):
        self.assertEqual(G.api_key({'GEMINI_API_KEY': ' abc '}), 'abc')
        self.assertEqual(G.api_key({'GOOGLE_API_KEY': 'def'}), 'def')
        with self.assertRaises(G.TtsError):
            G.api_key({})

    def test_too_long_for_one_request(self):
        with self.assertRaises(G.TtsError):
            self.run_tts('あ' * 9000)
        self.assertEqual(self.seen, [])


class Cut(unittest.TestCase):
    def test_cut_at_the_long_pauses(self):
        # 3 paragraphs: the first of two sentences with a short pause inside (tone, silence, tone, …)
        raw = pcm([1.0, 0.15, 0.8, 0.7, 1.2, 0.7, 0.6, 0.3])
        s, r = G.read_pcm(wav_bytes(raw))
        got = G.cut_at_pauses(s, r, 3)
        self.assertEqual(len(got), 3)
        lens = [len(p) / r for p in got]
        self.assertAlmostEqual(lens[0], 1.0 + 0.15 + 0.8, delta=0.15)
        self.assertAlmostEqual(lens[1], 1.2, delta=0.15)
        self.assertAlmostEqual(lens[2], 0.6, delta=0.15)

    def test_not_enough_pauses(self):
        s, r = G.read_pcm(wav_bytes(pcm([1.0, 0.1, 1.0])))
        self.assertIsNone(G.cut_at_pauses(s, r, 3))


def speech_for(text, per_char=0.12, gap=0.9, inner=None):
    """A made-up answer for a transcript: one tone for each paragraph, as long as its text (per_char seconds a
    character), a silence of gap seconds between paragraphs; inner = (paragraph, silence) puts a pause inside one."""
    import re as _re
    paras = [p.strip() for p in text.split(G.PAUSE)]
    seq = [0.2]
    for k, p in enumerate(paras):
        n = len(_re.sub(r'\s+', '', p))
        on = max(0.3, n * per_char)
        if inner and inner[0] == k:
            seq += [on / 2, inner[1], on / 2]
        else:
            seq += [on]
        seq.append(gap if k + 1 < len(paras) else 0.3)
    # pcm() starts with a tone: begin with a tiny tone of zero length
    return wav_bytes(pcm([0.0] + seq))


class FakeTime:
    def __init__(self, t):
        self.t = t
        self.slept = []

    def time(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


class Mock:
    """A stand-in for the server (post_json): answers made from the transcript, or the given replies."""
    def __init__(self, replies=None, **speech):
        self.calls, self.replies, self.speech = [], list(replies or []), speech

    def __call__(self, url, body, key):
        self.calls.append(body)
        if self.replies:
            r = self.replies.pop(0)
            if r is not None:
                return r[0], r[1], json.dumps(r[1])
        text = body['input'][0]['content'][0]['text']
        return 200, answer(speech_for(text, **self.speech)), ''


def no_ffmpeg(*a, **k):
    raise AssertionError('ffmpeg (or another program) was run: %r' % (a[0][:1],))


_V = None


def video_voice():
    global _V
    if _V is None:
        argv = sys.argv
        sys.argv = ['video_voice.py', tempfile.gettempdir(), 'ja']
        try:
            import video_voice as V
        finally:
            sys.argv = argv
        _V = V
    return _V


class Options(unittest.TestCase):
    def test_options(self):
        V = video_voice()
        self.assertEqual(V.options(['w', '--sample'])[1]['sample'], 3)
        self.assertEqual(V.options(['w', '--sample', '5', 'ja'])[0], ['w', 'ja'])
        self.assertEqual(V.options(['w', '--sample=2'])[1]['sample'], 2)
        o = V.options(['w', 'ja,en', '--synth-only', '--voice', 'Achird'])[1]
        self.assertEqual((o['engine'], o['synth-only'], o['voice']), ('gemini', True, 'Achird'))
        with self.assertRaises(SystemExit):
            V.options(['w', '--sample', '--synth-only'])
        with self.assertRaises(SystemExit):
            V.options(['w', '--sample=0'])


class CacheName(unittest.TestCase):
    def test_name(self):
        n = G.cache_name('gemini-3.8-flash-tts', 'Achird', G.DEFAULT_STYLE, 'こんにちは。')
        self.assertRegex(n, r'^gemini-3\.8-flash-tts-Achird-s[0-9a-f]{8}-t[0-9a-f]{16}\.wav$')
        self.assertEqual(n, G.cache_name('gemini-3.8-flash-tts', 'Achird', G.DEFAULT_STYLE, 'こんにちは。'))
        others = {G.cache_name('gemini-3.8-flash-lite-tts', 'Achird', G.DEFAULT_STYLE, 'こんにちは。'),
                  G.cache_name('gemini-3.8-flash-tts', 'Kore', G.DEFAULT_STYLE, 'こんにちは。'),
                  G.cache_name('gemini-3.8-flash-tts', 'Achird', 'warm', 'こんにちは。'),
                  G.cache_name('gemini-3.8-flash-tts', 'Achird', G.DEFAULT_STYLE, 'こんばんは。')}
        self.assertEqual(len(others), 4)
        self.assertNotIn(n, others)


class Lengths(unittest.TestCase):
    def test_even_speech_passes(self):
        texts = ['あいうえおかきくけこ', 'さしすせそ' * 3, 'たちつてと']
        s, r = G.read_pcm(speech_for(G.transcript(texts)))
        got = G.cut_at_pauses(s, r, 3)
        self.assertEqual(len(G.check_lengths(got, r, texts)), 3)

    def test_pause_inside_a_sentence(self):
        # a pause inside paragraph 1 (a comma) longer than those between paragraphs: the cut lands inside it, and
        # paragraph 2 takes the second half of paragraph 1 with it
        texts = ['あ' * 20, 'い' * 10, 'う' * 10, 'え' * 10]
        s, r = G.read_pcm(speech_for(G.transcript(texts), gap=0.6, inner=(0, 1.0)))
        got = G.cut_at_pauses(s, r, 4)
        self.assertIsNotNone(got)
        with self.assertRaises(G.TtsError) as c:
            G.check_lengths(got, r, texts, ['ja promo', 'ja youtube', 'ja youtube', 'ja youtube'])
        self.assertIn('paragraph 2 (ja youtube)', str(c.exception))


class Modes(unittest.TestCase):
    """--sample, --synth-only and the run with the videos, with a mock of the server and a made-up clock."""
    def setUp(self):
        self.V = video_voice()
        self.work = tempfile.mkdtemp()
        self.V.WORK = self.work
        self.clock = FakeTime(utc(2026, 11, 20, 3, 0).timestamp())  # 12:00 in Japan
        self.patches = [unittest.mock.patch.object(G, 'time', self.clock)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.work)

    def tts(self, mock):
        def run(text, **kw):
            return G.synthesize(text, key=KEY, post=mock, log=lambda *a: None, **kw)
        return run

    def opt(self, **kw):
        o = {'engine': 'gemini', 'model': None, 'voice': None, 'style': None, 'sample': None, 'synth-only': False}
        o.update(kw)
        return o

    def test_sample(self):
        mock = Mock()
        with unittest.mock.patch.object(self.V.subprocess, 'run', no_ffmpeg):
            out = self.V.gemini_sample('ja', self.opt(sample=3, voice='Kore,Achird,Sulafat'), tts=self.tts(mock))
        self.assertEqual(len(mock.calls), 3)  # one request for each voice
        self.assertEqual([b['generation_config']['speech_config'][0]['voice'] for b in mock.calls], ['Kore', 'Achird', 'Sulafat'])
        for b in mock.calls:
            self.assertEqual(b['input'][0]['content'][0]['text'].count(G.PAUSE), 2)  # the first 3 paragraphs
        self.assertEqual([os.path.basename(p) for p in out], ['ja-gemini-3.8-flash-tts-%s.wav' % v for v in ('Kore', 'Achird', 'Sulafat')])
        for p in out:
            self.assertTrue(G.is_wav(open(p, 'rb').read()))
            self.assertEqual(os.path.dirname(p), os.path.join(self.work, 'voice-gemini', 'sample'))

    def test_synth_only_then_the_videos_from_the_cache(self):
        # 1. elsewhere (no videos, no ffmpeg): every paragraph of ja and en, one request a language, and the zip
        mock = Mock()
        with unittest.mock.patch.object(self.V.subprocess, 'run', no_ffmpeg):
            zpath, done, err = self.V.gemini_synth_only(['ja', 'en'], self.opt(voice='Achird'), tts=self.tts(mock),
                                                        today=datetime.datetime(2026, 11, 20, 12, tzinfo=G.JST))
        self.assertIsNone(err)
        self.assertEqual(done, ['ja', 'en'])
        self.assertEqual(len(mock.calls), 2)
        self.assertEqual(os.path.basename(zpath), 'voice-gemini-20261120.zip')
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            names = z.namelist()
            man = json.loads(z.read('voice-gemini/manifest.json'))
        self.assertNotIn('voice-gemini/rate.json', names)
        cached = sorted(n for n in names if n.startswith('voice-gemini/cache/'))
        self.assertEqual(len(cached), 2)
        self.assertEqual(man['voice'], 'Achird')
        self.assertEqual(sum(len(v['files']) for v in man['langs'].values()), 2)
        # every paragraph of the plan is in the request, made or not
        ja_text = mock.calls[0]['input'][0]['content'][0]['text']
        self.assertEqual(ja_text.count(G.PAUSE) + 1, len(self.V.paragraphs_of('ja')))
        if not (shutil.which('ffmpeg') and shutil.which('ffprobe')):
            self.skipTest('ffmpeg')
        # 2. here: the zip unpacked into another work folder with all the videos of ja; no key, no request
        here = tempfile.mkdtemp()
        try:
            with zipfile.ZipFile(zpath) as z:
                z.extractall(here)
            os.makedirs(os.path.join(here, 'out', 'ja'))
            for name, segs in self.V.all_videos('ja'):
                d = sum(float(s['dur']) for s in segs)
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=2:d=%.2f' % d, '-c:v', 'libx264',
                                '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', os.path.join(here, 'out', 'ja', name + '.mp4')], check=True)
            self.V.WORK = here
            before = sorted(os.listdir(os.path.join(here, 'voice-gemini', 'cache')))
            refuse = Mock(replies=[(500, {'error': {'message': 'no request was to be sent'}})] * 5)
            env = {k: v for k, v in os.environ.items() if k not in ('GEMINI_API_KEY', 'GOOGLE_API_KEY')}
            with unittest.mock.patch.dict(os.environ, env, clear=True):
                made = self.V.gemini_voices('ja', self.V.all_videos('ja'), self.opt(voice='Achird'),
                                            tts=lambda text, **kw: G.synthesize(text, post=refuse, log=lambda *a: None, **kw))
            self.assertEqual(refuse.calls, [])  # every answer from the cache
            self.assertEqual(made, [n for n, _ in self.V.all_videos('ja')])
            self.assertEqual(sorted(os.listdir(os.path.join(here, 'voice-gemini', 'cache'))), before)
            self.assertEqual(before, sorted(os.path.basename(n) for n in cached))  # the files of the zip, no others
            for name in made:
                out = os.path.join(here, 'out-voice', 'ja', name + '.mp4')
                p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout.split()
                self.assertEqual(sorted(p), ['audio', 'video'])
        finally:
            shutil.rmtree(here)

    def test_a_wrong_cut_stops_and_asks_again_next_time(self):
        mock = Mock(gap=0.5, inner=(1, 1.4))
        with unittest.mock.patch.object(self.V.subprocess, 'run', no_ffmpeg):
            zpath, done, err = self.V.gemini_synth_only(['ja'], self.opt(), tts=self.tts(mock))
        self.assertEqual(done, [])
        self.assertIsInstance(err, G.TtsError)
        self.assertIn('looks wrong', str(err))
        cache = os.listdir(os.path.join(self.work, 'voice-gemini', 'cache'))
        self.assertTrue(cache and all(n.endswith('.rejected.wav') for n in cache))
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            self.assertFalse(any('/cache/' in n for n in z.namelist()))
        # the next run asks again (a good answer this time)
        mock2 = Mock()
        with unittest.mock.patch.object(self.V.subprocess, 'run', no_ffmpeg):
            _, done, err = self.V.gemini_synth_only(['ja'], self.opt(), tts=self.tts(mock2))
        self.assertEqual((done, err, len(mock2.calls)), (['ja'], None, 1))

    def test_daily_limit_keeps_what_was_made(self):
        day = {'error': {'code': 429, 'status': 'RESOURCE_EXHAUSTED', 'message': 'Quota exceeded',
                         'details': [{'@type': 'type.googleapis.com/google.rpc.QuotaFailure', 'violations': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}}
        mock = Mock(replies=[None, (429, day)])
        with unittest.mock.patch.object(self.V.subprocess, 'run', no_ffmpeg):
            zpath, done, err = self.V.gemini_synth_only(['ja', 'en', 'de'], self.opt(), tts=self.tts(mock))
        self.assertEqual(done, ['ja'])
        self.assertIsInstance(err, G.DailyLimit)
        self.assertIn('2026-11-20 17:00', str(err))
        import zipfile
        with zipfile.ZipFile(zpath) as z:
            self.assertEqual(len([n for n in z.namelist() if '/cache/' in n]), 1)

    def test_the_commands_of_the_guide(self):
        """The commands of TTS-GEMINI-ja.md through main(): --sample for 3 voices, then --synth-only for all 7 languages."""
        mock = Mock()
        V = self.V
        saved = (V.OPT, V.LANGS, V.ONLY)
        try:
            with unittest.mock.patch.object(G, 'post_json', mock), unittest.mock.patch.object(V.subprocess, 'run', no_ffmpeg), \
                    unittest.mock.patch.dict(os.environ, {'GEMINI_API_KEY': KEY}):
                pos, V.OPT = V.options([self.work, 'ja', '--sample', '3', '--voice', 'Kore,Achird,Sulafat'])
                V.LANGS, V.ONLY = pos[1].split(','), None
                self.assertEqual(V.main(), 0)
                self.assertEqual(len(mock.calls), 3)
                pos, V.OPT = V.options([self.work, '--synth-only', '--voice', 'Achird'])
                V.LANGS = list(V.PLAN['langs'])
                self.assertEqual(V.main(), 0)
            self.assertEqual(len(mock.calls), 3 + 7)  # 3 voices to compare, then one request a language
            self.assertGreaterEqual(len(self.clock.slept), 2)  # waited for the minute (3 a minute)
            zips = [f for f in os.listdir(self.work) if f.startswith('voice-gemini-') and f.endswith('.zip')]
            self.assertEqual(len(zips), 1)
            with open(os.path.join(self.work, 'voice-gemini', 'manifest.json'), encoding='utf-8') as f:
                self.assertEqual(sorted(json.load(f)['langs']), sorted(V.PLAN['langs']))
        finally:
            V.OPT, V.LANGS, V.ONLY = saved

    def test_the_3_1_model_is_refused(self):
        mock = Mock()
        with self.assertRaises(G.TtsError):
            self.V.gemini_sample('ja', self.opt(sample=3, model='gemini-3.1-flash-tts-preview'), tts=self.tts(mock))
        self.assertEqual(mock.calls, [])


if __name__ == '__main__':
    unittest.main()
