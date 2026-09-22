import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroundedResponse, GroundedSnapshot } from '@adc/contracts';
import {
  GroundedController,
  type GroundedTransport,
  type CompanionRequest,
  type CompanionSnapshot,
} from './grounded-controller.ts';
import type {
  OrdersPageContext,
  PageContextInfo,
  OrdersInvalidation,
} from './page-context.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((done) => setImmediate(done));

function source(): GroundedSnapshot {
  return {
    snapshot_id: crypto.randomUUID(),
    document_key: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1',
    captured_at: '2026-09-20T06:00:00.000Z',
    origin: 'https://dashboard.example.test',
    pathname: '/orders',
    title: 'Orders dashboard',
    table_title: 'Completed orders',
    region: 'South',
    year: 2026,
    metric: 'completed_orders',
    unit: 'orders',
    locale: 'en-US',
    is_complete: true,
    rows: [
      {
        id: 'july',
        period: '2026-07',
        region: 'South',
        raw_value: '1,200',
        value: 1200,
      },
      {
        id: 'august',
        period: '2026-08',
        region: 'South',
        raw_value: '900',
        value: 900,
      },
    ],
    fingerprint: 'a'.repeat(64),
  };
}
function resultFor(
  input: CompanionRequest,
): Extract<GroundedResponse, { status: 'clarification' }> {
  return {
    answer_language: 'en',
    request_id: input.request_id,
    snapshot_id: input.snapshot.snapshot_id,
    fingerprint: input.snapshot.fingerprint,
    status: 'clarification',
    reason: 'missing_periods',
    text: 'Please specify two months.',
  };
}
function setup(options: { continueAnswerAcrossTabs?: boolean } = {}) {
  const calls = {
    capture: 0,
    provider: 0,
    verify: 0,
    stopMedia: 0,
    preserveSpeech: 0,
    reset: 0,
    dispose: 0,
    returnToPage: 0,
  };
  let context: PageContextInfo = {
    supported: true,
    origin: 'https://dashboard.example.test',
    pathname: '/orders',
    tabId: 10,
    windowId: 20,
    reason: null,
  };
  const events = new Set<(reason: OrdersInvalidation) => void>();
  const hooks: {
    getContext(): Promise<PageContextInfo>;
    capture(signal: AbortSignal): Promise<GroundedSnapshot>;
    verify(snapshot: CompanionSnapshot, signal: AbortSignal): Promise<boolean>;
    transport: GroundedTransport;
  } = {
    getContext: async () => context,
    capture: async () => source(),
    verify: async () => true,
    transport: async (input) => resultFor(input),
  };
  const page: Pick<
    OrdersPageContext,
    | 'getContext'
    | 'capture'
    | 'verify'
    | 'subscribe'
    | 'returnToPage'
    | 'reset'
    | 'dispose'
  > = {
    getContext: () => hooks.getContext(),
    capture: (signal) => {
      calls.capture++;
      return hooks.capture(signal);
    },
    verify: (snapshot, signal) => {
      calls.verify++;
      return hooks.verify(snapshot, signal);
    },
    subscribe(listener) {
      const invoke = (reason: OrdersInvalidation) => listener(reason);
      events.add(invoke);
      return () => {
        events.delete(invoke);
      };
    },
    async returnToPage() {
      calls.returnToPage++;
      return { restored: true };
    },
    reset() {
      calls.reset++;
    },
    dispose() {
      calls.dispose++;
      events.clear();
    },
  };
  const controller = new GroundedController(
    page,
    (input, signal) => {
      calls.provider++;
      return hooks.transport(input, signal);
    },
    (preserveAnswerSpeech) => {
      if (preserveAnswerSpeech) calls.preserveSpeech++;
      else calls.stopMedia++;
    },
    options,
  );
  controller.setQuestion(
    'Compare completed orders in the South for August and July.',
  );
  return {
    controller,
    calls,
    hooks,
    changeContext(next: Partial<PageContextInfo>) {
      context = { ...context, ...next };
    },
    invalidate(reason: OrdersInvalidation = 'page') {
      for (const event of events) event(reason);
    },
  };
}

