package com.developmentturkey.dtkalkan.engine

import java.util.zip.DataFormatException
import java.util.zip.Inflater

/** Small, defensive ZIP reader (central directory based) — port of the desktop zip.js. */
class ZipEntry(val name: String, val method: Int, val csize: Long, val usize: Long, val offset: Long, val encrypted: Boolean, val dir: Boolean)

object Zip {
    private fun findEOCD(b: Buf): Int {
        val min = maxOf(0, b.len - 65557)
        var i = b.len - 22
        while (i >= min) { if (b.u32(i) == 0x06054b50L) return i; i-- }
        return -1
    }

    fun list(data: ByteArray, len: Int = data.size, maxEntries: Int = 2000): List<ZipEntry> {
        val b = Buf(data, 0, len)
        val out = ArrayList<ZipEntry>()
        try {
            val e = findEOCD(b)
            if (e < 0) return out
            val count = b.u16(e + 10)
            val cdOff = b.u32(e + 16)
            if (cdOff >= b.len) return out
            var p = cdOff.toInt()
            var i = 0
            while (i < count && i < maxEntries) {
                if (p + 46 > b.len || b.u32(p) != 0x02014b50L) break
                val flags = b.u16(p + 8); val method = b.u16(p + 10)
                val csize = b.u32(p + 20); val usize = b.u32(p + 24)
                val nlen = b.u16(p + 28); val xlen = b.u16(p + 30); val clen = b.u16(p + 32)
                val offset = b.u32(p + 42)
                val nEnd = minOf(b.len, p + 46 + nlen)
                val name = String(data, p + 46, nEnd - (p + 46), if (flags and 0x800 != 0) Charsets.UTF_8 else Charsets.ISO_8859_1)
                out.add(ZipEntry(name, method, csize, usize, offset, (flags and 1) != 0, name.endsWith("/")))
                p += 46 + nlen + xlen + clen
                i++
            }
        } catch (_: Exception) { }
        return out
    }

    /** Returns the entry bytes, or null (encrypted, unsupported, larger than [maxSize], corrupt). */
    fun read(data: ByteArray, len: Int, ent: ZipEntry, maxSize: Int): ByteArray? {
        if (ent.encrypted || ent.dir) return null
        val b = Buf(data, 0, len)
        val p = ent.offset
        if (p + 30 > len || b.u32(p.toInt()) != 0x04034b50L) return null
        val nlen = b.u16(p.toInt() + 26); val xlen = b.u16(p.toInt() + 28)
        val start = p + 30 + nlen + xlen
        val s = minOf(start, len.toLong()).toInt()
        val e = minOf(len.toLong(), start + ent.csize).toInt().coerceAtLeast(s)
        if (ent.method == 0) return data.copyOfRange(s, s + minOf(e - s, maxSize))
        if (ent.method == 8) {
            val inf = Inflater(true)
            try {
                inf.setInput(data, s, e - s)
                val bo = java.io.ByteArrayOutputStream(minOf(maxOf(ent.usize, 64L), maxSize.toLong() + 1).toInt())
                val chunk = ByteArray(64 * 1024)
                var total = 0L
                while (!inf.finished()) {
                    val n = inf.inflate(chunk)
                    if (n == 0) { if (inf.needsInput() || inf.needsDictionary()) break; continue }
                    total += n
                    if (total > maxSize) return null // ERR_BUFFER_TOO_LARGE
                    bo.write(chunk, 0, n)
                }
                return bo.toByteArray() // complete, or partial on truncated input (Z_SYNC_FLUSH behaviour)
            } catch (_: DataFormatException) { return null }
            finally { inf.end() }
        }
        return null
    }
}
