// Cờ tướng (Xiangqi): pure rules engine and AI first; the browser adapter at the bottom is skipped
// by Node checks and by ai-worker.js (no `document` there).
const XQ_VERSION = 1, XQ_STORAGE_ID = "co-tuong";
const FILES = 9, RANKS = 10, SQUARES = 90;
const KING = 1, ADVISOR = 2, ELEPHANT = 3, HORSE = 4, ROOK = 5, CANNON = 6, PAWN = 7;
const RED = 1, BLACK = -1;
const NO_CAPTURE_LIMIT = 120; // 60 full moves without a capture
const MAX_SAVED_MOVES = 1500;
const START_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";
const FEN_TYPES = { k: KING, a: ADVISOR, b: ELEPHANT, e: ELEPHANT, n: HORSE, h: HORSE, r: ROOK, c: CANNON, p: PAWN };

// Board squares: index = rank * 9 + file; rank 0 is Đen's back rank (top), rank 9 is Đỏ's back rank.
const sqOf = (rank, file) => rank * FILES + file;
const rankOf = (sq) => (sq / FILES) | 0;
const fileOf = (sq) => sq % FILES;
const onBoard = (rank, file) => rank >= 0 && rank < RANKS && file >= 0 && file < FILES;
const inPalace = (rank, file, side) => file >= 3 && file <= 5 && (side === RED ? rank >= 7 && rank <= 9 : rank >= 0 && rank <= 2);
const ownHalf = (rank, side) => (side === RED ? rank >= 5 : rank <= 4);
const encodeMove = (from, to) => (from << 8) | to;
const moveFrom = (move) => move >> 8;
const moveTo = (move) => move & 255;

// Zobrist keys (two independent 32-bit halves) from a fixed xorshift seed, so hashes are reproducible.
const ZOBRIST_A = new Int32Array(14 * SQUARES), ZOBRIST_B = new Int32Array(14 * SQUARES);
let SIDE_A = 0, SIDE_B = 0;
(() => {
  let s = 0x9e3779b9 | 0;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; };
  for (let i = 0; i < ZOBRIST_A.length; i++) { ZOBRIST_A[i] = next(); ZOBRIST_B[i] = next(); }
  SIDE_A = next(); SIDE_B = next();
})();
const pieceIndex = (piece) => (piece > 0 ? piece - 1 : 6 - piece);

// Evaluation: material + piece-square tables written from Đỏ's view (row 0 = enemy back rank).
const MATERIAL = [0, 0, 200, 200, 400, 900, 450, 100];
const sparseTable = (entries) => {
  const table = new Array(SQUARES).fill(0);
  for (const [rank, file, value] of entries) table[sqOf(rank, file)] = value;
  return table;
};
const PST = {
  [KING]: sparseTable([[7, 3, -20], [7, 4, -25], [7, 5, -20], [8, 3, -8], [8, 4, -10], [8, 5, -8], [9, 3, -2], [9, 5, -2]]),
  [ADVISOR]: sparseTable([[8, 4, 8], [9, 3, 2], [9, 5, 2]]),
  [ELEPHANT]: sparseTable([[7, 4, 8], [9, 2, 2], [9, 6, 2], [5, 0, -2], [5, 8, -2], [5, 4, 2]]),
  [HORSE]: [
    4, 8, 16, 12, 4, 12, 16, 8, 4,
    4, 10, 28, 16, 8, 16, 28, 10, 4,
    12, 14, 16, 20, 18, 20, 16, 14, 12,
    8, 24, 18, 24, 20, 24, 18, 24, 8,
    6, 16, 14, 18, 16, 18, 14, 16, 6,
    4, 12, 16, 14, 12, 14, 16, 12, 4,
    2, 6, 8, 6, 10, 6, 8, 6, 2,
    4, 2, 8, 8, 4, 8, 8, 2, 4,
    0, 2, 4, 4, -2, 4, 4, 2, 0,
    0, -4, 0, 0, 0, 0, 0, -4, 0],
  [ROOK]: [
    14, 14, 12, 18, 16, 18, 12, 14, 14,
    16, 20, 18, 24, 26, 24, 18, 20, 16,
    12, 12, 12, 18, 18, 18, 12, 12, 12,
    12, 18, 16, 22, 22, 22, 16, 18, 12,
    12, 14, 12, 18, 18, 18, 12, 14, 12,
    12, 16, 14, 20, 20, 20, 14, 16, 12,
    6, 10, 8, 14, 14, 14, 8, 10, 6,
    4, 8, 6, 14, 12, 14, 6, 8, 4,
    8, 4, 8, 16, 8, 16, 8, 4, 8,
    -2, 10, 6, 14, 12, 14, 6, 10, -2],
  [CANNON]: [
    6, 4, 0, -10, -12, -10, 0, 4, 6,
    2, 2, 0, -4, -14, -4, 0, 2, 2,
    2, 2, 0, -10, -8, -10, 0, 2, 2,
    0, 0, -2, 4, 10, 4, -2, 0, 0,
    0, 0, 0, 2, 8, 2, 0, 0, 0,
    -2, 0, 4, 2, 6, 2, 4, 0, -2,
    0, 0, 0, 2, 4, 2, 0, 0, 0,
    4, 0, 8, 6, 10, 6, 8, 0, 4,
    0, 2, 4, 6, 6, 6, 4, 2, 0,
    0, 0, 2, 6, 6, 6, 2, 0, 0],
  [PAWN]: [
    0, 3, 6, 9, 12, 9, 6, 3, 0,
    18, 36, 56, 70, 80, 70, 56, 36, 18,
    14, 26, 42, 60, 70, 60, 42, 26, 14,
    10, 20, 30, 34, 40, 34, 30, 20, 10,
    6, 12, 18, 18, 20, 18, 18, 12, 6,
    2, 0, 8, 0, 8, 0, 8, 0, 2,
    0, 0, -2, 0, 4, 0, -2, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0],
};
// PIECE_SQUARE[pieceIndex * 90 + sq] = signed value from Đỏ's point of view.
const PIECE_SQUARE = new Int32Array(14 * SQUARES);
for (let type = KING; type <= PAWN; type++) {
  for (let sq = 0; sq < SQUARES; sq++) {
    const mirrored = sqOf(9 - rankOf(sq), fileOf(sq));
    PIECE_SQUARE[pieceIndex(type) * SQUARES + sq] = MATERIAL[type] + PST[type][sq];
    PIECE_SQUARE[pieceIndex(-type) * SQUARES + sq] = -(MATERIAL[type] + PST[type][mirrored]);
  }
}

