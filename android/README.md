# MomPilot Android apps

One Gradle project with two apps:

| Module | App | Runs on |
|---|---|---|
| `:app` | **MomPilot TV** (`com.mompilot.tv`) | Mom's Fire OS stick (Fire OS 7 or 8) |
| `:phone` | **MomPilot** (`com.mompilot.phone`) | Your Android phone (Android 8+) |

Fire OS only: Vega OS sticks (Fire TV Stick 4K Select, Fire TV Stick HD 2nd Gen) can't install APKs.

## The TV app

- Until it is set up, shows a **QR code** with the TV's Tailscale address. The phone scans it (or picks the TV from a list), and the server sets the app up over ADB: it installs or updates the APK, then hands it the server address and its own credential through `SetupReceiver`. That receiver only accepts senders holding `WRITE_SECURE_SETTINGS`, which means ADB, not ordinary apps. Nothing is typed on the TV.
- Once set up, shows "You're all set" with the caregiver's name and a **Disconnect** button.
- Runs a foreground service that starts again after a reboot. It polls the server every 3 s and, if the server can't use ADB, opens the requested show itself.
- Only ever opens YouTube (`com.amazon.firetv.youtube`), Netflix (`com.netflix.ninja`) and Prime Video (`com.amazon.firebat`), and accepts only `https`, `netflix` and `amzn` links. A journal makes sure each request is opened at most once.

Remote button presses don't go through the app. Fire OS blocks ADB connections from the TV itself (tested on Fire OS 7.7.1.7), so the server sends them over ADB from outside.

| File | What it does |
|---|---|
| `MainActivity.kt` | The TV screen: setup QR code, or who is connected |
| `Engine.kt` | Background loop: polls, opens shows, reports results, backs off when offline |
| `Launcher.kt` | Builds and checks the intent for YouTube, Netflix or Prime Video |
| `Store.kt` | Server address, credential, and the journal of handled requests |
| `RelayClient.kt` | HTTP client with the TV's bearer token |
| `MomPilotService.kt` | Foreground service, boot receiver and `SetupReceiver` |

## The phone app

Kotlin and Jetpack Compose. First launch: **your name → Scan the code on Mom's TV**. That one scan creates your account and sets up the TV. Then:

- **Shows**: saved shows with search and an app filter. Add them with **Share → MomPilot** from YouTube, Netflix or Prime Video, or by pasting a link. Tap one to play it on the TV.
- **Remote**: D-pad, OK, Back, Home, playback and volume keys, wake, and a snapshot of the TV screen.
- **TV**: status, add another TV, recent activity, your name, and a code to sign in a second phone.

QR codes are scanned with Google's code scanner (no camera permission needed), so the phone needs Google Play services.

## Build

Needs JDK 17 and the Android SDK (platform 35). In `android/local.properties`:

```properties
sdk.dir=C\:/path/to/Android/Sdk
# Optional: filled in on the phone app's first screen
mompilot.server=https://my-pc.tail1234.ts.net
```

Release builds of both apps are signed with the key in `android/keystore.properties` (not in git):

```properties
storeFile=release.jks
storePassword=…
keyAlias=mompilot
keyPassword=…
```

Create one with `keytool -genkeypair -keystore release.jks -alias mompilot -keyalg RSA -keysize 3072 -validity 10000`. **Back up `release.jks` and `keystore.properties`.** Updates signed with a different key can't be installed over the old apps.

```powershell
$env:JAVA_HOME = "C:\path\to\jdk-17"
.\gradlew.bat :app:assembleRelease :phone:assembleRelease
```

On macOS/Linux use `./gradlew`. Outputs:

- `app/build/outputs/apk/release/app-release.apk` (TV). The server installs this during setup.
- `phone/build/outputs/apk/release/phone-release.apk` (phone). The server offers it at `/download/mompilot.apk`.
