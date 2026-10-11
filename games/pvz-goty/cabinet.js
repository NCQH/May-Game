const cabinet = document.getElementById('pvz-cabinet');
const resolution = document.getElementById('pvz-resolution');
const fullscreen = document.getElementById('pvz-fullscreen');
const pageTitle = 'Plants vs. Zombies GOTY — Máy Game';
const titleNode = document.querySelector('title');
new MutationObserver(() => {
  if (document.title !== pageTitle) document.title = pageTitle;
}).observe(titleNode, { childList: true, subtree: true, characterData: true });
document.title = pageTitle;
const requested = new URLSearchParams(location.search).get('renderHeight');
resolution.value = ['1080', '1440', '2160'].includes(requested) ? requested : 'auto';
resolution.addEventListener('change', () => {
  window.MayGamePvzQuality?.setRenderHeight(resolution.value === 'auto' ? 'auto' : Number(resolution.value));
});
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await cabinet.requestFullscreen();
  } catch { fullscreen.textContent = 'Không hỗ trợ toàn màn hình'; }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? 'Thoát toàn màn hình' : 'Toàn màn hình';
  window.resizeCanvas?.();
});
new ResizeObserver(() => window.resizeCanvas?.()).observe(document.getElementById('canvas-container'));
