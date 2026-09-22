/** Only geometry crosses the isolated-world boundary; input values never do. */
export interface VisualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualGeometry {
  documentKey: string;
  url: string;
  title: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  scrollWidth: number;
  scrollHeight: number;
  dpr: number;
  masks: VisualRect[];
  nested: boolean;
  horizontal: boolean;
  occlusions: boolean;
  frames: boolean;
  editable: boolean;
  video: boolean;
  eligible: boolean;
  takeover: boolean;
}

export interface VisualDomRequest {
  action: 'prepare' | 'measure' | 'scroll' | 'finish' | 'verify';
  taskId: string;
  expectedUrl: string;
  top?: number;
}

/** Passed directly to scripting.executeScript. Keep all runtime helpers inside. */
export function visualDomCommand(
  request: VisualDomRequest,
): VisualGeometry | null {
  type Session = {
    taskId: string;
    url: string;
    x: number;
    y: number;
    focus: HTMLElement | null;
    scrolled: boolean;
    takeover: boolean;
    detach: () => void;
    timeout: ReturnType<typeof setTimeout>;
  };
  type State = { key: string; session?: Session };
  const key = Symbol.for('vsual.visual.geometry');
  const scope = globalThis as typeof globalThis & { [key]?: State };
  const state = (scope[key] ??= { key: crypto.randomUUID() });
  const root = document.scrollingElement;
  const view = window.visualViewport;
  const own = (element: Element) =>
    !!element.closest('[data-vsual-floating-host], [data-vsual-root]');
  const finish = (session: Session) => {
    session.detach();
    clearTimeout(session.timeout);
    if (
      session.scrolled &&
      location.href === session.url &&
      !session.takeover
    ) {
      window.scrollTo({ left: session.x, top: session.y, behavior: 'instant' });
      if (session.focus?.isConnected)
        session.focus.focus({ preventScroll: true });
    }
    if (state.session === session) delete state.session;
  };
  if (request.action === 'finish') {
    if (state.session?.taskId === request.taskId) finish(state.session);
    return null;
  }
  // Chromium exposes closed roots to isolated extension scripts. A mutable
  // page attribute alone cannot prove that a private extension frame is absent.
  const closedRoots =
    typeof chrome !== 'undefined' && chrome.dom?.openOrClosedShadowRoot;
  if (!closedRoots) throw new Error('VISUAL_UNSUPPORTED');
  if (
    location.href !== request.expectedUrl ||
    window.top !== window ||
    !root ||
    (view &&
      (view.scale !== 1 || view.offsetLeft !== 0 || view.offsetTop !== 0))
  )
    throw new Error('STALE_CONTEXT');
  if (request.action === 'prepare') {
    if (state.session) throw new Error('VISUAL_BUSY');
    const session: Session = {
      taskId: request.taskId,
      url: location.href,
      x: window.scrollX,
      y: window.scrollY,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      scrolled: false,
      takeover: false,
      detach: () => {},
      timeout: setTimeout(() => {}, 0),
    };
    const takeover = (event: Event) => {
      if (event.target instanceof Element && own(event.target)) return;
      // Intent events identify takeover. Scroll events cannot distinguish our
      // programmatic scroll from the user's; pointer motion is irrelevant.
      session.takeover = true;
    };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const name of events) document.addEventListener(name, takeover, true);
    session.detach = () => {
      for (const name of events)
        document.removeEventListener(name, takeover, true);
    };
    clearTimeout(session.timeout);
    // A worker disappearing must not leave capture-owned restoration pending.
    session.timeout = setTimeout(() => finish(session), 15_000);
    state.session = session;
  }
  if (request.action !== 'verify' && state.session?.taskId !== request.taskId)
    throw new Error('STALE_CONTEXT');
  if (request.action === 'scroll') {
    if (state.session?.takeover) throw new Error('CANCELLED');
    if (!Number.isFinite(request.top) || request.top! < 0)
      throw new Error('VISUAL_UNSUPPORTED');
    state.session!.scrolled = true;
    window.scrollTo({ left: 0, top: request.top!, behavior: 'instant' });
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const masks: VisualRect[] = [];
  const privateContent = new WeakSet<Element>();
  let nested = false;
  let occlusions = false;
  let frames = false;
  let editable = false;
  let video = false;
  const clippedRect = (bounds: DOMRect | DOMRectReadOnly) => {
    if (
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      bounds.bottom <= 0 ||
      bounds.right <= 0 ||
      bounds.top >= height ||
      bounds.left >= width
    )
      return null;
    const x = Math.max(0, bounds.left);
    const y = Math.max(0, bounds.top);
    return {
      x,
      y,
      width: Math.min(width, bounds.right) - x,
      height: Math.min(height, bounds.bottom) - y,
    };
  };
  const rect = (element: Element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    return clippedRect(element.getBoundingClientRect());
  };
  const addMask = (bounds: VisualRect) => {
    if (
      masks.some(
        (mask) =>
          mask.x <= bounds.x &&
          mask.y <= bounds.y &&
          mask.x + mask.width >= bounds.x + bounds.width &&
          mask.y + mask.height >= bounds.y + bounds.height,
      )
    )
      return;
    masks.push(bounds);
    if (masks.length > 200) throw new Error('VISUAL_UNSUPPORTED');
  };
  // Positive editor policy: a named document container with a document-like
  // block structure. A provider hostname alone never exempts an input.
  const documentEditor = (element: Element) => {
    if (!element.matches('[contenteditable="true"], [contenteditable=""]'))
      return false;
    if (!element.matches('article, [role="document"]')) return false;
    if (
      !element.hasAttribute('aria-label') &&
      !element.hasAttribute('aria-labelledby')
    )
      return false;
    return (
      !element.closest('form, [role="dialog"]') &&
      !element.matches('[role="textbox"]') &&
      element.querySelectorAll('p, h1, h2, h3, li').length >= 2
    );
  };
  let examined = 0;
  const walk = (
    container: Document | ShadowRoot,
    inheritedPrivate = false,
    inheritedOwn = false,
  ) => {
    const elements = container.querySelectorAll('*');
    examined += elements.length;
    if (examined > 20_000) throw new Error('VISUAL_UNSUPPORTED');
    for (const element of elements) {
      const bounds = rect(element);
      const isOwn = inheritedOwn || own(element);
      const isControl = element.matches(
        'input, textarea, select, [role="textbox"], [role="combobox"], [contenteditable]:not([contenteditable="false"])',
      );
      const permittedEditor = documentEditor(element);
      if (isControl) editable = true;
      const isPrivate =
        inheritedPrivate ||
        isOwn ||
        (isControl && !permittedEditor) ||
        (!!element.parentElement && privateContent.has(element.parentElement));
      if (isPrivate) {
        privateContent.add(element);
        if (bounds) addMask(bounds);
        // An editable/textbox may paint children or bare text outside its own
        // box. Include their visible geometry without returning private text.
        const style = getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden')
          for (const node of element.childNodes) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            if (++examined > 20_000) throw new Error('VISUAL_UNSUPPORTED');
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const textBounds of range.getClientRects?.() ?? []) {
              const clipped = clippedRect(textBounds);
              if (clipped) addMask(clipped);
            }
          }
      }
      if (element.matches('iframe, frame, object, embed')) {
        // No frame-content assertion: inaccessible embedded content is an
        // explicit omitted region until a dedicated supported policy exists.
        if (bounds && !isOwn) {
          addMask(bounds);
          frames = true;
        }
      }
      if (element.matches('video')) video = true;
      const style = getComputedStyle(element);
      if (bounds && !isOwn && ['fixed', 'sticky'].includes(style.position))
        occlusions = true;
      if (
        !isOwn &&
        element !== root &&
        element !== document.body &&
        /(auto|scroll)/u.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 2
      )
        nested = true;
      const shadow =
        element instanceof HTMLElement
          ? closedRoots(element)
          : element.shadowRoot;
      // Even an own host's box can be changed by page CSS. Inspect its closed
      // tree so a rendered extension frame outside that box is still masked.
      if (shadow) walk(shadow, isPrivate, isOwn);
      // An opaque custom host may contain closed-shadow controls. Empty hosts
      // with no inspectable tree are omitted rather than assumed to be charts.
      // Light-DOM application containers (for example YouTube's root) are not
      // excluded merely because their tag has a hyphen.
      if (
        bounds &&
        element.localName.includes('-') &&
        !shadow &&
        element.childNodes.length === 0 &&
        !isOwn
      )
        addMask(bounds);
    }
  };
  walk(document);
  const main = [...document.querySelectorAll('main, article')].filter(
    (element) =>
      !element.parentElement?.closest('main, article') && !own(element),
  );
  const horizontal = root.scrollWidth > width + 2;
  const app = !!document.querySelector(
    '[role="application"], [role="grid"], canvas, video, [aria-rowcount], [aria-setsize="-1"]',
  );
  const eligible =
    main.length === 1 &&
    !!main[0]?.querySelector('h1, h2') &&
    (main[0]?.querySelectorAll('p, li').length ?? 0) >= 2 &&
    !nested &&
    !horizontal &&
    !app &&
    !editable &&
    !frames;
  if (masks.length > 200) throw new Error('VISUAL_UNSUPPORTED');
  return {
    documentKey: state.key,
    url: location.href,
    title: document.title.slice(0, 300),
    width,
    height,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    scrollWidth: root.scrollWidth,
    scrollHeight: root.scrollHeight,
    dpr: window.devicePixelRatio,
    masks,
    nested,
    horizontal,
    occlusions,
    frames,
    editable,
    video,
    eligible,
    takeover: state.session?.takeover ?? false,
  };
}

