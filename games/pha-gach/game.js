// Shared, dependency-free engine; the browser adapter below is skipped by Node checks.
const VERSION = 1, STORAGE_ID = "pha-gach";
const W = 480, H = 640, COLS = 12, ROWS = 10, BRICK_W = 36, BRICK_H = 18, BRICK_LEFT = 24, BRICK_TOP = 64;
const BALL_R = 6, PADDLE_Y = 596, PADDLE_H = 14, PADDLE_W = 80, WIDE_W = 124, PADDLE_SPEED = 560;
const DT = 1 / 120, BASE_SPEED = 330, SPEED_STEP = .07, MAX_SPEED = 640, MAX_ANGLE = Math.PI / 3;
const START_LIVES = 3, MAX_LIVES = 5, WIDE_TIME = 12, DROP_CHANCE = .15, DROP_SPEED = 150, DROP_W = 34, DROP_H = 14, MAX_DROPS = 3;
// Brick codes: 0 empty, 1 normal, 2 strong, 3 strong cracked, 4 unbreakable.
const EMPTY = 0, NORMAL = 1, STRONG = 2, CRACKED = 3, STEEL = 4;
const CHAR = { ".": EMPTY, "1": NORMAL, "2": STRONG, "#": STEEL };
const LEVELS = [
  { name: "Tường gạch", map: ["", "", "222222222222", "111111111111", "111111111111", "111111111111", "111111111111"] },
  { name: "Kim tự tháp", map: ["", ".....11.....", "....1111....", "...112211...", "..11111111..", ".1112222111.", "111111111111"] },
  { name: "Cột thép", map: ["", "111111111111", "#1111..1111#", "#1222..2221#", "#1111..1111#", "#....11....#", "111111111111"] },
  { name: "Viên kim cương", map: [".....22.....", "....2112....", "...211112...", "..21111112..", "...211112...", "....2112....", ".....22.....", "", "##..####..##"] },
  { name: "Hai cánh", map: ["1..........1", "11........11", "121......121", "1221....1221", "12221..12221", "122221122221", "", "..########.."] },
  { name: "Người ngoài hành tinh", map: ["..1......1..", "...1....1...", "..22222222..", ".22#1221#22.", "222222222222", "2.22222222.2", "2.2......2.2", "...11..11..."] },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const loopOf = (level) => Math.floor((level - 1) / LEVELS.length) + 1;
function levelBricks(level) {
  const { map } = LEVELS[(level - 1) % LEVELS.length];
  const bricks = new Array(COLS * ROWS).fill(EMPTY);
  map.forEach((row, y) => [...row].forEach((ch, x) => { bricks[y * COLS + x] = CHAR[ch] ?? EMPTY; }));
  return bricks;
}
const remaining = (bricks) => bricks.filter((code) => code >= NORMAL && code <= CRACKED).length;
function speedFor(level) { return Math.min(MAX_SPEED, BASE_SPEED * (1 + SPEED_STEP * (level - 1))); }
function brickRect(index) {
  const x = index % COLS, y = Math.floor(index / COLS);
  return { left: BRICK_LEFT + x * BRICK_W, top: BRICK_TOP + y * BRICK_H, right: BRICK_LEFT + (x + 1) * BRICK_W, bottom: BRICK_TOP + (y + 1) * BRICK_H };
}

function freshState(level = 1) {
  const s = { level, score: 0, lives: START_LIVES, bricks: levelBricks(level), paddle: { x: W / 2, w: PADDLE_W },
    ball: { x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, stuck: true }, drops: [], wideTime: 0, phase: "ready" };
  return s;
}
function stick(s) { s.ball.stuck = true; s.ball.vx = s.ball.vy = 0; s.ball.x = s.paddle.x; s.ball.y = PADDLE_Y - BALL_R; }
function setPaddle(s, x) {
  s.paddle.x = clamp(x, s.paddle.w / 2, W - s.paddle.w / 2);
  if (s.ball.stuck) stick(s);
}
// Offset -1 (left edge) … 1 (right edge) maps to at most MAX_ANGLE from vertical, always upwards.
function bounceVelocity(offset, speed) {
  const angle = clamp(Number.isFinite(offset) ? offset : 0, -1, 1) * MAX_ANGLE;
  return [speed * Math.sin(angle), -speed * Math.cos(angle)];
}
function launch(s) {
  if (s.phase !== "playing" || !s.ball.stuck) return false;
  // Lean towards the open middle of the field.
  [s.ball.vx, s.ball.vy] = bounceVelocity(s.paddle.x <= W / 2 ? .35 : -.35, speedFor(s.level));
  s.ball.stuck = false;
  return true;
}
// Keep the ball out of near-horizontal paths after corner hits.
function limitAngle(b) {
  const speed = Math.hypot(b.vx, b.vy) || 1, minVy = speed * Math.cos(MAX_ANGLE);
  if (Math.abs(b.vy) >= minVy) return;
  b.vy = (b.vy > 0 ? 1 : -1) * minVy;
  b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - minVy * minVy);
}
function resetPower(s) { s.drops = []; s.wideTime = 0; s.paddle.w = PADDLE_W; setPaddle(s, s.paddle.x); }
function loseLife(s, events) {
  s.lives -= 1;
  resetPower(s);
  if (s.lives <= 0) { s.lives = 0; s.phase = "over"; events.push("over"); return; }
  stick(s);
  events.push("lost");
}
function applyPower(s, type) {
  if (type === "wide") { s.wideTime = WIDE_TIME; s.paddle.w = WIDE_W; setPaddle(s, s.paddle.x); return "power-wide"; }
  s.lives = Math.min(MAX_LIVES, s.lives + 1);
  return "power-life";
}
function hitBrick(s, index, events, random) {
  const code = s.bricks[index];
  if (code === STEEL) { events.push("steel"); return; }
  const loop = loopOf(s.level);
  if (code === STRONG) { s.bricks[index] = CRACKED; s.score += 5 * loop; events.push("crack"); return; }
  s.bricks[index] = EMPTY;
  s.score += (code === CRACKED ? 20 : 10) * loop;
  events.push("brick");
  if (!remaining(s.bricks)) { s.score += 100 * loop; s.phase = "cleared"; s.drops = []; events.push("clear"); return; }
  if (s.drops.length < MAX_DROPS && random() < DROP_CHANCE) {
    const r = brickRect(index);
    s.drops.push({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, type: random() < .5 ? "wide" : "life" });
    events.push("drop");
  }
}
// Deepest overlapping brick around the ball, with the push-out normal.
function brickContact(s) {
  const b = s.ball;
  const x0 = Math.floor((b.x - BALL_R - BRICK_LEFT) / BRICK_W), x1 = Math.floor((b.x + BALL_R - BRICK_LEFT) / BRICK_W);
  const y0 = Math.floor((b.y - BALL_R - BRICK_TOP) / BRICK_H), y1 = Math.floor((b.y + BALL_R - BRICK_TOP) / BRICK_H);
  let best = null;
  for (let y = Math.max(0, y0); y <= Math.min(ROWS - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(COLS - 1, x1); x++) {
    const index = y * COLS + x;
    if (!s.bricks[index]) continue;
    const r = brickRect(index);
    const cx = clamp(b.x, r.left, r.right), cy = clamp(b.y, r.top, r.bottom);
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
    if (d >= BALL_R) continue;
    let nx, ny, depth;
    if (d > 1e-9) { nx = dx / d; ny = dy / d; depth = BALL_R - d; }
    else {
      // Centre inside the brick: leave along the shallowest side.
      const sides = [[-1, 0, b.x - r.left], [1, 0, r.right - b.x], [0, -1, b.y - r.top], [0, 1, r.bottom - b.y]].sort((a, c) => a[2] - c[2]);
      [nx, ny] = sides[0]; depth = sides[0][2] + BALL_R;
    }
    if (!best || depth > best.depth) best = { index, nx, ny, depth };
  }
  return best;
}
function moveBall(s, h, events, random) {
  const b = s.ball;
  b.x += b.vx * h; b.y += b.vy * h;
  if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); events.push("wall"); }
  if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); events.push("wall"); }
  if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); events.push("wall"); }
  const hit = brickContact(s);
  if (hit) {
    b.x += hit.nx * hit.depth; b.y += hit.ny * hit.depth;
    const dot = b.vx * hit.nx + b.vy * hit.ny;
    if (dot < 0) { b.vx -= 2 * dot * hit.nx; b.vy -= 2 * dot * hit.ny; }
    limitAngle(b);
    hitBrick(s, hit.index, events, random);
    if (s.phase !== "playing") return;
  }
  const p = s.paddle, left = p.x - p.w / 2, right = p.x + p.w / 2;
  if (b.vy > 0 && b.y <= PADDLE_Y + PADDLE_H / 2) {
    const cx = clamp(b.x, left, right), cy = clamp(b.y, PADDLE_Y, PADDLE_Y + PADDLE_H);
    if (Math.hypot(b.x - cx, b.y - cy) < BALL_R) {
      [b.vx, b.vy] = bounceVelocity((b.x - p.x) / (p.w / 2 + BALL_R), speedFor(s.level));
      b.y = PADDLE_Y - BALL_R;
      events.push("paddle");
    }
  }
  if (b.y - BALL_R > H) loseLife(s, events);
}
// One fixed simulation step; dir is -1/0/1 from held keys or buttons.
function step(s, dir = 0, random = Math.random) {
  const events = [];
  if (s.phase !== "playing") return events;
  if (dir) setPaddle(s, s.paddle.x + clamp(dir, -1, 1) * PADDLE_SPEED * DT);
  if (s.wideTime > 0) {
    s.wideTime = Math.max(0, s.wideTime - DT);
    if (!s.wideTime) { s.paddle.w = PADDLE_W; setPaddle(s, s.paddle.x); events.push("wide-end"); }
  }
  const p = s.paddle;
  s.drops = s.drops.filter((d) => {
    d.y += DROP_SPEED * DT;
    if (d.y + DROP_H / 2 >= PADDLE_Y && d.y - DROP_H / 2 <= PADDLE_Y + PADDLE_H && Math.abs(d.x - p.x) <= (p.w + DROP_W) / 2) {
      events.push(applyPower(s, d.type));
      return false;
    }
    return d.y - DROP_H / 2 <= H;
  });
  const b = s.ball;
  if (b.stuck) { stick(s); return events; }
  // Substeps never move the ball more than half its radius, so it cannot skip a brick or the paddle.
  const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * DT / (BALL_R * .5)));
  for (let i = 0; i < n && s.phase === "playing" && !b.stuck; i++) moveBall(s, DT / n, events, random);
  return events;
}
function nextLevel(s) {
  s.level += 1;
  s.bricks = levelBricks(s.level);
  resetPower(s);
  setPaddle(s, W / 2);
  stick(s);
  s.phase = "playing";
}

