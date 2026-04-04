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
};

const VALID_THEMES = ['dark', 'light'];
const VALID_GROUPS = ['dev', 'docker', 'databases', 'apps', 'system'];

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
