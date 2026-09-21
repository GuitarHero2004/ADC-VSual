import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  StructuredPageAccess,
  installStructuredContextMessages,
} from './structured-access.ts';

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
function setup() {
  const stored: Record<string, unknown> = {};
  const injected: unknown[] = [];
  const messages: Record<string, unknown>[] = [];
  const destinations: chrome.tabs.ConnectInfo[] = [];
  const permissionChecks: unknown[] = [];
  const runtimeMessages = new Events<
    [unknown, chrome.runtime.MessageSender, (value: unknown) => void]
  >();
  const state = {
    tab: {
      id: 4,
      windowId: 7,
      active: true,
      url: 'https://article.example.test/guide',
      title: 'A guide',
    } as chrome.tabs.Tab,
    documentId: crypto.randomUUID(),
    supported: true,
    injectDelay: Promise.resolve(),
    permissionDelay: Promise.resolve(),
    hostPermission: false,
  };
  const browser = {
    runtime: {
      id: 'a'.repeat(32),
      onMessage: runtimeMessages,
      getURL: (path: string) => `chrome-extension://${'a'.repeat(32)}/${path}`,
      sendMessage: async () => undefined,
    },
    storage: {
      session: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values);
        },
        remove: async (key: string) => {
          delete stored[key];
        },
      },
    },
    scripting: {
      executeScript: async (options: unknown) => {
        injected.push(options);
        await state.injectDelay;
        return [{ frameId: 0, documentId: state.documentId }];
      },
    },
    permissions: {
      contains: async (permission: unknown) => {
        permissionChecks.push(permission);
        await state.permissionDelay;
        return state.hostPermission;
      },
    },
    tabs: {
      get: async () => ({ ...state.tab }),
      onRemoved: new Events<[number]>(),
      onUpdated: new Events<[number, chrome.tabs.OnUpdatedInfo]>(),
      connect(_tabId: number, options: chrome.tabs.ConnectInfo) {
        destinations.push(options);
        const onMessage = new Events<[unknown]>();
        const onDisconnect = new Events<[]>();
        let closed = false;
        const port = {
          onMessage,
          onDisconnect,
          disconnect() {
            if (!closed) {
              closed = true;
              onDisconnect.emit();
            }
          },
          postMessage(message: Record<string, unknown>) {
            messages.push(message);
            queueMicrotask(() => {
              if (closed) return;
              if (options.documentId !== state.documentId) {
                port.disconnect();
                return;
              }
              onMessage.emit({
                type: 'structured:capability',
                id: message.id,
                supported: state.supported,
                document_key: state.documentId,
                reason: state.supported ? 'supported' : 'unsupported_structure',
              });
            });
          },
        };
        return port;
      },
    },
  } as unknown as typeof chrome;
  const access = new StructuredPageAccess(browser);
  return {
    access,
    browser,
    state,
    stored,
    injected,
    messages,
    destinations,
    runtimeMessages,
    permissionChecks,
  };
}

test('explicit prepare reuses an existing host permission without requesting access or capturing text', async () => {
  const app = setup();
  app.state.hostPermission = true;
  assert.equal(
    (await app.access.context(app.state.tab)).permission,
    'required',
  );
  assert.deepEqual(app.permissionChecks, []);
  assert.equal(app.injected.length, 0);
  const context = await app.access.prepare(app.state.tab, app.state.documentId);
  assert.equal(context.permission, 'granted');
  assert.equal(context.supported, true);
  assert.deepEqual(app.permissionChecks, [
    { origins: ['https://article.example.test/*'] },
  ]);
  assert.equal(app.injected.length, 1);
  assert.ok(
    app.messages.every((message) => message.type === 'structured:probe'),
  );
  await app.access.prepare(app.state.tab, app.state.documentId);
  assert.equal(app.permissionChecks.length, 1);
  assert.equal(app.injected.length, 1);
});

test('prepare without browser host permission stays recoverable and never injects', async () => {
  const app = setup();
  const context = await app.access.prepare(app.state.tab, app.state.documentId);
  assert.equal(context.permission, 'required');
  assert.equal(context.capability, 'unchecked');
  assert.equal(app.injected.length, 0);
  assert.equal(app.messages.length, 0);
  assert.deepEqual(app.stored, {});
});

test('only an explicit trusted side-panel prepare can reuse existing browser permission', async () => {
  const app = setup();
  app.state.hostPermission = true;
  installStructuredContextMessages(app.access, app.browser);
  const replies: unknown[] = [];
  const message = { type: 'structured:prepare', tabId: 4 };
  app.runtimeMessages.emit(
    message,
    { id: app.browser.runtime.id, tab: app.state.tab, url: app.state.tab.url! },
    (value) => replies.push(value),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 0);
  assert.equal(app.permissionChecks.length, 0);
  assert.equal(app.injected.length, 0);
  app.runtimeMessages.emit(
    message,
    {
      id: app.browser.runtime.id,
      url: app.browser.runtime.getURL('index.html'),
    },
    (value) => replies.push(value),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 1);
  assert.equal(app.injected.length, 1);
  assert.ok(app.messages.every((item) => item.type === 'structured:probe'));
});

