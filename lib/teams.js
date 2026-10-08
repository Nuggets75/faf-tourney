// NOTE: not yet `// @ts-check` (untyped dynamic tournament objects, like lib/match.js).
// Team formation: manual/open/grouped team creation, draft setup, and seeding.
// Pure with respect to app I/O - operates only on the tournament object plus the
// shared lookups/helpers from lib/util.js.
'use strict';

const { uid, shuffle, playerById, teamById } = require('./util');

function makeTeam(t, name, captainPid, memberPids, seed, division) {
  const team = {
    id: 't' + uid(4), name, seed,
    captainId: captainPid, playerIds: memberPids.slice(),
    captainToken: uid(10), eliminated: false, out: null
  };
  if (division) team.division = division;
  t.teams.push(team);
  for (const pid of memberPids) { const p = playerById(t, pid); if (p) p.teamId = team.id; }
  return team;
}

function applySeeding(t, arr, avgFn) {
  if (t.seeding === 'rating') arr.sort((a, b) => avgFn(b) - avgFn(a));
  else if (t.seeding === 'manual') arr.sort((a, b) => (a.seed || 0) - (b.seed || 0)); // keep the organizer's order (set via reseed)
  else shuffle(arr);
}

// `division` (King = 1, Prince = 2 ...) drafts one division of a split tournament: the teams it
// makes are added to the ones the divisions above already drafted, and are seeded after them so
// seeds stay unique across the field until the bracket starts. Without it (0) this is the one
// draft of the tournament, exactly as it always was.
function buildDraft(t, captainIds, division) {
  const div = parseInt(division, 10) || 0;
  if (div <= 1) t.teams = [];
  const offset = t.teams.length;
  const seeds = captainIds.slice();
  applySeeding(t, seeds, pid => (playerById(t, pid).rating || 0));
  const created = [];
  seeds.forEach((pid, i) => {
    const p = playerById(t, pid);
    created.push(makeTeam(t, 'Team ' + p.name, pid, [pid], offset + i + 1, div || 0));
  });
  const numTeams = created.length;
  const picksPerTeam = Math.max(0, t.teamSize - 1);
  const poolSize = t.players.filter(p => !p.teamId).length;
  const totalPicks = Math.min(numTeams * picksPerTeam, poolSize);
  const base = created.map(x => x.id);
  const order = [];
  let i = 0;
  while (order.length < totalPicks && i < 10000) {
    const round = Math.floor(i / numTeams);
    const pos = i - round * numTeams;
    let idx;
    if (t.draftOrder === 'snake') idx = (round % 2 === 0) ? pos : (numTeams - 1 - pos);
    else idx = numTeams - 1 - pos; // linear: bottom seed picks first, every round
    const teamId = base[idx];
    const team = teamById(t, teamId);
    if (team.playerIds.length + order.filter(o => o === teamId).length < t.teamSize) order.push(teamId);
    i++;
  }
  t.draft = div ? { order, current: 0, division: div } : { order, current: 0 };
  t.status = 'draft';
}

function finishDraftIfDone(t) {
  if (!t.draft || t.draft.waiting) return;
  if (t.draft.current >= t.draft.order.length) {
    // A division draft hands over to the next division while there are players left for it.
    const d = t.draft.division || 0;
    if (d && d < (parseInt(t.divisions, 10) || 0) && t.players.some(p => !p.teamId && !p.pending)) {
      startNextDivision(t, d + 1);
      return;
    }
    t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
    t.status = 'drafted';
    t.draft.done = true;
  }
}

// ---------- the division draft chain ----------
// Division 1's captains are set the usual way (captainMode / captainCount). Each later division
// has its own setting in t.divCaptains[d]: by default the N highest rated of the players nobody
// has drafted yet, chosen the moment the division above finishes; or the organizer picks them.
function divisionCaptainCfg(t, d) {
  if (d <= 1) return { mode: t.captainMode === 'rating' ? 'rating' : 'manual', count: parseInt(t.captainCount, 10) || 0 };
  const c = (t.divCaptains && t.divCaptains[d]) || {};
  return { mode: c.mode === 'manual' ? 'manual' : 'rating', count: parseInt(c.count, 10) || 0 };
}
// Everyone a later division can still draft from, best rated first.
function divisionPool(t) {
  return (t.players || []).filter(p => !p.teamId && !p.pending).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
}
// The division above has finished drafting: start division d straight away when its captains can
// be chosen automatically, otherwise leave it waiting for the organizer. The finished draft is
// kept, so its last pick can still be taken back while the next one has not started.
function startNextDivision(t, d) {
  if (t.draft) t.draftDone = (t.draftDone || []).concat([t.draft]);
  const cfg = divisionCaptainCfg(t, d);
  const pool = divisionPool(t);
  if (cfg.mode === 'rating' && cfg.count >= 2 && pool.length >= cfg.count) {
    buildDraft(t, pool.slice(0, cfg.count).map(p => p.id), d);
    t.draft.auto = 1;
    finishDraftIfDone(t);
    return;
  }
  t.draft = { order: [], current: 0, division: d, waiting: 1 };
  t.status = 'draft';
}

