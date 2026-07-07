# Atlas — GEX/VEX levels on price (framework proposal)

A working skeleton for an **Atlas-style charting view**: candlesticks with
dealer-positioning levels (call/put walls, OI/Vol kings, zero-gamma) drawn as
dotted lines that *evolve through the session*, plus a flow pane underneath.

Built as a proposal for the Quantum Terminal — the idea being that the matrix
view already computes everything needed; Atlas is **the same data, rotated
90°**: instead of a strike × expiry board at one moment, it shows the *derived
levels* over *time*, on top of price. That's the view traders actually trade
from.

**Live demo:** https://shurwatrader.github.io/atlas-framework/

Runs on sample data captured from the terminal (via
[gex-replay](https://github.com/shurwatrader/gex-replay)'s scrape) + real
5-minute bars for **MU, SPY, SPX, TSLA** (ticker dropdown, top left). No build
tooling — static files, same philosophy as gex-replay. Locally:

```bash
python -m http.server 8000   # from the repo root
# open http://localhost:8000
```

> SPX bars are **derived from SPY × 10.03** (no direct index bars in the demo
> feed) — which doubles as a working example of Skylit's "Derived Orbs"
> cross-product mapping, applied to price.

---

## What the demo shows

- **Ticker switcher** — MU, SPY, SPX (derived), TSLA, each pairing real 5m
  bars with that ticker's scraped GEX-OI board
- **Candlestick chart** (real 5m OHLCV, all sessions incl. overnight)
- **Orbs-lite** — each level draws a circle per snapshot, sized by node
  strength (Skylit's Orbs encode strength as brightness/size; same idea)
- **Strike Orbs** — per-strike heaviness field: the session's heaviest strikes
  each get an orb chain across time, sized by |total GEX| and colored by sign
  (teal positive / purple negative) — toggleable like any level
- **Heatmap sidecar** — latest-frame strike × expiry board docked beside the
  chart (the ~40 heaviest strikes, gex-replay's diverging color scheme),
  toggled from the chip bar
- **Dealer levels as stepped dotted lines**, one point per GEX snapshot:
  - **Call Wall** — strike with the largest positive total GEX
  - **Put Wall** — strike with the most negative total GEX
  - **OI King / Vol King** — the flagged concentration strikes
  - **GEX0 (Γ)** — interpolated zero-gamma crossing nearest spot
- **Level toggle chips** (like Atlas' GEX / VEX / Derived tabs)
- **Flow pane** — placeholder signed volume histogram (see limitations)
- Net exposure readout in the header

All level math lives in [`src/levels.js`](src/levels.js) — pure functions,
testable headless in Node, same pattern as gex-replay's `scoring.js`.

## Architecture

```
 ┌────────────────┐    ┌───────────────┐    ┌──────────────┐
 │  adapter.js    │───▶│  levels.js    │───▶│  chart.js    │
 │  (data source) │    │  (pure math)  │    │  (rendering) │
 └────────────────┘    └───────────────┘    └──────────────┘
   sample JSON today       walls, kings,       Lightweight Charts
   Quantum API later       GEX0, net GEX       candles + levels + flow
```

The chart never knows where data came from. Swapping the temporary scrape for
a real Quantum feed means implementing **one function** (`quantumAdapter` in
[`src/adapter.js`](src/adapter.js)) against the endpoints described in
[`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

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

## What's still needed (data the demo fakes or lacks)

| Gap | Demo today | What's needed from the terminal |
|---|---|---|
| **True signed options flow** | signed *candle volume* stands in | per-interval call/put volume, premium, aggressor side — the FLOW pane's real fuel |
| **VEX levels** | GEX-OI only (that's what the scrape captured) | the same board for VEX (and GEX-Vol) — the terminal already computes them |
| **Intraday level history** | 14 snapshots at 2-min cadence, one day | server-side snapshots (1-min or better) retained per trading day |
| **True gamma flip** | GEX0 approximated over visible strikes | full-chain net gamma profile by spot price |
| **Live updates** | static JSON | WebSocket push of new bars + level updates |
| **OHLCV bars** | pulled from a broker API for the demo | terminal-native bars keep it one data source |

## Feature map vs. the real Atlas ([docs.skylit.ai/atlas](https://docs.skylit.ai/atlas/overview))

Skylit's Atlas "brings Skylit data directly onto the chart so users can review
price action, dealer positioning, dark pool levels, and options-flow context
in one place." How this framework maps onto their published feature set:

| Skylit Atlas feature | Status here | Notes |
|---|---|---|
| **Orbs Classic** (strength = brightness) | ✅ lite version | level orbs + per-strike Strike Orbs field, sized by node strength, normalized per session |
| **Orbs V2** (Min/Max Clamp size/opacity controls) | roadmap | needs a settings panel; sizing math already in `chart.js` |
| **Exposure views: GEX / VEX / GEX+VEX / Derived** | GEX-OI only | pure data availability — the toggle architecture is in place |
| **Expiration selection** (per-expiry levels) | roadmap | scrape already carries per-expiry values; levels.js currently sums across expiries |
| **Flowseeker pane** (options volume under price) | placeholder | needs real flow feed (DATA_CONTRACT §4) |
| **Dark pool levels** | not started | needs a dark-pool prints source (DATA_CONTRACT §6) |
| **Derived Orbs** (ES borrows SPY/SPXW, NQ borrows QQQ, adjusted for "the wiggle") | not started | cross-product mapping = a ratio/offset transform in the adapter layer |
| **Scroll as Replay** (only data known at that time) | natural fit | levels are already time-stamped snapshots; gex-replay's scrubber UX plugs in |
| **Projections (beta)** (forward price-gravity zones) | idea stage | gex-replay's migration scoring is a starting point |
| **Sidecars** (heatmap / Trinity cross-market) | ✅ heatmap sidecar | latest-frame strike × expiry board docked beside the chart; Trinity (cross-market) = same panel × 3 symbols |
| **Chart layouts** (named, auto-saved, synced) | not started | localStorage first, account sync later |

## Ideas beyond parity (where this could beat Heatseeker)

- **Level-touch alerting** — notify when price approaches a wall/GEX0, with the
  level's *strength* (magnitude, freshness, trajectory) attached.
- **Replay mode** — scrub the session and watch levels migrate (gex-replay
  already proves this UX; it plugs straight in).
- **Level-quality scoring** — gex-replay's `scoring.js` already ranks
  squeeze candidates and tracks structure migration; overlaying score on the
  level lines (opacity/width by strength) makes strong levels visually louder.
- **Confluence view** — GEX-OI, GEX-Vol, and VEX walls drawn together;
  strikes where they agree get emphasized (that's the "Derived" tab done right).
- **Backtest stats on hover** — "price touched this wall 7×, rejected 5×".
- **Multi-ticker level dashboard** — a watchlist row per ticker showing
  distance-to-nearest-wall, for scanning setups across the board.
- **AI session read** — the existing Worker + Gemini pipeline from gex-replay
  (structural summary in, markdown read out) rendered as a side panel.

## Repo layout

```
index.html            shell + header/toggles/panes
styles.css            dark terminal theme
src/levels.js         pure level math (walls, kings, GEX0, net) — the core
src/adapter.js        data adapters: sample JSON now, Quantum API later
src/chart.js          Lightweight Charts wrapper: candles, level lines, flow
src/app.js            glue
data/sample/          one day of MU GEX-OI snapshots + real MU 5m bars
docs/DATA_CONTRACT.md the endpoints/schemas the terminal would provide
```

## Provenance & status

- Sample GEX data: scraped from the Quantum Terminal DOM every ~2 min (the
  temporary path — see gex-replay's `docs/DATA_PIPELINE.md`). The terminal's
  own private API (`/api/v1/gex-all/...`) already returns richer data than the
  scrape; a sanctioned feed makes the scrape obsolete on day one.
- Bars: MU 5m OHLCV, Jul 2–7 2026, all sessions.
- Charting: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)
  (MIT) via CDN.

NFA. Demo/proposal only — not a trading product.
