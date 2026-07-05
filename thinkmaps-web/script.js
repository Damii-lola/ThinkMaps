// ThinkMaps — single shared frontend script.
// Every page (index, auth, dashboard, app) loads this file.
// It checks what's actually on the page and runs the matching logic.
// All backend calls go through API_BASE_URL, pointed at the Render service.

const API_BASE_URL = 'https://thinkmaps.onrender.com';
// Real Pro upgrade path — the actual payment happens on Selar, and the
// upgrade itself is applied by the inbox check in server.js once a
// payment completes, matched back to a ThinkMaps account by email. This
// link is the only thing the frontend needs to know about payment at all.
const PAYMENT_URL = 'https://selar.com/130n178z3r';

// Supabase client setup — the URL and anon key are NOT hardcoded here.
// They're fetched from server.js's /config route, which reads them from
// Render's env vars. Both values are public-safe (RLS does the real protecting),
// this is purely about keeping literal strings out of the public repo.
let supabaseClient = null;
let supabaseConfigPromise = null;

async function getSupabaseClient(){
  if(supabaseClient) return supabaseClient;

  if(!supabaseConfigPromise){
    // sessionStorage survives page-to-page navigation in the same tab —
    // so once /config is fetched once (e.g. during sign-in), moving to
    // dashboard.html or app.html skips that network round trip entirely.
    const cached = sessionStorage.getItem('thinkmaps_supabase_config');

    if(cached){
      supabaseConfigPromise = Promise.resolve(JSON.parse(cached));
    } else {
      supabaseConfigPromise = fetch(`${API_BASE_URL}/config`)
        .then(res => res.json())
        .then(config => {
          sessionStorage.setItem('thinkmaps_supabase_config', JSON.stringify(config));
          return config;
        });
    }
  }

  const { supabaseUrl, supabaseAnonKey } = await supabaseConfigPromise;
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

document.addEventListener('DOMContentLoaded', () => {
  checkBackendStatus();
  initGraphDemo();
  initAuthPage();
  initDashboardPage();
  initNavAuthState();
  initPricingSection();
  initAppPage();
  initIdeatePage();
  initConfirmPage();
  initSettingsPage();
  initPasswordToggles();
});

// ---------- Show/hide password toggle ----------
// Event delegation on document, not per-button listeners — works
// identically whether the button exists at page load (auth.html,
// settings.html) or gets added later dynamically, with zero extra wiring
// needed anywhere a new password field shows up in the future.
function initPasswordToggles(){
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.password-toggle-btn');
    if(!btn) return;

    const input = document.getElementById(btn.dataset.target);
    if(!input) return;

    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '🙈' : '👁';
    btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
}

// ---------- BACKEND CONNECTION ----------
// Pings the Render API on load and reflects the result in the footer status pill.
// Doubles as a soft wake-up call for Render's free tier if the service has gone idle.
async function checkBackendStatus(){
  const statusEl = document.getElementById('apiStatus');
  if(!statusEl) return; // page doesn't have the status pill — nothing to do

  const label = statusEl.querySelector('.label');

  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if(!res.ok) throw new Error(`Health check failed: ${res.status}`);

    statusEl.classList.remove('offline');
    statusEl.classList.add('online');
    if(label) label.textContent = 'API connected';
  } catch (err){
    statusEl.classList.remove('online');
    statusEl.classList.add('offline');
    if(label) label.textContent = 'API offline — retrying on next visit';
    console.warn('ThinkMaps API unreachable:', err.message);
  }
}

// ---------- HOMEPAGE GRAPH DEMO ----------
// Illustrative only — sample data, not connected to the backend.
// Skips entirely on pages that don't have the demo markup (auth, dashboard, app).
function initGraphDemo(){
  const canvas = document.getElementById('graphCanvas');
  if(!canvas) return;

  const nicheData = {
    fitness: { label:"Fitness", children:[
      {k:"Sub-niche", v:"Recovery &amp; sleep tracking"},
      {k:"Audience", v:"Shift workers"},
      {k:"Monetization", v:"Subscription + wearables"}
    ]},
    finance: { label:"Finance & Commerce", children:[
      {k:"Sub-niche", v:"Cash-flow visualization"},
      {k:"Audience", v:"Freelancers"},
      {k:"Monetization", v:"Freemium → Pro tier"}
    ]},
    productivity: { label:"Productivity", children:[
      {k:"Sub-niche", v:"Async team rituals"},
      {k:"Audience", v:"Remote managers"},
      {k:"Monetization", v:"Per-seat pricing"}
    ]},
    entertainment: { label:"Entertainment", children:[
      {k:"Sub-niche", v:"Local live-show discovery"},
      {k:"Audience", v:"College students"},
      {k:"Monetization", v:"Ticketing commission"}
    ]}
  };

  const linesSvg = document.getElementById('graphLines');
  const rootRow = document.getElementById('rootRow');
  const childRow = document.getElementById('childRow');
  const frozenLane = document.getElementById('frozenLane');
  const caption = document.getElementById('graphCaption');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let activeNiche = null;
  const frozen = []; // niche keys explored before the current one

  function clearChildren(){
    childRow.innerHTML = '';
    linesSvg.innerHTML = '';
  }

  function renderFrozenLane(){
    frozenLane.innerHTML = '';
    frozen.forEach(key => {
      const data = nicheData[key];
      const btn = document.createElement('button');
      btn.className = 'frozen-pill';
      btn.innerHTML = data.label + ' <span>→</span> ' + data.children[1].v;
      btn.addEventListener('click', () => selectNiche(key));
      frozenLane.appendChild(btn);
    });
  }

  function drawLines(rootBtn, cards){
    linesSvg.innerHTML = '';
    const canvasRect = canvas.getBoundingClientRect();
    const rootRect = rootBtn.getBoundingClientRect();
    const startX = rootRect.left + rootRect.width/2 - canvasRect.left;
    const startY = rootRect.bottom - canvasRect.top;

    cards.forEach(card => {
      const r = card.getBoundingClientRect();
      const endX = r.left + r.width/2 - canvasRect.left;
      const endY = r.top - canvasRect.top;
      const midY = (startY + endY) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`);
      linesSvg.appendChild(path);

      if(!reduceMotion){
        const len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.style.transition = 'stroke-dashoffset .5s ease';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          path.style.strokeDashoffset = '0';
        }));
      }
    });
  }

  function selectNiche(key){
    if(key === activeNiche) return;

    if(activeNiche && !frozen.includes(activeNiche)){
      frozen.unshift(activeNiche);
      if(frozen.length > 3) frozen.pop();
    }
    const idx = frozen.indexOf(key);
    if(idx > -1) frozen.splice(idx, 1);

    activeNiche = key;
    renderFrozenLane();

    rootRow.querySelectorAll('.node-pill').forEach(p => {
      const isActive = p.dataset.niche === key;
      p.classList.toggle('active', isActive);
      p.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    clearChildren();
    const data = nicheData[key];
    const cards = data.children.map(c => {
      const card = document.createElement('div');
      card.className = 'child-card';
      card.innerHTML = `<div class="k">${c.k}</div><div class="v">${c.v}</div>`;
      childRow.appendChild(card);
      return card;
    });

    caption.textContent = `Branching from "${data.label}" — pick another niche above and this one freezes, not gone.`;

    requestAnimationFrame(() => {
      cards.forEach((card, i) => {
        setTimeout(() => card.classList.add('in'), reduceMotion ? 0 : i * 90);
      });
      drawLines(rootRow.querySelector(`[data-niche="${key}"]`), cards);
    });
  }

  rootRow.querySelectorAll('.node-pill').forEach(btn => {
    btn.addEventListener('click', () => selectNiche(btn.dataset.niche));
  });

  window.addEventListener('resize', () => {
    if(!activeNiche) return;
    const cards = Array.from(childRow.querySelectorAll('.child-card'));
    drawLines(rootRow.querySelector(`[data-niche="${activeNiche}"]`), cards);
  });

  // open with Fitness pre-branched so the mechanic is visible immediately
  selectNiche('fitness');
}

// ---------- AUTH PAGE ----------
// Skips entirely on pages without the sign-in/sign-up/OTP forms.
// Both signup AND login now require a one-time code sent via otp.dev
// before any session is ever issued — Supabase's own email-confirmation
// link flow is fully bypassed (see server.js's /auth/signup-verify,
// which creates the account with email_confirm: true).
//
// Signup: form details go to /auth/signup-start (nothing created yet,
// held server-side in memory) -> OTP screen -> /auth/signup-verify
// actually creates the Supabase user -> back to the sign-in tab.
//
// Login: /auth/login-start checks the password via Supabase Auth FIRST,
// then sends an OTP and holds the resulting session server-side ->
// OTP screen -> /auth/login-verify hands back the real access/refresh
// tokens, which get applied via supabase.auth.setSession().
function initAuthPage(){
  const signinForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');
  const otpForm = document.getElementById('otpForm');
  if(!signinForm && !signupForm && !otpForm) return;

  // Old confirmation-link redirects could still land here with a stale
  // hash — nothing to do with it now, just clear it.
  if(window.location.hash.includes('access_token')){
    history.replaceState(null, '', window.location.pathname);
  }

  // Tab switching between Sign in / Create account
  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      document.getElementById(`${tab.dataset.tab}Form`).classList.add('active');
    });
  });

  if(signinForm) signinForm.addEventListener('submit', handleSignInStart);
  if(signupForm) signupForm.addEventListener('submit', handleSignUpStart);
  if(otpForm) otpForm.addEventListener('submit', handleOtpSubmit);

  const otpResendBtn = document.getElementById('otpResendBtn');
  if(otpResendBtn) otpResendBtn.addEventListener('click', handleOtpResend);
}

// Tracks which flow ('signup' or 'login') the currently-showing OTP
// screen belongs to, plus the email it's for — set right before the
// OTP screen is shown, read when the OTP form submits. Module-level on
// purpose: the OTP screen is a single shared step for both flows, so
// this is the one place that distinguishes which server route to call.
const otpState = { mode: null, email: null };

function showOtpScreen(email, mode){
  otpState.mode = mode;
  otpState.email = email;

  document.getElementById('signinForm')?.classList.remove('active');
  document.getElementById('signupForm')?.classList.remove('active');
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));

  const otpForm = document.getElementById('otpForm');
  const otpEmailLabel = document.getElementById('otpEmailLabel');
  const otpError = document.getElementById('otpError');
  const otpInput = document.getElementById('otpCodeInput');

  if(otpError) otpError.textContent = '';
  if(otpEmailLabel) otpEmailLabel.textContent = email;
  if(otpInput) otpInput.value = '';
  if(otpForm){
    otpForm.classList.add('active');
    otpInput?.focus();
  }
}

async function handleSignUpStart(e){
  e.preventDefault();
  const errorEl = document.getElementById('signupError');
  errorEl.textContent = '';

  const email = document.getElementById('signupEmail').value.trim();
  const username = document.getElementById('signupUsername').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirmPassword = document.getElementById('signupPasswordConfirm').value;

  if(password !== confirmPassword){
    errorEl.textContent = 'Passwords don\'t match.';
    return;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/auth/signup-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    const body = await res.json();

    if(!res.ok){
      errorEl.textContent = body.detail ? `${body.error} (${body.detail})` : (body.error || 'Could not start signup.');
      return;
    }

    showOtpScreen(email, 'signup');
  } catch (err){
    errorEl.textContent = 'Could not reach the server. Try again.';
  }
}

async function handleSignInStart(e){
  e.preventDefault();
  const errorEl = document.getElementById('signinError');
  errorEl.textContent = '';

  const identifier = document.getElementById('signinIdentifier').value.trim();
  const password = document.getElementById('signinPassword').value;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/login-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const body = await res.json();

    if(!res.ok){
      errorEl.textContent = body.detail ? `${body.error} (${body.detail})` : (body.error || 'Could not sign in.');
      return;
    }

    if(body.graceLogin){
      // Account created less than 10 minutes ago — server already
      // decided OTP isn't needed this once, hands back a real session
      // directly instead of the "sent" acknowledgment that would
      // normally trigger the OTP screen.
      const sb = await getSupabaseClient();
      const { error: setError } = await sb.auth.setSession({
        access_token: body.accessToken,
        refresh_token: body.refreshToken
      });
      if(setError){
        errorEl.textContent = 'Could not start your session. Try signing in again.';
        return;
      }
      window.location.href = 'dashboard.html';
      return;
    }

    showOtpScreen(body.email, 'login');
  } catch (err){
    errorEl.textContent = 'Could not reach the server. Try again.';
  }
}

async function handleOtpResend(e){
  e.preventDefault();
  const btn = document.getElementById('otpResendBtn');
  const errorEl = document.getElementById('otpError');
  if(errorEl) errorEl.textContent = '';

  if(btn){
    btn.disabled = true;
    btn.textContent = 'Sending…';
  }

  try {
    // Re-runs the exact same "start" step this OTP screen originally came
    // from — the form it came from is hidden, not reset, so the fields
    // it needs are still sitting right there.
    if(otpState.mode === 'signup'){
      const email = document.getElementById('signupEmail').value.trim();
      const username = document.getElementById('signupUsername').value.trim();
      const password = document.getElementById('signupPassword').value;
      const res = await fetch(`${API_BASE_URL}/auth/signup-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password })
      });
      const body = await res.json();
      if(!res.ok) throw new Error(body.error || 'Could not resend code.');
    } else {
      const identifier = document.getElementById('signinIdentifier').value.trim();
      const password = document.getElementById('signinPassword').value;
      const res = await fetch(`${API_BASE_URL}/auth/login-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const body = await res.json();
      if(!res.ok) throw new Error(body.error || 'Could not resend code.');
    }

    if(btn) btn.textContent = 'Code sent!';
  } catch (err){
    if(errorEl) errorEl.textContent = err.message || 'Could not resend the code. Try again.';
    if(btn) btn.textContent = 'Resend code';
  } finally {
    // Brief cooldown so the resend button can't be hammered — otp.dev
    // rate limits aside, this is just a sane UX floor on top of that.
    setTimeout(() => {
      if(btn){ btn.disabled = false; if(btn.textContent !== 'Resend code') btn.textContent = 'Resend code'; }
    }, 15000);
  }
}

async function handleOtpSubmit(e){
  e.preventDefault();
  const errorEl = document.getElementById('otpError');
  errorEl.textContent = '';

  const code = document.getElementById('otpCodeInput').value.trim();
  if(!code){
    errorEl.textContent = 'Enter the code we sent you.';
    return;
  }

  const endpoint = otpState.mode === 'signup' ? '/auth/signup-verify' : '/auth/login-verify';

  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otpState.email, code })
    });
    const body = await res.json();

    if(!res.ok){
      errorEl.textContent = body.detail ? `${body.error} (${body.detail})` : (body.error || 'Could not verify that code.');
      return;
    }

    if(otpState.mode === 'signup'){
      // Account now exists and is confirmed — send them to sign in
      // with the password they just chose, same as before this OTP
      // flow existed, just without a confirmation-link email in between.
      document.getElementById('otpForm')?.classList.remove('active');
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      const tabs = document.querySelectorAll('.auth-tab');
      tabs.forEach(t => t.classList.remove('active'));
      const signinTab = [...tabs].find(t => t.dataset.tab === 'signin');
      signinTab?.classList.add('active');
      document.getElementById('signinForm')?.classList.add('active');
      const banner = document.getElementById('emailConfirmedBanner');
      if(banner) banner.style.display = 'block';
    } else {
      // Login OTP confirmed — apply the real session server.js already
      // signed in with in /auth/login-start, then go to the dashboard.
      const sb = await getSupabaseClient();
      const { error: setError } = await sb.auth.setSession({
        access_token: body.accessToken,
        refresh_token: body.refreshToken
      });
      if(setError){
        errorEl.textContent = 'Verified, but could not start your session. Try signing in again.';
        return;
      }
      window.location.href = 'dashboard.html';
    }
  } catch (err){
    errorEl.textContent = 'Could not reach the server. Try again.';
  }
}

// ---------- SESSION HELPERS ----------
// Shared by any page that needs to know who's logged in (dashboard, app, ...).

async function getActiveSession(){
  const sb = await getSupabaseClient();
  const { data } = await sb.auth.getSession();
  return data.session; // null if nobody's logged in
}

// Sends an authenticated request to server.js, attaching the Supabase access
// token. If there's no session at all, bounces straight to auth.html instead
// of letting a protected page sit there silently broken.
async function authedFetch(path, options = {}){
  const session = await getActiveSession();
  if(!session){
    window.location.href = 'auth.html';
    return null;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...(options.headers || {})
    }
  });

  return res;
}

async function handleLogout(){
  const sb = await getSupabaseClient();
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// ---------- NAV AUTH STATE ----------
// Runs on every page. If a session already exists — Supabase persists
// that across visits by default — two things happen:
//  1. If #navCta exists (currently just index.html), swap "Sign in" /
//     "Start a blueprint" for a single "Dashboard" link.
//  2. EVERY other link pointing at auth.html anywhere on the page (hero
//     CTA, pricing buttons, the closing CTA band — any of them) gets
//     retargeted straight to the dashboard too. This used to only cover
//     the nav button: someone already signed in who clicked "Start your
//     blueprint for free" in the hero, or either pricing button, or the
//     closing CTA, still got sent to the sign-in screen — a real bug, not
//     just a missed nav-bar nicety, since auth.html was never going to be
//     a useful destination for someone who's already authenticated.
async function initNavAuthState(){
  const session = await getActiveSession();
  if(!session) return;

  const navCta = document.getElementById('navCta');
  if(navCta){
    navCta.innerHTML = `
      <a href="dashboard.html" class="btn btn-primary">Dashboard</a>
      <a href="settings.html" class="user-icon-btn" title="Settings" aria-label="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="19" height="19">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/>
        </svg>
      </a>
    `;
  }

  document.querySelectorAll('a[href="auth.html"]').forEach(a => {
    a.href = 'dashboard.html';
  });
}

// ---------- PRICING SECTION (index.html) ----------
// Only present on index.html (#pricingGrid). Not signed in: both plan
// cards show as static marketing content, "Go Pro" just leads to sign
// up — nothing here needs to run. Signed in: fetches the real pro
// status once, hides the Free card and centers the Pro card if already
// pro (see applyPricingProState), and turns "Go Pro" into a real toggle
// instead of a navigation link — clicking it while signed in upgrades
// (or, if already pro, downgrades — same toggle endpoint both
// directions) right there on the page, never sending anyone to the
// dashboard first.
function closeProFeaturesModal(){
  const overlay = document.getElementById('proFeaturesModal');
  if(overlay) overlay.remove();
}

// The pricing card itself only ever shows a short, digestible summary
// — this is the actual complete list, every Pro feature that exists in
// the app right now, grouped by what part of the workflow it touches.
// Kept in one place specifically so it's the one spot that needs
// updating when a new Pro feature ships, rather than this list quietly
// drifting out of sync with the pricing card's shorter version.
function showProFeaturesModal(){
  closeProFeaturesModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'proFeaturesModal';
  overlay.innerHTML = `
    <div class="modal-card pro-features-modal-card">
      <span class="ptag">Pro — $12/month</span>
      <h3>Everything Pro includes</h3>

      <div class="pro-features-group">
        <div class="pro-features-group-label">Blueprints</div>
        <ul>
          <li>Unlimited blueprints, no edit lock, never deleted</li>
          <li>Delete your own blueprints anytime</li>
          <li>Combine multiple selections into one fused idea</li>
        </ul>
      </div>

      <div class="pro-features-group">
        <div class="pro-features-group-label">A better canvas</div>
        <ul>
          <li>Richer AI generation — more options per click, plus a "why this fits" hint on each one</li>
          <li>Blueprint Snapshots — save and restore named checkpoints of your whole graph</li>
          <li>A premium visual theme for the canvas itself</li>
        </ul>
      </div>

      <div class="pro-features-group">
        <div class="pro-features-group-label">Hardening your idea</div>
        <ul>
          <li>Market Intel &amp; Risk Analysis</li>
          <li>AI-found fixes for surfaced risks</li>
          <li>Detailed Build Brief for your MVP</li>
          <li>Suggest Changes — revise with your own feedback</li>
        </ul>
      </div>

      <div class="pro-features-group">
        <div class="pro-features-group-label">The full idea toolkit</div>
        <ul>
          <li>Idea Strength Score — four honest, specific dimensions</li>
          <li>Pivot Generator — three genuinely different directions</li>
          <li>User Persona Cards</li>
          <li>Landing Page Copy Generator</li>
          <li>Challenge This Idea — a sharp, unbalanced Red Team critique</li>
          <li>Competitor Deep Dive (Spy Mode)</li>
          <li>Launch Checklist — week by week, specific to your idea</li>
        </ul>
      </div>

      <div class="modal-actions pro-features-modal-actions">
        <button class="btn btn-ghost" id="closeProFeaturesModalBtn" type="button">Close</button>
        <a href="auth.html" class="btn btn-primary">Go Pro</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if(e.target === overlay) closeProFeaturesModal(); });
  document.getElementById('closeProFeaturesModalBtn')?.addEventListener('click', closeProFeaturesModal);
}

async function initPricingSection(){
  const grid = document.getElementById('pricingGrid');
  const freeCard = document.getElementById('freePlanCard');
  const goProBtn = document.getElementById('proPlanGoProBtn');
  if(!grid || !freeCard || !goProBtn) return;

  // Wired here, before the session check below — this is purely
  // informational and should work for a logged-out visitor just
  // browsing pricing, not only for someone already signed in.
  const moreBtn = document.getElementById('proPlanMoreBtn');
  if(moreBtn) moreBtn.addEventListener('click', showProFeaturesModal);

  const session = await getActiveSession();
  if(!session) return;

  let isPro = false;
  try {
    const res = await authedFetch('/profile');
    if(res && res.ok){
      const body = await res.json();
      isPro = !!body.pro_status;
    }
  } catch (err) { /* leave isPro false on failure — worst case shows both plans */ }

  applyPricingProState(isPro, freeCard, grid, goProBtn);

  goProBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if(isPro) return; // button is disabled in this state, but guard anyway
    await openPaymentCheckout(session);
  });
}

// Opens the real Selar payment page, with email, username, AND profile
// id all auto-filled — no copying, no typing required in the normal
// case. This works by repurposing one of Selar's CONFIRMED prefillable
// fields (their own docs only confirm email, fullname, mobile, address
// — custom checkout questions are NOT confirmed prefillable, so this
// deliberately doesn't rely on that):
//   - fullname carries "TMUSER <username> <profile_id>" — three
//     space-separated parts. Selar's own "first and last name"
//     validation was confirmed (via a real rejected checkout attempt)
//     to require at least a space in the Name field; it's a reasonable,
//     standard assumption that a validator checking for "contains a
//     space" tolerates more than two words, same as it would for
//     someone with a middle name — but this is genuinely untested
//     beyond that assumption, so if Selar's checkout rejects three
//     words specifically, that's the first thing to check.
// This is what lets a single field carry BOTH signals at once instead
// of needing an address field this checkout type doesn't have — the
// profile id (a UUID) is the single strongest possible match: globally
// unique by construction, so if the backend finds one and it resolves
// to a real account, there's categorically zero ambiguity left. That
// matching logic already existed (see extractProfileIdFromText and
// applyProUpgrade in server.js) — it just had nothing feeding it until
// now, since the earlier address-field plan turned out not to work.
// The still-Required "ThinkMaps UserName" custom question remains as a
// manual backup (Copy button fixed via the execCommand fallback below)
// for the rare case the prefill doesn't propagate through.
// Real tradeoff worth knowing: Selar's own dashboard/receipts will show
// "TMUSER <username> <uuid>" instead of the person's real name, since
// that field gets fully repurposed. For a digital subscription product,
// that's a fair trade for reliable automatic matching — but it IS a
// real tradeoff, not a free lunch.
async function openPaymentCheckout(session){
  const accountEmail = session?.user?.email || '';
  const accountId = session?.user?.id || '';
  let accountUsername = session?.user?.user_metadata?.username || '';

  // Fallback to the authoritative source if it's missing from the
  // session's own metadata for any reason — profiles.username is what
  // the backend actually matches against, so this should never come up
  // truly empty for a real account.
  if(!accountUsername){
    try {
      const res = await authedFetch('/profile');
      if(res && res.ok){
        const body = await res.json();
        accountUsername = body.username || '';
      }
    } catch (err) { /* leave blank — the modal shows a clear message if so */ }
  }

  try {
    await authedFetch('/payment/start-checkout', { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    // Never block checkout over this — worst case, this specific
    // payment falls back to needing an exact match via email, username,
    // or profile id instead of the timing fallback path.
  }

  showCheckoutConfirmationModal(accountEmail, accountUsername, accountId);
}

// Robust clipboard copy — navigator.clipboard.writeText silently fails
// in more contexts than it should (insecure focus state, certain
// browser/extension combinations, some in-app browsers), which is
// exactly what happened in the screenshot that prompted this fix. The
// execCommand('copy') fallback below works in almost everything the
// modern API doesn't, at the cost of being deprecated — perfectly fine
// here since it's just a fallback path, not the primary one.
async function copyTextRobustly(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      const tempInput = document.createElement('textarea');
      tempInput.value = text;
      tempInput.style.position = 'fixed';
      tempInput.style.opacity = '0';
      document.body.appendChild(tempInput);
      tempInput.focus();
      tempInput.select();
      const success = document.execCommand('copy');
      tempInput.remove();
      return success;
    } catch (fallbackErr) {
      return false;
    }
  }
}

