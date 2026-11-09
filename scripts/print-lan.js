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

const scheme = process.argv[2] === 'https' ? 'https' : 'http';
const port = process.env.PORT || (scheme === 'https' ? 3443 : 3000);
const addresses = getLanAddresses();

console.log('');
if (addresses.length === 0) {
  console.log('  (Could not detect a wifi/LAN IP — make sure this computer is connected to a network.)');
} else {
  console.log('  Reachable from other devices on the same wifi at:');
  addresses.forEach((ip) => console.log(`    ${scheme}://${ip}:${port}`));
}
console.log('');
