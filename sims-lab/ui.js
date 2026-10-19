// ui.js — User Interface Module
// Handles all DOM-based UI: HUD panels, controls, notifications, event log
// Depends on: ENGINE, STATE, CONFIG, EVENTS, SIM, WORLD, SOCIAL, ECONOMY (globals)

(function() {
  "use strict";

  // ====== Internal DOM references ======
  let els = {};
  let currentPanel = null;
  let currentMode = "live";
  let activeBuildTool = null;
  let notificationCount = 0;
  let eventLogEntries = [];
  let fundsDisplayValue = null;
  let fundsAnimationId = null;
  let placementPreviewActive = false;
  let placementObjectKey = null;
  let panelDirty = {}; // track which panels need re-render

  // ====== Color constants from spec ======
  const NEED_COLORS = {
    hunger:      "#f5a623",
    energy:      "#4ade80",
    bladder:     "#3dd6d0",
    hygiene:     "#60a5fa",
    social:      "#e879f9",
    fun:         "#f472b6",
    comfort:     "#a78bfa",
    environment: "#34d399"
  };

  const MOOD_COLORS = {
    elated:         "#fbbf24",
    happy:          "#4ade80",
    fine:           "#94a3b8",
    uncomfortable:  "#f5a623",
    miserable:      "#f2555a"
  };

  const SEASON_ICONS = ["\u2600", "\u2600", "\u{1f342}", "\u2744"]; // Spring Sun, Summer Sun, Autumn Leaf, Winter Snow
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const SEASON_NAMES = ["Spring", "Summer", "Autumn", "Winter"];

  const NOTIFICATION_COLORS = {
    info:    "#60a5fa",
    warning: "#f5a623",
    good:    "#4ade80",
    bad:     "#f2555a"
  };

  const EVENT_LOG_COLORS = {
    info:    "#94a3b8",
    warning: "#f5a623",
    good:    "#4ade80",
    bad:     "#f2555a",
    social:  "#e879f9",
    career:  "#60a5fa"
  };

  // ====== Helper: create DOM element ======
  function create(tag, cls, parent, attrs) {
    const el = document.createElement(tag);
    if (cls) {
      if (Array.isArray(cls)) cls.forEach(function(c) { el.classList.add(c); });
      else if (cls.indexOf(' ') >= 0) cls.split(' ').forEach(function(c) { if(c) el.classList.add(c); });
      else el.classList.add(cls);
    }
    if (attrs) {
      for (var k in attrs) {
        if (k === "text") el.textContent = attrs[k];
        else if (k === "html") el.innerHTML = attrs[k];
        else el.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  // ====== Helper: get or create element by id ======
  function getOrCreate(id, tag, parent, cls) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement(tag || "div");
      el.id = id;
      if (cls) el.classList.add(cls);
      (parent || document.body).appendChild(el);
    }
    return el;
  }

  // ====== Helper: pad number ======
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // ====== Helper: format funds ======
  function formatFunds(amount) {
    return "\u00a7" + amount.toLocaleString();
  }

  // ====== Helper: get relationship label/color ======
  function getRelationshipLevelInfo(value) {
    if (value <= -50) return { label: "Enemy", color: "#f2555a" };
    if (value <= -20) return { label: "Disliked", color: "#f5a623" };
    if (value <= 20)  return { label: "Acquaintance", color: "#94a3b8" };
    if (value <= 50)  return { label: "Friend", color: "#4ade80" };
    if (value <= 80)  return { label: "Good Friend", color: "#34d399" };
    return { label: "Best Friend", color: "#3dd6d0" };
  }

  function getRomanceLevelInfo(value) {
    if (value <= -30) return { label: "Heartbroken", color: "#f2555a" };
    if (value <= 0)   return { label: "Stranger", color: "#94a3b8" };
    if (value <= 30)  return { label: "Curious", color: "#f5a623" };
    if (value <= 60)  return { label: "Romantic", color: "#f472b6" };
    if (value <= 85)  return { label: "Love", color: "#e879f9" };
    return { label: "Soulmate", color: "#fb7185" };
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Find or create main UI container
    els.app = getOrCreate("game-app", "div", document.body, "game-app");

    // --- HUD Container ---
    els.hud = getOrCreate("ui-hud", "div", els.app, "ui-hud");

    // Top bar: mode switchers + time + funds
    els.hudTop = create("div", "hud-top", els.hud);

    // Mode buttons
    els.modeGroup = create("div", "hud-mode-group", els.hudTop);
    els.modeLiveBtn = create("button", ["hud-mode-btn", "active"], els.modeGroup, { text: "Live", tabindex: "1" });
    els.modeBuildBtn = create("button", ["hud-mode-btn"], els.modeGroup, { text: "Build", tabindex: "1" });
    els.modeBuyBtn = create("button", ["hud-mode-btn"], els.modeGroup, { text: "Buy", tabindex: "1" });

    els.modeLiveBtn.addEventListener("click", function() { setMode("live"); });
    els.modeBuildBtn.addEventListener("click", function() { setMode("build"); });
    els.modeBuyBtn.addEventListener("click", function() { setMode("buy"); });

    // Time display
    els.timeDisplay = create("div", "hud-time-display", els.hudTop);
    els.clockDisplay = create("span", "hud-clock", els.timeDisplay, { text: "08:00" });
    els.dayDisplay = create("span", "hud-day", els.timeDisplay, { text: "Mon Day 1" });
    els.seasonDisplay = create("span", "hud-season", els.timeDisplay, { text: SEASON_ICONS[0] });

    // Funds display
    els.fundsDisplay = create("div", "hud-funds", els.hudTop, { text: "\u00a720,000" });

    // Settings button
    els.settingsBtn = create("button", "hud-settings-btn", els.hudTop, { text: "\u2699", title: "Settings", tabindex: "1" });
    els.settingsBtn.addEventListener("click", showSettings);

    // --- Middle: Sim info + Need bars ---
    els.hudMiddle = create("div", "hud-middle", els.hud);

    // Sim info section
    els.simInfo = create("div", "hud-sim-info", els.hudMiddle);
    els.simName = create("div", "hud-sim-name", els.simInfo, { text: "No Sim Selected" });
    els.simDetails = create("div", "hud-sim-details", els.simInfo, { text: "" });
    els.simMood = create("div", "hud-sim-mood", els.simInfo, { text: "" });
    els.simTask = create("div", "hud-sim-task", els.simInfo, { text: "" });

    // Need bars container
    els.needBars = create("div", "hud-need-bars", els.hudMiddle);
    var needKeys = Object.keys(NEED_COLORS);
    for (var i = 0; i < needKeys.length; i++) {
      var needKey = needKeys[i];
      var needEl = create("div", "need-bar-container", els.needBars);
      needEl.dataset.need = needKey;
      create("div", "need-bar-label", needEl, {
        text: needKey.charAt(0).toUpperCase() + needKey.slice(1)
      });
      var track = create("div", "need-bar-track", needEl);
      var fill = create("div", "need-bar-fill", track);
      fill.style.backgroundColor = NEED_COLORS[needKey];
      create("div", "need-bar-value", needEl, { text: "--" });
    }

    // --- Bottom: Speed controls + Panel buttons ---
    els.hudBottom = create("div", "hud-bottom", els.hud);

    // Speed controls
    els.speedControls = create("div", "hud-speed-controls", els.hudBottom);
    var speeds = [1, 2, 3, 5];
    els.speedButtons = [];
    for (var s = 0; s < speeds.length; s++) {
      (function(spd) {
        var btn = create("button", ["speed-btn"], els.speedControls, {
          text: spd + "x",
          tabindex: "1"
        });
        btn.dataset.speed = spd;
        btn.addEventListener("click", function() {
          if (window.ENGINE && ENGINE.setSpeed) {
            ENGINE.setSpeed(speeds.indexOf(spd));
          }
        });
        els.speedButtons.push(btn);
      })(speeds[s]);
    }

    // Panel toggle buttons
    els.panelButtons = create("div", "hud-panel-buttons", els.hudBottom);
    var panelTypes = ["needs", "skills", "relationships", "career"];
    var panelIcons = ["\u2764", "\u2b50", "\u{1f465}", "\u{1f4bc}"]; // heart, star, people, briefcase
    for (var p = 0; p < panelTypes.length; p++) {
      (function(pt, icon) {
        var btn = create("button", ["panel-toggle-btn"], els.panelButtons, {
          text: icon + " " + pt.charAt(0).toUpperCase() + pt.slice(1),
          tabindex: "1"
        });
        btn.dataset.panel = pt;
        btn.addEventListener("click", function() { togglePanel(pt); });
      })(panelTypes[p], panelIcons[p]);
    }

    // Event log toggle
    els.logToggleBtn = create("button", ["panel-toggle-btn"], els.panelButtons, {
      text: "\u{1f4cb} Log",
      tabindex: "1"
    });
    els.logToggleBtn.addEventListener("click", function() {
      els.eventLog.classList.toggle("hidden");
    });

    // --- Sim Selector (portrait thumbnails) ---
    els.simSelector = create("div", "hud-sim-selector", els.hud);

    // --- Build Tools Panel (hidden by default) ---
    els.buildTools = create("div", "ui-build-tools hidden", els.app);
    var buildToolTypes = [
      { key: "wall", label: "Wall", icon: "\u{1f9f1}" },
      { key: "floor", label: "Floor", icon: "\u{1f532}" },
      { key: "bulldoze", label: "Bulldoze", icon: "\u{1f6ae}" },
      { key: "move", label: "Move", icon: "\u{1f500}" }
    ];
    for (var bt = 0; bt < buildToolTypes.length; bt++) {
      (function(tool) {
        var btn = create("button", ["build-tool-btn"], els.buildTools, {
          text: tool.icon + " " + tool.label,
          tabindex: "1"
        });
        btn.dataset.tool = tool.key;
        btn.addEventListener("click", function() { setBuildTool(tool.key); });
      })(buildToolTypes[bt]);
    }

    // --- Buy Catalog Panel (hidden by default) ---
    els.buyCatalog = create("div", "ui-buy-catalog hidden", els.app);
    els.buyCatalogHeader = create("div", "buy-catalog-header", els.buyCatalog);
    create("span", "buy-catalog-title", els.buyCatalogHeader, { text: "Buy Mode" });
    els.buyCategoryFilter = create("select", "buy-category-filter", els.buyCatalogHeader);
    els.buyCategoryFilter.innerHTML =
      '<option value="all">All Categories</option>' +
      '<option value="sleep">Sleep</option>' +
      '<option value="hunger">Hunger</option>' +
      '<option value="bladder">Bladder</option>' +
      '<option value="hygiene">Hygiene</option>' +
      '<option value="social">Social</option>' +
      '<option value="fun">Fun</option>' +
      '<option value="environment">Environment</option>' +
      '<option value="misc">Misc</option>';
    els.buyCategoryFilter.addEventListener("change", renderBuyCatalog);
    els.buyCatalogGrid = create("div", "buy-catalog-grid", els.buyCatalog);

    // --- Info Panel (slide-out, hidden by default) ---
    els.infoPanel = create("div", "ui-info-panel hidden", els.app);
    els.infoPanelHeader = create("div", "info-panel-header", els.infoPanel);
    els.infoPanelTitle = create("span", "info-panel-title", els.infoPanelHeader, { text: "" });
    els.infoPanelClose = create("button", "info-panel-close", els.infoPanelHeader, {
      text: "\u2715",
      tabindex: "1"
    });
    els.infoPanelClose.addEventListener("click", hidePanel);
    els.infoPanelContent = create("div", "info-panel-content", els.infoPanel);

    // --- Event Log (bottom overlay) ---
    els.eventLog = create("div", "ui-event-log hidden", els.app);
    create("div", "event-log-header", els.eventLog, { text: "Event Log" });
    els.eventLogList = create("div", "event-log-list", els.eventLog);
    els.eventLogClear = create("button", "event-log-clear", els.eventLog, {
      text: "Clear Log",
      tabindex: "1"
    });
    els.eventLogClear.addEventListener("click", clearLog);

    // --- Notification Container ---
    els.notificationContainer = create("div", "ui-notifications", els.app);

    // --- Settings Panel (modal, hidden by default) ---
    els.settingsPanel = create("div", "ui-settings-panel hidden", els.app);
    create("div", "settings-title", els.settingsPanel, { text: "Settings" });
    els.settingsContent = create("div", "settings-content", els.settingsPanel);

    // Audio toggle
    var audioRow = create("div", "settings-row", els.settingsContent);
    create("label", "settings-label", audioRow, { text: "Sound Effects" });
    els.audioToggle = create("input", "settings-checkbox", audioRow, { type: "checkbox", checked: "true" });

    // Autosave interval
    var autosaveRow = create("div", "settings-row", els.settingsContent);
    create("label", "settings-label", autosaveRow, { text: "Autosave (minutes)" });
    els.autosaveSelect = create("select", "settings-select", autosaveRow);
    els.autosaveSelect.innerHTML =
      '<option value="0">Off</option>' +
      '<option value="5">5</option>' +
      '<option value="10" selected>10</option>' +
      '<option value="15">15</option>' +
      '<option value="30">30</option>';

    // Reset save button
    var resetRow = create("div", "settings-row", els.settingsContent);
    els.resetSaveBtn = create("button", "settings-danger-btn", resetRow, {
      text: "Reset Save Data",
      tabindex: "1"
    });
    els.resetSaveBtn.addEventListener("click", function() {
      if (window.SAVE && SAVE.deleteSave) {
        SAVE.deleteSave();
        logEvent("Save data cleared. Refresh to restart.", "warning");
      }
    });

    // Close settings button
    els.settingsCloseBtn = create("button", "settings-close-btn", els.settingsPanel, {
      text: "Close",
      tabindex: "1"
    });
    els.settingsCloseBtn.addEventListener("click", hideSettings);

    // Click backdrop to close settings
    els.settingsPanel.addEventListener("click", function(e) {
      if (e.target === els.settingsPanel) hideSettings();
    });

    // --- Tooltip ---
    els.tooltip = create("div", "ui-tooltip hidden", els.app);

    // --- Modal Dialog ---
    els.modalOverlay = create("div", "ui-modal-overlay hidden", els.app);
    els.modalBox = create("div", "ui-modal-box", els.modalOverlay);
    els.modalTitle = create("div", "ui-modal-title", els.modalBox);
    els.modalText = create("div", "ui-modal-text", els.modalBox);
    els.modalButtons = create("div", "ui-modal-buttons", els.modalBox);

    // --- Canvas click for sim selection ---
    var canvas = document.getElementById("game-canvas");
    if (canvas) {
      canvas.addEventListener("click", handleCanvasClick);
      canvas.addEventListener("mousemove", handleCanvasMouseMove);
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", handleKeyDown);

    // --- Register event listeners ---
    registerEventListeners();

    // Mark all panels dirty for initial render
    panelDirty = { needs: true, skills: true, relationships: true, career: true };

    // Initial render
    renderHUD();
  }

  // ============================================================
  // EVENT LISTENERS
  // ============================================================
  function registerEventListeners() {
    if (!window.EVENTS) return;

    EVENTS.on("tick", onTick);
    EVENTS.on("sim.needs_critical", onNeedsCritical);
    EVENTS.on("sim.action_start", onActionStart);
    EVENTS.on("sim.action_complete", onActionComplete);
    EVENTS.on("sim.mood_change", onMoodChange);
    EVENTS.on("sim.age_up", onAgeUp);
    EVENTS.on("sim.death", onSimDeath);
    EVENTS.on("object.broken", onObjectBroken);
    EVENTS.on("object.repaired", onObjectRepaired);
    EVENTS.on("relationship.milestone", onRelationshipMilestone);
    EVENTS.on("funds.change", onFundsChange);
    EVENTS.on("bill.due", onBillDue);
    EVENTS.on("notification", onNotification);
    EVENTS.on("mode.change", onModeChange);
    EVENTS.on("save.loaded", onSaveLoaded);
    EVENTS.on("save.saved", onSaveSaved);
  }

  function unregisterEventListeners() {
    if (!window.EVENTS) return;
    EVENTS.off("tick", onTick);
    EVENTS.off("sim.needs_critical", onNeedsCritical);
    EVENTS.off("sim.action_start", onActionStart);
    EVENTS.off("sim.action_complete", onActionComplete);
    EVENTS.off("sim.mood_change", onMoodChange);
    EVENTS.off("sim.age_up", onAgeUp);
    EVENTS.off("sim.death", onSimDeath);
    EVENTS.off("object.broken", onObjectBroken);
    EVENTS.off("object.repaired", onObjectRepaired);
    EVENTS.off("relationship.milestone", onRelationshipMilestone);
    EVENTS.off("funds.change", onFundsChange);
    EVENTS.off("bill.due", onBillDue);
    EVENTS.off("notification", onNotification);
    EVENTS.off("mode.change", onModeChange);
    EVENTS.off("save.loaded", onSaveLoaded);
    EVENTS.off("save.saved", onSaveSaved);
  }

  // ====== Event Handlers ======
  function onTick() {
    renderHUD();
  }

  function onNeedsCritical(data) {
    var sim = data.sim;
    var need = data.need;
    // Flash the need bar
    if (need && els.needBars) {
      var bar = els.needBars.querySelector('.need-bar-container[data-need="' + need + '"]');
      if (bar) {
        bar.classList.add("critical-flash");
        setTimeout(function() { bar.classList.remove("critical-flash"); }, 2000);
      }
    }
    // Notify
    if (sim && need) {
      notify(sim.name + " has critical " + need + "!", "bad");
    }
  }

  function onActionStart(data) {
    panelDirty.needs = true;
    panelDirty.career = true;
    renderSimInfo();
  }

  function onActionComplete(data) {
    panelDirty.needs = true;
    panelDirty.skills = true;
    panelDirty.career = true;
  }

  function onMoodChange(data) {
    renderSimInfo();
    if (data.sim && data.newMood) {
      var moodColor = MOOD_COLORS[data.newMood] || "#94a3b8";
      notify(data.sim.name + " is feeling " + data.newMood, "info");
    }
  }

  function onAgeUp(data) {
    if (data.sim) {
      notify(data.sim.name + " aged up to " + data.sim.lifeStage + "!", "info");
      panelDirty.skills = true;
      panelDirty.career = true;
    }
  }

  function onSimDeath(data) {
    if (data.sim) {
      notify(data.sim.name + " has died. Cause: " + (data.cause || "unknown"), "bad");
      if (STATE && STATE.selectedSim === data.sim.id) {
        deselectSim();
      }
      refreshSimSelector();
    }
  }

  function onObjectBroken(data) {
    if (data.object) {
      var objDef = getObjectCatalogEntry(data.object.catalogKey);
      notify((objDef ? objDef.name : "Object") + " broke!", "warning");
    }
  }

  function onObjectRepaired(data) {
    if (data.object) {
      var objDef = getObjectCatalogEntry(data.object.catalogKey);
      notify((objDef ? objDef.name : "Object") + " repaired!", "good");
    }
  }

  function onRelationshipMilestone(data) {
    if (data.simA && data.simB && data.milestone) {
      notify(data.simA.name + " and " + data.simB.name + ": " + data.milestone, "good");
      panelDirty.relationships = true;
    }
  }

  function onFundsChange(data) {
    animateFunds(data.old, data.new);
  }

  function onBillDue(data) {
    notify("Bills due: \u00a7" + (data.amount || 0).toLocaleString(), "warning");
  }

  function onNotification(data) {
    notify(data.text, data.type || "info");
  }

  function onModeChange(data) {
    if (data.new) setMode(data.new);
  }

  function onSaveLoaded() {
    refreshSimSelector();
    renderHUD();
    logEvent("Game loaded.", "info");
  }

  function onSaveSaved() {
    logEvent("Game saved.", "good");
  }

  // ====== Canvas click handler for sim selection ======
  function handleCanvasClick(e) {
    if (!window.RENDERER || !window.SIM) return;
    var canvas = document.getElementById("game-canvas");
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left;
    var sy = e.clientY - rect.top;

    // Convert screen to world coords
    var wx = sx, wy = sy;
    if (RENDERER.screenToWorld) {
      var world = RENDERER.screenToWorld(sx, sy);
      wx = world.x;
      wy = world.y;
    }

    // Find sim at position
    if (SIM.getSimAt) {
      var clickedSim = SIM.getSimAt(wx, wy, 30);
      if (clickedSim) {
        selectSim(clickedSim.id);
      } else if (currentMode === "live") {
        // Clicked empty space - maybe deselect
        // deselectSim();
      }
    }
  }

  function handleCanvasMouseMove(e) {
    if (placementPreviewActive && els.buyCatalog) {
      // Ghost placement tracking handled by renderer
    }
  }

  // ====== Keyboard shortcuts ======
  function handleKeyDown(e) {
    // Don't trigger shortcuts while typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;

    switch (e.key) {
      case "1":
        if (!e.ctrlKey && !e.altKey && !e.metaKey && window.ENGINE) ENGINE.setSpeed(0);
        break;
      case "2":
        if (!e.ctrlKey && !e.altKey && !e.metaKey && window.ENGINE) ENGINE.setSpeed(1);
        break;
      case "3":
        if (!e.ctrlKey && !e.altKey && !e.metaKey && window.ENGINE) ENGINE.setSpeed(2);
        break;
      case "4":
        if (!e.ctrlKey && !e.altKey && !e.metaKey && window.ENGINE) ENGINE.setSpeed(3);
        break;
      case "Escape":
        hidePanel();
        hideSettings();
        hideDialog();
        if (placementPreviewActive) hidePlacementPreview();
        break;
      case "p":
      case "P":
        if (window.ENGINE) {
          if (STATE && STATE.paused) ENGINE.resume();
          else ENGINE.pause();
        }
        break;
      case "b":
      case "B":
        setMode("build");
        break;
      case "v":
      case "V":
        setMode("live");
        break;
    }
  }

  // ============================================================
  // HUD RENDERING
  // ============================================================
  function renderHUD() {
    renderTime();
    renderFunds();
    renderSpeedControls();
    renderSimInfo();
    renderNeedBars();
    renderSimSelector();

    // Render active panel content if visible
    if (currentPanel) {
      renderPanelContent(currentPanel);
    }
  }

  function renderTime() {
    if (!window.STATE || !STATE.time) return;
    var t = STATE.time;
    els.clockDisplay.textContent = pad(t.hour) + ":" + pad(t.minute);
    var dayName = DAY_NAMES[t.dayOfWeek] || "Mon";
    els.dayDisplay.textContent = dayName + " Day " + t.day;
    els.seasonDisplay.textContent = SEASON_ICONS[t.season] || SEASON_ICONS[0];
    els.seasonDisplay.title = SEASON_NAMES[t.season] || "Spring";
  }

  function renderFunds() {
    if (!window.STATE) return;
    var funds = STATE.funds || 0;
    // Only update if not currently animating
    if (!fundsAnimationId) {
      els.fundsDisplay.textContent = formatFunds(funds);
    }
    fundsDisplayValue = funds;
  }

  function animateFunds(from, to) {
    if (fundsAnimationId) cancelAnimationFrame(fundsAnimationId);
    var start = performance.now();
    var duration = 600;
    function step(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      // Ease-out
      progress = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + (to - from) * progress);
      els.fundsDisplay.textContent = formatFunds(current);
      if (progress < 1) {
        fundsAnimationId = requestAnimationFrame(step);
      } else {
        fundsAnimationId = null;
        fundsDisplayValue = to;
        // Flash effect
        els.fundsDisplay.classList.add(to > from ? "funds-up" : "funds-down");
        setTimeout(function() {
          els.fundsDisplay.classList.remove("funds-up", "funds-down");
        }, 500);
      }
    }
    fundsAnimationId = requestAnimationFrame(step);
  }

  function renderSpeedControls() {
    if (!window.STATE) return;
    var activeSpeed = CONFIG && CONFIG.SIM_SPEEDS ? CONFIG.SIM_SPEEDS[STATE.speed || 0] : 1;
    for (var i = 0; i < els.speedButtons.length; i++) {
      var btn = els.speedButtons[i];
      var spd = parseInt(btn.dataset.speed, 10);
      if (spd === activeSpeed) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  }

  function renderSimInfo() {
    var sim = getSelectedSim();
    if (!sim) {
      els.simName.textContent = "No Sim Selected";
      els.simDetails.textContent = "Click a sim to select";
      els.simMood.textContent = "";
      els.simMood.style.color = "";
      els.simTask.textContent = "";
      return;
    }

    els.simName.textContent = sim.name;
    var stageLabel = sim.lifeStage ? sim.lifeStage.replace(/_/g, " ") : "";
    els.simDetails.textContent = "Age " + sim.age + " \u00b7 " + stageLabel.charAt(0).toUpperCase() + stageLabel.slice(1);

    // Mood with color
    var mood = sim.mood || "fine";
    var moodColor = MOOD_COLORS[mood] || "#94a3b8";
    els.simMood.textContent = mood.charAt(0).toUpperCase() + mood.slice(1);
    els.simMood.style.color = moodColor;

    // Task
    els.simTask.textContent = sim.task || "Idle";

    // Job info if available
    if (sim.job && sim.job.career) {
      var careerName = sim.job.career;
      var levelTitle = sim.job.title || careerName;
      els.simDetails.textContent += " \u00b7 " + levelTitle;
    }
  }

  function renderNeedBars() {
    var sim = getSelectedSim();
    var containers = els.needBars.querySelectorAll(".need-bar-container");
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      var needKey = container.dataset.need;
      var fill = container.querySelector(".need-bar-fill");
      var valueEl = container.querySelector(".need-bar-value");

      if (!sim || sim.needs === undefined) {
        fill.style.width = "0%";
        valueEl.textContent = "--";
        continue;
      }

      var value = sim.needs[needKey];
      if (value === undefined) {
        fill.style.width = "0%";
        valueEl.textContent = "--";
        continue;
      }

      // Clamp 0-100
      value = Math.max(0, Math.min(100, value));
      fill.style.width = value + "%";
      valueEl.textContent = Math.round(value);

      // Color based on criticality
      var criticalThreshold = 25;
      if (window.CONFIG && CONFIG.NEEDS && CONFIG.NEEDS[needKey]) {
        criticalThreshold = CONFIG.NEEDS[needKey].critical || 25;
      }
      if (value <= criticalThreshold) {
        container.classList.add("critical");
      } else {
        container.classList.remove("critical");
      }
    }
  }

  // ============================================================
  // SIM SELECTOR (portrait bar)
  // ============================================================
  function renderSimSelector() {
    if (!window.STATE || !STATE.sims) return;
    // Only rebuild if sim count changed
    var expectedCount = STATE.sims.length;
    var existingCount = els.simSelector.querySelectorAll(".sim-portrait").length;
    if (expectedCount === existingCount) {
      // Just update active state
      updateSimSelectorActive();
      return;
    }
    refreshSimSelector();
  }

  function refreshSimSelector() {
    els.simSelector.innerHTML = "";
    if (!window.STATE || !STATE.sims) return;
    for (var i = 0; i < STATE.sims.length; i++) {
      (function(sim) {
        var portrait = create("div", "sim-portrait", els.simSelector);
        portrait.dataset.simId = sim.id;
        portrait.title = sim.name + " \u2014 " + (sim.mood || "fine");
        portrait.style.backgroundColor = sim.bodyColor || "#e6edf5";

        // Mini mood indicator
        var moodDot = create("div", "sim-portrait-mood", portrait);
        var moodColor = MOOD_COLORS[sim.mood] || "#94a3b8";
        moodDot.style.backgroundColor = moodColor;

        // Name label
        create("div", "sim-portrait-name", portrait, { text: sim.name });

        portrait.addEventListener("click", function() {
          selectSim(sim.id);
        });

        portrait.setAttribute("tabindex", "1");
        portrait.addEventListener("keydown", function(e) {
          if (e.key === "Enter") selectSim(sim.id);
        });
      })(STATE.sims[i]);
    }
    updateSimSelectorActive();
  }

  function updateSimSelectorActive() {
    var portraits = els.simSelector.querySelectorAll(".sim-portrait");
    for (var i = 0; i < portraits.length; i++) {
      var pid = parseInt(portraits[i].dataset.simId, 10);
      if (STATE && STATE.selectedSim === pid) {
        portraits[i].classList.add("active");
      } else {
        portraits[i].classList.remove("active");
      }
    }
  }

  // ============================================================
  // MODE SWITCHING
  // ============================================================
  function setMode(mode) {
    var oldMode = currentMode;
    currentMode = mode;

    // Update mode buttons
    var modeMap = { live: els.modeLiveBtn, build: els.modeBuildBtn, buy: els.modeBuyBtn };
    for (var key in modeMap) {
      var btn = modeMap[key];
      if (btn) {
        if (key === mode) btn.classList.add("active");
        else btn.classList.remove("active");
      }
    }

    // Update UI visibility
    if (mode === "live") {
      els.buildTools.classList.add("hidden");
      els.buyCatalog.classList.add("hidden");
      els.hudMiddle.classList.remove("hidden");
      els.panelButtons.classList.remove("hidden");
      hidePlacementPreview();
    } else if (mode === "build") {
      els.buildTools.classList.remove("hidden");
      els.buyCatalog.classList.add("hidden");
      els.hudMiddle.classList.add("hidden");
      els.panelButtons.classList.add("hidden");
      hidePanel();
      showBuildTools();
    } else if (mode === "buy") {
      els.buildTools.classList.add("hidden");
      els.buyCatalog.classList.remove("hidden");
      els.hudMiddle.classList.add("hidden");
      els.panelButtons.classList.add("hidden");
      hidePanel();
      showBuyCatalog();
    }

    // Emit event
    if (window.EVENTS) {
      EVENTS.emit("mode.change", { old: oldMode, new: mode });
    }
  }

  function showBuildTools() {
    // Build tools panel is already shown by setMode
    // Just ensure tools are rendered
    if (!els.buildTools.querySelector(".build-tool-btn")) {
      // Rebuild if empty
      els.buildTools.innerHTML = "";
      var tools = [
        { key: "wall", label: "Wall", icon: "\u{1f9f1}" },
        { key: "floor", label: "Floor", icon: "\u{1f532}" },
        { key: "bulldoze", label: "Bulldoze", icon: "\u{1f6ae}" },
        { key: "move", label: "Move", icon: "\u{1f500}" }
      ];
      for (var i = 0; i < tools.length; i++) {
        (function(tool) {
          var btn = create("button", ["build-tool-btn"], els.buildTools, {
            text: tool.icon + " " + tool.label
          });
          btn.dataset.tool = tool.key;
          btn.addEventListener("click", function() { setBuildTool(tool.key); });
        })(tools[i]);
      }
    }
  }

  function showBuyCatalog() {
    renderBuyCatalog();
  }

  // ============================================================
  // BUILD TOOLS
  // ============================================================
  function setBuildTool(tool) {
    activeBuildTool = tool;
    STATE.selectedTool = tool;

    // Update visual
    var btns = els.buildTools.querySelectorAll(".build-tool-btn");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.tool === tool) btns[i].classList.add("active");
      else btns[i].classList.remove("active");
    }

    if (tool === "wall") {
      notify("Click and drag to build walls. Cost: \u00a7" + (CONFIG ? CONFIG.WALL_COST : 50) + " per segment.", "info");
    } else if (tool === "floor") {
      notify("Click on empty floor cells to place flooring. Cost: \u00a7" + (CONFIG ? CONFIG.FLOOR_COST : 30) + " per cell.", "info");
    } else if (tool === "bulldoze") {
      notify("Click walls or objects to remove them.", "info");
    } else if (tool === "move") {
      notify("Click an object to move it.", "info");
    }
  }

  function showPlacementPreview(objectKey) {
    placementPreviewActive = true;
    placementObjectKey = objectKey;
    STATE.placementObject = objectKey;
  }

  function hidePlacementPreview() {
    placementPreviewActive = false;
    placementObjectKey = null;
    if (STATE) STATE.placementObject = null;
  }

  // ============================================================
  // BUY CATALOG
  // ============================================================
  function renderBuyCatalog() {
    if (!els.buyCatalogGrid) return;
    els.buyCatalogGrid.innerHTML = "";

    var catalog = getObjectCatalog();
    if (!catalog) {
      create("div", "buy-catalog-empty", els.buyCatalogGrid, { text: "No items available." });
      return;
    }

    var filter = els.buyCategoryFilter ? els.buyCategoryFilter.value : "all";
    var keys = Object.keys(catalog);
    var hasItems = false;

    // Group by category
    var categories = {};
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var item = catalog[key];
      var cat = item.category || "misc";
      if (filter !== "all" && cat !== filter) continue;
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ key: key, item: item });
      hasItems = true;
    }

    if (!hasItems) {
      create("div", "buy-catalog-empty", els.buyCatalogGrid, { text: "No items in this category." });
      return;
    }

    var catOrder = ["sleep", "hunger", "bladder", "hygiene", "social", "fun", "environment", "misc", "athletic", "comfort"];
    for (var c = 0; c < catOrder.length; c++) {
      var catKey = catOrder[c];
      var items = categories[catKey];
      if (!items) continue;

      // Category header
      create("div", "buy-category-header", els.buyCatalogGrid, {
        text: catKey.charAt(0).toUpperCase() + catKey.slice(1)
      });

      for (var j = 0; j < items.length; j++) {
        (function(entry) {
          var card = create("div", "buy-item-card", els.buyCatalogGrid);
          card.setAttribute("tabindex", "1");
          card.setAttribute("role", "button");

          // Icon placeholder (colored square based on category)
          var icon = create("div", "buy-item-icon", card);
          icon.style.backgroundColor = getCategoryColor(entry.item.category);

          create("div", "buy-item-name", card, { text: entry.item.name });
          create("div", "buy-item-price", card, { text: "\u00a7" + (entry.item.cost || 0).toLocaleString() });

          // Size info
          if (entry.item.size) {
            create("div", "buy-item-size", card, {
              text: entry.item.size[0] + "\u00d7" + entry.item.size[1]
            });
          }

          // Click to start placement
          card.addEventListener("click", function() {
            var canAfford = window.ECONOMY && ECONOMY.canAfford ? ECONOMY.canAfford(entry.item.cost || 0) : true;
            if (!canAfford) {
              notify("Cannot afford " + entry.item.name + "!", "bad");
              return;
            }
            showPlacementPreview(entry.key);
            notify("Click on the lot to place " + entry.item.name, "info");
          });

          card.addEventListener("keydown", function(e) {
            if (e.key === "Enter") card.click();
          });

          // Tooltip
          card.addEventListener("mouseenter", function(e) {
            var interactions = entry.item.interactions ? Object.keys(entry.item.interactions) : [];
            var tooltipText = entry.item.name;
            if (interactions.length > 0) {
              tooltipText += "\nActions: " + interactions.join(", ");
            }
            showTooltip(e.clientX, e.clientY, tooltipText);
          });
          card.addEventListener("mouseleave", hideTooltip);
        })(items[j]);
      }
    }
  }

  function getCategoryColor(category) {
    var colors = {
      sleep: "#a78bfa",
      hunger: "#f5a623",
      bladder: "#3dd6d0",
      hygiene: "#60a5fa",
      social: "#e879f9",
      fun: "#f472b6",
      environment: "#34d399",
      misc: "#94a3b8",
      athletic: "#fb923c",
      comfort: "#a78bfa"
    };
    return colors[category] || "#94a3b8";
  }

  // ============================================================
  // PANELS
  // ============================================================
  function showPanel(panel) {
    if (currentPanel === panel) return;
    currentPanel = panel;
    panelDirty[panel] = true;

    els.infoPanel.classList.remove("hidden");
    els.infoPanelTitle.textContent = panel.charAt(0).toUpperCase() + panel.slice(1);
    renderPanelContent(panel);
  }

  function hidePanel() {
    currentPanel = null;
    els.infoPanel.classList.add("hidden");
  }

  function togglePanel(panel) {
    if (currentPanel === panel) hidePanel();
    else showPanel(panel);
  }

  function renderPanelContent(panel) {
    if (!panelDirty[panel]) return;
    panelDirty[panel] = false;

    els.infoPanelContent.innerHTML = "";

    switch (panel) {
      case "needs": renderNeedsPanel(); break;
      case "skills": renderSkillsPanel(); break;
      case "relationships": renderRelationshipsPanel(); break;
      case "career": renderCareerPanel(); break;
      case "inventory": renderInventoryPanel(); break;
      default: create("div", "panel-empty", els.infoPanelContent, { text: "Panel not implemented." });
    }
  }

  function renderNeedsPanel() {
    var sim = getSelectedSim();
    if (!sim) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Select a sim to view needs." });
      return;
    }

    var needKeys = Object.keys(NEED_COLORS);
    for (var i = 0; i < needKeys.length; i++) {
      var needKey = needKeys[i];
      var value = sim.needs ? sim.needs[needKey] : 0;
      value = Math.max(0, Math.min(100, value || 0));

      var row = create("div", "panel-need-row", els.infoPanelContent);
      create("span", "panel-need-label", row, {
        text: needKey.charAt(0).toUpperCase() + needKey.slice(1)
      });

      var track = create("div", "panel-bar-track", row);
      var fill = create("div", "panel-bar-fill", track);
      fill.style.backgroundColor = NEED_COLORS[needKey];
      fill.style.width = value + "%";

      create("span", "panel-need-value", row, { text: Math.round(value) + "/100" });
    }
  }

  function renderSkillsPanel() {
    var sim = getSelectedSim();
    if (!sim) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Select a sim to view skills." });
      return;
    }

    var skillKeys = ["logic", "creativity", "athletic", "charisma", "cooking", "handiness", "gardening"];
    var skillLabels = {
      logic: "Logic", creativity: "Creativity", athletic: "Athletic",
      charisma: "Charisma", cooking: "Cooking", handiness: "Handiness", gardening: "Gardening"
    };

    for (var i = 0; i < skillKeys.length; i++) {
      var skillKey = skillKeys[i];
      var value = sim.skills ? (sim.skills[skillKey] || 0) : 0;
      value = Math.max(0, Math.min(10, value));

      var row = create("div", "panel-skill-row", els.infoPanelContent);
      create("span", "panel-skill-label", row, { text: skillLabels[skillKey] || skillKey });

      var track = create("div", "panel-bar-track", row);
      var fill = create("div", "panel-bar-fill", track);
      fill.style.backgroundColor = "#60a5fa";
      fill.style.width = (value * 10) + "%";

      create("span", "panel-skill-value", row, { text: value + "/10" });
    }
  }

  function renderRelationshipsPanel() {
    var sim = getSelectedSim();
    if (!sim) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Select a sim to view relationships." });
      return;
    }

    if (!window.STATE || !STATE.sims || STATE.sims.length <= 1) {
      create("div", "panel-empty", els.infoPanelContent, { text: "No other sims in household." });
      return;
    }

    var hasRelationships = false;
    for (var i = 0; i < STATE.sims.length; i++) {
      var other = STATE.sims[i];
      if (other.id === sim.id) continue;

      var rel = null;
      if (window.SOCIAL && SOCIAL.getRelationship) {
        rel = SOCIAL.getRelationship(sim, other);
      }

      hasRelationships = true;
      var card = create("div", "panel-rel-card", els.infoPanelContent);
      create("div", "panel-rel-name", card, { text: other.name });

      if (rel) {
        // Friendship bar
        var friendRow = create("div", "panel-rel-stat", card);
        create("span", "panel-rel-stat-label", friendRow, { text: "Friendship" });
        var friendInfo = getRelationshipLevelInfo(rel.friendship || 0);
        var friendTrack = create("div", "panel-bar-track", friendRow);
        var friendFill = create("div", "panel-bar-fill", friendTrack);
        friendFill.style.backgroundColor = friendInfo.color;
        friendFill.style.width = Math.max(0, Math.min(100, (rel.friendship || 0) + 50)) + "%";
        create("span", "panel-rel-stat-value", friendRow, {
          text: (rel.friendship || 0) + " (" + friendInfo.label + ")"
        });

        // Romance bar
        var romanceRow = create("div", "panel-rel-stat", card);
        create("span", "panel-rel-stat-label", romanceRow, { text: "Romance" });
        var romanceInfo = getRomanceLevelInfo(rel.romance || 0);
        var romanceTrack = create("div", "panel-bar-track", romanceRow);
        var romanceFill = create("div", "panel-bar-fill", romanceTrack);
        romanceFill.style.backgroundColor = romanceInfo.color;
        romanceFill.style.width = Math.max(0, Math.min(100, (rel.romance || 0) + 50)) + "%";
        create("span", "panel-rel-stat-value", romanceRow, {
          text: (rel.romance || 0) + " (" + romanceInfo.label + ")"
        });
      } else {
        create("div", "panel-rel-no-data", card, { text: "No relationship data" });
      }
    }

    if (!hasRelationships) {
      create("div", "panel-empty", els.infoPanelContent, { text: "No other sims to display." });
    }
  }

  function renderCareerPanel() {
    var sim = getSelectedSim();
    if (!sim) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Select a sim to view career info." });
      return;
    }

    if (!sim.job) {
      create("div", "panel-empty", els.infoPanelContent, { text: sim.name + " is unemployed." });
      // Show assign career button
      var assignRow = create("div", "panel-career-assign", els.infoPanelContent);
      var careers = ["tech", "culinary", "athletic", "business", "artist"];
      var careerLabels = { tech: "Technology", culinary: "Culinary", athletic: "Athletic", business: "Business", artist: "Artist" };
      for (var i = 0; i < careers.length; i++) {
        (function(c) {
          var btn = create("button", "panel-career-btn", assignRow, {
            text: careerLabels[c] || c
          });
          btn.addEventListener("click", function() {
            if (window.ECONOMY && ECONOMY.assignCareer) {
              ECONOMY.assignCareer(sim, c);
              panelDirty.career = true;
              renderCareerPanel();
            }
          });
        })(careers[i]);
      }
      return;
    }

    // Job details
    var job = sim.job;
    create("div", "panel-career-title", els.infoPanelContent, { text: job.title || "Unknown" });

    // Career track name
    if (job.career) {
      create("div", "panel-career-track", els.infoPanelContent, {
        text: "Career: " + job.career.charAt(0).toUpperCase() + job.career.slice(1)
      });
    }

    // Performance bar
    create("div", "panel-career-label", els.infoPanelContent, { text: "Performance" });
    var perfTrack = create("div", "panel-bar-track", els.infoPanelContent);
    var perfFill = create("div", "panel-bar-fill", perfTrack);
    perfFill.style.backgroundColor = "#4ade80";
    perfFill.style.width = (job.performance || 0) + "%";
    create("div", "panel-career-value", els.infoPanelContent, {
      text: Math.round(job.performance || 0) + "/100"
    });

    // Daily pay
    var dailyPay = job.dailyPay || 0;
    create("div", "panel-career-pay", els.infoPanelContent, {
      text: "Daily Pay: \u00a7" + dailyPay.toLocaleString()
    });

    // Work schedule
    if (window.ECONOMY && ECONOMY.getWorkStatus) {
      var status = ECONOMY.getWorkStatus(sim);
      create("div", "panel-career-status", els.infoPanelContent, {
        text: "Status: " + status.charAt(0).toUpperCase() + status.slice(1)
      });
    }

    // Job level
    if (job.level !== undefined) {
      create("div", "panel-career-level", els.infoPanelContent, {
        text: "Level: " + (job.level + 1)
      });
    }
  }

  function renderInventoryPanel() {
    // Simplified inventory - just show held object
    var sim = getSelectedSim();
    if (!sim) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Select a sim to view inventory." });
      return;
    }

    if (!sim.heldObject) {
      create("div", "panel-empty", els.infoPanelContent, { text: "Inventory is empty." });
      return;
    }

    create("div", "panel-inventory-item", els.infoPanelContent, {
      text: sim.heldObject.name || "Unknown item"
    });
  }

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  function notify(text, type) {
    type = type || "info";

    // Remove old notifications if at max
    var existing = els.notificationContainer.querySelectorAll(".ui-notification");
    if (existing.length >= 5) {
      existing[0].remove();
    }

    var notif = create("div", "ui-notification", els.notificationContainer);
    notif.style.borderLeftColor = NOTIFICATION_COLORS[type] || NOTIFICATION_COLORS.info;

    // Type icon
    var iconMap = { info: "\u2139", warning: "\u26a0", good: "\u2713", bad: "\u2717" };
    create("span", "notif-icon", notif, { text: iconMap[type] || iconMap.info });
    create("span", "notif-text", notif, { text: text });

    // Close button
    var closeBtn = create("button", "notif-close", notif, { text: "\u2715" });
    closeBtn.addEventListener("click", function() { dismissNotification(notif); });

    // Auto-dismiss after 5 seconds
    var timer = setTimeout(function() { dismissNotification(notif); }, 5000);
    notif.dataset.timerId = timer;

    // Click to dismiss
    notif.addEventListener("click", function(e) {
      if (e.target !== closeBtn) dismissNotification(notif);
    });
  }

  function dismissNotification(notif) {
    if (!notif || !notif.parentNode) return;
    var timer = notif.dataset.timerId;
    if (timer) clearTimeout(parseInt(timer, 10));
    notif.classList.add("dismissing");
    setTimeout(function() {
      if (notif.parentNode) notif.remove();
    }, 300);
  }

  function clearNotifications() {
    var notifs = els.notificationContainer.querySelectorAll(".ui-notification");
    for (var i = 0; i < notifs.length; i++) {
      dismissNotification(notifs[i]);
    }
  }

  // ============================================================
  // SIM SELECTION
  // ============================================================
  function selectSim(simId) {
    if (!window.STATE) return;
    STATE.selectedSim = simId;
    panelDirty = { needs: true, skills: true, relationships: true, career: true, inventory: true };
    renderSimInfo();
    renderNeedBars();
    updateSimSelectorActive();

    var sim = getSelectedSim();
    if (sim) {
      logEvent("Selected: " + sim.name, "info");
    }

    // Re-render active panel
    if (currentPanel) {
      panelDirty[currentPanel] = true;
      renderPanelContent(currentPanel);
    }
  }

  function deselectSim() {
    STATE.selectedSim = null;
    panelDirty = { needs: true, skills: true, relationships: true, career: true, inventory: true };
    renderSimInfo();
    renderNeedBars();
    updateSimSelectorActive();
    hidePanel();
  }

  function getSelectedSim() {
    if (!window.STATE || !window.SIM) return null;
    if (STATE.selectedSim === null || STATE.selectedSim === undefined) return null;
    return SIM.getSim ? SIM.getSim(STATE.selectedSim) : null;
  }

  // ============================================================
  // EVENT LOG
  // ============================================================
  function logEvent(text, type) {
    type = type || "info";
    var timestamp = "";
    if (window.STATE && STATE.time) {
      var t = STATE.time;
      timestamp = pad(t.hour) + ":" + pad(t.minute);
    }

    var entry = {
      text: text,
      type: type,
      time: timestamp,
      id: Date.now() + Math.random()
    };

    eventLogEntries.push(entry);
    if (eventLogEntries.length > 50) {
      eventLogEntries.shift();
    }

    // Render to DOM
    var entryEl = create("div", "event-log-entry", els.eventLogList);
    entryEl.style.color = EVENT_LOG_COLORS[type] || EVENT_LOG_COLORS.info;
    entryEl.dataset.entryId = entry.id;

    if (timestamp) {
      create("span", "event-log-time", entryEl, { text: "[" + timestamp + "] " });
    }
    create("span", "event-log-text", entryEl, { text: text });

    // Scroll to bottom
    els.eventLogList.scrollTop = els.eventLogList.scrollHeight;

    // Keep DOM in sync (remove old if over 50)
    var domEntries = els.eventLogList.querySelectorAll(".event-log-entry");
    if (domEntries.length > 50) {
      for (var i = 0; i < domEntries.length - 50; i++) {
        domEntries[i].remove();
      }
    }
  }

  function clearLog() {
    eventLogEntries = [];
    els.eventLogList.innerHTML = "";
  }

  // ============================================================
  // TOOLTIPS
  // ============================================================
  function showTooltip(x, y, text) {
    els.tooltip.textContent = text;
    els.tooltip.classList.remove("hidden");
    els.tooltip.style.left = (x + 12) + "px";
    els.tooltip.style.top = (y + 12) + "px";
  }

  function hideTooltip() {
    els.tooltip.classList.add("hidden");
  }

  // ============================================================
  // MODAL DIALOGS
  // ============================================================
  function showDialog(title, text, buttons) {
    els.modalTitle.textContent = title || "";
    els.modalText.textContent = text || "";
    els.modalButtons.innerHTML = "";

    if (buttons && buttons.length > 0) {
      for (var i = 0; i < buttons.length; i++) {
        (function(btn) {
          var buttonEl = create("button", "modal-btn", els.modalButtons, {
            text: btn.label || "OK",
            tabindex: "1"
          });
          if (btn.primary) buttonEl.classList.add("primary");
          buttonEl.addEventListener("click", function() {
            if (btn.callback) btn.callback();
            hideDialog();
          });
        })(buttons[i]);
      }
    } else {
      // Default OK button
      var okBtn = create("button", ["modal-btn", "primary"], els.modalButtons, {
        text: "OK",
        tabindex: "1"
      });
      okBtn.addEventListener("click", hideDialog);
    }

    els.modalOverlay.classList.remove("hidden");

    // Focus first button
    var firstBtn = els.modalOverlay.querySelector("button");
    if (firstBtn) firstBtn.focus();
  }

  function hideDialog() {
    els.modalOverlay.classList.add("hidden");
  }

  // ============================================================
  // SETTINGS
  // ============================================================
  function showSettings() {
    els.settingsPanel.classList.remove("hidden");
    els.settingsCloseBtn.focus();
  }

  function hideSettings() {
    els.settingsPanel.classList.add("hidden");
  }

  // ============================================================
  // UTILITY: Get object catalog
  // ============================================================
  function getObjectCatalog() {
    if (window.OBJECT_CATALOG) return OBJECT_CATALOG;
    if (window.WORLD && WORLD.getCatalog) return WORLD.getCatalog();
    return null;
  }

  function getObjectCatalogEntry(key) {
    var cat = getObjectCatalog();
    if (cat && cat[key]) return cat[key];
    return null;
  }

  // ============================================================
  // QUEUE DISPLAY
  // ============================================================
  function renderQueue(sim) {
    // Queue is shown inline in the sim info area
    if (!sim) return;
    els.simTask.textContent = sim.task || "Idle";
    if (sim.queue && sim.queue.length > 0) {
      els.simTask.textContent += " (" + sim.queue.length + " queued)";
    }
  }

  // ============================================================
  // HIGHLIGHT SIM
  // ============================================================
  function highlightSim(simId) {
    // Visual highlight is handled by the renderer
    // This just updates the UI selection
    selectSim(simId);
  }

  // ============================================================
  // CLEANUP
  // ============================================================
  function destroy() {
    unregisterEventListeners();
    if (fundsAnimationId) cancelAnimationFrame(fundsAnimationId);
    document.removeEventListener("keydown", handleKeyDown);
    var canvas = document.getElementById("game-canvas");
    if (canvas) {
      canvas.removeEventListener("click", handleCanvasClick);
      canvas.removeEventListener("mousemove", handleCanvasMouseMove);
    }
  }

  // ============================================================
  // EXPORTS
  // ============================================================
  window.UI = {
    init: init,
    renderHUD: renderHUD,
    renderNeedBars: renderNeedBars,
    renderSimInfo: renderSimInfo,
    renderTime: renderTime,
    renderFunds: renderFunds,
    renderSpeedControls: renderSpeedControls,
    setMode: setMode,
    showBuildTools: showBuildTools,
    showBuyCatalog: showBuyCatalog,
    showPanel: showPanel,
    hidePanel: hidePanel,
    togglePanel: togglePanel,
    notify: notify,
    clearNotifications: clearNotifications,
    selectSim: selectSim,
    deselectSim: deselectSim,
    highlightSim: highlightSim,
    renderQueue: renderQueue,
    logEvent: logEvent,
    clearLog: clearLog,
    showTooltip: showTooltip,
    hideTooltip: hideTooltip,
    showDialog: showDialog,
    hideDialog: hideDialog,
    renderBuyCatalog: renderBuyCatalog,
    setBuildTool: setBuildTool,
    showPlacementPreview: showPlacementPreview,
    hidePlacementPreview: hidePlacementPreview,
    showSettings: showSettings,
    hideSettings: hideSettings,
    destroy: destroy
  };

})();
