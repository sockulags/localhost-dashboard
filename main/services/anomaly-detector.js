const EXPECTED_PORT_PROCESS = {
  5432: /postgres/i,
  3306: /mysql|mariadb/i,
  27017: /mongod/i,
  6379: /redis/i,
  11211: /memcached/i,
  2375: /docker/i,
  2376: /docker/i,
  80: /nginx|apache|httpd|iis/i,
  443: /nginx|apache|httpd|iis/i,
  8080: /java|tomcat|node|python/i,
};

function detect(processes) {
  const warnings = [];

  for (const proc of processes) {
    if (!proc.ports || proc.ports.length === 0) continue;

    for (const port of proc.ports) {
      const expected = EXPECTED_PORT_PROCESS[port];
      if (expected && !expected.test(proc.name)) {
        warnings.push({
          pid: proc.pid,
          port,
          processName: proc.name,
          message: `Port ${port} is used by ${proc.name} (PID ${proc.pid}) — expected ${expected.source}`,
        });
      }
    }
  }

  return warnings;
}

module.exports = { detect };
