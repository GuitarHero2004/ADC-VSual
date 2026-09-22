import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visualResourceKey } from './visual-protocol.ts';
import { GroundedController } from './grounded-controller.ts';
import type { OrdersContext } from './page-context.ts';

test('resource identity preserves meaningful query and fragment changes without transmitting their raw contents', async () => {
  const first = await visualResourceKey(
    'https://docs.example.test/edit?file=one#section1',
  );
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(
    first,
    await visualResourceKey('https://docs.example.test/edit?file=one#section1'),
  );
  assert.notEqual(
    first,
    await visualResourceKey('https://docs.example.test/edit?file=two#section1'),
  );
  assert.notEqual(
    first,
    await visualResourceKey('https://docs.example.test/edit?file=one#section2'),
  );
  assert.ok(!first.includes('file='));
});

test('narrow-scope recovery cannot submit an old question against a new same-path resource', async () => {
  let context: OrdersContext = {
    supported: false,
    sourceKind: 'structured_page',
    permission: 'granted',
    capability: 'unsupported',
    reason: 'unsupported',
    tabId: 1,
    windowId: 2,
    origin: 'https://docs.example.test',
    pathname: '/edit',
    visual: { eligible: true, permission: 'granted' },
    resourceKey: await visualResourceKey(
      'https://docs.example.test/edit?file=one',
    ),
  };
  let captures = 0,
    providers = 0;
  const controller = new GroundedController(
    {
      getContext: async () => ({ ...context }),
      capture: async () => {
        assert.fail('No structured capture');
      },
      captureVisual: async () => {
        captures++;
        throw Object.assign(new Error('Scope limit'), {
          code: 'VISUAL_TOO_LARGE',
        });
      },
      verify: async () => true,
      verifyVisual: async () => true,
      subscribe: () => () => {},
      reset() {},
      dispose() {},
      returnToPage: async () => ({ restored: true }),
    },
    async () => {
      providers++;
      assert.fail('No model call for an oversized scope');
    },
    () => {},
  );
  try {
    await controller.refreshContext();
    controller.setVisualNoticeAccepted(true);
    controller.setQuestion('Explain the entire page chart');
    await controller.ask();
    assert.equal(controller.getSnapshot().scopeRecovery, true);
    assert.equal(captures, 1);
    assert.equal(providers, 0);
    context = {
      ...context,
      resourceKey: await visualResourceKey(
        'https://docs.example.test/edit?file=two',
      ),
    };
    await controller.refreshContext();
    await controller.askNarrower('current_view');
    assert.equal(captures, 1);
    assert.equal(providers, 0);
    assert.equal(
      controller.getSnapshot().question,
      'Explain the entire page chart',
    );
  } finally {
    controller.dispose();
  }
});
