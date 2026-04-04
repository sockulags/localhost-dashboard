/* Settings panel – rendered as a modal overlay */

const VALID_GROUPS = ['dev', 'docker', 'databases', 'apps', 'system'];
const GROUP_LABELS = {
  dev: 'Dev Processes',
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
