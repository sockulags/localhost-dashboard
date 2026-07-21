const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function parseTasklistCSV(output) {
  const processes = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('"Image Name"')) continue;

    // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
    const match = trimmed.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
    if (!match) continue;

    const name = match[1];
    const pid = parseInt(match[2], 10);
    const memStr = match[3].replace(/[, ]/g, '').replace(/K$/i, '');
    const memKB = parseInt(memStr, 10) || 0;

    if (pid === 0) continue;

    processes.push({ pid, name, memKB, status: 'Running' });
  }

  return processes;
}

function parsePsOutput(output) {
  const processes = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('PID')) continue;

    // ps output format: PID  PPID  RSS  COMMAND
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const ppid = parseInt(match[2], 10) || 0;
    const memKB = parseInt(match[3], 10) || 0;
    const cmdline = match[4].trim();

    if (pid === 0) continue;

    // Extract process name from command path
    const cmdPath = cmdline.split(/\s/)[0];
    const name = cmdPath.split('/').pop() || cmdPath;

    processes.push({ pid, ppid, name, memKB, status: 'Running' });
  }

  return processes;
}

// Parse `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId |
// ConvertTo-Csv -NoTypeInformation` output into a Map of pid -> ppid.
function parseCimPpidCsv(output) {
  const ppidByPid = new Map();
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // CSV format: "ProcessId","ParentProcessId" (header skipped: not numeric)
    const match = trimmed.match(/^"?(\d+)"?,"?(\d+)"?$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const ppid = parseInt(match[2], 10);
    ppidByPid.set(pid, ppid);
  }

  return ppidByPid;
}

// Parse `wmic process get ProcessId,ParentProcessId` output into a Map of
// pid -> ppid. wmic orders columns alphabetically, so the header line is
// used to figure out which column is which.
function parseWmicPpidOutput(output) {
  const ppidByPid = new Map();
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return ppidByPid;

  const headerCols = lines[0].split(/\s+/);
  const pidIdx = headerCols.indexOf('ProcessId');
  const ppidIdx = headerCols.indexOf('ParentProcessId');
  if (pidIdx === -1 || ppidIdx === -1) return ppidByPid;

  for (const line of lines.slice(1)) {
    const cols = line.split(/\s+/);
    if (cols.length === headerCols.length) {
      const pid = parseInt(cols[pidIdx], 10);
      const ppid = parseInt(cols[ppidIdx], 10);
      if (Number.isNaN(pid)) continue;
      ppidByPid.set(pid, Number.isNaN(ppid) ? 0 : ppid);
    } else if (cols.length === 1) {
      // Row with a blank ParentProcessId — only the ProcessId survives the
      // whitespace split. Keep the process with "unknown parent" (ppid 0)
      // rather than dropping it.
      const pid = parseInt(cols[0], 10);
      if (!Number.isNaN(pid)) ppidByPid.set(pid, 0);
    }
  }

  return ppidByPid;
}

// Windows: tasklist has no parent-pid column, so fetch pid -> ppid pairs
// separately. PowerShell/CIM first; wmic as a fallback for older systems
// (wmic is removed on Win11 24H2 but PowerShell is always present).
async function collectWindowsPpidMap() {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation',
      ],
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    );
    const map = parseCimPpidCsv(stdout);
    if (map.size > 0) return map;
  } catch {
    // fall through to wmic
  }

  try {
    const { stdout } = await execFileAsync(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId'],
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    );
    return parseWmicPpidOutput(stdout);
  } catch {
    return new Map();
  }
}

async function collect() {
  if (process.platform === 'win32') {
    // Known limitations, accepted for a 3-second polling dashboard:
    // - tasklist and the CIM query are two separate snapshots taken in
    //   parallel, so a process that starts/exits between them can briefly
    //   have a missing (0) or stale ppid for one poll.
    // - Windows reuses pids aggressively; a ppid can point at an unrelated
    //   newer process that inherited the dead parent's pid.
    try {
      const [{ stdout }, ppidByPid] = await Promise.all([
        execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }),
        collectWindowsPpidMap(),
      ]);
      const processes = parseTasklistCSV(stdout);
      for (const proc of processes) {
        proc.ppid = ppidByPid.get(proc.pid) || 0;
      }
      return processes;
    } catch {
      return [];
    }
  }

  // Linux and macOS: use ps
  try {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,rss,comm', '--no-headers'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parsePsOutput(stdout);
  } catch {
    // macOS ps doesn't support --no-headers, fall back
    try {
      const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,rss,comm'], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return parsePsOutput(stdout);
    } catch {
      return [];
    }
  }
}

module.exports = {
  collect,
  parseTasklistCSV,
  parsePsOutput,
  parseCimPpidCsv,
  parseWmicPpidOutput,
};
