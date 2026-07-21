/**
 * Persistent event history: process starts/stops and new warnings,
 * appended as JSONL to <userData>/events.jsonl.
 *
 * The diff logic (diffEvents) is pure so it can be unit-tested without
 * Electron. The write path lazily requires electron only when it actually
 * needs the userData directory, so this module imports cleanly in CI.
 */

const LOG_FILE = 'events.jsonl';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate at ~5 MB
const MAX_SEEN_WARNING_KEYS = 500;
const DEFAULT_HISTORY_LIMIT = 500;

// Injectable dependencies (tests swap these for fakes).
let deps = {
  fs: require('fs'),
  path: require('path'),
  dir: null, // resolved lazily from electron's userData when null
};

// ── Pure diff logic ──────────────────────────────────────────

/**
 * Derive a stable identity for a warning. Threshold/duplicate warnings
 * carry a `key`; port-conflict warnings from detect() do not, so build
 * one from their pid/port (message as a last resort for future
 * producers that carry neither).
 */
function warningKey(w) {
  if (w.key) return w.key;
  if (w.port) return `port:${w.port}:${w.pid}`;
  return `msg:${w.pid}:${w.message}`;
}

/**
 * Compare the previous pid map against the current poll and return the
 * events that happened in between. Pure: mutates none of its arguments.
 *
 * @param {Map<number,{name:string,group:string}>} prevPidMap
 * @param {Array<{pid:number,name:string,group?:string}>} processes
 * @param {Array<object>} warnings
 * @param {Set<string>} seenWarningKeys warning keys already logged (still active)
 * @returns {Array<{ts:number,type:string,pid:number,name:string,group?:string,key?:string,message?:string}>}
 */
function diffEvents(prevPidMap, processes, warnings, seenWarningKeys) {
  const ts = Date.now();
  const events = [];

  const currentPids = new Set();
  for (const proc of processes) {
    currentPids.add(proc.pid);
    const prev = prevPidMap.get(proc.pid);
    if (!prev) {
      events.push({ ts, type: 'start', pid: proc.pid, name: proc.name, group: proc.group });
    } else if (prev.name !== proc.name) {
      // The OS recycled this pid between polls: the old process died and
      // a different one took its place. Report both transitions.
      events.push({ ts, type: 'stop', pid: proc.pid, name: prev.name, group: prev.group });
      events.push({ ts, type: 'start', pid: proc.pid, name: proc.name, group: proc.group });
    }
  }

  for (const [pid, info] of prevPidMap) {
    if (!currentPids.has(pid)) {
      events.push({ ts, type: 'stop', pid, name: info.name, group: info.group });
    }
  }

  for (const w of warnings || []) {
    if (!w || !w.message) continue;
    const key = warningKey(w);
    if (seenWarningKeys.has(key)) continue;
    events.push({
      ts,
      type: 'warning',
      pid: w.pid,
      name: w.processName || '',
      key,
      message: w.message,
    });
  }

  return events;
}

// ── Stateful recorder ────────────────────────────────────────

let prevPidMap = null; // null = not seeded yet (first poll)
let seenWarningKeys = new Set();

function buildPidMap(processes) {
  const map = new Map();
  for (const proc of processes) {
    map.set(proc.pid, { name: proc.name, group: proc.group });
  }
  return map;
}

function buildWarningKeySet(warnings) {
  const keys = new Set();
  for (const w of warnings || []) {
    if (w && w.message) keys.add(warningKey(w));
    if (keys.size >= MAX_SEEN_WARNING_KEYS) break; // hard cap, just in case
  }
  return keys;
}

/**
 * Record one poll. Skips the very first poll (seeding) so a dashboard
 * boot does not log hundreds of "start" events, then appends the diff
 * to the JSONL log in a single batch write.
 *
 * @returns {Array} the events written (empty on the seeding poll)
 */
function record(processes, warnings) {
  if (!Array.isArray(processes)) return [];

  if (prevPidMap === null) {
    // Seeding poll: remember what exists now, log nothing.
    prevPidMap = buildPidMap(processes);
    seenWarningKeys = buildWarningKeySet(warnings);
    return [];
  }

  // A transiently failed collector (e.g. tasklist timing out on a loaded
  // machine) yields an empty list; diffing against it would log a bogus
  // "stop" for every tracked process. Skip the poll, keep previous state.
  if (processes.length === 0 && prevPidMap.size > 0) return [];

  const events = diffEvents(prevPidMap, processes, warnings, seenWarningKeys);
  prevPidMap = buildPidMap(processes);
  // Only keys still present this poll stay suppressed. Once a warning
  // clears, a later recurrence of the same key is a new episode and is
  // logged again (threshold warnings are edge-triggered, port/duplicate
  // warnings are re-emitted every poll while active).
  seenWarningKeys = buildWarningKeySet(warnings);

  if (events.length > 0) appendEvents(events);
  return events;
}

// ── File I/O ─────────────────────────────────────────────────

function getLogDir() {
  if (deps.dir) return deps.dir;
  // Lazy so requiring this module never needs an Electron runtime.
  return require('electron').app.getPath('userData');
}

function logFilePath() {
  return deps.path.join(getLogDir(), LOG_FILE);
}

/** Batch-append events as JSONL, rotating at MAX_LOG_BYTES. */
function appendEvents(events) {
  const file = logFilePath();
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';

  let size = 0;
  try {
    size = deps.fs.statSync(file).size;
  } catch {
    // No log file yet.
  }

  if (size >= MAX_LOG_BYTES) {
    try {
      // Overwrite any existing .1 and start fresh.
      deps.fs.renameSync(file, `${file}.1`);
    } catch {
      // Cannot rotate (.1 locked by AV/editor, etc.). Truncate in place
      // so the log stays bounded instead of growing past the cap forever.
      try {
        deps.fs.writeFileSync(file, lines, 'utf8');
      } catch {
        // Drop this batch; better than an unbounded log.
      }
      return;
    }
  }

  deps.fs.appendFileSync(file, lines, 'utf8');
}

function parseLines(text, out) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === 'object' && event.type) out.push(event);
    } catch {
      // Tolerate corrupt/partial lines (e.g. a crash mid-append).
    }
  }
}

/**
 * Read the last `limit` events, newest first. Falls back to the rotated
 * file (.1) when the current log alone cannot satisfy the limit.
 */
function getHistory(limit = DEFAULT_HISTORY_LIMIT) {
  const file = logFilePath();

  const current = [];
  try {
    parseLines(deps.fs.readFileSync(file, 'utf8'), current);
  } catch {
    // No log yet.
  }

  let combined = current;
  if (current.length < limit) {
    const rotated = [];
    try {
      parseLines(deps.fs.readFileSync(`${file}.1`, 'utf8'), rotated);
    } catch {
      // No rotated log.
    }
    if (rotated.length > 0) combined = rotated.concat(current);
  }

  return combined.slice(Math.max(0, combined.length - limit)).reverse();
}

// ── Test hooks ───────────────────────────────────────────────

/**
 * Override fs/path/dir (tests) and reset recorder state. Pass no
 * argument to restore the real modules.
 */
function configure(overrides) {
  deps = {
    fs: (overrides && overrides.fs) || require('fs'),
    path: (overrides && overrides.path) || require('path'),
    dir: (overrides && overrides.dir) || null,
  };
  prevPidMap = null;
  seenWarningKeys = new Set();
}

module.exports = { diffEvents, record, getHistory, configure };
