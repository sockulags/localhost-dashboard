function containerStateClass(state) {
  switch (state) {
    case 'running': return 'container-running';
    case 'paused': return 'container-paused';
    case 'exited':
    case 'dead': return 'container-exited';
    case 'restarting': return 'container-restarting';
    default: return '';
  }
}

function formatContainerPorts(ports) {
  if (!ports || ports.length === 0) return '\u2014';

  return ports.map((p) => {
    if (p.hostPort) {
      return `${p.hostPort}\u2192${p.containerPort}/${p.protocol}`;
    }
    return `${p.containerPort}/${p.protocol}`;
  }).join(', ');
}

// ── Docker actions state ───────────────────────────────────────
// Log panel state per container id: { gen, loading, logs, error }.
// A closed panel has NO entry — closing deletes it, so re-opening always
// re-fetches. `gen` is a fetch-generation token: a response is only applied
// if the entry still carries the token of the fetch that produced it, so a
// stale in-flight response can never overwrite a newer one.
const containerLogsState = new Map();
let containerLogsFetchGen = 0;
// Container ids with a stop/restart currently in flight (buttons disabled).
const containerActionsInFlight = new Set();

const CONTAINER_LOG_TAIL = 200;

const CONTAINER_ACTIONS = {
  stop: { call: (id) => window.api.dockerStop(id), present: 'stop', past: 'Stopped' },
  restart: { call: (id) => window.api.dockerRestart(id), present: 'restart', past: 'Restarted' },
};

async function runContainerAction(container, actionKey) {
  const id = container.id;
  if (containerActionsInFlight.has(id)) return;

  const action = CONTAINER_ACTIONS[actionKey];
  containerActionsInFlight.add(id);

  const label = container.name || id.substring(0, 12);
  try {
    const result = await action.call(id);
    if (result && result.success) {
      showToast(`${action.past} ${label}`, { type: 'success' });
    } else {
      const reason = (result && result.error) || 'unknown error';
      showToast(`Failed to ${action.present} ${label}: ${reason}`, { type: 'error', duration: 5000 });
    }
  } catch (err) {
    showToast(`Failed to ${action.present} ${label}: ${err.message || err}`, { type: 'error', duration: 5000 });
  } finally {
    containerActionsInFlight.delete(id);
    AppState.notify(); // re-enable the buttons without waiting for the next poll
  }
}

function applyContainerLogsResult(id, gen, result) {
  const entry = containerLogsState.get(id);
  if (!entry || entry.gen !== gen) return; // panel closed, or superseded by a newer fetch

  if (result && result.success) {
    containerLogsState.set(id, { gen, loading: false, logs: result.logs || '', error: null });
  } else {
    const reason = (result && result.error) || 'Could not retrieve logs';
    containerLogsState.set(id, { gen, loading: false, logs: '', error: reason });
  }
  AppState.notify();
}

function fetchContainerLogs(id) {
  const gen = ++containerLogsFetchGen;
  containerLogsState.set(id, { gen, loading: true, logs: '', error: null });
  AppState.notify();

  window.api.dockerLogs(id, CONTAINER_LOG_TAIL)
    .then((result) => applyContainerLogsResult(id, gen, result))
    .catch((err) => applyContainerLogsResult(id, gen, { success: false, error: err.message || String(err) }));
}

function toggleContainerLogs(id) {
  if (containerLogsState.has(id)) {
    containerLogsState.delete(id);
    AppState.notify();
    return;
  }
  // (Re-)open: always fetch fresh logs.
  fetchContainerLogs(id);
}

function renderContainerActions(container) {
  const inFlight = containerActionsInFlight.has(container.id);
  const logsOpen = containerLogsState.has(container.id);
  const label = container.name || container.id.substring(0, 12);

  const stopBtn = h('button', {
    className: 'btn-profile btn-profile-stop',
    title: `Stop ${label}`,
  }, 'Stop');
  const restartBtn = h('button', {
    className: 'btn-profile btn-container-restart',
    title: `Restart ${label}`,
  }, 'Restart');
  stopBtn.disabled = inFlight;
  restartBtn.disabled = inFlight;

  const onAction = (actionKey) => (e) => {
    e.stopPropagation();
    // Disable immediately; rebuilt rows re-derive this from the in-flight set.
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    runContainerAction(container, actionKey);
  };
  stopBtn.addEventListener('click', onAction('stop'));
  restartBtn.addEventListener('click', onAction('restart'));

  const logsBtn = h('button', {
    className: `btn-profile btn-container-logs ${logsOpen ? 'logs-open' : ''}`,
    title: `Show last ${CONTAINER_LOG_TAIL} log lines for ${label}`,
  }, 'Logs');
  logsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleContainerLogs(container.id);
  });

  return h('div', { className: 'container-actions' }, [stopBtn, restartBtn, logsBtn]);
}

// ── Container log row (expandable, reconciler key `ctl:<id>`) ──
function containerLogSignature(entry) {
  if (!entry) return 'none';
  return `${entry.gen}:${entry.loading ? 'loading' : entry.error ? 'error' : 'done'}`;
}

