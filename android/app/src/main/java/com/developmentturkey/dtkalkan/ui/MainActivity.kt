package com.developmentturkey.dtkalkan.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.Settings
import android.view.DragEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.developmentturkey.dtkalkan.bridge.Bridge
import com.developmentturkey.dtkalkan.core.Core
import com.developmentturkey.dtkalkan.service.Host
import com.developmentturkey.dtkalkan.service.ProtectionService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Hosts the DT Kalkan web UI (same HTML/CSS/JS as the desktop renderer, phone layout) in a WebView. */
class MainActivity : Activity(), Bridge.Handler, Bridge.InsetsProvider {
    companion object {
        const val ACTION_QUICK_SCAN = "com.developmentturkey.dtkalkan.action.QUICK_SCAN"
        const val ACTION_OPEN_NOTCH = "com.developmentturkey.dtkalkan.action.OPEN_NOTCH"
        const val ACTION_SCAN_APPS = "com.developmentturkey.dtkalkan.action.SCAN_APPS"
        const val URL = "https://appassets.androidplatform.net/assets/www/main.html"
        private const val REQ_PICK = 11; private const val REQ_PERM = 12; private const val REQ_SETTINGS = 13
    }
    lateinit var web: WebView; private set
    private lateinit var bridge: Bridge
    private lateinit var core: Core
    private var insets = JSONObject()
    private var pending: CompletableDeferred<Any?>? = null
    private var permKey: String? = null
    private val dropPerms = ArrayList<android.view.DragAndDropPermissions>()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        core = Core.get(this)
        Host.attach(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT; window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) { window.isNavigationBarContrastEnforced = false; window.isStatusBarContrastEnforced = false }
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = false

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0B0D12"))
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { }
                return true
            }
            override fun onPageFinished(view: WebView, url: String) { pushInsets(); handleIntent(intent, true) }
        }
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false; allowFileAccess = false; allowContentAccess = false; textZoom = 100 }
        web.isVerticalScrollBarEnabled = false; web.overScrollMode = View.OVER_SCROLL_NEVER
        bridge = Bridge(this, web, "main", this)
        web.addJavascriptInterface(bridge, "DTNative")
        Host.webs.add(bridge)
        setContentView(web)
        ViewCompat.setOnApplyWindowInsetsListener(web) { _, ins ->
            val d = resources.displayMetrics.density
            val sb = ins.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val cut = ins.displayCutout
            val r = cut?.boundingRects?.firstOrNull { it.top == 0 }
            insets = JSONObject().put("top", sb.top / d).put("bottom", sb.bottom / d).put("left", sb.left / d).put("right", sb.right / d)
                .put("cutout", if (r != null) JSONObject().put("x", r.exactCenterX() / d).put("w", r.width() / d).put("h", r.bottom / d) else JSONObject.NULL)
                .put("width", resources.displayMetrics.widthPixels / d)
            pushInsets(); ins
        }
        // Drag & drop from other apps (split screen / freeform): files dropped on the window go into the in-app notch.
        web.setOnDragListener { _, e -> onDrag(e) }
        web.loadUrl(URL)
        ProtectionService.sync(this)
    }

    private fun pushInsets() { if (::web.isInitialized) web.evaluateJavascript("window.__dtInsets&&__dtInsets(${insets})", null) }
    override fun insetsJson(): String = insets.toString()

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent, false) }
    private var handledIntent: Intent? = null
    private fun handleIntent(i: Intent?, onLoad: Boolean) {
        if (i == null || i === handledIntent) return
        handledIntent = i
        when (i.action) {
            ACTION_QUICK_SCAN -> { core.startScan(JSONObject().put("type", "quick")); Host.broadcast("navigate", "scan", "main") }
            ACTION_SCAN_APPS -> Host.broadcast("navigate", "apps", "main")
            ACTION_OPEN_NOTCH -> { if (!ProtectionService.expandOverlay(this)) web.evaluateJavascript("window.InAppNotch&&InAppNotch.expand()", null) }
        }
        i.getStringExtra("route")?.let { r -> if (!onLoad || r.isNotEmpty()) Host.broadcast("navigate", r, "main") }
        @Suppress("DEPRECATION") val shared = i.getParcelableArrayListExtra<Uri>("dt_drop")
        if (shared != null && shared.isNotEmpty()) web.postDelayed({ web.evaluateJavascript("window.InAppNotch&&InAppNotch.incoming(${JSONArray(shared.map { it.toString() })})", null) }, if (onLoad) 1600 else 300)
    }

    override fun onResume() { super.onResume(); Host.mainVisible = true; Host.broadcast("perm:status", core.perms.status(), "main")
        pending?.let { p -> val k = permKey; if (k != null) { permKey = null; pending = null; p.complete(permResult(k)) } } }
    override fun onPause() { super.onPause(); Host.mainVisible = false }
    override fun onDestroy() { Host.webs.remove(bridge); dropPerms.forEach { try { it.release() } catch (_: Exception) { } }; web.destroy(); super.onDestroy() }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.App&&App.back?App.back():false") { r -> if (r != "true") moveTaskToBack(true) }
    }

    // ───────── drag & drop from other apps ─────────
    private fun onDrag(e: DragEvent): Boolean {
        val d = resources.displayMetrics.density
        when (e.action) {
            DragEvent.ACTION_DRAG_STARTED -> return e.clipDescription?.let { it.mimeTypeCount > 0 } == true
            DragEvent.ACTION_DRAG_ENTERED -> web.evaluateJavascript("window.InAppNotch&&InAppNotch.xdrag('enter',0,0)", null)
            DragEvent.ACTION_DRAG_LOCATION -> web.evaluateJavascript("window.InAppNotch&&InAppNotch.xdrag('move',${e.x / d},${e.y / d})", null)
            DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> if (e.action == DragEvent.ACTION_DRAG_EXITED || !e.result) web.evaluateJavascript("window.InAppNotch&&InAppNotch.xdrag('leave',0,0)", null)
            DragEvent.ACTION_DROP -> {
                val perms = try { requestDragAndDropPermissions(e) } catch (_: Exception) { null }
                perms?.let { dropPerms.add(it) }
                val items = urisOf(e.clipData)
                if (items.isEmpty()) { web.evaluateJavascript("window.InAppNotch&&InAppNotch.xdrag('leave',0,0)", null); return false }
                web.evaluateJavascript("window.InAppNotch&&InAppNotch.xdrop(${JSONArray(items)},${e.x / d},${e.y / d})", null)
                return true
            }
        }
        return true
    }
    private fun urisOf(c: ClipData?): List<String> {
        if (c == null) return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until c.itemCount) { val it = c.getItemAt(i); it.uri?.let { u -> out.add(core.uriToPath(u)?.takeIf { p -> java.io.File(p).canRead() } ?: u.toString()) } ?: it.text?.toString()?.takeIf { t -> t.startsWith("/") && java.io.File(t).exists() }?.let { out.add(it) } }
        return out
    }

    // ───────── UI actions that need an Activity ─────────
    override suspend fun ui(action: String, p: JSONObject?): Any? = when (action) {
        "pick" -> withContext(Dispatchers.Main) { pick(p?.optBoolean("folders") == true) }
        "perm:request" -> withContext(Dispatchers.Main) { requestPerm(p?.optString("key") ?: "") }
        "reveal" -> withContext(Dispatchers.Main) { reveal(p?.optString("path") ?: ""); null }
        "quit" -> withContext(Dispatchers.Main) { finishAffinity(); null }
        "insets" -> insets
        else -> null
    }

    private suspend fun pick(folders: Boolean): JSONArray {
        val d = CompletableDeferred<Any?>(); pending = d; permKey = null
        val i = if (folders) Intent(Intent.ACTION_OPEN_DOCUMENT_TREE) else Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        @Suppress("DEPRECATION") startActivityForResult(i, REQ_PICK)
        return (d.await() as? JSONArray) ?: JSONArray()
    }
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK) {
            val out = JSONArray()
            if (resultCode == RESULT_OK && data != null) {
                val uris = ArrayList<Uri>(); data.data?.let { uris.add(it) }
                data.clipData?.let { c -> for (k in 0 until c.itemCount) uris.add(c.getItemAt(k).uri) }
                for (u in uris.distinct()) {
                    try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } catch (_: Exception) {
                        try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { } }
                    val path = core.uriToPath(u)
                    out.put(if (path != null && core.perms.allFiles() && java.io.File(path).exists()) path else u.toString())
                }
            }
            pending?.complete(out); pending = null
        }
    }

    private fun permResult(key: String): Boolean = when (key) {
        "storage" -> core.perms.allFiles(); "notifications" -> core.perms.notifications(); "location" -> core.perms.location()
        "overlay" -> core.perms.overlay(); "background" -> core.perms.battery(); "apps" -> core.perms.apps(); else -> false
    }

    /** Opens the real system dialog / settings page for one onboarding permission and returns the final state. */
    @SuppressLint("BatteryLife")
    private suspend fun requestPerm(key: String): Boolean {
        if (permResult(key) && key != "background") { if (key == "background") ProtectionService.sync(this); return true }
        val d = CompletableDeferred<Any?>(); pending = d; permKey = key
        val pkgUri = Uri.parse("package:$packageName")
        try {
            when (key) {
                "storage" -> if (Build.VERSION.SDK_INT >= 30) {
                    try { startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, pkgUri)) } catch (e: Exception) { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
                } else requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE), REQ_PERM)
                "notifications" -> if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_PERM)
                    else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                "location" -> requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION), REQ_PERM)
                "overlay" -> startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri))
                "background" -> {
                    core.setSettings(JSONObject().put("general", JSONObject().put("keepRunning", true))); ProtectionService.sync(this)
                    if (core.perms.battery()) { pending = null; permKey = null; return true }
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri))
                }
                "apps" -> if (core.perms.oemAppsPermissionDefined()) requestPermissions(arrayOf(core.perms.oemAppsPermission), REQ_PERM) else { pending = null; permKey = null; return true }
                else -> { pending = null; permKey = null; return false }
            }
        } catch (e: Exception) { core.log("perm $key: $e"); pending = null; permKey = null; return permResult(key) }
        val r = d.await() as? Boolean ?: permResult(key)
        if (key == "storage" || key == "overlay") ProtectionService.sync(this)
        return r
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val k = permKey ?: return
        permKey = null; pending?.complete(permResult(k)); pending = null
        if (k == "notifications") core.scope.launch { ProtectionService.sync(this@MainActivity) }
    }

    private fun reveal(path: String) {
        try {
            val f = java.io.File(path); val dir = if (f.isDirectory) f else f.parentFile
            val rel = dir?.path?.removePrefix(core.storageRoot().path)?.trim('/') ?: ""
            val uri = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:$rel")
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, DocumentsContract.Document.MIME_TYPE_DIR).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (e: Exception) {
            try { startActivity(Intent(Intent.ACTION_VIEW).setType(DocumentsContract.Document.MIME_TYPE_DIR)) } catch (_: Exception) { }
        }
    }
}
