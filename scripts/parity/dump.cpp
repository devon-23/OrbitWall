// Renders cards with the firmware's own drawing code and dumps the
// framebuffer as text, so scripts/parity-check.mjs can diff it against what
// public/panel.js produces for the same input.
//
// Built and run by `npm test`; see scripts/parity-check.mjs.

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <vector>

#include "../../firmware/orbitwall_esp32/panel_draw.h"

struct Buffer {
  int cols, rows;
  std::vector<int> px; // -1 unlit, else 0xRRGGBB
};

static void plot(void *ctx, int x, int y, OwRgb c) {
  Buffer *b = (Buffer *)ctx;
  if (x < 0 || x >= b->cols || y < 0 || y >= b->rows) return;
  b->px[y * b->cols + x] = (c.r << 16) | (c.g << 8) | c.b;
}

// name|label|op|kind|emblem|fact|r,g,b|range|alt|speed|el|az|hasPass|passInMs
//   |cols|rows|thirdIndex|nameScroll|scroll
static void runCase(char *line) {
  char *save = nullptr;
  auto next = [&]() -> char * { return strtok_r(nullptr, "|", &save); };

  OwSat s;
  memset(&s, 0, sizeof(s));
  char *first = strtok_r(line, "|", &save);
  snprintf(s.name, sizeof(s.name), "%s", first);
  snprintf(s.label, sizeof(s.label), "%s", next());
  snprintf(s.op, sizeof(s.op), "%s", next());
  snprintf(s.kind, sizeof(s.kind), "%s", next());
  snprintf(s.emblem, sizeof(s.emblem), "%s", next());
  snprintf(s.fact, sizeof(s.fact), "%s", next());
  s.color.r = (uint8_t)atoi(next());
  s.color.g = (uint8_t)atoi(next());
  s.color.b = (uint8_t)atoi(next());
  s.rangeKm = atoi(next());
  s.altitudeKm = atoi(next());
  s.speedKmh = atol(next());
  s.elevationDeg = (float)atof(next());
  s.azimuthDeg = atoi(next());
  s.hasPass = atoi(next()) != 0;
  s.passInMs = atol(next());

  Buffer b;
  b.cols = atoi(next());
  b.rows = atoi(next());
  b.px.assign(b.cols * b.rows, -1);

  OwState st;
  st.thirdIndex = atoi(next());
  st.nameScrollOffset = atoi(next());
  st.scrollOffset = atoi(next());

  OwCanvas cv = {b.cols, b.rows, plot, &b};
  owRenderCard(cv, s, st);

  for (int y = 0; y < b.rows; y++) {
    for (int x = 0; x < b.cols; x++) {
      int v = b.px[y * b.cols + x];
      if (v < 0) printf(".");
      else printf("%06x", v);
      printf(x == b.cols - 1 ? "\n" : ",");
    }
  }
  printf("---\n");
}

int main() {
  char line[1024];
  while (fgets(line, sizeof(line), stdin)) {
    size_t n = strlen(line);
    while (n && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = '\0';
    if (n == 0) continue;
    runCase(line);
  }
  return 0;
}
