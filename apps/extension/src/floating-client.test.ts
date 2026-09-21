import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FloatingClient, connectFloating } from './floating-client.ts';
import type { OrdersContext } from './page-context.ts';
import { parseFloatingHostCommand } from './floating-protocol.ts';
import type { StructuredSnapshot } from '@adc/contracts';

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

test('speech owner metadata waits for readiness and remote Stop never captures or transfers audio', () => {
  const app = setup();
  const events: unknown[] = [];
  app.client.subscribe((event) => events.push(event));
  try {
    for (const invalid of [
      { type: 'floating:speech-status', active: false, other: true },
      { type: 'floating:speech-status', active: 'yes', other: true },
      {
        type: 'floating:speech-status',
        active: true,
        other: true,
        text: 'private',
      },
      { type: 'floating:speech-stop', active: true },
    ])
      app.receive(invalid);
    assert.deepEqual(events, []);
    app.receive({ type: 'floating:speech-status', active: true, other: true });
    assert.deepEqual(events, []);
    app.client.ready();
    assert.deepEqual(events, [
      { type: 'speech-status', active: true, other: true },
    ]);
    app.client.reportSpeech(true);
    app.client.reportSpeech(true);
    app.client.stopSpeech();
    app.receive({ type: 'floating:speech-stop' });
    app.client.reportSpeech(false);
    app.receive({
      type: 'floating:speech-status',
      active: false,
      other: false,
    });
    assert.deepEqual(events.slice(-2), [
      { type: 'speech-stop' },
      { type: 'speech-status', active: false, other: false },
    ]);
    assert.deepEqual(app.posted, [
      { type: 'floating:ready' },
      { type: 'floating:speech-state', active: true },
      { type: 'floating:stop-speech' },
      { type: 'floating:speech-state', active: false },
    ]);
    app.client.close();
    const count = events.length;
    app.receive({ type: 'floating:speech-status', active: true, other: true });
    app.receive({ type: 'floating:speech-stop' });
    assert.equal(events.length, count);
  } finally {
    app.client.dispose();
  }
});

test('window follow resume buffers presentation only and never records, captures or replays', () => {
  const app = setup();
  const events: unknown[] = [];
  app.client.subscribe((event) => events.push(event));
  try {
    app.receive({ type: 'floating:resume', expanded: true });
    app.receive({ type: 'floating:resume', expanded: false });
    assert.deepEqual(events, []);
    assert.deepEqual(app.posted, []);
    app.client.ready();
    app.client.ready();
    assert.deepEqual(events, [{ type: 'resume', expanded: false }]);
    assert.ok(
      app.posted.every(
        (value) => (value as { type: string }).type === 'floating:ready',
      ),
    );
    app.client.close();
    app.receive({ type: 'floating:resume', expanded: true });
    assert.equal(
      events.filter((value) => (value as { type: string }).type === 'resume')
        .length,
      1,
    );
  } finally {
    app.client.dispose();
  }
});

test('a follow resume awaiting readiness is discarded when its tab loses focus or the window session ends', () => {
  for (const event of [
    { type: 'floating:invalidated', reason: 'tab' },
    { type: 'floating:cancel' },
  ]) {
    const app = setup();
    const received: unknown[] = [];
    app.client.subscribe((value) => received.push(value));
    try {
      app.receive({ type: 'floating:resume', expanded: true });
      app.receive(event);
      app.client.ready();
      assert.ok(
        !received.some(
          (value) => (value as { type: string }).type === 'resume',
        ),
      );
    } finally {
      app.client.dispose();
    }
  }
});

