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
// Walks UP the tree from an OPTION to the root, via spawned_from_option_id —
// this is the "path so far" context fed into every generation prompt.
async function buildPathContextFromOption(optionId){
  const path = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const { data: option } = await supabase
      .from('options')
      .select('id, label, group_version_id')
      .eq('id', currentOptionId)
      .single();

    if(!option) break;

    const { data: version } = await supabase
      .from('group_versions')
      .select('group_id')
      .eq('id', option.group_version_id)
      .single();

    if(!version) break;

    const { data: group } = await supabase
      .from('groups')
      .select('label, spawned_from_option_id')
      .eq('id', version.group_id)
      .single();

    if(!group) break;

    path.unshift({ groupLabel: group.label, optionLabel: option.label });
    currentOptionId = group.spawned_from_option_id || null;
  }

  return path;
}

// Generates up to 6 options for a SINGLE group (used for the root "Niches"
// group, and for Retry — both deal with one group's own option list).
// The same 9 blocks driving the 45-question ideation intake. The canvas's
// candidate-group generation is now tied to this exact list — a group's
// label is ASSIGNED by the backend, never invented freely by the model.
const IDEATION_BLOCK_NAMES = [
  'Personal Pull',
  'Personal Connection to the Audience',
  'Personal Read on the Pain',
  'Honest Awareness of What Exists',
  'Cross-Pollination & Creative Inspiration',
  'Your Vision for the Experience',
  'Context, Distribution & Values',
  'Personal Stakes & Long-Term Vision',
  'What You Actually Know About Yourself'
];

// Picks the next N blocks not yet used along THIS path — so a single
// exploration marches through all 9 without repeats. If a path goes deep
// enough to exhaust all 9, it cycles back from the start rather than
// breaking.
function pickNextBlocks(usedBlocks, count){
  const remaining = IDEATION_BLOCK_NAMES.filter(b => !usedBlocks.includes(b));
  if(remaining.length >= count) return remaining.slice(0, count);
  const needed = count - remaining.length;
  return [...remaining, ...IDEATION_BLOCK_NAMES.slice(0, needed)];
}

// Walks the ancestor chain from an option back to root, collecting which
// blocks have already been assigned to groups along the way.
async function getUsedBlockNames(optionId){
  const used = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const { data: option } = await supabase.from('options').select('group_version_id').eq('id', currentOptionId).single();
    if(!option) break;

    const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
    if(!version) break;

    const { data: group } = await supabase.from('groups').select('block_name, spawned_from_option_id').eq('id', version.group_id).single();
    if(!group) break;

    if(group.block_name) used.push(group.block_name);
    currentOptionId = group.spawned_from_option_id || null;
  }

  return used;
}

async function generateGroupOptions(pathContext, { isRetry = false, isRoot = false, blockName = null } = {}){
  const pathDescription = pathContext.length === 0
    ? 'This is the very start of the blueprint — no path chosen yet.'
    : pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ');

  const instructions = isRoot
    ? 'Generate the starting "Niches" group for a new app-idea Blueprint Graph: up to 6 high-quality, distinct app niches (e.g. Fitness, Finance & Commerce, Productivity, Entertainment).'
    : `Based on the path so far, generate up to 6 specific, concrete options for the "${blockName}" block — every option must fit squarely within that block's territory and must be something the person could answer from their own knowledge, instinct, or preference, never something requiring market research they don't have.`;

  const retryNote = isRetry
    ? ' Give a genuinely different, fresh set of alternatives than what would typically come first — avoid repeating obvious options, but stay within the same block.'
    : '';

  const systemPrompt = `You are the node-generation engine for ThinkMaps, an app-idea ideation tool. ${instructions}${retryNote} Respond ONLY with valid JSON in this exact shape, nothing else: {"groupLabel": string, "options": [{"label": string}]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Path so far: ${pathDescription}` }
  ]);
}