// Saved runs keep only progress; the ball is re-stuck to a centred paddle on resume.
function toCurrent(s) {
  if (s.phase === "cleared") return { level: s.level + 1, score: s.score, lives: s.lives, bricks: levelBricks(s.level + 1), phase: "paused" };
  if (!["playing", "paused"].includes(s.phase)) return null;
  return { level: s.level, score: s.score, lives: s.lives, bricks: [...s.bricks], phase: "paused" };
}
function validCurrent(c) {
  if (!c || typeof c !== "object" || Array.isArray(c) || c.phase !== "paused") return false;
  if (!Number.isSafeInteger(c.level) || c.level < 1 || c.level > 999) return false;
  if (!Number.isSafeInteger(c.score) || c.score < 0 || c.score > 1e9) return false;
  if (!Number.isSafeInteger(c.lives) || c.lives < 1 || c.lives > MAX_LIVES) return false;
  if (!Array.isArray(c.bricks) || c.bricks.length !== COLS * ROWS) return false;
  const template = levelBricks(c.level);
  const allowed = { [EMPTY]: [EMPTY], [NORMAL]: [EMPTY, NORMAL], [STRONG]: [EMPTY, STRONG, CRACKED], [STEEL]: [STEEL] };
  if (!c.bricks.every((code, i) => Number.isInteger(code) && allowed[template[i]].includes(code))) return false;
  return remaining(c.bricks) > 0;
}
function fromCurrent(c) {
  const s = freshState(c.level);
  Object.assign(s, { score: c.score, lives: c.lives, bricks: [...c.bricks], phase: "paused" });
  return s;
}

