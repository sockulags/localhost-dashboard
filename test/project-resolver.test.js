const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  resolve,
  flushPending,
  findProjectName,
  parseLsofCwd,
  parseCimProcesses,
  parseCommandLineDir,
  dirFromWinProcessInfo,
  cache,
} = require('../main/services/project-resolver');

// ── Fake fs helper ─────────────────────────────────────────────
// Maps normalized (forward-slash) absolute paths to file contents.
// Separators are normalized so tests pass regardless of host platform
// (path.join produces backslashes on Windows).
function makeFakeFs(files) {
  const normalize = (p) => String(p).replace(/\\/g, '/');
  const store = new Map(Object.entries(files).map(([k, v]) => [normalize(k), v]));
  return {
    existsSync: (p) => store.has(normalize(p)),
    readFileSync: (p) => {
      const key = normalize(p);
      if (!store.has(key)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return store.get(key);
    },
  };
}

beforeEach(() => {
  cache.clear();
});

// ── findProjectName ────────────────────────────────────────────

test('findProjectName finds package.json name in the start directory', () => {
  const fs = makeFakeFs({
    '/home/lucas/code/my-shop/package.json': JSON.stringify({ name: 'my-shop' }),
  });
  assert.strictEqual(findProjectName('/home/lucas/code/my-shop', { fs }), 'my-shop');
});

test('findProjectName walks up to a parent package.json', () => {
  const fs = makeFakeFs({
    '/home/lucas/code/my-shop/package.json': JSON.stringify({ name: 'my-shop' }),
  });
  assert.strictEqual(
    findProjectName('/home/lucas/code/my-shop/src/server', { fs }),
    'my-shop'
  );
});

test('findProjectName falls back to compose file directory name', () => {
  const fs = makeFakeFs({
    '/srv/apps/blog-stack/docker-compose.yml': 'services: {}',
  });
  assert.strictEqual(findProjectName('/srv/apps/blog-stack/api', { fs }), 'blog-stack');
});

test('findProjectName supports compose.yaml variant', () => {
  const fs = makeFakeFs({
    '/srv/apps/blog-stack/compose.yaml': 'services: {}',
  });
  assert.strictEqual(findProjectName('/srv/apps/blog-stack', { fs }), 'blog-stack');
});

test('findProjectName prefers package.json name over compose in same dir', () => {
  const fs = makeFakeFs({
    '/x/app/package.json': JSON.stringify({ name: 'pkg-name' }),
    '/x/app/docker-compose.yml': 'services: {}',
  });
  assert.strictEqual(findProjectName('/x/app', { fs }), 'pkg-name');
});

test('findProjectName returns null when nothing found up to the root', () => {
  const fs = makeFakeFs({});
  assert.strictEqual(findProjectName('/a/b/c', { fs }), null);
});

test('findProjectName stops after ~6 levels', () => {
  // Marker is 7 directories above the start dir — beyond the walk limit.
  const fs = makeFakeFs({
    '/package.json': JSON.stringify({ name: 'too-far' }),
  });
  assert.strictEqual(findProjectName('/a/b/c/d/e/f/g', { fs }), null);
});

test('findProjectName handles broken package.json by continuing the walk', () => {
  const fs = makeFakeFs({
    '/home/app/sub/package.json': '{ not valid json !!',
    '/home/app/package.json': JSON.stringify({ name: 'real-app' }),
  });
  assert.strictEqual(findProjectName('/home/app/sub', { fs }), 'real-app');
});

test('findProjectName ignores package.json without a name field', () => {
  const fs = makeFakeFs({
    '/home/app/sub/package.json': JSON.stringify({ private: true }),
    '/home/app/docker-compose.yml': 'services: {}',
  });
  assert.strictEqual(findProjectName('/home/app/sub', { fs }), 'app');
});

test('findProjectName skips package.json inside node_modules and keeps walking', () => {
  const fs = makeFakeFs({
    '/home/app/node_modules/some-tool/package.json': JSON.stringify({ name: 'some-tool' }),
    '/home/app/package.json': JSON.stringify({ name: 'real-app' }),
  });
  assert.strictEqual(
    findProjectName('/home/app/node_modules/some-tool', { fs }),
    'real-app'
  );
});

test('findProjectName handles missing/invalid start dir', () => {
  const fs = makeFakeFs({});
  assert.strictEqual(findProjectName(null, { fs }), null);
  assert.strictEqual(findProjectName('', { fs }), null);
  assert.strictEqual(findProjectName(undefined, { fs }), null);
});

// ── parseLsofCwd (batched) ─────────────────────────────────────

test('parseLsofCwd maps pids to their n-prefixed cwd lines', () => {
  const output = [
    'p1234',
    'fcwd',
    'n/home/lucas/code/my-shop',
    'p5678',
    'fcwd',
    'n/srv/apps/blog',
  ].join('\n');
  const map = parseLsofCwd(output);
  assert.strictEqual(map.get(1234), '/home/lucas/code/my-shop');
  assert.strictEqual(map.get(5678), '/srv/apps/blog');
  assert.strictEqual(map.size, 2);
});

test('parseLsofCwd handles CRLF, missing n lines, and empty input', () => {
  const crlf = parseLsofCwd('p1234\r\nfcwd\r\nn/srv/app\r\n');
  assert.strictEqual(crlf.get(1234), '/srv/app');

  assert.strictEqual(parseLsofCwd('p1234\nfcwd\n').size, 0);
  assert.strictEqual(parseLsofCwd('').size, 0);
  assert.strictEqual(parseLsofCwd(null).size, 0);
});

// ── parseCimProcesses (win32 batched JSON) ─────────────────────

test('parseCimProcesses parses an array of process records', () => {
  const output = JSON.stringify([
    { ProcessId: 100, CommandLine: 'node C:\\proj\\server.js', ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe' },
    { ProcessId: 200, CommandLine: null, ExecutablePath: 'C:\\tools\\app\\app.exe' },
  ]);
  const map = parseCimProcesses(output);
  assert.strictEqual(map.get(100).commandLine, 'node C:\\proj\\server.js');
  assert.strictEqual(map.get(200).commandLine, null);
  assert.strictEqual(map.get(200).executablePath, 'C:\\tools\\app\\app.exe');
});

test('parseCimProcesses handles a bare single object and garbage input', () => {
  const single = parseCimProcesses(JSON.stringify(
    { ProcessId: 42, CommandLine: 'x', ExecutablePath: null }
  ));
  assert.strictEqual(single.get(42).commandLine, 'x');

  assert.strictEqual(parseCimProcesses('not json').size, 0);
  assert.strictEqual(parseCimProcesses('').size, 0);
  assert.strictEqual(parseCimProcesses(null).size, 0);
});

// ── parseCommandLineDir (win32 best-effort) ────────────────────

test('parseCommandLineDir prefers the script path over the exe path', () => {
  const dir = parseCommandLineDir(
    '"C:\\Program Files\\nodejs\\node.exe" C:\\code\\my-shop\\server.js --port 3000'
  );
  assert.strictEqual(dir, 'C:\\code\\my-shop');
});

test('parseCommandLineDir picks the LAST script-looking argument', () => {
  const dir = parseCommandLineDir(
    '"C:\\Program Files\\nodejs\\node.exe" --require C:\\hooks\\preload.js C:\\proj\\server.js'
  );
  assert.strictEqual(dir, 'C:\\proj');
});

test('parseCommandLineDir handles quoted script paths with spaces', () => {
  const dir = parseCommandLineDir(
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\My Projects\\shop\\index.js"'
  );
  assert.strictEqual(dir, 'C:\\My Projects\\shop');
});

test('parseCommandLineDir falls back to the exe directory', () => {
  const dir = parseCommandLineDir('"C:\\tools\\my-app\\my-app.exe" --serve');
  assert.strictEqual(dir, 'C:\\tools\\my-app');
});

test('parseCommandLineDir never returns system install directories', () => {
  assert.strictEqual(
    parseCommandLineDir('"C:\\Program Files\\nodejs\\node.exe" --inspect'),
    null
  );
  assert.strictEqual(
    parseCommandLineDir('C:\\Windows\\System32\\svchost.exe -k netsvcs'),
    null
  );
  assert.strictEqual(
    parseCommandLineDir('"C:\\Program Files (x86)\\Tool\\tool.exe" run "C:\\Program Files (x86)\\Tool\\lib\\main.js"'),
    null
  );
});

test('parseCommandLineDir returns null for bare commands and empty input', () => {
  assert.strictEqual(parseCommandLineDir('node'), null);
  assert.strictEqual(parseCommandLineDir(''), null);
  assert.strictEqual(parseCommandLineDir(null), null);
});

test('dirFromWinProcessInfo falls back to executablePath when CommandLine is null', () => {
  assert.strictEqual(
    dirFromWinProcessInfo({ commandLine: null, executablePath: 'C:\\tools\\my app\\app.exe' }),
    'C:\\tools\\my app'
  );
  // Exe under Program Files never identifies a project.
  assert.strictEqual(
    dirFromWinProcessInfo({ commandLine: null, executablePath: 'C:\\Program Files\\nodejs\\node.exe' }),
    null
  );
  assert.strictEqual(dirFromWinProcessInfo(null), null);
});

// ── resolve: cache and prune behavior ──────────────────────────

function makeProc(pid, ports = [3000]) {
  return {
    pid,
    name: 'node.exe',
    ports,
    portDetails: ports.map((port) => ({
      protocol: 'TCP', localAddress: '0.0.0.0', port, state: 'LISTENING', pid,
    })),
  };
}

function key(pid) {
  return `${pid}:node.exe`;
}

const fakeProjectFs = makeFakeFs({
  [path.join('/proj/my-shop', 'package.json')]: JSON.stringify({ name: 'my-shop' }),
});

function makeGetDirs(dirByPid, counter) {
  return async (pids) => {
    counter.calls++;
    counter.pids = pids;
    const map = new Map();
    for (const pid of pids) {
      if (dirByPid[pid]) map.set(pid, dirByPid[pid]);
    }
    return map;
  };
}

test('resolve fills the cache in the background and applies names on the next poll', async () => {
  const counter = { calls: 0 };
  const getDirsForPids = makeGetDirs({ 100: '/proj/my-shop' }, counter);
  const opts = { getDirsForPids, fs: fakeProjectFs };

  const first = [makeProc(100), { pid: 200, name: 'idle.exe', ports: [], portDetails: [] }];
  await resolve(first, opts);
  // Non-blocking: resolve() returns before the lookup completes.
  await flushPending();
  assert.strictEqual(cache.get(key(100)), 'my-shop');
  // Only the listening-port pid was looked up.
  assert.deepStrictEqual(counter.pids, [100]);

  const second = [makeProc(100)];
  await resolve(second, opts);
  assert.strictEqual(second[0].projectName, 'my-shop');
});

test('resolve looks a pid up at most once (cache hit, single batch call)', async () => {
  const counter = { calls: 0 };
  const opts = { getDirsForPids: makeGetDirs({ 100: '/proj/my-shop' }, counter), fs: fakeProjectFs };

  await resolve([makeProc(100)], opts);
  await flushPending();
  await resolve([makeProc(100)], opts);
  await resolve([makeProc(100)], opts);
  await flushPending();

  assert.strictEqual(counter.calls, 1);
});

test('resolve does not schedule duplicate lookups while one is in flight', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const getDirsForPids = async () => {
    calls++;
    await gate;
    return new Map([[100, '/proj/my-shop']]);
  };
  const opts = { getDirsForPids, fs: fakeProjectFs };

  await resolve([makeProc(100)], opts); // schedules lookup
  await resolve([makeProc(100)], opts); // still in flight — no second spawn
  release();
  await flushPending();

  assert.strictEqual(calls, 1);
  assert.strictEqual(cache.get(key(100)), 'my-shop');
});

test('resolve caches negative results (no re-lookup for unresolvable pids)', async () => {
  const counter = { calls: 0 };
  const opts = { getDirsForPids: makeGetDirs({}, counter), fs: fakeProjectFs };

  await resolve([makeProc(100)], opts);
  await flushPending();
  const second = [makeProc(100)];
  await resolve(second, opts);
  await flushPending();

  assert.strictEqual(counter.calls, 1);
  assert.strictEqual(cache.get(key(100)), null);
  assert.strictEqual(second[0].projectName, undefined);
});

test('resolve prunes cache entries for dead pids', async () => {
  const counter = { calls: 0 };
  const opts = {
    getDirsForPids: makeGetDirs({ 100: '/proj/my-shop', 101: '/proj/my-shop' }, counter),
    fs: fakeProjectFs,
  };

  await resolve([makeProc(100), makeProc(101)], opts);
  await flushPending();
  assert.strictEqual(cache.size, 2);

  // pid 101 disappeared from the process list.
  await resolve([makeProc(100)], opts);
  assert.strictEqual(cache.has(key(100)), true);
  assert.strictEqual(cache.has(key(101)), false);
});

test('resolve never throws when the batched lookup fails, and retries later', async () => {
  let calls = 0;
  const failing = async () => { calls++; throw new Error('boom'); };
  const procs = [makeProc(100)];

  await assert.doesNotReject(resolve(procs, { getDirsForPids: failing, fs: fakeProjectFs }));
  await flushPending();
  assert.strictEqual(procs[0].projectName, undefined);
  // A failed batch leaves the pid uncached so a later poll retries it.
  await resolve([makeProc(100)], { getDirsForPids: failing, fs: fakeProjectFs });
  await flushPending();
  assert.strictEqual(calls, 2);
});

test('resolve skips processes with only non-listening connections', async () => {
  const counter = { calls: 0 };
  const opts = { getDirsForPids: makeGetDirs({ 300: '/proj/my-shop' }, counter), fs: fakeProjectFs };
  const proc = {
    pid: 300,
    name: 'chrome.exe',
    ports: [54321],
    portDetails: [{ protocol: 'TCP', localAddress: '192.168.1.2', port: 54321, state: 'ESTABLISHED', pid: 300 }],
  };

  await resolve([proc], opts);
  await flushPending();

  assert.strictEqual(counter.calls, 0);
  assert.strictEqual(proc.projectName, undefined);
});
