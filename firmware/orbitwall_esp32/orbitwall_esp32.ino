// OrbitWall -- HUB75 satellite display.
//
// All the drawing lives in panel_draw.h, which is a straight port of
// public/panel.js; `npm test` compiles it on a desktop and diffs the result
// against the browser preview, so the two cannot drift. This file is the
// glue: bring up the panel, poll the server, advance the animation.
//
// Layout spec: docs/MATRIX_LAYOUT.md. Wiring: docs/HARDWARE.md.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

#include "secrets.h"
#include "panel_assets.h"
#include "panel_draw.h"

// ---------------------------------------------------------------------------
// What you built -- set OW_BUILD before flashing
// ---------------------------------------------------------------------------
//
//   OW_SINGLE   one 64x32 module           ->  64x32, compact layout
//   OW_DUAL64   two 64x64 modules, side by side -> 128x64, wide layout
//   OW_QUAD32   four 64x32 modules, 2x2 block   -> 128x64, wide layout
//
// Two 64x32 modules is not a build: they make 128x32 or 64x64, neither of
// which is a layout this firmware draws.
//
// OW_DUAL64 is the one to prefer for a 128x64 board. The modules chain
// straight into 128x64 with no coordinate remapping, so there is no chain
// order to get wrong -- but note they are 1/32 scan, which needs the E
// address line wired. See docs/HARDWARE.md.

#define OW_SINGLE 0
#define OW_DUAL64 1
#define OW_QUAD32 2

#define OW_BUILD OW_DUAL64

#define PANEL_RES_X 64 // every module we support is 64 wide

#if OW_BUILD == OW_SINGLE
  #define PANEL_RES_Y 32
  #define PANEL_CHAIN 1
  #define PIN_E -1 // 1/16 scan: A-D address all 32 rows
  #define OW_VIRTUAL 0

#elif OW_BUILD == OW_DUAL64
  #define PANEL_RES_Y 64
  #define PANEL_CHAIN 2
  // 1/32 scan addresses 32 row pairs, which needs five address bits. A 64x64
  // module WILL NOT work with E unconnected -- you get the top half of the
  // image repeated down the panel.
  #define PIN_E 18
  #define OW_VIRTUAL 0

#elif OW_BUILD == OW_QUAD32
  #define PANEL_RES_Y 32
  #define PANEL_CHAIN 4
  #define PIN_E -1
  #define OW_VIRTUAL 1
  #define VPANEL_COLS 2 // modules across
  #define VPANEL_ROWS 2 // modules down

  // How the ribbon snakes between modules. The chain starts at the module
  // the ESP32 plugs into. If your quadrants come out shuffled, this is the
  // knob -- hold BOOT at power-up to show a quadrant test, then pick the
  // name whose numbering matches what you see:
  //
  //   CHAIN_TOP_LEFT_DOWN      CHAIN_TOP_RIGHT_DOWN
  //   CHAIN_BOTTOM_LEFT_UP     CHAIN_BOTTOM_RIGHT_UP
  //
  // and the _ZZ variants of each for non-serpentine (straight-back) wiring.
  #define OW_CHAIN_TYPE CHAIN_TOP_RIGHT_DOWN

#else
  #error "OW_BUILD must be OW_SINGLE, OW_DUAL64 or OW_QUAD32"
#endif

#if OW_VIRTUAL
  #include <ESP32-VirtualMatrixPanel-I2S-DMA.h>
  #define DISPLAY_W (PANEL_RES_X * VPANEL_COLS)
  #define DISPLAY_H (PANEL_RES_Y * VPANEL_ROWS)
#else
  #define DISPLAY_W (PANEL_RES_X * PANEL_CHAIN)
  #define DISPLAY_H PANEL_RES_Y
#endif

// Some modules -- 64x64 ones especially -- use a driver chip that needs
// initialising before it will show anything, and a cheap listing rarely says
// which. If the panel stays dark, or shows garbage, with wiring you have
// already proven using the library's own PatternPlasma example, uncomment
// one of these and reflash. FM6126A is by far the most common culprit.
//
// #define OW_PANEL_DRIVER HUB75_I2S_CFG::FM6126A
// #define OW_PANEL_DRIVER HUB75_I2S_CFG::FM6124
// #define OW_PANEL_DRIVER HUB75_I2S_CFG::ICN2038S

// ---------------------------------------------------------------------------
// Pins -- see the table in docs/HARDWARE.md
// ---------------------------------------------------------------------------

#define PIN_R1 25
#define PIN_G1 26
#define PIN_B1 27
#define PIN_R2 14
#define PIN_G2 12
#define PIN_B2 13
#define PIN_A 23
#define PIN_B 19
#define PIN_C 5
#define PIN_D 17
// PIN_E is set by the build block above: -1 for 1/16-scan 64x32 modules,
// GPIO 18 for 1/32-scan 64x64 ones.
#define PIN_CLK 16
#define PIN_LAT 4
#define PIN_OE 15

#define PIN_BOOT 0 // the dev board's BOOT button, for the quadrant test

// ---------------------------------------------------------------------------
// Timing -- matches public/app.js so the wall and the preview stay in step
// ---------------------------------------------------------------------------

