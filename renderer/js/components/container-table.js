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

function containerThead() {
  return h('thead', {}, [
    h('tr', {}, [
      h('th', { className: 'col-container-name' }, 'Name'),
      h('th', { className: 'col-container-image' }, 'Image'),
      h('th', { className: 'col-container-status' }, 'Status'),
      h('th', { className: 'col-container-ports' }, 'Ports'),
      h('th', { className: 'col-container-id' }, 'ID'),
    ]),
  ]);
}

function populateContainerRow(tr, container) {
  tr.innerHTML = '';
  const stateClass = containerStateClass(container.state);
  tr.appendChild(h('td', { className: 'col-container-name', title: container.name }, container.name));
  tr.appendChild(h('td', { className: 'col-container-image', title: container.image }, container.image));
  tr.appendChild(h('td', { className: `col-container-status ${stateClass}` }, [
    h('span', { className: `container-state-dot ${stateClass}` }, ''),
    h('span', {}, container.status),
  ]));
  tr.appendChild(h('td', { className: 'col-container-ports' }, formatContainerPorts(container.ports)));
  tr.appendChild(h('td', { className: 'col-container-id' }, container.id.substring(0, 12)));
}

function buildContainerRow(container) {
  const tr = h('tr', {});
  populateContainerRow(tr, container);
  return tr;
}

// Build a persistent container section (header + table) for the reconciler.
function buildContainerSection() {
  const header = h('div', { className: 'group-header' }, [
    h('span', { className: 'group-toggle' }, '\u25BC'),
    h('span', { className: 'group-icon' }, '\uD83D\uDC33'),
    h('span', { className: 'group-name' }, 'Containers'),
    h('span', { className: 'group-count' }, ''),
    h('span', { className: 'group-stats' }, [h('span', {}, '')]),
  ]);
  header.addEventListener('click', () => AppState.toggleGroup('_containers'));

  const tbody = h('tbody', {});
  const table = h('table', { className: 'process-table container-table' }, [containerThead(), tbody]);
  const body = h('div', { className: 'group-body' }, [table]);

  const section = h('div', { className: 'process-group group-containers' }, [header, body]);
  return section;
}

function updateContainerSection(section, containers) {
  const isCollapsed = AppState.isCollapsed('_containers');
  const runningCount = containers.filter((c) => c.state === 'running').length;

  const header = section.querySelector('.group-header');
  header.querySelector('.group-toggle').className = `group-toggle ${isCollapsed ? 'collapsed' : ''}`;
  header.querySelector('.group-count').textContent = `${containers.length}`;
  header.querySelector('.group-stats').firstChild.textContent = `${runningCount} running`;

  const body = section.querySelector('.group-body');
  body.classList.toggle('collapsed', isCollapsed);

  const tbody = section.querySelector('tbody');
  const items = isCollapsed ? [] : containers.map((c) => ({
    key: `ct:${c.id}`,
    create: () => buildContainerRow(c),
    update: (el) => populateContainerRow(el, c),
  }));
  reconcileChildren(tbody, items);
}
