/* Settings panel – rendered as a modal overlay */

const VALID_GROUPS = ['dev', 'agents', 'docker', 'databases', 'apps', 'system'];
const GROUP_LABELS = {
  dev: 'Dev Processes',
  agents: 'Agents',
  docker: 'Docker',
  databases: 'Databases',
  apps: 'Apps',
  system: 'System',
};

let settingsConfig = null; // local copy while the panel is open

function openSettings() {
  window.api.getConfig().then((cfg) => {
    settingsConfig = cfg;
    renderSettingsModal();
  });
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
  settingsConfig = null;
}

async function updateSetting(key, value) {
  const updated = await window.api.setConfig(key, value);
  settingsConfig = updated;

  // Dispatch a custom event so other components can react
  window.dispatchEvent(new CustomEvent('config-changed', { detail: updated }));

  // Re-render just the relevant parts
  renderSettingsBody();
}

function renderSettingsModal() {
  let modal = document.getElementById('settings-modal');
  if (!modal) {
    modal = h('div', { id: 'settings-modal', className: 'modal hidden' });
    document.body.appendChild(modal);
  }

  modal.innerHTML = '';
  modal.classList.remove('hidden');

  const content = h('div', { className: 'modal-content settings-content' });

  // Header
  const header = h('div', { className: 'settings-header' }, [
    h('h2', {}, 'Settings'),
    h('button', {
      className: 'settings-close',
      title: 'Close',
      onClick: closeSettings,
    }, '\u00D7'),
  ]);
  content.appendChild(header);

  // Body (re-renderable)
  const body = h('div', { id: 'settings-body' });
  content.appendChild(body);

  modal.appendChild(content);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettings();
  });

  // Close on Escape key
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  renderSettingsBody();
}

function renderSettingsBody() {
  const body = document.getElementById('settings-body');
  if (!body || !settingsConfig) return;
  body.innerHTML = '';

  // ── Poll Interval ──────────────────────────────────
  body.appendChild(renderSection('Poll Frequency', renderPollInterval()));

  // ── Theme ──────────────────────────────────────────
  body.appendChild(renderSection('Theme', renderThemeToggle()));

  // ── Notifications ──────────────────────────────────
  body.appendChild(renderSection('Notifications', renderToggle(
    'notifications',
    'Show desktop notifications on port conflicts',
    settingsConfig.notifications,
  )));

  // ── Resource Thresholds ────────────────────────────
  body.appendChild(renderSection('Resource Thresholds', renderThresholds()));

  // ── Process Grouping ───────────────────────────────
  body.appendChild(renderSection('Process Grouping', renderGrouping()));

  // ── Pinned Processes ───────────────────────────────
  body.appendChild(renderSection('Pinned Processes', renderPinnedList()));

  // ── Minimize to Tray ───────────────────────────────
  body.appendChild(renderSection('System Tray', renderToggle(
    'minimizeToTray',
    'Minimize to system tray on close',
    settingsConfig.minimizeToTray,
  )));

  // ── Autostart ──────────────────────────────────────
  body.appendChild(renderSection('Autostart', renderToggle(
    'autostart',
    'Launch on system login',
    settingsConfig.autostart,
  )));

  // ── Custom Grouping Rules ──────────────────────────
  body.appendChild(renderSection('Custom Grouping Rules', renderCustomRules()));

  // ── Profiles ───────────────────────────────────────
  body.appendChild(renderSection('Profiles', renderProfiles()));

  // ── Rules (rule engine) ────────────────────────────
  body.appendChild(renderSection('Rules', renderUserRules()));
}

function renderSection(title, content) {
  return h('div', { className: 'settings-section' }, [
    h('label', { className: 'settings-label' }, title),
    content,
  ]);
}

