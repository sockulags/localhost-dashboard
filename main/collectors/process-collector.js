const { execSync } = require('child_process');

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

function parsePsOutput(output) {
  const processes = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('PID')) continue;

    // ps output format: PID  RSS  COMMAND
    const match = trimmed.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const memKB = parseInt(match[2], 10) || 0;
    const cmdline = match[3].trim();

    if (pid === 0) continue;

    // Extract process name from command path
    const cmdPath = cmdline.split(/\s/)[0];
    const name = cmdPath.split('/').pop() || cmdPath;

    processes.push({ pid, name, memKB, status: 'Running' });
  }

  return processes;
}

function collect() {
  if (process.platform === 'win32') {
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

  // Linux and macOS: use ps
  try {
    const output = execSync('ps -eo pid,rss,comm --no-headers', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return parsePsOutput(output);
  } catch {
    // macOS ps doesn't support --no-headers, fall back
    try {
      const output = execSync('ps -eo pid,rss,comm', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return parsePsOutput(output);
    } catch {
      return [];
    }
  }
}

module.exports = { collect };
