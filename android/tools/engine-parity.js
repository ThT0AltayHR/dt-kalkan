// Prints desktop-engine results as JSON lines for parity checks against the Kotlin port.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '../../app');
const { SignatureDB } = require(APP + '/src/engine/sigformat');
const ruleload = require(APP + '/src/engine/ruleload');
const { scanFile } = require(APP + '/src/engine/analyze');
(async () => {
  const sigdb = new SignatureDB(fs.readFileSync(APP + '/data/sigs.bin'));
  const rules = ruleload.load(fs.readFileSync(APP + '/data/rules.dat'));
  const files = [];
  const walk = p => { const st = fs.statSync(p); if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f)); else if (st.isFile()) files.push(p); };
  process.argv.slice(2).forEach(walk);
  const ctx = { sigdb, rules, settings: { heuristics: 'normal', archiveDepth: 2, maxFileMB: 48, heuristicsEnabled: true } };
  for (const f of files) {
    const r = await scanFile(f, ctx);
    console.log(JSON.stringify({ path: f, verdict: r.verdict || 'error', score: r.score || 0, threat: r.threat || null, sha256: r.sha256 || null, reasons: (r.reasons || []).map(x => `${x.layer}:${x.code}:${x.weight}:${x.t.tr}`) }));
  }
})();
