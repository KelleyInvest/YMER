# INTERFACES.md — Sticky Sims Cross-Module Contract

**Status:** FROZEN as of v1.1 sprint, Sat 11 Jul 2026
**Owner:** Claude (integration). Module agents consume this; they do not change it.
**Rule:** If you need to change a contract in this file, you stop and raise it. You do not change it in your module and hope. **Every v1.0 bug was caused by exactly that.**

---

## 0. Why this file exists

Three bugs shipped in v1.0. None were logic errors inside a module. All three were **seams**:

| Bug | What actually happened |
|-----|------------------------|
| AI ↔ World | `WORLD.getInteractions()` returned **objects**; `ai.js` read them as **strings**. Every `canUse()` looked up `interactions["[object Object]"]` → false. 44 interactions available, 0 usable. Sims stood still for days. |
| Action completion | `startInteraction()` set a timer but never recorded *which* action was running, so `endInteraction(sim, objectId, actionKey)` was uncallable. SIM, AI, and WORLD each assumed another owned completion. Nobody did. |
| Renderer | `def` referenced across a function boundary it wasn't passed into. Crashed every frame containing a sofa. |

Each agent honored its own spec. The specs didn't agree with each other. **This file is the agreement.**

---

## 1. Load order (index.html) — do not reorder

```
engine.js  → CONFIG, STATE, EVENTS, ENGINE
sim.js     → SIM
world.js   → WORLD
economy.js → ECONOMY
social.js  → SOCIAL
ai.js      → AI
renderer.js→ RENDERER
ui.js      → UI
save.js    → SAVE
init.js    → bootstraps
```

Modules are IIFEs exposing one global each. **No module imports another.** All coupling is via `EVENTS` and the shared `STATE`.

---

## 2. ⚠️ Coordinate systems — THE NEXT BUG LIVES HERE

Two systems coexist. Mixing them silently produces sims walking to the wrong place.

| Entity | Field | Unit |
|--------|-------|------|
| Sim | `sim.x`, `sim.y`, `targetX`, `targetY` | **PIXELS** |
| Object | `obj.x`, `obj.y` | **GRID CELLS** |
| Lot / rooms / walls | all | **GRID CELLS** |
| `WORLD.findPath(fromX, fromY, toX, toY)` | args | **PIXELS in**, converts internally |

**Conversion:** `pixels = cells * CONFIG.GRID_SIZE` (GRID_SIZE = 40).

Any time you hand an object's position to something that moves a sim, you must convert. See `AI._enqueueAction()` for the correct pattern:
```js
const targetX = obj.x * CONFIG.GRID_SIZE;   // cells → pixels
```

**Rule: never pass a raw `obj.x` into a sim position field.**

---

## 3. Time & units — THE OTHER PLACE BUGS LIVE

| Thing | Unit |
|-------|------|
| `action.duration` (object catalog) | **GAME MINUTES** (sleep = 480 = 8h) |
| `sim.timer` | **GAME MINUTES** remaining |
| `tick` event `delta` | **REAL MILLISECONDS** |
| `tick` event `gameMinutes` | **GAME MINUTES** elapsed this tick |
| `STATE.time.totalTicks` | integer frame count — **the only trustworthy clock** |

`gameMinutes = (SIM_SPEEDS[speed] * deltaMs) / 60`

**Countdowns of `duration`/`timer` MUST use `gameMinutes`, never `delta`.** Mixing them makes an 8-hour sleep take 8 real minutes or 8 real hours depending on which you grabbed.

> Known defect (S8): `STATE.time.minute` accumulates float error (`15:59.99999999999374`). Derive display time from `totalTicks`, don't trust `.minute` for equality checks.

---

## 4. State ownership — who writes what

`STATE` is shared, but each field has exactly one writer. **Read anything; write only your own.**

| STATE field | Sole writer | Everyone else |
|-------------|-------------|---------------|
| `time.*`, `paused`, `speed`, `totalTicks` | ENGINE | read-only |
| `sims[]`, and each sim's `needs`, `mood`, `skills`, `state`, `task`, `timer`, `currentAction` | **SIM** | read-only* |
| `lot`, objects, rooms, walls, floors | WORLD | read-only |
| `funds`, `bills`, `inventory` | ECONOMY | read-only |
| relationships | SOCIAL | read-only |
| `sims[].queue`, `sims[].path`, goals | AI | read-only |
| `selectedSim`, `selectedTool`, `mode`, `camera`, `zoom`, `notifications` | UI | read-only |
| `stats.*` | *currently NOBODY — see S4* | — |

