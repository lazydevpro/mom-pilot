# MomPilot TV app (Fire OS)

A small Android app for Mom's Fire TV Stick. It:

- shows the six-digit code that connects your phone to this TV, and who is connected;
- keeps running in the background (a foreground service that starts again after a reboot) and opens a show in YouTube, Netflix or Prime Video when the server asks and ADB isn't available;
- lets Mom disconnect, and change the server address.

Remote button presses don't go through this app: since 2024, Fire OS blocks apps from using the TV's own ADB, so the server sends them over ADB directly. The app only ever opens YouTube (`com.amazon.firetv.youtube`), Netflix (`com.netflix.ninja`) and Prime Video (`com.amazon.firebat`), and accepts only `https` and `netflix` links.

Fire OS only: Vega OS sticks (Fire TV Stick 4K Select, Fire TV Stick HD 2nd Gen) can't install APKs.

## Build

Needs JDK 17 and the Android SDK (platform 35). From this folder:

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17"
.\gradlew.bat :app:assembleRelease :app:lintRelease
```

On macOS/Linux use `./gradlew`. The APK is `app/build/outputs/apk/release/app-release.apk`.

Release builds are signed with the key in `keystore.properties` (not in git):

```properties
storeFile=release.jks
storePassword=…
keyAlias=mompilot
keyPassword=…
```

Create one with `keytool -genkeypair -keystore release.jks -alias mompilot -keyalg RSA -keysize 3072 -validity 10000`. **Back up `release.jks` and `keystore.properties`.** An update signed with a different key can't be installed over the old app (you'd have to uninstall and pair again). Without `keystore.properties`, the release APK is unsigned; use `assembleDebug` for a quick test build.

## Install

See [docs/DEPLOY.md](../docs/DEPLOY.md) §3. In short, from the server:

```bash
adb connect 100.x.y.z:5555
adb -s 100.x.y.z:5555 install -r app/build/outputs/apk/release/app-release.apk
adb -s 100.x.y.z:5555 shell am start -n com.mompilot.tv/.MainActivity
```

Open it once after installing, so Fire OS lets it start again after a reboot. On Fire OS 8, also allow background launches once:

```bash
adb -s 100.x.y.z:5555 shell appops set com.mompilot.tv SYSTEM_ALERT_WINDOW allow
```

## Server address

Enter the HTTPS address from `tailscale serve`, such as `https://my-pc.tail1234.ts.net`. Plain `http://` is accepted only for Tailscale addresses (`100.64.0.0/10` or `*.ts.net`), which Tailscale already encrypts, or in debug builds. Changing the address starts a new pairing.

## Code

| File | What it does |
|---|---|
| `MainActivity.kt` | The TV screen: code, connected status, last action, disconnect, server address |
| `Engine.kt` | Background loop: registers, polls every 3 s (backs off to 30 s when offline), opens shows, reports results |
| `Launcher.kt` | Builds and checks the intent for YouTube, Netflix or Prime Video |
| `Store.kt` | Settings, the TV's credential, and a journal so a command is opened at most once |
| `RelayClient.kt` | HTTP client with the TV's bearer token |
| `MomPilotService.kt` | The foreground service and the boot receiver |
