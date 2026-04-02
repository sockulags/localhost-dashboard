let si;
try {
  si = require('systeminformation');
} catch {
  si = null;
}

async function collect() {
  if (!si) {
    return new Map();
  }

  try {
    const data = await si.processes();
    const map = new Map();
    for (const proc of data.list) {
      map.set(proc.pid, {
        cpu: proc.cpu || 0,
        started: proc.started ? new Date(proc.started).getTime() : Date.now(),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

module.exports = { collect };
