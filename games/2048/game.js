// Shared, dependency-free engine; the browser adapter below is skipped by Node checks.
const SIZE = 4, CELLS = SIZE * SIZE, VERSION = 1, WIN_VALUE = 2048, MAX_VALUE = 131072;
const STORAGE_ID = "2048";
const DIRECTIONS = ["up", "down", "left", "right"];

// Cell indices of each line, listed from the edge tiles slide towards.
function lines(dir) {
  const result = [];
  for (let a = 0; a < SIZE; a++) {
    const line = [];
    for (let b = 0; b < SIZE; b++) {
      if (dir === "left") line.push(a * SIZE + b);
      else if (dir === "right") line.push(a * SIZE + SIZE - 1 - b);
      else if (dir === "up") line.push(b * SIZE + a);
      else line.push((SIZE - 1 - b) * SIZE + a);
    }
    result.push(line);
  }
  return result;
}
// Slide one line towards index 0; each tile merges at most once per move.
function slideLine(values) {
  const tiles = [];
  values.forEach((value, index) => { if (value) tiles.push({ value, from: index }); });
  const out = Array(values.length).fill(0), moves = [];
  let gained = 0, merges = 0, target = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i], next = tiles[i + 1];
    if (next && next.value === tile.value) {
      out[target] = tile.value * 2;
      gained += tile.value * 2; merges++;
      moves.push({ from: tile.from, to: target, value: tile.value, merged: true }, { from: next.from, to: target, value: next.value, merged: true });
      i++;
    } else {
      out[target] = tile.value;
      moves.push({ from: tile.from, to: target, value: tile.value, merged: false });
    }
    target++;
  }
  return { line: out, gained, merges, moves };
}
function emptyCells(grid) { const free = []; grid.forEach((v, i) => { if (!v) free.push(i); }); return free; }
function spawnTile(grid, random = Math.random) {
  const free = emptyCells(grid);
  if (!free.length) return null;
  const index = free[Math.min(free.length - 1, Math.floor(random() * free.length))];
  const value = random() < .9 ? 2 : 4;
  grid[index] = value;
  return { index, value };
}
function canMove(grid) {
  for (let i = 0; i < CELLS; i++) {
    if (!grid[i]) return true;
    if (i % SIZE < SIZE - 1 && grid[i] === grid[i + 1]) return true;
    if (i + SIZE < CELLS && grid[i] === grid[i + SIZE]) return true;
  }
  return false;
}
const maxTile = (grid) => Math.max(0, ...grid);
function freshState(random = Math.random) {
  const grid = Array(CELLS).fill(0);
  spawnTile(grid, random); spawnTile(grid, random);
  return { grid, score: 0, phase: "playing", continued: false, undo: null };
}
// Pure board move: returns the new grid and the tile paths (board indices), no spawn.
function slideGrid(grid, dir) {
  const next = grid.slice(), moves = [];
  let gained = 0, merges = 0;
  for (const line of lines(dir)) {
    const result = slideLine(line.map((i) => grid[i]));
    result.line.forEach((value, k) => { next[line[k]] = value; });
    for (const m of result.moves) moves.push({ from: line[m.from], to: line[m.to], value: m.value, merged: m.merged });
    gained += result.gained; merges += result.merges;
  }
  const changed = next.some((v, i) => v !== grid[i]);
  return { grid: next, gained, merges, moves, changed };
}
// Applies a move to the state. Returns null when the board would not change.
function move(s, dir, random = Math.random) {
  if (s.phase !== "playing" || !DIRECTIONS.includes(dir)) return null;
  const result = slideGrid(s.grid, dir);
  if (!result.changed) return null;
  s.undo = { grid: s.grid.slice(), score: s.score };
  s.grid = result.grid;
  s.score += result.gained;
  const spawned = spawnTile(s.grid, random);
  let event = result.merges ? "merge" : "move";
  if (!s.continued && maxTile(s.grid) >= WIN_VALUE) { s.phase = "won"; event = "win"; }
  else if (!canMove(s.grid)) { s.phase = "over"; event = "over"; }
  return { event, gained: result.gained, merges: result.merges, moves: result.moves, spawned };
}
function undoMove(s) {
  if (!s.undo) return false;
  s.grid = s.undo.grid.slice();
  s.score = s.undo.score;
  s.undo = null;
  s.phase = "playing";
  return true;
}
// Keep playing after reaching 2048; the win overlay never returns this game.
function continueGame(s) {
  if (s.phase !== "won") return false;
  s.continued = true;
  s.phase = canMove(s.grid) ? "playing" : "over";
  return true;
}
const validCell = (v) => v === 0 || (Number.isInteger(v) && v >= 2 && v <= MAX_VALUE && (v & (v - 1)) === 0);
const validGrid = (g) => Array.isArray(g) && g.length === CELLS && g.every(validCell) && g.some((v) => v > 0);
const validScore = (n) => Number.isSafeInteger(n) && n >= 0;
function validState(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (!validGrid(s.grid) || !validScore(s.score) || typeof s.continued !== "boolean") return false;
  if (s.phase === "playing") { if (!canMove(s.grid)) return false; }
  else if (s.phase === "won") { if (s.continued || maxTile(s.grid) < WIN_VALUE) return false; }
  else return false;
  if (s.undo === null) return true;
  return !!s.undo && typeof s.undo === "object" && validGrid(s.undo.grid) && validScore(s.undo.score) && s.undo.score <= s.score;
}
const cloneState = (s) => ({ grid: s.grid.slice(), score: s.score, phase: s.phase, continued: s.continued,
  undo: s.undo ? { grid: s.undo.grid.slice(), score: s.undo.score } : null });

