const canvas = document.querySelector("#tetris-board");
const ctx = canvas.getContext("2d");
const holdCanvas = document.querySelector("#tetris-hold");
const holdPreview = { canvas: holdCanvas, ctx: holdCanvas.getContext("2d"), lastType: undefined };
const nextPreviews = [...document.querySelectorAll(".next-piece")].map((preview) => ({
  canvas: preview,
  ctx: preview.getContext("2d"),
  lastType: undefined,
}));
const scoreNode = document.querySelector("#score");
const linesNode = document.querySelector("#lines");
const levelNode = document.querySelector("#level");
const statusNode = document.querySelector("#status");
const pauseButton = document.querySelector("#pause");
const holdButton = document.querySelector("#hold");
const STORAGE_KEY = "may-game:v1:tetris";
const COLS = 10;
const ROWS = 20;
const NEXT_COUNT = 3;
const CELL = canvas.width / COLS;
const COLORS = { I: "#37c9f4", O: "#f3d34a", T: "#a978f5", S: "#4bd694", Z: "#f35c7a", J: "#5579f5", L: "#f39b42" };
const SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
};

function readRecord() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { bestScore: 0, current: null }; }
  catch { return { bestScore: 0, current: null }; }
}

let record = readRecord();
function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
function pieceFromType(type) {
  return { type, matrix: SHAPES[type].map((row) => [...row]), color: COLORS[type] };
}
function randomPiece() { return pieceFromType(Object.keys(SHAPES)[Math.floor(Math.random() * 7)]); }
function freshState() {
  const state = { board: emptyBoard(), active: null, queue: Array.from({ length: NEXT_COUNT }, () => randomPiece().type), hold: null, holdUsed: false, score: 0, lines: 0, level: 1, over: false, paused: false };
  spawn(state);
  return state;
}
function valid(matrix, x, y, board = state.board) {
  for (let row = 0; row < matrix.length; row++) for (let col = 0; col < matrix[row].length; col++) {
    if (!matrix[row][col]) continue;
    const px = x + col;
    const py = y + row;
    if (px < 0 || px >= COLS || py >= ROWS) return false;
    if (py >= 0 && board[py][px]) return false;
  }
  return true;
}
function spawn(target = state) {
  if (!Array.isArray(target.queue)) target.queue = [];
  while (target.queue.length < NEXT_COUNT) target.queue.push(randomPiece().type);
  const piece = pieceFromType(target.queue.shift());
  target.active = { ...piece, x: Math.floor((COLS - piece.matrix[0].length) / 2), y: -1 };
  target.holdUsed = false;
  while (target.queue.length < NEXT_COUNT) target.queue.push(randomPiece().type);
  if (!valid(target.active.matrix, target.active.x, target.active.y, target.board)) {
    target.over = true;
    target.active = null;
  }
}

let saved = record.current;
let state = saved?.board?.length === ROWS ? {
  ...saved,
  board: saved.board.map((row) => [...row]),
  queue: (Array.isArray(saved.queue) ? saved.queue : saved.next?.type ? [saved.next.type] : []).map((piece) => typeof piece === "string" ? piece : piece?.type).filter((type) => SHAPES[type]),
  hold: SHAPES[saved.hold?.type || saved.hold] ? saved.hold?.type || saved.hold : null,
  holdUsed: Boolean(saved.holdUsed),
} : freshState();
if (saved?.board?.length === ROWS) {
  while (state.queue.length < NEXT_COUNT) state.queue.push(randomPiece().type);
  delete state.next;
}
if (saved?.board?.length === ROWS) state.paused = true;
let gravity = 0;
let previousFrame = 0;

function persist() {
  record.bestScore = Math.max(Number(record.bestScore || 0), state.score);
  record = { version: 1, bestScore: record.bestScore, current: state.over ? null : structuredClone(state), updatedAt: Date.now() };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Keep play available if storage is full or disabled. */ }
  scoreNode.textContent = String(state.score);
  linesNode.textContent = String(state.lines);
  levelNode.textContent = String(state.level);
}

