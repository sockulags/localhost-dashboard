const { execSync } = require('child_process');

const EXEC_OPTS = { encoding: 'utf-8', timeout: 5000, windowsHide: true };

/**
 * Fetch detailed info for a single process (on-demand, not polled).
 * Returns { commandLine, connections, children }.
 */
function collect(pid) {
  const safePid = parseInt(pid, 10);
  if (!Number.isFinite(safePid) || safePid <= 0) {
    return { commandLine: '', connections: [], children: [] };
  }

  const [commandLine, connections, children] = [
    getCommandLine(safePid),
    getConnections(safePid),
    getChildren(safePid),
  ];

  return { commandLine, connections, children };
}

// --- Command line ---

function getCommandLine(pid) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(
        `wmic process where ProcessId=${pid} get CommandLine /FORMAT:LIST`,
        EXEC_OPTS
      );
      const match = output.match(/CommandLine=(.+)/);
      return match ? match[1].trim() : '';
    }

    // Linux/macOS: ps -p <pid> -o args=
    const output = execSync(`ps -p ${pid} -o args=`, EXEC_OPTS);
    return output.trim();
  } catch {
    return '';
  }
}

// --- Network connections ---

function getConnections(pid) {
  try {
    if (process.platform === 'win32') {
      return getConnectionsWindows(pid);
    }
    if (process.platform === 'linux') {
      return getConnectionsLinux(pid);
    }
    return getConnectionsMacOS(pid);
  } catch {
    return [];
  }
}

function getConnectionsWindows(pid) {
  // netstat -ano gives all connections; filter by PID
  const output = execSync('netstat -ano', EXEC_OPTS);
  const results = [];

  for (const line of output.split('\n')) {
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

function getConnectionsLinux(pid) {
  // ss -tnp: all TCP connections with process info
  try {
    const output = execSync('ss -tnp', EXEC_OPTS);
    return parseSSConnections(output, pid);
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

function getConnectionsLsof(pid) {
  try {
    const output = execSync(`lsof -iTCP -nP -a -p ${pid}`, EXEC_OPTS);
    const results = [];

    for (const line of output.split('\n')) {
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

function getChildren(pid) {
  try {
    if (process.platform === 'win32') {
      return getChildrenWindows(pid);
    }
    return getChildrenUnix(pid);
  } catch {
    return [];
  }
}

function getChildrenWindows(pid) {
  const output = execSync(
    `wmic process where ParentProcessId=${pid} get ProcessId,Name,WorkingSetSize /FORMAT:CSV`,
    EXEC_OPTS
  );

  const results = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Node')) continue;

    // CSV: Node,Name,ProcessId,WorkingSetSize
    const parts = trimmed.split(',');
    if (parts.length < 4) continue;

    results.push({
      pid: parseInt(parts[2], 10),
      name: parts[1],
      memKB: Math.round(parseInt(parts[3], 10) / 1024) || 0,
    });
  }
  return results;
}

function getChildrenUnix(pid) {
  // Try with --ppid first (Linux), fall back to manual filtering (macOS)
  try {
    const output = execSync(`ps --ppid ${pid} -o pid,rss,comm --no-headers`, EXEC_OPTS);
    return parsePsChildren(output);
  } catch {
    try {
      // macOS: get all processes with ppid column, filter manually
      const output = execSync('ps -eo ppid,pid,rss,comm', EXEC_OPTS);
      const results = [];
      for (const line of output.split('\n')) {
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

module.exports = { collect };
