import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRelay } from '../server/relay.mjs';

async function harness(t, options = {}) {
  const prefix = join(tmpdir(), 'mompilot-relay-');
  const dataDir = await mkdtemp(prefix);
  let time = Date.parse('2026-09-29T12:00:00Z');
  let relay;
  let base;
  async function start() {
    relay = createRelay({ dataDir, now: () => time, rateLimit: false, ...options });
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
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
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
  const pair = async () => {
    const caregiver = await session();
    const tv = await register();
    const response = await api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Mom’s TV' } });
    assert.equal(response.status, 200);
    return { ...caregiver, ...tv, device: response.body.device };
  };
  const send = (pairing, body = {}) => api(`/api/devices/${pairing.deviceId}/commands`, {
    method: 'POST', cookie: pairing.cookie,
    body: { type: 'PLAY_CATALOG_ITEM', itemId: 'bunny', idempotencyKey: 'first-action', ...body },
  });
  const ack = (pairing, command, state, reason) => api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: command.id, state, ...(reason ? { reason } : {}) },
  });
  return {
    api, session, register, pair, send, ack, dataDir,
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
  assert.equal(who.body.caregiver.id, caregiver.caregiver.id);
  await h.restart();
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 200);
  await h.api('/api/session', { method: 'DELETE', cookie: caregiver.cookie });
  assert.equal((await h.api('/api/session', { cookie: caregiver.cookie })).status, 401);
});

test('pairing is single-use and devices are isolated between caregiver identities', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  assert.match(pairing.code, /^\d{6}$/);
  assert.equal(pairing.device.caregiver.name, 'Varish');
  assert.equal(pairing.device.paired, true);
  const other = await h.session('Another caregiver');
  const replay = await h.api('/api/pair', { method: 'POST', cookie: other.cookie, body: { code: pairing.code, name: 'Other TV' } });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'INVALID_CODE');
  assert.deepEqual((await h.api('/api/devices', { cookie: other.cookie })).body.devices, []);
  assert.equal((await h.api(`/api/devices/${pairing.deviceId}`, { cookie: other.cookie })).status, 404);
  assert.equal((await h.send({ ...pairing, cookie: other.cookie })).status, 404);
  assert.equal((await h.api('/api/tv/pairing', { method: 'POST', token: pairing.token, body: {} })).status, 409);
});

test('editing a caregiver name preserves session identity, paired TVs, and command access', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const edited = await h.api('/api/session', { method: 'POST', cookie: pairing.cookie, body: { name: '  Priya  ' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.caregiver.id, pairing.caregiver.id);
  assert.equal(edited.body.caregiver.name, 'Priya');
  assert.equal(edited.cookie, null);
  assert.equal((await h.api('/api/session', { cookie: pairing.cookie })).body.caregiver.name, 'Priya');
  const devices = await h.api('/api/devices', { cookie: pairing.cookie });
  assert.equal(devices.body.devices[0].id, pairing.deviceId);
  assert.equal(devices.body.devices[0].caregiver.name, 'Priya');
  assert.equal((await h.api('/api/tv/commands', { token: pairing.token })).body.device.caregiver.name, 'Priya');
  assert.equal((await h.send(pairing)).status, 201);
  await h.restart();
  const restored = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.device.caregiver.name, 'Priya');
});

test('pairing expires at the deadline and refreshing invalidates the previous code', async (t) => {
  const h = await harness(t, { pairingTtlMs: 1000 });
  const caregiver = await h.session();
  const tv = await h.register();
  h.advance(1000);
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'TV' } })).status, 400);
  const fresh = await h.api('/api/tv/pairing', { method: 'POST', token: tv.token, body: {} });
  assert.equal(fresh.status, 200);
  assert.equal((await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: fresh.body.code, name: 'TV' } })).status, 200);
});

test('device tokens cannot access another TV or acknowledge its commands', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const other = await h.register();
  assert.equal((await h.api('/api/tv/commands')).status, 401);
  assert.equal((await h.api('/api/tv/commands', { token: 'not-a-real-token' })).status, 401);
  const queued = await h.send(pairing);
  assert.equal((await h.ack(other, queued.body.command, 'RECEIVED')).status, 404);
  const poll = await h.api('/api/tv/commands', { token: other.token });
  assert.equal(poll.body.device.id, other.deviceId);
  assert.deepEqual(poll.body.commands, []);
});

