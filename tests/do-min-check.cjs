const assert = require('node:assert/strict');
const m = require('../games/do-min/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
function seeded(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; }; }
// A board with fixed mines that is already in play (first-click placement skipped).
function board(level, mines, aspect = 1) { const s = m.freshState(level, aspect); m.setMines(s, mines); s.phase = 'playing'; return s; }
const at = (s, x, y) => y * s.cols + x;
// Ten-mine Dễ layouts: SPREAD keeps cell 10's only mine at 0; FAR fills row 7 (+72) so rows 0-5 are open.
const SPREAD = [0, 4, 8, 36, 40, 44, 60, 72, 76, 80];
const FAR = [63, 64, 65, 66, 67, 68, 69, 70, 71, 72];

check('levels and fresh state', () => {
  assert.deepEqual([m.LEVELS.easy.cols, m.LEVELS.easy.rows, m.LEVELS.easy.mines], [9, 9, 10]);
  assert.deepEqual([m.LEVELS.medium.cols, m.LEVELS.medium.rows, m.LEVELS.medium.mines], [16, 16, 40]);
  assert.deepEqual([m.LEVELS.hard.cols, m.LEVELS.hard.rows, m.LEVELS.hard.mines], [30, 16, 99]);
  const s = m.freshState('nope');
  assert.equal(s.level, 'easy'); assert.equal(s.phase, 'ready'); assert.equal(s.mines, null); assert.equal(m.minesLeft(s), 10);
});
check('Khó orientation follows the stage aspect; other levels never rotate', () => {
  assert.deepEqual(m.shapeFor('hard', 1.6), { cols: 30, rows: 16 });
  assert.deepEqual(m.shapeFor('hard', .55), { cols: 16, rows: 30 });
  const portrait = m.freshState('hard', .5);
  assert.equal(portrait.cols, 16); assert.equal(portrait.rows, 30); assert.equal(portrait.revealed.length, 480);
  assert.deepEqual(m.shapeFor('medium', .5), { cols: 16, rows: 16 });
  assert.deepEqual(m.shapeFor('easy', .5), { cols: 9, rows: 9 });
});
check('neighbours respect corners and edges', () => {
  const s = m.freshState('easy');
  assert.deepEqual(m.neighbours(s, 0).sort((a, b) => a - b), [1, 9, 10]);
  assert.equal(m.neighbours(s, at(s, 4, 0)).length, 5);
  assert.equal(m.neighbours(s, at(s, 4, 4)).length, 8);
  assert.deepEqual(m.neighbours(s, 80).sort((a, b) => a - b), [70, 71, 79]);
});
check('first reveal is safe with safe neighbours and exact mine count on every level/seed', () => {
  for (const [level, aspect] of [['easy', 1], ['medium', 1], ['hard', 2], ['hard', .5]]) {
    for (let seed = 1; seed <= 60; seed++) {
      const s = m.freshState(level, aspect), random = seeded(seed);
      const first = Math.floor(random() * s.cols * s.rows);
      const result = m.reveal(s, first, random);
      assert.notEqual(result.type, 'lose');
      assert.equal(s.mines.length, m.LEVELS[level].mines);
      assert.equal(new Set(s.mines).size, s.mines.length);
      assert.equal(s.mineAt.reduce((a, b) => a + b, 0), m.LEVELS[level].mines);
      for (const j of [first, ...m.neighbours(s, first)]) assert.equal(s.mineAt[j], 0);
      assert.equal(m.adjacent(s, first), 0);
      assert(result.opened >= 1 + m.neighbours(s, first).length);
      assert.equal(s.phase === 'won' ? 'won' : 'playing', s.phase);
    }
  }
});
check('injected random is deterministic, including corner first clicks', () => {
  const a = m.freshState('medium'), b = m.freshState('medium');
  m.reveal(a, 0, seeded(7)); m.reveal(b, 0, seeded(7));
  assert.deepEqual(a.mines, b.mines);
  const edge = m.freshState('easy'); m.reveal(edge, 0, () => .999999);
  assert.equal(edge.mines.length, 10); assert(!edge.mines.some(i => [0, 1, 9, 10].includes(i)));
  const low = m.freshState('easy'); m.reveal(low, 40, () => 0);
  assert.equal(low.mines.length, 10);
});
check('numbers count adjacent mines', () => {
  const s = board('easy', [0, 1, 9, 20, 72, 73, 74, 75, 76, 77]);
  assert.equal(m.adjacent(s, 10), 4);
  assert.equal(m.adjacent(s, at(s, 2, 0)), 1);
  assert.equal(m.adjacent(s, at(s, 2, 1)), 2);
  assert.equal(m.adjacent(s, 80), 0);
});
check('flood fill opens zero regions and stops at numbers', () => {
  // Mines down column 2 except the bottom: the right side floods, the left stays shut.
  const s = board('easy', [2, 11, 20, 29, 38, 47, 56, 65, 72, 73]);
  const r = m.reveal(s, 8);
  assert.equal(r.type, 'reveal');
  for (let y = 0; y < 9; y++) { assert.equal(s.revealed[at(s, 3, y)], 1); assert.equal(s.revealed[at(s, 8, y)], 1); }
  assert.equal(s.revealed[at(s, 0, 0)], 0); assert.equal(s.revealed[at(s, 1, 0)], 0);
  // The safe cell at the bottom of column 2 only touches numbers, so the flood never crosses.
  assert.equal(s.revealed[at(s, 2, 8)], 0); assert.equal(s.revealed[at(s, 0, 8)], 0);
  assert.equal(s.revealed.some((v, i) => v && s.mineAt[i]), false);
  // Revealing a number only opens that cell.
  const t = board('easy', [40, 0, 8, 72, 80, 2, 6, 18, 26, 78]);
  assert.equal(m.reveal(t, 41).opened, 1);
});
check('flags block reveal, cannot go on open cells, and are cleared by a flood', () => {
  const s = board('easy', FAR);
  assert.equal(m.toggleFlag(s, 0), true);
  assert.deepEqual(m.reveal(s, 0), { type: 'none', opened: 0 });
  assert.equal(m.minesLeft(s), 9);
  m.toggleFlag(s, 0);
  m.toggleFlag(s, 3);
  m.reveal(s, 40);
  assert.equal(s.flags[3], 0); assert.equal(s.revealed[3], 1);
  assert.equal(m.toggleFlag(s, 40), false);
});
check('chord opens the other neighbours when flags match', () => {
  const s = board('easy', SPREAD);
  m.reveal(s, 10);                       // a "1" next to the corner mine
  assert.equal(m.adjacent(s, 10), 1);
  assert.equal(m.chord(s, 10).type, 'none'); // no flag yet
  m.toggleFlag(s, 0);
  const r = m.reveal(s, 10);             // activating an opened number chords
  assert.equal(r.type, 'chord');
  for (const j of m.neighbours(s, 10)) if (j !== 0) assert.equal(s.revealed[j], 1);
  assert.equal(s.revealed[0], 0);
  assert.equal(m.chord(s, 10).type, 'none'); // nothing left to open
});
check('chord with a wrong flag loses and marks the exploded mine', () => {
  const s = board('easy', SPREAD);
  m.reveal(s, 10);
  m.toggleFlag(s, 1);                    // wrong: the mine is at 0
  const r = m.chord(s, 10);
  assert.equal(r.type, 'lose'); assert.equal(s.phase, 'lost'); assert.equal(s.exploded, 0);
  assert.equal(m.reveal(s, 40).type, 'none'); assert.equal(m.toggleFlag(s, 40), false);
});
check('revealing a mine loses', () => {
  const s = board('easy', FAR);
  m.reveal(s, 0);
  const r = m.reveal(s, 72);
  assert.equal(r.type, 'lose'); assert.equal(s.exploded, 72); assert.equal(s.phase, 'lost');
});
check('win when every safe cell is open; remaining mines get flags', () => {
  const s = board('easy', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const r = m.reveal(s, 80);
  assert.equal(r.type, 'win'); assert.equal(s.phase, 'won');
  assert.equal(m.safeLeft(s), 0); assert.equal(m.minesLeft(s), 0);
  assert.deepEqual(s.flags, s.mineAt);
  // Winning through a chord.
  const t = board('easy', SPREAD);
  for (let i = 0; i < 81; i++) if (!t.mineAt[i] && i !== 1) t.revealed[i] = 1;
  assert.equal(t.phase, 'playing'); assert.equal(m.safeLeft(t), 1);
  m.toggleFlag(t, 0);
  assert.equal(m.reveal(t, 10).type, 'win');
});
check('save round-trip keeps the board and elapsed time', () => {
  const s = m.freshState('hard', .5);
  m.reveal(s, 200, seeded(3));
  const flag = s.revealed.findIndex((v, i) => !v && s.mineAt[i]);
  m.toggleFlag(s, flag);
  s.elapsed = 12345;
  const data = JSON.parse(JSON.stringify(m.serialize(s)));
  assert.equal(data.cols, 16); assert.equal(data.rows, 30); assert.equal(data.mines.length, 99);
  const back = m.restore(data);
  assert(back);
  assert.deepEqual(back.revealed, s.revealed); assert.deepEqual(back.flags, s.flags); assert.deepEqual(back.mineAt, s.mineAt);
  assert.equal(back.elapsed, 12345); assert.equal(back.phase, 'playing'); assert.equal(back.cols, 16);
  const ready = m.freshState('easy'); m.toggleFlag(ready, 5);
  assert(m.restore(m.serialize(ready)));
});
check('save validation rejects bad or inconsistent data', () => {
  const s = m.freshState('easy');
  m.reveal(s, 40, seeded(9));
  const good = m.serialize(s);
  assert(m.restore(good));
  const bad = [
    null, [], 'x', { ...good, level: 'insane' }, { ...good, cols: 10 }, { ...good, level: 'medium' },
    { ...good, phase: 'won' }, { ...good, phase: 'lost' }, { ...good, phase: 'ready' },
    { ...good, elapsed: -1 }, { ...good, elapsed: 1.5 }, { ...good, elapsed: '5' }, { ...good, elapsed: 1e12 },
    { ...good, mines: good.mines.slice(1) }, { ...good, mines: [...good.mines.slice(0, 9), 81] },
    { ...good, mines: [good.mines[1], good.mines[0], ...good.mines.slice(2)] },
    { ...good, revealed: [] }, { ...good, revealed: [...good.revealed, good.revealed[0]] },
    { ...good, revealed: [...good.revealed, good.mines[0]].sort((a, b) => a - b) },
    { ...good, flags: [good.revealed[0]] }, { ...good, flags: 'nope' },
    { ...good, mines: null }, { ...good, revealed: [good.revealed.find(i => m.adjacent(s, i) > 0)] },
  ];
  bad.forEach((data, k) => assert.equal(m.restore(data), null, `bad case ${k}`));
  // An opened zero whose neighbour is still hidden is impossible.
  const zero = good.revealed.find(i => m.adjacent(s, i) === 0);
  const hole = m.neighbours(s, zero).find(j => good.revealed.includes(j));
  assert.equal(m.restore({ ...good, revealed: good.revealed.filter(i => i !== hole) }), null);
  // A fully cleared board is a finished game, not resumable.
  const all = []; for (let i = 0; i < 81; i++) if (!s.mineAt[i]) all.push(i);
  assert.equal(m.restore({ ...good, revealed: all }), null);
  // Ready boards must not carry opened cells or time; Khó accepts only its two shapes.
  assert.equal(m.restore({ level: 'easy', cols: 9, rows: 9, mines: null, revealed: [], flags: [], elapsed: 3, phase: 'ready' }), null);
  assert(m.restore({ level: 'hard', cols: 16, rows: 30, mines: null, revealed: [], flags: [], elapsed: 0, phase: 'ready' }));
  assert.equal(m.restore({ level: 'hard', cols: 20, rows: 24, mines: null, revealed: [], flags: [], elapsed: 0, phase: 'ready' }), null);
});
check('best times are cleaned', () => {
  assert.deepEqual(m.cleanBest({ easy: 12, medium: -1, hard: 'x' }), { easy: 12, medium: null, hard: null });
  assert.deepEqual(m.cleanBest(null), { easy: null, medium: null, hard: null });
});
console.log(`# ${checks} checks passed`);