// Generates a BATCH of candidate groups — one per ASSIGNED block, not
// freely invented categories. This is what happens when an option gets
// activated (clicked, for root; dragged-into, for everything else): each
// of the (up to 3) new groups corresponds to a specific block from the
// same 9 driving the ideation intake, so canvas exploration and the
// 45-question flow are two expressions of the same underlying structure.
async function generateCandidateBatch(pathContext, blockNames){
  const pathDescription = pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ') || 'Start of the blueprint.';
  const blockList = blockNames.map((b, i) => `${i + 1}. ${b}`).join('\n');

  const systemPrompt = `You are the node-generation engine for ThinkMaps, an app-idea ideation tool. Based on the path so far, generate up to 6 specific, concrete options for EACH of these ${blockNames.length} blocks, in this exact order:\n${blockList}\nEvery option must fit squarely within its block's territory and must be something the person could answer from their own knowledge, instinct, or preference — never something requiring market research they don't have. Respond ONLY with valid JSON, nothing else, in this exact shape: {"groups": [{"options": [{"label": string}, ...]}]} with exactly ${blockNames.length} entries in "groups", in the same order as the blocks listed above.`;

  const result = await callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Path so far: ${pathDescription}` }
  ]);

  // The label is FORCED to match the assigned block — never trust the model
  // to echo it back, that's the one thing here that must stay fixed.
  const groups = (result.groups || []).map((g, i) => ({
    groupLabel: blockNames[i] || 'Untitled',
    blockName: blockNames[i] || null,
    options: g.options || []
  }));

  return { groups };
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

// Freezes everything an option spawned, recursively — used when a different
// sibling gets activated instead (root siblings in one group_version, or
// non-root siblings spawned by the same parent option).
async function freezeOptionSubtree(optionId){
  const { data: spawnedGroups } = await supabase.from('groups').select('id').eq('spawned_from_option_id', optionId);

  for(const g of (spawnedGroups || [])){
    await supabase.from('groups').update({ is_frozen: true }).eq('id', g.id);

    const { data: versions } = await supabase.from('group_versions').select('id').eq('group_id', g.id);
    const versionIds = (versions || []).map(v => v.id);
    if(versionIds.length === 0) continue;

    const { data: innerOptions } = await supabase.from('options').select('id').in('group_version_id', versionIds);

    for(const io of (innerOptions || [])){
      await freezeOptionSubtree(io.id);
    }
  }
}

// Un-grays the IMMEDIATE batch an option spawned (re-activating a previously
// frozen branch). Deliberately not recursive — choices made deeper inside
// stay exactly as they were, only the top of this branch un-freezes.
async function unfreezeOptionSubtree(optionId){
  const { data: spawnedGroups } = await supabase.from('groups').select('id').eq('spawned_from_option_id', optionId);
  for(const g of (spawnedGroups || [])){
    await supabase.from('groups').update({ is_frozen: false }).eq('id', g.id);
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
// The core action: activate an option. Always does the same thing regardless
// of HOW it got triggered (a root click, or a completed drag onto it) — the
// caller (frontend) is responsible for only allowing the right trigger on
// the right kind of option. Activating means: freeze any previously-chosen
// sibling, generate a BATCH of new candidate groups via Mistral, and mark
// this option as the active one. If it's already active, this is just a
// "come back to this branch" — unfreeze its batch, no new AI call.
async function activateOption(optionId){
  const { data: option } = await supabase
    .from('options')
    .select('id, label, group_version_id, is_selected')
    .eq('id', optionId)
    .single();

  if(!option) throw new Error('Option not found.');

  const { data: version } = await supabase
    .from('group_versions')
    .select('id, group_id')
    .eq('id', option.group_version_id)
    .single();

  if(!version) throw new Error('Group version not found.');

  // Freeze any OTHER option in this same group_version that was previously
  // activated — only one sibling stays the active continuation at a time.
  const { data: siblingOptions } = await supabase
    .from('options')
    .select('id')
    .eq('group_version_id', version.id)
    .neq('id', optionId);

  for(const sibling of (siblingOptions || [])){
    await freezeOptionSubtree(sibling.id);
  }

  if(option.is_selected){
    await unfreezeOptionSubtree(optionId);
    const { data: existingGroups } = await supabase.from('groups').select('*').eq('spawned_from_option_id', optionId);
    return { groups: existingGroups || [], reactivated: true };
  }

  await supabase.from('options').update({ is_selected: true }).eq('id', optionId);

  const pathContext = await buildPathContextFromOption(optionId);
  const usedBlocks = await getUsedBlockNames(optionId);
  const assignedBlocks = pickNextBlocks(usedBlocks, 3);
  const generated = await generateCandidateBatch(pathContext, assignedBlocks);
  const blueprintId = await getBlueprintIdForGroup(version.group_id);

  // Layout: radiate the candidates outward from the source like a spider
  // web, instead of forcing them into a fixed cross shape. For each one,
  // check which compass directions around the source actually have open
  // canvas space (nothing else nearby in that direction), pick from those,
  // and add a little random angle variation so two candidates never land
  // at a perfectly mechanical 180° from each other. Only when truly no
  // direction is free does it fall back to the old "further right" approach.
  const { data: parentGroup } = await supabase
    .from('groups')
    .select('position_x, position_y')
    .eq('id', version.group_id)
    .single();

  const CARD_WIDTH_ESTIMATE = 220;
  const baseX = (parentGroup?.position_x || 0) + 320; // fallback anchor — "further right"
  const baseY = (parentGroup?.position_y || 0);

  // Need the source group's actual height (it varies with its option count)
  // to know its true footprint when checking what's nearby.
  const { count: parentOptionCount } = await supabase
    .from('options')
    .select('*', { count: 'exact', head: true })
    .eq('group_version_id', version.id);

  const HEADER_H = 40, ROW_H = 38, FOOTER_H = 40;
  const parentCardHeight = HEADER_H + (parentOptionCount || 6) * ROW_H + FOOTER_H;

  const { data: existingGroups } = await supabase
    .from('groups')
    .select('position_x, position_y')
    .eq('blueprint_id', blueprintId);

  const occupied = [...(existingGroups || [])];
  const MIN_CLEAR_X = 260; // a bit more than CARD_WIDTH
  const MIN_CLEAR_Y = 300; // a bit more than a max-height (6-option) card

  function resolveFreePosition(candidateX, candidateY){
    const overlaps = (x, y) => occupied.some(g => {
      const dx = Math.abs((g.position_x || 0) - x);
      const dy = Math.abs((g.position_y || 0) - y);
      return dx < MIN_CLEAR_X && dy < MIN_CLEAR_Y;
    });

    let x = candidateX;
    let y = candidateY;
    let attempts = 0;

    // Step RIGHTWARD on a real collision, not downward.
    while(overlaps(x, y) && attempts < 40){
      attempts++;
      x += 280;
    }

    occupied.push({ position_x: x, position_y: y }); // claim it so later siblings in this batch avoid it too
    return { x, y };
  }

  const sourceCenterX = (parentGroup?.position_x || 0) + CARD_WIDTH_ESTIMATE / 2;
  const sourceCenterY = (parentGroup?.position_y || 0) + parentCardHeight / 2;
  const RADIATE_DISTANCE = 360;
  const ASSUMED_CARD_HEIGHT = HEADER_H + 6 * ROW_H + FOOTER_H; // worst-case estimate for the screening pass below

  // 8 compass directions (degrees; 0 = right, -90 = up, 90 = down, screen
  // coordinates). "Behind" the source — whichever side has nothing nearby —
  // is exactly what this picks out.
  const compassAngles = [-90, -45, 0, 45, 90, 135, 180, -135];

  function isDirectionFree(angleDeg){
    const rad = (angleDeg * Math.PI) / 180;
    const centerX = sourceCenterX + Math.cos(rad) * RADIATE_DISTANCE;
    const centerY = sourceCenterY + Math.sin(rad) * RADIATE_DISTANCE;
    // Convert to a top-left corner before comparing — g.position_x/y are
    // ALSO top-left corners, so this has to match units or the clearance
    // check is silently off by half a card's width/height.
    const testX = centerX - CARD_WIDTH_ESTIMATE / 2;
    const testY = centerY - ASSUMED_CARD_HEIGHT / 2;
    return !occupied.some(g => {
      const dx = Math.abs((g.position_x || 0) - testX);
      const dy = Math.abs((g.position_y || 0) - testY);
      return dx < MIN_CLEAR_X && dy < MIN_CLEAR_Y;
    });
  }

  const shuffledAngles = [...compassAngles].sort(() => Math.random() - 0.5);
  const freeAngles = shuffledAngles.filter(isDirectionFree);

  const groupSpecs = (generated.groups || []).slice(0, 3);
  const newGroups = [];

  for(let i = 0; i < groupSpecs.length; i++){
    const spec = groupSpecs[i];
    const candidateOptionCount = (spec.options || []).length || 6;
    const candidateHeight = HEADER_H + candidateOptionCount * ROW_H + FOOTER_H;

    let candidateX;
    let candidateY;

    if(freeAngles.length > 0){
      const angle = freeAngles.shift() + (Math.random() - 0.5) * 10; // ±5° of natural variation
      const rad = (angle * Math.PI) / 180;
      const centerX = sourceCenterX + Math.cos(rad) * RADIATE_DISTANCE;
      const centerY = sourceCenterY + Math.sin(rad) * RADIATE_DISTANCE;
      candidateX = centerX - CARD_WIDTH_ESTIMATE / 2;
      candidateY = centerY - candidateHeight / 2;
    } else {
      // No open direction left nearby — fall back to placing further right.
      candidateX = baseX;
      candidateY = baseY;
    }

    const { x, y } = resolveFreePosition(candidateX, candidateY);

    const { data: newGroup, error: groupInsertError } = await supabase
      .from('groups')
      .insert({
        blueprint_id: blueprintId,
        label: spec.groupLabel || 'Untitled Group',
        block_name: spec.blockName || null,
        position_x: x,
        position_y: y,
        spawned_from_option_id: optionId
      })
      .select()
      .single();

    if(groupInsertError) throw groupInsertError;

    const { data: newVersion, error: versionInsertError } = await supabase
      .from('group_versions')
      .insert({ group_id: newGroup.id, version_number: 1 })
      .select()
      .single();

    if(versionInsertError) throw versionInsertError;

    const optionRows = (spec.options || []).slice(0, 6).map((o, index) => ({
      group_version_id: newVersion.id,
      label: o.label,
      position: index
    }));

    const { data: insertedOptions, error: optionsInsertError } = await supabase
      .from('options')
      .insert(optionRows)
      .select();

    if(optionsInsertError) throw optionsInsertError;

    newGroups.push({ ...newGroup, options: insertedOptions });
  }

  return { groups: newGroups, reactivated: false };
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

      const optionRows = (generated.options || []).slice(0, 6).map((o, index) => ({
        group_version_id: rootVersion.id,
        label: o.label,
        position: index
      }));

      await supabase.from('options').insert(optionRows);

      groups = [rootGroup];
    }

    const groupIds = groups.map(g => g.id);

    const { data: groupVersions } = await supabase.from('group_versions').select('*').in('group_id', groupIds);
    const versionIds = (groupVersions || []).map(v => v.id);

    const { data: allOptions } = versionIds.length
      ? await supabase.from('options').select('*').in('group_version_id', versionIds).order('position', { ascending: true })
      : { data: [] };

    res.status(200).json({
      blueprint: { id: blueprint.id, title: blueprint.title, isLocked },
      groups,
      groupVersions: groupVersions || [],
      options: allOptions || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load blueprint graph.', detail: err.message });
  }
});

// Activates an option — works identically whether it's a root click or a
// completed drag from script.js; the frontend decides which is allowed where.
app.post('/options/:id/activate', requireAuth, async (req, res) => {
  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const result = await activateOption(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not activate that option.', detail: err.message });
  }
});

// Retry — creates a NEW version of this group's options. The old version,
// and anything that grew from it, is never touched.
app.post('/groups/:id/retry', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: groupRow } = await supabase.from('groups').select('spawned_from_option_id, block_name').eq('id', req.params.id).single();
    const isRoot = !groupRow?.spawned_from_option_id;
    const pathContext = groupRow?.spawned_from_option_id
      ? await buildPathContextFromOption(groupRow.spawned_from_option_id)
      : [];
    const generated = await generateGroupOptions(pathContext, {
      isRetry: true,
      isRoot,
      blockName: groupRow?.block_name || null
    });

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

    const optionRows = (generated.options || []).slice(0, 6).map((o, index) => ({
      group_version_id: newVersion.id,
      label: o.label,
      position: index
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

    const { count: existingCount } = await supabase
      .from('options')
      .select('*', { count: 'exact', head: true })
      .eq('group_version_id', version.id);

    const { data: newOption, error: insertError } = await supabase
      .from('options')
      .insert({ group_version_id: version.id, label: label.trim(), position: existingCount || 0 })
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

    const { data: groupRow } = await supabase.from('groups').select('spawned_from_option_id').eq('id', req.params.id).single();
    const pathContext = groupRow?.spawned_from_option_id
      ? await buildPathContextFromOption(groupRow.spawned_from_option_id)
      : [];
    const chosen = await pickBestOptionWithAI(currentOptions, pathContext);
    const result = await activateOption(chosen.id);

    res.status(200).json({ ...result, chosenOption: chosen });
  } catch (err) {
    res.status(500).json({ error: 'Could not auto-activate.', detail: err.message });
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

// Removes a group — and, via the DB's own cascade constraints, everything
// that grew from it (its options, their spawned groups, all the way down).
// The root group can't be removed; that's the foundation of the blueprint.
// If this was the only thing its parent option had spawned, the parent
// option un-activates too, so it can be clicked/dragged-into again fresh.
app.delete('/groups/:id', requireAuth, async (req, res) => {
  try {
    const check = await verifyGroupOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: group } = await supabase
      .from('groups')
      .select('spawned_from_option_id')
      .eq('id', req.params.id)
      .single();

    if(!group) return res.status(404).json({ error: 'Group not found.' });
    if(!group.spawned_from_option_id){
      return res.status(400).json({ error: "Can't remove the starting group — it's the foundation of the blueprint." });
    }

    const { error: deleteError } = await supabase.from('groups').delete().eq('id', req.params.id);
    if(deleteError) throw deleteError;

    const { count } = await supabase
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('spawned_from_option_id', group.spawned_from_option_id);

    if(!count){
      await supabase.from('options').update({ is_selected: false }).eq('id', group.spawned_from_option_id);
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not remove that group.', detail: err.message });
  }
});

// ============================================================
// IDEA GENERATION — the 45-question intake, then a basic synthesis pass.
//
// This is a SCAFFOLD, not a script: each slot below is an INTENT, written
// generically enough to apply to any niche. At runtime, Mistral writes the
// actual question text and 6 options fresh, every time, shaped by which
// niche was picked on the canvas and everything answered so far — the same
// mechanism already driving the Blueprint Graph's node generation, just
// pointed at a fixed sequence of 45 intents instead of an open-ended tree.
// ============================================================
const IDEATION_SCAFFOLD = [
  // Block A — Personal Pull
  { block: 'Personal Pull', intent: 'Ask which specific corner or sub-area of this niche pulls at them most.' },
  { block: 'Personal Pull', intent: 'Ask whether their interest comes from lived experience, someone close to them, a professional background, or pure curiosity.' },
  { block: 'Personal Pull', intent: 'Ask what format or delivery style feels most natural to them for this niche (e.g. tracking, courses, coaching, passive monitoring, content, social challenges).' },
  { block: 'Personal Pull', intent: 'Ask how data-heavy or quantified they personally want the experience to feel.' },
  { block: 'Personal Pull', intent: "Ask them to imagine someone in this niche and guess what frustration hits hardest — explicitly framed as their own imagination, not a researched fact." },

  // Block B — Personal Connection to the Audience
  { block: 'Personal Connection to the Audience', intent: "Ask who they personally feel most pulled to build for, even without being able to fully explain why." },
  { block: 'Personal Connection to the Audience', intent: 'Ask whether this is a problem they have lived themselves, observed in someone close, or pure instinct.' },
  { block: 'Personal Connection to the Audience', intent: 'Ask them to guess — not research — whether the audience leans tech-savvy or tech-resistant, with an explicit "let the AI estimate" option.' },
  { block: 'Personal Connection to the Audience', intent: 'Ask them to guess a fair price point based on gut feel alone, with an explicit "let the AI estimate" option.' },
  { block: 'Personal Connection to the Audience', intent: 'Ask where THEY personally would go looking to find this audience — their own instinct/network, not market research.' },

  // Block C — Personal Read on the Pain
  { block: 'Personal Read on the Pain', intent: 'Ask them to imagine what actually breaks down when someone fails at solving this.' },
  { block: 'Personal Read on the Pain', intent: 'Ask how big this problem feels to them personally, even without hard proof.' },
  { block: 'Personal Read on the Pain', intent: "Ask their gut read on WHEN this pain hits hardest in someone's journey." },
  { block: 'Personal Read on the Pain', intent: 'Ask what they imagine people are doing right now as a workaround instead of a real fix.' },
  { block: 'Personal Read on the Pain', intent: 'Ask which single part of this problem they would fix first if they could.' },

  // Block D — Honest Awareness of What Exists
  { block: 'Honest Awareness of What Exists', intent: 'Ask what apps or tools they have personally tried or noticed in this space, with an honest "haven\'t looked yet" option.' },
  { block: 'Honest Awareness of What Exists', intent: 'Ask what bugged them most about those, framed as their own experience, not a universal claim.' },
  { block: 'Honest Awareness of What Exists', intent: 'Ask what would make their version feel like a genuine 10x, not just incrementally better.' },
  { block: 'Honest Awareness of What Exists', intent: 'Ask how much they personally care about defensibility or moat versus just shipping fast.' },
  { block: 'Honest Awareness of What Exists', intent: 'Ask what unfair advantage they personally bring, if any.' },

  // Block E — Cross-Pollination & Creative Inspiration
  { block: 'Cross-Pollination & Creative Inspiration', intent: 'Ask what feature from a completely different app, outside this niche, they wish existed here.' },
  { block: 'Cross-Pollination & Creative Inspiration', intent: 'Ask what business model from a totally different industry they would want to borrow.' },
  { block: 'Cross-Pollination & Creative Inspiration', intent: 'Ask what brand, in any industry, has the vibe they want this to have.' },
  { block: 'Cross-Pollination & Creative Inspiration', intent: 'Ask if they have personally been impressed by an app outside this niche that handled motivation or engagement well.' },
  { block: 'Cross-Pollination & Creative Inspiration', intent: 'Ask what single thing they would steal from social media for this product, with an option to avoid social patterns entirely.' },

  // Block F — Your Vision for the Experience
  { block: 'Your Vision for the Experience', intent: 'Ask what the single non-negotiable core feature is, in their vision.' },
  { block: 'Your Vision for the Experience', intent: 'Ask what tone or personality they want the product to have.' },
  { block: 'Your Vision for the Experience', intent: 'Ask how important gamification is to them.' },
  { block: 'Your Vision for the Experience', intent: 'Ask what engagement rhythm they are picturing (daily, weekly, passive, etc).' },
  { block: 'Your Vision for the Experience', intent: 'Ask how they want the product to handle setbacks or lapses.' },

  // Block G — Context, Distribution & Values
  { block: 'Context, Distribution & Values', intent: 'Ask what platform they picture this living on first (mobile, web, wearable, etc).' },
  { block: 'Context, Distribution & Values', intent: 'Ask if there is a specific region, culture, or language community they personally understand well enough to build for.' },
  { block: 'Context, Distribution & Values', intent: 'Ask where THEY personally would be able to promote or distribute this first.' },
  { block: 'Context, Distribution & Values', intent: 'Ask how they personally feel about collecting and using user data relevant to this niche.' },
  { block: 'Context, Distribution & Values', intent: 'Ask whether they want to build this solo or with collaborators.' },

  // Block H — Personal Stakes & Long-Term Vision
  { block: 'Personal Stakes & Long-Term Vision', intent: 'Ask why this specific problem matters to them personally.' },
  { block: 'Personal Stakes & Long-Term Vision', intent: 'Ask if they have tried to solve a version of this problem before.' },
  { block: 'Personal Stakes & Long-Term Vision', intent: 'Ask what would feel like genuine success to them in year one.' },
  { block: 'Personal Stakes & Long-Term Vision', intent: 'Ask their honest long-term vision (lifestyle business, venture-scale, side project, etc).' },
  { block: 'Personal Stakes & Long-Term Vision', intent: 'Ask their appetite for AI or automation being visibly present in the product itself.' },

  // Block I — What You Actually Know About Yourself
  { block: 'What You Actually Know About Yourself', intent: 'Ask what monetization shape they want for this.' },
  { block: 'What You Actually Know About Yourself', intent: 'Ask what technical skills they personally bring to building this.' },
  { block: 'What You Actually Know About Yourself', intent: 'Ask how much time they can realistically commit weekly.' },
  { block: 'What You Actually Know About Yourself', intent: 'Ask what their real budget is for tools, APIs, and launch costs.' },
  { block: 'What You Actually Know About Yourself', intent: 'Ask how fast they want to move from idea to a testable version.' }
];

// Finds the niche this blueprint is actually for — the selected option in
// the root group. Idea generation can't run without one.
async function findRootNiche(blueprintId){
  const { data: rootGroup } = await supabase
    .from('groups')
    .select('id, current_version_number')
    .eq('blueprint_id', blueprintId)
    .is('spawned_from_option_id', null)
    .maybeSingle();

  if(!rootGroup) return null;

  const { data: version } = await supabase
    .from('group_versions')
    .select('id')
    .eq('group_id', rootGroup.id)
    .eq('version_number', rootGroup.current_version_number)
    .maybeSingle();

  if(!version) return null;

  const { data: selectedOption } = await supabase
    .from('options')
    .select('label')
    .eq('group_version_id', version.id)
    .eq('is_selected', true)
    .limit(1)
    .maybeSingle();

  return selectedOption?.label || null;
}

// Writes ONE question fresh, every time — this is the "scaffold, not
// script" mechanism. Same intent slot produces a different real question
// depending on the niche and what's already been answered.
async function generateIdeationQuestion(nicheLabel, intent, answersSoFar){
  const context = answersSoFar.length === 0
    ? 'This is the first question — no prior answers yet.'
    : answersSoFar.map((a, i) => `Q${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');

  const systemPrompt = `You are writing ONE question for a guided idea-generation intake inside ThinkMaps, for someone exploring the "${nicheLabel}" niche. The question's INTENT is: ${intent} Write the actual question text — one sentence, specific to "${nicheLabel}", informed by what they've already answered — and exactly 6 short, concrete, mutually distinct answer options. The question must be answerable from the person's own knowledge, instinct, or preference — never something requiring market research they wouldn't already have. If the intent involves a guess about the market, make that explicit in the wording and include an honest "not sure — let the AI figure it out" as one of the 6 options. Respond ONLY with valid JSON: {"question": string, "options": [string, string, string, string, string, string]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `What they've answered so far:\n${context}` }
  ]);
}

