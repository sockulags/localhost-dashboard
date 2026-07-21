/* Event timeline – modal overlay listing persisted start/stop/warning events */

let timelineEvents = [];
let timelineFilter = 'all';

const TIMELINE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'start', label: 'Starts' },
  { id: 'stop', label: 'Stops' },
  { id: 'warning', label: 'Warnings' },
];

const TIMELINE_TYPE_META = {
  start: { icon: '▶', label: 'started' },
  stop: { icon: '■', label: 'stopped' },
  warning: { icon: '⚠', label: '' },
};

/** Relative timestamp: "just now", "45s ago", "2m 30s ago", "3h 12m ago". */
function timelineRelTime(ts) {
  const ms = Date.now() - ts;
  if (!ts || ms < 0) return '—';
  if (ms < 10000) return 'just now';
  return `${formatUptime(ts)} ago`; // reuse utils/format.js elapsed formatter
}

let timelineKeyHandler = null;

function showTimeline() {
  renderTimelineModal();
  refreshTimeline();
}

function closeTimeline() {
  const modal = document.getElementById('timeline-modal');
  if (modal) modal.classList.add('hidden');
  if (timelineKeyHandler) {
    document.removeEventListener('keydown', timelineKeyHandler);
    timelineKeyHandler = null;
  }
}

async function refreshTimeline() {
  try {
    const res = await window.api.getEventHistory();
    timelineEvents = (res && res.success && Array.isArray(res.events)) ? res.events : [];
  } catch {
    timelineEvents = [];
  }
  renderTimelineBody();
}

function renderTimelineModal() {
  let modal = document.getElementById('timeline-modal');
  if (!modal) {
    modal = h('div', { id: 'timeline-modal', className: 'modal hidden' });
    document.body.appendChild(modal);
    // Attached once here (the element is reused across opens) so backdrop
    // listeners do not accumulate.
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeTimeline();
    });
  }

  modal.innerHTML = '';
  modal.classList.remove('hidden');

  const content = h('div', { className: 'modal-content timeline-content' });

  const refreshBtn = h('button', {
    className: 'timeline-refresh',
    title: 'Refresh',
    onClick: refreshTimeline,
  }, '↻');

  const header = h('div', { className: 'timeline-header' }, [
    h('h2', {}, 'Event Timeline'),
    h('div', { className: 'timeline-header-actions' }, [
      refreshBtn,
      h('button', {
        className: 'settings-close',
        title: 'Close',
        onClick: closeTimeline,
      }, '×'),
    ]),
  ]);
  content.appendChild(header);

  // Filter chips
  const chips = h('div', { className: 'timeline-chips' });
  for (const f of TIMELINE_FILTERS) {
    chips.appendChild(h('button', {
      className: `timeline-chip ${timelineFilter === f.id ? 'active' : ''}`,
      dataset: { filter: f.id },
      onClick: () => {
        timelineFilter = f.id;
        for (const c of chips.children) {
          c.classList.toggle('active', c.dataset.filter === timelineFilter);
        }
        renderTimelineBody();
      },
    }, f.label));
  }
  content.appendChild(chips);

  content.appendChild(h('div', { id: 'timeline-body', className: 'timeline-body' }));
  modal.appendChild(content);

  // Close on Escape key; closeTimeline() removes the handler however the
  // modal ends up closed (Esc, backdrop or the × button).
  if (timelineKeyHandler) document.removeEventListener('keydown', timelineKeyHandler);
  timelineKeyHandler = (e) => {
    if (e.key === 'Escape') closeTimeline();
  };
  document.addEventListener('keydown', timelineKeyHandler);
}

function buildTimelineItem(event) {
  const meta = TIMELINE_TYPE_META[event.type] || { icon: '•', label: event.type };

  const text = event.type === 'warning'
    ? (event.message || 'Warning')
    : `${event.name || 'unknown'} ${meta.label} (PID ${event.pid})`;

  const time = h('span', {
    className: 'timeline-time',
    title: event.ts ? new Date(event.ts).toLocaleString() : '',
  }, timelineRelTime(event.ts));

  return h('div', { className: `timeline-item timeline-${event.type}` }, [
    h('span', { className: 'timeline-icon' }, meta.icon),
    h('span', { className: 'timeline-text' }, text),
    time,
  ]);
}

function renderTimelineBody() {
  const body = document.getElementById('timeline-body');
  if (!body) return;
  body.innerHTML = '';

  const filtered = timelineFilter === 'all'
    ? timelineEvents
    : timelineEvents.filter((e) => e.type === timelineFilter);

  if (filtered.length === 0) {
    body.appendChild(h('p', { className: 'timeline-empty' },
      'No events recorded yet. Starts, stops and warnings will show up here as they happen.'));
    return;
  }

  for (const event of filtered) {
    body.appendChild(buildTimelineItem(event));
  }
}
