package com.developmentturkey.dtkalkan.engine

/** Minimal, defensive PE/COFF parser (port of the desktop pe.js). Never throws. */
class PeSection(val name: String, val vsize: Long, val va: Long, val rawSize: Long, val rawPtr: Long, val chars: Long) {
    val exec = (chars and 0x20000000L) != 0L || (chars and 0x20L) != 0L
    val write = (chars and 0x80000000L) != 0L
    var entropy = 0.0
}

class PeInfo {
    var valid = false
    var machine = 0; var timestamp = 0L; var characteristics = 0; var isDll = false; var is64 = false
    var entryRva = 0L; var subsystem = 0
    val dirs = ArrayList<LongArray>() // [rva, size]
    val sections = ArrayList<PeSection>()
    var entrySection: PeSection? = null
    var signed = false; var overlaySize = 0L; var overlayEntropy = 0.0
    var hasTLS = false; var tlsCallbacks = 0; var isDotNet = false
    val imports = LinkedHashMap<String, MutableList<String>>()
    var importCount = 0
    val importSet = HashSet<String>()
    var hasVersionInfo = false
    val version = HashMap<String, String>()
    var parseError: String? = null
}

object Pe {
    fun entropy(b: ByteArray, start: Int, end: Int): Double {
        val len = end - start
        if (len <= 0) return 0.0
        val counts = IntArray(256)
        for (i in start until end) counts[b[i].toInt() and 0xff]++
        var e = 0.0
        for (c in counts) { if (c == 0) continue; val p = c.toDouble() / len; e -= p * (Math.log(p) / LN2) }
        return e
    }
    private val LN2 = Math.log(2.0)

    private fun cstr(buf: Buf, off: Int, max: Int = 256): String {
        if (off < 0 || off >= buf.len) return ""
        var end = off; val lim = minOf(buf.len, off + max)
        while (end < lim && buf.at(end) != 0) end++
        return buf.latin1(off, end)
    }

