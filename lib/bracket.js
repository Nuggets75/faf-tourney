// @ts-check
// Pure bracket math extracted from server.js: seeding order, power-of-two sizing,
// slot seeding, and best-of list validation. No application state, no `db`, no
// `_buildingDivision`, no cross-module calls - everything is passed in as an
// argument. Behaviour is identical to the previous in-server definitions.
//
// The stateful bracket builders (newMatch, buildSingle, buildDouble, routeVal,
// setSlot, evaluate, finalizeMatch, undoMatch, backfillMatchLinks) will move here
// in a later pass, together with the veto module, so the setSlot->evaluate->initVeto
// chain and the shared newMatch primitive can be wired without a circular import.
'use strict';

/** @typedef {{ id: string, seed: number, division?: number }} TeamSeed */

/** Valid best-of series lengths. */
const BO_OK = [1, 3, 5, 7];

/**
 * Standard single-elim seeding order for a bracket of size n (a power of two).
 * Returns 1-based seed positions, e.g. n=4 -> [1,4,3,2].
 * @param {number} n
 * @returns {number[]}
 */
function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const next = [];
    const m = order.length * 2;
    for (const s of order) { next.push(s); next.push(m + 1 - s); }
    order = next;
  }
  return order;
}

/**
 * Smallest power of two >= n (at least 1).
 * @param {number} n
 * @returns {number}
 */
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

/**
 * floor(log2(n)) via bit shifting; number of rounds for a pow2 bracket size.
 * @param {number} n
 * @returns {number}
 */
function log2i(n) { let r = 0; while ((1 << r) < n) r++; return r; }

/**
 * Seeded first-round slot ids for a tournament (optionally filtered to a division).
 * Empty slots are filled with 'BYE'.
 * @param {{ teams: TeamSeed[] }} t
 * @param {number} [division] 0 or undefined = all teams
 * @returns {string[]}
 */
function seededSlots(t, division) {
  let teams = t.teams.slice();
  if (division && division > 0) teams = teams.filter(x => (x.division || 0) === division);
  teams.sort((a, b) => a.seed - b.seed);
  const size = nextPow2(teams.length);
  return seedOrder(size).map(s => (s <= teams.length ? teams[s - 1].id : 'BYE'));
}

/**
 * Coerce an array of best-of values to a fixed length, defaulting invalid entries to 3.
 * @param {unknown} arr
 * @param {number} len
 * @returns {number[]}
 */
function cleanBoList(arr, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const v = parseInt(Array.isArray(arr) ? arr[i] : null, 10);
    out.push(BO_OK.indexOf(v) >= 0 ? v : 3);
  }
  return out;
}

module.exports = { BO_OK, seedOrder, nextPow2, log2i, seededSlots, cleanBoList };
