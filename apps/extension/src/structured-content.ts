import {
  captureStructuredDocument,
  observeStructuredDocument,
  parseStructuredPageRequest,
  probeStructuredDocument,
  StructuredPageError,
  type StructuredPageResponse,
} from './structured-adapter.ts';
import { PageFocusMemory, trustedOrdersWorkerSender } from './floating-host.ts';
import { trustedPanelSender } from './orders-adapter.ts';

// Programmatic injection may be requested more than once. This lives in the
// isolated extension world, never in a property on a page DOM element.
const installedKey = Symbol.for('vsual.structured-content.installed');
const state = globalThis as typeof globalThis & { [installedKey]?: boolean };
if (!state[installedKey] && window.top === window) {
  state[installedKey] = true;
  install();
}

function install() {
  const documentKey = crypto.randomUUID();
  const pageFocus = new PageFocusMemory(document, (element) =>
    element.hasAttribute('data-vsual-floating-host'),
  );
  window.addEventListener('pagehide', () => pageFocus.dispose(), {
    once: true,
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (
      port.name !== 'structured-page' ||
      (!trustedPanelSender(port.sender, chrome.runtime.id) &&
        !trustedOrdersWorkerSender(port.sender, chrome.runtime.id))
    )
      return;
    let connected = true;
    let stopObserving: (() => void) | null = null;
    let revision = 0;
    const initialUrl = location.href;
    const reply = (message: StructuredPageResponse) => {
      if (!connected) return;
      try {
        port.postMessage(message);
      } catch {
        disconnect();
      }
    };
    const changed = () => {
      revision += 1;
      reply({ type: 'structured:changed', document_key: documentKey });
    };
    const routeTimer = window.setInterval(() => {
      if (location.href !== initialUrl) {
        changed();
        disconnect();
      }
    }, 250);
    const observe = () => {
      stopObserving?.();
      stopObserving = observeStructuredDocument(document, changed);
    };
    function disconnect() {
      connected = false;
      stopObserving?.();
      stopObserving = null;
      window.clearInterval(routeTimer);
    }
    port.onMessage.addListener((value: unknown) => {
      const message = parseStructuredPageRequest(value);
      if (!message || !connected) return;
      void (async () => {
        if (location.href !== initialUrl)
          throw new StructuredPageError('CONTEXT_CHANGED');
        if (message.type === 'structured:focus') {
          window.focus();
          const { focused, restored } = pageFocus.restore();
          if (!focused || !document.hasFocus())
            throw new StructuredPageError('UNAVAILABLE');
          reply({ type: 'structured:focused', id: message.id, restored });
          return;
        }
        if (
          message.expected_origin !== location.origin ||
          message.expected_pathname !== location.pathname
        )
          throw new StructuredPageError('CONTEXT_CHANGED');
        if (message.type === 'structured:probe') {
          const capability = probeStructuredDocument(document, location.href);
          if (capability.supported) observe();
          reply({
            type: 'structured:capability',
            id: message.id,
            document_key: documentKey,
            ...capability,
          });
          return;
        }
        if (
          message.type === 'structured:verify' &&
          message.document_key !== documentKey
        ) {
          reply({
            type: 'structured:verified',
            id: message.id,
            current: false,
          });
          return;
        }
        observe();
        const currentRevision = revision;
        const snapshot = await captureStructuredDocument(document, {
          url: location.href,
          documentKey,
          windowId: message.window_id,
          tabId: message.tab_id,
        });
        if (currentRevision !== revision || location.href !== initialUrl)
          throw new StructuredPageError('CONTEXT_CHANGED');
        if (message.type === 'structured:capture')
          reply({ type: 'structured:result', id: message.id, snapshot });
        else
          reply({
            type: 'structured:verified',
            id: message.id,
            current: snapshot.fingerprint === message.fingerprint,
          });
      })().catch((error: unknown) =>
        reply({
          type: 'structured:error',
          id: message.id,
          code:
            error instanceof StructuredPageError ? error.code : 'INVALID_PAGE',
        }),
      );
    });
    port.onDisconnect.addListener(disconnect);
  });
}
