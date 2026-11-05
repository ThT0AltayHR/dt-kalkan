'use strict';
// Small, defensive ZIP reader (central directory based) used for archive scanning.
const zlib = require('zlib');

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * Lists entries. Returns [] for non-zip/corrupt data.
 * @returns {{name:string, method:number, csize:number, usize:number, offset:number, encrypted:boolean}[]}
 */
function listEntries(buf, maxEntries = 2000) {
  const out = [];
  try {
    const e = findEOCD(buf);
    if (e < 0) return out;
    let count = buf.readUInt16LE(e + 10);
    let cdOff = buf.readUInt32LE(e + 16);
    if (cdOff >= buf.length) return out;
    let p = cdOff;
    for (let i = 0; i < count && i < maxEntries; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const usize = buf.readUInt32LE(p + 24);
      const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
      const offset = buf.readUInt32LE(p + 42);
      const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      out.push({ name, method, csize, usize, offset, encrypted: !!(flags & 1), dir: name.endsWith('/') });
      p += 46 + nlen + xlen + clen;
    }
  } catch { /* corrupt */ }
  return out;
}

function readEntry(buf, ent, maxSize) {
  if (ent.encrypted || ent.dir) return null;
  const p = ent.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nlen + xlen;
  const data = buf.subarray(start, Math.min(buf.length, start + ent.csize));
  if (ent.method === 0) return data.subarray(0, Math.min(data.length, maxSize));
  if (ent.method === 8) {
    try { return zlib.inflateRawSync(data, { maxOutputLength: maxSize }); }
    catch (e) {
      if (e && e.code === 'ERR_BUFFER_TOO_LARGE') return null;
      try { // partial inflate for truncated data
        const chunks = []; let total = 0;
        const inf = zlib.inflateRawSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: maxSize });
        chunks.push(inf); total += inf.length;
        return Buffer.concat(chunks, total);
      } catch { return null; }
    }
  }
  return null;
}

module.exports = { listEntries, readEntry };
