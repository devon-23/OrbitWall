// The panel renderer: turns one satellite card into a framebuffer.
//
// Implements docs/MATRIX_LAYOUT.md. The ESP32 sketch draws the same layout
// from the same numbers, so change the doc first, then both renderers.
//
// Two layouts exist because the panel size changes what is possible:
//   128x64 ("wide")    - 21 chars per line, 8 lines. Everything fits, nothing
//                        scrolls. This is the FlightWall-style board.
//   64x32  ("compact") - 10 chars per line, 4 lines. Long text has to scroll.

import { drawText, textWidth, fit, CHAR_W, CHAR_H } from './font.js';
import { drawEmblem, drawEmblemScaled, EMBLEM_SIZE } from './emblems.js';

const COLORS = {
  label: [255, 255, 255],
  operator: [150, 160, 210],
  kind: [120, 200, 255],
  stat: [190, 210, 255],
  statKey: [110, 130, 190],
  fact: [255, 190, 90],
  divider: [40, 46, 74],
  horizon: [50, 58, 92],
  tick: [80, 92, 140],
  dim: [70, 80, 120],
  alert: [255, 90, 90]
};

export class Panel {
  constructor(cols, rows) {
    this.resize(cols, rows);
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.buffer = new Array(cols * rows).fill(null);
    this.wide = cols >= 128;
  }

  clear() {
    this.buffer.fill(null);
  }

  set(x, y, color) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    this.buffer[y * this.cols + x] = color;
  }

  get(x, y) {
    return this.buffer[y * this.cols + x];
  }

  hline(y, color, from = 0, to = this.cols - 1, step = 1) {
    for (let x = from; x <= to; x += step) this.set(x, y, color);
  }

  // Draws text clipped to a box. Returns nothing; out-of-box pixels are
  // dropped rather than wrapping, which is what the hardware does.
  text(x, y, str, color, box) {
    const clip = box || { x0: 0, y0: 0, x1: this.cols - 1, y1: this.rows - 1 };
    drawText(x, y, str, (px, py) => {
      if (px < clip.x0 || px > clip.x1 || py < clip.y0 || py > clip.y1) return;
      this.set(px, py, color);
    });
  }

  // A marquee that only scrolls when the text genuinely does not fit.
  scrollText(x, y, str, color, box, offset) {
    const avail = box.x1 - box.x0 + 1;
    if (textWidth(str) <= avail) {
      this.text(x, y, str, color, box);
      return;
    }
    const span = textWidth(str) + CHAR_W * 2;
    const shift = ((offset % span) + span) % span;
    this.text(box.x0 - shift, y, str, color, box);
    this.text(box.x0 - shift + span, y, str, color, box);
  }
}

function formatSpeed(kmh) {
  if (!kmh) return '--';
  return kmh >= 10000 ? `${(kmh / 1000).toFixed(1)}k` : String(kmh);
}

function formatRange(km) {
  if (km === null || km === undefined) return '--';
  return km >= 10000 ? `${(km / 1000).toFixed(1)}Mm` : `${km}km`;
}