function emptyPosition() {
  return { board: new Int8Array(SQUARES), side: RED, kings: { [RED]: -1, [BLACK]: -1 }, clock: 0, score: 0,
    hashA: 0, hashB: 0, moves: [], undo: [], histA: [], histB: [] };
}
function rehash(pos) {
  let a = 0, b = 0, score = 0;
  pos.kings[RED] = pos.kings[BLACK] = -1;
  for (let sq = 0; sq < SQUARES; sq++) {
    const piece = pos.board[sq];
    if (!piece) continue;
    const k = pieceIndex(piece) * SQUARES + sq;
    a ^= ZOBRIST_A[k]; b ^= ZOBRIST_B[k]; score += PIECE_SQUARE[k];
    if (Math.abs(piece) === KING) pos.kings[Math.sign(piece)] = sq;
  }
  if (pos.side === BLACK) { a ^= SIDE_A; b ^= SIDE_B; }
  pos.hashA = a; pos.hashB = b; pos.score = score;
  pos.histA = [a]; pos.histB = [b];
}
// Accepts standard Xiangqi FEN (ranks from Đen's side); returns null when malformed.
function fromFen(fen) {
  if (typeof fen !== "string") return null;
  const [placement, sideText = "w", , , clockText = "0"] = fen.trim().split(/\s+/);
  const rows = placement.split("/");
  if (rows.length !== RANKS) return null;
  const pos = emptyPosition();
  for (let rank = 0; rank < RANKS; rank++) {
    let file = 0;
    for (const ch of rows[rank]) {
      if (/[1-9]/.test(ch)) { file += Number(ch); continue; }
      const type = FEN_TYPES[ch.toLowerCase()];
      if (!type || file >= FILES) return null;
      pos.board[sqOf(rank, file++)] = ch === ch.toUpperCase() ? type : -type;
    }
    if (file !== FILES) return null;
  }
  pos.side = sideText === "b" ? BLACK : RED;
  pos.clock = Math.max(0, Number.parseInt(clockText, 10) || 0);
  rehash(pos);
  if (pos.kings[RED] < 0 || pos.kings[BLACK] < 0) return null;
  return pos;
}
function startPosition() { return fromFen(START_FEN); }
function clonePosition(pos) {
  return { board: Int8Array.from(pos.board), side: pos.side, kings: { ...pos.kings }, clock: pos.clock, score: pos.score,
    hashA: pos.hashA, hashB: pos.hashB, moves: pos.moves.slice(), undo: pos.undo.slice(), histA: pos.histA.slice(), histB: pos.histB.slice() };
}

function makeMove(pos, move) {
  const from = moveFrom(move), to = moveTo(move), board = pos.board;
  const piece = board[from], captured = board[to];
  pos.undo.push(move, captured, pos.clock, pos.hashA, pos.hashB, pos.score);
  const kf = pieceIndex(piece) * SQUARES + from, kt = pieceIndex(piece) * SQUARES + to;
  let a = pos.hashA ^ ZOBRIST_A[kf] ^ ZOBRIST_A[kt] ^ SIDE_A;
  let b = pos.hashB ^ ZOBRIST_B[kf] ^ ZOBRIST_B[kt] ^ SIDE_B;
  let score = pos.score - PIECE_SQUARE[kf] + PIECE_SQUARE[kt];
  if (captured) {
    const kc = pieceIndex(captured) * SQUARES + to;
    a ^= ZOBRIST_A[kc]; b ^= ZOBRIST_B[kc]; score -= PIECE_SQUARE[kc];
    pos.clock = 0;
  } else pos.clock++;
  board[to] = piece; board[from] = 0;
  if (piece === KING || piece === -KING) pos.kings[piece > 0 ? RED : BLACK] = to;
  pos.side = -pos.side;
  pos.hashA = a; pos.hashB = b; pos.score = score;
  pos.moves.push(move); pos.histA.push(a); pos.histB.push(b);
  return captured;
}
function undoMove(pos) {
  if (!pos.moves.length) return false;
  const u = pos.undo, base = u.length - 6;
  const move = u[base], captured = u[base + 1];
  const from = moveFrom(move), to = moveTo(move), piece = pos.board[to];
  pos.board[from] = piece; pos.board[to] = captured;
  if (piece === KING || piece === -KING) pos.kings[piece > 0 ? RED : BLACK] = from;
  pos.clock = u[base + 2]; pos.hashA = u[base + 3]; pos.hashB = u[base + 4]; pos.score = u[base + 5];
  u.length = base;
  pos.side = -pos.side;
  pos.moves.pop(); pos.histA.pop(); pos.histB.pop();
  return true;
}

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
// Horse jumps with the "leg" square that blocks them (cản mã).
const HORSE_JUMPS = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]];

