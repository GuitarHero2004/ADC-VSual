import {
  DEFAULT_DESKTOP_PREFERENCES,
  parseDesktopPreferences,
  type DesktopPreferences,
  type DesktopShortcut,
  type DesktopState,
} from './bridge.ts';

export interface DesktopShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface DesktopPreferencesStore {
  load(): Promise<unknown>;
  save(preferences: DesktopPreferences): Promise<void>;
}

/** Owns only the shortcuts it registered and serializes preference writes. */
export class DesktopSettings {
  #registry: DesktopShortcutRegistry;
  #store: DesktopPreferencesStore;
  #activate: () => void;
  #publish: (state: DesktopState) => void;
  #owned = new Set<DesktopShortcut>();
  #disposed = false;
  #pending: Promise<void> = Promise.resolve();
  #initializing: Promise<void> | undefined;
  #state: DesktopState = {
    preferences: { ...DEFAULT_DESKTOP_PREFERENCES },
    shortcutRegistered: false,
    preferencesSaved: true,
    issue: null,
  };

  constructor(
    registry: DesktopShortcutRegistry,
    store: DesktopPreferencesStore,
    activate: () => void,
    publish: (state: DesktopState) => void,
  ) {
    this.#registry = registry;
    this.#store = store;
    this.#activate = activate;
    this.#publish = publish;
  }

  initialize(): Promise<DesktopState> {
    if (!this.#initializing) {
      this.#initializing = this.#enqueue(async () => {
        if (this.#disposed) return;
        let preferences = { ...DEFAULT_DESKTOP_PREFERENCES };
        try {
          preferences = {
            ...parseDesktopPreferences(await this.#store.load()),
          };
        } catch {
          // A first launch or unusable saved record starts with defaults.
        }
        if (this.#disposed) return;
        const registered = this.#register(preferences.shortcut);
        this.#state = {
          preferences,
          shortcutRegistered: registered,
          preferencesSaved: true,
          issue: registered ? null : 'shortcut_unavailable',
        };
        this.#notify();
      });
    }
    return this.#initializing.then(() => this.snapshot());
  }

  async update(input: unknown): Promise<DesktopState> {
    // Validate and copy before waiting so callers cannot mutate queued input.
    const preferences = { ...parseDesktopPreferences(input) };
    if (this.#disposed) throw new Error('Desktop settings are unavailable.');
    const initialized = this.initialize();
    await this.#enqueue(async () => {
      await initialized;
      if (this.#disposed) return;

      // Reserve the replacement before releasing a working shortcut.
      if (!this.#register(preferences.shortcut)) {
        this.#state = { ...this.#state, issue: 'shortcut_unavailable' };
        this.#notify();
        return;
      }
      for (const previous of this.#owned) {
        if (previous !== preferences.shortcut) this.#release(previous);
      }
      this.#state = {
        preferences,
        shortcutRegistered: true,
        preferencesSaved: false,
        issue: null,
      };

      let saved = false;
      try {
        await this.#store.save({ ...preferences });
        saved = true;
      } catch {
        // Keep usable settings in this session and expose a safe, retryable issue.
      }
      if (this.#disposed) return;
      this.#state = {
        ...this.#state,
        preferencesSaved: saved,
        issue: saved ? null : 'preferences_not_saved',
      };
      this.#notify();
    });
    return this.snapshot();
  }

  snapshot(): DesktopState {
    return { ...this.#state, preferences: { ...this.#state.preferences } };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const shortcut of this.#owned) this.#release(shortcut);
    this.#state = { ...this.#state, shortcutRegistered: false };
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.#pending.then(operation);
    // A rejected operation must not prevent later updates from running.
    this.#pending = pending.catch(() => undefined);
    return pending;
  }

  #register(shortcut: DesktopShortcut): boolean {
    if (this.#disposed) return false;
    if (this.#owned.has(shortcut)) return true;
    try {
      const registered = this.#registry.register(shortcut, () => {
        if (
          !this.#disposed &&
          this.#owned.has(shortcut) &&
          this.#state.preferences.shortcut === shortcut
        ) {
          this.#activate();
        }
      });
      if (registered) this.#owned.add(shortcut);
      return registered;
    } catch {
      return false;
    }
  }

  #release(shortcut: DesktopShortcut): void {
    try {
      this.#registry.unregister(shortcut);
      this.#owned.delete(shortcut);
    } catch {
      // Retain ownership so disposal can retry releasing this shortcut.
    }
  }

  #notify(): void {
    if (this.#disposed) return;
    try {
      this.#publish(this.snapshot());
    } catch {
      // A closing renderer must not interrupt persistence or poison the queue.
    }
  }
}
