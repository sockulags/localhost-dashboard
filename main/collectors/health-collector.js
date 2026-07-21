const http = require('node:http');

const PROBE_TIMEOUT_MS = 800;
const PROBE_INTERVAL_MS = 5000; // re-probe at most this often (~every 2-5 polls)

function defaultHttpGet(url, options, callback) {
  return http.get(url, options, callback);
}

/**
 * Probe a single port with an HTTP GET. Any HTTP response (even 500)
 * counts as up; connection refused/timeout/reset counts as down.
 * Never rejects.
 *
 * Limitation: probes plain HTTP on 127.0.0.1 only — HTTPS-only or
 * IPv6-only servers will report as down.
 */
function probePort(port, httpGet) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = httpGet(
      `http://127.0.0.1:${port}/`,
      { timeout: PROBE_TIMEOUT_MS, agent: false },
      (res) => {
        res.resume(); // drain so the socket is released
        resolve({ up: true, latencyMs: Date.now() - started });
      }
    );
    // destroy(err) surfaces as an 'error' event, which resolves as down
    req.on('timeout', () => req.destroy(new Error('probe timeout')));
    req.on('error', () => resolve({ up: false, latencyMs: null }));
  });
}

/**
 * Probe a list of ports concurrently (deduped).
 * Returns Map<port, { up: boolean, latencyMs: number|null }>.
 * `httpGet` is injectable for tests.
 */
async function probe(ports, { httpGet = defaultHttpGet } = {}) {
  const unique = [...new Set(ports || [])];
  const results = await Promise.all(unique.map((p) => probePort(p, httpGet)));
  return new Map(unique.map((port, i) => [port, results[i]]));
}

let lastProbeAt = -Infinity;
let probing = false;
let cachedHealth = new Map();

/**
 * Throttling wrapper around probe(). Returns the cached Map immediately
 * (never blocks the poll) and, at most every PROBE_INTERVAL_MS, kicks off
 * a background probe that refreshes the cache for the next poll. Cache
 * entries for ports no longer listening are dropped; ports not yet probed
 * simply have no entry (unknown).
 *
 * `opts.httpGet` and `opts.now` are injectable for tests.
 */
function collect(ports, opts = {}) {
  const now = opts.now || Date.now;

  // Drop stale entries for ports that are no longer listening
  const portSet = new Set(ports || []);
  for (const port of [...cachedHealth.keys()]) {
    if (!portSet.has(port)) cachedHealth.delete(port);
  }

  const t = now();
  if (!probing && t - lastProbeAt >= PROBE_INTERVAL_MS) {
    probing = true;
    lastProbeAt = t;
    probe(ports, opts).then(
      (map) => {
        cachedHealth = map;
        probing = false;
      },
      () => {
        probing = false;
      }
    );
  }

  return cachedHealth;
}

// Reset throttle state and cached results (for tests)
function resetCache() {
  lastProbeAt = -Infinity;
  probing = false;
  cachedHealth = new Map();
}

module.exports = { probe, collect, resetCache };
