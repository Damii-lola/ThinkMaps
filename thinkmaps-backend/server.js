require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { NICHE_PATHWAYS } = require('./niche_pathways');

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

// Free tier locks a blueprint to read-only after this much time since
// creation, unless pro_status is set. Was 7 days, then 24 hours; now 30
// minutes. Single shared constant — both /dashboard's enrichment and
// checkIsLocked below used to each hardcode their own copy of this
// number, which is exactly the kind of duplication that causes one of
// them to quietly drift out of sync on a future change.
const FREE_TIER_LOCK_MS = 30 * 60 * 1000;

// A locked free-tier blueprint isn't just read-only forever — it's
// permanently deleted this long after creation. Deliberately a SEPARATE
// constant from the lock window above, not derived from it, since "stop
// editing" and "delete forever" are different product decisions that
// could reasonably diverge later even though they happen to both be
// fixed numbers today. Enforced lazily (see cleanupExpiredFreeBlueprints
// below), not via a scheduled job — there's no cron/job-runner
// infrastructure in this app, and a lazy sweep on dashboard load is
// simple, requires no new infrastructure, and the actual deletion is
// not so time-sensitive that "approximately on next dashboard visit" is
// distinguishable from "exactly at 3 days" to a real person.
const FREE_TIER_DELETE_MS = 3 * 24 * 60 * 60 * 1000;

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
    timestamp: new Date().toISOString(),
    // Bump this string whenever a real backend fix ships, specifically so
    // it's possible to check — by just visiting /health in a browser —
    // whether Render is actually running the latest server.js, rather than
    // guessing from symptoms alone whether something is a fresh bug or a
    // deploy that never happened. Last bumped: cross-fork diversity
    // injection for canvas option generation (no more repeating "Personal
    // Pull" content across unrelated branches of the same niche) +
    // monetization removed from confirmation questions.
    deployedFixes: 'cross-fork-diversity-injection-2026-06-24'
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

// ---------- OTP AUTH ----------
// Generates a 6-digit code, stores it in otp_codes with a 10-minute
// expiry, then sends it via otp.dev's email API. The OTP entry screen
// lives on our own page (not otp.dev's hosted flow) — otp.dev is used
// purely as an email delivery transport.
//
// Rate limiting is minimal here (one row-delete per send cleans up the
// old code, and the Supabase row insert is naturally rate-limited by the
// DB itself). A real production deployment should add IP-level rate
// limiting on top of this.

async function sendOtpEmail(email, code, purpose){
  const subject = purpose === 'signup'
    ? 'Confirm your ThinkMaps account'
    : 'Your ThinkMaps sign-in code';

  const body = purpose === 'signup'
    ? `Welcome to ThinkMaps!\n\nYour verification code is:\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request this, you can ignore it.`
    : `Your ThinkMaps sign-in code is:\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request this, someone may have tried to sign in to your account.`;

  // otp.dev email delivery — set OTP_DEV_API_KEY in your Render env vars.
  // The API key goes in the X-OTP-Key header. Channel is 'email'.
  // Documentation: https://otp.dev/en/docs/
  const otpRes = await fetch('https://api.otp.dev/v1/verifications', {
    method: 'POST',
    headers: {
      'X-OTP-Key': process.env.OTP_DEV_API_KEY,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({
      data: {
        channel: 'email',
        email,
        subject,
        body,
        // Provide the code ourselves so otp.dev sends exactly the code
        // we already stored in our DB, rather than generating its own.
        // If otp.dev doesn't support a custom code field, we generate
        // the code, send a plain email via their API, and verify locally.
        code_length: 6
      }
    })
  });

  if(!otpRes.ok){
    const errBody = await otpRes.text();
    throw new Error(`OTP delivery failed (${otpRes.status}): ${errBody}`);
  }

  return await otpRes.json();
}

// Generates and sends an OTP. Purpose is 'signup' or 'login'.
// For signup: verifies the email doesn't already have an account first.
// For login: verifies the email HAS an account first.
app.post('/auth/send-otp', async (req, res) => {
  const { email, purpose } = req.body;
  if(!email || !purpose) return res.status(400).json({ error: 'email and purpose are required.' });
  if(!['signup', 'login'].includes(purpose)) return res.status(400).json({ error: 'purpose must be signup or login.' });

  try {
    // For login: confirm account exists (so we don't silently send nothing)
    if(purpose === 'login'){
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();
      if(!profile) return res.status(404).json({ error: 'No account found for that email.' });
    }

    // For signup: confirm email isn't already taken
    if(purpose === 'signup'){
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();
      if(existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    // Delete any existing code for this email+purpose (idempotent resend)
    await supabase.from('otp_codes').delete().eq('email', email).eq('purpose', purpose);

    // Generate a 6-digit numeric code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    await supabase.from('otp_codes').insert({
      email,
      purpose,
      code,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    });

    // Send via otp.dev
    try {
      await sendOtpEmail(email, code, purpose);
    } catch (emailErr) {
      console.error('[ThinkMaps] OTP email delivery failed:', emailErr.message);
      // Clean up the stored code so it's not orphaned
      await supabase.from('otp_codes').delete().eq('email', email).eq('purpose', purpose);
      return res.status(500).json({ error: 'Could not send the verification code. Try again in a moment.' });
    }

    res.status(200).json({ sent: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not send the OTP.', detail: err.message });
  }
});

// Verifies the OTP for signup, then creates the Supabase account.
app.post('/auth/verify-otp-signup', async (req, res) => {
  const { email, username, password, code } = req.body;
  if(!email || !username || !password || !code){
    return res.status(400).json({ error: 'email, username, password, and code are required.' });
  }

  try {
    const { data: otpRow } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('purpose', 'signup')
      .single();

    if(!otpRow) return res.status(400).json({ error: 'No pending verification for that email. Request a new code.' });
    if(new Date(otpRow.expires_at) < new Date()) return res.status(400).json({ error: 'That code has expired. Request a new one.' });
    if(otpRow.code !== code.trim()) return res.status(400).json({ error: 'Incorrect code. Check your email and try again.' });

    // Code is valid — delete it immediately so it can't be reused
    await supabase.from('otp_codes').delete().eq('id', otpRow.id);

    // Create the Supabase Auth account (email confirmation disabled in
    // Supabase dashboard settings — OTP above is our confirmation step).
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { username },
      email_confirm: true // mark as already confirmed
    });

    if(authError){
      if(/duplicate|unique|already/i.test(authError.message)){
        return res.status(409).json({ error: 'An account with that email or username already exists.' });
      }
      throw authError;
    }

    // Sign the user straight in so they land on the dashboard immediately
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if(signInError) throw signInError;

    res.status(200).json({
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at: signInData.session.expires_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not create your account.', detail: err.message });
  }
});

// Verifies the OTP for login, then signs the user in via Supabase.
// We verify the OTP ourselves (DB lookup), then use the admin API to
// create a session — this way we don't need to store/pass the password
// through the OTP verification step.
app.post('/auth/verify-otp-login', async (req, res) => {
  const { email, password, code } = req.body;
  if(!email || !password || !code){
    return res.status(400).json({ error: 'email, password, and code are required.' });
  }

  try {
    const { data: otpRow } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('email', email)
      .eq('purpose', 'login')
      .single();

    if(!otpRow) return res.status(400).json({ error: 'No pending verification for that email. Request a new code.' });
    if(new Date(otpRow.expires_at) < new Date()) return res.status(400).json({ error: 'That code has expired. Request a new one.' });
    if(otpRow.code !== code.trim()) return res.status(400).json({ error: 'Incorrect code. Check your email and try again.' });

    // Code valid — delete it, then sign in with Supabase to verify password too
    await supabase.from('otp_codes').delete().eq('id', otpRow.id);

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if(signInError){
      if(/invalid.*credentials/i.test(signInError.message)){
        return res.status(401).json({ error: 'Incorrect password.' });
      }
      throw signInError;
    }

    res.status(200).json({
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at: signInData.session.expires_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not sign you in.', detail: err.message });
  }
});

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

    // Lazy cleanup, right before listing — deletes any of this user's
    // free-tier blueprints that aged past FREE_TIER_DELETE_MS. A no-op
    // for pro users (checked once inside, not per blueprint). See the
    // comment on cleanupExpiredFreeBlueprints above for why "on
    // dashboard load" rather than a scheduled job is the right call here.
    await cleanupExpiredFreeBlueprints(userId);

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

    const now = Date.now();

    const enrichedBlueprints = blueprints.map(bp => {
      const ageMs = now - new Date(bp.created_at).getTime();
      const isLocked = !profile.pro_status && ageMs > FREE_TIER_LOCK_MS;
      // Minutes, not hours — at a 30-minute window, "hours remaining"
      // would round to a misleading 0 or 1 for nearly this entire
      // window, which is exactly the kind of unit choice that LOOKS
      // fine until the actual numbers involved make it useless.
      const minutesRemaining = Math.max(0, Math.ceil((FREE_TIER_LOCK_MS - ageMs) / (60 * 1000)));
      // Separately: how long until this blueprint is permanently
      // deleted, regardless of whether it's already locked — locking and
      // deleting are different moments on the free tier (see
      // FREE_TIER_DELETE_MS above), so this is its own field, not
      // derived from isLocked/minutesRemaining.
      const daysUntilDeletion = profile.pro_status
        ? null
        : Math.max(0, Math.ceil((FREE_TIER_DELETE_MS - ageMs) / (24 * 60 * 60 * 1000)));
      return { ...bp, isLocked, minutesRemaining: isLocked ? 0 : minutesRemaining, daysUntilDeletion };
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

// Lightweight pro-status check for pages that need to gate UI elements
// but don't need the full /dashboard payload (blueprint list, etc.) —
// confirm.html uses this to decide whether to show the post-hardening
// tools as locked or active, without pulling in data it has no use for.
app.get('/profile', requireAuth, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('pro_status')
      .eq('id', req.user.id)
      .single();

    if(error) throw error;

    res.status(200).json({ pro_status: !!profile?.pro_status });
  } catch (err) {
    res.status(500).json({ error: 'Could not load profile.', detail: err.message });
  }
});

// =====================================================================
// TEST-MODE ONLY — TOGGLES pro_status directly with NO real payment of
// any kind. Clicking "Go Pro" while already pro flips back to free, so
// the same button/flow can be used to test both directions without a
// separate downgrade path. This exists purely so the Pro experience can
// be built and tested end-to-end before a real payment provider (Selar,
// per the placeholder link on the dashboard) is wired in. Any
// authenticated user can currently toggle themselves Pro for free by
// hitting this endpoint — that is fine for development, and would be a
// genuine, serious revenue hole if this ever reached a real production
// deployment unguarded. Before this app handles real money, this route
// needs to either be deleted entirely or rebuilt so pro_status only ever
// turns on from a verified payment-provider webhook (and only ever turns
// off from actual cancellation/non-renewal logic), never from a direct
// toggle a client can call at will.
// =====================================================================
app.post('/profile/go-pro', requireAuth, async (req, res) => {
  try {
    const pro = await isUserPro(req.user.id);
    const next = !pro;

    const { error } = await supabase
      .from('profiles')
      .update({ pro_status: next })
      .eq('id', req.user.id);

    if(error) throw error;

    res.status(200).json({ pro_status: next });
  } catch (err) {
    res.status(500).json({ error: 'Could not update Pro status.', detail: err.message });
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

// Renames a blueprint. Allowed even when the blueprint is locked on the
// free tier — same precedent as dragging/repositioning a group: relabeling
// what's already there isn't "editing the idea," so there's no lock check
// here, just ownership.
app.patch('/blueprints/:id', requireAuth, async (req, res) => {
  try {
    const blueprint = await getOwnedBlueprint(req.params.id, req.user.id);
    if (!blueprint) return res.status(404).json({ error: 'Blueprint not found.' });

    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }

    const { data: updated, error } = await supabase
      .from('blueprints')
      .update({ title: title.trim() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({ blueprint: updated });
  } catch (err) {
    res.status(500).json({ error: 'Could not rename blueprint.', detail: err.message });
  }
});

// ============================================================
// MISTRAL — the node-generation engine for the Blueprint Graph.
// ============================================================
async function callMistral(messages, maxTokens = 350){
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: 'mistral-small-2503',
      messages,
      response_format: { type: 'json_object' },
      // Hard cap on output tokens — every canvas generation call produces
      // a bounded, predictable amount of JSON. The old default of 1400
      // was drastically over-provisioned: 3 blocks × 6 options × 7 words
      // = ~130 words, ~180 tokens needed. 350 is comfortable headroom.
      // The model incurs latency proportional to actual tokens generated,
      // so eliminating ~1050 unused reserved tokens cuts generation time
      // significantly on every single canvas click. Call sites that
      // genuinely need more (build brief with 8 detailed MVP paragraphs,
      // final idea synthesis, confirmation questions) pass their own
      // higher override — this default only needs to fit canvas options.
      max_tokens: maxTokens
    })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if(!content) throw new Error('Mistral returned no content.');

  // Defensive: models occasionally wrap "pure JSON" in ```json fences or add
  // stray text around it even when told not to. Strip fences, then clip to
  // the outermost {...} before parsing, instead of trusting it's clean.
  let cleaned = content.trim();
  if(cleaned.startsWith('```')){
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if(firstBrace !== -1 && lastBrace > firstBrace){
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`Mistral returned invalid JSON (${parseErr.message}). Raw: ${content.slice(0, 200)}`);
  }
}

// The streaming variant — calls Mistral with stream:true and fires
// onToken(text) for every delta so the SSE route can forward tokens to
// the browser as they arrive, making the first content visible at
// ~1-2 seconds instead of ~10-15 seconds. Returns the same fully-parsed
// JSON object callMistral does, so all downstream code stays identical.
// When onToken is null, falls back to the non-streaming callMistral.
async function callMistralWithStreaming(messages, maxTokens = 350, onToken = null){
  if(!onToken) return callMistral(messages, maxTokens);

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: 'mistral-small-2503',
      messages,
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      stream: true
    })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${errText}`);
  }

  let accumulated = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while(true){
    const { done, value } = await reader.read();
    if(done) break;

    const chunk = decoder.decode(value, { stream: true });
    for(const line of chunk.split('\n')){
      if(!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if(raw === '[DONE]') break;
      try {
        const parsed = JSON.parse(raw);
        const delta = parsed.choices?.[0]?.delta?.content;
        if(delta){
          accumulated += delta;
          try { onToken(delta); } catch(e){ /* don't let a broken SSE write kill the whole call */ }
        }
      } catch (e){ /* malformed chunk — skip */ }
    }
  }

  // Same cleanup / parse the non-streaming path does
  let cleaned = accumulated.trim();
  if(cleaned.startsWith('```')){
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if(firstBrace !== -1 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`Mistral streaming returned invalid JSON (${parseErr.message}). Raw: ${accumulated.slice(0, 200)}`);
  }
}

async function callMistralPlainText(messages){
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({ model: 'mistral-small-2503', messages, max_tokens: 700 })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

// Calls Mistral in streaming mode and accumulates all the SSE delta
// chunks into a single string, which it returns to the caller exactly
// like callMistral does (same JSON parsing/cleanup). The response_format
// json_object constraint still applies — streaming just delivers the
// same JSON one token at a time instead of all at once. This is used
// by the activate route specifically so it can forward partial text to
// the client via SSE (see callMistralStreamingToClient below) while
// still needing the fully assembled result for DB writes.
async function callMistralStreaming(messages, maxTokens = 350){
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
    },
    body: JSON.stringify({
      model: 'mistral-small-2503',
      messages,
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      stream: true
    })
  });

  if(!res.ok){
    const errText = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${errText}`);
  }

  // Accumulate the streamed SSE deltas into one string
  let accumulated = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while(true){
    const { done, value } = await reader.read();
    if(done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for(const line of lines){
      if(!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if(data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if(delta) accumulated += delta;
      } catch (e) {
        // malformed SSE chunk — skip it
      }
    }
  }

  // Same cleanup/parse as callMistral
  let cleaned = accumulated.trim();
  if(cleaned.startsWith('```')){
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if(firstBrace !== -1 && lastBrace > firstBrace){
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`Mistral streaming returned invalid JSON (${parseErr.message}). Raw: ${accumulated.slice(0, 200)}`);
  }
}

// Walks UP the tree from a group to the root, collecting {groupLabel, optionLabel}
// pairs — this is the "path so far" context fed into every generation prompt.
// Walks UP the tree from an OPTION to the root, via spawned_from_option_id —
// this is the "path so far" context fed into every generation prompt.
// Fetches an ENTIRE blueprint's groups/group_versions/options ONCE (3
// necessarily-sequential queries — each needs the previous step's ids —
// but each step is itself a single flat query, not one-per-tree-level),
// with lookup Maps pre-built so every consumer below does pure O(1)
// in-memory lookups afterward.
//
// This exists because activateOption — the function that runs on
// literally every single node click — used to call THREE SEPARATE
// ancestor-walking functions (buildPathContextFromOption,
// getUsedBlockNamesAlongPath, findNicheRootOptionId), each independently
// walking the SAME ancestor chain one tree level at a time, each level
// costing 3-4 sequential Supabase round trips. At the 7-level depth cap,
// that's potentially 60-70+ sequential network round trips for ONE
// click, before the AI generation call even starts. Fetching the whole
// blueprint flat ONCE and walking it in memory afterward turns all of
// that into 3 round trips total, full stop, regardless of path depth —
// this was already proven out for getAllExistingOptionLabelsInNiche
// elsewhere in this file; this generalizes the same pattern so every
// other ancestor-walking function in the hot path can share ONE fetch
// instead of each quietly re-paying for its own.
async function fetchBlueprintSnapshot(blueprintId){
  const { data: groups } = await supabase
    .from('groups')
    .select('id, label, block_name, spawned_from_option_id, blueprint_id')
    .eq('blueprint_id', blueprintId);

  const groupIds = (groups || []).map(g => g.id);
  const { data: groupVersions } = groupIds.length
    ? await supabase.from('group_versions').select('id, group_id').in('group_id', groupIds)
    : { data: [] };

  const versionIds = (groupVersions || []).map(v => v.id);
  const { data: options } = versionIds.length
    ? await supabase.from('options').select('id, label, group_version_id').in('group_version_id', versionIds)
    : { data: [] };

  const optionsById = new Map((options || []).map(o => [o.id, o]));
  const groupVersionsById = new Map((groupVersions || []).map(v => [v.id, v]));
  const groupsById = new Map((groups || []).map(g => [g.id, g]));

  const groupsBySpawnedFrom = new Map();
  (groups || []).forEach(g => {
    if(!g.spawned_from_option_id) return;
    if(!groupsBySpawnedFrom.has(g.spawned_from_option_id)) groupsBySpawnedFrom.set(g.spawned_from_option_id, []);
    groupsBySpawnedFrom.get(g.spawned_from_option_id).push(g);
  });
  const versionsByGroupId = new Map();
  (groupVersions || []).forEach(v => {
    if(!versionsByGroupId.has(v.group_id)) versionsByGroupId.set(v.group_id, []);
    versionsByGroupId.get(v.group_id).push(v);
  });
  const optionsByVersionId = new Map();
  (options || []).forEach(o => {
    if(!optionsByVersionId.has(o.group_version_id)) optionsByVersionId.set(o.group_version_id, []);
    optionsByVersionId.get(o.group_version_id).push(o);
  });

  return {
    groups: groups || [], groupVersions: groupVersions || [], options: options || [],
    optionsById, groupVersionsById, groupsById,
    groupsBySpawnedFrom, versionsByGroupId, optionsByVersionId
  };
}

// In-memory replacement for buildPathContextFromOption below — identical
// output, walking the pre-fetched snapshot instead of issuing a fresh
// 3-query round trip at every level of the ancestor chain.
function walkPathContextFromSnapshot(optionId, snapshot){
  const path = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const option = snapshot.optionsById.get(currentOptionId);
    if(!option) break;
    const version = snapshot.groupVersionsById.get(option.group_version_id);
    if(!version) break;
    const group = snapshot.groupsById.get(version.group_id);
    if(!group) break;

    path.unshift({ groupLabel: group.label, optionLabel: option.label });
    currentOptionId = group.spawned_from_option_id || null;
  }

  return path;
}

// In-memory replacement for getUsedBlockNamesAlongPath below.
function walkUsedBlockNamesFromSnapshot(optionId, snapshot){
  const usedBlocks = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const option = snapshot.optionsById.get(currentOptionId);
    if(!option) break;
    const version = snapshot.groupVersionsById.get(option.group_version_id);
    if(!version) break;
    const group = snapshot.groupsById.get(version.group_id);
    if(!group) break;

    if(group.spawned_from_option_id){
      const batchGroups = snapshot.groupsBySpawnedFrom.get(group.spawned_from_option_id) || [];
      batchGroups.forEach(g => { if(g.block_name) usedBlocks.push(g.block_name); });
    }

    currentOptionId = group.spawned_from_option_id || null;
  }

  return usedBlocks;
}

