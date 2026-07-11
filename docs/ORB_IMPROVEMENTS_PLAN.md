# Atlas — Orb overlay & candle-scaling improvements

> Working plan + progress tracker for the orb/candle UX pass. Update the tracker
> below as tasks complete so work can resume if interrupted.

## Context

Four+ related improvements to the Strike Orb overlay and chart in `atlas-framework`
(a GEX-replay-on-price demo built on Lightweight Charts 4.2.3):

1. **Pick how many strikes show (1–10)** instead of the strength dropdown
   (All / ≥25% / ≥50% / ≥75%).
2. **A more modern orb look** closer to Skylit Atlas "Orbs V2" — softer, glowing,
   visibly heaviest where the strike is strongest. Approach: **improved Lightweight
   Charts markers + a stacked halo**, not a full custom canvas layer.
3. **Answer: what is Δ Flow actually showing?** (below) + a clearer tooltip.
4. **Fix small-looking candles** (noticed on MU).
5. **Free-roam during playback** — no snap-back; pan/zoom freely while playing.
6. **Bottom-right "optimal view" button** — one click to the best candle view.

### What Δ Flow is actually showing

In `levels.js buildStrikeOrbs`, each strike's **total GEX** (summed across visible
expiries) is computed per snapshot. The two orb modes differ only in what "strength"
means:

- **Net** (default): `strength = |total GEX now|`, colored by sign (teal +, purple −).
  → *where dealer structure sits* right now.
- **Δ Flow**: `strength = |total GEX now − total GEX at the previous snapshot|`,
  colored by direction (green = building, red = draining). First snapshot has no Δ.
  → *which strikes moved the most since the last ~2-min frame* ("money in/out").

Ranking uses each strike's session-peak strength, so the two modes can surface a
different top-N. **Caveat:** with net-GEX snapshots, Δ can't distinguish "new money in"
from opposite positioning offsetting it — true attribution needs the call/put flow
split. Only change needed: a one-line tooltip on the Δ chip.

### Why candles look small (root cause)

Levels and orbs are **already excluded** from the price axis
(`autoscaleInfoProvider: () => null` on both level and orb series), so distant MU walls
are *not* compressing the candles. Real cause: on load the view frames the **entire
~465-bar, 2-day session** (`atlas.fit()` → `fitContent()`), and playback re-frames to
the whole session too. At that zoom, 2-min candles are naturally tiny. Fix = frame a
recent window by default and stop force-resetting to the whole session on play.

---

## Changes

### 1. Replace strength dropdown with a 1–10 strike-count control
**`src/app.js`** — state `orbCount: 6` (was `orbMin: 0.25`); `renderOrbs()` passes
`{ maxStrikes: state.orbCount, ... }` to `buildStrikeOrbs` and `0` as the `minFrac`
arg; replace the `minSel` block (~L179–195) with a range slider (1–10, step 1) + live
"`N strikes`" readout. **`src/levels.js`** — none (`buildStrikeOrbs` already takes
`maxStrikes`). **`styles.css`** — slider styling replacing `#orbmin`.

### 2. Improved, softer orb markers (halo + finer ramp)
**`src/chart.js`** — add a second series pool so each strike draws a soft halo *under*
a brighter core (two pools of 12 = 24 series, matching current `ORB_POOL`). In
`renderOrbField()`: gentler curve `t = (strength/max) ** 0.6`; core `size ≈ 0.5+2.0*t`,
opacity `≈ 0.25+0.70*t`; halo `size ≈ core*1.9`, opacity `≈ 0.06+0.16*t`; both
`circle`/`inBar`, mode palette unchanged. `toggleStrikeOrbs()` and clear-slots loop
iterate both pools.

### 3. Fix small candles — frame a recent window, don't reset on play
**`src/chart.js`** — `frameRecent(n)` sets visible logical range to
`{ from: len-n, to: len }` (fallback `fitContent`), exposed on the API; `freezeScale`
adopts the *current* visible range instead of the whole session. **`src/app.js`** —
`loadSeries()` uses `atlas.frameRecent(~130)` instead of `atlas.fit()`. Optional:
`rightPriceScale.scaleMargins { top: 0.12, bottom: 0.12 }`.

### 4. Free-roam during playback (no snap-back)
**`src/chart.js`** — remove the per-tick `setVisibleLogicalRange(cache.userRange)`
re-assertion in `setReplayTime()` (~L303–305). Whitespace-padded extent already
prevents auto-scroll; keep `subscribeVisibleLogicalRangeChange → refreezePriceToView`
so price refits on user gesture.