function populateContainerLogRow(tr, container) {
  const entry = containerLogsState.get(container.id);
  const sig = containerLogSignature(entry);
  // Logs are immutable once fetched — skip the rebuild on poll ticks so the
  // <pre> keeps its scroll position and text selection.
  if (tr.__logSig === sig) return;
  tr.__logSig = sig;

  tr.innerHTML = '';
  const td = h('td', { className: 'detail-cell' });
  td.setAttribute('colspan', '6');

  if (!entry || entry.loading) {
    td.appendChild(h('div', { className: 'detail-panel' }, [
      h('span', { className: 'detail-loading' }, 'Loading logs...'),
    ]));
  } else if (entry.error) {
    td.appendChild(h('div', { className: 'detail-panel' }, [
      h('span', { className: 'detail-error' }, `Could not retrieve logs: ${entry.error}`),
    ]));
  } else {
    td.appendChild(h('div', { className: 'detail-panel' }, [
      h('pre', { className: 'container-logs-pre' }, entry.logs || '(no log output)'),
    ]));
  }
  tr.appendChild(td);
}

function buildContainerLogRow(container) {
  const tr = h('tr', { className: 'detail-row container-log-row' });
  tr.addEventListener('click', (e) => e.stopPropagation());
  populateContainerLogRow(tr, container);
  return tr;
}

function containerThead() {
  return h('thead', {}, [
    h('tr', {}, [
      h('th', { className: 'col-container-name' }, 'Name'),
      h('th', { className: 'col-container-image' }, 'Image'),
      h('th', { className: 'col-container-status' }, 'Status'),
      h('th', { className: 'col-container-ports' }, 'Ports'),
      h('th', { className: 'col-container-id' }, 'ID'),
      h('th', { className: 'col-container-actions' }, ''),
    ]),
  ]);
}

function populateContainerRow(tr, container) {
  tr.innerHTML = '';
  const stateClass = containerStateClass(container.state);
  tr.appendChild(h('td', { className: 'col-container-name', title: container.name }, container.name));
  tr.appendChild(h('td', { className: 'col-container-image', title: container.image }, container.image));
  tr.appendChild(h('td', { className: `col-container-status ${stateClass}` }, [
    h('span', { className: `container-state-dot ${stateClass}` }, ''),
    h('span', {}, container.status),
  ]));
  tr.appendChild(h('td', { className: 'col-container-ports' }, formatContainerPorts(container.ports)));
  tr.appendChild(h('td', { className: 'col-container-id' }, container.id.substring(0, 12)));
  tr.appendChild(h('td', { className: 'col-container-actions' }, [renderContainerActions(container)]));
}

function buildContainerRow(container) {
  const tr = h('tr', {});
  populateContainerRow(tr, container);
  return tr;
}

// Build a persistent container section (header + table) for the reconciler.
function buildContainerSection() {
  const header = h('div', { className: 'group-header' }, [
    h('span', { className: 'group-toggle' }, '\u25BC'),
    h('span', { className: 'group-icon' }, '\uD83D\uDC33'),
    h('span', { className: 'group-name' }, 'Containers'),
    h('span', { className: 'group-count' }, ''),
    h('span', { className: 'group-stats' }, [h('span', {}, '')]),
  ]);
  header.addEventListener('click', () => AppState.toggleGroup('_containers'));

  const tbody = h('tbody', {});
  const table = h('table', { className: 'process-table container-table' }, [containerThead(), tbody]);
  const body = h('div', { className: 'group-body' }, [table]);

  const section = h('div', { className: 'process-group group-containers' }, [header, body]);
  return section;
}

function updateContainerSection(section, containers) {
  const isCollapsed = AppState.isCollapsed('_containers');
  const runningCount = containers.filter((c) => c.state === 'running').length;

  const header = section.querySelector('.group-header');
  header.querySelector('.group-toggle').className = `group-toggle ${isCollapsed ? 'collapsed' : ''}`;
  header.querySelector('.group-count').textContent = `${containers.length}`;
  header.querySelector('.group-stats').firstChild.textContent = `${runningCount} running`;

  const body = section.querySelector('.group-body');
  body.classList.toggle('collapsed', isCollapsed);

  if (containerLogsState.size > 0) {
    if (isCollapsed) {
      // Collapsing removes the log rows; drop their state so re-expanding
      // never shows a stale snapshot (re-opening re-fetches).
      containerLogsState.clear();
    } else {
      // Prune log-panel state for containers that no longer exist.
      const liveIds = new Set(containers.map((c) => c.id));
      for (const id of containerLogsState.keys()) {
        if (!liveIds.has(id)) containerLogsState.delete(id);
      }
    }
  }

  const tbody = section.querySelector('tbody');
  const items = [];
  if (!isCollapsed) {
    for (const c of containers) {
      items.push({
        key: `ct:${c.id}`,
        create: () => buildContainerRow(c),
        update: (el) => populateContainerRow(el, c),
      });
      if (containerLogsState.has(c.id)) {
        items.push({
          key: `ctl:${c.id}`,
          create: () => buildContainerLogRow(c),
          update: (el) => populateContainerLogRow(el, c),
        });
      }
    }
  }
  reconcileChildren(tbody, items);
}
