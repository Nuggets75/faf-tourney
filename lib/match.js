// NOTE: not yet `// @ts-check`. Unlike util.js/bracket.js this file operates on
// large, dynamically-shaped tournament/match objects that have no type definitions
// yet. It will be opted into type-checking in a later pass once a Tournament/Match
// typedef exists. Behaviour is verified by the runtime test suite for now.
// Match + veto subsystem, extracted from server.js. This is one cohesive unit:
// the bracket match core (create/route/evaluate/finalize/undo, single & double
// elim builders) and the per-match veto engine (pools, ban/pick sequence, A/B).
// They are mutually referenced (evaluate -> initVeto), so they live together to
// avoid a circular import. Behaviour is identical to the previous in-server code.
//
// Two boundaries were made explicit during extraction:
//   1. `_buildingDivision`, previously a module-global mutated by the API handler,
//      is now an explicit `division` argument threaded through the builders and
//      newMatch. The handler passes the division directly.
//   2. finalizeMatch's only reach outside this unit was swissAfterReport (swiss
//      progression still lives in server.js). It is now an injected hook, set once
//      at startup via setHooks(). ffa never reports through finalizeMatch.
'use strict';

const { uid, teamById, playerById, matchById } = require('./util');
const { BO_OK, seededSlots, log2i, nextPow2 } = require('./bracket');

// Hooks injected by the host (server.js) to avoid importing back into it.
const hooks = { /** @type {null | ((t:any)=>void)} */ swissAfterReport: null, /** @type {null | ((t:any,m:any)=>void)} */ afterFinalize: null };
/**
 * Register host callbacks. Currently: swissAfterReport(t), invoked when a Swiss
 * match is finalized so the host can pair/advance the Swiss round.
 * @param {{ swissAfterReport?: (t:any)=>void, afterFinalize?: (t:any,m:any)=>void }} h
 */
function setHooks(h) { Object.assign(hooks, h); }

function poolById(t, id) {
  if (!t.mapPools) return null;
  for (const p of t.mapPools) if (p.id === id) return p;
  return null;
}

// The round key a match takes its pool (and fixed maps) from: 'wb:2', 'lb:1', 'gf:1'... With
// divisions started by this version (cfg.divAlign), a smaller division plays the largest one's
// round lengths aligned back from the final, so it also uses the pool of the round it is aligned
// with - its final the final's pool, its semi-finals the semi-finals' - since a pool is built for
// one series length.
function poolRoundKey(t, m) {
  let r = m.round;
  if (m.division && t.cfg && t.cfg.divAlign && (m.bracket === 'wb' || m.bracket === 'lb')) {
    // the lengths were set for the largest division, so its round count is the length list's
    const R = (Array.isArray(t.cfg.wb) ? t.cfg.wb : (t.cfg.rounds || [])).length;
    const Rd = (t.matches || []).filter(x => x.bracket === 'wb' && (x.division || 0) === m.division).reduce((a, x) => Math.max(a, x.round || 0), 0);
    const off = Math.max(0, R - Rd);
    r = m.round + (m.bracket === 'wb' ? off : 2 * off);
  }
  return m.bracket + ':' + r;
}

function poolForMatch(t, m) {
  if (!t.mapPools || !t.mapPools.length) return null;
  const a = t.poolAssign || {};
  let pid = a['match:' + m.id];
  if (!pid) pid = a[poolRoundKey(t, m)];
  // A 3rd place match is played like a semi-final (same length by default), so with no pool of
  // its own it uses the semi-finals' one rather than falling through to the first pool.
  if (!pid && m.bracket === '3p') pid = a['wb:' + (m.round - 1)];
  let pool = pid ? poolById(t, pid) : null;
  if (!pool) pool = t.mapPools[0]; // default to the first pool
  return pool;
}

function poolMapIds(t, m) {
  const pool = poolForMatch(t, m);
  return pool ? (pool.mapIds || []).slice() : [];
}

