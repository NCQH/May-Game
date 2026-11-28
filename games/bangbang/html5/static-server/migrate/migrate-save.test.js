// Runnable self-check for migrate/migrate-save.js.
// Run: node games/bangbang/html5/static-server/migrate/migrate-save.test.js
// Fixture: the bundled html5/bangbang-py.zip -> data/bangbang.sqlite3.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { migrateSave, migrateSaveFromIndexedDb } from './migrate-save.js';

const ZIP = new URL('../../bangbang-py.zip', import.meta.url);
const FIXTURE = 'data/bangbang.sqlite3';
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks += 1; };
const ok = (value, label) => { assert.ok(value, label); checks += 1; };

// Minimal central-directory reader; the fixture zip has no ZIP64/encryption.
function zipEntry(zip, wanted) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad zip central header');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      const local = zip.readUInt32LE(offset + 42);
      const localName = zip.readUInt16LE(local + 26);
      const localExtra = zip.readUInt16LE(local + 28);
      const start = local + 30 + localName + localExtra;
      const raw = zip.subarray(start, start + compressed);
      return method === 0 ? raw : inflateRawSync(raw);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip entry not found: ${wanted}`);
}

// In-memory IndexedDB/localStorage doubles for the first-boot helper.
function fakeIndexedDb(initial = {}) {
  const stores = new Map(Object.entries(initial));
  const request = (result) => ({ result, onsuccess: null, onerror: null });
  const indexedDB = {
    open() {
      const opening = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      queueMicrotask(() => {
        opening.result = {
          objectStoreNames: { contains: (name) => name === 'files' },
          createObjectStore: () => {},
          transaction: () => ({
            objectStore: () => ({
              get(key) {
                const op = request(undefined);
                queueMicrotask(() => { op.result = stores.get(key); op.onsuccess?.(); });
                return op;
              },
              put(value, key) {
                const op = request(undefined);
                queueMicrotask(() => { stores.set(key, value); op.onsuccess?.(); });
                return op;
              },
            }),
          }),
        };
        opening.onupgradeneeded?.();
        opening.onsuccess?.();
      });
      return opening;
    },
  };
  return { indexedDB, stores };
}
function fakeStorage() {
  const data = new Map();
  return { data, setItem: (key, value) => data.set(key, value), getItem: (key) => data.get(key) ?? null };
}

// ---------------------------------------------------------------- fixture
const zip = readFileSync(ZIP);
const bytes = zipEntry(zip, FIXTURE);
eq(bytes.byteLength > 1_000_000, true, 'fixture DB extracted');
eq(zipEntry(zip, 'server/storage.py').byteLength > 0, true, 'fixture zip readable');

// ---------------------------------------------------------- mapped save
const result = await migrateSave({ bytes, now: 123 });
eq(result.migrated, true, 'save migrated');
eq(result.reason, 'migrated', 'migrated reason');
eq(result.character, {
  name: 'html5_seed_local', body: null, username: 'html5_seed_local', profileId: 30000791,
}, 'default profile character');
eq(result.localStorage, { 'bb-character-name': 'html5_seed_local' }, 'only known localStorage values');

const profile = result.profile;
eq(profile.clears, 1, 'top-level clears');
eq(profile.best_grade, 7, 'top-level best grade');
eq(profile.last_run, 'fe2d80cc053340fd906a1036f794c489', 'last run');
eq([profile.pending, profile.pending_v3], [0, 0], 'no pending rewards');
eq([profile.second_pet_earned, profile.second_pet_pending], [true, false], 'second pet claim');
eq(Object.keys(profile.maps).length, 48, 'normal map rows');
eq(profile.maps['204'], { clears: 1, best_grade: 7 }, 'map 204');
eq(profile.maps['205'], { clears: 2, best_grade: 7 }, 'map 205');
eq(profile.maps['211'], { clears: 3, best_grade: 7 }, 'map 211');
eq(profile.hard_maps, { 211: { clears: 1, best_grade: 7 } }, 'hard map rows');
eq(Object.keys(profile.receipts).length, 25, 'run receipts');
eq(profile.stamina, { version: 1, thew: 300, thew_buy: 2, thew_vip: 0 }, 'stamina');
eq(profile.legacy_migration, {
  version: 1, source: 'bangbang.sqlite3', profileId: 30000791,
  username: 'html5_seed_local', at: 123,
}, 'idempotency marker');

// ------------------------------------------------------------------ bag
eq(result.bag.length, 384, 'all inventory items mapped');
eq(new Set(result.bag.map((item) => item.slotNo)).size, result.bag.length, 'global slot numbers unique');
const crystal = result.bag.find((item) => item.itemId === 3800002);
eq({ ...crystal, uuid: undefined }, {
  uuid: undefined, itemId: 3800002, count: 9992, level: 0,
  container: 3, legacySlot: 2, slotNo: crystal.slotNo,
}, 'container 3 material item');
const pet = result.bag.find((item) => item.itemId === 4440004);
eq([pet.container, pet.count, pet.level], [5, 1, 12], 'container 5 assistant level');
ok(result.bag.some((item) => item.itemId === 2900112 && item.container === 6), 'cosmetic container kept');
const limited = await migrateSave({ bytes, containers: [3, 5] });
eq(limited.bag.length, 40, 'containers option restricts to PvE bag');
ok(limited.bag.every((item) => item.container === 3 || item.container === 5), 'only 3/5 kept');

// --------------------------------------------------------- idempotency / no-op
const again = await migrateSave({ bytes, existingProfile: result.profile, existingBag: result.bag });
eq([again.migrated, again.reason], [false, 'already-migrated'], 'second run is a no-op');
eq(again.profile, result.profile, 'profile untouched on rerun');
eq(again.bag, result.bag, 'bag untouched on rerun');
eq((await migrateSave({ bytes: null })).reason, 'no-db', 'missing DB is a no-op');
eq((await migrateSave({ bytes: new Uint8Array(0) })).reason, 'no-db', 'empty DB is a no-op');
const garbage = await migrateSave({ bytes: Uint8Array.from([1, 2, 3, 4]) });
ok(['invalid-db', 'not-bangbang'].includes(garbage.reason), 'garbage DB is rejected');
const unknown = await migrateSave({ bytes, profileId: 99999999 });
eq(unknown.reason, 'no-profile', 'unknown profile id is a no-op');

// ---------------------------------------------------- username / other profile
const vua = await migrateSave({ bytes, username: '1' });
eq(vua.character, { name: 'Vua36', body: null, username: '1', profileId: 30000794 }, 'username resolves profile');

// ------------------------------------------------- first-boot IDB helper
const fake = fakeIndexedDb({ db: bytes });
const storage = fakeStorage();
const boot = await migrateSaveFromIndexedDb({
  indexedDB: fake.indexedDB, storage, now: 456,
});
eq(boot.migrated, true, 'IDB boot migrated');
eq(fake.stores.get('pve-profile').legacy_migration.at, 456, 'IDB profile written with marker');
eq(fake.stores.get('pve-bag').length, 384, 'IDB bag written');
eq(storage.getItem('bb-character-name'), 'html5_seed_local', 'name written to localStorage');
eq(storage.getItem('bb-character-body'), null, 'missing body does not clobber localStorage');
const bootAgain = await migrateSaveFromIndexedDb({ indexedDB: fake.indexedDB, storage, now: 789 });
eq([bootAgain.migrated, bootAgain.reason], [false, 'already-migrated'], 'IDB boot is idempotent');

console.log(`migrate-save: ${checks} checks passed`);
