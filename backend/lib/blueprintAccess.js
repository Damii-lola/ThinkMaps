import { supabase } from './supabaseClient.js';

const FREE_TIER_DAYS = 7;

export async function getBlueprintOrFail(blueprintId, userId) {
  const { data: blueprint, error } = await supabase
    .from('blueprints')
    .select('*')
    .eq('id', blueprintId)
    .eq('user_id', userId)
    .single();

  if (error || !blueprint) {
    const err = new Error('Blueprint not found');
    err.status = 404;
    throw err;
  }
  return blueprint;
}

export async function isBlueprintLocked(blueprint) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', blueprint.user_id)
    .single();

  if (profile?.plan === 'pro') return false;

  const ageMs = Date.now() - new Date(blueprint.created_at).getTime();
  return ageMs > FREE_TIER_DAYS * 24 * 60 * 60 * 1000;
}

// Throws a 403 if the blueprint is read-only (free plan, past the 7-day window).
export async function assertEditable(blueprintId, userId) {
  const blueprint = await getBlueprintOrFail(blueprintId, userId);
  if (await isBlueprintLocked(blueprint)) {
    const err = new Error(
      'This blueprint is read-only on the Free plan after 7 days. Upgrade to Pro to keep editing.'
    );
    err.status = 403;
    throw err;
  }
  return blueprint;
}
