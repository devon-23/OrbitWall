# OrbitWall (bare bones)

Enter a location, get the 5 satellites currently closest to it. That's it.

## Run it

```bash
npm install
npm start
```

Open `http://localhost:3000`, click "Use my current location" (or type
lat/lon manually) and hit Go.

## How it works

- `server/tle.js` fetches current orbital elements (TLEs) for ~100 bright,
  trackable satellites from CelesTrak's `visual` group and caches them in
  memory for an hour.
- `server/server.js` exposes one route, `GET /api/closest?lat=&lon=`. For
  every cached satellite it propagates the current position with
  `satellite.js` (SGP4), computes the range/elevation/azimuth from the
  given location, sorts by range, and returns the closest 5.
- `public/index.html` is a single static page: a location form and a
  table. No framework, no build step, no styling system beyond a
  `<style>` tag.
