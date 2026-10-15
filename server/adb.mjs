import { execFile } from 'node:child_process';
import { APPS } from './shows.mjs';

/** Remote keys the caregiver can press, as Android key codes. */
export const KEYS = {
  up: 19, down: 20, left: 21, right: 22, ok: 23, back: 4, home: 3,
  playPause: 85, rewind: 89, fastForward: 90, volumeUp: 24, volumeDown: 25, mute: 164,
};
const LAUNCHER = 'com.amazon.tv.launcher';

export class AdbError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function defaultRun(adbPath, timeoutMs) {
  return (args, { binary = false } = {}) => new Promise((resolve, reject) => {
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
    return new AdbError('ADB_OFFLINE', 'Cannot reach the TV over ADB. Check that it is on, ADB debugging is enabled and Tailscale is connected.');
  }

  async function connect(target) {
    const output = await run(['connect', target]);
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
    key: (target, name) => {
      if (!Object.hasOwn(KEYS, name)) throw new AdbError('ADB_INVALID', 'Unknown key.');
      return shell(target, `input keyevent ${KEYS[name]}`);
    },
    open: (target, launch) => shell(target, `${launch.forceStop ? `am force-stop ${quote(launch.forceStop)}; ` : ''}${amStart(launch)}`)
      .then((output) => { if (/Error:|Exception/.test(output)) throw new AdbError('ADB_LAUNCH_FAILED', 'The TV could not open this title. Is the app installed?'); }),
    openApp: (target, app) => shell(target, `monkey -p ${quote(APPS[app].package)} -c android.intent.category.LAUNCHER 1`),
    wake: (target) => shell(target, 'input keyevent 224; input keyevent 3'),
    status: (target) => shell(target, "dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp'; dumpsys power | grep mWakefulness").then(parseStatus),
    snapshot: (target) => command(target, ['exec-out', 'screencap', '-p'], { binary: true }),
  };
}
