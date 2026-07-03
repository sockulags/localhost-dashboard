const { test } = require('node:test');
const assert = require('node:assert');
const { parseDockerJson, parsePorts } = require('../main/collectors/docker-collector');

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
