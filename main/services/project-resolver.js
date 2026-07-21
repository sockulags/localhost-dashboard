// Resolves which project owns a listening port by inspecting the owning
// process's working directory and walking up the tree looking for a
// package.json (name field) or a docker-compose file (directory name).
//
// Platform notes:
// - linux/darwin: one batched `lsof -a -p <pid,pid,...> -d cwd -Fn` call
//   gives the true cwd for every pending pid in a single spawn.
// - win32: the true cwd of another process is not cheaply available, so this
//   is BEST-EFFORT: one batched Get-CimInstance query returns CommandLine /
//   ExecutablePath for all pending pids, and we take the directory of the
//   last script-looking argument (preferred) or the exe path. For
//   `node server.js`-style processes the script path usually lives inside
//   the project, which is what we want. Exe paths under system install
//   locations (Program Files, Windows, ProgramData) are ignored — they never
//   identify a project.
//
// Resolution is taken OFF the poll hot path: resolve() applies already
// cached names synchronously and schedules the (single-spawn) lookup for
// uncached pids in the background, so the snapshot never waits on the
// resolver; names appear on the next poll. Results are cached by pid+name
// (a process's project cannot change during its lifetime; including the
// name catches most pid-reuse cases, though a recycled pid with the same
// image name could in theory inherit a stale label). Dead pids are pruned
// on every resolve() call. All command execution is wrapped in try/catch —
// resolution failures never fail a poll.

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const defaultFs = require('fs');

const execFileAsync = promisify(execFile);

// Maximum number of directories inspected while walking up from the cwd.
const MAX_WALK_LEVELS = 6;
// Above this many pending pids, query Win32_Process unfiltered instead of
// building an enormous WQL OR-filter.
const MAX_WQL_FILTER_PIDS = 50;

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yaml',
  'compose.yml',
];

// PowerShell cold start can be slow; match detail-collector's conventions.
const PS_EXEC_OPTS = {
  encoding: 'utf-8',
  timeout: 10000,
  windowsHide: true,
  maxBuffer: 10 * 1024 * 1024,
};

// cache key (`pid:name`) -> project name string, or null when resolution
// ran but found nothing.
const cache = new Map();
// Keys currently being resolved in the background (avoid duplicate spawns).
const inFlight = new Set();
// Chain of scheduled background lookups; awaited by flushPending() in tests.
let pendingChain = Promise.resolve();

function cacheKey(proc) {
  return `${proc.pid}:${proc.name || ''}`;
}

// ── Pure helpers (exported for tests) ──────────────────────────

/**
 * Parse `lsof -a -p <pid,...> -d cwd -Fn` output into a Map of pid -> cwd.
 * Each process block starts with a `p<pid>` line; the cwd shows up as a
 * line prefixed with `n`, e.g. `n/home/lucas/code/my-shop`.
 */
function parseLsofCwd(output) {
  const map = new Map();
  let currentPid = null;
  for (const raw of String(output || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line.startsWith('p')) {
      const pid = parseInt(line.slice(1), 10);
      currentPid = Number.isNaN(pid) ? null : pid;
    } else if (line.startsWith('n') && line.length > 1 && currentPid !== null) {
      if (!map.has(currentPid)) map.set(currentPid, line.slice(1));
    }
  }
  return map;
}

/**
 * Parse `Get-CimInstance ... | Select-Object ProcessId,CommandLine,
 * ExecutablePath | ConvertTo-Json -Compress` output into a Map of
 * pid -> { commandLine, executablePath }. ConvertTo-Json emits a bare
 * object for a single match and an array otherwise.
 */
function parseCimProcesses(output) {
  const map = new Map();
  const trimmed = String(output || '').trim();
  if (!trimmed) return map;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return map;
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of items) {
    if (!item) continue;
    const pid = Number(item.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, {
      commandLine: item.CommandLine || null,
      executablePath: item.ExecutablePath || null,
    });
  }
  return map;
}

