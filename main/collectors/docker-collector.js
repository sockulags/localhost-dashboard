const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let dockerAvailable = null;

async function checkDocker() {
  try {
    await execFileAsync('docker', ['info'], {
      encoding: 'utf-8',
      timeout: 3000,
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

async function collect() {
  // Re-check Docker availability periodically (cache for ~30 seconds worth of polls)
  if (dockerAvailable === null) {
    dockerAvailable = await checkDocker();
  }

  if (!dockerAvailable) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '--format', 'json', '--no-trunc'],
      {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      }
    );

    return parseDockerJson(stdout);
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

// ── Container actions ──────────────────────────────────────────
// Container ids/names as reported by `docker ps`: hex ids or names made of
// [a-zA-Z0-9_.-]. Anything else (spaces, shell metacharacters, empty) is
// rejected main-side — the renderer is not trusted.
const CONTAINER_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function isValidContainerId(id) {
  return typeof id === 'string' && CONTAINER_ID_RE.test(id);
}

// Generous timeout: `docker stop` waits up to 10s for the container to exit
// before SIGKILL, and `docker restart` stops then starts.
const ACTION_TIMEOUT_MS = 15000;
const LOGS_TIMEOUT_MS = 10000;
// Cap collected log output; `--tail 200` should stay far below this.
const LOGS_MAX_BYTES = 1024 * 1024;

// Map raw docker CLI/exec errors to actionable messages (same pattern as
// services/process-killer.js); fall back to the raw message.
function friendlyDockerError(raw) {
  const msg = String(raw || '').trim();
  if (/cannot connect to the docker daemon|docker daemon is not running|error during connect|docker_engine/i.test(msg)) {
    return 'Docker daemon is not running';
  }
  if (/no such container/i.test(msg)) {
    return 'Container no longer exists';
  }
  if (/access.denied|permission denied|operation not permitted/i.test(msg)) {
    return 'Access denied — check Docker permissions';
  }
  if (/ENOENT/.test(msg)) {
    return 'Docker CLI not found';
  }
  if (/ETIMEDOUT|timed? ?out/i.test(msg)) {
    return 'Docker command timed out';
  }
  return msg || 'Unknown error';
}

function clampTail(tail) {
  return Number.isInteger(tail) && tail > 0 && tail <= 10000 ? tail : 200;
}

async function runContainerCommand(subcommand, id) {
  if (!isValidContainerId(id)) {
    return { success: false, error: 'Invalid container id' };
  }

  try {
    // `--` stops flag parsing so an id starting with `-` can't become a flag.
    await execFileAsync('docker', [subcommand, '--', id], {
      encoding: 'utf-8',
      timeout: ACTION_TIMEOUT_MS,
      windowsHide: true,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: friendlyDockerError(err.stderr || err.message || err) };
  }
}

const stopContainer = (id) => runContainerCommand('stop', id);
const restartContainer = (id) => runContainerCommand('restart', id);

function getLogs(id, tail = 200) {
  if (!isValidContainerId(id)) {
    return Promise.resolve({ success: false, logs: '', error: 'Invalid container id' });
  }

  // Docker writes container logs to both stdout and stderr depending on which
  // stream the containerised process used. execFile would hand us two separate
  // buffers and lose chronology, so spawn and append chunks from both streams
  // in ARRIVAL order instead.
  return new Promise((resolve) => {
    const child = spawn(
      'docker',
      ['logs', '--tail', String(clampTail(tail)), '--', id],
      { windowsHide: true }
    );

    const chunks = [];
    let total = 0;
    let truncated = false;
    let settled = false;
    let timer = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const append = (chunk) => {
      if (truncated) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total > LOGS_MAX_BYTES) {
        truncated = true;
        child.kill();
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    timer = setTimeout(() => {
      child.kill();
      settle({ success: false, logs: '', error: 'Docker command timed out' });
    }, LOGS_TIMEOUT_MS);

    child.on('error', (err) => {
      settle({ success: false, logs: '', error: friendlyDockerError(err.message || err) });
    });

    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf-8');
      if (truncated) {
        settle({ success: true, logs: `${output}\n… output truncated …` });
      } else if (code === 0) {
        settle({ success: true, logs: output });
      } else {
        settle({
          success: false,
          logs: '',
          error: friendlyDockerError(output || `docker logs exited with code ${code}`),
        });
      }
    });
  });
}

module.exports = {
  collect,
  resetCache,
  parseDockerJson,
  parsePorts,
  isValidContainerId,
  friendlyDockerError,
  clampTail,
  stopContainer,
  restartContainer,
  getLogs,
};
