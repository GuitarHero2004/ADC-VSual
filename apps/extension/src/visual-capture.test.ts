import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVisualCapture,
  planVisualTiles,
  type VisualCaptureBinding,
  type VisualCaptureBrowser,
} from './visual-capture.ts';
import type { VisualGeometry, VisualDomRequest } from './visual-dom.ts';
import { VISUAL_LIMITS, visualImageTokenBound } from '@adc/contracts';
import { normalizedDimensions } from './visual-image.ts';

const event = () => {
  const listeners = new Set<(...args: never[]) => void>();
  return {
    addListener: (fn: (...args: never[]) => void) => listeners.add(fn),
    removeListener: (fn: (...args: never[]) => void) => listeners.delete(fn),
    emit: (...args: unknown[]) => {
      for (const fn of listeners) fn(...(args as never[]));
    },
  };
};
const binding: VisualCaptureBinding = {
  tabId: 1,
  windowId: 2,
  url: 'https://example.test/calendar#week-2',
  requestId: '41d38cd0-b84a-41b8-9ef9-e3bd3fd93e88',
  contextGeneration: 3,
  scope: 'current_view',
};
const geometry = (): VisualGeometry => ({
  documentKey: '4c99a52e-a083-4639-9f21-8f8c27b3b2a7',
  url: binding.url,
  title: 'Captured test view',
  width: 1000,
  height: 800,
  scrollX: 0,
  scrollY: 40,
  scrollWidth: 1000,
  scrollHeight: 800,
  dpr: 1,
  masks: [],
  nested: true,
  horizontal: false,
  occlusions: false,
  frames: false,
  editable: false,
  video: true,
  eligible: false,
  takeover: false,
});

function fixture() {
  let time = Date.parse('2026-09-23T00:00:00.000Z');
  const geo = geometry();
  const tab = { id: 1, windowId: 2, active: true, url: binding.url };
  const starts: number[] = [];
  const actions: VisualDomRequest['action'][] = [];
  let capture: () => Promise<string> = async () => 'synthetic';
  let normalizations = 0;
  const api = {
    tabs: {
      get: async () => tab,
      captureVisibleTab: async () => {
        starts.push(time);
        return capture();
      },
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    windows: { get: async () => ({ focused: true }), onFocusChanged: event() },
    scripting: {
      executeScript: async (options: { args: [VisualDomRequest] }) => {
        const request = options.args[0];
        actions.push(request.action);
        if (request.action === 'scroll') geo.scrollY = request.top!;
        return [
          {
            documentId: 'real-browser-document',
            result: request.action === 'finish' ? null : structuredClone(geo),
          },
        ];
      },
    },
  };
  const browser = api as unknown as VisualCaptureBrowser;
  const dependencies = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    normalize: async () => {
      normalizations++;
      return {
        bytes: new Uint8Array([255, 216, 1, 255, 217]),
        ...normalizedDimensions(geo.width * geo.dpr, geo.height * geo.dpr),
        redactions: [],
      };
    },
  };
  const service = createVisualCapture(browser, dependencies);
  return {
    service,
    api,
    browser,
    dependencies,
    geo,
    tab,
    starts,
    actions,
    setCapture: (next: typeof capture) => {
      capture = next;
    },
    normalizations: () => normalizations,
  };
}

test('standby does nothing; a dynamic canvas/application viewport needs no article or idle DOM', async () => {
  const f = fixture();
  try {
    assert.equal(f.starts.length, 0);
    assert.equal(f.actions.length, 0);
    const result = await f.service.capture(
      binding,
      new AbortController().signal,
    );
    assert.equal(result.images.length, 1);
    assert.equal(result.snapshot.scope, 'current_view');
    assert.equal(result.snapshot.coverage.geometric_complete, false);
    assert.ok(result.snapshot.coverage.limitations.includes('dynamic_content'));
    assert.ok(
      result.snapshot.coverage.limitations.includes('nested_scrollers'),
    );
    assert.ok(!f.actions.includes('scroll'));
    assert.equal(f.actions.at(-1), 'finish');
    assert.equal(await f.service.verify(result.snapshot), true);
    f.tab.active = false;
    f.api.tabs.onActivated.emit({ tabId: 9, windowId: 2 });
    assert.equal(
      await f.service.verify(result.snapshot),
      true,
      'accepted provenance survives an inactive tab',
    );
    f.api.tabs.onUpdated.emit(1, { url: 'https://example.test/other' });
    assert.equal(await f.service.verify(result.snapshot), false);
  } finally {
    f.service.dispose();
  }
});

