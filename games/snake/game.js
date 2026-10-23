// Shared, dependency-free engine; the browser adapter below is skipped by Node checks.
const SIZE = 18, VERSION = 1, START_DELAY = 150, MIN_DELAY = 70, SPEEDUP = 3;
const STORAGE_ID = "snake";
const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

function freshState(walls = true, random = Math.random) {
  const middle = Math.floor(SIZE / 2);
  const s = { snake: [[middle, middle], [middle - 1, middle], [middle - 2, middle]], dir: "right", queue: [],
    food: null, score: 0, walls, phase: "ready" };
  placeFood(s, random);
  return s;
}
function placeFood(s, random = Math.random) {
  const taken = new Set(s.snake.map(([x, y]) => y * SIZE + x));
  const free = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) { s.food = null; return false; }
  const cell = free[Math.floor(random() * free.length)];
  s.food = [cell % SIZE, Math.floor(cell / SIZE)];
  return true;
}
// Buffer up to two turns so quick "up, left" presses between ticks both register.
function turn(s, dir) {
  if (!Object.hasOwn(DIRECTIONS, dir)) return false;
  const last = s.queue.at(-1) || s.dir;
  if (dir === last || dir === OPPOSITE[last] || s.queue.length >= 2) return false;
  s.queue.push(dir);
  return true;
}
function delay(s) { return Math.max(MIN_DELAY, START_DELAY - s.score / 10 * SPEEDUP); }
function step(s, random = Math.random) {
  if (s.phase !== "playing") return null;
  if (s.queue.length) s.dir = s.queue.shift();
  const [dx, dy] = DIRECTIONS[s.dir];
  let [x, y] = s.snake[0];
  x += dx; y += dy;
  if (!s.walls) { x = (x + SIZE) % SIZE; y = (y + SIZE) % SIZE; }
  const eating = s.food && x === s.food[0] && y === s.food[1];
  // The tail moves away this tick unless the snake grows, so the head may enter its cell.
  const body = eating ? s.snake : s.snake.slice(0, -1);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || body.some(([bx, by]) => bx === x && by === y)) {
    s.phase = "over";
    return "die";
  }
  s.snake.unshift([x, y]);
  if (!eating) { s.snake.pop(); return null; }
  s.score += 10;
  if (!placeFood(s, random)) { s.phase = "over"; s.won = true; return "win"; }
  return "eat";
}
const cell = (value) => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 0 && n < SIZE);
function validState(s) {
  if (!s || typeof s !== "object" || !["ready", "playing", "paused"].includes(s.phase) || typeof s.walls !== "boolean") return false;
  if (!Array.isArray(s.snake) || s.snake.length < 3 || s.snake.length > SIZE * SIZE || !s.snake.every(cell)) return false;
  if (new Set(s.snake.map(([x, y]) => y * SIZE + x)).size !== s.snake.length) return false;
  for (let i = 1; i < s.snake.length; i++) {
    const [ax, ay] = s.snake[i - 1], [bx, by] = s.snake[i];
    const distance = Math.abs(ax - bx) + Math.abs(ay - by);
    if (distance !== 1 && !(!s.walls && distance === SIZE - 1)) return false;
  }
  if (!cell(s.food) || s.snake.some(([x, y]) => x === s.food[0] && y === s.food[1])) return false;
  if (!Object.hasOwn(DIRECTIONS, s.dir) || !Array.isArray(s.queue) || s.queue.length > 2) return false;
  let previous = s.dir;
  for (const direction of s.queue) {
    if (!Object.hasOwn(DIRECTIONS, direction) || direction === previous || direction === OPPOSITE[previous]) return false;
    previous = direction;
  }
  return Number.isSafeInteger(s.score) && s.score >= 0 && s.score === (s.snake.length - 3) * 10;
}

