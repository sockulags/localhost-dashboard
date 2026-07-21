// Accumulates per-process CPU cost across polls: integrates the sampled
// CPU percentage over wall-clock time into total CPU-seconds consumed,
// so a process that burned 100% CPU for 5 minutes shows "5m" of CPU time
// even if it is idle right now. Values are CPU-core-seconds: a process
// pinning multiple cores reports cpu > 100 and accumulates faster than
// wall clock, like the user+sys total of `time`. Pure Node module — no
// Electron imports.

const cpuTimes = new Map(); // pid -> { cpuSeconds, lastTs, started }

// Intervals longer than this are not integrated: the sampled cpu% only
// describes recent activity, so integrating it across a system sleep or
// a wall-clock jump would fabricate CPU cost. The entry is re-baselined
// at the new timestamp instead.
const MAX_ELAPSED_SEC = 300;

/**
 * Update accumulated CPU time for each process and attach it as
 * `proc.cpuTimeSec`. First sighting of a pid records a baseline only
 * (no elapsed interval to integrate over yet). A pid whose start time
 * changed is treated as a new process (the OS reused the pid).
 */
function update(processes, nowTs) {
  const activePids = new Set();

  for (const proc of processes) {
    activePids.add(proc.pid);
    let entry = cpuTimes.get(proc.pid);
    if (entry && entry.started !== proc.started) {
      // Same pid, different start time: pid was recycled for a new
      // process, so the banked total belongs to a dead one. Start over.
      entry = null;
    }
    if (!entry) {
      entry = { cpuSeconds: 0, lastTs: nowTs, started: proc.started };
      cpuTimes.set(proc.pid, entry);
    } else {
      const elapsedSeconds = (nowTs - entry.lastTs) / 1000;
      const cpu = Number.isFinite(proc.cpu) ? proc.cpu : 0;
      // Skip negative intervals (clock stepped backwards) and implausibly
      // long ones (sleep/resume, clock jump); re-baseline either way.
      if (elapsedSeconds > 0 && elapsedSeconds <= MAX_ELAPSED_SEC) {
        entry.cpuSeconds += (cpu / 100) * elapsedSeconds;
      }
      entry.lastTs = nowTs;
    }
    proc.cpuTimeSec = entry.cpuSeconds;
  }

  // Clean up dead pids (same pattern as thresholdHits in anomaly-detector)
  for (const pid of cpuTimes.keys()) {
    if (!activePids.has(pid)) cpuTimes.delete(pid);
  }
}

/** Clear all accumulated state (for tests). */
function reset() {
  cpuTimes.clear();
}

module.exports = { update, reset };
