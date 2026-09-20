import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { getExtensionConfig } from './config.ts';

const sessionKey = 'adc:auth:session';
let signedOut = false;
let pendingLogout: Promise<void> | undefined;

export function isExtensionSignedOut() {
  return signedOut;
}
export function blockExtensionSession() {
  signedOut = true;
}

export async function beginExtensionSignIn() {
  // An older sign-out must not clear a newly authenticated session.
  try {
    await pendingLogout;
  } catch {
    /* Local removal is also attempted in finally. */
  }
  signedOut = false;
}

export const extensionSessionStorage = {
  async getItem(key: string) {
    if (signedOut) return null;
    const value: unknown = (await chrome.storage.session.get(key))[key];
    return !signedOut && typeof value === 'string' ? value : null;
  },
  async setItem(key: string, value: string) {
    if (signedOut) return;
    await chrome.storage.session.set({ [key]: value });
    // A refresh write already in flight when logout began must be discarded.
    if (signedOut) await chrome.storage.session.remove(key);
  },
  async removeItem(key: string) {
    await chrome.storage.session.remove(key);
  },
};

export function createExtensionAuth(
  config: NonNullable<ReturnType<typeof getExtensionConfig>>,
) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: sessionKey,
      storage: extensionSessionStorage,
    },
  });
}

export function clearExtensionSession(client: {
  auth: Pick<SupabaseClient['auth'], 'stopAutoRefresh' | 'signOut'>;
}) {
  blockExtensionSession();
  if (pendingLogout) return pendingLogout;
  const operation = (async () => {
    try {
      await Promise.all([
        chrome.storage.session.remove(sessionKey),
        client.auth.stopAutoRefresh(),
      ]);
      await client.auth.signOut({ scope: 'local' });
    } finally {
      await chrome.storage.session.remove(sessionKey);
    }
  })();
  pendingLogout = operation;
  void operation
    .finally(() => {
      if (pendingLogout === operation) pendingLogout = undefined;
    })
    .catch(() => undefined);
  return operation;
}