test('opening, subscription, context checks and a draft never capture or upload content', async () => {
  const { controller, calls } = setup();
  await controller.refreshContext();
  const unsubscribe = controller.subscribe(() => {});
  controller.getSnapshot();
  controller.getSnapshot();
  await controller.refreshContext();
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
  assert.equal(calls.verify, 0);
  unsubscribe();
  controller.dispose();
});

test('unsupported pages cannot capture after an earlier supported origin', async () => {
  const { controller, calls, changeContext } = setup();
  await controller.refreshContext();
  changeContext({
    supported: false,
    origin: null,
    pathname: null,
    reason: 'unsupported',
  });
  await controller.refreshContext();
  await controller.ask();
  assert.equal(controller.getSnapshot().error, 'UNSUPPORTED_PAGE');
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
});

test('explicit source inspection works independently of an AI request', async () => {
  const { controller, calls } = setup();
  await controller.refreshContext();
  await controller.inspect();
  assert.equal(controller.getSnapshot().phase, 'ready');
  const captured = controller.getSnapshot().snapshot;
  assert.ok(captured && 'rows' in captured);
  assert.equal(captured.rows[0]?.raw_value, '1,200');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.capture, 1);
  assert.equal(calls.provider, 0);
  assert.equal(calls.verify, 0);
});

test('duplicate Ask and panel subscriptions do not create extra captures or requests', async () => {
  const { controller, calls, hooks } = setup();
  await controller.refreshContext();
  const pending = deferred<GroundedResponse>();
  let submitted!: CompanionRequest;
  hooks.transport = (input) => {
    submitted = input;
    return pending.promise;
  };
  const first = controller.ask();
  await flush();
  await Promise.all([controller.ask(), controller.ask(), controller.inspect()]);
  const off = controller.subscribe(() => {});
  controller.getSnapshot();
  off();
  assert.equal(calls.capture, 1);
  assert.equal(calls.provider, 1);
  pending.resolve(resultFor(submitted));
  await first;
  assert.equal(calls.verify, 1);
  assert.equal(controller.getSnapshot().phase, 'ready');
});

test('only a fresh accepted answer can reserve automatic speech, once across subscribers', async () => {
  const { controller, hooks } = setup();
  await controller.refreshContext();
  assert.equal(controller.claimAutomaticSpeech(), null);
  await controller.inspect();
  assert.equal(controller.claimAutomaticSpeech(), null);
  for (const status of ['clarification', 'unsupported'] as const) {
    hooks.transport = async (input): Promise<GroundedResponse> => ({
      ...resultFor(input),
      status,
      answer_language: 'vi',
    });
    await controller.ask();
    const result = controller.getSnapshot().result;
    assert.ok(result);
    assert.equal(controller.getSnapshot().resultLanguage, 'vi');
    assert.equal(controller.claimAutomaticSpeech(), result);
    assert.equal(controller.claimAutomaticSpeech(), null);
    controller.getSnapshot();
    await controller.refreshContext();
    assert.equal(controller.claimAutomaticSpeech(), null);
  }
  controller.dispose();
});

test('cancellation, invalidation and disposal consume an unclaimed automatic answer', async () => {
  for (const reason of ['cancel', 'page', 'dispose', 'speech-off'] as const) {
    const { controller, invalidate } = setup();
    await controller.refreshContext();
    await controller.ask();
    if (reason === 'cancel') controller.cancel();
    if (reason === 'page') invalidate();
    if (reason === 'dispose') controller.dispose();
    if (reason === 'speech-off') controller.discardAutomaticSpeech();
    assert.equal(controller.claimAutomaticSpeech(), null, reason);
  }
});

test('the final edited question reaches the backend without an interface-language preference', async () => {
  const { controller, hooks } = setup();
  await controller.refreshContext();
  controller.setQuestion('So sánh tháng 8 với tháng 7.');
  controller.setQuestion('Compare August with July. Answer in English.');
  hooks.transport = async (input) => {
    assert.equal(
      input.question,
      'Compare August with July. Answer in English.',
    );
    assert.equal('language' in input, false);
    return resultFor(input);
  };
  await controller.ask();
  assert.equal(controller.getSnapshot().resultLanguage, 'en');
});

