package com.developmentturkey.dtkalkan.core

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.LruCache
import com.developmentturkey.dtkalkan.engine.InstalledFacts
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/** Installed packages: listing (with real icons), APK paths, and live facts for the Android detection layer. */
class Apps(private val ctx: Context) {
    private val pm = ctx.packageManager
    private val iconCache = LruCache<String, String>(400)

    @Suppress("DEPRECATION")
    fun packages(): List<PackageInfo> = try {
        if (Build.VERSION.SDK_INT >= 33) pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
        else pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
    } catch (e: Exception) { emptyList() }

    @Suppress("DEPRECATION")
    fun info(pkg: String): PackageInfo? = try {
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())) else pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS)
    } catch (e: Exception) { null }

    fun isSystem(p: PackageInfo): Boolean { val f = p.applicationInfo?.flags ?: 0; return (f and ApplicationInfo.FLAG_SYSTEM) != 0 && (f and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) == 0 }
    fun label(p: PackageInfo): String = try { p.applicationInfo?.loadLabel(pm)?.toString() ?: p.packageName } catch (e: Exception) { p.packageName }
    fun apkFiles(p: PackageInfo): List<File> { val ai = p.applicationInfo ?: return emptyList(); return (listOf(ai.sourceDir) + (ai.splitSourceDirs?.toList() ?: emptyList())).filterNotNull().map { File(it) } }

    fun iconDataUrl(pkg: String, sizePx: Int = 96): String? {
        iconCache.get(pkg)?.let { return it }
        return try {
            val d = pm.getApplicationIcon(pkg)
            val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp); d.setBounds(0, 0, sizePx, sizePx); d.draw(c)
            val bo = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.PNG, 100, bo)
            ("data:image/png;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP)).also { iconCache.put(pkg, it) }
        } catch (e: Exception) { null }
    }

    @Suppress("DEPRECATION")
    fun installer(pkg: String): String? = try {
        if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(pkg).installingPackageName else pm.getInstallerPackageName(pkg)
    } catch (e: Exception) { null }

    fun facts(p: PackageInfo): InstalledFacts {
        val pkg = p.packageName
        val a11y = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        val nl = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: ""
        val dpm = ctx.getSystemService(DevicePolicyManager::class.java)
        val admin = try { dpm?.activeAdmins?.any { it.packageName == pkg } == true } catch (e: Exception) { false }
        val granted = HashSet<String>()
        val req = p.requestedPermissions; val fl = p.requestedPermissionsFlags
        if (req != null && fl != null) for (i in req.indices) if (fl[i] and PackageInfo.REQUESTED_PERMISSION_GRANTED != 0) granted.add(req[i])
        return InstalledFacts(pkg, isSystem(p), installer(pkg), hasLauncher(pkg), a11y.contains("$pkg/"), admin, nl.contains("$pkg/"), granted)
    }
    fun hasLauncher(pkg: String): Boolean = try { pm.getLaunchIntentForPackage(pkg) != null } catch (e: Exception) { true }

    fun json(p: PackageInfo, withIcon: Boolean): JSONObject {
        val files = apkFiles(p)
        return JSONObject().put("pkg", p.packageName).put("name", label(p)).put("system", isSystem(p))
            .put("version", p.versionName ?: "").put("size", files.sumOf { it.length() }).put("splits", files.size)
            .put("installer", installer(p.packageName) ?: JSONObject.NULL)
            .put("installedAt", p.firstInstallTime).put("updatedAt", p.lastUpdateTime)
            .put("perms", p.requestedPermissions?.size ?: 0)
            .also { if (withIcon) it.put("icon", iconDataUrl(p.packageName) ?: JSONObject.NULL) }
    }

    fun uninstallIntent(pkg: String): Intent = Intent(Intent.ACTION_DELETE, android.net.Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    fun detailsIntent(pkg: String): Intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
