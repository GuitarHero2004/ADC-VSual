import {
  STRUCTURED_LIMITS,
  fingerprintStructuredSnapshot,
  structuredSnapshotSchema,
  type StructuredSnapshot,
} from '@adc/contracts';
import {
  visibleOrdersElement,
  type OrdersPageErrorCode,
} from './orders-adapter.ts';

export class StructuredPageError extends Error {
  readonly code: OrdersPageErrorCode;
  constructor(code: OrdersPageErrorCode) {
    super(code);
    this.code = code;
  }
}

const blocksSelector = 'h1,h2,h3,h4,h5,h6,p,li';
const excludedSelector = [
  'nav',
  'aside',
  'footer',
  '[role="navigation"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="banner"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  '[role="textbox"]',
  '[contenteditable]:not([contenteditable="false"])',
  'script',
  'style',
  'template',
  'noscript',
  'table',
  '[role="table"]',
  '[role="grid"]',
  '[role="treegrid"]',
  'iframe',
  'frame',
  'canvas',
  'svg',
  'img',
  'object',
  'embed',
  'audio',
  'video',
  '[data-vsual-floating-host]',
  '[data-vsual-companion]',
].join(',');
const controlsSelector =
  'form,input,textarea,select,button,[role="textbox"],[contenteditable]:not([contenteditable="false"]),[data-vsual-floating-host],[data-vsual-companion]';

export function structuredPageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function readable(element: Element) {
  return (
    !element.closest(excludedSelector) &&
    !element.closest('details:not([open]),[inert]') &&
    visibleOrdersElement(element)
  );
}

/** Structural inspection only: no text or input values are read by this probe. */
function mainRegion(document: Document): Element {
  if (document.contentType !== 'text/html')
    throw new StructuredPageError('UNSUPPORTED_PAGE');
  const candidates = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).filter(
      (element) =>
        !['BODY', 'HTML'].includes(element.tagName) && readable(element),
    );
  const mains = candidates('main,[role="main"]');
  if (mains.length > 1) throw new StructuredPageError('UNSUPPORTED_PAGE');
  const articles = candidates('article').filter(
    (element) => !element.parentElement?.closest('article'),
  );
  const root = mains[0] ?? (articles.length === 1 ? articles[0] : undefined);
  if (!root || articles.filter((article) => root.contains(article)).length > 1)
    throw new StructuredPageError('UNSUPPORTED_PAGE');
  if (
    !Array.from(root.querySelectorAll('p,li')).some((element) =>
      readable(element),
    )
  )
    throw new StructuredPageError('UNSUPPORTED_PAGE');
  return root;
}

export type StructuredCapability = {
  supported: boolean;
  reason: 'supported' | 'unsupported_structure' | 'unsupported_page';
};

export function probeStructuredDocument(
  document: Document,
  url: string,
): StructuredCapability {
  if (!structuredPageUrl(url) || document.contentType !== 'text/html')
    return { supported: false, reason: 'unsupported_page' };
  try {
    mainRegion(document);
    return { supported: true, reason: 'supported' };
  } catch {
    return { supported: false, reason: 'unsupported_structure' };
  }
}

