interface ActivationDependencies {
  foreground(): Promise<string | null>;
  ownSource(): string;
  stopWork(): void;
  show(): void;
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
  private readonly dependencies: ActivationDependencies;

  constructor(dependencies: ActivationDependencies) {
    this.dependencies = dependencies;
  }

  activate(): Promise<void> {
    if (this.pending) return this.pending;
    const revision = ++this.revision;
    this.dependencies.stopWork();
    const work = Promise.resolve()
      .then(() => this.dependencies.foreground())
      .catch(() => null)
      .then((source) => {
        if (revision !== this.revision) return;
        const handle = windowHandle(source);
        // Electron's isFocused() may disagree with Windows. Only a native
        // match with our own window permits reusing the previously bound target.
        if (!handle || handle !== windowHandle(this.dependencies.ownSource()))
          this.nativeId = handle ? source : null;
        this.dependencies.show();
      })
      .finally(() => {
        if (this.pending === work) this.pending = null;
      });
    this.pending = work;
    return work;
  }

  invalidate(clearTarget = false): void {
    this.revision++;
    this.pending = null;
    if (clearTarget) this.nativeId = null;
  }
}
