import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAdb } from './adb.mjs';
import { createRelay } from './relay.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');

/** ADB_PATH, else the Android SDK's platform-tools if installed, else `adb` from PATH. */
function findAdb() {
  if (process.env.ADB_PATH) return process.env.ADB_PATH;
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdks = [
    process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);
  return sdks.map((sdk) => join(sdk, 'platform-tools', exe)).find((path) => existsSync(path)) || 'adb';
}

// After `npm run build`, the same process also serves the phone app.
const web = resolve('dist');
const adbPath = findAdb();
const { server } = createRelay({
  dataDir: resolve(process.env.MOMPILOT_DATA_DIR || '.local'),
  adb: createAdb({ adbPath }),
  staticDir: existsSync(resolve(web, 'index.html')) ? web : null,
});
server.on('error', (error) => { console.error(`MomPilot server: ${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`MomPilot server: http://${host}:${port} (adb: ${adbPath})`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.log('Listening beyond this computer. Keep it on your Tailscale network, not the public internet.');
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
}
