const assert = require("node:assert/strict");
const x = require("../games/co-tuong/game.js");
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${checks} - ${name}`); }
const sq = (rank, file) => x.sqOf(rank, file);
const mv = (fr, ff, tr, tf) => x.encodeMove(sq(fr, ff), sq(tr, tf));
const targets = (pos, rank, file) => x.legalMoves(pos).filter((m) => x.moveFrom(m) === sq(rank, file)).map((m) => x.moveTo(m)).sort((a, b) => a - b);
const list = (...cells) => cells.map(([r, f]) => sq(r, f)).sort((a, b) => a - b);

check("perft from the start position: 44, 1920, 79666", () => {
  const pos = x.startPosition();
  assert.equal(x.perft(pos, 1), 44);
  assert.equal(x.perft(pos, 2), 1920);
  assert.equal(x.perft(pos, 3), 79666);
  assert.equal(x.fromFen(x.START_FEN).hashA, pos.hashA, "perft leaves the position unchanged");
});
check("make/undo restores board, hash, evaluation and clock", () => {
  const pos = x.startPosition(), before = JSON.stringify([Array.from(pos.board), pos.hashA, pos.hashB, pos.score, pos.clock]);
  for (const m of x.legalMoves(pos)) { x.makeMove(pos, m); x.undoMove(pos); }
  assert.equal(JSON.stringify([Array.from(pos.board), pos.hashA, pos.hashB, pos.score, pos.clock]), before);
});
check("elephant: blocked eye and cannot cross the river", () => {
  const start = x.startPosition();
  assert.deepEqual(targets(start, 9, 2), list([7, 0], [7, 4]));
  const eye = x.fromFen("3k5/9/9/9/9/9/9/9/3P5/2B1K4 w");
  assert.deepEqual(targets(eye, 9, 2), list([7, 0]), "piece on (8,3) blocks the eye");
  const river = x.fromFen("3k5/9/9/9/9/2B6/9/9/9/4K4 w");
  assert.deepEqual(targets(river, 5, 2), list([7, 0], [7, 4]), "no move to rank 3");
  const black = x.fromFen("2b1k4/9/9/9/2b6/9/9/9/9/3K5 b");
  assert.deepEqual(targets(black, 4, 2), list([2, 0], [2, 4]));
});
check("horse: leg block (cản mã)", () => {
  const start = x.startPosition();
  assert.deepEqual(targets(start, 9, 1), list([7, 0], [7, 2]), "(9,2) elephant blocks the sideways jump");
  const open = x.fromFen("4k4/9/9/9/9/4N4/9/9/9/3K5 w");
  assert.equal(targets(open, 5, 4).length, 8);
  const legs = x.fromFen("4k4/9/9/9/4P4/3PNP3/9/9/9/3K5 w");
  assert.deepEqual(targets(legs, 5, 4), list([7, 3], [7, 5]), "three legs blocked leaves the two downward jumps");
});
check("cannon: slides like a rook, captures only over exactly one screen", () => {
  const start = x.startPosition();
  const t = targets(start, 7, 1);
  assert(t.includes(sq(0, 1)), "jumps the black cannon to take the horse");
  assert(!t.includes(sq(2, 1)) && !t.includes(sq(1, 1)), "no direct capture, no quiet move beyond a screen");
  assert(t.includes(sq(3, 1)) && t.includes(sq(7, 6)) && !t.includes(sq(7, 8)));
  const two = x.fromFen("3k5/9/r8/p8/P8/9/9/9/C8/4K4 w");
  assert(!targets(two, 8, 0).includes(sq(2, 0)), "two screens block the capture");
});
check("rook slides and captures the first enemy", () => {
  const pos = x.fromFen("3k5/9/9/9/9/9/9/9/9/R3K4 w");
  assert.deepEqual(targets(pos, 9, 0), list([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0], [9, 1], [9, 2], [9, 3]));
});
check("pawn: forward only before the river, sideways after, never backwards", () => {
  const pos = x.fromFen("3k5/9/9/9/P7P/9/P8/9/9/4K4 w");
  assert.deepEqual(targets(pos, 6, 0), list([5, 0]));
  assert.deepEqual(targets(pos, 4, 0), list([3, 0], [4, 1]));
  const last = x.fromFen("P2k5/9/9/9/9/9/9/9/9/4K4 w");
  assert.deepEqual(targets(last, 0, 0), list([0, 1]));
  const black = x.fromFen("4k4/9/9/9/9/4p4/9/9/9/3K5 b");
  assert.deepEqual(targets(black, 5, 4), list([6, 4], [5, 3], [5, 5]));
});
check("palace: general and advisors stay inside", () => {
  const pos = x.fromFen("3k5/9/9/9/9/9/9/9/9/3AK4 w");
  assert.deepEqual(targets(pos, 9, 3), list([8, 4]));
  const corner = x.fromFen("5k3/9/9/9/9/9/9/3K5/9/9 w");
  assert.deepEqual(targets(corner, 7, 3), list([7, 4], [8, 3]));
  const adv = x.fromFen("4k4/9/9/9/9/9/9/9/4A4/3K5 w");
  assert.deepEqual(targets(adv, 8, 4), list([7, 3], [7, 5], [9, 5]));
});
check("flying general: generals may not face on an open file", () => {
  const pos = x.fromFen("4k4/9/9/9/9/9/9/9/4N4/4K4 w");
  assert.equal(x.generateMoves(pos).filter((m) => x.moveFrom(m) === sq(8, 4)).length, 6);
  assert.deepEqual(targets(pos, 8, 4), [], "the only screen between the generals may not leave the file");
  const king = x.fromFen("3k5/9/9/9/9/9/9/9/9/4K4 w");
  assert(!targets(king, 9, 4).includes(sq(9, 3)), "stepping onto the enemy general's file is illegal");
  assert(x.inCheck(x.fromFen("4k4/9/9/9/9/9/9/9/9/4K4 w"), x.RED), "facing generals count as check");
});
check("a move that leaves the own general in check is illegal", () => {
  const pinned = x.fromFen("3k5/9/9/9/4r4/9/9/9/4N4/4K4 w");
  assert.deepEqual(targets(pinned, 8, 4), []);
  const checked = x.fromFen("3k5/9/9/9/4r4/9/9/9/9/R3K4 w");
  for (const m of x.legalMoves(checked)) { x.makeMove(checked, m); assert(!x.inCheck(checked, x.RED)); x.undoMove(checked); }
  assert(x.legalMoves(checked).every((m) => x.moveFrom(m) === sq(9, 4) || x.moveTo(m) === sq(4, 4) || x.rankOf(x.moveTo(m)) > 4));
});
check("checks from horse (with leg), cannon and pawn are detected", () => {
  assert(x.inCheck(x.fromFen("3k5/9/9/9/9/9/9/3n5/9/4K4 w"), x.RED));
  assert(!x.inCheck(x.fromFen("3k5/9/9/9/9/9/9/3n5/3P5/4K4 w"), x.RED), "horse leg blocked");
  assert(x.inCheck(x.fromFen("3k5/9/9/9/4c4/9/9/4P4/9/4K4 w"), x.RED));
  assert(x.inCheck(x.fromFen("3k5/9/9/9/9/9/9/9/4p4/4K4 w"), x.RED));
  assert(x.inCheck(x.fromFen("3k5/9/9/9/9/9/9/9/9/3pK4 w"), x.RED));
  assert(!x.inCheck(x.fromFen("3k5/9/9/9/9/9/9/9/9/4K4 w"), x.RED));
});
check("checkmate and stalemate both lose for the side to move", () => {
  const mate = x.fromFen("4k3R/R8/9/9/9/9/9/9/9/3K5 b");
  assert.deepEqual(x.gameResult(mate), { winner: x.RED, reason: "checkmate" });
  const stale = x.fromFen("3k5/8R/9/9/9/9/9/9/9/4K4 b");
  assert(!x.inCheck(stale, x.BLACK));
  assert.deepEqual(x.gameResult(stale), { winner: x.RED, reason: "stalemate" });
  assert.equal(x.gameResult(x.startPosition()), null);
});
check("threefold repetition draws", () => {
  const pos = x.startPosition();
  const cycle = [mv(9, 1, 7, 2), mv(0, 1, 2, 2), mv(7, 2, 9, 1), mv(2, 2, 0, 1)];
  for (const m of cycle) { x.makeMove(pos, m); assert.equal(x.gameResult(pos), null); }
  for (let i = 0; i < 3; i++) { x.makeMove(pos, cycle[i]); assert.equal(x.gameResult(pos), null); }
  x.makeMove(pos, cycle[3]);
  assert.equal(x.repetitionCount(pos), 3);
  assert.deepEqual(x.gameResult(pos), { winner: 0, reason: "repetition" });
});
check("60 moves without a capture draw; a capture resets the clock", () => {
  const pos = x.fromFen("3k5/9/9/9/9/9/9/9/r8/R3K4 w - - 119 70");
  x.makeMove(pos, mv(9, 0, 9, 1));
  assert.equal(pos.clock, 120);
  assert.deepEqual(x.gameResult(pos), { winner: 0, reason: "no-capture" });
  x.undoMove(pos);
  x.makeMove(pos, mv(9, 0, 8, 0));
  assert.equal(pos.clock, 0);
  assert.equal(x.gameResult(pos), null);
});
check("AI returns a legal move at every level", () => {
  const positions = [x.startPosition(), x.fromFen("r1bakab1r/9/1cn4c1/p1p1p1p1p/9/2P6/P3P1P1P/1C2B1NC1/9/RN1AKA2R b - - 0 1")];
  for (const pos of positions) for (const level of ["easy", "normal", "hard"]) {
    const found = x.searchBest(pos, { level, random: x.seededRandom(7), timeMs: level === "hard" ? 500 : undefined });
    assert(found && x.isLegalMove(pos, found.move), `${level} legal`);
  }
  assert.equal(x.searchBest(x.fromFen("4k3R/R8/9/9/9/9/9/9/9/3K5 b")), null, "no move when mated");
});
check("Thường finds mate in one", () => {
  const pos = x.fromFen("4k4/R8/9/9/9/8R/9/9/9/3K5 w");
  const found = x.searchBest(pos, { level: "normal" });
  x.makeMove(pos, found.move);
  assert.deepEqual(x.gameResult(pos), { winner: x.RED, reason: "checkmate" });
  const black = x.fromFen("3k5/9/9/9/9/7r1/9/9/r8/4K4 b");
  const reply = x.searchBest(black, { level: "normal" });
  x.makeMove(black, reply.move);
  assert.equal(x.gameResult(black)?.reason, "checkmate");
});
check("AI takes a hanging rook at Thường and Khó", () => {
  for (const level of ["normal", "hard"]) {
    const pos = x.fromFen("3akab2/9/4b4/9/9/3r5/9/2N6/9/4K4 w");
    const found = x.searchBest(pos, { level, timeMs: 300 });
    assert.equal(found.move, mv(7, 2, 5, 3), `${level} should capture`);
  }
});
check("save validation replays moves with the legal-move generator", () => {
  const settings = { mode: "ai", humanSide: "red" };
  const moves = [[sq(7, 1), sq(7, 4)], [sq(0, 1), sq(2, 2)], [sq(9, 1), sq(7, 2)]];
  const pos = x.validateCurrent({ moves, settings, phase: "playing" });
  assert(pos && pos.side === x.BLACK && pos.moves.length === 3);
  assert.deepEqual(x.movesToList(pos), moves);
  assert.equal(x.validateCurrent({ moves: [[sq(9, 0), sq(5, 0)]], settings, phase: "playing" }), null, "rook jumping over a pawn");
  assert.equal(x.validateCurrent({ moves: [[sq(0, 0), sq(1, 0)]], settings, phase: "playing" }), null, "black cannot move first");
  assert.equal(x.validateCurrent({ moves: [[1.5, 2]], settings, phase: "playing" }), null);
  assert.equal(x.validateCurrent({ moves: [[90, 2]], settings, phase: "playing" }), null);
  assert.equal(x.validateCurrent({ moves, settings: { mode: "solo", humanSide: "red" }, phase: "playing" }), null);
  assert.equal(x.validateCurrent({ moves, settings, phase: "over" }), null);
  assert.equal(x.validateCurrent({ moves: "abc", settings, phase: "playing" }), null);
  assert.equal(x.validateCurrent(null), null);
  assert(x.validateCurrent({ moves: [], settings: { mode: "local", humanSide: "black" }, phase: "playing" }));
  // A finished game is not resumable.
  const fin = x.startPosition();
  let guard = 0;
  while (!x.gameResult(fin) && guard++ < 400) x.makeMove(fin, x.searchBest(fin, { level: "normal", maxDepth: 2, timeMs: 1e9 }).move);
  assert(x.gameResult(fin), "depth-2 self-play finishes");
  assert.equal(x.validateCurrent({ moves: x.movesToList(fin), settings, phase: "playing" }), null);
});
console.log(`${checks} checks passed`);
