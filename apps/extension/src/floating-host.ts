import { visibleOrdersElement } from './orders-adapter.ts';
import { floatingPageUrl } from './config-values.ts';
import { parseFloatingHostCommand } from './floating-protocol.ts';

type HostPort = Pick<
  chrome.runtime.Port,
  'postMessage' | 'onMessage' | 'onDisconnect' | 'disconnect'
>;

type HostOptions = {
  authOrigin?: string | null;
  frameUrl: string;
  boot: string;
  dismissed?: boolean;
  onDisconnect?: (dismissed: boolean) => void;
  onRegistered?: () => void;
};

/** Retains an element reference only. No field values cross the extension boundary. */
export class PageFocusMemory {
  private previous: HTMLElement | null = null;
  private document: Document;
  private ignore: (element: HTMLElement) => boolean;

  constructor(document: Document, ignore: (element: HTMLElement) => boolean) {
    this.document = document;
    this.ignore = ignore;
    this.remember(document.activeElement);
    document.addEventListener('focusin', this.onFocus);
  }

  private remember(element: EventTarget | null) {
    const view = this.document.defaultView;
    if (
      view &&
      element instanceof view.HTMLElement &&
      element !== this.document.body &&
      !this.ignore(element)
    )
      this.previous = element;
  }

  private onFocus = (event: FocusEvent) => this.remember(event.target);

  restore(): { focused: boolean; restored: boolean } {
    const original = this.previous;
    const usable = !!(
      original?.isConnected &&
      !this.ignore(original) &&
      visibleOrdersElement(original) &&
      !original.closest('[inert]') &&
      !('disabled' in original && original.disabled)
    );
    const target = usable
      ? original
      : (this.document.querySelector<HTMLElement>('main h1, h1') ??
        this.document.querySelector<HTMLElement>('main'));
    if (!target) return { focused: false, restored: false };
    const oldTabIndex = target.getAttribute('tabindex');
    if (!usable) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
    if (!usable)
      target.addEventListener(
        'blur',
        () => {
          if (oldTabIndex === null) target.removeAttribute('tabindex');
          else target.setAttribute('tabindex', oldTabIndex);
        },
        { once: true },
      );
    return {
      focused: this.document.activeElement === target,
      restored: usable,
    };
  }

  dispose() {
    this.document.removeEventListener('focusin', this.onFocus);
    this.previous = null;
  }
}

const hosts = new WeakMap<Document, FloatingHost>();

/** Page code receives only an opaque cross-origin frame and its bounded geometry. */
export class FloatingHost {
  private document: Document;
  private port: HostPort;
  private url: string;
  private frameUrl: string;
  private boot: string;
  private element: HTMLDivElement | null = null;
  private expanded = false;
  private launcher = true;
  private launcherWidth = 80;
  private launcherHeight = 80;
  private compactHeight = 252;
  private disposed = false;
  private dismissed: boolean;
  private onDisconnected: ((dismissed: boolean) => void) | undefined;
  private onRegistered: (() => void) | undefined;
  private observer: MutationObserver;
  private routeTimer: number;
  readonly focus: PageFocusMemory;

