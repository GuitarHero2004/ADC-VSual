import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_DESKTOP_PREFERENCES,
  type DesktopPreferences,
  type DesktopShortcut,
  type DesktopState,
} from './bridge.ts';
import {
  DesktopSettings,
  type DesktopPreferencesStore,
  type DesktopShortcutRegistry,
} from './settings.ts';

const replacement: DesktopPreferences = {
  language: 'vi',
  shortcut: 'Control+Alt+V',
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture(overrides: Partial<DesktopPreferencesStore> = {}) {
  const callbacks = new Map<string, () => void>();
  const conflicts = new Set<string>();
  const events: string[] = [];
  const writes: DesktopPreferences[] = [];
  const publications: DesktopState[] = [];
  let activations = 0;
  const registry: DesktopShortcutRegistry = {
    register(accelerator, callback) {
      events.push(`register:${accelerator}`);
      if (conflicts.has(accelerator)) return false;
      assert.equal(callbacks.has(accelerator), false);
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      events.push(`unregister:${accelerator}`);
      assert.equal(callbacks.has(accelerator), true);
      callbacks.delete(accelerator);
    },
  };
  const store: DesktopPreferencesStore = {
    async load() {
      return undefined;
    },
    async save(preferences) {
      writes.push({ ...preferences });
    },
    ...overrides,
  };
  const settings = new DesktopSettings(
    registry,
    store,
    () => activations++,
    (state) => publications.push(state),
  );
  return {
    settings,
    callbacks,
    conflicts,
    events,
    writes,
    publications,
    activations: () => activations,
  };
}

test('first launch uses defaults and initialization registers only once', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.settings.initialize(),
    f.settings.initialize(),
  ]);
  assert.deepEqual(first, {
    preferences: DEFAULT_DESKTOP_PREFERENCES,
    shortcutRegistered: true,
    preferencesSaved: true,
    issue: null,
  });
  assert.deepEqual(second, first);
  assert.notEqual(second.preferences, first.preferences);
  assert.equal(f.events.length, 1);
  assert.equal(f.writes.length, 0);
  f.callbacks.get(first.preferences.shortcut)?.();
  assert.equal(f.activations(), 1);
});

test('saved preferences restore and corrupt or unreadable records use defaults', async () => {
  const restored = fixture({
    async load() {
      return replacement;
    },
  });
  assert.deepEqual(
    (await restored.settings.initialize()).preferences,
    replacement,
  );
  for (const value of [
    null,
    { language: 'other' },
    { ...replacement, extra: true },
  ]) {
    const f = fixture({
      async load() {
        return value;
      },
    });
    assert.deepEqual(
      (await f.settings.initialize()).preferences,
      DEFAULT_DESKTOP_PREFERENCES,
    );
  }
  const unreadable = fixture({
    async load() {
      throw new Error('private path');
    },
  });
  assert.equal((await unreadable.settings.initialize()).issue, null);
});

test('shortcut collision keeps working settings and does not save or unregister', async () => {
  const f = fixture();
  await f.settings.initialize();
  f.conflicts.add(replacement.shortcut);
  const state = await f.settings.update(replacement);
  assert.deepEqual(state.preferences, DEFAULT_DESKTOP_PREFERENCES);
  assert.equal(state.shortcutRegistered, true);
  assert.equal(state.issue, 'shortcut_unavailable');
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.events, [
    `register:${DEFAULT_DESKTOP_PREFERENCES.shortcut}`,
    `register:${replacement.shortcut}`,
  ]);
  f.callbacks.get(DEFAULT_DESKTOP_PREFERENCES.shortcut)?.();
  assert.equal(f.activations(), 1);
  f.conflicts.clear();
  assert.equal((await f.settings.update(replacement)).issue, null);
  assert.deepEqual(f.events.slice(-2), [
    `register:${replacement.shortcut}`,
    `unregister:${DEFAULT_DESKTOP_PREFERENCES.shortcut}`,
  ]);
});

test('initial shortcut conflict remains recoverable through another shortcut', async () => {
  const f = fixture();
  f.conflicts.add(DEFAULT_DESKTOP_PREFERENCES.shortcut);
  const state = await f.settings.initialize();
  assert.equal(state.shortcutRegistered, false);
  assert.equal(state.issue, 'shortcut_unavailable');
  const recovered = await f.settings.update(replacement);
  assert.equal(recovered.shortcutRegistered, true);
  assert.equal(recovered.issue, null);
  f.settings.dispose();
  assert.deepEqual(f.events, [
    `register:${DEFAULT_DESKTOP_PREFERENCES.shortcut}`,
    `register:${replacement.shortcut}`,
    `unregister:${replacement.shortcut}`,
  ]);
});

