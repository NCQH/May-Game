// Shared, dependency-free engine; the browser adapter below is omitted by Node checks.
const COLS = 10, ROWS = 20, VERSION = 2, LOCK_DELAY = 500, MAX_RESETS = 15;
const STORAGE_KEY = "may-game:v1:tetris";
const COLORS = { I: "#52d7ed", O: "#f5d563", T: "#bc91f2", S: "#70d8a1", Z: "#f58091", J: "#769cf4", L: "#f5b16e" };
const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]], S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]], J: [[1,0,0],[1,1,1],[0,0,0]], L: [[0,0,1],[1,1,1],[0,0,0]]
};
const MODES = { marathon: "Marathon", sprint: "Sprint · 40 hàng", blitz: "Blitz · 120 giây" };
// SRS offsets use upward-positive Y; board coordinates are downward-positive.
const JLSTZ = {
  "0>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], "1>0": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "1>2": [[0,0],[1,0],[1,-1],[0,2],[1,2]], "2>1": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "2>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]], "3>2": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "3>0": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]], "0>3": [[0,0],[1,0],[1,1],[0,-2],[1,-2]]
};
const I_KICKS = {
  "0>1": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]], "1>0": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  "1>2": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]], "2>1": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
  "2>3": [[0,0],[2,0],[-1,0],[2,1],[-1,-2]], "3>2": [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  "3>0": [[0,0],[1,0],[-2,0],[1,-2],[-2,1]], "0>3": [[0,0],[-1,0],[2,0],[-1,2],[2,-1]]
};
const integer = (n, max = 1e12) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const isType = type => typeof type === "string" && Object.hasOwn(SHAPES, type);
function emptyBoard() { return Array.from({ length: ROWS }, () => Array(COLS).fill(null)); }
function matrix(type, rotation = 0) {
  let result = SHAPES[type];
  for (let i = 0; i < rotation; i++) result = result[0].map((_, x) => result.map(row => row[x]).reverse());
  return result;
}
function valid(s, p = s.active, dx = 0, dy = 0) {
  return !!p && matrix(p.type, p.rotation).every((row, y) => row.every((bit, x) => !bit ||
    (p.x + x + dx >= 0 && p.x + x + dx < COLS && p.y + y + dy < ROWS &&
      (p.y + y + dy < 0 || !s.board[p.y + y + dy][p.x + x + dx]))));
}
function fillQueue(s, random = Math.random) {
  while (s.queue.length < 3) {
    if (!s.bag.length) {
      s.bag = Object.keys(SHAPES);
      for (let i = 6; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]]; }
    }
    s.queue.push(s.bag.pop());
  }
}
function spawn(s, type) {
  fillQueue(s);
  s.active = { type: type || s.queue.shift(), rotation: 0, x: 3, y: -1 };
  if (s.active.type === "O") s.active.x = 4;
  fillQueue(s);
  s.lock = 0; s.resets = 0; s.gravity = 0; s.lastRotate = false; s.kick = 0;
  if (!valid(s)) finish(s, false);
}
function freshState(mode = "marathon") {
  const s = { mode, board: emptyBoard(), active: null, queue: [], bag: [], hold: null, holdUsed: false,
    score: 0, lines: 0, level: 1, elapsed: 0, over: false, won: false, paused: false,
    lock: 0, resets: 0, gravity: 0, combo: -1, b2b: false, lastRotate: false, kick: 0, message: "" };
  spawn(s); return s;
}
function finish(s, won) { s.over = true; s.won = won; s.active = null; }
function ghostY(s) { let y = s.active.y; while (valid(s, s.active, 0, y - s.active.y + 1)) y++; return y; }
function resetLock(s, grounded) { if (grounded && s.resets < MAX_RESETS) { s.lock = 0; s.resets++; } }
function move(s, dx, dy, soft = false) {
  if (s.paused || s.over || !valid(s, s.active, dx, dy)) return false;
  const grounded = !valid(s, s.active, 0, 1);
  s.active.x += dx; s.active.y += dy;
  if (dx) s.lastRotate = false;
  if (dx) resetLock(s, grounded);
  if (soft) s.score += dy;
  return true;
}
function rotate(s, direction = 1) {
  if (s.over || s.paused || s.active.type === "O") return false;
  const old = s.active, rotation = (old.rotation + direction + 4) % 4;
  const kicks = (old.type === "I" ? I_KICKS : JLSTZ)[`${old.rotation}>${rotation}`];
  const grounded = !valid(s, old, 0, 1);
  for (let i = 0; i < kicks.length; i++) {
    const [x, y] = kicks[i], candidate = { ...old, rotation, x: old.x + x, y: old.y - y };
    if (valid(s, candidate)) { s.active = candidate; s.lastRotate = true; s.kick = i; resetLock(s, grounded); return true; }
  }
  return false;
}
function spinType(s) {
  if (s.active.type !== "T" || !s.lastRotate) return "";
  const { x, y, rotation } = s.active;
  const occupied = (dx, dy) => x + dx < 0 || x + dx >= COLS || y + dy >= ROWS || (y + dy >= 0 && !!s.board[y + dy][x + dx]);
  const corners = [[0,0],[2,0],[2,2],[0,2]].map(([dx,dy]) => occupied(dx,dy));
  if (corners.filter(Boolean).length < 3) return "";
  return (corners[rotation] && corners[(rotation + 1) % 4]) || s.kick === 4 ? "full" : "mini";
}
function scoreClear(s, count, spin) {
  const difficult = count > 0 && (count === 4 || !!spin), backToBack = difficult && s.b2b;
  const base = spin === "full" ? [400,800,1200,1600][count] : spin === "mini" ? [100,200,400][count] : [0,100,300,500,800][count];
  let points = base * s.level;
  if (difficult && s.b2b) points *= 1.5;
  if (count) { s.combo++; points += 50 * s.combo * s.level; s.b2b = difficult; } else s.combo = -1;
  s.score += points; s.lines += count; s.level = 1 + Math.floor(s.lines / 10);
  s.message = `${spin ? `T-spin${spin === "mini" ? " mini" : ""} ` : ""}${count ? `${count} hàng` : ""}${backToBack ? " · B2B" : ""}${s.combo > 0 ? ` · Combo ${s.combo}` : ""}`.trim();
  return points;
}
function lockPiece(s) {
  const p = s.active, shape = matrix(p.type, p.rotation), spin = spinType(s);
  if (shape.some((row,y) => row.some(bit => bit && p.y + y < 0))) { finish(s, false); return { event: "over", rows: [] }; }
  shape.forEach((row,y) => row.forEach((bit,x) => { if (bit) s.board[p.y+y][p.x+x] = p.type; }));
  const rows = s.board.flatMap((row,y) => row.every(Boolean) ? [y] : []);
  s.board = s.board.filter(row => !row.every(Boolean));
  while (s.board.length < ROWS) s.board.unshift(Array(COLS).fill(null));
  scoreClear(s, rows.length, spin);
  if (s.mode === "sprint" && s.lines >= 40) finish(s, true);
  else { spawn(s); s.holdUsed = false; }
  return { event: s.over ? "over" : rows.length ? "clear" : "lock", rows };
}
function hardDrop(s) {
  if (s.over || s.paused) return false;
  const y = ghostY(s), distance = y - s.active.y;
  s.score += distance * 2; s.active.y = y;
  return lockPiece(s);
}
function holdPiece(s) {
  if (s.over || s.paused || s.holdUsed) return false;
  const type = s.active.type, held = s.hold;
  s.hold = type; spawn(s, held); s.holdUsed = true;
  return true;
}
function advance(s, delta) {
  if (s.paused || s.over) return false;
  if (s.mode === "blitz") delta = Math.min(delta, 120000 - s.elapsed);
  let result = false;
  // Small simulation steps prevent gravity or long frames from bypassing lock delay.
  while (delta > 0 && !s.over) {
    const grounded = !valid(s, s.active, 0, 1);
    const step = Math.min(delta, 10, grounded ? LOCK_DELAY - s.lock : Infinity);
    delta -= step; s.elapsed += step;
    if (grounded) {
      s.lock += step;
      if (s.lock >= LOCK_DELAY) result = lockPiece(s);
    } else {
      s.gravity += step;
      const interval = Math.max(60, 760 * Math.pow(.82, s.level - 1));
      if (s.gravity >= interval) { s.gravity -= interval; move(s, 0, 1); }
    }
  }
  if (!s.over && s.mode === "blitz" && s.elapsed >= 120000) { finish(s, true); return { event: "over", rows: result.rows || [] }; }
  return result;
}
function blankRecord() { return { version: VERSION, records: { marathon: 0, sprint: null, blitz: 0 }, muted: false, current: null }; }
function validState(s) {
  if (!s || typeof s.mode !== "string" || !Object.hasOwn(MODES, s.mode) || !Array.isArray(s.board) || s.board.length !== ROWS ||
    !s.board.every(row => Array.isArray(row) && row.length === COLS && row.includes(null) && row.every(cell => cell === null || isType(cell)))) return false;
  const types = list => Array.isArray(list) && list.every(isType);
  if (!types(s.queue) || s.queue.length !== 3 || !types(s.bag) || s.bag.length > 7 || new Set(s.bag).size !== s.bag.length ||
    !(s.hold === null || isType(s.hold))) return false;
  if (!["holdUsed","over","won","paused","b2b","lastRotate"].every(key => typeof s[key] === "boolean") || s.over || s.won) return false;
  if (!["score","lines","resets","kick"].every(key => integer(s[key])) ||
    !["elapsed","lock","gravity"].every(key => Number.isFinite(s[key]) && s[key] >= 0 && s[key] <= 1e12) ||
    s.lines > 100000 || s.level !== 1 + Math.floor(s.lines / 10) || s.lock > LOCK_DELAY || s.resets > MAX_RESETS || s.kick > 4 ||
    !Number.isInteger(s.combo) || s.combo < -1 || s.combo > s.lines || typeof s.message !== "string" || s.message.length > 100 ||
    (s.mode === "blitz" && s.elapsed >= 120000) || (s.mode === "sprint" && s.lines >= 40)) return false;
  const p = s.active;
  return !!p && isType(p.type) && integer(p.rotation,3) && Number.isInteger(p.x) && p.x >= -3 && p.x <= 9 &&
    Number.isInteger(p.y) && p.y >= -4 && p.y < ROWS && valid(s);
}
function readRecord(raw) {
  const result = blankRecord();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return result;
    if (data.version !== VERSION) { if (integer(data.bestScore)) result.records.marathon = data.bestScore; return result; }
    if (!data.records || !integer(data.records.marathon) || !integer(data.records.blitz) ||
      !(data.records.sprint === null || Number.isFinite(data.records.sprint) && data.records.sprint > 0 && data.records.sprint <= 1e12) || typeof data.muted !== "boolean") return result;
    result.records = { marathon: data.records.marathon, sprint: data.records.sprint, blitz: data.records.blitz };
    result.muted = data.muted;
    if (validState(data.current)) { result.current = data.current; result.current.paused = true; }
  } catch { /* Invalid or unavailable saves never enter the engine. */ }
  return result;
}
function updateRecord(record, s) {
  if (s.mode === "sprint") {
    if (s.won && s.elapsed > 0) record.records.sprint = Math.min(record.records.sprint ?? Infinity, s.elapsed);
  } else record.records[s.mode] = Math.max(record.records[s.mode], s.score);
  record.bestScore = Math.max(record.records.marathon, record.records.blitz);
}
function repeatInput(held, delta, action) {
  held.time += delta;
  while (held.time >= held.next) { action(held.action); held.next += held.action === "down" ? 35 : 40; }
}
if (typeof module !== "undefined") module.exports = { COLS, ROWS, SHAPES, JLSTZ, I_KICKS, matrix, valid, fillQueue, freshState, spawn, move, rotate, ghostY, spinType, scoreClear, lockPiece, hardDrop, holdPiece, advance, readRecord, validState, blankRecord, updateRecord, repeatInput };

