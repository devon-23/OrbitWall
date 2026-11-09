// Extracts the geometry block from the sketch and preprocesses it for every
// OW_BUILD value, so a wrong DISPLAY_W is caught here and not on the wall.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const INO = join(HERE, '..', 'firmware', 'orbitwall_esp32', 'orbitwall_esp32.ino');
const DRIVER = join(HERE, 'parity', 'geometry.c');

// What each build must come out as: [DISPLAY_W, DISPLAY_H, chain, resY, pinE]
const EXPECTED = {
  OW_SINGLE: [64, 32, 1, 32, -1],
  OW_DUAL64: [128, 64, 2, 64, 18],
  OW_QUAD32: [128, 64, 4, 32, -1]
};

function findCompiler() {
  for (const cc of ['cc', 'clang', 'gcc']) {
    try { execFileSync(cc, ['--version'], { stdio: 'ignore' }); return cc; } catch {}
  }
  return null;
}

export function checkGeometry() {
  const cc = findCompiler();
  if (!cc) return { skipped: 'no C compiler on PATH' };
  if (!existsSync(DRIVER)) return { failures: [`geometry: ${DRIVER} is missing`] };

  const ino = readFileSync(INO, 'utf8');
  const start = ino.indexOf('#define OW_SINGLE 0');
  const endMarker = '#define DISPLAY_H PANEL_RES_Y\n#endif';
  const end = ino.indexOf(endMarker);
  if (start < 0 || end < 0) {
    return { failures: ['geometry: could not find the OW_BUILD block in the sketch'] };
  }

  // Drop the #define of OW_BUILD itself (the driver sets it) and any
  // Arduino-only includes, which do not exist on the host.
  const block = ino
    .slice(start, end + endMarker.length)
    .split('\n')
    .filter((l) => !/^#define OW_BUILD\b/.test(l.trim()))
    .filter((l) => !/^\s*#include/.test(l))
    .join('\n');

  const dir = mkdtempSync(join(tmpdir(), 'orbitwall-geom-'));
  writeFileSync(join(dir, 'geometry_block.h'), block);

  const failures = [];
  for (const [build, want] of Object.entries(EXPECTED)) {
    const bin = join(dir, `geom_${build}`);
    try {
      execFileSync(cc, [
        '-std=c11', `-DOW_BUILD_UNDER_TEST=${build}`, `-I${dir}`,
        '-o', bin, DRIVER
      ], { stdio: 'pipe' });
    } catch (err) {
      failures.push(`geometry: ${build} does not compile\n${err.stderr || err.message}`);
      continue;
    }
    const got = execFileSync(bin, { encoding: 'utf8' }).trim().split(/\s+/).map(Number).slice(1);
    const names = ['DISPLAY_W', 'DISPLAY_H', 'PANEL_CHAIN', 'PANEL_RES_Y', 'PIN_E'];
    got.forEach((v, i) => {
      if (v !== want[i]) failures.push(`geometry: ${build} gives ${names[i]}=${v}, expected ${want[i]}`);
    });
  }
  return { failures, checked: Object.keys(EXPECTED).length };
}

const direct = process.argv[1] && process.argv[1].endsWith('check-geometry.mjs');
if (direct) {
  const r = checkGeometry();
  if (r.skipped) { console.log('SKIP -', r.skipped); process.exit(0); }
  if (r.failures.length) {
    console.error('GEOMETRY FAIL:');
    for (const f of r.failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`OK - all ${r.checked} builds resolve to the right geometry.`);
}