test('command retry returns the original record and rejects changed payloads', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const first = await h.send(pairing);
  assert.equal(first.status, 201);
  const repeated = await h.send(pairing);
  assert.equal(repeated.status, 200);
  assert.equal(first.body.command.id, repeated.body.command.id);
  const conflict = await h.send(pairing, { itemId: 'sintel' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'IDEMPOTENCY_CONFLICT');
  h.advance(31_000);
  const lateRetry = await h.send(pairing);
  assert.equal(lateRetry.status, 200);
  assert.equal(lateRetry.body.command.state, 'EXPIRED');
  assert.equal(lateRetry.body.command.id, first.body.command.id);
  const detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(detail.body.commands.length, 1);
});

test('acks require receipt and a result matching the allowed command type', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const { command } = (await h.send(pairing)).body;
  assert.equal((await h.ack(pairing, command, 'PLAYING')).status, 409);
  assert.equal((await h.ack(pairing, command, 'RECEIVED')).status, 200);
  assert.equal((await h.ack(pairing, command, 'RECEIVED')).status, 200);
  assert.equal((await h.ack(pairing, command, 'DISPLAYED')).status, 409);
  assert.equal((await h.ack(pairing, command, 'PLAYING')).body.command.state, 'PLAYING');
  assert.equal((await h.ack(pairing, command, 'PLAYING')).status, 200);
  assert.equal((await h.ack(pairing, command, 'FAILED', 'Too late')).status, 409);
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
});

test('expired commands are excluded from polling and cannot be acknowledged', async (t) => {
  const h = await harness(t, { commandTtlMs: 1000 });
  const pairing = await h.pair();
  const { command } = (await h.send(pairing)).body;
  await h.ack(pairing, command, 'RECEIVED');
  h.advance(1000);
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
  assert.equal((await h.ack(pairing, command, 'PLAYING')).status, 409);
  const detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(detail.body.commands[0].state, 'EXPIRED');
});

test('heartbeat timeout is honest and foreground exit invalidates queued work', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  h.advance(15_000);
  let detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(detail.body.device.online, false);
  assert.equal((await h.send(pairing)).body.error, 'DEVICE_UNAVAILABLE');
  await h.api('/api/tv/heartbeat', { method: 'POST', token: pairing.token, body: { foreground: true } });
  const queued = await h.send(pairing);
  assert.equal(queued.status, 201);
  await h.api('/api/tv/heartbeat', { method: 'POST', token: pairing.token, body: { foreground: false } });
  detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(detail.body.device.online, false);
  assert.equal(detail.body.commands[0].state, 'FAILED');
  await h.api('/api/tv/heartbeat', { method: 'POST', token: pairing.token, body: { foreground: true } });
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
});

test('quiet mode blocks new commands, cancels pending work, and survives restart', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  await h.send(pairing);
  const quiet = await h.api('/api/tv/settings', { method: 'POST', token: pairing.token, body: { quiet: true } });
  assert.equal(quiet.body.device.quiet, true);
  assert.equal((await h.send(pairing, { idempotencyKey: 'second-action' })).body.error, 'QUIET_MODE');
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
  const detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie });
  assert.equal(detail.body.commands[0].state, 'FAILED');
  await h.restart();
  assert.equal((await h.api('/api/tv/commands', { token: pairing.token })).body.device.quiet, true);
});

test('revocation immediately removes caregiver access and clears the previous household history', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const { command } = (await h.send(pairing)).body;
  const revoked = await h.api('/api/tv/revoke', { method: 'POST', token: pairing.token, body: {} });
  assert.equal(revoked.body.device.paired, false);
  assert.match(revoked.body.code, /^\d{6}$/);
  assert.equal((await h.send(pairing)).status, 404);
  assert.deepEqual((await h.api('/api/devices', { cookie: pairing.cookie })).body.devices, []);
  assert.equal((await h.ack(pairing, command, 'RECEIVED')).status, 404);
  const other = await h.session('New caregiver');
  const repaired = await h.api('/api/pair', { method: 'POST', cookie: other.cookie, body: { code: revoked.body.code, name: 'New TV name' } });
  assert.equal(repaired.status, 200);
  const detail = await h.api(`/api/devices/${pairing.deviceId}`, { cookie: other.cookie });
  assert.deepEqual(detail.body.commands, []);
  assert.equal(detail.body.device.caregiver.name, 'New caregiver');
});

