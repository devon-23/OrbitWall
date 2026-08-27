// Next-pass prediction: when will this satellite next climb above the
// observer's horizon, and how high will it get?
//
// SGP4 has no closed form for "next time elevation > X", so this samples
// forward on a coarse grid and then bisects the crossing it finds. That is
// plenty accurate for a wall display (a second or two) and cheap enough to
// run for the one satellite currently on screen.

const satellite = require('satellite.js');

const COARSE_STEP_S = 30; // grid spacing when hunting for a crossing
const REFINE_ITERATIONS = 18; // bisection depth -> sub-second precision
const DEFAULT_HORIZON_DEG = 10; // below this a pass isn't really observable
const DEFAULT_SEARCH_HOURS = 36;

function elevationAt(satrec, observerGd, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, ecf);
  return (look.elevation * 180) / Math.PI;
}

// Bisects between a time known to be below the horizon and one known to be
// above it, returning the moment of crossing.
function refineCrossing(satrec, observerGd, belowMs, aboveMs, horizonDeg) {
  let lo = belowMs;
  let hi = aboveMs;
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const el = elevationAt(satrec, observerGd, new Date(mid));
    if (el === null) break;
    if (el >= horizonDeg) hi = mid;
    else lo = mid;
  }
  return hi;
}

// Returns { startMs, peakMs, endMs, peakElevationDeg, durationS } for the next
// pass above `horizonDeg`, or null if there isn't one in the search window.
function nextPass(satrec, observerGd, from = new Date(), options = {}) {
  const horizonDeg = options.horizonDeg ?? DEFAULT_HORIZON_DEG;
  const searchHours = options.searchHours ?? DEFAULT_SEARCH_HOURS;

  const startMs = from.getTime();
  const endMs = startMs + searchHours * 3600 * 1000;
  const stepMs = COARSE_STEP_S * 1000;

  let prevMs = startMs;
  let prevEl = elevationAt(satrec, observerGd, from);
  if (prevEl === null) return null;

  // If we're already mid-pass, report the pass in progress rather than
  // skipping to the next one.
  const alreadyUp = prevEl >= horizonDeg;

  for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
    const el = elevationAt(satrec, observerGd, new Date(t));
    if (el === null) continue;

    const rising = !alreadyUp && prevEl < horizonDeg && el >= horizonDeg;
    if (rising || (alreadyUp && t === startMs + stepMs)) {
      const riseMs = alreadyUp
        ? startMs
        : refineCrossing(satrec, observerGd, prevMs, t, horizonDeg);

      // Walk forward to find the peak and the set time.
      let peakMs = riseMs;
      let peakEl = horizonDeg;
      let lastAboveMs = riseMs;
      let setMs = null;

      for (let u = riseMs; u <= endMs; u += stepMs) {
        const e = elevationAt(satrec, observerGd, new Date(u));
        if (e === null) continue;
        if (e > peakEl) { peakEl = e; peakMs = u; }
        if (e < horizonDeg) {
          setMs = refineCrossing(satrec, observerGd, u, lastAboveMs, horizonDeg);
          break;
        }
        lastAboveMs = u;
      }

      if (setMs === null) setMs = lastAboveMs;

      return {
        startMs: Math.round(riseMs),
        peakMs: Math.round(peakMs),
        endMs: Math.round(setMs),
        peakElevationDeg: Math.round(peakEl * 10) / 10,
        durationS: Math.round((setMs - riseMs) / 1000),
        inProgress: alreadyUp
      };
    }

    prevMs = t;
    prevEl = el;
  }

  return null;
}

module.exports = { nextPass, elevationAt, DEFAULT_HORIZON_DEG };
