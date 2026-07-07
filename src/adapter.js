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

export async function listSeries() {
  const res = await fetch('data/sample/manifest.json');
  return (await res.json()).series;
}

export async function sampleAdapter(symbol = 'MU') {
  const series = (await listSeries()).find((s) => s.symbol === symbol);
  if (!series) throw new Error(`No sample series for ${symbol}`);
  const gexFiles = Array.isArray(series.gex) ? series.gex : [series.gex];
  const [barsFile, ...gexBundles] = await Promise.all([
    fetch(series.bars).then((r) => r.json()),
    ...gexFiles.map((f) => fetch(f).then((r) => r.json())),
  ]);
  const frames = gexBundles
    .flatMap((b) => (b.slim ? expandSlim(b) : b.frames))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  return {
    symbol: barsFile.symbol,
    bars: barsFile.bars,
    frames,
    derivedFrom: barsFile.derivedFrom ?? null,
    note: series.note ?? null,
  };
}

/**
 * Expand the slim day format (scripts/slim_bundle.py) back into the standard
 * frame shape the rest of the app consumes. Slim rows are
 * [strike, vK1, vK2, ...] with values in $K; kings are per-frame strikes.
 */
function expandSlim(file) {
  return file.frames.map((f) => ({
    capturedAt: new Date(f.t * 1000).toISOString(),
    tradingDay: file.date,
    price: f.price,
    netExposureValue: f.net,
    expiries: f.expiries,
    rows: f.rows.map(([strike, ...vals]) => ({
      strike,
      values: vals.map((v, i) => ({
        text: String(v * 1000),
        oiKing: strike === f.kingOI && i === 0,
        volKing: strike === f.kingVol && i === 0,
      })),
    })),
  }));
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
