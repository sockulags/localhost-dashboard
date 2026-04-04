/* Profile panel – rendered above the process groups */

function getProfileStatuses(profile) {
  const allProcesses = Object.values(AppState.groups || {}).flatMap((g) => g.processes || []);
  return profile.services.map((service) => {
    let regex = null;
    try { regex = new RegExp(service.pattern, 'i'); } catch { /* invalid regex */ }
    const matches = regex ? allProcesses.filter((p) => regex.test(p.name)) : [];
    return { service, running: matches.length > 0, pids: matches.map((p) => p.pid) };
  });
}

async function startProfile(profile) {
  const services = profile.services.filter((s) => s.command && s.command.trim());
  for (const service of services) {
    await window.api.launchServiceCommand(service.command, service.cwd);
  }
}

async function stopProfile(statuses) {
  const pids = statuses.flatMap((s) => s.pids);
  if (pids.length > 0) {
    await window.api.killProcesses(pids);
  }
}

function renderProfileBadge(running, total) {
  let mod = 'badge-none';
  if (total === 0) mod = 'badge-none';
  else if (running === total) mod = 'badge-all';
  else if (running > 0) mod = 'badge-partial';

  return h('span', { className: `profile-badge ${mod}` }, `${running}/${total}`);
}

function renderProfilePanel(container) {
  const profiles = AppState.profiles || [];
  container.innerHTML = '';
  if (profiles.length === 0) return;

  const panel = h('div', { className: 'profile-panel' });

  for (const profile of profiles) {
    const statuses = getProfileStatuses(profile);
    const running = statuses.filter((s) => s.running).length;
    const total = statuses.length;
    const hasCommands = profile.services.some((s) => s.command && s.command.trim());

    const startBtn = h('button', {
      className: 'btn-profile btn-profile-start',
      title: hasCommands ? 'Start all services' : 'No commands configured (edit in Settings)',
      disabled: !hasCommands,
      onClick: () => startProfile(profile),
    }, '▶ Start');

    const stopBtn = h('button', {
      className: 'btn-profile btn-profile-stop',
      title: 'Stop all running services',
      disabled: running === 0,
      onClick: () => stopProfile(statuses),
    }, '■ Stop');

    const card = h('div', { className: 'profile-card' }, [
      h('span', { className: 'profile-name' }, profile.name),
      renderProfileBadge(running, total),
      h('div', { className: 'profile-actions' }, [startBtn, stopBtn]),
    ]);

    panel.appendChild(card);
  }

  container.appendChild(panel);
}
