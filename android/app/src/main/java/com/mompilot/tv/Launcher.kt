package com.mompilot.tv

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/** Opens a title or app from a server command. Only YouTube, Netflix and Prime Video can be opened. */
object Launcher {
    val PACKAGES = mapOf(
        "com.amazon.firetv.youtube" to "YouTube",
        "com.netflix.ninja" to "Netflix",
        "com.amazon.firebat" to "Prime Video",
    )
    private val SCHEMES = setOf("https", "netflix")

    class Refused(message: String) : Exception(message)

    fun intentFor(context: Context, launch: JSONObject): Intent {
        val component = launch.optString("component").takeIf { it.isNotBlank() }
        val packageName = component?.substringBefore('/') ?: launch.optString("package")
        if (packageName !in PACKAGES) throw Refused("MomPilot only opens YouTube, Netflix and Prime Video.")
        val data = launch.optString("data").takeIf { it.isNotBlank() }
        if (data == null && component == null) {
            // Opening the app itself: prefer its TV launcher entry.
            val pm = context.packageManager
            return pm.getLeanbackLaunchIntentForPackage(packageName) ?: pm.getLaunchIntentForPackage(packageName)
                ?: throw Refused("${PACKAGES[packageName]} isn't installed on this TV.")
        }
        val intent = Intent(launch.optString("action").ifBlank { Intent.ACTION_VIEW })
        if (data != null) {
            val uri = Uri.parse(data)
            if (uri.scheme !in SCHEMES) throw Refused("That link can't be opened on the TV.")
            intent.data = uri
        }
        if (component != null) {
            val cls = component.substringAfter('/')
            intent.component = ComponentName(packageName, if (cls.startsWith(".")) packageName + cls else cls)
        } else {
            intent.setPackage(packageName)
        }
        val extras = launch.optJSONObject("extras")
        extras?.keys()?.forEach { key -> intent.putExtra(key, extras.optString(key)) }
        intent.addFlags(launch.optInt("flags", 0) or Intent.FLAG_ACTIVITY_NEW_TASK)
        return intent
    }

    /** Opens it and returns null, or returns why it couldn't be opened. */
    fun open(context: Context, launch: JSONObject, appVisible: Boolean): String? {
        return try {
            val intent = intentFor(context, launch)
            // Android 10+ (Fire OS 8) only lets a background app open others with the overlay permission.
            if (Build.VERSION.SDK_INT >= 29 && !appVisible && !Settings.canDrawOverlays(context)) {
                return "This Fire TV needs a one-time setting: adb shell appops set com.mompilot.tv SYSTEM_ALERT_WINDOW allow"
            }
            if (intent.resolveActivity(context.packageManager) == null) {
                return "${PACKAGES[intent.component?.packageName ?: intent.`package`] ?: "That app"} isn't installed on this TV."
            }
            context.startActivity(intent)
            null
        } catch (refused: Refused) {
            refused.message
        } catch (error: Exception) {
            "The TV couldn't open it (${error.javaClass.simpleName})."
        }
    }
}