// In-memory replacement for findNicheRootOptionId below.
function walkNicheRootOptionIdFromSnapshot(optionId, snapshot){
  let currentOptionId = optionId;

  while(true){
    const option = snapshot.optionsById.get(currentOptionId);
    if(!option) return currentOptionId;
    const version = snapshot.groupVersionsById.get(option.group_version_id);
    if(!version) return currentOptionId;
    const group = snapshot.groupsById.get(version.group_id);
    if(!group) return currentOptionId;
    if(!group.spawned_from_option_id) return currentOptionId;
    currentOptionId = group.spawned_from_option_id;
  }
}

// In-memory replacement for getOptionGroupLabelPair below.
function lookupOptionGroupLabelPairFromSnapshot(optionId, snapshot){
  const option = snapshot.optionsById.get(optionId);
  if(!option) return null;
  const version = snapshot.groupVersionsById.get(option.group_version_id);
  if(!version) return null;
  const group = snapshot.groupsById.get(version.group_id);
  if(!group) return null;
  return { groupLabel: group.label, optionLabel: option.label };
}

// In-memory replacement for the BFS in getAllExistingOptionLabelsInNiche
// below — same traversal, same recency cap, against the shared snapshot
// instead of a separately, redundantly fetched copy of the same data.
function walkExistingOptionLabelsFromSnapshot(nicheOptionId, snapshot){
  const labels = [];
  let frontierOptionIds = [nicheOptionId];

  while(frontierOptionIds.length > 0){
    const nextFrontier = [];
    for(const optId of frontierOptionIds){
      const childGroups = snapshot.groupsBySpawnedFrom.get(optId) || [];
      for(const group of childGroups){
        const childVersions = snapshot.versionsByGroupId.get(group.id) || [];
        for(const version of childVersions){
          const childOptions = snapshot.optionsByVersionId.get(version.id) || [];
          for(const opt of childOptions){
            if(opt.label) labels.push(opt.label);
            nextFrontier.push(opt.id);
          }
        }
      }
    }
    frontierOptionIds = nextFrontier;
  }

  return labels.slice(-60); // same cap as getAllExistingOptionLabelsInNiche below
}

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

// One-level lookup for a single option's own {groupLabel, optionLabel} —
// used only for the OTHER members of a combined activation, which share
// the primary's exact parent already (enforced by validateCombinationSet)
// and so never need a full ancestor walk of their own.
async function getOptionGroupLabelPair(optionId){
  const { data: option } = await supabase.from('options').select('label, group_version_id').eq('id', optionId).single();
  if(!option) return null;
  const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
  if(!version) return null;
  const { data: group } = await supabase.from('groups').select('label').eq('id', version.group_id).single();
  if(!group) return null;
  return { groupLabel: group.label, optionLabel: option.label };
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

// Once a niche's exploration has used all 6 of these — its pull toward
// the space, who it's for, the pain, what's already out there, its
// creative angle, and its vision for the experience — there's enough on
// the table to actually synthesize a specific idea, not just gather more
// context about the person. THE_IDEA_CHECKPOINT_BLOCK_NAME marks the
// one-time pause that happens right there, before moving on to block 7
// ("Context, Distribution & Values"). It's tracked via the exact same
// block_name column the 9 canonical blocks use, just with a sentinel
// value that deliberately isn't one of the 9 — so it never interferes
// with pickNextBlocks' own filtering, and (like the 9) is scoped per
// niche subtree, so it fires exactly once per niche, not once per
// blueprint.
const IDEA_CHECKPOINT_BLOCK_NAME = 'The Idea Taking Shape';
const BLOCKS_BEFORE_IDEA_CHECKPOINT = IDEATION_BLOCK_NAMES.slice(0, 6);

// Hard cap on path depth — see GENERATE_IDEAS_BLOCK_NAME below for what
// happens once a single continuous path reaches this many picks deep.
const PATH_DEPTH_CAP = 7;
const GENERATE_IDEAS_BLOCK_NAME = 'Ready to Generate Ideas';

// A group of this block_name never gets AI-generated content — it's a
// blank slate the person fills in themselves via the existing
// /groups/:id/custom-option route, spawned by the new post-selection
// "+Custom" action (see /options/:id/custom-spawned-group below). Like
// the other two sentinels above, this never collides with the 9 real
// blocks since pickNextBlocks only ever filters against those by name.
const CUSTOM_IDEA_BLOCK_NAME = 'Your Own Idea';

// Every block_name "used" for the purpose of deciding what to assign
// NEXT, scoped to ONE continuous path: every ancestor of optionId, PLUS
// every SIBLING generated in the same batch as each ancestor (siblings
// share a spawned_from_option_id with the ancestor but weren't
// necessarily the one actually clicked into). Siblings have to count —
// they were assigned together in one Mistral call specifically so they'd
// never collide with each other, so anything continuing through any ONE
// of them needs to know the OTHERS in that same batch are already spoken
// for too.
//
// Critically, this does NOT look at unrelated cousin branches — a
// completely different fork that split off elsewhere in the same niche
// (e.g. continuing through "Personal Connection" after having earlier
// explored a few levels down "Personal Pull") gets its own fully
// independent pool. This replaces an earlier version that scoped "already
// used" to the WHOLE niche subtree regardless of which fork you were on:
// that correctly stopped siblings from colliding, but meant exploring
// more than a couple of forks in the same niche drained the shared pool
// of 9 fast and forced premature wraparound — reissuing "Personal Pull"
// with fresh content deep down an UNRELATED branch, which is exactly the
// repetition still visible several levels into a real exploration.
async function getUsedBlockNamesAlongPath(optionId){
  const usedBlocks = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const { data: option } = await supabase.from('options').select('id, group_version_id').eq('id', currentOptionId).single();
    if(!option) break;

    const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
    if(!version) break;

    const { data: group } = await supabase.from('groups').select('spawned_from_option_id').eq('id', version.group_id).single();
    if(!group) break;

    if(group.spawned_from_option_id){
      const { data: batchGroups } = await supabase
        .from('groups')
        .select('block_name')
        .eq('spawned_from_option_id', group.spawned_from_option_id);
      (batchGroups || []).forEach(g => { if(g.block_name) usedBlocks.push(g.block_name); });
    }

    currentOptionId = group.spawned_from_option_id || null;
  }

  return usedBlocks;
}

// Picks the next N blocks not yet used along THIS path — so a single
// exploration marches through all 9 without repeats. If a path goes deep
// enough to exhaust all 9, it cycles back from the start rather than
// breaking — but the wraparound portion explicitly excludes whatever's
// already in `remaining`, so a single returned batch of 3 can never
// contain the same block name twice (the original version of this could,
// in the narrow case where almost all 9 were already used: e.g. only
// "Personal Pull" left unused with needed=2 would have returned
// ["Personal Pull", "Personal Pull", "Personal Connection..."] without
// this guard).
function pickNextBlocks(usedBlocks, count){
  const remaining = IDEATION_BLOCK_NAMES.filter(b => !usedBlocks.includes(b));
  if(remaining.length >= count) return remaining.slice(0, count);
  const needed = count - remaining.length;
  const wraparound = IDEATION_BLOCK_NAMES.filter(b => !remaining.includes(b)).slice(0, needed);
  return [...remaining, ...wraparound];
}

// Finds the option, living directly inside the ROOT "Niches" group, that
// this option's ancestor chain traces back to — i.e. which niche was
// picked to start this whole exploration thread.
//
// This existed before under a different job (scoping "which blocks are
// already used") and was removed when that got correctly rescoped to
// per-path instead (see getUsedBlockNamesAlongPath) — exploring multiple
// forks of one niche was draining a shared block-name pool too fast.
// It's back now for a DIFFERENT, deliberately OPPOSITE-scoped purpose:
// finding what option TEXT already exists for a given block ANYWHERE in
// the niche, not just along one path. Per-path scoping is exactly wrong
// for this — it would never catch the content-level repetition that
// shows up ACROSS forks: a dozen unrelated "Personal Pull" cards on
// different branches of the same niche, each generated in isolation,
// converging on near-identical phrasing because a narrow niche only has
// so much genuinely different territory to cover for that one block.
async function findNicheRootOptionId(optionId){
  let currentOptionId = optionId;

  while(true){
    const { data: option } = await supabase.from('options').select('id, group_version_id').eq('id', currentOptionId).single();
    if(!option) return currentOptionId;

    const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
    if(!version) return currentOptionId;

    const { data: group } = await supabase.from('groups').select('spawned_from_option_id').eq('id', version.group_id).single();
    if(!group) return currentOptionId;

    if(!group.spawned_from_option_id) return currentOptionId;
    currentOptionId = group.spawned_from_option_id;
  }
}

// Walks the ENTIRE niche subtree (every group descended from
// nicheOptionId, at any depth, through any fork) and collects every
// option LABEL anywhere in it, REGARDLESS of block_name.
//
// This used to filter by a single matching block_name — catching
// "Personal Pull repeating Personal Pull elsewhere," but structurally
// blind to "Personal Pull and Personal Connection both converging on the
// same 'meeting mute' phrasing," which is exactly what kept showing up:
// once a niche gets specific enough (office workers, interrupted by
// meetings, wanting micro-workouts), that one same idea is the most
// obvious answer for EVERY block, not just one, and a per-block filter
// only ever compared a block against itself. Capped at the most recent
// 40 found (roughly double the old per-block cap, since this is now
// pooling across every block instead of just one).
async function getAllExistingOptionLabelsInNiche(nicheOptionId){
  // First find which blueprint this niche option belongs to, since
  // everything below is scoped to fetching that ONE blueprint's full
  // contents in flat queries rather than walking the tree level by level.
  const { data: nicheOptionRow } = await supabase
    .from('options')
    .select('group_version_id')
    .eq('id', nicheOptionId)
    .single();
  if(!nicheOptionRow) return [];

  const { data: nicheVersionRow } = await supabase
    .from('group_versions')
    .select('group_id')
    .eq('id', nicheOptionRow.group_version_id)
    .single();
  if(!nicheVersionRow) return [];

  const blueprintId = await getBlueprintIdForGroup(nicheVersionRow.group_id);
  if(!blueprintId) return [];

  // Exactly 3 queries total, regardless of how deep or wide the
  // exploration has gone — this is the actual fix. The old version did
  // this same fetch ONE LEVEL AT A TIME (groups, then versions, then
  // options, per level), which meant a path 7 levels deep with several
  // siblings per level could mean dozens of sequential round-trips, paid
  // fresh on every single node activation. Fetching the whole
  // blueprint's contents flat and walking the tree in memory below does
  // the identical BFS, just against data that's already local instead of
  // re-querying the database at every step.
  const { data: allGroups } = await supabase.from('groups').select('id, spawned_from_option_id').eq('blueprint_id', blueprintId);
  const groupIds = (allGroups || []).map(g => g.id);
  const { data: allVersions } = groupIds.length
    ? await supabase.from('group_versions').select('id, group_id').in('group_id', groupIds)
    : { data: [] };
  const versionIds = (allVersions || []).map(v => v.id);
  const { data: allOptions } = versionIds.length
    ? await supabase.from('options').select('id, label, group_version_id').in('group_version_id', versionIds)
    : { data: [] };

  // Same BFS as before, just walking pre-fetched in-memory arrays
  // instead of issuing a fresh query at every level.
  const groupsBySpawnedFrom = new Map();
  (allGroups || []).forEach(g => {
    if(!g.spawned_from_option_id) return;
    if(!groupsBySpawnedFrom.has(g.spawned_from_option_id)) groupsBySpawnedFrom.set(g.spawned_from_option_id, []);
    groupsBySpawnedFrom.get(g.spawned_from_option_id).push(g.id);
  });
  const versionsByGroupId = new Map();
  (allVersions || []).forEach(v => {
    if(!versionsByGroupId.has(v.group_id)) versionsByGroupId.set(v.group_id, []);
    versionsByGroupId.get(v.group_id).push(v.id);
  });
  const optionsByVersionId = new Map();
  (allOptions || []).forEach(o => {
    if(!optionsByVersionId.has(o.group_version_id)) optionsByVersionId.set(o.group_version_id, []);
    optionsByVersionId.get(o.group_version_id).push(o);
  });

  const labels = [];
  let frontierOptionIds = [nicheOptionId];

  while(frontierOptionIds.length > 0){
    const nextFrontier = [];
    for(const optId of frontierOptionIds){
      const childGroupIds = groupsBySpawnedFrom.get(optId) || [];
      for(const groupId of childGroupIds){
        const childVersionIds = versionsByGroupId.get(groupId) || [];
        for(const versionId of childVersionIds){
          const childOptions = optionsByVersionId.get(versionId) || [];
          for(const opt of childOptions){
            if(opt.label) labels.push(opt.label);
            nextFrontier.push(opt.id);
          }
        }
      }
    }
    frontierOptionIds = nextFrontier;
  }

  // Capped at 60 rather than 150 — still a substantial diversity window
  // (most-recent-first, same recency bias as before), but a meaningful
  // cut to every generation prompt's size. 150 was tuned purely for
  // correctness on very deep paths; 60 is the practical tradeoff between
  // that and actually fast generation.
  return labels.slice(-60);
}

