// init.js — Game Initialization Bootstrap
// Creates the demo lot, rooms, objects, and 4 sims. Starts all systems.

(function () {
  'use strict';

  function log(msg) {
    console.log('[INIT] ' + msg);
  }

  function logError(msg, err) {
    console.error('[INIT ERROR] ' + msg, err);
    // Also show on page for debugging
    var dbg = document.getElementById('debug-log');
    if (dbg) {
      dbg.innerHTML += '<div style="color:#f2555a;font:11px monospace;">' + msg + (err ? ': ' + err.message : '') + '</div>';
    }
  }

  // ================================================================
  // 1. Create the Lot
  // ================================================================
  function createLot() {
    if (!window.WORLD || !WORLD.createLot) {
      throw new Error('WORLD.createLot not available');
    }
    WORLD.createLot('Sunset Studios', 24, 18);
    log('Lot created: ' + STATE.lot.width + 'x' + STATE.lot.height);
  }

  // ================================================================
  // 2. Build Rooms (walls + floors)
  // ================================================================
  function buildRooms() {
    if (!window.WORLD) throw new Error('WORLD not available');

    // Define rooms as { name, x1, y1, x2, y2, color, floor }
    var roomDefs = [
      { name: 'Living Room', x1: 1,  y1: 1, x2: 12, y2: 9,  color: '#1a2433', floor: 'wood' },
      { name: 'Kitchen',     x1: 1,  y1: 9, x2: 8,  y2: 15, color: '#1a2a1a', floor: 'tile' },
      { name: 'Bedroom',     x1: 12, y1: 1, x2: 20, y2: 7,  color: '#1a1a2e', floor: 'carpet' },
      { name: 'Bathroom',    x1: 12, y1: 7, x2: 17, y2: 12, color: '#1a2a2e', floor: 'tile' },
      { name: 'Study',       x1: 17, y1: 7, x2: 23, y2: 12, color: '#1e1a2e', floor: 'wood' },
      { name: 'Dining',      x1: 8,  y1: 9, x2: 12, y2: 14, color: '#2a1a1a', floor: 'wood' },
    ];

    roomDefs.forEach(function (roomDef) {
      var cells = [];
      for (var x = roomDef.x1; x < roomDef.x2; x++) {
        for (var y = roomDef.y1; y < roomDef.y2; y++) {
          cells.push([x, y]);
        }
      }
      WORLD.createRoom(roomDef.name, cells, roomDef.color);
      cells.forEach(function (cell) {
        WORLD.setFloor(cell[0], cell[1], roomDef.floor);
      });
    });

    // Build walls around rooms
    roomDefs.forEach(function (roomDef) {
      for (var x = roomDef.x1; x < roomDef.x2; x++) {
        WORLD.addWall(x, roomDef.y1, x + 1, roomDef.y1);
        WORLD.addWall(x, roomDef.y2, x + 1, roomDef.y2);
      }
      for (var y = roomDef.y1; y < roomDef.y2; y++) {
        WORLD.addWall(roomDef.x1, y, roomDef.x1, y + 1);
        WORLD.addWall(roomDef.x2, y, roomDef.x2, y + 1);
      }
    });

    // Open archways between rooms
    // Living → Dining
    for (var dx = 9; dx <= 11; dx++) WORLD.removeWall(dx, 9, dx + 1, 9);
    // Bedroom → Bathroom
    WORLD.removeWall(14, 7, 15, 7);
    // Bathroom → Study
    WORLD.removeWall(17, 9, 17, 10);
    // Kitchen → Dining
    WORLD.removeWall(8, 11, 8, 12);

    log('Rooms built: ' + roomDefs.length);
  }

  // ================================================================
  // 3. Place Objects
  // ================================================================
  function placeObjects() {
    if (!window.WORLD) throw new Error('WORLD not available');

    var objects = [
      // Kitchen
      ['fridge', 2, 10, 0], ['stove', 2, 12, 0],
      // Living Room
      ['sofa', 4, 4, 0], ['tv', 3, 2, 0], ['bookshelf', 9, 2, 0],
      ['lamp', 7, 6, 0], ['plant', 1, 4, 0],
      // Bedroom
      ['single_bed', 14, 3, 0], ['lamp', 18, 3, 0],
      ['bookshelf', 18, 5, 0],
      // Bathroom
      ['toilet', 13, 8, 0], ['shower', 15, 8, 0],
      ['sink_bathroom', 13, 10, 0],
      // Study
      ['computer', 19, 8, 0], ['bookshelf', 21, 8, 0],
      ['chess_table', 19, 10, 0],
      // Dining
      ['dining_table', 9, 11, 0], ['guitar', 10, 13, 0],
      // Athletic / Fun
      ['treadmill', 21, 3, 0], ['mirror', 16, 5, 0],
      // Decor
      ['painting', 6, 2, 0], ['plant', 11, 5, 0],
      ['plant', 20, 5, 0], ['trash_can', 1, 14, 0],
      ['mailbox', 1, 16, 0], ['lamp', 5, 8, 0],
    ];

    objects.forEach(function (obj) {
      try {
        WORLD.createObject(obj[0], obj[1], obj[2], obj[3]);
      } catch (e) {
        logError('Failed to place ' + obj[0] + ' at ' + obj[1] + ',' + obj[2], e);
      }
    });

    log('Objects placed: ' + objects.length);
  }

  // ================================================================
  // 4. Create 4 Sims
  // ================================================================
  function createSims() {
    if (!window.SIM) throw new Error('SIM not available');

    var configs = [
      { name: 'Mira',  gender: 'f', age: 25, traits: ['neat', 'genius', 'morning_person'],     x: 260, y: 220 },
      { name: 'Jake',  gender: 'm', age: 28, traits: ['active', 'outgoing', 'lucky'],          x: 580, y: 180 },
      { name: 'Luna',  gender: 'f', age: 22, traits: ['creative', 'night_owl', 'charmer'],     x: 420, y: 460 },
      { name: 'Oscar', gender: 'm', age: 35, traits: ['slob', 'lazy', 'unlucky'],              x: 180, y: 460 },
    ];

    configs.forEach(function (cfg) {
      var sim = SIM.createSim(cfg);
      sim.x = cfg.x;
      sim.y = cfg.y;
      sim.targetX = cfg.x;
      sim.targetY = cfg.y;
      SIM.addSim(sim);
    });

    // Assign careers
    if (window.ECONOMY) {
      var careers = ['tech', 'athletic', 'artist', 'business'];
      STATE.sims.forEach(function (sim, i) {
        if (careers[i]) ECONOMY.assignCareer(sim, careers[i]);
      });
    }

    // Initialize relationships
    if (window.SOCIAL) {
      for (var i = 0; i < STATE.sims.length; i++) {
        for (var j = i + 1; j < STATE.sims.length; j++) {
          SOCIAL.modifyFriendship(STATE.sims[i], STATE.sims[j], 15);
        }
      }
    }

    log('Sims created: ' + STATE.sims.length);
  }

  // ================================================================
  // 5. Initialize Renderer & UI
  // ================================================================
  function initSystems() {
    // Renderer
    var canvas = document.getElementById('game');
    if (canvas && window.RENDERER && RENDERER.init) {
      RENDERER.init(canvas);
      log('Renderer initialized');
    } else {
      logError('Renderer init failed', new Error('Canvas or RENDERER not found'));
    }

    // UI
    if (window.UI && UI.init) {
      UI.init();
      log('UI initialized');
    }

    // Save
    if (window.SAVE && SAVE.enableAutoSave) {
      SAVE.enableAutoSave(5);
    }

    // Select first sim
    if (STATE.sims.length > 0) {
      STATE.selectedSim = 0;
      if (window.UI && UI.selectSim) UI.selectSim(0);
    }
  }

  // ================================================================
  // 6. Wire Game Loop (tick handler)
  // ================================================================
  function setupGameLoop() {
    EVENTS.on('tick', function (data) {
      var delta = data.delta;

      try {
        // AI
        if (window.AI) {
          STATE.sims.forEach(function (sim) { AI.processSim(sim, delta); });
        }

        // Sim updates (needs, animation, mood)
        if (window.SIM) {
          STATE.sims.forEach(function (sim) {
            SIM.decayNeeds(sim, delta);
            SIM.updateAnimation(sim, delta);
            SIM.updateMood(sim);
          });
        }

        // World
        if (window.WORLD) {
          WORLD.checkBreakage(delta);
          WORLD.updateEnvironment(STATE.time, STATE.time.season, 'clear');
        }

        // Social
        if (window.SOCIAL) {
          SOCIAL.processSocialDecay(delta);
          if (STATE.time.totalTicks % 10 === 0) {
            SOCIAL.checkForFights();
            SOCIAL.checkForRomance();
          }
        }

        // Economy — wages at 6 PM
        if (window.ECONOMY && STATE.time.hour === 18 && STATE.time.minute < 1) {
          STATE.sims.forEach(function (sim) {
            if (sim.job) {
              var pay = ECONOMY.getDailyPay(sim);
              ECONOMY.addFunds(pay, sim.name + ' wage');
            }
          });
        }

        // Render
        if (window.RENDERER && RENDERER.render) {
          RENDERER.updateAnimations(delta);
          RENDERER.render();
        }

        // UI
        if (window.UI && UI.renderHUD) {
          UI.renderHUD();
        }

      } catch (err) {
        // Prevent one error from killing the entire game loop
        console.error('[TICK ERROR]', err);
      }
    });

    // Stats counters — S4 fix: nobody was writing these
    EVENTS.on('sim.action_complete', function(data) {
      if (data && data.action) {
        if (data.action === 'cook_meal' || data.action === 'quick_meal' || data.action === 'gourmet') STATE.stats.mealsCooked++;
        else STATE.stats.resultsProduced++;
      }
    });
    EVENTS.on('conversation.end', function() { STATE.stats.conversations++; });
    EVENTS.on('relationship.milestone', function(data) {
      if (data && data.milestone && (data.milestone.indexOf('Love') >= 0 || data.milestone.indexOf('Soulmate') >= 0)) STATE.stats.romances++;
      if (data && data.milestone && data.milestone.indexOf('Enemy') >= 0) STATE.stats.fights++;
    });
    EVENTS.on('object.broken', function() { STATE.stats.fires++; });
    EVENTS.on('sim.death', function() { STATE.stats.deaths++; });

    log('Game loop wired to tick event');
  }

  // ================================================================
  // 7. Main Init
  // ================================================================
  function initGame() {
    log('=== Starting Initialization ===');

    // Add debug overlay
    var dbg = document.createElement('div');
    dbg.id = 'debug-log';
    dbg.style.cssText = 'position:fixed;top:50px;left:10px;z-index:9999;background:rgba(0,0,0,0.8);color:#0f0;font:11px monospace;padding:10px;max-width:400px;max-height:300px;overflow:auto;border:1px solid #0f0;border-radius:4px;';
    document.body.appendChild(dbg);

    try {
      createLot();
    } catch (e) { logError('createLot', e); return; }

    try {
      buildRooms();
    } catch (e) { logError('buildRooms', e); return; }

    try {
      placeObjects();
    } catch (e) { logError('placeObjects', e); return; }

    try {
      createSims();
    } catch (e) { logError('createSims', e); return; }

    try {
      initSystems();
    } catch (e) { logError('initSystems', e); return; }

    try {
      setupGameLoop();
    } catch (e) { logError('setupGameLoop', e); return; }

    try {
      ENGINE.init();
    } catch (e) { logError('ENGINE.init', e); return; }

    log('=== Initialization Complete ===');
    EVENTS.emit('notification', { text: STATE.sims.length + ' sims moved into Sunset Studios!', type: 'good' });

    // Hide debug after 3 seconds if no errors
    setTimeout(function () {
      var d = document.getElementById('debug-log');
      if (d) d.style.display = 'none';
    }, 3000);
  }

  // Run when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
  } else {
    initGame();
  }
})();
