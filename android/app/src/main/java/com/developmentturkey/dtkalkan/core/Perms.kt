package com.developmentturkey.dtkalkan.core

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/** Real runtime status of every permission the onboarding asks for. */
class Perms(private val ctx: Context) {
    fun allFiles(): Boolean = if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else ctx.checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    fun notifications(): Boolean = (Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    fun location(): Boolean = ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun overlay(): Boolean = Settings.canDrawOverlays(ctx)
    fun battery(): Boolean = ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true
    /** Some OEM ROMs gate the package list behind a runtime permission (e.g. MIUI "GET_INSTALLED_APPS"). */
    val oemAppsPermission = "com.android.permission.GET_INSTALLED_APPS"
    fun oemAppsPermissionDefined(): Boolean = try { ctx.packageManager.getPermissionInfo(oemAppsPermission, 0); true } catch (e: Exception) { false }
    fun apps(): Boolean = if (oemAppsPermissionDefined()) ctx.checkSelfPermission(oemAppsPermission) == PackageManager.PERMISSION_GRANTED else true
    fun status(): JSONObject = JSONObject().put("storage", allFiles()).put("notifications", notifications()).put("location", location())
        .put("overlay", overlay()).put("background", battery()).put("apps", apps())
}
