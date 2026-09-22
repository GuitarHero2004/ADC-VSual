import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installFloatingWorker } from './floating-worker.ts';
import type { StructuredPageAccess } from './structured-access.ts';
import type { OrdersContext } from './page-context.ts';

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
function setup(
  url = tab.url!,
  structured?: Pick<StructuredPageAccess, 'context' | 'activate' | 'prepare'>,
  session?: Record<string, unknown>,
  visualContext?: (
    tab: chrome.tabs.Tab,
  ) => Promise<NonNullable<OrdersContext['visual']>>,
) {
  const connected = new Events<[chrome.runtime.Port]>();
  const updated = new Events<[number, chrome.tabs.OnUpdatedInfo]>();
  const removed = new Events<[number]>();
  const activated = new Events<[{ tabId: number; windowId: number }]>();
  const focused = new Events<[number]>();
  const sources: ReturnType<typeof makePort>[] = [];
  const destinations: unknown[] = [];
  let currentTab: chrome.tabs.Tab = { ...tab, url };
  const tabs = new Map<number, chrome.tabs.Tab>([[currentTab.id!, currentTab]]);
  let windowFocused = true;
  const revoked: chrome.runtime.MessageSender[] = [];
  const browser = {
    runtime: { id: extensionId, onConnect: connected },
    ...(session
      ? {
          storage: {
            session: {
              get: async (key: string) => ({ [key]: session[key] }),
              set: async (values: Record<string, unknown>) => {
                Object.assign(session, values);
              },
              remove: async (key: string) => {
                delete session[key];
              },
            },
          },
        }
      : {}),
    tabs: {
      onUpdated: updated,
      onRemoved: removed,
      onActivated: activated,
      get: async (id: number) => tabs.get(id) ?? currentTab,
      update: async () => currentTab,
      connect(id: number, options: unknown) {
        destinations.push({ id, options });
        const source = makePort('orders-page');
        sources.push(source);
        return source.port;
      },
    },
    windows: {
      update: async () => ({}),
      onFocusChanged: focused,
      ...(session ? { get: async () => ({ focused: windowFocused }) } : {}),
    },
  } as unknown as typeof chrome;
  const worker = installFloatingWorker(
    [origin],
    browser,
    origin,
    (sender) => revoked.push(sender),
    structured,
    visualContext,
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
    activateTab(value: chrome.tabs.Tab) {
      for (const [id, old] of tabs)
        if (old.windowId === value.windowId)
          tabs.set(id, { ...old, active: false });
      currentTab = { ...value, active: true };
      tabs.set(value.id!, currentTab);
      activated.emit({ tabId: value.id!, windowId: value.windowId });
    },
    focus(value: boolean) {
      windowFocused = value;
      focused.emit(value ? currentTab.windowId : -1);
    },
    addPage(value: chrome.tabs.Tab) {
      tabs.set(value.id!, value);
      const documentId = crypto.randomUUID();
      const otherBoot = crypto.randomUUID();
      const otherHost = makePort('floating-host', {
        id: extensionId,
        tab: value,
        frameId: 0,
        documentId,
        url: value.url!,
      });
      connected.emit(otherHost.port);
      otherHost.messages.emit({ type: 'floating:host-ready', boot: otherBoot });
      const otherFrame = makePort('floating-surface', {
        id: extensionId,
        tab: value,
        frameId: 3,
        documentId: crypto.randomUUID(),
        url: `chrome-extension://${extensionId}/floating.html#${otherBoot}`,
      });
      connected.emit(otherFrame.port);
      return { host: otherHost, frame: otherFrame, documentId };
    },
    setTab(value: Partial<chrome.tabs.Tab>) {
      currentTab = { ...currentTab, ...value };
      tabs.set(currentTab.id!, currentTab);
    },
  };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('completed speech owner survives tab switches and trusted controls in the new frame can stop it', async () => {
  const app = setup();
  app.register();
  const first = app.frame();
  first.messages.emit({ type: 'floating:speech-state', active: true });
  const secondTab = { ...tab, id: 2, url: `${origin}/guide`, active: false };
  const second = app.addPage(secondTab);
  assert.deepEqual(second.frame.posted.at(-1), {
    type: 'floating:speech-status',
    active: true,
    other: true,
  });
  app.activateTab(secondTab);
  app.focus(false);
  await flush();
  assert.equal(
    first.posted.some(
      (message) =>
        (message as { type: string }).type === 'floating:speech-stop',
    ),
    false,
  );
  assert.equal(app.sources.length, 0);
  second.frame.messages.emit({
    type: 'floating:stop-speech',
    text: 'not allowed',
  });
  app.host.messages.emit({ type: 'floating:stop-speech' });
  assert.equal(
    first.posted.some(
      (message) =>
        (message as { type: string }).type === 'floating:speech-stop',
    ),
    false,
  );
  second.frame.messages.emit({ type: 'floating:stop-speech' });
  assert.equal(
    first.posted.filter(
      (message) =>
        (message as { type: string }).type === 'floating:speech-stop',
    ).length,
    1,
  );
  assert.deepEqual(second.frame.posted.at(-1), {
    type: 'floating:speech-status',
    active: false,
    other: false,
  });
  first.messages.emit({ type: 'floating:speech-state', active: true });
  second.frame.messages.emit({ type: 'floating:speech-state', active: true });
  first.messages.emit({ type: 'floating:speech-state', active: false });
  assert.deepEqual(second.frame.posted.at(-1), {
    type: 'floating:speech-status',
    active: true,
    other: false,
  });
  assert.ok(
    app.host.posted.every(
      (message) => !(message as { type: string }).type.includes('speech'),
    ),
  );
  second.frame.messages.emit({ type: 'floating:reset' });
  assert.deepEqual(first.posted.at(-1), {
    type: 'floating:speech-status',
    active: false,
    other: false,
  });
  app.host.port.disconnect();
  second.host.port.disconnect();
});

test('shortcut or new work on another tab stops speech; End and navigation cannot leave an owner behind', async () => {
  for (const action of [
    'shortcut',
    'claim',
    'end',
    'navigate',
    'disconnect',
  ] as const) {
    const app = setup();
    app.register();
    const first = app.frame();
    first.messages.emit({ type: 'floating:speech-state', active: true });
    const secondTab = { ...tab, id: 2, url: `${origin}/guide`, active: false };
    const second = app.addPage(secondTab);
    app.activateTab(secondTab);
    second.frame.messages.emit({ type: 'floating:ready' });
    if (action === 'shortcut')
      assert.equal(app.worker.activate(secondTab, true), true);
    if (action === 'claim')
      second.frame.messages.emit({ type: 'floating:claim' });
    if (action === 'end')
      second.frame.messages.emit({ type: 'floating:close' });
    if (action === 'navigate')
      app.updated.emit(tab.id!, { url: `${origin}/changed` });
    if (action === 'disconnect') app.host.port.disconnect();
    await flush();
    assert.equal(
      first.posted.filter(
        (message) =>
          (message as { type: string }).type === 'floating:speech-stop',
      ).length,
      1,
    );
    assert.equal(
      second.frame.posted.some(
        (message) => (message as { type: string }).type === 'floating:activate',
      ),
      false,
    );
    assert.ok(
      second.frame.posted.some(
        (message) =>
          (message as { type: string; active?: boolean }).type ===
            'floating:speech-status' &&
          !(message as { active: boolean }).active,
      ),
    );
    assert.equal(app.sources.length, 0);
    app.host.port.disconnect();
    second.host.port.disconnect();
  }
});

test('actual source mutations and lost source connection stop the retained speech owner', async () => {
  for (const action of ['change', 'disconnect'] as const) {
    const app = setup();
    app.register();
    const frame = app.frame();
    frame.messages.emit({
      type: 'orders:capture',
      id: crypto.randomUUID(),
      expected_origin: origin,
    });
    await flush();
    frame.messages.emit({ type: 'floating:speech-state', active: true });
    const source = app.sources[0]!;
    if (action === 'change')
      source.messages.emit({
        type: 'orders:changed',
        document_key: crypto.randomUUID(),
      });
    else source.port.disconnect();
    assert.equal(
      frame.posted.filter(
        (message) =>
          (message as { type: string }).type === 'floating:speech-stop',
      ).length,
      1,
    );
    assert.ok(
      frame.posted.some(
        (message) =>
          (message as { type: string; active?: boolean }).type ===
            'floating:speech-status' &&
          !(message as { active: boolean }).active,
      ),
    );
    app.host.port.disconnect();
  }
});

function followAccess() {
  const prepared: { tabId: number; url: string; documentId: string }[] = [];
  let waiting = Promise.resolve();
  const context = (
    source: chrome.tabs.Tab,
    documentId?: string,
  ): OrdersContext => ({
    tabId: source.id!,
    windowId: source.windowId,
    origin: new URL(source.url!).origin,
    pathname: new URL(source.url!).pathname,
    sourceKind: 'structured_page',
    supported: !!documentId,
    reason: documentId ? null : 'permission_required',
    permission: documentId ? 'granted' : 'required',
    capability: documentId ? 'supported' : 'unchecked',
    ...(documentId ? { documentId } : {}),
  });
  return {
    prepared,
    wait(value: Promise<void>) {
      waiting = value;
    },
    access: {
      context: async (source: chrome.tabs.Tab, documentId?: string) =>
        context(
          source,
          prepared.some(
            (item) =>
              item.tabId === source.id &&
              item.url === source.url &&
              item.documentId === documentId,
          )
            ? documentId
            : undefined,
        ),
      activate: async (source: chrome.tabs.Tab) =>
        context(source, sourceDocument),
      prepare: async (source: chrome.tabs.Tab, documentId?: string) => {
        prepared.push({
          tabId: source.id!,
          url: source.url!,
          documentId: documentId!,
        });
        await waiting;
        return context(source, documentId);
      },
    },
  };
}

test('SPA follow uses the current trusted tab URL when Chrome retains the original sender URL', async () => {
  const currentUrl = 'https://article.example.test/updated-article';
  const permission = followAccess();
  const app = setup(currentUrl, permission.access, {
    'floating-follow:2': { enabled: true, expanded: true },
  });
  const host = makePort('floating-host', {
    ...hostSender,
    url: 'https://article.example.test/original-article',
    tab: { ...tab, url: currentUrl },
  });
  app.connected.emit(host.port);
  host.messages.emit({ type: 'floating:host-ready', boot: app.boot });
  const frame = app.frame();
  await flush();
  assert.equal(permission.prepared.length, 1);
  assert.equal(permission.prepared[0]?.url, currentUrl);
  assert.ok(
    frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:resume',
    ),
  );
  assert.ok(
    app.sources.every((source) =>
      source.posted.every(
        (value) => (value as { type: string }).type === 'structured:probe',
      ),
    ),
  );
  host.port.disconnect();
  for (const url of [
    'https://different.example.test/article',
    `${origin}/auth/login`,
  ]) {
    const stale = makePort('floating-host', {
      ...hostSender,
      url: `${origin}/orders`,
      tab: { ...tab, url },
    });
    app.connected.emit(stale.port);
    assert.equal(stale.closed, true);
  }
});

