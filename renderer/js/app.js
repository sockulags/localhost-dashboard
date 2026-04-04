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

function render() {
  const container = document.getElementById('process-groups');
  const groups = AppState.getFilteredGroups();

  // Rebuild the group containers
  container.innerHTML = '';

  // Profile panel (top of the list)
  const profileContainer = document.getElementById('profile-panel-container');
  if (profileContainer) {
    renderProfilePanel(profileContainer);
  }

  let hasAny = false;

  for (const key of GROUP_ORDER) {
    const group = groups[key];
    if (!group) continue;

    // Skip empty groups when filtering
    if (AppState.filter && group.processes.length === 0) continue;

    hasAny = true;
    const isCollapsed = AppState.isCollapsed(key);

    const section = h('div', { className: `process-group group-${key}` });
    section.appendChild(renderGroupHeader(group, isCollapsed));

    const body = h('div', { className: `group-body ${isCollapsed ? 'collapsed' : ''}` });

    if (group.processes.length > 0) {
      body.appendChild(renderProcessTable(group.processes));
    }

    // Set max-height for animation when not collapsed
    if (!isCollapsed && group.processes.length > 0) {
      const hasExpanded = group.processes.some((p) => AppState.isExpanded(p.pid));
      if (hasExpanded) {
        // Disable max-height constraint when detail rows are present
        body.style.maxHeight = 'none';
      } else {
        body.style.maxHeight = `${group.processes.length * 34 + 30}px`;
      }
    }

    section.appendChild(body);
    container.appendChild(section);

    // Render Docker containers section right after the docker process group
    if (key === 'docker' && AppState.containers && AppState.containers.length > 0) {
      hasAny = true;
      const containerSection = renderContainerSection(AppState.containers);
      if (containerSection) {
        container.appendChild(containerSection);
      }
    }
  }

  if (!hasAny) {
    container.appendChild(
      h('div', { className: 'no-processes' }, 'No processes found')
    );
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

  // Expand all groups so the process is visible
  for (const key of GROUP_ORDER) {
    if (AppState.isCollapsed(key)) {
      AppState.collapsedGroups.delete(key);
    }
  }
  AppState.notify();

  const safePid = Number(pid);
  if (!Number.isFinite(safePid)) return;

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
  } catch {
    // Config not available yet — use defaults
    AppState.profiles = [];
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

    const newInterval = (cfg.pollInterval || 3) * 1000;
    if (newInterval !== pollInterval) {
      pollInterval = newInterval;
      startPolling();
    }
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
