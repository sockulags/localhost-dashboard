const processCollector = require('./collectors/process-collector');
const portCollector = require('./collectors/port-collector');
const systemCollector = require('./collectors/system-collector');
const dockerCollector = require('./collectors/docker-collector');
const { classify, GROUP_META } = require('./services/classifier');
const { detect } = require('./services/anomaly-detector');

let busy = false;
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

    // Detect anomalies
    const warnings = detect(merged);
    const warningPids = new Set(warnings.map((w) => w.pid));
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

    return {
      groups,
      containers,
      warnings,
      timestamp: Date.now(),
      totalProcesses: merged.length,
    };
  } finally {
    busy = false;
  }
}

module.exports = { collectAll };