// ── Poll Interval slider ───────────────────────────────────
function renderPollInterval() {
  const wrapper = h('div', { className: 'settings-poll' });

  const display = h('span', { className: 'settings-poll-value' }, `${settingsConfig.pollInterval}s`);

  const slider = h('input', {
    type: 'range',
    min: '1',
    max: '10',
    step: '1',
    className: 'settings-slider',
  });
  slider.value = settingsConfig.pollInterval;

  slider.addEventListener('input', () => {
    display.textContent = `${slider.value}s`;
  });
  slider.addEventListener('change', () => {
    updateSetting('pollInterval', Number(slider.value));
  });

  const labels = h('div', { className: 'settings-slider-labels' }, [
    h('span', {}, '1s'),
    h('span', {}, '10s'),
  ]);

  wrapper.appendChild(h('div', { className: 'settings-slider-row' }, [slider, display]));
  wrapper.appendChild(labels);
  return wrapper;
}

// ── Theme toggle ───────────────────────────────────────────
function renderThemeToggle() {
  const wrapper = h('div', { className: 'settings-theme-btns' });

  for (const theme of ['dark', 'light']) {
    const isActive = settingsConfig.theme === theme;
    const btn = h('button', {
      className: `settings-theme-btn ${isActive ? 'active' : ''}`,
      onClick: () => updateSetting('theme', theme),
    }, theme.charAt(0).toUpperCase() + theme.slice(1));
    wrapper.appendChild(btn);
  }

  return wrapper;
}

// ── Generic toggle ─────────────────────────────────────────
function renderToggle(key, label, value) {
  const wrapper = h('div', { className: 'settings-toggle-row' });

  const text = h('span', { className: 'settings-toggle-label' }, label);

  const toggle = h('button', {
    className: `settings-toggle ${value ? 'on' : 'off'}`,
    onClick: () => updateSetting(key, !value),
  }, value ? 'ON' : 'OFF');

  wrapper.appendChild(text);
  wrapper.appendChild(toggle);
  return wrapper;
}

// ── Resource Thresholds ────────────────────────────────────
function renderThresholds() {
  const wrapper = h('div', { className: 'settings-thresholds' });

  const hint = h('p', { className: 'settings-hint' },
    'Notify when a process sustains high CPU or memory usage. Set to 0 to disable.');
  wrapper.appendChild(hint);

  const cpuInput = h('input', {
    type: 'number', min: '0', max: '100', step: '1',
    className: 'settings-threshold-input',
  });
  cpuInput.value = settingsConfig.cpuThreshold || 0;
  cpuInput.addEventListener('change', () => {
    updateSetting('cpuThreshold', Number(cpuInput.value) || 0);
  });

  const memInput = h('input', {
    type: 'number', min: '0', step: '50',
    className: 'settings-threshold-input',
  });
  memInput.value = settingsConfig.memThresholdMB || 0;
  memInput.addEventListener('change', () => {
    updateSetting('memThresholdMB', Number(memInput.value) || 0);
  });

  const sustainInput = h('input', {
    type: 'number', min: '1', max: '60', step: '1',
    className: 'settings-threshold-input',
  });
  sustainInput.value = settingsConfig.thresholdSustainPolls || 3;
  sustainInput.addEventListener('change', () => {
    updateSetting('thresholdSustainPolls', Number(sustainInput.value) || 3);
  });

  wrapper.appendChild(h('div', { className: 'settings-threshold-row' }, [
    h('label', {}, 'CPU %'), cpuInput,
    h('label', {}, 'Memory MB'), memInput,
    h('label', {}, 'Sustain polls'), sustainInput,
  ]));

  return wrapper;
}

