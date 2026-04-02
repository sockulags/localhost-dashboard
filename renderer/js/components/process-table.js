function renderProcessTable(processes) {
  const thead = h('thead', {}, [
    h('tr', {}, [
      h('th', { className: 'col-name' }, 'Name'),
      h('th', { className: 'col-pid' }, 'PID'),
      h('th', { className: 'col-port' }, 'Port'),
      h('th', { className: 'col-cpu' }, 'CPU'),
      h('th', { className: 'col-ram' }, 'RAM'),
      h('th', { className: 'col-uptime' }, 'Uptime'),
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
