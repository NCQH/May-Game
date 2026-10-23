// Shared, dependency-free Cờ caro engine and AI; the browser adapter below is skipped by Node checks.
const SIZE = 15, CELLS = SIZE * SIZE, CENTER = 7 * SIZE + 7, VERSION = 1, AI_DELAY = 250;
const STORAGE_ID = "co-caro";
const X = 1, O = 2;
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const MODES = ["ai", "pvp"], LEVELS = ["easy", "normal", "hard"], FIRSTS = ["human", "ai"];

const defaultSettings = () => ({ mode: "ai", difficulty: "normal", first: "human", blocked: false });
function validSettings(s) {
  return !!s && typeof s === "object" && MODES.includes(s.mode) && LEVELS.includes(s.difficulty) &&
    FIRSTS.includes(s.first) && typeof s.blocked === "boolean";
}
const cleanSettings = (s) => ({ mode: s.mode, difficulty: s.difficulty, first: s.first, blocked: s.blocked });
const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
const playerOfMove = (index) => (index % 2 === 0 ? X : O);
const humanPlayer = (settings) => (settings.first === "human" ? X : O);

function freshGame(settings = defaultSettings()) {
  return { board: new Array(CELLS).fill(0), moves: [], turn: X, phase: "playing", winner: 0, line: null, settings: cleanSettings(settings) };
}

// The winning line through idx, or null. With `blocked`, a run of five or more that has opponent stones
// right at both ends does not count (the board edge is not a block).
function winLine(board, idx, blocked = false) {
  const p = board[idx];
  if (!p) return null;
  const r = Math.floor(idx / SIZE), c = idx % SIZE;
  for (const [dx, dy] of DIRS) {
    const line = [idx];
    let x = c + dx, y = r + dy;
    while (inside(x, y) && board[y * SIZE + x] === p) { line.push(y * SIZE + x); x += dx; y += dy; }
    const endA = inside(x, y) ? board[y * SIZE + x] : -1;
    x = c - dx; y = r - dy;
    while (inside(x, y) && board[y * SIZE + x] === p) { line.unshift(y * SIZE + x); x -= dx; y -= dy; }
    const endB = inside(x, y) ? board[y * SIZE + x] : -1;
    if (line.length >= 5 && !(blocked && endA === 3 - p && endB === 3 - p)) return line;
  }
  return null;
}

// Places the current player's stone. Returns "move" | "win" | "draw", or null for an illegal move.
function play(state, idx) {
  if (state.phase !== "playing" || !Number.isInteger(idx) || idx < 0 || idx >= CELLS || state.board[idx]) return null;
  state.board[idx] = state.turn;
  state.moves.push(idx);
  const line = winLine(state.board, idx, state.settings.blocked);
  if (line) { state.phase = "over"; state.winner = state.turn; state.line = line; return "win"; }
  if (state.moves.length === CELLS) { state.phase = "over"; state.winner = 0; return "draw"; }
  state.turn = 3 - state.turn;
  return "move";
}

// Rebuilds a game by replaying moves; null when any move is illegal or follows a finished game.
function fromMoves(moves, settings) {
  if (!Array.isArray(moves) || moves.length > CELLS || !validSettings(settings)) return null;
  const state = freshGame(settings);
  for (const idx of moves) if (state.phase !== "playing" || !play(state, idx)) return null;
  return state;
}

// How many moves "Đi lại" removes: vs machine, the human's last move plus any machine reply after it.
function undoCount(state) {
  if (state.phase !== "playing" || !state.moves.length) return 0;
  if (state.settings.mode === "pvp") return 1;
  const human = humanPlayer(state.settings);
  let i = state.moves.length - 1, n = 0;
  if (playerOfMove(i) !== human) { n++; i--; }
  return i < 0 ? 0 : n + 1;
}
function undo(state) {
  const n = undoCount(state);
  return n ? fromMoves(state.moves.slice(0, -n), state.settings) : null;
}

function validCurrent(current) {
  if (!current || typeof current !== "object" || current.phase !== "playing" || !validSettings(current.settings)) return false;
  if (!Array.isArray(current.moves) || !current.moves.length) return false;
  if (!current.moves.every((m) => Number.isInteger(m) && m >= 0 && m < CELLS)) return false;
  const state = fromMoves(current.moves, current.settings);
  return !!state && state.phase === "playing";
}

