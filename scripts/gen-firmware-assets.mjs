// Generates firmware/orbitwall_esp32/panel_assets.h from the browser
// renderer's own tables.
//
// The font, the emblem art and the type colours have to be byte-identical in
// both renderers or the wall panel quietly stops matching the preview. Rather
// than transcribe ~500 lines of pixel data into C++ by hand and let it rot,
// this emits the header from public/font.js, public/emblems.js and
// server/satType.js -- the same files the browser draws from.
//
//   npm run gen:firmware     rewrite the header
//   npm test                 fails if the header is out of date
//
// Run it after touching any of those three files, and commit the result:
// the Arduino IDE has no build step that could generate it.

import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { FONT_5X7, CHAR_W, CHAR_H } from '../public/font.js';
import { EMBLEMS, EMBLEM_SIZE, PALETTE, assertEmblems } from '../public/emblems.js';
import { COLORS } from '../public/panel.js';

const require = createRequire(import.meta.url);
const { TYPE_COLORS } = require('../server/satType.js');

const HERE = dirname(fileURLToPath(import.meta.url));
export const HEADER_PATH = join(HERE, '..', 'firmware', 'orbitwall_esp32', 'panel_assets.h');

const FIRST = 0x20;
const LAST = 0x7e;
const DEGREE = '°';

function fontBytes() {
  const rows = [];
  for (let c = FIRST; c <= LAST; c++) {
    const ch = String.fromCharCode(c);
    const glyph = FONT_5X7[ch];
    if (!glyph) throw new Error(`font is missing a glyph for ${JSON.stringify(ch)}`);
    const label = ch === ' ' ? 'space' : ch === '\\' ? 'backslash' : ch;
    rows.push(`  ${glyph.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}, // ${label}`);
  }
  const deg = FONT_5X7[DEGREE];
  if (!deg) throw new Error('font is missing the degree sign');
  rows.push(`  ${deg.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}, // degree`);
  return rows;
}

// '.' is transparent and always index 0; the rest follow PALETTE's own order.
function paletteIndex() {
  const keys = Object.keys(PALETTE);
  const index = new Map([['.', 0]]);
  keys.forEach((k, i) => index.set(k, i + 1));
  return { keys, index };
}

