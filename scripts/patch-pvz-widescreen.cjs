// Extend the camera, keeping the original 800x600 game coordinates and rules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2] || '.pvz-source');
function edit(file, before, after) {
  const target = path.join(root, 'src', file);
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(before)) throw new Error(`Widescreen anchor missing: ${file}`);
  fs.writeFileSync(target, source.replaceAll(before, after));
}
const gl = 'SexyAppFramework/graphics/GLInterface.cpp';
edit(gl, 'mWidth  = mApp->mWidth;', 'mWidth  = 1067; // Integer backing image encloses the exact 1066 2/3 camera.');
edit(gl, '// Letterbox to 4:3', '// Letterbox to 16:9');
edit(gl, 'width * 3 > height * 4', 'width * 9 > height * 16');
edit(gl, 'height * 4 / 3', 'height * 16 / 9');
edit(gl, 'width * 3 < height * 4', 'width * 9 < height * 16');
edit(gl, 'width * 3 / 4', 'width * 9 / 16');
edit(gl, 'MakeOrthoMatrix(0, (float)mWidth, (float)mHeight, 0, -10, 10, ortho);', 'MakeOrthoMatrix(0, 600.0f * 16.0f / 9.0f, (float)mHeight, 0, -10, 10, ortho);');
const wm = 'SexyAppFramework/widget/WidgetManager.cpp';
edit(wm, 'g.Translate(-mMouseDestRect.mX, -mMouseDestRect.mY);', 'g.Translate(-mMouseDestRect.mX, -mMouseDestRect.mY);\n\t\t\tg.mTransX += 400.0f / 3.0f;');
edit(wm, 'theX = ( theX - mMouseSourceRect.mX ) * mMouseDestRect.mWidth / mMouseSourceRect.mWidth + mMouseDestRect.mX;', 'theX = static_cast<int>((theX - mMouseSourceRect.mX) * (600.0f * 16.0f / 9.0f) / mMouseSourceRect.mWidth - 400.0f / 3.0f);');
const wc = 'SexyAppFramework/widget/WidgetContainer.cpp';
edit(wc, 'g->ClipRect(0, 0, mWidth, mHeight);', '{\n\t\t// Full-screen scenes may draw the existing scenery outside the old camera.\n\t\tif (mWidth == 800 && mHeight == 600) g->ClipRect(-134, 0, 1068, 600);\n\t\telse g->ClipRect(0, 0, mWidth, mHeight);\n\t}');
// Menu/loading artwork is only 800px wide. Reflect its edges into the extra
// space; preserve the central original artwork, controls, text and animation.
edit('Lawn/Widget/TitleScreen.cpp', 'g->DrawImage(IMAGE_TITLESCREEN, 0, 0);', 'g->DrawImageMirror(IMAGE_TITLESCREEN, -IMAGE_TITLESCREEN->GetWidth(), 0);\n\tg->DrawImageMirror(IMAGE_TITLESCREEN, IMAGE_TITLESCREEN->GetWidth(), 0);\n\tg->DrawImage(IMAGE_TITLESCREEN, 0, 0);');
edit('Lawn/Widget/GameSelector.cpp', 'aSelectorReanim->DrawRenderGroup(g, 1);  // "SelectorScreen_BG"', 'g->DrawImage(Sexy::IMAGE_REANIM_SELECTORSCREEN_BG, -134, 0, 1068, 600);\n\taSelectorReanim->DrawRenderGroup(g, 1);  // "SelectorScreen_BG"');
// Existing lawn backgrounds already contain the scenery outside the 4:3 crop.
// Do not scale them or alter grid, plant, zombie, projectile or save coordinates.
edit('Lawn/Board.cpp', 'g->FillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);', 'g->FillRect(-134, 0, 1068, BOARD_HEIGHT);');
for (const file of ['Lawn/Board.cpp', 'Lawn/Widget/TitleScreen.cpp', 'Lawn/Widget/AwardScreen.cpp', 'Lawn/Widget/CreditScreen.cpp']) {
  edit(file, 'g->FillRect(0, 0, mWidth, mHeight);', 'g->FillRect(-134, 0, 1068, mHeight);');
}
edit('PvzpLib/Reanimator.cpp', 'aClipRect = Rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);', 'aClipRect = Rect(0, 0, 1067, BOARD_HEIGHT);');
edit('PvzpLib/Reanimator.cpp', 'g->FillRect(-g->mTransX, -g->mTransY, BOARD_WIDTH, BOARD_HEIGHT);', 'g->FillRect(-g->mTransX, -g->mTransY, 1067, BOARD_HEIGHT);');
edit('Lawn/Widget/AwardScreen.cpp', 'g->FillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);', 'g->FillRect(-134, 0, 1068, BOARD_HEIGHT);');
function backdrop(file, image) {
  const draw = `g->DrawImage(${image}, 0, 0);`;
  edit(file, draw, `g->DrawImageMirror(${image}, -${image}->GetWidth(), 0);\n\tg->DrawImageMirror(${image}, ${image}->GetWidth(), 0);\n\t${draw}`);
}
backdrop('Lawn/Widget/ChallengeScreen.cpp', 'Sexy::IMAGE_CHALLENGE_BACKGROUND');
backdrop('Lawn/Widget/AwardScreen.cpp', 'IMAGE_CHALLENGE_BACKGROUND');
backdrop('Lawn/Widget/StoreScreen.cpp', 'Sexy::IMAGE_STORE_BACKGROUND');
backdrop('Lawn/Widget/StoreScreen.cpp', 'Sexy::IMAGE_STORE_BACKGROUNDNIGHT');
backdrop('Lawn/Board.cpp', 'aBgImage');
console.log('Applied 16:9 camera, original coordinate input and expanded scene clips.');
