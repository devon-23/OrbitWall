const path = require('path');
const express = require('express');
const satellite = require('satellite.js');
const { getSatellites, normalizeMode, DEFAULT_MODE } = require('./tle');
const { classify, colorFor } = require('./satType');
const { profileFor, factFor } = require('./facts');
const { nextPass } = require('./passes');

const app = express();
const PORT = process.env.PORT || 3000;

// Fixed install location for the physical display. Override with env vars
// (e.g. in a .env or systemd unit) rather than editing this file per-city.
// Defaults to Orlando, FL.
const HOME_LOCATION = {
  lat: process.env.LOCATION_LAT ? parseFloat(process.env.LOCATION_LAT) : 28.5383,
  lon: process.env.LOCATION_LON ? parseFloat(process.env.LOCATION_LON) : -81.3792,
  altKm: process.env.LOCATION_ALT_M ? parseFloat(process.env.LOCATION_ALT_M) / 1000 : 0
};

// "all" mode propagates ~11k objects per request. Recomputing that for every
// poll (and every open browser tab) is wasteful when the sky barely moves in
// a second, so identical queries reuse a recent result.
const SOLUTION_TTL_MS = 2000;
const solutionCache = new Map();

// Pass prediction is the expensive part, and the answer is stable for
// minutes, so it gets its own longer-lived cache keyed by satellite.
const PASS_TTL_MS = 60000;
const passCache = new Map();

app.use(express.static(path.join(__dirname, '..', 'public')));

function observerFrom(lat, lon, altKm) {
  return {
    latitude: satellite.degreesToRadians(lat),
    longitude: satellite.degreesToRadians(lon),
    height: Number.isNaN(altKm) ? 0 : altKm
  };
}

function cachedPass(sat, observerGd, key) {
  const hit = passCache.get(key);
  if (hit && Date.now() - hit.at < PASS_TTL_MS) return hit.pass;
  const pass = nextPass(sat.satrec, observerGd, new Date());
  passCache.set(key, { at: Date.now(), pass });
  return pass;
}

// Computes the N satellites currently closest to a given lat/lon/altKm,
// annotated with everything the display needs to draw a card for them.
async function computeClosest(lat, lon, altKm, limit, mode) {
  const cacheKey = `${mode}|${lat.toFixed(4)}|${lon.toFixed(4)}|${altKm}|${limit}`;
  const hit = solutionCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SOLUTION_TTL_MS) return hit.result;

  const observerGd = observerFrom(lat, lon, altKm);
  const satellites = await getSatellites(mode);
  const now = new Date();
  const gmst = satellite.gstime(now);

  const results = [];
  for (const sat of satellites) {
    const pv = satellite.propagate(sat.satrec, now);
    if (!pv || !pv.position) continue;

    const positionEcf = satellite.eciToEcf(pv.position, gmst);
    const look = satellite.ecfToLookAngles(observerGd, positionEcf);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    const speedKmS = pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : null;
    const type = classify(sat.name);

    results.push({
      ref: sat,
      noradId: sat.noradId,
      name: sat.name,
      type,
      color: colorFor(type),
      rangeKm: Math.round(look.rangeSat),
      elevationDeg: Math.round((look.elevation * 180) / Math.PI * 10) / 10,
      azimuthDeg: Math.round((look.azimuth * 180) / Math.PI + 360) % 360,
      altitudeKm: Math.round(geo.height),
      latitude: Math.round(satellite.degreesLat(geo.latitude) * 100) / 100,
      longitude: Math.round(satellite.degreesLong(geo.longitude) * 100) / 100,
      speedKmh: speedKmS ? Math.round(speedKmS * 3600) : null
    });
  }

  results.sort((a, b) => a.rangeKm - b.rangeKm);
  const top = results.slice(0, limit);

  // Decorate only what we're about to show — profile lookup is cheap, but
  // pass prediction is not, so it's limited to the headline satellite.
  const decorated = top.map((entry, index) => {
    const profile = profileFor(entry.name);
    const { ref, ...rest } = entry;
    const card = {
      ...rest,
      label: profile.label,
      operator: profile.operator,
      kind: profile.kind,
      emblem: profile.emblem,
      profileId: profile.id,
      facts: profile.facts.concat([]),
      fact: factFor(entry.name, Math.floor(Date.now() / 8000))
    };
    if (index === 0) {
      card.pass = cachedPass(ref, observerGd, `${ref.noradId}|${lat.toFixed(2)}|${lon.toFixed(2)}`);
    }
    return card;
  });

  const result = { satellites: decorated, totalTracked: results.length };
  solutionCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

function readQuery(req) {
  const lat = req.query.lat !== undefined ? parseFloat(req.query.lat) : HOME_LOCATION.lat;
  const lon = req.query.lon !== undefined ? parseFloat(req.query.lon) : HOME_LOCATION.lon;
  const altKm = req.query.alt !== undefined ? parseFloat(req.query.alt) / 1000 : HOME_LOCATION.altKm;
  const mode = normalizeMode(req.query.mode);
  return { lat, lon, altKm, mode };
}

// GET /api/closest?lat=&lon=&alt=&mode=iss|notable|all
// Full payload for the browser. lat/lon are optional and fall back to
// HOME_LOCATION, so this works with no query parameters at all.
app.get('/api/closest', async (req, res) => {
  const { lat, lon, altKm, mode } = readQuery(req);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon must be valid numbers' });
  }

  try {
    const limit = mode === 'iss' ? 1 : 6;
    const { satellites, totalTracked } = await computeClosest(lat, lon, altKm, limit, mode);
    res.json({ mode, totalTracked, observer: { lat, lon }, satellites });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute closest satellites' });
  }
});

// GET /api/leds?mode=
// Trimmed payload for the physical display. Short keys and only the fields
// the panel renders, to keep the response small and fast to parse on a
// microcontroller polling every few seconds.
app.get('/api/leds', async (req, res) => {
  const mode = normalizeMode(req.query.mode ?? process.env.PANEL_MODE ?? DEFAULT_MODE);

  try {
    const { satellites } = await computeClosest(
      HOME_LOCATION.lat, HOME_LOCATION.lon, HOME_LOCATION.altKm,
      mode === 'iss' ? 1 : 5, mode
    );

    if (satellites.length === 0) {
      return res.status(503).json({ error: 'no satellite data available yet' });
    }

    const [closest, ...rest] = satellites;

    res.json({
      mode,
      closest: {
        n: closest.name,
        l: closest.label,
        o: closest.operator,
        k: closest.kind,
        e: closest.emblem,
        t: closest.type,
        el: closest.elevationDeg,
        az: closest.azimuthDeg,
        r: closest.rangeKm,
        a: closest.altitudeKm,
        sp: closest.speedKmh,
        f: closest.fact,
        p: closest.pass ? closest.pass.startMs : null
      },
      next: rest.map((s) => ({ n: s.name, l: s.label, e: s.emblem, t: s.type, r: s.rangeKm, f: s.fact })),
      ts: Date.now()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute leds payload' });
  }
});

app.listen(PORT, () =>
  console.log(`OrbitWall listening on http://localhost:${PORT} (home: ${HOME_LOCATION.lat}, ${HOME_LOCATION.lon})`)
);
