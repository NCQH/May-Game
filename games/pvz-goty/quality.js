// Auxiliary browser storage/display hooks. The game's menus, artwork and audio are supplied unchanged.
import { readBundle, writeBundle, validateSize, validateSaveImport } from './storage.js';

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
    cacheMessage('Tài nguyên đã được lưu trên thiết bị. Lần sau chỉ cần nhấn Vào chơi. Tệp chỉ lưu cục bộ, không gửi lên máy chủ.');
  }).catch(() => {
    cacheMessage('Tài nguyên đã sẵn sàng cho lần chơi này nhưng trình duyệt không lưu lại được. Hãy giải phóng dung lượng hoặc nạp lại lần sau. Tải bản lưu trước khi xóa dữ liệu trình duyệt.');
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
    if (![600, 1080, 1440, 2160, 'auto'].includes(height)) throw new Error('Độ phân giải không được hỗ trợ.');
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

const saveImportButton = document.getElementById('save-import-btn');
const saveImportInput = document.getElementById('save-import-input');
saveImportButton.addEventListener('click', () => saveImportInput.click());
saveImportInput.addEventListener('change', async () => {
  const file = saveImportInput.files[0];
  if (!file) return;
  saveImportButton.disabled = true;
  saveImportButton.textContent = 'Đang nạp save…';
  try {
    if (file.size > 64 * 1048576) throw new Error('ZIP save vượt giới hạn 64 MiB.');
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (entries.length > 1000) throw new Error('Save có quá nhiều tệp (tối đa 1000).');
    const files = [];
    let bytes = 0;
    for (const entry of entries) {
      const name = normalizeSaveImportPath(entry.unsafeOriginalName || entry.name);
      if (!name) throw new Error('Đường dẫn save không hợp lệ.');
      if (bytes + (entry._data?.uncompressedSize || 0) > 64 * 1048576) throw new Error('Save vượt giới hạn 64 MiB.');
      const data = await entry.async('uint8array');
      bytes += data.length;
      if (bytes > 64 * 1048576) throw new Error('Save vượt giới hạn 64 MiB.');
      files.push({ name, blob: new Blob([data]) });
    }
    const bundle = validateSaveImport({ version: 1, files });
    if (!confirm('Nạp save sẽ ghi đè các tệp trùng tên và tải lại game. Hãy tải bản lưu trước nếu cần giữ tiến trình hiện tại. Tiếp tục?')) return;
    await ensureSaveFsReady();
    await window.syncSaves();
    await writeBundle('pending-save-import', bundle);
    location.reload();
  } catch (error) {
    alert('Không nạp được save: ' + error.message);
  } finally {
    saveImportInput.value = '';
    saveImportButton.disabled = false;
    saveImportButton.textContent = 'Nạp save';
  }
});

// ponytail: ZIP only; stage across reload so a running engine cannot overwrite imported profiles.
window.applyPendingSaveImport = async function () {
  const pending = await readBundle('pending-save-import');
  if (!pending) return;
  const bundle = validateSaveImport(pending);
  const root = '/may-game-pvz-goty-saves/userdata/';
  const staged = [];
  for (const entry of bundle.files) {
    const full = root + entry.name;
    let previous = null;
    if (Module.FS.analyzePath(full).exists) {
      if (Module.FS.isDir(Module.FS.stat(full).mode)) throw new Error('Save xung đột với thư mục hiện có.');
      previous = Module.FS.readFile(full).slice();
    }
    staged.push({ full, previous, bytes: new Uint8Array(await entry.blob.arrayBuffer()) });
  }
  const written = [];
  try {
    for (const entry of staged) {
      const parts = entry.full.split('/');
      let dir = '';
      for (const part of parts.slice(1, -1)) {
        dir += '/' + part;
        if (!Module.FS.analyzePath(dir).exists) Module.FS.mkdir(dir);
        else if (!Module.FS.isDir(Module.FS.stat(dir).mode)) throw new Error('Save xung đột với tệp hiện có.');
      }
      written.push(entry);
      Module.FS.writeFile(entry.full, entry.bytes);
    }
    await window.syncSaves();
  } catch (error) {
    for (const entry of written.reverse()) {
      if (entry.previous) Module.FS.writeFile(entry.full, entry.previous);
      else if (Module.FS.analyzePath(entry.full).exists) Module.FS.unlink(entry.full);
    }
    // Restore any persistent writes too; the pending bundle remains available for retry.
    try { await window.syncSaves(); } catch { /* The existing warning keeps export available. */ }
    throw new Error('Không áp dụng được save. Đã khôi phục bản lưu trong bộ nhớ; hãy tải bản lưu nếu tự lưu vẫn lỗi. ' + error.message);
  }
  await writeBundle('pending-save-import', null);
};

try {
  const cached = await readBundle(RESOURCE_KEY);
  if (cached?.version === 1 && Array.isArray(cached.files)) {
    validateSize(cached.files, 384 * 1048576);
    const restored = new Map();
    for (const entry of cached.files) {
      const safe = normalizeResourcePath(entry.name);
      if (!safe || safe !== entry.name || !(entry.blob instanceof Blob) || restored.has(safe)) throw new Error('Tài nguyên đã lưu không hợp lệ.');
      restored.set(safe, entry.blob);
    }
    if (!restored.has('main.pak') || ![...restored.keys()].some(name => name.startsWith('properties/'))) throw new Error('Bộ tài nguyên đã lưu chưa đầy đủ.');
    resourceRevision = typeof cached.revision === 'string' ? cached.revision : null;
    for (const [name, blob] of restored) collectedFiles.set(name, blob);
    originalRefresh();
    if (hasPak && hasProperties) cacheMessage('Đã khôi phục tài nguyên từ thiết bị. Nhấn Vào chơi. Artwork, chuyển động và âm thanh gốc được giữ nguyên.');
  }
} catch (error) {
  console.warn('Could not restore GOTY resources:', error);
  cacheMessage('Trình duyệt không đọc được tài nguyên đã lưu. Hãy nạp lại tệp game để chơi.');
} finally {
  restoring = false;
}


// Bootstrap from local/deployment resources. No folder chooser or upload step.
const bootStatus = document.createElement('div');
bootStatus.setAttribute('role', 'status');
bootStatus.className = 'pvz-boot-status';
const bootMessage = document.createElement('span');
bootMessage.textContent = 'Đang kiểm tra dữ liệu GOTY…';
const bootProgress = document.createElement('progress');
bootProgress.setAttribute('aria-label', 'Tiến độ tải dữ liệu theo tệp');
bootStatus.append(bootMessage, bootProgress);
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
  bootProgress.max = Math.max(1, queue.length);
  bootProgress.value = 0;
  bootMessage.textContent = `Đang tải dữ liệu: 0/${queue.length} tệp hoàn tất. Lần đầu có thể mất vài phút…`;
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
      bootProgress.value = completed;
      bootMessage.textContent = `Đang tải dữ liệu: ${completed}/${queue.length} tệp hoàn tất · ${(bytes / 1048576).toFixed(1)} MB đã tải…`;
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
  bootMessage.textContent = 'Dữ liệu đã sẵn sàng. Đang khởi động engine GOTY…';
  bootProgress.removeAttribute('value');
  bootProgress.setAttribute('aria-label', 'Đang khởi động engine');
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
