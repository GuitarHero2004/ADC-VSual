import type { GroundedSnapshot } from '@adc/contracts';
import {
  OrdersPageError,
  parseOrdersPageResponse,
  type OrdersPageRequest,
  type OrdersPageResponse,
} from './orders-adapter.ts';
import type { OrdersContext, OrdersInvalidation } from './page-context.ts';
import {
  exactMessage,
  FLOATING_SURFACE_PORT,
  type FloatingEvent,
} from './floating-protocol.ts';

type Pending = {
  resolve(value: OrdersPageResponse): void;
  reject(error: Error): void;
  cleanup(): void;
};
export type FloatingPage = ReturnType<FloatingClient['createPage']>;
export type { FloatingEvent } from './floating-protocol.ts';

/** The frame never accepts page-window messages or chooses its own source tab. */
export class FloatingClient {
  private bound = true;
  private readyState = false;
  private revision = 0;
  private readonly listeners = new Set<(event: FloatingEvent) => void>();
  private readonly invalidations = new Set<
    (reason: OrdersInvalidation) => void
  >();
  private readonly pending = new Map<string, Pending>();
  private readonly consumed = new Set<string>();
  private readonly activations: Extract<FloatingEvent, { type: 'activate' }>[] =
    [];
  private documentKey: string | null = null;
  private readonly port: chrome.runtime.Port;
  private readonly context: OrdersContext;
  private readonly browser: typeof chrome;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(
    port: chrome.runtime.Port,
    context: OrdersContext,
    browser: typeof chrome = chrome,
  ) {
    this.port = port;
    this.context = context;
    this.browser = browser;
    port.onMessage.addListener(this.receive);
    port.onDisconnect.addListener(this.disconnected);
    // A connected MV3 port alone does not preserve the worker. Retain only
    // this mounted UI's ephemeral binding; closing it releases the worker.
    this.heartbeat = setInterval(
      () => this.post({ type: 'floating:alive' }),
      20_000,
    );
  }
  private emit(event: FloatingEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private invalidate(reason: OrdersInvalidation) {
    this.revision++;
    this.documentKey = null;
    for (const work of this.pending.values()) {
      work.cleanup();
      work.reject(new OrdersPageError('CONTEXT_CHANGED'));
    }
    this.pending.clear();
    for (const listener of this.invalidations) listener(reason);
  }
  private disconnected = () => {
    void this.browser.runtime.lastError;
    if (!this.bound) return;
    this.bound = false;
    clearInterval(this.heartbeat);
    this.activations.length = 0;
    this.invalidate('unavailable');
    this.emit({ type: 'ended' });
  };
  private receive = (value: unknown) => {
    if (!this.bound) return;
    if (exactMessage(value, 'floating:ended')) {
      this.disconnected();
      return;
    }
    if (exactMessage(value, 'floating:cancel')) {
      this.emit({ type: 'cancel' });
      return;
    }
    if (
      exactMessage(value, 'floating:invalidated', ['reason']) &&
      ['page', 'tab', 'unavailable'].includes(String(value.reason))
    ) {
      this.invalidate(value.reason as OrdersInvalidation);
      return;
    }
    if (
      exactMessage(value, 'floating:activate', ['id', 'record']) &&
      typeof value.id === 'string' &&
      value.id.length <= 100 &&
      typeof value.record === 'boolean'
    ) {
      if (this.consumed.has(value.id)) return;
      this.consumed.add(value.id);
      if (this.consumed.size > 100)
        this.consumed.delete(this.consumed.values().next().value!);
      const event = {
        type: 'activate' as const,
        id: value.id,
        record: value.record,
      };
      if (this.readyState) this.emit(event);
      else this.activations.push(event);
      return;
    }
    const response = parseOrdersPageResponse(value);
    if (!response) return;
    if (response.type === 'orders:changed') {
      this.invalidate('page');
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    pending.cleanup();
    this.pending.delete(response.id);
    if (response.type === 'orders:error')
      pending.reject(new OrdersPageError(response.code));
    else pending.resolve(response);
  };
  private post(value: unknown) {
    if (!this.bound) return;
    try {
      this.port.postMessage(value);
    } catch {
      this.disconnected();
    }
  }
  isBound() {
    return this.bound;
  }
  subscribe(listener: (event: FloatingEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  ready() {
    if (!this.bound) return;
    this.readyState = true;
    this.post({ type: 'floating:ready' });
    for (const activation of this.activations.splice(0)) this.emit(activation);
  }
  layout(expanded: boolean, height?: number, launcher = false, width?: number) {
    const useLauncher = launcher && !expanded;
    this.post({
      type: 'floating:layout',
      expanded,
      ...(height !== undefined && Number.isFinite(height)
        ? { height: Math.min(700, Math.max(44, Math.ceil(height))) }
        : {}),
      ...(useLauncher ? { launcher: true } : {}),
      ...(useLauncher && width !== undefined && Number.isFinite(width)
        ? { width: Math.min(480, Math.max(44, Math.ceil(width))) }
        : {}),
    });
  }
  claim() {
    this.post({ type: 'floating:claim' });
  }
  close() {
    this.post({ type: 'floating:close' });
    this.disconnected();
    // Worker revokes the document before disconnecting; allow its close message to arrive.
  }
  openSidePanel(): Promise<boolean> {
    if (!this.bound || this.context.windowId === null)
      return Promise.resolve(false);
    // Preserve the iframe button's browser gesture, before asynchronous messaging.
    let opening: Promise<void>;
    try {
      opening = this.browser.sidePanel.open({
        windowId: this.context.windowId,
      });
    } catch {
      return Promise.resolve(false);
    }
    this.emit({ type: 'cancel' });
    this.reset();
    return opening
      .then(() => {
        this.close();
        return true;
      })
      .catch(() => false);
  }
  dispose() {
    this.disconnected();
    this.port.onMessage.removeListener(this.receive);
    this.port.onDisconnect.removeListener(this.disconnected);
    this.port.disconnect();
    this.listeners.clear();
    this.invalidations.clear();
  }
  private reset() {
    this.post({ type: 'floating:reset' });
    this.invalidate('unavailable');
  }
  private request(
    message: OrdersPageRequest,
    signal: AbortSignal,
  ): Promise<OrdersPageResponse> {
    signal.throwIfAborted();
    if (!this.bound) return Promise.reject(new OrdersPageError('UNAVAILABLE'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        this.pending.delete(message.id);
        reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        cleanup();
        this.pending.delete(message.id);
        reject(new OrdersPageError('UNAVAILABLE'));
      }, 5000);
      this.pending.set(message.id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      this.post(message);
    });
  }
  createPage() {
    let disposed = false;
    const subscriptions = new Set<(reason: OrdersInvalidation) => void>();
    const available = () => {
      if (disposed || !this.bound) throw new OrdersPageError('UNAVAILABLE');
    };
    return {
      getContext: async (): Promise<OrdersContext> => {
        if (disposed || !this.bound)
          return {
            supported: false,
            tabId: null,
            windowId: null,
            origin: null,
            pathname: null,
            reason: 'unavailable',
          };
        return { ...this.context };
      },
      capture: async (
        signal: AbortSignal,
        expectedOrigin: string,
        expectedTabId?: number,
      ): Promise<GroundedSnapshot> => {
        available();
        if (!this.context.supported)
          throw new OrdersPageError('UNSUPPORTED_PAGE');
        if (
          expectedOrigin !== this.context.origin ||
          (expectedTabId !== undefined && expectedTabId !== this.context.tabId)
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        const revision = this.revision;
        const response = await this.request(
          {
            type: 'orders:capture',
            id: crypto.randomUUID(),
            expected_origin: expectedOrigin,
          },
          signal,
        );
        signal.throwIfAborted();
        available();
        if (
          revision !== this.revision ||
          response.type !== 'orders:result' ||
          response.snapshot.origin !== expectedOrigin ||
          response.snapshot.pathname !== this.context.pathname
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        this.documentKey = response.snapshot.document_key;
        return response.snapshot;
      },
      verify: async (
        snapshot: GroundedSnapshot,
        signal: AbortSignal,
      ): Promise<boolean> => {
        if (
          disposed ||
          !this.bound ||
          !this.context.supported ||
          snapshot.document_key !== this.documentKey ||
          snapshot.origin !== this.context.origin
        )
          return false;
        const revision = this.revision;
        try {
          const response = await this.request(
            {
              type: 'orders:verify',
              id: crypto.randomUUID(),
              document_key: snapshot.document_key,
              fingerprint: snapshot.fingerprint,
              expected_origin: snapshot.origin,
            },
            signal,
          );
          return (
            !disposed &&
            this.bound &&
            revision === this.revision &&
            !signal.aborted &&
            response.type === 'orders:verified' &&
            response.current
          );
        } catch {
          return false;
        }
      },
      returnToPage: async (): Promise<{ restored: boolean }> => {
        available();
        const response = await this.request(
          { type: 'orders:focus', id: crypto.randomUUID() },
          new AbortController().signal,
        );
        available();
        if (response.type !== 'orders:focused')
          throw new OrdersPageError('UNAVAILABLE');
        return { restored: response.restored };
      },
      subscribe: (listener: (reason: OrdersInvalidation) => void) => {
        subscriptions.add(listener);
        this.invalidations.add(listener);
        return () => {
          subscriptions.delete(listener);
          this.invalidations.delete(listener);
        };
      },
      reset: () => {
        if (!disposed) this.reset();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        for (const listener of subscriptions)
          this.invalidations.delete(listener);
        subscriptions.clear();
        this.reset();
      },
    };
  }
}

export function connectFloating(
  browser: typeof chrome = chrome,
): Promise<FloatingClient> {
  const port = browser.runtime.connect({ name: FLOATING_SURFACE_PORT });
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(ended);
    };
    const ended = () => {
      void browser.runtime.lastError;
      cleanup();
      reject(new OrdersPageError('UNAVAILABLE'));
    };
    const receive = (value: unknown) => {
      if (
        !exactMessage(value, 'floating:bound', ['context']) ||
        !value.context ||
        typeof value.context !== 'object'
      )
        return;
      const context = value.context as OrdersContext;
      if (
        typeof context.supported !== 'boolean' ||
        !Number.isInteger(context.tabId) ||
        !Number.isInteger(context.windowId) ||
        typeof context.origin !== 'string' ||
        typeof context.pathname !== 'string' ||
        !context.pathname.startsWith('/') ||
        (context.supported
          ? context.pathname !== '/orders' || context.reason !== null
          : context.reason !== 'unsupported')
      )
        return;
      try {
        const origin = new URL(context.origin);
        if (
          !['http:', 'https:'].includes(origin.protocol) ||
          origin.origin !== context.origin
        )
          return;
      } catch {
        return;
      }
      cleanup();
      resolve(new FloatingClient(port, context, browser));
    };
    const timer = setTimeout(() => {
      cleanup();
      port.disconnect();
      reject(new OrdersPageError('UNAVAILABLE'));
    }, 5000);
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(ended);
  });
}
