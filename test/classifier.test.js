const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// The classifier pulls in main/services/config.js, which requires Electron's
// `app` at load time. Stub the electron module with a temp userData dir so
// the pure classification logic can be tested under plain Node.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'localhost-dashboard-test-'));
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { app: { getPath: () => userDataDir } };
  }
  return originalLoad.call(this, request, ...rest);
};

// Seed a config with one custom rule to verify rule priority.
fs.writeFileSync(
  path.join(userDataDir, 'config.json'),
  JSON.stringify({ customRules: [{ pattern: '^myapp', group: 'databases' }] }),
  'utf8'
);

const { classify, GROUP_META } = require('../main/services/classifier');

test('classify groups dev tooling by process name', () => {
  assert.strictEqual(classify('node.exe', []), 'dev');
  assert.strictEqual(classify('python3', []), 'dev');
  assert.strictEqual(classify('cargo', []), 'dev');
  assert.strictEqual(classify('deno.exe', []), 'dev');
});

test('classify strips .exe before matching', () => {
  assert.strictEqual(classify('dotnet.exe', []), 'dev');
  assert.strictEqual(classify('mysqld.exe', []), 'databases');
});

test('classify recognises docker, database, and app processes', () => {
  assert.strictEqual(classify('com.docker.backend', []), 'docker');
  assert.strictEqual(classify('containerd', []), 'docker');
  assert.strictEqual(classify('postgres', []), 'databases');
  assert.strictEqual(classify('redis-server', []), 'databases');
  assert.strictEqual(classify('chrome.exe', []), 'apps');
  assert.strictEqual(classify('slack.exe', []), 'apps');
});

test('classify falls back to port-based classification', () => {
  assert.strictEqual(classify('unknown-binary', [5432]), 'databases');
  assert.strictEqual(classify('unknown-binary', [2375]), 'docker');
});

test('classify defaults to system for unmatched processes', () => {
  assert.strictEqual(classify('svchost.exe', []), 'system');
  assert.strictEqual(classify('unknown-binary', [3000]), 'system');
  assert.strictEqual(classify('unknown-binary', undefined), 'system');
});

test('classify gives user-defined custom rules highest priority', () => {
  // "myapp-node" would match the built-in rules as system otherwise;
  // the custom rule maps ^myapp to databases and must win over ports too.
  assert.strictEqual(classify('myapp-server.exe', [3000]), 'databases');
});

test('GROUP_META covers all classification targets', () => {
  for (const group of ['dev', 'docker', 'databases', 'apps', 'system']) {
    assert.ok(GROUP_META[group], `missing meta for ${group}`);
    assert.strictEqual(typeof GROUP_META[group].order, 'number');
  }
});
