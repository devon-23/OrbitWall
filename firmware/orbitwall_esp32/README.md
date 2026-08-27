# OrbitWall ESP32 firmware

Drives a 64x32 HUB75 LED matrix. Polls the OrbitWall server every 12 seconds
and renders the nearest satellites per [`docs/MATRIX_LAYOUT.md`](../../docs/MATRIX_LAYOUT.md).

Wiring and parts are in [`docs/HARDWARE.md`](../../docs/HARDWARE.md).

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
| `ESP32 HUB75 LED MATRIX PANEL DMA Display` | by mrcodetastic. The panel driver. |
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
| `BRIGHTNESS` | 100 | Out of 255. Raising it raises current draw — check your PSU headroom first. |
| `FETCH_INTERVAL_MS` | 12000 | How often to poll the server. Satellite positions move fast; going below ~5s mostly just adds load. |
| `SAT_DWELL_MS` | 5000 | How long each satellite stays on screen. |
| `STAT_CYCLE_MS` | 3000 | How fast the stats line rotates between range/speed/elevation. |
| `SCROLL_STEP_MS` | 150 | Marquee speed for long satellite names. Lower is faster. |

If you change layout behavior, update `docs/MATRIX_LAYOUT.md` and
`public/app.js` too so the browser preview keeps matching the panel.
