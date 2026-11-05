package com.developmentturkey.dtkalkan.engine

import java.util.regex.Matcher
import java.util.regex.Pattern
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

/** Encoded rule pack ("DTRL1" + rolling XOR over gzip) — identical to the desktop format. */
object RulePack {
    private val KEY = "DT-Kalkan/2026::Development-Turkey".toByteArray(Charsets.ISO_8859_1)
    private fun xor(b: ByteArray, off: Int): ByteArray {
        val out = ByteArray(b.size - off)
        var k = 0x5a
        for (i in out.indices) { k = (k * 31 + (KEY[i % KEY.size].toInt() and 0xff)) and 0xff; out[i] = ((b[off + i].toInt() and 0xff) xor k).toByte() }
        return out
    }
    fun decode(b: ByteArray): String {
        if (b.size < 5 || String(b, 0, 5, Charsets.ISO_8859_1) != "DTRL1") throw IllegalArgumentException("invalid rule pack")
        return GZIPInputStream(xor(b, 5).inputStream()).readBytes().toString(Charsets.UTF_8)
    }
    fun encode(text: String): ByteArray {
        val bo = java.io.ByteArrayOutputStream()
        GZIPOutputStream(bo).use { it.write(text.toByteArray(Charsets.UTF_8)) }
        val z = bo.toByteArray()
        val full = ByteArray(5 + z.size); "DTRL1".toByteArray(Charsets.ISO_8859_1).copyInto(full); z.copyInto(full, 5)
        val x = xor(full, 5); x.copyInto(full, 5)
        return full
    }
    fun load(vararg packs: ByteArray): RuleSet = RuleSet.fromText(packs.joinToString("\n") { decode(it) })
}

class Rule(val id: String) {
    var name: String = id
    var score: Int = 50
    var scope: List<String> = listOf("any")
    var desc: String = ""
    val strings = ArrayList<StrDef>()
    lateinit var cond: (Ctx) -> Boolean
}

class StrDef(val id: String, val kind: String) {
    var text = ""; var nocase = false; var wide = false; var ascii = true
    var re: Pattern? = null
    var keys: List<String> = emptyList()
}

class Ctx(val size: Long, val ext: String, val flags: Map<String, Boolean>, val count: (String) -> Int)

data class RuleHit(val id: String, val name: String, val score: Int, val desc: String, val matched: List<String>)

