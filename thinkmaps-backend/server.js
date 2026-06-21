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

// Future routes (Blueprint Graph, idea generation, Pro access) get mounted below
// as we build them out — keeping this file as the single entry point for now.

app.listen(PORT, () => {
  console.log(`ThinkMaps API running on port ${PORT}`);
});
