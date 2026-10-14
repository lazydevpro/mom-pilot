# MomPilot for Fire OS

Native Kotlin app source for the foreground MomPilot demo. It shares the local relay and curated catalog with the browser demo. It is an **Android / Fire OS app, not a Vega OS app**.

## Verification status

The final debug APK compiled with the included **Gradle 8.11.1 wrapper**. `:app:assembleDebug` and `:app:lintDebug` passed; lint reported **zero errors and 18 warnings**. The verified artifact is:

| Field | Value |
| --- | --- |
| APK | `app/build/outputs/apk/debug/app-debug.apk` |
| Size | 898,120 bytes |
| Build timestamp (UTC) | 2026-09-30 07:26:08 |
| SHA-256 | `77A2E7369046471607E3F98D9C43EE76853186E871691977F7EC7E9632A5B986` |

No native emulator or physical Fire TV runtime test has been completed. An Android 14 TV emulator boot attempt remained ADB-offline and did not establish application behavior. Native media support, audio, artwork, D-pad focus, lifecycle behavior, and the YouTube experiment still need runtime checks. See [recorded verification](../docs/VERIFICATION.md) for updated evidence. The browser prototype and relay are independently runnable; this build is not a tested Fire TV deployment.

This initial native implementation uses platform `Activity`, focusable Android Views, and `VideoView` to keep the dependency surface small. It does not yet use the PRD's proposed Compose for TV / Leanback UI library. The manifest includes the Leanback launcher category; that does not imply a Leanback library dependency.

## Build

Prerequisites: Android Studio, JDK **17**, Android SDK Platform **35**, and Build Tools **35.0.0**. The included wrapper pins Gradle **8.11.1**; the project pins Android Gradle Plugin **8.10.1** and Kotlin **2.2.21**, including Kotlin 2.2's required D8 support. Android `minSdk` is 22; verify the exact target Fire OS device and its codec support.

1. Open this `android` directory as a project in Android Studio, select JDK 17, and install SDK 35 through SDK Manager.
2. Set `JAVA_HOME` to your JDK 17 installation and `ANDROID_HOME` to your Android SDK, or let Android Studio configure them. Build with the included wrapper from this directory:

   ```powershell
   .\gradlew.bat :app:assembleDebug
   .\gradlew.bat :app:lintDebug
   ```

   On macOS/Linux, use `sh ./gradlew :app:assembleDebug` (or make `gradlew` executable first). The wrapper downloads its pinned Gradle distribution on first use. The APK output is `app/build/outputs/apk/debug/app-debug.apk`.

3. For a release, configure your own signing key, a production HTTPS relay and authenticated caregiver identity, then build the release variant. Signing secrets are intentionally absent. The local relay is a prototype and is not a production service.

## Connect to the local demo

Start the repository's Node relay and web app using the root README. The TV's default relay origin is `http://10.0.2.2:8787`, which reaches the host computer from an Android emulator.

For a physical **Fire OS** TV on your trusted LAN, stop any existing `npm run dev` process, then restart it with an explicit LAN binding from the repository root:

```powershell
$env:HOST = "0.0.0.0"
npm run dev
```

Then open MomPilot on TV → **Connection settings** → **Relay address**, and enter your computer's LAN address, for example `http://192.168.1.10:8787`. The example address is a placeholder; use your actual address. Allow the chosen port through your local firewall only for the intended test network. Run the caregiver web app on the same computer and pair with the code displayed on TV. The relay serves catalog artwork from `/images/` as well as the API.

Cleartext HTTP is allowed **only in the debug variant** for this local demo. The release manifest blocks cleartext traffic, and Settings accepts only HTTPS origins in release builds. Device tokens travel over unencrypted HTTP during this trusted local debug flow; use an HTTPS relay before testing across the public internet. No AWS deployment or cross-network demo is implied.

Changing the relay address clears the local device credential and command journal, then registers a new device. Remove family access on the old relay first if it remains in use. Device credentials otherwise survive app restart in private SharedPreferences; Android backup is disabled.

## Install on a Fire OS test device

Enable developer options and ADB debugging on the target Fire OS device, then use Android Studio's Run command or your installed Android platform tools:

```powershell
adb connect YOUR_FIRE_TV_IP:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.mompilot.tv/.MainActivity
```

These commands are for installation and starting the test. Normal caregiver-to-TV demo actions use the relay, never ADB. Confirm your device is Fire OS: Android APK and ADB instructions do not apply to Vega OS devices.

## What is implemented

- Large Continue, Favorites, and Help targets, visible D-pad focus, in-app Back recovery, and remote media pause/play keys.
- A six-digit expiring code, manual code regeneration, readable consent, visible caregiver name, and on-TV revocation.
- Quiet mode that blocks new commands, including a local block when updating the relay fails. Retry Settings to finish syncing the requested state.
- Bearer-authenticated outbound polling every two seconds while the Activity is foreground. Heartbeats report only MomPilot playback and include an explicit foreground flag. Leaving the app pauses local playback and reports background state. The relay also times out old heartbeats.
- Commands restricted to catalog playback, preset messages, pause, resume, and the fixed-video `OPEN_YOUTUBE` experiment. In-app URLs are resolved from the relay catalog; the experiment uses a hard-coded video and package. Command payloads cannot supply URLs or package names. No arbitrary package launching, shell commands, YouTube extraction, overlays over other apps, or external-player monitoring.
- A receipt acknowledgment before executing each command. Playback success is sent only after the first video frame is rendered; resuming an already prepared player confirms `VideoView.isPlaying`. Preparation by itself never reports Playing.
- Persisted command IDs and a result-acknowledgment journal. Duplicate IDs do not execute again; expired commands fail. Interrupted nonterminal commands fail on app restart instead of replaying. A command superseded by a newer play request is explicitly failed.
- Artwork in Favorites and while loading, explicit player errors, end-of-video reporting, and a dismissible family note.

