import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FloatingClient, connectFloating } from './floating-client.ts';
import type { OrdersContext } from './page-context.ts';
import { parseFloatingHostCommand } from './floating-protocol.ts';

function setup(context: Partial<OrdersContext> = {}) {
  const messages = new Set<(value: unknown) => void>();
  const disconnects = new Set<() => void>();
  const posted: unknown[] = [];
  let opens = 0;
  const port = {
    onMessage: {
      addListener: (fn: (value: unknown) => void) => messages.add(fn),
      removeListener: (fn: (value: unknown) => void) => messages.delete(fn),
    },
    onDisconnect: {
      addListener: (fn: () => void) => disconnects.add(fn),
      removeListener: (fn: () => void) => disconnects.delete(fn),
    },
    postMessage: (value: unknown) => posted.push(value),
    disconnect: () => {
      for (const listener of disconnects) listener();
    },
  } as unknown as chrome.runtime.Port;
  const client = new FloatingClient(
    port,
    {
      supported: true,
      tabId: 7,
      windowId: 9,
      origin: 'https://orders.example.test',
      pathname: '/orders',
      reason: null,
      ...context,
    },
    {
      runtime: {},
      sidePanel: {
        open: () => {
          opens++;
          return Promise.resolve();
        },
      },
    } as unknown as typeof chrome,
  );
  return {
    client,
    posted,
    port,
    get opens() {
      return opens;
    },
    receive: (value: unknown) => {
      for (const listener of messages) listener(value);
    },
  };
}

test('unsupported HTTP(S) contexts remain usable for UI while capture fails before sending', async () => {
  const app = setup({
    supported: false,
    reason: 'unsupported',
    pathname: '/article',
  });
  try {
    const source = app.client.createPage();
    assert.equal((await source.getContext()).supported, false);
    await assert.rejects(
      source.capture(
        new AbortController().signal,
        'https://orders.example.test',
      ),
      /UNSUPPORTED_PAGE/u,
    );
    assert.equal(app.posted.length, 0);
  } finally {
    app.client.dispose();
  }
});

test('bound context accepts unsupported pages but rejects privileged origins and contradictory support', async () => {
  const app = setup();
  const context = {
    supported: false,
    reason: 'unsupported',
    pathname: '/article',
    origin: 'https://ordinary.example.test',
    tabId: 7,
    windowId: 9,
  };
  const connecting = connectFloating({
    runtime: { connect: () => app.port },
  } as unknown as typeof chrome);
  let completed = false;
  void connecting.then(() => {
    completed = true;
  });
  app.receive({
    type: 'floating:bound',
    context: { ...context, origin: 'chrome://settings' },
  });
  app.receive({
    type: 'floating:bound',
    context: { ...context, supported: true },
  });
  await Promise.resolve();
  assert.equal(completed, false);
  app.receive({ type: 'floating:bound', context });
  const client = await connecting;
  try {
    assert.deepEqual(await client.createPage().getContext(), context);
  } finally {
    client.dispose();
    app.client.dispose();
  }
});

test('launcher layout sends only bounded geometry and changing presentation performs no page request', () => {
  const app = setup();
  try {
    app.client.layout(false, 79.2, true, 155.4);
    app.client.layout(false, 380, false, 100);
    app.client.layout(true, 600, true, 200);
    app.client.layout(false, -50, true, 5000);
    assert.deepEqual(app.posted, [
      {
        type: 'floating:layout',
        expanded: false,
        launcher: true,
        width: 156,
        height: 80,
      },
      { type: 'floating:layout', expanded: false, height: 380 },
      { type: 'floating:layout', expanded: true, height: 600 },
      {
        type: 'floating:layout',
        expanded: false,
        launcher: true,
        width: 480,
        height: 44,
      },
    ]);
    assert.ok(app.posted.every((value) => parseFloatingHostCommand(value)));
  } finally {
    app.client.dispose();
  }
});

