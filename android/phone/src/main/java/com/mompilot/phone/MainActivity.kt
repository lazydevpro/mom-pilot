package com.mompilot.phone

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) receive(intent)
        setContent { MomPilotTheme { MomPilotApp(model) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receive(intent)
    }

    override fun onStart() { super.onStart(); model.startPolling() }
    override fun onStop() { model.stopPolling(); super.onStop() }

    /** A scanned MomPilot code (mompilot://…) or a link shared from YouTube, Netflix or Prime Video. */
    private fun receive(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_VIEW -> intent.data?.takeIf { it.scheme == "mompilot" }?.let(model::handleLink)
            Intent.ACTION_SEND -> {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
                val link = Regex("https?://\\S+").find(text)?.value ?: return
                val title = intent.getStringExtra(Intent.EXTRA_SUBJECT).orEmpty().ifBlank { text.substringBefore(link).trim().trimEnd(':', '-').trim() }
                model.tab = Tab.SHOWS
                model.draft = Draft(title.take(80), link)
            }
        }
    }
}

/** Accepts the text of a scanned QR code if it is a MomPilot link. */
fun mompilotLink(text: String): Uri? = runCatching { Uri.parse(text.trim()) }.getOrNull()?.takeIf { it.scheme == "mompilot" }
