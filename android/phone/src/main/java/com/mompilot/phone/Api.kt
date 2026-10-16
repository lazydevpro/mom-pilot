package com.mompilot.phone

import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class Show(val id: String, val title: String, val app: String, val image: String?)
data class Device(val id: String, val name: String, val appOnline: Boolean, val lastSeenAt: String?, val adbTarget: String?)
data class AdbStatus(val state: String, val awake: Boolean?, val app: String?, val message: String?)
data class Command(val id: String, val title: String?, val app: String, val state: String, val reason: String?, val createdAt: String)
data class Details(val device: Device, val adb: AdbStatus, val commands: List<Command>)
data class NearbyTv(val name: String, val address: String, val adb: Boolean, val added: Boolean)

class ApiException(val status: Int, val code: String?, message: String, val body: JSONObject?) : Exception(message)

val APP_NAMES = mapOf("youtube" to "YouTube", "netflix" to "Netflix", "prime" to "Prime Video", "home" to "Home screen")

/** Talks to the MomPilot server. The session cookie is kept in app-private storage. */
class Api(private val prefs: SharedPreferences) {
    var server: String
        get() = prefs.getString("server", "")!!
        set(value) { prefs.edit().putString("server", value).apply() }
    private var cookie: String
        get() = prefs.getString("cookie", "")!!
        set(value) { prefs.edit().putString("cookie", value).apply() }
    val hasSession: Boolean get() = server.isNotBlank() && cookie.isNotBlank()

    fun signOutLocally() { prefs.edit().remove("cookie").apply() }

    suspend fun get(path: String): JSONObject = call("GET", path, null)
    suspend fun post(path: String, body: JSONObject = JSONObject(), timeoutMs: Int = 15_000): JSONObject = call("POST", path, body, timeoutMs)
    suspend fun patch(path: String, body: JSONObject): JSONObject = call("PATCH", path, body)
    suspend fun delete(path: String): JSONObject = call("DELETE", path, null)

    suspend fun bytes(path: String): ByteArray = withContext(Dispatchers.IO) {
        val connection = open("GET", path, 30_000)
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw failure(status, connection.errorStream?.bufferedReader()?.use { it.readText() })
            connection.inputStream.use { it.readBytes() }
        } catch (error: java.io.IOException) {
            throw unreachable()
        } finally { connection.disconnect() }
    }

    private suspend fun call(method: String, path: String, body: JSONObject?, timeoutMs: Int = 15_000): JSONObject = withContext(Dispatchers.IO) {
        val connection = open(method, path, timeoutMs)
        try {
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = connection.responseCode
            connection.headerFields["Set-Cookie"]?.forEach(::rememberCookie)
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: "{}"
            if (status !in 200..299) throw failure(status, text)
            runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        } catch (error: java.io.IOException) {
            throw unreachable()
        } finally { connection.disconnect() }
    }

    private fun open(method: String, path: String, timeoutMs: Int): HttpURLConnection {
        val connection = URL(server.trimEnd('/') + "/api" + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 8000
        connection.readTimeout = timeoutMs
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/json")
        if (cookie.isNotBlank()) connection.setRequestProperty("Cookie", "$COOKIE=$cookie")
        return connection
    }

    private fun rememberCookie(header: String) {
        val pair = header.substringBefore(';')
        if (!pair.startsWith("$COOKIE=")) return
        val value = pair.removePrefix("$COOKIE=")
        if (value.isBlank() || header.contains("Max-Age=0")) signOutLocally() else cookie = value
    }

    private fun failure(status: Int, text: String?): ApiException {
        val data = runCatching { JSONObject(text ?: "{}") }.getOrDefault(JSONObject())
        return ApiException(status, data.optString("error").ifBlank { null }, data.optString("message").ifBlank { "Something went wrong. Please try again." }, data)
    }

    private fun unreachable() = ApiException(0, "UNREACHABLE", "Can’t reach the MomPilot server. Is Tailscale on?", null)

    companion object {
        private const val COOKIE = "mompilot_session"

        /** Accepts "my-pc.tail1234.ts.net", "https://…" or a Tailscale IP, and returns an origin. */
        fun normalizeServer(input: String): String? {
            var value = input.trim().trimEnd('/')
            if (value.isBlank()) return null
            if (!value.contains("://")) {
                // A bare Tailscale IP means the server's own port; a name means its tailscale serve HTTPS address.
                val ip = Regex("^100\\.\\d+\\.\\d+\\.\\d+(:\\d+)?$").matchEntire(value)
                value = when {
                    ip == null -> "https://$value"
                    ip.groupValues[1].isEmpty() -> "http://$value:8787"
                    else -> "http://$value"
                }
            }
            val url = runCatching { URL(value) }.getOrNull() ?: return null
            if (url.host.isNullOrBlank() || url.protocol !in setOf("https", "http")) return null
            return "${url.protocol}://${url.host}${if (url.port > 0) ":${url.port}" else ""}"
        }
    }
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).ifBlank { null }
private fun JSONObject.flag(key: String): Boolean? = if (!has(key) || isNull(key)) null else optBoolean(key)

fun JSONObject.toShow() = Show(getString("id"), getString("title"), getString("app"), text("image"))
fun JSONObject.toDevice() = Device(getString("id"), getString("name"), optBoolean("appOnline"), text("lastSeenAt"), text("adbTarget"))
fun JSONObject.toAdb() = AdbStatus(optString("state"), flag("awake"), text("app"), text("message"))
fun JSONObject.toCommand() = Command(getString("id"), text("title"), optString("app"), optString("state"), text("reason"), optString("createdAt"))
fun JSONObject.toNearby() = NearbyTv(getString("name"), getString("address"), optBoolean("adb"), optBoolean("added"))
fun JSONObject.toDetails() = Details(
    getJSONObject("device").toDevice(),
    getJSONObject("adb").toAdb(),
    optJSONArray("commands")?.objects()?.map { it.toCommand() } ?: emptyList(),
)
