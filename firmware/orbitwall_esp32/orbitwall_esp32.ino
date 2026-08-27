// OrbitWall — 64x32 HUB75 satellite display.
// Layout is specified in docs/MATRIX_LAYOUT.md; keep this file and
// public/app.js in sync with it.

#include <ctype.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

#include "secrets.h"

#define PANEL_WIDTH 64
#define PANEL_HEIGHT 32
#define PANEL_CHAIN 1

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
#define PIN_E -1
#define PIN_CLK 16
#define PIN_LAT 4
#define PIN_OE 15

#define BRIGHTNESS 100  // out of 255; see the power notes in docs/HARDWARE.md
#define FETCH_INTERVAL_MS 12000
#define SAT_DWELL_MS 5000
#define STAT_CYCLE_MS 3000
#define SCROLL_STEP_MS 150
#define FRAME_MS 40

#define MAX_SATS 4
#define NAME_LEN 32
#define STAT_LEN 16
#define CHAR_W 6
#define VISIBLE_CHARS (PANEL_WIDTH / CHAR_W)
#define SCROLL_GAP 12

MatrixPanel_I2S_DMA *matrix = nullptr;

struct Sat {
  char name[NAME_LEN];
  char type[12];
  int rangeKm;
  long speedKmh;
  float elevationDeg;
  int azimuthDeg;
  bool hasLook;  // only the closest satellite carries az/el/speed
};

Sat sats[MAX_SATS];
int satCount = 0;

int satIndex = 0;
int statIndex = 0;
int scrollOffset = 0;

unsigned long lastFetch = 0;
unsigned long lastSatSwitch = 0;
unsigned long lastStatSwitch = 0;
unsigned long lastScroll = 0;

// 3x3 icon bitmaps, row-major, indexed by type. See MATRIX_LAYOUT.md.
struct Icon {
  const char *type;
  uint8_t rows[3];  // low 3 bits of each byte are the pixels, MSB-first
  uint8_t r, g, b;
};

const Icon ICONS[] = {
  {"station", {0b010, 0b111, 0b010}, 255, 255, 255},
  {"comms",   {0b101, 0b010, 0b101}, 0, 220, 220},
  {"weather", {0b010, 0b101, 0b010}, 60, 120, 255},
  {"science", {0b010, 0b010, 0b111}, 255, 200, 0},
  {"generic", {0b000, 0b010, 0b000}, 0, 230, 90}
};
const int ICON_COUNT = sizeof(ICONS) / sizeof(ICONS[0]);

const Icon &iconFor(const char *type) {
  for (int i = 0; i < ICON_COUNT; i++) {
    if (strcmp(ICONS[i].type, type) == 0) return ICONS[i];
  }
  return ICONS[ICON_COUNT - 1];  // generic
}

void setup() {
  Serial.begin(115200);
  delay(200);

  HUB75_I2S_CFG mxconfig(PANEL_WIDTH, PANEL_HEIGHT, PANEL_CHAIN);
  mxconfig.gpio.r1 = PIN_R1;
  mxconfig.gpio.g1 = PIN_G1;
  mxconfig.gpio.b1 = PIN_B1;
  mxconfig.gpio.r2 = PIN_R2;
  mxconfig.gpio.g2 = PIN_G2;
  mxconfig.gpio.b2 = PIN_B2;
  mxconfig.gpio.a = PIN_A;
  mxconfig.gpio.b = PIN_B;
  mxconfig.gpio.c = PIN_C;
  mxconfig.gpio.d = PIN_D;
  mxconfig.gpio.e = PIN_E;
  mxconfig.gpio.clk = PIN_CLK;
  mxconfig.gpio.lat = PIN_LAT;
  mxconfig.gpio.oe = PIN_OE;
  mxconfig.double_buff = true;  // required for flipDMABuffer(); without it the
                                // clear/redraw cycle tears on every frame

  matrix = new MatrixPanel_I2S_DMA(mxconfig);
  matrix->begin();
  matrix->setBrightness8(BRIGHTNESS);
  matrix->clearScreen();
  matrix->setTextSize(1);
  matrix->setTextWrap(false);

  showMessage("WIFI...");
  connectWifi();
  fetchSatellites();
  lastFetch = millis();
}