object RuleParser {
    private fun stripComments(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").split(Regex("\\r?\\n")).joinToString("\n") { if (Regex("^\\s*//").containsMatchIn(it)) "" else it }

    fun unescapeStr(s: String): String = Regex("\\\\(x[0-9a-fA-F]{2}|n|r|t|\\\\|\"|0)").replace(s) { m ->
        val e = m.groupValues[1]
        if (e[0] == 'x') e.substring(1).toInt(16).toChar().toString()
        else when (e) { "n" -> "\n"; "r" -> "\r"; "t" -> "\t"; "\\" -> "\\"; "\"" -> "\""; else -> "\u0000" }
    }

    private fun hx(v: Int) = "\\x" + v.toString(16).padStart(2, '0')

    fun hexToRegex(hex: String): Pattern {
        val s = hex.replace(Regex("\\s"), "")
        val out = StringBuilder(); var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '[' -> {
                    val j = s.indexOf(']', i)
                    val r = s.substring(i + 1, j).split("-")
                    if (r.size == 1) out.append("[\\s\\S]{${r[0].trim().toIntOrNull() ?: 0}}")
                    else out.append("[\\s\\S]{${r[0].toIntOrNull() ?: 0},${if (r[1] == "") "" else (r[1].toIntOrNull() ?: 0).toString()}}")
                    i = j + 1
                }
                c == '(' -> { out.append("(?:"); i++ }
                c == ')' || c == '|' -> { out.append(c); i++ }
                else -> {
                    val b = s.substring(i, minOf(s.length, i + 2))
                    if (b == "??") out.append("[\\s\\S]")
                    else if (b[0] == '?') { val lo = b[1].digitToInt(16); out.append("[" + (0 until 16).joinToString("") { hx(it * 16 + lo) } + "]") }
                    else if (b.length > 1 && b[1] == '?') { val hi = b[0].digitToInt(16) * 16; out.append("[${hx(hi)}-${hx(hi + 15)}]") }
                    else out.append("\\x" + b.lowercase())
                    i += 2
                }
            }
        }
        return Pattern.compile(out.toString(), Pattern.DOTALL)
    }

    /** Converts a JavaScript regex body to java.util.regex with JS semantics for \s (includes NBSP on latin-1 data). */
    fun jsRegex(src: String, flags: String): Pattern {
        val o = StringBuilder(); var inClass = false; var i = 0
        while (i < src.length) {
            val c = src[i]
            if (c == '\\' && i + 1 < src.length) {
                val n = src[i + 1]
                when {
                    n == 's' -> o.append(if (inClass) "\\s\\x{a0}" else "[\\s\\x{a0}]")
                    n == 'S' && !inClass -> o.append("[^\\s\\x{a0}]")
                    n == '/' -> o.append('/')
                    else -> o.append(c).append(n)
                }
                i += 2; continue
            }
            if (c == '[' && !inClass) { inClass = true; o.append(c); if (i + 1 < src.length && src[i + 1] == '^') { o.append('^'); i++ }; if (i + 1 < src.length && src[i + 1] == ']') { o.append("\\]"); i++ }; i++; continue }
            if (c == '[' && inClass) { o.append("\\["); i++; continue }
            if (c == ']' && inClass) { inClass = false; o.append(c); i++; continue }
            if (c == '{' && !inClass && !Regex("^\\{\\d+(,\\d*)?\\}").containsMatchIn(src.substring(i))) { o.append("\\{"); i++; continue }
            if (c == '}' && !inClass && !Regex("\\{\\d+(,\\d*)?$").containsMatchIn(src.substring(0, i))) { o.append("\\}"); i++; continue }
            o.append(c); i++
        }
        var f = 0
        if ('i' in flags) f = f or Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE
        if ('m' in flags) f = f or Pattern.MULTILINE
        if ('s' in flags) f = f or Pattern.DOTALL
        return Pattern.compile(o.toString(), f)
    }

    private fun parseStringDef(line: String): StrDef {
        val m = Regex("^\\s*\\$([A-Za-z0-9_]*)\\s*=\\s*(.*)$").find(line) ?: throw IllegalArgumentException("bad string def: $line")
        val id = m.groupValues[1]
        val rest = m.groupValues[2].trim()
        if (rest.startsWith("\"")) {
            var j = 1
            while (j < rest.length && !(rest[j] == '"' && rest[j - 1] != '\\')) j++
            val d = StrDef(id, "text")
            d.text = unescapeStr(rest.substring(1, minOf(j, rest.length)))
            val mods = rest.substring(minOf(j + 1, rest.length)).trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
            d.nocase = "nocase" in mods; d.wide = "wide" in mods; d.ascii = !d.wide || "ascii" in mods
            return d
        }
        if (rest.startsWith("{")) { val j = rest.lastIndexOf('}'); return StrDef(id, "re").also { it.re = hexToRegex(rest.substring(1, j)) } }
        if (rest.startsWith("/")) {
            val j = rest.lastIndexOf('/')
            val flags = rest.substring(j + 1).trim().replace(Regex("[^ims]"), "")
            return StrDef(id, "re").also { it.re = jsRegex(rest.substring(1, j), flags) }
        }
        throw IllegalArgumentException("bad string value: $line")
    }

    private val TOK = Pattern.compile("\\s*(\"[^\"]*\"|\\(|\\)|>=|<=|==|!=|>|<|\\$[A-Za-z0-9_]*\\*?|#[A-Za-z0-9_]+|\\d+(?:KB|MB)?|[A-Za-z_][A-Za-z0-9_]*|,)")
    private val FLAG_TOK = Regex("^(is_pe|is_dll|is_script|is_text|is_office|is_dotnet|is_zip|is_lnk|is_signed|is_dex|is_apk|is_elf)$")

    fun compileCondition(src: String, ids: List<String>): (Ctx) -> Boolean {
        val toks = ArrayList<String>()
        val m = TOK.matcher(src); var pos = 0
        while (pos < src.length) {
            m.region(pos, src.length)
            if (!m.lookingAt()) { if (src.substring(pos).isBlank()) break; throw IllegalArgumentException("cond syntax near: " + src.substring(pos)) }
            toks.add(m.group(1)); pos = m.end()
        }
        var p = 0
        fun peek() = toks.getOrNull(p)
        fun next(): String = toks.getOrNull(p++) ?: throw IllegalArgumentException("unexpected end")
        fun num(t: String): Long { val n = Regex("^\\d+").find(t)!!.value.toLong(); return if (t.endsWith("KB")) n * 1024 else if (t.endsWith("MB")) n * 1048576 else n }
        fun cmp(op: String, a: Long, b: Long) = when (op) { ">" -> a > b; "<" -> a < b; ">=" -> a >= b; "<=" -> a <= b; "==" -> a == b; "!=" -> a != b; else -> false }
        fun setOf(): List<String> {
            val t = next()
            if (t == "them") return ids.toList()
            if (t != "(") throw IllegalArgumentException("expected ( after of")
            val out = ArrayList<String>()
            while (peek() != ")") {
                val v = next()
                if (v == ",") continue
                if (v.endsWith("*")) { val pre = v.substring(1, v.length - 1); out.addAll(ids.filter { it.startsWith(pre) }) } else out.add(v.substring(1))
            }
            next(); return out
        }
        lateinit var orE: () -> (Ctx) -> Boolean
        fun primary(): (Ctx) -> Boolean {
            val t = next()
            if (t == "(") { val e = orE(); next(); return e }
            if (t == "not") { val e = primary(); return { c -> !e(c) } }
            if (t == "true") return { true }
            if (t == "false") return { false }
            if (t[0] == '$') { val id = t.substring(1); return { c -> c.count(id) > 0 } }
            if (t[0] == '#') { val id = t.substring(1); val op = next(); val n = num(next()); return { c -> cmp(op, c.count(id).toLong(), n) } }
            if (t == "filesize") { val op = next(); val n = num(next()); return { c -> cmp(op, c.size, n) } }
            if (t == "any" || t == "all" || t.all { it.isDigit() }) {
                if (next() != "of") throw IllegalArgumentException("expected of")
                val set = setOf()
                val need = if (t == "any") 1 else if (t == "all") set.size else t.toInt()
                return { c -> var k = 0; var ok = false; for (id in set) { if (c.count(id) > 0 && ++k >= need) { ok = true; break } }; ok }
            }
            if (FLAG_TOK.matches(t)) return { c -> c.flags[t] == true }
            if (t == "ext") { val op = next(); val v = next().replace("\"", ""); return { c -> if (op == "==") c.ext == v else if (op == "!=") c.ext != v else false } }
            throw IllegalArgumentException("unexpected token $t")
        }
        fun andE(): (Ctx) -> Boolean { var l = primary(); while (peek() == "and") { next(); val a = l; val b = primary(); l = { c -> a(c) && b(c) } }; return l }
        orE = { var l = andE(); while (peek() == "or") { next(); val a = l; val b = andE(); l = { c -> a(c) || b(c) } }; l }
        val fn = orE()
        if (p < toks.size) throw IllegalArgumentException("trailing tokens in condition: " + toks.subList(p, toks.size).joinToString(" "))
        return fn
    }

    fun parse(text: String): List<Rule> {
        val src = stripComments(text)
        val rules = ArrayList<Rule>()
        val block = Regex("rule\\s+([A-Za-z0-9_]+)\\s*\\{([\\s\\S]*?)\\n\\}")
        for (m in block.findAll(src)) {
            val rule = Rule(m.groupValues[1])
            var section = "meta"; val cond = StringBuilder()
            for (raw in m.groupValues[2].split("\n")) {
                val line = raw.trim()
                if (line.isEmpty()) continue
                if (Regex("^strings\\s*:").containsMatchIn(line)) { section = "strings"; continue }
                val cm = Regex("^condition\\s*:\\s*(.*)$").find(line)
                if (cm != null) { section = "cond"; cond.append(cm.groupValues[1]).append(' '); continue }
                if (section == "cond") { cond.append(line).append(' '); continue }
                if (section == "strings") { rule.strings.add(parseStringDef(line)); continue }
                val mm = Regex("^(name|score|scope|desc)\\s*:\\s*(.*)$").find(line) ?: continue
                var v = mm.groupValues[2].trim()
                if (v.startsWith("\"")) v = unescapeStr(v.substring(1, maxOf(1, v.lastIndexOf('"'))))
                when (mm.groupValues[1]) {
                    "score" -> rule.score = v.toDoubleOrNull()?.toInt() ?: 0
                    "scope" -> rule.scope = v.split(Regex("[,|]")).map { it.trim() }
                    "name" -> rule.name = v
                    "desc" -> rule.desc = v
                }
            }
            try { rule.cond = compileCondition(cond.toString().trim(), rule.strings.map { it.id }) }
            catch (e: Exception) { throw IllegalArgumentException("rule ${rule.id}: ${e.message}") }
            rules.add(rule)
        }
        return rules
    }
}