// Fetches a niche's full pathway topic list purely as background
// grounding for the generation prompts below — these topics are NEVER
// shown to the person directly and never spawn as their own clickable
// group. The idea: someone using this tool typically doesn't know yet
// which specific angle they want, which is exactly why the app asks them
// guided questions instead of handing them a raw list to browse — but
// the model answering those questions can still benefit from seeing the
// concrete vocabulary of this niche (e.g. "Calisthenics for all ages,"
// "Calories tracking") to ground its own generated options in something
// specific, rather than staying generic. The niche option's own label is
// whatever the AI freely generated for the root "Niches" group, not
// guaranteed to match one of the 45 canonical names exactly, so this
// reuses the same exact/alias/AI-fallback matching matchNicheToTemplate
// already does for the older 45-question flow.
async function getNicheTopicsForGrounding(nicheOptionId){
  const { data: nicheOption } = await supabase.from('options').select('label').eq('id', nicheOptionId).single();
  if(!nicheOption) return [];
  const match = await matchNicheToTemplate(nicheOption.label);
  const allTopics = match.key ? (NICHE_PATHWAYS[match.key] || []) : [];

  // Sampled down to 40 per call rather than injecting the full 150 every
  // time — full topic list stays AVAILABLE across the niche overall (a
  // freshly randomized 40 each call still surfaces different material
  // over repeated activations, not the literal same 40 forever), but
  // this cuts roughly two-thirds of what was previously the single
  // largest contributor to every generation prompt's size.
  if(allTopics.length <= 40) return allTopics;
  const shuffled = [...allTopics].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 40);
}


// Shared instruction injected into every option-generating prompt — keeps
// each option short (fits a line or two) instead of one long run-on
// sentence. A naturally big/complex idea gets split into several short
// options rather than crammed into one.
const SHORT_OPTION_RULE = ' Keep every option SHORT — about 4 to 7 words, never a full sentence. If one underlying idea is naturally big or has multiple parts, split it into two or three separate short options instead of writing one long one.';

async function generateGroupOptions(pathContext, { isRetry = false, isRoot = false, blockName = null, existingLabels = [] } = {}){
  const pathDescription = pathContext.length === 0
    ? 'This is the very start of the blueprint — no path chosen yet.'
    : pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ');

  const instructions = isRoot
    ? 'Generate the starting "Niches" group for a new app-idea Blueprint Graph: up to 6 high-quality, distinct app niches (e.g. Fitness, Finance & Commerce, Productivity, Entertainment).'
    : `The path below is a SPECIFIC, REAL sequence of choices this exact person has made — not a generic example. Based on THAT exact path, generate up to 6 specific, concrete options for the "${blockName}" block, each one reading as a personalized continuation of what they've already chosen — reference or clearly connect to those prior choices, don't write options that could apply to any random blueprint. Every option must fit squarely within that block's territory and must be something the person could answer from their own knowledge, instinct, or preference, never something requiring market research they don't have. While generating, privately consider how the choices in this path could combine into a genuinely useful, monetizable app idea — let that sense of direction inform your phrasing, even though you're not asked to state the idea itself yet.`;

  const retryNote = isRetry
    ? ' Give a genuinely different, fresh set of alternatives than what would typically come first — avoid repeating obvious options, but stay within the same block.'
    : '';

  // Catches repetition across EVERY block in this niche, not just this
  // one — see getAllExistingOptionLabelsInNiche above for why a per-block
  // filter wasn't enough (the actual repeats were happening ACROSS
  // different blocks converging on the same idea, e.g. "meeting mute"
  // showing up near-identically in both Personal Pull and Personal
  // Connection elsewhere in this same niche).
  const diversityNote = (!isRoot && existingLabels.length > 0)
    ? ` This niche has already gone deep in several directions — the following specific angles have ALREADY been used SOMEWHERE in it (possibly for a different block than this one — that still counts, the goal is genuinely fresh ground, not just a fresh block label): ${JSON.stringify(existingLabels)}. Read these for their UNDERLYING THEME, not just their exact wording — if several share a theme (e.g. several are versions of "guilt about skipping" or "chores as hidden exercise"), treat that whole theme as already covered, not just those specific sentences. If the obvious answer for this block would just be a reword of an already-covered theme, actively look for a genuinely different underlying angle instead — a different mechanism, trigger, setting, or emotional hook entirely.`
    : '';

  const systemPrompt = `You are the node-generation engine for ThinkMaps, an app-idea ideation tool. ${instructions}${retryNote}${diversityNote}${SHORT_OPTION_RULE} Respond ONLY with valid JSON in this exact shape, nothing else: {"groupLabel": string, "options": [{"label": string}]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Path so far (their actual choices, in order): ${pathDescription}` }
  ]);
}

// Generates a BATCH of candidate groups — one per ASSIGNED block, not
// freely invented categories. This is what happens when an option gets
// activated (clicked, for root; dragged-into, for everything else): each
// of the (up to 3) new groups corresponds to a specific block from the
// same 9 driving the ideation intake, so canvas exploration and the
// 45-question flow are two expressions of the same underlying structure.
//
// pathContext (built by buildPathContextFromOption) already carries the
// FULL chain of every option this person has picked, root to the option
// just activated — that part of the data flow was always correct. What
// was missing was forcing the model to actually treat that chain as real,
// specific signal instead of generic background context: the prompt below
// explicitly demands every option reference or build on the prior choices,
// and explicitly asks the model to keep a running, private sense of what
// app idea this path is converging toward — well before the person
// finishes the canvas or starts the 45-question ideation intake.
// Builds a search query from the path's niche plus its most recent,
// most specific choices — the niche alone is too broad to find anything
// useful, and the full path is often too long and noisy for a search
// engine; the niche plus the last couple of choices is usually the
// sweet spot of "specific enough to find something real."
function buildSearchQueryFromPath(pathContext){
  const nicheLabel = pathContext[0]?.optionLabel || '';
  const mostRecent = pathContext.slice(1).map(p => p.optionLabel).slice(-2).join(' ');
  return [nicheLabel, mostRecent].filter(Boolean).join(' ').trim();
}

// Real, live search for what people actually say about this — reuses
// webSearchForSimilarProducts (defined further down, but a hoisted
// function declaration so call order here doesn't matter). Returns null
// if SEARCH_API_KEY isn't configured or the search fails; callers below
// degrade gracefully either way.
async function searchRealPainPoints(pathContext){
  const baseQuery = buildSearchQueryFromPath(pathContext);
  if(!baseQuery) return null;
  return await webSearchForSimilarProducts(`${baseQuery} reddit forum frustrated complaints problems`);
}

async function searchRealExistingSolutions(pathContext){
  const baseQuery = buildSearchQueryFromPath(pathContext);
  if(!baseQuery) return null;
  return await webSearchForSimilarProducts(`${baseQuery} existing apps solutions reviews`);
}

async function generateCandidateBatch(pathContext, blockNames, existingLabels = [], onToken = null){
  const pathDescription = pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ') || 'Start of the blueprint.';
  const blockList = blockNames.map((b, i) => `${i + 1}. ${b}`).join('\n');

  const needsPainSearch = blockNames.includes('Personal Read on the Pain');
  const needsExistingSearch = blockNames.includes('Honest Awareness of What Exists');
  // 2-second hard cap — Serper can be slow and was previously blocking
  // Mistral from starting for up to 3-5 seconds with no timeout.
  const [painSearchResults, existingSearchResults] = await Promise.all([
    needsPainSearch ? withTimeout(searchRealPainPoints(pathContext), 2000) : Promise.resolve(null),
    needsExistingSearch ? withTimeout(searchRealExistingSolutions(pathContext), 2000) : Promise.resolve(null)
  ]);

  const painGroundingNote = needsPainSearch
    ? (painSearchResults
        ? `\n\nPain block: ground options in these real search results — ${JSON.stringify(painSearchResults)}. Every option must be a plain frustration a real person would say, never a feature pitch.`
        : `\n\nPain block: draw on real, commonly-expressed frustrations you're confident exist in this space. Never dress up a feature as a problem.`)
    : '';

  const existingGroundingNote = needsExistingSearch
    ? (existingSearchResults
        ? `\n\nExisting block: ground options in these real search results — ${JSON.stringify(existingSearchResults)}.`
        : `\n\nExisting block: only reference real, well-known products you're confident actually exist.`)
    : '';

  // Cap at 15 most recent — still catches theme repetition while saving
  // ~800 tokens vs the old 60-label cap.
  const recentLabels = existingLabels.slice(-15);
  const diversityNote = recentLabels.length > 0
    ? `\nAvoid these ALREADY-USED themes: ${JSON.stringify(recentLabels)}.`
    : '';

  const crossBlockNote = blockNames.length > 1
    ? `\nThese ${blockNames.length} blocks MUST be distinct from each other — check each option against every other block's options before finalizing. No two blocks should converge on the same underlying idea.`
    : '';

  // The 150-topic niche grounding was removed — it added ~1800 input
  // tokens (>1000ms latency) to every single canvas click for a quality
  // gain that is outweighed by the speed cost. The path context itself
  // already provides the specificity the model needs.

  const systemPrompt = `You are the node-generation engine for ThinkMaps. Generate up to 5 specific options for EACH of these ${blockNames.length} blocks:\n${blockList}\nPath so far: ${pathDescription}\nEvery option must build on this exact path, fit its block's territory, and be answerable from the person's own knowledge/instinct.${crossBlockNote}${diversityNote}${painGroundingNote}${existingGroundingNote}${SHORT_OPTION_RULE} JSON only: {"groups": [{"options": [{"label": string}]}]} with exactly ${blockNames.length} groups.`;

  const result = await callMistralWithStreaming([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate now.' }
  ], 800, onToken);

  // Iterate over the ASSIGNED blocks, not whatever Mistral's "groups" array
  // happens to contain — this guarantees exactly blockNames.length groups
  // come back every time, regardless of the model returning too few, too
  // many, a non-array, or anything else unexpected. Labels were already
  // forced to match the assigned block; this closes the matching gap on
  // the options side too.
  const rawGroups = Array.isArray(result?.groups) ? result.groups : [];

  // Code-level safety net on top of the crossBlockNote instruction above
  // — that's a prompt-level ask, not a guarantee. This catches the worst
  // case deterministically: if the exact same label (trimmed,
  // case-insensitive) shows up in an EARLIER block of this same
  // response, it's dropped from a LATER one rather than shown twice. A
  // block ending up with 5 options instead of 6 is a far smaller problem
  // than a verbatim duplicate sitting in two sibling cards at once.
  const seenLabelsAcrossBatch = new Set();
  const groups = blockNames.map((blockName, i) => {
    const sanitized = sanitizeOptionLabels(rawGroups[i]?.options);
    const deduped = sanitized.filter(o => {
      const key = o.label.trim().toLowerCase();
      if(seenLabelsAcrossBatch.has(key)) return false;
      seenLabelsAcrossBatch.add(key);
      return true;
    });
    return { groupLabel: blockName, blockName, options: deduped };
  });

  return { groups };
}

