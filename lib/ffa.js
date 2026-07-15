// NOTE: not yet `// @ts-check` (same reason as lib/match.js).
// Free-for-all format: group distribution, point totals, ranking, round creation,
// elimination, and after-report progression. Imports shared primitives from
// lib/match.js and lib/util.js.
'use strict';

const { newMatch } = require('./match');
const { shuffle, teamById } = require('./util');

function ffaGroups(entrantIds, perMatch) {
  const k = entrantIds.length;
  let g = Math.ceil(k / perMatch);
  if (g > 1 && Math.floor(k / g) < 2) g = Math.max(1, Math.floor(k / 2));
  const base = Math.floor(k / g), extra = k - base * g;
  const groups = [];
  let pos = 0;
  for (let i = 0; i < g; i++) {
    const sz = base + (i < extra ? 1 : 0);
    groups.push(entrantIds.slice(pos, pos + sz));
    pos += sz;
  }
  return groups;
}

function ffaTotals(t) {
  const tot = {};
  for (const team of t.teams) tot[team.id] = 0;
  for (const m of t.matches) {
    if (m.bracket !== 'ffa' || !m.points) continue;
    for (const id of Object.keys(m.points)) {
      if (tot[id] !== undefined) tot[id] += m.points[id];
    }
  }
  return tot;
}

function ffaRank(t, ids) {
  const tot = ffaTotals(t);
  return ids.slice().sort((a, b) => (tot[b] || 0) - (tot[a] || 0) ||
    (teamById(t, a).seed - teamById(t, b).seed));
}

function ffaCreateRound(t, r, entrantIds) {
  let ordered;
  if (t.ffaCfg.mode === 'points' && r > 1) {
    ordered = ffaRank(t, entrantIds); // group leaders together (snake distribution)
  } else {
    ordered = shuffle(entrantIds.slice());
  }
  const groups = ffaGroups(ordered.length ? ordered : entrantIds, t.ffaCfg.perMatch);
  // snake-distribute for points mode so lobbies are balanced by standings
  if (t.ffaCfg.mode === 'points' && r > 1 && groups.length > 1) {
    const g = groups.length;
    const redis = [];
    for (let i = 0; i < g; i++) redis.push([]);
    ordered.forEach((id, i) => {
      const row = Math.floor(i / g);
      const col = (row % 2 === 0) ? (i % g) : (g - 1 - (i % g));
      redis[col].push(id);
    });
    groups.length = 0;
    for (const grp of redis) if (grp.length) groups.push(grp);
  }
  groups.forEach((grp, i) => {
    const m = newMatch(t, 'ffa', r, i, 1);
    m.entrants = grp;
    m.winners = [];
    m.points = null;
    m.status = 'ready';
  });
}

function ffaMaxRound(t) {
  let r = 0;
  for (const m of t.matches) if (m.bracket === 'ffa' && m.round > r) r = m.round;
  return r;
}

function ffaMarkOut(t, id, round) {
  const lt = teamById(t, id);
  if (lt) { lt.eliminated = true; lt.out = { bracket: 'ffa', round }; }
}

function ffaAfterReport(t) {
  const maxR = ffaMaxRound(t);
  const roundMatches = t.matches.filter(m => m.bracket === 'ffa' && m.round === maxR);
  if (roundMatches.some(m => m.status !== 'done')) return;
  const cfg = t.ffaCfg;

  if (cfg.mode === 'points') {
    const finalM = roundMatches.find(m => m.isFinal);
    if (finalM) {
      t.championTeamId = finalM.winners[0];
      t.status = 'finished';
      for (const id of finalM.entrants) if (id !== t.championTeamId) ffaMarkOut(t, id, maxR);
      return;
    }
    let survivors = [];
    for (const m of roundMatches) survivors = survivors.concat(m.entrants);
    if (maxR < cfg.rounds) {
      if (cfg.cutTo >= 2 && survivors.length > cfg.cutTo) {
        const ranked = ffaRank(t, survivors);
        for (const id of ranked.slice(cfg.cutTo)) ffaMarkOut(t, id, maxR);
        survivors = ranked.slice(0, cfg.cutTo);
      }
      ffaCreateRound(t, maxR + 1, survivors);
      return;
    }
    // all scheduled rounds played
    const ranked = ffaRank(t, survivors);
    if (cfg.finalSize >= 2 && ranked.length > 1) {
      const fin = ranked.slice(0, Math.min(cfg.finalSize, ranked.length));
      for (const id of ranked.slice(fin.length)) ffaMarkOut(t, id, maxR);
      const m = newMatch(t, 'ffa', maxR + 1, 0, 1);
      m.entrants = fin; m.winners = []; m.points = null; m.isFinal = 1; m.status = 'ready';
      return;
    }
    t.championTeamId = ranked[0];
    t.status = 'finished';
    return;
  }

  // knockout mode
  let winners = [];
  for (const m of roundMatches) winners = winners.concat(m.winners);
  if (winners.length === 1) {
    t.championTeamId = winners[0];
    t.status = 'finished';
    return;
  }
  ffaCreateRound(t, maxR + 1, winners);
}

module.exports = { ffaGroups, ffaTotals, ffaRank, ffaCreateRound, ffaMaxRound, ffaMarkOut, ffaAfterReport };
