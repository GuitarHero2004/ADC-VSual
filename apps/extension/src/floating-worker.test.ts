import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installFloatingWorker } from './floating-worker.ts';

class Events<T extends unknown[]> {
  listeners = new Set<(...args: T) => void>();
  addListener = (listener: (...args: T) => void) => {
    this.listeners.add(listener);
  };
  removeListener = (listener: (...args: T) => void) => {
    this.listeners.delete(listener);
  };
  emit = (...args: T) => {
    for (const listener of this.listeners) listener(...args);
  };
}
const extensionId = 'a'.repeat(32);
const origin = 'https://orders.example.test';
const sourceDocument = crypto.randomUUID();
const tab = {
  id: 1,
  windowId: 2,
  url: `${origin}/orders`,
  active: true,
} as chrome.tabs.Tab;
const hostSender = {
  id: extensionId,
  tab,
  frameId: 0,
  documentId: sourceDocument,
  url: `${origin}/orders`,
};
function makePort(name: string, sender?: chrome.runtime.MessageSender) {
  const posted: unknown[] = [];
  let closed = false;
  const messages = new Events<[unknown]>();
  const disconnects = new Events<[]>();
  const port = {
    name,
    sender,
    onMessage: messages,
    onDisconnect: disconnects,
    postMessage(value: unknown) {
      if (closed) throw new Error('Closed');
      posted.push(value);
    },
    disconnect() {
      if (closed) return;
      closed = true;
      disconnects.emit();
    },
  } as unknown as chrome.runtime.Port;
  return {
    port,
    posted,
    messages,
    get closed() {
      return closed;
    },
  };
}
function setup(url = tab.url!) {
  const connected = new Events<[chrome.runtime.Port]>();
  const updated = new Events<[number, chrome.tabs.OnUpdatedInfo]>();
  const removed = new Events<[number]>();
  const sources: ReturnType<typeof makePort>[] = [];
  const destinations: unknown[] = [];
  let currentTab: chrome.tabs.Tab = { ...tab, url };
  const revoked: chrome.runtime.MessageSender[] = [];
  const browser = {
    runtime: { id: extensionId, onConnect: connected },
    tabs: {
      onUpdated: updated,
      onRemoved: removed,
      get: async () => currentTab,
      update: async () => currentTab,
      connect(id: number, options: unknown) {
        destinations.push({ id, options });
        const source = makePort('orders-page');
        sources.push(source);
        return source.port;
      },
    },
    windows: { update: async () => ({}) },
  } as unknown as typeof chrome;
  const worker = installFloatingWorker([origin], browser, origin, (sender) =>
    revoked.push(sender),
  );
  const host = makePort('floating-host', {
    ...hostSender,
    url,
    tab: currentTab,
  });
  const boot = crypto.randomUUID();
  function register() {
    connected.emit(host.port);
    host.messages.emit({ type: 'floating:host-ready', boot });
  }
  function frame(
    overrides: Partial<chrome.runtime.MessageSender> = {},
    frameBoot = boot,
  ) {
    const sender = {
      id: extensionId,
      tab: currentTab,
      frameId: 3,
      documentId: crypto.randomUUID(),
      url: `chrome-extension://${extensionId}/floating.html#${frameBoot}`,
      ...overrides,
    };
    const result = makePort('floating-surface', sender);
    connected.emit(result.port);
    return { ...result, sender };
  }
  return {
    worker,
    host,
    boot,
    register,
    frame,
    connected,
    updated,
    removed,
    sources,
    destinations,
    revoked,
    setTab(value: Partial<chrome.tabs.Tab>) {
      currentTab = { ...currentTab, ...value };
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('only a bound extension frame receives context/auth trust; standby never opens source', () => {
  const app = setup();
  assert.equal(app.frame().closed, true);
  app.register();
  assert.deepEqual(app.host.posted, [
    { type: 'floating:registered' },
    { type: 'floating:mount' },
  ]);
  for (const patch of [
    { id: 'b'.repeat(32) },
    { frameId: 0 },
    { documentId: '' },
    { tab: { ...tab, id: 99 } },
    { tab: { ...tab, windowId: 99 } },
    { url: `chrome-extension://${extensionId}/index.html#${app.boot}` },
    { url: `chrome-extension://${extensionId}/floating.html?x=1#${app.boot}` },
    {
      url: `chrome-extension://${extensionId}/floating.html#${crypto.randomUUID()}`,
    },
  ])
    assert.equal(app.frame(patch).closed, true);
  const frame = app.frame();
  assert.equal(frame.closed, false);
  assert.equal(app.worker.trusted(frame.sender), true);
  assert.equal(
    app.worker.trusted({ ...frame.sender, documentId: crypto.randomUUID() }),
    false,
  );
  assert.equal(app.frame().closed, true);
  assert.equal(app.sources.length, 0);
  assert.equal(frame.posted.length, 1);
  assert.equal((frame.posted[0] as { type: string }).type, 'floating:bound');
  assert.equal(
    app.host.posted.some((value) => JSON.stringify(value).includes('context')),
    false,
  );
});

test('host admission rejects subframes, privileged pages and authentication routes', () => {
  const app = setup();
  for (const patch of [
    { frameId: 4 },
    { documentId: '' },
    { url: `${origin}/auth/callback` },
    { url: 'file:///private.html' },
    { url: `chrome-extension://${extensionId}/floating.html` },
  ]) {
    const host = makePort('floating-host', { ...hostSender, ...patch });
    app.connected.emit(host.port);
    assert.equal(host.closed, true);
  }
  assert.equal(app.worker.activate(tab, true), false);
});

test('ordinary unsupported pages can authenticate but never reach the orders extractor', async () => {
  for (const url of [
    'https://ordinary.example.test/document',
    `${origin}/orders-extra`,
    'https://orders.example.test:444/orders',
  ]) {
    const app = setup(url);
    app.register();
    const frame = app.frame();
    assert.equal(app.worker.trusted(frame.sender), true);
    const context = (
      frame.posted[0] as { context: { supported: boolean; reason: string } }
    ).context;
    assert.equal(context.supported, false);
    assert.equal(context.reason, 'unsupported');
    assert.equal(app.worker.activate({ ...tab, url }, false), true);
    const id = crypto.randomUUID();
    frame.messages.emit({
      type: 'orders:capture',
      id,
      expected_origin: new URL(url).origin,
    });
    await flush();
    assert.equal(app.sources.length, 0);
    assert.deepEqual(frame.posted.at(-1), {
      type: 'orders:error',
      id,
      code: 'UNSUPPORTED_PAGE',
    });
    assert.equal(app.worker.trusted(frame.sender), true);
    app.host.port.disconnect();
  }
});

test('activation waits for ready, preserves record intent, and never redelivers on repeated ready', () => {
  const app = setup();
  app.register();
  assert.equal(app.worker.activate(tab, false), true);
  const frame = app.frame();
  assert.equal(frame.posted.length, 1);
  frame.messages.emit({ type: 'floating:ready' });
  const activation = frame.posted[1] as {
    type: string;
    id: string;
    record: boolean;
  };
  assert.equal(activation.type, 'floating:activate');
  assert.equal(activation.record, false);
  frame.messages.emit({ type: 'floating:ready' });
  assert.equal(frame.posted.length, 2);
  app.worker.activate(tab, true);
  assert.equal((frame.posted[2] as { record: boolean }).record, true);
});

test('capture uses immutable tab and document identity and never carries answers or auth to host', async () => {
  const app = setup();
  app.register();
  const frame = app.frame();
  const id = crypto.randomUUID();
  frame.messages.emit({
    type: 'orders:capture',
    id,
    expected_origin: origin,
    tabId: 99,
  });
  await flush();
  assert.equal(app.sources.length, 0);
  frame.messages.emit({ type: 'orders:capture', id, expected_origin: origin });
  await flush();
  assert.deepEqual(app.destinations, [
    {
      id: 1,
      options: { name: 'orders-page', frameId: 0, documentId: sourceDocument },
    },
  ]);
  assert.deepEqual(app.sources[0]!.posted, [
    { type: 'orders:capture', id, expected_origin: origin },
  ]);
  app.sources[0]!.messages.emit({
    type: 'orders:error',
    id,
    code: 'INVALID_PAGE',
  });
  assert.deepEqual(frame.posted.at(-1), {
    type: 'orders:error',
    id,
    code: 'INVALID_PAGE',
  });
  assert.deepEqual(app.host.posted, [
    { type: 'floating:registered' },
    { type: 'floating:mount' },
  ]);
  frame.messages.emit({ type: 'floating:reset' });
  assert.equal(app.sources[0]!.closed, true);
  assert.equal(app.worker.trusted(frame.sender), true);
});

test('dismiss revokes old frame immediately; only a fresh boot can reopen without stale activation', () => {
  const app = setup();
  app.register();
  const frame = app.frame();
  app.worker.activate(tab, true);
  frame.messages.emit({ type: 'floating:close' });
  assert.deepEqual(app.revoked, [frame.sender]);
  assert.equal(app.worker.trusted(frame.sender), false);
  assert.equal(app.host.closed, false);
  assert.equal(frame.port.sender!.documentId, frame.sender.documentId);
  assert.equal(app.frame().closed, true);
  const boot = crypto.randomUUID();
  app.host.messages.emit({ type: 'floating:host-ready', boot });
  const count = app.host.posted.length;
  assert.equal(app.frame({}, app.boot).closed, true);
  assert.equal(app.host.posted.length, count);
  app.worker.activate(tab, false);
  const reopened = app.frame({}, boot);
  reopened.messages.emit({ type: 'floating:ready' });
  const activations = reopened.posted.filter(
    (value) => (value as { type: string }).type === 'floating:activate',
  );
  assert.equal(activations.length, 1);
  assert.equal((activations[0] as { record: boolean }).record, false);
});

test('navigation and host loss revoke bindings, pending requests and queued activations', async () => {
  for (const close of ['navigation', 'host', 'tab']) {
    const app = setup();
    app.register();
    const frame = app.frame();
    app.worker.activate(tab, true);
    frame.messages.emit({
      type: 'orders:capture',
      id: crypto.randomUUID(),
      expected_origin: origin,
    });
    if (close === 'navigation')
      app.updated.emit(tab.id!, { url: `${origin}/other` });
    else if (close === 'host') app.host.port.disconnect();
    else app.removed.emit(tab.id!);
    await flush();
    assert.equal(app.sources.length, 0);
    assert.equal(app.worker.trusted(frame.sender), false);
    assert.deepEqual(app.revoked, [frame.sender]);
    assert.equal(app.frame().closed, true);
    assert.equal(app.worker.activate(tab, true), false);
    assert.equal(
      frame.posted.some(
        (value) => (value as { type: string }).type === 'floating:activate',
      ),
      false,
    );
  }
});

test('capture after tab change fails closed before opening source', async () => {
  const app = setup();
  app.register();
  const frame = app.frame();
  app.setTab({ active: false });
  frame.messages.emit({
    type: 'orders:capture',
    id: crypto.randomUUID(),
    expected_origin: origin,
  });
  await flush();
  assert.equal(app.sources.length, 0);
  assert.equal(app.worker.trusted(frame.sender), false);
});

test('cold reconnect preserves dismissal until a deliberate activation and rejects cached frames', () => {
  const app = setup();
  app.connected.emit(app.host.port);
  app.host.messages.emit({
    type: 'floating:host-ready',
    boot: app.boot,
    dismissed: true,
  });
  assert.deepEqual(app.host.posted, [{ type: 'floating:registered' }]);
  assert.equal(app.frame().closed, true);
  app.worker.activate(tab, true);
  assert.equal(app.frame({ documentLifecycle: 'cached' }).closed, true);
  const frame = app.frame();
  frame.messages.emit({ type: 'floating:ready' });
  assert.equal((frame.posted.at(-1) as { record: boolean }).record, true);
});

test('iframe loading and unchanged top URL do not tear down the main document binding', () => {
  const app = setup();
  app.register();
  app.updated.emit(tab.id!, { status: 'loading' });
  app.updated.emit(tab.id!, { status: 'complete', url: `${origin}/orders` });
  const frame = app.frame();
  assert.equal(app.worker.trusted(frame.sender), true);
  assert.equal(app.host.closed, false);
  app.host.port.disconnect();
  assert.equal(app.worker.trusted(frame.sender), false);
  assert.equal(
    app.host.posted.some(
      (value) => (value as { type: string }).type === 'floating:remove',
    ),
    false,
  );
});

test('a fresh URL lookup rejects query navigation before the update event arrives', async () => {
  const app = setup();
  app.register();
  const frame = app.frame();
  app.setTab({ url: `${origin}/orders?region=other` });
  frame.messages.emit({
    type: 'orders:capture',
    id: crypto.randomUUID(),
    expected_origin: origin,
  });
  await flush();
  assert.equal(app.sources.length, 0);
  assert.equal(app.worker.trusted(frame.sender), false);
});
