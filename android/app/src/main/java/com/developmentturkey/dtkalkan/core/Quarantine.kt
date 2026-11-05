package com.developmentturkey.dtkalkan.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted quarantine vault — same on-disk format as the desktop build:
 * 'DTQ1' | iv(12) | AES-256-GCM ciphertext | tag(16). Index kept in index.json.
 */
class Quarantine(private val dir: File) {
    private val key: ByteArray
    private val indexFile = File(dir, "index.json")
    var items: MutableList<JSONObject>; private set
    private val rnd = SecureRandom()

    init {
        dir.mkdirs()
        val kf = File(dir, ".vault.key")
        key = try { kf.readBytes().also { require(it.size == 32) } } catch (e: Exception) { ByteArray(32).also { rnd.nextBytes(it); kf.writeBytes(it) } }
        items = try { val a = JSONArray(indexFile.readText()); (0 until a.length()).map { a.getJSONObject(it) }.toMutableList() } catch (e: Exception) { mutableListOf() }
        items = items.filter { blob(it.optString("id")).exists() }.toMutableList()
    }
    private fun blob(id: String) = File(dir, "$id.dtq")
    @Synchronized private fun save() { try { Js.writeAtomic(indexFile, JSONArray(items).toString(1)) } catch (_: Exception) { } }
    @Synchronized fun list(): List<JSONObject> = items.sortedByDescending { it.optLong("date") }
    fun get(id: String?) = items.firstOrNull { it.optString("id") == id }
    fun size(): Long = items.sumOf { it.optLong("size") }

    /** Encrypts [open]'s content into the vault; [delete] removes the original (throws "LOCKED:..." on failure). */
    fun add(name: String, originalPath: String, size: Long, open: () -> InputStream, delete: () -> Boolean, meta: JSONObject): JSONObject {
        val id = java.lang.Long.toString(System.currentTimeMillis(), 36) + String.format("%08x", rnd.nextInt())
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val out = blob(id)
        out.outputStream().buffered(1 shl 16).use { os ->
            os.write("DTQ1".toByteArray()); os.write(iv)
            open().use { ins -> val buf = ByteArray(1 shl 16); while (true) { val n = ins.read(buf); if (n < 0) break; c.update(buf, 0, n)?.let { os.write(it) } } }
            os.write(c.doFinal()) // remaining ciphertext + 16-byte tag
        }
        var ok = try { delete() } catch (e: Exception) { false }
        if (!ok) { Thread.sleep(600); ok = try { delete() } catch (e: Exception) { false } }
        if (!ok) { out.delete(); throw IllegalStateException("LOCKED:EPERM") }
        val item = JSONObject().put("id", id).put("name", name).put("originalPath", originalPath).put("size", size).put("date", System.currentTimeMillis())
            .put("sha256", meta.opt("sha256") ?: JSONObject.NULL).put("threat", meta.opt("threat") ?: JSONObject.NULL)
            .put("verdict", meta.optString("verdict", "malicious")).put("score", meta.optInt("score", 0)).put("source", meta.optString("source", "scan"))
        synchronized(this) { items.add(item); save() }
        return item
    }

    /** Decrypts back to the original location (or a free "name (n).ext" next to it). Returns the restored path. */
    fun restore(id: String, target: String? = null): Pair<JSONObject, String> {
        val item = get(id) ?: throw IllegalStateException("NOT_FOUND")
        var dest = File(target ?: item.optString("originalPath"))
        dest.parentFile?.mkdirs()
        if (dest.exists()) {
            val n0 = dest.name; val dot = n0.lastIndexOf('.'); val base = if (dot > 0) n0.substring(0, dot) else n0; val ext = if (dot > 0) n0.substring(dot) else ""
            var n = 1; while (File(dest.parentFile, "$base ($n)$ext").exists()) n++
            dest = File(dest.parentFile, "$base ($n)$ext")
        }
        val b = blob(id)
        val head = ByteArray(16)
        b.inputStream().use { it.read(head) }
        if (String(head, 0, 4) != "DTQ1") throw IllegalStateException("CORRUPT")
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, head, 4, 12))
        val tmp = File(dest.path + ".dtrestore")
        try {
            val ins = b.inputStream().buffered(); ins.skip(16)
            CipherInputStream(ins, c).use { cis -> tmp.outputStream().use { cis.copyTo(it, 1 shl 16) } }
            if (!tmp.renameTo(dest)) throw IllegalStateException("EPERM")
        } catch (e: Exception) { tmp.delete(); throw e }
        b.delete()
        synchronized(this) { items.removeAll { it.optString("id") == id }; save() }
        return item to dest.path
    }

    fun remove(id: String): JSONObject? {
        val item = get(id); blob(id).delete()
        synchronized(this) { items.removeAll { it.optString("id") == id }; save() }
        return item
    }
    fun purgeOlderThan(days: Int): Int {
        if (days <= 0) return 0
        val lim = System.currentTimeMillis() - days * 86400000L
        val old = items.filter { it.optLong("date") < lim }
        old.forEach { remove(it.optString("id")) }
        return old.size
    }
}
