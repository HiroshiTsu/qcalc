#!/bin/bash
# Make the launcher icons in app/res/mipmap-* from icon/qcalc-icon.svg, and the 512 x 512
# icon for the Google Play listing (store/icon-512.png).
# Only needed when the icon changes; the icons are kept in app/res.
# Tools: rsvg-convert (librsvg2-bin), convert (imagemagick), python3.
set -euo pipefail
P=$(cd "$(dirname "$0")/.." && pwd)
SVG="$P/icon/qcalc-icon.svg"
RES="$P/app/res"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# layers: full icon, glyph only (white on transparent), background only
python3 - "$SVG" "$TMP" <<'PY'
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
tmp = sys.argv[2]
glyph = re.sub(r'<rect id="background"[^>]*/>', '', src)
visible = src.replace('viewBox="0 0 108 108"', 'viewBox="18 18 72 72"')
open(tmp + '/glyph.svg', 'w').write(glyph)
open(tmp + '/visible.svg', 'w').write(visible)
PY
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${d%%:*}; f=${d##*:}
  mkdir -p "$RES/mipmap-$name"
  legacy=$(python3 -c "print(round(48*$f))")
  canvas=$(python3 -c "print(round(108*$f))")
  radius=$(python3 -c "print(round(48*$f*0.22))")
  # legacy icon (before Android 8.0): the visible 72 x 72 part, with rounded corners
  rsvg-convert -w "$legacy" -h "$legacy" "$TMP/visible.svg" -o "$TMP/full.png"
  convert -size "${legacy}x${legacy}" xc:none -fill white -draw "roundrectangle 0,0,$((legacy-1)),$((legacy-1)),$radius,$radius" "$TMP/mask.png"
  convert "$TMP/full.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite -define png:exclude-chunks=date,time "PNG32:$RES/mipmap-$name/ic_launcher.png"
  # adaptive icon layers (Android 8.0 and later); the monochrome layer is for themed icons (Android 13)
  rsvg-convert -w "$canvas" -h "$canvas" "$TMP/glyph.svg" -o "$TMP/glyph.png"
  convert "$TMP/glyph.png" -define png:exclude-chunks=date,time "PNG32:$RES/mipmap-$name/ic_launcher_foreground.png"
  cp "$RES/mipmap-$name/ic_launcher_foreground.png" "$RES/mipmap-$name/ic_launcher_monochrome.png"
done
# Google Play listing icon: 512 x 512, full square (Google Play rounds the corners itself)
mkdir -p "$P/store"
rsvg-convert -w 512 -h 512 "$TMP/visible.svg" -o "$TMP/play.png"
convert "$TMP/play.png" -define png:exclude-chunks=date,time "PNG32:$P/store/icon-512.png"
echo "icons written to $RES/mipmap-* and $P/store/icon-512.png"