### 5. "Optimal view" button (bottom-right of the chart)
**`index.html`** — `<button id="fitBtn" class="fit-btn" title="Best fit">⤢</button>`
in the chart column. **`styles.css`** — `.chart-col { position: relative }`, `.fit-btn`
absolute bottom-right, dark chip styling, above canvas. **`src/app.js`** — wire to
`atlas.frameRecent(~130)`.

### 6. Δ Flow tooltip (tiny)
**`src/app.js`** — Δ chip `title`: "Δ Flow: change in each strike's net GEX vs the
previous ~2-min snapshot (building green / draining red). Net snapshots can't separate
new money from offsetting flow."

---

## Files touched
- `src/app.js` — orb-count state + slider, `renderOrbs` args, default framing, `#fitBtn` wiring, Δ tooltip
- `src/chart.js` — dual orb pool + softer ramp, `frameRecent`, `freezeScale` keeps current view, drop per-tick snap-back
- `styles.css` — slider styling + floating `.fit-btn`
- `index.html` — add `#fitBtn`
- `src/levels.js` — none

## Progress tracker
Status: `[ ]` todo · `[~]` in progress · `[x]` done.

- [x] **0. Persist plan** — this file (`docs/ORB_IMPROVEMENTS_PLAN.md`).
- [x] **1. Strike-count slider (1–10)** — `app.js` `orbCount` + slider; `styles.css .orbcount`.
- [x] **2. Softer orbs** — `chart.js` dual pool (`orbHalo`/`orbCore`) + pow-0.6 ramp.
- [x] **3. Candle framing** — `chart.js frameRecent(n)` (playhead/GEX-edge anchored),
  `app.js` frames the recent **GEX-covered** window (`gexEndTime`) on load; `scaleMargins` added.
- [x] **4. Free-roam during play** — removed the whole `freezeScale` price-pin machinery;
  whitespace-constant extent holds the view put, price autoscales. No snap-back.
- [x] **5. Optimal-view button** — `index.html #fitBtn` + `styles.css .fit-btn` + `app.js` wiring
  (`frameRecent`, anchors to playhead mid-replay). Play reframes once to the start, then leaves the view alone.
- [x] **6. Δ Flow tooltip** — `app.js` clarified.
- [x] **7. Verify** — done in-browser on MU: default view (big candles + orb chain), slider 3/6/10,
  softer halo+core orbs, Δ Flow green/red, free-roam zoom persists during play, ⤢ fit live + mid-replay.

### Post-review change — "heaviest anywhere" orb selection
User feedback: the ±5% price-band filter was misleading — it drew an orb at 1000 (−15M) while hiding
900 (−62M, the actual heaviest / the Put Wall). Atlas shows the heaviest strikes regardless of distance.
Changed to:
- **No price-band filter** — `state.orbRange = null` in `app.js loadSeries`; orbs = top-N strikes by
  peak |net GEX| in the recent window (`rankFrom`), both signs (teal + / purple −).
- **Orbs drive the price axis** — removed `autoscaleInfoProvider: () => null` from the orb series in
  `chart.js`, so the view stretches to keep the heaviest strikes visible (e.g. MU spans 600→1200).
- **Levers for candle size:** the strike-count slider (fewer strikes = tighter range = bigger candles)
  and the Strike-Orbs toggle (off → hidden series don't autoscale → candles hug price again).

### Notes / follow-ups
- `rankFrom` (recent-GEX-window ranking) is still used so the *current* structure wins the budget; the
  new `rankFrom` param lives in `levels.buildStrikeOrbs`.
- **Data quirk:** the GEX scrape starts ~30 min *before* the first price bar and *ends* ~7 h before the
  last bar (after-hours tape has no GEX). So a replay from frame 0 shows empty candles for the first
  few frames, and the default view anchors to the GEX coverage edge, not the last bar. Not a bug.
- Possible future polish: start replay at the first GEX-with-bars frame; per-strike expiry selector.

## Verification
1. `python -m http.server 8000` from repo root → `http://localhost:8000`.
2. **Candles**: MU loads to a recent window with legible candles; play doesn't zoom out.
3. **Count control**: 1–10 slider changes orb-chain count + readout; old dropdown gone.
4. **Look**: orbs are soft glowing dots that grow/brighten with strength; heaviest node largest. Δ Flow flips palette green/red and can change the strike set.
5. **Free-roam**: play, then pan/zoom — view stays put; candles keep revealing.
6. **Optimal-view button**: bottom-right ⤢ reframes to the recent-window view anytime.
7. Scrub replay: orbs/levels/candles truncate to playhead correctly.
8. Sanity check SPY, SPX, TSLA.
