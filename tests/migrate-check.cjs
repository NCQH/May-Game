const assert = require('node:assert/strict');
const { snapshot, parseBackup, applyBackup } = require('../assets/js/save-transfer.js');

class MemoryStorage {
  constructor(entries = {}) { this.map = new Map(Object.entries(entries)); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
}

const source = new MemoryStorage({
  'may-game:v1:tetris': '{"bestScore":42}',
  'may-game:v1:snake': '{"bestScore":7}',
  'may-game:v1:last-played': 'snake',
  'may-game:v1:pvz-goty': '{"current":{"phase":"saved"}}',
  unrelated: 'keep out',
});

const backup = snapshot(source, 1234);
assert.equal(backup.schemaVersion, 1);
assert.equal(backup.exportedAt, 1234);
assert.deepEqual(Object.keys(backup.records).sort(), [
  'may-game:v1:last-played',
  'may-game:v1:snake',
  'may-game:v1:tetris',
]);

const parsed = parseBackup(JSON.stringify(backup));
assert.equal(parsed.records['may-game:v1:tetris'], '{"bestScore":42}');
assert.equal(parsed.records['may-game:v1:snake'], '{"bestScore":7}');
assert.equal(parsed.records['may-game:v1:pvz-goty'], undefined);

const destination = new MemoryStorage({ 'may-game:v1:tetris': '{"bestScore":1}' });
assert.equal(applyBackup(destination, parsed), 3);
assert.equal(destination.getItem('may-game:v1:tetris'), '{"bestScore":42}');
assert.equal(destination.getItem('may-game:v1:snake'), '{"bestScore":7}');
assert.equal(destination.getItem('may-game:v1:pvz-goty'), null);
assert.equal(destination.getItem('unrelated'), null);

assert.throws(() => parseBackup('not json'), /JSON/);
assert.throws(() => parseBackup('{}'), /định dạng/);
assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, records: { unrelated: 'x' } })), /không có dữ liệu/);
assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, records: { 'may-game:v1:tetris': 1 } })), /không hợp lệ/);
assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, records: { 'may-game:v1:pvz-goty': 'x' } })), /không có dữ liệu/);
assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: 1, records: { 'may-game:v1:tetris': 'x'.repeat(9 * 1024 * 1024) } })), /quá lớn/);
assert.throws(() => snapshot(new MemoryStorage({ 'may-game:v1:tetris': 'x'.repeat(9 * 1024 * 1024) })), /quá lớn/);

console.log('Save transfer checks passed: export ignores PvZ/foreign keys, import validates and restores records.');
