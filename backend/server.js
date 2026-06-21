import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// Supabase admin client — service-role, server-side only.
// Used to verify the auth token the frontend sends on every request.
// ============================================================
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Anon-key client — used specifically for signUp/signInWithPassword/refreshSession.
// These are the "public" auth operations; Supabase expects them to run at the anon
// permission level, not the service-role level. The frontend never sees this key.
const supabaseAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================================
// Live research — Reddit, Hacker News, Apple App Store.
// X/Twitter is intentionally excluded: no free API tier as of 2026.
// Google Play reviews are excluded: no official free API exists.
// ============================================================
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_SEARCH_URL = 'https://oauth.reddit.com/search';
const HN_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
const itunesReviewsUrl = (appId, country = 'us') =>
  `https://itunes.apple.com/${country}/rss/customerreviews/id=${appId}/sortby=mostrecent/json`;

let redditToken = null;
let redditTokenExpiry = 0;

async function getRedditToken() {
  if (redditToken && Date.now() < redditTokenExpiry) return redditToken;

  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  try {
    const basicAuth = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(REDDIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': process.env.REDDIT_USER_AGENT || 'thinkmaps/0.1'
      },
      body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
      console.error('[research] Reddit token request failed', res.status);
      return null;
    }

    const data = await res.json();
    redditToken = data.access_token;
    redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return redditToken;
  } catch (err) {
    console.error('[research] Reddit token error', err.message);
    return null;
  }
}

async function searchReddit(query, limit = 8) {
  try {
    const token = await getRedditToken();
    if (!token) return [];

    const url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': process.env.REDDIT_USER_AGENT || 'thinkmaps/0.1'
      }
    });
    if (!res.ok) return [];

    const data = await res.json();
    return (data.data?.children || []).map((child) => ({
      source: 'Reddit',
      title: child.data.title,
      text: (child.data.selftext || '').slice(0, 400),
      url: `https://reddit.com${child.data.permalink}`
    }));
  } catch (err) {
    console.error('[research] Reddit search failed', err.message);
    return [];
  }
}

async function searchHackerNews(query, limit = 8) {
  try {
    const url = `${HN_SEARCH_URL}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return (data.hits || []).map((hit) => ({
      source: 'Hacker News',
      title: hit.title,
      text: hit.story_text ? hit.story_text.slice(0, 400) : '',
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`
    }));
  } catch (err) {
    console.error('[research] HN search failed', err.message);
    return [];
  }
}

async function searchAppStore(query, limit = 5) {
  try {
    const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}&entity=software&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error('[research] App Store search failed', err.message);
    return [];
  }
}

async function getAppStoreReviews(appId, limit = 5) {
  try {
    const res = await fetch(itunesReviewsUrl(appId));
    if (!res.ok) return [];

    const data = await res.json();
    // entry[0] is the app's own metadata, not a review — skip it
    const entries = (data.feed?.entry || []).slice(1, limit + 1);
    return entries.map((entry) => ({
      source: 'App Store review',
      title: entry.title?.label || '',
      text: (entry.content?.label || '').slice(0, 400),
      url: `https://apps.apple.com/app/id${appId}`
    }));
  } catch (err) {
    console.error('[research] App Store reviews failed', err.message);
    return [];
  }
}

// Gathers a combined research bundle for a given niche/topic.
// Every item returned has {source, title, text, url} so the AI step can cite it.
async function gatherResearch(query) {
  const [redditResults, hnResults, apps] = await Promise.all([
    searchReddit(query),
    searchHackerNews(query),
    searchAppStore(query)
  ]);

  const topApps = apps.slice(0, 3);
  const reviewBundles = await Promise.all(topApps.map((app) => getAppStoreReviews(app.trackId)));

  const appNotes = topApps.map((app) => ({
    source: 'App Store listing',
    title: app.trackName,
    text: `Rating ${app.averageUserRating || 'n/a'} (${app.userRatingCount || 0} ratings). ${(app.description || '').slice(0, 300)}`,
    url: app.trackViewUrl
  }));

  return [...redditResults, ...hnResults, ...appNotes, ...reviewBundles.flat()].filter(
    (item) => item.text || item.title
  );
}

