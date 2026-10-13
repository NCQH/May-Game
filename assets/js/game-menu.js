const menu = document.querySelector("#game-menu");
const toggle = document.querySelector("#game-menu-toggle");
if (menu && toggle) {
  toggle.addEventListener("click", () => {
    const opening = new CustomEvent("game-menu-open", { cancelable: true });
    if (!document.dispatchEvent(opening)) return;
    menu.showModal();
    toggle.setAttribute("aria-expanded", "true");
  });
  let restoreFocus = false;
  menu.addEventListener("cancel", () => { restoreFocus = true; });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("[data-menu-close]")) { restoreFocus = true; menu.close(); }
  });
  menu.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && !document.querySelector("dialog[open]")) toggle.focus({ preventScroll: true });
    restoreFocus = false;
  });
}
