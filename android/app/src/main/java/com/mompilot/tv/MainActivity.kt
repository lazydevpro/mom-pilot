package com.mompilot.tv

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.VideoView
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/** Foreground-only prototype. No services, external-player inspection, or input injection. */
class MainActivity : Activity() {
    private companion object {
        const val YOUTUBE_TV_PACKAGE = "com.google.android.youtube.tv"
        const val YOUTUBE_BUNNY_URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
    }

    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val imageWorker = Executors.newFixedThreadPool(2)
    private val prefs by lazy { getSharedPreferences("mompilot_private", MODE_PRIVATE) }
    private val ink = Color.rgb(31, 47, 42)
    private val green = Color.rgb(33, 93, 78)
    private val cream = Color.rgb(245, 241, 232)
    private lateinit var root: FrameLayout
    private lateinit var page: LinearLayout
    private lateinit var statusLabel: TextView
    private var pairingCodeLabel: TextView? = null
    private var video: VideoView? = null
    private var playerLabel: TextView? = null
    private var playerAccessLabel: TextView? = null
    private var playerArtwork: ImageView? = null
    private var messageDialog: AlertDialog? = null
    private var catalog = listOf<JSONObject>()
    private var presets = mapOf<String, String>()
    private var device: JSONObject? = null
    @Volatile private var foreground = false
    private var foregroundGeneration = 0
    @Volatile private var handoffCommandId: String? = null
    private var handoffLaunched = false
    private var experimentNotice: String? = null
    private var experimentNoticeLabel: TextView? = null
    private var polling = false
    private var epoch = 0
    private var screen = "home"
    private var connection = "Connecting to your family…"
    private var quiet = false
    private var blockedLocally = false
    private var currentItem: JSONObject? = null
    private var playbackState = "IDLE"
    private var resumePosition = 0
    private var prepared = false
    private var playRequest = 0
    private var playbackAttempt = 0
    private var pendingPlaybackCommand: JSONObject? = null
    private val seen = linkedMapOf<String, String>()
    private val pendingAcks = linkedMapOf<String, JSONObject>()

