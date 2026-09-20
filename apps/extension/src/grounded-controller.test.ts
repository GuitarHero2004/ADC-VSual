import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  GroundedRequest,
  GroundedResponse,
  GroundedSnapshot,
} from '@adc/contracts';
import {
  GroundedController,
  type GroundedTransport,
} from './grounded-controller.ts';
import type { OrdersPageContext, PageContextInfo } from './page-context.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((done) => setImmediate(done));
async function permit(controller: GroundedController) {
  await controller.refreshContext();
  await controller.allow();
}

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
function resultFor(input: GroundedRequest): GroundedResponse {
  return {
    request_id: input.request_id,
    snapshot_id: input.snapshot.snapshot_id,
    fingerprint: input.snapshot.fingerprint,
    status: 'clarification',
    reason: 'missing_periods',
    text: 'Please specify two months.',
  };
}
function setup() {
  const calls = {
    capture: 0,
    provider: 0,
    verify: 0,
    stopMedia: 0,
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
  const events = new Set<() => void>();
  const hooks: {
    getContext(): Promise<PageContextInfo>;
    capture(signal: AbortSignal): Promise<GroundedSnapshot>;
    verify(snapshot: GroundedSnapshot, signal: AbortSignal): Promise<boolean>;
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
      const invoke = () => listener('page');
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
    () => {
      calls.stopMedia++;
    },
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
    invalidate() {
      for (const event of events) event();
    },
  };
}

test('opening, subscription and denied consent never capture or upload content', async () => {
  const { controller, calls } = setup();
  await controller.refreshContext();
  const unsubscribe = controller.subscribe(() => {});
  controller.getSnapshot();
  controller.getSnapshot();
  await controller.ask('en');
  assert.equal(controller.getSnapshot().error, 'CONSENT_REQUIRED');
  await controller.inspect();
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
  assert.equal(calls.verify, 0);
  unsubscribe();
  controller.dispose();
});

test('unsupported pages cannot capture even after consent to an earlier supported origin', async () => {
  const { controller, calls, changeContext } = setup();
  await permit(controller);
  changeContext({
    supported: false,
    origin: null,
    pathname: null,
    reason: 'unsupported',
  });
  await controller.ask('en');
  assert.equal(controller.getSnapshot().error, 'UNSUPPORTED_PAGE');
  assert.equal(calls.capture, 0);
  assert.equal(calls.provider, 0);
});

test('explicit source inspection works independently of an AI request', async () => {
  const { controller, calls } = setup();
  await permit(controller);
  await controller.inspect();
  assert.equal(controller.getSnapshot().phase, 'ready');
  assert.equal(controller.getSnapshot().snapshot?.rows[0]?.raw_value, '1,200');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.capture, 1);
  assert.equal(calls.provider, 0);
  assert.equal(calls.verify, 0);
});

test('duplicate Ask and panel subscriptions do not create extra captures or requests', async () => {
  const { controller, calls, hooks } = setup();
  await permit(controller);
  const pending = deferred<GroundedResponse>();
  let submitted!: GroundedRequest;
  hooks.transport = (input) => {
    submitted = input;
    return pending.promise;
  };
  const first = controller.ask('en');
  await flush();
  await Promise.all([
    controller.ask('en'),
    controller.ask('en'),
    controller.inspect(),
  ]);
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

test('cancel during model work aborts locally and ignores a late provider success', async () => {
  const { controller, calls, hooks } = setup();
  await permit(controller);
  const pending = deferred<GroundedResponse>();
  let submitted!: GroundedRequest;
  let providerSignal!: AbortSignal;
  hooks.transport = (input, signal) => {
    submitted = input;
    providerSignal = signal;
    return pending.promise;
  };
  const work = controller.ask('en');
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
  await permit(controller);
  const pending = deferred<GroundedResponse>();
  let oldInput!: GroundedRequest;
  hooks.transport = (input) => {
    oldInput = input;
    return pending.promise;
  };
  const old = controller.ask('en');
  await flush();
  controller.setQuestion('Compare from August to July in South.');
  assert.equal(controller.getSnapshot().phase, 'cancelled');
  hooks.transport = async (input) => resultFor(input);
  await controller.ask('en');
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
    await permit(controller);
    const capture = deferred<GroundedSnapshot>();
    const model = deferred<GroundedResponse>();
    const verification = deferred<boolean>();
    let input!: GroundedRequest;
    if (stage === 'capture') hooks.capture = () => capture.promise;
    if (stage === 'model')
      hooks.transport = (value) => {
        input = value;
        return model.promise;
      };
    if (stage === 'verify') hooks.verify = () => verification.promise;
    const work = controller.ask('en');
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
      controller.getSnapshot().consentOrigin,
      'https://dashboard.example.test',
    );
  }
});

