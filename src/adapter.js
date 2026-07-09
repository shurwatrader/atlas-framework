/**
 * adapter.js — data-source adapters.
 *
 * Atlas is deliberately split so the chart never knows where data came from.
 * Today there are two adapters:
 *
 *   replayAdapter  — reads a gex-replay-basic data folder VERBATIM: the same
 *                    data/manifest.json and data/<slug>/<date>.json.gz bundles
 *                    that repo publishes. Atlas ships with a copy in ./data,
 *                    or point ?source=<url> at a live gex-replay-basic
 *                    deployment and read its published snapshots directly.
 *                    Bars are the one thing Atlas adds on top (data/bars/).
 *   quantumAdapter — STUB. The shape Quantum would fill in if the terminal
 *                    exposes its data directly (see docs/DATA_CONTRACT.md).
 *
 * Both must resolve to the same normalized shape:
 *   { bars: [{t,o,h,l,c,v}], frames: [rawGexFrame, ...] }
 */

// Where the gex-replay-basic data folder lives. Default: the copy bundled in
// this repo. Override per-visit with ?source=… (no trailing slash needed),
// e.g. ?source=https://shurwatrader.github.io/gex-replay-basic
const SOURCE = (
  new URLSearchParams(location.search).get('source') || '.'
).replace(/\/+$/, '');

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Same decompression path as gex-replay-basic's readBundle().
async function fetchBundle(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!url.endsWith('.gz')) return res.json();
  const ds = new DecompressionStream('gzip');
  const text = await new Response(res.body.pipeThrough(ds)).text();
  return JSON.parse(text);
}

// Finest bar file available wins: 2m (matches the snapshot cadence; its
// overnight stretch is 5m — no overnight 1m feed in the demo), else 5m.
async function fetchBars(symbol) {
  try { return await fetchJson(`data/bars/${symbol}_2m.json`); }
  catch { return fetchJson(`data/bars/${symbol}_5m.json`); }
}

/** The parent repo's manifest, as-is: [{ slug, symbol, title, dates }]. */
export async function listSeries() {
  return (await fetchJson(`${SOURCE}/data/manifest.json`)).series;
}

export async function replayAdapter(symbol = 'MU') {
  const series = (await listSeries()).find((s) => s.symbol === symbol);
  if (!series) throw new Error(`No series for ${symbol} in the manifest`);

  // Every trading day the parent publishes for this series, oldest first —
  // Atlas's whole point is levels over time, so load the full history.
  const dates = (series.dates || [])
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const [bars, ...bundles] = await Promise.all([
    fetchBars(symbol), // bars are Atlas-local, never remote
    ...dates.map((d) => fetchBundle(`${SOURCE}/${d.file}`)),
  ]);

  const frames = bundles
    .flatMap((b) => b.frames || [])
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  return {
    symbol: bars.symbol ?? symbol,
    bars: bars.bars,
    frames,
    derivedFrom: bars.derivedFrom ?? null,
    note: bars.note ?? null,
  };
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
