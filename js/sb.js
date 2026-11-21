import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const SUPABASE_URL = 'https://sresenperoritnaiyxwe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_goELYB3-nOB3wunjoyflhg_rr0v7WkL';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kmed-auth' },
});
