/**
 * app.js — glue. Load data via an adapter, derive levels, render, wire toggles.
 */
import { sampleAdapter } from './adapter.js';
import { buildLevelSeries } from './levels.js';
import { createAtlasChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

async function main() {
  const atlas = createAtlasChart($('#chart'), $('#flow'));

  const { symbol, bars, frames } = await sampleAdapter();
  const { levels, netExposure } = buildLevelSeries(frames);

  atlas.setBars(bars);
  atlas.setLevels(levels, bars[bars.length - 1]?.t);
  atlas.fit();

  // Header readout
  const last = bars[bars.length - 1];
  const first = frames[0];
  $('#symbol').textContent = symbol;
  $('#price').textContent = last ? last.c.toFixed(2) : '—';
  const lastNet = netExposure[netExposure.length - 1];
  $('#net').textContent = lastNet
    ? `Net GEX ${(lastNet.value / 1e6).toFixed(1)}M`
    : '';
  $('#meta').textContent =
    `${frames.length} snapshots · ${first?.tradingDay ?? ''} · sample data`;

  // Level toggle chips
  const togglesEl = $('#toggles');
  for (const [key, style] of Object.entries(atlas.styles)) {
    const chip = document.createElement('button');
    chip.className = 'chip on';
    chip.innerHTML = `<span class="dot" style="background:${style.color}"></span>${style.title}`;
    chip.addEventListener('click', () => {
      const on = chip.classList.toggle('on');
      atlas.toggleLevel(key, on);
    });
    togglesEl.appendChild(chip);
  }

  // Timeframe tabs are cosmetic in the demo (one sample resolution).
  document.querySelectorAll('.tf').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );
}

main().catch((err) => {
  $('#meta').textContent = `Failed to load: ${err.message}`;
  console.error(err);
});