    private val tick = object : Runnable {
        override fun run() {
            if (!foreground || handoffCommandId != null) return
            poll()
            if (foreground && handoffCommandId == null) main.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        quiet = prefs.getBoolean("quiet", false)
        blockedLocally = prefs.getBoolean("blockedLocally", false)
        readJournal()
        experimentNotice = prefs.getString("youtubeNotice", null)
        if (pendingAcks.values.any { it.optString("state") == "LAUNCHED" }) {
            experimentNotice = "Previous YouTube launch result is unconfirmed. MomPilot will not open it again automatically."
        }
        root = FrameLayout(this)
        root.setBackgroundColor(cream)
        setContentView(root)
        showHome()
    }

    override fun onResume() {
        super.onResume()
        handoffCommandId = null
        handoffLaunched = false
        foreground = true
        main.removeCallbacks(tick)
        main.post(tick)
    }

    override fun onPause() {
        foreground = false
        ++foregroundGeneration
        main.removeCallbacks(tick)
        cancelPendingPlayback("MomPilot was closed before playback started")
        pauseLocal()
        // The LAUNCHED acknowledgment already includes the offline transition atomically.
        // A separate earlier heartbeat would invalidate the launch before it is acknowledged.
        if (!handoffLaunched) heartbeat(false)
        super.onPause()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        video?.stopPlayback()
        messageDialog?.dismiss()
        worker.shutdown()
        imageWorker.shutdownNow()
        super.onDestroy()
    }

    private fun client() = RelayClient(
        prefs.getString("endpoint", "http://10.0.2.2:8787")!!,
        prefs.getString("token", "")!!
    )

    private fun network(
        work: () -> JSONObject,
        success: (JSONObject) -> Unit,
        failure: (Exception) -> Unit = { error ->
            connection = error.message ?: "Relay unavailable. Check the connection in Settings."
            updateStatus()
        }
    ) {
        val requestEpoch = epoch
        worker.execute {
            try {
                val result = work()
                main.post { if (!isDestroyed && epoch == requestEpoch) success(result) }
            } catch (error: Exception) {
                main.post { if (!isDestroyed && epoch == requestEpoch) failure(error) }
            }
        }
    }

    private fun poll() {
        if (polling || !foreground || handoffCommandId != null) return
        polling = true
        val pollGeneration = foregroundGeneration
        val api = client()
        val needsRegistration = prefs.getString("token", "").isNullOrBlank()
        val needsCatalog = catalog.isEmpty()
        val report = heartbeatBody(true)
        val acks = pendingAcks.values.map { JSONObject(it.toString()) }
        network({
            if (needsRegistration) {
                JSONObject().put("registration", api.request("/api/tv/register", JSONObject()))
            } else {
                val acknowledged = JSONArray()
                for (ack in acks) {
                    try {
                        api.request("/api/tv/ack", ack)
                        acknowledged.put(ack)
                    } catch (error: RelayClient.ApiException) {
                        // An expired/terminal command cannot be changed, and must never replay.
                        if (error.status == 404 || error.status == 409) {
                            acknowledged.put(JSONObject(ack.toString()).put("unconfirmed", true))
                        } else throw error
                    }
                }
                val list = if (needsCatalog) api.request("/api/catalog") else null
                api.request("/api/tv/heartbeat", report)
                val result = api.request("/api/tv/commands")
                result.put("acknowledged", acknowledged)
                if (list != null) result.put("catalog", list)
                result
            }
        }, { result ->
            polling = false
            result.optJSONObject("registration")?.let { registration ->
                prefs.edit().putString("deviceId", registration.getString("deviceId"))
                    .putString("token", registration.getString("token")).apply()
                savePairing(registration)
                showHome()
                if (foreground) poll()
                else heartbeat(false)
                return@network
            }
            val acknowledged = result.optJSONArray("acknowledged") ?: JSONArray()
            for (index in 0 until acknowledged.length()) {
                val ack = acknowledged.getJSONObject(index)
                val id = ack.getString("id")
                if (pendingAcks[id]?.optString("state") == ack.optString("state")) pendingAcks.remove(id)
                if (ack.optString("state") == "LAUNCHED") updateLaunchNotice(!ack.optBoolean("unconfirmed"))
            }
            result.optJSONObject("catalog")?.let { list ->
                val items = list.getJSONArray("items")
                catalog = (0 until items.length()).map { items.getJSONObject(it) }
                val messages = list.getJSONArray("presets")
                presets = (0 until messages.length()).associate {
                    val message = messages.getJSONObject(it)
                    message.getString("id") to message.getString("text")
                }
            }
            val previousCaregiver = device?.optJSONObject("caregiver")?.optString("id")
            device = result.getJSONObject("device")
            if (!blockedLocally) quiet = device!!.optBoolean("quiet")
            val caregiver = device?.optJSONObject("caregiver")
            if (device!!.optBoolean("paired")) {
                connection = if (blockedLocally) "Family requests blocked on this TV · Check Settings"
                    else if (quiet) "Quiet mode · Family requests are paused" else "Connected · ${caregiver?.optString("name", "Family")} can help"
            } else connection = "Ready to pair with someone you trust"
            if (previousCaregiver != caregiver?.optString("id") && screen != "player") showHome()
            updateStatus()
            saveJournal()
            if (foreground && handoffCommandId == null && pollGeneration == foregroundGeneration) {
                val commands = result.optJSONArray("commands") ?: JSONArray()
                for (index in 0 until commands.length()) accept(commands.getJSONObject(index))
            }
        }, { error ->
            polling = false
            connection = "Connection interrupted · Open Settings to check the relay"
            if (pendingAcks.values.any { it.optString("state") == "LAUNCHED" }) updateLaunchNotice(false)
            if (error is RelayClient.ApiException && error.status == 401) {
                prefs.edit().remove("token").remove("deviceId").apply()
                device = null
                connection = "Device session ended · Reconnecting for a new pairing code"
            }
            updateStatus()
        })
    }

    private fun accept(command: JSONObject) {
        val id = command.optString("id")
        if (id.isBlank() || seen.containsKey(id)) return
        if (command.optString("deviceId") != prefs.getString("deviceId", "")) return
        if (expired(command)) {
            finishCommand(command, "FAILED", "Command expired before delivery")
            return
        }
        if (!foreground || handoffCommandId != null || quiet || blockedLocally || device?.optBoolean("paired") != true) {
            finishCommand(command, "FAILED", "TV is not accepting family requests")
            return
        }
        seen[id] = "RECEIVED"
        saveJournal() // Persist before executing to prevent replay after process death.
        val commandGeneration = foregroundGeneration
        if (command.optString("type") == "OPEN_YOUTUBE") {
            // Reserve this transition before accepting the rest of the same poll batch.
            handoffCommandId = id
            main.removeCallbacks(tick)
        }
        val api = client()
        val receipt = JSONObject().put("id", id).put("state", "RECEIVED")
        network({ api.request("/api/tv/ack", receipt) }, {
            if (!foreground || commandGeneration != foregroundGeneration || (handoffCommandId != null && handoffCommandId != id) || quiet || blockedLocally || expired(command)) {
                finishCommand(command, "FAILED", "TV became unavailable or command expired")
                clearUnlaunchedHandoff(id)
            } else execute(command)
        }, {
            finishCommand(command, "FAILED", "Could not confirm receipt; please send again")
            clearUnlaunchedHandoff(id)
        })
    }

    private fun execute(command: JSONObject) {
        when (command.optString("type")) {
            "OPEN_YOUTUBE" -> openYouTubeExperiment(command)
            "PLAY_CATALOG_ITEM" -> {
                val item = catalog.find { it.optString("id") == command.optString("itemId") }
                if (item == null) finishCommand(command, "FAILED", "This title is not in the approved catalog")
                else playItem(item, command)
            }
            "SHOW_MESSAGE" -> {
                val text = presets[command.optString("messageId")]
                if (text == null) finishCommand(command, "FAILED", "Unknown message preset") else {
                    messageDialog?.dismiss()
                    messageDialog = AlertDialog.Builder(this)
                        .setTitle("A little note from ${device?.optJSONObject("caregiver")?.optString("name", "your family")}")
                        .setMessage(text).setPositiveButton("Thank you · Dismiss") { _, _ -> }
                        .create().also { dialog ->
                            dialog.setOnShowListener {
                                dialog.findViewById<TextView>(android.R.id.message)?.textSize = 28f
                                dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply { textSize = 21f; requestFocus() }
                            }
                            dialog.show()
                        }
                    finishCommand(command, "DISPLAYED")
                }
            }
            "PAUSE" -> {
                if (!prepared || video == null) finishCommand(command, "FAILED", "No video is ready to pause")
                else {
                    cancelPendingPlayback("Playback was paused before it started")
                    pauseLocal()
                    finishCommand(command, "PAUSED")
                    heartbeat()
                }
            }
            "RESUME" -> {
                if (!prepared || video == null) finishCommand(command, "FAILED", "Open a video before resuming")
                else {
                    cancelPendingPlayback("Replaced by a newer playback request")
                    pendingPlaybackCommand = command
                    resumeLocal()
                }
            }
            else -> finishCommand(command, "FAILED", "Unsupported command")
        }
    }

    private fun openYouTubeExperiment(command: JSONObject) {
        val id = command.getString("id")
        if (command.optString("itemId") != "bunny") {
            finishCommand(command, "FAILED", "Only the approved Big Buck Bunny YouTube experiment is supported")
            clearUnlaunchedHandoff(id)
            return
        }
        // This experiment intentionally supports one known Android TV package and one video.
        // No URI, package name, extras, or intent flags are taken from the command.
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(YOUTUBE_BUNNY_URL))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setPackage(YOUTUBE_TV_PACKAGE)
        val target = try {
            packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        } catch (_: SecurityException) {
            failYouTubeLaunch(command, "This TV blocked access to the YouTube experiment")
            return
        }
        if (target?.activityInfo?.packageName != YOUTUBE_TV_PACKAGE) {
            failYouTubeLaunch(command, "The supported YouTube app is not installed or cannot open this link on this TV")
            return
        }
        if (!foreground || quiet || blockedLocally || expired(command)) {
            failYouTubeLaunch(command, "MomPilot became unavailable or the YouTube request expired")
            return
        }
        cancelPendingPlayback("MomPilot is opening the YouTube experiment")
        messageDialog?.dismiss()
        stopAndHome()
        setExperimentNotice("Opening the YouTube experiment. Family help pauses until you return to MomPilot.")
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            failYouTubeLaunch(command, "The supported YouTube app could not open this link")
            return
        } catch (_: SecurityException) {
            failYouTubeLaunch(command, "This TV blocked opening the YouTube experiment")
            return
        }