function cleanSequence(arr) {
  const seq = [];
  if (Array.isArray(arr)) {
    for (const step of arr) {
      if (!step || typeof step !== 'object') continue;
      const action = step.action === 'pick' ? 'pick' : (step.action === 'ban' ? 'ban' : null);
      const team = step.team === 'B' ? 'B' : (step.team === 'A' ? 'A' : null);
      if (action && team) seq.push({ action, team });
    }
  }
  return seq.slice(0, 32);
}

function cleanVeto(v) {
  if (!v || typeof v !== 'object') return { enabled: false, mode: 'upfront', abMode: 'lowerA' };
  const AB_OK = ['random', 'lowerA', 'lowerB', 'manual'];
  return {
    enabled: !!v.enabled,
    mode: v.mode === 'continuous' ? 'continuous' : 'upfront',
    // how Team A / Team B are decided per match
    abMode: AB_OK.indexOf(v.abMode) >= 0 ? v.abMode : 'lowerA',
    // Secret maps (see lib/maps.js): a secret map is revealed when it is going to be played.
    // Off by default, so banning stays blind - which is the point of the format. Turning it on
    // reveals each secret map as it is banned, which makes the veto readable at the cost of
    // handing the pool over one map at a time.
    revealBans: !!v.revealBans
  };
}

// Combined TEAM rating, i.e. the sum of its members' ratings - the same number the Teams tab
// shows and the same one seeding uses. This used to be the captain's rating alone, which meant
// "lower rated acts first" could pick the stronger team whenever the captains happened to rank
// the other way round. For a solo bracket it is simply that player's rating.
function abRating(t, teamId) {
  const team = teamById(t, teamId);
  if (!team) return null;
  let total = 0, counted = 0;
  for (const pid of (team.playerIds || [])) {
    const p = playerById(t, pid);
    if (p && p.rating != null) { total += p.rating; counted++; }
  }
  return counted ? total : null;
}

function decideTeamA(t, m) {
  const mode = (t.veto && t.veto.abMode) || 'lowerA';
  if (mode === 'manual') return null;
  if (mode === 'random') return Math.random() < 0.5 ? m.team1 : m.team2;
  const r1 = abRating(t, m.team1);
  const r2 = abRating(t, m.team2);
  // Nothing to compare (unrated tournament, or an exact tie): fall back to seed, but STILL
  // respect the mode. Seeds track rating, so the old unconditional "better seed acts first"
  // silently inverted lowerA and looked exactly like "higher rated goes first".
  if (r1 == null || r2 == null || r1 === r2) {
    const s1 = (teamById(t, m.team1) || {}).seed || 999;
    const s2 = (teamById(t, m.team2) || {}).seed || 999;
    if (s1 === s2) return m.team1;
    const worseSeed = s1 > s2 ? m.team1 : m.team2;          // higher seed number = weaker team
    const betterSeed = worseSeed === m.team1 ? m.team2 : m.team1;
    return mode === 'lowerA' ? worseSeed : betterSeed;
  }
  const lower = r1 < r2 ? m.team1 : m.team2;
  const higher = lower === m.team1 ? m.team2 : m.team1;
  return mode === 'lowerA' ? lower : higher;
}

function initVeto(t, m) {
  if (!t.veto || !t.veto.enabled) return;
  if (m.bracket === 'ffa') return; // vetoes are for head-to-head matches only
  if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') return;
  if (m.veto && m.veto.stepIndex > 0) return; // already started — don't clobber progress

  // The ban/pick order comes from the match's assigned pool. Its length is tied to the pool
  // size (steps = pool - 1), so exactly one map is left as the decider.
  const pool = poolForMatch(t, m);
  if (!pool) { m.veto = null; return; }
  const poolIds = (pool.mapIds || []).slice();
  const seq = cleanSequence(pool.sequence);
  if (!seq.length) { m.veto = null; return; }
  if (poolIds.length !== seq.length + 1) { m.veto = null; return; }
  // the pool is built for a specific series length; refuse to run a Bo5 order on a Bo1 match
  const poolBo = BO_OK.indexOf(parseInt(pool.bo, 10)) >= 0 ? parseInt(pool.bo, 10) : (seq.filter(x => x.action === 'pick').length + 1);
  if (poolBo !== m.bo) { m.veto = null; return; }

  // Team A per the tournament's rule. In 'manual' mode this stays null until the organizer
  // sets it, and the veto can't be acted on before then.
  const teamA = (m.veto && m.veto.teamA) || decideTeamA(t, m);
  const teamB = teamA ? (teamA === m.team1 ? m.team2 : m.team1) : null;
  m.veto = {
    remaining: poolIds,
    banned: [],                 // [{ map, by:teamId }]
    picks: [],                  // [{ map, by:teamId, game:N }] ordered game slots
    sequence: seq.slice(),
    mode: t.veto.mode || 'upfront',
    stepIndex: 0,
    teamA: teamA,
    teamB: teamB,
    bo: m.bo,
    done: false
  };
}

