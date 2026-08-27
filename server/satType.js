// Classifies a satellite so both renderers agree on colour and emblem.
//
// The rules live in facts.js (one profile per kind of object); this module
// just maps a profile onto the small set of types the panel draws.

const { profileFor } = require('./facts');

// profile id -> panel type. Types are what the renderers switch on.
const TYPE_BY_PROFILE = {
  iss: 'station',
  css: 'station',
  hubble: 'science',
  chandra: 'science',
  starlink: 'comms',
  oneweb: 'comms',
  iridium: 'comms',
  gps: 'nav',
  weather: 'weather',
  earth: 'imaging',
  debris: 'debris',
  cubesat: 'cubesat',
  military: 'military',
  generic: 'generic'
};

// Shared palette, so the ESP32 sketch and the browser preview light the same
// colours. Keep in sync with docs/MATRIX_LAYOUT.md.
const TYPE_COLORS = {
  station: [255, 255, 255],
  comms: [0, 220, 220],
  weather: [60, 120, 255],
  science: [255, 200, 0],
  nav: [180, 130, 255],
  imaging: [0, 230, 120],
  debris: [255, 90, 60],
  cubesat: [255, 150, 220],
  military: [160, 170, 190],
  generic: [0, 230, 90]
};

function classify(name) {
  return TYPE_BY_PROFILE[profileFor(name).id] || 'generic';
}

function colorFor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS.generic;
}

module.exports = { classify, colorFor, TYPE_COLORS };
