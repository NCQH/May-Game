// Auxiliary browser storage/display hooks. The game's menus, artwork and audio are supplied unchanged.
import { readBundle, writeBundle, validateSize } from './storage.js';

const RESOURCE_KEY = 'resources';
let restoring = true;
let resourceRevision = null;
let cacheQueue = Promise.resolve();
const requestedHeight = new URLSearchParams(location.search).get('renderHeight');
let renderHeight = [600, 1080, 1440, 2160].includes(Number(requestedHeight)) ? Number(requestedHeight) : 'auto';
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
  const snapshot = { version: 1, revision: resourceRevision, files };
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
function resumeOriginalAudio() {
  const audio = Module.SDL2?.audioContext;
  if (audio?.state === 'suspended') void audio.resume().catch(() => {});
}
document.getElementById('canvas').addEventListener('pointerdown', resumeOriginalAudio, { passive: true });
document.addEventListener('keydown', resumeOriginalAudio);

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
    resourceRevision = typeof cached.revision === 'string' ? cached.revision : null;
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


// Bootstrap from local/deployment resources. No folder chooser or upload step.
const bootStatus = document.createElement('div');
bootStatus.setAttribute('role', 'status');
bootStatus.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:#000;color:#ddd;font:16px Arial,sans-serif;text-align:center';
bootStatus.textContent = 'Đang khởi động Plants vs. Zombies GOTY…';
document.body.append(bootStatus);

async function loadHostedResources() {
  let response;
  try { response = await fetch(new URL('./resources.json', import.meta.url), { cache: 'no-cache' }); }
  catch (error) { if (hasPak && hasProperties) return; throw error; }
  if (!response.ok) {
    if (hasPak && hasProperties) return;
    throw new Error('Chưa tìm thấy dữ liệu GOTY trên máy chủ này.');
  }
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 10000) throw new Error('Danh sách dữ liệu GOTY không hợp lệ.');
  if (hasPak && hasProperties && typeof manifest.revision === 'string' && manifest.revision === resourceRevision) return;
  const staged = new Map();
  let bytes = 0;
  for (const entry of manifest.files) {
    const name = normalizeResourcePath(entry.name);
    if (!name || name !== entry.name || staged.has(name)) throw new Error('Đường dẫn dữ liệu GOTY không hợp lệ.');
    const file = await fetch(new URL('./data/' + name, import.meta.url));
    if (!file.ok) throw new Error('Không tải được dữ liệu GOTY: ' + name);
    if (Number(file.headers.get('content-length')) > 128 * 1048576) throw new Error('Tệp GOTY quá lớn.');
    const blob = await file.blob();
    bytes += blob.size;
    if (blob.size > 128 * 1048576 || bytes > 384 * 1048576) throw new Error('Dữ liệu vượt giới hạn bộ nhớ trình duyệt.');
    staged.set(name, blob);
  }
  if (!staged.has('main.pak') || ![...staged.keys()].some(name => name.startsWith('properties/'))) throw new Error('Thiếu dữ liệu GOTY.');
  collectedFiles.clear();
  resourceRevision = typeof manifest.revision === 'string' ? manifest.revision : null;
  for (const [name, blob] of staged) collectedFiles.set(name, blob);
  window.refreshUI();
}

try {
  await loadHostedResources();
  await window.startGame();
  if (!gameStarted) throw new Error(document.getElementById('load-status').textContent || 'Không khởi động được GOTY.');
  bootStatus.remove();
} catch (error) {
  bootStatus.textContent = error.message;
}
