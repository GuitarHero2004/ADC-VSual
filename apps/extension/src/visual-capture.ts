import {
  VISUAL_LIMITS,
  visualImageTokenBound,
  fingerprintVisualSnapshot,
  visualSnapshotSchema,
  type VisualSnapshot,
  type VisualImagePayload,
  type VisualScope,
  type VisualLimitation,
} from '@adc/contracts';
import {
  parseVisualGeometry,
  visualDomCommand,
  type VisualDomRequest,
  type VisualGeometry,
} from './visual-dom.ts';
import {
  normalizeVisualImage,
  normalizedDimensions,
  type NormalizedVisualImage,
} from './visual-image.ts';

export type VisualCaptureCode =
  | 'PERMISSION_REQUIRED'
  | 'STALE_CONTEXT'
  | 'CANCELLED'
  | 'VISUAL_UNSUPPORTED'
  | 'VISUAL_TOO_LARGE'
  | 'TIMEOUT'
  | 'VISUAL_BUSY'
  | 'VISUAL_UNSTABLE';
export class VisualCaptureError extends Error {
  readonly code: VisualCaptureCode;
  constructor(code: VisualCaptureCode) {
    super(code);
    this.code = code;
    this.name = 'VisualCaptureError';
  }
}
export interface VisualCaptureBinding {
  tabId: number;
  windowId: number;
  url: string;
  documentId?: string;
  requestId: string;
  contextGeneration: number;
  scope: VisualScope;
}
export type VisualCaptureBrowser = Pick<
  typeof chrome,
  'tabs' | 'windows' | 'scripting'
>;
type Dependencies = {
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  normalize?: (
    data: string,
    geometry: VisualGeometry,
    signal: AbortSignal,
  ) => Promise<NormalizedVisualImage>;
};
type Identity = {
  binding: VisualCaptureBinding;
  documentKey: string;
  browserDocumentId?: string;
  tabRevision: number;
};
type Scheduler = { active: boolean; lastStart: number };
const schedulers = new WeakMap<object, Scheduler>();

