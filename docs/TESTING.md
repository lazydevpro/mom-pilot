# Verification and acceptance mapping

Run the relay tests and web compile/build from the repository root:

```sh
npm test
npm run build
```

The current local verification includes **22 passing Node tests**, a successful Gradle **8.11.1 wrapper** `:app:assembleDebug` / `:app:lintDebug` run, and **zero lint errors with 18 warnings**. The browser receiver’s explicit rejection of `OPEN_YOUTUBE` was also exercised. See [the verification record](VERIFICATION.md) and [APK identity](../android/README.md) for the build evidence.

The procedure below remains a repeatable manual test plan, not a claim that every case was executed. Native emulator runtime tests have not completed; the Android 14 TV boot attempt remained ADB-offline. Physical Fire TV behavior, actual YouTube launch/playback, cloud operation, and cross-network latency require separate validation.

## Local browser check

Use two visible browser windows: caregiver `/` and TV `/tv`. Keep the TV window visible when sending commands. Use a separate private browser session only when testing an unrelated caregiver identity.

| Scenario | Steps | Expected result |
| --- | --- | --- |
| First pairing | Open the caregiver demo (initial profile: Varish) and enter the current TV code | Both clients show paired state; caregiver sees the chosen TV name. |
| Wrong/expired code | Enter a wrong code; separately let a valid code expire | Clear failure; no unintended device association. |
| Single-use code | Try pairing a consumed code from a different browser session | Pairing fails. |
| Play | Select an item, inspect preview/credits, and send it | Command is received; actual playback yields Playing, or an explained failure appears. |
| Browser autoplay | Use a fresh browser context that blocks autoplay | TV offers local Play and caregiver does not receive a false successful playback result. |
| YouTube on browser receiver | In Big Buck Bunny’s preview, choose **Try opening YouTube on TV** while paired to `/tv` | The browser receiver reports unsupported `FAILED`; it never claims `LAUNCHED` or playback. |
| Help | Send each preset and dismiss it on TV | Correct card appears; dismissal returns focus sensibly. |
| Pause / resume | Use controls while an in-app video is playing | TV changes playback; command result and heartbeat match. |
| Quiet mode | Enable quiet mode on TV and try another send | Send is rejected with an explanation; local TV remains usable. |
| Offline state | Close the TV window and wait at least 15 seconds | Caregiver reports unavailable; a new send does not promise playback. |
| Simulated app exit | Select **Simulate app closed** on the browser TV | Foreground becomes false and requests are blocked; reopening restores presence. |
| Reconnect | Open the TV again and wait for a heartbeat | It becomes available without replaying expired commands. |
| Revocation | Revoke access on TV, then use the previous caregiver view | Access is removed; TV offers a fresh pairing flow. |
| Persistence | Restart the relay and refresh both clients | Stored pairing survives; expired commands remain expired. |
| Unknown identity | Use a new private caregiver session | It cannot see or command another session’s paired TV. |
| Narrow layout | Use a phone-size browser viewport | Device status, preview, and send action remain readable and reachable. |
| Keyboard | Navigate without a pointer | Focus is visible, dialogs are operable, and no action requires a hover. |

## Contract checks

The relay test suite should cover ownership, expiring/single-use pairing codes, command validation, duplicate keys, invalid acknowledgments, command expiry, quiet mode, revocation, heartbeat timeout, and persistence. Review the actual tests for current coverage; do not infer physical client behavior from a passing server test. See [the API contract](../server/API.md) for precise status codes and payloads.

An expired command must never be revived by a late acknowledgment. A `RECEIVED` result is insufficient to label a video Playing. Arbitrary URLs, arbitrary packages, shell commands, and arbitrary remote keys are outside the command schema.

The YouTube contract checks cover the fixed `bunny` item allowlist, idempotency, receipt-before-result, type-matched `LAUNCHED`, required `foreground:false`, atomic offline transition and cancellation of pending work, safe acknowledgment retry after resume, and unconfirmed expiry. They validate relay semantics, not a real YouTube app launch. On native Android TV, record Android intent acceptance separately from exact-video selection, autoplay, prompts, sound, and Back behavior. The configured `com.google.android.youtube.tv` package does not establish Fire OS compatibility.

## PRD traceability

| PRD requirement | Local deliverable | Remaining acceptance work |
| --- | --- | --- |
| P0: Pair TV and caregiver | Five-minute six-digit code, paired caregiver display, TV-side revocation | Verified caregiver identity/invitations and hardware exercise. |
| P0: Remote command delivery | Real local HTTP relay, acknowledgments, expiry, deduplication | Authenticated TLS deployment and tests across independent networks. |
| P0: Curated content | Three licensed Blender movie/preview entries, fixed catalog IDs, credits | Playback/audio validation for every entry on actual hardware. |
| P0: Parent-first home | Browser TV interface and native source with remote-friendly controls | Ten-foot readability and complete D-pad usability on the target device. |
| P0: Availability | Foreground heartbeat with a 15-second timeout, explicit failures | Sleep/reboot/network behavior measured on device. |
| P0: Assistance card | Preset messages and local dismissal | Remote focus and dismissal verified on hardware. |
| P1: YouTube exact-video launch | Fixed Big Buck Bunny `OPEN_YOUTUBE` experiment and caregiver preview action; native Android TV package only; honest `LAUNCHED` state and browser rejection | Native runtime observation, exact-video/autoplay checks, and separate Fire OS package discovery/testing; not a core demo dependency. |
| P1: Saved family shortcuts | Caregiver catalog favorites, local browser persistence | Production account persistence and broader content curation. |
| P2: In-app playback control | Pause/resume command contract and client controls | Hardware validation; remote seek remains out of scope. |
| Quiet window | Manual parent-side quiet toggle | Scheduled quiet hours and timezone behavior. |
| Security/privacy | Scoped local device credentials, allowlist, rate limits, no screen capture | Real identity, HTTPS deployment, credential rotation, retention policy, and security review. |
| AWS Builder path | Architecture/migration notes | Runtime integration and evidence; no AWS resources are implemented. |

## Measured demo log

Use this template for each hardware/cross-network run. Do not prefill successful values.

| Trial | Device/build | Network pair | Command ID | Sent at | Received at | Result at | Actual TV result | Explanation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1–10 | Not run | Not run | — | — | — | — | — | — |

Report receipt latency separately from playback startup. A media network error can occur after prompt command delivery. Count both successful playback and clearly reported failures when assessing honesty; count successful command delivery separately for the five-second goal.
