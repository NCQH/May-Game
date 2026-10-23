// Dò mìn: pure engine first (Node checks require it), browser adapter below.
const VERSION = 1, STORAGE_ID = "do-min", HOLD_MS = 400, MAX_ELAPSED = 100 * 3600 * 1000;
const LEVELS = {
  easy: { name: "Dễ", cols: 9, rows: 9, mines: 10 },
  medium: { name: "Vừa", cols: 16, rows: 16, mines: 40 },
  hard: { name: "Khó", cols: 30, rows: 16, mines: 99 },
};
const NONE = Object.freeze({ type: "none", opened: 0 });

// Khó is 30×16; a portrait stage (width/height < 1) gets the board standing up, 16×30.
function shapeFor(level, aspect = 1) {
  const { cols, rows } = LEVELS[level];
  return level === "hard" && aspect < 1 ? { cols: rows, rows: cols } : { cols, rows };
}
function freshState(level = "easy", aspect = 1) {
  if (!Object.hasOwn(LEVELS, level)) level = "easy";
  const { cols, rows } = shapeFor(level, aspect), n = cols * rows;
  return { level, cols, rows, mines: null, mineAt: new Array(n).fill(0), revealed: new Array(n).fill(0),
    flags: new Array(n).fill(0), elapsed: 0, phase: "ready", exploded: -1 };
}
function neighbours(s, i) {
  const x = i % s.cols, y = (i - x) / s.cols, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && nx >= 0 && ny >= 0 && nx < s.cols && ny < s.rows) out.push(ny * s.cols + nx);
  }
  return out;
}
function setMines(s, list) {
  s.mines = [...list].sort((a, b) => a - b);
  s.mineAt = new Array(s.cols * s.rows).fill(0);
  for (const i of s.mines) s.mineAt[i] = 1;
}
// Mines are laid on the first reveal, never on that cell or its neighbours, so it always opens an area.
function placeMines(s, safe, random = Math.random) {
  const n = s.cols * s.rows, count = LEVELS[s.level].mines;
  const banned = new Set([safe, ...neighbours(s, safe)]);
  let pool = [];
  for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
  if (pool.length < count) pool = [...Array(n).keys()].filter((i) => i !== safe);
  for (let k = 0; k < count; k++) {
    const j = k + Math.min(pool.length - k - 1, Math.floor(random() * (pool.length - k)));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  setMines(s, pool.slice(0, count));
}
const adjacent = (s, i) => neighbours(s, i).reduce((total, j) => total + s.mineAt[j], 0);
const total = (list) => list.reduce((sum, v) => sum + v, 0);
const minesLeft = (s) => LEVELS[s.level].mines - total(s.flags);
const safeLeft = (s) => s.cols * s.rows - LEVELS[s.level].mines - total(s.revealed);
const playable = (s) => s.phase === "ready" || s.phase === "playing";
const inside = (s, i) => Number.isInteger(i) && i >= 0 && i < s.cols * s.rows;

// Flood-fill from a safe cell; cells next to a zero are safe, so stray flags there are cleared.
function open(s, start) {
  const stack = [start];
  let opened = 0;
  while (stack.length) {
    const i = stack.pop();
    if (s.revealed[i]) continue;
    s.revealed[i] = 1; s.flags[i] = 0; opened++;
    if (adjacent(s, i) === 0) for (const j of neighbours(s, i)) if (!s.revealed[j] && !s.mineAt[j]) stack.push(j);
  }
  return opened;
}
function lose(s, i) { s.phase = "lost"; s.exploded = i; return { type: "lose", opened: 0 }; }
function settle(s, result) {
  if (safeLeft(s) > 0) return result;
  s.phase = "won";
  s.flags = s.mineAt.slice(); // Auto-flag the remaining mines.
  return { type: "win", opened: result.opened };
}
function chord(s, i) {
  if (s.phase !== "playing" || !inside(s, i) || !s.revealed[i]) return NONE;
  const number = adjacent(s, i), around = neighbours(s, i);
  if (!number || around.filter((j) => s.flags[j]).length !== number) return NONE;
  const targets = around.filter((j) => !s.flags[j] && !s.revealed[j]);
  if (!targets.length) return NONE;
  const hit = targets.find((j) => s.mineAt[j]);
  if (hit !== undefined) return lose(s, hit);
  let opened = 0;
  for (const j of targets) opened += open(s, j);
  return settle(s, { type: "chord", opened });
}
// Reveal a hidden cell, or chord when the cell is an opened number.
function reveal(s, i, random = Math.random) {
  if (!playable(s) || !inside(s, i) || s.flags[i]) return NONE;
  if (s.revealed[i]) return chord(s, i);
  if (!s.mines) { placeMines(s, i, random); s.phase = "playing"; }
  if (s.mineAt[i]) return lose(s, i);
  return settle(s, { type: "reveal", opened: open(s, i) });
}
function toggleFlag(s, i) {
  if (!playable(s) || !inside(s, i) || s.revealed[i]) return false;
  s.flags[i] ^= 1;
  return true;
}

const indices = (list) => list.reduce((out, v, i) => { if (v) out.push(i); return out; }, []);
function serialize(s) {
  return { level: s.level, cols: s.cols, rows: s.rows, mines: s.mines ? [...s.mines] : null, revealed: indices(s.revealed),
    flags: indices(s.flags), elapsed: Math.max(0, Math.floor(s.elapsed)), phase: s.phase };
}
const sortedIndices = (list, n) => Array.isArray(list) && list.every((v, k) => Number.isInteger(v) && v >= 0 && v < n && (k === 0 || v > list[k - 1]));
// Strictly rebuild an unfinished game from saved data; anything inconsistent returns null.
function restore(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !Object.hasOwn(LEVELS, data.level)) return null;
  const level = LEVELS[data.level];
  const shapes = data.level === "hard" ? [[30, 16], [16, 30]] : [[level.cols, level.rows]];
  if (!shapes.some(([c, r]) => data.cols === c && data.rows === r)) return null;
  const n = data.cols * data.rows;
  if (!["ready", "playing"].includes(data.phase) || !Number.isSafeInteger(data.elapsed) || data.elapsed < 0 || data.elapsed > MAX_ELAPSED) return null;
  if (!sortedIndices(data.revealed, n) || !sortedIndices(data.flags, n)) return null;
  const s = freshState(data.level, data.cols < data.rows ? .5 : 2);
  for (const i of data.flags) s.flags[i] = 1;
  for (const i of data.revealed) { if (s.flags[i]) return null; s.revealed[i] = 1; }
  if (data.mines === null) return data.phase === "ready" && !data.revealed.length && data.elapsed === 0 ? s : null;
  if (data.phase !== "playing" || !sortedIndices(data.mines, n) || data.mines.length !== level.mines || !data.revealed.length) return null;
  setMines(s, data.mines);
  if (data.revealed.some((i) => s.mineAt[i]) || safeLeft(s) <= 0) return null;
  // Every opened zero must have flooded its neighbours, and the first reveal always opens a zero.
  if (!data.revealed.some((i) => adjacent(s, i) === 0)) return null;
  if (data.revealed.some((i) => adjacent(s, i) === 0 && neighbours(s, i).some((j) => !s.revealed[j]))) return null;
  s.phase = "playing";
  s.elapsed = data.elapsed;
  return s;
}
function cleanBest(best) {
  const out = { easy: null, medium: null, hard: null };
  if (best && typeof best === "object") for (const key of Object.keys(out)) if (Number.isSafeInteger(best[key]) && best[key] >= 0) out[key] = best[key];
  return out;
}

