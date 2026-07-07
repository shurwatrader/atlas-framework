/**
 * adapter.js — data-source adapters.
 *
 * Atlas is deliberately split so the chart never knows where data came from.
 * Today there are two adapters:
 *
 *   sampleAdapter  — reads the static JSON in data/sample/ (the gex-replay
 *                    scrape format + a bars file). This is the demo path.
 *   quantumAdapter — STUB. The shape Quantum would fill in if the terminal
 *                    exposes its data directly (see docs/DATA_CONTRACT.md).
 *
 * Both must resolve to the same normalized shape:
 *   { bars: [{t,o,h,l,c,v}], frames: [rawGexFrame, ...] }
 */

export async function sampleAdapter() {
  const [barsRes, gexRes] = await Promise.all([
    fetch('data/sample/MU_bars_5m.json'),
    fetch('data/sample/MU_GEXOI_2026-07-05.json'),
  ]);
  const barsFile = await barsRes.json();
  const gexFile = await gexRes.json();
  return { symbol: barsFile.symbol, bars: barsFile.bars, frames: gexFile.frames };
}

/**
 * The production adapter Quantum could back with real endpoints.
 * Expected endpoints (see docs/DATA_CONTRACT.md for full schemas):
 *   GET /api/v1/bars/{symbol}?tf=5m           -> OHLCV bars
 *   GET /api/v1/gex-all/{symbol}?expiries=5   -> full strike/expiry board
 *   WS  /stream/{symbol}                      -> incremental frame + bar pushes
 */
export async function quantumAdapter(/* symbol, timeframe */) {
  throw new Error(
    'quantumAdapter is a stub — wire it to the Quantum Terminal API. ' +
    'See docs/DATA_CONTRACT.md for the expected endpoints and schemas.'
  );
}
