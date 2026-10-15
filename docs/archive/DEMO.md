# Local demo script

This script demonstrates the local product flow in roughly two minutes. Say “local prototype” on screen. A browser TV window does not establish physical Fire TV compatibility or different-network delivery.

## Before recording

Run `npm run dev`. Place the caregiver at `http://127.0.0.1:5173` and TV at `http://127.0.0.1:5173/tv` in separate, visible windows. Use an unpaired TV and a fresh demo caregiver session for the pairing shot. Check internet access and test the chosen licensed video. If browser autoplay requires an initial parent interaction, show that interaction or state it clearly.

Do not use developer tools to change delivery state during the recording. Keep creator attribution visible or add it to the final video description. If recording excerpts of demo movies, credit their creators and licenses as specified in [content credits](CONTENT.md).

| Time | Action | What the viewer should understand |
| --- | --- | --- |
| 0:00–0:15 | “Mom wants something familiar on the TV. I want to help without talking her through menus.” Show both windows. | The caregiver is helping the parent choose content. |
| 0:15–0:40 | Read the TV code, pair through the caregiver app, and show the paired caregiver on TV. | Help is explicitly paired and scoped to MomPilot. |
| 0:40–1:10 | Preview a catalog item and send it. Show receipt, actual playback, and the reported result. | The relay and TV perform a real command exchange. |
| 1:10–1:30 | Send “I found the video for you.” Dismiss the card on TV. | The parent stays in control. |
| 1:30–1:50 | Pause/resume in-app playback or toggle quiet mode and show a blocked send. | Controls and failures are acknowledged honestly. |
| 1:50–2:10 | Revoke on TV. Show the caregiver losing access. | Access can be removed locally. |
| 2:10–2:25 | Show the native Android source and planned AWS diagram. Say these still require deployment/device validation. | Current evidence and next steps are clearly separated. |

For the eventual hackathon hardware demonstration, replace the browser TV with an actual supported Fire OS device. Repeat the flow from a separate network only after deploying an authenticated TLS service. Record that evidence in [the device spike](DEVICE-SPIKE.md) and [test log](TESTING.md). AWS source planning alone is not an AWS runtime integration.

The original PRD includes submission timing and rules links. Those are planning inputs, not a verified current rules summary. Verify [the event overview](https://amazonappdev2026.devpost.com/) and [submission rules](https://amazonappdev2026.devpost.com/rules) before submission.