// The one-time checkpoint between block F and block G — see
// IDEA_CHECKPOINT_BLOCK_NAME above for when this fires. Unlike every
// other generator in this file, the instruction here is explicitly NOT
// "ask about the person" — it's "actually work out what specific app idea
// is crystallizing out of everything chosen so far, then ask a sharp,
// idea-specific follow-up that meaningfully changes what gets built
// next." Returns the same { groups: [...] } shape generateCandidateBatch
// does (just with one entry instead of three), so activateOption can pick
// between them without any change to how the result gets inserted.
async function generateIdeaSynthesisCheckpoint(pathContext, existingLabels = [], onToken = null){
  const pathDescription = pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ') || 'Start of the blueprint.';

  const recentLabels = existingLabels.slice(-15);
  const diversityNote = recentLabels.length > 0
    ? `\n\nAvoid these already-used themes: ${JSON.stringify(recentLabels)}.`
    : '';

  const systemPrompt = `You are the idea-synthesis engine for ThinkMaps. The person has finished the first round of exploration. Privately work out the SPECIFIC app concept crystallizing from their path — a concrete, nameable idea you could describe in one sharp sentence. Then produce EXACTLY 2 opposing options for ONE key fork specific to that emerging idea (not a generic preference question — a real direction choice for THIS concept). The two options must be genuinely opposed directions.${diversityNote}${SHORT_OPTION_RULE} JSON only: {"options": [{"label": string}, {"label": string}]}`;

  const result = await callMistralWithStreaming([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Path: ${pathDescription}` }
  ], 120, onToken);

  return {
    groups: [{
      groupLabel: IDEA_CHECKPOINT_BLOCK_NAME,
      blockName: IDEA_CHECKPOINT_BLOCK_NAME,
      options: sanitizeOptionLabels(result?.options)
    }]
  };
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

// The one shared source of truth for "is this user pro" — every gate in
// this file (blueprint locking, the newly pro-gated routes below) goes
// through this rather than each re-writing its own profile query, so
// there's exactly one place that definition could ever drift.
async function isUserPro(userId){
  const { data: profile } = await supabase.from('profiles').select('pro_status').eq('id', userId).single();
  return !!profile?.pro_status;
}

// Convenience for the top of any pro-gated route — returns true and
// sends the 403 itself if the user ISN'T pro, so callers can just do
// `if(await requireProOrReject(req, res)) return;` as their one gate
// line, the same shape as the requireAuth pattern used throughout this
// file. Kept deliberately separate from requireAuth (an Express
// middleware run before the route body) since this needs to run AFTER
// requireAuth has already populated req.user, and only for the specific
// routes that need it — not a blanket middleware on every authed route.
async function requireProOrReject(req, res){
  const pro = await isUserPro(req.user.id);
  if(!pro){
    res.status(403).json({ error: 'This feature is part of the Pro plan.', requiresPro: true });
    return true;
  }
  return false;
}

async function checkIsLocked(userId, blueprintCreatedAt){
  const pro = await isUserPro(userId);
  const ageMs = Date.now() - new Date(blueprintCreatedAt).getTime();
  return !pro && ageMs > FREE_TIER_LOCK_MS;
}

// Permanently deletes any of THIS user's free-tier blueprints older than
// FREE_TIER_DELETE_MS. Pro users are never touched here regardless of
// age — isUserPro is checked once up front and this becomes a no-op
// entirely for them, not a per-blueprint check. Called lazily from the
// top of the /dashboard route (see below) rather than a scheduled job —
// see the comment on FREE_TIER_DELETE_MS above for why that's an
// intentional, reasonable choice here rather than a missing piece.
// Deletion here relies on the database's own ON DELETE CASCADE from
// blueprints to its groups/group_versions/options/confirmation_sessions
// — if that cascade isn't actually set up in the schema, this would
// leave orphaned rows behind; worth a quick check against the real
// schema before this matters in practice.
async function cleanupExpiredFreeBlueprints(userId){
  const pro = await isUserPro(userId);
  if(pro) return;

  const cutoff = new Date(Date.now() - FREE_TIER_DELETE_MS).toISOString();
  const { data: expiredBlueprints } = await supabase
    .from('blueprints')
    .select('id')
    .eq('user_id', userId)
    .lt('created_at', cutoff);

  const expiredIds = (expiredBlueprints || []).map(b => b.id);
  if(expiredIds.length === 0) return;

  // Deleted explicitly, child-first, rather than trusting an unverified
  // ON DELETE CASCADE — there's no CREATE TABLE migration anywhere in
  // this project to confirm cascade is actually configured on the live
  // schema, only incremental ALTER TABLEs. This is correct either way:
  // if cascade IS set up, these become harmless no-ops against rows
  // that are already gone; if it isn't, this is what actually prevents
  // orphaned groups/options/sessions instead of leaving it to chance.
  const { data: groupsToDelete } = await supabase.from('groups').select('id').in('blueprint_id', expiredIds);
  const groupIds = (groupsToDelete || []).map(g => g.id);

  if(groupIds.length > 0){
    const { data: versionsToDelete } = await supabase.from('group_versions').select('id').in('group_id', groupIds);
    const versionIds = (versionsToDelete || []).map(v => v.id);
    if(versionIds.length > 0){
      await supabase.from('options').delete().in('group_version_id', versionIds);
    }
    await supabase.from('group_versions').delete().in('group_id', groupIds);
  }
  await supabase.from('groups').delete().in('blueprint_id', expiredIds);
  await supabase.from('confirmation_sessions').delete().in('blueprint_id', expiredIds);
  await supabase.from('ideation_sessions').delete().in('blueprint_id', expiredIds);
  await supabase.from('blueprints').delete().in('id', expiredIds);
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

  // blueprintId returned so callers can use it without re-fetching the same
  // chain — the activate route uses this to include the full graph in its
  // response, saving the client a second round trip.
  return { ok: true, blueprintId: group.blueprint_id };
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
// Estimates whether a label needs the taller (2-line) treatment or fits
// compactly on one line — used everywhere a card's real height matters
// (collision checks, fan-out placement). Only text that actually needs
// the extra room gets it; short labels stay compact.
function estimateOptionHeight(label){
  return (label || '').length > 26 ? 54 : 38;
}

function estimateHeaderHeight(label){
  return (label || '').length > 22 ? 56 : 40;
}

// Filters out anything Mistral hands back without a real, non-empty label —
// the options.label column is NOT NULL, so an entry missing it would crash
// the insert. Better to silently drop that one slot than fail the whole
// activation over a single malformed item.
function sanitizeOptionLabels(rawOptions){
  return (rawOptions || [])
    .filter(o => o && typeof o.label === 'string' && o.label.trim().length > 0)
    .map(o => ({ label: o.label.trim() }));
}

// combinedOptionIds is the NEW, optional piece: when non-empty, this is a
// combined multi-select activation (ctrl+click several options, then
// drag) rather than a normal single one. optionId stays the "primary" —
// the one spawned_from_option_id on every new group points to, and the
// one buildPathContextFromOption walks from — while every ID in
// combinedOptionIds gets selected and frozen-sibling-handled exactly like
// optionId does, just without becoming the traversal anchor itself. Every
// existing call site passes nothing here and behaves completely unchanged.
async function activateOption(optionId, combinedOptionIds = [], onToken = null){
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

  // The full combined set (primary + others) — every freeze/select step
  // below needs to treat ALL of these as "the thing being activated,"
  // never just the primary alone.
  const allCombinedIds = [optionId, ...combinedOptionIds];

  // Freeze any OTHER option in EVERY group_version actually involved —
  // not just the primary's. A combined pick spanning "brother" groups
  // means each of those groups independently needs its own non-combined
  // siblings frozen, the exact same way a normal single activation
  // freezes the primary's siblings. The combined set itself is excluded
  // everywhere, since two combined options can legitimately share one
  // group_version (the "same group" case from the spec).
  const involvedVersionIds = new Set([version.id]);
  if(combinedOptionIds.length > 0){
    const { data: combinedOptionRows } = await supabase
      .from('options')
      .select('id, group_version_id')
      .in('id', combinedOptionIds);
    (combinedOptionRows || []).forEach(o => involvedVersionIds.add(o.group_version_id));
  }

  for(const versionId of involvedVersionIds){
    const { data: siblingOptions } = await supabase
      .from('options')
      .select('id')
      .eq('group_version_id', versionId);

    for(const sibling of (siblingOptions || [])){
      if(!allCombinedIds.includes(sibling.id)){
        await freezeOptionSubtree(sibling.id);
      }
    }
  }

  if(option.is_selected){
    await unfreezeOptionSubtree(optionId);
    const { data: existingGroups } = await supabase.from('groups').select('*').eq('spawned_from_option_id', optionId);
    return { groups: existingGroups || [], reactivated: true };
  }

  await supabase.from('options').update({ is_selected: true }).in('id', allCombinedIds);

  // Fetched ONCE, right here, and shared by everything below that used
  // to be a separate ancestor-walking function each paying its own
  // per-tree-level round trips — see fetchBlueprintSnapshot's own
  // comment above for the full reasoning. blueprintId itself only needs
  // one small lookup (group_id -> blueprint_id), genuinely unavoidable
  // since that's the one piece of information this function doesn't
  // have yet at this point.
  const blueprintId = await getBlueprintIdForGroup(version.group_id);
  const snapshot = await fetchBlueprintSnapshot(blueprintId);

  let pathContext = walkPathContextFromSnapshot(optionId, snapshot);

  // Merge in the OTHER combined options' own {groupLabel, optionLabel}
  // pairs by replacing the final entry (which walkPathContextFromSnapshot
  // already built for the primary alone) with one that names every
  // combined choice together — so the model generating what comes next
  // sees the full combination, not just whichever one happened to be the
  // primary. Every combined option shares the primary's exact parent (the
  // validation layer in the route enforces this), so no separate ancestor
  // walk is needed for them — just their own one-level label lookup,
  // now an in-memory Map read instead of its own round trip too.
  if(combinedOptionIds.length > 0 && pathContext.length > 0){
    const extraPairs = combinedOptionIds.map(id => lookupOptionGroupLabelPairFromSnapshot(id, snapshot));
    const allPairs = [pathContext[pathContext.length - 1], ...extraPairs.filter(Boolean)];
    const mergedOptionLabel = allPairs.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' — combined with — ');
    pathContext = [
      ...pathContext.slice(0, -1),
      { groupLabel: 'Combined choice', optionLabel: mergedOptionLabel }
    ];
  }

  let generated;
  if(pathContext.length >= PATH_DEPTH_CAP){
    // This path is deep enough now — stop generating more exploration
    // and hand back exactly one terminal group: a button, not a list of
    // options to click into. No AI call needed; there's nothing left to
    // generate, just a clear "you're done exploring, go turn this into
    // an idea" stop sign at the end of this specific path.
    generated = {
      groups: [{
        groupLabel: GENERATE_IDEAS_BLOCK_NAME,
        blockName: GENERATE_IDEAS_BLOCK_NAME,
        options: []
      }]
    };
  } else {
    const usedBlocks = walkUsedBlockNamesFromSnapshot(optionId, snapshot);
    const ideaCheckpointAlreadyShown = usedBlocks.includes(IDEA_CHECKPOINT_BLOCK_NAME);
    const remainingBeforeCheckpoint = BLOCKS_BEFORE_IDEA_CHECKPOINT.filter(b => !usedBlocks.includes(b));

    // Fetched once here, regardless of which branch below fires — this is
    // what lets generateCandidateBatch tell the model what's already been
    // said elsewhere in THIS niche (any fork, not just this path), so
    // content stops converging on the same handful of phrasings every
    // time a narrow niche gets explored in more than one direction.
    const nicheOptionId = walkNicheRootOptionIdFromSnapshot(optionId, snapshot);
    const existingLabels = walkExistingOptionLabelsFromSnapshot(nicheOptionId, snapshot);

    if(!ideaCheckpointAlreadyShown && remainingBeforeCheckpoint.length === 0){
      generated = await generateIdeaSynthesisCheckpoint(pathContext, existingLabels, onToken);
    } else if(!ideaCheckpointAlreadyShown){
      const batchSize = Math.min(3, remainingBeforeCheckpoint.length);
      const assignedBlocks = remainingBeforeCheckpoint.slice(0, batchSize);
      generated = await generateCandidateBatch(pathContext, assignedBlocks, existingLabels, onToken);
    } else {
      const assignedBlocks = pickNextBlocks(usedBlocks, 3);
      generated = await generateCandidateBatch(pathContext, assignedBlocks, existingLabels, onToken);
    }
  }

  // Layout: radiate the candidates outward from the source like a spider
  // web, instead of forcing them into a fixed cross shape. For each one,
  // check which compass directions around the source actually have open
  // canvas space (nothing else nearby in that direction), pick from those,
  // and add a little random angle variation so two candidates never land
  // at a perfectly mechanical 180° from each other. Only when truly no
  // direction is free does it fall back to the old "further right" approach.
  const { data: parentGroup } = await supabase
    .from('groups')
    .select('label, position_x, position_y')
    .eq('id', version.group_id)
    .single();

  const CARD_WIDTH_ESTIMATE = 220;
  const baseX = (parentGroup?.position_x || 0) + 320; // fallback anchor — "further right"
  const baseY = (parentGroup?.position_y || 0);

  // Need the source group's REAL height — summed from its actual option
  // labels, not a flat per-row number — so short lists/short labels don't
  // get treated as if they were as tall as a full 6-long, all-wrapped card.
  const { data: parentOptionsForHeight } = await supabase
    .from('options')
    .select('label')
    .eq('group_version_id', version.id);

  const FOOTER_H = 40;
  const parentCardHeight = estimateHeaderHeight(parentGroup?.label)
    + (parentOptionsForHeight || []).reduce((sum, o) => sum + estimateOptionHeight(o.label), 0)
    + FOOTER_H;

  const { data: existingGroups } = await supabase
    .from('groups')
    .select('position_x, position_y')
    .eq('blueprint_id', blueprintId)
    .neq('id', version.group_id); // exclude the SOURCE group itself — comparing it against its own position is what was breaking the up/down directions

  const occupied = [...(existingGroups || [])];
  const MIN_CLEAR_X = 260; // a bit more than CARD_WIDTH
  const MIN_CLEAR_Y = 460; // a bit more than a max-height (6-option) card, now taller due to text wrapping

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
  const RADIATE_DISTANCE = 500; // comfortably more than MIN_CLEAR_Y, so a "free" direction has real breathing room against actual neighbors
  const ASSUMED_CARD_HEIGHT = 56 + 6 * 54 + FOOTER_H; // conservative worst-case (tall header + 6 tall rows) for the screening pass below

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

  // Every batch — niche or otherwise — stays capped at 3 groups now that
  // pathways are background grounding only and never spawn as their own
  // visible groups (see getNicheTopicsForGrounding above).
  const maxGroupsThisBatch = 3;
  const groupSpecs = (generated.groups || []).slice(0, maxGroupsThisBatch);
  const newGroups = [];

  for(let i = 0; i < groupSpecs.length; i++){
    const spec = groupSpecs[i];
    // Real height from THIS candidate's actual label + actual option labels
    // — a group with short options stays compact instead of always
    // reserving room for the worst case.
    const candidateHeight = estimateHeaderHeight(spec.groupLabel)
      + (spec.options || []).reduce((sum, o) => sum + estimateOptionHeight(o.label), 0)
      + FOOTER_H;

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
      // No open direction left nearby — fall back to placing further right,
      // with a little vertical jitter so even this degraded case doesn't
      // produce a perfectly straight horizontal line.
      candidateX = baseX;
      candidateY = baseY + (Math.random() - 0.5) * 300;
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
        spawned_from_option_id: optionId,
        combined_source_option_ids: combinedOptionIds.length > 0 ? allCombinedIds : null
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

    let sanitizedOptions = sanitizeOptionLabels(spec.options);

    // Mistral occasionally whiffs on one slot in a 3-at-once batch — rather
    // than leave that group permanently empty, try once more for just this
    // specific block before giving up.
    if(sanitizedOptions.length === 0){
      try {
        const nicheOptionId = walkNicheRootOptionIdFromSnapshot(optionId, snapshot);
        const existingLabels = walkExistingOptionLabelsFromSnapshot(nicheOptionId, snapshot);
        const retryGenerated = await generateGroupOptions(pathContext, { blockName: spec.blockName, existingLabels });
        sanitizedOptions = sanitizeOptionLabels(retryGenerated.options);
      } catch (retryErr) {
        // still nothing — group will just render with zero options, recoverable via Retry on the canvas
      }
    }

    const optionRows = sanitizedOptions.slice(0, 6).map((o, index) => ({
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
    // Fetched once here so the frontend can gate pro-only canvas
    // features (currently: ctrl+click multi-select combining) without a
    // separate round trip — checkIsLocked above already does its own
    // profile lookup internally, so this is one more cheap query, not a
    // duplicated definition of what "pro" means.
    const isPro = await isUserPro(req.user.id);

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

      const optionRows = sanitizeOptionLabels(generated.options).slice(0, 6).map((o, index) => ({
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
      blueprint: { id: blueprint.id, title: blueprint.title, isLocked, isPro },
      groups,
      groupVersions: groupVersions || [],
      options: allOptions || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load blueprint graph.', detail: err.message });
  }
});

// Returns the full {groups, groupVersions, options} triple for a blueprint
// in one 3-query flat fetch (same shape the GET /graph route already
// returns, minus the auto-generation logic which only applies on the very
// first load of an empty blueprint). Extracted here so the activate route
// can return the COMPLETE updated state in a single response rather than
// making the client do a second GET /graph round trip after the AI finishes —
// that second trip was typically another 200-400ms on top of an already-slow
// generation call.
async function fetchFullBlueprintGraph(blueprintId){
  const { data: groups } = await supabase.from('groups').select('*').eq('blueprint_id', blueprintId);
  const groupIds = (groups || []).map(g => g.id);

  const { data: groupVersions } = groupIds.length
    ? await supabase.from('group_versions').select('*').in('group_id', groupIds)
    : { data: [] };

  const versionIds = (groupVersions || []).map(v => v.id);
  const { data: allOptions } = versionIds.length
    ? await supabase.from('options').select('*').in('group_version_id', versionIds).order('position', { ascending: true })
    : { data: [] };

  return { groups: groups || [], groupVersions: groupVersions || [], options: allOptions || [] };
}

// Activates an option — works identically whether it's a root click or a
// completed drag from script.js; the frontend decides which is allowed where.
// Returns the FULL updated graph state alongside the activation result so the
// client doesn't need a second GET /graph round trip after the AI finishes.
// Adds a hard timeout to any promise — used on the web search calls
// so a slow/unresponsive Serper API never delays canvas generation by
// more than the given ms. Returns null on timeout rather than throwing.
function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ]);
}

app.post('/options/:id/activate', requireAuth, async (req, res) => {
  // SSE — client receives tokens live as Mistral generates them, then
  // gets the full graph state at the end. This is the fundamental fix
  // for perceived latency: instead of waiting 10-15s for a complete
  // response, the user sees the first options appearing in ~1-2 seconds.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if behind a proxy
  res.flushHeaders();

  function send(obj){
    if(!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error){
      send({ type: 'error', error: check.error, status: check.status });
      return res.end();
    }

    // activateOption now accepts an onToken callback — when provided, it
    // calls Mistral in streaming mode and fires onToken for every delta
    // token so this route can forward them to the client in real-time.
    const result = await activateOption(req.params.id, [], (tokenText) => {
      send({ type: 'token', text: tokenText });
    });

    let fullGraph = null;
    try {
      fullGraph = await fetchFullBlueprintGraph(check.blueprintId);
    } catch (graphErr) {
      console.error('[ThinkMaps] full graph fetch after activate failed:', graphErr.message);
    }

    send({ type: 'done', groups: result.groups, reactivated: result.reactivated, fullGraph });
    res.end();
  } catch (err) {
    send({ type: 'error', error: 'Could not activate that option.', detail: err.message });
    res.end();
  }
});

// Validates a proposed combined activation BEFORE any writes happen.
// Every rule here mirrors the actual constraint the feature was specced
// with: none of the options can already be selected (combining is for
// choosing several NEW things together, not re-triggering something
// already active), none can belong to the root Niches group (multi-select
// explicitly doesn't apply there), and every one of them must share the
// exact same spawned_from_option_id — meaning they're all either in the
// SAME group, or "brother" groups spawned together in the same batch.
// That last rule is deliberately exactly as strict as
// getUsedBlockNamesAlongPath's own definition of "same batch," so a
// combined pick can never straddle two genuinely unrelated parts of the
// tree, and the merged path-context logic in activateOption never needs
// to worry about combined options having divergent ancestor chains.
async function validateCombinationSet(optionIds){
  const { data: options } = await supabase
    .from('options')
    .select('id, is_selected, group_version_id')
    .in('id', optionIds);

  if(!options || options.length !== optionIds.length){
    return { error: 'One or more of the selected options could not be found.' };
  }
  if(options.some(o => o.is_selected)){
    return { error: 'One or more of those is already active — combining only works on options not yet chosen.' };
  }

  const versionIds = [...new Set(options.map(o => o.group_version_id))];
  const { data: versions } = await supabase.from('group_versions').select('id, group_id').in('id', versionIds);
  const groupIds = [...new Set((versions || []).map(v => v.group_id))];
  const { data: groups } = await supabase.from('groups').select('id, spawned_from_option_id').in('id', groupIds);

  if((groups || []).some(g => !g.spawned_from_option_id)){
    return { error: 'Combining options is not available on the starting niche selection.' };
  }

  const parentIds = new Set((groups || []).map(g => g.spawned_from_option_id));
  if(parentIds.size > 1){
    return { error: 'Combined options must all be in the same group, or in brother groups from the same batch.' };
  }

  return { error: null };
}

// Combined activation — ctrl+click multiple options (same group or
// brother groups, never the root), then drag onto any one of them. The
// first ID in the array is treated as the "primary": the one every new
// spawned group's spawned_from_option_id points to, exactly like a normal
// single activation. Every other ID rides along — selected, frozen-sibling
// -handled, and folded into the merged path description — without
// becoming a second traversal anchor anywhere else in the app.
app.post('/options/combine-activate', requireAuth, async (req, res) => {
  try {
    if(await requireProOrReject(req, res)) return;

    const { optionIds } = req.body;
    if(!Array.isArray(optionIds) || optionIds.length < 2){
      return res.status(400).json({ error: 'At least 2 option IDs are required to combine.' });
    }

    const [primaryOptionId, ...combinedOptionIds] = optionIds;

    const check = await verifyOptionOwnershipAndLock(primaryOptionId, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const validation = await validateCombinationSet(optionIds);
    if(validation.error) return res.status(400).json({ error: validation.error });

    const result = await activateOption(primaryOptionId, combinedOptionIds);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Could not activate that combination.', detail: err.message });
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

    let existingLabels = [];
    if(!isRoot && groupRow?.block_name){
      const nicheOptionId = await findNicheRootOptionId(groupRow.spawned_from_option_id);
      existingLabels = await getAllExistingOptionLabelsInNiche(nicheOptionId);
    }

    const generated = await generateGroupOptions(pathContext, {
      isRetry: true,
      isRoot,
      blockName: groupRow?.block_name || null,
      existingLabels
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

    const optionRows = sanitizeOptionLabels(generated.options).slice(0, 6).map((o, index) => ({
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

// ============================================================
// POST-SELECTION Retry/Random/+Custom — these three act on whatever
// spawned from a SELECTED option, not on a group's own option list. Once
// an option inside a group gets picked, that group's own Retry/Random/
// +Custom footer (the ones above, scoped to a single groupId) stops being
// what's shown — see script.js's footer-targeting logic. These three are
// scoped to an OPTION id instead, since "what spawned from this pick" is
// the actual unit of action here, not any single one of the (up to 3)
// groups it produced.
// ============================================================

// Regenerates EVERY group spawned from this option at once — not one
// group's content, all of them, together, as a single refresh of "what
// this pick led to."
app.post('/options/:id/retry-spawned', requireAuth, async (req, res) => {
  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: spawnedGroups } = await supabase
      .from('groups')
      .select('id, block_name')
      .eq('spawned_from_option_id', req.params.id);

    if(!spawnedGroups || spawnedGroups.length === 0){
      return res.status(400).json({ error: 'Nothing has spawned from this option yet.' });
    }

    const pathContext = await buildPathContextFromOption(req.params.id);
    const nicheOptionId = await findNicheRootOptionId(req.params.id);
    const existingLabels = await getAllExistingOptionLabelsInNiche(nicheOptionId);

    const retried = [];

    for(const group of spawnedGroups){
      // Custom-idea groups (blank text-box slates) never had AI content
      // to regenerate — retrying one wouldn't mean anything, so it's
      // skipped rather than overwriting whatever the person typed in.
      if(group.block_name === CUSTOM_IDEA_BLOCK_NAME) continue;

      const generated = await generateGroupOptions(pathContext, {
        isRetry: true,
        isRoot: false,
        blockName: group.block_name || null,
        existingLabels
      });

      const { data: existingVersions } = await supabase
        .from('group_versions')
        .select('version_number')
        .eq('group_id', group.id)
        .order('version_number', { ascending: false })
        .limit(1);

      const nextVersionNumber = (existingVersions?.[0]?.version_number || 0) + 1;

      const { data: newVersion, error: versionError } = await supabase
        .from('group_versions')
        .insert({ group_id: group.id, version_number: nextVersionNumber })
        .select()
        .single();

      if(versionError) throw versionError;

      const optionRows = sanitizeOptionLabels(generated.options).slice(0, 6).map((o, index) => ({
        group_version_id: newVersion.id,
        label: o.label,
        position: index
      }));

      const { data: insertedOptions, error: optionsError } = await supabase
        .from('options')
        .insert(optionRows)
        .select();

      if(optionsError) throw optionsError;

      await supabase.from('groups').update({ current_version_number: nextVersionNumber }).eq('id', group.id);

      retried.push({ groupId: group.id, versionNumber: nextVersionNumber, options: insertedOptions });
    }

    res.status(200).json({ retried });
  } catch (err) {
    res.status(500).json({ error: 'Could not retry the spawned groups.', detail: err.message });
  }
});

// Two genuinely random picks (Math.random — deliberately NOT the
// AI-assisted pick the per-group /groups/:id/random-branch above uses):
// which spawned group, then which option inside it. Then activates that
// option exactly like a real click would, so whatever spawns from IT
// goes through the normal flow.
app.post('/options/:id/random-spawned', requireAuth, async (req, res) => {
  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: spawnedGroups } = await supabase
      .from('groups')
      .select('id, current_version_number, block_name')
      .eq('spawned_from_option_id', req.params.id);

    // A custom-idea group with nothing typed into it yet has no option to
    // pick — excluded from the random draw rather than landing on an
    // empty group and erroring out.
    const eligibleGroups = (spawnedGroups || []).filter(g => g.block_name !== CUSTOM_IDEA_BLOCK_NAME);
    if(eligibleGroups.length === 0){
      return res.status(400).json({ error: 'Nothing eligible has spawned from this option yet.' });
    }

    const chosenGroup = eligibleGroups[Math.floor(Math.random() * eligibleGroups.length)];

    const { data: activeVersion } = await supabase
      .from('group_versions')
      .select('id')
      .eq('group_id', chosenGroup.id)
      .eq('version_number', chosenGroup.current_version_number)
      .single();

    if(!activeVersion) return res.status(400).json({ error: "Could not find that group's current options." });

    const { data: optionsInGroup } = await supabase.from('options').select('id, label').eq('group_version_id', activeVersion.id);

    if(!optionsInGroup || optionsInGroup.length === 0){
      return res.status(400).json({ error: 'That group has no options yet.' });
    }

    const chosenOption = optionsInGroup[Math.floor(Math.random() * optionsInGroup.length)];
    const result = await activateOption(chosenOption.id);

    res.status(200).json({ ...result, chosenGroupId: chosenGroup.id, chosenOption });
  } catch (err) {
    res.status(500).json({ error: 'Could not auto-activate a random spawned option.', detail: err.message });
  }
});

// Spawns one brand new, empty sibling group next to whatever the AI
// already generated for this option — a blank slate with zero options.
// The EXISTING /groups/:id/custom-option route handles actually adding
// the person's typed text into it once they submit; this route only
// creates the empty container and finds it a clear spot on the canvas.
app.post('/options/:id/custom-spawned-group', requireAuth, async (req, res) => {
  try {
    const check = await verifyOptionOwnershipAndLock(req.params.id, req.user.id);
    if(check.error) return res.status(check.status).json({ error: check.error });

    const { data: option } = await supabase.from('options').select('group_version_id').eq('id', req.params.id).single();
    if(!option) return res.status(404).json({ error: 'Option not found.' });

    const { data: version } = await supabase.from('group_versions').select('group_id').eq('id', option.group_version_id).single();
    if(!version) return res.status(404).json({ error: 'Group version not found.' });

    const { data: parentGroup } = await supabase.from('groups').select('blueprint_id, position_x, position_y').eq('id', version.group_id).single();
    if(!parentGroup) return res.status(404).json({ error: 'Parent group not found.' });

    const blueprintId = parentGroup.blueprint_id;
    const MIN_CLEAR_X = 260;
    const MIN_CLEAR_Y = 460;

    const { data: existingGroups } = await supabase
      .from('groups')
      .select('position_x, position_y')
      .eq('blueprint_id', blueprintId);

    function overlaps(x, y){
      return (existingGroups || []).some(g => {
        const dx = Math.abs((g.position_x || 0) - x);
        const dy = Math.abs((g.position_y || 0) - y);
        return dx < MIN_CLEAR_X && dy < MIN_CLEAR_Y;
      });
    }

    // A simpler fan-out than activateOption's batch radiator above —
    // always exactly one new group here, never up to three at once, so a
    // handful of candidate compass directions tried in random order is
    // enough; falls back to stepping further right if every one of them
    // is already occupied.
    const tryAngles = [-90, 90, -45, 45, 0, 180].sort(() => Math.random() - 0.5);
    let x = (parentGroup.position_x || 0) + 320;
    let y = parentGroup.position_y || 0;
    let placed = false;

    for(const angleDeg of tryAngles){
      const rad = (angleDeg * Math.PI) / 180;
      const candidateX = (parentGroup.position_x || 0) + Math.cos(rad) * 400;
      const candidateY = (parentGroup.position_y || 0) + Math.sin(rad) * 400;
      if(!overlaps(candidateX, candidateY)){
        x = candidateX;
        y = candidateY;
        placed = true;
        break;
      }
    }

    if(!placed){
      let attempts = 0;
      while(overlaps(x, y) && attempts < 20){
        attempts++;
        x += 280;
      }
    }

    const { data: newGroup, error: groupInsertError } = await supabase
      .from('groups')
      .insert({
        blueprint_id: blueprintId,
        label: CUSTOM_IDEA_BLOCK_NAME,
        block_name: CUSTOM_IDEA_BLOCK_NAME,
        position_x: x,
        position_y: y,
        spawned_from_option_id: req.params.id
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

    res.status(201).json({ group: newGroup, version: newVersion, options: [] });
  } catch (err) {
    res.status(500).json({ error: 'Could not create a custom group.', detail: err.message });
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

// IDEATION_SCAFFOLD and NICHE_TEMPLATES live in niche_templates.js
// (2345 lines of static data extracted to keep this file editable)
const { IDEATION_SCAFFOLD, NICHE_TEMPLATES } = require('./niche_templates');


// Startup sanity check — manual transcription of 44 question/option
// blocks per template is exactly the kind of process that loses or
// reorders an entry without anyone noticing until a user happens to hit
// that exact slot. Runs once when this file loads and checks EVERY
// template (not just the one a given session touches): entry count must
// be 45, and each entry's tagged "block" must match what IDEATION_SCAFFOLD
// expects at that index. Logs loudly via console.error, never throws — a
// bad template should degrade to "no grounding for that niche," not take
// the whole server down.
(function validateNicheTemplates(){
  for(const [key, t] of Object.entries(NICHE_TEMPLATES)){
    if(t.questions.length !== IDEATION_SCAFFOLD.length){
      console.error(`[ThinkMaps] NICHE_TEMPLATES["${key}"] has ${t.questions.length} entries, expected ${IDEATION_SCAFFOLD.length}.`);
      continue;
    }
    t.questions.forEach((entry, i) => {
      const expectedBlock = IDEATION_SCAFFOLD[i]?.block;
      if(entry.block !== expectedBlock){
        console.error(`[ThinkMaps] NICHE_TEMPLATES["${key}"] slot ${i}: expected block "${expectedBlock}", found "${entry.block}".`);
      }
    });
  }
})();

// Normalizes a niche label for exact/alias comparison — trims and
// lowercases, nothing fancier. Used ONLY for the fast exact-match path
// below; genuine paraphrases still fall through to the AI fuzzy match.
function normalizeNicheLabel(label){
  return (label || '').trim().toLowerCase();
}

// Checks the picked niche against each template's key AND its aliases —
// a plain string comparison, no AI call, no hallucination risk. This is
// the common case (someone picks "Fitness" and the template key is
// "Health, Fitness & Wellness") and it's free to check, so it runs first.
function findExactTemplateMatch(nicheLabel){
  const normalized = normalizeNicheLabel(nicheLabel);
  for(const [key, t] of Object.entries(NICHE_TEMPLATES)){
    const candidates = [key, ...(t.aliases || [])].map(normalizeNicheLabel);
    if(candidates.includes(normalized)) return key;
  }
  return null;
}

// Resolves the picked niche to the closest written template, if any — run
// ONCE per ideation session (at /start below), not per question, then
// stored on the session row so every later question reuses the same match
// instead of re-asking. Checks for an exact key/alias match FIRST (see
// findExactTemplateMatch) — only when nothing matches directly does this
// fall back to asking Mistral to guess the closest one, matched on
// DESCRIPTION, so "tracking my anxiety" can still find "Mental Health &
// Emotional Wellbeing" even though the words barely overlap.
//
// Returns { key, confidence }. confidence is "strong" (exact match, or
// essentially the same space as the template) or "loose" (adjacent/partial
// overlap) — used by generateIdeationQuestion to decide how hard to lean
// on the example. Mistral's response is checked against the REAL template
// keys before being trusted — never trust an AI response's exact shape
// blindly, same rule as everywhere else in this file. One retry on a
// malformed response before giving up — same "don't fail over one bad
// roll" pattern as generateCandidateBatch's empty-slot retry. Total
// failure (or zero templates existing) falls back to
// { key: null, confidence: 'none' } — generic-intent-only, exactly today's
// behavior.
async function matchNicheToTemplate(nicheLabel){
  const templateKeys = Object.keys(NICHE_TEMPLATES);
  if(templateKeys.length === 0) return { key: null, confidence: 'none' };

  const exactMatch = findExactTemplateMatch(nicheLabel);
  if(exactMatch) return { key: exactMatch, confidence: 'strong' };

  const candidateList = templateKeys
    .map(k => `"${k}": ${NICHE_TEMPLATES[k].description}`)
    .join('\n');

  const systemPrompt = `You are matching a user-picked app niche to the closest written template, if one genuinely fits. Niche: "${nicheLabel}". Candidate templates (name: what it actually covers):\n${candidateList}\nRespond ONLY with valid JSON: {"matchedKey": string, "confidence": string} where matchedKey is EXACTLY one of the candidate names above, copied verbatim, or "none" if nothing fits at all. confidence must be "strong" (the niche is essentially the same space as the template), "loose" (adjacent or partially overlapping but meaningfully different), or "none" (no real match).`;

  for(let attempt = 0; attempt < 2; attempt++){
    try {
      const result = await callMistral([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Niche: ${nicheLabel}` }
      ]);

      if(result?.matchedKey === 'none' || !result?.matchedKey){
        return { key: null, confidence: 'none' };
      }

      if(templateKeys.includes(result.matchedKey)){
        const confidence = ['strong', 'loose'].includes(result.confidence) ? result.confidence : 'loose';
        return { key: result.matchedKey, confidence };
      }
      // matchedKey wasn't a real key — fall through and retry once
    } catch (err) {
      // fall through and retry once
    }
  }

  return { key: null, confidence: 'none' };
}

