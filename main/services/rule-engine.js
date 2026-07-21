// User-defined rule engine.
//
// Evaluates rules of the form "if process name matches <pattern> and
// <metric> stays over <threshold> for <sustainPolls> consecutive polls,
// then notify / kill / run a command".
//
// Rule shape:
//   { id, pattern, metric: 'cpu'|'mem', threshold, sustainPolls,
//     action: 'notify'|'kill'|'command', command?, cwd? }
//
// `deps` ({ kill, launchCommand }) are injected by the caller so this
// module stays free of Electron/OS dependencies and is unit-testable.
// 'mem' compares memKB/1024 (MB) against threshold; 'cpu' compares percent.

// Track consecutive polls each (rule, pid) pair spends over its threshold,
// mirroring the `thresholdHits` pattern in anomaly-detector.js: fire once
// when the count reaches sustainPolls, reset on a dip, clean up dead pids.
const sustainHits = new Map(); // `${ruleId}:${pid}` -> count

function evaluate(processes, rules, deps = {}) {
  const warnings = [];

  if (!Array.isArray(rules) || rules.length === 0) {
    sustainHits.clear();
    return warnings;
  }

  const activeKeys = new Set();

  for (const rule of rules) {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.trim()) continue;
    if (rule.metric !== 'cpu' && rule.metric !== 'mem') continue;

    let regex;
    try {
      regex = new RegExp(rule.pattern, 'i');
    } catch {
      continue; // invalid regex — skip the rule entirely
    }

    const threshold = Number(rule.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) continue;
    const sustainPolls = Math.max(1, Math.min(60, Number(rule.sustainPolls) || 1));

    for (const proc of Array.isArray(processes) ? processes : []) {
      if (!regex.test(proc.name || '')) continue;

      const value = rule.metric === 'cpu' ? (proc.cpu || 0) : (proc.memKB || 0) / 1024;
      const counterKey = `${rule.id}:${proc.pid}`;

      if (value >= threshold) {
        activeKeys.add(counterKey);
        const count = (sustainHits.get(counterKey) || 0) + 1;
        sustainHits.set(counterKey, count);
        if (count === sustainPolls) {
          warnings.push(fire(rule, proc, value, sustainPolls, deps));
        }
      } else {
        sustainHits.delete(counterKey); // dip below threshold resets the streak
      }
    }
  }

  // Clean up counters for dead pids (and rules that no longer exist).
  for (const key of sustainHits.keys()) {
    if (!activeKeys.has(key)) sustainHits.delete(key);
  }

  return warnings;
}

function fire(rule, proc, value, sustainPolls, deps) {
  const metricLabel = rule.metric === 'cpu'
    ? `${value.toFixed(1)}% CPU`
    : `${value.toFixed(0)} MB`;
  const subject = `${proc.name} (PID ${proc.pid}) at ${metricLabel} for ${sustainPolls} poll${sustainPolls === 1 ? '' : 's'}`;

  let message;
  if (rule.action === 'kill') {
    if (typeof deps.kill === 'function') deps.kill(proc.pid);
    message = `Rule "${rule.pattern}": killed ${subject}`;
  } else if (rule.action === 'command') {
    if (typeof deps.launchCommand === 'function') deps.launchCommand(rule.command, rule.cwd);
    message = `Rule "${rule.pattern}": ran "${rule.command}" — ${subject}`;
  } else {
    message = `Rule "${rule.pattern}": ${subject}`;
  }

  return {
    pid: proc.pid,
    processName: proc.name,
    key: `rule:${rule.id}:${proc.pid}`,
    message,
  };
}

/** Clear all sustain counters (for tests). */
function reset() {
  sustainHits.clear();
}

module.exports = { evaluate, reset };