if (typeof module !== "undefined") module.exports = { SIZE, freshState, placeFood, turn, step, delay, validState };

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const canvas = document.querySelector("#snake-board");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#snake-overlay");
  const overlayTitle = overlay.querySelector("h2");
  const overlayText = overlay.querySelector("p");
  const primary = document.querySelector("#snake-primary");
  const scoreLabel = document.querySelector("#score");
  const bestLabel = document.querySelector("#best");
  const wallsToggle = document.querySelector("#walls");
  const muteToggle = document.querySelector("#mute");
  const announce = createAnnouncer(document.querySelector("#snake-status"));
  const saved = store.read();
  let record = { version: VERSION, bestScore: Number.isSafeInteger(saved?.bestScore) && saved.bestScore >= 0 ? saved.bestScore : 0,
    walls: saved?.walls !== false, muted: saved?.muted === true, current: null };
  const tone = createTone(() => record.muted);
  let state = validState(saved?.current) ? { ...saved.current, phase: "paused" } : freshState(record.walls);
  let last = 0, carry = 0, frame = 0;

  const persist = () => {
    // Only an unfinished run counts as "continue" in the catalog.
    record.current = ["playing", "paused"].includes(state.phase) ? { ...state, phase: "paused", queue: [...state.queue] } : null;
    store.write(record);
  };
  function syncLabels() {
    scoreLabel.textContent = state.score.toLocaleString("vi-VN");
    bestLabel.textContent = record.bestScore.toLocaleString("vi-VN");
    wallsToggle.setAttribute("aria-pressed", String(record.walls));
    wallsToggle.textContent = record.walls ? "Tường: chạm là thua" : "Tường: đi xuyên";
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
  }
  function showOverlay() {
    const texts = {
      ready: ["Sẵn sàng", "Vuốt, dùng phím mũi tên hoặc nút điều hướng để đổi hướng.", "Bắt đầu"],
      paused: ["Tạm dừng", "Ván đang được lưu. Nhấn để chơi tiếp.", "Tiếp tục"],
      over: [state.won ? "Rắn đã kín sân!" : "Hết ván", `Bạn được ${state.score.toLocaleString("vi-VN")} điểm.`, "Chơi lại"],
    }[state.phase];
    overlay.hidden = !texts;
    if (!texts) return;
    [overlayTitle.textContent, overlayText.textContent, primary.textContent] = texts;
  }
  function draw() {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.max(SIZE, Math.round(box.width * ratio));
    if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
    const unit = pixels / SIZE;
    ctx.fillStyle = "#15241b";
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = "#1b2e22";
    for (let y = 0; y < SIZE; y++) for (let x = (y % 2); x < SIZE; x += 2) ctx.fillRect(x * unit, y * unit, unit, unit);
    if (state.walls) { ctx.strokeStyle = "#ee886b"; ctx.lineWidth = Math.max(2, unit / 6); ctx.strokeRect(0, 0, pixels, pixels); }
    if (state.food) {
      ctx.fillStyle = "#ee886b";
      ctx.beginPath();
      ctx.arc((state.food[0] + .5) * unit, (state.food[1] + .5) * unit, unit * .36, 0, Math.PI * 2);
      ctx.fill();
    }
    state.snake.forEach(([x, y], index) => {
      ctx.fillStyle = index === 0 ? "#e0efa2" : index % 2 ? "#c7e875" : "#b2d665";
      const inset = unit * .08;
      ctx.fillRect(x * unit + inset, y * unit + inset, unit - inset * 2, unit - inset * 2);
    });
    const [hx, hy] = state.snake[0];
    const [dx, dy] = DIRECTIONS[state.queue[0] || state.dir];
    ctx.fillStyle = "#1e2a1b";
    for (const side of [-1, 1]) {
      const ex = (hx + .5 + dx * .18 + dy * side * .2) * unit, ey = (hy + .5 + dy * .18 + dx * side * .2) * unit;
      ctx.fillRect(ex - unit * .07, ey - unit * .07, unit * .14, unit * .14);
    }
  }
  function render() { syncLabels(); showOverlay(); draw(); }

  function start() {
    if (state.phase === "playing") return;
    cancelAnimationFrame(frame);
    tone.unlock();
    if (state.phase === "over") state = freshState(record.walls);
    state.phase = "playing";
    last = 0; carry = 0;
    render(); persist();
    canvas.focus({ preventScroll: true });
    announce("Bắt đầu chơi.");
    frame = requestAnimationFrame(loop);
  }
  function pause() {
    if (state.phase !== "playing") return;
    state.phase = "paused";
    cancelAnimationFrame(frame);
    render(); persist();
    announce("Đã tạm dừng.");
  }
  function finish(event) {
    if (state.score > record.bestScore) record.bestScore = state.score;
    tone.play(event === "win" ? [[523, 0, .1], [659, .1, .1], [784, .2, .2]] : [[220, 0, .12], [165, .12, .2]]);
    announce(`${event === "win" ? "Thắng" : "Hết ván"} với ${state.score} điểm.`);
    render(); persist();
  }
  function loop(time) {
    if (state.phase !== "playing") return;
    if (last) carry = Math.min(carry + time - last, 1000);
    last = time;
    let changed = false;
    while (state.phase === "playing" && carry >= delay(state)) {
      carry -= delay(state);
      const event = step(state);
      changed = true;
      if (event === "eat") { tone.play([[660, 0, .05], [880, .05, .06]]); persist(); }
      if (event === "die" || event === "win") { finish(event); return; }
    }
    if (changed) { syncLabels(); draw(); }
    frame = requestAnimationFrame(loop);
  }
  function steer(dir) {
    if (state.phase === "ready" || state.phase === "paused") { turn(state, dir); start(); return; }
    if (state.phase === "playing") turn(state, dir);
  }

  primary.addEventListener("click", start);
  document.querySelector("#new-game").addEventListener("click", () => {
    state = freshState(record.walls);
    persist();
    document.querySelector("#game-menu").close();
    render();
    canvas.focus({ preventScroll: true });
  });
  wallsToggle.addEventListener("click", () => {
    record.walls = !record.walls;
    // Changing the field mid-run would change the rules; it applies from the next game.
    if (state.phase === "ready") state = freshState(record.walls);
    persist(); syncLabels(); draw();
  });
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; persist(); syncLabels(); });
  document.querySelectorAll(".play-pad [data-dir]").forEach((button) => button.addEventListener("click", () => steer(button.dataset.dir)));
  const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (keys[key]) { event.preventDefault(); steer(keys[key]); }
    else if (key === "p") { event.preventDefault(); state.phase === "playing" ? pause() : state.phase === "paused" && start(); }
    else if (key === "m") { muteToggle.click(); }
    else if ((key === " " || key === "Enter") && event.target === canvas && state.phase !== "playing") { event.preventDefault(); start(); }
  });
  let swipe = null;
  const touchSurface = canvas.parentElement;
  touchSurface.style.touchAction = "none";
  touchSurface.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    swipe = [event.clientX, event.clientY];
    if (event.pointerId) touchSurface.setPointerCapture(event.pointerId);
  });
  touchSurface.addEventListener("pointerup", (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe[0], dy = event.clientY - swipe[1];
    swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { if (state.phase !== "playing") start(); return; }
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });
  touchSurface.addEventListener("pointercancel", () => { swipe = null; });
  document.addEventListener("game-menu-open", pause);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("pagehide", persist);
  new ResizeObserver(draw).observe(canvas);
  render();
}