function vetoCurrentStep(m) {
  if (!m.veto || m.veto.done) return null;
  if (!m.veto.teamA || !m.veto.teamB) return null; // organizer hasn't set A/B yet
  const step = m.veto.sequence[m.veto.stepIndex];
  if (!step) return null;
  const team = step.team === 'A' ? m.veto.teamA : m.veto.teamB;
  return { team, action: step.action, ab: step.team };
}

function vetoAdvance(t, m) {
  m.veto.stepIndex++;
  if (m.veto.stepIndex >= m.veto.sequence.length || m.veto.remaining.length <= 1) {
    // done — the single leftover (if any) becomes the decider, played as the last game
    m.veto.done = true;
    if (m.veto.remaining.length === 1) {
      const gameNum = m.veto.picks.length + 1;
      m.veto.decider = { map: m.veto.remaining[0], game: gameNum };
    }
  }
}

// ---------- faction veto (1v1 only) ----------
// Runs per GAME of a series, independently of and in parallel with the map veto. Each side bans
// factions (denying them to the opponent) and then picks factions in preference order. Neither
// side - nor the organizer - can see the other's choices until both are finished; the server
// strips them from the payload rather than relying on the UI to hide them.
//
// Resolution: your faction is your highest-preference pick the OPPONENT did not ban. That is only
// guaranteed to exist when picks > bans, which is enforced when the setting is saved: with the
// picks all distinct, N bans can eliminate at most N of them, so pick N+1 always survives.
const FACTIONS = ['uef', 'aeon', 'cybran', 'seraphim'];

function factionVetoOn(t) {
  return !!(t.fveto && t.fveto.enabled && t.teamSize === 1 && t.competition !== 'ffa');
}

// A fresh per-game record. `games` is keyed by game number as a string.
function newFactionGame() {
  return { t1: { bans: [], picks: [], done: false }, t2: { bans: [], picks: [], done: false }, result: null };
}

function initFactionVeto(t, m) {
  if (!factionVetoOn(t)) { m.fveto = null; return; }
  if (m.bracket === 'ffa') return;
  if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') { m.fveto = null; return; }
  const bans = Math.max(1, Math.min(2, parseInt(t.fveto.bans, 10) || 1));
  const picks = Math.max(bans + 1, Math.min(3, parseInt(t.fveto.picks, 10) || (bans + 1)));
  if (m.fveto && m.fveto.bans === bans && m.fveto.picks === picks) {
    // Settings unchanged: keep progress, just make sure every game slot exists (bo may have grown).
    for (let g = 1; g <= m.bo; g++) if (!m.fveto.games[String(g)]) m.fveto.games[String(g)] = newFactionGame();
    return;
  }
  // Any started work is discarded when the counts change, because half-finished bans under the
  // old numbers cannot be reconciled with the new ones.
  const games = {};
  for (let g = 1; g <= m.bo; g++) games[String(g)] = newFactionGame();
  m.fveto = { bans, picks, games };
}

// Both vetoes are initialised together everywhere a match becomes ready. Swiss pairing bypasses
// evaluate() and calls this directly - see the note in the project docs.
function initMatchVetoes(t, m) { initVeto(t, m); initFactionVeto(t, m); }

function factionSideKey(m, teamId) {
  if (!m || !teamId) return null;
  if (teamId === m.team1) return 't1';
  if (teamId === m.team2) return 't2';
  return null;
}

