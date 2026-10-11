const boardNode = document.querySelector("#pika-board");
const boardWrap = document.querySelector("#pika-board-wrap");
const pathNode = document.querySelector("#pika-path");
const levelNode = document.querySelector("#level");
const livesNode = document.querySelector("#lives");
const scoreNode = document.querySelector("#score");
const timeProgress = document.querySelector("#time-progress");
const timeFill = document.querySelector("#time-fill");
const timeText = document.querySelector("#time-text");
const hintCount = document.querySelector("#hint-count");
const statusNode = document.querySelector("#status");
const soundButton = document.querySelector("#sound-toggle");
const hintButton = document.querySelector("#hint");
const STORAGE_KEY = "may-game:v1:pikachu";
const SIZE_STORAGE_KEY = "may-game:v1:pikachu:size";
const SOUND_STORAGE_KEY = "may-game:v1:pikachu:sound";
const SPRITE_COUNT = 36;
const SPRITE_WIDTH = 40;
const SPRITE_HEIGHT = 50;
const LEVELS = 9;
const STARTING_LIVES = 10;
const HINTS_PER_RUN = 3;
const SECONDS_PER_TILE = 4;
const POINTS_PER_LEVEL = 720;
const MAX_TIME_BONUS = 576;
const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const SOUNDS = {
  select: new Audio(new URL("../../assets/pikachu/audio/sound2.mp3", import.meta.url)),
  match: new Audio(new URL("../../assets/pikachu/audio/sound5.mp3", import.meta.url)),
  wrong: new Audio(new URL("../../assets/pikachu/audio/sound1.mp3", import.meta.url)),
  start: new Audio(new URL("../../assets/pikachu/audio/sound4.mp3", import.meta.url)),
};
Object.values(SOUNDS).forEach((sound) => { sound.preload = "auto"; sound.volume = 0.45; });

function readRecord() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { bestScore: 0, current: null }; }
  catch { return { bestScore: 0, current: null }; }
}

function getSizeMode() {
  try { return localStorage.getItem(SIZE_STORAGE_KEY) === "full" ? "full" : "auto"; }
  catch { return "auto"; }
}

function chooseSize(mode = sizeMode) {
  if (mode === "full") return [16, 9];
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width >= 1000 && height >= 680) return [16, 9];
  if (width >= 700 && height >= 620) return [12, 8];
  if (width >= 460 && height >= 740) return [8, 9];
  if (width >= 360 && height >= 620) return [6, 8];
  return [6, 6];
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createTiles(cols, rows) {
  const pairCount = (cols * rows) / 2;
  const kindCount = pairCount > SPRITE_COUNT ? pairCount / 2 : pairCount;
  const copiesPerKind = (pairCount / kindCount) * 2;
  const kinds = [];
  for (let kind = 0; kind < kindCount; kind++) {
    for (let copy = 0; copy < copiesPerKind; copy++) kinds.push(kind);
  }
  return shuffle(kinds).map((kind) => ({ kind, removed: false }));
}

function createLevel(level, options = {}, mode = sizeMode) {
  const [cols, rows] = chooseSize(mode);
  return {
    version: 2,
    cols,
    rows,
    tiles: createTiles(cols, rows),
    selected: null,
    score: Number(options.score || 0),
    level: Number(level || 1),
    lives: Number(options.lives ?? STARTING_LIVES),
    hintsLeft: Number(options.hintsLeft ?? HINTS_PER_RUN),
    matched: 0,
    moves: 0,
    levelAwarded: 0,
    timeLimit: cols * rows * SECONDS_PER_TILE,
    timeLeft: cols * rows * SECONDS_PER_TILE,
    clockStarted: false,
    phase: "playing",
    reason: "",
    previousLevel: 0,
    lastBonus: 0,
  };
}

