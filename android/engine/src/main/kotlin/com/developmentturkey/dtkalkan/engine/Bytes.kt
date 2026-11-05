package com.developmentturkey.dtkalkan.engine

import java.security.MessageDigest

/** Little helpers that mirror Node's Buffer semantics (throwing on out-of-range reads). */
class Buf(val a: ByteArray, val off: Int = 0, val len: Int = a.size - off) {
    operator fun get(i: Int): Int {
        if (i < 0 || i >= len) throw IndexOutOfBoundsException("offset $i out of range")
        return a[off + i].toInt() and 0xff
    }
    /** Node: buf[i] on out-of-range index is undefined (falsy, compares false). */
    fun at(i: Int): Int = if (i < 0 || i >= len) -1 else a[off + i].toInt() and 0xff
    fun u16(i: Int): Int { chk(i, 2); return (get(i)) or (get(i + 1) shl 8) }
    fun u32(i: Int): Long { chk(i, 4); return (get(i).toLong()) or (get(i + 1).toLong() shl 8) or (get(i + 2).toLong() shl 16) or (get(i + 3).toLong() shl 24) }
    fun u32i(i: Int): Int = u32(i).toInt()
    fun u32be(i: Int): Long { chk(i, 4); return (get(i).toLong() shl 24) or (get(i + 1).toLong() shl 16) or (get(i + 2).toLong() shl 8) or get(i + 3).toLong() }
    fun u64(i: Int): Long { chk(i, 8); var v = 0L; for (k in 7 downTo 0) v = (v shl 8) or get(i + k).toLong(); return v }
    private fun chk(i: Int, n: Int) { if (i < 0 || i + n > len) throw IndexOutOfBoundsException("RangeError: offset $i out of range") }
    fun latin1(start: Int, end: Int): String {
        val s = start.coerceIn(0, len); val e = end.coerceIn(s, len)
        return String(a, off + s, e - s, Charsets.ISO_8859_1)
    }
    fun sub(start: Int, end: Int): Buf { val s = start.coerceIn(0, len); val e = end.coerceIn(s, len); return Buf(a, off + s, e - s) }
    fun toArray(): ByteArray = if (off == 0 && len == a.size) a else a.copyOfRange(off, off + len)
    fun indexOf(needle: ByteArray, from: Int = 0): Int {
        if (needle.isEmpty()) return from.coerceAtMost(len)
        var i = maxOf(0, from)
        val first = needle[0]
        val lim = len - needle.size
        while (i <= lim) {
            if (a[off + i] == first) {
                var k = 1
                while (k < needle.size && a[off + i + k] == needle[k]) k++
                if (k == needle.size) return i
            }
            i++
        }
        return -1
    }
}

object Hex {
    private val D = "0123456789abcdef".toCharArray()
    fun of(b: ByteArray, off: Int = 0, len: Int = b.size): String {
        val c = CharArray(len * 2)
        for (i in 0 until len) { val v = b[off + i].toInt() and 0xff; c[i * 2] = D[v ushr 4]; c[i * 2 + 1] = D[v and 15] }
        return String(c)
    }
    fun parse(s: String): ByteArray {
        val out = ByteArray(s.length / 2)
        for (i in out.indices) out[i] = ((Character.digit(s[i * 2], 16) shl 4) or Character.digit(s[i * 2 + 1], 16)).toByte()
        return out
    }
}

object Text {
    /** JS String.prototype.trim / \s whitespace set. */
    const val JS_WS = "\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
    fun isJsWs(c: Char) = c == ' ' || c in '\t'..'\r' || c == '\u00a0' || c == '\u1680' || c in '\u2000'..'\u200a' || c == '\u2028' || c == '\u2029' || c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'
    fun jsTrim(s: String): String { var a = 0; var b = s.length; while (a < b && isJsWs(s[a])) a++; while (b > a && isJsWs(s[b - 1])) b--; return s.substring(a, b) }
    fun jsTrimStart(s: String): String { var a = 0; while (a < s.length && isJsWs(s[a])) a++; return s.substring(a) }
    /** Node: buf.toString('utf16le') — raw code units, trailing odd byte dropped. */
    fun utf16le(b: Buf, start: Int = 0, end: Int = b.len): String {
        val s = start.coerceIn(0, b.len); val e = end.coerceIn(s, b.len)
        val n = (e - s) / 2
        val c = CharArray(n)
        for (i in 0 until n) c[i] = ((b.a[b.off + s + i * 2].toInt() and 0xff) or ((b.a[b.off + s + i * 2 + 1].toInt() and 0xff) shl 8)).toChar()
        return String(c)
    }
    /** Node: Buffer.from(str, 'latin1') — low byte of each UTF-16 code unit. */
    fun latin1Bytes(s: String): ByteArray { val o = ByteArray(s.length); for (i in s.indices) o[i] = s[i].code.toByte(); return o }
    /** Node's lenient base64 decoder (ignores invalid chars, tolerates missing padding). */
    fun base64Lenient(s: String): ByteArray {
        val out = java.io.ByteArrayOutputStream(s.length * 3 / 4 + 3)
        var acc = 0; var bits = 0
        for (ch in s) {
            val v = when (ch) { in 'A'..'Z' -> ch - 'A'; in 'a'..'z' -> ch - 'a' + 26; in '0'..'9' -> ch - '0' + 52; '+', '-' -> 62; '/', '_' -> 63; '=' -> -2; else -> -1 }
            if (v == -2) break
            if (v < 0) continue
            acc = (acc shl 6) or v; bits += 6
            if (bits >= 8) { bits -= 8; out.write((acc shr bits) and 0xff) }
        }
        return out.toByteArray()
    }
    fun basename(name: String): String { val i = maxOf(name.lastIndexOf('/'), name.lastIndexOf('\\')); return if (i >= 0) name.substring(i + 1) else name }
    /** path.extname(name).slice(1) */
    fun ext(name: String): String { val b = basename(name); val i = b.lastIndexOf('.'); return if (i <= 0) "" else b.substring(i + 1) }
    fun jsRound(x: Double): Long = Math.floor(x + 0.5).toLong()
    fun toFixed2(x: Double): String = java.math.BigDecimal(x).setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()
    fun toFixed1(x: Double): String = java.math.BigDecimal(x).setScale(1, java.math.RoundingMode.HALF_UP).toPlainString()
}

object Digest {
    fun md5(b: ByteArray, off: Int = 0, len: Int = b.size): String { val d = MessageDigest.getInstance("MD5"); d.update(b, off, len); return Hex.of(d.digest()) }
    fun sha256(b: ByteArray, off: Int = 0, len: Int = b.size): String { val d = MessageDigest.getInstance("SHA-256"); d.update(b, off, len); return Hex.of(d.digest()) }
}
