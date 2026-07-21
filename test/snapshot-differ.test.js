const { test } = require('node:test');
const assert = require('node:assert');
const { diff } = require('../main/services/snapshot-differ');

/** Build a snapshot with a single "dev" group holding the given processes. */
function snap(processes, extra = {}) {
  return {
    groups: {
      dev: { key: 'dev', icon: '', label: 'Dev', order: 0, processes, totalCpu: 0, totalMemKB: 0 },
    },
    containers: [],
    warnings: [],
    timestamp: Date.now(),
    totalProcesses: processes.length,
    ...extra,
  };
}

function proc(pid, name, cpu = 0, memKB = 0, group = 'dev') {
  return { pid, name, cpu, memKB, group, started: 0, ports: [], portDetails: [], hasWarning: false };
}

test('detects started processes (present only in current)', () => {
  const result = diff(
    snap([proc(1, 'node.exe', 2, 1000)]),
    snap([proc(1, 'node.exe', 2, 1000), proc(2, 'vite.exe', 5, 2048)]),
  );

  assert.deepStrictEqual(result.died, []);
  assert.deepStrictEqual(result.changed, []);
  assert.strictEqual(result.started.length, 1);
  assert.deepStrictEqual(result.started[0], {
    pid: 2, name: 'vite.exe', group: 'dev', cpu: 5, memKB: 2048,
  });
});

test('detects died processes (present only in old)', () => {
  const result = diff(
    snap([proc(1, 'node.exe', 2, 1000), proc(3, 'postgres.exe', 1, 4096)]),
    snap([proc(1, 'node.exe', 2, 1000)]),
  );

  assert.deepStrictEqual(result.started, []);
  assert.deepStrictEqual(result.changed, []);
  assert.strictEqual(result.died.length, 1);
  assert.deepStrictEqual(result.died[0], {
    pid: 3, name: 'postgres.exe', group: 'dev', cpu: 1, memKB: 4096,
  });
});

test('detects changed survivors with meaningful deltas', () => {
  const result = diff(
    snap([proc(1, 'node.exe', 2, 100000)]),
    snap([proc(1, 'node.exe', 50, 300000)]),
  );

  assert.deepStrictEqual(result.started, []);
  assert.deepStrictEqual(result.died, []);
  assert.deepStrictEqual(result.changed, [
    { pid: 1, name: 'node.exe', cpuDelta: 48, memDeltaKB: 200000 },
  ]);
});

test('reports negative deltas too', () => {
  const result = diff(
    snap([proc(1, 'node.exe', 50, 300000)]),
    snap([proc(1, 'node.exe', 2, 100000)]),
  );

  assert.deepStrictEqual(result.changed, [
    { pid: 1, name: 'node.exe', cpuDelta: -48, memDeltaKB: -200000 },
  ]);
});

test('ignores survivors below both thresholds', () => {
  // |cpuDelta| < 1 and |memDeltaKB| < 10240 → not "changed"
  const result = diff(
    snap([proc(1, 'node.exe', 5, 100000)]),
    snap([proc(1, 'node.exe', 5.5, 105000)]),
  );

  assert.deepStrictEqual(result.changed, []);
  assert.deepStrictEqual(result.started, []);
  assert.deepStrictEqual(result.died, []);
});

test('either threshold alone is enough to count as changed', () => {
  // Only CPU crosses
  const cpuOnly = diff(
    snap([proc(1, 'node.exe', 5, 1000)]),
    snap([proc(1, 'node.exe', 6, 1000)]),
  );
  assert.strictEqual(cpuOnly.changed.length, 1);

  // Only memory crosses (10240 KB = 10 MB)
  const memOnly = diff(
    snap([proc(1, 'node.exe', 5, 1000)]),
    snap([proc(1, 'node.exe', 5, 1000 + 10240)]),
  );
  assert.strictEqual(memOnly.changed.length, 1);
});

test('pid reuse: same pid with a different name is died + started, not changed', () => {
  const result = diff(
    snap([proc(42, 'node.exe', 10, 50000)]),
    snap([proc(42, 'python.exe', 90, 900000)]),
  );

  assert.deepStrictEqual(result.changed, []);
  assert.strictEqual(result.died.length, 1);
  assert.strictEqual(result.died[0].name, 'node.exe');
  assert.strictEqual(result.started.length, 1);
  assert.strictEqual(result.started[0].name, 'python.exe');
  assert.strictEqual(result.started[0].pid, 42);
});

test('flattens processes across multiple groups', () => {
  const old = {
    groups: {
      dev: { processes: [proc(1, 'node.exe')] },
      databases: { processes: [{ pid: 2, name: 'postgres.exe', cpu: 1, memKB: 100 }] },
    },
  };
  const cur = { groups: { dev: { processes: [proc(1, 'node.exe')] } } };

  const result = diff(old, cur);
  assert.strictEqual(result.died.length, 1);
  assert.strictEqual(result.died[0].pid, 2);
  // Group falls back to the containing group key when proc.group is missing
  assert.strictEqual(result.died[0].group, 'databases');
});

test('returns null for totally invalid snapshots', () => {
  const valid = snap([]);
  assert.strictEqual(diff(null, valid), null);
  assert.strictEqual(diff(valid, null), null);
  assert.strictEqual(diff(undefined, valid), null);
  assert.strictEqual(diff('not a snapshot', valid), null);
  assert.strictEqual(diff(42, valid), null);
  assert.strictEqual(diff([], valid), null);
  assert.strictEqual(diff(valid, 'nope'), null);
});

test('treats missing or malformed groups as empty', () => {
  const cur = snap([proc(1, 'node.exe', 5, 2048)]);

  // No groups key at all → everything in current counts as started
  const noGroups = diff({ timestamp: 1 }, cur);
  assert.strictEqual(noGroups.started.length, 1);
  assert.deepStrictEqual(noGroups.died, []);

  // groups is the wrong type → same
  assert.strictEqual(diff({ groups: 'bad' }, cur).started.length, 1);
  assert.strictEqual(diff({ groups: [1, 2] }, cur).started.length, 1);

  // Malformed group entries and process entries are skipped
  const messy = {
    groups: {
      dev: { processes: [null, 'junk', { name: 'no-pid.exe' }, { pid: 'NaN-pid' }, proc(1, 'node.exe', 5, 2048)] },
      broken: null,
      alsoBroken: { processes: 'not-an-array' },
    },
  };
  const result = diff(messy, cur);
  assert.deepStrictEqual(result.started, []);
  assert.deepStrictEqual(result.died, []);
  assert.deepStrictEqual(result.changed, []);
});

test('missing cpu/mem fields default to 0 rather than producing NaN', () => {
  const result = diff(
    { groups: { dev: { processes: [{ pid: 1, name: 'node.exe' }] } } },
    snap([proc(1, 'node.exe', 3, 20480)]),
  );

  assert.deepStrictEqual(result.changed, [
    { pid: 1, name: 'node.exe', cpuDelta: 3, memDeltaKB: 20480 },
  ]);
});

test('empty diff for identical snapshots', () => {
  const s = snap([proc(1, 'node.exe', 5, 1000), proc(2, 'vite.exe', 1, 500)]);
  const result = diff(s, snap([proc(1, 'node.exe', 5, 1000), proc(2, 'vite.exe', 1, 500)]));
  assert.deepStrictEqual(result, { started: [], died: [], changed: [] });
});
