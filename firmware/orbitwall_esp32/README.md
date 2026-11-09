# OrbitWall ESP32 firmware

Drives a HUB75 LED matrix in either geometry. Polls the OrbitWall server
every 10 seconds and renders the nearest satellites per
[`docs/MATRIX_LAYOUT.md`](../../docs/MATRIX_LAYOUT.md).

Wiring, parts and the power budget are in
[`docs/HARDWARE.md`](../../docs/HARDWARE.md).

## Files

| File | What it is |
|---|---|
| `orbitwall_esp32.ino` | Glue: panel bring-up, WiFi, JSON, the animation clock. |
| `panel_draw.h` | The renderer. A port of `public/panel.js`, free of Arduino types so the host can compile it. |
| `panel_assets.h` | **Generated.** Font, emblems, colours. Run `npm run gen:firmware` after changing the JS sources; do not hand-edit. |
| `secrets.h` | Yours, gitignored. Copy from `secrets.example.h`. |

`npm test` compiles `panel_draw.h` on your machine and diffs its output
against the browser preview pixel for pixel, so the panel cannot quietly stop
matching what you see in the browser.

## Pick your build

One line at the top of `orbitwall_esp32.ino`:

```c
#define OW_BUILD OW_DUAL64
```

| Value | Hardware | Result |
|---|---|---|
| `OW_DUAL64` | two 64x64 modules, side by side | 128x64, wide layout |
| `OW_QUAD32` | four 64x32 modules, 2x2 block | 128x64, wide layout |
| `OW_SINGLE` | one 64x32 module | 64x32, compact layout |

**Two 64x32 modules is not a build** — they chain to 128x32 or stack to
64x64, neither of which is a layout this firmware draws.

Everything else follows from that one setting: resolution, chain length,
whether `VirtualMatrixPanel` is used, and whether the E address line is
wired. `npm test` preprocesses all three and checks each resolves to the
geometry it should.

### 64x64 modules need the E line

64x64 modules are 1/32 scan, which needs five address bits instead of four.
`OW_DUAL64` sets `PIN_E` to GPIO 18 for you, but **you have to run that
wire**. Without it the top half of the image repeats down the panel, which
looks like a firmware bug and is not one.

### If the panel stays dark

Cheap 64x64 modules often use a driver chip that needs initialising first,
and listings rarely say which. If `PatternPlasma` already proved your wiring
and you still get nothing or get garbage, uncomment one of the
`OW_PANEL_DRIVER` lines near the top of the sketch. `FM6126A` is the usual
answer.

### Getting the chain order right (OW_QUAD32 only)

With four modules the library sees one 256x32 strip and folds it into 128x64.
Which fold is correct depends on how you physically arranged them. Rather
than guess, **hold the BOOT button while powering up**: each quadrant shows a
numbered, coloured border. If they read 1, 2 / 3, 4 left-to-right and
top-to-bottom, `OW_CHAIN_TYPE` is right; otherwise try the other values
listed beside that `#define`. Two 64x64 modules need no such fold, which is
one reason to prefer them.

## One-time setup

**1. Install ESP32 board support.** In Arduino IDE, open
Settings, and add this to Additional Board Manager URLs:

```
https://espressif.github.io/arduino-esp32/package_esp32_index.json
```

Then Tools > Board > Boards Manager, search "esp32", install
**esp32 by Espressif Systems**.

**2. Install libraries.** Tools > Manage Libraries, install:

| Library | Notes |
|---|---|
| `ESP32 HUB75 LED MATRIX PANEL DMA Display` | by mrcodetastic. The panel driver; also provides `VirtualMatrixPanel` for the 2x2 build. |
| `Adafruit GFX Library` | dependency of the above; accept the prompt to install dependencies. |
| `ArduinoJson` | version 7.x. |

**3. Create your secrets file.** Copy `secrets.example.h` to `secrets.h` in
this same folder and fill in your WiFi and server address:

```bash
cp secrets.example.h secrets.h
```

`secrets.h` is gitignored. `SERVER_HOST` must be the **LAN IP** of the
machine running `npm start`, not `localhost` — from the ESP32's point of
view, `localhost` is the ESP32. On macOS find it with:

```bash
ipconfig getifaddr en0
```

**4. Board settings.** Tools menu:

- Board: **ESP32 Dev Module** (not S2, S3, or C3 — see the hardware doc for
  why that matters)
- Upload Speed: 921600 (drop to 115200 if uploads fail)
- Port: whichever `/dev/cu.usbserial-*` or `/dev/cu.SLAB_*` appears when the
  board is plugged in

## Bench test before you trust it

Flash the library's own `PatternPlasma` example first
(File > Examples > ESP32 HUB75 LED MATRIX PANEL DMA Display). If that
renders, your wiring is right and any later issue is in this firmware or the
network — which cuts your debugging in half.

## Flashing

Open `orbitwall_esp32.ino`, hit Upload. Then open Serial Monitor at
**115200 baud**. You should see:

```
Connecting to WiFi....
Connected. IP: 192.168.1.87
Loaded 4 satellites, closest: ISS (ZARYA)
```

The panel shows `WIFI...` while connecting, `NO WIFI` if it can't join, and
`NO DATA` if it joined but got nothing usable from the server.

Some ESP32 boards need the BOOT button held during upload. If you see
`Failed to connect ... Wrong boot mode detected`, hold BOOT, press EN, then
release BOOT once "Connecting..." appears.

## Tuning

Constants at the top of the sketch:

| Constant | Default | Effect |
|---|---|---|
| `OW_BUILD` | `OW_DUAL64` | Which panel arrangement you built. See above. |
| `OW_PANEL_DRIVER` | commented out | Uncomment if the panel needs its driver chip initialised. |
| `OW_CHAIN_TYPE` | `CHAIN_TOP_RIGHT_DOWN` | `OW_QUAD32` only. Use the BOOT-button quadrant test rather than guessing. |
| `BRIGHTNESS` | 100 | Out of 255. Raising it raises current draw — four modules at full white is 16A. Check your PSU headroom first. |
| `FETCH_INTERVAL_MS` | 10000 | How often to poll the server. Matches `public/app.js`; below ~5s mostly just adds load. |
| `SAT_DWELL_MS` | 6000 | How long each satellite stays on screen. Also sets the name marquee's speed, which is paced to complete one loop per dwell. |
| `THIRD_LINE_MS` | 3500 | How fast the bottom line rotates between fact, next pass and kind. |
| `SCROLL_STEP_MS` | 140 | Marquee speed for the compact board's bottom line. Lower is faster. |

These defaults match the constants in `public/app.js`, so the wall and the
preview stay in step.

If you change layout behaviour: edit `docs/MATRIX_LAYOUT.md`, then
`public/panel.js`, then `panel_draw.h`, then run `npm test` — it will name
the exact row and column where the two renderers still disagree.
