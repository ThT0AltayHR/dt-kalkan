package com.developmentturkey.dtkalkan.bridge

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.developmentturkey.dtkalkan.BuildConfig
import com.developmentturkey.dtkalkan.Product
import com.developmentturkey.dtkalkan.core.Core
import com.developmentturkey.dtkalkan.core.Js
import com.developmentturkey.dtkalkan.service.Host
import com.developmentturkey.dtkalkan.service.ProtectionService
import com.developmentturkey.dtkalkan.ui.MainActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript ⇄ native bridge. The web UI calls window.dt.core(method, ...args) / dt.ui(action, payload)
 * exactly like the desktop preload API; results come back through window.__dtRes, events through __dtEvt.
 */
class Bridge(private val ctx: Context, private val web: WebView, override val role: String, private val handler: Handler?) : Host.Web {
    interface Handler { suspend fun ui(action: String, p: JSONObject?): Any? }
    private val core = Core.get(ctx)

    @JavascriptInterface
    fun post(id: Int, kind: String, method: String, args: String) {
        core.scope.launch(Dispatchers.IO) {
            val (ok, res) = try {
                val a = try { JSONArray(args) } catch (e: Exception) { JSONArray() }
                true to (if (kind == "core") callCore(method, a) else callUi(method, a.optJSONObject(0)))
            } catch (e: Throwable) { core.log("bridge $kind.$method: $e"); false to (e.message ?: e.javaClass.simpleName) }
            val json = toJson(res)
            web.post { try { web.evaluateJavascript("window.__dtRes&&__dtRes($id,$ok,$json)", null) } catch (_: Exception) { } }
        }
    }
    @JavascriptInterface fun role(): String = role
    @JavascriptInterface fun insets(): String = (handler as? InsetsProvider)?.insetsJson() ?: "{}"
    interface InsetsProvider { fun insetsJson(): String }

    override fun send(name: String, json: String) {
        web.post { try { web.evaluateJavascript("window.__dtEvt&&__dtEvt(${JSONObject.quote(name)},$json)", null) } catch (_: Exception) { } }
    }

    private suspend fun callCore(m: String, a: JSONArray): Any? {
        if (m !in Core.RPC) throw SecurityException("FORBIDDEN")
        return when (m) {
            "getState" -> core.getState()
            "setSettings" -> { val p = a.optJSONObject(0); val r = core.setSettings(p); ProtectionService.sync(ctx); r }
            "resetSettings" -> core.resetSettings().also { ProtectionService.sync(ctx) }
            "startScan" -> core.startScan(a.optJSONObject(0)).also { ProtectionService.sync(ctx) }
            "pauseScan" -> core.pauseScan(); "resumeScan" -> core.resumeScan(); "cancelScan" -> core.cancelScan()
            "getScan" -> core.getScan(a.optString(0)); "listScans" -> core.listScans()
            "scanPaths" -> core.scanPaths(Js.strList(a.optJSONArray(0)), a.optJSONObject(1))
            "applyAction" -> core.applyAction(a.optJSONObject(0) ?: JSONObject())
            "listQuarantine" -> core.listQuarantine(); "restoreQuarantine" -> core.restoreQuarantine(a.optString(0))
            "deleteQuarantine" -> core.deleteQuarantine(a.optString(0)); "deleteAllQuarantine" -> core.deleteAllQuarantine()
            "removeAllow" -> core.removeAllow(a.optString(0))
            "listHistory" -> core.listHistory(); "clearHistory" -> core.clearHistory()
            "updateSignatures" -> core.updateSignatures(false)
            "getWeather" -> core.getWeather(a.optBoolean(0))
            "systemInfo" -> core.systemInfo(); "knownFolders" -> core.knownFolders(); "sigInfo" -> core.sigInfo()
            "setStartup" -> JSONObject().put("ok", true)
            "listApps" -> core.listApps(a.optBoolean(0))
            "appIcons" -> core.appIcons(Js.strList(a.optJSONArray(0)))
            "appInfo" -> core.apps.info(a.optString(0))?.let { core.apps.json(it, true) }
            else -> null
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun callUi(action: String, p: JSONObject?): Any? {
        when (action) {
            "app:info" -> return JSONObject().put("product", Product.json()).put("platform", "android").put("role", role).put("version", Product.version)
                .put("buildDate", java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).format(java.util.Date(BuildConfig.BUILD_TIME))).put("sdk", Build.VERSION.SDK_INT)
            "external" -> { val u = p?.optString("url") ?: return null; if (Regex("^(https?:|mailto:)").containsMatchIn(u)) ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return null }
            "toast:show" -> { Host.toast(core, p ?: JSONObject()); return null }
            "toast:action" -> { toastAction(p ?: JSONObject()); return null }
            "main:show" -> { ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("route", p?.optString("route")?.ifEmpty { null })); return null }
            "notch:cmd" -> { Host.broadcast("notch:cmd", p); return null }
            "uninstall" -> { p?.optString("pkg")?.let { ctx.startActivity(core.apps.uninstallIntent(it)) }; return null }
            "appDetails" -> { p?.optString("pkg")?.let { ctx.startActivity(core.apps.detailsIntent(it)) }; return null }
            "haptic" -> { vibrate(p?.optString("kind") ?: "tick"); return null }
            "perm:status" -> return core.perms.status()
            "onboarding:done" -> { core.setSettings(JSONObject().put("onboarded", true)); withContext(Dispatchers.Main) { ProtectionService.sync(ctx) }; return null }
        }
        return handler?.ui(action, p)
    }

    private suspend fun toastAction(p: JSONObject) {
        val a = p.optString("action"); val d = p.optJSONObject("data")
        when (a) {
            "open-results" -> d?.optString("scanId")?.let { callUi("main:show", JSONObject().put("route", "results/$it")) }
            "open-quarantine" -> callUi("main:show", JSONObject().put("route", "quarantine"))
            "quarantine" -> if (d != null) core.applyAction(JSONObject().put("scanId", d.optString("scanId")).put("path", d.optString("path")).put("action", "quarantine"))
            "uninstall" -> d?.optString("path")?.removePrefix(Core.APP)?.let { ctx.startActivity(core.apps.uninstallIntent(it)) }
        }
    }
    private fun vibrate(kind: String) {
        try {
            val v = ctx.getSystemService(Vibrator::class.java) ?: return
            if (Build.VERSION.SDK_INT >= 29) v.vibrate(VibrationEffect.createPredefined(when (kind) { "heavy" -> VibrationEffect.EFFECT_HEAVY_CLICK; "double" -> VibrationEffect.EFFECT_DOUBLE_CLICK; else -> VibrationEffect.EFFECT_TICK }))
            else @Suppress("DEPRECATION") v.vibrate(if (kind == "heavy") 40L else 12L)
        } catch (_: Exception) { }
    }

    companion object {
        fun toJson(v: Any?): String = when (v) {
            null, Unit -> "null"
            is JSONObject, is JSONArray -> v.toString()
            is String -> JSONObject.quote(v)
            is Boolean, is Number -> v.toString()
            is Collection<*> -> JSONArray(v).toString()
            else -> JSONObject.quote(v.toString())
        }
    }
}
