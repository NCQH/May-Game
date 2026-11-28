// M6 save migration: the old Pyodide server kept its world in a SQLite file
// (IndexedDB `bangbang-offline`/`files` key `db`); the static JS engine keeps a
// JSON pve profile (`pve-profile`), a flat bag (`pve-bag`) and two localStorage
// values. This module reads the old bytes with sql.js and maps them.
//
// No core/worker/client file imports this yet. Call migrateSaveFromIndexedDb()
// on first JS boot before worker.js reads `pve-profile`/`pve-bag`; see the
// reports in that function. It is idempotent via profile.legacy_migration and a
// no-op when the legacy key is absent or the profile is already marked.
import {
  defaultProfile, normalizeProfile, validateStamina,
} from '../engine/pve-progress.js';

const LEGACY_PROFILE_ID = 30000791; // storage.PROFILE_ID
const PERSONAL_SETTINGS = new Set([
  'inventory', 'cosmetic_shop_profile', 'crystal_profile', 'pk_bot_setup',
  'guild_skills', 'booster_profile', 'pve_progress', 'pve_stamina',
]);
const DB_NAME = 'bangbang-offline';
const DB_STORE = 'files';
const LEGACY_DB_KEY = 'db';
const PROFILE_KEY = 'pve-profile';
const BAG_KEY = 'pve-bag';
const NAME_KEY = 'bb-character-name';
const BODY_KEY = 'bb-character-body';

let vendorSqlJs = null;

/**
 * Default sql.js loader resolving to the SQL module. In the browser, load
 * `vendor/sql-wasm.js` as a classic script first so `globalThis.initSqlJs`
 * exists (a module worker cannot import the UMD build directly).
 */
export function loadSqlJs() {
  if (!vendorSqlJs) {
    const classic = globalThis.initSqlJs;
    vendorSqlJs = typeof classic === 'function'
      ? Promise.resolve().then(() => classic())
      : import(new URL('./vendor/sql-wasm.js', import.meta.url).href).then((mod) => {
        const init = mod.default || mod;
        if (typeof init !== 'function') throw new Error('Vendored sql.js is unavailable');
        return init();
      });
  }
  return vendorSqlJs;
}

export function isLegacyMigrated(profile) {
  return Boolean(profile && typeof profile === 'object'
    && profile.legacy_migration && profile.legacy_migration.version === 1);
}

/**
 * Map one old SQLite save.
 *
 * @param {object} options
 * @param {Uint8Array|ArrayBuffer|ArrayBufferView|null} options.bytes old DB bytes
 * @param {Function} [options.initSqlJs] sql.js factory (default: vendored build)
 * @param {number} [options.profileId] old profile id (default: 30000791, else newest)
 * @param {string} [options.username] resolve the profile id from `characters`
 * @param {Array<number|string>|null} [options.containers] old inventory
 *   containers to migrate (default null = all). The PvE bag is 3 (materials)
 *   and 5 (assistants); pass [3, 5] for only the M6 reward inventory.
 * @param {object|null} [options.existingProfile] current pve-profile
 * @param {Array|null} [options.existingBag] current pve-bag
 * @param {number} [options.now] marker timestamp
 * @returns {Promise<object>} { migrated, reason, profile, bag, character,
 *   localStorage, stats, error? }
 */
export async function migrateSave({
  bytes, initSqlJs = loadSqlJs, profileId = null, username = null,
  containers = null, existingProfile = null, existingBag = null, now = Date.now(),
} = {}) {
  const stop = (reason, extra = {}) => ({
    migrated: false, reason, profile: existingProfile ?? null,
    bag: Array.isArray(existingBag) ? existingBag : [], character: null,
    localStorage: {}, stats: null, ...extra,
  });
  if (isLegacyMigrated(existingProfile)) return stop('already-migrated');
  if (!bytes || byteLength(bytes) === 0) return stop('no-db');

  let SQL;
  try {
    SQL = await initSqlJs();
  } catch (error) {
    return stop('sqljs-unavailable', { error: String(error && error.message || error) });
  }

  let db;
  try {
    db = new SQL.Database(bytesOf(bytes));
    return migrateDatabase(db, {
      profileId, username, containers, existingProfile, existingBag, now,
    });
  } catch (error) {
    return stop('invalid-db', { error: String(error && error.message || error) });
  } finally {
    if (db) { try { db.close(); } catch {} }
  }
}

/**
 * Browser/worker first-boot helper. Reads the old DB from IndexedDB, maps it,
 * and writes `pve-profile`, `pve-bag`, `bb-character-name` and (when the old
 * save has one) `bb-character-body`. Existing bag items are kept, deduped by
 * uuid. The legacy `db` key is left in place (callers can delete it later).
 */
