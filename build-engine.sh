#!/bin/bash
# Cross-compile GMP, MPFR, libxml2 and libqalculate 5.13.2 as static libraries for
# Android arm64 (aarch64) with zig, then build the engine program (bridge/qalc-engine).
# The engine is a static executable, so it needs no Android NDK and runs on any arm64 Android.
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd)
T=$P/tools
PREFIX=$P/prefix
B=$P/build
S=$P/src
HOST=aarch64-linux-musl
JOBS=$(nproc)

# zig (pip install ziglang==0.17.1) as the cross compiler
ZIG=$(python3 -c 'import ziglang, os; print(os.path.join(os.path.dirname(ziglang.__file__), "zig"))')
mkdir -p "$T"
printf '#!/bin/sh\nexec %s cc -target %s "$@"\n' "$ZIG" "$HOST" > "$T/zcc"
printf '#!/bin/sh\nexec %s c++ -target %s "$@"\n' "$ZIG" "$HOST" > "$T/zcxx"
printf '#!/bin/sh\nexec %s ar "$@"\n' "$ZIG" > "$T/zar"
printf '#!/bin/sh\nexec %s ranlib "$@"\n' "$ZIG" > "$T/zranlib"
chmod +x "$T"/*

export CC=$T/zcc CXX=$T/zcxx AR=$T/zar RANLIB=$T/zranlib
export CC_FOR_BUILD=gcc
export CFLAGS="-O2" CXXFLAGS="-O2"
export PKG_CONFIG_LIBDIR=$PREFIX/lib/pkgconfig
export PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig

step() { echo "=== $(date +%T) $*"; }

if [ ! -f "$PREFIX/lib/libgmp.a" ]; then
  step "GMP"
  rm -rf "$B/gmp" && mkdir -p "$B/gmp" && cd "$B/gmp"
  "$S/gmp-6.3.0+dfsg/configure" --host=$HOST --build=x86_64-pc-linux-gnu --prefix="$PREFIX" \
    --enable-static --disable-shared > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
  make -j"$JOBS" > make.log 2>&1 || { tail -40 make.log; exit 1; }
  make install > install.log 2>&1
fi

if [ ! -f "$PREFIX/lib/libmpfr.a" ]; then
  step "MPFR"
  rm -rf "$B/mpfr" && mkdir -p "$B/mpfr" && cd "$B/mpfr"
  "$S/mpfr-4.2.2/configure" --host=$HOST --build=x86_64-pc-linux-gnu --prefix="$PREFIX" \
    --with-gmp="$PREFIX" --enable-static --disable-shared > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
  make -j"$JOBS" > make.log 2>&1 || { tail -40 make.log; exit 1; }
  make install > install.log 2>&1
fi

if [ ! -f "$PREFIX/lib/libxml2.a" ]; then
  step "libxml2"
  rm -rf "$B/libxml2" && mkdir -p "$B/libxml2" && cd "$B/libxml2"
  "$S/libxml2-2.15.4/configure" --host=$HOST --build=x86_64-pc-linux-gnu --prefix="$PREFIX" \
    --enable-static --disable-shared --without-python --without-zlib --without-lzma \
    --without-icu --without-http --without-debug --without-catalog \
    > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
  make -j"$JOBS" > make.log 2>&1 || { tail -40 make.log; exit 1; }
  make install > install.log 2>&1
fi

if [ ! -f "$PREFIX/lib/libqalculate.a" ]; then
  step "libqalculate"
  cd "$S/libqalculate-5.13.2"
  [ -x configure ] || NOCONFIGURE=1 ./autogen.sh > "$B/lq-autogen.log" 2>&1 || { tail -30 "$B/lq-autogen.log"; exit 1; }
  rm -rf "$B/libqalculate" && mkdir -p "$B/libqalculate" && cd "$B/libqalculate"
  "$S/libqalculate-5.13.2/configure" --host=$HOST --build=x86_64-pc-linux-gnu --prefix="$PREFIX" \
    --enable-static --disable-shared --enable-compiled-definitions --disable-insecure \
    --without-libcurl --without-icu --without-gnuplot-call --with-readline=no --disable-nls \
    CPPFLAGS="-I$PREFIX/include" LDFLAGS="-L$PREFIX/lib -static" \
    > configure.log 2>&1 || { tail -40 configure.log; exit 1; }
  make -j"$JOBS" > make.log 2>&1 || { tail -60 make.log; exit 1; }
  make install > install.log 2>&1 || { tail -30 install.log; exit 1; }
fi

step "engine (bridge/qalc-engine)"
"$T/zcxx" -O2 -std=c++17 -static -I"$PREFIX/include" -I"$PREFIX/include/libxml2" \
  -DQALC_ENGINE_VERSION='"5.13.2"' "$P/bridge/qalc-engine.cc" \
  -L"$PREFIX/lib" -lqalculate -lxml2 -lmpfr -lgmp -lpthread -lm \
  -Wl,-z,max-page-size=16384 -s -o "$P/bridge/qalc-engine"
# the APK takes the engine from app/jniLibs (both build-apk.sh and Android Studio)
mkdir -p "$P/app/jniLibs/arm64-v8a"
cp "$P/bridge/qalc-engine" "$P/app/jniLibs/arm64-v8a/libqalcengine.so"
step "done"
ls -la "$P/bridge/qalc-engine" "$P/app/jniLibs/arm64-v8a/libqalcengine.so"
