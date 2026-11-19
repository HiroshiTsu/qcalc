#!/usr/bin/env python3
"""Checks the pictures (and, when a folder is given, the videos) of the QCalc store listing (stage M6):

  - every set in store/screenshots-1.12/ has 8 phone pictures 1080 × 1920, one 1920 × 1080, and 4 each
    for 7-inch (1200 × 1920) and 10-inch tablets (1600 × 2560);
  - Google Play's rules for screenshots: PNG or JPEG, no transparency, sides 320-3840 px, the long side at
    most twice the short one, at most 8 MB; the feature graphics 1024 × 500 without transparency, at most
    15 MB; the YouTube thumbnails 1280 × 720, at most 2 MB;
  - with --sheets <folder>: contact sheets of each set at about the size Google Play shows them on a phone
    (270 px wide), to look at whether the headlines can still be read (needs ffmpeg);
  - with --videos <folder> (store/tools/video_render.py's out/): the promo 1920 × 1080 and 30-45 s, the
    YouTube video 1920 × 1080 and 2-3 min, the shorts 1080 × 1920 and 15-30 s (needs ffprobe).
Usage: python3 store/tools/assets_check.py [--sheets DIR] [--videos DIR]   (Python standard library only)
"""
import os
import re
import struct
import subprocess
import sys

STORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(STORE, 'screenshots-1.12')


def png_info(path):
    with open(path, 'rb') as f:
        b = f.read(33)
    if b[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h, depth, ctype = struct.unpack('>IIBB', b[16:26])
    # colour type 4 or 6 has an alpha channel; a tRNS chunk can make 2 transparent as well
    with open(path, 'rb') as f:
        data = f.read()
    trns = b'tRNS' in data[:data.find(b'IDAT')] if b'IDAT' in data else False
    return {'w': w, 'h': h, 'depth': depth, 'alpha': ctype in (4, 6) or trns, 'size': len(data)}


def main():
    args = sys.argv[1:]
    sheets = args[args.index('--sheets') + 1] if '--sheets' in args else None
    videos = args[args.index('--videos') + 1] if '--videos' in args else None
    problems, n = [], 0
    want = {'phone': (1080, 1920, 8), 'landscape': (1920, 1080, 1), 'tablet7': (1200, 1920, 4), 'tablet10': (1600, 2560, 4)}
    for s in sorted(os.listdir(SHOTS)):
        d = os.path.join(SHOTS, s)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
        for kind, (w, h, count) in want.items():
            fs = [f for f in files if f.startswith(kind + '-')]
            if len(fs) != count:
                problems.append('%s: %d %s pictures (want %d)' % (s, len(fs), kind, count))
            for f in fs:
                i = png_info(os.path.join(d, f))
                n += 1
                if not i:
                    problems.append('%s/%s: not a PNG' % (s, f))
                    continue
                if (i['w'], i['h']) != (w, h):
                    problems.append('%s/%s: %d × %d (want %d × %d)' % (s, f, i['w'], i['h'], w, h))
                if i['alpha']:
                    problems.append('%s/%s: has transparency' % (s, f))
                if i['size'] > 8 * 1024 * 1024:
                    problems.append('%s/%s: %d bytes (more than 8 MB)' % (s, f, i['size']))
                lo, hi = min(i['w'], i['h']), max(i['w'], i['h'])
                if lo < 320 or hi > 3840 or hi > 2 * lo:
                    problems.append('%s/%s: sides outside Google Play\'s limits' % (s, f))
        print('%-7s %s' % (s, ' '.join('%s %d' % (k, len([f for f in files if f.startswith(k + '-')])) for k in want)))
    for f in sorted(os.listdir(STORE)):
        if re.match(r'feature-graphic-1\.12-.+\.png$', f):
            i = png_info(os.path.join(STORE, f))
            n += 1
            if not i or (i['w'], i['h']) != (1024, 500) or i['alpha'] or i['size'] > 15 * 1024 * 1024:
                problems.append('%s: %s' % (f, i))
            print('%s %d × %d %d KB' % (f, i['w'], i['h'], i['size'] // 1024))
    vdir = os.path.join(STORE, 'video')
    if os.path.isdir(vdir):
        for l in sorted(os.listdir(vdir)):
            p = os.path.join(vdir, l, 'thumbnail.png')
            if os.path.exists(p):
                i = png_info(p)
                n += 1
                if (i['w'], i['h']) != (1280, 720) or i['size'] > 2 * 1024 * 1024:
                    problems.append('video/%s/thumbnail.png: %s' % (l, i))
                print('video/%s/thumbnail.png %d × %d %d KB' % (l, i['w'], i['h'], i['size'] // 1024))
    if sheets:
        os.makedirs(sheets, exist_ok=True)
        for s in sorted(os.listdir(SHOTS)):
            d = os.path.join(SHOTS, s)
            ph = sorted(f for f in os.listdir(d) if f.startswith('phone-'))
            if len(ph) != 8:
                continue
            ins = []
            for f in ph:
                ins += ['-i', os.path.join(d, f)]
            fc = ''.join('[%d]scale=270:480[s%d];' % (k, k) for k in range(8)) + ''.join('[s%d]' % k for k in range(8)) + 'hstack=8'
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', fc, os.path.join(sheets, 'phone-%s.png' % s)], check=True)
        print('contact sheets in', sheets)
    if videos:
        rules = {'promo': (1920, 1080, 30, 45), 'youtube': (1920, 1080, 120, 180), 'short': (1080, 1920, 15, 30)}
        for l in sorted(os.listdir(videos)):
            for f in sorted(os.listdir(os.path.join(videos, l))):
                if not f.endswith('.mp4') or '.part.' in f:
                    continue
                p = os.path.join(videos, l, f)
                out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration,size',
                                      '-of', 'default=nw=1', p], capture_output=True, text=True).stdout
                v = dict(x.split('=', 1) for x in out.split() if '=' in x)
                k = 'short' if f.startswith('short') else f[:-4]
                w, h, d0, d1 = rules.get(k, (0, 0, 0, 1e9))
                dur = float(v.get('duration', 0))
                ok = int(v.get('width', 0)) == w and int(v.get('height', 0)) == h and d0 <= dur <= d1
                n += 1
                if not ok:
                    problems.append('video %s/%s: %s × %s, %.1f s' % (l, f, v.get('width'), v.get('height'), dur))
                print('video %s/%s %s × %s %.1f s %s fps %d KB' % (l, f, v.get('width'), v.get('height'), dur, v.get('r_frame_rate'), int(v.get('size', 0)) // 1024))
    for p in problems:
        print('PROBLEM ' + p)
    print('%d files checked, %d problems' % (n, len(problems)))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
