package com.mompilot.phone

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun TvScreen(model: AppModel) {
    var adding by remember { mutableStateOf(false) }
    val details = model.details
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (model.devices.size > 1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                model.devices.forEach { device -> FilterChip(device.id == details?.device?.id, { model.chooseTv(device.id) }, { Text(device.name) }) }
            }
        }
        if (details == null || adding) {
            AddTv(model, canCancel = details != null) { adding = false }
        } else {
            Connection(details)
            TvSettings(model, details.device)
            Activity(details)
            OutlinedButton(onClick = { adding = true }, modifier = Modifier.fillMaxWidth()) { Text("Add another TV") }
        }
        Phones(model)
        Profile(model)
    }
    model.tvSetup?.takeIf { it.failed }?.let { failed ->
        AlertDialog(
            onDismissRequest = model::dismissSetup, title = { Text("Couldn’t set up the TV") }, text = { Text(failed.message) },
            confirmButton = { TextButton(model::dismissSetup) { Text("OK") } },
        )
    }
}

@Composable
private fun Section(content: @Composable ColumnScope.() -> Unit) {
    Card(colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surfaceContainer), border = CardDefaults.outlinedCardBorder()) {
        Column(Modifier.padding(16.dp).fillMaxWidth(), content = content)
    }
}

@Composable
private fun Hint(text: String) = Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)

