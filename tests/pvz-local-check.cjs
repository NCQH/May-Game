const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'games/pvz-goty/index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
for (const script of inline) new vm.Script(script);
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}
const context = vm.createContext({});
vm.runInContext(['safeImportParts', 'normalizeResourcePath', 'normalizeSaveImportPath'].map(extract).join('\n'), context);
const resourceCases = [
  ['main.pak', 'main.pak'], ['GOTY/main.pak', 'main.pak'],
  ['GOTY/properties/partner.xml', 'properties/partner.xml'],
  ['GOTY/properties/partner.xml.sig2', 'properties/partner.xml.sig2'],
  ['HD/reanim/Peashooter.png', 'hd/reanim/peashooter.png'],
  ['GOTY/PlantsVsZombies.exe', ''], ['backup/main.pak/../../bad.exe', ''],
  ['/main.pak', ''], ['C:\\main.pak', ''], ['properties/xexe', ''],
  ['properties/../evil.xml', ''], ['properties/a\u0000.xml', ''],
];
for (const [input, expected] of resourceCases) assert.equal(context.normalizeResourcePath(input), expected, input);
assert.equal(context.normalizeSaveImportPath('userdata/user1.dat'), 'user1.dat');
assert.equal(context.normalizeSaveImportPath('userdata/../../x.dat'), '');
assert.equal(context.normalizeSaveImportPath('userdata/test.exe'), '');
assert.ok(!html.includes("console.warn('IDBFS initial sync error:'"), 'Restore errors must stop startup');
assert.ok(html.includes("Module.callMain(['-resdir', '/', '-savedir', '/may-game-pvz-goty-saves'])"));
console.log(`PASS: inline syntax, ${resourceCases.length} resource paths, save paths and restore guard.`);
