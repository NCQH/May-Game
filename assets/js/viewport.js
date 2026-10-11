// Keep the complete cabinet visible, including controls, when space is limited.
const stage = document.querySelector('main.arcade-main, main.game-page');
if (stage) {
  let frame = 0;
  const fit = () => {
    frame = 0;
    if (document.fullscreenElement) { stage.style.setProperty('--viewport-scale', '1'); return; }
    const body = getComputedStyle(document.body);
    const width = document.documentElement.clientWidth - parseFloat(body.paddingLeft) - parseFloat(body.paddingRight);
    const height = document.documentElement.clientHeight - parseFloat(body.paddingTop) - parseFloat(body.paddingBottom) - 8;
    const scale = Math.min(1, width / Math.max(stage.offsetWidth, stage.scrollWidth), height / Math.max(stage.offsetHeight, stage.scrollHeight));
    stage.style.setProperty('--viewport-scale', String(Math.max(.01, scale)));
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
  const sizes = new ResizeObserver(schedule);
  sizes.observe(stage);
  stage.querySelectorAll('.arcade-cabinet, .arcade-screen, .arcade-game-content, .page-content').forEach(node => sizes.observe(node));
  new MutationObserver(schedule).observe(stage, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  document.addEventListener('fullscreenchange', schedule);
  document.fonts.ready.then(schedule);
  schedule();
}
