const menu = document.querySelector("#game-menu");
const toggle = document.querySelector("#game-menu-toggle");
if (menu && toggle) {
  toggle.addEventListener("click", () => {
    const opening = new CustomEvent("game-menu-open", { cancelable: true });
    if (!document.dispatchEvent(opening)) return;
    menu.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  // Esc opens the menu (and so pauses); the open dialog's own Esc handling closes it.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.repeat || event.defaultPrevented || menu.dataset.escape === "off" || document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    toggle.click();
  });
  let restoreFocus = false;
  menu.addEventListener("cancel", () => { restoreFocus = true; });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("[data-menu-close]")) { restoreFocus = true; menu.close(); }
  });
  menu.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    // Return to the board, not the toggle: Space/Enter on a focused toggle would reopen the menu mid-game.
    const board = menu.dataset.returnFocus && document.querySelector(menu.dataset.returnFocus);
    const target = board?.getClientRects().length ? board : toggle;
    if (restoreFocus && !document.querySelector("dialog[open]")) target.focus({ preventScroll: true });
    restoreFocus = false;
  });
}
