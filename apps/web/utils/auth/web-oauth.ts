import type { UiLanguage } from '@adc/contracts';

export const WEB_FLOW_COOKIE = 'vsual-web-sign-in';
export const WEB_FLOW_MS = 5 * 60_000;
export interface WebOAuthAttempt {
  flowId: string;
  expiresAt: number;
  language: UiLanguage;
}

/** Routing metadata only. The original verifier remains in Supabase's cookie store. */
export function webOAuthCookie(
  flowId: string,
  language: UiLanguage,
  secure: boolean,
  now = Date.now(),
): string {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(flowId))
    throw new Error('Invalid sign-in flow');
  return `${WEB_FLOW_COOKIE}=${flowId}.${now + WEB_FLOW_MS}.${language}; Path=/auth/callback; Max-Age=${WEB_FLOW_MS / 1000}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function parseWebOAuthCookie(
  value: string | undefined,
  now = Date.now(),
): WebOAuthAttempt | null {
  if (!value) return null;
  const match = /^([a-zA-Z0-9_-]{8,64})\.(\d{13})\.(en|vi)$/.exec(value);
  if (!match) return null;
  const expiresAt = Number(match[2]);
  if (expiresAt <= now || expiresAt > now + WEB_FLOW_MS) return null;
  return { flowId: match[1]!, expiresAt, language: match[3] as UiLanguage };
}
