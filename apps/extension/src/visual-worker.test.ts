import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { installVisualWorker } from './visual-worker.ts';
import type { VisualSnapshot } from '@adc/contracts';
import {
  visualResourceKey,
  type VisualCaptureResult,
} from './visual-protocol.ts';
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
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  // Resource hashing uses async WebCrypto. A fixed count of event-loop turns
  // can expire before its worker runs when the full suite executes in parallel.
  const deadline = performance.now() + 5000;
  while (!predicate() && performance.now() < deadline) await delay(5);
  assert.ok(predicate(), 'Expected worker stage to complete');
  await tick();
}
const extensionId = 'a'.repeat(32),
  origin = 'https://calendar.example.test';
const source = {
  tabId: 7,
  windowId: 3,
  origin,
  pathname: '/calendar',
  resourceKey: await visualResourceKey(origin + '/calendar'),
  documentId: crypto.randomUUID(),
};
function result(): VisualCaptureResult {
  const time = new Date().toISOString();
  return {
    snapshot: {
      source_kind: 'visual_page',
      snapshot_id: crypto.randomUUID(),
      captured_at: time,
      capture_started_at: time,
      fingerprint: 'a'.repeat(64),
      origin,
      pathname: '/calendar',
      title: 'Calendar',
      document_key: crypto.randomUUID(),
      resource_key: source.resourceKey,
      window_id: 3,
      tab_id: 7,
      scope: 'current_view',
      images: [
        {
          id: 'image-1',
          sha256: 'c'.repeat(64),
          captured_at: time,
          width: 800,
          height: 600,
          viewport_width: 800,
          viewport_height: 600,
          scroll_x: 0,
          scroll_y: 0,
          scale_x: 1,
          scale_y: 1,
          redactions: [],
        },
      ],
      coverage: {
        scroll_width: 800,
        scroll_height: 600,
        geometric_complete: false,
        limitations: ['current_view_only'],
      },
    },
    images: [{ id: 'image-1', mime_type: 'image/png', base64: 'YWJj' }],
  };
}
function setup() {
  const connected = new Events<[chrome.runtime.Port]>(),
    messages = new Events<
      [unknown, chrome.runtime.MessageSender, (value: unknown) => void]
    >(),
    updated = new Events<[number, chrome.tabs.OnUpdatedInfo]>(),
    removed = new Events<[number]>();
  const stored: Record<string, unknown> = {};
  let permitted = true;
  let captures = 0,
    verifies = 0;
  const tab = {
    id: 7,
    windowId: 3,
    active: true,
    url: origin + '/calendar',
  } as chrome.tabs.Tab;
  let finish: (value: VisualCaptureResult) => void = () => {};
  let pending = false;
  let lastSignal: AbortSignal | undefined;
  const browser = {
    runtime: {
      id: extensionId,
      getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      onConnect: connected,
      onMessage: messages,
    },
    tabs: { get: async () => tab, onUpdated: updated, onRemoved: removed },
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
  } as unknown as typeof chrome;
  const engine = {
    capture: async (_binding: unknown, signal: AbortSignal) => {
      captures++;
      lastSignal = signal;
      if (pending)
        return new Promise<VisualCaptureResult>((resolve) => {
          finish = resolve;
        });
      return result();
    },
    verify: async () => {
      verifies++;
      return true;
    },
  };
  const trusted = (sender: chrome.runtime.MessageSender) =>
    permitted &&
    sender.id === extensionId &&
    sender.url === `chrome-extension://${extensionId}/floating.html#trusted` &&
    sender.frameId === 2 &&
    sender.documentId === 'frame-doc';
  const worker = installVisualWorker(browser, trusted, engine);
  function port(
    sender: chrome.runtime.MessageSender = {
      id: extensionId,
      tab,
      frameId: 2,
      documentId: 'frame-doc',
      url: `chrome-extension://${extensionId}/floating.html#trusted`,
    },
  ) {
    const input = new Events<[unknown]>(),
      disconnect = new Events<[]>(),
      posted: unknown[] = [];
    let closed = false;
    const value = {
      name: 'visual-page',
      sender,
      onMessage: input,
      onDisconnect: disconnect,
      postMessage: (message: unknown) => posted.push(message),
      disconnect: () => {
        if (closed) return;
        closed = true;
        disconnect.emit();
      },
    } as unknown as chrome.runtime.Port;
    connected.emit(value);
    return {
      input,
      posted,
      value,
      get closed() {
        return closed;
      },
    };
  }
  return {
    worker,
    port,
    tab,
    updated,
    removed,
    stored,
    get captures() {
      return captures;
    },
    get verifies() {
      return verifies;
    },
    get lastSignal() {
      return lastSignal;
    },
    defer: () => {
      pending = true;
    },
    resolve: () => finish(result()),
    revoke: () => {
      permitted = false;
    },
  };
}
const capture = (scope = 'current_view') => ({
  type: 'visual:capture',
  id: crypto.randomUUID(),
  source,
  scope,
});
test('standby and eligibility checks never capture; only browser activation records screenshot access', async () => {
  const app = setup();
  const port = app.port();
  assert.equal((await app.worker.context(app.tab)).permission, 'required');
  assert.equal(app.captures, 0);
  port.input.emit(capture());
  await until(() =>
    JSON.stringify(port.posted).includes('PERMISSION_REQUIRED'),
  );
  assert.equal(app.captures, 0);
  assert.match(JSON.stringify(port.posted), /PERMISSION_REQUIRED/);
  app.worker.activate(app.tab);
  assert.equal((await app.worker.context(app.tab)).permission, 'granted');
  assert.equal(app.captures, 0);
  port.input.emit(capture());
  await until(
    () =>
      app.captures === 1 &&
      JSON.stringify(port.posted).includes('visual:result'),
  );
  assert.equal(app.captures, 1);
  assert.match(JSON.stringify(port.posted), /visual:result/);
});
test('untrusted pages, mismatched recipients, malformed scope and extra payload fields never capture', async () => {
  const app = setup();
  app.worker.activate(app.tab);
  assert.equal(
    app.port({ id: extensionId, tab: app.tab, frameId: 0, url: app.tab.url! })
      .closed,
    true,
  );
  const port = app.port();
  port.input.emit({ ...capture(), token: 'must-not-be-accepted' });
  port.input.emit(capture('all_files'));
  port.input.emit({ ...capture(), source: { ...source, tabId: 8 } });
  await tick();
  assert.equal(app.captures, 0);
  assert.match(JSON.stringify(port.posted), /STALE_CONTEXT/);
});
test('capture shortcut cancels once without recording; recovery shortcut only opens the companion', async () => {
  const app = setup();
  app.worker.activate(app.tab);
  const port = app.port();
  app.defer();
  port.input.emit(capture());
  await until(() => app.captures === 1);
  assert.equal(app.worker.interceptActivation(app.tab), 'cancelled');
  assert.equal(app.lastSignal?.aborted, true);
  assert.equal(app.worker.interceptActivation(app.tab), null);
  app.resolve();
  await tick();
  assert.equal(
    port.posted.some(
      (value) => (value as { type: string }).type === 'visual:result',
    ),
    false,
  );
  port.input.emit({
    type: 'visual:state',
    source,
    capturing: false,
    recovering: true,
  });
  assert.equal(app.worker.interceptActivation(app.tab), 'recovering');
  assert.equal(app.captures, 1);
});
test('reset, disconnect and source query navigation discard late images and snapshot verification ownership', async () => {
  for (const mode of ['reset', 'disconnect', 'navigation']) {
    const app = setup();
    app.worker.activate(app.tab);
    const port = app.port();
    app.defer();
    port.input.emit(capture());
    await until(() => app.captures === 1);
    if (mode === 'reset') port.input.emit({ type: 'visual:reset' });
    else if (mode === 'disconnect') port.value.disconnect();
    else app.updated.emit(7, { url: origin + '/calendar?week=next' });
    assert.equal(app.lastSignal?.aborted, true);
    app.resolve();
    await tick();
    assert.equal(
      port.posted.some(
        (value) => (value as { type: string }).type === 'visual:result',
      ),
      false,
    );
  }
});
test('one active capture per trusted client; revoked binding cannot receive late pixels', async () => {
  const app = setup();
  app.worker.activate(app.tab);
  const port = app.port();
  app.defer();
  port.input.emit(capture());
  await until(() => app.captures === 1);
  port.input.emit(capture());
  await tick();
  assert.equal(app.captures, 1);
  assert.match(JSON.stringify(port.posted), /VISUAL_BUSY/);
  app.revoke();
  app.resolve();
  await tick();
  assert.equal(
    port.posted.some(
      (value) => (value as { type: string }).type === 'visual:result',
    ),
    false,
  );
});
test('sidebar uses the same service but capture requires an active intended HTTP source', async () => {
  const app = setup();
  app.worker.activate(app.tab);
  const port = app.port({
    id: extensionId,
    url: `chrome-extension://${extensionId}/index.html`,
  });
  port.input.emit(capture());
  await until(() => JSON.stringify(port.posted).includes('visual:result'));
  assert.equal(app.captures, 1);
  app.tab.active = false;
  port.input.emit(capture());
  await tick();
  assert.equal(app.captures, 1);
  assert.match(JSON.stringify(port.posted), /STALE_CONTEXT/);
});
test('verification cannot reuse a snapshot captured by a different client or after logout reset', async () => {
  const app = setup();
  app.worker.activate(app.tab);
  const first = app.port(),
    second = app.port();
  first.input.emit(capture());
  await until(() => JSON.stringify(first.posted).includes('visual:result'));
  const completed = first.posted.find(
    (value) => (value as { type: string }).type === 'visual:result',
  ) as { snapshot: VisualSnapshot };
  second.input.emit({
    type: 'visual:verify',
    id: crypto.randomUUID(),
    snapshot: completed.snapshot,
  });
  await tick();
  assert.equal(app.verifies, 0);
  assert.match(JSON.stringify(second.posted), /"current":false/);
  first.input.emit({ type: 'visual:reset' });
  first.input.emit({
    type: 'visual:verify',
    id: crypto.randomUUID(),
    snapshot: completed.snapshot,
  });
  await tick();
  assert.equal(app.verifies, 0);
});

test('same-path query or fragment changes reject a stale source key even before a browser update event', async () => {
  for (const suffix of ['?week=next', '#selected-document']) {
    const app = setup();
    app.worker.activate(app.tab);
    const previous = await app.worker.context(app.tab);
    assert.equal(previous.resourceKey, source.resourceKey);
    app.tab.url = origin + '/calendar' + suffix;
    app.worker.activate(app.tab);
    const current = await app.worker.context(app.tab);
    assert.notEqual(current.resourceKey, previous.resourceKey);
    assert.ok(!JSON.stringify(current).includes(suffix));
    const port = app.port();
    port.input.emit(capture());
    await until(() => port.posted.length > 0);
    assert.equal(app.captures, 0);
    assert.match(JSON.stringify(port.posted), /STALE_CONTEXT/);
  }
});
