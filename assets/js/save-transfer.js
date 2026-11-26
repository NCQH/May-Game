// One-time save migration helpers for migrate.html.
// localStorage belongs to an origin, so export on the old site and import on the new one.
const PREFIX = "may-game:v1:";
// PvZ saves live in IndexedDB; use its in-game Export/Import ZIP instead.
const SKIP = new Set([`${PREFIX}pvz-goty`]);
const MAX_RECORDS = 1000;
const MAX_CHARS = 8 * 1024 * 1024;
const KEY_PATTERN = /^may-game:v1:[a-z0-9-]+$/;

function normalizeRecords(records) {
  if (!records || typeof records !== "object" || Array.isArray(records)) throw new Error("Tệp sao lưu không có danh sách game.");
  const keys = Object.keys(records);
  if (!keys.length) throw new Error("Tệp sao lưu không có dữ liệu game.");
  if (keys.length > MAX_RECORDS) throw new Error("Tệp sao lưu có quá nhiều mục.");
  const out = {};
  let chars = 0;
  for (const key of keys) {
    if (!KEY_PATTERN.test(key) || SKIP.has(key)) continue;
    const value = records[key];
    if (typeof value !== "string") throw new Error(`Dữ liệu của ${key} không hợp lệ.`);
    chars += key.length + value.length;
    if (chars > MAX_CHARS) throw new Error("Tệp sao lưu quá lớn.");
    out[key] = value;
  }
  if (!Object.keys(out).length) throw new Error("Tệp không có dữ liệu cho các game trên trang này.");
  return out;
}

function snapshot(storage, now = Date.now()) {
  const records = {};
  let chars = 0;
  let count = 0;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !KEY_PATTERN.test(key) || SKIP.has(key)) continue;
    const value = storage.getItem(key);
    if (typeof value !== "string") continue;
    chars += key.length + value.length;
    if (chars > MAX_CHARS || ++count > MAX_RECORDS) throw new Error("Dữ liệu lưu quá lớn để chuyển.");
    records[key] = value;
  }
  return {
    schemaVersion: 1,
    exportedAt: now,
    origin: typeof location !== "undefined" && typeof location.origin === "string" ? location.origin : "",
    records,
  };
}

function parseBackup(text) {
  if (typeof text !== "string" || text.length > MAX_CHARS) throw new Error("Tệp sao lưu quá lớn.");
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("Tệp không phải JSON hợp lệ."); }
  if (!data || data.schemaVersion !== 1) throw new Error("Tệp sao lưu không đúng định dạng.");
  return {
    schemaVersion: 1,
    exportedAt: Number(data.exportedAt) || 0,
    origin: typeof data.origin === "string" ? data.origin : "",
    records: normalizeRecords(data.records),
  };
}

function applyBackup(storage, backup) {
  const records = normalizeRecords(backup?.records);
  let written = 0;
  for (const [key, value] of Object.entries(records)) {
    storage.setItem(key, value);
    written++;
  }
  return written;
}

const api = { snapshot, parseBackup, applyBackup };
if (typeof module !== "undefined") module.exports = api;
globalThis.MayGameSaveTransfer = api;

if (typeof document !== "undefined") {
  const byId = (id) => document.getElementById(id);
  const exportButton = byId("save-export");
  const exportCount = byId("save-count");
  const exportStatus = byId("save-export-status");
  const importInput = byId("save-import-input");
  const importChoose = byId("save-import-choose");
  const importButton = byId("save-import-button");
  const importSummary = byId("save-import-summary");
  const importStatus = byId("save-import-status");
  const reloadButton = byId("save-reload");
  let pending = null;

  function setStatus(node, message, error = false) {
    if (!node) return;
    node.textContent = message;
    node.dataset.error = String(error);
  }

  function readStorage() {
    try { return window.localStorage; }
    catch { return null; }
  }

  function refreshCount() {
    const storage = readStorage();
    if (!storage) {
      exportCount.textContent = "Trình duyệt không cho đọc dữ liệu lưu.";
      exportButton.disabled = true;
      return;
    }
    try {
      const count = Object.keys(snapshot(storage).records).length;
      exportCount.textContent = count ? `${count} game có dữ liệu trên máy này.` : "Chưa có dữ liệu game trên máy này.";
      exportButton.disabled = count === 0;
    } catch (error) {
      exportCount.textContent = error.message;
      exportButton.disabled = true;
    }
  }

  exportButton?.addEventListener("click", () => {
    const storage = readStorage();
    if (!storage) return;
    try {
      const backup = snapshot(storage);
      const name = `may-game-saves-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(exportStatus, `Đã tạo ${name}. Giữ tệp này để nhập ở địa chỉ mới.`);
    } catch (error) {
      setStatus(exportStatus, error.message, true);
    }
  });

  importChoose?.addEventListener("click", () => importInput?.click());

  importInput?.addEventListener("change", async () => {
    pending = null;
    importButton.disabled = true;
    reloadButton.hidden = true;
    importSummary.textContent = "";
    const file = importInput.files?.[0];
    if (!file) return;
    importInput.value = "";
    if (file.size > MAX_CHARS) {
      setStatus(importStatus, "Tệp sao lưu quá lớn.", true);
      return;
    }
    try {
      pending = parseBackup(await file.text());
      const count = Object.keys(pending.records).length;
      const when = pending.exportedAt ? new Date(pending.exportedAt).toLocaleString("vi-VN") : "không rõ thời gian";
      importSummary.textContent = `${count} game · xuất từ ${pending.origin || "không rõ địa chỉ"} lúc ${when}.`;
      importButton.disabled = false;
      setStatus(importStatus, "");
    } catch (error) {
      setStatus(importStatus, error.message, true);
    }
  });

  importButton?.addEventListener("click", () => {
    if (!pending) return;
    const storage = readStorage();
    if (!storage) {
      setStatus(importStatus, "Trình duyệt không cho ghi dữ liệu lưu.", true);
      return;
    }
    if (!confirm("Ghi đè dữ liệu lưu hiện tại bằng tệp này? Hãy xuất bản sao hiện tại trước nếu cần.")) return;
    try {
      const written = applyBackup(storage, pending);
      importButton.disabled = true;
      importInput.value = "";
      pending = null;
      setStatus(importStatus, `Đã nhập ${written} game. Tải lại trang để thấy tiến trình.`);
      reloadButton.hidden = false;
      refreshCount();
    } catch (error) {
      setStatus(importStatus, error.message, true);
    }
  });

  reloadButton?.addEventListener("click", () => location.reload());
  refreshCount();
}
