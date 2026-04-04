function findProcessesOnPort(port) {
  const results = [];
  for (const group of Object.values(AppState.groups)) {
    for (const proc of group.processes) {
      if (proc.ports && proc.ports.includes(port)) {
        results.push(proc);
      }
    }
  }
  return results;
}

let activeMenu = null;

function showContextMenu(x, y, proc) {
  hideContextMenu();

  const items = [
    {
      label: 'Kill Process',
      icon: '\u00D7',
      className: 'context-item-danger',
      action: () => showKillConfirm(proc.pid, proc.name),
    },
    { separator: true },
    {
      label: 'Copy PID',
      icon: '#',
      action: () => navigator.clipboard.writeText(String(proc.pid)),
    },
  ];

  if (proc.ports && proc.ports.length > 0) {
    items.push({
      label: 'Copy Port',
      icon: ':',
      action: () => navigator.clipboard.writeText(proc.ports.join(', ')),
    });

    // "Kill all on port X" for each port this process listens on
    for (const port of proc.ports) {
      const procsOnPort = findProcessesOnPort(port);
      items.push({
        label: `Kill All on :${port}`,
        icon: '\u00D7',
        className: 'context-item-danger',
        action: () => {
          showBatchKillConfirm(
            `Kill all ${procsOnPort.length} process(es) on port ${port}?`,
            procsOnPort,
            (pids) => window.api.killProcesses(pids)
          );
        },
      });
    }
  }

  items.push({ separator: true });
  items.push({
    label: 'Open File Location',
    icon: '\u2192',
    action: async () => {
      const result = await window.api.openFileLocation(proc.pid);
      if (!result.success) {
        showError(result.error);
      }
    },
  });

  const menu = h('div', { className: 'context-menu' }, buildMenuItems(items));

  document.body.appendChild(menu);
  activeMenu = menu;

  // Position: ensure menu stays within viewport
  const rect = menu.getBoundingClientRect();
  const winW = window.innerWidth;
  const winH = window.innerHeight;

  const left = (x + rect.width > winW) ? winW - rect.width - 4 : x;
  const top = (y + rect.height > winH) ? winH - rect.height - 4 : y;

  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  // Close handlers (deferred so the current event doesn't immediately close)
  requestAnimationFrame(() => {
    document.addEventListener('click', onCloseContextMenu, { once: true });
    document.addEventListener('contextmenu', onCloseContextMenu, { once: true });
    document.addEventListener('keydown', onEscapeContextMenu);
    document.getElementById('process-groups')
      .addEventListener('scroll', onScrollCloseContextMenu, { once: true });
  });
}

function buildMenuItems(items) {
  return items.map((item) => {
    if (item.separator) {
      return h('div', { className: 'context-separator' });
    }

    const el = h('div', { className: `context-item ${item.className || ''}` }, [
      h('span', { className: 'context-icon' }, item.icon),
      h('span', {}, item.label),
    ]);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      item.action();
    });

    return el;
  });
}

function hideContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  document.removeEventListener('click', onCloseContextMenu);
  document.removeEventListener('contextmenu', onCloseContextMenu);
  document.removeEventListener('keydown', onEscapeContextMenu);
  const groups = document.getElementById('process-groups');
  if (groups) {
    groups.removeEventListener('scroll', onScrollCloseContextMenu);
  }
}

function onCloseContextMenu() {
  hideContextMenu();
}

function onEscapeContextMenu(e) {
  if (e.key === 'Escape') {
    hideContextMenu();
  }
}

function onScrollCloseContextMenu() {
  hideContextMenu();
}
