/* Profile panel – rendered above the process groups */

// Open log panes, keyed 'profileId:serviceId'. Module-level so the
// open/closed state survives re-renders.
const openServiceLogs = new Set();
// Cached <pre> pane elements per open key. Reused across re-renders so
// pane content persists (no flicker while the async refresh runs).
const serviceLogPanes = new Map();
// Active auto-refresh timers, keyed 'profileId:serviceId'. Cleared on
// every re-render so intervals never leak across renders.
const serviceLogTimers = new Map();
// Container from the latest render, so toggle clicks can re-render.
let currentProfileContainer = null;

function getProfileStatuses(profile) {
  const allProcesses = Object.values(AppState.groups || {}).flatMap((g) => g.processes || []);
  return profile.services.map((service) => {
    let regex = null;
    try { regex = new RegExp(service.pattern, 'i'); } catch { /* invalid regex */ }
    const matches = regex ? allProcesses.filter((p) => regex.test(p.name)) : [];
    return { service, running: matches.length > 0, pids: matches.map((p) => p.pid) };
  });
}

async function startProfile(profile) {
  const services = profile.services.filter((s) => s.command && s.command.trim());
  for (const service of services) {
    await window.api.launchProfileService(profile.id, service.id);
  }
}

async function stopProfile(statuses) {
  const pids = statuses.flatMap((s) => s.pids);
  if (pids.length > 0) {
    await window.api.killProcesses(pids);
  }
}

function renderProfileBadge(running, total) {
  let mod = 'badge-none';
  if (total === 0) mod = 'badge-none';
  else if (running === total) mod = 'badge-all';
  else if (running > 0) mod = 'badge-partial';

  return h('span', { className: `profile-badge ${mod}` }, `${running}/${total}`);
}

function clearServiceLogTimers() {
  for (const timer of serviceLogTimers.values()) clearInterval(timer);
  serviceLogTimers.clear();
}

function paneIsAtBottom(pane) {
  return pane.scrollHeight - pane.scrollTop - pane.clientHeight < 8;
}

async function refreshServiceLogPane(pane, profileId, serviceId) {
  let res;
  try {
    res = await window.api.getServiceLogs(profileId, serviceId);
  } catch {
    return;
  }
  // The pane may have been closed or replaced while awaiting.
  if (!pane.isConnected || !res || !res.success) return;

  const logs = res.logs || [];
  const last = logs[logs.length - 1];
  const sig = logs.length + (last ? `:${last.ts}:${last.line}` : '');
  if (pane.dataset.logSig === sig) return; // nothing new — skip DOM rebuild
  const firstFill = pane.dataset.logSig === undefined;
  pane.dataset.logSig = sig;

  const atBottom = paneIsAtBottom(pane);
  pane.innerHTML = '';
  if (logs.length === 0) {
    pane.appendChild(h('span', { className: 'service-log-empty' }, 'No output captured yet.'));
    return;
  }
  for (const entry of logs) {
    const cls = entry.stream === 'err' ? 'service-log-line service-log-err' : 'service-log-line';
    pane.appendChild(h('span', { className: cls }, entry.line));
    pane.appendChild(document.createTextNode('\n'));
  }
  // Follow the tail unless the user has scrolled up to read history.
  if (atBottom || firstFill) pane.scrollTop = pane.scrollHeight;
}

function renderServiceRow(profile, status) {
  const service = status.service;
  const key = `${profile.id}:${service.id}`;
  const isOpen = openServiceLogs.has(key);

  const chevron = h('button', {
    className: `service-log-toggle ${isOpen ? 'open' : ''}`,
    title: isOpen ? 'Hide logs' : 'Show logs',
    onClick: () => {
      if (openServiceLogs.has(key)) {
        openServiceLogs.delete(key);
        serviceLogPanes.delete(key);
      } else {
        openServiceLogs.add(key);
      }
      renderProfilePanel(currentProfileContainer);
    },
  }, isOpen ? '▾' : '▸');

  const row = h('div', { className: 'profile-service-row' }, [
    chevron,
    h('span', { className: `service-status-dot ${status.running ? 'service-running' : 'service-stopped'}` }),
    h('span', { className: 'profile-service-name' }, service.name || service.id),
  ]);

  const parts = [row];

  if (isOpen) {
    let pane = serviceLogPanes.get(key);
    if (!pane) {
      pane = h('pre', { className: 'service-log-pane' });
      serviceLogPanes.set(key, pane);
    }
    parts.push(pane);
    refreshServiceLogPane(pane, profile.id, service.id);
    const timer = setInterval(() => refreshServiceLogPane(pane, profile.id, service.id), 2000);
    serviceLogTimers.set(key, timer);
  }

  return parts;
}

function renderProfilePanel(container) {
  if (!container) return;
  currentProfileContainer = container;

  // Remember scroll position of open panes across the DOM teardown
  // (detaching an element resets its scroll state).
  const scrollState = new Map();
  for (const [key, pane] of serviceLogPanes) {
    if (pane.isConnected) {
      scrollState.set(key, { top: pane.scrollTop, atBottom: paneIsAtBottom(pane) });
    }
  }

  clearServiceLogTimers();

  const profiles = AppState.profiles || [];
  container.innerHTML = '';
  if (profiles.length === 0) return;

  const panel = h('div', { className: 'profile-panel' });

  for (const profile of profiles) {
    const statuses = getProfileStatuses(profile);
    const running = statuses.filter((s) => s.running).length;
    const total = statuses.length;
    const hasCommands = profile.services.some((s) => s.command && s.command.trim());

    const startBtn = h('button', {
      className: 'btn-profile btn-profile-start',
      title: hasCommands ? 'Start all services' : 'No commands configured (edit in Settings)',
      disabled: !hasCommands,
      onClick: () => startProfile(profile),
    }, '▶ Start');

    const stopBtn = h('button', {
      className: 'btn-profile btn-profile-stop',
      title: 'Stop all running services',
      disabled: running === 0,
      onClick: () => stopProfile(statuses),
    }, '■ Stop');

    const servicesEl = h('div', { className: 'profile-services' },
      statuses.flatMap((status) => renderServiceRow(profile, status)));

    const card = h('div', { className: 'profile-card' }, [
      h('span', { className: 'profile-name' }, profile.name),
      renderProfileBadge(running, total),
      h('div', { className: 'profile-actions' }, [startBtn, stopBtn]),
      servicesEl,
    ]);

    panel.appendChild(card);
  }

  container.appendChild(panel);

  // Restore scroll positions now that the panes are re-attached, and
  // drop cached panes that no longer exist (closed or removed profile).
  for (const [key, pane] of serviceLogPanes) {
    if (!pane.isConnected) {
      serviceLogPanes.delete(key);
      continue;
    }
    const saved = scrollState.get(key);
    if (saved) pane.scrollTop = saved.atBottom ? pane.scrollHeight : saved.top;
  }
}
