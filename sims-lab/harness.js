#!/usr/bin/env node
/**
 * harness.js — Sticky Sims merge gate
 *
 * Runs the whole engine headless (no browser) and asserts the invariants from
 * INTERFACES.md. Exits 0 = PASS (safe to merge), 1 = FAIL (do not merge).
 *
 *   node harness.js            # default 12000 frames (~7 sim-days)
 *   node harness.js 3000       # shorter run
 *
 * No npm. No deps. Same constraint as the game itself.
 *
 * WHY THIS EXISTS
 * Every v1.0 bug was a seam bug that a human "looks fine in the browser" check
 * missed, because the engine swallows per-tick exceptions. This catches all
 * three bug classes mechanically:
 *   CHECK 3 → renderer/tick crashes (Bug 1)
 *   CHECK 4 → AI<->World interaction contract (Bug 2)
 *   CHECK 5/6/7 → action completion + wedged sims (Bug 3)
 */

const fs = require('fs');
const path = require('path');

const FRAMES = parseInt(process.argv[2], 10) || 12000;
const DIR = __dirname;

/* ---------------------------------------------------------------- stubs --- */
const ctx2d = new Proxy({}, {
  get: (t, k) => (k === 'canvas' ? { width: 960, height: 720 } : () => {}),
  set: () => true
});
function el() {
  return {
    style: {}, dataset: {}, children: [], innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    addEventListener(){}, removeEventListener(){}, appendChild(){}, removeChild(){},
    insertBefore(){}, prepend(){}, remove(){}, focus(){}, setAttribute(){},
    getAttribute: () => null, getContext: () => ctx2d,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 720 }),
    querySelector: () => el(), querySelectorAll: () => [],
    width: 960, height: 720
  };
}
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.document = {
  getElementById: () => el(), createElement: () => el(), body: el(), documentElement: el(),
  addEventListener(){}, querySelector: () => el(), querySelectorAll: () => []
};
global.localStorage = {
  _d: {},
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v){ this._d[k] = String(v); },
  removeItem(k){ delete this._d[k]; }
};
global.performance = { now: () => Date.now() };
global.alert = () => {};
global.confirm = () => true;
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => {};

/* --------------------------------------------------- capture engine errors --- */
// The engine catches per-tick exceptions and console.errors them. That is how a
// crash-every-frame bug survived to "done". We count them instead of ignoring them.
const tickErrors = [];
const origErr = console.error;
console.error = (...args) => {
  const msg = args.map(a => (a && a.stack) ? a.stack.split('\n')[0] : String(a)).join(' ');
  tickErrors.push(msg);
};
const origLog = console.log;
console.log = () => {};   // silence module boot chatter

/* ------------------------------------------------------------ load modules --- */
// Load order is READ FROM index.html, never hardcoded.
// Kimi's v1.1 stats fix was written into init.js while index.html loaded init-v2.js —
// the patch was correct and never executed. A hardcoded list here would have hidden that.
// The gate must test exactly what the browser loads. Always.
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const ORDER = [...html.matchAll(/<script\s+src=["']([^"']+\.js)["']/g)].map(m => m[1]);
if (!ORDER.length) { console.error('FATAL: no <script src> found in index.html'); process.exit(1); }
const loadErrors = [];
for (const f of ORDER) {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) { loadErrors.push(`${f}: MISSING`); continue; }
  try { new Function(fs.readFileSync(p, 'utf8'))(); }
  catch (e) { loadErrors.push(`${f}: ${e.message}`); }
}

/* -------------------------------------------------------------- run frames --- */
let started = 0, completed = 0;
const startNeeds = [];
if (global.EVENTS) {
  EVENTS.on('sim.action_start', () => started++);
  EVENTS.on('sim.action_complete', () => completed++);
}
if (global.STATE && STATE.sims) {
  for (const s of STATE.sims) startNeeds.push({ name: s.name, needs: { ...s.needs } });
}

