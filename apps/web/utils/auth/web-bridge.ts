import {
  AUTH_ATTEMPT_MS,
  authReplySchema,
  authWebsiteMessageSchema,
  type AuthFailureCode,
  type AuthStatus,
  type AuthWebsiteMessage,
  type UiLanguage,
} from '@adc/contracts';

export interface ExtensionAttempt {
  recipient: string;
  attemptId: string;
}
export class WebAuthError extends Error {
  readonly code: AuthFailureCode;
  constructor(code: AuthFailureCode) {
    super(code);
    this.code = code;
  }
}

export function extensionAttempt(
  params: URLSearchParams,
): ExtensionAttempt | null {
  if (!params.has('extension') && !params.has('attempt')) return null;
  if (params.has('lang') && !['en', 'vi'].includes(params.get('lang')!))
    throw new WebAuthError('INVALID_ATTEMPT');
  if (
    [...params.keys()].some(
      (key) =>
        !['extension', 'attempt', 'lang'].includes(key) ||
        params.getAll(key).length !== 1,
    )
  )
    throw new WebAuthError('INVALID_ATTEMPT');
  const parsed = authWebsiteMessageSchema.safeParse({
    type: 'auth:hello',
    recipient: params.get('extension'),
    attemptId: params.get('attempt'),
  });
  if (!parsed.success) throw new WebAuthError('INVALID_ATTEMPT');
  return { recipient: parsed.data.recipient, attemptId: parsed.data.attemptId };
}

export type AuthSender = (
  recipient: string,
  message: AuthWebsiteMessage,
) => Promise<unknown>;
interface BrowserRuntime {
  sendMessage: (
    recipient: string,
    message: AuthWebsiteMessage,
    callback: (reply: unknown) => void,
  ) => void;
  lastError?: { message?: string };
}

export function browserAuthSender(browserWindow: Window): AuthSender {
  const runtime = (
    browserWindow as Window & { chrome?: { runtime?: BrowserRuntime } }
  ).chrome?.runtime;
  return (recipient, message) =>
    new Promise((resolve, reject) => {
      if (!runtime?.sendMessage) {
        reject(new WebAuthError('INVALID_ATTEMPT'));
        return;
      }
      // The proof and password travel only through Chrome's targeted external
      // messaging channel to the allowlisted extension; never window.postMessage.
      const timer = setTimeout(
        () => reject(new WebAuthError('UNAVAILABLE')),
        message.type === 'auth:google' ? AUTH_ATTEMPT_MS + 10_000 : 120_000,
      );
      try {
        runtime.sendMessage(recipient, message, (reply) => {
          clearTimeout(timer);
          if (runtime.lastError) reject(new WebAuthError('UNAVAILABLE'));
          else resolve(reply);
        });
      } catch {
        clearTimeout(timer);
        reject(new WebAuthError('UNAVAILABLE'));
      }
    });
}

export class WebExtensionBridge {
  private secret: string | null = null;
  private generation = 0;
  private started = false;
  private cancelled = false;
  private cancelRequested = false;
  readonly attempt: ExtensionAttempt;
  private readonly send: AuthSender;

  constructor(attempt: ExtensionAttempt, send: AuthSender) {
    this.attempt = attempt;
    this.send = send;
  }

  private async request(message: AuthWebsiteMessage, hello = false) {
    const generation = this.generation;
    const checked = authWebsiteMessageSchema.parse(message);
    const result = authReplySchema.safeParse(
      await this.send(this.attempt.recipient, checked),
    );
    if (generation !== this.generation) {
      // An explicit Cancel may precede the handshake reply. Use a valid late
      // proof only to cancel that same attempt; never retain it or connect it.
      // React effect disposal alone must not cancel a replacement bridge.
      if (
        hello &&
        this.cancelRequested &&
        result.success &&
        result.data.ok &&
        result.data.secret &&
        !result.data.headers &&
        (!result.data.status.attempt ||
          result.data.status.attempt.id === this.attempt.attemptId)
      ) {
        await this.send(this.attempt.recipient, {
          type: 'auth:cancel',
          ...this.attempt,
          secret: result.data.secret,
        }).catch(() => undefined);
      }
      throw new WebAuthError('CANCELLED');
    }
    if (!result.success) throw new WebAuthError('INVALID_ATTEMPT');
    if (!result.data.ok) throw new WebAuthError(result.data.error);
    if (
      result.data.status.attempt &&
      result.data.status.attempt.id !== this.attempt.attemptId
    )
      throw new WebAuthError('INVALID_ATTEMPT');
    if (result.data.headers || (!hello && result.data.secret))
      throw new WebAuthError('INVALID_ATTEMPT');
    return result.data;
  }

  async hello(): Promise<{ status: AuthStatus; google: boolean }> {
    if (this.started || this.cancelled)
      throw new WebAuthError('INVALID_ATTEMPT');
    this.started = true;
    const reply = await this.request(
      { type: 'auth:hello', ...this.attempt },
      true,
    );
    if (!reply.secret) throw new WebAuthError('INVALID_ATTEMPT');
    this.secret = reply.secret;
    return { status: reply.status, google: reply.google === true };
  }

  async action(
    type: 'auth:status' | 'auth:google' | 'auth:return',
  ): Promise<AuthStatus> {
    if (!this.secret || this.cancelled)
      throw new WebAuthError('INVALID_ATTEMPT');
    return (await this.request({ type, ...this.attempt, secret: this.secret }))
      .status;
  }

  async password(email: string, password: string): Promise<AuthStatus> {
    if (!this.secret || this.cancelled)
      throw new WebAuthError('INVALID_ATTEMPT');
    return (
      await this.request({
        type: 'auth:password',
        ...this.attempt,
        secret: this.secret,
        email,
        password,
      })
    ).status;
  }

  async cancel(): Promise<void> {
    const secret = this.secret;
    this.cancelled = true;
    this.cancelRequested = true;
    this.secret = null;
    this.generation += 1;
    if (secret)
      await this.send(this.attempt.recipient, {
        type: 'auth:cancel',
        ...this.attempt,
        secret,
      }).catch(() => undefined);
  }

  dispose() {
    this.generation += 1;
    this.secret = null;
    this.cancelled = true;
  }
}

export function authLanguage(value: string | null): UiLanguage {
  return value === 'vi' ? 'vi' : 'en';
}
