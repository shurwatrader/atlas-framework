# Atlas — GEX Replay on price (framework proposal)

**A build on top of [gex-replay-basic](https://github.com/shurwatrader/gex-replay-basic).**
That repo replays the strike × expiry GEX heatmap frame by frame; Atlas takes the
*same data, the same replay transport* and puts it **on a price chart**:
candlesticks with dealer-positioning levels (call/put walls, OI/Vol kings,
zero-gamma) drawn as dotted lines that evolve through the session, a
strength-sized orb field, a flow pane underneath — and the heatmap board
docked beside the chart, scrubbing in sync.

Built as a proposal for the Quantum Terminal — the idea being that the matrix
view already computes everything needed; Atlas is **the same data, rotated
90°**: instead of a strike × expiry board at one moment, it shows the *derived
levels* over *time*, on top of price. That's the view traders actually trade
from. (Concept source: [Skylit's Atlas](https://docs.skylit.ai/atlas/overview).)

**Live demo:** https://shurwatrader.github.io/atlas-framework/

No build tooling — static files, same philosophy as gex-replay-basic. Locally:

```bash
python -m http.server 8000   # from the repo root
# open http://localhost:8000
```

> SPX bars are **derived from SPY × 10.03** (no direct index bars in the demo
> feed) — which doubles as a working example of Skylit's "Derived Orbs"
> cross-product mapping, applied to price.

---

## How this extends gex-replay-basic

| | gex-replay-basic | Atlas (this repo) |
|---|---|---|
| **View** | strike × expiry heatmap, one frame at a time | candles + levels + orbs over the whole session, heatmap as sidecar |
| **Data** | `data/manifest.json` + `data/<slug>/<date>.json.gz` | **identical files, consumed verbatim** |
| **Replay** | play / pause / step / scrub | same transport, same shortcuts — driving chart *and* board together |
| **Adds** | — | OHLCV bars (`data/bars/`), level math (`src/levels.js`), Lightweight Charts rendering |

Concretely, "built on top of" means:

- **Same data, byte for byte.** Atlas reads gex-replay-basic's published
  `data/` folder as-is — same manifest, same gzipped day bundles, same frame
  schema (documented in that repo's
  [`docs/DATA_PIPELINE.md`](https://github.com/shurwatrader/gex-replay-basic/blob/main/docs/DATA_PIPELINE.md)).
  `scripts/pull_data.py --source ../gex-replay-basic` syncs a copy in, or open
  the app with `?source=https://shurwatrader.github.io/gex-replay-basic` and it
  reads the live deployment's snapshots directly — no copy at all. When the
  scraper publishes a new day there, Atlas gains it for free.
- **Same replay transport.** ⏮ ◀ ▶ ⏭, scrubber, Step (2m/10m/30m/1h), Speed,
  and the same keys: **Space** play/pause · **← / →** step · **Home / End**
  first/last. Same Trading Day + Snapshot (ET) readout, same 8 PM ET
  trading-day roll.
- **Same board.** The heatmap sidecar is gex-replay-basic's grid (its
  diverging purple→teal color scheme, ~40 heaviest strikes), docked beside the
  chart and locked to the playhead.
- **Honest replay.** Scrub to 10:14 and the chart shows *only what was known
  at 10:14* — candles, levels and orbs are truncated to the playhead
  (Skylit's "Scroll as Replay"). The newest frame = the full live view.

## What the demo shows

- **Ticker switcher** — MU, SPY, SPX (derived), TSLA, straight from the
  gex-replay-basic manifest, each pairing real 5m bars with that ticker's
  scraped GEX-OI board
- **Candlestick chart** (real 5m OHLCV, all sessions incl. overnight)
- **Replay transport** — scrub/play the session and watch price, levels, orbs
  and the heatmap advance together, frame by frame
- **Strike Orbs** — the heatmap's pressure field drawn on price: the
  heaviest strikes **within the session's traded range (±5%)** each get an
  orb chain across time, with **opacity + size scaling with |total GEX|** —
  the same values and hues that color the board's cells (teal positive /
  purple negative), so an orb chain and its board row read as one thing.
  Far-OTM OI magnets stay off the chart (they're on the board, and the wall
  lines still point at them); candles alone drive the price axis, so the
  view hugs price action instead of zooming out to fit distant strikes.
  Skylit's Orbs encode strength as brightness/size; same idea. Toggleable
  like any level.
- **Orb strength filter** — a Min-Clamp dropdown (default **Strong ≥25%**)
  hides orbs weaker than that fraction of the session's strongest node, so
  the field shows conviction instead of clutter
- **Δ Flow mode** — flips the orb field from *where structure sits* (net) to
  *where money is moving* (change vs previous snapshot: building green /
  draining red — gex-replay's "Movers," drawn on the price chart). The two
  modes rank strikes independently, so Δ surfaces active strikes that net
  totals hide. **Caveat:** with net-GEX snapshots, Δ shows net change per
  interval — it cannot distinguish "new money in" from opposite positioning
  offsetting it. True attribution needs the call/put flow split
  (DATA_CONTRACT §4).
- **Heatmap sidecar** — the gex-replay-basic board at the playhead frame,
  docked beside the chart (on by default; toggleable from the chip bar)
- **Dealer levels as indicators** — stepped dotted lines, one point per GEX
  snapshot: a wall or king simply re-positions every ~2 min if it moves (no
  markers on the lines — pressure/strength lives in the orb field):
  - **Call Wall** — strike with the largest positive total GEX
  - **Put Wall** — strike with the most negative total GEX
  - **OI King / Vol King** — the flagged concentration strikes
  - **GEX0 (Γ)** — interpolated zero-gamma crossing nearest spot
- **Level toggle chips** (like Atlas' GEX / VEX / Derived tabs)
- **Flow pane** — placeholder signed volume histogram (see limitations)
- Net exposure readout in the header, tracking the playhead

The sample spans **two trading days** (7/5 + a full 7/6 session — ~465
snapshots per ticker at 2-min cadence, 8 PM ET overnight open through the
next afternoon), so the orb field runs across the whole chart, Atlas-style.
An orb column is drawn per captured snapshot — coverage is purely a function
of how much history the parent repo publishes.

The gzipped day bundles are compact — a full session of every strike, every
2 minutes, is **1.5–4 MB per ticker** — which doubles as a sizing proof for
DATA_CONTRACT §3: server-side snapshot retention is cheap.

All level math lives in [`src/levels.js`](src/levels.js) — pure functions,
testable headless in Node.

## Architecture

```
 gex-replay-basic ──▶ ┌────────────────┐    ┌───────────────┐    ┌──────────────┐
 data/ (verbatim)     │  adapter.js    │───▶│  levels.js    │───▶│  chart.js    │
 Quantum API later    │  (data source) │    │  (pure math)  │    │  (rendering) │
                      └────────────────┘    └───────────────┘    └──────────────┘
                                                walls, kings,       Lightweight Charts
                                                GEX0, net GEX       candles + levels + flow
```

The chart never knows where data came from. Swapping the gex-replay-basic
feed for a real Quantum feed means implementing **one function**
(`quantumAdapter` in [`src/adapter.js`](src/adapter.js)) against the endpoints
described in [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

## Why this is worth building (the pitch)

1. **The matrix answers "where is structure?" — Atlas answers "is it holding?"**
   Walls and GEX0 only mean something relative to price action. Putting them
   *on* the price chart turns a data product into a trading view.
2. **The terminal already has all the inputs.** GEX (OI), GEX (Vol), VEX, IV,
   per-strike call/put splits — it's all computed for the matrix. Atlas is a
   presentation layer, not a new analytics engine.
3. **History becomes a feature.** Snapshotting levels over time enables replay,
   backtesting ("how often does price reject the call wall?"), and alerting
   ("price within 0.25% of put wall") — none of which a live-only matrix can do.
4. **It's the view competitors lead with.** SpotGamma, Volland, Heatseeker all
   sell level-on-price charts as the headline product.

## How close is this to the real Atlas? (honest fidelity notes)

The *concepts* match — levels on price, strength-sized orbs, min-clamp
filtering, heatmap sidecar, replayable history. Three structural differences
remain, beyond raw data availability:

1. **Expiry aggregation.** Skylit's orbs are *organized by contract
   expiration* ("the same strike can look different depending on the
   expiration selected"). This demo sums GEX across visible expiries per
   strike. The per-expiry values are already in the data — an expiration
   selector is a build task, not a data ask.
2. **Rendering.** Orbs here are Lightweight Charts series markers: strength
   maps to opacity + size, but sizes are quantized, there's no glow, and each
   strike costs a series (fine at ~20; a full production orb field would draw
   its own canvas layer via the library's custom-series API).
3. **Snapshot cadence = signal resolution.** Everything is as good as the
   feed: 2-min scraped snapshots mean 2-min orbs. Atlas presumably renders
   from a native tick/minute feed. Same code, better input, better output.

## What's still needed (data the demo fakes or lacks)

| Gap | Demo today | What's needed from the terminal | Why it matters (use case) |
|---|---|---|---|
| **True signed options flow** | signed *candle volume* stands in | per-interval call/put volume, premium, aggressor side (DATA_CONTRACT §4) | the FLOW pane's real fuel — spot aggressive positioning before price reacts; makes Δ Flow attribution honest (in vs offsetting) |
| **VEX / GEX-Vol levels** | GEX-OI only (that's what the scrape captured) | the same board for VEX and GEX-Vol — the terminal already computes them (§2) | vanna walls move with IV, not just spot — the GEX+VEX confluence view needs both; Vol-based GEX shows *today's* positioning vs stale OI |
| **Intraday level history** | ~465 scraped snapshots across 2 days, 2-min cadence | server-side snapshots (1-min or better) retained per trading day (§3) | fills the orb field every session automatically; enables replay, backtests ("how often does the call wall reject?"), and alerts |
| **True gamma flip** | GEX0 approximated over visible strikes | full-chain net gamma profile by spot price (§2) | the flip point is *the* regime line (positive gamma = mean-revert, negative = trend/accelerate); an approximation over 5 expiries can be off |
| **Live updates** | static JSON | WebSocket push of new bars + level updates (§5) | turns a replay tool into a trading tool — levels move while you watch |
| **OHLCV bars** | pulled from a broker API for the demo | terminal-native bars (§1) | one data source, one timestamp domain — no broker dependency or sync drift |
| **Dark pool prints** | not shown | a prints/levels source (§6) | hidden institutional levels alongside dealer structure — confluence between a dark pool level and a wall is a high-conviction zone |

## Feature map vs. the real Atlas ([docs.skylit.ai/atlas](https://docs.skylit.ai/atlas/overview))

Skylit's Atlas "brings Skylit data directly onto the chart so users can review
price action, dealer positioning, dark pool levels, and options-flow context
in one place." How this framework maps onto their published feature set:

| Skylit Atlas feature | Status here | Notes |
|---|---|---|
| **Orbs Classic** (strength = brightness) | ✅ lite version | per-strike orb field tied to the board's values: opacity + size = node strength, normalized per session; levels themselves are clean indicator lines |
| **Orbs V2** (Min/Max Clamp size/opacity controls) | ✅ Min Clamp | strength filter dropdown (All / ≥25% / ≥50% / ≥75% of session max) hides weak nodes; Max Clamp + opacity = same one-line filter |
| **Scroll as Replay** (only data known at that time) | ✅ | the gex-replay-basic transport drives the chart: scrub to 10:14 and candles, levels, orbs and the board show exactly what was known at 10:14 |
| **Sidecars** (heatmap / Trinity cross-market) | ✅ heatmap sidecar | the parent repo's strike × expiry board at the playhead, docked beside the chart; Trinity (cross-market) = same panel × 3 symbols |
| **Exposure views: GEX / VEX / GEX+VEX / Derived** | GEX-OI only | pure data availability — the toggle architecture is in place |
| **Expiration selection** (per-expiry levels) | roadmap — see fidelity note 1 | scrape already carries per-expiry values; levels.js currently sums across expiries. Use case: 0DTE walls behave differently from monthly OI walls — a trader sizing an intraday play needs the near expiry isolated |
| **Flowseeker pane** (options volume under price) | placeholder | needs real flow feed (DATA_CONTRACT §4) |
| **Dark pool levels** | not started | needs a dark-pool prints source (DATA_CONTRACT §6) |
| **Derived Orbs** (ES borrows SPY/SPXW, NQ borrows QQQ, adjusted for "the wiggle") | price side demoed (SPX ← SPY bars) | level side = the same ratio transform in the adapter. Use case: futures traders get options structure their contract doesn't have |
| **Projections (beta)** (forward price-gravity zones) | idea stage | forward-looking gravity zones instead of only current structure |
| **Chart layouts** (named, auto-saved, synced) | not started | localStorage first, account sync later |

## Ideas beyond parity (where this could beat Heatseeker)

- **Level-touch alerting** — notify when price approaches a wall/GEX0, with the
  level's *strength* (magnitude, freshness, trajectory) attached.
- **Level-quality scoring** — the full gex-replay project (this repo's private
  parent) already ranks squeeze candidates and tracks structure migration;
  overlaying score on the level lines (opacity/width by strength) makes strong
  levels visually louder.
- **Confluence view** — GEX-OI, GEX-Vol, and VEX walls drawn together;
  strikes where they agree get emphasized (that's the "Derived" tab done right).
- **Backtest stats on hover** — "price touched this wall 7×, rejected 5×".
- **Multi-ticker level dashboard** — a watchlist row per ticker showing
  distance-to-nearest-wall, for scanning setups across the board.
- **AI session read** — the full gex-replay project's Worker + Gemini pipeline
  (structural summary in, markdown read out) rendered as a side panel.

## Repo layout

```
index.html            shell: header, toggle chips, chart + sidecar, transport
styles.css            dark terminal theme + the gex-replay-basic transport styles
src/levels.js         pure level math (walls, kings, GEX0, net) — the core
src/adapter.js        data adapters: gex-replay-basic folder now, Quantum API later
src/chart.js          Lightweight Charts wrapper: candles, levels, orbs, replay truncation
src/app.js            glue + replay transport (same controls/keys as the parent repo)
data/manifest.json    ┐
data/<slug>/*.json.gz ┘ a gex-replay-basic data folder, verbatim
data/bars/            real 5m OHLCV per ticker — the one thing Atlas adds
scripts/pull_data.py  sync data/ from a gex-replay-basic checkout or live URL
docs/DATA_CONTRACT.md the endpoints/schemas the terminal would provide
```

## Provenance & status

- GEX data: gex-replay-basic's bundles — scraped from the Quantum Terminal DOM
  every ~2 min (the temporary path; see that repo's
  [`docs/DATA_PIPELINE.md`](https://github.com/shurwatrader/gex-replay-basic/blob/main/docs/DATA_PIPELINE.md)).
  The terminal's own private API (`/api/v1/gex-all/...`) already returns richer
  data than the scrape; a sanctioned feed makes the scrape obsolete on day one.
- Bars: MU/SPY/TSLA 5m OHLCV, Jul 2–7 2026, all sessions, via a broker API;
  SPX derived from SPY × 10.03.
- Charting: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
  (MIT) via CDN.

NFA. Demo/proposal only — not a trading product.