if (typeof document !== "undefined") {
  const $ = selector => document.querySelector(selector);
  const canvas = $("#tetris-board"), ctx = canvas.getContext("2d"), cell = canvas.width / COLS;
  const previews = [$("#tetris-hold"), ...document.querySelectorAll(".next-piece")];
  let raw; try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
  const record = readRecord(raw);
  let state = record.current || freshState(), previous = null, audio, feedbackUntil = 0, feedbackRows = [];
  const held = new Map(), reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let choosing = true;
  state.paused = true;
  $("#continue-game").hidden = !record.current;
  function showGame() {
    choosing = false; $(".tetris-menu").hidden = true; $(".arcade-game-content").hidden = false;
    state.paused = false; previous = null; persist(); draw(); canvas.focus();
  }
  function showMenu() {
    $("#game-menu").close(); pause(true); choosing = true; $(".arcade-game-content").hidden = true; $(".tetris-menu").hidden = false;
    $("#continue-game").hidden = state.over;
    $(".tetris-menu button").focus();
  }
  document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
    if (record.current && !state.over && (state.score || state.board.some(row => row.some(Boolean))) && !confirm("Bắt đầu ván mới và bỏ tiến trình hiện tại?")) return;
    unlockAudio(); restart(button.dataset.mode); showGame();
  }));
  $("#continue-game").addEventListener("click", () => { unlockAudio(); showGame(); });
  $("#choose-mode").addEventListener("click", showMenu);
  function persist() {
    updateRecord(record, state);
    record.current = state.over ? null : state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Keep playing if storage is disabled or full. */ }
  }
  function unlockAudio() {
    if (record.muted) return;
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) { audio ||= new Audio(); audio.resume().catch(() => {}); } } catch { /* Audio is optional. */ }
  }
  async function sound(event) {
    if (record.muted || !audio) return;
    try { if (audio.state === "suspended") await audio.resume(); } catch { return; }
    if (record.muted || audio.state !== "running") return;
    const notes = { move: [160,.025], rotate: [320,.045], hold: [420,.06], lock: [100,.07], clear: [660,.13], over: [220,.18] };
    const [frequency, duration] = notes[event] || notes.lock;
    const oscillator = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
    oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (event === "clear" ? 1.8 : .6), now + duration);
    gain.gain.setValueAtTime(.18, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(now); oscillator.stop(now + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function resultEffect(result) {
    if (!result) return;
    sound(result.event);
    feedbackRows = result.rows; feedbackUntil = performance.now() + 180;
    if (state.over) clearInputs();
  }
  function act(action) {
    let success = false;
    if (action === "left" || action === "right" || action === "down") success = move(state, action === "left" ? -1 : action === "right" ? 1 : 0, action === "down" ? 1 : 0, action === "down");
    else if (action === "rotate" || action === "ccw") success = rotate(state, action === "ccw" ? -1 : 1);
    else if (action === "hold") success = holdPiece(state);
    else if (action === "drop") { const result = hardDrop(state); resultEffect(result); success = !!result; }
    if (success) { if (action !== "drop") sound(action === "hold" ? "hold" : action === "rotate" || action === "ccw" ? "rotate" : "move"); persist(); draw(); }
  }
  let gesture = null;
  function clearInputs() { gesture = null; held.clear(); document.querySelectorAll(".is-held").forEach(button => button.classList.remove("is-held")); }
  function pause(force = false) {
    clearInputs(); if (state.over) return;
    state.paused = force || !state.paused; previous = null; persist(); draw();
  }
  function begin(id, action) {
    if (state.over || state.paused || held.has(id)) return;
    act(action);
    if (["left","right","down"].includes(action) && !state.over) held.set(id, { action, time: 0, next: action === "down" ? 35 : 150 });
  }
  function paint(context, x, y, size, type, ghost = false) {
    if (ghost) { context.strokeStyle = COLORS[type]; context.lineWidth = 1.5; context.strokeRect(x + 3, y + 3, size - 6, size - 6); return; }
    context.fillStyle = COLORS[type]; context.fillRect(x + 1, y + 1, size - 2, size - 2);
    context.fillStyle = "rgba(255,255,255,.24)"; context.fillRect(x + 3, y + 3, size - 6, 2);
  }
  function time(ms) { return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,"0")}.${Math.floor(ms % 1000 / 100)}`; }
  function draw() {
    ctx.fillStyle = "#090f1b"; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle = "#172335"; ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*cell+.5,0); ctx.lineTo(x*cell+.5,canvas.height); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*cell+.5); ctx.lineTo(canvas.width,y*cell+.5); ctx.stroke(); }
    state.board.forEach((row,y) => row.forEach((type,x) => { if (type) paint(ctx,x*cell,y*cell,cell,type); }));
    if (state.active) {
      const p = state.active, ghost = ghostY(state);
      matrix(p.type,p.rotation).forEach((row,y) => row.forEach((bit,x) => {
        if (!bit) return;
        if (ghost+y >= 0 && ghost !== p.y) paint(ctx,(p.x+x)*cell,(ghost+y)*cell,cell,p.type,true);
        if (p.y+y >= 0) paint(ctx,(p.x+x)*cell,(p.y+y)*cell,cell,p.type);
      }));
    }
    const feedback = performance.now() < feedbackUntil;
    canvas.parentElement.classList.toggle("is-locking", feedback && !feedbackRows.length && !reducedMotion.matches);
    if (feedback && !reducedMotion.matches) { ctx.fillStyle = "rgba(235,245,255,.32)"; feedbackRows.forEach(y => ctx.fillRect(0,y*cell,canvas.width,cell)); }
    const overlay = $(".tetris-overlay");
    const justEnded = state.over && overlay.querySelector(".tetris-result-actions").hidden;
    overlay.hidden = !state.over && !state.paused;
    overlay.querySelector(".tetris-result-actions").hidden = !state.over;
    if (justEnded) $("#result-restart").focus({ preventScroll: true });
    overlay.querySelector("strong").textContent = state.over ? state.won ? "Hoàn thành!" : "Hết ván" : "Tạm dừng";
    overlay.querySelector("span").textContent = state.over ? `${state.score} điểm · ${time(state.elapsed)}` : "P hoặc chạm để tiếp tục";
    ["score","lines","level"].forEach(key => $("#"+key).textContent = state[key]);
    $(".tetris-page").dataset.mode = state.mode;
    $("#mode-name").textContent = { marathon: "Marathon", sprint: "Sprint", blitz: "Blitz" }[state.mode];
    $("#lines").textContent = state.mode === "sprint" ? `${state.lines} / 40` : String(state.lines);
    $("#timer").previousElementSibling.textContent = state.mode === "blitz" ? "Còn lại" : "Thời gian";
    $("#timer").textContent = time(state.mode === "blitz" ? Math.max(0,120000-state.elapsed) : state.elapsed);
    const best = record.records[state.mode];
    $("#record").textContent = state.mode === "sprint" ? best === null ? "—" : time(best) : String(best);
    $("#pause").textContent = state.paused ? "▶" : "Ⅱ";
    $("#pause").setAttribute("aria-label", state.paused ? "Tiếp tục" : "Tạm dừng");
    $("#pause").title = state.paused ? "Tiếp tục" : "Tạm dừng"; $("#pause").disabled = state.over;
    $("#hold").disabled = state.over || state.paused || state.holdUsed;
    $("#mute").textContent = record.muted ? "🔇 Âm thanh: Tắt" : "🔊 Âm thanh: Bật";
    $("#mute").setAttribute("aria-pressed", String(record.muted));
    const message = state.over ? `${state.won ? "Hoàn thành" : "Ván kết thúc"}. ${state.mode === "sprint" ? `${state.lines} / 40 hàng · ${time(state.elapsed)}` : `${state.score} điểm`}. Nhấn Chơi lại để bắt đầu ván mới.` : state.paused ? "Tạm dừng." : state.message;
    canvas.setAttribute("aria-label", `Bàn Tetris. ${message || "Đang chơi."} Mũi tên di chuyển, Z/X xoay, C giữ, Space thả, P tạm dừng.`);
    previews.forEach((preview,index) => {
      const type = index === 0 ? state.hold : state.queue[index-1];
      if (preview.dataset.type === (type || "")) return;
      preview.dataset.type = type || "";
      preview.setAttribute("aria-label", `${index === 0 ? "Khối giữ" : `Khối tiếp theo ${index}`}: ${type || "trống"}`);
      const context = preview.getContext("2d"); context.clearRect(0,0,preview.width,preview.height);
      if (!type) return;
      const shape = matrix(type), cells = shape.flatMap((row,y) => row.flatMap((bit,x) => bit ? [[x,y]] : []));
      const minX = Math.min(...cells.map(c=>c[0])), minY = Math.min(...cells.map(c=>c[1]));
      const width = Math.max(...cells.map(c=>c[0]))-minX+1, height = Math.max(...cells.map(c=>c[1]))-minY+1;
      const size = Math.min(16,preview.width/(width+1),preview.height/(height+1));
      cells.forEach(([x,y]) => paint(context,(preview.width-width*size)/2+(x-minX)*size,(preview.height-height*size)/2+(y-minY)*size,size,type));
    });
  }
  const keys = { ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "rotate", x: "rotate", z: "ccw", c: "hold", " ": "drop" };
  document.addEventListener("keydown", event => {
    if ($("#game-menu").open || choosing || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input,textarea,select,[contenteditable],a") || (event.target.closest("button") && [" ","Enter"].includes(event.key))) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (!keys[key] && !["p","r","m"].includes(key)) return;
    event.preventDefault(); unlockAudio(); if (event.repeat) return;
    if (key === "p") pause();
    else if (key === "r") requestRestart();
    else if (key === "m") toggleMute();
    else begin(`key:${key}`,keys[key]);
  });
  document.addEventListener("keyup", event => { const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; held.delete(`key:${key}`); });
  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault(); unlockAudio(); button.setPointerCapture(event.pointerId); button.classList.add("is-held"); begin(`pointer:${event.pointerId}`,button.dataset.action);
    });
    const release = event => { held.delete(`pointer:${event.pointerId}`); button.classList.remove("is-held"); };
    ["pointerup","pointercancel","lostpointercapture"].forEach(name => button.addEventListener(name,release));
    button.addEventListener("click", event => { if (event.detail === 0) { unlockAudio(); act(button.dataset.action); } });
  });
  document.addEventListener("game-menu-open", () => pause(true));
  $("#pause").addEventListener("click", () => { unlockAudio(); pause(); });
  function restart(mode = state.mode) { clearInputs(); state = freshState(mode); previous = null; feedbackUntil = 0; persist(); draw(); }
  function requestRestart() {
    if (state.over || !(state.score || state.board.some(row => row.some(Boolean))) || confirm("Bắt đầu ván mới và bỏ tiến trình hiện tại?")) restart();
  }
  $("#restart").addEventListener("click", () => { unlockAudio(); requestRestart(); if ($("#game-menu").open) pause(true); });
  $("#result-restart").addEventListener("click", () => { unlockAudio(); restart(); canvas.focus(); });
  $("#result-mode").addEventListener("click", showMenu);
  function toggleMute() { record.muted = !record.muted; if (record.muted) audio?.suspend().catch(() => {}); else { unlockAudio(); void sound("rotate"); } persist(); draw(); }
  $("#mute").addEventListener("click", toggleMute);
  canvas.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || gesture || state.over) return;
    event.preventDefault(); unlockAudio(); if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      time: event.timeStamp, piece: state.active, moved: false, soft: false, resume: state.paused };
  });
  canvas.addEventListener("pointermove", event => {
    const g = gesture;
    if (!g || g.id !== event.pointerId || g.resume || g.piece !== state.active) return;
    const step = canvas.getBoundingClientRect().width / COLS;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > 10) g.moved = true;
    if (Math.abs(dx) >= step && Math.abs(dx) > Math.abs(dy)) {
      const count = Math.min(COLS, Math.floor(Math.abs(dx) / step));
      for (let i = 0; i < count; i++) act(dx > 0 ? "right" : "left");
      g.x += Math.sign(dx) * count * step;
    }
    if (dy >= step && event.timeStamp - g.time >= 220) {
      g.soft = true;
      const count = Math.min(ROWS, Math.floor(dy / step));
      for (let i = 0; i < count; i++) act("down");
      g.y += count * step;
    }
  });
  canvas.addEventListener("pointerup", event => {
    const g = gesture;
    if (!g || g.id !== event.pointerId) return;
    gesture = null;
    if (g.piece !== state.active || state.over) return;
    if (g.resume) { if (state.paused) pause(); return; }
    const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
    if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) act("hold");
      else if (!g.soft && event.timeStamp - g.time < 220) act("drop");
      else if (!g.soft) act("down");
    } else if (!g.moved && Math.hypot(dx,dy) <= 10) {
      const rect = canvas.getBoundingClientRect();
      act(event.clientX < rect.left + rect.width / 2 ? "ccw" : "rotate");
    }
  });
  for (const name of ["pointercancel","lostpointercapture"]) canvas.addEventListener(name, () => { gesture = null; });
  window.addEventListener("blur", () => pause(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
  window.addEventListener("pagehide", () => { pause(true); persist(); });
  let lastSave = 0;
  function frame(timestamp) {
    const delta = previous === null ? 0 : Math.max(0,timestamp-previous); previous = timestamp;
    if (!state.paused && !state.over) {
      const result = advance(state,delta); resultEffect(result);
      if (!state.over) for (const input of held.values()) repeatInput(input,Math.min(delta,250),act);
      if (result || timestamp-lastSave >= 1000) { persist(); lastSave = timestamp; }
    }
    draw(); requestAnimationFrame(frame);
  }
  persist(); draw(); requestAnimationFrame(frame);
}
