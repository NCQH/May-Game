const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function code(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

for (const file of ['src/app.js', 'src/contributors.js']) {
  const source = code(file);
  const start = source.indexOf('function safeGamePath');
  const end = source.indexOf('\n}', start) + 2;
  const fn = source.slice(start, end);
  const sandbox = { escapeHTML: (s) => String(s), document: { baseURI: 'https://example.test/May-Game/' }, location: { origin: 'https://example.test' }, URL };
  sandbox.check = vm.runInNewContext(`${fn}; safeGamePath`, sandbox);
  assert.equal(sandbox.check('./games/tetris/index.html'), './games/tetris/index.html');
  for (const bad of ['./games/%2e%2e/contribute.html', './games/%2E%2E/contribute.html', './games/../contribute.html', './games//index.html', './games/a%2fb/index.html']) assert.equal(sandbox.check(bad), null, `${file}: ${bad}`);
}
assert.match(code('src/contributors.js'), /const handle = person\.profile \?/);

const pika = code('games/pikachu/game.js');
assert.match(pika, /function finishPendingMatch\(\)/);
assert.match(pika, /window\.addEventListener\("pagehide"[\s\S]*?if \(state\.timeLeft > 0\) finishPendingMatch\(\)/);
assert.match(pika, /\["over", "won"\]\.includes\(state\.phase\) \|\| !runStarted \? null/);
assert.match(pika, /function shuffleUntilPlayable\(\)[\s\S]*?if \(findAvailablePair\(\)\) return false[\s\S]*?state\.tiles = state\.tiles\.map/);
assert.match(pika, /if \(changed && pendingMatch\) finishPendingMatch\(\);[\s\S]*?if \(!changed \|\| state\.phase !== "playing"\) return;[\s\S]*?resizeSavedLevel\(\{ \.\.\.state, timeLeft \}, cols, rows, mode\)/);

const sandbox = {
  Math, Map, Array, structuredClone,
  SPRITE_COUNT: 36, POINTS_PER_LEVEL: 720, SECONDS_PER_TILE: 4,
  STARTING_LIVES: 10, HINTS_PER_RUN: 3,
  window: { innerWidth: 390, innerHeight: 844 }, sizeMode: 'auto',
  chooseSize: (mode) => mode === 'full' ? [16, 9] : [6, 8],
  createTiles: (cols, rows) => Array.from({ length: cols * rows }, (_, i) => ({ kind: Math.floor(i / 2) % 36, removed: false })),
  shuffle: (items) => items,
};
const from = pika.indexOf('function createLevel');
const to = pika.indexOf('function isValidSavedState');
vm.runInNewContext(`${pika.slice(from, to)}; this.resizeSavedLevel = resizeSavedLevel`, sandbox);
const oldState = { cols: 6, rows: 6, level: 2, score: 120, lives: 8, hintsLeft: 2, matched: 3, moves: 12, levelAwarded: 120, clockStarted: true, timeLimit: 144, timeLeft: 72, phase: 'playing', previousLevel: 1, lastBonus: 10 };
const resized = sandbox.resizeSavedLevel(oldState, 16, 9, 'full');
assert.equal(JSON.stringify([resized.cols, resized.rows, resized.matched, resized.lives, resized.hintsLeft, resized.moves, resized.clockStarted, resized.phase]), JSON.stringify([16, 9, 12, 8, 2, 12, true, 'playing']));
assert.equal(resized.tiles.filter((tile) => tile.removed).length, 24);
assert.equal(resized.timeLeft / resized.timeLimit, 0.5);
assert.equal(resized.score, 120);

const tetris = code('games/tetris/game.js');
assert.match(tetris, /const aboveBoard = state\.active\.matrix\.some[\s\S]*?if \(aboveBoard\) \{\s*state\.over = true;\s*state\.active = null;\s*persist\(\);/);
console.log('Regression checks passed: URL allowlist, invalid contributor handles, Pikachu state/lifecycle/shuffle/resize, Tetris top-out.');
