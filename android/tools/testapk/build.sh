#!/bin/bash
# Builds two harmless synthetic APKs used to test the Android layer:
#  dt-test-threat.apk — banker-like manifest (SMS + accessibility + overlay + device admin, no launcher icon) and indicator strings in its DEX
#  dt-test-clean.apk  — ordinary app (launcher icon, INTERNET only)
# Neither contains functional malicious code: the "threat" only carries strings/permissions to exercise the detector.
set -e
source /workspace/tools/env.sh
BT=$ANDROID_HOME/build-tools/35.0.0; AJ=$ANDROID_HOME/platforms/android-35/android.jar
cd "$(dirname "$0")"; rm -rf out; mkdir -p out
mkks() { [ -f out/test.jks ] || keytool -genkeypair -keystore out/test.jks -storepass testtest -keypass testtest -alias t -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=DT Test" >/dev/null 2>&1; }
mkks
build() { # name pkgdir
  local n=$1 d=$2
  mkdir -p out/$n/classes out/$n/dex
  $BT/aapt2 link -o out/$n/base.apk -I $AJ --manifest $d/AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 35
  javac -source 8 -target 8 -bootclasspath $AJ -d out/$n/classes $(find $d -name '*.java') 2>/dev/null
  java -cp $BT/lib/d8.jar com.android.tools.r8.D8 --release --min-api 26 --lib $AJ --output out/$n/dex $(find out/$n/classes -name '*.class')
  cp out/$n/base.apk out/$n/u.apk; (cd out/$n/dex && zip -q ../u.apk classes.dex)
  $BT/zipalign -f 4 out/$n/u.apk out/$n/a.apk
  java -jar $BT/lib/apksigner.jar sign --ks out/test.jks --ks-pass pass:testtest --out out/$n.apk out/$n/a.apk
}
build dt-test-threat threat
build dt-test-clean clean
ls -la out/*.apk