// Sample mid-run so we can prove needs actually RISE, not just end high by luck.
let peakSeen = {};
let framesRun = 0;
const t0 = Date.now();
let t = t0;
for (let i = 0; i < FRAMES; i++) {
  if (!rafCb) break;
  const cb = rafCb; rafCb = null; t += 16;
  try { cb(t); } catch (e) { tickErrors.push('UNCAUGHT: ' + e.message); }
  framesRun++;
  if (global.STATE && STATE.sims && i % 500 === 0) {
    for (const s of STATE.sims) {
      for (const n in s.needs) {
        const k = s.name + '.' + n;
        if (peakSeen[k] === undefined || s.needs[n] > peakSeen[k]) peakSeen[k] = s.needs[n];
      }
    }
  }
}
console.log = origLog;
console.error = origErr;

/* ----------------------------------------------------------------- checks --- */
const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });
const S = global.STATE;

check('C1  all modules load clean (per index.html)', loadErrors.length === 0,
      loadErrors.length ? loadErrors.join(' | ') : `${ORDER.length} modules, per index.html`);

check('C2  globals exported', ['ENGINE','EVENTS','STATE','CONFIG','SIM','WORLD','ECONOMY','SOCIAL','AI','RENDERER','UI','SAVE']
        .every(g => typeof global[g] === 'object' || typeof global[g] === 'function'),
      ['ENGINE','EVENTS','STATE','CONFIG','SIM','WORLD','ECONOMY','SOCIAL','AI','RENDERER','UI','SAVE']
        .filter(g => !global[g]).join(',') || 'all present');

// Bug 1 class — renderer/tick crashes, normally swallowed
check('C3  zero tick errors  [Bug 1 class]', tickErrors.length === 0,
      tickErrors.length ? `${tickErrors.length} errors, first: ${tickErrors[0]}` : `${framesRun} frames clean`);

// Bug 2 class — AI<->World interaction contract (INTERFACES.md §6)
let usableActions = -1, interactionsSeen = 0;
if (S && S.sims && S.sims[0] && global.WORLD) {
  const sim = S.sims[0];
  const objs = WORLD.getUsableObjects(sim) || [];
  let ok = 0;
  for (const o of objs) {
    const inters = WORLD.getInteractions(sim, o.id) || [];
    interactionsSeen += inters.length;
    for (const it of inters) {
      const key = (it && it.key) ? it.key : it;      // §6: getInteractions returns OBJECTS
      if (typeof key !== 'string') continue;
      if (WORLD.canUse(sim, o.id, key)) ok++;
    }
  }
  usableActions = ok;
}
check('C4  WORLD supplies usable interactions', usableActions > 0,
      `${usableActions} usable of ${interactionsSeen} interactions`);

// C4b is the REAL Bug 2 detector: it tests whether AI can actually CONSUME what
// WORLD supplies. In broken v1.0, WORLD supplied 44 usable interactions and AI
// scored exactly 0 of them, because it read {key,label,action} objects as strings.
// Testing supply alone would have passed the broken build. Test the seam, not the side.
let aiScored = -1;
if (S && S.sims && S.sims[0] && global.AI && AI.scoreAllActions) {
  try { aiScored = (AI.scoreAllActions(S.sims[0]) || []).length; }
  catch (e) { aiScored = -1; }
}
check('C4b AI can consume them  [Bug 2 class]', aiScored > 0,
      aiScored === 0
        ? `AI scored 0 of ${usableActions} usable  <-- AI<->World contract broken (§6)`
        : `AI scored ${aiScored} candidate actions`);

// Bug 3 class — actions must complete
check('C5  actions started  [Bug 3 class]', started > 0, `${started} started`);
check('C6  actions complete  [Bug 3 class]', started > 0 && completed >= started * 0.9,
      `${completed} completed of ${started} started` +
      (started > 0 && completed === 0 ? '  <-- started but NEVER complete' : ''));

