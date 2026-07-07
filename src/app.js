/**
 * app.js — glue. Load data via an adapter, derive levels, render, wire toggles.
 */
import { sampleAdapter, listSeries } from './adapter.js';
import { buildLevelSeries } from './levels.js';
import { createAtlasChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

async function loadSeries(atlas, symbol) {
  const { bars, frames, derivedFrom, note } = await sampleAdapter(symbol);
  const { levels, netExposure } = buildLevelSeries(frames);

  atlas.setBars(bars);
  atlas.setLevels(levels, bars[bars.length - 1]?.t);
  atlas.fit();

  const last = bars[bars.length - 1];
  const first = frames[0];
  $('#symbol').textContent = symbol + (derivedFrom ? ` (derived ← ${derivedFrom})` : '');
  $('#price').textContent = last ? last.c.toFixed(2) : '—';
  const lastNet = netExposure[netExposure.length - 1];
  $('#net').textContent = lastNet ? `Net GEX ${fmtDollars(lastNet.value)}` : '';
  $('#meta').textContent =
    `${frames.length} snapshots · ${first?.tradingDay ?? ''} · sample data` +
    (note ? ` · ${note}` : '');
}

async function main() {
  const atlas = createAtlasChart($('#chart'), $('#flow'));
  window.__atlas = atlas; // dev/debug handle

  // Ticker switcher from the sample manifest
  const tickerSel = $('#ticker');
  for (const s of await listSeries()) {
    const opt = document.createElement('option');
    opt.value = s.symbol;
    opt.textContent = s.symbol;
    tickerSel.appendChild(opt);
  }
  tickerSel.addEventListener('change', () =>
    loadSeries(atlas, tickerSel.value).catch(showError)
  );

  await loadSeries(atlas, tickerSel.value);

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

function fmtDollars(v) {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return `${(v / 1e3).toFixed(0)}K`;
}

function showError(err) {
  $('#meta').textContent = `Failed to load: ${err.message}`;
  console.error(err);
}

main().catch(showError);
