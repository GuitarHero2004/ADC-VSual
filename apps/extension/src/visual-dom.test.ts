import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  visualDomCommand,
  parseVisualGeometry,
  type VisualDomRequest,
  type VisualGeometry,
} from './visual-dom.ts';

function fixture(content: string, url = 'https://example.test/article') {
  const dom = new JSDOM(
    `<!doctype html><title>Capture fixture</title>${content}`,
    { url, runScripts: 'outside-only' },
  );
  const w = dom.window;
  const closed = new WeakMap<Element, ShadowRoot>();
  Object.defineProperty(w, 'chrome', {
    value: {
      dom: {
        openOrClosedShadowRoot: (element: Element) =>
          element.shadowRoot ?? closed.get(element) ?? null,
      },
    },
  });
  Object.defineProperty(w.document, 'scrollingElement', {
    value: w.document.documentElement,
  });
  Object.defineProperties(w.document.documentElement, {
    scrollWidth: { value: 1024 },
    scrollHeight: { value: 2400 },
  });
  Object.defineProperties(w, {
    innerWidth: { value: 1024 },
    innerHeight: { value: 800 },
    scrollX: { value: 0, writable: true },
    scrollY: { value: 120, writable: true },
  });
  w.scrollTo = ((value: ScrollToOptions) => {
    Object.defineProperty(w, 'scrollX', {
      value: value.left ?? w.scrollX,
      writable: true,
    });
    Object.defineProperty(w, 'scrollY', {
      value: value.top ?? w.scrollY,
      writable: true,
    });
  }) as typeof w.scrollTo;
  let elementIndex = 0;
  for (const element of w.document.querySelectorAll('*')) {
    const left = 10 + (elementIndex % 4) * 220;
    const top = 20 + Math.floor(elementIndex++ / 4) * 90;
    element.getBoundingClientRect = () => ({
      x: left,
      y: top,
      left,
      top,
      right: left + 200,
      bottom: top + 80,
      width: 200,
      height: 80,
      toJSON: () => ({}),
    });
  }
  const command = (
    action: VisualDomRequest['action'],
    top?: number,
  ): VisualGeometry | null => {
    const input = {
      action,
      taskId: 'task-1',
      expectedUrl: url,
      ...(top === undefined ? {} : { top }),
    };
    return w.eval(
      `(${visualDomCommand.toString()})(${JSON.stringify(input)})`,
    ) as VisualGeometry | null;
  };
  return {
    dom,
    w,
    command,
    closed,
    close: () => {
      command('finish');
      w.close();
    },
  };
}

test('geometry contains no private field values and masks forms, floating UI and inaccessible frames', () => {
  const f = fixture(
    '<main><h1>Article</h1><p>Public content</p><p>More content</p></main><input type="password" value="synthetic-sensitive-field"><textarea>synthetic-private-note</textarea><div data-vsual-floating-host>synthetic-answer</div><iframe></iframe>',
  );
  try {
    const result = f.command('prepare')!;
    assert.ok(parseVisualGeometry(result));
    assert.equal(result.masks.length, 4);
    assert.equal(result.frames, true);
    assert.equal(result.eligible, false);
    assert.doesNotMatch(
      JSON.stringify(result),
      /synthetic-sensitive-field|synthetic-private-note|synthetic-answer/u,
    );
  } finally {
    f.close();
  }
});

test('current-view cleanup never scrolls or focuses a page it did not change', () => {
  const f = fixture('<button id="previous">Previous page focus</button>');
  try {
    const previous =
      f.w.document.querySelector<HTMLButtonElement>('#previous')!;
    previous.focus();
    let focusCalls = 0;
    let scrollCalls = 0;
    previous.focus = () => {
      focusCalls++;
    };
    const scroll = f.w.scrollTo;
    f.w.scrollTo = ((options: ScrollToOptions) => {
      scrollCalls++;
      scroll(options);
    }) as typeof f.w.scrollTo;
    f.command('prepare');
    // The page can move its own view while capture is pending. Current-view
    // cleanup must not undo that movement or steal the sidebar's focus.
    Object.defineProperty(f.w, 'scrollY', { value: 200, writable: true });
    f.command('finish');
    assert.equal(f.w.scrollY, 200);
    assert.equal(scrollCalls, 0);
    assert.equal(focusCalls, 0);
  } finally {
    f.close();
  }
});

