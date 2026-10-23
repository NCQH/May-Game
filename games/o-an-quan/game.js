// Ô ăn quan: shared, dependency-free engine; the browser adapter below is skipped by Node checks.
// Ring of 12 squares: 0 = left quan, 1..5 = player 0 (bottom, left→right), 6 = right quan,
// 7..11 = player 1 (top, right→left). Direction +1 walks the ring in index order.
const VERSION = 1, STORAGE_ID = "o-an-quan";
const RING = 12, ROWS = [[1, 2, 3, 4, 5], [7, 8, 9, 10, 11]];
const DAN_PER_SQUARE = 5, QUAN_VALUE = 10, TOTAL_DAN = 50, TOTAL_QUAN = 2, QUAN_NON_MIN = 5;
// ponytail: cap pathological sowing at 80 pickups / 400 moves; replace with position repetition if longer games are needed.
const MAX_PICKUPS = 80, MAX_MOVES = 400;
const MODES = ["ai", "pvp"], LEVELS = ["easy", "normal", "hard"], SPEEDS = ["normal", "fast"];
const HARD_DEPTH = 6;

const isQuan = (i) => i === 0 || i === 6;
const ownerOf = (i) => (isQuan(i) ? -1 : i < 6 ? 0 : 1);
const step = (i, dir) => (i + dir + RING) % RING;
const isEmpty = (square) => square.dan === 0 && !square.quan;

function defaultSettings() { return { mode: "ai", level: "normal", aiFirst: false, quanNon: true }; }
function cleanSettings(value = {}) {
  const base = defaultSettings();
  return {
    mode: MODES.includes(value.mode) ? value.mode : base.mode,
    level: LEVELS.includes(value.level) ? value.level : base.level,
    aiFirst: typeof value.aiFirst === "boolean" ? value.aiFirst : base.aiFirst,
    quanNon: typeof value.quanNon === "boolean" ? value.quanNon : base.quanNon,
  };
}
function freshState(settings) {
  const clean = cleanSettings(settings);
  return {
    squares: Array.from({ length: RING }, (_, i) => (isQuan(i) ? { dan: 0, quan: true } : { dan: DAN_PER_SQUARE, quan: false })),
    scores: [{ dan: 0, quan: 0 }, { dan: 0, quan: 0 }],
    debts: [0, 0], // debts[p] = dân player p borrowed from the other pile, settled at the end.
    turn: clean.mode === "ai" && clean.aiFirst ? 1 : 0,
    phase: "playing", moves: 0, winner: null, settings: clean,
  };
}
function cloneState(s) {
  return { squares: s.squares.map((q) => ({ dan: q.dan, quan: q.quan })), scores: s.scores.map((c) => ({ dan: c.dan, quan: c.quan })),
    debts: [...s.debts], turn: s.turn, phase: s.phase, moves: s.moves, winner: s.winner ?? null, settings: { ...s.settings } };
}
function snapshot(s) {
  return { squares: s.squares.map((q) => ({ dan: q.dan, quan: q.quan })), scores: s.scores.map((c) => ({ dan: c.dan, quan: c.quan })), debts: [...s.debts] };
}
// Points with debts settled: own captures minus what was borrowed plus what the other side owes.
function points(s, p) { return s.scores[p].dan + s.scores[p].quan * QUAN_VALUE - s.debts[p] + s.debts[1 - p]; }
function quanGone(s) { return isEmpty(s.squares[0]) && isEmpty(s.squares[6]); }
function stoneTotals(s) {
  let dan = 0, quan = 0;
  for (const q of s.squares) { dan += q.dan; quan += q.quan ? 1 : 0; }
  for (const c of s.scores) { dan += c.dan; quan += c.quan; }
  return { dan, quan };
}
function isLegal(s, from, dir) {
  return s.phase === "playing" && (dir === 1 || dir === -1) && ROWS[s.turn].includes(from) && s.squares[from].dan > 0;
}
function legalMoves(s) {
  if (s.phase !== "playing") return [];
  const moves = [];
  for (const from of ROWS[s.turn]) if (s.squares[from].dan > 0) moves.push({ from, dir: 1 }, { from, dir: -1 });
  return moves;
}

