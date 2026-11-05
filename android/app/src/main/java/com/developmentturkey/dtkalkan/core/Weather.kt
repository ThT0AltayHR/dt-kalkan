package com.developmentturkey.dtkalkan.core

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import org.json.JSONObject
import java.util.Locale

/** Weather for the notch: device location (if granted) or IP geolocation → Open-Meteo. */
class Weather(private val ctx: Context) {
    private var cache: JSONObject? = null
    private var loc: Triple<Double, Double, Pair<String, String>>? = null

    @SuppressLint("MissingPermission")
    private fun deviceLocation(): Triple<Double, Double, Pair<String, String>>? {
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null
        val lm = ctx.getSystemService(LocationManager::class.java) ?: return null
        val l = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
            .mapNotNull { p -> try { lm.getLastKnownLocation(p) } catch (e: Exception) { null } }.maxByOrNull { it.time } ?: return null
        var city = ""; var country = ""
        try {
            @Suppress("DEPRECATION")
            val a = Geocoder(ctx, Locale("tr", "TR")).getFromLocation(l.latitude, l.longitude, 1)?.firstOrNull()
            if (a != null) { city = a.locality ?: a.subAdminArea ?: a.adminArea ?: ""; country = a.countryName ?: "" }
        } catch (_: Exception) { }
        return Triple(l.latitude, l.longitude, city to country)
    }
    private fun ipLocation(): Triple<Double, Double, Pair<String, String>>? {
        try { val j = JSONObject(Net.text("https://ipapi.co/json/", 8000)); if (j.has("latitude")) return Triple(j.getDouble("latitude"), j.getDouble("longitude"), j.optString("city") to j.optString("country_name")) } catch (_: Exception) { }
        try { val j = JSONObject(Net.text("http://ip-api.com/json/?fields=status,lat,lon,city,country", 8000)); if (j.optString("status") == "success") return Triple(j.getDouble("lat"), j.getDouble("lon"), j.optString("city") to j.optString("country")) } catch (_: Exception) { }
        return null
    }

    @Synchronized
    fun get(settings: JSONObject, force: Boolean): JSONObject? {
        val notch = settings.optJSONObject("notch") ?: return null
        val perms = settings.optJSONObject("permissions")
        if (!notch.optBoolean("weather", true) || perms?.opt("location") == false) return null
        val c = cache
        if (!force && c != null && System.currentTimeMillis() - c.optLong("at") < 30 * 60000) return c
        return try {
            var l = loc
            if (l == null || force) { l = deviceLocation() ?: ipLocation(); if (l != null && l.third.first.isEmpty()) ipLocation()?.let { ip -> l = Triple(l!!.first, l!!.second, ip.third) }; loc = l }
            val L = l ?: throw IllegalStateException("NO_LOCATION")
            val unit = if (notch.optString("units") == "f") "&temperature_unit=fahrenheit" else ""
            val url = "https://api.open-meteo.com/v1/forecast?latitude=${L.first}&longitude=${L.second}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=1$unit"
            val w = JSONObject(Net.text(url, 10000))
            val cur = w.getJSONObject("current"); val d = w.getJSONObject("daily")
            JSONObject().put("at", System.currentTimeMillis()).put("city", L.third.first).put("country", L.third.second).put("unit", notch.optString("units", "c"))
                .put("temp", cur.optDouble("temperature_2m")).put("feels", cur.optDouble("apparent_temperature")).put("code", cur.optInt("weather_code")).put("isDay", cur.optInt("is_day"))
                .put("wind", cur.optDouble("wind_speed_10m")).put("humidity", cur.optDouble("relative_humidity_2m"))
                .put("max", d.getJSONArray("temperature_2m_max").optDouble(0)).put("min", d.getJSONArray("temperature_2m_min").optDouble(0))
                .put("sunrise", d.getJSONArray("sunrise").optString(0)).put("sunset", d.getJSONArray("sunset").optString(0))
                .also { cache = it }
        } catch (e: Exception) { cache }
    }
}
