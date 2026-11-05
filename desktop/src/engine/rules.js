'use strict';
// DT rule language: a compact YARA-inspired pattern language.
//
//   rule Some_Name {
//     name:  "Trojan.Win32.Example.Gen"
//     score: 80
//     scope: pe | script | text | office | any      (comma separated, default any)
//     desc:  "Human readable reason (Turkish)"
//     strings:
//       $a = "plain text" nocase wide ascii
//       $h = { 4D 5A ?? 00 [2-4] (AA|BB) }
//       $r = /regex/i
//     condition: ($a and $h) or 2 of ($r*) or #a > 3 or filesize < 2MB
//   }

const MAX_COUNT = 64;
const REGEX_LIMIT = 8 * 1024 * 1024;

// ───────── parsing ─────────
function tokenizeRuleFile(src) {
  // strip comments (// ... and /* ... */) outside of strings/regex — rule files keep comments on their own lines
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(l => (/^\s*\/\//.test(l) ? '' : l)).join('\n');
}

function unescapeStr(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|n|r|t|\\|"|0)/g, (m, e) => {
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', 0: '\0' }[e];
  });
}

function escapeRe(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (/[A-Za-z0-9_ ]/.test(ch)) out += ch;
    else out += '\\x' + (c & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

function hexToRegex(hex) {
  const t = hex.replace(/\s+/g, ' ').trim();
  let out = '', i = 0;
  const s = t.replace(/\s/g, '');
  while (i < s.length) {
    const c = s[i];
    if (c === '[') {
      const j = s.indexOf(']', i);
      const r = s.slice(i + 1, j).split('-');
      out += r.length === 1 ? `[\\s\\S]{${+r[0]}}` : `[\\s\\S]{${+r[0] || 0},${r[1] === '' ? '' : +r[1]}}`;
      i = j + 1;
    } else if (c === '(') { out += '(?:'; i++; }
    else if (c === ')' || c === '|') { out += c; i++; }
    else {
      const b = s.slice(i, i + 2);
      if (b === '??') out += '[\\s\\S]';
      else if (b[0] === '?') out += `[${[...Array(16).keys()].map(k => '\\x' + (k * 16 + parseInt(b[1], 16)).toString(16).padStart(2, '0')).join('')}]`;
      else if (b[1] === '?') { const hi = parseInt(b[0], 16) * 16; out += `[\\x${hi.toString(16).padStart(2, '0')}-\\x${(hi + 15).toString(16).padStart(2, '0')}]`; }
      else out += '\\x' + b.toLowerCase();
      i += 2;
    }
  }
  return new RegExp(out, 'g');
}

function parseStringDef(line) {
  const m = line.match(/^\s*\$([A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) throw new Error('bad string def: ' + line);
  const id = m[1];
  let rest = m[2].trim();
  if (rest[0] === '"') {
    let j = 1;
    while (j < rest.length && !(rest[j] === '"' && rest[j - 1] !== '\\')) j++;
    const text = unescapeStr(rest.slice(1, j));
    const mods = rest.slice(j + 1).trim().split(/\s+/).filter(Boolean);
    const nocase = mods.includes('nocase');
    const wide = mods.includes('wide');
    const ascii = !wide || mods.includes('ascii');
    return { id, kind: 'text', text, nocase, wide, ascii };
  }
  if (rest[0] === '{') {
    const j = rest.lastIndexOf('}');
    return { id, kind: 're', re: hexToRegex(rest.slice(1, j)) };
  }
  if (rest[0] === '/') {
    const j = rest.lastIndexOf('/');
    const flags = rest.slice(j + 1).trim().replace(/[^ims]/g, '');
    return { id, kind: 're', re: new RegExp(rest.slice(1, j), flags + 'g') };
  }
  throw new Error('bad string value: ' + line);
}

// condition parser → closure
function compileCondition(src, ids) {
  const toks = [];
  const re = /\s*("[^"]*"|\(|\)|>=|<=|==|!=|>|<|\$[A-Za-z0-9_]*\*?|#[A-Za-z0-9_]+|\d+(?:KB|MB)?|[A-Za-z_][A-Za-z0-9_]*|,)/gy;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    const before = re.lastIndex;
    m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(before))) break; throw new Error('cond syntax near: ' + src.slice(before)); }
    toks.push(m[1]);
  }
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const num = (t) => { const n = parseInt(t, 10); return /KB$/.test(t) ? n * 1024 : /MB$/.test(t) ? n * 1048576 : n; };
  const cmp = (op, a, b) => ({ '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '==': a === b, '!=': a !== b }[op]);
  const setOf = () => {
    const t = next();
    if (t === 'them') return ids.slice();
    if (t !== '(') throw new Error('expected ( after of');
    const out = [];
    while (peek() !== ')') {
      const v = next();
      if (v === ',') continue;
      if (v.endsWith('*')) { const pre = v.slice(1, -1); out.push(...ids.filter(i => i.startsWith(pre))); }
      else out.push(v.slice(1));
    }
    next();
    return out;
  };
  function primary() {
    const t = next();
    if (t === '(') { const e = orE(); next(); return e; }
    if (t === 'not') { const e = primary(); return c => !e(c); }
    if (t === 'true') return () => true;
    if (t === 'false') return () => false;
    if (t[0] === '$') { const id = t.slice(1); return c => c.count(id) > 0; }
    if (t[0] === '#') { const id = t.slice(1), op = next(), n = num(next()); return c => cmp(op, c.count(id), n); }
    if (t === 'filesize') { const op = next(), n = num(next()); return c => cmp(op, c.size, n); }
    if (t === 'any' || t === 'all' || /^\d+$/.test(t)) {
      if (next() !== 'of') throw new Error('expected of');
      const set = setOf();
      const need = t === 'any' ? 1 : t === 'all' ? set.length : +t;
      return c => { let k = 0; for (const id of set) { if (c.count(id) > 0 && ++k >= need) return true; } return false; };
    }
    if (/^(is_pe|is_dll|is_script|is_text|is_office|is_dotnet|is_zip|is_lnk|is_signed)$/.test(t)) return c => !!c.flags[t];
    if (t === 'ext') { const op = next(); const v = next(); return c => cmp(op, c.ext, v.replace(/"/g, '')); }
    throw new Error('unexpected token ' + t);
  }
  function andE() { let l = primary(); while (peek() === 'and') { next(); const a = l, b = primary(); l = c => a(c) && b(c); } return l; }
  function orE() { let l = andE(); while (peek() === 'or') { next(); const a = l, b = andE(); l = c => a(c) || b(c); } return l; }
  const fn = orE();
  if (p < toks.length) throw new Error('trailing tokens in condition: ' + toks.slice(p).join(' '));
  return fn;
}

function parseRules(text) {
  const src = tokenizeRuleFile(text);
  const rules = [];
  const blockRe = /rule\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = blockRe.exec(src))) {
    const [, id, body] = m;
    const rule = { id, name: id, score: 50, scope: ['any'], desc: '', strings: [] };
    const lines = body.split('\n');
    let section = 'meta';
    let condSrc = '';
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^strings\s*:/.test(line)) { section = 'strings'; continue; }
      const cm = line.match(/^condition\s*:\s*(.*)$/);
      if (cm) { section = 'cond'; condSrc += cm[1] + ' '; continue; }
      if (section === 'cond') { condSrc += line + ' '; continue; }
      if (section === 'strings') { rule.strings.push(parseStringDef(line)); continue; }
      const mm = line.match(/^(name|score|scope|desc)\s*:\s*(.*)$/);
      if (mm) {
        let v = mm[2].trim();
        if (v[0] === '"') v = unescapeStr(v.slice(1, v.lastIndexOf('"')));
        if (mm[1] === 'score') rule.score = +v;
        else if (mm[1] === 'scope') rule.scope = v.split(/[,|]/).map(s => s.trim());
        else rule[mm[1]] = v;
      }
    }
    try {
      rule.cond = compileCondition(condSrc.trim(), rule.strings.map(s => s.id));
    } catch (e) {
      throw new Error(`rule ${id}: ${e.message}`);
    }
    rules.push(rule);
  }
  return rules;
}

// ───────── matching ─────────
class RuleSet {
  constructor(rules) {
    this.rules = rules;
    // dedupe text patterns across rules so each unique needle is searched once per file
    this.needles = new Map();
    for (const r of rules) for (const s of r.strings) {
      if (s.kind !== 'text') continue;
      const variants = [];
      if (s.ascii) variants.push(s.nocase ? s.text.toLowerCase() : s.text);
      if (s.wide) { const w = [...s.text].map(ch => ch + '\0').join(''); variants.push(s.nocase ? w.toLowerCase() : w); }
      s.keys = variants.map(v => (s.nocase ? 'i:' : 'c:') + v);
      for (const k of s.keys) this.needles.set(k, null);
    }
  }
  static fromText(text) { return new RuleSet(parseRules(text)); }

  match(buf, info) {
    // info: { size, ext, flags:{is_pe,...} }
    const s = buf.toString('latin1');
    let sl = null;
    const lower = () => (sl === null ? (sl = s.toLowerCase()) : sl);
    const needleCache = new Map();
    const countNeedle = (key) => {
      if (needleCache.has(key)) return needleCache.get(key);
      const ci = key[0] === 'i';
      const hay = ci ? lower() : s;
      const n = key.slice(2);
      let c = 0, i = hay.indexOf(n);
      while (i !== -1 && c < MAX_COUNT) { c++; i = hay.indexOf(n, i + n.length); }
      needleCache.set(key, c);
      return c;
    };
    const reSrc = s.length > REGEX_LIMIT ? s.slice(0, REGEX_LIMIT) : s;
    const hits = [];
    for (const r of this.rules) {
      if (!r.scope.includes('any') && !r.scope.some(sc => info.flags['is_' + sc])) continue;
      const counts = new Map();
      const ctx = {
        size: info.size, ext: info.ext, flags: info.flags,
        count: (id) => {
          if (counts.has(id)) return counts.get(id);
          const def = r.strings.find(x => x.id === id);
          let c = 0;
          if (def) {
            if (def.kind === 'text') for (const k of def.keys) c += countNeedle(k);
            else {
              def.re.lastIndex = 0;
              let mm;
              while (c < MAX_COUNT && (mm = def.re.exec(reSrc))) { c++; if (mm[0].length === 0) def.re.lastIndex++; }
            }
          }
          counts.set(id, c);
          return c;
        },
      };
      let ok = false;
      try { ok = r.cond(ctx); } catch { ok = false; }
      if (ok) {
        const matched = [...counts.entries()].filter(([, v]) => v > 0).map(([k]) => '$' + k);
        hits.push({ id: r.id, name: r.name, score: r.score, desc: r.desc, matched });
      }
    }
    return hits;
  }
}

module.exports = { parseRules, RuleSet, compileCondition, hexToRegex };
