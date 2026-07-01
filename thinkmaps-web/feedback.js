// ---------- feedback.js ----------
// Shared across every ThinkMaps page — adds a small visual "pop" on
// click and a soft synthesized click tick. No UI toggle, no background
// sound, no audio file — just the one transient synthesized click.


(function(){
  const CLICKABLE_SELECTOR = '.btn, .mini-btn, .canvas-option.root-clickable, .opt-dot, [data-action]';

  let audioCtx = null;

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

  function playClickTick(){
    ensureAudioContextRunning((ctx) => {
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
    el.classList.remove('pop-effect');
    void el.offsetWidth;
    el.classList.add('pop-effect');
    el.addEventListener('animationend', () => el.classList.remove('pop-effect'), { once: true });
  }

  function handleDelegatedClick(e){
    const target = e.target.closest(CLICKABLE_SELECTOR);
    if(!target) return;
    triggerPopEffect(target);
    playClickTick();
  }

  window.ThinkMapsFeedback = {
    pop: triggerPopEffect,
    sound: playClickTick
  };

  function init(){
    document.addEventListener('click', handleDelegatedClick, true);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