// A deliberately simple first pass — one idea, not the full 5-idea/research
// pipeline. That's a bigger, separate phase; this just closes the loop so
// the 45-question intake actually leads somewhere.
async function synthesizeBasicIdea(nicheLabel, answers){
  const transcript = answers.map((a, i) => `Q${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');

  const systemPrompt = `You are the idea-synthesis engine for ThinkMaps. Based on the full intake transcript below for the "${nicheLabel}" niche, generate ONE app idea concept. Respond ONLY with valid JSON: {"name": string, "oneLiner": string, "coreProblem": string, "tenXFeature": string, "monetization": string}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: transcript }
  ]);
}

// Starts a new intake — finds the chosen niche, generates question 1, and
// creates the session row that the rest of the flow reads/writes.
app.post('/blueprints/:id/ideation/start', requireAuth, async (req, res) => {
  try {
    const blueprint = await getOwnedBlueprint(req.params.id, req.user.id);
    if(!blueprint) return res.status(404).json({ error: 'Blueprint not found.' });

    const nicheLabel = await findRootNiche(blueprint.id);
    if(!nicheLabel){
      return res.status(400).json({ error: 'Pick a niche on your canvas before generating ideas.' });
    }

    const firstQuestion = await generateIdeationQuestion(nicheLabel, IDEATION_SCAFFOLD[0].intent, []);

    const { data: session, error } = await supabase
      .from('ideation_sessions')
      .insert({
        blueprint_id: blueprint.id,
        niche_label: nicheLabel,
        answers: [],
        pending_question: firstQuestion,
        status: 'in_progress'
      })
      .select()
      .single();

    if(error) throw error;

    res.status(201).json({
      sessionId: session.id,
      nicheLabel,
      status: 'in_progress',
      progress: { current: 1, total: IDEATION_SCAFFOLD.length },
      question: firstQuestion
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not start idea generation.', detail: err.message });
  }
});

// Records the answer to whatever question is currently pending, then either
// generates the next one or — once all 45 are in — runs the basic synthesis.
app.post('/ideation/:sessionId/answer', requireAuth, async (req, res) => {
  try {
    const { selectedOption } = req.body;
    if(!selectedOption) return res.status(400).json({ error: 'selectedOption is required.' });

    const { data: session } = await supabase
      .from('ideation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(session.status === 'completed'){
      return res.status(200).json({ status: 'completed', result: session.result });
    }

    if(!session.pending_question){
      return res.status(400).json({ error: 'No question is currently pending on this session.' });
    }

    const updatedAnswers = [...session.answers, {
      question: session.pending_question.question,
      options: session.pending_question.options,
      selected: selectedOption
    }];

    if(updatedAnswers.length >= IDEATION_SCAFFOLD.length){
      const result = await synthesizeBasicIdea(session.niche_label, updatedAnswers);

      await supabase.from('ideation_sessions').update({
        answers: updatedAnswers,
        status: 'completed',
        result,
        pending_question: null
      }).eq('id', session.id);

      return res.status(200).json({
        status: 'completed',
        progress: { current: updatedAnswers.length, total: IDEATION_SCAFFOLD.length },
        result
      });
    }

    const nextSlot = IDEATION_SCAFFOLD[updatedAnswers.length];
    const nextQuestion = await generateIdeationQuestion(session.niche_label, nextSlot.intent, updatedAnswers);

    await supabase.from('ideation_sessions').update({
      answers: updatedAnswers,
      pending_question: nextQuestion
    }).eq('id', session.id);

    res.status(200).json({
      status: 'in_progress',
      nicheLabel: session.niche_label,
      progress: { current: updatedAnswers.length + 1, total: IDEATION_SCAFFOLD.length },
      question: nextQuestion
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not submit that answer.', detail: err.message });
  }
});

// Resumes a session on page reload — returns whatever's currently pending
// (or the result, if it already finished) without generating anything new.
app.get('/ideation/:sessionId', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('ideation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    res.status(200).json({
      sessionId: session.id,
      nicheLabel: session.niche_label,
      status: session.status,
      progress: {
        current: session.status === 'completed' ? session.answers.length : session.answers.length + 1,
        total: IDEATION_SCAFFOLD.length
      },
      question: session.pending_question,
      result: session.result
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load that session.', detail: err.message });
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
