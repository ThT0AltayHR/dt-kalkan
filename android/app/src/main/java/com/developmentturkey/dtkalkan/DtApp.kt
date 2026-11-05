package com.developmentturkey.dtkalkan

import android.app.Application
import com.developmentturkey.dtkalkan.service.Notifier
import com.developmentturkey.dtkalkan.service.ScanWorker

class DtApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifier.channels(this)
        ScanWorker.schedule(this)
    }
}
