const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const IGNORE_PATTERNS = [
  'virtualbox', 'vmware', 'vethernet', 'docker', 'veth', 'loopback',
  'tailscale', 'wsl', 'hyper-v', 'vmnet', 'tap', 'tun',
];

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    const lower = name.toLowerCase();
    if (IGNORE_PATTERNS.some((p) => lower.includes(p))) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

function printLan(scheme, port) {
  const addresses = getLanAddresses();
  console.log('');
  if (addresses.length === 0) {
    console.log('  (Could not detect a wifi/LAN IP — make sure this computer is connected to a network.)');
  } else {
    console.log('  Reachable from other devices on the same wifi at:');
    addresses.forEach((ip) => console.log(`    ${scheme}://${ip}:${port}`));
  }
  console.log('');
}

function openBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true, shell: platform === 'win32' }).unref();
  } catch {
    // No GUI available (e.g. a headless server) — not fatal, just skip opening.
  }
}

function waitForServer(scheme, url, onReady, attemptsLeft = 60) {
  const mod = scheme === 'https' ? require('https') : http;
  const opts = scheme === 'https' ? { rejectUnauthorized: false } : {};
  const req = mod.get(url, opts, () => {
    req.destroy();
    onReady();
  });
  req.on('error', () => {
    req.destroy();
    if (attemptsLeft <= 0) return;
    setTimeout(() => waitForServer(scheme, url, onReady, attemptsLeft - 1), 400);
  });
}

const scheme = process.argv[2] === 'https' ? 'https' : 'http';
const port = process.env.PORT || (scheme === 'https' ? 3443 : 3000);
const nextArgs = process.argv.slice(3);

printLan(scheme, port);

const child = spawn('next', nextArgs, {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

let opened = false;
waitForServer(scheme, `${scheme}://localhost:${port}`, () => {
  if (opened) return;
  opened = true;
  openBrowser(`${scheme}://localhost:${port}`);
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
