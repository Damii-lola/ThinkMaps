import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { API_BASE } from './config.js';

// The Supabase URL and anon key live in Render's env vars now, not here.
// This fetches them once from the backend's public /api/config endpoint
// and builds the client from that — change the key in Render, nothing to
// touch or redeploy on the frontend.
async function buildClient() {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) {
    throw new Error('Could not load app config from the backend — is it awake and is API_BASE in config.js correct?');
  }
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  return createClient(supabaseUrl, supabaseAnonKey);
}

// The fetch starts immediately when this module loads. Every page does:
//   import { supabasePromise } from './supabaseClient.js';
//   const supabase = await supabasePromise;
export const supabasePromise = buildClient();
