// ============================================================
// EDIT THESE THREE LINES before deploying — there's no build step
// anymore, so this file IS the config.
//
// The Supabase anon key is SAFE to put here in plain text — it's
// meant to be public. Real protection comes from Row Level Security
// policies on the tables (already set up in supabase_schema.sql),
// not from hiding this key.
// ============================================================
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
export const API_BASE_URL = 'https://thinkmaps.onrender.com'; // your Render backend, still in use exactly as before

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Calls the Render backend (Mistral/Gemini/research endpoints), attaching
// the user's Supabase session token so the backend can verify who's asking.
export async function apiFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return res.json();
}

// Call at the top of any protected page. Redirects to auth.html if logged out.
export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = 'auth.html';
    return null;
  }
  return data.session.user;
}

export async function getProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data || null;
}

// Shared free-tier lock rule: Pro users never lock; everyone else locks 7 days after creation.
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export function isBlueprintLocked(blueprint, profile) {
  if (profile?.is_pro) return false;
  return Date.now() - new Date(blueprint.created_at).getTime() > SEVEN_DAYS_MS;
}

// Builds the shared top nav. `rightNode` is any DOM node (button, link) to drop on the right.
export function renderNavBar(container, rightNode) {
  container.className = 'app-nav';
  container.innerHTML = '';

  const logo = document.createElement('a');
  logo.href = 'index.html';
  logo.className = 'logo';
  logo.innerHTML = `<svg class="logo-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <circle cx="9" cy="3" r="2" fill="#D97757"/>
    <circle cx="3" cy="14" r="2" fill="#1F1B16"/>
    <circle cx="15" cy="14" r="2" fill="#1F1B16"/>
    <path d="M9 5L3 12M9 5L15 12" stroke="#D97757" stroke-width="1.2"/>
  </svg> ThinkMaps`;

  const right = document.createElement('div');
  right.className = 'app-nav-right';
  if (rightNode) right.appendChild(rightNode);

  container.appendChild(logo);
  container.appendChild(right);
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