function resizeSavedLevel(saved, cols, rows, mode = sizeMode) {
  const oldPairCount = saved.cols * saved.rows / 2;
  const newPairCount = cols * rows / 2;
  const wasPlaying = saved.phase === "playing";
  const maxMatched = wasPlaying ? newPairCount - 1 : newPairCount;
  const matched = Math.min(maxMatched, Math.max(0, Math.round((Number(saved.matched) || 0) / oldPairCount * newPairCount)));
  const oldAward = Number(saved.levelAwarded ?? Math.round(POINTS_PER_LEVEL * (Number(saved.matched) || 0) / oldPairCount));
  const newAward = Math.round(POINTS_PER_LEVEL * matched / newPairCount);
  const resized = createLevel(saved.level, {
    score: Math.max(0, (Number(saved.score) || 0) - oldAward + newAward),
    lives: saved.lives,
    hintsLeft: saved.hintsLeft,
  }, mode);
  resized.tiles = createTiles(cols, rows);
  resized.timeLimit = cols * rows * SECONDS_PER_TILE;
  resized.matched = matched;
  resized.levelAwarded = newAward;
  resized.moves = Number(saved.moves) || 0;
  resized.clockStarted = Boolean(saved.clockStarted);
  let pairsToRemove = matched;
  const groups = new Map();
  resized.tiles.forEach((tile, index) => {
    if (!groups.has(tile.kind)) groups.set(tile.kind, []);
    groups.get(tile.kind).push(index);
  });
  for (const indices of groups.values()) {
    const removedPairs = Math.min(pairsToRemove, indices.length / 2);
    indices.slice(0, removedPairs * 2).forEach((index) => { resized.tiles[index].removed = true; });
    pairsToRemove -= removedPairs;
    if (pairsToRemove <= 0) break;
  }
  const timeRatio = Number(saved.timeLimit) > 0 ? Number(saved.timeLeft) / Number(saved.timeLimit) : 1;
  resized.timeLeft = Math.round(resized.timeLimit * Math.max(0, Math.min(1, timeRatio)));
  if (wasPlaying && resized.tiles.every((tile) => tile.removed)) {
    const pairKind = resized.tiles.at(-1).kind;
    const pair = resized.tiles.findLastIndex((tile) => tile.removed && tile.kind === pairKind);
    resized.tiles.at(-1).removed = false;
    resized.tiles[pair].removed = false;
    resized.matched--;
    resized.levelAwarded = Math.round(POINTS_PER_LEVEL * resized.matched / newPairCount);
    resized.score -= newAward - resized.levelAwarded;
  }
  resized.previousLevel = Number(saved.previousLevel) || 0;
  resized.lastBonus = Number(saved.lastBonus) || 0;
  resized.phase = saved.phase;
  resized.reason = saved.reason || "";
  return resized;
}

function isValidSavedState(saved) {
  return saved?.version === 2
    && Number.isInteger(saved.cols)
    && saved.cols % 2 === 0
    && Number.isInteger(saved.rows)
    && saved.rows % 2 === 0
    && Array.isArray(saved.tiles)
    && saved.tiles.length === saved.cols * saved.rows
    && Number.isInteger(saved.matched)
    && saved.matched >= 0
    && saved.matched <= saved.cols * saved.rows / 2
    && (saved.phase !== "playing" || saved.matched < saved.cols * saved.rows / 2)
    && saved.tiles.every((tile) => tile && Number.isInteger(tile.kind) && tile.kind >= 0 && tile.kind < SPRITE_COUNT && typeof tile.removed === "boolean")
    && saved.tiles.filter((tile) => !tile.removed).length === saved.cols * saved.rows - saved.matched * 2
    && (saved.phase === "between" || saved.phase === "playing" && Number.isFinite(saved.timeLeft) && saved.timeLeft > 0)
    && Number.isFinite(saved.score) && saved.score >= 0
    && Number.isFinite(saved.lives) && saved.lives > 0
    && Number.isFinite(saved.hintsLeft) && saved.hintsLeft >= 0
    && Number.isFinite(saved.timeLimit) && saved.timeLimit > 0
    && (saved.phase !== "between" || saved.matched === saved.cols * saved.rows / 2);
}

