package com.developmentturkey.dtkalkan.engine

/** Facts read from an APK's binary AndroidManifest.xml. */
data class ApkFacts(
    val packageName: String = "",
    val permissions: Set<String> = emptySet(),
    /** permission strings that protect declared services/receivers (e.g. BIND_ACCESSIBILITY_SERVICE) */
    val boundPermissions: Set<String> = emptySet(),
    val components: List<String> = emptyList(),
    val hasLauncher: Boolean = true,
    val actions: Set<String> = emptySet(),
    val label: String = "",
)

/** Live facts of an installed package (filled by the app from PackageManager & system settings). */
data class InstalledFacts(
    val packageName: String,
    val isSystem: Boolean = false,
    val installer: String? = null,
    val hasLauncherNow: Boolean = true,
    val accessibilityEnabled: Boolean = false,
    val deviceAdminActive: Boolean = false,
    val notificationListenerEnabled: Boolean = false,
    val grantedPermissions: Set<String> = emptySet(),
)

/** DEX string table extraction (string_ids → MUTF-8 data). */
object Dex {
    fun strings(d: ByteArray, len: Int, max: Int = 400_000): List<String> {
        val out = ArrayList<String>()
        try {
            val b = Buf(d, 0, len)
            if (len < 0x70 || b.latin1(0, 4) != "dex\n") return out
            val n = b.u32i(0x38); val off = b.u32i(0x3c)
            if (n < 0 || off < 0 || off.toLong() + n.toLong() * 4 > len) return out
            val sb = StringBuilder()
            for (i in 0 until minOf(n, max)) {
                var p = b.u32i(off + i * 4)
                if (p < 0 || p >= len) continue
                // uleb128 utf16 length
                var shift = 0
                while (p < len) { val v = b[p++]; if (v and 0x80 == 0) break; shift += 7; if (shift > 28) break }
                sb.setLength(0)
                while (p < len) {
                    val c = b[p++]
                    if (c == 0) break
                    if (c < 0x80) sb.append(c.toChar())
                    else if (c and 0xe0 == 0xc0 && p < len) { sb.append((((c and 0x1f) shl 6) or (b[p++] and 0x3f)).toChar()) }
                    else if (c and 0xf0 == 0xe0 && p + 1 < len) { sb.append((((c and 0x0f) shl 12) or ((b[p++] and 0x3f) shl 6) or (b[p++] and 0x3f)).toChar()) }
                    else sb.append('?')
                    if (sb.length > 4096) break
                }
                out.add(sb.toString())
            }
        } catch (_: Exception) { }
        return out
    }
}

/** Minimal Android binary XML (AXML) reader for AndroidManifest.xml. */
object Axml {
    fun parseManifest(x: ByteArray): ApkFacts {
        val perms = LinkedHashSet<String>(); val bound = LinkedHashSet<String>(); val comps = ArrayList<String>(); val actions = LinkedHashSet<String>()
        var pkg = ""; var label = ""
        var hasLauncher = false
        try {
            val b = Buf(x)
            if (b.u16(0) != 0x0003) return ApkFacts()
            var p = b.u16(2)
            var strings: List<String> = emptyList()
            // element stack for intent-filter tracking
            val stack = ArrayList<String>()
            var filterActions = HashSet<String>(); var filterCats = HashSet<String>()
            var compTag = ""
            while (p + 8 <= b.len) {
                val type = b.u16(p); val hsz = b.u16(p + 2); val size = b.u32i(p + 4)
                if (size <= 0) break
                when (type) {
                    0x0001 -> strings = readPool(b, p)
                    0x0102 -> { // start element
                        val nameIdx = b.u32i(p + 20)
                        val tag = strings.getOrNull(nameIdx) ?: ""
                        val attrStart = b.u16(p + 24); val attrSize = b.u16(p + 26); val attrCount = b.u16(p + 28)
                        val attrs = HashMap<String, String>()
                        for (i in 0 until attrCount) {
                            val a = p + 16 + attrStart + i * attrSize
                            val an = strings.getOrNull(b.u32i(a + 4)) ?: continue
                            val raw = b.u32i(a + 8)
                            val dataType = b.at(a + 15); val data = b.u32i(a + 16)
                            val v = if (raw >= 0) strings.getOrNull(raw) ?: "" else if (dataType == 0x03) strings.getOrNull(data) ?: "" else if (dataType == 0x12) (data != 0).toString() else data.toString()
                            attrs[an] = v
                        }
                        stack.add(tag)
                        when (tag) {
                            "manifest" -> pkg = attrs["package"] ?: ""
                            "application" -> label = attrs["label"] ?: ""
                            "uses-permission", "uses-permission-sdk-23" -> attrs["name"]?.let { perms.add(it) }
                            "activity", "activity-alias", "service", "receiver", "provider" -> { compTag = tag; attrs["name"]?.let { comps.add(it) }; attrs["permission"]?.let { bound.add(it) } }
                            "intent-filter" -> { filterActions = HashSet(); filterCats = HashSet() }
                            "action" -> attrs["name"]?.let { filterActions.add(it); actions.add(it) }
                            "category" -> attrs["name"]?.let { filterCats.add(it) }
                        }
                    }
                    0x0103 -> { // end element
                        val tag = if (stack.isNotEmpty()) stack.removeAt(stack.size - 1) else ""
                        if (tag == "intent-filter" && (compTag == "activity" || compTag == "activity-alias") && "android.intent.action.MAIN" in filterActions && "android.intent.category.LAUNCHER" in filterCats) hasLauncher = true
                    }
                    0x0003 -> { p += hsz; continue }
                }
                p += size
            }
        } catch (_: Exception) { }
        return ApkFacts(pkg, perms, bound, comps, hasLauncher, actions, label)
    }

