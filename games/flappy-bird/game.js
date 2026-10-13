const WIDTH = 288;
const HEIGHT = 512;
const BIRD_X = 52;
const BIRD_W = 34;
const BIRD_H = 24;
const PIPE_W = 52;
const PIPE_H = 320;
const PIPE_GAP = 118;
const FLOOR = 400;
const PIPE_SPEED = 118;
const STEP = 1 / 120;
const GRAVITY = 805.6;
const FLAP_SPEED = -238.5;
const MAX_SCORE = 999999;
const STORAGE_KEY = "may-game:v1:flappy-bird";

function makePipe(x) { return { x, gapY: 70 + Math.random() * 180, scored: false }; }
function newState() {
  return { phase: "ready", paused: false, birdY: HEIGHT * .45, birdV: 0,
    pipes: [makePipe(238), makePipe(428)], baseOffset: 0, score: 0, revived: false };
}
function revive(s) {
  if (s.phase !== "results" || s.revived) return false;
  s.revived = true;
  s.phase = "playing"; s.paused = true;
  s.birdY = HEIGHT * .45; s.birdV = 0;
  s.pipes = s.pipes.filter(p => !p.scored).map((p, i) => ({ ...p, x: 238 + i * 190 }));
  while (s.pipes.length < 2) s.pipes.push(makePipe(238 + s.pipes.length * 190));
  return true;
}
function validScore(value) { return Number.isInteger(value) && value >= 0 && value <= MAX_SCORE; }
function bounded(value, low, high) { return Number.isFinite(value) && value >= low && value <= high; }
function readRecord(raw) {
  const empty = { version: 3, bestScore: 0, muted: false, current: null };
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return empty;
    empty.bestScore = validScore(saved.bestScore) ? saved.bestScore : 0;
    empty.muted = saved.muted === true;
    const s = saved.current;
    if (saved.version !== 3 || !s || s.phase !== "playing" || typeof s.paused !== "boolean" ||
        (s.revived !== undefined && typeof s.revived !== "boolean") ||
        !validScore(s.score) || !bounded(s.birdY, -3, FLOOR - BIRD_H + 3) ||
        !bounded(s.birdV, FLAP_SPEED, 600) || !bounded(s.baseOffset, -336, 0) ||
        !Array.isArray(s.pipes) || s.pipes.length < 2 || s.pipes.length > 4 ||
        !s.pipes.every((p, i) => p && bounded(p.x, -PIPE_W - 2, 620) &&
          bounded(p.gapY, 70, 250) && typeof p.scored === "boolean" &&
          (p.scored ? p.x + PIPE_W < BIRD_X : p.x + PIPE_W >= BIRD_X) &&
          (!i || Math.abs(p.x - s.pipes[i - 1].x - 190) < .01))) return empty;
    const current = { phase: "playing", paused: true, birdY: s.birdY, birdV: s.birdV,
      baseOffset: s.baseOffset, score: s.score, revived: s.revived === true,
      pipes: s.pipes.map(({ x, gapY, scored }) => ({ x, gapY, scored })) };
    if (collide(current)) return empty;
    empty.current = current;
    empty.bestScore = Math.max(empty.bestScore, current.score);
    return empty;
  } catch { return empty; }
}
function collide(s) {
  const left = BIRD_X + 4;
  const right = BIRD_X + BIRD_W - 4;
  const top = s.birdY + 3;
  const bottom = s.birdY + BIRD_H - 3;
  return top < 0 || bottom >= FLOOR || s.pipes.some((p) =>
    right > p.x && left < p.x + PIPE_W && (top < p.gapY || bottom > p.gapY + PIPE_GAP));
}
function update(s) {
  const events = [];
  if (s.paused || !["playing", "dying"].includes(s.phase)) return events;
  s.birdV = Math.min(600, s.birdV + GRAVITY * STEP);
  s.birdY += s.birdV * STEP;
  if (s.phase === "dying") {
    if (s.birdY >= FLOOR - BIRD_H) {
      s.birdY = FLOOR - BIRD_H;
      s.phase = "results";
      events.push("swoosh");
    }
    return events;
  }
  s.baseOffset -= PIPE_SPEED * STEP;
  if (s.baseOffset <= -336) s.baseOffset += 336;
  s.pipes.forEach((p) => { p.x -= PIPE_SPEED * STEP; });
  if (s.pipes.at(-1).x < WIDTH) s.pipes.push(makePipe(s.pipes.at(-1).x + 190));
  s.pipes = s.pipes.filter((p) => p.x > -PIPE_W - 2);
  // Collision wins over scoring on the same simulation tick.
  if (collide(s)) {
    s.phase = "dying";
    s.birdY = Math.max(-3, s.birdY);
    s.birdV = Math.max(0, s.birdV);
    return ["hit", "die"];
  }
  s.pipes.forEach((p) => {
    if (!p.scored && p.x + PIPE_W < BIRD_X) {
      p.scored = true;
      if (s.score < MAX_SCORE) { s.score++; events.push("point"); }
    }
  });
  return events;
}