test('away-and-back during screenshot discards the callback even when the tab is active again', async () => {
  const f = fixture();
  try {
    f.setCapture(async () => {
      f.api.tabs.onActivated.emit({ tabId: 9, windowId: 2 });
      f.api.tabs.onActivated.emit({ tabId: 1, windowId: 2 });
      return 'wrong-frame-risk';
    });
    await assert.rejects(
      f.service.capture(binding, new AbortController().signal),
      { code: 'STALE_CONTEXT' },
    );
    assert.equal(f.normalizations(), 0);
    assert.equal(f.actions.at(-1), 'finish');
  } finally {
    f.service.dispose();
  }
});

test('cancel invalidates a pending capture and a late callback cannot create an image result', async () => {
  const f = fixture();
  const abort = new AbortController();
  let resolve: (value: string) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((r) => {
    entered = r;
  });
  f.setCapture(() => {
    entered();
    return new Promise((r) => {
      resolve = r;
    });
  });
  try {
    const task = f.service.capture(binding, abort.signal);
    await started;
    abort.abort();
    await assert.rejects(task, { code: 'CANCELLED' });
    resolve('late');
    await Promise.resolve();
    assert.equal(f.normalizations(), 0);
    assert.equal(f.actions.at(-1), 'finish');
  } finally {
    f.service.dispose();
  }
});

test('browser capture deadline is bounded; late completion cannot produce an upload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let complete: (value: string) => void = () => {};
  f.setCapture(() => {
    entered();
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  try {
    const task = f.service.capture(binding, new AbortController().signal);
    await started;
    t.mock.timers.tick(VISUAL_LIMITS.captureTimeoutMs + 1);
    await assert.rejects(task, { code: 'TIMEOUT' });
    complete('too late');
    await Promise.resolve();
    assert.equal(f.normalizations(), 0);
    assert.equal(f.actions.at(-1), 'finish');
  } finally {
    f.service.dispose();
    t.mock.timers.reset();
  }
});

test('whole-page preflight rejects oversized/interactive pages before any screenshot or scroll', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.service.capture(
        { ...binding, scope: 'rendered_page' },
        new AbortController().signal,
      ),
      { code: 'VISUAL_UNSUPPORTED' },
    );
    f.geo.eligible = true;
    f.geo.nested = false;
    f.geo.video = false;
    f.geo.scrollHeight = 9000;
    await assert.rejects(
      f.service.capture(
        { ...binding, scope: 'rendered_page' },
        new AbortController().signal,
      ),
      { code: 'VISUAL_TOO_LARGE' },
    );
    assert.equal(f.starts.length, 0);
    assert.ok(!f.actions.includes('scroll'));
  } finally {
    f.service.dispose();
  }
});

test('four full-HD tiles exceed image-token budget before any screenshot or scrolling', async () => {
  const f = fixture();
  try {
    Object.assign(f.geo, {
      eligible: true,
      nested: false,
      video: false,
      width: 1920,
      height: 1080,
      scrollWidth: 1920,
      scrollHeight: 3672,
    });
    assert.equal(planVisualTiles(3672, 1080, 'rendered_page').length, 4);
    await assert.rejects(
      f.service.capture(
        { ...binding, scope: 'rendered_page' },
        new AbortController().signal,
      ),
      { code: 'VISUAL_TOO_LARGE' },
    );
    assert.equal(f.starts.length, 0);
    assert.ok(!f.actions.includes('scroll'));
    assert.equal(f.actions.at(-1), 'finish');
    const result = await f.service.capture(
      { ...binding, scope: 'first_portion' },
      new AbortController().signal,
    );
    assert.equal(
      result.images.length,
      2,
      'An explicit first portion fits the verified image-token budget',
    );
    assert.equal(result.snapshot.coverage.geometric_complete, false);
    assert.ok(
      result.snapshot.coverage.limitations.includes('first_portion_only'),
    );
    assert.ok(
      result.snapshot.images.reduce(
        (sum, image) => sum + visualImageTokenBound(image.width, image.height),
        0,
      ) <= VISUAL_LIMITS.imageTokens,
    );
  } finally {
    f.service.dispose();
  }
});

