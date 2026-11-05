package com.developmentturkey.dtkalkan.core

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.FileObserver
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import com.developmentturkey.dtkalkan.Product
import com.developmentturkey.dtkalkan.engine.Analyzer
import com.developmentturkey.dtkalkan.engine.EngineSettings
import com.developmentturkey.dtkalkan.engine.InstalledFacts
import com.developmentturkey.dtkalkan.engine.Reason
import com.developmentturkey.dtkalkan.engine.RulePack
import com.developmentturkey.dtkalkan.engine.ScanResult
import com.developmentturkey.dtkalkan.engine.SignatureDb
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.Calendar
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

/**
 * Protection core (port of the desktop core.js): engine, scans, quarantine, history, real-time watchers,
 * scheduler, signature updates, weather. Emits the same events the desktop UI listens to.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Core private constructor(val ctx: Context) {
    companion object {
        @Volatile private var inst: Core? = null
        fun get(ctx: Context): Core = inst ?: synchronized(this) { inst ?: Core(ctx.applicationContext).also { inst = it; it.init() } }
        val RPC = setOf("getState", "setSettings", "resetSettings", "startScan", "pauseScan", "resumeScan", "cancelScan", "getScan", "listScans", "scanPaths", "applyAction",
            "listQuarantine", "restoreQuarantine", "deleteQuarantine", "deleteAllQuarantine", "removeAllow", "listHistory", "clearHistory", "updateSignatures", "getWeather",
            "systemInfo", "knownFolders", "setStartup", "sigInfo", "listApps", "appInfo", "appIcons")
        const val APP = "app://"
    }

    // ───────── storage ─────────
    private val root = ctx.filesDir
    val dirs = mapOf("db" to File(root, "db"), "scans" to File(root, "scans"), "logs" to File(root, "logs"))
    val store: Store
    private val historyFile = File(root, "history.json")
    private val history: MutableList<JSONObject>
    val quarantine: Quarantine
    private var recentScans: MutableList<JSONObject>
    val apps = Apps(ctx)
    val perms = Perms(ctx)
    private val weather = Weather(ctx)
    lateinit var engine: Analyzer; private set
    private lateinit var sigFile: File
    private var familyNames = JSONObject()
    @Volatile var updating = false; private set

    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val scanPool = Dispatchers.IO.limitedParallelism(maxOf(2, minOf(3, Runtime.getRuntime().availableProcessors() - 1)))
    private val listeners = CopyOnWriteArrayList<(String, Any?) -> Unit>()
    @Volatile private var active: ScanState? = null
    private val ignoreWatch = java.util.Collections.synchronizedSet(HashSet<String>())

    init {
        dirs.values.forEach { it.mkdirs() }
        store = Store(File(root, "settings.json"))
        if (store.data.getJSONObject("stats").optLong("installedAt") == 0L) store.patch(JSONObject().put("stats", JSONObject().put("installedAt", System.currentTimeMillis())))
        history = try { val a = JSONArray(historyFile.readText()); (0 until a.length()).map { a.getJSONObject(it) }.toMutableList() } catch (e: Exception) { mutableListOf() }
        quarantine = Quarantine(File(ctx.noBackupFilesDir, "Quarantine"))
        recentScans = try { val a = JSONArray(File(dirs["scans"], "index.json").readText()); (0 until a.length()).map { a.getJSONObject(it) }.toMutableList() } catch (e: Exception) { mutableListOf() }
    }

    private fun init() {
        ensureDb()
        engine = Analyzer(SignatureDb.open(sigFile), loadRules(), engineSettings(), allowSet())
        scope.launch(Dispatchers.IO) { try { quarantine.purgeOlderThan(settings.getJSONObject("quarantine").optInt("retentionDays")) } catch (_: Exception) { } }
        log("core started ${Product.version}")
    }
    val settings: JSONObject get() = store.data

    fun on(l: (String, Any?) -> Unit) { listeners.add(l) }
    fun off(l: (String, Any?) -> Unit) { listeners.remove(l) }
    fun emit(name: String, data: Any?) { for (l in listeners) try { l(name, data) } catch (e: Exception) { log("listener $name: $e") } }
    fun log(msg: String) { try { File(dirs["logs"], "core.log").appendText("[${java.time.Instant.now()}] $msg\n") } catch (_: Exception) { } }

    // ───────── database ─────────
    private fun ensureDb() {
        sigFile = File(dirs["db"], "sigs.bin")
        try {
            val bundledCreated = ctx.assets.open("data/sigs.bin").use { val h = ByteArray(32); it.read(h); java.nio.ByteBuffer.wrap(h).getInt(8).toLong() and 0xffffffffL } * 1000
            val cur = SignatureDb.header(sigFile)
            if (cur == null || bundledCreated > cur[0]) {
                val tmp = File(sigFile.path + ".copy")
                ctx.assets.open("data/sigs.bin").use { i -> tmp.outputStream().use { i.copyTo(it, 1 shl 20) } }
                tmp.renameTo(sigFile)
            }
        } catch (e: Exception) { log("db init: $e") }
        familyNames = try { JSONObject(File(dirs["db"], "names.json").readText()) } catch (e: Exception) { JSONObject() }
    }
    private fun loadRules() = RulePack.load(ctx.assets.open("data/rules.dat").use { it.readBytes() }, ctx.assets.open("data/android-rules.dat").use { it.readBytes() })
    private fun rulesMeta(): JSONObject = try { JSONObject(ctx.assets.open("data/rules.json").bufferedReader().readText()) } catch (e: Exception) { JSONObject() }
    private fun engineSettings(): EngineSettings {
        val s = settings.getJSONObject("scan")
        return EngineSettings(s.optString("heuristics", "normal"), s.optBoolean("heuristicsEnabled", true), s.optInt("archiveDepth", 2), if (s.optBoolean("skipLarge", true)) s.optInt("maxFileMB", 48) else 0)
    }
    private fun allowSet() = Js.strList(settings.optJSONArray("allowlist")).toSet()
    private fun refreshEngine() { engine.settings = engineSettings(); engine.allow = allowSet() }

    fun sigInfo(): JSONObject {
        val h = SignatureDb.header(sigFile)
        val rm = rulesMeta()
        return if (h == null) JSONObject().put("total", 0).put("md5", 0).put("sha256", 0).put("created", 0).put("bytes", 0).put("rules", 0)
        else JSONObject().put("md5", h[1]).put("sha256", h[2]).put("total", h[1] + h[2]).put("created", h[0]).put("bytes", sigFile.length())
            .put("rules", engine.rules?.size ?: rm.optInt("count")).put("rulesVersion", rm.optString("version"))
    }

    // ───────── state / settings ─────────
    fun getState(): JSONObject {
        val s = settings
        return JSONObject().put("product", Product.json()).put("platform", "android").put("settings", s).put("sig", sigInfo())
            .put("scan", active?.let { progress(it) } ?: JSONObject.NULL)
            .put("lastScan", recentScans.firstOrNull() ?: JSONObject.NULL)
            .put("quarantine", JSONObject().put("count", quarantine.items.size).put("bytes", quarantine.size()))
            .put("protection", protectionStatus()).put("nextScheduled", nextScheduled() ?: JSONObject.NULL)
            .put("updating", updating).put("elevated", perms.allFiles()).put("perms", perms.status())
            .put("device", JSONObject().put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT))
    }
    private fun protectionStatus(): JSONObject {
        val s = settings
        val issues = ArrayList<String>()
        if (!s.getJSONObject("protection").optBoolean("realtime")) issues.add("realtime")
        if (!perms.allFiles()) issues.add("storage")
        val created = SignatureDb.header(sigFile)?.get(0) ?: 0L
        if (created > 0 && System.currentTimeMillis() - created > 14 * 86400000L) issues.add("outdated")
        if (!s.getJSONObject("scan").getJSONObject("schedule").optBoolean("enabled")) issues.add("schedule")
        val last = s.getJSONObject("stats").optLong("lastScan", 0)
        if (last == 0L || System.currentTimeMillis() - last > 14 * 86400000L) issues.add("noscan")
        val level = if ("realtime" in issues) "risk" else if (issues.isNotEmpty()) "warn" else "ok"
        return JSONObject().put("level", level).put("issues", Js.arr(issues)).put("watching", Js.arr(watchers.map { it.first }))
    }
    fun setSettings(patch: JSONObject?): JSONObject {
        val before = JSONObject(settings.toString())
        val next = store.patch(patch ?: JSONObject())
        // arrays replace (merge already replaces arrays in this implementation)
        refreshEngine()
        if (before.optJSONObject("protection").toString() != next.optJSONObject("protection").toString()) restartWatchers()
        emit("settings", next)
        emit("state", getState())
        return next
    }
    fun resetSettings(): JSONObject {
        val s = settings
        val keep = JSONObject().put("onboarded", true).put("stats", s.get("stats")).put("permissions", s.get("permissions")).put("allowlist", s.get("allowlist"))
        store.set(Js.merge(Defaults.json(), keep)); refreshEngine(); restartWatchers()
        emit("state", getState()); return settings
    }

    // ───────── history ─────────
    fun addHistory(type: String, data: JSONObject): JSONObject {
        val e = JSONObject().put("id", java.lang.Long.toString(System.currentTimeMillis(), 36) + (1000..9999).random()).put("ts", System.currentTimeMillis()).put("type", type).put("data", data)
        synchronized(history) { history.add(0, e); while (history.size > 600) history.removeAt(history.size - 1) }
        saveHistory(); emit("history", e); return e
    }
    private var histJob: Job? = null
    private fun saveHistory() { histJob?.cancel(); histJob = scope.launch(Dispatchers.IO) { delay(300); try { Js.writeAtomic(historyFile, synchronized(history) { JSONArray(history).toString() }) } catch (_: Exception) { } } }
    fun listHistory(): JSONArray = synchronized(history) { JSONArray(history) }
    fun clearHistory(): Boolean { synchronized(history) { history.clear() }; Js.writeAtomic(historyFile, "[]"); emit("history", null); return true }

    // ───────── scan targets ─────────
    class Target(val path: String, val name: String, val size: Long, val mtime: Long, val open: () -> InputStream, val pkg: String? = null)

    fun storageRoot(): File = Environment.getExternalStorageDirectory()
    fun knownFolders(): JSONObject {
        val r = storageRoot()
        return JSONObject().put("storage", r.path).put("downloads", File(r, Environment.DIRECTORY_DOWNLOADS).path).put("documents", File(r, Environment.DIRECTORY_DOCUMENTS).path)
            .put("dcim", File(r, Environment.DIRECTORY_DCIM).path).put("bluetooth", File(r, "Bluetooth").path)
    }
    private fun isExcludedDir(p: String): Boolean {
        val l = p.lowercase()
        if (Regex("^/storage/emulated/\\d+/android/(data|obb)(/|$)").containsMatchIn(l)) return true
        if (l.startsWith(ctx.filesDir.parentFile!!.path.lowercase())) return true
        for (ex in Js.strList(settings.getJSONObject("scan").optJSONArray("exclusions"))) { val e = ex.lowercase().trimEnd('/'); if (l == e || l.startsWith("$e/")) return true }
        return false
    }
    private fun wantFile(name: String, mode: String, exts: Set<String>): Boolean = mode == "all" || name.substringAfterLast('.', "").lowercase() in exts

    fun fileTarget(f: File) = Target(f.path, f.name, f.length(), f.lastModified(), { f.inputStream() })
    fun docTarget(d: DocumentFile, uriStr: String = d.uri.toString()) = Target(uriStr, d.name ?: "dosya", d.length(), d.lastModified(), { ctx.contentResolver.openInputStream(d.uri) ?: throw java.io.FileNotFoundException("ENOENT") })

    /** Maps document/tree URIs of primary shared storage to real paths when all-files access is granted. */
    fun uriToPath(u: Uri): String? {
        try {
            if (u.scheme == "file") return u.path
            if (u.authority == "com.android.externalstorage.documents") {
                val id = if (DocumentsContract.isTreeUri(u) && !DocumentsContract.isDocumentUri(ctx, u)) DocumentsContract.getTreeDocumentId(u) else DocumentsContract.getDocumentId(u)
                val (vol, rel) = id.split(":", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
                val base = if (vol.equals("primary", true)) storageRoot().path else "/storage/$vol"
                return if (rel.isEmpty()) base else "$base/$rel"
            }
            if (u.authority == "com.android.providers.downloads.documents") {
                val id = DocumentsContract.getDocumentId(u)
                if (id.startsWith("raw:")) return id.substring(4)
            }
            if (u.authority == "media" || u.authority?.endsWith(".media.documents") == true) {
                ctx.contentResolver.query(u, arrayOf("_data"), null, null, null)?.use { c -> if (c.moveToFirst()) return c.getString(0) }
            }
        } catch (_: Exception) { }
        return null
    }

    // ───────── scanning ─────────
    inner class ScanState(val id: String, val type: String, val source: String, val scheduled: Boolean, val targets: List<String>, val fileMode: String) {
        val startedAt = System.currentTimeMillis(); var endedAt = 0L; var status = "running"
        val scanned = AtomicInteger(); val discovered = AtomicInteger(); @Volatile var discoveryDone = false
        val skipped = AtomicInteger(); val errors = AtomicInteger(); @Volatile var bytes = 0L; @Volatile var current = ""
        val threats = java.util.Collections.synchronizedList(ArrayList<JSONObject>()); val items = java.util.Collections.synchronizedList(ArrayList<JSONObject>())
        val cleanCount = AtomicInteger(); @Volatile var paused = false; @Volatile var cancel = false
        var job: Job? = null
    }
    private fun newId(p: Char) = p + java.lang.Long.toString(System.currentTimeMillis(), 36) + String.format("%04x", (0..0xffff).random())

    fun progress(s: ScanState): JSONObject {
        val elapsed = (if (s.endedAt > 0) s.endedAt else System.currentTimeMillis()) - s.startedAt
        val d = s.discovered.get(); val n = s.scanned.get()
        var pct = if (d > 0) n.toDouble() / d else 0.0
        if (!s.discoveryDone) pct = minOf(pct, 0.95) * (if (s.type == "full") 0.9 else 0.97)
        if (s.status != "running") pct = 1.0
        return JSONObject().put("id", s.id).put("type", s.type).put("status", if (s.paused) "paused" else s.status).put("scanned", n).put("discovered", d).put("discoveryDone", s.discoveryDone)
            .put("threats", s.threats.size).put("current", s.current).put("elapsed", elapsed).put("startedAt", s.startedAt).put("endedAt", if (s.endedAt > 0) s.endedAt else JSONObject.NULL)
            .put("rate", if (elapsed > 500) Math.round(n / (elapsed / 1000.0)) else 0).put("percent", pct.coerceIn(0.0, 1.0)).put("bytes", s.bytes)
            .put("skipped", s.skipped.get()).put("errors", s.errors.get()).put("cleanCount", s.cleanCount.get()).put("source", s.source).put("scheduled", s.scheduled)
    }
    private var lastProg = 0L
    private fun emitProgress(force: Boolean = false) { val s = active ?: return; val t = System.currentTimeMillis(); if (!force && t - lastProg < 120) return; lastProg = t; emit("scan:progress", progress(s)) }

    fun startScan(opts: JSONObject?): JSONObject {
        active?.let { return JSONObject().put("error", "BUSY").put("id", it.id) }
        val type = opts?.optString("type", "quick") ?: "quick"
        val s = settings.getJSONObject("scan")
        val paths = Js.strList(opts?.optJSONArray("paths"))
        val st = ScanState(newId('S'), type, opts?.optString("source", "user") ?: "user", opts?.optBoolean("scheduled") ?: false,
            if (type == "custom") paths else if (type == "quick") listOf("apps", File(storageRoot(), Environment.DIRECTORY_DOWNLOADS).path) else listOf("apps", storageRoot().path),
            if (type == "custom") "all" else s.optString("fileTypes", "smart"))
        active = st
        addHistory("scan-start", JSONObject().put("id", st.id).put("type", type).put("scheduled", st.scheduled))
        emit("scan:start", progress(st))
        st.job = scope.launch { try { runScan(st, paths) } catch (e: Throwable) { log("scan error $e") ; if (active === st) { st.status = "canceled"; active = null } } }
        return JSONObject().put("id", st.id)
    }
    fun pauseScan(): Boolean { active?.let { it.paused = true; emitProgress(true) }; return true }
    fun resumeScan(): Boolean { active?.let { it.paused = false; emitProgress(true) }; return true }
    fun cancelScan(): Boolean { active?.let { it.cancel = true; it.paused = false }; return true }

    private suspend fun runScan(st: ScanState, customPaths: List<String>) = withContext(Dispatchers.IO) {
        val ch = Channel<Target>(256)
        val exts = Js.strList(settings.getJSONObject("scan").optJSONArray("extensions")).map { it.lowercase() }.toSet()
        val includeSystem = st.type == "full" && settings.getJSONObject("scan").optBoolean("includeSystemApps", false)
        val producer = launch {
            suspend fun send(t: Target) { st.discovered.incrementAndGet(); ch.send(t) }
            suspend fun walk(dir: File, depth: Int, max: Int, explicit: Boolean) {
                if (st.cancel) return
                if (!explicit && isExcludedDir(dir.path)) return
                val list = try { dir.listFiles() } catch (e: Exception) { null } ?: return
                for (f in list) {
                    if (st.cancel) return
                    if (f.isDirectory) { if (depth + 1 < max && !java.nio.file.Files.isSymbolicLink(f.toPath())) walk(f, depth + 1, max, false) }
                    else if (f.isFile && wantFile(f.name, st.fileMode, exts)) send(fileTarget(f))
                }
            }
            suspend fun walkDoc(d: DocumentFile, depth: Int) {
                if (st.cancel) return
                if (d.isDirectory) { if (depth < 64) for (c in d.listFiles()) walkDoc(c, depth + 1) } else if (d.isFile) send(docTarget(d))
            }
            suspend fun apps(all: Boolean) {
                for (p in this@Core.apps.packages()) {
                    if (st.cancel) return
                    if (p.packageName == ctx.packageName) continue
                    if (!all && this@Core.apps.isSystem(p)) continue
                    send(appTarget(p.packageName) ?: continue)
                }
            }
            when (st.type) {
                "quick" -> { apps(false); walk(File(storageRoot(), Environment.DIRECTORY_DOWNLOADS), 0, 4, true) }
                "full" -> { apps(includeSystem); walk(storageRoot(), 0, 64, true) }
                else -> for (p in customPaths) {
                    when {
                        p.startsWith(APP) -> appTarget(p.removePrefix(APP))?.let { send(it) }
                        p.startsWith("content://") -> { val u = Uri.parse(p); val path = uriToPath(u)
                            if (path != null && perms.allFiles() && File(path).exists()) { val f = File(path); if (f.isFile) send(fileTarget(f)) else walk(f, 0, 64, true) }
                            else { val d = if (DocumentsContract.isTreeUri(u)) DocumentFile.fromTreeUri(ctx, u) else DocumentFile.fromSingleUri(ctx, u); if (d != null) walkDoc(d, 0) } }
                        else -> { val f = File(p); if (f.isFile) send(fileTarget(f)) else if (f.isDirectory) walk(f, 0, 64, true) else st.errors.incrementAndGet() }
                    }
                }
            }
            st.discoveryDone = true; ch.close()
        }
        val workers = (0 until 2).map {
            async(scanPool) {
                for (t in ch) {
                    while (st.paused && !st.cancel) delay(200)
                    if (st.cancel) continue
                    st.current = t.path
                    val r = scanTarget(t)
                    st.scanned.incrementAndGet()
                    if (r.error != null) { if (r.error in setOf("EBUSY", "EPERM", "EACCES")) st.skipped.incrementAndGet() else st.errors.incrementAndGet() }
                    else {
                        st.bytes += r.size
                        val item = slim(r, t)
                        if (r.verdict != "clean") { st.threats.add(item); emit("scan:threat", JSONObject().put("scanId", st.id).put("item", item)) }
                        else { st.cleanCount.incrementAndGet(); if (st.items.size < 400) st.items.add(item) }
                    }
                    emitProgress()
                }
            }
        }
        workers.awaitAll(); producer.join()
        st.endedAt = System.currentTimeMillis(); st.status = if (st.cancel) "canceled" else "done"; st.current = ""
        val summary = finalizeScan(st)
        active = null
        if (settings.getJSONObject("protection").optBoolean("autoQuarantine") && st.source == "scheduled")
            for (t in st.threats.filter { it.optString("verdict") == "malicious" && it.optString("kind") != "app" }) applyAction(JSONObject().put("scanId", st.id).put("path", t.optString("path")).put("action", "quarantine"))
        emit("scan:done", summary)
        emit("state", getState())
    }

    fun appTarget(pkg: String): Target? {
        val p = apps.info(pkg) ?: return null
        val files = apps.apkFiles(p); val base = files.firstOrNull() ?: return null
        return Target(APP + pkg, apps.label(p), files.sumOf { it.length() }, p.lastUpdateTime, { base.inputStream() }, pkg)
    }

    /** Runs the engine on one target. Apps: base APK with live facts + every split APK. */
    fun scanTarget(t: Target): ScanResult {
        if (t.pkg != null) {
            val p = apps.info(t.pkg) ?: return ScanResult().also { it.path = t.path; it.name = t.name; it.error = "ENOENT"; it.verdict = "error" }
            val facts = apps.facts(p)
            val files = apps.apkFiles(p)
            val base = engine.scanStream(t.path, t.name, files[0].length(), p.lastUpdateTime, { files[0].inputStream() }, facts)
            if (base.error != null) return base
            if (files.size > 1) {
                val extra = ArrayList(base.reasons)
                for (f in files.drop(1)) {
                    val sr = engine.scanFile(f)
                    if (sr.verdict != "clean" && sr.verdict != "error") extra.add(Reason("archive", "split", sr.score, "Bölünmüş APK içinde: ${f.name} → ${sr.threat}", "Inside split APK: ${f.name} → ${sr.threat}", sr.threat))
                }
                val c = Analyzer.combine(extra, engineSettings().heuristics)
                base.reasons = extra; base.score = c.score; base.verdict = c.verdict; base.threat = c.threat
            }
            base.size = t.size
            if (allowSet().contains(base.sha256)) { base.verdict = "clean"; base.score = 0; base.threat = null }
            return base
        }
        return try { engine.scanStream(t.path, t.name, t.size, t.mtime, t.open) } catch (e: Throwable) { ScanResult().also { it.path = t.path; it.name = t.name; it.error = e.javaClass.simpleName; it.verdict = "error" } }
    }

    private fun reasonJson(r: Reason) = JSONObject().put("layer", r.layer).put("w", r.weight).put("t", JSONObject().put("tr", r.tr).put("en", r.en)).put("matched", r.matched?.let { Js.arr(it) } ?: JSONObject.NULL)
    fun slim(r: ScanResult, t: Target? = null): JSONObject {
        val o = JSONObject().put("path", r.path).put("name", r.name).put("size", r.size).put("verdict", r.verdict).put("score", r.score).put("threat", betterName(r) ?: JSONObject.NULL)
            .put("sha256", r.sha256 ?: JSONObject.NULL).put("md5", r.md5 ?: JSONObject.NULL).put("kind", if (t?.pkg != null) "app" else r.kind)
            .put("layers", JSONObject(r.layers)).put("children", Js.arr(r.children.map { JSONObject().put("name", it.name).put("verdict", it.verdict).put("threat", it.threat ?: JSONObject.NULL).put("score", it.score) }))
            .put("reasons", Js.arr(r.reasons.map { reasonJson(it) })).put("action", JSONObject.NULL).put("truncated", r.truncated)
        if (r.error != null) o.put("error", r.error)
        if (t?.pkg != null) o.put("pkg", t.pkg)
        r.apk?.let { a -> o.put("apk", JSONObject().put("package", a.packageName).put("permissions", Js.arr(a.permissions.toList())).put("hasLauncher", a.hasLauncher)) }
        return o
    }
    private fun betterName(r: ScanResult): String? {
        val fam = r.sha256?.let { familyNames.optString(it, "") } ?: ""
        if (r.verdict != "clean" && fam.isNotEmpty() && (r.threat ?: "").endsWith("Generic.Sig")) return "Trojan.Win32.$fam"
        return r.threat
    }
    private fun scanFile(id: String) = File(dirs["scans"], "$id.json")
    private fun saveIndex() { try { Js.writeAtomic(File(dirs["scans"], "index.json"), JSONArray(recentScans).toString()) } catch (_: Exception) { } }
    private fun pushRecent(idx: JSONObject) { synchronized(recentScans) { recentScans.add(0, idx); while (recentScans.size > 40) { val old = recentScans.removeAt(recentScans.size - 1); scanFile(old.optString("id")).delete() } }; saveIndex() }

    private fun finalizeScan(st: ScanState): JSONObject {
        val summary = progress(st)
        val doc = JSONObject(summary.toString()).put("targets", Js.arr(st.targets)).put("threatsList", JSONArray(st.threats.toList())).put("items", JSONArray(st.items.toList()))
        try { Js.writeAtomic(scanFile(st.id), doc.toString()) } catch (_: Exception) { }
        pushRecent(JSONObject().put("id", st.id).put("type", st.type).put("status", st.status).put("startedAt", st.startedAt).put("endedAt", st.endedAt).put("scanned", st.scanned.get()).put("threats", st.threats.size).put("source", st.source))
        val stats = settings.getJSONObject("stats")
        store.patch(JSONObject().put("stats", JSONObject().put("filesScanned", stats.optLong("filesScanned") + st.scanned.get())
            .put("lastScan", if (st.status == "done") System.currentTimeMillis() else stats.opt("lastScan"))))
        addHistory("scan", JSONObject().put("id", st.id).put("type", st.type).put("status", st.status).put("scanned", st.scanned.get()).put("threats", st.threats.size).put("elapsed", summary.optLong("elapsed")).put("scheduled", st.scheduled))
        return summary.put("threatsList", JSONArray(st.threats.take(50)))
    }
    fun getScan(id: String?): JSONObject? {
        val a = active
        if (a != null && a.id == id) return progress(a).put("threatsList", JSONArray(a.threats.toList())).put("items", JSONArray(a.items.toList())).put("targets", Js.arr(a.targets))
        return try { JSONObject(scanFile(id ?: return null).readText()) } catch (e: Exception) { null }
    }
    fun listScans(): JSONArray = JSONArray(recentScans)
    private fun updateScanItem(scanId: String?, path: String, patch: JSONObject) {
        if (scanId == null) return
        val f = scanFile(scanId)
        try {
            val doc = JSONObject(f.readText())
            for (key in listOf("threatsList", "items")) { val a = doc.optJSONArray(key) ?: continue; for (i in 0 until a.length()) { val it = a.getJSONObject(i); if (it.optString("path") == path) for (k in patch.keys()) it.put(k, patch.get(k)) } }
            Js.writeAtomic(f, doc.toString())
        } catch (_: Exception) { }
    }

    private val priority = Mutex()
    /** Scan specific paths right now (drag to notch, share sheet, app drag). */
    suspend fun scanPaths(paths: List<String>, opts: JSONObject?): JSONObject = priority.withLock {
        val targets = ArrayList<Target>(); val results = ArrayList<JSONObject>()
        fun addFile(f: File, depth: Int) { if (f.isFile) targets.add(fileTarget(f)) else if (f.isDirectory && depth < 8 && targets.size < 5000) f.listFiles()?.forEach { addFile(it, depth + 1) } }
        for (p in paths) {
            try {
                when {
                    p.startsWith(APP) -> appTarget(p.removePrefix(APP))?.let { targets.add(it) } ?: results.add(errItem(p, "ENOENT"))
                    p.startsWith("content://") -> { val u = Uri.parse(p); val path = uriToPath(u)
                        if (path != null && File(path).canRead()) addFile(File(path), 0)
                        else { val d = DocumentFile.fromSingleUri(ctx, u); if (d != null && d.exists()) targets.add(docTarget(d)) else results.add(errItem(p, "EACCES")) } }
                    else -> { val f = File(p); if (f.exists()) addFile(f, 0) else results.add(errItem(p, "ENOENT")) }
                }
            } catch (e: Exception) { results.add(errItem(p, e.javaClass.simpleName)) }
        }
        val out = withContext(scanPool) { targets.map { t -> async { t to scanTarget(t) } }.awaitAll() }
        for ((t, r) in out) results.add(if (r.error != null) errItem(t.path, r.error!!).put("name", t.name) else slim(r, t))
        val threats = results.filter { it.optString("verdict") == "malicious" || it.optString("verdict") == "suspicious" }
        val src = opts?.optString("source", "drop") ?: "drop"
        val id = newId('D'); val now = System.currentTimeMillis()
        val doc = JSONObject().put("id", id).put("type", if (src == "notch" || src == "share") "notch" else "drop").put("status", "done").put("startedAt", now).put("endedAt", now)
            .put("scanned", results.size).put("discovered", results.size).put("threats", threats.size).put("threatsList", JSONArray(threats))
            .put("items", JSONArray(results.filter { it.optString("verdict") == "clean" }.take(400))).put("cleanCount", results.size - threats.size).put("percent", 1)
            .put("targets", Js.arr(paths)).put("source", src).put("elapsed", 0)
        try { Js.writeAtomic(scanFile(id), doc.toString()) } catch (_: Exception) { }
        pushRecent(JSONObject().put("id", id).put("type", doc.optString("type")).put("status", "done").put("startedAt", now).put("endedAt", now).put("scanned", results.size).put("threats", threats.size).put("source", src))
        val stats = settings.getJSONObject("stats")
        store.patch(JSONObject().put("stats", JSONObject().put("filesScanned", stats.optLong("filesScanned") + results.size)))
        addHistory("scan", JSONObject().put("id", id).put("type", doc.optString("type")).put("status", "done").put("scanned", results.size).put("threats", threats.size).put("elapsed", 0)
            .put("names", Js.arr(results.take(3).map { it.optString("name") })))
        for (t in threats) emit("scan:threat", JSONObject().put("scanId", id).put("item", t))
        JSONObject().put("id", id).put("results", JSONArray(results)).put("threats", threats.size)
    }
    private fun errItem(p: String, e: String) = JSONObject().put("path", p).put("name", p.substringAfterLast('/')).put("error", e).put("verdict", "error")

    // ───────── actions ─────────
    private fun deleteTarget(path: String): Boolean = if (path.startsWith("content://")) { val u = Uri.parse(path); val p = uriToPath(u)
            if (p != null && File(p).exists()) File(p).delete() else try { DocumentsContract.deleteDocument(ctx.contentResolver, u) } catch (e: Exception) { DocumentFile.fromSingleUri(ctx, u)?.delete() == true } }
        else File(path).delete()
    private fun openTarget(path: String): InputStream = if (path.startsWith("content://")) ctx.contentResolver.openInputStream(Uri.parse(path))!! else File(path).inputStream()
    private fun sizeOf(path: String): Long = if (path.startsWith("content://")) DocumentFile.fromSingleUri(ctx, Uri.parse(path))?.length() ?: 0 else File(path).length()

    fun applyAction(p: JSONObject): JSONObject {
        val scanId = p.optString("scanId").ifEmpty { null }; val path = p.optString("path"); val action = p.optString("action")
        val s = settings
        val item = scanId?.let { getScan(it) }?.let { doc -> (listOf("threatsList", "items")).flatMap { k -> doc.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getJSONObject(it) } } ?: emptyList() }.firstOrNull { it.optString("path") == path } }
        val name = item?.optString("name")?.ifEmpty { null } ?: path.substringAfterLast('/')
        try {
            if (path.startsWith(APP) && (action == "quarantine" || action == "delete" || action == "uninstall")) {
                ctx.startActivity(apps.uninstallIntent(path.removePrefix(APP)))
                updateScanItem(scanId, path, JSONObject().put("action", "uninstall"))
                addHistory("uninstall", JSONObject().put("name", name).put("path", path).put("threat", item?.opt("threat") ?: JSONObject.NULL))
                return JSONObject().put("ok", true).put("uninstall", true)
            }
            when (action) {
                "quarantine" -> {
                    ignoreWatch.add(path)
                    val q = quarantine.add(name, path, sizeOf(path), { openTarget(path) }, { deleteTarget(path) },
                        JSONObject().put("sha256", item?.opt("sha256") ?: JSONObject.NULL).put("threat", item?.opt("threat") ?: JSONObject.NULL).put("verdict", item?.optString("verdict") ?: "malicious").put("score", item?.optInt("score") ?: 0).put("source", if (item != null) "scan" else "manual"))
                    updateScanItem(scanId, path, JSONObject().put("action", "quarantined").put("quarantineId", q.optString("id")))
                    store.patch(JSONObject().put("stats", JSONObject().put("threatsBlocked", s.getJSONObject("stats").optInt("threatsBlocked") + 1)))
                    addHistory("quarantine", JSONObject().put("name", q.optString("name")).put("path", path).put("threat", q.opt("threat")))
                    emit("quarantine", JSONObject().put("type", "add").put("item", q)); emit("state", getState())
                    return JSONObject().put("ok", true).put("quarantineId", q.optString("id"))
                }
                "delete" -> {
                    if (!deleteTarget(path)) return JSONObject().put("ok", false).put("error", if (File(path).exists()) "EPERM" else "ENOENT")
                    updateScanItem(scanId, path, JSONObject().put("action", "deleted"))
                    store.patch(JSONObject().put("stats", JSONObject().put("threatsBlocked", s.getJSONObject("stats").optInt("threatsBlocked") + 1)))
                    addHistory("delete", JSONObject().put("name", name).put("path", path).put("threat", item?.opt("threat") ?: JSONObject.NULL))
                    emit("state", getState()); return JSONObject().put("ok", true)
                }
                "ignore" -> {
                    var sha = item?.optString("sha256")?.ifEmpty { null }
                    if (sha == null && !path.startsWith(APP)) sha = try { openTarget(path).use { i -> val d = MessageDigest.getInstance("SHA-256"); val b = ByteArray(1 shl 16); while (true) { val n = i.read(b); if (n < 0) break; d.update(b, 0, n) }; d.digest().joinToString("") { "%02x".format(it) } } } catch (e: Exception) { null }
                    val allow = Js.strList(s.optJSONArray("allowlist"))
                    if (sha != null && sha !in allow) store.set(settings.put("allowlist", Js.arr(allow + sha)))
                    refreshEngine()
                    updateScanItem(scanId, path, JSONObject().put("action", "ignored"))
                    addHistory("ignore", JSONObject().put("name", name).put("path", path).put("threat", item?.opt("threat") ?: JSONObject.NULL))
                    return JSONObject().put("ok", true)
                }
                "restore" -> {
                    val qid = p.optString("quarantineId").ifEmpty { item?.optString("quarantineId") }
                    val r = restoreQuarantine(qid)
                    updateScanItem(scanId, path, JSONObject().put("action", "restored"))
                    return r
                }
            }
            return JSONObject().put("ok", false).put("error", "UNKNOWN_ACTION")
        } catch (e: Exception) {
            log("action $action failed: $e")
            return JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName)
        }
    }
    fun listQuarantine(): JSONArray = JSONArray(quarantine.list())
    fun restoreQuarantine(id: String?): JSONObject {
        val item = quarantine.get(id) ?: return JSONObject().put("ok", false).put("error", "NOT_FOUND")
        ignoreWatch.add(item.optString("originalPath"))
        return try {
            val (it2, dest) = quarantine.restore(id!!)
            val sha = it2.optString("sha256"); val allow = Js.strList(settings.optJSONArray("allowlist"))
            if (sha.isNotEmpty() && sha != "null" && sha !in allow) { store.set(settings.put("allowlist", Js.arr(allow + sha))); refreshEngine() }
            addHistory("restore", JSONObject().put("name", item.optString("name")).put("path", dest).put("threat", item.opt("threat")))
            emit("quarantine", JSONObject().put("type", "restore").put("item", item)); emit("state", getState())
            JSONObject().put("ok", true).put("restoredTo", dest)
        } catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: "generic") }
    }
    fun deleteQuarantine(id: String?): JSONObject {
        val item = id?.let { quarantine.remove(it) }
        if (item != null) addHistory("qdelete", JSONObject().put("name", item.optString("name")).put("threat", item.opt("threat")))
        emit("quarantine", JSONObject().put("type", "delete").put("item", item ?: JSONObject.NULL)); emit("state", getState())
        return JSONObject().put("ok", item != null)
    }
    fun deleteAllQuarantine(): JSONObject { quarantine.list().forEach { quarantine.remove(it.optString("id")) }; addHistory("qdelete", JSONObject().put("all", true)); emit("state", getState()); return JSONObject().put("ok", true) }
    fun removeAllow(sha: String?): JSONArray { store.set(settings.put("allowlist", Js.arr(Js.strList(settings.optJSONArray("allowlist")).filter { it != sha }))); refreshEngine(); return settings.getJSONArray("allowlist") }

    // ───────── real-time protection ─────────
    private val watchers = CopyOnWriteArrayList<Pair<String, FileObserver>>()
    private val pendingRT = java.util.concurrent.ConcurrentHashMap<String, Job>()
    fun watchDirs(): List<File> {
        val p = settings.getJSONObject("protection"); val r = storageRoot()
        val dirs = ArrayList<File>()
        if (p.optBoolean("defaultFolders", true)) dirs.addAll(listOf(File(r, Environment.DIRECTORY_DOWNLOADS), File(r, "Bluetooth"), File(r, Environment.DIRECTORY_DOCUMENTS)))
        Js.strList(p.optJSONArray("folders")).forEach { dirs.add(File(it)) }
        return dirs.filter { it.isDirectory }.distinctBy { it.path }
    }
    @Synchronized fun startWatchers() {
        stopWatchers()
        val p = settings.getJSONObject("protection")
        if (!p.optBoolean("realtime") || !perms.allFiles()) return
        val exts = Js.strList(p.optJSONArray("watchExtensions")).map { it.lowercase() }.toSet()
        fun watch(dir: File, depth: Int) {
            if (watchers.size > 200) return
            val obs = object : FileObserver(dir, CLOSE_WRITE or MOVED_TO or CREATE) {
                override fun onEvent(event: Int, name: String?) {
                    if (name == null) return
                    val f = File(dir, name)
                    if (event and CREATE != 0 && f.isDirectory && depth < 2) { watch(f, depth + 1); return }
                    if (name.substringAfterLast('.', "").lowercase() !in exts || isExcludedDir(dir.path) || ignoreWatch.remove(f.path)) return
                    pendingRT.remove(f.path)?.cancel()
                    pendingRT[f.path] = scope.launch(Dispatchers.IO) { delay(1200); pendingRT.remove(f.path); rtScan(f) }
                }
            }
            obs.startWatching(); watchers.add(dir.path to obs)
            if (depth < 2) dir.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") }?.forEach { watch(it, depth + 1) }
        }
        for (d in watchDirs()) watch(d, 0)
        log("realtime watching ${watchers.size} dirs")
    }
    @Synchronized fun stopWatchers() { watchers.forEach { try { it.second.stopWatching() } catch (_: Exception) { } }; watchers.clear() }
    fun restartWatchers() = startWatchers()
    val watchCount get() = watchers.size

    private suspend fun rtScan(f: File) {
        var last = -1L
        for (i in 0 until 20) { if (!f.isFile) return; val sz = f.length(); if (sz == last && sz > 0) break; last = sz; delay(500) }
        val r = withContext(scanPool) { scanTarget(fileTarget(f)) }
        val stats = settings.getJSONObject("stats")
        store.patch(JSONObject().put("stats", JSONObject().put("realtimeScanned", stats.optInt("realtimeScanned") + 1)))
        if (r.error != null || r.verdict == "clean") { emit("realtime", JSONObject().put("path", f.path).put("verdict", r.verdict)); return }
        reportRealtime(slim(r, null), f.path)
    }
    /** Newly installed / updated package → immediate scan (PACKAGE_ADDED). */
    fun onPackageAdded(pkg: String) {
        if (!settings.getJSONObject("protection").optBoolean("scanNewApps", true) || pkg == ctx.packageName) return
        scope.launch(scanPool) {
            val t = appTarget(pkg) ?: return@launch
            val r = scanTarget(t)
            val stats = settings.getJSONObject("stats")
            store.patch(JSONObject().put("stats", JSONObject().put("realtimeScanned", stats.optInt("realtimeScanned") + 1).put("appsScanned", stats.optInt("appsScanned") + 1)))
            if (r.error != null || r.verdict == "clean") { emit("realtime", JSONObject().put("path", t.path).put("verdict", r.verdict).put("app", true)); return@launch }
            reportRealtime(slim(r, t), t.path)
        }
    }
    private fun reportRealtime(item: JSONObject, path: String) {
        var action: String? = null
        if (item.optString("verdict") == "malicious" && item.optString("kind") != "app" && settings.getJSONObject("protection").optBoolean("autoQuarantine")) {
            action = try {
                val q = quarantine.add(item.optString("name"), path, File(path).length(), { File(path).inputStream() }, { File(path).delete() },
                    JSONObject().put("sha256", item.opt("sha256")).put("threat", item.opt("threat")).put("verdict", "malicious").put("score", item.optInt("score")).put("source", "realtime"))
                item.put("quarantineId", q.optString("id"))
                store.patch(JSONObject().put("stats", JSONObject().put("threatsBlocked", settings.getJSONObject("stats").optInt("threatsBlocked") + 1)))
                emit("quarantine", JSONObject().put("type", "add").put("item", q)); "quarantined"
            } catch (e: Exception) { "failed" }
        }
        item.put("action", action ?: JSONObject.NULL)
        val id = newId('R'); val now = System.currentTimeMillis()
        val doc = JSONObject().put("id", id).put("type", "realtime").put("status", "done").put("startedAt", now).put("endedAt", now).put("scanned", 1).put("threats", 1)
            .put("threatsList", JSONArray().put(item)).put("items", JSONArray()).put("percent", 1).put("source", "realtime").put("elapsed", 0).put("cleanCount", 0)
        try { Js.writeAtomic(scanFile(id), doc.toString()) } catch (_: Exception) { }
        pushRecent(JSONObject().put("id", id).put("type", "realtime").put("status", "done").put("startedAt", now).put("endedAt", now).put("scanned", 1).put("threats", 1).put("source", "realtime"))
        addHistory("realtime", JSONObject().put("name", item.optString("name")).put("path", path).put("threat", item.opt("threat")).put("verdict", item.optString("verdict")).put("action", action ?: JSONObject.NULL).put("scanId", id))
        emit("threat", JSONObject().put("source", "realtime").put("item", item).put("action", action ?: JSONObject.NULL).put("scanId", id))
        emit("state", getState())
    }

    // ───────── scheduler ─────────
    fun nextScheduled(): Long? {
        val sc = settings.getJSONObject("scan").getJSONObject("schedule")
        if (!sc.optBoolean("enabled")) return null
        val last = sc.optLong("lastRun", 0); val now = System.currentTimeMillis()
        val (hh, mm) = sc.optString("time", "13:00").split(":").map { it.toIntOrNull() ?: 0 }.let { (it.getOrElse(0) { 13 }) to (it.getOrElse(1) { 0 }) }
        when (sc.optString("frequency")) {
            "hourly" -> return maxOf(now, last + 3600000)
            "custom" -> return maxOf(now, last + maxOf(1, sc.optInt("customHours", 6)) * 3600000L)
        }
        val d = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, hh); set(Calendar.MINUTE, mm); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
        if (sc.optString("frequency") == "daily") { if (d.timeInMillis <= last || d.timeInMillis < now - 6 * 3600000L) d.add(Calendar.DATE, 1); return d.timeInMillis }
        val wd = sc.optInt("weekday", 1)
        d.add(Calendar.DATE, (wd - (d.get(Calendar.DAY_OF_WEEK) - 1) + 7) % 7)
        if (d.timeInMillis <= last || d.timeInMillis < now - 6 * 3600000L) d.add(Calendar.DATE, 7)
        return d.timeInMillis
    }
    private val bootAt = System.currentTimeMillis()
    fun tickScheduler() {
        val s = settings; val sc = s.getJSONObject("scan").getJSONObject("schedule")
        if (sc.optBoolean("enabled") && active == null) {
            val next = nextScheduled()
            if (next != null && next <= System.currentTimeMillis()) {
                store.patch(JSONObject().put("scan", JSONObject().put("schedule", JSONObject().put("lastRun", System.currentTimeMillis()))))
                startScan(JSONObject().put("type", sc.optString("type", "quick")).put("scheduled", true).put("source", "scheduled"))
            }
        }
        val u = s.getJSONObject("updates")
        if (u.optBoolean("auto") && !updating) {
            val every = when (u.optString("frequency")) { "weekly" -> 7 * 86400000L; "hourly" -> 3600000L; else -> 86400000L }
            if (System.currentTimeMillis() - u.optLong("lastCheck") > every && System.currentTimeMillis() - bootAt > 120000) scope.launch(Dispatchers.IO) { updateSignatures(true) }
        }
    }
    val isScanning get() = active != null

    // ───────── signature updates (same sources as desktop) ─────────
    suspend fun updateSignatures(auto: Boolean = false): JSONObject = withContext(Dispatchers.IO) {
        if (updating) return@withContext JSONObject().put("ok", false).put("error", "BUSY")
        updating = true
        fun prog(stage: String, pct: Double, extra: JSONObject? = null) = emit("update:progress", (extra ?: JSONObject()).put("stage", stage).put("pct", pct))
        val md5 = com.developmentturkey.dtkalkan.engine.LongList(1 shl 20); val sha = ArrayList<String>(); val names = JSONObject(familyNames.toString())
        val sources = JSONArray()
        try {
            prog("index", 0.02)
            try {
                val idx = Net.text("https://virusshare.com/hashes")
                val nums = Regex("VirusShare_(\\d{5})\\.md5").findAll(idx).map { it.groupValues[1].toInt() }.toSortedSet().reversed().take(30)
                val done = AtomicInteger(); val before = md5.n
                val lock = Any()
                nums.chunked((nums.size + 3) / 4).map { part -> async {
                    for (n in part) {
                        try {
                            val local = com.developmentturkey.dtkalkan.engine.LongList(140000)
                            Net.stream("https://virusshare.com/hashfiles/VirusShare_%05d.md5".format(n), 90000) { ins -> ins.bufferedReader().forEachLine { l -> if (!l.startsWith("#")) local.addMd5Hex(l) } }
                            synchronized(lock) { for (i in 0 until local.n) md5.add(local.a[i]) }
                        } catch (_: Exception) { }
                        val d = done.incrementAndGet(); prog("download", 0.05 + 0.75 * (d / 30.0), JSONObject().put("source", "VirusShare").put("done", d).put("total", 30))
                    }
                } }.awaitAll()
                if (md5.n > before) sources.put(JSONObject().put("name", "VirusShare").put("count", md5.n - before))
            } catch (e: Exception) { log("vs: $e") }
            try {
                var c = 0
                Net.stream("https://www.malshare.com/daily/malshare.current.sha256.txt", 45000) { it.bufferedReader().forEachLine { l -> val h = l.trim(); if (h.length == 64) { sha.add(h); c++ } } }
                if (c > 0) sources.put(JSONObject().put("name", "MalShare").put("count", c))
            } catch (e: Exception) { log("malshare: $e") }
            prog("download", 0.82)
            val key = settings.getJSONObject("updates").optString("mbAuthKey")
            if (key.isNotEmpty()) try {
                val j = JSONObject(Net.text("https://mb-api.abuse.ch/api/v1/", 45000, "POST", mapOf("Auth-Key" to key, "Content-Type" to "application/x-www-form-urlencoded"), "query=get_recent&selector=time"))
                val data = j.optJSONArray("data") ?: JSONArray(); var c = 0
                for (i in 0 until data.length()) { val d = data.getJSONObject(i); val h = d.optString("sha256_hash"); if (h.isNotEmpty()) { sha.add(h); c++; val sg = d.optString("signature"); if (sg.isNotEmpty() && sg != "null") names.put(h, sg.replace(Regex("[^\\w.-]"), "")) }; d.optString("md5_hash").let { if (it.isNotEmpty()) md5.addMd5Hex(it) } }
                if (c > 0) sources.put(JSONObject().put("name", "MalwareBazaar").put("count", c))
            } catch (e: Exception) { log("mb: $e") }
            if (md5.n == 0 && sha.isEmpty()) throw IllegalStateException("NO_SOURCES")
            prog("build", 0.88)
            val cur = SignatureDb.open(sigFile); val before = cur.total
            val out = File(dirs["db"], "sigs.next.bin")
            SignatureDb.build(out, cur, md5, sha)
            out.renameTo(sigFile)
            engine.sigdb = SignatureDb.open(sigFile)
            familyNames = names; try { File(dirs["db"], "names.json").writeText(names.toString()) } catch (_: Exception) { }
            val info = sigInfo()
            val res = JSONObject().put("ok", true).put("total", info.optLong("total")).put("added", info.optLong("total") - before).put("sources", sources).put("at", System.currentTimeMillis())
            store.patch(JSONObject().put("updates", JSONObject().put("lastCheck", System.currentTimeMillis()).put("lastResult", res)))
            addHistory("update", JSONObject().put("total", info.optLong("total")).put("added", res.optLong("added")).put("sources", Js.arr((0 until sources.length()).map { sources.getJSONObject(it).optString("name") })).put("auto", auto))
            prog("done", 1.0, JSONObject(res.toString())); emit("update:done", res); emit("state", getState())
            res
        } catch (e: Exception) {
            val res = JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName).put("at", System.currentTimeMillis())
            store.patch(JSONObject().put("updates", JSONObject().put("lastCheck", System.currentTimeMillis()).put("lastResult", res)))
            addHistory("update-fail", JSONObject().put("error", res.optString("error")))
            prog("error", 1.0, JSONObject(res.toString())); emit("update:done", res)
            res
        } finally { updating = false }
    }

    fun getWeather(force: Boolean): JSONObject? = weather.get(settings, force)

    fun systemInfo(): JSONObject {
        val am = ctx.getSystemService(android.app.ActivityManager::class.java); val mi = android.app.ActivityManager.MemoryInfo(); am?.getMemoryInfo(mi)
        return JSONObject().put("os", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})").put("arch", Build.SUPPORTED_ABIS.firstOrNull() ?: "").put("cpus", Runtime.getRuntime().availableProcessors())
            .put("mem", mi.totalMem).put("host", "${Build.MANUFACTURER} ${Build.MODEL}").put("version", Product.version).put("elevated", perms.allFiles()).put("workers", 2)
    }

    // ───────── apps for the UI ─────────
    fun listApps(includeSystem: Boolean): JSONArray {
        val lastByPkg = HashMap<String, JSONObject>()
        synchronized(recentScans) { recentScans.take(20) }.forEach { idx -> getScan(idx.optString("id"))?.let { doc -> for (k in listOf("threatsList", "items")) doc.optJSONArray(k)?.let { a -> for (i in 0 until a.length()) { val it = a.getJSONObject(i); val p = it.optString("pkg"); if (p.isNotEmpty() && p !in lastByPkg) lastByPkg[p] = it } } } }
        val list = apps.packages().filter { it.packageName != ctx.packageName && (includeSystem || !apps.isSystem(it)) }
        return Js.arr(list.map { p -> apps.json(p, false).also { j -> lastByPkg[p.packageName]?.let { r -> j.put("lastVerdict", r.optString("verdict")).put("lastScore", r.optInt("score")).put("lastThreat", r.opt("threat")) } } }.sortedBy { it.optString("name").lowercase() })
    }
    fun appIcons(pkgs: List<String>): JSONObject = JSONObject().also { o -> pkgs.forEach { p -> o.put(p, apps.iconDataUrl(p) ?: JSONObject.NULL) } }
}
