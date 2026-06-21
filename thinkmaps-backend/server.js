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

// Future routes (Blueprint Graph, idea generation, Pro access) get mounted below
// as we build them out — keeping this file as the single entry point for now.

app.listen(PORT, () => {
  console.log(`ThinkMaps API running on port ${PORT}`);
});
