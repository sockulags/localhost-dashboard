const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'style') {
        el.setAttribute('style', value);
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  return el;
}

/**
 * Render a small inline sparkline SVG from an array of numeric values.
 * @param {number[]} values - Data points to plot
 * @param {object} opts
 * @param {number} opts.width - SVG width (default 48)
 * @param {number} opts.height - SVG height (default 16)
 * @param {string} opts.stroke - Line color
 * @param {string} opts.fill - Fill color (gradient bottom)
 * @returns {SVGElement}
 */
function renderSparkline(values, opts = {}) {
  const width = opts.width || 48;
  const height = opts.height || 16;
  const stroke = opts.stroke || 'var(--accent-blue)';
  const fill = opts.fill || 'rgba(122, 162, 247, 0.15)';
  const padding = 1;

  const svg = svgEl('svg', {
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    class: 'sparkline',
  });

  if (!values || values.length < 2) {
    return svg;
  }

  const max = Math.max(...values, 1);
  const min = 0;
  const range = max - min || 1;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * plotW;
    const y = padding + plotH - ((v - min) / range) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = svgEl('polyline', {
    points: points.join(' '),
    'stroke-width': '1.2',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    style: `fill:none;stroke:${stroke}`,
  });

  // Fill area under the line
  const firstX = padding;
  const lastX = padding + plotW;
  const bottom = height - padding;
  const areaPoints = `${firstX},${bottom} ${points.join(' ')} ${lastX},${bottom}`;

  const polygon = svgEl('polygon', {
    points: areaPoints,
    style: `fill:${fill};stroke:none`,
  });

  svg.appendChild(polygon);
  svg.appendChild(polyline);

  return svg;
}

/**
 * Render a larger detail chart in a modal.
 * @param {number} pid
 * @param {'cpu'|'ram'} metric
 */
function showSparklineDetail(pid, metric) {
  // Remove any existing sparkline modal
  const existing = document.querySelector('.sparkline-modal');
  if (existing) existing.remove();

  const history = AppState.getHistory(pid);
  if (!history || history.length < 2) return;

  const values = history.map((entry) => (metric === 'cpu' ? entry.cpu : entry.memKB));
  const isCpu = metric === 'cpu';

  const stroke = isCpu ? 'var(--accent-amber)' : 'var(--accent-purple)';
  const fill = isCpu ? 'rgba(224, 175, 104, 0.2)' : 'rgba(187, 154, 247, 0.2)';
  const label = isCpu ? 'CPU %' : 'Memory';

  // Create modal
  const overlay = h('div', { className: 'modal sparkline-modal' });

  const chartWidth = 420;
  const chartHeight = 180;
  const marginLeft = 45;
  const marginBottom = 20;
  const marginTop = 10;
  const marginRight = 10;
  const plotW = chartWidth - marginLeft - marginRight;
  const plotH = chartHeight - marginTop - marginBottom;

  const max = Math.max(...values, isCpu ? 100 : 1);
  const min = 0;
  const range = max - min || 1;

  const svg = svgEl('svg', {
    width: chartWidth,
    height: chartHeight,
    viewBox: `0 0 ${chartWidth} ${chartHeight}`,
    class: 'sparkline-detail-chart',
  });

  // Grid lines and Y-axis labels
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = marginTop + (i / gridSteps) * plotH;
    const val = max - (i / gridSteps) * range;

    const line = svgEl('line', {
      x1: marginLeft,
      y1: y,
      x2: chartWidth - marginRight,
      y2: y,
      'stroke-width': '0.5',
      style: 'stroke:var(--border-color)',
    });
    svg.appendChild(line);

    const text = svgEl('text', {
      x: marginLeft - 6,
      y: y + 3,
      'font-size': '9',
      'text-anchor': 'end',
      style: 'fill:var(--text-muted);font-family:var(--font-mono)',
    });
    text.textContent = isCpu ? `${val.toFixed(0)}%` : formatBytes(val);
    svg.appendChild(text);
  }

  // X-axis labels (time)
  const totalSeconds = (values.length - 1) * 3;
  const xLabels = [0, Math.floor(values.length / 2), values.length - 1];
  for (const idx of xLabels) {
    const x = marginLeft + (idx / (values.length - 1)) * plotW;
    const secsAgo = (values.length - 1 - idx) * 3;
    const text = svgEl('text', {
      x: x,
      y: chartHeight - 4,
      'font-size': '9',
      'text-anchor': 'middle',
      style: 'fill:var(--text-muted);font-family:var(--font-mono)',
    });
    text.textContent = secsAgo === 0 ? 'now' : `-${secsAgo}s`;
    svg.appendChild(text);
  }

  // Data line
  const points = values.map((v, i) => {
    const x = marginLeft + (i / (values.length - 1)) * plotW;
    const y = marginTop + plotH - ((v - min) / range) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Fill
  const firstX = marginLeft;
  const lastX = marginLeft + plotW;
  const bottomY = marginTop + plotH;
  const areaPoints = `${firstX},${bottomY} ${points.join(' ')} ${lastX},${bottomY}`;
  svg.appendChild(svgEl('polygon', { points: areaPoints, style: `fill:${fill};stroke:none` }));

  // Line
  svg.appendChild(
    svgEl('polyline', {
      points: points.join(' '),
      'stroke-width': '1.5',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      style: `fill:none;stroke:${stroke}`,
    })
  );

  // Current value dot
  const lastPoint = values[values.length - 1];
  const dotX = marginLeft + plotW;
  const dotY = marginTop + plotH - ((lastPoint - min) / range) * plotH;
  svg.appendChild(
    svgEl('circle', {
      cx: dotX.toFixed(1),
      cy: dotY.toFixed(1),
      r: '3',
      style: `fill:${stroke}`,
    })
  );

  // Build modal content
  const currentVal = isCpu ? formatCpu(lastPoint) : formatBytes(lastPoint);
  const maxVal = isCpu ? formatCpu(Math.max(...values)) : formatBytes(Math.max(...values));
  const avgVal = values.reduce((a, b) => a + b, 0) / values.length;
  const avgFormatted = isCpu ? formatCpu(avgVal) : formatBytes(avgVal);

  const content = h('div', { className: 'modal-content sparkline-detail-content' }, [
    h('div', { className: 'sparkline-detail-header' }, [
      h('span', { className: 'sparkline-detail-label' }, `${label} — PID ${pid}`),
      h('span', { className: 'sparkline-detail-stats' }, `Current: ${currentVal}  Avg: ${avgFormatted}  Peak: ${maxVal}`),
    ]),
    // SVG will be appended below
    h('div', { className: 'sparkline-detail-footer' }, [
      h('span', { className: 'sparkline-detail-samples' }, `${values.length} samples (${totalSeconds}s)`),
    ]),
  ]);

  // Insert SVG before footer
  content.insertBefore(svg, content.lastElementChild);

  overlay.appendChild(content);

  function closeModal() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}
