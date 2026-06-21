// ============================================================
// Supabase is fully hidden behind Render now. This file never
// imports Supabase, never sees a Supabase URL or key — it only
// ever talks to your own backend.
//
// EDIT this one line before deploying:
// ============================================================
export const API_BASE_URL = 'https://thinkmap.onrender.com';

const ACCESS_TOKEN_KEY = 'tm_access_token';
const REFRESH_TOKEN_KEY = 'tm_refresh_token';

export function storeSession(session) {
  if (!session) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refresh_token);
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasSession() {
  return !!localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

async function tryRefresh() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token })
    });
    if (!res.ok) return false;
    const { session } = await res.json();
    storeSession(session);
    return true;
  } catch {
    return false;
  }
}

// Calls the Render backend for everything — AI generation, auth, blueprint storage.
// On a 401, tries one silent token refresh before giving up and bouncing to auth.html.
export async function apiFetch(path, options = {}, _isRetry = false) {
  const token = getAccessToken();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (res.status === 401 && !_isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch(path, options, true);
    clearSession();
    window.location.href = 'auth.html';
    return new Promise(() => {}); // navigation is happening; stop here
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return res.json();
}

// Call at the top of any protected page. Redirects to auth.html if logged out
// or the session can't be verified; otherwise returns { user, profile }.
export async function requireAuth() {
  if (!hasSession()) {
    window.location.href = 'auth.html';
    return null;
  }
  try {
    return await apiFetch('/api/auth/me');
  } catch {
    clearSession();
    window.location.href = 'auth.html';
    return null;
  }
}

export function signOut() {
  clearSession();
  window.location.href = 'index.html';
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