function showCheckoutConfirmationModal(accountEmail, accountUsername, accountId){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'checkoutConfirmationModal';
  overlay.innerHTML = `
    <div class="modal-card checkout-confirmation-card">
      <h3>You're all set — nothing to type</h3>
      <p class="muted">Your email is already filled in on the Selar checkout page. The Name field will show something like <strong>TMUSER ${escapeHtml(accountUsername)} ${escapeHtml(accountId)}</strong> — that's intentional, it's how we link your payment back to your account automatically. Please leave it as-is.</p>
      <p class="muted">If checkout also asks for your ThinkMaps username separately, use this (just in case):</p>
      <div class="checkout-username-display">
        <span id="checkoutUsernameValue">${escapeHtml(accountUsername || '(username not found — contact support)')}</span>
        <button type="button" class="btn btn-ghost" id="copyCheckoutUsernameBtn">Copy</button>
      </div>
      <p class="muted checkout-email-note">Email: <strong>${escapeHtml(accountEmail)}</strong> — also already filled in.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelCheckoutBtn" type="button">Cancel</button>
        <button class="btn btn-primary" id="proceedCheckoutBtn" type="button">Continue to Selar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancelCheckoutBtn')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });

  document.getElementById('copyCheckoutUsernameBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const success = await copyTextRobustly(accountUsername);
    const original = btn.textContent;
    btn.textContent = success ? 'Copied!' : 'Select manually';
    setTimeout(() => { btn.textContent = original; }, 1800);
    if(!success) showToast('Could not copy automatically — select the text and copy it yourself.');
  });

  document.getElementById('proceedCheckoutBtn')?.addEventListener('click', () => {
    overlay.remove();
    // Selar's confirmed prefill parameters. fullname now carries BOTH
    // signals at once — "TMUSER <username> <profile_id>" — since this
    // checkout type has no address field to split the profile id off
    // into separately. Selar's Name validation was confirmed (via a
    // real rejected attempt) to require at least a space; three words
    // is a reasonable bet to still pass the same "contains a space"
    // check that two words does, but this specific case (three words,
    // not two) hasn't been confirmed against a real checkout yet — if
    // it gets rejected, that's the first thing to check.
    //
    // "TMUSER" (not "ThinkMaps") is deliberate — the product name
    // legitimately appears many other places in the actual notification
    // email (plan name, footer branding), which would risk the backend
    // extractor false-matching on one of those instead of the real
    // encoded value. "TMUSER" doesn't collide with anything.
    const params = new URLSearchParams();
    if(accountEmail) params.set('email', accountEmail);
    if(accountUsername) params.set('fullname', `TMUSER ${accountUsername} ${accountId}`.trim());
    params.set('add_to_cart', '1');
    const checkoutUrl = `${PAYMENT_URL}?${params.toString()}`;
    window.open(checkoutUrl, '_blank', 'noopener');
  });
}

// Shared between initPricingSection above and the dashboard's "Go Pro"
// modal (see showProPlanModal) — the same on/off visual state, applied
// in two different places someone might see it.
function applyPricingProState(isPro, freeCard, grid, goProBtn){
  freeCard.style.display = isPro ? 'none' : '';
  grid.classList.toggle('pro-only', isPro);
  goProBtn.textContent = isPro ? "You're on Pro" : 'Go Pro';
  goProBtn.disabled = isPro;
}

// ---------- DASHBOARD PAGE ----------
// Skips entirely on pages without #dashboardRoot.
// Loads profile + blueprint state from server.js, renders one of three states
// per blueprint (empty / active / locked), and wires up "new blueprint" + logout.

// Set once per loadDashboard() call (see renderProBanner) — lets the Pro
// plan modal (showProPlanModal) know the current state without needing
// it threaded through as a function argument from wherever it's opened.
const dashboardState = { isPro: false };

async function initDashboardPage(){
  const root = document.getElementById('dashboardRoot');
  if(!root) return;

  const session = await getActiveSession();
  if(!session){
    window.location.href = 'auth.html';
    return;
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  setupNewBlueprintModal();
  renderFeedbackButton();
  await loadDashboard();
  await maybeHandlePaymentRedirect();
}

// Selar's post-purchase redirect lands here with ?email=...&fullname=...
// in the URL — a real, useful signal that a payment probably just
// happened, but never trusted directly (anyone could craft a URL with
// any email in it). Instead this just triggers an immediate check via
// /payment/recheck-now, which only ever reports back the LOGGED-IN
// user's own resulting status — the query params here are only used to
// decide whether to bother checking at all and what to tell the person,
// never to decide who gets upgraded.
async function maybeHandlePaymentRedirect(){
  const params = new URLSearchParams(window.location.search);
  const redirectEmail = params.get('email');
  if(!redirectEmail) return;

  // Clean the URL immediately regardless of outcome — refreshing the
  // page shouldn't re-trigger this every time.
  const cleanUrl = window.location.pathname;
  window.history.replaceState({}, '', cleanUrl);

  const session = await getActiveSession();
  const accountEmail = session?.user?.email;

  if(accountEmail && redirectEmail.toLowerCase() !== accountEmail.toLowerCase()){
    // The email used at checkout doesn't match the logged-in account —
    // this is exactly the situation that silently breaks the automatic
    // matching, so it's surfaced plainly rather than just quietly
    // checking and finding nothing.
    showToast(`You checked out with ${redirectEmail}, but you're signed in as ${accountEmail} — those need to match for the upgrade to apply automatically. Contact support if you paid with a different email on purpose.`);
    return;
  }

  showToast('Checking for your payment…');
  try {
    const res = await authedFetch('/payment/recheck-now', { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(res.ok && body.pro_status){
      showToast("You're on Pro! 🎉");
      await loadDashboard();
    } else if(res.ok){
      showToast("Payment not found yet — this can take a few minutes. It'll apply automatically once it comes through.");
    }
  } catch (err) {
    // Silent failure here is fine — the automatic 5-minute poll is
    // still running regardless of whether this instant check worked.
  }
}

async function loadDashboard(){
  const greetingEl = document.getElementById('dashboardGreeting');
  const bannerEl = document.getElementById('dashboardBanner');
  const blueprintArea = document.getElementById('blueprintArea');

  try {
    const res = await authedFetch('/dashboard');
    if(!res) return; // authedFetch already redirected to auth.html

    if(!res.ok){
      throw new Error('Could not load your dashboard.');
    }

    const { profile, blueprints, canCreateNew } = await res.json();

    if(greetingEl){
      greetingEl.textContent = `Welcome back, ${profile.username || profile.email}`;
    }

    renderProBanner(bannerEl, profile);
    renderBlueprintArea(blueprintArea, blueprints, canCreateNew);

  } catch (err){
    if(blueprintArea){
      blueprintArea.innerHTML = `<p class="auth-error">${err.message}</p>`;
    }
  }
}

function renderProBanner(bannerEl, profile){
  if(!bannerEl) return;

  dashboardState.isPro = !!profile.pro_status;

  if(profile.pro_status){
    bannerEl.innerHTML = `<span class="eyebrow">Pro</span> Unlimited blueprints, no edit lock, never deleted.`;
    bannerEl.classList.add('pro');
  } else {
    bannerEl.innerHTML = `
      <span class="eyebrow">Free plan</span>
      One blueprint, 30 minutes to edit, then read-only — deleted after 3 days.
      <button type="button" id="goProTestBtn" class="btn btn-primary">Go Pro</button>
    `;
    bannerEl.classList.remove('pro');

    // Opens the Pro plan modal (showProPlanModal) rather than upgrading
    // directly — the actual upgrade now happens from the Go Pro button
    // INSIDE that modal, so someone sees what they're getting before the
    // (test-mode, no real payment) toggle actually fires.
    const goProBtn = document.getElementById('goProTestBtn');
    if(goProBtn) goProBtn.addEventListener('click', () => showProPlanModal());
  }
}

// Dynamically injected — no static markup needed in dashboard.html for
// this, the same way showToast injects itself. Reuses the existing
// .modal-overlay/.modal-card classes (see #newBlueprintModal in
// dashboard.html) so it looks consistent with the one modal that
// already existed, rather than inventing a second visual style.
//
// NOTE: the feature list text below duplicates index.html's static Pro
// plan card content — this is the SECOND place that list lives. Keep
// both in sync by hand if either ever changes; there isn't a shared
// single source of truth between a static marketing page and this
// dynamically-built modal.
function showProPlanModal(){
  closeProPlanModal(); // guard against a stray double-open leaving two overlays stacked

  const isPro = dashboardState.isPro;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'proPlanModal';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="plan pro modal-plan-card">
        <span class="ptag">Pro</span>
        <h3>For builders who iterate</h3>
        <div class="price">$12<sup>/month</sup></div>
        <ul>
          <li>Unlimited blueprints, no edit lock, never deleted</li>
          <li>Combine multiple selections into one fused idea</li>
          <li>Market Intel &amp; Risk Analysis</li>
          <li>AI-found fixes for surfaced risks</li>
          <li>Detailed Build Brief for your MVP</li>
          <li>Suggest Changes — revise with your own feedback</li>
        </ul>
        <button type="button" class="btn btn-primary" id="modalGoProBtn" ${isPro ? 'disabled' : ''}>${isPro ? "You're on Pro" : 'Go Pro'}</button>
      </div>
      <button type="button" class="btn btn-ghost modal-close-btn" id="closeProPlanModalBtn">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if(e.target === overlay) closeProPlanModal(); // click on the dim backdrop itself closes it
  });
  document.getElementById('closeProPlanModalBtn').addEventListener('click', closeProPlanModal);

  const goProBtn = document.getElementById('modalGoProBtn');
  if(goProBtn && !isPro){
    goProBtn.addEventListener('click', async () => {
      const session = await getActiveSession();
      await openPaymentCheckout(session);
    });
  }
}

function closeProPlanModal(){
  const overlay = document.getElementById('proPlanModal');
  if(overlay) overlay.remove();
}

// ---------- Dashboard feedback button ----------
// A floating corner button, injected once from initDashboardPage — same
// "no static markup needed" convention as showToast and showProPlanModal.
// Opens a small modal where anything typed gets emailed straight to
// thinkmaps.team@gmail.com via the /feedback route in server.js. No
// message history is stored or shown back — this is a one-way "send a
// note to the team" board, not a public comment thread.
function renderFeedbackButton(){
  if(document.getElementById('feedbackFab')) return; // already on the page, don't duplicate

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'feedbackFab';
  btn.className = 'feedback-fab';
  btn.title = 'Send feedback, a request, or report something';
  btn.setAttribute('aria-label', 'Send feedback');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  `;
  btn.addEventListener('click', showFeedbackModal);
  document.body.appendChild(btn);
}

function closeFeedbackModal(){
  const overlay = document.getElementById('feedbackModal');
  if(overlay) overlay.remove();
}

function showFeedbackModal(){
  closeFeedbackModal(); // guard against a stray double-open leaving two overlays stacked

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'feedbackModal';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Got feedback?</h3>
      <p class="muted">A comment, a feature request, a bug report — whatever it is, it goes straight to the ThinkMaps team's inbox.</p>
      <textarea id="feedbackTextarea" class="revise-textarea" rows="6" maxlength="4000" placeholder="What's on your mind?"></textarea>
      <p class="auth-error" id="feedbackError"></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="closeFeedbackModalBtn">Cancel</button>
        <button type="button" class="btn btn-primary" id="sendFeedbackBtn">Send</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if(e.target === overlay) closeFeedbackModal(); // click on the dim backdrop itself closes it
  });
  document.getElementById('closeFeedbackModalBtn').addEventListener('click', closeFeedbackModal);

  const textarea = document.getElementById('feedbackTextarea');
  if(textarea) textarea.focus();

  const sendBtn = document.getElementById('sendFeedbackBtn');
  if(sendBtn){
    sendBtn.addEventListener('click', () => submitFeedback(textarea, sendBtn));
  }
  // Ctrl/Cmd+Enter submits from inside the textarea — small nicety for
  // anyone used to that shortcut from chat/email apps, entirely optional.
  if(textarea){
    textarea.addEventListener('keydown', (e) => {
      if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
        e.preventDefault();
        submitFeedback(textarea, sendBtn);
      }
    });
  }
}

async function submitFeedback(textarea, sendBtn){
  const errorEl = document.getElementById('feedbackError');
  if(errorEl) errorEl.textContent = '';

  const message = (textarea?.value || '').trim();
  if(!message){
    if(errorEl) errorEl.textContent = 'Type something before sending.';
    return;
  }

  if(sendBtn){
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';
  }

  try {
    const res = await authedFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    if(!res) return; // authedFetch already redirected to auth.html

    const body = await res.json().catch(() => ({}));

    if(!res.ok){
      if(errorEl) errorEl.textContent = body.error || 'Could not send your message.';
      if(sendBtn){ sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      return;
    }

    closeFeedbackModal();
    showToast('Thanks — your message is on its way to the team.');
  } catch (err){
    if(errorEl) errorEl.textContent = 'Could not reach the server. Try again.';
    if(sendBtn){ sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
  }
}

// ---------- SETTINGS PAGE (settings.html) ----------
// Everything here talks to routes that already existed in server.js
// before this page did — GET/POST /profile, POST /profile/password,
// DELETE /profile — this is purely the frontend for infrastructure that
// was already there.
const settingsState = { username: '', email: '', isPro: false };

async function initSettingsPage(){
  const root = document.getElementById('settingsRoot');
  if(!root) return;

  const session = await getActiveSession();
  if(!session){ window.location.href = 'auth.html'; return; }

  await loadSettingsProfile();
  wireSettingsUsernameForm();
  wireSettingsPasswordForm();
  wireSettingsDeleteAccount();

  const logoutBtn = document.getElementById('settingsLogoutBtn');
  if(logoutBtn) logoutBtn.addEventListener('click', handleLogout);
}

async function loadSettingsProfile(){
  try {
    const res = await authedFetch('/profile');
    if(!res) return; // authedFetch already redirected to auth.html
    if(!res.ok) throw new Error('Could not load your profile.');

    const profile = await res.json();
    settingsState.username = profile.username || '';
    settingsState.email = profile.email || '';
    settingsState.isPro = !!profile.pro_status;

    const usernameDisplay = document.getElementById('settingsUsernameDisplay');
    const emailDisplay = document.getElementById('settingsEmailDisplay');
    const avatarInitial = document.getElementById('settingsAvatarInitial');

    if(usernameDisplay) usernameDisplay.textContent = settingsState.username || '—';
    if(emailDisplay) emailDisplay.textContent = settingsState.email || '—';
    if(avatarInitial){
      avatarInitial.textContent = (settingsState.username || settingsState.email || '?').charAt(0).toUpperCase();
    }

    renderSettingsPlan();
  } catch (err){
    showToast('Could not load your profile — try refreshing.');
  }
}

function renderSettingsPlan(){
  const labelEl = document.getElementById('settingsPlanLabel');
  const descEl = document.getElementById('settingsPlanDescription');
  const btnEl = document.getElementById('settingsPlanBtn');
  if(!labelEl || !descEl || !btnEl) return;

  if(settingsState.isPro){
    labelEl.innerHTML = '<span class="eyebrow">Pro</span>';
    descEl.textContent = 'Unlimited blueprints, no edit lock, never deleted.';
    btnEl.textContent = 'Manage plan';
  } else {
    labelEl.innerHTML = '<span class="eyebrow">Free plan</span>';
    descEl.textContent = 'One blueprint, 30 minutes to edit, then read-only — deleted after 3 days.';
    btnEl.textContent = 'Go Pro';
  }
  btnEl.style.display = 'inline-flex';

  // showProPlanModal reads dashboardState.isPro (a module-level object
  // shared across every page this script runs on, not just dashboard.html)
  // to decide its own copy/behavior — keeping it in sync here means the
  // exact same modal works correctly whether it was opened from the
  // dashboard or from here.
  btnEl.onclick = () => {
    dashboardState.isPro = settingsState.isPro;
    showProPlanModal();
  };
}

function wireSettingsUsernameForm(){
  const displayRow = document.getElementById('settingsUsernameDisplay');
  const editBtn = document.getElementById('editUsernameBtn');
  const form = document.getElementById('usernameForm');
  const input = document.getElementById('usernameInput');
  const cancelBtn = document.getElementById('cancelUsernameBtn');
  const errorEl = document.getElementById('usernameError');
  if(!editBtn || !form || !input) return;

  editBtn.addEventListener('click', () => {
    input.value = settingsState.username;
    if(errorEl) errorEl.textContent = '';
    form.style.display = 'flex';
    editBtn.style.display = 'none';
    input.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    form.style.display = 'none';
    editBtn.style.display = 'inline-flex';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(errorEl) errorEl.textContent = '';

    const newUsername = input.value.trim();
    if(!newUsername){
      if(errorEl) errorEl.textContent = 'Username is required.';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

    try {
      const res = await authedFetch('/profile/username', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername })
      });
      if(!res) return;

      const body = await res.json().catch(() => ({}));
      if(!res.ok){
        if(errorEl) errorEl.textContent = body.error || 'Could not update username.';
        return;
      }

      settingsState.username = body.username;
      if(displayRow) displayRow.textContent = body.username;
      const avatarInitial = document.getElementById('settingsAvatarInitial');
      if(avatarInitial) avatarInitial.textContent = body.username.charAt(0).toUpperCase();

      form.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      showToast('Username updated.');
    } catch (err){
      if(errorEl) errorEl.textContent = 'Could not reach the server. Try again.';
    } finally {
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    }
  });
}

function wireSettingsPasswordForm(){
  const editBtn = document.getElementById('editPasswordBtn');
  const form = document.getElementById('passwordForm');
  const currentInput = document.getElementById('currentPasswordInput');
  const newInput = document.getElementById('newPasswordInput');
  const confirmInput = document.getElementById('confirmPasswordInput');
  const cancelBtn = document.getElementById('cancelPasswordBtn');
  const errorEl = document.getElementById('passwordError');
  if(!editBtn || !form) return;

  editBtn.addEventListener('click', () => {
    form.reset();
    if(errorEl) errorEl.textContent = '';
    form.style.display = 'flex';
    editBtn.style.display = 'none';
    currentInput?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    form.style.display = 'none';
    editBtn.style.display = 'inline-flex';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(errorEl) errorEl.textContent = '';

    const currentPassword = currentInput.value;
    const newPassword = newInput.value;
    const confirmPassword = confirmInput.value;

    if(newPassword !== confirmPassword){
      if(errorEl) errorEl.textContent = 'New passwords don\'t match.';
      return;
    }
    if(newPassword.length < 8){
      if(errorEl) errorEl.textContent = 'New password must be at least 8 characters.';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Updating…'; }

    try {
      const res = await authedFetch('/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if(!res) return;

      const body = await res.json().catch(() => ({}));
      if(!res.ok){
        if(errorEl) errorEl.textContent = body.error || 'Could not update password.';
        return;
      }

      form.reset();
      form.style.display = 'none';
      editBtn.style.display = 'inline-flex';
      showToast('Password updated.');
    } catch (err){
      if(errorEl) errorEl.textContent = 'Could not reach the server. Try again.';
    } finally {
      if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = 'Update password'; }
    }
  });
}

function wireSettingsDeleteAccount(){
  const openBtn = document.getElementById('deleteAccountBtn');
  const modal = document.getElementById('deleteAccountModal');
  const cancelBtn = document.getElementById('cancelDeleteAccountBtn');
  const confirmBtn = document.getElementById('confirmDeleteAccountBtn');
  const input = document.getElementById('deleteConfirmInput');
  const errorEl = document.getElementById('deleteAccountError');
  if(!openBtn || !modal) return;

  openBtn.addEventListener('click', () => {
    if(input) input.value = '';
    if(errorEl) errorEl.textContent = '';
    const textEl = document.getElementById('deleteAccountModalText');
    if(textEl){
      const uname = settingsState.username || 'your username';
      textEl.textContent = `This permanently deletes your account and every blueprint you've created. Type your username, ${uname}, to confirm — this can't be undone.`;
    }
    modal.style.display = 'flex';
    input?.focus();
  });

  cancelBtn?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.addEventListener('click', (e) => {
    if(e.target === modal) modal.style.display = 'none';
  });

  confirmBtn?.addEventListener('click', async () => {
    if(errorEl) errorEl.textContent = '';
    const typed = (input?.value || '').trim();

    if(!typed){
      if(errorEl) errorEl.textContent = 'Type your username to confirm.';
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';

    try {
      const res = await authedFetch('/profile', {
        method: 'DELETE',
        body: JSON.stringify({ confirmUsername: typed })
      });
      if(!res) return;

      const body = await res.json().catch(() => ({}));
      if(!res.ok){
        if(errorEl) errorEl.textContent = body.error || 'Could not delete your account.';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Delete my account';
        return;
      }

      // Account is gone server-side — clear the local session and send
      // them somewhere that isn't behind a login wall for an account
      // that no longer exists.
      const sb = await getSupabaseClient();
      await sb.auth.signOut();
      window.location.href = 'index.html';
    } catch (err){
      if(errorEl) errorEl.textContent = 'Could not reach the server. Try again.';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete my account';
    }
  });
}

function renderBlueprintArea(container, blueprints, canCreateNew){
  if(!container) return;

  if(blueprints.length === 0){
    container.innerHTML = `
      <div class="empty-state">
        <h3>You haven't started a blueprint yet</h3>
        <p class="muted">Pick a niche, branch it out, and let the graph build toward a real idea.</p>
        <button class="btn btn-primary" id="newBlueprintBtn">Start your first blueprint</button>
      </div>
    `;
    document.getElementById('newBlueprintBtn').addEventListener('click', openNewBlueprintModal);
    return;
  }

  const cards = blueprints.map(bp => {
    const createdLabel = new Date(bp.created_at).toLocaleDateString();
    let statusLabel;
    if(bp.isLocked){
      if(bp.lockReason === 'pro_required'){
        statusLabel = 'Locked — created on Pro, upgrade to access it again';
      } else {
        statusLabel = bp.daysUntilDeletion != null
          ? `Locked — read-only · deletes in ${bp.daysUntilDeletion} day(s)`
          : 'Locked — read-only';
      }
    } else if(bp.minutesRemaining != null){
      statusLabel = `${bp.minutesRemaining} minute(s) left to edit on free tier`;
    } else {
      statusLabel = 'Active';
    }

    // Delete is Pro-only (matches the backend's DELETE /blueprints/:id
    // gate) — free-tier blueprints already self-delete on their own
    // timer, so a manual delete button there would just be a confusing
    // extra control for something that already happens automatically.
    const deleteButton = dashboardState.isPro
      ? `<button type="button" class="btn-delete-blueprint" data-id="${bp.id}" data-title="${escapeHtml(bp.title)}" title="Delete blueprint" aria-label="Delete blueprint">✕</button>`
      : '';

    return `
      <div class="blueprint-card ${bp.isLocked ? 'locked' : ''}">
        ${deleteButton}
        <h3>${bp.title}</h3>
        <p class="muted">Created ${createdLabel}</p>
        <p class="status-label">${statusLabel}</p>
        <a href="app.html?blueprint=${bp.id}" class="btn ${bp.isLocked ? 'btn-ghost' : 'btn-primary'}">
          ${bp.isLocked ? 'View (read-only)' : 'Open blueprint'}
        </a>
      </div>
    `;
  }).join('');

  const newButton = canCreateNew
    ? `<button class="btn btn-ghost" id="newBlueprintBtn">+ New blueprint</button>`
    : '';

  container.innerHTML = `<div class="blueprint-grid">${cards}</div>${newButton}`;

  const newBtn = document.getElementById('newBlueprintBtn');
  if(newBtn) newBtn.addEventListener('click', openNewBlueprintModal);

  container.querySelectorAll('.btn-delete-blueprint').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); // sits inside the card, which itself isn't a link, but stop just in case markup changes later
      deleteBlueprint(btn.dataset.id, btn.dataset.title);
    });
  });
}

// Pro-only (matches the DELETE /blueprints/:id gate on the backend).
// Genuinely destructive — confirm dialog first, no undo after this.
async function deleteBlueprint(blueprintId, title){
  if(!confirm(`Delete "${title}"? This permanently deletes the whole blueprint and everything in it — this can't be undone.`)) return;

  try {
    const res = await authedFetch(`/blueprints/${blueprintId}`, { method: 'DELETE' });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not delete this blueprint.');
      return;
    }
    showToast('Blueprint deleted.');
    await loadDashboard();
  } catch (err) {
    showToast('Could not reach the server. Try again.');
  }
}

// ---------- NEW BLUEPRINT MODAL ----------
// Every "+ New blueprint" / "Start your first blueprint" button opens this
// instead of creating a blueprint directly — the person names it up front,
// rather than getting an "Untitled Blueprint" they have to rename later.
function setupNewBlueprintModal(){
  const modal = document.getElementById('newBlueprintModal');
  if(!modal) return;

  const input = document.getElementById('newBlueprintNameInput');
  const cancelBtn = document.getElementById('cancelNewBlueprintBtn');
  const confirmBtn = document.getElementById('confirmNewBlueprintBtn');

  if(cancelBtn) cancelBtn.addEventListener('click', closeNewBlueprintModal);
  if(confirmBtn) confirmBtn.addEventListener('click', submitNewBlueprint);

  // Click on the dimmed overlay (not the card itself) closes it.
  modal.addEventListener('click', (e) => {
    if(e.target === modal) closeNewBlueprintModal();
  });

  if(input){
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter') submitNewBlueprint();
      if(e.key === 'Escape') closeNewBlueprintModal();
    });
  }
}

function openNewBlueprintModal(){
  const modal = document.getElementById('newBlueprintModal');
  const input = document.getElementById('newBlueprintNameInput');
  const errorEl = document.getElementById('newBlueprintError');
  if(!modal) return;

  if(errorEl) errorEl.textContent = '';
  if(input) input.value = '';
  modal.style.display = 'flex';
  if(input) input.focus();
}

function closeNewBlueprintModal(){
  const modal = document.getElementById('newBlueprintModal');
  if(modal) modal.style.display = 'none';
}

async function submitNewBlueprint(){
  const input = document.getElementById('newBlueprintNameInput');
  const errorEl = document.getElementById('newBlueprintError');
  const confirmBtn = document.getElementById('confirmNewBlueprintBtn');
  const name = (input?.value || '').trim();

  if(!name){
    if(errorEl) errorEl.textContent = 'Give your blueprint a name to continue.';
    if(input) input.focus();
    return;
  }

  if(confirmBtn) confirmBtn.disabled = true;

  try {
    const res = await authedFetch('/blueprints', { method: 'POST', body: JSON.stringify({ title: name }) });
    if(!res) return;

    const body = await res.json();

    if(!res.ok){
      if(errorEl) errorEl.textContent = body.error || 'Could not create blueprint.';
      return;
    }

    closeNewBlueprintModal();
    window.location.href = `app.html?blueprint=${body.blueprint.id}`;
  } catch (err){
    if(errorEl) errorEl.textContent = 'Could not create blueprint. Try again.';
  } finally {
    if(confirmBtn) confirmBtn.disabled = false;
  }
}

// ---------- BLUEPRINT CANVAS PAGE ----------
// Skips entirely on pages without #canvasWorld.
// Layout math is fully data-driven (fixed card/row sizes) rather than reading
// the DOM, so line-drawing stays correct under any pan/zoom without forcing
// layout reflows.

const CARD_WIDTH = 220;
// Connector lines are plain rotated divs (see drawConnectorLine), sharing
// the exact same raw world-unit coordinate space as the group cards —
// no separate layer with its own sizing to keep in sync.

// Mirrors the exact same heuristic used on the backend (estimateOptionHeight/
// estimateHeaderHeight in server.js) — a row/header only "scales" up when its
// own actual text needs the extra room, not by default for every card.
// Was previously a binary check that capped at one step up regardless of
// how much longer the text got past the threshold — under-counted real
// height for anything wrapping to 3+ lines, which is what let cards spawn
// overlapping each other. Now scales proportionally with estimated
// wrapped-line count, matching the server.js fix exactly.
function estimateOptionHeight(label){
  const text = label || '';
  const CHARS_PER_LINE = 26;
  const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
  const BASE_HEIGHT = 38;
  const EXTRA_LINE_HEIGHT = 18;
  return BASE_HEIGHT + (lines - 1) * EXTRA_LINE_HEIGHT;
}

function estimateHeaderHeight(label){
  const text = label || '';
  const CHARS_PER_LINE = 22;
  const lines = Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
  const BASE_HEIGHT = 40;
  const EXTRA_LINE_HEIGHT = 18;
  return BASE_HEIGHT + (lines - 1) * EXTRA_LINE_HEIGHT;
}

// The vertical center of option row `index` within a group, in world
// coordinates — sums each preceding row's REAL estimated height instead of
// assuming every row is the same fixed size.
function computeRowCenterY(group, options, index){
  let y = estimateHeaderHeight(group.label);
  for(let i = 0; i < index; i++){
    y += estimateOptionHeight(options[i]?.label);
  }
  y += estimateOptionHeight(options[index]?.label) / 2;
  return (group.position_y || 0) + y;
}

// Reconstructs a group's CURRENT active-version options from canvasState —
// used wherever a row's position is needed but only a groupId is on hand.
function getGroupOptionsArray(groupId){
  const group = canvasState.groups.find(g => g.id === groupId);
  if(!group) return [];
  const versions = canvasState.groupVersions.filter(v => v.group_id === groupId);
  const activeVersion = versions.find(v => v.version_number === group.current_version_number) || versions[versions.length - 1];
  if(!activeVersion) return [];
  return canvasState.options.filter(o => o.group_version_id === activeVersion.id);
}

const canvasState = {
  blueprintId: null,
  isLocked: false,
  // Whether the OWNER of this blueprint is pro — gates pro-only canvas
  // features (currently: ctrl+click multi-select combining). Populated
  // from the graph response (see initAppPage), not assumed.
  isPro: false,
  groups: [],
  groupVersions: [],
  options: [],
  pan: { x: 0, y: 0 },
  zoom: 1,
  hasCenteredOnce: false,
  // Whichever option the person most recently clicked/dropped onto —
  // drives the progress counter and breadcrumb trail, recomputed fresh
  // after every graph reload rather than incrementally maintained, so it
  // can't drift out of sync with whatever's actually in canvasState.
  lastActivatedOptionId: null,
  // Terminal "Generate Ideas" groups that have already gotten their
  // one-time auto-frame moment — without this, EVERY graph reload while
  // that card is on screen would re-trigger the zoom-to-fit animation.
  framedTerminalGroupIds: new Set(),
  // Options ctrl+clicked to stage for a COMBINED activation — cleared on
  // successful activation, Escape, or a click on empty canvas. Never
  // includes anything from the root Niches group (enforced at the point
  // options get added, not just on the backend) and every member always
  // shares the exact same spawned_from_option_id, so by construction this
  // can never straddle two unrelated parts of the tree.
  multiSelectStagedIds: new Set()
};

// Zoom range — 0.15 is "see almost the whole sprawling graph at once,"
// 2 is "read fine text up close." Was 0.3 at the low end; widened on
// request so a large blueprint can actually fit on screen when zoomed out.
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2;

let isPanning = false;
let panStartPointer = null;
let panStartValue = null;
let draggingGroupId = null;
let dragStartPointer = null;
let dragStartGroupPos = null;
let lineDragState = null; // { optionId, startX, startY, initialClientX, initialClientY, currentWorld }

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Minimal, reusable toast for brief feedback moments — currently used
// for the pro-wall message when a free user tries to combine, but
// written generically enough for any future "this didn't happen, here's
// why" moment. Auto-removes itself; only one shown at a time (a second
// call replaces whatever's currently showing rather than stacking).
function showToast(message){
  let el = document.getElementById('appToast');
  if(el) el.remove();

  el = document.createElement('div');
  el.id = 'appToast';
  el.className = 'app-toast';
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('app-toast-visible'));
  setTimeout(() => {
    el.classList.remove('app-toast-visible');
    setTimeout(() => el.remove(), 250);
  }, 2600);
}

