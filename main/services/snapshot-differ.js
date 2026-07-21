/**
 * Snapshot differ — compares a previously exported snapshot against a
 * current one and reports which processes started, died, or changed.
 *
 * Pure CommonJS module with no Electron dependencies so it can run in
 * plain Node (unit tests, CI without an Electron binary).
 */

const CPU_DELTA_MIN = 1; // percentage points
const MEM_DELTA_MIN_KB = 10240; // 10 MB

/**
 * Flatten a snapshot's `groups` object into a Map keyed by pid.
 * Malformed groups / process entries are skipped silently.
 */
function flattenSnapshot(snapshot) {
  const map = new Map();
  const groups = snapshot.groups;
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return map;

  for (const [key, group] of Object.entries(groups)) {
    if (!group || !Array.isArray(group.processes)) continue;
    for (const proc of group.processes) {
      if (!proc || typeof proc !== 'object') continue;
      const pid = Number(proc.pid);
      if (!Number.isFinite(pid)) continue;
      map.set(pid, {
        pid,
        name: typeof proc.name === 'string' ? proc.name : '',
        group: typeof proc.group === 'string' ? proc.group : key,
        cpu: Number.isFinite(proc.cpu) ? proc.cpu : 0,
        memKB: Number.isFinite(proc.memKB) ? proc.memKB : 0,
      });
    }
  }
  return map;
}

/**
 * Diff two snapshots.
 *
 * @param {object} oldSnapshot   Parsed JSON of a previously exported snapshot.
 * @param {object} currentSnapshot  The current snapshot.
 * @returns {{started: object[], died: object[], changed: object[]}|null}
 *   null when either snapshot is not a usable object at all.
 *
 * Survivors are matched by pid AND name — a pid that reappears with a
 * different name is treated as one process dying and another starting
 * (guards against OS pid reuse).
 */
function diff(oldSnapshot, currentSnapshot) {
  if (!oldSnapshot || typeof oldSnapshot !== 'object' || Array.isArray(oldSnapshot)) return null;
  if (!currentSnapshot || typeof currentSnapshot !== 'object' || Array.isArray(currentSnapshot)) return null;

  const oldMap = flattenSnapshot(oldSnapshot);
  const curMap = flattenSnapshot(currentSnapshot);

  const started = [];
  const died = [];
  const changed = [];

  for (const [pid, cur] of curMap) {
    const prev = oldMap.get(pid);
    if (!prev || prev.name !== cur.name) {
      // New pid, or same pid reused by a different process.
      started.push(cur);
      continue;
    }

    // Survivor — report only meaningful resource deltas.
    const cpuDelta = cur.cpu - prev.cpu;
    const memDeltaKB = cur.memKB - prev.memKB;
    if (Math.abs(cpuDelta) >= CPU_DELTA_MIN || Math.abs(memDeltaKB) >= MEM_DELTA_MIN_KB) {
      changed.push({ pid, name: cur.name, cpuDelta, memDeltaKB });
    }
  }

  for (const [pid, prev] of oldMap) {
    const cur = curMap.get(pid);
    if (!cur || cur.name !== prev.name) {
      died.push(prev);
    }
  }

  return { started, died, changed };
}

module.exports = { diff };
