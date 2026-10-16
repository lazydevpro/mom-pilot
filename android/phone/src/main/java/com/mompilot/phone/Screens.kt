package com.mompilot.phone

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.outlined.Gamepad
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.IconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch

@Composable
fun MomPilotApp(model: AppModel) {
    when (model.stage) {
        Stage.LOADING -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), Alignment.Center) { CircularProgressIndicator() }
        Stage.WELCOME -> WelcomeScreen(model)
        Stage.READY -> MainScreen(model)
    }
}

/** One line on whether Mom's TV can be controlled right now, and its colour. */
fun tvStatus(details: Details?): Pair<String, Color> {
    if (details == null) return "No TV yet" to Bad
    val adb = details.adb
    if (adb.state == "CONNECTED") {
        if (adb.awake == false) return "TV is asleep" to Warn
        return (adb.app?.let { "${APP_NAMES[it] ?: "MomPilot"} is open" } ?: "Connected") to Good
    }
    if (details.device.appOnline) return "Remote unavailable" to Warn
    return "Can’t reach the TV" to Bad
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(model: AppModel) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(model.notice) {
        val notice = model.notice ?: return@LaunchedEffect
        if (notice.text.isBlank()) return@LaunchedEffect
        val result = snackbar.showSnackbar(notice.text, actionLabel = notice.action, withDismissAction = true,
            duration = if (notice.bad) SnackbarDuration.Long else SnackbarDuration.Short)
        if (result == SnackbarResult.ActionPerformed && notice.action == "Remote") model.tab = Tab.REMOTE
    }
    val (status, color) = tvStatus(model.details)
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Coral), Alignment.Center) {
                            Icon(Icons.Filled.Favorite, null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Text("MomPilot", fontWeight = FontWeight.Bold)
                    }
                },
                actions = {
                    Surface(
                        onClick = { model.tab = Tab.TV }, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainer,
                        border = CardDefaults.outlinedCardBorder(), modifier = Modifier.padding(end = 12.dp),
                    ) {
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(9.dp).clip(CircleShape).background(color))
                            Spacer(Modifier.width(7.dp))
                            Text(status, fontSize = 13.sp, maxLines = 1)
                        }
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(model.tab == Tab.SHOWS, { model.tab = Tab.SHOWS }, { Icon(Icons.Outlined.VideoLibrary, null) }, label = { Text("Shows") })
                NavigationBarItem(model.tab == Tab.REMOTE, { model.tab = Tab.REMOTE }, { Icon(Icons.Outlined.Gamepad, null) }, label = { Text("Remote") })
                NavigationBarItem(model.tab == Tab.TV, { model.tab = Tab.TV }, { Icon(Icons.Outlined.Tv, null) }, label = { Text("TV") })
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            model.offline?.let { Banner(it, Bad) }
            when (model.tab) {
                Tab.SHOWS -> ShowsScreen(model)
                Tab.REMOTE -> RemoteScreen(model)
                Tab.TV -> TvScreen(model)
            }
        }
    }
    model.draft?.let { AddShowSheet(model, it) }
}

@Composable
fun Banner(text: String, color: Color) {
    Text(
        text, color = color, fontSize = 14.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.1f)).padding(12.dp),
    )
}

// —— Welcome ——

