import test from 'node:test';
import assert from 'node:assert/strict';
import { AdbError, amStart, createAdb, parseStatus } from '../server/adb.mjs';
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
  const { calls, adb } = scripted('', 'Starting: Intent { … }', Buffer.from('png'));
  await adb.key(TARGET, 'ok');
  await adb.open(TARGET, launchFor({ app: 'netflix', contentId: '80057281' }));
  assert.equal((await adb.snapshot(TARGET)).toString(), 'png');
  assert.deepEqual(calls[0], ['-s', TARGET, 'shell', 'input keyevent 23']);
  assert.match(calls[1][3], /^am force-stop 'com\.netflix\.ninja'; am start -n 'com\.netflix\.ninja\/\.MainActivity'/);
  assert.deepEqual(calls[2], ['-s', TARGET, 'exec-out', 'screencap', '-p']);
  assert.throws(() => adb.key(TARGET, 'reboot'), AdbError);
});

test('a dropped connection is reconnected once and the command retried', async () => {
  const { calls, adb } = scripted(adbFailure(`error: device '${TARGET}' not found`), `connected to ${TARGET}`, '');
  await adb.key(TARGET, 'home');
  assert.deepEqual(calls.map((args) => args.join(' ')), [
    `-s ${TARGET} shell input keyevent 3`, `connect ${TARGET}`, `-s ${TARGET} shell input keyevent 3`,
  ]);
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
  assert.deepEqual(order, ['start input keyevent 19', 'end input keyevent 19', 'start input keyevent 20', 'end input keyevent 20']);
});
