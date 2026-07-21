// Mini-HUD renderer — standalone plain script; intentionally does NOT load
// the app's component stack. The tiny format helpers are duplicated locally
// (wrapped in an IIFE) so nothing leaks into or depends on the shared
// renderer global scope used by index.html.
(() => {
  const POLL_MS = 5000;
  const TOP_N = 3;
  // The HUD watches dev-ish workloads; OS/system noise would otherwise
  // dominate a raw CPU ranking.
  const EXCLUDED_GROUPS = new Set(['system']);

  let lastData = null;

  const listEl = document.getElementById('hud-list');
  const emptyEl = document.getElementById('hud-empty');
  const badgeEl = document.getElementById('hud-warnings');
  const closeEl = document.getElementById('hud-close');

  closeEl.addEventListener('click', () => window.close());

  // ── Local formatters (hud.js is standalone — no app utils loaded) ──
  function fmtBytes(kb) {
    if (kb < 1024) return `${kb} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  function fmtCpu(cpu) {
    return `${cpu.toFixed(1)}%`;
  }

  function topProcesses(data) {
    const all = [];
    for (const [key, group] of Object.entries(data.groups || {})) {
      if (EXCLUDED_GROUPS.has(key)) continue;
      for (const proc of group.processes || []) {
        all.push(proc);
      }
    }
    all.sort((a, b) => b.cpu - a.cpu);
    return all.slice(0, TOP_N);
  }

  function render(data) {
    const warningCount = (data.warnings || []).length;
    badgeEl.textContent = String(warningCount);
    badgeEl.classList.toggle('has-warnings', warningCount > 0);

    const top = topProcesses(data);

    listEl.textContent = '';
    for (const proc of top) {
      const li = document.createElement('li');
      li.className = 'hud-row';

      const name = document.createElement('span');
      name.className = 'hud-name';
      name.textContent = proc.name;
      name.title = `${proc.name} (PID ${proc.pid})`;

      const cpu = document.createElement('span');
      cpu.className = 'hud-cpu';
      cpu.textContent = fmtCpu(proc.cpu);

      const mem = document.createElement('span');
      mem.className = 'hud-mem';
      mem.textContent = fmtBytes(proc.memKB);

      li.append(name, cpu, mem);
      listEl.appendChild(li);
    }

    emptyEl.classList.toggle('hidden', top.length > 0);
  }

  async function applyThemeFromConfig() {
    try {
      const cfg = await window.api.getConfig();
      document.documentElement.setAttribute('data-theme', (cfg && cfg.theme) || 'dark');
    } catch {
      // Theme is cosmetic — ignore failures and keep the dark default.
    }
  }

  async function poll() {
    // A hidden HUD (toggle uses hide(), which keeps this renderer alive)
    // should not keep polling in the background.
    if (document.hidden) return;
    try {
      // getLastSnapshot() is a read-only view of the main poll loop's latest
      // data (null until the first poll completes) — the HUD never triggers
      // collection itself, so it can't race the main window's polling or
      // swallow new-warning notifications.
      const data = await window.api.getLastSnapshot();
      if (data) {
        lastData = data;
      }
      if (lastData) {
        render(lastData);
      }
    } catch {
      // Keep showing the last good snapshot; try again next tick.
    }
  }

  // Refresh immediately when the window is shown again after being hidden.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  applyThemeFromConfig();
  poll();
  setInterval(poll, POLL_MS);
})();
