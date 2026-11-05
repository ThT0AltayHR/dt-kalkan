package com.developmentturkey.dtkalkan.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.developmentturkey.dtkalkan.Product
import com.developmentturkey.dtkalkan.R
import com.developmentturkey.dtkalkan.ui.MainActivity
import org.json.JSONObject

/** System notifications (channels, persistent protection notification, threat alerts with actions). */
object Notifier {
    const val CH_PROTECT = "protection"; const val CH_THREAT = "threats"; const val CH_INFO = "info"
    const val ID_FG = 1001
    private var seq = 2000

    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_PROTECT, "Gerçek zamanlı koruma", NotificationManager.IMPORTANCE_LOW).apply { description = "${Product.name} arka planda çalışırken gösterilir"; setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel(CH_THREAT, "Tehdit uyarıları", NotificationManager.IMPORTANCE_HIGH).apply { description = "Zararlı dosya veya uygulama bulunduğunda"; enableVibration(true) })
        nm.createNotificationChannel(NotificationChannel(CH_INFO, "Tarama ve güncellemeler", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Tarama sonuçları ve veritabanı güncellemeleri" })
    }
    fun openIntent(ctx: Context, route: String?, req: Int = 0): PendingIntent =
        PendingIntent.getActivity(ctx, req, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("route", route), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun foreground(ctx: Context, text: String, progress: Int = -1): android.app.Notification =
        NotificationCompat.Builder(ctx, CH_PROTECT).setSmallIcon(R.drawable.ic_stat_shield).setContentTitle(Product.name).setContentText(text)
            .setOngoing(true).setSilent(true).setShowWhen(false).setColor(0xFF2BD4A0.toInt()).setContentIntent(openIntent(ctx, "dashboard"))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .also { if (progress >= 0) it.setProgress(100, progress, false) }
            .addAction(0, "Hızlı tarama", PendingIntent.getBroadcast(ctx, 7, Intent(ctx, ActionReceiver::class.java).setAction(ActionReceiver.QUICK), PendingIntent.FLAG_IMMUTABLE))
            .build()

    /** Threat notification with "Karantinaya al" / "Yoksay" (files) or "Kaldır" / "Yoksay" (apps). */
    fun threat(ctx: Context, title: String, body: String, scanId: String?, path: String, isApp: Boolean, quarantined: Boolean) {
        if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
        val id = seq++
        fun act(a: String) = PendingIntent.getBroadcast(ctx, id * 10 + a.length, Intent(ctx, ActionReceiver::class.java).setAction(a).putExtra("scanId", scanId).putExtra("path", path).putExtra("nid", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = NotificationCompat.Builder(ctx, CH_THREAT).setSmallIcon(R.drawable.ic_stat_shield).setColor(0xFFF4505E.toInt())
            .setLargeIcon(BitmapFactory.decodeResource(ctx.resources, R.drawable.mochi_alarmed))
            .setContentTitle(title).setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_ALARM).setAutoCancel(true)
            .setContentIntent(openIntent(ctx, scanId?.let { "results/$it" }, id))
        if (!quarantined) {
            if (isApp) b.addAction(0, "Kaldır", act(ActionReceiver.UNINSTALL)) else b.addAction(0, "Karantinaya al", act(ActionReceiver.QUARANTINE))
            b.addAction(0, "Yoksay", act(ActionReceiver.IGNORE))
        } else b.addAction(0, "Görüntüle", openIntent(ctx, scanId?.let { "results/$it" }, id + 1))
        try { NotificationManagerCompat.from(ctx).notify(id, b.build()) } catch (_: SecurityException) { }
    }
    fun info(ctx: Context, title: String, body: String, route: String?) {
        try { NotificationManagerCompat.from(ctx).notify(seq++, NotificationCompat.Builder(ctx, CH_INFO).setSmallIcon(R.drawable.ic_stat_shield).setColor(0xFF2BD4A0.toInt())
            .setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(openIntent(ctx, route, seq)).build()) } catch (_: SecurityException) { }
    }
    fun cancel(ctx: Context, id: Int) = NotificationManagerCompat.from(ctx).cancel(id)
    @Suppress("unused") fun json(o: JSONObject) = o
}