/** Split a command line into tokens, honouring double quotes. */
function tokenizeCommandLine(commandLine) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(commandLine)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

/**
 * True for directories under system install locations that never identify
 * a project (node.exe lives in Program Files, etc.).
 */
function isSystemInstallDir(dir) {
  return /(^|[\\/])(program files( \(x86\))?|windows|programdata)([\\/]|$)/i.test(dir);
}

/**
 * Best-effort directory extraction from a Windows command line. Prefers the
 * LAST script-looking argument — earlier ones are usually hooks/preloads
 * (`node --require C:\hooks\pre.js C:\proj\server.js`) — over the exe path
 * (node.exe etc. usually lives outside the project). Directories under
 * system install locations are never returned.
 */
function parseCommandLineDir(commandLine) {
  if (!commandLine || typeof commandLine !== 'string') return null;
  const tokens = tokenizeCommandLine(commandLine);
  if (tokens.length === 0) return null;

  const scriptExt = /\.(js|mjs|cjs|ts|jsx|tsx|py|rb|php)$/i;
  for (let i = tokens.length - 1; i >= 1; i--) {
    const token = tokens[i];
    if (scriptExt.test(token) && /[\\/]/.test(token)) {
      const dir = path.win32.dirname(token);
      if (!isSystemInstallDir(dir)) return dir;
    }
  }

  if (/[\\/]/.test(tokens[0])) {
    const dir = path.win32.dirname(tokens[0]);
    if (!isSystemInstallDir(dir)) return dir;
  }
  return null;
}

/** Directory for one Win32_Process record, or null. */
function dirFromWinProcessInfo(info) {
  if (!info) return null;
  const fromCommandLine = parseCommandLineDir(info.commandLine);
  if (fromCommandLine) return fromCommandLine;
  // CommandLine is null for elevated processes; fall back to the exe path
  // (parseCommandLineDir applies the system-dir blocklist).
  return parseCommandLineDir(info.executablePath ? `"${info.executablePath}"` : null);
}

/** True when dir is (or is inside) a node_modules tree. */
function isInsideNodeModules(dir) {
  return /(^|[\\/])node_modules([\\/]|$)/i.test(dir);
}

/**
 * Walk up from startDir looking for a project marker:
 * - package.json with a `name` field → that name
 * - docker-compose.yml / compose.yaml (and .yml/.yaml variants) → dir name
 * Directories inside node_modules are skipped (a dependency's package.json
 * is not the project) but the walk continues above them. Stops at the
 * filesystem/drive root or after MAX_WALK_LEVELS directories.
 * `fs` is injectable for tests.
 */
function findProjectName(startDir, { fs = defaultFs } = {}) {
  if (!startDir || typeof startDir !== 'string') return null;

  let dir = startDir;
  for (let level = 0; level < MAX_WALK_LEVELS; level++) {
    if (!isInsideNodeModules(dir)) {
      try {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) {
            return pkg.name.trim();
          }
        }
      } catch {
        // Unreadable/broken package.json — fall through to compose, keep walking.
      }

      try {
        for (const composeFile of COMPOSE_FILES) {
          if (fs.existsSync(path.join(dir, composeFile))) {
            const base = path.basename(dir);
            if (base) return base;
          }
        }
      } catch {
        // Ignore fs errors and keep walking.
      }
    }

    const parent = path.dirname(dir);
    if (!parent || parent === dir) break; // filesystem / drive root
    dir = parent;
  }
  return null;
}

// ── Batched process-directory lookup (one spawn per batch) ─────

