const { Notification } = require('electron');

const MAX_NOTIFICATIONS_PER_POLL = 3;

let enabled = true;
let previousKeys = null; // null = first poll (skip notifications)
let onClickCallback = null;

function warningKey(w) {
  return `${w.port}:${w.processName}`;
}

/**
 * Compare current warnings against the previous poll and fire desktop
 * notifications for any warnings that are genuinely new.
 */
function notify(warnings) {
  if (!Array.isArray(warnings)) return;

  const currentKeys = new Set(warnings.map(warningKey));

  // On the very first poll, seed the set without sending notifications
  // so the user isn't spammed with pre-existing conflicts on startup.
  if (previousKeys === null) {
    previousKeys = currentKeys;
    return;
  }

  const newWarnings = warnings.filter((w) => !previousKeys.has(warningKey(w)));
  previousKeys = currentKeys;

  // Always track state, but only show notifications when enabled
  if (!enabled || newWarnings.length === 0) return;

  const toShow = newWarnings.slice(0, MAX_NOTIFICATIONS_PER_POLL);
  for (const w of toShow) {
    showNotification(w);
  }

  const remaining = newWarnings.length - toShow.length;
  if (remaining > 0) {
    showSummaryNotification(remaining);
  }
}

function showNotification(warning) {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: 'Port conflict detected',
    body: warning.message,
    silent: false,
  });

  n.on('click', () => {
    if (onClickCallback) {
      onClickCallback(warning.pid);
    }
  });

  n.show();
}

function showSummaryNotification(count) {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title: 'Port conflicts detected',
    body: `${count} more conflict${count > 1 ? 's' : ''} detected. Open the dashboard to review.`,
    silent: true,
  });

  n.on('click', () => {
    if (onClickCallback) {
      onClickCallback(null);
    }
  });

  n.show();
}

function setEnabled(value) {
  enabled = !!value;
}

function isEnabled() {
  return enabled;
}

/**
 * Register a callback that is invoked with the PID when the user clicks
 * a notification.  The main module uses this to show the window and tell
 * the renderer which process to highlight.
 */
function onClick(cb) {
  onClickCallback = cb;
}

module.exports = { notify, setEnabled, isEnabled, onClick };
