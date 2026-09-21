import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
  FloatingHost,
  installFloatingHost,
  PageFocusMemory,
  trustedOrdersWorkerSender,
} from './floating-host.ts';

const origin = 'https://demo.example.test';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const frameUrl = `chrome-extension://${extensionId}/floating.html`;
const boot = '00c52b74-1d87-4921-882e-b2a1de57bc8e';

function setup(url = `${origin}/orders`) {
  const dom = new JSDOM(
    '<!doctype html><html lang="en"><body><main data-vsual-orders><h1>Orders</h1><button id="source">Source control</button></main></body></html>',
    { url, pretendToBeVisual: true },
  );
  const messages = new Set<(value: unknown) => void>();
  const disconnects = new Set<() => void>();
  const sent: unknown[] = [];
  let connections = 0;
  let disconnections = 0;
  const port = {
    postMessage: (message: unknown) => sent.push(message),
    onMessage: {
      addListener: (listener: (value: unknown) => void) =>
        messages.add(listener),
      removeListener: (listener: (value: unknown) => void) =>
        messages.delete(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnects.add(listener),
      removeListener: (listener: () => void) => disconnects.delete(listener),
    },
    disconnect: () => {
      disconnections += 1;
    },
  } as unknown as chrome.runtime.Port;
  const options = {
    authOrigin: origin,
    frameUrl,
    boot,
    connect: () => {
      connections += 1;
      return port;
    },
  };
  const roots: ShadowRoot[] = [];
  const attach = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) {
    const root = attach.call(this, options);
    roots.push(root);
    return root;
  };
  return {
    dom,
    sent,
    roots,
    options,
    start: () => FloatingHost.start(dom.window.document, options),
    send: (message: unknown) =>
      messages.forEach((listener) => listener(message)),
    disconnect: () => disconnects.forEach((listener) => listener()),
    counts: () => ({ connections, disconnections }),
  };
}

test('standby performs only a bound handshake; duplicate activation inserts one isolated frame without focus or capture', () => {
  const fixture = setup();
  const { dom } = fixture;
  const source = dom.window.document.getElementById('source')!;
  source.focus();
  const host = fixture.start();
  try {
    assert.ok(host);
    assert.equal(fixture.start(), host);
    assert.deepEqual(fixture.counts(), { connections: 1, disconnections: 0 });
    assert.deepEqual(fixture.sent, [{ type: 'floating:host-ready', boot }]);
    assert.equal(
      dom.window.document.querySelector('[data-vsual-floating-host]'),
      null,
    );
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:mount' });
    assert.equal(
      dom.window.document.querySelectorAll('[data-vsual-floating-host]').length,
      1,
    );
    const element = dom.window.document.querySelector(
      '[data-vsual-floating-host]',
    )!;
    assert.equal(element.shadowRoot, null);
    assert.equal(element.closest('main'), null);
    const frame = fixture.roots[0]!.querySelector('iframe')!;
    assert.equal(frame.src, `${frameUrl}#${boot}`);
    assert.equal(frame.allow, 'microphone');
    assert.equal(frame.title, 'VSual floating companion');
    assert.equal(frame.hasAttribute('sandbox'), false);
    assert.equal(dom.window.document.activeElement, source);
    assert.deepEqual(fixture.sent, [{ type: 'floating:host-ready', boot }]);
  } finally {
    host?.dispose();
    dom.window.close();
  }
});

