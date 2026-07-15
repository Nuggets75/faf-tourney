// NOTE: not yet `// @ts-check` (same reason as lib/match.js: untyped dynamic
// tournament objects). Behaviour verified by the runtime test suite.
// Swiss format: standings, round pairing, byes, completion, and the after-report
// progression hook. Imports the shared match primitives (newMatch, initVeto) from
// lib/match.js. lib/match.js calls swissAfterReport back via its injected hook, so
// there is no circular import (swiss -> match only).
'use strict';

const { newMatch, initVeto } = require('./match');

function swissStandings(t) {
  const S = {};
  for (const team of t.teams) S[team.id] = { teamId: team.id, seed: team.seed, wins: 0, losses: 0, gd: 0, byes: 0 };
  for (const m of t.matches) {
    if (m.bracket !== 'sw') continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (S[id]) { S[id].wins++; S[id].byes++; S[id].gd += 1; }
    } else if (m.status === 'done') {
      const w = S[m.winner], l = S[m.loser];
      const ws = m.winner === m.team1 ? m.score1 : m.score2;
      const ls = m.winner === m.team1 ? m.score2 : m.score1;
      if (w) { w.wins++; w.gd += ws - ls; }
      if (l) { l.losses++; l.gd -= ws - ls; }
    }
  }
  return Object.values(S).sort((a, b) => b.wins - a.wins || b.gd - a.gd || a.seed - b.seed);
}

function swissPairRound(t, r) {
  const standings = swissStandings(t);
  const pool = standings.map(s => s.teamId);
  const played = {};
  for (const m of t.matches) {
    if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
      played[m.team1 + '|' + m.team2] = 1;
      played[m.team2 + '|' + m.team1] = 1;
    }
  }
  if (pool.length % 2 === 1) {
    let byeIdx = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      const st = standings.find(s => s.teamId === pool[i]);
      if (st && st.byes === 0) { byeIdx = i; break; }
    }
    const byeTeam = pool.splice(byeIdx, 1)[0];
    const bm = newMatch(t, 'sw', r, 99, t.cfg.bo);
    bm.team1 = byeTeam; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = byeTeam; bm.loser = 'BYE';
  }
  let idx = 0;
  while (pool.length) {
    const a = pool.shift();
    let j = 0;
    while (j < pool.length - 1 && played[a + '|' + pool[j]]) j++;
    const b = pool.splice(j, 1)[0];
    const m = newMatch(t, 'sw', r, idx++, t.cfg.bo);
    m.team1 = a; m.team2 = b; m.status = 'ready';
    initVeto(t, m);
  }
}

function swissMaxRound(t) {
  let r = 0;
  for (const m of t.matches) if (m.bracket === 'sw' && m.round > r) r = m.round;
  return r;
}

function swissProgress(t) {
  const st = {};
  for (const team of t.teams) st[team.id] = { played: 0, pending: false };
  for (const m of t.matches) {
    if (m.bracket !== 'sw') continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (st[id]) st[id].played++;
    } else if (m.status === 'done') {
      if (st[m.team1]) st[m.team1].played++;
      if (st[m.team2]) st[m.team2].played++;
    } else {
      if (st[m.team1]) st[m.team1].pending = true;
      if (st[m.team2]) st[m.team2].pending = true;
    }
  }
  return st;
}

function swissGiveBye(t, teamId, round) {
  const bm = newMatch(t, 'sw', round, 99, t.cfg.bo);
  bm.team1 = teamId; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = teamId; bm.loser = 'BYE';
}

function swissFinishIfDone(t) {
  const st = swissProgress(t);
  const unfinished = t.teams.filter(x => st[x.id].played < t.cfg.rounds);
  if (unfinished.length) return false;
  const gfExisting = t.matches.find(m => m.bracket === 'gf');
  if (t.cfg.final) {
    if (!gfExisting) {
      const top = swissStandings(t);
      const gf = newMatch(t, 'gf', 1, 0, t.cfg.finalBo);
      gf.team1 = top[0].teamId; gf.team2 = top[1].teamId; gf.status = 'ready';
    }
  } else if (!t.championTeamId) {
    const top = swissStandings(t);
    t.championTeamId = top[0].teamId;
    t.status = 'finished';
  }
  return true;
}

function swissAfterReport(t) {
  if (swissFinishIfDone(t)) return;

  if (t.cfg.fast) {
    // eager pairing: match up free teams as soon as possible
    const played = {};
    for (let guard = 0; guard < 200; guard++) {
      const st = swissProgress(t);
      const standingsOrder = swissStandings(t).map(x => x.teamId);
      const pos = {};
      standingsOrder.forEach((id, i) => { pos[id] = i; });
      const pool = t.teams
        .filter(x => st[x.id].played < t.cfg.rounds && !st[x.id].pending)
        .map(x => x.id)
        .sort((a, b) => (st[a].played - st[b].played) || (pos[a] - pos[b]));
      if (pool.length >= 2) {
        const playedPairs = {};
        for (const m of t.matches) {
          if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
            playedPairs[m.team1 + '|' + m.team2] = 1;
            playedPairs[m.team2 + '|' + m.team1] = 1;
          }
        }
        const a = pool[0];
        // prefer same progress + no rematch, then same progress, then no rematch, then anyone
        let b = pool.slice(1).find(x => st[x].played === st[a].played && !playedPairs[a + '|' + x]);
        if (!b) b = pool.slice(1).find(x => st[x].played === st[a].played);
        if (!b) b = pool.slice(1).find(x => !playedPairs[a + '|' + x]);
        if (!b) b = pool[1];
        const m = newMatch(t, 'sw', Math.min(st[a].played, st[b].played) + 1, 98, t.cfg.bo);
        m.team1 = a; m.team2 = b; m.status = 'ready';
        initVeto(t, m);
        continue; // try to pair more
      }
      if (pool.length === 1) {
        const othersPending = t.teams.some(x => x.id !== pool[0] && st[x.id].played < t.cfg.rounds && st[x.id].pending);
        if (!othersPending) {
          swissGiveBye(t, pool[0], st[pool[0]].played + 1);
          if (swissFinishIfDone(t)) return;
          continue;
        }
      }
      break;
    }
    swissFinishIfDone(t);
    return;
  }

  // classic: next round only when the current one is fully done
  const maxR = swissMaxRound(t);
  const open = t.matches.some(m => m.bracket === 'sw' && m.round === maxR &&
    (m.status === 'ready' || m.status === 'live' || m.status === 'waiting'));
  if (open) return;
  if (maxR < t.cfg.rounds) { swissPairRound(t, maxR + 1); return; }
  swissFinishIfDone(t);
}

module.exports = { swissStandings, swissPairRound, swissMaxRound, swissProgress, swissGiveBye, swissFinishIfDone, swissAfterReport };
