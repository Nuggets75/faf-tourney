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

// ---------- storage ----------

let db = { tournaments: {} };

function loadDB() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.tournaments) db.tournaments = {};
  } catch (e) {
    db = { tournaments: {} };
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

function uid(len) {
  return crypto.randomBytes(len || 8).toString('hex');
}

// ---------- helpers ----------

function now() { return Date.now(); }

function getT(id) { return db.tournaments[id] || null; }

function isAdmin(t, token) { return !!token && token === t.adminToken; }

function teamOfCaptainToken(t, token) {
  if (!token) return null;
  for (const team of t.teams) if (team.captainToken === token) return team;
  return null;
}

function playerById(t, pid) {
  return t.players.find(p => p.id === pid) || null;
}

function teamById(t, tid) {
  return t.teams.find(x => x.id === tid) || null;
}

// Public view: strip secrets
function publicView(t) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    format: t.format,
    teamSize: t.teamSize,
    bestOf: t.bestOf,
    seeding: t.seeding,
    status: t.status,
    createdAt: t.createdAt,
    players: t.players,
    teams: t.teams.map(x => ({
      id: x.id, name: x.name, seed: x.seed,
      captainId: x.captainId, playerIds: x.playerIds,
      eliminated: x.eliminated || false
    })),
    draft: t.draft,
    matches: t.matches,
    championTeamId: t.championTeamId || null,
    subs: t.subs || []
  };
}

// ---------- bracket ----------

// classic seed placement order for a bracket of size n (power of two)
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

function buildBracket(t) {
  const teams = t.teams.slice().sort((a, b) => a.seed - b.seed);
  const n = teams.length;
  if (n < 2) return false;
  const size = nextPow2(n);
  const order = seedOrder(size); // seeds by slot position
  const slots = order.map(s => (s <= n ? teams[s - 1].id : null));

  const rounds = Math.log2(size);
  const matches = [];
  let idCounter = 1;

  // create empty structure
  for (let r = 1; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) {
      matches.push({
        id: 'm' + (idCounter++),
        round: r,
        index: i,
        team1: null, team2: null,
        score1: null, score2: null,
        winner: null,
        status: 'waiting' // waiting | ready | done | bye
      });
    }
  }

  function matchAt(round, index) {
    return matches.find(m => m.round === round && m.index === index);
  }

  // fill round 1
  const r1count = size / 2;
  for (let i = 0; i < r1count; i++) {
    const m = matchAt(1, i);
    m.team1 = slots[i * 2];
    m.team2 = slots[i * 2 + 1];
  }

  t.matches = matches;
  t.rounds = rounds;

  // resolve byes + readiness
  for (const m of matches.filter(x => x.round === 1)) {
    if (m.team1 && !m.team2) { advance(t, m, m.team1, true); }
    else if (m.team2 && !m.team1) { advance(t, m, m.team2, true); }
    else if (m.team1 && m.team2) { m.status = 'ready'; }
  }
  return true;
}

function advance(t, m, winnerTeamId, isBye) {
  m.winner = winnerTeamId;
  m.status = isBye ? 'bye' : 'done';
  const loserId = (m.team1 === winnerTeamId) ? m.team2 : m.team1;
  if (!isBye && loserId) {
    const lt = teamById(t, loserId);
    if (lt) lt.eliminated = true;
  }
  const nextRound = m.round + 1;
  if (nextRound > t.rounds) {
    t.championTeamId = winnerTeamId;
    t.status = 'finished';
    return;
  }
  const next = t.matches.find(x => x.round === nextRound && x.index === Math.floor(m.index / 2));
  if (!next) return;
  if (m.index - Math.floor(m.index / 2) * 2 === 0) next.team1 = winnerTeamId;
  else next.team2 = winnerTeamId;
  if (next.team1 && next.team2) next.status = 'ready';
  // double-bye chains (tiny brackets): if the other feeder was a bye slot that can never fill
  const feederA = t.matches.find(x => x.round === m.round && x.index === Math.floor(m.index / 2) * 2);
  const feederB = t.matches.find(x => x.round === m.round && x.index === Math.floor(m.index / 2) * 2 + 1);
  const other = (feederA === m) ? feederB : feederA;
  if (other && !other.team1 && !other.team2 && other.status === 'waiting') {
    other.status = 'bye';
    // next gets winner by walkover
    if (next.team1 && !next.team2) advance(t, next, next.team1, true);
    else if (next.team2 && !next.team1) advance(t, next, next.team2, true);
  }
}

// ---------- draft ----------

