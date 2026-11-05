package com.developmentturkey.dtkalkan.service

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.DragEvent
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.developmentturkey.dtkalkan.bridge.Bridge
import com.developmentturkey.dtkalkan.core.Core
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The dynamic notch as a system overlay (TYPE_APPLICATION_OVERLAY): a black pill centred on the camera cutout
 * that hosts the same notch.html as the desktop. It resizes its window with the pill (grow first, shrink after
 * the spring animation), passes touches through outside the pill, and accepts global drag-and-drop from other
 * apps (DRAG_FLAG_GLOBAL / DRAG_FLAG_GLOBAL_URI_READ).
 */
class NotchOverlay(private val ctx: Context) : Bridge.Handler {
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val core = Core.get(ctx)
    private val d = ctx.resources.displayMetrics.density
    private lateinit var web: WebView
    private lateinit var bridge: Bridge
    private lateinit var lp: WindowManager.LayoutParams
    var shown = false; private set
    private var ready = false
    private val queue = ArrayList<String>()

    private fun screenW() = ctx.resources.displayMetrics.widthPixels
    private fun screenH() = ctx.resources.displayMetrics.heightPixels
    /** Horizontal centre of the top camera cutout (px), or the screen centre. */
    private fun cutoutCenter(): Int {
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val c = wm.currentWindowMetrics.windowInsets.displayCutout
                c?.boundingRects?.firstOrNull { it.top == 0 }?.let { return it.centerX() }
            }
        } catch (_: Exception) { }
        return screenW() / 2
    }
    private fun cutoutBottom(): Int = try { if (Build.VERSION.SDK_INT >= 31) wm.currentWindowMetrics.windowInsets.displayCutout?.boundingRects?.firstOrNull { it.top == 0 }?.bottom ?: 0 else 0 } catch (e: Exception) { 0 }
    private fun statusBar(): Int { val id = ctx.resources.getIdentifier("status_bar_height", "dimen", "android"); return if (id > 0) ctx.resources.getDimensionPixelSize(id) else (24 * d).toInt() }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    fun show() {
        if (shown || !core.perms.overlay()) return
        web = WebView(ctx)
        web.setBackgroundColor(Color.TRANSPARENT)
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            override fun onPageFinished(view: WebView, url: String) {
                ready = true
                web.evaluateJavascript("window.__dtInsets&&__dtInsets(${JSONObject().put("top", statusBar() / d).put("cutoutH", cutoutBottom() / d).put("width", screenW() / d).put("height", screenH() / d).put("overlay", true)})", null)
                queue.forEach { web.evaluateJavascript(it, null) }; queue.clear()
            }
        }
        web.settings.apply { javaScriptEnabled = true; domStorageEnabled = true; mediaPlaybackRequiresUserGesture = false; allowFileAccess = false; textZoom = 100 }
        web.isVerticalScrollBarEnabled = false; web.isHorizontalScrollBarEnabled = false; web.overScrollMode = View.OVER_SCROLL_NEVER
        bridge = Bridge(ctx, web, "notch", this)
        web.addJavascriptInterface(bridge, "DTNative")
        web.setOnDragListener { _, e -> onDrag(e) }
        lp = WindowManager.LayoutParams(
            (300 * d).toInt(), (64 * d).toInt(), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            if (Build.VERSION.SDK_INT >= 31) setFitInsetsTypes(0)
            title = "DT Notch"
        }
        position(lp.width)
        try { wm.addView(web, lp); shown = true; Host.webs.add(bridge) } catch (e: Exception) { core.log("overlay: $e"); return }
        web.loadUrl("https://appassets.androidplatform.net/assets/www/notch.html?host=overlay")
    }
    private fun position(wPx: Int) {
        lp.x = (cutoutCenter() - wPx / 2).coerceIn(0, maxOf(0, screenW() - wPx)); lp.y = 0
    }
    /** While the app itself is on screen its in-app notch takes over, so the overlay steps aside. */
    private var hidden = false
    fun setHidden(h: Boolean) {
        if (!shown) return
        web.post {
            hidden = h; web.visibility = if (h) View.INVISIBLE else View.VISIBLE
            lp.flags = if (h) lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else lp.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
            try { wm.updateViewLayout(web, lp) } catch (_: Exception) { }
        }
    }
    fun hide() {
        if (!shown) return
        shown = false; ready = false
        Host.webs.remove(bridge)
        try { wm.removeView(web) } catch (_: Exception) { }
        web.destroy()
    }
    private fun js(code: String) { if (!shown) return; if (ready) web.post { web.evaluateJavascript(code, null) } else queue.add(code) }
    fun expand() = js("window.Notch&&Notch.expandFromTile()")
    /** Share-sheet / QS entry: paper flies from the bottom of the screen into the notch. */
    fun incoming(paths: List<String>, names: List<String>) = js("window.Notch&&Notch.incoming(${JSONArray(paths)},${JSONArray(names)})")

    override suspend fun ui(action: String, p: JSONObject?): Any? {
        when (action) {
            "notch:size" -> web.post {
                if (!shown) return@post
                val full = p?.optBoolean("full") == true
                val w = if (full) screenW() else ((p?.optDouble("w") ?: 300.0) * d).toInt().coerceAtMost(screenW())
                val h = if (full) (screenH() * 0.92).toInt() else ((p?.optDouble("h") ?: 64.0) * d).toInt()
                lp.width = w; lp.height = h; position(w)
                lp.flags = if (hidden || full || p?.optBoolean("passthrough") == true) lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else lp.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
                try { wm.updateViewLayout(web, lp) } catch (_: Exception) { }
            }
            "notch:mouse" -> web.post {
                if (!shown) return@post
                lp.flags = if (p?.optBoolean("ignore") == true) lp.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else lp.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
                try { wm.updateViewLayout(web, lp) } catch (_: Exception) { }
            }
            "notch:geom" -> return JSONObject().put("width", screenW() / d).put("height", screenH() / d).put("top", statusBar() / d).put("cutoutH", cutoutBottom() / d).put("overlay", true)
        }
        return null
    }

    // ───────── cross-app drag & drop ─────────
    private var dragging = false
    private fun onDrag(e: DragEvent): Boolean {
        when (e.action) {
            DragEvent.ACTION_DRAG_STARTED -> {
                val desc = e.clipDescription ?: return false
                if (desc.mimeTypeCount == 0) return false
                dragging = true; js("window.Notch&&Notch.xdrag('start',0,0)"); return true
            }
            DragEvent.ACTION_DRAG_ENTERED -> js("window.Notch&&Notch.xdrag('enter',0,0)")
            DragEvent.ACTION_DRAG_LOCATION -> js("window.Notch&&Notch.xdrag('move',${e.x / d},${e.y / d})")
            DragEvent.ACTION_DROP -> {
                dragging = false
                val paths = resolve(e.clipData)
                if (paths.isEmpty()) { js("window.Notch&&Notch.xdrag('denied',0,0)"); return false }
                js("window.Notch&&Notch.xdrop(${JSONArray(paths)},${e.x / d},${e.y / d})"); return true
            }
            DragEvent.ACTION_DRAG_ENDED -> if (dragging) { dragging = false; js("window.Notch&&Notch.xdrag('leave',0,0)") }
        }
        return true
    }
    /**
     * A service window cannot call Activity.requestDragAndDropPermissions(), so content:// items are resolved
     * best-effort: shared-storage documents are mapped to real paths (all-files access), plain paths are used
     * directly, and anything else is tried through the ContentResolver.
     */
    private fun resolve(c: ClipData?): List<String> {
        if (c == null) return emptyList()
        val out = ArrayList<String>()
        for (i in 0 until c.itemCount) {
            val it = c.getItemAt(i)
            val u = it.uri
            if (u != null) {
                val p = core.uriToPath(u)
                if (p != null && File(p).canRead()) { out.add(p); continue }
                val readable = try { ctx.contentResolver.openInputStream(u)?.use { s -> s.read(); true } ?: false } catch (_: Exception) { false }
                if (readable) out.add(u.toString())
                continue
            }
            val t = it.text?.toString()?.trim()
            if (t != null && t.startsWith("/") && File(t).canRead()) out.add(t)
        }
        return out
    }
}
