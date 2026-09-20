import { useEffect, type RefObject } from 'react';

export function usePanelActivation(
  activate: RefObject<() => void>,
  ready: boolean,
  enabled: boolean,
) {
  useEffect(() => {
    if (!ready || !enabled) return;
    let cancelled = false;
    let port: chrome.runtime.Port | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;

    async function connect() {
      const currentWindow = await chrome.windows.getCurrent();
      if (cancelled || currentWindow.id === undefined) return;
      const connected = chrome.runtime.connect({ name: 'voice-panel' });
      port = connected;
      connected.onMessage.addListener((message: unknown) => {
        if (
          cancelled ||
          typeof message !== 'object' ||
          message === null ||
          !('type' in message) ||
          message.type !== 'activate' ||
          !('id' in message) ||
          typeof message.id !== 'string'
        )
          return;
        retryDelay = 1000;
        // The worker may redeliver until acknowledged. A document consumes an ID once.
        if (sessionStorage.getItem('voice:last-activation') !== message.id) {
          sessionStorage.setItem('voice:last-activation', message.id);
          activate.current();
        }
        connected.postMessage({ type: 'acknowledge', id: message.id });
      });
      connected.onDisconnect.addListener(() => {
        if (!cancelled) {
          reconnect = setTimeout(() => {
            void connect().catch(() => undefined);
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      });
      connected.postMessage({ type: 'ready', windowId: currentWindow.id });
    }
    void connect().catch(() => undefined);
    return () => {
      cancelled = true;
      if (reconnect) clearTimeout(reconnect);
      port?.disconnect();
    };
  }, [activate, ready, enabled]);
}
