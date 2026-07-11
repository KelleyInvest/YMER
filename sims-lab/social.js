/**
 * social.js — Social System
 *
 * Relationships, conversations, romance, group activities,
 * social AI helpers, and autonomous social events.
 *
 * Assumes global: ENGINE, STATE, CONFIG, EVENTS, SIM, WORLD
 */
(function () {
  "use strict";

  // ============================================================
  //  Relationship Level Definitions
  // ============================================================
  var RELATIONSHIP_LEVELS = [
    { max: -50,  label: "Enemy",        color: "#f2555a" },
    { max: -20,  label: "Disliked",     color: "#f5a623" },
    { max: 20,   label: "Acquaintance", color: "#94a3b8" },
    { max: 50,   label: "Friend",       color: "#4ade80" },
    { max: 80,   label: "Good Friend",  color: "#34d399" },
    { max: 100,  label: "Best Friend",  color: "#3dd6d0" }
  ];

  var ROMANCE_LEVELS = [
    { max: -30,  label: "Heartbroken",  color: "#f2555a" },
    { max: 0,    label: "Stranger",     color: "#94a3b8" },
    { max: 30,   label: "Curious",      color: "#f5a623" },
    { max: 60,   label: "Romantic",     color: "#f472b6" },
    { max: 85,   label: "Love",         color: "#e879f9" },
    { max: 100,  label: "Soulmate",     color: "#fb7185" }
  ];

  // ============================================================
  //  Conversation Topic Definitions
  // ============================================================
  var CONVERSATION_TOPICS = {
    friendly:   { friendshipMod: 5,  romanceMod: 0,  duration: 20, need: "social" },
    funny:      { friendshipMod: 8,  romanceMod: 2,  duration: 25, need: "fun" },
    flirt:      { friendshipMod: 3,  romanceMod: 10, duration: 20, need: "social", minRomance: 0 },
    compliment: { friendshipMod: 6,  romanceMod: 5,  duration: 15, need: "social" },
    argue:      { friendshipMod: -8, romanceMod: -3, duration: 15, need: "fun" },
    gossip:     { friendshipMod: 4,  romanceMod: 2,  duration: 20, need: "social" },
    deep_talk:  { friendshipMod: 10, romanceMod: 5,  duration: 40, need: "social", minFriendship: 30 }
  };

  // ============================================================
  //  Private State
  // ============================================================
  // Relationship store: keyed by "simIdA_simIdB" (sorted min,max)
  var _relationships = {};
  // Active conversations: keyed by "simIdA_simIdB" (sorted)
  var _activeConversations = {};
  // Active group activities: array of { sims: [ids], activity, startTime }
  var _groupActivities = [];

  // ============================================================
  //  Key Helpers
  // ============================================================

  /**
   * Generate a consistent relationship key for a pair of sims.
   */
  function _relKey(simA, simB) {
    var a = (typeof simA === "object") ? simA.id : simA;
    var b = (typeof simB === "object") ? simB.id : simB;
    return (a < b) ? (a + "_" + b) : (b + "_" + a);
  }

  /**
   * Get or create a relationship entry.
   */
  function _getRelEntry(simA, simB) {
    var key = _relKey(simA, simB);
    if (!_relationships[key]) {
      _relationships[key] = {
        friendship: 0,
        romance: 0
      };
    }
    return _relationships[key];
  }

  /**
   * Clamp a value between min and max.
   */
  function _clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // ============================================================
  //  Relationship Queries
  // ============================================================

  /**
   * Get the full relationship data between two sims.
   */
  function getRelationship(simA, simB) {
    var entry = _getRelEntry(simA, simB);
    return {
      friendship: entry.friendship,
      romance: entry.romance,
      level: getRelationshipLevel(entry.friendship),
      romanceLevel: getRomanceLevel(entry.romance)
    };
  }

  /**
   * Modify friendship between two sims.
   */
  function modifyFriendship(simA, simB, delta) {
    var entry = _getRelEntry(simA, simB);
    var oldLevel = getRelationshipLevel(entry.friendship);
    entry.friendship = _clamp(entry.friendship + delta, -100, 100);
    var newLevel = getRelationshipLevel(entry.friendship);

    EVENTS.emit("relationship.change", {
      simA: simA,
      simB: simB,
      delta: delta,
      newLevel: newLevel
    });

    if (oldLevel !== newLevel) {
      EVENTS.emit("relationship.milestone", {
        simA: simA,
        simB: simB,
        milestone: newLevel
      });
    }
  }

  /**
   * Modify romance between two sims.
   */
  function modifyRomance(simA, simB, delta) {
    var entry = _getRelEntry(simA, simB);
    var oldLevel = getRomanceLevel(entry.romance);
    entry.romance = _clamp(entry.romance + delta, -100, 100);
    var newLevel = getRomanceLevel(entry.romance);

    EVENTS.emit("relationship.change", {
      simA: simA,
      simB: simB,
      delta: delta,
      newLevel: newLevel
    });

    if (oldLevel !== newLevel) {
      EVENTS.emit("relationship.milestone", {
        simA: simA,
        simB: simB,
        milestone: newLevel
      });
    }
  }

  /**
   * Get the relationship level label from a friendship value.
   */
  function getRelationshipLevel(friendship) {
    for (var i = 0; i < RELATIONSHIP_LEVELS.length; i++) {
      if (friendship <= RELATIONSHIP_LEVELS[i].max) {
        return RELATIONSHIP_LEVELS[i].label;
      }
    }
    return RELATIONSHIP_LEVELS[RELATIONSHIP_LEVELS.length - 1].label;
  }

  /**
   * Get the romance level label from a romance value.
   */
  function getRomanceLevel(romance) {
    for (var i = 0; i < ROMANCE_LEVELS.length; i++) {
      if (romance <= ROMANCE_LEVELS[i].max) {
        return ROMANCE_LEVELS[i].label;
      }
    }
    return ROMANCE_LEVELS[ROMANCE_LEVELS.length - 1].label;
  }

  // ============================================================
  //  Interaction Functions
  // ============================================================

  /**
   * Check if two sims can interact (both awake, not panicking, etc.).
   */
  function canInteract(simA, simB) {
    if (!simA || !simB) return false;
    if (simA.id === simB.id) return false;
    if (simA.state === "sleeping" || simB.state === "sleeping") return false;
    if (simA.state === "panicking" || simB.state === "panicking") return false;
    // Check proximity — must be within interaction range (approx 3 grid cells = 120px)
    var dist = Math.hypot(simA.x - simB.x, simA.y - simB.y);
    if (dist > 120) return false;
    return true;
  }

  /**
   * Start a conversation between two sims on a given topic.
   */
  function startConversation(simA, simB, topic) {
    if (!canInteract(simA, simB)) return false;

    var topicData = CONVERSATION_TOPICS[topic];
    if (!topicData) return false;

    var rel = getRelationship(simA, simB);

    // Check topic prerequisites
    if (topicData.minRomance !== undefined && rel.romance < topicData.minRomance) {
      return false;
    }
    if (topicData.minFriendship !== undefined && rel.friendship < topicData.minFriendship) {
      return false;
    }

    var key = _relKey(simA, simB);
    _activeConversations[key] = {
      simA: simA,
      simB: simB,
      topic: topic,
      duration: topicData.duration,
      elapsed: 0,
      outcome: null
    };

    simA.state = "talking";
    simB.state = "talking";
    simA.task = "Talking to " + simB.name;
    simB.task = "Talking to " + simA.name;

    EVENTS.emit("conversation.start", { sims: [simA, simB], topic: topic });

    // Trait modifiers
    var friendMod = topicData.friendshipMod;
    var romMod = topicData.romanceMod;

    if (simA.traits) {
      if (simA.traits.indexOf("charmer") !== -1) {
        friendMod += 2;
        romMod += 2;
      }
      if (simA.traits.indexOf("outgoing") !== -1 && topic === "friendly") {
        friendMod += 3;
      }
    }
    if (simB.traits) {
      if (simB.traits.indexOf("charmer") !== -1) {
        friendMod += 2;
        romMod += 2;
      }
      if (simB.traits.indexOf("outgoing") !== -1 && topic === "friendly") {
        friendMod += 3;
      }
    }

    modifyFriendship(simA, simB, friendMod);
    modifyRomance(simA, simB, romMod);

    // Fulfill needs
    if (SIM && SIM.modifyNeed) {
      SIM.modifyNeed(simA, topicData.need, 8);
      SIM.modifyNeed(simB, topicData.need, 8);
      SIM.modifyNeed(simA, "social", 10);
      SIM.modifyNeed(simB, "social", 10);
    }

    if (STATE.stats) {
      STATE.stats.conversations = (STATE.stats.conversations || 0) + 1;
    }

    return true;
  }

  /**
   * End a conversation with a specific outcome.
   */
  function endConversation(simA, simB, outcome) {
    var key = _relKey(simA, simB);
    var conv = _activeConversations[key];
    if (!conv) return false;

    conv.outcome = outcome;
    delete _activeConversations[key];

    simA.state = "idle";
    simB.state = "idle";
    simA.task = "Idle";
    simB.task = "Idle";

    // Outcome effects
    if (outcome === "good") {
      modifyFriendship(simA, simB, 3);
      modifyRomance(simA, simB, 1);
    } else if (outcome === "bad") {
      modifyFriendship(simA, simB, -5);
      modifyRomance(simA, simB, -2);
    } else if (outcome === "amazing") {
      modifyFriendship(simA, simB, 8);
      modifyRomance(simA, simB, 5);
    }

    EVENTS.emit("conversation.end", { sims: [simA, simB], outcome: outcome });
    return true;
  }

  /**
   * Get valid conversation topics for two sims based on relationship.
   */
  function getConversationTopics(simA, simB) {
    var rel = getRelationship(simA, simB);
    var valid = [];
    for (var topic in CONVERSATION_TOPICS) {
      var data = CONVERSATION_TOPICS[topic];
      var ok = true;
      if (data.minRomance !== undefined && rel.romance < data.minRomance) ok = false;
      if (data.minFriendship !== undefined && rel.friendship < data.minFriendship) ok = false;
      if (ok) valid.push(topic);
    }
    return valid;
  }

  // ============================================================
  //  Group Activities
  // ============================================================

  /**
   * Start a group activity with multiple sims.
   * activity: "meal" | "tv" | "game" | "dance"
   */
  function startGroupActivity(sims, activity) {
    if (!sims || sims.length < 2) return false;

    var activityData = {
      sims: sims,
      activity: activity,
      startTime: STATE.time ? { hour: STATE.time.hour, minute: STATE.time.minute } : null
    };
    _groupActivities.push(activityData);

    for (var i = 0; i < sims.length; i++) {
      sims[i].state = "talking";
      sims[i].task = "Group " + activity;
    }

    // Boost social and fun for all participants
    for (var j = 0; j < sims.length; j++) {
      if (SIM && SIM.modifyNeed) {
        SIM.modifyNeed(sims[j], "social", 15);
        SIM.modifyNeed(sims[j], "fun", 10);
      }
    }

    // Cross-bond all participants
    for (var a = 0; a < sims.length; a++) {
      for (var b = a + 1; b < sims.length; b++) {
        modifyFriendship(sims[a], sims[b], 3);
      }
    }

    EVENTS.emit("conversation.start", { sims: sims, topic: "group_" + activity });
    return true;
  }

  /**
   * End all active group activities that include any of the given sims.
   */
  function endGroupActivity(sims) {
    if (!sims || sims.length === 0) return;
    var simIds = {};
    for (var i = 0; i < sims.length; i++) {
      simIds[sims[i].id] = true;
    }

    for (var g = _groupActivities.length - 1; g >= 0; g--) {
      var group = _groupActivities[g];
      var hasOverlap = false;
      for (var j = 0; j < group.sims.length; j++) {
        if (simIds[group.sims[j].id]) {
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) {
        for (var k = 0; k < group.sims.length; k++) {
          if (group.sims[k].state === "talking") {
            group.sims[k].state = "idle";
            group.sims[k].task = "Idle";
          }
        }
        EVENTS.emit("conversation.end", { sims: group.sims, outcome: "good" });
        _groupActivities.splice(g, 1);
      }
    }
  }

  // ============================================================
  //  Social AI Helpers
  // ============================================================

  /**
   * Find the best sim for a sim to socialize with.
   * Prefers: low social need, nearby sims, positive relationship.
   */
  function findSocialTarget(sim) {
    if (!STATE.sims || STATE.sims.length < 2) return null;
    var best = null;
    var bestScore = -Infinity;

    for (var i = 0; i < STATE.sims.length; i++) {
      var other = STATE.sims[i];
      if (other.id === sim.id) continue;
      if (other.state === "sleeping" || other.state === "panicking") continue;

      var dist = Math.hypot(sim.x - other.x, sim.y - other.y);
      var rel = getRelationship(sim, other);

      // Score: closer is better, higher friendship is better
      var score = rel.friendship * 0.5 - dist * 0.1;

      // Outgoing sims prefer company more
      if (sim.traits && sim.traits.indexOf("outgoing") !== -1) {
        score += 10;
      }
      // Loner sims are less interested
      if (sim.traits && sim.traits.indexOf("loner") !== -1) {
        score -= 15;
      }
      // Charmer prefers socializing
      if (sim.traits && sim.traits.indexOf("charmer") !== -1) {
        score += 8;
      }

      if (score > bestScore) {
        bestScore = score;
        best = other;
      }
    }
    return best;
  }

  /**
   * Check if a sim's social need is low enough to warrant socializing.
   */
  function shouldSocialize(sim) {
    if (!sim || !sim.needs) return false;
    var threshold = 50;
    if (sim.traits && sim.traits.indexOf("outgoing") !== -1) threshold = 65;
    if (sim.traits && sim.traits.indexOf("loner") !== -1) threshold = 30;
    return sim.needs.social < threshold;
  }

  // ============================================================
  //  Social Decay & Autonomous Events
  // ============================================================

  /**
   * Slowly decay all relationships over time.
   */
  function processSocialDecay(delta) {
    for (var key in _relationships) {
      var entry = _relationships[key];
      // Slight decay toward zero
      if (entry.friendship > 0) {
        entry.friendship = Math.max(0, entry.friendship - 0.001 * delta);
      } else if (entry.friendship < 0) {
        entry.friendship = Math.min(0, entry.friendship + 0.001 * delta);
      }
      if (entry.romance > 0) {
        entry.romance = Math.max(0, entry.romance - 0.0005 * delta);
      }
      // Clamp
      entry.friendship = _clamp(entry.friendship, -100, 100);
      entry.romance = _clamp(entry.romance, -100, 100);
    }
  }

  /**
   * Check for autonomous fights between sims with negative relationships.
   */
  function checkForFights() {
    if (!STATE.sims || STATE.sims.length < 2) return;
    for (var i = 0; i < STATE.sims.length; i++) {
      for (var j = i + 1; j < STATE.sims.length; j++) {
        var simA = STATE.sims[i];
        var simB = STATE.sims[j];
        var rel = getRelationship(simA, simB);

        if (rel.friendship < -30 && Math.random() < 0.02) {
          // Fight!
          modifyFriendship(simA, simB, -10);
          modifyRomance(simA, simB, -5);
          EVENTS.emit("notification", {
            text: simA.name + " and " + simB.name + " had a fight!",
            type: "bad"
          });
          if (STATE.stats) {
            STATE.stats.fights = (STATE.stats.fights || 0) + 1;
          }
        }
      }
    }
  }

  /**
   * Check for autonomous romance between sims with high romance values.
   */
  function checkForRomance() {
    if (!STATE.sims || STATE.sims.length < 2) return;
    for (var i = 0; i < STATE.sims.length; i++) {
      for (var j = i + 1; j < STATE.sims.length; j++) {
        var simA = STATE.sims[i];
        var simB = STATE.sims[j];
        var rel = getRelationship(simA, simB);

        if (rel.romance >= 60 && rel.friendship >= 40 && Math.random() < 0.01) {
          // Romance moment
          modifyRomance(simA, simB, 5);
          modifyFriendship(simA, simB, 3);
          EVENTS.emit("notification", {
            text: simA.name + " and " + simB.name + " shared a romantic moment!",
            type: "good"
          });
          if (STATE.stats) {
            STATE.stats.romances = (STATE.stats.romances || 0) + 1;
          }
        }
      }
    }
  }

  // ============================================================
  //  Conversation Processing (called each tick during conversation)
  // ============================================================

  /**
   * Process active conversations — advance timers, check for natural end.
   */
  function _processConversations() {
    for (var key in _activeConversations) {
      var conv = _activeConversations[key];
      conv.elapsed += 1;

      // Natural end when duration expires
      if (conv.elapsed >= conv.duration) {
        var outcome = "good";
        // Mood affects conversation outcome
        if (conv.simA.mood === "miserable" || conv.simB.mood === "miserable") {
          outcome = "bad";
        } else if (conv.simA.mood === "elated" && conv.simB.mood === "elated") {
          outcome = "amazing";
        }
        endConversation(conv.simA, conv.simB, outcome);
      }
    }
  }

  // ============================================================
  //  Event Listeners
  // ============================================================

  EVENTS.on("tick", function (data) {
    processSocialDecay(data.delta || 1);
    _processConversations();

    // Periodic autonomous checks
    if (STATE.time && STATE.time.minute === 0) {
      checkForFights();
      checkForRomance();
    }
  });

  // ============================================================
  //  Public API
  // ============================================================
  window.SOCIAL = {
    RELATIONSHIP_LEVELS: RELATIONSHIP_LEVELS,
    ROMANCE_LEVELS: ROMANCE_LEVELS,
    CONVERSATION_TOPICS: CONVERSATION_TOPICS,

    // Relationships
    getRelationship: getRelationship,
    modifyFriendship: modifyFriendship,
    modifyRomance: modifyRomance,
    getRelationshipLevel: getRelationshipLevel,
    getRomanceLevel: getRomanceLevel,

    // Interactions
    canInteract: canInteract,
    startConversation: startConversation,
    endConversation: endConversation,
    getConversationTopics: getConversationTopics,

    // Group activities
    startGroupActivity: startGroupActivity,
    endGroupActivity: endGroupActivity,

    // Social AI
    findSocialTarget: findSocialTarget,
    shouldSocialize: shouldSocialize,

    // Events
    processSocialDecay: processSocialDecay,
    checkForFights: checkForFights,
    checkForRomance: checkForRomance
  };

})();
