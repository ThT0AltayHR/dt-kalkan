package com.developmentturkey.dtkalkan.service

import android.content.Context
import com.developmentturkey.dtkalkan.Product
import com.developmentturkey.dtkalkan.core.Core
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

/**
 * UI host (port of the desktop UiHost event wiring): broadcasts core events to every attached WebView
 * (main window, in-app notch, overlay notch) and turns them into glass toasts, notch alerts, or — when the
 * app is not on screen — real system notifications.
 */
object Host {
    interface Web { val role: String; fun send(name: String, json: String) }
    val webs = CopyOnWriteArrayList<Web>()
    @Volatile var mainVisible = false
        set(v) { field = v; try { ProtectionService.instance?.overlay?.setHidden(v) } catch (_: Exception) { } }
    private var attached = false
    private var scanAlerted = false
    private var toastSeq = 0
    lateinit var app: Context

    private val S = mapOf(
        "tr" to mapOf("t.scanDone" to "Tarama tamamlandı", "t.scanDoneClean" to "{n} öğe tarandı, tehdit bulunamadı.", "t.scanDoneThreats" to "{n} öğe tarandı, {t} tehdit bulundu.",
            "t.threat" to "Tehdit engellendi", "t.suspicious" to "Şüpheli öğe", "t.threatBody" to "{name} — {threat}", "t.threatQ" to "{name} karantinaya alındı ({threat}).",
            "t.appThreat" to "Zararlı uygulama yüklendi", "t.appBody" to "{name} — {threat}. Kaldırmanız önerilir.",
            "t.view" to "Görüntüle", "t.quarantineAct" to "Karantinaya al", "t.uninstall" to "Kaldır", "t.quarantine" to "Karantinaya alındı", "t.quarantineBody" to "{name} güvenli şekilde izole edildi.",
            "t.restore" to "Geri yüklendi", "t.restoreBody" to "{name} geri yüklendi.", "t.dbUpdated" to "Veritabanı güncellendi", "t.dbUpdatedBody" to "{total} imza · +{added} yeni imza",
            "t.dbFail" to "Güncelleme yapılamadı", "t.dbFailBody" to "İnternet bağlantınızı kontrol edin.", "fg.ok" to "Koruma etkin · {n} klasör izleniyor", "fg.scan" to "Taranıyor… %{p}"),
        "en" to mapOf("t.scanDone" to "Scan complete", "t.scanDoneClean" to "{n} items scanned, no threats found.", "t.scanDoneThreats" to "{n} items scanned, {t} threats found.",
            "t.threat" to "Threat blocked", "t.suspicious" to "Suspicious item", "t.threatBody" to "{name} — {threat}", "t.threatQ" to "{name} was quarantined ({threat}).",
            "t.appThreat" to "Harmful app installed", "t.appBody" to "{name} — {threat}. Uninstalling is recommended.",
            "t.view" to "View", "t.quarantineAct" to "Quarantine", "t.uninstall" to "Uninstall", "t.quarantine" to "Quarantined", "t.quarantineBody" to "{name} was safely isolated.",
            "t.restore" to "Restored", "t.restoreBody" to "{name} was restored.", "t.dbUpdated" to "Database updated", "t.dbUpdatedBody" to "{total} signatures · +{added} new",
            "t.dbFail" to "Update failed", "t.dbFailBody" to "Check your internet connection.", "fg.ok" to "Protection on · watching {n} folders", "fg.scan" to "Scanning… {p}%"))
    fun t(core: Core, k: String, v: Map<String, Any?> = emptyMap()): String {
        val lang = core.settings.optString("lang", "tr")
        var s = S[lang]?.get(k) ?: S["tr"]!![k] ?: k
        for ((a, b) in v + ("app" to Product.name)) s = s.replace("{$a}", b.toString())
        return s
    }
    private fun num(core: Core, n: Long) = NumberFormat.getIntegerInstance(if (core.settings.optString("lang") == "en") Locale.US else Locale("tr", "TR")).format(n)

    fun broadcast(name: String, data: Any?, role: String? = null) {
        val json = when (data) { null -> "null"; is String -> JSONObject.quote(data); else -> data.toString() }
        for (w in webs) if (role == null || w.role == role) try { w.send(name, json) } catch (_: Exception) { }
    }

    fun attach(ctx: Context) {
        if (attached) return
        attached = true; app = ctx.applicationContext
        val core = Core.get(ctx)
        core.on { name, data ->
            broadcast(name, data)
            when (name) {
                "scan:start" -> scanAlerted = false
                "scan:threat" -> { val d = data as JSONObject; val sid = d.optString("scanId"); if (!scanAlerted && sid.startsWith("S")) { scanAlerted = true; broadcast("notch:alert", JSONObject().put("item", d.opt("item")).put("scanId", sid).put("source", "scan")) } }
                "scan:done" -> onScanDone(core, data as JSONObject)
                "threat" -> onThreat(core, data as JSONObject)
                "quarantine" -> onQuarantine(core, data as JSONObject)
                "update:done" -> onUpdate(core, data as JSONObject)
            }
        }
    }

