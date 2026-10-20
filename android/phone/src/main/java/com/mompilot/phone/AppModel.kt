package com.mompilot.phone

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

enum class Stage { LOADING, WELCOME, READY }
enum class Tab { SHOWS, REMOTE, TV }

data class Notice(val text: String, val bad: Boolean = false, val action: String? = null, val id: Long = System.nanoTime())
data class Draft(val title: String = "", val link: String = "")
data class TvSetup(val working: Boolean, val message: String, val failed: Boolean = false)
data class LinkCode(val code: String, val qr: String)

/** Everything the screens show, and every action they can take. */
class AppModel(application: Application) : AndroidViewModel(application) {
    val api = Api(application.getSharedPreferences("mompilot", Context.MODE_PRIVATE))
    private val prefs = application.getSharedPreferences("mompilot", Context.MODE_PRIVATE)

    var stage by mutableStateOf(Stage.LOADING); private set
    var tab by mutableStateOf(Tab.SHOWS)
    var name by mutableStateOf(""); private set
    var shows by mutableStateOf(emptyList<Show>()); private set
    var devices by mutableStateOf(emptyList<Device>()); private set
    var details by mutableStateOf<Details?>(null); private set
    var offline by mutableStateOf<String?>(null); private set
    var notice by mutableStateOf<Notice?>(null)
    var busyShowId by mutableStateOf<String?>(null); private set
    var draft by mutableStateOf<Draft?>(null)
    var nearby by mutableStateOf<List<NearbyTv>?>(null); private set
    var tvSetup by mutableStateOf<TvSetup?>(null); private set
    var snapshot by mutableStateOf<ByteArray?>(null); private set
    var snapshotState by mutableStateOf<String?>(null); private set
    var linkCode by mutableStateOf<LinkCode?>(null); private set
    var pendingTvLink by mutableStateOf<Uri?>(null)

    private var polling: Job? = null
    private var ticks = 0
    private val keys = Mutex()
    private var selectedId: String
        get() = prefs.getString("tv", "")!!
        set(value) { prefs.edit().putString("tv", value).apply() }

    init { boot() }

    private fun boot() = viewModelScope.launch {
        if (!api.hasSession) { stage = Stage.WELCOME; return@launch }
        try {
            name = api.get("/session").getJSONObject("caregiver").getString("name")
            stage = Stage.READY
            refresh(); loadShows()
            pendingTvLink?.let { handleLink(it) }
        } catch (error: ApiException) {
            if (error.status == 401) { api.signOutLocally(); stage = Stage.WELCOME }
            else { stage = Stage.READY; offline = error.message }
        }
    }

    // —— Signing in ——

    fun start(server: String, yourName: String, done: (String?) -> Unit) = viewModelScope.launch {
        val origin = Api.normalizeServer(server) ?: return@launch done("Enter the server address, for example my-pc.tail1234.ts.net.")
        api.server = origin
        try { signedIn(api.post("/session", JSONObject().put("name", yourName))); done(null) }
        catch (error: ApiException) { done(error.message) }
    }

    /** First run: create the account, then (if a TV code was scanned) set that TV up straight away. */
    fun startWithTv(server: String, yourName: String, tv: Uri?, done: (String?) -> Unit) {
        if (tv != null) pendingTvLink = tv
        start(server, yourName) { problem -> if (problem != null) pendingTvLink = null; done(problem) }
    }

    fun join(server: String, code: String, done: (String?) -> Unit) = viewModelScope.launch {
        val origin = Api.normalizeServer(server) ?: return@launch done("That code isn’t from MomPilot.")
        api.server = origin
        try { signedIn(api.post("/session/join", JSONObject().put("code", code))); done(null) }
        catch (error: ApiException) { done(error.message) }
    }

    private suspend fun signedIn(result: JSONObject) {
        name = result.getJSONObject("caregiver").getString("name")
        stage = Stage.READY
        refresh(); loadShows()
        pendingTvLink?.let { handleLink(it) }
    }

    fun signOut() = viewModelScope.launch {
        runCatching { api.delete("/session") }
        api.signOutLocally()
        shows = emptyList(); devices = emptyList(); details = null
        stage = Stage.WELCOME
    }

    fun rename(newName: String) = viewModelScope.launch {
        try { name = api.post("/session", JSONObject().put("name", newName)).getJSONObject("caregiver").getString("name"); say("Saved.") }
        catch (error: ApiException) { say(error.message, bad = true) }
    }

    /** mompilot://join?server=…&code=… (another phone) or mompilot://tv?address=…&name=… (a TV's setup screen). */
    fun handleLink(uri: Uri) {
        when (uri.host) {
            "join" -> {
                if (stage == Stage.READY) { say("This phone is already signed in.") ; return }
                join(uri.getQueryParameter("server").orEmpty(), uri.getQueryParameter("code").orEmpty()) { error -> if (error != null) say(error, bad = true) }
            }
            "tv" -> {
                if (stage != Stage.READY) { pendingTvLink = uri; return }
                pendingTvLink = null
                tab = Tab.TV
                setupTv(uri.getQueryParameter("address").orEmpty(), uri.getQueryParameter("name"))
            }
        }
    }

    // —— Keeping up to date ——

