export function publicOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function extensionHosts(
  environment: Record<string, string | undefined>,
) {
  const backend = publicOrigin(
    environment.VITE_API_BASE_URL || 'http://127.0.0.1:3000',
  );
  const supabase = publicOrigin(environment.VITE_SUPABASE_URL);
  return [
    ...new Set(
      [backend, supabase]
        .filter((origin): origin is string => !!origin)
        .map((origin) => {
          const url = new URL(origin);
          // Chromium host match patterns cannot restrict the port. Fetch still uses the configured origin.
          return `${url.protocol}//${url.hostname}/*`;
        }),
    ),
  ];
}
