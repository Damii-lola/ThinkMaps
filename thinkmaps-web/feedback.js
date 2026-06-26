// ---------- feedback.js ----------
// Shared across every ThinkMaps page via one <script> tag — adds a small
// "pop" on click, a soft synthesized click tick, and a very quiet
// optional background ambiance, plus a floating mute toggle it injects
// itself. Nothing here touches any existing click handler: everything is
// event delegation on document, layered on top, never replacing what's
// already wired per page.
//
// Sounds are SYNTHESIZED with the Web Audio API, not audio files — there
// was no real produced audio to ship here, and a few oscillators are
// enough for a believable soft "tick" and a barely-there ambient pad.
// If a real file ever gets added at /bg-ambient.mp3, this automatically
// prefers it over the synthesized pad — see startAmbiance() below.

(function(){
  const SOUND_PREF_KEY = 'thinkmaps_sound_enabled';
  const CLICKABLE_SELECTOR = '.btn, .mini-btn, .canvas-option.root-clickable, .opt-dot, [data-action]';

  let audioCtx = null;
  let ambianceNodes = null;       // { masterGain, oscillators: [...], lfo } once started
  let ambianceAudioEl = null;     // set instead of ambianceNodes if a real file loads
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

  // Created lazily, on the first real user gesture — browsers block audio
  // from starting any earlier than that regardless of what this script
  // wants, so there's no point trying sooner.
  function getAudioContext(){
    if(!audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return null;
      audioCtx = new Ctx();
    }
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // A short, soft downward "tick" — not a beep. Quick pitch drop plus a
  // fast exponential fade is what keeps a synthesized click from sounding
  // like an alarm; the same shape under a hundred different UI sound
  // libraries, just generated here instead of shipped as a file.
  function playClickTick(){
    const ctx = getAudioContext();
    if(!ctx) return;
    const now = ctx.currentTime;

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
  }

  // Tries a real ambient track first (drop one at /bg-ambient.mp3 to
  // upgrade from the synthesized pad below with zero code changes), and
  // only falls back to synthesis if that file doesn't exist or fails to
  // load. Either way this only ever runs from inside the toggle button's
  // own click handler, which is the user gesture that makes starting
  // audio here permitted in the first place.
  function startAmbiance(){
    if(ambianceNodes || ambianceAudioEl) return; // already running, just needs unmuting — see setAmbianceMuted

    const probe = new Audio('/bg-ambient.mp3');
    let usedFallback = false;

    const useFallback = () => {
      if(usedFallback) return;
      usedFallback = true;
      startSynthesizedPad();
    };

    probe.addEventListener('error', useFallback, { once: true });
    probe.addEventListener('canplaythrough', () => {
      if(usedFallback) return; // fallback already kicked in while this was loading
      probe.loop = true;
      probe.volume = 0.18;
      probe.play().catch(useFallback);
      ambianceAudioEl = probe;
    }, { once: true });

    // If the file just doesn't exist, most browsers fire 'error' quickly,
    // but to be safe this doesn't wait forever before falling back.
    setTimeout(() => { if(!ambianceAudioEl && !usedFallback) useFallback(); }, 1500);
  }

  // Two soft sine tones a fifth apart, very quiet, with a slow LFO
  // breathing the volume up and down over roughly a 12-second cycle —
  // deliberately closer to "barely-there room tone" than music, since
  // anything busier than that gets tiring fast on a loop.
  function startSynthesizedPad(){
    const ctx = getAudioContext();
    if(!ctx) return;

    const masterGain = ctx.createGain();
    masterGain.gain.value = soundEnabled ? 1 : 0;
    masterGain.connect(ctx.destination);

    const tone = (freq, gainValue) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = gainValue;
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      return osc;
    };

    const osc1 = tone(220, 0.025);  // A3
    const osc2 = tone(329.63, 0.018); // E4, a fifth above

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1 / 12; // one breath roughly every 12 seconds
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);
    lfo.start();

    ambianceNodes = { masterGain, oscillators: [osc1, osc2, lfo] };
  }

  function setAmbianceMuted(muted){
    if(ambianceAudioEl){
      ambianceAudioEl.volume = muted ? 0 : 0.18;
    }
    if(ambianceNodes){
      const ctx = getAudioContext();
      if(ctx) ambianceNodes.masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.3);
    }
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
    btn.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Unmute sound');
    btn.textContent = soundEnabled ? '🔊' : '🔈';

    btn.addEventListener('click', () => {
      triggerPopEffect(btn);
      soundEnabled = !soundEnabled;
      writeSoundPref(soundEnabled);
      btn.classList.toggle('sound-on', soundEnabled);
      btn.setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Unmute sound');
      btn.textContent = soundEnabled ? '🔊' : '🔈';

      // This click is itself the user gesture audio needs — safe to
      // create the context and kick off ambiance right here.
      getAudioContext();
      if(soundEnabled){
        playClickTick();
        startAmbiance();
        setAmbianceMuted(false);
      } else {
        setAmbianceMuted(true);
      }
    });

    document.body.appendChild(btn);
  }

  function init(){
    document.addEventListener('click', handleDelegatedClick, true);
    buildToggleButton();

    // If sound was already on from a previous visit, the very first
    // qualifying click anywhere on the page doubles as the user gesture
    // that unlocks audio — no need to make people hunt for the toggle
    // just to hear anything.
    document.addEventListener('click', function unlockOnFirstClick(e){
      if(!soundEnabled) return;
      if(!e.target.closest(CLICKABLE_SELECTOR)) return;
      getAudioContext();
      startAmbiance();
      document.removeEventListener('click', unlockOnFirstClick, true);
    }, true);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
