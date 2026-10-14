# MomPilot local relay API

The Node relay listens on `127.0.0.1:8787` by default. This is a local prototype with passwordless caregiver demo sessions, not production identity or an AWS deployment. Browser requests use same-origin `/api` through the Vite proxy, including cookies. Explicitly binding to a LAN interface is only for a trusted test network.

## Shared shapes

All timestamps are ISO-8601 UTC strings. Errors are `{ "error": "CODE", "message": "Readable explanation" }`. JSON body size is limited to 16 KiB. Device requests send `Authorization: Bearer <token>`; caregiver requests send the httpOnly cookie set by session creation.

- **Device:** `{ id, name, paired, caregiver: {id,name}|null, online, foreground, quiet, lastSeenAt, playback: {itemId,state,position,duration}|null, pairedAt }`. `online` means foreground and heartbeat no older than 15 seconds. Playback states are `PLAYING`, `PAUSED`, `IDLE`, `ENDED`, `FAILED`.
- **Command:** `{ id, deviceId, type, itemId?, messageId?, idempotencyKey, state, reason: string|null, createdAt, expiresAt, updatedAt }`. Commands expire after 30 seconds if unfinished. Types: `PLAY_CATALOG_ITEM`, `SHOW_MESSAGE`, `PAUSE`, `RESUME`, `OPEN_YOUTUBE` (experimental). States: `QUEUED`, `RECEIVED`, `PLAYING`, `DISPLAYED`, `PAUSED`, `LAUNCHED`, `FAILED`, `EXPIRED`.
- **Catalog item:** `{ id, title, subtitle, description, duration, category, thumbnail, videoUrl, attribution: { creator, title, sourceUrl, license, licenseUrl } }`. IDs: `bunny`, `sintel`, `dream`; thumbnails: `/images/bunny.jpg`, `/images/sintel.jpg`, `/images/dream.jpg`. `duration` is a display string. Only these server-curated video URLs may play.
- **Preset:** `{ id, text }`; IDs `found-video` = `I found the video for you ❤️`, `enjoy` = `Sit back and enjoy. Love you!`, `call-me` = `Give me a call when you’re ready.`

## Caregiver endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/session` | `{name}` (1–60 characters) | `{caregiver:{id,name}}`; with a valid cookie updates the existing profile and paired TVs (200), otherwise creates a demo identity and httpOnly SameSite=Strict session cookie (201) |
| GET | `/api/session` | — | `{caregiver:{id,name}}` or 401 |
| DELETE | `/api/session` | — | `{ok:true}`; clears session cookie |
| GET | `/api/catalog` | — | `{items,presets}`; public, also usable by TV |
| POST | `/api/pair` | `{code,name}` (six digits, TV name 1–60 characters) | `{device}`; single-use code expires after five minutes |
| GET | `/api/devices` | — | `{devices}`; only this session's paired devices |
| GET | `/api/devices/:id` | — | `{device,commands}`; newest 50 command records, newest first |
| PATCH | `/api/devices/:id` | `{name}` | `{device}` |
| POST | `/api/devices/:id/commands` | `{type,itemId?,messageId?,idempotencyKey}` | `{command}`; 201 when queued, 200 for identical retry |

Command sends require an online foreground device and quiet mode off, otherwise 409 `DEVICE_UNAVAILABLE` or `QUIET_MODE`. `PLAY_CATALOG_ITEM` requires a valid `itemId`; `SHOW_MESSAGE` requires a preset `messageId`. `PAUSE`/`RESUME` act only on the existing MomPilot player. The idempotency key is required (1–128 characters); reusing it with different payload returns 409 `IDEMPOTENCY_CONFLICT`. Retries return the original record without executing again, including after its expiry. Device ownership failure returns 404. Caregiver sessions created without a valid cookie are separate demo identities; refreshing and editing a name preserve the current identity.

