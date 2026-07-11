# v1.1 Verification Report

**Gate:** `node harness.js` from this directory. Exit 0 = merge. Exit 1 = do not merge.

## Result: ✅ PASSED — 11/11 hard checks (12,000 frames / 7 sim-days)

| Check | Result |
|---|---|
| C1 all modules load (read from index.html) | PASS — 10 |
| C2 globals exported | PASS |
| C3 zero tick errors [Bug 1] | PASS — 12,000 frames clean |
| C4 WORLD supplies usable interactions | PASS — 32/32 |
| C4b AI can consume them [Bug 2] | PASS — AI scored 32 |
| C5 actions started [Bug 3] | PASS — 1,343 |
| C6 actions complete [Bug 3] | PASS — 1,342 |
| C7 no sim wedged | PASS |
| C8 needs actually restore | PASS — 32/32 tracks peaked >85 |
| C9 working-state discriminator (§5) | PASS |
| C10 sims on-canvas, no px/cell mixup (§2) | PASS |

The same gate run against the original v1.0 **fails 5 checks** and exits 1. It catches every bug it was built for.

## Kimi's v1.1 claims — audited

| Claim | Verdict |
|---|---|
| Bug 1 (renderer `def`) fixed | ✅ **TRUE** — verified, 0 tick errors |
| Bug 2 (AI↔World) fixed | ✅ **TRUE** — verified, AI now scores 32 actions (was 0) |
| Bug 3 (action completion) fixed | ✅ **TRUE** — verified, 1,342 of 1,343 complete |
| S4 (stats counters) fixed | ❌ **FALSE AS SHIPPED** — see below |
| S8 (time float drift) fixed | ❌ **FALSE** — `time.minute` still `59.99999999998749` |
| "Funds dropped to §19,955 (Make Bed cost §45)" | ❌ **FALSE** — `make_bed` has no `cost` field. §45 is the *gourmet meal* price. |

### The S4 failure is the interesting one
Kimi wrote the stats listeners **correctly** — into `init.js`. But `index.html` loads **`init-v2.js`**. The patch was real, well-written, and **never executed.**

This is precisely the duplicate-file drift flagged in the original audit (FINDINGS #1–2) and scheduled as sprint item S3. It cost a whole work item.

**Two fixes applied here:**
1. **S3 done** — deleted the 6 duplicate `work-*` dirs and the dead `init.js`/`ui.js`; `-v2` files promoted to canonical names; `index.html` repointed. 21 JS files → 11. 776K → 404K.
2. **The harness now reads its load order from `index.html`** rather than a hardcoded list. A gate that tests a different file set than the browser loads is worse than no gate. It can no longer happen.

## Still open (P1, not merge blockers)
- **S8** — clock float drift. Derive time from integer `totalTicks` (see INTERFACES.md §3).
- **S11** — notifications never surface (0 after 7 sim-days).
- **`conversations: 0`** — sims never actually talk across a full week. The social system exists but is not firing. Worth a look before calling the game "alive."
- **`resultsProduced: 1339`** is a junk-drawer counter (it increments for every non-meal action). Needs a real definition.

## Not yet verified
**Browser.** Everything above is headless Node. Sprint item S6 (Remy, Chromebook) still stands — headless is not a browser.
