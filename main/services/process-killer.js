const { execSync } = require('child_process');

// Map a taskkill/kill failure to a user-friendly message. Shared by kill()
// and killTree() so their error classification never drifts apart.
function classifyKillError(err) {
  const msg = err.stderr || err.message || 'Unknown error';
  if (/access.denied|permission denied|operation not permitted/i.test(msg)) {
    return 'Access denied — try running with elevated privileges';
  }
  if (/not found|no such process/i.test(msg)) {
    return 'Process no longer exists';
  }
  return msg.trim();
}

function kill(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { success: false, error: 'Invalid PID' };
  }

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /F`, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
    } else {
      execSync(`kill -9 ${pid}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: classifyKillError(err) };
  }
}

function killMultiple(pids) {
  if (!Array.isArray(pids) || pids.length === 0) {
    return { success: false, error: 'No PIDs provided', results: [] };
  }

  const results = pids.map((pid) => ({
    pid,
    ...kill(pid),
  }));

  const failed = results.filter((r) => !r.success);
  return {
    success: failed.length === 0,
    total: pids.length,
    killed: pids.length - failed.length,
    failed: failed.length,
    results,
  };
}

// Parse `ps -eo pid,ppid` output into a Map of ppid -> [child pids].
function buildChildMap(psOutput) {
  const childrenOf = new Map();
  for (const line of psOutput.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    const ppid = parseInt(match[2], 10);
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }
  return childrenOf;
}

// Collect all descendants of `pid` breadth-first (parents before children).
function collectDescendants(pid, childrenOf) {
  const descendants = [];
  const seen = new Set([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of childrenOf.get(current) || []) {
      if (seen.has(child)) continue; // guard against pid cycles
      seen.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

// Kill a process and its whole descendant tree.
// Returns { success, killed: [pids], failed: [pids], error? }.
function killTree(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { success: false, killed: [], failed: [], error: 'Invalid PID' };
  }

  if (process.platform === 'win32') {
    // taskkill /T terminates the entire tree in one call.
    try {
      const stdout = execSync(`taskkill /PID ${pid} /T /F`, {
        encoding: 'utf-8',
        timeout: 10000,
        windowsHide: true,
      });
      // taskkill prints one "SUCCESS: ... PID <n> ..." line per process it
      // terminated — parse them so the caller can report a real count.
      // (On localized Windows the marker may not match; fall back to the root.)
      const killed = [];
      for (const m of stdout.matchAll(/SUCCESS[^\r\n]*?\bPID (\d+)/gi)) {
        killed.push(parseInt(m[1], 10));
      }
      if (killed.length === 0) killed.push(pid);
      return { success: true, killed, failed: [] };
    } catch (err) {
      return { success: false, killed: [], failed: [pid], error: classifyKillError(err) };
    }
  }

  // Unix: discover descendants via ps, then kill leaves-first so children
  // never get a chance to be reparented mid-teardown, root last.
  let childrenOf;
  try {
    const psOutput = execSync('ps -eo pid,ppid', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    childrenOf = buildChildMap(psOutput);
  } catch (err) {
    return { success: false, killed: [], failed: [], error: err.message || 'Failed to list processes' };
  }

  const descendants = collectDescendants(pid, childrenOf);
  const order = [...descendants].reverse(); // deepest first
  order.push(pid); // root last

  const killed = [];
  const failed = [];
  let firstError;
  for (const target of order) {
    const result = kill(target);
    if (result.success) {
      killed.push(target);
    } else if (result.error === 'Process no longer exists') {
      // Already gone (e.g. died with its parent) — treat as killed.
      killed.push(target);
    } else {
      failed.push(target);
      if (!firstError) firstError = result.error;
    }
  }

  return {
    success: failed.length === 0,
    killed,
    failed,
    ...(firstError ? { error: firstError } : {}),
  };
}

module.exports = { kill, killMultiple, killTree, buildChildMap, collectDescendants };
