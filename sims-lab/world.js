/**
 * world.js — World System
 * Lot management: rooms, walls, floors, objects, interactions, pathfinding, build/buy.
 * Exposes window.WORLD
 */
(function() {
  "use strict";

  // ========================================================================
  // OBJECT CATALOG
  // ========================================================================

  var OBJECT_CATALOG = {
    // Sleep
    single_bed: {
      name: "Single Bed", category: "sleep", size: [2, 3], cost: 300,
      interactions: {
        sleep: { label: "Sleep", duration: 480, needs: { energy: 80 }, skill: null, condition: null },
        nap:   { label: "Nap",   duration: 120, needs: { energy: 30 }, skill: null, condition: null },
        make_bed: { label: "Make Bed", duration: 30, needs: { fun: 0 }, skill: null, condition: null, repairs: 5 }
      }
    },

    // Hunger
    fridge: {
      name: "Fridge", category: "hunger", size: [1, 1], cost: 800,
      interactions: {
        quick_meal: { label: "Quick Meal", duration: 30, needs: { hunger: 25 }, cost: 15, skill: null },
        cook_meal:  { label: "Cook Meal",  duration: 60, needs: { hunger: 50 }, cost: 25, skill: "cooking", xp: 0.3 },
        gourmet:    { label: "Gourmet Meal", duration: 90, needs: { hunger: 70, fun: 10 }, cost: 45, skill: "cooking", level: 4, xp: 0.6 }
      }
    },
    stove: {
      name: "Stove", category: "hunger", size: [1, 1], cost: 600,
      interactions: {
        cook: { label: "Cook", duration: 60, needs: { hunger: 40 }, cost: 20, skill: "cooking", xp: 0.4, condition: "fridge_nearby" },
        bake: { label: "Bake", duration: 90, needs: { hunger: 50, fun: 15 }, cost: 30, skill: "cooking", level: 3, xp: 0.5 }
      },
      breakChance: 0.001, repairSkill: "handiness", repairXp: 0.3
    },

    // Bladder
    toilet: {
      name: "Toilet", category: "bladder", size: [1, 1], cost: 250,
      interactions: {
        use: { label: "Use", duration: 20, needs: { bladder: 80 }, skill: null },
        clean: { label: "Clean", duration: 30, needs: { hygiene: 0, fun: 0 }, skill: null, repairs: 10 }
      }
    },

    // Hygiene
    shower: {
      name: "Shower", category: "hygiene", size: [1, 1], cost: 400,
      interactions: {
        take_shower: { label: "Take Shower", duration: 30, needs: { hygiene: 70 }, skill: null },
        quick_rinse: { label: "Quick Rinse", duration: 15, needs: { hygiene: 40 }, skill: null }
      }
    },
    bathtub: {
      name: "Bathtub", category: "hygiene", size: [2, 1], cost: 550,
      interactions: {
        bathe: { label: "Take Bath", duration: 45, needs: { hygiene: 80, comfort: 30, fun: 10 }, skill: null },
        bubble_bath: { label: "Bubble Bath", duration: 60, needs: { hygiene: 80, comfort: 50, fun: 25 }, cost: 10, skill: null }
      }
    },
    sink_bathroom: {
      name: "Bathroom Sink", category: "hygiene", size: [1, 1], cost: 200,
      interactions: {
        wash_hands: { label: "Wash Hands", duration: 10, needs: { hygiene: 15 }, skill: null },
        brush_teeth: { label: "Brush Teeth", duration: 15, needs: { hygiene: 25 }, skill: null }
      }
    },

    // Social / Comfort
    sofa: {
      name: "Sofa", category: "comfort", size: [3, 1], cost: 500,
      interactions: {
        sit: { label: "Sit", duration: -1, needs: { comfort: 20 }, skill: null },
        nap: { label: "Nap", duration: 90, needs: { energy: 20, comfort: 10 }, skill: null },
        watch_tv: { label: "Watch TV", duration: -1, needs: { fun: 15, comfort: 10 }, skill: null }
      },
      capacity: 3
    },
    dining_table: {
      name: "Dining Table", category: "social", size: [3, 2], cost: 450,
      interactions: {
        eat: { label: "Eat Here", duration: 30, needs: { hunger: 0, comfort: 5 }, skill: null },
        group_meal: { label: "Group Meal", duration: 60, needs: { hunger: 30, social: 20 }, skill: null, minSims: 2 }
      },
      capacity: 4
    },

    // Fun
    tv: {
      name: "TV", category: "fun", size: [2, 1], cost: 1200,
      interactions: {
        watch: { label: "Watch TV", duration: -1, needs: { fun: 12 }, skill: null },
        play_games: { label: "Play Games", duration: -1, needs: { fun: 18 }, skill: null, cost: 0 },
        watch_movie: { label: "Watch Movie", duration: 120, needs: { fun: 30 }, cost: 10, skill: null }
      },
      breakChance: 0.0005
    },
    computer: {
      name: "Computer", category: "fun", size: [1, 1], cost: 1500,
      interactions: {
        browse: { label: "Browse Web", duration: -1, needs: { fun: 10 }, skill: null },
        play_games: { label: "Play Games", duration: -1, needs: { fun: 20 }, skill: null },
        program: { label: "Program", duration: -1, needs: { fun: 8 }, skill: "logic", xp: 0.4 },
        write: { label: "Write", duration: -1, needs: { fun: 5 }, skill: "creativity", xp: 0.3 }
      },
      breakChance: 0.0003
    },
    chess_table: {
      name: "Chess Table", category: "fun", size: [1, 1], cost: 300,
      interactions: {
        practice: { label: "Practice Chess", duration: -1, needs: { fun: 12 }, skill: "logic", xp: 0.3 },
        play_with: { label: "Play With...", duration: 60, needs: { fun: 25, social: 15 }, skill: "logic", xp: 0.5, minSims: 2 }
      },
      capacity: 2
    },
    guitar: {
      name: "Guitar", category: "fun", size: [1, 1], cost: 350,
      interactions: {
        practice: { label: "Practice", duration: -1, needs: { fun: 15 }, skill: "creativity", xp: 0.4 },
        perform: { label: "Perform", duration: 30, needs: { fun: 20, social: 5 }, skill: "creativity", xp: 0.3 }
      }
    },
    bookshelf: {
      name: "Bookshelf", category: "fun", size: [1, 1], cost: 400,
      interactions: {
        read: { label: "Read", duration: -1, needs: { fun: 10 }, skill: null },
        study: { label: "Study", duration: -1, needs: { fun: 5 }, skill: "logic", xp: 0.3 }
      }
    },
    mirror: {
      name: "Mirror", category: "social", size: [1, 1], cost: 150,
      interactions: {
        practice_speech: { label: "Practice Speech", duration: 30, needs: { fun: 5 }, skill: "charisma", xp: 0.3 },
        check_appearance: { label: "Check Appearance", duration: 10, needs: { hygiene: 5 }, skill: null }
      }
    },

    // Athletic
    treadmill: {
      name: "Treadmill", category: "athletic", size: [1, 2], cost: 900,
      interactions: {
        jog: { label: "Jog", duration: 30, needs: { fun: 10 }, skill: "athletic", xp: 0.4, drains: { energy: 10, hygiene: 15 } },
        run: { label: "Run", duration: 45, needs: { fun: 15 }, skill: "athletic", xp: 0.6, level: 3, drains: { energy: 20, hygiene: 25 } }
      },
      breakChance: 0.001
    },

    // Environment
    plant: {
      name: "Plant", category: "environment", size: [1, 1], cost: 80,
      interactions: {
        water: { label: "Water", duration: 10, needs: { fun: 2 }, skill: "gardening", xp: 0.2 },
        talk_to: { label: "Talk To", duration: 15, needs: { social: 5, fun: 3 }, skill: null }
      },
      environmentBonus: 8
    },
    painting: {
      name: "Painting", category: "environment", size: [1, 1], cost: 200,
      interactions: {
        admire: { label: "Admire", duration: 10, needs: { environment: 10, fun: 5 }, skill: null }
      },
      environmentBonus: 5
    },
    lamp: {
      name: "Lamp", category: "environment", size: [1, 1], cost: 120,
      interactions: {
        toggle: { label: "Toggle", duration: 0, needs: {}, skill: null }
      },
      lightRadius: 5,
      environmentBonus: 3
    },

    // Misc
    trash_can: {
      name: "Trash Can", category: "misc", size: [1, 1], cost: 50,
      interactions: {
        empty: { label: "Empty", duration: 15, needs: {}, skill: null }
      }
    },
    mailbox: {
      name: "Mailbox", category: "misc", size: [1, 1], cost: 0,
      interactions: {
        check_mail: { label: "Check Mail", duration: 10, needs: {}, skill: null }
      }
    }
  };

  // ========================================================================
  // INTERNAL STATE
  // ========================================================================

  var nextRoomId = 0;
  var nextObjectId = 0;

  // ========================================================================
  // LOT
  // ========================================================================

  function createLot(name, width, height) {
    var lot = {
      name: name || "Lot",
      width: width || 24,
      height: height || 18,
      floors: [
        {
          level: 0,
          rooms: [],
          walls: [],
          floors: {},  // map "x,y" -> floor type
          objects: []
        }
      ],
      terrain: "grass",
      weather: "clear",
      outdoorLight: 1.0,
      temperature: 22
    };

    if (STATE) STATE.lot = lot;
    return lot;
  }

  function getLot() {
    return STATE ? STATE.lot : null;
  }

  function getCurrentFloor() {
    var lot = getLot();
    return lot && lot.floors && lot.floors.length > 0 ? lot.floors[0] : null;
  }

  // ========================================================================
  // ROOMS
  // ========================================================================

  function createRoom(name, floorCells, color) {
    var floor = getCurrentFloor();
    if (!floor) return null;

    var room = {
      id: nextRoomId++,
      name: name || "Room " + nextRoomId,
      floorCells: floorCells || [],
      wallSegments: [],
      color: color || "#1a2433",
      objects: [],
      isOutside: false,
      lightLevel: 1.0,
      temperature: 22
    };

    floor.rooms.push(room);

    if (EVENTS) EVENTS.emit("room.created", { room: room });
    return room;
  }

  function removeRoom(roomId) {
    var floor = getCurrentFloor();
    if (!floor) return;
    var idx = floor.rooms.findIndex(function(r) { return r.id === roomId; });
    if (idx !== -1) {
      var room = floor.rooms[idx];
      floor.rooms.splice(idx, 1);
      if (EVENTS) EVENTS.emit("room.removed", { room: room });
    }
  }

  function getRoomAt(x, y) {
    var floor = getCurrentFloor();
    if (!floor) return null;
    for (var i = 0; i < floor.rooms.length; i++) {
      var room = floor.rooms[i];
      for (var j = 0; j < room.floorCells.length; j++) {
        var cell = room.floorCells[j];
        if (cell[0] === x && cell[1] === y) {
          return room;
        }
      }
    }
    return null;
  }

  function getRooms() {
    var floor = getCurrentFloor();
    return floor ? floor.rooms : [];
  }

  // ========================================================================
  // WALLS
  // ========================================================================

  function wallKey(x1, y1, x2, y2) {
    // Normalize: always smaller coord first
    if (x1 > x2 || (x1 === x2 && y1 > y2)) {
      var tmp;
      tmp = x1; x1 = x2; x2 = tmp;
      tmp = y1; y1 = y2; y2 = tmp;
    }
    return x1 + "," + y1 + "," + x2 + "," + y2;
  }

  function addWall(x1, y1, x2, y2) {
    var floor = getCurrentFloor();
    if (!floor) return false;

    // Validate within bounds
    var lot = getLot();
    if (!lot) return false;
    if (x1 < 0 || y1 < 0 || x2 > lot.width || y2 > lot.height) return false;

    var key = wallKey(x1, y1, x2, y2);
    // Check for duplicate
    for (var i = 0; i < floor.walls.length; i++) {
      var w = floor.walls[i];
      if (wallKey(w.x1, w.y1, w.x2, w.y2) === key) return false;
    }

    floor.walls.push({ x1: x1, y1: y1, x2: x2, y2: y2 });
    if (EVENTS) EVENTS.emit("wall.added", { x1: x1, y1: y1, x2: x2, y2: y2 });
    return true;
  }

  function removeWall(x1, y1, x2, y2) {
    var floor = getCurrentFloor();
    if (!floor) return;
    var key = wallKey(x1, y1, x2, y2);
    for (var i = floor.walls.length - 1; i >= 0; i--) {
      var w = floor.walls[i];
      if (wallKey(w.x1, w.y1, w.x2, w.y2) === key) {
        floor.walls.splice(i, 1);
        if (EVENTS) EVENTS.emit("wall.removed", { x1: x1, y1: y1, x2: x2, y2: y2 });
        return;
      }
    }
  }

  function hasWall(x1, y1, x2, y2) {
    var floor = getCurrentFloor();
    if (!floor) return false;
    var key = wallKey(x1, y1, x2, y2);
    for (var i = 0; i < floor.walls.length; i++) {
      var w = floor.walls[i];
      if (wallKey(w.x1, w.y1, w.x2, w.y2) === key) return true;
    }
    return false;
  }

  function getWalls() {
    var floor = getCurrentFloor();
    return floor ? floor.walls : [];
  }

  // ========================================================================
  // FLOORS
  // ========================================================================

  function setFloor(x, y, type) {
    var floor = getCurrentFloor();
    if (!floor) return;
    var key = x + "," + y;
    if (type === null || type === undefined) {
      delete floor.floors[key];
    } else {
      floor.floors[key] = type;
    }
  }

  function getFloor(x, y) {
    var floor = getCurrentFloor();
    if (!floor) return null;
    return floor.floors[x + "," + y] || null;
  }

  // ========================================================================
  // OBJECTS
  // ========================================================================

  function createObject(catalogKey, x, y, rotation) {
    var def = OBJECT_CATALOG[catalogKey];
    if (!def) return null;

    var floor = getCurrentFloor();
    if (!floor) return null;

    var lot = getLot();
    if (!lot) return null;

    var rot = rotation || 0;
    var sz = getRotatedSize(def.size, rot);

    // Bounds check
    if (x < 0 || y < 0 || x + sz[0] > lot.width || y + sz[1] > lot.height) {
      return null;
    }

    // Overlap check
    if (!canPlaceObject(catalogKey, x, y, rot)) {
      return null;
    }

    var room = getRoomAt(x, y);

    var obj = {
      id: nextObjectId++,
      catalogKey: catalogKey,
      x: x,
      y: y,
      rotation: rot,
      condition: 100,
      broken: false,
      inUse: false,
      usedBy: null,
      facing: "right",
      occupants: [],
      lightOn: false,
      roomId: room ? room.id : null
    };

    floor.objects.push(obj);

    if (EVENTS) EVENTS.emit("object.created", { object: obj });
    return obj;
  }

  function removeObject(id) {
    var floor = getCurrentFloor();
    if (!floor) return;
    var idx = floor.objects.findIndex(function(o) { return o.id === id; });
    if (idx !== -1) {
      var obj = floor.objects[idx];
      floor.objects.splice(idx, 1);
      if (EVENTS) EVENTS.emit("object.removed", { object: obj });
    }
  }

  function moveObject(id, x, y) {
    var obj = getObject(id);
    if (!obj) return false;
    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def) return false;

    var lot = getLot();
    if (!lot) return false;

    var sz = getRotatedSize(def.size, obj.rotation);
    if (x < 0 || y < 0 || x + sz[0] > lot.width || y + sz[1] > lot.height) {
      return false;
    }

    // Check overlap excluding self
    if (!canPlaceObjectAt(x, y, sz[0], sz[1], id)) {
      return false;
    }

    obj.x = x;
    obj.y = y;

    // Update room
    var room = getRoomAt(x, y);
    obj.roomId = room ? room.id : null;

    if (EVENTS) EVENTS.emit("object.moved", { object: obj });
    return true;
  }

  function rotateObject(id) {
    var obj = getObject(id);
    if (!obj) return false;

    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def) return false;

    var newRot = (obj.rotation + 90) % 360;
    var newSz = getRotatedSize(def.size, newRot);

    var lot = getLot();
    if (!lot) return false;

    if (obj.x + newSz[0] > lot.width || obj.y + newSz[1] > lot.height) {
      return false;
    }

    if (!canPlaceObjectAt(obj.x, obj.y, newSz[0], newSz[1], id)) {
      return false;
    }

    obj.rotation = newRot;
    if (EVENTS) EVENTS.emit("object.rotated", { object: obj });
    return true;
  }

  function getObject(id) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return null;
    return floor.objects.find(function(o) { return o.id === id; }) || null;
  }

  function getObjectsInRoom(roomId) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return [];
    return floor.objects.filter(function(o) { return o.roomId === roomId; });
  }

  function getObjectsByCategory(category) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return [];
    return floor.objects.filter(function(o) {
      var def = OBJECT_CATALOG[o.catalogKey];
      return def && def.category === category;
    });
  }

  function getRotatedSize(size, rotation) {
    if (rotation === 90 || rotation === 270) {
      return [size[1], size[0]];
    }
    return [size[0], size[1]];
  }

  function canPlaceObjectAt(x, y, w, h, excludeId) {
    var floor = getCurrentFloor();
    if (!floor) return false;

    for (var i = 0; i < floor.objects.length; i++) {
      var o = floor.objects[i];
      if (o.id === excludeId) continue;

      var def = OBJECT_CATALOG[o.catalogKey];
      if (!def) continue;

      var osz = getRotatedSize(def.size, o.rotation);
      // AABB overlap check
      if (x < o.x + osz[0] && x + w > o.x && y < o.y + osz[1] && y + h > o.y) {
        return false;
      }
    }
    return true;
  }

  // ========================================================================
  // INTERACTIONS
  // ========================================================================

  function getUsableObjects(sim) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return [];

    return floor.objects.filter(function(obj) {
      if (obj.broken) return false;
      var def = OBJECT_CATALOG[obj.catalogKey];
      if (!def || !def.interactions) return false;

      // Check if any interaction would help the sim
      for (var actionKey in def.interactions) {
        var action = def.interactions[actionKey];
        if (!canUse(sim, obj.id, actionKey)) continue;

        // Check if action satisfies a low need
        for (var need in action.needs) {
          if (sim.needs[need] < 80 && action.needs[need] > 0) {
            return true;
          }
        }
      }
      return false;
    });
  }

  function getInteractions(sim, objectId) {
    var obj = getObject(objectId);
    if (!obj) return [];
    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def || !def.interactions) return [];

    var result = [];
    for (var actionKey in def.interactions) {
      if (canUse(sim, objectId, actionKey)) {
        result.push({
          key: actionKey,
          label: def.interactions[actionKey].label,
          action: def.interactions[actionKey]
        });
      }
    }
    return result;
  }

  function canUse(sim, objectId, actionKey) {
    var obj = getObject(objectId);
    if (!obj) return false;
    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def || !def.interactions) return false;

    var action = def.interactions[actionKey];
    if (!action) return false;

    // Object broken
    if (obj.broken) return false;

    // Already in use (if not multi-capacity)
    var capacity = def.capacity || 1;
    if (obj.inUse && obj.occupants.length >= capacity) return false;

    // Check skill requirement
    if (action.level && action.skill) {
      var skillLevel = sim.skills[action.skill] || 0;
      if (skillLevel < action.level) return false;
    }

    // Check cost
    if (action.cost) {
      if (!STATE || STATE.funds < action.cost) return false;
    }

    // Check minSims requirement
    if (action.minSims) {
      if (!STATE || STATE.sims.length < action.minSims) return false;
    }

    // Check condition
    if (action.condition === "fridge_nearby") {
      if (!isFridgeNearby(obj)) return false;
    }

    return true;
  }

  function isFridgeNearby(obj) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return false;
    var radius = 5;
    for (var i = 0; i < floor.objects.length; i++) {
      var o = floor.objects[i];
      if (o.catalogKey === "fridge") {
        var dx = o.x - obj.x;
        var dy = o.y - obj.y;
        if (Math.sqrt(dx * dx + dy * dy) <= radius) return true;
      }
    }
    return false;
  }

  function startInteraction(sim, objectId, actionKey) {
    var obj = getObject(objectId);
    if (!obj) return false;
    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def || !def.interactions) return false;
    var action = def.interactions[actionKey];
    if (!action) return false;

    // Deduct cost
    if (action.cost && STATE) {
      STATE.funds -= action.cost;
      if (EVENTS) EVENTS.emit("funds.change", { old: STATE.funds + action.cost, new: STATE.funds, reason: action.label });
    }

    obj.inUse = true;
    obj.usedBy = sim.id;
    if (obj.occupants.indexOf(sim.id) === -1) {
      obj.occupants.push(sim.id);
    }

    sim.state = "working";
    sim.task = action.label;
    sim.timer = action.duration;
    sim.currentAction = { objectId: objectId, actionKey: actionKey };

    if (EVENTS) EVENTS.emit("sim.action_start", { sim: sim, action: actionKey, target: obj });
    if (EVENTS) EVENTS.emit("object.interact", { sim: sim, object: obj, action: actionKey });

    return true;
  }

  function endInteraction(sim, objectId, actionKey) {
    var obj = getObject(objectId);
    if (!obj) return;
    var def = OBJECT_CATALOG[obj.catalogKey];
    if (!def || !def.interactions) return;
    var action = def.interactions[actionKey];
    if (!action) return;

    // Apply need changes
    if (action.needs) {
      for (var need in action.needs) {
        var val = action.needs[need];
        if (val !== 0 && window.SIM) {
          SIM.modifyNeed(sim, need, val);
        }
      }
    }

    // Apply drains (energy, hygiene cost from activity)
    if (action.drains) {
      for (var drain in action.drains) {
        if (window.SIM) SIM.modifyNeed(sim, drain, -action.drains[drain]);
      }
    }

    // Apply skill XP
    if (action.skill && action.xp && window.SIM) {
      SIM.gainSkill(sim, action.skill, action.xp);
    }

    // Condition damage
    if (action.repairs) {
      obj.condition = Math.min(100, obj.condition + action.repairs);
    }

    // Remove occupant
    var occIdx = obj.occupants.indexOf(sim.id);
    if (occIdx !== -1) obj.occupants.splice(occIdx, 1);

    if (obj.occupants.length === 0) {
      obj.inUse = false;
      obj.usedBy = null;
    }

    sim.state = "idle";
    sim.task = "Idle";
    sim.timer = 0;
    sim.currentAction = null;

    if (EVENTS) EVENTS.emit("sim.action_complete", { sim: sim, action: actionKey, target: obj });
  }

  // ========================================================================
  // BREAKAGE
  // ========================================================================

  function checkBreakage(delta) {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return;

    for (var i = 0; i < floor.objects.length; i++) {
      var obj = floor.objects[i];
      if (obj.broken) continue;

      var def = OBJECT_CATALOG[obj.catalogKey];
      if (!def || !def.breakChance) continue;

      // Roll for breakage (scaled by delta)
      var dt = delta / 1000;
      if (obj.inUse && Math.random() < def.breakChance * dt) {
        obj.broken = true;
        obj.condition = Math.max(0, obj.condition - 30);
        if (EVENTS) EVENTS.emit("object.broken", { object: obj });
      }
    }
  }

  function repairObject(sim, objectId) {
    var obj = getObject(objectId);
    if (!obj || !obj.broken) return false;

    var def = OBJECT_CATALOG[obj.catalogKey];
    var repairXp = def && def.repairXp ? def.repairXp : 0.2;

    obj.broken = false;
    obj.condition = 100;

    if (window.SIM) SIM.gainSkill(sim, "handiness", repairXp);

    if (EVENTS) EVENTS.emit("object.repaired", { object: obj, sim: sim });
    return true;
  }

  // ========================================================================
  // ENVIRONMENT
  // ========================================================================

  function updateEnvironment(time, season, weather) {
    var lot = getLot();
    if (!lot) return;

    var hour = time !== undefined ? time : (STATE && STATE.time ? STATE.time.hour : 12);
    var seas = season !== undefined ? season : (STATE && STATE.time ? STATE.time.season : 0);
    var wthr = weather || lot.weather;

    // Outdoor light: 1.0 at noon, 0.0 at midnight
    var light;
    if (hour >= 6 && hour <= 18) {
      light = 0.3 + 0.7 * Math.sin(Math.PI * (hour - 6) / 12);
    } else {
      light = 0.05;
    }

    // Weather affects
    if (wthr === "storm" || wthr === "rain") light *= 0.6;
    if (wthr === "snow") light *= 0.8;

    lot.outdoorLight = Math.max(0.02, light);
    lot.weather = wthr;

    // Temperature by season
    var baseTemps = [18, 26, 15, 5]; // Spring, Summer, Autumn, Winter
    var temp = baseTemps[seas] || 18;

    if (wthr === "clear") temp += 2;
    if (wthr === "rain") temp -= 3;
    if (wthr === "storm") temp -= 5;
    if (wthr === "snow") temp -= 8;

    // Time of day modifier
    if (hour >= 0 && hour <= 5) temp -= 3;
    if (hour >= 12 && hour <= 15) temp += 2;

    lot.temperature = temp;

    // Update room light levels
    var floor = getCurrentFloor();
    if (floor && floor.rooms) {
      for (var i = 0; i < floor.rooms.length; i++) {
        var room = floor.rooms[i];
        room.lightLevel = lot.outdoorLight;
        room.temperature = temp;
      }
    }

    if (EVENTS) EVENTS.emit("environment.updated", { light: lot.outdoorLight, temperature: temp, weather: wthr });
  }

  function getLightAt(x, y) {
    var lot = getLot();
    if (!lot) return 1.0;

    // Check for nearby lamps
    var floor = getCurrentFloor();
    if (floor && floor.objects) {
      for (var i = 0; i < floor.objects.length; i++) {
        var obj = floor.objects[i];
        if (obj.catalogKey === "lamp" && obj.lightOn) {
          var def = OBJECT_CATALOG.lamp;
          var radius = def && def.lightRadius ? def.lightRadius : 5;
          var dx = obj.x - x;
          var dy = obj.y - y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= radius) {
            return Math.max(lot.outdoorLight, 1.0 - dist / radius * 0.5);
          }
        }
      }
    }

    return lot.outdoorLight;
  }

  function getTemperature() {
    var lot = getLot();
    return lot ? lot.temperature : 22;
  }

  // ========================================================================
  // A* PATHFINDING
  // ========================================================================

  function findPath(fromX, fromY, toX, toY) {
    var lot = getLot();
    if (!lot) return [];

    // Convert pixel to grid
    var gs = CONFIG ? CONFIG.GRID_SIZE : 40;
    var startGx = Math.floor(fromX / gs);
    var startGy = Math.floor(fromY / gs);
    var endGx = Math.floor(toX / gs);
    var endGy = Math.floor(toY / gs);

    // Clamp to lot bounds
    startGx = clamp(startGx, 0, lot.width - 1);
    startGy = clamp(startGy, 0, lot.height - 1);
    endGx = clamp(endGx, 0, lot.width - 1);
    endGy = clamp(endGy, 0, lot.height - 1);

    // Same cell
    if (startGx === endGx && startGy === endGy) {
      return [{ x: toX, y: toY }];
    }

    // A* search
    var openSet = [];
    var closedSet = new Set();
    var cameFrom = {};
    var gScore = {};
    var fScore = {};

    var startKey = key(startGx, startGy);
    gScore[startKey] = 0;
    fScore[startKey] = heuristic(startGx, startGy, endGx, endGy);
    openSet.push({ x: startGx, y: startGy, f: fScore[startKey] });

    var neighbors = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
      { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];

    var iterations = 0;
    var maxIterations = lot.width * lot.height * 2;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Get node with lowest f score
      openSet.sort(function(a, b) { return a.f - b.f; });
      var current = openSet.shift();
      var currentKey = key(current.x, current.y);

      if (current.x === endGx && current.y === endGy) {
        return reconstructPath(cameFrom, endGx, endGy, gs, toX, toY);
      }

      closedSet.add(currentKey);

      for (var i = 0; i < neighbors.length; i++) {
        var nb = neighbors[i];
        var nx = current.x + nb.dx;
        var ny = current.y + nb.dy;
        var nk = key(nx, ny);

        if (nx < 0 || ny < 0 || nx >= lot.width || ny >= lot.height) continue;
        if (closedSet.has(nk)) continue;

        // Check walkability
        if (!isWalkableGrid(nx, ny)) continue;

        // Diagonal movement: check both adjacent cells
        if (nb.dx !== 0 && nb.dy !== 0) {
          if (!isWalkableGrid(current.x + nb.dx, current.y)) continue;
          if (!isWalkableGrid(current.x, current.y + nb.dy)) continue;
        }

        var moveCost = (nb.dx !== 0 && nb.dy !== 0) ? 1.414 : 1.0;
        var tentativeG = gScore[currentKey] + moveCost;

        if (gScore[nk] === undefined || tentativeG < gScore[nk]) {
          cameFrom[nk] = { x: current.x, y: current.y };
          gScore[nk] = tentativeG;
          fScore[nk] = tentativeG + heuristic(nx, ny, endGx, endGy);

          var existing = openSet.find(function(n) { return n.x === nx && n.y === ny; });
          if (!existing) {
            openSet.push({ x: nx, y: ny, f: fScore[nk] });
          } else {
            existing.f = fScore[nk];
          }
        }
      }
    }

    // No path found — return direct path as fallback
    return [{ x: toX, y: toY }];
  }

  function heuristic(x1, y1, x2, y2) {
    // Diagonal (Chebyshev) distance
    var dx = Math.abs(x1 - x2);
    var dy = Math.abs(y1 - y2);
    return Math.max(dx, dy) + (Math.sqrt(2) - 1) * Math.min(dx, dy);
  }

  function key(x, y) {
    return x + "," + y;
  }

  function reconstructPath(cameFrom, endGx, endGy, gs, toX, toY) {
    var path = [];
    var cx = endGx;
    var cy = endGy;
    var visited = new Set();

    while (cx !== undefined && cy !== undefined) {
      var k = key(cx, cy);
      if (visited.has(k)) break;
      visited.add(k);
      path.unshift({ x: cx * gs + gs / 2, y: cy * gs + gs / 2 });
      var prev = cameFrom[k];
      if (!prev) break;
      cx = prev.x;
      cy = prev.y;
    }

    // Replace last point with exact target
    if (path.length > 0) {
      path[path.length - 1] = { x: toX, y: toY };
    }

    return path;
  }

  function isWalkable(x, y) {
    return isWalkableGrid(Math.floor(x), Math.floor(y));
  }

  function isWalkableGrid(gx, gy) {
    var lot = getLot();
    if (!lot) return false;
    if (gx < 0 || gy < 0 || gx >= lot.width || gy >= lot.height) return false;

    var floor = getCurrentFloor();
    if (!floor) return false;

    // Check if any object blocks this grid cell
    for (var i = 0; i < floor.objects.length; i++) {
      var obj = floor.objects[i];
      var def = OBJECT_CATALOG[obj.catalogKey];
      if (!def) continue;

      var sz = getRotatedSize(def.size, obj.rotation);
      // Object occupies cells [obj.x, obj.x + sz[0]) x [obj.y, obj.y + sz[1])
      if (gx >= obj.x && gx < obj.x + sz[0] && gy >= obj.y && gy < obj.y + sz[1]) {
        // Some categories are walkable (small decor, plants)
        if (def.category === "environment" || def.category === "misc") continue;
        return false;
      }
    }

    return true;
  }

  // ========================================================================
  // BUILD / BUY
  // ========================================================================

  function canPlaceObject(catalogKey, x, y, rotation) {
    var def = OBJECT_CATALOG[catalogKey];
    if (!def) return false;

    var lot = getLot();
    if (!lot) return false;

    var rot = rotation || 0;
    var sz = getRotatedSize(def.size, rot);

    if (x < 0 || y < 0 || x + sz[0] > lot.width || y + sz[1] > lot.height) {
      return false;
    }

    return canPlaceObjectAt(x, y, sz[0], sz[1], -1);
  }

  function canBuildWall(x1, y1, x2, y2) {
    var lot = getLot();
    if (!lot) return false;

    if (x1 < 0 || y1 < 0 || x2 > lot.width || y2 > lot.height) return false;

    // Check if wall already exists
    if (hasWall(x1, y1, x2, y2)) return false;

    // Walls must be axis-aligned (horizontal or vertical)
    if (x1 !== x2 && y1 !== y2) return false;

    return true;
  }

  function getBuildCost(type, params) {
    if (!CONFIG) return 0;

    switch (type) {
      case "wall":
        return CONFIG.WALL_COST || 50;
      case "floor":
        return CONFIG.FLOOR_COST || 30;
      case "object":
        if (params && params.catalogKey) {
          var def = OBJECT_CATALOG[params.catalogKey];
          return def ? def.cost : 0;
        }
        return 0;
      default:
        return 0;
    }
  }

  // ========================================================================
  // PASSIVE ENVIRONMENT BONUSES (plants, paintings, lamps)
  // ========================================================================

  function applyEnvironmentBonuses() {
    var floor = getCurrentFloor();
    if (!floor || !floor.objects) return;

    // Find all sims and give them environment boosts from nearby objects
    if (!STATE || !STATE.sims) return;

    for (var i = 0; i < floor.objects.length; i++) {
      var obj = floor.objects[i];
      var def = OBJECT_CATALOG[obj.catalogKey];
      if (!def || !def.environmentBonus) continue;

      // Boost sims in the same room
      for (var j = 0; j < STATE.sims.length; j++) {
        var sim = STATE.sims[j];
        if (!SIM) continue;

        var room = getRoomAt(obj.x, obj.y);
        var simRoom = getRoomAt(Math.floor(sim.x / (CONFIG ? CONFIG.GRID_SIZE : 40)), Math.floor(sim.y / (CONFIG ? CONFIG.GRID_SIZE : 40)));

        if (room && simRoom && room.id === simRoom.id) {
          SIM.modifyNeed(sim, "environment", def.environmentBonus * 0.001);
        }
      }
    }
  }

  // ========================================================================
  // EVENT SUBSCRIPTIONS
  // ========================================================================

  if (typeof EVENTS !== "undefined" && EVENTS && EVENTS.on) {
    EVENTS.on("tick", function(data) {
      var delta = data && data.delta ? data.delta : 16;
      checkBreakage(delta);
      applyEnvironmentBonuses();
    });

    EVENTS.on("time.season", function(data) {
      if (STATE && STATE.time) {
        updateEnvironment(STATE.time.hour, STATE.time.season, STATE.lot ? STATE.lot.weather : "clear");
      }
    });
  }

  // ========================================================================
  // UTILS
  // ========================================================================

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // ========================================================================
  // EXPORTS
  // ========================================================================

  window.WORLD = {
    OBJECT_CATALOG: OBJECT_CATALOG,
    createLot: createLot,
    getLot: getLot,
    createRoom: createRoom,
    removeRoom: removeRoom,
    getRoomAt: getRoomAt,
    getRooms: getRooms,
    addWall: addWall,
    removeWall: removeWall,
    hasWall: hasWall,
    getWalls: getWalls,
    setFloor: setFloor,
    getFloor: getFloor,
    createObject: createObject,
    removeObject: removeObject,
    moveObject: moveObject,
    rotateObject: rotateObject,
    getObject: getObject,
    getObjectsInRoom: getObjectsInRoom,
    getObjectsByCategory: getObjectsByCategory,
    getUsableObjects: getUsableObjects,
    getInteractions: getInteractions,
    canUse: canUse,
    startInteraction: startInteraction,
    endInteraction: endInteraction,
    checkBreakage: checkBreakage,
    repairObject: repairObject,
    updateEnvironment: updateEnvironment,
    getLightAt: getLightAt,
    getTemperature: getTemperature,
    findPath: findPath,
    isWalkable: isWalkable,
    canPlaceObject: canPlaceObject,
    canBuildWall: canBuildWall,
    getBuildCost: getBuildCost
  };

})();