if (typeof module !== "undefined") module.exports = { W, H, COLS, ROWS, BRICK_W, BRICK_H, BRICK_LEFT, BRICK_TOP, BALL_R, PADDLE_Y, PADDLE_H,
  PADDLE_W, WIDE_W, DT, MAX_SPEED, MAX_ANGLE, START_LIVES, MAX_LIVES, WIDE_TIME, EMPTY, NORMAL, STRONG, CRACKED, STEEL, LEVELS,
  levelBricks, remaining, speedFor, brickRect, freshState, setPaddle, bounceVelocity, launch, step, nextLevel, applyPower,
  toCurrent, validCurrent, fromCurrent };

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const canvas = document.querySelector("#pha-gach-board");
  const ctx = canvas.getContext("2d");
  const overlay = document.querySelector("#pha-gach-overlay");
  const overlayTitle = overlay.querySelector("h2");
  const overlayText = overlay.querySelector("p");
  const overlayActions = overlay.querySelector(".play-overlay-actions");
  const primary = document.querySelector("#pha-gach-primary");
  const labels = { score: document.querySelector("#score"), lives: document.querySelector("#lives"), level: document.querySelector("#level"), best: document.querySelector("#best") };
  const muteToggle = document.querySelector("#mute");
  const menu = document.querySelector("#game-menu");
  const announce = createAnnouncer(document.querySelector("#pha-gach-status"));
  const saved = store.read();
  let record = { version: VERSION, bestScore: Number.isSafeInteger(saved?.bestScore) && saved.bestScore >= 0 ? saved.bestScore : 0,
    muted: saved?.muted === true, current: null };
  const tone = createTone(() => record.muted);
  let state = validCurrent(saved?.current) ? fromCurrent(saved.current) : freshState();
  let last = 0, carry = 0, running = false, clearTimer = 0;
  const held = { key: { left: false, right: false }, button: { left: false, right: false } };
  const number = (value) => value.toLocaleString("vi-VN");
  const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const persist = () => { record.current = toCurrent(state); store.write(record); };
  function syncLabels() {
    if (state.score > record.bestScore) record.bestScore = state.score;
    labels.score.textContent = number(state.score);
    labels.lives.textContent = String(state.lives);
    labels.level.textContent = String(state.level);
    labels.best.textContent = number(record.bestScore);
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
  }
  function showOverlay() {
    const name = LEVELS[(state.level - 1) % LEVELS.length].name;
    const texts = {
      ready: ["Sẵn sàng", finePointer() ? "Rê chuột hoặc giữ ← → để đỡ bóng." : "Kéo trên sân hoặc giữ ◀\u00a0▶ để đỡ bóng.", "Bắt đầu"],
      paused: ["Tạm dừng", `Màn ${state.level}: ${name}. Ván đã được lưu.`, "Tiếp tục"],
      cleared: [`Qua màn ${state.level}`, `Sang màn ${state.level + 1}…`, null],
      over: ["Hết ván", `Bạn được ${number(state.score)} điểm.`, "Chơi lại"],
    }[state.phase];
    overlay.hidden = !texts;
    if (!texts) return;
    [overlayTitle.textContent, overlayText.textContent] = texts;
    overlayActions.hidden = !texts[2];
    if (texts[2]) primary.textContent = texts[2];
  }

  const ROW_COLORS = ["#ee886b", "#e9a86a", "#e0c86e", "#c7e875", "#9fd88a", "#79c9c4", "#8fb4d8", "#ee886b", "#e9a86a", "#e0c86e"];
  function drawBrick(index, code) {
    const r = brickRect(index), x = r.left + 1, y = r.top + 1, w = BRICK_W - 2, h = BRICK_H - 2;
    if (code === STEEL) {
      ctx.fillStyle = "#6b7768"; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#4d584c"; ctx.fillRect(x, y + h - 3, w, 3);
      ctx.strokeStyle = "#859281"; ctx.lineWidth = 1.5;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h - 3); ctx.clip();
      ctx.beginPath(); for (let k = -h; k < w; k += 8) { ctx.moveTo(x + k, y + h - 3); ctx.lineTo(x + k + h - 3, y); } ctx.stroke(); ctx.restore();
      ctx.fillStyle = "#c4cbbb"; ctx.fillRect(x + 3, y + 3, 2, 2); ctx.fillRect(x + w - 5, y + 3, 2, 2);
      return;
    }
    const color = ROW_COLORS[Math.floor(index / COLS)];
    if (code === NORMAL) {
      ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fillRect(x, y + h - 3, w, 3);
      return;
    }
    // Strong bricks: sand body with a dark inner frame; cracked ones darken and show a crack.
    ctx.fillStyle = code === STRONG ? "#e0e8bd" : "#b9bf97"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#3b4a33"; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    if (code === CRACKED) {
      ctx.strokeStyle = "#22301f"; ctx.lineWidth = 1.6; ctx.beginPath();
      ctx.moveTo(x + 6, y); ctx.lineTo(x + 13, y + 7); ctx.lineTo(x + 10, y + 11); ctx.lineTo(x + 19, y + h);
      ctx.moveTo(x + 13, y + 7); ctx.lineTo(x + 24, y + 5); ctx.lineTo(x + 30, y + 10);
      ctx.stroke();
    }
  }
  function draw() {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return;
    const ratio = window.devicePixelRatio || 1;
    const pw = Math.max(120, Math.round(box.width * ratio)), ph = Math.round(pw * H / W);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
    ctx.fillStyle = "#13221a"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(121,201,196,.06)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let gx = 40; gx < W; gx += 40) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (let gy = 40; gy < H; gy += 40) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();
    state.bricks.forEach((code, index) => { if (code) drawBrick(index, code); });
    ctx.font = "700 11px 'Chakra Petch', 'Be Vietnam Pro', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const d of state.drops) {
      ctx.fillStyle = d.type === "wide" ? "#79c9c4" : "#ee886b";
      ctx.fillRect(d.x - DROP_W / 2, d.y - DROP_H / 2, DROP_W, DROP_H);
      ctx.fillStyle = "#13221a"; ctx.fillText(d.type === "wide" ? "DÀI" : "+1", d.x, d.y + .5);
    }
    const p = state.paddle, left = p.x - p.w / 2;
    ctx.fillStyle = state.wideTime ? "#79c9c4" : "#c7e875"; ctx.fillRect(left, PADDLE_Y, p.w, PADDLE_H);
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(left, PADDLE_Y, p.w, 3);
    ctx.fillStyle = "#596a38"; ctx.fillRect(left, PADDLE_Y, 6, PADDLE_H); ctx.fillRect(left + p.w - 6, PADDLE_Y, 6, PADDLE_H);
    if (state.wideTime) { ctx.fillStyle = "#79c9c4"; ctx.fillRect(left, PADDLE_Y + PADDLE_H + 5, p.w * state.wideTime / WIDE_TIME, 3); }
    ctx.fillStyle = "#eff2cd"; ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
    if (state.phase === "playing" && state.ball.stuck) {
      ctx.fillStyle = "#abb99a"; ctx.font = "600 20px 'Be Vietnam Pro', system-ui, sans-serif";
      ctx.fillText(finePointer() ? "Space hoặc nhấp để phóng bóng" : "Chạm sân để phóng bóng", W / 2, PADDLE_Y - 60);
    }
  }
  function render() { syncLabels(); showOverlay(); draw(); }

  const SOUNDS = {
    paddle: [[392, 0, .05]], wall: [[294, 0, .03, "triangle"]], brick: [[660, 0, .05]], crack: [[520, 0, .05]], steel: [[220, 0, .06, "triangle"]],
    drop: [[740, 0, .04, "triangle"]], "power-wide": [[660, 0, .06], [990, .06, .08]], "power-life": [[784, 0, .06], [1046, .06, .1]],
    lost: [[260, 0, .1], [196, .1, .18]], over: [[220, 0, .12], [165, .12, .24]], clear: [[523, 0, .08], [659, .08, .08], [784, .16, .16]],
  };
  function start() {
    tone.unlock();
    clearTimeout(clearTimer);
    if (state.phase === "over") state = freshState();
    if (state.phase === "cleared") nextLevel(state);
    const wasReady = state.phase === "ready";
    state.phase = "playing";
    launch(state);
    render(); persist();
    canvas.focus({ preventScroll: true });
    last = 0; carry = 0;
    announce(wasReady ? `Bắt đầu màn ${state.level}.` : "Chơi tiếp.");
    loopStart();
  }
  function loopStart() { if (running) return; running = true; last = 0; carry = 0; requestAnimationFrame(loop); }
  function pause() {
    held.key.left = held.key.right = held.button.left = held.button.right = false;
    if (state.phase !== "playing") return;
    state.phase = "paused";
    render(); persist();
    announce("Đã tạm dừng.");
  }
  function handle(events) {
    let important = false;
    const seen = new Set(events);
    for (const event of seen) if (SOUNDS[event]) tone.play(SOUNDS[event]);
    if (seen.has("brick") || seen.has("crack") || seen.has("power-life") || seen.has("power-wide") || seen.has("lost")) important = true;
    if (seen.has("power-wide")) announce("Thanh đỡ dài ra trong 12 giây.");
    if (seen.has("power-life")) announce(`Thêm một mạng, còn ${state.lives} mạng.`);
    if (seen.has("wide-end")) announce("Thanh đỡ trở lại bình thường.");
    if (seen.has("lost")) announce(`Mất một mạng, còn ${state.lives} mạng.`);
    if (seen.has("over")) { announce(`Hết ván với ${state.score} điểm.`); render(); persist(); return; }
    if (seen.has("clear")) {
      announce(`Qua màn ${state.level}.`);
      render(); persist();
      clearTimer = setTimeout(() => {
        if (state.phase !== "cleared") return;
        nextLevel(state);
        if (menu.open || document.hidden) state.phase = "paused";
        else announce(`Màn ${state.level}. Nhấn Space hoặc chạm sân để phóng bóng.`);
        render(); persist(); loopStart();
      }, 1400);
      return;
    }
    if (important) { syncLabels(); persist(); }
  }
  function direction() {
    return ((held.key.right || held.button.right) ? 1 : 0) - ((held.key.left || held.button.left) ? 1 : 0);
  }
  function loop(time) {
    if (state.phase !== "playing") { running = false; draw(); return; }
    if (last) carry = Math.min(carry + (time - last) / 1000, .25);
    last = time;
    while (state.phase === "playing" && carry >= DT) {
      carry -= DT;
      const events = step(state, direction());
      if (events.length) handle(events);
    }
    draw();
    if (state.phase !== "playing") { running = false; return; }
    requestAnimationFrame(loop);
  }
  function fire() {
    if (state.phase === "playing") { if (launch(state)) { tone.unlock(); announce("Đã phóng bóng."); draw(); } }
    else if (state.phase !== "cleared") start();
  }

  primary.addEventListener("click", start);
  overlay.addEventListener("click", (event) => { if (event.target === overlay && state.phase === "paused") start(); });
  document.querySelector("#new-game").addEventListener("click", () => {
    clearTimeout(clearTimer);
    state = freshState();
    persist();
    menu.close();
    render();
    canvas.focus({ preventScroll: true });
  });
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; persist(); syncLabels(); });

  const keys = { ArrowLeft: "left", ArrowRight: "right", a: "left", d: "right" };
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const onControl = event.target instanceof Element && event.target.closest("button, a, input, select, textarea");
    if (keys[key]) { event.preventDefault(); held.key[keys[key]] = true; }
    else if (key === "p") { event.preventDefault(); state.phase === "playing" ? pause() : state.phase === "paused" && start(); }
    else if (key === "m") { muteToggle.click(); }
    else if (key === " " && !onControl) { event.preventDefault(); if (!event.repeat) fire(); }
    else if (key === "Enter" && event.target === canvas) { event.preventDefault(); fire(); }
  });
  document.addEventListener("keyup", (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (keys[key]) held.key[keys[key]] = false;
  });
  window.addEventListener("blur", () => { held.key.left = held.key.right = held.button.left = held.button.right = false; });

  // Pointer: the paddle centre follows the pointer x; a short tap launches the ball.
  const toField = (event) => { const box = canvas.getBoundingClientRect(); return (event.clientX - box.left) / box.width * W; };
  let drag = null;
  function follow(event) { if (state.phase === "playing") { setPaddle(state, toField(event)); if (!running) draw(); } }
  canvas.addEventListener("pointerdown", (event) => {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), moved: false };
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    follow(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (drag && drag.id === event.pointerId) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 12) drag.moved = true;
      follow(event);
    } else if (event.pointerType === "mouse") follow(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const tap = !drag.moved && performance.now() - drag.t < 400;
    drag = null;
    if (tap) fire();
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });

  document.querySelectorAll(".pha-gach-move [data-move]").forEach((button) => {
    const side = button.dataset.move;
    const release = () => { held.button[side] = false; };
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      held.button[side] = true;
      try { button.setPointerCapture(event.pointerId); } catch {}
      if (state.phase === "ready" || state.phase === "paused") start();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
    button.addEventListener("click", (event) => {
      if (event.detail !== 0 || menu.open || state.phase === "over" || state.phase === "cleared") return;
      if (state.phase !== "playing") start();
      // Native keyboard and assistive clicks have no pointer hold: move one step instead.
      setPaddle(state, state.paddle.x + (side === "left" ? -32 : 32));
      draw();
    });
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });

  document.addEventListener("game-menu-open", pause);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("pagehide", persist);
  new ResizeObserver(draw).observe(canvas);
  // Read-only hook for browser checks.
  globalThis.PhaGach = { get state() { return state; } };
  render();
}
