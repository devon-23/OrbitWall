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
| **128 x 64** | 21 | 8 | `wide` — everything fits but the longest names |
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
     |  +----------+   NAME              (white)                  |
     |  |          |   LABEL             (slate blue)             |
     |  |  EMBLEM  |   OPERATOR          (type colour)            |
     |  |  24 x 24 |                                              |
y=26 |  +----------+                                              |
y=29 |------------------ divider (40,46,74) ----------------------|
y=31 |  Alt:417km                                      Spd:27.6k  |
y=40 |  El:42°                                         Az:187° S  |
y=49 |  fact / next pass / KIND                                   |
y=58 |                    sky strip                               |
y=63 |  - - - - - - - - horizon + N/E/S/W ticks - - - - - - - - - |
     +------------------------------------------------------------+
```

- **Emblem** at `(2, 2)`, 24x24, drawn from `public/emblems.js`.
- **Identity column** starts at `x = 29` and holds 16 characters. The three
  rows run most-specific to least:

  | Row | Field | Colour | Example |
  |---|---|---|---|
  | `y = 2` | `name` | white, `255,255,255` | `STARLINK-1271` |
  | `y = 11` | `label` | slate blue, `150,160,210` | `Starlink` |
  | `y = 20` | `operator` | the type colour | `SpaceX` |

  The rows keep the colours of the slots they occupy, so the type colour is
  still shown in this block — it lands on the operator rather than on the
  kind. `kind` has no row of its own; it rotates through the bottom line.

  `label` and `operator` are short by construction and are truncated with a
  trailing `.` if they ever overflow; `check.mjs` fails the build first.

  **The name row is the one thing on this layout that moves.** About 9.5% of
  the names in the `active` catalogue (1,510 of 15,883) are longer than 16
  characters, so it marquees — but only when the text genuinely does not
  fit, which leaves the other 90.5% perfectly still. Its clip box starts at
  `x = 29`, so a scrolling name can never slide over the emblem.

  The marquee is **paced to the dwell, not to a fixed pixel rate**. The
  longest names in the catalogue are 24 characters, a 155px loop; at the
  140ms/px the compact board uses, that is 21.7s — three and a half times
  the 6s a card is on screen, so the end of a long name would never be seen.
  `nameScrollOffset()` in `public/app.js` instead scales the offset by how
  far through the dwell the card is, so every name completes exactly one
  loop whatever its length.
- **Telemetry rows are split-aligned** (both rows pale blue, `190,210,255`).
  The first field sits against the left margin at `x = 1`; the second is
  right-aligned so its last pixel lands on `x = cols - 2`. That keeps the
  digits of the changing value in a fixed column — without it, `Spd:9.9k`
  becoming `Spd:27.6k` shoves the label sideways on every refresh, which is
  exactly the sort of wobble that makes a glanceable board hard to read.
  `statRow()` in `public/panel.js` does this; it truncates the LEFT field if a
  row ever runs out of room, never the right one, and holds a one-character
  gutter between them.
  - Row 1: `Alt:` left, `Spd:` right.
  - Row 2: `El:` left, `Az:` + compass point right. Below the horizon the row
    becomes `Below horizon` left, range right.
- **Line 3 rotates** every 3.5 s through up to three stops: the fun fact
  (amber), the next-pass countdown (amber), and the object's `kind` drawn in
  its type colour. Only the headline satellite carries a pass prediction, so
  the rest of the roster cycles through two stops. `thirdLine()` in
  `public/panel.js` builds the list. The telemetry and fact rows never
  scroll; only the name row does, and only when it has to.
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
jumps back to the first entry mid-rotation.

`iss` and `overhead` both return a single satellite, so neither cycles. They
differ in which one: `iss` is always the station, while `overhead` is whichever
object is closest right now, held until another overtakes it (see
`stickyClosest()` in `server/server.js`).

## Renderer status

The two renderers are **not** currently at parity, and the layout above
describes the wide board that only one of them implements:

| Renderer | Implements |
|---|---|
| `public/panel.js` | both the wide (128x64) and compact (64x32) layouts |
| `firmware/orbitwall_esp32/orbitwall_esp32.ino` | compact (64x32) only |

The sketch is still hard-coded to `PANEL_WIDTH 64` / `PANEL_HEIGHT 32` and
draws the older three-region layout (horizon strip, scrolling name, one stat
at a time cycling through range / speed / elevation). It has no `Alt:`/`Spd:`
row, so the split alignment above does not apply to it yet. Porting the sketch
to the wide layout is the outstanding piece of work here.