test('private editable overflow is masked including rendered children and bare-text ranges', () => {
  const f = fixture(
    '<div role="textbox" contenteditable="true" style="height:20px;overflow:visible">FAKE-PRIVATE-BARE<span style="position:absolute">FAKE-PRIVATE-CHILD</span></div><p>Public source</p>',
  );
  try {
    const privateRoot =
      f.w.document.querySelector<HTMLElement>('[role="textbox"]')!;
    const child = privateRoot.querySelector('span')!;
    const bounds = (x: number, y: number, width: number, height: number) =>
      new f.w.DOMRect(x, y, width, height);
    privateRoot.getBoundingClientRect = () => bounds(10, 10, 100, 20);
    child.getBoundingClientRect = () => bounds(10, 200, 180, 30);
    f.w.Range.prototype.getClientRects = function () {
      const y = this.startContainer === privateRoot.firstChild ? 300 : 200;
      return [bounds(10, y, 180, 20)] as unknown as DOMRectList;
    };
    const result = f.command('prepare')!;
    for (const [x, y] of [
      [20, 20],
      [20, 210],
      [20, 310],
    ])
      assert.ok(
        result.masks.some(
          (mask) =>
            mask.x <= x! &&
            mask.y <= y! &&
            mask.x + mask.width > x! &&
            mask.y + mask.height > y!,
        ),
        `Private rendered geometry at ${x}, ${y} is covered`,
      );
    assert.doesNotMatch(JSON.stringify(result), /FAKE-PRIVATE/u);
    assert.ok(
      !result.masks.some((mask) => mask.width === 1024 && mask.height === 800),
    );
  } finally {
    f.close();
  }
});

test('a hostname alone never unmasks fields; structurally identified document editors preserve their content', () => {
  const f = fixture(
    '<main><div contenteditable role="textbox">Private chat input</div><article contenteditable="true" role="document" aria-label="Draft document"><h1>Draft title</h1><p>Document paragraph</p></article><input value="ordinary-field"></main>',
    'https://docs.google.com/document/d/example/edit',
  );
  try {
    const result = f.command('prepare')!;
    assert.equal(result.masks.length, 2);
    assert.equal(
      result.eligible,
      false,
      'editable app view is not auto-scrolled',
    );
  } finally {
    f.close();
  }
});

test('actual floating host marker covers its closed-shadow frame; marker removal cannot expose the private iframe', () => {
  const f = fixture(
    '<main><h1>Article</h1><p>One</p><p>Two</p></main><div data-vsual-floating-host></div>',
  );
  try {
    const host = f.w.document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    const shadow = host.attachShadow({ mode: 'closed' });
    f.closed.set(host, shadow);
    const frame = f.w.document.createElement('iframe');
    frame.getBoundingClientRect = host.getBoundingClientRect;
    shadow.append(frame);
    assert.equal(host.shadowRoot, null);
    const initial = f.command('prepare')!;
    assert.equal(
      initial.masks.length,
      1,
      'entire host masks its private iframe',
    );
    assert.equal(
      initial.frames,
      false,
      'own UI does not prevent finite article scrolling',
    );
    host.removeAttribute('data-vsual-floating-host');
    const changed = f.command('measure')!;
    assert.equal(
      changed.masks.length,
      1,
      'closed-root iframe remains excluded without relying on mutable DOM marker',
    );
    assert.equal(
      changed.frames,
      true,
      'unrecognised private surface is disclosed as an omitted frame',
    );
    host.dataset.vsualFloatingHost = '';
    host.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    });
    assert.equal(
      f.command('measure')!.masks.length,
      1,
      'a boxless marker host still masks its rendered private child frame',
    );
    host.getBoundingClientRect = () => new f.w.DOMRect(10, 10, 2, 2);
    assert.ok(
      f
        .command('measure')!
        .masks.some((mask) => mask.width === 200 && mask.height === 80),
      'a small mutable host box cannot expose its overflowing private child frame',
    );
  } finally {
    f.close();
  }
});