// "in 4m", "in 2h13", or "now" for a pass already in progress.
export function formatCountdown(pass, nowMs = Date.now()) {
  if (!pass) return 'no pass in 36h';
  if (pass.inProgress || nowMs >= pass.startMs) return 'overhead now';
  const s = Math.max(0, Math.round((pass.startMs - nowMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `in ${h}h${String(m).padStart(2, '0')}m`;
  return `in ${m}m${String(s % 60).padStart(2, '0')}s`;
}

function compass(az) {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(az / 45) % 8];
}

// A telemetry row split two ways: `left` against the left margin, `right`
// flush to the right edge. Right-aligning the second field keeps its digits
// in a fixed column, so a value going from 999 to 1000 km no longer shoves
// the label sideways — on a glanceable board that wobble is the whole
// problem. The left field is truncated (never the right) when a long value
// squeezes the row, and a one-character gutter keeps them from touching.
function statRow(panel, y, left, right, box, color = COLORS.stat) {
  const rightX = box.x1 - textWidth(right) + 1;
  const leftMax = rightX - CHAR_W - box.x0;
  if (leftMax > 0) panel.text(box.x0, y, fit(left, leftMax), color, box);
  panel.text(rightX, y, right, color, box);
}

// What the bottom line shows this tick. The rotation is the fun fact, then
// the next pass when one is known, then what kind of object this is. Only
// the headline satellite carries a pass, so the others cycle through two.
function thirdLine(sat, state) {
  const stops = [{ text: sat.fact || '', color: COLORS.fact }];
  if (sat.pass !== undefined) {
    stops.push({
      text: `Next pass ${formatCountdown(sat.pass, state.nowMs)}`,
      color: COLORS.fact
    });
  }
  if (sat.kind) stops.push({ text: sat.kind, color: sat.color || COLORS.kind });
  return stops[Math.abs(state.thirdIndex || 0) % stops.length];
}

// The wide 128x64 board: emblem block, three identity lines beside it, a
// divider, then full-width telemetry and a rotating fact.
function renderWide(panel, sat, state) {
  const emblemX = 2;
  const emblemY = 2;
  drawEmblem(sat.emblem, emblemX, emblemY, 1, (x, y, c) => panel.set(x, y, c));

  const colX = emblemX + EMBLEM_SIZE + 3; // 29
  const colBox = { x0: colX, y0: 0, x1: panel.cols - 2, y1: 27 };

  // Identity block, most specific first: the catalogue name, then the short
  // friendly label, then who flies it. `kind` used to sit on the third row
  // and now rides the rotating line at the bottom instead.
  //
  // The slots keep their own colours, so the type colour still appears in
  // this block -- it just lands on the operator now.
  const identWidth = colBox.x1 - colBox.x0;

  // The name is the one identity row that regularly overflows: 16 characters
  // fit, and about 9.5% of the active catalogue is longer. It marquees only
  // when it has to, so the 90% that fit stay perfectly still. The box clips
  // at colX so a scrolling name can never bleed over the emblem.
  const nameBox = { x0: colX, y0: 0, x1: panel.cols - 2, y1: 9 };
  panel.scrollText(colX, 2, sat.name || '', COLORS.label, nameBox,
    state.nameScrollOffset || 0);

  // Label and operator are short by construction -- check.mjs fails the
  // build if either overflows -- so they are only ever truncated.
  panel.text(colX, 11, fit(sat.label, identWidth), COLORS.operator, colBox);
  panel.text(colX, 20, fit(sat.operator, identWidth), sat.color || COLORS.kind, colBox);

  // Divider between the identity block and the telemetry block.
  panel.hline(29, COLORS.divider);

  const wideBox = { x0: 1, y0: 31, x1: panel.cols - 2, y1: 56 };

  // Altitude and elevation sit left; speed and azimuth are right-aligned.
  statRow(panel, 31, `Alt:${sat.altitudeKm}km`, `Spd:${formatSpeed(sat.speedKmh)}`, wideBox);

  if (sat.elevationDeg >= 0) {
    statRow(panel, 40, `El:${Math.round(sat.elevationDeg)}°`,
      `Az:${sat.azimuthDeg}° ${compass(sat.azimuthDeg)}`, wideBox);
  } else {
    // Below the horizon there is no useful look angle, so the row falls back
    // to the range — still right-aligned, so the number holds its column.
    statRow(panel, 40, 'Below horizon', formatRange(sat.rangeKm), wideBox);
  }

  // The bottom line cycles so the board always has something changing
  // without anything sliding around. `kind` is one of the stops now that it
  // no longer has a row of its own, and it keeps the type colour.
  const slot = thirdLine(sat, state);
  panel.text(1, 49, fit(slot.text, panel.cols - 2), slot.color, wideBox);

  drawSkyStrip(panel, sat, 58, panel.rows - 1);
}

// A six-row strip along the bottom: horizon, compass ticks, and a marker
// showing where in the sky to actually look.
function drawSkyStrip(panel, sat, top, bottom) {
  const baseline = bottom;
  panel.hline(baseline, COLORS.horizon, 0, panel.cols - 1, 2);

  // Ticks at N / E / S / W.
  for (let i = 0; i < 4; i++) {
    const x = Math.round((i / 4) * panel.cols);
    panel.set(Math.min(x, panel.cols - 1), baseline - 1, COLORS.tick);
  }

  if (sat.elevationDeg === undefined || sat.elevationDeg === null) return;
  const span = baseline - top;
  const x = Math.round((sat.azimuthDeg / 360) * (panel.cols - 1));
  const clamped = Math.max(0, Math.min(90, sat.elevationDeg));
  const y = baseline - Math.round((clamped / 90) * span);

  const color = sat.elevationDeg < 0 ? COLORS.dim : (sat.color || COLORS.label);
  panel.set(x, y, color);
  panel.set(x - 1, y, color);
  panel.set(x + 1, y, color);
  panel.set(x, y - 1, color);
  panel.set(x, y + 1, color);
}

// The cramped 64x32 board: a small emblem, two identity lines, one telemetry
// line, and a fact that has to scroll because 10 characters is not enough.
function renderCompact(panel, sat, state) {
  const size = 14;
  drawEmblemScaled(sat.emblem, 0, 1, size, (x, y, c) => panel.set(x, y, c));

  const colX = size + 2;
  const idBox = { x0: colX, y0: 0, x1: panel.cols - 1, y1: 15 };
  panel.text(colX, 1, fit(sat.label, panel.cols - colX), COLORS.label, idBox);
  panel.text(colX, 9, fit(sat.kind, panel.cols - colX), sat.color || COLORS.kind, idBox);

  const statBox = { x0: 0, y0: 16, x1: panel.cols - 1, y1: 23 };
  const stat = sat.elevationDeg >= 0
    ? `El${Math.round(sat.elevationDeg)} ${formatRange(sat.rangeKm)}`
    : formatRange(sat.rangeKm);
  panel.text(1, 16, fit(stat, panel.cols - 2), COLORS.stat, statBox);

  // 10 characters cannot hold a name, so the compact board keeps showing the
  // label and the kind, and only its bottom line follows the rotation.
  const factBox = { x0: 0, y0: 24, x1: panel.cols - 1, y1: 31 };
  const showPass = Math.abs(state.thirdIndex || 0) % 2 === 1;
  const third = showPass && sat.pass !== undefined
    ? `Pass ${formatCountdown(sat.pass, state.nowMs)}`
    : sat.fact || '';
  panel.scrollText(0, 24, third, COLORS.fact, factBox, state.scrollOffset);
}

// Centred message for the loading / error states.
export function renderMessage(panel, message, color = COLORS.alert) {
  panel.clear();
  const y = Math.floor((panel.rows - CHAR_H) / 2);
  const x = Math.max(1, Math.floor((panel.cols - textWidth(message)) / 2));
  panel.text(x, y, message, color);
}

export function renderCard(panel, sat, state) {
  panel.clear();
  if (panel.wide) renderWide(panel, sat, state);
  else renderCompact(panel, sat, state);
}

export { COLORS };
