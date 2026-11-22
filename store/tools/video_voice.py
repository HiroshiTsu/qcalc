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
Usage: python3 store/tools/video_voice.py <work folder> [langs] [videos]
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
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/qcalc-video'
LANGS = sys.argv[2].split(',') if len(sys.argv) > 2 else list(PLAN['langs'])
ONLY = sys.argv[3].split(',') if len(sys.argv) > 3 else None
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
    od = os.path.join(WORK, 'out-voice', lang)
    os.makedirs(od, exist_ok=True)
    out, tmp = os.path.join(od, name + '.mp4'), os.path.join(od, name + '.part.mp4')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-i', track, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                    '-shortest', '-movflags', '+faststart', tmp], check=True)
    os.replace(tmp, out)
    long_ = sum(1 for p in parts if p[2] > p[3])
    print('%s %s: %d lines, %d still longer than the subtitle' % (lang, name, len(parts), long_))


def main():
    for lang in LANGS:
        L = PLAN['langs'][lang]
        vids = [('promo', L['promo']), ('youtube', L['youtube'])] + [(s['name'], s['segments']) for s in L['shorts']]
        for name, segs in vids:
            if ONLY and name not in ONLY:
                continue
            voice(lang, name, segs)


if __name__ == '__main__':
    main()
