// Use direct property access so Next.js can inline public configuration in the browser.
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url && !publishableKey) return null;

  if (!url || !publishableKey) {
    throw new Error(
      'Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  const parsedUrl = URL.parse(url);
  if (
    !parsedUrl ||
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== '/'
  ) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL must be an HTTPS project origin.',
    );
  }

  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.',
    );
  }

  return { url: parsedUrl.origin, publishableKey };
}

export function requireSupabaseConfig() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      'Supabase Auth is not configured. Set the public Supabase variables in apps/web/.env.local.',
    );
  }
  return config;
}
