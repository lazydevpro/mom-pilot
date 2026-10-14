# Local verification — 30 September 2026

## Passed

- TypeScript compilation and Vite production build.
- 22 Node relay integration tests, including pairing, ownership, expiry, duplicate delivery, acknowledgment transitions, presence, quiet mode, revocation, CSRF checks, profile edits that preserve pairing, and the experimental YouTube launch/offline transaction.
- Latest Android debug APK built using the pinned Gradle 8.11.1 wrapper with JDK 17 and SDK 35. `assembleDebug` and `lintDebug` passed: zero lint errors, 18 warnings. APK: 898,120 bytes, built 30 September 2026 at 07:26:08 UTC; SHA256 `77A2E7369046471607E3F98D9C43EE76853186E871691977F7EC7E9632A5B986`.
- Desktop (1440px) and phone (390px) rendering: film artwork loaded; no horizontal overflow at the tested phone width.
- Browser receiver tested against the real local relay in Chromium: pairing updated the parent home; a preset message appeared, was acknowledged, and could be dismissed.
- The externally hosted Sintel trailer actually played. Remote pause and resume returned the corresponding acknowledgment states.
- Parent quiet mode rejected a new caregiver command with HTTP 409. Revocation removed caregiver access with HTTP 404.
- The caregiver UI also completed pairing, sending a message, starting playback, quiet-mode availability, and simulated app-exit checks against a separate browser receiver.
- The caregiver's Big Buck Bunny preview exposes the fixed-video YouTube experiment. Sending it to the browser receiver produced an explained `FAILED` result because native Android TV is required. The updated mobile preview remained within the tested 390px viewport. This verifies the unsupported-client path, not a successful YouTube launch.

Browser media tests used Chromium with autoplay allowed to exercise the playback path. A normal browser may require a local tap on Play; the receiver reports that failure rather than claiming playback started. Keep the browser receiver in a visible, separate window. Edge background-tab automation stalled during testing; this is not evidence of background or sleeping-TV support.

## Not verified

- Native app runtime on an emulator. Official Android TV image setup was attempted; startup/debugging troubleshooting is recorded below.
- Physical Fire TV installation, audio, D-pad behavior, sleep/reconnect, or performance targets.
- Independent-network delivery, production identity, AWS deployment, or YouTube launching.

The [manual acceptance plan](TESTING.md) and [device spike checklist](DEVICE-SPIKE.md) describe the remaining work.

## Emulator attempt

The host has Android Emulator 37.1.11 and usable Android Emulator Hypervisor Driver 2.2. Dedicated AVD data lives under ignored `.local/avd/`; existing user AVDs were not changed.

- Downloaded official `system-images;android-34;android-tv;x86` revision 3 and created a 1080p TV AVD. The guest reached system services, but ADB remained `offline` through the bounded initial boot attempts. Restarting ADB and disabling Vulkan did not establish a debugging connection.
- Downloaded official `system-images;android-31;android-tv;x86` revision 4 and created a 720p fallback TV AVD. Startup was attempted using software graphics, then with additional resources and the emulator's `qemu.adbd=start` diagnostic boot property.
- Created a separate 720p baseline AVD using the already installed `system-images;android-35;default;x86_64` image to compare startup. This is a generic Android image, not an Android TV image or Fire OS.
- The generic baseline also stayed ADB-offline. A final Android 12 TV comparison used the normal windowed engine with its window hidden, software graphics, and no disabled boot animation; debugging still did not connect.

The execution host reports Microsoft Corporation / **Virtual Machine**, with `HypervisorPresent:true`, two CPU cores and four logical processors. Google's [generic acceleration restrictions](https://developer.android.com/studio/run/emulator-acceleration#restrictions) exclude running a VM-accelerated emulator inside another VM. Microsoft's [Windows guidance](https://learn.microsoft.com/en-us/dotnet/maui/android/emulator/hardware-acceleration?view=net-maui-10.0) explicitly allows it when nested virtualization is enabled, so the VM identity does **not** establish that running an emulator here is impossible or identify the cause of the offline state.

Read-only Windows checks found AEHD running, virtualization firmware/VM-monitor/SLAT flags true, and Windows Hypervisor Platform, Virtual Machine Platform, and Hyper-V features disabled. These checks suggest the CPU extensions are exposed but do not prove a working nested acceleration stack. A follow-up experiment used `-accel off` to bypass AEHD without host feature changes. The software process started but did not reach a connected guest during the bounded attempt; its emulator console also failed to respond. It was stopped. This leaves the cause unresolved rather than proving all software emulation impossible. WHPX is the next configuration to test; enabling Windows features requires a reboot and was not performed. Downloaded SDK images and workspace AVDs remain for reuse. No existing user AVD was modified.

No emulator-native pairing, rendered video, successful YouTube intent, or external autoplay result is claimed without a connected, running guest. Compilation, relay tests, and browser playback are separate evidence. Headless startup also reported unavailable host sound capture; audible output is unverified.
