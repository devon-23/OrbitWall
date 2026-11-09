/* Checks the sketch's OW_BUILD geometry matrix resolves correctly.
 *
 * The block below is extracted verbatim from orbitwall_esp32.ino at build
 * time by scripts/check-geometry.mjs, so this file is never edited by hand.
 * An #if/#elif matrix that quietly yields the wrong DISPLAY_W is the sort of
 * mistake you only notice once the panel is on the wall.
 */
#include <stdio.h>
#define OW_BUILD OW_BUILD_UNDER_TEST
#include "geometry_block.h"

int main(void) {
  printf("%d %d %d %d %d %d\n", OW_BUILD, DISPLAY_W, DISPLAY_H, PANEL_CHAIN,
         PANEL_RES_Y, PIN_E);
  return 0;
}