    fun startPolling() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (isActive) {
                if (stage == Stage.READY) {
                    refresh()
                    // Shows can change on your other phone.
                    if (ticks++ % 10 == 0) loadShows(quiet = true)
                }
                delay(3000)
            }
        }
    }

    fun stopPolling() { polling?.cancel(); polling = null }

    suspend fun refresh() {
        try {
            val list = api.get("/devices").getJSONArray("devices").objects().map { it.toDevice() }
            devices = list
            val selected = list.firstOrNull { it.id == selectedId } ?: list.firstOrNull()
            details = selected?.let { api.get("/devices/${it.id}").toDetails() }
            offline = null
        } catch (error: ApiException) {
            if (error.status == 401) { api.signOutLocally(); stage = Stage.WELCOME } else offline = error.message
        }
    }

    private suspend fun loadShows(quiet: Boolean = false) {
        try { shows = api.get("/shows").getJSONArray("shows").objects().map { it.toShow() } }
        catch (error: ApiException) { if (!quiet) say(error.message, bad = true) }
    }

    fun chooseTv(id: String) { selectedId = id; viewModelScope.launch { refresh() } }

    // —— Shows ——

    fun saveShow(title: String, link: String, done: (String?) -> Unit) = viewModelScope.launch {
        try {
            val show = api.post("/shows", JSONObject().put("title", title).put("link", link), timeoutMs = 30_000).getJSONObject("show").toShow()
            shows = shows + show
            draft = null
            say("Saved ${show.title}.")
            done(null)
        } catch (error: ApiException) { done(error.message) }
    }

    fun deleteShow(show: Show) = viewModelScope.launch {
        try { api.delete("/shows/${show.id}"); shows = shows.filterNot { it.id == show.id } }
        catch (error: ApiException) { say(error.message, bad = true) }
    }

    fun play(show: Show) {
        busyShowId = show.id
        open(JSONObject().put("type", "OPEN_SHOW").put("showId", show.id), show.title, show.app, isShow = true)
    }

    fun openApp(app: String) = open(JSONObject().put("type", "OPEN_APP").put("app", app), APP_NAMES[app] ?: app, app, isShow = false)

    private fun open(body: JSONObject, label: String, app: String, isShow: Boolean) = viewModelScope.launch {
        val tv = details?.device
        if (tv == null) { busyShowId = null; tab = Tab.TV; say("Add Mom’s TV first.", bad = true); return@launch }
        try {
            val command = api.post("/devices/${tv.id}/commands", body.put("idempotencyKey", UUID.randomUUID().toString())).getJSONObject("command")
            val hint = when {
                !isShow -> ""
                app == "netflix" -> " If Netflix asks who’s watching, press OK on the remote."
                else -> ""
            }
            val where = if (command.optString("via") == "adb") "Opening $label on ${tv.name}." else "Sent $label to the MomPilot app on ${tv.name}."
            say(where + hint, action = "Remote")
        } catch (error: ApiException) {
            say(error.body?.optJSONObject("command")?.optString("reason")?.ifBlank { null } ?: error.message, bad = true)
        } finally {
            busyShowId = null
            refresh()
        }
    }

    // —— Remote ——

    /** Keys go one after another so fast taps arrive in order. */
    fun press(key: String) = viewModelScope.launch {
        val tv = details?.device ?: return@launch
        keys.withLock {
            try { api.post("/devices/${tv.id}/commands", if (key == "wake") JSONObject().put("type", "WAKE") else JSONObject().put("type", "KEY").put("key", key)) }
            catch (error: ApiException) { say(error.message, bad = true) }
        }
    }

    fun takeSnapshot() = viewModelScope.launch {
        val tv = details?.device ?: return@launch
        snapshotState = "loading"
        try { snapshot = api.bytes("/devices/${tv.id}/snapshot"); snapshotState = null }
        catch (error: ApiException) { snapshotState = error.message }
    }

    // —— TVs ——

    fun findTvs() = viewModelScope.launch {
        nearby = null
        try { nearby = api.get("/tvs/nearby").getJSONArray("tvs").objects().map { it.toNearby() } }
        catch (error: ApiException) { nearby = emptyList(); say(error.message, bad = true) }
    }

    /** Sets a TV up through the server, waiting while the TV shows "Allow USB debugging?". */
    fun setupTv(address: String, tvName: String?) = viewModelScope.launch {
        tvSetup = TvSetup(true, "Connecting to the TV…")
        val body = JSONObject().put("address", address).put("serverUrl", api.server)
        if (!tvName.isNullOrBlank()) body.put("name", tvName.take(60))
        val deadline = System.currentTimeMillis() + 120_000
        while (true) {
            try {
                val device = api.post("/tvs/setup", body, timeoutMs = 150_000).getJSONObject("device").toDevice()
                selectedId = device.id
                tvSetup = null
                nearby = null
                say("${device.name} is ready.")
                refresh()
                return@launch
            } catch (error: ApiException) {
                if (error.code == "ADB_UNAUTHORIZED" && System.currentTimeMillis() < deadline) {
                    tvSetup = TvSetup(true, "On the TV: tick “Always allow from this computer”, then press Allow.")
                    delay(3000)
                    continue
                }
                tvSetup = TvSetup(false, error.message ?: "Couldn’t set up the TV.", failed = true)
                return@launch
            }
        }
    }

    fun dismissSetup() { tvSetup = null }

    fun saveTv(device: Device, newName: String, address: String) = viewModelScope.launch {
        try {
            api.patch("/devices/${device.id}", JSONObject().put("name", newName).put("adbTarget", address.trim().ifBlank { JSONObject.NULL }))
            say("Saved.")
            refresh()
        } catch (error: ApiException) { say(error.message, bad = true) }
    }

    fun makeLinkCode() = viewModelScope.launch {
        try {
            val code = api.post("/session/link").getString("code")
            val qr = Uri.Builder().scheme("mompilot").authority("join")
                .appendQueryParameter("server", api.server).appendQueryParameter("code", code).build().toString()
            linkCode = LinkCode(code, qr)
        } catch (error: ApiException) { say(error.message, bad = true) }
    }

    fun say(text: String?, bad: Boolean = false, action: String? = null) { notice = Notice(text ?: "", bad, action) }
}
