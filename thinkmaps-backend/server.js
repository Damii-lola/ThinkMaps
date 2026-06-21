require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Supabase client — service role key, so this bypasses RLS entirely.
// Every privileged read/write for ThinkMaps goes through this one client.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Verifies the Supabase access token sent from script.js (Authorization: Bearer <token>)
// and attaches the real user to req.user. Every route that touches a specific
// user's data sits behind this — never trust a user_id sent in the request body.
async function requireAuth(req, res, next){
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if(!token){
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if(error || !data?.user){
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }

  req.user = data.user;
  next();
}

// Root — quick sanity check that the service is alive
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ThinkMaps API',
    message: 'Server is alive and connected to Render.'
  });
});

// Health check — useful for uptime monitors / Render's own checks
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Supabase connectivity check — confirms the URL + service role key
// actually reach the database and that the schema is in place.
app.get('/supabase-check', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    res.status(200).json({
      status: 'connected',
      message: 'Supabase responded successfully.',
      profilesCount: count
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'Could not reach Supabase.',
      detail: err.message
    });
  }
});

// Resolves a sign-in identifier to an email address.
// If it's already an email, hands it straight back. If it's a username,
// looks it up via the service role key (frontend can't — RLS blocks it).
// Never touches passwords — that check happens entirely through Supabase Auth.
app.post('/auth/resolve-email', async (req, res) => {
  const { identifier } = req.body;

  if (!identifier) {
    return res.status(400).json({ error: 'Identifier is required.' });
  }

  if (identifier.includes('@')) {
    return res.status(200).json({ email: identifier });
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('email')
      .eq('username', identifier)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'No account found for that username.' });
    }

    res.status(200).json({ email: data.email });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.', detail: err.message });
  }
});

// Hands the frontend its Supabase URL + anon key — both public-safe by design,
// but pulled from Render env vars instead of sitting hardcoded in script.js.
// NEVER add the service role key or any AI provider key to this response.
app.get('/config', (req, res) => {
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// Dashboard data — profile + every blueprint this user owns, each one
// annotated with whether it's locked (free tier, 7 days, no Pro) and how
// many days are left if it isn't. Locked is computed on the fly from
// created_at + pro_status — nothing is stored as "locked," so this is
// always correct even if Pro status changes after the fact.
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username, email, pro_status, pro_expires_at')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;

    const { data: blueprints, error: blueprintsError } = await supabase
      .from('blueprints')
      .select('id, title, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (blueprintsError) throw blueprintsError;

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const enrichedBlueprints = blueprints.map(bp => {
      const ageMs = now - new Date(bp.created_at).getTime();
      const isLocked = !profile.pro_status && ageMs > SEVEN_DAYS_MS;
      const daysRemaining = Math.max(0, Math.ceil((SEVEN_DAYS_MS - ageMs) / (24 * 60 * 60 * 1000)));
      return { ...bp, isLocked, daysRemaining: isLocked ? 0 : daysRemaining };
    });

    res.status(200).json({
      profile,
      blueprints: enrichedBlueprints,
      canCreateNew: profile.pro_status || blueprints.length === 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load dashboard.', detail: err.message });
  }
});

// Creates a new blueprint. Free tier gets exactly one, ever — this is the
// one place that rule is actually enforced, server-side, not just hidden in the UI.
app.post('/blueprints', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('pro_status')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;

    if (!profile.pro_status) {
      const { count, error: countError } = await supabase
        .from('blueprints')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (countError) throw countError;

      if (count > 0) {
        return res.status(403).json({
          error: 'Free tier allows one blueprint. Upgrade to Pro for unlimited blueprints.'
        });
      }
    }

    const title = (req.body && req.body.title) || 'Untitled Blueprint';

    const { data: newBlueprint, error: insertError } = await supabase
      .from('blueprints')
      .insert({ user_id: userId, title })
      .select()
      .single();

    if (insertError) throw insertError;

    res.status(201).json({ blueprint: newBlueprint });
  } catch (err) {
    res.status(500).json({ error: 'Could not create blueprint.', detail: err.message });
  }
});

// ============================================================
// MISTRAL — the node-generation engine for the Blueprint Graph.
// ============================================================
async function callMistral(messages){
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
      response_format: { type: 'json_object' }
    })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if(!content) throw new Error('Mistral returned no content.');

  return JSON.parse(content);
}

