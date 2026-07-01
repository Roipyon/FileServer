/**
 * 网络工具 — IP 获取、网络变化检测
 */
const os = require('os');
const logger = require('./logger');

const EXCLUDE_NIC_KEYWORDS = [
  'vethernet', 'docker', 'virtualbox', 'vmware', 'hyper-v', 'wsl',
  'bluetooth', 'tailscale', 'zerotier', 'virtual', 'pseudo', 'npcap', 'loopback',
  'ppp', 'adapter', 'vmxnet', 'cisco', 'anyconnect', 'teredo', 'radmin',
];

const PREFERRED_PREFIXES = [
  '10.', '192.168.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
];

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    if (EXCLUDE_NIC_KEYWORDS.some(k => name.toLowerCase().includes(k))) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.');
        if (parts[0] === '169' && parts[1] === '254') continue;
        ips.push(addr.address);
      }
    }
  }

  ips.sort((a, b) => {
    const aPrefix = a.split('.').slice(0, 2).join('.');
    const bPrefix = b.split('.').slice(0, 2).join('.');
    const aPref = PREFERRED_PREFIXES.some(p => aPrefix.startsWith(p)) ? 0 : 1;
    const bPref = PREFERRED_PREFIXES.some(p => bPrefix.startsWith(p)) ? 0 : 1;
    return aPref - bPref;
  });

  return ips;
}

module.exports = {
  getLocalIPs,
};
