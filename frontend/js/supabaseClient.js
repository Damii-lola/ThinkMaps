import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// The anon key is meant to be public — Row Level Security (already enabled
// in backend/db/schema.sql) is what actually protects each user's data, not
// keeping this key secret. Find both values in Supabase → Settings → API.
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