test('cancel during model work aborts locally and ignores a late provider success', async () => {
  const { controller, calls, hooks } = setup();
  await controller.refreshContext();
  const pending = deferred<GroundedResponse>();
  let submitted!: CompanionRequest;
  let providerSignal!: AbortSignal;
  hooks.transport = (input, signal) => {
    submitted = input;
    providerSignal = signal;
    return pending.promise;
  };
  const work = controller.ask();
  await flush();
  controller.cancel();
  assert.equal(providerSignal.aborted, true);
  assert.equal(controller.getSnapshot().phase, 'cancelled');
  pending.resolve(resultFor(submitted));
  await work;
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.verify, 0);
  assert.ok(calls.stopMedia > 0);
  assert.ok(controller.getSnapshot().question.length > 0);
});

test('editing a question cancels pending work and a new answer cannot be overwritten by the old response', async () => {
  const { controller, hooks } = setup();
  await controller.refreshContext();
  const pending = deferred<GroundedResponse>();
  let oldInput!: CompanionRequest;
  hooks.transport = (input) => {
    oldInput = input;
    return pending.promise;
  };
  const old = controller.ask();
  await flush();
  controller.setQuestion('Compare from August to July in South.');
  assert.equal(controller.getSnapshot().phase, 'cancelled');
  hooks.transport = async (input) => resultFor(input);
  await controller.ask();
  const current = controller.getSnapshot().result;
  assert.ok(current);
  assert.notEqual(current.request_id, oldInput.request_id);
  pending.resolve(resultFor(oldInput));
  await old;
  assert.equal(controller.getSnapshot().result, current);
});

test('context invalidation during capture, interpretation or verification withholds late results and never resubmits', async () => {
  for (const stage of ['capture', 'model', 'verify'] as const) {
    const { controller, calls, hooks, invalidate } = setup();
    await controller.refreshContext();
    const capture = deferred<GroundedSnapshot>();
    const model = deferred<GroundedResponse>();
    const verification = deferred<boolean>();
    let input!: CompanionRequest;
    if (stage === 'capture') hooks.capture = () => capture.promise;
    if (stage === 'model')
      hooks.transport = (value) => {
        input = value;
        return model.promise;
      };
    if (stage === 'verify') hooks.verify = () => verification.promise;
    const work = controller.ask();
    await flush();
    invalidate();
    capture.resolve(source());
    if (input) model.resolve(resultFor(input));
    verification.resolve(true);
    await work;
    await flush();
    assert.equal(controller.getSnapshot().phase, 'stale', stage);
    assert.equal(controller.getSnapshot().result, null, stage);
    assert.equal(calls.capture, 1, stage);
    assert.equal(calls.provider, stage === 'capture' ? 0 : 1, stage);
    assert.equal(
      controller.getSnapshot().context?.origin,
      'https://dashboard.example.test',
    );
  }
});

test('a failed final freshness check cannot label a response current', async () => {
  const { controller, hooks } = setup();
  await controller.refreshContext();
  hooks.verify = async () => false;
  await controller.ask();
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.getSnapshot().error, 'STALE_CONTEXT');
});

test('responses with different request, snapshot or fingerprint are withheld before freshness verification', async () => {
  for (const field of ['request_id', 'snapshot_id', 'fingerprint'] as const) {
    const { controller, calls, hooks } = setup();
    await controller.refreshContext();
    hooks.transport = async (input) => ({
      ...resultFor(input),
      [field]: field === 'fingerprint' ? 'b'.repeat(64) : crypto.randomUUID(),
    });
    await controller.ask();
    assert.equal(controller.getSnapshot().error, 'PROVIDER_FAILURE', field);
    assert.equal(controller.getSnapshot().result, null, field);
    assert.equal(calls.verify, 0, field);
  }
});

