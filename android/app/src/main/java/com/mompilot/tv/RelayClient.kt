package com.mompilot.tv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Device-scoped bearer token, never a caregiver cookie or AWS credential. */
class RelayClient(private val baseUrl: String, private val token: String) {
    class ApiException(val status: Int, message: String) : Exception(message)

    fun request(path: String, body: JSONObject? = null): JSONObject {
        val origin = URL(baseUrl)
        require(origin.protocol == "https" || (BuildConfig.DEBUG && origin.protocol == "http")) {
            "A release build requires an HTTPS relay address"
        }
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.instanceFollowRedirects = false
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
            if (status !in 200..299) throw ApiException(status, data.optString("message", "Relay request failed ($status)"))
            return data
        } finally {
            connection.disconnect()
        }
    }
}
