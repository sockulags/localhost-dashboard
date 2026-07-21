const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { evaluate, reset } = require('../main/services/rule-engine');

// The engine keeps per-(rule, pid) sustain counters between calls;
// reset() clears them so each test starts fresh.
beforeEach(() => {
  reset();
});

const noDeps = { kill: () => {}, launchCommand: () => {} };

function cpuRule(overrides = {}) {
  return {
    id: 'r1',
    pattern: 'node',
    metric: 'cpu',
    threshold: 80,
    sustainPolls: 3,
    action: 'notify',
    ...overrides,
  };
}

test('notify rule fires once after sustainPolls consecutive breaches', () => {
  const rules = [cpuRule()];
  const hot = [{ pid: 10, name: 'node.exe', cpu: 90, memKB: 1024 }];

  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0); // poll 1
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0); // poll 2

  const warnings = evaluate(hot, rules, noDeps); // poll 3
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].pid, 10);
  assert.strictEqual(warnings[0].processName, 'node.exe');
  assert.strictEqual(warnings[0].key, 'rule:r1:10');
  assert.match(warnings[0].message, /node\.exe \(PID 10\)/);

  // Fires exactly once, not on every subsequent poll
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0); // poll 4
});

test('a dip below the threshold resets the sustain counter', () => {
  const rules = [cpuRule({ sustainPolls: 2 })];
  const hot = [{ pid: 11, name: 'node.exe', cpu: 95, memKB: 0 }];
  const cool = [{ pid: 11, name: 'node.exe', cpu: 5, memKB: 0 }];

  evaluate(hot, rules, noDeps);                                  // 1 hit
  evaluate(cool, rules, noDeps);                                 // reset
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0);    // 1 hit again
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 1);    // fires at 2
});

test('mem rules compare memKB/1024 against the MB threshold', () => {
  const rules = [cpuRule({ id: 'm1', pattern: 'java', metric: 'mem', threshold: 1024, sustainPolls: 2 })];
  const procs = [{ pid: 12, name: 'java.exe', cpu: 0, memKB: 2048 * 1024 }];

  assert.strictEqual(evaluate(procs, rules, noDeps).length, 0);
  const warnings = evaluate(procs, rules, noDeps);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].key, 'rule:m1:12');
  assert.match(warnings[0].message, /2048 MB/);

  // Below the threshold (512 MB) nothing accumulates
  reset();
  const small = [{ pid: 12, name: 'java.exe', cpu: 0, memKB: 512 * 1024 }];
  assert.strictEqual(evaluate(small, rules, noDeps).length, 0);
  assert.strictEqual(evaluate(small, rules, noDeps).length, 0);
});

test('kill action calls the injected deps.kill and returns a warning', () => {
  const killed = [];
  const deps = { kill: (pid) => killed.push(pid), launchCommand: () => {} };
  const rules = [cpuRule({ action: 'kill', sustainPolls: 2 })];
  const hot = [{ pid: 20, name: 'node.exe', cpu: 99, memKB: 0 }];

  evaluate(hot, rules, deps);
  assert.deepStrictEqual(killed, []); // not before the sustain count

  const warnings = evaluate(hot, rules, deps);
  assert.deepStrictEqual(killed, [20]);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].message, /killed node\.exe \(PID 20\)/);

  // Does not keep killing on subsequent polls
  evaluate(hot, rules, deps);
  assert.deepStrictEqual(killed, [20]);
});

test('command action calls the injected launchCommand with command and cwd', () => {
  const launched = [];
  const deps = { kill: () => {}, launchCommand: (cmd, cwd) => launched.push({ cmd, cwd }) };
  const rules = [cpuRule({
    action: 'command',
    command: 'npm run cleanup',
    cwd: 'C:\\work',
    sustainPolls: 1,
  })];
  const hot = [{ pid: 30, name: 'node.exe', cpu: 91, memKB: 0 }];

  const warnings = evaluate(hot, rules, deps);
  assert.deepStrictEqual(launched, [{ cmd: 'npm run cleanup', cwd: 'C:\\work' }]);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].message, /ran "npm run cleanup"/);
});

test('rules with invalid regex patterns are skipped', () => {
  const rules = [
    cpuRule({ id: 'bad', pattern: '[unclosed', sustainPolls: 1 }),
    cpuRule({ id: 'good', pattern: 'node', sustainPolls: 1 }),
  ];
  const hot = [{ pid: 40, name: 'node.exe', cpu: 100, memKB: 0 }];

  const warnings = evaluate(hot, rules, noDeps);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].key, 'rule:good:40');
});

test('non-matching processes never accumulate hits', () => {
  const rules = [cpuRule({ sustainPolls: 1 })];
  const procs = [{ pid: 41, name: 'chrome.exe', cpu: 100, memKB: 0 }];
  assert.deepStrictEqual(evaluate(procs, rules, noDeps), []);
});

test('counters are cleaned up when a pid disappears', () => {
  const rules = [cpuRule({ sustainPolls: 2 })];
  const hot = [{ pid: 50, name: 'node.exe', cpu: 90, memKB: 0 }];

  evaluate(hot, rules, noDeps);                                 // 1 hit
  evaluate([], rules, noDeps);                                  // pid gone → cleanup
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0);   // starts over at 1
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 1);   // fires at 2
});

test('command action launches at most once per rule when several pids fire together', () => {
  const launched = [];
  const deps = { kill: () => {}, launchCommand: (cmd) => launched.push(cmd) };
  const rules = [cpuRule({ action: 'command', command: 'npm run cleanup', sustainPolls: 1 })];
  const hot = [
    { pid: 70, name: 'node.exe', cpu: 95, memKB: 0 },
    { pid: 71, name: 'node.exe', cpu: 96, memKB: 0 },
    { pid: 72, name: 'node.exe', cpu: 97, memKB: 0 },
  ];

  const warnings = evaluate(hot, rules, deps);
  assert.strictEqual(warnings.length, 3);          // one warning per pid
  assert.deepStrictEqual(launched, ['npm run cleanup']); // but a single launch
});

test('kill failures are reported instead of claiming the process was killed', () => {
  const deps = {
    kill: () => ({ success: false, error: 'Access denied' }),
    launchCommand: () => {},
  };
  const rules = [cpuRule({ action: 'kill', sustainPolls: 1 })];
  const hot = [{ pid: 80, name: 'node.exe', cpu: 99, memKB: 0 }];

  const warnings = evaluate(hot, rules, deps);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0].message, /failed to kill node\.exe \(PID 80\)/);
  assert.match(warnings[0].message, /Access denied/);
  assert.doesNotMatch(warnings[0].message, /^Rule "node": killed/);
});

test('empty or missing rule list returns no warnings and clears state', () => {
  const hot = [{ pid: 60, name: 'node.exe', cpu: 90, memKB: 0 }];
  const rules = [cpuRule({ sustainPolls: 2 })];

  evaluate(hot, rules, noDeps);                                 // 1 hit
  assert.deepStrictEqual(evaluate(hot, [], noDeps), []);        // clears counters
  assert.strictEqual(evaluate(hot, rules, noDeps).length, 0);   // starts over
  assert.deepStrictEqual(evaluate(hot, undefined, noDeps), []);
});
