import type { VisualSnapshot } from '@adc/contracts';
import { VisualPageClient } from './visual-client.ts';
import type {
  VisualScope,
  VisualTaskState,
  VisualSource,
} from './visual-protocol.ts';
import type { GroundedSnapshot, StructuredSnapshot } from '@adc/contracts';
import {
  OrdersPageError,
  parseOrdersPageResponse,
  supportedOrdersUrl,
  type OrdersPageRequest,
  type OrdersPageResponse,
} from './orders-adapter.ts';
import {
  parseStructuredPageResponse,
  type StructuredPageRequest,
  type StructuredPageResponse,
} from './structured-adapter.ts';

export type PageSnapshot =
  GroundedSnapshot | StructuredSnapshot | VisualSnapshot;
type PageRequest = OrdersPageRequest | StructuredPageRequest;
type PageResponse = OrdersPageResponse | StructuredPageResponse;

export interface OrdersContext {
  supported: boolean;
  tabId: number | null;
  windowId: number | null;
  origin: string | null;
  pathname: string | null;
  reason: 'unsupported' | 'unavailable' | 'permission_required' | null;
  title?: string;
  sourceKind?: 'orders' | 'structured_page';
  permission?: 'granted' | 'required';
  capability?: 'unchecked' | 'supported' | 'unsupported';
  documentId?: string;
  visual?: { eligible: boolean; permission: 'granted' | 'required' };
  resourceKey?: string;
}
export type PageContextInfo = OrdersContext;
export function validStructuredContext(
  value: unknown,
  tabId?: number,
  windowId?: number,
): value is OrdersContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as OrdersContext;
  if (
    context.sourceKind !== 'structured_page' ||
    typeof context.supported !== 'boolean' ||
    !Number.isInteger(context.tabId) ||
    !Number.isInteger(context.windowId) ||
    (tabId !== undefined && context.tabId !== tabId) ||
    (windowId !== undefined && context.windowId !== windowId) ||
    typeof context.origin !== 'string' ||
    typeof context.pathname !== 'string' ||
    !context.pathname.startsWith('/')
  )
    return false;
  try {
    const url = new URL(context.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== context.origin
    )
      return false;
  } catch {
    return false;
  }
  if (context.permission === 'required')
    return (
      !context.supported &&
      context.capability === 'unchecked' &&
      context.reason === 'permission_required'
    );
  return (
    context.permission === 'granted' &&
    typeof context.documentId === 'string' &&
    !!context.documentId &&
    (context.supported
      ? context.capability === 'supported' && context.reason === null
      : context.capability === 'unsupported' &&
        context.reason === 'unsupported')
  );
}
export type OrdersInvalidation = 'page' | 'tab' | 'unavailable';
type Pending = {
  resolve: (value: PageResponse) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
};

