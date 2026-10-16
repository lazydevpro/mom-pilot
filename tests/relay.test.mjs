import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRelay } from '../server/relay.mjs';
import { AdbError } from '../server/adb.mjs';
import { parseLink } from '../server/shows.mjs';

const LINKS = {
  youtube: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  netflix: 'https://www.netflix.com/in/title/80057281?s=a&trkid=13747225',
  prime: 'https://app.primevideo.com/detail?gti=amzn1.dv.gti.4eb5d9a6-1f60-4b63-8b10-0123456789ab&ref_=share',
};

/** Stands in for the ADB bridge: records calls and can be told to fail. */
function fakeAdb() {
  const calls = [];
  let failure = null;
  let delay = 0;
  let snapshotBytes = Buffer.from('fake-png'.repeat(20));
  const call = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (delay) await new Promise((done) => setTimeout(done, delay));
    if (failure) throw new AdbError(failure, `fake ${failure}`);
    return value;
  };
  const result = {
    calls,
    failWith: (code) => { failure = code; },
    slow: (ms) => { delay = ms; },
    key: call('key'), open: call('open'), openApp: call('openApp'), wake: call('wake'),
    status: call('status', { awake: true, app: 'home', package: 'com.amazon.tv.launcher' }),
    snapshot: async (...args) => { calls.push(['snapshot', ...args]); if (failure) throw new AdbError(failure, `fake ${failure}`); return snapshotBytes; },
    blankSnapshot: () => { snapshotBytes = Buffer.alloc(0); },
    // Setup: what the TV reports, and the last configuration it was given.
    tv: { manufacturer: 'Amazon', model: 'AFTSS', os: 'Fire OS 7.7.1.7', hasApp: true },
    describe: async (...args) => { calls.push(['describe', ...args]); if (failure) throw new AdbError(failure, `fake ${failure}`); return { ...fake.tv }; },
    install: call('install'),
    configure: async (...args) => { calls.push(['configure', ...args]); if (failure || fake.refuseSetup) throw new AdbError(fake.refuseSetup || failure, 'fake'); fake.configured = args[1]; },
  };
  const fake = result;
  return result;
}

function fakeTailnet(devices = [], url = 'https://mompilot-server.tail1234.ts.net') {
  return { publicUrl: async () => url, androidDevices: async () => devices };
}