if (typeof module !== "undefined") module.exports = { LEVELS, HOLD_MS, shapeFor, freshState, neighbours, placeMines, setMines, adjacent,
  minesLeft, safeLeft, reveal, chord, toggleFlag, serialize, restore, cleanBest };

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const $ = (selector) => document.querySelector(selector);
  const stage = $(".play-stage"), board = $(".play-board"), grid = $("#mine-grid");
  const overlay = $("#mine-overlay"), overlayTitle = overlay.querySelector("h2"), overlayText = overlay.querySelector("p");
  const primary = $("#mine-primary"), viewBoard = $("#mine-view"), modeToggle = $("#mode"), muteToggle = $("#mute");
  const menu = $("#game-menu"), confirmBox = $("#level-confirm"), confirmText = $("#level-confirm-text");
  const minesLabel = $("#mines-left"), timerLabel = $("#timer"), bestLabel = $("#best-time"), menuState = $("#menu-state");
  const levelButtons = [...document.querySelectorAll("[data-level]")];
  const announce = createAnnouncer($("#mine-status"));
  const saved = store.read();
  const record = { version: VERSION, bestScore: Number.isSafeInteger(saved?.bestScore) && saved.bestScore >= 0 ? saved.bestScore : 0,
    best: cleanBest(saved?.best), level: Object.hasOwn(LEVELS, saved?.level) ? saved.level : "easy", muted: saved?.muted === true, current: null };
  const tone = createTone(() => record.muted);
  // Khó stands up on a portrait screen even when the stage left after HUD and controls is near-square.
  const stageAspect = () => {
    const box = stage.getBoundingClientRect(), aspect = box.height ? box.width / box.height : 1;
    return innerHeight > innerWidth ? Math.min(aspect, innerWidth / innerHeight) : aspect;
  };
  let state = restore(saved?.current);
  // A restored game waits for the first move before its clock runs again.
  let held = Boolean(state);
  state ||= freshState(record.level, stageAspect());
  record.level = state.level;
  let flagMode = false, menuOpen = false, runStart = 0, ticker = 0, overlayDismissed = false, pendingLevel = null, lastResult = "";
  let focusIndex = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
  let cells = [], views = [];

  const FLAG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2v11.5" stroke="#eff2cd" stroke-width="1.6"/><path d="M6.2 2.4 13 5.4 6.2 8.4z" fill="#ee886b"/><path d="M3 13.6h6.5" stroke="#eff2cd" stroke-width="1.6"/></svg>';
  const MINE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="4.3" fill="currentColor"/><circle cx="6.6" cy="6.6" r="1.1" fill="#eff2cd"/></svg>';
  const WRONG = FLAG.replace("</svg>", '<path d="M2.5 2.5l11 11M13.5 2.5l-11 11" stroke="#e0e8bd" stroke-width="1.8"/></svg>');
  const clock = (ms) => { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
  const elapsedMs = () => state.elapsed + (runStart ? performance.now() - runStart : 0);
  const running = () => state.phase === "playing" && !menuOpen && !document.hidden && !held;

  function syncClock() {
    if (running() && !runStart) {
      runStart = performance.now();
      ticker = setInterval(() => { timerLabel.textContent = clock(elapsedMs()); }, 250);
    } else if (!running() && runStart) {
      state.elapsed = Math.min(MAX_ELAPSED, state.elapsed + performance.now() - runStart);
      runStart = 0;
      clearInterval(ticker);
    }
    timerLabel.textContent = clock(elapsedMs());
  }
  function persist() {
    const snapshot = { ...serialize(state), elapsed: Math.floor(Math.min(MAX_ELAPSED, elapsedMs())) };
    // Only an unfinished board counts as "Chơi tiếp" in the catalog.
    record.current = state.phase === "playing" || (state.phase === "ready" && snapshot.flags.length) ? snapshot : null;
    record.level = state.level;
    store.write(record);
  }

  function buildGrid() {
    grid.replaceChildren();
    cells = []; views = [];
    grid.style.setProperty("--cols", state.cols);
    grid.style.setProperty("--rows", state.rows);
    board.style.setProperty("--stage-ratio", state.cols / state.rows);
    board.style.setProperty("--cols", state.cols);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.cols * state.rows; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "mine-cell";
      cell.dataset.i = i;
      cell.tabIndex = -1;
      cells.push(cell); views.push("");
      fragment.append(cell);
    }
    grid.append(fragment);
    grid.setAttribute("aria-label", `Bàn dò mìn ${LEVELS[state.level].name}, ${state.cols} cột × ${state.rows} hàng, ${LEVELS[state.level].mines} mìn`);
  }
  function cellView(i) {
    const lost = state.phase === "lost";
    if (state.revealed[i]) { const n = adjacent(state, i); return ["is-open", n ? `${n} mìn xung quanh` : "trống", n ? String(n) : "", n]; }
    if (lost && state.mineAt[i] && !state.flags[i]) return i === state.exploded ? ["is-open is-exploded", "mìn đã nổ", MINE, 0] : ["is-open is-mine", "có mìn", MINE, 0];
    if (lost && state.flags[i] && !state.mineAt[i]) return ["is-wrong", "cờ sai, không có mìn", WRONG, 0];
    if (state.flags[i]) return ["is-flag", "đã cắm cờ", FLAG, 0];
    return ["", "chưa mở", "", 0];
  }
  function renderCells() {
    cells.forEach((cell, i) => {
      const [cls, text, html, n] = cellView(i);
      const key = cls + "|" + text;
      cell.tabIndex = i === focusIndex ? 0 : -1;
      if (views[i] === key) return;
      views[i] = key;
      cell.className = cls ? `mine-cell ${cls}` : "mine-cell";
      if (n) cell.dataset.n = n; else delete cell.dataset.n;
      cell.innerHTML = html;
      cell.setAttribute("aria-label", `Hàng ${Math.floor(i / state.cols) + 1}, cột ${i % state.cols + 1}, ${text}`);
    });
  }
  function renderHud() {
    const level = LEVELS[state.level], best = record.best[state.level];
    minesLabel.textContent = String(minesLeft(state));
    timerLabel.textContent = clock(elapsedMs());
    bestLabel.textContent = best === null ? "—" : clock(best * 1000);
    modeToggle.textContent = flagMode ? "Chế độ: Cắm cờ" : "Chế độ: Mở ô";
    modeToggle.setAttribute("aria-pressed", String(flagMode));
    muteToggle.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
    muteToggle.setAttribute("aria-pressed", String(record.muted));
    levelButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.level === state.level)));
    const hard = state.level === "hard" ? state : shapeFor("hard", stageAspect());
    levelButtons.find((button) => button.dataset.level === "hard").textContent = `Khó · ${hard.cols}×${hard.rows}`;
    menuState.textContent = `${level.name} · ${state.cols} × ${state.rows} · ${level.mines} mìn. Đồng hồ dừng khi menu mở; đóng menu để chơi tiếp.`;
  }
  function renderOverlay() {
    const over = state.phase === "won" || state.phase === "lost";
    overlay.hidden = !over || overlayDismissed;
    if (!over) return;
    overlayTitle.textContent = state.phase === "won" ? "Thắng rồi!" : "Trúng mìn!";
    overlayText.textContent = lastResult;
  }
  function render() { renderCells(); renderHud(); renderOverlay(); }

  function focusCell(i, move = true) {
    focusIndex = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach((cell, k) => { cell.tabIndex = k === focusIndex ? 0 : -1; });
    if (move) cells[focusIndex].focus({ preventScroll: false });
  }
  function newGame(level = state.level) {
    runStart = 0; clearInterval(ticker);
    const shape = `${state.cols}x${state.rows}`;
    state = freshState(level, stageAspect());
    held = false; overlayDismissed = false; lastResult = "";
    focusIndex = Math.floor(state.rows / 2) * state.cols + Math.floor(state.cols / 2);
    if (shape !== `${state.cols}x${state.rows}` || cells.length !== state.cols * state.rows) buildGrid();
    views.fill("");
    render(); persist();
    announce(`Ván mới ${LEVELS[level].name}: ${state.cols} cột, ${state.rows} hàng, ${LEVELS[level].mines} mìn.`);
  }
  function finish(result) {
    const seconds = Math.floor(state.elapsed / 1000), level = LEVELS[state.level];
    if (result.type === "win") {
      record.bestScore += 1;
      const previous = record.best[state.level];
      const fastest = previous === null || seconds < previous;
      if (fastest) record.best[state.level] = seconds;
      lastResult = `${level.name} · ${clock(seconds * 1000)}. ${fastest ? "Kỷ lục mới!" : `Nhanh nhất: ${clock(previous * 1000)}.`}`;
      tone.play([[523, 0, .1], [659, .1, .1], [784, .2, .2]]);
      announce(`Thắng! Thời gian ${seconds} giây.${fastest ? " Kỷ lục mới." : ""}`);
    } else {
      lastResult = `Thời gian ${clock(seconds * 1000)}. Các mìn đã hiện trên bàn.`;
      tone.play([[220, 0, .12], [150, .12, .25]]);
      announce(`Trúng mìn ở hàng ${Math.floor(state.exploded / state.cols) + 1}, cột ${state.exploded % state.cols + 1}. Thua ván.`);
    }
    overlayDismissed = false;
  }
  function act(i, kind) {
    if (menuOpen || document.querySelector("dialog[open]") || !inside(state, i)) return;
    if (state.phase === "won" || state.phase === "lost") { overlayDismissed = false; renderOverlay(); primary.focus(); return; }
    held = false;
    if (kind === "flag") {
      if (!toggleFlag(state, i)) return;
      const on = state.flags[i] === 1;
      tone.play([[on ? 880 : 440, 0, .05, "triangle"]]);
      announce(`${on ? "Cắm cờ" : "Gỡ cờ"}. Còn ${minesLeft(state)} mìn.`);
    } else {
      const result = reveal(state, i);
      if (result.type === "none") { syncClock(); return; }
      syncClock();
      if (result.type === "win" || result.type === "lose") finish(result);
      else {
        tone.play(result.opened > 1 ? [[520, 0, .04], [700, .04, .05]] : [[600, 0, .04]]);
        if (result.opened > 1) announce(`Mở ${result.opened} ô.`);
      }
    }
    syncClock(); render(); persist();
    if (!overlay.hidden) primary.focus();
  }

  // Touch: tap = mode action, hold 400ms = the other action. Mouse: left = mode action, right = flag.
  let hold = null, suppressUntil = 0, lastPointer = "mouse";
  const clearHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer); clearTimeout(hold.show);
    hold.cell.classList.remove("is-holding");
    hold = null;
  };
  grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".mine-cell");
    if (!cell) return;
    lastPointer = event.pointerType;
    focusCell(Number(cell.dataset.i), false);
    if (event.pointerType === "mouse" || !playable(state)) return;
    clearHold();
    const i = Number(cell.dataset.i);
    if (state.revealed[i] && !flagMode) return;
    hold = { cell, x: event.clientX, y: event.clientY, fired: false,
      show: setTimeout(() => cell.classList.add("is-holding"), 90),
      timer: setTimeout(() => {
        hold.fired = true;
        cell.classList.remove("is-holding");
        act(i, flagMode ? "reveal" : "flag");
        cell.classList.add("is-held");
        setTimeout(() => cell.classList.remove("is-held"), 260);
      }, HOLD_MS) };
  });
  grid.addEventListener("pointermove", (event) => {
    if (hold && !hold.fired && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) { suppressUntil = performance.now() + 600; clearHold(); }
  });
  grid.addEventListener("pointerup", () => {
    if (hold?.fired) suppressUntil = performance.now() + 600; // The click after a long press must not reveal.
    clearHold();
  });
  grid.addEventListener("pointercancel", clearHold);
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest(".mine-cell");
    if (!cell) return;
    if (performance.now() < suppressUntil) { suppressUntil = 0; return; }
    act(Number(cell.dataset.i), flagMode ? "flag" : "reveal");
  });
  grid.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const cell = event.target.closest(".mine-cell");
    if (cell && lastPointer === "mouse") act(Number(cell.dataset.i), "flag");
  });
  // Keep the roving index on whichever cell really has focus (pointer, Tab or assistive tech).
  grid.addEventListener("focusin", (event) => {
    const cell = event.target.closest(".mine-cell");
    if (cell && Number(cell.dataset.i) !== focusIndex) focusCell(Number(cell.dataset.i), false);
  });
  grid.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const moves = { ArrowUp: -state.cols, ArrowDown: state.cols, ArrowLeft: -1, ArrowRight: 1 };
    const x = focusIndex % state.cols, key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (Object.hasOwn(moves, key)) {
      event.preventDefault();
      if ((key === "ArrowLeft" && x === 0) || (key === "ArrowRight" && x === state.cols - 1)) return;
      const next = focusIndex + moves[key];
      if (next >= 0 && next < cells.length) focusCell(next);
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      focusCell(focusIndex - x + (key === "End" ? state.cols - 1 : 0));
    } else if (key === " " || key === "Enter") {
      event.preventDefault();
      if (!event.repeat) act(focusIndex, "reveal");
    } else if (key === "f") {
      event.preventDefault();
      act(focusIndex, "flag");
    }
  });
  // Space activates buttons on keyup; the keydown above already handled it.
  grid.addEventListener("keyup", (event) => { if (event.key === " ") event.preventDefault(); });
  document.addEventListener("keydown", (event) => {
    if (document.querySelector("dialog[open]") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key.toLowerCase() === "m" && !event.repeat) muteToggle.click();
  });

  primary.addEventListener("click", () => { newGame(); focusCell(focusIndex); });
  viewBoard.addEventListener("click", () => { overlayDismissed = true; renderOverlay(); focusCell(state.exploded >= 0 ? state.exploded : focusIndex); });
  modeToggle.addEventListener("click", () => {
    flagMode = !flagMode;
    renderHud();
    announce(flagMode ? "Chạm ô để cắm cờ." : "Chạm ô để mở.");
  });
  muteToggle.addEventListener("click", () => { record.muted = !record.muted; renderHud(); persist(); });
  const closeMenuToBoard = () => { menu.close(); focusCell(focusIndex); };
  levelButtons.forEach((button) => button.addEventListener("click", () => {
    const level = button.dataset.level;
    if (state.phase === "playing") {
      pendingLevel = level;
      confirmText.textContent = level === state.level ? `Bỏ ván đang chơi và bắt đầu lại mức ${LEVELS[level].name}?` : `Bỏ ván đang chơi để chuyển sang mức ${LEVELS[level].name}?`;
      confirmBox.hidden = false;
      $("#level-confirm-yes").focus();
      return;
    }
    newGame(level);
    closeMenuToBoard();
  }));
  $("#level-confirm-yes").addEventListener("click", () => { confirmBox.hidden = true; newGame(pendingLevel || state.level); closeMenuToBoard(); });
  $("#level-confirm-no").addEventListener("click", () => {
    confirmBox.hidden = true;
    levelButtons.find((button) => button.dataset.level === pendingLevel)?.focus();
    pendingLevel = null;
  });
  $("#new-game").addEventListener("click", () => { newGame(); closeMenuToBoard(); });

  document.addEventListener("game-menu-open", () => { menuOpen = true; clearHold(); syncClock(); persist(); renderHud(); });
  menu.addEventListener("close", () => { menuOpen = false; confirmBox.hidden = true; pendingLevel = null; syncClock(); });
  document.addEventListener("visibilitychange", () => { syncClock(); if (document.hidden) persist(); });
  window.addEventListener("pagehide", () => { syncClock(); persist(); });

  buildGrid();
  render();
  if (held) announce(`Đã khôi phục ván ${LEVELS[state.level].name}. Đồng hồ chạy lại khi bạn mở ô tiếp.`);
}