// =====================================================================
// GUIDED TOURS — generic coach-mark engine, reused for both the canvas
// tour and the idea toolkit tour rather than building two one-off
// implementations.
//
// The highlight is a pulsing glow ring around the target itself (see
// .tour-spotlight / @keyframes tourPulseGlow in styles.css) — no
// darkened backdrop over the rest of the page. A connector line links
// the caption (always anchored to a fixed top-left corner, regardless
// of target) to whatever's highlighted, since without a dimmed
// backdrop tying them together visually, that link needs to be explicit.
//
// Steps reference real selectors and are checked defensively — if a
// target isn't found (different page, different state, a Pro-only
// element on a free account), that step is skipped automatically rather
// than the tour breaking or showing a spotlight around nothing.
// =====================================================================
function isCoarsePointer(){
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

function hasSeenTour(tourId){
  try { return localStorage.getItem(`thinkmaps_tour_seen_${tourId}`) === '1'; }
  catch(e){ return false; }
}

function markTourSeen(tourId){
  try { localStorage.setItem(`thinkmaps_tour_seen_${tourId}`, '1'); }
  catch(e){ /* private browsing or storage disabled — tour just shows again next time, harmless */ }
}

let activeTourState = null;
let tourDemoRunning = false;

function wait(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

function ensureGhostCursor(){
  let cursor = document.getElementById('tourGhostCursor');
  if(!cursor){
    cursor = document.createElement('div');
    cursor.id = 'tourGhostCursor';
    cursor.className = 'tour-ghost-cursor';
    document.body.appendChild(cursor);
  }
  return cursor;
}

function moveGhostCursor(cursor, x, y){
  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
}

function spawnClickRipple(x, y){
  const ripple = document.createElement('div');
  ripple.className = 'tour-click-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), 700);
}

function removeGhostCursor(){
  document.getElementById('tourGhostCursor')?.remove();
  document.getElementById('tourCtrlBadge')?.remove();
  document.querySelectorAll('.tour-click-ripple').forEach(el => el.remove());
}

// Each demo runs as a self-repeating loop for as long as its step stays
// on screen (checked via tourDemoRunning before every await-gated step,
// so it stops cleanly mid-animation rather than finishing a stray cycle
// after the person has already clicked Next). Real coordinates are read
// fresh from the actual target element every loop — this is animating
// the genuine live page, not a canned recording, so it stays correct
// even if layout shifts between loops.
const TOUR_DEMOS = {
  async pan(cursor){
    const target = document.querySelector('#canvasViewport');
    if(!target) return;
    const rect = target.getBoundingClientRect();
    const y = rect.top + rect.height * 0.45;
    const startX = rect.left + rect.width * 0.62;
    const endX = rect.left + rect.width * 0.32;

    moveGhostCursor(cursor, startX, y);
    cursor.classList.add('tour-cursor-grabbing');
    await wait(450); if(!tourDemoRunning) return;
    moveGhostCursor(cursor, endX, y); // CSS transition animates this as a smooth drag
    await wait(750); if(!tourDemoRunning) return;
    cursor.classList.remove('tour-cursor-grabbing');
    await wait(500);
  },

  async zoom(cursor){
    const zoomIn = document.querySelector('#zoomInBtn');
    const zoomOut = document.querySelector('#zoomOutBtn');
    for(const btn of [zoomIn, zoomOut]){
      if(!btn || !tourDemoRunning) continue;
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      moveGhostCursor(cursor, x, y);
      await wait(500); if(!tourDemoRunning) return;
      spawnClickRipple(x, y);
      btn.classList.add('tour-demo-pressed');
      await wait(180);
      btn.classList.remove('tour-demo-pressed');
      await wait(500); if(!tourDemoRunning) return;
    }
  },

  async activate(cursor){
    const target = document.querySelector('.canvas-option');
    if(!target) return;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    moveGhostCursor(cursor, x, y);
    await wait(550); if(!tourDemoRunning) return;
    spawnClickRipple(x, y);
    target.classList.add('tour-demo-pressed');
    await wait(200);
    target.classList.remove('tour-demo-pressed');
    await wait(700);
  },

  async groupFooter(cursor){
    const buttons = document.querySelectorAll('.canvas-group-footer button');
    for(const btn of buttons){
      if(!tourDemoRunning) return;
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      moveGhostCursor(cursor, x, y);
      await wait(450); if(!tourDemoRunning) return;
      spawnClickRipple(x, y);
      btn.classList.add('tour-demo-pressed');
      await wait(180);
      btn.classList.remove('tour-demo-pressed');
      await wait(350); if(!tourDemoRunning) return;
    }
    await wait(400);
  },

  async combine(cursor){
    const options = document.querySelectorAll('.canvas-option');
    if(options.length < 2) return;
    const [first, second] = options;

    const badge = document.createElement('div');
    badge.id = 'tourCtrlBadge';
    badge.className = 'tour-ctrl-badge';
    badge.textContent = isCoarsePointer() ? 'Long-press' : 'Ctrl held';
    document.body.appendChild(badge);

    for(const opt of [first, second]){
      if(!tourDemoRunning){ badge.remove(); return; }
      const rect = opt.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      moveGhostCursor(cursor, x, y);
      badge.style.left = `${x + 18}px`;
      badge.style.top = `${y - 30}px`;
      await wait(500); if(!tourDemoRunning){ badge.remove(); return; }
      spawnClickRipple(x, y);
      opt.classList.add('tour-demo-selected');
      await wait(400); if(!tourDemoRunning){ badge.remove(); return; }
    }
    await wait(600);
    [first, second].forEach(opt => opt.classList.remove('tour-demo-selected'));
    badge.remove();
  },

  async dragActivate(cursor){
    const options = document.querySelectorAll('.canvas-option');
    if(options.length < 2) return;

    const source = options[0];
    const sourceCard = source.closest('.canvas-group');
    // Prefer a target option in a DIFFERENT group card — that's the
    // whole point of the gesture (dragging INTO another spawned
    // group), not just any second option in the same card.
    let target = null;
    for(const opt of options){
      if(opt === source) continue;
      if(opt.closest('.canvas-group') !== sourceCard){ target = opt; break; }
    }
    if(!target) target = options[1];

    // The real drag genuinely starts from the small colored dot beside
    // an option's text, not the option row as a whole — anchoring the
    // demo there instead of the row's general center is what makes this
    // an accurate demonstration of the actual gesture, not an
    // approximation of it.
    const sourceDot = source.querySelector('.opt-dot') || source;
    const sourceRect = sourceDot.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const sx = sourceRect.left + sourceRect.width / 2;
    const sy = sourceRect.top + sourceRect.height / 2;
    const tx = targetRect.left + targetRect.width / 2;
    const ty = targetRect.top + targetRect.height / 2;

    moveGhostCursor(cursor, sx, sy);
    await wait(500); if(!tourDemoRunning) return;
    cursor.classList.add('tour-cursor-grabbing');
    source.classList.add('tour-demo-pressed');
    await wait(250); if(!tourDemoRunning){ cursor.classList.remove('tour-cursor-grabbing'); source.classList.remove('tour-demo-pressed'); return; }

    // A real connector line, animated growing from source toward target
    // frame-by-frame — this is deliberately NOT just a CSS transition
    // like the cursor's own movement, since a line needs to track BOTH
    // its length and angle continuously as it grows, not just move from
    // point A to B.
    const line = document.createElement('div');
    line.className = 'tour-drag-line';
    document.body.appendChild(line);
    moveGhostCursor(cursor, tx, ty);

    const steps = 16;
    for(let i = 1; i <= steps; i++){
      if(!tourDemoRunning){
        line.remove();
        cursor.classList.remove('tour-cursor-grabbing');
        source.classList.remove('tour-demo-pressed');
        return;
      }
      const px = sx + (tx - sx) * (i / steps);
      const py = sy + (ty - sy) * (i / steps);
      const dx = px - sx, dy = py - sy;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      line.style.left = `${sx}px`;
      line.style.top = `${sy}px`;
      line.style.width = `${length}px`;
      line.style.transform = `rotate(${angle}deg)`;
      await wait(30);
    }

    target.classList.add('tour-demo-selected'); // mirrors the real .drop-hover highlight
    await wait(450); if(!tourDemoRunning){ line.remove(); target.classList.remove('tour-demo-selected'); return; }

    spawnClickRipple(tx, ty);
    cursor.classList.remove('tour-cursor-grabbing');
    source.classList.remove('tour-demo-pressed');
    await wait(350);
    target.classList.remove('tour-demo-selected');
    line.remove();
    await wait(500);
  },

  // Generic, reused across every toolkit tour step — dynamically finds
  // whichever card is currently spotlighted (via the active step's own
  // selector) and points at/presses its real button, rather than
  // needing separate bespoke logic written out per feature.
  async cardButton(cursor){
    if(!activeTourState) return;
    const step = activeTourState.steps[activeTourState.index];
    const card = step.selector ? document.querySelector(step.selector) : null;
    if(!card) return;
    // Prefer the card's actual primary action (inside .toolkit-card-actions,
    // the consistent wrapper every card uses for its main button) —
    // falling back to any button only for a card that doesn't have that
    // wrapper yet (e.g. still showing its initial Pro-gate button before
    // anything's been generated). Without this preference, a card with
    // several small inline buttons of its own — Landing Copy has a
    // "Copy" button next to every section — would have the demo point
    // at whichever one of those happens to sit first in the markup,
    // not the card's actual main action.
    const btn = card.querySelector('.toolkit-card-actions button, .toolkit-card-actions a.btn')
      || card.querySelector('button, a.btn');
    if(!btn) return;

    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    moveGhostCursor(cursor, x, y);
    await wait(500); if(!tourDemoRunning) return;
    spawnClickRipple(x, y);
    btn.classList.add('tour-demo-pressed');
    await wait(200);
    btn.classList.remove('tour-demo-pressed');
    await wait(750);
  }
};

async function runTourDemoLoop(demoName){
  const demoFn = TOUR_DEMOS[demoName];
  if(!demoFn) return;

  tourDemoRunning = true;
  const cursor = ensureGhostCursor();
  cursor.style.opacity = '1';

  while(tourDemoRunning){
    await demoFn(cursor);
    if(!tourDemoRunning) break;
    await wait(700); // pause before looping so it reads as a repeatable action, not a jittery loop
  }
}

function stopTourDemo(){
  tourDemoRunning = false;
  removeGhostCursor();
}

function startTour(tourId, steps, { mandatory = false } = {}){
  // Resolve steps at call time, not definition time — mobile-specific
  // wording needs to reflect the actual device the tour is running on.
  const resolvedSteps = steps
    .map(step => (typeof step === 'function' ? step() : step))
    .filter(Boolean);

  if(resolvedSteps.length === 0) return;

  activeTourState = { tourId, steps: resolvedSteps, index: 0, mandatory };
  renderTourStep();
}

function endTour(){
  if(activeTourState) markTourSeen(activeTourState.tourId);
  stopTourDemo();
  cleanupTourDOM();
  activeTourState = null;
}

function cleanupTourDOM(){
  stopTourDemo();
  document.getElementById('tourCaption')?.remove();
  document.getElementById('tourConnectorLine')?.remove();
  document.querySelectorAll('.tour-spotlight').forEach(el => {
    el.classList.remove('tour-spotlight', 'tour-needs-position');
    el.style.boxShadow = '';
  });
}

function renderTourStep(){
  if(!activeTourState) return;
  cleanupTourDOM();

  const { steps, index } = activeTourState;
  const step = steps[index];

  const target = step.selector ? document.querySelector(step.selector) : null;

  // A step that names a selector but can't find it on the page right
  // now (wrong tab, Pro-only element on a free account, etc.) is
  // skipped entirely rather than spotlighting nothing — advances
  // straight to the next step, or ends the tour if this was the last one.
  if(step.selector && !target){
    if(index + 1 < steps.length){
      activeTourState.index++;
      renderTourStep();
    } else {
      endTour();
    }
    return;
  }

  if(target){
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if(getComputedStyle(target).position === 'static'){
      target.classList.add('tour-needs-position');
    }
    target.classList.add('tour-spotlight');
  }

  const caption = document.createElement('div');
  caption.id = 'tourCaption';
  caption.className = 'tour-caption' + (target ? '' : ' tour-caption-centered');
  const isMandatory = !!activeTourState.mandatory;
  caption.innerHTML = `
    <div class="tour-caption-progress">${index + 1} of ${steps.length}</div>
    <h4>${escapeHtml(step.title)}</h4>
    <p>${escapeHtml(step.text)}</p>
    ${isMandatory && index === 0 ? `<p class="tour-mandatory-note">This first-time walkthrough can't be skipped — you can always replay it later from the "?" button.</p>` : ''}
    <div class="tour-caption-actions">
      ${isMandatory ? '<span></span>' : `<button type="button" class="tour-skip-btn">Skip tour</button>`}
      <div class="tour-nav-btns">
        ${index > 0 ? `<button type="button" class="btn btn-ghost tour-back-btn">Back</button>` : ''}
        <button type="button" class="btn btn-primary tour-next-btn">${index + 1 === steps.length ? 'Done' : 'Next'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(caption);

  // Position near the target after a frame, once scrollIntoView has
  // actually settled — positioning against a mid-scroll rect would be wrong.
  // Fixed anchor, every step, regardless of target — deliberately NOT
  // computed relative to the target's position. Hugging the target
  // dynamically is what caused the caption to land directly on top of
  // the exact thing being demonstrated (a wide button row, a drag path
  // between two side-by-side cards) — a consistent corner trades away
  // "near the target" proximity for something more important here:
  // never blocking the sightline to the actual demo happening on screen.
  caption.style.top = '24px';
  caption.style.left = '24px';

  if(target){
    // Same reasoning as the demo-start delay further down — scrollIntoView
    // is a SMOOTH scroll that takes several hundred ms to actually
    // finish, while requestAnimationFrame only waits for the next
    // single frame (~16ms). Reading the target's rect via
    // requestAnimationFrame alone was measuring its PRE-scroll position,
    // not where it actually settles — the connector line was visibly
    // pointing at the wrong spot on screen for any target that needed
    // scrolling into view.
    setTimeout(() => {
      if(!activeTourState || activeTourState.steps[activeTourState.index] !== step) return;
      const captionRect = caption.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const fromX = captionRect.right;
      const fromY = captionRect.bottom - 20;
      const toX = targetRect.left + targetRect.width / 2;
      const toY = targetRect.top + targetRect.height / 2;

      const dx = toX - fromX;
      const dy = toY - fromY;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);

      const line = document.createElement('div');
      line.className = 'tour-connector-line';
      line.id = 'tourConnectorLine';
      line.style.left = `${fromX}px`;
      line.style.top = `${fromY}px`;
      line.style.width = `${length}px`;
      line.style.transform = `rotate(${angle}deg)`;
      document.body.appendChild(line);
    }, 450);
  }

  caption.querySelector('.tour-skip-btn')?.addEventListener('click', endTour);
  caption.querySelector('.tour-next-btn')?.addEventListener('click', () => {
    if(index + 1 < steps.length){
      activeTourState.index++;
      renderTourStep();
    } else {
      endTour();
    }
  });
  caption.querySelector('.tour-back-btn')?.addEventListener('click', () => {
    activeTourState.index--;
    renderTourStep();
  });

  // Short delay lets the smooth scrollIntoView above actually settle —
  // starting the demo immediately risks it reading a mid-scroll rect on
  // its very first frame.
  if(step.demo){
    setTimeout(() => {
      // Guard against a fast Next/Skip click landing before this fires —
      // only start if we're still actually on this exact step.
      if(activeTourState && activeTourState.steps[activeTourState.index] === step){
        runTourDemoLoop(step.demo);
      }
    }, 450);
  }
}


// One shared renderer for every pro-gated action button on the confirm
// result page (deeper analysis, fixes, build brief, suggest changes) —
// active and clickable for pro users, a clearly-labeled locked state
// with an upgrade link for everyone else. Written once here rather than
// four times slightly differently, so the visual treatment of "this is
// a Pro feature" stays consistent everywhere it appears.
function renderProGatedButton(container, label, onActivate){
  if(!container) return;

  if(confirmState.isPro){
    container.innerHTML = `<button class="btn btn-secondary pro-gate-activate-btn" type="button">${escapeHtml(label)}</button>`;
    // Scoped to THIS container, not a document-wide ID lookup — every
    // toolkit card (strength score, pivots, personas, landing copy, red
    // team, spy mode, launch checklist) calls this same function, and a
    // hardcoded id="proGateBtn" meant document.getElementById always
    // returned the FIRST one in the whole page regardless of which
    // container had just been filled — every card after the first
    // silently wired its click listener onto the wrong button entirely,
    // which is exactly why most of these did nothing when clicked.
    const btn = container.querySelector('.pro-gate-activate-btn');
    if(btn) btn.addEventListener('click', onActivate);
    return;
  }

  container.innerHTML = `
    <div class="pro-gate">
      <button class="btn btn-secondary" type="button" disabled>${escapeHtml(label)}</button>
      <span class="pro-gate-badge">PRO</span>
      <a href="index.html#pricing" class="pro-gate-link">Upgrade to unlock</a>
    </div>
  `;
}

// Every canvas interaction (pan, group drag, line drag) needs a single
// {clientX, clientY} regardless of whether it's driven by a mouse or a
// finger. TouchEvent never has its own .clientX/.clientY — it carries a
// .touches (in-progress) or .changedTouches (just lifted) list of Touch
// objects instead, each of which DOES have clientX/clientY. This is the
// one place that distinction gets resolved, so every handler below can
// just work with plain coordinates and not care which input type it is.
function getEventPoint(e){
  if(e.touches && e.touches.length > 0) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  if(e.changedTouches && e.changedTouches.length > 0) return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
  return { clientX: e.clientX, clientY: e.clientY };
}

// Click-to-expand for truncated canvas text — group titles and option
// labels both use -webkit-line-clamp:2 to keep cards a predictable size,
// but that means anything longer than 2 lines was previously just
// silently cut off with no way to read the rest. Event delegation on
// canvasWorld (not per-element listeners) since canvas content re-renders
// constantly — this only ever needs wiring up once, regardless of how
// many times renderGroups repaints the DOM underneath it.
function setupTruncatedTextExpansion(){
  const world = document.getElementById('canvasWorld');
  if(!world || world.dataset.expansionWired) return;
  world.dataset.expansionWired = '1';

  world.addEventListener('click', (e) => {
    const titleSpan = e.target.closest('.canvas-group-title span');
    const optLabel = e.target.closest('.opt-label');
    const target = titleSpan || optLabel;
    if(!target) return;

    // scrollHeight > clientHeight is the reliable signal that
    // -webkit-line-clamp actually clipped something — clicking short
    // text that was never truncated in the first place should just do
    // nothing (and, for option labels, fall through to the normal
    // activate-on-click behavior instead of eating the click).
    const isTruncated = target.scrollHeight > target.clientHeight + 1; // +1px tolerance for sub-pixel rounding
    const isExpanded = target.classList.contains('text-expanded');

    if(!isTruncated && !isExpanded) return; // nothing to expand, let the click do whatever it normally does

    e.preventDefault();
    e.stopPropagation(); // don't also trigger option activation / group drag on this same click

    target.classList.toggle('text-expanded');
    const card = target.closest('.canvas-group');
    if(card) card.classList.toggle('card-popped', target.classList.contains('text-expanded'));
  }, true); // capture phase — needs to intercept BEFORE the option's own activate-on-click listener sees it
}


async function initAppPage(){
  const worldEl = document.getElementById('canvasWorld');
  if(!worldEl) return;

  setupTruncatedTextExpansion();

  const session = await getActiveSession();
  if(!session){
    window.location.href = 'auth.html';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const blueprintId = params.get('blueprint');
  if(!blueprintId){
    window.location.href = 'dashboard.html';
    return;
  }
  canvasState.blueprintId = blueprintId;

  setupCanvasInteractions();
  setupFullscreenToggle();

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') clearMultiSelectStage();
  });
  setupBlueprintTitleEditing();
  await loadGraph();
  renderTourReopenButton();
  // Tracked per BLUEPRINT, not per account — "seen once, ever, anywhere"
  // was the actual bug: once dismissed on any one blueprint, a brand
  // new blueprint would never trigger it again, since the account-wide
  // flag already said "seen." A new blueprint genuinely being opened
  // for the first time is what should trigger this, every time.
  const canvasTourKey = `canvas_${canvasState.blueprintId}`;
  const alreadySeen = hasSeenTour(canvasTourKey);
  console.log(`[ThinkMaps] Canvas tour check — blueprintId: ${canvasState.blueprintId}, key: ${canvasTourKey}, alreadySeen: ${alreadySeen}`);
  if(!alreadySeen) startTour(canvasTourKey, getCanvasTourSteps(), { mandatory: true });
}

// Defined as functions (not a plain array) so mobile-specific wording —
// "long-press" vs "hold Ctrl" — reflects the actual device this runs on,
// resolved fresh every time the tour starts rather than baked in once.
function getCanvasTourSteps(){
  return [
    {
      title: 'Welcome to your Blueprint Graph',
      text: "This is your canvas — a quick tour of the basics. Watch the little cursor — it'll show you exactly what to do."
    },
    {
      selector: '#canvasViewport',
      title: 'Pan around',
      text: isCoarsePointer()
        ? 'Drag anywhere on the canvas with your finger to pan around.'
        : 'Click and drag anywhere on the canvas (not on a card) to pan around.',
      demo: 'pan'
    },
    {
      selector: '.canvas-controls',
      title: 'Zoom in and out',
      text: isCoarsePointer()
        ? 'Use these buttons to zoom, or pinch directly on the canvas.'
        : 'Use these buttons to zoom, or scroll directly on the canvas.',
      demo: 'zoom'
    },
    {
      selector: '.canvas-option',
      title: 'Pick a direction',
      text: 'Click any option to activate it — this spawns new groups branching off your choice, building your path deeper.',
      demo: 'activate'
    },
    {
      selector: '.canvas-option',
      title: 'Or drag to connect',
      text: "You can also click and drag from an option straight onto another option in a group it already spawned — dropping it there activates that one instead of clicking it directly.",
      demo: 'dragActivate'
    },
    {
      selector: '.canvas-group-footer',
      title: 'Not quite right?',
      text: "Retry regenerates this group's options, Random picks one for you, +Custom lets you type your own idea instead of picking one.",
      demo: 'groupFooter'
    },
    // Function, not a plain object — evaluated fresh every time the
    // tour starts (same pattern the mobile-wording steps already use),
    // so this reflects the account's CURRENT Pro status rather than
    // whatever it was the first time the tour ever ran. Returns null
    // for free accounts, which startTour's existing
    // .filter(Boolean) already drops silently — no separate gating
    // logic needed beyond that.
    () => canvasState.isPro ? {
      selector: '.canvas-option',
      title: 'Select multiple at once (Pro)',
      text: isCoarsePointer()
        ? 'Long-press an option, then tap others to select several — combine them into one fused idea.'
        : 'Hold Ctrl and click multiple options to select several — combine them into one fused idea.',
      demo: 'combine'
    } : null
  ];
}

// Same small "?" button pattern already used for Snapshots — appended
// into the existing .canvas-controls cluster rather than needing any
// change to app.html's own markup. Always visible, always restarts the
// tour from scratch regardless of whether it's already been seen.
function renderTourReopenButton(){
  const controls = document.querySelector('.canvas-controls');
  if(!controls || document.getElementById('canvasTourReopenBtn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'canvasTourReopenBtn';
  btn.className = 'zoom-btn';
  btn.title = 'Replay the tour';
  btn.innerHTML = '?';
  btn.addEventListener('click', () => startTour(`canvas_${canvasState.blueprintId}`, getCanvasTourSteps()));
  controls.appendChild(btn);
}

async function loadGraph(){
  const loadingMsg = document.getElementById('canvasLoadingMsg');
  try {
    const res = await authedFetch(`/blueprints/${canvasState.blueprintId}/graph`);
    if(!res) return;

    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not load this blueprint.');
    }

    const data = await res.json();
    canvasState.isLocked = data.blueprint.isLocked;
    canvasState.isPro = !!data.blueprint.isPro;
    canvasState.groups = data.groups;
    canvasState.groupVersions = data.groupVersions;
    canvasState.options = data.options;

    renderSnapshotsButton();
    applyProCanvasTheme();

    // canvasState.lastActivatedOptionId only ever gets set by an actual
    // click within THIS session — on a fresh page load of an already-built
    // blueprint, nothing's been clicked yet here, so without this it would
    // stay null (and the progress bar/breadcrumb would stay hidden) right
    // up until the very next activation. Only runs while it's still null,
    // so it never overrides a real click's choice once one happens.
    if(!canvasState.lastActivatedOptionId){
      canvasState.lastActivatedOptionId = findDeepestLiveOptionId();
    }

    const titleEl = document.getElementById('blueprintTitle');
    if(titleEl) titleEl.textContent = data.blueprint.title;

    const lockedBanner = document.getElementById('lockedBanner');
    if(lockedBanner) lockedBanner.style.display = canvasState.isLocked ? 'block' : 'none';

    if(loadingMsg) loadingMsg.style.display = 'none';

    if(!canvasState.hasCenteredOnce){
      centerCanvasOnRoot();
      canvasState.hasCenteredOnce = true;
    }

    renderCanvas();
    renderPathProgress();
    maybeAutoFrameCompletedPath();
  } catch (err){
    if(loadingMsg){
      loadingMsg.textContent = err.message;
      loadingMsg.style.display = 'block';
    }
  }
}

// ---------- PRO FEATURE: Blueprint Snapshots ----------
// Injected into the existing .canvas-controls cluster (same corner as
// zoom/fullscreen) rather than needing any change to app.html's own
// markup — same "no static HTML needed" pattern used throughout this
// app for dynamically-rendered UI (toasts, modals, the feedback FAB).
function renderSnapshotsButton(){
  const controls = document.querySelector('.canvas-controls');
  if(!controls || document.getElementById('snapshotsBtn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'snapshotsBtn';
  btn.className = 'zoom-btn snapshots-btn';
  btn.title = canvasState.isPro ? 'Snapshots' : 'Snapshots — Pro feature';
  btn.innerHTML = '⧉';
  if(canvasState.isPro) btn.classList.add('pro-glow-btn');
  btn.addEventListener('click', () => {
    if(!canvasState.isPro){
      showToast('Snapshots are a Pro feature — save named checkpoints of your whole graph and restore them anytime.');
      return;
    }
    openSnapshotsModal();
  });
  controls.appendChild(btn);
}

// Real premium visual treatment for Pro canvases — not just a badge
// somewhere, an actual different FEEL to the workspace itself: a subtle
// warm glow behind the canvas dot-grid and a gold-tinted ring around the
// blueprint title. Toggled via a class on the viewport itself so it's a
// pure CSS concern from here on, easy to extend later without touching
// this function again.
function applyProCanvasTheme(){
  const viewport = document.getElementById('canvasViewport');
  if(viewport) viewport.classList.toggle('pro-canvas', !!canvasState.isPro);
  const titleEl = document.getElementById('blueprintTitle');
  if(titleEl) titleEl.classList.toggle('pro-title', !!canvasState.isPro);
}

function closeSnapshotsModal(){
  const overlay = document.getElementById('snapshotsModal');
  if(overlay) overlay.remove();
}

async function openSnapshotsModal(){
  closeSnapshotsModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'snapshotsModal';
  overlay.innerHTML = `
    <div class="modal-card snapshots-modal-card">
      <span class="eyebrow">Pro</span>
      <h3>Snapshots</h3>
      <p class="muted">Save a named checkpoint of your whole graph, restore it anytime — nothing is ever lost when you restore, a safety copy of your current state is saved automatically first.</p>

      <div class="snapshot-save-row">
        <input type="text" id="newSnapshotNameInput" placeholder="e.g. Before trying the B2B angle" maxlength="80" />
        <button class="btn btn-primary" id="saveSnapshotBtn" type="button">Save current state</button>
      </div>
      <p class="auth-error" id="snapshotsError"></p>

      <div class="snapshots-list" id="snapshotsList">
        <div class="confirm-spinner"></div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost" id="closeSnapshotsModalBtn" type="button">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if(e.target === overlay) closeSnapshotsModal(); });
  document.getElementById('closeSnapshotsModalBtn')?.addEventListener('click', closeSnapshotsModal);
  document.getElementById('saveSnapshotBtn')?.addEventListener('click', saveCurrentSnapshot);

  await loadSnapshotsList();
}

async function loadSnapshotsList(){
  const listEl = document.getElementById('snapshotsList');
  if(!listEl) return;

  try {
    const res = await authedFetch(`/blueprints/${canvasState.blueprintId}/snapshots`);
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      listEl.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not load snapshots.')}</p>`;
      return;
    }
    renderSnapshotsList(body.snapshots || []);
  } catch (err) {
    listEl.innerHTML = `<p class="confirm-error">Could not reach the server.</p>`;
  }
}

function renderSnapshotsList(snapshots){
  const listEl = document.getElementById('snapshotsList');
  if(!listEl) return;

  if(snapshots.length === 0){
    listEl.innerHTML = `<p class="muted snapshots-empty">No snapshots yet — save your first checkpoint above.</p>`;
    return;
  }

  listEl.innerHTML = snapshots.map(s => `
    <div class="snapshot-row" data-snapshot-id="${s.id}">
      <div class="snapshot-row-info">
        <span class="snapshot-row-name">${escapeHtml(s.name)}</span>
        <span class="snapshot-row-meta">${new Date(s.createdAt).toLocaleString()} · ${s.groupCount} group${s.groupCount === 1 ? '' : 's'}</span>
      </div>
      <div class="snapshot-row-actions">
        <button class="btn btn-ghost snapshot-restore-btn" type="button" data-id="${s.id}">Restore</button>
        <button class="btn btn-ghost snapshot-delete-btn" type="button" data-id="${s.id}" title="Delete snapshot">✕</button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.snapshot-restore-btn').forEach(btn => {
    btn.addEventListener('click', () => restoreSnapshot(btn.dataset.id, btn));
  });
  listEl.querySelectorAll('.snapshot-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteSnapshot(btn.dataset.id));
  });
}

async function saveCurrentSnapshot(){
  const input = document.getElementById('newSnapshotNameInput');
  const errorEl = document.getElementById('snapshotsError');
  const saveBtn = document.getElementById('saveSnapshotBtn');
  if(errorEl) errorEl.textContent = '';

  const name = (input?.value || '').trim();
  if(!name){
    if(errorEl) errorEl.textContent = 'Name this snapshot before saving.';
    return;
  }

  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const res = await authedFetch(`/blueprints/${canvasState.blueprintId}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      if(errorEl) errorEl.textContent = body.error || 'Could not save this snapshot.';
      return;
    }
    if(input) input.value = '';
    showToast('Snapshot saved.');
    await loadSnapshotsList();
  } catch (err) {
    if(errorEl) errorEl.textContent = 'Could not reach the server. Try again.';
  } finally {
    if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = 'Save current state'; }
  }
}

async function restoreSnapshot(snapshotId, btn){
  if(!confirm('Restore this snapshot? Your current state will be saved automatically first, so nothing is lost.')) return;

  if(btn){ btn.disabled = true; btn.textContent = 'Restoring…'; }

  try {
    const res = await authedFetch(`/blueprints/${canvasState.blueprintId}/snapshots/${snapshotId}/restore`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      showToast(body.error || 'Could not restore this snapshot.');
      if(btn){ btn.disabled = false; btn.textContent = 'Restore'; }
      return;
    }

    canvasState.groups = body.fullGraph.groups;
    canvasState.groupVersions = body.fullGraph.groupVersions;
    canvasState.options = body.fullGraph.options;
    canvasState.lastActivatedOptionId = findDeepestLiveOptionId();
    renderCanvas();
    renderPathProgress();
    centerCanvasOnRoot();
    closeSnapshotsModal();
    showToast('Snapshot restored — your previous state was saved automatically.');
  } catch (err) {
    showToast('Could not reach the server. Try again.');
    if(btn){ btn.disabled = false; btn.textContent = 'Restore'; }
  }
}

