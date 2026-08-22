const path = require('path');
const express = require('express');
const satellite = require('satellite.js');
const { getSatellites } = require('./tle');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

// GET /api/closest?lat=..&lon=..&alt=..(meters, optional)
// Returns the 5 satellites currently closest to the given location.
app.get('/api/closest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const altKm = req.query.alt ? parseFloat(req.query.alt) / 1000 : 0;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required' });
  }

  const observerGd = {
    latitude: satellite.degreesToRadians(lat),
    longitude: satellite.degreesToRadians(lon),
    height: Number.isNaN(altKm) ? 0 : altKm
  };

  try {
    const satellites = await getSatellites();
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

      results.push({
        name: sat.name,
        rangeKm: Math.round(look.rangeSat),
        elevationDeg: Math.round((look.elevation * 180) / Math.PI * 10) / 10,
        azimuthDeg: Math.round((look.azimuth * 180) / Math.PI + 360) % 360,
        altitudeKm: Math.round(geo.height),
        speedKmh: speedKmS ? Math.round(speedKmS * 3600) : null
      });
    }

    results.sort((a, b) => a.rangeKm - b.rangeKm);
    res.json({ satellites: results.slice(0, 5) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute closest satellites' });
  }
});

app.listen(PORT, () => console.log(`OrbitWall (simple) listening on http://localhost:${PORT}`));
