import test from 'node:test';
import assert from 'node:assert/strict';
import { AdbError, amStart, createAdb, findKeyDevice, openAppScript, parseStatus, sendKeyScript } from '../server/adb.mjs';
import { launchFor } from '../server/shows.mjs';

const TARGET = '100.101.102.103:5555';

/** A scripted adb: each call returns the next reply, or throws it if it is an Error. */
function scripted(...replies) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const reply = replies.shift() ?? '';
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { calls, adb: createAdb({ run }) };
}
const adbFailure = (output, extra = {}) => Object.assign(new Error('Command failed'), { output, ...extra });

test('am start commands are built from launch intents with quoted values', () => {
  assert.equal(amStart(launchFor({ app: 'youtube', contentId: 'aqz-KE-bpKQ' })),
    "am start -a 'android.intent.action.VIEW' -d 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' -p 'com.amazon.firetv.youtube'");
  assert.equal(amStart(launchFor({ app: 'netflix', contentId: '80057281' })),
    "am start -n 'com.netflix.ninja/.MainActivity' -a 'android.intent.action.VIEW' -d 'netflix://title/80057281' -f 0x10000020 -e 'amzn_deeplink_data' '80057281'");
  assert.throws(() => amStart({ data: "x'; reboot; '" }), AdbError);
});

test('status reads the focused app and wakefulness from dumpsys', () => {
  const output = [
    '  mCurrentFocus=Window{4a1b2c3 u0 com.netflix.ninja/com.netflix.ninja.MainActivity}',
    '  mFocusedApp=AppWindowToken{9f8e7d6 token=Token{1a2b3c ActivityRecord{5d6e7f u0 com.netflix.ninja/.MainActivity t12}}}',
    '  mWakefulness=Awake',
  ].join('\n');
  assert.deepEqual(parseStatus(output), { awake: true, app: 'netflix', package: 'com.netflix.ninja' });
  assert.deepEqual(parseStatus('mCurrentFocus=Window{1 u0 com.amazon.tv.launcher/.ui.HomeActivity}\nmWakefulness=Asleep'),
    { awake: false, app: 'home', package: 'com.amazon.tv.launcher' });
  assert.deepEqual(parseStatus(''), { awake: null, app: null, package: null });
});

test('keys, Netflix launches and snapshots send the expected adb commands', async () => {
  // No usable input device is listed, so keys use `input keyevent`.
  const { calls, adb } = scripted('', '', 'Starting: Intent { … }', Buffer.from('png'));
  await adb.key(TARGET, 'ok');
  await adb.open(TARGET, launchFor({ app: 'netflix', contentId: '80057281' }));
  assert.equal((await adb.snapshot(TARGET)).toString(), 'png');
  assert.deepEqual(calls[0], ['-s', TARGET, 'shell', 'getevent -pl']);
  assert.deepEqual(calls[1], ['-s', TARGET, 'shell', 'input keyevent 23']);
  assert.match(calls[2][3], /^am force-stop 'com\.netflix\.ninja'; am start -n 'com\.netflix\.ninja\/\.MainActivity'/);
  assert.deepEqual(calls[3], ['-s', TARGET, 'exec-out', 'screencap', '-p']);
  await assert.rejects(adb.key(TARGET, 'reboot'), AdbError);
});

test('a dropped connection is reconnected once and the command retried', async () => {
  const { calls, adb } = scripted(adbFailure(`error: device '${TARGET}' not found`), `connected to ${TARGET}`, '');
  await adb.wake(TARGET);
  const wake = `-s ${TARGET} shell input keyevent 224; input keyevent 3`;
  assert.deepEqual(calls.map((args) => args.join(' ')), [wake, `connect ${TARGET}`, wake]);
});

test('adb problems become readable error codes', async () => {
  const code = async (...replies) => {
    const { adb } = scripted(...replies);
    try { await adb.key(TARGET, 'ok'); } catch (error) { return error.code; }
    return 'NO_ERROR';
  };
  assert.equal(await code(adbFailure('error: device unauthorized.')), 'ADB_UNAUTHORIZED');
  assert.equal(await code(Object.assign(new Error('spawn adb ENOENT'), { code: 'ENOENT' })), 'ADB_MISSING');
  assert.equal(await code(adbFailure('error: closed'), `failed to connect to ${TARGET}`), 'ADB_OFFLINE');
  assert.equal(await code(adbFailure('', { killed: true })), 'ADB_TIMEOUT');
  // A command failing on a reachable TV is not "offline", and doesn't trigger a reconnect.
  assert.equal(await code(adbFailure('/system/bin/sh: getevent: not found')), 'ADB_COMMAND_FAILED');
  const { adb } = scripted('Error: Activity not started, unable to resolve Intent');
  await assert.rejects(adb.open(TARGET, launchFor({ app: 'youtube', contentId: 'aqz-KE-bpKQ' })), { code: 'ADB_LAUNCH_FAILED' });
});