async function deleteSnapshot(snapshotId){
  if(!confirm('Delete this snapshot? This can\'t be undone.')) return;

  try {
    const res = await authedFetch(`/blueprints/${canvasState.blueprintId}/snapshots/${snapshotId}`, { method: 'DELETE' });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not delete this snapshot.');
      return;
    }
    await loadSnapshotsList();
  } catch (err) {
    showToast('Could not reach the server. Try again.');
  }
}


// Walks down from the root group, following only each group's CURRENTLY
// ACTIVE version — this is what makes Retry's old versions invisible without
// deleting them, and what makes a frozen sibling branch still render (it's
// still part of the active version, just visually grayed).
function computeVisibleGroups(){
  const groupsById = {};
  canvasState.groups.forEach(g => groupsById[g.id] = g);

  const versionsByGroup = {};
  canvasState.groupVersions.forEach(v => {
    (versionsByGroup[v.group_id] = versionsByGroup[v.group_id] || []).push(v);
  });
  Object.values(versionsByGroup).forEach(list => list.sort((a, b) => a.version_number - b.version_number));

  const optionsByVersion = {};
  canvasState.options.forEach(o => {
    (optionsByVersion[o.group_version_id] = optionsByVersion[o.group_version_id] || []).push(o);
  });

  // One option can now spawn SEVERAL groups at once — this is a one-to-many
  // lookup, not a single connection.
  const groupsByParentOption = {};
  canvasState.groups.forEach(g => {
    if(g.spawned_from_option_id){
      (groupsByParentOption[g.spawned_from_option_id] = groupsByParentOption[g.spawned_from_option_id] || []).push(g);
    }
  });

  const rootGroup = canvasState.groups.find(g => !g.spawned_from_option_id);
  if(!rootGroup) return [];

  const visible = [];
  const visited = new Set();

  function walk(groupId){
    if(visited.has(groupId)) return;
    visited.add(groupId);

    const group = groupsById[groupId];
    if(!group) return;

    const versions = versionsByGroup[groupId] || [];
    const activeVersion = versions.find(v => v.version_number === group.current_version_number) || versions[versions.length - 1];
    const opts = activeVersion ? (optionsByVersion[activeVersion.id] || []) : [];

    visible.push({ group, versions, activeVersion, options: opts });

    opts.forEach(opt => {
      (groupsByParentOption[opt.id] || []).forEach(childGroup => walk(childGroup.id));
    });
  }

  walk(rootGroup.id);
  return visible;
}

function renderCanvas(){
  const visible = computeVisibleGroups();
  const infoByGroupId = computeSiblingBatchInfo(visible);
  renderGroups(visible, infoByGroupId);
  renderLines(visible, infoByGroupId);
  applyWorldTransform();
  renderMultiSelectStatusBar();
}

// Floating bar, injected fresh each render — same "no static markup
// needed" pattern as showToast. Exists mainly for touch users: desktop's
// ctrl+click already telegraphs "you're in a special selection mode"
// through the modifier key itself, but a long-press has no equivalent
// built-in signal, so this makes the resulting state (how many are
// staged, what to do next) visible and gives an explicit Cancel escape
// hatch alongside the existing Escape-key one. Hidden entirely once
// nothing is staged, on both desktop and mobile.
function renderMultiSelectStatusBar(){
  let bar = document.getElementById('multiSelectStatusBar');
  const count = canvasState.multiSelectStagedIds.size;

  if(count === 0){
    if(bar) bar.remove();
    return;
  }

  if(!bar){
    bar = document.createElement('div');
    bar.id = 'multiSelectStatusBar';
    bar.className = 'multi-select-status-bar';
    document.body.appendChild(bar);
  }

  const label = count === 1
    ? '1 option staged — long-press or ctrl+click one more, then tap a staged card to combine'
    : `${count} options staged — tap any highlighted card to combine them`;

  bar.innerHTML = `
    <span class="multi-select-status-text">${escapeHtml(label)}</span>
    <button type="button" class="multi-select-cancel-btn" id="multiSelectCancelBtn">Cancel</button>
  `;

  const cancelBtn = document.getElementById('multiSelectCancelBtn');
  if(cancelBtn) cancelBtn.addEventListener('click', clearMultiSelectStage);
}

// A "batch" is every group spawned from the SAME option activation —
// when one option gets clicked, up to 3 groups appear together, and
// those 3 are each other's "brothers." Root counts as its own batch of
// one. For every visible group, this records two things about its batch:
//  - hasOwnPick: does THIS group have a selected option inside it
//  - batchHasPick: does ANY brother in the same batch (itself included)
//    have a selected option inside it
function computeSiblingBatchInfo(visible){
  const batches = {};
  visible.forEach(({ group, options }) => {
    const batchKey = group.spawned_from_option_id || `root:${group.id}`;
    (batches[batchKey] = batches[batchKey] || []).push({ group, options });
  });

  const infoByGroupId = {};
  Object.values(batches).forEach(batch => {
    const batchHasPick = batch.some(({ options }) => options.some(o => o.is_selected));
    batch.forEach(({ group, options }) => {
      infoByGroupId[group.id] = { hasOwnPick: options.some(o => o.is_selected), batchHasPick };
    });
  });

  return infoByGroupId;
}

// ON-PATH (orange outline, full color): this group has its own pick and
// isn't frozen.
//
// BATCH-FADED (strong fade): a brother spawned in the SAME batch has a
// pick and THIS group doesn't — you engaged with one option out of a
// freshly spawned set, so the others in that exact set visually step
// back. Critically: a batch where NOTHING has been picked in ANY brother
// yet (itself included) never fades — there's no signal about which one
// matters more, so a freshly spawned set stays full color until you
// actually pick something somewhere inside that set.
//
// Frozen always wins over both — it already has its own distinct
// "set aside" treatment and doesn't also need the batch fade on top.
function resolveGroupVisualState(group, info){
  const isOnPath = info.hasOwnPick && !group.is_frozen;
  const isBatchFaded = !group.is_frozen && info.batchHasPick && !info.hasOwnPick;
  return { isOnPath, isBatchFaded };
}

// Must match GENERATE_IDEAS_BLOCK_NAME in server.js exactly — this is the
// one card type that isn't really "a group with options," it's a single
// terminal stop sign at the end of a path that's gone 7 nodes deep.
const GENERATE_IDEAS_BLOCK_NAME = 'Ready to Generate Ideas';

// Must match CUSTOM_IDEA_BLOCK_NAME in server.js exactly — a group of
// this block_name is a blank slate: no AI-generated options, just a
// persistent text box the person fills in themselves.
const CUSTOM_IDEA_BLOCK_NAME = 'Your Own Idea';

// Must match IDEA_CHECKPOINT_BLOCK_NAME in server.js exactly.
const IDEA_CHECKPOINT_BLOCK_NAME = 'The Idea Taking Shape';

// A small, consistent color per canonical block — purely a "what
// territory am I in" recognition cue, built up over enough repeat visits
// that the color alone starts to register before the title text does.
// Deliberately NOT applied to the card border (that's already claimed by
// on-path/frozen signaling) — it lives as a small dot in the header
// instead, so it never competes with or gets overridden by those states.
const BLOCK_COLORS = {
  'Personal Pull': '#A8763E',
  'Personal Connection to the Audience': '#3E7CA8',
  'Personal Read on the Pain': '#A85C5C',
  'Honest Awareness of What Exists': '#5C8C5C',
  'Cross-Pollination & Creative Inspiration': '#8A5CA8',
  'Your Vision for the Experience': '#3E9999',
  'Context, Distribution & Values': '#A88A3E',
  'Personal Stakes & Long-Term Vision': '#6B5CA8',
  'What You Actually Know About Yourself': '#5C73A8',
  // ---- Colors for the 15 new blocks added to IDEATION_BLOCK_NAMES in
  // server.js — kept visually distinct from the original 9 above and
  // from each other, same one-dot-per-block recognition purpose. ----
  'Your Relationship to Risk & Uncertainty': '#B0553E',
  'How You Want This to Feel to Use': '#4E8FA6',
  'Team, Collaborators & Who Else Is Involved': '#7A9E5C',
  'Technical Feasibility & What You Would Need to Learn': '#8C6B3E',
  'Growth, Distribution & How People Would Find This': '#5C7EA8',
  'Business Model Philosophy & How Value Gets Captured': '#A87A3E',
  'Onboarding & First Impressions': '#5CA88C',
  'Data, Privacy & Trust Philosophy': '#6B7A9E',
  'Brand Personality & Tone': '#A85C8A',
  'Habit Formation & Why People Would Return': '#7C9E9E',
  'Accessibility & Who Gets Left Out': '#9E7C5C',
  'Seasonality, Timing & Why Now': '#8A9E5C',
  'Community & Belonging': '#5C9EA0',
  'Worst-Case Scenarios & What Could Go Wrong': '#9E5C6B',
  'Your Long-Term Relationship to This Idea': '#7A5C9E'
};

function blockColorDotHtml(blockName){
  const color = BLOCK_COLORS[blockName];
  return color ? `<span class="block-color-dot" style="background:${color}" aria-hidden="true"></span>` : '';
}

// Finds whichever option in this group is the LIVE selected one — not
// just "is_selected", but specifically the one that hasn't been
// superseded by a sibling picked later in the same group. More than one
// option in a group can end up marked is_selected over time (pick one,
// come back, pick a different one instead); the superseded one's spawned
// children get frozen, which is exactly the signal used here to tell
// "the choice that's still actually live" from "a choice that used to be
// live." Returns null if nothing in this group has ever been selected.
function findLiveSelectedOption(options){
  const selectedOptions = options.filter(o => o.is_selected);
  if(selectedOptions.length === 0) return null;
  const live = selectedOptions.find(o => {
    const children = canvasState.groups.filter(g => g.spawned_from_option_id === o.id);
    return children.length === 0 || children.some(c => !c.is_frozen);
  });
  return live || selectedOptions[selectedOptions.length - 1];
}

// Walks from optionId up to the root, entirely from canvasState — no
// network call. Mirrors the backend's buildPathContextFromOption logic,
// just reading already-loaded client state instead of querying the DB,
// since the progress counter and breadcrumb need to update instantly on
// every graph reload, not wait on a dedicated round trip of their own.
// Returns { depth, trail } where trail is root-to-current option labels.
function computeClientPathTrail(optionId){
  const trail = [];
  let currentOptionId = optionId;

  while(currentOptionId){
    const option = canvasState.options.find(o => o.id === currentOptionId);
    if(!option) break;
    trail.unshift(option.label);

    const version = canvasState.groupVersions.find(v => v.id === option.group_version_id);
    if(!version) break;
    const group = canvasState.groups.find(g => g.id === version.group_id);
    if(!group) break;

    currentOptionId = group.spawned_from_option_id || null;
  }

  return { depth: trail.length, trail };
}

// Finds a sensible default for "the path to show progress for" when
// nothing's been clicked yet THIS session (a fresh load of an
// already-built blueprint) — among every currently-selected option
// sitting in a non-frozen group anywhere in the graph, whichever has
// the greatest depth. Not necessarily THE literal most-recently-clicked
// option (that timestamp isn't tracked anywhere in the data model), but
// a reasonable stand-in: the single most-developed ongoing thread in
// the blueprint, which is the thing actually worth showing progress for.
function findDeepestLiveOptionId(){
  const candidates = canvasState.options.filter(o => {
    if(!o.is_selected) return false;
    const version = canvasState.groupVersions.find(v => v.id === o.group_version_id);
    if(!version) return false;
    const group = canvasState.groups.find(g => g.id === version.group_id);
    return group && !group.is_frozen;
  });

  let deepestOptionId = null;
  let deepestDepth = -1;
  candidates.forEach(o => {
    const { depth } = computeClientPathTrail(o.id);
    if(depth > deepestDepth){
      deepestDepth = depth;
      deepestOptionId = o.id;
    }
  });

  return deepestOptionId;
}

// Must match getPathDepthCap in server.js exactly.
function getPathDepthCap(){
  return canvasState.isPro ? 10 : 7;
}

// Drives the progress bar added between the header and the canvas — the
// breadcrumb trail and the "{depth} of 7" counter, both built from
// whichever option was most recently activated. Hidden entirely until
// that's ever happened, so a brand new blueprint doesn't show an empty
// bar with nothing in it yet.
function renderPathProgress(){
  const bar = document.getElementById('pathProgressBar');
  const breadcrumbEl = document.getElementById('pathBreadcrumb');
  const countEl = document.getElementById('pathProgressCount');
  if(!bar || !breadcrumbEl || !countEl) return;

  if(!canvasState.lastActivatedOptionId){
    bar.style.display = 'none';
    return;
  }

  const { depth, trail } = computeClientPathTrail(canvasState.lastActivatedOptionId);
  if(depth === 0){
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  // Sliding window of the 3 most recent steps, not the whole path from
  // the start — a 7-deep path showing all 7 in one breadcrumb line grows
  // unreadable fast, and "where you are right now" only really needs the
  // last couple of steps for context. depth/PATH_DEPTH_CAP below still
  // reflects the TRUE full-path position regardless of this windowing.
  const windowedTrail = trail.slice(-3);
  breadcrumbEl.innerHTML = windowedTrail
    .map(label => `<span class="crumb">${escapeHtml(label)}</span>`)
    .join('<span class="crumb-sep">→</span>');
  // Scrolled to the most recent end on purpose — even a 3-item window can
  // overflow on a narrow screen, and it should show where you ARE, not
  // where the window starts, every time this updates.
  breadcrumbEl.scrollLeft = breadcrumbEl.scrollWidth;

  countEl.innerHTML = `<span>${depth} of ${getPathDepthCap()}</span>`;
}

// The "look what you built" moment — fires exactly once per terminal
// card, the first time a path reaches depth 7. Walks the WHOLE path
// back to root (not just the terminal card) and smoothly zooms/pans to
// fit all of it on screen at once, instead of the card just quietly
// appearing wherever it happens to land. framedTerminalGroupIds is what
// makes this one-time — without it, every subsequent graph reload while
// that card is still on screen would re-trigger the animation.
function maybeAutoFrameCompletedPath(){
  const newlyCompleted = canvasState.groups.find(g =>
    g.block_name === GENERATE_IDEAS_BLOCK_NAME && !canvasState.framedTerminalGroupIds.has(g.id)
  );
  if(!newlyCompleted) return;

  canvasState.framedTerminalGroupIds.add(newlyCompleted.id);

  const pathGroups = [newlyCompleted];
  let currentOptionId = newlyCompleted.spawned_from_option_id;

  while(currentOptionId){
    const option = canvasState.options.find(o => o.id === currentOptionId);
    if(!option) break;
    const version = canvasState.groupVersions.find(v => v.id === option.group_version_id);
    if(!version) break;
    const group = canvasState.groups.find(g => g.id === version.group_id);
    if(!group) break;
    pathGroups.push(group);
    currentOptionId = group.spawned_from_option_id || null;
  }

  const viewport = document.getElementById('canvasViewport');
  const world = document.getElementById('canvasWorld');
  if(!viewport || !world || pathGroups.length === 0) return;

  // A rough estimate, not pixel-perfect — overshooting the real card
  // height just means slightly more breathing room in the frame, which
  // is a fine trade for not having to measure every actual rendered card.
  const ESTIMATED_CARD_HEIGHT = 260;
  const xs = pathGroups.map(g => g.position_x || 0);
  const ys = pathGroups.map(g => g.position_y || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) + CARD_WIDTH;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys) + ESTIMATED_CARD_HEIGHT;

  const pathWidth = Math.max(maxX - minX, 1);
  const pathHeight = Math.max(maxY - minY, 1);
  const PADDING = 80;

  const availableWidth = viewport.clientWidth - PADDING * 2;
  const availableHeight = viewport.clientHeight - PADDING * 2;

  // Capped at 1x — the goal is "reveal the whole path," not "zoom in
  // tighter than normal" on a path short enough to already fit. The
  // 1.18x boost on top of the raw fit calculation is deliberate: a
  // perfect mathematical fit reads as more zoomed-out than it needs to
  // feel in practice, since it always leaves the full PADDING gap on
  // every side even when the path doesn't need that much breathing
  // room. Letting the far edges crop slightly closer is a better trade
  // than the whole path reading small.
  const rawFitZoom = Math.min(availableWidth / pathWidth, availableHeight / pathHeight, 1);
  const fitZoom = rawFitZoom * 1.18;
  const targetZoom = Math.max(ZOOM_MIN, Math.min(fitZoom, ZOOM_MAX));

  // Centers on the Generate Ideas card itself, not the geometric center
  // of the whole path's bounding box — that terminal card is what
  // actually matters the moment this fires, not an arbitrary midpoint
  // that might land somewhere between two unrelated cards with nothing
  // there. Earlier nodes further from it may sit closer to the edges (or
  // just outside) as a result, which is the right trade here.
  const focusX = (newlyCompleted.position_x || 0) + CARD_WIDTH / 2;
  const focusY = (newlyCompleted.position_y || 0) + ESTIMATED_CARD_HEIGHT / 2;

  const targetPanX = viewport.clientWidth / 2 - focusX * targetZoom;
  const targetPanY = viewport.clientHeight / 2 - focusY * targetZoom;

  world.classList.add('auto-framing');
  canvasState.zoom = targetZoom;
  canvasState.pan = { x: targetPanX, y: targetPanY };
  applyWorldTransform();

  setTimeout(() => world.classList.remove('auto-framing'), 900);
}

function renderGroups(visible, infoByGroupId){
  const layer = document.getElementById('groupsLayer');
  if(!layer) return;
  layer.innerHTML = '';

  const disabledAttr = canvasState.isLocked ? 'disabled' : '';
  const info = infoByGroupId || computeSiblingBatchInfo(visible);

  // Computed once here rather than per-option below: when N options get
  // combined, all N end up is_selected — but only the one the line was
  // actually dragged to (group.spawned_from_option_id) should read as
  // the "main" pick. The rest were swept along, not individually chosen,
  // and the dot color below is what actually communicates that
  // distinction visually.
  const secondaryCombinedIds = new Set();
  visible.forEach(({ group }) => {
    if(Array.isArray(group.combined_source_option_ids) && group.combined_source_option_ids.length > 1){
      group.combined_source_option_ids.forEach(id => {
        if(id !== group.spawned_from_option_id) secondaryCombinedIds.add(id);
      });
    }
  });

  visible.forEach(({ group, versions, options }) => {
    const card = document.createElement('div');
    const { isOnPath, isBatchFaded } = resolveGroupVisualState(group, info[group.id]);
    const isGenerateIdeasNode = group.block_name === GENERATE_IDEAS_BLOCK_NAME;
    const isCustomIdeaNode = group.block_name === CUSTOM_IDEA_BLOCK_NAME;
    const isCheckpointNode = group.block_name === IDEA_CHECKPOINT_BLOCK_NAME;
    const classNames = ['canvas-group'];
    if(group.is_frozen) classNames.push('frozen');
    if(isBatchFaded) classNames.push('batch-unpicked');
    if(isOnPath) classNames.push('on-path');
    if(isGenerateIdeasNode) classNames.push('generate-ideas-node');
    if(isCustomIdeaNode) classNames.push('custom-idea-node');
    if(isCheckpointNode) classNames.push('checkpoint-node');
    card.className = classNames.join(' ');
    card.dataset.groupId = group.id;
    card.style.left = `${group.position_x || 0}px`;
    card.style.top = `${group.position_y || 0}px`;

    const isRootGroup = !group.spawned_from_option_id;

    const versionNav = versions.length > 1 ? `
      <div class="version-nav">
        <button data-action="version-prev" ${group.current_version_number <= versions[0].version_number ? 'disabled' : ''}>‹</button>
        <span>${group.current_version_number}/${versions.length}</span>
        <button data-action="version-next" ${group.current_version_number >= versions[versions.length - 1].version_number ? 'disabled' : ''}>›</button>
      </div>` : '';

    const removeBtnHtml = !isRootGroup && !canvasState.isLocked
      ? `<button class="remove-btn" data-action="remove-group" title="Remove this group">×</button>`
      : '';

    // Same controls markup rendered twice — once for real (right side), once
    // invisible (left side) purely as a width-matching spacer. That's what
    // makes the title genuinely centered no matter what's actually in the
    // controls (just a remove button, a version switcher, both, or neither).
    const controlsHtml = `${versionNav}${removeBtnHtml}`;

    // This path has gone 7 nodes deep — render a single clear call to
    // action instead of an options list. No options to click into, no
    // Retry/Random/Custom (there's nothing to retry or randomize), just
    // one button that goes straight to the same idea-generation flow the
    // header's button triggers.
    if(isGenerateIdeasNode){
      card.innerHTML = `
        <div class="canvas-group-header" data-drag-handle>
          <div class="header-spacer" aria-hidden="true">${controlsHtml}</div>
          <div class="canvas-group-title"><span>${escapeHtml(group.label)}</span></div>
          <div class="header-controls">${controlsHtml}</div>
        </div>
        <div class="canvas-generate-ideas-body">
          <p>This path's gone deep enough to turn into a real idea.</p>
          <button class="btn btn-primary" data-action="generate-ideas-node">Generate Ideas</button>
        </div>
      `;
      layer.appendChild(card);
      return;
    }

    // Three states per option:
    //  - selected (already activated)        → its dot is the next drag SOURCE
    //  - root, or the checkpoint's one big
    //    fork, and not yet activated         → plain click activates it
    //  - any other non-root, not yet picked  → inert; only reachable as a drop target
    //
    // The checkpoint gets folded into root's directly-clickable treatment
    // on purpose — it's the one deliberately dramatic, forced-choice
    // moment in the whole path, and making it click-anywhere instead of
    // drag-to-connect is part of what makes it feel different from every
    // other card, not just look different.
    const optionsHtml = options.map((opt, optionIndex) => {
      const stateClass = opt.is_selected ? 'selected' : ((isRootGroup || isCheckpointNode) ? 'root-clickable' : 'inert');
      const stagedClass = canvasState.multiSelectStagedIds.has(opt.id) ? ' multi-staged' : '';
      const secondaryClass = secondaryCombinedIds.has(opt.id) ? ' selected-secondary' : '';
      // rationale only ever exists on options generated for Pro users
      // (see the isPro branch in generateCandidateBatch on the backend) —
      // free-tier options simply never carry this field, so this check
      // alone is what keeps the "why this fits" hint Pro-exclusive without
      // needing a separate canvasState.isPro check here too.
      const rationaleAttr = opt.rationale ? ` title="${escapeHtml(opt.rationale)}"` : '';
      const rationaleIcon = opt.rationale ? `<span class="opt-rationale-dot" title="${escapeHtml(opt.rationale)}">✦</span>` : '';
      return `
        <div class="canvas-option ${stateClass}${secondaryClass}${stagedClass}" data-option-id="${opt.id}" data-option-index="${optionIndex}"${rationaleAttr}>
          <span class="opt-dot"></span>
          <span class="opt-label">${escapeHtml(opt.label)}</span>
          ${rationaleIcon}
        </div>
      `;
    }).join('');

    // A custom-idea group is a blank slate: whatever's already been typed
    // in renders as a normal, clickable options list (same three states as
    // above). WHILE NOTHING in it has been selected yet, it shows the
    // persistent input for adding more typed options instead of a
    // footer — same reasoning as before: at that point this box is
    // itself one of the things that spawned from a parent selection, not
    // something that's had a selection made ON it yet.
    //
    // But the moment one of ITS OWN options gets selected, that's no
    // longer true — this group now has a live selection just like any
    // other, and needs the same Retry/Random/+Custom footer (scoped to
    // whatever spawned from that selection) as every other group gets.
    // The old version of this branch returned unconditionally before
    // ever reaching that footer logic below, which meant those three
    // buttons could never appear after picking a custom idea, no matter
    // what — capped at 6 typed options, same as every other group's
    // option limit, applies only to the no-selection-yet input row.
    if(isCustomIdeaNode && !findLiveSelectedOption(options)){
      const inputRowHtml = options.length < 6 ? `
        <div class="canvas-custom-row canvas-custom-row-persistent">
          <textarea rows="1" placeholder="Write your own idea…" data-custom-input></textarea>
          <button class="mini-btn" data-action="custom-submit">Add</button>
        </div>` : '';

      card.innerHTML = `
        <div class="canvas-group-header" data-drag-handle>
          <div class="header-spacer" aria-hidden="true">${controlsHtml}</div>
          <div class="canvas-group-title"><span>${escapeHtml(group.label)}</span></div>
          <div class="header-controls">${controlsHtml}</div>
        </div>
        <div class="canvas-group-options">${optionsHtml}</div>
        ${inputRowHtml}
      `;
      layer.appendChild(card);
      return;
    }

    // Footer-targeting rule, uniform for EVERY group including root:
    //  - if nothing inside this group has been picked yet, the footer
    //    targets the group's OWN option list. For root specifically this
    //    is the only time that's true, since root has no parent to defer
    //    button-duty to before anything's been picked — for any other
    //    group, "nothing picked yet" means no footer at all (a freshly
    //    spawned sibling with nothing chosen in it stays footer-less).
    //  - the moment something IS picked, the footer targets whatever
    //    spawned from THAT pick instead — root included. Root can end up
    //    with more than one live selection at once (exploring two niches
    //    in parallel); this resolves to whichever one findLiveSelectedOption
    //    finds first, same deterministic rule used everywhere else.
    const liveSelectedOption = findLiveSelectedOption(options);
    const footerTargetOptionId = liveSelectedOption?.id || null;
    const showFooter = isRootGroup || !!liveSelectedOption;

    // The toggle-able input row only ever makes sense in root's-own-list
    // mode (+Custom there adds a typed option to root's existing list). In
    // post-selection mode, +Custom spawns a whole new sibling group
    // instead — that row would just be dead, unreachable markup there.
    const footerHtml = showFooter ? `
      <div class="canvas-group-footer" ${footerTargetOptionId ? `data-footer-target-option="${footerTargetOptionId}"` : ''}>
        <button class="mini-btn" data-action="retry" ${disabledAttr}>Retry</button>
        <button class="mini-btn" data-action="random" ${disabledAttr}>Random</button>
        <button class="mini-btn" data-action="custom-toggle" ${disabledAttr}>+ Custom</button>
      </div>
      ${footerTargetOptionId ? '' : `<div class="canvas-custom-row" style="display:none;">
        <textarea rows="1" placeholder="Type your own option…" data-custom-input></textarea>
        <button class="mini-btn" data-action="custom-submit">Add</button>
      </div>`}` : '';

    const checkpointIntroHtml = isCheckpointNode
      ? `<div class="checkpoint-intro">An idea is taking shape. Which way does it lean?</div>`
      : '';

    // group.spawned_from_option_id is always the "primary" of a combined
    // activation — already implied by the connecting line drawn on the
    // canvas, so it's left out here; this note only needs to surface the
    // OTHER choices that got folded in alongside it.
    let combinedNoteHtml = '';
    if(Array.isArray(group.combined_source_option_ids) && group.combined_source_option_ids.length > 1){
      combinedNoteHtml = `<div class="combined-pick-note">+ combined with multiple nodes</div>`;
    }

    card.innerHTML = `
      <div class="canvas-group-header" data-drag-handle>
        <div class="header-spacer" aria-hidden="true">${controlsHtml}</div>
        <div class="canvas-group-title">${blockColorDotHtml(group.block_name)}<span>${escapeHtml(group.label)}</span></div>
        <div class="header-controls">${controlsHtml}</div>
      </div>
      ${checkpointIntroHtml}
      ${combinedNoteHtml}
      <div class="canvas-group-options">${optionsHtml}</div>
      ${footerHtml}
    `;

    layer.appendChild(card);
  });

  wireGroupEvents();
}

// Ctrl/Cmd+click toggles an option in or out of the staged combination
// set. Root is excluded entirely — there's no group lookup fallback here
// on purpose, since silently allowing it would contradict the one
// explicit constraint this feature was specced with. Same-batch is
// enforced here too, not just server-side, so a doomed combination never
// even gets as far as a drag attempt.
function toggleMultiSelectStage(optionId, groupId){
  if(!canvasState.isPro){
    showToast('Combining multiple selections is a Pro feature.');
    return;
  }

  const group = canvasState.groups.find(g => g.id === groupId);
  if(!group || !group.spawned_from_option_id) return;

  if(canvasState.multiSelectStagedIds.has(optionId)){
    canvasState.multiSelectStagedIds.delete(optionId);
    renderCanvas();
    return;
  }

  if(canvasState.multiSelectStagedIds.size > 0){
    const [firstStagedId] = canvasState.multiSelectStagedIds;
    const firstStagedOption = canvasState.options.find(o => o.id === firstStagedId);
    const firstStagedVersion = canvasState.groupVersions.find(v => v.id === firstStagedOption?.group_version_id);
    const firstStagedGroup = canvasState.groups.find(g => g.id === firstStagedVersion?.group_id);

    if(firstStagedGroup && firstStagedGroup.spawned_from_option_id !== group.spawned_from_option_id){
      alert('Combined options need to be in the same group, or a brother group from the same batch.');
      return;
    }
  }

  canvasState.multiSelectStagedIds.add(optionId);
  renderCanvas();
}

function clearMultiSelectStage(){
  if(canvasState.multiSelectStagedIds.size === 0) return;
  canvasState.multiSelectStagedIds.clear();
  renderCanvas();
}

// Mobile's answer to ctrl+click: there's no modifier key to hold on a
// touchscreen, so long-press is the gesture that stages an option for a
// combined activation instead. Cancels itself if the finger moves more
// than a few pixels before the hold completes (so panning the canvas or
// scrolling never gets misread as a long-press), and marks the element
// with a short-lived suppressClick flag so the synthetic click every
// mobile browser fires right after a touch doesn't immediately re-open
// or activate the option it just staged.
const LONG_PRESS_DURATION_MS = 480;
const LONG_PRESS_MOVE_CANCEL_PX = 12;