// Game end: both quan squares empty ("hết quan, tàn dân"), a side cannot be refilled, or the move cap.
function finish(s, emit, reason) {
  for (const p of [0, 1]) for (const i of ROWS[p]) { s.scores[p].dan += s.squares[i].dan; s.squares[i].dan = 0; }
  s.phase = "over";
  const a = points(s, 0), b = points(s, 1);
  s.winner = a === b ? -1 : a > b ? 0 : 1;
  emit("over", { reason, winner: s.winner });
}
// Start of a turn: a player with five empty squares must place five dân from their pile ("rải quân"),
// borrowing the shortfall from the opponent's pile.
function startTurn(s, emit) {
  const p = s.turn, row = ROWS[p];
  if (row.some((i) => s.squares[i].dan > 0)) return;
  const own = Math.min(s.scores[p].dan, row.length), borrow = Math.min(s.scores[1 - p].dan, row.length - own);
  if (own + borrow === 0) { finish(s, emit, "no-dan"); return; }
  s.scores[p].dan -= own; s.scores[1 - p].dan -= borrow; s.debts[p] += borrow;
  for (let k = 0; k < own + borrow; k++) s.squares[row[k]].dan = 1;
  emit("scatter", { player: p, own, borrow });
}
function endTurn(s, emit) {
  if (quanGone(s)) { finish(s, emit, "quan"); return; }
  if (s.moves >= MAX_MOVES) { finish(s, emit, "limit"); return; }
  s.turn = 1 - s.turn;
  startTurn(s, emit);
}

// Plays one full turn. Returns null for an illegal move, else { events, gained, reason }.
// Events carry a board snapshot after each step so the browser can replay the sowing.
function playMove(s, from, dir, options = {}) {
  if (!isLegal(s, from, dir)) return null;
  const record = options.record !== false, maxPickups = options.maxPickups ?? MAX_PICKUPS;
  const events = [];
  const emit = (type, extra = {}) => { if (record) events.push({ type, ...extra, view: snapshot(s) }); };
  const p = s.turn, sq = s.squares, gained = { dan: 0, quan: 0 };
  let hand = sq[from].dan, pos = from, pickups = 1, reason = "";
  sq[from].dan = 0;
  emit("pick", { i: from, hand, player: p });
  for (;;) {
    while (hand > 0) { pos = step(pos, dir); sq[pos].dan++; hand--; emit("drop", { i: pos, hand }); }
    const n1 = step(pos, dir);
    if (!isEmpty(sq[n1])) {
      if (isQuan(n1)) { reason = "quan"; break; }
      // Guard against endless continue-sowing loops: the turn simply ends.
      if (pickups >= maxPickups) { reason = "limit"; break; }
      hand = sq[n1].dan; sq[n1].dan = 0; pos = n1; pickups++;
      emit("pick", { i: n1, hand, player: p });
      continue;
    }
    let gap = n1;
    reason = "empty";
    for (let k = 0; k < RING; k++) {
      const target = step(gap, dir);
      if (isEmpty(sq[target])) break;
      if (s.settings.quanNon && sq[target].quan && sq[target].dan < QUAN_NON_MIN) { reason = "quan-non"; break; }
      const dan = sq[target].dan, quan = sq[target].quan ? 1 : 0;
      sq[target].dan = 0; sq[target].quan = false;
      s.scores[p].dan += dan; s.scores[p].quan += quan; gained.dan += dan; gained.quan += quan;
      reason = "capture";
      emit("capture", { i: target, player: p, dan, quan });
      const after = step(target, dir);
      if (!isEmpty(sq[after])) break;
      gap = after; // "ăn liên": an empty square then a full one captures again.
    }
    break;
  }
  s.moves++;
  emit("end", { reason, player: p, gained: { ...gained } });
  endTurn(s, emit);
  return { events, gained, reason };
}