test('ordinary controls inside closed shadow roots are masked', () => {
  const f = fixture(
    '<main><h1>Article</h1><p>One</p><p>Two</p></main><div id="closed-control"></div>',
  );
  try {
    const host = f.w.document.querySelector<HTMLElement>('#closed-control')!;
    const shadow = host.attachShadow({ mode: 'closed' });
    f.closed.set(host, shadow);
    const input = f.w.document.createElement('input');
    input.type = 'password';
    input.value = 'synthetic-only';
    input.getBoundingClientRect = host.getBoundingClientRect;
    shadow.append(input);
    const result = f.command('prepare')!;
    assert.equal(result.masks.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-only/u);
  } finally {
    f.close();
  }
});

test('finite prose can scroll; canvas and virtualised applications stay current-view only', () => {
  for (const extra of [
    '',
    '<canvas></canvas>',
    '<section role="grid"></section>',
    '<video></video>',
  ]) {
    const f = fixture(
      `<main><h1>Long article</h1><p>Beginning</p><p>End</p>${extra}</main>`,
    );
    try {
      assert.equal(f.command('prepare')!.eligible, !extra);
    } finally {
      f.close();
    }
  }
});

test('capture scrolling restores untouched focus/position; intentional user takeover preserves newer position', () => {
  const f = fixture(
    '<main><h1>Article</h1><p>One</p><p>Two</p></main><button id="origin">Original</button>',
  );
  try {
    const original = f.w.document.querySelector<HTMLButtonElement>('#origin')!;
    original.focus();
    f.command('prepare');
    f.command('scroll', 640);
    f.w.document.dispatchEvent(new f.w.Event('scroll'));
    assert.equal(f.command('measure')!.takeover, false);
    f.command('finish');
    assert.equal(f.w.scrollY, 120);
    assert.equal(f.w.document.activeElement, original);
    f.command('prepare');
    f.command('scroll', 640);
    f.w.document.dispatchEvent(new f.w.Event('pointermove', { bubbles: true }));
    assert.equal(f.command('measure')!.takeover, false);
    f.w.document.dispatchEvent(new f.w.Event('wheel', { bubbles: true }));
    Object.defineProperty(f.w, 'scrollY', { value: 900, writable: true });
    assert.equal(f.command('measure')!.takeover, true);
    f.command('finish');
    assert.equal(f.w.scrollY, 900);
  } finally {
    f.close();
  }
});

test('a replacement resource is never scrolled back by cleanup', () => {
  const f = fixture('<main><h1>Article</h1><p>One</p><p>Two</p></main>');
  try {
    f.command('prepare');
    f.command('scroll', 640);
    f.w.history.pushState({}, '', '/different-resource');
    f.command('finish');
    assert.equal(f.w.scrollY, 640);
  } finally {
    f.close();
  }
});

test('untrusted invalid/out-of-viewport mask geometry is rejected', () => {
  const f = fixture('<main><h1>Article</h1><p>One</p><p>Two</p></main>');
  try {
    const geo = f.command('prepare')!;
    assert.equal(
      parseVisualGeometry({
        ...geo,
        masks: [{ x: 900, y: 2, width: 900, height: 5 }],
      }),
      null,
    );
    assert.equal(parseVisualGeometry({ ...geo, width: Infinity }), null);
  } finally {
    f.close();
  }
});
