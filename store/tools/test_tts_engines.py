#!/usr/bin/env python3
"""Tests of tts_engines.py with made-up engines and made-up model libraries (no model, no network, no torch).
Usage: python3 store/tools/test_tts_engines.py"""
import json
import math
import os
import sys
import tempfile
import types
import unittest
import wave
import zipfile

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import chatterbox_tts as C  # noqa: E402
import tts_engines as T  # noqa: E402

RATE = 24000


def tone(seconds):
    return [0.0] * int(0.3 * RATE) + [0.5 * math.sin(2 * math.pi * 220 * i / RATE) for i in range(int(seconds * RATE))] + [0.0] * int(0.4 * RATE)


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class FakeEngine(T.Engine):
    """Speaks every character for 0.1 s (0.06 s in the Latin languages); remembers the calls; 'uses' 800 MB of GPU."""

    def __init__(self, name='qwen3', langs=None, voices=('female', 'male'), tag=''):
        super().__init__({})
        self.name, self.voices, self.tag = name, voices, tag
        if langs:
            self.langs = set(langs)
        self.calls, self.designs = [], []
        self.device, self.dtype = 'cuda:0', 'fp16'
        self.models = {'design': 'fake/design', 'read': 'fake/read'}

    def design(self, description, lang, text, seed):
        self.designs.append((description, lang, text, seed))
        return C.to_int16(tone(2.0)), RATE

    def say(self, text, lang, ref, seed):
        self.calls.append((lang, text, ref and ref['wav'], seed))
        per = 0.1 if lang in ('ja', 'zh-TW', 'ko') else 0.06
        return C.to_int16(tone(len(text.replace(' ', '')) * per)), RATE

    def reset_peak(self):
        pass

    def peak_mb(self):
        return 800

    def file_tag(self):
        return self.tag

    def info(self):
        i = super().info()
        if self.tag:
            i['clone'] = 'xvector'
        return i


class FakeQwen(FakeEngine):
    """A made-up Qwen3 with its two ways of cloning: honest=True reads otherwise in each way (as the library should),
    honest=False the same both ways (as the owner's audio of 11-22 21:21 was)."""
    CLONES = ('xvector', 'icl')

    def __init__(self, honest=True):
        super().__init__('qwen3', tag='xvec')
        self.clone, self.honest, self.prompts = 'xvector', honest, {}

    def say(self, text, lang, ref, seed):
        self.prompts[(ref['wav'], ref['text'], self.clone)] = [types.SimpleNamespace(
            ref_code=None if self.clone == 'xvector' else [1, 2], ref_text=None if self.clone == 'xvector' else ref['text'],
            x_vector_only_mode=self.clone == 'xvector', icl_mode=self.clone == 'icl')]
        self.calls.append((lang, text, self.clone, seed))
        n = len(text.replace(' ', '')) * 0.06 + (0.5 if self.honest and self.clone == 'icl' else 0.0)
        return C.to_int16(tone(n)), RATE

    prompt_info = T.Qwen3.prompt_info


VOICES = T.load_voices()


