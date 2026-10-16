import test from 'node:test';
import assert from 'node:assert/strict';
import { createTailnet, parseStatus } from '../server/tailnet.mjs';

// Trimmed from `tailscale status --json` on the test network.
const STATUS = JSON.stringify({
  Self: { HostName: 'my-win', DNSName: 'my-win.tail4d01fc.ts.net.', OS: 'windows', TailscaleIPs: ['100.99.58.17', 'fd7a::1'] },
  Peer: {
    a: { HostName: 'POCO F1', DNSName: 'poco-f1.tail4d01fc.ts.net.', OS: 'android', TailscaleIPs: ['100.79.216.34', 'fd7a::2'], Online: true },
    b: { HostName: "varish's 2nd FireTVStick", DNSName: 'varishs-2nd-firetvstick.tail4d01fc.ts.net.', OS: 'android', TailscaleIPs: ['100.121.36.62'], Online: true },
    c: { HostName: 'old-tablet', OS: 'android', TailscaleIPs: ['100.70.0.9'], Online: false },
    d: { HostName: 'laptop', OS: 'linux', TailscaleIPs: ['100.70.0.10'], Online: true },
  },
});

test('status gives this machine’s HTTPS name and the online Android devices', () => {
  assert.deepEqual(parseStatus(STATUS), {
    self: 'my-win.tail4d01fc.ts.net',
    peers: [{ name: 'POCO F1', address: '100.79.216.34' }, { name: "varish's 2nd FireTVStick", address: '100.121.36.62' }],
  });
});

test('android devices are checked for ADB, and a missing tailscale CLI means nothing found', async () => {
  const tailnet = createTailnet({ run: async () => STATUS, probe: async (host, port) => host === '100.121.36.62' && port === 5555 });
  assert.equal(await tailnet.publicUrl(), 'https://my-win.tail4d01fc.ts.net');
  assert.deepEqual((await tailnet.androidDevices()).map((device) => [device.name, device.adb]), [['POCO F1', false], ["varish's 2nd FireTVStick", true]]);
  const missing = createTailnet({ run: async () => { throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }); } });
  assert.equal(await missing.publicUrl(), null);
  assert.deepEqual(await missing.androidDevices(), []);
});
