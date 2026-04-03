function renderDetailRow(pid) {
  const entry = AppState.getExpandedData(pid);
  const detailTd = h('td', { className: 'detail-cell' });
  detailTd.setAttribute('colspan', '7');

  if (!entry || entry.loading) {
    detailTd.appendChild(h('div', { className: 'detail-panel' }, [
      h('span', { className: 'detail-loading' }, 'Loading details...'),
    ]));
  } else if (!entry.data) {
    detailTd.appendChild(h('div', { className: 'detail-panel' }, [
      h('span', { className: 'detail-error' }, 'Could not retrieve process details.'),
    ]));
  } else {
    detailTd.appendChild(renderDetailContent(entry.data));
  }

  const detailRow = h('tr', { className: 'detail-row' }, [detailTd]);
  detailRow.addEventListener('click', (e) => e.stopPropagation());
  return detailRow;
}

function renderDetailContent(data) {
  const sections = [];

  // Command line
  sections.push(renderDetailSection('Command Line', data.commandLine
    ? h('code', { className: 'detail-code' }, data.commandLine)
    : h('span', { className: 'detail-empty' }, 'Not available')
  ));

  // Network connections
  if (data.connections && data.connections.length > 0) {
    const connRows = data.connections.map((conn) =>
      h('tr', {}, [
        h('td', {}, conn.protocol || ''),
        h('td', {}, conn.local || ''),
        h('td', {}, conn.remote || ''),
        h('td', {}, conn.state || ''),
      ])
    );

    const connTable = h('table', { className: 'detail-table' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, 'Proto'),
          h('th', {}, 'Local'),
          h('th', {}, 'Remote'),
          h('th', {}, 'State'),
        ]),
      ]),
      h('tbody', {}, connRows),
    ]);
    sections.push(renderDetailSection('Network Connections', connTable));
  } else {
    sections.push(renderDetailSection('Network Connections',
      h('span', { className: 'detail-empty' }, 'No connections')
    ));
  }

  // Child processes
  if (data.children && data.children.length > 0) {
    const childRows = data.children.map((child) =>
      h('tr', {}, [
        h('td', {}, child.name || ''),
        h('td', {}, child.pid ? child.pid.toString() : ''),
        h('td', {}, child.memKB ? formatBytes(child.memKB) : '—'),
      ])
    );

    const childTable = h('table', { className: 'detail-table' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', {}, 'Name'),
          h('th', {}, 'PID'),
          h('th', {}, 'RAM'),
        ]),
      ]),
      h('tbody', {}, childRows),
    ]);
    sections.push(renderDetailSection('Child Processes', childTable));
  } else {
    sections.push(renderDetailSection('Child Processes',
      h('span', { className: 'detail-empty' }, 'No child processes')
    ));
  }

  return h('div', { className: 'detail-panel' }, sections);
}

function renderDetailSection(title, content) {
  return h('div', { className: 'detail-section' }, [
    h('div', { className: 'detail-section-title' }, title),
    h('div', { className: 'detail-section-body' }, [content]),
  ]);
}

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

  const rows = [];
  for (const proc of processes) {
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

    const isExpanded = AppState.isExpanded(proc.pid);

    const row = h('tr', { dataset: { pid: proc.pid }, className: isExpanded ? 'expanded-row' : '' }, [
      h('td', { className: 'col-name', title: proc.name }, [
        h('span', { className: `expand-indicator ${isExpanded ? 'open' : ''}` }, '\u25B6'),
        h('span', {}, proc.name),
      ]),
      h('td', { className: 'col-pid' }, proc.pid.toString()),
      h('td', { className: 'col-port' }, formatPort(proc.ports)),
      cpuCell,
      ramCell,
      h('td', { className: 'col-uptime' }, formatUptime(proc.started)),
      h('td', { className: 'col-action' }, [renderKillButton(proc.pid, proc.name)]),
    ]);

    row.addEventListener('click', () => AppState.toggleExpanded(proc.pid));
    row.style.cursor = 'pointer';

    if (proc.hasWarning) {
      row.classList.add('warning-row');
    }

    rows.push(row);

    // Render detail row if expanded
    if (isExpanded) {
      rows.push(renderDetailRow(proc.pid));
    }
  }

  const tbody = h('tbody', {}, rows);
  return h('table', { className: 'process-table' }, [thead, tbody]);
}