    private fun readPool(b: Buf, p: Int): List<String> {
        val count = b.u32i(p + 8); val flags = b.u32i(p + 16); val strStart = b.u32i(p + 20)
        val utf8 = flags and (1 shl 8) != 0
        val out = ArrayList<String>(count)
        for (i in 0 until minOf(count, 200_000)) {
            var o = p + strStart + b.u32i(p + 28 + i * 4)
            try {
                if (utf8) {
                    var n = b[o++]; if (n and 0x80 != 0) o++ // utf16 len
                    var bl = b[o++]; if (bl and 0x80 != 0) { bl = ((bl and 0x7f) shl 8) or b[o++] }
                    out.add(String(b.a, b.off + o, bl, Charsets.UTF_8))
                } else {
                    var n = b.u16(o); o += 2; if (n and 0x8000 != 0) { n = ((n and 0x7fff) shl 16) or b.u16(o); o += 2 }
                    out.add(Text.utf16le(b, o, o + n * 2))
                }
            } catch (_: Exception) { out.add("") }
        }
        return out
    }
}

/**
 * Android-specific heuristics: dangerous permission combinations, banker / stalkerware / SMS-fraud indicators,
 * hidden launcher icon, sideloading. Weights feed the same combine() as every other layer.
 */
object AndroidHeuristics {
    private const val P = "android.permission."
    private val SURVEIL = listOf("READ_SMS", "READ_CALL_LOG", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION", "READ_CONTACTS", "CAMERA", "PROCESS_OUTGOING_CALLS", "READ_PHONE_STATE")
    val TRUSTED_INSTALLERS = setOf("com.android.vending", "com.google.android.packageinstaller.store", "com.sec.android.app.samsungapps", "com.huawei.appmarket", "com.xiaomi.market", "com.xiaomi.mipicks",
        "com.oppo.market", "com.heytap.market", "com.bbk.appstore", "com.amazon.venezia", "org.fdroid.fdroid", "com.android.shell", "com.google.android.feedback")

    fun analyze(f: ApkFacts, dex: String, live: InstalledFacts? = null): List<Reason> {
        val r = ArrayList<Reason>()
        fun add(w: Int, code: String, tr: String, en: String, tname: String? = null) = r.add(Reason("heuristic", code, w, tr, en, tname))
        val perms = f.permissions + (live?.grantedPermissions ?: emptySet())
        fun has(vararg n: String) = n.any { (P + it) in perms }
        val a11y = "android.permission.BIND_ACCESSIBILITY_SERVICE" in f.boundPermissions || "android.accessibilityservice.AccessibilityService" in f.actions
        val admin = "android.permission.BIND_DEVICE_ADMIN" in f.boundPermissions || "android.app.action.DEVICE_ADMIN_ENABLED" in f.actions
        val notifL = "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" in f.boundPermissions
        val sms = has("RECEIVE_SMS", "READ_SMS")
        val overlay = has("SYSTEM_ALERT_WINDOW")
        val system = live?.isSystem == true
        val hidden = !(live?.hasLauncherNow ?: f.hasLauncher) && f.components.size > 1
        val wSys = if (system) 0.4 else 1.0
        fun w(v: Int) = Math.round(v * wSys).toInt()

        if (a11y && overlay && sms) add(w(45), "android-banker", "Erişilebilirlik hizmeti + diğer uygulamaların üzerinde gösterim + SMS okuma (bankacılık truva atı izi)", "Accessibility service + draw over apps + SMS access (banking trojan trait)", "Trojan-Banker.AndroidOS.Generic")
        else if (a11y && (overlay || sms)) add(w(18), "android-a11y-combo", "Erişilebilirlik hizmeti ile ${if (overlay) "ekran üstü gösterim" else "SMS erişimi"} birlikte isteniyor", "Accessibility service combined with ${if (overlay) "overlay" else "SMS access"}")
        if (sms && has("SEND_SMS") && hidden) add(w(35), "android-sms-hidden", "Gizli simgeli uygulama SMS okuyup gönderebiliyor", "Hidden-icon app can read and send SMS", "Trojan-SMS.AndroidOS.Agent")
        else if (sms && has("SEND_SMS") && has("INTERNET")) add(w(10), "android-sms", "SMS okuma + gönderme + internet erişimi", "Reads and sends SMS with internet access")
        if (admin && (sms || a11y)) add(w(20), "android-admin", "Cihaz yöneticisi yetkisi + hassas erişim (kaldırmayı engelleyebilir)", "Device admin rights + sensitive access (may resist uninstall)", "Trojan.AndroidOS.DeviceAdmin.Gen")
        val surv = SURVEIL.count { has(it) } + (if (notifL) 1 else 0)
        if (surv >= 4 && hidden) add(w(40), "android-stalker", "Gizli simge + kapsamlı izleme izinleri ($surv) — takip yazılımı (stalkerware) izi", "Hidden icon + broad surveillance permissions ($surv) — stalkerware trait", "Monitor.AndroidOS.Stalkerware.Gen")
        else if (surv >= 6) add(w(12), "android-surveil", "Çok sayıda izleme izni ($surv: SMS, arama kaydı, mikrofon, konum…)", "Many surveillance permissions ($surv)")
        if (hidden && !system) add(12, "android-hidden", "Başlatıcı simgesi yok/gizlenmiş — arka planda gizli çalışıyor", "No/hidden launcher icon — runs silently in background")
        if (has("REQUEST_INSTALL_PACKAGES") && dex.contains("dalvik/system/DexClassLoader") && dex.contains("application/vnd.android.package-archive"))
            add(15, "android-dropper", "Başka APK indirip kurabilir + dinamik kod yükleme", "Can install other APKs + dynamic code loading", "Trojan-Dropper.AndroidOS.Agent")
        if (notifL && sms) add(w(15), "android-otp", "Bildirim dinleyici + SMS — tek kullanımlık kod (OTP) yakalama izi", "Notification listener + SMS — OTP interception trait", "Trojan-Spy.AndroidOS.OtpStealer")
        if (live != null) {
            if (live.accessibilityEnabled && (overlay || sms) && !system) add(10, "android-a11y-on", "Erişilebilirlik hizmeti şu anda etkin", "Accessibility service is currently enabled")
            if (live.deviceAdminActive && !system) add(8, "android-admin-on", "Cihaz yöneticisi olarak etkin", "Active as device administrator")
            if (!system && (live.installer == null || live.installer !in TRUSTED_INSTALLERS) && r.isNotEmpty())
                add(5, "android-sideload", "Bilinen bir uygulama mağazası dışından yüklendi (${live.installer ?: "bilinmeyen kaynak"})", "Installed from outside a known store (${live.installer ?: "unknown source"})")
        }
        return r
    }
}
