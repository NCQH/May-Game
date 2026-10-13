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
const TETRIS_PIXELS = [
  [3, 2, "#f5d563"], [4, 2, "#f5d563"], [3, 3, "#f5d563"], [4, 3, "#f5d563"],
  [1, 5, "#52d7ed"], [2, 5, "#52d7ed"], [3, 5, "#52d7ed"], [3, 4, "#52d7ed"],
  [5, 5, "#bc91f2"], [6, 5, "#bc91f2"], [7, 5, "#bc91f2"], [6, 4, "#bc91f2"],
  [2, 7, "#f5b16e"], [3, 7, "#f5b16e"], [4, 7, "#f5b16e"], [4, 6, "#f5b16e"],
];

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
  return `<div class="pixel-art pixel-art-generic" aria-hidden="true"><span>${escapeHTML(String(game.title || "?").slice(0, 2).toUpperCase())}</span></div>`;
}

function updateVisibleGames() {
  if (!catalogReady) return;
  const query = searchInput.value.trim().toLocaleLowerCase("vi");
  visibleGames = games.filter((game) => `${game.title} ${game.category} ${game.description}`.toLocaleLowerCase("vi").includes(query));
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
      <div class="feature-overline"><span>${escapeHTML(game.category)}</span><span>${hasSavedGame ? "CONTINUE" : "P1"}</span></div>
      <h1>${escapeHTML(game.title)}</h1>
      <p class="feature-description">${escapeHTML(game.description)}</p>
      <div class="feature-stats">
        <span><small>Kỷ lục</small><b>${bestScore ? bestScore.toLocaleString("vi-VN") : "—"}</b></span>
      </div>
      <p class="feature-controls">${escapeHTML(game.controls)}</p>
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
    const response = await fetch("./games.json?v=4", { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Catalog unavailable");
    const catalog = await response.json();
    if (!Array.isArray(catalog) || catalog.some((game) => !game || typeof game !== "object" ||
      typeof game.id !== "string" || !game.id || typeof game.title !== "string" || !game.title ||
      ["category", "description", "controls", "path"].some((key) => game[key] != null && typeof game[key] !== "string"))) {
      throw new Error("Invalid catalog");
    }
    games = catalog;
    selectedGameId = games.some((game) => game.id === lastPlayedId)
      ? lastPlayedId
      : games.find((game) => game.id === "tetris")?.id || games[0]?.id || null;
    catalogReady = true;
    searchToggle.disabled = searchInput.disabled = !games.length;
    updateVisibleGames();
    if (retry) (selection.querySelector("#start-game") || selection.querySelector("h1"))?.focus();
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