test('commands to one TV run one at a time', async () => {
  const order = [];
  let release;
  const gate = new Promise((done) => { release = done; });
  const adb = createAdb({ run: async (args) => {
    order.push(`start ${args.at(-1)}`);
    if (args.at(-1) === 'input keyevent 19') await gate;
    order.push(`end ${args.at(-1)}`);
    return '';
  } });
  const first = adb.key(TARGET, 'up');
  const second = adb.key(TARGET, 'down');
  await new Promise((done) => setTimeout(done, 20));
  release();
  await Promise.all([first, second]);
  const keys = order.filter((step) => step.includes('input keyevent'));
  assert.deepEqual(keys, ['start input keyevent 19', 'end input keyevent 19', 'start input keyevent 20', 'end input keyevent 20']);
});

test('apps open through the TV launcher category first, then the phone one', async () => {
  const script = openAppScript('com.amazon.firebat');
  assert.match(script, /^c=\$\(cmd package resolve-activity --brief -a android\.intent\.action\.MAIN -c android\.intent\.category\.LEANBACK_LAUNCHER 'com\.amazon\.firebat' /);
  assert.match(script, /category\.LAUNCHER 'com\.amazon\.firebat'/);
  assert.match(script, /am start -n "\$c" 2>&1;; \*\) echo "Error: not installed";; esac$/);
  const { calls, adb } = scripted('Starting: Intent { act=android.intent.action.MAIN }');
  await adb.openApp(TARGET, 'prime');
  assert.equal(calls[0][3], openAppScript('com.amazon.firebat'));
  const missing = scripted('Error: Activity not started, unable to resolve Intent');
  await assert.rejects(missing.adb.openApp(TARGET, 'netflix'), { code: 'ADB_LAUNCH_FAILED', message: 'Netflix isn’t installed on the TV.' });
});

// Trimmed `getevent -pl` from a Fire TV Stick HD (AFTSS, Fire OS 7.7.1.7).
const GETEVENT = `add device 1: /dev/input/event5
  name:     "amzkeyboard"
  events:
    KEY (0001): KEY_ENTER KEY_HOME KEY_UP KEY_LEFT KEY_RIGHT KEY_DOWN KEY_MUTE KEY_BACK KEY_PLAYPAUSE KEY_HOMEPAGE KEY_SELECT
add device 2: /dev/input/event4
  name:     "Amazon Fire TV Remote"
  events:
    KEY (0001): KEY_ENTER KEY_HOME KEY_UP KEY_LEFT KEY_RIGHT KEY_DOWN KEY_BACK KEY_SELECT
add device 6: /dev/input/event0
  name:     "hdmipower"
  events:
    KEY (0001): KEY_POWER
`;

test('the key device is Fire OS’s virtual keyboard, or any device with D-pad keys', () => {
  assert.equal(findKeyDevice(GETEVENT), '/dev/input/event5');
  assert.equal(findKeyDevice(GETEVENT.replace('amzkeyboard', 'something else')), '/dev/input/event5');
  assert.equal(findKeyDevice(GETEVENT.split('add device 2')[1].replace(/^/, 'add device 2')), '/dev/input/event4');
  assert.equal(findKeyDevice('add device 6: /dev/input/event0\n  name: "hdmipower"\n    KEY (0001): KEY_POWER\n'), null);
  assert.equal(findKeyDevice(''), null);
});