// ---- AI: pattern levels on an 11-cell line centred on a candidate --------------------------------
const FIVE = 7, OPEN4 = 6, FOUR = 5, OPEN3 = 4, THREE = 3, OPEN2 = 2, TWO = 1;
const WEIGHTS = [0, 30, 150, 400, 3000, 6000, 200000, 100000000];
const lineCache = new Map();

// arr: 0 empty, 1 own, 2 opponent, 3 off-board; centre index 5 holds the candidate stone.
function fiveAt(arr, blocked) {
  let l = 5, r = 5;
  while (l > 0 && arr[l - 1] === 1) l--;
  while (r < 10 && arr[r + 1] === 1) r++;
  if (r - l + 1 < 5) return false;
  return !(blocked && l > 0 && r < 10 && arr[l - 1] === 2 && arr[r + 1] === 2);
}
function winSpots(arr, blocked) {
  let n = 0;
  for (let i = 0; i < 11; i++) if (arr[i] === 0) { arr[i] = 1; if (fiveAt(arr, blocked)) n++; arr[i] = 0; }
  return n;
}
function maxFillSpots(arr, blocked) {
  let best = 0;
  for (let i = 0; i < 11 && best < 2; i++) if (arr[i] === 0) { arr[i] = 1; best = Math.max(best, winSpots(arr, blocked)); arr[i] = 0; }
  return best;
}
function classifyLine(arr, blocked) {
  if (fiveAt(arr, blocked)) return FIVE;
  const spots = winSpots(arr, blocked);
  if (spots >= 2) return OPEN4;
  if (spots === 1) return FOUR;
  const fill = maxFillSpots(arr, blocked);
  if (fill >= 2) return OPEN3;
  if (fill === 1) return THREE;
  let best = 0;
  for (let i = 0; i < 11 && best < OPEN2; i++) if (arr[i] === 0) {
    arr[i] = 1;
    if (!winSpots(arr, blocked)) {
      const next = maxFillSpots(arr, blocked);
      best = Math.max(best, next >= 2 ? OPEN2 : next === 1 ? TWO : 0);
    }
    arr[i] = 0;
  }
  return best;
}
function lineLevel(board, idx, dx, dy, p, blocked) {
  const r = Math.floor(idx / SIZE), c = idx % SIZE;
  const arr = new Array(11);
  let key = blocked ? "b" : "f";
  for (let k = -5; k <= 5; k++) {
    const x = c + dx * k, y = r + dy * k;
    const v = k === 0 ? 1 : !inside(x, y) ? 3 : board[y * SIZE + x] === 0 ? 0 : board[y * SIZE + x] === p ? 1 : 2;
    arr[k + 5] = v; key += v;
  }
  let level = lineCache.get(key);
  if (level === undefined) {
    if (lineCache.size > 300000) lineCache.clear();
    level = classifyLine(arr, blocked);
    lineCache.set(key, level);
  }
  return level;
}
// Value of placing p at idx (idx must be empty). `shallow` ignores combinations (easy level).
function attackScore(board, idx, p, blocked, shallow = false) {
  let sum = 0, fours = 0, open3 = 0;
  for (const [dx, dy] of DIRS) {
    const level = lineLevel(board, idx, dx, dy, p, blocked);
    sum += WEIGHTS[level];
    if (level === FOUR || level === OPEN4) fours++;
    if (level === OPEN3) open3++;
  }
  if (!shallow) {
    if (fours >= 2) sum += 150000;
    if (fours && open3) sum += 100000;
    if (open3 >= 2) sum += 40000;
  }
  return sum;
}
function candidates(board) {
  const list = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i]) continue;
    const r = Math.floor(i / SIZE), c = i % SIZE;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = c + dx, y = r + dy;
      if (inside(x, y) && board[y * SIZE + x]) { near = true; break; }
    }
    if (near) list.push(i);
  }
  if (!list.length && !board[CENTER]) list.push(CENTER);
  return list;
}
function winsAt(board, idx, p, blocked) {
  board[idx] = p;
  const win = !!winLine(board, idx, blocked);
  board[idx] = 0;
  return win;
}
const centreBias = (idx) => 14 - Math.abs(Math.floor(idx / SIZE) - 7) - Math.abs((idx % SIZE) - 7);
function ranked(board, p, blocked, list, random, shallow = false, defence = .85) {
  const scored = list.map((idx) => ({
    idx, tie: random(),
    score: attackScore(board, idx, p, blocked, shallow) + defence * attackScore(board, idx, 3 - p, blocked, shallow) + centreBias(idx),
  }));
  return scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
}
// Negamax over the strongest candidates: gain of a move minus the opponent's best follow-up.
function searchValue(board, p, depth, blocked, width, random, deadline, now) {
  const list = candidates(board);
  if (!list.length) return 0;
  for (const idx of list) if (winsAt(board, idx, p, blocked)) return 1e9;
  const top = ranked(board, p, blocked, list, random).slice(0, width);
  let best = -Infinity;
  for (const { idx } of top) {
    let value = attackScore(board, idx, p, blocked);
    if (depth > 1 && now() < deadline) {
      board[idx] = p;
      value -= searchValue(board, 3 - p, depth - 1, blocked, width, random, deadline, now) * .9;
      board[idx] = 0;
    }
    if (value > best) best = value;
  }
  return best;
}

