const canvas = document.querySelector("#flappy-board");
const ctx = canvas.getContext("2d");
const scoreNode = document.querySelector("#score");
const statusNode = document.querySelector("#status");
const flapButton = document.querySelector("#flap");
const pauseButton = document.querySelector("#pause");
const STORAGE_KEY = "may-game:v1:flappy-bird";
const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const BIRD_X = 52;
const BIRD_W = 34;
const BIRD_H = 24;
const PIPE_W = 52;
const PIPE_H = 320;
const PIPE_GAP = 118;
const FLOOR = 400;
const PIPE_SPEED = 118;
const assetRoot = new URL("./assets/sprites/", import.meta.url);

function loadSprite(name) {
  const sprite = new Image();
  sprite.src = new URL(name, assetRoot).href;
  return sprite;
}

const sprites = {
  background: loadSprite("background-day.png"),
  base: loadSprite("base.png"),
  pipe: loadSprite("pipe-green.png"),
  bird: ["upflap", "midflap", "downflap"].map((frame) => loadSprite(`yellowbird-${frame}.png`)),
};

function readRecord() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || { bestScore: 0, current: null }; }
  catch { return { bestScore: 0, current: null }; }
}

function makePipe(x) { return { x, gapY: 70 + Math.random() * 180, scored: false }; }

function newState() {
  return {
    assetVersion: 2,
    birdY: HEIGHT * .45,
    birdV: 0,
    pipes: [makePipe(238), makePipe(430)],
    baseOffset: 0,
    score: 0,
    started: false,
    paused: false,
    over: false,
  };
}

let record = readRecord();
let state = record.current?.assetVersion === 2 && Array.isArray(record.current.pipes) ? record.current : newState();
if (state.started && !state.over) state.paused = true;
let lastFrame = 0;
let saveElapsed = 0;

function persist() {
  record.bestScore = Math.max(Number(record.bestScore || 0), Number(state.score || 0));
  record = {
    version: 2,
    bestScore: record.bestScore,
    current: state.started && !state.over ? structuredClone(state) : null,
    updatedAt: Date.now(),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Keep the game playable when storage is unavailable. */ }
  scoreNode.textContent = String(state.score);
}

function drawBackground() {
  if (sprites.background.complete && sprites.background.naturalWidth) {
    ctx.drawImage(sprites.background, 0, 0, WIDTH, HEIGHT);
  } else {
    ctx.fillStyle = "#d9ede3";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  if (sprites.base.complete && sprites.base.naturalWidth) {
    const offset = Math.round(state.baseOffset);
    ctx.drawImage(sprites.base, offset, FLOOR);
    ctx.drawImage(sprites.base, offset + sprites.base.width, FLOOR);
  }
}

function drawPipe(pipe) {
  if (!sprites.pipe.complete || !sprites.pipe.naturalWidth) return;
  const bottomY = pipe.gapY + PIPE_GAP;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pipe.x, 0, PIPE_W, pipe.gapY);
  ctx.clip();
  ctx.translate(pipe.x, pipe.gapY);
  ctx.scale(1, -1);
  ctx.drawImage(sprites.pipe, 0, 0, PIPE_W, PIPE_H);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(pipe.x, bottomY, PIPE_W, Math.max(0, FLOOR - bottomY));
  ctx.clip();
  ctx.drawImage(sprites.pipe, pipe.x, bottomY, PIPE_W, PIPE_H);
  ctx.restore();
}

function drawBird(timestamp) {
  const frameIndex = state.over
    ? 2
    : state.started && !state.paused
      ? Math.floor(timestamp / 95) % sprites.bird.length
      : 1;
  const bird = sprites.bird[frameIndex];
  if (!bird.complete || !bird.naturalWidth) return;

  const idleOffset = !state.started && !state.over ? Math.sin(timestamp / 220) * 3 : 0;
  const centerX = BIRD_X + BIRD_W / 2;
  const centerY = state.birdY + BIRD_H / 2 + idleOffset;
  const angle = state.over ? 0.8 : Math.max(-0.45, Math.min(0.55, state.birdV * 0.12));
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(angle);
  ctx.drawImage(bird, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H);
  ctx.restore();
}

function drawOverlay(title) {
  ctx.fillStyle = "rgba(13, 18, 15, .84)";
  ctx.fillRect(24, HEIGHT / 2 - 48, WIDTH - 48, 96);
  ctx.textAlign = "center";
  ctx.fillStyle = state.over ? "#ee886b" : "#c7e875";
  ctx.font = "600 21px 'Chakra Petch', sans-serif";
  ctx.fillText(title, WIDTH / 2, HEIGHT / 2 - 5);
  if (state.over) {
    ctx.fillStyle = "#eff2cd";
    ctx.font = "500 11px 'Be Vietnam Pro', sans-serif";
    ctx.fillText(`Điểm ${state.score}  ·  Kỷ lục ${record.bestScore}`, WIDTH / 2, HEIGHT / 2 + 18);
  }
}

