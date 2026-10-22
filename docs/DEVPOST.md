# Devpost submission text

Copy each section into the matching Devpost field. It's written in your voice ("I"): read each line and change anything that isn't true for you. Items marked **[fill in]** need your details.

---

## Name and tagline

**MomPilot**: remote Fire TV assistance for parents.

## Elevator pitch (short description)

My mom can't navigate Fire TV menus. With MomPilot, I tap a saved show on my phone from the office and it plays on her TV: YouTube, Netflix or Prime Video. No remote.

## About the project

### Inspiration

My mom is staying with me for a short medical treatment. I'm at the office most of the day, so she's alone at home, and the days are long with nobody around. She has a TV and can turn it on, but the Fire TV home screen, app rows and profile pickers are too much for her. When she wanted to watch something, she'd call me and I'd try to talk her through it, button by button, over the phone. That doesn't work. I wanted to just put her show on for her, from my office.

### What it does

- **Saved shows:** I keep a list of Mom's shows and films on my phone, like a playlist she can watch one by one. I add them by sharing a link from the YouTube, Netflix or Prime Video app to MomPilot, or by pasting one. Search and app filters keep the list easy to use.
- **One tap to play:** tapping a show opens it on Mom's Fire TV in the right app and starts playback. YouTube and Prime Video play directly; Netflix opens the title and plays it.
- **A remote in my pocket:** if something needs a button press, like Netflix's "Who's watching?", I use the remote on my phone: arrows, OK, Back, Home, play/pause, volume, and wake. **See TV screen** shows me a snapshot of what's on her TV.
- **Status:** the phone shows whether the TV is reachable and which app is open.
- **Setup with no typing on the TV:** the MomPilot TV app shows a QR code. I scan it with my phone, Mom presses **Allow** once, and the TV says "You're all set". Another phone joins the same account by scanning a code from mine.

Mom doesn't have to do anything except turn on the TV.

### How I built it

- **Mom's Fire TV Stick** (Fire OS) runs Tailscale and has ADB debugging on.
- **A small Node.js server** (no runtime dependencies) runs on an always-on cloud machine (Oracle Cloud) on the same Tailscale network. It keeps the saved shows and talks to the stick over **ADB across Tailscale**:
  - it opens shows with deep links into the YouTube, Netflix and Prime Video apps;
  - it sends remote keys by writing input events straight to the stick's input device, which takes about 0.2 s per key instead of about 1 s with `input keyevent`.
- **A native Android phone app** (Kotlin, Jetpack Compose) for the saved list, remote and setup. QR codes are scanned with Google's code scanner, so no camera permission is needed. A web app (React, TypeScript, Vite) covers iPhones.
- **The MomPilot TV app** (Kotlin, on the stick) shows the setup QR code and runs a small background service. It is a fallback: if ADB isn't available, it opens the show itself. The server installs and configures it over ADB during setup, through a broadcast receiver that only ADB is allowed to send to. That's why nothing is typed on the TV.
- **Tailscale** connects everything privately, with an HTTPS address from `tailscale serve`. Nothing is exposed to the public internet. The server finds the TV on the tailnet by itself, so setup is "scan, Allow, done".

### Challenges I ran into

- **Prime Video deep links aren't documented.** The web link opens the title page; the TV app rejects the ID in share links (error 5004). I worked out that the server has to look up the title's `gti` ID and open `amzn://avod/watch?gti=…` to start playback directly.
- **Fire OS blocks ADB connections from the stick itself**, on `127.0.0.1`, the LAN address and the Tailscale address. I'd hoped to put everything into one TV app with Tailscale built in. Instead, a small server sends the commands from outside.
- **Remote keys were slow.** `input keyevent` takes about a second per press on the stick, which feels broken. Writing events to `/dev/input` with `sendevent` made the remote feel instant.
- **Picking the right stick.** The newest Fire TV sticks run Vega OS, which doesn't allow sideloading or ADB. I had to get an older Fire OS stick.
- **Setup without typing.** Typing a server address with a TV remote is too hard for a parent. The QR code plus ADB-based setup took several attempts to get right.

### Accomplishments that I'm proud of

