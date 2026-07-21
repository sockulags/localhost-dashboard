/* Command palette – Ctrl+K overlay for quick actions.
 * Built entirely at runtime (no static HTML), same pattern as the
 * context menu and settings modal. */

const CMD_PALETTE_MAX_RESULTS = 30;

let cmdPaletteOverlay = null; // root overlay element while open
let cmdPaletteItems = [];     // currently displayed (filtered) commands
let cmdPaletteSelected = 0;   // index into cmdPaletteItems

/**
 * Pure subsequence fuzzy matcher.
 * Returns a score (higher = better) or -1 when `query` is not a
 * subsequence of `text`. Bonuses: consecutive matches, start-of-word.
 */
function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > t.length) return -1;

  let score = 0;
  let ti = 0;
  let prevMatch = -2; // index of previous matched char in t

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) { found = ti; break; }
      ti++;
    }
    if (found === -1) return -1;

    score += 1;
    if (found === prevMatch + 1) score += 3; // consecutive-match bonus
    const prevChar = found === 0 ? ' ' : t[found - 1];
    if (/[\s\-_.:/("']/.test(prevChar)) score += 2; // start-of-word bonus

    prevMatch = found;
    ti = found + 1;
  }

  // Slight preference for shorter targets (tighter matches).
  score += Math.max(0, 10 - Math.floor(t.length / 8)) * 0.01;
  return score;
}

/** Assemble the full command list from current client-side state. */
function buildPaletteCommands() {
  const commands = [];

  // ── Static commands ────────────────────────────────
  commands.push({
    label: 'Open settings',
    kind: 'Command',
    keywords: 'preferences config',
    action: () => openSettings(),
  });
  commands.push({
    label: 'Export snapshot',
    kind: 'Command',
    keywords: 'save json download',
    action: () => window.api.exportSnapshot(),
  });
  commands.push({
    label: 'Toggle clustering',
    kind: 'Command',
    keywords: 'group identical processes cluster',
    action: () => {
      const val = AppState.toggleClusterMode();
      updateClusterBtn();
      window.api.setConfig('clusterProcesses', val);
    },
  });

  // ── Profiles ───────────────────────────────────────
  for (const profile of AppState.profiles || []) {
    const hasCommands = (profile.services || []).some((s) => s.command && s.command.trim());
    if (!hasCommands) continue;
    commands.push({
      label: `Start profile "${profile.name}"`,
      kind: 'Profile',
      keywords: 'launch run services',
      action: () => {
        showToast(`Starting "${profile.name}"`);
        startProfile(profile);
      },
    });
  }

  // ── Live processes ─────────────────────────────────
  for (const group of Object.values(AppState.groups || {})) {
    for (const proc of group.processes || []) {
      commands.push({
        label: `Kill ${proc.name}`,
        detail: `PID ${proc.pid}`,
        kind: 'Process',
        keywords: `stop terminate ${proc.pid}`,
        action: () => showKillConfirm(proc.pid, proc.name),
      });
      for (const port of proc.ports || []) {
        commands.push({
          label: `Open :${port} in browser`,
          detail: proc.name,
          kind: 'Port',
          keywords: `localhost http ${proc.name}`,
          action: () => window.api.openUrl(`http://localhost:${port}`),
        });
      }
    }
  }

  return commands;
}

function executePaletteItem(item) {
  closeCommandPalette();
  item.action();
}

/** Re-render the result list for the current query. */
function renderCommandPaletteList() {
  if (!cmdPaletteOverlay) return;
  const input = cmdPaletteOverlay.querySelector('.cmd-palette-input');
  const list = cmdPaletteOverlay.querySelector('.cmd-palette-list');
  const query = input.value.trim();

  // Rebuild from live state on every render so actions never target a
  // stale PID/port after a poll updates AppState while the palette is open.
  const all = buildPaletteCommands();
  let matched;
  if (query === '') {
    matched = all.slice(0, CMD_PALETTE_MAX_RESULTS);
  } else {
    matched = all
      .map((cmd) => {
        const haystack = `${cmd.label} ${cmd.detail || ''} ${cmd.keywords || ''}`;
        return { cmd, score: fuzzyScore(query, haystack) };
      })
      .filter((m) => m.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, CMD_PALETTE_MAX_RESULTS)
      .map((m) => m.cmd);
  }

  cmdPaletteItems = matched;
  if (cmdPaletteSelected >= matched.length) cmdPaletteSelected = 0;

  if (matched.length === 0) {
    list.replaceChildren(h('div', { className: 'cmd-palette-empty' }, 'No matching commands'));
    return;
  }

  const rows = matched.map((cmd, i) => {
    const row = h('div', {
      className: `cmd-palette-item ${i === cmdPaletteSelected ? 'selected' : ''}`,
    }, [
      h('span', { className: 'cmd-palette-label' }, cmd.label),
      cmd.detail ? h('span', { className: 'cmd-palette-detail' }, cmd.detail) : null,
      h('span', { className: 'cmd-palette-kind' }, cmd.kind),
    ].filter(Boolean));

    row.addEventListener('click', () => executePaletteItem(cmd));
    // mousemove (not mouseenter): scrolling via arrow keys moves rows under
    // a stationary cursor, which would hijack the keyboard selection.
    row.addEventListener('mousemove', () => {
      if (cmdPaletteSelected !== i) {
        cmdPaletteSelected = i;
        updatePaletteSelection();
      }
    });
    return row;
  });

  list.replaceChildren(...rows);
}

/** Cheap selection update without rebuilding rows. */
function updatePaletteSelection() {
  if (!cmdPaletteOverlay) return;
  const rows = cmdPaletteOverlay.querySelectorAll('.cmd-palette-item');
  rows.forEach((row, i) => {
    row.classList.toggle('selected', i === cmdPaletteSelected);
  });
  const sel = rows[cmdPaletteSelected];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function onCmdPaletteKeyDown(e) {
  if (!cmdPaletteOverlay) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeCommandPalette();
    return;
  }
  // While the palette is open it owns the keyboard: swallow the app's other
  // global shortcuts (Ctrl+E export, Ctrl+, settings) so a second overlay
  // can't stack underneath, and let Ctrl+K toggle the palette closed.
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      closeCommandPalette();
      return;
    }
    if (key === 'e' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdPaletteItems.length > 0) {
      cmdPaletteSelected = (cmdPaletteSelected + 1) % cmdPaletteItems.length;
      updatePaletteSelection();
    }
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdPaletteItems.length > 0) {
      cmdPaletteSelected = (cmdPaletteSelected - 1 + cmdPaletteItems.length) % cmdPaletteItems.length;
      updatePaletteSelection();
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const item = cmdPaletteItems[cmdPaletteSelected];
    if (item) executePaletteItem(item);
  }
}