/** Session-local panel transport. It never places access tokens in page messages. */
export class OrdersPageContext {
  private readonly origins: readonly string[];
  private readonly browser: Pick<typeof chrome, 'tabs' | 'windows'> &
    Partial<Pick<typeof chrome, 'runtime'>>;
  private port: chrome.runtime.Port | null = null;
  private visual: VisualPageClient | null = null;
  private visualMode = false;
  private lastContext: OrdersContext | null = null;
  private visualClient() {
    if (!this.browser.runtime) throw new OrdersPageError('UNAVAILABLE');
    return (this.visual ??= new VisualPageClient(
      { runtime: this.browser.runtime },
      () => this.invalidate('unavailable'),
    ));
  }
  private visualSource(): VisualSource {
    const context = this.lastContext;
    if (
      !context ||
      context.tabId === null ||
      context.windowId === null ||
      !context.origin ||
      !context.pathname ||
      !context.resourceKey
    )
      throw new OrdersPageError('UNAVAILABLE');
    return {
      tabId: context.tabId,
      windowId: context.windowId,
      origin: context.origin,
      pathname: context.pathname,
      resourceKey: context.resourceKey,
      ...(context.documentId ? { documentId: context.documentId } : {}),
    };
  }
  private async rememberContext(context: OrdersContext) {
    const lookup = this.contextLookup;
    const revision = this.revision;
    if (this.browser.runtime?.sendMessage && context.tabId !== null) {
      try {
        const visual: unknown = await this.browser.runtime.sendMessage({
          type: 'visual:context',
          tabId: context.tabId,
        });
        if (
          visual &&
          typeof visual === 'object' &&
          'eligible' in visual &&
          typeof visual.eligible === 'boolean' &&
          'permission' in visual &&
          (visual.permission === 'granted' ||
            visual.permission === 'required') &&
          (!visual.eligible ||
            ('resourceKey' in visual &&
              typeof visual.resourceKey === 'string' &&
              /^[a-f0-9]{64}$/u.test(visual.resourceKey)))
        )
          context = {
            ...context,
            ...('resourceKey' in visual &&
            typeof visual.resourceKey === 'string'
              ? { resourceKey: visual.resourceKey }
              : {}),
            visual: {
              eligible: visual.eligible,
              permission: visual.permission,
            },
          };
      } catch {
        /* No capture access demonstrated. */
      }
    }
    if (
      this.disposed ||
      lookup !== this.contextLookup ||
      revision !== this.revision
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    this.lastContext = context;
    return context;
  }
  setTaskState(state: VisualTaskState) {
    try {
      this.visualClient().setTaskState(this.visualSource(), state);
    } catch {
      /* Source is not available yet. */
    }
  }
  async captureVisual(
    scope: VisualScope,
    signal: AbortSignal,
    expectedOrigin?: string,
    expectedTabId?: number,
  ) {
    const source = this.visualSource();
    if (
      (expectedOrigin !== undefined && expectedOrigin !== source.origin) ||
      (expectedTabId !== undefined && expectedTabId !== source.tabId)
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    this.visualMode = true;
    const revision = this.revision;
    const result = await this.visualClient().capture(source, scope, signal);
    signal.throwIfAborted();
    if (
      this.disposed ||
      revision !== this.revision ||
      result.snapshot.resource_key !== source.resourceKey
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    return result;
  }
  async verifyVisual(snapshot: VisualSnapshot, signal: AbortSignal) {
    return (
      !this.disposed &&
      !!this.visual &&
      (await this.visual.verify(snapshot, signal))
    );
  }
  // Observe navigation before permission/capture creates a content-script port.
  private activeTabId: number | null = null;
  private tabId: number | null = null;
  private windowId: number | null = null;
  private contextLookup = 0;
  private documentKey: string | null = null;
  private sourceKind: 'orders' | 'structured_page' = 'orders';
  private revision = 0;
  private disposed = false;
  private readonly listeners = new Set<(reason: OrdersInvalidation) => void>();
  private readonly pending = new Map<string, Pending>();

  constructor(
    origins: readonly string[],
    browser: Pick<typeof chrome, 'tabs' | 'windows'> &
      Partial<Pick<typeof chrome, 'runtime'>> = chrome,
  ) {
    this.origins = origins;
    this.browser = browser;
    browser.tabs.onActivated.addListener(this.onActivated);
    browser.tabs.onUpdated.addListener(this.onUpdated);
    browser.tabs.onRemoved.addListener(this.onRemoved);
    browser.windows.onFocusChanged?.addListener(this.onWindowFocus);
    browser.runtime?.onMessage?.addListener(this.onPermission);
  }

  private onPermission = (
    value: unknown,
    sender: chrome.runtime.MessageSender,
  ) => {
    if (
      sender.id !== this.browser.runtime?.id ||
      sender.tab ||
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      value.type !== 'structured:permission-updated' ||
      !('tabId' in value) ||
      value.tabId !== this.activeTabId
    )
      return;
    this.invalidate('page');
  };

  private onWindowFocus = (windowId: number) => {
    if (this.windowId !== null && windowId !== this.windowId)
      this.invalidate('tab');
  };

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
    // A bound top-document port disconnects when that document is replaced,
    // including a same-URL reload. Iframe loading can also change tab status;
    // it must not invalidate a captured visual moment. Without that observer,
    // retain the conservative loading-status fallback.
    if (this.visualMode && this.port && change.url === undefined) return;
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

  prepareContext(): Promise<OrdersContext> {
    return this.getContext(true);
  }

  async getContext(prepare = false): Promise<OrdersContext> {
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
      if (!parsed && tab?.id !== undefined && this.browser.runtime) {
        const value: unknown = await this.browser.runtime.sendMessage({
          type: prepare ? 'structured:prepare' : 'structured:context',
          tabId: tab.id,
        });
        if (
          this.disposed ||
          lookup !== this.contextLookup ||
          revision !== this.revision
        )
          throw new OrdersPageError('CONTEXT_CHANGED');
        if (validStructuredContext(value, tab.id, tab.windowId)) {
          if (value.permission === 'granted' && !this.port)
            this.openPort(value);
          return await this.rememberContext(value);
        }
      }
      const context: OrdersContext = {
        supported: !!parsed && tab?.id !== undefined,
        tabId: tab?.id ?? null,
        windowId: tab?.windowId ?? null,
        origin: parsed?.origin ?? null,
        pathname: parsed?.pathname ?? null,
        reason: parsed ? null : tab?.url ? 'unsupported' : 'unavailable',
        ...(parsed && typeof tab?.title === 'string'
          ? { title: tab.title.slice(0, 300) }
          : {}),
      };
      return await this.rememberContext(context);
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
    if (!this.port) this.openPort(context);
    return this.port!;
  }

  private openPort(context: OrdersContext) {
    if (context.tabId === null) throw new OrdersPageError('UNAVAILABLE');
    this.sourceKind = context.sourceKind ?? 'orders';
    this.tabId = context.tabId;
    this.port = this.browser.tabs.connect(context.tabId, {
      name:
        this.sourceKind === 'structured_page'
          ? 'structured-page'
          : 'orders-page',
      frameId: 0,
      ...(context.documentId ? { documentId: context.documentId } : {}),
    });
    const port = this.port;
    port.onMessage.addListener((value: unknown) => {
      if (this.port !== port || this.disposed) return;
      const response =
        this.sourceKind === 'structured_page'
          ? parseStructuredPageResponse(value)
          : parseOrdersPageResponse(value);
      if (!response) {
        this.invalidate('unavailable');
        return;
      }
      if (
        response.type === 'orders:changed' ||
        response.type === 'structured:changed'
      ) {
        if (this.visualMode && response.type === 'structured:changed') return;
        if (!this.documentKey || response.document_key === this.documentKey)
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
    });
    port.onDisconnect.addListener(() => {
      // Read lastError so an unavailable content script is a handled, recoverable state.
      void globalThis.chrome?.runtime?.lastError;
      if (this.port !== port) return;
      this.port = null;
      this.documentKey = null;
      this.invalidate('unavailable');
    });
    if (this.sourceKind === 'structured_page')
      this.port.postMessage({
        type: 'structured:probe',
        id: crypto.randomUUID(),
        expected_origin: context.origin,
        expected_pathname: context.pathname,
        window_id: context.windowId,
        tab_id: context.tabId,
      });
  }

  private async request(
    message: PageRequest,
    signal: AbortSignal,
    expectedTabId?: number,
  ): Promise<PageResponse> {
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
  ): Promise<PageSnapshot> {
    this.visualMode = false;
    const current = await this.getContext();
    if (!current.supported) throw new OrdersPageError('UNSUPPORTED_PAGE');
    const revision = this.revision;
    const response = await this.request(
      current.sourceKind === 'structured_page'
        ? {
            type: 'structured:capture',
            id: crypto.randomUUID(),
            expected_origin: expectedOrigin,
            expected_pathname: current.pathname!,
            window_id: current.windowId!,
            tab_id: current.tabId!,
          }
        : {
            type: 'orders:capture',
            id: crypto.randomUUID(),
            expected_origin: expectedOrigin,
          },
      signal,
      expectedTabId,
    );
    if (
      response.type !== 'orders:result' &&
      response.type !== 'structured:result'
    )
      throw new OrdersPageError('INVALID_PAGE');
    const context = await this.getContext();
    signal.throwIfAborted();
    if (
      revision !== this.revision ||
      !context.supported ||
      context.tabId !== this.tabId ||
      context.origin !== response.snapshot.origin ||
      context.pathname !== response.snapshot.pathname ||
      (response.type === 'structured:result' &&
        (response.snapshot.tab_id !== context.tabId ||
          response.snapshot.window_id !== context.windowId))
    )
      throw new OrdersPageError('CONTEXT_CHANGED');
    this.documentKey = response.snapshot.document_key;
    return response.snapshot;
  }

  async verify(snapshot: PageSnapshot, signal: AbortSignal): Promise<boolean> {
    if ('source_kind' in snapshot && snapshot.source_kind === 'visual_page')
      return this.verifyVisual(snapshot, signal);
    if (!this.port || snapshot.document_key !== this.documentKey) return false;
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
              window_id: snapshot.window_id,
              tab_id: snapshot.tab_id,
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
      const context = await this.getContext();
      return (
        revision === this.revision &&
        context.supported &&
        context.tabId === this.tabId &&
        context.origin === snapshot.origin &&
        context.pathname === snapshot.pathname &&
        (response.type === 'orders:verified' ||
          response.type === 'structured:verified') &&
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
      {
        type:
          context.sourceKind === 'structured_page'
            ? 'structured:focus'
            : 'orders:focus',
        id: crypto.randomUUID(),
      },
      new AbortController().signal,
      context.tabId,
    );
    if (
      response.type !== 'orders:focused' &&
      response.type !== 'structured:focused'
    )
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
    this.visual?.reset();
    this.visualMode = false;
    this.disconnect();
    this.invalidate('unavailable');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.visual?.dispose();
    this.visual = null;
    this.lastContext = null;
    this.listeners.clear();
    this.browser.tabs.onActivated.removeListener(this.onActivated);
    this.browser.tabs.onUpdated.removeListener(this.onUpdated);
    this.browser.tabs.onRemoved.removeListener(this.onRemoved);
    this.browser.windows.onFocusChanged?.removeListener(this.onWindowFocus);
    this.browser.runtime?.onMessage?.removeListener(this.onPermission);
  }
}
