# Atlas: GEX replay on price (framework proposal)

**A build on top of [gex-replay-basic](https://github.com/shurwatrader/gex-replay-basic).**
That repo replays the strike × expiry GEX heatmap frame by frame. Atlas takes the
same data and the same replay transport and puts it **on a price chart**:
candlesticks with dealer-positioning levels (call and put walls, OI and Vol kings,
zero-gamma) drawn as dotted lines that evolve through the session, a
strength-sized orb field, a flow pane underneath, and the heatmap board docked
beside the chart, scrubbing in sync.

Built as a proposal for the Quantum Terminal. The matrix view already computes
everything needed, so Atlas is **the same data, rotated 90 degrees**: instead of a
strike × expiry board at one moment, it shows the *derived levels* over *time*, on
top of price. That's the view traders actually trade from. (Concept source:
[Skylit's Atlas](https://docs.skylit.ai/atlas/overview).)

**Live demo:** https://shurwatrader.github.io/atlas-framework/

No build tooling, just static files, same philosophy as gex-replay-basic. Locally:

```bash
python -m http.server 8000   # from the repo root
# open http://localhost:8000
```

> SPX bars are **derived from SPY × 10.03** (no direct index bars in the demo
> feed), which doubles as a working example of Skylit's "Derived Orbs"
> cross-product mapping applied to price.

---

## How this extends gex-replay-basic

| | gex-replay-basic | Atlas (this repo) |
|---|---|---|
| **View** | strike × expiry heatmap, one frame at a time | candles, levels, and orbs over the whole session, heatmap as sidecar |
| **Data** | `data/manifest.json` + `data/<slug>/<date>.json.gz` | identical files, consumed verbatim |
| **Replay** | play / pause / step / scrub | same transport, same shortcuts, driving chart *and* board together |
| **Adds** | (none) | OHLCV bars (`data/bars/`), level math (`src/levels.js`), Lightweight Charts rendering |

Concretely, "built on top of" means:

- **Same data, byte for byte.** Atlas reads gex-replay-basic's published
  `data/` folder as-is: same manifest, same gzipped day bundles, same frame
  schema (documented in that repo's
  [`docs/DATA_PIPELINE.md`](https://github.com/shurwatrader/gex-replay-basic/blob/main/docs/DATA_PIPELINE.md)).
  `scripts/pull_data.py --source ../gex-replay-basic` syncs a copy in, or open
  the app with `?source=https://shurwatrader.github.io/gex-replay-basic` and it
  reads the live deployment's snapshots directly, no copy at all. When the
  scraper publishes a new day there, Atlas gains it for free.
- **Same replay transport.** ⏮ ◀ ▶ ⏭, scrubber, Step (2m/10m/30m/1h), Speed,
  and the same keys: **Space** play/pause, **← / →** step, **Home / End**
  first/last. Same Trading Day and Snapshot (ET) readout, same 8 PM ET
  trading-day roll.
- **Same board.** The heatmap sidecar is gex-replay-basic's grid (its diverging
  purple-to-teal color scheme, ~40 heaviest strikes), docked beside the chart
  and locked to the playhead.
- **Honest replay.** Scrub to 10:14 and the chart shows *only what was known at
  10:14*. Candles, levels, and orbs are truncated to the playhead (Skylit's
  "Scroll as Replay"). The newest frame is the full live view.

## What the demo shows

- **Ticker switcher.** MU, SPY, SPX (derived), TSLA, straight from the
  gex-replay-basic manifest, each pairing real bars with that ticker's scraped
  GEX-OI board.
- **Candlestick chart.** 10-minute OHLCV (rolled up from the 2m day / 5m overnight
  bars), matching where the GEX board is headed. All sessions shown, overnight
  included. On load the chart frames the recent GEX-covered window so the candles
  read at a legible size, rather than the whole two-day session squeezed to fit.
- **Replay transport.** Scrub or play the session and watch price, levels, orbs,
  and the heatmap advance together, frame by frame. While playing, the view stays
  where you leave it, so you can pan and zoom freely without it snapping back. The
  playhead can scroll out of view; the ⤢ button (bottom-right of the chart)
  reframes to the best candle view whenever you want it back.
- **Strike Orbs.** The heatmap's pressure field drawn on price. The N heaviest
  strikes by |net GEX| each get an orb chain across time, sized and brightened by
  strength and colored by sign (teal for positive GEX, purple for negative). Those
  are the same values and hues that color the board's cells, so an orb chain and
  its board row read as one thing. Each orb is a soft glowing dot: a faint wide
  halo under a brighter core. The candles drive the price axis, so the view stays
  focused on price action; heavy strikes that sit far from spot clip off the top or
  bottom until you drag the price axis out to reach them. Skylit's Orbs encode
  strength as brightness and size; same idea.
- **Strike count.** A slider (1 to 10) sets how many of the heaviest strikes draw
  orbs, ranked by their strength in the recent window. Far-from-spot strikes still
  get an orb, they just sit off-screen until you widen the price axis.
- **Expiry picker.** Checkboxes for each available expiration date (all on by
  default). Uncheck dates to feed only the expiries you care about into the walls,
  GEX0, orbs, and the heatmap columns. The date set is rebuilt per ticker (SPY
  dailies, MU weeklies) and matched by date, since the board's expiries shift as
  near contracts roll off.
- **Δ Flow mode.** Flips the orb field from *where structure sits* (net) to *where
  money is moving* (change versus the previous snapshot: building green, draining
  red, gex-replay's "Movers" drawn on the price chart). The two modes rank strikes
  independently, so Δ surfaces active strikes that net totals hide. Caveat: with
  net-GEX snapshots, Δ shows net change per interval. It can't separate "new money
  in" from opposite positioning offsetting it. True attribution needs the call and
  put flow split (DATA_CONTRACT §4).
- **Heatmap sidecar.** The gex-replay-basic board at the playhead frame, colored
  with the same diverging scale it uses (purple negatives through a dark neutral to
  teal and yellow positives, scaled per frame), docked beside the chart (on by
  default, toggleable from the chip bar). It shows the columns you've checked in the
  expiry picker.
- **Dealer levels as indicators.** Stepped dotted lines, one point per GEX
  snapshot: a wall or king simply re-positions every ~2 min if it moves (no
  markers on the lines, since pressure and strength live in the orb field):
  - **Call Wall.** Strike with the largest positive total GEX.
  - **Put Wall.** Strike with the most negative total GEX.
  - **OI King / Vol King.** The flagged concentration strikes.
  - **GEX0 (Γ).** Interpolated zero-gamma crossing nearest spot.
- **Level toggle chips** (like Atlas' GEX / VEX / Derived tabs).
- **Flow pane.** Placeholder signed-volume histogram (see limitations).
- Net exposure readout in the header, tracking the playhead.

The sample spans **two trading days** (7/5 plus a full 7/6 session, about 465
snapshots per ticker at 2-min cadence, from the 8 PM ET overnight open through the
next afternoon), so the orb field runs across the whole chart, Atlas-style. An orb
column is drawn per captured snapshot, so coverage is purely a function of how much
history the parent repo publishes.

The gzipped day bundles are compact. A full session of every strike, every 2
minutes, is **1.5 to 4 MB per ticker**, which doubles as a sizing proof for
DATA_CONTRACT §3: server-side snapshot retention is cheap.

All level math lives in [`src/levels.js`](src/levels.js): pure functions, testable
headless in Node.

## Architecture

```
 gex-replay-basic ──▶ ┌────────────────┐    ┌───────────────┐    ┌──────────────┐
 data/ (verbatim)     │  adapter.js    │───▶│  levels.js    │───▶│  chart.js    │
 Quantum API later    │  (data source) │    │  (pure math)  │    │  (rendering) │
                      └────────────────┘    └───────────────┘    └──────────────┘
                                                walls, kings,       Lightweight Charts
                                                GEX0, net GEX       candles + levels + flow
```

The chart never knows where data came from. Swapping the gex-replay-basic feed for
a real Quantum feed means implementing **one function** (`quantumAdapter` in
[`src/adapter.js`](src/adapter.js)) against the endpoints described in
[`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

## Why this is worth building (the pitch)

1. **The matrix answers "where is structure?" Atlas answers "is it holding?"**
   Walls and GEX0 only mean something relative to price action. Putting them *on*
   the price chart turns a data product into a trading view.
2. **The terminal already has all the inputs.** GEX (OI), GEX (Vol), VEX, IV, and
   per-strike call and put splits are all computed for the matrix. Atlas is a
   presentation layer, not a new analytics engine.
3. **History becomes a feature.** Snapshotting levels over time enables replay,
   backtesting ("how often does price reject the call wall?"), and alerting
   ("price within 0.25% of put wall"), none of which a live-only matrix can do.
4. **It's the view competitors lead with.** SpotGamma, Volland, and Heatseeker all
   sell level-on-price charts as the headline product.

## How close is this to the real Atlas? (honest fidelity notes)

The concepts match: levels on price, strength-sized orbs, a strike-count control
on the orb field, a heatmap sidecar, and replayable history. A few structural
differences remain, beyond raw data availability:

1. **Expiry aggregation.** Skylit's orbs are *organized by contract expiration*
   ("the same strike can look different depending on the expiration selected").
   The expiry picker here lets you sum any subset of expirations, so you can
   isolate the near date. It still sums the checked expiries into one number per
   strike rather than drawing a separate orb layer per expiration.
2. **Rendering.** Orbs here are Lightweight Charts series markers: a faint halo
   marker stacked under a brighter core, with strength mapped to size and opacity.
   That reads as a soft glow, but marker sizes are quantized and each strike costs
   a couple of series (fine at ~10). A full production orb field would draw its own
   canvas layer via the library's custom-series API for true gradients and glow.
3. **Snapshot cadence sets signal resolution.** Everything is as good as the feed:
   2-min scraped snapshots mean 2-min orbs. Atlas presumably renders from a native
   tick or minute feed. Same code, better input, better output.

## What's still needed (data the demo fakes or lacks)

| Gap | Demo today | What's needed from the terminal | Why it matters (use case) |
|---|---|---|---|
| **True signed options flow** | signed *candle volume* stands in | per-interval call/put volume, premium, aggressor side (DATA_CONTRACT §4) | the FLOW pane's real fuel: spot aggressive positioning before price reacts, and it makes Δ Flow attribution honest (in versus offsetting) |
| **VEX / GEX-Vol levels** | GEX-OI only (that's what the scrape captured) | the same board for VEX and GEX-Vol, which the terminal already computes (§2) | vanna walls move with IV, not just spot, so the GEX+VEX confluence view needs both; Vol-based GEX shows *today's* positioning versus stale OI |
| **Intraday level history** | ~465 scraped snapshots across 2 days, 2-min cadence | server-side snapshots (1-min or better) retained per trading day (§3) | fills the orb field every session automatically, and enables replay, backtests ("how often does the call wall reject?"), and alerts |
| **True gamma flip** | GEX0 approximated over visible strikes | full-chain net gamma profile by spot price (§2) | the flip point is *the* regime line (positive gamma mean-reverts, negative gamma trends or accelerates); an approximation over 5 expiries can be off |
| **Live updates** | static JSON | WebSocket push of new bars and level updates (§5) | turns a replay tool into a trading tool, with levels moving while you watch |
| **OHLCV bars** | pulled from a broker API for the demo | terminal-native bars (§1) | one data source, one timestamp domain, no broker dependency or sync drift |
| **Dark pool prints** | not shown | a prints/levels source (§6) | hidden institutional levels alongside dealer structure; confluence between a dark pool level and a wall is a high-conviction zone |

## Feature map vs. the real Atlas ([docs.skylit.ai/atlas](https://docs.skylit.ai/atlas/overview))

Skylit's Atlas "brings Skylit data directly onto the chart so users can review
price action, dealer positioning, dark pool levels, and options-flow context in
one place." How this framework maps onto their published feature set:

| Skylit Atlas feature | Status here | Notes |
|---|---|---|
| **Orbs Classic** (strength = brightness) | done (lite) | per-strike orb field tied to the board's values: size and opacity encode node strength, normalized per session; levels themselves are clean indicator lines |
| **Orbs V2** (Min/Max Clamp size/opacity controls) | strike-count slider | instead of a strength clamp, a 1-to-10 slider picks how many of the heaviest strikes draw (top-N by net-GEX magnitude) |
| **Scroll as Replay** (only data known at that time) | done | scrub to 10:14 and candles, levels, orbs, and the board show exactly what was known at 10:14 |
| **Sidecars** (heatmap / Trinity cross-market) | heatmap sidecar | the parent repo's strike × expiry board at the playhead, docked beside the chart; Trinity (cross-market) would be the same panel × 3 symbols |
| **Exposure views: GEX / VEX / GEX+VEX / Derived** | GEX-OI only | pure data availability; the toggle architecture is in place |
| **Expiration selection** (per-expiry levels) | done (multi-select) | checkboxes per expiration date drive the walls, GEX0, orbs, and heatmap columns; matched by date since the board's expiries shift frame to frame. Use case: 0DTE walls behave differently from monthly OI walls, so a trader sizing an intraday play can isolate the near expiry |
| **Flowseeker pane** (options volume under price) | placeholder | needs a real flow feed (DATA_CONTRACT §4) |
| **Dark pool levels** | not started | needs a dark-pool prints source (DATA_CONTRACT §6) |
| **Derived Orbs** (ES borrows SPY/SPXW, NQ borrows QQQ, adjusted for "the wiggle") | price side demoed (SPX ← SPY bars) | the level side is the same ratio transform in the adapter. Use case: futures traders get options structure their contract doesn't have |
| **Projections (beta)** (forward price-gravity zones) | idea stage | forward-looking gravity zones instead of only current structure |
| **Chart layouts** (named, auto-saved, synced) | not started | localStorage first, account sync later |

## Ideas beyond parity (where this could beat Heatseeker)

- **Level-touch alerting.** Notify when price approaches a wall or GEX0, with the
  level's *strength* (magnitude, freshness, trajectory) attached.
- **Level-quality scoring.** The full gex-replay project (this repo's private
  parent) already ranks squeeze candidates and tracks structure migration, so
  overlaying that score on the level lines (opacity or width by strength) makes
  strong levels visually louder.
- **Confluence view.** GEX-OI, GEX-Vol, and VEX walls drawn together, with the
  strikes where they agree emphasized (that's the "Derived" tab done right).
- **Backtest stats on hover.** "Price touched this wall 7×, rejected 5×."
- **Multi-ticker level dashboard.** A watchlist row per ticker showing distance to
  the nearest wall, for scanning setups across the board.
- **AI session read.** The full gex-replay project's Worker and Gemini pipeline
  (structural summary in, markdown read out) rendered as a side panel.

## Repo layout

```
index.html            shell: header, toggle chips, chart + sidecar, transport
styles.css            dark terminal theme plus the gex-replay-basic transport styles
src/levels.js         pure level math (walls, kings, GEX0, net); the core
src/adapter.js        data adapters: gex-replay-basic folder now, Quantum API later
src/chart.js          Lightweight Charts wrapper: candles, levels, orbs, replay truncation
src/app.js            glue plus replay transport (same controls and keys as the parent repo)
data/manifest.json    ┐
data/<slug>/*.json.gz ┘ a gex-replay-basic data folder, verbatim
data/bars/            real OHLCV bars per ticker; the one thing Atlas adds
scripts/pull_data.py  sync data/ from a gex-replay-basic checkout or live URL
docs/DATA_CONTRACT.md the endpoints and schemas the terminal would provide
```

## Provenance & status

- GEX data: gex-replay-basic's bundles, scraped from the Quantum Terminal DOM
  every ~2 min (the temporary path; see that repo's
  [`docs/DATA_PIPELINE.md`](https://github.com/shurwatrader/gex-replay-basic/blob/main/docs/DATA_PIPELINE.md)).
  The terminal's own private API (`/api/v1/gex-all/...`) already returns richer
  data than the scrape, so a sanctioned feed makes the scrape obsolete on day one.
- Bars: MU, SPY, and TSLA OHLCV for the replay tape (Jul 5 to 6, 2026), 2m through
  the day session (Yahoo 1m, aggregated) and 5m for the overnight stretch (via a
  broker API; the demo has no overnight 1m feed). SPX is derived from SPY × 10.03.
  The `_5m.json` files remain as a fallback timeframe.
- Charting: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
  (MIT) via CDN.

NFA. Demo and proposal only, not a trading product.
