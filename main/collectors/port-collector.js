const { execSync } = require('child_process');

const MOCK_PORTS = [
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 3000, state: 'LISTENING', pid: 1234 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 3001, state: 'LISTENING', pid: 1235 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 8000, state: 'LISTENING', pid: 2001 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 8080, state: 'LISTENING', pid: 2050 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 2375, state: 'LISTENING', pid: 3001 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 5432, state: 'LISTENING', pid: 4001 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 6379, state: 'LISTENING', pid: 4002 },
  { protocol: 'TCP', localAddress: '0.0.0.0', port: 27017, state: 'LISTENING', pid: 4003 },
];

function parseNetstat(output) {
  const ports = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Format: Proto  Local Address          Foreign Address        State           PID
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const protocol = parts[0].toUpperCase();
    if (protocol !== 'TCP' && protocol !== 'UDP') continue;

    const localAddr = parts[1];
    const colonIdx = localAddr.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const localAddress = localAddr.substring(0, colonIdx);
    const port = parseInt(localAddr.substring(colonIdx + 1), 10);
    if (isNaN(port)) continue;

    let state = '';
    let pidStr = '';

    if (protocol === 'TCP') {
      state = parts[3] || '';
      pidStr = parts[4] || '';
    } else {
      // UDP has no state column
      state = '';
      pidStr = parts[3] || '';
    }

    const pid = parseInt(pidStr, 10);
    if (isNaN(pid) || pid === 0) continue;

    ports.push({ protocol, localAddress, port, state, pid });
  }

  return ports;
}

function collect() {
  if (process.platform !== 'win32') {
    return MOCK_PORTS;
  }

  try {
    const output = execSync('netstat -ano', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    return parseNetstat(output);
  } catch {
    return [];
  }
}

module.exports = { collect };
