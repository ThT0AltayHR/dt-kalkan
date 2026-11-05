package com.developmentturkey.dtkalkan.service

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.developmentturkey.dtkalkan.core.Core

/** Quick Settings tile: opens the scan notch (expanded overlay) — or the app when the overlay is off. */
class NotchTileService : TileService() {
    override fun onStartListening() {
        qsTile?.let { t -> t.state = if (Core.get(this).perms.overlay()) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE; if (Build.VERSION.SDK_INT >= 29) t.subtitle = "Çentikte tara"; t.updateTile() }
    }
    @SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        val i = Intent(this, com.developmentturkey.dtkalkan.ui.NotchTrampolineActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 3, i, PendingIntent.FLAG_IMMUTABLE))
        else @Suppress("DEPRECATION") startActivityAndCollapse(i)
    }
}