// ── Process Grouping ───────────────────────────────────────
function renderGrouping() {
  const wrapper = h('div', { className: 'settings-grouping' });

  wrapper.appendChild(h('p', { className: 'settings-hint' },
    'Collapse identical process names (e.g. many node.exe from an agent) into a single row with a bulk-kill button.'));

  wrapper.appendChild(renderToggle(
    'clusterProcesses',
    'Group identical processes',
    settingsConfig.clusterProcesses !== false,
  ));

  wrapper.appendChild(h('p', { className: 'settings-hint', style: 'margin-top:12px' },
    'Warn when this many dev processes share a name. Set to 0 to disable.'));

  const dupInput = h('input', {
    type: 'number', min: '0', max: '100', step: '1',
    className: 'settings-threshold-input',
  });
  dupInput.value = settingsConfig.duplicateThreshold || 0;
  dupInput.addEventListener('change', () => {
    updateSetting('duplicateThreshold', Number(dupInput.value) || 0);
  });

  wrapper.appendChild(h('div', { className: 'settings-dup-row' }, [
    h('label', {}, 'Warn at'), dupInput, h('label', {}, 'duplicates'),
  ]));

  return wrapper;
}

// ── Pinned Processes ────────────────────────────────────────
function renderPinnedList() {
  const wrapper = h('div', { className: 'settings-pinned' });
  const names = settingsConfig.pinnedNames || [];

  if (names.length === 0) {
    wrapper.appendChild(h('p', { className: 'settings-profiles-empty' },
      'No pinned processes. Right-click any process to pin it.'));
    return wrapper;
  }

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const row = h('div', { className: 'settings-rule-row' }, [
      h('span', { className: 'settings-pinned-name' }, name),
      h('button', {
        className: 'settings-rule-remove',
        title: 'Unpin',
        onClick: () => {
          const updated = names.filter((_, j) => j !== i);
          updateSetting('pinnedNames', updated);
        },
      }, '\u00D7'),
    ]);
    wrapper.appendChild(row);
  }

  return wrapper;
}

// ── Custom Grouping Rules ──────────────────────────────────
function renderCustomRules() {
  const wrapper = h('div', { className: 'settings-rules' });

  const rules = settingsConfig.customRules || [];

  if (rules.length > 0) {
    const table = h('div', { className: 'settings-rules-list' });
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const row = h('div', { className: 'settings-rule-row' }, [
        h('code', { className: 'settings-rule-pattern' }, rule.pattern),
        h('span', { className: 'settings-rule-arrow' }, '\u2192'),
        h('span', { className: `settings-rule-group group-color-${rule.group}` }, GROUP_LABELS[rule.group] || rule.group),
        h('button', {
          className: 'settings-rule-remove',
          title: 'Remove rule',
          onClick: () => {
            const updated = [...rules];
            updated.splice(i, 1);
            updateSetting('customRules', updated);
          },
        }, '\u00D7'),
      ]);
      table.appendChild(row);
    }
    wrapper.appendChild(table);
  }

  // Add new rule form
  const form = h('div', { className: 'settings-rule-form' });

  const patternInput = h('input', {
    type: 'text',
    className: 'settings-rule-input',
    placeholder: 'Regex pattern (e.g. myapp|myservice)',
  });

  const groupSelect = h('select', { className: 'settings-rule-select' });
  for (const g of VALID_GROUPS) {
    const opt = h('option', { value: g }, GROUP_LABELS[g] || g);
    groupSelect.appendChild(opt);
  }

  const addBtn = h('button', {
    className: 'btn btn-secondary settings-rule-add',
    onClick: () => {
      const pattern = patternInput.value.trim();
      if (!pattern) return;

      // Validate regex
      try {
        new RegExp(pattern, 'i');
      } catch {
        patternInput.classList.add('input-error');
        setTimeout(() => patternInput.classList.remove('input-error'), 1500);
        return;
      }

      const group = groupSelect.value;
      const updated = [...(settingsConfig.customRules || []), { pattern, group }];
      updateSetting('customRules', updated);
    },
  }, 'Add');

  form.appendChild(patternInput);
  form.appendChild(groupSelect);
  form.appendChild(addBtn);
  wrapper.appendChild(form);

  return wrapper;
}

