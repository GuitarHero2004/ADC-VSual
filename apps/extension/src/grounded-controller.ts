import {
  groundedRequestSchema,
  groundedResponseSchema,
  structuredRequestSchema,
  structuredResponseSchema,
  visualRequestSchema,
  visualResponseSchema,
  VISUAL_LIMITS,
  STRUCTURED_LIMITS,
  usageLimitSchema,
  voiceErrorResponseSchema,
  type GroundedRequest,
  type GroundedResponse,
  type GroundedSnapshot,
  type StructuredRequest,
  type StructuredResponse,
  type StructuredSnapshot,
  type VisualRequest,
  type VisualResponse,
  type VisualSnapshot,
  type UiLanguage,
  type UsageLimit,
} from '@adc/contracts';
import type { OrdersPageContext } from './page-context.ts';
import {
  chooseReadingMethod,
  type ReadingMethod,
  type VisualScope,
} from './reading-method.ts';

type Page = Pick<
  OrdersPageContext,
  | 'getContext'
  | 'capture'
  | 'verify'
  | 'subscribe'
  | 'returnToPage'
  | 'reset'
  | 'dispose'
> & {
  prepareContext?(): ReturnType<OrdersPageContext['getContext']>;
  captureVisual?(
    scope: VisualScope,
    signal: AbortSignal,
    expectedOrigin: string,
    expectedTabId?: number,
  ): Promise<{ snapshot: VisualSnapshot; images: VisualRequest['images'] }>;
  verifyVisual?(
    snapshot: VisualSnapshot,
    signal: AbortSignal,
  ): Promise<boolean>;
  setTaskState?(state: { capturing: boolean; recovering: boolean }): void;
};
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
  question: string;
  snapshot: CompanionSnapshot | null;
  result: CompanionResponse | null;
  sectionId: string | null;
  resultLanguage: UiLanguage | null;
  error: string | null;
  errorRequestId: string | null;
  errorUsage: UsageLimit | null;
  stale: boolean;
  reader: ReadingMethod | null;
  scopeRecovery: boolean;
}
export type CompanionSnapshot =
  GroundedSnapshot | StructuredSnapshot | VisualSnapshot;
export type CompanionRequest =
  GroundedRequest | StructuredRequest | VisualRequest;
export type CompanionResponse =
  GroundedResponse | StructuredResponse | VisualResponse;
export function isVisualSnapshot(
  snapshot: CompanionSnapshot,
): snapshot is VisualSnapshot {
  return 'source_kind' in snapshot && snapshot.source_kind === 'visual_page';
}
export function isStructuredSnapshot(
  snapshot: CompanionSnapshot,
): snapshot is StructuredSnapshot {
  return (
    'source_kind' in snapshot && snapshot.source_kind === 'structured_page'
  );
}
export type GroundedTransport = (
  input: CompanionRequest,
  signal: AbortSignal,
) => Promise<CompanionResponse>;

