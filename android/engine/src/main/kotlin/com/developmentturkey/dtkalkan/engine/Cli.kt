package com.developmentturkey.dtkalkan.engine

import java.io.File

/** Developer CLI: java -cp engine.jar ...Cli <dataDir> <files/dirs...>  — prints JSON lines (same shape as tools/engine-parity.js). */
object Cli {
    @JvmStatic fun main(args: Array<String>) {
        val data = File(args[0])
        val db = SignatureDb.open(File(data, "sigs.bin"))
        val packs = mutableListOf(File(data, "rules.dat").readBytes())
        if (System.getenv("DT_ANDROID_RULES") != "0" && File(data, "android-rules.dat").exists()) packs.add(File(data, "android-rules.dat").readBytes())
        val rules = RulePack.load(*packs.toTypedArray())
        val an = Analyzer(db, rules, EngineSettings())
        val files = ArrayList<File>()
        fun walk(f: File) { if (f.isDirectory) f.listFiles()?.sortedBy { it.name }?.forEach { walk(it) } else if (f.isFile) files.add(f) }
        args.drop(1).forEach { walk(File(it)) }
        val t0 = System.currentTimeMillis()
        for (f in files) {
            val r = an.scanFile(f)
            println(Json.line(f.path, r))
        }
        System.err.println("${files.size} files in ${System.currentTimeMillis() - t0}ms; db=${db.total} rules=${rules.size}")
    }
}

object Json {
    fun esc(s: String?): String {
        if (s == null) return "null"
        val b = StringBuilder("\"")
        for (c in s) when (c) { '"' -> b.append("\\\""); '\\' -> b.append("\\\\"); '\n' -> b.append("\\n"); '\r' -> b.append("\\r"); '\t' -> b.append("\\t")
            else -> if (c < ' ') b.append(String.format("\\u%04x", c.code)) else b.append(c) }
        return b.append('"').toString()
    }
    fun line(path: String, r: ScanResult): String =
        "{\"path\":${esc(path)},\"verdict\":${esc(r.verdict)},\"score\":${r.score},\"threat\":${esc(r.threat)},\"sha256\":${esc(r.sha256)},\"reasons\":[${r.reasons.joinToString(",") { esc(it.layer + ":" + it.code + ":" + it.weight + ":" + it.tr) }}],\"size\":${r.size},\"kind\":${esc(r.kind)},\"md5\":${esc(r.md5)}" +
            ",\"full\":[${r.reasons.joinToString(",") { "{\"layer\":${esc(it.layer)},\"w\":${it.weight},\"t\":{\"tr\":${esc(it.tr)},\"en\":${esc(it.en)}}}" }}]" +
            ",\"perms\":[${r.apk?.permissions?.joinToString(",") { esc(it) } ?: ""}],\"pkg\":${esc(r.apk?.packageName)}}"
}
