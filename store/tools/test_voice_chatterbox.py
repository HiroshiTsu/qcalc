#!/usr/bin/env python3
"""Tests of video_voice.py --engine chatterbox (and --engine tts, the subtitles at the times of the voice, video_render.py
--voice-cues): a small made-up manifest of chatterbox_tts.py with WAV files, put
into small videos (the tests that make videos are skipped when ffmpeg is not there). Python standard library only.
Usage: python3 store/tools/test_voice_chatterbox.py [-v]
"""
import io
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import wave

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
HAVE_FFMPEG = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))


def video_voice():
    argv = sys.argv
    sys.argv = ['video_voice.py', tempfile.gettempdir(), 'ja', '--engine', 'chatterbox']
    try:
        import video_voice as V
    finally:
        sys.argv = argv
    return V


def tone(path, seconds, rate=24000, level=6000):
    n = int(seconds * rate)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack('<%dh' % n, *(int(level * math.sin(2 * math.pi * 220 * k / rate)) for k in range(n))))


class Base(unittest.TestCase):
    VIDEOS = ('short-3-everyday', 'short-4-tank')

    def setUp(self):
        self.V = video_voice()
        self.work = tempfile.mkdtemp()
        self.V.WORK = self.work
        self.rows = []
        os.makedirs(os.path.join(self.work, 'voice-chatterbox', 'ja'))
        # the manifest as chatterbox_tts.py writes it: the paragraphs of the plan, in order, with their files
        for n, (video, k, start, room, text) in enumerate(self.V.paragraphs_seg('ja'), 1):
            if video not in self.VIDEOS:
                continue
            name = 'ja/%s-%02d-abcd1234.wav' % (video, k)
            secs = self.seconds(video, k, room)
            tone(os.path.join(self.work, 'voice-chatterbox', name), secs)
            self.rows.append({'n': n, 'video': video, 'seg': k, 'start': round(start, 3), 'room': round(room, 3), 'text': text,
                              'said': text, 'file': name, 'seconds': secs, 'seed': 1234, 'fits': secs <= room * 1.35})
        self.write()

    def seconds(self, video, k, room):
        # short-3-everyday segment 0: 16 s in 10.7 s (more than 1.35 times: still too long); short-4-tank: 18 s in
        # 15.7 s (1.15 times); the others fit
        return {('short-3-everyday', 0): 16.0, ('short-4-tank', 0): 18.0}.get((video, k), room - 1.0)

    def write(self, rows=None):
        man = {'engine': 'chatterbox-multilingual-v3', 'voice': 'default', 'langs': {'ja': rows if rows is not None else self.rows}}
        with open(os.path.join(self.work, 'voice-chatterbox', 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump(man, f, ensure_ascii=False)

    def videos(self, names=VIDEOS):
        os.makedirs(os.path.join(self.work, 'out', 'ja'), exist_ok=True)
        for name, segs in self.V.all_videos('ja'):
            if name in names:
                d = sum(float(s['dur']) for s in segs)
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=2:d=%.2f' % d, '-c:v', 'libx264',
                                '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', os.path.join(self.work, 'out', 'ja', name + '.mp4')], check=True)

    def vids(self):
        return [(n, s) for n, s in self.V.all_videos('ja') if n in self.VIDEOS]

    def tearDown(self):
        shutil.rmtree(self.work)


