let pollInterval = 3000; // will be overridden by config
let pollTimer = null;
const GROUP_ORDER = ['dev', 'docker', 'databases', 'apps', 'system'];

let refreshTimer = null;

async function poll() {
  try {
    const data = await window.api.getProcesses();
    AppState.update(data);
  } catch (err) {
    console.error('Poll failed:', err);
  }
}

function buildGroupSection(key, group) {
  const header = h('div', { className: 'group-header' });
  const tbody = h('tbody', {});
  const table = h('table', { className: 'process-table' }, [h('thead', {}), tbody]);
  const body = h('div', { className: 'group-body' }, [table]);
  const section = h('div', { className: `process-group group-${key}` }, [header, body]);
  updateGroupSection(section, key, group);
  return section;
}

function updateGroupSection(section, key, group) {
  const collapsed = AppState.isCollapsed(key);

  // Rebuild the header each tick so its stats, count and group-actions menu
  // reflect current data. It carries no state worth preserving.
  section.replaceChild(renderGroupHeader(group, collapsed), section.firstChild);

  const body = section.lastChild;
  body.classList.toggle('collapsed', collapsed);

  const table = body.firstChild;
  table.replaceChild(buildProcessThead(), table.firstChild);

  const tbody = table.lastChild;
  reconcileChildren(tbody, collapsed ? [] : buildGroupRowItems(group, key));
}

function render() {
  // Profile panel (top of the list) — managed independently.
  const profileContainer = document.getElementById('profile-panel-container');
  if (profileContainer) {
    renderProfilePanel(profileContainer);
  }

  const container = document.getElementById('process-groups');
  const groups = AppState.getFilteredGroups();
  const isFiltering = !!AppState.filter || AppState.quickFilter !== 'all';

  const sectionItems = [];
  for (const key of GROUP_ORDER) {
    const group = groups[key];
    if (!group) continue;

    // Skip groups that are empty under an active filter.
    if (isFiltering && group.processes.length === 0) continue;

    sectionItems.push({
      key: `g:${key}`,
      create: () => buildGroupSection(key, group),
      update: (el) => updateGroupSection(el, key, group),
    });

    // Docker containers section sits right after the docker process group.
    if (key === 'docker' && AppState.containers && AppState.containers.length > 0) {
      const containers = AppState.containers;
      sectionItems.push({
        key: 'g:_containers',
        create: () => buildContainerSection(),
        update: (el) => updateContainerSection(el, containers),
      });
    }
  }

  // Drop any leftover empty-state placeholder before reconciling.
  const placeholder = container.querySelector('.no-processes');
  if (placeholder) placeholder.remove();

  if (sectionItems.length === 0) {
    container.innerHTML = '';
    container.appendChild(h('div', { className: 'no-processes' }, 'No processes found'));
  } else {
    reconcileChildren(container, sectionItems);
  }

  renderStatusBar();
}

// Update "last refresh" timer every second
function startRefreshTimer() {
  refreshTimer = setInterval(() => {
    if (AppState.lastUpdated) {
      renderStatusBar();
    }
  }, 1000);
}