test('origin changes clear captured data; same-origin table changes mark old evidence stale', async () => {
  const { controller, calls, changeContext, invalidate } = setup();
  await controller.refreshContext();
  await controller.ask();
  const previous = controller.getSnapshot().result;
  invalidate();
  await flush();
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, previous);
  assert.equal(
    controller.getSnapshot().context?.origin,
    'https://dashboard.example.test',
  );
  changeContext({ origin: 'https://other.example.test' });
  invalidate();
  await flush();
  assert.equal(controller.getSnapshot().snapshot, null);
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.provider, 1);
  assert.ok(calls.reset > 0);
});

test('Cancel cannot relabel previous stale evidence current; explicit fresh inspection clears stale status', async () => {
  const { controller, calls, invalidate } = setup();
  await controller.refreshContext();
  await controller.ask();
  const previousResult = controller.getSnapshot().result;
  const previousSnapshot = controller.getSnapshot().snapshot;
  assert.ok(previousResult);
  invalidate();
  await flush();
  assert.equal(controller.getSnapshot().stale, true);
  controller.cancel();
  assert.equal(controller.getSnapshot().stale, true);
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, previousResult);
  assert.equal(controller.getSnapshot().snapshot, previousSnapshot);
  await controller.inspect();
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(controller.getSnapshot().stale, false);
  assert.equal(controller.getSnapshot().result, null);
  assert.notEqual(
    controller.getSnapshot().snapshot?.snapshot_id,
    previousSnapshot?.snapshot_id,
  );
  assert.equal(calls.capture, 2);
  assert.equal(calls.provider, 1);
});

test('logout disposal clears pending work, question, source evidence and media and ignores late work', async () => {
  const { controller, calls, hooks, invalidate } = setup();
  await controller.refreshContext();
  const pending = deferred<GroundedResponse>();
  let input!: CompanionRequest;
  hooks.transport = (value) => {
    input = value;
    return pending.promise;
  };
  const work = controller.ask();
  await flush();
  controller.dispose();
  assert.equal(controller.getSnapshot().question, '');
  assert.equal(controller.getSnapshot().snapshot, null);
  assert.equal(controller.getSnapshot().result, null);
  pending.resolve(resultFor(input));
  invalidate();
  await work;
  await controller.ask();
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.provider, 1);
  assert.equal(calls.dispose, 1);
  assert.ok(calls.stopMedia > 0);
});

test('provider quota and timeout errors preserve the question and allow an explicit retry', async () => {
  for (const code of ['RATE_LIMITED', 'TIMEOUT', 'SETUP_REQUIRED']) {
    const { controller, hooks, calls } = setup();
    await controller.refreshContext();
    const question = controller.getSnapshot().question;
    hooks.transport = async () => {
      throw Object.assign(new Error('Recoverable'), { code });
    };
    await controller.ask();
    assert.equal(controller.getSnapshot().error, code);
    assert.equal(controller.getSnapshot().question, question);
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(calls.provider, 1);
    hooks.transport = async (input) => resultFor(input);
    await controller.ask();
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.equal(calls.provider, 2);
  }
});

test('grounded application-limit details are validated, preserved with the question and cleared on recovery or logout', async () => {
  const { controller, hooks, calls } = setup();
  await controller.refreshContext();
  const question = controller.getSnapshot().question;
  const usage = {
    minute_count: 30,
    minute_limit: 30,
    day_count: 75,
    day_limit: 1000,
    limited_by: 'minute',
    retry_after_seconds: 12,
    retry_at: '2026-09-21T06:30:12.000Z',
  };
  hooks.transport = async () => {
    throw Object.assign(new Error('Application limit'), {
      code: 'APP_RATE_LIMITED',
      usage,
    });
  };
  await controller.ask();
  assert.deepEqual(controller.getSnapshot().errorUsage, usage);
  assert.equal(controller.getSnapshot().question, question);
  assert.equal(calls.provider, 1);
  const pending = deferred<GroundedResponse>();
  let nextInput!: CompanionRequest;
  hooks.transport = async (input) => {
    nextInput = input;
    return pending.promise;
  };
  const retry = controller.ask();
  assert.equal(controller.getSnapshot().errorUsage, null);
  await flush();
  pending.resolve(resultFor(nextInput));
  await retry;
  assert.equal(controller.getSnapshot().phase, 'ready');
  for (const code of ['PROVIDER_RATE_LIMITED', 'APP_RATE_LIMITED']) {
    hooks.transport = async () => {
      throw Object.assign(new Error('Untrusted details'), {
        code,
        usage: { ...usage, minute_count: -1 },
      });
    };
    await controller.ask();
    assert.equal(controller.getSnapshot().errorUsage, null);
  }
  controller.dispose();
  assert.equal(controller.getSnapshot().question, '');
  assert.equal(controller.getSnapshot().errorUsage, null);
});

