function formatBytes(kb) {
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatUptime(startedTimestamp) {
  if (!startedTimestamp) return '—';
  const ms = Date.now() - startedTimestamp;
  if (ms < 0) return '—';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatCpu(cpu) {
  return `${cpu.toFixed(1)}%`;
}

function cpuClass(cpu) {
  if (cpu >= 50) return 'cpu-high';
  if (cpu >= 15) return 'cpu-medium';
  return 'cpu-low';
}

function formatPort(ports) {
  if (!ports || ports.length === 0) return '—';
  if (ports.length <= 2) return ports.join(', ');
  return `${ports[0]}, ${ports[1]} +${ports.length - 2}`;
}