class Checks(Base):
    def test_paragraphs_seg_matches_paragraphs_of(self):
        a = [(v, s, r, t) for v, _k, s, r, t in self.V.paragraphs_seg('ja')]
        self.assertEqual(a, self.V.paragraphs_of('ja'))

    def test_a_changed_text_stops(self):
        rows = [dict(r) for r in self.rows]
        rows[1]['text'] = rows[1]['text'] + '（古い文）'
        self.write(rows)
        os.makedirs(os.path.join(self.work, 'out', 'ja'))
        for n in self.VIDEOS:
            open(os.path.join(self.work, 'out', 'ja', n + '.mp4'), 'wb').close()  # (never read: it stops before)
        with self.assertRaises(self.V.NarrationError) as c:
            self.V.chatterbox_voices('ja', self.vids())
        msg = str(c.exception)
        self.assertIn('short-3-everyday segment 1', msg)
        self.assertIn('paragraph %d' % rows[1]['n'], msg)
        self.assertFalse(os.path.exists(os.path.join(self.work, 'out-voice')))

    def test_no_manifest(self):
        os.remove(os.path.join(self.work, 'voice-chatterbox', 'manifest.json'))
        with self.assertRaises(self.V.NarrationError):
            self.V.chatterbox_manifest()

    def test_no_videos_made_yet(self):
        self.assertEqual(self.V.chatterbox_voices('ja', self.vids()), [])


@unittest.skipUnless(HAVE_FFMPEG, 'ffmpeg')
class Videos(Base):
    def test_placed_and_faster(self):
        self.videos()
        report = []
        made = self.V.chatterbox_voices('ja', self.vids(), report=report)
        self.assertEqual(made, list(self.VIDEOS))
        for n in self.VIDEOS:
            out = os.path.join(self.work, 'out-voice', 'ja', n + '.mp4')
            p = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout.split()
            self.assertEqual(sorted(p), ['audio', 'video'])
        # the two longer paragraphs, read faster: ja up to 1.35 times
        got = {(r[1], r[3]): r for r in report}
        self.assertEqual(sorted(got), [('short-3-everyday', 0), ('short-4-tank', 0)])
        self.assertEqual(got[('short-3-everyday', 0)][6], 1.35)
        self.assertTrue(got[('short-3-everyday', 0)][7])  # still too long
        self.assertAlmostEqual(got[('short-4-tank', 0)][6], 18.0 / 15.7, places=2)
        self.assertFalse(got[('short-4-tank', 0)][7])
        # the narration starts at the start of its paragraph (silence before it)
        track = os.path.join(self.work, 'voice-chatterbox', 'mix', 'ja', 'short-3-everyday', 'voice.wav')
        with wave.open(track) as w:
            rate = w.getframerate()
            first = struct.unpack('<%dh' % int(0.1 * rate), w.readframes(int(0.1 * rate)))
        self.assertEqual(max(abs(x) for x in first), 0)

    def test_the_track_of_a_faster_paragraph_ends(self):
        # the filter alone (no -t), with a paragraph read faster: before, apad,atrim after atempo never ended and the
        # track grew until the disk was full (-fs keeps this test from doing that)
        w = os.path.join(self.work, 'long.wav')
        tone(w, 16.0)
        ins, mix, info = self.V.track_filter('ja', [(w, 0.15, 10.7)], 22.0)
        self.assertEqual(info[0][2], 1.35)
        track = os.path.join(self.work, 'track.wav')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', mix, '-map', '[out]', '-fs', '20M', track],
                       timeout=120)
        with wave.open(track) as t:
            self.assertAlmostEqual(t.getnframes() / t.getframerate(), 22.0, places=2)

    def test_a_loud_voice_is_not_clipped(self):
        # the voices of Chatterbox are near full scale: the gain of 1.3 for the quiet voices clipped them
        loud, quiet = os.path.join(self.work, 'loud.wav'), os.path.join(self.work, 'quiet.wav')
        tone(loud, 2.0, level=32000)
        tone(quiet, 2.0)
        self.assertEqual(self.V.track_gain([quiet]), 1.3)
        self.assertLess(self.V.track_gain([quiet, loud]), 1.0)
        for files in ([loud], [quiet, loud]):
            ins, mix, _ = self.V.track_filter('en', [(w, 0.5 + 3 * k, 2.5) for k, w in enumerate(files)], 7.0)
            track = os.path.join(self.work, 'track.wav')
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', mix, '-map', '[out]', '-t', '7', track], check=True)
            with wave.open(track) as t:
                a = struct.unpack('<%dh' % t.getnframes(), t.readframes(t.getnframes()))
            self.assertLessEqual(max(abs(x) for x in a), int(0.9 * 32768))
            self.assertGreater(max(abs(x) for x in a), int(0.8 * 32768))

    def test_a_missing_paragraph_skips_only_that_video(self):
        self.videos()
        rows = [r for r in self.rows if not (r['video'] == 'short-3-everyday' and r['seg'] == 1)]
        self.write(rows)
        made = self.V.chatterbox_voices('ja', self.vids())
        self.assertEqual(made, ['short-4-tank'])
        self.assertFalse(os.path.exists(os.path.join(self.work, 'out-voice', 'ja', 'short-3-everyday.mp4')))

    def test_a_missing_file_skips_the_video(self):
        self.videos()
        os.remove(os.path.join(self.work, 'voice-chatterbox', self.rows[-1]['file']))  # short-4-tank's only paragraph
        self.assertEqual(self.V.chatterbox_voices('ja', self.vids()), ['short-3-everyday'])

    def test_a_missing_language(self):
        self.videos(('short-4-tank',))
        self.assertEqual(self.V.chatterbox_voices('en', [(n, s) for n, s in self.V.all_videos('en') if n == 'short-4-tank']), [])

    def test_main(self):
        self.videos()
        V = self.V
        saved = (V.OPT, V.LANGS, V.ONLY)
        try:
            V.OPT = V.options([self.work, 'ja', '--engine', 'chatterbox'])[1]
            V.LANGS, V.ONLY = ['ja'], list(self.VIDEOS)
            self.assertEqual(V.main(), 0)
        finally:
            V.OPT, V.LANGS, V.ONLY = saved
        self.assertTrue(os.path.exists(os.path.join(self.work, 'out-voice', 'ja', 'short-4-tank.mp4')))