test('keys are written straight to the input device, and fall back to input keyevent if that is refused', async () => {
  const { calls, adb } = scripted(GETEVENT, '', '');
  await adb.key(TARGET, 'ok');
  await adb.key(TARGET, 'home');
  assert.deepEqual(calls.map((args) => args[3]), ['getevent -pl', sendKeyScript('/dev/input/event5', 353), sendKeyScript('/dev/input/event5', 172)]);
  assert.match(sendKeyScript('/dev/input/event5', 108), /^\{ sendevent \/dev\/input\/event5 1 108 1 && sendevent \/dev\/input\/event5 0 0 0 && sendevent \/dev\/input\/event5 1 108 0 && sendevent \/dev\/input\/event5 0 0 0; \} 2>\/dev\/null \|\| echo MOMPILOT_USE_INPUT$/);

  const refused = scripted(GETEVENT, 'MOMPILOT_USE_INPUT\n', '', '');
  await refused.adb.key(TARGET, 'down');
  await refused.adb.key(TARGET, 'up');
  assert.deepEqual(refused.calls.map((args) => args[3]), ['getevent -pl', sendKeyScript('/dev/input/event5', 108), 'input keyevent 20', 'input keyevent 19']);
});

test('the key device is looked up again after reconnecting', async () => {
  const { calls, adb } = scripted(GETEVENT, '', adbFailure(`error: device '${TARGET}' not found`), `connected to ${TARGET}`, '', GETEVENT, '');
  await adb.key(TARGET, 'ok');
  await adb.wake(TARGET);
  await adb.key(TARGET, 'ok');
  assert.deepEqual(calls.map((args) => args[0] === 'connect' ? 'connect' : args[3]), [
    'getevent -pl', sendKeyScript('/dev/input/event5', 353),
    'input keyevent 224; input keyevent 3', 'connect', 'input keyevent 224; input keyevent 3',
    'getevent -pl', sendKeyScript('/dev/input/event5', 353),
  ]);
});

test('describe connects, reports an unauthorized TV clearly, and reads what the device is', async () => {
  const waiting = scripted(`failed to authenticate to ${TARGET}`);
  await assert.rejects(waiting.adb.describe(TARGET), { code: 'ADB_UNAUTHORIZED' });
  const tv = scripted(`connected to ${TARGET}`, 'Amazon\nAFTSS\nFire OS 7.7.1.7 (PS7717/5741)\npackage:/data/app/com.mompilot.tv-1/base.apk\n');
  assert.deepEqual(await tv.adb.describe(TARGET), { manufacturer: 'Amazon', model: 'AFTSS', os: 'Fire OS 7.7.1.7 (PS7717/5741)', hasApp: true });
  assert.match(tv.calls[1][3], /^getprop ro\.product\.manufacturer; getprop ro\.product\.model; getprop ro\.build\.version\.name; pm path com\.mompilot\.tv \|\| true$/);
  const bare = scripted(`already connected to ${TARGET}`, 'Amazon\nAFTSS\nFire OS 7\n');
  assert.equal((await bare.adb.describe(TARGET)).hasApp, false);
});

test('configure hands the TV app its server and token, and needs the app to accept it', async () => {
  const { calls, adb } = scripted('Broadcasting: Intent { act=com.mompilot.tv.CONFIGURE }\nBroadcast completed: result=1\nStarting: Intent');
  await adb.configure(TARGET, { server: 'https://my-win.tail4d01fc.ts.net', token: 'abc_DEF-123' });
  assert.equal(calls[0][3], "am broadcast -a com.mompilot.tv.CONFIGURE -n com.mompilot.tv/.SetupReceiver --es server 'https://my-win.tail4d01fc.ts.net' --es token 'abc_DEF-123'; am start -n com.mompilot.tv/.MainActivity");
  const refused = scripted('Broadcast completed: result=0');
  await assert.rejects(refused.adb.configure(TARGET, { server: 'https://x.ts.net', token: 't' }), { code: 'ADB_SETUP_FAILED' });
  await assert.rejects(adb.configure(TARGET, { server: "https://x.ts.net'; reboot; '", token: 't' }), { code: 'ADB_INVALID' });
});

test('install needs adb to report Success', async () => {
  const ok = scripted('Performing Streamed Install\nSuccess\n');
  await ok.adb.install(TARGET, 'C:/builds/tv.apk');
  assert.deepEqual(ok.calls[0], ['-s', TARGET, 'install', '-r', 'C:/builds/tv.apk']);
  await assert.rejects(scripted('Failure [INSTALL_FAILED_VERSION_DOWNGRADE]').adb.install(TARGET, 'tv.apk'), { code: 'ADB_INSTALL_FAILED' });
});
