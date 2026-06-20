import { supabase } from './supabaseClient.js';

// Fill in your deployed Render backend URL.
const API_BASE = 'https://YOUR-RENDER-BACKEND.onrender.com/api';

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${token}` };
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  listBlueprints: () => request('/blueprints'),
  createBlueprint: (title) => request('/blueprints', { method: 'POST', body: { title } }),
  getBlueprint: (id) => request(`/blueprints/${id}`),

  createGroup: (blueprintId, body) =>
    request(`/blueprints/${blueprintId}/groups`, { method: 'POST', body }),

  retryGroup: (blueprintId, groupId) =>
    request(`/blueprints/${blueprintId}/groups/${groupId}/retry`, { method: 'POST' }),

  addCustomOption: (blueprintId, groupId, label) =>
    request(`/blueprints/${blueprintId}/groups/${groupId}/custom-option`, {
      method: 'POST',
      body: { label },
    }),

  freezeOption: (blueprintId, optionId) =>
    request(`/blueprints/${blueprintId}/options/${optionId}/freeze`, { method: 'POST' }),

  unfreezeOption: (blueprintId, optionId) =>
    request(`/blueprints/${blueprintId}/options/${optionId}/unfreeze`, { method: 'POST' }),

  updateGroupPosition: (blueprintId, groupId, positionX, positionY) =>
    request(`/blueprints/${blueprintId}/groups/${groupId}/position`, {
      method: 'PATCH',
      body: { positionX, positionY },
    }),
};
