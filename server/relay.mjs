import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, presets } from './catalog.mjs';

const PENDING = new Set(['QUEUED', 'RECEIVED']);
const TYPES = new Set(['PLAY_CATALOG_ITEM', 'SHOW_MESSAGE', 'PAUSE', 'RESUME', 'OPEN_YOUTUBE']);
const PLAYBACK_STATES = new Set(['PLAYING', 'PAUSED', 'IDLE', 'ENDED', 'FAILED']);
const SUCCESS = { PLAY_CATALOG_ITEM: 'PLAYING', SHOW_MESSAGE: 'DISPLAYED', PAUSE: 'PAUSED', RESUME: 'PLAYING', OPEN_YOUTUBE: 'LAUNCHED' };
const COOKIE = 'mompilot_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const iso = (time) => new Date(time).toISOString();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new ApiError(status, code, message); }

function cleanText(value, label, max = 60) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(400, 'INVALID_REQUEST', `${label} must contain 1–${max} readable characters.`);
  }
  return value.trim();
}

function exactKeys(body, allowed) {
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) fail(400, 'INVALID_REQUEST', `Unsupported field: ${unexpected[0]}.`);
}

async function readBody(req) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') fail(415, 'JSON_REQUIRED', 'Send an application/json request body.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) fail(413, 'BODY_TOO_LARGE', 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    fail(400, 'INVALID_JSON', 'Send a valid JSON object.');
  }
}