/** Validate page-controlled geometry before it reaches a decoder/canvas. */
export function parseVisualGeometry(value: unknown): VisualGeometry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as VisualGeometry;
  if (
    !/^[0-9a-f-]{36}$/iu.test(v.documentKey) ||
    typeof v.url !== 'string' ||
    typeof v.title !== 'string' ||
    v.title.length > 300
  )
    return null;
  for (const name of [
    'width',
    'height',
    'scrollWidth',
    'scrollHeight',
    'dpr',
  ] as const)
    if (!Number.isFinite(v[name]) || v[name] <= 0 || v[name] > 100_000_000)
      return null;
  for (const name of ['scrollX', 'scrollY'] as const)
    if (!Number.isFinite(v[name]) || v[name] < 0 || v[name] > 100_000_000)
      return null;
  for (const name of [
    'nested',
    'horizontal',
    'occlusions',
    'frames',
    'editable',
    'video',
    'eligible',
    'takeover',
  ] as const)
    if (typeof v[name] !== 'boolean') return null;
  if (!Array.isArray(v.masks) || v.masks.length > 200) return null;
  for (const r of v.masks)
    if (
      !r ||
      !['x', 'y', 'width', 'height'].every(
        (name) =>
          Number.isFinite(r[name as keyof VisualRect]) &&
          r[name as keyof VisualRect] >= 0,
      ) ||
      r.x + r.width > v.width + 1 ||
      r.y + r.height > v.height + 1
    )
      return null;
  return v;
}
