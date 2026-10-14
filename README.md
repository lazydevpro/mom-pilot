# MomPilot

**“I’ll put it on for you.”** A caregiver picks a video or a reassuring message; a paired, open MomPilot TV app receives it and reports the result.

This repository contains a runnable local prototype: a React caregiver app, a browser TV demo, a Node relay, and native Kotlin source with a compiled debug APK. The browser TV is useful for trying the flow on one computer. Native runtime testing, physical Fire TV testing, and an AWS deployment remain separate next steps.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm. From this directory:

```sh
npm install
npm run dev
```

Open [the caregiver app](http://127.0.0.1:5173) and [the TV demo](http://127.0.0.1:5173/tv) in separate windows. The web app uses port **5173** and the relay uses **8787**. Keep the TV window visible; its presence represents an open app, not a powered-on television.

1. Open the TV demo and read its six-digit pairing code.
2. In the caregiver demo, choose **Connect a TV**, enter the code, and name the TV. The initial demo profile is **Varish**; its name can be edited from the profile menu.
3. Choose a catalog video, review it, and send it to the TV.
4. Watch the acknowledged delivery state, send a help message, and dismiss it on the TV.
5. Try the TV’s quiet mode, **Simulate app closed**, or revoke access to see the caregiver’s state change.

A browser may block remote playback until someone presses **Play** on the TV page. The app reports that condition; a queued or received command alone does not mean the video is playing. Internet access is required for externally hosted sample media.

```sh
npm test
npm run build
```

The build creates web files in `dist/`. It does not deploy a server or build an Android APK. Stop both development processes with Ctrl+C.

## Fire OS source

Open [`android/`](android/) in Android Studio and follow [the Android setup guide](android/README.md). The Gradle 8.11.1 wrapper build and Android lint passed on 30 September 2026, with zero lint errors and 18 warnings; APK details are in that guide. On a physical Fire TV, `127.0.0.1` is the television itself: configure the relay’s reachable LAN address as described there. Compilation and the browser demo do not establish runtime behavior on Fire OS or compatibility with Vega OS.

## What this version demonstrates

- Expiring, single-use pairing; caregiver ownership; parent-side revocation.
- An allowlisted video catalog and preset assistance messages.
- Foreground command polling, acknowledgments, expiry, deduplication, heartbeat presence, and explicit failure states.
- In-app playback and pause/resume, with parent-side quiet mode.
- A limited **YouTube experiment** in the Big Buck Bunny preview: the native client attempts one fixed video in the Android TV YouTube package. `LAUNCHED` means Android accepted the intent; playback is unverified. The browser receiver rejects this unsupported action with an explained failure.

The YouTube experiment pauses MomPilot remote help when the launch is acknowledged; reopen MomPilot to receive new requests. Its explicit package target is Android TV only; no Fire OS YouTube package or successful device playback is claimed. It cannot pause, inspect, or otherwise control YouTube playback.

The name-only caregiver session is **demo identity, not account authentication**. The relay is local HTTP with file persistence, not a production service. AWS, verified account invitations, scheduled quiet hours, television wake-up, and universal control of other apps are not implemented. Remote command delivery across independent networks has not been demonstrated by this local setup.

## Read more

- [Architecture and boundaries](docs/ARCHITECTURE.md) · [API contract](server/API.md)
- [Manual test plan and acceptance mapping](docs/TESTING.md) · [Fire TV feasibility checklist](docs/DEVICE-SPIKE.md)
- [Recorded local verification results](docs/VERIFICATION.md)
- [Planned AWS migration](docs/AWS.md) · [Two-minute local demo script](docs/DEMO.md)
- [Content credits and licenses](docs/CONTENT.md) · [Original PRD](docs/PRD.md)

MomPilot source is [MIT licensed](LICENSE). Demo movies and still images keep their own Creative Commons licenses; see the content credits. No Amazon, Blender, Google, or W3C endorsement is implied.
