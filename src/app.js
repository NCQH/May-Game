const selection = document.querySelector("#selected-game");
const searchToggle = document.querySelector("#search-toggle");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#game-search");
const positionLabel = document.querySelector("#game-position");
const screenTools = document.querySelector(".screen-tools");
const statusLabel = document.querySelector("#selection-status");
const previousButton = document.querySelector("#previous-game");
const nextButton = document.querySelector("#next-game");
const STORAGE_PREFIX = "may-game:v1:";
const soundToggle = document.querySelector("#home-sound");
let homeMuted = false;
let bootRequested = false;
let soundVersion = 0;
let audio = null;
let bootOscillator = null;
let bootGain = null;
try { homeMuted = localStorage.getItem(`${STORAGE_PREFIX}home-muted`) === "true"; } catch { /* Sound is optional. */ }

function syncHomeSound() {
  const label = homeMuted ? "Bật âm thanh trang chủ" : "Tắt âm thanh trang chủ";
  soundToggle.setAttribute("aria-pressed", String(homeMuted));
  soundToggle.setAttribute("aria-label", label);
  soundToggle.title = label;
}

function stopBootSound() {
  soundVersion++;
  if (!bootOscillator) return;
  try {
    bootGain.gain.cancelScheduledValues(audio.currentTime);
    bootGain.gain.setValueAtTime(0, audio.currentTime);
    bootOscillator.stop();
  } catch { /* An ended tone needs no cleanup here. */ }
}

async function playBootSound() {
  if (homeMuted || bootRequested) return;
  bootRequested = true;
  const version = soundVersion;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audio = new Audio();
    await audio.resume();
    if (homeMuted || version !== soundVersion || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(440, now);
    oscillator.frequency.setValueAtTime(660, now + .1);
    oscillator.frequency.setValueAtTime(880, now + .2);
    gain.gain.setValueAtTime(.045, now);
    gain.gain.exponentialRampToValueAtTime(.001, now + .3);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    bootOscillator = oscillator;
    bootGain = gain;
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      bootOscillator = bootGain = null;
    };
    oscillator.start(now);
    oscillator.stop(now + .3);
  } catch { /* Catalog and navigation do not depend on audio. */ }
}

syncHomeSound();
soundToggle.addEventListener("click", (event) => {
  homeMuted = !homeMuted;
  try { localStorage.setItem(`${STORAGE_PREFIX}home-muted`, String(homeMuted)); } catch { /* Keep the choice for this page when storage is unavailable. */ }
  syncHomeSound();
  if (homeMuted) stopBootSound();
  else if (event.isTrusted) playBootSound();
});
for (const type of ["click", "keydown"]) {
  document.addEventListener(type, (event) => {
    if (!event.isTrusted || event.target.closest("#home-sound") || event.altKey || event.ctrlKey || event.metaKey ||
      (type === "keydown" && ["Tab", "Shift", "Control", "Alt", "Meta", "Escape"].includes(event.key))) return;
    playBootSound();
  });
}
window.addEventListener("pagehide", () => {
  stopBootSound();
  audio?.close().catch(() => {});
});
const TETRIS_PIXELS = [
  [3, 2, "#f5d563"], [4, 2, "#f5d563"], [3, 3, "#f5d563"], [4, 3, "#f5d563"],
  [1, 5, "#52d7ed"], [2, 5, "#52d7ed"], [3, 5, "#52d7ed"], [3, 4, "#52d7ed"],
  [5, 5, "#bc91f2"], [6, 5, "#bc91f2"], [7, 5, "#bc91f2"], [6, 4, "#bc91f2"],
  [2, 7, "#f5b16e"], [3, 7, "#f5b16e"], [4, 7, "#f5b16e"], [4, 6, "#f5b16e"],
];