// Pseudo-legal moves for the side to move (own general may be left in check); capturesOnly for quiescence.
function generateMoves(pos, capturesOnly = false, out = []) {
  const board = pos.board, side = pos.side;
  const add = (from, rank, file) => {
    const to = sqOf(rank, file), target = board[to];
    if (target * side > 0 || (capturesOnly && !target)) return;
    out.push(encodeMove(from, to));
  };
  for (let from = 0; from < SQUARES; from++) {
    const piece = board[from];
    if (piece * side <= 0) continue;
    const r = rankOf(from), f = fileOf(from);
    switch (piece * side) {
      case KING:
        for (const [dr, df] of ORTHO) if (inPalace(r + dr, f + df, side)) add(from, r + dr, f + df);
        break;
      case ADVISOR:
        for (const [dr, df] of DIAG) if (inPalace(r + dr, f + df, side)) add(from, r + dr, f + df);
        break;
      case ELEPHANT:
        for (const [dr, df] of DIAG) {
          const tr = r + 2 * dr, tf = f + 2 * df;
          // Cannot cross the river and is blocked by a piece on the "eye" (mắt tượng).
          if (onBoard(tr, tf) && ownHalf(tr, side) && !board[sqOf(r + dr, f + df)]) add(from, tr, tf);
        }
        break;
      case HORSE:
        for (const [dr, df, lr, lf] of HORSE_JUMPS) {
          const tr = r + dr, tf = f + df;
          if (onBoard(tr, tf) && !board[sqOf(r + lr, f + lf)]) add(from, tr, tf);
        }
        break;
      case ROOK:
        for (const [dr, df] of ORTHO) {
          for (let tr = r + dr, tf = f + df; onBoard(tr, tf); tr += dr, tf += df) {
            const target = board[sqOf(tr, tf)];
            if (!target) { if (!capturesOnly) out.push(encodeMove(from, sqOf(tr, tf))); continue; }
            if (target * side < 0) out.push(encodeMove(from, sqOf(tr, tf)));
            break;
          }
        }
        break;
      case CANNON:
        for (const [dr, df] of ORTHO) {
          let tr = r + dr, tf = f + df;
          for (; onBoard(tr, tf) && !board[sqOf(tr, tf)]; tr += dr, tf += df) if (!capturesOnly) out.push(encodeMove(from, sqOf(tr, tf)));
          // Jump exactly one screen, then capture the first piece behind it if it is an enemy.
          for (tr += dr, tf += df; onBoard(tr, tf); tr += dr, tf += df) {
            const target = board[sqOf(tr, tf)];
            if (!target) continue;
            if (target * side < 0) out.push(encodeMove(from, sqOf(tr, tf)));
            break;
          }
        }
        break;
      case PAWN: {
        const forward = side === RED ? -1 : 1;
        if (onBoard(r + forward, f)) add(from, r + forward, f);
        if (!ownHalf(r, side)) { if (f > 0) add(from, r, f - 1); if (f < FILES - 1) add(from, r, f + 1); }
        break;
      }
    }
  }
  return out;
}

// True when `side`'s general is attacked (including the flying-general rule).
function inCheck(pos, side) {
  const board = pos.board, king = pos.kings[side], enemy = -side;
  if (king < 0) return true;
  const kr = rankOf(king), kf = fileOf(king);
  for (const [dr, df] of ORTHO) {
    let r = kr + dr, f = kf + df, screens = 0;
    for (; onBoard(r, f); r += dr, f += df) {
      const piece = board[sqOf(r, f)];
      if (!piece) continue;
      if (screens === 0) {
        if (piece === enemy * ROOK || (df === 0 && piece === enemy * KING)) return true;
        screens = 1;
      } else {
        if (piece === enemy * CANNON) return true;
        break;
      }
    }
  }
  for (const [dr, df] of HORSE_JUMPS) {
    // A horse at king - (dr, df) jumps by (dr, df); its leg sits next to the horse in the long direction.
    const hr = kr - dr, hf = kf - df;
    if (!onBoard(hr, hf) || board[sqOf(hr, hf)] !== enemy * HORSE) continue;
    const legR = Math.abs(dr) === 2 ? hr + Math.sign(dr) : hr, legF = Math.abs(df) === 2 ? hf + Math.sign(df) : hf;
    if (!board[sqOf(legR, legF)]) return true;
  }
  const pawnRank = kr - (enemy === RED ? -1 : 1);
  if (onBoard(pawnRank, kf) && board[sqOf(pawnRank, kf)] === enemy * PAWN) return true;
  // A general always stands in the enemy pawns' crossed half, so sideways pawns attack too.
  if (kf > 0 && board[sqOf(kr, kf - 1)] === enemy * PAWN) return true;
  if (kf < FILES - 1 && board[sqOf(kr, kf + 1)] === enemy * PAWN) return true;
  return false;
}

