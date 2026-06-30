// ---------- feedback.js ----------
// Shared across every ThinkMaps page via one <script> tag — adds a small
// "pop" on click and a soft synthesized click tick, plus a floating mute
// toggle it injects itself. Nothing here touches any existing click
// handler: everything is event delegation on document, layered on top,
// never replacing what's already wired per page.
//
// Background ambiance was removed entirely (used to live here as an
// optional quiet looping pad/track) — this file now only ever produces
// the one transient click sound, never anything continuous or looping.
//
// The click sound is SYNTHESIZED with the Web Audio API, not an audio
// file — there was no real produced audio to ship here, and a couple of
// oscillators are enough for a believable, tactile "tick."

(function(){
  const SOUND_PREF_KEY = 'thinkmaps_sound_enabled_v2';
  const CLICKABLE_SELECTOR = '.btn, .mini-btn, .canvas-option.root-clickable, .opt-dot, [data-action]';

  let audioCtx = null;
  let soundEnabled = readSoundPref();

  function readSoundPref(){
    try {
      const stored = localStorage.getItem(SOUND_PREF_KEY);
      return stored === null ? true : stored === 'true';
    } catch (e) {
      return true; // localStorage can throw in some locked-down/private contexts — default on rather than crash
    }
  }

  function writeSoundPref(value){
    try { localStorage.setItem(SOUND_PREF_KEY, String(value)); } catch (e){ /* non-fatal */ }
  }

  // getAudioContext() alone used to call .resume() without waiting for it
  // to actually resolve, then let callers schedule sound immediately
  // against ctx.currentTime regardless. Confirmed via testing: under a
  // slower resume (which real devices/browsers can genuinely hit, even
  // though fast local testing doesn't naturally surface it), that meant
  // scheduling a sound against a context still reporting 'suspended' and
  // a clock stuck at 0 — which doesn't error, it just silently never
  // produces audible sound. playClickTick goes through this instead,
  // which actually waits for the resume promise to resolve before
  // letting anything get scheduled. Because every click is itself a
  // genuine user gesture, this needs no separate "unlock ahead of time"
  // step the way a background track would have needed — there's no
  // longer one of those anywhere in this file.
  function getAudioContext(){
    if(!audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function ensureAudioContextRunning(callback){
    const ctx = getAudioContext();
    if(!ctx) return;
    if(ctx.state === 'running'){
      callback(ctx);
    } else {
      ctx.resume().then(() => callback(ctx)).catch(() => {});
    }
  }

  // A short, tactile "tick" — not a beep. Two layered oscillators: a
  // quick pitch-dropping sine for the body of the click (the original
  // shape), plus a very brief, much quieter higher-pitched tick layered
  // on top of just the first ~20ms for a sharper, more physical "press"
  // character right at the onset — the difference between a soft blip
  // and something that reads as an actual button click. Both fully
  // decay well under a tenth of a second.
  function playClickTick(){
    if(!soundEnabled) return; // checked here too, not just by callers — this is the one function that actually makes sound, so it's the right place for the final guard
    ensureAudioContextRunning((ctx) => {
      const now = ctx.currentTime;

      // Body: the original soft downward sweep.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(360, now + 0.07);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

      osc.start(now);
      osc.stop(now + 0.09);

      // Onset layer: a brief, quiet higher tick right at the start —
      // sharpens the attack into something more like a physical press
      // without making the overall sound any louder or longer.
      const tickOsc = ctx.createOscillator();
      const tickGain = ctx.createGain();
      tickOsc.connect(tickGain);
      tickGain.connect(ctx.destination);

      tickOsc.type = 'triangle';
      tickOsc.frequency.setValueAtTime(1400, now);

      tickGain.gain.setValueAtTime(0.05, now);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

      tickOsc.start(now);
      tickOsc.stop(now + 0.02);
    });
  }

  function triggerPopEffect(el){
    el.classList.remove('pop-effect'); // restart cleanly if clicked again mid-animation
    // Forces a reflow so re-adding the class on a rapid double-click
    // actually restarts the animation instead of silently no-op'ing.
    void el.offsetWidth;
    el.classList.add('pop-effect');
    el.addEventListener('animationend', () => el.classList.remove('pop-effect'), { once: true });
  }

  function handleDelegatedClick(e){
    const target = e.target.closest(CLICKABLE_SELECTOR);
    if(!target) return;

    triggerPopEffect(target);
    if(soundEnabled) playClickTick();
  }

  function buildToggleButton(){
    const btn = document.createElement('button');
    btn.className = 'sound-toggle-btn' + (soundEnabled ? ' sound-on' : '');
    btn.type = 'button';
    btn.setAttribute('aria-label', soundEnabled ? 'Mute click sound' : 'Unmute click sound');
    btn.textContent = soundEnabled ? '🔊' : '🔈';

    btn.addEventListener('click', () => {
      triggerPopEffect(btn);
      soundEnabled = !soundEnabled;
      writeSoundPref(soundEnabled);
      btn.classList.toggle('sound-on', soundEnabled);
      btn.setAttribute('aria-label', soundEnabled ? 'Mute click sound' : 'Unmute click sound');
      btn.textContent = soundEnabled ? '🔊' : '🔈';

      // This click is itself the user gesture audio needs — play a
      // confirmation tick right away when turning sound back on.
      if(soundEnabled) playClickTick();
    });

    document.body.appendChild(btn);
  }

  // Drag-to-activate (dragging from a selected option's dot onto a
  // target) is how most of the canvas actually gets used, and it never
  // fires a real 'click' event on the target — endLineDrag in script.js
  // detects the drop and calls handleOptionActivate directly. The
  // document-level delegated listener above only ever sees genuine click
  // events, so without this, drag completion would be entirely silent —
  // not a bug exactly, just a gap this fills by exposing the same two
  // effects endLineDrag can call into directly.
  window.ThinkMapsFeedback = {
    pop: triggerPopEffect,
    sound: () => { if(soundEnabled) playClickTick(); }
  };

  function init(){
    document.addEventListener('click', handleDelegatedClick, true);
    buildToggleButton();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
