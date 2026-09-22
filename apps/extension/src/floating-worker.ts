import type { VisualAccessContext } from './visual-protocol.ts';
import {
  parseOrdersPageRequest,
  parseOrdersPageResponse,
  supportedOrdersUrl,
  type OrdersPageRequest,
} from './orders-adapter.ts';
import type { OrdersContext } from './page-context.ts';
import {
  structuredContext,
  type StructuredPageAccess,
} from './structured-access.ts';
import {
  parseStructuredPageRequest,
  parseStructuredPageResponse,
  type StructuredPageRequest,
} from './structured-adapter.ts';
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
  activationGeneration: number;
  check: { frame: chrome.runtime.Port; ids: Set<string> } | null;
  checkedIds: Set<string>;
  following: boolean;
  expanded: boolean;
  resumeExpected: boolean | null;
  followTask: object | null;
  visualMode: boolean;
};
type WindowFollow = { enabled: boolean; expanded: boolean };
const followKey = (windowId: number) => `floating-follow:${windowId}`;

/** Browser metadata binds each frame to one live top-level web document. */
export function installFloatingWorker(
  origins: readonly string[],
  browser: typeof chrome = chrome,
  authOrigin?: string | null,
  onFrameRemoved?: (sender: chrome.runtime.MessageSender) => void,
  structured?: Pick<StructuredPageAccess, 'context' | 'activate' | 'prepare'>,
  visualContext?: (tab: chrome.tabs.Tab) => Promise<VisualAccessContext>,
) {
  const hosts = new Map<number, Host>();
  let speechOwner: Host | null = null;
  const followWrites = new Map<number, Promise<void>>();
  const followStates = new Map<number, WindowFollow>();
  const followEpochs = new Map<number, number>();
  const extensionId = browser.runtime.id;
  async function withVisual(context: OrdersContext, tab: chrome.tabs.Tab) {
    if (!visualContext) return context;
    const { resourceKey, ...visual } = await visualContext(tab);
    return { ...context, visual, ...(resourceKey ? { resourceKey } : {}) };
  }
  async function restoreVisual(host: Host) {
    if (!visualContext || host.ended) return;
    const frame = host.frame;
    try {
      const tab = await browser.tabs.get(host.tabId);
      const { resourceKey, ...visual } = await visualContext(tab);
      if (host.ended || host.frame !== frame || tab.url !== host.url) return;
      host.context = {
        ...host.context,
        visual,
        ...(resourceKey ? { resourceKey } : {}),
      };
      sendFrame(host, { type: 'floating:context', context: host.context });
    } catch {
      /* Browser access remains a recoverable condition. */
    }
  }
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
  const publishSpeech = () => {
    for (const host of hosts.values())
      if (!host.ended && host.frame)
        sendFrame(host, {
          type: 'floating:speech-status',
          active: speechOwner !== null,
          other: speechOwner !== null && speechOwner !== host,
        });
  };
  const stopSpeech = (owner: Host | null = speechOwner) => {
    if (!owner || speechOwner !== owner) return;
    speechOwner = null;
    // Clear the advertised owner before delivering Stop, including during teardown.
    publishSpeech();
    sendFrame(owner, { type: 'floating:speech-stop' });
  };
  function saveFollow(windowId: number, state: WindowFollow) {
    const previous = followStates.get(windowId);
    if (
      previous?.enabled === state.enabled &&
      previous.expanded === state.expanded
    )
      return;
    followStates.set(windowId, state);
    followEpochs.set(windowId, (followEpochs.get(windowId) ?? 0) + 1);
    const writing = (followWrites.get(windowId) ?? Promise.resolve())
      .then(async () => {
        await browser.storage?.session?.set({ [followKey(windowId)]: state });
      })
      .catch(() => {
        followStates.delete(windowId);
      });
    followWrites.set(windowId, writing);
    void writing.finally(() => {
      if (followWrites.get(windowId) === writing) followWrites.delete(windowId);
    });
  }
  async function readFollow(windowId: number): Promise<WindowFollow | null> {
    await followWrites.get(windowId);
    const storage = browser.storage?.session;
    if (!storage) return null;
    const value: unknown = (await storage.get(followKey(windowId)))[
      followKey(windowId)
    ];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !('enabled' in value) ||
      typeof value.enabled !== 'boolean' ||
      !('expanded' in value) ||
      typeof value.expanded !== 'boolean'
    )
      return null;
    return { enabled: value.enabled, expanded: value.expanded };
  }
  async function foreground(host: Host) {
    const tab = await browser.tabs.get(host.tabId);
    if (!tab.active || tab.windowId !== host.windowId || tab.url !== host.url)
      return null;
    if (
      browser.windows.get &&
      !(await browser.windows.get(host.windowId)).focused
    )
      return null;
    return tab;
  }
  function armFollow(host: Host, expanded = host.expanded) {
    host.following = true;
    host.expanded = expanded;
    saveFollow(host.windowId, { enabled: true, expanded });
  }
  function disarmFollow(windowId: number) {
    if (speechOwner?.windowId === windowId) stopSpeech();
    saveFollow(windowId, { enabled: false, expanded: false });
    for (const host of hosts.values())
      if (host.windowId === windowId) {
        host.following = false;
        host.followTask = null;
        host.resumeExpected = null;
        host.check = null;
        host.activationGeneration++;
        sendFrame(host, { type: 'floating:cancel' });
        sendFrame(host, { type: 'floating:resume', expanded: false });
      }
  }
  async function resumeFollow(host: Host) {
    if (host.ended || host.dismissed || !host.frame || host.followTask) return;
    const task = {};
    host.followTask = task;
    const frame = host.frame;
    const epoch = followEpochs.get(host.windowId) ?? 0;
    const live = () =>
      !host.ended &&
      !host.dismissed &&
      host.frame === frame &&
      host.followTask === task &&
      epoch === (followEpochs.get(host.windowId) ?? 0);
    try {
      const state = await readFollow(host.windowId);
      if (!live() || !state?.enabled) return;
      const tab = await foreground(host);
      if (!live() || !tab) return;
      const context =
        host.context.sourceKind === 'structured_page' && structured
          ? await structured.prepare(tab, host.documentId)
          : host.context;
      if (
        !live() ||
        !(await foreground(host)) ||
        !live() ||
        (context.documentId && context.documentId !== host.documentId)
      )
        return;
      const enriched = await withVisual(context, tab);
      if (!live() || !(await foreground(host)) || !live()) return;
      host.context = enriched;
      host.following = true;
      host.expanded = state.expanded;
      host.resumeExpected = state.expanded;
      if (context.sourceKind === 'structured_page')
        sendFrame(host, { type: 'floating:context', context: host.context });
      sendFrame(host, { type: 'floating:resume', expanded: state.expanded });
      if (context.permission === 'granted') openSource(host);
    } catch {
      // Retain the user's draft and require an explicit retry when metadata is unavailable.
    } finally {
      if (host.followTask === task) host.followTask = null;
    }
  }
  async function followLayout(host: Host, expanded: boolean) {
    const frame = host.frame;
    const generation = host.activationGeneration;
    const epoch = followEpochs.get(host.windowId) ?? 0;
    if (!frame || host.ended || host.dismissed) return;
    // Initial collapsed geometry from a newly mounted iframe must not replace
    // the user's expanded window preference while a restore is pending.
    if (host.resumeExpected !== null) {
      if (expanded !== host.resumeExpected) return;
      host.resumeExpected = null;
    } else if (!host.following && !expanded) return;
    try {
      if (
        !(await foreground(host)) ||
        host.ended ||
        host.dismissed ||
        host.frame !== frame ||
        host.activationGeneration !== generation ||
        epoch !== (followEpochs.get(host.windowId) ?? 0)
      )
        return;
      armFollow(host, expanded);
    } catch {
      /* A hidden or unavailable source cannot change the window preference. */
    }
  }
  function end(host: Host) {
    if (host.ended) return;
    stopSpeech(host);
    host.ended = true;
    host.activationGeneration++;
    host.check = null;
    host.followTask = null;
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
    stopSpeech(host);
    const frame = host.frame;
    if (frame?.sender) onFrameRemoved?.(frame.sender);
    host.frame = null;
    host.frameId = null;
    host.frameDocumentId = null;
    host.boot = null;
    host.ready = false;
    host.dismissed = true;
    host.activationGeneration++;
    host.check = null;
    host.followTask = null;
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
  function openSource(host: Host) {
    if (host.source) return;
    const isStructured = host.context.sourceKind === 'structured_page';
    const source = browser.tabs.connect(host.tabId, {
      name: isStructured ? 'structured-page' : 'orders-page',
      frameId: 0,
      documentId: host.documentId,
    });
    host.source = source;
    source.onMessage.addListener((value: unknown) => {
      if (host.ended || host.source !== source) return;
      const response = isStructured
        ? parseStructuredPageResponse(value)
        : parseOrdersPageResponse(value);
      if (!response) {
        stopSpeech(host);
        stopSource(host);
        sendFrame(host, {
          type: 'floating:invalidated',
          reason: 'unavailable',
        });
        return;
      }
      if (response.type === 'structured:capability') {
        if (host.visualMode) return;
        host.context = {
          ...host.context,
          supported: response.supported,
          capability: response.supported ? 'supported' : 'unsupported',
          reason: response.supported ? null : 'unsupported',
        };
        sendFrame(host, { type: 'floating:context', context: host.context });
      } else if (
        response.type === 'orders:changed' ||
        response.type === 'structured:changed'
      ) {
        if (host.visualMode && response.type === 'structured:changed') return;
        stopSpeech(host);
        host.requests.clear();
        sendFrame(host, response);
        if (isStructured) void restoreStructured(host);
      } else if (host.requests.delete(response.id)) {
        if (
          response.type === 'structured:result' &&
          (response.snapshot.tab_id !== host.tabId ||
            response.snapshot.window_id !== host.windowId ||
            response.snapshot.origin !== host.context.origin ||
            response.snapshot.pathname !== host.context.pathname)
        ) {
          sendFrame(host, {
            type: 'structured:error',
            id: response.id,
            code: 'CONTEXT_CHANGED',
          });
          return;
        }
        sendFrame(host, response);
      }
    });
    source.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      if (host.source !== source || host.ended) return;
      stopSpeech(host);
      stopSource(host);
      sendFrame(host, { type: 'floating:invalidated', reason: 'unavailable' });
    });
    if (isStructured)
      source.postMessage({
        type: 'structured:probe',
        id: crypto.randomUUID(),
        expected_origin: host.context.origin,
        expected_pathname: host.context.pathname,
        tab_id: host.tabId,
        window_id: host.windowId,
      });
  }
  async function restoreStructured(host: Host, grant = false): Promise<void> {
    if (
      !structured ||
      host.ended ||
      host.context.sourceKind !== 'structured_page'
    )
      return;
    const frame = host.frame;
    const generation = host.activationGeneration;
    try {
      const tab = await foreground(host);
      if (!tab) return;
      const context = grant
        ? await structured.activate(tab)
        : await structured.context(tab, host.documentId);
      if (
        host.ended ||
        host.dismissed ||
        host.activationGeneration !== generation ||
        (frame !== null && host.frame !== frame) ||
        (context.documentId && context.documentId !== host.documentId)
      )
        return;
      const enriched = await withVisual(context, tab);
      if (
        host.ended ||
        host.dismissed ||
        host.activationGeneration !== generation ||
        (frame !== null && host.frame !== frame) ||
        !(await foreground(host))
      )
        return;
      host.context = enriched;
      sendFrame(host, { type: 'floating:context', context: host.context });
      if (context.permission === 'granted' && host.frame) openSource(host);
    } catch {
      sendFrame(host, { type: 'floating:invalidated', reason: 'unavailable' });
    }
  }
  async function checkPage(host: Host, id: string) {
    if (host.ended || host.dismissed || !host.frame || host.checkedIds.has(id))
      return;
    if (host.check && host.check.ids.size >= 8) return;
    host.checkedIds.add(id);
    if (host.checkedIds.size > 100)
      host.checkedIds.delete(host.checkedIds.values().next().value!);
    if (host.check) {
      host.check.ids.add(id);
      return;
    }
    const check = { frame: host.frame, ids: new Set([id]) };
    host.check = check;
    const generation = host.activationGeneration;
    const live = () =>
      !host.ended &&
      !host.dismissed &&
      host.frame === check.frame &&
      host.check === check &&
      host.activationGeneration === generation;
    const currentTab = async () => {
      const tab = await foreground(host);
      return live() &&
        tab &&
        tab.active &&
        tab.windowId === host.windowId &&
        tab.url === host.url
        ? tab
        : null;
    };
    try {
      const tab = await currentTab();
      if (!tab) return;
      armFollow(host);
      const context =
        host.context.sourceKind === 'structured_page' && structured
          ? await structured.prepare(tab, host.documentId)
          : host.context;
      if (!(await currentTab())) return;
      if (context.documentId && context.documentId !== host.documentId) return;
      const enriched = await withVisual(context, tab);
      if (!(await currentTab())) return;
      host.context = enriched;
      for (const requestId of check.ids)
        sendFrame(host, {
          type: 'floating:context-checked',
          id: requestId,
          context: host.context,
        });
      if (live() && context.permission === 'granted') openSource(host);
    } catch {
      if (live()) {
        // A failed check is not evidence that the previous source is still available.
        let context: OrdersContext =
          host.context.sourceKind === 'structured_page'
            ? structuredContext({ ...host.port.sender!.tab!, url: host.url })
            : { ...host.context, supported: false, reason: 'unavailable' };
        // Structured probing and screenshot access are separate capabilities.
        // Recheck only current metadata: a failed text probe must not erase
        // independently verified visual access or imply the page needs markup.
        try {
          const tab = await currentTab();
          if (!tab) return;
          const enriched = await withVisual(context, tab);
          if (!(await currentTab())) return;
          context = enriched;
        } catch {
          // Without a successful access lookup, the fallback stays unverified.
        }
        if (!live()) return;
        host.context = context;
        for (const requestId of check.ids)
          sendFrame(host, {
            type: 'floating:context-checked',
            id: requestId,
            context: host.context,
          });
      }
    } finally {
      if (host.check === check) host.check = null;
    }
  }
  async function relay(
    host: Host,
    request: OrdersPageRequest | StructuredPageRequest,
  ) {
    if (
      host.ended ||
      !host.frame ||
      host.requests.size >= 8 ||
      host.requests.has(request.id)
    )
      return;
    const isStructured = request.type.startsWith('structured:');
    if (
      !host.context.supported ||
      isStructured !== (host.context.sourceKind === 'structured_page')
    ) {
      sendFrame(host, {
        type: isStructured ? 'structured:error' : 'orders:error',
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
    if (
      isStructured &&
      'expected_pathname' in request &&
      (request.expected_pathname !== host.context.pathname ||
        request.tab_id !== host.tabId ||
        request.window_id !== host.windowId)
    )
      return;
    host.requests.add(request.id);
    try {
      const tab = await browser.tabs.get(host.tabId);
      const url = tab.url
        ? isStructured
          ? floatingPageUrl(tab.url, authOrigin)
          : supportedOrdersUrl(tab.url, origins)
        : null;
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
      if (isStructured) {
        const current = await structured?.context(tab, host.documentId);
        if (!current?.supported || current.permission !== 'granted') {
          host.requests.delete(request.id);
          sendFrame(host, {
            type: 'structured:error',
            id: request.id,
            code: 'CONTEXT_CHANGED',
          });
          return;
        }
        if (host.ended || !host.requests.has(request.id)) return;
      }
      openSource(host);
      if (
        request.type === 'orders:focus' ||
        request.type === 'structured:focus'
      ) {
        await browser.tabs.update(host.tabId, { active: true });
        await browser.windows.update(host.windowId, { focused: true });
        if (host.ended || !host.requests.has(request.id)) return;
      }
      host.source?.postMessage(request);
    } catch {
      if (host.requests.delete(request.id))
        sendFrame(host, {
          type: isStructured ? 'structured:error' : 'orders:error',
          id: request.id,
          code: 'UNAVAILABLE',
        });
    }
  }
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === FLOATING_HOST_PORT) {
      const sender = port.sender;
      const documentUrl = sender?.url
        ? floatingPageUrl(sender.url, authOrigin)
        : null;
      // Chrome retains sender.url from document creation after history.pushState.
      // The trusted tab metadata identifies the current same-document resource.
      const tabUrl = sender?.tab?.url
        ? floatingPageUrl(sender.tab.url, authOrigin)
        : documentUrl;
      const url =
        documentUrl && tabUrl?.origin === documentUrl.origin ? tabUrl : null;
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
        activationGeneration: 0,
        check: null,
        checkedIds: new Set(),
        following: false,
        expanded: false,
        resumeExpected: null,
        followTask: null,
        visualMode: false,
        context:
          !supportedOrdersUrl(url.href, origins) && structured
            ? structuredContext(sender.tab)
            : {
                supported: !!supportedOrdersUrl(url.href, origins),
                tabId: sender.tab.id,
                windowId: sender.tab.windowId,
                origin: url.origin,
                pathname: url.pathname,
                reason: supportedOrdersUrl(url.href, origins)
                  ? null
                  : 'unsupported',
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
      } else if (
        exactMessage(value, 'floating:check-page', ['id']) &&
        typeof value.id === 'string' &&
        floatingBootPattern.test(value.id)
      ) {
        void checkPage(host, value.id);
      } else if (parseFloatingHostCommand(value)?.type === 'floating:layout') {
        const layout = parseFloatingHostCommand(value)! as Extract<
          FloatingHostCommand,
          { type: 'floating:layout' }
        >;
        sendHost(host, layout);
        void followLayout(host, layout.expanded);
      } else if (
        exactMessage(value, 'floating:visual-mode', ['active']) &&
        typeof value.active === 'boolean'
      ) {
        host.visualMode = value.active;
      } else if (exactMessage(value, 'floating:reset')) {
        host.visualMode = false;
        stopSpeech(host);
        host.check = null;
        host.followTask = null;
        stopSource(host);
        if (host.context.permission === 'granted') void restoreStructured(host);
      } else if (exactMessage(value, 'floating:close')) {
        disarmFollow(host.windowId);
        sendHost(host, { type: 'floating:focus-page' });
        dismiss(host);
      } else if (exactMessage(value, 'floating:claim')) {
        if (speechOwner !== host) stopSpeech();
        for (const other of hosts.values())
          if (other !== host) sendFrame(other, { type: 'floating:cancel' });
      } else if (
        exactMessage(value, 'floating:speech-state', ['active']) &&
        typeof value.active === 'boolean'
      ) {
        if (value.active) {
          if (speechOwner !== host) stopSpeech();
          speechOwner = host;
          publishSpeech();
        } else if (speechOwner === host) {
          speechOwner = null;
          publishSpeech();
        }
      } else if (exactMessage(value, 'floating:stop-speech')) {
        stopSpeech();
      } else {
        const request =
          parseOrdersPageRequest(value) ?? parseStructuredPageRequest(value);
        if (request) void relay(host, request);
      }
    });
    port.onDisconnect.addListener(() => {
      void browser.runtime.lastError;
      if (!host.ended && host.frame === port) dismiss(host);
    });
    sendFrame(host, { type: 'floating:bound', context: host.context });
    sendFrame(host, {
      type: 'floating:speech-status',
      active: speechOwner !== null,
      other: speechOwner !== null && speechOwner !== host,
    });
    void restoreStructured(host);
    void restoreVisual(host);
    void resumeFollow(host);
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
  browser.tabs.onActivated?.addListener(({ tabId, windowId }) => {
    for (const host of hosts.values())
      if (host.windowId === windowId && host.tabId !== tabId) {
        host.requests.clear();
        host.check = null;
        host.followTask = null;
        sendFrame(host, { type: 'floating:invalidated', reason: 'tab' });
      }
    const current = hosts.get(tabId);
    if (current) void resumeFollow(current);
  });
  browser.windows.onFocusChanged?.addListener((windowId) => {
    for (const host of hosts.values())
      if (host.windowId !== windowId) {
        host.requests.clear();
        host.check = null;
        host.followTask = null;
        sendFrame(host, { type: 'floating:invalidated', reason: 'tab' });
      }
    for (const host of hosts.values())
      if (host.windowId === windowId) void resumeFollow(host);
  });
  browser.windows.onRemoved?.addListener((windowId) => {
    disarmFollow(windowId);
    void (followWrites.get(windowId) ?? Promise.resolve()).then(() =>
      browser.storage?.session?.remove(followKey(windowId)),
    );
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
      if (record && speechOwner && speechOwner !== host) {
        stopSpeech();
        return true;
      }
      void restoreVisual(host);
      const activation = { id: crypto.randomUUID(), record };
      armFollow(host, record ? host.expanded : true);
      const generation = host.activationGeneration;
      const queue = () => {
        if (
          host.ended ||
          host.dismissed ||
          host.activationGeneration !== generation
        )
          return;
        if (host.pending.length < 10) host.pending.push(activation);
        deliver(host);
      };
      host.dismissed = false;
      if (!host.frame) sendHost(host, { type: 'floating:mount' });
      if (structured && host.context.sourceKind === 'structured_page')
        void restoreStructured(host, true).then(queue);
      else queue();
      return true;
    },
  };
}