#define BRIGHTNESS 100 // out of 255; read the power notes in docs/HARDWARE.md
#define FETCH_INTERVAL_MS 10000
#define SAT_DWELL_MS 6000
#define THIRD_LINE_MS 3500
#define SCROLL_STEP_MS 140
#define FRAME_MS 40
#define MAX_SATS 5

MatrixPanel_I2S_DMA *dma = nullptr;
#if OW_VIRTUAL
VirtualMatrixPanel *display = nullptr;
#else
MatrixPanel_I2S_DMA *display = nullptr;
#endif

OwSat sats[MAX_SATS];
int satCount = 0;
int satIndex = 0;
int thirdIndex = 0;
int scrollOffset = 0;

unsigned long lastFetch = 0;
unsigned long lastSatSwitch = 0;
unsigned long lastThirdSwitch = 0;
unsigned long lastScroll = 0;

// Pass times arrive as "ms from the server's clock"; we have no RTC, so they
// are stored relative to the millis() at which they landed.
unsigned long fetchedAtMs = 0;

// ---------------------------------------------------------------------------
// Pixel sink
// ---------------------------------------------------------------------------

static void owPlot(void *ctx, int x, int y, OwRgb c) {
  (void)ctx;
  display->drawPixelRGB888(x, y, c.r, c.g, c.b);
}

static OwCanvas canvas = {DISPLAY_W, DISPLAY_H, owPlot, nullptr};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(PIN_BOOT, INPUT_PULLUP);

  HUB75_I2S_CFG::i2s_pins pins = {PIN_R1, PIN_G1, PIN_B1, PIN_R2, PIN_G2, PIN_B2,
                                  PIN_A, PIN_B, PIN_C, PIN_D, PIN_E,
                                  PIN_LAT, PIN_OE, PIN_CLK};
  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN, pins);
  mxconfig.double_buff = true; // without it the clear/redraw cycle tears
#ifdef OW_PANEL_DRIVER
  mxconfig.driver = OW_PANEL_DRIVER;
#endif

  dma = new MatrixPanel_I2S_DMA(mxconfig);
  dma->begin();
  dma->setBrightness8(BRIGHTNESS);
  dma->clearScreen();

#if OW_VIRTUAL
  display = new VirtualMatrixPanel(*dma, VPANEL_ROWS, VPANEL_COLS,
                                   PANEL_RES_X, PANEL_RES_Y, OW_CHAIN_TYPE);
#else
  display = dma;
#endif

  Serial.printf("OrbitWall: %dx%d from %d x %dx%d module%s\n", DISPLAY_W,
                DISPLAY_H, PANEL_CHAIN, PANEL_RES_X, PANEL_RES_Y,
                PANEL_CHAIN == 1 ? "" : "s");

#if OW_VIRTUAL
  // Held BOOT at power-up? Show which physical quadrant is which logical
  // one, so OW_CHAIN_TYPE can be picked by looking rather than guessing.
  if (digitalRead(PIN_BOOT) == LOW) quadrantTest();
#endif

  showMessage("WIFI...");
  connectWifi();
  fetchSatellites();
  lastFetch = millis();
  lastSatSwitch = millis();
  lastThirdSwitch = millis();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

void loop() {
  unsigned long now = millis();

  if (now - lastFetch >= FETCH_INTERVAL_MS) {
    fetchSatellites();
    lastFetch = now;
  }

  // A new fetch replaces the data without resetting the cycle, so the board
  // never jumps back to the first entry mid-rotation.
  if (satCount > 1 && now - lastSatSwitch >= SAT_DWELL_MS) {
    satIndex = (satIndex + 1) % satCount;
    scrollOffset = 0;
    lastSatSwitch = now;
  }

  if (now - lastThirdSwitch >= THIRD_LINE_MS) {
    thirdIndex++;
    lastThirdSwitch = now;
  }

  if (now - lastScroll >= SCROLL_STEP_MS) {
    scrollOffset++;
    lastScroll = now;
  }

  render(now);
  delay(FRAME_MS);
}

// Paced to the dwell, not to a fixed pixel rate: a 24-character name is a
// 155px loop, which at SCROLL_STEP_MS would take 21.7s -- far longer than a
// card is on screen, so its tail would never be seen. See public/app.js.
static int nameScrollOffset(const OwSat &sat, unsigned long now) {
  int span = owTextWidthUtf8(sat.name) + OW_CHAR_W * 2;
  if (span <= 0) return 0;
  unsigned long elapsed = now - lastSatSwitch;
  return (int)(((unsigned long long)elapsed * span) / SAT_DWELL_MS);
}

void render(unsigned long now) {
  dma->clearScreen();

  if (satCount == 0) {
    owRenderMessage(canvas, "No data", OW_COL_ALERT);
    dma->flipDMABuffer();
    return;
  }

  const OwSat &sat = sats[satIndex];

  // Count the pass down between fetches instead of freezing it.
  OwSat shown = sat;
  if (shown.hasPass) shown.passInMs = sat.passInMs - (long)(now - fetchedAtMs);

  OwState st;
  st.thirdIndex = thirdIndex;
  st.nameScrollOffset = nameScrollOffset(sat, now);
  st.scrollOffset = scrollOffset;

  owRenderCard(canvas, shown, st);
  dma->flipDMABuffer();
}

