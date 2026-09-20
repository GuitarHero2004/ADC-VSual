import type { GroundedSnapshot } from '@adc/contracts';
import {
  OrdersPageError,
  parseOrdersPageResponse,
  supportedOrdersUrl,
  type OrdersPageRequest,
  type OrdersPageResponse,
} from './orders-adapter.ts';

export interface OrdersContext {
  supported: boolean;
  tabId: number | null;
  windowId: number | null;
  origin: string | null;
  pathname: string | null;
  reason: 'unsupported' | 'unavailable' | null;
}
export type PageContextInfo = OrdersContext;
export type OrdersInvalidation = 'page' | 'tab' | 'unavailable';
type Pending = {
  resolve: (value: OrdersPageResponse) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

/** Session-local panel transport. It never places access tokens in page messages. */
export class OrdersPageContext {
  private readonly origins: readonly string[];
  private readonly browser: Pick<typeof chrome, 'tabs' | 'windows'>;
  private port: chrome.runtime.Port | null = null;
  // Observe navigation before permission/capture creates a content-script port.
  private activeTabId: number | null = null;
  private tabId: number | null = null;
  private windowId: number | null = null;
  private contextLookup = 0;
  private documentKey: string | null = null;
  private revision = 0;
  private disposed = false;
  private readonly listeners = new Set<(reason: OrdersInvalidation) => void>();
  private readonly pending = new Map<string, Pending>();

  constructor(
    origins: readonly string[],
    browser: Pick<typeof chrome, 'tabs' | 'windows'> = chrome,
  ) {
    this.origins = origins;
    this.browser = browser;
    browser.tabs.onActivated.addListener(this.onActivated);
    browser.tabs.onUpdated.addListener(this.onUpdated);
    browser.tabs.onRemoved.addListener(this.onRemoved);
  }

  private onActivated = (info: { tabId: number; windowId: number }) => {
    if (info.windowId === this.windowId && info.tabId !== this.activeTabId) {
      this.activeTabId = info.tabId;
      this.disconnect();
      this.tabId = null;
      this.invalidate('tab');
    }
  };

  private onUpdated = (
    id: number,
    change: { url?: string; status?: string },
  ) => {
    if (
      id === this.activeTabId &&
      (change.url !== undefined ||
        change.status === 'loading' ||
        change.status === 'complete')
    ) {
      this.disconnect();
      this.invalidate('page');
    }
  };

  private onRemoved = (id: number) => {
    if (id === this.activeTabId) {
      this.activeTabId = null;
      this.disconnect();
      this.tabId = null;
      this.invalidate('unavailable');
    }
  };

  private invalidate(reason: OrdersInvalidation) {
    this.revision += 1;
    for (const work of this.pending.values()) {
      work.cleanup();
      work.reject(new OrdersPageError('CONTEXT_CHANGED'));
    }
    this.pending.clear();
    for (const listener of this.listeners) listener(reason);
  }

  subscribe(listener: (reason: OrdersInvalidation) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getContext(): Promise<OrdersContext> {
    if (this.disposed) throw new OrdersPageError('UNAVAILABLE');
    const lookup = ++this.contextLookup;
    const revision = this.revision;
    try {
      const tabs = await this.browser.tabs.query({
        active: true,
        ...(this.windowId === null
          ? { currentWindow: true }
          : { windowId: this.windowId }),
      });
      const tab = tabs[0];
      if (
        this.disposed ||
        lookup !== this.contextLookup ||
        revision !== this.revision ||
        (this.windowId !== null && tab && tab.windowId !== this.windowId)
      )
        throw new OrdersPageError('UNAVAILABLE');
      this.activeTabId = tab?.id ?? null;
      this.windowId ??= tab?.windowId ?? null;
      const parsed = tab?.url
        ? supportedOrdersUrl(tab.url, this.origins)
        : null;
      return {
        supported: !!parsed && tab?.id !== undefined,
        tabId: tab?.id ?? null,
        windowId: tab?.windowId ?? null,
        origin: parsed?.origin ?? null,
        pathname: parsed?.pathname ?? null,
        reason: parsed ? null : tab?.url ? 'unsupported' : 'unavailable',
      };
    } catch {
      return {
        supported: false,
        tabId: null,
        windowId: null,
        origin: null,
        pathname: null,
        reason: 'unavailable',
      };
    }
  }

  private async connect(
    signal: AbortSignal,
    expected?: { origin?: string; tabId?: number },
  ) {
    signal.throwIfAborted();
    const before = this.revision;
    const context = await this.getContext();
    signal.throwIfAborted();
    if (before !== this.revision) throw new OrdersPageError('CONTEXT_CHANGED');
    if (!context.supported || context.tabId === null)
      throw new OrdersPageError('UNSUPPORTED_PAGE');
    if (
      expected &&
      ((expected.origin !== undefined && context.origin !== expected.origin) ||
        (expected.tabId !== undefined && context.tabId !== expected.tabId))
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    if (this.port && this.tabId !== context.tabId) {
      this.disconnect();
      this.invalidate('tab');
      throw new OrdersPageError('CONTEXT_CHANGED');
    }
    if (!this.port) {
      this.tabId = context.tabId;
      this.port = this.browser.tabs.connect(context.tabId, {
        name: 'orders-page',
        frameId: 0,
      });
      const port = this.port;
      port.onMessage.addListener((value: unknown) => {
        if (this.port !== port || this.disposed) return;
        const response = parseOrdersPageResponse(value);
        if (!response) {
          this.invalidate('unavailable');
          return;
        }
        if (response.type === 'orders:changed') {
          if (!this.documentKey || response.document_key === this.documentKey)
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
      });
      port.onDisconnect.addListener(() => {
        // Read lastError so an unavailable content script is a handled, recoverable state.
        void globalThis.chrome?.runtime?.lastError;
        if (this.port !== port) return;
        this.port = null;
        this.documentKey = null;
        this.invalidate('unavailable');
      });
    }
    return this.port;
  }

  private async request(
    message: OrdersPageRequest,
    signal: AbortSignal,
    expectedTabId?: number,
  ): Promise<OrdersPageResponse> {
    const port = await this.connect(
      signal,
      'expected_origin' in message || expectedTabId !== undefined
        ? {
            ...('expected_origin' in message
              ? { origin: message.expected_origin }
              : {}),
            ...(expectedTabId !== undefined ? { tabId: expectedTabId } : {}),
          }
        : undefined,
    );
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        cleanup();
        this.pending.delete(message.id);
        reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        this.pending.delete(message.id);
        reject(new OrdersPageError('UNAVAILABLE'));
      }, 5000);
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
      };
      this.pending.set(message.id, { resolve, reject, cleanup });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        port.postMessage(message);
      } catch {
        cleanup();
        this.pending.delete(message.id);
        reject(new OrdersPageError('UNAVAILABLE'));
      }
    });
  }

  async capture(
    signal: AbortSignal,
    expectedOrigin: string,
    expectedTabId?: number,
  ): Promise<GroundedSnapshot> {
    const revision = this.revision;
    const response = await this.request(
      {
        type: 'orders:capture',
        id: crypto.randomUUID(),
        expected_origin: expectedOrigin,
      },
      signal,
      expectedTabId,
    );
    if (response.type !== 'orders:result')
      throw new OrdersPageError('INVALID_PAGE');
    const context = await this.getContext();
    signal.throwIfAborted();
    if (
      revision !== this.revision ||
      !context.supported ||
      context.tabId !== this.tabId ||
      context.origin !== response.snapshot.origin ||
      context.pathname !== response.snapshot.pathname
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    this.documentKey = response.snapshot.document_key;
    return response.snapshot;
  }

  async verify(
    snapshot: GroundedSnapshot,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (!this.port || snapshot.document_key !== this.documentKey) return false;
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
      const context = await this.getContext();
      return (
        revision === this.revision &&
        context.supported &&
        context.tabId === this.tabId &&
        context.origin === snapshot.origin &&
        context.pathname === snapshot.pathname &&
        response.type === 'orders:verified' &&
        response.current &&
        !signal.aborted
      );
    } catch {
      return false;
    }
  }

  async returnToPage(): Promise<{ restored: boolean }> {
    const sourceTabId = this.tabId;
    const context = await this.getContext();
    if (
      !context.supported ||
      context.tabId === null ||
      context.windowId === null ||
      (sourceTabId !== null && sourceTabId !== context.tabId)
    )
      throw new OrdersPageError('UNAVAILABLE');
    await this.browser.tabs.update(context.tabId, { active: true });
    await this.browser.windows.update(context.windowId, { focused: true });
    const response = await this.request(
      { type: 'orders:focus', id: crypto.randomUUID() },
      new AbortController().signal,
      context.tabId,
    );
    if (response.type !== 'orders:focused')
      throw new OrdersPageError('UNAVAILABLE');
    return { restored: response.restored };
  }

  private disconnect() {
    const port = this.port;
    this.port = null;
    this.documentKey = null;
    port?.disconnect();
  }

  reset() {
    this.disconnect();
    this.invalidate('unavailable');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.listeners.clear();
    this.browser.tabs.onActivated.removeListener(this.onActivated);
    this.browser.tabs.onUpdated.removeListener(this.onUpdated);
    this.browser.tabs.onRemoved.removeListener(this.onRemoved);
  }
}