test('cancelling while an explicit Ask waits for a page lookup prevents capture and provider work', async () => {
  const { controller, hooks, calls } = setup();
  await controller.refreshContext();
  const original = await hooks.getContext();
  const pending = deferred<PageContextInfo>();
  hooks.getContext = () => pending.promise;
  const asking = controller.ask();
  controller.cancel();
  pending.resolve(original);
  await asking;
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
  assert.ok(controller.getSnapshot().question);
});

test('an older context lookup cannot overwrite a newer lookup result', async () => {
  const { controller, hooks } = setup();
  const original = await hooks.getContext();
  const pending = deferred<PageContextInfo>();
  hooks.getContext = () => pending.promise;
  const older = controller.refreshContext();
  hooks.getContext = async () => ({
    ...original,
    origin: 'https://new.example.test',
    tabId: 11,
  });
  await controller.refreshContext();
  pending.resolve(original);
  await older;
  assert.equal(
    controller.getSnapshot().context?.origin,
    'https://new.example.test',
  );
});

test('first deliberate Ask authorizes only its captured request without a separate grant or stored preference', async () => {
  const { controller, hooks, calls } = setup();
  hooks.transport = async (input) => {
    assert.equal(input.consent, true);
    assert.equal(input.snapshot.origin, 'https://dashboard.example.test');
    return resultFor(input);
  };
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
  await controller.ask();
  assert.equal(calls.capture, 1);
  assert.equal(calls.provider, 1);
  assert.equal(controller.getSnapshot().phase, 'ready');
  controller.clearTransient();
  await controller.refreshContext();
  assert.equal(
    calls.provider,
    1,
    'Restoring the source cannot submit an old question',
  );
  controller.setQuestion('Compare completed orders from July to August.');
  await controller.ask();
  assert.equal(calls.provider, 2);
  controller.dispose();
});

test('accepted floating answer keeps its own source and speech across tab switches without capture or replay', async () => {
  const { controller, calls, invalidate, changeContext } = setup({
    continueAnswerAcrossTabs: true,
  });
  await controller.refreshContext();
  await controller.ask();
  const accepted = controller.getSnapshot().result;
  assert.equal(controller.claimAutomaticSpeech(), accepted);
  const snapshot = controller.getSnapshot().snapshot;
  const currentSource = controller.getSnapshot().context;
  const fullStops = calls.stopMedia;
  changeContext({ origin: 'https://another.example.test', tabId: 21 });
  invalidate('tab');
  await flush();
  assert.equal(controller.getSnapshot().result, accepted);
  assert.equal(controller.getSnapshot().snapshot, snapshot);
  assert.equal(
    controller.getSnapshot().context,
    currentSource,
    'The retained answer is never rebound to the newly active source',
  );
  assert.equal(controller.getSnapshot().stale, false);
  assert.equal(calls.stopMedia, fullStops);
  assert.equal(calls.preserveSpeech, 1);
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.equal(calls.provider, 1);
  assert.equal(calls.capture, 1);
  assert.equal(controller.pauseForTab(), true);
  assert.equal(calls.preserveSpeech, 2);
  assert.equal(controller.claimAutomaticSpeech(), null);
  controller.dispose();
});

