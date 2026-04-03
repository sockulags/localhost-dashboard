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
    const history = AppState.getHistory(proc.pid);
    const cpuHistory = history.map((entry) => entry.cpu);
    const ramHistory = history.map((entry) => entry.memKB);

    const cpuColor = proc.cpu >= 50 ? 'var(--accent-red)' : proc.cpu >= 15 ? 'var(--accent-amber)' : 'var(--accent-green)';
    const cpuFill = proc.cpu >= 50 ? 'rgba(247, 118, 142, 0.15)' : proc.cpu >= 15 ? 'rgba(224, 175, 104, 0.15)' : 'rgba(158, 206, 106, 0.15)';

    const cpuSparkline = renderSparkline(cpuHistory, { stroke: cpuColor, fill: cpuFill });
    cpuSparkline.addEventListener('click', (e) => { e.stopPropagation(); showSparklineDetail(proc.pid, 'cpu'); });

    const ramSparkline = renderSparkline(ramHistory, { stroke: 'var(--accent-purple)', fill: 'rgba(187, 154, 247, 0.15)' });
    ramSparkline.addEventListener('click', (e) => { e.stopPropagation(); showSparklineDetail(proc.pid, 'ram'); });

    const cpuCell = h('td', { className: `col-cpu ${cpuClass(proc.cpu)}` }, [
      h('span', { className: 'cell-value' }, formatCpu(proc.cpu)),
      cpuSparkline,
    ]);

    const ramCell = h('td', { className: 'col-ram' }, [
      h('span', { className: 'cell-value' }, formatBytes(proc.memKB)),
      ramSparkline,
    ]);

    const row = h('tr', { dataset: { pid: proc.pid } }, [
      h('td', { className: 'col-name', title: proc.name }, proc.name),
      h('td', { className: 'col-pid' }, proc.pid.toString()),
      h('td', { className: 'col-port' }, formatPort(proc.ports)),
      cpuCell,
      ramCell,
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