// ============================================================
// AI — Mistral handles node/branch generation (lighter, structural).
// Gemini handles research-grounded idea generation (heavier).
// ============================================================
const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const geminiUrl = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;

function stripJsonFence(text) {
  return (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
}

function safeParseJson(text, fallback) {
  try {
    return JSON.parse(stripJsonFence(text));
  } catch (err) {
    console.error('[ai] JSON parse failed:', err.message, '\nRaw (first 500 chars):', (text || '').slice(0, 500));
    return fallback;
  }
}

async function callMistral(systemPrompt, userPrompt) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY is not set');

  const res = await fetch(MISTRAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mistral request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function generateNodeGroups(pathContext) {
  const system = `You are the engine behind ThinkMaps' Blueprint Graph, a visual idea-mapping tool for app builders.
Given the path a user has taken through the graph so far, return 1-3 new group nodes that branch naturally from their latest choice.
Each group has a short label (e.g. "Sub-Niches", "Audience", "Monetization Preferences") and up to 6 short, specific options.
Respond with ONLY raw JSON, no markdown fences, no commentary, in this exact shape:
{"groups":[{"label":"string","options":["string","string"]}]}`;

  const userPrompt =
    !pathContext || pathContext.length === 0
      ? 'This is the very start of a new blueprint. Return one group labeled "Niches" with 6 distinct, promising app niches.'
      : `Path so far (group label: chosen option):\n${pathContext
          .map((p) => `${p.label}: ${p.choice}`)
          .join('\n')}\n\nReturn the next 1-3 group nodes that should branch from the last choice above. Do not repeat group labels already used in the path.`;

  const raw = await callMistral(system, userPrompt);
  const parsed = safeParseJson(raw, { groups: [] });
  return Array.isArray(parsed.groups) ? parsed.groups.slice(0, 3) : [];
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

  const res = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// The scoring framework — 10 categories x 10 questions = 100 total.
// Sent to Gemini as input so it knows what to score; the model only needs
// to return numbers back (not the question text), to keep output compact.
const CATEGORY_FRAMEWORK = [
  {
    name: 'Problem Validation & Pain Severity',
    questions: [
      'How frequently does the target user encounter this problem?',
      'How painful is the problem based on real complaints?',
      'Are users already paying money to work around this problem?',
      'Do users describe the problem unprompted, not just when asked?',
      'Is the problem urgent and time-sensitive, or merely annoying?',
      'How many distinct complaints/quotes support this problem existing?',
      'Does the problem get worse over time if left unsolved?',
      'Is the problem specific enough to solve well, or too broad?',
      'Would solving this change a daily habit, or just a rare event?',
      'Do multiple independent communities report this same problem?'
    ]
  },
  {
    name: 'Market Size & Timing',
    questions: [
      'How large is the addressable audience for this niche?',
      'Is interest in this niche trending up, flat, or down recently?',
      'Is a recent platform, technology, or regulation shift creating opportunity?',
      'Is the niche seasonal, or does demand hold year-round?',
      'Is the target audience itself growing in size?',
      'How many paying customers are needed to hit a meaningful revenue goal?',
      'Is this a global market or geographically constrained?',
      'Are there adjacent markets this idea could expand into later?',
      'Is the timing dependent on a trend that could fade quickly?',
      'Would this have been a good idea two years ago, or is it new now?'
    ]
  },
  {
    name: 'Competitive Landscape',
    questions: [
      'How many direct competitors already serve this exact niche?',
      'What is the most common complaint about existing solutions?',
      'Are competitors well-funded, or mostly small/abandoned projects?',
      'Is there a dominant incumbent that would be hard to displace?',
      'Are existing competitors actively maintained, or stagnant?',
      'What specific gap do users say competitors are missing?',
      'Could a competitor easily copy this idea once it gains traction?',
      'Is there a defensible moat beyond simply "doing it better"?',
      'Are users actively asking for alternatives to existing tools?',
      'How saturated is search/app-store visibility for this category?'
    ]
  },
  {
    name: 'Differentiation & 10x Potential',
    questions: [
      'What single upgrade would make users switch from their current tool?',
      'Is the differentiation a feature, or a fundamentally different approach?',
      'Can the upgrade be explained clearly in one sentence?',
      'Does the upgrade rely on capabilities not widely available a few years ago?',
      'Would the differentiation matter broadly, or only to a tiny edge case?',
      'Is the upgrade something users have explicitly asked for?',
      'Does the differentiation create a habit loop competitors lack?',
      'Is the improvement measurable, or just a vague "better" claim?',
      'Could this differentiation become outdated quickly?',
      'Is the advantage hard to replicate without the same data or context?'
    ]
  },
  {
    name: 'Monetization Viability',
    questions: [
      'Are users already paying for adjacent or partial solutions?',
      'What price point realistically matches the value being delivered?',
      'Does the proposed pricing model fit how this audience actually behaves?',
      'Is the buyer the same person as the user, or a different decision-maker?',
      'What is a rough estimate of customer value over a year?',
      'Is this niche price-sensitive, or willing to pay for time savings?',
      'Could a free tier realistically convert to paid at meaningful rates?',
      'Are there multiple monetizable surfaces, not just one?',
      'Does monetization require scale first, or can it work from user one?',
      'Would the audience see this pricing as fair, or resent it?'
    ]
  },
  {
    name: 'Founder-Market Fit',
    questions: [
      "Does the founder's skill set match what is needed to build this well?",
      'Does the founder have personal experience with this exact problem?',
      'Does the founder have any existing audience in this niche?',
      'Is the founder genuinely excited about this niche long-term?',
      "Does the founder already understand this audience's language?",
      'Is there a credibility gap the founder would need to close?',
      'Does the founder have access to early users to test with?',
      'Is the required time commitment realistic for the founder right now?',
      "Does the founder's risk tolerance match this idea's uncertainty?",
      'Would the founder still want this in a year if growth is slow?'
    ]
  },
  {
    name: 'Technical Build Complexity',
    questions: [
      "Can a functional MVP be built with the founder's current stack?",
      'Does this require novel R&D, or mostly integrating existing tools?',
      'How reliable and affordable are the third-party APIs this depends on?',
      'Does this need real-time, offline, or hardware capability that adds risk?',
      'How much of the MVP is a risky core mechanic versus simple CRUD?',
      'Will this require ongoing data pipelines to stay useful?',
      'Is the data needed to power this accessible, or gated and expensive?',
      'Could a working MVP be built and tested within a few weeks solo?',
      'Does this need many users to be useful, or work fine for just one?',
      'What is the single riskiest unknown that could block shipping?'
    ]
  },
  {
    name: 'Distribution & Go-to-Market',
    questions: [
      'Where does this audience already gather online, specifically?',
      'Is there a natural viral or referral mechanic in the product itself?',
      'Would this launch well on Product Hunt, Reddit, or X?',
      'Is there an existing influencer or community angle to use?',
      'Does this benefit from SEO/content, or is it purely word-of-mouth?',
      'Is paid acquisition viable at this price point?',
      'Could a partnership or integration drive distribution?',
      'Is there a narrow wedge use case to win the first 100 users?',
      'Does the founder have any unfair distribution advantage already?',
      'How long would it realistically take to land the first 10 customers?'
    ]
  },
  {
    name: 'Retention & Engagement Potential',
    questions: [
      'Does the core use case repeat naturally, daily or weekly?',
      'What brings a user back after their first successful use?',
      'Is there a habit trigger tied to the product, like a routine or deadline?',
      'Does value compound over time, or stay flat after first use?',
      'What is the most likely reason a user would churn?',
      'Is there a network or social effect that increases stickiness?',
      'Does this risk being a one-time "use once and done" utility?',
      'Could early engagement be measured with a simple proxy metric?',
      "Is there a natural upgrade path as the user's needs grow?",
      'Would users feel a real loss if this disappeared tomorrow?'
    ]
  },
  {
    name: 'Risk & Regulatory Exposure',
    questions: [
      "Does this touch regulated data, like health, financial, or children's data?",
      'Are there platform policy risks around app store rules or API terms?',
      'Could this face legal exposure around scraped or user-generated content?',
      'Is there dependency risk on one third-party API changing access or price?',
      'Does this require handling payments or sensitive data securely?',
      'Could a larger company plausibly shut this down by changing their API?',
      'Is there reputational risk if the AI gives wrong advice on a sensitive topic?',
      'Does the business model depend on a gray-area practice?',
      'Is there geographic or regulatory variation that complicates launch?',
      'What is the single biggest risk that could kill this idea after launch?'
    ]
  }
];

function frameworkAsPromptText() {
  return CATEGORY_FRAMEWORK.map(
    (cat, i) => `${i + 1}. ${cat.name}\n` + cat.questions.map((q, j) => `   ${j + 1}. ${q}`).join('\n')
  ).join('\n\n');
}

async function generateIdeas(pathContext, researchItems) {
  const pathText = pathContext.map((p) => `${p.label}: ${p.choice}`).join('\n');
  const researchText = researchItems
    .slice(0, 25)
    .map((item, i) => `[${i + 1}] (${item.source}) ${item.title || ''} — ${item.text || ''} ${item.url ? `(${item.url})` : ''}`)
    .join('\n');

  const prompt = `You are ThinkMaps' idea engine. A builder has mapped this path through the Blueprint Graph:
${pathText}

Here is real research gathered live from Reddit, Hacker News, and the App Store for this niche. Use ONLY these items for any quotes or sourced claims — never invent a quote or statistic that is not grounded in the list below:
${researchText || '(no research items were found for this niche — say so honestly in the output rather than inventing sources)'}

Score every idea against this 100-question framework (10 categories, 10 questions each). Give an integer 1-10 score per question, in the same order the questions are listed.
${frameworkAsPromptText()}

Generate exactly 5 distinct, defensible app ideas grounded in the path and research above. Only include quotes that literally appear in the research list (cite by reusing its [n] number), or omit the quote field entirely if nothing fits.

Respond with ONLY raw JSON, no markdown fences, no commentary, in this exact shape:
{
  "ideas": [
    {
      "name": "string",
      "oneLiner": "string",
      "problem": "string",
      "sourcedQuotes": [{"quote":"string","sourceRef":"n or null"}],
      "existingSolutionsWeaknesses": "string",
      "tenXUpgrade": "string",
      "monetization": "string",
      "mvp": "string",
      "riskyCoreMechanic": "string",
      "validationKit": {
        "surveyQuestions": ["string"],
        "interviewScript": ["string"],
        "landingPageCopy": "string",
        "fakeDoorTestGuidance": "string"
      },
      "nextSteps": ["string"],
      "buildPrompt": "string",
      "scores": { "<category name exactly as given above>": [10 integers 1-10] }
    }
  ]
}`;

  const raw = await callGemini(prompt);
  const parsed = safeParseJson(raw, { ideas: [] });
  return Array.isArray(parsed.ideas) ? parsed.ideas.slice(0, 5) : [];
}

// ============================================================
// Express app + routes
// ============================================================
const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '2mb' }));