test('unapproved videos, freeform messages, arbitrary URLs, and invalid heartbeat data are rejected', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  assert.equal((await h.send(pairing, { itemId: 'https://example.com/secret.mp4' })).status, 400);
  assert.equal((await h.send(pairing, { url: 'https://example.com/secret.mp4' })).status, 400);
  assert.equal((await h.send(pairing, { type: 'SHELL_EXEC' })).status, 400);
  assert.equal((await h.send(pairing, { type: 'SHOW_MESSAGE', itemId: undefined, messageId: 'custom text' })).status, 400);
  assert.equal((await h.api('/api/tv/heartbeat', { method: 'POST', token: pairing.token, body: { foreground: 'yes' } })).status, 400);
  assert.equal((await h.api('/api/tv/heartbeat', { method: 'POST', token: pairing.token, body: { foreground: true, playback: { itemId: 'netflix', state: 'PLAYING', position: 0, duration: 20 } } })).status, 400);
  const poll = await h.api('/api/tv/commands', { token: pairing.token });
  assert.equal(poll.body.device.foreground, true);
  assert.equal(poll.body.commands.length, 0);
});

test('message, pause, and resume commands report their distinct acknowledged results', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  for (const [type, payload, finalState] of [
    ['SHOW_MESSAGE', { messageId: 'found-video' }, 'DISPLAYED'],
    ['PAUSE', {}, 'PAUSED'],
    ['RESUME', {}, 'PLAYING'],
  ]) {
    const { command } = (await h.send(pairing, { type, itemId: undefined, idempotencyKey: type, ...payload })).body;
    assert.equal((await h.ack(pairing, command, 'RECEIVED')).status, 200);
    assert.equal((await h.ack(pairing, command, finalState)).body.command.state, finalState);
  }
  const heartbeat = await h.api('/api/tv/heartbeat', {
    method: 'POST', token: pairing.token,
    body: { foreground: true, playback: { itemId: 'bunny', state: 'PAUSED', position: 12.5, duration: 596 } },
  });
  assert.equal(heartbeat.body.device.playback.position, 12.5);
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
  const paired = await h.api('/api/pair', { method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Saved TV' } });
  assert.equal(paired.status, 200);
  assert.equal(paired.body.device.online, false);
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

test('concurrent pairing claims and duplicate sends produce a single authorized effect', async (t) => {
  const h = await harness(t);
  const [first, second, tv] = await Promise.all([h.session('First'), h.session('Second'), h.register()]);
  const claims = await Promise.all([first, second].map((caregiver) => h.api('/api/pair', {
    method: 'POST', cookie: caregiver.cookie, body: { code: tv.code, name: 'Shared TV' },
  })));
  assert.deepEqual(claims.map((claim) => claim.status).sort(), [200, 400]);
  const owner = claims[0].status === 200 ? first : second;
  const pairing = { ...owner, ...tv };
  const sends = await Promise.all([h.send(pairing), h.send(pairing)]);
  assert.deepEqual(sends.map((response) => response.status).sort(), [200, 201]);
  assert.equal(sends[0].body.command.id, sends[1].body.command.id);
  assert.equal((await h.api('/api/tv/commands', { token: tv.token })).body.commands.length, 1);
});

test('experimental YouTube sends accept only the fixed approved item and preserve idempotency', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const first = await h.send(pairing, { type: 'OPEN_YOUTUBE' });
  assert.equal(first.status, 201);
  assert.equal(first.body.command.type, 'OPEN_YOUTUBE');
  assert.equal(first.body.command.itemId, 'bunny');
  const retry = await h.send(pairing, { type: 'OPEN_YOUTUBE' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.command.id, first.body.command.id);
  assert.equal((await h.send(pairing)).body.error, 'IDEMPOTENCY_CONFLICT');
  for (const payload of [
    { itemId: 'sintel' }, { itemId: 'arbitrary-youtube-id' }, { itemId: undefined },
    { url: 'https://www.youtube.com/watch?v=arbitrary' },
    { videoId: 'arbitrary' }, { packageName: 'arbitrary.app' },
    { messageId: 'found-video' }, { foreground: false },
  ]) {
    const rejected = await h.send(pairing, { type: 'OPEN_YOUTUBE', idempotencyKey: 'invalid-launch', ...payload });
    assert.equal(rejected.status, 400);
  }
  const pending = await h.api('/api/tv/commands', { token: pairing.token });
  assert.equal(pending.body.commands.length, 1);
});

test('YouTube launch acknowledgments require receipt, matching type, and explicit foreground false', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const { command } = (await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body;
  const launchAck = (extra = {}) => h.api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: command.id, state: 'LAUNCHED', foreground: false, ...extra },
  });
  assert.equal((await launchAck()).body.error, 'INVALID_TRANSITION');
  assert.equal((await h.ack(pairing, command, 'RECEIVED')).status, 200);
  assert.equal((await h.ack(pairing, command, 'PLAYING')).body.error, 'INVALID_TRANSITION');
  for (const foreground of [undefined, true, null, 'false']) {
    assert.equal((await launchAck({ foreground })).body.error, 'INVALID_ACK');
  }
  assert.equal((await launchAck({ url: 'https://example.com' })).status, 400);
  assert.equal((await launchAck({ state: 'RECEIVED' })).body.error, 'INVALID_ACK');
  const normal = (await h.send(pairing, { idempotencyKey: 'normal-play' })).body.command;
  const wrongType = await h.api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: normal.id, state: 'LAUNCHED', foreground: false },
  });
  assert.equal(wrongType.body.error, 'INVALID_TRANSITION');
  assert.equal((await launchAck()).body.command.state, 'LAUNCHED');
});

