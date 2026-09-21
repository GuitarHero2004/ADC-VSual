import {
  parseOrdersPageRequest,
  parseOrdersPageResponse,
  supportedOrdersUrl,
  type OrdersPageRequest,
} from './orders-adapter.ts';
import type { OrdersContext } from './page-context.ts';
import { floatingPageUrl } from './config-values.ts';
import {
  exactMessage,
  FLOATING_HOST_PORT,
  FLOATING_SURFACE_PORT,
  floatingBootPattern,
  parseFloatingHostCommand,
  type FloatingHostCommand,
  type FloatingSurfaceMessage,
} from './floating-protocol.ts';

type Host = {
  port: chrome.runtime.Port;
  tabId: number;
  windowId: number;
  documentId: string;
  url: string;
  context: OrdersContext;
  boot: string | null;
  frame: chrome.runtime.Port | null;
  frameId: number | null;
  frameDocumentId: string | null;
  ready: boolean;
  ended: boolean;
  dismissed: boolean;
  pending: { id: string; record: boolean }[];
  source: chrome.runtime.Port | null;
  requests: Set<string>;
};

/** Browser metadata binds each frame to one live top-level web document. */
export function installFloatingWorker(
  origins: readonly string[],
  browser: typeof chrome = chrome,
  authOrigin?: string | null,
  onFrameRemoved?: (sender: chrome.runtime.MessageSender) => void,
) {
  const hosts = new Map<number, Host>();
  const extensionId = browser.runtime.id;
  const sendHost = (host: Host, message: FloatingHostCommand) => {
    try {
      host.port.postMessage(message);
    } catch {
      end(host);
    }
  };
  const sendFrame = (host: Host, message: FloatingSurfaceMessage) => {
    try {
      host.frame?.postMessage(message);
    } catch {
      end(host);
    }
  };
  const stopSource = (host: Host) => {
    const source = host.source;
    host.source = null;
    host.requests.clear();
    source?.disconnect();
  };
  function end(host: Host) {
    if (host.ended) return;
    host.ended = true;
    if (hosts.get(host.tabId) === host) hosts.delete(host.tabId);
    host.pending = [];
    stopSource(host);
    if (host.frame?.sender) onFrameRemoved?.(host.frame.sender);
    sendFrame(host, { type: 'floating:ended' });
    host.frame?.disconnect();
    host.port.disconnect();
  }
  function deliver(host: Host) {
    if (!host.ready || host.ended) return;
    for (const activation of host.pending.splice(0))
      sendFrame(host, { type: 'floating:activate', ...activation });
  }
  function dismiss(host: Host) {
    const frame = host.frame;
    if (frame?.sender) onFrameRemoved?.(frame.sender);
    host.frame = null;
    host.frameId = null;
    host.frameDocumentId = null;
    host.boot = null;
    host.ready = false;
    host.dismissed = true;
    host.pending = [];
    stopSource(host);
    // Revoke before notifying the host; old documents cannot request credentials.
    frame?.disconnect();
    sendHost(host, { type: 'floating:remove' });
  }
  function validFrame(
    sender: chrome.runtime.MessageSender | undefined,
    host: Host,
  ) {
    if (
      !sender ||
      host.ended ||
      host.dismissed ||
      !host.boot ||
      sender.id !== extensionId ||
      sender.tab?.id !== host.tabId ||
      sender.tab.windowId !== host.windowId ||
      !Number.isInteger(sender.frameId) ||
      sender.frameId! <= 0 ||
      !sender.documentId ||
      (sender.documentLifecycle && sender.documentLifecycle !== 'active')
    )
      return false;
    try {
      const url = new URL(sender.url ?? '');
      return (
        url.protocol === 'chrome-extension:' &&
        url.host === extensionId &&
        url.pathname === '/floating.html' &&
        !url.search &&
        url.hash === `#${host.boot}` &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  const trusted = (sender: chrome.runtime.MessageSender) => {
    const host =
      sender.tab?.id === undefined ? undefined : hosts.get(sender.tab.id);
    return (
      !!host &&
      !!host.frame &&
      validFrame(sender, host) &&
      sender.frameId === host.frameId &&
      sender.documentId === host.frameDocumentId
    );
  };
  async function relay(host: Host, request: OrdersPageRequest) {
    if (host.ended || !host.frame || host.requests.size >= 8) return;
    if (!host.context.supported) {
      sendFrame(host, {
        type: 'orders:error',
        id: request.id,
        code: 'UNSUPPORTED_PAGE',
      });
      return;
    }
    if (
      'expected_origin' in request &&
      request.expected_origin !== host.context.origin
    )
      return;
    host.requests.add(request.id);
    try {
      const tab = await browser.tabs.get(host.tabId);
      const url = tab.url ? supportedOrdersUrl(tab.url, origins) : null;
      if (host.ended || !host.requests.has(request.id)) return;
      if (
        !url ||
        url.href !== host.url ||
        url.origin !== host.context.origin ||
        tab.windowId !== host.windowId ||
        !tab.active
      ) {
        end(host);
        return;
      }
      if (!host.source) {
        const source = browser.tabs.connect(host.tabId, {
          name: 'orders-page',
          frameId: 0,
          documentId: host.documentId,
        });
        host.source = source;
        source.onMessage.addListener((value: unknown) => {
          if (host.ended || host.source !== source) return;
          const response = parseOrdersPageResponse(value);
          if (!response) {
            stopSource(host);
            sendFrame(host, {
              type: 'floating:invalidated',
              reason: 'unavailable',
            });
            return;
          }
          if (response.type === 'orders:changed') {
            host.requests.clear();
            sendFrame(host, response);
          } else if (host.requests.delete(response.id))
            sendFrame(host, response);
        });
        source.onDisconnect.addListener(() => {
          void browser.runtime.lastError;
          if (host.source !== source || host.ended) return;
          stopSource(host);
          sendFrame(host, {
            type: 'floating:invalidated',
            reason: 'unavailable',
          });
        });
      }
      if (request.type === 'orders:focus') {
        await browser.tabs.update(host.tabId, { active: true });
        await browser.windows.update(host.windowId, { focused: true });
        if (host.ended || !host.requests.has(request.id)) return;
      }
      host.source?.postMessage(request);
    } catch {
      if (host.requests.delete(request.id))
        sendFrame(host, {
          type: 'orders:error',
          id: request.id,
          code: 'UNAVAILABLE',
        });
    }
  }
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === FLOATING_HOST_PORT) {
      const sender = port.sender;
      const url = sender?.url ? floatingPageUrl(sender.url, authOrigin) : null;
      if (
        sender?.id !== extensionId ||
        sender.frameId !== 0 ||
        sender.tab?.id === undefined ||
        sender.tab.windowId === undefined ||
        !sender.documentId ||
        !url ||
        (sender.documentLifecycle && sender.documentLifecycle !== 'active')
      ) {
        port.disconnect();
        return;
      }
      const old = hosts.get(sender.tab.id);
      if (old) end(old);
      const host: Host = {
        port,
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        documentId: sender.documentId,
        url: url.href,
        boot: null,
        frame: null,
        frameId: null,
        frameDocumentId: null,
        ready: false,
        ended: false,
        dismissed: false,
        pending: [],
        source: null,
        requests: new Set(),
        context: {
          supported: !!supportedOrdersUrl(url.href, origins),
          tabId: sender.tab.id,
          windowId: sender.tab.windowId,
          origin: url.origin,
          pathname: url.pathname,
          reason: supportedOrdersUrl(url.href, origins) ? null : 'unsupported',
          ...(supportedOrdersUrl(url.href, origins) &&
          typeof sender.tab.title === 'string'
            ? { title: sender.tab.title.slice(0, 300) }
            : {}),
        },
      };
      hosts.set(host.tabId, host);
      port.onMessage.addListener((value: unknown) => {
        if (host.ended) return;
        if (
          (exactMessage(value, 'floating:host-ready', ['boot']) ||
            (exactMessage(value, 'floating:host-ready', [
              'boot',
              'dismissed',
            ]) &&
              typeof value.dismissed === 'boolean')) &&
          typeof value.boot === 'string' &&
          floatingBootPattern.test(value.boot) &&
          !host.boot
        ) {
          host.boot = value.boot;
          if (typeof value.dismissed === 'boolean')
            host.dismissed = value.dismissed;
          sendHost(host, { type: 'floating:registered' });
          if (!host.dismissed || host.pending.length)
            sendHost(host, { type: 'floating:mount' });
        } else if (exactMessage(value, 'floating:host-ended')) end(host);
      });
      port.onDisconnect.addListener(() => {
        void browser.runtime.lastError;
        end(host);
      });
      return;
    }
    if (port.name !== FLOATING_SURFACE_PORT) return;
    const sender = port.sender;
    const host =
      sender?.tab?.id === undefined ? undefined : hosts.get(sender.tab.id);
    if (!host || host.frame || !validFrame(sender, host)) {
      port.disconnect();
      return;
    }
    host.frame = port;
    host.frameId = sender!.frameId!;
    host.frameDocumentId = sender!.documentId!;
    port.onMessage.addListener((value: unknown) => {
      if (host.ended || host.frame !== port) return;
      if (exactMessage(value, 'floating:alive')) {
        // Runtime traffic keeps this live UI's in-memory binding available.
        // It never reads the source page, changes auth, or invokes a provider.
        return;
      } else if (exactMessage(value, 'floating:ready')) {
        host.ready = true;
        deliver(host);
      } else if (parseFloatingHostCommand(value)?.type === 'floating:layout')
        sendHost(host, parseFloatingHostCommand(value)!);
      else if (exactMessage(value, 'floating:reset')) stopSource(host);
      else if (exactMessage(value, 'floating:close')) {
        sendHost(host, { type: 'floating:focus-page' });
        dismiss(host);
      } else if (exactMessage(value, 'floating:claim')) {
        for (const other of hosts.values())
          if (other !== host) sendFrame(other, { type: 'floating:cancel' });
      } else {
        const request = parseOrdersPageRequest(value);
        if (request) void relay(host, request);
      }
    });
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      if (!host.ended && host.frame === port) dismiss(host);
    });
    sendFrame(host, { type: 'floating:bound', context: host.context });
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    const host = hosts.get(tabId);
    if (host) end(host);
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    const host = hosts.get(tabId);
    // Iframe navigation also changes a tab's loading status. The host port's
    // document lifetime, not that status, identifies a replaced main document.
    if (host && change.url !== undefined && change.url !== host.url) end(host);
  });
  return {
    trusted,
    activate(tab: chrome.tabs.Tab, record: boolean) {
      const host = tab.id === undefined ? undefined : hosts.get(tab.id);
      if (
        !host ||
        host.ended ||
        !host.boot ||
        tab.windowId !== host.windowId ||
        !tab.url ||
        !floatingPageUrl(tab.url, authOrigin) ||
        tab.url !== host.url
      )
        return false;
      if (host.pending.length < 10)
        host.pending.push({ id: crypto.randomUUID(), record });
      host.dismissed = false;
      if (!host.frame) sendHost(host, { type: 'floating:mount' });
      deliver(host);
      return true;
    },
  };
}
