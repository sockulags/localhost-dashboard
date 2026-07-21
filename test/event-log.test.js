const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const eventLog = require('../main/services/event-log');
const { diffEvents, record, getHistory, configure } = eventLog;

// ── In-memory fake fs ────────────────────────────────────────

function makeFakeFs(initialFiles = {}) {
  const files = { ...initialFiles };
  const calls = { rename: [] };
  return {
    files,
    calls,
    statSync(file) {
      if (!(file in files)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return { size: Buffer.byteLength(files[file], 'utf8') };
    },
    renameSync(from, to) {
      if (!(from in files)) throw new Error('ENOENT');
      calls.rename.push([from, to]);
      files[to] = files[from];
      delete files[from];
    },
    appendFileSync(file, data) {
      files[file] = (files[file] || '') + data;
    },
    writeFileSync(file, data) {
      files[file] = data;
    },
    readFileSync(file) {
      if (!(file in files)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files[file];
    },
  };
}

const LOG = 'C:\\fake\\events.jsonl';

function setup(initialFiles) {
  const fs = makeFakeFs(initialFiles);
  // Inject a trivial join so paths are identical on Windows and Linux CI.
  const fakePath = { join: (...parts) => parts.join('\\') };
  configure({ fs, path: fakePath, dir: 'C:\\fake' });
  return fs;
}

beforeEach(() => {
  configure(); // reset recorder state, restore real fs (tests re-inject)
});

// ── diffEvents (pure) ────────────────────────────────────────

test('diffEvents reports new pids as start events', () => {
  const prev = new Map([[1, { name: 'node.exe', group: 'dev' }]]);
  const procs = [
    { pid: 1, name: 'node.exe', group: 'dev' },
    { pid: 2, name: 'vite.exe', group: 'dev' },
  ];

  const events = diffEvents(prev, procs, [], new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'start');
  assert.strictEqual(events[0].pid, 2);
  assert.strictEqual(events[0].name, 'vite.exe');
  assert.strictEqual(events[0].group, 'dev');
  assert.strictEqual(typeof events[0].ts, 'number');
});

test('diffEvents reports disappeared pids as stop events', () => {
  const prev = new Map([
    [1, { name: 'node.exe', group: 'dev' }],
    [2, { name: 'postgres.exe', group: 'databases' }],
  ]);
  const procs = [{ pid: 1, name: 'node.exe', group: 'dev' }];

  const events = diffEvents(prev, procs, [], new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'stop');
  assert.strictEqual(events[0].pid, 2);
  assert.strictEqual(events[0].name, 'postgres.exe');
  assert.strictEqual(events[0].group, 'databases');
});

test('diffEvents reports only unseen warnings and does not mutate the seen set', () => {
  const seen = new Set(['cpu:1']);
  const warnings = [
    { pid: 1, processName: 'node.exe', key: 'cpu:1', message: 'High CPU' },
    { pid: 2, processName: 'java.exe', key: 'mem:2', message: 'High memory' },
  ];

  const events = diffEvents(new Map(), [], warnings, seen);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'warning');
  assert.strictEqual(events[0].key, 'mem:2');
  assert.strictEqual(events[0].message, 'High memory');
  // Pure: caller owns the seen-set lifecycle
  assert.deepStrictEqual([...seen], ['cpu:1']);
});

test('diffEvents derives a key for port warnings that lack one', () => {
  const warnings = [{ pid: 7, port: 5432, processName: 'node.exe', message: 'Port 5432 conflict' }];
  const events = diffEvents(new Map(), [], warnings, new Set());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].key, 'port:5432:7');
});

test('diffEvents returns nothing when nothing changed', () => {
  const prev = new Map([[1, { name: 'node.exe', group: 'dev' }]]);
  const procs = [{ pid: 1, name: 'node.exe', group: 'dev' }];
  assert.deepStrictEqual(diffEvents(prev, procs, [], new Set()), []);
});

test('diffEvents reports a recycled pid (same pid, new name) as stop + start', () => {
  const prev = new Map([[100, { name: 'node.exe', group: 'dev' }]]);
  const procs = [{ pid: 100, name: 'chrome.exe', group: 'apps' }];

  const events = diffEvents(prev, procs, [], new Set());
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'stop');
  assert.strictEqual(events[0].name, 'node.exe');
  assert.strictEqual(events[1].type, 'start');
  assert.strictEqual(events[1].name, 'chrome.exe');
});

// ── record: seeding + dedupe ─────────────────────────────────

test('record skips the first poll (seeding) and writes nothing', () => {
  const fs = setup();
  const procs = [
    { pid: 1, name: 'node.exe', group: 'dev' },
    { pid: 2, name: 'vite.exe', group: 'dev' },
  ];

  const first = record(procs, []);
  assert.deepStrictEqual(first, []);
  assert.strictEqual(fs.files[LOG], undefined);

  // Second poll with one new pid logs exactly one start event
  const second = record([...procs, { pid: 3, name: 'esbuild.exe', group: 'dev' }], []);
  assert.strictEqual(second.length, 1);
  assert.strictEqual(second[0].type, 'start');
  assert.strictEqual(second[0].pid, 3);

  const lines = fs.files[LOG].trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).pid, 3);
});

test('record logs a repeated warning key only once', () => {
  const fs = setup();
  const warning = { pid: 1, processName: 'node.exe', key: 'cpu:1', message: 'High CPU' };

  record([], []); // seed
  const first = record([], [warning]);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].type, 'warning');

  const again = record([], [warning]);
  assert.deepStrictEqual(again, []);

  const lines = fs.files[LOG].trim().split('\n');
  assert.strictEqual(lines.length, 1);
});

