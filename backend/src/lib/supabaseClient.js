import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabaseClient] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. ' +
    'Copy backend/.env.example to backend/.env and fill it in.'
  );
}

// Service-role client: bypasses RLS, used only on the backend for trusted operations
// (e.g. AI generation writes, Selar webhook handling). Never ship this key to the frontend.
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
