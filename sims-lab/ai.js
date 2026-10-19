/**
 * ai.js — Autonomy AI Module
 * Makes sims decide what to do based on needs, traits, time of day, and social context.
 * Uses utility-based scoring to rank all possible actions.
 *
 * Created by the AI module. Exposes window.AI.
 */
(function() {
  "use strict";

  /* ================================================================
     Local references to globals (populated by engine.js / other modules)
     ================================================================ */
  let _ENGINE, _STATE, _CONFIG, _EVENTS, _SIM, _WORLD, _SOCIAL, _ECONOMY;

  /* ================================================================
     Constants
     ================================================================ */

  /**
   * GOALS — Defines the high-level autonomous goal types.
   * Each entry has: priority (higher = more urgent), condition(), findTarget().
   */
  const GOALS = {
    satisfy_need: {
      priority: 10,
      description: "Satisfy the most critical need",
      condition: function(sim) {
        const urgent = _SIM.getUrgentNeed(sim);
        return urgent !== null && sim.needs[urgent] < 40;
      },
      findTarget: function(sim) {
        const urgentNeed = _SIM.getUrgentNeed(sim);
        if (!urgentNeed) return null;
        // Find the best object+action combo that satisfies this need
        const best = _getBestActionForNeed(sim, urgentNeed);
        return best || null;
      }
    },

    go_to_work: {
      priority: 9,
      description: "Go to work during work hours",
      condition: function(sim) {
        return sim.job && _ECONOMY.shouldGoToWork(sim);
      },
      findTarget: function(sim) {
        // Work is a "virtual" target — the sim exits the lot
        return { type: "work", sim: sim };
      }
    },

    repair: {
      priority: 8,
      description: "Repair broken objects",
      condition: function(sim) {
        return _findBrokenObject(sim) !== null;
      },
      findTarget: function(sim) {
        const obj = _findBrokenObject(sim);
        if (!obj) return null;
        return { type: "repair", objectId: obj.id };
      }
    },

    socialize: {
      priority: 7,
      description: "Socialize with other sims",
      condition: function(sim) {
        return _AI.shouldSocialize(sim);
      },
      findTarget: function(sim) {
        const target = _AI.pickSocialTarget(sim);
        if (!target) return null;
        return { type: "socialize", targetSim: target };
      }
    },

    skill_build: {
      priority: 5,
      description: "Build skills through practice",
      condition: function(sim) {
        return _shouldBuildSkills(sim);
      },
      findTarget: function(sim) {
        const best = _getBestSkillAction(sim);
        return best || null;
      }
    },

    relax: {
      priority: 4,
      description: "Relax and have fun",
      condition: function(sim) {
        return sim.needs.fun < 50 || sim.needs.comfort < 40;
      },
      findTarget: function(sim) {
        const best = _getBestRelaxAction(sim);
        return best || null;
      }
    }
  };

  /**
   * Emergency priority order — which critical need to handle first.
   * Bladder is most urgent (emergency at 80%), followed by hunger, energy, hygiene, social.
   */
  const EMERGENCY_ORDER = ["bladder", "hunger", "energy", "hygiene", "social"];

  /**
   * Time-of-day action preference weights.
   * These modify action scores based on the current hour.
   */
  const TIME_PREFERENCES = {
    // Morning (6-9): hygiene, breakfast, work prep
    morning: { start: 6, end: 9,
      boosts: {
        "take_shower": 15, "quick_rinse": 10, "wash_hands": 5,
        "brush_teeth": 10, "quick_meal": 15, "cook_meal": 10,
        "cook": 10, "eat": 10
      },
      penalties: {
        "sleep": -40, "nap": -20
      }
    },
    // Day (9-17): work, skill building
    day: { start: 9, end: 17,
      boosts: {
        "program": 5, "study": 5, "practice": 5, "practice_chess": 5,
        "practice_speech": 5, "cook": 5, "write": 5
      },
      penalties: {
        "sleep": -50, "nap": -30
      }
    },
    // Evening (17-21): social, fun, dinner
    evening: { start: 17, end: 21,
      boosts: {
        "watch": 10, "watch_tv": 10, "watch_movie": 15,
        "play_games": 10, "group_meal": 15, "perform": 10,
        "cook_meal": 10, "gourmet": 8
      },
      penalties: {
        "sleep": -30, "program": -5
      }
    },
    // Night (21-6): sleep
    night: { start: 21, end: 6,
      boosts: {
        "sleep": 30, "nap": 10, "browse": 5
      },
      penalties: {
        "jog": -15, "run": -20, "take_shower": -5
      }
    }
  };

  /**
   * Need-to-category mapping — which object category helps which need.
   */
  const NEED_CATEGORIES = {
    hunger:     ["hunger"],
    energy:     ["sleep"],
    bladder:    ["bladder"],
    hygiene:    ["hygiene"],
    social:     ["social", "comfort"],
    fun:        ["fun", "athletic"],
    comfort:    ["comfort", "social"],
    environment:["environment"]
  };

  /**
   * Skill-to-activity mapping — which actions build which skills.
   */
  const SKILL_ACTIONS = {
    logic:      ["program", "study", "practice_chess"],
    creativity: ["practice", "perform", "write"],
    athletic:   ["jog", "run"],
    charisma:   ["practice_speech"],
    cooking:    ["cook", "cook_meal", "quick_meal", "gourmet", "bake"],
    handiness:  [],
    gardening:  ["water", "gardening"]
  };

  /* ================================================================
     Internal helpers
     ================================================================ */

  /**
   * Cache module references from globals.
   */
  function _resolveGlobals() {
    _ENGINE  = window.ENGINE;
    _STATE   = window.STATE;
    _CONFIG  = window.CONFIG;
    _EVENTS  = window.EVENTS;
    _SIM     = window.SIM;
    _WORLD   = window.WORLD;
    _SOCIAL  = window.SOCIAL;
    _ECONOMY = window.ECONOMY;
  }

  /**
   * Ensure globals are resolved before any operation.
   */
  function _ensureGlobals() {
    if (!_STATE) _resolveGlobals();
  }

  /**
   * Get the current hour from STATE.
   */
  function _getHour() {
    return _STATE ? _STATE.time.hour : 12;
  }

  /**
   * Get the current day of week (0=Mon ... 6=Sun).
   */
  function _getDayOfWeek() {
    return _STATE ? _STATE.time.dayOfWeek : 1;
  }

  /**
   * Check if today is a weekend day.
   */
  function _isWeekend() {
    const dow = _getDayOfWeek();
    return dow === 5 || dow === 6; // Saturday or Sunday
  }

  /**
   * Get the active time-of-day period key.
   */
  function _getTimePeriod() {
    const h = _getHour();
    if (h >= 6  && h < 9)  return "morning";
    if (h >= 9  && h < 17) return "day";
    if (h >= 17 && h < 21) return "evening";
    return "night"; // 21-6
  }

  /**
   * Compute distance between sim and an object instance (in pixels).
   */
  function _distToObject(sim, objectId) {
    if (!_WORLD) return 9999;
    const obj = _WORLD.getObject(objectId);
    if (!obj) return 9999;
    const objPixelX = obj.x * _CONFIG.GRID_SIZE;
    const objPixelY = obj.y * _CONFIG.GRID_SIZE;
    return Math.hypot(sim.x - objPixelX, sim.y - objPixelY);
  }

  /**
   * Get the interaction definition for a given object + action key.
   */
  function _getActionDef(objectId, actionKey) {
    if (!_WORLD) return null;
    const obj = _WORLD.getObject(objectId);
    if (!obj) return null;
    // Access catalog via the catalogKey on the object instance
    const catalog = _WORLD.OBJECT_CATALOG || {};
    const catalogEntry = catalog[obj.catalogKey];
    if (!catalogEntry || !catalogEntry.interactions) return null;
    return catalogEntry.interactions[actionKey] || null;
  }

  /**
   * Check if an action satisfies a specific need.
   */
  function _actionSatisfiesNeed(actionDef, needKey) {
    if (!actionDef || !actionDef.needs) return false;
    return actionDef.needs[needKey] !== undefined && actionDef.needs[needKey] > 0;
  }

  /**
   * Find the best action for a specific need.
   */
  function _getBestActionForNeed(sim, needKey) {
    const objects = _WORLD ? _WORLD.getUsableObjects(sim) : [];
    let best = null;
    let bestScore = -Infinity;

    for (const obj of objects) {
      const interactions = _WORLD.getInteractions(sim, obj.id);
      for (const inter of interactions) {
        const actionKey = inter.key;
        const actionDef = _getActionDef(obj.id, actionKey);
        if (!actionDef) continue;
        if (!_actionSatisfiesNeed(actionDef, needKey)) continue;
        if (!_WORLD.canUse(sim, obj.id, actionKey)) continue;

        const score = _scoreAction(sim, obj.id, actionKey);
        if (score > bestScore) {
          bestScore = score;
          best = { objectId: obj.id, actionKey: actionKey, score: score };
        }
      }
    }
    return best;
  }

  /**
   * Find a broken object that needs repair.
   */
  function _findBrokenObject(sim) {
    if (!_WORLD || !_STATE || !_STATE.lot) return null;
    const floors = _STATE.lot.floors || [];
    for (const floor of floors) {
      const objects = floor.objects || [];
      for (const obj of objects) {
        if (obj.broken) return obj;
      }
    }
    return null;
  }

  /**
   * Check if sim should prioritize skill building.
   */
  function _shouldBuildSkills(sim) {
    // Don't skill-build if critical needs exist
    if (_AI.isInEmergency(sim)) return false;
    // Don't skill-build on weekends during fun hours
    if (_isWeekend() && _getTimePeriod() === "evening") return false;
    // Night owls skill-build at night
    if (sim.traits.includes("night_owl") && _getTimePeriod() === "night") return true;
    // Morning people skill-build in the morning after hygiene/food
    if (sim.traits.includes("morning_person") && _getTimePeriod() === "morning") {
      if (sim.needs.hygiene > 60 && sim.needs.hunger > 60) return true;
    }
    // Generally skill-build during day if needs are okay
    if (_getTimePeriod() === "day" && sim.needs.fun > 30 && sim.needs.energy > 30) return true;
    return false;
  }

  /**
   * Get the best skill-building action.
   */
  function _getBestSkillAction(sim) {
    const objects = _WORLD ? _WORLD.getUsableObjects(sim) : [];
    let best = null;
    let bestScore = -Infinity;

    for (const obj of objects) {
      const interactions = _WORLD.getInteractions(sim, obj.id);
      for (const inter of interactions) {
        const actionKey = inter.key;
        const actionDef = _getActionDef(obj.id, actionKey);
        if (!actionDef) continue;
        if (!actionDef.skill) continue; // Must be a skill-building action
        if (!_WORLD.canUse(sim, obj.id, actionKey)) continue;

        const score = _scoreAction(sim, obj.id, actionKey);
        if (score > bestScore) {
          bestScore = score;
          best = { objectId: obj.id, actionKey: actionKey, score: score };
        }
      }
    }
    return best;
  }

  /**
   * Get the best relaxation/fun action.
   */
  function _getBestRelaxAction(sim) {
    const objects = _WORLD ? _WORLD.getUsableObjects(sim) : [];
    let best = null;
    let bestScore = -Infinity;

    for (const obj of objects) {
      const interactions = _WORLD.getInteractions(sim, obj.id);
      for (const inter of interactions) {
        const actionKey = inter.key;
        const actionDef = _getActionDef(obj.id, actionKey);
        if (!actionDef) continue;
        // Must provide fun or comfort
        if (!actionDef.needs || (!actionDef.needs.fun && !actionDef.needs.comfort)) continue;
        if (!_WORLD.canUse(sim, obj.id, actionKey)) continue;

        const score = _scoreAction(sim, obj.id, actionKey);
        if (score > bestScore) {
          bestScore = score;
          best = { objectId: obj.id, actionKey: actionKey, score: score };
        }
      }
    }
    return best;
  }

  /* ================================================================
     Scoring — The Heart of the AI
     ================================================================ */

  /**
   * Score a single action for a sim.
   * Higher score = more desirable action.
   *
   * @param {Object} sim       — the sim considering the action
   * @param {number} objectId  — instance ID of the target object
   * @param {string} actionKey — interaction key (e.g. "sleep", "quick_meal")
   * @returns {number} composite score
   */
  function _scoreAction(sim, objectId, actionKey) {
    _ensureGlobals();
    if (!_WORLD) return -9999;

    const obj = _WORLD.getObject(objectId);
    if (!obj) return -9999;

    const catalog = _WORLD.OBJECT_CATALOG || {};
    const catalogEntry = catalog[obj.catalogKey];
    if (!catalogEntry) return -9999;

    const actionDef = catalogEntry.interactions ? catalogEntry.interactions[actionKey] : null;
    if (!actionDef) return -9999;

    let score = 0;
    const hour = _getHour();
    const timePeriod = _getTimePeriod();

    // ---- 1. Need Satisfaction (primary driver) ----
    if (actionDef.needs) {
      for (const [needKey, value] of Object.entries(actionDef.needs)) {
        if (value <= 0) continue;
        const current = sim.needs[needKey] || 0;
        const deficit = 100 - current;
        // The lower the need, the more valuable the satisfaction
        const needWeight = (deficit / 100);        // 0..1, higher = more desperate
        const satisfactionValue = value;            // how much this action provides
        score += needWeight * satisfactionValue * 3;

        // Emergency bonus: if need is critical, this action gets huge priority
        if (_SIM) {
          const needDef = _getNeedDef(needKey);
          if (needDef && current < needDef.critical) {
            score += 50; // Critical need emergency boost
          }
        }
      }
    }

    // ---- 2. Drain penalty (actions that drain other needs) ----
    if (actionDef.drains) {
      for (const [drainNeed, drainAmount] of Object.entries(actionDef.drains)) {
        const current = sim.needs[drainNeed] || 0;
        // Penalize more if the drained need is already low
        const drainRisk = Math.max(0, 1 - (current / 100));
        score -= drainAmount * drainRisk * 0.5;
      }
    }

    // ---- 3. Distance penalty (closer = better) ----
    const dist = _distToObject(sim, objectId);
    score -= dist * 0.03;
    // Extra penalty for very far objects
    if (dist > 400) score -= 15;
    if (dist > 600) score -= 25;

    // ---- 4. Object condition bonus / penalty ----
    if (obj.condition !== undefined) {
      if (obj.condition < 30) score -= 20;       // Very broken, avoid
      else if (obj.condition < 50) score -= 10;  // Somewhat broken
      else if (obj.condition > 90) score += 8;   // Pristine, nice bonus
      else if (obj.condition > 75) score += 3;   // Good condition
    }
    if (obj.broken) score -= 100; // Never choose broken objects

    // ---- 5. In-use penalty ----
    if (obj.inUse) {
      // Single-use objects that are occupied
      score -= 30;
    }
    // Multi-capacity: less penalty if there's room
    if (catalogEntry.capacity && catalogEntry.capacity > 1) {
      const occupants = obj.occupants ? obj.occupants.length : 0;
      if (occupants >= catalogEntry.capacity) {
        score -= 100; // Full, can't use
      } else if (occupants > 0) {
        score += 5; // Slight bonus: social opportunity with other sim there
      }
    }

    // ---- 6. Trait modifiers ----
    if (sim.traits) {
      // Neat sims love cleaning
      if (sim.traits.includes("neat")) {
        if (actionKey === "clean" || actionKey === "make_bed" || actionKey === "empty") {
          score += 20;
        }
        if (actionDef.needs && actionDef.needs.hygiene) {
          score += 5; // Value hygiene actions more
        }
      }
      // Slob sims don't care about hygiene
      if (sim.traits.includes("slob")) {
        if (actionDef.needs && actionDef.needs.hygiene) {
          score -= 5; // Less interested in hygiene
        }
      }
      // Lazy sims avoid high-energy actions
      if (sim.traits.includes("lazy")) {
        if (actionDef.drains && actionDef.drains.energy) {
          score -= 15;
        }
        if (actionKey === "run" || actionKey === "jog") {
          score -= 20;
        }
        if (actionKey === "nap" || actionKey === "sit" || actionKey === "sleep") {
          score += 10;
        }
      }
      // Active sims like exercise
      if (sim.traits.includes("active")) {
        if (actionKey === "run" || actionKey === "jog") {
          score += 15;
        }
        if (actionDef.drains && actionDef.drains.energy) {
          score += 5; // Don't mind tiring activities
        }
      }
      // Glutton loves food
      if (sim.traits.includes("glutton")) {
        if (actionDef.needs && actionDef.needs.hunger && actionDef.needs.hunger > 30) {
          score += 10;
        }
        if (actionKey === "gourmet") {
          score += 15;
        }
      }
      // Outgoing sims love social
      if (sim.traits.includes("outgoing")) {
        if (actionDef.needs && actionDef.needs.social) {
          score += 10;
        }
        if (actionKey === "group_meal" || actionKey === "play_with") {
          score += 15;
        }
      }
      // Loner avoids social
      if (sim.traits.includes("loner")) {
        if (actionDef.needs && actionDef.needs.social) {
          score -= 10;
        }
        if (actionKey === "group_meal" || actionKey === "play_with") {
          score -= 15;
        }
        if (actionKey === "talk_to" || actionKey === "perform") {
          score -= 10;
        }
      }
      // Genius likes logic
      if (sim.traits.includes("genius")) {
        if (actionDef.skill === "logic") score += 10;
        if (actionKey === "program" || actionKey === "study") score += 8;
      }
      // Creative likes creativity
      if (sim.traits.includes("creative")) {
        if (actionDef.skill === "creativity") score += 10;
        if (actionKey === "practice" || actionKey === "write") score += 8;
      }
      // Athletic likes exercise
      if (sim.traits.includes("athletic")) {
        if (actionDef.skill === "athletic") score += 10;
        if (actionKey === "run" || actionKey === "jog") score += 8;
      }
      // Charmer likes social skill
      if (sim.traits.includes("charmer")) {
        if (actionDef.skill === "charisma") score += 10;
        if (actionKey === "practice_speech") score += 8;
      }
      // Night owl
      if (sim.traits.includes("night_owl")) {
        if (hour >= 22 || hour <= 5) {
          if (actionKey === "program" || actionKey === "browse" || actionKey === "play_games") {
            score += 12;
          }
          if (actionKey === "sleep") score -= 15;
        }
      }
      // Morning person
      if (sim.traits.includes("morning_person")) {
        if (hour >= 6 && hour <= 11) {
          if (actionKey === "take_shower" || actionKey === "quick_meal" || actionKey === "cook_meal") {
            score += 8;
          }
        }
      }
      // Lucky sims slightly boost all scores (they find good actions)
      if (sim.traits.includes("lucky")) {
        score += 3;
      }
      // Unlucky sims slightly reduce all scores
      if (sim.traits.includes("unlucky")) {
        score -= 2;
      }
    }

    // ---- 7. Time of day modifiers ----
    const tp = TIME_PREFERENCES[timePeriod];
    if (tp) {
      if (tp.boosts && tp.boosts[actionKey]) {
        score += tp.boosts[actionKey];
      }
      if (tp.penalties && tp.penalties[actionKey]) {
        score += tp.penalties[actionKey]; // already negative
      }
    }

    // Sleep-specific time logic
    if (actionKey === "sleep") {
      if (hour >= 22 || hour <= 5) {
        score += 25; // Strongly prefer sleep at night
      } else if (hour >= 8 && hour <= 20) {
        score -= 35; // Strongly avoid sleep during the day
      }
      // Extra bonus if energy is very low
      if (sim.needs.energy < 20) score += 20;
    }
    if (actionKey === "nap") {
      if (hour >= 13 && hour <= 16 && sim.needs.energy < 40) {
        score += 10; // Good time for a nap
      }
    }

    // ---- 8. Skill growth bonus ----
    if (actionDef.skill) {
      const simSkill = sim.skills[actionDef.skill] || 0;
      // Higher bonus for skills the sim is trying to build (below level 5)
      if (simSkill < 5) {
        score += 8;
      } else if (simSkill < 8) {
        score += 4;
      }
      // Even higher if the career uses this skill
      if (sim.job && sim.job.career) {
        const careers = _ECONOMY ? _ECONOMY.CAREERS : {};
        const career = careers[sim.job.career];
        if (career && career.skill === actionDef.skill) {
          score += 10; // Work-relevant skill
        }
      }
    }

    // ---- 9. Cost penalty ----
    if (actionDef.cost) {
      score -= actionDef.cost * 0.15;
      // Extra penalty if low on household funds
      if (_STATE && _STATE.funds < 500) {
        score -= actionDef.cost * 0.3;
      }
    }

    // ---- 10. Weekend modifiers ----
    if (_isWeekend()) {
      // More social/fun on weekends
      if (actionDef.needs && (actionDef.needs.fun || actionDef.needs.social)) {
        score += 8;
      }
      // Less work-related on weekends
      if (actionDef.skill && !actionDef.needs.fun && !actionDef.needs.social) {
        score -= 5;
      }
    }

    // ---- 11. Duration consideration ----
    if (actionDef.duration > 0) {
      // Long actions are riskier if needs are critical
      const criticalCount = _SIM ? _SIM.getCriticalNeeds(sim).length : 0;
      if (criticalCount > 0) {
        score -= actionDef.duration * 0.02; // Penalize long actions during emergencies
      }
    }

    // ---- 12. Repairs bonus for neat sims ----
    if (actionDef.repairs && actionDef.repairs > 0) {
      if (sim.traits && sim.traits.includes("neat")) {
        score += 15;
      }
    }

    // ---- 13. Mood influence ----
    if (sim.mood) {
      switch (sim.mood) {
        case "elated":
          // Happy sims prefer fun/social
          if (actionDef.needs && (actionDef.needs.fun || actionDef.needs.social)) score += 5;
          break;
        case "miserable":
          // Miserable sims just want basic needs met
          if (actionDef.needs && (actionDef.needs.hunger || actionDef.needs.energy || actionDef.needs.bladder)) {
            score += 5;
          }
          break;
      }
    }

    return score;
  }

  /**
   * Get the need definition from SIM's NEEDS table.
   */
  function _getNeedDef(needKey) {
    if (!_SIM || !_SIM.NEEDS) return null;
    return _SIM.NEEDS[needKey] || null;
  }

  /* ================================================================
     Public API — The AI module
     ================================================================ */

  const _AI = {

    /* ---- Initialization ---- */

    /**
     * Initialize the AI module. Called once by ENGINE.init().
     */
    init: function() {
      _resolveGlobals();

      // Subscribe to events
      if (_EVENTS) {
        _EVENTS.on("tick", function(data) {
          _AI.processAllSims(data.delta);
        });

        _EVENTS.on("time.hour", function(data) {
          // Reset any time-based AI state if needed
        });

        _EVENTS.on("sim.needs_critical", function(data) {
          // A sim's need went critical — the processSim loop will handle it
        });
      }
    },

    /* ---- Main Processing Loop ---- */

    /**
     * Process ALL sims each tick.
     */
    processAllSims: function(delta) {
      _ensureGlobals();
      if (!_STATE || !_STATE.sims) return;
      _STATE.sims.forEach(function(sim) {
        _AI.processSim(sim, delta);
      });
    },

    /**
     * Main AI tick for a single sim.
     * If autonomy is true and sim is not player-controlled, decide next action.
     */
    processSim: function(sim, delta) {
      _ensureGlobals();
      if (!sim) return;
      if (!sim.autonomy) return;           // Autonomy disabled
      if (_AI.isPlayerControlled(sim)) return; // Player is controlling
      if (sim.state === "walking" && sim.path && sim.path.length > 0) {
        // Sim is already walking to a destination — continue following path
        _AI.followPath(sim, sim.path, delta);
        return;
      }
      if (sim.state === "working" || sim.state === "sleeping" || sim.state === "eating" || sim.state === "talking") {
        // Sim is busy with an action — wait for it to complete
        return;
      }
      if (sim.queue && sim.queue.length > 0) {
        // Sim has queued actions — process the next one
        const next = sim.queue[0];
        if (next && next.targetX !== undefined && next.targetY !== undefined) {
          // Need to walk to the target
          const path = _AI.findPathTo(sim, next.targetX, next.targetY);
          if (path && path.length > 0) {
            sim.path = path;
            sim.state = "walking";
            sim.task = "Walking to " + (next.actionKey || "target");
          } else {
            // Can't path there — remove from queue
            sim.queue.shift();
          }
        }
        return;
      }

      // Sim is idle and has no queue — decide what to do
      _AI.decideNextAction(sim);
    },

    /* ---- Decision Making ---- */

    /**
     * The big decision function:
     * 1. Check for emergencies
     * 2. Check if should go to work
     * 3. Otherwise score all actions and pick the best
     */
    decideNextAction: function(sim) {
      _ensureGlobals();

      // 1. Emergency check
      if (_AI.isInEmergency(sim)) {
        _AI.handleEmergency(sim);
        return;
      }

      // 2. Work check
      if (sim.job && _AI.shouldGoToWork(sim)) {
        _AI.handleWork(sim);
        return;
      }

      // 3. Goal-based check
      const activeGoal = _AI.getCurrentGoal(sim);
      if (activeGoal && GOALS[activeGoal.type]) {
        const goalDef = GOALS[activeGoal.type];
        if (goalDef.condition && goalDef.condition(sim)) {
          const target = goalDef.findTarget(sim);
          if (target && target.objectId && target.actionKey) {
            _AI._enqueueAction(sim, target.objectId, target.actionKey);
            return;
          }
        } else {
          // Goal condition no longer met — clear it
          _AI.clearGoal(sim);
        }
      }

      // 4. General decision: score all possible actions and pick best
      const bestAction = _AI.getBestAction(sim);
      if (bestAction) {
        _AI._enqueueAction(sim, bestAction.objectId, bestAction.actionKey);

        if (_EVENTS) {
          _EVENTS.emit("ai.decided", {
            sim: sim,
            objectId: bestAction.objectId,
            actionKey: bestAction.actionKey,
            score: bestAction.score
          });
        }
      } else {
        // No valid action found — sim will remain idle
        sim.state = "idle";
        sim.task = "Idle";
      }
    },

    /**
     * Score ALL possible actions (every object x every valid interaction).
     * Returns a sorted array of { objectId, actionKey, score } descending.
     */
    scoreAllActions: function(sim) {
      _ensureGlobals();
      const results = [];
      if (!_WORLD) return results;

      const objects = _WORLD.getUsableObjects(sim);

      for (const obj of objects) {
        const interactions = _WORLD.getInteractions(sim, obj.id);
        for (const inter of interactions) {
          const actionKey = inter.key;
          // Skip if sim can't use this interaction
          if (!_WORLD.canUse(sim, obj.id, actionKey)) continue;

          const score = _scoreAction(sim, obj.id, actionKey);
          results.push({
            objectId: obj.id,
            actionKey: actionKey,
            score: score
          });
        }
      }

      // Sort by score descending
      results.sort(function(a, b) { return b.score - a.score; });
      return results;
    },

    /**
     * Get the single best valid action for a sim.
     * Returns { objectId, actionKey, score } or null.
     */
    getBestAction: function(sim) {
      const scored = _AI.scoreAllActions(sim);
      if (scored.length === 0) return null;

      // If the best action is too poor (negative score), consider socializing
      if (scored[0].score < 0 && _AI.shouldSocialize(sim)) {
        const socialTarget = _AI.pickSocialTarget(sim);
        if (socialTarget) {
          // Find a social object to use together
          const objects = _WORLD ? _WORLD.getUsableObjects(sim) : [];
          for (const obj of objects) {
            const interactions = _WORLD.getInteractions(sim, obj.id);
            for (const inter of interactions) {
              const ak = inter.key;
              const ad = _getActionDef(obj.id, ak);
              if (ad && ad.needs && ad.needs.social && ad.needs.social > 0) {
                if (_WORLD.canUse(sim, obj.id, ak)) {
                  return { objectId: obj.id, actionKey: ak, score: 30 };
                }
              }
            }
          }
        }
      }

      return scored[0];
    },

    /**
     * Internal: enqueue an action and compute path.
     */
    _enqueueAction: function(sim, objectId, actionKey) {
      if (!_WORLD) return;
      const obj = _WORLD.getObject(objectId);
      if (!obj) return;

      const targetX = obj.x * _CONFIG.GRID_SIZE;
      const targetY = obj.y * _CONFIG.GRID_SIZE;

      sim.queue.push({
        objectId: objectId,
        actionKey: actionKey,
        targetX: targetX,
        targetY: targetY
      });

      // Find path and start walking
      const path = _AI.findPathTo(sim, targetX, targetY);
      if (path && path.length > 0) {
        sim.path = path;
        sim.state = "walking";
        sim.task = "Walking";
      }

      if (_EVENTS) {
        _EVENTS.emit("ai.enqueued", {
          sim: sim,
          objectId: objectId,
          actionKey: actionKey
        });
      }
    },

    /* ---- Goal System ---- */

    /**
     * Set an explicit goal for a sim.
     */
    setGoal: function(sim, goalType, params) {
      if (!sim) return;
      if (!GOALS[goalType]) return;
      sim.currentGoal = {
        type: goalType,
        params: params || {},
        setAt: _STATE ? _STATE.time.totalTicks : 0
      };

      if (_EVENTS) {
        _EVENTS.emit("ai.goal_set", { sim: sim, goalType: goalType });
      }
    },

    /**
     * Clear the sim's current goal.
     */
    clearGoal: function(sim) {
      if (!sim) return;
      const oldGoal = sim.currentGoal;
      sim.currentGoal = null;

      if (oldGoal && _EVENTS) {
        _EVENTS.emit("ai.goal_cleared", { sim: sim, oldGoal: oldGoal });
      }
    },

    /**
     * Get the sim's current goal.
     */
    getCurrentGoal: function(sim) {
      if (!sim) return null;
      return sim.currentGoal || null;
    },

    /* ---- Pathfinding ---- */

    /**
     * Find a path from the sim's current position to a target.
     * Wrapper around WORLD.findPath.
     */
    findPathTo: function(sim, targetX, targetY) {
      _ensureGlobals();
      if (!_WORLD || !_WORLD.findPath) return [];
      return _WORLD.findPath(sim.x, sim.y, targetX, targetY);
    },

    /**
     * Move the sim along a path.
     * Updates sim position each frame based on delta.
     */
    followPath: function(sim, path, delta) {
      if (!path || path.length === 0) {
        sim.state = "idle";
        sim.path = null;
        return;
      }

      const speed = _CONFIG ? (_CONFIG.SIM_SPEEDS[_CONFIG.DEFAULT_SPEED] * 60) : 120;
      const moveAmount = speed * delta;

      // Get next waypoint
      const next = path[0];
      const dx = next.x - sim.x;
      const dy = next.y - sim.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= moveAmount) {
        // Reached this waypoint
        sim.x = next.x;
        sim.y = next.y;
        path.shift();

        if (path.length === 0) {
          // Reached destination
          sim.state = "idle";
          sim.path = null;
          sim.task = "Idle";

          // Process any queued action
          if (sim.queue && sim.queue.length > 0) {
            const action = sim.queue.shift();
            if (action && _WORLD) {
              _WORLD.startInteraction(sim, action.objectId, action.actionKey);
            }
          }

          if (_EVENTS) {
            _EVENTS.emit("ai.path_complete", { sim: sim });
          }
        }
      } else {
        // Move toward next waypoint
        const nx = dx / dist;
        const ny = dy / dist;
        sim.x += nx * moveAmount;
        sim.y += ny * moveAmount;

        // Update facing direction
        sim.facing = (nx >= 0) ? "right" : "left";
      }
    },

    /* ---- Emergency Handling ---- */

    /**
     * Check if the sim is in an emergency state (any critical need).
     */
    isInEmergency: function(sim) {
      if (!_SIM) return false;
      const criticalNeeds = _SIM.getCriticalNeeds(sim);
      return criticalNeeds.length > 0;
    },

    /**
     * Handle a sim's emergency — respond to the most critical need immediately.
     * Emergency priorities: bladder > hunger > energy > hygiene > social
     */
    handleEmergency: function(sim) {
      _ensureGlobals();
      if (!_SIM) return;

      const criticalNeeds = _SIM.getCriticalNeeds(sim);
      if (criticalNeeds.length === 0) return;

      // Sort by EMERGENCY_ORDER priority
      criticalNeeds.sort(function(a, b) {
        const idxA = EMERGENCY_ORDER.indexOf(a);
        const idxB = EMERGENCY_ORDER.indexOf(b);
        return idxA - idxB;
      });

      const mostUrgent = criticalNeeds[0];

      // Find best action to satisfy this need
      const best = _getBestActionForNeed(sim, mostUrgent);
      if (best) {
        _AI._enqueueAction(sim, best.objectId, best.actionKey);

        // Set emergency goal
        _AI.setGoal(sim, "satisfy_need", { need: mostUrgent });

        if (_EVENTS) {
          _EVENTS.emit("ai.emergency_handled", {
            sim: sim,
            need: mostUrgent,
            objectId: best.objectId,
            actionKey: best.actionKey
          });
        }
      } else {
        // No valid action found for emergency — sim panics
        sim.state = "panicking";
        sim.task = "Panicking!";

        if (_EVENTS) {
          _EVENTS.emit("ai.emergency_failed", {
            sim: sim,
            need: mostUrgent
          });
        }
      }
    },

    /* ---- Social AI ---- */

    /**
     * Decide if a sim wants to socialize.
     */
    shouldSocialize: function(sim) {
      if (!sim || !sim.needs) return false;

      // Check social need
      const socialNeed = sim.needs.social || 0;
      if (socialNeed < 30) return true;
      if (socialNeed < 50 && _getTimePeriod() === "evening") return true;

      // Outgoing sims want to socialize more
      if (sim.traits && sim.traits.includes("outgoing")) {
        if (socialNeed < 70) return true;
      }

      // Loner sims rarely want to socialize
      if (sim.traits && sim.traits.includes("loner")) {
        if (socialNeed < 15) return true;
        return false;
      }

      // Evening is social time
      if (_getTimePeriod() === "evening" && socialNeed < 60) return true;

      // Weekend social boost
      if (_isWeekend() && socialNeed < 50) return true;

      return false;
    },

    /**
     * Pick the best sim to socialize with.
     * Based on proximity + social need + relationship level.
     */
    pickSocialTarget: function(sim) {
      _ensureGlobals();
      if (!_STATE || !_STATE.sims) return null;

      const otherSims = _STATE.sims.filter(function(s) {
        return s.id !== sim.id && s.lifeStage !== "baby" && s.lifeStage !== "toddler";
      });

      if (otherSims.length === 0) return null;

      let bestTarget = null;
      let bestScore = -Infinity;

      for (const other of otherSims) {
        let score = 0;

        // Proximity (closer = better)
        const dist = Math.hypot(sim.x - other.x, sim.y - other.y);
        score -= dist * 0.05;

        // Relationship level
        if (_SOCIAL) {
          const rel = _SOCIAL.getRelationship(sim, other);
          if (rel) {
            score += rel.friendship * 0.3;
            // Prefer friends over strangers
            if (rel.friendship > 20) score += 10;
            if (rel.friendship > 50) score += 15;
          }
        }

        // Other sim's mood (happy sims are better conversation partners)
        if (other.mood === "elated" || other.mood === "happy") {
          score += 5;
        } else if (other.mood === "miserable") {
          score -= 5;
        }

        // Trait compatibility
        if (sim.traits && other.traits) {
          // Outgoing sims prefer other outgoing sims
          if (sim.traits.includes("outgoing") && other.traits.includes("outgoing")) {
            score += 8;
          }
          // Active sims prefer athletic sims
          if (sim.traits.includes("active") && other.traits.includes("athletic")) {
            score += 5;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestTarget = other;
        }
      }

      return bestTarget;
    },

    /**
     * Pick the best conversation topic for two sims based on relationship.
     */
    pickConversationTopic: function(simA, simB) {
      if (!_SOCIAL) return "friendly";

      const rel = _SOCIAL.getRelationship(simA, simB);
      const topics = _SOCIAL.getConversationTopics(simA, simB);

      if (!topics || topics.length === 0) return "friendly";

      const friendship = rel ? rel.friendship : 0;
      const romance = rel ? rel.romance : 0;

      // Topic selection based on relationship level
      if (romance > 30 && topics.includes("flirt")) {
        return "flirt";
      }
      if (friendship > 50 && topics.includes("deep_talk")) {
        return "deep_talk";
      }
      if (friendship > 20 && topics.includes("compliment")) {
        return "compliment";
      }
      if (friendship > 10 && topics.includes("funny")) {
        return "funny";
      }
      if (topics.includes("gossip")) {
        return "gossip";
      }

      return "friendly";
    },

    /* ---- Work AI ---- */

    /**
     * Check if it's time for the sim to go to work.
     */
    shouldGoToWork: function(sim) {
      _ensureGlobals();
      if (!sim || !sim.job) return false;
      if (!_ECONOMY) return false;

      // Don't go to work if in emergency
      if (_AI.isInEmergency(sim)) return false;

      // Don't go to work on weekends (unless career works weekends)
      const workStatus = _ECONOMY.getWorkStatus(sim);
      if (workStatus === "weekend") return false;
      if (workStatus === "off") return false;

      // Check work hours
      return _ECONOMY.shouldGoToWork(sim);
    },

    /**
     * Handle work-related behavior for a sim.
     */
    handleWork: function(sim) {
      _ensureGlobals();
      if (!sim || !sim.job) return;

      // Mark sim as going to work
      sim.state = "working";
      sim.task = "At Work";

      // Process the work shift
      if (_ECONOMY) {
        _ECONOMY.workShift(sim);
      }

      if (_EVENTS) {
        _EVENTS.emit("ai.work_started", { sim: sim });
      }
    },

    /* ---- Player Control ---- */

    /**
     * Toggle player control over a sim.
     * When player-controlled, autonomy is disabled.
     */
    setPlayerControl: function(sim, enabled) {
      if (!sim) return;
      if (enabled) {
        sim.autonomy = false;
        sim._playerControlled = true;
      } else {
        sim.autonomy = true;
        sim._playerControlled = false;
      }

      if (_EVENTS) {
        _EVENTS.emit("ai.player_control", { sim: sim, enabled: enabled });
      }
    },

    /**
     * Check if a sim is currently player-controlled.
     */
    isPlayerControlled: function(sim) {
      if (!sim) return false;
      return sim._playerControlled === true;
    },

    /* ---- Autonomous Behavior Patterns ----
       These provide time-of-day guidance but don't override emergencies.
     ---- */

    /**
     * Get the recommended activity type for the current time of day.
     * Used to bias action scoring.
     */
    getTimeOfDayActivity: function() {
      const period = _getTimePeriod();
      switch (period) {
        case "morning":  return { primary: "hygiene", secondary: "hunger" };
        case "day":      return { primary: "skill",   secondary: "work" };
        case "evening":  return { primary: "social",  secondary: "fun" };
        case "night":    return { primary: "sleep",   secondary: "relax" };
        default:         return { primary: "relax",   secondary: "fun" };
      }
    },

    /**
     * Get the recommended activity type for weekends.
     */
    getWeekendActivity: function() {
      const period = _getTimePeriod();
      switch (period) {
        case "morning":  return { primary: "hygiene", secondary: "fun" };
        case "day":      return { primary: "social",  secondary: "fun" };
        case "evening":  return { primary: "social",  secondary: "fun" };
        case "night":    return { primary: "sleep",   secondary: "relax" };
        default:         return { primary: "fun",     secondary: "social" };
      }
    },

    /* ---- Debug / Introspection ---- */

    /**
     * Get a debug dump of what the AI is thinking for a sim.
     */
    debugSim: function(sim) {
      _ensureGlobals();
      const scored = _AI.scoreAllActions(sim);
      const top5 = scored.slice(0, 5);

      return {
        simName: sim.name,
        autonomy: sim.autonomy,
        playerControlled: _AI.isPlayerControlled(sim),
        mood: sim.mood,
        currentGoal: sim.currentGoal,
        inEmergency: _AI.isInEmergency(sim),
        shouldSocialize: _AI.shouldSocialize(sim),
        shouldGoToWork: _AI.shouldGoToWork(sim),
        timePeriod: _getTimePeriod(),
        isWeekend: _isWeekend(),
        topActions: top5.map(function(a) {
          return {
            objectId: a.objectId,
            actionKey: a.actionKey,
            score: Math.round(a.score * 100) / 100
          };
        })
      };
    }
  };

  /* ================================================================
     Expose on window
     ================================================================ */
  window.AI = _AI;

})();
