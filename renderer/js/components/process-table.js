function renderSortableHeader(label, column, cssClass) {
  const isActive = AppState.sortColumn === column;
  const arrow = isActive
    ? (AppState.sortDirection === 'asc' ? ' \u25B2' : ' \u25BC')
    : '';
  const activeClass = isActive ? ' sort-active' : '';

  const th = h('th', { className: `${cssClass} sortable${activeClass}` }, [
    h('span', {}, label),
    h('span', { className: 'sort-indicator' }, arrow),
  ]);

  th.addEventListener('click', () => AppState.setSort(column));
  return th;
}

function renderProcessTable(processes) {
  const thead = h('thead', {}, [
    h('tr', {}, [
      renderSortableHeader('Name', 'name', 'col-name'),
      renderSortableHeader('PID', 'pid', 'col-pid'),
      renderSortableHeader('Port', 'port', 'col-port'),
      renderSortableHeader('CPU', 'cpu', 'col-cpu'),
      renderSortableHeader('RAM', 'ram', 'col-ram'),
      renderSortableHeader('Uptime', 'uptime', 'col-uptime'),
      h('th', { className: 'col-action' }, ''),
    ]),
  ]);

  const rows = processes.map((proc) => {
    const row = h('tr', { dataset: { pid: proc.pid } }, [
      h('td', { className: 'col-name', title: proc.name }, proc.name),
      h('td', { className: 'col-pid' }, proc.pid.toString()),
      h('td', { className: 'col-port' }, formatPort(proc.ports)),
      h('td', { className: `col-cpu ${cpuClass(proc.cpu)}` }, formatCpu(proc.cpu)),
      h('td', { className: 'col-ram' }, formatBytes(proc.memKB)),
      h('td', { className: 'col-uptime' }, formatUptime(proc.started)),
      h('td', { className: 'col-action' }, [renderKillButton(proc.pid, proc.name)]),
    ]);

    if (proc.hasWarning) {
      row.classList.add('warning-row');
    }

    return row;
  });

  const tbody = h('tbody', {}, rows);
  return h('table', { className: 'process-table' }, [thead, tbody]);
}
