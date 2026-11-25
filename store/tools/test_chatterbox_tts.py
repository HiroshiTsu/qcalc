#!/usr/bin/env python3
"""Tests of chatterbox_tts.py with a made-up engine (no model, no network, no torch).
Usage: python3 store/tools/test_chatterbox_tts.py"""
import json
import math
import os
import sys
import tempfile
import unittest
import wave
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import chatterbox_tts as C  # noqa: E402

RATE = 24000


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def tone(seconds, silence_before=0.4, silence_after=0.6):
    """A 220 Hz tone with silence around it, as floats."""
    n0, n1, n2 = int(silence_before * RATE), int(seconds * RATE), int(silence_after * RATE)
    return [0.0] * n0 + [0.5 * math.sin(2 * math.pi * 220 * i / RATE) for i in range(n1)] + [0.0] * n2


class FakeEngine:
    """Speaks every character for 0.1 s (0.06 s in the Latin languages); remembers what it was asked."""

    def __init__(self, odd=None):
        self.calls, self.odd = [], odd or {}

    def say(self, text, lang, seed):
        self.calls.append((lang, text, seed))
        per = 0.1 if lang in ('ja', 'zh-TW', 'ko') else 0.06
        secs = self.odd.get((lang, text), len(text.replace(' ', '')) * per)
        return C.to_int16(tone(secs)), RATE


class Paragraphs(unittest.TestCase):
    def test_same_as_video_voice(self):
        # the paragraphs must be those of video_voice.py, or the narration would not match the videos
        with open(os.path.join(TOOLS, 'video_voice.py'), encoding='utf-8') as f:
            src = f.read()
        self.assertIn("sep.join(l.replace('⟳ ', '').strip() for l in lines).strip()", src)
        for lang in C.LANG_ID:
            items = C.paragraphs_of(lang)
            self.assertTrue(items, lang)
            for video, k, start, room, text in items:
                self.assertNotIn('⟳', text)
                self.assertGreater(room, 0)

    def test_every_language_has_an_id(self):
        self.assertEqual(sorted(C.LANG_ID), sorted(C.PLAN['langs']))
        self.assertEqual(C.LANG_ID['zh-TW'], 'zh')


class Audio(unittest.TestCase):
    def test_trim_keeps_the_sound(self):
        pcm = C.to_int16(tone(1.0))
        out = C.trim(pcm, RATE)
        secs = len(out) / 2 / RATE
        self.assertTrue(1.0 <= secs <= 1.15, secs)

    def test_trim_of_silence(self):
        pcm = C.to_int16([0.0] * RATE)
        self.assertEqual(C.trim(pcm, RATE), pcm)

    def test_to_int16_clips(self):
        import array
        a = array.array('h')
        a.frombytes(C.to_int16([2.0, -2.0, 0.0]))
        self.assertEqual(list(a), [32767, -32767, 0])


class Readings(unittest.TestCase):
    def test_longest_first(self):
        r = {'ja': [['km', 'キロ'], ['km/h', 'キロメートル毎時']]}
        self.assertEqual(C.spoken('ja', '60 km/h', r), '60 キロメートル毎時')
        self.assertEqual(C.spoken('en', '60 km/h', r), '60 km/h')


