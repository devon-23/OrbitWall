// Pulls current orbital elements (TLEs) from CelesTrak and caches them
// in memory for an hour so we're not re-fetching on every request.

const satellite = require('satellite.js');

// Add or remove group names here to control what gets tracked.
// Full list of available groups: https://celestrak.org/NORAD/elements/index.php
const GROUPS = ['visual', 'stations', 'weather', 'science'];
const TLE_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const REFRESH_MS = 60 * 60 * 1000; // 1 hour

let cache = { fetchedAt: 0, satellites: [] };

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

async function fetchGroup(group) {
  const res = await fetch(`${TLE_BASE}?GROUP=${group}&FORMAT=tle`);
  if (!res.ok) throw new Error(`CelesTrak request failed for group "${group}": ${res.status}`);
  const text = await res.text();
  return parseTle(text);
}

async function getSatellites() {
  if (cache.satellites.length > 0 && Date.now() - cache.fetchedAt < REFRESH_MS) {
    return cache.satellites;
  }

  const seen = new Map(); // dedupe by NORAD id — some satellites appear in multiple groups
  for (const group of GROUPS) {
    try {
      const sats = await fetchGroup(group);
      for (const sat of sats) {
        if (!seen.has(sat.noradId)) seen.set(sat.noradId, sat);
      }
    } catch (err) {
      console.error(`[tle] skipping group "${group}":`, err.message);
    }
  }

  if (seen.size > 0) cache = { fetchedAt: Date.now(), satellites: Array.from(seen.values()) };
  return cache.satellites;
}

module.exports = { getSatellites };
