const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { probe, collect, resetCache } = require('../main/collectors/health-collector');

// Build a fake httpGet. `behavior` maps port -> 'ok' | 'http500' | 'error' | 'timeout'.
// Records every probed port in fn.calls.
function makeHttpGet(behavior) {
  const fn = (url, options, callback) => {
    const port = Number(new URL(url).port);
    fn.calls.push(port);

    const req = new EventEmitter();
    // Mirror the real ClientRequest: destroy(err) surfaces as an 'error' event
    req.destroy = (err) => req.emit('error', err || new Error('socket destroyed'));

    const mode = behavior[port] || 'error';
    setImmediate(() => {
      if (mode === 'ok') {
        callback({ statusCode: 200, resume() {} });
      } else if (mode === 'http500') {
        callback({ statusCode: 500, resume() {} });
      } else if (mode === 'timeout') {
        req.emit('timeout');
      } else {
        req.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:' + port));
      }
    });
    return req;
  };
  fn.calls = [];
  return fn;
}

// Let the fake's setImmediate callbacks and follow-up microtasks run
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => resetCache());

test('probe marks a responding port as up with a latency', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok' });
  const result = await probe([3000], { httpGet });

  const status = result.get(3000);
  assert.strictEqual(status.up, true);
  assert.strictEqual(typeof status.latencyMs, 'number');
  assert.ok(status.latencyMs >= 0);
});

test('probe counts any HTTP response as up, even a 500', async () => {
  const httpGet = makeHttpGet({ 8080: 'http500' });
  const result = await probe([8080], { httpGet });

  assert.strictEqual(result.get(8080).up, true);
});

test('probe marks refused connections as down with null latency', async () => {
  const httpGet = makeHttpGet({ 5000: 'error' });
  const result = await probe([5000], { httpGet });

  assert.deepStrictEqual(result.get(5000), { up: false, latencyMs: null });
});

test('probe marks timed-out connections as down', async () => {
  const httpGet = makeHttpGet({ 9000: 'timeout' });
  const result = await probe([9000], { httpGet });

  assert.deepStrictEqual(result.get(9000), { up: false, latencyMs: null });
});

test('probe handles a mix of ports concurrently and dedupes', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok', 5432: 'error' });
  const result = await probe([3000, 5432, 3000], { httpGet });

  assert.strictEqual(result.size, 2);
  assert.strictEqual(result.get(3000).up, true);
  assert.strictEqual(result.get(5432).up, false);
  // Deduped: 3000 probed once
  assert.deepStrictEqual([...httpGet.calls].sort((a, b) => a - b), [3000, 5432]);
});

test('probe of an empty port list returns an empty Map', async () => {
  const httpGet = makeHttpGet({});
  const result = await probe([], { httpGet });
  assert.strictEqual(result.size, 0);
  assert.strictEqual(httpGet.calls.length, 0);
});

test('collect never blocks: first call returns empty, results land next call', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok' });
  let t = 0;
  const now = () => t;

  const first = collect([3000], { httpGet, now });
  assert.strictEqual(first.size, 0, 'probe runs in background, nothing cached yet');
  assert.strictEqual(httpGet.calls.length, 1, 'probe kicked off');

  await tick();

  const second = collect([3000], { httpGet, now });
  assert.strictEqual(second.get(3000).up, true);
});

test('collect throttles: cached results within the interval, re-probe after it', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok' });
  let t = 0;
  const now = () => t;

  collect([3000], { httpGet, now });
  await tick();

  t += 1000; // still inside the probe interval
  collect([3000], { httpGet, now });
  t += 1000;
  collect([3000], { httpGet, now });
  assert.strictEqual(httpGet.calls.length, 1, 'calls within the interval use the cache');

  t += 60000; // well past the interval
  collect([3000], { httpGet, now });
  assert.strictEqual(httpGet.calls.length, 2, 'a call after the interval re-probes');
});

test('collect drops cached entries for ports no longer listening', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok', 4000: 'ok' });
  let t = 0;
  const now = () => t;

  collect([3000, 4000], { httpGet, now });
  await tick();

  t += 1000; // within interval: cached call, but 4000 is gone
  const cached = collect([3000], { httpGet, now });
  assert.strictEqual(cached.get(3000).up, true);
  assert.strictEqual(cached.has(4000), false, 'stale port pruned from cache');
});

test('unprobed ports have no entry in the collected map (unknown)', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok' });
  let t = 0;
  const now = () => t;

  collect([3000], { httpGet, now });
  await tick();

  t += 1000; // within interval; 5000 appeared but has not been probed yet
  const cached = collect([3000, 5000], { httpGet, now });
  assert.strictEqual(cached.has(5000), false);
});

test('resetCache clears the throttle and cache so the next collect re-probes', async () => {
  const httpGet = makeHttpGet({ 3000: 'ok' });
  let t = 0;
  const now = () => t;

  collect([3000], { httpGet, now });
  await tick();
  assert.strictEqual(httpGet.calls.length, 1);

  resetCache();

  const afterReset = collect([3000], { httpGet, now });
  assert.strictEqual(afterReset.size, 0, 'cache cleared');
  assert.strictEqual(httpGet.calls.length, 2, 'collect after resetCache probes again');
});
