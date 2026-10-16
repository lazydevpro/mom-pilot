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
    val isConfigured: Boolean get() = endpoint.isNotBlank() && token.isNotBlank()
    var lastAction: String
        get() = prefs.getString("lastAction", "")!!
        set(value) { prefs.edit().putString("lastAction", value).apply() }

    /** Set up from the phone (through ADB): a new server or credential starts with an empty journal. */
    fun configure(endpoint: String, token: String) {
        prefs.edit().clear().putString("endpoint", endpoint).putString("token", token).commit()
    }

    /** Back to the setup screen. */
    fun forget() {
        prefs.edit().clear().commit()
    }

    // Journal entries: id → "" while opening, then "LAUNCHED" or "FAILED:<reason>", and "+" once the server has the result.
    private fun journal(): JSONObject = JSONObject(prefs.getString("journal", "{}")!!)

    private fun saveJournal(entries: JSONObject) {
        // Keep the newest 100 entries; JSONObject keeps insertion order on Android.
        val keys = entries.keys().asSequence().toList()
        keys.take((keys.size - 100).coerceAtLeast(0)).forEach { entries.remove(it) }
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
