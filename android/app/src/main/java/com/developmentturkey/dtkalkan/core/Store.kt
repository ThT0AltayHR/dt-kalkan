package com.developmentturkey.dtkalkan.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object Js {
    fun merge(base: JSONObject, over: JSONObject?): JSONObject {
        val out = JSONObject(base.toString())
        if (over == null) return out
        for (k in over.keys()) {
            if (k == "__proto__" || k == "constructor") continue
            val b = out.opt(k); val o = over.opt(k)
            out.put(k, if (b is JSONObject && o is JSONObject) merge(b, o) else o)
        }
        return out
    }
    fun get(o: JSONObject, path: String): Any? { var cur: Any? = o; for (p in path.split('.')) cur = (cur as? JSONObject)?.opt(p); return cur }
    fun strList(a: JSONArray?): List<String> = if (a == null) emptyList() else (0 until a.length()).map { a.optString(it) }
    fun arr(l: Collection<Any?>) = JSONArray().also { a -> l.forEach { a.put(it) } }
    fun writeAtomic(f: File, text: String) { f.parentFile?.mkdirs(); val t = File(f.path + ".tmp"); t.writeText(text); if (!t.renameTo(f)) { f.delete(); t.renameTo(f) } }
    fun read(f: File): String? = try { f.readText() } catch (e: Exception) { null }
}

object Defaults {
    val WATCH_EXT = listOf("exe", "dll", "scr", "com", "pif", "msi", "bat", "cmd", "ps1", "vbs", "vbe", "js", "jse", "wsf", "hta", "lnk", "zip", "jar", "docm", "xlsm", "doc", "xls", "iso", "img",
        "apk", "apks", "xapk", "apkm", "dex")
    val SCAN_EXT = WATCH_EXT + listOf("sys", "ocx", "cpl", "py", "php", "reg", "pptm", "rtf", "txt", "html", "htm", "sh", "so", "pdf")

    fun json(): JSONObject = JSONObject("""
    {
      "lang": "tr", "onboarded": false,
      "permissions": { "storage": null, "notifications": null, "location": null, "overlay": null, "background": null, "apps": null },
      "general": { "startup": true, "keepRunning": true, "startMinimized": false, "trayHintShown": false },
      "protection": { "realtime": true, "defaultFolders": true, "folders": [], "autoQuarantine": true, "scanNewApps": true, "watchExtensions": ${Js.arr(WATCH_EXT)} },
      "scan": {
        "schedule": { "enabled": true, "frequency": "daily", "time": "13:00", "weekday": 1, "customHours": 6, "type": "quick", "lastRun": 0 },
        "fileTypes": "smart", "extensions": ${Js.arr(SCAN_EXT)}, "archiveDepth": 2, "heuristics": "normal", "heuristicsEnabled": true,
        "maxFileMB": 48, "skipLarge": true, "exclusions": [], "includeSystemApps": false
      },
      "notch": { "enabled": true, "style": "notch", "position": "center", "weather": true, "units": "c", "clock24": true, "showProgress": true, "hoverExpand": true },
      "notifications": { "enabled": true, "scanDone": true, "threats": true, "quarantine": true, "updates": true, "duration": 6 },
      "sound": { "enabled": true, "volume": 0.6, "pack": "soft", "events": { "scan": true, "threat": true, "notch": true, "ui": true } },
      "appearance": { "accent": "mint", "animations": true, "compact": false },
      "quarantine": { "retentionDays": 0 },
      "updates": { "auto": true, "frequency": "daily", "lastCheck": 0, "lastResult": null, "mbAuthKey": "" },
      "allowlist": [],
      "stats": { "threatsBlocked": 0, "filesScanned": 0, "lastScan": null, "realtimeScanned": 0, "installedAt": 0, "appsScanned": 0 }
    }""")
}

/** Settings store (desktop JsonStore equivalent). */
class Store(private val file: File) {
    @Volatile var data: JSONObject = Js.merge(Defaults.json(), Js.read(file)?.let { try { JSONObject(it) } catch (e: Exception) { null } })
        private set
    @Synchronized fun patch(p: JSONObject?): JSONObject { data = Js.merge(data, p); save(); return data }
    @Synchronized fun set(d: JSONObject) { data = d; save() }
    @Synchronized fun save() { try { Js.writeAtomic(file, data.toString(1)) } catch (_: Exception) { } }
}
