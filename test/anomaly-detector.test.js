const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { detect, detectThresholds, detectDuplicates, detectOrphans } = require('../main/services/anomaly-detector');

// detectThresholds keeps per-PID state between calls; passing zeroed
// thresholds clears it so each test starts fresh.
beforeEach(() => {
  detectThresholds([], { cpuThreshold: 0, memThresholdMB: 0, sustainPolls: 1 });
});

test('detect warns when an unexpected process holds a well-known port', () => {
  const warnings = detect([
    { pid: 1234, name: 'node.exe', ports: [5432] },
  ]);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].pid, 1234);
  assert.strictEqual(warnings[0].port, 5432);
  assert.match(warnings[0].message, /Port 5432 is used by node\.exe/);
});

test('detect stays quiet for expected processes and unmapped ports', () => {
  const warnings = detect([
    { pid: 1, name: 'postgres', ports: [5432] },
    { pid: 2, name: 'redis-server', ports: [6379] },
    { pid: 3, name: 'node.exe', ports: [3000] },
    { pid: 4, name: 'node.exe', ports: [] },
    { pid: 5, name: 'node.exe' },
  ]);
  assert.deepStrictEqual(warnings, []);
});

test('detectThresholds fires only after the sustain count is reached', () => {
  const procs = [{ pid: 10, name: 'node.exe', cpu: 90, memKB: 1024 }];
  const opts = { cpuThreshold: 80, memThresholdMB: 0, sustainPolls: 3 };

  assert.strictEqual(detectThresholds(procs, opts).length, 0); // poll 1
  assert.strictEqual(detectThresholds(procs, opts).length, 0); // poll 2

  const warnings = detectThresholds(procs, opts); // poll 3
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].key, 'cpu:10');
  assert.match(warnings[0].message, /High CPU: node\.exe/);

  // Fires exactly once, not on every subsequent poll
  assert.strictEqual(detectThresholds(procs, opts).length, 0); // poll 4
});

test('detectThresholds resets the counter when usage drops below threshold', () => {
  const hot = [{ pid: 11, name: 'node.exe', cpu: 95, memKB: 0 }];
  const cool = [{ pid: 11, name: 'node.exe', cpu: 5, memKB: 0 }];
  const opts = { cpuThreshold: 80, memThresholdMB: 0, sustainPolls: 2 };

  detectThresholds(hot, opts);                                  // 1 hit
  detectThresholds(cool, opts);                                 // reset
  assert.strictEqual(detectThresholds(hot, opts).length, 0);    // 1 hit again
  assert.strictEqual(detectThresholds(hot, opts).length, 1);    // fires at 2
});

test('detectThresholds warns on sustained memory usage', () => {
  const procs = [{ pid: 12, name: 'java.exe', cpu: 0, memKB: 2048 * 1024 }];
  const opts = { cpuThreshold: 0, memThresholdMB: 1024, sustainPolls: 2 };

  assert.strictEqual(detectThresholds(procs, opts).length, 0);
  const warnings = detectThresholds(procs, opts);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].key, 'mem:12');
  assert.match(warnings[0].message, /High memory: java\.exe .* 2048 MB/);
});

test('detectThresholds returns nothing when thresholds are disabled', () => {
  const procs = [{ pid: 13, name: 'node.exe', cpu: 100, memKB: 10_000_000 }];
  assert.deepStrictEqual(
    detectThresholds(procs, { cpuThreshold: 0, memThresholdMB: 0, sustainPolls: 1 }),
    []
  );
});

test('detectDuplicates warns when dev processes exceed the threshold', () => {
  const procs = [];
  for (let i = 1; i <= 8; i++) {
    procs.push({ pid: 100 + i, name: 'node.exe', group: 'dev' });
  }
  const warnings = detectDuplicates(procs, { duplicateThreshold: 8 });
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].count, 8);
  assert.strictEqual(warnings[0].key, 'dup:node.exe');
  assert.strictEqual(warnings[0].pids.length, 8);
});

