// NOTE: not yet `// @ts-check` (untyped dynamic tournament objects, like lib/match.js).
// Team formation: manual/open/grouped team creation, draft setup, and seeding.
// Pure with respect to app I/O - operates only on the tournament object plus the
// shared lookups/helpers from lib/util.js.
'use strict';

const { uid, shuffle, playerById, teamById } = require('./util');

function makeTeam(t, name, captainPid, memberPids, seed) {
  const team = {
    id: 't' + uid(4), name, seed,
    captainId: captainPid, playerIds: memberPids.slice(),
    captainToken: uid(10), eliminated: false, out: null
  };
  t.teams.push(team);
  for (const pid of memberPids) { const p = playerById(t, pid); if (p) p.teamId = team.id; }
  return team;
}

function applySeeding(t, arr, avgFn) {
  if (t.seeding === 'rating') arr.sort((a, b) => avgFn(b) - avgFn(a));
  else if (t.seeding === 'manual') arr.sort((a, b) => (a.seed || 0) - (b.seed || 0)); // keep the organizer's order (set via reseed)
  else shuffle(arr);
}

function buildDraft(t, captainIds) {
  t.teams = [];
  const seeds = captainIds.slice();
  applySeeding(t, seeds, pid => (playerById(t, pid).rating || 0));
  seeds.forEach((pid, i) => {
    const p = playerById(t, pid);
    makeTeam(t, 'Team ' + p.name, pid, [pid], i + 1);
  });
  const numTeams = t.teams.length;
  const picksPerTeam = Math.max(0, t.teamSize - 1);
  const poolSize = t.players.filter(p => !p.teamId).length;
  const totalPicks = Math.min(numTeams * picksPerTeam, poolSize);
  const base = t.teams.map(x => x.id);
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
  t.draft = { order, current: 0 };
  t.status = 'draft';
}

function finishDraftIfDone(t) {
  if (!t.draft) return;
  if (t.draft.current >= t.draft.order.length) {
    t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
    t.status = 'drafted';
    t.draft.done = true;
  }
}

function finalizeOpenTeams(t) {
  let full = t.teams.filter(x => x.playerIds.length === t.teamSize);
  if (full.length < 2) return 'Need at least 2 full teams (' + t.teamSize + ' players each) to start';
  // Selection order: checked-in teams first (if check-in is in use), then by signup order.
  const useCheckin = !!t.checkInDeadline || full.some(x => x.checkedIn);
  full = full.slice().sort((a, b) => {
    if (useCheckin && !!a.checkedIn !== !!b.checkedIn) return a.checkedIn ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
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

module.exports = { makeTeam, applySeeding, buildDraft, finishDraftIfDone, finalizeOpenTeams, formTeamsGrouped };