test('collapse preserves the frame and close discards it, rotates its binding and waits for deliberate reopening', () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    const frame = fixture.roots[0]!.querySelector('iframe')!;
    fixture.send({ type: 'floating:layout', expanded: true });
    fixture.send({ type: 'floating:layout', expanded: false });
    assert.equal(fixture.roots.length, 1);
    assert.equal(frame.isConnected, true);
    assert.equal(fixture.sent.length, 1);
    fixture.send({ type: 'floating:remove' });
    assert.equal(frame.isConnected, false);
    assert.equal(fixture.counts().disconnections, 0);
    const next = fixture.sent[1] as { type: string; boot: string };
    assert.equal(next.type, 'floating:host-ready');
    assert.notEqual(next.boot, boot);
    assert.equal(fixture.roots.length, 1);
    fixture.send({ type: 'floating:mount' });
    assert.equal(fixture.roots.length, 2);
    assert.equal(
      fixture.roots[1]!.querySelector('iframe')!.src,
      `${frameUrl}#${next.boot}`,
    );
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('page messages and malformed commands cannot open, close or inject into the companion', () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    fixture.dom.window.dispatchEvent(
      new fixture.dom.window.MessageEvent('message', {
        data: { type: 'floating:mount' },
      }),
    );
    fixture.send({ type: 'floating:mount', token: 'untrusted' });
    fixture.send({ type: 'floating:layout', expanded: 'true' });
    fixture.send({ type: 'floating:html', content: '<p>Untrusted</p>' });
    assert.equal(fixture.roots.length, 0);
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:remove', ignored: true });
    assert.equal(fixture.roots[0]!.querySelector('iframe')!.isConnected, true);
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('ordinary HTTP(S) pages mount only the isolated UI, regardless of orders support', () => {
  for (const url of [
    `${origin}/orders-extra`,
    `${origin}/`,
    'https://other.example.test/orders',
    `${origin}:444/orders`,
  ]) {
    const fixture = setup(url);
    try {
      const host = fixture.start();
      assert.ok(host);
      assert.deepEqual(fixture.sent, [{ type: 'floating:host-ready', boot }]);
      assert.deepEqual(fixture.counts(), { connections: 1, disconnections: 0 });
      assert.equal(fixture.roots.length, 0);
      host.dispose();
    } finally {
      fixture.dom.window.close();
    }
  }
});

test('privileged URLs, URL credentials and own authentication routes never connect', () => {
  for (const url of [
    'file:///private.html',
    'about:blank',
    'https://user:example@other.example.test/',
    `${origin}/auth/sign-in`,
    `${origin}/auth/callback?code=opaque`,
  ]) {
    const fixture = setup(url);
    try {
      assert.equal(fixture.start(), null);
      assert.equal(fixture.counts().connections, 0);
    } finally {
      fixture.dom.window.close();
    }
  }
});

test('manual popover enters the top layer once without modal behaviour or focus theft', () => {
  const fixture = setup('https://ordinary.example.test/article');
  const source = fixture.dom.window.document.getElementById('source')!;
  source.focus();
  let shows = 0;
  fixture.dom.window.HTMLElement.prototype.showPopover = function () {
    shows++;
    assert.equal(this.getAttribute('popover'), 'manual');
    assert.equal(this.hasAttribute('autofocus'), false);
    assert.equal(this.getAttribute('aria-modal'), null);
  };
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:mount' });
    assert.equal(shows, 1);
    assert.equal(fixture.dom.window.document.activeElement, source);
    assert.equal(fixture.dom.window.document.body.hasAttribute('inert'), false);
    const element = fixture.dom.window.document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    assert.equal(element.style.zIndex, '2147483647');
    assert.equal(element.style.borderRadius, '50%');
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('SPA navigation, worker disconnect and document disposal remove the frame and close the host port', () => {
  for (const end of ['navigation', 'disconnect', 'pagehide']) {
    const fixture = setup();
    const host = fixture.start();
    try {
      fixture.send({ type: 'floating:mount' });
      const frame = fixture.roots[0]!.querySelector('iframe')!;
      if (end === 'navigation') {
        fixture.dom.window.history.pushState({}, '', '/unsupported');
        fixture.dom.window.dispatchEvent(
          new fixture.dom.window.PopStateEvent('popstate'),
        );
      } else if (end === 'disconnect') fixture.disconnect();
      else
        fixture.dom.window.dispatchEvent(
          new fixture.dom.window.PageTransitionEvent('pagehide'),
        );
      assert.equal(frame.isConnected, false);
      fixture.send({ type: 'floating:mount' });
      assert.equal(fixture.roots.length, 1);
      assert.equal(fixture.counts().disconnections, 1);
      host?.dispose();
      assert.equal(fixture.counts().disconnections, 1);
    } finally {
      host?.dispose();
      fixture.dom.window.close();
    }
  }
});

test('external DOM removal is respected without automatic remount', async () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    fixture.dom.window.document
      .querySelector('[data-vsual-floating-host]')!
      .remove();
    await Promise.resolve();
    assert.equal(fixture.roots.length, 1);
    assert.equal(fixture.roots[0]!.querySelector('iframe')!.isConnected, false);
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('SPA navigation replaces the frame binding and resumes UI after an excluded auth route', () => {
  const fixture = setup();
  const stop = installFloatingHost(
    fixture.dom.window.document,
    fixture.options,
  );
  try {
    fixture.send({ type: 'floating:mount' });
    const previous = fixture.roots[0]!.querySelector('iframe')!;
    const navigate = (path: string) => {
      fixture.dom.window.history.pushState({}, '', path);
      fixture.dom.window.dispatchEvent(
        new fixture.dom.window.PopStateEvent('popstate'),
      );
    };
    navigate('/article');
    assert.equal(previous.isConnected, false);
    assert.equal(fixture.counts().connections, 2);
    fixture.send({ type: 'floating:mount' });
    const replacement = fixture.roots[1]!.querySelector('iframe')!;
    assert.notEqual(replacement.src, previous.src);
    navigate('/auth/callback');
    assert.equal(replacement.isConnected, false);
    assert.equal(fixture.counts().connections, 2);
    navigate('/other-article');
    assert.equal(fixture.counts().connections, 3);
    fixture.send({ type: 'floating:mount' });
    assert.equal(fixture.roots.length, 3);
  } finally {
    stop();
    fixture.dom.window.close();
  }
});

test('End dismissal remains explicit across a same-document route change', () => {
  const fixture = setup();
  const stop = installFloatingHost(
    fixture.dom.window.document,
    fixture.options,
  );
  try {
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:remove' });
    fixture.dom.window.history.pushState({}, '', '/another-article');
    fixture.dom.window.dispatchEvent(
      new fixture.dom.window.PopStateEvent('popstate'),
    );
    const ready = fixture.sent.at(-1) as { type: string; dismissed?: boolean };
    assert.equal(ready.type, 'floating:host-ready');
    assert.equal(ready.dismissed, true);
    assert.equal(
      fixture.dom.window.document.querySelectorAll('[data-vsual-floating-host]')
        .length,
      0,
    );
  } finally {
    stop();
    fixture.dom.window.close();
  }
});

test('consecutive failed worker registrations use fresh bindings, preserve dismissal and stop after three retries', () => {
  const fixture = setup();
  const scheduled: { callback: () => void; delay: number }[] = [];
  fixture.dom.window.setTimeout = ((handler: TimerHandler, timeout: number) => {
    assert.equal(typeof handler, 'function');
    scheduled.push({ callback: handler as () => void, delay: timeout });
    return scheduled.length;
  }) as typeof fixture.dom.window.setTimeout;
  const stop = installFloatingHost(
    fixture.dom.window.document,
    fixture.options,
  );
  try {
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:remove' });
    fixture.disconnect();
    assert.equal(scheduled[0]?.delay, 1000);
    scheduled[0]!.callback();
    const first = fixture.sent[0] as { boot: string };
    const reconnected = fixture.sent[2] as { boot: string; dismissed: boolean };
    assert.notEqual(reconnected.boot, first.boot);
    assert.equal(reconnected.dismissed, true);
    assert.equal(fixture.roots.length, 1);
    fixture.disconnect();
    scheduled[1]!.callback();
    fixture.disconnect();
    scheduled[2]!.callback();
    fixture.disconnect();
    assert.deepEqual(
      scheduled.map((item) => item.delay),
      [1000, 2000, 4000],
    );
    assert.equal(fixture.counts().connections, 4);
  } finally {
    stop();
    fixture.dom.window.close();
  }
});

test('confirmed registrations reset reconnect backoff across more than three worker restarts without reopening a closed companion', () => {
  const fixture = setup();
  const scheduled: { callback: () => void; delay: number }[] = [];
  fixture.dom.window.setTimeout = ((handler: TimerHandler, timeout: number) => {
    assert.equal(typeof handler, 'function');
    scheduled.push({ callback: handler as () => void, delay: timeout });
    return scheduled.length;
  }) as typeof fixture.dom.window.setTimeout;
  const stop = installFloatingHost(
    fixture.dom.window.document,
    fixture.options,
  );
  try {
    fixture.send({ type: 'floating:registered' });
    fixture.send({ type: 'floating:mount' });
    fixture.send({ type: 'floating:remove' });
    fixture.send({ type: 'floating:registered' });
    for (let restart = 0; restart < 4; restart += 1) {
      fixture.disconnect();
      assert.equal(scheduled[restart]?.delay, 1000);
      scheduled[restart]!.callback();
      fixture.send({ type: 'floating:registered' });
      const registration = fixture.sent.at(-1) as { dismissed: boolean };
      assert.equal(registration.dismissed, true);
      assert.equal(fixture.roots.length, 1);
      assert.equal(
        fixture.roots[0]!.querySelector('iframe')!.isConnected,
        false,
      );
    }
    assert.equal(fixture.counts().connections, 5);
    // A subsequent unavailable worker still has only three consecutive retries.
    for (let attempt = 4; attempt < 7; attempt += 1) {
      fixture.disconnect();
      scheduled[attempt]!.callback();
    }
    fixture.disconnect();
    assert.deepEqual(
      scheduled.map(({ delay }) => delay),
      [1000, 1000, 1000, 1000, 1000, 2000, 4000],
    );
    assert.equal(fixture.counts().connections, 8);
  } finally {
    stop();
    fixture.dom.window.close();
  }
});

test('compact height updates are bounded and keep controls in a scrollable viewport at enlarged text', () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    const element = fixture.dom.window.document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    fixture.send({ type: 'floating:layout', expanded: false, height: 480 });
    assert.equal(element.style.height, '480px');
    fixture.send({ type: 'floating:layout', expanded: false, height: 20000 });
    assert.equal(element.style.height, '480px');
    Object.defineProperty(fixture.dom.window, 'innerHeight', { value: 300 });
    fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize'));
    assert.equal(element.style.height, '284px');
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('focused page controls stay clear; narrow viewport clamps the frame without moving focus', () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    const { window } = fixture.dom;
    const source = window.document.getElementById('source')!;
    Object.defineProperty(source, 'getBoundingClientRect', {
      value: () => ({
        top: 690,
        bottom: 750,
        left: 800,
        right: 1000,
        width: 200,
        height: 60,
      }),
    });
    source.focus();
    fixture.send({ type: 'floating:mount' });
    const element = window.document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    assert.equal(element.style.top, '8px');
    assert.equal(window.document.activeElement, source);
    fixture.send({ type: 'floating:layout', expanded: false, height: 252 });
    Object.defineProperty(window, 'innerWidth', {
      value: 320,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 400,
      configurable: true,
    });
    window.dispatchEvent(new window.Event('resize'));
    assert.equal(element.style.width, '304px');
    assert.ok(parseFloat(element.style.left) >= 0);
    assert.ok(
      parseFloat(element.style.top) + parseFloat(element.style.height) <= 400,
    );
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('small launcher, active toolbar and expanded layouts retain one frame and respect enlarged-text viewport bounds', () => {
  const fixture = setup();
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    const element = fixture.dom.window.document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    const frame = fixture.roots[0]!.querySelector('iframe')!;
    assert.equal(element.style.width, '80px');
    assert.equal(element.style.height, '80px');
    fixture.send({
      type: 'floating:layout',
      expanded: false,
      launcher: true,
      width: 156,
      height: 80,
    });
    assert.equal(element.style.width, '156px');
    assert.equal(element.style.height, '80px');
    fixture.send({ type: 'floating:layout', expanded: false, height: 380 });
    assert.equal(element.style.width, '400px');
    assert.equal(element.style.height, '380px');
    fixture.send({ type: 'floating:layout', expanded: true });
    assert.equal(element.style.width, '480px');
    fixture.send({
      type: 'floating:layout',
      expanded: false,
      launcher: true,
      width: 310,
      height: 150,
    });
    Object.defineProperty(fixture.dom.window, 'innerWidth', { value: 280 });
    Object.defineProperty(fixture.dom.window, 'innerHeight', { value: 140 });
    fixture.dom.window.dispatchEvent(new fixture.dom.window.Event('resize'));
    assert.equal(element.style.width, '264px');
    assert.equal(element.style.height, '124px');
    assert.equal(fixture.roots.length, 1);
    assert.equal(frame.isConnected, true);
    assert.deepEqual(fixture.sent, [{ type: 'floating:host-ready', boot }]);
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('return focus skips the companion, restores the source control and falls back to the orders heading', () => {
  const fixture = setup();
  const { document } = fixture.dom.window;
  const source = document.getElementById('source')!;
  source.focus();
  const host = fixture.start();
  try {
    fixture.send({ type: 'floating:mount' });
    const element = document.querySelector<HTMLElement>(
      '[data-vsual-floating-host]',
    )!;
    element.tabIndex = -1;
    element.focus();
    fixture.send({ type: 'floating:focus-page' });
    assert.equal(document.activeElement, source);
    source.remove();
    element.focus();
    fixture.send({ type: 'floating:focus-page' });
    const heading = document.querySelector('h1')!;
    assert.equal(document.activeElement, heading);
    assert.equal(heading.getAttribute('tabindex'), '-1');
    element.focus();
    assert.equal(heading.hasAttribute('tabindex'), false);
  } finally {
    host?.dispose();
    fixture.dom.window.close();
  }
});

test('focus memory never reads input values and skips disabled or inert return targets', () => {
  const fixture = setup();
  const { document } = fixture.dom.window;
  const source = document.getElementById('source') as HTMLButtonElement;
  source.focus();
  const memory = new PageFocusMemory(document, () => false);
  try {
    source.disabled = true;
    assert.deepEqual(memory.restore(), { focused: true, restored: false });
  } finally {
    memory.dispose();
    fixture.dom.window.close();
  }
});

test('only the exact extension service worker can relay orders requests', () => {
  const sender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/background.js`,
  };
  assert.equal(trustedOrdersWorkerSender(sender, extensionId), true);
  for (const invalid of [
    undefined,
    { ...sender, id: 'another-extension' },
    { ...sender, tab: { id: 12 } },
    { ...sender, url: `${sender.url}?anything` },
    { ...sender, url: `${sender.url}#anything` },
    { ...sender, url: frameUrl },
    { ...sender, url: `${origin}/background.js` },
  ]) {
    assert.equal(
      trustedOrdersWorkerSender(
        invalid as chrome.runtime.MessageSender | undefined,
        extensionId,
      ),
      false,
    );
  }
});
