package com.developmentturkey.dtkalkan.service

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import com.developmentturkey.dtkalkan.core.Core
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 24/7 protection: foreground service (type specialUse) with a persistent notification. Hosts the real-time
 * FileObservers, the PACKAGE_ADDED receiver (new apps scanned immediately), the scheduler tick and the overlay notch.
 */
class ProtectionService : Service() {
    companion object {
        @Volatile var instance: ProtectionService? = null
        const val ACTION_INCOMING = "incoming"
        fun shouldRun(ctx: Context): Boolean {
            val s = Core.get(ctx).settings
            if (!s.optBoolean("onboarded")) return false
            return s.getJSONObject("protection").optBoolean("realtime") || s.getJSONObject("general").optBoolean("keepRunning") || s.getJSONObject("notch").optBoolean("enabled")
        }
        /** Start/stop/refresh the service to match settings. Safe to call from anywhere. */
        fun sync(ctx: Context) {
            val app = ctx.applicationContext
            if (shouldRun(app)) {
                try { if (Build.VERSION.SDK_INT >= 26) app.startForegroundService(Intent(app, ProtectionService::class.java)) else app.startService(Intent(app, ProtectionService::class.java)) }
                catch (e: Exception) { if (Build.VERSION.SDK_INT >= 31 && e is ForegroundServiceStartNotAllowedException) Core.get(app).log("fgs not allowed now") else Core.get(app).log("fgs: $e") }
            } else instance?.let { it.stopForeground(STOP_FOREGROUND_REMOVE); it.stopSelf() }
        }
        fun expandOverlay(ctx: Context): Boolean { val o = instance?.overlay; if (o != null && o.shown) { o.expand(); return true }; return false }
        fun incoming(ctx: Context, paths: List<String>, names: List<String>): Boolean { val o = instance?.overlay; if (o != null && o.shown) { o.incoming(paths, names); return true }; return false }
    }
    private lateinit var core: Core
    var overlay: NotchOverlay? = null; private set
    private var tick: Job? = null
    private var lastText = ""
    private val listener: (String, Any?) -> Unit = { name, data ->
        when (name) {
            "scan:progress" -> { val p = data as JSONObject; updateFg(Host.t(core, "fg.scan", mapOf("p" to Math.round(p.optDouble("percent") * 100))), (p.optDouble("percent") * 100).toInt()) }
            "scan:done", "state" -> updateFg(null, -1)
            "settings" -> applySettings()
        }
    }
    private val pkgReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            val pkg = i.data?.schemeSpecificPart ?: return
            if (i.action == Intent.ACTION_PACKAGE_ADDED || i.action == Intent.ACTION_PACKAGE_REPLACED) core.onPackageAdded(pkg)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        core = Core.get(this); Host.attach(this); Notifier.channels(this)
        val n = Notifier.foreground(this, fgText())
        try {
            ServiceCompat.startForeground(this, Notifier.ID_FG, n, if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0)
        } catch (e: Exception) { core.log("startForeground: $e"); stopSelf(); return }
        androidx.core.content.ContextCompat.registerReceiver(this, pkgReceiver, IntentFilter().apply { addAction(Intent.ACTION_PACKAGE_ADDED); addAction(Intent.ACTION_PACKAGE_REPLACED); addDataScheme("package") }, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
        core.on(listener)
        core.startWatchers()
        tick = core.scope.launch(Dispatchers.Default) { delay(8000); while (isActive) { try { core.tickScheduler() } catch (_: Exception) { }; delay(30_000) } }
        applySettings()
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        applySettings()
        if (intent?.action == ACTION_INCOMING) {
            val paths = intent.getStringArrayListExtra("paths") ?: arrayListOf(); val names = intent.getStringArrayListExtra("names") ?: arrayListOf()
            overlay?.incoming(paths, names)
        }
        return START_STICKY
    }
    private fun applySettings() {
        val s = core.settings
        val want = s.optBoolean("onboarded") && s.getJSONObject("notch").optBoolean("enabled") && core.perms.overlay()
        if (want && overlay == null) overlay = NotchOverlay(this).also { it.show() }
        else if (!want && overlay != null) { overlay?.hide(); overlay = null }
        if (core.perms.allFiles() && s.getJSONObject("protection").optBoolean("realtime")) { if (core.watchCount == 0) core.startWatchers() } else core.stopWatchers()
        updateFg(null, -1)
    }
    private fun fgText(): String = Host.t(core, "fg.ok", mapOf("n" to core.watchDirs().size))
    private fun updateFg(text: String?, progress: Int) {
        val t = text ?: if (core.isScanning) lastText else fgText()
        if (t == lastText && progress < 0) return
        lastText = t
        try { getSystemService(android.app.NotificationManager::class.java).notify(Notifier.ID_FG, Notifier.foreground(this, t, progress)) } catch (_: Exception) { }
    }
    override fun onDestroy() {
        instance = null
        tick?.cancel(); core.off(listener); core.stopWatchers()
        try { unregisterReceiver(pkgReceiver) } catch (_: Exception) { }
        overlay?.hide(); overlay = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
