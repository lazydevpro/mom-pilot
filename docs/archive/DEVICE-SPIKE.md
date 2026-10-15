# Physical Fire TV feasibility checklist

**Status: not run on a physical Fire TV.** The native project is Fire OS Android source. Record observations here when a device is available. A browser test, a build, and an Android emulator are different evidence from a Fire TV hardware test.

The Gradle 8.11.1 wrapper build and lint passed on 30 September 2026 with zero errors and 18 warnings. The debug APK is 898,120 bytes; its timestamp and SHA-256 are recorded in [the Android guide](../android/README.md). Native emulator runtime checks have not completed: an Android 14 TV boot attempt remained ADB-offline. These results do not validate physical Fire OS or the external YouTube experiment.

## Identify the target

| Field | Value |
| --- | --- |
| Test date / tester | Not recorded |
| Device model / generation | Not recorded |
| Operating system / build | Not recorded |
| MomPilot source revision / APK hash | Not recorded |
| Network topology | Not recorded |
| TV resolution / audio output | Not recorded |
| YouTube version, if testing the optional experiment | Not recorded |

Check the actual operating system before beginning. Fire OS uses the Android development path; Vega is a different platform and this APK is not a Vega app. Follow Amazon’s [Fire OS overview](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html) and the device’s current documentation.

## Setup

- [ ] Build the native project following [`android/README.md`](../android/README.md).
- [ ] Enable development access and install the debug app using Amazon’s [ADB connection guide](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html).
- [ ] Configure a relay address the TV can reach. `localhost`/`127.0.0.1` on the TV refers to the TV, not the development computer.
- [ ] Confirm the TV can fetch the catalog and display a new expiring pairing code.
- [ ] Pair through the caregiver interface and confirm the caregiver name appears on TV.
- [ ] Confirm the visible privacy explanation describes sending choices/messages, not screen viewing.

## Foreground acceptance

| Test | Evidence to record | Result |
| --- | --- | --- |
| Send ten distinct catalog commands while MomPilot is open | Command IDs, send/receipt/result times, visible movie and sound | Not run |
| Display and dismiss every help preset | Card text, focus position, remote action | Not run |
| Pause/resume MomPilot playback | Player changes and matching acknowledgment | Not run |
| Repeat a request with the same idempotency key | One execution, same command ID | Not run |
| Interrupt network then restore it | Presence timeout, explained send/result state, no stale surprise playback | Not run |
| Turn quiet mode on with a pending command | Command blocked or failed, parent UI remains responsive | Not run |
| Revoke pairing | Caregiver loses access immediately, TV can pair again | Not run |
| Navigate using only the normal remote | Every focus target reachable; home recovery action count | Not run |
| Read the interface from normal viewing distance | Pairing code, title, help, status, and focus readable | Not run |
| Play all catalog entries through their end | Codec compatibility, correct aspect ratio, audible sound, sensible end state | Not run |

Use Amazon’s [remote input guidance](https://developer.amazon.com/docs/fire-tv/remote-input.html) when checking actual D-pad, Select, Back, and media buttons. Do not inject keys into other apps or use ADB as the product’s command path.

## Lifecycle observations

The implementation is foreground-only. Test these cases to validate its boundary, not to imply that background delivery is expected.

| Transition | Expected product behavior | Observed behavior |
| --- | --- | --- |
| Switch to another app | Caregiver becomes unavailable; no new MomPilot command is executed in the background | Not run |
| Sleep / wake | Unavailable while inactive; opening MomPilot restores fresh presence | Not run |
| Force stop / reopen | No execution while stopped; reconnect and current pairing on reopen | Not run |
| Reboot / open manually | No claimed auto-start; reconnect after user opens MomPilot | Not run |
| Slow or lost acknowledgment response | No duplicate visible execution; bounded retry/expiry | Not run |

## Optional YouTube intent experiment

The implemented experiment is limited to the fixed [Big Buck Bunny video](https://www.youtube.com/watch?v=aqz-KE-bpKQ), selected through **Try opening YouTube on TV** in the caregiver preview. `OPEN_YOUTUBE` accepts only `itemId: "bunny"`; the native client issues Android `ACTION_VIEW` with the explicit package `com.google.android.youtube.tv`. This is an **Android TV package experiment**. No Fire OS YouTube package has been configured or validated. The browser receiver reports the command as unsupported.

Test the existing fixed video with cold and warm starts on a compatible Android TV target, including the missing-app case. Record whether the intended video opens, whether playback starts, whether sign-in/consent/advertisement prompts appear, how Back behaves, and what happens to MomPilot’s presence after leaving. `LAUNCHED` means only that Android accepted the intent; playback remains unverified. Confirm the acknowledged launch atomically marks MomPilot unavailable and cancels pending requests, then reopening restores presence. Exercise a lost acknowledgment without automatically replaying the launch.

For the PRD’s eventual Fire OS spike, first identify and verify the installed app’s supported package/intent behavior on that device. Broadening the experiment to additional approved videos requires an explicit allowlist change; the current command cannot accept three arbitrary test URLs. Keep the full multi-video PRD feasibility check pending until that work exists. Do not download, extract, or restream YouTube media.

Decision: keep this experimental unless the exact target device gives repeatable results. If it fails, the core demonstration remains licensed in-app playback. Do not claim global remote control, television wake-up, protected-video screen sharing, or overlays on top of other apps.

## Exit criteria

The PRD target is at least 9 of 10 commands received within five seconds while the app is open, and at least 9 of 10 delivered commands reporting actual playback or an explained failure. Separately verify the parent can reach a home favorite in at most three remote actions. Add a video or test-log path beside each claim before marking it achieved. Different-network delivery needs a deployed authenticated TLS endpoint and its own test; local LAN success alone does not satisfy it.