// Pixel cards for the newer games: [column, row, colour] on the same 9×8 grid as Tetris.
const L = "#c7e875", C = "#ee886b", B = "#79c9c4", S = "#e0e8bd", G = "#5f7350", W = "#a8794f", K = "#1a1f1b";
const PIXEL_ART = {
  snake: [[2, 6, L], [3, 6, L], [4, 6, L], [5, 6, L], [5, 5, L], [5, 4, L], [6, 4, L], [7, 4, S], [7, 2, C]],
  2048: [[3, 3, S], [4, 3, L], [5, 3, G], [6, 3, B], [3, 4, G], [4, 4, C], [5, 4, L], [6, 4, G], [3, 5, B], [4, 5, G], [5, 5, S], [6, 5, C], [3, 6, L], [4, 6, S], [5, 6, G], [6, 6, L]],
  "do-min": [[3, 3, S], [4, 3, S], [5, 3, S], [6, 3, G], [7, 3, G], [3, 4, S], [4, 4, B], [5, 4, S], [6, 4, G], [7, 4, C], [3, 5, S], [4, 5, S], [5, 5, K], [6, 5, G], [7, 5, G], [3, 6, G], [4, 6, G], [5, 6, G], [6, 6, G], [7, 6, G]],
  "pha-gach": [[2, 2, C], [3, 2, C], [4, 2, C], [5, 2, C], [6, 2, C], [7, 2, C], [8, 2, C], [2, 3, S], [3, 3, S], [5, 3, S], [7, 3, S], [8, 3, S], [6, 5, S], [4, 7, L], [5, 7, L], [6, 7, L]],
  "co-caro": [[3, 3, L], [4, 4, L], [5, 5, L], [6, 6, L], [7, 7, L], [4, 3, C], [6, 4, C], [3, 5, C], [5, 6, C]],
  "o-an-quan": [[2, 4, C], [2, 5, C], [3, 4, W], [4, 4, S], [5, 4, W], [6, 4, S], [7, 4, W], [3, 5, S], [4, 5, W], [5, 5, S], [6, 5, W], [7, 5, S], [8, 4, C], [8, 5, C]],
  "co-tuong": [[3, 2, S], [5, 2, S], [7, 2, S], [4, 3, S], [6, 3, S], [2, 5, B], [3, 5, B], [4, 5, B], [5, 5, B], [6, 5, B], [7, 5, B], [8, 5, B], [4, 6, C], [6, 6, C], [3, 7, C], [5, 7, C], [7, 7, C]],
};

