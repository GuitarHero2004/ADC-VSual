import { floatingPageUrl } from './config-values.ts';
import { exactMessage } from './floating-protocol.ts';
import type { OrdersContext } from './page-context.ts';
import { parseStructuredPageResponse } from './structured-adapter.ts';

type Grant = {
  tabId: number;
  windowId: number;
  documentId: string;
  url: string;
};
const grantKey = (tabId: number) => `structured-page-grant:${tabId}`;

export function structuredContext(
  tab: chrome.tabs.Tab,
  grant?: Grant,
  supported = false,
): OrdersContext {
  const url = tab.url ? floatingPageUrl(tab.url) : null;
  return {
    supported: !!grant && supported,
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    origin: url?.origin ?? null,
    pathname: url?.pathname ?? null,
    reason: !url
      ? 'unavailable'
      : !grant
        ? 'permission_required'
        : supported
          ? null
          : 'unsupported',
    sourceKind: 'structured_page',
    permission: grant ? 'granted' : 'required',
    capability: !grant ? 'unchecked' : supported ? 'supported' : 'unsupported',
    ...(grant ? { documentId: grant.documentId } : {}),
    ...(url && typeof tab.title === 'string'
      ? { title: tab.title.slice(0, 300) }
      : {}),
  };
}

/** Browser activation or an explicit check can reuse access that Chrome already permits. */
export class StructuredPageAccess {
  private readonly browser: typeof chrome;
  private readonly generations = new Map<number, number>();
  private readonly activations = new Map<number, Promise<OrdersContext>>();
  constructor(browser: typeof chrome = chrome) {
    this.browser = browser;
  }

  async invalidate(tabId: number) {
    this.generations.set(tabId, (this.generations.get(tabId) ?? 0) + 1);
    await this.browser.storage.session.remove(grantKey(tabId));
  }

  private async read(tab: chrome.tabs.Tab): Promise<Grant | null> {
    if (tab.id === undefined || !tab.url) return null;
    const value: unknown = (
      await this.browser.storage.session.get(grantKey(tab.id))
    )[grantKey(tab.id)];
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const grant = value as Partial<Grant>;
    if (
      grant.tabId !== tab.id ||
      grant.windowId !== tab.windowId ||
      grant.url !== tab.url ||
      typeof grant.documentId !== 'string' ||
      !grant.documentId ||
      Object.keys(value).length !== 4
    )
      return null;
    return grant as Grant;
  }

  async context(
    tab: chrome.tabs.Tab,
    expectedDocumentId?: string,
  ): Promise<OrdersContext> {
    const grant = await this.read(tab);
    if (
      !grant ||
      (expectedDocumentId && grant.documentId !== expectedDocumentId)
    )
      return structuredContext(tab);
    try {
      const supported = await this.probe(grant);
      return structuredContext(tab, grant, supported);
    } catch {
      return structuredContext(tab);
    }
  }

  activate(tab: chrome.tabs.Tab): Promise<OrdersContext> {
    return this.activateDocument(tab);
  }

  /** Never requests browser permission. Called only for a deliberate companion action. */
  async prepare(
    tab: chrome.tabs.Tab,
    expectedDocumentId?: string,
  ): Promise<OrdersContext> {
    const url = tab.url ? floatingPageUrl(tab.url) : null;
    if (tab.id === undefined || !url) return structuredContext(tab);
    const generation = this.generations.get(tab.id) ?? 0;
    const currentTab = async () => {
      const current = await this.browser.tabs.get(tab.id!);
      return current.active &&
        current.url === tab.url &&
        current.windowId === tab.windowId &&
        generation === (this.generations.get(tab.id!) ?? 0)
        ? current
        : null;
    };
    try {
      if (!(await currentTab())) return structuredContext(tab);
      const previous = await this.context(tab, expectedDocumentId);
      if (!(await currentTab())) return structuredContext(tab);
      if (previous.permission === 'granted') return previous;
      const permitted = await this.browser.permissions.contains({
        origins: [`${url.protocol}//${url.hostname}/*`],
      });
      const current = await currentTab();
      if (!permitted || !current) return structuredContext(tab);
      return this.activateDocument(current, expectedDocumentId);
    } catch {
      return structuredContext(tab);
    }
  }

