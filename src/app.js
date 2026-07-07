/**
 * app.js — glue. Load data via an adapter, derive levels, render, wire toggles.
 */
import { sampleAdapter, listSeries } from './adapter.js';
import { buildLevelSeries, buildStrikeOrbs, parseValue } from './levels.js';
import { createAtlasChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

// Current series state, so orb mode can re-render without refetching.
const state = { frames: [], lastTime: null, orbMode: 'net', orbMin: 0.25 };

function renderOrbs(atlas) {
  atlas.setStrikeOrbs(
    buildStrikeOrbs(state.frames, { mode: state.orbMode }),
    state.lastTime,
    state.orbMode,
    state.orbMin
  );
}

async function loadSeries(atlas, symbol) {
  const { bars, frames, derivedFrom, note } = await sampleAdapter(symbol);
  const { levels, netExposure } = buildLevelSeries(frames);
  state.frames = frames;
  state.lastTime = bars[bars.length - 1]?.t;

  atlas.setBars(bars);
  atlas.setLevels(levels, state.lastTime);
  renderOrbs(atlas);
  atlas.fit();
  renderHeatmap(frames[frames.length - 1]);

  const last = bars[bars.length - 1];
  const first = frames[0];
  $('#symbol').textContent = symbol + (derivedFrom ? ` (derived ← ${derivedFrom})` : '');
  $('#price').textContent = last ? last.c.toFixed(2) : '—';
  const lastNet = netExposure[netExposure.length - 1];
  $('#net').textContent = lastNet ? `Net GEX ${fmtDollars(lastNet.value)}` : '';
  const firstDay = first?.tradingDay ?? '';
  const lastDay = frames[frames.length - 1]?.tradingDay ?? '';
  $('#meta').textContent =
    `${frames.length} snapshots · ${firstDay}${lastDay && lastDay !== firstDay ? ' → ' + lastDay : ''} · sample data` +
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

  // Strike-orbs toggle (the per-strike heaviness field)
  const orbChip = document.createElement('button');
  orbChip.className = 'chip on';
  orbChip.innerHTML = '<span class="dot" style="background:rgba(38,166,154,0.9)"></span>Strike Orbs';
  orbChip.addEventListener('click', () =>
    atlas.toggleStrikeOrbs(orbChip.classList.toggle('on'))
  );
  togglesEl.appendChild(orbChip);

  // Orb strength filter — the Orbs V2 "Min Clamp": hide nodes weaker than
  // this fraction of the session's strongest node.
  const minSel = document.createElement('select');
  minSel.id = 'orbmin';
  minSel.title = 'Minimum orb strength (fraction of the session’s strongest node)';
  for (const [label, frac] of [['All orbs', 0], ['Strong ≥25%', 0.25], ['Heavy ≥50%', 0.5], ['Strongest ≥75%', 0.75]]) {
    const opt = document.createElement('option');
    opt.value = frac;
    opt.textContent = label;
    if (frac === state.orbMin) opt.selected = true;
    minSel.appendChild(opt);
  }
  minSel.addEventListener('change', () => {
    state.orbMin = parseFloat(minSel.value);
    renderOrbs(atlas);
  });
  togglesEl.appendChild(minSel);

  // Orb mode: Net (where structure sits) vs Δ Flow (money in/out per interval)
  const deltaChip = document.createElement('button');
  deltaChip.className = 'chip';
  deltaChip.title = 'Orb mode: off = net GEX per strike, on = change vs previous snapshot (building green / draining red)';
  deltaChip.innerHTML = '<span class="dot" style="background:rgba(102,187,106,0.9)"></span>Δ Flow';
  deltaChip.addEventListener('click', () => {
    state.orbMode = deltaChip.classList.toggle('on') ? 'delta' : 'net';
    renderOrbs(atlas);
    if (!orbChip.classList.contains('on')) atlas.toggleStrikeOrbs(false);
  });
  togglesEl.appendChild(deltaChip);

  // Heatmap sidecar toggle
  const hmChip = document.createElement('button');
  hmChip.className = 'chip';
  hmChip.innerHTML = '<span class="dot" style="background:#7e57c2"></span>Heatmap';
  hmChip.addEventListener('click', () => {
    const on = hmChip.classList.toggle('on');
    $('#sidecar').classList.toggle('hidden', !on);
  });
  togglesEl.appendChild(hmChip);

  // Timeframe tabs are cosmetic in the demo (one sample resolution).
  document.querySelectorAll('.tf').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );
}

/**
 * Latest-frame heatmap sidecar: strike × expiry grid of the most recent
 * snapshot, diverging color scale (purple = negative GEX, teal→green =
 * positive), sqrt-compressed, anchored to the frame's own min/max — the
 * same scheme as gex-replay. Shows the ~40 heaviest strikes.
 */
function renderHeatmap(frame, maxRows = 40) {
  const el = $('#heatmap');
  if (!frame) { el.innerHTML = ''; return; }
  const spot = parseFloat(frame.price);

  const rows = frame.rows
    .map((r) => ({ strike: r.strike, vals: r.values.map((v) => parseValue(v.text)) }))
    .map((r) => ({ ...r, peak: Math.max(...r.vals.map(Math.abs)) }))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, maxRows)
    .sort((a, b) => b.strike - a.strike);

  const maxAbs = Math.max(1, ...rows.map((r) => r.peak));
  const color = (v) => {
    const t = Math.sqrt(Math.abs(v) / maxAbs);
    return v < 0 ? `rgba(126,87,194,${0.12 + 0.75 * t})` : `rgba(38,166,154,${0.10 + 0.75 * t})`;
  };
  const fmt = (v) => {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(0) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v ? v.toFixed(0) : '·';
  };

  el.style.gridTemplateColumns = `60px repeat(${frame.expiries.length}, 1fr)`;
  const spotStrike = rows.reduce(
    (best, r) => (Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best),
    rows[0]?.strike ?? 0
  );

  let html = '<div class="hm-head hm-strike">strike</div>' +
    frame.expiries.map((e) => `<div class="hm-head">${e.slice(0, 5)}</div>`).join('');
  for (const r of rows) {
    html += `<div class="hm-cell hm-strike${r.strike === spotStrike ? ' hm-spot' : ''}">${r.strike}</div>`;
    html += r.vals
      .map((v) => `<div class="hm-cell" style="background:${color(v)}">${fmt(v)}</div>`)
      .join('');
  }
  el.innerHTML = html;
  $('#sidecar-time').textContent = new Date(frame.capturedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
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
