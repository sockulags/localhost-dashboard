const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const EXEC_OPTS = { encoding: 'utf-8', timeout: 5000, windowsHide: true };
// PowerShell has a slower cold start than plain native tools.
const PS_EXEC_OPTS = { encoding: 'utf-8', timeout: 10000, windowsHide: true };

/**
 * Run a PowerShell expression (used instead of wmic, which is removed
 * in newer Windows 11 builds) and return trimmed stdout.
 * Callers must only interpolate validated integers into the expression.
 */
async function runPowerShell(expression) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', expression],
    PS_EXEC_OPTS
  );
  return stdout.trim();
}

/**
 * Fetch detailed info for a single process (on-demand, not polled).
 * Returns { commandLine, connections, children }.
 */
async function collect(pid) {
  const safePid = parseInt(pid, 10);
  if (!Number.isFinite(safePid) || safePid <= 0) {
    return { commandLine: '', connections: [], children: [] };
  }

  const [commandLine, connections, children] = await Promise.all([
    getCommandLine(safePid),
    getConnections(safePid),
    getChildren(safePid),
  ]);

  return { commandLine, connections, children };
}

// --- Command line ---

async function getCommandLine(pid) {
  try {
    if (process.platform === 'win32') {
      const stdout = await runPowerShell(
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`
      );
      return stdout;
    }

    // Linux/macOS: ps -p <pid> -o args=
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], EXEC_OPTS);
    return stdout.trim();
  } catch {
    return '';
  }
}

// --- Network connections ---

async function getConnections(pid) {
  try {
    if (process.platform === 'win32') {
      return await getConnectionsWindows(pid);
    }
    if (process.platform === 'linux') {
      return await getConnectionsLinux(pid);
    }
    return await getConnectionsMacOS(pid);
  } catch {
    return [];
  }
}

async function getConnectionsWindows(pid) {
  // netstat -ano gives all connections; filter by PID
  const { stdout } = await execFileAsync('netstat', ['-ano'], EXEC_OPTS);
  const results = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;

    const protocol = parts[0].toUpperCase();
    if (protocol !== 'TCP' && protocol !== 'UDP') continue;

    const pidStr = parts[parts.length - 1];
    if (parseInt(pidStr, 10) !== pid) continue;

    const local = parts[1];
    const remote = parts[2];
    const state = protocol === 'TCP' ? (parts[3] || '') : '';

    results.push({ protocol, local, remote, state });
  }
  return results;
}

async function getConnectionsLinux(pid) {
  // ss -tnp: all TCP connections with process info
  try {
    const { stdout } = await execFileAsync('ss', ['-tnp'], EXEC_OPTS);
    return parseSSConnections(stdout, pid);
  } catch {
    return getConnectionsLsof(pid);
  }
}

function parseSSConnections(output, pid) {
  const results = [];
  const pidPattern = new RegExp(`pid=${pid}[,)]`);

  for (const line of output.split('\n')) {
    if (!pidPattern.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    results.push({
      protocol: 'TCP',
      local: parts[3] || '',
      remote: parts[4] || '',
      state: parts[0] || '',
    });
  }
  return results;
}

function getConnectionsMacOS(pid) {
  return getConnectionsLsof(pid);
}

async function getConnectionsLsof(pid) {
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-iTCP', '-nP', '-a', '-p', String(pid)],
      EXEC_OPTS
    );
    const results = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('COMMAND')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length < 9) continue;

      const nameField = parts.slice(8).join(' ');
      // Parse "host:port->remote:port (STATE)" or "host:port (LISTEN)"
      const stateMatch = nameField.match(/\((\w+)\)/);
      const state = stateMatch ? stateMatch[1] : '';
      const addrPart = nameField.replace(/\s*\(\w+\)/, '');
      const arrowSplit = addrPart.split('->');

      results.push({
        protocol: 'TCP',
        local: arrowSplit[0] || '',
        remote: arrowSplit[1] || '',
        state,
      });
    }
    return results;
  } catch {
    return [];
  }
}

// --- Child processes ---

async function getChildren(pid) {
  try {
    if (process.platform === 'win32') {
      return await getChildrenWindows(pid);
    }
    return await getChildrenUnix(pid);
  } catch {
    return [];
  }
}

async function getChildrenWindows(pid) {
  const stdout = await runPowerShell(
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ` +
      'Select-Object ProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress'
  );
  if (!stdout) return [];

  // ConvertTo-Json emits a bare object for a single match, an array otherwise
  const parsed = JSON.parse(stdout);
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  const results = [];
  for (const entry of entries) {
    const childPid = parseInt(entry.ProcessId, 10);
    if (!Number.isFinite(childPid)) continue;

    results.push({
      pid: childPid,
      name: entry.Name || '',
      memKB: Math.round(parseInt(entry.WorkingSetSize, 10) / 1024) || 0,
    });
  }
  return results;
}

async function getChildrenUnix(pid) {
  // Try with --ppid first (Linux), fall back to manual filtering (macOS)
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['--ppid', String(pid), '-o', 'pid,rss,comm', '--no-headers'],
      EXEC_OPTS
    );
    return parsePsChildren(stdout);
  } catch {
    try {
      // macOS: get all processes with ppid column, filter manually
      const { stdout } = await execFileAsync('ps', ['-eo', 'ppid,pid,rss,comm'], EXEC_OPTS);
      const results = [];
      for (const line of stdout.split('\n')) {
        const match = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) continue;
        if (parseInt(match[1], 10) !== pid) continue;
        results.push({
          pid: parseInt(match[2], 10),
          name: match[4].trim().split('/').pop(),
          memKB: parseInt(match[3], 10) || 0,
        });
      }
      return results;
    } catch {
      return [];
    }
  }
}

function parsePsChildren(output) {
  const results = [];
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    results.push({
      pid: parseInt(match[1], 10),
      name: match[3].trim().split('/').pop(),
      memKB: parseInt(match[2], 10) || 0,
    });
  }
  return results;
}

/**
 * Resolve the executable path for a given PID.
 * Returns the path string or null if unavailable.
 */
async function getExecutablePath(pid) {
  const safePid = parseInt(pid, 10);
  if (!Number.isFinite(safePid) || safePid <= 0) return null;

  try {
    if (process.platform === 'win32') {
      const stdout = await runPowerShell(
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${safePid}").ExecutablePath`
      );
      return stdout || null;
    }

    if (process.platform === 'linux') {
      // readlink on /proc/<pid>/exe gives the actual binary path
      const { stdout } = await execFileAsync('readlink', ['-f', `/proc/${safePid}/exe`], EXEC_OPTS);
      const resolved = stdout.trim();
      return resolved || null;
    }

    // macOS: ps -p <pid> -o comm= returns the executable path
    const { stdout } = await execFileAsync('ps', ['-p', String(safePid), '-o', 'comm='], EXEC_OPTS);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

module.exports = { collect, getExecutablePath };