// Walks UP the tree from a group to the root, collecting {groupLabel, optionLabel}
// pairs — this is the "path so far" context fed into every generation prompt.
async function buildPathContext(groupId){
  const path = [];
  let currentGroupId = groupId;

  while(currentGroupId){
    const { data: group } = await supabase
      .from('groups')
      .select('id, label')
      .eq('id', currentGroupId)
      .single();

    if(!group) break;

    const { data: connection } = await supabase
      .from('connections')
      .select('from_option_id')
      .eq('to_group_id', currentGroupId)
      .maybeSingle();

    if(!connection){
      path.unshift({ groupLabel: group.label, optionLabel: null });
      break; // this is the root group, nothing above it
    }

    const { data: option } = await supabase
      .from('options')
      .select('label, group_version_id')
      .eq('id', connection.from_option_id)
      .single();

    path.unshift({ groupLabel: group.label, optionLabel: option?.label || null });

    const { data: version } = await supabase
      .from('group_versions')
      .select('group_id')
      .eq('id', option.group_version_id)
      .single();

    currentGroupId = version?.group_id || null;
  }

  return path;
}

// Generates up to 6 options for a group (root niches, a fresh branch, or a Retry).
async function generateGroupOptions(pathContext, { isRetry = false, isRoot = false } = {}){
  const pathDescription = pathContext.length === 0
    ? 'This is the very start of the blueprint — no path chosen yet.'
    : pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ');

  const instructions = isRoot
    ? 'Generate the starting "Niches" group for a new app-idea Blueprint Graph: up to 6 high-quality, distinct app niches (e.g. Fitness, Finance & Commerce, Productivity, Entertainment).'
    : 'Based on the path so far, decide the next logical group (e.g. "Sub-Niches", "Audience", "Monetization Preferences", "Genres", or another fitting label) and generate up to 6 specific, concrete options for it.';

  const retryNote = isRetry
    ? ' Give a genuinely different, fresh set of alternatives than what would typically come first — avoid repeating obvious options.'
    : '';

  const systemPrompt = `You are the node-generation engine for ThinkMaps, an app-idea ideation tool. ${instructions}${retryNote} Mark exactly ONE option as recommended with a short one-sentence hint explaining why it's promising for building a profitable app. Respond ONLY with valid JSON in this exact shape, nothing else: {"groupLabel": string, "options": [{"label": string, "recommended": boolean, "hint": string or null}]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Path so far: ${pathDescription}` }
  ]);
}

// AI-weighted pick for the Random button — asks Mistral which existing
// option is most promising, falls back to a plain random pick if anything's off.
async function pickBestOptionWithAI(optionsList, pathContext){
  const pathDescription = pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ') || 'Start of the blueprint.';
  const optionLabels = optionsList.map(o => o.label);

  try {
    const result = await callMistral([
      {
        role: 'system',
        content: 'You help pick the most promising next step in an app-idea Blueprint Graph. Respond ONLY with JSON: {"chosenLabel": string} — chosenLabel must exactly match one of the given options.'
      },
      {
        role: 'user',
        content: `Path so far: ${pathDescription}\nOptions: ${JSON.stringify(optionLabels)}`
      }
    ]);

    const match = optionsList.find(o => o.label === result.chosenLabel);
    if(match) return match;
  } catch (err) {
    // fall through to random fallback below
  }

  return optionsList[Math.floor(Math.random() * optionsList.length)];
}

// Recursively freezes a group and everything that grew beneath it — used when
// the user branches away from a previously-explored sibling option.
async function freezeGroupSubtree(groupId){
  await supabase.from('groups').update({ is_frozen: true }).eq('id', groupId);

  const { data: versions } = await supabase.from('group_versions').select('id').eq('group_id', groupId);
  const versionIds = (versions || []).map(v => v.id);
  if(versionIds.length === 0) return;

  const { data: childOptions } = await supabase.from('options').select('id').in('group_version_id', versionIds);
  const optionIds = (childOptions || []).map(o => o.id);
  if(optionIds.length === 0) return;

  const { data: childConnections } = await supabase.from('connections').select('to_group_id').in('from_option_id', optionIds);

  for(const conn of (childConnections || [])){
    await freezeGroupSubtree(conn.to_group_id);
  }
}

