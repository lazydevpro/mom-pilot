# MomPilot real-world checklist

Work through this after [DEPLOY.md](DEPLOY.md), on Mom's actual Fire TV Stick. Tick each line only when you've seen it happen. If a line fails, note what you saw (screenshots help) and stop at that section.

Write down: stick model and Fire OS version (Settings → My Fire TV → About) ______ · server (PC / VM) ______ · date ______

## A. Setup is healthy

- [ ] Opening the server address on your phone (with Tailscale on) shows MomPilot over **https://**.
- [ ] The same address does **not** open with Tailscale turned off on the phone.
- [ ] The server log shows `MomPilot server: http://127.0.0.1:8787 (adb: …)` with a real adb path.
- [ ] `adb devices` on the server lists `100.x.y.z:5555  device` (not `unauthorized` or `offline`).
- [ ] The TV app shows **"You're all set"** with your name after pairing.
- [ ] The phone's status pill is **green** and names the open app (for example "Home screen is open").

## B. Saving shows

- [ ] YouTube: in the YouTube phone app, Share → Copy link → Add a show → paste → save. A thumbnail appears.
- [ ] Netflix: Share → Copy link from the Netflix app → saves as Netflix.
- [ ] Prime Video: Share → Copy link from the Prime Video app → saves as Prime Video. **If it's rejected, send the link format so it can be added.**
- [ ] Android only: Share from the YouTube/Netflix app → **MomPilot** opens Add a show with the link filled in.
- [ ] A random link (for example a news site) is rejected with a clear message.
- [ ] Edit → delete a show removes it.

## C. Putting it on (TV on, on the home screen)

| Check | Expected | Seconds from tap | Result |
|---|---|---|---|
| Tap a saved **YouTube** show | Video plays with no remote presses | | |
| Tap a saved **Netflix** show | Netflix opens that title (maybe "Who's watching?" first) | | |
| Tap a saved **Prime Video** show | The title's page opens; OK on the remote plays it | | |
| Tap a Netflix show **while Netflix is already open** on something else | Switches to the new title | | |
| **Just open an app**: YouTube, Netflix, Prime Video buttons | Each app opens | | |
| TV → Recently | Each attempt listed as Opened, or Didn't open with a reason | | |

## D. Remote

- [ ] Up, Down, Left, Right and OK move and select on the TV. Note the delay: ______ s.
- [ ] Back, Home, Play/Pause, Rewind and Fast-forward work in YouTube and Netflix.
- [ ] Volume up/down and Mute change the TV volume (this depends on the TV; note if not).
- [ ] Ten fast Down taps move exactly ten rows, in order.
- [ ] **See TV screen** shows the home screen. In Netflix, menus are visible (video may be black).
- [ ] Laptop: arrow keys, Enter and Backspace work as the remote.

## E. From the office (the real use)

Phone on mobile data (Wi-Fi off), Tailscale on.

- [ ] Status pill is green.
- [ ] A YouTube show plays. Seconds: ______
- [ ] The remote works. Delay: ______ s.
- [ ] Your second phone (other OS) does the same after linking with a code.

## F. When things go wrong

| Situation | Expected | Result |
|---|---|---|
| TV turned off with its remote (stick asleep), then **Wake** (power button on the phone's remote) | Note whether the TV turns on. If not, Mom turns it on and everything else works | |
| Unplug the stick, plug it back in, wait 2 minutes | Status green again **without** pressing Allow; Tailscale reconnected on its own; the TV app shows "You're all set" | |
| Restart the server (or the PC) | Comes back by itself; phone shows green within a minute | |
| Turn **ADB debugging off** on the TV, then tap a YouTube show | Status turns amber ("Remote unavailable"); the show still opens through the TV app; Recently shows it as Opened | |
| Turn ADB debugging back on | Status green again within about a minute (no new Allow prompt) | |
| Tailscale turned off on the stick | Phone shows "Can't reach the TV" with a clear message; nothing hangs | |
| TV → Disconnect on the TV app | Phone loses access to that TV at once; the TV shows a new code; pairing again works | |
| Close and reopen the phone app a day later | Still signed in, same shows | |

## G. Before submitting

- [ ] `npm test` passes and `npm run build` works on a fresh clone.
- [ ] The demo video shows MomPilot on the real Fire TV, under 3 minutes, in English, without third-party logos or copyrighted footage you don't have permission for (use YouTube with openly licensed content, or blur).
- [ ] Repository shared with testing@devpost.com and the Amazon reviewers listed in the rules (it's private).
- [ ] Friction log written (tool problems hit along the way, with workarounds).