function draw(timestamp = 0) {
  drawBackground();
  state.pipes.forEach(drawPipe);
  drawBird(timestamp);

  if (state.started && !state.paused && !state.over) {
    ctx.textAlign = "center";
    ctx.font = "600 27px 'Chakra Petch', sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(31, 74, 61, .7)";
    ctx.fillStyle = "#fffdf3";
    ctx.strokeText(String(state.score), WIDTH / 2, 52);
    ctx.fillText(String(state.score), WIDTH / 2, 52);
  }

  if (!state.started && !state.over) drawOverlay("Sẵn sàng");
  if (state.paused) drawOverlay("Tạm dừng");
  if (state.over) drawOverlay("Hết ván");

  flapButton.textContent = state.over ? "Chơi lại" : state.paused ? "Tiếp tục" : state.started ? "Vỗ cánh" : "Bắt đầu";
  pauseButton.textContent = state.paused ? "Tiếp tục" : "Tạm dừng";
  pauseButton.hidden = !state.started || state.paused || state.over;
  statusNode.textContent = state.over ? `Ván kết thúc. Điểm ${state.score}. Kỷ lục ${record.bestScore}.` : state.paused ? "Tạm dừng." : "";
  statusNode.classList.toggle("is-error", state.over);
}

function flap() {
  if (state.over) {
    state = newState();
    state.started = true;
    state.birdV = -4.5;
  } else if (state.paused) {
    state.paused = false;
    state.birdV = -4.5;
  } else if (!state.started) {
    state.started = true;
    state.birdV = -4.5;
  } else {
    state.birdV = -4.5;
  }
  persist();
  draw(lastFrame);
}

function togglePause() {
  if (!state.started || state.over) return;
  state.paused = !state.paused;
  persist();
  draw(lastFrame);
}

function collide() {
  const left = BIRD_X + 4;
  const right = BIRD_X + BIRD_W - 4;
  const top = state.birdY + 3;
  const bottom = state.birdY + BIRD_H - 3;
  if (top < 0 || bottom >= FLOOR) return true;
  return state.pipes.some((pipe) => right > pipe.x && left < pipe.x + PIPE_W && (top < pipe.gapY || bottom > pipe.gapY + PIPE_GAP));
}

function finish() {
  state.over = true;
  state.paused = false;
  persist();
  draw(lastFrame);
}

function update(delta) {
  const seconds = Math.min(delta / 1000, .04);
  state.birdV += 15.2 * seconds;
  state.birdY += state.birdV * seconds * 53;
  state.baseOffset -= PIPE_SPEED * seconds;
  if (state.baseOffset <= -336) state.baseOffset += 336;
  state.pipes.forEach((pipe) => { pipe.x -= PIPE_SPEED * seconds; });
  if (state.pipes.at(-1).x < WIDTH - 190) state.pipes.push(makePipe(state.pipes.at(-1).x + 190));
  state.pipes = state.pipes.filter((pipe) => pipe.x > -PIPE_W - 2);
  state.pipes.forEach((pipe) => {
    if (!pipe.scored && pipe.x + PIPE_W < BIRD_X) {
      pipe.scored = true;
      state.score++;
      record.bestScore = Math.max(record.bestScore, state.score);
      scoreNode.textContent = String(state.score);
    }
  });
  if (collide()) finish();
}

function frame(timestamp) {
  const delta = lastFrame ? Math.min(timestamp - lastFrame, 50) : 0;
  lastFrame = timestamp;
  if (state.started && !state.paused && !state.over) {
    update(delta);
    saveElapsed += delta;
    if (saveElapsed > 950) { persist(); saveElapsed = 0; }
  }
  draw(timestamp);
  requestAnimationFrame(frame);
}

canvas.addEventListener("pointerdown", (event) => { event.preventDefault(); flap(); });
flapButton.addEventListener("click", flap);
pauseButton.addEventListener("click", togglePause);
document.addEventListener("keydown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
  if (event.key === " " || event.key === "ArrowUp") { event.preventDefault(); flap(); }
  if (event.key.toLowerCase() === "p") togglePause();
});
window.addEventListener("pagehide", persist);

record.bestScore = Number(record.bestScore || 0);
persist();
draw();
requestAnimationFrame(frame);
