/**
 * chart.js — all rendering. Wraps TradingView Lightweight Charts (CDN, MIT).
 *
 * Layout mirrors Atlas:
 *   main pane  — candlesticks
 *                + dealer levels as dotted step-line INDICATORS (no markers:
 *                  a wall/king just re-positions every snapshot)
 *                + the strike orb field: the heatmap's per-strike pressure
 *                  drawn on price, opacity/size scaling with |GEX| — a lite
 *                  version of Skylit's Orbs Classic, where brightness/size
 *                  encodes node strength
 *   flow pane  — histogram (demo: signed candle volume; production: real
 *                signed options flow — see README "What's still needed")
 *
 * Replay: the wrapper caches the full session (bars, levels, orbs) and
 * setReplayTime(t) re-renders everything truncated to time <= t — the chart
 * only ever shows what was known at the playhead (gex-replay's replay idea,
 * Skylit's "Scroll as Replay"). t = null means live view (no truncation).
 */

const LEVEL_STYLES = {
  callWall: { color: '#4db6ac', title: 'Call Wall' },
  putWall:  { color: '#b39ddb', title: 'Put Wall' },
  oiKing:   { color: '#66bb6a', title: 'OI King' },
  volKing:  { color: '#ef5350', title: 'Vol King' },
  gex0:     { color: '#ce93d8', title: 'GEX0 (Γ)' },
};

