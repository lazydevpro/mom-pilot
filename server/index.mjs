import { resolve } from 'node:path';
import { createRelay } from './relay.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const { server } = createRelay({ dataDir: resolve(process.env.MOMPILOT_DATA_DIR || '.local') });
server.on('error', (error) => { console.error(`MomPilot relay: ${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`MomPilot local demo relay: http://${host}:${port}`);
  console.log('Keep MomPilot open on the TV. This prototype uses local demo sessions, not production sign-in.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.log('LAN testing enabled. Use a trusted test network; this HTTP demo is not a public deployment.');
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
}