function setupLongPressStaging(optEl, optionId, groupId){
  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  optEl.addEventListener('touchstart', (e) => {
    if(e.touches.length !== 1) return; // a pinch or multi-finger gesture isn't a long-press attempt
    fired = false;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    pressTimer = setTimeout(() => {
      fired = true;
      optEl.dataset.suppressClick = '1';
      if(navigator.vibrate) navigator.vibrate(35); // small haptic confirmation the hold registered
      toggleMultiSelectStage(optionId, groupId);
    }, LONG_PRESS_DURATION_MS);
  }, { passive: true });

  optEl.addEventListener('touchmove', (e) => {
    if(!pressTimer) return;
    const t = e.touches[0];
    if(!t) return;
    const dx = Math.abs(t.clientX - startX);
    const dy = Math.abs(t.clientY - startY);
    if(dx > LONG_PRESS_MOVE_CANCEL_PX || dy > LONG_PRESS_MOVE_CANCEL_PX){
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }, { passive: true });

  optEl.addEventListener('touchend', () => {
    if(pressTimer){
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if(fired){
      // The suppressClick flag only needs to survive long enough to eat
      // the ONE synthetic click this exact touch is about to generate —
      // clearing it shortly after means a genuinely separate later tap
      // on the same element still works normally.
      setTimeout(() => { delete optEl.dataset.suppressClick; }, 400);
    }
  });

  optEl.addEventListener('touchcancel', () => {
    if(pressTimer){
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });
}

function wireGroupEvents(){
  document.querySelectorAll('.canvas-group').forEach(card => {
    const groupId = card.dataset.groupId;

    const dragHandle = card.querySelector('[data-drag-handle]');
    if(dragHandle){
      dragHandle.addEventListener('mousedown', (e) => startGroupDrag(e, groupId));
      dragHandle.addEventListener('touchstart', (e) => startGroupDrag(e, groupId), { passive: false });
    }

    card.querySelectorAll('.canvas-option').forEach(optEl => {
      const optionId = optEl.dataset.optionId;
      const optionIndex = Number(optEl.dataset.optionIndex);
      const dot = optEl.querySelector('.opt-dot');

      // Ctrl/Cmd+click stages this option for a combined activation,
      // intercepting BEFORE the normal click/drag behavior below — an
      // already-selected option can't be staged (it's already active,
      // there's nothing left to "activate" about it), and root is
      // rejected inside toggleMultiSelectStage itself.
      if(!optEl.classList.contains('selected')){
        optEl.addEventListener('click', (e) => {
          if(optEl.dataset.suppressClick === '1'){
            // A long-press JUST fired on this exact element and already
            // staged it — the synthetic click mobile browsers send right
            // after a touch would otherwise immediately activate the
            // option too, undoing the whole point of staging it. Eat
            // this one click, then get out of the way.
            delete optEl.dataset.suppressClick;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if(e.ctrlKey || e.metaKey){
            e.stopPropagation();
            e.preventDefault();
            toggleMultiSelectStage(optionId, groupId);
          }
        });
        // Touch devices have no ctrl/cmd key to hold — long-press is the
        // mobile equivalent of ctrl+click for staging an option toward a
        // combined activation. See setupLongPressStaging below.
        setupLongPressStaging(optEl, optionId, groupId);
      }

      if(optEl.classList.contains('selected')){
        // Already active — drag FROM here to pick the next step.
        if(dot){
          dot.addEventListener('mousedown', (e) => startLineDrag(e, optionId, groupId, optionIndex));
          dot.addEventListener('touchstart', (e) => startLineDrag(e, optionId, groupId, optionIndex), { passive: false });
        }
      } else if(optEl.classList.contains('root-clickable')){
        // Root, never activated — a plain click is the bootstrap trigger,
        // since there's nothing before it to drag from. 'click' already
        // fires from a tap on mobile without any extra wiring, as long as
        // nothing upstream calls preventDefault on the same touch (it
        // doesn't — the viewport's touchstart handler bails out early for
        // any touch that started inside a .canvas-group).
        //
        // Root-clickable AND combinable now genuinely overlaps (pathway
        // options are both) — without the staged-set check below, plain-
        // clicking one of 2+ staged options would silently activate just
        // that one and discard the rest of the staged set with no
        // explanation. Mirrors endLineDrag's exact same check, so a click
        // and a completed drag onto a staged option behave identically.
        optEl.addEventListener('click', (e) => {
          if(optEl.dataset.suppressClick === '1'){
            delete optEl.dataset.suppressClick;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if(e.ctrlKey || e.metaKey) return; // handled by the listener above instead
          if(canvasState.multiSelectStagedIds.size >= 2 && canvasState.multiSelectStagedIds.has(optionId)){
            const others = [...canvasState.multiSelectStagedIds].filter(id => id !== optionId);
            handleCombinedActivate([optionId, ...others]);
            return;
          }
          handleOptionActivate(optionId);
        });
      }
      // 'inert' options do nothing else on their own — they're only
      // reachable as a drop target for someone else's drag (see
      // endLineDrag), or now also via ctrl+click staging above.
    });

    const generateIdeasBtn = card.querySelector('[data-action="generate-ideas-node"]');
    if(generateIdeasBtn) generateIdeasBtn.addEventListener('click', () => {
      const group = canvasState.groups.find(g => g.id === groupId);
      const sourceOptionId = group?.spawned_from_option_id;
      window.location.href = `confirm.html?blueprint=${canvasState.blueprintId}&option=${sourceOptionId}`;
    });

    const removeBtn = card.querySelector('.header-controls [data-action="remove-group"]');
    if(removeBtn) removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveGroup(groupId);
    });

    const prevBtn = card.querySelector('.header-controls [data-action="version-prev"]');
    const nextBtn = card.querySelector('.header-controls [data-action="version-next"]');
    if(prevBtn) prevBtn.addEventListener('click', () => switchVersion(groupId, -1));
    if(nextBtn) nextBtn.addEventListener('click', () => switchVersion(groupId, 1));

    const footerEl = card.querySelector('.canvas-group-footer');
    const footerTargetOptionId = footerEl?.dataset.footerTargetOption || null;

    const retryBtn = card.querySelector('[data-action="retry"]');
    if(retryBtn) retryBtn.addEventListener('click', () => {
      if(footerTargetOptionId) handleRetrySpawned(footerTargetOptionId);
      else handleRetry(groupId);
    });

    const randomBtn = card.querySelector('[data-action="random"]');
    if(randomBtn) randomBtn.addEventListener('click', () => {
      if(footerTargetOptionId) handleRandomSpawned(footerTargetOptionId);
      else handleRandom(groupId);
    });

    const customToggle = card.querySelector('[data-action="custom-toggle"]');
    const customRow = card.querySelector('.canvas-custom-row');
    if(customToggle){
      customToggle.addEventListener('click', () => {
        if(footerTargetOptionId){
          // Post-selection +Custom doesn't toggle an inline row — there
          // isn't one (see renderGroups). It spawns a whole new sibling
          // group instead, since "add one more typed option to an
          // existing group" isn't the same action as "give me a brand
          // new place to write something."
          handleCustomSpawnedGroup(footerTargetOptionId);
        } else if(customRow){
          customRow.style.display = customRow.style.display === 'none' ? 'flex' : 'none';
        }
      });
    }

    const customSubmit = card.querySelector('[data-action="custom-submit"]');
    const customInput = card.querySelector('[data-custom-input]');
    if(customSubmit && customInput){
      customSubmit.addEventListener('click', () => handleCustomOption(groupId, customInput.value));

      // Textareas don't auto-grow on their own — without this, text would
      // wrap invisibly inside a fixed-height box, scrolling instead of
      // actually becoming visible. Resets to 'auto' first so deleting
      // text shrinks it back down too, not just grows one-way.
      customInput.addEventListener('input', () => {
        customInput.style.height = 'auto';
        customInput.style.height = `${customInput.scrollHeight}px`;
      });

      // Enter submits (matching the single-line input this replaced);
      // Shift+Enter still inserts an actual newline for anyone writing
      // something genuinely multi-part.
      customInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          if(window.ThinkMapsFeedback){
            window.ThinkMapsFeedback.pop(customSubmit);
            window.ThinkMapsFeedback.sound();
          }
          handleCustomOption(groupId, customInput.value);
        }
      });
    }
  });
}

function renderLines(visible, infoByGroupId){
  const layer = document.getElementById('linesLayer');
  if(!layer) return;
  layer.innerHTML = '';

  const visibleGroupIds = new Set(visible.map(v => v.group.id));
  const visibleByGroupId = {};
  visible.forEach(entry => { visibleByGroupId[entry.group.id] = entry; });

  const info = infoByGroupId || computeSiblingBatchInfo(visible);
  const isGroupFaded = (g) => g.is_frozen || (info[g.id] && resolveGroupVisualState(g, info[g.id]).isBatchFaded);

  let dottedCount = 0;
  let solidCount = 0;

  visible.forEach(({ group, options }) => {
    // TIER 1 — faint dotted line, group header to group header. Shows up
    // the moment a batch of candidates appears, regardless of whether
    // anything inside them has been chosen yet. Purely structural: "these
    // groups exist because of this group."
    options.forEach(opt => {
      const spawnedGroups = canvasState.groups.filter(g => g.spawned_from_option_id === opt.id);
      spawnedGroups.forEach(childGroup => {
        if(!visibleGroupIds.has(childGroup.id)) return;

        const x1 = (group.position_x || 0) + CARD_WIDTH;
        const y1 = (group.position_y || 0) + estimateHeaderHeight(group.label) / 2;
        const x2 = childGroup.position_x || 0;
        const y2 = (childGroup.position_y || 0) + estimateHeaderHeight(childGroup.label) / 2;

        const dimmed = isGroupFaded(group) || isGroupFaded(childGroup);
        drawConnectorLine(layer, x1, y1, x2, y2, { dotted: true, frozen: childGroup.is_frozen, dimmed });
        dottedCount++;
      });
    });

    // TIER 2 — solid straight line, node to node. Only drawn once a SPECIFIC
    // option inside a spawned group has actually been chosen — terminates
    // precisely at that option's own row, not just at the group's header.
    options.forEach((opt, optionIndex) => {
      if(!opt.is_selected) return;

      const spawnedGroups = canvasState.groups.filter(g => g.spawned_from_option_id === opt.id);
      spawnedGroups.forEach(childGroup => {
        if(!visibleGroupIds.has(childGroup.id)) return;

        const childEntry = visibleByGroupId[childGroup.id];
        if(!childEntry) return;

        const chosenIndex = childEntry.options.findIndex(o => o.is_selected);
        if(chosenIndex === -1) return; // nothing picked inside yet — dotted line above already covers this

        const x1 = (group.position_x || 0) + CARD_WIDTH;
        const y1 = computeRowCenterY(group, options, optionIndex);
        const x2 = childGroup.position_x || 0;
        const y2 = computeRowCenterY(childGroup, childEntry.options, chosenIndex);

        const dimmed = isGroupFaded(group) || isGroupFaded(childGroup);
        drawConnectorLine(layer, x1, y1, x2, y2, { dotted: false, frozen: childGroup.is_frozen, dimmed });
        solidCount++;
      });
    });
  });

  console.log(`[ThinkMaps] renderLines drew ${dottedCount} dotted (group-to-group) + ${solidCount} solid (node-to-node) line(s)`);
}

// A "line" here is just a div, stretched to the right length and rotated to
// point at the target — plain CSS, same coordinate system the group cards
// already use. Dotted lines use a border instead of a background fill so
// they can actually render as dotted; solid ones are a filled bar.
function drawConnectorLine(container, x1, y1, x2, y2, { dotted = false, frozen = false, dimmed = false } = {}){
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  const line = document.createElement('div');
  line.className = `canvas-connector ${dotted ? 'dotted' : ''} ${frozen ? 'frozen' : ''} ${dimmed ? 'dimmed' : ''}`.trim();
  line.style.left = `${x1}px`;
  line.style.top = `${y1}px`;
  line.style.width = `${length}px`;
  line.style.transform = `rotate(${angleDeg}deg)`;

  container.appendChild(line);
}

// Builds the world transform string. Pan values are rounded to the nearest
// whole pixel before being applied — fractional translate values combined
// with a non-1 scale are what cause text to look soft/blurry under CSS
// transforms in most browsers, since the browser ends up compositing on a
// sub-pixel grid instead of a clean one. scale3d (vs. plain scale) is used
// deliberately too — it pushes the element onto the GPU compositing path,
// which renders text noticeably crisper at a fixed zoom level than the 2D
// scale() path in Chrome and Firefox. This won't make zoomed-out text look
// as sharp as zoomed-in text — some softening at small scale is an inherent
// property of rasterizing vector text smaller, not a bug — but it removes
// the avoidable blur on top of that.
function applyWorldTransform(){
  const world = document.getElementById('canvasWorld');
  if(!world) return;
  const panX = Math.round(canvasState.pan.x);
  const panY = Math.round(canvasState.pan.y);
  world.style.transform = `translate(${panX}px, ${panY}px) scale3d(${canvasState.zoom}, ${canvasState.zoom}, 1)`;
}

// The actual zoom fix: every zoom entry point (wheel, pinch, +/- buttons)
// used to only change canvasState.zoom and reapply the transform, with
// no adjustment to pan at all. Since the transform is
// `translate(pan) scale(zoom)`, everything scales around canvasWorld's
// own fixed local origin (0,0) — without compensating the pan, the
// content visibly drifts away from wherever you were actually looking
// every time the zoom level changes, worse the further zoomed in you are.
// This keeps one specific SCREEN point (sx, sy) — the cursor for wheel
// zoom, the pinch midpoint for touch, the viewport center for the
// buttons — anchored in place: whatever world-space point was under
// that screen point before the zoom change is still under it after.
function zoomAtPoint(sx, sy, newZoom){
  const clampedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  const oldZoom = canvasState.zoom;

  const worldX = (sx - canvasState.pan.x) / oldZoom;
  const worldY = (sy - canvasState.pan.y) / oldZoom;

  canvasState.zoom = clampedZoom;
  canvasState.pan = {
    x: sx - worldX * clampedZoom,
    y: sy - worldY * clampedZoom
  };

  applyWorldTransform();
}

function centerCanvasOnRoot(){
  const viewport = document.getElementById('canvasViewport');
  if(!viewport) return;
  canvasState.pan = { x: viewport.clientWidth / 2 - CARD_WIDTH / 2, y: 80 };
  applyWorldTransform();
}

function setCanvasBusy(isBusy, message){
  const viewport = document.getElementById('canvasViewport');
  const indicator = document.getElementById('canvasBusyIndicator');
  if(viewport) viewport.classList.toggle('busy', isBusy);
  if(indicator){
    indicator.style.display = isBusy ? 'block' : 'none';
    if(isBusy) indicator.textContent = message || 'Thinking…';
  }
}

// A click triggers a real wait every time — generation isn't instant.
// Rather than a blank "Thinking…" for all 15+ of those per path, this
// builds one line client-side (no extra AI call) that references the
// SPECIFIC thing just picked, so the wait reads as "the tool is working
// on what I chose" instead of "the tool froze." Picked randomly each
// time so the phrasing itself doesn't become its own repetitive tell.
const ACTIVATION_ACK_TEMPLATES = [
  label => `Following your lead on ${label}…`,
  label => `Building on "${label}"…`,
  label => `Taking "${label}" somewhere specific…`,
  label => `Letting "${label}" shape what's next…`,
  label => `Working out what "${label}" leads to…`
];

function buildActivationAckMessage(label){
  if(!label) return 'Thinking…';
  const trimmed = label.length > 42 ? `${label.slice(0, 39)}…` : label;
  const template = ACTIVATION_ACK_TEMPLATES[Math.floor(Math.random() * ACTIVATION_ACK_TEMPLATES.length)];
  return template(trimmed);
}

// ---------- FULLSCREEN ----------
// Puts just the canvas viewport into the browser's Fullscreen API, not the
// whole page — so the controls and locked-banner (which live inside the
// viewport's parent header) stay reachable via the button's own toggle,
// while the graph itself gets the full screen to breathe in.
function setupFullscreenToggle(){
  const btn = document.getElementById('fullscreenBtn');
  const viewport = document.getElementById('canvasViewport');
  if(!btn || !viewport) return;

  btn.addEventListener('click', () => {
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if(!isFullscreen){
      const request = viewport.requestFullscreen || viewport.webkitRequestFullscreen || viewport.msRequestFullscreen;
      request?.call(viewport);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      exit?.call(document);
    }
  });

  const syncIcon = () => {
    const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    btn.textContent = isFullscreen ? '⤡' : '⛶';
    btn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
  };
  document.addEventListener('fullscreenchange', syncIcon);
  document.addEventListener('webkitfullscreenchange', syncIcon);
}

// ---------- BLUEPRINT TITLE — CLICK TO RENAME ----------
// The title swaps to a real <input> on click, pre-filled and selected, so
// renaming feels the same as renaming a file or a doc title — not a popup,
// not a separate page, just click the name and type.
function setupBlueprintTitleEditing(){
  const titleEl = document.getElementById('blueprintTitle');
  if(!titleEl) return;

  titleEl.title = 'Click to rename';
  titleEl.addEventListener('click', () => {
    if(titleEl.querySelector('input')) return; // already editing — ignore a second click
    startEditingBlueprintTitle(titleEl);
  });
}