// Looks up a template's reference entry for a given slot, asserting its
// tagged "block" actually matches what IDEATION_SCAFFOLD expects at that
// index. Manual transcription of a 44-question template is exactly the
// kind of process that can lose or reorder an entry without anyone
// noticing until a user happens to hit that exact slot — this turns that
// into a loud console.error and a safe null instead of silently feeding
// the WRONG block's reference into a question. Same fallback behavior as
// no match at all: the question generator just proceeds intent-only.
function getTemplateReference(templateKey, slotIndex){
  if(!templateKey) return null;
  const entry = NICHE_TEMPLATES[templateKey]?.questions?.[slotIndex];
  if(!entry) return null;

  const expectedBlock = IDEATION_SCAFFOLD[slotIndex]?.block;
  if(entry.block !== expectedBlock){
    console.error(`[ThinkMaps] Block mismatch in NICHE_TEMPLATES["${templateKey}"] at slot ${slotIndex}: expected "${expectedBlock}", found "${entry.block}". Skipping this reference.`);
    return null;
  }

  return entry;
}

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
// depending on the niche and what's already been answered. When a written
// template matched this niche (see matchNicheToTemplate), templateReference
// is that template's entry at this SAME slot index, and matchConfidence
// ("strong" | "loose" | "none") controls how hard the prompt leans on it —
// a strong match reads as "near-identical, follow this closely," a loose
// match reads as "rough calibration only, adapt heavily." templateReference
// is null whenever there's no match, which behaves EXACTLY like before
// this feature existed — intent-only, no degradation.
async function generateIdeationQuestion(nicheLabel, intent, answersSoFar, templateReference = null, matchConfidence = 'none'){
  const context = answersSoFar.length === 0
    ? 'This is the first question — no prior answers yet.'
    : answersSoFar.map((a, i) => `Q${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');

  let referenceBlock = '';
  if(templateReference && matchConfidence === 'strong'){
    referenceBlock = ` Here's how this exact question was handled for a near-identical, already-validated niche — use it as a strong calibration example for tone, depth, and specificity: Q: "${templateReference.question}" Options: ${JSON.stringify(templateReference.options)}. This is a calibration example only, NOT text to copy or lightly reword — write fully original question text and options for "${nicheLabel}" that match that level of specificity and structure.`;
  } else if(templateReference && matchConfidence === 'loose'){
    referenceBlock = ` Here's how a LOOSELY related niche handled this slot — "${nicheLabel}" is meaningfully different, so treat this only as a rough example of tone and format, not specifics: Q: "${templateReference.question}" Options: ${JSON.stringify(templateReference.options)}. This is a calibration example only, NOT text to copy — adapt heavily and write fully original content for "${nicheLabel}".`;
  }

  const systemPrompt = `You are writing ONE question for a guided idea-generation intake inside ThinkMaps, for someone exploring the "${nicheLabel}" niche. The question's INTENT is: ${intent} Write the actual question text — one sentence, specific to "${nicheLabel}", informed by what they've already answered — and exactly 6 answer options. Every answer they've already given is real, specific signal about this exact person — treat it that way: where it's natural, let this question and its options clearly build on or reference what they've already told you, rather than reading as a generic next slot. The question must be answerable from the person's own knowledge, instinct, or preference — never something requiring market research they wouldn't already have. If the intent involves a guess about the market, make that explicit in the wording and include an honest "not sure — let the AI figure it out" as one of the 6 options. As you write this, privately keep building a sense of what specific app idea their answers are converging toward — let that emerging direction inform later questions, well before all 45 are answered and the idea itself gets synthesized.${referenceBlock}${SHORT_OPTION_RULE} Respond ONLY with valid JSON: {"question": string, "options": [string, string, string, string, string, string]}`;

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

// ============================================================
// CONFIRMATION FLOW — the "harden the idea" pipeline triggered by the
// canvas's 7-node "Ready to Generate Ideas" terminal card.
//
// This is a SEPARATE system from the 45-question intake above. The 45Q
// flow stays exactly as it is, untouched, and keeps doing what it already
// does (anchored to the blueprint's root niche, powering generic guided
// ideation and grounding canvas path generation via the same scaffold).
// This new flow is anchored to one SPECIFIC 7-node-deep canvas path —
// far more signal than "which niche was picked" — and only ever asks 3
// short confirmation questions before handing off to real competitive
// research, not 45 generic intake questions.
// ============================================================

const CONFIRMATION_QUESTION_COUNT = 4;

// Each of these 4 confirmation questions has a distinct, deliberate job —
// not "ask 4 more things about the person," but pressure-test the
// load-bearing parts of the idea that just got synthesized from their
// path: the problem itself, the solution approach, who it's for, and
// what makes it genuinely different. No monetization question — the
// idea draft (shown to the person above every question, see
// renderIdeaDraftContext in script.js) still proposes a monetization
// approach as part of the idea itself, the model doing that work same as
// everywhere else, but the person is never asked to pick or confirm a
// monetization model via a dedicated question.
const CONFIRMATION_INTENTS = [
  'Confirm whether the core problem this idea is built around is genuinely the right one to solve — or surface a sharper, more specific version of it worth considering instead.',
  'Confirm whether the proposed core feature or solution approach is actually the strongest way to solve that problem — or surface a stronger alternative angle.',
  'Confirm whether the target audience genuinely fits this idea — or surface a different, better-fitting group of people this should actually be built for instead.',
  'Confirm whether what supposedly makes this idea different from what already exists is actually sharp and defensible — or surface a stronger, more specific point of differentiation.'
];

// Synthesizes a working idea draft from a FULL 7-node canvas path — far
// more concrete signal than the 45Q flow's niche-only anchor, so this
// draft is meant to already be a real, specific concept, not a vague
// theme. Everything downstream (confirmation questions, competitive
// research, the final result) builds on this.
async function synthesizeIdeaDraftFromPath(pathSummary){
  const systemPrompt = `You are the idea-synthesis engine for ThinkMaps. A person just finished a deep, 7-step exploration on the canvas — every choice below is real, specific signal about an idea taking shape, not a generic intake transcript. Based on the FULL path, synthesize ONE specific, concrete app idea draft — a real concept with a clear angle, not a vague theme. Respond ONLY with valid JSON: {"name": string, "oneLiner": string, "coreProblem": string, "targetAudience": string, "coreFeature": string, "monetization": string}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Full path: ${pathSummary}` }
  ], 300);
}

