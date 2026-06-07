const EXPECTED_PORT_PROCESS = {
  5432: /postgres/i,
  3306: /mysql|mariadb/i,
  27017: /mongod/i,
  6379: /redis/i,
  11211: /memcached/i,
  2375: /docker/i,
  2376: /docker/i,
  80: /nginx|apache|httpd|iis/i,
  443: /nginx|apache|httpd|iis/i,
  8080: /java|tomcat|node|python/i,
};

function detect(processes) {
  const warnings = [];

  for (const proc of processes) {
    if (!proc.ports || proc.ports.length === 0) continue;

    for (const port of proc.ports) {
      const expected = EXPECTED_PORT_PROCESS[port];
      if (expected && !expected.test(proc.name)) {
        warnings.push({
          pid: proc.pid,
          port,
          processName: proc.name,
          message: `Port ${port} is used by ${proc.name} (PID ${proc.pid}) — expected ${expected.source}`,
        });
      }
    }
  }

  return warnings;
}

// Track consecutive polls a PID spends over its threshold so we only
// fire notifications for sustained hot processes (not momentary spikes).
const thresholdHits = new Map(); // pid -> { cpu: count, mem: count }

function detectThresholds(processes, { cpuThreshold, memThresholdMB, sustainPolls }) {
  const warnings = [];
  if (!cpuThreshold && !memThresholdMB) {
    thresholdHits.clear();
    return warnings;
  }

  const activePids = new Set();
  for (const proc of processes) {
    activePids.add(proc.pid);
    let hits = thresholdHits.get(proc.pid);
    if (!hits) {
      hits = { cpu: 0, mem: 0 };
      thresholdHits.set(proc.pid, hits);
    }

    if (cpuThreshold > 0 && proc.cpu >= cpuThreshold) {
      hits.cpu += 1;
      if (hits.cpu === sustainPolls) {
        warnings.push({
          pid: proc.pid,
          port: 0,
          processName: proc.name,
          key: `cpu:${proc.pid}`,
          message: `High CPU: ${proc.name} (PID ${proc.pid}) at ${proc.cpu.toFixed(1)}% for ${sustainPolls} polls`,
        });
      }
    } else {
      hits.cpu = 0;
    }

    const memMB = (proc.memKB || 0) / 1024;
    if (memThresholdMB > 0 && memMB >= memThresholdMB) {
      hits.mem += 1;
      if (hits.mem === sustainPolls) {
        warnings.push({
          pid: proc.pid,
          port: 0,
          processName: proc.name,
          key: `mem:${proc.pid}`,
          message: `High memory: ${proc.name} (PID ${proc.pid}) at ${memMB.toFixed(0)} MB for ${sustainPolls} polls`,
        });
      }
    } else {
      hits.mem = 0;
    }
  }

  // Clean up dead pids
  for (const pid of thresholdHits.keys()) {
    if (!activePids.has(pid)) thresholdHits.delete(pid);
  }

  return warnings;
}

// Detect "process inflation": many instances of the same dev process name,
// the classic symptom of an AI agent (or watch script) spawning runaways.
function detectDuplicates(processes, { duplicateThreshold }) {
  const warnings = [];
  if (!duplicateThreshold || duplicateThreshold < 2) return warnings;

  const byName = new Map();
  for (const proc of processes) {
    if (proc.group !== 'dev') continue;
    if (!byName.has(proc.name)) byName.set(proc.name, []);
    byName.get(proc.name).push(proc);
  }

  for (const [name, procs] of byName) {
    if (procs.length >= duplicateThreshold) {
      warnings.push({
        pid: procs[0].pid,
        pids: procs.map((p) => p.pid),
        port: 0,
        processName: name,
        key: `dup:${name}`,
        count: procs.length,
        message: `${procs.length} ${name} processes running — possible runaway agent. Group the list to bulk-kill them.`,
      });
    }
  }

  return warnings;
}

module.exports = { detect, detectThresholds, detectDuplicates };
