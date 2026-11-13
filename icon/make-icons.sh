#!/bin/bash
# Make the launcher icons in app/res/mipmap-* from icon/qcalc-icon.svg (in color, two layers) and
# icon/qcalc-icon-mono.svg (one color), and the 512 x 512 icon for the Google Play listing
# (store/icon-512.png; a copy goes to docs/ for the web page).
# Only needed when the icon changes; the icons are kept in app/res.
# The two SVG files are written by icon/draw-icon.py.
# The icons are WebP files (much smaller than PNG; every Android version that QCalc supports reads them).
# Tools: rsvg-convert (librsvg2-bin), convert (imagemagick, with WebP support), python3.
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd)
SVG="$P/icon/qcalc-icon.svg"
MONO="$P/icon/qcalc-icon-mono.svg"
RES="$P/app/res"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# layers: the background alone, the foreground alone (on transparent), and the part that launchers show
python3 - "$SVG" "$TMP" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
tmp = sys.argv[2]
def without(layer):
    out, n = re.subn(r'<!--%s-->.*?<!--/%s-->' % (layer, layer), '', src, flags=re.S)
    assert n == 1, layer
    return out
open(tmp + '/foreground.svg', 'w', encoding='utf-8').write(without('BACKGROUND'))
open(tmp + '/background.svg', 'w', encoding='utf-8').write(without('FOREGROUND'))
open(tmp + '/visible.svg', 'w', encoding='utf-8').write(src.replace('viewBox="0 0 108 108"', 'viewBox="18 18 72 72"'))
PY
png() { convert "$1" -strip -define png:compression-level=9 -define png:exclude-chunks=date,time "PNG32:$2"; }
# WebP: the layers in color lose a little (not visibly) and keep the transparency exactly; the one-color layer loses nothing
webp() { convert "$1" -strip -define webp:method=6 -define webp:alpha-quality=100 -quality "$3" "$2"; }
webp_exact() { convert "$1" -strip -define webp:method=6 -define webp:lossless=true "$2"; }
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${d%%:*}; f=${d##*:}
  mkdir -p "$RES/mipmap-$name"
  # icons of an earlier format with the same names would be the same resources twice
  rm -f "$RES/mipmap-$name/ic_launcher.png" "$RES/mipmap-$name/ic_launcher_background.png" "$RES/mipmap-$name/ic_launcher_foreground.png" "$RES/mipmap-$name/ic_launcher_monochrome.png"
  legacy=$(python3 -c "print(round(48*$f))")
  canvas=$(python3 -c "print(round(108*$f))")
  radius=$(python3 -c "print(round(48*$f*0.22))")
  # legacy icon (before Android 8.0): the visible 72 x 72 part, with rounded corners
  rsvg-convert -w "$legacy" -h "$legacy" "$TMP/visible.svg" -o "$TMP/full.png"
  convert -size "${legacy}x${legacy}" xc:none -fill white -draw "roundrectangle 0,0,$((legacy-1)),$((legacy-1)),$radius,$radius" "$TMP/mask.png"
  convert "$TMP/full.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite "$TMP/legacy.png"
  webp "$TMP/legacy.png" "$RES/mipmap-$name/ic_launcher.webp" 92
  # adaptive icon layers (Android 8.0 and later); the monochrome layer is for themed icons (Android 13)
  rsvg-convert -w "$canvas" -h "$canvas" "$TMP/background.svg" -o "$TMP/background.png"
  webp "$TMP/background.png" "$RES/mipmap-$name/ic_launcher_background.webp" 90
  rsvg-convert -w "$canvas" -h "$canvas" "$TMP/foreground.svg" -o "$TMP/foreground.png"
  webp "$TMP/foreground.png" "$RES/mipmap-$name/ic_launcher_foreground.webp" 92
  rsvg-convert -w "$canvas" -h "$canvas" "$MONO" -o "$TMP/mono.png"
  webp_exact "$TMP/mono.png" "$RES/mipmap-$name/ic_launcher_monochrome.webp"
done
# Google Play listing icon: 512 x 512 PNG, full square (Google Play rounds the corners itself)
mkdir -p "$P/store"
rsvg-convert -w 512 -h 512 "$TMP/visible.svg" -o "$TMP/play.png"
png "$TMP/play.png" "$P/store/icon-512.png"
[ -d "$P/docs" ] && cp "$P/store/icon-512.png" "$P/docs/icon-512.png"
echo "icons written to $RES/mipmap-*, $P/store/icon-512.png and $P/docs/icon-512.png"
