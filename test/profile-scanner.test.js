const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { scan, extractComposeServices } = require('../main/services/profile-scanner');

// ── Fake fs ──────────────────────────────────────────────────
// Build an injectable fs from a nested object tree: string values are file
// contents, object values are directories. Paths are normalised so the
// scanner's path.join output (\ on Windows, / on POSIX) resolves either way.

const ROOT = path.join('C:', 'projects');

function makeFakeFs(tree) {
  const lookup = (p) => {
    const rel = path.relative(ROOT, p);
    if (rel.startsWith('..')) return undefined;
    let node = tree;
    if (rel === '') return node;
    for (const part of rel.split(/[\\/]+/)) {
      if (node === null || typeof node !== 'object') return undefined;
      node = node[part];
      if (node === undefined) return undefined;
    }
    return node;
  };

  return {
    readdirSync(dir, opts = {}) {
      const node = lookup(dir);
      if (node === null || typeof node !== 'object') {
        throw new Error(`ENOTDIR: ${dir}`);
      }
      assert.ok(opts.withFileTypes, 'scanner should request Dirent entries');
      return Object.keys(node).map((name) => ({
        name,
        isDirectory: () => node[name] !== null && typeof node[name] === 'object',
      }));
    },
    readFileSync(file) {
      const node = lookup(file);
      if (typeof node !== 'string') throw new Error(`ENOENT: ${file}`);
      return node;
    },
  };
}

const pkg = (obj) => JSON.stringify(obj);

// ── package.json suggestions ─────────────────────────────────

test('suggests npm run dev when scripts.dev exists', () => {
  const fs = makeFakeFs({
    api: { 'package.json': pkg({ name: 'my-api', scripts: { dev: 'vite', start: 'node .' } }) },
  });
  const result = scan(ROOT, { fs });
  assert.deepStrictEqual(result, [{
    name: 'my-api (dev)',
    command: 'npm run dev',
    cwd: path.join(ROOT, 'api'),
    pattern: 'node',
  }]);
});

test('falls back to npm start when only scripts.start exists', () => {
  const fs = makeFakeFs({
    web: { 'package.json': pkg({ name: 'web-app', scripts: { start: 'node server.js' } }) },
  });
  const result = scan(ROOT, { fs });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'web-app (start)');
  assert.strictEqual(result[0].command, 'npm start');
});

test('ignores package.json without dev or start scripts', () => {
  const fs = makeFakeFs({
    lib: { 'package.json': pkg({ name: 'lib', scripts: { test: 'node --test' } }) },
    plain: { 'package.json': pkg({ name: 'plain' }) },
  });
  assert.deepStrictEqual(scan(ROOT, { fs }), []);
});

test('uses directory name when package.json has no name', () => {
  const fs = makeFakeFs({
    unnamed: { 'package.json': pkg({ scripts: { dev: 'next dev' } }) },
  });
  assert.strictEqual(scan(ROOT, { fs })[0].name, 'unnamed (dev)');
});

test('tolerates broken JSON and unreadable files', () => {
  const fs = makeFakeFs({
    broken: { 'package.json': '{ not: valid json' },
    ok: { 'package.json': pkg({ name: 'ok', scripts: { dev: 'x' } }) },
  });
  // Unreadable file: readFileSync throws for directories-as-files
  const result = scan(ROOT, { fs });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, 'ok (dev)');
});

test('tolerates an unreadable root directory', () => {
  const fs = {
    readdirSync() { throw new Error('EACCES'); },
    readFileSync() { throw new Error('EACCES'); },
  };
  assert.deepStrictEqual(scan(ROOT, { fs }), []);
});

// ── docker-compose suggestions ───────────────────────────────

test('extracts multiple compose services with comments and deep indentation ignored', () => {
  const compose = [
    'version: "3"',
    '# top comment',
    'services:',
    '  web:',
    '    image: nginx',
    '    ports:',
    '      - "80:80"',
    '',
    '  # a comment inside the block',
    '  db:',
    '    image: postgres',
    '    environment:',
    '      POSTGRES_PASSWORD: x',
    'volumes:',
    '  data:',
  ].join('\n');

  assert.deepStrictEqual(extractComposeServices(compose), ['web', 'db']);

  const fs = makeFakeFs({ stack: { 'docker-compose.yml': compose } });
  const result = scan(ROOT, { fs });
  assert.deepStrictEqual(result.map((s) => s.command), [
    'docker compose up web',
    'docker compose up db',
  ]);
  assert.strictEqual(result[0].name, 'stack – web');
  assert.strictEqual(result[0].pattern, 'web');
  assert.strictEqual(result[0].cwd, path.join(ROOT, 'stack'));
});