class RuleSet(val rules: List<Rule>) {
    init {
        for (r in rules) for (s in r.strings) {
            if (s.kind != "text") continue
            val v = ArrayList<String>()
            if (s.ascii) v.add(if (s.nocase) s.text.lowercase() else s.text)
            if (s.wide) { val w = s.text.map { "$it\u0000" }.joinToString(""); v.add(if (s.nocase) w.lowercase() else w) }
            s.keys = v.map { (if (s.nocase) "i:" else "c:") + it }
        }
    }
    val size get() = rules.size

    companion object {
        const val MAX_COUNT = 64
        const val REGEX_LIMIT = 8 * 1024 * 1024
        fun fromText(text: String) = RuleSet(RuleParser.parse(text))
    }

    fun match(buf: ByteArray, off: Int, len: Int, size: Long, ext: String, flags: Map<String, Boolean>): List<RuleHit> {
        val s = String(buf, off, len, Charsets.ISO_8859_1)
        var sl: String? = null
        val lower = { sl ?: s.lowercase().also { sl = it } }
        val needleCache = HashMap<String, Int>()
        fun countNeedle(key: String): Int = needleCache.getOrPut(key) {
            val hay = if (key[0] == 'i') lower() else s
            val n = key.substring(2)
            var c = 0; var i = hay.indexOf(n)
            while (i != -1 && c < MAX_COUNT) { c++; i = hay.indexOf(n, i + n.length) }
            c
        }
        val reSrc: CharSequence = if (s.length > REGEX_LIMIT) s.substring(0, REGEX_LIMIT) else s
        val hits = ArrayList<RuleHit>()
        for (r in rules) {
            if (!r.scope.contains("any") && !r.scope.any { flags["is_$it"] == true }) continue
            val counts = LinkedHashMap<String, Int>()
            val ctx = Ctx(size, ext, flags) { id ->
                counts[id] ?: run {
                    val def = r.strings.find { it.id == id }
                    var c = 0
                    if (def != null) {
                        if (def.kind == "text") for (k in def.keys) c += countNeedle(k)
                        else {
                            val mt: Matcher = def.re!!.matcher(reSrc)
                            try { while (c < MAX_COUNT && mt.find()) c++ } catch (e: StackOverflowError) { }
                        }
                    }
                    counts[id] = c; c
                }
            }
            val ok = try { r.cond(ctx) } catch (e: Exception) { false }
            if (ok) hits.add(RuleHit(r.id, r.name, r.score, r.desc, counts.filter { it.value > 0 }.keys.map { "$$it" }))
        }
        return hits
    }
}