function drawCell(col, row, color) {
  const x = col * CELL;
  const y = row * CELL;
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  ctx.fillStyle = "rgba(255,255,255,.24)";
  ctx.fillRect(x + 3, y + 3, CELL - 6, 3);
  ctx.strokeStyle = "rgba(5,12,22,.62)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
}

function drawPreview(preview, type) {
  if (preview.lastType === type) return;
  preview.lastType = type;
  const { canvas: previewCanvas, ctx: previewCtx } = preview;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (!type || !SHAPES[type]) {
    previewCtx.fillStyle = "rgba(171,185,154,.55)";
    previewCtx.textAlign = "center";
    previewCtx.font = "600 18px 'Chakra Petch', sans-serif";
    previewCtx.fillText("—", previewCanvas.width / 2, previewCanvas.height / 2 + 6);
    return;
  }
  const piece = pieceFromType(type);
  const cell = Math.floor(Math.min(previewCanvas.width / 5, previewCanvas.height / 4, 12));
  const width = piece.matrix[0].length * cell;
  const height = piece.matrix.length * cell;
  const offsetX = Math.round((previewCanvas.width - width) / 2);
  const offsetY = Math.round((previewCanvas.height - height) / 2);
  piece.matrix.forEach((row, y) => row.forEach((bit, x) => {
    if (!bit) return;
    const px = offsetX + x * cell;
    const py = offsetY + y * cell;
    previewCtx.fillStyle = piece.color;
    previewCtx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    previewCtx.fillStyle = "rgba(255,255,255,.26)";
    previewCtx.fillRect(px + 2, py + 2, Math.max(1, cell - 4), 2);
    previewCtx.strokeStyle = "rgba(5,12,22,.62)";
    previewCtx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
  }));
}

function drawPreviews() {
  holdCanvas.setAttribute("aria-label", `Khối đang giữ: ${state.hold || "trống"}`);
  drawPreview(holdPreview, state.hold);
  nextPreviews.forEach((preview, index) => {
    const type = state.queue[index] || null;
    preview.canvas.setAttribute("aria-label", `Khối tiếp theo thứ ${index + 1}: ${type || "trống"}`);
    drawPreview(preview, type);
  });
}

function draw() {
  ctx.fillStyle = "#080d16";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#19283a";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(canvas.width, y * CELL + .5); ctx.stroke(); }
  state.board.forEach((row, y) => row.forEach((color, x) => { if (color) drawCell(x, y, color); }));
  if (state.active) state.active.matrix.forEach((row, y) => row.forEach((bit, x) => { if (bit && state.active.y + y >= 0) drawCell(state.active.x + x, state.active.y + y, state.active.color); }));
  if (state.paused || state.over) {
    ctx.fillStyle = "rgba(8,13,10,.9)";
    ctx.fillRect(0, canvas.height / 2 - 48, canvas.width, 96);
    ctx.textAlign = "center";
    ctx.fillStyle = state.over ? "#ee886b" : "#c7e875";
    ctx.font = "600 21px 'Chakra Petch', sans-serif";
    ctx.fillText(state.over ? "Hết ván" : "Tạm dừng", canvas.width / 2, canvas.height / 2 - 5);
    if (state.over) {
      ctx.fillStyle = "#abb99a";
      ctx.font = "500 11px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(`Điểm ${state.score}  ·  Kỷ lục ${record.bestScore}`, canvas.width / 2, canvas.height / 2 + 18);
    }
  }
  pauseButton.textContent = state.paused ? "Tiếp tục" : "Tạm dừng";
  pauseButton.disabled = state.over;
  holdButton.disabled = state.over || state.paused || state.holdUsed || !state.active;
  statusNode.textContent = state.over ? `Ván kết thúc. Điểm ${state.score}. Kỷ lục ${record.bestScore}.` : state.paused ? "Tạm dừng." : "";
  statusNode.classList.toggle("is-error", state.over);
  drawPreviews();
}

