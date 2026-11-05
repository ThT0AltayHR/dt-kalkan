package com.developmentturkey.dtkalkan.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.developmentturkey.dtkalkan.service.ProtectionService

/** Invisible entry for the Quick Settings tile / app shortcut: expands the overlay notch, or opens the app's in-app notch. */
class NotchTrampolineActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ProtectionService.sync(this)
        if (!ProtectionService.expandOverlay(this))
            startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_OPEN_NOTCH).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}
