let notificationsEnabled = true;

// Load initial state from main process
window.api.getNotificationsEnabled().then((val) => {
  notificationsEnabled = val;
});

// Sync when settings panel changes notification config
window.addEventListener('config-changed', (e) => {
  notificationsEnabled = e.detail.notifications;
});

function renderStatusBar() {
  const bar = document.getElementById('status-bar');
  const warningCount = AppState.warnings.length;
  const elapsed = AppState.lastUpdated
    ? Math.round((Date.now() - AppState.lastUpdated) / 1000)
    : null;

  const warningText = warningCount > 0
    ? `⚠ ${warningCount} warning${warningCount > 1 ? 's' : ''}`
    : '✓ No warnings';

  const warningClass = warningCount > 0 ? 'status-warnings' : '';

  const notifLabel = notificationsEnabled ? '🔔 Notifications' : '🔕 Notifications';
  const notifBtn = h('button', {
    className: `notif-toggle ${notificationsEnabled ? 'notif-on' : 'notif-off'}`,
    title: notificationsEnabled ? 'Disable notifications' : 'Enable notifications',
  }, notifLabel);

  notifBtn.addEventListener('click', async () => {
    notificationsEnabled = await window.api.setNotificationsEnabled(!notificationsEnabled);
    renderStatusBar();
  });

  bar.innerHTML = '';
  bar.appendChild(
    h('div', { className: 'status-section' }, [
      h('span', { className: warningClass }, warningText),
      h('span', {}, `${AppState.totalProcesses} processes`),
    ])
  );
  bar.appendChild(
    h('div', { className: 'status-section' }, [
      notifBtn,
      h('span', {}, elapsed !== null ? `Last refresh: ${elapsed}s ago` : 'Loading...'),
    ])
  );
}