  private activateDocument(
    tab: chrome.tabs.Tab,
    expectedDocumentId?: string,
  ): Promise<OrdersContext> {
    if (tab.id === undefined || !tab.url || !floatingPageUrl(tab.url))
      return Promise.resolve(structuredContext(tab));
    const pending = this.activations.get(tab.id);
    if (pending)
      return pending.then((context) =>
        expectedDocumentId && context.documentId !== expectedDocumentId
          ? structuredContext(tab)
          : context,
      );
    const task = this.grant(tab, expectedDocumentId).finally(() => {
      if (this.activations.get(tab.id!) === task)
        this.activations.delete(tab.id!);
    });
    this.activations.set(tab.id, task);
    return task;
  }

  private async grant(
    tab: chrome.tabs.Tab,
    expectedDocumentId?: string,
  ): Promise<OrdersContext> {
    const tabId = tab.id!;
    const generation = this.generations.get(tabId) ?? 0;
    try {
      const previous = await this.context(tab, expectedDocumentId);
      if (previous.permission === 'granted') return previous;
      const results = await this.browser.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: ['structured-content.js'],
      });
      const documentId = results.find(
        (result) => result.frameId === 0,
      )?.documentId;
      const current = await this.browser.tabs.get(tabId);
      if (
        !documentId ||
        (expectedDocumentId !== undefined &&
          documentId !== expectedDocumentId) ||
        current.url !== tab.url ||
        current.windowId !== tab.windowId ||
        !current.active ||
        generation !== (this.generations.get(tabId) ?? 0)
      )
        return structuredContext(current);
      const grant: Grant = {
        tabId,
        windowId: current.windowId,
        documentId,
        url: current.url!,
      };
      const supported = await this.probe(grant);
      if (generation !== (this.generations.get(tabId) ?? 0))
        return structuredContext(current);
      await this.browser.storage.session.set({ [grantKey(tabId)]: grant });
      if (generation !== (this.generations.get(tabId) ?? 0)) {
        await this.browser.storage.session.remove(grantKey(tabId));
        return structuredContext(current);
      }
      void this.browser.runtime
        .sendMessage?.({ type: 'structured:permission-updated', tabId })
        .catch(() => undefined);
      return structuredContext(current, grant, supported);
    } catch {
      return structuredContext(tab);
    }
  }

  private probe(grant: Grant): Promise<boolean> {
    const port = this.browser.tabs.connect(grant.tabId, {
      name: 'structured-page',
      frameId: 0,
      documentId: grant.documentId,
    });
    const id = crypto.randomUUID();
    const url = new URL(grant.url);
    return new Promise((resolve, reject) => {
      const finish = (supported?: boolean) => {
        clearTimeout(timer);
        port.onMessage.removeListener(receive);
        port.onDisconnect.removeListener(disconnected);
        port.disconnect();
        if (supported === undefined)
          reject(new Error('Page access unavailable'));
        else resolve(supported);
      };
      const receive = (value: unknown) => {
        const response = parseStructuredPageResponse(value);
        if (!response || !('id' in response) || response.id !== id) return;
        finish(
          response.type === 'structured:capability'
            ? response.supported
            : undefined,
        );
      };
      const disconnected = () => {
        void this.browser.runtime.lastError;
        finish();
      };
      const timer = setTimeout(() => finish(), 5000);
      port.onMessage.addListener(receive);
      port.onDisconnect.addListener(disconnected);
      port.postMessage({
        type: 'structured:probe',
        id,
        expected_origin: url.origin,
        expected_pathname: url.pathname,
        tab_id: grant.tabId,
        window_id: grant.windowId,
      });
    });
  }
}

export function installStructuredContextMessages(
  access: StructuredPageAccess,
  browser: typeof chrome = chrome,
) {
  browser.runtime.onMessage.addListener((value: unknown, sender, reply) => {
    const prepare = exactMessage(value, 'structured:prepare', ['tabId']);
    if (
      (!prepare && !exactMessage(value, 'structured:context', ['tabId'])) ||
      !Number.isInteger(value.tabId) ||
      (value.tabId as number) < 0 ||
      sender.id !== browser.runtime.id ||
      sender.tab ||
      sender.url !== browser.runtime.getURL('index.html')
    )
      return false;
    void browser.tabs
      .get(value.tabId as number)
      .then(async (tab) => {
        if (!tab.active) return null;
        return prepare ? access.prepare(tab) : access.context(tab);
      })
      .then(reply, () => reply(null));
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void access.invalidate(tabId);
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined) void access.invalidate(tabId);
  });
}