// Victory by continuous fours: returns the first move of a forced win for p, or -1.
function winCells(board, p, blocked, near) {
  const spots = [];
  const r = Math.floor(near / SIZE), c = near % SIZE;
  for (const [dx, dy] of DIRS) for (let k = -4; k <= 4; k++) {
    const x = c + dx * k, y = r + dy * k, idx = y * SIZE + x;
    if (k && inside(x, y) && !board[idx] && !spots.includes(idx) && winsAt(board, idx, p, blocked)) spots.push(idx);
  }
  return spots;
}
function vcf(board, p, blocked, depth, budget) {
  if (depth <= 0 || ++budget.nodes > 4000 || budget.now() >= budget.deadline) return -1;
  const list = candidates(board);
  for (const idx of list) if (winsAt(board, idx, 3 - p, blocked)) return -1;
  for (const idx of list) {
    let four = false;
    for (const [dx, dy] of DIRS) if (lineLevel(board, idx, dx, dy, p, blocked) >= FOUR) { four = true; break; }
    if (!four) continue;
    board[idx] = p;
    const spots = winCells(board, p, blocked, idx);
    let found = spots.length >= 2;
    if (spots.length === 1) {
      const block = spots[0];
      board[block] = 3 - p;
      if (!winLine(board, block, blocked)) found = vcf(board, p, blocked, depth - 1, budget) >= 0;
      board[block] = 0;
    }
    board[idx] = 0;
    if (found) return idx;
  }
  return -1;
}

// Picks a move for player p. Always wins at once when possible, otherwise always blocks an immediate loss.
function chooseMove(board, p, { difficulty = "normal", blocked = false, random = Math.random, now = Date.now, budget = 200 } = {}) {
  const work = board.slice();
  const list = candidates(work);
  if (!list.length) return -1;
  if (list.length === 1) return list[0];
  for (const idx of list) if (winsAt(work, idx, p, blocked)) return idx;
  for (const idx of list) if (winsAt(work, idx, 3 - p, blocked)) return idx;
  if (difficulty === "easy") {
    const scored = ranked(work, p, blocked, list, random, true, .5)
      .map((entry) => ({ ...entry, score: entry.score * (.55 + random() * .9) }))
      .sort((a, b) => b.score - a.score || a.tie - b.tie);
    return random() < .25 ? scored[Math.floor(random() * Math.min(5, scored.length))].idx : scored[0].idx;
  }
  const order = ranked(work, p, blocked, list, random);
  if (difficulty !== "hard") return order[0].idx;
  // Hard: look for a forced win by consecutive fours, then refute the opponent's, then a 3-ply search.
  const deadline = now() + budget;
  const own = vcf(work, p, blocked, 12, { nodes: 0, deadline, now });
  if (own >= 0) return own;
  if (vcf(work, 3 - p, blocked, 12, { nodes: 0, deadline, now }) >= 0) {
    for (const { idx } of order.slice(0, 16)) {
      work[idx] = p;
      const safe = vcf(work, 3 - p, blocked, 12, { nodes: 0, deadline, now }) < 0;
      work[idx] = 0;
      if (safe) return idx;
      if (now() >= deadline) break;
    }
  }
  let best = order[0].idx, bestValue = -Infinity;
  for (const { idx } of order.slice(0, 10)) {
    if (now() >= deadline) break;
    work[idx] = p;
    const value = attackScore(board, idx, p, blocked) - .9 * searchValue(work, 3 - p, 2, blocked, 7, random, deadline, now);
    work[idx] = 0;
    if (value > bestValue) { bestValue = value; best = idx; }
  }
  return best;
}