void loop() {
  unsigned long now = millis();

  if (now - lastFetch >= FETCH_INTERVAL_MS) {
    fetchSatellites();
    lastFetch = now;
  }

  if (satCount > 0 && now - lastSatSwitch >= SAT_DWELL_MS) {
    satIndex = (satIndex + 1) % satCount;
    statIndex = 0;
    scrollOffset = 0;
    lastSatSwitch = now;
    lastStatSwitch = now;
  }

  if (now - lastStatSwitch >= STAT_CYCLE_MS) {
    statIndex = (statIndex + 1) % 3;
    lastStatSwitch = now;
  }

  if (now - lastScroll >= SCROLL_STEP_MS) {
    scrollOffset++;
    lastScroll = now;
  }

  render();
  delay(FRAME_MS);
}

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
    Serial.println("WiFi failed — will retry on next fetch.");
    showMessage("NO WIFI");
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
  if (!closest.isNull()) {
    Sat &s = sats[count++];
    strlcpy(s.name, closest["n"] | "UNKNOWN", NAME_LEN);
    strlcpy(s.type, closest["t"] | "generic", sizeof(s.type));
    s.rangeKm = closest["r"] | 0;
    s.speedKmh = closest["sp"] | 0L;
    s.elevationDeg = closest["el"] | 0.0f;
    s.azimuthDeg = closest["az"] | 0;
    s.hasLook = true;
  }

  for (JsonObject item : doc["next"].as<JsonArray>()) {
    if (count >= MAX_SATS) break;
    Sat &s = sats[count++];
    strlcpy(s.name, item["n"] | "UNKNOWN", NAME_LEN);
    strlcpy(s.type, item["t"] | "generic", sizeof(s.type));
    s.rangeKm = item["r"] | 0;
    s.speedKmh = 0;
    s.elevationDeg = 0;
    s.azimuthDeg = 0;
    s.hasLook = false;
  }

  satCount = count;
  if (satIndex >= satCount) satIndex = 0;
  Serial.printf("Loaded %d satellites, closest: %s\n", satCount,
                satCount > 0 ? sats[0].name : "-");
}

void render() {
  matrix->clearScreen();

  if (satCount == 0) {
    drawText(1, 16, "NO DATA", 255, 80, 80);
    matrix->flipDMABuffer();
    return;
  }

  const Sat &sat = sats[satIndex];

  // Region 1: horizon + icon
  matrix->drawFastHLine(0, 15, PANEL_WIDTH, matrix->color565(40, 40, 60));
  drawIcon(sat);

  // Region 2: name, scrolled if it doesn't fit
  drawName(sat.name);

  // Region 3: stats
  char stat[STAT_LEN];
  formatStat(sat, stat, sizeof(stat));
  drawText(1, 24, stat, 120, 200, 255);

  matrix->flipDMABuffer();
}

void drawIcon(const Sat &sat) {
  // Satellites without look angles (the "next" entries) park on the horizon
  // at their azimuth-less default rather than claiming a false position.
  int x = sat.hasLook ? (int)round(sat.azimuthDeg / 360.0 * (PANEL_WIDTH - 1))
                      : PANEL_WIDTH / 2;
  int y = 15;
  if (sat.hasLook) {
    y = (int)round(15.0 - (sat.elevationDeg / 90.0) * 15.0);
    if (y < 0) y = 0;
    if (y > 15) y = 15;
  }

  const Icon &icon = iconFor(sat.type);
  uint16_t color = matrix->color565(icon.r, icon.g, icon.b);

  for (int row = 0; row < 3; row++) {
    for (int col = 0; col < 3; col++) {
      if (!(icon.rows[row] & (0b100 >> col))) continue;
      int px = x + col - 1;
      int py = y + row - 1;
      if (px < 0 || px >= PANEL_WIDTH || py < 0 || py > 15) continue;
      matrix->drawPixel(px, py, color);
    }
  }
}

void drawName(const char *rawName) {
  char name[NAME_LEN];
  strlcpy(name, rawName, NAME_LEN);
  for (char *p = name; *p; p++) *p = toupper(*p);

  int len = strlen(name);
  uint16_t white = matrix->color565(255, 255, 255);

  if (len <= VISIBLE_CHARS) {
    drawText(1, 16, name, 255, 255, 255);
    return;
  }

  int span = len * CHAR_W + SCROLL_GAP;
  int shift = scrollOffset % span;
  matrix->setTextColor(white);
  matrix->setCursor(-shift, 16);
  matrix->print(name);
  matrix->setCursor(-shift + span, 16);
  matrix->print(name);
}

void formatStat(const Sat &sat, char *out, size_t outLen) {
  if (!sat.hasLook) {
    snprintf(out, outLen, "R:%dKM", sat.rangeKm);
    return;
  }

  switch (statIndex) {
    case 0:
      snprintf(out, outLen, "R:%dKM", sat.rangeKm);
      break;
    case 1:
      snprintf(out, outLen, "S:%ldKMH", sat.speedKmh);
      break;
    default:
      snprintf(out, outLen, "EL:%d", (int)round(sat.elevationDeg));
      break;
  }
}

void drawText(int x, int y, const char *text, uint8_t r, uint8_t g, uint8_t b) {
  matrix->setTextColor(matrix->color565(r, g, b));
  matrix->setCursor(x, y);
  matrix->print(text);
}

void showMessage(const char *text) {
  matrix->clearScreen();
  drawText(1, 12, text, 255, 255, 255);
  matrix->flipDMABuffer();
}
