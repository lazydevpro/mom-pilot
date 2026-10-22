# MomPilot friction log

Problems I hit while building MomPilot for **Build, Ship, Shape: Amazon Developer Hackathon** (Fire TV track), with what I expected, what happened, how I got around it, and what would fix it.

Tested on a Fire TV Stick (model AFTSS, Fire OS 7.7.1.7). Severity: **High** blocks the task, **Medium** costs hours, **Low** is a small annoyance.

| # | Problem | Severity |
|---|---|---|
| 1 | [Fire OS blocks ADB from the device itself](#1-fire-os-blocks-adb-from-the-device-itself) | High |
| 2 | [Vega OS sticks can't sideload or use ADB](#2-vega-os-sticks-cant-sideload-or-use-adb) | High |
| 3 | [Prime Video deep links aren't documented](#3-prime-video-deep-links-arent-documented) | Medium |
| 4 | [Prime Video can't be opened with standard launcher commands](#4-prime-video-cant-be-opened-with-standard-launcher-commands) | Low |
| 5 | [`input keyevent` is slow on Fire TV](#5-input-keyevent-is-slow-on-fire-tv) | Medium |
| 6 | [No Fire OS emulator](#6-no-fire-os-emulator) | Medium |
| 7 | [Screenshots of streaming apps](#7-screenshots-of-streaming-apps) | Low |
| 8 | [Conflicting Tailscale install instructions for Fire TV](#8-conflicting-tailscale-install-instructions-for-fire-tv) | Low |

---

## 1. Fire OS blocks ADB from the device itself

- **Task:** control the TV from an app on the TV, for a one-app design with Tailscale built in.
- **Steps:** on the stick, open an ADB connection to `127.0.0.1:5555`, the LAN address (`192.168.1.20:5555`) and the Tailscale address.
- **Expected:** an ADB handshake, as when connecting from a PC.
- **Actual:** the connection closes with no response (0 bytes) on all three addresses. The same port answers normally from a PC on the same network.
- **Severity:** High.
- **Workaround:** a separate MomPilot server sends the ADB commands from outside the stick.
- **Suggestion:** document this, or offer a grantable permission for remote-control and accessibility apps (key injection and launching apps), so a single TV app could do the job.

## 2. Vega OS sticks can't sideload or use ADB

- **Task:** buy a stick to build and test on.
- **Steps:** compare current Fire TV Stick listings (Fire TV Stick HD 2nd Gen, Fire TV Stick 4K Select).
- **Expected:** a clear note on which OS each stick runs and what that means for developers.
- **Actual:** it's easy to buy a Vega OS stick and only then find it can't install Android APKs or use ADB.
- **Severity:** High (wrong hardware).
- **Workaround:** a refurbished Fire OS stick.
- **Suggestion:** show the OS on product listings, and keep a developer page listing which devices run Fire OS and which run Vega OS.

## 3. Prime Video deep links aren't documented

- **Task:** open a Prime Video title from a link and start playback.
- **Steps:**
  1. Share a title from the Prime Video app (`https://www.primevideo.com/detail/<ID>`).
  2. Open it on the stick with `am start`, using that ID in `https://app.primevideo.com/detail?gti=<ID>`.
  3. Try again with the title's real `gti`.
- **Expected:** the title plays, or at least opens.
- **Actual:**
  - the share-link ID gives error **5004**;
  - with the real `gti`, the `https` link only opens the title page, and pressing OK stops at "Resume".
- **Severity:** Medium.
- **Workaround:** the server reads the title's `amzn1.dv.gti.*` ID from the public title page and opens `amzn://avod/watch?gti=<gti>` in `com.amazon.firebat`, which plays directly.
- **Suggestion:** document Prime Video deep links for Fire TV (open a title, play a title), and accept the IDs found in share links.

## 4. Prime Video can't be opened with standard launcher commands

- **Task:** open the Prime Video app on its home page.
- **Steps:** `adb shell monkey -p com.amazon.firebat -c android.intent.category.LAUNCHER 1`, or `adb shell am start -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER -p com.amazon.firebat`.
- **Expected:** the app opens, as YouTube and Netflix do.
- **Actual:** "No activities found" / "unable to resolve Intent": the app only declares a TV (`LEANBACK_LAUNCHER`) activity, and `am start` with that category doesn't resolve without `DEFAULT`.
- **Severity:** Low.
- **Workaround:** `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER com.amazon.firebat`, then `am start -n` with the component it prints.
- **Suggestion:** have Amazon's own apps also declare a standard launcher activity.

## 5. `input keyevent` is slow on Fire TV

- **Task:** a phone remote that feels like the real one.
- **Steps:** `adb shell input keyevent 20` (Down), ten times in a row.
- **Expected:** a fraction of a second per press.
- **Actual:** about **1 s per key**, so the remote feels broken.
- **Severity:** Medium.
- **Workaround:** find the remote's input device with `getevent -pl` (named `amzkeyboard`) and write key events with `sendevent` to `/dev/input/eventN`: about **0.2 s per key**. Fall back to `input keyevent` if that's refused.
- **Suggestion:** a faster, supported key-injection path, or document `sendevent` for remote-control apps.

## 6. No Fire OS emulator

- **Task:** develop and test without a stick.
- **Steps:** look for a Fire TV emulator; try the Android TV emulator on a cloud VM.
- **Expected:** an emulator image with Fire OS and its apps.
- **Actual:** there's no Fire OS emulator, and the Android TV emulator wouldn't boot on a cloud VM without AVX.
- **Severity:** Medium.
- **Workaround:** a real stick on the desk.
- **Suggestion:** a Fire OS emulator image for Android Studio.

## 7. Screenshots of streaming apps

- **Task:** show the caregiver what's on the TV.
- **Steps:** `adb exec-out screencap -p` with Netflix, YouTube and Prime Video open.
- **Expected:** at least the menus and buttons.
- **Actual:**
  - Netflix returns an empty image;
  - YouTube and Prime Video show the menus, with the video area black.
- **Severity:** Low (expected for DRM).
- **Workaround:** MomPilot explains that the app on screen doesn't allow screen pictures, and suggests pressing Home.
- **Suggestion:** return a clear error instead of an empty image.

## 8. Conflicting Tailscale install instructions for Fire TV

- **Task:** install Tailscale on the stick.
- **Steps:** follow Tailscale's knowledge-base article for Amazon Fire devices, then its GitHub README.
- **Expected:** one clear install path.
- **Actual:** the knowledge base says Tailscale isn't in the Fire TV Appstore; the GitHub README says it is.
- **Severity:** Low.
- **Workaround:** check the Appstore on the stick first; otherwise install the APK as the knowledge base describes.
- **Suggestion:** one source of truth (for Tailscale), and Tailscale listed in the Fire TV Appstore (for Amazon).
