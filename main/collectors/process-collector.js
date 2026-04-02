const { execSync } = require('child_process');

const MOCK_PROCESSES = [
  { pid: 1234, name: 'node.exe', memKB: 143360, status: 'Running' },
  { pid: 1235, name: 'node.exe', memKB: 98304, status: 'Running' },
  { pid: 2001, name: 'python.exe', memKB: 67584, status: 'Running' },
  { pid: 2050, name: 'java.exe', memKB: 524288, status: 'Running' },
  { pid: 3001, name: 'dockerd.exe', memKB: 204800, status: 'Running' },
  { pid: 3002, name: 'com.docker.proxy.exe', memKB: 40960, status: 'Running' },
  { pid: 4001, name: 'postgres.exe', memKB: 163840, status: 'Running' },
  { pid: 4002, name: 'redis-server.exe', memKB: 20480, status: 'Running' },
  { pid: 4003, name: 'mongod.exe', memKB: 307200, status: 'Running' },
  { pid: 5001, name: 'Slack.exe', memKB: 307200, status: 'Running' },
  { pid: 5002, name: 'Teams.exe', memKB: 409600, status: 'Running' },
  { pid: 5003, name: 'Spotify.exe', memKB: 204800, status: 'Running' },
  { pid: 5004, name: 'Code.exe', memKB: 358400, status: 'Running' },
  { pid: 6001, name: 'svchost.exe', memKB: 20480, status: 'Running' },
  { pid: 6002, name: 'csrss.exe', memKB: 8192, status: 'Running' },
  { pid: 6003, name: 'explorer.exe', memKB: 81920, status: 'Running' },
  { pid: 6004, name: 'dwm.exe', memKB: 61440, status: 'Running' },
  { pid: 6005, name: 'lsass.exe', memKB: 16384, status: 'Running' },
  { pid: 6006, name: 'RuntimeBroker.exe', memKB: 24576, status: 'Running' },
  { pid: 6007, name: 'SearchHost.exe', memKB: 102400, status: 'Running' },
];

function parseTasklistCSV(output) {
  const processes = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('"Image Name"')) continue;

    // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
    const match = trimmed.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]+)"/);
    if (!match) continue;

    const name = match[1];
    const pid = parseInt(match[2], 10);
    const memStr = match[3].replace(/[, ]/g, '').replace(/K$/i, '');
    const memKB = parseInt(memStr, 10) || 0;

    if (pid === 0) continue;

    processes.push({ pid, name, memKB, status: 'Running' });
  }

  return processes;
}

function collect() {
  if (process.platform !== 'win32') {
    return MOCK_PROCESSES;
  }

  try {
    const output = execSync('tasklist /FO CSV /NH', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    return parseTasklistCSV(output);
  } catch {
    return [];
  }
}

module.exports = { collect };
