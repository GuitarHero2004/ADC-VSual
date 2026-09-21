import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroundedSnapshot, StructuredSnapshot } from '@adc/contracts';
import { OrdersPageContext, type OrdersContext } from './page-context.ts';
import type {
  OrdersPageRequest,
  OrdersPageResponse,
} from './orders-adapter.ts';

class Events<Arguments extends unknown[]> {
  listeners = new Set<(...args: Arguments) => void>();
  addListener = (listener: (...args: Arguments) => void) => {
    this.listeners.add(listener);
  };
  removeListener = (listener: (...args: Arguments) => void) => {
    this.listeners.delete(listener);
  };
  emit = (...args: Arguments) => {
    for (const listener of this.listeners) listener(...args);
  };
}

function deferQuery() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const source: GroundedSnapshot = {
  snapshot_id: '4a979130-38a6-4acf-9589-8e9adf9d5e83',
  adapter_key: 'orders-fixture@1',
  captured_at: '2026-09-20T00:00:00.000Z',
  origin: 'https://demo.example.test',
  pathname: '/orders',
  document_key: '827b2170-d154-4fb2-b3c1-c71717001873',
  title: 'Completed orders',
  table_title: 'South completed orders',
  region: 'South',
  year: 2026,
  metric: 'completed_orders',
  unit: 'orders',
  locale: 'en-US',
  is_complete: true,
  fingerprint: 'a'.repeat(64),
  rows: [
    {
      id: '2026-07',
      period: '2026-07',
      region: 'South',
      raw_value: '1,200',
      value: 1200,
    },
    {
      id: '2026-08',
      period: '2026-08',
      region: 'South',
      raw_value: '900',
      value: 900,
    },
  ],
};

function fakeBrowser(origins = ['https://demo.example.test']) {
  const state = {
    tab: { id: 1, windowId: 10, url: 'https://demo.example.test/orders' },
    autoReply: true,
    queryDelay: null as Promise<void> | null,
  };
  const ports: ReturnType<typeof makePort>[] = [];
  const posted: OrdersPageRequest[] = [];
  const updates: unknown[] = [];
  const queries: chrome.tabs.QueryInfo[] = [];
  const activated = new Events<[{ tabId: number; windowId: number }]>();
  const updated = new Events<[number, { url?: string; status?: string }]>();
  const removed = new Events<[number]>();
  function makePort() {
    const messages = new Events<[unknown]>();
    const disconnected = new Events<[]>();
    let closed = false;
    return {
      onMessage: messages,
      onDisconnect: disconnected,
      get closed() {
        return closed;
      },
      disconnect() {
        closed = true;
        disconnected.emit();
      },
      postMessage(message: OrdersPageRequest) {
        posted.push(message);
        if (!state.autoReply) return;
        const response: OrdersPageResponse =
          message.type === 'orders:capture'
            ? { type: 'orders:result', id: message.id, snapshot: source }
            : message.type === 'orders:verify'
              ? { type: 'orders:verified', id: message.id, current: true }
              : { type: 'orders:focused', id: message.id, restored: false };
        queueMicrotask(() => messages.emit(response));
      },
    };
  }
  const api = {
    tabs: {
      query: async (options: chrome.tabs.QueryInfo) => {
        queries.push(options);
        const tab = { ...state.tab };
        await state.queryDelay;
        return [tab];
      },
      connect: (id: number, options: unknown) => {
        assert.equal(id, state.tab.id);
        assert.deepEqual(options, { name: 'orders-page', frameId: 0 });
        const port = makePort();
        ports.push(port);
        return port;
      },
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
      onActivated: activated,
      onUpdated: updated,
      onRemoved: removed,
    },
    windows: {
      update: async (...args: unknown[]) => {
        updates.push(args);
      },
    },
  } as unknown as Pick<typeof chrome, 'tabs' | 'windows'>;
  const page = new OrdersPageContext(origins, api);
  return {
    api,
    page,
    state,
    ports,
    posted,
    updates,
    queries,
    activated,
    updated,
    removed,
  };
}

