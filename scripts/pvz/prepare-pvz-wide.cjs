// Extract only the authored scenery from HenryJk's v1.1.2 release into local
// resources. No executable, DLL, animation, sound or commercial asset is sent
// to GitHub. Requires sharp to decode JPG and preserve embedded PNG alpha.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const input = process.argv[2];
if (!input) throw Error('Usage: node scripts/pvz/prepare-pvz-wide.cjs /path/to/PvZWidescreen_1.1.2/main.pak');
const pak = fs.readFileSync(input);
if (pak.length > 128 * 1048576 || pak.length < 9) throw Error('Invalid PAK size');
for (let i = 0; i < pak.length; i++) pak[i] ^= 247;
if (pak.readUInt32LE(0) !== 0xbac04ac0) throw Error('Invalid PAK header');
let cursor = 8, offset = 0;
const entries = new Map();
while (cursor < pak.length && !(pak[cursor++] & 128)) {
  const length = pak[cursor++];
  if (!length || cursor + length + 12 > pak.length || entries.size >= 10000) throw Error('Invalid PAK table');
  const name = pak.subarray(cursor, cursor + length).toString().replaceAll('\\', '/').toLowerCase();
  cursor += length;
  const size = pak.readUInt32LE(cursor); cursor += 12;
  entries.set(name, { offset, size }); offset += size;
}
if (cursor + offset !== pak.length) throw Error('Invalid PAK data bounds');
const sizes = Object.fromEntries([
  ...['background1','background1unsodded','background2','background3','background4','background5','background6boss'].map(n => ['images/' + n, [1666, 600]]),
  ...['titlescreen','almanac_indexback','almanac_plantback','almanac_zombieback','aquarium1','awardscreen_back','background_greenhouse','background_mushroomgarden','challenge_background','store_background','store_backgroundnight'].map(n => ['images/' + n, [1066, 600]]),
  ['reanim/selectorscreen_bg', [1066, 600]],
  ['reanim/selectorscreen_bg_left', [609, 680]],
  ['reanim/selectorscreen_bg_right', [863, 560]],
  ['reanim/tree_bg', [1066, 600]],
  ...['bd','bn','bp','bf'].flatMap(prefix => Array.from({length: prefix === 'bd' || prefix === 'bn' ? 5 : 6}, (_, row) => ['images/' + prefix + row, [483, 600]])),
  ['images/b_base', [483, 600]],
  ['images/bn_base', [483, 600]],
]);
async function main() {
  const staged = [];
  for (const [name, [width, height]] of Object.entries(sizes)) {
    const entry = entries.get(name + '.png') || entries.get(name + '.jpg');
    if (!entry) throw Error('Missing widescreen scenery: ' + name);
    const image = pak.subarray(cursor + entry.offset, cursor + entry.offset + entry.size);
    const metadata = await sharp(image).metadata();
    if (metadata.width !== width || metadata.height !== height) throw Error('Unexpected scenery dimensions: ' + name);
    staged.push({ name: 'wide/' + name + '.png', bytes: await sharp(image).png().toBuffer() });
  }
  const directory = path.join(root, 'games/pvz-goty/data');
  const manifestPath = path.join(root, 'games/pvz-goty/resources.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const names = new Set(manifest.files.map(e => e.name));
  for (const entry of staged) {
    const destination = path.join(directory, entry.name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.bytes); names.add(entry.name);
  }
  const files = [...names].sort();
  const revision = crypto.createHash('sha256');
  for (const name of files) revision.update(name).update(fs.readFileSync(path.join(directory, name)));
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision: revision.digest('hex'), files: files.map(name => ({ name })) }, null, 2) + '\n');
  console.log(`Prepared ${staged.length} widescreen scenery assets locally. Original GOTY main.pak, animations and sound are unchanged.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
