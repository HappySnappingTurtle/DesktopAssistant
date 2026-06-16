#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "Downloading Live2D model assets..."

CURL_OPTS="-sL --retry 3"

# March 7th
DEST="public/characters/march7th/model"
BASE="https://raw.githubusercontent.com/v3ucn/live2d-TTS-LLM-GPT-SoVITS-Vtuber/main/models/March%207th"
mkdir -p "$DEST/March 7th.4096" "$DEST/exp" "$DEST/motions"
curl $CURL_OPTS -o "$DEST/March 7th.moc3" "$BASE/March%207th.moc3"
curl $CURL_OPTS -o "$DEST/March 7th.4096/texture_00.png" "$BASE/March%207th.4096/texture_00.png"
curl $CURL_OPTS -o "$DEST/March 7th.4096/texture_01.png" "$BASE/March%207th.4096/texture_01.png"
echo "  ✓ March 7th"

# Hiyori
DEST="public/characters/hiyori/model"
BASE="https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Hiyori"
mkdir -p "$DEST/Hiyori.2048" "$DEST/motions"
curl $CURL_OPTS -o "$DEST/Hiyori.moc3" "$BASE/Hiyori.moc3"
curl $CURL_OPTS -o "$DEST/Hiyori.2048/texture_00.png" "$BASE/Hiyori.2048/texture_00.png"
echo "  ✓ Hiyori"

# Natori
DEST="public/characters/natori/model"
BASE="https://raw.githubusercontent.com/Live2D/CubismWebSamples/develop/Samples/Resources/Natori"
mkdir -p "$DEST/Natori.2048" "$DEST/motions" "$DEST/exp"
curl $CURL_OPTS -o "$DEST/Natori.moc3" "$BASE/Natori.moc3"
curl $CURL_OPTS -o "$DEST/Natori.2048/texture_00.png" "$BASE/Natori.2048/texture_00.png"
echo "  ✓ Natori"

# Vendor JS
mkdir -p public/vendor
curl $CURL_OPTS -o public/vendor/live2dcubismcore.min.js "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
curl $CURL_OPTS -o public/vendor/live2d.min.js "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js"
echo "  ✓ Cubism SDK"

echo "Done! Run 'pnpm tauri dev' to start."
