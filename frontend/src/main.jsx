import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useParams
} from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// Global styles — injected into <head> at the bottom of this file.
// ============================================================
const GLOBAL_CSS = `
:root {
  --bg: #F0EEE6;
  --surface: #FAF9F5;
  --surface-2: #E7E2D5;
  --ink: #1F1B16;
  --ink-muted: #6B6358;
  --accent: #D97757;
  --accent-deep: #BD5B3A;
  --accent-soft: rgba(217, 119, 87, 0.12);
  --line: #DAD5C7;
  --frozen: #AEA99D;
  --frozen-bg: #E3DFD3;
  --font-display: 'Fraunces', serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --maxw: 1120px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 16px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
img, svg { display: block; max-width: 100%; }
a { color: inherit; }
button { font-family: inherit; }
:focus-visible { outline: 2px solid var(--accent-deep); outline-offset: 3px; border-radius: 4px; }
.wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 28px; }
.eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-deep); font-weight: 500; }
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; margin: 0; color: var(--ink); }
p { margin: 0; }
.muted { color: var(--ink-muted); }
ul.muted { padding-left: 20px; font-size: 14px; }
.btn { font-family: var(--font-body); font-weight: 600; font-size: 14px; padding: 11px 20px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; transition: transform .15s ease, box-shadow .15s ease; }
.btn-primary { background: var(--accent); color: #FAF6F1; }
.btn-primary:hover { background: var(--accent-deep); }
.btn-primary:disabled { opacity: .55; cursor: not-allowed; }
.btn-ghost { background: transparent; color: var(--ink); border-color: var(--line); }
.btn-ghost:hover { border-color: var(--ink-muted); }
@media (prefers-reduced-motion: no-preference) { .btn:hover { transform: translateY(-1px); } }
.page-loading { padding: 100px 20px; text-align: center; color: var(--ink-muted); }
.auth-error { color: var(--accent-deep); font-size: 13px; margin-bottom: 14px; }
header.site { position: sticky; top: 0; z-index: 50; background: rgba(240,238,230,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
nav.bar { display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; max-width: var(--maxw); margin: 0 auto; }
.logo { display: flex; align-items: center; gap: 8px; font-family: var(--font-mono); font-weight: 500; font-size: 15px; text-decoration: none; color: var(--ink); }
.logo-mark { width: 18px; height: 18px; }
.nav-links { display: flex; gap: 32px; font-size: 14px; }
.nav-links a { text-decoration: none; color: var(--ink-muted); }
.nav-links a:hover { color: var(--ink); }
.nav-cta { display: flex; align-items: center; gap: 18px; }
@media (max-width: 720px) { .nav-links { display: none; } }
.hero { padding: 88px 0 40px; }
.hero-inner { text-align: center; max-width: 760px; margin: 0 auto; }
.hero h1 { font-size: clamp(34px, 5.4vw, 58px); line-height: 1.06; margin: 18px 0 20px; letter-spacing: -0.01em; }
.hero .sub { font-size: 18px; color: var(--ink-muted); max-width: 560px; margin: 0 auto 30px; }
.hero-ctas { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-bottom: 64px; }
.hint-link { font-size: 14px; color: var(--ink-muted); text-decoration: none; align-self: center; }
.hint-link:hover { color: var(--ink); }
.graph-demo { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 36px 24px 28px; max-width: 920px; margin: 0 auto; }
.graph-canvas { position: relative; min-height: 300px; }
.graph-lines { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.graph-lines path { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; }
.node-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; position: relative; z-index: 2; }
.node-pill { font-family: var(--font-mono); font-size: 13px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); padding: 9px 16px; border-radius: 999px; cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease; }
.node-pill:hover { border-color: var(--accent); }
.node-pill.active { background: var(--accent); border-color: var(--accent); color: #FAF6F1; }
.child-row { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-top: 56px; min-height: 64px; position: relative; z-index: 2; }
.child-card { background: var(--surface); border: 1px solid var(--accent); border-radius: 10px; padding: 10px 14px; width: 168px; text-align: left; }
.child-card .k { font-family: var(--font-mono); font-size: 10px; letter-spacing: .08em; color: var(--accent-deep); text-transform: uppercase; }
.child-card .v { font-size: 13.5px; margin-top: 3px; }
.frozen-lane { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 30px; min-height: 30px; }
.frozen-pill { font-family: var(--font-mono); font-size: 11.5px; background: var(--frozen-bg); border: 1px dashed var(--frozen); color: var(--ink-muted); padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.frozen-pill:hover { color: var(--ink); border-color: var(--ink-muted); }
.frozen-pill span { color: var(--frozen); margin: 0 2px; }
.graph-caption { text-align: center; font-size: 13px; color: var(--ink-muted); margin-top: 22px; }
.section { padding: 84px 0; }
.section-head { max-width: 560px; margin-bottom: 48px; }
.section-head h2 { font-size: clamp(26px, 3.4vw, 36px); margin-top: 14px; }
.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; }
@media (max-width: 900px) { .steps { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .steps { grid-template-columns: 1fr; } }
.step { border-top: 1px solid var(--line); padding-top: 18px; }
.step .num { font-family: var(--font-mono); font-size: 12px; color: var(--frozen); }
.step h3 { font-size: 18px; margin: 10px 0 8px; }
.step p { font-size: 14.5px; color: var(--ink-muted); }
.features { background: var(--surface); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
@media (max-width: 860px) { .feature-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .feature-grid { grid-template-columns: 1fr; } }
.feature { background: var(--surface); padding: 28px 24px; }
.feature .eyebrow { display: block; margin-bottom: 10px; }
.feature h3 { font-size: 17px; margin-bottom: 8px; }
.feature p { font-size: 14px; color: var(--ink-muted); }
.idea-wrap { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 40px; align-items: start; }
@media (max-width: 860px) { .idea-wrap { grid-template-columns: 1fr; } }
.idea-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 28px; }
.idea-tag { font-family: var(--font-mono); font-size: 11px; color: var(--accent-deep); text-transform: uppercase; letter-spacing: .08em; }
.idea-card h3 { font-size: 22px; margin: 8px 0 4px; }
.idea-oneliner { color: var(--ink-muted); font-size: 14.5px; margin-bottom: 18px; }
.idea-block { margin-bottom: 16px; }
.idea-block .lbl { font-family: var(--font-mono); font-size: 11px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
.idea-block p { font-size: 14px; }
.idea-block .sub-lbl { font-size: 12px; font-weight: 600; margin: 10px 0 4px; color: var(--ink); }
.idea-note { font-size: 12px; color: var(--frozen); font-family: var(--font-mono); margin-top: 18px; }
.quote-line { font-style: italic; }
.src-ref { font-family: var(--font-mono); color: var(--accent-deep); font-style: normal; }
.build-prompt { white-space: pre-wrap; background: var(--surface-2); border-radius: 8px; padding: 12px; font-size: 12.5px; font-family: var(--font-mono); }
.radar-panel { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; text-align: center; }
.radar-panel h4 { font-family: var(--font-mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-muted); margin-bottom: 18px; }
.radar-legend { display: flex; flex-direction: column; gap: 4px; margin-top: 14px; text-align: left; }
.category-toggle { display: flex; justify-content: space-between; width: 100%; background: none; border: none; padding: 6px 4px; font-size: 12px; font-family: var(--font-mono); color: var(--ink-muted); cursor: pointer; border-radius: 6px; }
.category-toggle:hover { background: var(--accent-soft); color: var(--ink); }
.category-toggle b { color: var(--ink); }
.category-detail { margin-top: 14px; text-align: left; background: var(--surface-2); border-radius: 10px; padding: 14px; }
.category-detail .lbl { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; color: var(--accent-deep); margin-bottom: 8px; }
.category-detail ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.category-detail li { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; }
.cta-band { text-align: center; padding: 90px 0; }
.cta-band h2 { font-size: clamp(26px, 4vw, 38px); margin: 14px 0 26px; max-width: 600px; margin-inline: auto; }
footer { border-top: 1px solid var(--line); padding: 36px 0; }
.foot-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
.foot-links { display: flex; gap: 22px; font-size: 13px; color: var(--ink-muted); }
.foot-links a { text-decoration: none; }
.foot-links a:hover { color: var(--ink); }
.foot-fine { font-size: 12px; color: var(--frozen); margin-top: 18px; }
.app-nav { display: flex; justify-content: space-between; align-items: center; padding: 16px 28px; border-bottom: 1px solid var(--line); background: var(--bg); position: sticky; top: 0; z-index: 40; }
.app-nav-right { display: flex; align-items: center; gap: 10px; }
.auth-shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); padding: 24px; }
.auth-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 36px; width: 380px; }
.auth-card h1 { font-size: 26px; margin-bottom: 6px; }
.auth-card .sub { color: var(--ink-muted); font-size: 14px; margin-bottom: 24px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-muted); margin-bottom: 6px; }
.field input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-family: var(--font-body); font-size: 14px; }
.field input:focus { outline: none; border-color: var(--accent); }
.auth-switch { margin-top: 18px; font-size: 13px; text-align: center; color: var(--ink-muted); }
.auth-switch a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }
.dashboard-shell { max-width: 960px; margin: 0 auto; padding: 40px 28px; }
.dashboard-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; flex-wrap: wrap; gap: 12px; }
.dashboard-head h1 { font-size: 28px; }
.blueprint-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
.blueprint-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 20px; text-decoration: none; color: var(--ink); display: block; transition: border-color .15s; }
.blueprint-card:hover { border-color: var(--accent); }
.blueprint-card h3 { font-size: 17px; margin-bottom: 6px; }
.blueprint-card .meta { font-size: 12px; font-family: var(--font-mono); color: var(--ink-muted); }
.locked-tag { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--frozen); border: 1px dashed var(--frozen); padding: 3px 8px; border-radius: 999px; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--ink-muted); }
.limit-banner { background: var(--accent-soft); border: 1px solid var(--accent); border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.pricing-shell { max-width: 900px; margin: 0 auto; padding: 60px 28px; }
.pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 700px) { .pricing-grid { grid-template-columns: 1fr; } }
.plan { border: 1px solid var(--line); border-radius: 16px; padding: 30px; background: var(--surface); }
.plan.pro { border-color: var(--accent); }
.plan .ptag { font-family: var(--font-mono); font-size: 11px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: .08em; }
.plan h3 { font-size: 22px; margin: 10px 0 2px; }
.plan .price { font-family: var(--font-display); font-size: 36px; margin: 10px 0 18px; }
.plan .price sup { font-family: var(--font-body); font-size: 14px; color: var(--ink-muted); font-weight: 500; }
.plan ul { list-style: none; padding: 0; margin: 0 0 22px; display: flex; flex-direction: column; gap: 9px; }
.plan li { font-size: 14px; color: var(--ink-muted); padding-left: 20px; position: relative; }
.plan li::before { content: "—"; position: absolute; left: 0; color: var(--accent-deep); }
.plan .btn { width: 100%; justify-content: center; }
.canvas-shell { position: relative; width: 100%; overflow: hidden; background-color: var(--bg); background-image: radial-gradient(circle, var(--line) 1px, transparent 1px); background-size: 22px 22px; cursor: grab; }
.canvas-shell:active { cursor: grabbing; }
.canvas-world { position: absolute; top: 0; left: 0; transform-origin: 0 0; width: 6000px; height: 4000px; }
.canvas-lines { position: absolute; top: 0; left: 0; pointer-events: none; }
.canvas-lines path.line-active { fill: none; stroke: var(--accent); stroke-width: 2; }
.canvas-lines path.line-frozen { fill: none; stroke: var(--frozen); stroke-width: 1.5; stroke-dasharray: 4 4; }
.node-group-card { position: absolute; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
.node-group-card.frozen { opacity: .55; filter: grayscale(0.3); border-style: dashed; border-color: var(--frozen); }
.node-group-header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: var(--surface-2); border-bottom: 1px solid var(--line); border-radius: 12px 12px 0 0; cursor: grab; position: relative; }
.node-group-header .header-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-muted); position: absolute; left: -4px; top: 50%; transform: translateY(-50%); }
.node-group-header .label { font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: .03em; flex: 1; }
.node-group-actions { display: flex; gap: 4px; }
.icon-btn { width: 24px; height: 24px; border-radius: 6px; border: none; background: transparent; color: var(--ink-muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; }
.icon-btn:hover { background: var(--accent-soft); color: var(--accent-deep); }
.option-row { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; border-bottom: 1px solid var(--line); font-size: 13.5px; cursor: pointer; }
.option-row:last-child { border-bottom: none; }
.option-row:hover { background: var(--accent-soft); }
.option-row.active { background: var(--accent); color: #FAF6F1; font-weight: 600; }
.option-row.frozen-choice { background: var(--frozen-bg); color: var(--ink-muted); text-decoration: line-through; opacity: .85; }
.option-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-muted); position: absolute; right: -4px; top: 50%; transform: translateY(-50%); }
.option-row.active .option-dot { background: #FAF6F1; }
.custom-option-row { display: flex; gap: 6px; padding: 8px 12px; align-items: center; }
.custom-option-row input { flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font-size: 13px; background: var(--surface); }
.zoom-controls { display: flex; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 4px; position: absolute; bottom: 16px; right: 16px; z-index: 30; }
.path-banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); background: var(--surface); border: 1px solid var(--accent); padding: 8px 16px; border-radius: 999px; font-size: 13px; z-index: 30; white-space: nowrap; }
.generate-btn-floating { position: absolute; bottom: 16px; left: 16px; z-index: 30; }
.generating-toast { position: absolute; top: 16px; right: 16px; background: var(--surface); border: 1px solid var(--line); padding: 6px 14px; border-radius: 999px; font-size: 12px; color: var(--ink-muted); z-index: 30; }
.idea-results-overlay { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100%); background: var(--surface); border-left: 1px solid var(--line); overflow-y: auto; padding: 24px; z-index: 60; box-shadow: -8px 0 24px rgba(0,0,0,0.08); }
.idea-results-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.idea-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.idea-tab { font-size: 12px; font-family: var(--font-mono); background: var(--surface-2); border: 1px solid var(--line); padding: 6px 10px; border-radius: 999px; cursor: pointer; color: var(--ink-muted); }
.idea-tab.active { background: var(--accent); border-color: var(--accent); color: #FAF6F1; }
`;

