import {
  captureOrdersDocument,
  observeOrdersDocument,
  OrdersPageError,
  parseOrdersPageRequest,
  supportedOrdersUrl,
  trustedPanelSender,
  type OrdersPageResponse,
} from './orders-adapter.ts';
import { ordersOrigins } from './config-values.ts';
import { PageFocusMemory, trustedOrdersWorkerSender } from './floating-host.ts';

const origins = ordersOrigins({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_ORDERS_ORIGINS: import.meta.env.VITE_ORDERS_ORIGINS,
});
const documentKey = crypto.randomUUID();
const pageFocus = new PageFocusMemory(document, (element) =>
  element.hasAttribute('data-vsual-floating-host'),
);
window.addEventListener('pagehide', () => pageFocus.dispose(), { once: true });

chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'orders-page' ||
    (!trustedPanelSender(port.sender, chrome.runtime.id) &&
      !trustedOrdersWorkerSender(port.sender, chrome.runtime.id)) ||
    !supportedOrdersUrl(location.href, origins)
  )
    return;
  let connected = true;
  let stopObserving: (() => void) | null = null;
  let revision = 0;
  const reply = (message: OrdersPageResponse) => {
    if (connected) {
      try {
        port.postMessage(message);
      } catch {
        connected = false;
        stopObserving?.();
      }
    }
  };
  const observe = () => {
    stopObserving?.();
    stopObserving = observeOrdersDocument(document, () => {
      revision += 1;
      reply({ type: 'orders:changed', document_key: documentKey });
    });
  };
  port.onMessage.addListener((value: unknown) => {
    const message = parseOrdersPageRequest(value);
    if (!message) return;
    void (async () => {
      if (!supportedOrdersUrl(location.href, origins))
        throw new OrdersPageError('UNSUPPORTED_PAGE');
      if (message.type === 'orders:focus') {
        window.focus();
        const { focused, restored } = pageFocus.restore();
        if (!focused || !document.hasFocus())
          throw new OrdersPageError('UNAVAILABLE');
        reply({ type: 'orders:focused', id: message.id, restored });
        return;
      }
      // Recheck in the destination document: navigation can happen after the panel's tab query.
      if (message.expected_origin !== location.origin)
        throw new OrdersPageError('CONTEXT_CHANGED');
      if (
        message.type === 'orders:verify' &&
        message.document_key !== documentKey
      ) {
        reply({ type: 'orders:verified', id: message.id, current: false });
        return;
      }
      observe();
      const currentRevision = revision;
      const snapshot = await captureOrdersDocument(document, {
        url: location.href,
        origins,
        documentKey,
      });
      if (currentRevision !== revision)
        throw new OrdersPageError('CONTEXT_CHANGED');
      if (message.type === 'orders:capture')
        reply({ type: 'orders:result', id: message.id, snapshot });
      else
        reply({
          type: 'orders:verified',
          id: message.id,
          current:
            snapshot.document_key === message.document_key &&
            snapshot.fingerprint === message.fingerprint,
        });
    })().catch((error: unknown) =>
      reply({
        type: 'orders:error',
        id: message.id,
        code: error instanceof OrdersPageError ? error.code : 'INVALID_PAGE',
      }),
    );
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    stopObserving?.();
    stopObserving = null;
  });
});