// Verifies the request carries a valid Supabase auth token and attaches the user to req.user.
async function requireUser(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session' });

  req.user = data.user;
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ============================================================
// Auth — the frontend never talks to Supabase directly. Every
// auth operation is proxied through here instead.
// ============================================================
app.post('/api/auth/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await supabaseAuth.auth.signUp({ email, password });
  if (error) {
    console.error('[POST /api/auth/signup]', error.status, error.message);
    return res.status(400).json({ error: error.message });
  }

  // session is null here if your Supabase project requires email confirmation —
  // that's expected, not a bug. The frontend handles both cases.
  res.json({ session: data.session, user: data.user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('[POST /api/auth/login]', error.status, error.message);
    return res.status(400).json({ error: error.message });
  }

  res.json({ session: data.session, user: data.user });
});

// The frontend calls this automatically when a request comes back 401,
// using the refresh_token it stored at login — no re-login needed hourly.
app.post('/api/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required.' });

  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token });
  if (error) {
    console.error('[POST /api/auth/refresh]', error.status, error.message);
    return res.status(401).json({ error: error.message });
  }

  res.json({ session: data.session, user: data.user });
});

app.get('/api/auth/me', requireUser, async (req, res) => {
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', req.user.id).single();
  res.json({ user: { id: req.user.id, email: req.user.email }, profile: profile || null });
});

