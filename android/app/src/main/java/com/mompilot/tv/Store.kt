package com.mompilot.tv

import android.annotation.SuppressLint
import android.content.Context
import org.json.JSONObject

/** App-private settings, the TV credential, and a journal of commands this TV has handled. */
@SuppressLint("ApplySharedPref") // commit() is deliberate: state must be on disk before the TV acts.
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("mompilot", Context.MODE_PRIVATE)

    val endpoint: String get() = prefs.getString("endpoint", "")!!
    val token: String get() = prefs.getString("token", "")!!
    val code: String get() = prefs.getString("code", "")!!
    val codeExpiresAt: Long get() = prefs.getLong("codeExpiresAt", 0)
    var lastAction: String
        get() = prefs.getString("lastAction", "")!!
        set(value) { prefs.edit().putString("lastAction", value).apply() }

    /** Switching servers starts over: new credential, new pairing, empty journal. */
    fun useServer(endpoint: String) {
        prefs.edit().clear().putString("endpoint", endpoint).commit()
    }

    fun forgetDevice() {
        prefs.edit().remove("token").remove("code").remove("codeExpiresAt").remove("journal").commit()
    }

    fun saveRegistration(result: JSONObject) {
        prefs.edit().putString("token", result.getString("token")).commit()
        saveCode(result)
    }

    fun saveCode(result: JSONObject) {
        prefs.edit().putString("code", result.optString("code"))
            .putLong("codeExpiresAt", Iso.parse(result.optString("expiresAt"))).apply()
    }

    // Journal entries: id → "" while opening, then "LAUNCHED" or "FAILED:<reason>", and "+" once the server has the result.
    private fun journal(): JSONObject = JSONObject(prefs.getString("journal", "{}")!!)

    private fun saveJournal(entries: JSONObject) {
        // Keep the newest 100 entries; JSONObject keeps insertion order on Android.
        val keys = entries.keys().asSequence().toList()
        keys.take((keys.size - 100).coerceAtLeast(0)).forEach { entries.remove(it) }
        // commit(), not apply(): a command must be recorded before the TV acts on it.
        prefs.edit().putString("journal", entries.toString()).commit()
    }

    fun isHandled(id: String) = journal().has(id)

    fun markHandling(id: String) = saveJournal(journal().put(id, ""))

    fun setResult(id: String, result: String) = saveJournal(journal().put(id, result))

    fun markReported(id: String) {
        val entries = journal()
        val result = entries.optString(id)
        if (result.isNotEmpty() && !result.endsWith("+")) saveJournal(entries.put(id, "$result+"))
    }

    /** Results the server hasn't confirmed yet, as id → result. */
    fun unreported(): Map<String, String> {
        val entries = journal()
        return entries.keys().asSequence()
            .map { it to entries.optString(it) }
            .filter { (_, result) -> result.isNotEmpty() && !result.endsWith("+") }
            .toMap()
    }
}

object Iso {
    private val format = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
    }

    fun parse(value: String): Long = try { synchronized(format) { format.parse(value)?.time ?: 0 } } catch (_: Exception) { 0 }
}