async function getBlueprintIdForGroup(groupId){
  const { data } = await supabase.from('groups').select('blueprint_id').eq('id', groupId).single();
  return data?.blueprint_id;
}

async function getOwnedBlueprint(blueprintId, userId){
  const { data: blueprint, error } = await supabase
    .from('blueprints')
    .select('id, user_id, title, created_at')
    .eq('id', blueprintId)
    .single();

  if(error || !blueprint || blueprint.user_id !== userId) return null;
  return blueprint;
}

async function checkIsLocked(userId, blueprintCreatedAt){
  const { data: profile } = await supabase.from('profiles').select('pro_status').eq('id', userId).single();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - new Date(blueprintCreatedAt).getTime();
  return !profile?.pro_status && ageMs > SEVEN_DAYS_MS;
}

async function verifyOptionOwnershipAndLock(optionId, userId){
  const { data: option } = await supabase.from('options').select('group_version_id').eq('id', optionId).single();
  if(!option) return { error: 'Option not found.', status: 404 };

  const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
  if(!version) return { error: 'Group version not found.', status: 404 };

  const { data: group } = await supabase.from('groups').select('blueprint_id').eq('id', version.group_id).single();
  if(!group) return { error: 'Group not found.', status: 404 };

  const blueprint = await getOwnedBlueprint(group.blueprint_id, userId);
  if(!blueprint) return { error: 'Not your blueprint.', status: 403 };

  if(await checkIsLocked(userId, blueprint.created_at)){
    return { error: 'This blueprint is read-only on the free tier.', status: 403 };
  }

  return { ok: true };
}

async function verifyGroupOwnershipAndLock(groupId, userId, { allowWhenLocked = false } = {}){
  const { data: group } = await supabase.from('groups').select('blueprint_id').eq('id', groupId).single();
  if(!group) return { error: 'Group not found.', status: 404 };

  const blueprint = await getOwnedBlueprint(group.blueprint_id, userId);
  if(!blueprint) return { error: 'Not your blueprint.', status: 403 };

  if(!allowWhenLocked && await checkIsLocked(userId, blueprint.created_at)){
    return { error: 'This blueprint is read-only on the free tier.', status: 403 };
  }

  return { ok: true, group, blueprint };
}

// The core action: branch from a given option. If that option already has a
// child group (already explored before), this just reactivates it — no AI
// call, instant. Otherwise it generates a brand new group via Mistral.
// Either way, sibling options in the SAME version that have their own child
// branch get frozen — only one branch per fork point is "active" at a time.
async function branchFromOption(optionId){
  const { data: option } = await supabase
    .from('options')
    .select('id, label, group_version_id')
    .eq('id', optionId)
    .single();

  if(!option) throw new Error('Option not found.');

  const { data: version } = await supabase
    .from('group_versions')
    .select('id, group_id')
    .eq('id', option.group_version_id)
    .single();

  if(!version) throw new Error('Group version not found.');

  const { data: siblingOptions } = await supabase
    .from('options')
    .select('id')
    .eq('group_version_id', version.id)
    .neq('id', optionId);

  for(const sibling of (siblingOptions || [])){
    const { data: siblingConnection } = await supabase
      .from('connections')
      .select('to_group_id')
      .eq('from_option_id', sibling.id)
      .maybeSingle();

    if(siblingConnection){
      await freezeGroupSubtree(siblingConnection.to_group_id);
    }
  }

  const { data: existingConnection } = await supabase
    .from('connections')
    .select('to_group_id')
    .eq('from_option_id', optionId)
    .maybeSingle();

  await supabase.from('options').update({ is_selected: true }).eq('id', optionId);

  if(existingConnection){
    await supabase.from('groups').update({ is_frozen: false }).eq('id', existingConnection.to_group_id);

    const { data: childGroup } = await supabase
      .from('groups')
      .select('*')
      .eq('id', existingConnection.to_group_id)
      .single();

    return { group: childGroup, reactivated: true };
  }

  const pathContext = await buildPathContext(version.group_id);
  pathContext.push({ groupLabel: '(this group)', optionLabel: option.label });

  const generated = await generateGroupOptions(pathContext);
  const blueprintId = await getBlueprintIdForGroup(version.group_id);

  const { data: newGroup, error: groupInsertError } = await supabase
    .from('groups')
    .insert({ blueprint_id: blueprintId, label: generated.groupLabel || 'Untitled Group', is_frozen: false })
    .select()
    .single();

  if(groupInsertError) throw groupInsertError;

  const { data: newVersion, error: versionInsertError } = await supabase
    .from('group_versions')
    .insert({ group_id: newGroup.id, version_number: 1 })
    .select()
    .single();

  if(versionInsertError) throw versionInsertError;

  const optionRows = (generated.options || []).slice(0, 6).map(o => ({
    group_version_id: newVersion.id,
    label: o.label,
    is_recommended: !!o.recommended,
    hint: o.hint || null
  }));

  const { data: insertedOptions, error: optionsInsertError } = await supabase
    .from('options')
    .insert(optionRows)
    .select();

  if(optionsInsertError) throw optionsInsertError;

  await supabase.from('connections').insert({ from_option_id: optionId, to_group_id: newGroup.id });

  return { group: { ...newGroup, options: insertedOptions }, reactivated: false };
}