test('explicitly opened companion follows foreground tabs using metadata only and preserves collapse until End', async () => {
  const session: Record<string, unknown> = {};
  const permission = followAccess();
  const app = setup(
    'https://article.example.test/first',
    permission.access,
    session,
  );
  app.register();
  const frame = app.frame();
  frame.messages.emit({
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 80,
  });
  await flush();
  assert.equal(permission.prepared.length, 0);
  assert.deepEqual(session, {});
  frame.messages.emit({ type: 'floating:check-page', id: crypto.randomUUID() });
  frame.messages.emit({ type: 'floating:layout', expanded: true, height: 600 });
  await flush();
  assert.deepEqual(session['floating-follow:2'], {
    enabled: true,
    expanded: true,
  });
  const secondTab = {
    ...tab,
    id: 2,
    url: 'https://another.example.test/article',
    active: false,
  };
  const second = app.addPage(secondTab);
  second.frame.messages.emit({
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 80,
  });
  await flush();
  assert.equal(permission.prepared.length, 1);
  app.activateTab(secondTab);
  await flush();
  assert.equal(permission.prepared.length, 2);
  assert.ok(
    second.frame.posted.some(
      (value) =>
        (value as { type: string; expanded?: boolean }).type ===
          'floating:resume' && (value as { expanded: boolean }).expanded,
    ),
  );
  assert.ok(
    !second.frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:activate',
    ),
  );
  assert.ok(
    app.sources.every((source) =>
      source.posted.every(
        (value) => (value as { type: string }).type === 'structured:probe',
      ),
    ),
  );
  second.frame.messages.emit({
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 80,
  });
  await flush();
  assert.deepEqual(session['floating-follow:2'], {
    enabled: true,
    expanded: true,
  });
  second.frame.messages.emit({
    type: 'floating:layout',
    expanded: true,
    height: 600,
  });
  await flush();
  second.frame.messages.emit({
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 80,
  });
  frame.messages.emit({ type: 'floating:layout', expanded: true, height: 600 });
  await flush();
  assert.deepEqual(session['floating-follow:2'], {
    enabled: true,
    expanded: false,
  });
  second.frame.messages.emit({ type: 'floating:close' });
  await flush();
  assert.deepEqual(session['floating-follow:2'], {
    enabled: false,
    expanded: false,
  });
  assert.deepEqual(
    frame.posted
      .filter((value) => (value as { type: string }).type === 'floating:resume')
      .at(-1),
    { type: 'floating:resume', expanded: false },
    'End also collapses earlier surfaces so returning to a tab cannot reveal an old expanded companion',
  );
  const before = permission.prepared.length;
  const thirdTab = {
    ...tab,
    id: 3,
    url: 'https://another.example.test/third',
    active: false,
  };
  const third = app.addPage(thirdTab);
  app.activateTab(thirdTab);
  await flush();
  assert.equal(permission.prepared.length, before);
  assert.ok(
    !third.frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:resume',
    ),
  );
  app.host.port.disconnect();
  second.host.port.disconnect();
  third.host.port.disconnect();
});

