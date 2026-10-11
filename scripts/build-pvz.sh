#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_ENGINE="${TASK_ROOT}/.pvz-source"
TASK_OPENMPT="${TASK_ROOT}/.openmpt-source"
TASK_BUILD="${TASK_ROOT}/.pvz-build"
TASK_PREFIX="${TASK_BUILD}/openmpt-prefix"
mkdir -p "${TASK_BUILD}"
node "${TASK_ROOT}/scripts/patch-pvz.cjs" "${TASK_ENGINE}"
node "${TASK_ROOT}/scripts/patch-pvz-widescreen.cjs" "${TASK_ENGINE}"
cd "${TASK_OPENMPT}"
emmake make CONFIG=emscripten STATIC_LIB=1 SHARED_LIB=0 EXAMPLES=0 OPENMPT123=0 TEST=0 \
  NO_ZLIB=1 NO_MPG123=1 NO_OGG=1 NO_VORBIS=1 NO_VORBISFILE=1 \
  NO_PORTAUDIO=1 NO_PORTAUDIOCPP=1 NO_PULSEAUDIO=1 NO_SDL2=1 NO_FLAC=1 NO_SNDFILE=1 -j2
emmake make CONFIG=emscripten STATIC_LIB=1 SHARED_LIB=0 EXAMPLES=0 OPENMPT123=0 TEST=0 PREFIX="${TASK_PREFIX}" install
emcmake cmake -S "${TASK_ENGINE}" -B "${TASK_BUILD}/engine" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_FIND_ROOT_PATH="${TASK_PREFIX}" -DPVZ_DEBUG=OFF -DDO_FIX_BUGS=OFF
cmake --build "${TASK_BUILD}/engine" -j2
mkdir -p "${TASK_ROOT}/games/pvz-goty/engine" "${TASK_ROOT}/games/pvz-goty/vendor"
cp "${TASK_BUILD}/engine/pvz-portable.js" "${TASK_BUILD}/engine/pvz-portable.wasm" "${TASK_ROOT}/games/pvz-goty/engine/"
cp "${TASK_ENGINE}/LICENSE" "${TASK_ENGINE}/COPYING" "${TASK_ROOT}/games/pvz-goty/engine/"
cp "${TASK_ROOT}/.jszip-source/dist/jszip.min.js" "${TASK_ROOT}/games/pvz-goty/vendor/"
cp "${TASK_ROOT}/.jszip-source/LICENSE.markdown" "${TASK_ROOT}/games/pvz-goty/vendor/JSZIP-LICENSE.md"
# Distribute the exact modified source with the binary, including vendored notices and dependencies.
TASK_SOURCE_EXPORT="${TASK_BUILD}/source-export"
mkdir -p "${TASK_SOURCE_EXPORT}/PvZ-Portable" "${TASK_SOURCE_EXPORT}/OpenMPT" "${TASK_SOURCE_EXPORT}/MayGame/games"
git -C "${TASK_ENGINE}" archive HEAD | tar -x -C "${TASK_SOURCE_EXPORT}/PvZ-Portable"
cp -R "${TASK_ENGINE}/src/." "${TASK_SOURCE_EXPORT}/PvZ-Portable/src/"
cp "${TASK_ENGINE}/src/MayGameBridge.cpp" "${TASK_SOURCE_EXPORT}/PvZ-Portable/src/"
cp "${TASK_ENGINE}/src/SexyAppFramework/graphics/GLInterface.cpp" "${TASK_SOURCE_EXPORT}/PvZ-Portable/src/SexyAppFramework/graphics/"
cp "${TASK_ENGINE}/src/SexyAppFramework/graphics/GLInterface.h" "${TASK_SOURCE_EXPORT}/PvZ-Portable/src/SexyAppFramework/graphics/"
cp "${TASK_ENGINE}/src/SexyAppFramework/platform/emscripten/Window.cpp" "${TASK_SOURCE_EXPORT}/PvZ-Portable/src/SexyAppFramework/platform/emscripten/"
cp "${TASK_ENGINE}/wasm/shell.html" "${TASK_SOURCE_EXPORT}/PvZ-Portable/wasm/"
git -C "${TASK_OPENMPT}" archive HEAD | tar -x -C "${TASK_SOURCE_EXPORT}/OpenMPT"
cp -R "${TASK_ROOT}/scripts" "${TASK_ROOT}/docs" "${TASK_SOURCE_EXPORT}/MayGame/"
mkdir -p "${TASK_SOURCE_EXPORT}/MayGame/games/pvz-goty"
tar --exclude='./data' --exclude='./resources.json' -C "${TASK_ROOT}/games/pvz-goty" -cf - . | tar -xf - -C "${TASK_SOURCE_EXPORT}/MayGame/games/pvz-goty"
rm -f "${TASK_SOURCE_EXPORT}/MayGame/games/pvz-goty/engine/"*.wasm "${TASK_SOURCE_EXPORT}/MayGame/games/pvz-goty/engine/"*.js "${TASK_SOURCE_EXPORT}/MayGame/games/pvz-goty/engine/source.zip"
cd "${TASK_SOURCE_EXPORT}"
zip -qr "${TASK_ROOT}/games/pvz-goty/engine/source.zip" .
cd "${TASK_ROOT}"
mkdir -p .site
git archive HEAD | tar -x -C .site
cp -R games/pvz-goty/engine games/pvz-goty/vendor .site/games/pvz-goty/
node -e 'const fs=require("fs"); const root=".site/games/pvz-goty/"; const manifest=JSON.parse(fs.readFileSync(root+"resources.json","utf8")); for(const file of manifest.files) if(!fs.statSync(root+"data/"+file.name).isFile()) throw Error("Missing resource: "+file.name); console.log("Packaged "+manifest.files.length+" PvZ resource files.");'
touch .site/.nojekyll
echo 'Built complete static site in .site, including the bundled PvZ resources.'