export async function migrateSaveFromIndexedDb({
  indexedDB = globalThis.indexedDB, storage = globalThis.localStorage,
  initSqlJs = loadSqlJs, profileId = null, username = null, containers = null,
  now = Date.now(),
} = {}) {
  if (!indexedDB) throw new TypeError('indexedDB is required');
  const existingProfile = await idbGet(indexedDB, PROFILE_KEY);
  if (isLegacyMigrated(existingProfile)) {
    return {
      migrated: false, reason: 'already-migrated', profile: existingProfile,
      bag: (await idbGet(indexedDB, BAG_KEY)) || [], character: null,
      localStorage: {}, stats: null,
    };
  }
  const [bytes, existingBag] = await Promise.all([
    idbGet(indexedDB, LEGACY_DB_KEY), idbGet(indexedDB, BAG_KEY),
  ]);
  const result = await migrateSave({
    bytes, initSqlJs, profileId, username, containers, existingProfile,
    existingBag: Array.isArray(existingBag) ? existingBag : null, now,
  });
  if (!result.migrated) return result;
  await idbSet(indexedDB, PROFILE_KEY, result.profile);
  await idbSet(indexedDB, BAG_KEY, result.bag);
  if (storage) {
    for (const [key, value] of Object.entries(result.localStorage)) {
      try { storage.setItem(key, value); } catch {}
    }
  }
  return result;
}

// --------------------------------------------------------------- mapping

function migrateDatabase(db, { profileId, username, containers, existingProfile, existingBag, now }) {
  const tables = new Set(column(db, "SELECT name FROM sqlite_master WHERE type='table'"));
  if (!tables.has('worlds') || !tables.has('settings')) {
    return {
      migrated: false, reason: 'not-bangbang', profile: existingProfile ?? null,
      bag: Array.isArray(existingBag) ? existingBag : [], character: null,
      localStorage: {}, stats: null,
    };
  }

  const pid = resolveProfileId(db, { profileId, username, tables });
  if (pid == null) {
    return {
      migrated: false, reason: 'no-profile', profile: existingProfile ?? null,
      bag: Array.isArray(existingBag) ? existingBag : [], character: null,
      localStorage: {}, stats: null,
    };
  }

  const state = parseJson(first(db, 'SELECT state FROM worlds WHERE profile_id=?', [pid]), {});
  const oldOwner = tables.has('characters')
    ? first(db, 'SELECT username FROM characters WHERE profile_id=?', [pid]) : null;
  const oldProgress = readSetting(db, 'pve_progress', pid) || {};
  const oldStamina = readSetting(db, 'pve_stamina', pid) || null;
  const oldInventory = readSetting(db, 'inventory', pid) || null;
  const receipts = readReceipts(db, pid);

  const base = normalizeProfile(existingProfile || defaultProfile());
  // ponytail: unlock/city flags are not stored; the JS engine derives them from
  // maps/hard_maps exactly like pve_progress.unlocked(). Out-of-order legacy
  // unlocks cannot be represented — add city_records only if that matters.
  const profile = normalizeProfile({
    ...base,
    clears: nonNegative(oldProgress.clears, base.clears),
    last_run: typeof oldProgress.last_run === 'string' ? oldProgress.last_run : base.last_run,
    pending: nonNegative(oldProgress.pending, base.pending),
    best_grade: nonNegative(oldProgress.best_grade, base.best_grade),
    pending_v3: nonNegative(oldProgress.pending_v3, base.pending_v3),
    second_pet_earned: bool(oldProgress.second_pet_earned, base.second_pet_earned),
    second_pet_pending: bool(oldProgress.second_pet_pending, base.second_pet_pending),
    maps: { ...base.maps, ...progressTable(oldProgress.maps) },
    hard_maps: { ...base.hard_maps, ...progressTable(oldProgress.hard_maps) },
    receipts: { ...base.receipts, ...receipts },
  });

  let stamina = null;
  if (oldStamina) {
    try { stamina = validateStamina({ ...oldStamina }); } catch {}
  }
  if (stamina) profile.stamina = stamina;
  // ponytail: pending/pending_v3/second_pet_pending are carried, not delivered;
  // pve-progress.deliver() grants them on the next PvE settlement. Deliver at
  // login if M6 must show them before the next battle.

  profile.legacy_migration = {
    version: 1, source: 'bangbang.sqlite3', profileId: pid,
    username: typeof oldOwner === 'string' ? oldOwner : null, at: Number(now) || 0,
  };

  const migratedItems = mapInventory(oldInventory, containers);
  const bag = mergeBag(existingBag, migratedItems);
  const name = typeof state.name === 'string' ? state.name : '';
  // The native server never stored the chosen body: it lived only in
  // localStorage bb-character-body. Preserve it unless a fork stored state.body.
  const body = typeof state.body === 'string' && state.body ? state.body : null;

  return {
    migrated: true,
    reason: 'migrated',
    profile,
    bag,
    character: {
      name, body, username: typeof oldOwner === 'string' ? oldOwner : null, profileId: pid,
    },
    localStorage: {
      ...(name ? { [NAME_KEY]: name } : {}),
      ...(body ? { [BODY_KEY]: body } : {}),
    },
    stats: {
      profileId: pid, itemCount: migratedItems.length, bagCount: bag.length,
      receipts: Object.keys(receipts).length, maps: Object.keys(profile.maps).length,
      hardMaps: Object.keys(profile.hard_maps).length,
    },
  };
}

