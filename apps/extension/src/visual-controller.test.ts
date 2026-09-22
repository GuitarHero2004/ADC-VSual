import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  fingerprintVisualSnapshot,
  type VisualRequest,
  type VisualResponse,
  type VisualScope,
  type VisualSnapshot,
} from '@adc/contracts';
import {
  GroundedController,
  type CompanionRequest,
  type CompanionResponse,
  type GroundedTransport,
} from './grounded-controller.ts';
import type { OrdersContext, OrdersInvalidation } from './page-context.ts';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  // Snapshot fingerprints use asynchronous WebCrypto. Event-loop turns can run
  // out before its worker gets time in the parallel suite; await the condition.
  const deadline = performance.now() + 5_000;
  while (!predicate() && performance.now() < deadline) await delay(5);
  assert.ok(predicate(), 'Expected mocked task stage to be reached');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Capture = { snapshot: VisualSnapshot; images: VisualRequest['images'] };
async function setup(options: { continueAnswerAcrossTabs?: boolean } = {}) {
  const now = new Date().toISOString();
  const metadata: VisualSnapshot = {
    source_kind: 'visual_page',
    snapshot_id: crypto.randomUUID(),
    captured_at: now,
    capture_started_at: now,
    fingerprint: '0'.repeat(64),
    origin: 'https://visual.example.test',
    pathname: '/calendar',
    title: 'Synthetic calendar',
    document_key: crypto.randomUUID(),
    resource_key: 'a'.repeat(64),
    window_id: 20,
    tab_id: 10,
    scope: 'current_view',
    images: [
      {
        id: 'image-1',
        sha256: 'b'.repeat(64),
        captured_at: now,
        width: 100,
        height: 100,
        viewport_width: 100,
        viewport_height: 100,
        scroll_x: 0,
        scroll_y: 0,
        scale_x: 1,
        scale_y: 1,
        redactions: [],
      },
    ],
    coverage: {
      scroll_width: 100,
      scroll_height: 1000,
      geometric_complete: false,
      limitations: ['current_view_only', 'document_not_retrieved'],
    },
  };
  metadata.fingerprint = await fingerprintVisualSnapshot(metadata);
  let context: OrdersContext = {
    supported: false,
    sourceKind: 'structured_page',
    permission: 'granted',
    capability: 'unsupported',
    origin: metadata.origin,
    pathname: metadata.pathname,
    tabId: 10,
    windowId: 20,
    reason: 'unsupported',
    visual: { eligible: true, permission: 'granted' },
    resourceKey: metadata.resource_key,
  };
  const calls = {
    capture: 0,
    model: 0,
    textCapture: 0,
    verify: 0,
    stop: 0,
    preserveSpeech: 0,
    prepare: 0,
  };
  const scopes: VisualScope[] = [];
  const taskStates: { capturing: boolean; recovering: boolean }[] = [];
  const signals: AbortSignal[] = [];
  const events = new Set<(reason: OrdersInvalidation) => void>();
  const makeCapture = async (scope: VisualScope): Promise<Capture> => {
    const snapshot = structuredClone(metadata);
    snapshot.snapshot_id = crypto.randomUUID();
    snapshot.scope = scope;
    snapshot.coverage.limitations =
      scope === 'current_view'
        ? ['current_view_only', 'document_not_retrieved']
        : scope === 'first_portion'
          ? ['first_portion_only', 'document_not_retrieved']
          : ['geometry_only', 'document_not_retrieved'];
    snapshot.fingerprint = await fingerprintVisualSnapshot(snapshot);
    // Transport is mocked: payload validity/decoding is exercised by backend tests.
    return {
      snapshot,
      images: [
        {
          id: 'image-1',
          mime_type: 'image/png',
          base64: btoa('synthetic raster fixture'),
        },
      ],
    };
  };
  const response = (input: CompanionRequest): VisualResponse => {
    assert.ok(
      'source_kind' in input.snapshot &&
        input.snapshot.source_kind === 'visual_page',
    );
    return {
      source_kind: 'visual_page',
      request_id: input.request_id,
      snapshot_id: input.snapshot.snapshot_id,
      fingerprint: input.snapshot.fingerprint,
      status: 'answer',
      answer_language: 'en',
      text: 'The captured calendar shows a meeting.',
      evidence: [
        {
          image_id: 'image-1',
          region: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
          description: 'A meeting label in the captured calendar.',
        },
      ],
      scope: input.snapshot.scope,
      coverage: input.snapshot.coverage,
    };
  };
  const hooks: {
    context(): Promise<OrdersContext>;
    capture(scope: VisualScope, signal: AbortSignal): Promise<Capture>;
    verify(snapshot: VisualSnapshot, signal: AbortSignal): Promise<boolean>;
    transport: GroundedTransport;
  } = {
    context: async () => context,
    capture: async (scope) => makeCapture(scope),
    verify: async () => true,
    transport: async (input) => response(input),
  };
  const controller = new GroundedController(
    {
      getContext: () => hooks.context(),
      prepareContext: async () => {
        calls.prepare++;
        return hooks.context();
      },
      capture: async () => {
        calls.textCapture++;
        throw new Error('Visual question must not use text capture');
      },
      verify: async () => {
        throw new Error('Visual question must not use text verification');
      },
      captureVisual: (scope, signal, origin, tabId) => {
        assert.equal(origin, context.origin);
        assert.equal(tabId, context.tabId);
        calls.capture++;
        scopes.push(scope);
        signals.push(signal);
        return hooks.capture(scope, signal);
      },
      verifyVisual: (snapshot, signal) => {
        calls.verify++;
        return hooks.verify(snapshot, signal);
      },
      setTaskState: (state) => {
        taskStates.push(state);
      },
      subscribe: (listener) => {
        events.add(listener);
        return () => {
          events.delete(listener);
        };
      },
      returnToPage: async () => ({ restored: true }),
      reset() {},
      dispose() {
        events.clear();
      },
    },
    (input, signal) => {
      calls.model++;
      return hooks.transport(input, signal);
    },
    (preserve) => {
      if (preserve) calls.preserveSpeech++;
      else calls.stop++;
    },
    options,
  );
  controller.setQuestion('What is on this calendar?');
  await controller.refreshContext();
  return {
    controller,
    calls,
    hooks,
    response,
    makeCapture,
    scopes,
    signals,
    taskStates,
    context: (next: Partial<OrdersContext>) => {
      context = { ...context, ...next };
    },
    invalidate: (reason: OrdersInvalidation = 'page') =>
      events.forEach((event) => event(reason)),
  };
}

