// Static checks for the things that silently break the panel:
// text that overflows the board, ragged pixel art, glyphs the font can't
// draw, and layout regions that come out empty.
//
// Run with `npm test`.

import { createRequire } from 'node:module';
import { Panel, renderCard, renderMessage } from '../public/panel.js';
import { assertEmblems, emblemFor } from '../public/emblems.js';
import { textWidth } from '../public/font.js';

const require = createRequire(import.meta.url);
const { PROFILES, DEFAULT_PROFILE, UNIVERSAL_FACTS, FACT_MAX_CHARS } = require('../server/facts');
const { classify, colorFor } = require('../server/satType');

const failures = [];
const fail = (msg) => failures.push(msg);

const WIDE = { cols: 128, rows: 64 };
const COMPACT = { cols: 64, rows: 32 };

// 1. Pixel art is rectangular and uses known colours.
for (const problem of assertEmblems()) fail(`emblem: ${problem}`);

// 2. Text fits the board it was written for.
const allProfiles = [...PROFILES, DEFAULT_PROFILE];
const IDENT_MAX_PX = WIDE.cols - (2 + 24 + 3) - 2; // emblem block + margins

for (const p of allProfiles) {
  for (const f of p.facts) {
    if (f.length > FACT_MAX_CHARS) fail(`fact too long (${f.length} > ${FACT_MAX_CHARS}) [${p.id}]: "${f}"`);
  }
  for (const key of ['label', 'operator', 'kind']) {
    if (textWidth(p[key]) > IDENT_MAX_PX) {
      fail(`${key} overflows identity column [${p.id}]: "${p[key]}"`);
    }
  }
  if (!emblemFor(p.emblem)) fail(`unknown emblem "${p.emblem}" [${p.id}]`);
}
for (const f of UNIVERSAL_FACTS) {
  if (f.length > FACT_MAX_CHARS) fail(`universal fact too long: "${f}"`);
}

// 3. Every character we intend to draw exists in the font. textWidth is
//    length-based, so instead check that drawing produces ink for non-space.
import { drawText } from '../public/font.js';
const corpus = new Set();
for (const p of allProfiles) {
  for (const s of [p.label, p.operator, p.kind, ...p.facts]) for (const ch of s) corpus.add(ch);
}
for (const ch of [...UNIVERSAL_FACTS.join(''), ...'0123456789.:-°/ kmAltSpdElAzNextpass']) corpus.add(ch);
for (const ch of corpus) {
  if (ch === ' ') continue;
  let lit = 0;
  drawText(0, 0, ch, () => { lit++; });
  if (lit === 0) fail(`font has no glyph for ${JSON.stringify(ch)}`);
}

// 4. Regression guard: a rendered card must put ink in every region of the
//    board. A blank half is the bug that started this rewrite.
function inkByBand(panel, bands) {
  return bands.map(([y0, y1]) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < panel.cols; x++) if (panel.get(x, y)) n++;
    }
    return n;
  });
}

function sampleCard(profile, overrides = {}) {
  const type = classify(profile.id === 'iss' ? 'ISS (ZARYA)' : profile.label);
  return {
    name: `${profile.label} TEST-1`,
    label: profile.label,
    operator: profile.operator,
    kind: profile.kind,
    emblem: profile.emblem,
    type,
    color: colorFor(type),
    rangeKm: 842,
    altitudeKm: 417,
    speedKmh: 27607,
    elevationDeg: 42.3,
    azimuthDeg: 187,
    fact: profile.facts[0],
    pass: { startMs: Date.now() + 4200000, peakElevationDeg: 61, durationS: 400, inProgress: false },
    ...overrides
  };
}

const widePanel = new Panel(WIDE.cols, WIDE.rows);
const compactPanel = new Panel(COMPACT.cols, COMPACT.rows);

// Bands that must never be empty: emblem, identity text, telemetry, fact.
const WIDE_BANDS = [[2, 26], [2, 26], [31, 38], [40, 47], [49, 56]];
const WIDE_BAND_NAMES = ['emblem/identity', 'identity', 'telemetry 1', 'telemetry 2', 'third line'];

