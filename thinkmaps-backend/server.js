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

// Future routes (Blueprint Graph, idea generation, Pro access) get mounted below
// as we build them out — keeping this file as the single entry point for now.

app.listen(PORT, () => {
  console.log(`ThinkMaps API running on port ${PORT}`);
});