let record = readRecord();
let sizeMode = getSizeMode();
let runStarted = isValidSavedState(record.current);
let state = runStarted ? record.current : createLevel(1);
state.clockStarted = false;
let restoredResponsiveState = false;
if (sizeMode === "auto" && state.phase === "playing") {
  const [targetCols, targetRows] = chooseSize();
  if (state.cols !== targetCols || state.rows !== targetRows) {
    state = resizeSavedLevel(state, targetCols, targetRows);
    restoredResponsiveState = true;
  }
}
let soundEnabled = true;
try { soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== "off"; } catch { /* Sound remains enabled for this session. */ }
let busy = false;
let hintTimer = 0;
let matchTimer = 0;
let pendingMatch = null;
let resumeClockOnShow = false;
let lastFrame = performance.now();
let saveElapsed = 0;
let statusText = restoredResponsiveState
  ? "Đã điều chỉnh bàn theo màn hình · tiến độ, điểm và thời gian được giữ lại."
  : "";
let modalKind = "";

function playSound(name) {
  if (!soundEnabled) return;
  const sound = SOUNDS[name];
  if (!sound) return;
  try {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  } catch { /* Audio is optional; keep the puzzle playable when unavailable. */ }
}

function save() {
  record.bestScore = Math.max(Number(record.bestScore || 0), Number(state.score || 0));
  const current = ["over", "won"].includes(state.phase) || !runStarted || state.phase === "playing" && state.timeLeft <= 0 ? null : structuredClone(state);
  record = { version: 2, bestScore: record.bestScore, current, updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Keep the game playable when storage is unavailable. */ }
}

function formatTime(seconds) {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function updateClock() {
  const percent = state.timeLimit > 0 ? Math.max(0, Math.min(1, state.timeLeft / state.timeLimit)) : 0;
  timeFill.style.width = `${percent * 100}%`;
  timeFill.classList.toggle("is-warning", percent <= 0.35 && percent > 0.15);
  timeFill.classList.toggle("is-danger", percent <= 0.15);
  timeText.textContent = formatTime(state.timeLeft);
  timeProgress.setAttribute("aria-valuenow", String(Math.round(percent * 100)));
  timeProgress.setAttribute("aria-valuetext", `${formatTime(state.timeLeft)} còn lại`);
}

function resizeBoard() {
  const maxWidth = state.cols * 44 + (state.cols - 1) * 2 + 18;
  const compactLandscape = matchMedia('(max-height: 500px) and (min-width: 620px)').matches;
  const availableHeight = Math.max(100, document.documentElement.clientHeight - (compactLandscape ? 170 : 320));
  const heightLimitedWidth = availableHeight * state.cols / state.rows * 42 / 52 + 18;
  boardWrap.style.width = `min(100%, ${Math.min(maxWidth, heightLimitedWidth)}px)`;
  boardNode.style.setProperty("--cols", String(state.cols));
  const firstTile = boardNode.querySelector(".pika-tile");
  if (!firstTile) return;
  const scale = Math.max(0.1, Math.min(1.2, firstTile.clientWidth / SPRITE_WIDTH, firstTile.clientHeight / SPRITE_HEIGHT));
  boardNode.querySelectorAll(".pika-piece").forEach((piece) => {
    const sprite = Number(piece.dataset.sprite);
    piece.style.width = `${SPRITE_WIDTH * scale}px`;
    piece.style.height = `${SPRITE_HEIGHT * scale}px`;
    piece.style.backgroundSize = `${SPRITE_COUNT * SPRITE_WIDTH * scale}px ${SPRITE_HEIGHT * scale}px`;
    piece.style.backgroundPosition = `${-sprite * SPRITE_WIDTH * scale}px 0`;
  });
}

function render() {
  const focusedTile = boardNode.contains(document.activeElement) && document.activeElement.matches(".pika-tile")
    ? Number(document.activeElement.dataset.index)
    : null;
  const focusedTileStillAvailable = focusedTile !== null && !state.tiles[focusedTile]?.removed;
  const rovingIndex = focusedTileStillAvailable
    ? focusedTile
    : state.selected !== null && !state.tiles[state.selected]?.removed
      ? state.selected
      : state.tiles.findIndex((tile) => !tile.removed);
  levelNode.textContent = String(state.level);
  livesNode.textContent = String(state.lives);
  scoreNode.textContent = String(state.score);
  hintCount.textContent = String(state.hintsLeft);
  hintButton.disabled = state.hintsLeft <= 0;
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.lastElementChild.textContent = soundEnabled ? "Âm thanh" : "Đã tắt";
  boardNode.setAttribute("aria-label", `Bàn ghép hình ${state.cols} cột, ${state.rows} hàng. Dùng phím mũi tên để di chuyển giữa các ô.`);
  boardNode.innerHTML = state.tiles.map((tile, index) => {
    const spriteName = tile.kind === 1 ? "Pikachu" : `Pokémon ${tile.kind + 1}`;
    const row = Math.floor(index / state.cols) + 1;
    const col = (index % state.cols) + 1;
    const selected = state.selected === index;
    const classNames = ["pika-tile"];
    if (selected) classNames.push("is-selected");
    if (tile.removed) classNames.push("is-empty");
    const tabIndex = !tile.removed && index === rovingIndex ? 0 : -1;
    return `<button class="${classNames.join(" ")}" type="button" data-index="${index}" tabindex="${tabIndex}" aria-label="Hàng ${row}, cột ${col}: ${tile.removed ? "đã ghép" : spriteName}" aria-pressed="${selected}"${tile.removed ? " disabled" : ""}><span class="pika-piece" data-sprite="${tile.kind}" aria-hidden="true"></span></button>`;
  }).join("");
  if (focusedTile !== null) {
    const restoreIndex = focusedTileStillAvailable ? focusedTile : rovingIndex;
    if (restoreIndex >= 0) boardNode.querySelector(`[data-index="${restoreIndex}"]`)?.focus({ preventScroll: true });
  }
  statusNode.textContent = statusText;
  updateClock();
  resizeBoard();
}

function showToast(message) {
  statusText = message;
  statusNode.textContent = message;
  statusNode.classList.add("is-toast");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => statusNode.classList.remove("is-toast"), 1300);
}

