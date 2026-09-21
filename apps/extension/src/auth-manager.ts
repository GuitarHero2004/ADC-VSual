import {
  AUTH_ATTEMPT_MS,
  authPanelMessageSchema,
  authWebsiteMessageSchema,
  type AuthReply,
  type AuthStatus,
  type AuthFailureCode,
  type AuthAccessResponse,
} from '@adc/contracts';
import type { Session } from '@supabase/supabase-js';
import { AuthFlowError, type AuthGateway } from './auth.ts';

export const AUTH_RECORD_KEY = 'adc:auth:owner';
export interface AuthAttempt {
  id: string;
  secret: string;
  expiresAt: number;
  tabId: number | null;
  windowId: number | null;
  returnTabId: number | null;
  returnWindowId: number | null;
  stage: 'opening' | 'ready' | 'password' | 'google' | 'complete';
  inline?: boolean;
  inlineOwner?: string;
  inlineConnected?: boolean;
  flowId: string | null;
}
export interface AuthRecord {
  status: AuthStatus;
  session: Session | null;
  attempt: AuthAttempt | null;
}
export interface AuthManagerDependencies {
  extensionId: string;
  backend: string;
  gateway: AuthGateway;
  read(): Promise<AuthRecord | null>;
  write(value: AuthRecord): Promise<void>;
  open(
    url: string,
  ): Promise<
    Pick<AuthAttempt, 'tabId' | 'windowId' | 'returnTabId' | 'returnWindowId'>
  >;
  navigate(tabId: number, url: string): Promise<void>;
  discard(tabId: number): Promise<void>;
  focus(tabId: number): Promise<void>;
  returnToPage(attempt: AuthAttempt): Promise<void>;
  googleEnabled(): Promise<boolean>;
  launchGoogle(url: string): Promise<string | undefined>;
  googleRedirect: string;
  access(token: string): Promise<AuthAccessResponse>;
  now?(): number;
}
export interface AuthSender {
  id?: string | undefined;
  url?: string | undefined;
  frameId?: number | undefined;
  documentId?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}
export interface AuthPanelContext {
  owner: string;
  current(): boolean;
}

const failure = (error: AuthFailureCode): AuthReply => ({ ok: false, error });
const errorCode = (error: unknown): AuthFailureCode =>
  error instanceof AuthFlowError ? error.code : 'UNAVAILABLE';
function parseUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}
function emptyRecord(): AuthRecord {
  return {
    session: null,
    attempt: null,
    status: {
      phase: 'signed_out',
      account: null,
      workspace: 'unknown',
      epoch: crypto.randomUUID(),
      attempt: null,
      error: null,
      logoutConfirmed: null,
    },
  };
}

