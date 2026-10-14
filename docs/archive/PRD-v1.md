MomPilot — Hackathon PRD
Version: 1.0 · 28 September 2026
Primary track: Fire TV · Optional mini challenge: AWS Builder
Target submission: 23 October 2026, 12:00 PM PDT (24 October, 12:30 AM IST)
1. Product
MomPilot lets an adult child help a parent watch something on the TV from another location. A paired caregiver phone or web page sends a content choice or short message to a Fire TV app. The TV shows a clear, large-screen experience and can play content inside MomPilot. The differentiating demo is an office-to-home action that visibly changes the parent’s TV without asking them to navigate menus.
Tagline: “I’ll put it on for you.”
Promise for the MVP: “Pick something on your phone; it appears and plays on Mom’s TV.”
Technical honesty: A third-party Fire TV app cannot assume permission to globally press Home/Back/D-pad in other apps, inspect protected third-party playback, capture their video, or stay continuously active in the background. Launching a specific YouTube video through an external intent is a proof-of-capability experiment, not an acceptance dependency. Do not advertise universal remote control until validated on actual hardware and within platform rules.
2. Users and jobs
- Caregiver: Away from home, wants to put on familiar content quickly, know whether the TV is reachable, and send a reassuring message.
- Parent: Wants recognizable choices, readable text, and one-button recovery without confusing setup or accidental interruptions.
Scenario: Mom calls asking for a familiar devotional program. Varish selects a saved item in the caregiver interface. MomPilot on Fire TV receives it, shows its title and artwork, and plays the approved video in its own player. Mom can pause or return to a simple MomPilot home screen using her normal Fire TV remote.
3. MVP scope and acceptance
Priority	Feature	Acceptance criterion
P0	Pair TV and caregiver	TV displays short-lived code; caregiver enters it; TV confirms paired account; pairing can be revoked on TV.
P0	Remote command delivery	From a different network, caregiver sends a command; TV acknowledges receipt and result; stale/duplicate commands are ignored.
P0	Curated content	Caregiver selects from a small catalog of licensed/self-owned/demo videos; the TV app presents title/art and plays it in-app.
P0	Parent-first TV home	Large focus targets for Continue, Favorites, and Help; all usable with Fire TV remote; text stays readable at TV distance.
P0	Availability	Caregiver sees last heartbeat / online indication with honest timeout and command failure state.
P0	Assistance card	Caregiver sends a short preset message; when MomPilot is visible, TV displays it with dismiss/return action.
P1	YouTube exact-video launch	On a selected Fire OS device with YouTube installed, validate that a supported VIEW intent opens the requested video and observe actual behavior after launch. Mark integration experimental if automatic playback or wake-up is inconsistent.
P1	Saved family shortcuts	Caregiver saves three to five titled links or in-app catalog selections, with preview and confirmation.
P2	In-app playback controls	Caregiver can pause/resume/seek only content playing inside MomPilot, with acknowledged state.


