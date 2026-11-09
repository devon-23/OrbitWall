// Who is actually in orbit right now.
//
// The panel already knows what a satellite *is*; for the crewed stations it
// can also say who is aboard. Names come from Open Notify's astros.json,
// which reports every person in space and which craft they are on.
//
// Two cautions:
//   1. The feed carries no timestamp, so there is no way to tell how old the
//      roster it hands back actually is -- and as of this writing it returns
//      an Expedition 71 crew from 2024, which is wrong. `CREW_MAX_AGE_DAYS`
//      only bounds how long OUR cached copy is served without a successful
//      refresh; it cannot detect a frozen upstream. If the names on the wall
//      are wrong, pin them by hand with the env vars below.
//   2. Names are long and the panel line is 21 characters, so they are
//      abbreviated to an initial and a surname.
//
// Override either roster by hand, which also skips the feed entirely:
//   ISS_CREW="Jane Doe, John Roe" CSS_CREW="Li Cong" npm start

const fs = require('fs');
const path = require('path');
const { FACT_MAX_CHARS } = require('./facts');

const CREW_API_URL = process.env.CREW_API_URL || 'http://api.open-notify.org/astros.json';

// The crew changes on the order of months, so this is deliberately slow.
const REFRESH_MS = 6 * 60 * 60 * 1000;

// How long a cached roster may be served without a successful refresh. Past
// this, names are dropped: a board that says "Crewed since Nov 2000" beats
// one confidently naming someone who came home a year ago. This bounds our
// own cache only -- it says nothing about how fresh the feed's data was.
const MAX_AGE_DAYS = process.env.CREW_MAX_AGE_DAYS
  ? parseFloat(process.env.CREW_MAX_AGE_DAYS)
  : 120;

const CACHE_DIR = process.env.TLE_CACHE_DIR || path.join(__dirname, '..', '.tle-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'crew.json');

// Open Notify's `craft` strings mapped onto the profile ids in facts.js.
const CRAFT_TO_PROFILE = { ISS: 'iss', Tiangong: 'css' };

// profile id -> array of names. Starts empty; filled on first refresh.
let roster = {};
let fetchedAt = 0;
let dataAgeMs = 0;
let lastAttempt = 0;

// "Tracy Caldwell Dyson" -> "T. Dyson". Surnames with particles ("Vande
// Hei") lose the particle, which is the least-bad option at 21 characters.
function abbreviate(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function parseManual(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function readDisk() {
  try {
    const stat = fs.statSync(CACHE_FILE);
    return {
      data: JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')),
      ageMs: Date.now() - stat.mtimeMs
    };
  } catch {
    return null;
  }
}

function writeDisk(data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[crew] could not write cache:', err.message);
  }
}

// { people: [{ craft, name }] } -> { iss: [names], css: [names] }
function groupByCraft(payload) {
  const out = {};
  const people = Array.isArray(payload && payload.people) ? payload.people : [];
  for (const person of people) {
    const id = CRAFT_TO_PROFILE[person.craft];
    if (!id || !person.name) continue;
    if (!out[id]) out[id] = [];
    out[id].push(String(person.name));
  }
  return out;
}

function adopt(payload, ageMs = 0) {
  const grouped = groupByCraft(payload);
  if (Object.keys(grouped).length === 0) return false;
  roster = grouped;
  fetchedAt = Date.now();
  dataAgeMs = ageMs;
  return true;
}

// Brings the roster up to date if it is stale. Never throws and never blocks
// a satellite lookup for long — on any failure the board simply falls back to
// the static facts.
async function refreshCrew() {
  if (fetchedAt && Date.now() - fetchedAt < REFRESH_MS) return;

  // Don't hammer the feed if it is down; one attempt per refresh window.
  if (lastAttempt && Date.now() - lastAttempt < REFRESH_MS) return;

  const disk = readDisk();
  if (disk && disk.ageMs < REFRESH_MS && adopt(disk.data, disk.ageMs)) return;

  lastAttempt = Date.now();
  try {
    const res = await fetch(CREW_API_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`crew feed returned ${res.status}`);
    const payload = await res.json();
    if (!adopt(payload)) throw new Error('crew feed listed nobody aboard');
    writeDisk(payload);
    const names = Object.values(roster).reduce((n, list) => n + list.length, 0);
    console.log(`[crew] ${names} people aboard per ${CREW_API_URL}`);
  } catch (err) {
    if (disk && adopt(disk.data, disk.ageMs)) {
      console.error(`[crew] fetch failed (${err.message}); using cached roster`);
      return;
    }
    console.error(`[crew] unavailable (${err.message}); falling back to static facts`);
  }
}

// True when our cached copy is recent enough to put a name on the wall.
function trustworthy() {
  return dataAgeMs / 86400000 <= MAX_AGE_DAYS;
}

function namesFor(profileId) {
  const manual = profileId === 'iss' ? process.env.ISS_CREW
    : profileId === 'css' ? process.env.CSS_CREW
    : null;
  if (manual) return parseManual(manual);
  if (!trustworthy()) return [];
  return roster[profileId] || [];
}

// Extra fact lines for a crewed station: a head count, then one line per
// person so each gets its own turn in the rotation.
function crewFactsFor(profileId) {
  const names = namesFor(profileId);
  if (names.length === 0) return [];

  const facts = [`Crew of ${names.length} aboard`];
  for (const name of names) {
    facts.push(`Aboard: ${abbreviate(name)}`.slice(0, FACT_MAX_CHARS));
  }
  return facts;
}

// For the API payload, so the preview can show the roster verbatim.
function crewNamesFor(profileId) {
  return namesFor(profileId).concat([]);
}

module.exports = { refreshCrew, crewFactsFor, crewNamesFor, abbreviate, MAX_AGE_DAYS };
