/**
 * levels.js — turn a raw GEX matrix frame into chart-ready levels.
 *
 * A "frame" is one snapshot of the strike × expiry GEX board — the exact
 * frame shape gex-replay-basic publishes in its data/<slug>/<date>.json.gz
 * bundles (see that repo's docs/DATA_PIPELINE.md for the schema).
 * Everything here is pure functions — no DOM, no fetch — so the same
 * module can be unit-tested headless in Node.
 *
 * Exposed levels per frame:
 *   callWall  — strike with the largest positive total GEX (dealer supply)
 *   putWall   — strike with the most negative total GEX (dealer demand)
 *   oiKing    — strike flagged as the OI king (largest OI concentration)
 *   volKing   — strike flagged as the Vol king (largest volume concentration)
 *   gex0      — approximate zero-gamma level: the price where net GEX
 *               (summed across visible expiries) crosses zero nearest spot.
 *               Interpolated between strikes, so it can be fractional.
 *   netExposure — the board's headline net dealer exposure (numeric, $)
 *   spot      — underlying price at capture time
 */

/**
 * Snap a timestamp onto the chart's bar grid: the latest bar time <= t
 * (binary search; null if t predates the first bar). Lightweight Charts
 * merges every series' timestamps into one time axis, so a level/orb point
 * between two bars would inject an empty slot and spread the candles apart —
 * every point we draw must sit exactly on an existing bar time.
 */