test('a completed visual backend failure survives later source/focus events without reusing its snapshot', async () => {
  for (const reason of ['page', 'tab', 'unavailable'] as const) {
    const app = await setup({ continueAnswerAcrossTabs: true });
    const requestId = crypto.randomUUID();
    app.controller.setVisualNoticeAccepted(true);
    app.hooks.transport = async () => {
      throw Object.assign(new Error('Safe synthetic provider failure'), {
        code: 'PROVIDER_FAILURE',
        requestId,
      });
    };
    await app.controller.ask();
    assert.equal(app.controller.getSnapshot().errorRequestId, requestId);
    app.invalidate(reason);
    await flush();
    assert.equal(app.controller.getSnapshot().phase, 'error');
    assert.equal(app.controller.getSnapshot().error, 'PROVIDER_FAILURE');
    assert.equal(app.controller.getSnapshot().errorRequestId, requestId);
    assert.equal(app.controller.getSnapshot().stale, true);
    assert.equal(app.controller.getSnapshot().result, null);
    assert.equal(app.controller.claimAutomaticSpeech(), null);
    assert.equal(app.calls.model, 1);
    assert.equal(app.calls.capture, 1);
    const originalLookup = app.hooks.context;
    app.hooks.context = async () => {
      throw new Error('Temporary page lookup failure');
    };
    await app.controller.refreshContext();
    assert.equal(app.controller.getSnapshot().error, 'PROVIDER_FAILURE');
    assert.equal(app.controller.getSnapshot().errorRequestId, requestId);
    app.hooks.context = originalLookup;
    app.hooks.transport = async (input) => app.response(input);
    await app.controller.refreshContext();
    await app.controller.ask();
    assert.equal(app.controller.getSnapshot().phase, 'ready');
    assert.equal(app.controller.getSnapshot().errorRequestId, null);
    assert.equal(app.controller.getSnapshot().stale, false);
    assert.equal(app.calls.model, 2);
    app.controller.dispose();
  }
});