    fun toast(core: Core, t: JSONObject) {
        val n = core.settings.getJSONObject("notifications")
        if (!n.optBoolean("enabled") && !t.optBoolean("force")) return
        t.put("id", ++toastSeq); if (!t.has("duration")) t.put("duration", n.optInt("duration", 6) * 1000)
        broadcast("toast", t, "main")
    }
    private fun onScanDone(core: Core, sum: JSONObject) {
        if (!core.settings.getJSONObject("notifications").optBoolean("scanDone")) return
        val clean = sum.optInt("threats") == 0
        val body = if (clean) t(core, "t.scanDoneClean", mapOf("n" to num(core, sum.optLong("scanned")))) else t(core, "t.scanDoneThreats", mapOf("n" to num(core, sum.optLong("scanned")), "t" to sum.optInt("threats")))
        if (mainVisible) toast(core, JSONObject().put("kind", if (clean) "success" else "danger").put("mood", if (clean) "clean" else "alarmed").put("title", t(core, "t.scanDone")).put("body", body)
            .put("actions", org.json.JSONArray().put(JSONObject().put("id", "open-results").put("label", t(core, "t.view")).put("primary", true))).put("data", JSONObject().put("scanId", sum.optString("id"))).put("sound", if (clean) "clean" else "alarm"))
        else if (core.settings.getJSONObject("notifications").optBoolean("enabled")) Notifier.info(app, t(core, "t.scanDone"), body, "results/" + sum.optString("id"))
    }
    private fun onThreat(core: Core, ev: JSONObject) {
        val it = ev.getJSONObject("item")
        broadcast("notch:alert", ev)
        val n = core.settings.getJSONObject("notifications")
        if (!n.optBoolean("threats") || !n.optBoolean("enabled")) return
        val q = ev.optString("action") == "quarantined"; val isApp = it.optString("kind") == "app"
        val vars = mapOf("name" to it.optString("name"), "threat" to it.optString("threat"))
        val title = if (isApp) t(core, "t.appThreat") else if (it.optString("verdict") == "malicious") t(core, "t.threat") else t(core, "t.suspicious")
        val body = if (q) t(core, "t.threatQ", vars) else if (isApp) t(core, "t.appBody", vars) else t(core, "t.threatBody", vars)
        if (mainVisible) {
            val acts = org.json.JSONArray()
            if (q) acts.put(JSONObject().put("id", "open-results").put("label", t(core, "t.view")).put("primary", true))
            else { acts.put(JSONObject().put("id", if (isApp) "uninstall" else "quarantine").put("label", t(core, if (isApp) "t.uninstall" else "t.quarantineAct")).put("primary", true)); acts.put(JSONObject().put("id", "open-results").put("label", t(core, "t.view"))) }
            toast(core, JSONObject().put("kind", if (it.optString("verdict") == "malicious") "danger" else "warn").put("mood", if (q) "angry" else "worried").put("title", title).put("body", body)
                .put("actions", acts).put("data", JSONObject().put("scanId", ev.optString("scanId")).put("path", it.optString("path"))).put("sound", "blip").put("duration", 12000))
        }
        Notifier.threat(app, title, body, ev.optString("scanId"), it.optString("path"), isApp, q)
    }
    private fun onQuarantine(core: Core, ev: JSONObject) {
        val item = ev.optJSONObject("item") ?: return
        if (!core.settings.getJSONObject("notifications").optBoolean("quarantine") || !mainVisible) return
        if (ev.optString("type") == "add" && item.optString("source") != "realtime") toast(core, JSONObject().put("kind", "success").put("mood", "proud").put("title", t(core, "t.quarantine")).put("body", t(core, "t.quarantineBody", mapOf("name" to item.optString("name"))))
            .put("actions", org.json.JSONArray().put(JSONObject().put("id", "open-quarantine").put("label", t(core, "t.view")))).put("sound", "pop"))
        if (ev.optString("type") == "restore") toast(core, JSONObject().put("kind", "info").put("mood", "happy").put("title", t(core, "t.restore")).put("body", t(core, "t.restoreBody", mapOf("name" to item.optString("name")))).put("sound", "pop"))
    }
    private fun onUpdate(core: Core, r: JSONObject) {
        if (!core.settings.getJSONObject("notifications").optBoolean("updates")) return
        val ok = r.optBoolean("ok")
        val title = t(core, if (ok) "t.dbUpdated" else "t.dbFail")
        val body = if (ok) t(core, "t.dbUpdatedBody", mapOf("total" to num(core, r.optLong("total")), "added" to num(core, r.optLong("added")))) else t(core, "t.dbFailBody")
        if (mainVisible) toast(core, JSONObject().put("kind", if (ok) "info" else "warn").put("mood", if (ok) "cool" else "worried").put("title", title).put("body", body).put("sound", "blip"))
        else if (ok) Notifier.info(app, title, body, "settings/updates")
    }
}
