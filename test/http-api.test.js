const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// http-api.js is Electron-free by design, so no module stubbing is needed.
const httpApi = require('../main/services/http-api');

const fakeSnapshot = {
  groups: {
    dev: {
      key: 'dev',
      icon: 'code',
      label: 'Dev Processes',
      order: 0,
      processes: [
        { pid: 100, name: 'node.exe', memKB: 204800, cpu: 12.5, started: 'x', ports: [3000, 3001], portDetails: [], group: 'dev', hasWarning: false },
        { pid: 101, name: 'vite.exe', memKB: 51200, cpu: 3.1, started: 'x', ports: [], portDetails: [], group: 'dev', hasWarning: false },
      ],
      totalCpu: 15.6,
      totalMemKB: 256000,
    },
    databases: {
      key: 'databases',
      icon: 'db',
      label: 'Databases',
      order: 1,
      processes: [
        { pid: 200, name: 'postgres.exe', memKB: 409600, cpu: 1.2, started: 'x', ports: [5432], portDetails: [], group: 'databases', hasWarning: true },
      ],
      totalCpu: 1.2,
      totalMemKB: 409600,
    },
  },
  containers: [
    { id: 'abc123', name: 'my-db', image: 'postgres:16', status: 'Up 2 hours', state: 'running', ports: ['5432:5432'], matchedPorts: [5432] },
  ],
  warnings: [{ type: 'port-conflict', port: 3000 }],
  timestamp: 1234567890,
  totalProcesses: 3,
};

function request(port, path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* leave null */
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Start on an ephemeral port with a fake snapshot; always stop after.
async function withServer(getSnapshot, fn) {
  const port = await httpApi.start({ getSnapshot, port: 0 });
  assert.ok(typeof port === 'number' && port > 0, 'start() resolves the bound ephemeral port');
  try {
    await fn(port);
  } finally {
    await httpApi.stop();
  }
}

test('GET /processes flattens processes across groups', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const { status, json } = await request(port, '/processes');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(json));
    assert.strictEqual(json.length, 3);

    const byPid = Object.fromEntries(json.map((p) => [p.pid, p]));
    assert.deepStrictEqual(byPid[100], {
      pid: 100, name: 'node.exe', group: 'dev', cpu: 12.5, memKB: 204800, ports: [3000, 3001],
    });
    assert.deepStrictEqual(byPid[200], {
      pid: 200, name: 'postgres.exe', group: 'databases', cpu: 1.2, memKB: 409600, ports: [5432],
    });
    // Only the flattened fields are exposed — no started/portDetails/hasWarning.
    assert.deepStrictEqual(
      Object.keys(byPid[101]).sort(),
      ['cpu', 'group', 'memKB', 'name', 'pid', 'ports']
    );
  });
});

test('GET /ports returns one entry per (process, port) pair', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const { status, json } = await request(port, '/ports');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(json));

    const sorted = [...json].sort((a, b) => a.port - b.port);
    assert.deepStrictEqual(sorted, [
      { port: 3000, pid: 100, processName: 'node.exe' },
      { port: 3001, pid: 100, processName: 'node.exe' },
      { port: 5432, pid: 200, processName: 'postgres.exe' },
    ]);
  });
});

test('GET /containers and /warnings pass through the snapshot arrays', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const containers = await request(port, '/containers');
    assert.strictEqual(containers.status, 200);
    assert.deepStrictEqual(containers.json, fakeSnapshot.containers);

    const warnings = await request(port, '/warnings');
    assert.strictEqual(warnings.status, 200);
    assert.deepStrictEqual(warnings.json, fakeSnapshot.warnings);
  });
});

test('GET / returns a JSON index of routes', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const { status, json } = await request(port, '/');
    assert.strictEqual(status, 200);
    assert.ok(json.routes);
    for (const route of ['/processes', '/ports', '/containers', '/warnings']) {
      assert.ok(route in json.routes, `index lists ${route}`);
    }
  });
});

test('unknown routes return 404', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const { status, json } = await request(port, '/nope');
    assert.strictEqual(status, 404);
    assert.ok(json.error);
  });
});

test('non-GET methods return 405', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const post = await request(port, '/processes', 'POST');
    assert.strictEqual(post.status, 405);

    const del = await request(port, '/ports', 'DELETE');
    assert.strictEqual(del.status, 405);
  });
});

test('rejects non-local Host headers (DNS rebinding guard)', async () => {
  await withServer(() => fakeSnapshot, async (port) => {
    const evil = await request(port, '/processes', 'GET', { Host: 'evil.example.com:3999' });
    assert.strictEqual(evil.status, 403);

    const local = await request(port, '/processes', 'GET', { Host: `localhost:${port}` });
    assert.strictEqual(local.status, 200);
  });
});

test('returns 503 when no snapshot is available yet', async () => {
  await withServer(() => null, async (port) => {
    const { status, json } = await request(port, '/processes');
    assert.strictEqual(status, 503);
    assert.strictEqual(json.error, 'no snapshot yet');
  });
});

test('stop() actually closes the server', async () => {
  const port = await httpApi.start({ getSnapshot: () => fakeSnapshot, port: 0 });
  assert.ok(port > 0);

  const before = await request(port, '/processes');
  assert.strictEqual(before.status, 200);

  await httpApi.stop();

  await assert.rejects(
    request(port, '/processes'),
    (err) => err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET',
    'requests fail after stop()'
  );
});

test('restart() moves the server and never throws on stop of a stopped server', async () => {
  const portA = await httpApi.start({ getSnapshot: () => fakeSnapshot, port: 0 });
  const portB = await httpApi.restart({ getSnapshot: () => fakeSnapshot, port: 0 });
  assert.ok(portB > 0);

  const res = await request(portB, '/processes');
  assert.strictEqual(res.status, 200);

  await httpApi.stop();
  await httpApi.stop(); // idempotent

  if (portA !== portB) {
    await assert.rejects(request(portA, '/processes'));
  }
});

test('overlapping start/stop/restart calls are serialized and all settle', async () => {
  // Fire without awaiting — mimics the fire-and-forget IPC side-effects
  // when the user toggles the API rapidly in settings.
  const p1 = httpApi.start({ getSnapshot: () => fakeSnapshot, port: 0 });
  const p2 = httpApi.stop();
  const p3 = httpApi.restart({ getSnapshot: () => fakeSnapshot, port: 0 });
  const p4 = httpApi.stop();
  const p5 = httpApi.start({ getSnapshot: () => fakeSnapshot, port: 0 });

  const [r1, , r3, , r5] = await Promise.all([p1, p2, p3, p4, p5]);
  assert.ok(r1 > 0, 'first start binds');
  assert.ok(r3 > 0, 'restart after stop binds');
  assert.ok(r5 > 0, 'final start binds');

  // The last operation to run wins: the server from p5 is live.
  const res = await request(r5, '/processes');
  assert.strictEqual(res.status, 200);

  await httpApi.stop();
  await assert.rejects(request(r5, '/processes'));
});
