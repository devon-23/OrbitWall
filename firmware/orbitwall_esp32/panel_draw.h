// The panel renderer, in C++.
//
// This is a direct port of public/panel.js and implements the same spec,
// docs/MATRIX_LAYOUT.md. Deliberately free of Arduino types: the only way
// pixels leave here is the OwCanvas::plot callback, which lets the host
// compile it too. scripts/parity-check.mjs does exactly that and diffs the
// framebuffer against the browser's, so the two renderers cannot drift
// apart silently -- which is the failure this project is most prone to.
//
// If you change the layout: edit docs/MATRIX_LAYOUT.md first, then
// public/panel.js, then this file, then run `npm test`.

#pragma once
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#include "panel_assets.h"

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

typedef void (*OwPlotFn)(void *ctx, int x, int y, OwRgb color);

struct OwCanvas {
  int cols;
  int rows;
  OwPlotFn plotFn;
  void *ctx;

  bool wide() const { return cols >= 128; }

  void plot(int x, int y, OwRgb c) const {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    plotFn(ctx, x, y, c);
  }
};

// A clip rectangle, inclusive on all sides.
struct OwBox {
  int x0, y0, x1, y1;
};

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// Mirrors textWidth() in public/font.js: n glyphs of OW_CHAR_W, minus the
// trailing column of spacing.
inline int owTextWidth(const char *s) {
  int n = (int)strlen(s);
  return n == 0 ? 0 : n * OW_CHAR_W - 1;
}

// Our strings carry the degree sign as UTF-8 (0xC2 0xB0). Walking the string
// by byte would draw two wrong glyphs, so decode it to the font's own slot.
// Returns the glyph index and advances `i` past the character.
inline int owNextGlyph(const char *s, int &i) {
  unsigned char c = (unsigned char)s[i];
  if (c == 0xC2 && (unsigned char)s[i + 1] == 0xB0) {
    i += 2;
    return OW_FONT_DEGREE;
  }
  i += 1;
  if (c < OW_FONT_FIRST || c > OW_FONT_LAST) return '?' - OW_FONT_FIRST;
  return c - OW_FONT_FIRST;
}

// Number of drawable characters, counting a UTF-8 degree sign as one.
inline int owGlyphCount(const char *s) {
  int n = 0;
  for (int i = 0; s[i];) {
    owNextGlyph(s, i);
    n++;
  }
  return n;
}

inline int owTextWidthUtf8(const char *s) {
  int n = owGlyphCount(s);
  return n == 0 ? 0 : n * OW_CHAR_W - 1;
}

// Draws `s` with its top-left at (x, y), clipped to `box`.
inline void owDrawText(const OwCanvas &cv, int x, int y, const char *s,
                       OwRgb color, const OwBox &box) {
  int cursor = x;
  for (int i = 0; s[i];) {
    int glyph = owNextGlyph(s, i);
    const uint8_t *cols = &OW_FONT[glyph * 5];
    for (int col = 0; col < 5; col++) {
      uint8_t bits = pgm_read_byte(cols + col);
      for (int row = 0; row < OW_CHAR_H; row++) {
        if (!(bits & (1 << row))) continue;
        int px = cursor + col;
        int py = y + row;
        if (px < box.x0 || px > box.x1 || py < box.y0 || py > box.y1) continue;
        cv.plot(px, py, color);
      }
    }
    cursor += OW_CHAR_W;
  }
}

// Mirrors fit() in public/font.js: truncate to `maxPx`, marking the cut with
// a trailing period. Writes into `out`.
inline void owFit(const char *s, int maxPx, char *out, size_t outLen) {
  if (owTextWidthUtf8(s) <= maxPx) {
    snprintf(out, outLen, "%s", s);
    return;
  }
  int n = (maxPx + 1) / OW_CHAR_W;
  if (n <= 0) {
    out[0] = '\0';
    return;
  }
  // Keep n-1 characters, counting a two-byte degree sign as one.
  int want = n - 1;
  int i = 0, kept = 0;
  while (s[i] && kept < want) {
    owNextGlyph(s, i);
    kept++;
  }
  size_t len = (size_t)i;
  if (len > outLen - 2) len = outLen - 2;
  memcpy(out, s, len);
  out[len] = '.';
  out[len + 1] = '\0';
}