    fun parse(buf0: ByteArray, len0: Int = buf0.size): PeInfo {
        val buf = Buf(buf0, 0, len0)
        val pe = PeInfo()
        try {
            if (buf.len < 0x40 || buf.at(0) != 0x4d || buf.at(1) != 0x5a) return pe
            val lfanew = buf.u32(0x3c)
            if (lfanew <= 0 || lfanew > buf.len - 24 || buf.u32(lfanew.toInt()) != 0x00004550L) return pe
            val coff = lfanew.toInt() + 4
            pe.machine = buf.u16(coff)
            val nsec = buf.u16(coff + 2)
            pe.timestamp = buf.u32(coff + 4)
            val optSize = buf.u16(coff + 16)
            pe.characteristics = buf.u16(coff + 18)
            pe.isDll = (pe.characteristics and 0x2000) != 0
            val opt = coff + 20
            val magic = buf.u16(opt)
            pe.is64 = magic == 0x20b
            if (magic != 0x10b && magic != 0x20b) return pe
            pe.entryRva = buf.u32(opt + 16)
            pe.subsystem = buf.u16(opt + 68)
            val ddOff = opt + if (pe.is64) 112 else 96
            val numDD = minOf(16L, buf.u32(opt + if (pe.is64) 108 else 92)).toInt()
            for (i in 0 until numDD) {
                val o = ddOff + i * 8
                if (o + 8 > buf.len) break
                pe.dirs.add(longArrayOf(buf.u32(o), buf.u32(o + 4)))
            }
            val secOff = opt + optSize
            for (i in 0 until minOf(nsec, 96)) {
                val o = secOff + i * 40
                if (o + 40 > buf.len) break
                var name = buf.latin1(o, o + 8); val z = name.indexOf('\u0000'); if (z >= 0) name = name.substring(0, z)
                val s = PeSection(name, buf.u32(o + 8), buf.u32(o + 12), buf.u32(o + 16), buf.u32(o + 20), buf.u32(o + 36))
                val a = minOf(s.rawPtr, buf.len.toLong()).toInt(); val b = minOf(s.rawPtr + s.rawSize, buf.len.toLong()).toInt()
                s.entropy = if (b > a) entropy(buf0, a, b) else 0.0
                pe.sections.add(s)
            }
            pe.valid = true

            fun rvaToOff(rva: Long): Int {
                for (s in pe.sections) {
                    val span = maxOf(s.vsize, s.rawSize)
                    if (rva >= s.va && rva < s.va + span) { val off = rva - s.va + s.rawPtr; return if (off < buf.len) off.toInt() else -1 }
                }
                return if (rva < buf.len && rva < 0x1000) rva.toInt() else -1
            }
            pe.entrySection = pe.sections.firstOrNull { pe.entryRva >= it.va && pe.entryRva < it.va + maxOf(it.vsize, it.rawSize) }

            var end = 0L
            for (s in pe.sections) end = maxOf(end, s.rawPtr + s.rawSize)
            val sec = pe.dirs.getOrNull(4)
            pe.signed = sec != null && sec[0] != 0L && sec[1] != 0L
            var fileEnd = buf.len.toLong()
            if (pe.signed && sec!![0] >= end && sec[0] <= buf.len) fileEnd = sec[0]
            pe.overlaySize = maxOf(0L, fileEnd - end)
            pe.overlayEntropy = if (pe.overlaySize > 1024) entropy(buf0, end.toInt(), minOf(fileEnd, end + 2 * 1024 * 1024).toInt()) else 0.0

            val tls = pe.dirs.getOrNull(9)
            pe.hasTLS = tls != null && tls[0] != 0L && tls[1] != 0L
            if (pe.hasTLS) {
                val t = rvaToOff(tls!![0])
                if (t > 0) {
                    val cbVA = if (pe.is64) buf.u64(t + 24) else buf.u32(t + 12)
                    val imageBase = if (pe.is64) buf.u64(opt + 24) else buf.u32(opt + 28)
                    if (cbVA != 0L) {
                        var o = rvaToOff(cbVA - imageBase)
                        val w = if (pe.is64) 8 else 4
                        while (o > 0 && o + w <= buf.len && pe.tlsCallbacks < 16) {
                            val v = if (pe.is64) buf.u64(o) else buf.u32(o)
                            if (v == 0L) break
                            pe.tlsCallbacks++; o += w
                        }
                    }
                }
            }
            val clr = pe.dirs.getOrNull(14)
            pe.isDotNet = clr != null && clr[0] != 0L

            val imp = pe.dirs.getOrNull(1)
            if (imp != null && imp[0] != 0L) {
                var d = rvaToOff(imp[0]); var n = 0
                while (d > 0 && d + 20 <= buf.len && n < 512) {
                    val oft = buf.u32(d); val nameRva = buf.u32(d + 12); val ft = buf.u32(d + 16)
                    if (nameRva == 0L && ft == 0L) break
                    val dll = cstr(buf, rvaToOff(nameRva)).lowercase()
                    val list = pe.imports.getOrPut(dll) { ArrayList() }
                    var t = rvaToOff(if (oft != 0L) oft else ft)
                    val w = if (pe.is64) 8 else 4
                    var k = 0
                    while (t > 0 && t + w <= buf.len && k < 4096) {
                        val ord: Boolean; val rva: Long
                        if (pe.is64) { val v = buf.u64(t); if (v == 0L) break; ord = (v ushr 63) == 1L; rva = v and 0x7fffffffL }
                        else { val v = buf.u32(t); if (v == 0L) break; ord = (v ushr 31) == 1L; rva = v and 0x7fffffffL }
                        if (ord) { list.add("#ord"); k++; t += w; continue }
                        val fo = rvaToOff(rva)
                        if (fo > 0) list.add(cstr(buf, fo + 2, 128))
                        pe.importCount++
                        k++; t += w
                    }
                    n++; d += 20
                }
            }
            for ((_, fns) in pe.imports) for (f in fns) pe.importSet.add(f.replace(Regex("[AW]$"), "").lowercase())

            val res = pe.dirs.getOrNull(2)
            if (res != null && res[0] != 0L) {
                val base = rvaToOff(res[0])
                if (base > 0 && base + 16 <= buf.len) {
                    val named = buf.u16(base + 12); val ids = buf.u16(base + 14)
                    var i = 0
                    while (i < named + ids && i < 64) {
                        val e = base + 16 + i * 8
                        if (e + 8 > buf.len) break
                        if (buf.u32(e) == 16L) { pe.hasVersionInfo = true; break }
                        i++
                    }
                }
                if (pe.hasVersionInfo) {
                    val rs = pe.sections.firstOrNull { res[0] >= it.va && res[0] < it.va + maxOf(it.vsize, it.rawSize) }
                    if (rs != null) {
                        val text = Text.utf16le(buf, minOf(rs.rawPtr, buf.len.toLong()).toInt(), minOf(buf.len.toLong(), rs.rawPtr + rs.rawSize).toInt())
                        for (key in listOf("CompanyName", "FileDescription", "OriginalFilename", "ProductName", "InternalName", "LegalCopyright")) {
                            val i = text.indexOf(key + "\u0000")
                            if (i >= 0) {
                                var j = i + key.length
                                while (j < text.length && text[j] == '\u0000') j++
                                val k = text.indexOf('\u0000', j)
                                val v = Text.jsTrim(text.substring(j, minOf(text.length, if (k > j) k else j + 64)))
                                if (v.isNotEmpty() && v.length < 128) pe.version[key] = v
                            }
                        }
                    }
                }
            }
        } catch (e: Throwable) {
            pe.parseError = e.message ?: e.toString()
        }
        return pe
    }
}