- It really works from my office, over mobile data: tap a show, and it plays on Mom's TV.
- The whole TV setup is: scan a code, press Allow once, done. About ten seconds, including installing the TV app.
- The remote is fast enough to use like a real one.

### What I learned

- A lot about how Fire OS launches apps: activities, deep-link formats, and which ones each streaming app accepts.
- That for people like my mom, the best interface is none at all: she shouldn't need to learn anything new.

### What's next for MomPilot

- **Tailscale built into MomPilot**, so there's nothing else to install and it's faster and more reliable: install MomPilot, and it works end to end.
- **More apps** beyond YouTube, Netflix and Prime Video.
- **A Vega OS version** for the newer sticks, if Vega allows the same kind of control.

## Built with

`kotlin` `jetpack-compose` `android` `fire-os` `fire-tv` `adb` `tailscale` `node.js` `oracle-cloud` `react` `typescript` `vite` `ml-kit` `zxing`

## Try it out (links)

- GitHub: https://github.com/lazydevpro/mom-pilot (private, shared with the reviewers)
- APKs: https://github.com/lazydevpro/mom-pilot/releases/tag/v0.4.1
- Demo video: **[fill in]**

## Testing instructions

MomPilot controls a real Fire TV, so testing needs:

- a **Fire OS** stick (Fire OS 7 or 8). Vega OS sticks (Fire TV Stick 4K Select, Fire TV Stick HD 2nd Gen) don't allow sideloading or ADB;
- a free **Tailscale** account, with Tailscale on the stick, the phone and the server;
- a PC (Windows, macOS or Linux) with Node.js 22 and Android platform-tools, for the server;
- an Android phone (or an iPhone, using the web app).

Steps (full guide: `docs/DEPLOY.md`):

1. On the PC: `git clone`, `npm ci`, `npm run build`, `npm start`, then `tailscale serve --bg 8787`.
2. On the stick: turn on ADB debugging (Settings → My Fire TV → About → select the device name 7 times → Developer Options), install Tailscale, and sign in to YouTube, Netflix and Prime Video.
3. On the phone: install `MomPilot-phone-0.4.1.apk` from the release, type your name, tap **Change** to enter your server address, then **Scan the code on Mom's TV**. If the TV app isn't installed yet, choose **Set up without a TV for now**, then **TV → Add Mom's TV** and tap the stick; the server installs it. Press **Allow** on the TV when asked.
4. Share a YouTube video to MomPilot, tap it, and it plays on the TV. Try the Remote tab.

`docs/CHECKLIST.md` lists everything to check on a real device. The server's tests run with `npm test`.

---

## Product feedback

### Fire OS / Fire TV

- **What I used it for:** the target device. MomPilot opens shows with deep links into the YouTube, Netflix and Prime Video apps, sends remote keys over ADB, and runs a small TV app with a foreground service and a boot receiver.
- **What worked well:** Fire OS is Android underneath, so standard Android tools, intents and ADB all worked. YouTube and Netflix deep links behaved as expected. Turning on developer options was quick once I knew where it was.
- **What needs work:**
  - ADB connections from the device itself are blocked, which rules out on-device automation or a single app with a built-in VPN.
  - Prime Video's deep links aren't documented, and its share-link IDs don't work in the TV app.
  - `input keyevent` is slow (about 1 s per key).
  - It's hard to tell before buying which sticks are Fire OS and which are Vega OS, and Vega can't sideload.
- **Onboarding:** there's no Fire OS emulator, so all testing needed a real stick. The developer-options steps (select the device name 7 times) are easy to miss.
- **Would I use it again?** Yes. It's the TV my family already has, and once I had a Fire OS stick, building for it was fast.

### ADB (Android Debug Bridge)

- **What I used it for:** controlling Mom's stick from the server over Tailscale: opening shows, pressing keys, taking screen snapshots, checking which app is open, and installing and configuring the TV app during setup.
- **What worked well:** ADB over the network was reliable across Tailscale. The "Always allow" option meant Mom pressed Allow only once. `sendevent` gave a fast remote.
- **What needs work:** some error messages are vague. "failed to authenticate" means "press Allow on the TV", but reads like a network error. After network changes, a connection can show as offline until it's reconnected.
- **Onboarding:** easy for anyone who knows Android; the main hurdle is finding developer options on the TV.
- **Would I use it again?** Yes.