function lockPiece() {
  if (!state.active) return;
  const aboveBoard = state.active.matrix.some((row, y) => row.some((bit) => bit && state.active.y + y < 0));
  if (aboveBoard) {
    state.over = true;
    state.active = null;
    persist();
    return;
  }
  state.active.matrix.forEach((row, y) => row.forEach((bit, x) => {
    if (!bit) return;
    const boardY = state.active.y + y;
    state.board[boardY][state.active.x + x] = state.active.color;
  }));
  let cleared = 0;
  state.board = state.board.filter((row) => {
    if (row.every(Boolean)) { cleared++; return false; }
    return true;
  });
  while (state.board.length < ROWS) state.board.unshift(Array(COLS).fill(null));
  if (cleared) {
    state.lines += cleared;
    state.score += [0, 100, 300, 500, 800][cleared] * state.level;
    state.level = 1 + Math.floor(state.lines / 10);
  }
  spawn();
  persist();
}

function move(dx, dy, softDrop = false) {
  if (state.over || state.paused || !state.active) return;
  if (valid(state.active.matrix, state.active.x + dx, state.active.y + dy)) {
    state.active.x += dx;
    state.active.y += dy;
    if (dy > 0 && softDrop) { state.score += 1; persist(); }
  } else if (dy > 0) lockPiece();
  draw();
}

function rotate() {
  if (state.over || state.paused || !state.active) return;
  const matrix = state.active.matrix[0].map((_, i) => state.active.matrix.map((row) => row[i]).reverse());
  for (const offset of [0, -1, 1, -2, 2]) {
    if (valid(matrix, state.active.x + offset, state.active.y)) {
      state.active.matrix = matrix;
      state.active.x += offset;
      persist();
      break;
    }
  }
  draw();
}

function holdPiece() {
  if (state.over || state.paused || state.holdUsed || !state.active) return;
  const activeType = state.active.type;
  if (!state.hold) {
    state.hold = activeType;
    spawn();
  } else {
    const heldType = state.hold;
    state.hold = activeType;
    const piece = pieceFromType(heldType);
    state.active = { ...piece, x: Math.floor((COLS - piece.matrix[0].length) / 2), y: -1 };
    if (!valid(state.active.matrix, state.active.x, state.active.y)) {
      state.over = true;
      state.active = null;
    }
  }
  state.holdUsed = true;
  persist();
  draw();
}

function hardDrop() {
  if (state.over || state.paused || !state.active) return;
  let steps = 0;
  while (valid(state.active.matrix, state.active.x, state.active.y + 1)) { state.active.y++; steps++; }
  state.score += steps * 2;
  lockPiece();
  draw();
}

function act(action) {
  if (action === "left") move(-1, 0);
  if (action === "right") move(1, 0);
  if (action === "down") move(0, 1, true);
  if (action === "rotate") rotate();
  if (action === "drop") hardDrop();
}

function frame(timestamp) {
  const delta = previousFrame ? Math.min(timestamp - previousFrame, 80) : 0;
  previousFrame = timestamp;
  if (!state.paused && !state.over) {
    gravity += delta;
    const interval = Math.max(110, 760 - (state.level - 1) * 58);
    if (gravity >= interval) { gravity = 0; move(0, 1); }
  }
  draw();
  requestAnimationFrame(frame);
}

document.addEventListener("keydown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() === "c") { event.preventDefault(); holdPiece(); return; }
  const actions = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "rotate", " ": "drop" };
  if (event.key.toLowerCase() === "p") {
    if (state.over) return;
    state.paused = !state.paused;
    persist();
    draw();
    return;
  }
  const action = actions[event.key];
  if (action) { event.preventDefault(); act(action); }
});

document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => act(button.dataset.action)));
holdButton.addEventListener("click", holdPiece);
pauseButton.addEventListener("click", () => { if (state.over) return; state.paused = !state.paused; persist(); draw(); });
document.querySelector("#restart").addEventListener("click", () => { state = freshState(); gravity = 0; persist(); draw(); });
window.addEventListener("pagehide", persist);

record.bestScore = Number(record.bestScore || 0);
persist();
requestAnimationFrame(frame);
