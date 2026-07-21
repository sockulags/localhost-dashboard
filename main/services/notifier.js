const { Notification } = require('electron');

const MAX_NOTIFICATIONS_PER_POLL = 3;

let enabled = true;
let previousKeys = null; // null = first poll (skip notifications)
let onClickCallback = null;
let onActionCallback = null;

function warningKey(w) {
  if (w.key) return w.key;
  return `${w.port}:${w.processName}`;
}

/**
 * Escape a string for safe inclusion in XML text nodes and attribute values.
 */
function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the Windows toast XML for a warning notification with a
 * "Kill process" action button. Pure function (no Electron dependency)
 * so it can be unit-tested under plain Node.
 *
 * The button's `arguments` carry the pid (`action=kill&pid=<pid>`, XML-escaped)
 * and the toast body's `launch` carries `action=focus&pid=<pid>` so that, when
 * Electron routes the activation, we can tell the two apart.
 */
function buildToastXml(title, body, pid) {
  const pidNum = Number(pid);
  return (
    `<toast activationType="foreground" launch="${xmlEscape(`action=focus&pid=${pidNum}`)}">` +
    '<visual><binding template="ToastGeneric">' +
    `<text>${xmlEscape(title)}</text>` +
    `<text>${xmlEscape(body)}</text>` +
    '</binding></visual>' +
    '<actions>' +
    `<action content="Kill process" activationType="foreground" arguments="${xmlEscape(`action=kill&pid=${pidNum}`)}"/>` +
    '</actions>' +
    '</toast>'
  );
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

  let title = 'Port conflict detected';
  if (warning.key && warning.key.startsWith('cpu:')) title = 'High CPU usage';
  else if (warning.key && warning.key.startsWith('mem:')) title = 'High memory usage';
  else if (warning.key && warning.key.startsWith('dup:')) title = 'Too many processes';

  // Warnings that point at a single concrete process get a "Kill process"
  // action button where the platform supports it.
  //
  // KNOWN CAVEAT (Windows): Electron's routing of toast *button* activations
  // is unreliable without a registered protocol/AUMID activation handler —
  // the 'action'/'click' events may simply never fire for the button on some
  // setups. We wire every event Electron exposes ('action', plus 'click' for
  // the toast body); if button events do not arrive in practice, the feature
  // degrades gracefully to today's click-to-focus behavior, which is
  // explicitly acceptable. The body click (Electron's 'click' event, fired on
  // toast activation) keeps working as before.
  //
  // A kill button only makes sense for warnings about one concrete process.
  // "dup:" warnings carry a representative pid plus a pids[] array; killing
  // just one of N runaways while confirming "Killed <pid>" would be
  // misleading, so those keep the plain notification.
  const hasPid = Number.isInteger(warning.pid) && warning.pid > 0;
  const killable = hasPid && !(Array.isArray(warning.pids) && warning.pids.length > 1);

  let n;
  if (process.platform === 'win32' && killable) {
    // toastXml replaces {title, body}; the XML carries the same text plus
    // the action button. Body click still emits Electron's 'click' event.
    n = new Notification({
      toastXml: buildToastXml(title, warning.message, warning.pid),
      silent: false,
    });
  } else if (process.platform === 'darwin' && killable) {
    // macOS supports action buttons natively via the `actions` option; the
    // button press arrives as the 'action' event.
    n = new Notification({
      title,
      body: warning.message,
      silent: false,
      actions: [{ type: 'button', text: 'Kill process' }],
    });
  } else {
    // Linux, or warnings without a single concrete pid: plain notification,
    // same as before.
    n = new Notification({
      title,
      body: warning.message,
      silent: false,
    });
  }

  n.on('click', () => {
    if (onClickCallback) {
      onClickCallback(warning.pid);
    }
  });

  // Fires when the user presses the "Kill process" button (macOS 'action';
  // on Windows, only if Electron manages to route the button activation —
  // see caveat above).
  n.on('action', () => {
    if (onActionCallback && killable) {
      onActionCallback(warning.pid);
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

/**
 * Register a callback that is invoked with the PID when the user presses a
 * notification's "Kill process" action button. Mirrors onClick. See the
 * caveat in showNotification: on Windows the button activation may never be
 * routed to us, in which case this callback simply never fires.
 */
function onAction(cb) {
  onActionCallback = cb;
}

module.exports = { notify, setEnabled, isEnabled, onClick, onAction, buildToastXml };
