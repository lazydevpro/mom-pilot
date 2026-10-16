import { execFile } from 'node:child_process';
import { APPS } from './shows.mjs';

/** Remote keys the caregiver can press, as Android key codes. */
export const KEYS = {
  up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4, home: 3,
  playPause: 85, rewind: 89, fastForward: 90, volumeUp: 24, volumeDown: 25, mute: 164,
};
/**
 * The same keys as Linux input codes, for writing straight to an input device with sendevent.
 * `input keyevent` starts a Java process and takes about a second on a Fire TV Stick; sendevent takes about 0.1 s.
 * Codes follow Fire OS's amzkeyboard.kl / Generic.kl (353 = KEY_SELECT → DPAD_CENTER, 172 = KEY_HOMEPAGE → HOME).
 */
const INPUT_CODES = {
  up: 103, down: 108, left: 105, right: 106, ok: 353, back: 158, home: 172,
  playPause: 164, rewind: 168, fastForward: 208, volumeUp: 115, volumeDown: 114, mute: 113,
};
const LAUNCHER = 'com.amazon.tv.launcher';
const TV_APP = 'com.mompilot.tv';
const FALLBACK = 'MOMPILOT_USE_INPUT';

/** Picks the input device to write keys to from `getevent -pl`: Fire OS's virtual keyboard, else any device with D-pad keys. */
export function findKeyDevice(output) {
  const devices = output.split(/^add device \d+: /m).slice(1).map((block) => ({
    path: block.split('\n')[0].trim(),
    name: /name:\s+"([^"]*)"/.exec(block)?.[1] || '',
    keys: block,
  }));
  const usable = (device) => /^\/dev\/input\/event\d+$/.test(device.path) && ['KEY_UP', 'KEY_DOWN', 'KEY_SELECT', 'KEY_BACK'].every((key) => device.keys.includes(key));
  return (devices.find((device) => device.name === 'amzkeyboard' && usable(device)) || devices.find(usable))?.path ?? null;
}

export function sendKeyScript(device, code) {
  const send = (type, key, value) => `sendevent ${device} ${type} ${key} ${value}`;
  // If writing to the device is refused, print a marker instead of failing so the caller can fall back.
  return `{ ${send(1, code, 1)} && ${send(0, 0, 0)} && ${send(1, code, 0)} && ${send(0, 0, 0)}; } 2>/dev/null || echo ${FALLBACK}`;
}

export class AdbError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function defaultRun(adbPath, defaultTimeoutMs) {
  return (args, { binary = false, timeoutMs = defaultTimeoutMs } = {}) => new Promise((resolve, reject) => {
    execFile(adbPath, args, { timeout: timeoutMs, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          error.output = `${stdout || ''}${stderr || ''}`;
          return reject(error);
        }
        resolve(stdout);
      });
  });
}

// Every value placed in a remote shell command comes from validated IDs; quoting is a second guard.
function quote(value) {
  const text = String(value);
  if (!/^[A-Za-z0-9_.:/?=&%+-]*$/.test(text)) throw new AdbError('ADB_INVALID', 'Refusing an unsafe value.');
  return `'${text}'`;
}

/** Builds `am start …` for an intent from launchFor(). */
export function amStart(launch) {
  const parts = ['am', 'start'];
  if (launch.component) parts.push('-n', quote(launch.component));
  if (launch.action) parts.push('-a', quote(launch.action));
  if (launch.data) parts.push('-d', quote(launch.data));
  if (launch.flags) parts.push('-f', `0x${launch.flags.toString(16)}`);
  for (const [key, value] of Object.entries(launch.extras || {})) parts.push('-e', quote(key), quote(value));
  if (launch.package) parts.push('-p', quote(launch.package));
  return parts.join(' ');
}

/**
 * Opens an app's launcher screen. `am start` can't find launcher activities by category (they don't
 * declare DEFAULT), so ask the package manager for the TV launcher activity, then the phone one.
 */
export function openAppScript(packageName) {
  const find = (category) => `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.${category} ${quote(packageName)} 2>/dev/null | tail -n 1`;
  return `c=$(${find('LEANBACK_LAUNCHER')}); case "$c" in */*) ;; *) c=$(${find('LAUNCHER')});; esac; `
    + 'case "$c" in */*) am start -n "$c" 2>&1;; *) echo "Error: not installed";; esac';
}