test('side-panel fallback shares browser grant and observes structured changes before capture', async () => {
  const fake = fakeBrowser();
  fake.page.dispose();
  fake.state.tab.url = 'https://article.example.test/guide';
  const documentId = crypto.randomUUID();
  let granted = false;
  const context = (): OrdersContext => ({
    supported: granted,
    tabId: 1,
    windowId: 10,
    origin: 'https://article.example.test',
    pathname: '/guide',
    sourceKind: 'structured_page',
    permission: granted ? 'granted' : 'required',
    capability: granted ? 'supported' : 'unchecked',
    reason: granted ? null : 'permission_required',
    ...(granted ? { documentId } : {}),
  });
  const posted: Record<string, unknown>[] = [];
  const messages = new Events<[unknown]>();
  const disconnects = new Events<[]>();
  const runtimeMessages = new Events<[unknown, chrome.runtime.MessageSender]>();
  const contextRequests: unknown[] = [];
  const runtime = {
    id: 'a'.repeat(32),
    onMessage: runtimeMessages,
    sendMessage: async (message: unknown) => {
      contextRequests.push(message);
      return context();
    },
  } as unknown as typeof chrome.runtime;
  const snapshot: StructuredSnapshot = {
    source_kind: 'structured_page',
    snapshot_id: crypto.randomUUID(),
    captured_at: new Date().toISOString(),
    origin: 'https://article.example.test',
    pathname: '/guide',
    title: 'Guide',
    document_key: crypto.randomUUID(),
    window_id: 10,
    tab_id: 1,
    fingerprint: 'a'.repeat(64),
    sections: [{ id: 's1', heading: 'Guide' }],
    blocks: [
      {
        id: 'b1',
        section_id: 's1',
        kind: 'paragraph',
        text: 'The library opens on Monday.',
      },
    ],
    coverage: { partial: false, limitations: [], included_sections: ['s1'] },
  };
  const browser = {
    ...fake.api,
    runtime,
    tabs: {
      ...fake.api.tabs,
      connect: (id: number, options: unknown) => {
        assert.equal(id, 1);
        assert.deepEqual(options, {
          name: 'structured-page',
          frameId: 0,
          documentId,
        });
        return {
          onMessage: messages,
          onDisconnect: disconnects,
          disconnect: () => disconnects.emit(),
          postMessage: (message: Record<string, unknown>) => {
            posted.push(message);
            if (message.type === 'structured:capture')
              queueMicrotask(() =>
                messages.emit({
                  type: 'structured:result',
                  id: message.id,
                  snapshot,
                }),
              );
          },
        } as unknown as chrome.runtime.Port;
      },
    },
  };
  const page = new OrdersPageContext([], browser);
  const reasons: string[] = [];
  page.subscribe((reason) => reasons.push(reason));
  try {
    assert.equal((await page.getContext()).permission, 'required');
    assert.equal(posted.length, 0);
    assert.deepEqual(contextRequests.at(-1), {
      type: 'structured:context',
      tabId: 1,
    });
    assert.equal((await page.prepareContext()).permission, 'required');
    assert.deepEqual(contextRequests.at(-1), {
      type: 'structured:prepare',
      tabId: 1,
    });
    assert.equal(posted.length, 0);
    granted = true;
    runtimeMessages.emit(
      { type: 'structured:permission-updated', tabId: 1 },
      { id: runtime.id },
    );
    assert.equal((await page.getContext()).supported, true);
    assert.deepEqual(reasons, ['page']);
    assert.deepEqual(
      posted.map((message) => message.type),
      ['structured:probe'],
    );
    messages.emit({
      type: 'structured:changed',
      document_key: snapshot.document_key,
    });
    assert.deepEqual(reasons, ['page', 'page']);
    const result = await page.capture(
      new AbortController().signal,
      snapshot.origin,
      1,
    );
    assert.deepEqual(result, snapshot);
    assert.equal(posted.at(-1)?.type, 'structured:capture');
  } finally {
    page.dispose();
  }
});

test('navigation from an unsupported active page enables context before any capture', async () => {
  const fake = fakeBrowser();
  fake.state.tab.url = 'https://demo.example.test/voice';
  try {
    assert.equal((await fake.page.getContext()).supported, false);
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    fake.state.tab.url = 'https://demo.example.test/orders';
    fake.updated.emit(1, { url: fake.state.tab.url });
    assert.deepEqual(reasons, ['page']);
    assert.equal((await fake.page.getContext()).supported, true);
    assert.equal(fake.ports.length, 0);
    assert.equal(fake.posted.length, 0);
  } finally {
    fake.page.dispose();
  }
});

test('navigation away from orders before first capture invalidates supported context', async () => {
  const fake = fakeBrowser();
  try {
    assert.equal((await fake.page.getContext()).supported, true);
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    fake.state.tab.url = 'https://demo.example.test/voice';
    fake.updated.emit(1, { status: 'loading' });
    assert.deepEqual(reasons, ['page']);
    assert.equal((await fake.page.getContext()).supported, false);
    assert.equal(fake.ports.length, 0);
    assert.equal(fake.posted.length, 0);
  } finally {
    fake.page.dispose();
  }
});

