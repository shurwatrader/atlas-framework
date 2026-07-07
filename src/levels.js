/**
 * levels.js — turn a raw GEX matrix frame into chart-ready levels.
 *
 * A "frame" is one snapshot of the strike × expiry GEX board
 * (see data/sample/MU_GEXOI_2026-07-05.json for the shape).
 * Everything here is pure functions — no DOM, no fetch — so the same
 * module can be unit-tested headless in Node, exactly like
 * gex-replay's scoring.js.
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
  let maxPos = 0, minNeg = 0;
  for (const t of totals) {
    if (t.total > maxPos) { maxPos = t.total; callWall = t.strike; }
    if (t.total < minNeg) { minNeg = t.total; putWall = t.strike; }
    if (t.row.values.some((v) => v.oiKing)) oiKing = t.strike;
    if (t.row.values.some((v) => v.volKing)) volKing = t.strike;
  }

  return {
    time: Math.floor(Date.parse(frame.capturedAt) / 1000),
    spot,
    callWall,
    putWall,
    oiKing,
    volKing,
    gex0: findGexZero(totals, spot),
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
 * Convert a day bundle (array of frames) into per-level time series,
 * ready to hand to the chart as stepped lines.
 * @returns {object} map of levelKey -> [{ time, value }]
 */
export function buildLevelSeries(frames) {
  const keys = ['callWall', 'putWall', 'oiKing', 'volKing', 'gex0'];
  const series = Object.fromEntries(keys.map((k) => [k, []]));
  const net = [];
  for (const frame of frames) {
    const lv = deriveLevels(frame);
    for (const k of keys) {
      if (lv[k] != null) series[k].push({ time: lv.time, value: lv[k] });
    }
    net.push({ time: lv.time, value: lv.netExposure });
  }
  return { levels: series, netExposure: net };
}