test('layout boundary rejects unsupported fields, invalid dimensions and ambiguous launcher states', () => {
  const launcher = {
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 156,
  };
  assert.deepEqual(parseFloatingHostCommand(launcher), launcher);
  for (const message of [
    { ...launcher, width: 43 },
    { ...launcher, width: 481 },
    { ...launcher, width: Number.NaN },
    { ...launcher, width: '156' },
    { ...launcher, width: 156.5 },
    { ...launcher, height: 43 },
    { ...launcher, height: 701 },
    { ...launcher, height: Number.POSITIVE_INFINITY },
    { ...launcher, expanded: true },
    { ...launcher, launcher: false },
    { ...launcher, launcher: 'true' },
    { ...launcher, text: 'Untrusted page text' },
  ])
    assert.equal(parseFloatingHostCommand(message), null);
});

test('context is fixed metadata and page reset never disconnects the surface', async () => {
  const app = setup();
  const page = app.client.createPage();
  assert.equal((await page.getContext()).tabId, 7);
  assert.deepEqual(app.posted, []);
  page.reset();
  assert.equal(app.client.isBound(), true);
  assert.deepEqual(app.posted, [{ type: 'floating:reset' }]);
  page.dispose();
  assert.equal(app.client.isBound(), true);
  assert.equal((await app.client.createPage().getContext()).supported, true);
  app.client.dispose();
});

test('activation buffers until ready, consumes each ID once, and stops after close', () => {
  const app = setup();
  const events: unknown[] = [];
  app.client.subscribe((event) => events.push(event));
  const activation = {
    type: 'floating:activate',
    id: crypto.randomUUID(),
    record: true,
  };
  app.receive(activation);
  assert.deepEqual(events, []);
  app.client.ready();
  assert.equal(events.length, 1);
  app.receive(activation);
  app.client.ready();
  assert.equal(events.length, 1);
  app.client.close();
  assert.equal(app.client.isBound(), false);
  app.receive({ ...activation, id: crypto.randomUUID() });
  assert.deepEqual(events.at(-1), { type: 'ended' });
  assert.equal(events.length, 2);
  app.client.dispose();
});

test('bound page rejects a foreign tab without sending capture; close rejects pending and ignores late reply', async () => {
  const app = setup();
  const page = app.client.createPage();
  await assert.rejects(
    page.capture(
      new AbortController().signal,
      'https://orders.example.test',
      8,
    ),
  );
  assert.deepEqual(app.posted, []);
  const pending = page.capture(
    new AbortController().signal,
    'https://orders.example.test',
    7,
  );
  const rejected = assert.rejects(pending);
  const request = app.posted.at(-1) as unknown as { id: string };
  app.client.close();
  app.receive({ type: 'orders:error', id: request.id, code: 'INVALID_PAGE' });
  await rejected;
  assert.equal((await page.getContext()).supported, false);
  app.client.dispose();
});

test('source changes reject pending capture and notify page without ending frame', async () => {
  const app = setup();
  const page = app.client.createPage();
  const reasons: unknown[] = [];
  page.subscribe((reason) => reasons.push(reason));
  const pending = page.capture(
    new AbortController().signal,
    'https://orders.example.test',
  );
  const rejected = assert.rejects(pending);
  app.receive({ type: 'orders:changed', document_key: crypto.randomUUID() });
  await rejected;
  assert.deepEqual(reasons, ['page']);
  assert.equal(app.client.isBound(), true);
  app.client.dispose();
});

test('open sidepanel preserves immediate browser gesture and cancels before async dismissal', async () => {
  const app = setup();
  const events: unknown[] = [];
  app.client.subscribe((event) => events.push(event));
  app.client.openSidePanel();
  assert.equal(app.opens, 1);
  assert.deepEqual(events, [{ type: 'cancel' }]);
  await Promise.resolve();
  assert.equal(app.client.isBound(), false);
  app.client.dispose();
});

test('live binding heartbeat is metadata only and stops immediately on close', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  const app = setup();
  context.mock.timers.tick(19_999);
  assert.deepEqual(app.posted, []);
  context.mock.timers.tick(1);
  assert.deepEqual(app.posted, [{ type: 'floating:alive' }]);
  app.client.close();
  const count = app.posted.length;
  context.mock.timers.tick(100_000);
  assert.equal(app.posted.length, count);
  app.client.dispose();
});
