'use client';

import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseConfig } from './env';

// Auth only. Product data must go through the application's backend.
export function createClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}
