// What the display knows about a satellite beyond its orbit: a short label
// that fits the panel, which emblem to draw, and rotating trivia lines.
//
// Facts are written to fit one full-width line on the 128-wide panel, which
// is 21 characters. `npm test` fails the build if any of them overflow.

const FACT_MAX_CHARS = 21;

// First match wins, so put specific patterns above general ones.
const PROFILES = [
  {
    id: 'iss',
    match: /ISS \(ZARYA\)|^ISS$|ZARYA/i,
    label: 'ISS',
    operator: 'NASA/Roscosmos',
    kind: 'Space Station',
    emblem: 'iss',
    facts: [
      'Crewed since Nov 2000',
      'Big as a soccer field',
      'Laps Earth in 92 min',
      '16 sunrises per day',
      'Cost ~$150 billion',
      'Brightest star-like'
    ]
  },
  {
    id: 'css',
    match: /TIANHE|TIANGONG|\bCSS\b/i,
    label: 'Tiangong',
    operator: 'CMSA (China)',
    kind: 'Space Station',
    emblem: 'station',
    facts: [
      'China\'s space station',
      'Core module flew 2021',
      'T-shaped, 3 modules',
      'Crew of three aboard'
    ]
  },
  {
    id: 'hubble',
    match: /\bHST\b|HUBBLE/i,
    label: 'Hubble',
    operator: 'NASA / ESA',
    kind: 'Observatory',
    emblem: 'telescope',
    facts: [
      'Launched April 1990',
      '2.4m primary mirror',
      'Crew fixed it 5 times',
      'Looks 13 billion yrs',
      'Blurry until 1993 fix'
    ]
  },
  {
    id: 'chandra',
    match: /CHANDRA|\bXMM\b|SWIFT|FERMI|NUSTAR|\bIXPE\b/i,
    label: 'X-ray Scope',
    operator: 'NASA / ESA',
    kind: 'Observatory',
    emblem: 'telescope',
    facts: [
      'Sees in X-ray light',
      'Hunts black holes',
      'Sees what eyes cannot',
      'Catches gamma bursts'
    ]
  },
  {
    id: 'starlink',
    match: /STARLINK/i,
    label: 'Starlink',
    operator: 'SpaceX',
    kind: 'Comms',
    emblem: 'flatsat',
    facts: [
      'One of 7000+ up there',
      'Flies about 550km up',
      'Beams internet down',
      'Deorbits in ~5 years',
      'Flies 20+ per launch'
    ]
  },
  {
    id: 'oneweb',
    match: /ONEWEB/i,
    label: 'OneWeb',
    operator: 'Eutelsat OneWeb',
    kind: 'Comms',
    emblem: 'flatsat',
    facts: [
      'Broadband from 1200km',
      'Rival to Starlink',
      'About 650 in orbit'
    ]
  },
  {
    id: 'iridium',
    match: /IRIDIUM/i,
    label: 'Iridium',
    operator: 'Iridium Comms',
    kind: 'Comms',
    emblem: 'comsat',
    facts: [
      'Sat-phone network',
      'Famous bright flares',
      'Covers whole planet'
    ]
  },
  {
    id: 'gps',
    match: /NAVSTAR|\bGPS\b|GLONASS|GALILEO|BEIDOU|COSMOS 2\d{3}\b.*GLONASS/i,
    label: 'Navigation',
    operator: 'GNSS',
    kind: 'Navigation',
    emblem: 'comsat',
    facts: [
      'Your phone maps you',
      'Has an atomic clock',
      'Orbits 20200km up',
      'Relativity bends time'
    ]
  },
  {
    id: 'weather',
    match: /NOAA|GOES|METEOSAT|METEOR|METOP|FENGYUN|HIMAWARI|\bDMSP\b/i,
    label: 'Weather',
    operator: 'Met agency',
    kind: 'Weather',
    emblem: 'weather',
    facts: [
      'Shoots the forecast',
      'Spots hurricanes',
      'Images Earth /10min',
      'Feeds weather apps'
    ]
  },
  {
    id: 'earth',
    match: /LANDSAT|SENTINEL|TERRA|AQUA|AURA|ICESAT|SMAP|JASON|CALIPSO|WORLDVIEW|PLANET|SPOT|\bPLEIADES\b/i,
    label: 'Earth Watch',
    operator: 'Earth science',
    kind: 'Imaging',
    emblem: 'earthobs',
    facts: [
      'Photographs Earth',
      'Tracks ice + forests',
      'Measures sea level',
      'Sees in infrared too'
    ]
  },
  {
    id: 'debris',
    match: /R\/B|DEB\b|DEBRIS|COSMOS \d+ COOLANT/i,
    label: 'Space Junk',
    operator: 'Nobody',
    kind: 'Debris',
    emblem: 'debris',
    facts: [
      'Dead rocket stage',
      '30000+ tracked bits',
      'Moves at 7.8 km/s',
      'Nobody is flying this',
      'Will burn up someday'
    ]
  },
  {
    id: 'cubesat',
    match: /CUBESAT|\bCUBE\b|\bSATL\b|\bBIRDS\b|\bTUBSAT\b/i,
    label: 'CubeSat',
    operator: 'University',
    kind: 'CubeSat',
    emblem: 'cubesat',
    facts: [
      'Fits in a shoebox',
      'Built by students',
      '10cm cube, 1.3kg'
    ]
  },
  {
    id: 'military',
    match: /\bUSA \d+|\bNROL|COSMOS \d+/i,
    label: 'Classified',
    operator: 'Undisclosed',
    kind: 'Military',
    emblem: 'comsat',
    facts: [
      'Purpose not published',
      'Tracked by hobbyists',
      'Orbit is public'
    ]
  }
];

const DEFAULT_PROFILE = {
  id: 'generic',
  label: 'Satellite',
  operator: 'Unknown',
  kind: 'Payload',
  emblem: 'generic',
  facts: [
    'One of 30000+ tracked',
    'Falls around Earth',
    'Orbits at ~7.7 km/s',
    'Sunlit, looks starry'
  ]
};

// Generic facts appended to every satellite so even unknown objects rotate
// through something interesting.
const UNIVERSAL_FACTS = [
  'Orbit decays daily',
  'Falling, not floating',
  'Circles Earth 15x/day'
];

function profileFor(name) {
  for (const profile of PROFILES) {
    if (profile.match.test(name)) return profile;
  }
  return DEFAULT_PROFILE;
}

// A stable rotating fact: same satellite always cycles the same order, and
// `spin` advances it so the panel can change the line over time.
function factFor(name, spin = 0) {
  const profile = profileFor(name);
  const pool = profile.facts.concat(UNIVERSAL_FACTS);
  return pool[Math.abs(spin) % pool.length];
}

module.exports = { profileFor, factFor, PROFILES, DEFAULT_PROFILE, UNIVERSAL_FACTS, FACT_MAX_CHARS };
