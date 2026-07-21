const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  launchCommand,
  getLogs,
  makeBufferKey,
  appendChunk,
  flushRemainder,
  createLogBuffer,
} = require('../main/services/profile-runner');

// Inline `node -e "..."` (and any embedded double quotes) does not survive
// the spawn → cmd /c round-trip on Windows, so write tiny script files and
// run them by unquoted path instead (os.tmpdir() contains no spaces on the
// platforms CI runs on).
const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-runner-test-'));
function makeScript(name, source) {
  const file = path.join(scriptDir, name);
  fs.writeFileSync(file, source, 'utf8');
  return `node ${file}`;
}

function waitFor(predicate, timeoutMs = 5000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for condition'));
      }
    }, intervalMs);
  });
}

test('launchCommand captures stdout and stderr per bufferKey', async () => {
  const key = 'test-profile:test-service';
  const cmd = makeScript('both.js', "console.log('hello-out'); console.error('hello-err');");

  const res = launchCommand(cmd, undefined, key);
  assert.strictEqual(res.success, true);

  await waitFor(() => getLogs(key).length >= 2);

  const logs = getLogs(key);
  const outLine = logs.find((l) => l.line === 'hello-out');
  const errLine = logs.find((l) => l.line === 'hello-err');
  assert.ok(outLine, 'stdout line captured');
  assert.strictEqual(outLine.stream, 'out');
  assert.ok(errLine, 'stderr line captured');
  assert.strictEqual(errLine.stream, 'err');
  for (const entry of logs) {
    assert.strictEqual(typeof entry.ts, 'number');
  }
});

test('relaunching the same bufferKey clears previous logs', async () => {
  const key = 'test-profile:relaunch';

  launchCommand(makeScript('first.js', "console.log('first-run');"), undefined, key);
  await waitFor(() => getLogs(key).some((l) => l.line === 'first-run'));

  launchCommand(makeScript('second.js', "console.log('second-run');"), undefined, key);
  await waitFor(() => getLogs(key).some((l) => l.line === 'second-run'));

  const logs = getLogs(key);
  assert.ok(!logs.some((l) => l.line === 'first-run'), 'old logs cleared on relaunch');
});

test('getLogs returns empty array for unknown key', () => {
  assert.deepStrictEqual(getLogs('no:such:key'), []);
});

test('launchCommand without bufferKey still succeeds', () => {
  const res = launchCommand(makeScript('noop.js', 'process.exit(0);'));
  assert.strictEqual(res.success, true);
});

test('launchCommand rejects empty command', () => {
  const res = launchCommand('', undefined, 'x:y');
  assert.strictEqual(res.success, false);
});

test('appendChunk splits chunks into tagged lines', () => {
  const buf = createLogBuffer();
  appendChunk(buf, 'out', 'one\ntwo\n');
  appendChunk(buf, 'err', 'oops\n');

  assert.strictEqual(buf.lines.length, 3);
  assert.deepStrictEqual(buf.lines.map((l) => l.line), ['one', 'two', 'oops']);
  assert.deepStrictEqual(buf.lines.map((l) => l.stream), ['out', 'out', 'err']);
});

test('appendChunk handles partial lines with a per-stream remainder', () => {
  const buf = createLogBuffer();
  appendChunk(buf, 'out', 'par');
  assert.strictEqual(buf.lines.length, 0, 'partial line not emitted yet');
  appendChunk(buf, 'err', 'other-stream\n');
  assert.strictEqual(buf.lines.length, 1, 'err remainder independent of out');
  appendChunk(buf, 'out', 'tial\nnext');
  assert.strictEqual(buf.lines.length, 2);
  assert.strictEqual(buf.lines[1].line, 'partial');

  flushRemainder(buf, 'out');
  assert.strictEqual(buf.lines.length, 3);
  assert.strictEqual(buf.lines[2].line, 'next');
  assert.strictEqual(buf.remainder.out, '');
});

test('appendChunk handles CRLF line endings', () => {
  const buf = createLogBuffer();
  appendChunk(buf, 'out', 'a\r\nb\r\n');
  assert.deepStrictEqual(buf.lines.map((l) => l.line), ['a', 'b']);
});

test('appendChunk treats lone carriage returns as line breaks (progress output)', () => {
  const buf = createLogBuffer();
  appendChunk(buf, 'out', 'Progress 10%\rProgress 20%\rProgress 30%');
  assert.deepStrictEqual(buf.lines.map((l) => l.line), ['Progress 10%', 'Progress 20%']);
  assert.strictEqual(buf.remainder.out, 'Progress 30%');
});

test('appendChunk force-flushes an oversized partial line instead of growing unbounded', () => {
  const buf = createLogBuffer();
  appendChunk(buf, 'out', 'x'.repeat(5000));
  assert.strictEqual(buf.remainder.out, '', 'oversized remainder flushed');
  assert.strictEqual(buf.lines.length, 1);
  assert.strictEqual(buf.lines[0].line.length, 5000);
});

test('makeBufferKey joins profile and service ids', () => {
  assert.strictEqual(makeBufferKey('p1', 's1'), 'p1:s1');
});

test('ring buffer caps at the configured line count, keeping newest', () => {
  const buf = createLogBuffer(5);
  for (let i = 0; i < 12; i++) {
    appendChunk(buf, 'out', `line-${i}\n`);
  }
  assert.strictEqual(buf.lines.length, 5);
  assert.deepStrictEqual(
    buf.lines.map((l) => l.line),
    ['line-7', 'line-8', 'line-9', 'line-10', 'line-11']
  );
});

test('a single oversized chunk is trimmed to the cap', () => {
  const buf = createLogBuffer(3);
  const chunk = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n') + '\n';
  appendChunk(buf, 'out', chunk);
  assert.strictEqual(buf.lines.length, 3);
  assert.deepStrictEqual(buf.lines.map((l) => l.line), ['l7', 'l8', 'l9']);
});
