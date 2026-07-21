/* Snapshot diff view – modal comparing a saved snapshot export against now */

let diffKeydownHandler = null;

function closeDiffView() {
  const modal = document.getElementById('diff-modal');
  if (modal) modal.classList.add('hidden');
  if (diffKeydownHandler) {
    document.removeEventListener('keydown', diffKeydownHandler);
    diffKeydownHandler = null;
  }
}

/**
 * Invoke the import dialog in the main process and show the result.
 * Called from the header button and the Ctrl/Cmd+Shift+E shortcut.
 */
function importAndShowDiff() {
  window.api.importSnapshotDiff().then((result) => {
    if (!result || result.canceled) return;
    if (!result.success) {
      showToast(result.error || 'Snapshot comparison failed', { type: 'error', duration: 5000 });
      return;
    }
    showDiffView(result);
  }).catch((err) => {
    showToast(`Snapshot comparison failed: ${err.message || err}`, { type: 'error', duration: 5000 });
  });
}

function formatSigned(delta, fmt) {
  return `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
}

function diffDeltaClass(delta) {
  if (delta === 0) return '';
  return delta > 0 ? 'diff-delta-up' : 'diff-delta-down';
}

function renderDiffProcRow(p) {
  return h('div', { className: 'diff-row' }, [
    h('span', { className: 'diff-row-name' }, p.name || '(unknown)'),
    h('span', { className: 'diff-row-pid' }, `PID ${p.pid}`),
    h('span', { className: 'diff-row-group' }, p.group || ''),
    h('span', { className: 'diff-row-stat' }, formatCpu(p.cpu || 0)),
    h('span', { className: 'diff-row-stat' }, formatBytes(p.memKB || 0)),
  ]);
}

function renderDiffChangedRow(p) {
  return h('div', { className: 'diff-row' }, [
    h('span', { className: 'diff-row-name' }, p.name || '(unknown)'),
    h('span', { className: 'diff-row-pid' }, `PID ${p.pid}`),
    h('span', { className: 'diff-row-group' }, ''),
    h('span', {
      className: `diff-row-stat ${diffDeltaClass(p.cpuDelta)}`,
    }, formatSigned(p.cpuDelta, formatCpu)),
    h('span', {
      className: `diff-row-stat ${diffDeltaClass(p.memDeltaKB)}`,
    }, formatSigned(p.memDeltaKB, formatBytes)),
  ]);
}

function renderDiffSection(title, kind, items, renderRow) {
  const section = h('div', { className: `diff-section diff-section-${kind}` });
  section.appendChild(h('div', { className: 'diff-section-title' }, `${title} (${items.length})`));
  const list = h('div', { className: 'diff-list' });
  for (const item of items) {
    list.appendChild(renderRow(item));
  }
  section.appendChild(list);
  return section;
}

/**
 * Show the diff modal.
 * @param {{diff: {started: [], died: [], changed: []}, oldTimestamp: number|null}} result
 */
function showDiffView(result) {
  const d = (result && result.diff) || {};
  const started = Array.isArray(d.started) ? d.started : [];
  const died = Array.isArray(d.died) ? d.died : [];
  const changed = Array.isArray(d.changed) ? d.changed : [];

  let modal = document.getElementById('diff-modal');
  if (!modal) {
    modal = h('div', { id: 'diff-modal', className: 'modal hidden' });
    // Close on backdrop click — attached once, on creation.
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDiffView();
    });
    document.body.appendChild(modal);
  }

  modal.innerHTML = '';
  modal.classList.remove('hidden');

  const content = h('div', { className: 'modal-content diff-content' });

  // Header — show when the compared snapshot was taken
  const when = result && result.oldTimestamp
    ? new Date(result.oldTimestamp).toLocaleString()
    : 'unknown time';
  const header = h('div', { className: 'diff-header' }, [
    h('div', {}, [
      h('h2', {}, 'Snapshot comparison'),
      h('span', { className: 'diff-timestamp' }, `Compared against snapshot from ${when}`),
    ]),
    h('button', {
      className: 'settings-close',
      title: 'Close',
      onClick: closeDiffView,
    }, '×'),
  ]);
  content.appendChild(header);

  const body = h('div', { className: 'diff-body' });

  if (started.length === 0 && died.length === 0 && changed.length === 0) {
    body.appendChild(h('div', { className: 'diff-empty' },
      'No changes since snapshot — everything is exactly as it was.'));
  } else {
    if (started.length > 0) {
      body.appendChild(renderDiffSection('Started', 'started', started, renderDiffProcRow));
    }
    if (died.length > 0) {
      body.appendChild(renderDiffSection('Died', 'died', died, renderDiffProcRow));
    }
    if (changed.length > 0) {
      body.appendChild(renderDiffSection('Changed', 'changed', changed, renderDiffChangedRow));
    }
  }

  content.appendChild(body);
  modal.appendChild(content);

  // Close on Escape key — closeDiffView removes the handler again,
  // whichever way the modal is dismissed.
  if (diffKeydownHandler) document.removeEventListener('keydown', diffKeydownHandler);
  diffKeydownHandler = (e) => {
    if (e.key === 'Escape') closeDiffView();
  };
  document.addEventListener('keydown', diffKeydownHandler);
}