        // Returning from startActivity proves dispatch only, never exact-video playback/autoplay.
        // Persist before onPause, then enqueue the atomic launch/offline result on the same worker.
        handoffLaunched = true
        finishCommand(command, "LAUNCHED")
        setExperimentNotice("YouTube launch requested. Playback is unverified; return to MomPilot for family help.")
        val ack = JSONObject(pendingAcks.getValue(id).toString())
        val api = client()
        network({ api.request("/api/tv/ack", ack) }, {
            if (pendingAcks[id]?.optString("state") == "LAUNCHED") pendingAcks.remove(id)
            saveJournal()
            updateLaunchNotice(true)
        }, { error ->
            // The app might already be open. Keep a transport failure for retry on resume,
            // but never replay the intent or claim that the video is playing.
            if (error is RelayClient.ApiException && (error.status == 404 || error.status == 409)) {
                pendingAcks.remove(id)
                saveJournal()
            }
            updateLaunchNotice(false)
        })
        main.postDelayed({
            // An accepted intent can still leave this Activity visible. Do not strand its UI.
            if (!isDestroyed && foreground && handoffCommandId == id && handoffLaunched) {
                handoffLaunched = false
                handoffCommandId = null
                setExperimentNotice("YouTube launch requested, but MomPilot is still open. Playback remains unverified.")
                main.removeCallbacks(tick)
                main.post(tick)
            }
        }, 3000)
    }

    private fun failYouTubeLaunch(command: JSONObject, reason: String) {
        finishCommand(command, "FAILED", reason)
        setExperimentNotice("YouTube experiment unavailable. $reason. You can still watch Favorites in MomPilot.")
        clearUnlaunchedHandoff(command.getString("id"))
    }

    private fun clearUnlaunchedHandoff(id: String) {
        if (handoffCommandId != id || handoffLaunched) return
        handoffCommandId = null
        main.removeCallbacks(tick)
        if (foreground) main.post(tick)
    }

    private fun setExperimentNotice(message: String) {
        experimentNotice = message
        prefs.edit().putString("youtubeNotice", message).apply()
        experimentNoticeLabel?.text = message
        experimentNoticeLabel?.visibility = View.VISIBLE
        if (screen == "player") playerAccessLabel?.text = message
    }

    private fun updateLaunchNotice(confirmed: Boolean) {
        setExperimentNotice(if (confirmed) "Sent to YouTube · playback unverified. Family help works when MomPilot is open."
            else "YouTube launch result is unconfirmed. It may have opened; MomPilot will not open it again automatically.")
    }

    private fun finishCommand(command: JSONObject, state: String, reason: String? = null) {
        val id = command.optString("id")
        if (id.isBlank()) return
        seen[id] = state
        val ack = JSONObject().put("id", id).put("state", state)
        if (state == "LAUNCHED") ack.put("foreground", false)
        if (reason != null) ack.put("reason", reason)
        pendingAcks[id] = ack
        saveJournal()
    }

    private fun readJournal() {
        val stored = runCatching { JSONObject(prefs.getString("journal", "{}")!!) }.getOrDefault(JSONObject())
        stored.keys().forEach { id ->
            val state = stored.optString(id)
            seen[id] = if (state == "RECEIVED") "FAILED" else state
            if (state == "RECEIVED") pendingAcks[id] = JSONObject().put("id", id).put("state", "FAILED")
                .put("reason", "TV restarted before the result was confirmed")
        }
        val savedAcks = runCatching { JSONArray(prefs.getString("acks", "[]")!!) }.getOrDefault(JSONArray())
        for (index in 0 until savedAcks.length()) {
            val ack = savedAcks.getJSONObject(index)
            if (ack.optString("state") != "RECEIVED") pendingAcks[ack.getString("id")] = ack
        }
    }

    private fun saveJournal() {
        while (seen.size > 250) seen.remove(seen.keys.first())
        val journal = JSONObject()
        seen.forEach { (id, state) -> journal.put(id, state) }
        val acks = JSONArray()
        pendingAcks.values.forEach { acks.put(it) }
        prefs.edit().putString("journal", journal.toString()).putString("acks", acks.toString()).commit()
    }

    private fun expired(command: JSONObject) = timestamp(command.optString("expiresAt")) <= System.currentTimeMillis()
    private fun timestamp(value: String): Long {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            try {
                return SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }
                    .parse(value)?.time ?: 0L
            } catch (_: Exception) { /* Try the second UTC representation. */ }
        }
        return 0L
    }

    private fun heartbeatBody(active: Boolean): JSONObject {
        val player = video
        val playback = if (currentItem == null) JSONObject.NULL else JSONObject()
            .put("itemId", currentItem!!.getString("id")).put("state", playbackState)
            .put("position", (if (prepared) player?.currentPosition ?: resumePosition else resumePosition) / 1000.0)
            .put("duration", (if (prepared) player?.duration ?: 0 else 0).coerceAtLeast(0) / 1000.0)
        return JSONObject().put("foreground", active).put("playback", playback)
    }

    private fun heartbeat(active: Boolean = foreground) {
        if (prefs.getString("token", "").isNullOrBlank() || (active && handoffCommandId != null)) return
        val api = client()
        val body = heartbeatBody(active)
        network({ api.request("/api/tv/heartbeat", body) }, {}, {})
    }

    private fun playItem(item: JSONObject, command: JSONObject? = null) {
        cancelPendingPlayback("Replaced by another video")
        video?.stopPlayback()
        prepared = false
        resumePosition = if (command == null && currentItem?.optString("id") == item.optString("id")) resumePosition else 0
        currentItem = item
        pendingPlaybackCommand = command
        playbackState = "IDLE"
        screen = "player"
        root.removeAllViews()
        root.setBackgroundColor(Color.BLACK)
        val thisRequest = ++playRequest
        val player = VideoView(this)
        video = player
        root.addView(player, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER))
        playerArtwork = artwork(item)
        root.addView(playerArtwork, FrameLayout.LayoutParams(dp(300), dp(169), Gravity.CENTER))
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(38), dp(18), dp(38), dp(16))
            setBackgroundColor(Color.argb(210, 20, 36, 29))
        }
        playerLabel = text("Getting ${item.optString("title")} ready…", 26f, Color.WHITE)
        overlay.addView(playerLabel)
        playerAccessLabel = text(accessLabel(), 18f, Color.rgb(218, 230, 216))
        overlay.addView(playerAccessLabel)
        val controls = row()
        controls.addView(button("Pause / Play") { togglePlayback() }, weighted())
        controls.addView(button("Back to home") { stopAndHome() }, weighted())
        overlay.addView(controls)
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        controls.getChildAt(0).requestFocus()
        player.setOnPreparedListener {
            if (thisRequest != playRequest) return@setOnPreparedListener
            prepared = true
            if (!foreground || (command != null && (quiet || blockedLocally || expired(command)))) {
                cancelPendingPlayback("TV became unavailable or command expired")
                pauseLocal()
                return@setOnPreparedListener
            }
            if (resumePosition > 0) player.seekTo(resumePosition)
            player.start()
            // Preparation alone is not PLAYING. Wait for the first rendered frame.
            playerLabel?.text = "Starting ${item.optString("title")}…"
        }
        player.setOnInfoListener { _, what, _ ->
            if (thisRequest == playRequest && what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) confirmPlaying()
            false
        }
        player.setOnCompletionListener {
            if (thisRequest == playRequest) {
                playbackState = "ENDED"
                resumePosition = 0
                playerLabel?.text = "${item.optString("title")} · Finished"
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                heartbeat()
            }
        }
        player.setOnErrorListener { _, _, _ ->
            if (thisRequest == playRequest) playbackFailed("The video could not play. Check the connection or choose another title.")
            true
        }
        val url = item.optString("videoUrl")
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && !(BuildConfig.DEBUG && uri.scheme == "http")) {
            playbackFailed("The catalog video address is not supported")
            return
        }
        // URL comes only from the catalog, never from a caregiver command.
        try {
            player.setVideoURI(uri)
        } catch (_: Exception) {
            playbackFailed("The video could not be opened. Please choose another title.")
            return
        }
        armPlaybackTimeout(command, thisRequest)
    }

    private fun armPlaybackTimeout(command: JSONObject?, request: Int) {
        val attempt = ++playbackAttempt
        val commandId = command?.optString("id")
        val delay = command?.let { (timestamp(it.optString("expiresAt")) - System.currentTimeMillis()).coerceIn(1L, 25000L) } ?: 25000L
        main.postDelayed({
            val stillWaiting = if (commandId != null) pendingPlaybackCommand?.optString("id") == commandId
                else playbackState == "IDLE"
            if (request == playRequest && attempt == playbackAttempt && stillWaiting) {
                playbackFailed("Video took too long to start. Please try again.")
            }
        }, delay)
    }

    private fun confirmPlaying() {
        if (!foreground || video?.isPlaying != true) return
        val command = pendingPlaybackCommand
        if (command != null && (expired(command) || quiet || blockedLocally)) {
            pauseLocal()
            cancelPendingPlayback("Command expired or family requests were paused")
            return
        }
        playbackState = "PLAYING"
        playerArtwork?.visibility = View.GONE
        playerLabel?.text = "${currentItem?.optString("title")} · Playing in MomPilot"
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (command != null) {
            finishCommand(command, "PLAYING")
            pendingPlaybackCommand = null
        }
        heartbeat()
    }

    private fun pauseLocal() {
        val player = video
        if (player != null) {
            if (prepared) {
                player.pause()
                resumePosition = player.currentPosition
            } else {
                ++playRequest
                player.stopPlayback()
            }
            playbackState = "PAUSED"
            playerLabel?.text = "${currentItem?.optString("title")} · Paused"
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun resumeLocal() {
        val player = video ?: return
        if (!foreground) return
        if (!prepared) { currentItem?.let { playItem(it) }; return }
        val request = playRequest
        val command = pendingPlaybackCommand
        val deadline = minOf(System.currentTimeMillis() + 25000L, command?.let { timestamp(it.optString("expiresAt")) } ?: Long.MAX_VALUE)
        playbackState = "IDLE"
        player.start()
        armPlaybackTimeout(command, request)
        val attempt = playbackAttempt
        // A resumed player need not emit a second first-frame event. Confirm its actual state.
        fun check() {
            if (request != playRequest || attempt != playbackAttempt || video !== player || !foreground || playbackState != "IDLE") return
            if (command != null && pendingPlaybackCommand?.optString("id") != command.optString("id")) return
            if (player.isPlaying) confirmPlaying()
            else if (System.currentTimeMillis() < deadline) main.postDelayed({ check() }, 150)
        }
        main.postDelayed({ check() }, 150)
    }

    private fun togglePlayback() {
        if (!prepared) {
            if (playbackState == "IDLE") {
                cancelPendingPlayback("Paused with the TV remote before the video was ready")
                pauseLocal()
                heartbeat()
            } else resumeLocal()
            return
        }
        if (video?.isPlaying == true) {
            cancelPendingPlayback("Paused with the TV remote before playback was confirmed")
            pauseLocal()
            heartbeat()
        } else resumeLocal()
    }

    private fun playbackFailed(reason: String) {
        ++playRequest
        playbackState = "FAILED"
        prepared = false
        video?.stopPlayback()
        playerLabel?.text = reason
        cancelPendingPlayback(reason)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        heartbeat()
    }

    private fun cancelPendingPlayback(reason: String) {
        pendingPlaybackCommand?.let { finishCommand(it, "FAILED", reason) }
        pendingPlaybackCommand = null
    }

    private fun stopAndHome() {
        cancelPendingPlayback("Parent returned to the MomPilot home screen")
        pauseLocal()
        ++playRequest
        video?.stopPlayback()
        video = null
        prepared = false
        heartbeat()
        showHome()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (screen == "player") {
            when (keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { togglePlayback(); return true }
                KeyEvent.KEYCODE_MEDIA_PAUSE -> { cancelPendingPlayback("Paused with the TV remote"); pauseLocal(); heartbeat(); return true }
                KeyEvent.KEYCODE_MEDIA_PLAY -> { resumeLocal(); return true }
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Activity back handling for Fire OS devices")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (screen == "player") stopAndHome()
        else if (screen != "home") showHome()
        else super.onBackPressed()
    }

    private fun showHome() {
        screen = "home"
        makePage()
        page.addView(text("MomPilot  ♡", 28f, green))
        page.addView(text("Make yourself at home.", 38f, ink, true))
        statusLabel = text(connection, 19f, green)
        page.addView(statusLabel)
        experimentNoticeLabel = text(experimentNotice ?: "", 19f, green).apply {
            visibility = if (experimentNotice == null) View.GONE else View.VISIBLE
        }
        page.addView(experimentNoticeLabel)
        if (device?.optBoolean("paired") != true) {
            page.addView(text("Invite someone you trust to put a video on for you.", 23f))
            val code = prefs.getString("code", "")!!
            val remaining = timestamp(prefs.getString("codeExpiry", "")!!) - System.currentTimeMillis()
            pairingCodeLabel = text(if (code.isBlank()) "Connecting…" else if (remaining <= 0) "Code expired" else code.chunked(3).joinToString("  "), 49f, green, true)
            page.addView(pairingCodeLabel)
            page.addView(text("Share this code privately. It lasts 5 minutes. Your helper can send videos and notes only while MomPilot is open. They cannot see your screen.", 20f))
            val actions = row()
            actions.addView(button("Get a new code") { refreshPairing() }, weighted())
            actions.addView(button("Connection settings") { showSettings() }, weighted())
            page.addView(actions)
            actions.getChildAt(0).requestFocus()
        } else {
            val name = device?.optJSONObject("caregiver")?.optString("name", "Your family") ?: "Your family"
            page.addView(text("$name can send videos and messages to this app. You can pause or remove their access in Settings.", 22f))
            val actions = row()
            actions.addView(button("▶  Continue\n${currentItem?.optString("title") ?: "Choose something lovely"}") {
                currentItem?.let { playItem(it) } ?: showFavorites()
            }, weighted())
            actions.addView(button("♡  Favorites\nYour familiar picks") { showFavorites() }, weighted())
            actions.addView(button("?  Help\nA little reassurance") { showHelp() }, weighted())
            page.addView(actions)
            page.addView(button("Settings · ${if (quiet) "Quiet mode on" else "Family help on"}") { showSettings() })
            actions.getChildAt(0).requestFocus()
        }
        page.addView(text("Use the arrows and center button on your remote. Back brings you home.", 18f))
    }

    private fun showFavorites() {
        screen = "favorites"
        makePage()
        page.addView(text("Something familiar, just for you.", 34f, ink, true))
        page.addView(text("Approved demo films · Play inside MomPilot", 21f, green))
        if (catalog.isEmpty()) page.addView(text("The catalog is loading. Check your relay connection if it does not appear.", 23f))
        catalog.forEach { item ->
            val film = row()
            film.gravity = Gravity.CENTER_VERTICAL
            film.addView(artwork(item), LinearLayout.LayoutParams(dp(128), dp(72)).apply { setMargins(dp(5), dp(7), dp(12), dp(7)) })
            film.addView(button("▶  ${item.optString("title")}\n${item.optString("subtitle")} · ${item.optString("duration")}") { playItem(item) }, weighted())
            page.addView(film)
        }
        val back = button("Back to home") { showHome() }
        page.addView(back)
        if (catalog.isNotEmpty()) (page.getChildAt(2) as LinearLayout).getChildAt(1).requestFocus() else back.requestFocus()
    }

    private fun showHelp() {
        screen = "help"
        makePage()
        page.addView(text("You’re in the right place.", 36f, ink, true))
        page.addView(text("Ask your family to choose a video. Keep MomPilot open and it will appear here.\n\nPress Back to return home. Use Pause / Play while watching.\n\nThe YouTube experiment opens YouTube and pauses MomPilot help until you return. MomPilot cannot see or control playback in YouTube or other TV apps.", 25f))
        val back = button("I’m ready · Back to home") { showHome() }
        page.addView(back)
        back.requestFocus()
    }

    private fun showSettings() {
        screen = "settings"
        makePage()
        page.addView(text("You’re always in control.", 34f, ink, true))
        page.addView(text(connection, 19f, green))
        val toggle = button(if (quiet) "Turn quiet mode off" else "Turn quiet mode on") { setQuiet(!quiet) }
        page.addView(toggle)
        page.addView(text("Quiet mode pauses new family videos and messages. You can still use your remote.", 21f))
        if (device?.optBoolean("paired") == true) {
            page.addView(button("Remove family access") {
                AlertDialog.Builder(this).setTitle("Remove family access?")
                    .setMessage("Your helper will need a new pairing code to send videos or notes again.")
                    .setNegativeButton("Keep access", null).setPositiveButton("Remove access") { _, _ -> revoke() }.show()
            })
        }
        page.addView(button("Relay address\n${prefs.getString("endpoint", "http://10.0.2.2:8787")}") { editEndpoint() })
        page.addView(button("Back to home") { showHome() })
        toggle.requestFocus()
    }

    private fun setQuiet(value: Boolean) {
        // Block locally immediately, even if the network request fails.
        blockedLocally = true
        prefs.edit().putBoolean("blockedLocally", true).commit()
        quiet = true
        cancelPendingPlayback("Family requests paused in TV settings")
        val api = client()
        network({ api.request("/api/tv/settings", JSONObject().put("quiet", value)) }, { response ->
            device = response.getJSONObject("device")
            quiet = value
            blockedLocally = false
            prefs.edit().putBoolean("quiet", quiet).putBoolean("blockedLocally", false).apply()
            showSettings()
        }, {
            connection = "Quiet mode is on here. Reconnect to update family access."
            prefs.edit().putBoolean("quiet", true).apply()
            showSettings()
        })
    }

    private fun refreshPairing() {
        if (prefs.getString("token", "").isNullOrBlank()) { poll(); return }
        val api = client()
        network({ api.request("/api/tv/pairing", JSONObject()) }, { result -> savePairing(result); showHome() })
    }

    private fun savePairing(result: JSONObject) {
        prefs.edit().putString("code", result.optString("code"))
            .putString("codeExpiry", result.optString("expiresAt")).apply()
    }

    private fun revoke() {
        blockedLocally = true
        prefs.edit().putBoolean("blockedLocally", true).commit()
        cancelPendingPlayback("Family access was removed")
        val api = client()
        network({ api.request("/api/tv/revoke", JSONObject()) }, { result ->
            device = result.getJSONObject("device")
            savePairing(result)
            blockedLocally = false
            prefs.edit().putBoolean("blockedLocally", false).apply()
            showHome()
        }, {
            connection = "Requests blocked here. Reconnect, then remove access again to finish."
            showHome()
        })
    }

    private fun editEndpoint() {
        val input = EditText(this).apply {
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("endpoint", "http://10.0.2.2:8787"))
            setPadding(dp(20), dp(12), dp(20), dp(12))
        }
        AlertDialog.Builder(this).setTitle("Local relay address").setView(input)
            .setMessage("Emulator: http://10.0.2.2:8787\nFire TV: your computer’s LAN address and port 8787. Changing relay creates a new pairing.")
            .setNegativeButton("Cancel", null).setPositiveButton("Connect") { _, _ ->
                val value = input.text.toString().trim().trimEnd('/')
                val uri = Uri.parse(value)
                val valid = uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null &&
                    (uri.path.isNullOrEmpty() || uri.path == "/") && (uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http"))
                if (!valid) {
                    AlertDialog.Builder(this).setMessage("Enter a relay origin such as https://relay.example.com. HTTP is allowed only in a debug build.")
                        .setPositiveButton("OK", null).show()
                } else {
                    ++epoch
                    polling = false
                    prefs.edit().clear().putString("endpoint", value).apply()
                    seen.clear(); pendingAcks.clear(); catalog = emptyList(); device = null
                    quiet = false; blockedLocally = false
                    handoffCommandId = null; handoffLaunched = false; experimentNotice = null
                    connection = "Connecting to the relay…"
                    showHome()
                    poll()
                }
            }.show()
    }

    private fun updateStatus() {
        if (screen == "player") playerAccessLabel?.text = accessLabel()
        if (::statusLabel.isInitialized && screen == "home") {
            statusLabel.text = connection
            // Code expiry is visible without refocusing the screen every polling interval.
            if (device?.optBoolean("paired") != true && timestamp(prefs.getString("codeExpiry", "")!!) <= System.currentTimeMillis()) {
                if (!prefs.getString("code", "").isNullOrBlank()) pairingCodeLabel?.text = "Code expired"
            }
        }
    }

    private fun accessLabel() = when {
        quiet || blockedLocally -> "Quiet mode · New family requests are paused"
        device?.optBoolean("paired") == true -> "Family help from ${device?.optJSONObject("caregiver")?.optString("name", "your family")} · You can always press Back"
        else -> "Playing in MomPilot · You can always press Back"
    }

    private fun makePage() {
        root.removeAllViews()
        root.setBackgroundColor(cream)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(46), dp(26), dp(46), dp(26))
        }
        scroll.addView(page)
        root.addView(scroll)
    }

    private fun artwork(item: JSONObject): ImageView {
        val image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = "${item.optString("title")} artwork"
            setImageResource(com.mompilot.tv.R.drawable.ic_mompilot)
        }
        val thumbnail = item.optString("thumbnail")
        if (thumbnail.isBlank()) return image
        val origin = prefs.getString("endpoint", "http://10.0.2.2:8787")!!
        val url = if (thumbnail.startsWith("/")) origin.trimEnd('/') + thumbnail else thumbnail
        val scheme = Uri.parse(url).scheme
        if (scheme != "https" && !(BuildConfig.DEBUG && scheme == "http")) return image
        imageWorker.execute {
            var request: HttpURLConnection? = null
            try {
                request = URL(url).openConnection() as HttpURLConnection
                request.connectTimeout = 4000
                request.readTimeout = 4000
                request.instanceFollowRedirects = false
                if (request.responseCode == 200) {
                    val bitmap = request.inputStream.use { BitmapFactory.decodeStream(it) }
                    if (bitmap != null) main.post { if (!isDestroyed && image.isAttachedToWindow) image.setImageBitmap(bitmap) }
                }
            } catch (_: Exception) { /* The recognizable MomPilot placeholder remains. */ }
            finally { request?.disconnect() }
        }
        return image
    }

    private fun text(value: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(5), 0, dp(8))
        setLineSpacing(dp(3).toFloat(), 1.0f)
    }

    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; textSize = 22f; isAllCaps = false
        gravity = Gravity.CENTER
        setTextColor(ink)
        minHeight = dp(78)
        setPadding(dp(18), dp(14), dp(18), dp(14))
        isFocusable = true; isFocusableInTouchMode = true
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), rounded(Color.rgb(227, 241, 220), green, 4))
            addState(intArrayOf(android.R.attr.state_pressed), rounded(Color.rgb(227, 241, 220), green, 4))
            addState(intArrayOf(), rounded(Color.WHITE, Color.rgb(213, 220, 209), 1))
        }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            setMargins(dp(5), dp(7), dp(5), dp(7))
        }
        setOnClickListener { action() }
    }

    private fun rounded(fill: Int, stroke: Int, width: Int) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(16).toFloat(); setStroke(dp(width), stroke)
    }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
    private fun weighted() = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
        setMargins(dp(5), dp(12), dp(5), dp(12))
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