### Amazon Appstore and sideloading

- **What I used it for:** the streaming apps and Tailscale on the stick. The MomPilot TV app is sideloaded by the server over ADB.
- **What worked well:** installing over ADB was quick and needed nothing from Mom; `adb install -r` updates in place.
- **What needs work:** it's unclear whether Tailscale is in the Fire TV Appstore: Tailscale's docs say it isn't, while its GitHub README says it is. Store listings for the newer sticks don't make clear that they can't sideload.
- **Would I use it again?** Yes, and I'd like to publish the TV app there.

### Tailscale

- **What I used it for:** a private network between my phone, my PC and Mom's stick, with an HTTPS address for the server from `tailscale serve`. The server uses `tailscale status --json` to find the TV for setup.
- **What worked well:** MagicDNS plus HTTPS certificates gave the server a real HTTPS address with one command. ADB across the tailnet worked from my office on mobile data. Signing in on the TV by scanning a QR code was easy.
- **What needs work:** the Fire TV UI has no always-on VPN setting; I had to set the hidden secure setting `always_on_vpn_app` over ADB. On my Xiaomi phone, Tailscale sometimes dropped and needed to be turned off and on.
- **Onboarding:** very quick: an account, an app on each device, done.
- **Would I use it again?** Yes, definitely.

### Android SDK, Kotlin and Jetpack Compose

- **What I used it for:** the phone app (Compose) and the TV app (Kotlin, Android Views).
- **What worked well:** Compose made the phone screens quick to build. R8 kept the APKs small. Share targets made "Share → MomPilot" from YouTube, Netflix and Prime Video simple.
- **What needs work:** small Gradle and resource surprises, such as escaping `C\:` in `local.properties` and where adaptive icons have to live.
- **Would I use it again?** Yes.

### Google code scanner (ML Kit)

- **What I used it for:** scanning the TV's setup QR code and a second phone's join code.
- **What worked well:** no camera permission or camera code; one call opens a scanner.
- **What needs work:** it needs Google Play services, so it won't work on phones without them.
- **Would I use it again?** Yes.

### Node.js

- **What I used it for:** the server: HTTP API, JSON storage, running `adb` and `tailscale`, and tests with the built-in test runner.
- **What worked well:** no runtime dependencies needed; `node --test` covered the server.
- **Would I use it again?** Yes.

### React, TypeScript and Vite

- **What I used it for:** the web app for iPhones.
- **What worked well:** fast to build and reload; works as a home-screen app.
- **Would I use it again?** Yes.

---

## Friction log

Severity: **High** blocks the task, **Medium** costs hours, **Low** is a small annoyance.

### 1. Fire OS blocks ADB from the device itself

- **Task:** control the TV from an app on the TV (for a one-app design with built-in Tailscale).
- **Steps:** on the stick (Fire OS 7.7.1.7), open an ADB connection to `127.0.0.1:5555`, the LAN address and the Tailscale address.
- **Expected:** an ADB handshake, as when connecting from a PC.
- **Actual:** the connection closes with no response on all three addresses. The same port answers normally from the PC.
- **Severity:** High.
- **Workaround:** a separate server sends the ADB commands from outside the stick.
- **Suggestion:** document this, or offer a permission for accessibility-style control apps.

### 2. Vega OS sticks can't sideload or use ADB

- **Task:** buy a stick to build and test on.
- **Steps:** look at current Fire TV Stick listings (Fire TV Stick HD 2nd Gen, 4K Select).
- **Expected:** a clear note on which OS each stick runs and what that means for sideloading.
- **Actual:** it's easy to buy a Vega OS stick and only then find it can't run Android APKs or ADB.
- **Severity:** High (wrong hardware).
- **Workaround:** a refurbished Fire OS stick.
- **Suggestion:** show the OS on listings, and keep a developer page of which devices run which OS.

### 3. Prime Video deep links aren't documented

