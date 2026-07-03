const { test } = require('node:test');
const assert = require('node:assert');
const { parseNetstat, parseSs, parseLsof } = require('../main/collectors/port-collector');

test('parseNetstat parses TCP listening entries with PIDs', () => {
  const output = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345',
    '  TCP    127.0.0.1:5432         0.0.0.0:0              LISTENING       2200',
    '  TCP    192.168.1.10:54321     142.250.74.36:443      ESTABLISHED     4444',
    '  TCP    [::]:8080              [::]:0                 LISTENING       555',
    '  UDP    0.0.0.0:5353           *:*                                    777',
    '  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       0',
    'garbage line',
  ].join('\r\n');

  const ports = parseNetstat(output);

  assert.deepStrictEqual(ports[0], {
    protocol: 'TCP',
    localAddress: '0.0.0.0',
    port: 3000,
    state: 'LISTENING',
    pid: 12345,
  });
  assert.deepStrictEqual(ports[1], {
    protocol: 'TCP',
    localAddress: '127.0.0.1',
    port: 5432,
    state: 'LISTENING',
    pid: 2200,
  });

  // Established connections are still reported (state carried through)
  const established = ports.find((p) => p.pid === 4444);
  assert.strictEqual(established.state, 'ESTABLISHED');
  assert.strictEqual(established.port, 54321);

  // IPv6 bracket address: port split on the last colon
  const v6 = ports.find((p) => p.pid === 555);
  assert.strictEqual(v6.localAddress, '[::]');
  assert.strictEqual(v6.port, 8080);

  // A standard UDP row only has four columns (no state), which the
  // five-column minimum filters out.
  assert.ok(!ports.some((p) => p.protocol === 'UDP'));

  // PID 0 (System) and garbage lines are skipped
  assert.ok(!ports.some((p) => p.pid === 0));
  assert.strictEqual(ports.length, 4);
});

test('parseNetstat returns empty array for empty output', () => {
  assert.deepStrictEqual(parseNetstat(''), []);
});

test('parseSs parses listening sockets and extracts pid from users field', () => {
  const output = [
    'State   Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process',
    'LISTEN  0       511     0.0.0.0:3000        0.0.0.0:*          users:(("node",pid=1234,fd=23))',
    'LISTEN  0       128     127.0.0.1:5432      0.0.0.0:*          users:(("postgres",pid=987,fd=6))',
    'LISTEN  0       4096    [::]:8080           [::]:*             users:(("java",pid=42,fd=112))',
    'ESTAB   0       0       10.0.0.5:41234      93.184.216.34:443  users:(("curl",pid=555,fd=3))',
    'LISTEN  0       128     0.0.0.0:22          0.0.0.0:*',
  ].join('\n');

  const ports = parseSs(output);

  assert.strictEqual(ports.length, 3);
  assert.deepStrictEqual(ports[0], {
    protocol: 'TCP',
    localAddress: '0.0.0.0',
    port: 3000,
    state: 'LISTENING',
    pid: 1234,
  });
  assert.strictEqual(ports[1].pid, 987);
  assert.strictEqual(ports[1].port, 5432);
  assert.strictEqual(ports[2].localAddress, '[::]');
  assert.strictEqual(ports[2].port, 8080);
  // Non-LISTEN rows and rows without a pid are skipped
  assert.ok(!ports.some((p) => p.pid === 555));
});

test('parseLsof parses listening sockets and normalises wildcard address', () => {
  const output = [
    'COMMAND   PID   USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME',
    'node      1234  lucas  23u  IPv4  91011  0t0      TCP  *:3000 (LISTEN)',
    'postgres  987   lucas  6u   IPv4  12345  0t0      TCP  127.0.0.1:5432 (LISTEN)',
    'short line',
  ].join('\n');

  const ports = parseLsof(output);

  assert.strictEqual(ports.length, 2);
  assert.deepStrictEqual(ports[0], {
    protocol: 'TCP',
    localAddress: '0.0.0.0',
    port: 3000,
    state: 'LISTENING',
    pid: 1234,
  });
  assert.strictEqual(ports[1].localAddress, '127.0.0.1');
  assert.strictEqual(ports[1].port, 5432);
  assert.strictEqual(ports[1].pid, 987);
});
