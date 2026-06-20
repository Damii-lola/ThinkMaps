// This is the one value a static, no-build-step frontend genuinely cannot
// avoid hardcoding: it has to know where the backend lives before it can
// ask the backend for anything else (like the Supabase URL/anon key below).
// Everything else config-related is fetched at runtime from /api/config —
// see supabaseClient.js — so it only ever needs to be set in Render's env vars.
export const API_BASE = 'https://thinkmap.onrender.com';
