// Runs the detection engine directly over files/dirs and prints verdicts.
const fs = require('fs'), path = require('path');
const { SignatureDB } = require('../src/engine/sigformat');
const ruleload = require('../src/engine/ruleload');
const { scanFile } = require('../src/engine/analyze');
(async () => {
  const t0 = Date.now();
  const sigdb = new SignatureDB(fs.readFileSync(path.join(__dirname, '../data/sigs.bin')));
  const rules = ruleload.load(fs.readFileSync(path.join(__dirname, '../data/rules.dat')));
  console.log(`DB: ${sigdb.total} signatures, ${rules.rules.length} rules, loaded in ${Date.now() - t0}ms`);
  const files = [];
  const walk = p => { const st = fs.statSync(p); if (st.isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f)); else files.push(p); };
  process.argv.slice(2).forEach(walk);
  const ctx = { sigdb, rules, settings: { heuristics: 'normal', archiveDepth: 2 } };
  const counts = {};
  const t1 = Date.now();
  for (const f of files) {
    const r = await scanFile(f, ctx);
    counts[r.verdict] = (counts[r.verdict] || 0) + 1;
    if (process.env.QUIET && r.verdict === 'clean') continue;
    console.log(`${(r.verdict || 'ERR').padEnd(10)} ${String(r.score).padStart(3)}  ${(r.threat || '-').padEnd(40)} ${f}`);
    if (process.env.VERBOSE || r.verdict !== 'clean') for (const x of r.reasons || []) console.log(`        [${x.layer}:${x.weight}] ${x.t.tr}`);
  }
  console.log(counts, `${files.length} files in ${Date.now() - t1}ms`);
})();
