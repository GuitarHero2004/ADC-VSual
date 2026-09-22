import type { VisualSnapshot } from '@adc/contracts';
import { floatingPageUrl } from './config-values.ts';
import { exactMessage } from './floating-protocol.ts';
import {
  createVisualCapture,
  type VisualCaptureBinding,
} from './visual-capture.ts';
import {
  VISUAL_PORT,
  parseVisualMessage,
  type VisualReply,
  type VisualCaptureResult,
  type VisualSource,
  visualErrorCodes,
  type VisualErrorCode,
  visualResourceKey,
} from './visual-protocol.ts';

type Engine = {
  capture(
    binding: VisualCaptureBinding,
    signal: AbortSignal,
  ): Promise<VisualCaptureResult>;
  verify(snapshot: VisualSnapshot): Promise<boolean>;
};
type Client = {
  port: chrome.runtime.Port;
  source: VisualSource | null;
  capturing: boolean;
  recovering: boolean;
  generation: number;
  pending: Map<string, AbortController>;
  snapshot: string | null;
};
const grantKey = (tabId: number) => `visual-access:${tabId}`;
/** Browser action grants and trusted UI ports are separate from host-page access. */
export function installVisualWorker(
  browser: typeof chrome,
  trusted: (sender: chrome.runtime.MessageSender) => boolean,
  engine: Engine = createVisualCapture(browser),
) {
  const clients = new Set<Client>();
  const writes = new Map<number, Promise<void>>();
  const isPanel = (sender: chrome.runtime.MessageSender) =>
    sender.id === browser.runtime.id &&
    !sender.tab &&
    sender.url === browser.runtime.getURL('index.html');
  const authorised = (sender: chrome.runtime.MessageSender) =>
    isPanel(sender) || trusted(sender);
  const send = (client: Client, message: VisualReply) => {
    try {
      client.port.postMessage(message);
    } catch {
      reset(client);
    }
  };
  function reset(client: Client) {
    client.generation++;
    for (const pending of client.pending.values()) pending.abort();
    client.pending.clear();
    client.snapshot = null;
    client.capturing = false;
    client.recovering = false;
  }
  async function context(tab: chrome.tabs.Tab) {
    const eligible = !!tab.url && !!floatingPageUrl(tab.url);
    if (!eligible || tab.id === undefined)
      return { eligible: false, permission: 'required' as const };
    await writes.get(tab.id);
    const value: unknown = (
      await browser.storage.session.get(grantKey(tab.id))
    )[grantKey(tab.id)];
    return {
      eligible: true,
      resourceKey: await visualResourceKey(tab.url!),
      permission:
        value === tab.url ? ('granted' as const) : ('required' as const),
    };
  }
  function activate(tab: chrome.tabs.Tab) {
    if (tab.id === undefined || !tab.url || !floatingPageUrl(tab.url)) return;
    const id = tab.id;
    const write = (writes.get(id) ?? Promise.resolve())
      .then(() => browser.storage.session.set({ [grantKey(id)]: tab.url }))
      .catch(() => undefined);
    writes.set(id, write);
    void write.finally(() => {
      if (writes.get(id) === write) writes.delete(id);
    });
  }
  async function binding(client: Client, source: VisualSource) {
    const sender = client.port.sender!;
    if (
      !authorised(sender) ||
      (!isPanel(sender) &&
        (sender.tab?.id !== source.tabId ||
          sender.tab.windowId !== source.windowId))
    )
      throw new Error('STALE_CONTEXT');
    const tab = await browser.tabs.get(source.tabId);
    const url = tab.url ? floatingPageUrl(tab.url) : null;
    if (
      !url ||
      !tab.active ||
      tab.windowId !== source.windowId ||
      url.origin !== source.origin ||
      url.pathname !== source.pathname ||
      (await visualResourceKey(tab.url!)) !== source.resourceKey
    )
      throw new Error('STALE_CONTEXT');
    if ((await context(tab)).permission !== 'granted')
      throw new Error('PERMISSION_REQUIRED');
    return tab;
  }
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== VISUAL_PORT) return;
    if (!port.sender || !authorised(port.sender)) {
      port.disconnect();
      return;
    }
    const client: Client = {
      port,
      source: null,
      capturing: false,
      recovering: false,
      generation: 0,
      pending: new Map(),
      snapshot: null,
    };
    clients.add(client);
    port.onMessage.addListener((value) => {
      const message = parseVisualMessage(value);
      if (!message) return;
      if (!authorised(port.sender!)) {
        reset(client);
        port.disconnect();
        return;
      }
      if (message.type === 'visual:reset') {
        reset(client);
        return;
      }
      if (message.type === 'visual:cancel') {
        client.pending.get(message.id)?.abort();
        client.pending.delete(message.id);
        client.snapshot = null;
        return;
      }
      if (message.type === 'visual:state') {
        if (
          !isPanel(port.sender!) &&
          (port.sender!.tab?.id !== message.source.tabId ||
            port.sender!.tab.windowId !== message.source.windowId)
        )
          return;
        client.source = message.source;
        client.capturing = message.capturing;
        client.recovering = message.recovering;
        return;
      }
      if (client.pending.size || client.pending.has(message.id)) {
        send(client, {
          type: 'visual:error',
          id: message.id,
          code: 'VISUAL_BUSY',
        });
        return;
      }
      const abort = new AbortController();
      client.pending.set(message.id, abort);
      const generation = client.generation;
      const current = () =>
        clients.has(client) &&
        authorised(port.sender!) &&
        client.generation === generation &&
        !abort.signal.aborted &&
        client.pending.get(message.id) === abort;
      void (async () => {
        if (message.type === 'visual:verify') {
          const valid =
            client.snapshot === message.snapshot.snapshot_id &&
            client.source?.resourceKey === message.snapshot.resource_key &&
            (await engine.verify(message.snapshot));
          if (current())
            send(client, {
              type: 'visual:verified',
              id: message.id,
              current: valid,
            });
          return;
        }
        const tab = await binding(client, message.source);
        if (!current()) return;
        client.source = message.source;
        client.capturing = true;
        client.snapshot = null;
        const result = await engine.capture(
          {
            tabId: message.source.tabId,
            windowId: message.source.windowId,
            url: tab.url!,
            ...(message.source.documentId
              ? { documentId: message.source.documentId }
              : {}),
            requestId: message.id,
            contextGeneration: generation,
            scope: message.scope,
          },
          abort.signal,
        );
        if (result.snapshot.resource_key !== message.source.resourceKey)
          throw new Error('STALE_CONTEXT');
        if (current()) {
          client.snapshot = result.snapshot.snapshot_id;
          send(client, { type: 'visual:result', id: message.id, ...result });
        }
      })()
        .catch((error) => {
          if (!current()) return;
          const code =
            error instanceof Error
              ? 'code' in error
                ? String(error.code)
                : error.message
              : 'VISUAL_UNSUPPORTED';
          send(client, {
            type: 'visual:error',
            id: message.id,
            code: visualErrorCodes.includes(code as VisualErrorCode)
              ? (code as VisualErrorCode)
              : 'VISUAL_UNSUPPORTED',
          });
        })
        .finally(() => {
          if (client.pending.get(message.id) === abort) {
            client.pending.delete(message.id);
            client.capturing = false;
          }
        });
    });
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      reset(client);
      clients.delete(client);
    });
  });
  browser.runtime.onMessage.addListener((value: unknown, sender, reply) => {
    if (
      !exactMessage(value, 'visual:context', ['tabId']) ||
      !Number.isInteger(value.tabId) ||
      !authorised(sender) ||
      (!isPanel(sender) && sender.tab?.id !== value.tabId)
    )
      return false;
    void browser.tabs
      .get(value.tabId as number)
      .then(context)
      .then(reply, () => reply(null));
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(grantKey(tabId));
    for (const client of clients)
      if (client.source?.tabId === tabId) reset(client);
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url === undefined) return;
    void browser.storage.session.remove(grantKey(tabId));
    for (const client of clients)
      if (client.source?.tabId === tabId) {
        reset(client);
        send(client, { type: 'visual:cancelled' });
      }
  });
  return {
    activate,
    context,
    interceptActivation(
      tab: chrome.tabs.Tab,
    ): 'cancelled' | 'recovering' | null {
      for (const client of clients)
        if (
          client.source?.tabId === tab.id &&
          client.source?.windowId === tab.windowId &&
          client.capturing
        ) {
          reset(client);
          send(client, { type: 'visual:cancelled' });
          return 'cancelled';
        }
      for (const client of clients)
        if (
          client.source?.tabId === tab.id &&
          client.source?.windowId === tab.windowId &&
          client.recovering
        )
          return 'recovering';
      return null;
    },
  };
}