// ============================================================
// Supabase client + small fetch helper for the backend API
// ============================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function apiFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }

  return res.json();
}

// ============================================================
// Auth context — shared across every page
// ============================================================
const AuthContext = createContext({ user: null, profile: null, loading: true, refreshProfile: () => {} });
const useAuth = () => useContext(AuthContext);

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Shared free-tier lock rule: Pro users never lock; everyone else locks 7 days after creation.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
function isBlueprintLocked(blueprint, profile) {
  if (profile?.is_pro) return false;
  return Date.now() - new Date(blueprint.created_at).getTime() > SEVEN_DAYS_MS;
}

// ============================================================
// NavBar — shared header for logged-in app pages
// ============================================================
function NavBar({ right }) {
  return (
    <header className="app-nav">
      <Link to="/" className="logo">
        <svg className="logo-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="3" r="2" fill="#D97757" />
          <circle cx="3" cy="14" r="2" fill="#1F1B16" />
          <circle cx="15" cy="14" r="2" fill="#1F1B16" />
          <path d="M9 5L3 12M9 5L15 12" stroke="#D97757" strokeWidth="1.2" />
        </svg>
        ThinkMaps
      </Link>
      <div className="app-nav-right">{right}</div>
    </header>
  );
}

// ============================================================
// NodeGroup — a single draggable group card on the canvas
// ============================================================
const CARD_WIDTH = 240;
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 40;