// A marquee that only moves when the text genuinely does not fit.
inline void owScrollText(const OwCanvas &cv, int x, int y, const char *s,
                         OwRgb color, const OwBox &box, int offset) {
  int avail = box.x1 - box.x0 + 1;
  int w = owTextWidthUtf8(s);
  if (w <= avail) {
    owDrawText(cv, x, y, s, color, box);
    return;
  }
  int span = w + OW_CHAR_W * 2;
  int shift = ((offset % span) + span) % span;
  owDrawText(cv, box.x0 - shift, y, s, color, box);
  owDrawText(cv, box.x0 - shift + span, y, s, color, box);
}

// ---------------------------------------------------------------------------
// Emblems
// ---------------------------------------------------------------------------

inline int owEmblemIndex(const char *name) {
  for (int i = 0; i < OW_EMBLEM_COUNT; i++) {
    if (strcmp(OW_EMBLEM_NAMES[i], name) == 0) return i;
  }
  for (int i = 0; i < OW_EMBLEM_COUNT; i++) {
    if (strcmp(OW_EMBLEM_NAMES[i], "generic") == 0) return i;
  }
  return 0;
}

inline void owDrawEmblem(const OwCanvas &cv, const char *name, int ox, int oy) {
  int idx = owEmblemIndex(name);
  for (int y = 0; y < OW_EMBLEM_SIZE; y++) {
    for (int x = 0; x < OW_EMBLEM_SIZE; x++) {
      uint8_t p = pgm_read_byte(&OW_EMBLEMS[idx][y * OW_EMBLEM_SIZE + x]);
      if (p == 0) continue;
      cv.plot(ox + x, oy + y, OW_PALETTE[p]);
    }
  }
}

// Nearest-neighbour downsample, for the compact board's 14px block.
inline void owDrawEmblemScaled(const OwCanvas &cv, const char *name, int ox,
                               int oy, int size) {
  int idx = owEmblemIndex(name);
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      int sx = (x * OW_EMBLEM_SIZE) / size;
      int sy = (y * OW_EMBLEM_SIZE) / size;
      uint8_t p = pgm_read_byte(&OW_EMBLEMS[idx][sy * OW_EMBLEM_SIZE + sx]);
      if (p == 0) continue;
      cv.plot(ox + x, oy + y, OW_PALETTE[p]);
    }
  }
}

// ---------------------------------------------------------------------------
// One satellite's card
// ---------------------------------------------------------------------------

struct OwSat {
  char name[40];
  char label[24];
  char op[24];
  char kind[24];
  char emblem[16];
  char fact[24];
  OwRgb color;

  int rangeKm;
  int altitudeKm;
  long speedKmh;
  float elevationDeg;
  int azimuthDeg;

  bool hasPass;
  long passInMs;  // ms until the next pass, negative once it has started
};

struct OwState {
  int thirdIndex;       // which stop the bottom line is on
  int nameScrollOffset; // name marquee position, in pixels
  int scrollOffset;     // compact board's fact marquee
};

// ---------------------------------------------------------------------------
// Formatting -- each of these mirrors a helper in public/panel.js
// ---------------------------------------------------------------------------

inline void owFormatSpeed(long kmh, char *out, size_t n) {
  if (kmh == 0) {
    snprintf(out, n, "--");
    return;
  }
  // (kmh / 1000).toFixed(1) in JS. Both sides are doing the arithmetic on
  // the same IEEE754 double, so printf rounds where toFixed rounds; integer
  // arithmetic here would disagree on values like 27650.
  if (kmh >= 10000) snprintf(out, n, "%.1fk", (double)kmh / 1000.0);
  else snprintf(out, n, "%ld", kmh);
}

inline void owFormatRange(int km, char *out, size_t n) {
  if (km >= 10000) snprintf(out, n, "%.1fMm", (double)km / 1000.0);
  else snprintf(out, n, "%dkm", km);
}