test('a failed final freshness check cannot label a response current', async () => {
  const { controller, hooks } = setup();
  await permit(controller);
  hooks.verify = async () => false;
  await controller.ask('en');
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.getSnapshot().error, 'STALE_CONTEXT');
});

test('responses with different request, snapshot or fingerprint are withheld before freshness verification', async () => {
  for (const field of ['request_id', 'snapshot_id', 'fingerprint'] as const) {
    const { controller, calls, hooks } = setup();
    await permit(controller);
    hooks.transport = async (input) => ({
      ...resultFor(input),
      [field]: field === 'fingerprint' ? 'b'.repeat(64) : crypto.randomUUID(),
    });
    await controller.ask('en');
    assert.equal(controller.getSnapshot().error, 'PROVIDER_FAILURE', field);
    assert.equal(controller.getSnapshot().result, null, field);
    assert.equal(calls.verify, 0, field);
  }
});

test('origin changes clear consent and captured data; same-origin table changes preserve consent but mark old evidence stale', async () => {
  const { controller, calls, changeContext, invalidate } = setup();
  await permit(controller);
  await controller.ask('en');
  const previous = controller.getSnapshot().result;
  invalidate();
  await flush();
  assert.equal(controller.getSnapshot().phase, 'stale');
  assert.equal(controller.getSnapshot().result, previous);
  assert.equal(
    controller.getSnapshot().consentOrigin,
    'https://dashboard.example.test',
  );
  changeContext({ origin: 'https://other.example.test' });
  invalidate();
  await flush();
  assert.equal(controller.getSnapshot().consentOrigin, null);
  assert.equal(controller.getSnapshot().snapshot, null);
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.provider, 1);
  assert.ok(calls.reset > 0);
});

test('Cancel cannot relabel previous stale evidence current; explicit fresh inspection clears stale status', async () => {
  const { controller, calls, invalidate } = setup();
  await permit(controller);
  await controller.ask('en');
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
  await permit(controller);
  const pending = deferred<GroundedResponse>();
  let input!: GroundedRequest;
  hooks.transport = (value) => {
    input = value;
    return pending.promise;
  };
  const work = controller.ask('vi');
  await flush();
  controller.dispose();
  assert.equal(controller.getSnapshot().question, '');
  assert.equal(controller.getSnapshot().snapshot, null);
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(controller.getSnapshot().consentOrigin, null);
  pending.resolve(resultFor(input));
  invalidate();
  await work;
  await controller.ask('en');
  assert.equal(controller.getSnapshot().result, null);
  assert.equal(calls.provider, 1);
  assert.equal(calls.dispose, 1);
  assert.ok(calls.stopMedia > 0);
});

test('provider quota and timeout errors preserve the question and allow an explicit retry', async () => {
  for (const code of ['RATE_LIMITED', 'TIMEOUT', 'SETUP_REQUIRED']) {
    const { controller, hooks, calls } = setup();
    await permit(controller);
    const question = controller.getSnapshot().question;
    hooks.transport = async () => {
      throw Object.assign(new Error('Recoverable'), { code });
    };
    await controller.ask('en');
    assert.equal(controller.getSnapshot().error, code);
    assert.equal(controller.getSnapshot().question, question);
    assert.equal(controller.getSnapshot().result, null);
    assert.equal(calls.provider, 1);
    hooks.transport = async (input) => resultFor(input);
    await controller.ask('en');
    assert.equal(controller.getSnapshot().phase, 'ready');
    assert.equal(calls.provider, 2);
  }
});

test('revoking while Allow waits for a page lookup cannot grant consent afterwards', async () => {
  const { controller, hooks } = setup();
  await controller.refreshContext();
  const original = await hooks.getContext();
  const pending = deferred<PageContextInfo>();
  hooks.getContext = () => pending.promise;
  const allow = controller.allow();
  controller.revoke();
  pending.resolve(original);
  await allow;
  assert.equal(controller.getSnapshot().consentOrigin, null);
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
