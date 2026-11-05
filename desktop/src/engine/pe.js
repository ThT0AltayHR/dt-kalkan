'use strict';
// Minimal, defensive PE/COFF parser used by the heuristic layer.
// Never throws on malformed input: returns { valid:false } or a partially-filled object.

function entropy(buf, start = 0, end = buf.length) {
  const len = end - start;
  if (len <= 0) return 0;
  const counts = new Uint32Array(256);
  for (let i = start; i < end; i++) counts[buf[i]]++;
  let e = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / len;
    e -= p * Math.log2(p);
  }
  return e;
}

function cstr(buf, off, max = 256) {
  if (off < 0 || off >= buf.length) return '';
  let end = off;
  const lim = Math.min(buf.length, off + max);
  while (end < lim && buf[end] !== 0) end++;
  return buf.toString('latin1', off, end);
}

function parsePE(buf) {
  const pe = { valid: false };
  try {
    if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return pe;
    const lfanew = buf.readUInt32LE(0x3c);
    if (lfanew <= 0 || lfanew > buf.length - 24 || buf.readUInt32LE(lfanew) !== 0x00004550) return pe;
    const coff = lfanew + 4;
    pe.machine = buf.readUInt16LE(coff);
    const nsec = buf.readUInt16LE(coff + 2);
    pe.timestamp = buf.readUInt32LE(coff + 4);
    const optSize = buf.readUInt16LE(coff + 16);
    pe.characteristics = buf.readUInt16LE(coff + 18);
    pe.isDll = !!(pe.characteristics & 0x2000);
    const opt = coff + 20;
    const magic = buf.readUInt16LE(opt);
    pe.is64 = magic === 0x20b;
    if (magic !== 0x10b && magic !== 0x20b) return pe;
    pe.entryRva = buf.readUInt32LE(opt + 16);
    pe.subsystem = buf.readUInt16LE(opt + 68);
    const ddOff = opt + (pe.is64 ? 112 : 96);
    const numDD = Math.min(16, buf.readUInt32LE(opt + (pe.is64 ? 108 : 92)));
    pe.dirs = [];
    for (let i = 0; i < numDD; i++) {
      const o = ddOff + i * 8;
      if (o + 8 > buf.length) break;
      pe.dirs.push({ rva: buf.readUInt32LE(o), size: buf.readUInt32LE(o + 4) });
    }
    const secOff = opt + optSize;
    pe.sections = [];
    for (let i = 0; i < Math.min(nsec, 96); i++) {
      const o = secOff + i * 40;
      if (o + 40 > buf.length) break;
      const name = buf.toString('latin1', o, o + 8).replace(/\0.*$/s, '');
      const s = {
        name,
        vsize: buf.readUInt32LE(o + 8), va: buf.readUInt32LE(o + 12),
        rawSize: buf.readUInt32LE(o + 16), rawPtr: buf.readUInt32LE(o + 20),
        chars: buf.readUInt32LE(o + 36),
      };
      s.exec = !!(s.chars & 0x20000000) || !!(s.chars & 0x20);
      s.write = !!(s.chars & 0x80000000);
      const a = Math.min(s.rawPtr, buf.length), b = Math.min(s.rawPtr + s.rawSize, buf.length);
      s.entropy = b > a ? entropy(buf, a, b) : 0;
      pe.sections.push(s);
    }
    pe.valid = true;

    const rvaToOff = (rva) => {
      for (const s of pe.sections) {
        const span = Math.max(s.vsize, s.rawSize);
        if (rva >= s.va && rva < s.va + span) {
          const off = rva - s.va + s.rawPtr;
          return off < buf.length ? off : -1;
        }
      }
      return rva < buf.length && rva < 0x1000 ? rva : -1;
    };
    pe.rvaToOff = rvaToOff;

    // Entry point section
    pe.entrySection = pe.sections.find(s => pe.entryRva >= s.va && pe.entryRva < s.va + Math.max(s.vsize, s.rawSize)) || null;

    // Overlay (data appended after the last section, excluding the Authenticode blob)
    let end = 0;
    for (const s of pe.sections) end = Math.max(end, s.rawPtr + s.rawSize);
    const sec = pe.dirs[4];
    pe.signed = !!(sec && sec.rva && sec.size);
    let fileEnd = buf.length;
    if (pe.signed && sec.rva >= end && sec.rva <= buf.length) fileEnd = sec.rva; // security dir uses a file offset
    pe.overlaySize = Math.max(0, fileEnd - end);
    pe.overlayEntropy = pe.overlaySize > 1024 ? entropy(buf, end, Math.min(fileEnd, end + 2 * 1024 * 1024)) : 0;

    pe.hasTLS = !!(pe.dirs[9] && pe.dirs[9].rva && pe.dirs[9].size);
    pe.tlsCallbacks = 0;
    if (pe.hasTLS) {
      const t = rvaToOff(pe.dirs[9].rva);
      if (t > 0) {
        const cbVA = pe.is64 ? Number(buf.readBigUInt64LE(t + 24)) : buf.readUInt32LE(t + 12);
        const imageBase = pe.is64 ? Number(buf.readBigUInt64LE(opt + 24)) : buf.readUInt32LE(opt + 28);
        if (cbVA) {
          let o = rvaToOff(cbVA - imageBase);
          const w = pe.is64 ? 8 : 4;
          while (o > 0 && o + w <= buf.length && pe.tlsCallbacks < 16) {
            const v = pe.is64 ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o);
            if (!v) break;
            pe.tlsCallbacks++; o += w;
          }
        }
      }
    }
    pe.isDotNet = !!(pe.dirs[14] && pe.dirs[14].rva);

    // Imports
    pe.imports = {}; // dll(lower) -> [fn]
    pe.importCount = 0;
    const imp = pe.dirs[1];
    if (imp && imp.rva) {
      let d = rvaToOff(imp.rva);
      for (let n = 0; d > 0 && d + 20 <= buf.length && n < 512; n++, d += 20) {
        const oft = buf.readUInt32LE(d), nameRva = buf.readUInt32LE(d + 12), ft = buf.readUInt32LE(d + 16);
        if (!nameRva && !ft) break;
        const dll = cstr(buf, rvaToOff(nameRva)).toLowerCase();
        const list = pe.imports[dll] || (pe.imports[dll] = []);
        let t = rvaToOff(oft || ft);
        const w = pe.is64 ? 8 : 4;
        for (let k = 0; t > 0 && t + w <= buf.length && k < 4096; k++, t += w) {
          let ord, rva;
          if (pe.is64) { const v = buf.readBigUInt64LE(t); if (v === 0n) break; ord = (v >> 63n) === 1n; rva = Number(v & 0x7fffffffn); }
          else { const v = buf.readUInt32LE(t); if (!v) break; ord = (v >>> 31) === 1; rva = v & 0x7fffffff; }
          if (ord) { list.push('#ord'); continue; }
          const fo = rvaToOff(rva);
          if (fo > 0) list.push(cstr(buf, fo + 2, 128));
          pe.importCount++;
        }
      }
    }
    pe.importSet = new Set();
    for (const dll in pe.imports) for (const f of pe.imports[dll]) pe.importSet.add(f.replace(/[AW]$/, '').toLowerCase());

    // Resources: look for RT_VERSION (16) and read version strings
    pe.hasVersionInfo = false;
    pe.version = {};
    const res = pe.dirs[2];
    if (res && res.rva) {
      const base = rvaToOff(res.rva);
      if (base > 0 && base + 16 <= buf.length) {
        const named = buf.readUInt16LE(base + 12), ids = buf.readUInt16LE(base + 14);
        for (let i = 0; i < named + ids && i < 64; i++) {
          const e = base + 16 + i * 8;
          if (e + 8 > buf.length) break;
          const id = buf.readUInt32LE(e);
          if (id === 16) { pe.hasVersionInfo = true; break; }
        }
      }
      if (pe.hasVersionInfo) {
        // Version strings are UTF-16LE inside the resource section: find key/value pairs.
        const rs = pe.sections.find(s => res.rva >= s.va && res.rva < s.va + Math.max(s.vsize, s.rawSize));
        if (rs) {
          const chunk = buf.subarray(rs.rawPtr, Math.min(buf.length, rs.rawPtr + rs.rawSize));
          const text = chunk.toString('utf16le');
          for (const key of ['CompanyName', 'FileDescription', 'OriginalFilename', 'ProductName', 'InternalName', 'LegalCopyright']) {
            const i = text.indexOf(key + '\u0000');
            if (i >= 0) {
              let j = i + key.length;
              while (j < text.length && text[j] === '\u0000') j++;
              const k = text.indexOf('\u0000', j);
              const v = text.slice(j, k > j ? k : j + 64).trim();
              if (v && v.length < 128) pe.version[key] = v;
            }
          }
        }
      }
    }
  } catch (e) {
    pe.parseError = String(e && e.message || e);
  }
  return pe;
}

module.exports = { parsePE, entropy };
