# Shared by build-apk.sh and build-aab.sh (not run directly).
# Compiles the Java code to classes.dex and prepares the manifest.
#
# Android SDK platform files (from Android Studio's SDK Manager or
# `sdkmanager "platforms;android-36" "platforms;android-34"`); they are not part of this source:
#   ANDROID_JAR      android.jar of API 36, for compiling the Java code
#   AAPT2_JAR        android.jar of API 34, for aapt2 (the aapt2 of Ubuntu cannot read the
#                    resource table of API 35 and later; resources here need nothing newer)
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
ANDROID_JAR="${ANDROID_JAR:-$SDK/platforms/android-36/android.jar}"
AAPT2_JAR="${AAPT2_JAR:-$SDK/platforms/android-34/android.jar}"
MIN_SDK=24
TARGET_SDK=36
PACKAGE=io.github.hiroshitsu.qcalc
A="$P/app"
OUT="$P/out"
ENGINE="$A/jniLibs/arm64-v8a/libqalcengine.so"
VERSION_NAME=$(sed -n 's/^VERSION_NAME=//p' "$P/version.properties" | tr -d '\r')
VERSION_CODE=$(sed -n 's/^VERSION_CODE=//p' "$P/version.properties" | tr -d '\r')

check_inputs() {
  [ -n "$VERSION_NAME" ] && [ -n "$VERSION_CODE" ] || { echo "version.properties: VERSION_NAME / VERSION_CODE missing"; exit 1; }
  [ -f "$ENGINE" ] || { echo "engine not found: $ENGINE (run ./build-engine.sh)"; exit 1; }
  [ -f "$ANDROID_JAR" ] || { echo "android.jar (API 36) not found: $ANDROID_JAR (set ANDROID_JAR)"; exit 1; }
  [ -f "$AAPT2_JAR" ] || { echo "android.jar (API 34) not found: $AAPT2_JAR (set AAPT2_JAR)"; exit 1; }
}

# make_manifest <package> <output file>
# The source manifest has no package attribute (Gradle takes it from "namespace"); add it.
make_manifest() {
  sed "s|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">|<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"$1\">|" \
    "$A/AndroidManifest.xml" > "$2"
  grep -q "package=\"$1\"" "$2" || { echo "could not add the package attribute to the manifest"; exit 1; }
}

# build_dex <work dir>  ->  <work dir>/classes.dex
build_dex() {
  mkdir -p "$1/classes"
  find "$A/src" -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" -Xlint:-options -d "$1/classes"
  dalvik-exchange --dex --min-sdk-version=$MIN_SDK --output="$1/classes.dex" "$1/classes"
}
