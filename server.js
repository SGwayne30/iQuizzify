// Custom server so `npm start` can serve the built app over HTTPS (in
// addition to plain HTTP) using a self-signed certificate that's generated
// automatically the first time this runs — no manual cert setup needed.
//
// HTTP:  http://<lan-ip>:3000  (or PORT)
// HTTPS: https://<lan-ip>:3443 (or HTTPS_PORT)
//
// Phones will show a "not trusted" warning for the self-signed cert the
// first time they visit — that's expected for a local self-hosted server;
// tap "Advanced" / "Proceed" (Chrome) or "Visit this website" (Safari)
// once to continue.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const next = require('next');
const selfsigned = require('selfsigned');

const dev = process.env.NODE_ENV !== 'production';
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '3443', 10);
const HOST = '0.0.0.0';

const CERT_DIR = path.join(process.cwd(), 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const out = [];
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return out;
}

async function ensureCert() {
  if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) {
    return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) };
  }
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...getLanAddresses().map((ip) => ({ type: 7, ip })),
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'iquizify.local' }], {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(CERT_FILE, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

const { spawn } = require('child_process');
const { backupOnce } = require('./scripts/backup-db');

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
    // No GUI available — not fatal, just skip opening.
  }
}

const app = next({ dev });
const handle = app.getRequestHandler();

// Overwrite any client-supplied x-real-ip so it can't be spoofed — the
// value we set here comes straight from the raw TCP socket, which is what
// lib/rate-limit.ts trusts for per-IP rate limiting.
function requestHandler(req, res) {
  req.headers['x-real-ip'] = req.socket.remoteAddress || '';
  return handle(req, res);
}

Promise.all([app.prepare(), ensureCert()]).then(([, { key, cert }]) => {
  http.createServer(requestHandler).listen(HTTP_PORT, HOST, () => {
    console.log(`> HTTP  ready on http://localhost:${HTTP_PORT}`);
    getLanAddresses().forEach((ip) => console.log(`         http://${ip}:${HTTP_PORT}`));
    if (process.env.NO_OPEN !== '1') openBrowser(`http://localhost:${HTTP_PORT}`);
  });

  https.createServer({ key, cert }, requestHandler).listen(HTTPS_PORT, HOST, () => {
    console.log(`> HTTPS ready on https://localhost:${HTTPS_PORT}`);
    getLanAddresses().forEach((ip) => console.log(`         https://${ip}:${HTTPS_PORT}`));
    console.log('  (self-signed certificate — phones will show a warning the first time, this is expected)');
  });
}).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Automatic scheduled backups while the server is running (in addition to,
// not instead of, running `npm run backup` from cron/Task Scheduler — see
// README). Disable with BACKUP_INTERVAL_HOURS=0.
const backupIntervalHours = parseFloat(process.env.BACKUP_INTERVAL_HOURS ?? '6');
if (backupIntervalHours > 0) {
  backupOnce().catch((err) => console.error('[backup] Initial backup failed:', err));
  setInterval(() => {
    backupOnce().catch((err) => console.error('[backup] Scheduled backup failed:', err));
  }, backupIntervalHours * 60 * 60 * 1000).unref();
}
