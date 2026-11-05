'use strict';
// Compact signature database format ("DTSG" v1)
//  header 32 bytes: magic(4) ver(u16) flags(u16) created(u32) md5Count(u32) sha256Count(u32) reserved(12)
//  body: md5Count × 8-byte MD5 prefixes (sorted) | sha256Count × 32-byte SHA-256 (sorted)
// 64-bit MD5 prefixes keep the DB small; collision odds at ~2M entries are ~1e-13 per lookup.
const MAGIC = 0x44545347; // 'DTSG'
const HEADER = 32;

// Built-in signatures that are always present (industry-standard AV test file).
const BUILTIN_MD5 = ['44d88612fea8a8f36de82e1278abb02f'];
const BUILTIN_SHA256 = ['275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f'];
const BUILTIN_NAMES = {
  '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f': 'EICAR-Test-File',
  '44d88612fea8a8f36de82e1278abb02f': 'EICAR-Test-File',
};

function uniqSorted(bufs, width) {
  bufs.sort(Buffer.compare);
  const out = [];
  let prev = null;
  for (const b of bufs) { if (!prev || !prev.equals(b)) out.push(b); prev = b; }
  const res = Buffer.alloc(out.length * width);
  out.forEach((b, i) => b.copy(res, i * width));
  return { buf: res, count: out.length };
}

function build({ md5 = [], sha256 = [] }) {
  const m = [], s = [];
  const isHex = (h, n) => h.length === n && /^[0-9a-f]+$/.test(h);
  for (let h of md5.concat(BUILTIN_MD5)) { h = String(h).trim().toLowerCase(); if (isHex(h, 32)) m.push(Buffer.from(h.slice(0, 16), 'hex')); }
  for (let h of sha256.concat(BUILTIN_SHA256)) { h = String(h).trim().toLowerCase(); if (isHex(h, 64)) s.push(Buffer.from(h, 'hex')); }
  const M = uniqSorted(m, 8), S = uniqSorted(s, 32);
  const head = Buffer.alloc(HEADER);
  head.writeUInt32BE(MAGIC, 0); head.writeUInt16BE(1, 4); head.writeUInt16BE(0, 6);
  head.writeUInt32BE(Math.floor(Date.now() / 1000), 8);
  head.writeUInt32BE(M.count, 12); head.writeUInt32BE(S.count, 16);
  return Buffer.concat([head, M.buf, S.buf]);
}

class SignatureDB {
  constructor(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length < HEADER || buf.readUInt32BE(0) !== MAGIC) throw new Error('invalid signature database');
    this.buf = buf;
    this.created = buf.readUInt32BE(8) * 1000;
    this.md5Count = buf.readUInt32BE(12);
    this.sha256Count = buf.readUInt32BE(16);
    this.md5Off = HEADER;
    this.shaOff = HEADER + this.md5Count * 8;
  }
  get total() { return this.md5Count + this.sha256Count; }
  _search(off, count, width, key) {
    let lo = 0, hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = this.buf.compare(key, 0, width, off + mid * width, off + mid * width + width);
      if (c === 0) return true;
      if (c > 0) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  }
  hasMd5(hex) { return this._search(this.md5Off, this.md5Count, 8, Buffer.from(hex.slice(0, 16), 'hex')); }
  hasSha256(hex) { return this._search(this.shaOff, this.sha256Count, 32, Buffer.from(hex, 'hex')); }
  lookup(md5, sha256) {
    if (BUILTIN_NAMES[sha256]) return { hit: true, name: BUILTIN_NAMES[sha256], test: true };
    if (this.hasSha256(sha256)) return { hit: true, name: null };
    if (this.hasMd5(md5)) return { hit: true, name: null };
    return { hit: false };
  }
}

module.exports = { build, SignatureDB, MAGIC, HEADER };
