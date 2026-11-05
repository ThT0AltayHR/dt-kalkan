package com.developmentturkey.dtkalkan.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import com.developmentturkey.dtkalkan.core.Core
import com.developmentturkey.dtkalkan.service.ProtectionService
import java.io.File

/**
 * Share-sheet target "DT Kalkan ile tara": copies the shared items into a private cache (keeping their names)
 * and hands them to the overlay notch, which plays the paper-into-notch animation and scans them.
 * Without the overlay, the app opens and the in-app notch does the same.
 */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uris = ArrayList<Uri>()
        @Suppress("DEPRECATION")
        when (intent?.action) {
            Intent.ACTION_SEND -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableExtra(Intent.EXTRA_STREAM))?.let { uris.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java) else intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.let { uris.addAll(it) }
            Intent.ACTION_VIEW -> intent.data?.let { uris.add(it) }
        }
        val core = Core.get(this)
        val dir = File(cacheDir, "shared/" + System.currentTimeMillis()).apply { mkdirs() }
        val paths = ArrayList<String>(); val names = ArrayList<String>()
        for (u in uris.take(50)) {
            val name = displayName(u) ?: u.lastPathSegment?.substringAfterLast('/') ?: "dosya"
            try {
                val f = File(dir, name.replace('/', '_'))
                contentResolver.openInputStream(u)?.use { i -> f.outputStream().use { i.copyTo(it, 1 shl 16) } }
                paths.add(f.path); names.add(name)
            } catch (e: Exception) { core.log("share copy: $e") }
        }
        if (paths.isNotEmpty()) {
            if (!ProtectionService.incoming(this, paths, names))
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putParcelableArrayListExtra("dt_drop", ArrayList(paths.map { Uri.fromFile(File(it)) })))
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
    private fun displayName(u: Uri): String? = try { contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } } catch (e: Exception) { null }
}
