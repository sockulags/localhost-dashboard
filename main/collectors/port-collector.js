const { execSync } = require('child_process');

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

function parseSs(output) {
  const ports = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('State') || trimmed.startsWith('Netid')) continue;

    // ss -tlnp output format:
    // LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234,fd=12))
    // or with -tlnpH:
    // LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=1234,fd=12))
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const state = parts[0];
    if (state !== 'LISTEN') continue;

    const localAddr = parts[3];
    const colonIdx = localAddr.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const localAddress = localAddr.substring(0, colonIdx);
    const port = parseInt(localAddr.substring(colonIdx + 1), 10);
    if (isNaN(port)) continue;

    // Extract PID from users:(("name",pid=NNN,fd=N))
    const pidMatch = trimmed.match(/pid=(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) : 0;
    if (pid === 0) continue;

    ports.push({ protocol: 'TCP', localAddress, port, state: 'LISTENING', pid });
  }

  return ports;
}

function parseLsof(output) {
  const ports = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('COMMAND')) continue;

    // lsof -iTCP -sTCP:LISTEN -nP format:
    // COMMAND   PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME
    // node     1234  user  12u IPv4  12345   0t0       TCP   *:3000 (LISTEN)
    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;

    const pid = parseInt(parts[1], 10);
    if (isNaN(pid) || pid === 0) continue;

    const name = parts[8];
    // Parse address like *:3000 or 127.0.0.1:3000
    const colonIdx = name.lastIndexOf(':');
    if (colonIdx === -1) continue;

    const localAddress = name.substring(0, colonIdx);
    const port = parseInt(name.substring(colonIdx + 1), 10);
    if (isNaN(port)) continue;

    ports.push({
      protocol: 'TCP',
      localAddress: localAddress === '*' ? '0.0.0.0' : localAddress,
      port,
      state: 'LISTENING',
      pid,
    });
  }

  return ports;
}

function collect() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano', {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      return parseNetstat(output);
    }

    if (process.platform === 'linux') {
      // Try ss first (modern Linux), fall back to lsof
      try {
        const output = execSync('ss -tlnp', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return parseSs(output);
      } catch {
        const output = execSync('lsof -iTCP -sTCP:LISTEN -nP', {
          encoding: 'utf-8',
          timeout: 5000,
        });
        return parseLsof(output);
      }
    }

    // macOS: use lsof
    const output = execSync('lsof -iTCP -sTCP:LISTEN -nP', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parseLsof(output);
  } catch {
    return [];
  }
}

module.exports = { collect };