\* **Exception, and it is deliberate:** `WORLD.startInteraction()` / `endInteraction()` write `sim.state`, `sim.task`, `sim.timer`, `sim.currentAction`, and call `SIM.modifyNeed()`. This is the one sanctioned cross-writer. It exists because WORLD owns the *effects* of an interaction. **Do not add a second exception.**

> `STATE.stats` counters (`mealsCooked`, `conversations`, `fights`, `romances`, `resultsProduced`) are all still 0 after 7 sim-days because **no module writes them**. Ownership assigned in S4: the module that emits the event increments the counter.

---

## 5. The Sim entity — canonical shape

```js
{
  id: 1,
  name: "Mira",
  gender: "f",
  age: 24,
  lifeStage: "adult",

  x: 480, y: 360,              // PIXELS
  targetX: 480, targetY: 360,  // PIXELS
  facing: "right",             // "left" | "right"

  needs: {                     // all 0–100, 100 = fully satisfied
    hunger, energy, bladder, hygiene,
    social, fun, comfort, environment
  },

  traits: [],
  mood: "fine",
  moodScore: 50,

  state: "idle",               // see state machine below
  task: "Idle",                // human-readable label for UI
  timer: 0,                    // GAME MINUTES remaining on current action
  currentAction: null,         // { objectId, actionKey } while working; else null
  queue: [],                   // [{ objectId, actionKey, targetX, targetY }] — PIXELS
  path: null,                  // [{x, y}] waypoints in PIXELS, or null

  skills: { logic, creativity, athletic, charisma, cooking, handiness, gardening },
  autonomy: true               // false = player-controlled, AI skips this sim
}
```

### Sim state machine — who may set what

| `state` | Set by | Cleared by | Notes |
|---------|--------|-----------|-------|
| `"idle"` | anyone finishing | — | AI will pick a new action |
| `"walking"` | AI | AI (`followPath` on arrival) | `path` must be non-empty |
| `"working"` | **WORLD.startInteraction** (object) or **AI.handleWork** (job) | **SIM.updateAction** | *see below* |
| `"talking"` | SOCIAL | SOCIAL (`endConversation`) | self-managing |
| `"sleeping"` / `"eating"` | *reserved, unused* | — | `startInteraction` uses `"working"` for all object actions |

**`"working"` has two distinct meanings — this ambiguity caused Bug 3. Disambiguate with `currentAction`:**
- `state==="working" && currentAction !== null` → using an object. `SIM.updateAction()` counts `timer` down, then calls `WORLD.endInteraction()`.
- `state==="working" && currentAction === null` → at their job. `SIM.updateAction()` ticks `ECONOMY.workShift()` and releases them when `shouldGoToWork()` goes false.

**Nobody may leave a sim in `"working"` with no exit path.** That is the definition of Bug 3.

---

## 6. WORLD — exact return shapes (the Bug 2 contract)

```js
WORLD.getUsableObjects(sim)         → [ objectEntity, ... ]

WORLD.getInteractions(sim, objectId)
  → [ { key: "cook_meal",                    // ← THE STRING KEY IS .key
        label: "Cook Meal",
        action: { duration, needs, cost, skill, xp, ... } },
      ... ]
```

### 🚨 `getInteractions()` returns OBJECTS, NOT STRINGS.

This single fact caused Bug 2. Consuming it:

```js
// ✅ CORRECT
for (const inter of WORLD.getInteractions(sim, obj.id)) {
  const actionKey = inter.key;
  if (!WORLD.canUse(sim, obj.id, actionKey)) continue;
}

// ❌ WRONG — this is the shipped v1.0 bug
for (const actionKey of WORLD.getInteractions(sim, obj.id)) {
  WORLD.canUse(sim, obj.id, actionKey);   // passes an OBJECT → always false
}
```

Note `getInteractions()` **already filters by `canUse()` internally**, so re-checking is belt-and-braces, not required.

### Interaction lifecycle — both halves are mandatory

