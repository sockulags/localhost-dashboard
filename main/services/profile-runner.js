const { spawn } = require('child_process');

function launchCommand(command, cwd) {
  if (!command || typeof command !== 'string' || !command.trim()) {
    return { success: false, error: 'No command specified' };
  }

  try {
    const shell = process.platform === 'win32' ? 'cmd' : 'sh';
    const flag  = process.platform === 'win32' ? '/c' : '-c';
    const child = spawn(shell, [flag, command.trim()], {
      cwd: (cwd && cwd.trim()) ? cwd.trim() : undefined,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { launchCommand };