test('window follow survives worker reconstruction but never prepares a background window', async () => {
  const session: Record<string, unknown> = {
    'floating-follow:2': { enabled: true, expanded: true },
  };
  const permission = followAccess();
  const app = setup(
    'https://article.example.test/fresh-document',
    permission.access,
    session,
  );
  app.focus(false);
  app.register();
  const frame = app.frame();
  frame.messages.emit({
    type: 'floating:layout',
    expanded: false,
    launcher: true,
    height: 80,
    width: 80,
  });
  await flush();
  assert.equal(permission.prepared.length, 0);
  app.focus(true);
  await flush();
  assert.equal(permission.prepared.length, 1);
  assert.ok(
    frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:resume',
    ),
  );
  assert.deepEqual(session['floating-follow:2'], {
    enabled: true,
    expanded: true,
  });
  app.host.port.disconnect();
});

test('End during a pending window follow prevents late expansion or source observation', async () => {
  const session: Record<string, unknown> = {
    'floating-follow:2': { enabled: true, expanded: true },
  };
  const permission = followAccess();
  let release!: () => void;
  permission.wait(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const app = setup(
    'https://article.example.test/guide',
    permission.access,
    session,
  );
  app.register();
  const frame = app.frame();
  await flush();
  assert.equal(permission.prepared.length, 1);
  frame.messages.emit({ type: 'floating:close' });
  release();
  await flush();
  assert.ok(
    !frame.posted.some(
      (value) =>
        (value as { type: string; expanded?: boolean }).type ===
          'floating:resume' && (value as { expanded: boolean }).expanded,
    ),
  );
  assert.equal(app.sources.length, 0);
  assert.deepEqual(session['floating-follow:2'], {
    enabled: false,
    expanded: false,
  });
  app.host.port.disconnect();
});

function accessFixture() {
  const url = 'https://article.example.test/guide';
  let granted = false;
  let activations = 0;
  let preparations = 0;
  let waiting = Promise.resolve();
  const context = (): OrdersContext => ({
    supported: granted,
    tabId: tab.id!,
    windowId: tab.windowId,
    origin: new URL(url).origin,
    pathname: '/guide',
    reason: granted ? null : 'permission_required',
    sourceKind: 'structured_page',
    permission: granted ? 'granted' : 'required',
    capability: granted ? 'supported' : 'unchecked',
    ...(granted ? { documentId: sourceDocument } : {}),
  });
  return {
    url,
    get activations() {
      return activations;
    },
    get preparations() {
      return preparations;
    },
    wait(promise: Promise<void>) {
      waiting = promise;
    },
    access: {
      context: async () => context(),
      prepare: async (_tab: chrome.tabs.Tab, expectedDocumentId?: string) => {
        assert.equal(expectedDocumentId, sourceDocument);
        preparations++;
        await waiting;
        granted = true;
        return context();
      },
      activate: async () => {
        activations++;
        await waiting;
        granted = true;
        return context();
      },
    },
  };
}

test('only an explicit trusted frame check prepares existing access; duplicate checks share work and return correlated metadata', async () => {
  const permission = accessFixture();
  let release!: () => void;
  permission.wait(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  await flush();
  assert.equal(permission.preparations, 0);
  assert.equal(app.sources.length, 0);
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  app.host.messages.emit({ type: 'floating:check-page', id: first });
  frame.messages.emit({ type: 'floating:check-page', id: 'invalid' });
  frame.messages.emit({ type: 'floating:check-page', id: first, tabId: 999 });
  await flush();
  assert.equal(permission.preparations, 0);
  frame.messages.emit({ type: 'floating:check-page', id: first });
  frame.messages.emit({ type: 'floating:check-page', id: first });
  frame.messages.emit({ type: 'floating:check-page', id: second });
  await flush();
  assert.equal(permission.preparations, 1);
  release();
  await flush();
  const checked = frame.posted.filter(
    (value) => (value as { type: string }).type === 'floating:context-checked',
  ) as { id: string; context: OrdersContext }[];
  assert.deepEqual(
    checked.map((message) => message.id),
    [first, second],
  );
  assert.ok(
    checked.every((message) => message.context.permission === 'granted'),
  );
  assert.equal(app.sources.length, 1);
  assert.ok(
    app.sources[0]!.posted.every(
      (value) => (value as { type: string }).type === 'structured:probe',
    ),
  );
  frame.messages.emit({ type: 'floating:check-page', id: first });
  await flush();
  assert.equal(permission.preparations, 1);
  assert.ok(
    !app.host.posted.some(
      (value) =>
        (value as { type: string }).type === 'floating:context-checked',
    ),
  );
  app.host.port.disconnect();
});

test('close, reset, navigation or inactive tab during an explicit check prevents late response and source opening', async () => {
  for (const kind of ['close', 'reset', 'navigate', 'inactive'] as const) {
    const permission = accessFixture();
    let release!: () => void;
    permission.wait(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const app = setup(permission.url, permission.access);
    app.register();
    const frame = app.frame();
    frame.messages.emit({
      type: 'floating:check-page',
      id: crypto.randomUUID(),
    });
    await flush();
    assert.equal(permission.preparations, 1);
    if (kind === 'close') frame.messages.emit({ type: 'floating:close' });
    else if (kind === 'reset') frame.messages.emit({ type: 'floating:reset' });
    else if (kind === 'navigate')
      app.updated.emit(1, { url: 'https://article.example.test/new' });
    else app.setTab({ active: false });
    release();
    await flush();
    assert.equal(app.sources.length, 0);
    assert.ok(
      !frame.posted.some(
        (value) =>
          (value as { type: string }).type === 'floating:context-checked',
      ),
    );
    app.host.port.disconnect();
  }
});

test('a failed fresh check cannot report an earlier supported source as verified', async () => {
  const permission = accessFixture();
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  app.worker.activate({ ...tab, url: permission.url }, false);
  await flush();
  let fail!: () => void;
  permission.wait(
    new Promise<void>((_resolve, reject) => {
      fail = () => reject(new Error('Temporary source lookup failure'));
    }),
  );
  const id = crypto.randomUUID();
  frame.messages.emit({ type: 'floating:check-page', id });
  await flush();
  fail();
  await flush();
  const checked = frame.posted.find(
    (value) =>
      (value as { type: string; id?: string }).type ===
        'floating:context-checked' && (value as { id: string }).id === id,
  ) as { context: OrdersContext };
  assert.equal(checked.context.supported, false);
  assert.equal(checked.context.permission, 'required');
  assert.equal(checked.context.capability, 'unchecked');
  app.host.port.disconnect();
});

test('a failed structured check rechecks independent visual access without capturing or inventing a grant', async () => {
  for (const visualPermission of ['granted', 'required'] as const) {
    const permission = accessFixture();
    let accessChecks = 0;
    const app = setup(
      permission.url,
      permission.access,
      undefined,
      async () => {
        accessChecks++;
        return { eligible: true, permission: visualPermission };
      },
    );
    app.register();
    const frame = app.frame();
    app.worker.activate({ ...tab, url: permission.url }, false);
    await flush();
    let fail!: () => void;
    permission.wait(
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('Text probe unavailable'));
      }),
    );
    const before = accessChecks;
    const id = crypto.randomUUID();
    frame.messages.emit({ type: 'floating:check-page', id });
    await flush();
    fail();
    await flush();
    const checked = frame.posted.find(
      (value) =>
        (value as { type: string; id?: string }).type ===
          'floating:context-checked' && (value as { id: string }).id === id,
    ) as { context: OrdersContext };
    assert.ok(accessChecks > before, 'Visual access must be freshly checked');
    assert.equal(checked.context.supported, false);
    assert.equal(checked.context.permission, 'required');
    assert.equal(checked.context.capability, 'unchecked');
    assert.deepEqual(checked.context.visual, {
      eligible: true,
      permission: visualPermission,
    });
    assert.ok(
      app.sources
        .flatMap((source) => source.posted)
        .every(
          (value) => (value as { type: string }).type === 'structured:probe',
        ),
      'Recovery only inspects metadata; it does not capture or submit',
    );
    app.host.port.disconnect();
  }
});

