package com.developmentturkey.dtkalkan.engine

import java.io.InputStream
import java.security.MessageDigest

/** One reason contributing to a verdict (layer: signature | heuristic | rule | archive | decoded | trust). */
data class Reason(
    val layer: String, val code: String, val weight: Int, val tr: String, val en: String = tr,
    val tname: String? = null, val matched: List<String>? = null,
)

data class Child(val name: String, val verdict: String, val threat: String?, val score: Int)

class ScanResult {
    var path: String = ""; var name: String = ""; var size: Long = 0; var mtime: Long = 0
    var md5: String? = null; var sha256: String? = null
    var kind: String = "binary"; var ext: String = ""
    var flags: Map<String, Boolean> = emptyMap()
    var score = 0; var verdict = "clean"; var threat: String? = null
    var reasons: List<Reason> = emptyList()
    var layers: Map<String, Boolean> = emptyMap()
    var children: List<Child> = emptyList()
    var allowed = false; var truncated = false
    var error: String? = null
    var apk: ApkFacts? = null
}

data class EngineSettings(
    val heuristics: String = "normal", val heuristicsEnabled: Boolean = true, val archiveDepth: Int = 2, val maxFileMB: Int = 48,
    /** Android only: limit for each kept buffer (heap safety on phones). */
    val headLimitBytes: Int = Analyzer.HEAD_LIMIT,
)

class Budget(var bytes: Long = Analyzer.ARCHIVE_BUDGET)

