const assert = require('node:assert/strict');
const g = require('../games/co-caro/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
const at = (r, c) => r * g.SIZE + c;
const settings = (extra = {}) => ({ ...g.defaultSettings(), mode: 'pvp', ...extra });
// Board with X stones at `xs` and O stones at `os`.
function board(xs, os = []) { const b = new Array(g.CELLS).fill(0); xs.forEach(i => { b[i] = g.X; }); os.forEach(i => { b[i] = g.O; }); return b; }
// Interleave X and O moves into one move list (X first); the lists must differ in length by at most one.
function interleave(xs, os) { const m = []; for (let i = 0; i < Math.max(xs.length, os.length); i++) { if (i < xs.length) m.push(xs[i]); if (i < os.length) m.push(os[i]); } return m; }
function rng(seed) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }

check('win detection: horizontal, vertical and both diagonals', () => {
  const lines = {
    horizontal: [0, 1, 2, 3, 4].map(k => at(7, 3 + k)),
    vertical: [0, 1, 2, 3, 4].map(k => at(2 + k, 9)),
    diagonal: [0, 1, 2, 3, 4].map(k => at(4 + k, 4 + k)),
    antidiagonal: [0, 1, 2, 3, 4].map(k => at(10 - k, 2 + k)),
  };
  for (const [name, xs] of Object.entries(lines)) {
    const os = [at(0, 0), at(0, 2), at(0, 4), at(0, 6)];
    const s = g.fromMoves(interleave(xs.slice(0, 4), os), settings());
    assert.equal(s.phase, 'playing', name);
    assert.equal(g.play(s, xs[4]), 'win', name);
    assert.equal(s.winner, g.X); assert.deepEqual([...s.line].sort((a, b) => a - b), [...xs].sort((a, b) => a - b), name);
    assert.equal(g.play(s, at(14, 14)), null, 'no moves after the game ends');
  }
  const four = board([0, 1, 2, 3].map(c => at(5, c)));
  assert.equal(g.winLine(four, at(5, 3)), null);
});
check('overline of six counts as a win; edge is not a block', () => {
  const b = board([0, 1, 2, 4, 5, 3].map(c => at(0, c)));
  assert.equal(g.winLine(b, at(0, 3)).length, 6);
  const edge = board([0, 1, 2, 3, 4].map(c => at(3, c)), [at(3, 5)]);
  assert.equal(g.winLine(edge, at(3, 4), true).length, 5);
});
check('blocked-both-ends rule on/off', () => {
  const xs = [3, 4, 5, 6, 7].map(c => at(6, c)), os = [at(6, 2), at(6, 8)];
  assert.equal(g.winLine(board(xs, os), at(6, 7), false).length, 5);
  assert.equal(g.winLine(board(xs, os), at(6, 7), true), null);
  assert.equal(g.winLine(board(xs, [at(6, 2)]), at(6, 7), true).length, 5, 'one open end still wins');
  const six = [3, 4, 5, 6, 7, 8].map(c => at(6, c));
  assert.equal(g.winLine(board(six, [at(6, 2), at(6, 9)]), at(6, 8), true), null, 'blocked overline does not win');
  // Through play(): the blocked five keeps the game going.
  const s = g.fromMoves(interleave([at(6, 3), at(6, 4), at(6, 5), at(6, 6)], [at(6, 2), at(6, 8), at(0, 0)]), settings({ blocked: true }));
  assert.equal(g.play(s, at(6, 7)), 'move'); assert.equal(s.phase, 'playing');
});
check('full board without five is a draw', () => {
  // XXOO pairs flipped every row: no five anywhere, 113 X and 112 O.
  const moves = [], xs = [], os = [];
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) ((Math.floor(c / 2) + r) % 2 ? os : xs).push(at(r, c));
  assert.equal(xs.length, 113);
  assert.equal(xs.length + os.length, 225);
  const b = board(xs, os);
  for (let i = 0; i < 225; i++) assert.equal(g.winLine(b, i), null, `cell ${i}`);
  while (xs.length || os.length) { if (xs.length) moves.push(xs.shift()); if (os.length) moves.push(os.shift()); }
  const last = moves.pop();
  const s = g.fromMoves(moves, settings());
  assert(s, 'replay of a drawn board is legal');
  assert.equal(g.play(s, last), 'draw'); assert.equal(s.phase, 'over'); assert.equal(s.winner, 0);
});
check('AI takes an immediate win at every difficulty (even over blocking)', () => {
  const xs = [at(7, 3), at(7, 4), at(7, 5), at(7, 6)], os = [at(3, 3), at(3, 4), at(3, 5), at(3, 6), at(7, 2)];
  for (const difficulty of ['easy', 'normal', 'hard']) for (let seed = 1; seed < 6; seed++) {
    assert.equal(g.chooseMove(board(xs, os), g.X, { difficulty, random: rng(seed) }), at(7, 7), difficulty);
    assert([at(3, 2), at(3, 7)].includes(g.chooseMove(board(os, xs), g.X, { difficulty, random: rng(seed) })), difficulty);
  }
});
check('AI blocks a four and an open four at every difficulty', () => {
  const four = board([at(5, 5), at(6, 6), at(7, 7), at(8, 8)], [at(4, 4), at(10, 2)]);
  const open = board([at(9, 3), at(9, 4), at(9, 5), at(9, 6)], [at(2, 2), at(2, 12)]);
  for (const difficulty of ['easy', 'normal', 'hard']) for (let seed = 1; seed < 6; seed++) {
    assert.equal(g.chooseMove(four, g.O, { difficulty, random: rng(seed) }), at(9, 9), `four ${difficulty}`);
    assert([at(9, 2), at(9, 7)].includes(g.chooseMove(open, g.O, { difficulty, random: rng(seed) })), `open four ${difficulty}`);
  }
  // Broken four X X _ X X: the gap is the only block.
  const broken = board([at(4, 3), at(4, 4), at(4, 6), at(4, 7)], [at(0, 0), at(14, 14)]);
  for (const difficulty of ['easy', 'normal', 'hard']) assert.equal(g.chooseMove(broken, g.O, { difficulty, random: rng(3) }), at(4, 5));
});
check('normal and hard answer an open three; hard converts a double-four threat', () => {
  const three = board([at(7, 5), at(7, 6), at(7, 7)], [at(3, 3), at(11, 11)]);
  for (const difficulty of ['normal', 'hard']) assert([at(7, 4), at(7, 8), at(7, 3), at(7, 9)].includes(g.chooseMove(three, g.O, { difficulty, random: rng(2) })), difficulty);
  // X: closed three in row 7 and closed three in column 10; (7,10) makes a double four. Hard must convert.
  const xs = [at(7, 7), at(7, 8), at(7, 9), at(8, 10), at(9, 10), at(10, 10)];
  const os = [at(7, 6), at(11, 10), at(0, 0), at(0, 14), at(14, 0), at(14, 14)];
  const s = g.fromMoves(interleave(xs, os), settings());
  for (let turn = 0; turn < 8 && s.phase === 'playing'; turn++) {
    g.play(s, g.chooseMove(s.board, s.turn, { difficulty: s.turn === g.X ? 'hard' : 'normal', random: rng(4) }));
  }
  assert.equal(s.winner, g.X); assert(s.moves.length <= 12 + 5);
});
check('AI moves are legal for all difficulties across full self-play games, and fast', () => {
  for (const blocked of [false, true]) for (const [a, b] of [['easy', 'hard'], ['normal', 'easy'], ['hard', 'normal']]) {
    const s = g.freshGame(settings({ blocked }));
    const random = rng(blocked ? 11 : 5);
    let slowest = 0;
    while (s.phase === 'playing') {
      const t = Date.now();
      const idx = g.chooseMove(s.board, s.turn, { difficulty: s.turn === g.X ? a : b, blocked, random });
      slowest = Math.max(slowest, Date.now() - t);
      assert(Number.isInteger(idx) && idx >= 0 && idx < g.CELLS && !s.board[idx], `legal ${a}/${b}`);
      assert(g.play(s, idx));
    }
    assert(slowest < 300, `slowest move ${slowest}ms`);
  }
  assert.equal(g.chooseMove(new Array(g.CELLS).fill(0), g.X, { random: rng(1) }), g.CENTER, 'opening move is the centre');
});
check('easy is deterministic for a given random source', () => {
  const b = board([at(7, 7), at(8, 8)], [at(7, 8)]);
  assert.equal(g.chooseMove(b, g.O, { difficulty: 'easy', random: rng(9) }), g.chooseMove(b, g.O, { difficulty: 'easy', random: rng(9) }));
});
check('undo: vs machine removes the human move and the reply; 2 players removes one', () => {
  const ai = g.fromMoves([at(7, 7), at(7, 8), at(8, 8), at(6, 6)], g.defaultSettings());
  assert.equal(g.undoCount(ai), 2);
  const back = g.undo(ai); assert.deepEqual(back.moves, [at(7, 7), at(7, 8)]); assert.equal(back.turn, g.X);
  const thinking = g.fromMoves([at(7, 7), at(7, 8), at(8, 8)], g.defaultSettings());
  assert.equal(g.undoCount(thinking), 1);
  const machineFirst = { ...g.defaultSettings(), first: 'ai' };
  assert.equal(g.undoCount(g.fromMoves([g.CENTER], machineFirst)), 0, 'cannot undo the machine opening');
  assert.equal(g.undoCount(g.fromMoves([g.CENTER, at(6, 6), at(8, 8)], machineFirst)), 2);
  const pvp = g.fromMoves([at(7, 7), at(7, 8), at(8, 8)], settings());
  assert.equal(g.undoCount(pvp), 1); assert.deepEqual(g.undo(pvp).moves, [at(7, 7), at(7, 8)]);
  assert.equal(g.undoCount(g.freshGame(settings())), 0); assert.equal(g.undo(g.freshGame(settings())), null);
  const over = g.fromMoves(interleave([0, 1, 2, 3, 4], [30, 31, 32, 33]), settings());
  assert.equal(over.phase, 'over'); assert.equal(g.undoCount(over), 0);
});
check('save validation replays moves strictly', () => {
  const ok = { moves: [at(7, 7), at(7, 8), at(8, 8)], settings: g.defaultSettings(), phase: 'playing' };
  assert.equal(g.validCurrent(ok), true);
  assert.equal(g.validCurrent(JSON.parse(JSON.stringify(ok))), true, 'survives JSON');
  const bad = [
    null, 5, [], { ...ok, phase: 'over' }, { ...ok, moves: [] }, { ...ok, moves: 'x' },
    { ...ok, moves: [at(7, 7), at(7, 7)] }, { ...ok, moves: [225] }, { ...ok, moves: [-1] }, { ...ok, moves: [1.5] },
    { ...ok, moves: ['3'] }, { ...ok, settings: { ...ok.settings, mode: 'online' } }, { ...ok, settings: { ...ok.settings, blocked: 'no' } },
    { ...ok, settings: { ...ok.settings, difficulty: 'expert' } }, { ...ok, settings: undefined },
    { ...ok, moves: [...interleave([0, 1, 2, 3, 4], [30, 31, 32, 33])] },
    { ...ok, moves: [...interleave([0, 1, 2, 3, 4], [30, 31, 32, 33]), 100] },
    { ...ok, moves: new Array(226).fill(0) },
  ];
  bad.forEach((current, i) => assert.equal(g.validCurrent(current), false, `bad save ${i}`));
  // A blocked five is not a finished game under the rule, but is under free rules.
  const blockedFive = interleave([at(6, 3), at(6, 4), at(6, 5), at(6, 6), at(6, 7)], [at(6, 2), at(6, 8), at(0, 0), at(0, 2)]);
  assert.equal(g.validCurrent({ moves: blockedFive, settings: { ...g.defaultSettings(), blocked: true }, phase: 'playing' }), true);
  assert.equal(g.validCurrent({ moves: blockedFive, settings: g.defaultSettings(), phase: 'playing' }), false);
});
check('pattern classes: open four, four, open three, closed three', () => {
  const code = (s) => [...s].map(Number);
  assert.equal(g.classifyLine(code('30011111000'), false), 7);
  assert.equal(g.classifyLine(code('00001111000'), false), 6);
  assert.equal(g.classifyLine(code('00021111000'), false), 5);
  assert.equal(g.classifyLine(code('00001110000'), false), 4);
  assert.equal(g.classifyLine(code('00021110000'), false), 3);
  assert.equal(g.classifyLine(code('00021111120'), true), 0, 'a blocked five is no threat under the rule');
});
console.log(`# ${checks} checks passed`);
