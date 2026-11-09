// Proves the two renderers agree, pixel for pixel.
//
// docs/MATRIX_LAYOUT.md says the browser preview and the ESP32 sketch both
// implement one layout and "must match". Nothing enforced that: the sketch
// could drift for months and the only symptom would be a wall panel that
// looks subtly unlike the preview.
//
// So: compile firmware/orbitwall_esp32/panel_draw.h on this machine (it is
// deliberately free of Arduino types), render a spread of cards through both
// it and public/panel.js, and diff the framebuffers.
//
// Skipped with a warning if no C++ compiler is present, so `npm test` still
// works on a machine without one.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Panel, renderCard } from '../public/panel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'parity', 'dump.cpp');

function findCompiler() {
  for (const cc of ['c++', 'clang++', 'g++']) {
    try {
      execFileSync(cc, ['--version'], { stdio: 'ignore' });
      return cc;
    } catch { /* try the next one */ }
  }
  return null;
}

// Each case is one card plus the animation state to render it at.
const CASES = [
  { name: 'ISS (ZARYA)', label: 'ISS', op: 'NASA/Roscosmos', kind: 'Space Station',
    emblem: 'iss', fact: 'Crewed since Nov 2000', color: [255, 255, 255],
    rangeKm: 842, altitudeKm: 417, speedKmh: 27607, el: 42.3, az: 187,
    hasPass: true, passInMs: 4200000 },
  { name: 'STARLINK-11252 [DTC]', label: 'Starlink', op: 'SpaceX', kind: 'Comms',
    emblem: 'flatsat', fact: 'Looks like a train', color: [0, 220, 220],
    rangeKm: 456, altitudeKm: 464, speedKmh: 27500, el: 76.3, az: 78,
    hasPass: true, passInMs: 95000 },
  // Below the horizon: the telemetry row falls back to the range.
  { name: 'HINODE (SOLAR-B)', label: 'Satellite', op: 'Unknown', kind: 'Payload',
    emblem: 'generic', fact: 'Orbit decays daily', color: [0, 230, 90],
    rangeKm: 10894, altitudeKm: 680, speedKmh: 27100, el: -12.5, az: 311,
    hasPass: false, passInMs: 0 },
  // Four-digit range, five-digit speed: the right-aligned column must hold.
  { name: 'CZ-2D R/B', label: 'Space Junk', op: 'Nobody', kind: 'Debris',
    emblem: 'debris', fact: 'Faster than a bullet', color: [255, 90, 60],
    rangeKm: 1413, altitudeKm: 9999, speedKmh: 9800, el: 5.7, az: 0,
    hasPass: true, passInMs: 500 },
  // Longest names in the catalogue -- these marquee.
  { name: 'SHIJIAN-6 01A (SJ-6 01A)', label: 'Classified', op: 'Undisclosed',
    kind: 'Military', emblem: 'comsat', fact: 'Hobbyists find it',
    color: [160, 170, 190], rangeKm: 1271, altitudeKm: 598, speedKmh: 27231,
    el: 21.2, az: 359, hasPass: true, passInMs: 3661000 }
];

const GEOMETRIES = [[128, 64], [64, 32]];
const THIRD = [0, 1, 2];
const NAME_SCROLL = [0, 7, 48, 151];

function expand() {
  const out = [];
  for (const c of CASES) {
    for (const [cols, rows] of GEOMETRIES) {
      for (const thirdIndex of THIRD) {
        for (const nameScrollOffset of NAME_SCROLL) {
          out.push({ ...c, cols, rows, thirdIndex, nameScrollOffset, scrollOffset: nameScrollOffset });
        }
      }
    }
  }
  return out;
}

function toCppLine(c) {
  return [
    c.name, c.label, c.op, c.kind, c.emblem, c.fact,
    c.color[0], c.color[1], c.color[2],
    c.rangeKm, c.altitudeKm, c.speedKmh, c.el, c.az,
    c.hasPass ? 1 : 0, c.passInMs,
    c.cols, c.rows, c.thirdIndex, c.nameScrollOffset, c.scrollOffset
  ].join('|');
}

