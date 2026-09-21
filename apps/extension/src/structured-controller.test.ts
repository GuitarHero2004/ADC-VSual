import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fingerprintStructuredSnapshot,
  type StructuredSnapshot,
  type StructuredResponse,
} from '@adc/contracts';
import {
  GroundedController,
  type CompanionRequest,
  type CompanionResponse,
  type GroundedTransport,
} from './grounded-controller.ts';
import type { OrdersContext } from './page-context.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  let snapshot: StructuredSnapshot = {
    source_kind: 'structured_page',
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    captured_at: new Date().toISOString(),
    origin: 'https://article.example.test',
    pathname: '/guide',
    title: 'Accessible meetings',
    tab_id: 10,
    window_id: 20,
    sections: [
      { id: 's1', heading: 'Preparation' },
      { id: 's2', heading: 'During the meeting' },
    ],
    blocks: [
      {
        id: 'b1',
        section_id: 's1',
        kind: 'paragraph',
        text: 'Share the agenda before the meeting.',
      },
      {
        id: 'b2',
        section_id: 's2',
        kind: 'list_item',
        text: 'Name the speaker before speaking.',
      },
    ],
    coverage: {
      partial: false,
      limitations: [],
      included_sections: ['s1', 's2'],
    },
    fingerprint: '0'.repeat(64),
  };
  snapshot.fingerprint = await fingerprintStructuredSnapshot(snapshot);
  let context: OrdersContext = {
    supported: true,
    sourceKind: 'structured_page',
    permission: 'granted',
    capability: 'supported',
    origin: snapshot.origin,
    pathname: snapshot.pathname,
    tabId: 10,
    windowId: 20,
    reason: null,
  };
  const events = new Set<() => void>();
  const calls = { capture: 0, model: 0, stop: 0, verify: 0, prepare: 0 };
  const response = (input: CompanionRequest): StructuredResponse => ({
    source_kind: 'structured_page',
    request_id: input.request_id,
    snapshot_id: input.snapshot.snapshot_id,
    fingerprint: input.snapshot.fingerprint,
    status: 'answer',
    answer_language: 'en',
    text: 'Share the agenda before the meeting.',
    evidence_ids: ['b1'],
    included_section_ids: ['s1'],
    partial: true,
  });
  const hooks: { transport: GroundedTransport; verify(): Promise<boolean> } = {
    transport: async (input) => response(input),
    verify: async () => true,
  };
  const controller = new GroundedController(
    {
      getContext: async () => context,
      prepareContext: async () => {
        calls.prepare++;
        return context;
      },
      capture: async () => {
        calls.capture++;
        return { ...snapshot, snapshot_id: crypto.randomUUID() };
      },
      verify: async () => {
        calls.verify++;
        return hooks.verify();
      },
      subscribe: (listener) => {
        const invoke = () => listener('page');
        events.add(invoke);
        return () => {
          events.delete(invoke);
        };
      },
      returnToPage: async () => ({ restored: true }),
      reset() {},
      dispose() {},
    },
    (input, signal) => {
      calls.model++;
      return hooks.transport(input, signal);
    },
    () => {
      calls.stop++;
    },
  );
  controller.setQuestion('What should I share before the meeting?');
  await controller.refreshContext();
  return {
    controller,
    calls,
    hooks,
    response,
    context: (next: Partial<OrdersContext>) => {
      context = { ...context, ...next };
    },
    invalidate: () => events.forEach((event) => event()),
    changeSource: async () => {
      snapshot = { ...snapshot, title: 'Changed guide' };
      snapshot.fingerprint = await fingerprintStructuredSnapshot(snapshot);
    },
  };
}

test('only explicit page checks prepare access; the first deliberate Ask authorizes capture', async () => {
  const { controller, calls } = await setup();
  assert.equal(calls.prepare, 0);
  await controller.refreshContext(true);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.capture, 0);
  await controller.ask();
  assert.equal(
    calls.capture,
    1,
    'Ask captures without a separate Inspect action',
  );
  assert.equal(calls.model, 1);
  assert.equal(controller.getSnapshot().phase, 'ready');
  controller.dispose();
});

