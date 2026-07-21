const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// notifier.js requires Electron's Notification at load time. Stub the
// electron module with a fake Notification class so the module can be
// tested under plain Node (CI has no Electron binary).
const createdNotifications = [];

class FakeNotification {
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.shown = false;
    createdNotifications.push(this);
  }

  static isSupported() {
    return true;
  }

  on(event, cb) {
    this.handlers[event] = cb;
  }

  show() {
    this.shown = true;
  }
}

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { Notification: FakeNotification };
  }
  return originalLoad.call(this, request, ...rest);
};

const notifier = require('../main/services/notifier');

// ---------------------------------------------------------------------------
// buildToastXml (pure function)
// ---------------------------------------------------------------------------

test('buildToastXml produces well-formed toast XML with the pid embedded', () => {
  const xml = notifier.buildToastXml('High CPU usage', 'node is at 97% CPU', 123);

  assert.ok(xml.startsWith('<toast '), 'starts with a <toast> root element');
  assert.ok(xml.endsWith('</toast>'), 'ends with the closing </toast> tag');
  assert.ok(xml.includes('<binding template="ToastGeneric">'), 'uses the ToastGeneric binding');
  assert.ok(xml.includes('<text>High CPU usage</text>'), 'title becomes the first text node');
  assert.ok(xml.includes('<text>node is at 97% CPU</text>'), 'body becomes the second text node');

  // The action button carries the pid in its arguments (XML-escaped &).
  assert.ok(xml.includes('content="Kill process"'), 'has a Kill process button');
  assert.ok(
    xml.includes('arguments="action=kill&amp;pid=123"'),
    'button arguments carry action=kill and the pid'
  );
  assert.ok(
    xml.includes('launch="action=focus&amp;pid=123"'),
    'toast body launch arguments carry the pid'
  );
  assert.ok(xml.includes('activationType='), 'declares an activationType');

  // Balanced tags for the elements we emit.
  for (const tag of ['visual', 'binding', 'actions']) {
    assert.ok(xml.includes(`<${tag}`), `has <${tag}>`);
    assert.ok(xml.includes(`</${tag}>`), `closes </${tag}>`);
  }

  // No stray unescaped ampersands anywhere in the document.
  assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), 'every & is part of an entity');
});

test('buildToastXml escapes XML special characters in title and body', () => {
  const xml = notifier.buildToastXml('a & b <c>', `"quoted" & 'apos' <tag>`, 42);

  assert.ok(xml.includes('<text>a &amp; b &lt;c&gt;</text>'), 'title is escaped');
  assert.ok(
    xml.includes('<text>&quot;quoted&quot; &amp; &apos;apos&apos; &lt;tag&gt;</text>'),
    'body is escaped'
  );
  // The injected <c> / <tag> must not appear as raw markup.
  assert.ok(!xml.includes('<c>'), 'raw <c> is not present');
  assert.ok(!xml.includes('<tag>'), 'raw <tag> is not present');
  assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), 'every & is part of an entity');
});

// ---------------------------------------------------------------------------
// notify() dedupe / cap behavior (existing behavior, covered here)
// ---------------------------------------------------------------------------

// notifier keeps module-level state (previousKeys), so the notify() scenarios
// run as one sequential test.
test('notify seeds silently, dedupes by key, and caps per poll', () => {
  const w = (key, pid) => ({ key, pid, message: `warning ${key}` });

  // First poll: seed only, no notifications even though warnings exist.
  notifier.notify([w('cpu:1', 1), w('mem:2', 2)]);
  assert.strictEqual(createdNotifications.length, 0, 'first poll is silent');

  // Same keys again: nothing new, nothing fired.
  notifier.notify([w('cpu:1', 1), w('mem:2', 2)]);
  assert.strictEqual(createdNotifications.length, 0, 'repeated keys are deduped');

  // One new key alongside the old ones: exactly one notification.
  notifier.notify([w('cpu:1', 1), w('mem:2', 2), w('dup:3', 3)]);
  assert.strictEqual(createdNotifications.length, 1, 'only the new key fires');
  assert.ok(createdNotifications[0].shown, 'notification was shown');

  // A key that disappears and comes back counts as new again.
  notifier.notify([w('cpu:1', 1)]);
  assert.strictEqual(createdNotifications.length, 1, 'removals fire nothing');
  notifier.notify([w('cpu:1', 1), w('dup:3', 3)]);
  assert.strictEqual(createdNotifications.length, 2, 're-appearing key fires again');

  // Five new keys at once: capped at 3 plus one summary notification.
  createdNotifications.length = 0;
  notifier.notify([
    w('cpu:1', 1),
    w('a:10', 10),
    w('b:11', 11),
    w('c:12', 12),
    w('d:13', 13),
    w('e:14', 14),
  ]);
  assert.strictEqual(createdNotifications.length, 4, '3 capped warnings + 1 summary');
  const summary = createdNotifications[3];
  assert.match(summary.options.body, /more conflict/, 'last notification is the summary');
});

// ---------------------------------------------------------------------------
// onAction wiring
// ---------------------------------------------------------------------------

test('onAction callback receives the pid when the action event fires', () => {
  const received = [];
  notifier.onAction((pid) => received.push(pid));

  createdNotifications.length = 0;
  notifier.notify([{ key: 'cpu:999', pid: 999, message: 'runaway process' }]);
  assert.strictEqual(createdNotifications.length, 1);

  const n = createdNotifications[0];
  assert.strictEqual(typeof n.handlers.action, 'function', 'action handler is wired');
  n.handlers.action();
  assert.deepStrictEqual(received, [999], 'callback got the pid');

  // Body click still works as before.
  const clicked = [];
  notifier.onClick((pid) => clicked.push(pid));
  n.handlers.click();
  assert.deepStrictEqual(clicked, [999], 'click callback still receives the pid');
});

test('warnings without a numeric pid never trigger the action callback', () => {
  const received = [];
  notifier.onAction((pid) => received.push(pid));

  createdNotifications.length = 0;
  notifier.notify([{ key: 'port:5173', message: 'port conflict' }]);
  assert.strictEqual(createdNotifications.length, 1);

  const n = createdNotifications[0];
  // Handler is wired but guarded: no pid, no callback.
  n.handlers.action();
  assert.deepStrictEqual(received, [], 'no pid means no action callback');
  // No kill button either: never a toastXml or actions notification.
  assert.strictEqual(n.options.toastXml, undefined);
  assert.strictEqual(n.options.actions, undefined);
});

test('multi-process (dup) warnings do not get a single-pid kill action', () => {
  const received = [];
  notifier.onAction((pid) => received.push(pid));

  createdNotifications.length = 0;
  // Shape emitted by anomaly-detector.detectDuplicates: representative pid
  // plus the full pids array. Killing one of N would be misleading.
  notifier.notify([
    { key: 'dup:node.exe', pid: 101, pids: [101, 102, 103], message: '3 node.exe processes' },
  ]);
  assert.strictEqual(createdNotifications.length, 1);

  const n = createdNotifications[0];
  assert.strictEqual(n.options.toastXml, undefined, 'no toast XML for dup warnings');
  assert.strictEqual(n.options.actions, undefined, 'no macOS action button for dup warnings');
  n.handlers.action();
  assert.deepStrictEqual(received, [], 'action callback is suppressed for dup warnings');

  // The body click still reports the representative pid, as before.
  const clicked = [];
  notifier.onClick((pid) => clicked.push(pid));
  n.handlers.click();
  assert.deepStrictEqual(clicked, [101]);
});
