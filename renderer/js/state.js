const AppState = {
  groups: {},
  warnings: [],
  lastUpdated: null,
  totalProcesses: 0,
  filter: '',
  collapsedGroups: new Set(['system']),
  listeners: [],

  update(data) {
    if (!data) return;
    this.groups = data.groups;
    this.warnings = data.warnings;
    this.lastUpdated = data.timestamp;
    this.totalProcesses = data.totalProcesses;
    this.notify();
  },

  setFilter(text) {
    this.filter = text.toLowerCase();
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

      result[key] = { ...group, processes: filtered };
    }
    return result;
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