if (typeof module !== "undefined") module.exports = {
  SIZE, CELLS, CENTER, X, O, defaultSettings, validSettings, freshGame, winLine, play, fromMoves,
  undoCount, undo, validCurrent, chooseMove, candidates, humanPlayer, classifyLine,
};

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const $ = (selector) => document.querySelector(selector);
  const boardEl = $("#caro-board"), menu = $("#game-menu");
  const turnText = $("#caro-turn-text"), turnMark = $("#caro-turn-mark"), modeLine = $("#caro-mode");
  const banner = $("#caro-result"), bannerTitle = banner.querySelector("h2"), bannerText = banner.querySelector("p");
  const undoButton = $("#undo"), muteToggle = $("#mute"), blockedToggle = $("#blocked");
  const modeSelect = $("#mode"), levelSelect = $("#difficulty"), firstSelect = $("#first");
  const settingsNote = $("#settings-note"), menuState = $("#menu-state");
  const announce = createAnnouncer($("#caro-status"));
  const LEVEL_NAMES = { easy: "Dễ", normal: "Thường", hard: "Khó" };
  const NAME = { [X]: "X", [O]: "O" };
  const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

  const saved = store.read();
  const tally = { win: count(saved?.tally?.win), loss: count(saved?.tally?.loss), draw: count(saved?.tally?.draw) };
  let record = { version: VERSION, bestScore: tally.win, tally, muted: saved?.muted === true,
    settings: validSettings(saved?.settings) ? cleanSettings(saved.settings) : defaultSettings(), current: null };
  const tone = createTone(() => record.muted);
  const resumed = validCurrent(saved?.current);
  let game = resumed ? fromMoves(saved.current.moves, saved.current.settings) : freshGame(record.settings);
  let focusIdx = game.moves.length ? game.moves.at(-1) : CENTER;
  let aiTimer = 0, thinking = false, aiPending = false;

  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "caro-cell";
    button.dataset.idx = i;
    button.tabIndex = -1;
    cells.push(button);
  }
  boardEl.append(...cells);

  const isAiGame = () => game.settings.mode === "ai";
  const human = () => humanPlayer(game.settings);
  const humanTurn = () => game.phase === "playing" && (!isAiGame() || game.turn === human()) && !thinking;
  const where = (idx) => `hàng ${Math.floor(idx / SIZE) + 1}, cột ${(idx % SIZE) + 1}`;
  const describe = (s) => s.mode === "pvp" ? "2 người cùng máy" : `Đấu với máy · ${LEVEL_NAMES[s.difficulty]} · ${s.first === "human" ? "bạn đi trước" : "máy đi trước"}`;
  const sameSettings = (a, b) => ["mode", "difficulty", "first", "blocked"].every((k) => a[k] === b[k]);

  function persist() {
    record.bestScore = record.tally.win;
    record.current = game.phase === "playing" && game.moves.length ? { moves: [...game.moves], settings: { ...game.settings }, phase: "playing" } : null;
    store.write(record);
  }
  function turnLabel() {
    if (game.phase === "over") {
      if (!game.winner) return "Hòa — kín bàn";
      if (!isAiGame()) return `${NAME[game.winner]} thắng!`;
      return game.winner === human() ? "Bạn thắng!" : "Máy thắng";
    }
    const who = NAME[game.turn];
    if (!isAiGame()) return `Lượt ${who}`;
    if (game.turn === human()) return `Lượt ${who} — bạn`;
    return `Lượt ${who} — ${thinking ? "Máy đang nghĩ…" : "máy"}`;
  }
  function renderCells() {
    const last = game.moves.at(-1);
    const winning = new Set(game.line || []);
    boardEl.dataset.preview = humanTurn() ? NAME[game.turn].toLowerCase() : "";
    cells.forEach((cell, i) => {
      const stone = game.board[i];
      if (stone) cell.dataset.stone = NAME[stone].toLowerCase(); else delete cell.dataset.stone;
      cell.classList.toggle("is-last", i === last);
      cell.classList.toggle("is-win", winning.has(i));
      cell.tabIndex = i === focusIdx ? 0 : -1;
      cell.setAttribute("aria-label", `Hàng ${Math.floor(i / SIZE) + 1}, cột ${(i % SIZE) + 1}, ${stone ? `quân ${NAME[stone]}` : "trống"}` +
        `${i === last ? ", nước vừa đi" : ""}${winning.has(i) ? ", đường thắng" : ""}`);
    });
  }
  function render() {
    renderCells();
    turnText.textContent = turnLabel();
    const markPlayer = game.phase === "over" ? game.winner : game.turn;
    turnMark.dataset.stone = markPlayer ? NAME[markPlayer].toLowerCase() : "";
    $("#tally-win").textContent = record.tally.win.toLocaleString("vi-VN");
    $("#tally-loss").textContent = record.tally.loss.toLocaleString("vi-VN");
    $("#tally-draw").textContent = record.tally.draw.toLocaleString("vi-VN");
    modeLine.textContent = describe(game.settings) + (game.settings.blocked ? " · chặn hai đầu" : "");
    undoButton.disabled = !undoCount(game);
    // Result banner sits on the half of the board away from the winning line.
    banner.hidden = game.phase !== "over";
    if (game.phase === "over") {
      bannerTitle.textContent = turnLabel();
      bannerText.textContent = !game.winner ? "Không còn ô trống." : `${game.moves.length} nước · đường thắng được tô sáng.`;
      placeBanner();
    }
    modeSelect.value = record.settings.mode;
    levelSelect.value = record.settings.difficulty;
    firstSelect.value = record.settings.first;
    levelSelect.disabled = firstSelect.disabled = record.settings.mode === "pvp";
    blockedToggle.setAttribute("aria-pressed", String(record.settings.blocked));
    blockedToggle.textContent = `Chặn hai đầu: ${record.settings.blocked ? "bật" : "tắt"}`;
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
    const pending = !sameSettings(record.settings, game.settings);
    settingsNote.textContent = pending ? "Đã chọn. Bấm “Ván mới” để áp dụng." : "Đổi chế độ, độ khó hoặc luật áp dụng từ ván mới.";
    settingsNote.classList.toggle("is-pending", pending);
    menuState.textContent = game.phase === "over" ? "Ván đã xong. Chọn “Ván mới” để chơi tiếp." : `Ván đang chơi: ${describe(game.settings)}. Đóng menu để đi tiếp.`;
  }
  // Put the banner on the side of the board that covers less of the winning line.
  function placeBanner() {
    if (banner.hidden) return;
    const rows = (game.line || []).map((i) => Math.floor(i / SIZE));
    const cell = boardEl.getBoundingClientRect().height / SIZE;
    const covered = cell ? Math.ceil(banner.offsetHeight / cell) : 5;
    const overTop = rows.filter((r) => r < covered).length, overBottom = rows.filter((r) => r > SIZE - 1 - covered).length;
    banner.dataset.at = overBottom <= overTop ? "bottom" : "top";
  }
  new ResizeObserver(placeBanner).observe(boardEl);
  function focusCell(idx, move = true) {
    focusIdx = idx;
    cells.forEach((cell, i) => { cell.tabIndex = i === idx ? 0 : -1; });
    if (move) cells[idx].focus({ preventScroll: true });
  }

  function finish(event) {
    if (isAiGame()) {
      if (event === "draw") record.tally.draw++;
      else if (game.winner === human()) record.tally.win++;
      else record.tally.loss++;
    }
    const good = event === "draw" || !isAiGame() || game.winner === human();
    tone.play(good ? [[523, 0, .1], [659, .1, .1], [784, .2, .2]] : [[220, 0, .12], [165, .12, .2]]);
    persist(); render();
    announce(`${turnLabel()} ${bannerText.textContent}`);
    $("#caro-replay").focus({ preventScroll: true });
  }
  function afterMove(event, idx, player) {
    tone.play(player === X ? [[660, 0, .05]] : [[440, 0, .05]], .08);
    if (event === "win" || event === "draw") { finish(event); return; }
    persist(); render();
    const by = isAiGame() ? (player === human() ? "Bạn" : "Máy") : NAME[player];
    announce(`${by} đi ${where(idx)}. ${turnLabel()}.`);
    maybeAi();
  }
  function maybeAi() {
    clearTimeout(aiTimer);
    if (game.phase !== "playing" || !isAiGame() || game.turn === human()) { thinking = false; return; }
    thinking = true; render();
    aiTimer = setTimeout(aiMove, AI_DELAY);
  }
  function aiMove() {
    // A turn-based game waits while the menu is open; the move is made after it closes.
    if (menu.open || document.hidden) { aiPending = true; return; }
    aiPending = false;
    if (game.phase !== "playing" || !isAiGame() || game.turn === human()) { thinking = false; render(); return; }
    const player = game.turn;
    const idx = chooseMove(game.board, player, { difficulty: game.settings.difficulty, blocked: game.settings.blocked });
    thinking = false;
    const event = play(game, idx);
    if (!event) { render(); return; }
    afterMove(event, idx, player);
  }
  function place(idx) {
    if (menu.open || !humanTurn()) return;
    tone.unlock();
    const player = game.turn;
    const event = play(game, idx);
    if (!event) { tone.play([[150, 0, .06]], .05); return; }
    focusIdx = idx;
    afterMove(event, idx, player);
  }
  function newGame() {
    clearTimeout(aiTimer); thinking = false; aiPending = false;
    game = freshGame(record.settings);
    focusIdx = CENTER;
    persist(); render();
    announce(`Ván mới. ${describe(game.settings)}. ${turnLabel()}.`);
    maybeAi();
  }

  boardEl.addEventListener("click", (event) => {
    const cell = event.target.closest(".caro-cell");
    if (!cell) return;
    focusIdx = Number(cell.dataset.idx);
    place(focusIdx);
    focusCell(focusIdx, false);
  });
  boardEl.addEventListener("keydown", (event) => {
    if (menu.open || event.altKey || event.ctrlKey || event.metaKey) return;
    const r = Math.floor(focusIdx / SIZE), c = focusIdx % SIZE;
    const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      focusCell(Math.min(SIZE - 1, Math.max(0, r + dy)) * SIZE + Math.min(SIZE - 1, Math.max(0, c + dx)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusCell(r * SIZE + (event.key === "Home" ? 0 : SIZE - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      place(focusIdx);
    }
  });
  undoButton.addEventListener("click", () => {
    const previous = undo(game);
    if (!previous) return;
    clearTimeout(aiTimer); thinking = false; aiPending = false;
    game = previous;
    if (game.moves.length) focusIdx = game.moves.at(-1);
    persist(); render();
    announce(`Đã đi lại. ${turnLabel()}.`);
    maybeAi();
  });
  $("#new-game").addEventListener("click", () => { newGame(); focusCell(focusIdx); });
  $("#caro-replay").addEventListener("click", () => { newGame(); focusCell(focusIdx); });
  $("#menu-new-game").addEventListener("click", () => { menu.close(); newGame(); focusCell(focusIdx); });
  function changeSetting(key, value) {
    record.settings[key] = value;
    // An untouched game takes the new settings at once; otherwise they wait for "Ván mới".
    if (game.phase === "playing" && !game.moves.length) { clearTimeout(aiTimer); thinking = false; game = freshGame(record.settings); maybeAi(); }
    persist(); render();
  }
  modeSelect.addEventListener("change", () => changeSetting("mode", modeSelect.value));
  levelSelect.addEventListener("change", () => changeSetting("difficulty", levelSelect.value));
  firstSelect.addEventListener("change", () => changeSetting("first", firstSelect.value));
  blockedToggle.addEventListener("click", () => changeSetting("blocked", !record.settings.blocked));
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; persist(); render(); });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("select")) return;
    if (event.key.toLowerCase() === "m") muteToggle.click();
  });
  menu.addEventListener("close", () => { if (aiPending) maybeAi(); });
  document.addEventListener("game-menu-open", persist);
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); else if (aiPending) maybeAi(); });
  window.addEventListener("pagehide", persist);
  render();
  if (resumed) announce(`Đã mở lại ván đang chơi. ${turnLabel()}.`);
  maybeAi();
}
