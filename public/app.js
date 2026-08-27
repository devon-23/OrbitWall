// Browser preview of the physical LED panel.
//
// Drawing lives in panel.js so the layout is defined once; this file is the
// glue: poll the API, cycle through what came back, and paint the framebuffer
// onto a canvas with a bit of LED bloom.

import { Panel, renderCard, renderMessage, formatCountdown } from './panel.js';
import { assertEmblems } from './emblems.js';

const SIZES = {
  wide: { cols: 128, rows: 64, label: '128x64 HUB75' },
  compact: { cols: 64, rows: 32, label: '64x32 HUB75' }
};

const FETCH_INTERVAL_MS = 10000;
const SAT_DWELL_MS = 6000;
const THIRD_LINE_MS = 3500; // fact <-> next-pass swap
const SCROLL_STEP_MS = 140;

const canvas = document.getElementById('matrix');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const clockEl = document.getElementById('clock');
const geomEl = document.getElementById('geom');
const countEl = document.getElementById('count');
const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const rosterEl = document.getElementById('roster');

let sizeKey = 'wide';
let panel = new Panel(SIZES.wide.cols, SIZES.wide.rows);
let mode = 'notable';

let sats = [];
let satIndex = 0;
let showPass = false;
let scrollOffset = 0;
let message = 'Loading';
let totalTracked = 0;

let lastSatSwitch = 0;
let lastThirdSwitch = 0;
let lastScroll = 0;
let pollTimer = null;
let location_ = { lat: 30.3322, lon: -81.6557 };

// Catch ragged pixel art at startup instead of shipping sheared emblems.
const emblemProblems = assertEmblems();
if (emblemProblems.length) console.error('[emblems]', emblemProblems);

function cellSize() {
  // Keep the rendered board about the same physical width either way, so
  // switching sizes shows the density difference rather than a size change.
  return sizeKey === 'wide' ? 8 : 16;
}

function applySize(key) {
  sizeKey = key;
  const { cols, rows, label } = SIZES[key];
  panel.resize(cols, rows);
  const cell = cellSize();
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  geomEl.textContent = label;
  for (const btn of document.querySelectorAll('[data-size]')) {
    btn.classList.toggle('on', btn.dataset.size === key);
  }
}

function markMode(next) {
  mode = next;
  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.classList.toggle('on', btn.dataset.mode === next);
  }
}

function applyMode(next) {
  markMode(next);
  sats = [];
  satIndex = 0;
  message = 'Loading';
  renderRoster();
  fetchSatellites();
  restartPolling();
}

function paint() {
  const cell = cellSize();
  const dot = Math.max(2, Math.round(cell * 0.7));
  const inset = (cell - dot) / 2;

  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < panel.rows; y++) {
    for (let x = 0; x < panel.cols; x++) {
      const color = panel.get(x, y);
      const px = x * cell + inset;
      const py = y * cell + inset;

      if (!color) {
        ctx.fillStyle = 'rgba(255,255,255,0.020)'; // unlit LED still catches light
        ctx.fillRect(px, py, dot, dot);
        continue;
      }

      const [r, g, b] = color;
      ctx.fillStyle = `rgba(${r},${g},${b},0.16)`;
      ctx.fillRect(px - inset, py - inset, cell, cell); // bloom into the gap
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, py, dot, dot);
    }
  }
}

function tick(now) {
  if (sats.length > 1 && now - lastSatSwitch >= SAT_DWELL_MS) {
    satIndex = (satIndex + 1) % sats.length;
    scrollOffset = 0;
    lastSatSwitch = now;
    renderRoster();
  }

  if (now - lastThirdSwitch >= THIRD_LINE_MS) {
    showPass = !showPass;
    lastThirdSwitch = now;
  }

  if (now - lastScroll >= SCROLL_STEP_MS) {
    scrollOffset++;
    lastScroll = now;
  }

  if (sats.length === 0) renderMessage(panel, message);
  else renderCard(panel, sats[satIndex], { showPass, nowMs: Date.now(), scrollOffset });

  paint();
  requestAnimationFrame(tick);
}