// How many choices this side still owes for a game, and what kind. Returns null when finished.
function factionNextStep(fv, side) {
  if (!fv || !side) return null;
  if (side.bans.length < fv.bans) return { action: 'ban', index: side.bans.length + 1, of: fv.bans };
  if (side.picks.length < fv.picks) return { action: 'pick', index: side.picks.length + 1, of: fv.picks };
  return null;
}

// Both sides finished -> compute and store the outcome. Idempotent.
function factionResolve(fv, game) {
  if (!game || game.result) return;
  if (!game.t1.done || !game.t2.done) return;
  const pickFor = (mine, theirs) => {
    for (const f of mine.picks) if (theirs.bans.indexOf(f) < 0) return f;
    // Unreachable while picks > bans is enforced, but never leave a game unresolved: fall back to
    // the first faction the opponent did not ban, then to the first pick.
    for (const f of FACTIONS) if (theirs.bans.indexOf(f) < 0) return f;
    return mine.picks[0] || null;
  };
  game.result = { t1: pickFor(game.t1, game.t2), t2: pickFor(game.t2, game.t1) };
}

// The view ONE viewer is allowed to see. `mySide` is 't1'/'t2' for a competitor, null for
// everybody else (including organizers). Opponent bans/picks are never included before both
// sides are done - this is the whole point of the feature, so it is enforced here, server-side.
function factionViewFor(m, mySide) {
  if (!m || !m.fveto) return null;
  const fv = m.fveto;
  const out = { bans: fv.bans, picks: fv.picks, games: {} };
  for (const g of Object.keys(fv.games)) {
    const game = fv.games[g];
    const both = !!(game.t1.done && game.t2.done);
    const entry = {
      t1Done: !!game.t1.done,
      t2Done: !!game.t2.done,
      result: both ? game.result : null
    };
    if (mySide) {
      const mine = game[mySide];
      entry.mine = { bans: mine.bans.slice(), picks: mine.picks.slice(), done: !!mine.done };
      entry.next = factionNextStep(fv, mine);
    }
    out.games[g] = entry;
  }
  return out;
}

function newMatch(t, bracket, round, index, bo, division) {
  const m = {
    id: 'm' + uid(4), bracket, round, index, bo: bo || 3, hcap: 0,
    division: division || 0,
    team1: null, team2: null, score1: null, score2: null,
    status: 'waiting', winner: null, loser: null,
    winnerTo: null, loserTo: null
  };
  t.matches.push(m);
  return m;
}

function routeVal(t, m, isWinner, val) {
  const to = isWinner ? m.winnerTo : m.loserTo;
  if (to) {
    const dest = matchById(t, to.id);
    if (dest) setSlot(t, dest, to.slot, val);
    return;
  }
  // The third-place match leads nowhere and crowns nobody: both players are placed (3rd, 4th)
  // and done. It finishes the tournament only if the final has already been won.
  if (m.bracket === '3p') {
    if (val && val !== 'BYE') {
      const tm = teamById(t, val);
      if (tm) { tm.eliminated = true; tm.out = { bracket: '3p', round: m.round, place: isWinner ? 3 : 4 }; }
    }
    if (isWinner && t.championTeamId) t.status = 'finished';
    return;
  }
  if (isWinner) {
    if (val && val !== 'BYE') {
      const div = m.division || 0;
      if (div && divisionsOn(t)) {
        // Each division crowns its own champion (derived from its final, never stored). The top
        // division's is the tournament's; the tournament finishes when every division has one.
        if (div === 1) t.championTeamId = val;
        if (allDivisionsDone(t)) t.status = 'finished';
      } else {
        t.championTeamId = val;
        // A third-place match still to be played keeps the tournament open; it closes it itself.
        const third = thirdPlaceMatch(t, div);
        if (!third || third.status === 'done' || third.status === 'bye') t.status = 'finished';
      }
    }
  } else if (val && val !== 'BYE') {
    const lt = teamById(t, val);
    if (lt) { lt.eliminated = true; lt.out = { bracket: m.bracket, round: m.round }; }
  }
}

