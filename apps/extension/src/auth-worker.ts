import {
  authAccessResponseSchema,
  authCapabilitiesSchema,
  authPanelMessageSchema,
  authStatusSchema,
  authWebsiteMessageSchema,
  voiceErrorResponseSchema,
  type AuthReply,
} from '@adc/contracts';
import { AuthFlowError, createExtensionAuthGateway } from './auth.ts';
import {
  AUTH_RECORD_KEY,
  ExtensionAuthManager,
  type AuthRecord,
  type AuthSender,
} from './auth-manager.ts';
import { getExtensionConfig } from './config.ts';

export function trustedAuthPanel(sender: AuthSender, extensionId: string) {
  let url: URL;
  try {
    url = new URL(sender.url ?? '');
  } catch {
    return false;
  }
  return (
    sender.id === extensionId &&
    url?.protocol === 'chrome-extension:' &&
    url.host === extensionId &&
    url.pathname === '/index.html' &&
    !url.hash &&
    !url.username &&
    !url.password &&
    (sender.frameId === undefined || sender.frameId === 0) &&
    (!url.search || url.search === '?microphone-setup=1')
  );
}

function inlineOwner(sender: AuthSender) {
  // Browser-provided document identity, never a page-supplied request field.
  return sender.documentId
    ? `${sender.tab?.id ?? 'extension'}:${sender.frameId ?? 0}:${sender.documentId}`
    : null;
}

export function installAuthWorker(
  config = getExtensionConfig(),
  trustedFloating: (sender: chrome.runtime.MessageSender) => boolean = () =>
    false,
) {
  const unavailable: AuthReply = { ok: false, error: 'SETUP_REQUIRED' };
  const gateway = config ? createExtensionAuthGateway(config) : null;
  async function getJson(path: string, token?: string) {
    let response: Response;
    try {
      response = await fetch(`${config!.backend}${path}`, {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AuthFlowError('UNAVAILABLE');
    }
    if (!response.headers.get('Content-Type')?.includes('application/json'))
      throw new AuthFlowError('UNAVAILABLE');
    const body = await response.text();
    if (body.length > 16_384) throw new AuthFlowError('UNAVAILABLE');
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new AuthFlowError('UNAVAILABLE');
    }
    if (
      response.status === 401 &&
      voiceErrorResponseSchema.safeParse(parsed).data?.error.code ===
        'UNAUTHENTICATED'
    )
      throw new AuthFlowError('SESSION_EXPIRED');
    if (!response.ok) throw new AuthFlowError('UNAVAILABLE');
    return parsed;
  }
  const manager =
    config && gateway
      ? new ExtensionAuthManager({
          extensionId: chrome.runtime.id,
          backend: config.backend,
          gateway,
          async read() {
            const value: unknown = (
              await chrome.storage.session.get(AUTH_RECORD_KEY)
            )[AUTH_RECORD_KEY];
            if (
              !value ||
              typeof value !== 'object' ||
              !('status' in value) ||
              !authStatusSchema.safeParse(value.status).success ||
              !('session' in value) ||
              !('attempt' in value)
            )
              return null;
            // Only the worker writes this trusted session record; remote messages cannot set it.
            return value as AuthRecord;
          },
          async write(record) {
            await chrome.storage.session.set({ [AUTH_RECORD_KEY]: record });
          },
          async open() {
            const source = (
              await chrome.tabs.query({ active: true, currentWindow: true })
            )[0];
            // Create blank first, then bind the tab in storage before loading the auth page.
            const tab = await chrome.tabs.create({
              url: 'about:blank',
              active: true,
            });
            if (tab.id === undefined) throw new AuthFlowError('UNAVAILABLE');
            return {
              tabId: tab.id,
              windowId: tab.windowId,
              returnTabId: source?.id ?? null,
              returnWindowId: source?.windowId ?? null,
            };
          },
          async navigate(tabId, url) {
            await chrome.tabs.update(tabId, { url });
          },
          async discard(tabId) {
            await chrome.tabs.remove(tabId);
          },
          async focus(tabId) {
            const tab = await chrome.tabs.update(tabId, { active: true });
            if (tab)
              await chrome.windows.update(tab.windowId, { focused: true });
          },
          async returnToPage(attempt) {
            if (attempt.returnTabId !== null)
              await chrome.tabs.update(attempt.returnTabId, { active: true });
            if (attempt.returnWindowId !== null)
              await chrome.windows.update(attempt.returnWindowId, {
                focused: true,
              });
            // Reopening a closed panel may require a fresh toolbar/shortcut gesture.
          },
          async googleEnabled() {
            return authCapabilitiesSchema.parse(
              await getJson('/api/auth/config'),
            ).google;
          },
          googleRedirect: chrome.identity.getRedirectURL('auth'),
          async launchGoogle(url) {
            try {
              return await chrome.identity.launchWebAuthFlow({
                url,
                interactive: true,
              });
            } catch (error) {
              // Chromium identifies a closed/declined auth window by this fixed
              // API error. Never relay browser or provider error text to the UI.
              if (
                error instanceof Error &&
                error.message === 'The user did not approve access.'
              )
                throw new AuthFlowError('CANCELLED');
              throw new AuthFlowError('UNAVAILABLE');
            }
          },
          async access(token) {
            return authAccessResponseSchema.parse(
              await getJson('/api/auth/access', token),
            );
          },
        })
      : null;
  chrome.runtime.onMessage.addListener((value: unknown, sender, respond) => {
    if (
      !authPanelMessageSchema.safeParse(value).success ||
      !(trustedAuthPanel(sender, chrome.runtime.id) || trustedFloating(sender))
    )
      return false;
    const owner = inlineOwner(sender);
    void (
      manager
        ? manager.panel(
            value,
            owner
              ? {
                  owner,
                  current: () => trustedFloating(sender),
                }
              : undefined,
          )
        : Promise.resolve(unavailable)
    )
      .then((reply) =>
        respond(
          trustedAuthPanel(sender, chrome.runtime.id) || trustedFloating(sender)
            ? reply
            : ({ ok: false, error: 'UNAVAILABLE' } satisfies AuthReply),
        ),
      )
      .catch(() =>
        respond({ ok: false, error: 'UNAVAILABLE' } satisfies AuthReply),
      );
    return true;
  });
  chrome.runtime.onMessageExternal.addListener(
    (value: unknown, sender, respond) => {
      if (!authWebsiteMessageSchema.safeParse(value).success) return false;
      void (
        manager ? manager.website(value, sender) : Promise.resolve(unavailable)
      )
        .then(respond)
        .catch(() =>
          respond({ ok: false, error: 'UNAVAILABLE' } satisfies AuthReply),
        );
      return true;
    },
  );
  chrome.tabs.onRemoved.addListener((id) => {
    void manager?.tabClosed(id).catch(() => undefined);
  });
  return {
    async cancelInlineDocument(sender: AuthSender) {
      const owner = inlineOwner(sender);
      if (owner) await manager?.cancelInlineOwner(owner);
    },
  };
}