function legalMoves(pos, capturesOnly = false) {
  const side = pos.side, legal = [];
  for (const move of generateMoves(pos, capturesOnly)) {
    makeMove(pos, move);
    if (!inCheck(pos, side)) legal.push(move);
    undoMove(pos);
  }
  return legal;
}
function isLegalMove(pos, move) { return legalMoves(pos).includes(move); }
function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) { makeMove(pos, move); total += perft(pos, depth - 1); undoMove(pos); }
  return total;
}
function repetitionCount(pos) {
  const a = pos.hashA, b = pos.hashB;
  let count = 0;
  for (let i = pos.histA.length - 1; i >= 0; i -= 2) if (pos.histA[i] === a && pos.histB[i] === b) count++;
  return count;
}
// null while the game continues; otherwise { winner: RED | BLACK | 0, reason }.
function gameResult(pos) {
  if (!legalMoves(pos).length) return { winner: -pos.side, reason: inCheck(pos, pos.side) ? "checkmate" : "stalemate" };
  // ponytail: repetition draws instead of tournament long-check/chase adjudication; add chase history for rated play.
  if (repetitionCount(pos) >= 3) return { winner: 0, reason: "repetition" };
  if (pos.clock >= NO_CAPTURE_LIMIT) return { winner: 0, reason: "no-capture" };
  return null;
}

// Replays [[from, to], ...] from the start position; null if any move is malformed or illegal.
function positionFromMoves(list) {
  if (!Array.isArray(list) || list.length > MAX_SAVED_MOVES) return null;
  const pos = startPosition();
  for (const pair of list) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => Number.isInteger(n) && n >= 0 && n < SQUARES)) return null;
    if (gameResult(pos)) return null;
    const move = encodeMove(pair[0], pair[1]);
    if (!isLegalMove(pos, move)) return null;
    makeMove(pos, move);
  }
  return pos;
}
const movesToList = (pos) => pos.moves.map((move) => [moveFrom(move), moveTo(move)]);
const SETTINGS = { mode: ["ai", "local"], humanSide: ["red", "black"], level: ["easy", "normal", "hard"], labels: ["han", "viet"] };
function validSettings(settings) {
  return !!settings && typeof settings === "object" && SETTINGS.mode.includes(settings.mode) && SETTINGS.humanSide.includes(settings.humanSide);
}
// Saved `current` = { moves, settings: { mode, humanSide }, phase: "playing" }; returns the replayed position or null.
function validateCurrent(current) {
  if (!current || typeof current !== "object" || current.phase !== "playing" || !validSettings(current.settings)) return null;
  const pos = positionFromMoves(current.moves);
  return pos && !gameResult(pos) ? pos : null;
}

// ---- AI: negamax alpha-beta, iterative deepening, quiescence on captures, MVV-LVA + killers + history ----
const MATE = 30000, INFINITE = 32000, MAX_PLY = 64;
const LEVELS = {
  easy: { maxDepth: 2, timeMs: 400, noise: 70, blunder: 0.12 },
  normal: { maxDepth: 32, timeMs: 600, noise: 0, blunder: 0 },
  hard: { maxDepth: 32, timeMs: 1500, noise: 0, blunder: 0 },
};
const ORDER_VALUE = [0, 5000, 200, 200, 400, 900, 450, 100];
const TT_SIZE = 1 << 18, TT_MASK = TT_SIZE - 1;
let tt = null;
const evaluate = (pos) => pos.score * pos.side;

