function renderStatusBar() {
  const bar = document.getElementById('status-bar');
  const warningCount = AppState.warnings.length;
  const elapsed = AppState.lastUpdated
    ? Math.round((Date.now() - AppState.lastUpdated) / 1000)
    : null;

  const warningText = warningCount > 0
    ? `⚠ ${warningCount} warning${warningCount > 1 ? 's' : ''}`
    : '✓ No warnings';

  const warningClass = warningCount > 0 ? 'status-warnings' : '';

  bar.innerHTML = '';
  bar.appendChild(
    h('div', { className: 'status-section' }, [
      h('span', { className: warningClass }, warningText),
      h('span', {}, `${AppState.totalProcesses} processes`),
    ])
  );
  bar.appendChild(
    h('div', { className: 'status-section' }, [
      h('span', {}, elapsed !== null ? `Last refresh: ${elapsed}s ago` : 'Loading...'),
    ])
  );
}
