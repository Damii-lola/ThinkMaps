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
// Runs on every page. If #navCta exists (currently just index.html, but
// works the same on any future page with this same nav pattern) and the
// person already has a session — Supabase persists that across visits by
// default — swap "Sign in" / "Start a blueprint" for a single "Dashboard" link.
async function initNavAuthState(){
  const navCta = document.getElementById('navCta');
  if(!navCta) return;

  const session = await getActiveSession();
  if(session){
    navCta.innerHTML = `<a href="dashboard.html" class="btn btn-primary">Dashboard</a>`;
  }
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
    bannerEl.innerHTML = `<span class="eyebrow">Pro</span> Unlimited blueprints, no 7-day lock.`;
    bannerEl.classList.add('pro');
  } else {
    // Selar checkout isn't wired in yet — placeholder link until that phase.
    bannerEl.innerHTML = `
      <span class="eyebrow">Free plan</span>
      One blueprint, seven days, then read-only.
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
    document.getElementById('newBlueprintBtn').addEventListener('click', createBlueprint);
    return;
  }

  const cards = blueprints.map(bp => {
    const createdLabel = new Date(bp.created_at).toLocaleDateString();
    const statusLabel = bp.isLocked
      ? 'Locked — read-only'
      : (bp.daysRemaining != null ? `${bp.daysRemaining} day(s) left on free tier` : 'Active');

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
  if(newBtn) newBtn.addEventListener('click', createBlueprint);
}

async function createBlueprint(){
  try {
    const res = await authedFetch('/blueprints', { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;

    const body = await res.json();

    if(!res.ok){
      alert(body.error || 'Could not create blueprint.');
      return;
    }

    window.location.href = `app.html?blueprint=${body.blueprint.id}`;
  } catch (err){
    alert('Could not create blueprint. Try again.');
  }
}

// ---------- BLUEPRINT CANVAS PAGE ----------
// Skips entirely on pages without #canvasWorld.
// Layout math is fully data-driven (fixed card/row sizes) rather than reading
// the DOM, so line-drawing stays correct under any pan/zoom without forcing
// layout reflows.

const CARD_WIDTH = 220;
const HEADER_HEIGHT = 40;
const OPTION_ROW_HEIGHT = 38;
// Matches the -6000px top/left on .canvas-lines in styles.css — every
// coordinate handed to the SVG gets shifted by this so world position (0,0)
// lands safely inside the SVG's own box instead of right at its corner.
const SVG_OFFSET = 6000;

const canvasState = {
  blueprintId: null,
  isLocked: false,
  groups: [],
  groupVersions: [],
  options: [],
  pan: { x: 0, y: 0 },
  zoom: 1,
  hasCenteredOnce: false
};

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
  renderGroups(visible);
  renderLines(visible);
  applyWorldTransform();
}

function renderGroups(visible){
  const layer = document.getElementById('groupsLayer');
  if(!layer) return;
  layer.innerHTML = '';

  const disabledAttr = canvasState.isLocked ? 'disabled' : '';

  visible.forEach(({ group, versions, options }) => {
    const card = document.createElement('div');
    card.className = `canvas-group ${group.is_frozen ? 'frozen' : ''}`;
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

    // Three states per option:
    //  - selected (already activated)  → its dot is the next drag SOURCE
    //  - root + not yet activated      → plain click activates it
    //  - non-root + not yet activated  → inert; only reachable as a drop target
    const optionsHtml = options.map((opt, optionIndex) => {
      const stateClass = opt.is_selected ? 'selected' : (isRootGroup ? 'root-clickable' : 'inert');
      return `
        <div class="canvas-option ${stateClass}" data-option-id="${opt.id}" data-option-index="${optionIndex}">
          <span class="opt-dot"></span>
          <span class="opt-label">${escapeHtml(opt.label)}</span>
        </div>
      `;
    }).join('');

    card.innerHTML = `
      <div class="canvas-group-header" data-drag-handle>
        <span>${escapeHtml(group.label)}</span>
        ${versionNav}
        ${!isRootGroup && !canvasState.isLocked ? `<button class="remove-btn" data-action="remove-group" title="Remove this group">×</button>` : ''}
      </div>
      <div class="canvas-group-options">${optionsHtml}</div>
      <div class="canvas-group-footer">
        <button class="mini-btn" data-action="retry" ${disabledAttr}>Retry</button>
        <button class="mini-btn" data-action="random" ${disabledAttr}>Random</button>
        <button class="mini-btn" data-action="custom-toggle" ${disabledAttr}>+ Custom</button>
      </div>
      <div class="canvas-custom-row" style="display:none;">
        <input type="text" placeholder="Type your own option…" data-custom-input />
        <button class="mini-btn" data-action="custom-submit">Add</button>
      </div>
    `;

    layer.appendChild(card);
  });

  wireGroupEvents();
}

function wireGroupEvents(){
  document.querySelectorAll('.canvas-group').forEach(card => {
    const groupId = card.dataset.groupId;

    const dragHandle = card.querySelector('[data-drag-handle]');
    if(dragHandle) dragHandle.addEventListener('mousedown', (e) => startGroupDrag(e, groupId));

    card.querySelectorAll('.canvas-option').forEach(optEl => {
      const optionId = optEl.dataset.optionId;
      const optionIndex = Number(optEl.dataset.optionIndex);
      const dot = optEl.querySelector('.opt-dot');

      if(optEl.classList.contains('selected')){
        // Already active — drag FROM here to pick the next step.
        if(dot) dot.addEventListener('mousedown', (e) => startLineDrag(e, optionId, groupId, optionIndex));
      } else if(optEl.classList.contains('root-clickable')){
        // Root, never activated — a plain click is the bootstrap trigger,
        // since there's nothing before it to drag from.
        optEl.addEventListener('click', () => handleOptionActivate(optionId));
      }
      // 'inert' options do nothing on their own — they're only reachable as
      // a drop target for someone else's drag (see endLineDrag).
    });

    const removeBtn = card.querySelector('[data-action="remove-group"]');
    if(removeBtn) removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveGroup(groupId);
    });

    const prevBtn = card.querySelector('[data-action="version-prev"]');
    const nextBtn = card.querySelector('[data-action="version-next"]');
    if(prevBtn) prevBtn.addEventListener('click', () => switchVersion(groupId, -1));
    if(nextBtn) nextBtn.addEventListener('click', () => switchVersion(groupId, 1));

    const retryBtn = card.querySelector('[data-action="retry"]');
    if(retryBtn) retryBtn.addEventListener('click', () => handleRetry(groupId));

    const randomBtn = card.querySelector('[data-action="random"]');
    if(randomBtn) randomBtn.addEventListener('click', () => handleRandom(groupId));

    const customToggle = card.querySelector('[data-action="custom-toggle"]');
    const customRow = card.querySelector('.canvas-custom-row');
    if(customToggle && customRow){
      customToggle.addEventListener('click', () => {
        customRow.style.display = customRow.style.display === 'none' ? 'flex' : 'none';
      });
    }

    const customSubmit = card.querySelector('[data-action="custom-submit"]');
    const customInput = card.querySelector('[data-custom-input]');
    if(customSubmit && customInput){
      customSubmit.addEventListener('click', () => handleCustomOption(groupId, customInput.value));
    }
  });
}

function renderLines(visible){
  const svg = document.getElementById('canvasLines');
  if(!svg) return;
  svg.innerHTML = '';

  const visibleGroupIds = new Set(visible.map(v => v.group.id));

  visible.forEach(({ group, options }) => {
    options.forEach((opt, optionIndex) => {
      const spawnedGroups = canvasState.groups.filter(g => g.spawned_from_option_id === opt.id);

      spawnedGroups.forEach(childGroup => {
        if(!visibleGroupIds.has(childGroup.id)) return;

        const startX = (group.position_x || 0) + CARD_WIDTH + SVG_OFFSET;
        const startY = (group.position_y || 0) + HEADER_HEIGHT + optionIndex * OPTION_ROW_HEIGHT + OPTION_ROW_HEIGHT / 2 + SVG_OFFSET;
        const endX = (childGroup.position_x || 0) + SVG_OFFSET;
        const endY = (childGroup.position_y || 0) + HEADER_HEIGHT / 2 + SVG_OFFSET;
        const midX = (startX + endX) / 2;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
        if(childGroup.is_frozen) path.setAttribute('class', 'frozen-line');
        svg.appendChild(path);
      });
    });
  });
}

function applyWorldTransform(){
  const world = document.getElementById('canvasWorld');
  if(!world) return;
  world.style.transform = `translate(${canvasState.pan.x}px, ${canvasState.pan.y}px) scale(${canvasState.zoom})`;
}

function centerCanvasOnRoot(){
  const viewport = document.getElementById('canvasViewport');
  if(!viewport) return;
  canvasState.pan = { x: viewport.clientWidth / 2 - CARD_WIDTH / 2, y: 80 };
  applyWorldTransform();
}

function setCanvasBusy(isBusy){
  const viewport = document.getElementById('canvasViewport');
  const indicator = document.getElementById('canvasBusyIndicator');
  if(viewport) viewport.classList.toggle('busy', isBusy);
  if(indicator) indicator.style.display = isBusy ? 'block' : 'none';
}

function setupCanvasInteractions(){
  const viewport = document.getElementById('canvasViewport');
  if(!viewport) return;

  viewport.addEventListener('mousedown', (e) => {
    if(e.target.closest('.canvas-group')) return; // group drag handles its own mousedown
    isPanning = true;
    panStartPointer = { x: e.clientX, y: e.clientY };
    panStartValue = { ...canvasState.pan };
    viewport.classList.add('panning');
  });

  window.addEventListener('mousemove', (e) => {
    if(isPanning){
      const dx = e.clientX - panStartPointer.x;
      const dy = e.clientY - panStartPointer.y;
      canvasState.pan = { x: panStartValue.x + dx, y: panStartValue.y + dy };
      applyWorldTransform();
    } else if(draggingGroupId){
      const dx = (e.clientX - dragStartPointer.x) / canvasState.zoom;
      const dy = (e.clientY - dragStartPointer.y) / canvasState.zoom;
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
      updateLineDragPreview(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mouseup', (e) => {
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
      endLineDrag(e);
    }
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    canvasState.zoom = Math.min(2, Math.max(0.3, canvasState.zoom + delta));
    applyWorldTransform();
  }, { passive: false });

  document.getElementById('zoomInBtn')?.addEventListener('click', () => {
    canvasState.zoom = Math.min(2, canvasState.zoom + 0.1);
    applyWorldTransform();
  });
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
    canvasState.zoom = Math.max(0.3, canvasState.zoom - 0.1);
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
  dragStartPointer = { x: e.clientX, y: e.clientY };
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

  const startX = (group.position_x || 0) + CARD_WIDTH;
  const startY = (group.position_y || 0) + HEADER_HEIGHT + optionIndex * OPTION_ROW_HEIGHT + OPTION_ROW_HEIGHT / 2;

  lineDragState = {
    optionId,
    startX, startY,
    initialClientX: e.clientX,
    initialClientY: e.clientY,
    currentWorld: null
  };

  highlightEligibleDropTargets(optionId);
  updateLineDragPreview(e.clientX, e.clientY);
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
  const svg = document.getElementById('canvasLines');
  if(!viewport || !svg) return;

  const rect = viewport.getBoundingClientRect();
  const worldX = (clientX - rect.left - canvasState.pan.x) / canvasState.zoom;
  const worldY = (clientY - rect.top - canvasState.pan.y) / canvasState.zoom;

  let previewPath = document.getElementById('lineDragPreview');
  if(!previewPath){
    previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.setAttribute('id', 'lineDragPreview');
    previewPath.setAttribute('class', 'drag-preview-line');
    svg.appendChild(previewPath);
  }

  const midX = (lineDragState.startX + worldX) / 2;
  const d = `M ${lineDragState.startX + SVG_OFFSET} ${lineDragState.startY + SVG_OFFSET} C ${midX + SVG_OFFSET} ${lineDragState.startY + SVG_OFFSET}, ${midX + SVG_OFFSET} ${worldY + SVG_OFFSET}, ${worldX + SVG_OFFSET} ${worldY + SVG_OFFSET}`;
  previewPath.setAttribute('d', d);

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

  const previewPath = document.getElementById('lineDragPreview');
  if(previewPath) previewPath.remove();
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
  setCanvasBusy(true);
  try {
    const res = await authedFetch(`/options/${optionId}/activate`, { method: 'POST', body: JSON.stringify({}) });
    if(!res) return;
    if(!res.ok){
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Could not activate that option.');
      return;
    }
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
