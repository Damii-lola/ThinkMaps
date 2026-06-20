import { Router } from 'express';

const router = Router();

// No auth on this route on purpose — the Supabase URL and anon key are
// meant to be public. Row Level Security (db/schema.sql) is what actually
// protects user data, not keeping these secret. This endpoint just means
// you set them once in Render and never touch the frontend again.
router.get('/', (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({
      error: 'Backend is missing SUPABASE_URL or SUPABASE_ANON_KEY — set both in Render.',
    });
  }

  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

export default router;