function setSlot(t, m, slot, val) {
  if (slot === 1) m.team1 = val; else m.team2 = val;
  evaluate(t, m);
}

function evaluate(t, m) {
  if (m.status !== 'waiting') return;
  if (m.team1 === null || m.team2 === null) return;
  const real1 = m.team1 !== 'BYE', real2 = m.team2 !== 'BYE';
  if (real1 && real2) {
    m.status = 'ready';
    if (m.hcap) { m.score1 = 1; m.score2 = 0; }
    initMatchVetoes(t, m);
    return;
  }
  m.status = 'bye';
  if (real1 || real2) {
    m.winner = real1 ? m.team1 : m.team2;
    m.loser = 'BYE';
  } else {
    m.winner = 'BYE'; m.loser = 'BYE';
  }
  routeVal(t, m, false, m.loser);
  routeVal(t, m, true, m.winner);
}

function finalizeMatch(t, m, s1, s2, forceWinner) {
  m.score1 = s1; m.score2 = s2;
  m.status = 'done';
  // The result is in, so an unfinished veto can never be acted on again (a forfeit or an
  // organizer correction can settle a match mid-veto). Close it out and flag that it never
  // ran to completion, so it stops sitting in the "in progress" list.
  if (m.veto && !m.veto.done) { m.veto.done = true; m.veto.abandoned = true; }
  if (forceWinner && (forceWinner === m.team1 || forceWinner === m.team2)) {
    m.winner = forceWinner;
    m.loser = forceWinner === m.team1 ? m.team2 : m.team1;
  } else {
    m.winner = s1 > s2 ? m.team1 : m.team2;
    m.loser = s1 > s2 ? m.team2 : m.team1;
  }
  if (m.bracket === 'sw') {
    if (hooks.swissAfterReport) hooks.swissAfterReport(t);
    if (hooks.afterFinalize) hooks.afterFinalize(t, m);
    return;
  }
  routeVal(t, m, false, m.loser);
  routeVal(t, m, true, m.winner);
  // Runs after the elimination has actually been recorded by routeVal, so a host hook that
  // counts survivors sees the true count. One hook here covers every reporting path there is.
  if (hooks.afterFinalize) hooks.afterFinalize(t, m);
}

function undoMatch(t, m) {
  if (m.bracket === '3p') {
    // Taking back a third-place result touches nothing but the two players it placed.
    for (const id of [m.winner, m.loser]) {
      const tm = (id && id !== 'BYE') ? teamById(t, id) : null;
      if (tm) { tm.eliminated = false; tm.out = null; }
    }
    if (t.status === 'finished') t.status = 'running';
    m.winner = null; m.loser = null;
    m.status = 'ready';
    if (m.veto && m.veto.abandoned) { m.veto.done = false; delete m.veto.abandoned; }
    m.score1 = null; m.score2 = null;
    return null;
  }
  for (const to of [m.winnerTo, m.loserTo]) {
    if (!to) continue;
    const dest = matchById(t, to.id);
    if (dest && (dest.status === 'live' || dest.status === 'done')) {
      return 'The next match has already started — cannot correct this one';
    }
  }
  for (const pair of [[m.winnerTo, m.winner], [m.loserTo, m.loser]]) {
    const to = pair[0], val = pair[1];
    if (!to) continue;
    const dest = matchById(t, to.id);
    if (!dest) continue;
    if (to.slot === 1 && dest.team1 === val) dest.team1 = null;
    if (to.slot === 2 && dest.team2 === val) dest.team2 = null;
    dest.status = 'waiting';
    dest.score1 = null; dest.score2 = null;
    dest.winner = null; dest.loser = null;
  }
  if (!m.winnerTo && m.winner && m.winner !== 'BYE') {
    // A lower division's final never set the tournament champion, so taking it back leaves the
    // top division's champion alone.
    const div = m.division || 0;
    if (!(div > 1 && divisionsOn(t)) || t.championTeamId === m.winner) t.championTeamId = null;
    t.status = 'running';
  }
  if (m.loser && m.loser !== 'BYE') {
    const lt = teamById(t, m.loser);
    if (lt) { lt.eliminated = false; lt.out = null; }
  }
  m.winner = null; m.loser = null;
  m.status = 'ready';
  // If the result is undone, a veto we auto-closed at finalize time should become live again -
  // but only that one; a veto the captains genuinely completed stays completed.
  if (m.veto && m.veto.abandoned) { m.veto.done = false; delete m.veto.abandoned; }
  if (m.hcap) { m.score1 = 1; m.score2 = 0; } else { m.score1 = null; m.score2 = null; }
  return null;
}

