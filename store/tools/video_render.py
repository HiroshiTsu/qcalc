#!/usr/bin/env python3
"""Puts the QCalc videos together with ffmpeg (stage M3), silent, with the subtitles burnt in:

    <work>/out/<lang>/promo.mp4          Google Play promo, 1920 × 1080
    <work>/out/<lang>/youtube.mp4        YouTube video, 1920 × 1080 (upload youtube.srt as well)
    <work>/out/<lang>/short-*.mp4        shorts, 1080 × 1920

from the recorded scenes (<work>/<lang>/<scene>.mp4, store/tools/video.js), the backgrounds
(<work>/<lang>/bg/, store/tools/video_cards.js) and the timing of store/tools/video-plan.json (the same
cues as the SRT files that store/tools/video_plan.py writes). One file per segment, all with the same size,
frame rate and encoder, joined without encoding again. The videos are not committed (they are large): they
are sent to the owner. A narration can be added later without encoding the picture again:
    ffmpeg -i promo.mp4 -i voice.m4a -map 0:v -map 1:a -c:v copy -c:a aac -shortest promo-voice.mp4
With --voice-cues the subtitles are those of <work>/cues/<lang>/<video>.json, at the times of the voice
(store/tools/video_voice.py --engine tts|chatterbox, 11-22), instead of the plan's.
Usage: python3 store/tools/video_render.py <work folder> [langs] [videos: promo,youtube,short-1-solid,…] [--voice-cues]
Needs ffmpeg with libx264 and libass. Python standard library only.
"""
import json
import os
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import video_plan  # noqa: E402  (the cues)

PLAN = video_plan.PLAN
ARGV = [a for a in sys.argv[1:] if not a.startswith('--')]
VOICE_CUES = '--voice-cues' in sys.argv[1:]
WORK = ARGV[0] if len(ARGV) > 0 else '/tmp/qcalc-video'
LANGS = ARGV[1].split(',') if len(ARGV) > 1 else list(PLAN['langs'])
ONLY = ARGV[2].split(',') if len(ARGV) > 2 else None
WIDE = {'W': 1920, 'H': 1080, 'phone': (300, 60, 432, 960)}
TALL = {'W': 1080, 'H': 1920, 'phone': (225, 470, 630, 1400)}
ENC = ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', '30', '-an']
FONT = {'ja': 'Noto Sans CJK JP', 'ko': 'Noto Sans CJK KR', 'zh-TW': 'Noto Sans CJK TC'}


def ass(lang, F, cues, path, centre=False):
    """The subtitles of one segment as ASS, in pixels of the video: at the bottom of the right column
    (16:9) or in the band under the headline (9:16), white on a dark box."""
    wide = F['W'] > F['H']
    font = FONT.get(lang, 'Inter')
    size, align, ml, mr, mv = (46, 2, 880, 120, 64) if wide else (50, 8, 70, 70, 318)
    if centre:  # the closing card: under the name, in the middle
        ml, mr, align, mv = 120, 120, 2, (110 if wide else 260)
    head = ('[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n'
            '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, '
            'ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            'Style: S,%s,%d,&H00FFFFFF,&H00FFFFFF,&H64000000,&H64000000,1,0,0,0,100,100,0,0,3,12,0,%d,%d,%d,%d,1\n\n'
            '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n') % (F['W'], F['H'], font, size, align, ml, mr, mv)

    def t(x):
        cs = int(round(x * 100))
        return '%d:%02d:%02d.%02d' % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)
    ev = ''.join('Dialogue: 0,%s,%s,S,,0,0,0,,%s\n' % (t(a), t(b), l.replace('\n', '\\N')) for a, b, l in cues)
    open(path, 'w', encoding='utf-8').write(head + ev)


def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('ffmpeg failed: ' + ' '.join(cmd) + '\n' + r.stderr[-2000:])