export function createAtlasChart(container, flowContainer) {
  const { createChart, LineStyle } = window.LightweightCharts;

  const common = {
    layout: { background: { color: 'transparent' }, textColor: '#8b93a7' },
    grid: {
      vertLines: { color: 'rgba(139,147,167,0.08)' },
      horzLines: { color: 'rgba(139,147,167,0.08)' },
    },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(139,147,167,0.2)' },
    rightPriceScale: { borderColor: 'rgba(139,147,167,0.2)', scaleMargins: { top: 0.12, bottom: 0.12 } },
    crosshair: { mode: 0 },
  };

  const chart = createChart(container, { ...common, autoSize: true });
  const flowChart = createChart(flowContainer, { ...common, autoSize: true });

  // Full-session cache — the replay playhead re-slices from here.
  const cache = {
    bars: [],
    levels: {},          // key -> [{time, value, strength}]
    orbs: [],            // [{strike, points}]
    orbMode: 'net',
    orbMinFrac: 0,
    endTime: null,       // right edge levels/orbs extend to in live view
    contentEnd: null,    // last bar time with GEX coverage (orbs/levels)
    truncTime: null,     // replay playhead (null = live view)
  };

  // Orb layer FIRST so candles (created after) always paint on top of the
  // pressure field — orbs glow behind price, never over it. Fixed pools of
  // series, reused across loads (creation order is z-order in v4).
  //
  // Each strike draws TWO stacked markers for a soft glowing look (Atlas Orbs
  // V2): a wide, faint HALO underneath a smaller, brighter CORE. Two markers
  // can't share a time slot on one series, so we keep two parallel pools —
  // halo created first (drawn lowest), core above it, both under the candles.
  const ORB_POOL = 12; // strikes drawn at once (count control caps at 10)
  const newOrbSeries = () => chart.addLineSeries({
    color: 'rgba(0,0,0,0)', // orbs only — no connecting line
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    // Orbs DO drive the price axis: we show the heaviest strikes regardless of
    // distance from price, so the axis must stretch to keep them in view. The
    // strike-count control is the lever — fewer strikes = tighter range =
    // bigger candles. (Default autoscale uses each orb's strike as its value.)
  });
  const orbHalo = [];
  const orbCore = [];
  for (let i = 0; i < ORB_POOL; i++) orbHalo.push(newOrbSeries());
  for (let i = 0; i < ORB_POOL; i++) orbCore.push(newOrbSeries());

  const candles = chart.addCandlestickSeries({
    upColor: '#d1d4dc', downColor: '#5d6b8a',
    wickUpColor: '#d1d4dc', wickDownColor: '#5d6b8a',
    borderVisible: false,
    // Only the candles drive the price axis; it autoscales to the visible
    // candles. Future bars are whitespace (no OHLC), so they don't feed
    // autoscale — and because the bar count never changes, the horizontal
    // view stays exactly where the user leaves it during playback.
  });

  const levelSeries = {};
  for (const [key, style] of Object.entries(LEVEL_STYLES)) {
    levelSeries[key] = chart.addLineSeries({
      color: style.color,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lastValueVisible: true,
      priceLineVisible: false,
      title: style.title,
      lineType: 1, // stepped — a level holds until the next snapshot
      // Candles drive the viewport; a wall at a far strike shouldn't zoom
      // the chart out until price is a sliver. Off-window levels appear as
      // you zoom/pan (and are always on the heatmap board).
      autoscaleInfoProvider: () => null,
    });
  }

  const flow = flowChart.addHistogramSeries({ priceFormat: { type: 'volume' } });

  let orbsVisible = true;

  // Keep both panes' time axes locked together.
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (r) flowChart.timeScale().setVisibleLogicalRange(r);
  });
  flowChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (r) chart.timeScale().setVisibleLogicalRange(r);
  });

  const upTo = (points, t) =>
    t == null ? points : points.filter((p) => p.time <= t);

  // Bar index at or before time t (binary search); -1 if t predates bar 0.
  function indexAtOrBefore(t) {
    const bars = cache.bars;
    if (!bars.length || t < bars[0].t) return -1;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // The right edge levels/orbs extend to must also be a real bar time —
  // any other timestamp would inject an empty slot into the time axis.
  function snappedEdge() {
    const t = cache.truncTime ?? cache.endTime;
    if (t == null) return null;
    const idx = indexAtOrBefore(t);
    return idx < 0 ? null : cache.bars[idx].t;
  }

  // Frame an n-wide window ending at the playhead (replay) / GEX edge / last
  // bar — the "optimal view": legible candles, not the whole session squeezed
  // to fit. Early in a replay (no history yet) the window anchors at the start
  // so candles reveal into a legibly-sized view rather than a whole-session fit.
  function frameRecentImpl(n = 130) {
    const len = cache.bars.length;
    if (!len) return;
    let end = len - 1;
    const anchor = cache.truncTime ?? cache.contentEnd;
    if (anchor != null) end = Math.max(0, indexAtOrBefore(anchor));
    let from = end - n + 1;
    let to = end;
    if (from < 0) { from = 0; to = Math.min(len - 1, n - 1); } // start-anchored
    chart.timeScale().setVisibleLogicalRange({ from: from - 0.5, to: to + 0.5 });
  }

  function renderBars() {
    const t = cache.truncTime;
    const shown = (b) => t == null || b.t <= t;
    // Bars past the playhead become whitespace ({time} only): they still
    // occupy their slot, so the time axis extent never changes and the chart
    // can't auto-scroll to "follow" newly revealed candles during playback.
    candles.setData(cache.bars.map((b) => shown(b)
      ? { time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }
      : { time: b.t }));
    // Demo flow: signed volume (up bar = +v, down bar = -v). Production
    // replaces this with true signed options flow per DATA_CONTRACT.md.
    flow.setData(cache.bars.map((b) => shown(b)
      ? {
          time: b.t,
          value: b.c >= b.o ? b.v : -b.v,
          color: b.c >= b.o ? 'rgba(120,144,220,0.85)' : 'rgba(139,147,167,0.6)',
        }
      : { time: b.t }));
  }

  function renderLevels() {
    // Levels are pure indicators: a stepped dotted line that re-positions
    // every snapshot — no markers. Strength/pressure lives in the orb field.
    const edge = snappedEdge();
    for (const [key, series] of Object.entries(levelSeries)) {
      const points = upTo(cache.levels[key] ?? [], cache.truncTime);
      const data = points.map(({ time, value }) => ({ time, value }));
      // Extend the last known level to the playhead (replay) or the right
      // edge (live), so it reads as an active level.
      if (data.length && edge && edge > data[data.length - 1].time) {
        data.push({ time: edge, value: data[data.length - 1].value });
      }
      series.setData(data);
    }
  }

  /**
   * Strike heaviness — the Atlas orb field: the heatmap's per-strike values
   * drawn on the price chart. Strength maps to OPACITY (and a little size),
   * sqrt-compressed against the session max — the same encoding the heatmap
   * sidecar uses for its cells, so an orb chain and its board row read as one
   * thing. Palette by mode:
   *   net   — teal positive GEX / purple negative (the heatmap's exact hues)
   *   delta — green building / red draining (money in vs out per interval)
   * minFrac: orbs weaker than minFrac × session max are not drawn
   * (the Orbs V2 "Min Clamp" idea — declutter to the nodes that matter).
   */
  function renderOrbField() {
    const palette = cache.orbMode === 'delta'
      ? { pos: '102,187,106', neg: '239,83,80' }
      : { pos: '38,166,154', neg: '126,87,194' }; // heatmap cell hues
    // Fixed pools of series (created under the candles at init); slots beyond
    // the current orb set are cleared, never removed.
    const orbs = cache.orbs.slice(0, orbCore.length);
    for (let i = orbs.length; i < orbCore.length; i++) {
      orbHalo[i].setData([]); orbHalo[i].setMarkers([]);
      orbCore[i].setData([]); orbCore[i].setMarkers([]);
    }

    const maxStrength = Math.max(1, ...orbs.flatMap((o) => o.points.map((p) => p.strength)));
    const edge = snappedEdge();
    orbs.forEach(({ strike, points }, i) => {
      const visible = upTo(points, cache.truncTime);
      const halo = orbHalo[i], core = orbCore[i];
      halo.applyOptions({ visible: orbsVisible });
      core.applyOptions({ visible: orbsVisible });

      const data = visible.map(({ time }) => ({ time, value: strike }));
      if (data.length && edge && edge > data[data.length - 1].time) {
        data.push({ time: edge, value: strike });
      }
      halo.setData(data);
      core.setData(data);

      // Strength → marker size/opacity. Gentler than sqrt (pow 0.6) so
      // mid-strength nodes stay legible; the strongest node in a chain is the
      // largest/brightest. Each point paints a faint wide halo + a tight core.
      const drawn = visible.filter(
        (p) => p.strength > 0 && p.strength >= cache.orbMinFrac * maxStrength
      );
      const rgb = (p) => (p.sign >= 0 ? palette.pos : palette.neg);
      halo.setMarkers(drawn.map((p) => {
        const t = Math.pow(p.strength / maxStrength, 0.6);
        const core = 0.5 + 2.0 * t;
        return {
          time: p.time, position: 'inBar', shape: 'circle',
          color: `rgba(${rgb(p)},${(0.06 + 0.16 * t).toFixed(3)})`,
          size: core * 1.9,
        };
      }));
      core.setMarkers(drawn.map((p) => {
        const t = Math.pow(p.strength / maxStrength, 0.6);
        return {
          time: p.time, position: 'inBar', shape: 'circle',
          color: `rgba(${rgb(p)},${(0.25 + 0.70 * t).toFixed(3)})`,
          size: 0.5 + 2.0 * t,
        };
      }));
    });
  }

  return {
    setBars(bars) {
      cache.bars = bars;
      renderBars();
    },

    /** levels: map key -> [{time, value, strength}] from levels.buildLevelSeries */
    setLevels(levels, extendToTime) {
      cache.levels = levels;
      cache.endTime = extendToTime ?? cache.endTime;
      renderLevels();
    },

    toggleLevel(key, visible) {
      levelSeries[key]?.applyOptions({ visible });
    },

    /** orbs: [{ strike, points: [{time, strength, sign}] }] from buildStrikeOrbs. */
    setStrikeOrbs(orbs, extendToTime, mode = 'net', minFrac = 0) {
      cache.orbs = orbs;
      cache.endTime = extendToTime ?? cache.endTime;
      cache.orbMode = mode;
      cache.orbMinFrac = minFrac;
      renderOrbField();
    },

    toggleStrikeOrbs(visible) {
      orbsVisible = visible;
      for (const s of orbHalo) s.applyOptions({ visible });
      for (const s of orbCore) s.applyOptions({ visible });
    },

    /** The last bar time covered by GEX data (orbs/levels); used by frameRecent. */
    setContentEnd(t) { cache.contentEnd = t; },

    /**
     * Move the replay playhead: everything re-renders truncated to time <= t.
     * Pass null to return to the live (full-session) view. Future bars stay
     * as whitespace, so the time axis extent is constant and the view holds
     * still — no save/restore dance needed.
     */
    setReplayTime(t) {
      if (cache.truncTime === t) return;
      cache.truncTime = t;
      // Future bars are whitespace, so the time-axis extent is constant and
      // setData never auto-scrolls. The view stays exactly where the user left
      // it — free pan/zoom during playback with no snap-back. The playhead may
      // scroll out of view; the ⤢ fit button jumps back to it on demand.
      renderBars();
      renderLevels();
      renderOrbField();
    },

    fit() { chart.timeScale().fitContent(); },

    /**
     * Frame the n bars ending at the playhead — the "optimal view": legible
     * candles instead of the whole session squeezed to fit. Anchors to the
     * replay playhead, else the GEX coverage edge, else the last bar.
     */
    frameRecent(n = 130) { frameRecentImpl(n); },
    zoom(from, to) { chart.timeScale().setVisibleRange({ from, to }); },
    styles: LEVEL_STYLES,
  };
}
