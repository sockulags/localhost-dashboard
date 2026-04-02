const { execSync } = require('child_process');

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
    const msg = err.stderr || err.message || 'Unknown error';
    if (/access.denied|permission denied|operation not permitted/i.test(msg)) {
      return { success: false, error: 'Access denied — try running with elevated privileges' };
    }
    if (/not found|no such process/i.test(msg)) {
      return { success: false, error: 'Process no longer exists' };
    }
    return { success: false, error: msg.trim() };
  }
}

module.exports = { kill };
