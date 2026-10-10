// Auxiliary browser storage/display hooks. The game's menus, artwork and audio are supplied unchanged.
import { readBundle, writeBundle, validateSize } from './storage.js';

const RESOURCE_KEY = 'resources';
let restoring = true;
let cacheQueue = Promise.resolve();
let renderHeight = 'auto';
const originalRefresh = window.refreshUI;
const originalStart = window.startGame;
const originalSync = window.syncSaves;

function cacheMessage(message) {
  const note = document.querySelector('#upload-screen p.note');
  if (note) note.textContent = message;
}

function rememberedFiles() {
  const entries = [...collectedFiles.entries()].map(([name, blob]) => ({ name, blob }));
  validateSize(entries, 384 * 1048576);
  return entries;
}

window.refreshUI = function () {
  originalRefresh();
  if (restoring || !hasPak || !hasProperties) return;
  let files;
  try { files = rememberedFiles(); }
  catch (error) { cacheMessage(error.message); return; }
  const snapshot = { version: 1, files };
  cacheQueue = cacheQueue.then(() => writeBundle(RESOURCE_KEY, snapshot)).then(() => {
    cacheMessage('Resources are remembered on this device. Next time, just click Start Game. Files stay local and are never uploaded.');
  }).catch(() => {
    cacheMessage('Resources are ready for this session, but this browser could not remember them. Free storage space or import again next time. Export saves before clearing browser data.');
  });
};

window.startGame = async function () {
  // No asset is added, recolored, redrawn, replaced with another design, or re-encoded here.
  rememberedFiles();
  const size = frameSize();
  Module.mayWidth = size.width;
  Module.mayHeight = size.height;
  Module.maySmooth = true;
  await cacheQueue;
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
  await originalStart();
};

function frameSize() {
  const container = document.getElementById('canvas-container');
  const cssHeight = Math.max(1, Math.floor(Math.min(container.clientHeight || innerHeight, (container.clientWidth || innerWidth) * 3 / 4)));
  const height = renderHeight === 'auto'
    ? Math.min(2160, Math.max(600, Math.round(cssHeight * (devicePixelRatio || 1) / 3) * 3))
    : renderHeight;
  return { width: height * 4 / 3, height, cssHeight };
}

window.resizeCanvas = function () {
  const canvas = document.getElementById('canvas');
  const size = frameSize();
  if (gameStarted && typeof Module._may_resize === 'function') Module._may_resize(size.width, size.height);
  canvas.style.width = Math.floor(size.cssHeight * 4 / 3) + 'px';
  canvas.style.height = size.cssHeight + 'px';
};
window.mayOnWindow = window.resizeCanvas;

// Optional host setting, outside the original game UI: 600 / 1080 / 1440 / 2160 / auto.
window.MayGamePvzQuality = Object.freeze({
  setRenderHeight(height) {
    if (![600, 1080, 1440, 2160, 'auto'].includes(height)) throw new Error('Unsupported render height.');
    renderHeight = height;
    window.resizeCanvas();
  },
});

window.syncSaves = async function () {
  try {
    await originalSync();
    if (!savesMounted || !Module.FS) return;
    const files = collectSaveFiles('/may-game-pvz-goty-saves/userdata');
    if (!files.length) return;
    try {
      localStorage.setItem('may-game:v1:pvz-goty', JSON.stringify({ version: 1, bestScore: 0, current: { phase: 'saved' }, updatedAt: Date.now() }));
    } catch { /* Save files remain in IndexedDB even if catalog metadata is unavailable. */ }
  } catch (error) {
    const button = document.getElementById('save-export-btn');
    if (button) button.textContent = 'Export Saves — auto-save failed';
    cacheMessage('Auto-save failed. Export your saves before leaving or clearing browser data.');
    throw error;
  }
};

try {
  const cached = await readBundle(RESOURCE_KEY);
  if (cached?.version === 1 && Array.isArray(cached.files)) {
    validateSize(cached.files, 384 * 1048576);
    for (const entry of cached.files) {
      const safe = normalizeResourcePath(entry.name);
      if (safe && entry.blob instanceof Blob) collectedFiles.set(safe, entry.blob);
    }
    originalRefresh();
    if (hasPak && hasProperties) cacheMessage('Resources restored from this device. Click Start Game. Your imported artwork, animations and audio are used unchanged.');
  }
} catch {
  cacheMessage('This browser could not read remembered resources. Import your game files to play.');
} finally {
  restoring = false;
}