```js
WORLD.startInteraction(sim, objectId, actionKey) → bool
  // deducts action.cost from STATE.funds
  // marks obj.inUse / occupants
  // sets sim.state="working", sim.task=label,
  //      sim.timer=action.duration (GAME MINUTES),
  //      sim.currentAction={objectId, actionKey}   ← required for the end call
  // emits "sim.action_start", "object.interact"

WORLD.endInteraction(sim, objectId, actionKey) → void
  // applies action.needs (gains) and action.drains (costs) via SIM.modifyNeed
  // grants action.skill XP
  // releases obj.inUse / occupants
  // sets sim.state="idle", task="Idle", timer=0, currentAction=null
  // emits "sim.action_complete"
```

**`endInteraction` is called by `SIM.updateAction()` and nobody else.** If you start an interaction, SIM will end it. Do not end it yourself.

### Object entity
```js
{ id, catalogKey, x, y,        // x/y in GRID CELLS
  rotation, condition,         // condition 0–100; <30 can break
  inUse, usedBy, occupants: [simId, ...] }
```

---

## 7. AI

```js
AI.scoreAllActions(sim) → [ { objectId, actionKey, score }, ... ]  // sorted desc
AI.getBestAction(sim)   → { objectId, actionKey, score } | null
AI._enqueueAction(sim, objectId, actionKey)   // converts cells→pixels for you
```

**AI decides. AI does not execute.** AI pushes to `sim.queue` and sets `sim.path`. The transition from queue → running action happens in `AI.followPath()` on arrival, which calls `WORLD.startInteraction()`. AI never applies needs, never grants XP, never touches `funds`.

`AI.processSim()` early-returns on any sim whose `state` is `"working" | "sleeping" | "eating" | "talking"`. **This is why an unreleased state is fatal** — AI will never look at that sim again.

---

## 8. Event bus

```js
EVENTS.on(name, fn)   EVENTS.once(name, fn)   EVENTS.off(name, fn)   EVENTS.emit(name, payload)
```

### Core payloads (the ones you'll actually use)
| Event | Payload |
|-------|---------|
| `tick` | `{ delta, gameMinutes }` — ms and game-minutes |
| `time.hour` / `time.day` / `time.season` | `{ hour }` / `{ day }` / `{ season }` |
| `sim.action_start` | `{ sim, action, target }` |
| `sim.action_complete` | `{ sim, action, target }` |
| `sim.needs_critical` | `{ sim, need }` |
| `sim.work_end` | `{ sim }` |
| `funds.change` | `{ old, new, reason }` |
| `object.broken` / `object.repaired` | `{ object }` |
| `conversation.start` / `conversation.end` | `{ simA, simB, ... }` |
| `notification` | `{ text, type }` |

### Dead seams (fix or delete in this sprint)
- **`camera.pan` has a listener but is never emitted.** Either wire it or delete the listener.
- ~20 events are emitted with **zero subscribers** (`ai.decided`, `object.created`, `relationship.change`, …). Harmless, but don't assume emitting one *does* anything.

---

## 9. Rules for module agents

1. **Read this file before writing a line.** If your module needs a shape that isn't here, it doesn't exist — raise it.
2. **Never change a contract to suit your module.** Raise it with the integration owner.
3. **Write only the STATE you own** (§4). One sanctioned exception exists; there will not be a second.
4. **Every state you set, you must be able to exit.** No sim gets wedged.
5. **Never mix pixels and cells** (§2), or `delta` and `gameMinutes` (§3).
6. **Green harness or it doesn't merge.** The harness asserts: 0 tick errors, actions started ≈ actions completed, needs actually restore, no sim wedged >1 sim-day.
7. **"No console errors" is not proof of correctness** while the engine catches per-tick exceptions. It swallowed a crash-every-frame bug all the way to "done."

---

## 10. Verified baseline (what "working" currently means)

As of this freeze, headless over 12,000 frames / 7 sim-days:

```
actions STARTED:   795
actions COMPLETED: 793     ← the two in flight at cutoff
tick errors:       0
sims wedged:       none
needs:             restore correctly (hunger 84–100, energy 78–98)
stats counters:    ALL ZERO  ← S4, nobody writes them
notifications:     EMPTY     ← S11, nothing surfaces to the player
```

Any change that regresses the first four numbers does not merge.
