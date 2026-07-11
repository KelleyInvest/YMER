/* ════════════════════════════════════════════════════════════════
   pitch/shim.js — presentation glue for the EMBEDDED game copy.
   Injected by pitch/build.js after the game's own modules.

   Uses only the public, INTERFACES.md-frozen APIs (RENDERER, SIM,
   UI, ENGINE, STATE). The verified modules are not modified.

   Does four things:
   1. Kiosk mode toggle (pitch hook slide) via postMessage.
   2. Canvas click → sim selection. ui.js v1.1 wires clicks to a
      canvas with id "game-canvas", which the shipped index.html
      does not have (its canvas id is "game") — so in a browser,
      click-to-select silently never attaches. This re-wires it
      through the public API, with correct scaling math.
   3. Forwards slide-navigation keys the game does not use up to
      the parent pitch.
   4. Streams read-only live telemetry (sim clock, action count,
      error count) to the pitch chrome. Nothing is invented.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var KIOSK = 'pitch-kiosk';

  // 1 ── kiosk + speed control from the parent pitch
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'kiosk') document.body.classList.toggle(KIOSK, !!d.on);
    if (d.type === 'speed' && window.ENGINE && ENGINE.setSpeed) ENGINE.setSpeed(d.idx);
  });

  // 2 ── canvas click → select sim (public API only)
  var cv = document.getElementById('game');
  if (cv) {
    cv.addEventListener('click', function (e) {
      try {
        var rect = cv.getBoundingClientRect();
        var sx = (e.clientX - rect.left) * (cv.width / rect.width);
        var sy = (e.clientY - rect.top) * (cv.height / rect.height);
        var w = (window.RENDERER && RENDERER.screenToWorld) ? RENDERER.screenToWorld(sx, sy) : { x: sx, y: sy };
        var sim = (window.SIM && SIM.getSimAt) ? SIM.getSimAt(w.x, w.y, 30) : null;
        if (sim && window.UI && UI.selectSim) UI.selectSim(sim.id);
      } catch (err) { /* selection is best-effort; never break the game */ }
    });
  }

  // 3 ── forward nav keys the game does not use
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(e.key) >= 0 ||
        e.key === 'd' || e.key === 'D' || e.key === 'g' || e.key === 'G') {
      try { parent.postMessage({ type: 'nav', key: e.key }, '*'); } catch (err) {}
    }
  });

  // 4 ── live telemetry (read-only)
  var errs = 0;
  window.addEventListener('error', function () { errs++; });
  setInterval(function () {
    try {
      var s = window.STATE;
      if (!s || !s.time) return;
      var completed = s.stats ? ((s.stats.resultsProduced || 0) + (s.stats.mealsCooked || 0)) : null;
      parent.postMessage({
        type: 'telemetry',
        sims: (s.sims || []).length,
        day: s.time.day,
        hour: s.time.hour,
        minute: s.time.minute,
        actions: completed,
        errs: errs,
        paused: !!s.paused
      }, '*');
    } catch (err) {}
  }, 500);
})();
