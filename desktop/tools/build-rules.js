const fs = require('fs'), path = require('path');
const { encode } = require('../src/engine/ruleload');
const { parseRules } = require('../src/engine/rules');
const dir = path.join(__dirname, '../rules-src');
const text = fs.readdirSync(dir).filter(f => f.endsWith('.rules')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
const rules = parseRules(text);
fs.writeFileSync(path.join(__dirname, '../data/rules.dat'), encode(text));
fs.writeFileSync(path.join(__dirname, '../data/rules.json'), JSON.stringify({ count: rules.length, built: Date.now(), version: '2026.11.1' }));
console.log('rules compiled:', rules.length);