// ---- AI ----
function evaluate(s, p) { return points(s, p) - points(s, 1 - p); }
function immediate(s, move) {
  const child = cloneState(s);
  playMove(child, move.from, move.dir, { record: false });
  return { child, value: evaluate(child, s.turn) };
}
function negamax(s, depth, alpha, beta) {
  if (s.phase !== "playing" || depth === 0) return evaluate(s, s.turn);
  const p = s.turn;
  const options = legalMoves(s).map((m) => immediate(s, m)).sort((a, b) => b.value - a.value);
  let best = -Infinity;
  for (const { child } of options) {
    // Turns always alternate while the game runs; a finished child is scored for the mover directly.
    const value = child.phase !== "playing" ? evaluate(child, p) : -negamax(child, depth - 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function chooseMove(s, level = "normal", random = Math.random) {
  const moves = legalMoves(s);
  if (!moves.length) return null;
  const scored = moves.map((m) => ({ ...m, ...immediate(s, m) }));
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const strip = ({ from, dir }) => ({ from, dir });
  if (level === "easy") {
    // Random among the better half of moves by immediate gain.
    const sorted = [...scored].sort((a, b) => b.value - a.value);
    return strip(pick(sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)))));
  }
  if (level === "normal") {
    const top = Math.max(...scored.map((m) => m.value));
    return strip(pick(scored.filter((m) => m.value === top)));
  }
  scored.sort((a, b) => b.value - a.value);
  let best = -Infinity, bestMoves = [], alpha = -Infinity;
  for (const m of scored) {
    const c = m.child;
    const value = c.phase !== "playing" ? m.value : -negamax(c, HARD_DEPTH - 1, -Infinity, -alpha + 1e-9);
    if (value > best) { best = value; bestMoves = [m]; } else if (value === best) bestMoves.push(m);
    if (best > alpha) alpha = best;
  }
  return strip(pick(bestMoves));
}

// ---- Save validation ----
const count = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
function validState(s) {
  if (!s || typeof s !== "object" || s.phase !== "playing" || ![0, 1].includes(s.turn) || !count(s.moves, MAX_MOVES - 1)) return false;
  if (!s.settings || typeof s.settings !== "object" || JSON.stringify(cleanSettings(s.settings)) !== JSON.stringify({
    mode: s.settings.mode, level: s.settings.level, aiFirst: s.settings.aiFirst, quanNon: s.settings.quanNon })) return false;
  if (!Array.isArray(s.squares) || s.squares.length !== RING) return false;
  for (let i = 0; i < RING; i++) {
    const q = s.squares[i];
    if (!q || typeof q !== "object" || !count(q.dan, TOTAL_DAN) || typeof q.quan !== "boolean" || (q.quan && !isQuan(i))) return false;
  }
  if (!Array.isArray(s.scores) || s.scores.length !== 2 || !s.scores.every((c) => c && count(c.dan, TOTAL_DAN) && count(c.quan, TOTAL_QUAN))) return false;
  if (!Array.isArray(s.debts) || s.debts.length !== 2 || !s.debts.every((d) => count(d, MAX_MOVES * DAN_PER_SQUARE))) return false;
  const totals = stoneTotals(s);
  if (totals.dan !== TOTAL_DAN || totals.quan !== TOTAL_QUAN) return false;
  if (quanGone(s) || !ROWS[s.turn].some((i) => s.squares[i].dan > 0)) return false;
  return true;
}
function normalizeRecord(saved) {
  const tally = saved?.tally;
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  const settings = cleanSettings(saved || {});
  const clean = { win: n(tally?.win), loss: n(tally?.loss), draw: n(tally?.draw) };
  return { version: VERSION, bestScore: clean.win, tally: clean, ...settings, speed: SPEEDS.includes(saved?.speed) ? saved.speed : "normal",
    muted: saved?.muted === true, current: validState(saved?.current) ? cloneState(saved.current) : null };
}

