# MomPilot server API

The Node server listens on `127.0.0.1:8787` by default (`HOST`, `PORT`, `MOMPILOT_DATA_DIR` and `ADB_PATH` change this). Run it on a machine in the same Tailscale network as Mom's Fire TV Stick; don't expose it to the public internet. The web app reaches it through the Vite `/api` proxy, with cookies.

Errors are `{ "error": "CODE", "message": "Readable explanation" }`. JSON bodies are limited to 16 KiB. Caregiver requests use the httpOnly session cookie; TV app requests send `Authorization: Bearer <token>`.

## Shapes

- **Show:** `{ id, title, link, app, contentId, image, createdAt }`. `app` is `youtube`, `netflix` or `prime`. `image` is a YouTube thumbnail or `null`.
- **Device:** `{ id, name, paired, caregiver: {id,name}|null, appOnline, lastSeenAt, pairedAt, adbTarget }`. `appOnline` means the TV app polled within 15 seconds. `adbTarget` is `host:port` (port 5550–5589) or `null`.
- **ADB status:** `{ state: 'CONNECTED', awake, app, package }` or `{ state: 'NOT_SET' | <error code>, message }`. `app` is `youtube`, `netflix`, `prime`, `home` or `null`. Cached for 4 seconds.
- **Command:** `{ id, deviceId, type, app, showId?, title?, idempotencyKey, via: 'adb'|'tv'|null, state, reason, launch?, createdAt, expiresAt, updatedAt }`. States: `QUEUED` → `RECEIVED` → `LAUNCHED`, or `FAILED` / `EXPIRED` (30 seconds). Only opening shows and apps is recorded; the newest 50 per TV are kept.

## Caregiver endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/session` | `{name}` | `{caregiver}`; 201 with a new session cookie, or 200 renaming the current account on every phone |
| GET | `/api/session` | — | `{caregiver}`; renews the 400-day session and its cookie |
| DELETE | `/api/session` | — | `{ok:true}`; signs out this phone only |
| POST | `/api/session/link` | `{}` | `{code, expiresAt}`: a six-digit code, valid 10 minutes, once, to sign in another phone to the same account |
| POST | `/api/session/join` | `{code}` | `{caregiver}` (201) with a session cookie for the same account; rate-limited per IP |
| GET | `/api/apps` | — | `{apps:[{id,name}], keys:[…]}` |
| GET | `/api/shows` | — | `{shows}` (yours only) |
| POST | `/api/shows` | `{title, link}` | `{show}` (201). Accepts YouTube (`watch`, `youtu.be`, `shorts`, `live`), Netflix (`/title/ID`, `/watch/ID`, with or without a country) and Prime Video (`gti=` links, `/detail/ID`, Amazon `/gp/video/detail/ASIN`, and `amzn.in` short links) |
| DELETE | `/api/shows/:id` | — | `{ok:true}` |
| GET | `/api/tvs/nearby` | — | `{tvs:[{name, address, adb, added}]}`: online Android devices on the tailnet (`tailscale status`), with whether ADB answers on 5555 |
| POST | `/api/tvs/setup` | `{address, name?, serverUrl?}` | `{device}` (201 new, 200 again). Connects over ADB (`502 ADB_UNAUTHORIZED` until **Allow** is pressed on the TV; the phone retries), checks it's a Fire TV, installs or updates the TV app if the server has its APK, then hands the TV app the server address and a new credential. `409 TV_ALREADY_CONNECTED` if another account has it; `409 NO_SERVER_ADDRESS` if no public address is known |
| GET | `/api/server` | — | `{publicUrl}`: `PUBLIC_URL` or this machine's `tailscale serve` HTTPS address |
| GET | `/download/mompilot.apk` | — | The Android phone app, if built |
| POST | `/api/pair` | `{code, name}` | `{device}`; older code-based pairing, kept for compatibility |
| GET | `/api/devices` | — | `{devices}` |
| GET | `/api/devices/:id` | — | `{device, adb, commands}` (newest 20 commands first) |
| PATCH | `/api/devices/:id` | `{name?, adbTarget?}` | `{device}`; `adbTarget` such as `100.101.102.103:5555` or `null` |
| POST | `/api/devices/:id/commands` | see below | see below |
| GET | `/api/devices/:id/snapshot` | — | `image/png` of the TV screen (needs `adbTarget`) |

Commands:

- `{type:'OPEN_SHOW', showId, idempotencyKey}` and `{type:'OPEN_APP', app, idempotencyKey}`: opened over ADB when `adbTarget` is set (`201`, `via:'adb'`, `LAUNCHED`). If ADB isn't set or fails and the TV app is online, the command is queued for the TV app (`201`, `via:'tv'`, `QUEUED`). Otherwise `409` with a `FAILED` command and its reason. Repeating an idempotency key returns the original command (`200`); reusing it for a different action is `409 IDEMPOTENCY_CONFLICT`.
- `{type:'KEY', key}` with `key` one of `up down left right ok back home playPause rewind fastForward volumeUp volumeDown mute`, and `{type:'WAKE'}`: sent over ADB immediately; `200 {ok:true}`. `409 ADB_NOT_SET` without an address.

ADB error codes: `ADB_OFFLINE`, `ADB_UNAUTHORIZED` (Mom needs to press Allow on the TV), `ADB_TIMEOUT`, `ADB_LAUNCH_FAILED` (app missing or link not accepted), all `502`; `ADB_MISSING` (no adb on the server) is `500`.

## TV app endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/tv/register` | `{}` | `{deviceId, token, code, expiresAt}` (201). The token is shown once |
| POST | `/api/tv/pairing` | `{}` | `{code, expiresAt}`; only while unpaired |
| GET | `/api/tv/commands` | — | `{device, commands}`: queued and received commands, each with a `launch` intent `{component?, action?, data?, flags?, extras?, package?, forceStop?}`. Polling marks the app online |
| POST | `/api/tv/heartbeat` | `{}` | `{device}` |
| POST | `/api/tv/ack` | `{id, state, reason?}` | `{command}`. `RECEIVED` (from `QUEUED`), then `LAUNCHED` or `FAILED` (with an optional reason). Repeating the current state is accepted |
| POST | `/api/tv/revoke` | `{}` | `{device, code, expiresAt}`; removes the caregiver, ADB address and history, and shows a new code |

Cross-site mutations (`Sec-Fetch-Site: cross-site`) and non-JSON bodies are rejected. Pairing, session creation and TV registration are rate-limited per IP; commands are limited to 600 a minute per caregiver and TV.
