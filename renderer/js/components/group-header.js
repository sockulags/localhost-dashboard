function renderGroupHeader(group, isCollapsed) {
  const toggle = h('span', { className: `group-toggle ${isCollapsed ? 'collapsed' : ''}` }, '▼');
  const icon = h('span', { className: 'group-icon' }, group.icon);
  const name = h('span', { className: 'group-name' }, group.label);
  const count = h('span', { className: 'group-count' }, `(${group.processes.length})`);
  const stats = h('span', { className: 'group-stats' }, [
    h('span', {}, `CPU ${group.totalCpu.toFixed(1)}%`),
    h('span', {}, formatBytes(group.totalMemKB)),
  ]);

  const header = h('div', { className: 'group-header' }, [toggle, icon, name, count, stats]);

  header.addEventListener('click', () => {
    AppState.toggleGroup(group.key);
  });

  return header;
}