test('deeper-nested keys under services are not treated as services', () => {
  const compose = [
    'services:',
    '  app:',
    '    depends_on:',
    '      db:',
    '        condition: service_healthy',
    '   weird:',
    '\tenv:',
  ].join('\n');
  assert.deepStrictEqual(extractComposeServices(compose), ['app']);
});

test('supports compose.yaml and docker-compose.yaml names', () => {
  const fs = makeFakeFs({
    a: { 'compose.yaml': 'services:\n  one:\n    image: x\n' },
    b: { 'docker-compose.yaml': 'services:\n  two:\n    image: x\n' },
  });
  assert.deepStrictEqual(scan(ROOT, { fs }).map((s) => s.pattern).sort(), ['one', 'two']);
});

test('compose file without a services block yields nothing', () => {
  const fs = makeFakeFs({ x: { 'docker-compose.yml': 'volumes:\n  data:\n' } });
  assert.deepStrictEqual(scan(ROOT, { fs }), []);
});

// ── walking rules ────────────────────────────────────────────

test('skips node_modules, dot-directories and junk dirs', () => {
  const devPkg = (name) => ({ 'package.json': pkg({ name, scripts: { dev: 'x' } }) });
  const fs = makeFakeFs({
    node_modules: { dep: devPkg('dep') },
    '.git': devPkg('git-thing'),
    dist: devPkg('dist-thing'),
    build: devPkg('build-thing'),
    real: devPkg('real-app'),
  });
  const result = scan(ROOT, { fs });
  assert.deepStrictEqual(result.map((s) => s.name), ['real-app (dev)']);
});

test('respects the depth limit of 2', () => {
  const fs = makeFakeFs({
    'package.json': pkg({ name: 'root', scripts: { dev: 'x' } }), // depth 0
    d1: {
      'package.json': pkg({ name: 'one', scripts: { dev: 'x' } }), // depth 1
      d2: {
        'package.json': pkg({ name: 'two', scripts: { dev: 'x' } }), // depth 2
        d3: {
          'package.json': pkg({ name: 'three', scripts: { dev: 'x' } }), // depth 3 — too deep
        },
      },
    },
  });
  const names = scan(ROOT, { fs }).map((s) => s.name).sort();
  assert.deepStrictEqual(names, ['one (dev)', 'root (dev)', 'two (dev)']);
});

test('dedupes identical suggestions and caps at 50', () => {
  // Same dir yields both docker-compose.yml and compose.yaml with the same
  // service — deduped by command+cwd.
  const dupFs = makeFakeFs({
    dup: {
      'docker-compose.yml': 'services:\n  api:\n    image: x\n',
      'compose.yaml': 'services:\n  api:\n    image: y\n',
    },
  });
  assert.strictEqual(scan(ROOT, { fs: dupFs }).length, 1);

  // 60 distinct services in one compose file — capped at 50
  const lines = ['services:'];
  for (let i = 0; i < 60; i++) lines.push(`  svc${i}:`, '    image: x');
  const bigFs = makeFakeFs({ big: { 'docker-compose.yml': lines.join('\n') } });
  assert.strictEqual(scan(ROOT, { fs: bigFs }).length, 50);
});

test('bounds the walk with a hard directory budget', () => {
  const tree = {};
  for (let i = 0; i < 2100; i++) tree[`dir${String(i).padStart(4, '0')}`] = {};
  tree['zz-last'] = { 'package.json': pkg({ name: 'late', scripts: { dev: 'x' } }) };
  const base = makeFakeFs(tree);
  let readdirCalls = 0;
  const fs = {
    ...base,
    readdirSync: (...args) => { readdirCalls++; return base.readdirSync(...args); },
  };
  const result = scan(ROOT, { fs });
  assert.ok(readdirCalls <= 2000, `visited ${readdirCalls} dirs, expected <= 2000`);
  assert.deepStrictEqual(result, []); // budget exhausted before the last dir
});

test('escapes regex metacharacters in compose service patterns', () => {
  const fs = makeFakeFs({
    x: { 'docker-compose.yml': 'services:\n  my.svc:\n    image: x\n' },
  });
  const [s] = scan(ROOT, { fs });
  assert.strictEqual(s.pattern, 'my\\.svc');
  assert.doesNotThrow(() => new RegExp(s.pattern, 'i'));
});