Not in MVP: global D-pad/Home/Back injection into Netflix/Prime/YouTube; screen sharing of protected apps; live status for arbitrary external players; powering on the television through an ordinary app; ambient overlays over other apps; voice AI; unauthorized video extraction or embedding.
4. User flows
Pairing
1. Parent opens MomPilot on Fire TV; app displays a six-digit, expiring code and clear privacy explanation.
2. Caregiver opens a responsive web app, signs in, enters the code, names the TV, and confirms.
3. TV shows “Varish can send videos and messages to this app”; parent can revoke access in Settings.
Play from office
1. Caregiver sees Mom’s TV — Online and picks a favorite or searches the approved catalog.
2. Preview shows title, source, and Play on TV.
3. Backend authorizes and queues a command for the paired device.
4. Foreground TV app receives command, presents the title, and begins in-app playback. Caregiver sees Delivered → Playing or an actionable error.
5. If TV app is closed or sleeping, caregiver sees Unavailable/Open MomPilot on TV; a push/wake strategy is future research, not silently assumed.
Help card
Caregiver chooses a preset such as “I found the video ❤️”; the TV app displays it only while MomPilot is active. TV remote can dismiss it.
5. Technical approach
Chosen platform: Fire OS app in Kotlin, Jetpack Compose for TV or Leanback, and Android media playback. This matches the developer’s Kotlin experience and permits focused testing of Android intents. Choose a Fire OS Fire TV Stick for the first real-device test. Vega OS is a distinct platform; Android APK/ADB assumptions do not carry over to it.
Caregiver UI: responsive React web app, installable as PWA if useful. No native phone build required for hackathon.
AWS path: Cognito (caregiver identity), API Gateway + Lambda (pairing, command authorization), DynamoDB (devices, content catalog, command state), and an authenticated device connection via AWS IoT Core MQTT/WebSocket or API Gateway WebSocket. Pick one connection path after a small spike. TV creates only outbound TLS connections. Maintain command ID, expiry, idempotency, and acknowledgment. Do not place long-lived AWS secrets in the APK. Use a device-scoped credential provisioned during pairing; document revocation and rotation.
Practical prototype fallback: If persistent connection proves unreliable on device, poll a secured command endpoint while MomPilot is foregrounded. This is sufficient for the truthful foreground demo. Do not claim unattended operation when the app is closed.
Payload example: {id, deviceId, type: PLAY_CATALOG_ITEM, itemId, expiresAt}. Backend checks membership, allowed command type, and catalog entry. TV reports {id, state: RECEIVED|PLAYING|FAILED, reason}. Never accept arbitrary shell commands, package names, or URLs from the relay.
Content: Use own/authorized sample videos and explicit metadata. YouTube URLs are passed to the official installed app only if the device spike confirms intended behavior. Do not use YouTube API/search without complying with its terms and quota; do not download or restream YouTube videos into the app.
6. Critical feasibility spike (first two days)
On the exact target Fire Stick:
1. Verify Fire OS version, app installation/debugging, and that MomPilot can connect to backend and receive a command while foregrounded.
2. Test ACTION_VIEW with multiple YouTube watch URLs, recording whether YouTube opens, picks the exact video, autoplays, prompts, or fails. Test cold and warm start.
3. Switch away, sleep/wake, reboot; measure which inbound delivery modes survive. Do not infer persistence from a simulator.
4. Verify in-app player + remote key behavior and actual TV sound/output.
Decision gate: If YouTube exact-video launch works reliably, feature it as an optional highlight. If it does not, the core demo remains remote selection and playback inside MomPilot. If background delivery fails, explicitly require MomPilot to be open and optimize the parent home screen accordingly.
7. Product design
TV: warm, calm, uncluttered. A 10-foot interface with high contrast, visible focus ring, no tiny text, and a Help tile on the first row. Caregiver screen: device presence, favorites, selected content preview, one obvious Play action, delivery status, and a Help message shortcut. Pairing and consent should be understandable without tech terms.
Accessibility: large type, readable focus states, remote-only navigation, conservative motion, no color-only status, Hindi-friendly copy in product if time allows (submission materials in English or translated).
8. Security and privacy
Only an invited caregiver can pair. Pairing code expires and is single-use. Parent can revoke access on TV. Encrypt traffic, limit command types, rate limit sends, log command metadata without viewing history beyond what MomPilot plays, and keep an on-TV indication when remote help is active. Messages and content changes should respect a parent-configurable quiet window and never imply that a caregiver can see the screen.
9. Schedule to submission
Window	Milestone
Sep 29–30	Physical Fire Stick feasibility spike; select transport; record YouTube/background results.
Oct 1–6	TV home, player, pairing, backend commands and acknowledgments.
Oct 7–11	Caregiver PWA, favorites, assistance card, error states.
Oct 12–16	Device testing across different networks, sleep/reconnect, accessibility and demo polish.
Oct 17–20	Film under-three-minute demo; finalize README, setup, architecture, AWS integration notes, and product feedback.
Oct 21–22	Submission buffer; verify public video and repository access.


10. Demo script (about 2 minutes)
1. 0:00–0:20: Parent cannot find a video; caregiver is at office. Show the actual Fire TV app and phone side by side.
2. 0:20–0:45: TV pairing code and consent, caregiver pairs from another network.
3. 0:45–1:15: Caregiver taps a favorite; TV receives and plays licensed sample content; status moves Delivered → Playing.
4. 1:15–1:35: Send a reassuring Help card; demonstrate the parent’s remote dismiss action.
5. 1:35–2:05: If proven, launch exact YouTube video; otherwise show more favorites and in-app remote playback control.
6. 2:05–2:25: Explain AWS flow, revoke pairing, and what comes next.
11. Submission package
- Working Fire OS app shown on actual Fire TV hardware or eligible simulator; physical Fire Stick is strongly preferred for the remote control feasibility claim.
- GitHub repository with source, assets, setup/run steps and testing instructions; public with an open-source license or private access granted as specified by rules.
- Public YouTube/Vimeo demo in English under three minutes, showing the device functioning; use authorized footage/music and avoid unnecessary third-party marks.
- Devpost text covering problem, demonstrated functionality, architecture, limitations, user impact, and product feedback for each tool/API/SDK used. Document AWS runtime integration to enter AWS Builder mini challenge.
12. Success measures
- 9/10 remote catalog commands reach an actively running TV app within five seconds on a normal home connection in repeated testing.
- 9/10 delivered commands yield honest status (playing or explained failure).
- Parent can return to MomPilot home and select a favorite in at most three remote actions.
- Demo shows real office-network-to-home-network control without manually using ADB during the user flow.
Sources
- Hackathon overview and timeline: https://amazonappdev2026.devpost.com/
- Hackathon submission rules: https://amazonappdev2026.devpost.com/rules
- Amazon Fire TV React Native emulator/device guidance: https://www.developer.amazon.com/docs/fire-tv/get-started-with-react-native.html
- Amazon Vega Virtual Device guidance: https://www.developer.amazon.com/docs/vega/0.24/run-apps
- Amazon Vega tool requirements: https://www.developer.amazon.com/docs/vega/0.23/install-vega-sdk