/**
 * renderer.js — Canvas 2D Renderer for Stick-Figure Sims
 *
 * IIFE module exposing window.RENDERER.
 * Assumes globals: ENGINE, STATE, CONFIG, EVENTS, SIM, WORLD.
 * Renders the full game world: terrain, floors, walls, objects,
 * animated stick-figure sims, lighting, weather, and UI overlays.
 */

(function() {
  "use strict";

  /* ================================================================
     Module locals
  ================================================================ */
  let canvas = null;
  let ctx = null;
  let camX = 0;
  let camY = 0;
  let zoom = 1.0;

  // Animation / particle state
  const rainDrops = [];
  const snowFlakes = [];
  let weatherInit = false;
  let pulsePhase = 0;   // for pulsing selection/target rings
  let breathePhase = 0; // for idle breathing

  // Mood colour map (synced with SPEC)
  const MOOD_COLORS = {
    elated:         "#fbbf24",
    happy:          "#4ade80",
    fine:           "#94a3b8",
    uncomfortable:  "#f5a623",
    miserable:      "#f2555a"
  };

  // Floor patterns by type
  const FLOOR_COLORS = {
    wood:   "#8b6239",
    tile:   "#b8c4c8",
    carpet: "#6b4c3b",
    grass:  "#4a8c3f"
  };

  // Terrain base colours
  const TERRAIN_COLORS = {
    grass:    "#5a9e4a",
    dirt:     "#8b7355",
    concrete: "#8899a6",
    water:    "#4a90c8"
  };

  /* ================================================================
     Public API
  ================================================================ */
  const RENDERER = {
    init,
    resize,
    render,

    // Layers
    drawTerrain,
    drawFloors,
    drawWalls,
    drawObjects,
    drawSims,
    drawEffects,
    drawUIOverlay,

    // Sim drawing
    drawSim,
    drawSimBody,
    drawSimHead,
    drawSimArms,
    drawSimLegs,
    drawSimMood,

    // Object drawing
    drawObject,
    drawObjectCondition,
    drawObjectInUse,

    // Environment
    drawLighting,
    drawWeather,
    drawTimeOfDay,

    // Selection & feedback
    drawSelection,
    drawPath,
    drawTarget,

    // Camera
    setCamera,
    setZoom,
    worldToScreen,
    screenToWorld,

    // Animation
    updateAnimations,

    // Helpers
    drawGrid,
    drawRoomLabels
  };

  window.RENDERER = RENDERER;

  /* ================================================================
     Setup
  ================================================================ */
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");

    canvas.width = CONFIG.CANVAS_W;
    canvas.height = CONFIG.CANVAS_H;

    resize();
    window.addEventListener("resize", resize);

    // Subscribe to events
    EVENTS.on("camera.pan", function(data) {
      setCamera(data.x, data.y);
    });
    EVENTS.on("mode.change", function() {
      // re-render happens automatically via the game loop
    });
    EVENTS.on("sim.action_start", function() {
      // visual feedback handled in drawUIOverlay
    });
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement || document.body;
    const pw = parent.clientWidth || window.innerWidth;
    const ph = parent.clientHeight || window.innerHeight;

    const aspect = CONFIG.CANVAS_W / CONFIG.CANVAS_H;
    let w = pw;
    let h = pw / aspect;
    if (h > ph) {
      h = ph;
      w = ph * aspect;
    }

    canvas.style.width = Math.round(w) + "px";
    canvas.style.height = Math.round(h) + "px";
  }

  /* ================================================================
     Camera
  ================================================================ */
  function setCamera(x, y) {
    camX = x;
    camY = y;
  }

  function setZoom(z) {
    zoom = Math.max(0.25, Math.min(4.0, z));
  }

  function worldToScreen(wx, wy) {
    return {
      x: (wx - camX) * zoom + CONFIG.CANVAS_W / 2,
      y: (wy - camY) * zoom + CONFIG.CANVAS_H / 2
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - CONFIG.CANVAS_W / 2) / zoom + camX,
      y: (sy - CONFIG.CANVAS_H / 2) / zoom + camY
    };
  }

  /* ================================================================
     Main render loop
  ================================================================ */
  function render() {
    if (!ctx) return;

    const W = CONFIG.CANVAS_W;
    const H = CONFIG.CANVAS_H;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Apply camera transform
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    // 1. Terrain
    drawTerrain();

    // 2. Floors
    drawFloors();

    // 3. Walls
    drawWalls();

    // 4. Objects (back / bottom layer)
    drawObjects(true);

    // 5. Sims
    drawSims();

    // 6. Objects (front / top layer)
    drawObjects(false);

    // 7. Effects (lighting, weather)
    drawEffects();

    // Restore transform for UI (screen-space)
    ctx.restore();

    // 8. UI overlay (screen coordinates)
    drawUIOverlay();
  }

  /* ================================================================
     Layer 1 — Terrain
  ================================================================ */
  function drawTerrain() {
    const lot = STATE.lot;
    if (!lot) return;

    const GS = CONFIG.GRID_SIZE;
    const totalW = lot.width * GS;
    const totalH = lot.height * GS;
    const base = TERRAIN_COLORS[lot.terrain] || TERRAIN_COLORS.grass;

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, totalW, totalH);

    // Slight texture variation — draw subtle rectangles
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#000";
    for (let y = 0; y < totalH; y += GS) {
      for (let x = 0; x < totalW; x += GS * 2) {
        const off = ((y / GS) % 2) * GS;
        ctx.fillRect(x + off, y, GS, GS);
      }
    }
    ctx.globalAlpha = 1.0;

    // Lot border
    ctx.strokeStyle = "#3a6a3a";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, totalW, totalH);
  }

  /* ================================================================
     Layer 2 — Floors
  ================================================================ */
  function drawFloors() {
    const lot = STATE.lot;
    if (!lot || !lot.floors) return;

    const GS = CONFIG.GRID_SIZE;
    const floorLevel = lot.floors[0];
    if (!floorLevel) return;

    // Draw by room
    if (floorLevel.rooms) {
      for (let i = 0; i < floorLevel.rooms.length; i++) {
        const room = floorLevel.rooms[i];
        if (!room || !room.floorCells) continue;

        const base = room.isOutside ? "#5a9e4a" : (room.color || "#4a5568");
        ctx.fillStyle = base;

        for (let j = 0; j < room.floorCells.length; j++) {
          const cell = room.floorCells[j];
          const cx = cell[0] * GS;
          const cy = cell[1] * GS;
          ctx.fillRect(cx, cy, GS, GS);

          // Floor type pattern overlay
          if (!room.isOutside) {
            drawFloorPattern(cx, cy, GS, room.floorType || "wood");
          }
        }

        // Room border outline
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        for (let j = 0; j < room.floorCells.length; j++) {
          const cell = room.floorCells[j];
          const cx = cell[0] * GS;
          const cy = cell[1] * GS;
          ctx.strokeRect(cx + 0.5, cy + 0.5, GS - 1, GS - 1);
        }
      }
    }

    // Individual floor cells (build mode)
    if (floorLevel.floors) {
      for (let i = 0; i < floorLevel.floors.length; i++) {
        const f = floorLevel.floors[i];
        if (!f) continue;
        const cx = f.x * GS;
        const cy = f.y * GS;
        const col = FLOOR_COLORS[f.type] || "#666";
        ctx.fillStyle = col;
        ctx.fillRect(cx, cy, GS, GS);
        drawFloorPattern(cx, cy, GS, f.type);
      }
    }
  }

  function drawFloorPattern(x, y, s, type) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    switch (type) {
      case "wood":
        ctx.strokeStyle = "#4a3218";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y + s / 2);
        ctx.lineTo(x + s, y + s / 2);
        ctx.stroke();
        break;
      case "tile":
        ctx.strokeStyle = "#7a888c";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
        break;
      case "carpet":
        ctx.fillStyle = "#4a3525";
        ctx.fillRect(x + 4, y + 4, 2, 2);
        ctx.fillRect(x + s - 6, y + s - 6, 2, 2);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  /* ================================================================
     Layer 3 — Walls
  ================================================================ */
  function drawWalls() {
    const lot = STATE.lot;
    if (!lot || !lot.floors) return;

    const GS = CONFIG.GRID_SIZE;
    const floorLevel = lot.floors[0];
    if (!floorLevel || !floorLevel.walls) return;

    ctx.strokeStyle = "#c8d0d8";
    ctx.lineWidth = 6;
    ctx.lineCap = "square";

    for (let i = 0; i < floorLevel.walls.length; i++) {
      const w = floorLevel.walls[i];
      if (!w) continue;

      const x1 = w[0] * GS;
      const y1 = w[1] * GS;
      const x2 = w[2] * GS;
      const y2 = w[3] * GS;

      // Wall shadow
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x1, y1 + 3);
      ctx.lineTo(x2, y2 + 3);
      ctx.stroke();

      // Wall body
      ctx.strokeStyle = "#d0d8e0";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Highlight
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1 - 2);
      ctx.lineTo(x2, y2 - 2);
      ctx.stroke();
    }

    // Per-room wall segments (alternative storage)
    if (floorLevel.rooms) {
      for (let r = 0; r < floorLevel.rooms.length; r++) {
        const room = floorLevel.rooms[r];
        if (!room || !room.wallSegments) continue;

        for (let i = 0; i < room.wallSegments.length; i++) {
          const w = room.wallSegments[i];
          if (!w) continue;

          const x1 = w[0] * GS;
          const y1 = w[1] * GS;
          const x2 = w[2] * GS;
          const y2 = w[3] * GS;

          ctx.strokeStyle = "#d0d8e0";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();

          // Highlight
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x1, y1 - 2);
          ctx.lineTo(x2, y2 - 2);
          ctx.stroke();
        }
      }
    }
  }

  /* ================================================================
     Layer 4+6 — Objects
  ================================================================ */
  function drawObjects(backLayer) {
    const lot = STATE.lot;
    if (!lot || !lot.floors) return;

    const floorLevel = lot.floors[0];
    if (!floorLevel || !floorLevel.objects) return;

    for (let i = 0; i < floorLevel.objects.length; i++) {
      const obj = floorLevel.objects[i];
      if (!obj) continue;

      // Determine layer for this object type
      const isBack = isBackLayerObject(obj.catalogKey);
      if (backLayer && !isBack) continue;
      if (!backLayer && isBack) continue;

      drawObject(obj);
    }
  }

  function isBackLayerObject(key) {
    // Objects drawn behind sims (tall ones sims walk in front of)
    const backTypes = ["fridge", "bookshelf", "shower", "lamp",
                       "plant", "painting", "mirror", "mailbox"];
    return backTypes.indexOf(key) !== -1;
  }

  function drawObject(obj) {
    if (!obj) return;
    const GS = CONFIG.GRID_SIZE;
    const cat = WORLD && WORLD.OBJECT_CATALOG ? WORLD.OBJECT_CATALOG[obj.catalogKey] : null;
    const def = cat || {};
    const size = def.size || [1, 1];

    const px = obj.x * GS;
    const py = obj.y * GS;
    const pw = size[0] * GS;
    const ph = size[1] * GS;

    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(px + 3, py + 3, pw, ph);

    // Object-specific shape
    drawObjectShape(obj, px, py, pw, ph);

    // Condition bar if damaged
    if (obj.condition < 100) {
      drawObjectCondition(obj, px, py + ph + 2, pw);
    }

    // Broken indicator
    if (obj.broken) {
      drawObjectBroken(obj, px, py, pw, ph);
    }

    // In-use indicator
    if (obj.inUse || (obj.occupants && obj.occupants.length > 0)) {
      drawObjectInUse(obj, px, py, pw);
    }
  }

  function drawObjectShape(obj, x, y, w, h) {
    const key = obj.catalogKey;
    const GS = CONFIG.GRID_SIZE;
    const def = WORLD.OBJECT_CATALOG ? WORLD.OBJECT_CATALOG[obj.catalogKey] : null;

    switch (key) {
      // ==== Sleep ====
      case "single_bed":
        // Mattress
        ctx.fillStyle = "#e8e0d0";
        roundRect(x, y, w, h, 3);
        ctx.fill();
        // Pillow
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + 2, y + 2, GS - 4, h * 0.25);
        // Blanket
        ctx.fillStyle = "#7ab8c8";
        ctx.fillRect(x + 2, y + h * 0.35, w - 4, h * 0.6);
        break;

      // ==== Hunger ====
      case "fridge":
        ctx.fillStyle = "#c8dce8";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Handle
        ctx.fillStyle = "#888";
        ctx.fillRect(x + w - 5, y + h * 0.3, 3, h * 0.15);
        ctx.fillRect(x + w - 5, y + h * 0.6, 3, h * 0.15);
        break;

      case "stove":
        ctx.fillStyle = "#d0d0d0";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Burners
        ctx.fillStyle = "#333";
        ctx.beginPath();
        ctx.arc(x + w * 0.3, y + h * 0.3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + w * 0.7, y + h * 0.3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + w * 0.3, y + h * 0.7, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + w * 0.7, y + h * 0.7, 4, 0, Math.PI * 2);
        ctx.fill();
        break;

      // ==== Bladder ====
      case "toilet":
        // Tank
        ctx.fillStyle = "#fff";
        roundRect(x, y, w, h * 0.35, 3);
        ctx.fill();
        // Bowl
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.6, w * 0.4, h * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 1;
        ctx.stroke();
        break;

      // ==== Hygiene ====
      case "shower":
        ctx.fillStyle = "#a8c8d8";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Water drops
        ctx.fillStyle = "#88c8e8";
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + w * 0.3, y + h * 0.5, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + w * 0.7, y + h * 0.5, 2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "bathtub":
        ctx.fillStyle = "#e8f0f0";
        roundRect(x, y, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 1;
        ctx.stroke();
        // Water
        ctx.fillStyle = "#88c8e8";
        ctx.fillRect(x + 4, y + h * 0.45, w - 8, h * 0.4);
        break;

      case "sink_bathroom":
        ctx.fillStyle = "#fff";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Basin
        ctx.fillStyle = "#e0e8e8";
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h * 0.55, w * 0.3, 0, Math.PI * 2);
        ctx.fill();
        // Faucet
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + h * 0.3);
        ctx.quadraticCurveTo(x + w / 2, y + h * 0.15, x + w * 0.6, y + h * 0.25);
        ctx.stroke();
        break;

      // ==== Comfort / Social ====
      case "sofa":
        ctx.fillStyle = "#8b5a3c";
        roundRect(x, y, w, h, 4);
        ctx.fill();
        // Cushion lines
        ctx.strokeStyle = "#6b3a1c";
        ctx.lineWidth = 1;
        for (let i = 1; i < (def.size ? def.size[0] : 3); i++) {
          ctx.beginPath();
          ctx.moveTo(x + (w / (def.size ? def.size[0] : 3)) * i, y + 3);
          ctx.lineTo(x + (w / (def.size ? def.size[0] : 3)) * i, y + h - 3);
          ctx.stroke();
        }
        break;

      case "dining_table":
        ctx.fillStyle = "#a07850";
        roundRect(x, y, w, h * 0.5, 2);
        ctx.fill();
        // Legs
        ctx.fillStyle = "#806040";
        ctx.fillRect(x + 3, y + h * 0.5, 4, h * 0.5);
        ctx.fillRect(x + w - 7, y + h * 0.5, 4, h * 0.5);
        break;

      // ==== Fun ====
      case "tv":
        // Stand
        ctx.fillStyle = "#333";
        ctx.fillRect(x + w * 0.1, y + h * 0.7, w * 0.8, h * 0.3);
        // Screen
        ctx.fillStyle = "#1a1a2e";
        roundRect(x + 2, y + 2, w - 4, h * 0.7, 2);
        ctx.fill();
        // Screen glow when on
        if (obj.inUse) {
          ctx.fillStyle = "rgba(100,150,255,0.4)";
          ctx.fillRect(x + 4, y + 4, w - 8, h * 0.6);
        }
        break;

      case "computer":
        // Desk
        ctx.fillStyle = "#8b7355";
        ctx.fillRect(x, y + h * 0.4, w, h * 0.6);
        // Monitor
        ctx.fillStyle = "#222";
        ctx.fillRect(x + 3, y + 2, w - 6, h * 0.3);
        // Screen
        ctx.fillStyle = obj.inUse ? "#4a90c8" : "#111";
        ctx.fillRect(x + 5, y + 4, w - 10, h * 0.24);
        break;

      case "chess_table":
        // Table
        ctx.fillStyle = "#8b6b4a";
        roundRect(x, y, w, h, 3);
        ctx.fill();
        // Chess squares
        ctx.fillStyle = "#e8dcc8";
        ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        ctx.strokeStyle = "#5a4a3a";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
        break;

      case "guitar":
        // Stand
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y + h);
        ctx.lineTo(x + w / 2, y + h * 0.4);
        ctx.stroke();
        // Guitar body
        ctx.fillStyle = "#c85a28";
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.4, w * 0.35, h * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        // Neck
        ctx.fillStyle = "#5a3a1a";
        ctx.fillRect(x + w / 2 - 2, y + h * 0.15, 4, h * 0.25);
        break;

      case "bookshelf":
        ctx.fillStyle = "#8b6b4a";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Shelves & books
        ctx.strokeStyle = "#6b4b2a";
        ctx.lineWidth = 1;
        for (let row = 1; row <= 3; row++) {
          const sy = y + (h / 4) * row;
          ctx.beginPath();
          ctx.moveTo(x + 2, sy);
          ctx.lineTo(x + w - 2, sy);
          ctx.stroke();
          // Books
          ctx.fillStyle = ["#8b3a3a", "#3a5a8b", "#3a8b5a", "#8b7a3a"][row % 4];
          for (let b = 0; b < 4; b++) {
            ctx.fillRect(x + 4 + b * (w / 4 - 1), sy - h / 5 + 2, w / 5, h / 5 - 3);
          }
        }
        break;

      case "mirror":
        ctx.fillStyle = "#c8d8e8";
        roundRect(x + 2, y + 2, w - 4, h - 4, 2);
        ctx.fill();
        // Mirror surface
        ctx.fillStyle = "#e8f0f8";
        ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        break;

      // ==== Athletic ====
      case "treadmill":
        ctx.fillStyle = "#888";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        // Belt
        ctx.fillStyle = "#333";
        ctx.fillRect(x + 2, y + h * 0.45, w - 4, h * 0.35);
        // Console
        ctx.fillStyle = "#444";
        ctx.fillRect(x + 2, y + 2, w - 4, h * 0.3);
        break;

      // ==== Environment ====
      case "plant":
        // Pot
        ctx.fillStyle = "#c8844a";
        ctx.beginPath();
        ctx.moveTo(x + w * 0.2, y + h);
        ctx.lineTo(x + w * 0.25, y + h * 0.5);
        ctx.lineTo(x + w * 0.75, y + h * 0.5);
        ctx.lineTo(x + w * 0.8, y + h);
        ctx.fill();
        // Leaves
        ctx.fillStyle = "#4a9e3a";
        ctx.beginPath();
        ctx.arc(x + w * 0.35, y + h * 0.35, w * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#5aae4a";
        ctx.beginPath();
        ctx.arc(x + w * 0.6, y + h * 0.3, w * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a8e2a";
        ctx.beginPath();
        ctx.arc(x + w * 0.5, y + h * 0.2, w * 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "painting":
        // Frame
        ctx.fillStyle = "#8b6b3a";
        ctx.fillRect(x, y, w, h);
        // Canvas
        ctx.fillStyle = "#e8e0d0";
        ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
        // Abstract art
        ctx.fillStyle = "#c85a3a";
        ctx.beginPath();
        ctx.arc(x + w * 0.4, y + h * 0.4, w * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a8bc8";
        ctx.fillRect(x + w * 0.5, y + h * 0.5, w * 0.25, h * 0.25);
        break;

      case "lamp":
        // Base
        ctx.fillStyle = "#555";
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h, w * 0.3, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // Shade
        ctx.fillStyle = obj.lightOn ? "#f5e6a0" : "#d0c8a0";
        ctx.beginPath();
        ctx.moveTo(x + w * 0.15, y + h * 0.6);
        ctx.lineTo(x + w * 0.85, y + h * 0.6);
        ctx.lineTo(x + w * 0.7, y + h * 0.15);
        ctx.lineTo(x + w * 0.3, y + h * 0.15);
        ctx.closePath();
        ctx.fill();
        // Glow
        if (obj.lightOn) {
          ctx.fillStyle = "rgba(255,230,100,0.25)";
          ctx.beginPath();
          ctx.arc(x + w / 2, y + h / 2, GS * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      // ==== Misc ====
      case "trash_can":
        ctx.fillStyle = "#666";
        roundRect(x + 2, y + 4, w - 4, h - 4, 2);
        ctx.fill();
        // Lid
        ctx.fillStyle = "#555";
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + 5, w / 2 - 2, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "mailbox":
        // Post
        ctx.fillStyle = "#8b7355";
        ctx.fillRect(x + w / 2 - 2, y + h * 0.3, 4, h * 0.7);
        // Box
        ctx.fillStyle = "#3a5a8b";
        roundRect(x + 2, y + 2, w - 4, h * 0.4, 3);
        ctx.fill();
        break;

      // ==== Fallback ====
      default:
        ctx.fillStyle = "#888";
        roundRect(x, y, w, h, 2);
        ctx.fill();
        ctx.fillStyle = "#666";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(def.name || key || "?", x + w / 2, y + h / 2 + 3);
        break;
    }
  }

  function drawObjectCondition(obj, x, y, w) {
    const barW = w;
    const barH = 4;
    const pct = (obj.condition || 100) / 100;

    ctx.fillStyle = "#333";
    ctx.fillRect(x, y, barW, barH);

    let col = "#4ade80";
    if (pct < 0.3) col = "#f2555a";
    else if (pct < 0.6) col = "#f5a623";

    ctx.fillStyle = col;
    ctx.fillRect(x, y, barW * pct, barH);
  }

  function drawObjectBroken(obj, x, y, w, h) {
    // Red X overlay
    ctx.strokeStyle = "rgba(242,85,90,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + w - 4, y + h - 4);
    ctx.moveTo(x + w - 4, y + 4);
    ctx.lineTo(x + 4, y + h - 4);
    ctx.stroke();

    // Label
    ctx.fillStyle = "#f2555a";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("BROKEN", x + w / 2, y + h / 2 - 6);
  }

  function drawObjectInUse(obj, x, y, w) {
    // Small green dot
    ctx.fillStyle = "#4ade80";
    ctx.beginPath();
    ctx.arc(x + w / 2, y - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    // White centre
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + w / 2, y - 5, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ================================================================
     Layer 5 — Sims (animated stick figures)
  ================================================================ */
  function drawSims() {
    if (!STATE.sims) return;

    // Sort by Y for pseudo-depth
    const sorted = STATE.sims.slice().sort(function(a, b) {
      return (a && b) ? a.y - b.y : 0;
    });

    for (let i = 0; i < sorted.length; i++) {
      const sim = sorted[i];
      if (!sim) continue;
      drawSim(sim);
    }
  }

  function drawSim(sim) {
    if (!sim) return;

    ctx.save();

    // If sleeping, draw horizontally
    if (sim.state === "sleeping") {
      drawSimSleeping(sim);
      ctx.restore();
      drawSimMood(sim);
      return;
    }

    const GS = CONFIG.GRID_SIZE;
    const sx = sim.x;
    const sy = sim.y;

    // Idle breathing scale
    let breatheScale = 1.0;
    if (sim.state === "idle") {
      breatheScale = 1 + Math.sin(breathePhase + sim.id * 2) * 0.015;
    }

    ctx.translate(sx, sy);
    ctx.scale(sim.facing === "left" ? -1 : 1, breatheScale);

    // Flip Y so +Y is down (Canvas default)
    // All drawing uses negative Y for body parts going upward

    const frame = sim.animFrame || 0;

    // Held object indicator
    if (sim.heldObject) {
      ctx.fillStyle = "#f5a623";
      ctx.beginPath();
      ctx.arc(10, -ARM_LEN - TORSO_LEN + 4, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw body parts (back to front)
    drawSimLegs(sim, frame);
    drawSimBody(sim, frame);
    drawSimArms(sim, frame);
    drawSimHead(sim);

    ctx.restore();

    // Mood indicator above head
    drawSimMood(sim);
  }

  // Body proportions (synced with SPEC)
  const HEAD_R = 8;
  const TORSO_LEN = 28;
  const ARM_LEN = 22;
  const LEG_LEN = 30;

  function drawSimLegs(sim, frame) {
    const swing = (frame < 4) ? frame * 3 : (7 - frame) * 3;
    const rad = swing * Math.PI / 180;

    ctx.strokeStyle = sim.bodyColor || "#e6edf5";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";

    // Hip position
    const hipY = -LEG_LEN * 0.5;

    // Left leg
    ctx.beginPath();
    ctx.moveTo(-3, hipY);
    ctx.lineTo(-4 + Math.sin(-rad) * 10, hipY + LEG_LEN * 0.5);
    ctx.lineTo(-5 + Math.sin(-rad) * 14, 0);
    ctx.stroke();

    // Right leg (opposite swing)
    ctx.beginPath();
    ctx.moveTo(3, hipY);
    ctx.lineTo(4 + Math.sin(rad) * 10, hipY + LEG_LEN * 0.5);
    ctx.lineTo(5 + Math.sin(rad) * 14, 0);
    ctx.stroke();
  }

  function drawSimBody(sim, frame) {
    // Torso — vertical line from hip to shoulder
    const hipY = -LEG_LEN * 0.5;
    const shoulderY = hipY - TORSO_LEN;

    ctx.strokeStyle = sim.bodyColor || "#e6edf5";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, shoulderY);
    ctx.stroke();
  }

  function drawSimArms(sim, frame) {
    const swing = (frame < 4) ? frame * 3 : (7 - frame) * 3;
    const rad = swing * Math.PI / 180;

    const hipY = -LEG_LEN * 0.5;
    const shoulderY = hipY - TORSO_LEN;

    ctx.strokeStyle = sim.bodyColor || "#e6edf5";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    // Arms swing opposite to legs
    // Left arm
    ctx.beginPath();
    ctx.moveTo(-2, shoulderY + 2);
    ctx.lineTo(-6 + Math.sin(rad) * 8, shoulderY + ARM_LEN * 0.5);
    ctx.lineTo(-8 + Math.sin(rad) * 12, shoulderY + ARM_LEN);
    ctx.stroke();

    // Right arm
    ctx.beginPath();
    ctx.moveTo(2, shoulderY + 2);
    ctx.lineTo(6 + Math.sin(-rad) * 8, shoulderY + ARM_LEN * 0.5);
    ctx.lineTo(8 + Math.sin(-rad) * 12, shoulderY + ARM_LEN);
    ctx.stroke();

    // Working animation overrides
    if (sim.state === "working" || sim.state === "eating") {
      // Arms forward / animated
      const workSwing = Math.sin(Date.now() / 200 + sim.id) * 8;
      ctx.beginPath();
      ctx.moveTo(-2, shoulderY + 2);
      ctx.lineTo(-6, shoulderY + ARM_LEN * 0.5 - workSwing);
      ctx.lineTo(-4, shoulderY + ARM_LEN + 4);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(2, shoulderY + 2);
      ctx.lineTo(6, shoulderY + ARM_LEN * 0.5 + workSwing);
      ctx.lineTo(4, shoulderY + ARM_LEN + 4);
      ctx.stroke();
    }
  }

  function drawSimHead(sim) {
    const hipY = -LEG_LEN * 0.5;
    const shoulderY = hipY - TORSO_LEN;
    const headY = shoulderY - HEAD_R - 2;

    // Neck
    ctx.strokeStyle = sim.bodyColor || "#e6edf5";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, shoulderY);
    ctx.lineTo(0, headY + HEAD_R);
    ctx.stroke();

    // Head circle
    ctx.fillStyle = sim.bodyColor || "#e6edf5";
    ctx.beginPath();
    ctx.arc(0, headY, HEAD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Hair
    ctx.fillStyle = sim.hairColor || "#d4a574";
    ctx.beginPath();
    ctx.arc(0, headY - 1, HEAD_R + 1, Math.PI, Math.PI * 2);
    ctx.fill();

    // Face based on mood
    const mood = sim.mood || "fine";
    const eyeY = headY - 1;

    // Eyes
    ctx.fillStyle = "#1a1a2e";
    ctx.beginPath();
    ctx.arc(-3, eyeY, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, eyeY, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Expression (mouth)
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 1.2;
    ctx.beginPath();

    switch (mood) {
      case "elated":
        // Big smile
        ctx.arc(0, eyeY + 3, 4, 0.1, Math.PI - 0.1);
        ctx.stroke();
        // Eye shine
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(-3.5, eyeY - 0.5, 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(2.5, eyeY - 0.5, 0.6, 0, Math.PI * 2);
        ctx.fill();
        break;

      case "happy":
        // Small smile
        ctx.arc(0, eyeY + 2, 3, 0.2, Math.PI - 0.2);
        ctx.stroke();
        break;

      case "fine":
        // Neutral
        ctx.moveTo(-2, eyeY + 4);
        ctx.lineTo(2, eyeY + 4);
        ctx.stroke();
        break;

      case "uncomfortable":
        // Slight frown
        ctx.arc(0, eyeY + 6, 3, Math.PI + 0.2, -0.2);
        ctx.stroke();
        break;

      case "miserable":
        // Big frown
        ctx.arc(0, eyeY + 7, 4, Math.PI + 0.1, -0.1);
        ctx.stroke();
        // Tears
        ctx.fillStyle = "#60a5fa";
        ctx.beginPath();
        ctx.arc(-4, eyeY + 2, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(4, eyeY + 2, 1, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  function drawSimSleeping(sim) {
    const sx = sim.x;
    const sy = sim.y;

    ctx.translate(sx, sy);

    // Sleeping sim drawn horizontally
    const bodyColor = sim.bodyColor || "#e6edf5";

    // Body (horizontal)
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(20, 0);
    ctx.stroke();

    // Head
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(-22, 0, HEAD_R, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = sim.hairColor || "#d4a574";
    ctx.beginPath();
    ctx.arc(-22, -1, HEAD_R + 1, Math.PI, Math.PI * 2);
    ctx.fill();

    // Closed eyes
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-25, -2);
    ctx.lineTo(-23, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-21, -2);
    ctx.lineTo(-19, -2);
    ctx.stroke();

    // Arms
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-8, 6);
    ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(8, 6);
    ctx.lineTo(0, 6);
    ctx.stroke();

    // Zzz
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "left";
    const zOffset = Math.sin(Date.now() / 800 + sim.id) * 3;
    ctx.fillText("z", 24, -8 + zOffset);
    ctx.font = "bold 7px sans-serif";
    ctx.fillText("z", 30, -14 + zOffset);
  }

  function drawSimMood(sim) {
    const sx = sim.x;
    const sy = sim.y;

    const mood = sim.mood || "fine";
    const color = MOOD_COLORS[mood] || "#94a3b8";

    // Small mood dot above head
    const screenPos = worldToScreen(sx, sy);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset to screen coords

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y - 55 * zoom, 3 * zoom, 0, Math.PI * 2);
    ctx.fill();

    // Selected sim gets a larger indicator with mood text
    if (STATE.selectedSim === sim.id) {
      ctx.fillStyle = color;
      ctx.font = Math.round(10 * zoom) + "px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(mood, screenPos.x, screenPos.y - 62 * zoom);
    }

    ctx.restore();
  }

  /* ================================================================
     Layer 7 — Effects
  ================================================================ */
  function drawEffects() {
    drawLighting();
    drawWeather();
    drawTimeOfDay();
  }

  function drawLighting() {
    const lot = STATE.lot;
    if (!lot || !lot.floors) return;

    const floorLevel = lot.floors[0];
    if (!floorLevel || !floorLevel.objects) return;

    const GS = CONFIG.GRID_SIZE;

    // Draw light circles for turned-on lamps
    for (let i = 0; i < floorLevel.objects.length; i++) {
      const obj = floorLevel.objects[i];
      if (!obj || obj.catalogKey !== "lamp" || !obj.lightOn) continue;

      const px = (obj.x + 0.5) * GS;
      const py = (obj.y + 0.5) * GS;
      const radius = (obj.lightRadius || 5) * GS;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
      grad.addColorStop(0, "rgba(255,220,100,0.25)");
      grad.addColorStop(0.5, "rgba(255,200,80,0.1)");
      grad.addColorStop(1, "rgba(255,180,60,0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawWeather() {
    const lot = STATE.lot;
    if (!lot) return;

    const weather = lot.weather || "clear";
    if (weather === "clear") return;

    const W = CONFIG.CANVAS_W;
    const H = CONFIG.CANVAS_H;
    const GS = CONFIG.GRID_SIZE;

    // Initialise particles on first call
    if (!weatherInit) {
      initWeather(weather);
      weatherInit = true;
    }

    if (weather === "rain" || weather === "storm") {
      ctx.strokeStyle = weather === "storm" ? "rgba(180,200,220,0.6)" : "rgba(160,180,210,0.5)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < rainDrops.length; i++) {
        const d = rainDrops[i];
        // Transform to world space for camera
        ctx.beginPath();
        const s1 = worldToScreen(d.x, d.y);
        const s2 = worldToScreen(d.x - 2, d.y + d.len);
        ctx.moveTo(s1.x - camX * zoom + CONFIG.CANVAS_W / 2 - CONFIG.CANVAS_W / 2,
                   s1.y - camY * zoom + CONFIG.CANVAS_H / 2 - CONFIG.CANVAS_H / 2);
        ctx.lineTo(s2.x - camX * zoom + CONFIG.CANVAS_W / 2 - CONFIG.CANVAS_W / 2,
                   s2.y - camY * zoom + CONFIG.CANVAS_H / 2 - CONFIG.CANVAS_H / 2);
        ctx.stroke();

        d.y += d.speed;
        d.x -= 0.5;
        if (d.y > lot.height * GS) {
          d.y = -d.len;
          d.x = Math.random() * lot.width * GS;
        }
      }

      // Storm gets lightning flashes
      if (weather === "storm" && Math.random() < 0.003) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(0, 0, lot.width * GS, lot.height * GS);
      }
    }

    if (weather === "snow") {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < snowFlakes.length; i++) {
        const f = snowFlakes[i];
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();

        f.y += f.speed;
        f.x += Math.sin(f.y * 0.02 + f.phase) * 0.5;
        if (f.y > lot.height * GS) {
          f.y = -5;
          f.x = Math.random() * lot.width * GS;
        }
      }
    }
  }

  function initWeather(type) {
    rainDrops.length = 0;
    snowFlakes.length = 0;

    const lot = STATE.lot;
    const GS = CONFIG.GRID_SIZE;
    const w = lot ? lot.width * GS : 960;

    if (type === "rain" || type === "storm") {
      const count = type === "storm" ? 300 : 150;
      for (let i = 0; i < count; i++) {
        rainDrops.push({
          x: Math.random() * w,
          y: Math.random() * (lot ? lot.height * GS : 720),
          len: 8 + Math.random() * 8,
          speed: 6 + Math.random() * 4
        });
      }
    }

    if (type === "snow") {
      for (let i = 0; i < 150; i++) {
        snowFlakes.push({
          x: Math.random() * w,
          y: Math.random() * (lot ? lot.height * GS : 720),
          r: 1.5 + Math.random() * 2,
          speed: 0.5 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2
        });
      }
    }
  }

  function drawTimeOfDay() {
    const hour = STATE.time ? STATE.time.hour : 12;
    const lot = STATE.lot;
    if (!lot) return;

    const GS = CONFIG.GRID_SIZE;
    const totalW = lot.width * GS;
    const totalH = lot.height * GS;

    let overlayColor = null;
    let alpha = 0;

    if (hour >= 5 && hour < 7) {
      // Dawn — warm orange
      overlayColor = "255,180,80";
      alpha = 0.08 + (7 - hour) * 0.03;
    } else if (hour >= 7 && hour < 17) {
      // Day — no overlay
      return;
    } else if (hour >= 17 && hour < 19) {
      // Dusk — warm orange/purple
      overlayColor = "180,120,180";
      alpha = (hour - 17) * 0.06;
    } else if (hour >= 19 || hour < 5) {
      // Night — dark blue
      overlayColor = "20,30,60";
      if (hour >= 19) {
        alpha = 0.2 + (hour - 19) * 0.04;
      } else {
        alpha = 0.36 - hour * 0.04;
      }
      alpha = Math.min(0.4, alpha);
    }

    if (overlayColor) {
      ctx.fillStyle = "rgba(" + overlayColor + "," + alpha + ")";
      ctx.fillRect(0, 0, totalW, totalH);
    }
  }

  /* ================================================================
     Layer 8 — UI Overlay (screen-space)
  ================================================================ */
  function drawUIOverlay() {
    // Selection highlight
    drawSelection();

    // Path lines and target markers for sims
    if (STATE.sims) {
      for (let i = 0; i < STATE.sims.length; i++) {
        const sim = STATE.sims[i];
        if (!sim) continue;
        if (sim.state === "walking" && sim.path && sim.path.length > 0) {
          drawPath(sim);
          drawTarget(sim);
        } else if (sim.targetX !== undefined && sim.targetY !== undefined &&
                   (sim.state === "walking" || sim.targetX !== sim.x || sim.targetY !== sim.y)) {
          drawTarget(sim);
        }
      }
    }

    // Build/Buy mode grid
    if (STATE.mode === "build" || STATE.mode === "buy") {
      drawGrid();
      drawRoomLabels();
    }
  }

  function drawSelection() {
    if (STATE.selectedSim !== null && STATE.selectedSim !== undefined) {
      const sim = SIM ? SIM.getSim(STATE.selectedSim) : null;
      if (sim) {
        const sp = worldToScreen(sim.x, sim.y);
        const s = pulsePhase;
        const pulse = 1 + Math.sin(s * 4) * 0.15;
        const r = 18 * zoom * pulse;

        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (STATE.selectedTool) {
      // Could draw tool-specific selection here
    }
  }

  function drawPath(sim) {
    if (!sim.path || sim.path.length === 0) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // screen coords

    ctx.strokeStyle = "rgba(0,229,255,0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();

    const start = worldToScreen(sim.x, sim.y);
    ctx.moveTo(start.x, start.y);

    for (let i = 0; i < sim.path.length; i++) {
      const p = sim.path[i];
      const pt = worldToScreen(p.x, p.y);
      ctx.lineTo(pt.x, pt.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTarget(sim) {
    const tx = sim.targetX !== undefined ? sim.targetX : sim.x;
    const ty = sim.targetY !== undefined ? sim.targetY : sim.y;

    const sp = worldToScreen(tx, ty);
    const pulse = 1 + Math.sin(pulsePhase * 5) * 0.2;
    const r = 8 * zoom * pulse;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // screen coords

    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair
    const cl = 5 * zoom;
    ctx.beginPath();
    ctx.moveTo(sp.x - cl, sp.y);
    ctx.lineTo(sp.x + cl, sp.y);
    ctx.moveTo(sp.x, sp.y - cl);
    ctx.lineTo(sp.x, sp.y + cl);
    ctx.stroke();

    ctx.restore();
  }

  /* ================================================================
     Animation updates
  ================================================================ */
  function updateAnimations(delta) {
    const dt = delta || 16;
    pulsePhase += dt * 0.003;
    breathePhase += dt * 0.002;

    // Update sim animation frames
    if (STATE.sims) {
      for (let i = 0; i < STATE.sims.length; i++) {
        const sim = STATE.sims[i];
        if (!sim) continue;

        if (SIM && SIM.updateAnimation) {
          SIM.updateAnimation(sim, dt);
        } else {
          // Fallback: advance walk cycle
          if (sim.state === "walking") {
            sim.animTimer = (sim.animTimer || 0) + dt;
            if (sim.animTimer > 80) {
              sim.animTimer = 0;
              sim.animFrame = ((sim.animFrame || 0) + 1) % 8;
            }
          } else if (sim.state === "idle") {
            sim.animFrame = 0;
            sim.animTimer = 0;
          }
        }
      }
    }

    // Reset weather init when weather changes
    const currentWeather = STATE.lot ? STATE.lot.weather : "clear";
    if (weatherInit && currentWeather === "clear") {
      weatherInit = false;
    }
  }

  /* ================================================================
     Helpers
  ================================================================ */
  function drawGrid() {
    const lot = STATE.lot;
    if (!lot) return;

    const GS = CONFIG.GRID_SIZE;
    const totalW = lot.width * GS;
    const totalH = lot.height * GS;

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= totalW; x += GS) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalH);
      ctx.stroke();
    }
    for (let y = 0; y <= totalH; y += GS) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalW, y);
      ctx.stroke();
    }
  }

  function drawRoomLabels() {
    const lot = STATE.lot;
    if (!lot || !lot.floors) return;

    const floorLevel = lot.floors[0];
    if (!floorLevel || !floorLevel.rooms) return;

    const GS = CONFIG.GRID_SIZE;

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";

    for (let i = 0; i < floorLevel.rooms.length; i++) {
      const room = floorLevel.rooms[i];
      if (!room || !room.floorCells || room.floorCells.length === 0) continue;

      // Compute centroid
      let cx = 0, cy = 0;
      for (let j = 0; j < room.floorCells.length; j++) {
        cx += room.floorCells[j][0];
        cy += room.floorCells[j][1];
      }
      cx = (cx / room.floorCells.length + 0.5) * GS;
      cy = (cy / room.floorCells.length + 0.5) * GS;

      ctx.fillText(room.name || ("Room " + room.id), cx, cy);
    }
  }

  /* ================================================================
     Utility — rounded rectangle
  ================================================================ */
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

})();