  private constructor(
    document: Document,
    options: HostOptions & { port: HostPort },
  ) {
    this.document = document;
    this.port = options.port;
    this.url = document.defaultView!.location.href;
    this.frameUrl = options.frameUrl;
    this.boot = options.boot;
    this.dismissed = options.dismissed ?? false;
    this.onDisconnected = options.onDisconnect;
    this.onRegistered = options.onRegistered;
    const view = document.defaultView!;
    this.focus = new PageFocusMemory(document, (element) => this.owns(element));
    this.observer = new view.MutationObserver(() => {
      if (!this.current()) return;
      // Do not fight the page by reinserting a removed interface. Frame unload
      // closes its runtime port and cancels the extension-owned work.
      if (this.element && !this.element.isConnected) this.element = null;
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener('focusin', this.position);
    view.addEventListener('resize', this.position);
    view.addEventListener('scroll', this.position, true);
    view.addEventListener('popstate', this.checkRoute);
    view.addEventListener('hashchange', this.checkRoute);
    view.addEventListener('pagehide', this.dispose);
    // pushState does not dispatch popstate. This checks only URL metadata,
    // never reads or captures orders content, and fails closed on SPA navigation.
    this.routeTimer = view.setInterval(this.checkRoute, 500);
    this.port.onMessage.addListener(this.onMessage);
    this.port.onDisconnect.addListener(this.disconnected);
    try {
      this.port.postMessage({
        type: 'floating:host-ready',
        boot: options.boot,
        ...(this.dismissed ? { dismissed: true } : {}),
      });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  static start(
    document: Document,
    options: HostOptions & { connect: () => HostPort },
  ): FloatingHost | null {
    const existing = hosts.get(document);
    if (existing) return existing;
    const view = document.defaultView;
    if (
      !view ||
      view.top !== view ||
      !floatingPageUrl(view.location.href, options.authOrigin)
    )
      return null;
    const host = new FloatingHost(document, {
      ...options,
      port: options.connect(),
    });
    hosts.set(document, host);
    return host;
  }

  owns(element: HTMLElement) {
    return element === this.element || !!this.element?.contains(element);
  }

  private current() {
    if (this.disposed) return false;
    if (this.document.defaultView!.location.href !== this.url) {
      // A new URL gets a new worker binding and fresh companion state, even
      // for a same-document route change. No previous answer follows it.
      this.disconnected();
      return false;
    }
    return true;
  }

  private checkRoute = () => {
    this.current();
  };

  private onMessage = (value: unknown) => {
    const message = parseFloatingHostCommand(value);
    if (!message || !this.current()) return;
    switch (message.type) {
      case 'floating:registered':
        this.onRegistered?.();
        break;
      case 'floating:mount':
        this.mount();
        break;
      case 'floating:layout':
        this.expanded = message.expanded;
        this.launcher = message.launcher ?? false;
        if (this.launcher) {
          if (message.height !== undefined)
            this.launcherHeight = message.height;
          if (message.width !== undefined) this.launcherWidth = message.width;
        } else if (message.height !== undefined)
          this.compactHeight = message.height;
        this.position();
        break;
      case 'floating:focus-page':
        this.focus.restore();
        break;
      case 'floating:remove':
        this.dismissed = true;
        this.remove();
        this.boot = crypto.randomUUID();
        this.port.postMessage({
          type: 'floating:host-ready',
          boot: this.boot,
          dismissed: true,
        });
        break;
    }
  };

  private mount() {
    if (this.element?.isConnected) return;
    this.dismissed = false;
    const element = this.document.createElement('div');
    element.dataset.vsualFloatingHost = '';
    // Closed Shadow DOM contains styles only; security comes from the
    // cross-origin extension document plus its worker-validated binding.
    const shadow = element.attachShadow({ mode: 'closed' });
    const frame = this.document.createElement('iframe');
    frame.src = `${this.frameUrl}#${this.boot}`;
    frame.title = this.document.documentElement.lang.startsWith('vi')
      ? 'Trợ lý nổi VSual'
      : 'VSual floating companion';
    frame.allow = 'microphone';
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.cssText =
      'display:block;width:100%;height:100%;border:0;border-radius:inherit;background:#fff;color-scheme:light;';
    shadow.append(frame);
    this.element = element;
    this.expanded = false;
    this.launcher = true;
    this.launcherWidth = 80;
    this.launcherHeight = 80;
    element.style.cssText =
      'all:initial!important;position:fixed!important;z-index:2147483647!important;display:block!important;box-sizing:border-box!important;border:2px solid #cbd5e1!important;border-radius:24px!important;background:#fff!important;box-shadow:0 12px 36px #0f172a26,0 2px 8px #0f172a14!important;';
    // Manual popovers occupy the browser's document top layer without making
    // the page inert, moving focus, light-dismiss, or intercepting its clicks.
    // Other top-layer browser/page UI may still appear later; do not fight it.
    element.setAttribute('popover', 'manual');
    // Outside the page main/table; extension content never enters extraction.
    this.document.documentElement.append(element);
    try {
      element.showPopover?.();
    } catch {
      // Browsers without a usable Popover API retain the fixed z-index host.
    }
    this.position();
  }

  private position = () => {
    const host = this.element;
    const view = this.document.defaultView;
    if (!host || !view) return;
    host.style.setProperty(
      'border-radius',
      this.launcher ? '50%' : '24px',
      'important',
    );
    host.style.setProperty(
      'border-color',
      this.launcher ? '#304bbd' : '#cbd5e1',
      'important',
    );
    host.style.setProperty(
      'background',
      this.launcher ? '#304bbd' : '#fff',
      'important',
    );
    const margin = 8;
    // Keep the card inside the usable page area, clear of classic scrollbars.
    const viewportWidth =
      this.document.documentElement.clientWidth || view.innerWidth;
    const width = Math.max(
      1,
      Math.min(
        this.expanded ? 480 : this.launcher ? this.launcherWidth : 400,
        viewportWidth - 2 * margin,
      ),
    );
    let height = Math.max(
      1,
      Math.min(
        this.expanded
          ? 700
          : this.launcher
            ? this.launcherHeight
            : this.compactHeight,
        view.innerHeight - 2 * margin,
      ),
    );
    let left = Math.max(margin, viewportWidth - width - margin);
    let top = Math.max(margin, view.innerHeight - height - margin);
    const active = this.document.activeElement;
    if (active && active !== this.document.body && active !== host) {
      const rect = active.getBoundingClientRect();
      const overlap = (x: number, y: number) =>
        rect.width > 0 &&
        rect.height > 0 &&
        x < rect.right &&
        x + width > rect.left &&
        y < rect.bottom &&
        y + height > rect.top;
      const corners = [
        [left, top],
        [left, margin],
        [margin, top],
        [margin, margin],
      ];
      const clear = corners.find(([x, y]) => !overlap(x!, y!));
      if (clear) [left, top] = [clear[0]!, clear[1]!];
      else if (rect.top > margin || rect.bottom < view.innerHeight - margin) {
        // A wide focused control may rule out every full-size corner. Keep
        // the frame scrollable in the larger free vertical area instead.
        const above = Math.max(0, rect.top - 2 * margin);
        const below = Math.max(0, view.innerHeight - rect.bottom - 2 * margin);
        height = Math.min(height, Math.max(above, below));
        top = above >= below ? margin : rect.bottom + margin;
      }
    }
    host.style.setProperty('width', `${width}px`, 'important');
    host.style.setProperty('height', `${height}px`, 'important');
    host.style.setProperty('left', `${left}px`, 'important');
    host.style.setProperty('top', `${top}px`, 'important');
  };

  private remove() {
    this.element?.remove();
    this.element = null;
    this.expanded = false;
  }

  private disconnected = () => {
    if (this.disposed) return;
    const dismissed = this.dismissed;
    this.dispose();
    this.onDisconnected?.(dismissed);
  };

  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.remove();
    this.observer.disconnect();
    this.focus.dispose();
    const view = this.document.defaultView!;
    view.clearInterval(this.routeTimer);
    this.document.removeEventListener('focusin', this.position);
    view.removeEventListener('resize', this.position);
    view.removeEventListener('scroll', this.position, true);
    view.removeEventListener('popstate', this.checkRoute);
    view.removeEventListener('hashchange', this.checkRoute);
    view.removeEventListener('pagehide', this.dispose);
    this.port.onMessage.removeListener(this.onMessage);
    this.port.onDisconnect.removeListener(this.disconnected);
    try {
      this.port.disconnect();
    } catch {
      // The browser may already have invalidated an updated extension context.
    }
    hosts.delete(this.document);
  };
}

/** Rebind after a suspended worker, with a fresh frame and no resumed work. */
export function installFloatingHost(
  document: Document,
  options: Omit<HostOptions, 'boot' | 'onDisconnect' | 'onRegistered'> & {
    connect: () => HostPort;
  },
) {
  const view = document.defaultView;
  if (!view) return () => {};
  let host: FloatingHost | null = null;
  let retryTimer: number | undefined;
  let retries = 0;
  let dismissed = options.dismissed ?? false;
  let stopped = false;
  let locationUrl = view.location.href;
  const connect = () => {
    if (stopped) return;
    retryTimer = undefined;
    try {
      host = FloatingHost.start(document, {
        ...options,
        boot: crypto.randomUUID(),
        dismissed,
        onRegistered: () => {
          // Normal worker suspension is not a failed registration. Only
          // consecutive unsuccessful reconnects consume the retry budget.
          retries = 0;
        },
        onDisconnect: (wasDismissed) => {
          host = null;
          dismissed = wasDismissed;
          schedule();
        },
      });
    } catch {
      // Extension reload/update can invalidate this isolated context. Keep the
      // existing side panel available; never retry indefinitely.
      schedule();
    }
  };
  const schedule = () => {
    if (
      stopped ||
      retries >= 3 ||
      !floatingPageUrl(view.location.href, options.authOrigin)
    )
      return;
    retryTimer = view.setTimeout(connect, 1000 * 2 ** retries);
    retries += 1;
  };
  const navigated = () => {
    if (stopped || locationUrl === view.location.href) return;
    locationUrl = view.location.href;
    view.clearTimeout(retryTimer);
    retryTimer = undefined;
    retries = 0;
    dismissed = false;
    host?.dispose();
    host = null;
    connect();
  };
  // Retain a metadata-only navigation watcher even on excluded auth routes,
  // so a later SPA route can acquire a fresh host without reloading the page.
  const navigationTimer = view.setInterval(navigated, 500);
  const stop = () => {
    stopped = true;
    view.clearTimeout(retryTimer);
    view.clearInterval(navigationTimer);
    host?.dispose();
    view.removeEventListener('popstate', navigated);
    view.removeEventListener('hashchange', navigated);
    view.removeEventListener('pagehide', stop);
  };
  view.addEventListener('pagehide', stop);
  view.addEventListener('popstate', navigated);
  view.addEventListener('hashchange', navigated);
  connect();
  return stop;
}

export function trustedOrdersWorkerSender(
  sender: chrome.runtime.MessageSender | undefined,
  extensionId: string,
) {
  if (sender?.id !== extensionId || sender.tab || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === 'chrome-extension:' &&
      url.host === extensionId &&
      url.pathname === '/background.js' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