function NodeGroup({ node, isFrozen, readOnly, onSelectOption, onRetry, onRandom, onAddCustom, onHeaderMouseDown }) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [customText, setCustomText] = useState('');

  function submitCustom() {
    const text = customText.trim();
    if (!text) return;
    onAddCustom(node.id, text);
    setCustomText('');
    setAddingCustom(false);
  }

  return (
    <div className={`node-group-card${isFrozen ? ' frozen' : ''}`} style={{ left: node.x, top: node.y, width: CARD_WIDTH }}>
      <div className="node-group-header" onMouseDown={(e) => onHeaderMouseDown(e, node.id)}>
        <span className="header-dot" />
        <span className="label">{node.label}</span>
        {!readOnly && (
          <div className="node-group-actions">
            <button className="icon-btn" title="Retry — fresh options" onClick={() => onRetry(node.id)}>↻</button>
            <button className="icon-btn" title="Random pick" onClick={() => onRandom(node.id)}>✦</button>
          </div>
        )}
      </div>

      {node.options.map((opt) => {
        const isActive = node.selectedOptionId === opt.id;
        const isFrozenChoice = node.frozenOptionIds.includes(opt.id);
        return (
          <div
            key={opt.id}
            className={`option-row${isActive ? ' active' : ''}${isFrozenChoice ? ' frozen-choice' : ''}`}
            onClick={() => !readOnly && onSelectOption(node.id, opt.id)}
          >
            <span>{opt.text}</span>
            <span className="option-dot" />
          </div>
        );
      })}

      {!readOnly && (
        <div className="custom-option-row">
          {addingCustom ? (
            <>
              <input
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitCustom()}
                placeholder="Your own option…"
              />
              <button className="icon-btn" onClick={submitCustom}>✓</button>
            </>
          ) : (
            <button className="icon-btn" title="Add custom option" onClick={() => setAddingCustom(true)}>+ Custom</button>
          )}
        </div>
      )}
    </div>
  );
}

function optionAnchor(node, optionId) {
  const index = node.options.findIndex((o) => o.id === optionId);
  const y = node.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
  return { x: node.x + CARD_WIDTH, y };
}

function headerAnchor(node) {
  return { x: node.x, y: node.y + HEADER_HEIGHT / 2 };
}