function backfillMatchLinks(t) {
  if (!t) return false;
  const ms = (t.matches || []);
  if (!ms.length) return false;
  // if any elimination match already has winnerTo, assume links are present.
  const elim = ms.filter(m => m.bracket === 'wb' || m.bracket === 'lb' || m.bracket === 'gf');
  if (!elim.length) return false;
  if (elim.some(m => m.winnerTo || m.loserTo)) return false;

  const byRC = {}; // bracket -> round -> index -> match
  for (const m of elim) {
    byRC[m.bracket] = byRC[m.bracket] || {};
    byRC[m.bracket][m.round] = byRC[m.bracket][m.round] || {};
    byRC[m.bracket][m.round][m.index] = m;
  }
  const at = (br, r, i) => (byRC[br] && byRC[br][r] && byRC[br][r][i]) || null;
  const gf = at('gf', 1, 0);

  const wbRounds = byRC.wb ? Object.keys(byRC.wb).map(Number) : [];
  const R = wbRounds.length ? Math.max.apply(null, wbRounds) : 0;

  if (t.bracketType === 'double' && R > 0) {
    const lbRoundsKeys = byRC.lb ? Object.keys(byRC.lb).map(Number) : [];
    const lbRounds = lbRoundsKeys.length ? Math.max.apply(null, lbRoundsKeys) : 0;
    // winners bracket
    for (let r = 1; r <= R; r++) {
      const row = byRC.wb[r] || {};
      Object.keys(row).map(Number).forEach(i => {
        const m = row[i];
        if (r < R) { const nx = at('wb', r + 1, Math.floor(i / 2)); if (nx) m.winnerTo = { id: nx.id, slot: (i % 2) + 1 }; }
        else if (gf) m.winnerTo = { id: gf.id, slot: 1 };
        if (r === 1) { const d = at('lb', 1, Math.floor(i / 2)); if (d) m.loserTo = { id: d.id, slot: (i % 2) + 1 }; }
        else {
          const q = 2 * r - 2;
          const cnt = byRC.lb && byRC.lb[q] ? Object.keys(byRC.lb[q]).length : 0;
          const j = (r % 2 === 0) ? (cnt - 1 - i) : i;
          const d = at('lb', q, j); if (d) m.loserTo = { id: d.id, slot: 1 };
        }
      });
    }
    // losers bracket
    for (let q = 1; q <= lbRounds; q++) {
      const row = byRC.lb[q] || {};
      Object.keys(row).map(Number).forEach(i => {
        const m = row[i];
        if (q === lbRounds) { if (gf) m.winnerTo = { id: gf.id, slot: 2 }; return; }
        if (q % 2 === 1) { const nx = at('lb', q + 1, i); if (nx) m.winnerTo = { id: nx.id, slot: 2 }; }
        else { const nx = at('lb', q + 1, Math.floor(i / 2)); if (nx) m.winnerTo = { id: nx.id, slot: (i % 2) + 1 }; }
      });
    }
  } else if (R > 0) {
    // single elimination
    for (let r = 1; r < R; r++) {
      const row = byRC.wb[r] || {};
      Object.keys(row).map(Number).forEach(i => {
        const m = row[i];
        const nx = at('wb', r + 1, Math.floor(i / 2));
        if (nx) m.winnerTo = { id: nx.id, slot: (i % 2) + 1 };
      });
    }
  }
  return true;
}

