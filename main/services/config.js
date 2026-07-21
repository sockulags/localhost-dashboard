const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  pollInterval: 3,        // seconds (1–10)
  notifications: true,
  minimizeToTray: true,
  autostart: false,
  theme: 'dark',           // 'dark' | 'light'
  customRules: [],         // [{ pattern: string, group: string }]
  profiles: [],            // [{ id, name, services: [{ id, name, pattern, command, cwd }] }]
  pinnedNames: [],         // [string] — process names pinned to top of their group
  cpuThreshold: 0,         // percent (0 = disabled)
  memThresholdMB: 0,       // megabytes (0 = disabled)
  thresholdSustainPolls: 3, // fire only after N consecutive polls over threshold
  duplicateThreshold: 8,   // warn when N+ dev processes share a name (0/1 = disabled)
  clusterProcesses: true,  // collapse same-named processes into clusters in the UI
  // [anchor: feature keys] — new feature config keys go below this line
  hiddenPollInterval: 15,  // seconds (5–120) — poll cadence while the window is hidden
  portHealthChecks: true,  // probe listening ports over HTTP and show up/down status
  userRules: [],           // [{ id, pattern, metric: 'cpu'|'mem', threshold, sustainPolls, action: 'notify'|'kill'|'command', command?, cwd? }]
};

const VALID_THEMES = ['dark', 'light'];
const VALID_GROUPS = ['dev', 'agents', 'docker', 'databases', 'apps', 'system'];

let cache = null;

function load() {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS, ...parsed };
  } catch {
    cache = { ...DEFAULTS };
  }

  // Ensure valid values after loading
  cache = validate(cache);
  return cache;
}

function validate(cfg) {
  const result = { ...cfg };

  // pollInterval: clamp to 1–10
  result.pollInterval = Math.max(1, Math.min(10, Number(result.pollInterval) || DEFAULTS.pollInterval));

  // booleans
  result.notifications = !!result.notifications;
  result.minimizeToTray = !!result.minimizeToTray;
  result.autostart = !!result.autostart;

  // theme
  if (!VALID_THEMES.includes(result.theme)) {
    result.theme = DEFAULTS.theme;
  }

  // customRules: validate each entry
  if (!Array.isArray(result.customRules)) {
    result.customRules = [];
  }
  result.customRules = result.customRules.filter((rule) => {
    if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.trim()) return false;
    if (!VALID_GROUPS.includes(rule.group)) return false;
    // Verify the pattern is valid regex
    try {
      new RegExp(rule.pattern, 'i');
      return true;
    } catch {
      return false;
    }
  });

  // pinnedNames: array of strings
  if (!Array.isArray(result.pinnedNames)) {
    result.pinnedNames = [];
  }
  result.pinnedNames = result.pinnedNames.filter((n) => typeof n === 'string' && n.trim());

  // Thresholds: clamp non-negative numbers
  result.cpuThreshold = Math.max(0, Math.min(100, Number(result.cpuThreshold) || 0));
  result.memThresholdMB = Math.max(0, Number(result.memThresholdMB) || 0);
  result.thresholdSustainPolls = Math.max(1, Math.min(60, Number(result.thresholdSustainPolls) || 3));
  result.duplicateThreshold = Math.max(0, Math.min(100, Number(result.duplicateThreshold) || 0));
  result.clusterProcesses = !!result.clusterProcesses;

  // profiles: validate each entry
  if (!Array.isArray(result.profiles)) {
    result.profiles = [];
  }
  result.profiles = result.profiles.filter((profile) => {
    if (!profile || typeof profile.id !== 'string') return false;
    if (typeof profile.name !== 'string' || !profile.name.trim()) return false;
    if (!Array.isArray(profile.services)) return false;
    profile.services = profile.services.filter((s) => {
      if (!s || typeof s.id !== 'string') return false;
      if (typeof s.name !== 'string' || !s.name.trim()) return false;
      if (typeof s.pattern !== 'string') return false;
      try {
        new RegExp(s.pattern, 'i');
        return true;
      } catch {
        return false;
      }
    });
    return true;
  });

  // [anchor: feature validation] — new feature validation clauses go below this line

  // hiddenPollInterval: clamp to 5–120
  result.hiddenPollInterval = Math.max(5, Math.min(120, Number(result.hiddenPollInterval) || DEFAULTS.hiddenPollInterval));
  result.portHealthChecks = !!result.portHealthChecks;
  // userRules: validate rule-engine entries
  if (!Array.isArray(result.userRules)) {
    result.userRules = [];
  }
  result.userRules = result.userRules
    .filter((rule) => {
      if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.trim()) return false;
      // Verify the pattern is valid regex
      try {
        new RegExp(rule.pattern, 'i');
      } catch {
        return false;
      }
      if (!['cpu', 'mem'].includes(rule.metric)) return false;
      const threshold = Number(rule.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0) return false;
      if (!['notify', 'kill', 'command'].includes(rule.action)) return false;
      if (rule.action === 'command' && (typeof rule.command !== 'string' || !rule.command.trim())) return false;
      return true;
    })
    .map((rule) => ({
      ...rule,
      id: (typeof rule.id === 'string' && rule.id.trim())
        ? rule.id
        : `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      threshold: Number(rule.threshold),
      sustainPolls: Math.max(1, Math.min(60, Number(rule.sustainPolls) || 1)),
    }));

  return result;
}

function save() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
}

function getAll() {
  return { ...load() };
}

function get(key) {
  const cfg = load();
  return cfg[key];
}

function set(key, value) {
  load(); // ensure cache is populated
  if (!(key in DEFAULTS)) return cache;

  cache[key] = value;
  cache = validate(cache);
  save();
  return { ...cache };
}

module.exports = { getAll, get, set, DEFAULTS, VALID_GROUPS };