const structuredContext: OrdersContext = {
  sourceKind: 'structured_page',
  supported: true,
  permission: 'granted',
  capability: 'supported',
  reason: null,
  tabId: 7,
  windowId: 9,
  origin: 'https://orders.example.test',
  pathname: '/article',
  documentId: crypto.randomUUID(),
};
const article: StructuredSnapshot = {
  source_kind: 'structured_page',
  snapshot_id: crypto.randomUUID(),
  captured_at: new Date().toISOString(),
  origin: structuredContext.origin!,
  pathname: '/article',
  title: 'Community guide',
  document_key: crypto.randomUUID(),
  window_id: 9,
  tab_id: 7,
  fingerprint: 'a'.repeat(64),
  sections: [{ id: 's1', heading: 'Introduction' }],
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

test('explicit page check requests fresh worker metadata once; standby and inspection-free asking need no capture step', async () => {
  const app = setup({
    ...structuredContext,
    supported: false,
    permission: 'required',
    capability: 'unchecked',
    reason: 'permission_required',
  });
  const page = app.client.createPage();
  try {
    await page.getContext();
    app.client.layout(false, 80, true, 80);
    assert.deepEqual(
      [...app.posted],
      [
        {
          type: 'floating:layout',
          expanded: false,
          height: 80,
          launcher: true,
          width: 80,
        },
      ],
    );
    const checking = app.client.preparePage();
    assert.equal(app.client.preparePage(), checking);
    const request = app.posted.at(-1) as { type: string; id: string };
    assert.equal(request.type, 'floating:check-page');
    assert.equal(app.posted.length, 2);
    for (const invalid of [
      { id: crypto.randomUUID(), context: structuredContext },
      { id: request.id, context: { ...structuredContext, tabId: 999 } },
      {
        id: request.id,
        context: { ...structuredContext, origin: 'https://other.example.test' },
      },
    ]) {
      app.receive({ type: 'floating:context-checked', ...invalid });
      assert.equal((await page.getContext()).permission, 'required');
    }
    app.receive({
      type: 'floating:context-checked',
      id: request.id,
      context: structuredContext,
    });
    assert.equal((await checking).supported, true);
    assert.equal((await page.getContext()).supported, true);
    assert.equal(app.posted.length, 2, 'Checking must not capture or submit');
    const second = page.prepareContext();
    const secondRequest = app.posted.at(-1) as { id: string };
    assert.notEqual(secondRequest.id, request.id);
    app.receive({
      type: 'floating:context-checked',
      id: secondRequest.id,
      context: structuredContext,
    });
    assert.equal((await second).supported, true);
  } finally {
    app.client.dispose();
  }
});

test('reset, page invalidation and close discard pending checks and ignore their late results', async () => {
  for (const action of ['reset', 'invalidate', 'close'] as const) {
    const app = setup({
      ...structuredContext,
      supported: false,
      permission: 'required',
      capability: 'unchecked',
      reason: 'permission_required',
    });
    const page = app.client.createPage();
    try {
      const checking = app.client.preparePage();
      const request = app.posted.at(-1) as { id: string };
      const rejected = assert.rejects(checking, /CONTEXT_CHANGED/u);
      if (action === 'reset') page.reset();
      else if (action === 'close') app.client.close();
      else app.receive({ type: 'floating:invalidated', reason: 'page' });
      await rejected;
      app.receive({
        type: 'floating:context-checked',
        id: request.id,
        context: structuredContext,
      });
      assert.equal((await page.getContext()).supported, false);
    } finally {
      app.client.dispose();
    }
  }
});

test('page-check timeout is recoverable and a late reply cannot complete a newer check', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const app = setup(structuredContext);
  try {
    const first = app.client.preparePage();
    const old = app.posted.at(-1) as { id: string };
    const rejected = assert.rejects(first, /UNAVAILABLE/u);
    context.mock.timers.tick(10_000);
    await rejected;
    const second = app.client.preparePage();
    const current = app.posted.at(-1) as { id: string };
    app.receive({
      type: 'floating:context-checked',
      id: old.id,
      context: {
        ...structuredContext,
        supported: false,
        capability: 'unsupported',
        reason: 'unsupported',
      },
    });
    assert.equal((await app.client.createPage().getContext()).supported, true);
    app.receive({
      type: 'floating:context-checked',
      id: current.id,
      context: structuredContext,
    });
    assert.equal((await second).supported, true);
  } finally {
    app.client.dispose();
  }
});

test('permission updates are metadata-only, invalidate old work once, and reject a different source context', async () => {
  const app = setup({
    ...structuredContext,
    supported: false,
    permission: 'required',
    capability: 'unchecked',
    reason: 'permission_required',
  });
  const page = app.client.createPage();
  const reasons: string[] = [];
  page.subscribe((reason) => reasons.push(reason));
  try {
    app.receive({
      type: 'floating:context',
      context: { ...structuredContext, tabId: 99 },
    });
    assert.equal((await page.getContext()).permission, 'required');
    app.receive({ type: 'floating:context', context: structuredContext });
    app.receive({ type: 'floating:context', context: structuredContext });
    assert.equal((await page.getContext()).permission, 'granted');
    assert.deepEqual(reasons, ['page']);
    assert.deepEqual(app.posted, []);
  } finally {
    app.client.dispose();
  }
});

test('structured capture and verification bind snapshot to this frame tab/window without orders requests', async () => {
  const app = setup(structuredContext);
  const page = app.client.createPage();
  try {
    const capturing = page.capture(
      new AbortController().signal,
      article.origin,
      7,
    );
    const request = app.posted.at(-1) as {
      type: string;
      id: string;
      tab_id: number;
      window_id: number;
    };
    assert.equal(request.type, 'structured:capture');
    assert.equal(request.tab_id, 7);
    assert.equal(request.window_id, 9);
    app.receive({
      type: 'structured:result',
      id: request.id,
      snapshot: article,
    });
    assert.deepEqual(await capturing, article);
    const verifying = page.verify(article, new AbortController().signal);
    const verify = app.posted.at(-1) as { type: string; id: string };
    assert.equal(verify.type, 'structured:verify');
    app.receive({ type: 'structured:verified', id: verify.id, current: true });
    assert.equal(await verifying, true);
    const other = page.capture(new AbortController().signal, article.origin, 7);
    const request2 = app.posted.at(-1) as { id: string };
    app.receive({
      type: 'structured:result',
      id: request2.id,
      snapshot: { ...article, window_id: 999 },
    });
    await assert.rejects(other, /CONTEXT_CHANGED/u);
  } finally {
    app.client.dispose();
  }
});

test('structured page change cancels capture and a late response cannot restore it', async () => {
  const app = setup(structuredContext);
  const page = app.client.createPage();
  try {
    const capturing = page.capture(
      new AbortController().signal,
      article.origin,
      7,
    );
    const request = app.posted.at(-1) as { id: string };
    app.receive({
      type: 'structured:changed',
      document_key: article.document_key,
    });
    app.receive({
      type: 'structured:result',
      id: request.id,
      snapshot: article,
    });
    await assert.rejects(capturing, /CONTEXT_CHANGED/u);
    assert.equal(
      await page.verify(article, new AbortController().signal),
      false,
    );
  } finally {
    app.client.dispose();
  }
});

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
