import {
  authStatusSchema,
  type AuthPanelMessage,
  type AuthStatus,
  type UiLanguage,
} from '@adc/contracts';
import { authCopy, authFailureText } from '@adc/voice-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authCommand } from './auth-client.ts';

const copy = {
  en: {
    open: 'Sign in on the VSual website',
    opening: 'Opening the VSual sign-in page…',
    resume: 'Return to sign-in page',
    pending:
      'Complete sign-in in the website tab. No recording will start automatically.',
    session:
      'Your sign-in lasts for this browser session. Closing this panel keeps you signed in; restarting the browser or reloading the extension may sign you out.',
    logout: 'Sign out of VSual extension',
    scope:
      'Signing out clears this extension’s questions, page data and audio. The website remains signed in separately.',
    loggedOut: 'Signed out of this extension.',
    logoutOffline:
      'Signed out locally. Server sign-out could not be confirmed. The website session is unchanged.',
    change: 'Sign out and change account',
    working: 'Updating sign-in…',
    ready: 'Workspace access available.',
  },
  vi: {
    open: 'Đăng nhập trên trang web VSual',
    opening: 'Đang mở trang đăng nhập VSual…',
    resume: 'Quay lại trang đăng nhập',
    pending:
      'Hoàn tất đăng nhập trong thẻ trang web. Ghi âm sẽ không tự bắt đầu.',
    session:
      'Đăng nhập được giữ trong phiên trình duyệt này. Đóng bảng vẫn giữ đăng nhập; khởi động lại trình duyệt hoặc tải lại tiện ích có thể đăng xuất.',
    logout: 'Đăng xuất khỏi tiện ích VSual',
    scope:
      'Đăng xuất sẽ xóa câu hỏi, dữ liệu trang và âm thanh trong tiện ích. Phiên trang web vẫn đăng nhập riêng.',
    loggedOut: 'Đã đăng xuất khỏi tiện ích.',
    logoutOffline:
      'Đã đăng xuất trên thiết bị. Chưa xác nhận được với máy chủ. Phiên trang web không thay đổi.',
    change: 'Đăng xuất và đổi tài khoản',
    working: 'Đang cập nhật đăng nhập…',
    ready: 'Có quyền truy cập không gian làm việc.',
  },
} as const;

export function useExtensionSession(
  configured: boolean,
  clearWork: () => void,
) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(configured);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [failure, setFailure] = useState<AuthStatus['error']>(null);
  const inFlight = useRef<{
    id: number;
    type: AuthPanelMessage['type'];
  } | null>(null);
  const operation = useRef(0);
  const lastStatus = useRef<AuthStatus | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    if (!configured) return;
    let active = true;
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'session' || !changes['adc:auth:owner']) return;
      // Read only the public status; tokens never enter React state.
      const record: unknown = changes['adc:auth:owner'].newValue;
      const parsed = authStatusSchema.safeParse(
        record && typeof record === 'object' && 'status' in record
          ? record.status
          : null,
      );
      const next = parsed.success ? parsed.data : null;
      if (
        !next ||
        next.phase !== 'signed_in' ||
        next.workspace !== 'allowed' ||
        (lastStatus.current &&
          (next.epoch !== lastStatus.current.epoch ||
            next.account?.id !== lastStatus.current.account?.id))
      )
        clearWork();
      lastStatus.current = next;
      revision.current++;
      setFailure(null);
      setStatus(next);
      setLoading(false);
    };
    chrome.storage.onChanged.addListener(changed);
    const version = revision.current;
    void authCommand({ type: 'auth:status' })
      .then((next) => {
        if (active && mounted.current && revision.current === version) {
          lastStatus.current = next;
          setStatus(next);
        }
      })
      .catch(() => {
        if (active && mounted.current && revision.current === version)
          setFailure('UNAVAILABLE');
      })
      .finally(() => {
        if (active && mounted.current) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      chrome.storage.onChanged.removeListener(changed);
    };
  }, [configured, clearWork]);

  const run = useCallback(
    async (message: AuthPanelMessage) => {
      const urgent =
        message.type === 'auth:logout' || message.type === 'auth:cancel';
      if (
        inFlight.current &&
        (!urgent || inFlight.current.type === message.type)
      )
        return false;
      const id = ++operation.current;
      inFlight.current = { id, type: message.type };
      setBusy(true);
      setFailure(null);
      if (message.type === 'auth:logout' || message.type === 'auth:start') {
        clearWork();
        setClearing(true);
      }
      const version = revision.current;
      try {
        const next = await authCommand(message);
        if (
          mounted.current &&
          operation.current === id &&
          revision.current === version
        )
          setStatus(next);
        return operation.current === id;
      } catch (error) {
        if (
          mounted.current &&
          operation.current === id &&
          revision.current === version
        ) {
          const code =
            error && typeof error === 'object' && 'code' in error
              ? error.code
              : null;
          const parsed = authStatusSchema.shape.error.safeParse(code);
          setFailure(
            parsed.success && parsed.data ? parsed.data : 'UNAVAILABLE',
          );
        }
        return false;
      } finally {
        if (operation.current === id) {
          inFlight.current = null;
          if (mounted.current) {
            setBusy(false);
            setClearing(false);
          }
        }
      }
    },
    [clearWork],
  );

  return {
    status,
    loading,
    busy,
    failure,
    run,
    allowed:
      !clearing &&
      status?.phase === 'signed_in' &&
      status.workspace === 'allowed',
  };
}