async function getProcessDirs(pids) {
  const valid = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0);
  if (valid.length === 0) return new Map();

  try {
    if (process.platform === 'win32') {
      // One PowerShell spawn for the whole batch.
      const filter = valid.length <= MAX_WQL_FILTER_PIDS
        ? ` -Filter "${valid.map((p) => `ProcessId=${p}`).join(' OR ')}"`
        : '';
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process${filter} | ` +
          'Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress',
      ], PS_EXEC_OPTS);

      const wanted = new Set(valid);
      const dirs = new Map();
      for (const [pid, info] of parseCimProcesses(stdout)) {
        if (!wanted.has(pid)) continue;
        const dir = dirFromWinProcessInfo(info);
        if (dir) dirs.set(pid, dir);
      }
      return dirs;
    }

    // linux / darwin: lsof gives the real cwd; one spawn for all pids.
    // lsof exits non-zero when any pid in the list is gone but still prints
    // output for the live ones, so keep stdout from the error object too.
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('lsof', [
        '-a', '-p', valid.join(','), '-d', 'cwd', '-Fn',
      ], { encoding: 'utf-8', timeout: 10000, maxBuffer: 10 * 1024 * 1024 }));
    } catch (err) {
      stdout = (err && err.stdout) || '';
    }
    return parseLsofCwd(stdout);
  } catch {
    return new Map();
  }
}

// ── Resolution driver ──────────────────────────────────────────

/** True when the process holds at least one LISTENING port. */
function ownsListeningPort(proc) {
  const details = proc.portDetails;
  if (Array.isArray(details) && details.length > 0) {
    return details.some((d) => !d.state || d.state === 'LISTENING' || d.state === 'LISTEN');
  }
  return Array.isArray(proc.ports) && proc.ports.length > 0;
}

async function resolveBatch(entries, { getDirsForPids, fs }) {
  try {
    const dirs = await getDirsForPids(entries.map((e) => e.pid));
    for (const entry of entries) {
      let name = null;
      try {
        const dir = dirs && dirs.get(entry.pid);
        if (dir) name = findProjectName(dir, { fs });
      } catch {
        name = null;
      }
      cache.set(entry.key, name);
    }
  } catch {
    // Leave the keys uncached; they will be retried on a later poll.
  } finally {
    for (const entry of entries) inFlight.delete(entry.key);
  }
}

/**
 * Attach `proc.projectName` to processes that own listening ports.
 * Mutates the given array's entries in place and never blocks the poll:
 * cached names are applied synchronously, uncached pids are looked up by a
 * single batched command scheduled in the background (names show up on the
 * next poll). Dead pids are pruned from the cache. Options are injectable
 * for tests: { getDirsForPids, fs }.
 */
async function resolve(processes, { getDirsForPids = getProcessDirs, fs = defaultFs } = {}) {
  try {
    if (!Array.isArray(processes)) return processes;

    const aliveKeys = new Set();
    const pending = [];

    for (const proc of processes) {
      const key = cacheKey(proc);
      aliveKeys.add(key);
      if (!ownsListeningPort(proc)) continue;

      if (cache.has(key)) {
        const cached = cache.get(key);
        if (cached) proc.projectName = cached;
      } else if (!inFlight.has(key)) {
        inFlight.add(key);
        pending.push({ key, pid: proc.pid });
      }
    }

    // Prune cache entries for processes that no longer exist.
    for (const key of cache.keys()) {
      if (!aliveKeys.has(key)) cache.delete(key);
    }

    if (pending.length > 0) {
      const job = resolveBatch(pending, { getDirsForPids, fs });
      pendingChain = pendingChain.then(() => job);
    }
  } catch {
    // Never fail the poll because of project resolution.
  }
  return processes;
}

/** Await all background lookups scheduled so far (test helper). */
function flushPending() {
  return pendingChain;
}

module.exports = {
  resolve,
  flushPending,
  findProjectName,
  parseLsofCwd,
  parseCimProcesses,
  parseCommandLineDir,
  dirFromWinProcessInfo,
  tokenizeCommandLine,
  isSystemInstallDir,
  isInsideNodeModules,
  ownsListeningPort,
  cache,
};
