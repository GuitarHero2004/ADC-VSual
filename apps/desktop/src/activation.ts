import type { DesktopActivationEvent } from './bridge.ts';

interface ActivationDependencies {
  foreground(): Promise<string | null>;
  ownSource(): string;
  stopWork(): void;
  show(): void;
  announce(event: DesktopActivationEvent): void;
}

const windowHandle = (source: string | null): string | null =>
  source && /^window:[1-9][0-9]*:[01]$/.test(source)
    ? source.split(':')[1]!
    : null;

/** Select metadata before taking focus. No capture or authentication occurs here. */
export class DesktopActivation {
  nativeId: string | null = null;
  revision = 0;
  private pending: Promise<void> | null = null;
  private pendingEvent: DesktopActivationEvent | null = null;
  private readonly dependencies: ActivationDependencies;

  constructor(dependencies: ActivationDependencies) {
    this.dependencies = dependencies;
  }

  activate(kind: DesktopActivationEvent['kind'] = 'open'): Promise<void> {
    if (this.pending) {
      // A deliberate Talk arriving during startup upgrades the queued passive open.
      if (kind === 'talk' && this.pendingEvent?.kind === 'open') {
        this.pendingEvent.kind = 'talk';
        this.dependencies.announce({ ...this.pendingEvent });
      }
      return this.pending;
    }
    const revision = ++this.revision;
    const event: DesktopActivationEvent = { id: crypto.randomUUID(), kind };
    this.pendingEvent = event;
    if (kind === 'open') this.dependencies.stopWork();
    const work = Promise.resolve()
      .then(() => this.dependencies.foreground())
      .catch(() => null)
      .then((source) => {
        if (revision !== this.revision) return;
        const handle = windowHandle(source);
        // Electron appends a Chromium window identifier, which can exceed 1.
        // The foreground probe uses our own fixed suffix; compare their HWNDs.
        const ownHandle =
          this.dependencies
            .ownSource()
            .match(/^window:([1-9][0-9]*):[0-9]+$/)?.[1] ?? null;
        // Electron's isFocused() may disagree with Windows. Only a native
        // match with our own window permits reusing the previously bound target.
        if (!handle || handle !== ownHandle)
          this.nativeId = handle ? source : null;
        this.dependencies.show();
        if (event.kind === 'open') this.dependencies.announce({ ...event });
      })
      .finally(() => {
        if (this.pending === work) {
          this.pending = null;
          this.pendingEvent = null;
        }
      });
    this.pending = work;
    // Recording must stop/review before a silence deadline, without waiting for
    // the native lookup. Idle Talk awaits ready() before selecting its target.
    if (kind === 'talk') this.dependencies.announce({ ...event });
    return work;
  }

  ready(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  invalidate(clearTarget = false): void {
    this.revision++;
    this.pending = null;
    this.pendingEvent = null;
    if (clearTarget) this.nativeId = null;
  }
}