/** Bounded text walk, omitting controls and nested list items to avoid duplication. */
function blockText(element: Element): string {
  let value = '';
  let count = 0;
  let pendingSpace = false;
  const limit = STRUCTURED_LIMITS.textCodePoints + 1;
  const append = (text: string) => {
    for (const character of text) {
      if (count >= limit) break;
      if (/\s/u.test(character)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace && value) {
        value += ' ';
        count += 1;
      }
      pendingSpace = false;
      if (count >= limit) break;
      value += character;
      count += 1;
    }
  };
  const read = (node: Node) => {
    if (count >= limit) return;
    if (node.nodeType === 3) {
      append(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const child = node as Element;
    if (!readable(child) || (child !== element && child.matches('ul,ol,li')))
      return;
    if (child.tagName === 'BR') append(' ');
    for (const descendant of child.childNodes) read(descendant);
    if (child !== element && child.matches('p,div')) append(' ');
  };
  read(element);
  return value.replace(/\s+/gu, ' ').trim();
}

type Limitation = StructuredSnapshot['coverage']['limitations'][number];

function omittedContent(root: Element): Set<Limitation> {
  const limits = new Set<Limitation>();
  const includes = (selector: string) =>
    Array.from(root.querySelectorAll(selector)).some(
      (element) =>
        !element.closest(controlsSelector) &&
        !element.parentElement?.closest(excludedSelector),
    );
  for (const [selector, limit] of [
    ['table,[role="table"],[role="grid"],[role="treegrid"]', 'tables'],
    ['iframe,frame', 'frames'],
    ['canvas', 'canvas'],
    ['img,svg,object,embed,video', 'diagrams'],
    [
      'details:not([open]),[aria-expanded="false"],[hidden],[aria-hidden="true"]',
      'collapsed_content',
    ],
    [
      'a[rel~="next"],a[rel~="prev"],[aria-label*="pagination" i]',
      'pagination',
    ],
    [
      '[aria-busy="true"],[data-loading="true"],[loading="lazy"]',
      'unloaded_content',
    ],
  ] as const)
    if (includes(selector)) limits.add(limit);
  // Pagination links often sit beside, rather than inside, the main region.
  if (
    root.ownerDocument.querySelector(
      'link[rel~="next"],link[rel~="prev"],a[rel~="next"],a[rel~="prev"],[aria-label*="pagination" i]',
    )
  )
    limits.add('pagination');
  return limits;
}

export async function captureStructuredDocument(
  document: Document,
  options: {
    url: string;
    documentKey: string;
    windowId: number;
    tabId: number;
    now?: () => Date;
  },
): Promise<StructuredSnapshot> {
  const url = structuredPageUrl(options.url);
  if (!url) throw new StructuredPageError('UNSUPPORTED_PAGE');
  const root = mainRegion(document);
  const limits = omittedContent(root);
  const boundedLabel = (text: string) => {
    const points = Array.from(text.replace(/\s+/gu, ' ').trim());
    if (points.length > 160) limits.add('text_budget');
    return points.slice(0, 160).join('');
  };
  const firstHeading = Array.from(
    root.querySelectorAll('h1,h2,h3,h4,h5,h6'),
  ).find(readable);
  const title =
    boundedLabel(
      document.title ||
        (firstHeading ? blockText(firstHeading) : 'Untitled page'),
    ) || 'Untitled page';
  const sections: StructuredSnapshot['sections'] = [];
  const blocks: StructuredSnapshot['blocks'] = [];
  let currentSection: StructuredSnapshot['sections'][number] | undefined;
  let used = Array.from(title).length;
  for (const element of root.querySelectorAll(blocksSelector)) {
    if (!readable(element)) {
      if (!element.closest(excludedSelector)) limits.add('collapsed_content');
      continue;
    }
    // A paragraph/heading within a list item is already represented by that item.
    if (element.tagName !== 'LI' && element.closest('li')) continue;
    const text = blockText(element);
    if (!text) continue;
    const heading = /^H[1-6]$/u.test(element.tagName);
    const newSection = heading || !currentSection;
    const headingText = heading ? boundedLabel(text) : title;
    const cost =
      Array.from(text).length +
      (newSection ? Array.from(headingText).length : 0);
    if (
      used + cost > STRUCTURED_LIMITS.textCodePoints ||
      blocks.length >= STRUCTURED_LIMITS.maxBlocks ||
      (newSection && sections.length >= STRUCTURED_LIMITS.maxSections)
    ) {
      limits.add('text_budget');
      break;
    }
    if (newSection) {
      currentSection = { id: `s${sections.length + 1}`, heading: headingText };
      sections.push(currentSection);
    }
    used += cost;
    blocks.push({
      id: `b${blocks.length + 1}`,
      section_id: currentSection!.id,
      kind: heading
        ? 'heading'
        : element.tagName === 'LI'
          ? 'list_item'
          : 'paragraph',
      text,
    });
  }
  if (!blocks.some((block) => block.kind !== 'heading'))
    throw new StructuredPageError('INVALID_PAGE');
  const snapshot: Omit<StructuredSnapshot, 'fingerprint'> = {
    source_kind: 'structured_page',
    snapshot_id: crypto.randomUUID(),
    captured_at: (options.now?.() ?? new Date()).toISOString(),
    origin: url.origin,
    pathname: url.pathname,
    document_key: options.documentKey,
    window_id: options.windowId,
    tab_id: options.tabId,
    title,
    sections,
    blocks,
    coverage: {
      partial: limits.size > 0,
      limitations: [...limits],
      included_sections: sections.map((section) => section.id),
    },
  };
  const parsed = structuredSnapshotSchema.safeParse({
    ...snapshot,
    fingerprint: await fingerprintStructuredSnapshot(snapshot),
  });
  if (!parsed.success) throw new StructuredPageError('INVALID_PAGE');
  return parsed.data;
}

type PageBinding = {
  id: string;
  expected_origin: string;
  expected_pathname: string;
  window_id: number;
  tab_id: number;
};
export type StructuredPageRequest =
  | ({ type: 'structured:probe' } & PageBinding)
  | ({ type: 'structured:capture' } & PageBinding)
  | ({
      type: 'structured:verify';
      document_key: string;
      fingerprint: string;
    } & PageBinding)
  | { type: 'structured:focus'; id: string };
export type StructuredPageResponse =
  | ({
      type: 'structured:capability';
      id: string;
      document_key: string;
    } & StructuredCapability)
  | { type: 'structured:result'; id: string; snapshot: StructuredSnapshot }
  | { type: 'structured:verified'; id: string; current: boolean }
  | { type: 'structured:focused'; id: string; restored: boolean }
  | { type: 'structured:error'; id: string; code: OrdersPageErrorCode }
  | { type: 'structured:changed'; document_key: string };

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
  );
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

export function parseStructuredPageRequest(
  value: unknown,
): StructuredPageRequest | null {
  if (!object(value) || !validId(value.id)) return null;
  if (value.type === 'structured:focus' && exact(value, ['type', 'id']))
    return value as StructuredPageRequest;
  const origin =
    typeof value.expected_origin === 'string'
      ? structuredPageUrl(value.expected_origin)
      : null;
  if (
    !origin ||
    origin.origin !== value.expected_origin ||
    typeof value.expected_pathname !== 'string' ||
    !/^\/(?!\/)[^?#]*$/u.test(value.expected_pathname) ||
    value.expected_pathname.length > 2000 ||
    !Number.isSafeInteger(value.window_id) ||
    Number(value.window_id) < 0 ||
    !Number.isSafeInteger(value.tab_id) ||
    Number(value.tab_id) < 0
  )
    return null;
  const keys = [
    'type',
    'id',
    'expected_origin',
    'expected_pathname',
    'window_id',
    'tab_id',
  ];
  if (
    ['structured:probe', 'structured:capture'].includes(String(value.type)) &&
    exact(value, keys)
  )
    return value as StructuredPageRequest;
  if (
    value.type === 'structured:verify' &&
    exact(value, [...keys, 'document_key', 'fingerprint']) &&
    validId(value.document_key) &&
    typeof value.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.fingerprint)
  )
    return value as StructuredPageRequest;
  return null;
}

export function parseStructuredPageResponse(
  value: unknown,
): StructuredPageResponse | null {
  if (!object(value)) return null;
  if (
    value.type === 'structured:changed' &&
    exact(value, ['type', 'document_key']) &&
    validId(value.document_key)
  )
    return value as StructuredPageResponse;
  if (!validId(value.id)) return null;
  if (
    value.type === 'structured:capability' &&
    exact(value, ['type', 'id', 'document_key', 'supported', 'reason']) &&
    validId(value.document_key) &&
    typeof value.supported === 'boolean' &&
    ['supported', 'unsupported_structure', 'unsupported_page'].includes(
      String(value.reason),
    ) &&
    value.supported === (value.reason === 'supported')
  )
    return value as StructuredPageResponse;
  if (
    value.type === 'structured:result' &&
    exact(value, ['type', 'id', 'snapshot'])
  ) {
    const parsed = structuredSnapshotSchema.safeParse(value.snapshot);
    return parsed.success
      ? { type: 'structured:result', id: value.id, snapshot: parsed.data }
      : null;
  }
  if (
    value.type === 'structured:verified' &&
    exact(value, ['type', 'id', 'current']) &&
    typeof value.current === 'boolean'
  )
    return value as StructuredPageResponse;
  if (
    value.type === 'structured:focused' &&
    exact(value, ['type', 'id', 'restored']) &&
    typeof value.restored === 'boolean'
  )
    return value as StructuredPageResponse;
  if (
    value.type === 'structured:error' &&
    exact(value, ['type', 'id', 'code']) &&
    [
      'UNSUPPORTED_PAGE',
      'INVALID_PAGE',
      'CONTEXT_CHANGED',
      'UNAVAILABLE',
    ].includes(String(value.code))
  )
    return value as StructuredPageResponse;
  return null;
}

/** Watches structure and mutations only. It never reads text or captures a snapshot. */
export function observeStructuredDocument(
  document: Document,
  changed: () => void,
  delay = 0,
): () => void {
  const root = mainRegion(document);
  const view = document.defaultView;
  if (!view) throw new StructuredPageError('UNAVAILABLE');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => {
    if (!delay) {
      changed();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(changed, delay);
  };
  const elementOf = (node: Node) =>
    node.nodeType === 1 ? (node as Element) : node.parentElement;
  const ignored = (node: Node) => !!elementOf(node)?.closest(excludedSelector);
  const relevantNode = (node: Node): boolean => {
    if (node === root || node.contains(root)) return true;
    const element = elementOf(node);
    if (
      element?.matches('table,iframe,canvas,svg,img,details') &&
      !element.parentElement?.closest(excludedSelector)
    )
      return true;
    if (ignored(node)) return false;
    return (
      !!element &&
      (element.matches(blocksSelector) ||
        !!element.closest(blocksSelector) ||
        !!element.querySelector(
          `${blocksSelector},table,iframe,canvas,svg,img,details`,
        ))
    );
  };
  const observer = new view.MutationObserver((records) => {
    if (
      records.some((record) => {
        // A previously readable element can become an excluded edit control or
        // navigation region. Its new role must not hide the invalidation itself.
        if (
          record.type === 'attributes' &&
          ['contenteditable', 'role'].includes(record.attributeName ?? '') &&
          root.contains(record.target) &&
          !elementOf(record.target)?.parentElement?.closest(excludedSelector)
        )
          return true;
        if (ignored(record.target)) return false;
        if (record.type === 'childList') {
          const nodes = [...record.addedNodes, ...record.removedNodes];
          if (!root.contains(record.target))
            return nodes.some(
              (node) =>
                node === root ||
                node.contains(root) ||
                (node.nodeType === 1 &&
                  (node as Element).matches('main,article,[role="main"]')),
            );
          return (
            !!elementOf(record.target)?.matches(blocksSelector) ||
            nodes.some(relevantNode)
          );
        }
        return (
          relevantNode(record.target) ||
          (record.type === 'attributes' && root.contains(record.target))
        );
      })
    )
      invalidate();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'hidden',
      'aria-hidden',
      'style',
      'class',
      'contenteditable',
      'open',
      'aria-expanded',
      'aria-busy',
      'role',
    ],
  });
  const ancestors = new view.MutationObserver(invalidate);
  const title = document.querySelector('title');
  if (title)
    ancestors.observe(title, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  for (
    let ancestor = root.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    ancestors.observe(ancestor, {
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'style', 'class', 'inert'],
    });
    observer.observe(ancestor, { childList: true });
  }
  view.addEventListener('popstate', invalidate);
  view.addEventListener('hashchange', invalidate);
  view.addEventListener('pagehide', invalidate);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    ancestors.disconnect();
    view.removeEventListener('popstate', invalidate);
    view.removeEventListener('hashchange', invalidate);
    view.removeEventListener('pagehide', invalidate);
  };
}
