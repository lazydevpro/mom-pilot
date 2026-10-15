package com.mompilot.tv

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** The MomPilot screen on the TV: the pairing code, who is connected, and what was last opened. */
class MainActivity : Activity() {
    private val ink = Color.rgb(43, 34, 32)
    private val coral = Color.rgb(238, 101, 73)
    private val coralSoft = Color.rgb(253, 231, 225)
    private val muted = Color.rgb(116, 101, 95)
    private val paper = Color.rgb(251, 246, 241)
    private lateinit var page: LinearLayout
    private var shownKey = ""
    private var statusLabel: TextView? = null
    private var actionLabel: TextView? = null
    private val render: (TvState) -> Unit = { show(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(56), dp(36), dp(56), dp(36))
        }
        setContentView(ScrollView(this).apply { isFillViewport = true; setBackgroundColor(paper); addView(page) })
        MomPilotService.start(this)
    }

    override fun onResume() {
        super.onResume()
        Engine.visible = true
        Engine.start(this)
        Engine.listen(render)
        Engine.pollNow()
    }

    override fun onPause() {
        Engine.visible = false
        Engine.unlisten(render)
        super.onPause()
    }

    private fun show(state: TvState) {
        // Rebuild only when the screen changes, so the remote's focus doesn't jump every poll.
        val key = "${state.phase}|${state.caregiver}|${state.code}"
        if (key == shownKey) {
            statusLabel?.text = state.message ?: statusText(state)
            actionLabel?.text = state.lastAction
            return
        }
        shownKey = key
        page.removeAllViews()
        page.addView(text("♥  MomPilot", 30f, coral, bold = true))
        when (state.phase) {
            Phase.NEEDS_SERVER -> {
                page.addView(text("Let’s set up MomPilot.", 40f, bold = true))
                page.addView(text("Enter the MomPilot server address. It’s shown in the setup guide, for example https://my-pc.tail1234.ts.net.", 24f))
                focus(page.addButton("Enter server address") { askForServer() })
            }
            Phase.CONNECTING -> page.addView(text(state.message ?: "Connecting…", 30f))
            Phase.UNPAIRED -> {
                page.addView(text("Connect your family’s phone", 40f, bold = true))
                page.addView(text(if (state.code.isBlank()) "Getting a code…" else state.code.chunked(3).joinToString("  "), 72f, coral, bold = true))
                page.addView(text("On the phone, open MomPilot → TV → and enter this code. A new code appears every 5 minutes.", 24f))
                focus(page.addButton("Get a new code") { Engine.refreshCode() })
                page.addButton("Server address") { askForServer() }
            }
            Phase.PAIRED -> {
                val name = state.caregiver ?: "Your family"
                page.addView(text("You’re all set.", 44f, bold = true))
                page.addView(text("$name can put shows on this TV for you. Just turn on the TV and call.", 26f))
                actionLabel = text(state.lastAction, 22f, muted).also { page.addView(it) }
                focus(page.addButton("Disconnect $name") { confirmDisconnect(name) })
                page.addButton("Server address") { askForServer() }
            }
            Phase.OFFLINE -> {
                page.addView(text("MomPilot can’t connect right now.", 40f, bold = true))
                focus(page.addButton("Try again") { Engine.pollNow() })
                page.addButton("Server address") { askForServer() }
            }
        }
        statusLabel = text(state.message ?: statusText(state), 20f, muted).also { page.addView(it) }
    }

    private fun statusText(state: TvState) = when (state.phase) {
        Phase.PAIRED, Phase.UNPAIRED -> "Connected to ${Engine.serverAddress()}"
        else -> ""
    }

    private fun confirmDisconnect(name: String) {
        AlertDialog.Builder(this).setTitle("Disconnect $name?")
            .setMessage("$name won’t be able to put shows on this TV until you connect again with a new code.")
            .setNegativeButton("Keep connected", null)
            .setPositiveButton("Disconnect") { _, _ -> Engine.disconnect() }
            .show()
    }

    private fun askForServer() {
        val input = EditText(this).apply {
            setSingleLine(true)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(Engine.serverAddress().ifBlank { "https://" })
            setSelection(text.length)
            setPadding(dp(20), dp(12), dp(20), dp(12))
        }
        AlertDialog.Builder(this).setTitle("MomPilot server address").setView(input)
            .setMessage("For example https://my-pc.tail1234.ts.net. Changing it means connecting the phone again.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val value = input.text.toString().trim().trimEnd('/')
                if (RelayClient.isAllowed(value)) {
                    shownKey = ""
                    Engine.useServer(value)
                } else {
                    AlertDialog.Builder(this)
                        .setMessage("Enter an https:// address, or the server’s Tailscale address such as http://100.101.102.103:8787.")
                        .setPositiveButton("OK", null).show()
                }
            }.show()
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