// No sim wedged: INTERFACES.md §5 "nobody may leave a sim in working with no exit"
let wedged = [];
if (S && S.sims) {
  for (const s of S.sims) {
    if (s.state === 'working' && s.timer > 600) wedged.push(`${s.name}(${s.task}, timer=${Math.round(s.timer)}m)`);
  }
}
check('C7  no sim wedged in an action  [Bug 3 class]', wedged.length === 0,
      wedged.length ? wedged.join(', ') : 'all sims cycling');

// Needs must actually be RESTORED, not merely decay slowly
let restored = 0, tracked = 0;
for (const k in peakSeen) { tracked++; if (peakSeen[k] > 85) restored++; }
check('C8  needs actually restore', tracked > 0 && restored > tracked * 0.4,
      `${restored}/${tracked} need-tracks peaked >85`);

// §5 contract: state==="working" implies an exit path exists
let badState = [];
if (S && S.sims) {
  for (const s of S.sims) {
    if (s.state === 'working' && !s.currentAction && !s.job) {
      badState.push(`${s.name} working with no currentAction and no job`);
    }
  }
}
check('C9  working-state discriminator holds (§5)', badState.length === 0,
      badState.length ? badState.join(', ') : 'currentAction/job present where working');

// §2 contract: sims live in PIXELS, must stay on the canvas
let offCanvas = [];
if (S && S.sims && global.CONFIG) {
  for (const s of S.sims) {
    if (s.x < -50 || s.y < -50 || s.x > CONFIG.CANVAS_W + 50 || s.y > CONFIG.CANVAS_H + 50) {
      offCanvas.push(`${s.name}(${Math.round(s.x)},${Math.round(s.y)})`);
    }
  }
}
check('C10 sims on-canvas — px/cell mixups (§2)', offCanvas.length === 0,
      offCanvas.length ? offCanvas.join(', ') + '  <-- likely grid-cells used as pixels' : 'all within bounds');

/* ------------------------------------------------------------- soft checks --- */
// Not merge blockers, but the sprint's open items. Reported, not enforced.
const soft = [];
const statsSum = S && S.stats ? Object.values(S.stats).reduce((a, b) => a + (b || 0), 0) : 0;
soft.push({ name: 'S4  stats counters populated', pass: statsSum > 0,
            detail: S && S.stats ? JSON.stringify(S.stats) : 'no stats' });
soft.push({ name: 'S11 notifications surface', pass: !!(S && S.notifications && S.notifications.length),
            detail: `${S && S.notifications ? S.notifications.length : 0} notifications` });
const minRaw = S && S.time ? S.time.minute : 0;
soft.push({ name: 'S8  clock free of float drift', pass: Number.isInteger(minRaw),
            detail: `time.minute = ${minRaw}` });

/* ---------------------------------------------------------------- report --- */
const failed = checks.filter(c => !c.pass);
const W = 42;
const line = '─'.repeat(72);
console.log('\n' + line);
console.log(`STICKY SIMS — MERGE GATE   (${framesRun} frames | ${((Date.now()-t0)/1000).toFixed(1)}s)`);
if (S && S.time) console.log(`sim reached: day ${S.time.day}, ${String(Math.floor(S.time.hour)).padStart(2,'0')}:${String(Math.floor(S.time.minute)).padStart(2,'0')}`);
console.log(line);
for (const c of checks) {
  console.log(`${c.pass ? ' PASS ' : ' FAIL '} ${c.name.padEnd(W)} ${c.detail}`);
}
console.log(line);
console.log('OPEN SPRINT ITEMS (not merge blockers)');
for (const s of soft) {
  console.log(`${s.pass ? ' done ' : ' open '} ${s.name.padEnd(W)} ${s.detail}`);
}
console.log(line);

if (failed.length) {
  console.log(`\n❌ GATE FAILED — ${failed.length} check(s). DO NOT MERGE.\n`);
  for (const f of failed) console.log(`   • ${f.name.trim()} → ${f.detail}`);
  if (tickErrors.length) {
    const uniq = [...new Set(tickErrors)].slice(0, 3);
    console.log(`\n   first distinct tick errors:`);
    for (const e of uniq) console.log(`     ${e}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('\n✅ GATE PASSED — safe to merge.\n');
  process.exit(0);
}