function showDialog(title, message, actions, kind) {
  const dialog = document.querySelector("#pika-dialog");
  const titleNode = document.querySelector("#dialog-title");
  const messageNode = document.querySelector("#dialog-message");
  const actionsNode = document.querySelector("#dialog-actions");
  modalKind = kind;
  titleNode.textContent = title;
  messageNode.textContent = message;
  actionsNode.replaceChildren();
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `game-button${action.primary ? " game-button-primary" : ""}`;
    button.textContent = action.label;
    button.addEventListener("click", () => {
      closeDialog();
      if (action.run) action.run();
    });
    actionsNode.append(button);
  });
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  const dialog = document.querySelector("#pika-dialog");
  if (dialog.open) dialog.close();
  modalKind = "";
  lastFrame = performance.now();
}

function showLevelDialog() {
  showDialog(`Bàn ${state.previousLevel} xong`, `Thưởng thời gian +${state.lastBonus} điểm · Tổng ${state.score}.`, [
    { label: "Bàn tiếp theo", primary: true, run: startNextLevel },
  ], "between");
}

function showEndDialog() {
  if (state.phase === "won") {
    showDialog("Hoàn thành!", `Qua ${LEVELS} bàn · ${state.score} điểm · Kỷ lục ${record.bestScore}.`, [
      { label: "Chơi lại", primary: true, run: newGame },
      { label: "Đóng", run: closeDialog },
    ], "won");
    return;
  }
  showDialog(state.reason === "time" ? "Hết giờ" : "Hết lượt đổi", `Điểm ${state.score} · Kỷ lục ${record.bestScore}.`, [
    { label: "Chơi lại", primary: true, run: newGame },
    { label: "Đóng", run: closeDialog },
  ], "over");
}

function isInside(row, col) {
  return row >= 0 && row < state.rows && col >= 0 && col < state.cols;
}

function isFree(row, col, targetRow, targetCol) {
  if (!isInside(row, col) || (row === targetRow && col === targetCol)) return true;
  return state.tiles[row * state.cols + col].removed;
}