test('article mounting and browser permission restoration do not submit a preserved draft', async () => {
  const { controller, calls, context } = await setup();
  context({
    supported: false,
    permission: 'required',
    capability: 'unchecked',
    reason: 'permission_required',
  });
  await controller.refreshContext();
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'PAGE_PERMISSION_REQUIRED');
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  context({
    supported: true,
    permission: 'granted',
    capability: 'supported',
    reason: null,
  });
  await controller.refreshContext();
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.match(controller.getSnapshot().question, /meeting/);
  await controller.ask();
  assert.equal(calls.model, 1);
  controller.dispose();
});

test('article source inspection and explicit section selection reuse the same task lifecycle', async () => {
  const { controller, calls, hooks, response } = await setup();
  await controller.inspect();
  assert.equal(calls.model, 0);
  controller.setSection('s1');
  hooks.transport = async (input) => {
    assert.ok('section_id' in input);
    assert.equal(input.section_id, 's1');
    return response(input);
  };
  await controller.ask();
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.ok(controller.claimAutomaticSpeech());
  assert.equal(controller.claimAutomaticSpeech(), null);
  await controller.refreshContext();
  assert.equal(controller.claimAutomaticSpeech(), null);
  controller.dispose();
});

test('changed selected section is rejected before the model is called', async () => {
  const { controller, changeSource, calls } = await setup();
  await controller.inspect();
  controller.setSection('s1');
  await changeSource();
  await controller.ask();
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(calls.model, 0);
  assert.equal(controller.getSnapshot().sectionId, null);
  await controller.inspect();
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(controller.getSnapshot().stale, false);
  controller.dispose();
});

test('a changed source kind cannot redirect an existing question during capture lookup', async () => {
  const { controller, context, calls } = await setup();
  context({ sourceKind: 'orders', pathname: '/orders' });
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'STALE_CONTEXT');
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.match(controller.getSnapshot().question, /meeting/);
  controller.dispose();
});

test('article duplicate submission, cancellation, navigation and logout never accept late answers', async () => {
  for (const cancel of ['cancel', 'source', 'logout'] as const) {
    const { controller, hooks, calls, invalidate, response } = await setup();
    const pending = deferred<CompanionResponse>();
    let submitted!: CompanionRequest;
    hooks.transport = (input) => {
      submitted = input;
      return pending.promise;
    };
    const task = controller.ask();
    await flush();
    await controller.ask();
    assert.equal(calls.model, 1);
    if (cancel === 'cancel') controller.cancel();
    else if (cancel === 'source') invalidate();
    else controller.dispose();
    pending.resolve(response(submitted));
    await task;
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(controller.claimAutomaticSpeech(), null);
    assert.ok(calls.stop > 0);
    controller.dispose();
  }
});

test('missing or foreign article references fail before text or automatic speech is accepted', async () => {
  for (const ids of [[], ['b399'], ['b2']]) {
    const { controller, hooks, response } = await setup();
    hooks.transport = async (input) => ({
      ...response(input),
      evidence_ids: ids,
    });
    await controller.ask();
    assert.equal(controller.getSnapshot().phase, 'error');
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(controller.claimAutomaticSpeech(), null);
    controller.dispose();
  }
});

test('application/provider limits preserve the article question and permit a deliberate retry', async () => {
  for (const code of [
    'PROVIDER_RATE_LIMITED',
    'QUOTA_EXHAUSTED',
    'INPUT_TOO_LARGE',
    'TIMEOUT',
  ]) {
    const { controller, hooks, response } = await setup();
    hooks.transport = async () => {
      throw Object.assign(new Error('Safe failure'), { code });
    };
    await controller.ask();
    assert.equal(controller.getSnapshot().error, code);
    assert.match(controller.getSnapshot().question, /meeting/);
    hooks.transport = async (input) => response(input);
    await controller.ask();
    assert.equal(controller.getSnapshot().phase, 'ready');
    controller.dispose();
  }
});

test('overall article deadline invalidates a provider that ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, hooks, response } = await setup();
  const pending = deferred<CompanionResponse>();
  let submitted!: CompanionRequest;
  hooks.transport = (input) => {
    submitted = input;
    return pending.promise;
  };
  const task = controller.ask();
  await flush();
  t.mock.timers.tick(45_000);
  assert.equal(controller.getSnapshot().error, 'TIMEOUT');
  pending.resolve(response(submitted));
  await task;
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.claimAutomaticSpeech(), null);
  controller.dispose();
});
