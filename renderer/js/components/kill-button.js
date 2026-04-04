function renderKillButton(pid, processName) {
  const btn = h('button', { className: 'kill-btn' }, 'Kill');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showKillConfirm(pid, processName);
  });

  return btn;
}

function showKillConfirm(pid, processName) {
  const modal = document.getElementById('confirm-modal');
  const message = document.getElementById('confirm-message');
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');

  message.textContent = `Kill ${processName} (PID ${pid})?`;
  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    noBtn.replaceWith(noBtn.cloneNode(true));
  };

  yesBtn.addEventListener('click', async () => {
    cleanup();
    const result = await window.api.killProcess(pid);
    if (!result.success) {
      showError(result.error);
    }
  }, { once: true });

  noBtn.addEventListener('click', cleanup, { once: true });
}

function showBatchKillConfirm(title, processes, onConfirm) {
  const modal = document.getElementById('batch-confirm-modal');
  const titleEl = document.getElementById('batch-confirm-title');
  const listEl = document.getElementById('batch-confirm-list');
  const yesBtn = document.getElementById('batch-confirm-yes');
  const noBtn = document.getElementById('batch-confirm-no');

  titleEl.textContent = title;
  listEl.innerHTML = '';

  for (const proc of processes) {
    const row = h('div', { className: 'batch-confirm-item' }, [
      h('span', { className: 'batch-confirm-name' }, proc.name),
      h('span', { className: 'batch-confirm-pid' }, `PID ${proc.pid}`),
      proc.ports && proc.ports.length > 0
        ? h('span', { className: 'batch-confirm-port' }, `:${proc.ports.join(', :')}`)
        : null,
    ].filter(Boolean));
    listEl.appendChild(row);
  }

  yesBtn.textContent = processes.length === 1 ? 'Kill' : `Kill All (${processes.length})`;
  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    noBtn.replaceWith(noBtn.cloneNode(true));
  };

  const onEscape = (e) => {
    if (e.key === 'Escape') cleanup();
  };
  document.addEventListener('keydown', onEscape);

  const cleanupAll = () => {
    cleanup();
    document.removeEventListener('keydown', onEscape);
  };

  yesBtn.addEventListener('click', async () => {
    cleanupAll();
    try {
      const pids = processes.map((p) => p.pid);
      const result = await onConfirm(pids);
      if (result && !result.success) {
        const failedNames = result.results
          .filter((r) => !r.success)
          .map((r) => {
            const proc = processes.find((p) => p.pid === r.pid);
            return `${proc ? proc.name : 'PID ' + r.pid}: ${r.error}`;
          });
        if (failedNames.length > 0) {
          showError(`Failed to kill ${failedNames.length} process(es):\n${failedNames.join('\n')}`);
        }
      }
    } catch (err) {
      showError(err.message || 'Unknown error');
    }
  }, { once: true });

  noBtn.addEventListener('click', cleanupAll, { once: true });
}

function showError(msg) {
  const modal = document.getElementById('confirm-modal');
  const message = document.getElementById('confirm-message');
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn = document.getElementById('confirm-no');

  message.textContent = `Error: ${msg}`;
  modal.classList.remove('hidden');
  yesBtn.style.display = 'none';
  noBtn.textContent = 'OK';

  noBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    yesBtn.style.display = '';
    noBtn.textContent = 'Cancel';
  }, { once: true });
}
