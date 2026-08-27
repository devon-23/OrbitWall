# Building the OrbitWall panel

A 64x32 RGB LED matrix showing the satellite currently closest to your
location. Total cost is roughly $60-90 depending on which parts you pick.

Read the [power safety](#power-safety) section before plugging anything in.

## Bill of materials

| Part | Approx price | What to look for |
|---|---|---|
| 64x32 P4 (4mm pitch) indoor HUB75 RGB LED matrix panel, 1/16 scan | $25-35 | Search "P4 64x32 HUB75 LED matrix". The physical panel is about 256 x 128mm. Make sure the listing says **1/16 scan** and shows a 16-pin IDC connector. |
| ESP32 dev board (WROOM-32, sold as "ESP32 Dev Module" / "ESP32 DevKit V1") | $6-12 | Must be a **classic ESP32**. See [why not S3](#why-classic-esp32-and-not-s2s3c3). |
| 5V 4A+ (20W+) switching power supply | $10-15 | Barrel jack is easiest. 4A is the panel's worst-case draw with every LED at full white. |
| ESP32-to-HUB75 adapter/driver shield | $15-25 | Strongly recommended. Search "ESP32 HUB75 adapter board" or use the open-source `rorosaurus/esp32-hub75-driver`. Saves wiring 14 jumpers by hand. |
| 1000-2200uF, 35V+ electrolytic capacitor | ~$1 | Goes across the panel's 5V/GND input. Prevents flicker when the display jumps to a bright frame. |
| DC barrel jack to screw-terminal adapter | ~$3 | For getting the PSU's 5V into the panel's power lead. |
| Female-female Dupont jumpers, 16+ | ~$5 | **Only if you skip the adapter shield.** |
| USB cable for the ESP32 | usually included | For flashing and serial monitoring. |

Panels usually ship with a power cable (two spade/pigtail leads) and a 16-pin
IDC ribbon cable. Check your listing — if not, buy them separately.

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

**The panel does not get its power from the ESP32.** At full brightness a
64x32 panel can pull 4 amps; the ESP32's onboard regulator supplies a few
hundred milliamps. Wiring the panel to the ESP32's 5V pin will brown out the
board, and can damage the regulator.

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
| E | row address bit 4 | not connected |
| CLK | shift clock | 16 |
| LAT (STB) | latch | 4 |
| OE | output enable | 15 |
| GND (4 pins) | ground | any ESP32 GND |

E is unused because a 1/16-scan 64x32 panel only needs 4 address bits. Leave
it unconnected.

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