test('navigation or tab deactivation during permission lookup cannot grant access', async () => {
  for (const kind of ['navigation', 'inactive', 'generation'] as const) {
    const app = setup();
    app.state.hostPermission = true;
    let release!: () => void;
    app.state.permissionDelay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preparing = app.access.prepare(
      { ...app.state.tab },
      app.state.documentId,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (kind === 'navigation')
      app.state.tab.url = 'https://article.example.test/other';
    else if (kind === 'inactive') app.state.tab.active = false;
    else await app.access.invalidate(app.state.tab.id!);
    release();
    assert.equal((await preparing).permission, 'required');
    assert.equal(app.injected.length, 0);
    assert.deepEqual(app.stored, {});
  }
});

test('a replaced same-URL document is rejected before prepare stores its grant', async () => {
  const app = setup();
  app.state.hostPermission = true;
  const originalDocument = app.state.documentId;
  let release!: () => void;
  app.state.injectDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  const preparing = app.access.prepare(app.state.tab, originalDocument);
  await new Promise<void>((resolve) => setImmediate(resolve));
  app.state.documentId = crypto.randomUUID();
  release();
  assert.equal((await preparing).permission, 'required');
  assert.deepEqual(app.stored, {});
  assert.equal(app.messages.length, 0);
});

test('standby context is permission-required and performs no injection or source read', async () => {
  const app = setup();
  const context = await app.access.context(app.state.tab);
  assert.equal(context.permission, 'required');
  assert.equal(context.capability, 'unchecked');
  assert.equal(context.supported, false);
  assert.equal(app.injected.length, 0);
  assert.equal(app.messages.length, 0);
});

test('explicit activation injects only top-level structured script and stores document-bound permission across worker restart', async () => {
  const app = setup();
  const [one, two] = await Promise.all([
    app.access.activate(app.state.tab),
    app.access.activate(app.state.tab),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.supported, true);
  assert.equal(one.permission, 'granted');
  assert.equal(app.injected.length, 1);
  assert.deepEqual(app.injected[0], {
    target: { tabId: 4, frameIds: [0] },
    files: ['structured-content.js'],
  });
  assert.ok(
    app.messages.every((message) => message.type === 'structured:probe'),
  );
  assert.ok(
    app.destinations.every(
      (destination) =>
        destination.frameId === 0 &&
        destination.documentId === app.state.documentId,
    ),
  );
  const restarted = new StructuredPageAccess(app.browser);
  assert.equal((await restarted.context(app.state.tab)).supported, true);
  await restarted.activate(app.state.tab);
  assert.equal(app.injected.length, 1);
});

test('browser permission remains separate from structural support', async () => {
  const app = setup();
  app.state.supported = false;
  const context = await app.access.activate(app.state.tab);
  assert.equal(context.permission, 'granted');
  assert.equal(context.capability, 'unsupported');
  assert.equal(context.reason, 'unsupported');
  assert.equal(context.supported, false);
  assert.equal(
    app.messages.some((message) => message.type === 'structured:capture'),
    false,
  );
});

test('new URL, replaced document or different window cannot reuse an earlier grant', async () => {
  const app = setup();
  await app.access.activate(app.state.tab);
  const original = { ...app.state.tab };
  assert.equal(
    (
      await app.access.context({
        ...original,
        url: `${original.url}?resource=2`,
      })
    ).permission,
    'required',
  );
  assert.equal(
    (await app.access.context({ ...original, windowId: 8 })).permission,
    'required',
  );
  app.state.documentId = crypto.randomUUID();
  assert.equal((await app.access.context(original)).permission, 'required');
  assert.equal(app.injected.length, 1);
});

test('navigation during an activation cannot store late permission', async () => {
  const app = setup();
  let release!: () => void;
  app.state.injectDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  const activation = app.access.activate(app.state.tab);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await app.access.invalidate(app.state.tab.id!);
  release();
  assert.equal((await activation).permission, 'required');
  assert.deepEqual(app.stored, {});
});

test('only trusted side-panel context can query grants; page and arbitrary frames cannot grant or query', async () => {
  const app = setup();
  installStructuredContextMessages(app.access, app.browser);
  const replies: unknown[] = [];
  const message = { type: 'structured:context', tabId: 4 };
  for (const sender of [
    { id: app.browser.runtime.id, tab: app.state.tab, url: app.state.tab.url! },
    {
      id: app.browser.runtime.id,
      url: app.browser.runtime.getURL('floating.html'),
    },
    { id: 'b'.repeat(32), url: app.browser.runtime.getURL('index.html') },
  ])
    app.runtimeMessages.emit(message, sender, (value) => replies.push(value));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 0);
  app.runtimeMessages.emit(
    message,
    {
      id: app.browser.runtime.id,
      url: app.browser.runtime.getURL('index.html'),
    },
    (value) => replies.push(value),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 1);
  assert.equal(app.injected.length, 0);
});
