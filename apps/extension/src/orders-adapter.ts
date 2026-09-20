import {
  fingerprintSnapshot,
  groundedOriginSchema,
  groundedSnapshotSchema,
  parseDisplayedCount,
  type GroundedSnapshot,
} from '@adc/contracts';

export type OrdersPageErrorCode =
  'UNSUPPORTED_PAGE' | 'INVALID_PAGE' | 'CONTEXT_CHANGED' | 'UNAVAILABLE';

export class OrdersPageError extends Error {
  readonly code: OrdersPageErrorCode;
  constructor(code: OrdersPageErrorCode) {
    super(code);
    this.code = code;
  }
}

export function supportedOrdersUrl(value: string, origins: readonly string[]) {
  try {
    const url = new URL(value);
    return !url.username &&
      !url.password &&
      url.pathname === '/orders' &&
      origins.includes(url.origin)
      ? url
      : null;
  } catch {
    return null;
  }
}

export function visibleOrdersElement(element: Element): boolean {
  for (
    let ancestor: Element | null = element;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    if (
      ancestor.hasAttribute('hidden') ||
      ancestor.getAttribute('aria-hidden') === 'true'
    )
      return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(ancestor);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

function displayedText(element: Element | null): string {
  if (!element || !visibleOrdersElement(element))
    throw new OrdersPageError('INVALID_PAGE');
  function read(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const child = node as Element;
    if (
      ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(child.tagName) ||
      !visibleOrdersElement(child)
    )
      return '';
    return Array.from(child.childNodes, read).join('');
  }
  return read(element).replace(/\s+/gu, ' ').trim();
}

function exactlyOne(root: ParentNode, selector: string): Element {
  const elements = root.querySelectorAll(selector);
  if (elements.length !== 1 || !elements[0])
    throw new OrdersPageError('INVALID_PAGE');
  return elements[0];
}

/** Read only the visible, supported table and its explicitly identified context. */
export async function captureOrdersDocument(
  document: Document,
  options: {
    url: string;
    origins: readonly string[];
    documentKey: string;
    now?: () => Date;
  },
): Promise<GroundedSnapshot> {
  const url = supportedOrdersUrl(options.url, options.origins);
  if (!url) throw new OrdersPageError('UNSUPPORTED_PAGE');
  const root = exactlyOne(document, 'main[data-vsual-orders]');
  const table = exactlyOne(root, 'table[data-orders-table]');
  const locale = table.getAttribute('lang');
  if (locale !== 'en-US' && locale !== 'vi-VN')
    throw new OrdersPageError('INVALID_PAGE');
  const labels =
    locale === 'en-US'
      ? { month: 'Month', metric: 'Completed orders', unit: 'orders' }
      : { month: 'Tháng', metric: 'Đơn hoàn thành', unit: 'đơn' };
  const headers = table.querySelectorAll('thead th[scope="col"]');
  if (
    headers.length !== 2 ||
    displayedText(headers[0] ?? null) !== labels.month ||
    displayedText(headers[1] ?? null) !== labels.metric ||
    displayedText(exactlyOne(root, '[data-orders-metric]')) !== labels.metric ||
    displayedText(exactlyOne(root, '[data-orders-unit]')) !== labels.unit
  ) {
    throw new OrdersPageError('INVALID_PAGE');
  }
  const region = displayedText(exactlyOne(root, '[data-orders-region]'));
  const yearText = displayedText(exactlyOne(root, '[data-orders-year]'));
  if (!/^\d{4}$/u.test(yearText)) throw new OrdersPageError('INVALID_PAGE');
  const rowElements = table.querySelectorAll('tbody > tr');
  if (!rowElements.length || rowElements.length > 100)
    throw new OrdersPageError('INVALID_PAGE');
  const rows = Array.from(rowElements, (row) => {
    if (!visibleOrdersElement(row) || row.children.length !== 2)
      throw new OrdersPageError('INVALID_PAGE');
    const time = exactlyOne(row, 'th[scope="row"] time[datetime]');
    const period = time.getAttribute('datetime') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(period))
      throw new OrdersPageError('INVALID_PAGE');
    const expectedLabel = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${period}-01T00:00:00Z`));
    if (
      displayedText(time).toLocaleLowerCase(locale) !==
      expectedLabel.toLocaleLowerCase(locale)
    ) {
      throw new OrdersPageError('INVALID_PAGE');
    }
    const rawValue = displayedText(
      exactlyOne(row, 'td[data-column="completed"]'),
    );
    const value = parseDisplayedCount(rawValue, locale);
    if (value === null) throw new OrdersPageError('INVALID_PAGE');
    return {
      id: row.getAttribute('data-row-id') ?? '',
      period,
      region,
      raw_value: rawValue,
      value,
    };
  });
  const snapshot: Omit<GroundedSnapshot, 'fingerprint'> = {
    snapshot_id: crypto.randomUUID(),
    adapter_key: 'orders-fixture@1' as const,
    captured_at: (options.now?.() ?? new Date()).toISOString(),
    origin: url.origin,
    pathname: '/orders' as const,
    document_key: options.documentKey,
    title: displayedText(exactlyOne(root, 'h1')),
    table_title: displayedText(exactlyOne(table, 'caption')),
    region,
    year: Number(yearText),
    metric: 'completed_orders' as const,
    unit: 'orders' as const,
    locale,
    is_complete: true as const,
    rows,
  };
  const parsed = groundedSnapshotSchema.safeParse({
    ...snapshot,
    fingerprint: await fingerprintSnapshot(snapshot),
  });
  if (!parsed.success) throw new OrdersPageError('INVALID_PAGE');
  return parsed.data;
}

export type OrdersPageRequest =
  | { type: 'orders:capture'; id: string; expected_origin: string }
  | {
      type: 'orders:verify';
      id: string;
      document_key: string;
      fingerprint: string;
      expected_origin: string;
    }
  | { type: 'orders:focus'; id: string };
export type OrdersPageResponse =
  | { type: 'orders:result'; id: string; snapshot: GroundedSnapshot }
  | { type: 'orders:verified'; id: string; current: boolean }
  | { type: 'orders:focused'; id: string; restored: boolean }
  | { type: 'orders:error'; id: string; code: OrdersPageErrorCode }
  | { type: 'orders:changed'; document_key: string };

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => key in value)
  );
}

/** Strict internal messages: never accept page-provided actions, routes or credentials. */
export function parseOrdersPageRequest(
  value: unknown,
): OrdersPageRequest | null {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id))
    return null;
  if (value.type === 'orders:focus' && keys(value, ['type', 'id']))
    return value as OrdersPageRequest;
  if (
    value.type === 'orders:capture' &&
    keys(value, ['type', 'id', 'expected_origin']) &&
    groundedOriginSchema.safeParse(value.expected_origin).success
  )
    return value as OrdersPageRequest;
  if (
    value.type === 'orders:verify' &&
    keys(value, [
      'type',
      'id',
      'document_key',
      'fingerprint',
      'expected_origin',
    ]) &&
    groundedOriginSchema.safeParse(value.expected_origin).success &&
    typeof value.document_key === 'string' &&
    uuid.test(value.document_key) &&
    typeof value.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.fingerprint)
  )
    return value as OrdersPageRequest;
  return null;
}

export function parseOrdersPageResponse(
  value: unknown,
): OrdersPageResponse | null {
  if (!record(value)) return null;
  if (
    value.type === 'orders:changed' &&
    keys(value, ['type', 'document_key']) &&
    typeof value.document_key === 'string' &&
    uuid.test(value.document_key)
  )
    return value as OrdersPageResponse;
  if (typeof value.id !== 'string' || !uuid.test(value.id)) return null;
  if (
    value.type === 'orders:result' &&
    keys(value, ['type', 'id', 'snapshot'])
  ) {
    const parsed = groundedSnapshotSchema.safeParse(value.snapshot);
    return parsed.success
      ? { type: 'orders:result', id: value.id, snapshot: parsed.data }
      : null;
  }
  if (
    value.type === 'orders:verified' &&
    keys(value, ['type', 'id', 'current']) &&
    typeof value.current === 'boolean'
  )
    return value as OrdersPageResponse;
  if (
    value.type === 'orders:focused' &&
    keys(value, ['type', 'id', 'restored']) &&
    typeof value.restored === 'boolean'
  )
    return value as OrdersPageResponse;
  if (
    value.type === 'orders:error' &&
    keys(value, ['type', 'id', 'code']) &&
    [
      'UNSUPPORTED_PAGE',
      'INVALID_PAGE',
      'CONTEXT_CHANGED',
      'UNAVAILABLE',
    ].includes(String(value.code))
  )
    return value as OrdersPageResponse;
  return null;
}

export function trustedPanelSender(
  sender: chrome.runtime.MessageSender | undefined,
  extensionId: string,
): boolean {
  if (sender?.id !== extensionId || sender.tab || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.protocol === 'chrome-extension:' &&
      url.host === extensionId &&
      url.pathname === '/index.html' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Observe supported context only. No capture or upload occurs in this callback. */
export function observeOrdersDocument(
  document: Document,
  changed: () => void,
  delay = 80,
): () => void {
  const root = document.querySelector('main[data-vsual-orders]');
  const view = document.defaultView;
  if (!root || !view) throw new OrdersPageError('INVALID_PAGE');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () => {
    clearTimeout(timer);
    timer = setTimeout(changed, delay);
  };
  const selector =
    'h1, table[data-orders-table], [data-orders-region], [data-orders-year], [data-orders-metric], [data-orders-unit]';
  const relevant = Array.from(root.querySelectorAll(selector));
  const observer = new view.MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          relevant.some((element) => element.contains(record.target)) ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node === root ||
              relevant.some((element) => node.contains(element)) ||
              (node.nodeType === 1 &&
                ((node as Element).matches(selector) ||
                  (node as Element).querySelector(selector))),
          ),
      )
    )
      invalidate();
  });
  const visibilityObserver = new view.MutationObserver(invalidate);
  for (
    let ancestor: Element | null = root;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    visibilityObserver.observe(ancestor, {
      attributes: true,
      attributeFilter: [
        'hidden',
        'aria-hidden',
        'style',
        'class',
        'data-vsual-orders',
      ],
    });
  }
  for (const element of relevant) {
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    if (element.parentElement)
      observer.observe(element.parentElement, { childList: true });
  }
  if (root.parentElement)
    observer.observe(root.parentElement, { childList: true });
  view.addEventListener('popstate', invalidate);
  view.addEventListener('pagehide', invalidate);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    visibilityObserver.disconnect();
    view.removeEventListener('popstate', invalidate);
    view.removeEventListener('pagehide', invalidate);
  };
}