function findPath(fromIndex, toIndex) {
  const first = state.tiles[fromIndex];
  const second = state.tiles[toIndex];
  if (!first || !second || first.removed || second.removed || first.kind !== second.kind) return null;
  const startRow = Math.floor(fromIndex / state.cols);
  const startCol = fromIndex % state.cols;
  const targetRow = Math.floor(toIndex / state.cols);
  const targetCol = toIndex % state.cols;
  const queue = [{ row: startRow, col: startCol, direction: -1, turns: 0, path: [{ row: startRow, col: startCol }] }];
  const visited = new Map();

  while (queue.length) {
    const current = queue.shift();
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const [dr, dc] = DIRECTIONS[direction];
      const row = current.row + dr;
      const col = current.col + dc;
      const turns = current.turns + (current.direction === -1 || current.direction === direction ? 0 : 1);
      if (turns > 2 || row < -1 || row > state.rows || col < -1 || col > state.cols) continue;
      if (!isFree(row, col, targetRow, targetCol)) continue;
      const path = [...current.path, { row, col }];
      if (row === targetRow && col === targetCol) return path;
      const key = `${row}:${col}:${direction}`;
      if (visited.has(key) && visited.get(key) <= turns) continue;
      visited.set(key, turns);
      queue.push({ row, col, direction, turns, path });
    }
  }
  return null;
}

function findAvailablePair() {
  const positions = new Map();
  state.tiles.forEach((tile, index) => {
    if (tile.removed) return;
    if (!positions.has(tile.kind)) positions.set(tile.kind, []);
    positions.get(tile.kind).push(index);
  });
  for (const indices of positions.values()) {
    for (let first = 0; first < indices.length - 1; first++) {
      for (let second = first + 1; second < indices.length; second++) {
        const path = findPath(indices[first], indices[second]);
        if (path) return { first: indices[first], second: indices[second], path };
      }
    }
  }
  return null;
}

function drawConnection(path) {
  const tile = boardNode.querySelector(".pika-tile");
  if (!tile) return;
  const style = getComputedStyle(boardNode);
  const tileRect = { width: tile.offsetWidth, height: tile.offsetHeight };
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const gapX = parseFloat(style.columnGap) || 0;
  const gapY = parseFloat(style.rowGap) || 0;
  const width = boardNode.clientWidth + borderLeft * 2;
  const height = boardNode.clientHeight + borderTop * 2;
  const points = path.map(({ row, col }) => {
    const x = borderLeft + padLeft + col * (tileRect.width + gapX) + tileRect.width / 2;
    const y = borderTop + padTop + row * (tileRect.height + gapY) + tileRect.height / 2;
    return `${x},${y}`;
  });
  pathNode.setAttribute("viewBox", `0 0 ${width} ${height}`);
  pathNode.innerHTML = `<polyline points="${points.join(" ")}" />`;
  pathNode.classList.add("is-visible");
}

function clearConnection() {
  pathNode.classList.remove("is-visible");
  pathNode.replaceChildren();
}

function compactBoard() {
  if (state.level <= 1) return;
  const direction = ["right", "left", "down", "up", "center", "static"][(state.level - 2) % 6];
  if (direction === "static") return;
  const next = state.tiles.map((tile) => ({ kind: tile.kind, removed: true }));
  const writeLine = (indices, placement) => {
    const kinds = indices.map((index) => state.tiles[index]).filter((tile) => !tile.removed).map((tile) => tile.kind);
    const start = placement === "center" ? Math.floor((indices.length - kinds.length) / 2) : placement === "end" ? indices.length - kinds.length : 0;
    kinds.forEach((kind, offset) => {
      const target = indices[start + offset];
      next[target] = { kind, removed: false };
    });
  };
  if (direction === "left" || direction === "right") {
    for (let row = 0; row < state.rows; row++) {
      const indices = Array.from({ length: state.cols }, (_, col) => row * state.cols + col);
      writeLine(indices, direction === "right" ? "end" : "start");
    }
  } else {
    for (let col = 0; col < state.cols; col++) {
      const indices = Array.from({ length: state.rows }, (_, row) => row * state.cols + col);
      writeLine(indices, direction === "center" ? "center" : direction === "down" ? "end" : "start");
    }
  }
  state.tiles = next;
}