function buildDraft(t, captainIds) {
  // teams: one per captain, named after captain
  t.teams = [];
  const seeds = captainIds.slice();
  if (t.seeding === 'rating') {
    seeds.sort((a, b) => (playerById(t, b).rating || 0) - (playerById(t, a).rating || 0));
  } else {
    for (let i = seeds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = seeds[i]; seeds[i] = seeds[j]; seeds[j] = tmp;
    }
  }
  seeds.forEach((pid, i) => {
    const p = playerById(t, pid);
    const team = {
      id: 't' + uid(4),
      name: 'Team ' + p.name,
      seed: i + 1,
      captainId: pid,
      playerIds: [pid],
      captainToken: uid(10),
      eliminated: false
    };
    t.teams.push(team);
    p.teamId = team.id;
  });

  // snake order of team ids across (teamSize - 1) rounds
  const numTeams = t.teams.length;
  const picksPerTeam = Math.max(0, t.teamSize - 1);
  const poolSize = t.players.filter(p => !p.teamId).length;
  const totalPicks = Math.min(numTeams * picksPerTeam, poolSize);
  const order = [];
  const base = t.teams.map(x => x.id);
  let i = 0;
  while (order.length < totalPicks) {
    const round = Math.floor(i / numTeams);
    const pos = i - round * numTeams;
    const idx = (round % 2 === 0) ? pos : (numTeams - 1 - pos);
    const teamId = base[idx];
    const team = teamById(t, teamId);
    if (team.playerIds.length + order.filter(o => o === teamId).length < t.teamSize) {
      order.push(teamId);
    }
    i++;
    if (i > 10000) break;
  }
  t.draft = { order: order, current: 0 };
  t.status = 'draft';
}

function finishDraftIfDone(t) {
  if (!t.draft) return;
  if (t.draft.current >= t.draft.order.length) {
    t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
    t.status = 'drafted';
    t.draft = { order: t.draft.order, current: t.draft.current, done: true };
  }
}

// ---------- API ----------

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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

