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
        self.assertEqual(t, 'One.\n<short pause>\nTwo.')


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
        self.assertNotIn(KEY, open(os.path.join(self.dir, 'rate.json')).read())

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


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg')
class VideoVoice(unittest.TestCase):
    """video_voice.py --engine gemini with a made-up synthesis: the narration of a short in its video."""
    def test_short(self):
        work = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(work, 'out', 'ja'))
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x112:r=30:d=16', '-c:v', 'libx264', '-preset', 'veryfast',
                            '-pix_fmt', 'yuv420p', os.path.join(work, 'out', 'ja', 'short-4-tank.mp4')], check=True)
            argv = sys.argv
            sys.argv = ['video_voice.py', work, 'ja', 'short-4-tank', '--engine', 'gemini']
            try:
                import video_voice as V
            finally:
                sys.argv = argv
            self.assertEqual(V.OPT['engine'], 'gemini')
            L = V.PLAN['langs']['ja']
            vids = [(s['name'], s['segments']) for s in L['shorts'] if s['name'] == 'short-4-tank']
            calls = []

            def fake(text, **kw):
                calls.append((text, kw))
                n = text.count(G.PAUSE) + 1
                return wav_bytes(pcm(sum(([2.0, 0.8] for _ in range(n)), [])[:-1]))
            made = V.gemini_voices('ja', vids, V.OPT, tts=fake)
            self.assertEqual(made, ['short-4-tank'])
            self.assertEqual(len(calls), 1)
            text, kw = calls[0]
            self.assertEqual(kw['model'], 'gemini-3.8-flash-tts')
            self.assertNotIn('⟳', text)
            self.assertIn('液面をドラッグすると量が変わります。', text)
            self.assertNotIn(kw['style'], text)
            out = os.path.join(work, 'out-voice', 'ja', 'short-4-tank.mp4')
            p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout.split()
            self.assertEqual(sorted(p), ['audio', 'video'])
            # the 3.1 model is refused before any request
            with self.assertRaises(G.TtsError):
                V.gemini_voices('ja', vids, dict(V.OPT, model='gemini-3.1-flash-tts-preview'), tts=fake)
            self.assertEqual(len(calls), 1)
        finally:
            shutil.rmtree(work)


if __name__ == '__main__':
    unittest.main()