// Fetches the full graph for a blueprint. Auto-generates the root "Niches"
// group via Mistral if this is a brand new, empty blueprint.
app.get('/blueprints/:id/graph', requireAuth, async (req, res) => {
  try {
    const blueprint = await getOwnedBlueprint(req.params.id, req.user.id);
    if(!blueprint) return res.status(404).json({ error: 'Blueprint not found.' });

    const isLocked = await checkIsLocked(req.user.id, blueprint.created_at);

    let { data: groups, error: groupsError } = await supabase
      .from('groups')
      .select('*')
      .eq('blueprint_id', blueprint.id);

    if(groupsError) throw groupsError;

    if(groups.length === 0){
      const generated = await generateGroupOptions([], { isRoot: true });

      const { data: rootGroup, error: rootGroupError } = await supabase
        .from('groups')
        .insert({ blueprint_id: blueprint.id, label: generated.groupLabel || 'Niches', position_x: 0, position_y: 0 })
        .select()
        .single();

      if(rootGroupError) throw rootGroupError;

      const { data: rootVersion, error: rootVersionError } = await supabase
        .from('group_versions')
        .insert({ group_id: rootGroup.id, version_number: 1 })
        .select()
        .single();

      if(rootVersionError) throw rootVersionError;

      const optionRows = (generated.options || []).slice(0, 6).map(o => ({
        group_version_id: rootVersion.id,
        label: o.label,
        is_recommended: !!o.recommended,
        hint: o.hint || null
      }));

      await supabase.from('options').insert(optionRows);

      groups = [rootGroup];
    }

    const groupIds = groups.map(g => g.id);

    const { data: groupVersions } = await supabase.from('group_versions').select('*').in('group_id', groupIds);
    const versionIds = (groupVersions || []).map(v => v.id);

    const { data: allOptions } = versionIds.length
      ? await supabase.from('options').select('*').in('group_version_id', versionIds)
      : { data: [] };

    const optionIds = (allOptions || []).map(o => o.id);

    const { data: connections } = optionIds.length
      ? await supabase.from('connections').select('*').in('from_option_id', optionIds)
      : { data: [] };

    res.status(200).json({
      blueprint: { id: blueprint.id, title: blueprint.title, isLocked },
      groups,
      groupVersions: groupVersions || [],
      options: allOptions || [],
      connections: connections || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load blueprint graph.', detail: err.message });
  }
});

// Branch from an option — generates (or reactivates) the next group.
app.post('/options/:id/branch', requireAuth, async (req, res) => {
  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const result = await branchFromOption(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not branch from that option.', detail: err.message });
  }
});

// Retry — creates a NEW version of this group's options. The old version,
// and anything that grew from it, is never touched.
app.post('/groups/:id/retry', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const pathContext = await buildPathContext(req.params.id);
    const generated = await generateGroupOptions(pathContext, { isRetry: true });

    const { data: existingVersions } = await supabase
      .from('group_versions')
      .select('version_number')
      .eq('group_id', req.params.id)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersionNumber = (existingVersions?.[0]?.version_number || 0) + 1;

    const { data: newVersion, error: versionError } = await supabase
      .from('group_versions')
      .insert({ group_id: req.params.id, version_number: nextVersionNumber })
      .select()
      .single();

    if(versionError) throw versionError;

    const optionRows = (generated.options || []).slice(0, 6).map(o => ({
      group_version_id: newVersion.id,
      label: o.label,
      is_recommended: !!o.recommended,
      hint: o.hint || null
    }));

    const { data: insertedOptions, error: optionsError } = await supabase
      .from('options')
      .insert(optionRows)
      .select();

    if(optionsError) throw optionsError;

    await supabase.from('groups').update({ current_version_number: nextVersionNumber }).eq('id', req.params.id);

    res.status(200).json({ versionNumber: nextVersionNumber, options: insertedOptions });
  } catch (err) {
    res.status(500).json({ error: 'Could not retry this group.', detail: err.message });
  }
});

