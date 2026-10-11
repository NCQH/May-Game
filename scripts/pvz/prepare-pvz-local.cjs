// Prepare the hosted game data directory and its resource manifest.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const input = path.resolve(process.argv[2] || path.join(root, '..'));
const output = path.join(root, 'games/pvz-goty/data');
if (!fs.statSync(path.join(input, 'main.pak')).isFile()) throw Error('main.pak was not found');
const files = ['main.pak'];
function properties(directory, prefix) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) continue;
    const name = prefix + '/' + entry.name;
    if (entry.isDirectory()) properties(path.join(directory,entry.name), name);
    else if (entry.isFile() && /\.(xml|sig|sig2|txt|png|jpg|jpeg|gif)$/i.test(entry.name)) files.push(name);
  }
}
properties(path.join(input, 'properties'), 'properties');
if (!files.some(name => /^properties\/.+\.xml$/i.test(name))) throw Error('properties XML data was not found');
for (const name of files) {
  const destination = path.join(output, name);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.copyFileSync(path.join(input,name), destination);
}
const revisionHash = crypto.createHash('sha256');
for (const name of files) revisionHash.update(name).update(fs.readFileSync(path.join(output,name)));
fs.writeFileSync(path.join(root,'games/pvz-goty/resources.json'),JSON.stringify({version:1,revision:revisionHash.digest('hex'),files:files.map(name=>({name}))},null,2)+'\n');
console.log('GOTY data prepared for automatic startup. This script does not upload files.');
