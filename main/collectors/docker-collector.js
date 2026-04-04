const { execSync } = require('child_process');

let dockerAvailable = null;

function checkDocker() {
  try {
    execSync('docker info', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function parseDockerJson(output) {
  const containers = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);
      const ports = parsePorts(obj.Ports || '');

      containers.push({
        id: obj.ID || '',
        name: obj.Names || '',
        image: obj.Image || '',
        status: obj.Status || '',
        state: (obj.State || '').toLowerCase(),
        ports,
        createdAt: obj.CreatedAt || '',
      });
    } catch {
      // Skip malformed lines
    }
  }

  return containers;
}

function parsePorts(portStr) {
  if (!portStr) return [];

  const ports = [];
  // Docker port format: "0.0.0.0:3000->3000/tcp, 0.0.0.0:5432->5432/tcp"
  const parts = portStr.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match host:port->container/proto or just port/proto
    const bindMatch = trimmed.match(/(?:(\S+?):)?(\d+)->(\d+)\/(tcp|udp)/i);
    if (bindMatch) {
      ports.push({
        hostAddress: bindMatch[1] || '0.0.0.0',
        hostPort: parseInt(bindMatch[2], 10),
        containerPort: parseInt(bindMatch[3], 10),
        protocol: bindMatch[4],
      });
    } else {
      // Exposed but not bound: "3000/tcp"
      const exposeMatch = trimmed.match(/(\d+)\/(tcp|udp)/i);
      if (exposeMatch) {
        ports.push({
          hostAddress: '',
          hostPort: null,
          containerPort: parseInt(exposeMatch[1], 10),
          protocol: exposeMatch[2],
        });
      }
    }
  }

  return ports;
}

function collect() {
  // Re-check Docker availability periodically (cache for ~30 seconds worth of polls)
  if (dockerAvailable === null) {
    dockerAvailable = checkDocker();
  }

  if (!dockerAvailable) {
    return [];
  }

  try {
    const output = execSync(
      'docker ps --format json --no-trunc',
      {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    return parseDockerJson(output);
  } catch {
    // Docker daemon may have stopped
    dockerAvailable = null;
    return [];
  }
}

// Reset cached availability (called periodically)
function resetCache() {
  dockerAvailable = null;
}

module.exports = { collect, resetCache };
