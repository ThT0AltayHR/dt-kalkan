package com.developmentturkey.dtkalkan.engine

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

/**
 * "DTSG" v1 signature database (same binary layout as the desktop build):
 *  header 32 bytes: magic(4) ver(u16) flags(u16) created(u32) md5Count(u32) sha256Count(u32) reserved(12)
 *  body: md5Count × 8-byte MD5 prefixes (sorted) | sha256Count × 32-byte SHA-256 (sorted)
 * The file is memory-mapped and searched with a binary search — nothing is loaded into the heap.
 */
class SignatureDb private constructor(private val bb: ByteBuffer) {
    val created: Long = (bb.getInt(8).toLong() and 0xffffffffL) * 1000
    val md5Count: Int = bb.getInt(12)
    val sha256Count: Int = bb.getInt(16)
    private val md5Off = HEADER
    private val shaOff = HEADER + md5Count.toLong() * 8
    val total: Int get() = md5Count + sha256Count

    data class Hit(val hit: Boolean, val name: String? = null, val test: Boolean = false)

    private fun search(off: Long, count: Int, width: Int, key: ByteArray): Boolean {
        var lo = 0; var hi = count - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val base = (off + mid.toLong() * width).toInt()
            var c = 0
            for (i in 0 until width) {
                val a = key[i].toInt() and 0xff; val b = bb.get(base + i).toInt() and 0xff
                if (a != b) { c = if (a < b) -1 else 1; break }
            }
            if (c == 0) return true
            if (c > 0) lo = mid + 1 else hi = mid - 1
        }
        return false
    }
    fun hasMd5(hex: String) = search(md5Off.toLong(), md5Count, 8, Hex.parse(hex.substring(0, 16)))
    fun hasSha256(hex: String) = search(shaOff, sha256Count, 32, Hex.parse(hex))
    fun lookup(md5: String, sha256: String): Hit {
        BUILTIN_NAMES[sha256]?.let { return Hit(true, it, true) }
        if (hasSha256(sha256)) return Hit(true)
        if (hasMd5(md5)) return Hit(true)
        return Hit(false)
    }
    /** Raw sorted entries (used when merging an update). */
    fun md5Entry(i: Int): Long = bb.getLong(md5Off + i * 8)
    fun shaEntry(i: Int, dst: ByteArray) { for (k in 0 until 32) dst[k] = bb.get((shaOff + i.toLong() * 32).toInt() + k) }

    companion object {
        const val MAGIC = 0x44545347
        const val HEADER = 32
        val BUILTIN_MD5 = listOf("44d88612fea8a8f36de82e1278abb02f")
        val BUILTIN_SHA256 = listOf("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f")
        val BUILTIN_NAMES = mapOf(
            "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f" to "EICAR-Test-File",
            "44d88612fea8a8f36de82e1278abb02f" to "EICAR-Test-File",
        )

        fun open(file: File): SignatureDb {
            RandomAccessFile(file, "r").use { raf ->
                val map = raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, raf.length())
                return wrap(map)
            }
        }
        fun wrap(bytes: ByteArray): SignatureDb = wrap(ByteBuffer.wrap(bytes))
        private fun wrap(b: ByteBuffer): SignatureDb {
            b.order(ByteOrder.BIG_ENDIAN)
            if (b.capacity() < HEADER || b.getInt(0) != MAGIC) throw IllegalArgumentException("invalid signature database")
            return SignatureDb(b)
        }
        /** Reads only the 32-byte header (created/time + counts). */
        fun header(file: File): LongArray? = try {
            RandomAccessFile(file, "r").use { r -> val h = ByteArray(32); r.readFully(h); val b = ByteBuffer.wrap(h)
                if (b.getInt(0) != MAGIC) null else longArrayOf((b.getInt(8).toLong() and 0xffffffffL) * 1000, b.getInt(12).toLong(), b.getInt(16).toLong()) }
        } catch (e: Exception) { null }

        /**
         * Builds a new database by merging [current] with fresh hashes. Layout identical to the desktop builder
         * (sorted unsigned, unique, built-in test signatures always present).
         */
        fun build(out: File, current: SignatureDb?, md5: LongList, shaHex: Collection<String>, createdSec: Long = System.currentTimeMillis() / 1000) {
            if (current != null) for (i in 0 until current.md5Count) md5.add(current.md5Entry(i))
            for (h in BUILTIN_MD5) md5.addMd5Hex(h)
            val arr = md5.a
            for (i in 0 until md5.n) arr[i] = arr[i] xor Long.MIN_VALUE // signed sort == unsigned order
            java.util.Arrays.sort(arr, 0, md5.n)
            var u = 0
            for (i in 0 until md5.n) if (u == 0 || arr[i] != arr[u - 1]) arr[u++] = arr[i]
            val shas = ArrayList<ByteArray>()
            if (current != null) for (i in 0 until current.sha256Count) { val d = ByteArray(32); current.shaEntry(i, d); shas.add(d) }
            for (h0 in shaHex + BUILTIN_SHA256) { val h = h0.trim().lowercase(); if (h.length == 64 && h.all { it in '0'..'9' || it in 'a'..'f' }) shas.add(Hex.parse(h)) }
            shas.sortWith { x, y -> java.util.Arrays.compareUnsigned(x, y) }
            val shaU = ArrayList<ByteArray>(shas.size); var p2: ByteArray? = null
            for (v in shas) { if (p2 == null || !v.contentEquals(p2)) shaU.add(v); p2 = v }
            val tmp = File(out.path + ".new")
            java.io.DataOutputStream(java.io.BufferedOutputStream(tmp.outputStream(), 1 shl 20)).use { o ->
                o.writeInt(MAGIC); o.writeShort(1); o.writeShort(0); o.writeInt(createdSec.toInt()); o.writeInt(u); o.writeInt(shaU.size); o.write(ByteArray(12))
                for (i in 0 until u) o.writeLong(arr[i] xor Long.MIN_VALUE)
                for (v in shaU) o.write(v)
            }
            if (!tmp.renameTo(out)) { out.delete(); tmp.renameTo(out) }
        }
    }
}

/** Growable primitive list of 64-bit MD5 prefixes (avoids boxing millions of hashes). */
class LongList(cap: Int = 1 shl 16) {
    var a = LongArray(cap); var n = 0
    fun add(v: Long) { if (n == a.size) a = a.copyOf(a.size * 2); a[n++] = v }
    /** Parses a 32-char hex MD5 line and stores its 64-bit prefix. */
    fun addMd5Hex(h0: String): Boolean { val h = h0.trim().lowercase(); if (h.length != 32 || !h.all { it in '0'..'9' || it in 'a'..'f' }) return false; add(java.lang.Long.parseUnsignedLong(h.substring(0, 16), 16)); return true }
}