def speech(path, parts, rate=24000):
    """A WAV of tones and silences: parts = [(seconds, loud)]."""
    frames = []
    for secs, loud in parts:
        n = int(secs * rate)
        frames += [int(6000 * math.sin(2 * math.pi * 220 * k / rate)) if loud else 0 for k in range(n)]
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack('<%dh' % len(frames), *frames))


class VoiceCues(Base):
    """The subtitles at the times of the voice (11-22): the pauses of the WAV between the lines of a paragraph."""

    def test_spans_at_the_pauses(self):
        w = os.path.join(self.work, 'p.wav')
        # 0.2 s quiet, line 1 for 2.0 s, a pause of 0.5 s, line 2 for 1.0 s with a short breath of 0.05 s in it, a pause of
        # 0.4 s, line 3 for 1.5 s, 0.3 s quiet
        speech(w, [(0.2, 0), (2.0, 1), (0.5, 0), (0.5, 1), (0.05, 0), (0.5, 1), (0.4, 0), (1.5, 1), (0.3, 0)])
        spans, found = self.V.speech_spans(w, [10, 5, 7])
        self.assertEqual(found, 2)
        want = [(0.2, 2.2), (2.7, 3.75), (4.15, 5.65)]
        for (a, b), (c, d) in zip(spans, want):
            self.assertAlmostEqual(a, c, delta=0.03)
            self.assertAlmostEqual(b, d, delta=0.03)

    def test_spans_without_a_pause_follow_the_lengths(self):
        w = os.path.join(self.work, 'p.wav')
        speech(w, [(3.0, 1)])
        spans, found = self.V.speech_spans(w, [1, 2])
        self.assertEqual(found, 0)
        self.assertAlmostEqual(spans[0][1], 1.0, delta=0.03)
        self.assertAlmostEqual(spans[1][0], 1.0, delta=0.06)

    def test_cues_follow_the_voice_and_speed(self):
        segs = [{'dur': 10, 'lines': ['one two three four', 'five six']}, {'dur': 4, 'lines': []}]
        w = os.path.join(self.work, 'p.wav')
        speech(w, [(0.1, 0), (3.0, 1), (0.6, 0), (2.0, 1), (0.2, 0)])
        cues, found, bounds = self.V.voice_cues('en', segs, {0: (w, 0.15, 9.7)})
        self.assertEqual((found, bounds), (1, 1))
        (a1, b1, l1), (a2, b2, l2) = cues
        self.assertEqual((l1, l2), ('one two three four', 'five six'))
        self.assertAlmostEqual(a1, 0.15 + 0.1 - 0.15, delta=0.03)   # 0.15 s before the voice
        self.assertAlmostEqual(a2, 0.15 + 3.7 - 0.12, delta=0.03)   # 0.12 s before the second line
        self.assertAlmostEqual(b1, a2 - 0.04, delta=0.001)
        self.assertAlmostEqual(b2, 0.15 + 5.7 + 0.7, delta=0.03)    # 0.7 s after the voice
        # read 1.5 times faster (longer than its room): the times shrink with it
        speech(w, [(0.1, 0), (6.0, 1), (1.2, 0), (4.0, 1), (0.4, 0)])
        cues, _f, _b = self.V.voice_cues('en', segs, {0: (w, 0.15, 9.7)})
        self.assertAlmostEqual(cues[1][0], 0.15 + 7.3 / (11.7 / 9.7) - 0.12, delta=0.05)
        self.assertLessEqual(cues[1][1], 10 - 0.1 + 1e-9)            # inside its segment

    def test_engine_tts_and_cues_only(self):
        # voice-tts/ (tts_engines.py) instead of voice-chatterbox/; --cues-only writes the cues without the videos
        shutil.move(os.path.join(self.work, 'voice-chatterbox'), os.path.join(self.work, 'voice-tts'))
        for r in self.rows:
            r['engine'], r['voice'] = 'qwen3', 'female'
        man = {'langs': {'ja': self.rows}, 'use': {'ja': 'qwen3:female'}}
        with open(os.path.join(self.work, 'voice-tts', 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump(man, f, ensure_ascii=False)
        with self.assertRaises(self.V.NarrationError):
            self.V.chatterbox_manifest('chatterbox')
        creport = []
        made = self.V.chatterbox_voices('ja', self.vids(), engine='tts', cues_only=True, cue_report=creport)
        self.assertEqual(made, list(self.VIDEOS))
        self.assertFalse(os.path.exists(os.path.join(self.work, 'out-voice')))
        for n in self.VIDEOS:
            with open(os.path.join(self.work, 'cues', 'ja', n + '.json'), encoding='utf-8') as f:
                cues = json.load(f)
            segs = [s for v, s in self.vids() if v == n][0]
            self.assertEqual([c[2] for c in cues], [l for s in segs for l in s['lines']])
            with open(os.path.join(self.work, 'cues', 'ja', n + '.srt'), encoding='utf-8') as f:
                self.assertIn(' --> ', f.read())
        self.assertEqual([r[1] for r in creport], list(self.VIDEOS))

    def test_render_reads_the_voice_cues(self):
        os.makedirs(os.path.join(self.work, 'cues', 'ja'))
        with open(os.path.join(self.work, 'cues', 'ja', 'promo.json'), 'w', encoding='utf-8') as f:
            json.dump([[0.25, 1.5, 'a'], [1.6, 3.0, 'b']], f)
        argv = sys.argv
        sys.argv = ['video_render.py', self.work, 'ja', 'promo', '--voice-cues']
        try:
            sys.modules.pop('video_render', None)
            import video_render as R
        finally:
            sys.argv = argv
        self.assertTrue(R.VOICE_CUES)
        self.assertEqual((R.WORK, R.LANGS, R.ONLY), (self.work, ['ja'], ['promo']))
        self.assertEqual(R.video_cues('ja', 'promo', []), [(0.25, 1.5, 'a'), (1.6, 3.0, 'b')])
        with self.assertRaises(SystemExit):
            R.video_cues('ja', 'youtube', [])
        R.VOICE_CUES = False
        segs = self.V.PLAN['langs']['ja']['promo']
        self.assertEqual(R.video_cues('ja', 'promo', segs), self.V.video_plan.cues('ja', segs))
        sys.modules.pop('video_render', None)


if __name__ == '__main__':
    unittest.main()
