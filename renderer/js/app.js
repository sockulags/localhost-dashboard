const POLL_INTERVAL = 3000;
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

// Init
document.addEventListener('DOMContentLoaded', () => {
  AppState.subscribe(render);

  // Filter input
  const filterInput = document.getElementById('filter-input');
  filterInput.addEventListener('input', (e) => {
    AppState.setFilter(e.target.value);
  });

  // Listen for notification clicks
  window.api.onScrollToProcess(scrollToProcess);

  // Start polling
  poll();
  setInterval(poll, POLL_INTERVAL);
  startRefreshTimer();
});
