import {
  groundedRequestSchema,
  groundedResponseSchema,
  type GroundedRequest,
  type GroundedResponse,
  type GroundedSnapshot,
  type UiLanguage,
} from '@adc/contracts';
import type { OrdersPageContext } from './page-context.ts';

type Page = Pick<
  OrdersPageContext,
  | 'getContext'
  | 'capture'
  | 'verify'
  | 'subscribe'
  | 'returnToPage'
  | 'reset'
  | 'dispose'
>;
type Context = Awaited<ReturnType<Page['getContext']>>;
export type GroundedPhase =
  | 'idle'
  | 'reading'
  | 'understanding'
  | 'ready'
  | 'error'
  | 'cancelled'
  | 'stale';
export interface GroundedState {
  phase: GroundedPhase;
  context: Context | null;
  consentOrigin: string | null;
  question: string;
  snapshot: GroundedSnapshot | null;
  result: GroundedResponse | null;
  resultLanguage: UiLanguage | null;
  error: string | null;
  stale: boolean;
}
export type GroundedTransport = (
  input: GroundedRequest,
  signal: AbortSignal,
) => Promise<GroundedResponse>;

/** Session-local page work; browser lifetime and response order never grant authority. */
export class GroundedController {
  private state: GroundedState = {
    phase: 'idle',
    context: null,
    consentOrigin: null,
    question: '',
    snapshot: null,
    result: null,
    resultLanguage: null,
    error: null,
    stale: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private contextGeneration = 0;
  private request: AbortController | undefined;
  private disposed = false;
  private unsubscribe: () => void;
  private page: Page;
  private transport: GroundedTransport;
  private stopMedia: () => void;

  constructor(page: Page, transport: GroundedTransport, stopMedia: () => void) {
    this.page = page;
    this.transport = transport;
    this.stopMedia = stopMedia;
    this.unsubscribe = page.subscribe(() => {
      this.invalidate();
      void this.refreshContext();
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<GroundedState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private current(id: number) {
    return !this.disposed && id === this.generation;
  }
  get busy() {
    return (
      this.state.phase === 'reading' || this.state.phase === 'understanding'
    );
  }
  async refreshContext() {
    const lookup = ++this.contextGeneration;
    try {
      const context = await this.page.getContext();
      if (this.disposed || lookup !== this.contextGeneration) return;
      const changedOrigin =
        this.state.consentOrigin !== null &&
        context.origin !== this.state.consentOrigin;
      if (changedOrigin) {
        this.cancel();
        this.page.reset();
        this.update({
          consentOrigin: null,
          snapshot: null,
          result: null,
          stale: false,
        });
      }
      this.update({ context });
    } catch {
      if (lookup === this.contextGeneration)
        this.update({ context: null, error: 'PAGE_UNAVAILABLE' });
    }
  }
  async allow() {
    const generation = this.generation;
    const origin = this.state.context?.origin;
    await this.refreshContext();
    if (
      this.current(generation) &&
      origin &&
      this.state.context?.supported &&
      this.state.context.origin === origin
    )
      this.update({ consentOrigin: this.state.context.origin, error: null });
  }
  revoke() {
    ++this.contextGeneration;
    this.cancel();
    this.page.reset();
    this.update({
      consentOrigin: null,
      snapshot: null,
      result: null,
      phase: 'idle',
      error: null,
      stale: false,
    });
  }
  setQuestion(question: string) {
    if (question === this.state.question) return;
    if (this.busy) this.cancel();
    this.update({ question });
  }
  cancel = () => {
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    this.stopMedia();
    this.update({
      phase: this.state.stale ? 'stale' : 'cancelled',
      error: this.state.stale ? 'STALE_CONTEXT' : null,
    });
  };
  private invalidate() {
    const hadWork = this.busy || this.state.snapshot !== null;
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    this.stopMedia();
    this.update({
      phase: hadWork ? 'stale' : 'idle',
      error: hadWork ? 'STALE_CONTEXT' : null,
      stale: hadWork,
    });
  }
  private fail(error: unknown, id: number) {
    if (!this.current(id)) return;
    const rawCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'PROVIDER_FAILURE';
    const code =
      rawCode === 'CONTEXT_CHANGED'
        ? 'STALE_CONTEXT'
        : rawCode === 'INVALID_PAGE'
          ? 'INVALID_INPUT'
          : rawCode === 'UNAVAILABLE'
            ? 'PAGE_UNAVAILABLE'
            : rawCode;
    this.update({
      phase: code === 'STALE_CONTEXT' ? 'stale' : 'error',
      error: code,
      stale: this.state.stale || code === 'STALE_CONTEXT',
    });
  }
  private async capture(id: number, signal: AbortSignal) {
    const context = await this.page.getContext();
    if (!this.current(id)) return null;
    this.update({ context });
    if (!context.supported)
      throw Object.assign(new Error('Unsupported page'), {
        code: 'UNSUPPORTED_PAGE',
      });
    if (!context.origin || this.state.consentOrigin !== context.origin)
      throw Object.assign(new Error('Permission required'), {
        code: 'CONSENT_REQUIRED',
      });
    const snapshot = await this.page.capture(
      signal,
      context.origin,
      context.tabId ?? undefined,
    );
    if (!this.current(id)) return null;
    if (snapshot.origin !== this.state.consentOrigin)
      throw Object.assign(new Error('Page changed'), { code: 'STALE_CONTEXT' });
    this.update({ snapshot, stale: false });
    return snapshot;
  }
  async inspect() {
    if (this.busy || this.disposed) return;
    this.cancel();
    const id = this.generation;
    const request = new AbortController();
    this.request = request;
    this.update({ phase: 'reading', error: null, result: null });
    try {
      const snapshot = await this.capture(id, request.signal);
      if (snapshot && this.current(id)) this.update({ phase: 'ready' });
    } catch (error) {
      this.fail(error, id);
    }
  }
  async ask(language: UiLanguage) {
    if (this.busy || this.disposed) return;
    this.cancel();
    const id = this.generation;
    const request = new AbortController();
    this.request = request;
    this.update({
      phase: 'reading',
      error: null,
      result: null,
      snapshot: null,
    });
    try {
      const snapshot = await this.capture(id, request.signal);
      if (!snapshot || !this.current(id)) return;
      const parsed = groundedRequestSchema.safeParse({
        request_id: crypto.randomUUID(),
        question: this.state.question,
        language,
        consent: true,
        snapshot,
      });
      if (!parsed.success)
        throw Object.assign(new Error('Invalid question or capture'), {
          code: 'INVALID_INPUT',
        });
      this.update({ phase: 'understanding' });
      const result = groundedResponseSchema.parse(
        await this.transport(parsed.data, request.signal),
      );
      if (!this.current(id)) return;
      if (
        result.request_id !== parsed.data.request_id ||
        result.snapshot_id !== snapshot.snapshot_id ||
        result.fingerprint !== snapshot.fingerprint
      )
        throw Object.assign(new Error('Response does not match capture'), {
          code: 'PROVIDER_FAILURE',
        });
      if (!(await this.page.verify(snapshot, request.signal)))
        throw Object.assign(new Error('Page changed'), {
          code: 'STALE_CONTEXT',
        });
      if (!this.current(id)) return;
      this.update({
        result,
        resultLanguage: language,
        phase: 'ready',
        error: null,
      });
    } catch (error) {
      this.fail(error, id);
    }
  }
  returnToPage() {
    this.cancel();
    return this.page.returnToPage();
  }
  dispose() {
    this.cancel();
    this.unsubscribe();
    this.page.dispose();
    this.state = {
      ...this.state,
      question: '',
      snapshot: null,
      result: null,
      consentOrigin: null,
    };
    this.disposed = true;
    this.listeners.clear();
  }
}