class Runs(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = []

    def tearDown(self):
        pass  # ((11-25) the folder of the test is left in the temporary directory: nothing is deleted, the owner's rule)

    def opt(self, **kw):
        o = {'sample': None, 'redo': None, 'device': 'cpu', 'voice': None, 'seed': '1234'}
        o.update(kw)
        return o

    def test_all_then_nothing_again(self):
        e = FakeEngine()
        zips = C.make_all(self.dir, ['ja', 'en'], self.opt(), e, {}, log=self.log.append)
        n = len(C.paragraphs_of('ja')) + len(C.paragraphs_of('en'))
        self.assertEqual(len(e.calls), n)
        self.assertEqual([os.path.basename(z) for z in zips], ['voice-chatterbox-ja.zip', 'voice-chatterbox-en.zip'])
        man = read_json(os.path.join(self.dir, 'voice-chatterbox', 'manifest.json'))
        rows = man['langs']['ja']
        self.assertEqual([r['n'] for r in rows], list(range(1, len(rows) + 1)))
        self.assertEqual([(r['video'], r['seg'], r['text']) for r in rows],
                         [(v, k, t) for v, k, s, room, t in C.paragraphs_of('ja')])
        with zipfile.ZipFile(zips[0]) as z:
            names = z.namelist()
        self.assertIn('voice-chatterbox/manifest.json', names)
        self.assertEqual(len(names), len(rows) + 1)
        # a second run makes nothing
        e2 = FakeEngine()
        C.make_all(self.dir, ['ja', 'en'], self.opt(), e2, {}, log=self.log.append)
        self.assertEqual(e2.calls, [])

    def test_wav_files(self):
        C.make_all(self.dir, ['ko'], self.opt(), FakeEngine(), {}, log=self.log.append)
        man = read_json(os.path.join(self.dir, 'voice-chatterbox', 'manifest.json'))
        for r in man['langs']['ko']:
            with wave.open(os.path.join(self.dir, 'voice-chatterbox', r['file'])) as w:
                self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, RATE))
            self.assertAlmostEqual(r['seconds'], len(r['said'].replace(' ', '')) * 0.1, delta=0.15)

    def test_redo_uses_another_seed_and_stays(self):
        C.make_all(self.dir, ['ja'], self.opt(), FakeEngine(), {}, log=self.log.append)
        e = FakeEngine()
        C.make_all(self.dir, ['ja'], self.opt(redo='ja:3'), e, {}, log=self.log.append)
        self.assertEqual(len(e.calls), 1)
        self.assertEqual(e.calls[0][2], 1234 + C.REDO_STEP)
        # the next run keeps the redone paragraph
        e2 = FakeEngine()
        C.make_all(self.dir, ['ja'], self.opt(), e2, {}, log=self.log.append)
        self.assertEqual(e2.calls, [])
        man = read_json(os.path.join(self.dir, 'voice-chatterbox', 'manifest.json'))
        self.assertEqual(man['langs']['ja'][2]['seed'], 1234 + C.REDO_STEP)

    def test_changed_reading_makes_only_that_paragraph(self):
        C.make_all(self.dir, ['ja'], self.opt(), FakeEngine(), {}, log=self.log.append)
        texts = [t for v, k, s, r, t in C.paragraphs_of('ja')]
        word = next(w for w in ('QCalc', '3D', '体積') if any(w in t for t in texts))
        e = FakeEngine()
        C.make_all(self.dir, ['ja'], self.opt(), e, {'ja': [[word, word + '！']]}, log=self.log.append)
        self.assertEqual(len(e.calls), sum(1 for t in texts if word in t))

    def test_check_names_an_odd_paragraph(self):
        texts = [t for v, k, s, r, t in C.paragraphs_of('en')]
        odd = {('en', texts[4]): 30.0}
        C.make_all(self.dir, ['en'], self.opt(), FakeEngine(odd), {}, log=self.log.append)
        self.assertTrue(any('check en:5 ' in l and '--redo en:5' in l for l in self.log), self.log)

    def test_sample_tricky(self):
        e = FakeEngine()
        made = C.make_sample(self.dir, ['ja'], self.opt(sample='tricky'), e, {}, log=self.log.append)
        self.assertTrue(0 < len(made) <= C.TRICKY_MAX)
        for lang, text, seed in e.calls:
            self.assertTrue(C.TRICKY.search(text), text)

    def test_sample_n(self):
        e = FakeEngine()
        C.make_sample(self.dir, ['es', 'de'], self.opt(sample='2'), e, {}, log=self.log.append)
        self.assertEqual([c[0] for c in e.calls], ['es', 'es', 'de', 'de'])

    def test_options(self):
        work, langs, opt = C.options(['~/w', 'ja,zh-TW', '--sample', 'tricky', '--device=cuda'])
        self.assertEqual((work, langs, opt['sample'], opt['device']), ('~/w', ['ja', 'zh-TW'], 'tricky', 'cuda'))
        with self.assertRaises(SystemExit):
            C.options(['~/w', 'xx'])
        with self.assertRaises(SystemExit):
            C.parse_redo('ja7')


if __name__ == '__main__':
    unittest.main(verbosity=1)