void showMessage(const char *text) {
  dma->clearScreen();
  owRenderMessage(canvas, text, OW_COL_LABEL);
  dma->flipDMABuffer();
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi failed - will retry on next fetch.");
    showMessage("NO WIFI");
  }
}

// Looks up a type's colour if the payload did not carry one.
static OwRgb colorForType(const char *type) {
  for (int i = 0; i < OW_TYPE_COUNT; i++) {
    if (strcmp(OW_TYPE_NAMES[i], type) == 0) return OW_TYPE_COLORS[i];
  }
  return OW_COL_LABEL;
}

static void readSat(OwSat &s, JsonObject o, bool withPass) {
  memset(&s, 0, sizeof(s));
  snprintf(s.name, sizeof(s.name), "%s", o["n"] | "UNKNOWN");
  snprintf(s.label, sizeof(s.label), "%s", o["l"] | "Satellite");
  snprintf(s.op, sizeof(s.op), "%s", o["o"] | "Unknown");
  snprintf(s.kind, sizeof(s.kind), "%s", o["k"] | "Payload");
  snprintf(s.emblem, sizeof(s.emblem), "%s", o["e"] | "generic");
  snprintf(s.fact, sizeof(s.fact), "%s", o["f"] | "");

  const char *type = o["t"] | "generic";
  JsonArray c = o["c"];
  if (c.size() == 3) {
    s.color.r = (uint8_t)c[0].as<int>();
    s.color.g = (uint8_t)c[1].as<int>();
    s.color.b = (uint8_t)c[2].as<int>();
  } else {
    s.color = colorForType(type);
  }

  s.rangeKm = o["r"] | 0;
  s.altitudeKm = o["a"] | 0;
  s.speedKmh = o["sp"] | 0L;
  s.elevationDeg = o["el"] | 0.0f;
  s.azimuthDeg = o["az"] | 0;

  s.hasPass = false;
  s.passInMs = 0;
  if (withPass && !o["p"].isNull()) {
    s.hasPass = true;
    s.passInMs = o["p"].as<long>();
  }
}

void fetchSatellites() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
    if (WiFi.status() != WL_CONNECTED) return;
  }

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + "/api/leds";
  http.begin(url);
  http.setTimeout(8000);

  int code = http.GET();
  if (code != 200) {
    Serial.printf("HTTP %d from %s\n", code, url.c_str());
    http.end();
    return;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();

  if (err) {
    Serial.print("JSON parse failed: ");
    Serial.println(err.c_str());
    return;
  }

  int count = 0;
  JsonObject closest = doc["closest"];
  if (!closest.isNull()) readSat(sats[count++], closest, true);

  for (JsonObject item : doc["next"].as<JsonArray>()) {
    if (count >= MAX_SATS) break;
    readSat(sats[count++], item, false);
  }

  satCount = count;
  if (satIndex >= satCount) satIndex = 0;
  fetchedAtMs = millis();

  Serial.printf("Loaded %d satellites, closest: %s\n", satCount,
                satCount > 0 ? sats[0].name : "-");
}

// ---------------------------------------------------------------------------
// Quadrant test -- only the 2x2 build can get its chain order wrong
// ---------------------------------------------------------------------------
#if OW_VIRTUAL
// Fills each quadrant with a colour and a digit, in logical order:
//   1 top-left (red)     2 top-right (green)
//   3 bottom-left (blue) 4 bottom-right (white)
//
// If the digits appear out of order or in the wrong corners, change
// OW_CHAIN_TYPE until they do not. Nothing else about the build depends on
// getting this right first time.
void quadrantTest() {
  const OwRgb colors[4] = {{180, 40, 40}, {40, 180, 40}, {40, 40, 180}, {160, 160, 160}};
  const char *labels[4] = {"1", "2", "3", "4"};

  dma->clearScreen();
  for (int q = 0; q < 4; q++) {
    int ox = (q % 2) * PANEL_RES_X;
    int oy = (q / 2) * PANEL_RES_Y;
    for (int y = 0; y < PANEL_RES_Y; y++) {
      for (int x = 0; x < PANEL_RES_X; x++) {
        bool edge = x == 0 || y == 0 || x == PANEL_RES_X - 1 || y == PANEL_RES_Y - 1;
        if (edge) canvas.plot(ox + x, oy + y, colors[q]);
      }
    }
    OwBox box = {ox, oy, ox + PANEL_RES_X - 1, oy + PANEL_RES_Y - 1};
    owDrawText(canvas, ox + PANEL_RES_X / 2 - 2, oy + PANEL_RES_Y / 2 - 3,
               labels[q], colors[q], box);
  }
  dma->flipDMABuffer();

  Serial.println("Quadrant test - release BOOT and reset to continue.");
  while (digitalRead(PIN_BOOT) == LOW) delay(50);
  delay(3000);
}
#endif
