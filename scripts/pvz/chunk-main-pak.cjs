// Split a built .site main.pak into Cloudflare Pages-friendly parts (25 MiB/file limit).
// Run only on a built publish directory, never on a repo checkout.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHUNK = 20 * 1024 * 1024;
const root = path.resolve(process.argv[2] || '.site');
const dataDir = path.join(root, 'games/pvz-goty/data');
const manifestPath = path.join(root, 'games/pvz-goty/resources.json');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (fs.existsSync(path.join(root, '.git'))) fail('Refusing to modify a repo checkout; build .site first.');
if (!fs.existsSync(path.join(root, 'index.html'))) fail(`Not a publish directory: ${root}`);
if (!fs.existsSync(manifestPath)) fail(`Missing manifest: ${manifestPath}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) fail('Unsupported resources.json');
if (manifest.mainPak) {
  console.log('main.pak is already chunked.');
  process.exit(0);
}

const mainEntry = manifest.files.find((entry) => entry.name === 'main.pak');
if (!mainEntry) fail('resources.json has no main.pak entry');
const pakPath = path.join(dataDir, 'main.pak');
if (!fs.existsSync(pakPath)) fail(`Missing ${pakPath}`);

const bytes = fs.readFileSync(pakPath);
if (bytes.length <= CHUNK) {
  console.log(`main.pak is ${(bytes.length / 2**20).toFixed(2)} MiB; no split needed.`);
  process.exit(0);
}

const parts = [];
for (let offset = 0, index = 1; offset < bytes.length; offset += CHUNK, index++) {
  const name = `main.pak.${String(index).padStart(3, '0')}`;
  const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
  fs.writeFileSync(path.join(dataDir, name), slice);
  parts.push({ name, size: slice.length });
}

fs.rmSync(pakPath);
manifest.files = manifest.files.filter((entry) => entry.name !== 'main.pak');
manifest.mainPak = { size: bytes.length, parts };

const names = [...manifest.files.map((entry) => entry.name), ...parts.map((part) => part.name)].sort();
const revision = crypto.createHash('sha256');
for (const name of names) revision.update(name).update(fs.readFileSync(path.join(dataDir, name)));
manifest.revision = revision.digest('hex');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Split main.pak (${(bytes.length / 2**20).toFixed(2)} MiB) into ${parts.length} parts.`);
for (const part of parts) console.log(`  ${part.name} ${(part.size / 2**20).toFixed(2)} MiB`);
