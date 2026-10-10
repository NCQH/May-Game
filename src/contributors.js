const contributorList = document.querySelector("#contributor-list");
const contributorCount = document.querySelector("#contributor-count");
const emptyState = document.querySelector("#directory-empty");
const emptyTitle = document.querySelector("#directory-empty-title");
const emptyCopy = document.querySelector("#directory-empty-copy");
const uncreditedSection = document.querySelector("#uncredited-games");
const uncreditedList = document.querySelector("#uncredited-list");

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function safeGamePath(path) {
  return typeof path === "string" && path.startsWith("./games/") && !path.split("/").includes("..")
    ? escapeHTML(path)
    : null;
}

function githubProfile(username) {
  if (typeof username !== "string") return null;
  const clean = username.trim().replace(/^@/, "");
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(clean)
    ? `https://github.com/${encodeURIComponent(clean)}`
    : null;
}

function normalizeContributor(value) {
  if (typeof value === "string") return { name: value.trim(), username: "", profile: null };
  if (!value || typeof value !== "object" || typeof value.name !== "string") return null;
  const name = value.name.trim();
  const username = typeof value.github === "string" ? value.github.trim().replace(/^@/, "") : "";
  return name ? { name, username, profile: githubProfile(username) } : null;
}

function contributorKey(person) {
  return (person.username || person.name).normalize("NFKC").toLocaleLowerCase("vi");
}

function renderContributor(person, escape) {
  const title = escape(person.name);
  const handle = person.username ? `<a class="contributor-profile" href="${person.profile}" target="_blank" rel="noreferrer">@${escape(person.username)}</a>` : "";
  const games = person.games.map((game) => {
    const href = safeGamePath(game.path);
    const name = escape(game.title || game.id || "Game");
    const category = game.category ? `<small>${escape(game.category)}</small>` : "";
    return `<li>${href
      ? `<a class="contributor-game" href="${href}"><span>${name}</span>${category}</a>`
      : `<span class="contributor-game"><span>${name}</span>${category}</span>`}</li>`;
  }).join("");

  return `<article class="contributor-card">
    <div class="contributor-card-head">
      <span class="contributor-avatar" aria-hidden="true">${escape(person.name.slice(0, 2))}</span>
      <div><h2 class="contributor-name">${title}</h2>${handle}</div>
    </div>
    <ul class="contributor-games" aria-label="Game đã đóng góp">${games}</ul>
  </article>`;
}

try {
  const response = await fetch("./games.json?v=2");
  if (!response.ok) throw new Error("Catalog unavailable");
  const games = await response.json();
  const contributors = new Map();
  const creditedGameIds = new Set();

  games.forEach((game) => {
    const people = Array.isArray(game.contributors) ? game.contributors : [];
    people.forEach((value) => {
      const person = normalizeContributor(value);
      if (!person) return;
      const key = contributorKey(person);
      if (!contributors.has(key)) contributors.set(key, { ...person, games: [] });
      const entry = contributors.get(key);
      if (!entry.username && person.username) {
        entry.username = person.username;
        entry.profile = person.profile;
      }
      if (!entry.games.some((creditedGame) => creditedGame.id === game.id)) entry.games.push(game);
      creditedGameIds.add(game.id);
    });
  });

  const ordered = [...contributors.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  contributorCount.textContent = `${ordered.length} NGƯỜI · ${creditedGameIds.size}/${games.length} GAME CÓ NGƯỜI GÓP`;
  contributorList.innerHTML = ordered.map((person) => renderContributor(person, escapeHTML)).join("");
  emptyState.hidden = ordered.length > 0;
  uncreditedSection.hidden = creditedGameIds.size === games.length;
  uncreditedList.innerHTML = games
    .filter((game) => !creditedGameIds.has(game.id))
    .map((game) => {
      const href = safeGamePath(game.path);
      const title = escapeHTML(game.title || game.id || "Game");
      return href
        ? `<a class="uncredited-game" href="${href}"><span>${title}</span><small>Chưa ghi nhận</small></a>`
        : `<span class="uncredited-game"><span>${title}</span><small>Chưa ghi nhận</small></span>`;
    }).join("");
} catch {
  contributorCount.textContent = "KHÔNG TẢI ĐƯỢC";
  emptyTitle.textContent = "Chưa tải được danh sách";
  emptyCopy.textContent = "Hãy mở trang qua GitHub Pages hoặc máy chủ web để đọc games.json.";
  emptyState.hidden = false;
  uncreditedSection.hidden = true;
}