// Writes ONE confirmation question — not "gather more info about the
// person," but pressure-test and sharpen THIS exact idea draft. Informed
// by whatever's already been confirmed in earlier questions, same
// "treat prior answers as real signal" principle used everywhere else in
// this file. Same "answerable from instinct, never market research"
// guardrail every other generator here already has — this one was
// missing it, which is exactly how a prior version of this drifted into
// asking people to pick between specific monetization price points they
// have no actual way to know.
async function generateConfirmationQuestion(ideaDraft, pathSummary, answersSoFar){
  const questionIndex = answersSoFar.length;
  const intent = CONFIRMATION_INTENTS[questionIndex] || CONFIRMATION_INTENTS[CONFIRMATION_INTENTS.length - 1];

  const answeredContext = answersSoFar.length === 0
    ? 'No confirmation questions answered yet.'
    : answersSoFar.map((a, i) => `Confirmation ${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');

  const systemPrompt = `You are writing ONE confirmation question for ThinkMaps. Its purpose is to harden a SPECIFIC app idea before deep competitive research begins — not gather new general information about the person, but pressure-test and sharpen THIS EXACT IDEA. The idea draft so far: ${JSON.stringify(ideaDraft)}. This question's specific job: ${intent} Write the actual question text — one sentence, specific to this exact idea — and exactly 6 answer options, each a genuinely different concrete direction the idea could confirm or pivot toward, not vague yes/no options. Every option must be something the person could answer from their own knowledge, instinct, or preference — never a specific number, price, or statistic that would require real market research they don't have (e.g. never ask them to pick between dollar amounts). Include one honest "this all sounds right, don't change anything" option among the 6.${SHORT_OPTION_RULE} Respond ONLY with valid JSON: {"question": string, "options": [string, string, string, string, string, string]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Full path that led here: ${pathSummary}\n\nConfirmations so far:\n${answeredContext}` }
  ], 400);
}

// Used by the "Let AI Answer" button — the person decided this once,
// specific question isn't worth their own time, and wants a genuine pick
// made on their behalf rather than a generic non-answer. Picks from the
// SAME options already offered rather than inventing a new one, since
// those options were already crafted to be genuinely distinct, sensible
// directions for this exact question.
async function pickBestConfirmationAnswer(question, ideaDraft, pathSummary){
  const options = question?.options || [];

  const systemPrompt = `You are answering a confirmation question on behalf of the person building this idea — they've specifically asked you to decide this one for them instead of choosing themselves. Pick whichever option is the most sensible, defensible choice for this exact idea and path — make a genuine pick, not a safe non-answer (though if "this all sounds right, don't change anything" really is the most defensible choice given everything below, that's a legitimate pick too, not just a default).

Idea so far: ${JSON.stringify(ideaDraft)}
Path that led here: ${pathSummary}

Question: ${question.question}
Options:
${options.map((o, i) => `${i + 1}. ${o}`).join('\n')}

Respond ONLY with valid JSON: {"selected": string} — the string copied EXACTLY, character for character, from one of the options listed above.`;

  let result;
  try {
    result = await callMistral([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Pick the best option now.' }
    ]);
  } catch (err) {
    return options[0] || '';
  }

  // Defensive: if the model paraphrased instead of copying verbatim,
  // match case-insensitively before falling all the way back — passing
  // through unmatched text would mean the frontend has nothing to
  // visually highlight as "the one that got picked."
  if(options.includes(result.selected)) return result.selected;
  const looseMatch = options.find(o => o.toLowerCase() === (result.selected || '').toLowerCase());
  return looseMatch || options[0] || '';
}

// Real, live web search via Serper.dev — entirely optional, and free to
// actually turn on: 2,500 free queries, no credit card. (This used to call
// Brave's Search API, which had a real free tier when this was first
// written — Brave killed that for new signups in early 2026, so it's no
// longer a genuinely free option. Serper is, confirmed as of June 2026.)
//
// Set SEARCH_API_KEY in the environment to turn this on — get a key at
// serper.dev (sign up, no payment info required, key's on the dashboard
// immediately). Without it, this returns null and
// researchCompetitiveLandscape below falls back to Mistral's own
// training-data knowledge of existing products. That fallback is still
// genuinely useful, just not live/current — worth knowing which mode is
// actually running if that matters for your use case.
async function webSearchForSimilarProducts(query){
  if(!process.env.SEARCH_API_KEY) return null;

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SEARCH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 })
    });
    if(!res.ok) return null;

    const data = await res.json();
    const results = data.organic || [];
    return results.slice(0, 8).map(r => ({ title: r.title, description: r.snippet, url: r.link }));
  } catch (err) {
    console.error('[ThinkMaps] live web search failed, falling back to model knowledge:', err.message);
    return null;
  }
}

// Identifies 3-5 REAL existing products that compete with or resemble
// this idea, with genuine pros and cons for each — grounded in live
// search results when SEARCH_API_KEY is configured, otherwise in
// Mistral's own knowledge (explicitly told to only name products it's
// actually confident exist, never invent a fake one to fill the count).
async function researchCompetitiveLandscape(ideaDraft, pathSummary, confirmationAnswers){
  const confirmationContext = confirmationAnswers.map((a, i) => `Confirmation ${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');

  const searchResults = await webSearchForSimilarProducts(`${ideaDraft.name} similar apps competitors ${ideaDraft.coreProblem}`);

  const groundingBlock = searchResults
    ? `Here are real, current search results for similar products — ground your answer in these, don't invent products beyond what's reasonably supported by them:\n${searchResults.map(r => `- ${r.title}: ${r.description}`).join('\n')}`
    : `No live search was available for this — draw on your own knowledge of real, well-known existing apps or products in this space. Only name products you're genuinely confident actually exist; never invent a fake product name to fill the count.`;

  const systemPrompt = `You are the competitive-research engine for ThinkMaps. A specific app idea has been drafted and confirmed by its creator. Your job: identify 3 to 5 REAL, well-known existing apps or products that compete with or closely resemble this idea, and for each one, list genuine pros (what users/reviews actually praise about it) and genuine cons (what users/reviews actually complain about). ${groundingBlock} Idea draft: ${JSON.stringify(ideaDraft)}. Respond ONLY with valid JSON: {"competitors": [{"name": string, "pros": [string, string], "cons": [string, string]}, ...]} with 3 to 5 entries.`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Full path: ${pathSummary}\n\nConfirmations:\n${confirmationContext}` }
  ], 1000);
}

// For every weakness identified above, proposes a specific, concrete way
// THIS idea could solve or avoid that exact problem — a real mechanism or
// design decision, not a vague "we'll just do it better."
async function synthesizeSolutionsFromCons(competitiveLandscape){
  const cons = (competitiveLandscape?.competitors || []).flatMap(c => (c.cons || []).map(con => `${c.name}: ${con}`));

  const systemPrompt = `You are the solutions-synthesis engine for ThinkMaps. Below is a list of real complaints/weaknesses from competing products. For EACH ONE, propose a specific, concrete way a new app idea could solve or avoid that exact problem — a real mechanism or design choice, not a vague "we'll do better." Respond ONLY with valid JSON: {"solutions": [{"problem": string, "solution": string}, ...]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Complaints to solve:\n${cons.join('\n')}` }
  ], 1500);
}

// Pulls everything together — the original draft, what got confirmed
// through the 3 confirmation questions, the genuine strengths worth
// adopting from real competitors, and the concrete solutions to their
// real weaknesses — into ONE complete, hardened idea description.
async function synthesizeFinalIdea(ideaDraft, pathSummary, confirmationAnswers, competitiveLandscape, solvedProblems){
  const confirmationContext = confirmationAnswers.map((a, i) => `Confirmation ${i + 1}: ${a.question}\nAnswer: ${a.selected}`).join('\n\n');
  const pros = (competitiveLandscape?.competitors || []).flatMap(c => (c.pros || []).map(p => `${c.name}: ${p}`));
  const solutionLines = (solvedProblems?.solutions || []).map(s => `Problem: ${s.problem}\nSolution: ${s.solution}`).join('\n\n');

  // fullDescription used to be a SEPARATE sequential Mistral call after
  // this one — a dedicated prompt focused only on prose tends to write
  // better prose than asking for it as one field among many, which was
  // the original reasoning. But that doubled the latency of every single
  // final-idea synthesis (the one step every confirmation flow ends
  // with) for a quality gain that's real but secondary to actually
  // getting an answer back quickly. Merged into one call: fullDescription
  // is now produced in the SAME response, with explicit prose-quality
  // instructions kept just as detailed as the old dedicated prompt was,
  // rather than reduced to an afterthought field.
  const systemPrompt = `You are the final idea-synthesis engine for ThinkMaps. Pull everything below together into ONE complete, hardened app idea. Respond ONLY with valid JSON: {"name": string, "oneLiner": string, "coreProblem": string, "targetAudience": string, "coreFeature": string, "monetization": string, "competitiveEdge": string, "fullDescription": string}.

competitiveEdge should be 2-3 sentences on what makes this genuinely better than what's already out there, grounded in the real strengths and solved weaknesses below, not generic claims.

fullDescription is the final polished pitch description — write 2 to 4 cohesive paragraphs of real prose, not a list, not a recap of the other fields. It should read as a genuine, specific idea pitch: what it is, who it's for, why it matters, and why it's positioned to beat what's already out there. This needs the same craft as if it were the only thing you were writing — don't let it read like a rushed afterthought just because it's one field among several.`;

  const userContent = `Idea draft: ${JSON.stringify(ideaDraft)}

Full path: ${pathSummary}

Confirmations:
${confirmationContext}

Strengths worth adopting from real competitors:
${pros.join('\n')}

Competitors' weaknesses and how this idea solves them:
${solutionLines}`;

  const core = await callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ], 1200);

  return {
    ...core,
    competitors: competitiveLandscape?.competitors || [],
    solutions: solvedProblems?.solutions || []
  };
}

// ============================================================
// NEXT PHASE — runs only AFTER an idea is already hardened (confirm.html
// has finished and confirmation_sessions.result exists). Three sequential
// stages, since stage 3 explicitly depends on what stages 1 and 2 found:
// Market Intel -> Synthetic Panel -> Risk-Prioritized Plan.
// ============================================================

// STAGE 1 — Deeper Market Intel. Reuses webSearchForSimilarProducts
// above for every search here, just pointed at different queries than
// researchCompetitiveLandscape uses — competitor pricing, sentiment
// around existing solutions, and chatter about the underlying PAIN POINT
// itself (deliberately not about the competing products — about whether
// people genuinely talk about and struggle with this exact problem).
async function gatherDeeperMarketIntel(ideaDraft){
  const competitorNames = (ideaDraft?.competitors || []).map(c => c.name).filter(Boolean);

  // One search per competitor (capped at 3) — a combined query mentioning
  // several names at once tends to return a confusing mix of pages
  // rather than usable pricing for any one of them.
  const pricingSearches = await Promise.all(
    competitorNames.slice(0, 3).map(async (name) => ({
      name,
      results: await webSearchForSimilarProducts(`${name} pricing plans cost per month`)
    }))
  );

  const sentimentResults = await webSearchForSimilarProducts(`${ideaDraft.name || ideaDraft.coreProblem} reviews complaints reddit`);
  const painPointResults = await webSearchForSimilarProducts(`${ideaDraft.coreProblem} reddit forum frustrated`);

  const hasAnyLiveSearch = pricingSearches.some(p => p.results) || sentimentResults || painPointResults;

  const groundingBlock = hasAnyLiveSearch
    ? `Real, current search results below — ground your answer in these, don't invent specifics beyond what's reasonably supported by them:\n\n${pricingSearches.filter(p => p.results).map(p => `Pricing search for "${p.name}":\n${p.results.map(r => `- ${r.title}: ${r.description}`).join('\n')}`).join('\n\n') || '(no pricing results found)'}\n\nSentiment/review search:\n${sentimentResults ? sentimentResults.map(r => `- ${r.title}: ${r.description}`).join('\n') : '(no results)'}\n\nPain-point chatter search:\n${painPointResults ? painPointResults.map(r => `- ${r.title}: ${r.description}`).join('\n') : '(no results)'}`
    : `No live search was available for any of this — draw on your own general knowledge instead. Be appropriately hedged about anything you're not genuinely confident about, rather than inventing specific numbers or quotes that look like real data but aren't.`;

  const systemPrompt = `You are the market-intel synthesis engine for ThinkMaps. Based on the idea below and the search context provided, produce three things: (1) competitor pricing — real numbers if discoverable, otherwise a reasonable estimate clearly framed as an estimate, never presented as confirmed fact; (2) a short sentiment summary of how people generally seem to feel about existing solutions in this space; (3) a sample of real chatter specifically about the underlying PAIN POINT itself — not about competing products, about whether people genuinely talk about and struggle with this exact problem. ${groundingBlock}\n\nIdea: ${JSON.stringify(ideaDraft)}\n\nRespond ONLY with valid JSON: {"competitorPricing": [{"competitor": string, "pricing": string}], "sentimentSummary": string, "forumChatter": [string, string, string]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Competitors found earlier: ${competitorNames.join(', ') || 'none found'}` }
  ]);
}

