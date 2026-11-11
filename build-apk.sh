#!/bin/bash
# Build a test APK of QCalc to install directly (adb install or a file manager):
#   package io.github.hiroshitsu.qcalc.debug, name "QCalc (debug)", so that it installs beside
#   the version from Google Play and keeps its own history and settings.
# For Google Play use build-aab.sh.
# Sources: app/AndroidManifest.xml, app/src (Java), app/res (+ app/res-debug), app/assets (UI),
#   app/jniLibs/arm64-v8a/libqalcengine.so (engine, made by build-engine.sh), version.properties.
# Tools: aapt2, javac, dalvik-exchange (dx), zipalign, apksigner (Ubuntu packages); see build-common.sh
# for the Android SDK platform files.
#
# Signing: signing/qcalc-debug.keystore (created on the first build; only for these test APKs).
set -euo pipefail
P=$(cd "$(dirname "$0")" && pwd)
. "$P/build-common.sh"
check_inputs
B="$P/build/apk"
KEYSTORE="$P/signing/qcalc-debug.keystore"
DEBUG_PACKAGE="$PACKAGE.debug"

rm -rf "$B"
mkdir -p "$B/stage/lib/arm64-v8a" "$OUT"

# ---- resources and manifest (app/res-debug overrides the app name)
# The manifest gets the package of the Java code, so ".MainActivity" means
# io.github.hiroshitsu.qcalc.MainActivity. aapt2 then renames the package to ….qcalc.debug and
# writes the class names out in full, as Gradle does for applicationIdSuffix. (Writing ….debug into
# the manifest directly would make Android look for ….qcalc.debug.MainActivity, which does not exist.)
make_manifest "$PACKAGE" "$B/AndroidManifest.xml"
aapt2 compile --dir "$A/res" -o "$B/res.zip"
aapt2 compile --dir "$A/res-debug" -o "$B/res-debug.zip"
aapt2 link -o "$B/app-unsigned.apk" -I "$AAPT2_JAR" --manifest "$B/AndroidManifest.xml" -A "$A/assets" \
  --rename-manifest-package "$DEBUG_PACKAGE" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME-debug" \
  "$B/res.zip" -R "$B/res-debug.zip" --auto-add-overlay
aapt2 dump badging "$B/app-unsigned.apk" 2>/dev/null | grep -q "^launchable-activity: name='$PACKAGE.MainActivity'" \
  || { echo "manifest: the launcher activity is not $PACKAGE.MainActivity"; exit 1; }

# ---- Java -> dex, engine in lib/ (Android installs it as a file that can be run)
build_dex "$B"
cp "$B/classes.dex" "$B/stage/classes.dex"
cp "$ENGINE" "$B/stage/lib/arm64-v8a/libqalcengine.so"
python3 - "$B/app-unsigned.apk" "$B/stage" <<'PY'
import os, sys, zipfile
apk, stage = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(stage):
        for f in sorted(files):
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, stage))
PY

# ---- align and sign
zipalign -f -p 4 "$B/app-unsigned.apk" "$B/app-aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -storepass android -keypass android \
    -alias debug -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=QCalc debug" >/dev/null 2>&1
  echo "New key for test builds: $KEYSTORE"
fi
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --ks-key-alias debug \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$OUT/QCalc-$VERSION_NAME-debug.apk" "$B/app-aligned.apk"
rm -f "$OUT"/*.idsig
echo "APK: $OUT/QCalc-$VERSION_NAME-debug.apk"
