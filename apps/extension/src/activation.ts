export interface Activation {
  id: string;
}

export interface ActivationStore {
  read(windowId: number): Promise<Activation[]>;
  write(windowId: number, activations: Activation[]): Promise<void>;
}

export const MAX_PENDING_ACTIVATIONS = 10;

// Serialising the queue prevents a newly ready panel from racing a cold-worker command.
export class ActivationBroker {
  private store: ActivationStore;
  private connections = new Map<
    number,
    {
      key: string;
      send: (activation: Activation) => void;
      lastSent: string | null;
    }
  >();
  private operations: Promise<unknown> = Promise.resolve();

  constructor(store: ActivationStore) {
    this.store = store;
  }

  private run(task: () => Promise<void>) {
    const operation = this.operations.then(task);
    this.operations = operation.catch(() => undefined);
    return operation;
  }

  private async deliver(windowId: number) {
    const pending = (await this.store.read(windowId))[0];
    const connection = this.connections.get(windowId);
    if (pending && connection && connection.lastSent !== pending.id) {
      connection.lastSent = pending.id;
      connection.send(pending);
    }
  }

  activate(windowId: number, id: string) {
    return this.run(async () => {
      const pending = await this.store.read(windowId);
      if (!pending.some((activation) => activation.id === id)) {
        if (pending.length >= MAX_PENDING_ACTIVATIONS)
          throw new Error('Voice activation queue is full.');
        await this.store.write(windowId, [...pending, { id }]);
      }
      await this.deliver(windowId);
    });
  }

  ready(windowId: number, key: string, send: (activation: Activation) => void) {
    return this.run(async () => {
      this.connections.set(windowId, { key, send, lastSent: null });
      await this.deliver(windowId);
    });
  }

  acknowledge(windowId: number, key: string, id: string) {
    return this.run(async () => {
      if (this.connections.get(windowId)?.key !== key) return;
      const pending = await this.store.read(windowId);
      if (pending[0]?.id === id) {
        await this.store.write(windowId, pending.slice(1));
        await this.deliver(windowId);
      }
    });
  }

  discard(windowId: number, id: string) {
    return this.run(async () => {
      const pending = await this.store.read(windowId);
      await this.store.write(
        windowId,
        pending.filter((activation) => activation.id !== id),
      );
      await this.deliver(windowId);
    });
  }

  disconnect(windowId: number, key: string) {
    return this.run(async () => {
      if (this.connections.get(windowId)?.key === key)
        this.connections.delete(windowId);
    });
  }
}