inline void owFormatCountdown(const OwSat &sat, char *out, size_t n) {
  if (!sat.hasPass) {
    snprintf(out, n, "no pass in 36h");
    return;
  }
  if (sat.passInMs <= 0) {
    snprintf(out, n, "overhead now");
    return;
  }
  long s = (sat.passInMs + 500) / 1000;
  long h = s / 3600;
  long m = (s % 3600) / 60;
  if (h > 0) snprintf(out, n, "in %ldh%02ldm", h, m);
  else snprintf(out, n, "in %ldm%02lds", m, s % 60);
}

inline const char *owCompass(int az) {
  static const char *points[8] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
  int i = (int)lround(az / 45.0) % 8;
  return points[i < 0 ? i + 8 : i];
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// `left` against the left margin, `right` flush to the right edge. The left
// field is the one that gets truncated; see the note in panel.js.
inline void owStatRow(const OwCanvas &cv, int y, const char *left,
                      const char *right, const OwBox &box, OwRgb color) {
  int rightX = box.x1 - owTextWidthUtf8(right) + 1;
  int leftMax = rightX - OW_CHAR_W - box.x0;
  if (leftMax > 0) {
    char buf[48];
    owFit(left, leftMax, buf, sizeof(buf));
    owDrawText(cv, box.x0, y, buf, color, box);
  }
  owDrawText(cv, rightX, y, right, color, box);
}

// The bottom line's current stop: fact, then next pass when there is one,
// then the kind in its type colour.
inline void owThirdLine(const OwSat &sat, const OwState &st, char *out,
                        size_t n, OwRgb *color) {
  int stops = 1 + (sat.hasPass ? 1 : 0) + (sat.kind[0] ? 1 : 0);
  int pick = st.thirdIndex % stops;
  if (pick < 0) pick += stops;

  int at = 0;
  if (pick == at++) {
    snprintf(out, n, "%s", sat.fact);
    *color = OW_COL_FACT;
    return;
  }
  if (sat.hasPass && pick == at++) {
    char cd[24];
    owFormatCountdown(sat, cd, sizeof(cd));
    snprintf(out, n, "Next pass %s", cd);
    *color = OW_COL_FACT;
    return;
  }
  snprintf(out, n, "%s", sat.kind);
  *color = sat.color;
}

// Six rows along the bottom: horizon, compass ticks, and where to look.
inline void owDrawSkyStrip(const OwCanvas &cv, const OwSat &sat, int top,
                           int bottom) {
  int baseline = bottom;
  for (int x = 0; x <= cv.cols - 1; x += 2) cv.plot(x, baseline, OW_COL_HORIZON);

  for (int i = 0; i < 4; i++) {
    int x = (int)lround((i / 4.0) * cv.cols);
    cv.plot(x < cv.cols - 1 ? x : cv.cols - 1, baseline - 1, OW_COL_TICK);
  }

  int span = baseline - top;
  int x = (int)lround((sat.azimuthDeg / 360.0) * (cv.cols - 1));
  float clamped = sat.elevationDeg < 0 ? 0 : (sat.elevationDeg > 90 ? 90 : sat.elevationDeg);
  int y = baseline - (int)lround((clamped / 90.0) * span);

  OwRgb color = sat.elevationDeg < 0 ? OW_COL_DIM : sat.color;
  cv.plot(x, y, color);
  cv.plot(x - 1, y, color);
  cv.plot(x + 1, y, color);
  cv.plot(x, y - 1, color);
  cv.plot(x, y + 1, color);
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

inline void owRenderWide(const OwCanvas &cv, const OwSat &sat, const OwState &st) {
  const int emblemX = 2, emblemY = 2;
  owDrawEmblem(cv, sat.emblem, emblemX, emblemY);

  const int colX = emblemX + OW_EMBLEM_SIZE + 3; // 29
  OwBox colBox = {colX, 0, cv.cols - 2, 27};
  int identWidth = colBox.x1 - colBox.x0;

  // Only the name can overflow, so only the name marquees. Its box starts at
  // colX, so it can never slide over the emblem.
  OwBox nameBox = {colX, 0, cv.cols - 2, 9};
  owScrollText(cv, colX, 2, sat.name, OW_COL_LABEL, nameBox, st.nameScrollOffset);

  char buf[64];
  owFit(sat.label, identWidth, buf, sizeof(buf));
  owDrawText(cv, colX, 11, buf, OW_COL_OPERATOR, colBox);
  owFit(sat.op, identWidth, buf, sizeof(buf));
  owDrawText(cv, colX, 20, buf, sat.color, colBox);

  for (int x = 0; x < cv.cols; x++) cv.plot(x, 29, OW_COL_DIVIDER);

  OwBox wideBox = {1, 31, cv.cols - 2, 56};

  char left[48], right[48], tmp[32];
  snprintf(left, sizeof(left), "Alt:%dkm", sat.altitudeKm);
  owFormatSpeed(sat.speedKmh, tmp, sizeof(tmp));
  snprintf(right, sizeof(right), "Spd:%s", tmp);
  owStatRow(cv, 31, left, right, wideBox, OW_COL_STAT);

  if (sat.elevationDeg >= 0) {
    snprintf(left, sizeof(left), "El:%d°", (int)lround(sat.elevationDeg));
    snprintf(right, sizeof(right), "Az:%d° %s", sat.azimuthDeg, owCompass(sat.azimuthDeg));
  } else {
    snprintf(left, sizeof(left), "Below horizon");
    owFormatRange(sat.rangeKm, right, sizeof(right));
  }
  owStatRow(cv, 40, left, right, wideBox, OW_COL_STAT);

  char third[64];
  OwRgb thirdColor;
  owThirdLine(sat, st, third, sizeof(third), &thirdColor);
  owFit(third, cv.cols - 2, buf, sizeof(buf));
  owDrawText(cv, 1, 49, buf, thirdColor, wideBox);

  owDrawSkyStrip(cv, sat, 58, cv.rows - 1);
}

inline void owRenderCompact(const OwCanvas &cv, const OwSat &sat, const OwState &st) {
  const int size = 14;
  owDrawEmblemScaled(cv, sat.emblem, 0, 1, size);

  const int colX = size + 2;
  OwBox idBox = {colX, 0, cv.cols - 1, 15};
  char buf[64];
  owFit(sat.label, cv.cols - colX, buf, sizeof(buf));
  owDrawText(cv, colX, 1, buf, OW_COL_LABEL, idBox);
  owFit(sat.kind, cv.cols - colX, buf, sizeof(buf));
  owDrawText(cv, colX, 9, buf, sat.color, idBox);

  OwBox statBox = {0, 16, cv.cols - 1, 23};
  char stat[32], rng[24];
  owFormatRange(sat.rangeKm, rng, sizeof(rng));
  if (sat.elevationDeg >= 0) snprintf(stat, sizeof(stat), "El%d %s", (int)lround(sat.elevationDeg), rng);
  else snprintf(stat, sizeof(stat), "%s", rng);
  owFit(stat, cv.cols - 2, buf, sizeof(buf));
  owDrawText(cv, 1, 16, buf, OW_COL_STAT, statBox);

  OwBox factBox = {0, 24, cv.cols - 1, 31};
  bool showPass = (st.thirdIndex % 2 + 2) % 2 == 1;
  char third[64];
  if (showPass && sat.hasPass) {
    char cd[24];
    owFormatCountdown(sat, cd, sizeof(cd));
    snprintf(third, sizeof(third), "Pass %s", cd);
  } else {
    snprintf(third, sizeof(third), "%s", sat.fact);
  }
  owScrollText(cv, 0, 24, third, OW_COL_FACT, factBox, st.scrollOffset);
}

inline void owRenderCard(const OwCanvas &cv, const OwSat &sat, const OwState &st) {
  if (cv.wide()) owRenderWide(cv, sat, st);
  else owRenderCompact(cv, sat, st);
}

inline void owRenderMessage(const OwCanvas &cv, const char *msg, OwRgb color) {
  int y = (cv.rows - OW_CHAR_H) / 2;
  int w = owTextWidthUtf8(msg);
  int x = (cv.cols - w) / 2;
  if (x < 1) x = 1;
  OwBox box = {0, 0, cv.cols - 1, cv.rows - 1};
  owDrawText(cv, x, y, msg, color, box);
}
