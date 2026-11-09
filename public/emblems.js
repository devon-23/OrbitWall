// Pixel-art emblems drawn in the panel's logo block, the way FlightWall draws
// an airline tail. Authored at 24x24; the renderer centres them in whatever
// block the current layout gives it.
//
// Each row is one string. '.' is transparent, every other character indexes
// PALETTE. Rows must all be EMBLEM_SIZE characters wide — assertEmblems()
// checks that, and the test script runs it.

export const EMBLEM_SIZE = 24;

const PALETTE = {
  W: [235, 240, 255], // structure, white
  G: [120, 132, 155], // truss / grey metal
  D: [60, 68, 86],    // shadowed metal
  Y: [255, 190, 40],  // solar array, gold
  A: [180, 130, 30],  // solar array, shaded
  B: [60, 130, 255],  // blue optics / Earth
  C: [0, 220, 220],   // cyan comms
  R: [255, 90, 60],   // hot / warning
  O: [255, 150, 60],  // orange
  P: [190, 140, 255], // violet
  N: [30, 60, 140]    // deep blue
};

export const EMBLEMS = {
  // International Space Station: long truss, four gold array pairs, modules.
  iss: [
    '........................',
    '..YYYY..........YYYY....',
    '..YYYY..........YYYY....',
    '..AAAA..........AAAA....',
    '..YYYY..........YYYY....',
    '..YYYY..........YYYY....',
    '.....G..........G.......',
    '.....G..........G.......',
    '..YYYY..........YYYY....',
    '..YYYY..........YYYY....',
    '..AAAA..........AAAA....',
    '.GGGGGGGGGGGGGGGGGGGGG..',
    '.....G..WWWWWW..G.......',
    '.....G.WWWWWWWW.G.......',
    '..YYYY.WWDDDDWW.YYYY....',
    '..YYYY.WWWWWWWW.YYYY....',
    '..AAAA..WWWWWW..AAAA....',
    '..YYYY..........YYYY....',
    '.....G..........G.......',
    '.....G..........G.......',
    '..YYYY..........YYYY....',
    '..AAAA..........AAAA....',
    '..YYYY..........YYYY....',
    '........................'
  ],

  // Tiangong: T-shaped core with two arrays.
  station: [
    '........................',
    '........................',
    '...YYYY..........YYYY...',
    '...YYYY..........YYYY...',
    '...AAAA..........AAAA...',
    '...YYYY..........YYYY...',
    '...YYYY..........YYYY...',
    '......G..........G......',
    '......GGWWWWWWWWGG......',
    '........WWWWWWWW........',
    '........WWDDDDWW........',
    '........WWDDDDWW........',
    '........WWWWWWWW........',
    '........WWWWWWWW........',
    '..........WWWW..........',
    '..........WWWW..........',
    '.........WWWWWW.........',
    '.........WWWWWW.........',
    '..........WWWW..........',
    '..........WWWW..........',
    '...........WW...........',
    '...........WW...........',
    '........................',
    '........................'
  ],

  // Hubble and friends: an open telescope tube with solar wings.
  telescope: [
    '........................',
    '........................',
    '.......WWWWWWWWWW.......',
    '......WWWWWWWWWWWW......',
    '.....WWBBBBBBBBBBWW.....',
    '.....WBBBBBBBBBBBBW.....',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.AAAAWBBNNNNNNNNBBWAAAA.',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.AAAAWBBNNNNNNNNBBWAAAA.',
    '.YYYYWBBNNNNNNNNBBWYYYY.',
    '.YYYYWBBBBBBBBBBBBWYYYY.',
    '.....WBBBBBBBBBBBBW.....',
    '.....WWBBBBBBBBBBWW.....',
    '......WWWWWWWWWWWW......',
    '.......WWWWWWWWWW.......',
    '.........WWWWWW.........',
    '.........W....W.........',
    '.........WWWWWW.........',
    '........................',
    '........................'
  ],

  // Starlink: flat panel bus with one long array.
  flatsat: [
    '........................',
    '........................',
    '........................',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....AAAAAAAAAAAAAAAA....',
    '....YYYYYYYYYYYYYYYY....',
    '....YYYYYYYYYYYYYYYY....',
    '....AAAAAAAAAAAAAAAA....',
    '....YYYYYYYYYYYYYYYY....',
    '..........GG............',
    '..........GG............',
    '....WWWWWWWWWWWWWWWW....',
    '....WWDDDDDDDDDDDDWW....',
    '....WWDDDDDDDDDDDDWW....',
    '....WWWWWWWWWWWWWWWW....',
    '.......CC......CC.......',
    '......CCCC....CCCC......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ],

  // Classic comsat: box bus, dish, two arrays.
  comsat: [
    '........................',
    '........................',
    '..........CC............',
    '.........CCCC...........',
    '........CCCCCC..........',
    '.......CC....CC.........',
    '.......C......C.........',
    '.......CC....CC.........',
    '........CCCCCC..........',
    '..........GG............',
    '..........GG............',
    '.YYYY...WWWWWWWW...YYYY.',
    '.YYYY...WWWWWWWW...YYYY.',
    '.AAAAGGGWWDDDDWWGGGAAAA.',
    '.YYYY...WWDDDDWW...YYYY.',
    '.YYYY...WWWWWWWW...YYYY.',
    '.AAAA...WWWWWWWW...AAAA.',
    '.YYYY..............YYYY.',
    '..........GG............',
    '.........GGGG...........',
    '........................',
    '........................',
    '........................',
    '........................'
  ],

  // Weather bird: big scanning drum over a bus.
  weather: [
    '........................',
    '........................',
    '.......BBBBBBBBBB.......',
    '......BBWWWWWWWWBB......',
    '.....BBWWWWWWWWWWBB.....',
    '.....BWWWWWWWWWWWWB.....',
    '.....BWWWWOOOOWWWWB.....',
    '.....BWWWOOOOOOWWWB.....',
    '.....BWWWOOOOOOWWWB.....',
    '.....BWWWWOOOOWWWWB.....',
    '.....BWWWWWWWWWWWWB.....',
    '.....BBWWWWWWWWWWBB.....',
    '......BBWWWWWWWWBB......',
    '.......BBBBBBBBBB.......',
    '..........GG............',
    '.YYYYYYYYYGGGYYYYYYYYY..',
    '.YYYYYYYYYGGGYYYYYYYYY..',
    '.AAAAAAAAAGGGAAAAAAAAA..',
    '.YYYYYYYYYGGGYYYYYYYYY..',
    '.YYYYYYYYYGGGYYYYYYYYY..',
    '........................',
    '........................',
    '........................',
    '........................'
  ],

  // Earth observer: bus above a limb of the planet, camera pointed down.
  earthobs: [
    '........................',
    '..YYYY............YYYY..',
    '..YYYY............YYYY..',
    '..AAAA............AAAA..',
    '..YYYY............YYYY..',
    '..YYYYGGG....GGGGGYYYY..',
    '..AAAA............AAAA..',
    '.........WWWWWW.........',
    '.........WWWWWW.........',
    '........WWWWWWWW........',
    '........WWDDDDWW........',
    '........WWWWWWWW........',
    '..........BB............',
    '..........BB............',
    '.........BBBB...........',
    '....NNNNNNNNNNNNNN......',
    '..NNNBBBBBBBBBBBBNNN....',
    '.NNBBBBGGGGGGBBBBBBNN...',
    '.NBBBBGGGGGGGGGBBBBBN...',
    '.NBBBGGGGBBBBGGGGBBBN...',
    '.NNBBBBBBBBBBBBBBBBNN...',
    '..NNNBBBBBBBBBBBBNNN....',
    '....NNNNNNNNNNNNNN......',
    '........................'
  ],

  // Space junk: a tumbling spent rocket stage.
  debris: [
    '........................',
    '........................',
    '..............RR........',
    '.............RRRR.......',
    '..........DDDDDDDD......',
    '.........DDGGGGGGDD.....',
    '........DDGGGGGGGGDD....',
    '.......DDGGGGGGGGGGD....',
    '......DDGGGGGGGGGGD.....',
    '.....DDGGGGGGGGGGD......',
    '....DDGGGGGGGGGGD.......',
    '...DDGGGGGGGGGGD........',
    '...DGGGGGGGGGGD.........',
    '...DDGGGGGGGGD..........',
    '....DDDDDDDDD...........',
    '......RR................',
    '.....RRRR...............',
    '......RR.....D..........',
    '............DDD.........',
    '.............D..........',
    '.....D..................',
    '....DDD.................',
    '.....D..................',
    '........................'
  ],

  // CubeSat: a little cube with a stubby antenna.
  cubesat: [
    '........................',
    '........................',
    '........................',
    '..............W.........',
    '.............W..........',
    '............W...........',
    '.......WWWWWWWWWW.......',
    '......WWWWWWWWWWWW......',
    '.....WWDDDDDDDDDDWW.....',
    '.....WDDYYYYYYYYDDW.....',
    '.....WDDYYYYYYYYDDW.....',
    '.....WDDYYAAAAYYDDW.....',
    '.....WDDYYAAAAYYDDW.....',
    '.....WDDYYYYYYYYDDW.....',
    '.....WDDYYYYYYYYDDW.....',
    '.....WWDDDDDDDDDDWW.....',
    '......WWWWWWWWWWWW......',
    '.......WWWWWWWWWW.......',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................'
  ],

  // Anything unrecognised: a plain satellite silhouette.
  generic: [
    '........................',
    '........................',
    '........................',
    '..YYYY..........YYYY....',
    '..YYYY..........YYYY....',
    '..AAAA..........AAAA....',
    '..YYYY..........YYYY....',
    '..YYYY..........YYYY....',
    '..AAAA..........AAAA....',
    '..YYYYGG......GGYYYY....',
    '..........GG............',
    '......WWWWWWWWWW........',
    '......WWWWWWWWWW........',
    '......WWDDDDDDWW........',
    '......WWDDDDDDWW........',
    '......WWWWWWWWWW........',
    '......WWWWWWWWWW........',
    '..........GG............',
    '.........CCCC...........',
    '........CC..CC..........',
    '........................',
    '........................',
    '........................',
    '........................'
  ]
};

// Fails loudly at load time if any emblem is ragged, which would silently
// shear the artwork instead of showing an obvious error.
export function assertEmblems() {
  const problems = [];
  for (const [name, rows] of Object.entries(EMBLEMS)) {
    if (rows.length !== EMBLEM_SIZE) {
      problems.push(`${name}: ${rows.length} rows, expected ${EMBLEM_SIZE}`);
    }
    rows.forEach((row, i) => {
      if (row.length !== EMBLEM_SIZE) {
        problems.push(`${name} row ${i}: ${row.length} cols, expected ${EMBLEM_SIZE}`);
      }
      for (const ch of row) {
        if (ch !== '.' && !PALETTE[ch]) problems.push(`${name} row ${i}: unknown colour '${ch}'`);
      }
    });
  }
  return problems;
}

export function emblemFor(name) {
  return EMBLEMS[name] || EMBLEMS.generic;
}

// Calls plot(x, y, [r,g,b]) for each lit pixel of the emblem, scaled by
// `scale` and offset to (ox, oy).
export function drawEmblem(name, ox, oy, scale, plot) {
  const rows = emblemFor(name);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const color = PALETTE[rows[y][x]];
      if (!color) continue;
      if (scale === 1) {
        plot(ox + x, oy + y, color);
        continue;
      }
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) plot(ox + x * scale + dx, oy + y * scale + dy, color);
      }
    }
  }
}

// Downsamples the 24x24 art to `size` px by sampling the nearest source
// pixel, for the compact layout where only ~14px are available.
export function drawEmblemScaled(name, ox, oy, size, plot) {
  const rows = emblemFor(name);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * EMBLEM_SIZE) / size);
      const sy = Math.floor((y * EMBLEM_SIZE) / size);
      const color = PALETTE[rows[sy][sx]];
      if (color) plot(ox + x, oy + y, color);
    }
  }
}

export { PALETTE };