// ── Profiles ───────────────────────────────────────────────
function renderProfiles() {
  const wrapper = h('div', { className: 'settings-profiles' });
  const profiles = settingsConfig.profiles || [];

  if (profiles.length === 0) {
    wrapper.appendChild(h('p', { className: 'settings-profiles-empty' },
      'No profiles yet. Right-click any process to add it to a profile.'));
  }

  for (let pi = 0; pi < profiles.length; pi++) {
    const profile = profiles[pi];
    const card = h('div', { className: 'settings-profile-card' });

    // Profile header: name + delete button
    const header = h('div', { className: 'settings-profile-header' }, [
      h('span', { className: 'settings-profile-name' }, profile.name),
      h('button', {
        className: 'settings-rule-remove',
        title: 'Delete profile',
        onClick: () => {
          const updated = profiles.filter((_, i) => i !== pi);
          updateSetting('profiles', updated);
        },
      }, '\u00D7'),
    ]);
    card.appendChild(header);

    // Services list
    if (profile.services.length > 0) {
      const serviceList = h('div', { className: 'settings-service-list' });

      for (let si = 0; si < profile.services.length; si++) {
        const svc = profile.services[si];

        const cmdInput = h('input', {
          type: 'text',
          className: 'settings-rule-input settings-svc-cmd',
          placeholder: 'Start command (optional)',
          value: svc.command || '',
        });
        cmdInput.value = svc.command || '';
        cmdInput.addEventListener('change', () => {
          const updated = profiles.map((p, i) => {
            if (i !== pi) return p;
            const svcs = p.services.map((s, j) =>
              j === si ? { ...s, command: cmdInput.value.trim() } : s
            );
            return { ...p, services: svcs };
          });
          updateSetting('profiles', updated);
        });

        const cwdInput = h('input', {
          type: 'text',
          className: 'settings-rule-input settings-svc-cwd',
          placeholder: 'Working dir (optional)',
          value: svc.cwd || '',
        });
        cwdInput.value = svc.cwd || '';
        cwdInput.addEventListener('change', () => {
          const updated = profiles.map((p, i) => {
            if (i !== pi) return p;
            const svcs = p.services.map((s, j) =>
              j === si ? { ...s, cwd: cwdInput.value.trim() } : s
            );
            return { ...p, services: svcs };
          });
          updateSetting('profiles', updated);
        });

        const row = h('div', { className: 'settings-service-row' }, [
          h('span', { className: 'settings-svc-name' }, svc.name),
          cmdInput,
          cwdInput,
          h('button', {
            className: 'settings-rule-remove',
            title: 'Remove service',
            onClick: () => {
              const updated = profiles.map((p, i) => {
                if (i !== pi) return p;
                return { ...p, services: p.services.filter((_, j) => j !== si) };
              });
              updateSetting('profiles', updated);
            },
          }, '\u00D7'),
        ]);

        serviceList.appendChild(row);
      }

      card.appendChild(serviceList);
    } else {
      card.appendChild(h('p', { className: 'settings-profiles-empty' },
        'No services. Right-click a process to add it here.'));
    }

    wrapper.appendChild(card);
  }

  wrapper.appendChild(renderProfileSuggestions(profiles));

  return wrapper;
}

// ── Profile suggestions (auto-generated from a folder scan) ──
// State survives body re-renders while the panel is open.
let pendingProfileSuggestions = null; // null = hidden, [] = scan found nothing

