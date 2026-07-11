// engine.js — Core Engine for Stick-Figure Sims
// This module creates CONFIG, STATE, EVENTS, and ENGINE globals.
// It is the foundation that every other module depends on.

(function () {
  'use strict';

  /* ================================================================
     1. CONFIG — Game Constants
     ================================================================ */
  window.CONFIG = {
    TICK_RATE: 16,               // ms per frame (~60fps)
    SIM_SPEEDS: [1, 2, 3, 5],    // speed multipliers
    DEFAULT_SPEED: 2,
    GRID_SIZE: 40,               // pixels per grid cell
    LOT_WIDTH: 24,               // cells
    LOT_HEIGHT: 18,              // cells
    CANVAS_W: 960,               // rendering width
    CANVAS_H: 720,               // rendering height
    WALL_COST: 50,               // per segment
    FLOOR_COST: 30,              // per cell
  };

  /* ================================================================
     2. STATE — Global State Object
     ================================================================ */
  window.STATE = {
    paused: false,
    speed: CONFIG.DEFAULT_SPEED, // index into SIM_SPEEDS
    mode: 'live',                // "live" | "build" | "buy"

    time: {
      hour: 8,                   // 0-23
      minute: 0,                 // 0-59
      day: 1,                    // 1-28 (simplified month)
      season: 0,                 // 0=Spring, 1=Summer, 2=Autumn, 3=Winter
      dayOfWeek: 1,              // 0=Mon ... 6=Sun
      totalTicks: 0,             // total game ticks elapsed
    },

    selectedSim: null,           // sim index or null
    selectedTool: null,          // for build/buy mode

    camera: { x: 0, y: 0 },      // pan offset
    zoom: 1.0,

    sims: [],                    // array of Sim objects (populated by sim.js)
    lot: null,                   // Lot object (populated by world.js)

    funds: 20000,                // household funds
    bills: {
      dailyDue: 150,
      lastPaid: 0,
      overdue: 0,
    },

    notifications: [],           // { id, text, type, time }

    stats: {
      resultsProduced: 0,
      mealsCooked: 0,
      conversations: 0,
      fights: 0,
      romances: 0,
      fires: 0,
      deaths: 0,
    },
  };

  /* ================================================================
     3. EVENTS — EventBus
     ================================================================ */
  (function () {
    var listeners = {}; // event -> callback[]

    window.EVENTS = {
      /**
       * Subscribe to an event.
       * @param {string} event — event name
       * @param {Function} callback — handler function
       */
      on: function (event, callback) {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event].push(callback);
      },

      /**
       * Unsubscribe from an event.
       * @param {string} event — event name
       * @param {Function} callback — handler function to remove
       */
      off: function (event, callback) {
        if (!listeners[event]) return;
        var idx = listeners[event].indexOf(callback);
        if (idx !== -1) {
          listeners[event].splice(idx, 1);
        }
      },

      /**
       * Fire an event, calling all subscribed listeners.
       * @param {string} event — event name
       * @param {*} data — data payload passed to each listener
       */
      emit: function (event, data) {
        if (!listeners[event]) return;
        // Slice to avoid issues if a listener modifies the array during iteration
        var subs = listeners[event].slice();
        for (var i = 0; i < subs.length; i++) {
          subs[i](data);
        }
      },

      /**
       * Subscribe once — automatically unsubscribes after first invocation.
       * @param {string} event — event name
       * @param {Function} callback — handler function
       */
      once: function (event, callback) {
        var wrapper = function (data) {
          window.EVENTS.off(event, wrapper);
          callback(data);
        };
        window.EVENTS.on(event, wrapper);
      },
    };
  })();

  /* ================================================================
     4. ENGINE — Core Engine
     ================================================================ */
  (function () {
    var animFrameId = null;
    var lastTimestamp = 0;
    var tickCount = 0;
    var running = false;

    // Time constants
    var SEASON_DAYS = 7; // each season lasts 7 days
    var DAYS_PER_WEEK = 7;
    var HOURS_PER_DAY = 24;
    var MINUTES_PER_HOUR = 60;

    /**
     * Advance the game time by a given number of game-minutes.
     * Emits time-based events when hour, day, or season changes.
     *
     * @param {number} minutes — game-minutes to advance
     */
    function advanceTime(minutes) {
      var oldHour = STATE.time.hour;
      var oldDay = STATE.time.day;
      var oldSeason = STATE.time.season;

      // Add minutes
      STATE.time.minute += minutes;

      // Roll minutes into hours
      while (STATE.time.minute >= MINUTES_PER_HOUR) {
        STATE.time.minute -= MINUTES_PER_HOUR;
        STATE.time.hour += 1;

        // Roll hours into days
        if (STATE.time.hour >= HOURS_PER_DAY) {
          STATE.time.hour -= HOURS_PER_DAY;
          STATE.time.day += 1;
          STATE.time.dayOfWeek =
            (STATE.time.dayOfWeek + 1) % DAYS_PER_WEEK;

          // Roll days into seasons
          if (STATE.time.day > SEASON_DAYS) {
            STATE.time.day = 1;
            STATE.time.season = (STATE.time.season + 1) % 4;
          }
        }
      }

      // Emit time events for listeners
      if (STATE.time.hour !== oldHour) {
        EVENTS.emit('time.hour', { hour: STATE.time.hour });
      }
      if (STATE.time.day !== oldDay) {
        EVENTS.emit('time.day', { day: STATE.time.day });
      }
      if (STATE.time.season !== oldSeason) {
        EVENTS.emit('time.season', { season: STATE.time.season });
      }
    }

    /**
     * Main tick function — called once per animation frame.
     * Advances time and emits the tick event with delta time.
     *
     * @param {number} timestamp — high-res timestamp from requestAnimationFrame
     */
    function tick(timestamp) {
      // Calculate real delta time in ms
      var deltaMs = lastTimestamp ? timestamp - lastTimestamp : CONFIG.TICK_RATE;
      lastTimestamp = timestamp;

      // Clamp delta to avoid huge jumps after tab-inactive
      if (deltaMs > 100) deltaMs = CONFIG.TICK_RATE;

      if (!STATE.paused) {
        // Get the current speed multiplier
        var speedMultiplier = CONFIG.SIM_SPEEDS[STATE.speed] || 1;

        // Advance game time:
        // Each tick advances time by (SIM_SPEEDS[speed] * delta / 60) game-minutes.
        // At 60fps (delta=16.67ms) with speed=2, that's ~0.55 game-minutes per tick.
        var gameMinutes = (speedMultiplier * deltaMs) / 60;

        advanceTime(gameMinutes);

        // Increment total ticks
        STATE.time.totalTicks += 1;
        tickCount += 1;

        // Emit tick event with delta time (in ms)
        EVENTS.emit('tick', { delta: deltaMs, gameMinutes: gameMinutes });
      }

      // Schedule next frame
      if (running) {
        animFrameId = requestAnimationFrame(tick);
      }
    }

    /**
     * Start the game loop.
     */
    function startLoop() {
      if (running) return;
      running = true;
      lastTimestamp = 0;
      animFrameId = requestAnimationFrame(tick);
    }

    /**
     * Stop the game loop.
     */
    function stopLoop() {
      running = false;
      if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    }

    // Expose ENGINE API
    window.ENGINE = {
      /**
       * Initialize the engine — start the game loop.
       * Other modules (sim, world, etc.) should be loaded before calling init.
       */
      init: function () {
        // Reset timing state
        lastTimestamp = 0;
        tickCount = 0;

        // Start the game loop
        startLoop();

        // Emit init event so other modules can perform their own init
        EVENTS.emit('engine.init', {});
      },

      /**
       * Pause the simulation — stops time advancement and tick processing.
       */
      pause: function () {
        STATE.paused = true;
        EVENTS.emit('engine.pause', {});
      },

      /**
       * Resume the simulation.
       */
      resume: function () {
        STATE.paused = false;
        EVENTS.emit('engine.resume', {});
      },

      /**
       * Set the simulation speed.
       * @param {number} idx — index into CONFIG.SIM_SPEEDS
       */
      setSpeed: function (idx) {
        if (idx >= 0 && idx < CONFIG.SIM_SPEEDS.length) {
          var oldSpeed = STATE.speed;
          STATE.speed = idx;
          EVENTS.emit('engine.speedChange', {
            old: oldSpeed,
            new: idx,
            multiplier: CONFIG.SIM_SPEEDS[idx],
          });
        }
      },

      /**
       * Get the current speed multiplier.
       * @returns {number} current speed multiplier
       */
      getSpeed: function () {
        return CONFIG.SIM_SPEEDS[STATE.speed] || 1;
      },

      /**
       * Total elapsed ticks since engine init.
       */
      tickCount: tickCount,
    };
  })();
})();
