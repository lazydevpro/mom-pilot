package com.mompilot.tv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the MomPilot server with this TV's own bearer token. */
class RelayClient(private val baseUrl: String, private val token: String) {
    class ApiException(val status: Int, message: String) : Exception(message)

    companion object {
        /**
         * HTTPS anywhere. Plain HTTP only to Tailscale addresses (100.64.0.0/10 or *.ts.net),
         * where Tailscale already encrypts the traffic, or in debug builds.
         */
        fun isAllowed(url: String): Boolean {
            val parsed = try { URL(url) } catch (_: Exception) { return false }
            if (parsed.host.isNullOrBlank() || parsed.userInfo != null || parsed.query != null || parsed.ref != null) return false
            if (!(parsed.path.isEmpty() || parsed.path == "/")) return false
            return when (parsed.protocol) {
                "https" -> true
                "http" -> BuildConfig.DEBUG || isTailscale(parsed.host)
                else -> false
            }
        }

        fun isTailscale(host: String): Boolean {
            if (host.endsWith(".ts.net", ignoreCase = true)) return true
            val parts = host.split('.').map { it.toIntOrNull() ?: return false }
            return parts.size == 4 && parts[0] == 100 && parts[1] in 64..127
        }
    }

    fun request(path: String, body: JSONObject? = null): JSONObject {
        require(isAllowed(baseUrl)) { "Use an https:// address, or your server's Tailscale address." }
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 6000
            connection.readTimeout = 8000
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.setRequestProperty("Accept", "application/json")
            if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: "{}"
            val data = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            if (status !in 200..299) throw ApiException(status, data.optString("message", "The MomPilot server answered $status."))
            return data
        } finally {
            connection.disconnect()
        }
    }
}