test('YouTube handoff atomically finishes launch, marks offline, pauses own player and cancels competing work', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  await h.api('/api/tv/heartbeat', {
    method: 'POST', token: pairing.token,
    body: { foreground: true, playback: { itemId: 'sintel', state: 'PLAYING', position: 8, duration: 52 } },
  });
  const launch = (await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body.command;
  const competing = (await h.send(pairing, { idempotencyKey: 'competing-play' })).body.command;
  await h.ack(pairing, launch, 'RECEIVED');
  await h.ack(pairing, competing, 'RECEIVED');
  const launchAck = () => h.api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: launch.id, state: 'LAUNCHED', foreground: false },
  });
  const launched = await launchAck();
  assert.equal(launched.status, 200);
  assert.equal(launched.body.command.state, 'LAUNCHED');
  let details = (await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie })).body;
  assert.equal(details.device.foreground, false);
  assert.equal(details.device.online, false);
  assert.deepEqual(details.device.playback, { itemId: 'sintel', state: 'PAUSED', position: 8, duration: 52 });
  assert.equal(details.commands.find((entry) => entry.id === competing.id).state, 'FAILED');
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
  assert.equal((await h.send(pairing, { idempotencyKey: 'offline-play' })).body.error, 'DEVICE_UNAVAILABLE');
  assert.equal((await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body.command.state, 'LAUNCHED');
  assert.equal((await launchAck()).status, 200);

  h.advance(1000);
  await h.api('/api/tv/heartbeat', {
    method: 'POST', token: pairing.token,
    body: { foreground: true, playback: { itemId: 'sintel', state: 'PLAYING', position: 9, duration: 52 } },
  });
  const newer = (await h.send(pairing, { idempotencyKey: 'after-return' })).body.command;
  const repeated = await launchAck();
  assert.deepEqual(repeated.body.command, launched.body.command);
  details = (await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie })).body;
  assert.equal(details.device.foreground, true);
  assert.equal(details.device.online, true);
  assert.equal(details.device.playback.state, 'PLAYING');
  assert.equal(details.commands.find((entry) => entry.id === newer.id).state, 'QUEUED');
});

test('YouTube launch completion needs current foreground presence and failure remains an ordinary result', async (t) => {
  const h = await harness(t);
  const pairing = await h.pair();
  const { command } = (await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body;
  await h.ack(pairing, command, 'RECEIVED');
  h.advance(15_000);
  const stale = await h.api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: command.id, state: 'LAUNCHED', foreground: false },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'DEVICE_UNAVAILABLE');
  const failed = await h.ack(pairing, command, 'FAILED', 'YouTube is not installed on this TV.');
  assert.equal(failed.body.command.state, 'FAILED');
  assert.equal(failed.body.command.reason, 'YouTube is not installed on this TV.');
});

test('unconfirmed YouTube launches expire without claiming the external app stayed closed', async (t) => {
  const h = await harness(t, { commandTtlMs: 1000 });
  const pairing = await h.pair();
  const { command } = (await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body;
  await h.ack(pairing, command, 'RECEIVED');
  h.advance(1000);
  const expired = (await h.send(pairing, { type: 'OPEN_YOUTUBE' })).body.command;
  assert.equal(expired.state, 'EXPIRED');
  assert.match(expired.reason, /launch result is unconfirmed/i);
  assert.match(expired.reason, /external app may have opened/i);
  const late = await h.api('/api/tv/ack', {
    method: 'POST', token: pairing.token, body: { id: command.id, state: 'LAUNCHED', foreground: false },
  });
  assert.equal(late.body.error, 'COMMAND_FINISHED');
  const details = (await h.api(`/api/devices/${pairing.deviceId}`, { cookie: pairing.cookie })).body;
  assert.equal(details.device.foreground, true);
  assert.deepEqual((await h.api('/api/tv/commands', { token: pairing.token })).body.commands, []);
});
