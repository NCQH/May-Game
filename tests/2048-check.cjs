const assert = require('node:assert/strict');
const g = require('../games/2048/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
const state = (grid, extra = {}) => ({ grid, score: 0, phase: 'playing', continued: false, undo: null, ...extra });
const rows = (...r) => r.flat();

check('slideLine standard cases', () => {
  const cases = [
    [[2, 2, 2, 2], [4, 4, 0, 0], 8], [[2, 2, 4, 0], [4, 4, 0, 0], 4], [[4, 2, 2, 0], [4, 4, 0, 0], 4],
    [[2, 0, 0, 2], [4, 0, 0, 0], 4], [[2, 2, 2, 0], [4, 2, 0, 0], 4], [[4, 4, 8, 8], [8, 16, 0, 0], 24],
    [[0, 0, 0, 2], [2, 0, 0, 0], 0], [[2, 4, 8, 16], [2, 4, 8, 16], 0], [[8, 0, 8, 8], [16, 8, 0, 0], 16],
  ];
  for (const [input, out, gained] of cases) {
    const r = g.slideLine(input);
    assert.deepEqual(r.line, out, JSON.stringify(input)); assert.equal(r.gained, gained);
  }
});
check('no tile merges twice in one move', () => {
  assert.deepEqual(g.slideLine([4, 2, 2, 0]).line, [4, 4, 0, 0]);
  assert.deepEqual(g.slideLine([2, 2, 4, 4]).line, [4, 8, 0, 0]);
  assert.equal(g.slideLine([2, 2, 2, 2]).merges, 2);
});
const base = rows([2, 2, 4, 0], [0, 4, 0, 4], [2, 0, 2, 2], [8, 0, 0, 8]);
check('slide left', () => assert.deepEqual(g.slideGrid(base, 'left').grid, rows([4, 4, 0, 0], [8, 0, 0, 0], [4, 2, 0, 0], [16, 0, 0, 0])));
check('slide right', () => assert.deepEqual(g.slideGrid(base, 'right').grid, rows([0, 0, 4, 4], [0, 0, 0, 8], [0, 0, 2, 4], [0, 0, 0, 16])));
check('slide up', () => assert.deepEqual(g.slideGrid(base, 'up').grid, rows([4, 2, 4, 4], [8, 4, 2, 2], [0, 0, 0, 8], [0, 0, 0, 0])));
check('slide down', () => assert.deepEqual(g.slideGrid(base, 'down').grid, rows([0, 0, 0, 0], [0, 0, 0, 4], [4, 2, 4, 2], [8, 4, 2, 8])));
check('column order: [2,2,2,2] up and down', () => {
  const col = rows([2, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0]);
  assert.deepEqual(g.slideGrid(col, 'up').grid.filter((_, i) => i % 4 === 0), [4, 4, 0, 0]);
  assert.deepEqual(g.slideGrid(col, 'down').grid.filter((_, i) => i % 4 === 0), [0, 0, 4, 4]);
  const tri = rows([2, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0]);
  assert.deepEqual(g.slideGrid(tri, 'down').grid.filter((_, i) => i % 4 === 0), [0, 0, 2, 4]);
});
check('move paths point at real cells', () => {
  const r = g.slideGrid(rows([0, 0, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), 'left');
  assert.deepEqual(r.moves.map((m) => [m.from, m.to, m.merged]), [[2, 0, true], [3, 0, true]]);
});
check('score adds merged values and spawn happens only on change', () => {
  const s = state(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]));
  const r = g.move(s, 'left', seq(0, .5));
  assert.equal(s.score, 4); assert.equal(r.merges, 1);
  assert.equal(s.grid.filter(Boolean).length, 2); assert.deepEqual(r.spawned, { index: 1, value: 2 });
  const before = JSON.stringify(s);
  assert.equal(g.move(s, 'left', () => 0), null); assert.equal(JSON.stringify(s), before);
});
check('spawn picks 2 at 90% and 4 at 10% from injected random', () => {
  const a = Array(16).fill(0); assert.equal(g.spawnTile(a, seq(.99, .89)).value, 2); assert.equal(a[15], 2);
  const b = Array(16).fill(0); assert.equal(g.spawnTile(b, seq(0, .9)).value, 4); assert.equal(b[0], 4);
  assert.equal(g.spawnTile(Array(16).fill(2), () => 0), null);
  const fresh = g.freshState(seq(0, 0, .99, .95));
  assert.equal(fresh.grid.filter(Boolean).length, 2); assert.equal(fresh.grid[0], 2);
});
check('reaching 2048 wins once; continued keeps playing', () => {
  const s = state(rows([1024, 1024, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]));
  assert.equal(g.move(s, 'left', () => 0).event, 'win'); assert.equal(s.phase, 'won');
  assert.equal(g.move(s, 'right', () => 0), null, 'input blocked on win overlay');
  assert(g.continueGame(s)); assert.equal(s.phase, 'playing'); assert.equal(s.continued, true);
  s.grid = rows([1024, 1024, 0, 0], [2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
  assert.notEqual(g.move(s, 'left', () => 0).event, 'win'); assert.equal(s.phase, 'playing');
});
check('no moves left ends the game', () => {
  const full = rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 8]);
  assert.equal(g.canMove(full), false);
  assert.equal(g.canMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 4])), true);
  assert.equal(g.canMove(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]).map((v, i) => (i === 3 ? 2 : i === 7 ? 2 : v))), true);
  const s = state(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [8, 16, 32, 0]));
  const r = g.move(s, 'right', seq(0, .95)); // last row -> [0,8,16,32], a 4 spawns at index 12
  assert.deepEqual(s.grid.slice(12), [4, 8, 16, 32]);
  assert.equal(r.event, 'over'); assert.equal(s.phase, 'over');
  assert.equal(g.move(s, 'left'), null);
});
check('undo restores one move and the score, then is unavailable', () => {
  const s = state(rows([2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), { score: 10 });
  const start = s.grid.slice();
  g.move(s, 'left', () => 0); g.move(s, 'right', () => 0);
  const afterFirst = s.undo.grid.slice(), scoreFirst = s.undo.score;
  assert(g.undoMove(s)); assert.deepEqual(s.grid, afterFirst); assert.equal(s.score, scoreFirst);
  assert.equal(s.undo, null); assert.equal(g.undoMove(s), false);
  assert.notDeepEqual(s.grid, start);
  const over = state(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 8]), { phase: 'over', undo: { grid: start, score: 0 } });
  assert(g.undoMove(over)); assert.equal(over.phase, 'playing');
});
check('save validation accepts valid states and rejects bad ones', () => {
  const ok = g.freshState(() => .3);
  assert(g.validState(ok)); assert(g.validState(JSON.parse(JSON.stringify(ok))));
  g.move(ok, 'left', () => .3) || g.move(ok, 'right', () => .3) || g.move(ok, 'up', () => .3);
  assert(g.validState(JSON.parse(JSON.stringify(ok))));
  const bad = [
    null, [], {}, { ...ok, grid: ok.grid.slice(0, 15) }, { ...ok, grid: [...ok.grid.slice(0, 15), 3] },
    { ...ok, grid: [...ok.grid.slice(0, 15), 1] }, { ...ok, grid: [...ok.grid.slice(0, 15), 262144] },
    { ...ok, grid: [...ok.grid.slice(0, 15), '2'] }, { ...ok, grid: Array(16).fill(0) },
    { ...ok, score: -1 }, { ...ok, score: 1.5 }, { ...ok, score: 2 ** 60 }, { ...ok, score: '4' },
    { ...ok, phase: 'over' }, { ...ok, phase: 'paused' }, { ...ok, continued: 'no' },
    { ...ok, phase: 'won' }, { ...ok, undo: { grid: [2], score: 0 } }, { ...ok, undo: { grid: ok.grid, score: ok.score + 1 } },
    { ...ok, undo: 5 }, state(rows([2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 8])),
  ];
  bad.forEach((s, i) => assert.equal(g.validState(s), false, `bad #${i}`));
  assert(g.validState(state(rows([2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 131072]), { phase: 'won', score: 20000 })));
  assert.equal(g.validState(state(rows([2048, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]), { phase: 'won', continued: true })), false);
});
console.log(`# ${checks} checks passed`);
