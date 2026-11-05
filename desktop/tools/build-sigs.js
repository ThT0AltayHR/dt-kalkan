// Builds data/sigs.bin from downloaded public malware hash lists (VirusShare MD5 lists + MalShare daily SHA-256).
const fs = require('fs'), path = require('path');
const { build } = require('../src/engine/sigformat');
const [,, ...dirs] = process.argv;
const md5 = [], sha = [];
for (const d of dirs) for (const f of fs.readdirSync(d)) {
  const t = fs.readFileSync(path.join(d, f), 'utf8').split(/\r?\n/);
  for (const l of t) { const h = l.trim().toLowerCase(); if (h.length === 32) md5.push(h); else if (h.length === 64) sha.push(h); }
}
const out = build({ md5, sha256: sha });
fs.writeFileSync(path.join(__dirname, '../data/sigs.bin'), out);
console.log('md5', md5.length, 'sha256', sha.length, 'bytes', out.length);
