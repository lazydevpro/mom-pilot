# Submission checklist

**Deadline: Friday 23 October 2026, 12:00 PM PT = Saturday 24 October, 12:30 AM IST.** Aim to submit by the evening of Thursday 22 October (IST). Devpost lets you save a draft and edit it until the deadline.

Rules: https://amazonappdev2026.devpost.com/rules · Track: **Fire TV** ("a demo-ready app that works on Fire OS or Vega OS").

## 1. Before recording (today)

- [x] Commit and push the new logo (Claude).
- [x] Update `docs/DEPLOY.md`, `docs/CHECKLIST.md`, `android/README.md` and `README.md` for the no-typing setup (Claude).
- [ ] Install phone app 0.4.1 on your phone (OneDrive → MomPilot, the GitHub release, or `https://my-win.tail4d01fc.ts.net/download/mompilot.apk`) and try **name → Scan the code on Mom's TV**.
- [ ] On the Fire TV, sign in to **YouTube** (it asked "Welcome back" last time), **Netflix** and **Prime Video**, so shows start without prompts.
- [x] Server auto-start: the Windows scheduled task **MomPilot** starts it at sign-in and restarts it if it stops (Claude).
- [ ] Check the stick and the phone are both online in Tailscale.
- [ ] Do a full dry run of the shot list below once.
- [ ] Pick demo content you're allowed to show (see §3).

## 2. Demo video (required)

Rules: **under 3 minutes**, **in English**, uploaded **public on YouTube or Vimeo**, showing the project **running on an actual Fire TV device**. It "must not include third party trademarks, or copyrighted music or other material unless the Entrant has permission".

- [ ] Record the TV with a second phone or camera, and the phone screen with MIUI's screen recorder. Show them side by side when editing.
- [ ] Narrate in English, or add English subtitles.
- [ ] No copyrighted music. Use no music, or a royalty-free track.
- [ ] Blur or avoid third-party logos and show footage (Netflix, Prime Video, YouTube video content). Prefer an openly licensed YouTube video (for example Blender's *Big Buck Bunny*, CC BY) for the "it plays" moment.
- [ ] Upload as **Public**, check it plays logged-out, and copy the link.

### Shot list (about 2:45)

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Mom on the phone; the Fire TV menus | "My mom can turn on her TV but can't find her way around the menus. She calls me, and I talk her through it, button by button." |
| 0:20–0:35 | MomPilot logo; phone and TV side by side | "MomPilot lets me put her show on, from anywhere." |
| 0:35–1:05 | TV app's QR screen → phone: name → **Scan the code on Mom's TV** → "Allow" on the TV → "You're all set" | "Setup is one scan. No typing on the TV." |
| 1:05–1:30 | YouTube/Netflix → **Share → MomPilot** → saved in the list; search and filter | "When she likes something, I save it." |
| 1:30–2:05 | Phone on **mobile data** (show Wi-Fi off) → tap a show → it starts on the TV | "From the office, one tap and it's playing. No buttons for her." |
| 2:05–2:25 | Remote tab: arrows, OK, volume; "See TV screen" | "If something needs a press, I have her remote in my pocket." |
| 2:25–2:45 | Short architecture card: phone → server → Tailscale → ADB → Fire TV | "Built for Fire OS with Kotlin, a small Node server, Tailscale and ADB." |

## 3. GitHub repository (required)

The repo must contain all source, assets and setup instructions. It must be either **public with an open-source license** (GNU AGPL-3.0 is in the repo; it must show in the About section) or **private and shared**.

- [ ] Decide: public (simplest) or private.
- [ ] If private: GitHub → Settings → Collaborators → add **chris-trag, knmeiss, giolaq, anishamalde, mosesroth, emersonsklar**, and share with **testing@devpost.com** as the rules describe.
- [x] GitHub release `v0.4.1` with `MomPilot-phone-0.4.1.apk` and `MomPilot-TV-0.4.1.apk`, so judges can install them without building (Claude).
- [x] Fresh clone: `npm ci`, `npm test` and `npm run build` work (Claude).

## 4. Devpost form (required)

- [ ] **Project name and tagline**: "MomPilot: remote Fire TV assistance for parents"
- [ ] **Text description**: drafted in [DEVPOST.md](DEVPOST.md); check it reads true and paste it in.
- [ ] **Track**: Fire TV.
- [ ] **Mini challenges**:
  - **AWS Builder** needs AWS services or Kiro Crew, which MomPilot doesn't use, so skip unless that changes.
  - **Open Source** is optional (a separate public repo or contribution).
- [ ] **"Significantly updated during the submission period"**: the project was started on 29 September, inside the submission period.
- [ ] **Product feedback for each tool/SDK used**: Fire OS / Fire TV, ADB, Amazon Appstore (sideloading), Tailscale, Android SDK / Jetpack Compose, Google code scanner (ML Kit), Node.js. For each, answer the five questions: what it was used for, what worked, what needs work, onboarding, and whether you'd use it again. Drafted in [DEVPOST.md](DEVPOST.md).
- [ ] **Testing instructions**: link to `docs/DEPLOY.md` and the APKs. Note that judges need a Fire OS stick and Tailscale. Amazon may ask for hardware access.
- [ ] **Images**: logo, phone screenshots, TV screenshots.
- [ ] **Built with**: Kotlin, Jetpack Compose, Fire OS, ADB, Tailscale, Node.js, React, TypeScript.

## 5. Friction log (optional, up to 10% bonus)

Written up in [DEVPOST.md](DEVPOST.md#friction-log).

For each entry: task, steps, expected vs actual, severity, workaround, suggestion. Problems found while building:

- [ ] Fire OS blocks ADB connections from the device itself (`127.0.0.1`, LAN or VPN address): verified on Fire OS 7.7.1.7. Blocks on-device automation and "VPN inside the app" designs.
- [ ] Vega OS sticks (Fire TV Stick HD 2nd Gen, 4K Select) can't sideload or use ADB, and Amazon's store listings say little about it.
- [ ] Prime Video deep links aren't documented. `https://app.primevideo.com/detail?gti=…` opens the page; `amzn://avod/watch?gti=…` plays. Share links carry a web ID that the TV app rejects (error 5004); you have to look up the gti.
- [ ] Prime Video registers only a TV launcher activity, so `monkey -c LAUNCHER` and `am start -c LEANBACK_LAUNCHER` fail. You have to resolve the activity first.
- [ ] `input keyevent` takes about 1 s per key on a Fire TV Stick; writing to `/dev/input` with `sendevent` takes about 0.1 s.
- [ ] Netflix blocks screenshots completely (empty image); YouTube and Prime video areas show black.
- [ ] No Fire OS emulator; the Android TV emulator wouldn't boot on a cloud VM without AVX.
- [ ] Tailscale's docs say it isn't in the Fire TV Appstore, while its GitHub README says it is.
- [ ] The Devpost rules page blocks automated reading (Cloudflare check).

## 6. Final checks (Thursday)

- [ ] Video link plays in a private/incognito window.
- [ ] Repo access works for the reviewers (private) or the license shows (public).
- [ ] Devpost form submitted, not just saved as a draft. You get a confirmation.
- [ ] Keep the server, the stick and the repo available until judging ends (20 November).