@Composable
private fun AddTv(model: AppModel, canCancel: Boolean, close: () -> Unit) {
    val context = LocalContext.current
    var address by remember { mutableStateOf("") }
    var scanError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { model.findTvs() }
    // Close once the new TV has been added.
    val startCount = remember { model.devices.size }
    LaunchedEffect(model.devices.size) { if (canCancel && model.devices.size > startCount) close() }
    Section {
        Text("Add Mom’s TV", fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Hint("Open MomPilot on the TV. It shows a code to scan, and its name appears below.")
        val setup = model.tvSetup
        if (setup != null && setup.working) {
            Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
                Text(setup.message, fontWeight = FontWeight.SemiBold)
            }
            return@Section
        }
        Button(
            onClick = {
                scanError = null
                scanQr(context, { text ->
                    val link = mompilotLink(text)
                    if (link?.host == "tv") model.handleLink(link) else scanError = "That isn’t the code from the MomPilot TV app."
                }, { scanError = it })
            },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(52.dp),
        ) { Icon(Icons.Filled.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text("Scan the code on the TV") }
        scanError?.let { Text(it, color = Bad, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }

        Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("On your Tailscale network", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            IconButton(onClick = model::findTvs) { Icon(Icons.Outlined.Refresh, "Look again") }
        }
        val nearby = model.nearby
        when {
            nearby == null -> CircularProgressIndicator(Modifier.size(22.dp).padding(4.dp), strokeWidth = 2.dp)
            nearby.isEmpty() -> Hint("No Android devices found. Is Tailscale on and signed in on the TV?")
            else -> nearby.forEach { tv ->
                ListItem(
                    headlineContent = { Text(tv.name) },
                    supportingContent = {
                        Text(when {
                            tv.added -> "Already added"
                            tv.adb -> "Ready · tap to add"
                            else -> "ADB debugging is off, or not a TV"
                        })
                    },
                    leadingContent = { Icon(Icons.Outlined.Tv, null) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    modifier = Modifier.padding(vertical = 2.dp).let { base ->
                        if (tv.adb && !tv.added) base.then(Modifier.clickableItem { model.setupTv(tv.address, tv.name) }) else base
                    },
                )
            }
        }

        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        Text("Or type its Tailscale address", fontWeight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
            OutlinedTextField(address, { address = it }, placeholder = { Text("100.101.102.103") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { model.setupTv(address, null) }, enabled = address.isNotBlank()) { Text("Add") }
        }
        if (canCancel) TextButton(onClick = close, modifier = Modifier.padding(top = 4.dp)) { Text("Cancel") }
    }
}

private fun Modifier.clickableItem(onClick: () -> Unit) = this.clickable(onClick = onClick)

@Composable
private fun Connection(details: Details) {
    val adb = details.adb
    Section {
        Text(details.device.name, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        val remote = when (adb.state) {
            "CONNECTED" -> "Connected" + when {
                adb.awake == false -> " · TV asleep"
                adb.app != null -> " · ${APP_NAMES[adb.app] ?: "MomPilot"} open"
                else -> ""
            }
            "NOT_SET" -> "Not set up"
            "ADB_UNAUTHORIZED" -> "Waiting for Allow on the TV"
            else -> adb.message ?: "Can’t reach the TV"
        }
        Fact("Remote", remote, if (adb.state == "CONNECTED") Good else Bad)
        Fact("MomPilot TV app", if (details.device.appOnline) "Running" else "Not running", if (details.device.appOnline) Good else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Fact(label: String, value: String, color: androidx.compose.ui.graphics.Color) {
    Row(Modifier.padding(top = 8.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(140.dp))
        Text(value, color = color, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun TvSettings(model: AppModel, device: Device) {
    var name by remember(device.id) { mutableStateOf(device.name) }
    var address by remember(device.id) { mutableStateOf(device.adbTarget.orEmpty()) }
    Section {
        Text("TV settings", fontWeight = FontWeight.Bold)
        OutlinedTextField(name, { name = it.take(60) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        OutlinedTextField(address, { address = it }, label = { Text("Address for the remote") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        val changed = name.trim() != device.name || address.trim() != device.adbTarget.orEmpty()
        Button(onClick = { model.saveTv(device, name, address) }, enabled = changed && name.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text("Save") }
    }
}

@Composable
private fun Activity(details: Details) {
    if (details.commands.isEmpty()) return
    val label = mapOf("LAUNCHED" to "Opened", "QUEUED" to "Sending…", "RECEIVED" to "Opening…", "FAILED" to "Didn’t open", "EXPIRED" to "Timed out")
    Section {
        Text("Recently", fontWeight = FontWeight.Bold)
        details.commands.take(8).forEach { command ->
            Column(Modifier.padding(top = 10.dp)) {
                Text(command.title ?: APP_NAMES[command.app] ?: command.app, fontWeight = FontWeight.Medium)
                val failed = command.state == "FAILED" || command.state == "EXPIRED"
                Text((label[command.state] ?: command.state) + (command.reason?.let { " · $it" } ?: ""),
                    color = if (failed) Bad else MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun Phones(model: AppModel) {
    Section {
        Text("Use MomPilot on another phone", fontWeight = FontWeight.Bold)
        Hint("Only for signing in a second phone. Not needed for the TV.")
        val link = model.linkCode
        if (link == null) {
            OutlinedButton(onClick = model::makeLinkCode, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("Show a code for another phone") }
        } else {
            val image = remember(link.qr) { qrImage(link.qr) }
            Image(image, "Code for your other phone", Modifier.padding(top = 12.dp).size(220.dp).align(Alignment.CenterHorizontally))
            Text(link.code.chunked(3).joinToString(" "), fontSize = 28.sp, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp))
            Hint("Valid for 10 minutes, once. Server: ${model.api.server}")
        }
    }
}

@Composable
private fun Profile(model: AppModel) {
    var name by remember(model.name) { mutableStateOf(model.name) }
    var confirmSignOut by remember { mutableStateOf(false) }
    Section {
        Text("Your name", fontWeight = FontWeight.Bold)
        Hint("Shown on Mom’s TV.")
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
            OutlinedTextField(name, { name = it.take(60) }, singleLine = true, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            OutlinedButton(onClick = { model.rename(name) }, enabled = name.isNotBlank() && name.trim() != model.name) { Text("Save") }
        }
        TextButton(onClick = { confirmSignOut = true }, modifier = Modifier.padding(top = 6.dp)) { Text("Sign out of this phone", color = Bad) }
    }
    if (confirmSignOut) {
        AlertDialog(
            onDismissRequest = { confirmSignOut = false }, title = { Text("Sign out of this phone?") },
            text = { Text("Your shows and TV stay connected. Sign in again with a code from another phone.") },
            confirmButton = { TextButton({ confirmSignOut = false; model.signOut() }) { Text("Sign out", color = Bad) } },
            dismissButton = { TextButton({ confirmSignOut = false }) { Text("Cancel") } },
        )
    }
}