function searchBest(input, options = {}) {
  const level = LEVELS[options.level] || LEVELS.normal;
  const random = options.random || Math.random;
  const now = options.now || (() => Date.now());
  const timeMs = options.timeMs ?? level.timeMs, maxDepth = options.maxDepth ?? level.maxDepth;
  const pos = clonePosition(input);
  const rootMoves = legalMoves(pos);
  if (!rootMoves.length) return null;
  if (rootMoves.length === 1) return { move: rootMoves[0], score: 0, depth: 0, nodes: 0 };
  if (level.blunder && random() < level.blunder) return { move: rootMoves[Math.floor(random() * rootMoves.length)], score: 0, depth: 0, nodes: 0 };
  tt ||= { key: new Int32Array(TT_SIZE), move: new Int32Array(TT_SIZE), score: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Int8Array(TT_SIZE) };
  tt.flag.fill(0);
  const killers = new Int32Array(MAX_PLY * 2), history = new Int32Array(SQUARES * SQUARES);
  const deadline = now() + timeMs;
  let nodes = 0, aborted = false, canAbort = false;
  const timeUp = () => {
    if (canAbort && (nodes & 1023) === 0 && now() > deadline) aborted = true;
    return aborted;
  };
  const repeated = () => {
    const n = pos.histA.length - 1;
    for (let i = n - 2; i >= 0 && i >= n - pos.clock; i -= 2) if (pos.histA[i] === pos.hashA && pos.histB[i] === pos.hashB) return true;
    return false;
  };
  const orderScores = (moves, ttMove, ply) => moves.map((move) => {
    if (move === ttMove) return 1e7;
    const victim = pos.board[moveTo(move)];
    if (victim) return 1e6 + ORDER_VALUE[Math.abs(victim)] * 16 - Math.abs(pos.board[moveFrom(move)]);
    if (move === killers[ply * 2]) return 9e5;
    if (move === killers[ply * 2 + 1]) return 8e5;
    return history[moveFrom(move) * SQUARES + moveTo(move)];
  });
  const pickNext = (moves, scores, i) => {
    let best = i;
    for (let j = i + 1; j < moves.length; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) { [moves[i], moves[best]] = [moves[best], moves[i]]; [scores[i], scores[best]] = [scores[best], scores[i]]; }
    return moves[i];
  };

  function quiesce(alpha, beta, ply) {
    nodes++;
    if (timeUp()) return 0;
    if (ply >= MAX_PLY) return evaluate(pos);
    const checked = inCheck(pos, pos.side);
    let best = -INFINITE;
    if (!checked) {
      best = evaluate(pos);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
    const moves = generateMoves(pos, !checked), scores = orderScores(moves, 0, ply), side = pos.side;
    for (let i = 0; i < moves.length; i++) {
      const move = pickNext(moves, scores, i);
      makeMove(pos, move);
      if (inCheck(pos, side)) { undoMove(pos); continue; }
      const score = -quiesce(-beta, -alpha, ply + 1);
      undoMove(pos);
      if (aborted) return 0;
      if (score > best) { best = score; if (score > alpha) { alpha = score; if (score >= beta) break; } }
    }
    // In check with no evasions: checkmated (stalemate also loses, but quiescence only sees checks).
    return best === -INFINITE ? -MATE + ply : best;
  }

  function negamax(depth, alpha, beta, ply) {
    if (ply >= MAX_PLY) return evaluate(pos);
    const checked = inCheck(pos, pos.side);
    if (checked) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    nodes++;
    if (timeUp()) return 0;
    if (repeated() || pos.clock >= NO_CAPTURE_LIMIT) return 0;
    const slot = pos.hashA & TT_MASK;
    let ttMove = 0;
    if (tt.flag[slot] && tt.key[slot] === pos.hashB) {
      ttMove = tt.move[slot];
      if (tt.depth[slot] >= depth) {
        let s = tt.score[slot];
        if (s > MATE - MAX_PLY) s -= ply; else if (s < -MATE + MAX_PLY) s += ply;
        const flag = tt.flag[slot];
        if (flag === 1 || (flag === 2 && s >= beta) || (flag === 3 && s <= alpha)) return s;
      }
    }
    const moves = generateMoves(pos), scores = orderScores(moves, ttMove, ply), side = pos.side, startAlpha = alpha;
    let best = -INFINITE, bestMove = 0, legal = 0;
    for (let i = 0; i < moves.length; i++) {
      const move = pickNext(moves, scores, i);
      const quiet = !pos.board[moveTo(move)];
      makeMove(pos, move);
      if (inCheck(pos, side)) { undoMove(pos); continue; }
      legal++;
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      undoMove(pos);
      if (aborted) return 0;
      if (score > best) {
        best = score; bestMove = move;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) {
            if (quiet) {
              if (killers[ply * 2] !== move) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = move; }
              history[moveFrom(move) * SQUARES + moveTo(move)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (!legal) return -MATE + ply; // checkmate and stalemate both lose
    let stored = best;
    if (stored > MATE - MAX_PLY) stored += ply; else if (stored < -MATE + MAX_PLY) stored -= ply;
    tt.key[slot] = pos.hashB; tt.move[slot] = bestMove; tt.score[slot] = stored; tt.depth[slot] = Math.min(depth, 127);
    tt.flag[slot] = best >= beta ? 2 : best > startAlpha ? 1 : 3;
    return best;
  }

  const noise = rootMoves.map(() => (level.noise ? Math.round((random() * 2 - 1) * level.noise) : 0));
  const firstScores = orderScores(rootMoves, 0, 0);
  const order = rootMoves.map((move, i) => [move, firstScores[i], noise[i]]).sort((x, y) => y[1] - x[1]);
  let bestMove = order[0][0], bestScore = -INFINITE, completed = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -INFINITE, iterBest = -1, iterScore = -INFINITE;
    for (let i = 0; i < order.length; i++) {
      makeMove(pos, order[i][0]);
      const score = -negamax(depth - 1, -INFINITE, -alpha, 1) + order[i][2];
      undoMove(pos);
      if (aborted) break;
      if (score > iterScore) { iterScore = score; iterBest = i; if (score > alpha) alpha = score; }
    }
    if (iterBest >= 0) {
      bestMove = order[iterBest][0]; bestScore = iterScore;
      order.unshift(order.splice(iterBest, 1)[0]);
    }
    if (aborted) break;
    completed = depth; canAbort = true;
    if (Math.abs(bestScore) > MATE - MAX_PLY || now() > deadline) break;
  }
  return { move: bestMove, score: bestScore, depth: completed, nodes };
}

// Small deterministic generator for the worker and tests.
function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

if (typeof module !== "undefined") module.exports = {
  FILES, RANKS, KING, ADVISOR, ELEPHANT, HORSE, ROOK, CANNON, PAWN, RED, BLACK, START_FEN, NO_CAPTURE_LIMIT, LEVELS,
  sqOf, rankOf, fileOf, encodeMove, moveFrom, moveTo, fromFen, startPosition, clonePosition, makeMove, undoMove,
  generateMoves, legalMoves, isLegalMove, inCheck, perft, repetitionCount, gameResult, positionFromMoves, movesToList,
  validSettings, validateCurrent, searchBest, seededRandom, evaluate,
};

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(XQ_STORAGE_ID);
  const $ = (selector) => document.querySelector(selector);
  const boardEl = $("#xq-board"), overlay = $("#xq-overlay"), overlayTitle = overlay.querySelector("h2"), overlayText = overlay.querySelector("p");
  const primary = $("#xq-primary"), secondary = $("#xq-secondary"), undoButton = $("#xq-undo"), newButton = $("#xq-new");
  const turnText = $("#xq-turn-text"), turnSwatch = $("#xq-turn-swatch"), menu = $("#game-menu");
  const muteToggle = $("#mute"), selects = { mode: $("#set-mode"), humanSide: $("#set-side"), level: $("#set-level"), labels: $("#set-labels") };
  const announce = createAnnouncer($("#xq-status"));
  const NAMES = ["", "Tướng", "Sĩ", "Tượng", "Mã", "Xe", "Pháo", "Tốt"];
  const HAN = { [RED]: ["", "帥", "仕", "相", "傌", "俥", "炮", "兵"], [BLACK]: ["", "將", "士", "象", "馬", "車", "砲", "卒"] };
  const SIDE_NAME = { [RED]: "Đỏ", [BLACK]: "Đen" };
  const REASONS = {
    checkmate: (w) => [`${SIDE_NAME[w]} thắng — chiếu bí`, `${SIDE_NAME[-w]} bị chiếu và không còn nước đỡ.`],
    stalemate: (w) => [`${SIDE_NAME[w]} thắng — hết nước`, `${SIDE_NAME[-w]} không còn nước đi hợp lệ nên thua.`],
    repetition: () => ["Hòa — lặp lại thế cờ", "Cùng một thế cờ lặp lại ba lần."],
    "no-capture": () => ["Hòa — 60 nước không ăn quân", "Hai bên đi 60 nước liền không ăn quân nào."],
  };

  const saved = store.read();
  const pick = (key, value, fallback) => (SETTINGS[key].includes(value) ? value : fallback);
  const savedTally = saved?.tally && typeof saved.tally === "object" ? saved.tally : {};
  const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);
  let record = {
    version: XQ_VERSION, tally: { win: count(savedTally.win), loss: count(savedTally.loss), draw: count(savedTally.draw) },
    mode: pick("mode", saved?.mode, "ai"), humanSide: pick("humanSide", saved?.humanSide, "red"),
    level: pick("level", saved?.level, "normal"), labels: pick("labels", saved?.labels, "han"), muted: saved?.muted === true, current: null,
  };
  record.bestScore = record.tally.win;
  const tone = createTone(() => record.muted);

  let pos = validateCurrent(saved?.current);
  let game = pos ? { mode: saved.current.settings.mode, humanSide: saved.current.settings.humanSide } : { mode: record.mode, humanSide: record.humanSide };
  pos ||= startPosition();
  let result = null, selected = -1, targets = [], cursor = sqOf(9, 4), overlayMode = null, thinking = false, token = 0;
  let worker = null, workerBroken = false, fallbackTimer = 0, pacingTimer = 0, pendingReply = null;

  const humanColor = () => (game.humanSide === "black" ? BLACK : RED);
  const isHumanTurn = () => game.mode === "local" || pos.side === humanColor();
  const flipped = () => game.mode === "ai" && game.humanSide === "black";
  const displayIndex = (sq) => (flipped() ? SQUARES - 1 - sq : sq);
  const place = (sq) => { const d = displayIndex(sq); return `cột ${fileOf(d) + 1}, hàng ${rankOf(d) + 1}`; };
  const pieceName = (piece) => `${NAMES[Math.abs(piece)]} ${piece > 0 ? "đỏ" : "đen"}`;

  const persist = () => {
    record.current = result ? null : { moves: movesToList(pos), settings: { ...game }, phase: "playing" };
    record.bestScore = record.tally.win;
    store.write(record);
  };

  // 90 intersection buttons in display order; each keeps the engine square it shows in data-sq.
  const points = [];
  for (let i = 0; i < SQUARES; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "xq-point";
    button.style.left = `${(fileOf(i) * 100) / FILES}%`;
    button.style.top = `${(rankOf(i) * 100) / RANKS}%`;
    button.tabIndex = -1;
    button.append(document.createElement("span"));
    boardEl.append(button);
    points.push(button);
  }
  const buttonFor = (sq) => points[displayIndex(sq)];

  function turnLabel() {
    if (result) return REASONS[result.reason](result.winner)[0];
    const side = SIDE_NAME[pos.side], check = inCheck(pos, pos.side) ? " · chiếu tướng!" : "";
    if (game.mode === "local") return `Lượt ${side}${check}`;
    return pos.side === humanColor() ? `Lượt ${side} — bạn${check}` : `Lượt ${side} — Máy đang nghĩ…${check}`;
  }
  function render() {
    const last = pos.moves.at(-1);
    const checked = !result || result.reason === "checkmate" ? (inCheck(pos, pos.side) ? pos.kings[pos.side] : -1) : -1;
    const targetSet = new Map(targets.map((move) => [moveTo(move), move]));
    for (let i = 0; i < SQUARES; i++) {
      const button = points[i], sq = flipped() ? SQUARES - 1 - i : i, piece = pos.board[sq], disc = button.firstChild;
      const isTarget = targetSet.has(sq);
      button.dataset.sq = sq;
      button.classList.toggle("is-target", isTarget);
      button.classList.toggle("is-selected", sq === selected);
      button.classList.toggle("is-last-from", last !== undefined && moveFrom(last) === sq);
      button.classList.toggle("is-last-to", last !== undefined && moveTo(last) === sq);
      button.classList.toggle("is-check", sq === checked);
      button.tabIndex = sq === cursor ? 0 : -1;
      disc.className = piece ? `xq-piece ${piece > 0 ? "is-red" : "is-black"}` : "";
      disc.textContent = piece ? (record.labels === "han" ? HAN[Math.sign(piece)][Math.abs(piece)] : NAMES[Math.abs(piece)]) : "";
      disc.lang = piece && record.labels === "han" ? "zh-Hant" : "vi";
      let label = `${piece ? pieceName(piece) : "Trống"}, ${place(sq)}`;
      if (sq === selected) label += ", đang chọn";
      if (isTarget) label += piece ? ", ăn được" : ", đi tới được";
      if (sq === checked) label += ", đang bị chiếu";
      else if (last !== undefined && moveTo(last) === sq) label += ", vừa đi";
      button.setAttribute("aria-label", label);
    }
    boardEl.classList.toggle("is-viet", record.labels === "viet");
    boardEl.setAttribute("aria-busy", String(thinking));
    turnText.textContent = turnLabel();
    turnSwatch.className = result ? "" : pos.side === RED ? "is-red" : "is-black";
    let red = 0, black = 0;
    for (let i = 1; i < pos.undo.length; i += 6) if (pos.undo[i]) (pos.undo[i] < 0 ? red++ : black++);
    $("#xq-moves").textContent = Math.ceil(pos.moves.length / 2).toLocaleString("vi-VN");
    $("#xq-red-takes").textContent = red;
    $("#xq-black-takes").textContent = black;
    $("#xq-wins").textContent = record.tally.win.toLocaleString("vi-VN");
    $("#xq-wins-stat").hidden = game.mode !== "ai";
    undoButton.disabled = !canUndo();
    syncSettings();
    showOverlay();
  }
  function syncSettings() {
    for (const [key, select] of Object.entries(selects)) select.value = record[key];
    selects.humanSide.disabled = record.mode !== "ai";
    selects.level.disabled = record.mode !== "ai";
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
  }
  function showOverlay() {
    overlay.hidden = !overlayMode;
    overlay.classList.toggle("is-result", overlayMode === "over");
    if (overlayMode === "over") {
      const [title, text] = REASONS[result.reason](result.winner);
      const you = game.mode === "ai" ? (result.winner === 0 ? " Ván hòa." : result.winner === humanColor() ? " Bạn thắng máy!" : " Máy thắng ván này.") : "";
      overlayTitle.textContent = title;
      overlayText.textContent = text + you;
      primary.textContent = "Chơi lại";
      secondary.textContent = "Xem bàn cờ";
    } else if (overlayMode === "confirm") {
      overlayTitle.textContent = "Bắt đầu ván mới?";
      overlayText.textContent = "Ván đang chơi sẽ bị bỏ.";
      primary.textContent = "Ván mới";
      secondary.textContent = "Tiếp tục";
    }
  }

  function canUndo() {
    if (result || thinking || !pos.moves.length) return false;
    if (game.mode === "local") return true;
    // Undo the machine's reply and the player's move, landing back on the player's turn.
    const plies = pos.side === humanColor() ? 2 : 1;
    return pos.moves.length >= plies;
  }
  function undo() {
    if (!canUndo()) return;
    cancelThinking();
    const plies = game.mode === "local" ? 1 : pos.side === humanColor() ? 2 : 1;
    for (let i = 0; i < plies; i++) undoMove(pos);
    selected = -1; targets = [];
    announce(`Đã đi lại. ${turnLabel()}.`);
    persist(); render();
    focusCursor();
    maybeMachine();
  }
  function newGame() {
    cancelThinking();
    pos = startPosition();
    game = { mode: record.mode, humanSide: record.humanSide };
    result = null; selected = -1; targets = []; overlayMode = null;
    cursor = flipped() ? sqOf(0, 4) : sqOf(9, 4);
    persist(); render();
    announce(`Ván mới. ${turnLabel()}.`);
    focusCursor();
    maybeMachine();
  }
  const focusCursor = () => { if (!menu.open && overlay.hidden) buttonFor(cursor).focus({ preventScroll: true }); };

  function describe(move, captured, side) {
    const piece = pos.board[moveTo(move)];
    let text = `${SIDE_NAME[side]}: ${NAMES[Math.abs(piece)]} ${place(moveFrom(move))} đến ${place(moveTo(move))}`;
    if (captured) text += `, ăn ${pieceName(captured)}`;
    return text + ".";
  }
  function play(move) {
    const side = pos.side;
    const captured = makeMove(pos, move);
    selected = -1; targets = [];
    result = gameResult(pos);
    const check = !result && inCheck(pos, pos.side);
    let text = describe(move, captured, side);
    if (result) {
      finish(text);
      return;
    }
    if (check) { text += " Chiếu tướng!"; tone.play([[880, 0, .07], [660, .08, .1]]); }
    else tone.play(captured ? [[330, 0, .05], [494, .05, .07]] : [[392, 0, .05]], .07);
    announce(`${text} ${turnLabel()}.`);
    persist(); render();
    maybeMachine();
  }
  function finish(text) {
    if (game.mode === "ai") {
      const key = result.winner === 0 ? "draw" : result.winner === humanColor() ? "win" : "loss";
      record.tally[key]++;
    }
    overlayMode = "over";
    const [title] = REASONS[result.reason](result.winner);
    const good = game.mode === "local" || result.winner === humanColor();
    tone.play(result.winner === 0 ? [[440, 0, .1], [440, .12, .12]] : good ? [[523, 0, .1], [659, .1, .1], [784, .2, .2]] : [[220, 0, .12], [165, .12, .2]]);
    announce(`${text} ${title}.`);
    persist(); render();
    primary.focus({ preventScroll: true });
  }

  // ---- Machine player: Web Worker with a main-thread fallback; stale answers are dropped by token ----
  function cancelThinking() {
    token++;
    thinking = false;
    pendingReply = null;
    clearTimeout(fallbackTimer); clearTimeout(pacingTimer);
    if (worker) { worker.terminate(); worker = null; }
  }
  function ensureWorker() {
    if (worker || workerBroken || typeof Worker === "undefined") return worker;
    try {
      worker = new Worker("./ai-worker.js?v=1");
      worker.onmessage = (event) => receive(event.data?.id, event.data?.move);
      worker.onerror = (event) => { event.preventDefault?.(); workerBroken = true; worker?.terminate(); worker = null; if (thinking) thinkOnMainThread(token); };
    } catch { workerBroken = true; worker = null; }
    return worker;
  }
  function maybeMachine() {
    if (result || overlayMode === "confirm" || menu.open || document.hidden || game.mode !== "ai" || pos.side === humanColor() || thinking) return;
    thinking = true;
    const id = ++token;
    const started = performance.now();
    render();
    const payload = { id, moves: movesToList(pos), level: record.level, seed: (Math.random() * 2 ** 31) | 0 };
    pendingStart = started;
    if (ensureWorker()) worker.postMessage(payload);
    else thinkOnMainThread(id);
  }
  let pendingStart = 0;
  function thinkOnMainThread(id) {
    // Let the "thinking" label paint first; the search then blocks briefly.
    fallbackTimer = setTimeout(() => {
      if (id !== token) return;
      const found = searchBest(pos, { level: record.level, timeMs: Math.min(LEVELS[record.level].timeMs, 700) });
      receive(id, found?.move);
    }, 60);
  }
  function receive(id, move) {
    if (id !== token || !thinking) return;
    if (!Number.isInteger(move) || !isLegalMove(pos, move)) { // Defensive: never play an illegal reply.
      const fallback = legalMoves(pos)[0];
      if (fallback === undefined) return;
      move = fallback;
    }
    // Keep a short beat so the player sees their own move before the reply lands.
    const wait = Math.max(0, 350 - (performance.now() - pendingStart));
    pacingTimer = setTimeout(() => {
      if (id !== token) return;
      pendingReply = { id, move };
      resumeMachine();
    }, wait);
  }
  function resumeMachine() {
    if (overlayMode === "confirm" || menu.open || document.hidden) return;
    if (pendingReply) {
      const { id, move } = pendingReply;
      pendingReply = null;
      if (id !== token || !thinking) return;
      thinking = false;
      cursor = moveTo(move);
      play(move);
      if (!result) focusCursorIfOnBoard();
    } else maybeMachine();
  }
  const focusCursorIfOnBoard = () => { if (boardEl.contains(document.activeElement)) focusCursor(); };

  // ---- Input ----
  function activate(sq) {
    cursor = sq;
    if (result || menu.open) { render(); return; }
    if (!isHumanTurn() || thinking) { announce("Máy đang nghĩ…"); render(); return; }
    tone.unlock();
    const chosen = targets.find((move) => moveTo(move) === sq);
    if (chosen !== undefined) { play(chosen); focusCursor(); return; }
    const piece = pos.board[sq];
    if (piece && Math.sign(piece) === pos.side && sq !== selected) {
      selected = sq;
      targets = legalMoves(pos).filter((move) => moveFrom(move) === sq);
      announce(targets.length ? `Chọn ${pieceName(piece)}. ${targets.length} nước đi được.` : `${pieceName(piece)} không có nước đi hợp lệ.`);
    } else {
      if (selected >= 0) announce("Bỏ chọn.");
      selected = -1; targets = [];
    }
    render();
    focusCursor();
  }
  boardEl.addEventListener("click", (event) => {
    const button = event.target.closest(".xq-point");
    if (button) activate(Number(button.dataset.sq));
  });
  const ARROWS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  boardEl.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (ARROWS[event.key]) {
      event.preventDefault();
      const d = displayIndex(cursor), [dr, df] = ARROWS[event.key];
      const r = Math.min(RANKS - 1, Math.max(0, rankOf(d) + dr)), f = Math.min(FILES - 1, Math.max(0, fileOf(d) + df));
      cursor = flipped() ? SQUARES - 1 - sqOf(r, f) : sqOf(r, f);
      render(); focusCursor();
    } else if (event.key === "Escape" && selected >= 0) {
      // Esc first cancels a selection; the next Esc opens the menu.
      event.preventDefault();
      selected = -1; targets = [];
      announce("Bỏ chọn.");
      render();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("select, input")) return;
    const key = event.key.toLowerCase();
    if (key === "m") muteToggle.click();
    else if (key === "u" && canUndo()) undo();
  });
  primary.addEventListener("click", () => { tone.unlock(); newGame(); });
  secondary.addEventListener("click", () => { overlayMode = null; render(); focusCursor(); resumeMachine(); });
  newButton.addEventListener("click", () => {
    if (result || !pos.moves.length) { newGame(); return; }
    overlayMode = "confirm"; render(); primary.focus({ preventScroll: true });
  });
  undoButton.addEventListener("click", undo);
  $("#new-game").addEventListener("click", () => { menu.close(); newGame(); });
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; persist(); syncSettings(); });
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener("change", () => {
      record[key] = pick(key, select.value, record[key]);
      // Mode and side change the game itself, so they apply when a new game starts (or right away on an untouched board).
      if ((key === "mode" || key === "humanSide") && !pos.moves.length && !thinking && !result) {
        game = { mode: record.mode, humanSide: record.humanSide };
        cursor = flipped() ? sqOf(0, 4) : sqOf(9, 4);
      }
      persist(); render();
    });
  }
  menu.addEventListener("close", resumeMachine);
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); else resumeMachine(); });

  if (saved?.current && pos.moves.length) announce(`Đã mở lại ván đang chơi. ${turnLabel()}.`);
  render();
  persist();
  maybeMachine();
}
