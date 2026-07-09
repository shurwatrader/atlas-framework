/**
 * app.js — glue. Load data via an adapter, derive levels, render, wire the
 * replay transport (ported from gex-replay-basic: same controls, same keys).
 */
import { replayAdapter, listSeries } from './adapter.js';
import { buildLevelSeries, buildStrikeOrbs, parseValue } from './levels.js';
import { createAtlasChart } from './chart.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  frames: [],
  frameIndex: 0,
  playing: false,
  timer: null,
  lastTime: null,      // right edge of the bar series (secs)
  orbMode: 'net',
  orbMin: 0.25,
  symbol: null,
  derivedFrom: null,
  note: null,
};

const frameTime = (f) => Math.floor(Date.parse(f.capturedAt) / 1000);
const atLive = () => state.frameIndex >= state.frames.length - 1;

function renderOrbs(atlas) {
  atlas.setStrikeOrbs(
    buildStrikeOrbs(state.frames, { mode: state.orbMode, range: state.orbRange, snapTo: state.barTimes }),
    state.lastTime,
    state.orbMode,
    state.orbMin
  );
}

// ---------- trading day + snapshot clock (same display as gex-replay-basic:
// Trading Day = the 8 PM ET session roll; Snapshot = exact ET date+time, so
// overnight frames read e.g. "Trading Day 7/6 · Snapshot 7/5 8:00 PM") ------
function fmtTradingDay(td) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(td || '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (td || '—');
}
function fmtSnapET(capturedAt) {
  const d = capturedAt ? new Date(capturedAt) : null;
  if (!d || isNaN(d)) return '—';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

// ---------- replay transport ----------
function step() { return parseInt($('#stepSelect').value, 10) || 1; }
function fps() { return 2 * parseFloat($('#speedSelect').value); }

function showFrame(atlas, idx) {
  const frames = state.frames;
  if (!frames.length) return;
  idx = Math.max(0, Math.min(frames.length - 1, idx));
  state.frameIndex = idx;
  const frame = frames[idx];

  // Chart shows only what was known at the playhead; at the newest frame the
  // truncation lifts and you get the full live view.
  atlas.setReplayTime(atLive() ? null : frameTime(frame));
  renderHeatmap(frame);

  $('#price').textContent = frame.price != null ? Number(frame.price).toFixed(2) : '—';
  const net = frame.netExposureValue ?? parseValue(String(frame.netExposure).replace(/[$,]/g, ''));
  $('#net').textContent = net ? `Net GEX ${fmtDollars(net)}` : '';
  $('#tradingDay').textContent = fmtTradingDay(frame.tradingDay);
  $('#snapET').textContent = fmtSnapET(frame.capturedAt);
  $('#scrubber').value = String(idx);
  $('#frameLabel').textContent = `${idx + 1} / ${frames.length}`;
}

function play(atlas) {
  if (state.frames.length < 2) return;
  if (atLive()) showFrame(atlas, 0); // replay from the top when already live
  state.playing = true;
  atlas.freezeScale(true); // hold the view still while playing
  const btn = $('#playBtn');
  btn.textContent = '⏸';
  btn.classList.add('playing');
  scheduleTick(atlas);
}
function scheduleTick(atlas) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (!state.playing) return;
    const next = state.frameIndex + step();
    showFrame(atlas, next);
    if (atLive()) { stop(); return; } // reached the live edge
    scheduleTick(atlas);
  }, 1000 / fps());
}
function stop() {
  state.playing = false;
  clearTimeout(state.timer);
  state.atlas?.freezeScale(false); // hand the axis back to adaptive autoscale
  const btn = $('#playBtn');
  btn.textContent = '▶';
  btn.classList.remove('playing');
}