function resolveProfileId(db, { profileId, username, tables }) {
  if (username != null && tables.has('characters')) {
    const value = first(db, 'SELECT profile_id FROM characters WHERE username=?', [String(username)]);
    return value == null ? null : Number(value);
  }
  if (profileId != null) {
    const found = first(db, 'SELECT profile_id FROM worlds WHERE profile_id=?', [Number(profileId)]);
    return found == null ? null : Number(found);
  }
  const known = first(db, 'SELECT profile_id FROM worlds WHERE profile_id=?', [LEGACY_PROFILE_ID]);
  if (known != null) return Number(known);
  const newest = first(db, 'SELECT profile_id FROM worlds ORDER BY updated_ms DESC LIMIT 1');
  return newest == null ? null : Number(newest);
}

function settingKey(name, pid) {
  return PERSONAL_SETTINGS.has(name) && Number(pid) !== LEGACY_PROFILE_ID
    ? `profile:${pid}:${name}` : name;
}

function readSetting(db, name, pid) {
  const value = first(db, 'SELECT value FROM settings WHERE name=?', [settingKey(name, pid)]);
  return parseJson(value, null);
}

function readReceipts(db, pid) {
  const prefix = `pve_run_receipt:${pid}:`;
  const out = {};
  for (const name of column(db, 'SELECT name FROM settings WHERE name LIKE ?', [prefix + '%'])) {
    if (typeof name === 'string' && name.startsWith(prefix)) out[name.slice(prefix.length)] = 1;
  }
  return out;
}

/** Old {maps:{"204":{clears,best_grade}}} -> sanitized plain rows. */
function progressTable(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isFinite(id) || !value || typeof value !== 'object') continue;
    out[String(id)] = {
      clears: nonNegative(value.clears, 0),
      best_grade: nonNegative(value.best_grade, 0),
    };
  }
  return out;
}

/**
 * Old inventory: {container: [item...]} with template_id/count/level/slot_no.
 * New bag items are {uuid, itemId, count, level, slotNo}. slotNo is renumbered
 * globally because the JS bag is one container (the old per-container slot
 * space would collide); the old container and slot stay on the item.
 */
function mapInventory(inventory, containers) {
  if (!inventory || typeof inventory !== 'object') return [];
  const wanted = Array.isArray(containers) ? new Set(containers.map(String)) : null;
  const out = [];
  const seen = new Set();
  for (const key of Object.keys(inventory)) {
    if (wanted && !wanted.has(key)) continue;
    const container = Number(key);
    const items = Array.isArray(inventory[key]) ? inventory[key] : [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const itemId = Number(item.template_id);
      const count = Number(item.count);
      if (!Number.isFinite(itemId) || !Number.isInteger(count) || count <= 0) continue;
      const uuid = String(item.uuid ?? `legacy-${key}-${item.slot_no ?? 0}-${itemId}`);
      if (seen.has(uuid)) continue;
      seen.add(uuid);
      out.push({
        uuid,
        itemId,
        count,
        level: nonNegative(item.level, 0),
        container,
        legacySlot: nonNegative(item.slot_no, 0),
        slotNo: 0,
      });
    }
  }
  out.sort((a, b) => a.container - b.container
    || a.legacySlot - b.legacySlot || a.uuid.localeCompare(b.uuid));
  out.forEach((item, index) => { item.slotNo = index; });
  return out;
}

function mergeBag(existing, incoming) {
  const out = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(out.map((item) => item && item.uuid));
  for (const item of incoming) {
    if (seen.has(item.uuid)) continue;
    seen.add(item.uuid);
    out.push(item);
  }
  return out;
}

// --------------------------------------------------------------- sql helpers

function first(db, sql, params = []) {
  const result = db.exec(sql, params);
  return result.length && result[0].values.length ? result[0].values[0][0] : null;
}

function column(db, sql, params = []) {
  const result = db.exec(sql, params);
  return result.length ? result[0].values.map((row) => row[0]) : [];
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function nonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function bool(value, fallback) {
  return value == null ? fallback : Boolean(value);
}

function byteLength(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) return value.length;
  return 0;
}

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError('Legacy DB bytes must be a Uint8Array or ArrayBuffer');
}

// --------------------------------------------------------------- IndexedDB

function openIdb(indexedDB) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(indexedDB, key) {
  return openIdb(indexedDB).then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function idbSet(indexedDB, key, value) {
  return openIdb(indexedDB).then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }));
}