function startEditingBlueprintTitle(titleEl){
  const previousTitle = titleEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = previousTitle;
  input.maxLength = 80;
  input.className = 'app-blueprint-title-input';

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();

  // Guards against both Enter (blur fires programmatically) and Escape
  // (we revert immediately) trying to resolve this same edit twice — the
  // second one becomes a no-op instead of double-submitting or re-reverting.
  let settled = false;

  const commit = async () => {
    if(settled) return;
    settled = true;

    const newTitle = input.value.trim();
    if(!newTitle || newTitle === previousTitle){
      titleEl.textContent = previousTitle;
      return;
    }

    titleEl.textContent = newTitle; // optimistic — instant feedback, no AI call involved here

    try {
      const res = await authedFetch(`/blueprints/${canvasState.blueprintId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle })
      });
      if(!res || !res.ok){
        titleEl.textContent = previousTitle; // revert — the rename didn't actually stick
      }
    } catch (err){
      titleEl.textContent = previousTitle;
    }
  };

  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      input.blur(); // triggers commit() below
    }
    if(e.key === 'Escape'){
      e.preventDefault();
      settled = true;
      titleEl.textContent = previousTitle;
    }
  });

  input.addEventListener('blur', commit);
}

function setupCanvasInteractions(){
  const viewport = document.getElementById('canvasViewport');
  if(!viewport) return;

  // Shared by both input types below — mouse and touch each just resolve
  // their own event down to plain coordinates and call into these three.
  function handlePointerDown(e, clientX, clientY){
    if(e.target.closest('.canvas-group')) return; // group/option drag handles its own start
    clearMultiSelectStage();
    isPanning = true;
    panStartPointer = { x: clientX, y: clientY };
    panStartValue = { ...canvasState.pan };
    viewport.classList.add('panning');
  }

  function handlePointerMove(clientX, clientY){
    if(isPanning){
      const dx = clientX - panStartPointer.x;
      const dy = clientY - panStartPointer.y;
      canvasState.pan = { x: panStartValue.x + dx, y: panStartValue.y + dy };
      applyWorldTransform();
    } else if(draggingGroupId){
      const dx = (clientX - dragStartPointer.x) / canvasState.zoom;
      const dy = (clientY - dragStartPointer.y) / canvasState.zoom;
      const group = canvasState.groups.find(g => g.id === draggingGroupId);
      if(group){
        group.position_x = dragStartGroupPos.x + dx;
        group.position_y = dragStartGroupPos.y + dy;
        const card = document.querySelector(`[data-group-id="${draggingGroupId}"]`);
        if(card){
          card.style.left = `${group.position_x}px`;
          card.style.top = `${group.position_y}px`;
        }
        renderLines(computeVisibleGroups());
      }
    } else if(lineDragState){
      updateLineDragPreview(clientX, clientY);
    }
  }

  function handlePointerUp(clientX, clientY){
    if(isPanning){
      isPanning = false;
      viewport.classList.remove('panning');
    }
    if(draggingGroupId){
      const group = canvasState.groups.find(g => g.id === draggingGroupId);
      if(group){
        authedFetch(`/groups/${draggingGroupId}/position`, {
          method: 'PATCH',
          body: JSON.stringify({ positionX: group.position_x, positionY: group.position_y })
        }).catch(() => {});
      }
      draggingGroupId = null;
    }
    if(lineDragState){
      endLineDrag({ clientX, clientY });
    }
  }

  // ---- mouse ----
  viewport.addEventListener('mousedown', (e) => handlePointerDown(e, e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => handlePointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', (e) => handlePointerUp(e.clientX, e.clientY));

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const rect = viewport.getBoundingClientRect();
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, canvasState.zoom + delta);
  }, { passive: false });

  // ---- touch — one finger does whatever mouse would (pan / drag a group /
  // drag a connecting line); two fingers pinch-zoom instead. A pinch
  // starting cancels any single-finger pan that might have begun with the
  // first finger, so going from one finger to two never drags the canvas
  // sideways right as the pinch starts. ----
  let pinchStartDistance = null;
  let pinchStartZoom = null;

  function touchDistance(touches){
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  viewport.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2){
      isPanning = false;
      pinchStartDistance = touchDistance(e.touches);
      pinchStartZoom = canvasState.zoom;
      return;
    }
    if(e.touches.length === 1){
      const t = e.touches[0];
      handlePointerDown(e, t.clientX, t.clientY);
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if(e.touches.length === 2 && pinchStartDistance){
      e.preventDefault();
      const newDistance = touchDistance(e.touches);
      const rect = viewport.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      zoomAtPoint(midX, midY, pinchStartZoom * (newDistance / pinchStartDistance));
      return;
    }
    if(e.touches.length !== 1) return;
    if(!isPanning && !draggingGroupId && !lineDragState) return; // nothing active — don't block default behavior for no reason
    e.preventDefault();
    const t = e.touches[0];
    handlePointerMove(t.clientX, t.clientY);
  }, { passive: false });

  viewport.addEventListener('touchend', (e) => {
    if(e.touches.length === 0){
      pinchStartDistance = null;
      pinchStartZoom = null;
    }
    const t = e.changedTouches[0];
    if(t) handlePointerUp(t.clientX, t.clientY);
  });

  document.getElementById('zoomInBtn')?.addEventListener('click', () => {
    zoomAtPoint(viewport.clientWidth / 2, viewport.clientHeight / 2, canvasState.zoom + 0.1);
  });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
    zoomAtPoint(viewport.clientWidth / 2, viewport.clientHeight / 2, canvasState.zoom - 0.1);
  });
  document.getElementById('zoomResetBtn')?.addEventListener('click', () => {
    canvasState.zoom = 1;
    centerCanvasOnRoot();
  });
}


function startGroupDrag(e, groupId){
  e.stopPropagation();
  e.preventDefault();
  // Dragging is intentionally allowed even on a locked blueprint —
  // repositioning isn't "editing the idea," just rearranging what's there.
  draggingGroupId = groupId;
  const pt = getEventPoint(e);
  dragStartPointer = { x: pt.clientX, y: pt.clientY };
  const group = canvasState.groups.find(g => g.id === groupId);
  dragStartGroupPos = { x: group.position_x || 0, y: group.position_y || 0 };
}

// Drawing the connecting line IS the way a new branch gets created — matches
// the original "draw a connecting line to choose your path" mechanic. Only
// fires on options that don't already lead somewhere; reopening an existing
// one is a plain click instead (see wireGroupEvents).
function startLineDrag(e, optionId, groupId, optionIndex){
  e.stopPropagation();
  e.preventDefault();

  const group = canvasState.groups.find(g => g.id === groupId);
  if(!group) return;

  const groupOptions = getGroupOptionsArray(groupId);
  const startX = (group.position_x || 0) + CARD_WIDTH;
  const startY = computeRowCenterY(group, groupOptions, optionIndex);
  const pt = getEventPoint(e);

  lineDragState = {
    optionId,
    startX, startY,
    initialClientX: pt.clientX,
    initialClientY: pt.clientY,
    currentWorld: null
  };

  highlightEligibleDropTargets(optionId);
  updateLineDragPreview(pt.clientX, pt.clientY);
  console.log('[ThinkMaps] line-drag started from option', optionId);
}

// Visually marks which groups are actually valid drop targets for THIS
// drag — only the groups this exact option spawned. Makes the mechanic
// obvious instead of making the user guess where a drop will register.
function highlightEligibleDropTargets(sourceOptionId){
  const eligibleGroupIds = new Set(
    canvasState.groups.filter(g => g.spawned_from_option_id === sourceOptionId).map(g => g.id)
  );
  document.querySelectorAll('.canvas-group').forEach(card => {
    if(eligibleGroupIds.has(card.dataset.groupId)) card.classList.add('drop-eligible');
  });
}

function clearEligibleDropTargets(){
  document.querySelectorAll('.canvas-group.drop-eligible').forEach(card => card.classList.remove('drop-eligible'));
  document.querySelectorAll('.canvas-option.drop-hover').forEach(el => el.classList.remove('drop-hover'));
}

function updateLineDragPreview(clientX, clientY){
  if(!lineDragState) return;
  const viewport = document.getElementById('canvasViewport');
  const layer = document.getElementById('linesLayer');
  if(!viewport || !layer) return;

  const rect = viewport.getBoundingClientRect();
  const worldX = (clientX - rect.left - canvasState.pan.x) / canvasState.zoom;
  const worldY = (clientY - rect.top - canvasState.pan.y) / canvasState.zoom;

  let previewLine = document.getElementById('lineDragPreview');
  if(!previewLine){
    previewLine = document.createElement('div');
    previewLine.id = 'lineDragPreview';
    previewLine.className = 'canvas-connector drag-preview';
    layer.appendChild(previewLine);
  }

  const dx = worldX - lineDragState.startX;
  const dy = worldY - lineDragState.startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  previewLine.style.left = `${lineDragState.startX}px`;
  previewLine.style.top = `${lineDragState.startY}px`;
  previewLine.style.width = `${length}px`;
  previewLine.style.transform = `rotate(${angleDeg}deg)`;

  lineDragState.currentWorld = { x: worldX, y: worldY };

  // Live feedback — highlight whichever eligible option the cursor is over right now.
  document.querySelectorAll('.canvas-option.drop-hover').forEach(el => el.classList.remove('drop-hover'));
  const target = findOptionElementNear(clientX, clientY);
  if(target) target.classList.add('drop-hover');
}

// Forgiving target detection: try the exact element under the cursor first;
// if that's not precisely an option row but IS somewhere inside a group
// card, fall back to whichever option row in that card is closest — so a
// drop that's a few pixels off the row still lands correctly.
function findOptionElementNear(clientX, clientY){
  const elUnderCursor = document.elementFromPoint(clientX, clientY);
  if(!elUnderCursor) return null;

  const directHit = elUnderCursor.closest('.canvas-option');
  if(directHit) return directHit;

  const groupEl = elUnderCursor.closest('.canvas-group');
  if(!groupEl) return null;

  const optionEls = Array.from(groupEl.querySelectorAll('.canvas-option'));
  if(optionEls.length === 0) return null;

  let closest = null;
  let closestDist = Infinity;
  optionEls.forEach(el => {
    const r = el.getBoundingClientRect();
    const dist = Math.abs(clientY - (r.top + r.height / 2));
    if(dist < closestDist){
      closestDist = dist;
      closest = el;
    }
  });

  return closest;
}

function endLineDrag(e){
  const state = lineDragState;
  lineDragState = null;

  const previewLine = document.getElementById('lineDragPreview');
  if(previewLine) previewLine.remove();
  clearEligibleDropTargets();

  if(!state) return;

  // Barely moved — treat it as an accidental nudge, not a deliberate line draw.
  const movedDist = Math.hypot(e.clientX - state.initialClientX, e.clientY - state.initialClientY);
  if(movedDist < 12){
    console.log('[ThinkMaps] line-drag cancelled — barely moved');
    return;
  }

  const targetOptionEl = findOptionElementNear(e.clientX, e.clientY);
  if(!targetOptionEl){
    console.log('[ThinkMaps] line-drag ended over empty space — no target found');
    return;
  }

  const targetGroupEl = targetOptionEl.closest('.canvas-group');
  const targetGroup = canvasState.groups.find(g => g.id === targetGroupEl?.dataset.groupId);

  if(!targetGroup || targetGroup.spawned_from_option_id !== state.optionId){
    console.log('[ThinkMaps] line-drag ended on the wrong branch', {
      sourceOptionId: state.optionId,
      targetGroupId: targetGroup?.id,
      thatGroupWasSpawnedBy: targetGroup?.spawned_from_option_id
    });
    alert("That connects to a different branch — drag to one of this option's own candidate groups (highlighted while you drag).");
    return;
  }

  const targetOptionId = targetOptionEl.dataset.optionId;

  // Dropped onto a member of a 2+ staged combination set — the dropped-on
  // option becomes the "primary" (the one every existing path-walking
  // function treats as the parent going forward), every OTHER staged
  // option rides along. A staged set of exactly 1 (just the option being
  // dropped on, nothing else) isn't actually a combination — that falls
  // through to the normal single-activation path below unchanged.
  if(canvasState.multiSelectStagedIds.size >= 2 && canvasState.multiSelectStagedIds.has(targetOptionId)){
    const others = [...canvasState.multiSelectStagedIds].filter(id => id !== targetOptionId);
    console.log('[ThinkMaps] line-drag completed — combined activation', { primary: targetOptionId, others });
    if(window.ThinkMapsFeedback){
      window.ThinkMapsFeedback.pop(targetOptionEl);
      window.ThinkMapsFeedback.sound();
    }
    handleCombinedActivate([targetOptionId, ...others]);
    return;
  }

  console.log('[ThinkMaps] line-drag completed — activating option', targetOptionId);
  if(window.ThinkMapsFeedback){
    window.ThinkMapsFeedback.pop(targetOptionEl);
    window.ThinkMapsFeedback.sound();
  }
  handleOptionActivate(targetOptionId);
}

// Extracts complete and in-progress option labels from partial streaming
// JSON. The structure is {"groups":[{"options":[{"label":"..."},...]}]}.
// Returns { complete: string[], inProgress: string|null } where
// inProgress is the label text currently being written character by
// character (no closing quote yet), or null if we're between labels.
function extractStreamingLabels(text){
  const complete = [];
  // Match completed "label":"..." strings (greedy, but the first [^"]* 
  // won't cross the closing quote due to the character class exclusion)
  const completeRegex = /"label":"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match;
  while((match = completeRegex.exec(text)) !== null){
    complete.push(match[1]);
  }

  // Look for an in-progress label: "label":" followed by text that
  // hasn't hit its closing quote yet (i.e. appears at the end of the
  // accumulated stream). The (?!.*") lookahead ensures this only matches
  // if the captured group isn't followed by another quote in the text —
  // i.e. it truly isn't closed yet.
  let inProgress = null;
  const lastQuoteIdx = text.lastIndexOf('"label":"');
  if(lastQuoteIdx !== -1){
    const afterKey = text.slice(lastQuoteIdx + 9); // skip past "label":"
    if(!afterKey.includes('"')){
      // Still being typed — show whatever characters have arrived
      inProgress = afterKey || null;
    }
  }

  return { complete, inProgress };
}

// Updates the canvas busy indicator with the live label stream —
// shows all complete labels, and the currently-typing one with a cursor.
// The first time it's called (tokenCount === 1), it switches the layout
// from the ack message to the streaming list.
function updateStreamingPreview(labels, tokenCount){
  const indicator = document.getElementById('canvasBusyIndicator');
  if(!indicator) return;

  const allItems = [
    ...labels.complete.map(l => `<span class="stream-label stream-label-done">${escapeHtml(l)}</span>`),
    ...(labels.inProgress !== null
      ? [`<span class="stream-label stream-label-typing">${escapeHtml(labels.inProgress)}<span class="stream-cursor">|</span></span>`]
      : [])
  ];

  if(allItems.length === 0){
    indicator.innerHTML = '<span class="stream-label-placeholder">Generating…</span>';
  } else {
    indicator.innerHTML = `<div class="stream-label-list">${allItems.join('')}</div>`;
  }
}


async function handleOptionActivate(optionId){
  if(canvasState.isLocked) return;
  const option = canvasState.options.find(o => o.id === optionId);
  setCanvasBusy(true, buildActivationAckMessage(option?.label));

  let tokenCount = 0;

  try {
    const session = await getActiveSession();
    if(!session){ window.location.href = 'auth.html'; return; }

    // SSE via fetch+ReadableStream — EventSource only supports GET so we
    // can't use it here. The server sends token events live as Mistral
    // generates, then a 'done' event with the full updated graph state.
    const res = await fetch(`${API_BASE_URL}/options/${optionId}/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({})
    });

    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not activate that option.');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamAccumulated = '';
    let lastParsedLabels = [];

    while(true){
      const { done, value } = await reader.read();
      if(done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold the last (possibly incomplete) line

      for(const line of lines){
        if(!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch(e){ continue; }

        if(event.type === 'token'){
          tokenCount++;
          streamAccumulated += event.text;

          // On the very first token, switch from the ack message to the
          // live preview so the user sees actual content appearing.
          if(tokenCount === 1) setCanvasBusy(true, '');

          // Parse complete labels from the accumulated JSON stream and
          // show them progressively — each new complete label appears
          // in the busy indicator as soon as its closing quote arrives,
          // not waiting for the full response. The in-progress label
          // (currently being typed character by character by the model)
          // is shown with a blinking cursor so it reads as live typing.
          const labels = extractStreamingLabels(streamAccumulated);
          if(labels.complete.length !== lastParsedLabels.length || labels.inProgress !== null){
            updateStreamingPreview(labels, tokenCount);
            lastParsedLabels = labels.complete;
          }
        } else if(event.type === 'done'){
          canvasState.lastActivatedOptionId = optionId;
          canvasState.multiSelectStagedIds.clear();
          if(event.fullGraph){
            canvasState.groups = event.fullGraph.groups;
            canvasState.groupVersions = event.fullGraph.groupVersions;
            canvasState.options = event.fullGraph.options;
            renderPathProgress();
            renderCanvas();
            maybeAutoFrameCompletedPath();
          } else {
            await loadGraph(); // fallback if full graph wasn't returned
          }
        } else if(event.type === 'error'){
          alert(event.error || 'Could not activate that option.');
          return;
        }
      }
    }
  } catch (err){
    // Network failure or stream read error — fall back to the old non-streaming path
    try {
      const res = await authedFetch(`/options/${optionId}/activate`, { method: 'POST', body: JSON.stringify({}) });
      if(res && res.ok){
        canvasState.lastActivatedOptionId = optionId;
        canvasState.multiSelectStagedIds.clear();
        const body = await res.json().catch(() => ({}));
        if(body.fullGraph){
          canvasState.groups = body.fullGraph.groups;
          canvasState.groupVersions = body.fullGraph.groupVersions;
          canvasState.options = body.fullGraph.options;
          renderPathProgress();
          renderCanvas();
          maybeAutoFrameCompletedPath();
        } else {
          await loadGraph();
        }
      }
    } catch(fallbackErr){
      alert('Something went wrong activating that option.');
    }
  } finally {
    setCanvasBusy(false);
  }
}

// optionIds[0] is the primary — the one the drag was actually dropped on,
// and the one every subsequent path-walking function (breadcrumb,
// progress counter, auto-frame) treats as the parent going forward.
// Every other ID rides along: selected, frozen-sibling-handled, and
// folded into the generation prompt, without becoming a second traversal
// anchor anywhere else in the app.
async function handleCombinedActivate(optionIds){
  if(canvasState.isLocked) return;
  const labels = optionIds
    .map(id => canvasState.options.find(o => o.id === id)?.label)
    .filter(Boolean);
  setCanvasBusy(true, buildActivationAckMessage(labels.join(' + ')));
  try {
    const res = await authedFetch('/options/combine-activate', { method: 'POST', body: JSON.stringify({ optionIds }) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      console.error('[ThinkMaps] combined activate failed:', body.error, body.detail);
      alert(body.error || 'Could not activate that combination.');
      return;
    }
    canvasState.lastActivatedOptionId = optionIds[0];
    canvasState.multiSelectStagedIds.clear();
    await loadGraph();
  } catch (err){
    alert('Something went wrong activating that combination.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleRemoveGroup(groupId){
  if(canvasState.isLocked) return;
  if(!confirm('Remove this group? Anything that grew from it goes too — this can\'t be undone.')) return;

  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/groups/${groupId}`, { method: 'DELETE' });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not remove that group.');
      return;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong removing that group.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleRetry(groupId){
  if(canvasState.isLocked) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/groups/${groupId}/retry`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not retry this group.');
      return;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong retrying this group.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleRandom(groupId){
  if(canvasState.isLocked) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/groups/${groupId}/random-branch`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not auto-branch.');
      return;
    }
    const body = await res.json();
    if(body.chosenOption?.id){
      canvasState.lastActivatedOptionId = body.chosenOption.id;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong with Random.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleCustomOption(groupId, label){
  if(canvasState.isLocked) return;
  if(!label || !label.trim()) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/groups/${groupId}/custom-option`, {
      method: 'POST',
      body: JSON.stringify({ label })
    });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not add that option.');
      return;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong adding that option.');
  } finally {
    setCanvasBusy(false);
  }
}

// ---- Post-selection Retry/Random/+Custom — see renderGroups for when
// these actually show up versus the per-group versions above. All three
// take the SELECTED OPTION's id, not a group id, since "what spawned
// from this pick" is the thing being acted on. ----

async function handleRetrySpawned(optionId){
  if(canvasState.isLocked) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/options/${optionId}/retry-spawned`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not retry the spawned groups.');
      return;
    }
    const body = await res.json();
    canvasState.lastActivatedOptionId = optionId;
    await loadGraph();
    if(body.skippedForRetryLimit > 0){
      showToast(`${body.skippedForRetryLimit} group${body.skippedForRetryLimit === 1 ? '' : 's'} already hit the free-tier retry limit — upgrade to Pro for unlimited retries.`);
    }
  } catch (err){
    alert('Something went wrong retrying the spawned groups.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleRandomSpawned(optionId){
  if(canvasState.isLocked) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/options/${optionId}/random-spawned`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not auto-branch.');
      return;
    }
    const body = await res.json();
    // chosenOption.id is the specific option the server actually activated —
    // this is what the path counter needs to trace from, not the parent
    // optionId that spawned the groups.
    if(body.chosenOption?.id){
      canvasState.lastActivatedOptionId = body.chosenOption.id;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong with Random.');
  } finally {
    setCanvasBusy(false);
  }
}

async function handleCustomSpawnedGroup(optionId){
  if(canvasState.isLocked) return;
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/options/${optionId}/custom-spawned-group`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not create a custom group.');
      return;
    }
    await loadGraph();
  } catch (err){
    alert('Something went wrong creating a custom group.');
  } finally {
    setCanvasBusy(false);
  }
}

function switchVersion(groupId, direction){
  const group = canvasState.groups.find(g => g.id === groupId);
  if(!group) return;

  const versions = canvasState.groupVersions
    .filter(v => v.group_id === groupId)
    .sort((a, b) => a.version_number - b.version_number);

  const currentIndex = versions.findIndex(v => v.version_number === group.current_version_number);
  const nextIndex = currentIndex + direction;
  if(nextIndex < 0 || nextIndex >= versions.length) return;

  // Optimistic + instant — no AI call involved, nothing worth waiting on.
  group.current_version_number = versions[nextIndex].version_number;
  renderCanvas();

  authedFetch(`/groups/${groupId}/switch-version`, {
    method: 'PATCH',
    body: JSON.stringify({ versionNumber: group.current_version_number })
  }).catch(() => {});
}

// ---------- IDEA GENERATION (IDEATE PAGE) ----------
// Skips entirely on pages without #ideateRoot. One question on screen at a
// time — the "45 intents → AI writes the real question" mechanism lives
// entirely on the backend; this page just renders whatever it's handed.

const ideateState = {
  blueprintId: null,
  sessionId: null
};

async function initIdeatePage(){
  const root = document.getElementById('ideateRoot');
  if(!root) return;

  const session = await getActiveSession();
  if(!session){
    window.location.href = 'auth.html';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const blueprintId = params.get('blueprint');
  if(!blueprintId){
    window.location.href = 'dashboard.html';
    return;
  }
  ideateState.blueprintId = blueprintId;

  try {
    const res = await authedFetch(`/blueprints/${blueprintId}/ideation/start`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      showIdeateError(body.error || 'Could not start idea generation.');
      return;
    }

    ideateState.sessionId = body.sessionId;
    renderIdeateQuestion(body);
  } catch (err){
    showIdeateError('Something went wrong starting this.');
  }
}

function showIdeateError(message){
  const questionEl = document.getElementById('ideateQuestion');
  const optionsEl = document.getElementById('ideateOptions');
  if(questionEl) questionEl.textContent = message;
  if(optionsEl) optionsEl.innerHTML = '';
}

function renderIdeateQuestion(data){
  const nicheEl = document.getElementById('ideateNiche');
  const progressEl = document.getElementById('ideateProgress');
  const fillEl = document.getElementById('ideateProgressFill');
  const questionEl = document.getElementById('ideateQuestion');
  const optionsEl = document.getElementById('ideateOptions');

  if(nicheEl) nicheEl.textContent = data.nicheLabel;
  if(progressEl) progressEl.textContent = `Question ${data.progress.current} of ${data.progress.total}`;
  if(fillEl) fillEl.style.width = `${(data.progress.current - 1) / data.progress.total * 100}%`;
  if(questionEl) questionEl.textContent = data.question.question;

  if(optionsEl){
    optionsEl.innerHTML = '';
    (data.question.options || []).forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'ideate-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => submitIdeateAnswer(opt));
      optionsEl.appendChild(btn);
    });
  }
}

async function submitIdeateAnswer(selectedOption){
  const optionsEl = document.getElementById('ideateOptions');
  const questionEl = document.getElementById('ideateQuestion');

  if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = true);
  if(questionEl) questionEl.textContent = 'Thinking…';

  try {
    const res = await authedFetch(`/ideation/${ideateState.sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selectedOption })
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      showIdeateError(body.error || 'Something went wrong submitting that.');
      return;
    }

    if(body.status === 'completed'){
      renderIdeateResult(body.result);
    } else {
      renderIdeateQuestion(body);
    }
  } catch (err){
    showIdeateError('Something went wrong submitting that.');
  }
}

function renderIdeateResult(result){
  const cardEl = document.getElementById('ideateCard');
  const fillEl = document.getElementById('ideateProgressFill');
  const progressEl = document.getElementById('ideateProgress');
  const resultEl = document.getElementById('ideateResult');

  if(cardEl) cardEl.style.display = 'none';
  if(fillEl) fillEl.style.width = '100%';
  if(progressEl) progressEl.textContent = 'Done';

  if(!resultEl) return;
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <span class="idea-tag">Your first idea concept</span>
    <h2>${escapeHtml(result.name)}</h2>
    <p class="idea-oneliner">${escapeHtml(result.oneLiner)}</p>
    <div class="idea-block"><div class="lbl">Core problem</div><p>${escapeHtml(result.coreProblem)}</p></div>
    <div class="idea-block"><div class="lbl">10x feature</div><p>${escapeHtml(result.tenXFeature)}</p></div>
    <div class="idea-block"><div class="lbl">Monetization</div><p>${escapeHtml(result.monetization)}</p></div>
    <a href="dashboard.html" class="btn btn-primary">Back to dashboard</a>
  `;
}

// ---------- CONFIRMATION PAGE (the 7-node "harden the idea" flow) ----------
// Skips entirely on pages without #confirmRoot. Same one-question-at-a-time
// pattern as the ideate page above, except there are only 3 questions, and
// submitting the 3rd one triggers a genuinely slower deep-research step on
// the backend (competitive landscape, pros adopted, cons solved) — shown
// here as its own distinct "researching" state rather than just another
// quick "Thinking…" flash.

const confirmState = {
  blueprintId: null,
  sourceOptionId: null,
  sessionId: null,
  isPro: false,
  ideaDraft: null,
  deeperAnalysis: null,
  deeperAnalysisRendered: false,
  deeperAnalysisFixes: null,
  rewrittenIdea: null,
  buildBrief: null,
  shareToken: null,
  pendingRevision: null
};

async function initConfirmPage(){
  const root = document.getElementById('confirmRoot');
  if(!root) return;

  const session = await getActiveSession();
  if(!session){
    window.location.href = 'auth.html';
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const blueprintId = params.get('blueprint');
  const sourceOptionId = params.get('option');
  if(!blueprintId || !sourceOptionId){
    window.location.href = 'dashboard.html';
    return;
  }
  confirmState.blueprintId = blueprintId;
  confirmState.sourceOptionId = sourceOptionId;

  // Fetched in parallel with confirm/start below, not before it — these
  // two requests are independent of each other, so there's no reason to
  // pay for them sequentially. Stored on confirmState itself (not a
  // local variable) so renderConfirmResult — which can fire from this
  // function OR from submitConfirmAnswer much later in the flow — can
  // reliably await it regardless of which call site reaches it first. A
  // failure here just leaves isPro at its false default rather than
  // blocking the actual confirmation flow.
  confirmState._profilePromise = authedFetch('/profile')
    .then(res => res && res.ok ? res.json() : null)
    .then(body => { confirmState.isPro = !!body?.pro_status; })
    .catch(() => {});

  try {
    const res = await authedFetch(`/blueprints/${blueprintId}/confirm/start`, {
      method: 'POST',
      body: JSON.stringify({ sourceOptionId })
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      showConfirmError(body.error || 'Could not start hardening this idea.');
      return;
    }

    confirmState.sessionId = body.sessionId;

    if(body.status === 'completed'){
      // This exact path was already hardened before — show what's
      // already there instead of asking the 3 confirmation questions
      // again. deeperAnalysis/rewrittenIdea (if either had already been
      // run too) are picked up here so those sections render directly as
      // well, not just the base idea.
      confirmState.deeperAnalysis = body.deeperAnalysis || null;
      confirmState.rewrittenIdea = body.rewrittenIdea || null;
      confirmState.deeperAnalysisFixes = body.deeperAnalysisFixes || null;
      confirmState.buildBrief = body.buildBrief || null;
      confirmState.shareToken = body.shareToken || null;
      confirmState.pendingRevision = body.pendingRevision || null;
      confirmState.pivots = body.pivots || null;
      confirmState.landingCopy = body.landingCopy || null;
      confirmState.strengthScore = body.strengthScore || null;
      confirmState.personas = body.personas || null;
      confirmState.launchChecklist = body.launchChecklist || null;
      confirmState.redTeam = body.redTeam || null;
      confirmState.spyMode = body.spyMode || null;
      renderConfirmResult(body.result);
      return;
    }

    renderIdeaDraftContext(body.ideaDraft);
    renderConfirmQuestion(body);
  } catch (err){
    showConfirmError('Something went wrong starting this.');
  }
}

function showConfirmError(message){
  const questionEl = document.getElementById('confirmQuestion');
  const optionsEl = document.getElementById('confirmOptions');
  if(questionEl) questionEl.textContent = message;
  if(optionsEl) optionsEl.innerHTML = '';
}

// Shown above every confirmation question, not just the first — each of
// the 5 questions pressure-tests a specific part of this exact draft
// (the problem, the audience, the monetization model, etc.), and without
// this, someone answering "which monetization model fits" had no way to
// know what the idea even WAS yet, only the path of canvas choices that
// led here. Rendered once; the draft itself never changes between
// confirmation answers, only the questions about it do, so this never
// needs to re-render on subsequent questions.
function renderIdeaDraftContext(ideaDraft){
  const el = document.getElementById('ideaDraftContext');
  if(!el || !ideaDraft) return;

  confirmState.ideaDraft = ideaDraft;

  el.innerHTML = `
    <span class="idea-tag">The idea taking shape — these questions are about sharpening this</span>
    <h3 class="idea-draft-name">${escapeHtml(ideaDraft.name || '')}</h3>
    <p class="idea-draft-oneliner">${escapeHtml(ideaDraft.oneLiner || '')}</p>
    <div class="idea-draft-fields">
      <div><span class="lbl">Problem</span><p>${escapeHtml(ideaDraft.coreProblem || '')}</p></div>
      <div><span class="lbl">Who it's for</span><p>${escapeHtml(ideaDraft.targetAudience || '')}</p></div>
      <div><span class="lbl">Core feature</span><p>${escapeHtml(ideaDraft.coreFeature || '')}</p></div>
      <div><span class="lbl">Monetization</span><p>${escapeHtml(ideaDraft.monetization || '')}</p></div>
    </div>
  `;
  el.style.display = 'block';
}

function renderConfirmQuestion(data){
  const progressEl = document.getElementById('confirmProgress');
  const fillEl = document.getElementById('confirmProgressFill');
  const questionEl = document.getElementById('confirmQuestion');
  const optionsEl = document.getElementById('confirmOptions');

  if(progressEl) progressEl.textContent = `Confirmation ${data.progress.current} of ${data.progress.total}`;
  if(fillEl) fillEl.style.width = `${(data.progress.current - 1) / data.progress.total * 100}%`;
  if(questionEl) questionEl.textContent = data.question.question;

  if(optionsEl){
    optionsEl.innerHTML = '';
    (data.question.options || []).forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'ideate-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => submitConfirmAnswer(opt, data.progress.current, data.progress.total));
      optionsEl.appendChild(btn);
    });
  }

  const cardEl = document.getElementById('confirmCard');
  let aiAnswerBtn = document.getElementById('aiAnswerBtn');
  if(!aiAnswerBtn && cardEl){
    aiAnswerBtn = document.createElement('button');
    aiAnswerBtn.id = 'aiAnswerBtn';
    aiAnswerBtn.type = 'button';
    aiAnswerBtn.className = 'btn btn-ghost ai-answer-btn';
    aiAnswerBtn.textContent = 'Let AI Answer';
    cardEl.appendChild(aiAnswerBtn);
  }
  if(aiAnswerBtn){
    aiAnswerBtn.disabled = false;
    aiAnswerBtn.textContent = 'Let AI Answer';
    aiAnswerBtn.onclick = () => runAiAnswer(data.progress.current, data.progress.total);
  }
}

// Picks an answer on the person's behalf, then submits it through the
// exact same submitConfirmAnswer path a real click would take — this
// never duplicates the recording/progression logic, it just supplies a
// different source for which option text gets submitted.
async function runAiAnswer(currentQuestionNumber, totalQuestions){
  const optionsEl = document.getElementById('confirmOptions');
  const aiAnswerBtn = document.getElementById('aiAnswerBtn');

  if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = true);
  if(aiAnswerBtn){
    aiAnswerBtn.disabled = true;
    aiAnswerBtn.textContent = 'Thinking…';
  }

  let res;
  try {
    res = await authedFetch(`/confirm/${confirmState.sessionId}/answer-for-me`, { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    if(aiAnswerBtn) aiAnswerBtn.textContent = 'Could not reach the server — try again';
    if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
    if(aiAnswerBtn) aiAnswerBtn.disabled = false;
    return;
  }
  if(!res) return;

  let body;
  try {
    body = await res.json();
  } catch (err) {
    if(aiAnswerBtn) aiAnswerBtn.textContent = `Server responded unexpectedly (status ${res.status}) — try again`;
    if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
    if(aiAnswerBtn) aiAnswerBtn.disabled = false;
    return;
  }

  if(!res.ok || !body.selected){
    if(aiAnswerBtn) aiAnswerBtn.textContent = body.error || 'Could not pick an answer — try again';
    if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
    if(aiAnswerBtn) aiAnswerBtn.disabled = false;
    return;
  }

  // Visually highlight whichever option the AI picked, briefly, before
  // the normal submit flow takes over — so it reads as "the AI chose
  // this one" rather than jumping straight to the next question with no
  // visible link between the button press and what got picked.
  if(optionsEl){
    const matchingBtn = [...optionsEl.querySelectorAll('.ideate-option')].find(b => b.textContent === body.selected);
    if(matchingBtn) matchingBtn.classList.add('ai-picked');
  }

  setTimeout(() => submitConfirmAnswer(body.selected, currentQuestionNumber, totalQuestions), 500);
}

// The exact three progress messages server.js's SSE pipeline sends
// during final confirmation-answer synthesis (see sendProgress calls in
// the /confirm/:sessionId/answer route) — kept here so the step
// checklist below can match incoming messages to a fixed position
// rather than just appending an open-ended list of whatever text shows
// up. If the server ever sends something outside this set, it still
// falls back to plain text instead of silently dropping the update.
const RESEARCH_STEP_MESSAGES = [
  'Researching what already exists in this space…',
  'Identifying how to address competitor weaknesses…',
  'Synthesizing your final hardened idea…'
];

// Renders (or re-renders) the step checklist inside #confirmResearching,
// marking everything before the current message as done, the current
// message as active (with a pulsing marker), and anything after as
// still pending. Replaces the old "one spinner, one line of swapped
// text" state — the 30-40 second wait during final synthesis now reads
// as visible forward motion through 3 concrete stages instead of an
// ambiguous single spinner someone might assume has frozen.
function renderResearchStepsList(currentMessage){
  const researchingEl = document.getElementById('confirmResearching');
  if(!researchingEl) return;

  const currentIndex = RESEARCH_STEP_MESSAGES.indexOf(currentMessage);

  const stepsHtml = RESEARCH_STEP_MESSAGES.map((msg, i) => {
    let stateClass = '';
    if(currentIndex === -1){
      // Message didn't match any known step (unexpected server text) —
      // don't guess at step state, just leave everything neutral and
      // rely on the fallback line below to actually convey what's happening.
      stateClass = '';
    } else if(i < currentIndex){
      stateClass = 'done';
    } else if(i === currentIndex){
      stateClass = 'active';
    }
    return `
      <div class="research-step ${stateClass}">
        <span class="research-step-marker"></span>
        <span>${escapeHtml(msg.replace('…', ''))}</span>
      </div>
    `;
  }).join('');

  const fallbackLine = currentIndex === -1
    ? `<p>${escapeHtml(currentMessage || 'Working on it…')}</p>`
    : '';

  researchingEl.innerHTML = `
    <div class="confirm-spinner"></div>
    ${fallbackLine}
    <div class="research-steps-list">${stepsHtml}</div>
  `;
}

async function submitConfirmAnswer(selectedOption, currentQuestionNumber, totalQuestions){
  const optionsEl = document.getElementById('confirmOptions');
  const questionEl = document.getElementById('confirmQuestion');
  const cardEl = document.getElementById('confirmCard');
  const researchingEl = document.getElementById('confirmResearching');
  const aiAnswerBtn = document.getElementById('aiAnswerBtn');

  if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = true);
  if(aiAnswerBtn) aiAnswerBtn.disabled = true;

  const isLastQuestion = currentQuestionNumber >= totalQuestions;
  if(isLastQuestion){
    if(cardEl) cardEl.style.display = 'none';
    if(researchingEl) researchingEl.style.display = 'block';
    renderResearchStepsList(RESEARCH_STEP_MESSAGES[0]);
  } else if(questionEl){
    questionEl.textContent = 'Thinking…';
  }

  try {
    const session = await getActiveSession();
    if(!session){ window.location.href = 'auth.html'; return; }

    const res = await fetch(`${API_BASE_URL}/confirm/${confirmState.sessionId}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ selectedOption })
    });

    if(!res.ok){
      // Non-SSE error response (questions 1-3 or a real 4xx/5xx before
      // the pipeline even started)
      const body = await res.json().catch(() => ({}));
      if(researchingEl) researchingEl.style.display = 'none';
      if(cardEl) cardEl.style.display = 'block';
      // Re-enable buttons so user can try again
      if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
      if(aiAnswerBtn) aiAnswerBtn.disabled = false;
      showConfirmError(body.error || 'Could not submit that confirmation answer.');
      return;
    }

    const contentType = res.headers.get('content-type') || '';

    if(contentType.includes('text/event-stream')){
      // SSE path — only the final question takes this route.
      // Read progress events and update the researching overlay,
      // then handle the done/error event at the end.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while(true){
        const { done, value } = await reader.read();
        if(done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for(const line of lines){
          if(line.startsWith(': ')) continue; // heartbeat comment — ignore
          if(!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch(e){ continue; }

          if(event.type === 'progress'){
            renderResearchStepsList(event.message);
          } else if(event.type === 'done'){
            if(event.status === 'completed'){
              renderConfirmResult(event.result);
            } else {
              if(researchingEl) researchingEl.style.display = 'none';
              if(cardEl) cardEl.style.display = 'block';
              renderConfirmQuestion(event);
            }
          } else if(event.type === 'error'){
            if(researchingEl) researchingEl.style.display = 'none';
            if(cardEl) cardEl.style.display = 'block';
            if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
            if(aiAnswerBtn) aiAnswerBtn.disabled = false;
            showConfirmError(event.error || 'Something went wrong during research.');
          }
        }
      }
    } else {
      // Regular JSON path — questions 1-3.
      const body = await res.json();
      if(body.status === 'completed'){
        renderConfirmResult(body.result);
      } else {
        if(cardEl) cardEl.style.display = 'block';
        renderConfirmQuestion(body);
      }
    }
  } catch (err){
    if(researchingEl) researchingEl.style.display = 'none';
    if(cardEl) cardEl.style.display = 'block';
    if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = false);
    if(aiAnswerBtn) aiAnswerBtn.disabled = false;
    showConfirmError('Could not submit that confirmation answer. Check your connection and try again.');
  }
}