// ============================================================
// Blueprints — full CRUD lives here now too. Uses the service-role
// client, so every query explicitly filters by user_id below;
// RLS in Supabase is a second layer of defense, not the only one.
// ============================================================
app.get('/api/blueprints', requireUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('blueprints')
    .select('id, title, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load blueprints.' });
  res.json({ blueprints: data || [] });
});

app.get('/api/blueprints/:id', requireUser, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('blueprints')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Blueprint not found.' });
  res.json({ blueprint: data });
});

// Creates a blueprint AND seeds its root "Niches" group in one call —
// the frontend doesn't need to make two round trips for this anymore.
app.post('/api/blueprints', requireUser, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', req.user.id).single();

    if (!profile?.is_pro) {
      const { count } = await supabaseAdmin
        .from('blueprints')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id);

      if ((count || 0) >= 1) {
        return res.status(403).json({ error: 'Free tier allows 1 blueprint — upgrade to Pro for unlimited.' });
      }
    }

    const groups = await generateNodeGroups([]);
    const rootGroup = groups[0] || { label: 'Niches', options: [] };
    const rootId = 'root';
    const graph_data = {
      rootId,
      nodesById: {
        [rootId]: {
          id: rootId,
          label: rootGroup.label,
          options: (rootGroup.options || []).map((text, i) => ({ id: `${rootId}-opt-${i}`, text })),
          selectedOptionId: null,
          frozenOptionIds: [],
          children: {},
          x: 80,
          y: 220
        }
      }
    };

    const { data, error } = await supabaseAdmin
      .from('blueprints')
      .insert({ user_id: req.user.id, title: req.body?.title || 'Untitled blueprint', graph_data })
      .select()
      .single();

    if (error) throw error;
    res.json({ blueprint: data });
  } catch (err) {
    console.error('[POST /api/blueprints]', err.message);
    res.status(500).json({ error: 'Could not create a new blueprint right now.' });
  }
});

