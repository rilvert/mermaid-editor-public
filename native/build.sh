#!/bin/sh
# Baut "Mermaid Editor.app" (Swift + WKWebView). Voraussetzung: Xcode Command Line Tools.
set -e
cd "$(dirname "$0")/.."
APP="Mermaid Editor.app"

[ -f public/dist/main.js ] || node build.mjs

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -target arm64-apple-macos12.0 \
  -o "$APP/Contents/MacOS/MermaidEditor" native/main.swift \
  -framework Cocoa -framework WebKit -framework UniformTypeIdentifiers
cp native/Info.plist "$APP/Contents/Info.plist"
cp -R public "$APP/Contents/Resources/public"
cp native/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP" >/dev/null 2>&1
touch "$APP"
echo "Fertig: $APP"