/** DT Kalkan detection core — Kotlin port of analyze.js, plus the Android (APK/DEX) layer. */
class Analyzer(
    @Volatile var sigdb: SignatureDb?,
    @Volatile var rules: RuleSet?,
    @Volatile var settings: EngineSettings = EngineSettings(),
    @Volatile var allow: Set<String> = emptySet(),
) {
    companion object {
        const val HEAD_LIMIT = 48 * 1024 * 1024
        const val ENTRY_LIMIT = 24 * 1024 * 1024
        const val ARCHIVE_BUDGET = 160L * 1024 * 1024
        val SCRIPT_EXT = setOf("bat", "cmd", "ps1", "psm1", "psd1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "py", "pyw", "sh", "php", "reg", "scf", "inf", "au3", "ahk", "lnk", "url")
        val EXEC_EXT = setOf("exe", "dll", "scr", "com", "pif", "cpl", "sys", "ocx", "msi", "drv")
        val DOC_EXT = setOf("pdf", "doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "rtf", "txt", "jpg", "jpeg", "png", "gif", "mp4", "mp3", "zip", "rar")
        val SYSTEM_NAMES = setOf("svchost.exe", "explorer.exe", "lsass.exe", "csrss.exe", "winlogon.exe", "services.exe", "smss.exe", "spoolsv.exe", "taskhost.exe", "taskhostw.exe", "dwm.exe", "conhost.exe", "rundll32.exe", "wininit.exe", "ctfmon.exe")
        private val SCRIPT_HEAD = Regex("^(#!|<\\?php|@echo off|param[${Text.JS_WS}]*\\(|<script|Set[${Text.JS_WS}]+\\w+[${Text.JS_WS}]*=[${Text.JS_WS}]*CreateObject)", RegexOption.IGNORE_CASE)
        private val MEDIA = Regex("\\.(png|jpe?g|gif|emf|wmf|ttf|otf|woff2?|mp3|mp4)$")
        private val PS_ENC = Regex("-e(?:nc(?:odedcommand)?|c)?[${Text.JS_WS}]+([A-Za-z0-9+/]{40,}={0,2})", RegexOption.IGNORE_CASE)
        private val ENC_EXEC = Regex("\\.(exe|scr|js|vbs|bat|ps1|lnk|hta|dll)$", RegexOption.IGNORE_CASE)
        private val VBA_BIN = Regex("vbaProject\\.bin$", RegexOption.IGNORE_CASE)
        private val DEX_NAME = Regex("^classes\\d*\\.dex$")
        private val APK_SKIP = Regex("^(res/|lib/|META-INF/|kotlin/|resources\\.arsc$|.*\\.(xml|properties|version|kotlin_builtins|kotlin_module|bin|prof|profm)$)")

        private val PACKERS = listOf(
            Triple(Regex("^UPX[0-9!]?$", RegexOption.IGNORE_CASE), "UPX", 18), Triple(Regex("^\\.aspack$|^\\.adata$", RegexOption.IGNORE_CASE), "ASPack", 28),
            Triple(Regex("^\\.MPRESS[12]$", RegexOption.IGNORE_CASE), "MPRESS", 28), Triple(Regex("^\\.petite$", RegexOption.IGNORE_CASE), "Petite", 28),
            Triple(Regex("^\\.nsp[012]$", RegexOption.IGNORE_CASE), "NsPack", 30), Triple(Regex("^\\.themida$|^\\.winlice$", RegexOption.IGNORE_CASE), "Themida", 30),
            Triple(Regex("^\\.vmp[0-9]$", RegexOption.IGNORE_CASE), "VMProtect", 22), Triple(Regex("^\\.enigma[12]$", RegexOption.IGNORE_CASE), "Enigma", 25),
            Triple(Regex("^\\.pec2?$|^PEC2$", RegexOption.IGNORE_CASE), "PECompact", 28), Triple(Regex("^\\.yP$|^\\.y0da$", RegexOption.IGNORE_CASE), "Yoda", 35),
            Triple(Regex("^\\.MEW$|^MEW$", RegexOption.IGNORE_CASE), "MEW", 35), Triple(Regex("^\\.perplex$", RegexOption.IGNORE_CASE), "Perplex", 35),
            Triple(Regex("^\\.packed$", RegexOption.IGNORE_CASE), "Generic", 30),
        )
        private val SENS = mapOf("low" to (0.75 to 50), "normal" to (1.0 to 40), "high" to (1.3 to 30))

        data class Combined(val score: Int, val verdict: String, val threat: String?)

        fun combine(reasons: List<Reason>, sens: String = "normal"): Combined {
            val (mul, susp) = SENS[sens] ?: SENS["normal"]!!
            var sig = 0.0; var rule = 0.0; var ruleRest = 0.0; var heur = 0.0; var sub = 0.0
            for (r in reasons) when (r.layer) {
                "signature" -> sig = 100.0
                "rule" -> if (r.weight > rule) { ruleRest += rule; rule = r.weight.toDouble() } else ruleRest += r.weight
                "heuristic" -> heur += r.weight
                "archive", "decoded" -> sub = maxOf(sub, r.weight.toDouble())
                "trust" -> heur += r.weight
            }
            heur = maxOf(0.0, minOf(85.0, heur * mul))
            rule = minOf(100.0, rule + ruleRest * 0.1)
            val hi = maxOf(rule, heur); val lo = minOf(rule, heur)
            val score = Text.jsRound(minOf(100.0, maxOf(sig, sub, hi + lo * 0.35))).toInt()
            val verdict = if (score >= 70) "malicious" else if (score >= susp) "suspicious" else "clean"
            val order = mapOf("signature" to 4, "archive" to 3, "decoded" to 3, "rule" to 2, "heuristic" to 1)
            val named = reasons.filter { it.tname != null }
            val best = named.sortedWith { a, b -> val d = (order[b.layer] ?: 0) - (order[a.layer] ?: 0); if (d != 0) d else b.weight - a.weight }.firstOrNull()
            var threat: String? = null
            if (verdict != "clean") {
                threat = best?.tname ?: "Trojan.Generic"
                val onlyHeur = reasons.none { it.layer == "signature" || it.layer == "rule" || it.layer == "archive" || it.layer == "decoded" }
                if (onlyHeur && !threat.startsWith("HEUR:")) threat = "HEUR:$threat"
            }
            return Combined(score, verdict, threat)
        }
    }

    class Sniff(val ext: String, var kind: String, val flags: MutableMap<String, Boolean>)

    fun sniff(b: Buf, name: String): Sniff {
        val ext = Text.ext(name).lowercase()
        val f = linkedMapOf("is_pe" to false, "is_dll" to false, "is_script" to false, "is_text" to false, "is_office" to false, "is_dotnet" to false, "is_zip" to false, "is_lnk" to false, "is_signed" to false)
        var kind = "binary"
        if (b.len >= 2 && b.at(0) == 0x4d && b.at(1) == 0x5a) { kind = "pe"; f["is_pe"] = true }
        else if (b.len >= 4 && b.u32(0) == 0x04034b50L) { kind = "zip"; f["is_zip"] = true }
        else if (b.len >= 8 && b.u32be(0) == 0xd0cf11e0L && b.u32be(4) == 0xa1b11ae1L) { kind = "ole"; f["is_office"] = true }
        else if (b.len >= 8 && b.u32(0) == 0x4cL && b.u32(4) == 0x00021401L) { kind = "lnk"; f["is_lnk"] = true }
        else if (b.len >= 5 && b.latin1(0, 5) == "%PDF-") kind = "pdf"
        else if (b.len >= 5 && b.latin1(0, 5) == "{\\rtf") { kind = "rtf"; f["is_office"] = true; f["is_text"] = true }
        else if (b.len >= 8 && b.latin1(0, 4) == "dex\n") { kind = "dex"; f["is_dex"] = true } // Android layer
        else if (b.len >= 4 && b.at(0) == 0x7f && b.latin1(1, 4) == "ELF") { kind = "elf"; f["is_elf"] = true } // Android layer
        if (kind == "binary") {
            val n = minOf(b.len, 8192)
            var bad = 0; var start = 0
            if (b.at(0) == 0xff && b.at(1) == 0xfe) { kind = "text"; f["is_text"] = true }
            else {
                if (b.at(0) == 0xef && b.at(1) == 0xbb && b.at(2) == 0xbf) start = 3
                for (i in start until n) { val c = b.at(i); if (c == 0 || c < 9 || (c in 14..31 && c != 27)) bad++ }
                if (n == 0 || bad.toDouble() / maxOf(1, n) < 0.02) { kind = "text"; f["is_text"] = true }
            }
        }
        if (ext in SCRIPT_EXT && (f["is_text"] == true || f["is_lnk"] == true)) { f["is_script"] = true; if (kind == "text") kind = "script" }
        if (kind == "text" && SCRIPT_HEAD.containsMatchIn(Text.jsTrimStart(b.latin1(0, 200)))) { f["is_script"] = true; kind = "script" }
        if (ext in setOf("docm", "xlsm", "pptm", "doc", "xls", "ppt", "dotm", "xlam")) f["is_office"] = f["is_office"] == true || kind == "zip"
        return Sniff(ext, kind, f)
    }

    // ───────── MS-OVBA ─────────
    fun ovbaDecompress(b: Buf, start: Int, limit: Int = 512 * 1024): ByteArray? {
        if (b.at(start) != 1) return null
        val out = ByteArrayBuilder()
        var p = start + 1
        while (p + 2 <= b.len && out.size < limit) {
            val header = b.u16(p)
            if (((header shr 12) and 7) != 3) break
            val chunkEnd = minOf(b.len, p + (header and 0x0fff) + 3)
            val compressed = (header shr 15) and 1
            p += 2
            val dStart = out.size
            if (compressed == 0) { var i = 0; while (i < 4096 && p < b.len) { out.add(b.at(p++)); i++ }; continue }
            while (p < chunkEnd) {
                val flags = b.at(p++)
                var bit = 0
                while (bit < 8 && p < chunkEnd) {
                    if (((flags shr bit) and 1) == 0) { out.add(b.at(p++)); bit++; continue }
                    if (p + 2 > b.len) { p = chunkEnd; break }
                    val token = b.u16(p); p += 2
                    val diff = out.size - dStart
                    var bc = 4; while ((1 shl bc) < diff) bc++
                    val lengthMask = 0xffff shr bc
                    val len = (token and lengthMask) + 3
                    val off = (token shr (16 - bc)) + 1
                    val from = out.size - off
                    if (from < 0) return out.toArray()
                    for (k in 0 until len) out.add(out[from + k])
                    bit++
                }
            }
            p = chunkEnd
        }
        return out.toArray()
    }

    fun extractVBA(b: Buf): ByteArray? {
        val parts = ArrayList<ByteArray>()
        val needle = "Attribut".toByteArray(Charsets.ISO_8859_1)
        var i = b.indexOf(needle); var total = 0; var guard = 0
        while (i != -1 && guard++ < 200 && total < 2 * 1024 * 1024) {
            if (i >= 4 && b.at(i - 4) == 1 && b.at(i - 1) == 0) {
                val src = ovbaDecompress(b, i - 4)
                if (src != null && src.size > 16 && String(src, 0, minOf(64, src.size), Charsets.ISO_8859_1).contains("Attribute VB_")) { parts.add(src); total += src.size }
            }
            i = b.indexOf(needle, i + 8)
        }
        if (parts.isEmpty()) return null
        val o = java.io.ByteArrayOutputStream(total); parts.forEach { o.write(it) }; return o.toByteArray()
    }

    // ───────── PE heuristics ─────────
    private fun peHeuristics(pe: PeInfo, name: String, fullSize: Long, filePath: String?): List<Reason> {
        val r = ArrayList<Reason>()
        fun add(w: Int, code: String, tr: String, en: String, tname: String? = null) = r.add(Reason("heuristic", code, w, tr, en, tname))
        if (!pe.valid) return r
        val imp = pe.importSet
        fun has(vararg fs: String) = fs.any { imp.contains(it.lowercase()) }
        val seen = HashSet<String>()
        for (s in pe.sections) for ((re, pk, w) in PACKERS) {
            if (re.containsMatchIn(s.name) && pk !in seen) { seen.add(pk); add(w, "packer", "Paketleyici bölümü tespit edildi: $pk (${s.name})", "Packer section detected: $pk (${s.name})", "Packed.Win32.$pk"); break }
        }
        val execSecs = pe.sections.filter { it.exec && it.rawSize > 512 }
        val hiExec = execSecs.filter { it.entropy > 7.2 }
        if (hiExec.isNotEmpty()) { val h = hiExec[0]; val nm = h.name.ifEmpty { "?" }
            add(20, "entropy", "Yüksek entropili kod bölümü ($nm: ${Text.toFixed2(h.entropy)}) — şifrelenmiş/paketlenmiş olabilir", "High-entropy code section ($nm: ${Text.toFixed2(h.entropy)}) — likely packed/encrypted", "Packed.Win32.Generic") }
        val raw = pe.sections.sumOf { it.rawSize }
        val hiAll = pe.sections.filter { it.entropy > 7.0 }.sumOf { it.rawSize }
        if (raw > 4096 && hiAll.toDouble() / raw > 0.8 && hiExec.isEmpty()) add(10, "entropy-all", "Dosyanın büyük bölümü sıkıştırılmış/şifrelenmiş veri", "Most of the file is compressed/encrypted data")
        val es = pe.entrySection
        if (es == null && pe.entryRva != 0L) add(22, "ep-outside", "Giriş noktası hiçbir bölümün içinde değil", "Entry point lies outside all sections", "Trojan.Win32.Generic")
        else if (es != null && !es.exec) add(20, "ep-nonexec", "Giriş noktası çalıştırılamaz bölümde (${es.name})", "Entry point in non-executable section (${es.name})", "Trojan.Win32.Generic")
        else if (es != null && pe.sections.size > 2 && es === pe.sections.last() && es.write) add(14, "ep-last", "Giriş noktası son ve yazılabilir bölümde (paketleyici izi)", "Entry point in last writable section (packer trait)")
        val wx = pe.sections.filter { it.exec && it.write }
        if (wx.isNotEmpty()) add(8, "wx", "Hem yazılabilir hem çalıştırılabilir bölüm (${wx[0].name})", "Writable and executable section (${wx[0].name})")
        if (has("VirtualAllocEx", "NtAllocateVirtualMemory", "ZwAllocateVirtualMemory") && has("WriteProcessMemory", "NtWriteVirtualMemory") && has("CreateRemoteThread", "CreateRemoteThreadEx", "NtCreateThreadEx", "RtlCreateUserThread", "QueueUserAPC", "SetThreadContext"))
            add(if (pe.isDll) 20 else 35, "inject", "Süreç enjeksiyonu API zinciri (VirtualAllocEx → WriteProcessMemory → CreateRemoteThread)", "Process injection API chain (VirtualAllocEx → WriteProcessMemory → CreateRemoteThread)", "Trojan.Win32.Injector.Gen")
        if (has("NtUnmapViewOfSection", "ZwUnmapViewOfSection") && has("SetThreadContext", "Wow64SetThreadContext") && has("ResumeThread"))
            add(30, "hollow", "Süreç boşaltma (process hollowing) API dizisi", "Process hollowing API sequence", "Trojan.Win32.Hollow.Gen")
        if (has("SetWindowsHookEx") && has("GetAsyncKeyState", "GetKeyState", "GetKeyboardState") && has("GetForegroundWindow"))
            add(22, "keylog", "Klavye kancası + tuş durumu okuma (keylogger davranışı)", "Keyboard hook + key state polling (keylogger behaviour)", "Spyware.Win32.Keylogger.Gen")
        else if (has("GetAsyncKeyState") && has("GetForegroundWindow") && has("GetWindowText"))
            add(10, "keypoll", "Tuş durumu ve etkin pencere başlığı takibi", "Polls keys and active window title")
        if (has("URLDownloadToFile", "URLDownloadToCacheFile") && has("WinExec", "ShellExecute", "ShellExecuteEx", "CreateProcess"))
            add(20, "download-exec", "İnternetten dosya indirip çalıştırma (URLDownloadToFile + çalıştırma)", "Downloads and executes files (URLDownloadToFile + exec)", "Trojan-Downloader.Win32.Agent")
        if (has("IsDebuggerPresent") && has("CheckRemoteDebuggerPresent") && has("NtQueryInformationProcess", "OutputDebugString"))
            add(6, "antidebug", "Hata ayıklayıcı algılama teknikleri", "Anti-debugging techniques")
        if (has("AdjustTokenPrivileges") && has("OpenProcess") && has("MiniDumpWriteDump"))
            add(30, "lsass-dump", "Bellek dökümü + yetki yükseltme (kimlik bilgisi çalma aracı izi)", "Memory dump + privilege adjust (credential dumping)", "HackTool.Win32.CredDump")
        if (has("CryptEncrypt", "BCryptEncrypt") && has("FindFirstFile", "FindFirstFileEx") && has("MoveFileEx", "MoveFile") && has("GetLogicalDrives", "GetDriveType"))
            add(18, "ransom-api", "Sürücü tarama + toplu şifreleme API kombinasyonu", "Drive enumeration + bulk encryption API combination", "Trojan-Ransom.Win32.Gen")
        if (!pe.isDotNet && pe.importCount > 0 && pe.importCount < 6 && has("GetProcAddress") && has("LoadLibrary", "LoadLibraryEx"))
            add(15, "few-imports", "Çok az içe aktarım (${pe.importCount}) — çalışma anında API çözümleme", "Very few imports (${pe.importCount}) — resolves APIs at runtime", "Packed.Win32.Generic")
        if (!pe.isDotNet && pe.imports.isEmpty() && !pe.isDll && pe.sections.isNotEmpty()) add(14, "no-imports", "İçe aktarım tablosu yok", "No import table")
        if (pe.tlsCallbacks > 0) add(8, "tls", "TLS geri çağrıları (${pe.tlsCallbacks}) — giriş noktasından önce kod çalıştırma", "TLS callbacks (${pe.tlsCallbacks}) — code runs before entry point")
        if (pe.overlaySize > 64 * 1024 && pe.overlaySize.toDouble() / fullSize > 0.4 && pe.overlayEntropy > 7.5 && !pe.signed && !pe.hasVersionInfo)
            add(12, "overlay", "Büyük şifreli ek veri (overlay ${Text.toFixed1(pe.overlaySize / 1048576.0)} MB)", "Large encrypted overlay (${Text.toFixed1(pe.overlaySize / 1048576.0)} MB)")
        val base = Text.basename(name).lowercase()
        if (!pe.hasVersionInfo && !pe.isDll && pe.subsystem == 2) add(5, "no-version", "Sürüm bilgisi (yayıncı/ürün) yok", "Missing version information")
        val orig = (pe.version["OriginalFilename"] ?: "").lowercase().replace(Regex("\\.mui$"), "")
        if (orig.isNotEmpty() && orig in SYSTEM_NAMES && !Regex("\\\\windows\\\\(system32|syswow64)\\\\", RegexOption.IGNORE_CASE).containsMatchIn(filePath ?: "") && orig != base)
            add(35, "masquerade", "Windows sistem dosyası gibi davranıyor (${pe.version["OriginalFilename"]}) ama yeri/adı farklı", "Masquerades as a Windows system file (${pe.version["OriginalFilename"]})", "Trojan.Win32.Masquerade")
        if (base in SYSTEM_NAMES && filePath != null && !Regex("\\\\windows\\\\", RegexOption.IGNORE_CASE).containsMatchIn(filePath) && Regex("^[a-z]:\\\\", RegexOption.IGNORE_CASE).containsMatchIn(filePath))
            add(30, "sysname", "Sistem dosyası adıyla Windows klasörü dışında ($base)", "System file name outside Windows folder ($base)", "Trojan.Win32.Masquerade")
        val ts = pe.timestamp * 1000; val now = System.currentTimeMillis()
        if (pe.timestamp != 0L && ts > now + 86400000L * 30 && ts < now + 86400000L * 365 * 20) add(4, "future-ts", "Derleme zamanı gelecekte", "Compile timestamp in the future")
        if (pe.parseError != null) add(10, "malformed", "Bozuk/kasıtlı olarak hatalı PE başlıkları", "Malformed PE headers")
        return r
    }

    private fun nameHeuristics(name: String): List<Reason> {
        val r = ArrayList<Reason>()
        val base = Text.basename(name); val lower = base.lowercase()
        if (base.contains('\u202e')) r.add(Reason("heuristic", "rtlo", 45, "Dosya adında yön değiştirme (RTLO) karakteri — uzantı gizleme", "Right-to-left override in file name — hides extension", "Trojan.Win32.Masquerade"))
        val m = Regex("\\.([a-z0-9]{2,4})[${Text.JS_WS}]*\\.([a-z0-9]{2,4})$").find(lower)
        if (m != null && m.groupValues[1] in DOC_EXT && (m.groupValues[2] in EXEC_EXT || m.groupValues[2] in setOf("bat", "cmd", "vbs", "js", "ps1", "hta", "lnk", "scr")))
            r.add(Reason("heuristic", "double-ext", 35, "Çift uzantı ile gizlenmiş çalıştırılabilir dosya (.${m.groupValues[1]}.${m.groupValues[2]})", "Executable hidden behind double extension (.${m.groupValues[1]}.${m.groupValues[2]})", "Trojan.Win32.Masquerade"))
        if (Regex("[${Text.JS_WS}]{6,}\\.(exe|scr|com|bat)$", RegexOption.IGNORE_CASE).containsMatchIn(base)) r.add(Reason("heuristic", "space-pad", 25, "Uzantıyı gizlemek için çok sayıda boşluk", "Many spaces used to hide the extension"))
        return r
    }

    /**
     * Analyse an in-memory buffer (desktop analyzeBuffer). [apkCtx] carries installed-package facts for the Android layer.
     */
    fun analyzeBuffer(data: ByteArray, len: Int, name: String, depth: Int = 0, hashes: Pair<String, String>? = null,
                      fullSize: Long = len.toLong(), filePath: String? = null, budget: Budget = Budget(), apkCtx: InstalledFacts? = null): ScanResult {
        val b = Buf(data, 0, len)
        val reasons = ArrayList<Reason>()
        val info = sniff(b, name)
        val layers = linkedMapOf("signature" to false, "heuristic" to false, "rules" to false, "archive" to false)
        val s = settings
        val md5 = hashes?.first ?: Digest.md5(data, 0, len)
        val sha256 = hashes?.second ?: Digest.sha256(data, 0, len)
        val res = ScanResult(); res.md5 = md5; res.sha256 = sha256
        sigdb?.let { db ->
            layers["signature"] = true
            val hit = db.lookup(md5, sha256)
            if (hit.hit) {
                val fam = hit.name ?: if (info.flags["is_pe"] == true) "Trojan.Win32.Generic.Sig" else if (info.flags["is_script"] == true) "Trojan.Script.Generic.Sig"
                    else if (info.kind == "dex" || (info.kind == "zip" && looksApk(data, len))) "Trojan.AndroidOS.Generic.Sig" else "Malware.Generic.Sig"
                reasons.add(Reason("signature", "hash", 100, "Bilinen zararlı yazılım imzası eşleşti (SHA-256/MD5)${if (hit.test) " — test dosyası" else ""}", "Known malware signature matched (SHA-256/MD5)${if (hit.test) " — test file" else ""}", fam))
            }
        }
        if (allow.contains(sha256)) {
            res.kind = info.kind; res.verdict = "clean"; res.score = 0; res.allowed = true; res.layers = layers
            res.reasons = listOf(Reason("trust", "allow", 0, "Kullanıcı tarafından güvenilir olarak işaretlendi", "Marked as trusted by the user"))
            return res
        }
        // 2) PE heuristics
        if (info.flags["is_pe"] == true && s.heuristicsEnabled) {
            layers["heuristic"] = true
            val pe = Pe.parse(data, len)
            if (pe.valid) {
                info.flags["is_dll"] = pe.isDll; info.flags["is_dotnet"] = pe.isDotNet; info.flags["is_signed"] = pe.signed
                reasons.addAll(peHeuristics(pe, name, fullSize, filePath))
                if (pe.signed && reasons.any { it.layer == "heuristic" }) reasons.add(Reason("trust", "signed", -15, "Dijital imza bloğu mevcut (puan düşürüldü)", "Has a digital signature block (score reduced)"))
                if (info.ext in setOf("scr", "pif", "com")) reasons.add(Reason("heuristic", "rare-ext", 10, "Nadir çalıştırılabilir uzantısı (.${info.ext})", "Unusual executable extension (.${info.ext})"))
            } else if (info.ext in EXEC_EXT && len > 64) {
                reasons.add(Reason("heuristic", "bad-pe", 10, "Geçersiz/bozuk çalıştırılabilir dosya yapısı", "Invalid/corrupt executable structure"))
            }
        }
        if (s.heuristicsEnabled) {
            val nh = nameHeuristics(name)
            if (nh.isNotEmpty()) { layers["heuristic"] = true; reasons.addAll(nh) }
            if (info.flags["is_pe"] != true && info.ext in setOf("exe", "scr", "dll") && info.kind == "script") reasons.add(Reason("heuristic", "fake-exe", 15, "Çalıştırılabilir uzantılı ama betik içeriği", "Executable extension but script content"))
        }
        // 3) rules
        val rs = rules
        var dexStrings: String? = null
        if (rs != null) {
            layers["rules"] = true
            var content = data; var cLen = len
            if (info.kind == "text" && b.at(0) == 0xff && b.at(1) == 0xfe) { content = Text.latin1Bytes(Text.utf16le(b)); cLen = content.size }
            if (info.kind == "dex") { dexStrings = Dex.strings(data, len).joinToString("\n"); content = Text.latin1Bytes(dexStrings); cLen = content.size }
            var extra: ByteArray? = null
            if (info.kind == "ole" || (info.flags["is_office"] == true && info.kind != "zip")) { val v = extractVBA(b); if (v != null) { extra = v; layers["archive"] = true } }
            val target = if (extra != null) ByteArray(cLen + 1 + extra.size).also { System.arraycopy(content, 0, it, 0, cLen); it[cLen] = '\n'.code.toByte(); System.arraycopy(extra, 0, it, cLen + 1, extra.size) } else content
            val tLen = if (extra != null) target.size else cLen
            for (h in rs.match(target, 0, tLen, fullSize, info.ext, info.flags)) reasons.add(Reason("rule", h.id, h.score, h.desc.ifEmpty { h.id }, h.desc.ifEmpty { h.id }, h.name, h.matched))
            if ((info.flags["is_script"] == true || info.flags["is_text"] == true || info.flags["is_lnk"] == true) && depth < 3) {
                val str = String(target, 0, tLen, Charsets.ISO_8859_1)
                var n = 0
                for (m in PS_ENC.findAll(str)) {
                    if (n++ >= 4) break
                    try {
                        val dec = Text.utf16le(Buf(Text.base64Lenient(m.groupValues[1])))
                        if (Regex("[a-z]{3}", RegexOption.IGNORE_CASE).containsMatchIn(dec)) {
                            val db = Text.latin1Bytes(dec)
                            val sub = analyzeBuffer(db, db.size, "decoded.ps1", depth + 1, null, db.size.toLong(), null, budget)
                            if (sub.verdict != "clean") reasons.add(Reason("decoded", "ps-enc", sub.score, "Çözülmüş gizli PowerShell yükü: ${sub.threat}", "Decoded hidden PowerShell payload: ${sub.threat}", sub.threat))
                            else reasons.add(Reason("heuristic", "ps-enc-clean", 10, "Gizlenmiş PowerShell komutu (çözüldü, belirgin zararlı içerik yok)", "Encoded PowerShell command (decoded, nothing overtly malicious)"))
                        }
                    } catch (_: Exception) { }
                }
            }
        }
        // 4) archives (APKs get the Android layer + a focused entry walk)
        val children = ArrayList<Child>()
        if (info.kind == "zip" && depth < s.archiveDepth + 1) {
            layers["archive"] = true
            val entries = Zip.list(data, len, 3000)
            val isApk = entries.any { it.name == "AndroidManifest.xml" } && entries.any { DEX_NAME.matches(it.name) }
            if (isApk) {
                info.flags["is_apk"] = true; info.kind = "apk"
                val man = entries.firstOrNull { it.name == "AndroidManifest.xml" }?.let { Zip.read(data, len, it, 4 * 1024 * 1024) }
                val facts = man?.let { Axml.parseManifest(it) } ?: ApkFacts()
                res.apk = facts
                var dexAll = StringBuilder()
                for (e in entries.filter { DEX_NAME.matches(it.name) }) {
                    if (budget.bytes <= 0) break
                    val d = Zip.read(data, len, e, ENTRY_LIMIT) ?: continue
                    budget.bytes -= d.size
                    if (dexAll.length < 32 * 1024 * 1024) Dex.strings(d, d.size).forEach { dexAll.append(it).append('\n') }
                    val sub = analyzeBuffer(d, d.size, e.name, depth + 1, null, d.size.toLong(), null, budget)
                    if (sub.verdict != "clean") { children.add(Child(e.name, sub.verdict, sub.threat, sub.score)); reasons.add(Reason("archive", "child", sub.score, "APK içinde: ${e.name} → ${sub.threat}", "Inside APK: ${e.name} → ${sub.threat}", sub.threat)) }
                }
                if (rs != null) {
                    val apkFlags = HashMap(info.flags); apkFlags["is_apk"] = true
                    val manText = Text.latin1Bytes(facts.permissions.joinToString("\n") + "\n" + facts.packageName + "\n" + facts.components.joinToString("\n"))
                    for (h in rs.match(manText, 0, manText.size, fullSize, "apk", apkFlags)) reasons.add(Reason("rule", h.id, h.score, h.desc, h.desc, h.name, h.matched))
                }
                if (s.heuristicsEnabled) reasons.addAll(AndroidHeuristics.analyze(facts, dexAll.toString(), apkCtx))
                for (e in entries) {
                    if (e.dir || e.encrypted || budget.bytes <= 0 || DEX_NAME.matches(e.name) || APK_SKIP.containsMatchIn(e.name) || MEDIA.containsMatchIn(e.name.lowercase())) continue
                    if (e.usize > ENTRY_LIMIT * 4L) continue
                    val d = Zip.read(data, len, e, ENTRY_LIMIT) ?: continue
                    budget.bytes -= d.size
                    val sub = analyzeBuffer(d, d.size, e.name, depth + 1, null, d.size.toLong(), null, budget)
                    if (sub.verdict != "clean") { children.add(Child(e.name, sub.verdict, sub.threat, sub.score)); reasons.add(Reason("archive", "child", sub.score, "APK içinde: ${e.name} → ${sub.threat}", "Inside APK: ${e.name} → ${sub.threat}", sub.threat)) }
                }
            } else {
                val enc = entries.filter { it.encrypted && !it.dir }
                val vba = entries.firstOrNull { VBA_BIN.containsMatchIn(it.name) }
                for (e in entries) {
                    if (e.dir || e.encrypted || budget.bytes <= 0) continue
                    if (e.usize > ENTRY_LIMIT * 4L) continue
                    if (MEDIA.containsMatchIn(e.name.lowercase())) continue
                    val d = Zip.read(data, len, e, ENTRY_LIMIT) ?: continue
                    budget.bytes -= d.size
                    val sub = analyzeBuffer(d, d.size, e.name, depth + 1, null, d.size.toLong(), null, budget)
                    if (VBA_BIN.containsMatchIn(e.name)) {
                        val v = extractVBA(Buf(d))
                        if (v != null && rs != null) {
                            val cat = d + v
                            val fl = HashMap(info.flags); fl["is_office"] = true
                            for (h in rs.match(cat, 0, cat.size, d.size.toLong(), "bin", fl)) reasons.add(Reason("rule", h.id, h.score, h.desc.ifEmpty { h.id }, h.desc.ifEmpty { h.id }, h.name, h.matched))
                        }
                    }
                    if (sub.verdict != "clean") { children.add(Child(e.name, sub.verdict, sub.threat, sub.score)); reasons.add(Reason("archive", "child", sub.score, "Arşiv içinde: ${e.name} → ${sub.threat}", "Inside archive: ${e.name} → ${sub.threat}", sub.threat)) }
                }
                if (enc.isNotEmpty() && enc.any { ENC_EXEC.containsMatchIn(it.name) })
                    reasons.add(Reason("heuristic", "enc-archive", 30, "Parola korumalı arşivde çalıştırılabilir dosya (taramadan kaçma yöntemi)", "Password-protected archive containing executables (scan evasion)", "Trojan.Archive.Encrypted"))
                if (vba != null) info.flags["is_office"] = true
            }
        }
        val c = combine(reasons, s.heuristics)
        res.kind = info.kind; res.ext = info.ext; res.flags = info.flags; res.score = c.score; res.verdict = c.verdict; res.threat = c.threat
        res.reasons = reasons; res.layers = layers; res.children = children
        return res
    }

    private fun looksApk(data: ByteArray, len: Int): Boolean = Zip.list(data, len, 3000).any { it.name == "AndroidManifest.xml" }

    /** Streaming hash + analysis (desktop scanFile). Reads [open] once. */
    fun scanStream(path: String, name: String, size: Long, mtime: Long, open: () -> InputStream, apkCtx: InstalledFacts? = null): ScanResult {
        val s = settings
        val md5 = MessageDigest.getInstance("MD5"); val sha = MessageDigest.getInstance("SHA-256")
        val limit = minOf(s.headLimitBytes.toLong(), if (s.maxFileMB > 0) s.maxFileMB * 1048576L else s.headLimitBytes.toLong()).toInt()
        val keep = ByteArray(minOf(limit.toLong(), maxOf(size, 0L)).toInt().coerceAtLeast(0))
        var kept = 0; var total = 0L
        var keepBuf = keep
        try {
            open().use { ins ->
                val chunk = ByteArray(1 shl 20)
                while (true) {
                    val n = ins.read(chunk); if (n < 0) break
                    md5.update(chunk, 0, n); sha.update(chunk, 0, n); total += n
                    if (kept < limit) {
                        val take = minOf(n, limit - kept)
                        if (kept + take > keepBuf.size) keepBuf = keepBuf.copyOf(minOf(limit, maxOf(keepBuf.size * 2, kept + take)))
                        System.arraycopy(chunk, 0, keepBuf, kept, take); kept += take
                    }
                }
            }
        } catch (e: Exception) {
            return ScanResult().also { it.path = path; it.name = name; it.size = size; it.error = errCode(e); it.verdict = "error" }
        }
        val hashes = Hex.of(md5.digest()) to Hex.of(sha.digest())
        return try {
            val r = analyzeBuffer(keepBuf, kept, name, 0, hashes, total, path, Budget(), apkCtx)
            r.path = path; r.name = name; r.size = total; r.mtime = mtime; r.truncated = total > kept
            r
        } catch (e: Throwable) {
            ScanResult().also { it.path = path; it.name = name; it.size = total; it.md5 = hashes.first; it.sha256 = hashes.second; it.error = "ANALYSIS:" + e.message; it.verdict = "error" }
        }
    }

    fun scanFile(f: java.io.File, apkCtx: InstalledFacts? = null): ScanResult {
        if (!f.exists()) return ScanResult().also { it.path = f.path; it.name = f.name; it.error = "ENOENT"; it.verdict = "error" }
        if (!f.isFile) return ScanResult().also { it.path = f.path; it.name = f.name; it.error = "NOTFILE"; it.verdict = "error" }
        return scanStream(f.path, f.name, f.length(), f.lastModified(), { f.inputStream() }, apkCtx)
    }

    private fun errCode(e: Exception): String = when (e) {
        is java.io.FileNotFoundException -> if ((e.message ?: "").contains("EACCES") || (e.message ?: "").contains("Permission denied")) "EACCES" else "ENOENT"
        is SecurityException -> "EPERM"
        else -> e.javaClass.simpleName
    }
}

internal class ByteArrayBuilder {
    private var a = ByteArray(4096); var size = 0; private set
    fun add(v: Int) { if (size == a.size) a = a.copyOf(a.size * 2); a[size++] = v.toByte() }
    operator fun get(i: Int): Int = a[i].toInt() and 0xff
    fun toArray(): ByteArray = a.copyOf(size)
}
