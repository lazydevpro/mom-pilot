import { execFile } from 'node:child_process';
import { connect } from 'node:net';

function defaultRun(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** True if something accepts TCP connections on host:port within the timeout. */
export function portOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Reads `tailscale status --json`: this machine's HTTPS name and the online Android devices. */
export function parseStatus(json) {
  const status = JSON.parse(json);
  const dns = (name) => (name || '').replace(/\.$/, '');
  const peers = Object.values(status.Peer || {})
    .filter((peer) => peer.Online && /android/i.test(peer.OS || ''))
    .map((peer) => ({
      name: peer.HostName || dns(peer.DNSName).split('.')[0],
      address: (peer.TailscaleIPs || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)),
    }))
    .filter((peer) => peer.address);
  return { self: dns(status.Self?.DNSName) || null, peers };
}

/** Finds devices on the Tailscale network that could be Fire TVs. Inject `run` and `probe` in tests. */
export function createTailnet({ tailscalePath = 'tailscale', run = defaultRun, probe = portOpen } = {}) {
  async function status() {
    try { return parseStatus(await run(tailscalePath, ['status', '--json'])); }
    catch { return { self: null, peers: [] }; }
  }
  return {
    /** This machine's https://….ts.net address, if Tailscale is running. */
    async publicUrl() {
      const { self } = await status();
      return self ? `https://${self}` : null;
    },
    /** Online Android devices, with whether ADB answers on port 5555 (TVs with ADB debugging on). */
    async androidDevices() {
      const { peers } = await status();
      return Promise.all(peers.map(async (peer) => ({ ...peer, adb: await probe(peer.address, 5555) })));
    },
  };
}
