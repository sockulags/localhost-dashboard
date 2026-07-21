const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseDockerJson,
  parsePorts,
  isValidContainerId,
  friendlyDockerError,
  clampTail,
} = require('../main/collectors/docker-collector');

test('parseDockerJson parses one JSON object per line', () => {
  const output = [
    '{"ID":"abc123","Names":"my-postgres","Image":"postgres:16","Status":"Up 2 hours","State":"running","Ports":"0.0.0.0:5432->5432/tcp","CreatedAt":"2026-07-01 10:00:00 +0200 CEST"}',
    '{"ID":"def456","Names":"redis-cache","Image":"redis:7","Status":"Exited (0) 3 days ago","State":"exited","Ports":"","CreatedAt":"2026-06-28 09:00:00 +0200 CEST"}',
    'not json at all',
    '',
  ].join('\n');

  const containers = parseDockerJson(output);

  assert.strictEqual(containers.length, 2);
  assert.strictEqual(containers[0].id, 'abc123');
  assert.strictEqual(containers[0].name, 'my-postgres');
  assert.strictEqual(containers[0].image, 'postgres:16');
  assert.strictEqual(containers[0].state, 'running');
  assert.deepStrictEqual(containers[0].ports, [
    { hostAddress: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' },
  ]);

  assert.strictEqual(containers[1].state, 'exited');
  assert.deepStrictEqual(containers[1].ports, []);
});

test('parseDockerJson handles missing fields gracefully', () => {
  const containers = parseDockerJson('{"ID":"xyz"}');
  assert.strictEqual(containers.length, 1);
  assert.strictEqual(containers[0].name, '');
  assert.strictEqual(containers[0].state, '');
  assert.deepStrictEqual(containers[0].ports, []);
});

test('parseDockerJson returns empty array for empty output', () => {
  assert.deepStrictEqual(parseDockerJson(''), []);
});

test('parsePorts parses bound ports', () => {
  const ports = parsePorts('0.0.0.0:3000->3000/tcp, 0.0.0.0:5432->5433/tcp');
  assert.deepStrictEqual(ports, [
    { hostAddress: '0.0.0.0', hostPort: 3000, containerPort: 3000, protocol: 'tcp' },
    { hostAddress: '0.0.0.0', hostPort: 5432, containerPort: 5433, protocol: 'tcp' },
  ]);
});

test('parsePorts parses IPv6 bindings and udp', () => {
  const ports = parsePorts(':::8080->80/tcp, 0.0.0.0:5353->5353/udp');
  assert.strictEqual(ports.length, 2);
  assert.strictEqual(ports[0].hostAddress, '::');
  assert.strictEqual(ports[0].hostPort, 8080);
  assert.strictEqual(ports[0].containerPort, 80);
  assert.strictEqual(ports[1].protocol, 'udp');
});

test('parsePorts parses exposed-but-unbound ports', () => {
  const ports = parsePorts('6379/tcp');
  assert.deepStrictEqual(ports, [
    { hostAddress: '', hostPort: null, containerPort: 6379, protocol: 'tcp' },
  ]);
});

test('parsePorts returns empty array for empty or blank input', () => {
  assert.deepStrictEqual(parsePorts(''), []);
  assert.deepStrictEqual(parsePorts('   '), []);
});

test('isValidContainerId accepts full and short hex ids', () => {
  assert.strictEqual(isValidContainerId('abc123def456'), true);
  assert.strictEqual(
    isValidContainerId('4e5021d210f65ebe9d0f891f2c7c912d5b1e4c8a9f3b2d1e0c9b8a7f6e5d4c3b'),
    true
  );
});

test('isValidContainerId accepts container names with dots, dashes, underscores', () => {
  assert.strictEqual(isValidContainerId('my-postgres'), true);
  assert.strictEqual(isValidContainerId('redis_cache.local'), true);
  assert.strictEqual(isValidContainerId('Web-App_2.0'), true);
});

test('isValidContainerId rejects spaces and shell metacharacters', () => {
  assert.strictEqual(isValidContainerId('abc 123'), false);
  assert.strictEqual(isValidContainerId('abc;rm -rf /'), false);
  assert.strictEqual(isValidContainerId('$(whoami)'), false);
  assert.strictEqual(isValidContainerId('abc`id`'), false);
  assert.strictEqual(isValidContainerId('abc&def'), false);
  assert.strictEqual(isValidContainerId('abc|def'), false);
  // Dashes are legal id characters; the collector passes ids after `--`
  // so a dash-prefixed value can never be parsed as a docker flag.
  assert.strictEqual(isValidContainerId('--detach'), true);
  assert.strictEqual(isValidContainerId('a/b'), false);
});

test('isValidContainerId rejects empty and non-string values', () => {
  assert.strictEqual(isValidContainerId(''), false);
  assert.strictEqual(isValidContainerId(null), false);
  assert.strictEqual(isValidContainerId(undefined), false);
  assert.strictEqual(isValidContainerId(123), false);
  assert.strictEqual(isValidContainerId({}), false);
});

test('friendlyDockerError maps common docker failures to actionable messages', () => {
  assert.strictEqual(
    friendlyDockerError('error during connect: this error may indicate that the docker daemon is not running'),
    'Docker daemon is not running'
  );
  assert.strictEqual(
    friendlyDockerError('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'),
    'Docker daemon is not running'
  );
  assert.strictEqual(
    friendlyDockerError('Error response from daemon: No such container: abc123'),
    'Container no longer exists'
  );
  assert.strictEqual(
    friendlyDockerError('permission denied while trying to connect to the Docker daemon socket'),
    'Access denied — check Docker permissions'
  );
  assert.strictEqual(friendlyDockerError('spawn docker ENOENT'), 'Docker CLI not found');
});

test('friendlyDockerError falls back to the raw message', () => {
  assert.strictEqual(friendlyDockerError('some unexpected failure'), 'some unexpected failure');
  assert.strictEqual(friendlyDockerError('  padded  '), 'padded');
  assert.strictEqual(friendlyDockerError(''), 'Unknown error');
  assert.strictEqual(friendlyDockerError(null), 'Unknown error');
});

test('clampTail clamps invalid or out-of-range tail values to 200', () => {
  assert.strictEqual(clampTail(50), 50);
  assert.strictEqual(clampTail(10000), 10000);
  assert.strictEqual(clampTail(0), 200);
  assert.strictEqual(clampTail(-5), 200);
  assert.strictEqual(clampTail(10001), 200);
  assert.strictEqual(clampTail(3.5), 200);
  assert.strictEqual(clampTail('200'), 200);
  assert.strictEqual(clampTail(undefined), 200);
});
