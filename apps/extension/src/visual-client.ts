import { VISUAL_LIMITS, type VisualSnapshot } from '@adc/contracts';
import {
  VISUAL_PORT,
  parseVisualReply,
  type VisualMessage,
  type VisualReply,
  type VisualSource,
  type VisualScope,
  type VisualTaskState,
  type VisualCaptureResult,
} from './visual-protocol.ts';
export class VisualPageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
/** Only extension documents create this port; page scripts receive no pixels or credentials. */
export class VisualPageClient {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<
    string,
    {
      resolve(value: VisualReply): void;
      reject(error: Error): void;
      cleanup(): void;
    }
  >();
  private browser: Pick<typeof chrome, 'runtime'>;
  private onCancel: () => void;
  constructor(browser: Pick<typeof chrome, 'runtime'>, onCancel: () => void) {
    this.browser = browser;
    this.onCancel = onCancel;
  }
  private connect() {
    if (this.port) return this.port;
    const port = this.browser.runtime.connect({ name: VISUAL_PORT });
    this.port = port;
    port.onMessage.addListener((value) => {
      if (this.port !== port) return;
      const reply = parseVisualReply(value);
      if (!reply) return;
      if (reply.type === 'visual:cancelled') {
        this.reset();
        this.onCancel();
        return;
      }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      pending.cleanup();
      if (reply.type === 'visual:error')
        pending.reject(new VisualPageError(reply.code));
      else pending.resolve(reply);
    });
    port.onDisconnect.addListener(() => {
      void this.browser.runtime.lastError;
      if (this.port === port) {
        this.port = null;
        this.rejectPending();
        // Capture may already have finished while model/TTS work is pending.
        // Losing the worker also loses its snapshot owner, not only RPCs.
        this.onCancel();
      }
    });
    return port;
  }
  private rejectPending() {
    for (const work of this.pending.values()) {
      work.cleanup();
      work.reject(new VisualPageError('CANCELLED'));
    }
    this.pending.clear();
  }
  private request(
    message: Extract<VisualMessage, { id: string }>,
    signal: AbortSignal,
  ): Promise<VisualReply> {
    signal.throwIfAborted();
    const port = this.connect();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        this.pending.delete(message.id);
        try {
          port.postMessage({ type: 'visual:cancel', id: message.id });
        } catch {
          /* Worker loss is cancellation. */
        }
        reject(signal.reason ?? new VisualPageError('CANCELLED'));
      };
      const timer = setTimeout(() => {
        abort();
      }, VISUAL_LIMITS.captureStageTimeoutMs + VISUAL_LIMITS.preparationTimeoutMs);
      this.pending.set(message.id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try {
        port.postMessage(message);
      } catch {
        abort();
      }
    });
  }
  async capture(
    source: VisualSource,
    scope: VisualScope,
    signal: AbortSignal,
  ): Promise<VisualCaptureResult> {
    const response = await this.request(
      { type: 'visual:capture', id: crypto.randomUUID(), source, scope },
      signal,
    );
    if (response.type !== 'visual:result')
      throw new VisualPageError('VISUAL_UNSUPPORTED');
    return { snapshot: response.snapshot, images: response.images };
  }
  async verify(snapshot: VisualSnapshot, signal: AbortSignal) {
    try {
      const reply = await this.request(
        { type: 'visual:verify', id: crypto.randomUUID(), snapshot },
        signal,
      );
      return (
        reply.type === 'visual:verified' && reply.current && !signal.aborted
      );
    } catch {
      return false;
    }
  }
  setTaskState(source: VisualSource, state: VisualTaskState) {
    this.connect().postMessage({ type: 'visual:state', source, ...state });
  }
  reset() {
    try {
      this.port?.postMessage({ type: 'visual:reset' });
    } catch {
      /* Already disconnected. */
    }
    this.rejectPending();
  }
  dispose() {
    this.reset();
    const port = this.port;
    this.port = null;
    port?.disconnect();
  }
}
