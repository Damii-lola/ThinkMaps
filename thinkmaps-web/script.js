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
    supabaseConfigPromise = fetch(`${API_BASE_URL}/config`).then(res => res.json());
  }

  const { supabaseUrl, supabaseAnonKey } = await supabaseConfigPromise;
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

document.addEventListener('DOMContentLoaded', () => {
  checkBackendStatus();
  initGraphDemo();
  initAuthPage();
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
    errorEl.textContent = err.message || 'Could not sign in. Check your details and try again.';
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
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });

    if(error){
      if(/duplicate|unique/i.test(error.message)){
        throw new Error('That email or username is already taken.');
      }
      throw error;
    }

    window.location.href = 'dashboard.html';
  } catch (err){
    errorEl.textContent = err.message || 'Could not create your account. Try again.';
  }
}
