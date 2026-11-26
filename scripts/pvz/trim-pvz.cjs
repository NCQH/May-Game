// Trim a built .site to the original game only: main.pak + properties/.
// The engine falls back to original art when hd/ and wide/ are absent.
// Source assets and the GitHub Pages build stay complete.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The catalog card uses this one image; it is served for CSS, not listed in the manifest.
const KEEP = new Set(['wide/images/titlescreen.png']);
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

const extras = manifest.files.filter((entry) => /^(hd|wide)\//i.test(entry.name));
if (manifest.mainPak) {
  if (!extras.length) {
    console.log('Already core-only and chunked.');
    process.exit(0);
  }
  fail('Run trim before chunking main.pak.');
}
if (!extras.length) {
  console.log('No HD/widescreen entries; already core-only.');
  process.exit(0);
}

manifest.files = manifest.files.filter((entry) => !/^(hd|wide)\//i.test(entry.name));
let removed = 0;
for (const entry of extras) {
  if (KEEP.has(entry.name)) continue;
  fs.rmSync(path.join(dataDir, entry.name), { force: true });
  removed++;
}
if (!manifest.files.some((entry) => entry.name === 'main.pak')) fail('main.pak missing');
if (!manifest.files.some((entry) => /^properties\/.+\.xml$/i.test(entry.name))) fail('properties XML missing');

const names = manifest.files.map((entry) => entry.name).sort();
const revision = crypto.createHash('sha256');
for (const name of names) revision.update(name).update(fs.readFileSync(path.join(dataDir, name)));
manifest.revision = revision.digest('hex');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const kept = [...KEEP].filter((name) => fs.existsSync(path.join(dataDir, name)));
console.log(`Removed ${removed} HD/widescreen files; kept ${manifest.files.length} core resources.`);
if (kept.length) console.log(`Catalog image kept: ${kept.join(', ')}`);
