const { spawn } = require('child_process');

// ── Log capture ────────────────────────────────────────────────
// Ring buffer of output lines per bufferKey (profileId:serviceId).
// The buffer survives child exit so crash output stays readable;
// relaunching the same key clears it and starts fresh.

const MAX_LOG_LINES = 500;
// A partial line is force-flushed once it grows past this, so a
// stream that never emits newlines cannot grow memory unbounded.
const MAX_REMAINDER_LENGTH = 4096;

const logBuffers = new Map(); // bufferKey → { cap, lines, remainder }

function makeBufferKey(profileId, serviceId) {
  return `${profileId}:${serviceId}`;
}

function createLogBuffer(cap = MAX_LOG_LINES) {
  return { cap, lines: [], remainder: { out: '', err: '' } };
}

/**
 * Append a raw stdio chunk to a log buffer. Splits on newlines
 * (\r\n, \n, or lone \r so carriage-return progress output becomes
 * lines instead of accumulating), keeping any trailing partial line
 * in a per-stream remainder, and trims the buffer to its line cap.
 * Pure with respect to module state — operates only on the buffer
 * passed in (exported for tests).
 */
function appendChunk(buffer, stream, chunk) {
  const text = buffer.remainder[stream] + String(chunk);
  const parts = text.split(/\r\n|\r|\n/);
  let rest = parts.pop();
  if (rest.length > MAX_REMAINDER_LENGTH) {
    parts.push(rest);
    rest = '';
  }
  buffer.remainder[stream] = rest;
  const ts = Date.now();
  for (const line of parts) {
    buffer.lines.push({ ts, stream, line });
  }
  if (buffer.lines.length > buffer.cap) {
    buffer.lines.splice(0, buffer.lines.length - buffer.cap);
  }
  return buffer;
}

/**
 * Flush any partial line left in the remainder (called when a
 * stream ends so trailing output without a newline is not lost).
 */
function flushRemainder(buffer, stream) {
  if (buffer.remainder[stream]) {
    appendChunk(buffer, stream, '\n');
  }
  return buffer;
}

function getLogs(bufferKey) {
  const buffer = logBuffers.get(bufferKey);
  return buffer ? buffer.lines : [];
}

// ── Launching ──────────────────────────────────────────────────

function launchCommand(command, cwd, bufferKey) {
  if (!command || typeof command !== 'string' || !command.trim()) {
    return { success: false, error: 'No command specified' };
  }

  try {
    const shell = process.platform === 'win32' ? 'cmd' : 'sh';
    const flag  = process.platform === 'win32' ? '/c' : '-c';
    const capture = typeof bufferKey === 'string' && bufferKey.length > 0;
    // detached keeps the service alive independently of the dashboard.
    // Exception: on Windows a DETACHED_PROCESS cmd.exe cannot hand the
    // pipe handles down to the actual service process (all grandchild
    // output is silently lost), so detached is skipped for win32 +
    // capture; plain child processes survive parent exit on Windows.
    // Note: pipe capture inherently means that once the dashboard
    // exits, a service's next stdout write hits a broken pipe — an
    // accepted trade-off of in-memory capture on every platform.
    const detached = !(capture && process.platform === 'win32');
    const child = spawn(shell, [flag, command.trim()], {
      cwd: (cwd && cwd.trim()) ? cwd.trim() : undefined,
      detached,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });

    if (capture) {
      // Fresh buffer on every (re)launch of the same key.
      const buffer = createLogBuffer();
      logBuffers.set(bufferKey, buffer);

      child.stdout.on('data', (chunk) => appendChunk(buffer, 'out', chunk));
      child.stderr.on('data', (chunk) => appendChunk(buffer, 'err', chunk));
      child.stdout.on('end', () => flushRemainder(buffer, 'out'));
      child.stderr.on('end', () => flushRemainder(buffer, 'err'));
      // Surface async failures in the log pane instead of crashing the
      // main process (spawn errors and pipe errors arrive async).
      child.on('error', (err) => appendChunk(buffer, 'err', `[launch error] ${err.message}\n`));
      child.stdout.on('error', () => {});
      child.stderr.on('error', () => {});
    }

    // Spawn failures (e.g. a cwd that no longer exists) surface as an async
    // 'error' event; without a listener it would crash the main process.
    child.on('error', (err) => {
      console.error('Failed to launch command:', err.message);
    });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { launchCommand, getLogs, makeBufferKey, appendChunk, flushRemainder, createLogBuffer };
