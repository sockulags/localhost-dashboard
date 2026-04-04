function containerStateClass(state) {
  switch (state) {
    case 'running': return 'container-running';
    case 'paused': return 'container-paused';
    case 'exited':
    case 'dead': return 'container-exited';
    case 'restarting': return 'container-restarting';
    default: return '';
  }
}

function formatContainerPorts(ports) {
  if (!ports || ports.length === 0) return '\u2014';

  return ports.map((p) => {
    if (p.hostPort) {
      return `${p.hostPort}\u2192${p.containerPort}/${p.protocol}`;
    }
    return `${p.containerPort}/${p.protocol}`;
  }).join(', ');
}

function renderContainerSection(containers) {
  if (!containers || containers.length === 0) return null;

  const section = h('div', { className: 'process-group group-containers' });

  // Header
  const isCollapsed = AppState.isCollapsed('_containers');
  const runningCount = containers.filter((c) => c.state === 'running').length;

  const toggle = h('span', {
    className: `group-toggle ${isCollapsed ? 'collapsed' : ''}`,
  }, '\u25BC');
  const icon = h('span', { className: 'group-icon' }, '\uD83D\uDC33');
  const name = h('span', { className: 'group-name' }, 'Containers');
  const count = h('span', { className: 'group-count' }, `${containers.length}`);
  const stats = h('span', { className: 'group-stats' }, [
    h('span', {}, `${runningCount} running`),
  ]);

  const header = h('div', { className: 'group-header' }, [
    toggle, icon, name, count, stats,
  ]);

  header.addEventListener('click', () => AppState.toggleGroup('_containers'));

  section.appendChild(header);

  // Body
  const body = h('div', { className: `group-body ${isCollapsed ? 'collapsed' : ''}` });

  if (!isCollapsed) {
    body.appendChild(renderContainerTable(containers));
    body.style.maxHeight = `${containers.length * 34 + 30}px`;
  }

  section.appendChild(body);
  return section;
}

function renderContainerTable(containers) {
  const thead = h('thead', {}, [
    h('tr', {}, [
      h('th', { className: 'col-container-name' }, 'Name'),
      h('th', { className: 'col-container-image' }, 'Image'),
      h('th', { className: 'col-container-status' }, 'Status'),
      h('th', { className: 'col-container-ports' }, 'Ports'),
      h('th', { className: 'col-container-id' }, 'ID'),
    ]),
  ]);

  const rows = [];
  for (const container of containers) {
    const stateClass = containerStateClass(container.state);

    const row = h('tr', {}, [
      h('td', { className: 'col-container-name', title: container.name }, container.name),
      h('td', { className: 'col-container-image', title: container.image }, container.image),
      h('td', { className: `col-container-status ${stateClass}` }, [
        h('span', { className: `container-state-dot ${stateClass}` }, ''),
        h('span', {}, container.status),
      ]),
      h('td', { className: 'col-container-ports' }, formatContainerPorts(container.ports)),
      h('td', { className: 'col-container-id' }, container.id.substring(0, 12)),
    ]);

    rows.push(row);
  }

  const tbody = h('tbody', {}, rows);
  return h('table', { className: 'process-table container-table' }, [thead, tbody]);
}
