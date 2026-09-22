import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VisualPageClient } from './visual-client.ts';
import { parseVisualMessage, parseVisualReply } from './visual-protocol.ts';
const source = {
  tabId: 1,
  windowId: 2,
  origin: 'https://calendar.example.test',
  pathname: '/calendar',
  resourceKey: 'a'.repeat(64),
};
function setup() {
  const received = new Set<(value: unknown) => void>(),
    disconnected = new Set<() => void>();
  const posted: Record<string, unknown>[] = [];
  let connections = 0,
    cancellations = 0;
  const port = {
    postMessage: (message: Record<string, unknown>) => posted.push(message),
    onMessage: {
      addListener: (listener: (value: unknown) => void) =>
        received.add(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnected.add(listener),
    },
    disconnect: () => {
      for (const listener of disconnected) listener();
    },
  } as unknown as chrome.runtime.Port;
  const client = new VisualPageClient(
    {
      runtime: {
        connect: () => {
          connections++;
          return port;
        },
      } as unknown as typeof chrome.runtime,
    },
    () => {
      cancellations++;
    },
  );
  return {
    client,
    posted,
    port,
    get connections() {
      return connections;
    },
    get cancellations() {
      return cancellations;
    },
    receive: (value: unknown) => {
      for (const listener of received) listener(value);
    },
  };
}
test('visual transport stays idle until use; cancellation rejects once and ignores late responses', async () => {
  const app = setup();
  assert.equal(app.connections, 0);
  const abort = new AbortController();
  const result = app.client.capture(source, 'current_view', abort.signal);
  const id = app.posted.at(-1)!.id;
  const rejected = assert.rejects(result, { name: 'AbortError' });
  abort.abort();
  await rejected;
  app.receive({ type: 'visual:error', id, code: 'TIMEOUT' });
  assert.equal(app.connections, 1);
  assert.equal(
    app.posted.filter((message) => message.type === 'visual:cancel').length,
    1,
  );
  app.client.dispose();
});
test('cancel-only shortcut notice clears pending capture without creating another request', async () => {
  const app = setup();
  const result = app.client.capture(
    source,
    'current_view',
    new AbortController().signal,
  );
  const rejected = assert.rejects(result, /CANCELLED/);
  app.receive({ type: 'visual:cancelled' });
  await rejected;
  assert.equal(app.cancellations, 1);
  assert.equal(
    app.posted.filter((message) => message.type === 'visual:capture').length,
    1,
  );
  app.client.dispose();
});
test('logout reset and worker disconnect reject pending visual work; a late error cannot restore it', async () => {
  for (const kind of ['reset', 'disconnect']) {
    const app = setup();
    const result = app.client.capture(
      source,
      'current_view',
      new AbortController().signal,
    );
    const rejected = assert.rejects(result, /CANCELLED/);
    if (kind === 'reset') app.client.reset();
    else app.port.disconnect();
    await rejected;
    app.receive({
      type: 'visual:error',
      id: app.posted[0]!.id,
      code: 'TIMEOUT',
    });
    app.client.dispose();
  }
});

test('unexpected worker loss invalidates the owning journey even without a pending visual RPC', () => {
  const app = setup();
  app.client.setTaskState(source, { capturing: false, recovering: false });
  assert.equal(app.connections, 1);
  assert.equal(app.cancellations, 0);
  app.port.disconnect();
  assert.equal(app.cancellations, 1);
  app.port.disconnect();
  assert.equal(app.cancellations, 1, 'A disconnected port cannot cancel twice');
  app.client.dispose();
  assert.equal(app.cancellations, 1);

  const intentional = setup();
  intentional.client.setTaskState(source, {
    capturing: false,
    recovering: false,
  });
  intentional.client.dispose();
  assert.equal(
    intentional.cancellations,
    0,
    'Owner disposal must not recursively cancel itself',
  );
});
test('visual message validation rejects unknown recipients, unsupported scopes and payload extensions', () => {
  const id = crypto.randomUUID();
  assert.ok(
    parseVisualMessage({
      type: 'visual:capture',
      id,
      source,
      scope: 'current_view',
    }),
  );
  for (const change of [
    { scope: 'whole_google_drive' },
    { source: { ...source, origin: 'chrome://settings' } },
    { source: { ...source, windowId: -1 } },
    { apiKey: 'not-accepted' },
  ])
    assert.equal(
      parseVisualMessage({
        type: 'visual:capture',
        id,
        source,
        scope: 'current_view',
        ...change,
      }),
      null,
    );
  assert.equal(
    parseVisualReply({
      type: 'visual:error',
      id,
      code: 'RAW_PROVIDER_PAYLOAD',
    }),
    null,
  );
  assert.equal(
    parseVisualReply({ type: 'visual:cancelled', token: 'not-accepted' }),
    null,
  );
});
