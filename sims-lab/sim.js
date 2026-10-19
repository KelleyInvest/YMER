/**
 * sim.js — Sim System
 * Entity management for stick-figure Sims: needs, traits, moods, skills, life stages, queues.
 * Exposes window.SIM
 */
(function() {
  "use strict";

  // ========================================================================
  // CONSTANTS
  // ========================================================================

  const NEEDS = {
    hunger:      { label: "Hunger",      decay: 0.12, critical: 25, deathAt: 0,  color: "#f5a623" },
    energy:      { label: "Energy",      decay: 0.08, critical: 15,               color: "#4ade80" },
    bladder:     { label: "Bladder",     decay: 0.15, critical: 20, emergency: 80, color: "#3dd6d0" },
    hygiene:     { label: "Hygiene",     decay: 0.06, critical: 20,               color: "#60a5fa" },
    social:      { label: "Social",      decay: 0.07, critical: 20,               color: "#e879f9" },
    fun:         { label: "Fun",         decay: 0.09, critical: 20,               color: "#f472b6" },
    comfort:     { label: "Comfort",     decay: 0.04, critical: 20,               color: "#a78bfa" },
    environment: { label: "Environment", decay: 0.03, critical: 20,               color: "#34d399" }
  };

  const TRAITS = {
    active:          { name: "Active",          needs: { energy: { decay: 0.12 } }, desc: "Decays energy faster" },
    lazy:            { name: "Lazy",            needs: { energy: { decay: 0.05 } }, desc: "Decays energy slower" },
    glutton:         { name: "Glutton",         needs: { hunger: { decay: 0.16 } }, desc: "Gets hungry faster" },
    neat:            { name: "Neat",            needs: { hygiene: { decay: 0.09 } }, desc: "Needs hygiene more" },
    slob:            { name: "Slob",            needs: { hygiene: { decay: 0.03 } }, desc: "Doesn't care about hygiene" },
    outgoing:        { name: "Outgoing",        needs: { social: { decay: 0.11 } }, desc: "Needs people more" },
    loner:           { name: "Loner",           needs: { social: { decay: 0.04 } }, desc: "Happy alone" },
    genius:          { name: "Genius",          skills: { logic: 1.3 }, desc: "Learns logic faster" },
    creative:        { name: "Creative",        skills: { creativity: 1.3 }, desc: "More creative" },
    athletic:        { name: "Athletic",        skills: { athletic: 1.3 }, desc: "More athletic" },
    charmer:         { name: "Charmer",         skills: { charisma: 1.3 }, desc: "Better at social" },
    brave:           { name: "Brave",           desc: "Handles emergencies better" },
    coward:          { name: "Coward",          desc: "Panics in emergencies" },
    lucky:           { name: "Lucky",           desc: "Good things happen more" },
    unlucky:         { name: "Unlucky",         desc: "Bad things happen more" },
    night_owl:       { name: "Night Owl",       desc: "Energy decays slower at night" },
    morning_person:  { name: "Morning Person",  desc: "Energy decays slower in morning" }
  };

  const MOODS = {
    elated:         { threshold: 85, color: "#fbbf24", desc: "Feeling amazing" },
    happy:          { threshold: 60, color: "#4ade80", desc: "Feeling good" },
    fine:           { threshold: 40, color: "#94a3b8", desc: "Doing okay" },
    uncomfortable:  { threshold: 20, color: "#f5a623", desc: "Not feeling great" },
    miserable:      { threshold: 0,  color: "#f2555a", desc: "Feeling terrible" }
  };

  const SKILLS = {
    logic:      { label: "Logic",      max: 10, activities: ["chess", "telescope", "computer_programming"] },
    creativity: { label: "Creativity", max: 10, activities: ["painting", "guitar", "writing"] },
    athletic:   { label: "Athletic",   max: 10, activities: ["treadmill", "swimming", "basketball"] },
    charisma:   { label: "Charisma",   max: 10, activities: ["mirror", "socializing", "speech"] },
    cooking:    { label: "Cooking",    max: 10, activities: ["cooking", "recipe_book"] },
    handiness:  { label: "Handiness",  max: 10, activities: ["repairing", "woodworking"] },
    gardening:  { label: "Gardening",  max: 10, activities: ["gardening", "fishing"] }
  };

  const LIFE_STAGES = {
    baby:        { minAge: 0,   maxAge: 2,   playable: false },
    toddler:     { minAge: 3,   maxAge: 6,   playable: false },
    child:       { minAge: 7,   maxAge: 12,  playable: true },
    teen:        { minAge: 13,  maxAge: 17,  playable: true },
    young_adult: { minAge: 18,  maxAge: 35,  playable: true },
    adult:       { minAge: 36,  maxAge: 60,  playable: true },
    elder:       { minAge: 61,  maxAge: 100, playable: true }
  };

  // Internal ID counter
  let nextSimId = 0;

  // ========================================================================
  // HELPERS
  // ========================================================================

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function getTraitDecayMod(sim, needKey) {
    let mod = 1.0;
    for (const traitKey of sim.traits) {
      const trait = TRAITS[traitKey];
      if (trait && trait.needs && trait.needs[needKey]) {
        mod = trait.needs[needKey].decay / NEEDS[needKey].decay;
      }
    }
    return mod;
  }

  function getSkillMultiplier(sim, skillKey) {
    let mult = 1.0;
    for (const traitKey of sim.traits) {
      const trait = TRAITS[traitKey];
      if (trait && trait.skills && trait.skills[skillKey]) {
        mult = trait.skills[skillKey];
      }
    }
    return mult;
  }

  // ========================================================================
  // CREATION
  // ========================================================================

  function createSim(config) {
    config = config || {};
    const age = config.age !== undefined ? config.age : 25;
    const stage = getLifeStage(age);

    const sim = {
      id: nextSimId++,
      name: config.name || "Sim " + nextSimId,
      gender: config.gender || "f",
      age: age,
      lifeStage: stage,

      // Position
      x: config.x !== undefined ? config.x : (CONFIG ? CONFIG.CANVAS_W / 2 : 480),
      y: config.y !== undefined ? config.y : (CONFIG ? CONFIG.CANVAS_H / 2 : 360),
      targetX: config.x !== undefined ? config.x : (CONFIG ? CONFIG.CANVAS_W / 2 : 480),
      targetY: config.y !== undefined ? config.y : (CONFIG ? CONFIG.CANVAS_H / 2 : 360),
      facing: "right",

      // Needs (0-100)
      needs: {
        hunger: 80, energy: 80, bladder: 80, hygiene: 80,
        social: 80, fun: 80, comfort: 80, environment: 80
      },

      // Traits
      traits: config.traits || [],

      // Mood
      mood: "fine",
      moodScore: 50,

      // State
      state: "idle",
      task: "Idle",
      timer: 0,
      queue: [],

      // Skills (0-10)
      skills: {
        logic: 0, creativity: 0, athletic: 0, charisma: 0,
        cooking: 0, handiness: 0, gardening: 0
      },

      // Autonomy
      autonomy: true,
      currentGoal: null,

      // Appearance
      bodyColor: config.bodyColor || "#e6edf5",
      hairColor: config.hairColor || "#d4a574",
      height: 1.0,

      // Animation
      animFrame: 0,
      animTimer: 0,

      // Status effects
      effects: [],

      // Job
      job: null,

      // Inventory
      heldObject: null,

      // Path (runtime, used by AI)
      path: null,
      pathIndex: 0
    };

    // Apply initial skill levels if provided
    if (config.skills) {
      for (const sk of Object.keys(config.skills)) {
        if (sim.skills.hasOwnProperty(sk)) {
          sim.skills[sk] = clamp(config.skills[sk], 0, 10);
        }
      }
    }

    return sim;
  }

  function addSim(sim) {
    if (!STATE) return;
    STATE.sims.push(sim);
    if (EVENTS) EVENTS.emit("sim.added", { sim: sim });
  }

  function removeSim(id) {
    if (!STATE) return;
    const idx = STATE.sims.findIndex(function(s) { return s.id === id; });
    if (idx !== -1) {
      const sim = STATE.sims[idx];
      STATE.sims.splice(idx, 1);
      if (STATE.selectedSim === id) STATE.selectedSim = null;
      if (EVENTS) EVENTS.emit("sim.removed", { sim: sim });
    }
  }

  // ========================================================================
  // NEEDS
  // ========================================================================

  function decayNeeds(sim, delta) {
    if (!sim || !sim.needs) return;
    const dt = delta / 1000; // convert ms to seconds
    const hour = STATE && STATE.time ? STATE.time.hour : 12;

    for (const key of Object.keys(NEEDS)) {
      const def = NEEDS[key];
      let decay = def.decay;

      // Apply trait modifiers
      const traitMod = getTraitDecayMod(sim, key);
      decay *= traitMod;

      // Special: night_owl / morning_person affect energy
      if (key === "energy") {
        if (sim.traits.includes("night_owl") && (hour >= 22 || hour <= 6)) {
          decay *= 0.5;
        }
        if (sim.traits.includes("morning_person") && hour >= 6 && hour <= 12) {
          decay *= 0.5;
        }
      }

      sim.needs[key] = clamp(sim.needs[key] - decay * dt, 0, 100);

      // Critical check
      if (sim.needs[key] <= def.critical) {
        if (EVENTS) EVENTS.emit("sim.needs_critical", { sim: sim, need: key });
      }

      // Death check
      if (def.deathAt !== undefined && sim.needs[key] <= def.deathAt) {
        if (EVENTS) EVENTS.emit("sim.death", { sim: sim, cause: key });
      }
    }
  }

  function getNeed(sim, need) {
    return sim && sim.needs ? sim.needs[need] : 0;
  }

  function modifyNeed(sim, need, delta) {
    if (!sim || !sim.needs || !sim.needs.hasOwnProperty(need)) return;
    sim.needs[need] = clamp(sim.needs[need] + delta, 0, 100);
  }

  function getCriticalNeeds(sim) {
    const critical = [];
    if (!sim || !sim.needs) return critical;
    for (const key of Object.keys(NEEDS)) {
      if (sim.needs[key] <= NEEDS[key].critical) {
        critical.push(key);
      }
    }
    return critical;
  }

  function getUrgentNeed(sim) {
    if (!sim || !sim.needs) return null;
    let urgent = null;
    let lowestPct = Infinity;
    for (const key of Object.keys(NEEDS)) {
      const pct = sim.needs[key] / NEEDS[key].critical;
      if (pct < lowestPct) {
        lowestPct = pct;
        urgent = key;
      }
    }
    return urgent;
  }

  // ========================================================================
  // MOOD
  // ========================================================================

  function getMoodScore(sim) {
    if (!sim || !sim.needs) return 50;
    // Weighted average of needs
    const weights = {
      hunger: 1.0, energy: 1.0, bladder: 0.8, hygiene: 0.7,
      social: 0.8, fun: 0.7, comfort: 0.6, environment: 0.5
    };
    let total = 0;
    let weightSum = 0;
    for (const key of Object.keys(NEEDS)) {
      total += sim.needs[key] * weights[key];
      weightSum += weights[key];
    }
    return clamp(total / weightSum, 0, 100);
  }

  function updateMood(sim) {
    if (!sim) return;
    const score = getMoodScore(sim);
    sim.moodScore = score;

    const oldMood = sim.mood;
    let newMood = "miserable";

    // Check thresholds from highest to lowest
    const moodOrder = ["elated", "happy", "fine", "uncomfortable", "miserable"];
    for (const m of moodOrder) {
      if (score >= MOODS[m].threshold) {
        newMood = m;
        break;
      }
    }

    sim.mood = newMood;

    if (oldMood !== newMood && EVENTS) {
      EVENTS.emit("sim.mood_change", { sim: sim, oldMood: oldMood, newMood: newMood });
    }
  }

  // ========================================================================
  // SKILLS
  // ========================================================================

  function gainSkill(sim, skill, amount) {
    if (!sim || !sim.skills || !sim.skills.hasOwnProperty(skill)) return;
    const mult = getSkillMultiplier(sim, skill);
    const gain = amount * mult;
    const oldVal = sim.skills[skill];
    sim.skills[skill] = clamp(sim.skills[skill] + gain, 0, 10);

    // Emit if levelled up (integer boundary crossed)
    if (Math.floor(sim.skills[skill]) > Math.floor(oldVal)) {
      if (EVENTS) EVENTS.emit("sim.skill_up", { sim: sim, skill: skill, level: Math.floor(sim.skills[skill]) });
    }
  }

  function getSkillLevel(sim, skill) {
    return sim && sim.skills ? sim.skills[skill] || 0 : 0;
  }

  // ========================================================================
  // LIFE STAGES
  // ========================================================================

  function getLifeStage(age) {
    const stages = Object.keys(LIFE_STAGES);
    for (const key of stages) {
      const s = LIFE_STAGES[key];
      if (age >= s.minAge && age <= s.maxAge) return key;
    }
    return "elder";
  }

  function ageSim(sim, days) {
    if (!sim) return;
    sim.age += days;
    const newStage = getLifeStage(sim.age);
    if (newStage !== sim.lifeStage) {
      sim.lifeStage = newStage;
      if (EVENTS) EVENTS.emit("sim.age_up", { sim: sim, newAge: sim.age });
    }
  }

  function isPlayable(sim) {
    if (!sim || !sim.lifeStage) return false;
    return !!LIFE_STAGES[sim.lifeStage] && LIFE_STAGES[sim.lifeStage].playable;
  }

  // ========================================================================
  // QUEUE
  // ========================================================================

  function enqueue(sim, objectId, actionKey) {
    if (!sim || !sim.queue) return;
    sim.queue.push({ objectId: objectId, actionKey: actionKey, targetX: null, targetY: null });
  }

  function clearQueue(sim) {
    if (!sim) return;
    sim.queue = [];
  }

  function cancelCurrentAction(sim) {
    if (!sim) return;
    sim.timer = 0;
    sim.state = "idle";
    sim.task = "Idle";
    // Clear any path
    sim.path = null;
    sim.pathIndex = 0;
  }

  // ========================================================================
  // STATE QUERIES
  // ========================================================================

  function getSim(id) {
    if (!STATE || !STATE.sims) return null;
    return STATE.sims.find(function(s) { return s.id === id; }) || null;
  }

  function getSimAt(x, y, radius) {
    if (!STATE || !STATE.sims) return null;
    const r = radius || 20;
    return STATE.sims.find(function(s) {
      const dx = s.x - x;
      const dy = s.y - y;
      return Math.sqrt(dx * dx + dy * dy) <= r;
    }) || null;
  }

  function getAllSims() {
    return STATE && STATE.sims ? STATE.sims : [];
  }

  function getSelectableSims() {
    if (!STATE || !STATE.sims) return [];
    return STATE.sims.filter(function(s) { return isPlayable(s); });
  }

  // ========================================================================
  // ANIMATION
  // ========================================================================

  function updateAnimation(sim, delta) {
    if (!sim) return;
    if (sim.state === "walking") {
      sim.animTimer += delta;
      // Advance frame every 100ms
      while (sim.animTimer >= 100) {
        sim.animTimer -= 100;
        sim.animFrame = (sim.animFrame + 1) % 8;
      }
    } else {
      sim.animFrame = 0;
      sim.animTimer = 0;
    }
  }

  // ========================================================================
  // EVENT SUBSCRIPTIONS
  // ========================================================================

  if (typeof EVENTS !== "undefined" && EVENTS && EVENTS.on) {
    // On tick: decay needs and update moods for all sims
    EVENTS.on("tick", function(data) {
      const delta = data && data.delta ? data.delta : 16;
      const gameMinutes = data && data.gameMinutes ? data.gameMinutes : ((CONFIG.SIM_SPEEDS[STATE.speed] * delta) / 60);
      if (!STATE || !STATE.sims) return;
      for (const sim of STATE.sims) {
        decayNeeds(sim, delta);
        updateMood(sim);
        updateAnimation(sim, delta);
        updateAction(sim, gameMinutes);
      }
    });
  }

  // ========================================================================
  // ACTION TIMER COUNTDOWN
  // ========================================================================

  function updateAction(sim, gameMinutes) {
    if (!sim || sim.state !== "working" || !sim.currentAction) return;
    sim.timer -= gameMinutes;
    if (sim.timer <= 0) {
      // Action complete — call WORLD to apply effects
      if (window.WORLD && WORLD.endInteraction) {
        WORLD.endInteraction(sim, sim.currentAction.objectId, sim.currentAction.actionKey);
      }
    }
  }

  // ========================================================================
  // EXPORTS
  // ========================================================================

  window.SIM = {
    NEEDS: NEEDS,
    TRAITS: TRAITS,
    MOODS: MOODS,
    SKILLS: SKILLS,
    LIFE_STAGES: LIFE_STAGES,
    createSim: createSim,
    addSim: addSim,
    removeSim: removeSim,
    decayNeeds: decayNeeds,
    getNeed: getNeed,
    modifyNeed: modifyNeed,
    getCriticalNeeds: getCriticalNeeds,
    getUrgentNeed: getUrgentNeed,
    updateMood: updateMood,
    getMoodScore: getMoodScore,
    gainSkill: gainSkill,
    getSkillLevel: getSkillLevel,
    ageSim: ageSim,
    getLifeStage: getLifeStage,
    isPlayable: isPlayable,
    enqueue: enqueue,
    clearQueue: clearQueue,
    cancelCurrentAction: cancelCurrentAction,
    getSim: getSim,
    getSimAt: getSimAt,
    getAllSims: getAllSims,
    getSelectableSims: getSelectableSims,
    updateAnimation: updateAnimation,
    updateAction: updateAction
  };

})();