- **Task:** open a Prime Video title from a link and start playback.
- **Steps:**
  1. Share a title from the Prime Video app (`primevideo.com/detail/<ID>`).
  2. Open it on the stick with `am start`, using that ID in `https://app.primevideo.com/detail?gti=…`.
  3. Then try the title's real `gti`.
- **Expected:** the title plays, or at least opens.
- **Actual:**
  - the share-link ID gives error 5004;
  - with the real `gti`, the `https` link only opens the title page, and pressing OK stops at "Resume".
- **Severity:** Medium.
- **Workaround:** the server reads the title's `amzn1.dv.gti.*` ID from the public page and opens `amzn://avod/watch?gti=…`, which plays directly.
- **Suggestion:** document Prime Video deep links for Fire TV (open a title, play it), and accept the IDs in share links.

### 4. Prime Video can't be opened with standard launcher commands

- **Task:** open the Prime Video app on its home page.
- **Steps:** `monkey -p com.amazon.firebat -c android.intent.category.LAUNCHER 1`, or `am start -a MAIN -c LEANBACK_LAUNCHER -p com.amazon.firebat`.
- **Expected:** the app opens, as YouTube and Netflix do.
- **Actual:** "No activities found" / unable to resolve, because the app only has a TV launcher activity.
- **Severity:** Low.
- **Workaround:** `cmd package resolve-activity --brief -a MAIN -c LEANBACK_LAUNCHER com.amazon.firebat`, then `am start -n` with the result.
- **Suggestion:** have Amazon's own apps also declare a standard launcher activity.

### 5. `input keyevent` is slow on Fire TV

- **Task:** a phone remote that feels like the real one.
- **Steps:** send `adb shell input keyevent 20` (Down) ten times.
- **Expected:** a fraction of a second per press.
- **Actual:** about 1 s per key, so the remote feels broken.
- **Severity:** Medium.
- **Workaround:** find the remote's input device with `getevent -pl` and write key events with `sendevent`: about 0.2 s per key.
- **Suggestion:** a faster key-injection path, or document `sendevent` for remote-control apps.

### 6. No Fire OS emulator

- **Task:** develop and test without a stick.
- **Steps:** look for a Fire TV emulator; try the Android TV emulator on a cloud VM.
- **Expected:** an emulator with Fire OS and its apps.
- **Actual:** there's no Fire OS emulator, and the Android TV emulator wouldn't boot on a cloud VM without AVX.
- **Severity:** Medium.
- **Workaround:** a real stick on the desk.
- **Suggestion:** a Fire OS emulator image for Android Studio.

### 7. Screenshots of streaming apps

- **Task:** show the caregiver what's on the TV.
- **Steps:** `adb exec-out screencap -p` with Netflix, YouTube and Prime Video open.
- **Expected:** at least the menus and buttons.
- **Actual:**
  - Netflix returns an empty image;
  - YouTube and Prime Video show the menus, with the video area black.
- **Severity:** Low (expected for DRM).
- **Workaround:** MomPilot explains that the app on screen doesn't allow screen pictures, and suggests pressing Home.
- **Suggestion:** none needed for video; an empty image could come with a clear error instead.

### 8. Conflicting Tailscale install instructions for Fire TV

- **Task:** install Tailscale on the stick.
- **Steps:** follow Tailscale's knowledge-base article, then its GitHub README.
- **Expected:** one clear install path.
- **Actual:** the knowledge base says it isn't in the Fire TV Appstore; the GitHub README says it is.
- **Severity:** Low.
- **Workaround:** check the Appstore on the stick first; otherwise install the APK as the knowledge base describes.
- **Suggestion:** one source of truth (for Tailscale), and Tailscale in the Fire TV Appstore (for Amazon).

### 9. The Devpost rules page blocks automated reading

- **Task:** check the rules with an AI coding assistant.
- **Steps:** fetch https://amazonappdev2026.devpost.com/rules.
- **Expected:** the page text.
- **Actual:** a Cloudflare bot check.
- **Severity:** Low.
- **Workaround:** open the page in a browser and read it there.
- **Suggestion:** a plain-text or PDF copy of the rules.
