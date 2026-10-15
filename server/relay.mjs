import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { AdbError, KEYS, createAdb } from './adb.mjs';
import { APPS, LinkError, launchFor, resolveLink, showImage } from './shows.mjs';

const PENDING = new Set(['QUEUED', 'RECEIVED']);
const COOKIE = 'mompilot_session';
// Browsers cap cookie lifetimes at 400 days; every app launch renews the session.
const SESSION_TTL = 400 * 24 * 60 * 60 * 1000;
const LINK_TTL = 10 * 60 * 1000;
const COMMAND_HISTORY = 50;
const ADB_TARGET = /^[A-Za-z0-9.-]{1,253}:(55[5-8]\d)$/;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sessionCookie = (token, maxAge = SESSION_TTL / 1000) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}`;
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

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' https://i.ytimg.com data: blob:",
  "connect-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

/** Serves the built web app; unknown paths get index.html so links like /share open the app. */
async function serveStatic(res, root, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { relative = '/'; }
  let file = resolve(root, `.${relative}`);
  if (file !== root && !file.startsWith(root + sep)) file = resolve(root, 'index.html');
  let body;
  try { body = await readFile(file); }
  catch { file = resolve(root, 'index.html'); body = await readFile(file); }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(extname(file) === '.html' ? { 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' } : {}),
  });
  res.end(body);
}

/** Version 1 stores came from the catalog prototype; keep identities and pairings, drop the rest. */
function migrate(state) {
  if (state.version === 2) return state;
  return {
    version: 2,
    sessions: state.sessions,
    devices: state.devices.map(({ id, tokenHash, name, caregiver, pairing, pairedAt, lastSeenAt }) => ({
      id, tokenHash, name, caregiver, pairing, pairedAt, lastSeenAt, adbTarget: null,
    })),
    shows: [],
    commands: [],
  };
}

/**
 * MomPilot server: saved shows, pairing, and remote control of Fire TV sticks.
 * Commands go over ADB when the device has an ADB address; opening a show falls back to the TV app.
 * Inject a clock, data directory, ADB bridge and link resolver for tests.
 */
export function createRelay({
  dataDir = resolve(process.cwd(), '.local'),
  now = Date.now,
  pairingTtlMs = 5 * 60 * 1000,
  commandTtlMs = 30 * 1000,
  heartbeatTimeoutMs = 15 * 1000,
  statusCacheMs = 4000,
  keepAliveMs = 60_000,
  rateLimit = true,
  adb = createAdb(),
  resolve: resolveShowLink = resolveLink,
  staticDir = null,
} = {}) {
  const webRoot = staticDir && resolve(staticDir);
  mkdirSync(dataDir, { recursive: true });
  const file = resolve(dataDir, 'relay.json');
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
    if (![1, 2].includes(state.version) || !Array.isArray(state.devices) || !Array.isArray(state.sessions)) {
      throw new Error('Unsupported relay store format.');
    }
    state = migrate(state);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot load ${file}: ${error.message}`);
    state = { version: 2, devices: [], sessions: [], shows: [], commands: [] };
  }
  state.links ??= [];
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
        Object.assign(command, { state: 'EXPIRED', reason: 'The TV app did not open this in time. Is MomPilot running on the TV?', updatedAt: iso(now()) });
        changed = true;
      }
    }
    const sessions = state.sessions.filter((session) => session.expiresAt > now());
    if (sessions.length !== state.sessions.length) { state.sessions = sessions; changed = true; }
    const links = state.links.filter((link) => link.expiresAt > now());
    if (links.length !== state.links.length) { state.links = links; changed = true; }
    if (changed) persist();
  }

  function invalidatePending(deviceId, reason) {
    for (const command of state.commands) {
      if (command.deviceId === deviceId && PENDING.has(command.state)) {
        Object.assign(command, { state: 'FAILED', reason, updatedAt: iso(now()) });
      }
    }
  }

  function record(command) {
    state.commands.push(command);
    // Keep a short history per TV so the store doesn't grow forever.
    const mine = state.commands.filter((entry) => entry.deviceId === command.deviceId);
    if (mine.length > COMMAND_HISTORY) {
      const drop = new Set(mine.slice(0, mine.length - COMMAND_HISTORY));
      state.commands = state.commands.filter((entry) => !drop.has(entry));
    }
  }

  // A process restart is not evidence that queued work is still wanted.
  for (const device of state.devices) invalidatePending(device.id, 'The MomPilot server restarted. Please try again.');
  persist();

  const appOnline = (device) => Boolean(device.lastSeenAt && now() - Date.parse(device.lastSeenAt) < heartbeatTimeoutMs);

  function deviceView(device) {
    return {
      id: device.id,
      name: device.name,
      paired: Boolean(device.caregiver),
      caregiver: device.caregiver,
      appOnline: appOnline(device),
      lastSeenAt: device.lastSeenAt,
      pairedAt: device.pairedAt,
      adbTarget: device.adbTarget,
    };
  }

  const statusCache = new Map();
  const inFlight = new Map();
  // An unreachable TV takes seconds to time out, so after the first check the last result is
  // returned at once and refreshed in the background.
  async function adbStatus(device) {
    if (!device.adbTarget) return { state: 'NOT_SET' };
    const target = device.adbTarget;
    let cached = statusCache.get(device.id);
    if (cached?.target !== target) cached = null;
    if (!cached?.probe && (!cached || now() - cached.at >= statusCacheMs)) {
      const entry = { target, at: cached?.at ?? 0, value: cached?.value ?? null };
      entry.probe = adb.status(target).then(
        (status) => ({ state: 'CONNECTED', ...status }),
        (error) => ({ state: error.code || 'ADB_OFFLINE', message: error.message }),
      ).then((value) => {
        if (statusCache.get(device.id) === entry) Object.assign(entry, { value, at: now(), probe: null });
        return value;
      });
      statusCache.set(device.id, entry);
      cached = entry;
    }
    return cached.value ?? cached.probe;
  }

  function cookieToken(req) {
    const match = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    return match?.slice(COOKIE.length + 1) || null;
  }

  function sessionFor(req) {
    const token = cookieToken(req);
    if (!token) fail(401, 'SIGN_IN_REQUIRED', 'Start a caregiver session first.');
    const session = state.sessions.find((candidate) => candidate.tokenHash === hash(token) && candidate.expiresAt > now());
    if (!session) fail(401, 'SIGN_IN_REQUIRED', 'Your session expired. Please start a new session.');
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
    if (!device) fail(404, 'DEVICE_NOT_FOUND', 'This TV is not paired with you.');
    return { session, device };
  }

  function newCode(taken) {
    let code;
    do { code = String(randomInt(0, 1_000_000)).padStart(6, '0'); }
    while (taken(hash(code)));
    return code;
  }

  function newPairing(device) {
    const code = newCode((codeHash) => state.devices.some((entry) => entry.pairing?.codeHash === codeHash && entry.pairing.expiresAt > now()));
    const expiresAt = now() + pairingTtlMs;
    device.pairing = { codeHash: hash(code), expiresAt };
    return { code, expiresAt: iso(expiresAt) };
  }

  function adbFailure(error) {
    if (!(error instanceof AdbError)) throw error;
    const status = error.code === 'ADB_INVALID' ? 400 : error.code === 'ADB_MISSING' ? 500 : 502;
    fail(status, error.code, error.message);
  }

  /** Opens a show or app: ADB first, then the TV app's queue. Returns the stored command. */
  async function open(device, { type, app, show, idempotencyKey }) {
    const launch = show ? launchFor(show) : null;
    const command = {
      id: randomUUID(), deviceId: device.id, type, app, ...(show ? { showId: show.id, title: show.title } : {}),
      idempotencyKey, via: null, state: 'QUEUED', reason: null,
      createdAt: iso(now()), expiresAt: iso(now() + commandTtlMs), updatedAt: iso(now()),
    };
    let adbReason = null;
    if (device.adbTarget) {
      try {
        if (launch) await adb.open(device.adbTarget, launch);
        else await adb.openApp(device.adbTarget, app);
        Object.assign(command, { via: 'adb', state: 'LAUNCHED' });
      } catch (error) {
        if (!(error instanceof AdbError)) throw error;
        adbReason = error.message;
      }
    }
    if (!command.via) {
      if (appOnline(device)) Object.assign(command, { via: 'tv', launch: launch || { package: APPS[app].package } });
      else Object.assign(command, { state: 'FAILED', reason: adbReason || 'MomPilot isn’t running on the TV and no ADB address is set.' });
    }
    command.updatedAt = iso(now());
    return command;
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
      if (!path.startsWith('/api/')) {
        if (!webRoot || !['GET', 'HEAD'].includes(method)) fail(404, 'NOT_FOUND', 'This server serves /api routes only.');
        return await serveStatic(res, webRoot, url.pathname);
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers['sec-fetch-site'] === 'cross-site') {
        fail(403, 'CROSS_SITE_REQUEST', 'Open the MomPilot app to make this request.');
      }
      if (method === 'GET' && path === '/api/health') return respond(200, { ok: true });
      if (method === 'GET' && path === '/api/apps') {
        return respond(200, { apps: Object.entries(APPS).map(([id, app]) => ({ id, name: app.name })), keys: Object.keys(KEYS) });
      }

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
            // The same person may be signed in on several phones; rename everywhere.
            const id = existing.caregiver.id;
            for (const session of state.sessions) if (session.caregiver.id === id) session.caregiver.name = name;
            for (const device of state.devices) if (device.caregiver?.id === id) device.caregiver.name = name;
            persist();
            return respond(200, { caregiver: existing.caregiver });
          }
          const caregiver = { id: randomUUID(), name };
          const token = randomBytes(32).toString('base64url');
          state.sessions.push({ tokenHash: hash(token), caregiver, expiresAt: now() + SESSION_TTL });
          persist();
          return respond(201, { caregiver }, { 'Set-Cookie': sessionCookie(token) });
        }
        if (method === 'GET') {
          // Using the app renews the session, so a phone in regular use never gets signed out.
          const session = sessionFor(req);
          session.expiresAt = now() + SESSION_TTL;
          persist();
          return respond(200, { caregiver: session.caregiver }, { 'Set-Cookie': sessionCookie(cookieToken(req)) });
        }
        if (method === 'DELETE') {
          const session = sessionFor(req);
          state.sessions = state.sessions.filter((candidate) => candidate !== session);
          persist();
          return respond(200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
        }
      }

      // Signing in on another phone (or an iPhone home-screen app, which has its own storage) with a short code.
      if (method === 'POST' && path === '/api/session/link') {
        const session = sessionFor(req);
        limit(`link:${session.caregiver.id}`, 10);
        const body = await readBody(req);
        exactKeys(body, []);
        const code = newCode((codeHash) => state.links.some((link) => link.codeHash === codeHash));
        const expiresAt = now() + LINK_TTL;
        state.links = state.links.filter((link) => link.caregiverId !== session.caregiver.id);
        state.links.push({ codeHash: hash(code), caregiverId: session.caregiver.id, caregiver: { ...session.caregiver }, expiresAt });
        persist();
        return respond(200, { code, expiresAt: iso(expiresAt) });
      }
      if (method === 'POST' && path === '/api/session/join') {
        limit(`join:${ip}`, 10);
        const body = await readBody(req);
        exactKeys(body, ['code']);
        if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail(400, 'INVALID_CODE', 'Enter the six-digit code from your other phone.');
        const link = state.links.find((entry) => entry.codeHash === hash(body.code) && entry.expiresAt > now());
        if (!link) fail(400, 'INVALID_CODE', 'This code is expired or already used. Make a new one on your other phone.');
        state.links = state.links.filter((entry) => entry !== link);
        // Prefer the current name, in case it changed after the code was made.
        const current = state.sessions.find((session) => session.caregiver.id === link.caregiverId);
        const token = randomBytes(32).toString('base64url');
        const caregiver = { ...(current?.caregiver ?? link.caregiver) };
        state.sessions.push({ tokenHash: hash(token), caregiver, expiresAt: now() + SESSION_TTL });
        persist();
        return respond(201, { caregiver }, { 'Set-Cookie': sessionCookie(token) });
      }

      if (path === '/api/shows') {
        if (method === 'GET') {
          const session = sessionFor(req);
          return respond(200, { shows: state.shows.filter((show) => show.caregiverId === session.caregiver.id) });
        }
        if (method === 'POST') {
          sessionFor(req);
          const body = await readBody(req);
          exactKeys(body, ['title', 'link']);
          const title = cleanText(body.title, 'Show name', 80);
          const link = cleanText(body.link, 'Link', 2000);
          let parsed;
          try { parsed = await resolveShowLink(link); }
          catch (error) {
            if (error instanceof LinkError) fail(400, 'INVALID_LINK', error.message);
            fail(400, 'INVALID_LINK', 'That short link could not be opened. Paste the full link instead.');
          }
          // Checked after reading the body so a session ended meanwhile can't save.
          const session = sessionFor(req);
          const show = { id: randomUUID(), caregiverId: session.caregiver.id, title, link, ...parsed, image: showImage(parsed), createdAt: iso(now()) };
          state.shows.push(show);
          persist();
          return respond(201, { show });
        }
      }
      const showMatch = /^\/api\/shows\/([^/]+)$/.exec(path);
      if (showMatch && method === 'DELETE') {
        const session = sessionFor(req);
        const show = state.shows.find((entry) => entry.id === showMatch[1] && entry.caregiverId === session.caregiver.id);
        if (!show) fail(404, 'SHOW_NOT_FOUND', 'This show isn’t in your list.');
        state.shows = state.shows.filter((entry) => entry !== show);
        persist();
        return respond(200, { ok: true });
      }

      if (method === 'POST' && path === '/api/tv/register') {
        limit(`register:${ip}`, 20);
        const body = await readBody(req);
        exactKeys(body, []);
        const token = randomBytes(32).toString('base64url');
        const device = {
          id: randomUUID(), tokenHash: hash(token), name: 'Living room TV', caregiver: null,
          pairing: null, pairedAt: null, lastSeenAt: iso(now()), adbTarget: null,
        };
        const pairing = newPairing(device);
        state.devices.push(device);
        persist();
        return respond(201, { deviceId: device.id, token, ...pairing });
      }

      if (method === 'POST' && path === '/api/pair') {
        sessionFor(req);
        limit(`pair:${ip}`, 10);
        const body = await readBody(req);
        exactKeys(body, ['code', 'name']);
        if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail(400, 'INVALID_CODE', 'Enter the six-digit code shown on the TV.');
        const name = cleanText(body.name, 'TV name');
        const session = sessionFor(req);
        const device = state.devices.find((entry) => !entry.caregiver && entry.pairing?.codeHash === hash(body.code) && entry.pairing.expiresAt > now());
        if (!device) fail(400, 'INVALID_CODE', 'This code is expired or already used. Get a new code on the TV.');
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

      const match = /^\/api\/devices\/([^/]+)(?:\/(commands|snapshot))?$/.exec(path);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) {
          const { device } = ownedDevice(req, id);
          return respond(200, {
            device: deviceView(device),
            adb: await adbStatus(device),
            commands: state.commands.filter((entry) => entry.deviceId === device.id).slice(-20).reverse(),
          });
        }
        if (method === 'GET' && action === 'snapshot') {
          const { device } = ownedDevice(req, id);
          if (!device.adbTarget) fail(409, 'ADB_NOT_SET', 'Set the TV’s ADB address first.');
          let image;
          try { image = await adb.snapshot(device.adbTarget); } catch (error) { adbFailure(error); }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          return res.end(image);
        }
        if (method === 'PATCH' && !action) {
          ownedDevice(req, id);
          const body = await readBody(req);
          exactKeys(body, ['name', 'adbTarget']);
          // Ownership is checked again after reading the body: the TV may have been unpaired meanwhile.
          const { device } = ownedDevice(req, id);
          if (body.name !== undefined) device.name = cleanText(body.name, 'TV name');
          if (body.adbTarget !== undefined) {
            if (body.adbTarget !== null && (typeof body.adbTarget !== 'string' || !ADB_TARGET.test(body.adbTarget.trim()))) {
              fail(400, 'INVALID_ADB_TARGET', 'Enter the TV’s address and ADB port, for example 100.101.102.103:5555.');
            }
            device.adbTarget = body.adbTarget?.trim() || null;
            statusCache.delete(device.id);
          }
          persist();
          return respond(200, { device: deviceView(device) });
        }
        if (method === 'POST' && action === 'commands') {
          ownedDevice(req, id);
          const body = await readBody(req);
          const { session, device } = ownedDevice(req, id);
          limit(`commands:${session.caregiver.id}:${device.id}`, 600);
          if (body.type === 'KEY' || body.type === 'WAKE') {
            exactKeys(body, body.type === 'KEY' ? ['type', 'key'] : ['type']);
            if (body.type === 'KEY' && !Object.hasOwn(KEYS, body.key)) fail(400, 'INVALID_KEY', 'Choose a remote button.');
            if (!device.adbTarget) fail(409, 'ADB_NOT_SET', 'Remote buttons need the TV’s ADB address. Add it in TV settings.');
            try {
              if (body.type === 'KEY') await adb.key(device.adbTarget, body.key);
              else await adb.wake(device.adbTarget);
            } catch (error) { adbFailure(error); }
            statusCache.delete(device.id);
            return respond(200, { ok: true });
          }
          if (body.type !== 'OPEN_SHOW' && body.type !== 'OPEN_APP') fail(400, 'INVALID_COMMAND', 'Choose a supported action.');
          exactKeys(body, body.type === 'OPEN_SHOW' ? ['type', 'showId', 'idempotencyKey'] : ['type', 'app', 'idempotencyKey']);
          const idempotencyKey = cleanText(body.idempotencyKey, 'Request identifier', 128);
          const show = body.type === 'OPEN_SHOW' ? state.shows.find((entry) => entry.id === body.showId && entry.caregiverId === session.caregiver.id) : null;
          if (body.type === 'OPEN_SHOW' && !show) fail(400, 'SHOW_NOT_FOUND', 'Choose a show from your list.');
          if (body.type === 'OPEN_APP' && !Object.hasOwn(APPS, body.app)) fail(400, 'INVALID_APP', 'Choose YouTube, Netflix or Prime Video.');
          const previous = state.commands.find((entry) => entry.deviceId === device.id && entry.idempotencyKey === idempotencyKey);
          if (previous) {
            if (previous.type !== body.type || (previous.showId ?? null) !== (show?.id ?? null) || previous.app !== (show?.app ?? body.app)) {
              fail(409, 'IDEMPOTENCY_CONFLICT', 'This request identifier was already used for a different action.');
            }
            return respond(200, { command: previous });
          }
          // A retry that arrives while ADB is still opening the first request waits for it instead of opening twice.
          const flightKey = `${device.id}:${idempotencyKey}`;
          if (inFlight.has(flightKey)) return respond(200, { command: await inFlight.get(flightKey) });
          const pending = open(device, { type: body.type, app: show?.app ?? body.app, show, idempotencyKey });
          inFlight.set(flightKey, pending);
          let command;
          try { command = await pending; } finally { inFlight.delete(flightKey); }
          record(command);
          statusCache.delete(device.id);
          persist();
          return respond(command.state === 'FAILED' ? 409 : 201, { command });
        }
      }

      if (path.startsWith('/api/tv/')) {
        const device = tvFor(req);
        if (method === 'GET' && path === '/api/tv/commands') {
          // Polling proves the TV app is running; not persisted, to avoid a disk write every poll.
          device.lastSeenAt = iso(now());
          return respond(200, {
            device: deviceView(device),
            commands: device.caregiver ? state.commands.filter((entry) => entry.deviceId === device.id && PENDING.has(entry.state)) : [],
          });
        }
        if (method === 'POST' && path === '/api/tv/pairing') {
          const body = await readBody(req);
          exactKeys(body, []);
          if (device.caregiver) fail(409, 'ALREADY_PAIRED', 'Disconnect the current caregiver before pairing again.');
          limit(`pairing:${device.id}`, 10);
          const pairing = newPairing(device);
          persist();
          return respond(200, pairing);
        }
        if (method === 'POST' && path === '/api/tv/heartbeat') {
          const body = await readBody(req);
          exactKeys(body, []);
          device.lastSeenAt = iso(now());
          persist();
          return respond(200, { device: deviceView(device) });
        }
        if (method === 'POST' && path === '/api/tv/revoke') {
          const body = await readBody(req);
          exactKeys(body, []);
          invalidatePending(device.id, 'The TV was disconnected.');
          state.commands = state.commands.filter((command) => command.deviceId !== device.id);
          device.caregiver = null;
          device.pairedAt = null;
          device.adbTarget = null;
          const pairing = newPairing(device);
          persist();
          return respond(200, { device: deviceView(device), ...pairing });
        }
        if (method === 'POST' && path === '/api/tv/ack') {
          const body = await readBody(req);
          // Reading a slow request body can cross the deadline after initial routing.
          expire();
          exactKeys(body, ['id', 'state', 'reason']);
          if (typeof body.id !== 'string' || !['RECEIVED', 'LAUNCHED', 'FAILED'].includes(body.state)) {
            fail(400, 'INVALID_ACK', 'Supply a command ID and RECEIVED, LAUNCHED or FAILED.');
          }
          const reason = body.reason === undefined ? null : cleanText(body.reason, 'Failure reason', 300);
          if (reason && body.state !== 'FAILED') fail(400, 'INVALID_ACK', 'Only failed acknowledgments include a reason.');
          const command = state.commands.find((entry) => entry.id === body.id && entry.deviceId === device.id);
          if (!command) fail(404, 'COMMAND_NOT_FOUND', 'This command does not belong to the TV.');
          if (command.state === body.state) return respond(200, { command });
          if (!PENDING.has(command.state)) fail(409, 'COMMAND_FINISHED', 'This command has already completed or expired.');
          if (body.state === 'RECEIVED' && command.state !== 'QUEUED') fail(409, 'INVALID_TRANSITION', 'This command was already received.');
          Object.assign(command, { state: body.state, reason: body.state === 'FAILED' ? reason || 'The TV could not open this.' : null, updatedAt: iso(now()) });
          device.lastSeenAt = iso(now());
          persist();
          return respond(200, { command });
        }
      }
      fail(404, 'NOT_FOUND', 'This API route does not exist.');
    } catch (error) {
      if (error instanceof ApiError) return respond(error.status, { error: error.code, message: error.message });
      console.error('MomPilot request failed:', error);
      return respond(500, { error: 'INTERNAL_ERROR', message: 'The MomPilot server could not finish this request. Please try again.' });
    }
  });
  // Keep ADB connections to paired TVs warm, so the first tap after a quiet spell is quick.
  const keepAlive = keepAliveMs > 0 && setInterval(() => {
    for (const device of state.devices) if (device.caregiver && device.adbTarget) void adbStatus(device);
  }, keepAliveMs);
  if (keepAlive) keepAlive.unref();
  server.on('close', () => clearInterval(keepAlive));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return {
    server,
    close: () => new Promise((done, reject) => server.close((error) => error ? reject(error) : done())),
  };
}
