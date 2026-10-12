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
  const cssHeight = Math.max(1, Math.floor(Math.min(container.clientHeight || innerHeight, (container.clientWidth || innerWidth) * 9 / 16)));
  const height = renderHeight === 'auto'
    ? Math.min(2160, Math.max(600, Math.round(cssHeight * (devicePixelRatio || 1) / 3) * 3))
    : renderHeight;
  return { width: Math.round(height * 16 / 9), height, cssHeight };
}

window.resizeCanvas = function () {
  const canvas = document.getElementById('canvas');
  const size = frameSize();
  if (gameStarted && typeof Module._may_resize === 'function') Module._may_resize(size.width, size.height);
  canvas.style.width = Math.floor(size.cssHeight * 16 / 9) + 'px';
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
    document.getElementById('save-warning')?.remove();
    const exportButton = document.getElementById('save-export-btn');
    if (exportButton) exportButton.textContent = 'Tải bản lưu';
    if (!savesMounted || !Module.FS) return;
    const files = collectSaveFiles('/may-game-pvz-goty-saves/userdata');
    if (!files.length) return;
    try {
      localStorage.setItem('may-game:v1:pvz-goty', JSON.stringify({ version: 1, bestScore: 0, current: { phase: 'saved' }, updatedAt: Date.now() }));
    } catch { /* Save files remain in IndexedDB even if catalog metadata is unavailable. */ }
  } catch (error) {
    const button = document.getElementById('save-export-btn');
    if (button) button.textContent = 'Tải bản lưu — lỗi tự lưu';
    cacheMessage('Tự lưu thất bại. Hãy tải bản lưu trước khi rời trang hoặc xóa dữ liệu trình duyệt.');
    let warning = document.getElementById('save-warning');
    if (!warning) {
      warning = document.createElement('p');
      warning.id = 'save-warning';
      warning.setAttribute('role', 'alert');
      document.querySelector('.pvz-deck').append(warning);
    }
    warning.textContent = 'Tự lưu thất bại — nhấn “Tải bản lưu” để giữ tiến trình trên máy.';
    throw error;
  }
};

try {
  const cached = await readBundle(RESOURCE_KEY);
  if (cached?.version === 1 && Array.isArray(cached.files)) {
    validateSize(cached.files, 384 * 1048576);
    const restored = new Map();
    for (const entry of cached.files) {
      const safe = normalizeResourcePath(entry.name);
      if (!safe || safe !== entry.name || !(entry.blob instanceof Blob) || restored.has(safe)) throw new Error('Invalid remembered resource.');
      restored.set(safe, entry.blob);
    }
    if (!restored.has('main.pak') || ![...restored.keys()].some(name => name.startsWith('properties/'))) throw new Error('Incomplete remembered resources.');
    resourceRevision = typeof cached.revision === 'string' ? cached.revision : null;
    for (const [name, blob] of restored) collectedFiles.set(name, blob);
    originalRefresh();
    if (hasPak && hasProperties) cacheMessage('Resources restored from this device. Click Start Game. Your imported artwork, animations and audio are used unchanged.');
  }
} catch (error) {
  console.warn('Could not restore GOTY resources:', error);
  cacheMessage('This browser could not read remembered resources. Import your game files to play.');
} finally {
  restoring = false;
}


// Bootstrap from local/deployment resources. No folder chooser or upload step.
const bootStatus = document.createElement('div');
bootStatus.setAttribute('role', 'status');
bootStatus.className = 'pvz-boot-status';
bootStatus.textContent = 'Đang khởi động Plants vs. Zombies GOTY…';
document.querySelector('.pvz-display').append(bootStatus);

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
  const names = new Set();
  for (const entry of manifest.files) {
    const name = normalizeResourcePath(entry.name);
    if (!name || name !== entry.name || names.has(name)) throw new Error('Đường dẫn dữ liệu GOTY không hợp lệ.');
    names.add(name);
  }
  const queue = [...names];
  const abort = new AbortController();
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < queue.length && !abort.signal.aborted) {
      const name = queue[next++];
      const file = await fetch(new URL('./data/' + name, import.meta.url), { signal: abort.signal, cache: 'no-cache' });
      if (!file.ok) throw new Error('Không tải được dữ liệu GOTY: ' + name);
      if (Number(file.headers.get('content-length')) > 128 * 1048576) throw new Error('Tệp GOTY quá lớn.');
      const blob = await file.blob();
      bytes += blob.size;
      if (blob.size > 128 * 1048576 || bytes > 384 * 1048576) throw new Error('Dữ liệu vượt giới hạn bộ nhớ trình duyệt.');
      staged.set(name, blob);
      completed++;
      bootStatus.textContent = `Đang tải dữ liệu: ${completed}/${queue.length} tệp · ${Math.round(completed / queue.length * 100)}% · ${(bytes / 1048576).toFixed(1)} MB…`;
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker)); }
  catch (error) { abort.abort(); throw error; }
  if (!staged.has('main.pak') || ![...staged.keys()].some(name => name.startsWith('properties/'))) throw new Error('Thiếu dữ liệu GOTY.');
  collectedFiles.clear();
  resourceRevision = typeof manifest.revision === 'string' ? manifest.revision : null;
  for (const [name, blob] of staged) collectedFiles.set(name, blob);
  window.refreshUI();
}

try {
  try { await loadHostedResources(); }
  catch (error) {
    // A failed update must not replace the last complete local bundle.
    if (!hasPak || !hasProperties) throw error;
    cacheMessage('Không cập nhật được dữ liệu. Đang dùng bộ dữ liệu đã lưu trên thiết bị.');
    console.warn('Using remembered GOTY resources:', error);
  }
  bootStatus.textContent = 'Đang khởi động Plants vs. Zombies GOTY…';
  await window.startGame();
  if (!gameStarted) throw new Error(loadStatus.textContent || 'Không khởi động được GOTY.');
  bootStatus.remove();
} catch (error) {
  bootStatus.textContent = error.message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'game-button';
  retry.textContent = 'Thử lại';
  retry.style.cssText = 'display:block;margin:12px auto 0;min-height:44px';
  retry.addEventListener('click', () => location.reload());
  bootStatus.append(retry);
}
