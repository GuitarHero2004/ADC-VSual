import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { GroundedRequest, GroundedResponse } from '@adc/contracts';
import { createGroundedTransport } from './grounded-transport.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function input(): GroundedRequest {
  return {
    request_id: crypto.randomUUID(),
    question: 'Compare July and August.',
    language: 'en',
    consent: true,
    snapshot: {
      snapshot_id: crypto.randomUUID(),
      document_key: crypto.randomUUID(),
      adapter_key: 'orders-fixture@1',
      captured_at: '2026-09-20T06:00:00.000Z',
      origin: 'https://dashboard.example.test',
      pathname: '/orders',
      title: 'Orders',
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
      ],
      fingerprint: 'a'.repeat(64),
    },
  };
}
function resultFor(request: GroundedRequest): GroundedResponse {
  return {
    request_id: request.request_id,
    snapshot_id: request.snapshot.snapshot_id,
    fingerprint: request.snapshot.fingerprint,
    status: 'clarification',
    reason: 'missing_periods',
    text: 'Please specify two months.',
  };
}
function errorResponse(status: number, code: string) {
  return Response.json(
    {
      request_id: crypto.randomUUID(),
      error: { code, message: 'Safe error.', retryable: false },
    },
    { status },
  );
}

test('one explicit request sends the existing bearer credentials without cookies or caches', async () => {
  const request = input();
  const signal = new AbortController().signal;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://backend.example.test/api/grounded-read');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.signal, signal);
    const headers = new Headers(options?.headers);
    assert.equal(
      headers.get('authorization'),
      'Bearer synthetic-session-token',
    );
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('x-request-id'), request.request_id);
    assert.equal(headers.get('cookie'), null);
    assert.deepEqual(JSON.parse(String(options?.body)), request);
    return Response.json(resultFor(request));
  };
  const transport = createGroundedTransport({
    baseUrl: 'https://backend.example.test',
    getHeaders: async () => ({
      Authorization: 'Bearer synthetic-session-token',
    }),
    onUnauthenticated() {
      assert.fail('Unexpected sign out');
    },
  });
  assert.deepEqual(await transport(request, signal), resultFor(request));
  assert.equal(calls, 1);
});

test('application session expiry clears authentication and is never retried', async () => {
  let calls = 0;
  let signouts = 0;
  globalThis.fetch = async () => {
    calls++;
    return errorResponse(401, 'UNAUTHENTICATED');
  };
  const transport = createGroundedTransport({
    baseUrl: 'https://backend.example.test',
    getHeaders: async () => ({}),
    onUnauthenticated() {
      signouts++;
    },
  });
  await assert.rejects(transport(input(), new AbortController().signal), {
    code: 'UNAUTHENTICATED',
  });
  assert.equal(calls, 1);
  assert.equal(signouts, 1);
});

test('Vercel HTML protection is distinct from application authentication and keeps the session', async () => {
  for (const status of [401, 403]) {
    let signouts = 0;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response('<html>Deployment authentication</html>', {
        status,
        headers: { 'Content-Type': 'text/html' },
      });
    };
    const transport = createGroundedTransport({
      baseUrl: 'https://backend.example.test',
      getHeaders: async () => ({}),
      onUnauthenticated() {
        signouts++;
      },
    });
    await assert.rejects(transport(input(), new AbortController().signal), {
      code: 'DEPLOYMENT_UNAVAILABLE',
    });
    assert.equal(signouts, 0);
    assert.equal(calls, 1);
  }
});

test('rate limiting, timeouts and provider failures are returned without automatic retries', async () => {
  for (const [status, code] of [
    [429, 'RATE_LIMITED'],
    [504, 'TIMEOUT'],
    [503, 'SETUP_REQUIRED'],
    [502, 'PROVIDER_FAILURE'],
  ] as const) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return errorResponse(status, code);
    };
    const transport = createGroundedTransport({
      baseUrl: 'https://backend.example.test',
      getHeaders: async () => ({}),
      onUnauthenticated() {
        assert.fail('Unexpected sign out');
      },
    });
    await assert.rejects(transport(input(), new AbortController().signal), {
      code,
    });
    assert.equal(calls, 1);
  }
});

test('cancellation while getting a session prevents a request and late fetch responses are discarded', async () => {
  let calls = 0;
  const first = new AbortController();
  globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  const transport = createGroundedTransport({
    baseUrl: 'https://backend.example.test',
    async getHeaders() {
      first.abort();
      return {};
    },
    onUnauthenticated() {},
  });
  await assert.rejects(transport(input(), first.signal), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);

  const second = new AbortController();
  const request = input();
  globalThis.fetch = async () => {
    calls++;
    second.abort();
    return Response.json(resultFor(request));
  };
  const later = createGroundedTransport({
    baseUrl: 'https://backend.example.test',
    getHeaders: async () => ({}),
    onUnauthenticated() {},
  });
  await assert.rejects(later(request, second.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('malformed successful output and raw error payloads cannot become grounded answers', async () => {
  for (const response of [
    Response.json({ text: 'Invented result' }),
    Response.json({ secret: 'private-provider-payload' }, { status: 500 }),
  ]) {
    globalThis.fetch = async () => response;
    const transport = createGroundedTransport({
      baseUrl: 'https://backend.example.test',
      getHeaders: async () => ({}),
      onUnauthenticated() {},
    });
    await assert.rejects(
      transport(input(), new AbortController().signal),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes('private-provider-payload'),
    );
  }
});
