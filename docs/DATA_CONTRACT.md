# Data contract — what Atlas needs from the Quantum Terminal

Atlas is a presentation layer. Everything below is data the terminal already
computes for the matrix view; this doc just pins down shapes so the
`quantumAdapter` in [`src/adapter.js`](../src/adapter.js) can be implemented
against real endpoints. Field names are suggestions — whatever the terminal
already emits is fine, the adapter normalizes.

## 1. Bars — `GET /api/v1/bars/{symbol}?tf=5m&from=...&to=...`

Standard OHLCV, all sessions (pre/RTH/after/overnight):

```jsonc
{ "symbol": "MU", "tf": "5m",
  "bars": [ { "t": 1783394100, "o": 944.45, "h": 946.75, "l": 943.65, "c": 945.99, "v": 8452 } ] }
```

## 2. Exposure board — `GET /api/v1/gex-all/{symbol}?expiries=N`

The full strike × expiry board, per metric. This endpoint **already exists**
(the matrix popup reads from it); Atlas needs numeric values rather than
display strings, and all three metrics:

```jsonc
{ "symbol": "MU", "asOf": "2026-07-05T23:26:13Z", "spot": 975.37,
  "netExposure": { "gexOI": -582.1e6, "gexVol": ..., "vex": ... },
  "expiries": ["2026-07-10", "2026-07-17"],
  "strikes": [
    { "strike": 980,
      "gexOI":  [1.2e8, 3.4e7],        // one value per expiry
      "gexVol": [ ... ],
      "vex":    [ ... ],
      "oi":     { "call": 12600, "put": 8400 },
      "volume": { "call": 5200,  "put": 9100 },
      "iv":     { "call": 0.62,  "put": 0.65 },
      "flags":  { "oiKing": false, "volKing": true, "callWall": false, "putWall": false }
    }
  ]
}
```

If the terminal already computes walls/kings server-side (the flags), Atlas
uses them directly; otherwise `src/levels.js` derives them client-side (as the
demo does today).

## 3. Level history — `GET /api/v1/levels/{symbol}?day=2026-07-05`

The one genuinely *new* thing: retained snapshots of derived levels so lines
can be drawn through time. Cheap to store — it's ~6 numbers per snapshot,
not the whole board:

```jsonc
{ "symbol": "MU", "tradingDay": "2026-07-05", "cadence": "1m",
  "points": [
    { "t": 1783380000, "spot": 975.4,
      "callWall": 1000, "putWall": 950, "oiKing": 1000, "volKing": 990,
      "gex0": 968.2, "netGexOI": -5.8e8, "netGexVol": ..., "netVex": ... }
  ] }
```

Alternative: keep full board snapshots (enables replay + recomputing any
future level definition retroactively) and derive this on request.

## 4. Flow — `GET /api/v1/flow/{symbol}?tf=5m` (per-interval aggregates)

Fuel for the FLOW pane. No per-trade tape needed — per-interval aggregates are
enough:

```jsonc
{ "symbol": "MU", "tf": "5m",
  "intervals": [
    { "t": 1783394100,
      "callVol": 4200, "putVol": 6100,
      "callPremium": 1.9e6, "putPremium": 3.2e6,   // if available
      "netDelta": -1.2e6                            // signed, if computable
    } ] }
```

The pane renders `callVol - putVol` (or premium-weighted) as the histogram.

## 5. Live — `WS /stream/{symbol}`

Push messages, each one of:

```jsonc
{ "type": "bar",   "data": { /* bar shape above, current partial bar */ } }
{ "type": "levels","data": { /* one level-history point */ } }
{ "type": "flow",  "data": { /* one flow interval */ } }
```

Atlas appends in place — Lightweight Charts handles incremental `update()`
natively.

## 6. Dark pool levels — `GET /api/v1/darkpool/{symbol}` (optional)

Skylit's Atlas overlays dark pool levels alongside dealer positioning. If a
prints source exists (or is licensed later), the shape is simple:

```jsonc
{ "symbol": "MU",
  "levels": [
    { "price": 950.00, "notional": 4.1e8, "prints": 12, "lastSeen": "2026-07-05T19:55:00Z" }
  ] }
```

Rendered as horizontal lines weighted by notional. Purely additive — nothing
else depends on it.

## Derived mapping (cross-product levels)

Skylit's "Derived Orbs" let futures borrow options structure from related
products (ES ← SPY/SPXW, NQ ← QQQ), adjusted for basis drift ("the wiggle").
For Quantum the equivalent would be SPX ↔ SPY ↔ ES. This needs no new data —
only a per-pair `ratio` (and optionally a live basis offset) served alongside
the board, e.g. `{ "derivedFrom": "SPY", "ratio": 10.02 }`. The adapter
multiplies strikes through the ratio before handing levels to the chart.

## Minimum viable subset

If only **one** endpoint can be built first, make it **#3 (level history)** at
1–2 min cadence + existing bars from any source. That alone delivers the
core Atlas experience; #2 and #4 upgrade it to full parity, #5 makes it live.