test('floating standby cannot grant or capture an ordinary page; browser activation opens only a metadata probe', async () => {
  const permission = accessFixture();
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  frame.messages.emit({ type: 'floating:ready' });
  await flush();
  assert.equal(permission.activations, 0);
  assert.equal(app.sources.length, 0);
  frame.messages.emit({ type: 'structured:activate' });
  frame.messages.emit({
    type: 'structured:capture',
    id: crypto.randomUUID(),
    expected_origin: new URL(permission.url).origin,
    expected_pathname: '/guide',
    tab_id: 1,
    window_id: 2,
  });
  await flush();
  assert.equal(permission.activations, 0);
  assert.equal(app.sources.length, 0);
  assert.equal(
    app.worker.activate({ ...tab, url: permission.url }, false),
    true,
  );
  await flush();
  assert.equal(permission.activations, 1);
  assert.equal(app.sources.length, 1);
  assert.ok(
    app.sources[0]!.posted.every(
      (value) => (value as { type: string }).type === 'structured:probe',
    ),
  );
  assert.equal(
    frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:activate',
    ),
    true,
  );
  assert.ok(
    app.host.posted.every(
      (value) => !JSON.stringify(value).includes('context'),
    ),
  );
  app.host.port.disconnect();
});

test('structured relay rejects mismatched window/source and binds authorised requests to the top document', async () => {
  const permission = accessFixture();
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  app.worker.activate({ ...tab, url: permission.url }, false);
  await flush();
  const source = app.sources[0]!;
  const capture = {
    type: 'structured:capture',
    id: crypto.randomUUID(),
    expected_origin: new URL(permission.url).origin,
    expected_pathname: '/guide',
    tab_id: 1,
    window_id: 2,
  };
  frame.messages.emit({ ...capture, window_id: 99 });
  frame.messages.emit({ ...capture, expected_pathname: '/other' });
  await flush();
  assert.equal(source.posted.length, 1);
  frame.messages.emit(capture);
  await flush();
  assert.deepEqual(source.posted.at(-1), capture);
  assert.deepEqual(app.destinations[0], {
    id: 1,
    options: {
      name: 'structured-page',
      frameId: 0,
      documentId: sourceDocument,
    },
  });
  app.host.port.disconnect();
});

