const { execSync } = require('child_process');

function kill(pid) {
  if (typeof pid !== 'number' || pid <= 0) {
    return { success: false, error: 'Invalid PID' };
  }

  if (process.platform !== 'win32') {
    // Mock kill on non-Windows
    console.log(`[Mock] Would kill PID ${pid}`);
    return { success: true };
  }

  try {
    execSync(`taskkill /PID ${pid} /F`, {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    return { success: true };
  } catch (err) {
    const msg = err.stderr || err.message || 'Unknown error';
    if (/access.denied/i.test(msg)) {
      return { success: false, error: 'Access denied — run as administrator' };
    }
    if (/not found/i.test(msg)) {
      return { success: false, error: 'Process no longer exists' };
    }
    return { success: false, error: msg.trim() };
  }
}

module.exports = { kill };