## TV endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/tv/register` | `{}` | `{deviceId,token,code,expiresAt}`; persist device credential locally |
| POST | `/api/tv/pairing` | `{}` | `{code,expiresAt}`; generates new code while unpaired |
| GET | `/api/tv/commands` | — | `{commands,device}`; oldest first, only unexpired QUEUED/RECEIVED commands |
| POST | `/api/tv/heartbeat` | `{foreground,quiet?,playback?}` | `{device}`; send every 5 seconds and on visibility/player changes |
| POST | `/api/tv/ack` | `{id,state,reason?,foreground?}` | `{command}`; `foreground:false` is required exclusively with `OPEN_YOUTUBE` → `LAUNCHED` |
| POST | `/api/tv/settings` | `{quiet:boolean}` | `{device}`; entering quiet mode fails pending caregiver commands |
| POST | `/api/tv/revoke` | `{}` | `{device,code,expiresAt}`; unpairs, fails pending commands, creates a new pairing code |

Registration is the only TV endpoint without a bearer token. Registration marks the app foreground with a current heartbeat. Heartbeats must explicitly include boolean `foreground`; `playback` may be null to reset. Position/duration are seconds. The TV must fetch the curated catalog and resolve `itemId` there; command payloads never contain an arbitrary URL.

Poll every 1–2 seconds only while foreground. On each new command: acknowledge `RECEIVED` before execution, deduplicate IDs locally, then acknowledge `PLAYING` for play/resume, `PAUSED` for pause, `DISPLAYED` for a message, or `FAILED` with a reason. A repeat of the same ack is safe. Invalid state transitions return 409. The server requires `RECEIVED` before a successful result. Expired or previously completed commands must never execute. Honor `device.quiet` locally too. The final result acknowledges this command's effect; subsequent player changes belong in heartbeats.

Turning quiet mode on or sending `foreground:false` invalidates pending commands, preventing delayed surprises. Revocation leaves the TV's own credential valid to pair again but immediately removes caregiver access. These are local device credentials, never AWS secrets. Credentials are hashed in the store and never returned again after registration.

## Experimental YouTube handoff

The only allowed external-launch payload is `{type:"OPEN_YOUTUBE",itemId:"bunny",idempotencyKey:"<unique key>"}`. Clients map `bunny` to the fixed approved YouTube video; the relay never accepts a URL, video ID, package name, freeform message, or other item ID. Existing ownership, foreground, quiet mode, expiry, and idempotency rules apply.

The TV acknowledges `{id,state:"RECEIVED"}`, attempts the approved external launch, then acknowledges `{id,state:"LAUNCHED",foreground:false}`. `LAUNCHED` confirms only the external launch; it does not confirm playback, autoplay, sound, or availability of the requested video. Launch failures use the normal `{id,state:"FAILED",reason}` payload. Other command types cannot report `LAUNCHED`, and all other acknowledgments reject the `foreground` field.

The first `LAUNCHED` acknowledgment must arrive while the relay still considers MomPilot online and foreground. It atomically records the successful terminal state, marks the device foreground false, pauses existing MomPilot playback metadata, and fails all other pending commands. The TV must coordinate lifecycle reporting so a separate background heartbeat does not invalidate the launch command before its terminal acknowledgment. Afterward, caregivers see the TV unavailable until MomPilot returns and sends a fresh foreground heartbeat. Repeating the same `LAUNCHED` acknowledgment is safe and does not take a resumed device offline again or cancel its newer commands.

If the launch result expires before acknowledgment, the relay reports `EXPIRED` with an explanation that the launch is unconfirmed and the external app may already have opened. This experimental path requires real Fire TV validation and makes no claim of YouTube playback control or background operation.

## Runtime

`node server/index.mjs` starts the relay. Environment: `PORT=8787`, `HOST=127.0.0.1`, `MOMPILOT_DATA_DIR=.local`. Data is persisted to `.local/relay.json` using an atomic replacement. For meaningful tests, `createRelay({dataDir,now,pairingTtlMs,commandTtlMs,heartbeatTimeoutMs,rateLimit})` in `server/relay.mjs` returns `{server,close}`; tests can use a random port. The relay also serves an explicit allowlist of the three catalog images at `/images/{bunny,sintel,dream}.jpg` from `public/images/` so the native TV app can resolve artwork. No production deployment, cross-network TLS, account verification, or wake/background delivery is implemented.