function renderRoster() {
  if (sats.length === 0) {
    rosterEl.innerHTML = '';
    return;
  }
  rosterEl.innerHTML = sats.map((s, i) => `
    <li class="${i === satIndex ? 'on' : ''}">
      <i class="dot" style="background: rgb(${s.color.join(',')})"></i>
      <span class="nm">${escapeHtml(s.name)}</span>
      <span class="rg">${s.rangeKm} km</span>
    </li>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function fetchSatellites() {
  const { lat, lon } = location_;
  try {
    const res = await fetch(`/api/closest?lat=${lat}&lon=${lon}&mode=${mode}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    sats = data.satellites;
    totalTracked = data.totalTracked;
    if (satIndex >= sats.length) satIndex = 0;

    if (sats.length === 0) {
      message = 'No data';
      statusEl.textContent = 'No satellites returned for this mode.';
    } else {
      const top = sats[0];
      countEl.textContent = `${totalTracked.toLocaleString()} tracked`;
      statusEl.textContent = mode === 'iss'
        ? `ISS is ${top.rangeKm.toLocaleString()} km away — next pass ${formatCountdown(top.pass)}.`
        : `Nearest of ${totalTracked.toLocaleString()} objects over ${lat.toFixed(2)}, ${lon.toFixed(2)}.`;
    }
    renderRoster();
  } catch (err) {
    message = 'No data';
    sats = [];
    renderRoster();
    statusEl.textContent = 'Could not reach the server: ' + err.message;
  }
}

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchSatellites, FETCH_INTERVAL_MS);
}

function startTracking(lat, lon) {
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    statusEl.textContent = 'Enter a valid latitude and longitude.';
    return;
  }
  location_ = { lat, lon };
  latInput.value = lat.toFixed(4);
  lonInput.value = lon.toFixed(4);
  message = 'Loading';
  sats = [];
  statusEl.textContent = 'Looking up satellites...';
  fetchSatellites();
  restartPolling();
}

document.getElementById('locForm').addEventListener('submit', (e) => {
  e.preventDefault();
  startTracking(parseFloat(latInput.value), parseFloat(lonInput.value));
});

document.getElementById('geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation is not supported by this browser.';
    return;
  }
  statusEl.textContent = 'Locating...';
  navigator.geolocation.getCurrentPosition(
    (pos) => startTracking(pos.coords.latitude, pos.coords.longitude),
    () => { statusEl.textContent = 'Could not get your location — enter it manually.'; }
  );
});

for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.addEventListener('click', () => applyMode(btn.dataset.mode));
}
for (const btn of document.querySelectorAll('[data-size]')) {
  btn.addEventListener('click', () => applySize(btn.dataset.size));
}

setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
}, 1000);

// Slow drifting starfield behind the page, drawn once per resize.
function drawStars() {
  const sky = document.getElementById('stars');
  const sctx = sky.getContext('2d');
  sky.width = window.innerWidth;
  sky.height = window.innerHeight;
  sctx.clearRect(0, 0, sky.width, sky.height);
  const n = Math.round((sky.width * sky.height) / 6000);
  for (let i = 0; i < n; i++) {
    const x = Math.random() * sky.width;
    const y = Math.random() * sky.height;
    const r = Math.random() * 1.1;
    sctx.globalAlpha = 0.2 + Math.random() * 0.6;
    sctx.fillStyle = Math.random() > 0.92 ? '#9fd8ff' : '#ffffff';
    sctx.beginPath();
    sctx.arc(x, y, r, 0, Math.PI * 2);
    sctx.fill();
  }
  sctx.globalAlpha = 1;
}
window.addEventListener('resize', drawStars);
drawStars();

applySize('wide');
markMode('notable'); // startTracking does the first fetch, so don't fetch twice
startTracking(location_.lat, location_.lon);
requestAnimationFrame(tick);