The API contract is in [`../server/API.md`](../server/API.md). There is no background wake strategy, push transport, seek command, account invitation service, or credential rotation service. The quiet setting is an on/off control, not a scheduled quiet window. The launcher banner is a source XML prototype; produce and verify final branded store assets before submission.

## Fixed-video YouTube experiment

From the caregiver’s **Big Buck Bunny** preview, choose **Try opening YouTube on TV**. The only accepted payload is `OPEN_YOUTUBE` with `itemId: "bunny"`. While MomPilot is foregrounded, the native client attempts an Android `ACTION_VIEW` intent for [the fixed Big Buck Bunny video](https://www.youtube.com/watch?v=aqz-KE-bpKQ), explicitly targeting `com.google.android.youtube.tv`.

That package target is for the **Android TV experiment only**. No Fire OS YouTube package is configured or claimed compatible. A missing or incompatible target reports `FAILED`; the browser TV receiver also reports this action as unsupported.

`LAUNCHED` means `startActivity` returned after Android accepted the intent. It does **not** confirm the exact video appeared, playback started, sound worked, or any prompts were bypassed. MomPilot cannot inspect or control the external player. Its launch acknowledgment atomically marks MomPilot unavailable and cancels other pending caregiver commands at the relay. Return to MomPilot for a fresh foreground heartbeat before sending more help.

If the acknowledgment is lost or expires, the result is unconfirmed: YouTube may already have opened. The persisted command journal prevents automatic relaunch. This is a foreground-only experiment; it does not wake the television or provide universal remote control. No successful native launch or playback has yet been recorded.

## Physical-device acceptance checklist

Record the exact device model, Fire OS version, APK build, relay address, and test time. Do not infer hardware behavior from the browser TV simulator.

1. Build and install. Confirm MomPilot appears in the TV launcher, all controls are remote reachable, focus stays visible, text fits at 720p and 1080p, and Back returns to home in at most three actions.
2. Register, let a code expire, regenerate it, pair once, verify the caregiver name, reject code reuse, and remove access on TV. Confirm the old caregiver can no longer send.
3. Send each catalog item ten times from a paired caregiver. Measure receipt and rendered playback. Target at least nine of ten receipts within five seconds; confirm video codec, sound, timing, and readable title/artwork on the actual device.
4. Pause/play with both remote and caregiver. Check that the caregiver sees honest RECEIVED → PLAYING/PAUSED/FAILED transitions, and heartbeat position is in seconds. Test a failed media connection.
5. Show each preset note while home and during playback. Dismiss it using the remote. Check that the family-help indication remains visible.
6. Enable quiet mode; verify caregiver sends fail. Disconnect the relay while enabling quiet mode and confirm local blocking survives app restart. Reconnect and clear the block through Settings.
7. Duplicate a command ID; verify one execution. Let a command expire before receipt and while a video loads; verify no late surprise. Send a second title while the first loads; confirm the superseded command fails.
8. Switch apps, sleep/wake, force-stop, and reboot. Confirm playback pauses when leaving, offline status follows the documented relay timeout, expired requests never replay, and opening MomPilot restores the session without claiming background delivery.
9. Test real office-to-home networking only after configuring HTTPS, proper account identity, and access controls. Capture the result as new evidence; the local demo does not establish cross-network readiness.
10. On a compatible Android TV test target, exercise the fixed YouTube experiment with the target app both absent and installed. Record `FAILED` or `LAUNCHED` separately from what appears and plays on screen. Verify MomPilot becomes unavailable, pending requests are canceled, and returning restores presence. Treat Fire OS package discovery and testing as separate work.

## Platform references

- [Android TV manifest, launcher, touchscreen, and banner requirements](https://developer.android.com/training/tv/get-started/create)
- [Amazon Fire OS device filtering](https://www.developer.amazon.com/docs/app-submission/device-filtering-and-compatibility.html)
- [Android VideoView callbacks](https://developer.android.com/reference/android/widget/VideoView)
- [MediaPlayer first-frame rendering event](https://developer.android.com/reference/android/media/MediaPlayer#MEDIA_INFO_VIDEO_RENDERING_START)
- [AGP 8.10 requirements: Gradle 8.11.1 and JDK 17](https://developer.android.com/build/releases/agp-8-10-0-release-notes)
- [Android D8 / R8 compatibility with Kotlin class files](https://developer.android.com/build/kotlin-support)
- [Kotlin / Gradle / AGP compatibility matrix](https://kotlinlang.org/docs/gradle-configure-project.html)
