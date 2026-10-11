// Reproducible adaptations to upstream 141c1476dd462ac3526f796e303177616f4de6bc.
const fs = require('node:fs');
const path = require('node:path');
const source = path.resolve(process.argv[2] || '.pvz-source');
const project = path.resolve(__dirname, '../..');
function edit(file, before, after) {
  const target = path.join(source, file);
  const text = fs.readFileSync(target, 'utf8');
  if (!text.includes(before)) throw new Error(`Upstream anchor missing: ${file}`);
  if (text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`Upstream anchor ambiguous: ${file}`);
  fs.writeFileSync(target, text.replace(before, after));
}
const gl = 'src/SexyAppFramework/graphics/GLInterface.cpp';
const windowFile = 'src/SexyAppFramework/platform/emscripten/Window.cpp';
edit('src/SexyAppFramework/SexyAppBase.cpp', '\tstd::unique_ptr<ImageLib::Image> aLoadedImage(ImageLib::GetImage(theFileName, true));', '\tstd::unique_ptr<ImageLib::Image> aLoadedImage(ImageLib::GetImage(theFileName, true));\n' + fs.readFileSync(path.join(project, 'scripts/pvz/retouch-art.inc'), 'utf8'));
// The animation atlas is generated once from immutable sprite resources. It
// can use the same bicubic GPU sampling as static resource images.
edit('src/PvzpLib/ReanimAtlas.cpp', 'FixPixelsOnAlphaEdgeForBlending(mMemoryImage.get());', 'FixPixelsOnAlphaEdgeForBlending(mMemoryImage.get());\n\tmMemoryImage->mFilePath = "__may_static_reanimation_atlas";');
edit(gl, '#include <vector>', '#include <vector>\n#include <filesystem>\n#include <cctype>\n#include <cmath>\n#include <algorithm>\n#include "imagelib/ImageLib.h"');
edit(gl, 'bool gDesktopGLFallback = false;', 'bool gDesktopGLFallback = false;\nbool gMaySmooth = false;');
edit(gl, 'void TextureData::CreateTextures(MemoryImage *theImage)', fs.readFileSync(path.join(project, 'scripts/pvz/hd-textures.inc'), 'utf8') + '\nvoid TextureData::CreateTextures(MemoryImage *theImage)');
edit(gl, '\ttheImage->CommitBits();\n\n\tif (!theImage->mHasAlpha', '\ttheImage->CommitBits();\n\tauto mayHd = MayLoadHd(theImage);\n\t// Keep every tile below the GPU maximum; use original-art bicubic sampling when no suitable HD replacement exists.\n\tif (mayHd && (mayHd->mWidth > MAX_TEXTURE_SIZE || mayHd->mHeight > MAX_TEXTURE_SIZE)) mayHd.reset();\n\tif (!mayHd) mayHd = MayUpscaleOriginal(theImage);\n\tint mayScale = mayHd ? mayHd->mWidth / theImage->mWidth : 1;\n\n\tif (!theImage->mHasAlpha');
edit(gl, '\tbool createTextures = false;\n\tif (mWidth', '\tif (mayHd) aFormat = PixelFormat_A8R8G8B8;\n\tbool createTextures = false;\n\tif (mayScale != mMayHdScale || mWidth');
edit(gl, '\t\tmPixelFormat = aFormat;\n\t\tmImageFlags', '\t\tmPixelFormat = aFormat;\n\t\tmMayHdScale = mayScale;\n\t\tmImageFlags');
edit(gl, '\t\t\t\tmTexMemSize += piece.mWidth * piece.mHeight * fmtSize;', '\t\t\t\tmTexMemSize += piece.mWidth * piece.mHeight * fmtSize * mayScale * mayScale;');
edit(gl, '\t\t\tCopyImageToTexture(theImage, x, y, piece.mWidth, piece.mHeight, aFormat, createTextures);', '\t\t\tif (mayHd) MayUploadHd(mayHd.get(), mayScale, x, y, piece.mWidth, piece.mHeight, createTextures, (theImage->mRenderFlags & RenderImageFlag_Repeat) != 0);\n\t\t\telse CopyImageToTexture(theImage, x, y, piece.mWidth, piece.mHeight, aFormat, createTextures);');
edit(gl, 'int f = gLinearFilter ? GL_LINEAR : GL_NEAREST;', 'int f = (gLinearFilter || gMaySmooth) ? GL_LINEAR : GL_NEAREST;');
// Clamp at half a physical texel, rather than half a logical pixel in HD mode.
let text = fs.readFileSync(path.join(source, gl), 'utf8');
text = text.replaceAll('0.5f / p.mWidth', '0.5f / (p.mWidth * mMayHdScale)').replaceAll('0.5f / p.mHeight', '0.5f / (p.mHeight * mMayHdScale)')
  .replaceAll('0.5f / piece.mWidth', '0.5f / (piece.mWidth * mMayHdScale)').replaceAll('0.5f / piece.mHeight', '0.5f / (piece.mHeight * mMayHdScale)');
fs.writeFileSync(path.join(source, gl), text);
edit('src/SexyAppFramework/graphics/GLInterface.h', '\tint mImageFlags;', '\tint mImageFlags;\n\tint mMayHdScale = 1;');
edit(windowFile, 'using namespace Sexy;', 'using namespace Sexy;\nextern bool gMaySmooth;');
edit(windowFile, '\t\tWindowPtr window(SDL_CreateWindow(', '\t\tgMaySmooth = EM_ASM_INT({ return Module.maySmooth ? 1 : 0; });\n\t\tint mayWidth = EM_ASM_INT({ return Module.mayWidth || 800; });\n\t\tint mayHeight = EM_ASM_INT({ return Module.mayHeight || 600; });\n\t\tWindowPtr window(SDL_CreateWindow(');
edit(windowFile, '\t\t\tmWidth, mHeight, winFlags)', '\t\t\tmayWidth, mayHeight, winFlags)');
edit(windowFile, '\tmWidgetManager->Resize(mScreenBounds, mGLInterface->mPresentationRect);', '\tmWidgetManager->Resize(mScreenBounds, mGLInterface->mPresentationRect);\n\tEM_ASM({ if (window.mayOnWindow) requestAnimationFrame(window.mayOnWindow); });');
fs.copyFileSync(path.join(project, 'scripts/pvz/bridge.cpp'), path.join(source, 'src/MayGameBridge.cpp'));
// Our launcher defines Module before loading the generated .js; this shell only satisfies the linker.
fs.mkdirSync(path.join(source, 'wasm'), { recursive: true });
fs.writeFileSync(path.join(source, 'wasm/shell.html'), '<!doctype html><html><body><canvas id="canvas"></canvas>{{{ SCRIPT }}}</body></html>\n');
console.log('Applied Máy Game framebuffer, controls and HD texture adaptations.');
