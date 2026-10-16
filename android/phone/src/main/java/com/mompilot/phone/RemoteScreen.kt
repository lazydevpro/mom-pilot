package com.mompilot.phone

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.automirrored.filled.VolumeDown
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun RemoteScreen(model: AppModel) {
    val details = model.details
    if (details == null || details.device.adbTarget == null) {
        Column(Modifier.padding(24.dp)) {
            Text(if (details == null) "No TV yet." else "The remote needs the TV’s address.", fontWeight = FontWeight.SemiBold)
            Text("Add Mom’s TV on the TV tab.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            Button(onClick = { model.tab = Tab.TV }, modifier = Modifier.padding(top = 16.dp)) { Text("Go to TV") }
        }
        return
    }
    val haptics = LocalHapticFeedback.current
    val press: (String) -> Unit = { key -> haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); model.press(key) }
    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(16.dp).fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (details.adb.state != "CONNECTED") Banner(details.adb.message ?: "The remote can’t reach the TV right now.", Warn)

        // The D-pad: arrows around a big OK.
        Box(Modifier.size(280.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainer)) {
            Arrow(Icons.Filled.KeyboardArrowUp, "Up", Modifier.align(Alignment.TopCenter).padding(top = 8.dp)) { press("up") }
            Arrow(Icons.Filled.KeyboardArrowDown, "Down", Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp)) { press("down") }
            Arrow(Icons.Filled.KeyboardArrowLeft, "Left", Modifier.align(Alignment.CenterStart).padding(start = 8.dp)) { press("left") }
            Arrow(Icons.Filled.KeyboardArrowRight, "Right", Modifier.align(Alignment.CenterEnd).padding(end = 8.dp)) { press("right") }
            Button(
                onClick = { press("ok") }, shape = CircleShape,
                modifier = Modifier.align(Alignment.Center).size(108.dp),
            ) { Text("OK", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
        }

        KeyRow(
            Triple(Icons.AutoMirrored.Filled.ArrowBack, "Back", "back"),
            Triple(Icons.Filled.Home, "Home", "home"),
            Triple(Icons.Filled.PlayArrow, "Play or pause", "playPause"),
            onPress = press,
        )
        KeyRow(
            Triple(Icons.Filled.FastRewind, "Rewind", "rewind"),
            Triple(Icons.Filled.FastForward, "Fast forward", "fastForward"),
            Triple(Icons.Filled.PowerSettingsNew, "Wake the TV", "wake"),
            onPress = press,
        )
        KeyRow(
            Triple(Icons.AutoMirrored.Filled.VolumeDown, "Volume down", "volumeDown"),
            Triple(Icons.AutoMirrored.Filled.VolumeOff, "Mute", "mute"),
            Triple(Icons.AutoMirrored.Filled.VolumeUp, "Volume up", "volumeUp"),
            onPress = press,
        )

        OutlinedButton(onClick = model::takeSnapshot, enabled = model.snapshotState != "loading", modifier = Modifier.fillMaxWidth().height(50.dp)) {
            if (model.snapshotState == "loading") CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Image, null)
            Spacer(Modifier.width(8.dp))
            Text(if (model.snapshotState == "loading") "Getting the screen…" else "See TV screen")
        }
        val failure = model.snapshotState?.takeIf { it != "loading" }
        if (failure != null) Text(failure, color = Bad, fontSize = 13.sp)
        else model.snapshot?.let { bytes ->
            val image = remember(bytes) { BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }
            if (image != null) {
                Image(image, "Mom’s TV screen", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)))
                Text("Playing video shows as black; menus and pages are visible.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun Arrow(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick, modifier = modifier.size(76.dp),
        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = MaterialTheme.colorScheme.background),
    ) { Icon(icon, label, Modifier.size(44.dp)) }
}

@Composable
private fun KeyRow(vararg keys: Triple<ImageVector, String, String>, onPress: (String) -> Unit, height: Dp = 64.dp) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        keys.forEach { (icon, label, key) ->
            FilledTonalIconButton(
                onClick = { onPress(key) }, shape = RoundedCornerShape(18.dp),
                colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainer, contentColor = MaterialTheme.colorScheme.onSurface),
                modifier = Modifier.weight(1f).height(height),
            ) { Icon(icon, label, Modifier.size(28.dp)) }
        }
    }
}
