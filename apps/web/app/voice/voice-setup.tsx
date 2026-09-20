'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createVoiceTransport,
  signInErrorMessage,
  SignInForm,
  VoiceTest,
} from '@adc/voice-ui';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../utils/supabase/client';
import { useWebsiteLanguage } from '../site-shell';

const words = {
  en: {
    title: 'Get started with VSual',
    steps: 'Your next steps',
    extensionStep:
      'Open VSual and choose Sign in. Complete sign-in on the website that opens.',
    pageStep: 'Open the synthetic orders demo',
    askStep:
      'Allow page processing in VSual. Type or record a question, review it, then select Ask VSual.',
    optional: 'You can type without enabling the microphone.',
    test: 'Optional website voice test',
    install: 'Developer installation instructions',
    intro:
      'Record or type text, then read it back. This test does not answer page questions.',
    loading: 'Checking your session…',
    signout: 'Sign out',
    signed: 'Signed in',
    other: 'Google sign-in and account options',
    account: 'Website sign-in is separate from extension sign-in.',
    setup:
      'Sign-in is not available yet. Ask the project maintainer to finish setup.',
    expired: 'Your session expired. Sign in again to continue.',
    build: 'From the repository root, run:',
    load: 'In Chrome or Edge, open Extensions, enable Developer mode and choose Load unpacked. Select apps/extension/dist.',
    pin: 'Pin VSual and open its toolbar button. The extension’s Settings show the assigned keyboard shortcut.',
    separate:
      'Microphone permission on this website does not grant permission to the extension.',
    home: 'Back to home',
  },
  vi: {
    title: 'Bắt đầu với VSual',
    steps: 'Các bước tiếp theo',
    extensionStep:
      'Mở VSual và chọn Đăng nhập. Đăng nhập trên trang web vừa mở.',
    pageStep: 'Mở bản mẫu đơn hàng giả lập',
    askStep:
      'Cho phép xử lý trang trong VSual. Nhập hoặc ghi âm câu hỏi, xem lại rồi chọn Hỏi VSual.',
    optional: 'Bạn có thể nhập câu hỏi mà không cần bật micrô.',
    test: 'Thử giọng nói trên trang web (tùy chọn)',
    install: 'Hướng dẫn cài đặt dành cho nhà phát triển',
    intro:
      'Ghi âm hoặc nhập văn bản, rồi nghe đọc lại. Phần thử này không trả lời câu hỏi về trang.',
    loading: 'Đang kiểm tra phiên đăng nhập…',
    signout: 'Đăng xuất',
    signed: 'Đã đăng nhập',
    other: 'Đăng nhập Google và tùy chọn tài khoản',
    account: 'Đăng nhập trên trang web tách biệt với đăng nhập trong tiện ích.',
    setup: 'Chưa thể đăng nhập. Nhờ người quản lý dự án hoàn tất thiết lập.',
    expired: 'Phiên đã hết hạn. Đăng nhập lại để tiếp tục.',
    build: 'Từ thư mục gốc dự án, chạy:',
    load: 'Trong Chrome hoặc Edge, mở Tiện ích, bật Chế độ nhà phát triển và chọn Tải tiện ích đã giải nén. Chọn apps/extension/dist.',
    pin: 'Ghim VSual rồi mở bằng nút trên thanh công cụ. Cài đặt trong tiện ích hiển thị phím tắt đã gán.',
    separate: 'Quyền micrô trên trang web này không cấp quyền cho tiện ích.',
    home: 'Về trang chủ',
  },
};

export default function VoiceSetup() {
  const { language } = useWebsiteLanguage();
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'setup' | 'expired' | null>(null);
  const [authFailure, setAuthFailure] = useState<unknown>(null);
  const signedOut = useRef(false);
  const cancelVoice = useRef<() => void>(() => {});
  const onVoiceReady = useCallback(
    (_activate: () => void, cancel: () => void) => {
      cancelVoice.current = cancel;
      return () => {
        cancelVoice.current = () => {};
      };
    },
    [],
  );
  const copy = words[language];

  useEffect(() => {
    let active = true;
    let authEvent = false;
    let unsubscribe: (() => void) | undefined;
    try {
      const auth = createClient();
      setClient(auth);
      const { data } = auth.auth.onAuthStateChange((_event, next) => {
        if (active) {
          authEvent = true;
          setSession(signedOut.current ? null : next);
          setLoading(false);
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
      void auth.auth
        .getSession()
        .then(({ data, error }) => {
          if (!active || authEvent) return;
          setSession(error ? null : data.session);
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (active) {
            setAuthFailure(error);
            setLoading(false);
          }
        });
    } catch {
      setMessage('setup');
      setLoading(false);
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const transport = useMemo(
    () =>
      createVoiceTransport({
        baseUrl:
          typeof window === 'undefined'
            ? 'http://127.0.0.1:3000'
            : window.location.origin,
        getHeaders: () => ({}),
        onUnauthenticated: () => {
          signedOut.current = true;
          cancelVoice.current();
          setSession(null);
          setMessage('expired');
          setBusy(true);
          void client?.auth
            .signOut({ scope: 'local' })
            .catch(() => undefined)
            .finally(() => setBusy(false));
        },
      }),
    [client],
  );

  async function signIn(email: string, password: string) {
    if (!client || busy) return;
    setBusy(true);
    setMessage(null);
    setAuthFailure(null);
    signedOut.current = false;
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.session) setAuthFailure(error);
      else setSession(data.session);
    } catch (error: unknown) {
      setAuthFailure(error);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    signedOut.current = true;
    cancelVoice.current();
    setBusy(true);
    setSession(null);
    setMessage(null);
    setAuthFailure(null);
    await client?.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setBusy(false);
  }

  return (
    <main id="main-content" tabIndex={-1} lang={language}>
      <p className="eyebrow">VSual</p>
      <h1>{copy.title}</h1>
      <section aria-labelledby="next-heading">
        <h2 id="next-heading">{copy.steps}</h2>
        <ol className="setup-steps">
          <li>{copy.extensionStep}</li>
          <li>
            <a href="/orders">{copy.pageStep}</a>
          </li>
          <li>{copy.askStep}</li>
        </ol>
        <p>{copy.optional}</p>
        <details>
          <summary>{copy.install}</summary>
          <p>{copy.build}</p>
          <pre>
            <code>npm run build --workspace=@adc/extension</code>
          </pre>
          <p>{copy.load}</p>
          <p>{copy.pin}</p>
        </details>
      </section>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">{copy.test}</h2>
        <p>{copy.intro}</p>
        <p>{copy.account}</p>
        {loading ? (
          <p role="status">{copy.loading}</p>
        ) : session ? (
          <>
            <p>
              {copy.signed}: {session.user.email}
            </p>
            <button type="button" onClick={() => void signOut()}>
              {copy.signout}
            </button>
          </>
        ) : (
          <>
            <SignInForm
              language={language}
              onSubmit={signIn}
              busy={busy}
              disabled={!client}
              error={
                authFailure ? signInErrorMessage(authFailure, language) : null
              }
            />
            <a href={`/auth/sign-in?lang=${language}`}>{copy.other}</a>
          </>
        )}
        <p role="status" aria-atomic="true">
          {message ? copy[message] : ''}
        </p>
      </section>
      {session && (
        <VoiceTest
          key={session.user.id}
          sessionKey={session.user.id}
          transport={transport}
          uiLanguage={language}
          onReady={onVoiceReady}
        />
      )}
      <p className="field-help">{copy.separate}</p>
      <a href="/">{copy.home}</a>
    </main>
  );
}