const sleep = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new VisualCaptureError('CANCELLED'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
const bounded = <T>(
  operation: Promise<T>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new VisualCaptureError('CANCELLED'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new VisualCaptureError('TIMEOUT'));
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void operation.then(
      (value) => {
        cleanup();
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
const hash = async (value: string | Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : (value as BufferSource),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
const base64 = (bytes: Uint8Array) => {
  let value = '';
  for (let i = 0; i < bytes.length; i += 16_384)
    value += String.fromCharCode(...bytes.subarray(i, i + 16_384));
  return btoa(value);
};

/** Plans the actual clamped final position before any screenshots are taken. */
export function planVisualTiles(
  height: number,
  viewport: number,
  scope: VisualScope,
): number[] {
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(viewport) ||
    height <= 0 ||
    viewport <= 0
  )
    throw new VisualCaptureError('VISUAL_UNSUPPORTED');
  const last = Math.max(0, height - viewport);
  const step = viewport * (1 - VISUAL_LIMITS.overlap);
  const required = Math.ceil(last / step) + 1;
  if (scope === 'rendered_page' && required > VISUAL_LIMITS.maxImages)
    throw new VisualCaptureError('VISUAL_TOO_LARGE');
  const count = Math.min(required, VISUAL_LIMITS.maxImages);
  return Array.from({ length: count }, (_, i) => Math.min(last, i * step));
}

export function createVisualCapture(
  browser: VisualCaptureBrowser,
  dependencies: Dependencies = {},
) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.sleep ?? sleep;
  const normalize = dependencies.normalize ?? normalizeVisualImage;
  const scheduler = schedulers.get(browser) ?? {
    active: false,
    lastStart: -Infinity,
  };
  schedulers.set(browser, scheduler);
  let sourceGeneration = 0;
  let disposed = false;
  let currentAbort: AbortController | null = null;
  let capturingTab: number | null = null;
  const tabRevisions = new Map<number, number>();
  const identities = new Map<string, Identity>();
  const transitioned = () => {
    sourceGeneration += 1;
  };
  const changed = (tabId: number, change: chrome.tabs.OnUpdatedInfo) => {
    // Tab loading also occurs for unrelated iframe navigation. Top-document
    // reloads are checked through real document IDs and the isolated-world key.
    if (change.url) {
      tabRevisions.set(tabId, (tabRevisions.get(tabId) ?? 0) + 1);
      if (capturingTab === tabId) transitioned();
      for (const [key, value] of identities)
        if (value.binding.tabId === tabId) identities.delete(key);
    }
  };
  const removed = (tabId: number) => {
    changed(tabId, { url: 'removed' });
  };
  browser.tabs.onActivated.addListener(transitioned);
  browser.tabs.onUpdated.addListener(changed);
  browser.tabs.onRemoved.addListener(removed);
  browser.windows.onFocusChanged.addListener(transitioned);

  async function inspect(
    binding: VisualCaptureBinding,
    request: VisualDomRequest,
    signal: AbortSignal,
    timeoutMs: number = VISUAL_LIMITS.preparationTimeoutMs,
  ) {
    let results: chrome.scripting.InjectionResult<VisualGeometry | null>[];
    try {
      results = await bounded(
        browser.scripting.executeScript({
          target: { tabId: binding.tabId, frameIds: [0] },
          func: visualDomCommand,
          args: [request],
          world: 'ISOLATED',
        }),
        timeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof VisualCaptureError) throw error;
      if (
        error instanceof Error &&
        /STALE_CONTEXT|CANCELLED|VISUAL_BUSY|VISUAL_UNSUPPORTED/u.test(
          error.message,
        )
      )
        throw new VisualCaptureError(
          error.message.match(
            /STALE_CONTEXT|CANCELLED|VISUAL_BUSY|VISUAL_UNSUPPORTED/u,
          )![0] as VisualCaptureCode,
        );
      throw new VisualCaptureError('PERMISSION_REQUIRED');
    }
    if (request.action === 'finish') return null;
    const first = results[0];
    const geometry = parseVisualGeometry(first?.result);
    if (
      !geometry ||
      geometry.url !== binding.url ||
      (binding.documentId && first?.documentId !== binding.documentId)
    )
      throw new VisualCaptureError('STALE_CONTEXT');
    if (geometry.takeover) throw new VisualCaptureError('CANCELLED');
    return { geometry, browserDocumentId: first?.documentId };
  }

  async function active(
    binding: VisualCaptureBinding,
    generation: number,
    signal: AbortSignal,
  ) {
    if (disposed || signal.aborted) throw new VisualCaptureError('CANCELLED');
    if (generation !== sourceGeneration)
      throw new VisualCaptureError('STALE_CONTEXT');
    const [tab, window] = await bounded(
      Promise.all([
        browser.tabs.get(binding.tabId),
        browser.windows.get(binding.windowId),
      ]),
      VISUAL_LIMITS.preparationTimeoutMs,
      signal,
    );
    if (
      generation !== sourceGeneration ||
      !tab.active ||
      !window.focused ||
      tab.windowId !== binding.windowId ||
      tab.url !== binding.url
    )
      throw new VisualCaptureError('STALE_CONTEXT');
  }

  return {
    async capture(
      binding: VisualCaptureBinding,
      outerSignal: AbortSignal,
    ): Promise<{ snapshot: VisualSnapshot; images: VisualImagePayload[] }> {
      if (scheduler.active) throw new VisualCaptureError('VISUAL_BUSY');
      if (disposed || outerSignal.aborted)
        throw new VisualCaptureError('CANCELLED');
      let url: URL;
      try {
        url = new URL(binding.url);
      } catch {
        throw new VisualCaptureError('VISUAL_UNSUPPORTED');
      }
      if (!['https:', 'http:'].includes(url.protocol))
        throw new VisualCaptureError('VISUAL_UNSUPPORTED');
      scheduler.active = true;
      capturingTab = binding.tabId;
      const abort = new AbortController();
      currentAbort = abort;
      const cancel = () => abort.abort();
      outerSignal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, VISUAL_LIMITS.captureStageTimeoutMs);
      const signal = abort.signal;
      const generation = sourceGeneration;
      const start = now();
      const request = (
        action: VisualDomRequest['action'],
        top?: number,
      ): VisualDomRequest => ({
        action,
        taskId: binding.requestId,
        expectedUrl: binding.url,
        ...(top === undefined ? {} : { top }),
      });
      let prepared = false;
      const images: VisualImagePayload[] = [];
      try {
        await active(binding, generation, signal);
        prepared = true; // late prepare still receives a matching cleanup attempt
        const preparationRemaining =
          VISUAL_LIMITS.preparationTimeoutMs - (now() - start);
        if (preparationRemaining <= 0) throw new VisualCaptureError('TIMEOUT');
        const initial = await inspect(
          binding,
          request('prepare'),
          signal,
          preparationRemaining,
        );
        if (!initial) throw new VisualCaptureError('VISUAL_UNSUPPORTED');
        const original = initial.geometry;
        if (binding.scope !== 'current_view' && !original.eligible)
          throw new VisualCaptureError('VISUAL_UNSUPPORTED');
        let positions =
          binding.scope === 'current_view'
            ? [original.scrollY]
            : planVisualTiles(
                original.scrollHeight,
                original.height,
                binding.scope,
              );
        const projectedWidth = Math.ceil(original.width * original.dpr);
        const projectedHeight = Math.ceil(original.height * original.dpr);
        if (projectedWidth * projectedHeight > VISUAL_LIMITS.rawPixels)
          throw new VisualCaptureError('VISUAL_TOO_LARGE');
        const projected = normalizedDimensions(projectedWidth, projectedHeight);
        const projectedTokens = visualImageTokenBound(
          projected.width,
          projected.height,
        );
        const affordableImages = Math.floor(
          VISUAL_LIMITS.imageTokens / projectedTokens,
        );
        if (
          affordableImages < 1 ||
          (binding.scope === 'rendered_page' &&
            positions.length > affordableImages)
        )
          throw new VisualCaptureError('VISUAL_TOO_LARGE');
        if (binding.scope === 'first_portion')
          positions = positions.slice(0, affordableImages);
        const metadata: VisualSnapshot['images'] = [];
        const limitations = new Set<VisualLimitation>([
          'document_not_retrieved',
          'unloaded_content',
          'collapsed_content',
        ]);
        if (binding.scope === 'current_view')
          limitations.add('current_view_only');
        else {
          limitations.add('geometry_only');
          if (positions.length > 1) limitations.add('sequential_captures');
        }
        if (binding.scope === 'first_portion')
          limitations.add('first_portion_only');
        let totalBytes = 0;
        let totalImageTokens = 0;
        for (const top of positions) {
          await active(binding, generation, signal);
          if (binding.scope !== 'current_view') {
            await inspect(binding, request('scroll', top), signal);
            // One bounded render interval; no global network/mutation-idle test.
            await wait(80, signal);
          }
          await wait(
            Math.max(
              0,
              scheduler.lastStart + VISUAL_LIMITS.captureIntervalMs - now(),
            ),
            signal,
          );
          let before = (await inspect(binding, request('measure'), signal))!
            .geometry;
          if (binding.scope !== 'current_view') {
            const settleStart = now();
            while (
              Math.abs(before.scrollY - top) > 1 &&
              now() - settleStart < VISUAL_LIMITS.settleTimeoutMs
            ) {
              await wait(50, signal);
              before = (await inspect(binding, request('measure'), signal))!
                .geometry;
            }
            if (
              Math.abs(before.scrollY - top) > 1 ||
              before.scrollHeight !== original.scrollHeight ||
              before.scrollWidth !== original.scrollWidth ||
              !before.eligible
            )
              throw new VisualCaptureError('VISUAL_UNSTABLE');
          }
          await active(binding, generation, signal);
          scheduler.lastStart = now();
          const capturedAt = new Date(now()).toISOString();
          let raw: string;
          try {
            raw = await bounded(
              browser.tabs.captureVisibleTab(binding.windowId, {
                format: 'png',
              }),
              VISUAL_LIMITS.captureTimeoutMs,
              signal,
            );
          } catch (error) {
            if (error instanceof VisualCaptureError) throw error;
            throw new VisualCaptureError('PERMISSION_REQUIRED');
          }
          await active(binding, generation, signal);
          const after = (await inspect(binding, request('measure'), signal))!
            .geometry;
          if (
            after.documentKey !== original.documentKey ||
            before.documentKey !== original.documentKey ||
            before.width !== after.width ||
            before.height !== after.height ||
            before.dpr !== after.dpr ||
            before.scrollX !== after.scrollX ||
            before.scrollY !== after.scrollY ||
            (binding.scope !== 'current_view' &&
              (before.scrollHeight !== after.scrollHeight ||
                before.scrollWidth !== after.scrollWidth)) ||
            JSON.stringify(before.masks) !== JSON.stringify(after.masks)
          )
            throw new VisualCaptureError('VISUAL_UNSTABLE');
          if (before.nested) limitations.add('nested_scrollers');
          if (before.horizontal) limitations.add('horizontal_overflow');
          if (before.occlusions) limitations.add('occluded_regions');
          if (before.frames) limitations.add('frames');
          if (before.video) limitations.add('dynamic_content');
          const normalized = await bounded(
            normalize(raw, before, signal),
            VISUAL_LIMITS.preparationTimeoutMs,
            signal,
          );
          raw = '';
          await active(binding, generation, signal);
          totalBytes += normalized.bytes.length;
          totalImageTokens += visualImageTokenBound(
            normalized.width,
            normalized.height,
          );
          if (
            totalBytes > VISUAL_LIMITS.totalImageBytes ||
            totalImageTokens > VISUAL_LIMITS.imageTokens
          )
            throw new VisualCaptureError('VISUAL_TOO_LARGE');
          if (normalized.redactions.length) limitations.add('redacted_regions');
          const id = `image-${metadata.length + 1}` as VisualImagePayload['id'];
          metadata.push({
            id,
            captured_at: capturedAt,
            sha256: await hash(normalized.bytes),
            width: normalized.width,
            height: normalized.height,
            viewport_width: before.width,
            viewport_height: before.height,
            scroll_x: before.scrollX,
            scroll_y: before.scrollY,
            scale_x: normalized.width / before.width,
            scale_y: normalized.height / before.height,
            redactions: normalized.redactions,
          });
          images.push({
            id,
            mime_type: 'image/jpeg',
            base64: base64(normalized.bytes),
          });
          normalized.bytes.fill(0);
        }
        await active(binding, generation, signal);
        const finalGeometry = (await inspect(
          binding,
          request('measure'),
          signal,
        ))!.geometry;
        if (finalGeometry.documentKey !== original.documentKey)
          throw new VisualCaptureError('STALE_CONTEXT');
        const snapshot = visualSnapshotSchema.parse({
          source_kind: 'visual_page',
          snapshot_id: crypto.randomUUID(),
          captured_at: new Date(now()).toISOString(),
          capture_started_at: new Date(start).toISOString(),
          fingerprint: '0'.repeat(64),
          origin: url.origin,
          pathname: url.pathname,
          title: Array.from(original.title.trim() || url.hostname)
            .slice(0, 160)
            .join(''),
          document_key: original.documentKey,
          resource_key: await hash(binding.url),
          window_id: binding.windowId,
          tab_id: binding.tabId,
          scope: binding.scope,
          images: metadata,
          coverage: {
            scroll_width: original.scrollWidth,
            scroll_height: original.scrollHeight,
            geometric_complete: binding.scope === 'rendered_page',
            limitations: [...limitations],
          },
        });
        snapshot.fingerprint = await fingerprintVisualSnapshot(snapshot);
        await active(binding, generation, signal);
        identities.set(snapshot.snapshot_id, {
          binding,
          documentKey: original.documentKey,
          ...(initial.browserDocumentId
            ? { browserDocumentId: initial.browserDocumentId }
            : {}),
          tabRevision: tabRevisions.get(binding.tabId) ?? 0,
        });
        if (identities.size > 64)
          identities.delete(identities.keys().next().value!);
        return { snapshot, images };
      } catch (error) {
        images.length = 0;
        if (timedOut) throw new VisualCaptureError('TIMEOUT');
        if (signal.aborted) throw new VisualCaptureError('CANCELLED');
        if (error instanceof VisualCaptureError) throw error;
        if (
          error instanceof Error &&
          /^VISUAL_(TOO_LARGE|UNSUPPORTED|UNSTABLE)$/u.test(error.message)
        )
          throw new VisualCaptureError(error.message as VisualCaptureCode);
        throw new VisualCaptureError('VISUAL_UNSUPPORTED');
      } finally {
        abort.abort();
        clearTimeout(timeout);
        outerSignal.removeEventListener('abort', cancel);
        if (prepared) {
          // Cleanup is bounded independently: an already-aborted task must still
          // release listeners/restore only its own document and untouched focus.
          await inspect(
            binding,
            request('finish'),
            new AbortController().signal,
          ).catch(() => {});
        }
        scheduler.active = false;
        capturingTab = null;
        if (currentAbort === abort) currentAbort = null;
      }
    },
    async verify(snapshot: VisualSnapshot): Promise<boolean> {
      const identity = identities.get(snapshot.snapshot_id);
      if (
        disposed ||
        !identity ||
        snapshot.tab_id !== identity.binding.tabId ||
        snapshot.window_id !== identity.binding.windowId ||
        snapshot.document_key !== identity.documentKey ||
        identity.tabRevision !== (tabRevisions.get(snapshot.tab_id) ?? 0)
      )
        return false;
      try {
        const tab = await browser.tabs.get(snapshot.tab_id);
        if (
          tab.url !== identity.binding.url ||
          tab.windowId !== snapshot.window_id
        )
          return false;
        const result = await inspect(
          identity.binding,
          {
            action: 'verify',
            taskId: identity.binding.requestId,
            expectedUrl: identity.binding.url,
          },
          new AbortController().signal,
        );
        return (
          !!result &&
          result.geometry.documentKey === identity.documentKey &&
          (!identity.browserDocumentId ||
            result.browserDocumentId === identity.browserDocumentId)
        );
      } catch {
        return false;
      }
    },
    dispose() {
      disposed = true;
      currentAbort?.abort();
      identities.clear();
      browser.tabs.onActivated.removeListener(transitioned);
      browser.tabs.onUpdated.removeListener(changed);
      browser.tabs.onRemoved.removeListener(removed);
      browser.windows.onFocusChanged.removeListener(transitioned);
    },
  };
}
