'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import type { UiLanguage } from '@adc/contracts';
import { authCopy } from './auth-strings.ts';

export interface SignInFormProps {
  language: UiLanguage;
  onSubmit: (email: string, password: string) => Promise<void>;
  onGoogle?: () => Promise<void>;
  googleUnavailable?: boolean;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
}

/** Passwords remain only in this form while entered and are cleared on submit. */
export function SignInForm({
  language,
  onSubmit,
  onGoogle,
  googleUnavailable = false,
  busy = false,
  disabled = false,
  error,
}: SignInFormProps) {
  const id = useId();
  const copy = authCopy[language];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [field, setField] = useState<'email' | 'password' | null>(null);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const working = busy || pending;
  const errorId = `${id}-error`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || working || locked.current) return;
    if (!email.trim() || !emailInput.current?.validity.valid) {
      setField('email');
      emailInput.current?.focus();
      return;
    }
    if (!password) {
      setField('password');
      passwordInput.current?.focus();
      return;
    }
    locked.current = true;
    setPending(true);
    setField(null);
    const supplied = password;
    setPassword('');
    setVisible(false);
    try {
      await onSubmit(email.trim(), supplied);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  async function google() {
    if (!onGoogle || disabled || working || locked.current) return;
    locked.current = true;
    setPassword('');
    setVisible(false);
    setPending(true);
    try {
      await onGoogle();
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-busy={working}
    >
      <label htmlFor={`${id}-email`}>{copy.email}</label>
      <input
        ref={emailInput}
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        maxLength={320}
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setField(null);
        }}
        aria-invalid={field === 'email' || Boolean(error)}
        aria-describedby={field === 'email' || error ? errorId : undefined}
        readOnly={working}
      />
      <label htmlFor={`${id}-password`}>{copy.password}</label>
      <input
        ref={passwordInput}
        id={`${id}-password`}
        name="password"
        type={visible ? 'text' : 'password'}
        autoComplete="current-password"
        required
        maxLength={1024}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setField(null);
        }}
        aria-invalid={field === 'password' || Boolean(error)}
        aria-describedby={field === 'password' || error ? errorId : undefined}
        readOnly={working}
      />
      <div className="auth-actions">
        <button
          type="button"
          aria-controls={`${id}-password`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
          disabled={working}
        >
          {visible ? copy.hide : copy.show}
        </button>
        <button
          type="submit"
          className="primary"
          disabled={disabled || working}
        >
          {working ? copy.working : copy.signIn}
        </button>
        {onGoogle && (
          <button
            type="button"
            onClick={() => void google()}
            disabled={disabled || working}
          >
            {copy.google}
          </button>
        )}
      </div>
      {googleUnavailable && <p>{copy.googleUnavailable}</p>}
      <p id={errorId} role="alert">
        {field === 'email'
          ? copy.emailRequired
          : field === 'password'
            ? copy.passwordRequired
            : error}
      </p>
      <p role="status" aria-atomic="true">
        {working ? copy.working : ''}
      </p>
    </form>
  );
}
