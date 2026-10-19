/**
 * economy.js — Economy System
 *
 * Careers, bills, funds, shopping, build-mode costs,
 * and daily economic events.
 *
 * Assumes global: ENGINE, STATE, CONFIG, EVENTS, SIM, WORLD
 */
(function () {
  "use strict";

  // ============================================================
  //  Career Definitions
  // ============================================================
  const CAREERS = {
    tech: {
      name: "Technology",
      levels: [
        { title: "QA Tester",       pay: 80,  req: { logic: 0 } },
        { title: "Developer",       pay: 150, req: { logic: 3 } },
        { title: "Senior Dev",      pay: 250, req: { logic: 5 } },
        { title: "Tech Lead",       pay: 400, req: { logic: 7, charisma: 3 } },
        { title: "CTO",             pay: 700, req: { logic: 9, charisma: 6 } }
      ],
      workHours: [9, 17],
      workDays: [0, 1, 2, 3, 4],
      skill: "logic"
    },
    culinary: {
      name: "Culinary",
      levels: [
        { title: "Dishwasher",      pay: 60,  req: { cooking: 0 } },
        { title: "Line Cook",       pay: 110, req: { cooking: 2 } },
        { title: "Sous Chef",       pay: 200, req: { cooking: 5 } },
        { title: "Head Chef",       pay: 350, req: { cooking: 7, creativity: 3 } },
        { title: "Celebrity Chef",  pay: 600, req: { cooking: 9, charisma: 5 } }
      ],
      workHours: [10, 18],
      workDays: [0, 1, 2, 3, 4, 5],
      skill: "cooking"
    },
    athletic: {
      name: "Athletic",
      levels: [
        { title: "Waterboy",        pay: 50,  req: { athletic: 0 } },
        { title: "Team Player",     pay: 120, req: { athletic: 2 } },
        { title: "Starter",         pay: 220, req: { athletic: 4 } },
        { title: "All-Star",        pay: 400, req: { athletic: 7 } },
        { title: "Hall of Famer",   pay: 800, req: { athletic: 9, charisma: 4 } }
      ],
      workHours: [8, 16],
      workDays: [0, 1, 2, 3, 4],
      skill: "athletic"
    },
    business: {
      name: "Business",
      levels: [
        { title: "Mailroom Clerk",  pay: 70,  req: { charisma: 0 } },
        { title: "Sales Rep",       pay: 130, req: { charisma: 2 } },
        { title: "Manager",         pay: 230, req: { charisma: 4, logic: 3 } },
        { title: "VP",              pay: 400, req: { charisma: 6, logic: 5 } },
        { title: "CEO",             pay: 900, req: { charisma: 9, logic: 7 } }
      ],
      workHours: [9, 17],
      workDays: [0, 1, 2, 3, 4],
      skill: "charisma"
    },
    artist: {
      name: "Artist",
      levels: [
        { title: "Starving Artist", pay: 40,  req: { creativity: 0 } },
        { title: "Illustrator",     pay: 100, req: { creativity: 2 } },
        { title: "Painter",         pay: 180, req: { creativity: 4 } },
        { title: "Famous Artist",   pay: 350, req: { creativity: 7 } },
        { title: "Art Legend",      pay: 650, req: { creativity: 9, charisma: 4 } }
      ],
      workHours: [10, 15],
      workDays: [0, 1, 2, 3, 4, 5],
      skill: "creativity"
    }
  };

  // ============================================================
  //  Private State
  // ============================================================
  var _inventory = [];   // unplaced purchased objects { catalogKey, name, cost }
  var _lastBillDay = 0;  // track last day bills were processed

  // ============================================================
  //  Helpers
  // ============================================================
  function _getTime() {
    return STATE.time;
  }

  function _meetsRequirements(sim, req) {
    if (!req) return true;
    for (var skill in req) {
      if (!sim.skills[skill] || sim.skills[skill] < req[skill]) {
        return false;
      }
    }
    return true;
  }

  function _isWorkDay(sim) {
    if (!sim.job) return false;
    var career = CAREERS[sim.job.career];
    if (!career) return false;
    return career.workDays.indexOf(STATE.time.dayOfWeek) !== -1;
  }

  // ============================================================
  //  Career Functions
  // ============================================================

  /**
   * Assign a sim to a career track. Checks minimum requirements.
   */
  function assignCareer(sim, careerKey) {
    var career = CAREERS[careerKey];
    if (!career) {
      EVENTS.emit("notification", { text: "Invalid career: " + careerKey, type: "warning" });
      return false;
    }
    var level0 = career.levels[0];
    if (!_meetsRequirements(sim, level0.req)) {
      EVENTS.emit("notification", { text: sim.name + " doesn't meet requirements for " + career.name, type: "warning" });
      return false;
    }
    sim.job = {
      career: careerKey,
      level: 0,
      performance: 50,
      dailyPay: level0.pay
    };
    EVENTS.emit("notification", { text: sim.name + " is now a " + level0.title + "!", type: "good" });
    return true;
  }

  /**
   * Check if sim can be promoted to next level.
   */
  function promote(sim) {
    if (!sim.job) return false;
    var career = CAREERS[sim.job.career];
    if (!career) return false;
    var nextLevel = sim.job.level + 1;
    if (nextLevel >= career.levels.length) {
      EVENTS.emit("notification", { text: sim.name + " is already at the top of the " + career.name + " career!", type: "info" });
      return false;
    }
    var levelData = career.levels[nextLevel];
    if (!_meetsRequirements(sim, levelData.req)) {
      EVENTS.emit("notification", { text: sim.name + " doesn't meet requirements for " + levelData.title + " yet.", type: "warning" });
      return false;
    }
    if (sim.job.performance < 70) {
      EVENTS.emit("notification", { text: sim.name + " needs better job performance for a promotion.", type: "warning" });
      return false;
    }
    var oldTitle = career.levels[sim.job.level].title;
    sim.job.level = nextLevel;
    sim.job.dailyPay = levelData.pay;
    sim.job.performance = 50;
    EVENTS.emit("notification", {
      text: sim.name + " was promoted from " + oldTitle + " to " + levelData.title + "!",
      type: "good"
    });
    return true;
  }

  /**
   * Fire the sim from their job.
   */
  function fire(sim) {
    if (!sim.job) return false;
    var career = CAREERS[sim.job.career];
    var oldTitle = career ? career.levels[sim.job.level].title : "employee";
    sim.job = null;
    EVENTS.emit("notification", { text: sim.name + " was fired from their job as " + oldTitle + "!", type: "bad" });
    return true;
  }

  /**
   * Get work status string based on current time.
   */
  function getWorkStatus(sim) {
    if (!sim.job) return "off";
    var career = CAREERS[sim.job.career];
    if (!career) return "off";

    var t = _getTime();
    var isWorkDay = career.workDays.indexOf(t.dayOfWeek) !== -1;
    if (!isWorkDay) return "weekend";

    var startHour = career.workHours[0];
    var endHour = career.workHours[1];
    if (t.hour >= startHour && t.hour < endHour) return "working";
    if (t.hour < startHour) return "off";
    return "late";
  }

  /**
   * Should the sim go to work right now?
   */
  function shouldGoToWork(sim) {
    if (!sim.job) return false;
    var career = CAREERS[sim.job.career];
    if (!career) return false;
    var t = _getTime();
    if (career.workDays.indexOf(t.dayOfWeek) === -1) return false;
    var startHour = career.workHours[0];
    return t.hour >= startHour && t.hour < career.workHours[1];
  }

  /**
   * Process a work shift tick. Adds pay, skill XP, performance.
   */
  function workShift(sim) {
    if (!sim.job) return;
    var career = CAREERS[sim.job.career];
    if (!career) return;

    // Skill gain from working
    if (career.skill && SIM && SIM.gainSkill) {
      SIM.gainSkill(sim, career.skill, 0.01);
    }

    // Performance fluctuation
    var moodBonus = 0;
    if (sim.mood === "elated") moodBonus = 0.3;
    else if (sim.mood === "happy") moodBonus = 0.15;
    else if (sim.mood === "uncomfortable") moodBonus = -0.1;
    else if (sim.mood === "miserable") moodBonus = -0.25;

    sim.job.performance = Math.max(0, Math.min(100, sim.job.performance + 0.05 + moodBonus));

    // Small energy drain while working
    if (SIM && SIM.modifyNeed) {
      SIM.modifyNeed(sim, "energy", -0.02);
      SIM.modifyNeed(sim, "fun", -0.01);
    }
  }

  /**
   * Get the daily pay for a sim's current job level.
   */
  function getDailyPay(sim) {
    if (!sim.job) return 0;
    return sim.job.dailyPay || 0;
  }

  // ============================================================
  //  Bills
  // ============================================================

  /**
   * Process daily bill deduction from household funds.
   */
  function processDailyBills() {
    var bills = STATE.bills;
    if (!bills) return;

    var amount = bills.dailyDue + (bills.overdue || 0);
    var oldFunds = STATE.funds;

    if (STATE.funds >= amount) {
      STATE.funds -= amount;
      bills.overdue = 0;
      bills.lastPaid = STATE.time.day;
    } else {
      // Partial payment
      var paid = STATE.funds;
      STATE.funds = 0;
      bills.overdue = amount - paid;
      EVENTS.emit("notification", { text: "Bills partially paid! Overdue: $" + bills.overdue, type: "warning" });
    }

    EVENTS.emit("funds.change", { old: oldFunds, newFunds: STATE.funds, reason: "bills" });
    EVENTS.emit("bill.due", { amount: amount });
  }

  /**
   * Adjust the daily bill amount.
   */
  function adjustBills(delta) {
    if (!STATE.bills) return;
    STATE.bills.dailyDue = Math.max(0, STATE.bills.dailyDue + delta);
  }

  /**
   * Get current bill info.
   */
  function getBills() {
    return STATE.bills || { dailyDue: 0, lastPaid: 0, overdue: 0 };
  }

  // ============================================================
  //  Funds
  // ============================================================

  function addFunds(amount, reason) {
    var old = STATE.funds;
    STATE.funds += amount;
    EVENTS.emit("funds.change", { old: old, newFunds: STATE.funds, reason: reason || "income" });
  }

  function deductFunds(amount, reason) {
    var old = STATE.funds;
    STATE.funds = Math.max(0, STATE.funds - amount);
    EVENTS.emit("funds.change", { old: old, newFunds: STATE.funds, reason: reason || "expense" });
  }

  function canAfford(amount) {
    return STATE.funds >= amount;
  }

  function getFunds() {
    return STATE.funds;
  }

  // ============================================================
  //  Shopping
  // ============================================================

  /**
   * Get all buyable objects from the world catalog with prices.
   */
  function getCatalog() {
    if (!WORLD || !WORLD.OBJECT_CATALOG) return {};
    var catalog = {};
    for (var key in WORLD.OBJECT_CATALOG) {
      var item = WORLD.OBJECT_CATALOG[key];
      catalog[key] = {
        name: item.name,
        category: item.category,
        cost: item.cost,
        size: item.size
      };
    }
    return catalog;
  }

  /**
   * Purchase an object, deduct funds, add to inventory.
   */
  function purchase(objectKey) {
    if (!WORLD || !WORLD.OBJECT_CATALOG) return false;
    var item = WORLD.OBJECT_CATALOG[objectKey];
    if (!item) {
      EVENTS.emit("notification", { text: "Item not found: " + objectKey, type: "warning" });
      return false;
    }
    if (!canAfford(item.cost)) {
      EVENTS.emit("notification", { text: "Cannot afford " + item.name + " ($" + item.cost + ")", type: "warning" });
      return false;
    }
    deductFunds(item.cost, "purchase: " + item.name);
    _inventory.push({
      catalogKey: objectKey,
      name: item.name,
      cost: item.cost,
      category: item.category
    });
    EVENTS.emit("notification", { text: "Purchased " + item.name + " for $" + item.cost, type: "good" });
    return true;
  }

  /**
   * Sell a placed object from the lot. 50% refund.
   */
  function sellObject(objectId) {
    if (!WORLD || !STATE.lot) return false;
    var obj = WORLD.getObject(objectId);
    if (!obj) {
      EVENTS.emit("notification", { text: "Object not found.", type: "warning" });
      return false;
    }
    var catalogEntry = WORLD.OBJECT_CATALOG[obj.catalogKey];
    if (!catalogEntry) return false;
    var refund = Math.floor(catalogEntry.cost * 0.5);
    addFunds(refund, "sold: " + catalogEntry.name);
    WORLD.removeObject(objectId);
    EVENTS.emit("notification", { text: "Sold " + catalogEntry.name + " for $" + refund, type: "info" });
    return true;
  }

  /**
   * Get unplaced purchased objects.
   */
  function getInventory() {
    return _inventory.slice();
  }

  /**
   * Remove an item from inventory by index (called when placing).
   */
  function _removeFromInventory(index) {
    if (index >= 0 && index < _inventory.length) {
      _inventory.splice(index, 1);
    }
  }

  // ============================================================
  //  Build Mode Costs
  // ============================================================

  function getWallCost() {
    return CONFIG.WALL_COST || 50;
  }

  function getFloorCost() {
    return CONFIG.FLOOR_COST || 30;
  }

  // ============================================================
  //  Daily Events
  // ============================================================

  /**
   * Process random daily economic events (promotions, firings).
   */
  function processDailyEvents() {
    if (!STATE.sims) return;
    for (var i = 0; i < STATE.sims.length; i++) {
      var sim = STATE.sims[i];
      if (!sim.job) continue;

      // Performance-based events
      if (sim.job.performance >= 90) {
        // High chance of promotion
        if (Math.random() < 0.15) {
          promote(sim);
        }
      } else if (sim.job.performance <= 20) {
        // Risk of firing
        if (Math.random() < 0.1) {
          fire(sim);
        }
      } else if (sim.job.performance >= 75) {
        // Small bonus
        if (Math.random() < 0.05) {
          var bonus = Math.floor(sim.job.dailyPay * 0.5);
          addFunds(bonus, "performance bonus: " + sim.name);
          EVENTS.emit("notification", { text: sim.name + " received a $" + bonus + " performance bonus!", type: "good" });
        }
      }

      // Unlucky sims have higher firing risk
      if (sim.traits && sim.traits.indexOf("unlucky") !== -1 && sim.job) {
        if (Math.random() < 0.05) {
          fire(sim);
        }
      }

      // Lucky sims have higher promotion chance
      if (sim.traits && sim.traits.indexOf("lucky") !== -1 && sim.job && sim.job.performance >= 60) {
        if (Math.random() < 0.1) {
          promote(sim);
        }
      }
    }
  }

  /**
   * Roll for a single random economic event.
   */
  function getRandomEvent() {
    var events = [
      { type: "bonus",   chance: 0.03, text: "Work bonus!" },
      { type: "expense", chance: 0.05, text: "Unexpected expense." },
      { type: "refund",  chance: 0.02, text: "Tax refund!" }
    ];
    for (var i = 0; i < events.length; i++) {
      if (Math.random() < events[i].chance) {
        return events[i];
      }
    }
    return null;
  }

  // ============================================================
  //  Event Listeners
  // ============================================================

  // Listen for day changes to process bills and daily events
  EVENTS.on("time.day", function (data) {
    if (STATE.time.day !== _lastBillDay) {
      _lastBillDay = STATE.time.day;
      processDailyBills();
      processDailyEvents();
    }
  });

  // Pay daily wages at end of work day (when hour hits 18)
  EVENTS.on("time.hour", function (data) {
    if (data.hour === 18 && STATE.sims) {
      for (var i = 0; i < STATE.sims.length; i++) {
        var sim = STATE.sims[i];
        if (sim.job) {
          var career = CAREERS[sim.job.career];
          if (career && career.workDays.indexOf(STATE.time.dayOfWeek) !== -1) {
            var pay = sim.job.dailyPay;
            addFunds(pay, "wages: " + sim.name);
          }
        }
      }
    }
  });

  // Handle sim death — fire them from job
  EVENTS.on("sim.death", function (data) {
    if (data.sim && data.sim.job) {
      data.sim.job = null;
    }
  });

  // ============================================================
  //  Public API
  // ============================================================
  window.ECONOMY = {
    CAREERS: CAREERS,

    // Careers
    assignCareer: assignCareer,
    promote: promote,
    fire: fire,
    getWorkStatus: getWorkStatus,
    shouldGoToWork: shouldGoToWork,
    workShift: workShift,
    getDailyPay: getDailyPay,

    // Bills
    processDailyBills: processDailyBills,
    adjustBills: adjustBills,
    getBills: getBills,

    // Funds
    addFunds: addFunds,
    deductFunds: deductFunds,
    canAfford: canAfford,
    getFunds: getFunds,

    // Shopping
    getCatalog: getCatalog,
    purchase: purchase,
    sellObject: sellObject,
    getInventory: getInventory,

    // Build mode
    getWallCost: getWallCost,
    getFloorCost: getFloorCost,

    // Events
    processDailyEvents: processDailyEvents,
    getRandomEvent: getRandomEvent
  };

})();