// STAGE 2 — Synthetic User Panel. This is the single highest-risk spot in
// the whole app for an AI output to get mistaken for real user research,
// so the "this is simulated, not real feedback" framing is built into the
// PROMPT itself, not left to the UI label alone — Mistral is told
// explicitly these are hypothetical and not to overstate confidence.
// Personas are grounded in the real audience/path details already
// established for this specific idea, not generic placeholder people.
async function generateSyntheticPanel(ideaDraft, pathSummary){
  const systemPrompt = `You are generating a SIMULATED, hypothetical user panel for ThinkMaps. This is explicitly NOT real user research, NOT real feedback, and must never be written or framed as if it were actual testimonials or validated data. Generate exactly 5 personas, each grounded in the SPECIFIC audience and pain-point details already established on this idea's path below — not generic, interchangeable people. For each persona, write: a name, a one-sentence background tying them concretely to the specific audience and pain point, an honest "reaction" to the actual pitch (genuinely mixed across the 5 — not everyone should be enthusiastic; include at least one lukewarm or skeptical reaction), their single biggest objection, and what would actually make THEM personally pay for it. Write these as plausible, varied hypothetical reactions. Explicitly avoid any language implying these are real opinions or confirmed behavior — these are informed guesses about how people MIGHT react, not data about how they DID react. Idea: ${JSON.stringify(ideaDraft)}. Respond ONLY with valid JSON: {"personas": [{"name": string, "background": string, "reaction": string, "objection": string, "wouldPay": string}, ...]} with exactly 5 entries.`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Full path that shaped this idea: ${pathSummary}` }
  ]);
}

// STAGE 3 — Risk-Prioritized Plan. Depends on stages 1 AND 2 already
// having finished (sequential, not parallel) — this is what actually
// makes use of them: for each of the idea's biggest unproven
// assumptions, explicitly checks whether the market intel or synthetic
// panel above already partially answers it, rather than treating every
// assumption as equally untouched and handing back a generic to-do list.
async function generateRiskPrioritizedPlan(ideaDraft, marketIntel, syntheticPanel){
  const systemPrompt = `You are the risk-assessment engine for ThinkMaps. Given the idea below plus the market intel and synthetic user panel already gathered, identify the 3 to 5 most important UNPROVEN assumptions this idea currently rests on, ranked by severity (how much the idea's viability depends on this specific assumption being true). For EACH one: explicitly check whether the market intel or synthetic panel data already partially answers it — if so, say so plainly and specifically, citing the actual data point (for example: "competitors charge $8-15/mo, which partially de-risks pricing — but willingness-to-pay for this specific angle is still unverified"). If something is still genuinely open after that check, give ONE clear, specific next step. Only occasionally should that next step be a real-world action (talking to people, running a survey) — most of the time it should be something achievable within the product itself (a smaller test, a narrower initial launch, a specific metric to watch for), framed as a targeted footnote, not the whole deliverable. Respond ONLY with valid JSON: {"risks": [{"assumption": string, "severity": "high"|"medium"|"low", "addressedBy": string | null, "nextStep": string | null}, ...]} with 3 to 5 entries, ordered highest severity first. Set addressedBy to null only if nothing below touches it at all; set nextStep to null only if addressedBy already fully resolves it.`;

  const userContent = `Idea: ${JSON.stringify(ideaDraft)}\n\nMarket intel gathered:\n${JSON.stringify(marketIntel)}\n\nSynthetic panel reactions:\n${JSON.stringify(syntheticPanel)}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ]);
}

// Triggered from the very end of the Stage 1-3 results — used to
// regenerate the ENTIRE idea here, but that meant a click could change
// parts of the idea that had nothing to do with what the analysis
// actually found, and the idea's identity could drift every time it
// ran. This is narrower and more useful: the idea itself is left
// completely untouched, and this generates concrete fixes for the
// SPECIFIC risks (from the risk plan) and objections (from the
// synthetic panel) the deeper analysis surfaced — same
// {problem, solution} shape synthesizeSolutionsFromCons above already
// uses for competitor weaknesses, just aimed at risks and objections
// instead of competitor cons.
async function generateDeeperAnalysisFixes(idea, deeperAnalysis){
  const { syntheticPanel, riskPlan } = deeperAnalysis || {};

  const riskLines = (riskPlan?.risks || []).map(r =>
    `Risk: ${r.assumption}${r.addressedBy ? ` (partly addressed already: ${r.addressedBy})` : ''}${r.nextStep ? ` (suggested next step so far: ${r.nextStep})` : ''}`
  );
  const objectionLines = (syntheticPanel?.personas || []).map(p =>
    `Objection from a "${p.background}" persona: ${p.objection}${p.wouldPay ? ` (said they'd pay if: ${p.wouldPay})` : ''}`
  );
  const problems = [...riskLines, ...objectionLines];

  const systemPrompt = `You are the solutions-synthesis engine for ThinkMaps. Below is an already-hardened app idea, plus a list of real risks and objections a deeper market-intel and simulated-user-panel pass surfaced about it. For EACH ONE, propose a specific, concrete way the EXISTING idea could address it — a real mechanism, feature adjustment, or positioning choice that fits naturally into what this idea already is. This is NOT a request to change what the idea fundamentally is — the idea's name, core problem, and core feature stay exactly as they are; you're finding how THIS idea, as already conceived, can address each concern. Be concrete and specific, grounded in the actual risk/objection text — don't propose something that doesn't actually resolve what was raised.

Idea: ${JSON.stringify(idea)}

Risks and objections to address:
${problems.join('\n')}

Respond ONLY with valid JSON: {"fixes": [{"problem": string, "solution": string}, ...]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the fixes now.' }
  ]);
}

// Turns a hardened (and possibly rewritten) idea into a structured spec
// meant to be pasted straight into Claude Code or a similar AI coding
// tool — MVP scope, a suggested tech stack, a rough data model, the key
// flows worth building first, and the open questions worth settling
// before writing code. This is the step that was genuinely missing
// before: the canvas exploration, confirmation, and research all produce
// a fully hardened, validated idea, and then the trail went cold exactly
// where it mattered most — right before someone would actually start
// building. Deeper analysis (market intel, risk plan) is included when
// available since a real risk plan should directly shape MVP scope, but
// this works fine without it too.
async function generateBuildBrief(idea, pathSummary, deeperAnalysis){
  const riskContext = deeperAnalysis?.riskPlan?.risks?.length
    ? `\n\nA risk-prioritized plan already exists for this idea — let its highest-severity, least-addressed risks directly shape what's IN the MVP scope (de-risking those early) and what's deliberately left for later: ${JSON.stringify(deeperAnalysis.riskPlan.risks)}`
    : '';

  const systemPrompt = `You are the build-brief engine for ThinkMaps. Someone has fully hardened an app idea through this tool and is about to hand it to an AI coding assistant (like Claude Code) or a developer to actually start building. Your job is to translate the idea into a concrete, buildable spec — not a sales pitch, a working document.

Idea: ${JSON.stringify(idea)}
Path that led here: ${pathSummary}${riskContext}

Produce:
1. overview — 2-3 sentences, plainly stating what's being built and for whom, written for a developer's first read, not a pitch.
2. mvpScope — 4 to 8 specific components that make up a genuinely shippable v1, ordered roughly by build order. This is the section that matters most — it needs to read as a genuine, detailed guide someone could start building directly from, not a checklist. For EACH component, give {title: a short name for this piece, description: a real paragraph, 4-8 sentences, covering exactly what this piece does, the specific user interaction or flow involved (what the person taps, sees, and what happens next), what the UI concretely needs to show, and any implementation decisions worth calling out now — validation rules, specific edge cases, what happens on empty states or errors, what data gets shown where}. Concrete and scoped throughout (e.g. "User can log a workout with sets/reps/weight, editing any entry inline, with the most recent 7 days shown by default" not "tracking functionality") — detailed enough that someone could start building this exact piece without needing to ask a clarifying question first.
3. laterFeatures — 3 to 6 real features deliberately deferred past v1, the kind that are tempting to build first but aren't load-bearing for proving the idea.
4. suggestedTechStack — a reasonable, boring, well-supported stack for a solo or small-team build: {frontend, backend, database, aiServices (only if genuinely relevant to this idea, else empty string)}. Favor widely-documented, low-operational-overhead choices over anything exotic.
5. keyFlows — 3 to 5 specific user flows worth building and testing first (e.g. "New user signs up, completes onboarding, logs their first entry"), the backbone flows everything else hangs off of.
6. openQuestions — 2 to 5 real, specific decisions still genuinely unresolved at this point (a pricing detail, a platform choice, a scope boundary) — not generic disclaimers, actual open forks a builder would need to resolve.

Be specific to THIS idea throughout — every section should clearly be about this exact app, not generic startup advice that could apply to anything. Respond ONLY with valid JSON: {"overview": string, "mvpScope": [{"title": string, "description": string}, ...], "laterFeatures": [string, ...], "suggestedTechStack": {"frontend": string, "backend": string, "database": string, "aiServices": string}, "keyFlows": [string, ...], "openQuestions": [string, ...]}`;

  return callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Generate the build brief now.' }
  ], 3000);
}