function shuffleRemaining() {
  const kinds = shuffle(state.tiles.filter((tile) => !tile.removed).map((tile) => tile.kind));
  let cursor = 0;
  state.tiles = state.tiles.map((tile) => tile.removed ? tile : { kind: kinds[cursor++], removed: false });
  state.selected = null;
}

function shuffleUntilPlayable() {
  for (let attempt = 0; attempt < 12; attempt++) {
    shuffleRemaining();
    if (findAvailablePair()) return false;
  }
  const available = state.tiles.map((tile, index) => !tile.removed ? index : -1).filter((index) => index >= 0);
  const pairKinds = new Map();
  state.tiles.forEach((tile) => {
    if (tile.removed) return;
    pairKinds.set(tile.kind, (pairKinds.get(tile.kind) || 0) + 1);
  });
  const kinds = shuffle([...pairKinds].flatMap(([kind, count]) => Array.from({ length: Math.floor(count / 2) }, () => kind)));
  state.tiles = state.tiles.map((tile) => ({ ...tile }));
  kinds.forEach((kind, pair) => {
    state.tiles[available[pair * 2]] = { kind, removed: false };
    state.tiles[available[pair * 2 + 1]] = { kind, removed: false };
  });
  state.selected = null;
  return true;
}

function recoverDeadlock() {
  state.lives = Math.max(0, state.lives - 1);
  if (state.lives === 0) {
    state.phase = "over";
    state.reason = "lives";
    save();
    render();
    showEndDialog();
    return;
  }
  playSound("start");
  const usedFallback = shuffleUntilPlayable();
  statusText = `Không còn cặp nối được · ${usedFallback ? "đã sắp xếp bàn mới" : "đã đổi vị trí tự động"} · còn ${state.lives} lượt.`;
  render();
  save();
}

function completeLevel() {
  const bonus = state.timeLimit > 0 ? Math.round(MAX_TIME_BONUS * state.timeLeft / state.timeLimit) : 0;
  state.score += bonus;
  record.bestScore = Math.max(Number(record.bestScore || 0), state.score);
  if (state.level >= LEVELS) {
    state.phase = "won";
    state.lastBonus = bonus;
    save();
    render();
    showEndDialog();
    return;
  }
  state.previousLevel = state.level;
  state.level++;
  state.lives++;
  state.lastBonus = bonus;
  state.phase = "between";
  save();
  render();
  showLevelDialog();
}

function cancelPendingMatch() {
  window.clearTimeout(matchTimer);
  matchTimer = 0;
  pendingMatch = null;
  busy = false;
  clearConnection();
}

function finishPendingMatch() {
  if (!pendingMatch) return;
  const { first, second } = pendingMatch;
  window.clearTimeout(matchTimer);
  matchTimer = 0;
  pendingMatch = null;
  if (state.phase === "playing" && state.timeLeft > 0) finishMatch(first, second);
  else {
    busy = false;
    clearConnection();
  }
}

function finishMatch(first, second) {
  if (state.phase !== "playing" || !state.tiles[first] || !state.tiles[second]
    || state.tiles[first].removed || state.tiles[second].removed
    || state.tiles[first].kind !== state.tiles[second].kind) {
    busy = false;
    clearConnection();
    return;
  }
  state.tiles[first].removed = true;
  state.tiles[second].removed = true;
  state.matched++;
  const pairCount = (state.cols * state.rows) / 2;
  const targetScore = Math.round(POINTS_PER_LEVEL * state.matched / pairCount);
  state.score += targetScore - state.levelAwarded;
  state.levelAwarded = targetScore;
  record.bestScore = Math.max(Number(record.bestScore || 0), state.score);
  compactBoard();
  busy = false;
  clearConnection();
  if (state.tiles.every((tile) => tile.removed)) {
    completeLevel();
    return;
  }
  statusText = "Nối được rồi! Tiếp tục tìm cặp.";
  render();
  save();
  if (!findAvailablePair()) recoverDeadlock();
}