/** Session-local page work; browser lifetime and response order never grant authority. */
export class GroundedController {
  private state: GroundedState = {
    phase: 'idle',
    context: null,
    question: '',
    snapshot: null,
    result: null,
    sectionId: null,
    resultLanguage: null,
    error: null,
    errorRequestId: null,
    errorUsage: null,
    stale: false,
    reader: null,
    scopeRecovery: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private contextGeneration = 0;
  private request: AbortController | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private automaticSpeechRequest: string | null = null;
  private scopeRecoveryKey: string | null = null;
  private visualScope: VisualScope = 'current_view';
  private speechDeadlineAt: number | null = null;
  private unsubscribe: () => void;
  private page: Page;
  private transport: GroundedTransport;
  private stopMedia: (preserveAnswerSpeech?: boolean) => void;
  private readonly continueAnswerAcrossTabs: boolean;

  constructor(
    page: Page,
    transport: GroundedTransport,
    stopMedia: (preserveAnswerSpeech?: boolean) => void,
    options: { continueAnswerAcrossTabs?: boolean } = {},
  ) {
    this.page = page;
    this.transport = transport;
    this.stopMedia = stopMedia;
    this.continueAnswerAcrossTabs = options.continueAnswerAcrossTabs === true;
    this.unsubscribe = page.subscribe((reason) => {
      if (reason === 'tab') {
        if (!this.pauseForTab()) void this.refreshContext();
        return;
      }
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
    this.state = {
      ...this.state,
      ...('error' in patch ? { errorRequestId: null } : {}),
      ...('error' in patch && patch.error !== 'APP_RATE_LIMITED'
        ? { errorUsage: null }
        : {}),
      ...patch,
    };
    this.listeners.forEach((listener) => listener());
    this.page.setTaskState?.({
      capturing:
        this.state.reader === 'visual_page' && this.state.phase === 'reading',
      recovering:
        !!this.state.question.trim() &&
        (this.state.error === 'PAGE_PERMISSION_REQUIRED' ||
          (this.state.context?.permission === 'required' &&
            this.state.context.visual?.permission !== 'granted')),
    });
  }
  getSpeechDeadline() {
    return this.speechDeadlineAt;
  }
  private current(id: number) {
    return !this.disposed && id === this.generation;
  }
  get busy() {
    return (
      this.state.phase === 'reading' || this.state.phase === 'understanding'
    );
  }
  /** Only a fresh, accepted question can reserve one automatic read-back. */
  claimAutomaticSpeech(): CompanionResponse | null {
    const requestId = this.automaticSpeechRequest;
    this.automaticSpeechRequest = null;
    return !this.disposed &&
      this.state.phase === 'ready' &&
      !this.state.stale &&
      this.state.result?.request_id === requestId
      ? this.state.result
      : null;
  }
  discardAutomaticSpeech() {
    this.automaticSpeechRequest = null;
  }
  async refreshContext(prepare = false) {
    const lookup = ++this.contextGeneration;
    try {
      const context = await (prepare && this.page.prepareContext
        ? this.page.prepareContext()
        : this.page.getContext());
      if (this.disposed || lookup !== this.contextGeneration) return;
      const previous = this.state.context;
      const changedOrigin =
        previous !== null &&
        (context.origin !== previous.origin ||
          (context.sourceKind ?? 'orders') !==
            (previous.sourceKind ?? 'orders'));
      if (changedOrigin) {
        this.cancel();
        this.page.reset();
        this.update({
          snapshot: null,
          result: null,
          stale: false,
        });
      }
      this.update({ context });
    } catch {
      if (lookup === this.contextGeneration)
        this.update({
          context: null,
          ...(this.state.phase === 'error' && this.state.error
            ? {}
            : { error: 'PAGE_UNAVAILABLE' }),
        });
    }
  }
  /** Tab hiding/navigation clears private content without changing browser access. */
  clearTransient(preserveQuestion = false) {
    ++this.contextGeneration;
    this.cancel();
    this.update({
      question: preserveQuestion ? this.state.question : '',
      snapshot: null,
      result: null,
      resultLanguage: null,
      sectionId: null,
      phase: 'idle',
      error: null,
      errorUsage: null,
      stale: false,
      scopeRecovery: false,
    });
  }
  /** An accepted floating answer stays with its owning source while another tab is active. */
  pauseForTab(): boolean {
    if (this.disposed) return false;
    if (
      !this.continueAnswerAcrossTabs ||
      !this.state.result ||
      this.state.stale ||
      this.busy
    ) {
      this.invalidate();
      return false;
    }
    ++this.contextGeneration;
    ++this.generation;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.request?.abort();
    this.request = undefined;
    this.discardAutomaticSpeech();
    // The owning document keeps its accepted answer/audio. Recording and any
    // armed silence submission still stop; a tab switch never starts new work.
    this.stopMedia(true);
    return true;
  }
  setQuestion(question: string) {
    if (question === this.state.question) return;
    if (this.busy) this.cancel();
    this.scopeRecoveryKey = null;
    this.update({ question, scopeRecovery: false });
  }
  setSection(sectionId: string | null) {
    if (this.busy) this.cancel();
    this.update({ sectionId });
  }
  cancel = (stopMedia = true) => {
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.discardAutomaticSpeech();
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    if (stopMedia) this.stopMedia();
    this.update({
      phase: this.state.stale ? 'stale' : 'cancelled',
      error: this.state.stale ? 'STALE_CONTEXT' : null,
      scopeRecovery: false,
    });
  };
  private invalidate() {
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.discardAutomaticSpeech();
    const hadWork = this.busy || this.state.snapshot !== null;
    // A later focus/source event must not rewrite a completed backend failure
    // as the cause of that failure. Its snapshot still becomes unusable.
    const failed = this.state.phase === 'error' && this.state.error !== null;
    const failure = failed
      ? { error: this.state.error, errorRequestId: this.state.errorRequestId }
      : {};
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    this.stopMedia();
    this.update({
      phase: failed ? 'error' : hadWork ? 'stale' : 'idle',
      error: hadWork ? 'STALE_CONTEXT' : null,
      ...failure,
      stale: hadWork,
      sectionId: null,
      scopeRecovery: false,
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
            : rawCode === 'PERMISSION_REQUIRED'
              ? 'PAGE_PERMISSION_REQUIRED'
              : rawCode === 'VISUAL_TOO_LARGE' ||
                  (rawCode === 'INPUT_TOO_LARGE' &&
                    this.state.reader === 'visual_page')
                ? 'VISUAL_SCOPE_TOO_LARGE'
                : rawCode;
    const usage = usageLimitSchema.safeParse(
      code === 'APP_RATE_LIMITED' &&
        typeof error === 'object' &&
        error !== null &&
        'usage' in error
        ? error.usage
        : undefined,
    );
    const recoverScope =
      code === 'VISUAL_SCOPE_TOO_LARGE' ||
      (code === 'VISUAL_UNSUPPORTED' && this.visualScope !== 'current_view');
    const requestReference =
      voiceErrorResponseSchema.shape.request_id.safeParse(
        typeof error === 'object' && error !== null && 'requestId' in error
          ? error.requestId
          : undefined,
      );
    this.update({
      phase:
        code === 'STALE_CONTEXT'
          ? 'stale'
          : code === 'CANCELLED'
            ? 'cancelled'
            : 'error',
      error: code,
      errorRequestId: requestReference.success ? requestReference.data : null,
      errorUsage: usage.success ? usage.data : null,
      stale: this.state.stale || code === 'STALE_CONTEXT',
      scopeRecovery: recoverScope,
      ...(code === 'STALE_CONTEXT' ? { sectionId: null } : {}),
    });
    if (recoverScope) this.scopeRecoveryKey = this.recoveryKey();
  }
  private recoveryKey() {
    const c = this.state.context;
    return JSON.stringify([
      this.state.question,
      c?.origin,
      c?.pathname,
      c?.tabId,
      c?.windowId,
      c?.documentId,
      c?.resourceKey,
    ]);
  }
  async askNarrower(scope: 'current_view' | 'first_portion') {
    if (
      !this.state.scopeRecovery ||
      this.scopeRecoveryKey !== this.recoveryKey()
    )
      return;
    await this.ask(scope);
  }
  private async capture(id: number, signal: AbortSignal) {
    const requestedContext = this.state.context;
    const context = await this.page.getContext();
    if (!this.current(id)) return null;
    this.update({ context });
    if (
      requestedContext &&
      (requestedContext.origin !== context.origin ||
        requestedContext.pathname !== context.pathname ||
        requestedContext.tabId !== context.tabId ||
        requestedContext.windowId !== context.windowId ||
        requestedContext.documentId !== context.documentId ||
        (requestedContext.sourceKind ?? 'orders') !==
          (context.sourceKind ?? 'orders'))
    )
      throw Object.assign(new Error('Page changed before capture'), {
        code: 'STALE_CONTEXT',
      });
    if (
      !context.supported ||
      context.permission === 'required' ||
      !context.origin
    )
      throw Object.assign(new Error('Page access unavailable'), {
        code:
          context.permission === 'required'
            ? 'PAGE_PERMISSION_REQUIRED'
            : 'UNSUPPORTED_PAGE',
      });
    // Reaching capture requires an explicit Ask/Inspect (or a deliberately armed
    // voice submission), never mounting, restored state or visibility events.
    const snapshot = await this.page.capture(
      signal,
      context.origin,
      context.tabId ?? undefined,
    );
    if (!this.current(id)) return null;
    if (
      snapshot.origin !== context.origin ||
      snapshot.pathname !== context.pathname ||
      isStructuredSnapshot(snapshot) !==
        (context.sourceKind === 'structured_page')
    )
      throw Object.assign(new Error('Page changed'), { code: 'STALE_CONTEXT' });
    if (
      this.state.sectionId &&
      this.state.snapshot &&
      snapshot.fingerprint !== this.state.snapshot.fingerprint
    )
      throw Object.assign(new Error('Selected section changed'), {
        code: 'STALE_CONTEXT',
      });
    this.update({ snapshot, stale: false });
    return snapshot;
  }
  async inspect() {
    if (this.busy || this.disposed) return;
    this.cancel();
    const id = this.generation;
    const request = new AbortController();
    this.request = request;
    this.update({
      phase: 'reading',
      error: null,
      result: null,
      reader:
        this.state.context?.sourceKind === 'structured_page'
          ? 'structured_page'
          : 'orders',
    });
    try {
      const snapshot = await this.capture(id, request.signal);
      if (snapshot && this.current(id)) this.update({ phase: 'ready' });
    } catch (error) {
      this.fail(error, id);
    }
  }
  async ask(scopeOverride?: VisualScope) {
    if (this.busy || this.disposed) return;
    this.cancel();
    const id = this.generation;
    const request = new AbortController();
    this.request = request;
    let choice = chooseReadingMethod(this.state.question, this.state.context);
    const taskTimeout =
      choice.method === 'visual_page'
        ? VISUAL_LIMITS.taskTimeoutMs
        : STRUCTURED_LIMITS.taskTimeoutMs;
    this.speechDeadlineAt = Date.now() + taskTimeout;
    const deadline = setTimeout(() => {
      if (!this.current(id)) return;
      request.abort();
      this.stopMedia();
      this.discardAutomaticSpeech();
      this.update({ phase: 'error', error: 'TIMEOUT' });
      ++this.generation;
    }, taskTimeout);
    this.deadline = deadline;
    this.update({
      phase: 'reading',
      error: null,
      result: null,
      scopeRecovery: false,
    });
    try {
      if (!this.state.context) {
        const context = await this.page.getContext();
        if (!this.current(id)) return;
        this.update({ context });
        choice = chooseReadingMethod(this.state.question, context);
      }
      if (
        !this.state.question.trim() ||
        Array.from(this.state.question).length >
          VISUAL_LIMITS.questionCodePoints
      )
        throw Object.assign(new Error('Invalid question'), {
          code: 'INVALID_INPUT',
        });
      this.update({ reader: choice.method });
      if (choice.method === 'visual_page') {
        await this.askVisual(id, request.signal, scopeOverride ?? choice.scope);
        return;
      }
      const snapshot = await this.capture(id, request.signal);
      if (!snapshot || !this.current(id)) return;
      const structured = isStructuredSnapshot(snapshot);
      const parsed = (
        structured ? structuredRequestSchema : groundedRequestSchema
      ).safeParse({
        request_id: crypto.randomUUID(),
        question: this.state.question,
        consent: true,
        snapshot,
        ...(structured && this.state.sectionId
          ? { section_id: this.state.sectionId }
          : {}),
      });
      if (!parsed.success)
        throw Object.assign(new Error('Invalid question or capture'), {
          code: 'INVALID_INPUT',
        });
      this.update({ phase: 'understanding' });
      const result = (
        structured ? structuredResponseSchema : groundedResponseSchema
      ).parse(await this.transport(parsed.data, request.signal));
      if (!this.current(id)) return;
      if (
        result.request_id !== parsed.data.request_id ||
        result.snapshot_id !== snapshot.snapshot_id ||
        result.fingerprint !== snapshot.fingerprint
      )
        throw Object.assign(new Error('Response does not match capture'), {
          code: 'PROVIDER_FAILURE',
        });
      if (
        structured &&
        'evidence_ids' in result &&
        result.evidence_ids.some(
          (evidenceId) =>
            !snapshot.blocks.some(
              (block) =>
                block.id === evidenceId &&
                result.included_section_ids.includes(block.section_id),
            ),
        )
      )
        throw Object.assign(new Error('Evidence does not belong to capture'), {
          code: 'PROVIDER_FAILURE',
        });
      if (
        structured &&
        'included_section_ids' in result &&
        result.included_section_ids.some(
          (sectionId) =>
            !snapshot.sections.some((section) => section.id === sectionId),
        )
      )
        throw Object.assign(new Error('Response section is outside capture'), {
          code: 'PROVIDER_FAILURE',
        });
      if (!(await this.page.verify(snapshot, request.signal)))
        throw Object.assign(new Error('Page changed'), {
          code: 'STALE_CONTEXT',
        });
      if (!this.current(id)) return;
      this.automaticSpeechRequest = result.request_id;
      this.update({
        result,
        resultLanguage: result.answer_language,
        phase: 'ready',
        error: null,
      });
    } catch (error) {
      this.fail(error, id);
    } finally {
      clearTimeout(deadline);
      if (this.deadline === deadline) this.deadline = undefined;
    }
  }
  private async askVisual(id: number, signal: AbortSignal, scope: VisualScope) {
    this.visualScope = scope;
    const intended = this.state.context;
    const context = await this.page.getContext();
    if (!this.current(id)) return;
    if (
      !intended ||
      intended.tabId !== context.tabId ||
      intended.windowId !== context.windowId ||
      intended.origin !== context.origin ||
      intended.pathname !== context.pathname ||
      intended.documentId !== context.documentId ||
      intended.resourceKey !== context.resourceKey
    )
      throw Object.assign(new Error('Source changed'), {
        code: 'STALE_CONTEXT',
      });
    this.update({ context });
    if (
      context.visual?.permission === 'required' ||
      (!context.visual && context.permission === 'required')
    )
      throw Object.assign(new Error('Browser access required'), {
        code: 'PAGE_PERMISSION_REQUIRED',
      });
    if (!this.page.captureVisual || !this.page.verifyVisual)
      throw Object.assign(new Error('Visual reader unavailable'), {
        code: 'UNSUPPORTED_PAGE',
      });
    if (!context.visual?.eligible || !context.origin)
      throw Object.assign(new Error('View unavailable'), {
        code: 'UNSUPPORTED_PAGE',
      });
    if (context.visual.permission !== 'granted')
      throw Object.assign(new Error('Browser access required'), {
        code: 'PAGE_PERMISSION_REQUIRED',
      });
    // Deliberate Ask/silence submission authorises this task, as with text
    // reading. The visible disclosure is not a second approval gate.
    const capture = await this.page.captureVisual(
      scope,
      signal,
      context.origin,
      context.tabId ?? undefined,
    );
    if (!this.current(id)) return;
    const { snapshot, images } = capture;
    if (
      snapshot.origin !== context.origin ||
      snapshot.pathname !== context.pathname ||
      snapshot.resource_key !== context.resourceKey ||
      snapshot.tab_id !== context.tabId ||
      snapshot.window_id !== context.windowId
    )
      throw Object.assign(new Error('Wrong captured source'), {
        code: 'STALE_CONTEXT',
      });
    const parsed = visualRequestSchema.safeParse({
      request_id: crypto.randomUUID(),
      question: this.state.question,
      consent: true,
      snapshot,
      images,
    });
    if (!parsed.success)
      throw Object.assign(new Error('Invalid visual capture'), {
        code: 'INVALID_INPUT',
      });
    // Only metadata enters state. Pixel buffers stay scoped to this one request.
    this.update({ snapshot, stale: false, phase: 'understanding' });
    const result = visualResponseSchema.parse(
      await this.transport(parsed.data, signal),
    );
    if (!this.current(id)) return;
    if (
      result.request_id !== parsed.data.request_id ||
      result.snapshot_id !== snapshot.snapshot_id ||
      result.fingerprint !== snapshot.fingerprint ||
      result.scope !== snapshot.scope ||
      JSON.stringify(result.coverage) !== JSON.stringify(snapshot.coverage) ||
      result.evidence.some(
        (e) => !snapshot.images.some((image) => image.id === e.image_id),
      )
    )
      throw Object.assign(new Error('Visual evidence mismatch'), {
        code: 'PROVIDER_FAILURE',
      });
    if (!(await this.page.verifyVisual(snapshot, signal)))
      throw Object.assign(new Error('Visual source changed'), {
        code: 'STALE_CONTEXT',
      });
    if (!this.current(id)) return;
    this.automaticSpeechRequest = result.request_id;
    this.update({
      result,
      resultLanguage: result.answer_language,
      phase: 'ready',
      error: null,
    });
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
      sectionId: null,
      error: null,
      errorUsage: null,
      errorRequestId: null,
    };
    this.disposed = true;
    this.listeners.clear();
  }
}
