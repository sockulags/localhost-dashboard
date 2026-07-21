const processCollector = require('./collectors/process-collector');
const portCollector = require('./collectors/port-collector');
const systemCollector = require('./collectors/system-collector');
const dockerCollector = require('./collectors/docker-collector');
const { classify, GROUP_META } = require('./services/classifier');
const { detect, detectThresholds, detectDuplicates } = require('./services/anomaly-detector');
const config = require('./services/config');
const cpuAccumulator = require('./services/cpu-accumulator');
const healthCollector = require('./collectors/health-collector');
const projectResolver = require('./services/project-resolver');
const eventLog = require('./services/event-log');
const ruleEngine = require('./services/rule-engine');
const { kill } = require('./services/process-killer');
const { launchCommand } = require('./services/profile-runner');

let busy = false;
let lastSnapshot = null;
let dockerCacheCounter = 0;
const DOCKER_CACHE_RESET_INTERVAL = 10; // Re-check Docker availability every ~10 polls

async function collectAll() {
  if (busy) return null;
  busy = true;

  try {
    // Reset Docker availability cache periodically
    dockerCacheCounter++;
    if (dockerCacheCounter >= DOCKER_CACHE_RESET_INTERVAL) {
      dockerCacheCounter = 0;
      dockerCollector.resetCache();
    }

    const [processList, portList, systemMap, dockerList] = await Promise.all([
      processCollector.collect(),
      portCollector.collect(),
      systemCollector.collect(),
      dockerCollector.collect(),
    ]);

    // Build port lookup: pid -> [port numbers]
    const portsByPid = new Map();
    for (const entry of portList) {
      if (!portsByPid.has(entry.pid)) {
        portsByPid.set(entry.pid, []);
      }
      portsByPid.get(entry.pid).push(entry.port);
    }

    // Build port detail lookup: pid -> [port entries]
    const portDetailsByPid = new Map();
    for (const entry of portList) {
      if (!portDetailsByPid.has(entry.pid)) {
        portDetailsByPid.set(entry.pid, []);
      }
      portDetailsByPid.get(entry.pid).push(entry);
    }

    // Build a set of host ports used by Docker containers for cross-referencing
    const dockerHostPorts = new Set();
    for (const container of dockerList) {
      for (const p of container.ports) {
        if (p.hostPort) {
          dockerHostPorts.add(p.hostPort);
        }
      }
    }

    // Merge all data by PID
    const merged = [];
    for (const proc of processList) {
      const sysInfo = systemMap.get(proc.pid);
      const ports = portsByPid.get(proc.pid) || [];
      const portDetails = portDetailsByPid.get(proc.pid) || [];

      merged.push({
        pid: proc.pid,
        name: proc.name,
        memKB: proc.memKB,
        cpu: sysInfo ? sysInfo.cpu : 0,
        started: sysInfo ? sysInfo.started : null,
        ports,
        portDetails,
        group: classify(proc.name, ports),
      });
    }

    // [anchor: enrichers] — per-process enrichment blocks go below this line

    // Accumulate per-process CPU cost (attaches proc.cpuTimeSec)
    cpuAccumulator.update(merged, Date.now());
    // HTTP health checks: attach per-port up/down + latency to web-ish
    // processes. Only dev/apps groups are probed — databases and system
    // services don't speak HTTP and would show as permanently down.
    // collect() is non-blocking: it returns the cached results and
    // refreshes them in a throttled background probe, so the poll's
    // snapshot is never delayed. Health may lag one poll.
    if (config.get('portHealthChecks')) {
      const HEALTH_GROUPS = new Set(['dev', 'apps']);
      const webProcs = merged.filter((p) => HEALTH_GROUPS.has(p.group) && p.ports.length > 0);
      const health = healthCollector.collect(webProcs.flatMap((p) => p.ports));
      for (const proc of webProcs) {
        const portHealth = {};
        let hasAny = false;
        for (const port of proc.ports) {
          const status = health.get(port);
          if (status) {
            portHealth[port] = status;
            hasAny = true;
          }
        }
        if (hasAny) proc.portHealth = portHealth;
      }
    }
    // Project linkage: attach proc.projectName (from the owning process's
    // working directory: package.json name or compose dir) for processes
    // that hold listening ports. Mutates procs in place. Non-blocking:
    // cached names apply immediately, uncached pids resolve in a background
    // batch and show up on the next poll — the snapshot never waits on it.
    await projectResolver.resolve(merged);

    // Detect anomalies (port conflicts + resource thresholds)
    const warnings = detect(merged);
    const thresholdWarnings = detectThresholds(merged, {
      cpuThreshold: config.get('cpuThreshold'),
      memThresholdMB: config.get('memThresholdMB'),
      sustainPolls: config.get('thresholdSustainPolls'),
    });
    warnings.push(...thresholdWarnings);
    const duplicateWarnings = detectDuplicates(merged, {
      duplicateThreshold: config.get('duplicateThreshold'),
    });
    warnings.push(...duplicateWarnings);

    // [anchor: extra-warnings] — additional warning producers go below this line

    // Project linkage: annotate port-related warnings with the owning
    // project name resolved by the enricher above. `!w.port` also skips
    // warnings that carry the port:0 sentinel (thresholds, duplicates).
    for (const w of warnings) {
      if (!w.port) continue;
      const wPids = Array.isArray(w.pids) ? w.pids : [w.pid];
      const owner = merged.find((p) => p.projectName && wPids.includes(p.pid));
      if (owner) w.message += ` (project: ${owner.projectName})`;
    }
    // User-defined rules: notify/kill/run a command on sustained metric breaches
    warnings.push(...ruleEngine.evaluate(merged, config.get('userRules'), { kill, launchCommand }));

    // A warning can cover one pid (w.pid) or many (w.pids, e.g. duplicates).
    const warningPids = new Set();
    for (const w of warnings) {
      if (Array.isArray(w.pids)) {
        for (const p of w.pids) warningPids.add(p);
      } else {
        warningPids.add(w.pid);
      }
    }
    for (const proc of merged) {
      proc.hasWarning = warningPids.has(proc.pid);
    }

    // Group processes
    const groups = {};
    for (const key of Object.keys(GROUP_META)) {
      groups[key] = {
        ...GROUP_META[key],
        key,
        processes: [],
        totalCpu: 0,
        totalMemKB: 0,
      };
    }

    for (const proc of merged) {
      const g = groups[proc.group];
      g.processes.push(proc);
      g.totalCpu += proc.cpu;
      g.totalMemKB += proc.memKB;
    }

    // Sort processes within each group by CPU desc
    for (const g of Object.values(groups)) {
      g.processes.sort((a, b) => b.cpu - a.cpu);
    }

    // Cross-reference Docker container ports with netstat port data
    const containers = dockerList.map((container) => {
      const matchedPorts = [];
      for (const cp of container.ports) {
        if (cp.hostPort && dockerHostPorts.has(cp.hostPort)) {
          matchedPorts.push(cp.hostPort);
        }
      }
      return { ...container, matchedPorts };
    });

    // [anchor: post-poll] — snapshot observers/caches go below this line

    // ── Event history ────────────────────────────────────────
    // Persist start/stop/warning events; logging must never break polling.
    try {
      eventLog.record(merged, warnings);
    } catch (err) {
      console.error('event-log record failed:', err.message);
    }

    lastSnapshot = {
      groups,
      containers,
      warnings,
      timestamp: Date.now(),
      totalProcesses: merged.length,
    };
    return lastSnapshot;
  } finally {
    busy = false;
  }
}

/** Latest successful snapshot, for consumers that must not miss a busy poll. */
function getLastSnapshot() {
  return lastSnapshot;
}

module.exports = { collectAll, getLastSnapshot };
