const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { update, reset } = require('../main/services/cpu-accumulator');

// The accumulator keeps per-PID state between calls; reset before each
// test so accumulation from one test never leaks into the next.
beforeEach(() => {
  reset();
});

test('first sighting records a baseline of 0 CPU-seconds', () => {
  const procs = [{ pid: 1, name: 'node.exe', cpu: 50 }];
  update(procs, 1000);
  assert.strictEqual(procs[0].cpuTimeSec, 0);
});

test('accumulates cpu% integrated over elapsed time across polls', () => {
  let procs = [{ pid: 1, name: 'node.exe', cpu: 50 }];
  update(procs, 0);

  // 10 s at 50% => 5 CPU-seconds
  procs = [{ pid: 1, name: 'node.exe', cpu: 50 }];
  update(procs, 10_000);
  assert.strictEqual(procs[0].cpuTimeSec, 5);

  // + 20 s at 100% => 5 + 20 = 25 CPU-seconds
  procs = [{ pid: 1, name: 'node.exe', cpu: 100 }];
  update(procs, 30_000);
  assert.strictEqual(procs[0].cpuTimeSec, 25);

  // + 10 s at 0% => unchanged
  procs = [{ pid: 1, name: 'node.exe', cpu: 0 }];
  update(procs, 40_000);
  assert.strictEqual(procs[0].cpuTimeSec, 25);
});

test('tracks multiple pids independently', () => {
  update([
    { pid: 1, name: 'a', cpu: 100 },
    { pid: 2, name: 'b', cpu: 10 },
  ], 0);

  const procs = [
    { pid: 1, name: 'a', cpu: 100 },
    { pid: 2, name: 'b', cpu: 10 },
  ];
  update(procs, 10_000);
  assert.strictEqual(procs[0].cpuTimeSec, 10);
  assert.strictEqual(procs[1].cpuTimeSec, 1);
});

test('prunes state for dead pids so a reused pid starts fresh', () => {
  update([{ pid: 1, name: 'a', cpu: 100 }], 0);
  update([{ pid: 1, name: 'a', cpu: 100 }], 10_000); // 10 CPU-seconds banked

  // pid 1 disappears for a poll -> its entry is pruned
  update([{ pid: 2, name: 'b', cpu: 0 }], 20_000);

  // pid 1 reappears: treated as a first sighting, no stale accumulation
  const procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 30_000);
  assert.strictEqual(procs[0].cpuTimeSec, 0);
});

test('no NaN when cpu is 0, undefined, or non-finite', () => {
  update([
    { pid: 1, name: 'a', cpu: 0 },
    { pid: 2, name: 'b' },
    { pid: 3, name: 'c', cpu: NaN },
  ], 0);

  const procs = [
    { pid: 1, name: 'a', cpu: 0 },
    { pid: 2, name: 'b' },
    { pid: 3, name: 'c', cpu: NaN },
  ];
  update(procs, 10_000);

  for (const proc of procs) {
    assert.ok(Number.isFinite(proc.cpuTimeSec), `pid ${proc.pid} produced ${proc.cpuTimeSec}`);
    assert.strictEqual(proc.cpuTimeSec, 0);
  }
});

test('a poll with identical timestamp does not change the total', () => {
  update([{ pid: 1, name: 'a', cpu: 50 }], 0);
  update([{ pid: 1, name: 'a', cpu: 50 }], 10_000);

  const procs = [{ pid: 1, name: 'a', cpu: 50 }];
  update(procs, 10_000); // zero elapsed time
  assert.strictEqual(procs[0].cpuTimeSec, 5);
});

test('a recycled pid (changed start time) is treated as a new process', () => {
  update([{ pid: 1, name: 'a', cpu: 100, started: 111 }], 0);
  update([{ pid: 1, name: 'a', cpu: 100, started: 111 }], 10_000); // 10 CPU-seconds banked

  // Same pid reappears within one poll gap but with a new start time:
  // the OS reused the pid, so the banked total must not carry over.
  const procs = [{ pid: 1, name: 'b', cpu: 0, started: 222 }];
  update(procs, 20_000);
  assert.strictEqual(procs[0].cpuTimeSec, 0);
});

test('implausibly long gaps (sleep/clock jump) are not integrated', () => {
  update([{ pid: 1, name: 'a', cpu: 100 }], 0);
  update([{ pid: 1, name: 'a', cpu: 100 }], 10_000); // 10 CPU-seconds banked

  // 8 hours pass (laptop asleep): the gap is skipped, not billed.
  let procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 10_000 + 8 * 3600 * 1000);
  assert.strictEqual(procs[0].cpuTimeSec, 10);

  // Accumulation resumes from the re-baselined timestamp.
  procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 10_000 + 8 * 3600 * 1000 + 5000);
  assert.strictEqual(procs[0].cpuTimeSec, 15);
});

test('a backwards clock step never subtracts or inflates the total', () => {
  update([{ pid: 1, name: 'a', cpu: 100 }], 60_000);
  update([{ pid: 1, name: 'a', cpu: 100 }], 70_000); // 10 CPU-seconds banked

  // Clock steps back 60 s: negative interval is skipped.
  let procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 10_000);
  assert.strictEqual(procs[0].cpuTimeSec, 10);

  // Next poll measures from the re-baselined (stepped-back) timestamp.
  procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 15_000);
  assert.strictEqual(procs[0].cpuTimeSec, 15);
});

test('reset clears all accumulated state', () => {
  update([{ pid: 1, name: 'a', cpu: 100 }], 0);
  update([{ pid: 1, name: 'a', cpu: 100 }], 10_000);
  reset();

  const procs = [{ pid: 1, name: 'a', cpu: 100 }];
  update(procs, 20_000);
  assert.strictEqual(procs[0].cpuTimeSec, 0);
});