app.patch('/api/blueprints/:id', requireUser, async (req, res) => {
  const allowed = { updated_at: new Date().toISOString() };
  if (req.body.graph_data !== undefined) allowed.graph_data = req.body.graph_data;
  if (req.body.ideas !== undefined) allowed.ideas = req.body.ideas;
  if (req.body.title !== undefined) allowed.title = req.body.title;

  const { data, error } = await supabaseAdmin
    .from('blueprints')
    .update(allowed)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Blueprint not found.' });
  res.json({ blueprint: data });
});

// Lets the frontend render the 100-question framework (axis labels, expandable detail)
// without duplicating all the question text in two codebases.
app.get('/api/framework', (req, res) => {
  res.json({ framework: CATEGORY_FRAMEWORK });
});

// Generates the next group(s) of nodes for a Blueprint Graph branch.
app.post('/api/generate-nodes', requireUser, async (req, res) => {
  try {
    const { pathContext } = req.body;
    const groups = await generateNodeGroups(Array.isArray(pathContext) ? pathContext : []);
    res.json({ groups });
  } catch (err) {
    console.error('[POST /api/generate-nodes]', err.message);
    res.status(500).json({ error: 'Could not generate node groups right now.' });
  }
});

// Gathers live research and generates 5 research-grounded app ideas for a finished path.
app.post('/api/generate-ideas', requireUser, async (req, res) => {
  try {
    const { pathContext } = req.body;
    if (!Array.isArray(pathContext) || pathContext.length === 0) {
      return res.status(400).json({ error: 'pathContext is required' });
    }

    const niche = pathContext[0]?.choice || pathContext[pathContext.length - 1]?.choice;
    const research = await gatherResearch(niche);
    const ideas = await generateIdeas(pathContext, research);

    res.json({ ideas, researchCount: research.length });
  } catch (err) {
    console.error('[POST /api/generate-ideas]', err.message);
    res.status(500).json({ error: 'Could not generate ideas right now.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`ThinkMaps backend listening on port ${PORT}`);
});

// Keeps a free Render instance awake with a gentle self-ping (every 13 minutes,
// comfortably under Render's 15-minute sleep timer without hammering the service).
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/api/health`).catch(() => {});
  }, 13 * 60 * 1000);
}
