const assert = require('node:assert/strict');
const g = require('../games/o-an-quan/game.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }

// Board from a 12-entry dân list; quan stones on 0 and 6 unless told otherwise.
function make(dan, { quan = [true, true], turn = 0, quanNon = true, scores = [[0, 0], [0, 0]], debts = [0, 0] } = {}) {
  const s = g.freshState({ mode: 'pvp', quanNon });
  s.squares = dan.map((n, i) => ({ dan: n, quan: i === 0 ? quan[0] : i === 6 ? quan[1] : false }));
  s.scores = scores.map(([d, q]) => ({ dan: d, quan: q }));
  s.debts = [...debts]; s.turn = turn;
  return s;
}
const dans = (s) => s.squares.map((q) => q.dan);
function seeded(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

check('fresh board: 50 dân, 2 quan, ten legal moves, AI-first setting', () => {
  const s = g.freshState();
  assert.deepEqual(g.stoneTotals(s), { dan: 50, quan: 2 });
  assert.equal(g.legalMoves(s).length, 10);
  assert.equal(s.turn, 0);
  assert.equal(g.freshState({ mode: 'ai', aiFirst: true }).turn, 1);
  assert.equal(g.freshState({ mode: 'pvp', aiFirst: true }).turn, 0);
  assert.equal(g.isLegal(s, 7, 1), false); assert.equal(g.isLegal(s, 0, 1), false); assert.equal(g.isLegal(s, 1, 2), false);
});

check('sowing clockwise and counter-clockwise wraps through the quan squares', () => {
  // Player 0 sows 3 from square 1 backwards: 0 (quan), 11, 10; then 9 and 8 are empty → turn ends.
  const back = make([0, 3, 2, 2, 2, 2, 0, 2, 0, 0, 1, 1]);
  const r = g.playMove(back, 1, -1);
  assert.equal(r.reason, 'empty');
  assert.deepEqual(dans(back), [1, 0, 2, 2, 2, 2, 0, 2, 0, 0, 2, 2]);
  assert.equal(back.turn, 1);
  // Player 1 sows 2 from square 11 forward: wraps to 0 then 1.
  const fwd = make([0, 0, 0, 3, 1, 1, 0, 1, 1, 1, 1, 2], { turn: 1 });
  g.playMove(fwd, 11, 1);
  assert.deepEqual(dans(fwd).slice(0, 2), [1, 1]);
  assert.deepEqual(fwd.scores[1], { dan: 3, quan: 0 }); // 2 empty, 3 captured
  const drops = r.events.filter((e) => e.type === 'drop').map((e) => e.i);
  assert.deepEqual(drops, [0, 11, 10]);
});

check('continue sowing from the next full square, then capture', () => {
  const s = make([0, 0, 2, 0, 0, 3, 0, 0, 0, 0, 4, 1]);
  // 2 → drops 3,4; next 5 has 3 → pick, drop 6,7,8; next 9 empty, 10 has 4 → capture; 11 full → stop.
  const r = g.playMove(s, 2, 1);
  assert.deepEqual(r.events.filter((e) => e.type === 'pick').map((e) => e.i), [2, 5]);
  assert.deepEqual(r.gained, { dan: 4, quan: 0 });
  assert.deepEqual(dans(s), [0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1]);
  assert.equal(r.reason, 'capture');
});

check('ăn liên: empty-full pairs capture repeatedly, including a ripe quan', () => {
  const s = make([0, 1, 0, 0, 2, 0, 5, 3, 0, 0, 0, 0]);
  const r = g.playMove(s, 1, 1); // drop 2; 3 empty → eat 4; 5 empty → eat quan 6 (5 dân); 7 full → stop
  assert.deepEqual(r.events.filter((e) => e.type === 'capture').map((e) => e.i), [4, 6]);
  assert.deepEqual(r.gained, { dan: 7, quan: 1 });
  assert.equal(g.points(s, 0), 17);
  assert.equal(s.squares[6].quan, false);
  // Two empty squares after a capture end the chain.
  const t = make([0, 1, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], { quan: [true, false] });
  assert.deepEqual(g.playMove(t, 1, 1).gained, { dan: 2, quan: 0 });
});

check('quan non: protected with setting on, capturable with it off', () => {
  const board = [0, 0, 0, 1, 0, 0, 2, 4, 1, 1, 1, 1];
  const on = make(board), off = make(board, { quanNon: false });
  const a = g.playMove(on, 3, 1);
  assert.equal(a.reason, 'quan-non'); assert.deepEqual(a.gained, { dan: 0, quan: 0 }); assert.equal(on.squares[6].quan, true);
  const b = g.playMove(off, 3, 1);
  assert.deepEqual(b.gained, { dan: 2, quan: 1 }); assert.equal(g.points(off, 0), 12);
  // A quan square that lost its stone is an ordinary target even with few dân.
  const gone = make([0, 0, 0, 1, 0, 0, 2, 4, 1, 1, 1, 1], { quan: [true, false] });
  assert.deepEqual(g.playMove(gone, 3, 1).gained, { dan: 2, quan: 0 });
});

check('the turn ends when the next square is a non-empty quan', () => {
  const s = make([0, 0, 0, 0, 1, 0, 0, 2, 2, 2, 2, 2]);
  const r = g.playMove(s, 4, 1);
  assert.equal(r.reason, 'quan'); assert.deepEqual(r.gained, { dan: 0, quan: 0 });
  assert.equal(s.squares[5].dan, 1); assert.equal(s.turn, 1);
  // Only dân left in a quan square also stops the sowing (no pick-up from quan squares).
  const t = make([0, 0, 0, 0, 1, 0, 3, 2, 2, 2, 2, 2], { quan: [true, false] });
  assert.equal(g.playMove(t, 4, 1).reason, 'quan');
});

check('rải quân from own pile at the start of a turn', () => {
  // Player 0 captures player 1's last stones; player 1 must re-seed from 7 captured dân.
  const s = make([0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0], { scores: [[0, 0], [7, 0]] });
  const r = g.playMove(s, 1, 1); // drop 2; 3 full → pick 3, drop 4,5,6; next 7 empty, 8 empty → end
  assert.equal(s.turn, 1);
  const scatter = r.events.find((e) => e.type === 'scatter');
  assert.deepEqual({ own: scatter.own, borrow: scatter.borrow, player: scatter.player }, { own: 5, borrow: 0, player: 1 });
  assert.deepEqual(dans(s).slice(7), [1, 1, 1, 1, 1]);
  assert.equal(s.scores[1].dan, 2); assert.deepEqual(s.debts, [0, 0]);
});

check('rải quân borrows the shortfall and settles it in the score', () => {
  const s = make([0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0], { scores: [[10, 0], [2, 0]] });
  const r = g.playMove(s, 1, 1);
  const scatter = r.events.find((e) => e.type === 'scatter');
  assert.deepEqual([scatter.own, scatter.borrow], [2, 3]);
  assert.deepEqual(s.debts, [0, 3]);
  assert.deepEqual([s.scores[0].dan, s.scores[1].dan], [7, 0]);
  assert.deepEqual([g.points(s, 0), g.points(s, 1)], [10, -3]);
  assert.deepEqual(g.stoneTotals(s), g.stoneTotals(make([0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0], { scores: [[10, 0], [2, 0]] })));
  // Nothing to place anywhere: the game ends and the board is swept.
  const empty = make([0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  g.playMove(empty, 1, 1);
  assert.equal(empty.phase, 'over');
  assert.equal(empty.winner, 0);
});

check('hết quan, tàn dân: game ends, sides are swept, scores decide (and draw)', () => {
  const s = make([0, 0, 0, 1, 0, 0, 5, 2, 0, 0, 0, 3], { quan: [false, true], scores: [[10, 1], [8, 1]], debts: [0, 2] });
  const r = g.playMove(s, 3, 1); // drop 4; 5 empty → eat quan 6 + 5 dân; 7 full → stop; no quan left
  assert.equal(s.phase, 'over');
  assert.equal(r.events.at(-1).type, 'over');
  assert.deepEqual(s.scores[0], { dan: 16, quan: 2 }); // 10 + 5 + swept 1
  assert.deepEqual(s.scores[1], { dan: 13, quan: 1 }); // 8 + swept 5
  assert.deepEqual([g.points(s, 0), g.points(s, 1)], [38, 21]);
  assert.equal(s.winner, 0);
  assert.equal(g.legalMoves(s).length, 0); assert.equal(g.playMove(s, 1, 1), null);
  const draw = make([0, 0, 0, 1, 0, 0, 5, 2, 0, 0, 0, 3], { quan: [false, true], scores: [[0, 0], [7, 1]] });
  g.playMove(draw, 3, 1);
  assert.deepEqual([g.points(draw, 0), g.points(draw, 1), draw.winner], [16, 22, 1]);
  const even = make([0, 0, 0, 1, 0, 0, 5, 2, 0, 0, 0, 3], { quan: [false, true], scores: [[0, 0], [1, 1]] });
  g.playMove(even, 3, 1);
  assert.deepEqual([g.points(even, 0), g.points(even, 1), even.winner], [16, 16, -1]);
});

check('continue-sowing loops are capped and the turn ends', () => {
  const s = g.freshState({ mode: 'pvp' });
  const r = g.playMove(s, 1, 1, { maxPickups: 1 });
  assert.equal(r.reason, 'limit');
  assert.equal(r.events.filter((e) => e.type === 'pick').length, 1);
  assert.deepEqual(g.stoneTotals(s), { dan: 50, quan: 2 });
});

check('stone conservation and termination over 400 random games', () => {
  const random = seeded(7);
  let moves = 0, maxPicks = 0, finished = 0;
  for (let game = 0; game < 400; game++) {
    const s = g.freshState({ mode: 'pvp', quanNon: game % 2 === 0 });
    while (s.phase === 'playing') {
      const options = g.legalMoves(s);
      assert(options.length > 0, 'a playing side always has a move');
      const m = options[Math.floor(random() * options.length)];
      const r = g.playMove(s, m.from, m.dir);
      assert(r);
      maxPicks = Math.max(maxPicks, r.events.filter((e) => e.type === 'pick').length);
      assert.deepEqual(g.stoneTotals(s), { dan: 50, quan: 2 });
      assert.equal(g.points(s, 0) + g.points(s, 1) + s.squares.reduce((n, q) => n + q.dan + (q.quan ? 10 : 0), 0), 70);
      if (s.phase === 'playing') assert(g.validState(JSON.parse(JSON.stringify(s))), 'every in-play state is a valid save');
      moves++;
      assert(s.moves <= g.MAX_MOVES);
    }
    finished++;
  }
  assert.equal(finished, 400);
  assert(maxPicks <= g.MAX_PICKUPS);
  console.log(`# ${moves} random moves, longest chain ${maxPicks} pick-ups`);
});

check('AI levels only play legal moves and finish AI-vs-AI games', () => {
  const random = seeded(11);
  for (const level of ['easy', 'normal', 'hard']) {
    for (let game = 0; game < (level === 'hard' ? 6 : 40); game++) {
      const s = g.freshState({ mode: 'pvp', quanNon: game % 2 === 1 });
      while (s.phase === 'playing') {
        const m = g.chooseMove(s, level, random);
        assert(g.isLegal(s, m.from, m.dir), `${level} chose an illegal move`);
        g.playMove(s, m.from, m.dir, { record: false });
      }
      assert.deepEqual(g.stoneTotals(s), { dan: 50, quan: 2 });
    }
  }
  assert.equal(g.chooseMove(make([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'hard'), null);
});

check('normal takes the best immediate capture; hard sees a reply and stays under 300 ms', () => {
  const s = make([0, 1, 0, 0, 2, 0, 5, 3, 1, 1, 1, 1]);
  assert.deepEqual(g.chooseMove(s, 'normal', () => 0), { from: 1, dir: 1 });
  assert.deepEqual(g.chooseMove(s, 'hard', () => 0), { from: 1, dir: 1 });
  const random = seeded(3);
  let worst = 0;
  for (let game = 0; game < 4; game++) {
    const t = g.freshState({ mode: 'pvp' });
    for (let k = 0; k < 30 && t.phase === 'playing'; k++) {
      const start = performance.now();
      const m = g.chooseMove(t, 'hard', random);
      worst = Math.max(worst, performance.now() - start);
      g.playMove(t, m.from, m.dir, { record: false });
    }
  }
  console.log(`# hard AI worst move time ${worst.toFixed(1)} ms`);
  assert(worst < 300);
  // Hard beats greedy more often than not.
  let hardWins = 0, greedyWins = 0;
  for (let game = 0; game < 10; game++) {
    const t = g.freshState({ mode: 'pvp' });
    const hardSide = game % 2;
    while (t.phase === 'playing') {
      const m = g.chooseMove(t, t.turn === hardSide ? 'hard' : 'normal', random);
      g.playMove(t, m.from, m.dir, { record: false });
    }
    if (t.winner === hardSide) hardWins++; else if (t.winner === 1 - hardSide) greedyWins++;
  }
  console.log(`# hard vs normal: ${hardWins}-${greedyWins}`);
  assert(hardWins > greedyWins);
});

check('save validation accepts real states and rejects tampering', () => {
  const s = g.freshState({ mode: 'ai', level: 'hard' });
  g.playMove(s, 3, 1);
  const good = JSON.parse(JSON.stringify(s));
  assert.equal(g.validState(good), true);
  const repeatedLoans = { ...good, moves: 60, debts: [55, 52] };
  assert.equal(g.validState(repeatedLoans), true);
  assert.deepEqual(g.normalizeRecord({ current: repeatedLoans }).current.debts, [55, 52]);
  const bad = [
    (x) => { x.squares[1].dan++; },
    (x) => { x.squares[2].quan = true; },
    (x) => { x.squares[0].quan = false; },
    (x) => { x.squares.pop(); },
    (x) => { x.scores[0].dan = -1; x.squares[1].dan += 1; },
    (x) => { x.scores[0].dan = 1.5; },
    (x) => { x.debts = [0]; },
    (x) => { x.turn = 2; },
    (x) => { x.phase = 'over'; },
    (x) => { x.settings.level = 'god'; },
    (x) => { x.settings.quanNon = 'yes'; },
    (x) => { x.moves = -1; },
    (x) => { for (const i of g.ROWS[x.turn]) { x.scores[0].dan += x.squares[i].dan; x.squares[i].dan = 0; } },
    (x) => { x.squares = null; },
  ];
  for (const tamper of bad) { const x = JSON.parse(JSON.stringify(good)); tamper(x); assert.equal(g.validState(x), false, tamper.toString()); }
  assert.equal(g.validState(null), false);
  assert.equal(g.validState(g.freshState()), true);
  const record = g.normalizeRecord({ tally: { win: 3, loss: 2, draw: -1 }, mode: 'pvp', level: 'x', speed: 'fast', muted: true, quanNon: false, current: good });
  assert.deepEqual([record.bestScore, record.tally.draw, record.mode, record.level, record.speed, record.muted, record.quanNon], [3, 0, 'pvp', 'normal', 'fast', true, false]);
  assert.equal(record.current.turn, good.turn);
  assert.equal(g.normalizeRecord({ current: { ...good, turn: 5 } }).current, null);
  assert.equal(g.normalizeRecord(null).bestScore, 0);
});

console.log(`1..${checks}`);
