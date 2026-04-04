function renderGroupHeader(group, isCollapsed) {
  const toggle = h('span', { className: `group-toggle ${isCollapsed ? 'collapsed' : ''}` }, '▼');
  const icon = h('span', { className: 'group-icon' }, group.icon);
  const name = h('span', { className: 'group-name' }, group.label);
  const count = h('span', { className: 'group-count' }, `(${group.processes.length})`);
  const stats = h('span', { className: 'group-stats' }, [
    h('span', {}, `CPU ${group.totalCpu.toFixed(1)}%`),
    h('span', {}, formatBytes(group.totalMemKB)),
  ]);

  const actionsBtn = h('button', { className: 'group-actions-btn', title: 'Group actions' }, '\u22EE');
  actionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showGroupActionsMenu(e.clientX, e.clientY, group);
  });

  const header = h('div', { className: 'group-header' }, [toggle, icon, name, count, stats, actionsBtn]);

  header.addEventListener('click', () => {
    AppState.toggleGroup(group.key);
  });

  return header;
}

function showGroupActionsMenu(x, y, group) {
  hideContextMenu();

  const items = [
    {
      label: `Kill All ${group.label}`,
      icon: '\u00D7',
      className: 'context-item-danger',
      action: () => {
        if (group.processes.length === 0) return;
        showBatchKillConfirm(
          `Kill all ${group.processes.length} ${group.label.toLowerCase()} process(es)?`,
          group.processes,
          (pids) => window.api.killProcesses(pids)
        );
      },
    },
  ];

  // "Restart" option only for dev group — kills and notifies user to manually restart
  if (group.key === 'dev') {
    items.push({
      label: 'Restart Dev Processes',
      icon: '\u21BB',
      className: 'context-item-danger',
      action: () => {
        if (group.processes.length === 0) return;
        showBatchKillConfirm(
          `Kill all ${group.processes.length} dev process(es)? You will need to restart them manually.`,
          group.processes,
          async (pids) => {
            const result = await window.api.killProcesses(pids);
            if (result.killed > 0) {
              try {
                new Notification('Localhost Dashboard', {
                  body: `Killed ${result.killed} dev process(es). Restart them manually.`,
                });
              } catch { /* notifications may not be available */ }
            }
            return result;
          }
        );
      },
    });
  }

  // Build and show the menu using the shared context menu infrastructure
  const menu = h('div', { className: 'context-menu' }, buildMenuItems(items));
  document.body.appendChild(menu);
  activeMenu = menu;

  const rect = menu.getBoundingClientRect();
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const left = (x + rect.width > winW) ? winW - rect.width - 4 : x;
  const top = (y + rect.height > winH) ? winH - rect.height - 4 : y;
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  requestAnimationFrame(() => {
    document.addEventListener('click', onCloseContextMenu, { once: true });
    document.addEventListener('contextmenu', onCloseContextMenu, { once: true });
    document.addEventListener('keydown', onEscapeContextMenu);
  });
}
