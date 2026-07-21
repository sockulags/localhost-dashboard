// Minimum identical-named processes before they collapse into a cluster row.
const CLUSTER_MIN = 3;

// ── Detail row (expanded process) ──────────────────────────────
function findProcInState(pid) {
  for (const group of Object.values(AppState.groups)) {
    for (const proc of group.processes) {
      if (proc.pid === pid) return proc;
    }
  }
  return null;
}

function renderDetailContent(data, pid) {
  const sections = [];

  // Command line
  sections.push(renderDetailSection('Command Line', data.commandLine
    ? h('code', { className: 'detail-code' }, data.commandLine)
    : h('span', { className: 'detail-empty' }, 'Not available')
  ));

  // Accumulated CPU time (enriched onto the proc snapshot by main)
  const proc = findProcInState(pid);
  sections.push(renderDetailSection('CPU time',
    proc && typeof proc.cpuTimeSec === 'number'
      ? h('span', {}, formatCpuSeconds(proc.cpuTimeSec))
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

function populateDetailRow(tr, pid) {
  tr.innerHTML = '';
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
    detailTd.appendChild(renderDetailContent(entry.data, pid));
  }
  tr.appendChild(detailTd);
}

function buildDetailRow(pid) {
  const tr = h('tr', { className: 'detail-row' });
  tr.addEventListener('click', (e) => e.stopPropagation());
  populateDetailRow(tr, pid);
  return tr;
}

// ── Table header ───────────────────────────────────────────────
function renderSortableHeader(label, column, cssClass) {
  const isActive = AppState.sortColumn === column;
  const arrow = isActive
    ? (AppState.sortDirection === 'asc' ? ' ▲' : ' ▼')
    : '';
  const activeClass = isActive ? ' sort-active' : '';

  const th = h('th', { className: `${cssClass} sortable${activeClass}` }, [
    h('span', {}, label),
    h('span', { className: 'sort-indicator' }, arrow),
  ]);

  th.addEventListener('click', () => AppState.setSort(column));
  return th;
}

function buildProcessThead() {
  return h('thead', {}, [
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
}

// ── Port cell ──────────────────────────────────────────────────
function renderPortCell(ports) {
  if (!ports || ports.length === 0) return h('span', {}, '—');

  const container = h('span', { className: 'port-cell' });
  const shown = ports.slice(0, 2);
  shown.forEach((port, i) => {
    const link = h('a', {
      className: 'port-link',
      title: `Open http://localhost:${port}`,
      href: '#',
    }, String(port));
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.api.openUrl(`http://localhost:${port}`);
    });
    container.appendChild(link);
    if (i < shown.length - 1) container.appendChild(h('span', {}, ', '));
  });
  if (ports.length > 2) {
    container.appendChild(h('span', { className: 'port-more' }, ` +${ports.length - 2}`));
  }
  return container;
}

// ── Process row (reusable: build once, update in place) ────────
function populateRow(tr, proc, opts = {}) {
  tr._proc = proc;
  tr.innerHTML = '';
  tr.dataset.pid = proc.pid;

  const history = AppState.getHistory(proc.pid);
  const cpuHistory = history.map((e) => e.cpu);
  const ramHistory = history.map((e) => e.memKB);

  const cpuColor = proc.cpu >= 50 ? 'var(--accent-red)' : proc.cpu >= 15 ? 'var(--accent-amber)' : 'var(--accent-green)';
  const cpuFill = proc.cpu >= 50 ? 'rgba(247, 118, 142, 0.15)' : proc.cpu >= 15 ? 'rgba(224, 175, 104, 0.15)' : 'rgba(158, 206, 106, 0.15)';

  const cpuSparkline = renderSparkline(cpuHistory, { stroke: cpuColor, fill: cpuFill });
  cpuSparkline.addEventListener('click', (e) => { e.stopPropagation(); showSparklineDetail(proc.pid, 'cpu'); });

  const ramSparkline = renderSparkline(ramHistory, { stroke: 'var(--accent-purple)', fill: 'rgba(187, 154, 247, 0.15)' });
  ramSparkline.addEventListener('click', (e) => { e.stopPropagation(); showSparklineDetail(proc.pid, 'ram'); });

  const isExpanded = AppState.isExpanded(proc.pid);
  const isPinned = AppState.isPinned(proc.name);

  tr.className = 'proc-row';
  if (opts.isClusterChild) tr.classList.add('cluster-child');
  if (isExpanded) tr.classList.add('expanded-row');
  if (isPinned) tr.classList.add('pinned-row');
  if (proc.hasWarning) tr.classList.add('warning-row');

  const nameChildren = [
    h('span', { className: `expand-indicator ${isExpanded ? 'open' : ''}` }, '▶'),
  ];
  if (isPinned) {
    nameChildren.push(h('span', { className: 'pin-indicator', title: 'Pinned' }, '★'));
  }
  nameChildren.push(h('span', {}, proc.name));

  const cpuCell = h('td', {
    className: `col-cpu ${cpuClass(proc.cpu)}`,
    title: `Accumulated CPU time: ${formatCpuSeconds(proc.cpuTimeSec)}`,
  }, [
    h('span', { className: 'cell-value' }, formatCpu(proc.cpu)),
    cpuSparkline,
  ]);

  const ramCell = h('td', { className: 'col-ram' }, [
    h('span', { className: 'cell-value' }, formatBytes(proc.memKB)),
    ramSparkline,
  ]);

  tr.appendChild(h('td', { className: 'col-name', title: proc.name }, nameChildren));
  tr.appendChild(h('td', { className: 'col-pid' }, proc.pid.toString()));
  tr.appendChild(h('td', { className: 'col-port' }, [renderPortCell(proc.ports)]));
  tr.appendChild(cpuCell);
  tr.appendChild(ramCell);
  tr.appendChild(h('td', { className: 'col-uptime' }, formatUptime(proc.started)));
  tr.appendChild(h('td', { className: 'col-action' }, [renderKillButton(proc.pid, proc.name)]));
}

function buildRow(proc, opts = {}) {
  const tr = h('tr', { dataset: { pid: proc.pid } });
  tr.style.cursor = 'pointer';
  tr.addEventListener('click', () => {
    if (tr._proc) AppState.toggleExpanded(tr._proc.pid);
  });
  tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (tr._proc) showContextMenu(e.clientX, e.clientY, tr._proc);
  });
  populateRow(tr, proc, opts);
  return tr;
}