test('record treats warnings present at seeding as already seen', () => {
  setup();
  const warning = { pid: 1, processName: 'node.exe', key: 'cpu:1', message: 'High CPU' };
  record([], [warning]); // seed — warning existed at boot
  assert.deepStrictEqual(record([], [warning]), []);
});

test('record logs a warning again after it clears and re-fires', () => {
  setup();
  const warning = { pid: 1, processName: 'node.exe', key: 'cpu:1', message: 'High CPU' };

  record([], []); // seed
  assert.strictEqual(record([], [warning]).length, 1); // first episode
  assert.deepStrictEqual(record([], []), []); // warning cleared
  const again = record([], [warning]); // second episode hours later
  assert.strictEqual(again.length, 1);
  assert.strictEqual(again[0].key, 'cpu:1');
});

test('record skips a transiently empty poll instead of logging mass stops', () => {
  const fs = setup();
  const procs = [
    { pid: 1, name: 'node.exe', group: 'dev' },
    { pid: 2, name: 'vite.exe', group: 'dev' },
  ];

  record(procs, []); // seed
  // Collector hiccup: empty list must not produce stop events...
  assert.deepStrictEqual(record([], []), []);
  assert.strictEqual(fs.files[LOG], undefined);
  // ...and the next good poll must not re-log the survivors as starts.
  assert.deepStrictEqual(record(procs, []), []);
});

// ── Rotation ─────────────────────────────────────────────────

test('appending past the size cap rotates the log to .1', () => {
  const bigLine = JSON.stringify({ ts: 1, type: 'start', pid: 1, name: 'x' }) + '\n';
  const big = bigLine.repeat(Math.ceil((5 * 1024 * 1024) / bigLine.length));
  const fs = setup({ [LOG]: big, [`${LOG}.1`]: 'old rotated content\n' });

  record([], []); // seed
  record([{ pid: 9, name: 'new.exe', group: 'dev' }], []);

  assert.deepStrictEqual(fs.calls.rename, [[LOG, `${LOG}.1`]]);
  // .1 now holds the rotated content (old .1 overwritten)
  assert.strictEqual(fs.files[`${LOG}.1`], big);
  // fresh log contains only the new event
  const lines = fs.files[LOG].trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).pid, 9);
});

test('when rotation rename fails the log is truncated in place, not grown', () => {
  const bigLine = JSON.stringify({ ts: 1, type: 'start', pid: 1, name: 'x' }) + '\n';
  const big = bigLine.repeat(Math.ceil((5 * 1024 * 1024) / bigLine.length));
  const fs = setup({ [LOG]: big });
  fs.renameSync = () => { throw new Error('EPERM: .1 is locked'); };

  record([], []); // seed
  record([{ pid: 9, name: 'new.exe', group: 'dev' }], []);

  // File was replaced with just the new batch — bounded, not appended to.
  const lines = fs.files[LOG].trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).pid, 9);
});

test('no rotation happens below the size cap', () => {
  const fs = setup({ [LOG]: JSON.stringify({ ts: 1, type: 'start', pid: 1, name: 'x' }) + '\n' });
  record([], []); // seed
  record([{ pid: 9, name: 'new.exe', group: 'dev' }], []);
  assert.deepStrictEqual(fs.calls.rename, []);
  assert.strictEqual(fs.files[LOG].trim().split('\n').length, 2);
});

// ── getHistory ───────────────────────────────────────────────

test('getHistory returns parsed events newest first, skipping corrupt lines', () => {
  const lines = [
    JSON.stringify({ ts: 100, type: 'start', pid: 1, name: 'a.exe' }),
    'this is not json {{{',
    JSON.stringify({ ts: 200, type: 'stop', pid: 1, name: 'a.exe' }),
    '{"truncated": ', // crash mid-append
    JSON.stringify({ ts: 300, type: 'warning', pid: 2, key: 'cpu:2', message: 'High CPU' }),
    '',
  ].join('\n');
  setup({ [LOG]: lines });

  const events = getHistory();
  assert.strictEqual(events.length, 3);
  assert.deepStrictEqual(events.map((e) => e.ts), [300, 200, 100]);
});

test('getHistory respects the limit', () => {
  const lines = [];
  for (let i = 1; i <= 10; i++) {
    lines.push(JSON.stringify({ ts: i, type: 'start', pid: i, name: 'x.exe' }));
  }
  setup({ [LOG]: lines.join('\n') + '\n' });

  const events = getHistory(3);
  assert.deepStrictEqual(events.map((e) => e.ts), [10, 9, 8]);
});

test('getHistory pulls from the rotated file when the current log is short', () => {
  const rotated = [
    JSON.stringify({ ts: 1, type: 'start', pid: 1, name: 'old.exe' }),
    JSON.stringify({ ts: 2, type: 'stop', pid: 1, name: 'old.exe' }),
  ].join('\n') + '\n';
  const current = JSON.stringify({ ts: 3, type: 'start', pid: 2, name: 'new.exe' }) + '\n';
  setup({ [LOG]: current, [`${LOG}.1`]: rotated });

  assert.deepStrictEqual(getHistory(2).map((e) => e.ts), [3, 2]);
  assert.deepStrictEqual(getHistory(500).map((e) => e.ts), [3, 2, 1]);
});

test('getHistory returns an empty array when no log exists', () => {
  setup();
  assert.deepStrictEqual(getHistory(), []);
});
