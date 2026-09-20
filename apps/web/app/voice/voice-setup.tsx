'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createVoiceTransport,
  signInErrorMessage,
  SignInForm,
  VoiceTest,
} from '@adc/voice-ui';
import type { UiLanguage } from '@adc/contracts';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../../utils/supabase/client';

const words = {
  en: {
    title: 'Voice setup',
    language: 'Interface language',
    intro:
      'Test recorded transcription and read-back. Read-back repeats your supplied text; it does not answer questions or inspect a page.',
    session: 'Account',
    loading: 'Checking your session…',
    email: 'Email',
    password: 'Password',
    signin: 'Sign in',
    signout: 'Sign out',
    signed: 'Signed in',
    waiting: 'Please wait…',
    other: 'Google sign-in and account options',
    account:
      'Sign in with your existing VSual account. The extension has its own browser-session sign-in; start that connection from its Sign in button.',
    setup:
      'Sign-in is not configured. Ask the project maintainer to finish Supabase setup.',
    expired: 'Your session expired. Sign in again to continue.',
    extension: 'Set up the extension',
    build: 'From the repository root, run:',
    load: 'In Chrome or Edge, open Extensions, enable Developer mode and choose Load unpacked. Select apps/extension/dist.',
    pin: 'Pin VSual, then open its toolbar button. Choose Sign in to connect through the website, then grant microphone permission in the extension. Its panel shows the actual assigned browser shortcut.',
    separate:
      'This website microphone test does not grant extension microphone permission. No extension connection has been checked here.',
    home: 'Back to home',
  },
  vi: {
    title: 'Thiết lập giọng nói',
    language: 'Ngôn ngữ giao diện',
    intro:
      'Thử chuyển bản ghi âm thành văn bản và đọc lại. Đọc lại chỉ đọc văn bản bạn cung cấp, không trả lời câu hỏi hoặc phân tích trang.',
    session: 'Tài khoản',
    loading: 'Đang kiểm tra phiên đăng nhập…',
    email: 'Email',
    password: 'Mật khẩu',
    signin: 'Đăng nhập',
    signout: 'Đăng xuất',
    signed: 'Đã đăng nhập',
    waiting: 'Vui lòng chờ…',
    other: 'Đăng nhập Google và tùy chọn tài khoản',
    account:
      'Đăng nhập bằng tài khoản VSual đã có. Tiện ích có phiên đăng nhập riêng trong trình duyệt; bắt đầu kết nối từ nút Đăng nhập trong tiện ích.',
    setup:
      'Chưa cấu hình đăng nhập. Nhờ người quản lý dự án hoàn tất thiết lập Supabase.',
    expired: 'Phiên đã hết hạn. Đăng nhập lại để tiếp tục.',
    extension: 'Cài đặt tiện ích',
    build: 'Từ thư mục gốc dự án, chạy:',
    load: 'Trong Chrome hoặc Edge, mở Tiện ích, bật Chế độ nhà phát triển và chọn Tải tiện ích đã giải nén. Chọn apps/extension/dist.',
    pin: 'Ghim VSual và mở bằng nút trên thanh công cụ. Chọn Đăng nhập để kết nối qua trang web, sau đó cấp quyền micrô trong tiện ích. Bảng điều khiển hiển thị phím tắt đã gán.',
    separate:
      'Thử micrô trên trang này không cấp quyền micrô cho tiện ích. Trang này chưa kiểm tra kết nối với tiện ích.',
    home: 'Về trang chủ',
  },
};

export default function VoiceSetup() {
  const [language, setLanguage] = useState<UiLanguage>('en');
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'setup' | 'expired' | null>(null);
  const [authFailure, setAuthFailure] = useState<string | null>(null);
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
            setAuthFailure(signInErrorMessage(error, 'en'));
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
      if (error || !data.session)
        setAuthFailure(signInErrorMessage(error, language));
      else setSession(data.session);
    } catch (error: unknown) {
      setAuthFailure(signInErrorMessage(error, language));
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
    <main lang={language}>
      <p className="eyebrow">VSual</p>
      <h1>{copy.title}</h1>
      <label htmlFor="ui-language">{copy.language}</label>
      <select
        id="ui-language"
        value={language}
        onChange={(event) => setLanguage(event.target.value as UiLanguage)}
      >
        <option value="en">English</option>
        <option value="vi">Tiếng Việt</option>
      </select>
      <p>{copy.intro}</p>
      <section aria-labelledby="account-heading">
        <h2 id="account-heading">{copy.session}</h2>
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
              error={authFailure}
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
      <section aria-labelledby="extension-heading">
        <h2 id="extension-heading">{copy.extension}</h2>
        <p>{copy.build}</p>
        <pre>
          <code>npm run build --workspace=@adc/extension</code>
        </pre>
        <p>{copy.load}</p>
        <p>{copy.pin}</p>
        <p>{copy.separate}</p>
      </section>
      <a href="/">{copy.home}</a>
    </main>
  );
}
