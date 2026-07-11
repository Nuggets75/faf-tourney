// FAF Tourney — zero-dependency tournament manager
// Node 18+ only. No npm install needed.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8090', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Site-wide admin password. Set via ADMIN_PASSWORD environment variable in the
// Dockhand stack — NOT in this repo, so it is never visible on GitHub.
const GADMIN = process.env.ADMIN_PASSWORD || '';
const BOOT = String(Date.now()); // cache-buster, changes every container restart

// ---------- storage ----------

let db = { tournaments: {} };

function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.tournaments) db.tournaments = {};
  } catch (e) {
    db = { tournaments: {} };
  }
  // migrate v1 records so old test tournaments don't crash the client
  for (const t of Object.values(db.tournaments)) {
    if (!t.competition) {
      t.competition = 'team';
      t.bracketType = 'single';
      t.formation = t.format === 'premade' ? 'premade' : 'draft';
      t.draftOrder = 'snake';
    }
    if (!t.maps) t.maps = {};
    if (t.lobbyOptions === undefined) t.lobbyOptions = '';
    if (t.mods === undefined) t.mods = '';
    for (const m of (t.matches || [])) {
      if (!m.bracket) m.bracket = 'wb';
      if (!m.bo) m.bo = t.bestOf || 3;
    }
  }
}

let saveTimer = null;
function saveDB() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('save failed:', e.message);
    }
  }, 150);
}

function uid(len) { return crypto.randomBytes(len || 8).toString('hex'); }
function now() { return Date.now(); }

// ---------- helpers ----------

function getT(id) { return db.tournaments[id] || null; }
function isAdmin(t, token) { return !!token && (token === t.adminToken || (GADMIN && token === GADMIN)); }

function teamOfCaptainToken(t, token) {
  if (!token) return null;
  for (const team of t.teams) if (team.captainToken === token) return team;
  return null;
}
function playerById(t, pid) { return t.players.find(p => p.id === pid) || null; }
function teamById(t, tid) { return t.teams.find(x => x.id === tid) || null; }
function matchById(t, mid) { return t.matches.find(x => x.id === mid) || null; }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function publicView(t) {
  return {
    id: t.id, name: t.name, description: t.description,
    lobbyOptions: t.lobbyOptions || '', mods: t.mods || '',
    competition: t.competition, formation: t.formation,
    teamSize: t.teamSize, draftOrder: t.draftOrder,
    bracketType: t.bracketType, ffaCfg: t.ffaCfg || null,
    plan: t.plan || null, maxTeams: t.maxTeams || 0,
    cfg: t.cfg || null, seeding: t.seeding,
    status: t.status, createdAt: t.createdAt,
    rounds: t.rounds || 0,
    maps: t.maps || {},
    players: t.players,
    teams: t.teams.map(x => ({
      id: x.id, name: x.name, seed: x.seed,
      captainId: x.captainId, playerIds: x.playerIds,
      eliminated: x.eliminated || false,
      out: x.out || null
    })),
    draft: t.draft,
    matches: t.matches,
    championTeamId: t.championTeamId || null,
    subs: t.subs || []
  };
}

// ---------- generic elimination engine ----------
// slot values: null = pending, 'BYE' = confirmed empty, otherwise teamId

function newMatch(t, bracket, round, index, bo) {
  const m = {
    id: 'm' + uid(4), bracket, round, index, bo: bo || 3, hcap: 0,
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
  if (m.bracket === 'sw') { swissAfterReport(t); return; }
  routeVal(t, m, false, m.loser);
  routeVal(t, m, true, m.winner);
}

// undo a done match (admin correction). returns error string or null
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

// ---------- bracket construction ----------

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
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }
function log2i(n) { let r = 0; while ((1 << r) < n) r++; return r; }

function seededSlots(t) {
  const teams = t.teams.slice().sort((a, b) => a.seed - b.seed);
  const size = nextPow2(teams.length);
  return seedOrder(size).map(s => (s <= teams.length ? teams[s - 1].id : 'BYE'));
}

