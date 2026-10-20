# MomPilot

**"I'll put it on for you."** Mom can turn on her TV but can't find her way around the Fire TV menus. When she calls, her son taps a saved show on his phone and it starts on her TV. If something needs a button press, such as Netflix's "Who's watching?", he presses it from a remote on his phone.

- **Phone app**: a native Android app (Kotlin, Jetpack Compose), plus a web app for iPhone. Saved shows with search and filters, Share → MomPilot from YouTube, Netflix and Prime Video, a remote, a snapshot of the TV screen, and TV status. A second phone joins the same account by scanning a code.
- **MomPilot server** (Node, no runtime dependencies): keeps the saved shows, finds the TV on your Tailscale network and sets it up over ADB (no typing on the TV), then opens shows in YouTube, Netflix or Prime Video and presses remote keys.
- **MomPilot TV app** (Android, on the stick): shows a QR code until it's set up, then who is connected. Opens shows itself if ADB is unavailable, and runs in the background and after reboots.
- **Tailscale** connects the three privately, with HTTPS from `tailscale serve`. Nothing is exposed to the public internet.

Works with Fire OS sticks (Fire OS 7 and 8). Vega OS sticks (Fire TV Stick 4K Select, Fire TV Stick HD 2nd Gen) block sideloading and ADB, so they can't be used.

- **Set it up:** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Check it works:** [docs/CHECKLIST.md](docs/CHECKLIST.md)
- **Why it's built this way:** [docs/PRD.md](docs/PRD.md) and [docs/PLAN.md](docs/PLAN.md)
- **API:** [server/API.md](server/API.md) · **Android apps:** [android/README.md](android/README.md)

## Develop

Requires Node.js 20.19+ or 22.12+, and Android platform-tools (`adb`) to control a real TV.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. The server runs on port 8787 behind Vite's `/api` proxy.

```sh
npm test
```

For production, `npm run build` then `npm start` serves the app and the API from one process on `127.0.0.1:8787`; publish it on your tailnet with `tailscale serve --bg 8787`. Settings: `PORT`, `HOST`, `ADB_PATH` (found automatically in the Android SDK), `MOMPILOT_DATA_DIR` (default `.local`).

MomPilot is [MIT licensed](LICENSE). Earlier prototype documents are in [docs/archive](docs/archive).