function scrollToProcess(pid) {
  if (pid == null) return; // summary notification, just show the window

  const safePid = Number(pid);
  if (!Number.isFinite(safePid)) return;

  // Expand all groups so the process is visible
  for (const key of GROUP_ORDER) {
    if (AppState.isCollapsed(key)) {
      AppState.collapsedGroups.delete(key);
    }
  }

  // If the process is hidden inside a collapsed cluster, expand that cluster too.
  for (const [gkey, g] of Object.entries(AppState.groups)) {
    const found = g.processes.find((p) => p.pid === safePid);
    if (found) {
      const sameName = g.processes.filter((p) => p.name === found.name).length;
      if (AppState.clusterMode && sameName >= CLUSTER_MIN) {
        AppState.expandedClusters.add(`c:${gkey}:${found.name}`);
      }
      break;
    }
  }

  AppState.notify();

  // Allow a frame for the DOM to update, then scroll & highlight
  requestAnimationFrame(() => {
    const row = document.querySelector(`tr[data-pid="${safePid}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('highlight-row');
    setTimeout(() => row.classList.remove('highlight-row'), 3000);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'dark');
}

const QUICK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'port', label: 'With port' },
  { id: 'idle', label: 'Idle' },
];

function renderChips() {
  const bar = document.getElementById('filter-chips');
  if (!bar) return;
  bar.innerHTML = '';
  for (const chip of QUICK_FILTERS) {
    const active = AppState.quickFilter === chip.id;
    const btn = h('button', { className: `chip ${active ? 'chip-active' : ''}` }, chip.label);
    btn.addEventListener('click', () => {
      AppState.setQuickFilter(chip.id);
      renderChips();
    });
    bar.appendChild(btn);
  }
}

const ICON_MAXIMIZE =
  '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3.25" y="3.25" width="7.5" height="7.5" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
const ICON_RESTORE =
  '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="4.7" width="6.3" height="6.3" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 4.7 V3.4 A1.1 1.1 0 0 1 6.3 2.3 H10.6 A1.1 1.1 0 0 1 11.7 3.4 V7.7 A1.1 1.1 0 0 1 10.6 8.8 H9.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

function setupWindowControls() {
  const minBtn = document.getElementById('win-min');
  const maxBtn = document.getElementById('win-max');
  const closeBtn = document.getElementById('win-close');
  if (!minBtn || !maxBtn || !closeBtn || !window.api.windowMinimize) return;

  const setMaxIcon = (isMax) => {
    maxBtn.innerHTML = isMax ? ICON_RESTORE : ICON_MAXIMIZE;
    maxBtn.title = isMax ? 'Restore' : 'Maximize';
  };

  minBtn.addEventListener('click', () => window.api.windowMinimize());
  closeBtn.addEventListener('click', () => window.api.windowClose());
  maxBtn.addEventListener('click', async () => {
    const isMax = await window.api.windowMaximizeToggle();
    setMaxIcon(isMax);
  });

  window.api.onWindowState(setMaxIcon);
  window.api.windowIsMaximized().then(setMaxIcon).catch(() => {});

  // Double-clicking the empty title-bar area toggles maximize (standard behavior).
  const header = document.querySelector('.app-header');
  if (header) {
    header.addEventListener('dblclick', (e) => {
      if (e.target.closest('.header-controls')) return;
      window.api.windowMaximizeToggle();
    });
  }
}

function updateClusterBtn() {
  const btn = document.getElementById('cluster-btn');
  if (!btn) return;
  btn.classList.toggle('active', AppState.clusterMode);
  btn.title = AppState.clusterMode
    ? 'Identical processes grouped — click to show all'
    : 'Click to group identical processes';
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, pollInterval);
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  AppState.subscribe(render);

  // Load config and apply initial settings
  try {
    const cfg = await window.api.getConfig();
    pollInterval = (cfg.pollInterval || 3) * 1000;
    applyTheme(cfg.theme);
    AppState.profiles = cfg.profiles || [];
    AppState.setPinned(cfg.pinnedNames || []);
    AppState.clusterMode = cfg.clusterProcesses !== false;
  } catch {
    // Config not available yet — use defaults
    AppState.profiles = [];
  }

  setupWindowControls();
  renderChips();
  updateClusterBtn();

  // Cluster toggle button
  const clusterBtn = document.getElementById('cluster-btn');
  if (clusterBtn) {
    clusterBtn.addEventListener('click', () => {
      const val = AppState.toggleClusterMode();
      updateClusterBtn();
      window.api.setConfig('clusterProcesses', val);
    });
  }

  // Filter input
  const filterInput = document.getElementById('filter-input');
  filterInput.addEventListener('input', (e) => {
    AppState.setFilter(e.target.value);
  });

  // Settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
  }

  // Export button
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => window.api.exportSnapshot());
  }

  // Listen for config changes from the settings panel
  window.addEventListener('config-changed', (e) => {
    const cfg = e.detail;
    applyTheme(cfg.theme);
    AppState.profiles = cfg.profiles || [];
    AppState.setPinned(cfg.pinnedNames || []);
    AppState.clusterMode = cfg.clusterProcesses !== false;
    updateClusterBtn();

    const newInterval = (cfg.pollInterval || 3) * 1000;
    if (newInterval !== pollInterval) {
      pollInterval = newInterval;
      startPolling();
    }

    AppState.notify();
  });

  // Listen for notification clicks
  window.api.onScrollToProcess(scrollToProcess);

  // Global keyboard shortcuts
  document.addEventListener('keydown', handleGlobalKeys);

  // Start polling
  startPolling();
  startRefreshTimer();
});

function handleGlobalKeys(e) {
  const filterInput = document.getElementById('filter-input');
  const isTyping = document.activeElement && (
    document.activeElement.tagName === 'INPUT' ||
    document.activeElement.tagName === 'TEXTAREA' ||
    document.activeElement.tagName === 'SELECT'
  );

  // Escape clears filter and blurs the input
  if (e.key === 'Escape' && document.activeElement === filterInput) {
    filterInput.value = '';
    AppState.setFilter('');
    filterInput.blur();
    e.preventDefault();
    return;
  }

  // Ctrl/Cmd+E — export snapshot
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
    e.preventDefault();
    window.api.exportSnapshot().then((r) => {
      if (r && r.success) console.log('Snapshot exported:', r.path);
    });
    return;
  }

  // Ctrl/Cmd+, — open settings
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    openSettings();
    return;
  }

  // "/" focuses the filter (when not already typing somewhere)
  if (e.key === '/' && !isTyping) {
    e.preventDefault();
    filterInput.focus();
    filterInput.select();
  }
}
