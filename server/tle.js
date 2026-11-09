// Pulls current orbital elements (TLEs) from CelesTrak and caches them in
// memory for an hour so we're not re-fetching on every request.
//
// Groups are cached individually, so the three tracking modes share whatever
// they have in common instead of re-downloading it.

const fs = require('fs');
const path = require('path');
const satellite = require('satellite.js');

const TLE_BASE = 'https://celestrak.org/NORAD/elements/gp.php';

// CelesTrak regenerates the GP data every 2 hours and answers 403 with a
// "has not updated since your last successful download" note if you ask
// again before then. Matching their cadence keeps us out of that path.
const REFRESH_MS = 2 * 60 * 60 * 1000;

// CelesTrak asks clients not to re-download faster than the elements change,
// and answers 403 if you do. An in-memory cache alone loses that protection
// every restart, so responses are also kept on disk and reused across runs —
// and a stale copy is better than no sky at all when a fetch fails.
const CACHE_DIR = process.env.TLE_CACHE_DIR || path.join(__dirname, '..', '.tle-cache');

function cachePath(group) {
  return path.join(CACHE_DIR, `${group.replace(/[^a-z0-9-]/gi, '_')}.tle`);
}

function readDisk(group) {
  try {
    const file = cachePath(group);
    const stat = fs.statSync(file);
    return { text: fs.readFileSync(file, 'utf8'), ageMs: Date.now() - stat.mtimeMs };
  } catch {
    return null;
  }
}

// Marks the cached file current again after CelesTrak confirms our copy is
// still the latest, so a restart doesn't immediately re-ask.
function touchDisk(group) {
  try {
    const now = new Date();
    fs.utimesSync(cachePath(group), now, now);
  } catch {
    // No cached file to touch — nothing to do.
  }
}

function writeDisk(group, text) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(group), text);
  } catch (err) {
    console.error('[tle] could not write cache:', err.message);
  }
}

// Which CelesTrak groups feed each tracking mode.
// Full list: https://celestrak.org/NORAD/elements/index.php
const MODE_GROUPS = {
  // Just the crewed stations — the ISS is pulled out of this by name.
  iss: ['stations'],

  // Things worth knowing by name: stations, naked-eye objects, the big
  // observatories, weather birds, and the navigation constellations.
  // ("weather" already contains the NOAA and GOES satellites.)
  notable: ['stations', 'visual', 'science', 'weather', 'goes', 'gps-ops', 'galileo'],

  // Everything CelesTrak lists as on-orbit and active (~16k objects).
  all: ['active'],

  // Same catalogue as "all", but the server locks onto a single object
  // instead of listing six -- see stickyClosest() in server.js. It needs the
  // full catalogue because the genuinely closest thing overhead is usually
  // an anonymous rocket body, not one of the notable birds.
  overhead: ['active']
};

const DEFAULT_MODE = 'notable';

// group name -> { fetchedAt, satellites }
const cache = new Map();

function parseTle(text) {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const sats = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1 || !line2 || !line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    const satrec = satellite.twoline2satrec(line1, line2);
    if (!satrec || satrec.error) continue;
    const noradId = line1.substring(2, 7);
    sats.push({ noradId, name: name.trim(), satrec });
  }
  return sats;
}

function remember(group, text, ageMs = 0) {
  const satellites = parseTle(text);
  // Only accept a non-empty parse — CelesTrak sometimes answers with an
  // error page, which parses to zero satellites and would blank the board.
  if (satellites.length === 0) return null;
  cache.set(group, { fetchedAt: Date.now() - ageMs, satellites });
  return satellites;
}

async function fetchGroup(group) {
  const cached = cache.get(group);
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return cached.satellites;

  // Warm from disk before going to the network, so a restart doesn't
  // re-download (and get itself rate-limited).
  const disk = readDisk(group);
  if (disk && disk.ageMs < REFRESH_MS) {
    const sats = remember(group, disk.text, disk.ageMs);
    if (sats) return sats;
  }

  try {
    const res = await fetch(`${TLE_BASE}?GROUP=${group}&FORMAT=tle`);

    // 403 + "has not updated" is not a failure: it means our copy is still
    // current. Mark it fresh so we stop asking until the next refresh window.
    if (res.status === 403) {
      const body = await res.text();
      if (/has not updated/i.test(body)) {
        const held = cache.get(group) || (disk && remember(group, disk.text) ? cache.get(group) : null);
        if (held) {
          held.fetchedAt = Date.now();
          touchDisk(group);
          return held.satellites;
        }
      }
      throw new Error(`CelesTrak returned 403`);
    }

    if (!res.ok) throw new Error(`CelesTrak returned ${res.status}`);
    const text = await res.text();
    // CelesTrak reports a bad group name as 200 + a plain-text complaint.
    if (/^Invalid query/i.test(text.trim())) {
      throw new Error(`"${group}" is not a CelesTrak group name`);
    }
    const sats = remember(group, text);
    if (!sats) throw new Error('response contained no usable elements');
    writeDisk(group, text);
    return sats;
  } catch (err) {
    // Fall back to whatever we have, however old, rather than going dark.
    if (disk) {
      const sats = remember(group, disk.text, disk.ageMs);
      if (sats) {
        const hours = Math.round(disk.ageMs / 3600000);
        console.error(`[tle] "${group}" fetch failed (${err.message}); using ${hours}h-old cache`);
        return sats;
      }
    }
    if (cached) {
      console.error(`[tle] "${group}" fetch failed (${err.message}); keeping in-memory copy`);
      return cached.satellites;
    }
    throw new Error(`CelesTrak request failed for group "${group}": ${err.message}`);
  }
}

function normalizeMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODE_GROUPS, mode) ? mode : DEFAULT_MODE;
}

// Returns the deduped satellite list backing a tracking mode.
async function collect(groups) {
  const seen = new Map(); // dedupe by NORAD id — groups overlap
  for (const group of groups) {
    try {
      for (const sat of await fetchGroup(group)) {
        if (!seen.has(sat.noradId)) seen.set(sat.noradId, sat);
      }
    } catch (err) {
      console.error(`[tle] skipping group "${group}":`, err.message);
    }
  }
  return Array.from(seen.values());
}

async function getSatellites(mode = DEFAULT_MODE) {
  const resolved = normalizeMode(mode);
  let all = await collect(MODE_GROUPS[resolved]);

  // "all" leans on one big catalog; if that download is unavailable, show the
  // smaller curated set rather than an empty sky.
  if (all.length === 0 && resolved === 'all') {
    console.error('[tle] "active" unavailable — falling back to the notable groups');
    all = await collect(MODE_GROUPS.notable);
  }
  if (resolved !== 'iss') return all;

  // ISS mode: the station itself, not the whole stations group.
  const iss = all.filter((s) => /ISS \(ZARYA\)|^ISS$|ZARYA/i.test(s.name));
  return iss.length > 0 ? iss : all.slice(0, 1);
}

module.exports = { getSatellites, normalizeMode, MODE_GROUPS, DEFAULT_MODE };
