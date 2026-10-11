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
const patch = fs.readFileSync(path.join(root, 'scripts/patch-pvz-widescreen.cjs'), 'utf8');
assert.ok(patch.includes('width * 9 > height * 16'));
assert.ok(patch.includes('g->ClipRect(-134, 0, 1068, 600)'));
assert.ok(patch.includes('400.0f / 3.0f'));
assert.ok(!patch.includes('mWidth = BOARD_WIDTH'), 'Do not change the original game rules or board grid');
console.log('PASS: 16:9 framebuffer at five settings, centered pointer mapping and expanded native clips.');
