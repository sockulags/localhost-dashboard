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