// Browser wiring stays below the deterministic simulation for the standalone assert check.
const canvas = document.querySelector("#flappy-board");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
const results = document.querySelector(".flappy-results");
const reviveButton = document.querySelector("#revive");
const assetRoot = new URL("./assets/sprites/", import.meta.url);
function loadSprite(name) {
  const image = new Image();
  image.src = new URL(name, assetRoot).href;
  return image;
}
const sprites = {
  background: loadSprite("background-day.png"), base: loadSprite("base.png"),
  pipe: loadSprite("pipe-green.png"), message: loadSprite("message.png"),
  gameover: loadSprite("gameover.png"),
  digits: Array.from({ length: 10 }, (_, n) => loadSprite(`${n}.png`)),
  bird: ["upflap", "midflap", "downflap"].map((f) => loadSprite(`yellowbird-${f}.png`)),
};
let raw = null;
try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
let record = readRecord(raw);
let state = record.current || newState();
let lastFrame = null;
let accumulator = 0;
let saveElapsed = 0;
let animationTime = 0;
let audioContext;
const sounds = new Map();
function unlockAudio() {
  try {
    if (!audioContext) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext = new AudioContext();
      for (const name of ["wing", "point", "hit", "die", "swoosh"]) {
        sounds.set(name, fetch(new URL(`./assets/audio/${name}.wav`, import.meta.url))
          .then((r) => { if (!r.ok) throw new Error("Audio unavailable"); return r.arrayBuffer(); })
          .then((bytes) => audioContext.decodeAudioData(bytes)).catch(() => null));
      }
    }
    audioContext.resume().catch(() => {});
  } catch { /* Unsupported or blocked audio must not stop play. */ }
}
function sound(name) {
  if (record.muted || !audioContext || document.hidden) return;
  sounds.get(name)?.then((buffer) => {
    if (!buffer || record.muted || document.hidden || audioContext.state !== "running") return;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(audioContext.currentTime + (name === "die" ? .12 : 0));
  }).catch(() => {});
}
function resetClock() { lastFrame = null; accumulator = 0; }
function persist() {
  record.bestScore = Math.max(record.bestScore, state.score);
  record.current = state.phase === "playing" ? structuredClone(state) : null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Storage is optional. */ }
}
function sprite(image, x, y, w = image.naturalWidth, h = image.naturalHeight) {
  if (!image.complete || !image.naturalWidth) return false;
  ctx.drawImage(image, x, y, w, h);
  return true;
}
function drawPipe(p) {
  ctx.save();
  ctx.translate(p.x, p.gapY);
  ctx.scale(1, -1);
  if (!sprite(sprites.pipe, 0, 0, PIPE_W, PIPE_H)) {
    ctx.fillStyle = "#76bf45"; ctx.fillRect(0, 0, PIPE_W, PIPE_H);
  }
  ctx.restore();
  if (!sprite(sprites.pipe, p.x, p.gapY + PIPE_GAP, PIPE_W, PIPE_H)) {
    ctx.fillStyle = "#76bf45"; ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_W, PIPE_H);
  }
}
function text(value, y, size = 18) {
  ctx.textAlign = "center";
  ctx.font = `600 ${size}px sans-serif`;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#203b31";
  ctx.fillStyle = "#fffdf3";
  ctx.strokeText(value, WIDTH / 2, y);
  ctx.fillText(value, WIDTH / 2, y);
}
function drawDigits(value, y) {
  const images = String(value).split("").map((n) => sprites.digits[Number(n)]);
  if (images.some((image) => !image.complete || !image.naturalWidth)) { text(String(value), y + 28, 28); return; }
  const width = images.reduce((sum, image) => sum + image.naturalWidth + 2, -2);
  let x = (WIDTH - width) / 2;
  for (const image of images) { sprite(image, x, y); x += image.naturalWidth + 2; }
}
function draw() {
  ctx.fillStyle = "#d9ede3";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  sprite(sprites.background, 0, 0, WIDTH, HEIGHT);
  if (state.phase !== "ready") state.pipes.forEach(drawPipe);
  ctx.fillStyle = "#ded895";
  ctx.fillRect(0, FLOOR, WIDTH, HEIGHT - FLOOR);
  sprite(sprites.base, Math.round(state.baseOffset), FLOOR);
  sprite(sprites.base, Math.round(state.baseOffset) + 336, FLOOR);
  const idle = state.phase === "ready" ? Math.sin(animationTime / 220) * 3 : 0;
  const bird = sprites.bird[["dying", "results"].includes(state.phase) ? 2 : Math.floor(animationTime / 95) % 3];
  ctx.save();
  ctx.translate(BIRD_X + BIRD_W / 2, state.birdY + BIRD_H / 2 + idle);
  ctx.rotate(state.phase === "results" ? Math.PI / 2 : Math.max(-.45, Math.min(Math.PI / 2, state.birdV / 500)));
  if (!sprite(bird, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H)) {
    ctx.fillStyle = "#ffd446"; ctx.fillRect(-BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H);
  }
  ctx.restore();
  if (state.phase === "ready") {
    if (sprites.message.complete && sprites.message.naturalWidth) ctx.drawImage(sprites.message, 0, 0, 184, 48, 52, 90, 184, 48);
  } else if (state.phase !== "results") drawDigits(state.score, 28);
  if (state.paused) {
    ctx.fillStyle = "rgba(13, 18, 15, .72)";
    ctx.fillRect(24, 190, WIDTH - 48, 80);
    text("Tạm dừng", 235, 21);
  }
}
function syncControls() {
  const ended = state.phase === "results";
  const justEnded = ended && results.hidden;
  results.hidden = !ended;
  if (justEnded) document.querySelector("#play").focus({ preventScroll: true });
  document.querySelector("#score").textContent = String(state.score);
  document.querySelector("#record").textContent = String(record.bestScore);
  reviveButton.hidden = state.revived;
  const pauseButton = document.querySelector("#pause");
  pauseButton.disabled = state.phase !== "playing";
  pauseButton.textContent = state.paused ? "▶" : "Ⅱ";
  pauseButton.setAttribute("aria-label", state.paused ? "Tiếp tục" : "Tạm dừng");
  pauseButton.title = state.paused ? "Tiếp tục" : "Tạm dừng";
  const muteButton = document.querySelector("#mute");
  muteButton.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
  muteButton.setAttribute("aria-pressed", String(record.muted));
  document.querySelector("#flappy-hint").textContent = state.paused
    ? "Chạm để tiếp tục · P trên máy tính"
    : ended ? "Chơi lại hoặc hồi sinh một lần trong ván"
    : "Chạm để bay · Space hoặc ↑ trên máy tính";
  canvas.setAttribute("aria-label", `Flappy Bird. ${state.paused ? "Tạm dừng" : ended ? "Ván kết thúc" : state.phase === "ready" ? "Sẵn sàng" : "Đang chơi"}. Điểm ${state.score}. ${record.muted ? "Âm thanh tắt" : "Âm thanh bật"}. Space hoặc mũi tên lên để vỗ cánh; P tạm dừng; M bật/tắt âm.`);
}
function flap() {
  unlockAudio();
  if (document.hidden || document.querySelector("#game-menu").open || ["dying", "results"].includes(state.phase)) return;
  if (state.paused || state.phase === "ready") resetClock();
  if (state.paused) state.paused = false;
  else { state.phase = "playing"; state.birdV = FLAP_SPEED; sound("wing"); }
  persist(); syncControls(); draw();
}
function togglePause() {
  unlockAudio();
  if (document.hidden || !["playing", "dying"].includes(state.phase)) return;
  state.paused = !state.paused;
  resetClock(); persist(); syncControls(); draw();
}
function toggleMute() {
  unlockAudio(); record.muted = !record.muted; persist(); syncControls();
}
function pauseForExit() {
  if (["playing", "dying"].includes(state.phase)) state.paused = true;
  resetClock(); persist(); syncControls(); draw();
}
function frame(timestamp) {
  const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, .25);
  lastFrame = timestamp;
  if (!document.hidden && !state.paused) {
    animationTime += delta * 1000;
    if (["playing", "dying"].includes(state.phase)) {
      accumulator += delta;
      while (accumulator >= STEP) {
        const events = update(state);
        events.forEach(sound);
        if (events.length) { persist(); syncControls(); }
        accumulator -= STEP;
      }
      saveElapsed += delta;
      if (saveElapsed >= 1) { persist(); saveElapsed = 0; }
    }
  }
  draw();
  requestAnimationFrame(frame);
}
canvas.addEventListener("pointerdown", (event) => { if (event.button !== 0) return; event.preventDefault(); flap(); });
document.querySelector("#play").addEventListener("click", () => {
  state = newState(); resetClock(); flap(); canvas.focus();
});
reviveButton.addEventListener("click", () => {
  if (!revive(state)) return;
  unlockAudio(); resetClock(); persist(); syncControls(); draw(); canvas.focus();
});
document.querySelector("#pause").addEventListener("click", togglePause);
document.querySelector("#mute").addEventListener("click", toggleMute);
document.addEventListener("keydown", (event) => {
  if (document.querySelector("#game-menu").open || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("a, input, textarea, select, [contenteditable]")) return;
  if (target?.closest("button") && (event.key === " " || event.key === "Enter")) return;
  if (event.key === " " || event.key === "ArrowUp") { event.preventDefault(); flap(); }
  if (event.key.toLowerCase() === "p") { event.preventDefault(); togglePause(); }
  if (event.key.toLowerCase() === "m") { event.preventDefault(); toggleMute(); }
});
document.addEventListener("game-menu-open", pauseForExit);
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseForExit(); else resetClock(); });
window.addEventListener("pagehide", pauseForExit);
persist(); syncControls(); draw();
requestAnimationFrame(frame);