if (typeof module !== "undefined") module.exports = { RING, ROWS, MAX_PICKUPS, MAX_MOVES, isQuan, ownerOf, step, freshState, cloneState, cleanSettings,
  defaultSettings, points, stoneTotals, legalMoves, isLegal, playMove, chooseMove, validState, normalizeRecord, quanGone };

if (typeof document !== "undefined") {
  const { createStore, createTone, createAnnouncer } = globalThis.MayGameKit;
  const store = createStore(STORAGE_ID);
  const $ = (selector) => document.querySelector(selector);
  const board = $("#oaq-board"), stage = board.parentElement;
  const dirsBox = $("#oaq-dirs"), dirButtons = [...dirsBox.querySelectorAll("button")];
  const overlay = $("#oaq-overlay"), overlayTitle = overlay.querySelector("h2"), overlayText = overlay.querySelector("p");
  const turnText = $("#oaq-turn-text"), turnBox = $("#oaq-turn");
  const menu = $("#game-menu");
  const announce = createAnnouncer($("#oaq-status"));
  const controls = { mode: $("#oaq-mode"), level: $("#oaq-level"), speed: $("#oaq-speed"), aiFirst: $("#oaq-ai-first"), quanNon: $("#oaq-quan-non"), mute: $("#mute") };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const saved = store.read();
  let record = normalizeRecord(saved);
  const tone = createTone(() => record.muted);
  let state = record.current ? cloneState(record.current) : freshState(record);
  let view = snapshot(state), busy = false, animToken = 0, aiTimer = 0, selected = -1, focusIndex = -1, handAt = -1, hand = 0;
  let layout = "landscape", flash = "", confirmTimer = 0, mover = 0;

  // Build the twelve squares once; their order in the DOM follows the ring.
  const cells = Array.from({ length: RING }, (_, i) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `oaq-cell ${isQuan(i) ? "oaq-quan" : `oaq-dan oaq-side-${ownerOf(i)}`}`;
    cell.dataset.index = i;
    cell.tabIndex = -1;
    cell.innerHTML = '<span class="oaq-pile" aria-hidden="true"></span><span class="oaq-count" aria-hidden="true"></span>';
    board.insertBefore(cell, dirsBox);
    return cell;
  });

  const isAI = () => state.settings.mode === "ai";
  const names = () => (isAI() ? ["Bạn", "Máy"] : ["Người 1", "Người 2"]);
  const humanTurn = () => state.phase === "playing" && !(isAI() && state.turn === 1);
  const menuOpen = () => Boolean(document.querySelector("dialog[open]"));
  const canInput = () => humanTurn() && !busy && !menuOpen();
  const fmt = (n) => n.toLocaleString("vi-VN");
  const selectable = (i) => canInput() && ROWS[state.turn].includes(i) && state.squares[i].dan > 0;
  // Own squares in on-screen order (left→right, or top→bottom in the tall layout).
  const visualRow = (p) => {
    const row = [...ROWS[p]];
    if (layout === "landscape") return p === 0 ? row : row.reverse();
    return p === 0 ? row.reverse() : row;
  };
  // Engine directions for the first (◀/▲) and second (▶/▼) on-screen buttons.
  const visualDirs = (i) => {
    const p = ownerOf(i);
    if (layout === "landscape") return p === 0 ? [-1, 1] : [1, -1];
    return p === 0 ? [1, -1] : [-1, 1];
  };
  const dirWords = () => (layout === "landscape" ? [["◀", "Rải về trái"], ["▶", "Rải về phải"]] : [["▲", "Rải lên trên"], ["▼", "Rải xuống dưới"]]);

  function cellLabel(i) {
    const q = view.squares[i];
    if (isQuan(i)) {
      const side = layout === "landscape" ? (i === 0 ? "trái" : "phải") : (i === 6 ? "trên" : "dưới");
      return `Ô quan ${side}: ${q.quan ? "còn quan, " : "hết quan, "}${q.dan} dân`;
    }
    const p = ownerOf(i), position = visualRow(p).indexOf(i) + 1;
    const who = isAI() ? (p === 0 ? "của bạn" : "của máy") : `của ${names()[p]}`;
    return `Ô dân ${position} ${who}: ${q.dan} dân${selectable(i) ? ". Chọn để rải" : ""}`;
  }
  function renderCell(i) {
    const q = view.squares[i], cell = cells[i];
    const dots = Math.min(q.dan, 12);
    const pile = cell.firstChild;
    if (pile.dataset.n !== `${dots}:${q.quan}`) {
      pile.dataset.n = `${dots}:${q.quan}`;
      pile.innerHTML = (q.quan ? "<b></b>" : "") + "<i></i>".repeat(dots);
    }
    cell.lastChild.textContent = String(q.dan);
    cell.classList.toggle("is-selectable", selectable(i));
    cell.classList.toggle("is-selected", i === selected);
    cell.classList.toggle("is-hand", i === handAt);
    cell.classList.toggle("is-turn", !busy && state.phase === "playing" && ownerOf(i) === state.turn);
    cell.setAttribute("aria-label", cellLabel(i));
    cell.setAttribute("aria-disabled", String(!selectable(i)));
  }
  function syncFocus() {
    const own = canInput() ? visualRow(state.turn) : [];
    if (!own.includes(focusIndex)) focusIndex = own.find((i) => state.squares[i].dan > 0) ?? -1;
    cells.forEach((cell, i) => { cell.tabIndex = i === focusIndex ? 0 : -1; });
    board.tabIndex = focusIndex === -1 ? 0 : -1;
  }
  function renderHud() {
    const [a, b] = names();
    $("#oaq-name-0").textContent = view.debts[0] ? `${a} · nợ ${view.debts[0]}` : a;
    $("#oaq-name-1").textContent = view.debts[1] ? `${b} · nợ ${view.debts[1]}` : b;
    $("#oaq-score-0").textContent = fmt(points(view, 0));
    $("#oaq-score-1").textContent = fmt(points(view, 1));
    $("#oaq-wins").textContent = fmt(record.bestScore);
    $("#oaq-wins-stat").hidden = !isAI();
    turnBox.dataset.player = String(busy ? mover : state.turn);
    let text;
    if (busy) text = hand > 0 ? `Đang rải · còn ${hand} trên tay` : flash || "Đang rải…";
    else text = turnMessage();
    turnText.textContent = flash && !busy && state.phase === "playing" ? `${flash} · ${text}` : text;
  }
  function turnMessage() {
    if (state.phase === "over") return "Hết quan, tàn dân";
    if (isAI() && state.turn === 1) return "Máy đang nghĩ…";
    return `${isAI() ? "Lượt của bạn" : `Lượt ${names()[state.turn]}`} · chọn ô dân`;
  }
  function renderSettings() {
    controls.mode.value = record.mode; controls.level.value = record.level; controls.speed.value = record.speed;
    controls.aiFirst.setAttribute("aria-pressed", String(record.aiFirst));
    controls.aiFirst.textContent = record.aiFirst ? "Máy đi trước: bật" : "Máy đi trước: tắt";
    controls.aiFirst.disabled = record.mode !== "ai";
    controls.level.disabled = record.mode !== "ai";
    controls.quanNon.setAttribute("aria-pressed", String(record.quanNon));
    controls.quanNon.textContent = record.quanNon ? "Quan non: không được ăn" : "Quan non: được ăn";
    controls.mute.setAttribute("aria-pressed", String(record.muted));
    controls.mute.textContent = record.muted ? "🔇 Bật âm thanh" : "🔊 Tắt âm thanh";
    $("#oaq-menu-state").textContent = state.phase === "over" ? "Ván đã kết thúc." :
      `${isAI() ? `Đấu với máy (${{ easy: "Dễ", normal: "Thường", hard: "Khó" }[state.settings.level]})` : "2 người cùng máy"} · ${state.settings.quanNon ? "quan non không được ăn" : "được ăn quan non"}. Đóng menu để chơi tiếp.`;
  }
  function renderOverlay() {
    const show = state.phase === "over" && !busy;
    overlay.hidden = !show;
    if (!show) return;
    const [a, b] = names(), pa = points(state, 0), pb = points(state, 1);
    overlayTitle.textContent = state.winner === -1 ? "Hòa!" : isAI() ? (state.winner === 0 ? "Bạn thắng!" : "Máy thắng") : `${names()[state.winner]} thắng!`;
    const debt = state.debts[0] || state.debts[1] ? " Đã tính cả dân vay." : "";
    overlayText.textContent = `${a} ${pa} điểm · ${b} ${pb} điểm.${debt}${isAI() ? ` Đã thắng máy ${record.bestScore} ván.` : ""}`;
  }
  function placeDirs() {
    if (selected < 0) { dirsBox.hidden = true; return; }
    const cell = cells[selected];
    dirsBox.hidden = false;
    dirsBox.dataset.layout = layout;
    Object.assign(dirsBox.style, { left: `${cell.offsetLeft}px`, top: `${cell.offsetTop}px`, width: `${cell.offsetWidth}px`, height: `${cell.offsetHeight}px` });
    const dirs = visualDirs(selected), words = dirWords();
    dirButtons.forEach((button, k) => {
      button.dataset.dir = String(dirs[k]);
      button.textContent = words[k][0];
      button.setAttribute("aria-label", words[k][1]);
      button.title = words[k][1];
    });
  }
  function render() {
    const [mine, theirs] = layout === "landscape" ? ["Hàng dưới", "hàng trên"] : ["Cột phải", "cột trái"];
    const [a, b] = names();
    board.setAttribute("aria-label", `Bàn ô ăn quan. ${mine} là của ${a.toLowerCase()}, ${theirs} là của ${b.toLowerCase()}. Phím mũi tên chọn ô, Enter mở hướng rải.`);
    for (let i = 0; i < RING; i++) renderCell(i);
    syncFocus(); renderHud(); renderSettings(); renderOverlay(); placeDirs();
  }

  function chooseLayout() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    const wide = Math.min(width, height * 7 / 2.6), tall = Math.min(height, width * 7 / 2.6);
    const next = tall > wide ? "portrait" : "landscape";
    if (next !== layout || !board.dataset.layout) {
      layout = next;
      board.dataset.layout = layout;
      board.style.setProperty("--stage-ratio", layout === "landscape" ? String(7 / 2.6) : String(2.6 / 7));
      render();
    } else placeDirs();
  }

  const persist = () => {
    record.current = state.phase === "playing" && state.moves > 0 ? cloneState(state) : null;
    store.write(record);
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const speed = () => (record.speed === "fast" ? .5 : 1);

  function captureText(gained) {
    if (gained.quan && gained.dan) return `Ăn quan và ${gained.dan} dân!`;
    if (gained.quan) return gained.quan > 1 ? "Ăn hai quan!" : "Ăn quan!";
    return gained.dan ? `Ăn ${gained.dan} dân` : "";
  }
  async function animate(events, token) {
    if (reduced.matches) return;
    for (const event of events) {
      if (token !== animToken) return;
      view = event.view;
      handAt = event.i ?? -1;
      hand = event.hand ?? 0;
      let wait = 0;
      if (event.type === "pick") { wait = 260; tone.play([[392, 0, .04, "triangle"]], .05); }
      else if (event.type === "drop") { wait = 160; tone.play([[600 + (event.hand % 4) * 40, 0, .025, "triangle"]], .035); }
      else if (event.type === "capture") {
        wait = 520; hand = 0;
        flash = captureText(event);
        tone.play(event.quan ? [[523, 0, .09], [784, .09, .09], [1046, .18, .14]] : [[660, 0, .06], [880, .06, .08]]);
        cells[event.i].classList.remove("is-captured"); void cells[event.i].offsetWidth; cells[event.i].classList.add("is-captured");
      } else if (event.type === "scatter") { wait = 420; handAt = -1; hand = 0; }
      else { handAt = -1; hand = 0; }
      render();
      if (wait) await delay(wait * speed());
    }
  }
  async function perform(from, dir) {
    mover = state.turn;
    const result = playMove(state, from, dir);
    if (!result) return;
    selected = -1; flash = "";
    if (state.phase === "over") settle();
    persist();
    busy = true;
    const token = ++animToken;
    render();
    await animate(result.events, token);
    if (token !== animToken) return;
    busy = false; handAt = -1; hand = 0;
    view = snapshot(state);
    const who = isAI() ? (mover === 0 ? "Bạn " : "Máy ") : `${names()[mover]} `;
    const caught = captureText(result.gained);
    flash = caught ? `${who}${caught.charAt(0).toLowerCase()}${caught.slice(1)}` : "";
    render();
    const scatter = result.events.find((e) => e.type === "scatter");
    const parts = [caught ? flash : `${who}rải xong, không ăn được.`];
    if (scatter) parts.push(`${names()[scatter.player]} rải lại ${scatter.own + scatter.borrow} dân${scatter.borrow ? `, vay ${scatter.borrow}` : ""}.`);
    if (state.phase === "over") parts.push(`${overlayTitle.textContent} ${overlayText.textContent}`);
    else parts.push(isAI() && state.turn === 1 ? "Lượt của máy." : `${turnMessage()}.`);
    announce(parts.join(" "));
    if (state.phase === "over") {
      tone.play(state.winner === 0 || !isAI() ? [[523, 0, .1], [659, .1, .1], [784, .2, .2]] : [[220, 0, .12], [165, .12, .2]]);
      $("#oaq-primary").focus({ preventScroll: true });
    } else afterTurn(true);
  }
  function settle() {
    if (!isAI()) return;
    if (state.winner === 0) record.tally.win++;
    else if (state.winner === 1) record.tally.loss++;
    else record.tally.draw++;
    record.bestScore = record.tally.win;
  }
  function afterTurn(moved = false) {
    clearTimeout(aiTimer);
    if (state.phase !== "playing") return;
    if (isAI() && state.turn === 1) { scheduleAI(); return; }
    const active = document.activeElement;
    if (!menuOpen() && focusIndex >= 0 && (board.contains(active) || (moved && active === document.body))) cells[focusIndex].focus({ preventScroll: true });
  }
  function scheduleAI() {
    clearTimeout(aiTimer);
    if (!isAI() || state.turn !== 1 || state.phase !== "playing" || busy) return;
    aiTimer = setTimeout(() => {
      if (!isAI() || state.turn !== 1 || state.phase !== "playing" || busy || menuOpen() || document.hidden) return;
      const move = chooseMove(state, state.settings.level);
      if (move) perform(move.from, move.dir);
    }, reduced.matches ? 250 : 650);
  }
  function newGame() {
    animToken++; clearTimeout(aiTimer);
    busy = false; selected = -1; handAt = -1; hand = 0; flash = "";
    state = freshState(record);
    view = snapshot(state);
    persist(); render();
    announce(isAI() && state.turn === 1 ? "Ván mới. Máy đi trước." : `Ván mới. ${isAI() ? "Lượt của bạn" : "Lượt Người 1"}.`);
    if (focusIndex >= 0) cells[focusIndex].focus({ preventScroll: true }); else board.focus({ preventScroll: true });
    afterTurn();
  }

  function openDirs(i) {
    if (!selectable(i)) {
      if (canInput() && ROWS[state.turn].includes(i)) announce("Ô này trống, chọn ô khác.");
      return;
    }
    tone.unlock();
    selected = selected === i ? -1 : i;
    focusIndex = i;
    render();
    if (selected >= 0) announce(`Đã chọn ô có ${state.squares[i].dan} dân. Chọn hướng rải.`);
  }
  function closeDirs() { if (selected < 0) return false; selected = -1; render(); return true; }
  function chooseDir(k) {
    if (selected < 0 || !canInput()) return;
    const from = selected;
    cells[from].focus({ preventScroll: true }); // the direction buttons disappear with the move
    perform(from, visualDirs(from)[k]);
  }

  board.addEventListener("click", (event) => {
    const cell = event.target.closest(".oaq-cell");
    if (cell && canInput()) openDirs(Number(cell.dataset.index));
  });
  dirButtons.forEach((button, k) => button.addEventListener("click", () => { tone.unlock(); chooseDir(k); }));
  document.addEventListener("pointerdown", (event) => {
    if (selected >= 0 && !board.contains(event.target)) closeDirs();
  });
  // The menu returns focus to the board; hand it on to the roving square.
  board.addEventListener("focus", () => { if (focusIndex >= 0) cells[focusIndex].focus({ preventScroll: true }); });
  board.addEventListener("keydown", (event) => {
    if (menuOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
    const back = ["ArrowLeft", "ArrowUp"].includes(event.key), forward = ["ArrowRight", "ArrowDown"].includes(event.key);
    if (event.key === "Escape" && closeDirs()) {
      event.preventDefault(); // keeps the shared menu from opening
      if (focusIndex >= 0) cells[focusIndex].focus({ preventScroll: true });
      announce("Đã hủy chọn ô.");
      return;
    }
    if (!back && !forward) return;
    event.preventDefault();
    if (!canInput()) return;
    if (selected >= 0) { chooseDir(back ? 0 : 1); return; }
    const own = visualRow(state.turn);
    const at = own.indexOf(focusIndex);
    focusIndex = own[Math.max(0, Math.min(own.length - 1, (at < 0 ? 0 : at) + (back ? -1 : 1)))];
    syncFocus();
    cells[focusIndex].focus({ preventScroll: true });
  });
  document.addEventListener("keydown", (event) => {
    if (menuOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "m" || event.key === "M") controls.mute.click();
  });

  $("#oaq-primary").addEventListener("click", newGame);
  const newButton = $("#oaq-new");
  newButton.addEventListener("click", () => {
    if (state.phase === "playing" && state.moves > 0 && !newButton.dataset.confirm) {
      newButton.dataset.confirm = "1";
      newButton.textContent = "Bỏ ván này? Bấm lần nữa";
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => { delete newButton.dataset.confirm; newButton.textContent = "Ván mới"; }, 3000);
      return;
    }
    clearTimeout(confirmTimer); delete newButton.dataset.confirm; newButton.textContent = "Ván mới";
    newGame();
  });
  $("#oaq-menu-new").addEventListener("click", () => { menu.close(); newGame(); });

  // Rule settings apply from the next game, or right away when no move has been made yet.
  const applySetting = (rules) => {
    persist();
    if (rules && state.moves === 0 && state.phase === "playing" && !busy) { state = freshState(record); view = snapshot(state); persist(); }
    render();
  };
  controls.mode.addEventListener("change", () => { record.mode = MODES.includes(controls.mode.value) ? controls.mode.value : "ai"; applySetting(true); });
  controls.level.addEventListener("change", () => {
    record.level = LEVELS.includes(controls.level.value) ? controls.level.value : "normal";
    state.settings.level = record.level; // AI strength may change mid-game.
    applySetting(false);
  });
  controls.speed.addEventListener("change", () => { record.speed = SPEEDS.includes(controls.speed.value) ? controls.speed.value : "normal"; applySetting(false); });
  controls.aiFirst.addEventListener("click", () => { record.aiFirst = !record.aiFirst; applySetting(true); });
  controls.quanNon.addEventListener("click", () => { record.quanNon = !record.quanNon; applySetting(true); });
  controls.mute.addEventListener("click", () => { record.muted = !record.muted; persist(); renderSettings(); });

  document.addEventListener("game-menu-open", () => { clearTimeout(aiTimer); selected = -1; persist(); render(); });
  menu.addEventListener("close", () => { render(); afterTurn(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(aiTimer); persist(); } else afterTurn(); });
  window.addEventListener("pagehide", persist);
  new ResizeObserver(chooseLayout).observe(stage);
  chooseLayout();
  render();
  afterTurn();
}