/** Reads the open app and whether the stick is awake from dumpsys output. */
export function parseStatus(output) {
  const focus = /mCurrentFocus=Window\{\S+ \S+ ([\w.]+)\//.exec(output) || /mFocusedApp=.*? ([\w.]+)\//.exec(output);
  const wake = /mWakefulness=(\w+)/.exec(output);
  const packageName = focus?.[1] || null;
  const app = Object.keys(APPS).find((key) => APPS[key].package === packageName) || (packageName === LAUNCHER ? 'home' : null);
  return { awake: wake ? wake[1] === 'Awake' : null, app, package: packageName };
}

/** Sends a fixed set of commands to Fire TV sticks over network ADB. Inject `run` in tests. */
export function createAdb({ adbPath = 'adb', timeoutMs = 10_000, run = defaultRun(adbPath, timeoutMs) } = {}) {
  const chains = new Map();
  // target → input device path for fast keys, or null to use `input keyevent`.
  const keyDevices = new Map();

  // ADB allows one command stream per device; run commands for a target one after another.
  function serial(target, work) {
    const previous = chains.get(target) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    chains.set(target, next);
    return next;
  }

  function explain(error) {
    if (error instanceof AdbError) return error;
    if (error.code === 'ENOENT') return new AdbError('ADB_MISSING', 'The server cannot find adb. Install Android platform-tools or set ADB_PATH.');
    const output = `${error.output || ''} ${error.message || ''}`;
    if (/unauthorized/i.test(output)) return new AdbError('ADB_UNAUTHORIZED', 'Press Allow on the TV’s “Allow USB debugging?” prompt, with “Always allow” ticked.');
    if (error.killed || /timed? ?out/i.test(output)) return new AdbError('ADB_TIMEOUT', 'The TV did not answer in time. Check that it is on and connected.');
    // A command can also fail on a perfectly reachable TV; only connection problems mean offline.
    if (!/device .*not found|device offline|no devices|error: closed|connection refused|failed to connect|cannot connect|protocol fault|connection reset|unable to connect/i.test(output)) {
      return new AdbError('ADB_COMMAND_FAILED', 'The TV couldn’t do that. Please try again.');
    }
    return new AdbError('ADB_OFFLINE', 'Cannot reach the TV over ADB. Check that it is on, ADB debugging is enabled and Tailscale is connected.');
  }

  async function connect(target) {
    // Input device numbers can change after the TV restarts; look the device up again.
    keyDevices.delete(target);
    const output = await run(['connect', target]);
    if (/authenticate|unauthorized/i.test(output)) throw explain(Object.assign(new Error(output), { output: 'unauthorized' }));
    if (!/connected to/i.test(output)) {
      throw new AdbError('ADB_OFFLINE', `Cannot reach the TV at ${target}. Check that it is on, ADB debugging is enabled and Tailscale is connected.`);
    }
  }

  async function exec(target, args, options) {
    try {
      return await run(['-s', target, ...args], options);
    } catch (error) {
      if (explain(error).code !== 'ADB_OFFLINE') throw error;
      await connect(target);
      return run(['-s', target, ...args], options);
    }
  }

  const command = (target, args, options) => serial(target, () => exec(target, args, options)).catch((error) => { throw explain(error); });
  const shell = (target, script) => command(target, ['shell', script]);

  return {
    key: async (target, name) => {
      if (!Object.hasOwn(KEYS, name)) throw new AdbError('ADB_INVALID', 'Unknown key.');
      if (!keyDevices.has(target)) keyDevices.set(target, findKeyDevice(await shell(target, 'getevent -pl')));
      const device = keyDevices.get(target);
      if (device) {
        const output = await shell(target, sendKeyScript(device, INPUT_CODES[name]));
        if (!output.includes(FALLBACK)) return output;
        keyDevices.set(target, null);
      }
      return shell(target, `input keyevent ${KEYS[name]}`);
    },
    open: (target, launch) => shell(target, `${launch.forceStop ? `am force-stop ${quote(launch.forceStop)}; ` : ''}${amStart(launch)}`)
      .then((output) => { if (/Error:|Exception/.test(output)) throw new AdbError('ADB_LAUNCH_FAILED', 'The TV could not open this title. Is the app installed?'); }),
    // Fire TV apps such as Prime Video only register for the TV launcher, so try that category first.
    openApp: (target, app) => shell(target, openAppScript(APPS[app].package)).then((output) => {
      if (/Error/.test(output)) throw new AdbError('ADB_LAUNCH_FAILED', `${APPS[app].name} isn’t installed on the TV.`);
    }),
    wake: (target) => shell(target, 'input keyevent 224; input keyevent 3'),
    status: (target) => shell(target, "dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp'; dumpsys power | grep mWakefulness").then(parseStatus),

    /** Connects (which shows "Allow USB debugging?" on a new TV) and reads what kind of device it is. */
    describe: (target) => serial(target, async () => {
      await connect(target);
      return run(['-s', target, 'shell', `getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.name; pm path ${TV_APP} || true`]);
    }).catch((error) => { throw explain(error); }).then((output) => {
      const [manufacturer = '', model = '', os = ''] = output.split(/\r?\n/).map((line) => line.trim());
      return { manufacturer, model, os, hasApp: output.includes('package:') };
    }),
    install: (target, apkPath) => command(target, ['install', '-r', apkPath], { timeoutMs: 120_000 }).then((output) => {
      if (!/Success/.test(output)) throw new AdbError('ADB_INSTALL_FAILED', 'Couldn’t install the MomPilot TV app on the TV.');
    }),
    /** Hands the TV app its server and credential. Its receiver only accepts this from ADB. */
    configure: async (target, { server, token }) => {
      const output = await shell(target,
        `am broadcast -a com.mompilot.tv.CONFIGURE -n ${TV_APP}/.SetupReceiver --es server ${quote(server)} --es token ${quote(token)}; am start -n ${TV_APP}/.MainActivity`);
      if (!/result=1\b/.test(output)) throw new AdbError('ADB_SETUP_FAILED', 'The MomPilot TV app didn’t accept the setup. Update it and try again.');
    },
    snapshot: (target) => command(target, ['exec-out', 'screencap', '-p'], { binary: true }),
  };
}