test('completed navigation refreshes context and observation survives permission reset', async () => {
  const fake = fakeBrowser();
  try {
    await fake.page.getContext();
    fake.page.reset();
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    fake.state.tab.url = 'https://demo.example.test/voice';
    fake.updated.emit(1, { status: 'complete' });
    assert.deepEqual(reasons, ['page']);
    assert.equal((await fake.page.getContext()).supported, false);
    fake.state.tab.url = 'https://demo.example.test/orders';
    fake.updated.emit(1, { status: 'complete' });
    assert.equal((await fake.page.getContext()).supported, true);
    assert.equal(fake.ports.length, 0);
  } finally {
    fake.page.dispose();
  }
});

test('other tabs and windows do not replace or invalidate the panel active tab', async () => {
  const fake = fakeBrowser();
  try {
    await fake.page.getContext();
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    fake.activated.emit({ tabId: 2, windowId: 20 });
    fake.updated.emit(2, { url: 'https://demo.example.test/orders' });
    fake.removed.emit(2);
    assert.deepEqual(reasons, []);
    assert.equal((await fake.page.getContext()).tabId, 1);
    assert.deepEqual(fake.queries, [
      { active: true, currentWindow: true },
      { active: true, windowId: 10 },
    ]);
    // A stale browser result from a different window must not change observation.
    fake.state.tab = { ...fake.state.tab, id: 2, windowId: 20 };
    assert.equal((await fake.page.getContext()).supported, false);
    fake.updated.emit(1, { status: 'loading' });
    assert.deepEqual(reasons, ['page']);
  } finally {
    fake.page.dispose();
  }
});

test('a superseded context lookup cannot replace the newest observed tab', async () => {
  const fake = fakeBrowser();
  const deferred = deferQuery();
  fake.state.tab.url = 'https://demo.example.test/voice';
  fake.state.queryDelay = deferred.promise;
  try {
    const oldLookup = fake.page.getContext();
    fake.state.tab = {
      ...fake.state.tab,
      id: 2,
      url: 'https://demo.example.test/orders',
    };
    fake.state.queryDelay = null;
    assert.equal((await fake.page.getContext()).tabId, 2);
    deferred.resolve();
    assert.equal((await oldLookup).supported, false);
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    fake.updated.emit(1, { status: 'loading' });
    assert.deepEqual(reasons, []);
    fake.updated.emit(2, { status: 'loading' });
    assert.deepEqual(reasons, ['page']);
  } finally {
    deferred.resolve();
    fake.page.dispose();
  }
});

test('navigation during an in-flight lookup rejects its old URL before it can be allowed', async () => {
  const fake = fakeBrowser();
  const deferred = deferQuery();
  try {
    await fake.page.getContext();
    fake.state.queryDelay = deferred.promise;
    const oldLookup = fake.page.getContext();
    fake.state.tab.url = 'https://demo.example.test/voice';
    fake.updated.emit(1, { url: fake.state.tab.url });
    deferred.resolve();
    assert.equal((await oldLookup).supported, false);
    fake.state.queryDelay = null;
    assert.equal((await fake.page.getContext()).supported, false);
    assert.equal(fake.ports.length, 0);
  } finally {
    deferred.resolve();
    fake.page.dispose();
  }
});

test('context checks alone do not connect or capture; unsupported pages never receive capture messages', async () => {
  const fake = fakeBrowser();
  try {
    assert.equal((await fake.page.getContext()).supported, true);
    assert.equal(fake.ports.length, 0);
    assert.equal(fake.posted.length, 0);
    fake.state.tab.url = 'https://other.example.test/orders';
    await assert.rejects(
      fake.page.capture(new AbortController().signal, source.origin),
      {
        code: 'UNSUPPORTED_PAGE',
      },
    );
    assert.equal(fake.ports.length, 0);
  } finally {
    fake.page.dispose();
  }
});

test('explicit capture and freshness check are bound to browser tab and document without tokens', async () => {
  const fake = fakeBrowser();
  try {
    const snapshot = await fake.page.capture(
      new AbortController().signal,
      source.origin,
    );
    assert.equal(snapshot.document_key, source.document_key);
    assert.equal(
      await fake.page.verify(snapshot, new AbortController().signal),
      true,
    );
    assert.equal(fake.ports.length, 1);
    assert.deepEqual(
      fake.posted.map((message) => message.type),
      ['orders:capture', 'orders:verify'],
    );
    assert.deepEqual(Object.keys(fake.posted[0]!), [
      'type',
      'id',
      'expected_origin',
    ]);
    assert.equal(
      await fake.page.verify(
        { ...snapshot, document_key: crypto.randomUUID() },
        new AbortController().signal,
      ),
      false,
    );
    assert.equal(fake.posted.length, 2);
  } finally {
    fake.page.dispose();
  }
});