// Driven by what the PERSON actually typed, not market intel — this is
// the difference from generateDeeperAnalysisFixes above. Their
// feedback wins over generic best practice every time, since it's their
// idea, not a best-practice idea. Returns a candidate revision; whether
// it actually becomes the real idea is a separate, explicit step (see
// the /revise/commit route) — this function itself never persists
// anything, callers decide that.
async function reviseIdeaWithFeedback(currentIdea, feedbackText){
  // Same merge as synthesizeFinalIdea above, same reasoning: fullDescription
  // used to be a separate sequential call, doubling the latency of every
  // single revision for a quality gain that's real but secondary to
  // actually getting an answer back quickly. Now produced in the same
  // response, with the prose-quality instructions the old dedicated
  // prompt had kept just as explicit, not reduced to an afterthought.
  const systemPrompt = `You are the idea-revision engine for ThinkMaps. Below is an app idea, and direct feedback from the person who actually owns this idea — things they want added, removed, or changed. Rewrite the idea to genuinely incorporate what they asked for, not just acknowledge it: actually change the relevant fields. If their feedback conflicts with anything in the current idea, their feedback wins — this is their idea, not a generic best-practice idea. If they ask to add something, work it into whichever field it most naturally belongs in (coreFeature, competitiveEdge, monetization, or fullDescription) rather than bolting it on awkwardly. If they ask to remove something, remove it cleanly without leaving a gap or a vague reference to something no longer there. Anything they didn't mention should stay as close to unchanged as still makes sense once the rest has shifted.

Current idea: ${JSON.stringify(currentIdea)}

Their feedback: "${feedbackText}"

Respond ONLY with valid JSON: {"name": string, "oneLiner": string, "coreProblem": string, "targetAudience": string, "coreFeature": string, "monetization": string, "competitiveEdge": string, "fullDescription": string}.

fullDescription is the final polished pitch description for this REVISED idea — it should read as ONE confident, cohesive pitch, not a before/after comparison or a changelog. Write 2 to 4 cohesive paragraphs of real prose: what it is, who it's for, why it matters, why it's positioned to make money. Never reference "feedback," "the previous version," or "changes" — just write the pitch for the idea as it now stands, with the same craft as if this were the only thing you were writing.`;

  const core = await callMistral([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Revise the idea now, incorporating the feedback above.' }
  ], 1200);

  return {
    ...core,
    competitors: currentIdea?.competitors || [],
    solutions: currentIdea?.solutions || []
  };
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

    // Resolved ONCE here and stored on the session below — every later
    // question in this session reuses this same match, never re-resolved.
    const match = await matchNicheToTemplate(nicheLabel);
    const firstTemplateReference = getTemplateReference(match.key, 0);

    const firstQuestion = await generateIdeationQuestion(nicheLabel, IDEATION_SCAFFOLD[0].intent, [], firstTemplateReference, match.confidence);

    const { data: session, error } = await supabase
      .from('ideation_sessions')
      .insert({
        blueprint_id: blueprint.id,
        niche_label: nicheLabel,
        answers: [],
        pending_question: firstQuestion,
        status: 'in_progress',
        matched_template_key: match.key,
        match_confidence: match.confidence
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
    const nextTemplateReference = getTemplateReference(session.matched_template_key, updatedAnswers.length);
    const nextQuestion = await generateIdeationQuestion(session.niche_label, nextSlot.intent, updatedAnswers, nextTemplateReference, session.match_confidence);

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

// ---- Confirmation flow routes — see the pipeline functions above ----

// Starts a confirmation session anchored to ONE specific 7-node canvas
// path (sourceOptionId is the option that spawned the "Ready to Generate
// Ideas" terminal card) — not the blueprint's root niche, which is what
// the 45Q flow above uses. Synthesizes a real idea draft from the full
// path, then generates confirmation question 1.
app.post('/blueprints/:id/confirm/start', requireAuth, async (req, res) => {
  try {
    const blueprint = await getOwnedBlueprint(req.params.id, req.user.id);
    if(!blueprint) return res.status(404).json({ error: 'Blueprint not found.' });

    const { sourceOptionId } = req.body;
    if(!sourceOptionId) return res.status(400).json({ error: 'sourceOptionId is required.' });

    // This exact 7-node terminal click may have already been hardened
    // before — clicking "Generate Ideas" again on the SAME path shouldn't
    // burn another idea-draft synthesis, another 3 confirmation questions,
    // or (if it got that far) another full research pipeline. Once
    // generated, it's generated; this just hands back what's already
    // there instead of redoing real work.
    const { data: existingSession } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('source_option_id', sourceOptionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if(existingSession?.status === 'completed'){
      return res.status(200).json({
        sessionId: existingSession.id,
        status: 'completed',
        progress: { current: existingSession.answers.length, total: CONFIRMATION_QUESTION_COUNT },
        result: existingSession.result,
        deeperAnalysis: existingSession.deeper_analysis || null,
        rewrittenIdea: existingSession.rewritten_idea || null,
        deeperAnalysisFixes: existingSession.deeper_analysis_fixes || null,
        buildBrief: existingSession.build_brief || null,
        shareToken: existingSession.share_token || null,
        pendingRevision: existingSession.pending_revision || null
      });
    }

    if(existingSession && existingSession.status === 'in_progress' && existingSession.pending_question){
      return res.status(200).json({
        sessionId: existingSession.id,
        status: 'in_progress',
        progress: { current: existingSession.answers.length + 1, total: CONFIRMATION_QUESTION_COUNT },
        question: existingSession.pending_question,
        ideaDraft: existingSession.idea_draft || null
      });
    }

    const pathContext = await buildPathContextFromOption(sourceOptionId);

    // The frontend only ever shows the "Generate Ideas" button once a path
    // hits PATH_DEPTH_CAP (15) — but that's a client-side fact, not a
    // server-side guarantee. Enforcing it here too means calling this
    // endpoint directly can't skip ahead of a path that hasn't actually
    // earned it yet.
    if(pathContext.length < PATH_DEPTH_CAP){
      return res.status(400).json({ error: `This path needs to be ${PATH_DEPTH_CAP} nodes deep before an idea can be hardened — it's currently ${pathContext.length}.` });
    }

    const pathSummary = pathContext.map(p => `${p.groupLabel}: ${p.optionLabel}`).join(' → ');

    const ideaDraft = await synthesizeIdeaDraftFromPath(pathSummary);
    const firstQuestion = await generateConfirmationQuestion(ideaDraft, pathSummary, []);

    const { data: session, error } = await supabase
      .from('confirmation_sessions')
      .insert({
        blueprint_id: blueprint.id,
        source_option_id: sourceOptionId,
        idea_draft: ideaDraft,
        path_summary: pathSummary,
        answers: [],
        pending_question: firstQuestion,
        status: 'in_progress'
      })
      .select()
      .single();

    if(error) throw error;

    res.status(201).json({
      sessionId: session.id,
      status: 'in_progress',
      progress: { current: 1, total: CONFIRMATION_QUESTION_COUNT },
      question: firstQuestion,
      ideaDraft
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not start idea confirmation.', detail: err.message });
  }
});

// Records the answer to whatever confirmation question is pending. After
// the 3rd, runs the full deep-dive pipeline: competitive research (real
// search if SEARCH_API_KEY is set, model knowledge otherwise), pros
// adopted, cons solved, then the final hardened idea.
app.post('/confirm/:sessionId/answer', requireAuth, async (req, res) => {
  try {
    const { selectedOption } = req.body;
    if(!selectedOption) return res.status(400).json({ error: 'selectedOption is required.' });

    const { data: session } = await supabase
      .from('confirmation_sessions')
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

    const isLastAnswer = updatedAnswers.length >= CONFIRMATION_QUESTION_COUNT;

    if(isLastAnswer){
      // The final answer kicks off the full competitive research pipeline:
      // webSearchForSimilarProducts + researchCompetitiveLandscape (Mistral)
      // + synthesizeSolutionsFromCons (Mistral) + synthesizeFinalIdea
      // (Mistral) — three sequential AI calls that can take 20-40 seconds
      // total, which reliably hits Render's 30-second HTTP request timeout.
      //
      // SSE keeps the connection alive indefinitely. The client already
      // shows a dedicated "doing deep research" UI for this step; progress
      // events here let it show what phase is actually running instead of
      // just a spinner with no feedback at all.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      function sendProgress(message){
        if(!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'progress', message })}\n\n`);
      }
      function sendDone(payload){
        if(!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`);
      }
      function sendError(error){
        if(!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
      }

      // Heartbeat every 10s — Render (and most proxies) drop idle SSE
      // connections that send nothing for >30s, so this keeps the pipe
      // open while the Mistral calls are in flight.
      const heartbeat = setInterval(() => {
        if(!res.writableEnded) res.write(': heartbeat\n\n');
      }, 10000);

      try {
        sendProgress('Researching what already exists in this space…');
        const competitiveLandscape = await researchCompetitiveLandscape(session.idea_draft, session.path_summary, updatedAnswers);

        sendProgress('Identifying how to address competitor weaknesses…');
        const solvedProblems = await synthesizeSolutionsFromCons(competitiveLandscape);

        sendProgress('Synthesizing your final hardened idea…');
        const finalIdea = await synthesizeFinalIdea(session.idea_draft, session.path_summary, updatedAnswers, competitiveLandscape, solvedProblems);

        await supabase.from('confirmation_sessions').update({
          answers: updatedAnswers,
          status: 'completed',
          result: finalIdea,
          pending_question: null
        }).eq('id', session.id);

        sendDone({
          status: 'completed',
          progress: { current: updatedAnswers.length, total: CONFIRMATION_QUESTION_COUNT },
          result: finalIdea
        });
        res.end();
      } catch (pipelineErr) {
        sendError('Could not complete the deep research pipeline. ' + pipelineErr.message);
        res.end();
      } finally {
        clearInterval(heartbeat);
      }
      return;
    }

    // Questions 1–3: fast (one generation call, no risk of timeout) — stay
    // as regular JSON so no client changes needed for the non-final flow.
    const nextQuestion = await generateConfirmationQuestion(session.idea_draft, session.path_summary, updatedAnswers);

    await supabase.from('confirmation_sessions').update({
      answers: updatedAnswers,
      pending_question: nextQuestion
    }).eq('id', session.id);

    res.status(200).json({
      status: 'in_progress',
      progress: { current: updatedAnswers.length + 1, total: CONFIRMATION_QUESTION_COUNT },
      question: nextQuestion
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not submit that confirmation answer.', detail: err.message });
  }
});

// Backs the "Let AI Answer" button — picks an answer on the person's
// behalf, but does NOT submit it. The frontend gets the picked text back
// and then calls the normal /answer route with it, exactly as if a
// person had clicked that option themselves — this route only ever does
// the picking, so the actual recording/progression logic never needs
// duplicating between a human path and an AI-decided path.
app.post('/confirm/:sessionId/answer-for-me', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.pending_question){
      return res.status(400).json({ error: 'No question is currently pending on this session.' });
    }

    const selected = await pickBestConfirmationAnswer(session.pending_question, session.idea_draft, session.path_summary);

    res.status(200).json({ selected });
  } catch (err) {
    res.status(500).json({ error: 'Could not pick an answer.', detail: err.message });
  }
});

// Resumes a confirmation session on page reload, same pattern as the 45Q
// resume route above.
app.get('/confirm/:sessionId', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    res.status(200).json({
      sessionId: session.id,
      status: session.status,
      progress: {
        current: session.status === 'completed' ? session.answers.length : session.answers.length + 1,
        total: CONFIRMATION_QUESTION_COUNT
      },
      question: session.pending_question,
      ideaDraft: session.idea_draft || null,
      result: session.result,
      deeperAnalysis: session.deeper_analysis || null,
      rewrittenIdea: session.rewritten_idea || null,
      deeperAnalysisFixes: session.deeper_analysis_fixes || null,
      buildBrief: session.build_brief || null,
      shareToken: session.share_token || null,
      pendingRevision: session.pending_revision || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load that confirmation session.', detail: err.message });
  }
});

// The NEXT phase, triggered from the result screen once an idea is
// already hardened — Market Intel -> Synthetic Panel -> Risk-Prioritized
// Plan, run sequentially since stage 3 depends on what stages 1 and 2
// actually found. Idempotent: if this has already run for this session,
// it just returns the stored result instead of burning more searches and
// Mistral calls re-doing identical work.
app.post('/confirm/:sessionId/deeper-analysis', requireAuth, async (req, res) => {
  try {
    if(await requireProOrReject(req, res)) return;

    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(session.status !== 'completed' || !session.result){
      return res.status(400).json({ error: 'This idea needs to finish hardening before deeper analysis can run.' });
    }

    if(session.deeper_analysis){
      return res.status(200).json({ deeperAnalysis: session.deeper_analysis });
    }

    // marketIntel and syntheticPanel are genuinely independent of each
    // other — neither's input depends on the other's output, both only
    // ever take session.result/path_summary. Running them sequentially
    // was paying for the SUM of both calls' latency for no real reason;
    // Promise.all here means this step only ever takes as long as the
    // slower of the two, not both added together. riskPlan still runs
    // after, since it genuinely depends on what both of these found —
    // that dependency is real and can't be removed the same way.
    const [marketIntel, syntheticPanel] = await Promise.all([
      gatherDeeperMarketIntel(session.result),
      generateSyntheticPanel(session.result, session.path_summary)
    ]);
    const riskPlan = await generateRiskPrioritizedPlan(session.result, marketIntel, syntheticPanel);

    const deeperAnalysis = { marketIntel, syntheticPanel, riskPlan };

    await supabase.from('confirmation_sessions').update({ deeper_analysis: deeperAnalysis }).eq('id', session.id);

    res.status(200).json({ deeperAnalysis });
  } catch (err) {
    res.status(500).json({ error: 'Could not run deeper analysis.', detail: err.message });
  }
});

// Triggered from the very end of the deeper-analysis results. Used to
// regenerate the whole idea here — renamed from /rewrite because it no
// longer does that. The idea itself stays exactly as it is; this
// generates concrete fixes for the specific risks and objections the
// deeper analysis actually found. Idempotent like the route above: a
// duplicate click returns the existing fixes instead of burning another
// Mistral call redoing identical work.
app.post('/confirm/:sessionId/deeper-fixes', requireAuth, async (req, res) => {
  try {
    if(await requireProOrReject(req, res)) return;

    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.result){
      return res.status(400).json({ error: 'This idea needs to finish hardening before fixes can be generated.' });
    }

    if(!session.deeper_analysis){
      return res.status(400).json({ error: "Run Market Intel & Risk Analysis first — there's nothing to generate fixes from yet." });
    }

    if(session.deeper_analysis_fixes){
      return res.status(200).json({ fixes: session.deeper_analysis_fixes });
    }

    const currentIdea = session.rewritten_idea || session.result;
    const fixesResult = await generateDeeperAnalysisFixes(currentIdea, session.deeper_analysis);
    const fixes = fixesResult.fixes || [];

    await supabase.from('confirmation_sessions').update({ deeper_analysis_fixes: fixes }).eq('id', session.id);

    res.status(200).json({ fixes });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate fixes.', detail: err.message });
  }
});

// Idempotent like deeper-analysis/rewrite above — generated once,
// cached, returned from cache on any repeat request. Always built from
// whichever idea is currently "live" (the rewritten version if one
// exists, the original hardened idea otherwise) — never the stale
// original once a rewrite has superseded it.
app.post('/confirm/:sessionId/build-brief', requireAuth, async (req, res) => {
  try {
    if(await requireProOrReject(req, res)) return;

    const { regenerate } = req.body || {};

    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.result){
      return res.status(400).json({ error: 'This idea needs to finish hardening before a build brief can be generated.' });
    }

    if(session.build_brief && !regenerate){
      return res.status(200).json({ buildBrief: session.build_brief });
    }

    const currentIdea = session.rewritten_idea || session.result;
    const buildBrief = await generateBuildBrief(currentIdea, session.path_summary, session.deeper_analysis);

    await supabase.from('confirmation_sessions').update({ build_brief: buildBrief }).eq('id', session.id);

    res.status(200).json({ buildBrief });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate the build brief.', detail: err.message });
  }
});

// Generates (once — idempotent the same way) a random, unguessable token
// for the public one-pager view, so a session's real id never needs to
// be exposed for sharing to work. Returns the same token on any repeat
// click rather than rotating it, since rotating would silently break any
// link already sent out.
app.post('/confirm/:sessionId/share', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.result){
      return res.status(400).json({ error: 'This idea needs to finish hardening before it can be shared.' });
    }

    if(session.share_token){
      return res.status(200).json({ shareToken: session.share_token });
    }

    const shareToken = crypto.randomBytes(24).toString('hex');
    await supabase.from('confirmation_sessions').update({ share_token: shareToken }).eq('id', session.id);

    res.status(200).json({ shareToken });
  } catch (err) {
    res.status(500).json({ error: 'Could not create a shareable link.', detail: err.message });
  }
});

// Deliberately public — no requireAuth. This is the whole point: anyone
// holding the link can view the one-pager, no ThinkMaps account needed.
// Looked up by share_token specifically, never by session id, so the
// real session id is never exposed through this route either. Only ever
// returns the clean, presentable subset of the data (the core idea,
// competitors, solutions) — never the deeper-analysis internals like the
// simulated panel or risk plan, which are explicitly labeled as internal
// working notes elsewhere and would need that same context here to not
// be misread by someone outside the tool.
app.get('/share/:token', async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('result, rewritten_idea, path_summary, created_at')
      .eq('share_token', req.params.token)
      .maybeSingle();

    if(!session) return res.status(404).json({ error: 'This link is invalid or has expired.' });

    const idea = session.rewritten_idea || session.result;
    if(!idea) return res.status(404).json({ error: 'This idea is not ready to be shared yet.' });

    res.status(200).json({
      idea: {
        name: idea.name,
        oneLiner: idea.oneLiner,
        coreProblem: idea.coreProblem,
        targetAudience: idea.targetAudience,
        coreFeature: idea.coreFeature,
        monetization: idea.monetization,
        competitiveEdge: idea.competitiveEdge,
        fullDescription: idea.fullDescription,
        competitors: idea.competitors || [],
        solutions: idea.solutions || []
      },
      createdAt: session.created_at
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load this shared idea.', detail: err.message });
  }
});

// Generates a candidate revision from the person's own typed feedback —
// NEVER persisted as the real idea here. Saved to pending_revision
// specifically so it survives a page reload without being confused with
// (or accidentally overwriting) rewritten_idea, the actual current idea.
// Overwrites any earlier pending_revision on purpose: only one preview
// is ever live at a time, and submitting new feedback before committing
// or discarding the last one just means they changed their mind about
// what to ask for, not that both should coexist.
app.post('/confirm/:sessionId/revise', requireAuth, async (req, res) => {
  try {
    if(await requireProOrReject(req, res)) return;

    const { feedback } = req.body;
    if(!feedback || !feedback.trim()){
      return res.status(400).json({ error: 'Feedback text is required.' });
    }

    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.result){
      return res.status(400).json({ error: 'This idea needs to finish hardening before it can be revised.' });
    }

    const currentIdea = session.rewritten_idea || session.result;
    const revisedIdea = await reviseIdeaWithFeedback(currentIdea, feedback.trim());

    const pendingRevision = { feedback: feedback.trim(), idea: revisedIdea };
    await supabase.from('confirmation_sessions').update({ pending_revision: pendingRevision }).eq('id', session.id);

    res.status(200).json({ preview: revisedIdea });
  } catch (err) {
    res.status(500).json({ error: 'Could not revise the idea.', detail: err.message });
  }
});

// Makes a previewed revision permanent. Reads pending_revision from the
// DATABASE rather than trusting whatever idea object the client might
// send — the server is the source of truth for what was actually
// previewed, not the request body.
app.post('/confirm/:sessionId/revise/commit', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    if(!session.pending_revision?.idea){
      return res.status(400).json({ error: 'There is no pending revision to make permanent.' });
    }

    const rewrittenIdea = session.pending_revision.idea;
    await supabase.from('confirmation_sessions').update({ rewritten_idea: rewrittenIdea, pending_revision: null }).eq('id', session.id);

    res.status(200).json({ rewrittenIdea });
  } catch (err) {
    res.status(500).json({ error: 'Could not save the revision.', detail: err.message });
  }
});

// Throws away a previewed revision without touching the real current
// idea at all — returns whatever the current idea already was so the
// frontend can cleanly restore that view without a second fetch.
app.post('/confirm/:sessionId/revise/discard', requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('confirmation_sessions')
      .select('*')
      .eq('id', req.params.sessionId)
      .single();

    if(!session) return res.status(404).json({ error: 'Session not found.' });

    const blueprint = await getOwnedBlueprint(session.blueprint_id, req.user.id);
    if(!blueprint) return res.status(403).json({ error: 'Not your session.' });

    await supabase.from('confirmation_sessions').update({ pending_revision: null }).eq('id', session.id);

    res.status(200).json({ currentIdea: session.rewritten_idea || session.result });
  } catch (err) {
    res.status(500).json({ error: 'Could not discard the revision.', detail: err.message });
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