const BO_OK = [1, 3, 5, 7];
function cleanBoList(arr, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    const v = parseInt(Array.isArray(arr) ? arr[i] : null, 10);
    out.push(BO_OK.indexOf(v) >= 0 ? v : 3);
  }
  return out;
}

function buildSingle(t, cfg) {
  const slots = seededSlots(t);
  const size = slots.length;
  const R = log2i(size);
  t.rounds = R;
  const grid = {};
  for (let r = 1; r <= R; r++) {
    grid[r] = [];
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) grid[r].push(newMatch(t, 'wb', r, i, cfg.rounds[r - 1]));
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

function buildDouble(t, cfg) {
  const slots = seededSlots(t);
  const size = slots.length; // >= 4 (n>=3 enforced by caller)
  const R = log2i(size);
  t.rounds = R;
  const wb = {}, lb = {};
  for (let r = 1; r <= R; r++) {
    wb[r] = [];
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) wb[r].push(newMatch(t, 'wb', r, i, cfg.wb[r - 1]));
  }
  const lbRounds = 2 * R - 2;
  for (let q = 1; q <= lbRounds; q++) {
    lb[q] = [];
    const k = (q % 2 === 1) ? (q + 3) / 2 : (q + 2) / 2;
    const count = size / Math.pow(2, k);
    for (let i = 0; i < count; i++) lb[q].push(newMatch(t, 'lb', q, i, cfg.lb[q - 1]));
  }
  const gf = newMatch(t, 'gf', 1, 0, cfg.gf);
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

// ---------- swiss ----------

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
  }
}

function swissMaxRound(t) {
  let r = 0;
  for (const m of t.matches) if (m.bracket === 'sw' && m.round > r) r = m.round;
  return r;
}

// per-team progress: how many swiss matches completed (incl. byes), any pending?
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

// ---------- FFA ----------

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

// total points per team across all FFA matches
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

// ---------- teams & draft ----------

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
  const entries = Object.values(groups);
  if (entries.length < 2) return 'Need at least 2 teams (players set a team name at signup)';
  applySeeding(t, entries, g => g.reduce((s, p) => s + (p.rating || 0), 0) / g.length);
  t.teams = [];
  entries.forEach((g, i) => makeTeam(t, g[0].teamName, g[0].id, g.map(p => p.id), i + 1));
  t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
  t.status = 'drafted';
  return null;
}

// ---------- API plumbing ----------

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function bad(res, msg) { json(res, 400, { error: msg }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 200000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function cleanName(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>]/g, '').trim().slice(0, max || 40);
}
function intIn(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  return (n >= lo && n <= hi) ? n : dflt;
}

// ---------- API ----------