/** A dependency-free local relay. Inject a clock and a temporary data directory for integration tests. */
export function createRelay({
  dataDir = resolve(process.cwd(), '.local'),
  now = Date.now,
  pairingTtlMs = 5 * 60 * 1000,
  commandTtlMs = 30 * 1000,
  heartbeatTimeoutMs = 15 * 1000,
  rateLimit = true,
} = {}) {
  mkdirSync(dataDir, { recursive: true });
  const file = resolve(dataDir, 'relay.json');
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.devices) || !Array.isArray(state.sessions) || !Array.isArray(state.commands)) {
      throw new Error('Unsupported relay store format.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot load ${file}: ${error.message}`);
    state = { version: 1, devices: [], sessions: [], commands: [] };
  }
  const persist = () => {
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  };
  const limits = new Map();
  function limit(key, max, interval = 60_000) {
    if (!rateLimit) return;
    const timestamp = now();
    // Keys are request identities, so prune old buckets instead of growing forever.
    for (const [bucketKey, value] of limits) if (value.until <= timestamp) limits.delete(bucketKey);
    let bucket = limits.get(key);
    if (!bucket) { bucket = { count: 0, until: timestamp + interval }; limits.set(key, bucket); }
    if (++bucket.count > max) fail(429, 'RATE_LIMITED', 'Please wait a moment before trying again.');
  }

  function expire() {
    let changed = false;
    for (const command of state.commands) {
      if (PENDING.has(command.state) && Date.parse(command.expiresAt) <= now()) {
        const reason = command.type === 'OPEN_YOUTUBE'
          ? 'The YouTube launch result is unconfirmed. The external app may have opened; check the TV before retrying.'
          : 'The TV did not complete this command in time. Please try again.';
        Object.assign(command, { state: 'EXPIRED', reason, updatedAt: iso(now()) });
        changed = true;
      }
    }
    const sessions = state.sessions.filter((session) => session.expiresAt > now());
    if (sessions.length !== state.sessions.length) { state.sessions = sessions; changed = true; }
    if (changed) persist();
  }

  function invalidatePending(deviceId, reason) {
    for (const command of state.commands) {
      if (command.deviceId === deviceId && PENDING.has(command.state)) {
        Object.assign(command, { state: 'FAILED', reason, updatedAt: iso(now()) });
      }
    }
  }

  // A process restart is not evidence that a TV is still foreground or reachable.
  for (const device of state.devices) {
    device.foreground = false;
    invalidatePending(device.id, 'The local relay restarted. Open MomPilot on the TV and try again.');
  }
  if (state.devices.length) persist();

  function deviceView(device) {
    return {
      id: device.id,
      name: device.name,
      paired: Boolean(device.caregiver),
      caregiver: device.caregiver,
      online: Boolean(device.foreground && device.lastSeenAt && now() - Date.parse(device.lastSeenAt) < heartbeatTimeoutMs),
      foreground: device.foreground,
      quiet: device.quiet,
      lastSeenAt: device.lastSeenAt,
      playback: device.playback,
      pairedAt: device.pairedAt,
    };
  }

  function sessionFor(req) {
    const match = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    const token = match?.slice(COOKIE.length + 1);
    if (!token) fail(401, 'SIGN_IN_REQUIRED', 'Start a caregiver demo session first.');
    const session = state.sessions.find((candidate) => candidate.tokenHash === hash(token) && candidate.expiresAt > now());
    if (!session) fail(401, 'SIGN_IN_REQUIRED', 'Your demo session expired. Please start a new session.');
    return session;
  }

  function tvFor(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(req.headers.authorization || '');
    if (!match) fail(401, 'DEVICE_AUTH_REQUIRED', 'A valid TV credential is required.');
    const device = state.devices.find((candidate) => candidate.tokenHash === hash(match[1]));
    if (!device) fail(401, 'DEVICE_AUTH_REQUIRED', 'The TV credential is not valid.');
    return device;
  }

  function ownedDevice(req, id) {
    const session = sessionFor(req);
    const device = state.devices.find((candidate) => candidate.id === id && candidate.caregiver?.id === session.caregiver.id);
    if (!device) fail(404, 'DEVICE_NOT_FOUND', 'This TV is not paired with your caregiver session.');
    return { session, device };
  }

  function newPairing(device) {
    let code;
    do { code = String(randomInt(0, 1_000_000)).padStart(6, '0'); }
    while (state.devices.some((entry) => entry.pairing?.codeHash === hash(code) && entry.pairing.expiresAt > now()));
    const expiresAt = now() + pairingTtlMs;
    device.pairing = { codeHash: hash(code), expiresAt };
    return { code, expiresAt: iso(expiresAt) };
  }

  const server = createServer(async (req, res) => {
    const respond = (status, value, headers = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      });
      res.end(JSON.stringify(value));
    };
    try {
      expire();
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/$/, '');
      const method = req.method;
      const ip = req.socket.remoteAddress || 'unknown';
      if (method === 'GET' && /^\/images\/(bunny|sintel|dream)\.jpg$/.test(path)) {
        try {
          const image = readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)));
          const contentType = image[0] === 0x89 && image[1] === 0x50 ? 'image/png' : 'image/jpeg';
          res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': image.length, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
          return res.end(image);
        } catch (error) {
          if (error.code === 'ENOENT') fail(404, 'ARTWORK_NOT_FOUND', 'This catalog artwork is not available.');
          throw error;
        }
      }
      if (!path.startsWith('/api/')) fail(404, 'NOT_FOUND', 'This relay serves /api routes only.');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers['sec-fetch-site'] === 'cross-site') {
        fail(403, 'CROSS_SITE_REQUEST', 'Open the local MomPilot app to make this request.');
      }
      if (method === 'GET' && path === '/api/health') return respond(200, { ok: true, mode: 'local-demo' });
      if (method === 'GET' && path === '/api/catalog') return respond(200, { items: catalog, presets });

      if (path === '/api/session') {
        if (method === 'POST') {
          limit(`session:${ip}`, 20);
          const body = await readBody(req);
          exactKeys(body, ['name']);
          const name = cleanText(body.name, 'Your name');
          let existing = null;
          try { existing = sessionFor(req); }
          catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
          if (existing) {
            existing.caregiver.name = name;
            for (const device of state.devices) {
              if (device.caregiver?.id === existing.caregiver.id) device.caregiver.name = name;
            }
            persist();
            return respond(200, { caregiver: existing.caregiver });
          }
          const caregiver = { id: randomUUID(), name };
          const token = randomBytes(32).toString('base64url');
          state.sessions.push({ tokenHash: hash(token), caregiver, expiresAt: now() + SESSION_TTL });
          persist();
          return respond(201, { caregiver }, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL / 1000}` });
        }
        if (method === 'GET') return respond(200, { caregiver: sessionFor(req).caregiver });
        if (method === 'DELETE') {
          const session = sessionFor(req);
          state.sessions = state.sessions.filter((candidate) => candidate !== session);
          persist();
          return respond(200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0` });
        }
      }

      if (method === 'POST' && path === '/api/tv/register') {
        limit(`register:${ip}`, 20);
        const body = await readBody(req);
        exactKeys(body, []);
        const token = randomBytes(32).toString('base64url');
        const device = {
          id: randomUUID(), tokenHash: hash(token), name: 'Living room TV', caregiver: null,
          foreground: true, quiet: false, lastSeenAt: iso(now()), playback: null, pairedAt: null,
        };
        const pairing = newPairing(device);
        state.devices.push(device);
        persist();
        return respond(201, { deviceId: device.id, token, ...pairing });
      }

      if (method === 'POST' && path === '/api/pair') {
        const session = sessionFor(req);
        limit(`pair:${ip}`, 10);
        const body = await readBody(req);
        exactKeys(body, ['code', 'name']);
        if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail(400, 'INVALID_CODE', 'Enter the six-digit code shown on your TV.');
        const name = cleanText(body.name, 'TV name');
        const device = state.devices.find((entry) => !entry.caregiver && entry.pairing?.codeHash === hash(body.code) && entry.pairing.expiresAt > now());
        if (!device) fail(400, 'INVALID_CODE', 'This pairing code is expired or already used. Get a new code on the TV.');
        device.caregiver = { ...session.caregiver };
        device.name = name;
        device.pairing = null;
        device.pairedAt = iso(now());
        persist();
        return respond(200, { device: deviceView(device) });
      }

      if (method === 'GET' && path === '/api/devices') {
        const session = sessionFor(req);
        return respond(200, { devices: state.devices.filter((device) => device.caregiver?.id === session.caregiver.id).map(deviceView) });
      }

      const match = /^\/api\/devices\/([^/]+)(\/commands)?$/.exec(path);
      if (match) {
        const { device, session } = ownedDevice(req, match[1]);
        if (method === 'GET' && !match[2]) {
          return respond(200, { device: deviceView(device), commands: state.commands.filter((entry) => entry.deviceId === device.id).slice(-50).reverse() });
        }
        if (method === 'PATCH' && !match[2]) {
          const body = await readBody(req);
          exactKeys(body, ['name']);
          device.name = cleanText(body.name, 'TV name');
          persist();
          return respond(200, { device: deviceView(device) });
        }
        if (method === 'POST' && match[2]) {
          const body = await readBody(req);
          exactKeys(body, ['type', 'itemId', 'messageId', 'idempotencyKey']);
          if (!TYPES.has(body.type)) fail(400, 'INVALID_COMMAND', 'Choose a supported MomPilot action.');
          const idempotencyKey = cleanText(body.idempotencyKey, 'Request identifier', 128);
          if (body.type === 'PLAY_CATALOG_ITEM') {
            if (!catalog.some((item) => item.id === body.itemId)) fail(400, 'INVALID_ITEM', 'Choose a video from the MomPilot catalog.');
            if (body.messageId !== undefined) fail(400, 'INVALID_COMMAND', 'Video commands cannot contain a message.');
          } else if (body.type === 'OPEN_YOUTUBE') {
            if (body.itemId !== 'bunny') fail(400, 'INVALID_ITEM', 'The experimental YouTube action supports only the approved Big Buck Bunny video.');
            if (body.messageId !== undefined) fail(400, 'INVALID_COMMAND', 'YouTube launch commands cannot contain a message.');
          } else if (body.type === 'SHOW_MESSAGE') {
            if (!presets.some((preset) => preset.id === body.messageId)) fail(400, 'INVALID_MESSAGE', 'Choose one of the preset messages.');
            if (body.itemId !== undefined) fail(400, 'INVALID_COMMAND', 'Message commands cannot contain a video.');
          } else if (body.itemId !== undefined || body.messageId !== undefined) {
            fail(400, 'INVALID_COMMAND', 'Playback controls apply to the current MomPilot video.');
          }
          const previous = state.commands.find((entry) => entry.deviceId === device.id && entry.idempotencyKey === idempotencyKey);
          if (previous) {
            if (previous.type !== body.type || previous.itemId !== body.itemId || previous.messageId !== body.messageId) {
              fail(409, 'IDEMPOTENCY_CONFLICT', 'This request identifier was already used for a different action.');
            }
            return respond(200, { command: previous });
          }
          if (!deviceView(device).online) fail(409, 'DEVICE_UNAVAILABLE', 'Open MomPilot on the TV, then try again.');
          if (device.quiet) fail(409, 'QUIET_MODE', 'Quiet mode is on. The parent can turn it off on the TV.');
          limit(`commands:${session.caregiver.id}:${device.id}`, 30);
          if (state.commands.filter((entry) => entry.deviceId === device.id && PENDING.has(entry.state)).length >= 10) {
            fail(429, 'QUEUE_FULL', 'The TV already has several requests waiting. Please wait for a result.');
          }
          const command = {
            id: randomUUID(), deviceId: device.id, type: body.type,
            ...(body.itemId ? { itemId: body.itemId } : {}), ...(body.messageId ? { messageId: body.messageId } : {}),
            idempotencyKey, state: 'QUEUED', reason: null,
            createdAt: iso(now()), expiresAt: iso(now() + commandTtlMs), updatedAt: iso(now()),
          };
          state.commands.push(command);
          persist();
          return respond(201, { command });
        }
      }

      if (path.startsWith('/api/tv/')) {
        const device = tvFor(req);
        if (method === 'GET' && path === '/api/tv/commands') {
          const available = device.caregiver && !device.quiet && deviceView(device).online;
          return respond(200, { device: deviceView(device), commands: available ? state.commands.filter((entry) => entry.deviceId === device.id && PENDING.has(entry.state)) : [] });
        }
        if (method === 'POST' && path === '/api/tv/pairing') {
          const body = await readBody(req);
          exactKeys(body, []);
          if (device.caregiver) fail(409, 'ALREADY_PAIRED', 'Revoke the current caregiver before pairing again.');
          limit(`pairing:${device.id}`, 10);
          const pairing = newPairing(device);
          persist();
          return respond(200, pairing);
        }
        if (method === 'POST' && path === '/api/tv/heartbeat') {
          const body = await readBody(req);
          exactKeys(body, ['foreground', 'quiet', 'playback']);
          if (typeof body.foreground !== 'boolean') fail(400, 'INVALID_REQUEST', 'foreground must be true or false.');
          if (body.quiet !== undefined && typeof body.quiet !== 'boolean') fail(400, 'INVALID_REQUEST', 'quiet must be true or false.');
          let playback = device.playback;
          if (body.playback === null) playback = null;
          else if (body.playback !== undefined) {
            const value = body.playback;
            if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_PLAYBACK', 'Send valid MomPilot playback information.');
            exactKeys(value, ['itemId', 'state', 'position', 'duration']);
            if (!catalog.some((item) => item.id === value.itemId) || !PLAYBACK_STATES.has(value.state)
              || !Number.isFinite(value.position) || value.position < 0 || !Number.isFinite(value.duration) || value.duration < 0) {
              fail(400, 'INVALID_PLAYBACK', 'Playback requires a catalog item, valid state, and nonnegative position and duration in seconds.');
            }
            playback = { itemId: value.itemId, state: value.state, position: value.position, duration: value.duration };
          }
          device.foreground = body.foreground;
          device.playback = playback;
          device.lastSeenAt = iso(now());
          if (body.quiet !== undefined) device.quiet = body.quiet;
          if (!device.foreground) invalidatePending(device.id, 'MomPilot is no longer open on the TV. Open it and try again.');
          if (device.quiet) invalidatePending(device.id, 'Quiet mode was turned on by the parent.');
          persist();
          return respond(200, { device: deviceView(device) });
        }
        if (method === 'POST' && path === '/api/tv/settings') {
          const body = await readBody(req);
          exactKeys(body, ['quiet']);
          if (typeof body.quiet !== 'boolean') fail(400, 'INVALID_REQUEST', 'quiet must be true or false.');
          device.quiet = body.quiet;
          if (device.quiet) invalidatePending(device.id, 'Quiet mode was turned on by the parent.');
          persist();
          return respond(200, { device: deviceView(device) });
        }
        if (method === 'POST' && path === '/api/tv/revoke') {
          const body = await readBody(req);
          exactKeys(body, []);
          invalidatePending(device.id, 'The parent revoked caregiver access.');
          // Do not expose a previous caregiver's viewing history after a new pairing.
          state.commands = state.commands.filter((command) => command.deviceId !== device.id);
          device.caregiver = null;
          device.pairedAt = null;
          device.playback = null;
          const pairing = newPairing(device);
          persist();
          return respond(200, { device: deviceView(device), ...pairing });
        }
        if (method === 'POST' && path === '/api/tv/ack') {
          const body = await readBody(req);
          // Reading a slow request body can cross the deadline after initial routing.
          expire();
          exactKeys(body, ['id', 'state', 'reason', 'foreground']);
          if (typeof body.id !== 'string' || !['RECEIVED', 'PLAYING', 'DISPLAYED', 'PAUSED', 'FAILED', 'LAUNCHED'].includes(body.state)) {
            fail(400, 'INVALID_ACK', 'Supply a command ID and a supported acknowledgment state.');
          }
          const reason = body.reason === undefined ? null : cleanText(body.reason, 'Failure reason', 300);
          if (reason && body.state !== 'FAILED') fail(400, 'INVALID_ACK', 'Only failed acknowledgments include a reason.');
          const command = state.commands.find((entry) => entry.id === body.id && entry.deviceId === device.id);
          if (!command) fail(404, 'COMMAND_NOT_FOUND', 'This command does not belong to the TV.');
          if (body.state === 'LAUNCHED' && command.type !== 'OPEN_YOUTUBE') {
            fail(409, 'INVALID_TRANSITION', 'Only the experimental YouTube action can report an external launch.');
          }
          const handoff = command.type === 'OPEN_YOUTUBE' && body.state === 'LAUNCHED';
          if (handoff ? body.foreground !== false : body.foreground !== undefined) {
            fail(400, 'INVALID_ACK', 'foreground:false is required only when acknowledging a YouTube launch.');
          }
          // A retry must not take a TV offline again after it has returned to MomPilot.
          if (command.state === body.state) return respond(200, { command });
          if (!PENDING.has(command.state)) fail(409, 'COMMAND_FINISHED', 'This command has already completed or expired.');
          if (body.state !== 'FAILED' && (body.state !== 'RECEIVED' || command.state !== 'QUEUED')
            && !(command.state === 'RECEIVED' && body.state === SUCCESS[command.type])) {
            fail(409, 'INVALID_TRANSITION', 'Acknowledge receipt before reporting the matching command result.');
          }
          if (body.state !== 'FAILED' && (!device.caregiver || device.quiet || !deviceView(device).online)) {
            fail(409, 'DEVICE_UNAVAILABLE', 'The TV must be paired, foreground, and outside quiet mode to execute a command.');
          }
          Object.assign(command, { state: body.state, reason: body.state === 'FAILED' ? reason || 'The TV could not complete this action.' : null, updatedAt: iso(now()) });
          if (handoff) {
            device.foreground = false;
            if (device.playback) device.playback = { ...device.playback, state: 'PAUSED' };
            invalidatePending(device.id, 'MomPilot handed off to YouTube and is no longer in the foreground.');
          }
          persist();
          return respond(200, { command });
        }
      }
      fail(404, 'NOT_FOUND', 'This API route does not exist.');
    } catch (error) {
      if (error instanceof ApiError) return respond(error.status, { error: error.code, message: error.message });
      console.error('Relay request failed:', error);
      return respond(500, { error: 'INTERNAL_ERROR', message: 'The local relay could not finish this request. Please try again.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return {
    server,
    close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
  };
}