// ── Cluster row (aggregate of same-named processes) ────────────
function clusterAggregate(procs) {
  let totalCpu = 0;
  let totalMem = 0;
  let oldest = Infinity;
  const portSet = new Set();
  let anyWarning = false;

  for (const p of procs) {
    totalCpu += p.cpu;
    totalMem += p.memKB || 0;
    if (p.started && p.started < oldest) oldest = p.started;
    if (p.ports) for (const port of p.ports) portSet.add(port);
    if (p.hasWarning) anyWarning = true;
  }

  return {
    totalCpu,
    totalMem,
    oldest: oldest === Infinity ? null : oldest,
    ports: Array.from(portSet).sort((a, b) => a - b),
    anyWarning,
  };
}

function populateClusterRow(tr, cluster) {
  tr._cluster = cluster;
  tr.innerHTML = '';

  const { procs, name, key } = cluster;
  const agg = clusterAggregate(procs);
  const expanded = AppState.isClusterExpanded(key);

  tr.className = 'cluster-row';
  if (expanded) tr.classList.add('cluster-open');
  if (agg.anyWarning) tr.classList.add('warning-row');

  const nameCell = h('td', { className: 'col-name' }, [
    h('span', { className: `expand-indicator ${expanded ? 'open' : ''}` }, '▶'),
    h('span', { className: 'cluster-name' }, name),
    h('span', { className: 'cluster-badge' }, `×${procs.length}`),
  ]);

  const cpuCell = h('td', { className: `col-cpu ${cpuClass(agg.totalCpu)}` }, [
    h('span', { className: 'cell-value' }, formatCpu(agg.totalCpu)),
  ]);
  const ramCell = h('td', { className: 'col-ram' }, [
    h('span', { className: 'cell-value' }, formatBytes(agg.totalMem)),
  ]);

  const killBtn = h('button', {
    className: 'kill-btn kill-btn-cluster',
    title: `Kill all ${procs.length} ${name} processes`,
  }, `Kill ${procs.length}`);
  killBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showBatchKillConfirm(
      `Kill all ${tr._cluster.procs.length} ${name} process(es)?`,
      tr._cluster.procs,
      (pids) => window.api.killProcesses(pids)
    );
  });

  tr.appendChild(nameCell);
  tr.appendChild(h('td', { className: 'col-pid cluster-pid' }, `${procs.length} pids`));
  tr.appendChild(h('td', { className: 'col-port' }, [renderPortCell(agg.ports)]));
  tr.appendChild(cpuCell);
  tr.appendChild(ramCell);
  tr.appendChild(h('td', { className: 'col-uptime' }, formatUptime(agg.oldest)));
  tr.appendChild(h('td', { className: 'col-action' }, [killBtn]));
}

function buildClusterRow(cluster) {
  const tr = h('tr', {});
  tr.style.cursor = 'pointer';
  tr.addEventListener('click', () => {
    if (tr._cluster) AppState.toggleCluster(tr._cluster.key);
  });
  populateClusterRow(tr, cluster);
  return tr;
}

// ── Build the reconciler item list for one group's tbody ───────
function buildGroupRowItems(group, groupKey) {
  const items = [];
  const procs = group.processes;

  const pushProcess = (proc, opts) => {
    items.push({
      key: `p:${proc.pid}`,
      create: () => buildRow(proc, opts),
      update: (el) => populateRow(el, proc, opts),
    });
    if (AppState.isExpanded(proc.pid)) {
      items.push({
        key: `d:${proc.pid}`,
        create: () => buildDetailRow(proc.pid),
        update: (el) => populateDetailRow(el, proc.pid),
      });
    }
  };

  if (!AppState.clusterMode) {
    for (const proc of procs) pushProcess(proc);
    return items;
  }

  // Group by name; each cluster anchors at its first (highest-sorted) member.
  const byName = new Map();
  for (const proc of procs) {
    if (!byName.has(proc.name)) byName.set(proc.name, []);
    byName.get(proc.name).push(proc);
  }

  for (const [name, members] of byName) {
    if (members.length >= CLUSTER_MIN) {
      const key = `c:${groupKey}:${name}`;
      const cluster = { key, groupKey, name, procs: members };
      items.push({
        key,
        create: () => buildClusterRow(cluster),
        update: (el) => populateClusterRow(el, cluster),
      });
      if (AppState.isClusterExpanded(key)) {
        for (const proc of members) pushProcess(proc, { isClusterChild: true });
      }
    } else {
      for (const proc of members) pushProcess(proc);
    }
  }

  return items;
}
