/*
 * Opt-in local read-only HTTP API.
 *
 * Lets same-machine tooling (e.g. coding agents) ask "which ports are busy?
 * is the DB running?" without driving the UI. GET-only, bound explicitly to
 * 127.0.0.1, OFF by default (see config keys httpApiEnabled / httpApiPort).
 *
 * Plain CommonJS + node:http only — no Electron imports — so it can be unit
 * tested under bare Node.
 */

const http = require('node:http');

// Single route registry: drives dispatch, the '/' index, and 404 hints.
const ROUTES = {
  '/processes': {
    description: 'Flattened process list (pid, name, group, cpu, memKB, ports)',
    handler: (snapshot) => flattenProcesses(snapshot),
  },
  '/ports': {
    description: 'Listening ports ({ port, pid, processName })',
    handler: (snapshot) => collectPorts(snapshot),
  },
  '/containers': {
    description: 'Docker containers',
    handler: (snapshot) => snapshot.containers || [],
  },
  '/warnings': {
    description: 'Active warnings',
    handler: (snapshot) => snapshot.warnings || [],
  },
};

let server = null;

// start/stop/restart mutate the module-level `server`; serialize them so a
// stop() can never close a socket whose 'listening' event hasn't fired yet
// (which would leave start()'s promise unsettled) and rapid enable/disable
// toggles from the settings UI can't interleave.
let opChain = Promise.resolve();

function enqueue(fn) {
  const result = opChain.then(fn);
  // The queued ops never reject, but keep the chain safe regardless.
  opChain = result.then(() => {}, () => {});
  return result;
}

function flattenProcesses(snapshot) {
  const out = [];
  const groups = snapshot.groups || {};
  for (const groupKey of Object.keys(groups)) {
    const group = groups[groupKey] || {};
    for (const proc of group.processes || []) {
      out.push({
        pid: proc.pid,
        name: proc.name,
        group: proc.group || group.key || groupKey,
        cpu: proc.cpu,
        memKB: proc.memKB,
        ports: proc.ports || [],
      });
    }
  }
  return out;
}

function collectPorts(snapshot) {
  const out = [];
  for (const proc of flattenProcesses(snapshot)) {
    for (const port of proc.ports) {
      out.push({ port, pid: proc.pid, processName: proc.name });
    }
  }
  return out;
}

function routeIndex() {
  const routes = { '/': 'JSON index of routes' };
  for (const [route, def] of Object.entries(ROUTES)) {
    routes[route] = def.description;
  }
  return { routes };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// The loopback bind keeps remote hosts out, but a malicious web page can
// still reach us via DNS rebinding (evil.com resolving to 127.0.0.1 makes
// the browser's fetch same-origin — CORS never applies). Reject any request
// whose Host header names something other than this machine's loopback.
function isLocalHostHeader(host) {
  if (!host) return true; // raw local clients (no Host header) are fine
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

function handleRequest(getSnapshot, req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'GET only' });
    return;
  }

  if (!isLocalHostHeader(req.headers.host)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch {
    pathname = null;
  }

  if (pathname === '/') {
    sendJson(res, 200, routeIndex());
    return;
  }

  const route = pathname ? ROUTES[pathname] : null;
  if (!route) {
    sendJson(res, 404, { error: 'Not found', routes: Object.keys(ROUTES) });
    return;
  }

  let snapshot;
  try {
    snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    sendJson(res, 503, { error: 'no snapshot yet' });
    return;
  }

  sendJson(res, 200, route.handler(snapshot));
}

function doStart({ getSnapshot, port } = {}) {
  return new Promise((resolve) => {
    try {
      if (server) {
        // Already running — no-op. Ops are serialized, so the previous
        // start has fully bound and address() is available. Use restart()
        // to apply new options.
        const addr = server.address();
        resolve(addr ? addr.port : null);
        return;
      }

      const srv = http.createServer((req, res) => {
        try {
          handleRequest(getSnapshot, req, res);
        } catch (err) {
          try {
            sendJson(res, 500, { error: err.message });
          } catch {
            /* response already gone */
          }
        }
      });

      srv.on('error', (err) => {
        console.warn(`[http-api] server error (${err.code || err.message}) — API disabled`);
        if (server === srv) server = null;
        try {
          srv.close();
        } catch {
          /* already closed */
        }
        resolve(null);
      });

      server = srv;
      // Bind explicitly to loopback: never reachable from the network.
      srv.listen(port, '127.0.0.1', () => {
        resolve(srv.address().port);
      });
    } catch (err) {
      console.warn(`[http-api] failed to start: ${err.message}`);
      server = null;
      resolve(null);
    }
  });
}

function doStop() {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    const srv = server;
    server = null;
    try {
      srv.close(() => resolve());
      // Drop keep-alive connections so close() doesn't hang.
      if (typeof srv.closeAllConnections === 'function') {
        srv.closeAllConnections();
      }
    } catch {
      resolve();
    }
  });
}

/**
 * Start the API server. Never throws or rejects; resolves with the bound
 * port (useful when passing port 0 in tests), or null if the server could
 * not be started (e.g. EADDRINUSE).
 */
function start(opts) {
  return enqueue(() => doStart(opts));
}

/** Stop the server if running. Never throws; resolves when closed. */
function stop() {
  return enqueue(() => doStop());
}

/** Restart with new options (e.g. after a port change in settings). */
function restart(opts) {
  return enqueue(async () => {
    await doStop();
    return doStart(opts);
  });
}

module.exports = { start, stop, restart };
