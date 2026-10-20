package com.mompilot.tv

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.net.Inet4Address
import java.net.NetworkInterface

/** The MomPilot screen on the TV: a QR code to set it up from the phone, then who is connected. */
class MainActivity : Activity() {
    private val ink = Color.rgb(43, 34, 32)
    private val coral = Color.rgb(238, 101, 73)
    private val coralSoft = Color.rgb(253, 231, 225)
    private val muted = Color.rgb(116, 101, 95)
    private val paper = Color.rgb(251, 246, 241)
    private val main = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout
    private var shownKey = ""
    private var statusLabel: TextView? = null
    private var actionLabel: TextView? = null
    private val render: (TvState) -> Unit = { show(it) }

    // The setup screen waits for Tailscale and ADB debugging to be turned on; check every few seconds.
    private val recheck = object : Runnable {
        override fun run() {
            if (Engine.state.phase == Phase.NEEDS_SETUP) { shownKey = ""; show(Engine.state) }
            main.postDelayed(this, 5000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(64), dp(40), dp(64), dp(40))
            setBackgroundColor(paper)
        }
        setContentView(root)
        MomPilotService.start(this)
    }

    override fun onResume() {
        super.onResume()
        Engine.visible = true
        Engine.start(this)
        Engine.listen(render)
        Engine.pollNow()
        main.postDelayed(recheck, 5000)
    }

    override fun onPause() {
        Engine.visible = false
        Engine.unlisten(render)
        main.removeCallbacks(recheck)
        super.onPause()
    }

    private fun show(state: TvState) {
        val address = tailscaleAddress()
        val adbOn = Settings.Global.getInt(contentResolver, Settings.Global.ADB_ENABLED, 0) == 1
        // Rebuild only when the screen changes, so the remote's focus doesn't jump every poll.
        val key = "${state.phase}|${state.caregiver}|$address|$adbOn"
        if (key == shownKey) {
            statusLabel?.text = state.message.orEmpty()
            actionLabel?.text = state.lastAction
            return
        }
        shownKey = key
        root.removeAllViews()
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.logo)
                clipToOutline = true
                outlineProvider = object : android.view.ViewOutlineProvider() {
                    override fun getOutline(view: View, outline: android.graphics.Outline) = outline.setRoundRect(0, 0, view.width, view.height, dp(14).toFloat())
                }
            }, LinearLayout.LayoutParams(dp(64), dp(64)).apply { setMargins(0, 0, dp(16), 0) })
            addView(text("MomPilot", 32f, ink, bold = true))
        })
        when (state.phase) {
            Phase.NEEDS_SETUP -> showSetup(address, adbOn)
            Phase.CONNECTING -> root.addView(text(state.message ?: "Connecting…", 30f))
            Phase.PAIRED -> {
                val name = state.caregiver ?: "Your family"
                root.addView(text("You’re all set.", 44f, bold = true))
                root.addView(text("$name can put shows on this TV for you. Just turn on the TV and call.", 26f))
                actionLabel = text(state.lastAction, 22f, muted).also { root.addView(it) }
                focus(root.addButton("Disconnect $name") { confirmDisconnect(name) })
            }
            Phase.OFFLINE -> {
                root.addView(text("MomPilot can’t connect right now.", 40f, bold = true))
                focus(root.addButton("Try again") { Engine.pollNow() })
                root.addButton("Set up again") { confirmDisconnect(null) }
            }
        }
        statusLabel = text(state.message.orEmpty(), 20f, muted).also { root.addView(it) }
    }

    private fun showSetup(address: String?, adbOn: Boolean) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val steps = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        steps.addView(text("Connect your family’s phone", 40f, bold = true))
        when {
            address == null -> {
                steps.addView(text("Turn on Tailscale on this TV first: open the Tailscale app and sign in.", 26f))
                steps.addView(text("This screen updates by itself.", 22f, muted))
            }
            !adbOn -> {
                steps.addView(text("Turn on ADB debugging: Settings → My Fire TV → Developer Options → ADB debugging.", 26f))
                steps.addView(text("No Developer Options? Open Settings → My Fire TV → About and select the TV’s name 7 times.", 22f, muted))
            }
            else -> {
                steps.addView(text("1.  On the phone, open MomPilot → TV → Add TV.", 26f))
                steps.addView(text("2.  Scan this code, or tap this TV in the list.", 26f))
                steps.addView(text("3.  If the TV asks “Allow USB debugging?”, tick “Always allow” and press Allow.", 26f))
                steps.addView(text("This TV: $address", 22f, muted))
            }
        }
        row.addView(steps, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (address != null && adbOn) {
            val name = Settings.Global.getString(contentResolver, "device_name") ?: Build.MODEL
            val link = Uri.Builder().scheme("mompilot").authority("tv")
                .appendQueryParameter("address", "$address:5555").appendQueryParameter("name", name).build().toString()
            row.addView(ImageView(this).apply {
                setImageBitmap(qr(link, dp(320)))
                contentDescription = "Code to scan with the MomPilot phone app"
                setPadding(dp(16), dp(16), dp(16), dp(16))
                background = rounded(Color.WHITE, Color.rgb(234, 223, 216), 1)
            }, LinearLayout.LayoutParams(dp(352), dp(352)).apply { setMargins(dp(40), 0, 0, 0) })
        }
        root.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    private fun confirmDisconnect(name: String?) {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
            .setTitle(if (name != null) "Disconnect $name?" else "Set up MomPilot again?")
            .setMessage("The phone will need to add this TV again.")
            .setNegativeButton("Keep connected", null)
            .setPositiveButton("Disconnect") { _, _ -> Engine.disconnect() }
            .show()
    }

    /** This TV's Tailscale address (100.64.0.0/10), which the phone and server use to reach it. */
    private fun tailscaleAddress(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .mapNotNull { it.hostAddress }
            .firstOrNull { RelayClient.isTailscale(it) }
    } catch (_: Exception) { null }

    private fun qr(content: String, size: Int): Bitmap {
        val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
        val pixels = IntArray(size * size) { index -> if (matrix[index % size, index / size]) Color.BLACK else Color.WHITE }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565)
    }

    private fun focus(view: View) { view.post { view.requestFocus() } }

    private fun text(value: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(6), 0, dp(10))
        setLineSpacing(dp(3).toFloat(), 1.0f)
    }

    private fun LinearLayout.addButton(label: String, action: () -> Unit): Button {
        val button = Button(this@MainActivity).apply {
            text = label; textSize = 24f; isAllCaps = false
            gravity = Gravity.CENTER
            setTextColor(ink)
            minHeight = dp(80)
            setPadding(dp(24), dp(14), dp(24), dp(14))
            isFocusable = true
            background = StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_focused), rounded(coralSoft, coral, 4))
                addState(intArrayOf(android.R.attr.state_pressed), rounded(coralSoft, coral, 4))
                addState(intArrayOf(), rounded(Color.WHITE, Color.rgb(234, 223, 216), 1))
            }
            setOnClickListener { action() }
        }
        addView(button, LinearLayout.LayoutParams(dp(560), ViewGroup.LayoutParams.WRAP_CONTENT).apply { setMargins(0, dp(10), 0, dp(10)) })
        return button
    }

    private fun rounded(fill: Int, stroke: Int, width: Int) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(18).toFloat(); setStroke(dp(width), stroke)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
