import { ordersOrigins, publicOrigin } from './config-values.ts';

export function getExtensionConfig() {
  const backend = publicOrigin(
    import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000',
  );
  const supabaseUrl = publicOrigin(import.meta.env.VITE_SUPABASE_URL);
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (
    !backend ||
    !supabaseUrl ||
    !publishableKey?.startsWith('sb_publishable_')
  )
    return null;
  return {
    backend,
    supabaseUrl,
    publishableKey,
    ordersOrigins: ordersOrigins(import.meta.env),
  };
}