async function renderConfirmResult(result){
  // Guarantees isPro is genuinely known before anything below decides
  // whether to render a tool as active or pro-gated — regardless of
  // which of the two call sites (initConfirmPage's main flow, or
  // submitConfirmAnswer much later in the question flow) got here first.
  await (confirmState._profilePromise || Promise.resolve());

  const cardEl = document.getElementById('confirmCard');
  const researchingEl = document.getElementById('confirmResearching');
  const fillEl = document.getElementById('confirmProgressFill');
  const progressEl = document.getElementById('confirmProgress');
  const resultEl = document.getElementById('confirmResult');
  const draftContextEl = document.getElementById('ideaDraftContext');

  if(cardEl) cardEl.style.display = 'none';
  if(researchingEl) researchingEl.style.display = 'none';
  if(draftContextEl) draftContextEl.style.display = 'none';
  if(fillEl) fillEl.style.width = '100%';
  if(progressEl) progressEl.textContent = 'Done';

  if(!resultEl) return;
  resultEl.style.display = 'block';

  const competitorsHtml = (result.competitors || []).map(c => `
    <div class="competitor-block">
      <div class="competitor-name">${escapeHtml(c.name)}</div>
      <div class="competitor-cols">
        <div>
          <div class="lbl lbl-pro">What works</div>
          <ul>${(c.pros || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
        </div>
        <div>
          <div class="lbl lbl-con">What doesn't</div>
          <ul>${(c.cons || []).map(con => `<li>${escapeHtml(con)}</li>`).join('')}</ul>
        </div>
      </div>
    </div>
  `).join('');

  const solutionsHtml = (result.solutions || []).map(s => `
    <div class="solution-block">
      <div class="solution-problem">${escapeHtml(s.problem)}</div>
      <div class="solution-arrow">→</div>
      <div class="solution-fix">${escapeHtml(s.solution)}</div>
    </div>
  `).join('');

  resultEl.innerHTML = `
    <div id="ideaCoreSection"></div>
    <div id="reviseIdeaSection"></div>

    ${competitorsHtml ? `<h3 class="confirm-section-title">What's already out there</h3><div class="competitors-list">${competitorsHtml}</div>` : ''}
    ${solutionsHtml ? `<h3 class="confirm-section-title">How this idea solves their weak points</h3><div class="solutions-list">${solutionsHtml}</div>` : ''}

    <div id="deeperAnalysisSection"></div>

    <div id="buildBriefSection"></div>

    <div class="idea-toolkit">
      <div class="idea-toolkit-header-row">
        <div>
          <h3 class="confirm-section-title">Idea toolkit</h3>
          <p class="idea-toolkit-intro muted">Everything below builds on the hardened idea above — take what's useful, skip what isn't.</p>
        </div>
        <button type="button" class="btn btn-ghost toolkit-tour-reopen-btn" id="toolkitTourReopenBtn">What does each of these do?</button>
      </div>

      <div class="toolkit-grid">
        <div class="toolkit-card" id="strengthScoreCard"></div>
        <div class="toolkit-card" id="pivotsCard"></div>
        <div class="toolkit-card" id="personasCard"></div>
        <div class="toolkit-card" id="landingCopyCard"></div>
        <div class="toolkit-card" id="redTeamCard"></div>
        <div class="toolkit-card" id="spyModeCard"></div>
        <div class="toolkit-card" id="launchChecklistCard"></div>
        <div class="toolkit-card" id="exportCard"></div>
      </div>
    </div>

    <div class="confirm-final-actions">
      <div id="shareLinkSection"></div>
      <a href="dashboard.html" class="btn btn-primary">Back to dashboard</a>
    </div>
  `;

  // Which idea to show is independent of whether deeper analysis has
  // run — rewrittenIdea now comes exclusively from a committed Suggest
  // Changes revision (a completely unrelated feature to deeper
  // analysis), so committing one should have no bearing on whether the
  // market intel / risk plan / fixes section below is shown.
  renderIdeaCore(confirmState.rewrittenIdea || result, !!confirmState.rewrittenIdea);

  const deeperEl = document.getElementById('deeperAnalysisSection');
  if(deeperEl && !confirmState.deeperAnalysisRendered){
    if(confirmState.deeperAnalysis){
      renderDeeperAnalysis(confirmState.deeperAnalysis);
    } else {
      renderProGatedButton(deeperEl, 'Run Market Intel & Risk Analysis', runDeeperAnalysis);
    }
  }

  // These three are independent of whichever branch above just ran —
  // each works off "whichever idea is currently live" rather than caring
  // whether a rewrite has happened, so they're rendered once, here,
  // regardless.
  renderReviseSection();
  renderBuildBriefSection();
  renderShareLinkSection();
  initIdeaToolkit();
}

// The swappable "core idea" block — name through the full pitch
// description. Rendered once with the original hardened idea; re-rendered
// in place with the rewritten version if/when "Rewrite Idea" runs,
// without touching the competitors/solutions sections below it (those
// are factual research findings that don't change on rewrite — the
// rewrite function carries them forward unchanged for exactly this
// reason).
function renderIdeaCore(idea, isRewrite = false){
  const coreEl = document.getElementById('ideaCoreSection');
  if(!coreEl) return;

  coreEl.innerHTML = `
    <span class="idea-tag">${isRewrite ? 'Rewritten using market intel &amp; risk analysis' : "Your hardened idea"}</span>
    <h2>${escapeHtml(idea.name)}</h2>
    <p class="idea-oneliner">${escapeHtml(idea.oneLiner)}</p>

    <div class="idea-block"><div class="lbl">Core problem</div><p>${escapeHtml(idea.coreProblem)}</p></div>
    <div class="idea-block"><div class="lbl">Who it's for</div><p>${escapeHtml(idea.targetAudience || '')}</p></div>
    <div class="idea-block"><div class="lbl">Core feature</div><p>${escapeHtml(idea.coreFeature || '')}</p></div>
    <div class="idea-block"><div class="lbl">Monetization</div><p>${escapeHtml(idea.monetization)}</p></div>
    <div class="idea-block"><div class="lbl">Competitive edge</div><p>${escapeHtml(idea.competitiveEdge || '')}</p></div>

    ${idea.fullDescription ? `<h3 class="confirm-section-title">The pitch</h3><p class="confirm-full-description">${escapeHtml(idea.fullDescription)}</p>` : ''}
  `;
}

// ---- NEXT PHASE: Market Intel -> Synthetic Panel -> Risk-Prioritized
// Plan. Triggered from the button rendered above, only once an idea has
// already been hardened. ----

async function runDeeperAnalysis(){
  const deeperEl = document.getElementById('deeperAnalysisSection');
  if(!deeperEl) return;

  deeperEl.innerHTML = `
    <div class="confirm-researching">
      <div class="confirm-spinner"></div>
      <p id="deeperAnalysisProgressMsg">Pulling competitor pricing, real chatter about the problem, and running a simulated reaction panel — this takes longer than the steps before it.</p>
    </div>
  `;

  try {
    const session = await getActiveSession();
    if(!session){ window.location.href = 'auth.html'; return; }

    const res = await fetch(`${API_BASE_URL}/confirm/${confirmState.sessionId}/deeper-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({})
    });

    const contentType = res.headers.get('content-type') || '';

    if(contentType.includes('text/event-stream')){
      // The actual generation pipeline — genuinely slow (20-40+ seconds),
      // which is exactly why this is SSE with a heartbeat now instead of
      // a plain POST: a regular request has no way to survive Render's
      // ~30-second HTTP timeout, which is almost certainly what "Could
      // not run deeper analysis" actually was, intermittently.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while(true){
        const { done, value } = await reader.read();
        if(done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for(const line of lines){
          if(line.startsWith(': ')) continue; // heartbeat comment — ignore
          if(!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch(e){ continue; }

          if(event.type === 'progress'){
            const msgEl = document.getElementById('deeperAnalysisProgressMsg');
            if(msgEl) msgEl.textContent = event.message;
          } else if(event.type === 'done'){
            confirmState.deeperAnalysis = event.deeperAnalysis;
            renderDeeperAnalysis(event.deeperAnalysis);
          } else if(event.type === 'error'){
            deeperEl.innerHTML = `<p class="confirm-error">${escapeHtml(event.error || 'Could not run deeper analysis.')}</p>`;
          }
        }
      }
      return;
    }

    // Non-SSE path — only ever hit if the session already had cached
    // deeper_analysis (the route's early-return, still plain JSON since
    // there's no slow work to survive a timeout for in that case).
    const body = await res.json();
    if(!res.ok){
      deeperEl.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not run deeper analysis.')}</p>`;
      return;
    }

    confirmState.deeperAnalysis = body.deeperAnalysis;
    renderDeeperAnalysis(body.deeperAnalysis);
  } catch (err) {
    deeperEl.innerHTML = `<p class="confirm-error">Something went wrong running deeper analysis.</p>`;
  }
}

function renderDeeperAnalysis(deeperAnalysis){
  const deeperEl = document.getElementById('deeperAnalysisSection');
  if(!deeperEl) return;
  confirmState.deeperAnalysisRendered = true;

  const intel = deeperAnalysis.marketIntel || {};
  const panel = deeperAnalysis.syntheticPanel || {};
  const riskPlan = deeperAnalysis.riskPlan || {};

  const pricingHtml = (intel.competitorPricing || []).map(p => `
    <div class="pricing-row">
      <span class="pricing-competitor">${escapeHtml(p.competitor)}</span>
      <span class="pricing-amount">${escapeHtml(p.pricing)}</span>
    </div>
  `).join('');

  const chatterHtml = (intel.forumChatter || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');

  // Disclaimer rendered TWICE deliberately — once as the section's own
  // banner, once repeated right above the persona grid itself. This is
  // the one place in the whole app a model output could plausibly get
  // mistaken for real validation data, so it's labeled hard everywhere
  // it's shown, not just once at the top where it's easy to scroll past.
  const personaDisclaimer = `<p class="simulated-disclaimer">⚠ Simulated reactions, not real feedback — these are hypothetical, AI-generated personas, not actual user research.</p>`;

  const personasHtml = (panel.personas || []).map(p => `
    <div class="persona-card">
      <div class="persona-name">${escapeHtml(p.name)}</div>
      <div class="persona-background">${escapeHtml(p.background)}</div>
      <div class="persona-row"><span class="lbl">Reaction</span><p>${escapeHtml(p.reaction)}</p></div>
      <div class="persona-row"><span class="lbl">Biggest objection</span><p>${escapeHtml(p.objection)}</p></div>
      <div class="persona-row"><span class="lbl">Would actually pay if</span><p>${escapeHtml(p.wouldPay)}</p></div>
    </div>
  `).join('');

  const severityRank = { high: 0, medium: 1, low: 2 };
  const sortedRisks = [...(riskPlan.risks || [])].sort((a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3));

  const risksHtml = sortedRisks.map(r => `
    <div class="risk-card risk-${escapeHtml(r.severity || 'medium')}">
      <div class="risk-header">
        <span class="risk-severity-tag">${escapeHtml((r.severity || 'medium').toUpperCase())}</span>
        <span class="risk-assumption">${escapeHtml(r.assumption)}</span>
      </div>
      ${r.addressedBy ? `<p class="risk-addressed"><strong>Already partly addressed:</strong> ${escapeHtml(r.addressedBy)}</p>` : ''}
      ${r.nextStep ? `<p class="risk-next-step"><strong>Next step:</strong> ${escapeHtml(r.nextStep)}</p>` : ''}
    </div>
  `).join('');

  deeperEl.innerHTML = `
    <h3 class="confirm-section-title">Deeper market intel</h3>
    ${pricingHtml ? `<div class="pricing-list">${pricingHtml}</div>` : ''}
    ${intel.sentimentSummary ? `<p class="idea-block-p">${escapeHtml(intel.sentimentSummary)}</p>` : ''}
    ${chatterHtml ? `<div class="idea-block"><div class="lbl">Real chatter about the pain point</div><ul>${chatterHtml}</ul></div>` : ''}

    <h3 class="confirm-section-title">Simulated user panel</h3>
    ${personaDisclaimer}
    <div class="personas-grid">${personasHtml}</div>

    <h3 class="confirm-section-title">Risk-prioritized plan</h3>
    <div class="risks-list">${risksHtml}</div>

    <div id="deeperFixesSection"></div>
  `;

  deeperEl.classList.add('result-section-enter');
  renderDeeperFixesSection();
}

// Below the deeper analysis, not replacing it — the idea itself
// (ideaCoreSection) is never touched here. Used to regenerate the WHOLE
// idea in place, but that meant a click could change parts that had
// nothing to do with what the analysis actually found. This generates
// concrete fixes for the SPECIFIC risks and objections surfaced, same
// {problem, solution} visual pattern as the competitor solutions list
// above, so addressing a real risk reads the same way as addressing a
// real competitor weakness.
function renderDeeperFixesSection(){
  const el = document.getElementById('deeperFixesSection');
  if(!el) return;

  if(confirmState.deeperAnalysisFixes){
    renderDeeperFixes(confirmState.deeperAnalysisFixes);
    return;
  }

  renderProGatedButton(el, 'Find Fixes for These Risks', runDeeperFixes);
}

async function runDeeperFixes(){
  const el = document.getElementById('deeperFixesSection');
  if(!el) return;

  el.innerHTML = `
    <div class="confirm-researching">
      <div class="confirm-spinner"></div>
      <p>Working out how this idea, as it already stands, can address the risks and objections above…</p>
    </div>
  `;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/deeper-fixes`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate fixes.')}</p>`;
      return;
    }

    confirmState.deeperAnalysisFixes = body.fixes;
    renderDeeperFixes(body.fixes);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating fixes.</p>`;
  }
}

function renderDeeperFixes(fixes){
  const el = document.getElementById('deeperFixesSection');
  if(!el) return;

  const fixesHtml = (fixes || []).map(f => `
    <div class="solution-block">
      <div class="solution-problem">${escapeHtml(f.problem)}</div>
      <div class="solution-arrow">→</div>
      <div class="solution-fix">${escapeHtml(f.solution)}</div>
    </div>
  `).join('');

  el.innerHTML = `
    <h3 class="confirm-section-title">How this idea addresses these risks</h3>
    <div class="solutions-list">${fixesHtml}</div>
  `;
}

// ---- Suggest Changes: a feedback-driven revision with an explicit
// preview/commit step, distinct from the automatic "Rewrite Idea" above
// (that one's driven by market intel; this one's driven by whatever the
// person actually typed, and never touches the real idea until they
// explicitly say to keep it). Three states, driven entirely by
// confirmState.pendingRevision: collapsed button, open feedback form, or
// an active preview — so reloading mid-review lands back in the right
// one instead of losing the in-progress preview.

function renderReviseSection(){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  if(confirmState.pendingRevision){
    renderRevisePreview(confirmState.pendingRevision);
    return;
  }

  renderProGatedButton(el, 'Suggest Changes', renderReviseForm);
}

function renderReviseForm(){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  el.innerHTML = `
    <div class="revise-form">
      <label class="lbl" for="reviseFeedbackInput">What would you change about this idea?</label>
      <textarea id="reviseFeedbackInput" class="revise-textarea" rows="4" placeholder="Things you like, things you'd remove, things you'd add or change…"></textarea>
      <div class="revise-form-actions">
        <button class="btn btn-primary" id="submitReviseBtn" type="button">Rewrite With This Feedback</button>
        <button class="btn btn-ghost" id="cancelReviseBtn" type="button">Cancel</button>
      </div>
    </div>
  `;

  const submitBtn = document.getElementById('submitReviseBtn');
  const cancelBtn = document.getElementById('cancelReviseBtn');
  const textarea = document.getElementById('reviseFeedbackInput');
  if(submitBtn) submitBtn.addEventListener('click', () => submitRevise(textarea?.value || ''));
  if(cancelBtn) cancelBtn.addEventListener('click', renderReviseSection);
  if(textarea) textarea.focus();
}

async function submitRevise(feedbackText){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  if(!feedbackText.trim()){
    const textarea = document.getElementById('reviseFeedbackInput');
    if(textarea) textarea.classList.add('input-error');
    let warning = el.querySelector('.revise-validation-error');
    if(!warning){
      warning = document.createElement('p');
      warning.className = 'confirm-error revise-validation-error';
      el.querySelector('.revise-form')?.appendChild(warning);
    }
    warning.textContent = "Type what you'd like changed before submitting.";
    return;
  }

  el.innerHTML = `
    <div class="confirm-researching">
      <div class="confirm-spinner"></div>
      <p>Rewriting the idea with your feedback…</p>
    </div>
  `;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/revise`, {
      method: 'POST',
      body: JSON.stringify({ feedback: feedbackText.trim() })
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not revise the idea.')}</p>`;
      return;
    }

    confirmState.pendingRevision = { feedback: feedbackText.trim(), idea: body.preview };
    renderRevisePreview(confirmState.pendingRevision);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong revising the idea.</p>`;
  }
}

// Shows the candidate revision clearly labeled as a preview, not yet the
// real idea — the actual ideaCoreSection above is left completely
// untouched until (and unless) "Keep This" is clicked.
function renderRevisePreview(pendingRevision){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  const idea = pendingRevision.idea;

  el.innerHTML = `
    <div class="revise-preview">
      <span class="idea-tag idea-tag-preview">Preview — not saved yet</span>
      <p class="revise-feedback-echo">Based on: "${escapeHtml(pendingRevision.feedback)}"</p>

      <h3>${escapeHtml(idea.name)}</h3>
      <p class="idea-oneliner">${escapeHtml(idea.oneLiner)}</p>
      <div class="idea-block"><div class="lbl">Core problem</div><p>${escapeHtml(idea.coreProblem)}</p></div>
      <div class="idea-block"><div class="lbl">Who it's for</div><p>${escapeHtml(idea.targetAudience || '')}</p></div>
      <div class="idea-block"><div class="lbl">Core feature</div><p>${escapeHtml(idea.coreFeature || '')}</p></div>
      <div class="idea-block"><div class="lbl">Monetization</div><p>${escapeHtml(idea.monetization)}</p></div>
      <div class="idea-block"><div class="lbl">Competitive edge</div><p>${escapeHtml(idea.competitiveEdge || '')}</p></div>
      ${idea.fullDescription ? `<p class="confirm-full-description">${escapeHtml(idea.fullDescription)}</p>` : ''}

      <div class="revise-form-actions">
        <button class="btn btn-primary" id="keepRevisionBtn" type="button">Keep This</button>
        <button class="btn btn-ghost" id="discardRevisionBtn" type="button">Discard</button>
      </div>
    </div>
  `;

  el.classList.add('result-section-enter');
  const keepBtn = document.getElementById('keepRevisionBtn');
  const discardBtn = document.getElementById('discardRevisionBtn');
  if(keepBtn) keepBtn.addEventListener('click', commitRevision);
  if(discardBtn) discardBtn.addEventListener('click', discardRevision);
}

async function commitRevision(){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  el.innerHTML = `<div class="confirm-researching"><div class="confirm-spinner"></div><p>Saving…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/revise/commit`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not save the revision.')}</p>`;
      return;
    }

    confirmState.rewrittenIdea = body.rewrittenIdea;
    confirmState.pendingRevision = null;
    renderIdeaCore(body.rewrittenIdea, true);
    renderReviseSection();

    const coreEl = document.getElementById('ideaCoreSection');
    if(coreEl) coreEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong saving the revision.</p>`;
  }
}

async function discardRevision(){
  const el = document.getElementById('reviseIdeaSection');
  if(!el) return;

  el.innerHTML = `<div class="confirm-researching"><div class="confirm-spinner"></div><p>Discarding…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/revise/discard`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;

    await res.json(); // current idea is unchanged either way — nothing to apply
    confirmState.pendingRevision = null;
    renderReviseSection();
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong discarding the revision.</p>`;
  }
}

// ---- Build Brief: turns the hardened idea into a structured spec meant
// to be pasted straight into Claude Code or a similar AI coding tool —
// the step that was missing before between "idea is fully validated"
// and "idea actually starts getting built."

function renderBuildBriefSection(){
  const el = document.getElementById('buildBriefSection');
  if(!el) return;

  if(confirmState.buildBrief){
    renderBuildBrief(confirmState.buildBrief);
    return;
  }

  renderProGatedButton(el, 'Generate Build Brief', () => runBuildBrief(false));
}

async function runBuildBrief(regenerate = false){
  const el = document.getElementById('buildBriefSection');
  if(!el) return;

  el.innerHTML = `
    <div class="confirm-researching">
      <div class="confirm-spinner"></div>
      <p>Translating the idea into MVP scope, a suggested stack, and a rough data model…</p>
    </div>
  `;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/build-brief`, { method: 'POST', body: JSON.stringify({ regenerate }) });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate the build brief.')}</p>`;
      return;
    }

    confirmState.buildBrief = body.buildBrief;
    renderBuildBrief(body.buildBrief);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating the build brief.</p>`;
  }
}

function renderBuildBrief(buildBrief){
  const el = document.getElementById('buildBriefSection');
  if(!el) return;

  const listHtml = (items) => `<ul>${(items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;

  const stack = buildBrief.suggestedTechStack || {};
  const stackRows = [
    ['Frontend', stack.frontend],
    ['Backend', stack.backend],
    ['Database', stack.database],
    ['AI services', stack.aiServices]
  ].filter(([, v]) => v);

  // Each MVP component is now a real {title, description} pair, not a
  // one-line bullet — rendered as its own block with a numbered title
  // and a full paragraph, since the description is meant to be detailed
  // enough to actually start building from directly.
  const mvpHtml = (buildBrief.mvpScope || []).map((item, i) => `
    <div class="mvp-item">
      <div class="mvp-item-title">${i + 1}. ${escapeHtml(item.title)}</div>
      <p class="mvp-item-description">${escapeHtml(item.description)}</p>
    </div>
  `).join('');

  // Anything pulled in via Spy Mode's "Steal This" button — the backend
  // was already storing this correctly, it just never had anywhere to
  // actually show up in the rendered brief, which is exactly why
  // clicking it looked like it did nothing.
  const stolenHtml = (buildBrief.stolenFromSpyMode || []).length
    ? `<div class="idea-block stolen-edges-block">
        <div class="lbl">Competitive edges</div>
        <ul class="stolen-edges-list">
          ${buildBrief.stolenFromSpyMode.map(s => `
            <li>${escapeHtml(s.text)} <span class="stolen-edge-source">— pulled from Spy Mode, vs ${escapeHtml(s.fromCompetitor)}</span></li>
          `).join('')}
        </ul>
      </div>`
    : '';

  el.innerHTML = `
    <h3 class="confirm-section-title">Build brief</h3>
    <p class="idea-block-p">${escapeHtml(buildBrief.overview)}</p>

    <div class="idea-block"><div class="lbl">MVP scope</div><div class="mvp-list">${mvpHtml}</div></div>
    <div class="idea-block"><div class="lbl">Later (not in v1)</div>${listHtml(buildBrief.laterFeatures)}</div>

    ${stackRows.length ? `<div class="idea-block"><div class="lbl">Suggested stack</div><ul>${stackRows.map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`).join('')}</ul></div>` : ''}

    <div class="idea-block"><div class="lbl">Key flows to build first</div>${listHtml(buildBrief.keyFlows)}</div>
    <div class="idea-block"><div class="lbl">Still open</div>${listHtml(buildBrief.openQuestions)}</div>
    ${stolenHtml}

    <div class="build-brief-actions">
      <button class="btn btn-ghost" id="copyBuildBriefBtn" type="button">Copy as Markdown</button>
      <button class="btn btn-ghost" id="regenerateBuildBriefBtn" type="button">Regenerate</button>
    </div>
  `;

  el.classList.add('result-section-enter');
  const regenBtn = document.getElementById('regenerateBuildBriefBtn');
  if(regenBtn) regenBtn.addEventListener('click', () => runBuildBrief(true));

  const copyBtn = document.getElementById('copyBuildBriefBtn');
  if(copyBtn) copyBtn.addEventListener('click', () => copyBuildBriefMarkdown(buildBrief, copyBtn));
}

// Markdown specifically because that's what pastes cleanly into Claude
// Code, a GitHub issue, or a planning doc — plain prose with headers
// would just need reformatting in any of those destinations anyway.
function buildBriefToMarkdown(buildBrief){
  const list = (items) => (items || []).map(i => `- ${i}`).join('\n');
  const stack = buildBrief.suggestedTechStack || {};
  const stackLines = [
    stack.frontend ? `- **Frontend:** ${stack.frontend}` : '',
    stack.backend ? `- **Backend:** ${stack.backend}` : '',
    stack.database ? `- **Database:** ${stack.database}` : '',
    stack.aiServices ? `- **AI services:** ${stack.aiServices}` : ''
  ].filter(Boolean).join('\n');

  const mvpLines = (buildBrief.mvpScope || [])
    .map((item, i) => `### ${i + 1}. ${item.title}\n${item.description}`)
    .join('\n\n');

  return `# Build Brief

${buildBrief.overview}

## MVP Scope
${mvpLines}

## Later (not in v1)
${list(buildBrief.laterFeatures)}

## Suggested Stack
${stackLines}

## Key Flows to Build First
${list(buildBrief.keyFlows)}

## Still Open
${list(buildBrief.openQuestions)}
`;
}

async function copyBuildBriefMarkdown(buildBrief, btn){
  try {
    await navigator.clipboard.writeText(buildBriefToMarkdown(buildBrief));
    if(btn){
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1800);
    }
  } catch (err) {
    if(btn) btn.textContent = 'Could not copy — select and copy manually';
  }
}

// ---- Shareable one-pager link: a public, unauthenticated view of the
// hardened idea anyone with the link can open, no ThinkMaps account
// needed — for sending to a friend or co-founder.

function renderShareLinkSection(){
  const el = document.getElementById('shareLinkSection');
  if(!el) return;

  if(confirmState.shareToken){
    renderShareLink(confirmState.shareToken);
    return;
  }

  el.innerHTML = `<button class="btn btn-secondary" id="runShareLinkBtn" type="button">Get Shareable Link</button>`;
  const btn = document.getElementById('runShareLinkBtn');
  if(btn) btn.addEventListener('click', runShareLink);
}

async function runShareLink(){
  const el = document.getElementById('shareLinkSection');
  if(!el) return;

  el.innerHTML = `<button class="btn btn-secondary" type="button" disabled>Creating link…</button>`;

  let res;
  try {
    res = await authedFetch(`/confirm/${confirmState.sessionId}/share`, { method: 'POST', body: JSON.stringify({}) });
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Could not reach the server to create a link. Check your connection and try again.</p>`;
    return;
  }
  if(!res) return;

  let body;
  try {
    body = await res.json();
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">The server responded unexpectedly (status ${res.status}) instead of with a link. If this was just deployed, the backend may not have this route yet.</p>`;
    return;
  }

  if(!res.ok){
    el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not create a shareable link.')}</p>`;
    return;
  }

  confirmState.shareToken = body.shareToken;
  renderShareLink(body.shareToken);
}

function buildShareUrl(token){
  // Built from the current page's own URL rather than a hardcoded
  // domain, so this resolves correctly regardless of which subdirectory
  // ThinkMaps happens to be deployed under.
  return window.location.origin + window.location.pathname.replace('confirm.html', 'share.html') + '?token=' + token;
}

function renderShareLink(token){
  const el = document.getElementById('shareLinkSection');
  if(!el) return;

  const url = buildShareUrl(token);

  el.innerHTML = `
    <div class="share-link-row">
      <input type="text" class="share-link-input" id="shareLinkInput" value="${escapeHtml(url)}" readonly />
      <button class="btn btn-secondary" id="copyShareLinkBtn" type="button">Copy Link</button>
    </div>
  `;

  const copyBtn = document.getElementById('copyShareLinkBtn');
  const input = document.getElementById('shareLinkInput');
  if(copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    } catch (err) {
      input?.select();
    }
  });
}

// =====================================================================
// IDEA TOOLKIT — 9 features, all built on top of the hardened idea.
// Every one of these follows the same shape as Build Brief above:
// renderXSection() decides gated-button vs already-cached-result,
// runX() fetches/generates and caches into confirmState, renderX()
// paints the actual result. initIdeaToolkit() just calls all 7 section
// renderers once.
// =====================================================================
function initIdeaToolkit(){
  renderStrengthScoreSection();
  renderPivotsSection();
  renderPersonasSection();
  renderLandingCopySection();
  renderRedTeamSection();
  renderSpyModeSection();
  renderLaunchChecklistSection();
  renderExportSection();

  document.getElementById('toolkitTourReopenBtn')?.addEventListener('click', () => startTour('toolkit', getToolkitTourSteps()));
  if(!hasSeenTour('toolkit')) startTour('toolkit', getToolkitTourSteps());
}

function getToolkitTourSteps(){
  return [
    {
      title: 'Everything past this point is optional',
      text: "Your idea is already hardened above — everything below is extra firepower if you want it. Quick tour, eight stops."
    },
    {
      selector: '#strengthScoreCard',
      title: 'Idea Strength Score',
      text: 'Four honest scores — market clarity, competitive gap, personal fit, technical feasibility — with real, specific reasoning behind each, not a generic pep talk.',
      demo: 'cardButton'
    },
    {
      selector: '#pivotsCard',
      title: 'Pivot Generator',
      text: 'Three genuinely different directions for this same idea — a different audience, a different business model, a different scope. "Build This Instead" starts a fresh blueprint carrying that pivot forward.',
      demo: 'cardButton'
    },
    {
      selector: '#personasCard',
      title: 'User Persona Cards',
      text: 'Three specific, named people who represent your real audience — daily routine, real frustrations, what would actually make them pay.',
      demo: 'cardButton'
    },
    {
      selector: '#landingCopyCard',
      title: 'Landing Page Copy',
      text: 'Real, paste-ready copy for a landing page — headline, sub-headline, feature bullets, FAQ, CTA options — written for this exact idea, not a generic template.',
      demo: 'cardButton'
    },
    {
      selector: '#redTeamCard',
      title: 'Challenge This Idea',
      text: "A sharp, unbalanced critique across five angles — market risk, technical traps, distribution, timing, founder fit. This is the counterweight to everything positive you've seen so far.",
      demo: 'cardButton'
    },
    {
      selector: '#spyModeCard',
      title: 'Spy Mode',
      text: "A full intelligence profile on each real competitor — what they're good at, where users complain, their pricing, and a specific attack vector. \"Steal This\" adds it straight to your Build Brief.",
      demo: 'cardButton'
    },
    {
      selector: '#launchChecklistCard',
      title: 'Launch Checklist',
      text: 'A week-by-week plan — validate, build, get 10 real users, measure — specific to this idea, not a generic startup checklist. Checkboxes save automatically.',
      demo: 'cardButton'
    },
    {
      selector: '#exportCard',
      title: 'Export This Idea',
      text: 'A complete, properly formatted package of everything you\'ve generated — download as Markdown or export as a real PDF, ready to send to anyone.',
      demo: 'cardButton'
    }
  ];
}

