package com.developmentturkey.dtkalkan.service

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.developmentturkey.dtkalkan.core.Core
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * WorkManager safety net (runs even if the foreground service was killed): scheduler tick (user-set scan
 * frequency, auto signature updates), and a package snapshot diff that catches apps installed while nothing ran.
 */
class ScanWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    companion object {
        fun schedule(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("dt-tick", ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<ScanWorker>(15, TimeUnit.MINUTES).build())
        }
    }
    override suspend fun doWork(): Result {
        val core = Core.get(applicationContext)
        if (!core.settings.optBoolean("onboarded")) return Result.success()
        // missed installs
        val snap = File(applicationContext.filesDir, "packages.snapshot")
        val now = core.apps.packages().filter { !core.apps.isSystem(it) }.map { it.packageName + ":" + it.lastUpdateTime }.toSet()
        val before = try { snap.readLines().toSet() } catch (e: Exception) { null }
        if (before != null && ProtectionService.instance == null) for (e in now - before) core.onPackageAdded(e.substringBefore(':'))
        try { snap.writeText(now.joinToString("\n")) } catch (_: Exception) { }
        core.tickScheduler()
        while (core.isScanning || core.updating) delay(2000)
        if (ProtectionService.instance == null) ProtectionService.sync(applicationContext)
        return Result.success()
    }
}