// The C++ side takes "ms until the pass"; the JS side takes an absolute
// timestamp plus a now. Anchoring now at 0 makes them the same number.
function toJsCard(c) {
  return {
    name: c.name, label: c.label, operator: c.op, kind: c.kind,
    emblem: c.emblem, fact: c.fact, color: c.color,
    rangeKm: c.rangeKm, altitudeKm: c.altitudeKm, speedKmh: c.speedKmh,
    elevationDeg: c.el, azimuthDeg: c.az,
    pass: c.hasPass ? { startMs: c.passInMs, inProgress: false } : undefined
  };
}

function renderJs(c) {
  const panel = new Panel(c.cols, c.rows);
  renderCard(panel, toJsCard(c), {
    thirdIndex: c.thirdIndex,
    nowMs: 0,
    scrollOffset: c.scrollOffset,
    nameScrollOffset: c.nameScrollOffset
  });
  const lines = [];
  for (let y = 0; y < c.rows; y++) {
    const row = [];
    for (let x = 0; x < c.cols; x++) {
      const px = panel.get(x, y);
      row.push(px ? ((px[0] << 16) | (px[1] << 8) | px[2]).toString(16).padStart(6, '0') : '.');
    }
    lines.push(row.join(','));
  }
  return lines;
}

export function runParity() {
  const cc = findCompiler();
  if (!cc) return { skipped: 'no C++ compiler on PATH (tried c++, clang++, g++)' };
  if (!existsSync(SRC)) return { failures: [`parity: ${SRC} is missing`] };

  const dir = mkdtempSync(join(tmpdir(), 'orbitwall-parity-'));
  const bin = join(dir, 'dump');
  try {
    execFileSync(cc, ['-std=c++17', '-O1', '-o', bin, SRC], { stdio: 'pipe' });
  } catch (err) {
    return { failures: [`parity: could not compile panel_draw.h\n${err.stderr || err.message}`] };
  }

  const cases = expand();
  const input = cases.map(toCppLine).join('\n') + '\n';
  const stdin = join(dir, 'cases.txt');
  writeFileSync(stdin, input);

  const raw = execFileSync(bin, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const blocks = raw.split('---\n').filter((b) => b.trim().length > 0);

  const failures = [];
  if (blocks.length !== cases.length) {
    failures.push(`parity: firmware returned ${blocks.length} frames for ${cases.length} cases`);
    return { failures };
  }

  for (let i = 0; i < cases.length && failures.length < 6; i++) {
    const c = cases[i];
    const theirs = blocks[i].split('\n').filter((l) => l.length > 0);
    const ours = renderJs(c);
    const where = `${c.name} @ ${c.cols}x${c.rows} third=${c.thirdIndex} scroll=${c.nameScrollOffset}`;

    if (theirs.length !== ours.length) {
      failures.push(`parity: ${where} -- firmware drew ${theirs.length} rows, browser drew ${ours.length}`);
      continue;
    }
    for (let y = 0; y < ours.length; y++) {
      if (theirs[y] === ours[y]) continue;
      const a = ours[y].split(',');
      const b = theirs[y].split(',');
      const x = a.findIndex((v, j) => v !== b[j]);
      failures.push(
        `parity: ${where} -- row ${y} differs from x=${x}: browser ${a[x]}, firmware ${b[x]}`
      );
      break;
    }
  }
  return { failures, checked: cases.length };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('parity-check.mjs');
if (invokedDirectly) {
  const r = runParity();
  if (r.skipped) { console.log('SKIP -', r.skipped); process.exit(0); }
  if (r.failures.length) {
    console.error(`PARITY FAIL - ${r.failures.length} problem(s):`);
    for (const f of r.failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`OK - ${r.checked} frames identical in both renderers.`);
}
