// ThinkMaps — single shared frontend script.
// Every page (index, auth, dashboard, app) loads this file.
// It checks what's actually on the page and runs the matching logic.
// All backend calls go through API_BASE_URL, pointed at the Render service.

const API_BASE_URL = 'https://thinkmaps.onrender.com';

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
  initAppPage();
  initIdeatePage();
  initConfirmPage();
});

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
// Skips entirely on pages without the sign-in/sign-up forms.
// Sign up: email + username + password + confirm — stored via Supabase Auth,
// username carried in as metadata so the database trigger can save it.
// Sign in: accepts EITHER email or username. If it's a username, server.js
// resolves it to an email first (frontend can't query profiles — RLS blocks it),
// then the actual password check happens via Supabase Auth, never through our backend.
function initAuthPage(){
  const signinForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');
  if(!signinForm && !signupForm) return;

  // If this page load IS the redirect back from a confirmation email,
  // Supabase appends the session tokens straight onto the URL hash.
  // We deliberately don't use them to auto-log the user in — they
  // should land on the login page and sign in themselves. So: just
  // strip the hash (purely synchronous, no network call, no lag) and
  // show a friendly banner explaining why they're here.
  if(window.location.hash.includes('access_token')){
    const banner = document.getElementById('emailConfirmedBanner');
    if(banner) banner.style.display = 'block';
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

  if(signinForm){
    signinForm.addEventListener('submit', handleSignIn);
  }
  if(signupForm){
    signupForm.addEventListener('submit', handleSignUp);
  }
}

async function resolveEmail(identifier){
  if(identifier.includes('@')) return identifier; // already an email, nothing to resolve

  const res = await fetch(`${API_BASE_URL}/auth/resolve-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier })
  });

  if(!res.ok){
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'No account found for that username.');
  }

  const { email } = await res.json();
  return email;
}

async function handleSignIn(e){
  e.preventDefault();
  const errorEl = document.getElementById('signinError');
  errorEl.textContent = '';

  const identifier = document.getElementById('signinIdentifier').value.trim();
  const password = document.getElementById('signinPassword').value;

  try {
    const email = await resolveEmail(identifier);
    const sb = await getSupabaseClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });

    if(error) throw error;

    window.location.href = 'dashboard.html';
  } catch (err){
    if(/email not confirmed/i.test(err.message || '')){
      errorEl.textContent = 'Please confirm your email first — check your inbox for the link.';
    } else {
      errorEl.textContent = err.message || 'Could not sign in. Check your details and try again.';
    }
  }
}

async function handleSignUp(e){
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
    const sb = await getSupabaseClient();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        // Sends the confirmation link back to wherever auth.html actually
        // lives — works on GitHub Pages without hardcoding the repo path.
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });

    if(error){
      if(/duplicate|unique/i.test(error.message)){
        throw new Error('That email or username is already taken.');
      }
      throw error;
    }

    if(data.session){
      // Confirmation is off (or already confirmed) — straight in.
      window.location.href = 'dashboard.html';
    } else {
      // Confirmation required — Supabase already sent the email itself.
      showSignupPending(email);
    }
  } catch (err){
    errorEl.textContent = err.message || 'Could not create your account. Try again.';
  }
}

function showSignupPending(email){
  const signupForm = document.getElementById('signupForm');
  const pendingEl = document.getElementById('signupPending');
  const emailEl = document.getElementById('signupPendingEmail');

  if(signupForm) signupForm.style.display = 'none';
  if(emailEl) emailEl.textContent = email;
  if(pendingEl) pendingEl.style.display = 'block';
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
    navCta.innerHTML = `<a href="dashboard.html" class="btn btn-primary">Dashboard</a>`;
  }

  document.querySelectorAll('a[href="auth.html"]').forEach(a => {
    a.href = 'dashboard.html';
  });
}

// ---------- DASHBOARD PAGE ----------
// Skips entirely on pages without #dashboardRoot.
// Loads profile + blueprint state from server.js, renders one of three states
// per blueprint (empty / active / locked), and wires up "new blueprint" + logout.

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
  await loadDashboard();
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

  if(profile.pro_status){
    bannerEl.innerHTML = `<span class="eyebrow">Pro</span> Unlimited blueprints, no 24-hour lock.`;
    bannerEl.classList.add('pro');
  } else {
    // Selar checkout isn't wired in yet — placeholder link until that phase.
    bannerEl.innerHTML = `
      <span class="eyebrow">Free plan</span>
      One blueprint, 24 hours, then read-only.
      <a href="index.html#pricing" class="btn btn-ghost">Go Pro</a>
    `;
    bannerEl.classList.remove('pro');
  }
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
    const statusLabel = bp.isLocked
      ? 'Locked — read-only'
      : (bp.hoursRemaining != null ? `${bp.hoursRemaining} hour(s) left on free tier` : 'Active');

    return `
      <div class="blueprint-card ${bp.isLocked ? 'locked' : ''}">
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
function estimateOptionHeight(label){
  return (label || '').length > 26 ? 54 : 38;
}

function estimateHeaderHeight(label){
  return (label || '').length > 22 ? 56 : 40;
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
  framedTerminalGroupIds: new Set()
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

async function initAppPage(){
  const worldEl = document.getElementById('canvasWorld');
  if(!worldEl) return;

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
  setupBlueprintTitleEditing();
  await loadGraph();
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
    canvasState.groups = data.groups;
    canvasState.groupVersions = data.groupVersions;
    canvasState.options = data.options;

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
// terminal stop sign at the end of a path that's gone 15 nodes deep.
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
  'What You Actually Know About Yourself': '#5C73A8'
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

// Drives the progress bar added between the header and the canvas — the
// breadcrumb trail and the "{depth} of 15" counter, both built from
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
  breadcrumbEl.innerHTML = trail
    .map(label => `<span class="crumb">${escapeHtml(label)}</span>`)
    .join('<span class="crumb-sep">→</span>');
  // Scrolled to the most recent end on purpose — a long path should show
  // where you ARE, not where you started, every time this updates.
  breadcrumbEl.scrollLeft = breadcrumbEl.scrollWidth;

  // Each full cycle is 6 (A-F) + 1 (checkpoint) + 3 (G-H-I) = 10 nodes —
  // only shown once you've actually gone around more than once, since
  // "Cycle 1" for everyone's first 10 nodes is just clutter.
  const cycleNumber = Math.floor((depth - 1) / 10) + 1;
  const cycleTagHtml = cycleNumber > 1 ? `<span class="cycle-tag">Cycle ${cycleNumber}</span>` : '';
  countEl.innerHTML = `${cycleTagHtml}<span>${depth} of 15</span>`;
}

// The "look what you built" moment — fires exactly once per terminal
// card, the first time a path reaches depth 15. Walks the WHOLE path
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
  // tighter than normal" on a path short enough to already fit.
  const fitZoom = Math.min(availableWidth / pathWidth, availableHeight / pathHeight, 1);
  const targetZoom = Math.max(ZOOM_MIN, Math.min(fitZoom, ZOOM_MAX));

  const pathCenterX = (minX + maxX) / 2;
  const pathCenterY = (minY + maxY) / 2;

  const targetPanX = viewport.clientWidth / 2 - pathCenterX * targetZoom;
  const targetPanY = viewport.clientHeight / 2 - pathCenterY * targetZoom;

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

    // This path has gone 15 nodes deep — render a single clear call to
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
      return `
        <div class="canvas-option ${stateClass}" data-option-id="${opt.id}" data-option-index="${optionIndex}">
          <span class="opt-dot"></span>
          <span class="opt-label">${escapeHtml(opt.label)}</span>
        </div>
      `;
    }).join('');

    // A custom-idea group is a blank slate: whatever's already been typed
    // in renders as a normal, clickable options list (same three states as
    // above), but instead of Retry/Random/+Custom it always shows the
    // input that adds MORE typed options to itself — capped at 6, same as
    // every other group's option limit. It still follows the same
    // never-shows-a-footer rule as any other spawned child, since this
    // box is itself one of the (up to 3-or-4) things that spawned from a
    // selection, not something that's had a selection made on it.
    if(isCustomIdeaNode){
      const inputRowHtml = options.length < 6 ? `
        <div class="canvas-custom-row canvas-custom-row-persistent">
          <input type="text" placeholder="Write your own idea…" data-custom-input />
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
        <input type="text" placeholder="Type your own option…" data-custom-input />
        <button class="mini-btn" data-action="custom-submit">Add</button>
      </div>`}` : '';

    const checkpointIntroHtml = isCheckpointNode
      ? `<div class="checkpoint-intro">An idea is taking shape. Which way does it lean?</div>`
      : '';

    card.innerHTML = `
      <div class="canvas-group-header" data-drag-handle>
        <div class="header-spacer" aria-hidden="true">${controlsHtml}</div>
        <div class="canvas-group-title">${blockColorDotHtml(group.block_name)}<span>${escapeHtml(group.label)}</span></div>
        <div class="header-controls">${controlsHtml}</div>
      </div>
      ${checkpointIntroHtml}
      <div class="canvas-group-options">${optionsHtml}</div>
      ${footerHtml}
    `;

    layer.appendChild(card);
  });

  wireGroupEvents();
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
        optEl.addEventListener('click', () => handleOptionActivate(optionId));
      }
      // 'inert' options do nothing on their own — they're only reachable as
      // a drop target for someone else's drag (see endLineDrag).
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
    canvasState.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, canvasState.zoom + delta));
    applyWorldTransform();
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
      canvasState.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pinchStartZoom * (newDistance / pinchStartDistance)));
      applyWorldTransform();
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
    canvasState.zoom = Math.min(ZOOM_MAX, canvasState.zoom + 0.1);
    applyWorldTransform();
  });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
    canvasState.zoom = Math.max(ZOOM_MIN, canvasState.zoom - 0.1);
    applyWorldTransform();
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

  console.log('[ThinkMaps] line-drag completed — activating option', targetOptionEl.dataset.optionId);
  handleOptionActivate(targetOptionEl.dataset.optionId);
}

async function handleOptionActivate(optionId){
  if(canvasState.isLocked) return;
  const option = canvasState.options.find(o => o.id === optionId);
  setCanvasBusy(true, buildActivationAckMessage(option?.label));
  try {
    const res = await authedFetch(`/options/${optionId}/activate`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      console.error('[ThinkMaps] activate failed:', body.error, body.detail);
      alert(body.error || 'Could not activate that option.');
      return;
    }
    canvasState.lastActivatedOptionId = optionId;
    await loadGraph(); // simplest correct way to pick up frozen-sibling changes too
  } catch (err){
    alert('Something went wrong activating that option.');
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
    await loadGraph();
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

// ---------- CONFIRMATION PAGE (the 15-node "harden the idea" flow) ----------
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
  deeperAnalysis: null,
  deeperAnalysisRendered: false,
  rewrittenIdea: null
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
      renderConfirmResult(body.result);
      return;
    }

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
}

async function submitConfirmAnswer(selectedOption, currentQuestionNumber, totalQuestions){
  const optionsEl = document.getElementById('confirmOptions');
  const questionEl = document.getElementById('confirmQuestion');
  const cardEl = document.getElementById('confirmCard');
  const researchingEl = document.getElementById('confirmResearching');

  if(optionsEl) optionsEl.querySelectorAll('.ideate-option').forEach(b => b.disabled = true);

  // The 3rd answer kicks off the actual deep-research pipeline on the
  // backend — genuinely slower than a normal question turnaround, so it
  // gets its own honest state instead of a "Thinking…" flash that would
  // otherwise look stuck.
  const isLastQuestion = currentQuestionNumber >= totalQuestions;
  if(isLastQuestion){
    if(cardEl) cardEl.style.display = 'none';
    if(researchingEl) researchingEl.style.display = 'block';
  } else if(questionEl){
    questionEl.textContent = 'Thinking…';
  }

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ selectedOption })
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      if(researchingEl) researchingEl.style.display = 'none';
      if(cardEl) cardEl.style.display = 'block';
      showConfirmError(body.error || 'Something went wrong submitting that.');
      return;
    }

    if(body.status === 'completed'){
      renderConfirmResult(body.result);
    } else {
      if(cardEl) cardEl.style.display = 'block';
      renderConfirmQuestion(body);
    }
  } catch (err){
    if(researchingEl) researchingEl.style.display = 'none';
    if(cardEl) cardEl.style.display = 'block';
    showConfirmError('Something went wrong submitting that.');
  }
}

function renderConfirmResult(result){
  const cardEl = document.getElementById('confirmCard');
  const researchingEl = document.getElementById('confirmResearching');
  const fillEl = document.getElementById('confirmProgressFill');
  const progressEl = document.getElementById('confirmProgress');
  const resultEl = document.getElementById('confirmResult');

  if(cardEl) cardEl.style.display = 'none';
  if(researchingEl) researchingEl.style.display = 'none';
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

    ${competitorsHtml ? `<h3 class="confirm-section-title">What's already out there</h3><div class="competitors-list">${competitorsHtml}</div>` : ''}
    ${solutionsHtml ? `<h3 class="confirm-section-title">How this idea solves their weak points</h3><div class="solutions-list">${solutionsHtml}</div>` : ''}

    <div id="deeperAnalysisSection"></div>

    <a href="dashboard.html" class="btn btn-primary">Back to dashboard</a>
  `;

  // Once an idea has been rewritten, the analysis that produced it isn't
  // shown again — it's already been folded into the rewrite itself.
  // This applies just as much on a resumed page load as it does right
  // after clicking Rewrite, so the section never even gets created here.
  if(confirmState.rewrittenIdea){
    renderIdeaCore(confirmState.rewrittenIdea, true);
    const deeperEl = document.getElementById('deeperAnalysisSection');
    if(deeperEl) deeperEl.remove();
    return;
  }

  renderIdeaCore(result, false);

  const deeperEl = document.getElementById('deeperAnalysisSection');
  if(deeperEl && !confirmState.deeperAnalysisRendered){
    if(confirmState.deeperAnalysis){
      renderDeeperAnalysis(confirmState.deeperAnalysis);
    } else {
      deeperEl.innerHTML = `
        <button class="btn btn-secondary" id="runDeeperAnalysisBtn" type="button">Run Market Intel &amp; Risk Analysis</button>
      `;
      const btn = document.getElementById('runDeeperAnalysisBtn');
      if(btn) btn.addEventListener('click', runDeeperAnalysis);
    }
  }
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
      <p>Pulling competitor pricing, real chatter about the problem, and running a simulated reaction panel — this takes longer than the steps before it.</p>
    </div>
  `;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/deeper-analysis`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if(!res) return;

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

    <div id="rewriteIdeaSection"></div>
  `;

  const rewriteEl = document.getElementById('rewriteIdeaSection');
  if(rewriteEl){
    rewriteEl.innerHTML = `<button class="btn btn-secondary" id="runRewriteIdeaBtn" type="button">Rewrite Idea</button>`;
    const btn = document.getElementById('runRewriteIdeaBtn');
    if(btn) btn.addEventListener('click', runRewriteIdea);
  }
}

// Triggered by the "Rewrite Idea" button at the very end of the deeper
// analysis — takes the original hardened idea plus everything Market
// Intel / Synthetic Panel / Risk Plan found and rewrites it into a
// sharper, more specifically monetizable version. Updates the SAME core
// idea block at the top of the page in place (renderIdeaCore), rather
// than appending a second copy of the idea further down — this is meant
// to read as "the idea, now improved," not "here's a second idea." Once
// the rewrite lands, the whole analysis section that produced it goes
// away entirely — it's already been folded into the rewrite, there's
// nothing left to look at it for.
async function runRewriteIdea(){
  const rewriteEl = document.getElementById('rewriteIdeaSection');
  if(!rewriteEl) return;

  rewriteEl.innerHTML = `
    <div class="confirm-researching">
      <div class="confirm-spinner"></div>
      <p>Rewriting the idea using everything the analysis above just found…</p>
    </div>
  `;

  try {
    const res = await authedFetch(`/confirm/${confirmState.sessionId}/rewrite`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if(!res) return;

    const body = await res.json();
    if(!res.ok){
      rewriteEl.innerHTML = `<p class="confirm-error">${escapeHtml(body.error || 'Could not rewrite the idea.')}</p>`;
      return;
    }

    confirmState.rewrittenIdea = body.rewrittenIdea;
    renderIdeaCore(body.rewrittenIdea, true);

    const deeperEl = document.getElementById('deeperAnalysisSection');
    if(deeperEl) deeperEl.remove();

    const coreEl = document.getElementById('ideaCoreSection');
    if(coreEl) coreEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    rewriteEl.innerHTML = `<p class="confirm-error">Something went wrong rewriting the idea.</p>`;
  }
}
