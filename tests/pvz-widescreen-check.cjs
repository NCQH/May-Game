const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const quality = fs.readFileSync(path.join(root, 'games/pvz-goty/quality.js'), 'utf8');
const frame = quality.match(/function frameSize\(\) \{[\s\S]*?\n\}/)[0];
for (const renderHeight of [600, 1080, 1440, 2160, 'auto']) {
  const context = vm.createContext({ renderHeight, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    document: { getElementById: () => ({ clientWidth: 1920, clientHeight: 1080 }) } });
  vm.runInContext(frame + '\nresult = frameSize();', context);
  const size = context.result;
  assert.equal(size.cssHeight, 1080);
  assert.equal(size.width, Math.round(size.height * 16 / 9));
  if (renderHeight === 1080 || renderHeight === 'auto') assert.equal(size.width, 1920);
  // Inverse of the native centered camera transform, at each render resolution.
  for (const x of [40, 80, 400, 640, 760]) {
    const pixelX = (x + 400 / 3) * size.width / (600 * 16 / 9);
    const mapped = Math.trunc(pixelX * (600 * 16 / 9) / size.width - 400 / 3);
    assert.ok(Math.abs(mapped - x) <= 1);
  }
}
const patch = fs.readFileSync(path.join(root, 'scripts/pvz/patch-pvz-widescreen.cjs'), 'utf8');
assert.ok(patch.includes('width * 9 > height * 16'));
assert.ok(patch.includes('g->ClipRect(-134, 0, 1068, 600)'));
assert.ok(patch.includes('400.0f / 3.0f'));
assert.ok(patch.includes('mScreenBounds.mX = 0;'), 'Native initialization must not add a second camera offset');
assert.ok(patch.includes('mScreenBounds.mWidth = mWidth;'), 'Keep original widget bounds separate from the wider rendering surface');
for (const pan of [-246, 0, 86]) {
  assert.ok(-220 + pan <= -400 / 3, 'Panorama covers the left camera edge');
  assert.ok(-220 + pan + 1400 >= 800 + 400 / 3, 'Panorama covers the right camera edge');
}
assert.ok(!patch.includes('mWidth = BOARD_WIDTH'), 'Do not change the original game rules or board grid');
assert.ok(!patch.includes('DrawImageMirror'), 'Reflection must stay in the isolated Zombatar helper');
const art = fs.readFileSync(path.join(root, 'scripts/pvz/wide-art.h'), 'utf8');
const zombatar = art.match(/inline void MayDrawZombatarBackdrop[\s\S]*?\n\}/)[0];
assert.equal((zombatar.match(/DrawImageMirror/g) || []).length, 2);
assert.equal((art.match(/DrawImageMirror/g) || []).length, 2, 'Only Zombatar reflects the background');
assert.ok(patch.includes("'MayDrawZombatarBackdrop(g, mApp, IMAGE_ZOMBATAR_MAIN_BG);'"));
assert.ok(patch.includes('MayDrawWideBackdrop'), 'Use authored widescreen scenery separately from original resources');
assert.ok(patch.includes('310999 + row * 10000'), 'Bush canopies must follow the original mod row ordering');
assert.ok(patch.includes('image, 642, 0)'), 'Use the mod bush placement without moving the board grid');
assert.ok(patch.includes('mayBushes[mayBushIndex].order <= aRenderItem.mZPos'), 'Interleave scenery with actors and UI');
for (const pan of [-379, 0, 219]) {
  assert.ok(-220 - 133 + pan <= -400 / 3);
  assert.ok(-220 - 133 + pan + 1666 >= 800 + 400 / 3);
}
console.log('PASS: 16:9 framebuffer at five settings, centered pointer mapping and expanded native clips.');
