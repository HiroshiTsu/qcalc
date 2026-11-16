#!/bin/bash
# Unpack the sources of the engine into src/ for build-engine.sh.
# The tarballs are kept in third_party/ (see third_party/README.md); a missing one is downloaded
# from its original place:
#   libqalculate 5.13.2  https://github.com/Qalculate/libqalculate (tag v5.13.2, as a git archive)
#   GMP 6.3.0, MPFR 4.2.2, libxml2 2.15.4 (upstream tarballs as distributed by Ubuntu)
#   FLINT 3.6.0          https://github.com/flintlib/flint (the release tarball)
# libqalculate is then patched (patches/): see patches/README.md.
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd)
T="$P/third_party"
mkdir -p "$T" "$P/src"
get() {  # get <file> <url>
  [ -f "$T/$1" ] || curl -sSfL -o "$T/$1" "$2"
}
get gmp_6.3.0+dfsg.orig.tar.xz https://archive.ubuntu.com/ubuntu/pool/main/g/gmp/gmp_6.3.0+dfsg.orig.tar.xz
get mpfr4_4.2.2.orig.tar.xz https://archive.ubuntu.com/ubuntu/pool/main/m/mpfr4/mpfr4_4.2.2.orig.tar.xz
get libxml2_2.15.4+dfsg.orig.tar.xz "https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.15.4+dfsg.orig.tar.xz"
get flint-3.6.0.tar.gz https://github.com/flintlib/flint/releases/download/v3.6.0/flint-3.6.0.tar.gz
(cd "$T" && sha256sum --quiet -c SHA256SUMS)
if [ ! -f "$T/libqalculate-5.13.2.tar.xz" ]; then
  tmp=$(mktemp -d)
  git clone -q --depth 1 --branch v5.13.2 https://github.com/Qalculate/libqalculate "$tmp/lq"
  git -C "$tmp/lq" archive --format=tar --prefix=libqalculate-5.13.2/ HEAD | xz -9 > "$T/libqalculate-5.13.2.tar.xz"
  rm -rf "$tmp"
fi
cd "$P/src"
for f in "$T"/*.tar.xz "$T"/*.tar.gz; do tar xf "$f"; done
# QCalc's changes to libqalculate (the files were just unpacked again, so the patch always applies)
for f in "$P"/patches/libqalculate-5.13.2-*.patch; do patch -s -d libqalculate-5.13.2 -p1 < "$f"; done
# Debian removed GMP's documentation directory; configure still expects doc/Makefile.in
mkdir -p gmp-6.3.0+dfsg/doc
printf 'all:\n\t@:\n.DEFAULT:\n\t@:\n' > gmp-6.3.0+dfsg/doc/Makefile.in
echo "sources ready in $P/src"
