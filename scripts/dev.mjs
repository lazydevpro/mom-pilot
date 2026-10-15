import { spawn } from 'node:child_process';
// The Vite proxy expects the server on 8787, even if PORT is set for the web server.
const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: '8787' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', process.env.WEB_HOST || '127.0.0.1'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; children.forEach(child => child.kill()); process.exitCode = code; }
children.forEach(child => { child.on('error', error => { console.error(error); stop(1); }); child.on('exit', code => stop(code || 0)); });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