test('hiding before the UI claims an accepted answer preserves exactly one automatic read-back', async () => {
  const { controller, calls, invalidate } = setup({
    continueAnswerAcrossTabs: true,
  });
  await controller.refreshContext();
  await controller.ask();
  const accepted = controller.getSnapshot().result;
  const stopped = calls.stopMedia;
  // The worker's tab event and the document's visibility event can both arrive
  // before React runs the accepted-answer effect. Neither starts new work.
  invalidate('tab');
  assert.equal(controller.pauseForTab(), true);
  await flush();
  assert.equal(controller.getSnapshot().result, accepted);
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(calls.stopMedia, stopped);
  assert.equal(calls.preserveSpeech, 2);
  assert.equal(calls.capture, 1);
  assert.equal(calls.provider, 1);
  assert.equal(controller.claimAutomaticSpeech(), accepted);
  assert.equal(controller.claimAutomaticSpeech(), null);
  invalidate('tab');
  assert.equal(controller.claimAutomaticSpeech(), null);
  controller.dispose();
});

test('pending floating question is cancelled on a tab change and its late answer never becomes current', async () => {
  const { controller, hooks, calls, invalidate } = setup({
    continueAnswerAcrossTabs: true,
  });
  await controller.refreshContext();
  const pending = deferred<GroundedResponse>();
  let submitted!: CompanionRequest;
  let signal!: AbortSignal;
  hooks.transport = (input, requestSignal) => {
    submitted = input;
    signal = requestSignal;
    return pending.promise;
  };
  const work = controller.ask();
  await flush();
  invalidate('tab');
  assert.equal(signal.aborted, true);
  assert.equal(calls.preserveSpeech, 0);
  pending.resolve(resultFor(submitted));
  await work;
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.claimAutomaticSpeech(), null);
  assert.equal(calls.provider, 1);
  controller.dispose();
});

test('floating tab continuity never overrides cancellation, source changes, End or logout', async () => {
  for (const action of [
    'cancel',
    'page',
    'unavailable',
    'clear',
    'dispose',
  ] as const) {
    const { controller, calls, invalidate } = setup({
      continueAnswerAcrossTabs: true,
    });
    await controller.ask();
    assert.equal(controller.pauseForTab(), true);
    const stopped = calls.stopMedia;
    if (action === 'cancel') controller.cancel();
    if (action === 'page' || action === 'unavailable') invalidate(action);
    if (action === 'clear') controller.clearTransient();
    if (action === 'dispose') controller.dispose();
    assert.ok(calls.stopMedia > stopped, action);
    assert.equal(controller.claimAutomaticSpeech(), null, action);
    if (action === 'page' || action === 'unavailable')
      assert.equal(controller.getSnapshot().stale, true);
    if (action === 'clear' || action === 'dispose') {
      assert.equal(controller.getSnapshot().result, null);
      assert.equal(controller.getSnapshot().snapshot, null);
      assert.equal(controller.getSnapshot().question, '');
    }
    controller.dispose();
  }
});

test('side-panel defaults and floating surfaces without an accepted answer stop media when hidden', async () => {
  for (const floating of [false, true]) {
    const { controller, calls } = setup({ continueAnswerAcrossTabs: floating });
    await controller.refreshContext();
    if (!floating) await controller.ask();
    const stopped = calls.stopMedia;
    assert.equal(controller.pauseForTab(), false);
    assert.ok(calls.stopMedia > stopped);
    assert.equal(calls.preserveSpeech, 0);
    assert.equal(controller.claimAutomaticSpeech(), null);
    controller.dispose();
  }
});

test('a source switch during initial lookup cannot send a previous question to a different page', async () => {
  const { controller, hooks, calls } = setup();
  await controller.refreshContext();
  const original = await hooks.getContext();
  const pending = deferred<PageContextInfo>();
  hooks.getContext = () => pending.promise;
  const asking = controller.ask();
  pending.resolve({
    ...original,
    origin: 'https://another.example.test',
    tabId: 21,
  });
  await asking;
  assert.equal(controller.getSnapshot().error, 'STALE_CONTEXT');
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
  assert.ok(controller.getSnapshot().question);
  controller.dispose();
});