// ---------- 1. Idea Strength Score ----------
function renderStrengthScoreSection(){
  const el = document.getElementById('strengthScoreCard');
  if(!el) return;
  if(confirmState.strengthScore){
    renderStrengthScore(confirmState.strengthScore);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Idea Strength Score</h4><p class="muted">Four honest scores, not one number.</p></div>`;
  renderProGatedButton(el, 'Score This Idea', runStrengthScore);
}

async function runStrengthScore(){
  const el = document.getElementById('strengthScoreCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Idea Strength Score</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Scoring market clarity, competitive gap, personal fit, and technical feasibility…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/strength-score`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not score this idea.')}</p>`;
      return;
    }
    confirmState.strengthScore = body.strengthScore;
    renderStrengthScore(body.strengthScore);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong scoring this idea.</p>`;
  }
}

function scoreColor(score){
  if(score <= 4) return '#C24A3D';
  if(score <= 7) return '#D9A33E';
  return '#5C8A5C';
}

// A light, color-matched background for the overall score circle —
// pairing dark, saturated text with a pale tint of the SAME color reads
// as far more legible in practice than the same text sitting on a
// generic cream card background, even when the text-alone contrast
// ratio technically passes. This is what actually fixes "hard to see
// the rating" rather than just nudging the font size up.
function scoreBgTint(score){
  if(score <= 4) return 'rgba(194,74,61,0.14)';
  if(score <= 7) return 'rgba(217,163,62,0.18)';
  return 'rgba(92,138,92,0.14)';
}

// Hand-rolled SVG radar chart — no charting library exists anywhere in
// this codebase, and pulling one in for a single 4-axis chart isn't
// worth the dependency. 4 axes at 90-degree spacing starting from the
// top, each axis scaled 0-10 from center to edge.
function buildRadarChartSvg(dims){
  const cx = 100, cy = 100, maxR = 70;
  const angles = [-90, 0, 90, 180]; // top, right, bottom, left
  const points = dims.map((d, i) => {
    const angle = (angles[i] * Math.PI) / 180;
    const r = (d.score / 10) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const pointsStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const gridRings = [0.25, 0.5, 0.75, 1].map(frac => {
    const ringPoints = angles.map(a => {
      const angle = (a * Math.PI) / 180;
      const r = maxR * frac;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
    return `<polygon points="${ringPoints}" fill="none" stroke="#DAD5C7" stroke-width="1"/>`;
  }).join('');

  const axisLines = angles.map(a => {
    const angle = (a * Math.PI) / 180;
    const x = cx + maxR * Math.cos(angle);
    const y = cy + maxR * Math.sin(angle);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#DAD5C7" stroke-width="1"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 200 200" class="strength-radar-svg">
      ${gridRings}
      ${axisLines}
      <polygon points="${pointsStr}" fill="#D97757" fill-opacity="0.24" stroke="#D97757" stroke-width="2"/>
      ${points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#D97757"/>`).join('')}
    </svg>
  `;
}

function renderStrengthScore(strengthScore){
  const el = document.getElementById('strengthScoreCard');
  if(!el) return;

  const dims = [
    { key: 'marketClarity', label: 'Market Clarity', ...strengthScore.marketClarity },
    { key: 'competitiveGap', label: 'Competitive Gap', ...strengthScore.competitiveGap },
    { key: 'personalFit', label: 'Personal Fit', ...strengthScore.personalFit },
    { key: 'technicalFeasibility', label: 'Technical Feasibility', ...strengthScore.technicalFeasibility }
  ];
  const overall = Math.round(dims.reduce((s, d) => s + (d.score || 0), 0) / dims.length);

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Idea Strength Score</h4></div>
    <div class="strength-score-layout">
      <div class="strength-radar-wrap">
        ${buildRadarChartSvg(dims)}
        <div class="strength-overall" style="color:${scoreColor(overall)}; --strength-overall-bg:${scoreBgTint(overall)};">${overall}<span>/10</span></div>
      </div>
      <div class="strength-dims-list">
        ${dims.map(d => `
          <div class="strength-dim-row">
            <div class="strength-dim-header">
              <span class="strength-dim-label">${escapeHtml(d.label)}</span>
              <span class="strength-dim-score" style="color:${scoreColor(d.score)}; background:${scoreBgTint(d.score)};">${d.score}/10</span>
            </div>
            <p class="strength-dim-explanation">${escapeHtml(d.explanation || '')}</p>
            ${d.topAction ? `<p class="strength-dim-action"><strong>Do this:</strong> ${escapeHtml(d.topAction)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
    ${!dashboardHasFounderProfileNote() ? `<p class="strength-fit-note muted">Personal Fit is necessarily limited without a full Founder Profile — take that score as a rough signal, not a precise one.</p>` : ''}
  `;
  el.classList.add('result-section-enter');
}

// No Founder Profile feature exists yet in this codebase — this just
// centralizes the one place that'd need to change if/when one gets
// built, rather than hardcoding "false" inline where it's used above.
function dashboardHasFounderProfileNote(){ return false; }

// ---------- 2. Pivot Generator ----------
function renderPivotsSection(){
  const el = document.getElementById('pivotsCard');
  if(!el) return;
  if(confirmState.pivots){
    renderPivots(confirmState.pivots);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Pivot Generator</h4><p class="muted">Three genuinely different directions, not variations.</p></div>`;
  renderProGatedButton(el, 'Show Me 3 Pivots', runPivots);
}

async function runPivots(){
  const el = document.getElementById('pivotsCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Pivot Generator</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Working out an audience pivot, a monetization pivot, and a scope pivot…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/pivots`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate pivots.')}</p>`;
      return;
    }
    confirmState.pivots = body.pivots;
    renderPivots(body.pivots);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating pivots.</p>`;
  }
}

function renderPivots(pivots){
  const el = document.getElementById('pivotsCard');
  if(!el) return;

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Pivot Generator</h4></div>
    <div class="pivots-accordion">
      ${pivots.map((p, i) => `
        <details class="pivot-item" ${i === 0 ? 'open' : ''}>
          <summary>
            <span class="pivot-type-badge pivot-type-${escapeHtml(p.type)}">${escapeHtml(p.label || p.type)}</span>
            <span class="pivot-concept-name">${escapeHtml(p.renamedConcept?.name || '')}</span>
          </summary>
          <div class="pivot-item-body">
            <p class="pivot-oneliner">${escapeHtml(p.renamedConcept?.oneLiner || '')}</p>
            <div class="idea-block"><div class="lbl">Direction</div><p>${escapeHtml(p.direction || '')}</p></div>
            <div class="idea-block"><div class="lbl">Why it's defensible</div><p>${escapeHtml(p.whyDefensible || '')}</p></div>
            <div class="idea-block"><div class="lbl">The 10x unlock</div><p>${escapeHtml(p.tenXUnlock || '')}</p></div>
            <button class="btn btn-primary pivot-build-btn" type="button" data-pivot-index="${i}">Build This Instead</button>
          </div>
        </details>
      `).join('')}
    </div>
  `;
  el.classList.add('result-section-enter');

  el.querySelectorAll('.pivot-build-btn').forEach(btn => {
    btn.addEventListener('click', () => buildPivotInstead(pivots[parseInt(btn.dataset.pivotIndex, 10)], btn));
  });
}

async function buildPivotInstead(pivot, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Starting new blueprint…'; }

  try {
    const res = await authedFetch(`/blueprints/${confirmState.blueprintId}/pivot-into`, {
      method: 'POST',
      body: JSON.stringify({ pivot })
    });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      showToast(body.error || 'Could not start a new blueprint from this pivot.');
      if(btn){ btn.disabled = false; btn.textContent = 'Build This Instead'; }
      return;
    }
    window.location.href = `app.html?blueprint=${body.blueprint.id}`;
  } catch (err) {
    showToast('Could not reach the server. Try again.');
    if(btn){ btn.disabled = false; btn.textContent = 'Build This Instead'; }
  }
}

// ---------- 3. User Persona Cards ----------
function renderPersonasSection(){
  const el = document.getElementById('personasCard');
  if(!el) return;
  if(confirmState.personas){
    renderPersonas(confirmState.personas);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>User Persona Cards</h4><p class="muted">Three specific people, not generic demographics.</p></div>`;
  renderProGatedButton(el, 'Generate Personas', runPersonas);
}

async function runPersonas(){
  const el = document.getElementById('personasCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>User Persona Cards</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Building 3 specific people who represent your real audience…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/personas`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate personas.')}</p>`;
      return;
    }
    confirmState.personas = body.personas;
    renderPersonas(body.personas);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating personas.</p>`;
  }
}

function personaInitials(name){
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function renderPersonas(personasResult){
  const el = document.getElementById('personasCard');
  if(!el) return;

  const personas = personasResult.personas || [];

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>User Persona Cards</h4></div>
    <div class="personas-scroll-row">
      ${personas.map(p => `
        <div class="persona-full-card">
          <div class="persona-full-avatar">${escapeHtml(personaInitials(p.name))}</div>
          <div class="persona-full-name">${escapeHtml(p.name)}, ${escapeHtml(String(p.age || ''))}</div>
          <div class="persona-full-occupation">${escapeHtml(p.occupation || '')}</div>
          <p class="persona-full-routine">${escapeHtml(p.dailyRoutine || '')}</p>
          <div class="lbl">Top frustrations</div>
          <ul>${(p.topFrustrations || []).map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
          <div class="lbl">Already tried</div>
          <p class="persona-full-tried">${escapeHtml(p.alreadyTried || '')}</p>
          <div class="lbl">Would pay if</div>
          <p class="persona-full-wouldpay">${escapeHtml(p.wouldPayIf || '')}</p>
          <p class="persona-full-quote">&ldquo;${escapeHtml(p.quote || '')}&rdquo;</p>
        </div>
      `).join('')}
    </div>
    <div class="toolkit-card-actions">
      <a href="export.html?session=${confirmState.sessionId}&view=personas" target="_blank" class="btn btn-ghost">Download as PDF</a>
    </div>
  `;
  el.classList.add('result-section-enter');
}

// ---------- 4. Landing Page Copy Generator ----------
function renderLandingCopySection(){
  const el = document.getElementById('landingCopyCard');
  if(!el) return;
  if(confirmState.landingCopy){
    renderLandingCopy(confirmState.landingCopy);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Landing Page Copy</h4><p class="muted">Real, paste-ready copy — not a fill-in-the-blank template.</p></div>`;
  renderProGatedButton(el, 'Generate Landing Copy', runLandingCopy);
}

async function runLandingCopy(){
  const el = document.getElementById('landingCopyCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Landing Page Copy</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Writing a headline, sub-headline, feature bullets, and CTA options…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/landing-copy`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate landing page copy.')}</p>`;
      return;
    }
    confirmState.landingCopy = body.landingCopy;
    renderLandingCopy(body.landingCopy);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating landing page copy.</p>`;
  }
}

function landingCopyAsMarkdown(lc){
  return [
    `# ${lc.heroHeadline}`,
    '',
    lc.subHeadline,
    '',
    lc.problemAgitation || '',
    '',
    '## Why it works',
    ...(lc.featureBullets || []).map(b => `- ${b}`),
    '',
    '## How it works',
    ...(lc.howItWorks || []).map((s, i) => `${i + 1}. ${s}`),
    '',
    '## Common questions',
    ...(lc.objectionHandling || []).map(qa => `**${qa.question}**\n${qa.answer}\n`),
    `_${lc.socialProofPlaceholder}_`,
    '',
    `**${lc.footerCta || ''}**`,
    '',
    `Buttons: ${lc.ctaOptions?.cautious} / ${lc.ctaOptions?.medium} / ${lc.ctaOptions?.aggressive}`
  ].join('\n');
}

function renderLandingCopy(lc){
  const el = document.getElementById('landingCopyCard');
  if(!el) return;

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Landing Page Copy</h4><p class="muted">A full page of copy, top to bottom — paste it into whatever page builder you're already using.</p></div>
    <div class="landing-copy-preview">
      <div class="lc-section">
        <div class="lc-section-head"><div class="lbl">Hero headline</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml(lc.heroHeadline)}">Copy</button></div>
        <p class="lc-hero">${escapeHtml(lc.heroHeadline)}</p>
      </div>
      <div class="lc-section">
        <div class="lc-section-head"><div class="lbl">Sub-headline</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml(lc.subHeadline)}">Copy</button></div>
        <p>${escapeHtml(lc.subHeadline)}</p>
      </div>
      ${lc.problemAgitation ? `
        <div class="lc-section">
          <div class="lc-section-head"><div class="lbl">Problem (agitate before the pitch)</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml(lc.problemAgitation)}">Copy</button></div>
          <p>${escapeHtml(lc.problemAgitation)}</p>
        </div>
      ` : ''}
      <div class="lc-section">
        <div class="lc-section-head"><div class="lbl">Feature bullets</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml((lc.featureBullets || []).join('\n'))}">Copy</button></div>
        <ul>${(lc.featureBullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      </div>
      ${lc.howItWorks?.length ? `
        <div class="lc-section">
          <div class="lc-section-head"><div class="lbl">How it works</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml(lc.howItWorks.map((s,i)=>`${i+1}. ${s}`).join('\n'))}">Copy</button></div>
          <ol class="lc-how-it-works">${lc.howItWorks.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
        </div>
      ` : ''}
      ${lc.objectionHandling?.length ? `
        <div class="lc-section">
          <div class="lc-section-head"><div class="lbl">Common questions (objection handling)</div><button class="lc-copy-btn" type="button" data-copy="${escapeHtml(lc.objectionHandling.map(qa=>`${qa.question}\n${qa.answer}`).join('\n\n'))}">Copy</button></div>
          <div class="lc-faq">
            ${lc.objectionHandling.map(qa => `
              <div class="lc-faq-item">
                <p class="lc-faq-question">${escapeHtml(qa.question)}</p>
                <p class="lc-faq-answer">${escapeHtml(qa.answer)}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="lc-section"><div class="lbl">Social proof placeholder</div><p class="muted">${escapeHtml(lc.socialProofPlaceholder || '')}</p></div>
      ${lc.footerCta ? `<div class="lc-section"><div class="lbl">Footer closing line</div><p class="lc-footer-cta">${escapeHtml(lc.footerCta)}</p></div>` : ''}
      <div class="lc-section">
        <div class="lbl">CTA button text</div>
        <div class="lc-cta-options">
          <span class="lc-cta-pill">Cautious: ${escapeHtml(lc.ctaOptions?.cautious || '')}</span>
          <span class="lc-cta-pill">Medium: ${escapeHtml(lc.ctaOptions?.medium || '')}</span>
          <span class="lc-cta-pill">Aggressive: ${escapeHtml(lc.ctaOptions?.aggressive || '')}</span>
        </div>
      </div>
    </div>
    <div class="toolkit-card-actions">
      <button class="btn btn-secondary" id="copyLandingCopyBtn" type="button">Copy All</button>
      <a href="https://carrd.co" target="_blank" rel="noopener" class="btn btn-ghost">Open Carrd</a>
    </div>
    <p class="muted lc-carrd-explainer">Carrd is a free, no-code, one-page website builder — paste this copy straight into it and you'll have a real, live landing page in about 20 minutes, no coding or design work needed. It's what a lot of solo founders use to launch fast before building the actual product.</p>
  `;
  el.classList.add('result-section-enter');

  el.querySelectorAll('.lc-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const success = await copyTextRobustly(btn.dataset.copy);
      const original = btn.textContent;
      btn.textContent = success ? 'Copied!' : 'Select manually';
      setTimeout(() => { btn.textContent = original; }, 1500);
      if(!success) showToast('Could not copy automatically — select the text and copy it yourself.');
    });
  });

  const copyBtn = document.getElementById('copyLandingCopyBtn');
  if(copyBtn) copyBtn.addEventListener('click', async () => {
    const success = await copyTextRobustly(landingCopyAsMarkdown(lc));
    const original = copyBtn.textContent;
    copyBtn.textContent = success ? 'Copied!' : 'Select manually';
    setTimeout(() => { copyBtn.textContent = original; }, 1800);
    if(!success) showToast('Could not copy automatically — select the text and copy it yourself.');
  });
}

// ---------- 5. Red Team Mode ("Challenge This Idea") ----------
function renderRedTeamSection(){
  const el = document.getElementById('redTeamCard');
  if(!el) return;
  if(confirmState.redTeam){
    renderRedTeam(confirmState.redTeam);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Challenge This Idea</h4><p class="muted">A sharp, honest counterweight to the case you've already seen.</p></div>`;
  renderProGatedButton(el, 'Challenge This Idea', runRedTeam);
}

async function runRedTeam(){
  const el = document.getElementById('redTeamCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Challenge This Idea</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Attacking this idea across market risk, technical traps, distribution, timing, and founder fit…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/red-team`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not challenge this idea.')}</p>`;
      return;
    }
    confirmState.redTeam = body.redTeam;
    renderRedTeam(body.redTeam);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong challenging this idea.</p>`;
  }
}

function renderRedTeam(redTeam){
  const el = document.getElementById('redTeamCard');
  if(!el) return;

  const rebuttals = redTeam.rebuttals || {};

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Challenge This Idea</h4></div>
    <div class="red-team-angles">
      ${redTeam.angles.map((a) => {
        const existing = rebuttals[a.angle];
        return `
        <details class="red-team-angle">
          <summary>
            <span class="red-team-angle-label">${escapeHtml(a.label)}</span>
            ${existing ? `<span class="red-team-verdict red-team-verdict-${escapeHtml(existing.verdict)}">${escapeHtml(existing.verdict)}</span>` : ''}
          </summary>
          <div class="red-team-angle-body">
            <p class="red-team-critique">${escapeHtml(a.critique)}</p>
            <p class="red-team-question"><strong>Answer this:</strong> ${escapeHtml(a.pointedQuestion)}</p>
            <div class="red-team-rebuttal-box">
              <textarea class="revise-textarea red-team-rebuttal-input" data-angle="${escapeHtml(a.angle)}" placeholder="How would you respond to this?" rows="3">${existing ? escapeHtml(existing.rebuttal) : ''}</textarea>
              <button class="btn btn-secondary red-team-submit-btn" type="button" data-angle="${escapeHtml(a.angle)}">Submit Response</button>
              ${existing ? `<p class="red-team-response"><strong>Verdict:</strong> ${escapeHtml(existing.response)}</p>` : ''}
            </div>
          </div>
        </details>
      `;
      }).join('')}
    </div>
  `;
  el.classList.add('result-section-enter');

  el.querySelectorAll('.red-team-submit-btn').forEach(btn => {
    btn.addEventListener('click', () => submitRedTeamRebuttal(btn.dataset.angle, btn));
  });
}

async function submitRedTeamRebuttal(angle, btn){
  const textarea = document.querySelector(`.red-team-rebuttal-input[data-angle="${angle}"]`);
  const rebuttal = (textarea?.value || '').trim();
  if(!rebuttal){
    showToast('Write a response before submitting.');
    return;
  }

  if(btn){ btn.disabled = true; btn.textContent = 'Evaluating…'; }

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/red-team/respond`, {
      method: 'POST',
      body: JSON.stringify({ angle, rebuttal })
    });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      showToast(body.error || 'Could not evaluate your response.');
      if(btn){ btn.disabled = false; btn.textContent = 'Submit Response'; }
      return;
    }
    confirmState.redTeam = body.redTeam;
    renderRedTeam(body.redTeam);
  } catch (err) {
    showToast('Could not reach the server. Try again.');
    if(btn){ btn.disabled = false; btn.textContent = 'Submit Response'; }
  }
}

// ---------- 6. Competitor Deep Dive ("Spy Mode") ----------
function renderSpyModeSection(){
  const el = document.getElementById('spyModeCard');
  if(!el) return;
  if(confirmState.spyMode){
    renderSpyMode(confirmState.spyMode);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Spy Mode</h4><p class="muted">A full intelligence profile on each real competitor found.</p></div>`;
  renderProGatedButton(el, 'Run Competitor Deep Dive', runSpyMode);
}

async function runSpyMode(){
  const el = document.getElementById('spyModeCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Spy Mode</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Digging into reviews, alternatives, and pricing for each competitor — this takes a bit longer.</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/spy-mode`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not run the competitor deep dive.')}</p>`;
      return;
    }
    confirmState.spyMode = body.spyMode;
    renderSpyMode(body.spyMode);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong running the competitor deep dive.</p>`;
  }
}

function renderSpyMode(spyMode){
  const el = document.getElementById('spyModeCard');
  if(!el) return;

  const competitors = spyMode.competitors || [];
  if(!competitors.length){
    el.innerHTML = `<div class="toolkit-card-head"><h4>Spy Mode</h4></div><p class="muted">No competitor profiles available.</p>`;
    return;
  }

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Spy Mode</h4></div>
    <div class="spy-mode-tabs">
      <div class="spy-mode-tab-buttons">
        ${competitors.map((c, i) => `<button type="button" class="spy-mode-tab-btn ${i === 0 ? 'active' : ''}" data-tab-index="${i}">${escapeHtml(c.name)}</button>`).join('')}
      </div>
      ${competitors.map((c, i) => `
        <div class="spy-mode-tab-panel ${i === 0 ? 'active' : ''}" data-panel-index="${i}">
          <div class="idea-block"><div class="lbl">What they're good at</div><p>${escapeHtml(c.whatTheyreGoodAt || '')}</p></div>
          <div class="idea-block"><div class="lbl">Where users complain</div><p>${escapeHtml(c.whereUsersComplain || '')}</p></div>
          <div class="idea-block"><div class="lbl">Apparent pricing <span class="spy-mode-confirmed-date">(last confirmed ${escapeHtml((c.lastConfirmed || '').slice(0, 10))})</span></div><p>${escapeHtml(c.apparentPricing || '')}</p></div>
          <div class="idea-block"><div class="lbl">Positioning gap</div><p>${escapeHtml(c.positioningGap || '')}</p></div>
          <div class="idea-block"><div class="lbl">Attack vector</div><p>${escapeHtml(c.attackVector || '')}</p></div>
          <button class="btn btn-primary spy-mode-steal-btn" type="button" data-competitor="${escapeHtml(c.name)}" data-attack="${escapeHtml(c.attackVector || '')}">Steal This</button>
        </div>
      `).join('')}
    </div>
  `;
  el.classList.add('result-section-enter');

  el.querySelectorAll('.spy-mode-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.tabIndex;
      el.querySelectorAll('.spy-mode-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tabIndex === idx));
      el.querySelectorAll('.spy-mode-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panelIndex === idx));
    });
  });

  el.querySelectorAll('.spy-mode-steal-btn').forEach(btn => {
    btn.addEventListener('click', () => stealFromSpyMode(btn.dataset.competitor, btn.dataset.attack, btn));
  });
}

async function stealFromSpyMode(competitorName, attackVector, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Adding to build brief…'; }

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/spy-mode/steal`, {
      method: 'POST',
      body: JSON.stringify({ competitorName, attackVector })
    });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      showToast(body.error || 'Could not add this to the build brief.');
      if(btn){ btn.disabled = false; btn.textContent = 'Steal This'; }
      return;
    }
    confirmState.buildBrief = body.buildBrief;
    renderBuildBrief(body.buildBrief);
    if(btn){ btn.textContent = 'Added to Build Brief ✓'; }
    showToast('Added to your build brief — pulled from Spy Mode.');

    // The Build Brief section lives well above Spy Mode on the page —
    // without this, the addition happens correctly but off-screen, which
    // is exactly why it looked like nothing happened at all.
    const buildBriefEl = document.getElementById('buildBriefSection');
    if(buildBriefEl){
      buildBriefEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      buildBriefEl.classList.add('flash-highlight');
      setTimeout(() => buildBriefEl.classList.remove('flash-highlight'), 2000);
    }
  } catch (err) {
    showToast('Could not reach the server. Try again.');
    if(btn){ btn.disabled = false; btn.textContent = 'Steal This'; }
  }
}

// ---------- 7. Launch Checklist ----------
function renderLaunchChecklistSection(){
  const el = document.getElementById('launchChecklistCard');
  if(!el) return;
  if(confirmState.launchChecklist){
    renderLaunchChecklist(confirmState.launchChecklist);
    return;
  }
  el.innerHTML = `<div class="toolkit-card-head"><h4>Launch Checklist</h4><p class="muted">Week-by-week, specific to this idea — not a generic startup checklist.</p></div>`;
  if(!confirmState.buildBrief){
    el.innerHTML += `<p class="muted toolkit-locked-note">Generate the Build Brief first — this checklist is built from it.</p>`;
    return;
  }
  renderProGatedButton(el, 'Generate Launch Checklist', runLaunchChecklist);
}

async function runLaunchChecklist(){
  const el = document.getElementById('launchChecklistCard');
  if(!el) return;
  el.innerHTML = `<div class="toolkit-card-head"><h4>Launch Checklist</h4></div><div class="confirm-researching"><div class="confirm-spinner"></div><p>Planning 4 weeks — validate, build, get users, measure…</p></div>`;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/launch-checklist`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    const body = await res.json();
    if(!res.ok){
      el.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not generate the launch checklist.')}</p>`;
      return;
    }
    confirmState.launchChecklist = body.launchChecklist;
    renderLaunchChecklist(body.launchChecklist);
  } catch (err) {
    el.innerHTML = `<p class="confirm-error">Something went wrong generating the launch checklist.</p>`;
  }
}

// Checklist completion state lives in localStorage, keyed per-session —
// this is explicitly a living working document per the spec, not a
// static read, so it needs to persist across visits without a server
// round trip for every single checkbox click.
function checklistStorageKey(){
  return `thinkmaps_checklist_${confirmState.sessionId}`;
}

function getChecklistState(){
  try {
    const raw = localStorage.getItem(checklistStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function setChecklistTaskDone(taskId, done){
  const state = getChecklistState();
  state[taskId] = done;
  try {
    localStorage.setItem(checklistStorageKey(), JSON.stringify(state));
  } catch (err) {
    // Storage full or unavailable — the checkbox itself still visually
    // reflects the click, it just won't persist across a reload. Not
    // worth interrupting the person with an error over.
  }
}

function renderLaunchChecklist(launchChecklist){
  const el = document.getElementById('launchChecklistCard');
  if(!el) return;

  const checklistState = getChecklistState();
  const weeks = launchChecklist.weeks || [];

  let totalTasks = 0;
  let doneTasks = 0;
  weeks.forEach((w, wi) => {
    (w.tasks || []).forEach((t, ti) => {
      totalTasks++;
      if(checklistState[`${wi}-${ti}`]) doneTasks++;
    });
  });

  // Which week to show as "current" — the first week that isn't 100%
  // complete yet, or the last week if everything's done.
  let currentWeekIndex = weeks.findIndex((w, wi) => {
    const tasks = w.tasks || [];
    return tasks.some((t, ti) => !checklistState[`${wi}-${ti}`]);
  });
  if(currentWeekIndex === -1) currentWeekIndex = weeks.length - 1;

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Launch Checklist</h4></div>
    <div class="checklist-progress-header">
      <span>Week ${(currentWeekIndex + 1)} of ${weeks.length} · ${doneTasks}/${totalTasks} tasks done</span>
      <div class="checklist-progress-track"><div class="checklist-progress-fill" style="width:${totalTasks ? (doneTasks / totalTasks) * 100 : 0}%;"></div></div>
    </div>
    <div class="checklist-weeks">
      ${weeks.map((w, wi) => `
        <details class="checklist-week" ${wi === currentWeekIndex ? 'open' : ''}>
          <summary>Week ${w.weekNumber} — ${escapeHtml(w.title)}</summary>
          <div class="checklist-week-body">
            ${(w.tasks || []).map((t, ti) => `
              <label class="checklist-task">
                <input type="checkbox" data-week="${wi}" data-task="${ti}" ${checklistState[`${wi}-${ti}`] ? 'checked' : ''} />
                <span class="checklist-task-text">${escapeHtml(t.task)}</span>
                <span class="checklist-task-criterion">${escapeHtml(t.passFailCriterion || '')}</span>
              </label>
            `).join('')}
            ${w.metrics ? `
              <div class="checklist-metrics">
                <div class="lbl">Metrics to track</div>
                ${w.metrics.map(m => `
                  <div class="checklist-metric-row">
                    <strong>${escapeHtml(m.metric)}</strong> — threshold: ${escapeHtml(m.threshold)}
                    <p class="muted">${escapeHtml(m.decisionRule)}</p>
                  </div>
                `).join('')}
                <a href="#pivotsCard" class="hint-link checklist-pivot-link">Didn't hit the threshold? Run the Pivot Generator →</a>
              </div>
            ` : ''}
          </div>
        </details>
      `).join('')}
    </div>
    <div class="toolkit-card-actions">
      <button type="button" class="btn btn-ghost" id="exportChecklistMdLink">Export to Markdown</button>
    </div>
  `;
  el.classList.add('result-section-enter');

  document.getElementById('exportChecklistMdLink')?.addEventListener('click', downloadMarkdownExport);

  el.querySelectorAll('.checklist-task input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = `${cb.dataset.week}-${cb.dataset.task}`;
      setChecklistTaskDone(key, cb.checked);
      renderLaunchChecklist(launchChecklist); // re-render to update the progress bar/header
    });
  });
}

// ---------- 8. Export (Markdown + PDF) ----------
function renderExportSection(){
  const el = document.getElementById('exportCard');
  if(!el) return;

  el.innerHTML = `
    <div class="toolkit-card-head"><h4>Export This Idea</h4><p class="muted">A complete, properly formatted package — everything generated so far.</p></div>
    <div class="toolkit-card-actions">
      <button type="button" class="btn btn-secondary" id="downloadMarkdownBtn">Download Markdown</button>
      <a href="export.html?session=${confirmState.sessionId}" target="_blank" class="btn btn-primary">Export as PDF</a>
    </div>
  `;

  document.getElementById('downloadMarkdownBtn')?.addEventListener('click', downloadMarkdownExport);
}

// A plain <a href> to this route can't carry the Authorization header
// requireAuth needs — browsers never attach custom headers to a normal
// link navigation, only fetch() can. This fetches the file authenticated,
// then triggers the actual browser download itself via a Blob object URL,
// which is the standard way to download an authenticated file without
// exposing the access token in a URL (which query-string auth would do).
async function downloadMarkdownExport(){
  const btn = document.getElementById('downloadMarkdownBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Downloading…'; }

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/export/markdown`);
    if(!res) return; // authedFetch already redirected to auth.html if no session

    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not download this export.');
      return;
    }

    const blob = await res.blob();
    const filename = (confirmState.rewrittenIdea?.name || confirmState.result?.name || 'thinkmaps-idea')
      .replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.md';

    const objectUrl = URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.href = objectUrl;
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    tempLink.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    showToast('Could not reach the server. Try again.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Download Markdown'; }
  }
}
