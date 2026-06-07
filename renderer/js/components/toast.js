/**
 * Lightweight toast notifications, including a "delayed action with Undo"
 * pattern used for kills: the action is scheduled, a countdown toast appears,
 * and the action only commits if the user doesn't click Undo in time.
 */

function getToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = h('div', { id: 'toast-container' });
    document.body.appendChild(container);
  }
  return container;
}

function dismissToast(toast) {
  if (!toast || toast.__dismissed) return;
  toast.__dismissed = true;
  toast.classList.add('toast-leaving');
  setTimeout(() => toast.remove(), 200);
}

/**
 * Simple informational toast that auto-dismisses.
 * @param {string} message
 * @param {{ type?: 'info'|'success'|'error', duration?: number }} [opts]
 */
function showToast(message, opts = {}) {
  const type = opts.type || 'info';
  const duration = opts.duration || 3000;

  const toast = h('div', { className: `toast toast-${type}` }, [
    h('span', { className: 'toast-message' }, message),
  ]);

  getToastContainer().appendChild(toast);
  setTimeout(() => dismissToast(toast), duration);
  return toast;
}

/**
 * Schedule an action that the user can cancel via an Undo button before a
 * countdown elapses. Returns nothing — fully self-managing.
 *
 * @param {string} message      e.g. "Killing node.exe (PID 1234)"
 * @param {() => (Promise<any>|any)} commit  Runs if not undone.
 * @param {{ delay?: number, onError?: (err: any) => void }} [opts]
 */
function showUndoToast(message, commit, opts = {}) {
  const delay = opts.delay || 5000;
  let remaining = Math.ceil(delay / 1000);
  let cancelled = false;

  const countdownEl = h('span', { className: 'toast-countdown' }, `${remaining}s`);
  const undoBtn = h('button', { className: 'toast-undo' }, 'Undo');

  const toast = h('div', { className: 'toast toast-pending' }, [
    h('span', { className: 'toast-message' }, message),
    countdownEl,
    undoBtn,
  ]);

  getToastContainer().appendChild(toast);

  const tick = setInterval(() => {
    remaining -= 1;
    countdownEl.textContent = `${Math.max(0, remaining)}s`;
  }, 1000);

  const timer = setTimeout(async () => {
    clearInterval(tick);
    if (cancelled) return;
    dismissToast(toast);
    try {
      const result = await commit();
      if (result && result.success === false) {
        showToast(`Failed: ${result.error || 'unknown error'}`, { type: 'error', duration: 5000 });
        if (opts.onError) opts.onError(result.error);
      }
    } catch (err) {
      showToast(`Failed: ${err.message || err}`, { type: 'error', duration: 5000 });
      if (opts.onError) opts.onError(err);
    }
  }, delay);

  undoBtn.addEventListener('click', () => {
    cancelled = true;
    clearTimeout(timer);
    clearInterval(tick);
    dismissToast(toast);
  });
}
