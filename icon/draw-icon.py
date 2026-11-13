#!/usr/bin/env python3
"""Draws the QCalc launcher icon and writes it as SVG.

  icon/qcalc-icon.svg       the icon in color, in two layers (background and foreground)
  icon/qcalc-icon-mono.svg  the one-color shape for themed icons (Android 13 and later)

The icon is a "Q" whose tail is an "=" sign. The Q is a window onto a 3D graph, the digits of pi run
round its ring, and an integral sign stands beside the peak: 3D graphs, many digits and calculus.

The canvas is 108 x 108, like an adaptive icon: launchers show the 72 x 72 square in the middle, cut to
their own shape, and only the circle of radius 33 round the centre is always visible.

Only needed to change the drawing: the two SVG files are kept in the repository, and
icon/make-icons.sh makes the PNG files from them. The digits are stored as outlines, so that the SVG
looks the same on a PC without the font.
Needs: python3 with fontTools, and the font Inter ExtraBold (SIL Open Font License), whose path can be
given as the first argument.
"""
import math
import os
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'

CX, CY, R, SW = 50.5, 50.5, 21.5, 6.6      # the ring of the Q: centre, radius, width
WINDOW = R - SW / 2 + 0.6                  # radius of what is seen through the ring
PI = '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899'


def num(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def mix(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02X%02X%02X' % tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ramp(stops, t):
    t = max(0.0, min(1.0, t))
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            return mix(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
    return stops[-1][1]


# colors by height, like the 3D graphs of the app: low is blue, high is red
HEIGHT = [(0.0, '#2B3FD0'), (0.28, '#2F7BFF'), (0.5, '#22D3EE'), (0.68, '#A3E635'),
          (0.82, '#FDE047'), (0.93, '#FB923C'), (1.0, '#F43F5E')]


def surface(cx, cy, scale, n=26, az=38, el=30, size=1.55):
    """z = cos(3.3 r) exp(-0.95 r^2) on a grid of n x n facets, painted from the back to the front"""
    a, e = math.radians(az), math.radians(el)

    def f(x, y):
        r = math.hypot(x, y)
        return math.cos(3.3 * r) * math.exp(-0.95 * r * r)

    def project(x, y, z):
        u = x * math.cos(a) - y * math.sin(a)
        depth = x * math.sin(a) + y * math.cos(a)
        v = depth * math.sin(e) - z * math.cos(e)
        return cx + u * scale, cy + v * scale, depth

    grid = [[(-size + 2 * size * i / n, -size + 2 * size * j / n) for j in range(n + 1)] for i in range(n + 1)]
    facets = []
    for i in range(n):
        for j in range(n):
            corners = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
            zs = [f(*p) for p in corners]
            pts = [project(p[0], p[1], z) for p, z in zip(corners, zs)]
            # light from the upper left: facets that face it are a little brighter
            nx = (zs[1] - zs[0] + zs[2] - zs[3]) / 2
            ny = (zs[3] - zs[0] + zs[2] - zs[1]) / 2
            shade = max(-1, min(1, -nx * 0.9 - ny * 0.5))
            facets.append((sum(p[2] for p in pts) / 4, pts, sum(zs) / 4, shade))
    facets.sort(key=lambda q: q[0])
    out = []
    for _, pts, z, shade in facets:
        col = ramp(HEIGHT, (z + 0.42) / 1.25)
        col = mix(col, '#FFFFFF', 0.22 * shade) if shade > 0 else mix(col, '#0A1040', -0.30 * shade)
        d = 'M' + ' L'.join('%s,%s' % (num(p[0]), num(p[1])) for p in pts) + 'Z'
        out.append(f'<path d="{d}" fill="{col}"/>')
    return ('<g stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="0.14" stroke-linejoin="round">\n'
            + '\n'.join(out) + '\n</g>')


def ring(stroke):
    return f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="{stroke}" stroke-width="{SW}"/>'


def tail(stroke, t0=20.6, t1=33.5, p=4.6, w=4.6):
    """the "=" that is the tail of the Q: two bars along the diagonal, from the ring outwards"""
    k = 1 / math.sqrt(2)
    out = []
    for s in (1, -1):
        x1, y1 = CX + (t0 + s * p) * k, CY + (t0 - s * p) * k
        x2, y2 = CX + (t1 + s * p) * k, CY + (t1 - s * p) * k
        out.append(f'<line x1="{num(x1)}" y1="{num(y1)}" x2="{num(x2)}" y2="{num(y2)}" stroke="{stroke}" '
                   f'stroke-width="{w}" stroke-linecap="round"/>')
    return '\n'.join(out)


def gloss():
    """a thin highlight on the upper left of the ring"""
    r = R + SW / 2 - 1.1
    a0, a1 = math.radians(200), math.radians(285)
    x0, y0 = CX + r * math.cos(a0), CY + r * math.sin(a0)
    x1, y1 = CX + r * math.cos(a1), CY + r * math.sin(a1)
    return (f'<path d="M{num(x0)},{num(y0)} A{num(r)},{num(r)} 0 0 1 {num(x1)},{num(y1)}" fill="none" stroke="#FFFFFF" '
            f'stroke-opacity="0.9" stroke-width="0.9" stroke-linecap="round"/>')


def integral(cx, cy, s, w, stroke):
    d = (f'M{num(cx + 6.2 * s)},{num(cy - 12.6 * s)} '
         f'C{num(cx + 5.2 * s)},{num(cy - 16.2 * s)} {num(cx + 0.9 * s)},{num(cy - 16.0 * s)} {num(cx + 0.9 * s)},{num(cy - 10.5 * s)} '
         f'L{num(cx - 0.9 * s)},{num(cy + 10.5 * s)} '
         f'C{num(cx - 0.9 * s)},{num(cy + 16.0 * s)} {num(cx - 5.2 * s)},{num(cy + 16.2 * s)} {num(cx - 6.2 * s)},{num(cy + 12.6 * s)}')
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'


def ring_digits(size=3.7, fill='#5670D2', opacity=0.88, tracking=0.12):
    """the digits of pi round the ring, as outlines; they start at the upper left, and the tail interrupts them"""
    font = TTFont(FONT)
    glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    s = size / upm
    baseline = CY - R + size * 0.36

    def glyph(ch):
        g = glyphs[cmap[ord(ch)]]
        pen = SVGPathPen(glyphs, ntos=num)
        g.draw(TransformPen(pen, (s, 0, 0, -s, CX - g.width * s / 2, baseline)))
        return pen.getCommands(), g.width * s

    out, k = [], 0
    for start, end in ((-104.0, 110.0), (161.0, 248.0)):   # degrees, clockwise from the top
        angle, before = start, None
        while True:
            d, width = glyph(PI[k])
            if before is not None:
                angle += math.degrees((before / 2 + width / 2 + tracking) / R)
            if angle > end:
                break
            out.append(f'<path d="{d}" transform="rotate({num(angle)} {CX} {CY})"/>')
            before, k = width, k + 1
    return f'<g fill="{fill}" fill-opacity="{opacity}">\n' + '\n'.join(out) + '\n</g>'


def color_icon():
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- QCalc icon: a "Q" whose tail is an "=" sign. The Q is a window onto a 3D graph, the digits of pi
     run round its ring, and an integral sign stands beside the peak.
     108 x 108 like an adaptive icon; the part that is always visible is the circle of radius 33 round
     the centre. Written by icon/draw-icon.py: change the drawing there, not here.
     icon/make-icons.sh cuts the two layers at the BACKGROUND and FOREGROUND comments. -->
<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">
<defs>
  <radialGradient id="bg" cx="0.36" cy="0.30" r="0.85">
    <stop offset="0" stop-color="#3559E8"/><stop offset="0.45" stop-color="#1B2A9A"/><stop offset="1" stop-color="#0A0E3F"/>
  </radialGradient>
  <linearGradient id="white" x1="0.15" y1="0.1" x2="0.85" y2="0.95">
    <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.6" stop-color="#EEF3FF"/><stop offset="1" stop-color="#C4D3FF"/>
  </linearGradient>
  <linearGradient id="amber" x1="0.1" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#FFE27A"/><stop offset="0.5" stop-color="#FFB627"/><stop offset="1" stop-color="#FF7A1A"/>
  </linearGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/><feOffset dx="0.8" dy="2.0" result="b"/>
    <feComponentTransfer in="b" result="s"><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
    <feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="window"><circle cx="{CX}" cy="{CY}" r="{num(WINDOW)}"/></clipPath>
</defs>
<!--BACKGROUND-->
<rect width="108" height="108" fill="url(#bg)"/>
<!--/BACKGROUND-->
<!--FOREGROUND-->
<circle cx="{CX}" cy="{CY}" r="{num(WINDOW)}" fill="#070B2E"/>
<g clip-path="url(#window)">
{surface(CX + 2.2, CY + 4.4, 12.2)}
<g filter="url(#shadow)">{integral(CX - 8.4, CY - 3.6, 0.56, 2.8, 'url(#amber)')}</g>
</g>
<g filter="url(#shadow)">
{ring('url(#white)')}
{tail('url(#amber)')}
</g>
{ring_digits()}
{gloss()}
<!--/FOREGROUND-->
</svg>
'''


def mono_icon():
    """one color only (the launcher colors it): the Q with its "=" tail, the peak and the integral sign"""
    cx, base, h, sigma = CX + 2.2, CY + 8.2, 15.5, 4.6
    xs = [cx - 20 + 40 * i / 80 for i in range(81)]
    peak = 'M' + ' L'.join(f'{num(x)},{num(base - h * math.exp(-((x - cx) / sigma) ** 2))}' for x in xs)
    peak += f' L{num(xs[-1])},{num(CY + R)} L{num(xs[0])},{num(CY + R)}Z'
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- QCalc icon in one color, for themed icons (Android 13 and later): the launcher uses only its shape.
     Written by icon/draw-icon.py: change the drawing there, not here. -->
<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108">
<defs><clipPath id="window"><circle cx="{CX}" cy="{CY}" r="{num(WINDOW - 1.6)}"/></clipPath></defs>
<g clip-path="url(#window)">
<path d="{peak}" fill="#FFFFFF"/>
{integral(CX - 8.4, CY - 4.4, 0.56, 2.8, '#FFFFFF')}
</g>
{ring('#FFFFFF')}
{tail('#FFFFFF')}
</svg>
'''


if __name__ == '__main__':
    for name, text in (('qcalc-icon.svg', color_icon()), ('qcalc-icon-mono.svg', mono_icon())):
        with open(os.path.join(HERE, name), 'w', encoding='utf-8') as out:
            out.write(text)
        print(name, len(text), 'bytes')
