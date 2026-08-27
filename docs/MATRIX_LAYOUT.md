# Matrix layout spec

This is the single source of truth for what gets drawn on the display. Two
renderers implement it and they must match:

- `public/panel.js` (JavaScript, the browser preview)
- `firmware/orbitwall_esp32/orbitwall_esp32.ino` (C++, the real panel)

If you change the layout, change it here first, then update both renderers.
`npm test` checks the parts that can be checked statically: text that would
overflow, ragged emblem art, missing glyphs, and layout bands that come out
empty.

## Two panel sizes

The board supports two geometries, and the layout differs because the text
capacity differs:

| Panel | Chars/line | Text lines | Layout |
|---|---|---|---|
| **128 x 64** | 21 | 8 | `wide` — everything fits, nothing scrolls |
| 64 x 32 | 10 | 4 | `compact` — the bottom line has to scroll |

**128 x 64 is the recommended panel.** The reference look (an emblem block
beside three identity lines, then full-width telemetry) needs 21 characters
and five text rows; a 64 x 32 panel cannot show it without scrolling.

## Font

5x7 glyphs on a 6x8 cell (5 columns + 1 spacing, 7 rows + 1 leading), full
printable ASCII plus `°`. Column-major, one byte per column, bit 0 at the
top — the same encoding Adafruit_GFX uses, so both renderers read one table.

## Coordinate system

Origin `(0, 0)` at top-left, `x` right, `y` down.

## Wide layout (128 x 64)

```
 x=0                                                            x=127
y=0  +------------------------------------------------------------+
     |  +----------+   LABEL             (white)                  |
     |  |          |   OPERATOR          (slate blue)             |
     |  |  EMBLEM  |   KIND              (type colour)            |
     |  |  24 x 24 |                                              |
y=26 |  +----------+                                              |
y=29 |------------------ divider (40,46,74) ----------------------|
y=31 |  Alt:417km Spd:27.6k                       (pale blue)     |
y=40 |  El:42° Az:187° S                          (pale blue)     |
y=49 |  Circles Earth 15x/day  /  Next pass in 6h48m   (amber)    |
y=58 |                    sky strip                               |
y=63 |  - - - - - - - - horizon + N/E/S/W ticks - - - - - - - - - |
     +------------------------------------------------------------+
```

- **Emblem** at `(2, 2)`, 24x24, drawn from `public/emblems.js`.
- **Identity column** starts at `x = 29`; each line is truncated with a
  trailing `.` rather than scrolled.
- **Line 3 alternates** every 3.5 s between the rotating fun fact and the
  next-pass countdown. Nothing on this layout scrolls.
- **Sky strip** (rows 58-63): a dotted horizon on the last row, ticks at the
  four cardinal points, and a 5-pixel plus marking the satellite at
  `x = az / 360 * (cols - 1)`, `y = baseline - (elevation / 90) * span`.
  Below the horizon the marker is drawn dim and clamped to the baseline.

## Compact layout (64 x 32)

```
y=0  +--------------------------------+
     | +------+  LABEL                |
     | |emblem|  KIND                 |
y=15 | +------+                       |
y=16 | El42 842km                     |
y=24 | scrolling fact / pass          |
     +--------------------------------+
```

Emblem is the 24x24 art nearest-neighbour sampled to 14x14. The bottom line
scrolls at 1px per 140 ms because 10 characters cannot hold a fact.

## Type colours

Set by `server/satType.js` and sent with each satellite, so both renderers
light the same colour without duplicating the rules.

| type | colour RGB | meaning |
|---|---|---|
| `station` | 255, 255, 255 | crewed stations |
| `comms` | 0, 220, 220 | Starlink, OneWeb, Iridium |
| `weather` | 60, 120, 255 | NOAA, GOES, MetOp |
| `science` | 255, 200, 0 | Hubble, Chandra, Swift |
| `nav` | 180, 130, 255 | GPS, Galileo, GLONASS |
| `imaging` | 0, 230, 120 | Landsat, Sentinel, Terra |
| `debris` | 255, 90, 60 | rocket bodies and fragments |
| `cubesat` | 255, 150, 220 | cubesats |
| `military` | 160, 170, 190 | unclassified-purpose objects |
| `generic` | 0, 230, 90 | everything else |

## Cycling

The display dwells 6 s per satellite and refetches every 10 s. A new fetch
replaces the data but does not reset the cycle position, so the board never
jumps back to the first entry mid-rotation. In `iss` mode there is only one
satellite, so it never cycles.