/** The worker is the sole owner of extension credentials; pages receive status only. */
export class ExtensionAuthManager {
  private queue: Promise<unknown> = Promise.resolve();
  private record: AuthRecord | null = null;
  private validation: { epoch: string; promise: Promise<AuthStatus> } | null =
    null;
  private now: () => number;
  private readonly deps: AuthManagerDependencies;
  constructor(deps: AuthManagerDependencies) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }
  // Only small state transitions are queued. Network work never blocks cancellation.
  private atomic<T>(run: (record: AuthRecord) => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      if (!this.record) {
        const loaded = (await this.deps.read()) ?? emptyRecord();
        if (
          !loaded.session &&
          loaded.attempt &&
          ['opening', 'password', 'google'].includes(loaded.attempt.stage)
        ) {
          await this.deps.gateway.clearAttempt(loaded.attempt.id);
          const next = emptyRecord();
          next.status.error = 'CANCELLED';
          await this.save(next);
        } else this.record = loaded;
      }
      return run(this.record!);
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
  private async save(record: AuthRecord) {
    await this.deps.write(record);
    this.record = record;
  }
  private snapshot() {
    return this.atomic(async (record) => record);
  }
  private async replace(
    epoch: string,
    update: (record: AuthRecord) => AuthRecord,
  ) {
    return this.atomic(async (record) => {
      if (record.status.epoch !== epoch) throw new AuthFlowError('CANCELLED');
      const next = update(record);
      await this.save(next);
      return next;
    });
  }
  private reply(status: AuthStatus): AuthReply {
    return { ok: true, status };
  }

  async start(
    language: 'en' | 'vi',
    inline = false,
    context?: AuthPanelContext,
  ): Promise<AuthReply> {
    if (inline && (!context?.current() || !context.owner))
      throw new AuthFlowError('INVALID_ATTEMPT');
    let reused = false;
    const record = await this.atomic(async (current) => {
      if (current.session) throw new AuthFlowError('ACCOUNT_CHANGE_REQUIRED');
      if (current.attempt && current.attempt.expiresAt > this.now()) {
        if (
          Boolean(current.attempt.inline) !== inline ||
          (inline && current.attempt.inlineOwner !== context?.owner)
        )
          throw new AuthFlowError('INVALID_ATTEMPT');
        reused = true;
        return current;
      }
      if (current.attempt)
        await this.deps.gateway.clearAttempt(current.attempt.id);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const attempt: AuthAttempt = {
        id: crypto.randomUUID(),
        secret: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
          '',
        ),
        expiresAt: this.now() + AUTH_ATTEMPT_MS,
        tabId: null,
        windowId: null,
        returnTabId: null,
        returnWindowId: null,
        stage: inline ? 'ready' : 'opening',
        inline,
        ...(inline && context ? { inlineOwner: context.owner } : {}),
        flowId: null,
      };
      const next = emptyRecord();
      next.attempt = attempt;
      next.status = {
        ...next.status,
        phase: 'signing_in',
        attempt: { id: attempt.id, expiresAt: attempt.expiresAt },
      };
      await this.save(next);
      return next;
    });
    if (inline) return this.reply(record.status);
    if (reused) {
      if (record.attempt?.tabId !== null && record.attempt?.tabId !== undefined)
        await this.deps.focus(record.attempt.tabId).catch(() => undefined);
      return this.reply(record.status);
    }
    const url = new URL('/auth/sign-in', this.deps.backend);
    url.searchParams.set('extension', this.deps.extensionId);
    url.searchParams.set('attempt', record.attempt!.id);
    url.searchParams.set('lang', language);
    let ownedTab: number | null = null;
    try {
      const tab = await this.deps.open(url.href);
      ownedTab = tab.tabId;
      if (ownedTab === null) throw new AuthFlowError('UNAVAILABLE');
      const saved = await this.replace(record.status.epoch, (current) => ({
        ...current,
        attempt: { ...current.attempt!, ...tab, stage: 'ready' },
      }));
      await this.deps.navigate(ownedTab, url.href);
      await this.atomic(async (current) => {
        if (current.status.epoch !== record.status.epoch)
          throw new AuthFlowError('CANCELLED');
      });
      return this.reply(saved.status);
    } catch (error) {
      if (errorCode(error) !== 'CANCELLED')
        await this.cancel('UNAVAILABLE', record.status.epoch);
      if (ownedTab !== null)
        await this.deps.discard(ownedTab).catch(() => undefined);
      throw error;
    }
  }
  async cancel(
    code: AuthFailureCode = 'CANCELLED',
    epoch?: string,
    includeCompleted = false,
  ): Promise<AuthStatus> {
    let old: AuthAttempt | null = null;
    let candidate: Session | null = null;
    const status = await this.atomic(async (current) => {
      if (epoch && current.status.epoch !== epoch) return current.status;
      if (
        (!includeCompleted && current.attempt?.stage === 'complete') ||
        !current.attempt
      )
        return current.status;
      old = current.attempt;
      candidate = current.session;
      const next = emptyRecord();
      next.status.error = code;
      await this.save(next);
      return next.status;
    });
    if (old) {
      await Promise.allSettled([
        this.deps.gateway.clearAttempt((old as AuthAttempt).id),
        ...(candidate ? [this.deps.gateway.logout(candidate)] : []),
      ]);
    }
    return status;
  }
  async tabClosed(tabId: number) {
    const record = await this.snapshot();
    if (record.attempt?.tabId === tabId)
      await this.cancel('CANCELLED', record.status.epoch);
  }
  private async prove(
    message: { attemptId: string; recipient: string; secret?: string },
    sender: AuthSender,
  ) {
    const record = await this.snapshot();
    const attempt = record.attempt;
    const url = parseUrl(sender.url);
    if (
      sender.id !== undefined ||
      sender.frameId !== 0 ||
      !url ||
      url.origin !== this.deps.backend ||
      url.pathname !== '/auth/sign-in' ||
      url.username ||
      url.password ||
      url.hash ||
      [...url.searchParams.keys()].some(
        (key) => !['extension', 'attempt', 'lang'].includes(key),
      ) ||
      [...new Set(url.searchParams.keys())].some(
        (key) => url.searchParams.getAll(key).length !== 1,
      ) ||
      url.searchParams.get('extension') !== this.deps.extensionId ||
      url.searchParams.get('attempt') !== message.attemptId ||
      message.recipient !== this.deps.extensionId ||
      !attempt ||
      attempt.inline ||
      attempt.id !== message.attemptId ||
      sender.tab?.id !== attempt.tabId
    )
      throw new AuthFlowError('INVALID_ATTEMPT');
    if (attempt.expiresAt <= this.now()) {
      await this.cancel('ATTEMPT_EXPIRED', record.status.epoch);
      throw new AuthFlowError('ATTEMPT_EXPIRED');
    }
    if (message.secret !== undefined && message.secret !== attempt.secret)
      throw new AuthFlowError('INVALID_ATTEMPT');
    return record;
  }
  private async claim(record: AuthRecord, stage: 'password' | 'google') {
    return this.replace(record.status.epoch, (current) => {
      if (current.attempt?.stage !== 'ready')
        throw new AuthFlowError('INVALID_ATTEMPT');
      return {
        ...current,
        attempt: { ...current.attempt, stage },
        status: { ...current.status, error: null },
      };
    });
  }
  private async accept(
    record: AuthRecord,
    session: Session,
    context?: AuthPanelContext,
  ) {
    try {
      if (context && !context.current()) {
        await this.cancel('CANCELLED', record.status.epoch);
        throw new AuthFlowError('CANCELLED');
      }
      if (record.attempt!.expiresAt <= this.now())
        throw new AuthFlowError('ATTEMPT_EXPIRED');
      await this.replace(record.status.epoch, (current) => {
        if (context && !context.current()) throw new AuthFlowError('CANCELLED');
        return {
          ...current,
          session,
          attempt: { ...current.attempt!, stage: 'complete', flowId: null },
          status: {
            ...current.status,
            phase: 'unverified',
            error: null,
            account: null,
            workspace: 'unknown',
          },
        };
      });
    } catch (error) {
      // A cancelled password/OAuth request can still produce a server session.
      // Never publish that candidate, and revoke it on a best-effort basis.
      await this.deps.gateway.logout(session).catch(() => false);
      throw error;
    }
    await this.deps.gateway.clearAttempt(record.attempt!.id);
    return this.reply(await this.verify());
  }
  async website(value: unknown, sender: AuthSender): Promise<AuthReply> {
    const parsed = authWebsiteMessageSchema.safeParse(value);
    if (!parsed.success) return failure('INVALID_ATTEMPT');
    const message = parsed.data;
    let record: AuthRecord | undefined;
    try {
      record = await this.prove(message, sender);
      const attempt = record.attempt!;
      if (message.type === 'auth:hello') {
        const google = await this.deps.googleEnabled().catch(() => false);
        const current = await this.prove(message, sender);
        return {
          ok: true,
          status: current.status,
          secret: current.attempt!.secret,
          google,
        };
      }
      if (message.type === 'auth:status')
        return this.reply(
          record.status.phase === 'unverified' ||
            record.status.workspace === 'unavailable'
            ? await this.verify()
            : record.status,
        );
      if (message.type === 'auth:cancel') {
        // An explicit Cancel may race with verification after the candidate
        // session was saved. Invalidate that same attempt even at this stage.
        // Closing a successfully completed tab still uses the non-forced path.
        const status = await this.cancel(
          'CANCELLED',
          record.status.epoch,
          true,
        );
        if (status.phase === 'signed_out')
          await this.deps.returnToPage(attempt).catch(() => undefined);
        return this.reply(status);
      }
      if (message.type === 'auth:return') {
        await this.deps.returnToPage(attempt);
        return this.reply(record.status);
      }
      return await this.authenticate(record, message);
    } catch (error) {
      return failure(errorCode(error));
    }
  }
  private async authenticate(
    record: AuthRecord,
    message:
      | { type: 'auth:password'; email: string; password: string }
      | { type: 'auth:google' },
    context?: AuthPanelContext,
  ): Promise<AuthReply> {
    let claimed = false;
    const attempt = record.attempt!;
    try {
      if (context && !context.current()) throw new AuthFlowError('CANCELLED');
      if (message.type === 'auth:password') {
        await this.claim(record, 'password');
        claimed = true;
        return await this.accept(
          record,
          await this.deps.gateway.password(message.email, message.password),
          context,
        );
      }
      if (!(await this.deps.googleEnabled()))
        throw new AuthFlowError('GOOGLE_UNAVAILABLE');
      if (context && !context.current()) throw new AuthFlowError('CANCELLED');
      await this.claim(record, 'google');
      claimed = true;
      const started = await this.deps.gateway.startGoogle(
        attempt.id,
        this.deps.googleRedirect,
      );
      await this.replace(record.status.epoch, (current) => ({
        ...current,
        attempt: { ...current.attempt!, flowId: started.flowId },
      }));
      if (context && !context.current()) throw new AuthFlowError('CANCELLED');
      const callback = await this.deps.launchGoogle(started.url);
      if (!callback) throw new AuthFlowError('CANCELLED');
      if (context && !context.current()) throw new AuthFlowError('CANCELLED');
      // Browser returned URLs are still untrusted. The verifier never leaves the worker.
      const returned = parseUrl(callback);
      const expected = new URL(this.deps.googleRedirect);
      if (
        !returned ||
        returned.origin !== expected.origin ||
        returned.pathname !== expected.pathname ||
        returned.username ||
        returned.password ||
        returned.hash ||
        (returned.searchParams.has('sb_flow_id') &&
          returned.searchParams.get('sb_flow_id') !== started.flowId) ||
        [...returned.searchParams.keys()].some(
          (key) =>
            ![
              'code',
              'sb_flow_id',
              'error',
              'error_code',
              'error_description',
            ].includes(key),
        ) ||
        [...new Set(returned.searchParams.keys())].some(
          (key) => returned.searchParams.getAll(key).length !== 1,
        )
      )
        throw new AuthFlowError('CALLBACK_MISMATCH');
      if (
        returned.searchParams.has('error') ||
        returned.searchParams.has('error_code')
      ) {
        const cancelled =
          returned.searchParams.get('error') === 'access_denied' ||
          returned.searchParams.get('error_code') === 'user_cancelled';
        throw new AuthFlowError(cancelled ? 'CANCELLED' : 'PROVIDER_ERROR');
      }
      const code = returned.searchParams.get('code');
      if (!code || code.length > 2048)
        throw new AuthFlowError('CALLBACK_MISMATCH');
      // Atomically claim the code before exchanging; cancelled/replayed callbacks cannot enter.
      await this.replace(record.status.epoch, (current) => {
        if (
          current.attempt?.stage !== 'google' ||
          current.attempt.flowId !== started.flowId ||
          current.attempt.expiresAt <= this.now()
        )
          throw new AuthFlowError('INVALID_ATTEMPT');
        return { ...current, attempt: { ...current.attempt, flowId: null } };
      });
      return await this.accept(
        record,
        await this.deps.gateway.finishGoogle(attempt.id, code, started.flowId),
        context,
      );
    } catch (error) {
      const code = errorCode(error);
      if (claimed) {
        // Cleanup must finish before publishing a retryable attempt. Otherwise
        // an immediate retry could create a verifier that the old cleanup removes.
        if (message.type === 'auth:google') {
          try {
            await this.deps.gateway.clearAttempt(record.attempt!.id);
          } catch {
            await this.cancel('UNAVAILABLE', record.status.epoch).catch(
              () => undefined,
            );
            return failure('UNAVAILABLE');
          }
        }
        await this.replace(record.status.epoch, (current) => ({
          ...current,
          attempt:
            current.attempt?.stage === 'complete'
              ? current.attempt
              : current.attempt
                ? { ...current.attempt, stage: 'ready', flowId: null }
                : null,
          status: { ...current.status, error: code },
        })).catch(() => undefined);
      }
      return failure(code);
    }
  }
  async verify(): Promise<AuthStatus> {
    const record = await this.snapshot();
    if (!record.session) {
      if (record.attempt && record.attempt.expiresAt <= this.now())
        return this.cancel('ATTEMPT_EXPIRED', record.status.epoch);
      // A worker restart cannot resume a pending password/window promise. Allow a clean retry.
      return record.status;
    }
    if (this.validation?.epoch === record.status.epoch)
      return this.validation.promise;
    const work = this.verifySession(record);
    const validation = { epoch: record.status.epoch, promise: work };
    this.validation = validation;
    try {
      return await work;
    } finally {
      if (this.validation === validation) this.validation = null;
    }
  }
  private async verifySession(record: AuthRecord): Promise<AuthStatus> {
    const epoch = record.status.epoch;
    let session = record.session!;
    try {
      if (
        !session.expires_at ||
        session.expires_at * 1000 <= this.now() + 60_000
      ) {
        session = await this.deps.gateway.refresh(session);
        // Persist a rotated token before other network checks; offline recovery must retain it.
        await this.replace(epoch, (current) => ({ ...current, session }));
      }
      const user = await this.deps.gateway.verify(session);
      if (
        user.id !== session.user.id ||
        (record.status.account && user.id !== record.status.account.id)
      )
        throw new AuthFlowError('SESSION_EXPIRED');
      const account = { id: user.id, email: user.email ?? '' };
      await this.replace(epoch, (current) => ({
        ...current,
        status: { ...current.status, account },
      }));
      const access = await this.deps.access(session.access_token);
      if (access.account.id !== user.id)
        throw new AuthFlowError('SESSION_EXPIRED');
      const saved = await this.replace(epoch, (current) => ({
        ...current,
        attempt: current.attempt?.inline
          ? { ...current.attempt, inlineConnected: true }
          : current.attempt,
        status: {
          ...current.status,
          phase: 'signed_in',
          account,
          workspace: access.workspace,
          error: null,
        },
      }));
      return saved.status;
    } catch (error) {
      const code = errorCode(error);
      if (code === 'SESSION_EXPIRED') {
        const saved = await this.replace(epoch, () => {
          const next = emptyRecord();
          next.status.error = code;
          return next;
        });
        return saved.status;
      }
      const saved = await this.replace(epoch, (current) => ({
        ...current,
        status: {
          ...current.status,
          phase: 'unverified',
          workspace: 'unavailable',
          error: code,
        },
      }));
      return saved.status;
    }
  }
  async logout(): Promise<AuthStatus> {
    let previous: AuthRecord | null = null;
    const next = await this.atomic(async (record) => {
      previous = record;
      const empty = emptyRecord();
      await this.save(empty);
      return empty;
    });
    const prior = previous as AuthRecord | null;
    if (prior?.attempt) await this.deps.gateway.clearAttempt(prior.attempt.id);
    const confirmed = prior?.session
      ? await this.deps.gateway.logout(prior.session).catch(() => false)
      : true;
    const saved = await this.replace(next.status.epoch, (current) => ({
      ...current,
      status: { ...current.status, logoutConfirmed: confirmed },
    })).catch(() => null);
    return saved?.status ?? (await this.snapshot()).status;
  }
  async cancelInlineOwner(owner: string) {
    const record = await this.snapshot();
    if (
      record.attempt?.inlineOwner === owner &&
      !record.attempt.inlineConnected
    )
      await this.cancel('CANCELLED', record.status.epoch, true);
  }
  async panel(value: unknown, context?: AuthPanelContext): Promise<AuthReply> {
    const parsed = authPanelMessageSchema.safeParse(value);
    if (!parsed.success) return failure('INVALID_ATTEMPT');
    const message = parsed.data;
    try {
      if (message.type === 'auth:start')
        return await this.start(message.language, message.inline, context);
      if (message.type === 'auth:cancel')
        return this.reply(await this.cancel('CANCELLED', message.epoch, true));
      if (message.type === 'auth:logout')
        return this.reply(await this.logout());
      if (
        message.type === 'auth:inline-password' ||
        message.type === 'auth:inline-google' ||
        message.type === 'auth:inline-cancel'
      ) {
        const record = await this.snapshot();
        if (
          record.status.epoch !== message.epoch ||
          !record.attempt?.inline ||
          !context?.current() ||
          context.owner !== record.attempt.inlineOwner
        )
          throw new AuthFlowError('INVALID_ATTEMPT');
        if (message.type === 'auth:inline-cancel')
          return this.reply(
            await this.cancel('CANCELLED', record.status.epoch, true),
          );
        if (record.attempt.expiresAt <= this.now()) {
          await this.cancel('ATTEMPT_EXPIRED', record.status.epoch);
          throw new AuthFlowError('ATTEMPT_EXPIRED');
        }
        return this.authenticate(
          record,
          message.type === 'auth:inline-password'
            ? {
                type: 'auth:password',
                email: message.email,
                password: message.password,
              }
            : { type: 'auth:google' },
          context,
        );
      }

      const status = await this.verify();
      if (message.type === 'auth:status') return this.reply(status);
      return await this.atomic(async (record) => {
        const current = record.status;
        if (
          current.epoch !== message.epoch ||
          current.account?.id !== message.userId ||
          !record.session
        )
          throw new AuthFlowError('SESSION_EXPIRED');
        if (current.phase !== 'signed_in' || current.workspace !== 'allowed')
          throw new AuthFlowError(
            current.phase === 'unverified' ||
              current.workspace === 'unavailable' ||
              current.workspace === 'unknown'
              ? 'UNAVAILABLE'
              : 'FORBIDDEN',
          );
        return {
          ok: true,
          status: current,
          headers: { Authorization: `Bearer ${record.session.access_token}` },
        };
      });
    } catch (error) {
      return failure(errorCode(error));
    }
  }
}