if (typeof module !== "undefined") module.exports = { SIZE, WIN_VALUE, MAX_VALUE, lines, slideLine, slideGrid, spawnTile, canMove, maxTile,
  freshState, move, undoMove, continueGame, validState, cloneState };

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const board = document.querySelector("#board-2048");
  const tileLayer = board.querySelector(".tiles-2048");
  const description = document.querySelector("#board-2048-cells");
  const overlay = document.querySelector("#overlay-2048");
  const overlayTitle = overlay.querySelector("h2");
  const overlayText = overlay.querySelector("p");
  const primary = document.querySelector("#primary-2048");
  const secondary = document.querySelector("#secondary-2048");
  const undoButton = document.querySelector("#undo");
  const muteToggle = document.querySelector("#mute");
  const menu = document.querySelector("#game-menu");
  const labels = { score: document.querySelector("#score"), best: document.querySelector("#best"), max: document.querySelector("#max-tile") };
  const announce = createAnnouncer(document.querySelector("#status-2048"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saved = store.read();
  let record = { version: VERSION, bestScore: validScore(saved?.bestScore) ? saved.bestScore : 0, muted: saved?.muted === true, current: null };
  const tone = createTone(() => record.muted);
  let state = validState(saved?.current) ? cloneState(saved.current) : freshState();
  record.bestScore = Math.max(record.bestScore, state.score);
  let animation = 0, lastAnnounce = -Infinity;

  const persist = () => {
    // A finished board is not resumable; the catalog only offers "Chơi tiếp" for unfinished games.
    record.current = state.phase === "over" ? null : cloneState(state);
    store.write(record);
  };
  const fmt = (n) => n.toLocaleString("vi-VN");
  function syncLabels() {
    labels.score.textContent = fmt(state.score);
    labels.best.textContent = fmt(record.bestScore);
    labels.max.textContent = fmt(maxTile(state.grid));
    undoButton.disabled = !state.undo;
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
    const rows = [];
    for (let r = 0; r < SIZE; r++) rows.push(`Hàng ${r + 1}: ${state.grid.slice(r * SIZE, r * SIZE + SIZE).map((v) => v || "trống").join(", ")}.`);
    description.textContent = rows.join(" ");
  }
  function showOverlay() {
    const texts = {
      won: ["Đạt 2048!", `Bạn được ${fmt(state.score)} điểm. Chơi tiếp để lên ô lớn hơn.`, "Chơi tiếp", "Ván mới"],
      over: ["Hết nước đi", `Bạn được ${fmt(state.score)} điểm, ô lớn nhất ${fmt(maxTile(state.grid))}.`, "Chơi lại", null],
    }[state.phase];
    overlay.hidden = !texts;
    if (!texts) return;
    [overlayTitle.textContent, overlayText.textContent, primary.textContent] = texts;
    secondary.hidden = !texts[3];
    if (texts[3]) secondary.textContent = texts[3];
  }
  function tile(value, index, className = "") {
    const element = document.createElement("div");
    element.className = `tile-2048 ${className}`.trim();
    element.dataset.value = value > 2048 ? (value > 8192 ? "super" : String(value)) : String(value);
    element.dataset.digits = String(String(value).length);
    element.textContent = value;
    place(element, index);
    return element;
  }
  function place(element, index) {
    element.style.setProperty("--x", index % SIZE);
    element.style.setProperty("--y", Math.floor(index / SIZE));
  }
  function drawBoard(result = null) {
    const merged = new Set(result ? result.moves.filter((m) => m.merged).map((m) => m.to) : []);
    tileLayer.replaceChildren(...state.grid.flatMap((value, index) => value ? [tile(value, index,
      merged.has(index) ? "is-merged" : result?.spawned?.index === index ? "is-new" : "")] : []));
  }
  function render(result = null) { syncLabels(); showOverlay(); drawBoard(result); }
  function finishAnimation() {
    if (!animation) return;
    clearTimeout(animation.timer);
    const { result } = animation;
    animation = 0;
    render(result);
  }
  function animate(result) {
    syncLabels();
    if (reduced.matches) { render(result); return; }
    // Draw the old tiles at their source cells, then let CSS transitions carry them to their targets.
    const moving = result.moves.map((m) => tile(m.value, m.from, "is-sliding"));
    tileLayer.replaceChildren(...moving);
    void tileLayer.offsetWidth;
    result.moves.forEach((m, i) => place(moving[i], m.to));
    animation = { result, timer: setTimeout(() => { animation = 0; render(result); }, 100) };
  }

  function steer(dir) {
    if (menu.open) return;
    finishAnimation();
    tone.unlock();
    const result = move(state, dir);
    if (!result) { if (state.phase === "playing") tone.play([[140, 0, .04, "triangle"]], .05); return; }
    if (state.score > record.bestScore) record.bestScore = state.score;
    persist();
    animate(result);
    if (result.event === "win") {
      tone.play([[523, 0, .1], [659, .1, .1], [784, .2, .1], [1047, .3, .25]]);
      announce(`Đạt ô 2048! Điểm ${state.score}. Chọn Chơi tiếp hoặc Ván mới.`);
      setTimeout(() => primary.focus({ preventScroll: true }), reduced.matches ? 0 : 110);
    } else if (result.event === "over") {
      tone.play([[262, 0, .12, "triangle"], [196, .12, .22, "triangle"]]);
      announce(`Hết nước đi. Bạn được ${state.score} điểm, ô lớn nhất ${maxTile(state.grid)}.`);
      setTimeout(() => primary.focus({ preventScroll: true }), reduced.matches ? 0 : 110);
    } else if (result.merges) {
      const top = Math.max(...result.moves.filter((m) => m.merged).map((m) => m.value * 2));
      tone.play([[330 + Math.log2(top) * 40, 0, .06, "triangle"]], .08);
      // Announce merges at most every 1.5s (or for a big tile) so screen readers are not flooded.
      const now = performance.now();
      if (top >= 256 || now - lastAnnounce > 1500) { lastAnnounce = now; announce(`Gộp được ${result.merges} ô, điểm ${state.score}.`); }
    } else tone.play([[220, 0, .03, "triangle"]], .04);
  }
  function newGame() {
    finishAnimation();
    state = freshState();
    persist(); render();
    announce("Ván mới.");
    board.focus({ preventScroll: true });
  }
  function undo() {
    if (menu.open) return;
    finishAnimation();
    if (!undoMove(state)) return;
    persist(); render();
    tone.play([[392, 0, .05, "triangle"], [330, .05, .05, "triangle"]], .06);
    announce(`Đã đi lại. Điểm ${state.score}.`);
    board.focus({ preventScroll: true });
  }

  primary.addEventListener("click", () => {
    if (state.phase === "won") { continueGame(state); persist(); render(); announce("Chơi tiếp."); board.focus({ preventScroll: true }); }
    else newGame();
  });
  secondary.addEventListener("click", newGame);
  undoButton.addEventListener("click", undo);
  document.querySelector("#new-game").addEventListener("click", () => { menu.close(); newGame(); });
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; persist(); syncLabels(); });
  const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (keys[key]) { event.preventDefault(); if (state.phase === "playing") steer(keys[key]); }
    else if (key === "u" || key === "Backspace") { event.preventDefault(); undo(); }
    else if (key === "m") muteToggle.click();
  });
  let swipe = null;
  board.addEventListener("pointerdown", (event) => {
    if (event.button > 0) return;
    swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { board.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers may not be capturable. */ }
  });
  board.addEventListener("pointerup", (event) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    board.focus({ preventScroll: true });
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  board.addEventListener("pointercancel", () => { swipe = null; });
  document.addEventListener("game-menu-open", () => { finishAnimation(); persist(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) persist(); });
  window.addEventListener("pagehide", persist);
  render();
  persist();
}