function choose(index) {
  if (busy || state.phase !== "playing") return;
  const tile = state.tiles[index];
  if (!tile || tile.removed) return;
  runStarted = true;
  state.clockStarted = true;
  if (state.selected === null) {
    state.selected = index;
    statusText = tile.kind === 1 ? "Đã chọn Pikachu · tìm hình giống nhau." : `Đã chọn Pokémon ${tile.kind + 1} · tìm hình giống nhau.`;
    playSound("select");
    render();
    save();
    return;
  }
  if (state.selected === index) {
    state.selected = null;
    statusText = "Chọn hai hình giống nhau có thể nối bằng tối đa hai góc rẽ.";
    render();
    save();
    return;
  }

  const first = state.selected;
  const path = state.tiles[first].kind === tile.kind ? findPath(first, index) : null;
  runStarted = true;
  state.moves++;
  if (!path) {
    playSound("wrong");
    state.selected = index;
    statusText = state.tiles[first].kind === tile.kind ? "Hai hình giống nhau nhưng đường nối bị chặn." : "Hai hình chưa giống nhau.";
    render();
    save();
    return;
  }

  playSound("match");
  busy = true;
  state.selected = null;
  statusText = "Nối được rồi!";
  render();
  drawConnection(path);
  pendingMatch = { first, second: index };
  matchTimer = window.setTimeout(() => finishPendingMatch(), 210);
  save();
}

function doHint() {
  if (busy || state.phase !== "playing") return;
  if (state.hintsLeft <= 0) { showToast("Bạn đã dùng hết 3 lượt gợi ý của ván này."); return; }
  const pair = findAvailablePair();
  if (!pair) { recoverDeadlock(); return; }
  runStarted = true;
  state.clockStarted = true;
  state.hintsLeft--;
  render();
  const first = boardNode.querySelector(`[data-index="${pair.first}"]`);
  const second = boardNode.querySelector(`[data-index="${pair.second}"]`);
  first?.classList.add("is-hint");
  second?.classList.add("is-hint");
  showToast(`Gợi ý: nối hai hình đang phát sáng · còn ${state.hintsLeft} lượt.`);
  save();
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    first?.classList.remove("is-hint");
    second?.classList.remove("is-hint");
  }, 1200);
}

function doShuffle() {
  if (busy || state.phase !== "playing") return;
  if (state.lives <= 0) { showToast("Bạn đã hết lượt đổi vị trí."); return; }
  runStarted = true;
  state.clockStarted = true;
  state.lives--;
  playSound("start");
  const usedFallback = shuffleUntilPlayable();
  statusText = `${usedFallback ? "Đã sắp xếp lại bàn" : "Đã đổi vị trí"} · còn ${state.lives} lượt.`;
  render();
  save();
}

function setSizeMode(mode) {
  const [cols, rows] = mode === "full" ? [16, 9] : chooseSize("auto");
  const changed = state.cols !== cols || state.rows !== rows;
  const timeLeft = state.timeLeft;
  sizeMode = mode;
  try { localStorage.setItem(SIZE_STORAGE_KEY, mode); } catch { /* The selected size remains active for this session. */ }
  closeDialog();
  if (changed && pendingMatch) finishPendingMatch();
  if (!changed || state.phase !== "playing") return;
  state = resizeSavedLevel({ ...state, timeLeft }, cols, rows, mode);
  runStarted = true;
  statusText = `Đã đổi sang bàn ${state.cols}×${state.rows} · tiến độ, điểm và thời gian được giữ lại.`;
  render();
  save();
}

function startNextLevel() {
  runStarted = true;
  state = createLevel(state.level, { score: state.score, lives: state.lives, hintsLeft: state.hintsLeft });
  statusText = `Bắt đầu bàn ${state.level}.`;
  render();
  save();
}

function newGame() {
  cancelPendingMatch();
  runStarted = false;
  state = createLevel(1, { score: 0, lives: STARTING_LIVES, hintsLeft: HINTS_PER_RUN });
  runStarted = true;
  statusText = "Bắt đầu bàn 1 · nối các cặp Pokémon trước khi hết giờ.";
  playSound("start");
  render();
  save();
}

function endByTime() {
  state.timeLeft = 0;
  cancelPendingMatch();
  busy = false;
  clearConnection();
  state.phase = "over";
  state.reason = "time";
  save();
  render();
  showEndDialog();
}