export function snapToBar(t, barTimes) {
  if (!barTimes?.length || t < barTimes[0]) return null;
  let lo = 0, hi = barTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (barTimes[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return barTimes[lo];
}

/** Parse a display value like "-560.16M", "25.2K", "1.72B", "0" into a number. */
export function parseValue(text) {
  if (text == null) return 0;
  const m = String(text).trim().match(/^(-?[\d.]+)\s*([KMBT]?)$/i);
  if (!m) return 0;
  const mult = { '': 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()] ?? 1;
  return parseFloat(m[1]) * mult;
}

/** Sum a row's GEX across all expiries. */
function rowTotal(row) {
  return row.values.reduce((s, v) => s + parseValue(v.text), 0);
}

/**
 * Derive all levels for one frame.
 * @param {object} frame — one snapshot: { rows, expiries, price, netExposure, capturedAt }
 * @returns {object} { time, spot, callWall, putWall, oiKing, volKing, gex0, netExposure }
 */
export function deriveLevels(frame) {
  const spot = parseFloat(frame.price);
  const totals = frame.rows
    .map((row) => ({ strike: row.strike, total: rowTotal(row), row }))
    .sort((a, b) => a.strike - b.strike);

  let callWall = null, putWall = null, oiKing = null, volKing = null;
  let maxPos = 0, minNeg = 0, oiKingGex = 0, volKingGex = 0;
  for (const t of totals) {
    if (t.total > maxPos) { maxPos = t.total; callWall = t.strike; }
    if (t.total < minNeg) { minNeg = t.total; putWall = t.strike; }
    if (t.row.values.some((v) => v.oiKing)) { oiKing = t.strike; oiKingGex = Math.abs(t.total); }
    if (t.row.values.some((v) => v.volKing)) { volKing = t.strike; volKingGex = Math.abs(t.total); }
  }

  return {
    time: Math.floor(Date.parse(frame.capturedAt) / 1000),
    spot,
    callWall,
    putWall,
    oiKing,
    volKing,
    gex0: findGexZero(totals, spot),
    // Node strengths — fuel for orb sizing (Atlas "Orbs": size/brightness
    // encodes node strength). GEX0 has no magnitude; it's a crossing.
    strength: {
      callWall: maxPos,
      putWall: Math.abs(minNeg),
      oiKing: oiKingGex,
      volKing: volKingGex,
      gex0: 0,
    },
    netExposure: frame.netExposureValue ?? parseValue(String(frame.netExposure).replace(/[$,]/g, '')),
  };
}

/**
 * Approximate zero-gamma level: scan adjacent strike pairs for a sign flip
 * in total GEX and linearly interpolate the crossing price. If several
 * crossings exist, return the one nearest spot. This mirrors gex-replay's
 * GEX0 — an approximation over the visible board, not a true gamma flip.
 */
export function findGexZero(totals, spot) {
  let best = null;
  for (let i = 1; i < totals.length; i++) {
    const a = totals[i - 1], b = totals[i];
    if (a.total === 0) maybe(a.strike);
    if ((a.total < 0 && b.total > 0) || (a.total > 0 && b.total < 0)) {
      const frac = Math.abs(a.total) / (Math.abs(a.total) + Math.abs(b.total));
      maybe(a.strike + frac * (b.strike - a.strike));
    }
  }
  function maybe(px) {
    if (best === null || Math.abs(px - spot) < Math.abs(best - spot)) best = px;
  }
  return best;
}

/**
 * Per-strike "heaviness" — the Atlas orb field.
 *
 * Two modes:
 *   'net'   — orb strength = |total GEX| at that snapshot: where structure
 *             SITS. Sign = GEX sign (teal positive / purple negative).
 *   'delta' — orb strength = |change in total GEX| vs the previous snapshot:
 *             where money is FLOWING in or out right now (gex-replay's
 *             "Movers" concept). Sign = direction of the change
 *             (building = +, draining = −). First frame has no delta.
 *
 * Strikes are ranked by peak strength in the chosen mode, top maxStrikes kept.
 * Pass range = {min, max} (a padded price range) to keep the field on strikes
 * price can actually interact with — without it the budget goes to far-OTM
 * round strikes (600 / 1200 / 2500 style OI magnets) that sit nowhere near a
 * candle. Far structure still shows via the level lines and the heatmap board.
 *
 * rankFrom (a unix-seconds time) ranks strikes by their peak strength AT OR
 * AFTER that time, and drops strikes with no activity in that window. This
 * ties the chosen strikes to the view actually on screen (e.g. the recent
 * session), so overnight magnets whose orbs sit off to the left don't win the
 * budget and leave the visible chart empty. Points themselves are still built
 * across the whole session, so scrubbing back reveals their history.
 *
 * @returns [{ strike, points: [{ time, strength, sign }] }]
 */
export function buildStrikeOrbs(frames, { maxStrikes = 14, mode = 'net', range = null, snapTo = null, rankFrom = null } = {}) {
  const perFrame = frames.map((frame) => {
    const raw = Math.floor(Date.parse(frame.capturedAt) / 1000);
    const time = snapTo ? snapToBar(raw, snapTo) : raw;
    const totals = new Map();
    for (const row of frame.rows) {
      totals.set(row.strike, row.values.reduce((s, v) => s + parseValue(v.text), 0));
    }
    return { time, totals };
  });

  // Per-strike point series in the chosen mode. When several frames snap to
  // the same bar, the last one wins (the bar's closing state).
  const strikes = new Set(perFrame.flatMap((f) => [...f.totals.keys()]));
  const built = new Map();
  for (const strike of strikes) {
    if (range && (strike < range.min || strike > range.max)) continue;
    const points = [];
    const push = (p) => {
      if (points.length && points[points.length - 1].time === p.time) points[points.length - 1] = p;
      else points.push(p);
    };
    for (let i = 0; i < perFrame.length; i++) {
      const { time, totals } = perFrame[i];
      if (time == null) continue; // frame predates the bar series
      const total = totals.get(strike) ?? 0;
      if (mode === 'delta') {
        if (i === 0) continue; // no previous frame to diff against
        const prev = perFrame[i - 1].totals.get(strike) ?? 0;
        const d = total - prev;
        push({ time, strength: Math.abs(d), sign: Math.sign(d) });
      } else {
        push({ time, strength: Math.abs(total), sign: Math.sign(total) });
      }
    }
    built.set(strike, points);
  }

  return [...built.entries()]
    .map(([strike, points]) => {
      // Rank by peak strength within the ranking window (or the whole session
      // when rankFrom is null). A strike with no points in the window ranks 0
      // and drops out — that's how off-screen overnight magnets are excluded.
      const inWindow = rankFrom == null ? points : points.filter((p) => p.time >= rankFrom);
      return { strike, points, peak: Math.max(0, ...inWindow.map((p) => p.strength)) };
    })
    .filter((o) => o.peak > 0)
    .sort((a, b) => b.peak - a.peak)
    .slice(0, maxStrikes)
    .sort((a, b) => a.strike - b.strike)
    .map(({ strike, points }) => ({ strike, points }));
}

/**
 * Convert a day bundle (array of frames) into per-level time series,
 * ready to hand to the chart as stepped lines.
 * @returns {object} map of levelKey -> [{ time, value }]
 */
export function buildLevelSeries(frames, { snapTo = null } = {}) {
  const keys = ['callWall', 'putWall', 'oiKing', 'volKing', 'gex0'];
  const series = Object.fromEntries(keys.map((k) => [k, []]));
  const net = [];
  const push = (arr, p) => {
    // several frames snapping to one bar → last one wins
    if (arr.length && arr[arr.length - 1].time === p.time) arr[arr.length - 1] = p;
    else arr.push(p);
  };
  for (const frame of frames) {
    const lv = deriveLevels(frame);
    const time = snapTo ? snapToBar(lv.time, snapTo) : lv.time;
    if (time == null) continue; // frame predates the bar series
    for (const k of keys) {
      if (lv[k] != null) push(series[k], { time, value: lv[k], strength: lv.strength[k] });
    }
    push(net, { time, value: lv.netExposure });
  }
  return { levels: series, netExposure: net };
}
