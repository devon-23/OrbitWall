# Building the OrbitWall panel

An RGB LED matrix showing the satellite currently closest to your location.

Read the [power safety](#power-safety) section before plugging anything in.

## How many modules

This is the decision to get right before you buy anything, because the
answer is not two.

HUB75 modules chain in a line. Two 64x32 modules give you **128x32** (side by
side) or **64x64** (stacked) — neither is a geometry this firmware draws.
The wide layout is 128x64, which is a 2x2 block of **four** modules.

| Build | Modules | Pixels | Physical size | Sketch setting |
|---|---|---|---|---|
| **Two 64x64** | 2 | **128x64** | 384 x 192 mm at P3 | `OW_BUILD OW_DUAL64` |
| Four 64x32 | 4 | 128x64 | 512 x 256 mm at P4 | `OW_BUILD OW_QUAD32` |
| One 64x32 | 1 | 64x32 | 256 x 128 mm at P4 | `OW_BUILD OW_SINGLE` |
| Two 64x32 | 2 | 128x32 or 64x64 | — | **not supported** |

**Two 64x64 modules is the build to aim for.** They chain straight into
128x64 with no coordinate remapping, so there is no chain order to get wrong,
there are half as many power drops to run, and the whole thing costs less.
The one catch is the scan rate — see [the E line](#the-e-line) below.

Four 64x32 modules give the same resolution on a physically larger board, at
the cost of the `VirtualMatrixPanel` remap described under
[2x2 chaining](#2x2-chaining).

### The E line

This is the single thing most likely to cost you an evening.

A module's **scan rate** sets how many address bits it needs:

| Module | Scan | Address lines | E |
|---|---|---|---|
| 64x32 | 1/16 | A, B, C, D | not connected |
| **64x64** | **1/32** | **A, B, C, D, E** | **must be wired** |

1/16 scan multiplexes 16 row pairs, which four bits can address. 1/32 scan
needs 32, so a fifth line. Leave E off a 64x64 module and it does not fail
obviously — you get the top half of the image repeated down the panel,
which reads as a firmware bug and is not one.

The sketch sets `PIN_E` from `OW_BUILD`: GPIO 18 for `OW_DUAL64`, `-1` for
the 64x32 builds. `npm test` checks that matrix resolves correctly.

### If the panel stays dark

Cheap 64x64 modules often use a driver chip that needs initialising before it
will light at all, and listings almost never say which one. If you have
already proven the wiring with the library's own `PatternPlasma` example and
still get nothing, or get garbage, uncomment one of the `OW_PANEL_DRIVER`
lines at the top of the sketch and reflash. `FM6126A` is the usual answer.

## Bill of materials

Quantities below are for the recommended **two-module 64x64** build. For the
four-module build take four 64x32 panels, four capacitors and a 5V 15A+
supply; for a single module, one panel and a 5V 4A supply.

| Part | Approx price | What to look for |
|---|---|---|
| **2 x** 64x64 indoor HUB75 RGB LED matrix module, 1/32 scan | $9-25 each | Search "P3 64x64 HUB75 LED module". A P3 module is 192 x 192mm; P4 would be 256 x 256mm. Must say **1/32 scan** and have a 16-pin IDC header. Check the shipping cost separately — on AliExpress it can exceed the parts. |
| ESP32 dev board (WROOM-32, sold as "ESP32 Dev Module" / "ESP32 DevKit V1") | $6-12 | Must be a **classic ESP32**. See [why not S3](#why-classic-esp32-and-not-s2s3c3). |
| 5V **10A+** (50W+) switching power supply | $15-25 | See [power budget](#power-budget). Two 64x64 modules can pull around 8A between them at full white. A 4A supply is only enough for a single 64x32 module. |
| ESP32-to-HUB75 adapter/driver shield | $15-25 | Strongly recommended. Search "ESP32 HUB75 adapter board" or use the open-source `rorosaurus/esp32-hub75-driver`. Saves wiring 14 jumpers by hand. |
| 1000-2200uF, 35V+ electrolytic capacitor, **one per module** | ~$1 each | Goes across each module's 5V/GND input. Prevents flicker when the display jumps to a bright frame. |
| HUB75 ribbon cable, 1 extra | ~$2 | To chain module to module. Each module ships with one; a 2-module chain needs 2 in total (4 for the quad build). |
| Power pigtail, 1 extra | ~$2 | Every module is powered **in parallel from the PSU**, never daisy-chained through another module. |
| DC barrel jack to screw-terminal adapter | ~$3 | For getting the PSU's 5V into the panel's power lead. |
| Female-female Dupont jumpers, 16+ | ~$5 | **Only if you skip the adapter shield.** |
| USB cable for the ESP32 | usually included | For flashing and serial monitoring. |

Modules usually ship with a power cable (two spade/pigtail leads) and a
16-pin IDC ribbon cable. Check your listing — if not, buy them separately.

### Power budget

Worst case is every LED at full white:

| Build | Pixels | Rough worst case | Supply |
|---|---|---|---|
| One 64x32 | 2,048 | ~4A / 20W | 5V 4A |
| **Two 64x64** | **8,192** | **~8A / 40W** | **5V 10A** |
| Four 64x32 | 8,192 | ~16A / 80W | 5V 15-20A |

The two 64x64 modules and the four 64x32 modules light the same 8,192 pixels,
but the 64x32 modules are driven at 1/16 scan — twice as many rows lit at
once — so they draw roughly twice the peak current for the same picture.

In practice OrbitWall never approaches any of these: the layout is mostly
dark and the firmware ships at `BRIGHTNESS 100` of 255. Expect **1-3A** for
the two-module board in normal use. Size for the worst case anyway — a
browned-out HUB75 panel does not fail gracefully, it shows garbage or
flickers, and you will waste an evening blaming the firmware.

### 2x2 chaining

The four modules are wired as **one chain of four**, not as two chains:

```
   PSU 5V/GND  ->  all four modules, in parallel

   ESP32 -> [1 IN]--[1 OUT] -> [2 IN]--[2 OUT]
                                           |
            [4 OUT]--[4 IN] <- [3 OUT]--[3 IN]
```

The library sees a 256x32 strip; `VirtualMatrixPanel` folds it into the
128x64 the renderer draws on. Which fold is correct depends on how you
physically arranged the modules, and it is genuinely hard to predict — so
don't.

**Hold the BOOT button while powering up.** The sketch draws a numbered,
coloured border in each quadrant:

```
+---------+---------+
|    1    |    2    |
+---------+---------+
|    3    |    4    |
+---------+---------+
```

If they appear in that order, `OW_CHAIN_TYPE` is right. If not, try the other
values listed next to the `#define` in the sketch until they do. This takes
about a minute and saves guessing from a scrambled display.

### Avoid this specific panel

Adafruit's 64x32 2.5mm-pitch panel (product #5036) has its green and blue
channels swapped relative to the standard HUB75 pinout. It works, but only
after remapping pins in software, which makes every wiring guide including
this one wrong for it. Get a generic P4 panel instead for your first build.

### Why classic ESP32 and not S2/S3/C3

The driver library pushes pixel data out over a high-frequency I2S DMA
signal. On ESP32-S2/S3 boards that signal interferes with the WiFi radio
unless the board is specifically EMI-hardened — you get a display that works
until WiFi connects, then drops packets or stops updating. The classic
ESP32-WROOM-32 does not have this problem and is the library's most
well-tested target. Buy the older chip on purpose.

## Power safety

**The panels do not get their power from the ESP32.** At full brightness one
module can pull 4 amps — a full board, 8 to 16 — while the ESP32's onboard
regulator supplies a few hundred milliamps. Wiring a panel to the ESP32's 5V
pin will brown out the board, and can damage the regulator.

**Power each module directly from the PSU, in parallel.** Do not feed module
2 from module 1's output terminals: the trace and connector are not rated for
the combined current, and the voltage drop across a chained pair is enough to
make the far module dim and unstable.

Correct wiring:

- PSU 5V and GND go **directly** to the panel's power leads (red = 5V,
  black = GND).
- The ESP32 is powered separately over USB while you develop. Once it works,
  you can run a second pair of wires from the same PSU to the ESP32's
  `5V`/`VIN` and `GND` pins.
- **All grounds must be connected together** — panel GND, PSU GND, and
  ESP32 GND. Signal wires need a shared ground reference or the display shows
  garbage.
- Observe polarity on the electrolytic capacitor. The stripe on its side
  marks the negative leg, which goes to GND. Backwards capacitors vent.

Do not run the panel at 100% brightness for the first test. The firmware
starts at ~40%, which is bright enough for a room and keeps current draw
near 1A.

## Wiring

If you bought an adapter shield, skip this table — plug the ESP32 into the
shield, plug the shield's IDC header into the panel's **input** connector
(panels have IN and OUT; the arrows on the silkscreen point away from IN),
and connect PSU power to the shield's screw terminals. **The shield's own
silkscreen supersedes this table** if its pin assignment differs; if so,
update `PIN_*` in the firmware to match.

Hand-wiring, using the library's default pinout:

| HUB75 pin | Signal | ESP32 GPIO |
|---|---|---|
| R1 | red, top half | 25 |
| G1 | green, top half | 26 |
| B1 | blue, top half | 27 |
| R2 | red, bottom half | 14 |
| G2 | green, bottom half | 12 |
| B2 | blue, bottom half | 13 |
| A | row address bit 0 | 23 |
| B | row address bit 1 | 19 |
| C | row address bit 2 | 5 |
| D | row address bit 3 | 17 |
| E | row address bit 4 | **18** on a 64x64 module; not connected on 64x32 |
| CLK | shift clock | 16 |
| LAT (STB) | latch | 4 |
| OE | output enable | 15 |
| GND (4 pins) | ground | any ESP32 GND |

On a 1/16-scan 64x32 module, E is unused: A-D address 16 row pairs = 32
rows. Leave it unconnected. That stays true for the four-module build —
chaining adds width, not rows, so the scan rate is unchanged.

On a 1/32-scan 64x64 module, **E must be wired to GPIO 18**. See
[the E line](#the-e-line).

Only the **first** module in the chain connects to the ESP32. The rest are
fed by ribbon from the previous module's OUT connector.

GPIO12 is a strapping pin (MTDI) on the ESP32 — it is read at boot to set
flash voltage. Driving it as an output after boot is fine, which is what the
panel does, but don't add an external pull-up to it or the board may fail to
start.

The 16-pin HUB75 connector is keyed but the ribbon can still be seated
backwards on cheap panels. Pin 1 is marked on the panel's PCB; match it to
the red stripe on the ribbon cable.

## Assembly order

1. **Panel power only.** Wire PSU 5V/GND to the panel, nothing else
   connected. Power on. The panel may show a faint garbage pattern or
   nothing — both are normal. Feel for hot spots; there should be none. Power
   off.
2. **Solder the capacitor** across the panel's 5V/GND input, stripe (negative)
   to GND.
3. **Wire signals** — plug in the adapter shield, or run the 14 jumpers per
   the table above. Power off while doing this.
4. **Bench test the library** before running OrbitWall's own code. Flash the
   `PatternPlasma` example that ships with the HUB75 library. If that renders,
   your wiring and pinout are correct and any later problem is in the
   firmware or WiFi, not the hardware.
5. **Flash the OrbitWall firmware.** See
   [`firmware/orbitwall_esp32/README.md`](../firmware/orbitwall_esp32/README.md).
6. **Mount it.** Panels have M3 threaded standoffs on the back. A picture
   frame with the glass removed works well; so does a piece of plywood with
   the panel bolted on and the ESP32 taped behind it. Leave the ribbon cable
   accessible — you will want to reflash.

## Troubleshooting

**Nothing lights up at all.** Check the PSU actually outputs 5V under load.
Check the ribbon is on the panel's IN connector, not OUT.

**Colors are wrong (red shows as blue, etc).** Your panel's channel order
differs from the standard. Swap the `PIN_G1`/`PIN_B1` and `PIN_G2`/`PIN_B2`
definitions in the firmware.

**Top half and bottom half show the same thing, or rows are duplicated.**
Address line problem — check A/B/C/D. If only rows 0-15 work, D is likely
not connected.

**Ghosting (faint copies of pixels on adjacent rows).** Lower the brightness
first. If it persists, add `#define PIXEL_COLOR_DEPTH_BITS 6` before the
library include to reduce color depth, which shortens the per-row PWM window.

**Flicker, especially on bright frames.** Almost always power. Confirm the
capacitor is installed, the PSU is rated 4A or more, and the power wires are
short and thick (20AWG or better). Long thin wires drop enough voltage to
cause this.

**Display works until WiFi connects, then freezes or tears.** You are on an
ESP32-S2/S3. See [above](#why-classic-esp32-and-not-s2s3c3) — this is a
hardware limitation, not a settings problem.

**Display works but always shows the same satellite.** The ESP32 is reaching
the panel but not the server. Open the Serial Monitor at 115200 baud and look
for HTTP errors; check that `SERVER_HOST` in `secrets.h` is the machine's LAN
IP (not `localhost`) and that the server is actually running.