function doRestart() {
  showDialog("Chơi lại?", "Ván hiện tại sẽ bị hủy và bắt đầu lại từ bàn 1.", [
    { label: "Chơi lại", primary: true, run: newGame },
    { label: "Tiếp tục", run: closeDialog },
  ], "restart");
}

function doSize() {
  const current = `${state.cols}×${state.rows}`;
  showDialog("Cỡ bàn", `Bàn hiện tại ${current}. Tự động sẽ chọn bàn vừa màn hình; 16×9 giống bàn máy tính và có thể nhỏ trên điện thoại.`, [
    { label: "Tự động", primary: sizeMode === "auto", run: () => setSizeMode("auto") },
    { label: "Đầy đủ 16×9", primary: sizeMode === "full", run: () => setSizeMode("full") },
    { label: "Đóng", run: closeDialog },
  ], "size");
}

function updateSoundButton() {
  soundButton.setAttribute("aria-pressed", String(soundEnabled));
  soundButton.lastElementChild.textContent = soundEnabled ? "Âm thanh" : "Đã tắt";
}

boardNode.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-index]");
  if (tile) choose(Number(tile.dataset.index));
});
boardNode.addEventListener("keydown", (event) => {
  const current = event.target.closest?.(".pika-tile[data-index]");
  const movement = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  }[event.key];
  if (!current || !movement) return;
  const index = Number(current.dataset.index);
  let row = Math.floor(index / state.cols) + movement[0];
  let col = (index % state.cols) + movement[1];
  while (row >= 0 && row < state.rows && col >= 0 && col < state.cols) {
    const next = boardNode.querySelector(`[data-index="${row * state.cols + col}"]`);
    if (next && !next.disabled) {
      event.preventDefault();
      boardNode.querySelectorAll(".pika-tile").forEach((button) => { button.tabIndex = -1; });
      next.tabIndex = 0;
      next.focus({ preventScroll: true });
      return;
    }
    row += movement[0];
    col += movement[1];
  }
});
soundButton.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? "on" : "off"); } catch { /* Sound toggle remains active for this session. */ }
  updateSoundButton();
  if (soundEnabled) playSound("select");
});
document.querySelector("#shuffle").addEventListener("click", doShuffle);
hintButton.addEventListener("click", doHint);
document.querySelector("#size").addEventListener("click", doSize);
document.querySelector("#restart").addEventListener("click", doRestart);
document.querySelector("#pika-dialog").addEventListener("cancel", (event) => {
  if (modalKind === "between" || modalKind === "over" || modalKind === "won") event.preventDefault();
  else closeDialog();
});
window.addEventListener("resize", resizeBoard);
window.addEventListener("pagehide", () => {
  resumeClockOnShow = state.clockStarted;
  const wasPlaying = state.phase === "playing";
  if (state.timeLeft > 0) finishPendingMatch();
  else cancelPendingMatch();
  if (wasPlaying && state.phase === "playing" && state.timeLeft <= 0) endByTime();
  state.clockStarted = false;
  save();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  lastFrame = performance.now();
  if (resumeClockOnShow && state.phase === "playing") state.clockStarted = true;
  resumeClockOnShow = false;
  save();
});
document.addEventListener("visibilitychange", () => { lastFrame = performance.now(); if (document.hidden) save(); });

function frame(timestamp) {
  const delta = Math.min(1, Math.max(0, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  if (!document.hidden && !document.querySelector("#pika-dialog").open && state.phase === "playing" && state.clockStarted) {
    state.timeLeft = Math.max(0, state.timeLeft - delta);
    updateClock();
    saveElapsed += delta;
    if (saveElapsed >= 5) { save(); saveElapsed = 0; }
    if (state.timeLeft <= 0) endByTime();
  }
  requestAnimationFrame(frame);
}

record.bestScore = Number(record.bestScore || 0);
updateSoundButton();
render();
save();
if (state.phase === "between") showLevelDialog();
else if (state.phase === "over" || state.phase === "won") showEndDialog();
requestAnimationFrame(frame);
