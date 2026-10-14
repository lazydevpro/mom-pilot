# MomPilot — PRD v2

Version 2.0 · 9 October 2026 · Amazon Appstore developer hackathon, Fire TV track · Submission due 23 October 2026, 12:00 PM PT (24 October, 12:30 AM IST)

The previous version is kept at [archive/PRD-v1.md](archive/PRD-v1.md).

## The problem

Mom can turn on her TV but can't find her way around the Fire TV menus. When she wants to watch something, she phones her son at the office. Today he can only talk her through the menus, button by button.

## The product

**"I'll put it on for you."** From his phone, the son picks a show from his saved list and it starts on Mom's TV. When something needs a button press, such as Netflix's "Who's watching?" or picking an episode, he presses it from a remote on his phone. Mom just watches.

YouTube, Netflix and Prime Video are already installed on Mom's Fire TV Stick. MomPilot doesn't cast or stream anything; it opens and drives the apps that are already there.

## Users

- **Son (caregiver):** at the office, on his phone. He already knows the show name.
- **Mom:** at home. She turns on the TV and watches. She does one one-time setup step with her son's help.

## Features

| Priority | Feature | Done when |
|---|---|---|
| P0 | **Saved shows** | The son pastes a YouTube, Netflix or Prime Video link (or share link) into the app, with a name and optional picture. The list is kept on the server. |
| P0 | **Put it on** | Tapping a saved show opens it on Mom's TV. YouTube plays straight away. Netflix opens the title. Prime Video opens the title's page. |
| P0 | **Phone remote** | Up, down, left, right, OK, Back, Home and Play/Pause buttons on the phone press the same keys on Mom's TV, from any network. |
| P0 | **TV status** | The phone shows whether Mom's TV is reachable and which app is open. |
| P1 | **One-time pairing** | The TV app shows a code; the son enters it on his phone. |
| P1 | **Open an app** | Buttons to just open YouTube, Netflix or Prime Video. |
| P1 | **Screen check** | A button that shows a snapshot of Mom's TV screen. Netflix and Prime video areas may show black because of copy protection; menus are visible. |
| P2 | **Wake the TV** | Try to turn on Mom's TV over HDMI. This only works if the TV supports it. |

## How it works

- **MomPilot TV app** (Android, sideloaded on Mom's Fire OS stick): stays connected to the MomPilot server and opens saved-show links in YouTube, Netflix or Prime Video.
- **MomPilot server:** keeps the saved shows, passes the son's commands to the TV, and sends remote key presses to the stick over ADB.
- **Phone app** (web app the son adds to his home screen): saved shows, the remote and TV status.
- **Tailscale** links the server and Mom's stick (and optionally the son's phone) across networks without opening anything to the public internet.

Details, research and sources: [PLAN.md](PLAN.md).

## Requirements on Mom's device

- A **Fire OS** Fire TV Stick (for example the Fire TV Stick HD 2024, model `AFTSS`). **Vega OS sticks can't be used**: they block sideloading, ADB and Tailscale. That includes the Fire TV Stick 4K Select and the 2026 Fire TV Stick HD (2nd Gen).
- One setup visit: turn on ADB debugging, install Tailscale and the MomPilot TV app, and press **Allow** once on the ADB prompt.

## Success measures

- A saved YouTube show is playing on Mom's TV within 10 seconds of the tap, from a different network, in 9 out of 10 tries.
- A remote key press shows on the TV within 1 second on a normal connection.
- The son can get from "Mom calls" to "show playing" without Mom pressing anything.

## Not in this version

- Vega OS devices (a React Native/Vega app would be a later project).
- Search on the TV by show name. The son adds links on his phone instead.
- AI recommendations, voice control and multiple caregivers.
