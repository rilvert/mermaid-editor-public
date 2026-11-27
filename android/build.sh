#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
if [[ -z $sdk ]]; then
  sdk="$HOME/Android/Sdk"
  if [[ $(uname -s) == Darwin ]]; then sdk="$HOME/Library/Android/sdk"; fi
fi
tools="$sdk/build-tools/34.0.0"
platform="$sdk/platforms/android-34/android.jar"
if [[ ! -f $platform || ! -x $tools/aapt2 ]]; then
  printf '%s\n' 'Android SDK Platform 34 und Build Tools 34.0.0 fehlen. Setze ANDROID_HOME auf das Android SDK.' >&2
  exit 1
fi
if [[ -n ${JAVA_HOME:-} ]]; then export PATH="$JAVA_HOME/bin:$PATH"; fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes" "$work/dex" "$work/assets/web" android/build
cp public/index.html public/style.css public/icon.svg "$work/assets/web/"
MME_WEB_OUTDIR="$work/assets/web/dist" node build.mjs
version_name=$(node -p 'require("./package.json").version')
version_code=$(node -e 'const [major, minor, patch] = require("./package.json").version.split(".").map(Number); console.log(major * 1000000 + minor * 1000 + patch)')
debug=()
if [[ ${1:-} == --debug ]]; then debug=(--debug-mode); fi

"$tools/aapt2" compile --dir android/res -o "$work/resources.zip"
"$tools/aapt2" link -I "$platform" --manifest android/AndroidManifest.xml -A "$work/assets" \
  "${debug[@]}" --version-code "$version_code" --version-name "$version_name" \
  --java "$work" -o "$work/resources.apk" "$work/resources.zip"
javac --release 8 -classpath "$platform" -d "$work/classes" \
  "$work/de/mermaideditor/R.java" android/src/de/mermaideditor/*.java
jar cf "$work/classes.jar" -C "$work/classes" .
"$tools/d8" --min-api 26 --lib "$platform" --output "$work/dex" "$work/classes.jar"
(cd "$work/dex" && jar uf "$work/resources.apk" classes.dex)
"$tools/zipalign" -f 4 "$work/resources.apk" "$work/aligned.apk"

keystore="${ANDROID_USER_HOME:-$HOME/.android}/debug.keystore"
if [[ ! -f $keystore ]]; then
  mkdir -p "$(dirname "$keystore")"
  keytool -genkeypair -keystore "$keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
fi
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias androiddebugkey \
  --ks-pass pass:android --key-pass pass:android --out "$work/Mermaid-Editor.apk" "$work/aligned.apk"
"$tools/apksigner" verify "$work/Mermaid-Editor.apk"
mv "$work/Mermaid-Editor.apk" android/build/Mermaid-Editor.apk
printf '%s\n' 'android/build/Mermaid-Editor.apk'