export function AuthPanel({
  session,
  language,
  signInRef,
  compact = false,
}: {
  session: ReturnType<typeof useExtensionSession>;
  language: UiLanguage;
  signInRef: React.RefObject<HTMLButtonElement | null>;
  compact?: boolean;
}) {
  const { status, loading, busy, failure, run } = session;
  const a = authCopy[language];
  const t = copy[language];
  const heading = useRef<HTMLHeadingElement>(null);
  const accountSummary = useRef<HTMLElement>(null);
  const previous = useRef<string | null>(null);
  const restoreSignIn = useRef(false);
  const identity = status?.account?.id ?? null;
  const hasSession = Boolean(identity || status?.phase === 'unverified');
  const pending = status?.phase === 'signing_in';
  useEffect(() => {
    if (
      identity &&
      identity !== previous.current &&
      !heading.current?.closest('[hidden]')
    )
      (compact ? accountSummary : heading).current?.focus();
    if ((!identity && previous.current) || pending)
      restoreSignIn.current = true;
    if (!hasSession && !pending && !busy && !loading && restoreSignIn.current) {
      signInRef.current?.focus();
      restoreSignIn.current = false;
    }
    previous.current = identity;
  }, [identity, signInRef, hasSession, pending, busy, loading, compact]);
  const error = failure ?? status?.error;
  const announcement = error
    ? authFailureText(error, language)
    : loading
      ? a.checking
      : busy
        ? t.working
        : pending
          ? t.pending
          : status?.logoutConfirmed === false
            ? t.logoutOffline
            : status?.logoutConfirmed === true
              ? t.loggedOut
              : status?.phase === 'unverified'
                ? authFailureText('UNAVAILABLE', language)
                : identity
                  ? `${a.signedIn}: ${status?.account?.email}. ${status?.workspace === 'allowed' ? t.ready : status?.workspace === 'denied' ? a.denied : a.unavailable}`
                  : '';
  const controls = (
    <>
      {status?.account ? (
        <p>
          {a.signedIn}: {status.account.email}
        </p>
      ) : null}
      {hasSession ? (
        <>
          <p>{t.session}</p>
          <p>{t.scope}</p>
          <div className="controls">
            {(status?.phase === 'unverified' ||
              status?.workspace === 'unavailable') && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run({ type: 'auth:status' })}
              >
                {a.retry}
              </button>
            )}
            <button
              type="button"
              onClick={() => void run({ type: 'auth:logout' })}
            >
              {t.logout}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ type: 'auth:logout' }).then(
                  (done) => done && run({ type: 'auth:start', language }),
                )
              }
            >
              {t.change}
            </button>
          </div>
        </>
      ) : pending ? (
        <>
          <p>{t.pending}</p>
          <div className="controls">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ type: 'auth:start', language })}
            >
              {t.resume}
            </button>
            <button
              type="button"
              onClick={() => {
                if (status)
                  void run({ type: 'auth:cancel', epoch: status.epoch });
              }}
            >
              {a.cancel}
            </button>
          </div>
        </>
      ) : (
        <button
          ref={signInRef}
          type="button"
          disabled={busy || loading}
          onClick={() => void run({ type: 'auth:start', language })}
        >
          {busy ? t.opening : t.open}
        </button>
      )}
      {!hasSession && !pending && failure && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ type: 'auth:status' })}
        >
          {a.retry}
        </button>
      )}
    </>
  );
  return (
    <section
      aria-labelledby="session-heading"
      className={compact ? 'account-summary' : 'account-setup'}
    >
      <h2
        id="session-heading"
        tabIndex={-1}
        ref={heading}
        className={compact ? 'sr-only' : undefined}
      >
        {a.account}
      </h2>
      {compact ? (
        <details>
          <summary ref={accountSummary}>
            {a.signedIn}: {status?.account?.email}
          </summary>
          {controls}
        </details>
      ) : (
        controls
      )}
      <p
        role="status"
        aria-atomic="true"
        className={compact ? 'sr-only' : 'status'}
      >
        {announcement}
      </p>
    </section>
  );
}
