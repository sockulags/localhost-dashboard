let si;
try {
  si = require('systeminformation');
} catch {
  si = null;
}

const MOCK_SYSTEM = new Map([
  [1234, { cpu: 12.3, started: Date.now() - 2 * 60 * 60 * 1000 }],
  [1235, { cpu: 7.8, started: Date.now() - 1 * 60 * 60 * 1000 }],
  [2001, { cpu: 3.1, started: Date.now() - 4.5 * 60 * 60 * 1000 }],
  [2050, { cpu: 18.5, started: Date.now() - 30 * 60 * 1000 }],
  [3001, { cpu: 5.2, started: Date.now() - 8 * 60 * 60 * 1000 }],
  [3002, { cpu: 1.0, started: Date.now() - 8 * 60 * 60 * 1000 }],
  [4001, { cpu: 2.4, started: Date.now() - 12 * 60 * 60 * 1000 }],
  [4002, { cpu: 0.5, started: Date.now() - 12 * 60 * 60 * 1000 }],
  [4003, { cpu: 4.7, started: Date.now() - 6 * 60 * 60 * 1000 }],
  [5001, { cpu: 6.1, started: Date.now() - 3 * 60 * 60 * 1000 }],
  [5002, { cpu: 9.3, started: Date.now() - 5 * 60 * 60 * 1000 }],
  [5003, { cpu: 3.8, started: Date.now() - 2 * 60 * 60 * 1000 }],
  [5004, { cpu: 14.2, started: Date.now() - 7 * 60 * 60 * 1000 }],
  [6001, { cpu: 0.2, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6002, { cpu: 0.1, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6003, { cpu: 1.5, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6004, { cpu: 2.0, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6005, { cpu: 0.1, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6006, { cpu: 0.3, started: Date.now() - 24 * 60 * 60 * 1000 }],
  [6007, { cpu: 1.8, started: Date.now() - 24 * 60 * 60 * 1000 }],
]);

async function collect() {
  if (process.platform !== 'win32' || !si) {
    return MOCK_SYSTEM;
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