function renderProfileSuggestions(profiles) {
  // Reset the pending scan whenever the settings modal closes so a stale
  // panel does not reappear on the next open. (closeSettings is shared code
  // owned outside this section, so observe the modal instead of editing it.)
  const modal = document.getElementById('settings-modal');
  if (modal && !modal.dataset.suggestionsObserved) {
    modal.dataset.suggestionsObserved = '1';
    new MutationObserver(() => {
      if (modal.classList.contains('hidden')) pendingProfileSuggestions = null;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  const wrapper = h('div', { className: 'profile-suggestions' });

  const importBtn = h('button', {
    className: 'btn btn-secondary profile-suggestions-import',
    onClick: async () => {
      const res = await window.api.scanProfileSuggestions();
      if (!res || res.canceled) return;
      if (!res.success) {
        showError(res.error || 'Failed to scan folder');
        return;
      }
      pendingProfileSuggestions = res.suggestions || [];
      renderSettingsBody();
    },
  }, 'Import suggestions…');
  wrapper.appendChild(importBtn);

  if (pendingProfileSuggestions === null) return wrapper;

  const panel = h('div', { className: 'profile-suggestions-panel' });

  const closePanel = () => {
    pendingProfileSuggestions = null;
    renderSettingsBody();
  };

  if (pendingProfileSuggestions.length === 0) {
    panel.appendChild(h('p', { className: 'settings-profiles-empty' },
      'No projects found in the selected folder.'));
    panel.appendChild(h('div', { className: 'profile-suggestions-actions' }, [
      h('button', { className: 'btn btn-secondary', onClick: closePanel }, 'Close'),
    ]));
    wrapper.appendChild(panel);
    return wrapper;
  }

  panel.appendChild(h('p', { className: 'settings-hint' },
    'Select the services to import as a new profile.'));

  const checkboxes = [];
  const list = h('div', { className: 'profile-suggestions-list' });
  for (const suggestion of pendingProfileSuggestions) {
    const checkbox = h('input', { type: 'checkbox', className: 'profile-suggestion-check' });
    checkbox.checked = true;
    checkboxes.push({ checkbox, suggestion });

    const label = h('label', { className: 'profile-suggestion-row' }, [
      checkbox,
      h('span', { className: 'profile-suggestion-name' }, suggestion.name),
      h('code', { className: 'profile-suggestion-cmd' }, suggestion.command),
      h('span', { className: 'profile-suggestion-cwd', title: suggestion.cwd }, suggestion.cwd),
    ]);
    list.appendChild(label);
  }
  panel.appendChild(list);

  const confirmBtn = h('button', {
    className: 'btn btn-secondary profile-suggestions-confirm',
    onClick: () => {
      const selected = checkboxes
        .filter(({ checkbox }) => checkbox.checked)
        .map(({ suggestion }) => suggestion);
      if (selected.length === 0) {
        closePanel();
        return;
      }

      // Deterministic ids: the profile gets the timestamp and each service
      // gets timestamp + index, so ids are unique within this import.
      // (context-menu.js makeServiceEntry mints one id per user action and
      // can afford randomness; a batch cannot.)
      const now = Date.now();
      const profile = {
        id: String(now),
        name: 'Imported suggestions',
        services: selected.map((s, i) => ({
          id: String(now + i + 1),
          name: s.name,
          pattern: s.pattern,
          command: s.command,
          cwd: s.cwd,
        })),
      };

      pendingProfileSuggestions = null;
      updateSetting('profiles', [...profiles, profile]);
    },
  }, 'Add selected');

  panel.appendChild(h('div', { className: 'profile-suggestions-actions' }, [
    confirmBtn,
    h('button', { className: 'btn btn-secondary', onClick: closePanel }, 'Cancel'),
  ]));

  wrapper.appendChild(panel);
  return wrapper;
}

// ── Rules (user-defined rule engine) ───────────────────────
function renderUserRules() {
  const wrapper = h('div', { className: 'settings-rules settings-user-rules' });

  wrapper.appendChild(h('p', { className: 'settings-hint' },
    'When a process matching the pattern stays over the threshold for N consecutive polls, notify, kill it, or run a command.'));

  const rules = settingsConfig.userRules || [];

  if (rules.length > 0) {
    const list = h('div', { className: 'settings-rules-list' });
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const unit = rule.metric === 'mem' ? 'MB' : '%';
      const metricLabel = rule.metric === 'mem' ? 'Memory' : 'CPU';
      let actionLabel = rule.action;
      if (rule.action === 'command') actionLabel = `run: ${rule.command}`;
      const desc = `${metricLabel} > ${rule.threshold}${unit} for ${rule.sustainPolls} polls → ${actionLabel}`;

      const row = h('div', { className: 'settings-rule-row' }, [
        h('code', { className: 'settings-rule-pattern' }, rule.pattern),
        h('span', { className: 'settings-user-rule-desc' }, desc),
        h('button', {
          className: 'settings-rule-remove',
          title: 'Remove rule',
          onClick: () => {
            const updated = rules.filter((_, j) => j !== i);
            updateSetting('userRules', updated);
          },
        }, '×'),
      ]);
      list.appendChild(row);
    }
    wrapper.appendChild(list);
  }

  // Add new rule form
  const form = h('div', { className: 'settings-user-rule-form' });

  const patternInput = h('input', {
    type: 'text',
    className: 'settings-rule-input',
    placeholder: 'Regex pattern (e.g. node|python)',
  });

  const metricSelect = h('select', { className: 'settings-rule-select' }, [
    h('option', { value: 'cpu' }, 'CPU %'),
    h('option', { value: 'mem' }, 'Memory MB'),
  ]);

  const thresholdInput = h('input', {
    type: 'number', min: '1', step: '1',
    className: 'settings-threshold-input',
    placeholder: '80',
  });

  const sustainInput = h('input', {
    type: 'number', min: '1', max: '60', step: '1',
    className: 'settings-threshold-input',
  });
  sustainInput.value = 3;

  const actionSelect = h('select', { className: 'settings-rule-select' }, [
    h('option', { value: 'notify' }, 'Notify'),
    h('option', { value: 'kill' }, 'Kill'),
    h('option', { value: 'command' }, 'Run command'),
  ]);

  const commandInput = h('input', {
    type: 'text',
    className: 'settings-rule-input',
    placeholder: 'Command to run',
  });
  const cwdInput = h('input', {
    type: 'text',
    className: 'settings-rule-input',
    placeholder: 'Working dir (optional)',
  });
  const commandRow = h('div', { className: 'settings-user-rule-command hidden' }, [
    commandInput,
    cwdInput,
  ]);
  actionSelect.addEventListener('change', () => {
    commandRow.classList.toggle('hidden', actionSelect.value !== 'command');
  });

  const flashError = (input) => {
    input.classList.add('input-error');
    setTimeout(() => input.classList.remove('input-error'), 1500);
  };

  const addBtn = h('button', {
    className: 'btn btn-secondary settings-rule-add',
    onClick: () => {
      const pattern = patternInput.value.trim();
      if (!pattern) return flashError(patternInput);
      try {
        new RegExp(pattern, 'i');
      } catch {
        return flashError(patternInput);
      }

      const threshold = Number(thresholdInput.value);
      if (!threshold || threshold <= 0) return flashError(thresholdInput);

      const sustainPolls = Math.max(1, Math.min(60, Number(sustainInput.value) || 3));
      const action = actionSelect.value;
      const command = commandInput.value.trim();
      const cwd = cwdInput.value.trim();
      if (action === 'command' && !command) return flashError(commandInput);

      // No id here — config validation assigns one and the validated
      // config round-trips back into settingsConfig via updateSetting.
      const rule = {
        pattern,
        metric: metricSelect.value,
        threshold,
        sustainPolls,
        action,
      };
      if (action === 'command') {
        rule.command = command;
        if (cwd) rule.cwd = cwd;
      }

      updateSetting('userRules', [...(settingsConfig.userRules || []), rule]);
    },
  }, 'Add');

  form.appendChild(patternInput);
  form.appendChild(h('div', { className: 'settings-user-rule-fields' }, [
    metricSelect,
    h('label', {}, '>'),
    thresholdInput,
    h('label', {}, 'for'),
    sustainInput,
    h('label', {}, 'polls'),
    actionSelect,
    addBtn,
  ]));
  form.appendChild(commandRow);
  wrapper.appendChild(form);

  return wrapper;
}