test('detectDuplicates ignores non-dev groups and counts below threshold', () => {
  const procs = [];
  for (let i = 1; i <= 10; i++) {
    procs.push({ pid: 200 + i, name: 'chrome.exe', group: 'apps' });
  }
  for (let i = 1; i <= 3; i++) {
    procs.push({ pid: 300 + i, name: 'node.exe', group: 'dev' });
  }
  assert.deepStrictEqual(detectDuplicates(procs, { duplicateThreshold: 4 }), []);
});

test('detectDuplicates is disabled for thresholds below 2', () => {
  const procs = [
    { pid: 1, name: 'node.exe', group: 'dev' },
    { pid: 2, name: 'node.exe', group: 'dev' },
  ];
  assert.deepStrictEqual(detectDuplicates(procs, { duplicateThreshold: 0 }), []);
  assert.deepStrictEqual(detectDuplicates(procs, { duplicateThreshold: 1 }), []);
});

test('detectOrphans (win32) flags dev processes whose parent pid is gone', () => {
  const procs = [
    { pid: 4, name: 'System', ppid: 0, group: 'system' },
    { pid: 100, name: 'node.exe', ppid: 4, group: 'dev' },
    { pid: 200, name: 'vite.exe', ppid: 9999, group: 'dev' }, // parent gone
  ];
  const warnings = detectOrphans(procs, 'win32');
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].pid, 200);
  assert.strictEqual(warnings[0].key, 'orphan:200');
  assert.strictEqual(warnings[0].processName, 'vite.exe');
  assert.match(warnings[0].message, /orphaned/i);
  assert.match(warnings[0].message, /9999/);
});

test('detectOrphans (linux) flags dev processes reparented to init', () => {
  // Unix reparents orphans to pid 1 immediately, so a missing ppid is never
  // observable — adoption by init is the orphan signal instead.
  const procs = [
    { pid: 1, name: 'systemd', ppid: 0, group: 'system' },
    { pid: 100, name: 'bash', ppid: 1, group: 'system' },
    { pid: 200, name: 'node', ppid: 100, group: 'dev' }, // parent alive
    { pid: 300, name: 'vite', ppid: 1, group: 'dev' },   // adopted by init
  ];
  const warnings = detectOrphans(procs, 'linux');
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].pid, 300);
  assert.strictEqual(warnings[0].key, 'orphan:300');
  assert.match(warnings[0].message, /orphaned/i);
});

test('detectOrphans ignores non-dev groups on both platforms', () => {
  const procs = [
    { pid: 1, name: 'systemd', ppid: 0, group: 'system' },
    { pid: 300, name: 'svchost.exe', ppid: 9999, group: 'system' },
    { pid: 301, name: 'chrome.exe', ppid: 1, group: 'apps' },
  ];
  assert.deepStrictEqual(detectOrphans(procs, 'win32'), []);
  assert.deepStrictEqual(detectOrphans(procs, 'linux'), []);
});

test('detectOrphans treats missing or zero ppid as unknown, not orphaned', () => {
  const procs = [
    { pid: 400, name: 'node.exe', ppid: 0, group: 'dev' },
    { pid: 401, name: 'node.exe', group: 'dev' },
  ];
  assert.deepStrictEqual(detectOrphans(procs, 'win32'), []);
  assert.deepStrictEqual(detectOrphans(procs, 'linux'), []);
});

test('detectOrphans stays quiet when the parent chain is present', () => {
  const procs = [
    { pid: 500, name: 'npm.exe', ppid: 0, group: 'dev' },
    { pid: 501, name: 'node.exe', ppid: 500, group: 'dev' },
    { pid: 502, name: 'esbuild.exe', ppid: 501, group: 'dev' },
  ];
  assert.deepStrictEqual(detectOrphans(procs, 'win32'), []);
  assert.deepStrictEqual(detectOrphans(procs, 'linux'), []);
});

test('detectOrphans returns empty for an empty process list', () => {
  assert.deepStrictEqual(detectOrphans([], 'win32'), []);
  assert.deepStrictEqual(detectOrphans([], 'linux'), []);
});
