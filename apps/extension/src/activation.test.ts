import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ActivationBroker,
  MAX_PENDING_ACTIVATIONS,
  type Activation,
  type ActivationStore,
} from './activation.ts';

function memoryStore() {
  const pending = new Map<number, Activation[]>();
  const store: ActivationStore = {
    async read(windowId) {
      return pending.get(windowId) ?? [];
    },
    async write(windowId, activations) {
      if (activations.length) pending.set(windowId, activations);
      else pending.delete(windowId);
    },
  };
  return { store, pending };
}

test('cold activation waits for readiness, is acknowledged and is not replayed on reconnect', async () => {
  const { store, pending } = memoryStore();
  const cold = new ActivationBroker(store);
  await cold.activate(1, 'first');
  assert.equal(pending.get(1)?.[0]?.id, 'first');
  const restarted = new ActivationBroker(store);
  const delivered: string[] = [];
  await restarted.ready(1, 'panel', ({ id }) => delivered.push(id));
  assert.deepEqual(delivered, ['first']);
  await restarted.acknowledge(1, 'panel', 'first');
  await restarted.disconnect(1, 'panel');
  await restarted.ready(1, 'new-panel', ({ id }) => delivered.push(id));
  assert.deepEqual(delivered, ['first']);
  assert.equal(pending.size, 0);
});

test('an already ready panel receives commands and stale acknowledgements cannot remove new work', async () => {
  const { store, pending } = memoryStore();
  const broker = new ActivationBroker(store);
  const delivered: string[] = [];
  await broker.ready(1, 'panel', ({ id }) => delivered.push(id));
  await broker.activate(1, 'first');
  await broker.acknowledge(1, 'panel', 'first');
  await broker.activate(1, 'second');
  await broker.acknowledge(1, 'panel', 'first');
  assert.equal(pending.get(1)?.[0]?.id, 'second');
  assert.deepEqual(delivered, ['first', 'second']);
});

test('readiness racing activation delivers once and old ports cannot consume another panel command', async () => {
  const { store, pending } = memoryStore();
  const broker = new ActivationBroker(store);
  const delivered: string[] = [];
  await Promise.all([
    broker.activate(1, 'queued'),
    broker.ready(1, 'current', ({ id }) => delivered.push(id)),
  ]);
  assert.deepEqual(delivered, ['queued']);
  await broker.acknowledge(1, 'old', 'queued');
  assert.equal(pending.get(1)?.[0]?.id, 'queued');
  await broker.disconnect(1, 'old');
  await broker.acknowledge(1, 'current', 'queued');
  assert.equal(pending.size, 0);
});

test('activations stay scoped to their browser window', async () => {
  const { store } = memoryStore();
  const broker = new ActivationBroker(store);
  const delivered: string[] = [];
  await broker.ready(2, 'other-window', ({ id }) => delivered.push(id));
  await broker.activate(1, 'window-one');
  assert.equal(delivered.length, 0);
  await broker.ready(1, 'matching-window', ({ id }) => delivered.push(id));
  assert.deepEqual(delivered, ['window-one']);
});

test('failed panel opening discards only its own activation', async () => {
  const { store, pending } = memoryStore();
  const broker = new ActivationBroker(store);
  await broker.activate(1, 'current');
  await broker.discard(1, 'older');
  assert.equal(pending.get(1)?.[0]?.id, 'current');
  await broker.discard(1, 'current');
  assert.equal(pending.size, 0);
});

test('commands before acknowledgement are queued in order and each is delivered once', async () => {
  const { store, pending } = memoryStore();
  const broker = new ActivationBroker(store);
  const delivered: string[] = [];
  await broker.ready(1, 'panel', ({ id }) => delivered.push(id));
  await broker.activate(1, 'first');
  await broker.activate(1, 'second');
  assert.deepEqual(delivered, ['first']);
  assert.deepEqual(
    pending.get(1)?.map(({ id }) => id),
    ['first', 'second'],
  );
  await broker.acknowledge(1, 'panel', 'first');
  await broker.acknowledge(1, 'panel', 'first');
  assert.deepEqual(delivered, ['first', 'second']);
  await broker.acknowledge(1, 'panel', 'second');
  assert.equal(pending.size, 0);
});

test('cold reconnection preserves queued commands and only resends the unacknowledged head', async () => {
  const { store } = memoryStore();
  const cold = new ActivationBroker(store);
  await cold.activate(1, 'first');
  await cold.activate(1, 'second');
  const restarted = new ActivationBroker(store);
  const delivered: string[] = [];
  await restarted.ready(1, 'panel', ({ id }) => delivered.push(id));
  await restarted.disconnect(1, 'panel');
  await restarted.ready(1, 'reconnected', ({ id }) => delivered.push(id));
  assert.deepEqual(delivered, ['first', 'first']);
  await restarted.acknowledge(1, 'reconnected', 'first');
  assert.deepEqual(delivered, ['first', 'first', 'second']);
});

test('a bounded pending queue rejects overflow without dropping accepted commands', async () => {
  const { store, pending } = memoryStore();
  const broker = new ActivationBroker(store);
  for (let index = 0; index < MAX_PENDING_ACTIVATIONS; index++)
    await broker.activate(1, String(index));
  await assert.rejects(broker.activate(1, 'overflow'), /queue is full/);
  assert.equal(pending.get(1)?.length, MAX_PENDING_ACTIVATIONS);
  assert.equal(pending.get(1)?.[0]?.id, '0');
});
