import type { VisualSnapshot } from '@adc/contracts';
import { VisualPageClient } from './visual-client.ts';
import type {
  VisualScope,
  VisualTaskState,
  VisualSource,
} from './visual-protocol.ts';
import {
  OrdersPageError,
  parseOrdersPageResponse,
  type OrdersPageRequest,
  type OrdersPageResponse,
} from './orders-adapter.ts';
import {
  validStructuredContext,
  type OrdersContext,
  type OrdersInvalidation,
  type PageSnapshot,
} from './page-context.ts';
import {
  parseStructuredPageResponse,
  type StructuredPageRequest,
  type StructuredPageResponse,
} from './structured-adapter.ts';
import {
  exactMessage,
  FLOATING_SURFACE_PORT,
  type FloatingEvent,
} from './floating-protocol.ts';

type Pending = {
  resolve(value: OrdersPageResponse | StructuredPageResponse): void;
  reject(error: Error): void;
  cleanup(): void;
};
export type FloatingPage = ReturnType<FloatingClient['createPage']>;
export type { FloatingEvent } from './floating-protocol.ts';

/** The frame never accepts page-window messages or chooses its own source tab. */
export class FloatingClient {
  private bound = true;
  private visualMode = false;
  private visual: VisualPageClient | null = null;
  private visualClient() {
    return (this.visual ??= new VisualPageClient(this.browser, () =>
      this.emit({ type: 'cancel' }),
    ));
  }
  private visualSource(): VisualSource {
    if (
      this.context.tabId === null ||
      this.context.windowId === null ||
      !this.context.origin ||
      !this.context.pathname ||
      !this.context.resourceKey
    )
      throw new OrdersPageError('UNAVAILABLE');
    return {
      tabId: this.context.tabId,
      windowId: this.context.windowId,
      origin: this.context.origin,
      pathname: this.context.pathname,
      resourceKey: this.context.resourceKey,
      ...(this.context.documentId
        ? { documentId: this.context.documentId }
        : {}),
    };
  }
  private setVisualMode(active: boolean) {
    this.visualMode = active;
    this.post({ type: 'floating:visual-mode', active });
  }
  private readyState = false;
  private revision = 0;
  private readonly listeners = new Set<(event: FloatingEvent) => void>();
  private readonly invalidations = new Set<
    (reason: OrdersInvalidation) => void
  >();
  private readonly pending = new Map<string, Pending>();
  private contextCheck: {
    id: string;
    promise: Promise<OrdersContext>;
    resolve(context: OrdersContext): void;
    reject(error: Error): void;
    cleanup(): void;
  } | null = null;
  private readonly consumed = new Set<string>();
  private readonly activations: Extract<FloatingEvent, { type: 'activate' }>[] =
    [];
  private resume: Extract<FloatingEvent, { type: 'resume' }> | null = null;
  private speechStatus: Extract<
    FloatingEvent,
    { type: 'speech-status' }
  > | null = null;
  private reportedSpeech: boolean | null = null;
  private documentKey: string | null = null;
  private readonly port: chrome.runtime.Port;
  private context: OrdersContext;
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
    if (reason === 'tab') this.resume = null;
    if (this.contextCheck) {
      this.contextCheck.cleanup();
      this.contextCheck.reject(new OrdersPageError('CONTEXT_CHANGED'));
      this.contextCheck = null;
    }
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
    this.visual?.dispose();
    this.visual = null;
    clearInterval(this.heartbeat);
    this.activations.length = 0;
    this.resume = null;
    this.speechStatus = null;
    this.reportedSpeech = null;
    this.invalidate('unavailable');
    this.emit({ type: 'ended' });
  };
  private receive = (value: unknown) => {
    if (!this.bound) return;
    if (
      exactMessage(value, 'floating:speech-status', ['active', 'other']) &&
      typeof value.active === 'boolean' &&
      typeof value.other === 'boolean' &&
      (value.active || !value.other)
    ) {
      this.speechStatus = {
        type: 'speech-status',
        active: value.active,
        other: value.other,
      };
      if (this.readyState) this.emit(this.speechStatus);
      return;
    }
    if (exactMessage(value, 'floating:speech-stop')) {
      this.emit({ type: 'speech-stop' });
      return;
    }
    if (
      exactMessage(value, 'floating:resume', ['expanded']) &&
      typeof value.expanded === 'boolean'
    ) {
      const event = { type: 'resume' as const, expanded: value.expanded };
      if (this.readyState) this.emit(event);
      else this.resume = event;
      return;
    }
    if (
      exactMessage(value, 'floating:context-checked', ['id', 'context']) &&
      this.contextCheck &&
      this.contextCheck.id === value.id &&
      this.validContext(value.context)
    ) {
      const check = this.contextCheck;
      this.contextCheck = null;
      check.cleanup();
      this.updateContext(value.context);
      check.resolve({ ...this.context });
      return;
    }
    if (
      exactMessage(value, 'floating:context', ['context']) &&
      this.validContext(value.context)
    ) {
      this.updateContext(value.context);
      return;
    }
    if (exactMessage(value, 'floating:ended')) {
      this.disconnected();
      return;
    }
    if (exactMessage(value, 'floating:cancel')) {
      this.resume = null;
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
    const response =
      parseOrdersPageResponse(value) ?? parseStructuredPageResponse(value);
    if (!response) return;
    if (
      response.type === 'orders:changed' ||
      response.type === 'structured:changed'
    ) {
      if (!this.visualMode || response.type !== 'structured:changed')
        this.invalidate('page');
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    pending.cleanup();
    this.pending.delete(response.id);
    if (
      response.type === 'orders:error' ||
      response.type === 'structured:error'
    )
      pending.reject(new OrdersPageError(response.code));
    else pending.resolve(response);
  };
  private validContext(value: unknown): value is OrdersContext {
    return (
      !!value &&
      typeof value === 'object' &&
      (this.context.sourceKind === 'structured_page'
        ? validStructuredContext(
            value,
            this.context.tabId ?? undefined,
            this.context.windowId ?? undefined,
          )
        : 'tabId' in value &&
          value.tabId === this.context.tabId &&
          'windowId' in value &&
          value.windowId === this.context.windowId &&
          'origin' in value &&
          'pathname' in value) &&
      'origin' in value &&
      value.origin === this.context.origin &&
      'pathname' in value &&
      value.pathname === this.context.pathname
    );
  }
  private updateContext(context: OrdersContext) {
    // A failed structured-reader probe can omit its document ID without the
    // trusted floating document being replaced. Preserve the known identity
    // for visual observations; permission metadata still updates separately.
    // Real replacement is signalled by a different ID, URL/resource, or port
    // lifetime and continues to invalidate the task.
    if (this.visualMode && this.context.documentId && !context.documentId)
      context = { ...context, documentId: this.context.documentId };
    const identity = (value: OrdersContext) => ({
      tabId: value.tabId,
      windowId: value.windowId,
      origin: value.origin,
      pathname: value.pathname,
      documentId: value.documentId,
      visual: value.visual,
      resourceKey: value.resourceKey,
    });
    const changed = this.visualMode
      ? JSON.stringify(identity(this.context)) !==
        JSON.stringify(identity(context))
      : JSON.stringify(this.context) !== JSON.stringify(context);
    this.context = context;
    if (changed) this.invalidate('page');
  }
  /** Explicit Open/Check only: reuse browser permission; never capture source text. */
  preparePage(): Promise<OrdersContext> {
    if (!this.bound) return Promise.reject(new OrdersPageError('UNAVAILABLE'));
    if (this.context.sourceKind !== 'structured_page')
      return Promise.resolve({ ...this.context });
    if (this.contextCheck) return this.contextCheck.promise;
    const id = crypto.randomUUID();
    let resolve!: (context: OrdersContext) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<OrdersContext>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const timer = setTimeout(() => {
      if (this.contextCheck?.id !== id) return;
      this.contextCheck = null;
      reject(new OrdersPageError('UNAVAILABLE'));
    }, 10_000);
    this.contextCheck = {
      id,
      promise,
      resolve,
      reject,
      cleanup: () => clearTimeout(timer),
    };
    this.post({ type: 'floating:check-page', id });
    return promise;
  }
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
    if (this.speechStatus) this.emit(this.speechStatus);
    if (this.resume) {
      const resume = this.resume;
      this.resume = null;
      this.emit(resume);
    }
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
  /** Metadata only; the player and its audio remain in their original frame. */
  reportSpeech(active: boolean) {
    if (active === this.reportedSpeech) return;
    this.reportedSpeech = active;
    this.post({ type: 'floating:speech-state', active });
  }
  stopSpeech() {
    this.post({ type: 'floating:stop-speech' });
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
    this.visual?.reset();
    this.visualMode = false;
    this.post({ type: 'floating:reset' });
    this.invalidate('unavailable');
  }
  private request(
    message: OrdersPageRequest | StructuredPageRequest,
    signal: AbortSignal,
  ): Promise<OrdersPageResponse | StructuredPageResponse> {
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
      setTaskState: (state: VisualTaskState) => {
        if (disposed || !this.bound) return;
        try {
          this.visualClient().setTaskState(this.visualSource(), state);
        } catch {
          /* Source is not available yet. */
        }
      },
      captureVisual: async (
        scope: VisualScope,
        signal: AbortSignal,
        expectedOrigin?: string,
        expectedTabId?: number,
      ) => {
        available();
        const source = this.visualSource();
        if (
          (expectedOrigin !== undefined && expectedOrigin !== source.origin) ||
          (expectedTabId !== undefined && expectedTabId !== source.tabId)
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        this.setVisualMode(true);
        const revision = this.revision;
        const result = await this.visualClient().capture(source, scope, signal);
        signal.throwIfAborted();
        available();
        if (
          revision !== this.revision ||
          result.snapshot.resource_key !== source.resourceKey
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        return result;
      },
      verifyVisual: async (snapshot: VisualSnapshot, signal: AbortSignal) => {
        if (
          disposed ||
          !this.bound ||
          snapshot.tab_id !== this.context.tabId ||
          snapshot.window_id !== this.context.windowId
        )
          return false;
        return this.visualClient().verify(snapshot, signal);
      },
      prepareContext: async (): Promise<OrdersContext> => {
        available();
        const context = await this.preparePage();
        available();
        return context;
      },
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
      ): Promise<PageSnapshot> => {
        available();
        if (this.visualMode) this.setVisualMode(false);
        if (!this.context.supported)
          throw new OrdersPageError('UNSUPPORTED_PAGE');
        if (
          expectedOrigin !== this.context.origin ||
          (expectedTabId !== undefined && expectedTabId !== this.context.tabId)
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        const revision = this.revision;
        const response = await this.request(
          this.context.sourceKind === 'structured_page'
            ? {
                type: 'structured:capture',
                id: crypto.randomUUID(),
                expected_origin: expectedOrigin,
                expected_pathname: this.context.pathname!,
                tab_id: this.context.tabId!,
                window_id: this.context.windowId!,
              }
            : {
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
          (response.type !== 'orders:result' &&
            response.type !== 'structured:result') ||
          response.snapshot.origin !== expectedOrigin ||
          response.snapshot.pathname !== this.context.pathname ||
          (response.type === 'structured:result' &&
            (response.snapshot.tab_id !== this.context.tabId ||
              response.snapshot.window_id !== this.context.windowId))
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        this.documentKey = response.snapshot.document_key;
        return response.snapshot;
      },
      verify: async (
        snapshot: PageSnapshot,
        signal: AbortSignal,
      ): Promise<boolean> => {
        if ('source_kind' in snapshot && snapshot.source_kind === 'visual_page')
          return (
            !disposed &&
            this.bound &&
            !!this.visual &&
            this.visual.verify(snapshot, signal)
          );
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
            'source_kind' in snapshot
              ? {
                  type: 'structured:verify',
                  id: crypto.randomUUID(),
                  document_key: snapshot.document_key,
                  fingerprint: snapshot.fingerprint,
                  expected_origin: snapshot.origin,
                  expected_pathname: snapshot.pathname,
                  tab_id: snapshot.tab_id,
                  window_id: snapshot.window_id,
                }
              : {
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
            (response.type === 'orders:verified' ||
              response.type === 'structured:verified') &&
            response.current
          );
        } catch {
          return false;
        }
      },
      returnToPage: async (): Promise<{ restored: boolean }> => {
        available();
        const response = await this.request(
          {
            type:
              this.context.sourceKind === 'structured_page'
                ? 'structured:focus'
                : 'orders:focus',
            id: crypto.randomUUID(),
          },
          new AbortController().signal,
        );
        available();
        if (
          response.type !== 'orders:focused' &&
          response.type !== 'structured:focused'
        )
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
        (context.sourceKind === 'structured_page'
          ? !validStructuredContext(context)
          : context.supported
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
