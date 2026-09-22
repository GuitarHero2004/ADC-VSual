import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseReadingMethod, canAskPage } from './reading-method.ts';
import type { OrdersContext } from './page-context.ts';

const article: OrdersContext = {
  supported: true,
  sourceKind: 'structured_page',
  permission: 'granted',
  origin: 'https://example.test',
  pathname: '/article',
  tabId: 1,
  windowId: 1,
  reason: null,
};
test('reader selection preserves structured articles and exact orders without a paid routing request', () => {
  assert.equal(
    chooseReadingMethod('Summarise this article', article).method,
    'structured_page',
  );
  assert.equal(
    chooseReadingMethod('Compare July with August', {
      ...article,
      sourceKind: 'orders',
    }).method,
    'orders',
  );
  assert.equal(
    chooseReadingMethod('Explain this chart', article).method,
    'visual_page',
  );
  assert.equal(
    chooseReadingMethod('Giải thích biểu đồ này', article).method,
    'visual_page',
  );
  assert.equal(
    chooseReadingMethod('Explain the layout of the entire page', article).scope,
    'rendered_page',
  );
});
test('canvas and missing article structure may use a permitted current view; access stays separate', () => {
  const app: OrdersContext = {
    ...article,
    supported: false,
    visual: { eligible: true, permission: 'granted' },
  };
  assert.deepEqual(chooseReadingMethod('What events are today?', app), {
    method: 'visual_page',
    scope: 'current_view',
  });
  assert.equal(canAskPage(app), true);
  assert.equal(
    canAskPage({ ...app, visual: { eligible: true, permission: 'required' } }),
    false,
  );
});

test('table questions use visual cells rather than omitted article content, preserving deterministic orders', () => {
  for (const question of [
    'What is wrong with this table?',
    'Explain these spreadsheet labels',
    'Bảng này có ô trống không?',
  ]) {
    assert.equal(chooseReadingMethod(question, article).method, 'visual_page');
  }
  assert.equal(
    chooseReadingMethod('Compare July and August in this orders table', {
      ...article,
      sourceKind: 'orders',
    }).method,
    'orders',
  );
  assert.equal(
    chooseReadingMethod('Summarise this article', article).method,
    'structured_page',
  );
});