def video_cues(lang, name, segs):
    """The subtitle cues of a video: the plan's, or with --voice-cues those written by video_voice.py at the times of the voice."""
    if not VOICE_CUES:
        return video_plan.cues(lang, segs)
    path = os.path.join(WORK, 'cues', lang, name + '.json')
    if not os.path.exists(path):
        raise SystemExit('--voice-cues: no %s (run store/tools/video_voice.py %s %s %s --engine tts --cues-only first)' % (path, WORK, lang, name))
    with open(path, encoding='utf-8') as f:
        return [(float(a), float(b), l) for a, b, l in json.load(f)]


def render(lang, name, F, segs):
    L = os.path.join(WORK, lang)
    out_dir = os.path.join(WORK, 'out', lang)
    seg_dir = os.path.join(WORK, 'seg', lang, name)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(seg_dir, exist_ok=True)
    all_cues = video_cues(lang, name, segs)
    t0, files = 0.0, []
    x, y, w, h = F['phone']
    for i, s in enumerate(segs, 1):
        D = float(s['dur'])
        cues = [(a - t0, b - t0, l) for a, b, l in all_cues if t0 <= a < t0 + D]
        a_path = os.path.join(seg_dir, '%02d.ass' % i)
        ass(lang, F, cues, a_path, centre=s['scene'] == 'end')
        bg = os.path.join(L, 'bg', '%s-%d.png' % (name, i))
        out, tmp = os.path.join(seg_dir, '%02d.mp4' % i), os.path.join(seg_dir, '%02d.part.mp4' % i)
        sub = "ass='%s'" % a_path.replace("'", "\\'")
        if s['scene'] == 'end':
            # the closing card: still, fading in from the last scene's colour is not needed (dark to dark)
            cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '30', '-i', bg, '-filter_complex',
                   '[0:v]format=yuv420p,loop=-1:1,trim=duration=%.3f,fade=t=in:st=0:d=0.4,%s,format=yuv420p[v]' % (D, sub), '-map', '[v]'] + ENC + ['-t', '%.3f' % D, tmp]
        else:
            clip = os.path.join(L, s['scene'] + '.mp4')
            Lc = dur(clip)
            # play the scene at its own pace; faster (up to 1.7 times) when it is longer than the segment,
            # and hold its last picture when it is shorter
            speed = max(1.0, min(1.7, (Lc - 0.2) / (D - 0.3)))
            fc = ('[1:v]setpts=(PTS-STARTPTS)/%.4f,scale=%d:%d:flags=lanczos,tpad=stop_mode=clone:stop_duration=%.3f,trim=duration=%.3f,setpts=PTS-STARTPTS[p];'
                  '[0:v]format=yuv420p,loop=-1:1,trim=duration=%.3f[b];[b][p]overlay=%d:%d:eof_action=repeat,%s,format=yuv420p[v]') % (speed, w, h, D, D, D, x, y, sub)
            cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '30', '-i', bg, '-i', clip, '-filter_complex', fc, '-map', '[v]'] + ENC + ['-t', '%.3f' % D, tmp]
        run(cmd)
        os.replace(tmp, out)
        files.append(out)
        t0 += D
    lst = os.path.join(seg_dir, 'list.txt')
    open(lst, 'w').write(''.join("file '%s'\n" % f for f in files))
    final, tmp = os.path.join(out_dir, name + '.mp4'), os.path.join(out_dir, name + '.part.mp4')
    run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', tmp])
    os.replace(tmp, final)
    print('%s %s %.1f s %d KB' % (lang, name, dur(final), os.path.getsize(final) // 1024))


def main():
    for lang in LANGS:
        Lp = PLAN['langs'][lang]
        vids = [('promo', WIDE, Lp['promo']), ('youtube', WIDE, Lp['youtube'])] + [(s['name'], TALL, s['segments']) for s in Lp['shorts']]
        for name, F, segs in vids:
            if ONLY and name not in ONLY:
                continue
            render(lang, name, F, segs)


if __name__ == '__main__':
    main()
