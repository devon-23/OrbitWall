# OrbitWall

A wall-mounted LED matrix that shows the satellites passing over your house —
what they are, who flies them, where to look, and a rotating fact about each
one. Like a flight tracker board, but pointed up.

There are three parts:

- **The server** (`server/`) — pulls live orbital elements from CelesTrak,
  works out which satellites are closest to you right now, predicts the next
  pass, and serves it over a small HTTP API.
- **The panel** (`firmware/`, `docs/`) — an RGB LED matrix driven by an ESP32
  that polls the server over WiFi and draws the display.
- **The preview** (`public/`) — a web page that simulates the panel pixel for
  pixel, so you can see what the wall unit will look like before (or without)
  building it.

## Quick start — the web preview

```bash
npm install
npm start
```

Open <http://localhost:3000>. It starts on Jacksonville; use the form or the
"Use my location" button to change it.

If port 3000 is taken, pick another one:

```bash
PORT=3111 npm start
```

## Tracking modes

Pick one in the preview, or set `PANEL_MODE` for the hardware:

| Mode | What it shows |
|---|---|
| `iss` | Just the ISS — position, speed, and a countdown to the next pass over you. |
| `notable` | Stations, naked-eye objects, Hubble and friends, weather and navigation birds (~350 objects). |
| `all` | Everything CelesTrak lists as active — around 16,000 objects. |
| `overhead` | The single closest object out of all ~16,000, held on screen until something else gets nearer. |

### How `overhead` differs

The other modes re-sort from scratch on every poll and show the nearest few,
so the board reshuffles constantly. `overhead` picks one object and stays with
it: you watch a single pass from horizon to zenith and back out again, then the
board hands over to whatever took its place.

A challenger has to be **25 km closer** before it takes over
(`STICKY_MARGIN_KM` in `server/server.js`). Without that margin two objects a
few km apart trade places on consecutive polls and the board strobes between
them. The lock also moves immediately if the held object drops out of the
catalogue.

## Panel size — read this before buying

The board supports two geometries, and it matters:

| Panel | Chars per line | Text lines | Result |
|---|---|---|---|
| **128 x 64** | 21 | 8 | Emblem + three identity lines + full-width telemetry. Only a long name scrolls. |
| 64 x 32 | 10 | 4 | Two short lines and a scrolling bottom row. |

**Get the 128 x 64 panel.** A line like `Alt:417km Spd:27.6k` is 19
characters; on a 64 x 32 board only 10 fit, which is why the old layout had to
scroll everything. Toggle between the two in the preview to see the
difference before you spend anything.

A 128x64 HUB75 panel is roughly $35-55, about the same as the 64x32 — the
cost difference is negligible. Two chained 64x64 panels also work.

## Quick start — the hardware

1. Buy the parts and wire it up: **[docs/HARDWARE.md](docs/HARDWARE.md)**.
2. Flash the firmware: **[firmware/orbitwall_esp32/README.md](firmware/orbitwall_esp32/README.md)**.
3. Point the panel at your server by setting `SERVER_HOST` in `secrets.h` to
   your machine's LAN IP.

Set the panel's fixed install location and mode with environment variables so
it doesn't need query parameters:

```bash
LOCATION_LAT=30.3322 LOCATION_LON=-81.6557 PANEL_MODE=notable npm start
```

## API

**`GET /api/closest?lat=&lon=&alt=&mode=`** — full payload for the browser.
`alt` is optional, in meters. Falls back to the configured home location if
lat/lon are omitted.

```json
{ "mode": "notable", "totalTracked": 357, "satellites": [
  { "name": "ISS (ZARYA)", "label": "ISS", "operator": "NASA/Roscosmos",
    "kind": "Space Station", "emblem": "iss", "type": "station",
    "color": [255, 255, 255], "rangeKm": 512, "altitudeKm": 421,
    "elevationDeg": 42.3, "azimuthDeg": 187, "speedKmh": 27580,
    "fact": "Crewed since Nov 2000",
    "pass": { "startMs": 1787890694312, "peakElevationDeg": 61, "durationS": 400 } }
] }
```

In `overhead` mode the single returned satellite also carries
`heldSinceMs` — when the lock was last handed over, so a client can show how
long it has been held.

For the crewed stations the card carries a `crew` array of full names, and the
rotating `fact` line cycles through them one at a time (see below).

**`GET /api/leds?mode=`** — trimmed payload for the ESP32. Short keys keep
parsing cheap on a microcontroller.

## How it works

`server/tle.js` fetches two-line element sets from CelesTrak for the groups
each mode needs, dedupes by NORAD ID, and caches them **in memory and on
disk** (`.tle-cache/`). CelesTrak regenerates the data every 2 hours and
answers `403 GP data has not updated` if you ask sooner — that response is
treated as "your copy is still current", not an error. If a download fails,
a stale cache is used rather than going dark.

`server/server.js` propagates every cached satellite to the current instant
with SGP4 (via `satellite.js`), converts each position into range, elevation,
and azimuth relative to you, and sorts by range. Results are cached for 2
seconds because `all` mode propagates ~16,000 objects per request.

`server/passes.js` predicts the next pass by sampling forward on a 30-second
grid and bisecting the horizon crossing it finds.

`server/facts.js` holds what the display knows beyond the orbit — the short
label, the operator, which emblem to draw, and the rotating trivia. The
identity block shows the catalogue name, then that short label, then the
operator; the `kind` ("Comms", "Space Station") rotates through the bottom
line with the facts rather than taking a row of its own. Each
profile carries 6-12 facts and every object also draws on a dozen universal
ones, so the third line keeps changing for about three minutes before it
repeats. `npm test` fails the build if any fact exceeds the 21-character line.

`server/crew.js` adds who is actually aboard. It pulls
[Open Notify's `astros.json`](http://api.open-notify.org/astros.json), which
lists every person in space and their craft, and turns the ISS and Tiangong
rosters into extra fact lines (`Crew of 9 aboard`, then `Aboard: O. Kononenko`
and so on, one per person). Names are abbreviated to an initial and a surname
because the line is 21 characters.

**That feed is unreliable.** It carries no timestamp and currently answers with
an Expedition 71 roster from 2024, which is wrong. There is no way to detect
that from the response, so if the names on your wall are out of date, pin them
by hand — this skips the feed entirely:

```bash
ISS_CREW="Zena Cardman, Mike Fincke, Kimiya Yui" npm start
```

`CSS_CREW` does the same for Tiangong, `CREW_API_URL` points at a different
source, and `CREW_MAX_AGE_DAYS` (default 120) caps how long a cached roster is
shown without a successful refresh. If the feed is unreachable and nothing is
cached, the board just falls back to the static facts.

Two things draw the display — the ESP32 sketch and `public/panel.js` — and
they must agree. The layout is written down once in
**[docs/MATRIX_LAYOUT.md](docs/MATRIX_LAYOUT.md)**; change that first, then
update both.

## Tests

```bash
npm test
```

Checks the things that silently break a fixed-size display: text that would
overflow the panel, ragged emblem art, characters the font can't draw, and
layout regions that render empty.

## Notes

"Closest" means smallest straight-line distance, which is not the same as
"visible" — a satellite just below your horizon can still be the nearest one.
The board says `Below horizon` when that happens and dims the sky marker.

Requires Node 18+ (uses the built-in `fetch`).