// ============================================================
// IdeaResults — generated ideas + dynamic radar chart
// ============================================================
function polarPoint(cx, cy, angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function buildRadar(categoryAverages, { cx = 120, cy = 120, maxR = 92 } = {}) {
  const n = categoryAverages.length;
  const step = 360 / n;
  const valuePoints = categoryAverages.map((s, i) => polarPoint(cx, cy, -90 + i * step, (s / 10) * maxR));
  const axisEnds = categoryAverages.map((_, i) => polarPoint(cx, cy, -90 + i * step, maxR));
  const gridRing = (fraction) => categoryAverages.map((_, i) => polarPoint(cx, cy, -90 + i * step, maxR * fraction));
  return { valuePoints, axisEnds, gridRing, cx, cy };
}

function pointsToPath(points) {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function average(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function RadarChart({ scores, framework }) {
  const [openCategory, setOpenCategory] = useState(null);

  const categoryNames = framework.map((c) => c.name);
  const categoryAverages = categoryNames.map((name) => average(scores?.[name]));
  const radar = buildRadar(categoryAverages);

  return (
    <div className="radar-panel">
      <h4>Scored against the 100-question framework</h4>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <polygon points={pointsToPath(radar.gridRing(1))} fill="none" stroke="#DAD5C7" />
        <polygon points={pointsToPath(radar.gridRing(0.66))} fill="none" stroke="#DAD5C7" />
        <polygon points={pointsToPath(radar.gridRing(0.33))} fill="none" stroke="#DAD5C7" />
        {radar.axisEnds.map((p, i) => (
          <line key={i} x1={radar.cx} y1={radar.cy} x2={p.x} y2={p.y} stroke="#DAD5C7" />
        ))}
        <polygon points={pointsToPath(radar.valuePoints)} fill="#D97757" fillOpacity="0.22" stroke="#D97757" strokeWidth="2" />
      </svg>

      <div className="radar-legend">
        {categoryNames.map((name, i) => (
          <button key={name} className="category-toggle" onClick={() => setOpenCategory(openCategory === name ? null : name)}>
            <span>{name}</span>
            <b>{categoryAverages[i].toFixed(1)}</b>
          </button>
        ))}
      </div>

      {openCategory && (
        <div className="category-detail">
          <div className="lbl">{openCategory}</div>
          <ul>
            {framework.find((c) => c.name === openCategory)?.questions.map((q, i) => (
              <li key={i}>
                <span>{q}</span>
                <b>{scores?.[openCategory]?.[i] ?? '—'}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IdeaResults({ ideas, framework, onClose }) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (!ideas || ideas.length === 0) return null;

  const idea = ideas[activeIndex];

  return (
    <div className="idea-results-overlay">
      <div className="idea-results-head">
        <h2>Your ideas</h2>
        <button className="icon-btn" onClick={onClose} title="Close">✕</button>
      </div>

      <div className="idea-tabs">
        {ideas.map((it, i) => (
          <button key={i} className={`idea-tab${i === activeIndex ? ' active' : ''}`} onClick={() => setActiveIndex(i)}>
            {it.name || `Idea ${i + 1}`}
          </button>
        ))}
      </div>

      <div className="idea-card">
        <h3>{idea.name}</h3>
        <p className="idea-oneliner">{idea.oneLiner}</p>

        <div className="idea-block">
          <div className="lbl">Core problem</div>
          <p className="muted">{idea.problem}</p>
        </div>

        {idea.sourcedQuotes?.length > 0 && (
          <div className="idea-block">
            <div className="lbl">What people are actually saying</div>
            {idea.sourcedQuotes.map((q, i) => (
              <p key={i} className="muted quote-line">
                “{q.quote}” {q.sourceRef ? <span className="src-ref">[{q.sourceRef}]</span> : null}
              </p>
            ))}
          </div>
        )}

        <div className="idea-block">
          <div className="lbl">Existing solutions fall short because</div>
          <p className="muted">{idea.existingSolutionsWeaknesses}</p>
        </div>

        <div className="idea-block">
          <div className="lbl">The 10x upgrade</div>
          <p className="muted">{idea.tenXUpgrade}</p>
        </div>

        <div className="idea-block">
          <div className="lbl">Monetization</div>
          <p className="muted">{idea.monetization}</p>
        </div>

        <div className="idea-block">
          <div className="lbl">Scoped MVP</div>
          <p className="muted">{idea.mvp}</p>
          {idea.riskyCoreMechanic && (
            <p className="muted"><b>Riskiest part:</b> {idea.riskyCoreMechanic}</p>
          )}
        </div>

        {idea.validationKit && (
          <div className="idea-block">
            <div className="lbl">Validation kit</div>
            {idea.validationKit.surveyQuestions?.length > 0 && (
              <>
                <p className="muted sub-lbl">Survey questions</p>
                <ul className="muted">{idea.validationKit.surveyQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </>
            )}
            {idea.validationKit.interviewScript?.length > 0 && (
              <>
                <p className="muted sub-lbl">Interview script</p>
                <ul className="muted">{idea.validationKit.interviewScript.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </>
            )}
            {idea.validationKit.landingPageCopy && (
              <>
                <p className="muted sub-lbl">Landing page copy</p>
                <p className="muted">{idea.validationKit.landingPageCopy}</p>
              </>
            )}
            {idea.validationKit.fakeDoorTestGuidance && (
              <>
                <p className="muted sub-lbl">Fake-door test</p>
                <p className="muted">{idea.validationKit.fakeDoorTestGuidance}</p>
              </>
            )}
          </div>
        )}

        {idea.nextSteps?.length > 0 && (
          <div className="idea-block">
            <div className="lbl">Next steps</div>
            <ul className="muted">{idea.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}

        {idea.buildPrompt && (
          <div className="idea-block">
            <div className="lbl">Build prompt (Cursor / Lovable)</div>
            <pre className="build-prompt">{idea.buildPrompt}</pre>
          </div>
        )}
      </div>

      <RadarChart scores={idea.scores} framework={framework} />
    </div>
  );
}

// ============================================================
// Landing page (marketing) — public route "/"
// ============================================================
const NICHE_DATA = {
  fitness: { label: 'Fitness', children: [
    { k: 'Sub-niche', v: 'Recovery & sleep tracking' },
    { k: 'Audience', v: 'Shift workers' },
    { k: 'Monetization', v: 'Subscription + wearables' }
  ]},
  finance: { label: 'Finance & Commerce', children: [
    { k: 'Sub-niche', v: 'Cash-flow visualization' },
    { k: 'Audience', v: 'Freelancers' },
    { k: 'Monetization', v: 'Freemium → Pro tier' }
  ]},
  productivity: { label: 'Productivity', children: [
    { k: 'Sub-niche', v: 'Async team rituals' },
    { k: 'Audience', v: 'Remote managers' },
    { k: 'Monetization', v: 'Per-seat pricing' }
  ]},
  entertainment: { label: 'Entertainment', children: [
    { k: 'Sub-niche', v: 'Local live-show discovery' },
    { k: 'Audience', v: 'College students' },
    { k: 'Monetization', v: 'Ticketing commission' }
  ]}
};

function GraphDemo() {
  const [activeNiche, setActiveNiche] = useState('fitness');
  const [frozen, setFrozen] = useState([]);
  const [linePaths, setLinePaths] = useState([]);

  const canvasRef = useRef(null);
  const rootRefs = useRef({});
  const childRefs = useRef([]);

  function selectNiche(key) {
    if (key === activeNiche) return;
    setFrozen((prev) => {
      let next = prev.filter((k) => k !== key);
      if (activeNiche && !next.includes(activeNiche)) next = [activeNiche, ...next].slice(0, 3);
      return next;
    });
    setActiveNiche(key);
  }

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const rootBtn = rootRefs.current[activeNiche];
    if (!canvas || !rootBtn) return;

    const canvasRect = canvas.getBoundingClientRect();
    const rootRect = rootBtn.getBoundingClientRect();
    const startX = rootRect.left + rootRect.width / 2 - canvasRect.left;
    const startY = rootRect.bottom - canvasRect.top;

    const paths = childRefs.current.filter(Boolean).map((el) => {
      const r = el.getBoundingClientRect();
      const endX = r.left + r.width / 2 - canvasRect.left;
      const endY = r.top - canvasRect.top;
      const midY = (startY + endY) / 2;
      return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
    });
    setLinePaths(paths);
  }, [activeNiche]);

  const data = NICHE_DATA[activeNiche];

  return (
    <div className="graph-demo" id="demo">
      <div className="graph-canvas" ref={canvasRef}>
        <svg className="graph-lines">
          {linePaths.map((d, i) => <path key={i} d={d} />)}
        </svg>
        <div className="node-row">
          {Object.keys(NICHE_DATA).map((key) => (
            <button
              key={key}
              ref={(el) => (rootRefs.current[key] = el)}
              className={`node-pill${key === activeNiche ? ' active' : ''}`}
              aria-pressed={key === activeNiche}
              onClick={() => selectNiche(key)}
            >
              {NICHE_DATA[key].label}
            </button>
          ))}
        </div>
        <div className="child-row">
          {data.children.map((c, i) => (
            <div key={c.k} className="child-card in" ref={(el) => (childRefs.current[i] = el)}>
              <div className="k">{c.k}</div>
              <div className="v">{c.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="frozen-lane">
        {frozen.map((key) => (
          <button key={key} className="frozen-pill" onClick={() => selectNiche(key)}>
            {NICHE_DATA[key].label} <span>→</span> {NICHE_DATA[key].children[1].v}
          </button>
        ))}
      </div>
      <p className="graph-caption">
        Branching from "{data.label}" — pick another niche above and this one freezes, not gone.
      </p>
    </div>
  );
}

function Landing() {
  const { user } = useAuth();
  const startHref = user ? '/dashboard' : '/signup';

  return (
    <div>
      <header className="site">
        <nav className="bar">
          <Link to="/" className="logo">
            <svg className="logo-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <circle cx="9" cy="3" r="2" fill="#D97757" />
              <circle cx="3" cy="14" r="2" fill="#1F1B16" />
              <circle cx="15" cy="14" r="2" fill="#1F1B16" />
              <path d="M9 5L3 12M9 5L15 12" stroke="#D97757" strokeWidth="1.2" />
            </svg>
            ThinkMaps
          </Link>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#idea">Output</a>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="nav-cta">
            {user ? <Link to="/dashboard" className="btn btn-ghost">Dashboard</Link> : <Link to="/login" className="btn btn-ghost">Sign in</Link>}
            <Link to={startHref} className="btn btn-primary">Start a blueprint</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero-inner">
            <span className="eyebrow">An ideation canvas for builders</span>
            <h1>Map your next app, before you build the wrong one.</h1>
            <p className="sub">
              ThinkMaps turns app-idea hunting into a visual, branching graph — grounded in real research
              instead of guesses — so you validate before you write a line of code.
            </p>
            <div className="hero-ctas">
              <Link to={startHref} className="btn btn-primary">Start your blueprint free</Link>
              <a href="#demo" className="hint-link">See how branching works ↓</a>
            </div>
          </div>
          <div className="wrap"><GraphDemo /></div>
        </section>

        <section className="section" id="how">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">How a blueprint grows</span>
              <h2>Four moves, repeated until the graph knows what you're building.</h2>
            </div>
            <div className="steps">
              <div className="step"><div className="num">01</div><h3>Pick a niche</h3><p className="muted">Start from six AI-suggested niches, or type your own to take the graph somewhere nobody's mapped yet.</p></div>
              <div className="step"><div className="num">02</div><h3>Add context</h3><p className="muted">Connect to Sub-Niche, Audience, and Monetization groups — each click narrows the graph toward something real.</p></div>
              <div className="step"><div className="num">03</div><h3>Branch freely</h3><p className="muted">Explore a path, then rewind and try another. The old branch grays out and waits — it's never deleted.</p></div>
              <div className="step"><div className="num">04</div><h3>Catch the insight</h3><p className="muted">Generate ideas once your path is deep enough, scored live against a 100-question research framework.</p></div>
            </div>
          </div>
        </section>

        <section className="section features" id="features">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">Everything past the first sketch</span>
              <h2>The graph is the start. Validation and shipping are built in.</h2>
            </div>
            <div className="feature-grid">
              <div className="feature"><span className="eyebrow">Live research</span><h3>Grounded, not guessed</h3><p>Every idea pulls live from Reddit, Hacker News, and the App Store — real complaints, not invented quotes.</p></div>
              <div className="feature"><span className="eyebrow">Open-ended</span><h3>Branch as deep as you need</h3><p>Niche → Sub-niche → Audience → Monetization → on and on. The graph never caps your depth.</p></div>
              <div className="feature"><span className="eyebrow">Never lost</span><h3>Branches freeze, not delete</h3><p>Try a path, rewind, try another. Old branches gray out and stay fully clickable, forever.</p></div>
              <div className="feature"><span className="eyebrow">Scored</span><h3>100-question framework</h3><p>Every idea is scored across 10 categories — problem severity to regulatory risk — visualized on a radar chart.</p></div>
              <div className="feature"><span className="eyebrow">Validate first</span><h3>Built-in validation kit</h3><p>Survey questions, an interview script, landing page copy, and a fake-door test for every idea generated.</p></div>
              <div className="feature"><span className="eyebrow">Ship it</span><h3>Build prompts included</h3><p>Every idea comes with a build prompt ready to paste into Cursor or Lovable.</p></div>
            </div>
          </div>
        </section>

        <section className="section" id="idea">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">From graph to idea</span>
              <h2>What comes out the other end of a finished blueprint.</h2>
            </div>
            <div className="idea-wrap">
              <div className="idea-card">
                <span className="idea-tag">Sample idea card — illustrative</span>
                <h3>Shiftwell</h3>
                <p className="idea-oneliner">Recovery and sleep tracking built around rotating shifts, not a fixed 9-to-5.</p>
                <div className="idea-block"><div className="lbl">Core problem</div><p className="muted">Existing fitness apps assume a regular daytime schedule. Shift workers fall out of every streak the moment their roster changes.</p></div>
                <div className="idea-block"><div className="lbl">10x upgrade</div><p className="muted">A schedule-aware engine that re-times reminders and sleep targets around the next shift, not the calendar date.</p></div>
                <p className="idea-note">Full version scores this against 100 questions and ships a validation kit alongside it.</p>
              </div>
              <div className="radar-panel">
                <h4>Sample scoring, 6 of 100 questions shown</h4>
                <svg viewBox="0 0 200 200" aria-hidden="true">
                  <polygon points="100,30 160,65 160,135 100,170 39,135 39,65" fill="none" stroke="#DAD5C7" />
                  <polygon points="100,53 140,77 140,123 100,147 60,123 60,77" fill="none" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="100" y2="30" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="160" y2="65" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="160" y2="135" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="100" y2="170" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="39" y2="135" stroke="#DAD5C7" />
                  <line x1="100" y1="100" x2="39" y2="65" stroke="#DAD5C7" />
                  <polygon points="100,37 142,76 149,128 100,142 52,128 58,76" fill="#D97757" fillOpacity="0.22" stroke="#D97757" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </section>

        <section className="cta-band">
          <div className="wrap">
            <span className="eyebrow">Ready when you are</span>
            <h2>Stop scrolling app-idea threads. Start mapping one.</h2>
            <Link to={startHref} className="btn btn-primary">Start your blueprint free</Link>
            <p className="muted" style={{ marginTop: 14 }}><Link to="/pricing">See full pricing →</Link></p>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap foot-row">
          <div className="logo">ThinkMaps</div>
          <div className="foot-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <Link to="/pricing">Pricing</Link>
            <a href="#">Gallery</a>
          </div>
        </div>
        <div className="wrap foot-fine">© 2026 ThinkMaps. Built for builders.</div>
      </footer>
    </div>
  );
}

// ============================================================
// Auth page — login/signup, route-driven by `mode`
// ============================================================
function Auth({ mode }) {
  const isSignup = mode === 'signup';
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (authError) { setError(authError.message); return; }
    navigate('/dashboard');
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link to="/" className="logo" style={{ marginBottom: 24, display: 'inline-flex' }}>ThinkMaps</Link>
        <h1>{isSignup ? 'Start your blueprint' : 'Welcome back'}</h1>
        <p className="sub">{isSignup ? 'One free blueprint, no card required.' : 'Sign in to keep mapping.'}</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={isSignup ? 'new-password' : 'current-password'} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-switch">
          {isSignup ? (
            <>Already have a blueprint? <Link to="/login">Sign in</Link></>
          ) : (
            <>New here? <Link to="/signup">Start your blueprint free</Link></>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Dashboard — list of blueprints, free-tier limit logic
// ============================================================
function Dashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [blueprints, setBlueprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    loadBlueprints();
  }, [user]);

  async function loadBlueprints() {
    setLoading(true);
    const { data } = await supabase.from('blueprints').select('id, title, created_at, updated_at').order('created_at', { ascending: false });
    setBlueprints(data || []);
    setLoading(false);
  }

  const atFreeLimit = !profile?.is_pro && blueprints.length >= 1;

  async function handleCreate() {
    if (atFreeLimit) return;
    setCreating(true);
    setError('');

    try {
      const { groups } = await apiFetch('/api/generate-nodes', { method: 'POST', body: JSON.stringify({ pathContext: [] }) });
      const rootGroup = groups[0] || { label: 'Niches', options: [] };
      const rootId = 'root';
      const graph_data = {
        rootId,
        nodesById: {
          [rootId]: {
            id: rootId,
            label: rootGroup.label,
            options: rootGroup.options.map((text, i) => ({ id: `${rootId}-opt-${i}`, text })),
            selectedOptionId: null,
            frozenOptionIds: [],
            children: {},
            x: 80,
            y: 220
          }
        }
      };

      const { data, error: insertError } = await supabase
        .from('blueprints')
        .insert({ user_id: user.id, title: 'Untitled blueprint', graph_data })
        .select()
        .single();

      if (insertError) throw insertError;
      navigate(`/blueprint/${data.id}`);
    } catch (err) {
      setError(err.message || 'Could not create a new blueprint right now.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <NavBar right={<button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>} />
      <div className="dashboard-shell">
        <div className="dashboard-head">
          <h1>Your blueprints</h1>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating || atFreeLimit}>
            {creating ? 'Setting up…' : '+ New blueprint'}
          </button>
        </div>

        {atFreeLimit && (
          <div className="limit-banner">
            <span>Free tier is one blueprint. Upgrade to Pro for unlimited maps.</span>
            <Link to="/pricing" className="btn btn-primary">Go Pro</Link>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        {loading ? (
          <div className="page-loading">Loading…</div>
        ) : blueprints.length === 0 ? (
          <div className="empty-state"><p>No blueprints yet. Start one and watch the graph branch.</p></div>
        ) : (
          <div className="blueprint-grid">
            {blueprints.map((bp) => {
              const locked = isBlueprintLocked(bp, profile);
              return (
                <Link key={bp.id} to={`/blueprint/${bp.id}`} className="blueprint-card">
                  <h3>{bp.title || 'Untitled blueprint'}</h3>
                  <div className="meta">Created {new Date(bp.created_at).toLocaleDateString()}</div>
                  {locked && <span className="locked-tag">Read-only — Pro to keep building</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BlueprintCanvas — the custom-built infinite pan/zoom graph
// ============================================================
function pathToNode(graph, nodeId) {
  const chain = [];
  let current = graph.nodesById[nodeId];
  while (current) {
    if (current.selectedOptionId) {
      const opt = current.options.find((o) => o.id === current.selectedOptionId);
      if (opt) chain.unshift({ label: current.label, choice: opt.text });
    }
    current = current.parentRef ? graph.nodesById[current.parentRef.nodeId] : null;
  }
  return chain;
}

function ancestorPath(graph, nodeId) {
  const node = graph.nodesById[nodeId];
  if (!node || !node.parentRef) return [];
  return pathToNode(graph, node.parentRef.nodeId);
}

function deriveActivePath(graph) {
  const path = [];
  function walk(nodeId) {
    const node = graph.nodesById[nodeId];
    if (!node) return;
    if (node.selectedOptionId) {
      const opt = node.options.find((o) => o.id === node.selectedOptionId);
      if (opt) path.push({ label: node.label, choice: opt.text });
      (node.children[node.selectedOptionId] || []).forEach(walk);
    }
  }
  walk(graph.rootId);
  return path;
}

function computeActiveNodeIds(graph) {
  const active = new Set();
  function walk(nodeId) {
    active.add(nodeId);
    const node = graph.nodesById[nodeId];
    if (!node || !node.selectedOptionId) return;
    (node.children[node.selectedOptionId] || []).forEach(walk);
  }
  walk(graph.rootId);
  return active;
}

function buildLines(graph) {
  const lines = [];
  Object.values(graph.nodesById).forEach((node) => {
    const toDraw = [
      ...(node.selectedOptionId ? [{ id: node.selectedOptionId, frozen: false }] : []),
      ...node.frozenOptionIds.map((id) => ({ id, frozen: true }))
    ];
    toDraw.forEach(({ id, frozen }) => {
      const childIds = node.children[id] || [];
      const start = optionAnchor(node, id);
      childIds.forEach((childId) => {
        const child = graph.nodesById[childId];
        if (!child) return;
        lines.push({ start, end: headerAnchor(child), frozen, key: `${node.id}-${id}-${childId}` });
      });
    });
  });
  return lines;
}

function BlueprintCanvas() {
  const { id: blueprintId } = useParams();
  const { profile } = useAuth();

  const [blueprint, setBlueprint] = useState(null);
  const [graph, setGraph] = useState(null);
  const [framework, setFramework] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatingNodeId, setGeneratingNodeId] = useState(null);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [ideas, setIdeas] = useState(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  const dragRef = useRef({ mode: null });

  useEffect(() => { transformRef.current = transform; }, [transform]);

  useEffect(() => {
    loadBlueprint();
    apiFetch('/api/framework').then((res) => setFramework(res.framework || [])).catch(() => {});
  }, [blueprintId]);

  async function loadBlueprint() {
    setLoading(true);
    const { data, error: loadError } = await supabase.from('blueprints').select('*').eq('id', blueprintId).single();

    if (loadError || !data) {
      setError('Could not load this blueprint.');
      setLoading(false);
      return;
    }

    setBlueprint(data);
    setGraph(data.graph_data);
    if (data.ideas) setIdeas(data.ideas);
    setLoading(false);
  }

  useEffect(() => {
    if (!graph || !blueprintId) return;
    const t = setTimeout(() => {
      supabase.from('blueprints').update({ graph_data: graph, updated_at: new Date().toISOString() }).eq('id', blueprintId);
    }, 800);
    return () => clearTimeout(t);
  }, [graph, blueprintId]);

  const isLocked = blueprint ? isBlueprintLocked(blueprint, profile) : false;

  useEffect(() => {
    function onMouseMove(e) {
      const d = dragRef.current;
      if (!d.mode) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.mode === 'pan') {
        setTransform((t) => ({ ...t, x: d.originX + dx, y: d.originY + dy }));
      } else if (d.mode === 'node') {
        const scale = transformRef.current.scale;
        setGraph((prev) => {
          const node = prev.nodesById[d.nodeId];
          if (!node) return prev;
          return { ...prev, nodesById: { ...prev.nodesById, [d.nodeId]: { ...node, x: d.originX + dx / scale, y: d.originY + dy / scale } } };
        });
      }
    }
    function onMouseUp() { dragRef.current = { mode: null }; }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function handleCanvasMouseDown(e) {
    dragRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y };
  }

  function handleHeaderMouseDown(e, nodeId) {
    e.stopPropagation();
    if (isLocked) return;
    const node = graph.nodesById[nodeId];
    dragRef.current = { mode: 'node', nodeId, startX: e.clientX, startY: e.clientY, originX: node.x, originY: node.y };
  }

  function zoomBy(delta) { setTransform((t) => ({ ...t, scale: Math.min(2, Math.max(0.3, t.scale + delta)) })); }
  function handleWheel(e) { e.preventDefault(); zoomBy(-e.deltaY * 0.001); }

  async function generateChildrenFor(nodeId, optionId, pathContext) {
    setGeneratingNodeId(nodeId);
    try {
      const { groups } = await apiFetch('/api/generate-nodes', { method: 'POST', body: JSON.stringify({ pathContext }) });

      setGraph((prev) => {
        const parentNode = prev.nodesById[nodeId];
        if (!parentNode) return prev;
        const anchor = optionAnchor(parentNode, optionId);
        const newNodesById = { ...prev.nodesById };
        const newChildIds = [];

        groups.forEach((g, i) => {
          const newId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
          newNodesById[newId] = {
            id: newId,
            label: g.label || 'Group',
            options: (g.options || []).slice(0, 6).map((text, j) => ({ id: `${newId}-opt-${j}`, text })),
            selectedOptionId: null,
            frozenOptionIds: [],
            children: {},
            parentRef: { nodeId, optionId },
            x: parentNode.x + 280,
            y: anchor.y - ((groups.length - 1) * 70) / 2 + i * 70
          };
          newChildIds.push(newId);
        });

        newNodesById[nodeId] = { ...parentNode, children: { ...parentNode.children, [optionId]: newChildIds } };
        return { ...prev, nodesById: newNodesById };
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingNodeId(null);
    }
  }

  async function selectOption(nodeId, optionId) {
    if (isLocked || !graph) return;
    const node = graph.nodesById[nodeId];
    if (!node || node.selectedOptionId === optionId) return;

    const chosenText = node.options.find((o) => o.id === optionId)?.text || '';
    const pathContext = [...ancestorPath(graph, nodeId), { label: node.label, choice: chosenText }];
    const alreadyExplored = (node.children[optionId] || []).length > 0;

    setGraph((prev) => {
      const prevNode = prev.nodesById[nodeId];
      const carryFrozen = prevNode.selectedOptionId
        ? Array.from(new Set([...prevNode.frozenOptionIds, prevNode.selectedOptionId]))
        : [...prevNode.frozenOptionIds];

      return {
        ...prev,
        nodesById: { ...prev.nodesById, [nodeId]: { ...prevNode, frozenOptionIds: carryFrozen.filter((id) => id !== optionId), selectedOptionId: optionId } }
      };
    });

    if (!alreadyExplored) await generateChildrenFor(nodeId, optionId, pathContext);
  }

  async function retryNode(nodeId) {
    if (isLocked || !graph) return;
    const pathContext = ancestorPath(graph, nodeId);
    setGeneratingNodeId(nodeId);
    try {
      const { groups } = await apiFetch('/api/generate-nodes', { method: 'POST', body: JSON.stringify({ pathContext }) });
      const fresh = groups[0];
      if (!fresh) return;

      setGraph((prev) => {
        const prevNode = prev.nodesById[nodeId];
        return {
          ...prev,
          nodesById: {
            ...prev.nodesById,
            [nodeId]: {
              ...prevNode,
              label: fresh.label || prevNode.label,
              options: (fresh.options || []).slice(0, 6).map((text, j) => ({ id: `${nodeId}-opt-${Date.now()}-${j}`, text })),
              selectedOptionId: null,
              frozenOptionIds: [],
              children: {}
            }
          }
        };
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingNodeId(null);
    }
  }

  function randomNode(nodeId) {
    if (isLocked || !graph) return;
    const node = graph.nodesById[nodeId];
    if (!node.options.length) return;
    const pick = node.options[Math.floor(Math.random() * node.options.length)];
    selectOption(nodeId, pick.id);
  }

  function addCustomOption(nodeId, text) {
    if (isLocked || !graph) return;
    setGraph((prev) => {
      const node = prev.nodesById[nodeId];
      if (node.options.length >= 6) return prev;
      const newOpt = { id: `${nodeId}-custom-${Date.now()}`, text };
      return { ...prev, nodesById: { ...prev.nodesById, [nodeId]: { ...node, options: [...node.options, newOpt] } } };
    });
  }

  async function handleGenerateIdeas() {
    if (!graph) return;
    const pathContext = deriveActivePath(graph);
    if (pathContext.length === 0) {
      setError('Pick at least one option on the graph before generating ideas.');
      return;
    }

    setGeneratingIdeas(true);
    setError('');
    try {
      const { ideas: newIdeas } = await apiFetch('/api/generate-ideas', { method: 'POST', body: JSON.stringify({ pathContext }) });
      setIdeas(newIdeas);
      supabase.from('blueprints').update({ ideas: newIdeas }).eq('id', blueprintId);
    } catch (err) {
      setError(err.message || 'Could not generate ideas right now.');
    } finally {
      setGeneratingIdeas(false);
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error && !graph) return <div className="page-loading">{error}</div>;
  if (!graph) return null;

  const activeIds = computeActiveNodeIds(graph);
  const lines = buildLines(graph);

  return (
    <div>
      <NavBar
        right={
          <>
            <span className="muted" style={{ fontSize: 13, marginRight: 8 }}>{blueprint?.title}</span>
            <Link to="/dashboard" className="btn btn-ghost">← Dashboard</Link>
          </>
        }
      />

      <div className="canvas-shell" onMouseDown={handleCanvasMouseDown} onWheel={handleWheel} style={{ height: 'calc(100vh - 65px)' }}>
        {isLocked && (
          <div className="path-banner">This blueprint is read-only. <Link to="/pricing">Upgrade to Pro</Link> to keep building.</div>
        )}
        {error && <div className="path-banner">{error}</div>}

        <div className="canvas-world" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
          <svg className="canvas-lines" width="6000" height="4000">
            {lines.map((line) => (
              <path
                key={line.key}
                d={`M ${line.start.x} ${line.start.y} C ${line.start.x + 80} ${line.start.y}, ${line.end.x - 80} ${line.end.y}, ${line.end.x} ${line.end.y}`}
                className={line.frozen ? 'line-frozen' : 'line-active'}
              />
            ))}
          </svg>

          {Object.values(graph.nodesById).map((node) => (
            <NodeGroup
              key={node.id}
              node={node}
              isFrozen={!activeIds.has(node.id)}
              readOnly={isLocked}
              onSelectOption={selectOption}
              onRetry={retryNode}
              onRandom={randomNode}
              onAddCustom={addCustomOption}
              onHeaderMouseDown={handleHeaderMouseDown}
            />
          ))}
        </div>

        <div className="zoom-controls">
          <button className="icon-btn" onClick={() => zoomBy(-0.15)}>−</button>
          <button className="icon-btn" onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}>⤾</button>
          <button className="icon-btn" onClick={() => zoomBy(0.15)}>+</button>
        </div>

        {!isLocked && (
          <button className="btn btn-primary generate-btn-floating" onClick={handleGenerateIdeas} disabled={generatingIdeas}>
            {generatingIdeas ? 'Researching live…' : '✦ Generate ideas from this path'}
          </button>
        )}

        {generatingNodeId && <div className="generating-toast">Branching…</div>}
      </div>

      {ideas && <IdeaResults ideas={ideas} framework={framework} onClose={() => setIdeas(null)} />}
    </div>
  );
}

// ============================================================
// Pricing page (Selar intentionally not wired up yet)
// ============================================================
function Pricing() {
  const { user } = useAuth();

  return (
    <div>
      <NavBar right={user ? <Link to="/dashboard" className="btn btn-ghost">Dashboard</Link> : <Link to="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="pricing-shell section">
        <div className="section-head" style={{ margin: '0 auto 48px', textAlign: 'center' }}>
          <span className="eyebrow">Pricing</span>
          <h2>Map for free. Pay when you need the whole toolkit.</h2>
        </div>

        <div className="pricing-grid">
          <div className="plan">
            <span className="ptag">Free</span>
            <h3>One blueprint, one week</h3>
            <div className="price">$0</div>
            <ul>
              <li>One full Blueprint Graph</li>
              <li>Seven days of active editing, then read-only</li>
              <li>Live research-backed idea generation</li>
              <li>Basic validation kit per idea</li>
            </ul>
            <Link to={user ? '/dashboard' : '/signup'} className="btn btn-ghost">{user ? 'Go to dashboard' : 'Start free'}</Link>
          </div>

          <div className="plan pro">
            <span className="ptag">Pro</span>
            <h3>For builders who iterate</h3>
            <div className="price">$12<sup>/month</sup></div>
            <ul>
              <li>Unlimited blueprints, no expiry</li>
              <li>Unlimited branching depth</li>
              <li>Full version history (coming soon)</li>
              <li>Real-time collaboration (coming soon)</li>
              <li>Priority support</li>
            </ul>
            <button className="btn btn-primary" disabled title="Pro checkout is being wired up — coming very soon">Go Pro — coming soon</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// App — routing + auth state, wraps every page above
// ============================================================
function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data || null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user || null;
      setUser(sessionUser);
      if (sessionUser) loadProfile(sessionUser.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user || null;
      setUser(sessionUser);
      if (sessionUser) loadProfile(sessionUser.id);
      else setProfile(null);
    });

    return () => listener?.subscription?.unsubscribe();
  }, []);

  const refreshProfile = () => { if (user) loadProfile(user.id); };

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile }}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/signup" element={<Auth mode="signup" />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/blueprint/:id" element={<RequireAuth><BlueprintCanvas /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}

// ============================================================
// Boot: inject CSS, then mount React
// ============================================================
const styleTag = document.createElement('style');
styleTag.textContent = GLOBAL_CSS;
document.head.appendChild(styleTag);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
