import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { getBlueprintOrFail, isBlueprintLocked } from '../lib/blueprintAccess.js';

const router = Router();
router.use(requireAuth);

// List the current user's blueprints (free users can start as many as they
// like over time; each one individually locks 7 days after creation).
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('blueprints')
      .select('id, title, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ blueprints: data });
  } catch (err) {
    next(err);
  }
});

// Create a new blueprint, seeded with a root "Niches" group (empty — the
// frontend calls POST /:id/groups separately to actually fill it via Mistral).
router.post('/', async (req, res, next) => {
  try {
    const title = (req.body?.title || 'Untitled blueprint').trim().slice(0, 120);

    const { data: blueprint, error: bpError } = await supabase
      .from('blueprints')
      .insert({ user_id: req.user.id, title })
      .select()
      .single();
    if (bpError) throw bpError;

    const { data: rootGroup, error: groupError } = await supabase
      .from('node_groups')
      .insert({
        blueprint_id: blueprint.id,
        type: 'niche',
        label: 'Niches',
        position_x: 80,
        position_y: 200,
      })
      .select()
      .single();
    if (groupError) throw groupError;

    res.status(201).json({ blueprint, rootGroup });
  } catch (err) {
    next(err);
  }
});

// Fetch a full blueprint graph: groups + options + edges, plus whether
// it's currently locked (free plan, past the 7-day window).
router.get('/:id', async (req, res, next) => {
  try {
    const blueprint = await getBlueprintOrFail(req.params.id, req.user.id);
    const locked = await isBlueprintLocked(blueprint);

    const { data: groups, error: gErr } = await supabase
      .from('node_groups')
      .select('*')
      .eq('blueprint_id', blueprint.id);
    if (gErr) throw gErr;

    const groupIds = groups.map((g) => g.id);

    const { data: options, error: oErr } = groupIds.length
      ? await supabase.from('node_options').select('*').in('group_id', groupIds)
      : { data: [], error: null };
    if (oErr) throw oErr;

    const { data: edges, error: eErr } = await supabase
      .from('edges')
      .select('*')
      .eq('blueprint_id', blueprint.id);
    if (eErr) throw eErr;

    res.json({ blueprint, locked, groups, options, edges });
  } catch (err) {
    next(err);
  }
});

export default router;