class Basics(unittest.TestCase):
    def test_no_heavy_import(self):
        # importing the tool loads no model library
        for m in ('torch', 'qwen_tts', 'ming_tts', 'irodori_tts'):
            self.assertNotIn(m, sys.modules, m)

    def test_engines_and_languages(self):
        self.assertEqual(sorted(T.ENGINES), ['chatterbox', 'irodori', 'ming', 'qwen3'])
        self.assertEqual(T.ENGINES['irodori'].langs, {'ja'})
        for name in ('qwen3', 'ming', 'chatterbox'):
            self.assertEqual(T.ENGINES[name].langs, set(C.LANG_ID), name)
        self.assertEqual(T.ENGINES['chatterbox'].voices, ('default',))

    def test_every_designed_voice_has_description_and_seed(self):
        for engine in ('qwen3', 'ming', 'irodori'):
            for voice in ('female', 'male'):
                v = T.voice_spec(VOICES, engine, voice)
                self.assertTrue(len(v['description']) > 30, (engine, voice))
                self.assertIsInstance(v['seed'], int)
                self.assertIn(v['anchor_lang'], T.ENGINES[engine].langs)
                self.assertTrue(v['anchor_text'])
        # a real person's voice is not asked for: no reference recording of someone in the file
        self.assertNotIn('ref_wav', json.dumps(VOICES))

    def test_v4_large_refused(self):
        with self.assertRaises(SystemExit):
            T.Irodori({'irodori_model': 'Aratako/Irodori-TTS-v4-Large'})

    def test_qwen_sizes(self):
        self.assertEqual(T.Qwen3({}).models['read'], 'Qwen/Qwen3-TTS-12Hz-1.7B-Base')
        self.assertEqual(T.Qwen3({'qwen_size': '0.6b'}).models['read'], 'Qwen/Qwen3-TTS-12Hz-0.6B-Base')
        self.assertEqual(T.Qwen3({}).models['design'], 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign')
        with self.assertRaises(SystemExit):
            T.Qwen3({'qwen_size': '7b'})

    def test_sample_paragraphs_are_those_of_chatterbox_tricky(self):
        for lang in C.LANG_ID:
            items = C.paragraphs_of(lang)
            want = [(i + 1,) + tuple(it) for i, it in enumerate(items) if C.TRICKY.search(it[4])][:C.TRICKY_MAX]
            self.assertEqual(T.tricky(lang), want, lang)
            self.assertTrue(want, lang)

    def test_file_names_say_language_engine_voice_paragraph(self):
        self.assertEqual(T.sample_name('ja', 'irodori', 'female', 9, 'youtube', 1), 'ja-irodori-female-p09-youtube-01.wav')

    def test_readings_of_the_language_then_of_the_engine(self):
        r = {'ja': [['√', 'ルート']], 'qwen3:ja': [['π', 'パイ']]}
        self.assertEqual(T.spoken('qwen3', 'ja', '√ と π', r), 'ルート と パイ')
        self.assertEqual(T.spoken('ming', 'ja', '√ と π', r), 'ルート と π')

    def test_listen_for(self):
        w = dict(T.listen_for('ja', '「60 mph to km/h」のように、√ や π、20 万桁まで。積分も。'))
        self.assertIn('60 mph', w['数字・単位・記号'])
        self.assertIn('km/h', w['数字・単位・記号'])
        self.assertIn('√', w['数字・単位・記号'])
        self.assertIn('20 万桁', w['数字・単位・記号'])
        self.assertIn('積分', w['漢字の読み'])
        self.assertNotIn('漢字の読み', dict(T.listen_for('en', 'Up to 200,000 digits.')))
        self.assertEqual(dict(T.listen_for('en', 'Draw in 2D and tap 3D.'))['数字・単位・記号'], '2D、3D')
        self.assertIn('文の抑揚', dict(T.listen_for('ja', 'あ。い。う。')))

    def test_dtype_choice(self):
        class Cuda:
            def __init__(self, bf):
                self.bf = bf

            def is_bf16_supported(self):
                return self.bf
        old = types.SimpleNamespace(cuda=Cuda(False))
        new = types.SimpleNamespace(cuda=Cuda(True))
        self.assertEqual(T.pick_dtype(old, 'cuda:0', 'auto'), 'fp16')          # GTX 1650
        self.assertEqual(T.pick_dtype(new, 'cuda:0', 'auto'), 'bf16')          # RTX 4060
        self.assertEqual(T.pick_dtype(old, 'cpu', 'auto'), 'fp32')
        self.assertEqual(T.pick_dtype(old, 'cuda:0', 'auto', allowed=('bf16', 'fp32')), 'fp32')  # Irodori on a GTX 1650
        with self.assertRaises(SystemExit):
            T.pick_dtype(old, 'cuda:0', 'fp16', allowed=('bf16', 'fp32'))

    def test_use(self):
        u = T.parse_use('ja=irodori:female,qwen3:male', list(C.LANG_ID))
        self.assertEqual(u['ja'], ('qwen3', 'male'))  # a later part wins
        u = T.parse_use('qwen3:male,ja=irodori:female', list(C.LANG_ID))
        self.assertEqual(u['ja'], ('irodori', 'female'))
        self.assertEqual(u['en'], ('qwen3', 'male'))
        with self.assertRaises(SystemExit):
            T.parse_use('en=irodori:female', ['en'])   # Irodori reads only Japanese
        with self.assertRaises(SystemExit):
            T.parse_use('ja=chatterbox:female', ['ja'])
        with self.assertRaises(SystemExit):
            T.parse_use('ja=espeak', ['ja'])

    def test_options(self):
        cmd, work, langs, opt = T.options(['sample', '~/w', 'ja,en', '--engine', 'qwen3', '--qwen-size=0.6b', '--no-text-normalization'])
        self.assertEqual((cmd, langs, opt['engine'], opt['qwen_size'], opt['no_text_normalization']), ('sample', ['ja', 'en'], 'qwen3', '0.6b', True))
        self.assertTrue(work.endswith('/w') and not work.startswith('~'))
        self.assertEqual(opt['qwen_clone'], 'xvector')            # A (11-22): the voice of the reference without its way of speaking
        self.assertEqual(T.options(['all', '~/w', '--use', 'qwen3:female', '--qwen-clone', 'icl'])[3]['qwen_clone'], 'icl')
        for bad in (['say', '~/w'], ['sample'], ['sample', '~/w', 'xx'], ['sample', '~/w', '--colour', 'x']):
            with self.assertRaises(SystemExit):
                T.options(bad)


class Runs(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = []

    def tearDown(self):
        pass  # ((11-25) the folder of the test is left in the temporary directory: nothing is deleted, the owner's rule)

    def test_all_uses_again_the_audio_of_the_same_words(self):
        # (11-25) a segment added before others moves their numbers: their audio is used again (the same words), only the new
        # paragraph is made
        langs = ['ja']
        use = T.parse_use('qwen3:female', langs)
        q = FakeEngine('qwen3', tag='xvec')
        T.make_all(self.dir, use, {'qwen3': q}, VOICES, {}, {}, log=self.log.append)
        n = len(C.paragraphs_of('ja'))
        self.assertEqual(len(q.calls), n)
        old = C.paragraphs_of
        items = old('ja')
        v0 = items[0][0]
        added = [(v0, 0, 0.15, 3.7, '新しい段落です。')] + [(v, k + 1 if v == v0 else k, s, r, t) for v, k, s, r, t in items]
        try:
            C.paragraphs_of = lambda lang, plan=None: added
            q2 = FakeEngine('qwen3', tag='xvec')
            zips = T.make_all(self.dir, use, {'qwen3': q2}, VOICES, {}, {}, log=self.log.append)
        finally:
            C.paragraphs_of = old
        self.assertEqual([c[1] for c in q2.calls], [T.spoken('qwen3', 'ja', '新しい段落です。', {})])
        self.assertTrue(any('used again (the same words)' in l for l in self.log))
        moved = sum(1 for v, k, s, r, t in items if v == v0)
        self.assertIn('ja: qwen3 female, 1 of %d paragraphs to make (%d used again: the same words)' % (n + 1, moved), self.log)
        man = read_json(os.path.join(self.dir, 'voice-tts', 'manifest.json'))
        self.assertEqual(len(man['langs']['ja']), n + 1)
        with zipfile.ZipFile(zips[0]) as z:
            self.assertEqual(len([x for x in z.namelist() if x.startswith('voice-tts/ja/')]), n + 1)

    def test_a_paragraph_made_again_keeps_its_seed_when_it_moves(self):
        # (11-25) paragraph 2 made again with --redo (another seed), then a segment added before it: it keeps that seed and its
        # audio (not the first one, which is still in the folder)
        use = T.parse_use('qwen3:female', ['ja'])
        T.make_all(self.dir, use, {'qwen3': FakeEngine('qwen3', tag='xvec')}, VOICES, {}, {}, log=self.log.append)
        q1 = FakeEngine('qwen3', tag='xvec')
        T.make_all(self.dir, use, {'qwen3': q1}, VOICES, {'redo': 'ja:2'}, {}, log=self.log.append)
        self.assertEqual(len(q1.calls), 1)
        r2 = read_json(os.path.join(self.dir, 'voice-tts', 'manifest.json'))['langs']['ja'][1]
        self.assertNotEqual(r2['seed'], C.DEFAULT_SEED)
        old = C.paragraphs_of
        items = old('ja')
        v0 = items[0][0]
        self.assertEqual(items[1][0], v0)
        added = [(v0, 0, 0.15, 3.7, '新しい段落です。')] + [(v, k + 1 if v == v0 else k, s, r, t) for v, k, s, r, t in items]
        try:
            C.paragraphs_of = lambda lang, plan=None: added
            q2 = FakeEngine('qwen3', tag='xvec')
            T.make_all(self.dir, use, {'qwen3': q2}, VOICES, {}, {}, log=self.log.append)
        finally:
            C.paragraphs_of = old
        self.assertEqual(len(q2.calls), 1)
        r3 = read_json(os.path.join(self.dir, 'voice-tts', 'manifest.json'))['langs']['ja'][2]
        self.assertEqual((r3['said'], r3['seed']), (r2['said'], r2['seed']))
        self.assertEqual(r3['file'].rsplit('-', 1)[1], r2['file'].rsplit('-', 1)[1])

    def test_design_once_then_again_when_changed(self):
        e = FakeEngine()
        ref = T.ensure_voice(self.dir, e, 'female', VOICES, log=self.log.append)
        spec = T.voice_spec(VOICES, 'qwen3', 'female')
        self.assertEqual(e.designs, [(spec['description'], spec['anchor_lang'], spec['anchor_text'], spec['seed'])])
        wav, meta = T.voice_paths(self.dir, 'qwen3', 'female')
        m = read_json(meta)
        self.assertEqual((m['description'], m['seed'], m['vram_mb']), (spec['description'], spec['seed'], 800))
        self.assertEqual(ref['wav'], wav)
        self.assertEqual(ref['text'], spec['anchor_text'])
        T.ensure_voice(self.dir, e, 'female', VOICES, log=self.log.append)
        self.assertEqual(len(e.designs), 1)                      # kept
        v2 = json.loads(json.dumps(VOICES))
        v2['engines']['qwen3']['female']['seed'] += 1
        T.ensure_voice(self.dir, e, 'female', v2, log=self.log.append)
        self.assertEqual(len(e.designs), 2)                      # a new seed: made again
        T.ensure_voice(self.dir, e, 'female', v2, redesign=True, log=self.log.append)
        self.assertEqual(len(e.designs), 3)

    # (1.16: the paragraphs of the plan of 1.16, the promo and the shorts: p07 is the first of short 1)
    def test_sample_and_listening_lists(self):
        q, i = FakeEngine('qwen3'), FakeEngine('irodori', langs=['ja'])
        T.make_sample(self.dir, ['ja', 'en'], q, ['female', 'male'], VOICES, {'seed': '1234'}, {}, log=self.log.append)
        T.make_sample(self.dir, ['ja', 'en'], i, ['female'], VOICES, {'seed': '1234'}, {}, log=self.log.append)
        n = len(T.tricky('ja'))
        self.assertEqual(len(q.calls), 2 * (n + len(T.tricky('en'))))
        self.assertEqual(len(i.calls), n)                        # Irodori: only Japanese
        man = read_json(os.path.join(self.dir, 'tts', 'sample', 'manifest.json'))
        names = sorted(r['file'] for r in man['rows'])
        self.assertIn('ja/ja-irodori-female-p08-short-1-history-00.wav', names)
        self.assertIn('en/en-qwen3-male-p08-short-1-history-00.wav', names)
        for r in man['rows']:
            self.assertEqual((r['time_s'] is not None, r['vram_mb']), (True, 800))
            with wave.open(os.path.join(self.dir, 'tts', 'sample', r['file'])) as w:
                self.assertEqual((w.getnchannels(), w.getsampwidth()), (1, 2))
        with open(os.path.join(self.dir, 'tts', 'sample', 'listen.md'), encoding='utf-8') as f:
            md = f.read()
        self.assertIn('数字・単位・記号', md)
        self.assertIn('漢字の読み', md)
        self.assertIn('ja/ja-irodori-female-p08-short-1-history-00.wav', md)
        self.assertIn('800 MB', md)
        with open(os.path.join(self.dir, 'tts', 'sample', 'listen.html'), encoding='utf-8') as f:
            h = f.read()
        self.assertIn('<audio controls preload="none" src="ja/ja-qwen3-female-p08-short-1-history-00.wav">', h)
        # the logs give the time and the GPU memory of each paragraph
        self.assertTrue(any('GPU memory at most 800 MB' in l and 'p07' in l for l in self.log))
        # a second run makes nothing; a changed reading makes that paragraph again
        q2 = FakeEngine('qwen3')
        T.make_sample(self.dir, ['ja', 'en'], q2, ['female', 'male'], VOICES, {'seed': '1234'}, {}, log=self.log.append)
        self.assertEqual(q2.calls, [])
        T.make_sample(self.dir, ['ja'], q2, ['female'], VOICES, {'seed': '1234'}, {'qwen3:ja': [['π', 'パイ']]}, log=self.log.append)
        self.assertEqual([c[1] for c in q2.calls], [T.spoken('qwen3', 'ja', t[5], {'qwen3:ja': [['π', 'パイ']]}) for t in T.tricky('ja') if 'π' in t[5]])

    def test_designed_voice_is_used_for_every_language(self):
        q = FakeEngine('qwen3')
        T.make_sample(self.dir, ['ja', 'en', 'es'], q, ['female'], VOICES, {}, {}, log=self.log.append)
        wav, meta = T.voice_paths(self.dir, 'qwen3', 'female')
        self.assertEqual(set(c[2] for c in q.calls), {wav})
        self.assertEqual(len(q.designs), 1)

    def test_all_with_an_engine_for_each_language(self):
        q, i = FakeEngine('qwen3'), FakeEngine('irodori', langs=['ja'])
        use = T.parse_use('qwen3:female,ja=irodori:male', ['ja', 'en'])
        zips = T.make_all(self.dir, use, {'irodori': i}, VOICES, {}, {}, log=self.log.append)     # the Irodori environment
        self.assertEqual([os.path.basename(z) for z in zips], ['voice-tts-ja.zip'])
        self.assertTrue(any('qwen3 is made in its own environment' in l for l in self.log))
        zips = T.make_all(self.dir, use, {'qwen3': q}, VOICES, {}, {}, log=self.log.append)       # the Qwen3 environment
        self.assertEqual([os.path.basename(z) for z in zips], ['voice-tts-en.zip'])
        man = read_json(os.path.join(self.dir, 'voice-tts', 'manifest.json'))
        self.assertEqual(man['use'], {'ja': 'irodori:male', 'en': 'qwen3:female'})
        ja = man['langs']['ja']
        self.assertEqual([(r['video'], r['seg'], r['text']) for r in ja], [(v, k, t) for v, k, s, room, t in C.paragraphs_of('ja')])
        for r in ja:
            for k in ('n', 'video', 'seg', 'start', 'room', 'text', 'said', 'file', 'seconds', 'seed', 'fits'):
                self.assertIn(k, r)       # the fields of chatterbox_tts.py's manifest (video_voice.py reads them)
            self.assertEqual((r['engine'], r['voice'], r['vram_mb']), ('irodori', 'male', 800))
            self.assertTrue(r['file'].startswith('ja/irodori-male-'))
        with zipfile.ZipFile(os.path.join(self.dir, 'voice-tts-ja.zip')) as z:
            names = z.namelist()
        self.assertIn('voice-tts/manifest.json', names)
        self.assertIn('tts/voices/irodori-male.json', names)
        self.assertEqual(len([n for n in names if n.startswith('voice-tts/ja/')]), len(ja))
        # again: nothing; --redo: one paragraph with another seed
        i2 = FakeEngine('irodori', langs=['ja'])
        T.make_all(self.dir, use, {'irodori': i2}, VOICES, {}, {}, log=self.log.append)
        self.assertEqual(i2.calls, [])
        T.make_all(self.dir, use, {'irodori': i2}, VOICES, {'redo': 'ja:3'}, {}, log=self.log.append)
        self.assertEqual(len(i2.calls), 1)
        self.assertEqual(i2.calls[0][3], C.DEFAULT_SEED + C.REDO_STEP)

    def test_all_xvector_files_apart_from_the_old_ones(self):
        langs = list(C.LANG_ID)
        use = T.parse_use('qwen3:female', langs)
        old = FakeEngine('qwen3')                                   # made before 11-22 (in-context reading)
        T.make_all(self.dir, use, {'qwen3': old}, VOICES, {}, {}, log=self.log.append)
        n = sum(len(C.paragraphs_of(l)) for l in langs)
        self.assertEqual(len(old.calls), n)
        a = FakeEngine('qwen3', tag='xvec')                         # A: every paragraph made again, none of the old files used
        zips = T.make_all(self.dir, use, {'qwen3': a}, VOICES, {}, {}, log=self.log.append)
        self.assertEqual(len(a.calls), n)
        self.assertEqual(sorted(os.path.basename(z) for z in zips), sorted('voice-tts-%s.zip' % l for l in langs))
        wav, meta = T.voice_paths(self.dir, 'qwen3', 'female')
        self.assertEqual(set(c[2] for c in a.calls), {wav})           # one designed voice for the 7 languages
        man = read_json(os.path.join(self.dir, 'voice-tts', 'manifest.json'))
        self.assertEqual(man['use'], {l: 'qwen3:female' for l in langs})
        self.assertEqual(man['engines']['qwen3']['clone'], 'xvector')
        for l in langs:
            rows = man['langs'][l]
            self.assertEqual(len(rows), len(C.paragraphs_of(l)))
            for r in rows:
                self.assertTrue(r['file'].startswith('%s/qwen3-female-xvec-' % l), r['file'])
                self.assertEqual(r['clone'], 'xvector')
                self.assertTrue(os.path.exists(os.path.join(self.dir, 'voice-tts', r['file'])))
            with zipfile.ZipFile(os.path.join(self.dir, 'voice-tts-%s.zip' % l)) as z:
                names = [x for x in z.namelist() if x.startswith('voice-tts/%s/' % l)]
            self.assertEqual(len(names), len(rows))
            self.assertTrue(all('-xvec-' in x for x in names))       # the zip has only the files of A
        # again with A: nothing to make
        a2 = FakeEngine('qwen3', tag='xvec')
        T.make_all(self.dir, use, {'qwen3': a2}, VOICES, {}, {}, log=self.log.append)
        self.assertEqual(a2.calls, [])

    def test_sample_xvector_beside_the_old(self):
        T.make_sample(self.dir, ['ja'], FakeEngine('qwen3'), ['female'], VOICES, {}, {}, log=self.log.append)
        a = FakeEngine('qwen3', tag='xvec')
        T.make_sample(self.dir, ['ja'], a, ['female'], VOICES, {}, {}, log=self.log.append)
        self.assertEqual(len(a.calls), len(T.tricky('ja')))         # not taken for the old samples
        names = sorted(os.listdir(os.path.join(self.dir, 'tts', 'sample', 'ja')))
        self.assertIn('ja-qwen3-female-p08-short-1-history-00.wav', names)
        self.assertIn('ja-qwen3-female-xvec-p08-short-1-history-00.wav', names)

    def test_clone_check_when_the_two_ways_differ(self):
        q = FakeQwen(honest=True)
        r = T.clone_check(self.dir, ['ja', 'en'], q, 'female', VOICES, {}, {}, log=self.log.append)
        self.assertEqual(r, {'ja': (False, (0, 0)), 'en': (False, (0, 0))})
        self.assertEqual([c[2] for c in q.calls], ['xvector', 'icl', 'xvector', 'icl'])
        self.assertEqual(len(set(c[3] for c in q.calls)), 1)                     # one seed for both ways
        self.assertEqual(q.clone, 'xvector')                                     # the engine's own way kept
        d = os.path.join(self.dir, 'tts', 'clone-check')
        self.assertEqual(sorted(os.listdir(d)), ['en-qwen3-female-icl.wav', 'en-qwen3-female-xvector.wav', 'ja-qwen3-female-icl.wav', 'ja-qwen3-female-xvector.wav'])
        text = '\n'.join(self.log)
        self.assertIn('different audio', text)
        self.assertIn('codes none, text none, x_vector_only_mode True', text)
        self.assertIn('codes yes, text yes, x_vector_only_mode False, icl_mode True', text)

    def test_clone_check_when_they_are_the_same_and_the_old_files_too(self):
        # the files of A made the same as the old ones (as the owner's zips of 11-22 21:21): found and told
        langs = ['ja']
        use = T.parse_use('qwen3:female', langs)
        T.make_all(self.dir, use, {'qwen3': FakeEngine('qwen3')}, VOICES, {}, {}, log=self.log.append)
        T.make_all(self.dir, use, {'qwen3': FakeEngine('qwen3', tag='xvec')}, VOICES, {}, {}, log=self.log.append)
        n = len(C.paragraphs_of('ja'))
        self.assertEqual(T.same_audio(self.dir, 'ja'), (n, n))                  # the made-up engine reads alike both times
        r = T.clone_check(self.dir, langs, FakeQwen(honest=False), 'female', VOICES, {}, {}, log=self.log.append)
        self.assertEqual(r, {'ja': (True, (n, n))})
        text = '\n'.join(self.log)
        self.assertIn('the SAME audio both ways', text)
        self.assertIn('%d of %d audio files of A are the very same audio' % (n, n), text)
        with self.assertRaises(SystemExit):
            T.clone_check(self.dir, langs, FakeEngine('irodori', langs=['ja']), 'female', VOICES, {}, {}, log=self.log.append)

    def test_main_clone_check(self):
        q = FakeQwen()
        self.assertEqual(T.main(['clone-check', self.dir, 'ko', '--engine', 'qwen3', '--voice', 'female'], engines={'qwen3': q}, log=self.log.append), 0)
        self.assertEqual([(c[0], c[2]) for c in q.calls], [('ko', 'xvector'), ('ko', 'icl')])

    def test_main_all_needs_an_engine_of_this_environment(self):
        with self.assertRaises(SystemExit) as cm:
            T.main(['all', self.dir, 'ja', '--use', 'ja=irodori:female'], log=self.log.append)
        self.assertIn('none of irodori', str(cm.exception))

    def test_main_design_and_sample(self):
        q = FakeEngine('qwen3')
        T.main(['design', self.dir, '--engine', 'qwen3', '--voice', 'male'], engines={'qwen3': q}, log=self.log.append)
        self.assertEqual(len(q.designs), 1)
        T.main(['sample', self.dir, 'es', '--engine', 'qwen3', '--voice', 'male'], engines={'qwen3': q}, log=self.log.append)
        self.assertEqual(len(q.calls), len(T.tricky('es')))
        with self.assertRaises(SystemExit):
            T.main(['sample', self.dir, '--engine', 'qwen3', '--voice', 'child'], engines={'qwen3': q}, log=self.log.append)


class Adapters(unittest.TestCase):
    """The engines call their libraries as their documentation says (made-up libraries record the calls)."""

    def setUp(self):
        self.saved = {k: sys.modules.get(k) for k in ('torch', 'numpy', 'qwen_tts', 'ming_tts', 'irodori_tts', 'irodori_tts.inference_runtime')}
        self.calls = []
        calls = self.calls

        class Cuda:
            def is_available(self):
                return True

            def is_bf16_supported(self):
                return False

            def manual_seed_all(self, s):
                calls.append(('cuda_seed', s))

            def reset_peak_memory_stats(self):
                pass

            def max_memory_allocated(self):
                return 3 * 2 ** 30

            def empty_cache(self):
                pass

        torch = types.ModuleType('torch')
        torch.cuda = Cuda()
        torch.bfloat16, torch.float16, torch.float32 = 'bf16', 'fp16', 'fp32'
        torch.manual_seed = lambda s: calls.append(('seed', s))
        sys.modules['torch'] = torch
        np = types.ModuleType('numpy')
        np.random = types.SimpleNamespace(seed=lambda s: calls.append(('np_seed', s)))
        sys.modules['numpy'] = np

        class Model:
            @classmethod
            def from_pretrained(cls, name, **kw):
                calls.append(('load', name, kw))
                return cls()

            def generate_voice_design(self, **kw):
                calls.append(('design', kw))
                return [[0.1, -0.1, 0.0]], 24000

            def create_voice_clone_prompt(self, **kw):
                calls.append(('prompt', kw))
                return ['prompt']

            def generate_voice_clone(self, **kw):
                calls.append(('clone', kw))
                return [[0.1, 0.2]], 24000
        q = types.ModuleType('qwen_tts')
        q.Qwen3TTSModel = Model
        sys.modules['qwen_tts'] = q

        class Ming:
            sample_rate = 44100

            def __init__(self, path, device='cuda:0', text_normalization=True):
                calls.append(('ming', path, device, text_normalization))

            def synthesize(self, **kw):
                calls.append(('ming_synth', kw))
                return [[0.0, 0.5]]
        m = types.ModuleType('ming_tts')
        m.MingTTS = Ming
        sys.modules['ming_tts'] = m

        rt_mod = types.ModuleType('irodori_tts.inference_runtime')

        class Key:
            def __init__(self, **kw):
                calls.append(('key', kw))

        class Req:
            def __init__(self, **kw):
                self.kw = kw

        class RT:
            @classmethod
            def from_key(cls, key):
                return cls()

            def synthesize(self, req):
                calls.append(('irodori', req.kw))
                return types.SimpleNamespace(audio=[0.1, 0.0], sample_rate=48000)
        rt_mod.InferenceRuntime, rt_mod.RuntimeKey, rt_mod.SamplingRequest = RT, Key, Req
        rt_mod.download_hf_checkpoint = lambda src: calls.append(('download', src)) or '/ckpt/model.safetensors'
        sys.modules['irodori_tts'] = types.ModuleType('irodori_tts')
        sys.modules['irodori_tts.inference_runtime'] = rt_mod

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

    def test_qwen3(self):
        e = T.Qwen3({'device': 'auto', 'dtype': 'auto', 'qwen_size': '0.6b'})
        pcm, sr = e.design('calm woman', 'en', 'Hello.', 7)
        self.assertEqual(sr, 24000)
        ref = {'wav': '/v/qwen3-female.wav', 'text': 'Hello.'}
        e.say('こんにちは', 'ja', ref, 9)
        e.say('Hola', 'es', ref, 9)
        loads = [c for c in self.calls if c[0] == 'load']
        self.assertEqual([c[1] for c in loads], ['Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'Qwen/Qwen3-TTS-12Hz-0.6B-Base'])
        self.assertEqual(loads[0][2], {'device_map': 'cuda:0', 'dtype': 'fp16', 'attn_implementation': 'sdpa'})  # no bf16 on this GPU
        d = [c[1] for c in self.calls if c[0] == 'design'][0]
        self.assertEqual(d, {'text': 'Hello.', 'language': 'English', 'instruct': 'calm woman'})
        p = [c[1] for c in self.calls if c[0] == 'prompt']
        # A (the default, 11-22): the speaker embedding (x-vector) of the reference only, once; no reference text
        self.assertEqual(p, [{'ref_audio': '/v/qwen3-female.wav', 'x_vector_only_mode': True}])
        self.assertEqual((e.clone, e.file_tag(), e.info()['clone']), ('xvector', 'xvec', 'xvector'))
        cl = [c[1] for c in self.calls if c[0] == 'clone']
        self.assertEqual([(c['text'], c['language']) for c in cl], [('こんにちは', 'Japanese'), ('Hola', 'Spanish')])
        self.assertIn(('seed', 9), self.calls)
        self.assertEqual(e.peak_mb(), 3072)

    def test_qwen3_icl_as_before(self):
        e = T.Qwen3({'qwen_clone': 'icl'})
        ref = {'wav': '/v/qwen3-female.wav', 'text': 'Hello.'}
        e.say('Hallo', 'de', ref, 3)
        e.say('Bonjour', 'fr', ref, 3)
        p = [c[1] for c in self.calls if c[0] == 'prompt']
        self.assertEqual(p, [{'ref_audio': '/v/qwen3-female.wav', 'ref_text': 'Hello.', 'x_vector_only_mode': False}])  # once
        self.assertEqual((e.file_tag(), e.info()['clone']), ('', 'icl'))
        cl = [c[1] for c in self.calls if c[0] == 'clone']
        self.assertEqual([(c['text'], c['language']) for c in cl], [('Hallo', 'German'), ('Bonjour', 'French')])
        with self.assertRaises(SystemExit):
            T.Qwen3({'qwen_clone': 'copy'})

    def test_qwen3_one_prompt_per_mode(self):
        # the same reference read both ways in one process (not done by the tool, but the prompts must not mix)
        a, b = T.Qwen3({}), T.Qwen3({'qwen_clone': 'icl'})
        ref = {'wav': '/v/qwen3-female.wav', 'text': 'Hello.'}
        a.say('一', 'ja', ref, 1)
        b.say('二', 'ja', ref, 1)
        modes = [c[1]['x_vector_only_mode'] for c in self.calls if c[0] == 'prompt']
        self.assertEqual(modes, [True, False])

    def test_available(self):
        self.assertTrue(T.Qwen3({}).available())            # (the made-up libraries of this test)
        self.assertTrue(T.Irodori({}).available())
        self.assertTrue(T.Ming({'ming_repo': '/nowhere'}).available())
        sys.modules.pop('qwen_tts')
        self.assertFalse(T.Qwen3({}).available())

    def test_ming(self):
        with self.assertRaises(SystemExit):            # bf16 only: not on this GPU
            T.Ming({'device': 'auto'}).design('x', 'en', 'Hello.', 1)
        e = T.Ming({'device': 'cpu', 'no_text_normalization': True})
        e.design('温暖的女声', 'en', 'Hello.', 3)
        e.say('こんにちは', 'ja', {'wav': '/v/ming-female.wav', 'text': 'Hello.'}, 4)
        self.assertEqual([c for c in self.calls if c[0] == 'ming'], [('ming', 'inclusionAI/Ming-3.0-tts-0.5B', 'cpu', False)])
        s = [c[1] for c in self.calls if c[0] == 'ming_synth']
        self.assertEqual(s[0], {'task': 'VOICE_DESIGN', 'text': 'Hello.', 'language_id': 'en', 'controls': {'style': '温暖的女声'}, 'use_zero_spk_emb': True})
        self.assertEqual(s[1], {'task': 'TTS', 'text': 'こんにちは', 'language_id': 'ja', 'prompt_wav_path': '/v/ming-female.wav', 'prompt_text': 'Hello.', 'use_spk_emb': True})

    def test_irodori(self):
        e = T.Irodori({'device': 'auto', 'dtype': 'auto'})
        pcm, sr = e.design('落ち着いた女性', 'ja', 'これは声です。', 5)
        e.say('こんにちは', 'ja', {'wav': '/v/irodori-female.wav', 'text': 'これは声です。', 'description': '落ち着いた女性'}, 6)
        self.assertEqual(sr, 48000)
        self.assertIn(('download', 'Aratako/Irodori-TTS-v4.1-Small'), self.calls)
        key = [c[1] for c in self.calls if c[0] == 'key'][0]
        self.assertEqual((key['model_device'], key['model_precision'], key['codec_precision']), ('cuda', 'fp32', 'fp32'))  # no fp16, no bf16 here
        r = [c[1] for c in self.calls if c[0] == 'irodori']
        self.assertEqual(r[0], {'text': 'これは声です。', 'caption': '落ち着いた女性', 'no_ref': True, 'seed': 5})
        self.assertEqual(r[1], {'text': 'こんにちは', 'caption': '落ち着いた女性', 'ref_wav': '/v/irodori-female.wav', 'seed': 6})


if __name__ == '__main__':
    unittest.main()
