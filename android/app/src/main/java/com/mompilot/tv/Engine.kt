package com.mompilot.tv

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

enum class Phase { NEEDS_SERVER, CONNECTING, UNPAIRED, PAIRED, OFFLINE }

data class TvState(
    val phase: Phase,
    val caregiver: String? = null,
    val code: String = "",
    val lastAction: String = "",
    val message: String? = null,
)

/**
 * Keeps this TV registered and paired, polls the server for shows to open, opens them and reports back.
 * All work runs on one background thread; listeners are called on the main thread.
 * It holds only the application context, which lives as long as the process.
 */
@SuppressLint("StaticFieldLeak")
object Engine {
    private const val POLL_MS = 3000L
    private const val MAX_BACKOFF_MS = 30_000L

    private lateinit var context: Context
    private lateinit var store: Store
    private val worker = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "mompilot-engine").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<(TvState) -> Unit>()
    private var next: ScheduledFuture<*>? = null
    private var started = false
    private var failures = 0

    /** True while the MomPilot screen is showing; the pairing code is only refreshed then. */
    @Volatile var visible = false

    @Volatile var state = TvState(Phase.CONNECTING)
        private set

    fun start(appContext: Context) {
        if (!::context.isInitialized) {
            context = appContext.applicationContext
            store = Store(context)
        }
        worker.execute {
            if (!started) { started = true; schedule(0) }
        }
    }

    fun listen(listener: (TvState) -> Unit) { listeners += listener; listener(state) }
    fun unlisten(listener: (TvState) -> Unit) { listeners -= listener }

    fun pollNow() = worker.execute { if (started) schedule(0) }

    fun serverAddress(): String = if (::store.isInitialized) store.endpoint else ""

    fun useServer(endpoint: String) = worker.execute {
        store.useServer(endpoint)
        publish(TvState(Phase.CONNECTING))
        schedule(0)
    }

    fun refreshCode() = worker.execute {
        guarded { store.saveCode(client().request("/api/tv/pairing", JSONObject())) }
        schedule(0)
    }

    fun disconnect() = worker.execute {
        guarded {
            store.saveCode(client().request("/api/tv/revoke", JSONObject()))
            store.lastAction = ""
        }
        schedule(0)
    }

    private fun client() = RelayClient(store.endpoint, store.token)

    private fun schedule(delayMs: Long) {
        next?.cancel(false)
        next = worker.schedule({ tick() }, delayMs, TimeUnit.MILLISECONDS)
    }

    private fun tick() {
        val delay = try {
            step()
            failures = 0
            POLL_MS
        } catch (error: Exception) {
            failures++
            onError(error)
            (POLL_MS shl failures.coerceAtMost(4)).coerceAtMost(MAX_BACKOFF_MS)
        }
        schedule(delay)
    }

    private fun step() {
        if (store.endpoint.isBlank()) { publish(TvState(Phase.NEEDS_SERVER)); return }
        if (store.token.isBlank()) {
            store.saveRegistration(RelayClient(store.endpoint, "").request("/api/tv/register", JSONObject()))
        }
        val api = client()
        report(api)
        val result = api.request("/api/tv/commands")
        val device = result.getJSONObject("device")
        val paired = device.optBoolean("paired")
        if (!paired && visible && store.codeExpiresAt <= System.currentTimeMillis() + 5000) {
            store.saveCode(api.request("/api/tv/pairing", JSONObject()))
        }
        val caregiver = device.optJSONObject("caregiver")?.optString("name")
        publish(TvState(if (paired) Phase.PAIRED else Phase.UNPAIRED, caregiver, store.code, store.lastAction))
        if (!paired) return
        val commands = result.optJSONArray("commands") ?: return
        for (index in 0 until commands.length()) handle(api, commands.getJSONObject(index))
    }

    private fun handle(api: RelayClient, command: JSONObject) {
        val id = command.getString("id")
        // A command is opened at most once, even if the app restarts or a report is lost.
        if (store.isHandled(id)) return
        store.markHandling(id)
        runCatching { api.request("/api/tv/ack", JSONObject().put("id", id).put("state", "RECEIVED")) }
        val launch = command.optJSONObject("launch")
        val problem = if (launch == null) "This request had nothing to open." else Launcher.open(context, launch, visible)
        val title = command.optString("title").ifBlank { Launcher.PACKAGES[launch?.optString("package")] ?: "your show" }
        store.setResult(id, if (problem == null) "LAUNCHED" else "FAILED:$problem")
        store.lastAction = if (problem == null) "Opened $title" else "Couldn't open $title"
        report(api)
    }

    /** Sends results the server hasn't confirmed; retried on every poll until it has. */
    private fun report(api: RelayClient) {
        for ((id, result) in store.unreported()) {
            val body = JSONObject().put("id", id)
            if (result.startsWith("FAILED:")) body.put("state", "FAILED").put("reason", result.removePrefix("FAILED:").take(300))
            else body.put("state", "LAUNCHED")
            try {
                api.request("/api/tv/ack", body)
                store.markReported(id)
            } catch (error: RelayClient.ApiException) {
                // Expired or unknown on the server: nothing more to report.
                if (error.status == 404 || error.status == 409) store.markReported(id) else throw error
            }
        }
    }

    private fun guarded(work: () -> Unit) {
        try { work() } catch (error: Exception) { onError(error) }
    }

    private fun onError(error: Exception) {
        if (error is RelayClient.ApiException && error.status == 401) {
            // The server no longer knows this TV (for example, its data was reset). Register again.
            store.forgetDevice()
            publish(TvState(Phase.CONNECTING, message = "Reconnecting to MomPilot…"))
            return
        }
        val message = when (error) {
            is RelayClient.ApiException -> error.message
            is IllegalArgumentException -> error.message
            else -> "Can't reach the MomPilot server. Check the TV's internet and Tailscale."
        }
        publish(state.copy(phase = if (store.endpoint.isBlank()) Phase.NEEDS_SERVER else Phase.OFFLINE, message = message))
    }

    private fun publish(next: TvState) {
        state = next
        main.post { listeners.forEach { it(next) } }
    }
}