@Composable
private fun WelcomeScreen(model: AppModel) {
    val context = LocalContext.current
    var server by remember { mutableStateOf(model.api.server) }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).verticalScroll(rememberScrollState())
            .imePadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.height(40.dp))
        Box(Modifier.size(76.dp).clip(RoundedCornerShape(22.dp)).background(Coral), Alignment.Center) {
            Icon(Icons.Filled.Favorite, null, tint = Color.White, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text("MomPilot", fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Text("Put Mom’s shows on her TV from wherever you are.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))

        Button(
            onClick = {
                error = null
                scanQr(context, { text ->
                    val link = mompilotLink(text)
                    if (link?.host == "join") { busy = true; model.handleLink(link) } else error = "That isn’t a MomPilot code."
                }, { error = it })
            },
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) { Icon(Icons.Filled.QrCodeScanner, null); Spacer(Modifier.width(8.dp)); Text("Scan the code from your other phone or computer") }
        Text(
            "On a phone or computer already using MomPilot: TV → Add another phone.",
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp),
        )

        Spacer(Modifier.height(28.dp))
        Text("New to MomPilot?", fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            server, { server = it }, label = { Text("Server address") }, placeholder = { Text("my-pc.tail1234.ts.net") },
            singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        OutlinedTextField(
            name, { name = it.take(60) }, label = { Text("Your name, as Mom will see it") }, singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        error?.let { Text(it, color = Bad, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) }
        OutlinedButton(
            onClick = { busy = true; error = null; model.start(server, name) { busy = false; error = it } },
            enabled = !busy && server.isNotBlank() && name.isNotBlank(),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(52.dp),
        ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Get started") }
    }
}

// —— Shows ——

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShowsScreen(model: AppModel) {
    var confirmDelete by remember { mutableStateOf<Show?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var appFilter by rememberSaveable { mutableStateOf<String?>(null) }
    val apps = model.shows.map { it.app }.distinct()
    val visible = model.shows.filter { show ->
        (appFilter == null || show.app == appFilter) && (query.isBlank() || show.title.contains(query.trim(), ignoreCase = true))
    }
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                Text("Mom’s shows", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Button(onClick = { model.draft = Draft() }, contentPadding = PaddingValues(horizontal = 16.dp), modifier = Modifier.height(40.dp)) {
                    Icon(Icons.Filled.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Add a show")
                }
            }
        }
        if (model.shows.isEmpty()) {
            item {
                Card(colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surfaceContainer)) {
                    Column(Modifier.padding(20.dp)) {
                        Text("Save the shows Mom asks for.", fontWeight = FontWeight.SemiBold)
                        Text(
                            "In YouTube, Netflix or Prime Video, tap Share → MomPilot. Next time she calls, one tap puts it on her TV.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            }
        }
        if (model.shows.size > 1) {
            item {
                SearchField(query) { query = it }
            }
            if (apps.size > 1) {
                item {
                    AppFilter(apps, appFilter) { appFilter = it }
                }
            }
            if (visible.isEmpty()) {
                item {
                    Text("No saved shows match.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 8.dp))
                }
            }
        }
        items(visible, key = { it.id }) { show ->
            Card(
                colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surfaceContainer),
                border = CardDefaults.outlinedCardBorder(),
                modifier = Modifier.fillMaxWidth().combinedClickable(
                    enabled = model.busyShowId == null, onClick = { model.play(show) }, onLongClick = { confirmDelete = show },
                    onClickLabel = "Put on the TV", onLongClickLabel = "Delete",
                ),
            ) {
                Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(96.dp, 56.dp).clip(RoundedCornerShape(10.dp)).background(AppColors[show.app] ?: Coral), Alignment.Center) {
                        if (show.image != null) AsyncImage(show.image, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        else Text(APP_NAMES[show.app]?.take(1) ?: "?", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                    }
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(show.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(APP_NAMES[show.app] ?: show.app, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                    }
                    Box(Modifier.size(42.dp).clip(CircleShape).background(Coral), Alignment.Center) {
                        if (model.busyShowId == show.id) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                        else Icon(Icons.Filled.PlayArrow, "Put on the TV", tint = Color.White)
                    }
                }
            }
        }
        item {
            Text("Just open an app", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 18.dp, bottom = 2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("youtube", "netflix", "prime").forEach { app ->
                    Button(
                        onClick = { model.openApp(app) }, enabled = model.details != null,
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = AppColors.getValue(app)),
                        shape = RoundedCornerShape(14.dp), contentPadding = PaddingValues(4.dp),
                        modifier = Modifier.weight(1f).height(52.dp),
                    ) { Text(APP_NAMES.getValue(app), fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
                }
            }
            Text("Long-press a show to delete it.", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp, modifier = Modifier.padding(top = 14.dp))
        }
    }
    confirmDelete?.let { show ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete ${show.title}?") },
            confirmButton = { TextButton({ model.deleteShow(show); confirmDelete = null }) { Text("Delete", color = Bad) } },
            dismissButton = { TextButton({ confirmDelete = null }) { Text("Keep") } },
        )
    }
}

private val SUPPORTED_LINK = Regex("https?://\\S*(youtube\\.com|youtu\\.be|netflix\\.com|primevideo\\.com|amazon\\.\\S+/gp/video|amzn\\.\\S+)\\S*", RegexOption.IGNORE_CASE)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddShowSheet(model: AppModel, initial: Draft) {
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var link by remember { mutableStateOf(initial.link) }
    var title by remember { mutableStateOf(initial.title) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    // A copied YouTube, Netflix or Prime Video link is filled in for you.
    LaunchedEffect(Unit) {
        if (link.isBlank()) clipboard.getText()?.text?.let { SUPPORTED_LINK.find(it)?.value }?.let { link = it }
    }
    ModalBottomSheet(onDismissRequest = { model.draft = null }, sheetState = sheet) {
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp).imePadding()) {
            Text("Add a show", fontSize = 22.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(link, { link = it }, label = { Text("Link") }, placeholder = { Text("https://www.netflix.com/title/…") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Text("Tip: in YouTube, Netflix or Prime Video, tap Share → MomPilot.", fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            OutlinedTextField(title, { title = it.take(80) }, label = { Text("Name") }, placeholder = { Text("What Mom calls it") },
                singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
            error?.let { Text(it, color = Bad, modifier = Modifier.padding(top = 8.dp)) }
            Button(
                onClick = {
                    busy = true; error = null
                    model.saveShow(title, link) { problem ->
                        busy = false; error = problem
                        if (problem == null) scope.launch { sheet.hide() }
                    }
                },
                enabled = !busy && link.isNotBlank() && title.isNotBlank(),
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(52.dp),
            ) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else Text("Save show") }
        }
    }
}

/** A slim, rounded search box. */
@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    TextField(
        query, onChange, placeholder = { Text("Find a show") }, singleLine = true,
        leadingIcon = { Icon(Icons.Filled.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
        trailingIcon = { if (query.isNotEmpty()) IconButton({ onChange("") }) { Icon(Icons.Filled.Close, "Clear") } },
        shape = RoundedCornerShape(26.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer, unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        ),
        modifier = Modifier.fillMaxWidth().height(52.dp),
    )
}

/** One full-width bar of equal buttons: All, then each app that has saved shows. */
@Composable
private fun AppFilter(apps: List<String>, selected: String?, onSelect: (String?) -> Unit) {
    val short = mapOf("youtube" to "YouTube", "netflix" to "Netflix", "prime" to "Prime")
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        (listOf<String?>(null) + apps).forEach { app ->
            val active = selected == app
            Box(
                Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(22.dp))
                    .background(if (active) Coral else Color.Transparent)
                    .clickable { onSelect(if (active) null else app) },
                Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (app != null) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(if (active) Color.White else AppColors[app] ?: Coral))
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(
                        if (app == null) "All" else short[app] ?: app, maxLines = 1, fontSize = 14.sp,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        color = if (active) Color.White else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}
