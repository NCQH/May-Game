const DB_NAME = "may-game-pvz-goty-v1";
let connection;

export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("bundles");
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(new Error("Đóng các tab game cũ rồi thử lại.")); };
  });
  return connection;
}

export async function readBundle(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bundles", "readonly");
    const request = tx.objectStore("bundles").get(key);
    tx.oncomplete = () => resolve(request.result ?? null);
    tx.onabort = () => reject(tx.error ?? new Error("Không đọc được dữ liệu đã lưu."));
    tx.onerror = () => {};
  });
}

export async function writeBundle(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("bundles", "readwrite");
    const store = tx.objectStore("bundles");
    if (value === null) store.delete(key);
    else store.put(value, key);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error ?? new Error("Không lưu được dữ liệu trên thiết bị."));
    tx.onerror = () => {};
  });
}

export function safeParts(raw) {
  if (typeof raw !== "string" || raw.includes("\0") || /^[a-z]:/i.test(raw) || /^[/\\]/.test(raw)) throw new Error("Đường dẫn file không hợp lệ.");
  const parts = raw.replaceAll("\\", "/").split("/").filter(Boolean);
  if (!parts.length || parts.some(p => p === "." || p === ".." || /[:\x00-\x1f]/.test(p))) throw new Error("Đường dẫn file không hợp lệ.");
  return parts;
}

export function gameFiles(files) {
  const entries = files.map(file => ({ file, parts: safeParts(file.webkitRelativePath || file.name) }));
  const pak = entries.filter(e => e.parts.at(-1).toLowerCase() === "main.pak").sort((a, b) => a.parts.length - b.parts.length)[0];
  if (!pak) throw new Error("Không tìm thấy main.pak trong thư mục hoặc ZIP.");
  const prefix = pak.parts.slice(0, -1).join("/");
  const prefixParts = pak.parts.length - 1;
  const result = [];
  const seen = new Set();
  for (const entry of entries) {
    if (entry.parts.slice(0, prefixParts).join("/") !== prefix) continue;
    const relative = entry.parts.slice(prefixParts);
    const root = relative[0]?.toLowerCase();
    if (!(relative.length === 1 && root === "main.pak") && !(relative.length > 1 && root === "properties")) continue;
    if (relative.length > 1 && !/\.(xml|txt|sig|jpg|jpeg|png|gif)$/i.test(relative.at(-1))) continue;
    relative[0] = root;
    const name = relative.join("/");
    if (seen.has(name.toLowerCase())) throw new Error("Bộ dữ liệu có file trùng tên.");
    seen.add(name.toLowerCase());
    result.push({ name, blob: entry.file });
  }
  if (!result.some(e => /^properties\/.+\.xml$/i.test(e.name))) throw new Error("Thiếu dữ liệu properties/; hãy chọn cả thư mục properties của GOTY.");
  validateSize(result, 128 * 1024 * 1024);
  return result;
}

export function hdFiles(files) {
  const result = [];
  const seen = new Set();
  for (const file of files) {
    const parts = safeParts(file.webkitRelativePath || file.name);
    const start = parts.findIndex(p => ["images", "reanim", "fonts"].includes(p.toLowerCase()));
    if (start < 0 || !/\.png$/i.test(parts.at(-1))) continue;
    const name = parts.slice(start).join("/").toLowerCase();
    if (seen.has(name)) throw new Error("Gói HD có file trùng tên.");
    seen.add(name);
    result.push({ name, blob: file });
  }
  if (!result.length) throw new Error("Không tìm thấy PNG trong images/, reanim/ hoặc fonts/.");
  validateSize(result, 256 * 1024 * 1024);
  return result;
}

export function validateSaveImport(bundle) {
  if (bundle?.version !== 1 || !Array.isArray(bundle.files) || !bundle.files.length) throw new Error("ZIP không có dữ liệu save hợp lệ.");
  if (bundle.files.length > 1000) throw new Error("Save có quá nhiều tệp (tối đa 1000).");
  const names = new Set();
  let bytes = 0;
  for (const entry of bundle.files) {
    const parts = safeParts(entry.name);
    if (parts.join("/") !== entry.name || !/\.(dat|v4|png)$/i.test(parts.at(-1)) || !(entry.blob instanceof Blob)) throw new Error("Tệp save không hợp lệ.");
    const name = entry.name.toLowerCase();
    if (names.has(name)) throw new Error("Save có tệp trùng tên.");
    names.add(name);
    bytes += entry.blob.size;
    if (bytes > 64 * 1048576) throw new Error("Save vượt giới hạn 64 MiB.");
  }
  for (const name of names) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (names.has(parts.slice(0, i).join("/"))) throw new Error("Đường dẫn save bị xung đột giữa tệp và thư mục.");
    }
  }
  return bundle;
}

export function validateSize(entries, maximum) {
  if (entries.length > 10000 || entries.reduce((sum, entry) => sum + entry.blob.size, 0) > maximum) throw new Error("Bộ dữ liệu quá lớn cho bộ nhớ trình duyệt.");
}
