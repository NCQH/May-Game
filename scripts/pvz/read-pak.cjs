const fs = require('node:fs');
module.exports = function readPak(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > 128 * 1048576 || bytes.length < 9) throw Error('Invalid PAK size');
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= 247;
  if (bytes.readUInt32LE(0) !== 0xbac04ac0) throw Error('Invalid PAK header');
  let cursor = 8, offset = 0;
  const records = new Map();
  while (cursor < bytes.length && !(bytes[cursor++] & 128)) {
    const length = bytes[cursor++];
    if (!length || cursor + length + 12 > bytes.length || records.size >= 10000) throw Error('Invalid PAK table');
    const name = bytes.subarray(cursor, cursor + length).toString().replaceAll('\\', '/').toLowerCase(); cursor += length;
    if (!/^[a-z0-9_./ -]+$/.test(name) || name.split('/').includes('..') || records.has(name)) throw Error('Invalid PAK path');
    const size = bytes.readUInt32LE(cursor); cursor += 12;
    records.set(name, { offset, size }); offset += size;
  }
  if (cursor + offset !== bytes.length) throw Error('Invalid PAK data bounds');
  return new Map([...records].map(([name, e]) => [name, bytes.subarray(cursor + e.offset, cursor + e.offset + e.size)]));
};
