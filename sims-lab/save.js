// save.js — Save/Load Persistence System
// IIFE module exposing window.SAVE
// Dependencies: ENGINE, STATE, CONFIG, EVENTS (globals), SOCIAL, ECONOMY (globals, optional)

(function() {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────

  var SAVE_KEY      = "sims_lab_save";
  var SAVE_VERSION  = 1;
  var AUTO_SAVE_MS  = 5 * 60 * 1000; // 5 minutes default

  // ── Module State ─────────────────────────────────────────────────────────

  var _autoSaveTimer = null;
  var _isLoading     = false;

  // ── Circular Reference Safe JSON ─────────────────────────────────────────

  /**
   * Serialize a value to JSON, replacing circular refs with path markers.
   */
  function _toJSON(value) {
    var refs = new WeakMap();
    var rootSeen = false;
    return JSON.stringify(value, function(key, val) {
      if (!rootSeen) { rootSeen = true; return val; }
      if (val === null || val === undefined) return val;
      var type = typeof val;
      // Strip functions
      if (type === "function") return undefined;
      if (type === "object") {
        if (val instanceof Date)     return { __type: "Date", value: val.toISOString() };
        if (val instanceof RegExp)   return { __type: "RegExp", value: val.source, flags: val.flags };
        // Detect circular refs
        if (refs.has(val)) {
          return { __circular: true, __ref: refs.get(val) };
        }
        var path = this && key !== undefined ? (refs.get(this) || "") + "." + key : "" + key;
        refs.set(val, path);
      }
      return val;
    });
  }

  /**
   * Parse JSON, restoring circular refs marked by _toJSON.
   */
  function _fromJSON(jsonStr) {
    var parsed = JSON.parse(jsonStr);
    return _restoreCirculars(parsed);
  }

  /**
   * Walk parsed object and restore __circular placeholders.
   */
  function _restoreCirculars(obj) {
    var cache = {};
    // First pass: build cache of all objects with paths
    _walkBuildCache(obj, "", cache);
    // Second pass: replace circular markers
    _walkResolveCirculars(obj, cache);
    return obj;
  }

  function _walkBuildCache(obj, path, cache) {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      cache[path] = obj;
      for (var i = 0; i < obj.length; i++) {
        _walkBuildCache(obj[i], path + "[" + i + "]", cache);
      }
    } else {
      cache[path] = obj;
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        _walkBuildCache(obj[key], path ? path + "." + key : key, cache);
      }
    }
  }

  function _walkResolveCirculars(obj, cache) {
    if (obj === null || typeof obj !== "object") return;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = obj[key];
      if (val && typeof val === "object" && val.__circular === true && val.__ref !== undefined) {
        var resolved = cache[val.__ref];
        if (resolved !== undefined) {
          obj[key] = resolved;
        } else {
          obj[key] = null;
        }
      } else if (val && typeof val === "object") {
        // Restore Date objects
        if (val.__type === "Date" && val.value) {
          obj[key] = new Date(val.value);
        } else if (val.__type === "RegExp" && val.value) {
          obj[key] = new RegExp(val.value, val.flags || "");
        } else {
          _walkResolveCirculars(val, cache);
        }
      }
    }
  }

  // ── State Data Extraction ────────────────────────────────────────────────

  /**
   * Extract only serializable data from an object.
   * Strips methods, DOM nodes, canvas contexts, functions, etc.
   * Recursively walks nested objects and arrays.
   */
  function _extractData(obj, depth) {
    depth = depth || 0;
    if (depth > 50) {
      console.warn("[SAVE] Max extraction depth reached, truncating branch.");
      return null;
    }
    if (obj === null || obj === undefined) return obj;
    var type = typeof obj;
    // Primitives
    if (type === "boolean" || type === "number" || type === "string") return obj;
    if (type === "function") return undefined;
    if (type !== "object") return undefined;

    // DOM / Canvas elements
    if (obj instanceof HTMLElement || obj instanceof Node) return undefined;
    if (obj && obj.getContext && typeof obj.getContext === "function") return undefined;

    // Dates
    if (obj instanceof Date) return { __type: "Date", value: obj.toISOString() };

    // Arrays
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) {
        var extracted = _extractData(obj[i], depth + 1);
        if (extracted !== undefined) arr.push(extracted);
      }
      return arr;
    }

    // Plain objects
    var result = {};
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      // Skip internal / transient fields
      if (key.charAt(0) === "_" && key.charAt(1) === "_") continue;
      if (key === "path" && Array.isArray(obj[key])) {
        // Sim walking path — transient, skip
        continue;
      }
      // Skip known DOM references or canvas contexts
      if (key === "canvas" || key === "ctx" || key === "context" ||
          key === "renderer" || key === "element" || key === "domElement") {
        continue;
      }
      try {
        var val = obj[key];
        var extracted = _extractData(val, depth + 1);
        if (extracted !== undefined) {
          result[key] = extracted;
        }
      } catch (e) {
        // Skip properties that throw on access
      }
    }
    return result;
  }

  /**
   * Deep merge source object into target object (mutates target).
   * Preserves target references for object/array roots where possible.
   */
  function _deepRestore(target, source, depth) {
    depth = depth || 0;
    if (depth > 50) {
      console.warn("[SAVE] Max restore depth reached.");
      return;
    }
    if (source === null || source === undefined) return;
    if (typeof source !== "object") return;

    if (Array.isArray(source)) {
      // For arrays: clear and repopulate if target is also an array
      if (Array.isArray(target)) {
        target.length = 0;
        for (var i = 0; i < source.length; i++) {
          var sItem = source[i];
          if (sItem !== null && typeof sItem === "object" && !Array.isArray(sItem) && !(sItem instanceof Date)) {
            // Source item is a plain object — try to find matching target item by id
            var tMatch = null;
            if (sItem.id !== undefined) {
              for (var j = 0; j < target.length; j++) {
                if (target[j] && target[j].id === sItem.id) {
                  tMatch = target[j];
                  break;
                }
              }
            }
            if (tMatch) {
              _deepRestore(tMatch, sItem, depth + 1);
              target.push(tMatch);
            } else {
              target.push(_clonePlain(sItem, depth + 1));
            }
          } else if (sItem !== null && typeof sItem === "object" && Array.isArray(sItem)) {
            target.push(_clonePlain(sItem, depth + 1));
          } else {
            target.push(sItem);
          }
        }
      }
      return;
    }

    // Plain object
    var keys = Object.keys(source);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      var sVal = source[key];

      // Handle special type markers
      if (sVal && typeof sVal === "object" && sVal.__type === "Date" && sVal.value) {
        target[key] = new Date(sVal.value);
        continue;
      }
      if (sVal && typeof sVal === "object" && sVal.__type === "RegExp" && sVal.value) {
        target[key] = new RegExp(sVal.value, sVal.flags || "");
        continue;
      }

      if (sVal === null || sVal === undefined) {
        target[key] = sVal;
        continue;
      }
      if (typeof sVal !== "object") {
        target[key] = sVal;
        continue;
      }
      if (Array.isArray(sVal)) {
        if (!target[key] || !Array.isArray(target[key])) {
          target[key] = [];
        }
        _deepRestore(target[key], sVal, depth + 1);
      } else {
        if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
          target[key] = {};
        }
        _deepRestore(target[key], sVal, depth + 1);
      }
    }
  }

  /**
   * Clone a plain object/array (no methods, no circular refs expected).
   */
  function _clonePlain(obj, depth) {
    depth = depth || 0;
    if (depth > 50) return null;
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) arr.push(_clonePlain(obj[i], depth + 1));
      return arr;
    }
    var result = {};
    var keys = Object.keys(obj);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (obj[key] && typeof obj[key] === "object" && obj[key].__type === "Date" && obj[key].value) {
        result[key] = new Date(obj[key].value);
      } else {
        result[key] = _clonePlain(obj[key], depth + 1);
      }
    }
    return result;
  }

  // ── Serialization of External Module Data ────────────────────────────────

  /**
   * Extract data from SOCIAL module (relationships).
   * Handles friendship and romance matrices.
   */
  function _extractSocialData() {
    var data = { relationships: [], activeConversations: [] };
    try {
      // SOCIAL stores relationships — try to extract the internal matrix
      if (typeof SOCIAL !== "undefined" && SOCIAL) {
        // Access internal relationship storage if exposed
        if (SOCIAL._relationships) {
          data.relationships = _extractData(SOCIAL._relationships);
        } else if (SOCIAL.relationships) {
          data.relationships = _extractData(SOCIAL.relationships);
        }
        // Active conversations
        if (SOCIAL._conversations) {
          data.activeConversations = _extractData(SOCIAL._conversations);
        } else if (SOCIAL.conversations) {
          data.activeConversations = _extractData(SOCIAL.conversations);
        }
      }
    } catch (e) {
      console.warn("[SAVE] Could not extract SOCIAL data:", e.message);
    }
    return data;
  }

  /**
   * Restore data into SOCIAL module.
   */
  function _restoreSocialData(data) {
    if (!data) return;
    try {
      if (typeof SOCIAL !== "undefined" && SOCIAL) {
        if (data.relationships) {
          if (SOCIAL._relationships) {
            _deepRestore(SOCIAL._relationships, data.relationships);
          } else if (SOCIAL.relationships) {
            _deepRestore(SOCIAL.relationships, data.relationships);
          } else {
            // Store for later if module not ready
            SOCIAL.__pendingRelationships = data.relationships;
          }
        }
        if (data.activeConversations) {
          if (SOCIAL._conversations) {
            _deepRestore(SOCIAL._conversations, data.activeConversations);
          } else if (SOCIAL.conversations) {
            _deepRestore(SOCIAL.conversations, data.activeConversations);
          }
        }
      }
    } catch (e) {
      console.warn("[SAVE] Could not restore SOCIAL data:", e.message);
    }
  }

  /**
   * Extract data from ECONOMY module (inventory).
   */
  function _extractEconomyData() {
    var data = { inventory: [] };
    try {
      if (typeof ECONOMY !== "undefined" && ECONOMY) {
        if (ECONOMY.getInventory) {
          var inv = ECONOMY.getInventory();
          if (inv) data.inventory = _extractData(inv);
        } else if (ECONOMY._inventory) {
          data.inventory = _extractData(ECONOMY._inventory);
        } else if (ECONOMY.inventory) {
          data.inventory = _extractData(ECONOMY.inventory);
        }
      }
    } catch (e) {
      console.warn("[SAVE] Could not extract ECONOMY data:", e.message);
    }
    return data;
  }

  /**
   * Restore data into ECONOMY module.
   */
  function _restoreEconomyData(data) {
    if (!data) return;
    try {
      if (typeof ECONOMY !== "undefined" && ECONOMY) {
        if (data.inventory && data.inventory.length > 0) {
          if (ECONOMY._inventory) {
            _deepRestore(ECONOMY._inventory, data.inventory);
          } else if (ECONOMY.inventory) {
            _deepRestore(ECONOMY.inventory, data.inventory);
          } else {
            ECONOMY.__pendingInventory = data.inventory;
          }
        }
      }
    } catch (e) {
      console.warn("[SAVE] Could not restore ECONOMY data:", e.message);
    }
  }

  // ── Build Full Save Packet ───────────────────────────────────────────────

  /**
   * Build the complete save packet from current game state.
   */
  function _buildSavePacket() {
    var packet = {
      version:   SAVE_VERSION,
      timestamp: new Date().toISOString(),
      state:     {},
      social:    _extractSocialData(),
      economy:   _extractEconomyData()
    };

    // Only save serializable top-level STATE fields
    var stateKeys = [
      "paused", "speed", "mode", "time", "selectedSim", "selectedTool",
      "camera", "zoom", "funds", "bills", "stats", "notifications"
    ];

    for (var i = 0; i < stateKeys.length; i++) {
      var key = stateKeys[i];
      if (STATE[key] !== undefined) {
        packet.state[key] = _extractData(STATE[key]);
      }
    }

    // Serialize sims — deep extraction of each sim object
    if (STATE.sims && Array.isArray(STATE.sims)) {
      packet.state.sims = [];
      for (var s = 0; s < STATE.sims.length; s++) {
        var simData = _extractData(STATE.sims[s]);
        if (simData) packet.state.sims.push(simData);
      }
    }

    // Serialize lot
    if (STATE.lot) {
      packet.state.lot = _extractData(STATE.lot);
    }

    return packet;
  }

  /**
   * Restore STATE and all modules from a save packet.
   */
  function _restoreSavePacket(packet) {
    if (!packet || !packet.state) {
      throw new Error("Invalid save packet: missing state");
    }

    var savedState = packet.state;

    // ── Restore simple top-level fields ──
    var simpleFields = ["paused", "speed", "mode", "selectedSim", "selectedTool", "zoom", "funds"];
    for (var i = 0; i < simpleFields.length; i++) {
      var key = simpleFields[i];
      if (savedState[key] !== undefined) {
        STATE[key] = savedState[key];
      }
    }

    // ── Restore time ──
    if (savedState.time) {
      if (!STATE.time) STATE.time = {};
      _deepRestore(STATE.time, savedState.time);
    }

    // ── Restore camera ──
    if (savedState.camera) {
      if (!STATE.camera) STATE.camera = { x: 0, y: 0 };
      _deepRestore(STATE.camera, savedState.camera);
    }

    // ── Restore bills ──
    if (savedState.bills) {
      if (!STATE.bills) STATE.bills = {};
      _deepRestore(STATE.bills, savedState.bills);
    }

    // ── Restore stats ──
    if (savedState.stats) {
      if (!STATE.stats) STATE.stats = {};
      _deepRestore(STATE.stats, savedState.stats);
    }

    // ── Restore notifications ──
    if (savedState.notifications) {
      STATE.notifications = [];
      for (var n = 0; n < savedState.notifications.length; n++) {
        var note = savedState.notifications[n];
        if (note && typeof note === "object") {
          // Convert Date strings back
          if (note.time && typeof note.time === "string") {
            note.time = new Date(note.time);
          }
          STATE.notifications.push(note);
        }
      }
    }

    // ── Restore sims ──
    if (savedState.sims && Array.isArray(savedState.sims)) {
      STATE.sims.length = 0;
      for (var s = 0; s < savedState.sims.length; s++) {
        var simData = savedState.sims[s];
        if (!simData || typeof simData !== "object") continue;
        // Ensure sim has all required fields with defaults
        var sim = _createSimFromData(simData);
        STATE.sims.push(sim);
      }
    }

    // ── Restore lot ──
    if (savedState.lot && typeof savedState.lot === "object") {
      STATE.lot = _createLotFromData(savedState.lot);
    }

    // ── Restore external module data ──
    if (packet.social)  _restoreSocialData(packet.social);
    if (packet.economy) _restoreEconomyData(packet.economy);

    // ── Sync ENGINE state ──
    try {
      if (STATE.speed !== undefined && ENGINE && ENGINE.setSpeed) {
        ENGINE.setSpeed(STATE.speed);
      }
      if (STATE.paused !== undefined && ENGINE) {
        if (STATE.paused && ENGINE.pause) ENGINE.pause();
        else if (!STATE.paused && ENGINE.resume) ENGINE.resume();
      }
    } catch (e) {
      console.warn("[SAVE] Could not sync ENGINE state:", e.message);
    }
  }

  /**
   * Create a sim object from saved data, filling in defaults for missing fields.
   */
  function _createSimFromData(data) {
    var defaults = {
      id: 0, name: "Sim", gender: "f", age: 25, lifeStage: "young_adult",
      x: 480, y: 360, targetX: 480, targetY: 360, facing: "right",
      needs: { hunger: 80, energy: 80, bladder: 80, hygiene: 80, social: 80, fun: 80, comfort: 80, environment: 80 },
      traits: [],
      mood: "fine", moodScore: 50,
      state: "idle", task: "Idle", timer: 0,
      queue: [],
      skills: { logic: 0, creativity: 0, athletic: 0, charisma: 0, cooking: 0, handiness: 0, gardening: 0 },
      autonomy: true, currentGoal: null,
      bodyColor: "#e6edf5", hairColor: "#d4a574", height: 1.0,
      animFrame: 0, animTimer: 0,
      effects: [],
      job: null,
      heldObject: null
    };

    var sim = {};
    var keys = Object.keys(defaults);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (data[key] !== undefined) {
        if (typeof defaults[key] === "object" && defaults[key] !== null && !Array.isArray(defaults[key])) {
          // Merge objects (needs, skills, etc.)
          sim[key] = {};
          var defaultKeys = Object.keys(defaults[key]);
          for (var d = 0; d < defaultKeys.length; d++) {
            var dk = defaultKeys[d];
            sim[key][dk] = (data[key] && data[key][dk] !== undefined) ? data[key][dk] : defaults[key][dk];
          }
          // Also include any extra keys from data
          if (data[key] && typeof data[key] === "object") {
            var dataKeys = Object.keys(data[key]);
            for (var dk2 = 0; dk2 < dataKeys.length; dk2++) {
              var ek = dataKeys[dk2];
              if (sim[key][ek] === undefined) sim[key][ek] = data[key][ek];
            }
          }
        } else {
          sim[key] = data[key];
        }
      } else {
        sim[key] = _clonePlain(defaults[key]);
      }
    }

    // Copy any extra fields from data not in defaults
    var dataKeys = Object.keys(data);
    for (var k = 0; k < dataKeys.length; k++) {
      var extraKey = dataKeys[k];
      if (sim[extraKey] === undefined) {
        sim[extraKey] = _clonePlain(data[extraKey]);
      }
    }

    return sim;
  }

  /**
   * Create a lot object from saved data, filling in defaults.
   */
  function _createLotFromData(data) {
    var defaults = {
      name: "Sunset Studios",
      width: 24, height: 18,
      floors: [{ level: 0, rooms: [], walls: [], floors: [], objects: [] }],
      terrain: "grass",
      weather: "clear",
      outdoorLight: 1.0,
      temperature: 22
    };

    var lot = {};
    var keys = Object.keys(defaults);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (data[key] !== undefined) {
        lot[key] = _clonePlain(data[key]);
      } else {
        lot[key] = _clonePlain(defaults[key]);
      }
    }

    // Extra fields
    var dataKeys = Object.keys(data);
    for (var k = 0; k < dataKeys.length; k++) {
      var ek = dataKeys[k];
      if (lot[ek] === undefined) lot[ek] = _clonePlain(data[ek]);
    }

    return lot;
  }

  // ── Version Migration ────────────────────────────────────────────────────

  /**
   * Migrate old save data to current save format version.
   */
  function _migrateSave(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Invalid save data for migration");
    }

    var version = data.version || 0;

    // Version 0 → 1: initial format
    if (version < 1) {
      console.log("[SAVE] Migrating save from version " + version + " to 1");

      if (!data.state) data.state = {};

      // Set default fields that may be missing in older saves
      if (data.state.bills === undefined) {
        data.state.bills = { dailyDue: 150, lastPaid: 0, overdue: 0 };
      }
      if (data.state.stats === undefined) {
        data.state.stats = {
          resultsProduced: 0, mealsCooked: 0, conversations: 0,
          fights: 0, romances: 0, fires: 0, deaths: 0
        };
      }
      if (data.state.notifications === undefined) {
        data.state.notifications = [];
      }
      if (data.state.camera === undefined) {
        data.state.camera = { x: 0, y: 0 };
      }
      if (data.state.zoom === undefined) {
        data.state.zoom = 1.0;
      }
      if (data.state.selectedTool === undefined) {
        data.state.selectedTool = null;
      }
      if (data.state.mode === undefined) {
        data.state.mode = "live";
      }

      // Ensure sims have all required fields
      if (data.state.sims && Array.isArray(data.state.sims)) {
        for (var i = 0; i < data.state.sims.length; i++) {
          var sim = data.state.sims[i];
          if (!sim) continue;
          if (!sim.skills)       sim.skills = { logic: 0, creativity: 0, athletic: 0, charisma: 0, cooking: 0, handiness: 0, gardening: 0 };
          if (!sim.needs)        sim.needs = { hunger: 80, energy: 80, bladder: 80, hygiene: 80, social: 80, fun: 80, comfort: 80, environment: 80 };
          if (!sim.traits)       sim.traits = [];
          if (!sim.queue)        sim.queue = [];
          if (!sim.effects)      sim.effects = [];
          if (sim.mood === undefined) sim.mood = "fine";
          if (sim.moodScore === undefined) sim.moodScore = 50;
          if (sim.autonomy === undefined)  sim.autonomy = true;
          if (sim.animFrame === undefined) sim.animFrame = 0;
          if (sim.animTimer === undefined) sim.animTimer = 0;
        }
      }

      // Ensure lot has floors array
      if (data.state.lot && !data.state.lot.floors) {
        data.state.lot.floors = [{ level: 0, rooms: [], walls: [], floors: [], objects: [] }];
      }

      data.version = 1;
    }

    return data;
  }

  // ── Compression (Simple Base64) ──────────────────────────────────────────

  /**
   * Simple compression: JSON → base64 string.
   * This provides ~25% size reduction and safe transport.
   */
  function _compress(data) {
    try {
      var json = typeof data === "string" ? data : JSON.stringify(data);
      // Unicode-safe base64 encoding
      var bytes = [];
      for (var i = 0; i < json.length; i++) {
        var code = json.charCodeAt(i);
        if (code < 0x80) {
          bytes.push(code);
        } else if (code < 0x800) {
          bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
          bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else { // surrogate pair
          i++;
          var code2 = json.charCodeAt(i);
          var fullCode = 0x10000 + (((code & 0x3ff) << 10) | (code2 & 0x3ff));
          bytes.push(0xf0 | (fullCode >> 18), 0x80 | ((fullCode >> 12) & 0x3f),
                     0x80 | ((fullCode >> 6) & 0x3f), 0x80 | (fullCode & 0x3f));
        }
      }
      // Use Uint8Array + btoa if available, else return raw JSON
      if (typeof btoa === "function" && typeof Uint8Array !== "undefined") {
        var uint8 = new Uint8Array(bytes);
        var binary = "";
        for (var j = 0; j < uint8.length; j++) {
          binary += String.fromCharCode(uint8[j]);
        }
        return btoa(binary);
      }
      return json; // fallback: return raw JSON
    } catch (e) {
      console.warn("[SAVE] Compression failed:", e.message);
      return typeof data === "string" ? data : JSON.stringify(data);
    }
  }

  /**
   * Decompress base64 → JSON object or string.
   */
  function _decompress(str) {
    if (!str || typeof str !== "string") return null;
    // Detect if it's base64 (no whitespace, printable chars)
    var isBase64 = /^[A-Za-z0-9+/=]+$/.test(str.trim()) && str.length > 20;
    if (!isBase64) {
      // Already JSON string
      try { return JSON.parse(str); } catch (e) { return str; }
    }
    try {
      var binary = atob(str.trim());
      var bytes = [];
      for (var i = 0; i < binary.length; i++) {
        bytes.push(binary.charCodeAt(i));
      }
      // UTF-8 decode
      var utf8 = "";
      for (var j = 0; j < bytes.length; ) {
        var b = bytes[j];
        if (b < 0x80) {
          utf8 += String.fromCharCode(b); j++;
        } else if ((b & 0xe0) === 0xc0 && j + 1 < bytes.length) {
          utf8 += String.fromCharCode(((b & 0x1f) << 6) | (bytes[j + 1] & 0x3f)); j += 2;
        } else if ((b & 0xf0) === 0xe0 && j + 2 < bytes.length) {
          utf8 += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[j + 1] & 0x3f) << 6) | (bytes[j + 2] & 0x3f)); j += 3;
        } else if ((b & 0xf8) === 0xf0 && j + 3 < bytes.length) {
          var cp = ((b & 0x07) << 18) | ((bytes[j + 1] & 0x3f) << 12) | ((bytes[j + 2] & 0x3f) << 6) | (bytes[j + 3] & 0x3f);
          cp -= 0x10000;
          utf8 += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); j += 4;
        } else {
          utf8 += "\ufffd"; j++;
        }
      }
      return JSON.parse(utf8);
    } catch (e) {
      console.warn("[SAVE] Decompression failed:", e.message);
      // Try parsing as raw JSON
      try { return JSON.parse(str); } catch (e2) { return null; }
    }
  }

  // ── Core API ─────────────────────────────────────────────────────────────

  /**
   * Save the current game state to localStorage.
   */
  function save() {
    try {
      if (!STATE) {
        console.warn("[SAVE] STATE not available, cannot save.");
        return false;
      }

      var packet = _buildSavePacket();
      var jsonStr = _toJSON(packet);

      // Size check — localStorage ~5MB
      if (jsonStr.length > 4 * 1024 * 1024) {
        console.error("[SAVE] Save data exceeds 4MB, too large for localStorage.");
        return false;
      }

      localStorage.setItem(SAVE_KEY, jsonStr);

      console.log("[SAVE] Game saved at " + packet.timestamp + " (" + jsonStr.length + " bytes)");

      // Emit saved event
      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("save.saved", { timestamp: packet.timestamp, size: jsonStr.length });
      }

      // Show notification
      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("notification", { text: "Game Saved", type: "info" });
      }

      return true;
    } catch (e) {
      console.error("[SAVE] Save failed:", e.message);
      return false;
    }
  }

  /**
   * Load the game state from localStorage.
   */
  function load() {
    try {
      var jsonStr = localStorage.getItem(SAVE_KEY);
      if (!jsonStr) {
        console.log("[SAVE] No save found in localStorage.");
        return false;
      }

      _isLoading = true;

      var packet;
      try {
        packet = _fromJSON(jsonStr);
      } catch (parseErr) {
        // Try decompression (in case it was compressed)
        var decompressed = _decompress(jsonStr);
        if (decompressed && typeof decompressed === "object") {
          packet = decompressed;
        } else {
          throw new Error("Could not parse save data: " + parseErr.message);
        }
      }

      if (!packet || typeof packet !== "object") {
        throw new Error("Invalid save data structure");
      }

      // Version check & migration
      var saveVersion = packet.version || 0;
      if (saveVersion > SAVE_VERSION) {
        console.warn("[SAVE] Save version " + saveVersion + " is newer than supported version " + SAVE_VERSION);
        return false;
      }
      if (saveVersion < SAVE_VERSION) {
        packet = _migrateSave(packet);
      }

      // Restore state
      _restoreSavePacket(packet);

      console.log("[SAVE] Game loaded. Save from " + (packet.timestamp || "unknown"));

      // Emit loaded event
      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("save.loaded", {});
      }

      _isLoading = false;
      return true;
    } catch (e) {
      console.error("[SAVE] Load failed:", e.message);
      _isLoading = false;

      // Show error notification
      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("notification", { text: "Load failed — starting fresh", type: "bad" });
      }

      return false;
    }
  }

  /**
   * Export save data as a JSON string (for file download).
   */
  function exportSave() {
    try {
      if (!STATE) return null;
      var packet = _buildSavePacket();
      return _toJSON(packet);
    } catch (e) {
      console.error("[SAVE] Export failed:", e.message);
      return null;
    }
  }

  /**
   * Import save data from a JSON string.
   */
  function importSave(jsonString) {
    try {
      if (!jsonString || typeof jsonString !== "string") {
        console.warn("[SAVE] Import: empty or invalid input.");
        return false;
      }

      _isLoading = true;

      var packet;
      try {
        packet = _fromJSON(jsonString);
      } catch (parseErr) {
        var decompressed = _decompress(jsonString);
        if (decompressed && typeof decompressed === "object") {
          packet = decompressed;
        } else {
          throw new Error("Could not parse import data: " + parseErr.message);
        }
      }

      if (!packet || !packet.state) {
        throw new Error("Invalid import data: missing state");
      }

      // Also save to localStorage for persistence
      localStorage.setItem(SAVE_KEY, jsonString);

      // Version check & migration
      var saveVersion = packet.version || 0;
      if (saveVersion > SAVE_VERSION) {
        console.warn("[SAVE] Import version " + saveVersion + " is newer than supported.");
        _isLoading = false;
        return false;
      }
      if (saveVersion < SAVE_VERSION) {
        packet = _migrateSave(packet);
      }

      _restoreSavePacket(packet);

      console.log("[SAVE] Game imported successfully.");

      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("save.loaded", {});
      }

      _isLoading = false;
      return true;
    } catch (e) {
      console.error("[SAVE] Import failed:", e.message);
      _isLoading = false;
      return false;
    }
  }

  /**
   * Check if a save exists in localStorage.
   */
  function hasSave() {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  /**
   * Delete the save from localStorage.
   */
  function deleteSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
      console.log("[SAVE] Save deleted.");
      return true;
    } catch (e) {
      console.error("[SAVE] Delete failed:", e.message);
      return false;
    }
  }

  // ── Auto-Save ────────────────────────────────────────────────────────────

  /**
   * Enable auto-save at the given interval (in minutes).
   */
  function enableAutoSave(intervalMinutes) {
    disableAutoSave();
    var ms = (intervalMinutes && intervalMinutes > 0)
      ? intervalMinutes * 60 * 1000
      : AUTO_SAVE_MS;
    _autoSaveTimer = setInterval(function() {
      if (!_isLoading && STATE && !STATE.paused) {
        save();
      }
    }, ms);
    console.log("[SAVE] Auto-save enabled every " + (ms / 60000) + " minutes.");
  }

  /**
   * Disable auto-save.
   */
  function disableAutoSave() {
    if (_autoSaveTimer !== null) {
      clearInterval(_autoSaveTimer);
      _autoSaveTimer = null;
      console.log("[SAVE] Auto-save disabled.");
    }
  }

  // ── Versioning ───────────────────────────────────────────────────────────

  /**
   * Get the current save format version.
   */
  function getVersion() {
    return SAVE_VERSION;
  }

  /**
   * Migrate old save data to current version.
   * Exposed publicly for testing or manual migration.
   */
  function migrateSave(data) {
    return _migrateSave(data);
  }

  // ── Compression API ──────────────────────────────────────────────────────

  /**
   * Compress save data (JSON → base64 string).
   */
  function compress(data) {
    return _compress(data);
  }

  /**
   * Decompress save data (base64 → JSON object).
   */
  function decompress(data) {
    return _decompress(data);
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /**
   * Check if a save load is currently in progress.
   */
  function isLoading() {
    return _isLoading;
  }

  /**
   * Get info about the current save (from localStorage).
   */
  function getSaveInfo() {
    try {
      var jsonStr = localStorage.getItem(SAVE_KEY);
      if (!jsonStr) return null;
      var packet = _fromJSON(jsonStr);
      return {
        version:   packet.version || 0,
        timestamp: packet.timestamp || "unknown",
        size:      jsonStr.length,
        simCount:  (packet.state && packet.state.sims) ? packet.state.sims.length : 0,
        day:       (packet.state && packet.state.time) ? packet.state.time.day : 0
      };
    } catch (e) {
      return null;
    }
  }

  // ── Quicksave / Quickload (convenience) ──────────────────────────────────

  var QUICKSAVE_KEY = SAVE_KEY + "_quick";

  function quickSave() {
    try {
      if (!STATE) return false;
      var packet = _buildSavePacket();
      var jsonStr = _toJSON(packet);
      localStorage.setItem(QUICKSAVE_KEY, jsonStr);
      return true;
    } catch (e) {
      console.error("[SAVE] Quicksave failed:", e.message);
      return false;
    }
  }

  function quickLoad() {
    try {
      var jsonStr = localStorage.getItem(QUICKSAVE_KEY);
      if (!jsonStr) return false;
      var packet = _fromJSON(jsonStr);
      var saveVersion = packet.version || 0;
      if (saveVersion < SAVE_VERSION) packet = _migrateSave(packet);
      if (saveVersion > SAVE_VERSION) return false;
      _restoreSavePacket(packet);
      if (typeof EVENTS !== "undefined" && EVENTS.emit) {
        EVENTS.emit("save.loaded", {});
      }
      return true;
    } catch (e) {
      console.error("[SAVE] Quickload failed:", e.message);
      return false;
    }
  }

  // ── Expose Public API ────────────────────────────────────────────────────

  window.SAVE = {
    save:               save,
    load:               load,
    "export":           exportSave,
    "import":           importSave,
    hasSave:            hasSave,
    deleteSave:         deleteSave,
    enableAutoSave:     enableAutoSave,
    disableAutoSave:    disableAutoSave,
    getVersion:         getVersion,
    migrateSave:        migrateSave,
    compress:           compress,
    decompress:         decompress,
    isLoading:          isLoading,
    getSaveInfo:        getSaveInfo,
    quickSave:          quickSave,
    quickLoad:          quickLoad
  };

  console.log("[SAVE] Save/load module initialized (v" + SAVE_VERSION + ").");

})();