async function handleAPI(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  // POST /api/tournaments
  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'POST') {
    const b = await readBody(req);
    const name = cleanName(b.name, 60);
    if (!name) return bad(res, 'Name required');
    const format = (b.format === 'premade') ? 'premade' : 'draft';
    let teamSize = parseInt(b.teamSize, 10);
    if (!(teamSize >= 1 && teamSize <= 8)) teamSize = 2;
    let bestOf = parseInt(b.bestOf, 10);
    if ([1, 3, 5, 7].indexOf(bestOf) < 0) bestOf = 3;
    const t = {
      id: uid(5),
      adminToken: uid(12),
      name: name,
      description: cleanName(b.description, 500),
      format: format,
      teamSize: teamSize,
      bestOf: bestOf,
      seeding: (b.seeding === 'rating') ? 'rating' : 'random',
      status: 'signup',
      createdAt: now(),
      players: [],
      teams: [],
      matches: [],
      rounds: 0,
      draft: null,
      subs: []
    };
    db.tournaments[t.id] = t;
    saveDB();
    return json(res, 200, { id: t.id, adminToken: t.adminToken });
  }

  // GET /api/tournaments
  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'GET') {
    const list = Object.values(db.tournaments)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => ({
        id: t.id, name: t.name, status: t.status, format: t.format,
        teamSize: t.teamSize, players: t.players.length,
        teams: t.teams.length, createdAt: t.createdAt
      }));
    return json(res, 200, list);
  }

  // /api/t/:id/...
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

    // signup
    if (sub === 'signup') {
      if (t.status !== 'signup') return bad(res, 'Signups are closed');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Player name required');
      const lower = name.toLowerCase();
      if (t.players.some(p => p.name.toLowerCase() === lower)) return bad(res, 'That name is already signed up');
      let rating = parseInt(b.rating, 10);
      if (!(rating >= 0 && rating <= 4000)) rating = null;
      const p = {
        id: 'p' + uid(4),
        name: name,
        rating: rating,
        teamName: t.format === 'premade' ? cleanName(b.teamName, 30) : '',
        teamId: null,
        signedAt: now()
      };
      t.players.push(p);
      saveDB();
      return json(res, 200, { ok: true, playerId: p.id });
    }

    // remove player (admin)
    if (sub === 'remove') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      if (t.status !== 'signup') return bad(res, 'Can only remove players during signups');
      t.players = t.players.filter(p => p.id !== b.playerId);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // phase control (admin)
    if (sub === 'phase') {
      if (!isAdmin(t, b.admin)) return json(res, 403, { error: 'Admin token required' });
      const a = b.action;

      if (a === 'reopen_signups') {
        if (t.status !== 'signup' && t.status !== 'draft' && t.status !== 'drafted') return bad(res, 'Bracket already started');
        t.status = 'signup';
        t.teams = []; t.draft = null; t.subs = [];
        for (const p of t.players) p.teamId = null;
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'start_draft') {
        if (t.format !== 'draft') return bad(res, 'This tournament uses premade teams');
        if (t.status !== 'signup') return bad(res, 'Draft already started');
        const capIds = Array.isArray(b.captainIds) ? b.captainIds.filter(id => playerById(t, id)) : [];
        if (capIds.length < 2) return bad(res, 'Pick at least 2 captains');
        if (capIds.length > t.players.length) return bad(res, 'More captains than players');
        buildDraft(t, capIds);
        finishDraftIfDone(t); // teamSize 1 edge case
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'form_teams') {
        if (t.format !== 'premade') return bad(res, 'This tournament uses captain drafting');
        if (t.status !== 'signup') return bad(res, 'Teams already formed');
        // group by teamName
        const groups = {};
        for (const p of t.players) {
          const key = (p.teamName || '').toLowerCase();
          if (!key) continue;
          if (!groups[key]) groups[key] = [];
          groups[key].push(p);
        }
        const entries = Object.values(groups).filter(g => g.length >= 1);
        if (entries.length < 2) return bad(res, 'Need at least 2 teams (players set a team name at signup)');
        // seeding
        if (t.seeding === 'rating') {
          entries.sort((g1, g2) => {
            const avg = g => g.reduce((s, p) => s + (p.rating || 0), 0) / g.length;
            return avg(g2) - avg(g1);
          });
        } else {
          for (let i = entries.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = entries[i]; entries[i] = entries[j]; entries[j] = tmp;
          }
        }
        t.teams = entries.map((g, i) => {
          const team = {
            id: 't' + uid(4),
            name: g[0].teamName,
            seed: i + 1,
            captainId: g[0].id,
            playerIds: g.map(p => p.id),
            captainToken: uid(10),
            eliminated: false
          };
          for (const p of g) p.teamId = team.id;
          return team;
        });
        t.subs = t.players.filter(p => !p.teamId).map(p => p.id);
        t.status = 'drafted';
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'start_bracket') {
        if (t.status !== 'drafted') return bad(res, 'Form teams first');
        if (!buildBracket(t)) return bad(res, 'Need at least 2 teams');
        if (t.status !== 'finished') t.status = 'running';
        saveDB();
        return json(res, 200, { ok: true });
      }

      return bad(res, 'Unknown action');
    }

    // draft pick (current captain or admin)
    if (sub === 'pick') {
      if (t.status !== 'draft' || !t.draft) return bad(res, 'No draft in progress');
      const d = t.draft;
      if (d.current >= d.order.length) return bad(res, 'Draft is complete');
      const turnTeamId = d.order[d.current];
      const admin = isAdmin(t, b.token);
      const capTeam = teamOfCaptainToken(t, b.token);
      if (!admin && (!capTeam || capTeam.id !== turnTeamId)) {
        return json(res, 403, { error: 'Not your pick' });
      }
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

    // report score (captain of either team, or admin)
    if (sub === 'report') {
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = t.matches.find(x => x.id === b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (m.status !== 'ready' && !(m.status === 'done' && isAdmin(t, b.token))) {
        return bad(res, m.status === 'done' ? 'Already reported (admin can correct)' : 'Match not ready');
      }
      const admin = isAdmin(t, b.token);
      const capTeam = teamOfCaptainToken(t, b.token);
      if (!admin && (!capTeam || (capTeam.id !== m.team1 && capTeam.id !== m.team2))) {
        return json(res, 403, { error: 'Only the two captains or the organizer can report this match' });
      }
      const s1 = parseInt(b.score1, 10), s2 = parseInt(b.score2, 10);
      const maxW = Math.ceil(t.bestOf / 2);
      if (!(s1 >= 0 && s2 >= 0 && s1 <= maxW && s2 <= maxW)) return bad(res, 'Scores must be 0-' + maxW);
      if (s1 === s2) return bad(res, 'No draws — one team must win');
      if (s1 !== maxW && s2 !== maxW) return bad(res, 'Winner needs ' + maxW + ' wins (best of ' + t.bestOf + ')');

      // admin correction of a finished match: only if next match not played yet
      if (m.status === 'done') {
        const nm = t.matches.find(x => x.round === m.round + 1 && x.index === Math.floor(m.index / 2));
        if (nm && nm.status === 'done') return bad(res, 'Next match already played — cannot correct');
        // undo previous advancement
        const prevWinner = m.winner;
        const prevLoser = (m.team1 === prevWinner) ? m.team2 : m.team1;
        const lt = teamById(t, prevLoser); if (lt) lt.eliminated = false;
        if (nm) {
          if (nm.team1 === prevWinner) nm.team1 = null;
          if (nm.team2 === prevWinner) nm.team2 = null;
          nm.status = (nm.team1 && nm.team2) ? 'ready' : 'waiting';
        } else {
          t.championTeamId = null;
          t.status = 'running';
        }
      }

      m.score1 = s1; m.score2 = s2;
      advance(t, m, s1 > s2 ? m.team1 : m.team2, false);
      saveDB();
      return json(res, 200, { ok: true });
    }

    return bad(res, 'Unknown endpoint');
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------- static ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, url) {
  let p = url.pathname;
  if (p === '/' || p.startsWith('/t/')) p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------

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
