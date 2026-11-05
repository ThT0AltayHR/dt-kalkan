package com.developmentturkey.dtkalkan.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.developmentturkey.dtkalkan.core.Core
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Notification actions: Karantinaya al / Yoksay / Kaldır / Hızlı tarama. */
class ActionReceiver : BroadcastReceiver() {
    companion object { const val QUARANTINE = "q"; const val IGNORE = "ign"; const val UNINSTALL = "uninst"; const val QUICK = "quick" }
    override fun onReceive(ctx: Context, i: Intent) {
        val core = Core.get(ctx); val nid = i.getIntExtra("nid", 0)
        val pr = goAsync()
        core.scope.launch(Dispatchers.IO) {
            try {
                val path = i.getStringExtra("path") ?: ""; val scanId = i.getStringExtra("scanId")
                when (i.action) {
                    QUARANTINE -> core.applyAction(JSONObject().put("scanId", scanId).put("path", path).put("action", "quarantine"))
                    IGNORE -> core.applyAction(JSONObject().put("scanId", scanId).put("path", path).put("action", "ignore"))
                    UNINSTALL -> ctx.startActivity(core.apps.uninstallIntent(path.removePrefix(Core.APP)))
                    QUICK -> core.startScan(JSONObject().put("type", "quick").put("source", "notification"))
                }
                if (nid != 0) Notifier.cancel(ctx, nid)
            } finally { pr.finish() }
        }
    }
}

/** Starts protection after boot / app update (if the user enabled "start on boot"). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val core = Core.get(ctx)
        if (i.action == Intent.ACTION_MY_PACKAGE_REPLACED || core.settings.getJSONObject("general").optBoolean("startup", true)) ProtectionService.sync(ctx)
        ScanWorker.schedule(ctx)
    }
}