test('closing while browser permission activates discards the pending record shortcut', async () => {
  const permission = accessFixture();
  let release!: () => void;
  permission.wait(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  frame.messages.emit({ type: 'floating:ready' });
  app.worker.activate({ ...tab, url: permission.url }, true);
  await flush();
  frame.messages.emit({ type: 'floating:close' });
  release();
  await flush();
  assert.equal(
    frame.posted.some(
      (value) => (value as { type: string }).type === 'floating:activate',
    ),
    false,
  );
  assert.equal(app.sources.length, 0);
  app.host.port.disconnect();
});

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
  assert.equal(frame.posted.length, 2);
  assert.equal((frame.posted[0] as { type: string }).type, 'floating:bound');
  assert.deepEqual(frame.posted[1], {
    type: 'floating:speech-status',
    active: false,
    other: false,
  });
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
  assert.equal(frame.posted.length, 2);
  frame.messages.emit({ type: 'floating:ready' });
  const activation = frame.posted[2] as {
    type: string;
    id: string;
    record: boolean;
  };
  assert.equal(activation.type, 'floating:activate');
  assert.equal(activation.record, false);
  frame.messages.emit({ type: 'floating:ready' });
  assert.equal(frame.posted.length, 3);
  app.worker.activate(tab, true);
  assert.equal((frame.posted[3] as { record: boolean }).record, true);
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

test('visual observations ignore transient structured mutations but resource navigation still stops accepted speech', async () => {
  const permission = accessFixture();
  const app = setup(permission.url, permission.access);
  app.register();
  const frame = app.frame();
  await flush();
  app.worker.activate({ ...tab, url: permission.url }, false);
  await flush();
  assert.equal(app.sources.length, 1);
  frame.messages.emit({ type: 'floating:visual-mode', active: true });
  frame.messages.emit({ type: 'floating:speech-state', active: true });
  const start = frame.posted.length;
  app.sources[0]!.messages.emit({
    type: 'structured:changed',
    document_key: crypto.randomUUID(),
  });
  await flush();
  assert.equal(
    frame.posted
      .slice(start)
      .some(
        (value) => (value as { type: string }).type === 'structured:changed',
      ),
    false,
  );
  assert.equal(
    frame.posted
      .slice(start)
      .some(
        (value) => (value as { type: string }).type === 'floating:speech-stop',
      ),
    false,
  );
  app.updated.emit(tab.id!, { url: permission.url + '?resource=another' });
  assert.equal(
    frame.posted
      .slice(start)
      .some(
        (value) => (value as { type: string }).type === 'floating:speech-stop',
      ),
    true,
  );
  assert.equal(app.worker.trusted(frame.sender), false);
});

test('visual eligibility is independent from article support and later metadata cannot overwrite the source capability', async () => {
  const permission = accessFixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = setup(permission.url, permission.access, undefined, async () => {
    await wait;
    return { eligible: true, permission: 'granted' };
  });
  app.register();
  const frame = app.frame();
  await flush();
  app.worker.activate({ ...tab, url: permission.url }, false);
  await flush();
  release();
  await flush();
  const contexts = frame.posted.filter(
    (value) => (value as { type: string }).type === 'floating:context',
  ) as { context: OrdersContext }[];
  assert.ok(contexts.length);
  assert.equal(contexts.at(-1)!.context.documentId, sourceDocument);
  assert.deepEqual(contexts.at(-1)!.context.visual, {
    eligible: true,
    permission: 'granted',
  });
  assert.equal(
    app.sources
      .flatMap((source) => source.posted)
      .some((value) => (value as { type: string }).type.includes('capture')),
    false,
  );
});
