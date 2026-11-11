#!/bin/bash
# Build the Android App Bundle (.aab) of QCalc for Google Play, signed with the upload key.
# Same sources as build-apk.sh (see there and build-common.sh), package io.github.hiroshitsu.qcalc.
#
# The bundle keeps the engine compressed in the APKs that Google Play makes from it
# (BundleConfig: uncompressNativeLibraries disabled), so Android extracts it to nativeLibraryDir
# at install time; the app runs it from there (android:extractNativeLibs="true").
#
# Upload key: signing/qcalc-upload.jks (alias "upload"). The password is read from the
# environment variable QCALC_UPLOAD_PASS or from the first line of signing/qcalc-upload.pass.
# Keep both private; Google Play only accepts bundles signed with the registered upload key.
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd)
. "$P/build-common.sh"
check_inputs
B="$P/build/aab"
KEYSTORE="${QCALC_UPLOAD_KEYSTORE:-$P/signing/qcalc-upload.jks}"
ALIAS="${QCALC_UPLOAD_ALIAS:-upload}"
[ -f "$KEYSTORE" ] || { echo "upload key not found: $KEYSTORE"; exit 1; }
if [ -z "${QCALC_UPLOAD_PASS:-}" ]; then
  [ -f "$P/signing/qcalc-upload.pass" ] || { echo "set QCALC_UPLOAD_PASS or write the password to signing/qcalc-upload.pass"; exit 1; }
  QCALC_UPLOAD_PASS=$(head -n 1 "$P/signing/qcalc-upload.pass" | tr -d '\r\n')
fi
export QCALC_UPLOAD_PASS

rm -rf "$B"
mkdir -p "$B" "$OUT"

# ---- resources and manifest in protocol-buffer form (what a bundle contains)
make_manifest "$PACKAGE" "$B/AndroidManifest.xml"
aapt2 compile --dir "$A/res" -o "$B/res.zip"
aapt2 link --proto-format -o "$B/base-proto.zip" -I "$AAPT2_JAR" --manifest "$B/AndroidManifest.xml" -A "$A/assets" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$B/res.zip"

# ---- Java -> dex
build_dex "$B"

# ---- assemble the bundle: BundleConfig.pb and the "base" module
python3 - "$B/base-proto.zip" "$B/classes.dex" "$ENGINE" "$B/unsigned.aab" <<'PY'
import sys, zipfile
proto, dex, engine, out = sys.argv[1:5]

def field(num, payload):            # length-delimited protobuf field
    tag = bytes([num << 3 | 2])
    n, size = len(payload), b''
    while True:
        b = n & 0x7f; n >>= 7
        size += bytes([b | (0x80 if n else 0)])
        if not n: break
    return tag + size + payload

# BundleConfig { bundletool { version: "1.17.2" }
#                optimizations { uncompress_native_libraries { enabled: false } } }
bundle_config = field(1, field(2, b'1.17.2')) + field(2, field(2, b''))

STAMP = (1981, 1, 1, 1, 1, 2)
def add(z, name, data):
    info = zipfile.ZipInfo(name, STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    z.writestr(info, data)

with zipfile.ZipFile(proto) as src, zipfile.ZipFile(out, 'w') as z:
    add(z, 'BundleConfig.pb', bundle_config)
    names = sorted(n for n in src.namelist() if not n.endswith('/'))
    for n in names:
        if n == 'AndroidManifest.xml':
            add(z, 'base/manifest/AndroidManifest.xml', src.read(n))
    add(z, 'base/dex/classes.dex', open(dex, 'rb').read())
    for n in names:
        if n == 'resources.pb' or n.startswith('res/') or n.startswith('assets/'):
            add(z, 'base/' + n, src.read(n))
    add(z, 'base/lib/arm64-v8a/libqalcengine.so', open(engine, 'rb').read())
PY

# ---- sign with the upload key (JAR signature, as Google Play expects for bundles)
AAB="$OUT/QCalc-$VERSION_NAME.aab"
jarsigner -keystore "$KEYSTORE" -storepass:env QCALC_UPLOAD_PASS -digestalg SHA-256 -sigalg SHA256withRSA \
  -signedjar "$AAB" "$B/unsigned.aab" "$ALIAS" >/dev/null
jarsigner -verify "$AAB" >/dev/null || { echo "signature check failed"; exit 1; }
echo "AAB: $AAB"
