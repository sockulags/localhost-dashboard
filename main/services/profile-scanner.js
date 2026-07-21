/*
 * Profile scanner — walks a folder for projects and suggests service profiles.
 *
 * Electron-free CommonJS module (runs under plain Node in CI). The `fs`
 * dependency is injectable for tests; only `readdirSync(dir, { withFileTypes })`
 * and `readFileSync(file, 'utf8')` are used.
 */

const path = require('path');

const MAX_DEPTH = 2; // rootDir = depth 0, children = 1, grandchildren = 2
const MAX_SUGGESTIONS = 50;
const MAX_DIRS = 2000; // hard walk budget — bounds I/O on huge/slow trees

// Directories never worth descending into
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  'tmp',
  'temp',
]);

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml'];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldSkipDir(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase());
}

// ── package.json ─────────────────────────────────────────────

function suggestFromPackageJson(raw, dir) {
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return null; // broken JSON — skip silently
  }
  if (!pkg || typeof pkg !== 'object') return null;

  const scripts = pkg.scripts;
  if (!scripts || typeof scripts !== 'object') return null;

  const baseName = (typeof pkg.name === 'string' && pkg.name.trim())
    ? pkg.name.trim()
    : (path.basename(dir) || dir);

  if (typeof scripts.dev === 'string' && scripts.dev.trim()) {
    return { name: `${baseName} (dev)`, command: 'npm run dev', cwd: dir, pattern: 'node' };
  }
  if (typeof scripts.start === 'string' && scripts.start.trim()) {
    return { name: `${baseName} (start)`, command: 'npm start', cwd: dir, pattern: 'node' };
  }
  return null;
}

// ── docker-compose ───────────────────────────────────────────

// Extract top-level service names from a compose file without a YAML parser:
// find the unindented `services:` line, then collect keys indented exactly
// two spaces until the next unindented line.
function extractComposeServices(raw) {
  const services = [];
  const lines = String(raw).split(/\r?\n/);

  let inServices = false;
  for (const line of lines) {
    if (!inServices) {
      if (/^services:\s*(#.*)?$/.test(line)) inServices = true;
      continue;
    }

    // Blank lines and comment lines never terminate the block
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // A new unindented top-level key ends the services block
    if (!/^[ \t]/.test(line)) break;

    // Service keys are indented exactly 2 spaces and end with ':'
    const m = line.match(/^ {2}([A-Za-z0-9][A-Za-z0-9._-]*):\s*(#.*)?$/);
    if (m) services.push(m[1]);
    // Anything else (deeper indentation = service properties) is ignored
  }

  return services;
}

function suggestFromCompose(raw, dir) {
  const dirName = path.basename(dir) || dir;
  return extractComposeServices(raw).map((svc) => ({
    name: `${dirName} – ${svc}`,
    command: `docker compose up ${svc}`,
    cwd: dir,
    pattern: escapeRegex(svc),
  }));
}

// ── Directory walk ───────────────────────────────────────────

function scan(rootDir, { fs = require('fs') } = {}) {
  const suggestions = [];
  const seen = new Set();
  let visitedDirs = 0;

  const add = (suggestion) => {
    if (!suggestion || suggestions.length >= MAX_SUGGESTIONS) return;
    const key = `${suggestion.command}::${suggestion.cwd}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  const readFile = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null; // unreadable — skip silently
    }
  };

  const walk = (dir, depth) => {
    if (suggestions.length >= MAX_SUGGESTIONS) return;
    if (visitedDirs >= MAX_DIRS) return;
    visitedDirs++;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip silently
    }

    const names = new Set(entries.map((e) => e.name));

    if (names.has('package.json')) {
      const raw = readFile(path.join(dir, 'package.json'));
      if (raw !== null) add(suggestFromPackageJson(raw, dir));
    }

    for (const composeName of COMPOSE_FILES) {
      if (!names.has(composeName)) continue;
      const raw = readFile(path.join(dir, composeName));
      if (raw === null) continue;
      for (const suggestion of suggestFromCompose(raw, dir)) {
        add(suggestion);
      }
    }

    if (depth >= MAX_DEPTH) return;

    for (const entry of entries) {
      let isDir;
      try {
        isDir = entry.isDirectory();
      } catch {
        continue;
      }
      if (!isDir || shouldSkipDir(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  walk(rootDir, 0);
  return suggestions;
}

module.exports = { scan, extractComposeServices };
