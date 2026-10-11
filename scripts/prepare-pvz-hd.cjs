// Personal local preview only. Import image pixels, never replace game code,
// animation definitions, resource manifests or sound from another game edition.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const readPak = require('./pvz/read-pak.cjs');
const root = path.resolve(__dirname, '..');
if (!process.argv[2]) throw Error('Usage: node scripts/prepare-pvz-hd.cjs /path/to/HD-Mod/main.pak');
const original = readPak(path.join(root, 'games/pvz-goty/data/main.pak'));
const hd = readPak(process.argv[2]);
function imageFile(pak, name) { return pak.get(name + '.png') || pak.get(name + '.jpg'); }
async function rgba(pak, name) {
  const file = imageFile(pak, name);
  if (!file) return null;
  const image = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const slash = name.lastIndexOf('/');
  const mask = imageFile(pak, name.slice(0, slash + 1) + '_' + name.slice(slash + 1)) || imageFile(pak, name + '_');
  if (mask) {
    const alpha = await sharp(mask).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    if (alpha.info.width === image.info.width && alpha.info.height === image.info.height)
      for (let i = 0; i < image.info.width * image.info.height; i++) image.data[i * 4 + 3] = alpha.data[i * alpha.info.channels + 2];
  }
  return image;
}
async function main() {
  const names = new Set([...original.keys()].filter(n => /^(images|reanim)\/[^/]+\.(png|jpg)$/.test(n) && !path.basename(n).startsWith('_')).map(n => n.replace(/\.(png|jpg)$/, '')));
  const accepted = [], skipped = [];
  for (const name of names) {
    if (!imageFile(hd, name)) continue;
    const a = await rgba(original, name), b = await rgba(hd, name);
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) { skipped.push({ name, reason: 'dimensions' }); continue; }
    let alphaError = 0, colourError = 0, weight = 0, changed = false;
    for (let i = 0; i < a.data.length; i += 4) {
      alphaError += Math.abs(a.data[i + 3] - b.data[i + 3]);
      const w = Math.min(a.data[i + 3], b.data[i + 3]) / 255;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(a.data[i + c] - b.data[i + c]);
        colourError += delta * w; weight += w; changed ||= delta > 0 && w > 0;
      }
    }
    const alphaMean = alphaError / (a.data.length / 4), colourMean = colourError / Math.max(1, weight);
    // Retouch only: conservatively reject silhouettes or colours that differ
    // substantially from GOTY. A matching size alone does not prove same art.
    if (alphaMean > 5 || colourMean > 12) { skipped.push({ name, reason: 'art-difference', alphaMean, colourMean }); continue; }
    if (!changed) continue;
    const dest = path.join(root, 'games/pvz-goty/data/hd', name + '.png');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await sharp(b.data, { raw: b.info }).png().toFile(dest);
    accepted.push({ name: 'hd/' + name + '.png', alphaMean, colourMean });
  }
  const manifestPath = path.join(root, 'games/pvz-goty/resources.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = [...new Set([...manifest.files.map(e => e.name), ...accepted.map(e => e.name)])].sort();
  const hash = crypto.createHash('sha256');
  for (const name of files) hash.update(name).update(fs.readFileSync(path.join(root, 'games/pvz-goty/data', name)));
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision: hash.digest('hex'), files: files.map(name => ({ name })) }, null, 2) + '\n');
  fs.mkdirSync(path.join(root, '.local-artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.local-artifacts/hd-import-report.json'), JSON.stringify({ accepted, skipped }, null, 2));
  console.log(`Prepared ${accepted.length} retouched GOTY images; rejected ${skipped.length} mismatched images. Original game PAK, animation, fonts and sound remain in use.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