test('request references must be valid UUIDs and are cleared with the session', async () => {
  const app = await setup();
  app.controller.setVisualNoticeAccepted(true);
  let requestId = 'untrusted non-reference text';
  app.hooks.transport = async () => {
    throw Object.assign(new Error('Safe failure'), {
      code: 'PROVIDER_FAILURE',
      requestId,
    });
  };
  await app.controller.ask();
  assert.equal(app.controller.getSnapshot().errorRequestId, null);
  requestId = crypto.randomUUID();
  await app.controller.ask();
  assert.equal(app.controller.getSnapshot().errorRequestId, requestId);
  app.controller.clearTransient();
  assert.equal(app.controller.getSnapshot().errorRequestId, null);
  app.controller.dispose();
});

test('visual standby, context refresh and notice acceptance never capture or submit', async () => {
  const { controller, calls } = await setup();
  const unsubscribe = controller.subscribe(() => {});
  controller.getSnapshot();
  await controller.refreshContext();
  await controller.refreshContext(true);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'VISUAL_NOTICE_REQUIRED');
  assert.equal(calls.capture, 0);
  controller.setVisualNoticeAccepted(true);
  await flush();
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.match(controller.getSnapshot().question, /calendar/);
  unsubscribe();
  controller.dispose();
});
test('missing browser access preserves draft; granting it does not submit or capture', async () => {
  const { controller, calls, context, taskStates } = await setup();
  controller.setVisualNoticeAccepted(true);
  context({ visual: { eligible: true, permission: 'required' } });
  await controller.refreshContext();
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'PAGE_PERMISSION_REQUIRED');
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.ok(taskStates.some((state) => state.recovering));
  context({ visual: { eligible: true, permission: 'granted' } });
  await controller.refreshContext();
  await flush();
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  assert.match(controller.getSnapshot().question, /calendar/);
  await controller.ask();
  assert.equal(calls.capture, 1);
  assert.equal(calls.model, 1);
  controller.dispose();
});
test('canvas/application visual answer accepts readable evidence and claims speech only once without retaining bytes', async () => {
  const { controller, calls, taskStates } = await setup();
  controller.setVisualNoticeAccepted(true);
  await controller.ask();
  const state = controller.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.ok(
    state.result &&
      'source_kind' in state.result &&
      state.result.source_kind === 'visual_page',
  );
  assert.equal(calls.textCapture, 0);
  assert.ok(taskStates.some((state) => state.capturing));
  assert.equal(taskStates.at(-1)?.capturing, false);
  assert.ok(
    state.snapshot &&
      'source_kind' in state.snapshot &&
      state.snapshot.source_kind === 'visual_page',
  );
  assert.ok(!JSON.stringify(state).includes('base64'));
  assert.ok(!JSON.stringify(state).includes(btoa('synthetic raster fixture')));
  assert.ok(controller.claimAutomaticSpeech());
  assert.equal(controller.claimAutomaticSpeech(), null);
  await controller.refreshContext();
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.equal(calls.model, 1);
  controller.dispose();
});
test('oversized rendered-page recovery waits for an explicit narrower action', async () => {
  const { controller, calls, hooks, makeCapture, scopes } = await setup();
  controller.setVisualNoticeAccepted(true);
  controller.setQuestion('Explain the chart across the whole page');
  hooks.capture = async (scope) => {
    if (scope === 'rendered_page')
      throw Object.assign(new Error('Too long'), { code: 'VISUAL_TOO_LARGE' });
    return makeCapture(scope);
  };
  await controller.ask();
  assert.equal(controller.getSnapshot().scopeRecovery, true);
  assert.equal(calls.model, 0);
  assert.deepEqual(scopes, ['rendered_page']);
  await controller.refreshContext();
  assert.equal(calls.model, 0);
  assert.equal(calls.capture, 1);
  await controller.askNarrower('first_portion');
  assert.equal(calls.model, 1);
  assert.deepEqual(scopes, ['rendered_page', 'first_portion']);
  assert.equal(controller.getSnapshot().phase, 'ready');
  controller.dispose();
});
test('narrower-scope choices cannot submit after editing the question or changing its resource', async () => {
  for (const change of ['question', 'resource'] as const) {
    const { controller, calls, hooks, context } = await setup();
    controller.setVisualNoticeAccepted(true);
    controller.setQuestion('Explain the chart across the whole page');
    hooks.capture = async () => {
      throw Object.assign(new Error('Too long'), { code: 'VISUAL_TOO_LARGE' });
    };
    await controller.ask();
    assert.equal(controller.getSnapshot().scopeRecovery, true);
    if (change === 'question') controller.setQuestion('A new question');
    else {
      context({ resourceKey: 'c'.repeat(64) });
      await controller.refreshContext();
    }
    await controller.askNarrower('current_view');
    assert.equal(calls.capture, 1);
    assert.equal(calls.model, 0);
    controller.dispose();
  }
});
test('duplicate Ask and cancellation during capture never send late image payloads', async () => {
  const { controller, calls, hooks, makeCapture, signals } = await setup();
  controller.setVisualNoticeAccepted(true);
  const pending = deferred<Capture>();
  hooks.capture = () => pending.promise;
  const task = controller.ask();
  await flush();
  await controller.ask();
  assert.equal(calls.capture, 1);
  controller.cancel();
  assert.equal(signals[0]?.aborted, true);
  pending.resolve(await makeCapture('current_view'));
  await task;
  assert.equal(calls.model, 0);
  assert.equal(controller.getSnapshot().snapshot, null);
  assert.equal(controller.claimAutomaticSpeech(), null);
  controller.dispose();
});
test('cancel, source changes, logout and account cleanup reject a late visual answer', async (t) => {
  for (const action of ['cancel', 'source', 'logout', 'account'] as const) {
    const { controller, calls, hooks, response, invalidate } = await setup();
    t.after(() => controller.dispose());
    controller.setVisualNoticeAccepted(true);
    const pending = deferred<CompanionResponse>();
    let input!: CompanionRequest;
    hooks.transport = (value) => {
      input = value;
      return pending.promise;
    };
    const task = controller.ask();
    await until(() => calls.model === 1);
    await controller.ask();
    assert.equal(calls.model, 1);
    if (action === 'cancel') controller.cancel();
    else if (action === 'source') invalidate();
    else if (action === 'logout') controller.dispose();
    else controller.clearTransient();
    pending.resolve(response(input));
    await task;
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(controller.claimAutomaticSpeech(), null);
    assert.ok(calls.stop > 0);
    if (action === 'logout' || action === 'account') {
      assert.equal(controller.getSnapshot().snapshot, null);
      assert.equal(controller.getSnapshot().question, '');
    }
    controller.dispose();
  }
});
test('detected resource change between Ask and capture prevents screenshot or provider work', async () => {
  const { controller, calls, context } = await setup();
  controller.setVisualNoticeAccepted(true);
  context({ resourceKey: 'c'.repeat(64) });
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'STALE_CONTEXT');
  assert.equal(calls.capture, 0);
  assert.equal(calls.model, 0);
  controller.dispose();
});
test('foreign image IDs and mismatched request/source IDs are never displayed or spoken', async () => {
  for (const change of [
    'image',
    'request',
    'snapshot',
    'fingerprint',
  ] as const) {
    const { controller, hooks, response } = await setup();
    controller.setVisualNoticeAccepted(true);
    hooks.transport = async (input) => {
      const value = response(input);
      if (change === 'image') value.evidence[0]!.image_id = 'image-4';
      else if (change === 'request') value.request_id = crypto.randomUUID();
      else if (change === 'snapshot') value.snapshot_id = crypto.randomUUID();
      else value.fingerprint = 'f'.repeat(64);
      return value;
    };
    await controller.ask();
    assert.equal(controller.getSnapshot().error, 'PROVIDER_FAILURE');
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(controller.claimAutomaticSpeech(), null);
    controller.dispose();
  }
});
test('visual answers cannot inflate capture scope or replace its coverage', async () => {
  for (const change of ['scope', 'coverage'] as const) {
    const { controller, hooks, response } = await setup();
    controller.setVisualNoticeAccepted(true);
    hooks.transport = async (input) => {
      const value = response(input);
      if (change === 'scope') value.scope = 'rendered_page';
      else value.coverage = { ...value.coverage, geometric_complete: true };
      return value;
    };
    await controller.ask();
    const state = controller.getSnapshot();
    controller.dispose();
    assert.equal(state.error, 'PROVIDER_FAILURE');
    assert.equal(state.result, null);
  }
});
test('same-tab snapshot from another pathname is rejected before upload', async () => {
  const { controller, calls, hooks, makeCapture } = await setup();
  controller.setVisualNoticeAccepted(true);
  hooks.capture = async (scope) => {
    const capture = await makeCapture(scope);
    capture.snapshot.pathname = '/other-document';
    capture.snapshot.fingerprint = await fingerprintVisualSnapshot(
      capture.snapshot,
    );
    return capture;
  };
  await controller.ask();
  const state = controller.getSnapshot();
  controller.dispose();
  assert.equal(state.error, 'STALE_CONTEXT');
  assert.equal(calls.model, 0);
});
test('failed final visual source verification preserves the draft but rejects the answer', async () => {
  const { controller, hooks } = await setup();
  controller.setVisualNoticeAccepted(true);
  hooks.verify = async () => false;
  await controller.ask();
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.match(controller.getSnapshot().question, /calendar/);
  controller.dispose();
});
test('accepted floating visual speech survives a tab switch without replay while source invalidation stops it', async () => {
  const { controller, calls, invalidate } = await setup({
    continueAnswerAcrossTabs: true,
  });
  controller.setVisualNoticeAccepted(true);
  await controller.ask();
  assert.ok(controller.claimAutomaticSpeech());
  const result = controller.getSnapshot().result;
  const stopped = calls.stop;
  invalidate('tab');
  await flush();
  assert.equal(controller.getSnapshot().result, result);
  assert.equal(calls.stop, stopped);
  assert.equal(calls.preserveSpeech, 1);
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.equal(calls.model, 1);
  invalidate('page');
  await flush();
  assert.ok(calls.stop > stopped);
  assert.equal(controller.getSnapshot().stale, true);
  controller.dispose();
});
test('visual overall deadline prevents late answer speech without deleting the question', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, calls, hooks, response } = await setup();
  controller.setVisualNoticeAccepted(true);
  const pending = deferred<CompanionResponse>();
  let input!: CompanionRequest;
  hooks.transport = (value) => {
    input = value;
    return pending.promise;
  };
  const task = controller.ask();
  await until(() => calls.model === 1);
  t.mock.timers.tick(60_000);
  assert.equal(controller.getSnapshot().error, 'TIMEOUT');
  pending.resolve(response(input));
  await task;
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.match(controller.getSnapshot().question, /calendar/);
  controller.dispose();
});