function openCommandPalette() {
  if (cmdPaletteOverlay) {
    // Already open — just refocus the input.
    cmdPaletteOverlay.querySelector('.cmd-palette-input').focus();
    return;
  }

  const input = h('input', {
    type: 'text',
    className: 'cmd-palette-input',
    placeholder: 'Type a command, process or port…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const list = h('div', { className: 'cmd-palette-list' });
  const panel = h('div', { className: 'cmd-palette' }, [input, list]);
  const overlay = h('div', { className: 'cmd-palette-overlay' }, [panel]);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  input.addEventListener('input', () => {
    cmdPaletteSelected = 0;
    renderCommandPaletteList();
  });

  document.body.appendChild(overlay);
  cmdPaletteOverlay = overlay;
  cmdPaletteSelected = 0;

  // Capture-phase so palette keys win over other global handlers.
  document.addEventListener('keydown', onCmdPaletteKeyDown, true);

  renderCommandPaletteList();
  input.focus();
}

function closeCommandPalette() {
  if (!cmdPaletteOverlay) return;
  cmdPaletteOverlay.remove();
  cmdPaletteOverlay = null;
  cmdPaletteItems = [];
  cmdPaletteSelected = 0;
  document.removeEventListener('keydown', onCmdPaletteKeyDown, true);
}

// Keep the visible list in sync with polling while the palette is open.
// Registered once at load (AppState.subscribe has no unsubscribe).
AppState.subscribe(() => {
  if (cmdPaletteOverlay) renderCommandPaletteList();
});