// Flip which version of a group is currently shown — purely a view change,
// allowed even on a locked/read-only blueprint, since nothing is being created.
app.patch('/groups/:id/switch-version', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id, { allowWhenLocked: true });
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { versionNumber } = req.body;
    if(!versionNumber) return res.status(400).json({ error: 'versionNumber is required.' });

    await supabase.from('groups').update({ current_version_number: versionNumber }).eq('id', req.params.id);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not switch version.', detail: err.message });
  }
});

// Custom Insert — adds a manually typed option to a group's current version.
app.post('/groups/:id/custom-option', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { label } = req.body;
    if(!label || !label.trim()) return res.status(400).json({ error: 'Label is required.' });

    const { data: group } = await supabase.from('groups').select('current_version_number').eq('id', req.params.id).single();

    const { data: version } = await supabase
      .from('group_versions')
      .select('id')
      .eq('group_id', req.params.id)
      .eq('version_number', group.current_version_number)
      .single();

    const { data: newOption, error: insertError } = await supabase
      .from('options')
      .insert({ group_version_id: version.id, label: label.trim(), is_recommended: false })
      .select()
      .single();

    if(insertError) throw insertError;

    res.status(201).json({ option: newOption });
  } catch (err) {
    res.status(500).json({ error: 'Could not add custom option.', detail: err.message });
  }
});

// Random — AI picks the most promising existing option in the current
// version, then branches from it exactly like a normal click would.
app.post('/groups/:id/random-branch', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: group } = await supabase.from('groups').select('current_version_number').eq('id', req.params.id).single();

    const { data: version } = await supabase
      .from('group_versions')
      .select('id')
      .eq('group_id', req.params.id)
      .eq('version_number', group.current_version_number)
      .single();

    const { data: currentOptions } = await supabase.from('options').select('*').eq('group_version_id', version.id);

    if(!currentOptions || currentOptions.length === 0){
      return res.status(400).json({ error: 'This group has no options yet.' });
    }

    const pathContext = await buildPathContext(req.params.id);
    const chosen = await pickBestOptionWithAI(currentOptions, pathContext);
    const result = await branchFromOption(chosen.id);

    res.status(200).json({ ...result, chosenOption: chosen });
  } catch (err) {
    res.status(500).json({ error: 'Could not auto-branch.', detail: err.message });
  }
});

// Saves a group's dragged position. Allowed even when locked — repositioning
// isn't "editing the idea," it's just rearranging what's already there.
app.patch('/groups/:id/position', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id, { allowWhenLocked: true });
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { positionX, positionY } = req.body;
    await supabase.from('groups').update({ position_x: positionX, position_y: positionY }).eq('id', req.params.id);

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not save position.', detail: err.message });
  }
});

// Future routes (idea generation, Pro access) get mounted below
// as we build them out — keeping this file as the single entry point for now.

app.listen(PORT, () => {
  console.log(`ThinkMaps API running on port ${PORT}`);
});

// Render's free tier spins the service down after ~15 minutes with no
// incoming traffic — that's what makes the FIRST request after a quiet
// stretch feel slow (cold start). This self-ping keeps it warm, same
// pattern already used on the other projects.
const SELF_PING_URL = 'https://thinkmaps.onrender.com/health';
setInterval(() => {
  fetch(SELF_PING_URL).catch(() => {}); // best-effort, ignore failures
}, 4 * 60 * 1000);
