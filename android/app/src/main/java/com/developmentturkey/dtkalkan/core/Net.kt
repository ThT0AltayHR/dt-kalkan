package com.developmentturkey.dtkalkan.core

import com.developmentturkey.dtkalkan.Product
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

object Net {
    fun open(url: String, timeoutMs: Int = 45000, method: String = "GET", headers: Map<String, String> = emptyMap(), body: String? = null): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = minOf(timeoutMs, 15000); c.readTimeout = timeoutMs; c.requestMethod = method
        c.setRequestProperty("User-Agent", "${Product.name}/${Product.version} (Android)")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
        if (c.responseCode !in 200..299) { c.disconnect(); throw IllegalStateException("HTTP ${c.responseCode}") }
        return c
    }
    fun text(url: String, timeoutMs: Int = 45000, method: String = "GET", headers: Map<String, String> = emptyMap(), body: String? = null): String =
        open(url, timeoutMs, method, headers, body).let { c -> try { c.inputStream.bufferedReader().readText() } finally { c.disconnect() } }
    fun <T> stream(url: String, timeoutMs: Int, f: (InputStream) -> T): T = open(url, timeoutMs).let { c -> try { c.inputStream.use(f) } finally { c.disconnect() } }
}