for (const p of allProfiles) {
  // 0 = fact, 1 = next pass, 2 = kind. Every stop must leave ink behind.
  for (const thirdIndex of [0, 1, 2]) {
    for (const below of [false, true]) {
      const card = sampleCard(p, below ? { elevationDeg: -12.5 } : {});
      const state = { thirdIndex, nowMs: Date.now(), scrollOffset: 0 };

      renderCard(widePanel, card, state);
      const counts = inkByBand(widePanel, WIDE_BANDS);
      counts.forEach((n, i) => {
        if (n === 0) fail(`wide layout band "${WIDE_BAND_NAMES[i]}" is empty [${p.id}, thirdIndex=${thirdIndex}, below=${below}]`);
      });

      // Compact must at least draw identity and the bottom line.
      renderCard(compactPanel, card, state);
      const [top, bottom] = inkByBand(compactPanel, [[0, 15], [16, 31]]);
      if (top === 0) fail(`compact top half empty [${p.id}]`);
      if (bottom === 0) fail(`compact bottom half empty [${p.id}, thirdIndex=${thirdIndex}]`);
    }
  }
}

// 5. Nothing may be drawn outside the board.
for (const panel of [widePanel, compactPanel]) {
  if (panel.buffer.length !== panel.cols * panel.rows) fail('framebuffer size drifted from panel geometry');
}

// 6. The message state renders something.
renderMessage(widePanel, 'No data');
if (inkByBand(widePanel, [[0, WIDE.rows - 1]])[0] === 0) fail('renderMessage drew nothing');

// 7. A scrolling name must stay inside the identity column.
//
// The name row sits beside the emblem, so a marquee that ignored its clip
// box would slide straight over the artwork. Rather than assert "no ink left
// of x=29" -- the emblem itself lives there -- this renders a short name as a
// baseline, then checks that a long name at every scroll offset leaves that
// whole region byte-for-byte identical.
const IDENT_X = 29;

function regionSignature(panel, x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = panel.get(x, y);
      out.push(c ? c.join(',') : '-');
    }
  }
  return out.join('|');
}

function inkInRect(panel, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (panel.get(x, y)) n++;
  }
  return n;
}

const scrollState = (nameScrollOffset) => ({
  thirdIndex: 0, nowMs: Date.now(), scrollOffset: 0, nameScrollOffset
});

renderCard(widePanel, sampleCard(DEFAULT_PROFILE, { name: 'NOAA 19' }), scrollState(0));
const emblemBaseline = regionSignature(widePanel, 0, 0, IDENT_X - 1, 27);

// The longest names in the active catalogue run 24 characters.
const longCard = sampleCard(DEFAULT_PROFILE, { name: 'SHIJIAN-6 01A (SJ-6 01A)' });
let bledAt = null;
let emptyAt = null;
for (let off = 0; off <= 220 && bledAt === null; off += 3) {
  renderCard(widePanel, longCard, scrollState(off));
  if (regionSignature(widePanel, 0, 0, IDENT_X - 1, 27) !== emblemBaseline) bledAt = off;
  if (emptyAt === null && inkInRect(widePanel, IDENT_X, 2, WIDE.cols - 1, 8) === 0) emptyAt = off;
}
if (bledAt !== null) fail(`scrolling name bleeds into the emblem column at offset ${bledAt}`);
if (emptyAt !== null) fail(`name row is blank mid-scroll at offset ${emptyAt}`);

// A name that fits must not move at all, whatever the offset says.
const shortCard = sampleCard(DEFAULT_PROFILE, { name: 'NOAA 19' });
renderCard(widePanel, shortCard, scrollState(0));
const stillBaseline = regionSignature(widePanel, IDENT_X, 2, WIDE.cols - 1, 8);
for (const off of [1, 17, 64, 155]) {
  renderCard(widePanel, shortCard, scrollState(off));
  if (regionSignature(widePanel, IDENT_X, 2, WIDE.cols - 1, 8) !== stillBaseline) {
    fail(`a name that fits should never scroll, but moved at offset ${off}`);
    break;
  }
}

if (failures.length) {
  console.error(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK — emblems, fonts, text fit and layout bands all check out.');
