import { ActivationBroker } from './activation.ts';
import { installAuthWorker } from './auth-worker.ts';
import { ordersOrigins, publicOrigin } from './config-values.ts';
import { installFloatingWorker } from './floating-worker.ts';

const storageKey = (windowId: number) => `voice-activation:${windowId}`;
const broker = new ActivationBroker({
  async read(windowId) {
    const key = storageKey(windowId);
    const stored: unknown = (await chrome.storage.session.get(key))[key];
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (value): value is { id: string } =>
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string',
    );
  },
  async write(windowId, activations) {
    const key = storageKey(windowId);
    if (activations.length)
      await chrome.storage.session.set({ [key]: activations });
    else await chrome.storage.session.remove(key);
  },
});

void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const floating = installFloatingWorker(
  ordersOrigins(import.meta.env),
  chrome,
  publicOrigin(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000'),
  (sender) => {
    void auth.cancelInlineDocument(sender).catch(() => undefined);
  },
);
const auth = installAuthWorker(undefined, floating.trusted);

function openPanel(tab: chrome.tabs.Tab, activate: boolean) {
  if (!Number.isInteger(tab.windowId) || tab.windowId < 0) return;
  // Call before any await: sidePanel.open requires this browser-event user gesture.
  const opening = chrome.sidePanel.open({ windowId: tab.windowId });
  const activationId = crypto.randomUUID();
  if (activate)
    void broker.activate(tab.windowId, activationId).catch(() => {
      console.warn(
        'Voice activation could not be queued. Wait for the panel, then try the shortcut again.',
      );
    });
  void opening.catch(() => {
    void broker.discard(tab.windowId, activationId).catch(() => undefined);
    console.warn(
      'Voice panel could not open. Try the browser side-panel menu.',
    );
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (!floating.activate(tab, false)) openPanel(tab, false);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-voice' && tab && !floating.activate(tab, true))
    openPanel(tab, true);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'voice-panel' || port.sender?.id !== chrome.runtime.id)
    return;
  const expected = new URL(chrome.runtime.getURL('index.html'));
  let sender: URL;
  try {
    sender = new URL(port.sender.url ?? '');
  } catch {
    port.disconnect();
    return;
  }
  if (
    sender.protocol !== expected.protocol ||
    sender.host !== expected.host ||
    sender.pathname !== expected.pathname ||
    sender.search
  ) {
    port.disconnect();
    return;
  }
  const key = crypto.randomUUID();
  let windowId: number | null = null;
  port.onMessage.addListener((message: unknown) => {
    if (typeof message !== 'object' || message === null || !('type' in message))
      return;
    if (
      message.type === 'ready' &&
      'windowId' in message &&
      typeof message.windowId === 'number' &&
      Number.isInteger(message.windowId) &&
      message.windowId >= 0
    ) {
      windowId = message.windowId;
      void broker
        .ready(windowId, key, (activation) =>
          port.postMessage({ type: 'activate', id: activation.id }),
        )
        .catch(() => undefined);
    }
    if (
      message.type === 'acknowledge' &&
      windowId !== null &&
      'id' in message &&
      typeof message.id === 'string'
    ) {
      void broker.acknowledge(windowId, key, message.id).catch(() => undefined);
    }
  });
  port.onDisconnect.addListener(() => {
    if (windowId !== null)
      void broker.disconnect(windowId, key).catch(() => undefined);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.session.remove(storageKey(windowId));
});