let catalogReady = false;
let catalogLoading = false;
let games = [];
let visibleGames = [];
let selectedGameId = null;
let searchOpen = false;
let lastPlayedId = null;
try { lastPlayedId = localStorage.getItem(`${STORAGE_PREFIX}last-played`); } catch { /* Game selection still works when storage is unavailable. */ }
selectedGameId = lastPlayedId;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function readProgress(gameId) {
  try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${gameId}`) || "null"); }
  catch { return null; }
}

function safeGamePath(path) {
  if (typeof path !== "string" || !path.startsWith("./games/")) return null;
  const segments = path.slice(8).split("/");
  if (!segments.length || segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === "." || segment === "..")) return null;
  const resolved = new URL(path, document.baseURI);
  if (resolved.origin !== location.origin || !resolved.pathname.startsWith(new URL("./games/", document.baseURI).pathname)) return null;
  return escapeHTML(path);
}

function gameArt(game) {
  if (game.art === "pvz-goty") {
    return `<div class="pixel-art pixel-art-pvz" aria-hidden="true"></div>`;
  }
  if (game.art === "pikachu") {
    return `<div class="pixel-art pixel-art-pikachu" aria-hidden="true"><span class="pixel-sprite-pikachu"></span></div>`;
  }
  if (game.art === "flappy") {
    return `<div class="pixel-art pixel-art-flappy" aria-hidden="true"><span class="pixel-cloud cloud-a"></span><span class="pixel-cloud cloud-b"></span><i class="pixel-pipe pipe-top"></i><i class="pixel-pipe pipe-bottom"></i><img src="./games/flappy-bird/assets/sprites/yellowbird-midflap.png" alt="" /></div>`;
  }
  if (game.art === "tetris") {
    const blocks = TETRIS_PIXELS.map(([column, row, color]) => `<i class="tetris-pixel" style="--column:${column};--row:${row};--pixel-color:${color}"></i>`).join("");
    return `<div class="pixel-art pixel-art-tetris" aria-hidden="true"><div class="tetris-grid">${blocks}</div></div>`;
  }
  if (Object.hasOwn(PIXEL_ART, game.art)) {
    const blocks = PIXEL_ART[game.art].map(([column, row, color]) => `<i class="tetris-pixel" style="--column:${column};--row:${row};--pixel-color:${color}"></i>`).join("");
    return `<div class="pixel-art pixel-art-tetris" aria-hidden="true"><div class="tetris-grid">${blocks}</div></div>`;
  }
  return `<div class="pixel-art pixel-art-generic" aria-hidden="true"><span>${escapeHTML(String(game.title || "?").slice(0, 2).toUpperCase())}</span></div>`;
}

function updateVisibleGames() {
  if (!catalogReady) return;
  const query = searchInput.value.trim().toLocaleLowerCase("vi");
  visibleGames = games.filter((game) => `${game.title} ${game.category ?? ""} ${game.description ?? ""}`.toLocaleLowerCase("vi").includes(query));
  if (!visibleGames.some((game) => game.id === selectedGameId)) selectedGameId = visibleGames[0]?.id || null;
  renderSelection();
}

function renderSelection() {
  previousButton.disabled = visibleGames.length < 2;
  nextButton.disabled = visibleGames.length < 2;
  if (!visibleGames.length) {
    selection.innerHTML = games.length
      ? `<div class="empty-selection"><span class="empty-pixel" aria-hidden="true">?</span><h1 tabindex="-1">Không tìm thấy game</h1><p>Thử một từ khóa khác hoặc xóa nội dung tìm kiếm.</p></div>`
      : `<div class="empty-selection"><span class="empty-pixel" aria-hidden="true">?</span><h1 tabindex="-1">Chưa có game</h1><p>Thư viện hiện chưa có game. Bạn có thể quay lại sau hoặc góp game mới.</p></div>`;
    positionLabel.textContent = `00 / ${String(games.length).padStart(2, "0")}`;
    statusLabel.textContent = games.length ? "Không có game phù hợp với từ khóa này." : "Thư viện hiện chưa có game.";
    return;
  }

  const index = visibleGames.findIndex((game) => game.id === selectedGameId);
  const game = visibleGames[Math.max(0, index)];
  const progress = readProgress(game.id);
  const bestScore = Number(progress?.bestScore || 0);
  const hasSavedGame = Boolean(progress?.current && !["over", "won"].includes(progress.current.phase));
  const href = safeGamePath(game.path);
  positionLabel.textContent = `${String(index + 1).padStart(2, "0")} / ${String(visibleGames.length).padStart(2, "0")}`;
  statusLabel.textContent = hasSavedGame
    ? `Có thể chơi tiếp ${game.title}; tiến trình đang lưu trên máy này.`
    : "Tiến trình game được lưu trên thiết bị này.";

  selection.innerHTML = `<article class="game-feature" data-game="${escapeHTML(game.id)}">
    <div class="feature-art-wrap">${gameArt(game)}</div>
    <div class="feature-copy">
      <div class="feature-overline">${game.category ? `<span>${escapeHTML(game.category)}</span>` : ""}<span>${hasSavedGame ? "CONTINUE" : "P1"}</span></div>
      <h1>${escapeHTML(game.title)}</h1>
      ${game.description ? `<p class="feature-description">${escapeHTML(game.description)}</p>` : ""}
      <div class="feature-stats">
        <span><small>${escapeHTML(game.recordLabel || "Kỷ lục")}</small><b>${bestScore ? bestScore.toLocaleString("vi-VN") : "—"}</b></span>
      </div>
      ${game.controls ? `<p class="feature-controls">${escapeHTML(game.controls)}</p>` : ""}
      ${href
        ? `<a class="start-game" id="start-game" data-game-id="${escapeHTML(game.id)}" href="${href}"><span class="start-mark" aria-hidden="true">▶</span><span>${hasSavedGame ? "Chơi tiếp" : "Vào chơi"}</span></a>`
        : `<span class="start-game is-unavailable" aria-disabled="true">Chưa có trang chơi</span>`}
    </div>
  </article>`;
}

function moveSelection(direction) {
  if (visibleGames.length < 2) return;
  const index = visibleGames.findIndex((game) => game.id === selectedGameId);
  const nextIndex = (index + direction + visibleGames.length) % visibleGames.length;
  selectedGameId = visibleGames[nextIndex].id;
  renderSelection();
}

function setSearchOpen(open) {
  if (!catalogReady) return;
  searchOpen = open;
  searchForm.classList.toggle("is-open", open);
  screenTools.classList.toggle("is-search-open", open);
  searchToggle.setAttribute("aria-expanded", String(open));
  searchToggle.setAttribute("aria-label", open ? "Đóng tìm game" : "Mở tìm game");
  searchInput.tabIndex = open ? 0 : -1;
  if (open) {
    searchInput.focus();
  } else {
    searchInput.value = "";
    updateVisibleGames();
  }
}

previousButton.addEventListener("click", () => moveSelection(-1));
nextButton.addEventListener("click", () => moveSelection(1));
searchToggle.addEventListener("click", () => setSearchOpen(!searchOpen));
searchForm.addEventListener("submit", (event) => event.preventDefault());
searchInput.addEventListener("input", updateVisibleGames);

document.addEventListener("click", (event) => {
  const startLink = event.target.closest("#start-game");
  if (!startLink) return;
  lastPlayedId = startLink.dataset.gameId;
  try { localStorage.setItem(`${STORAGE_PREFIX}last-played`, lastPlayedId); } catch { /* Navigation does not depend on browser storage. */ }
});

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if (event.key === "/" && !typing && !searchOpen) {
    event.preventDefault();
    setSearchOpen(true);
  } else if (event.key === "Escape" && searchOpen) {
    setSearchOpen(false);
    searchToggle.focus();
  } else if (!typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === "ArrowLeft") moveSelection(-1);
    if (event.key === "ArrowRight") moveSelection(1);
    if (event.key === "Enter" && document.activeElement === document.body) document.querySelector("#start-game")?.click();
  }
});

async function loadCatalog(retry = false) {
  if (catalogLoading) return;
  catalogLoading = true;
  catalogReady = false;
  searchToggle.disabled = searchInput.disabled = previousButton.disabled = nextButton.disabled = true;
  selection.setAttribute("aria-busy", "true");
  selection.innerHTML = `<div class="selection-loading"><span class="loader-pixel" aria-hidden="true"></span>Đang tải thư viện...</div>`;
  statusLabel.textContent = "Đang tải thư viện...";
  positionLabel.textContent = "00 / 00";
  try {
    const response = await fetch("./games.json?v=5", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Catalog unavailable");
    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.some((game) => !game || typeof game !== "object" ||
      typeof game.id !== "string" || !game.id || typeof game.title !== "string" || !game.title ||
      ["category", "description", "controls", "path", "recordLabel"].some((key) => game[key] != null && typeof game[key] !== "string"))) {
      throw new Error("Invalid catalog");
    }
    games = catalog;
    selectedGameId = games.some((game) => game.id === lastPlayedId)
      ? lastPlayedId
      : games.find((game) => game.id === "tetris")?.id || games[0]?.id || null;
    catalogReady = true;
    searchToggle.disabled = searchInput.disabled = !games.length;
    updateVisibleGames();
    if (retry) {
      const heading = selection.querySelector("h1");
      if (heading) heading.tabIndex = -1;
      (selection.querySelector("#start-game") || heading)?.focus();
    }
  } catch {
    selection.innerHTML = `<div class="empty-selection"><span class="empty-pixel" aria-hidden="true">!</span><h1>Không tải được thư viện</h1><p>Kiểm tra kết nối mạng rồi thử lại.</p><button class="start-game" id="retry-catalog" type="button">Thử lại</button></div>`;
    statusLabel.textContent = "Không tải được thư viện. Kiểm tra kết nối mạng rồi thử lại.";
    if (retry) selection.querySelector("#retry-catalog").focus();
  } finally {
    catalogLoading = false;
    selection.setAttribute("aria-busy", "false");
  }
}

selection.addEventListener("click", (event) => {
  if (event.target.closest("#retry-catalog")) loadCatalog(true);
});
await loadCatalog();
