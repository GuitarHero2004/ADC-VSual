export interface DesktopConfiguration {
  apiBaseUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  workspaceId?: string;
}

export type DesktopConfigurationResult =
  | { ok: true; value: DesktopConfiguration }
  | { ok: false; errorCode: 'SETUP_REQUIRED' };

function origin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      url.hostname.includes('*') ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function publicKey(value: string | undefined): string | null {
  const key = value?.trim();
  if (
    !key ||
    key.length > 4096 ||
    /\s/.test(key) ||
    key.startsWith('sb_secret_')
  )
    return null;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
  // Legacy anon JWTs remain supported; privileged service-role keys do not.
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[\w-]+$/.test(part)))
      return null;
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    );
    return payload &&
      typeof payload === 'object' &&
      'role' in payload &&
      payload.role === 'anon'
      ? key
      : null;
  } catch {
    return null;
  }
}

/** Read lazily when a feature needs configuration; starting the shell needs none. */
export function readDesktopConfiguration(
  environment: Record<string, string | undefined>,
): DesktopConfigurationResult {
  const apiBaseUrl = origin(environment.VSUAL_API_BASE_URL);
  const supabaseUrl = origin(environment.VSUAL_SUPABASE_URL);
  const publishableKey = publicKey(environment.VSUAL_SUPABASE_PUBLISHABLE_KEY);
  const workspaceId = environment.VSUAL_WORKSPACE_ID?.trim();
  if (
    !apiBaseUrl ||
    !supabaseUrl ||
    !publishableKey ||
    (workspaceId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        workspaceId,
      ))
  )
    return { ok: false, errorCode: 'SETUP_REQUIRED' };
  return {
    ok: true,
    value: {
      apiBaseUrl,
      supabaseUrl,
      publishableKey,
      ...(workspaceId ? { workspaceId } : {}),
    },
  };
}
