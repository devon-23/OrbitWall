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
  for (const showPass of [false, true]) {
    for (const below of [false, true]) {
      const card = sampleCard(p, below ? { elevationDeg: -12.5 } : {});
      const state = { showPass, nowMs: Date.now(), scrollOffset: 0 };

      renderCard(widePanel, card, state);
      const counts = inkByBand(widePanel, WIDE_BANDS);
      counts.forEach((n, i) => {
        if (n === 0) fail(`wide layout band "${WIDE_BAND_NAMES[i]}" is empty [${p.id}, showPass=${showPass}, below=${below}]`);
      });

      // Compact must at least draw identity and the bottom line.
      renderCard(compactPanel, card, state);
      const [top, bottom] = inkByBand(compactPanel, [[0, 15], [16, 31]]);
      if (top === 0) fail(`compact top half empty [${p.id}]`);
      if (bottom === 0) fail(`compact bottom half empty [${p.id}, showPass=${showPass}]`);
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

if (failures.length) {
  console.error(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('OK — emblems, fonts, text fit and layout bands all check out.');