async function harness(t, options = {}) {
  const prefix = join(tmpdir(), 'mompilot-relay-');
  const dataDir = await mkdtemp(prefix);
  let time = Date.parse('2026-10-14T12:00:00Z');
  const adb = fakeAdb();
  let relay;
  let base;
  async function start() {
    relay = createRelay({ dataDir, now: () => time, rateLimit: false, adb, resolve: async (link) => parseLink(link), tailnet: fakeTailnet(), ...options });
    await new Promise((done) => relay.server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${relay.server.address().port}`;
  }
  await start();
  t.after(async () => {
    await relay.close();
    // Only remove the test directory created above, never an arbitrary path.
    assert.ok(resolve(dataDir).startsWith(resolve(prefix)));
    await rm(dataDir, { recursive: true, force: true });
  });
  const api = async (path, { method = 'GET', body, cookie, token, headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = response.headers.get('content-type') || '';
    return {
      status: response.status, type,
      body: type.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()),
      cookie: response.headers.get('set-cookie'),
    };
  };
  const session = async (name = 'Varish') => {
    const response = await api('/api/session', { method: 'POST', body: { name } });
    assert.equal(response.status, 201);
    return { ...response.body, cookie: response.cookie.split(';')[0], cookieHeader: response.cookie };
  };
  const register = async () => {
    const response = await api('/api/tv/register', { method: 'POST', body: {} });
    assert.equal(response.status, 201);
    return response.body;
  };
  const pair = async ({ adbTarget } = {}) => {
    const caregiver = await session();
    const tv = await register();
    const response = await api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Mom’s TV' } });
    assert.equal(response.status, 200);
    if (adbTarget) assert.equal((await api(`/api/devices/${tv.deviceId}`, { method: 'PATCH', cookie: caregiver.cookie, body: { adbTarget } })).status, 200);
    return { ...caregiver, ...tv, device: response.body.device };
  };
  const save = async (pairing, app = 'youtube', title = 'A favourite') => {
    const response = await api('/api/shows', { method: 'POST', cookie: pairing.cookie, body: { title, link: LINKS[app] } });
    assert.equal(response.status, 201);
    return response.body.show;
  };
  const command = (pairing, body) => api(`/api/devices/${pairing.deviceId}/commands`, { method: 'POST', cookie: pairing.cookie, body });
  const play = (pairing, show, idempotencyKey = 'first-tap') => command(pairing, { type: 'OPEN_SHOW', showId: show.id, idempotencyKey });
  const ack = (pairing, sent, state, reason) => api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: sent.id, state, ...(reason ? { reason } : {}) },
  });
  return {
    api, session, register, pair, save, command, play, ack, adb, dataDir,
    base: () => base,
    advance: (ms) => { time += ms; },
    restart: async () => { await relay.close(); await start(); },
  };
}

test('caregiver cookie is httpOnly, private, persistent, and required', async (t) => {
  const h = await harness(t);
  assert.equal((await h.api('/api/devices')).status, 401);
  const caregiver = await h.session('  Varish  ');
  assert.match(caregiver.cookieHeader, /HttpOnly/);
  assert.match(caregiver.cookieHeader, /SameSite=Strict/);
  assert.match(caregiver.cookieHeader, /Path=\/api/);
  const who = await h.api('/api/session', { cookie: caregiver.cookie });
  assert.equal(who.body.caregiver.name, 'Varish');
  await h.restart();
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 200);
  await h.api('/api/session', { method: 'DELETE', cookie: caregiver.cookie });
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 401);
});

test('sessions last 400 days and each app launch renews them', async (t) => {
  const h = await harness(t);
  const caregiver = await h.session();
  assert.match(caregiver.cookieHeader, /Max-Age=34560000/);
  h.advance(399 * 24 * 60 * 60 * 1000);
  const renewed = await h.api('/api/session', { cookie: caregiver.cookie });
  assert.equal(renewed.status, 200);
  assert.match(renewed.cookie, /Max-Age=34560000/);
  h.advance(399 * 24 * 60 * 60 * 1000);
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 200);
  h.advance(401 * 24 * 60 * 60 * 1000);
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 401);
});

test('a second phone joins the same account with a single-use link code', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const show = await h.save(pairing, 'netflix', 'Kota Factory');
  assert.equal((await h.api('/api/session/link', { method: 'POST', body: {} })).status, 401);
  const link = await h.api('/api/session/link', { method: 'POST', cookie: pairing.cookie, body: {} });
  assert.match(link.body.code, /^\d{6}$/);
  const joined = await h.api('/api/session/join', { method: 'POST', body: { code: link.body.code } });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.caregiver.id, pairing.caregiver.id);
  const phone2 = joined.cookie.split(';')[0];
  assert.deepEqual((await h.api('/api/shows', { cookie: phone2 })).body.shows.map((entry) => entry.id), [show.id]);
  assert.equal((await h.api(`/api/devices/${pairing.deviceId}`, { cookie: phone2 })).status, 200);
  assert.equal((await h.api('/api/session/join', { method: 'POST', body: { code: link.body.code } })).body.error, 'INVALID_CODE');
  // Renaming on one phone renames everywhere, and signing out one phone leaves the other signed in.
  await h.api('/api/session', { method: 'POST', cookie: phone2, body: { name: 'Rahul' } });
  assert.equal((await h.api('/api/session', { cookie: pairing.cookie })).body.caregiver.name, 'Rahul');
  await h.api('/api/session', { method: 'DELETE', cookie: phone2 });
  assert.equal((await h.api('/api/session', { cookie: pairing.cookie })).status, 200);
  // A code still works if the phone that made it signs out first.
  const handOff = await h.api('/api/session/link', { method: 'POST', cookie: pairing.cookie, body: {} });
  const phone3 = await h.api('/api/session/join', { method: 'POST', body: { code: handOff.body.code } });
  await h.api('/api/session', { method: 'DELETE', cookie: pairing.cookie });
  const handOff2 = await h.api('/api/session/link', { method: 'POST', cookie: phone3.cookie.split(';')[0], body: {} });
  await h.api('/api/session', { method: 'DELETE', cookie: phone3.cookie.split(';')[0] });
  const phone4 = await h.api('/api/session/join', { method: 'POST', body: { code: handOff2.body.code } });
  assert.deepEqual([phone4.status, phone4.body.caregiver.id, phone4.body.caregiver.name], [201, pairing.caregiver.id, 'Rahul']);
  // Codes expire after ten minutes.
  const late = await h.api('/api/session/link', { method: 'POST', cookie: phone4.cookie.split(';')[0], body: {} });
  h.advance(10 * 60 * 1000);
  assert.equal((await h.api('/api/session/join', { method: 'POST', body: { code: late.body.code } })).body.error, 'INVALID_CODE');
});

test('pairing is single-use and devices are isolated between caregivers', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  assert.match(pairing.code, /^\d{6}$/);
  assert.equal(pairing.device.caregiver.name, 'Varish');
  const other = await h.session('Another caregiver');
  const replay = await h.api('/api/pair', { method: 'POST', cookie: other.cookie, body: { code: pairing.code, name: 'Other TV' } });
  assert.equal(replay.body.error, 'INVALID_CODE');
  assert.deepEqual((await h.api('/api/devices', { cookie: other.cookie })).body.devices, []);
  assert.equal((await h.api(`/api/devices/${pairing.deviceId}`, { cookie: other.cookie })).status, 404);
  assert.equal((await h.command({ ...pairing, cookie: other.cookie }, { type: 'KEY', key: 'ok' })).status, 404);
  assert.equal((await h.api('/api/tv/pairing', { method: 'POST', token: pairing.token, body: {} })).status, 409);
});

test('pairing expires at the deadline and refreshing invalidates the previous code', async (t) => {
  const h = await harness(t, { pairingTtlMs: 1000 });
  const caregiver = await h.session();
  const tv = await h.register();
  h.advance(1000);
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'TV' } })).status, 400);
  const fresh = await h.api('/api/tv/pairing', { method: 'POST', token: tv.token, body: {} });
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: fresh.body.code, name: 'TV' } })).status, 200);
});

test('saved shows accept YouTube, Netflix and Prime Video links and are private to each caregiver', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const youtube = await h.save(pairing, 'youtube', 'Bhajan');
  assert.deepEqual([youtube.app, youtube.contentId, youtube.image], ['youtube', 'aqz-KE-bpKQ', 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg']);
  assert.equal((await h.save(pairing, 'netflix')).contentId, '80057281');
  assert.equal((await h.save(pairing, 'prime')).contentId, 'amzn1.dv.gti.4eb5d9a6-1f60-4b63-8b10-0123456789ab');
  const bad = await h.api('/api/shows', { method: 'POST', cookie: pairing.cookie, body: { title: 'Nope', link: 'https://example.com/watch?v=aqz-KE-bpKQ' } });
  assert.equal(bad.body.error, 'INVALID_LINK');
  assert.equal((await h.api('/api/shows', { cookie: pairing.cookie })).body.shows.length, 3);
  const other = await h.session('Someone else');
  assert.deepEqual((await h.api('/api/shows', { cookie: other.cookie })).body.shows, []);
  assert.equal((await h.api(`/api/shows/${youtube.id}`, { method: 'DELETE', cookie: other.cookie })).status, 404);
  assert.equal((await h.api(`/api/shows/${youtube.id}`, { method: 'DELETE', cookie: pairing.cookie })).status, 200);
  assert.equal((await h.api('/api/shows', { cookie: pairing.cookie })).body.shows.length, 2);
  // Another caregiver cannot play a show they don't own.
  const theirs = await h.pair();
  assert.equal((await h.play(theirs, { id: (await h.save(pairing, 'netflix')).id })).body.error, 'SHOW_NOT_FOUND');
});

test('opening a show uses ADB when an address is set, and retries do not open it twice', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair({ adbTarget: '100.101.102.103:5555' });
  const show = await h.save(pairing, 'netflix', 'Kota Factory');
  const first = await h.play(pairing, show);
  assert.equal(first.status, 201);
  assert.deepEqual([first.body.command.state, first.body.command.via, first.body.command.title], ['LAUNCHED', 'adb', 'Kota Factory']);
  const [, target, launch] = h.adb.calls.find(([name]) => name === 'open');
  assert.equal(target, '100.101.102.103:5555');
  assert.deepEqual([launch.data, launch.forceStop], ['netflix://title/80057281', 'com.netflix.ninja']);
  const retry = await h.play(pairing, show);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.command.id, first.body.command.id);
  assert.equal(h.adb.calls.filter(([name]) => name === 'open').length, 1);
  const changed = await h.command(pairing, { type: 'OPEN_APP', app: 'youtube', idempotencyKey: 'first-tap' });
  assert.equal(changed.body.error, 'IDEMPOTENCY_CONFLICT');
  const app = await h.command(pairing, { type: 'OPEN_APP', app: 'prime', idempotencyKey: 'second-tap' });
  assert.equal(app.body.command.state, 'LAUNCHED');
  assert.deepEqual(h.adb.calls.at(-1), ['openApp', '100.101.102.103:5555', 'prime']);
});

test('concurrent duplicate taps wait for the first ADB launch instead of opening twice', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair({ adbTarget: '100.101.102.103:5555' });
  const show = await h.save(pairing);
  h.adb.slow(50);
  const [a, b] = await Promise.all([h.play(pairing, show), h.play(pairing, show)]);
  assert.equal(a.body.command.id, b.body.command.id);
  assert.equal(h.adb.calls.filter(([name]) => name === 'open').length, 1);
});

test('when ADB is unavailable, the TV app opens the show and reports the result', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair({ adbTarget: '100.101.102.103:5555' });
  const show = await h.save(pairing, 'youtube');
  h.adb.failWith('ADB_OFFLINE');
  const sent = await h.play(pairing, show);
  assert.equal(sent.status, 201);
  assert.deepEqual([sent.body.command.state, sent.body.command.via], ['QUEUED', 'tv']);
  const poll = await h.api('/api/tv/commands', { token: pairing.token });
  assert.equal(poll.body.commands.length, 1);
  assert.deepEqual(poll.body.commands[0].launch, {
    action: 'android.intent.action.VIEW', data: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', package: 'com.amazon.firetv.youtube',
  });
  assert.equal((await h.ack(pairing, sent.body.command, 'LAUNCHED')).status, 200);
  const details = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(details.body.commands[0].state, 'LAUNCHED');
  assert.equal(details.body.adb.state, 'ADB_OFFLINE');
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
});

test('opening a show fails clearly when neither ADB nor the TV app is reachable', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const show = await h.save(pairing);
  h.advance(15_000);
  const sent = await h.play(pairing, show);
  assert.equal(sent.status, 409);
  assert.equal(sent.body.command.state, 'FAILED');
  assert.match(sent.body.command.reason, /isn’t running/);
});

test('queued commands expire and cannot be acknowledged afterwards', async (t) => {
  const h = await harness(t, { commandTtlMs: 1000 });
  const pairing = await h.pair();
  const sent = await h.play(pairing, await h.save(pairing));
  assert.equal((await h.ack(pairing, sent.body.command, 'RECEIVED')).status, 200);
  h.advance(1000);
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
  assert.equal((await h.ack(pairing, sent.body.command, 'LAUNCHED')).body.error, 'COMMAND_FINISHED');
  const details = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(details.body.commands[0].state, 'EXPIRED');
});

test('remote keys and wake go over ADB and report ADB problems', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  assert.equal((await h.command(pairing, { type: 'KEY', key: 'ok' })).body.error, 'ADB_NOT_SET');
  await h.api(`/api/devices/${pairing.deviceId}`, { method: 'PATCH', cookie: pairing.cookie, body: { adbTarget: '100.101.102.103:5555' } });
  assert.equal((await h.command(pairing, { type: 'KEY', key: 'reboot' })).body.error, 'INVALID_KEY');
  assert.equal((await h.command(pairing, { type: 'KEY', key: 'down' })).status, 200);
  assert.equal((await h.command(pairing, { type: 'WAKE' })).status, 200);
  assert.deepEqual(h.adb.calls.slice(-2), [['key', '100.101.102.103:5555', 'down'], ['wake', '100.101.102.103:5555']]);
  h.adb.failWith('ADB_UNAUTHORIZED');
  const refused = await h.command(pairing, { type: 'KEY', key: 'ok' });
  assert.deepEqual([refused.status, refused.body.error], [502, 'ADB_UNAUTHORIZED']);
});

test('the ADB address must be a host and an ADB port', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const set = (adbTarget) => h.api(`/api/devices/${pairing.deviceId}`, { method: 'PATCH', cookie: pairing.cookie, body: { adbTarget } });
  for (const bad of ['evil.example:22', '100.1.1.1', 'http://100.1.1.1:5555', '100.1.1.1:5555; rm -rf /', 5555]) {
    assert.equal((await set(bad)).body.error, 'INVALID_ADB_TARGET', String(bad));
  }
  assert.equal((await set('mom-firestick:5555')).body.device.adbTarget, 'mom-firestick:5555');
  assert.equal((await set(null)).body.device.adbTarget, null);
});

test('device details include ADB status, and snapshots return the TV screen as PNG', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  assert.equal((await h.api(`/api/devices/${pairing.deviceId}/snapshot`, { cookie: pairing.cookie })).body.error, 'ADB_NOT_SET');
  await h.api(`/api/devices/${pairing.deviceId}`, { method: 'PATCH', cookie: pairing.cookie, body: { adbTarget: '100.101.102.103:5555' } });
  const details = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.deepEqual(details.body.adb, { state: 'CONNECTED', awake: true, app: 'home', package: 'com.amazon.tv.launcher' });
  assert.equal(details.body.device.appOnline, true);
  const snapshot = await h.api(`/api/devices/${pairing.deviceId}/snapshot`, { cookie: pairing.cookie });
  assert.equal(snapshot.type, 'image/png');
  assert.equal(snapshot.body.toString(), 'fake-png'.repeat(20));
  h.adb.blankSnapshot();
  const blocked = await h.api(`/api/devices/${pairing.deviceId}/snapshot`, { cookie: pairing.cookie });
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'SNAPSHOT_BLOCKED']);
});

test('a slow ADB status check does not hold up device details after the first check', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair({ adbTarget: '100.101.102.103:5555' });
  const details = () => h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal((await details()).body.adb.state, 'CONNECTED');
  h.advance(5000);
  h.adb.failWith('ADB_OFFLINE');
  h.adb.slow(300);
  const started = Date.now();
  assert.equal((await details()).body.adb.state, 'CONNECTED');
  assert.ok(Date.now() - started < 250, 'answered from the last result');
  await new Promise((done) => setTimeout(done, 350));
  assert.equal((await details()).body.adb.state, 'ADB_OFFLINE');
});

test('disconnecting on the TV removes caregiver access, the ADB address and history', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair({ adbTarget: '100.101.102.103:5555' });
  await h.play(pairing, await h.save(pairing));
  const revoked = await h.api('/api/tv/revoke', { method: 'POST', token: pairing.token, body: {} });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.device.adbTarget, null);
  assert.match(revoked.body.code, /^\d{6}$/);
  assert.equal((await h.command(pairing, { type: 'KEY', key: 'ok' })).status, 404);
  const next = await h.session('New caregiver');
  const paired = await h.api('/api/pair', { method: 'POST', cookie: next.cookie, body: { code: revoked.body.code, name: 'TV' } });
  assert.equal(paired.status, 200);
  assert.deepEqual((await h.api(`/api/devices/${pairing.deviceId}`, { cookie: next.cookie })).body.commands, []);
});

test('a command whose body arrives after the TV disconnects is refused', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const show = await h.save(pairing);
  const url = new URL(`${h.base()}/api/devices/${pairing.deviceId}/commands`);
  const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: pairing.cookie } });
  const response = new Promise((done) => request.on('response', (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => done({ status: res.statusCode, body: JSON.parse(text) })); }));
  request.write(`{"type":"OPEN_SHOW","showId":"${show.id}",`);
  await new Promise((done) => setTimeout(done, 50));
  await h.api('/api/tv/revoke', { method: 'POST', token: pairing.token, body: {} });
  request.end('"idempotencyKey":"late"}');
  assert.equal((await response).status, 404);
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
});

test('store persists hashed credentials and code, not bearer tokens or session secrets', async (t) => {
  const h = await harness(t);
  const caregiver = await h.session();
  const tv = await h.register();
  const raw = await readFile(join(h.dataDir, 'relay.json'), 'utf8');
  assert.equal(raw.includes(tv.token), false);
  assert.equal(raw.includes(caregiver.cookie.split('=')[1]), false);
  assert.equal(raw.includes(`"${tv.code}"`), false);
  await h.restart();
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Saved TV' } })).status, 200);
});

test('a store from the catalog prototype keeps sessions and pairings', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const file = join(h.dataDir, 'relay.json');
  const current = JSON.parse(await readFile(file, 'utf8'));
  const legacy = {
    version: 1, sessions: current.sessions, commands: [{ id: 'old', state: 'QUEUED' }],
    devices: current.devices.map((device) => ({ ...device, foreground: true, quiet: false, playback: null, adbTarget: undefined })),
  };
  await writeFile(file, JSON.stringify(legacy));
  await h.restart();
  const details = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(details.status, 200);
  assert.deepEqual([details.body.device.adbTarget, details.body.commands], [null, []]);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 2);
});

test('pairing brute-force attempts are rate-limited', async (t) => {
  const h = await harness(t, { rateLimit: true });
  const caregiver = await h.session();
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: '123456', name: 'TV' } })).status, 400);
  }
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: '123456', name: 'TV' } })).status, 429);
  h.advance(60_000);
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: '123456', name: 'TV' } })).status, 400);
});

test('cross-site mutations and non-JSON requests are rejected', async (t) => {
  const h = await harness(t);
  assert.equal((await h.api('/api/session', { method: 'POST', body: { name: 'Intruder' }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await h.api('/api/session', { method: 'POST', body: { name: 'Intruder' }, headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('the built web app is served next to the API, without leaving its folder', async (t) => {
  const web = await mkdtemp(join(tmpdir(), 'mompilot-web-'));
  t.after(() => rm(web, { recursive: true, force: true }));
  await writeFile(join(web, 'index.html'), '<!doctype html><title>MomPilot</title>');
  await writeFile(join(web, 'manifest.webmanifest'), '{}');
  const h = await harness(t, { staticDir: web });
  const get = async (path) => { const response = await fetch(`${h.base()}${path}`); return { status: response.status, type: response.headers.get('content-type'), text: await response.text(), headers: response.headers }; };
  const home = await get('/');
  assert.match(home.text, /MomPilot/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal((await get('/manifest.webmanifest')).type, 'application/manifest+json');
  assert.match((await get('/share?url=https%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ')).text, /MomPilot/);
  for (const sneaky of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json']) {
    const response = await get(sneaky);
    assert.match(response.text, /<title>MomPilot/, sneaky);
  }
  assert.equal((await h.api('/api/health')).body.ok, true);
});

test('nearby lists Android devices on the tailnet, TVs with ADB first, and marks ones already added', async (t) => {
  const h = await harness(t, { tailnet: fakeTailnet([
    { name: 'POCO F1', address: '100.79.216.34', adb: false },
    { name: 'Mom’s Fire TV', address: '100.121.36.62', adb: true },
  ]) });
  const caregiver = await h.session();
  assert.equal((await h.api('/api/tvs/nearby')).status, 401);
  const first = await h.api('/api/tvs/nearby', { cookie: caregiver.cookie });
  assert.deepEqual(first.body.tvs, [
    { name: 'Mom’s Fire TV', address: '100.121.36.62:5555', adb: true, added: false },
    { name: 'POCO F1', address: '100.79.216.34:5555', adb: false, added: false },
  ]);
  await h.api('/api/tvs/setup', { method: 'POST', cookie: caregiver.cookie, body: { address: '100.121.36.62' } });
  assert.equal((await h.api('/api/tvs/nearby', { cookie: caregiver.cookie })).body.tvs[0].added, true);
});

test('setting up a TV gives the TV app this server and a working credential, with no codes', async (t) => {
  const h = await harness(t);
  const caregiver = await h.session();
  const setup = (body, cookie = caregiver.cookie) => h.api('/api/tvs/setup', { method: 'POST', cookie, body });
  assert.equal((await setup({ address: 'evil.example:22' })).body.error, 'INVALID_ADB_TARGET');

  const created = await setup({ address: '100.121.36.62', name: 'Mom’s TV', serverUrl: 'http://localhost:8787' });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.device.adbTarget, created.body.device.name, created.body.device.paired], ['100.121.36.62:5555', 'Mom’s TV', true]);
  // Localhost is no use to the TV, so the server's own Tailscale address is used.
  assert.equal(h.adb.configured.server, 'https://mompilot-server.tail1234.ts.net');
  const poll = await h.api('/api/tv/commands', { token: h.adb.configured.token });
  assert.deepEqual([poll.status, poll.body.device.id, poll.body.device.caregiver.name], [200, created.body.device.id, 'Varish']);
  assert.equal((await h.api('/api/devices', { cookie: caregiver.cookie })).body.devices.length, 1);

  // Setting the same TV up again keeps the device and replaces the TV's credential.
  const oldToken = h.adb.configured.token;
  const again = await setup({ address: '100.121.36.62:5555', serverUrl: 'https://my-win.tail4d01fc.ts.net' });
  assert.deepEqual([again.status, again.body.device.id], [200, created.body.device.id]);
  assert.equal(h.adb.configured.server, 'https://my-win.tail4d01fc.ts.net');
  assert.equal((await h.api('/api/tv/commands', { token: oldToken })).status, 401);
  assert.equal((await h.api('/api/tv/commands', { token: h.adb.configured.token })).status, 200);

  // Someone else can't take it over while it's connected.
  const other = await h.session('Someone else');
  assert.equal((await setup({ address: '100.121.36.62' }, other.cookie)).body.error, 'TV_ALREADY_CONNECTED');
});

test('TV setup asks for Allow, refuses non-Fire TVs, installs the TV app when missing, and rolls back failures', async (t) => {
  const h = await harness(t, { tvApk: '/builds/mompilot-tv.apk' });
  const caregiver = await h.session();
  const setup = () => h.api('/api/tvs/setup', { method: 'POST', cookie: caregiver.cookie, body: { address: '100.121.36.62' } });

  h.adb.failWith('ADB_UNAUTHORIZED');
  const waiting = await setup();
  assert.deepEqual([waiting.status, waiting.body.error], [502, 'ADB_UNAUTHORIZED']);
  h.adb.failWith(null);

  h.adb.tv = { manufacturer: 'Xiaomi', model: 'POCO F1', os: '', hasApp: false };
  assert.equal((await setup()).body.error, 'NOT_FIRE_TV');

  h.adb.tv = { manufacturer: 'Amazon', model: 'AFTSS', os: 'Fire OS 7.7.1.7', hasApp: false };
  h.adb.refuseSetup = 'ADB_SETUP_FAILED';
  assert.equal((await setup()).body.error, 'ADB_SETUP_FAILED');
  assert.deepEqual((await h.api('/api/devices', { cookie: caregiver.cookie })).body.devices, []);
  assert.ok(h.adb.calls.some(([name, target, apk]) => name === 'install' && target === '100.121.36.62:5555' && apk === '/builds/mompilot-tv.apk'));

  h.adb.refuseSetup = null;
  assert.equal((await setup()).status, 201);
});

test('TV setup without a TV app to install, or without a server address, says what to do', async (t) => {
  const h = await harness(t, { tailnet: fakeTailnet([], null) });
  const caregiver = await h.session();
  const setup = (body) => h.api('/api/tvs/setup', { method: 'POST', cookie: caregiver.cookie, body });
  assert.equal((await setup({ address: '100.121.36.62', serverUrl: 'http://127.0.0.1:8787' })).body.error, 'NO_SERVER_ADDRESS');
  h.adb.tv = { manufacturer: 'Amazon', model: 'AFTSS', os: '', hasApp: false };
  assert.equal((await setup({ address: '100.121.36.62', serverUrl: 'https://my-win.tail4d01fc.ts.net' })).body.error, 'TV_APP_MISSING');
});

test('the server reports its public address, preferring PUBLIC_URL', async (t) => {
  assert.equal((await (await harness(t)).api('/api/server')).body.publicUrl, 'https://mompilot-server.tail1234.ts.net');
  assert.equal((await (await harness(t, { publicUrl: 'https://mompilot.example' })).api('/api/server')).body.publicUrl, 'https://mompilot.example');
});

test('concurrent pairing claims produce a single owner', async (t) => {
  const h = await harness(t);
  const [first, second, tv] = await Promise.all([h.session('First'), h.session('Second'), h.register()]);
  const claims = await Promise.all([first, second].map((caregiver) => h.api('/api/pair', {
    method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Shared TV' },
  })));
  assert.deepEqual(claims.map((claim) => claim.status).sort(), [200, 400]);
});
