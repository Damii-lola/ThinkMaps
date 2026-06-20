import { Router } from 'express';
import { supabase } from '../lib/supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { assertEditable } from '../lib/blueprintAccess.js';
import { generateGroupOptions, generateInsight } from '../services/mistral.js';

const router = Router();
router.use(requireAuth);

const GROUP_TYPES = ['niche', 'sub_niche', 'audience', 'monetization'];

const LABELS = {
  niche: 'Niches',
  sub_niche: 'Sub-Niches',
  audience: 'Audience',
  monetization: 'Monetization',
};

// Walks parent_option -> group -> parent_option ... back to the graph root,
// so Mistral gets the full chosen path as context for generating the next layer.
async function buildPathContext(parentOptionId) {
  const path = [];
  let currentOptionId = parentOptionId;

  while (currentOptionId) {
    const { data: option } = await supabase
      .from('node_options')
      .select('id, label, group_id')
      .eq('id', currentOptionId)
      .single();
    if (!option) break;
    path.unshift(option.label);

    const { data: group } = await supabase
      .from('node_groups')
      .select('id, parent_option_id')
      .eq('id', option.group_id)
      .single();
    if (!group) break;
    currentOptionId = group.parent_option_id;
  }
  return path;
}

// Create a new group of options branching off a chosen option.
// body: { groupType, parentOptionId, mode: 'generate' | 'random', positionX?, positionY? }
router.post('/:blueprintId/groups', async (req, res, next) => {
  try {
    const { blueprintId } = req.params;
    await assertEditable(blueprintId, req.user.id);

    const { groupType, parentOptionId, mode = 'generate' } = req.body || {};
    if (!GROUP_TYPES.includes(groupType)) {
      return res.status(400).json({ error: `groupType must be one of ${GROUP_TYPES.join(', ')}` });
    }
    if (!parentOptionId) {
      return res.status(400).json({ error: 'parentOptionId is required' });
    }

    const pathContext = await buildPathContext(parentOptionId);
    const options = await generateGroupOptions({ groupType, pathContext });

    const { data: group, error: gErr } = await supabase
      .from('node_groups')
      .insert({
        blueprint_id: blueprintId,
        type: groupType,
        label: LABELS[groupType],
        parent_option_id: parentOptionId,
        position_x: req.body.positionX ?? null,
        position_y: req.body.positionY ?? null,
      })
      .select()
      .single();
    if (gErr) throw gErr;

    const chosenLabels =
      mode === 'random' ? [options[Math.floor(Math.random() * options.length)]] : options;

    const { data: insertedOptions, error: oErr } = await supabase
      .from('node_options')
      .insert(chosenLabels.map((label) => ({ group_id: group.id, label })))
      .select();
    if (oErr) throw oErr;

    const { data: edge, error: eErr } = await supabase
      .from('edges')
      .insert({ blueprint_id: blueprintId, from_option_id: parentOptionId, to_group_id: group.id })
      .select()
      .single();
    if (eErr) throw eErr;

    // Insight text is a bonus — never fail the whole branch if it errors.
    let insight = null;
    try {
      insight = await generateInsight({ pathContext });
    } catch {
      insight = null;
    }

    res.status(201).json({ group, options: insertedOptions, edge, insight });
  } catch (err) {
    next(err);
  }
});

// Regenerate (retry) every option inside an existing group.
router.post('/:blueprintId/groups/:groupId/retry', async (req, res, next) => {
  try {
    const { blueprintId, groupId } = req.params;
    await assertEditable(blueprintId, req.user.id);

    const { data: group, error: gErr } = await supabase
      .from('node_groups')
      .select('*')
      .eq('id', groupId)
      .eq('blueprint_id', blueprintId)
      .single();
    if (gErr || !group) return res.status(404).json({ error: 'Group not found' });

    const { data: existing } = await supabase.from('node_options').select('label').eq('group_id', groupId);

    const pathContext = group.parent_option_id ? await buildPathContext(group.parent_option_id) : [];

    const options = await generateGroupOptions({
      groupType: group.type,
      pathContext,
      excludeLabels: (existing || []).map((o) => o.label),
    });

    const { error: delErr } = await supabase.from('node_options').delete().eq('group_id', groupId);
    if (delErr) throw delErr;

    const { data: insertedOptions, error: oErr } = await supabase
      .from('node_options')
      .insert(options.map((label) => ({ group_id: groupId, label })))
      .select();
    if (oErr) throw oErr;

    res.json({ group, options: insertedOptions });
  } catch (err) {
    next(err);
  }
});

// Insert a custom, user-typed option into an existing group.
router.post('/:blueprintId/groups/:groupId/custom-option', async (req, res, next) => {
  try {
    const { blueprintId, groupId } = req.params;
    await assertEditable(blueprintId, req.user.id);

    const label = (req.body?.label || '').trim().slice(0, 80);
    if (!label) return res.status(400).json({ error: 'label is required' });

    const { data: option, error } = await supabase
      .from('node_options')
      .insert({ group_id: groupId, label, is_custom: true })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ option });
  } catch (err) {
    next(err);
  }
});

// Mark an option's branch as frozen (grayed out, never deleted) — used when
// the user backtracks to try a different path from an earlier node.
router.post('/:blueprintId/options/:optionId/freeze', async (req, res, next) => {
  try {
    const { blueprintId, optionId } = req.params;
    await assertEditable(blueprintId, req.user.id);

    const { data, error } = await supabase
      .from('node_options')
      .update({ frozen: true })
      .eq('id', optionId)
      .select()
      .single();
    if (error) throw error;

    res.json({ option: data });
  } catch (err) {
    next(err);
  }
});

// Reverse a freeze if the user re-selects an old branch.
router.post('/:blueprintId/options/:optionId/unfreeze', async (req, res, next) => {
  try {
    const { blueprintId, optionId } = req.params;
    await assertEditable(blueprintId, req.user.id);

    const { data, error } = await supabase
      .from('node_options')
      .update({ frozen: false })
      .eq('id', optionId)
      .select()
      .single();
    if (error) throw error;

    res.json({ option: data });
  } catch (err) {
    next(err);
  }
});

export default router;