function buildSingle(t, cfg, division, opts) {
  const slots = seededSlots(t, division, opts);
  const size = slots.length;
  const R = log2i(size);
  t.rounds = R;
  const grid = {};
  for (let r = 1; r <= R; r++) {
    grid[r] = [];
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) grid[r].push(newMatch(t, 'wb', r, i, cfg.rounds[r - 1], division));
  }
  for (let r = 1; r < R; r++) {
    grid[r].forEach((m, i) => {
      m.winnerTo = { id: grid[r + 1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
    });
  }
  // Linked before round one is filled, so every semi-final loser is routed into it. It needs four
  // real players: with three, one semi-final is a bye and there is nobody to play for 3rd.
  if (cfg.thirdPlace && !division && slots.filter(x => x && x !== 'BYE').length >= 4) addThirdPlace(t, 0, cfg.thirdBo);
  grid[1].forEach((m, i) => {
    setSlot(t, m, 1, slots[i * 2]);
    setSlot(t, m, 2, slots[i * 2 + 1]);
  });
}

// ---------- divisions (King / Prince ...) ----------
// t.divisions is 0 (one bracket) or 2-4. Every team plays in exactly one division and each
// division is its own bracket; a division's champion is the winner of its final.
function divisionsOn(t) { return (parseInt(t && t.divisions, 10) || 0) > 1; }
function divisionFinal(t, division) {
  const d = division || 0;
  const ms = (t.matches || []).filter(m => (m.division || 0) === d);
  return ms.find(m => m.bracket === 'gf') || ms.find(m => m.bracket === 'wb' && !m.winnerTo) || null;
}
function divisionChampion(t, division) {
  const f = divisionFinal(t, division);
  return (f && (f.status === 'done' || f.status === 'bye') && f.winner && f.winner !== 'BYE') ? f.winner : null;
}
function allDivisionsDone(t) {
  const n = parseInt(t.divisions, 10) || 0;
  for (let d = 1; d <= n; d++) if (!divisionChampion(t, d)) return false;
  return n > 0;
}

// ---------- third-place match (single elimination) ----------
// The two semi-final losers play for 3rd. It is its own bracket ('3p') so nothing that walks the
// winners bracket - the final, the champion, the columns - ever mistakes it for part of it.
function thirdPlaceMatch(t, division) {
  return (t.matches || []).find(m => m.bracket === '3p' && (m.division || 0) === (division || 0)) || null;
}
function semiFinals(t, division) {
  const wb = (t.matches || []).filter(m => m.bracket === 'wb' && (m.division || 0) === (division || 0));
  const R = wb.reduce((a, m) => Math.max(a, m.round || 0), 0);
  if (R < 2) return null;
  const semis = wb.filter(m => m.round === R - 1).sort((a, b) => (a.index || 0) - (b.index || 0));
  return semis.length === 2 ? { R: R, semis: semis } : null;
}
// Adds it and routes both semi-final losers into it - including a semi-final already played, whose
// loser is brought back from "eliminated" to play it. Returns the match, or null when the bracket
// has no two semi-finals to take it from. Bo defaults to the semi-finals' own.
function addThirdPlace(t, division, bo) {
  const have = thirdPlaceMatch(t, division);
  if (have) return have;
  const sf = semiFinals(t, division);
  if (!sf) return null;
  const m3 = newMatch(t, '3p', sf.R, 0, bo || sf.semis[0].bo || 3, division);
  sf.semis.forEach((s, i) => {
    s.loserTo = { id: m3.id, slot: i + 1 };
    if (s.status === 'done' || s.status === 'bye') {
      if (s.loser && s.loser !== 'BYE') {
        const lt = teamById(t, s.loser);
        if (lt) { lt.eliminated = false; lt.out = null; }
      }
      setSlot(t, m3, i + 1, s.loser || 'BYE');
    }
  });
  // A final already won no longer finishes the tournament on its own.
  if (t.championTeamId && t.status === 'finished' && m3.status !== 'bye') t.status = 'running';
  return m3;
}
// Takes it away again, if nobody has played it: the semi-final losers go back to being out in the
// semi-finals. Returns an error string, or null.
function thirdPlaceStarted(m3) {
  if (!m3) return false;
  if (m3.status === 'done' || m3.status === 'live' || (Array.isArray(m3.games) && m3.games.length) || m3.pendingReport) return true;
  if (m3.veto && ((m3.veto.stepIndex || 0) > 0 || (m3.veto.banned || []).length || (m3.veto.picks || []).length)) return true;
  if (m3.fveto && m3.fveto.games) {
    for (const g of Object.values(m3.fveto.games)) {
      for (const side of [g && g.t1, g && g.t2]) {
        if (side && ((side.bans || []).length || (side.picks || []).length)) return true;
      }
    }
  }
  return false;
}
function removeThirdPlace(t, division) {
  const m3 = thirdPlaceMatch(t, division);
  if (!m3) return null;
  if (thirdPlaceStarted(m3)) return 'The 3rd place match has already started, so it can no longer be removed';
  const sf = semiFinals(t, division);
  if (sf) {
    for (const s of sf.semis) {
      if (s.loserTo && s.loserTo.id === m3.id) s.loserTo = null;
      if (s.status === 'done' && s.loser && s.loser !== 'BYE') {
        const lt = teamById(t, s.loser);
        if (lt) { lt.eliminated = true; lt.out = { bracket: s.bracket, round: s.round }; }
      }
    }
  }
  t.matches = t.matches.filter(m => m !== m3);
  if (t.championTeamId && t.status === 'running') t.status = 'finished';
  return null;
}

function buildDouble(t, cfg, division, opts) {
  const slots = seededSlots(t, division, opts);
  const size = slots.length; // >= 4 (n>=3 enforced by caller)
  const R = log2i(size);
  t.rounds = R;
  const wb = {}, lb = {};
  for (let r = 1; r <= R; r++) {
    wb[r] = [];
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) wb[r].push(newMatch(t, 'wb', r, i, cfg.wb[r - 1], division));
  }
  const lbRounds = 2 * R - 2;
  for (let q = 1; q <= lbRounds; q++) {
    lb[q] = [];
    const k = (q % 2 === 1) ? (q + 3) / 2 : (q + 2) / 2;
    const count = size / Math.pow(2, k);
    for (let i = 0; i < count; i++) lb[q].push(newMatch(t, 'lb', q, i, cfg.lb[q - 1], division));
  }
  const gf = newMatch(t, 'gf', 1, 0, cfg.gf, division);
  if (cfg.lbHandicap) gf.hcap = 1;

  for (let r = 1; r <= R; r++) {
    wb[r].forEach((m, i) => {
      if (r < R) m.winnerTo = { id: wb[r + 1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
      else m.winnerTo = { id: gf.id, slot: 1 };
      if (r === 1) {
        m.loserTo = { id: lb[1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
      } else {
        const q = 2 * r - 2;
        const cnt = lb[q].length;
        const j = (r % 2 === 0) ? (cnt - 1 - i) : i; // alternate to delay rematches
        m.loserTo = { id: lb[q][j].id, slot: 1 };
      }
    });
  }
  for (let q = 1; q <= lbRounds; q++) {
    lb[q].forEach((m, i) => {
      if (q === lbRounds) { m.winnerTo = { id: gf.id, slot: 2 }; return; }
      if (q % 2 === 1) m.winnerTo = { id: lb[q + 1][i].id, slot: 2 };
      else m.winnerTo = { id: lb[q + 1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
    });
  }
  wb[1].forEach((m, i) => {
    setSlot(t, m, 1, slots[i * 2]);
    setSlot(t, m, 2, slots[i * 2 + 1]);
  });
}

module.exports = {
  setHooks,
  poolById, poolForMatch, poolRoundKey, poolMapIds, cleanSequence, cleanVeto, abRating, decideTeamA, initVeto, vetoCurrentStep, vetoAdvance,
  FACTIONS, factionVetoOn, initMatchVetoes, newFactionGame, initFactionVeto, factionSideKey, factionNextStep, factionResolve, factionViewFor,
  newMatch, routeVal, setSlot, evaluate, finalizeMatch, undoMatch, backfillMatchLinks, buildSingle, buildDouble,
  thirdPlaceMatch, addThirdPlace, removeThirdPlace, thirdPlaceStarted,
  divisionsOn, divisionFinal, divisionChampion, allDivisionsDone,
};
