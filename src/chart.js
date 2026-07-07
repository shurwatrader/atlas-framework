/**
 * chart.js — all rendering. Wraps TradingView Lightweight Charts (CDN, MIT).
 *
 * Layout mirrors Atlas:
 *   main pane  — candlesticks + GEX/VEX levels rendered as dotted step lines
 *                with "orbs" (circle markers sized by node strength — a lite
 *                version of Skylit's Orbs Classic, where brightness/size
 *                encodes node strength)
 *   flow pane  — histogram (demo: signed candle volume; production: real
 *                signed options flow — see README "What's still needed")
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
    rightPriceScale: { borderColor: 'rgba(139,147,167,0.2)' },
    crosshair: { mode: 0 },
  };

  const chart = createChart(container, { ...common, autoSize: true });
  const flowChart = createChart(flowContainer, { ...common, autoSize: true });

  const candles = chart.addCandlestickSeries({
    upColor: '#d1d4dc', downColor: '#5d6b8a',
    wickUpColor: '#d1d4dc', wickDownColor: '#5d6b8a',
    borderVisible: false,
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
    });
  }

  const flow = flowChart.addHistogramSeries({ priceFormat: { type: 'volume' } });

  // Keep both panes' time axes locked together.
  chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (r) flowChart.timeScale().setVisibleLogicalRange(r);
  });
  flowChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (r) chart.timeScale().setVisibleLogicalRange(r);
  });

  return {
    setBars(bars) {
      candles.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
      // Demo flow: signed volume (up bar = +v, down bar = -v). Production
      // replaces this with true signed options flow per DATA_CONTRACT.md.
      flow.setData(bars.map((b) => ({
        time: b.t,
        value: b.c >= b.o ? b.v : -b.v,
        color: b.c >= b.o ? 'rgba(120,144,220,0.85)' : 'rgba(139,147,167,0.6)',
      })));
    },

    /** levels: map key -> [{time, value, strength}] from levels.buildLevelSeries */
    setLevels(levels, extendToTime) {
      // Normalize orb size against the strongest node across all levels,
      // so relative strength is comparable between walls/kings.
      const maxStrength = Math.max(
        1,
        ...Object.values(levels).flatMap((pts) => pts.map((p) => p.strength ?? 0))
      );
      for (const [key, points] of Object.entries(levels)) {
        if (!levelSeries[key]) continue;
        const data = points.map(({ time, value }) => ({ time, value }));
        // Extend the last known level to the right edge so it reads as an
        // active level, like Atlas' orb chains running ahead of price.
        if (data.length && extendToTime && extendToTime > data[data.length - 1].time) {
          data.push({ time: extendToTime, value: data[data.length - 1].value });
        }
        levelSeries[key].setData(data);
        // Orbs-lite: one circle per snapshot, sized by node strength.
        levelSeries[key].setMarkers(
          points
            .filter((p) => (p.strength ?? 0) > 0)
            .map((p) => ({
              time: p.time,
              position: 'inBar',
              shape: 'circle',
              color: LEVEL_STYLES[key].color,
              size: 0.4 + 1.6 * Math.sqrt(p.strength / maxStrength),
            }))
        );
      }
    },

    toggleLevel(key, visible) {
      levelSeries[key]?.applyOptions({ visible });
    },

    fit() { chart.timeScale().fitContent(); },
    zoom(from, to) { chart.timeScale().setVisibleRange({ from, to }); },
    styles: LEVEL_STYLES,
  };
}
