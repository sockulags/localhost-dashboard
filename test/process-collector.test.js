const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseTasklistCSV,
  parsePsOutput,
  parseCimPpidCsv,
  parseWmicPpidOutput,
} = require('../main/collectors/process-collector');

test('parseTasklistCSV parses tasklist /FO CSV output', () => {
  const output = [
    '"Image Name","PID","Session Name","Session#","Mem Usage"',
    '"System Idle Process","0","Services","0","8 K"',
    '"node.exe","12345","Console","1","123,456 K"',
    '"postgres.exe","2200","Services","0","45,000 K"',
    '"chrome.exe","9999","Console","1","1,234,567 K"',
    'malformed line without quotes',
  ].join('\r\n');

  const processes = parseTasklistCSV(output);

  assert.strictEqual(processes.length, 3);
  assert.deepStrictEqual(processes[0], {
    pid: 12345,
    name: 'node.exe',
    memKB: 123456,
    status: 'Running',
  });
  assert.strictEqual(processes[1].name, 'postgres.exe');
  assert.strictEqual(processes[1].memKB, 45000);
  assert.strictEqual(processes[2].memKB, 1234567);

  // PID 0 and malformed lines are skipped
  assert.ok(!processes.some((p) => p.pid === 0));
});

test('parseTasklistCSV returns empty array for empty output', () => {
  assert.deepStrictEqual(parseTasklistCSV(''), []);
});

test('parsePsOutput parses ps pid/ppid/rss/comm output', () => {
  const output = [
    '  PID  PPID   RSS COMMAND',
    ' 1234     1 51200 node',
    ' 2200  1234 90000 /usr/lib/postgresql/16/bin/postgres',
    'garbage',
  ].join('\n');

  const processes = parsePsOutput(output);

  assert.strictEqual(processes.length, 2);
  assert.deepStrictEqual(processes[0], {
    pid: 1234,
    ppid: 1,
    name: 'node',
    memKB: 51200,
    status: 'Running',
  });
  // Name is extracted from the command path
  assert.strictEqual(processes[1].name, 'postgres');
  assert.strictEqual(processes[1].ppid, 1234);
  assert.strictEqual(processes[1].memKB, 90000);
});

test('parseCimPpidCsv parses ConvertTo-Csv ProcessId/ParentProcessId output', () => {
  const output = [
    '"ProcessId","ParentProcessId"',
    '"0","0"',
    '"4","0"',
    '"12345","6512"',
    '"9440","12345"',
    'garbage line',
  ].join('\r\n');

  const map = parseCimPpidCsv(output);

  assert.strictEqual(map.get(12345), 6512);
  assert.strictEqual(map.get(9440), 12345);
  assert.strictEqual(map.get(4), 0);
  // Header line contributes nothing
  assert.strictEqual(map.size, 4);
});

test('parseCimPpidCsv returns empty map for empty output', () => {
  assert.strictEqual(parseCimPpidCsv('').size, 0);
});

test('parseWmicPpidOutput parses wmic column output using the header order', () => {
  // wmic sorts columns alphabetically: ParentProcessId comes first
  const output = [
    'ParentProcessId  ProcessId',
    '0                0',
    '6512             12345',
    '12345            9440',
    '',
  ].join('\r\n');

  const map = parseWmicPpidOutput(output);

  assert.strictEqual(map.get(12345), 6512);
  assert.strictEqual(map.get(9440), 12345);
  assert.strictEqual(map.size, 3);
});

test('parseWmicPpidOutput keeps rows with a blank ParentProcessId as ppid 0', () => {
  const output = [
    'ParentProcessId  ProcessId',
    '                 4',
    '6512             12345',
  ].join('\r\n');

  const map = parseWmicPpidOutput(output);

  assert.strictEqual(map.get(4), 0);
  assert.strictEqual(map.get(12345), 6512);
  assert.strictEqual(map.size, 2);
});

test('parseWmicPpidOutput returns empty map when the header is missing', () => {
  assert.strictEqual(parseWmicPpidOutput('').size, 0);
  assert.strictEqual(parseWmicPpidOutput('1234 5678').size, 0);
});
