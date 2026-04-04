const HISTORY_MAX = 60;

const AppState = {
  groups: {},
  containers: [],
  warnings: [],
  lastUpdated: null,
  totalProcesses: 0,
  filter: '',
  sortColumn: 'cpu',
  sortDirection: 'desc',
  collapsedGroups: new Set(['system']),
  expandedPids: new Map(), // pid -> { loading: bool, data: null | {...} }
  listeners: [],
  history: new Map(),

  update(data) {
    if (!data) return;
    this._recordHistory(data);
    this.groups = data.groups;
    this.containers = data.containers || [];
    this.warnings = data.warnings;
    this.lastUpdated = data.timestamp;
    this.totalProcesses = data.totalProcesses;
    this.notify();
  },

  _recordHistory(data) {
    const activePids = new Set();
    for (const group of Object.values(data.groups)) {
      for (const proc of group.processes) {
        activePids.add(proc.pid);
        if (!this.history.has(proc.pid)) {
          this.history.set(proc.pid, []);
        }
        const buf = this.history.get(proc.pid);
        buf.push({ cpu: proc.cpu, memKB: proc.memKB || 0 });
        if (buf.length > HISTORY_MAX) {
          buf.shift();
        }
      }
    }
    for (const pid of this.history.keys()) {
      if (!activePids.has(pid)) {
        this.history.delete(pid);
      }
    }
    // Clean up expanded state for dead processes
    for (const pid of this.expandedPids.keys()) {
      if (!activePids.has(pid)) {
        this.expandedPids.delete(pid);
      }
    }
  },

  getHistory(pid) {
    return this.history.get(pid) || [];
  },

  setFilter(text) {
    this.filter = text.toLowerCase();
    this.notify();
  },

  setSort(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      // Numeric columns default to descending, text columns to ascending
      this.sortDirection = (column === 'name') ? 'asc' : 'desc';
    }
    this.notify();
  },

  toggleGroup(groupKey) {
    if (this.collapsedGroups.has(groupKey)) {
      this.collapsedGroups.delete(groupKey);
    } else {
      this.collapsedGroups.add(groupKey);
    }
    this.notify();
  },

  isCollapsed(groupKey) {
    return this.collapsedGroups.has(groupKey);
  },

  getFilteredGroups() {
    const result = {};
    for (const [key, group] of Object.entries(this.groups)) {
      const filtered = this.filter
        ? group.processes.filter(
            (p) =>
              p.name.toLowerCase().includes(this.filter) ||
              p.pid.toString().includes(this.filter) ||
              (p.ports && p.ports.some((port) => port.toString().includes(this.filter)))
          )
        : group.processes;

      const sorted = this._sortProcesses(filtered);
      result[key] = { ...group, processes: sorted };
    }
    return result;
  },

  _sortProcesses(processes) {
    const col = this.sortColumn;
    const dir = this.sortDirection === 'asc' ? 1 : -1;

    return [...processes].sort((a, b) => {
      let va, vb;
      switch (col) {
        case 'name':
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
          return dir * (va < vb ? -1 : va > vb ? 1 : 0);
        case 'pid':
          return dir * (a.pid - b.pid);
        case 'port':
          va = (a.ports && a.ports.length > 0) ? a.ports[0] : -1;
          vb = (b.ports && b.ports.length > 0) ? b.ports[0] : -1;
          // Push processes without ports to the end regardless of direction
          if (va === -1 && vb !== -1) return 1;
          if (va !== -1 && vb === -1) return -1;
          return dir * (va - vb);
        case 'cpu':
          return dir * (a.cpu - b.cpu);
        case 'ram':
          return dir * ((a.memKB || 0) - (b.memKB || 0));
        case 'uptime':
          // Lower started = longer uptime, so invert comparison.
          // Descending uptime (longest first) = ascending started timestamp.
          va = a.started || Infinity;
          vb = b.started || Infinity;
          return dir * (vb - va);
        default:
          return 0;
      }
    });
  },

  toggleExpanded(pid) {
    if (this.expandedPids.has(pid)) {
      this.expandedPids.delete(pid);
      this.notify();
    } else {
      this.expandedPids.set(pid, { loading: true, data: null });
      this.notify();
      window.api.getProcessDetails(pid).then((data) => {
        // Only update if still expanded (user may have collapsed it)
        if (this.expandedPids.has(pid)) {
          this.expandedPids.set(pid, { loading: false, data });
          this.notify();
        }
      }).catch(() => {
        if (this.expandedPids.has(pid)) {
          this.expandedPids.set(pid, { loading: false, data: null });
          this.notify();
        }
      });
    }
  },

  isExpanded(pid) {
    return this.expandedPids.has(pid);
  },

  getExpandedData(pid) {
    const entry = this.expandedPids.get(pid);
    return entry || null;
  },

  subscribe(fn) {
    this.listeners.push(fn);
  },

  notify() {
    for (const fn of this.listeners) {
      fn();
    }
  },
};