test('language updates do not register a duplicate shortcut', async () => {
  const f = fixture();
  await f.settings.initialize();
  const state = await f.settings.update({
    ...DEFAULT_DESKTOP_PREFERENCES,
    language: 'vi',
  });
  assert.equal(state.preferences.language, 'vi');
  assert.equal(f.events.length, 1);
  assert.equal(f.writes.length, 1);
});

test('save failure retains usable session settings and a later update recovers', async () => {
  let fail = true;
  const f = fixture({
    async save() {
      if (fail) throw new Error('private disk details');
    },
  });
  const state = await f.settings.update(replacement);
  assert.deepEqual(state.preferences, replacement);
  assert.equal(state.shortcutRegistered, true);
  assert.equal(state.preferencesSaved, false);
  assert.equal(state.issue, 'preferences_not_saved');
  fail = false;
  const recovered = await f.settings.update(replacement);
  assert.equal(recovered.preferencesSaved, true);
  assert.equal(recovered.issue, null);
});

test('concurrent updates persist in order and copy input before waiting', async () => {
  const saving = deferred<void>();
  const firstStarted = deferred<void>();
  const writes: DesktopPreferences[] = [];
  const f = fixture({
    async save(preferences) {
      writes.push({ ...preferences });
      if (writes.length === 1) {
        firstStarted.resolve();
        await saving.promise;
      }
    },
  });
  const first = f.settings.update(replacement);
  await firstStarted.promise;
  const input: DesktopPreferences = {
    language: 'en',
    shortcut: 'Control+Shift+Space',
  };
  const second = f.settings.update(input);
  input.language = 'vi';
  input.shortcut = 'Control+Alt+Space';
  assert.deepEqual(writes, [replacement]);
  saving.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [
    replacement,
    { language: 'en', shortcut: 'Control+Shift+Space' },
  ]);
  assert.deepEqual(f.settings.snapshot().preferences, writes[1]);
});

test('disposal while loading prevents registration and publication', async () => {
  const loading = deferred<unknown>();
  const started = deferred<void>();
  const f = fixture({
    load() {
      started.resolve();
      return loading.promise;
    },
  });
  const initializing = f.settings.initialize();
  await started.promise;
  f.settings.dispose();
  loading.resolve(replacement);
  await initializing;
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.publications, []);
  assert.equal(f.settings.snapshot().shortcutRegistered, false);
  await assert.rejects(f.settings.update(replacement), /unavailable/);
});

test('disposal suppresses late save results and queued updates', async () => {
  const saving = deferred<void>();
  const started = deferred<void>();
  const f = fixture({
    save() {
      started.resolve();
      return saving.promise;
    },
  });
  const first = f.settings.update(replacement);
  await started.promise;
  const staleCallback = f.callbacks.get(replacement.shortcut);
  const second = f.settings.update(DEFAULT_DESKTOP_PREFERENCES);
  f.settings.dispose();
  f.settings.dispose();
  const disposedState = f.settings.snapshot();
  const eventsAtDisposal = [...f.events];
  const publicationsAtDisposal = f.publications.length;
  staleCallback?.();
  saving.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(f.settings.snapshot(), disposedState);
  assert.deepEqual(f.events, eventsAtDisposal);
  assert.equal(f.publications.length, publicationsAtDisposal);
  assert.equal(f.callbacks.size, 0);
  assert.equal(f.activations(), 0);
});

test('invalid input rejects without writes and does not poison later updates', async () => {
  const f = fixture();
  for (const value of [
    null,
    {},
    { ...replacement, extra: true },
    { ...replacement, shortcut: 'A' },
  ]) {
    await assert.rejects(f.settings.update(value));
  }
  assert.equal(f.events.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal((await f.settings.update(replacement)).issue, null);
});

test('snapshots, publications and store arguments cannot mutate internal preferences', async () => {
  const f = fixture({
    async save(preferences) {
      preferences.language = 'en';
    },
  });
  const state = await f.settings.update(replacement);
  state.preferences.language = 'en';
  f.settings.snapshot().preferences.shortcut = 'Control+Shift+Space';
  const published = f.publications.at(-1);
  assert.ok(published);
  published.preferences.shortcut = 'Control+Alt+Space';
  assert.deepEqual(f.settings.snapshot().preferences, replacement);
});

test('registration exceptions become safe issues and disposal releases only owned shortcuts', async () => {
  const unregistered: string[] = [];
  const shortcut: DesktopShortcut = 'Control+Alt+Space';
  const settings = new DesktopSettings(
    {
      register() {
        throw new Error('private platform details');
      },
      unregister(value) {
        unregistered.push(value);
      },
    },
    {
      async load() {
        return { language: 'en', shortcut };
      },
      async save() {},
    },
    () => undefined,
    () => undefined,
  );
  assert.equal((await settings.initialize()).issue, 'shortcut_unavailable');
  assert.equal(
    (await settings.update(replacement)).issue,
    'shortcut_unavailable',
  );
  settings.dispose();
  assert.deepEqual(unregistered, []);
});