// Split the current teams into n divisions by combined rating, the strongest in division 1. With
// two divisions `firstSize` can set how many go into the top one; otherwise they are split evenly.
function splitIntoDivisions(t, n, firstSize) {
  const rating = tm => (tm.playerIds || []).reduce((s, pid) => s + ((playerById(t, pid) || {}).rating || 0), 0);
  const sorted = (t.teams || []).slice().sort((a, b) => rating(b) - rating(a));
  const top = parseInt(firstSize, 10) || 0;
  if (n === 2 && top > 0 && top < sorted.length) {
    sorted.forEach((tm, i) => { tm.division = i < top ? 1 : 2; });
  } else {
    const per = Math.ceil(sorted.length / n);
    sorted.forEach((tm, i) => { tm.division = Math.min(n, Math.floor(i / per) + 1); });
  }
  t.divisions = n;
}

function finalizeOpenTeams(t) {
  let full = t.teams.filter(x => x.playerIds.length === t.teamSize);
  if (full.length < 2) return 'Need at least 2 full teams (' + t.teamSize + ' players each) to start';
  // Order is purely FIRST COME FIRST SERVED - by when the team completed, or an organizer's
  // explicit swap. Rating decides seeding, never who is in, and checking in never changes a
  // team's place in the queue.
  const key = tm => (tm.entryOrder != null ? tm.entryOrder : (tm.fullAt || tm.createdAt || 0));
  full = full.slice().sort((a, b) => key(a) - key(b));

  // Check-in is applied HERE, at launch, and nowhere else: teams that never checked in drop out
  // and the queue closes up behind them, so waiting teams take the freed slots in signup order.
  // Only when a deadline was actually set - otherwise check-in is informational and dropping
  // teams would be a nasty surprise. Guard: if this would leave fewer than two teams the
  // requirement is ignored, so a mis-set deadline can never wipe out a tournament.
  if (t.checkInDeadline) {
    const present = full.filter(x => x.checkedIn);
    if (present.length >= 2) full = present;
  }
  // maxTeams caps the number of PARTICIPANTS; overflow teams become reserves (0 = uncapped).
  const cap = t.maxTeams > 0 ? t.maxTeams : full.length;
  const entering = full.slice(0, cap);
  if (entering.length < 2) return 'Need at least 2 checked-in full teams to start (or clear the check-in requirement)';
  // seed the entering teams (rating or random)
  applySeeding(t, entering, tm => tm.playerIds.reduce((s, pid) => s + ((playerById(t, pid) || {}).rating || 0), 0) / t.teamSize);
  entering.forEach((tm, i) => { tm.seed = i + 1; });
  // everyone not entering -> players back to the pool; those + already-unteamed become reserves
  const inIds = {}; entering.forEach(tm => { inIds[tm.id] = 1; });
  for (const tm of t.teams) {
    if (!inIds[tm.id]) { for (const pid of tm.playerIds) { const p = playerById(t, pid); if (p) p.teamId = null; } }
  }
  t.teams = entering;
  t.teams.forEach(tm => { tm.joinRequests = []; });   // teams are locked; pending requests are void
  t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
  t.status = 'drafted';
  return null;
}

function formTeamsGrouped(t) {
  if (t.teamSize === 1) {
    if (t.players.length < 2) return 'Need at least 2 players';
    const arr = t.players.slice();
    applySeeding(t, arr, p => p.rating || 0);
    t.teams = [];
    arr.forEach((p, i) => makeTeam(t, p.name, p.id, [p.id], i + 1));
    t.subs = [];
    t.status = 'drafted';
    return null;
  }
  const groups = {};
  for (const p of t.players) {
    const key = (p.teamName || '').toLowerCase();
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  // Only full groups enter; extras beyond teamSize and incomplete groups become reserves.
  // maxTeams caps the entrants (earliest-formed groups first, by first member's signup).
  let entries = Object.values(groups)
    .map(g => g.slice().sort((a, b) => (a.signedAt || 0) - (b.signedAt || 0)))
    .filter(g => g.length >= t.teamSize)
    .map(g => g.slice(0, t.teamSize))
    .sort((a, b) => (a[0].signedAt || 0) - (b[0].signedAt || 0));
  if (t.maxTeams > 0) entries = entries.slice(0, t.maxTeams);
  if (entries.length < 2) return 'Need at least 2 full teams (' + t.teamSize + ' players each, same team name at signup)';
  applySeeding(t, entries, g => g.reduce((s, p) => s + (p.rating || 0), 0) / g.length);
  t.teams = [];
  entries.forEach((g, i) => makeTeam(t, g[0].teamName, g[0].id, g.map(p => p.id), i + 1));
  t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
  t.status = 'drafted';
  return null;
}

module.exports = { makeTeam, applySeeding, buildDraft, finishDraftIfDone, finalizeOpenTeams, formTeamsGrouped,
  divisionCaptainCfg, divisionPool, startNextDivision, splitIntoDivisions };