async function handleAPI(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'POST') {
    const b = await readBody(req);
    const name = cleanName(b.name, 60);
    if (!name) return bad(res, 'Name required');
    const competition = b.competition === 'ffa' ? 'ffa' : 'team';
    let teamSize, formation, bracketType = 'single', ffaCfg = null, draftOrder = 'linear', plan = null;
    const pb = b.plan || {};
    const bo = (v, d) => BO_OK.indexOf(parseInt(v, 10)) >= 0 ? parseInt(v, 10) : d;
    if (competition === 'team') {
      teamSize = intIn(b.teamSize, 1, 6, 2);
      formation = (teamSize === 1) ? 'solo' : (b.formation === 'premade' ? 'premade' : 'draft');
      bracketType = ['single', 'double', 'swiss'].indexOf(b.bracketType) >= 0 ? b.bracketType : 'single';
      draftOrder = b.draftOrder === 'snake' ? 'snake' : 'linear';
      if (bracketType === 'single') {
        plan = { early: bo(pb.early, 3), semi: bo(pb.semi, 3), final: bo(pb.final, 5) };
      } else if (bracketType === 'double') {
        plan = { wb: bo(pb.wb, 3), wbFinal: bo(pb.wbFinal, 3), lb: bo(pb.lb, 3), lbFinal: bo(pb.lbFinal, 3), gf: bo(pb.gf, 5), lbHandicap: pb.lbHandicap ? 1 : 0 };
      } else {
        plan = { bo: (parseInt(pb.bo, 10) === 1) ? 1 : 3, final: pb.final ? 1 : 0, finalBo: bo(pb.finalBo, 5), fast: pb.fast ? 1 : 0 };
      }
    } else {
      teamSize = intIn(b.teamSize, 1, 3, 1);
      formation = (teamSize === 1) ? 'solo' : 'premade';
      const mode = b.mode === 'points' ? 'points' : 'elim';
      ffaCfg = {
        perMatch: intIn(b.perMatch, 2, 16, Math.min(6, Math.floor(16 / teamSize))),
        advance: intIn(b.advance, 1, 4, 1),
        mode,
        rounds: intIn(b.rounds, 1, 10, 3),
        cutTo: intIn(b.cutTo, 0, 64, 0),
        finalSize: intIn(b.finalSize, 0, 16, 0)
      };
      if (ffaCfg.cutTo === 1) ffaCfg.cutTo = 2;
      if (ffaCfg.finalSize === 1) ffaCfg.finalSize = 2;
    }
    const maxTeams = intIn(b.maxTeams, 0, 128, 0);
    const t = {
      id: uid(5), adminToken: uid(12),
      name, description: cleanName(b.description, 500),
      lobbyOptions: cleanName(b.lobbyOptions, 500),
      mods: cleanName(b.mods, 500),
      competition, formation, teamSize, draftOrder, bracketType, ffaCfg,
      plan, maxTeams,
      cfg: null, maps: {},
      seeding: (b.seeding === 'rating') ? 'rating' : 'random',
      status: 'signup', createdAt: now(),
      players: [], teams: [], matches: [], rounds: 0, draft: null, subs: []
    };
    db.tournaments[t.id] = t;
    saveDB();
    return json(res, 200, { id: t.id, adminToken: t.adminToken });
  }

  if (parts.length === 2 && parts[1] === 'siteadmin' && method === 'POST') {
    const b = await readBody(req);
    if (!GADMIN) return bad(res, 'Site admin is not configured on the server (ADMIN_PASSWORD env var not set)');
    if (b.password !== GADMIN) return json(res, 403, { error: 'Wrong password' });
    return json(res, 200, { ok: true });
  }

  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'GET') {
    const list = Object.values(db.tournaments)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => ({
        id: t.id, name: t.name, status: t.status,
        competition: t.competition, bracketType: t.bracketType,
        teamSize: t.teamSize, players: t.players.length,
        teams: t.teams.length, createdAt: t.createdAt
      }));
    return json(res, 200, list);
  }

  if (parts.length >= 3 && parts[1] === 't') {
    const t = getT(parts[2]);
    if (!t) return json(res, 404, { error: 'Tournament not found' });
    const sub = parts[3] || '';

    if (method === 'GET' && !sub) return json(res, 200, publicView(t));

    if (method === 'GET' && sub === 'secrets') {
      if (!isAdmin(t, url.searchParams.get('admin'))) return json(res, 403, { error: 'Admin token required' });
      return json(res, 200, {
        adminToken: t.adminToken,
        captains: t.teams.map(x => ({
          teamId: x.id, teamName: x.name,
          captainName: (playerById(t, x.captainId) || {}).name || '',
          token: x.captainToken
        }))
      });
    }

    if (method !== 'POST') return bad(res, 'Unsupported');
    const b = await readBody(req);

    if (sub === 'delete') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      delete db.tournaments[t.id];
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'signup') {
      if (t.status !== 'signup') return bad(res, 'Signups are closed');
      if (t.formation === 'premade' && t.teamSize > 1) return bad(res, 'This tournament uses whole-team registration \u2014 one player registers the full team');
      if (t.maxTeams > 0 && t.formation === 'solo' && t.players.length >= t.maxTeams) return bad(res, 'The tournament is full (' + t.maxTeams + ' entrants)');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Player name required');
      if (t.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return bad(res, 'That name is already signed up');
      const rating = parseInt(b.rating, 10);
      if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter your FAF rating (0\u20134000)');
      const p = {
        id: 'p' + uid(4), name, rating,
        teamName: (t.formation === 'premade') ? cleanName(b.teamName, 30) : '',
        teamId: null, signedAt: now()
      };
      t.players.push(p);
      saveDB();
      return json(res, 200, { ok: true, playerId: p.id });
    }

    if (sub === 'signup_team') {
      if (t.status !== 'signup') return bad(res, 'Signups are closed');
      if (t.formation !== 'premade' || t.teamSize < 2) return bad(res, 'This tournament uses solo signups');
      const teamName = cleanName(b.teamName, 30);
      if (!teamName) return bad(res, 'Team name required');
      if (t.maxTeams > 0) {
        const names = {};
        for (const p of t.players) if (p.teamName) names[p.teamName.toLowerCase()] = 1;
        if (Object.keys(names).length >= t.maxTeams) return bad(res, 'The tournament is full (' + t.maxTeams + ' teams)');
      }
      if (t.players.some(p => (p.teamName || '').toLowerCase() === teamName.toLowerCase())) {
        return bad(res, 'A team named "' + teamName + '" already exists \u2014 pick a different name');
      }
      const arr = Array.isArray(b.players) ? b.players : [];
      if (arr.length !== t.teamSize) return bad(res, 'Enter all ' + t.teamSize + ' players');
      const seen = {};
      const cleaned = [];
      for (const it of arr) {
        const pname = cleanName(it && it.name, 30);
        if (!pname) return bad(res, 'Every player needs a name');
        const low = pname.toLowerCase();
        if (seen[low]) return bad(res, 'Duplicate player in your list: ' + pname);
        seen[low] = 1;
        if (t.players.some(p => p.name.toLowerCase() === low)) return bad(res, pname + ' is already signed up in another team');
        const rating = parseInt(it && it.rating, 10);
        if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter a rating (0\u20134000) for ' + pname);
        cleaned.push({ name: pname, rating });
      }
      for (const it of cleaned) {
        t.players.push({ id: 'p' + uid(4), name: it.name, rating: it.rating, teamName, teamId: null, signedAt: now() });
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'remove') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      if (t.status !== 'signup') return bad(res, 'Can only remove players during signups');
      const p = playerById(t, b.playerId);
      if (p && t.formation === 'premade' && t.teamSize > 1 && p.teamName) {
        const key = p.teamName.toLowerCase();
        t.players = t.players.filter(x => (x.teamName || '').toLowerCase() !== key);
      } else {
        t.players = t.players.filter(x => x.id !== b.playerId);
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit player (admin, any time) — this is also the substitution mechanism:
    // rename the dropped player to the sub's FAF name and fix the rating
    if (sub === 'edit_player') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Name required');
      if (t.players.some(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) {
        return bad(res, 'Another player already has that name');
      }
      const rating = parseInt(b.rating, 10);
      if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Rating must be 0\u20134000');
      const oldName = p.name;
      p.name = name;
      p.rating = rating;
      // keep auto-derived team names in sync
      for (const team of t.teams) {
        if (team.captainId === p.id) {
          if (team.name === 'Team ' + oldName) team.name = 'Team ' + name;
          if (team.name === oldName) team.name = name; // solo teams
        }
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit tournament info (admin, any time)
    if (sub === 'edit_info') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      if (b.description !== undefined) t.description = cleanName(b.description, 500);
      if (b.lobbyOptions !== undefined) t.lobbyOptions = cleanName(b.lobbyOptions, 500);
      if (b.mods !== undefined) t.mods = cleanName(b.mods, 500);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // set maps for a round (admin, any time)
    if (sub === 'set_maps') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      const bracket = String(b.bracket || '');
      const round = parseInt(b.round, 10);
      if (['wb', 'lb', 'gf', 'sw', 'ffa'].indexOf(bracket) < 0 || !(round >= 1 && round <= 30)) return bad(res, 'Bad round');
      let maps = Array.isArray(b.maps) ? b.maps.map(m => cleanName(m, 50)).filter(m => m) : [];
      maps = maps.slice(0, 9);
      t.maps[bracket + ':' + round] = maps;
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'phase') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      const a = b.action;

      if (a === 'reopen_signups') {
        if (['signup', 'draft', 'drafted'].indexOf(t.status) < 0) return bad(res, 'Bracket already started');
        t.status = 'signup';
        t.teams = []; t.draft = null; t.subs = [];
        for (const p of t.players) p.teamId = null;
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'start_draft') {
        if (t.formation !== 'draft') return bad(res, 'This tournament does not use a draft');
        if (t.status !== 'signup') return bad(res, 'Draft already started');
        const capIds = Array.isArray(b.captainIds) ? b.captainIds.filter(id => playerById(t, id)) : [];
        if (capIds.length < 2) return bad(res, 'Pick at least 2 captains');
        buildDraft(t, capIds);
        finishDraftIfDone(t);
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'form_teams') {
        if (t.formation === 'draft') return bad(res, 'This tournament drafts teams');
        if (t.status !== 'signup') return bad(res, 'Teams already formed');
        const err = formTeamsGrouped(t);
        if (err) return bad(res, err);
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'start_bracket') {
        if (t.status !== 'drafted') return bad(res, 'Form teams first');
        const n = t.teams.length;
        if (n < 2) return bad(res, 'Need at least 2 teams');
        const c = b.config || {};

        if (t.competition === 'ffa') {
          ffaCreateRound(t, 1, t.teams.map(x => x.id));
          t.status = 'running';
        } else if (t.bracketType === 'single') {
          const R = log2i(nextPow2(n));
          t.cfg = { rounds: cleanBoList(c.rounds, R) };
          buildSingle(t, t.cfg);
          if (t.status !== 'finished') t.status = 'running';
        } else if (t.bracketType === 'double') {
          if (n < 3) return bad(res, 'Double elimination needs at least 3 teams');
          const R = log2i(nextPow2(n));
          t.cfg = {
            wb: cleanBoList(c.wb, R),
            lb: cleanBoList(c.lb, 2 * R - 2),
            gf: BO_OK.indexOf(parseInt(c.gf, 10)) >= 0 ? parseInt(c.gf, 10) : 5,
            lbHandicap: c.lbHandicap ? 1 : 0
          };
          buildDouble(t, t.cfg);
          if (t.status !== 'finished') t.status = 'running';
        } else { // swiss
          const defR = Math.max(1, log2i(nextPow2(n)));
          t.cfg = {
            rounds: intIn(c.rounds, 1, 15, defR),
            bo: (parseInt(c.bo, 10) === 1) ? 1 : 3,
            final: c.final ? 1 : 0,
            finalBo: BO_OK.indexOf(parseInt(c.finalBo, 10)) >= 0 ? parseInt(c.finalBo, 10) : 5,
            fast: c.fast ? 1 : 0
          };
          swissPairRound(t, 1);
          t.status = 'running';
        }
        saveDB();
        return json(res, 200, { ok: true });
      }

      return bad(res, 'Unknown action');
    }

    if (sub === 'pick') {
      if (t.status !== 'draft' || !t.draft) return bad(res, 'No draft in progress');
      const d = t.draft;
      if (d.current >= d.order.length) return bad(res, 'Draft is complete');
      const turnTeamId = d.order[d.current];
      const admin = isAdmin(t, b.token);
      const capTeam = teamOfCaptainToken(t, b.token);
      if (!admin && (!capTeam || capTeam.id !== turnTeamId)) return json(res, 403, { error: 'Not your pick' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      if (p.teamId) return bad(res, 'Player already picked');
      const team = teamById(t, turnTeamId);
      p.teamId = team.id;
      team.playerIds.push(p.id);
      d.current++;
      finishDraftIfDone(t);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // score report — supports running (partial) scores
    if (sub === 'report') {
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      const admin = isAdmin(t, b.token);
      const capTeam = teamOfCaptainToken(t, b.token);

      // ---- FFA ----
      if (m.bracket === 'ffa') {
        if (!admin && (!capTeam || m.entrants.indexOf(capTeam.id) < 0)) {
          return json(res, 403, { error: 'Only participants or the organizer can report this match' });
        }
        if (m.status === 'done') {
          if (!admin) return bad(res, 'Already reported — only the organizer can correct it');
          if (t.matches.some(x => x.bracket === 'ffa' && x.round > m.round)) {
            return bad(res, 'The next round was already generated — cannot correct');
          }
          // undo
          for (const eid of m.entrants) {
            const lt = teamById(t, eid);
            if (lt) { lt.eliminated = false; lt.out = null; }
          }
          m.winners = [];
          m.points = null;
          m.status = 'ready';
          t.championTeamId = null;
          if (t.status === 'finished') t.status = 'running';
        }
        if (m.status !== 'ready') return bad(res, 'Match not ready');

        if (t.ffaCfg.mode === 'points' && !m.isFinal) {
          // points per entrant
          const pts = (b.points && typeof b.points === 'object') ? b.points : {};
          const stored = {};
          for (const eid of m.entrants) {
            const v = parseInt(pts[eid], 10);
            if (!(v >= 0 && v <= 1000)) return bad(res, 'Enter points (0\u20131000) for every player');
            stored[eid] = v;
          }
          m.points = stored;
          m.status = 'done';
          ffaAfterReport(t);
          saveDB();
          return json(res, 200, { ok: true });
        }

        const roundMatchCount = t.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
        const isFinal = m.isFinal || roundMatchCount === 1;
        const need = isFinal ? 1 : Math.min(t.ffaCfg.advance, m.entrants.length - 1);
        const win = Array.isArray(b.winners) ? b.winners.filter(id => m.entrants.indexOf(id) >= 0) : [];
        if (win.length !== need) return bad(res, 'Select exactly ' + need + ' winner' + (need > 1 ? 's' : ''));
        m.winners = win;
        m.status = 'done';
        if (t.ffaCfg.mode !== 'points') {
          for (const eid of m.entrants) {
            if (win.indexOf(eid) < 0) {
              const lt = teamById(t, eid);
              if (lt) { lt.eliminated = true; lt.out = { bracket: 'ffa', round: m.round }; }
            }
          }
        }
        ffaAfterReport(t);
        saveDB();
        return json(res, 200, { ok: true });
      }

      // ---- 1v1-style matches (wb / lb / gf / sw) ----
      if (!admin && (!capTeam || (capTeam.id !== m.team1 && capTeam.id !== m.team2))) {
        return json(res, 403, { error: 'Only the two captains or the organizer can report this match' });
      }

      if (m.status === 'done') {
        if (!admin) return bad(res, 'Already reported — only the organizer can correct it');
        if (m.bracket === 'sw') {
          const later = t.matches.some(x => x.bracket === 'sw' && x.round > m.round && (x.status === 'live' || x.status === 'done') &&
            (x.team1 === m.team1 || x.team1 === m.team2 || x.team2 === m.team1 || x.team2 === m.team2));
          const gf = t.matches.find(x => x.bracket === 'gf');
          if (later || (gf && (gf.status === 'live' || gf.status === 'done'))) {
            return bad(res, 'Later matches already played — cannot correct');
          }
          m.status = 'ready'; m.winner = null; m.loser = null;
        } else {
          const err = undoMatch(t, m);
          if (err) return bad(res, err);
        }
      }

      if (m.status !== 'ready' && m.status !== 'live') return bad(res, 'Match not ready yet');
      const maxW = Math.ceil(m.bo / 2);
      const s1 = parseInt(b.score1, 10), s2 = parseInt(b.score2, 10);
      if (!(s1 >= 0 && s2 >= 0 && s1 <= maxW && s2 <= maxW)) return bad(res, 'Scores must be between 0 and ' + maxW);
      if (m.hcap && s1 < 1) return bad(res, 'This grand final starts 1-0 (upper bracket advantage)');
      if (s1 === maxW && s2 === maxW) return bad(res, 'Both teams cannot reach ' + maxW);

      if (s1 === maxW || s2 === maxW) {
        finalizeMatch(t, m, s1, s2);
      } else {
        m.score1 = s1; m.score2 = s2;
        m.status = 'live';
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    return bad(res, 'Unknown endpoint');
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------- static ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function serveStatic(req, res, url) {
  let p = url.pathname;
  if (p === '/' || p.startsWith('/t/')) p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    if (file.endsWith('index.html')) data = data.toString().replace(/__V__/g, BOOT);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

loadDB();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Server error: ' + e.message });
  }
});

server.listen(PORT, () => console.log('FAF Tourney running on port ' + PORT));