async function loadSeries(atlas, symbol) {
  stop();
  const { bars, frames, derivedFrom, note } = await replayAdapter(symbol);
  Object.assign(state, { frames, symbol, derivedFrom, note });
  state.lastTime = bars[bars.length - 1]?.t;
  // Every drawn point must sit on a real bar time — see levels.snapToBar.
  state.barTimes = bars.map((b) => b.t);
  const { levels } = buildLevelSeries(frames, { snapTo: state.barTimes });

  // Orb field only covers strikes near where price actually traded (±5%);
  // far-OTM OI magnets stay off the chart (they're on the board + levels).
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  state.orbRange = bars.length ? { min: lo * 0.95, max: hi * 1.05 } : null;

  atlas.setBars(bars);
  atlas.setLevels(levels, state.lastTime);
  renderOrbs(atlas);
  atlas.fit();

  $('#symbol').textContent = symbol + (derivedFrom ? ` (derived ← ${derivedFrom})` : '');
  const firstDay = frames[0]?.tradingDay ?? '';
  const lastDay = frames[frames.length - 1]?.tradingDay ?? '';
  $('#meta').innerHTML =
    `${frames.length} snapshots · ${firstDay}${lastDay && lastDay !== firstDay ? ' → ' + lastDay : ''}` +
    ` · data: <a href="https://github.com/shurwatrader/gex-replay-basic">gex-replay-basic</a> format` +
    (note ? ` · ${note}` : '');

  $('#scrubber').max = String(Math.max(0, frames.length - 1));
  showFrame(atlas, frames.length - 1); // start at the live edge (full session)
}

async function main() {
  const atlas = createAtlasChart($('#chart'), $('#flow'));
  state.atlas = atlas;    // so stop() can release the playback scale lock
  window.__atlas = atlas; // dev/debug handle

  // Ticker switcher straight from the gex-replay-basic manifest
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

  // Heatmap sidecar toggle — on by default: the board and the chart together
  // are the whole point of the replay view.
  const hmChip = document.createElement('button');
  hmChip.className = 'chip on';
  hmChip.innerHTML = '<span class="dot" style="background:#7e57c2"></span>Heatmap';
  hmChip.addEventListener('click', () => {
    const on = hmChip.classList.toggle('on');
    $('#sidecar').classList.toggle('hidden', !on);
  });
  togglesEl.appendChild(hmChip);

  // Replay transport — identical wiring to gex-replay-basic
  $('#playBtn').onclick = () => (state.playing ? stop() : play(atlas));
  $('#nextBtn').onclick = () => { stop(); showFrame(atlas, state.frameIndex + step()); };
  $('#prevBtn').onclick = () => { stop(); showFrame(atlas, state.frameIndex - step()); };
  $('#firstBtn').onclick = () => { stop(); showFrame(atlas, 0); };
  $('#lastBtn').onclick = () => { stop(); showFrame(atlas, state.frames.length - 1); };
  $('#scrubber').oninput = () => { stop(); showFrame(atlas, +$('#scrubber').value); };
  $('#speedSelect').onchange = () => { if (state.playing) scheduleTick(atlas); };

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? stop() : play(atlas); }
    else if (e.code === 'ArrowRight') { stop(); showFrame(atlas, state.frameIndex + step()); }
    else if (e.code === 'ArrowLeft') { stop(); showFrame(atlas, state.frameIndex - step()); }
    else if (e.code === 'Home') { stop(); showFrame(atlas, 0); }
    else if (e.code === 'End') { stop(); showFrame(atlas, state.frames.length - 1); }
  });

  // Timeframe tabs are cosmetic in the demo (one sample resolution).
  document.querySelectorAll('.tf').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    })
  );
}

/**
 * Heatmap sidecar: the strike × expiry board at the playhead frame —
 * gex-replay-basic's grid, docked beside the chart and scrubbing in sync.
 * Diverging color scale (purple = negative GEX, teal→green = positive),
 * sqrt-compressed, anchored to the frame's own min/max. ~40 heaviest strikes.
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
  $('#sidecar-time').textContent = fmtSnapET(frame.capturedAt);
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