test('known raw raster oversize is rejected at preparation while decoder checks remain authoritative', async () => {
  const f = fixture();
  try {
    Object.assign(f.geo, { width: 4000, height: 2000, dpr: 2 });
    await assert.rejects(
      f.service.capture(binding, new AbortController().signal),
      { code: 'VISUAL_TOO_LARGE' },
    );
    assert.equal(f.starts.length, 0);
    assert.equal(f.normalizations(), 0);
  } finally {
    f.service.dispose();
  }
});

test('bounded page reaches actual clamped end; every screenshot start is a second apart', async () => {
  const f = fixture();
  try {
    Object.assign(f.geo, {
      eligible: true,
      nested: false,
      video: false,
      scrollHeight: 2500,
    });
    const { snapshot } = await f.service.capture(
      { ...binding, scope: 'rendered_page' },
      new AbortController().signal,
    );
    assert.deepEqual(
      snapshot.images.map((image) => image.scroll_y),
      [0, 640, 1280, 1700],
    );
    assert.equal(snapshot.coverage.geometric_complete, true);
    assert.ok(snapshot.coverage.limitations.includes('geometry_only'));
    assert.ok(snapshot.coverage.limitations.includes('sequential_captures'));
    for (let i = 1; i < f.starts.length; i++)
      assert.ok(
        f.starts[i]! - f.starts[i - 1]! >= VISUAL_LIMITS.captureIntervalMs,
      );
  } finally {
    f.service.dispose();
  }
});

test('one capture batch per extension instance including callers sharing an API object', async () => {
  const f = fixture();
  const second = createVisualCapture(f.browser, f.dependencies);
  const abort = new AbortController();
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.setCapture(() => {
    entered();
    return new Promise(() => {});
  });
  try {
    const task = f.service.capture(binding, abort.signal);
    await started;
    await assert.rejects(
      second.capture(binding, new AbortController().signal),
      { code: 'VISUAL_BUSY' },
    );
    abort.abort();
    await assert.rejects(task, { code: 'CANCELLED' });
  } finally {
    f.service.dispose();
    second.dispose();
  }
});

test('capture rejection reports browser access separately and always finishes preparation', async () => {
  const f = fixture();
  try {
    f.setCapture(async () => {
      throw new Error('browser denied');
    });
    await assert.rejects(
      f.service.capture(binding, new AbortController().signal),
      { code: 'PERMISSION_REQUIRED' },
    );
    assert.equal(f.actions.at(-1), 'finish');
  } finally {
    f.service.dispose();
  }
});

test('a changed private-control rectangle invalidates pixels; unrelated tab loads do not', async () => {
  const f = fixture();
  try {
    f.setCapture(async () => {
      f.geo.masks = [{ x: 1, y: 1, width: 20, height: 20 }];
      return 'private-moved';
    });
    await assert.rejects(
      f.service.capture(binding, new AbortController().signal),
      { code: 'VISUAL_UNSTABLE' },
    );
    assert.equal(f.normalizations(), 0);
    f.setCapture(async () => {
      f.api.tabs.onUpdated.emit(9, { status: 'loading' });
      return 'correct';
    });
    const result = await f.service.capture(
      binding,
      new AbortController().signal,
    );
    assert.equal(result.images.length, 1);
  } finally {
    f.service.dispose();
  }
});

test('first portion is explicit and never claims whole-page geometry', async () => {
  assert.deepEqual(
    planVisualTiles(9000, 800, 'first_portion'),
    [0, 640, 1280, 1920],
  );
  assert.throws(() => planVisualTiles(9000, 800, 'rendered_page'), {
    code: 'VISUAL_TOO_LARGE',
  });
});