export function generate() {
  const ragged = assertEmblems();
  if (ragged.length) throw new Error('emblem art is ragged:\n  ' + ragged.join('\n  '));

  const { keys, index } = paletteIndex();
  const emblemNames = Object.keys(EMBLEMS);
  const typeNames = Object.keys(TYPE_COLORS);

  const out = [];
  out.push('// GENERATED FILE -- do not edit by hand.');
  out.push('//');
  out.push('// Written by scripts/gen-firmware-assets.mjs from public/font.js,');
  out.push('// public/emblems.js and server/satType.js, so the wall panel draws exactly');
  out.push('// what the browser preview draws. Change those, then run:');
  out.push('//');
  out.push('//   npm run gen:firmware');
  out.push('');
  out.push('#pragma once');
  out.push('#include <stdint.h>');
  out.push('');
  out.push('// The drawing code is compiled twice: once by the Arduino IDE for the');
  out.push('// ESP32, and once by scripts/parity-check.mjs on the host, where it is');
  out.push('// diffed against the browser renderer. Only the former has pgmspace.');
  out.push('#if defined(ARDUINO) || defined(ESP32)');
  out.push('#include <pgmspace.h>');
  out.push('#else');
  out.push('#define PROGMEM');
  out.push('#define pgm_read_byte(addr) (*(const uint8_t *)(addr))');
  out.push('#endif');
  out.push('');
  out.push(`#define OW_CHAR_W ${CHAR_W}   // 5 columns + 1 of spacing`);
  out.push(`#define OW_CHAR_H ${CHAR_H}`);
  out.push(`#define OW_EMBLEM_SIZE ${EMBLEM_SIZE}`);
  out.push('');
  out.push('struct OwRgb { uint8_t r, g, b; };');
  out.push('');

  // --- font -------------------------------------------------------------
  out.push('// 5x7 glyphs, column-major, one byte per column, bit 0 at the top.');
  out.push(`// Index with (c - 0x${FIRST.toString(16)}) * 5 for printable ASCII;`);
  out.push('// OW_FONT_DEGREE is a slot of our own for the degree sign.');
  out.push(`#define OW_FONT_FIRST 0x${FIRST.toString(16)}`);
  out.push(`#define OW_FONT_LAST 0x${LAST.toString(16)}`);
  out.push(`#define OW_FONT_DEGREE ${LAST - FIRST + 1}`);
  out.push('static const uint8_t OW_FONT[] PROGMEM = {');
  out.push(...fontBytes());
  out.push('};');
  out.push('');

  // --- palette ----------------------------------------------------------
  out.push('// Index 0 is transparent; the rest mirror PALETTE in emblems.js.');
  out.push(`#define OW_PALETTE_COUNT ${keys.length + 1}`);
  out.push('static const OwRgb OW_PALETTE[OW_PALETTE_COUNT] = {');
  out.push('  {0, 0, 0}, // 0: transparent, never drawn');
  keys.forEach((k, i) => {
    const [r, g, b] = PALETTE[k];
    out.push(`  {${r}, ${g}, ${b}}, // ${i + 1}: '${k}'`);
  });
  out.push('};');
  out.push('');

  // --- emblems ----------------------------------------------------------
  out.push(`#define OW_EMBLEM_COUNT ${emblemNames.length}`);
  out.push('static const char *const OW_EMBLEM_NAMES[OW_EMBLEM_COUNT] = {');
  out.push('  ' + emblemNames.map((n) => `"${n}"`).join(', '));
  out.push('};');
  out.push('');
  out.push('// Row-major palette indices, OW_EMBLEM_SIZE^2 per emblem.');
  out.push('static const uint8_t OW_EMBLEMS[OW_EMBLEM_COUNT][OW_EMBLEM_SIZE * OW_EMBLEM_SIZE] PROGMEM = {');
  for (const name of emblemNames) {
    out.push(`  { // ${name}`);
    for (const row of EMBLEMS[name]) {
      const cells = [...row].map((ch) => index.get(ch));
      out.push('    ' + cells.join(',') + ',');
    }
    out.push('  },');
  }
  out.push('};');
  out.push('');

  // --- layout colours ---------------------------------------------------
  out.push('// The layout palette, straight from COLORS in public/panel.js.');
  for (const [name, [r, g, b]] of Object.entries(COLORS)) {
    const upper = name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    out.push(`static const OwRgb OW_COL_${upper} = {${r}, ${g}, ${b}};`);
  }
  out.push('');

  // --- type colours -----------------------------------------------------
  out.push('// Fallback only: /api/leds sends the colour with each satellite.');
  out.push('// This keeps the panel sane if a future type is not in the payload.');
  out.push(`#define OW_TYPE_COUNT ${typeNames.length}`);
  out.push('static const char *const OW_TYPE_NAMES[OW_TYPE_COUNT] = {');
  out.push('  ' + typeNames.map((n) => `"${n}"`).join(', '));
  out.push('};');
  out.push('static const OwRgb OW_TYPE_COLORS[OW_TYPE_COUNT] = {');
  for (const t of typeNames) {
    const [r, g, b] = TYPE_COLORS[t];
    out.push(`  {${r}, ${g}, ${b}}, // ${t}`);
  }
  out.push('};');
  out.push('');

  return out.join('\n');
}

// True when the committed header already matches what we would generate.
export function headerIsCurrent() {
  if (!existsSync(HEADER_PATH)) return false;
  return readFileSync(HEADER_PATH, 'utf8') === generate();
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('gen-firmware-assets.mjs');
if (invokedDirectly) {
  const text = generate();
  writeFileSync(HEADER_PATH, text);
  console.log(`wrote ${HEADER_PATH} (${text.split('\n').length} lines)`);
}
