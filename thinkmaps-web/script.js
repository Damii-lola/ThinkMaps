// ThinkMaps — single shared frontend script.
// Every page (index, auth, dashboard, app) loads this file.
// It checks what's actually on the page and runs the matching logic.
// All backend calls go through API_BASE_URL, pointed at the Render service.

const API_BASE_URL = 'https://thinkmaps.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  checkBackendStatus();
  initGraphDemo();
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
