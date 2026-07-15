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
const hooks = { /** @type {null | ((t:any)=>void)} */ swissAfterReport: null };
/**
 * Register host callbacks. Currently: swissAfterReport(t), invoked when a Swiss
 * match is finalized so the host can pair/advance the Swiss round.
 * @param {{ swissAfterReport?: (t:any)=>void }} h
 */
function setHooks(h) { Object.assign(hooks, h); }

function poolById(t, id) {
  if (!t.mapPools) return null;
  for (const p of t.mapPools) if (p.id === id) return p;
  return null;
}

function poolForMatch(t, m) {
  if (!t.mapPools || !t.mapPools.length) return null;
  const a = t.poolAssign || {};
  let pid = a['match:' + m.id];
  if (!pid) pid = a[m.bracket + ':' + m.round];
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
    abMode: AB_OK.indexOf(v.abMode) >= 0 ? v.abMode : 'lowerA'
  };
}

function abRating(t, teamId) {
  const team = teamById(t, teamId);
  if (!team) return null;
  if (team.captainId) {
    const cap = playerById(t, team.captainId);
    if (cap && cap.rating != null) return cap.rating;
  }
  // solo brackets have no separate captain: the single member is the player
  const pid = (team.playerIds || [])[0];
  const p = pid ? playerById(t, pid) : null;
  return (p && p.rating != null) ? p.rating : null;
}

function decideTeamA(t, m) {
  const mode = (t.veto && t.veto.abMode) || 'lowerA';
  if (mode === 'manual') return null;
  if (mode === 'random') return Math.random() < 0.5 ? m.team1 : m.team2;
  const r1 = abRating(t, m.team1);
  const r2 = abRating(t, m.team2);
  // unrated players can't be compared — fall back to seed (higher seed acts first)
  if (r1 == null || r2 == null || r1 === r2) {
    const s1 = (teamById(t, m.team1) || {}).seed || 999;
    const s2 = (teamById(t, m.team2) || {}).seed || 999;
    return s1 <= s2 ? m.team1 : m.team2;
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
  if (isWinner) {
    if (val && val !== 'BYE') { t.championTeamId = val; t.status = 'finished'; }
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
    initVeto(t, m);
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

function finalizeMatch(t, m, s1, s2) {
  m.score1 = s1; m.score2 = s2;
  m.status = 'done';
  m.winner = s1 > s2 ? m.team1 : m.team2;
  m.loser = s1 > s2 ? m.team2 : m.team1;
  if (m.bracket === 'sw') { if (hooks.swissAfterReport) hooks.swissAfterReport(t); return; }
  routeVal(t, m, false, m.loser);
  routeVal(t, m, true, m.winner);
}

function undoMatch(t, m) {
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
    t.championTeamId = null;
    t.status = 'running';
  }
  if (m.loser && m.loser !== 'BYE') {
    const lt = teamById(t, m.loser);
    if (lt) { lt.eliminated = false; lt.out = null; }
  }
  m.winner = null; m.loser = null;
  m.status = 'ready';
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

function buildSingle(t, cfg, division) {
  const slots = seededSlots(t, division);
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
  grid[1].forEach((m, i) => {
    setSlot(t, m, 1, slots[i * 2]);
    setSlot(t, m, 2, slots[i * 2 + 1]);
  });
}

function buildDouble(t, cfg, division) {
  const slots = seededSlots(t, division);
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
  poolById, poolForMatch, poolMapIds, cleanSequence, cleanVeto, abRating, decideTeamA, initVeto, vetoCurrentStep, vetoAdvance, newMatch, routeVal, setSlot, evaluate, finalizeMatch, undoMatch, backfillMatchLinks, buildSingle, buildDouble,
};