test('switching the source tab cancels pending capture and ignores a late response', async () => {
  const fake = fakeBrowser();
  fake.state.autoReply = false;
  try {
    const reasons: string[] = [];
    fake.page.subscribe((reason) => reasons.push(reason));
    const pending = fake.page.capture(
      new AbortController().signal,
      source.origin,
    );
    const rejected = assert.rejects(pending, { code: 'CONTEXT_CHANGED' });
    await new Promise((resolve) => setImmediate(resolve));
    const message = fake.posted[0]!;
    fake.state.tab = { ...fake.state.tab, id: 2 };
    fake.activated.emit({ tabId: 2, windowId: 10 });
    fake.ports[0]!.onMessage.emit({
      type: 'orders:result',
      id: message.id,
      snapshot: source,
    });
    await rejected;
    assert.deepEqual(reasons, ['tab']);
    assert.equal(fake.ports[0]!.closed, true);
    assert.equal(
      await fake.page.verify(source, new AbortController().signal),
      false,
    );
  } finally {
    fake.page.dispose();
  }
});

test('an origin or source tab change after consent is rejected before connecting or capturing', async () => {
  const fake = fakeBrowser([
    'https://demo.example.test',
    'https://other.example.test',
  ]);
  try {
    const permitted = await fake.page.getContext();
    fake.state.tab.url = 'https://other.example.test/orders';
    await assert.rejects(
      fake.page.capture(
        new AbortController().signal,
        permitted.origin!,
        permitted.tabId!,
      ),
      { code: 'CONTEXT_CHANGED' },
    );
    assert.equal(fake.posted.length, 0);
    assert.equal(fake.ports.length, 0);
    fake.state.tab.url = 'https://demo.example.test/orders';
    fake.state.tab.id = 2;
    await assert.rejects(
      fake.page.capture(
        new AbortController().signal,
        permitted.origin!,
        permitted.tabId!,
      ),
      { code: 'CONTEXT_CHANGED' },
    );
    assert.equal(fake.posted.length, 0);
    assert.equal(fake.ports.length, 0);
  } finally {
    fake.page.dispose();
  }
});

test('cancelled capture ignores late success; route changes and disconnect invalidate current data', async () => {
  const fake = fakeBrowser();
  try {
    fake.state.autoReply = false;
    const abort = new AbortController();
    const pending = fake.page.capture(abort.signal, source.origin);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await new Promise((resolve) => setImmediate(resolve));
    abort.abort();
    const message = fake.posted[0]!;
    fake.ports[0]!.onMessage.emit({
      type: 'orders:result',
      id: message.id,
      snapshot: source,
    });
    await rejected;
    fake.state.autoReply = true;
    const snapshot = await fake.page.capture(
      new AbortController().signal,
      source.origin,
    );
    fake.updated.emit(1, { status: 'loading' });
    assert.equal(
      await fake.page.verify(snapshot, new AbortController().signal),
      false,
    );
  } finally {
    fake.page.dispose();
  }
});

test('untrusted malformed content responses and changed events never become valid snapshots', async () => {
  const fake = fakeBrowser();
  fake.state.autoReply = false;
  try {
    const pending = fake.page.capture(
      new AbortController().signal,
      source.origin,
    );
    const rejected = assert.rejects(pending, { code: 'CONTEXT_CHANGED' });
    await new Promise((resolve) => setImmediate(resolve));
    fake.ports[0]!.onMessage.emit({
      type: 'orders:result',
      id: fake.posted[0]!.id,
      snapshot: { ...source, rows: [] },
    });
    await rejected;
  } finally {
    fake.page.dispose();
  }
});

test('permission withdrawal resets content port; logout/dispose removes listeners and pending work', async () => {
  const fake = fakeBrowser();
  await fake.page.capture(new AbortController().signal, source.origin);
  fake.page.reset();
  assert.equal(fake.ports[0]!.closed, true);
  assert.equal(fake.activated.listeners.size, 1);
  await fake.page.capture(new AbortController().signal, source.origin);
  assert.equal(fake.ports.length, 2);
  fake.page.dispose();
  assert.equal(fake.ports[1]!.closed, true);
  assert.equal(fake.activated.listeners.size, 0);
  assert.equal(fake.updated.listeners.size, 0);
  assert.equal(fake.removed.listeners.size, 0);
  assert.equal(await fake.page.getContext().catch(() => null), null);
});

test('return to page reports fallback separately and uses supported tab/window APIs', async () => {
  const fake = fakeBrowser();
  try {
    const focus = await fake.page.returnToPage();
    assert.deepEqual(focus, { restored: false });
    assert.deepEqual(fake.updates, [
      [1, { active: true }],
      [10, { focused: true }],
    ]);
    assert.equal(fake.posted[0]!.type, 'orders:focus');
    assert.equal(fake.posted.length, 1);
  } finally {
    fake.page.dispose();
  }
});
