// FAF Tourney — zero-dependency tournament manager
// Node 18+ only. No npm install needed.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const challonge = require('./challonge');

const PORT = parseInt(process.env.PORT || '8090', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Site-wide admin password. Set via ADMIN_PASSWORD environment variable in the
// Dockhand stack — NOT in this repo, so it is never visible on GitHub.
const GADMIN = process.env.ADMIN_PASSWORD || '';
// Separate password that lets a trusted person use ONLY the Challonge importer,
// without full site-admin rights. Set via IMPORT_PASSWORD env var.
const IMPORT_PW = process.env.IMPORT_PASSWORD || '';

// ===== FAF login (OAuth2 / OpenID Connect via Ory Hydra) =====
// All three must be set for FAF login to be active; otherwise the feature stays dormant
// and the name-only login remains the sole option.
//   FAF_CLIENT_ID     — the OAuth client id FAF assigns you (a UUID)
//   FAF_CLIENT_SECRET — the client secret FAF stores for you (never in the repo)
//   FAF_REDIRECT_URI  — must EXACTLY match what FAF registered, e.g.
//                       https://tournaments.doodlepros.com/auth/faf/callback
const FAF_CLIENT_ID = process.env.FAF_CLIENT_ID || '';
const FAF_CLIENT_SECRET = process.env.FAF_CLIENT_SECRET || '';
const FAF_REDIRECT_URI = process.env.FAF_REDIRECT_URI || '';
const FAF_OAUTH_ON = !!(FAF_CLIENT_ID && FAF_CLIENT_SECRET && FAF_REDIRECT_URI);
const FAF_HYDRA = 'https://hydra.faforever.com';
const FAF_API = 'https://api.faforever.com';
const FAF_SCOPES = 'openid offline public_profile';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;     // login must complete within 10 min
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
  if (!db.sessions) db.sessions = {};
  if (!db.oauthPending) db.oauthPending = {};
  // migrate v1 records so old test tournaments don't crash the client
  let changed = false;
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
    if (t.imported === undefined) t.imported = false;
    if (t.veto === undefined) t.veto = { enabled: false, mapPool: [], banCount: 0 };
    if (!t.lateToken) t.lateToken = uid(12);
    if (!Array.isArray(t.organizerFafIds)) t.organizerFafIds = [];
    if (!Array.isArray(t.pendingCaptains)) t.pendingCaptains = [];
    if (t.divisions === undefined) t.divisions = 0;
    for (const tm of (t.teams || [])) { if (tm.division === undefined) tm.division = 0; }
    for (const m of (t.matches || [])) {
      if (!m.bracket) m.bracket = 'wb';
      if (!m.bo) m.bo = t.bestOf || 3;
    }
    if (backfillMatchLinks(t)) changed = true;
  }
  if (changed) { try { saveDB(); } catch (e) {} }
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

// A tournament's authorized organizers: the creator's FAF id plus anyone who claimed the
// organizer link while logged in. Site admin always counts.
function isOrganizer(t, req) {
  const sess = currentSession(req);
  if (sess && Array.isArray(t.organizerFafIds) && sess.fafId && t.organizerFafIds.indexOf(sess.fafId) >= 0) return true;
  // site admin via cookie? no — site admin is the ADMIN_PASSWORD token, checked separately per-endpoint.
  return false;
}
// Combined check most mutating endpoints use: site-admin token OR a logged-in authorized organizer.
function canOrganize(t, req, body) {
  if (isAdmin(t, body && body.admin)) return true;   // site admin or legacy admin token
  if (isOrganizer(t, req)) return true;              // logged-in claimed organizer
  return false;
}
function cleanVeto(v) {
  if (!v || typeof v !== 'object') return { enabled: false, mapPool: [], banCount: 0 };
  const pool = Array.isArray(v.mapPool)
    ? v.mapPool.map(x => String(x || '').trim()).filter(x => x).slice(0, 64)
    : [];
  // dedupe preserving order
  const seen = {}, dedup = [];
  for (const m of pool) { const k = m.toLowerCase(); if (!seen[k]) { seen[k] = 1; dedup.push(m); } }
  let ban = parseInt(v.banCount, 10);
  if (!(ban >= 0)) ban = 0;
  // can't ban more than pool-1 (must leave at least 1 map)
  if (dedup.length > 0 && ban > dedup.length - 1) ban = dedup.length - 1;
  return { enabled: !!v.enabled && dedup.length >= 2, mapPool: dedup, banCount: ban };
}

function cleanDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  // legacy date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // full ISO datetime (what the client sends now) — validate by parsing
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString(); // normalize to UTC ISO
}

// The team the logged-in viewer is the CAPTAIN of (matched by FAF identity).
function teamOfSession(t, req) {
  const sess = currentSession(req);
  if (!sess || !sess.fafId) return null;
  for (const team of t.teams) {
    const cap = playerById(t, team.captainId);
    if (cap && cap.fafId && cap.fafId === sess.fafId) return team;
  }
  return null;
}
// The team a logged-in viewer PLAYS ON (captain or roster member), by FAF identity.
function playerTeamOfSession(t, req) {
  const sess = currentSession(req);
  if (!sess || !sess.fafId) return null;
  const mine = t.players.find(p => p.fafId && p.fafId === sess.fafId);
  if (!mine || !mine.teamId) return null;
  return teamById(t, mine.teamId);
}

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
    veto: t.veto || { enabled: false, mapPool: [], banCount: 0 },
    status: t.status, createdAt: t.createdAt,
    eventDate: t.eventDate || null,
    challongeDate: t.challongeDate || null,
    rounds: t.rounds || 0,
    maps: t.maps || {},
    players: t.players,
    teams: t.teams.map(x => ({
      id: x.id, name: x.name, seed: x.seed,
      captainId: x.captainId, playerIds: x.playerIds,
      division: x.division || 0,
      eliminated: x.eliminated || false,
      out: x.out || null,
      finalRank: x.finalRank || null
    })),
    draft: t.draft,
    matches: t.matches,
    championTeamId: t.championTeamId || null,
    subs: t.subs || [],
    pendingCaptains: t.pendingCaptains || [],
    divisions: t.divisions || 0,
    imported: t.imported || false,
    hasOrganizer: (Array.isArray(t.organizerFafIds) && t.organizerFafIds.length > 0) ? 1 : 0,
    createdByName: t.createdByName || '',
    source: t.source || null,
    sourceUrl: t.sourceUrl || null
  };
}

// ---------- generic elimination engine ----------
// slot values: null = pending, 'BYE' = confirmed empty, otherwise teamId

// Initialize the veto state for a match, if the tournament has vetoes enabled.
// remaining = the map pool; banned = []; turn = the team that bans next (higher seed first).
function initVeto(t, m) {
  if (!t.veto || !t.veto.enabled) return;
  if (m.bracket === 'ffa') return; // vetoes are for head-to-head matches only
  if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') return;
  if (t.veto.mapPool.length < 2) return;
  // higher seed (lower seed number) bans first
  const s1 = (teamById(t, m.team1) || {}).seed || 999;
  const s2 = (teamById(t, m.team2) || {}).seed || 999;
  const first = s1 <= s2 ? m.team1 : m.team2;
  m.veto = {
    remaining: t.veto.mapPool.slice(),
    banned: [],           // [{ map, by }]
    banCount: t.veto.banCount,
    turn: first,
    done: t.veto.banCount === 0 // if 0 bans, veto is trivially complete
  };
}

let _buildingDivision = 0; // set while a division's bracket is being generated
function newMatch(t, bracket, round, index, bo) {
  const m = {
    id: 'm' + uid(4), bracket, round, index, bo: bo || 3, hcap: 0,
    division: _buildingDivision,
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

function seededSlots(t, division) {
  let teams = t.teams.slice();
  if (division && division > 0) teams = teams.filter(x => (x.division || 0) === division);
  teams.sort((a, b) => a.seed - b.seed);
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
  const slots = seededSlots(t, _buildingDivision);
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
  const slots = seededSlots(t, _buildingDivision);
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

// Reconstruct winnerTo/loserTo on existing brackets that were generated before those
// links were stored (older tournaments in db.json). Imported tournaments already carry
// their own links, so skip them. Idempotent: only runs when links are absent.
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

// Finalize OPEN teams: only teams filled to exactly teamSize enter; incomplete teams and
// un-teamed players become reserves (subs). Existing teams are kept and seeded by combined rating.
function finalizeOpenTeams(t) {
  const full = t.teams.filter(x => x.playerIds.length === t.teamSize);
  if (full.length < 2) return 'Need at least 2 full teams (' + t.teamSize + ' players each) to start';
  // seed the full teams
  applySeeding(t, full, tm => tm.playerIds.reduce((s, pid) => s + ((playerById(t, pid) || {}).rating || 0), 0) / t.teamSize);
  full.forEach((tm, i) => { tm.seed = i + 1; });
  // players on incomplete teams -> back to pool; then those + already-unteamed become reserves
  const fullIds = {}; full.forEach(tm => { fullIds[tm.id] = 1; });
  for (const tm of t.teams) {
    if (!fullIds[tm.id]) {
      for (const pid of tm.playerIds) { const p = playerById(t, pid); if (p) p.teamId = null; }
    }
  }
  t.teams = full;
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

// ---------- FAF OAuth helpers ----------

const https = require('https');

// Minimal HTTPS request helper (zero-dep, mirrors challonge.js style).
// opts: { host, path, method, headers }, body: string|null. Resolves { status, text }.
function httpsRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: opts.host, path: opts.path, method: opts.method || 'GET', headers: opts.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: data }));
    });
    req.on('error', e => reject(new Error('Network error contacting ' + opts.host + ': ' + e.message)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request to ' + opts.host + ' timed out')); });
    if (body) req.write(body);
    req.end();
  });
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randToken(nbytes) { return b64url(crypto.randomBytes(nbytes || 32)); }
// PKCE: verifier is a random string; challenge is base64url(sha256(verifier)).
function pkcePair() {
  const verifier = randToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// pending logins: state -> { verifier, exp, returnTo }
function prunePending() {
  const now = Date.now();
  for (const k of Object.keys(db.oauthPending)) {
    if (!db.oauthPending[k] || db.oauthPending[k].exp < now) delete db.oauthPending[k];
  }
}

// sessions: token -> { fafId, fafName, exp }
function pruneSessions() {
  const now = Date.now();
  for (const k of Object.keys(db.sessions)) {
    if (!db.sessions[k] || db.sessions[k].exp < now) delete db.sessions[k];
  }
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
const SESSION_COOKIE = 'faf_sid';
function setSessionCookie(res, token, maxAgeMs) {
  // httpOnly (JS can't read it -> XSS can't steal it), Secure (HTTPS only), SameSite=Lax (survives the OAuth redirect back)
  const parts = [
    SESSION_COOKIE + '=' + encodeURIComponent(token),
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax',
    'Max-Age=' + Math.floor((maxAgeMs || SESSION_TTL_MS) / 1000)
  ];
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  appendHeader(res, 'Set-Cookie', SESSION_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}
// support multiple Set-Cookie headers alongside other writeHead headers
function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (existing === undefined) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, existing.concat(value));
  else res.setHeader(name, [existing, value]);
}
function currentSession(req) {
  const c = parseCookies(req);
  const tok = c[SESSION_COOKIE];
  if (!tok) return null;
  const sess = db.sessions[tok];
  if (!sess || sess.exp < Date.now()) return null;
  return sess;
}

function redirect(res, location) {
  res.writeHead(302, { 'Location': location, 'Cache-Control': 'no-store' });
  res.end();
}

// Resolve the FAF display name from an access token.
// Hydra's /userinfo returns only { sub } (the numeric FAF id). The username comes from the
// FAF API /me endpoint, which the `public_profile` scope grants access to. The exact JSON
// shape is confirmed on first real login; we read the common fields defensively.
async function fafFetchIdentity(accessToken) {
  // 1) userinfo -> stable subject id (always present)
  let fafId = null;
  try {
    const ui = await httpsRequest({
      host: 'hydra.faforever.com', path: '/userinfo', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
    });
    if (ui.status === 200) { const j = JSON.parse(ui.text); fafId = j.sub || null; }
  } catch (e) { /* fall through */ }

  // 2) FAF API /me -> username (+ id). JSON:API shape: { data: { id, attributes: { userName, ... } } }
  let fafName = null;
  try {
    const me = await httpsRequest({
      host: 'api.faforever.com', path: '/me', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
    });
    if (me.status === 200) {
      const j = JSON.parse(me.text);
      const a = (j && j.data && j.data.attributes) ? j.data.attributes : (j || {});
      fafName = a.userName || a.username || a.login || a.displayName || a.name || null;
      if (!fafId) fafId = (j && j.data && j.data.id) || a.userId || a.id || fafId;
    }
  } catch (e) { /* fall through */ }

  return { fafId: fafId ? String(fafId) : null, fafName: fafName ? String(fafName) : null };
}

// ---------- auth routes ----------
async function handleAuth(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['auth','faf',...]
  const sub = parts[2] || '';

  // status endpoint always works (tells the client whether to show the FAF button + who's logged in)
  if (sub === 'me') {
    const sess = currentSession(req);
    return json(res, 200, {
      enabled: FAF_OAUTH_ON,
      user: sess ? { fafId: sess.fafId, fafName: sess.fafName } : null
    });
  }

  if (!FAF_OAUTH_ON) return json(res, 503, { error: 'FAF login is not configured on this server yet.' });

  if (sub === 'login') {
    prunePending();
    const state = randToken(24);
    const { verifier, challenge } = pkcePair();
    const returnTo = (url.searchParams.get('returnTo') || '/').slice(0, 300);
    db.oauthPending[state] = { verifier, exp: Date.now() + OAUTH_PENDING_TTL_MS, returnTo };
    saveDB();
    const auth = FAF_HYDRA + '/oauth2/auth?' + new URLSearchParams({
      response_type: 'code',
      client_id: FAF_CLIENT_ID,
      redirect_uri: FAF_REDIRECT_URI,
      scope: FAF_SCOPES,
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();
    return redirect(res, auth);
  }

  if (sub === 'callback') {
    prunePending();
    const err = url.searchParams.get('error');
    if (err) return redirect(res, '/?login=denied');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return redirect(res, '/?login=error');
    const pending = db.oauthPending[state];
    if (!pending) return redirect(res, '/?login=expired');
    delete db.oauthPending[state];
    saveDB();

    // exchange the code for tokens (client_secret_post + PKCE verifier)
    let tokenResp;
    try {
      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: FAF_REDIRECT_URI,
        client_id: FAF_CLIENT_ID,
        client_secret: FAF_CLIENT_SECRET,
        code_verifier: pending.verifier
      }).toString();
      tokenResp = await httpsRequest({
        host: 'hydra.faforever.com', path: '/oauth2/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
      }, form);
    } catch (e) {
      return redirect(res, '/?login=error');
    }
    if (tokenResp.status !== 200) return redirect(res, '/?login=error');
    let accessToken;
    try { accessToken = JSON.parse(tokenResp.text).access_token; } catch (e) { return redirect(res, '/?login=error'); }
    if (!accessToken) return redirect(res, '/?login=error');

    // resolve identity
    const ident = await fafFetchIdentity(accessToken);
    if (!ident.fafId && !ident.fafName) return redirect(res, '/?login=error');

    // create a server-side session, hand the browser an httpOnly cookie
    pruneSessions();
    const sid = randToken(32);
    db.sessions[sid] = { fafId: ident.fafId, fafName: ident.fafName, exp: Date.now() + SESSION_TTL_MS };
    saveDB();
    setSessionCookie(res, sid, SESSION_TTL_MS);
    const dest = (pending.returnTo && pending.returnTo.charAt(0) === '/') ? pending.returnTo : '/';
    return redirect(res, dest + (dest.indexOf('?') >= 0 ? '&' : '?') + 'login=ok');
  }

  if (sub === 'logout') {
    const c = parseCookies(req);
    const tok = c[SESSION_COOKIE];
    if (tok && db.sessions[tok]) { delete db.sessions[tok]; saveDB(); }
    clearSessionCookie(res);
    // GET (link) redirects home; POST (fetch) gets JSON
    if (req.method === 'POST') return json(res, 200, { ok: true });
    return redirect(res, '/');
  }

  return json(res, 404, { error: 'Unknown auth route' });
}

// ---------- API ----------

async function handleAPI(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'POST') {
    const b = await readBody(req);
    // Hosting requires a FAF login (unless FAF login isn't configured yet, in which case
    // the legacy flow still applies so the site keeps working before go-live).
    const hostSess = currentSession(req);
    if (FAF_OAUTH_ON && !hostSess) return json(res, 401, { error: 'Log in with FAF to host a tournament' });
    const name = cleanName(b.name, 60);
    if (!name) return bad(res, 'Name required');
    const competition = b.competition === 'ffa' ? 'ffa' : 'team';
    let teamSize, formation, bracketType = 'single', ffaCfg = null, draftOrder = 'linear', plan = null;
    const pb = b.plan || {};
    const bo = (v, d) => BO_OK.indexOf(parseInt(v, 10)) >= 0 ? parseInt(v, 10) : d;
    if (competition === 'team') {
      teamSize = intIn(b.teamSize, 1, 6, 2);
      formation = (teamSize === 1) ? 'solo'
        : (b.formation === 'premade' ? 'premade'
        : (b.formation === 'open' ? 'open' : 'draft'));
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
      formation = (teamSize === 1) ? 'solo' : (b.formation === 'premade' ? 'premade' : 'open');
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
      id: uid(5), adminToken: uid(12), lateToken: uid(12),
      name, description: cleanName(b.description, 500),
      lobbyOptions: cleanName(b.lobbyOptions, 500),
      mods: cleanName(b.mods, 500),
      competition, formation, teamSize, draftOrder, bracketType, ffaCfg,
      plan, maxTeams,
      cfg: null, maps: {},
      seeding: (b.seeding === 'rating') ? 'rating' : 'random',
      veto: cleanVeto(b.veto),
      eventDate: cleanDate(b.eventDate),
      status: 'signup', createdAt: now(),
      organizerFafIds: (hostSess && hostSess.fafId) ? [hostSess.fafId] : [],
      createdByName: (hostSess && hostSess.fafName) || '',
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

  // verify the importer password (grants importer access only, not site admin)
  if (parts.length === 2 && parts[1] === 'verify_import' && method === 'POST') {
    const b = await readBody(req);
    if (!IMPORT_PW && !GADMIN) return bad(res, 'Importing is not configured on the server (set IMPORT_PASSWORD).');
    const pw = String(b.password || '');
    if ((IMPORT_PW && pw === IMPORT_PW) || (GADMIN && pw === GADMIN)) return json(res, 200, { ok: true });
    return json(res, 403, { error: 'Wrong password' });
  }

  // import a completed tournament from Challonge (site admin only)
  if (parts.length === 2 && parts[1] === 'import_challonge' && method === 'POST') {
    const b = await readBody(req);
    const okImport = (IMPORT_PW && b.importPw === IMPORT_PW) || (GADMIN && b.admin === GADMIN);
    if (!okImport) return json(res, 403, { error: 'Not authorized to import' });
    let cid = String(b.tournament || '').trim();
    if (!cid) return bad(res, 'Enter a Challonge tournament URL or ID');
    // accept a full URL or bare id: challonge.com/abc123 or challonge.com/subdomain/abc123
    const m = cid.match(/challonge\.com\/([^\/?#]+(?:\/[^\/?#]+)?)/i);
    if (m) cid = m[1];
    cid = cid.replace(/^\/+|\/+$/g, '');
    // subdomain tournaments use "subdomain-id" in the API
    if (cid.indexOf('/') >= 0) { const pp = cid.split('/'); cid = pp[0] + '-' + pp[1]; }
    const apiKey = String(b.apiKey || '').trim();
    if (!apiKey) return bad(res, 'Enter your Challonge API key');
    try {
      const raw = await challonge.fetchTournament(cid, apiKey);
      const conv = challonge.convert(raw, {});
      // avoid duplicate import of the same Challonge URL
      for (const ex of Object.values(db.tournaments)) {
        if (ex.imported && ex.sourceUrl && conv.sourceUrl && ex.sourceUrl === conv.sourceUrl) {
          return bad(res, 'That Challonge tournament has already been imported.');
        }
      }
      db.tournaments[conv.id] = conv;
      saveDB();
      return json(res, 200, { ok: true, id: conv.id, name: conv.name });
    } catch (e) {
      return bad(res, e.message || 'Import failed');
    }
  }

  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'GET') {
    const list = Object.values(db.tournaments)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => ({
        id: t.id, name: t.name, status: t.status,
        competition: t.competition, bracketType: t.bracketType,
        teamSize: t.teamSize, players: t.players.length,
        teams: t.teams.length, createdAt: t.createdAt,
        imported: t.imported || false,
        eventDate: t.eventDate || null,
        challongeDate: t.challongeDate || null
      }));
    return json(res, 200, list);
  }

  if (parts.length >= 3 && parts[1] === 't') {
    const t = getT(parts[2]);
    if (!t) return json(res, 404, { error: 'Tournament not found' });
    const sub = parts[3] || '';

    if (method === 'GET' && !sub) {
      const tok = url.searchParams.get('token');
      const view = publicView(t);
      const capTeam = teamOfCaptainToken(t, tok) || teamOfSession(t, req);
      const sess = currentSession(req);
      const organizer = isAdmin(t, tok) || isOrganizer(t, req);
      // is the logged-in viewer already signed up (by FAF id)?
      let signedUpId = null;
      if (sess && sess.fafId) {
        const mine = t.players.find(p => p.fafId === sess.fafId);
        if (mine) signedUpId = mine.id;
      }
      view.viewer = {
        admin: isAdmin(t, tok) ? 1 : 0,
        organizer: organizer ? 1 : 0,
        teamId: capTeam ? capTeam.id : null,
        loggedIn: sess ? 1 : 0,
        fafId: sess ? sess.fafId : null,
        fafName: sess ? sess.fafName : null,
        signedUpPlayerId: signedUpId,
        oauthEnabled: FAF_OAUTH_ON ? 1 : 0
      };
      return json(res, 200, view);
    }

    // imported tournaments are display-only: only GET and site-admin delete are allowed
    if (t.imported && method === 'POST' && sub !== 'delete' && sub !== 'edit_date') {
      return bad(res, 'Imported tournaments are read-only.');
    }

    if (method === 'GET' && sub === 'secrets') {
      if (!isAdmin(t, url.searchParams.get('admin')) && !isOrganizer(t, req)) return json(res, 403, { error: 'Organizer rights required' });
      return json(res, 200, {
        adminToken: t.adminToken,
        lateToken: t.lateToken
      });
    }

    if (method !== 'POST') return bad(res, 'Unsupported');
    const b = await readBody(req);

    if (sub === 'reseed') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (t.status !== 'drafted') return bad(res, 'Seeds can only be changed after teams are formed and before the bracket starts');
      if (!t.teams.length) return bad(res, 'No teams to seed');
      if (b.randomize) {
        const ids = t.teams.map(x => x.id);
        shuffle(ids);
        ids.forEach((id, i) => { const tm = teamById(t, id); if (tm) tm.seed = i + 1; });
        saveDB();
        return json(res, 200, { ok: true });
      }
      const order = Array.isArray(b.order) ? b.order : null;
      if (!order) return bad(res, 'Provide an ordered list of team IDs');
      // validate: same set of team IDs, no dupes
      const have = t.teams.map(x => x.id).sort().join(',');
      const got = order.slice().sort().join(',');
      if (have !== got) return bad(res, 'Seed order must include every team exactly once');
      order.forEach((id, i) => { const tm = teamById(t, id); if (tm) tm.seed = i + 1; });
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'edit_date') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      t.eventDate = cleanDate(b.eventDate); // null clears it
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      delete db.tournaments[t.id];
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'signup') {
      if (t.formation === 'premade' && t.teamSize > 1) return bad(res, 'This tournament uses whole-team registration \u2014 one player registers the full team');

      const sess = currentSession(req);
      const adminAdding = isAdmin(t, b.admin) || canOrganize(t, req, b);
      // Late signups (after signups close) require the organizer's late-signup token OR organizer rights.
      const lateOk = (b.lateToken && b.lateToken === t.lateToken) || adminAdding;
      if (t.status !== 'signup' && !lateOk) return bad(res, 'Signups are closed');

      let name, fafId = null, manual = false;
      if (adminAdding && b.name) {
        // site admin / organizer adding a manual (unverified) player by name
        name = cleanName(b.name, 30);
        manual = true;
      } else {
        // self-signup: identity must come from a FAF login
        if (FAF_OAUTH_ON && !sess) return json(res, 401, { error: 'Log in with FAF to sign up' });
        if (sess) { name = sess.fafName; fafId = sess.fafId; }
        else { name = cleanName(b.name, 30); } // pre-go-live fallback (no OAuth configured)
      }
      if (!name) return bad(res, 'Could not determine your name \u2014 please log in again');

      if (t.maxTeams > 0 && t.formation === 'solo' && t.players.length >= t.maxTeams && !lateOk) {
        return bad(res, 'The tournament is full (' + t.maxTeams + ' entrants)');
      }
      // no duplicates: by FAF id if we have one, else by name
      if (fafId && t.players.some(p => p.fafId === fafId)) return bad(res, 'You are already signed up');
      if (t.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return bad(res, manual ? 'That name is already signed up' : 'You are already signed up');

      const rating = parseInt(b.rating, 10);
      if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter a FAF rating (0\u20134000)');
      const p = {
        id: 'p' + uid(4), name, rating, fafId: fafId, manual: manual,
        late: (t.status !== 'signup') ? 1 : 0,
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
      const p0 = playerById(t, b.playerId);
      // a player may withdraw themselves (by FAF id) while signups are open; organizers can remove anyone
      const sess = currentSession(req);
      const selfWithdraw = p0 && sess && p0.fafId && p0.fafId === sess.fafId && t.status === 'signup';
      if (!selfWithdraw && !canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = p0;
      if (!p) return json(res, 200, { ok: true });
      if (t.status === 'signup') {
        if (t.formation === 'premade' && t.teamSize > 1 && p.teamName) {
          const key = p.teamName.toLowerCase();
          t.players = t.players.filter(x => (x.teamName || '').toLowerCase() !== key);
        } else {
          t.players = t.players.filter(x => x.id !== b.playerId);
        }
      } else if ((t.status === 'draft' || t.status === 'drafted') && !p.teamId) {
        // resignation of an undrafted player mid-draft
        t.players = t.players.filter(x => x.id !== p.id);
        t.subs = (t.subs || []).filter(pid => pid !== p.id);
        if (t.status === 'draft' && t.draft && !t.draft.done) {
          // if fewer players remain than scheduled picks, trim the tail of the pick order
          const available = t.players.filter(x => !x.teamId).length;
          const remaining = t.draft.order.length - t.draft.current;
          if (remaining > available) t.draft.order.length = t.draft.current + available;
          finishDraftIfDone(t);
        }
      } else {
        return bad(res, 'Players already on a team can\u2019t be removed \u2014 use Edit to substitute them instead');
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit player (admin, any time) — this is also the substitution mechanism:
    // rename the dropped player to the sub's FAF name and fix the rating
    // ===== open-team management (formation === 'open') =====
    // helper checks live here so they can reference the request session
    if (['create_team', 'join_team', 'leave_team', 'disband_team', 'move_player', 'set_captain', 'rename_team'].indexOf(sub) >= 0) {
      if (t.formation !== 'open') return bad(res, 'This tournament does not use open team signups');
      if (t.status !== 'signup') return bad(res, 'Teams are locked once the tournament starts');
    }

    // the player acting (their own signed-up record), by FAF identity or explicit id for organizers
    function actingPlayer(reqBody) {
      const sess = currentSession(req);
      if (sess && sess.fafId) {
        const mine = t.players.find(p => p.fafId === sess.fafId);
        if (mine) return mine;
      }
      // pre-go-live / organizer-specified fallback
      if (reqBody && reqBody.playerId) return playerById(t, reqBody.playerId);
      return null;
    }

    if (sub === 'create_team') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first, then create a team' });
      if (me.teamId) return bad(res, 'Leave your current team first');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Team name required');
      if (t.teams.some(x => (x.name || '').toLowerCase() === name.toLowerCase())) return bad(res, 'That team name is taken');
      const team = { id: 't' + uid(4), name, seed: 0, captainId: me.id, playerIds: [me.id], captainToken: uid(10), eliminated: false, out: null };
      t.teams.push(team);
      me.teamId = team.id;
      saveDB();
      return json(res, 200, { ok: true, teamId: team.id });
    }

    if (sub === 'join_team') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first' });
      if (me.teamId) return bad(res, 'Leave your current team first');
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      if (team.playerIds.length >= t.teamSize) return bad(res, 'That team is full');
      team.playerIds.push(me.id);
      me.teamId = team.id;
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'leave_team') {
      // a player leaves their own team; an organizer may remove a specified player
      const organizer = canOrganize(t, req, b);
      let target = actingPlayer(b);
      if (organizer && b.targetPlayerId) target = playerById(t, b.targetPlayerId);
      if (!target) return json(res, 401, { error: 'Not signed in' });
      const team = teamById(t, target.teamId);
      if (!team) return bad(res, 'You are not on a team');
      // remove the player
      team.playerIds = team.playerIds.filter(id => id !== target.id);
      target.teamId = null;
      if (team.playerIds.length === 0) {
        // last member left -> team dissolves
        t.teams = t.teams.filter(x => x.id !== team.id);
      } else if (team.captainId === target.id) {
        // captain left -> pass captaincy to the next member; team survives
        team.captainId = team.playerIds[0];
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'disband_team') {
      const organizer = canOrganize(t, req, b);
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      // only the captain or an organizer can disband
      const me = actingPlayer(b);
      const isCap = me && team.captainId === me.id;
      if (!isCap && !organizer) return json(res, 403, { error: 'Only the team captain or organizer can disband' });
      for (const pid of team.playerIds) { const p = playerById(t, pid); if (p) p.teamId = null; }
      t.teams = t.teams.filter(x => x.id !== team.id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'rename_team') {
      const organizer = canOrganize(t, req, b);
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      const me = actingPlayer(b);
      const isCap = me && team.captainId === me.id;
      if (!isCap && !organizer) return json(res, 403, { error: 'Only the captain or organizer can rename' });
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Team name required');
      if (t.teams.some(x => x.id !== team.id && (x.name || '').toLowerCase() === name.toLowerCase())) return bad(res, 'That team name is taken');
      team.name = name;
      saveDB();
      return json(res, 200, { ok: true });
    }

    // organizer: move a player to a specific team (with space) or to the pool (teamId=null)
    if (sub === 'move_player') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      // remove from current team first
      if (p.teamId) {
        const cur = teamById(t, p.teamId);
        if (cur) {
          cur.playerIds = cur.playerIds.filter(id => id !== p.id);
          if (cur.playerIds.length === 0) t.teams = t.teams.filter(x => x.id !== cur.id);
          else if (cur.captainId === p.id) cur.captainId = cur.playerIds[0];
        }
        p.teamId = null;
      }
      if (b.teamId) {
        const dest = teamById(t, b.teamId);
        if (!dest) return bad(res, 'Destination team not found');
        if (dest.playerIds.length >= t.teamSize) return bad(res, 'That team is full');
        dest.playerIds.push(p.id);
        p.teamId = dest.id;
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // organizer: set a specific member as the team captain
    if (sub === 'set_captain') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      if (team.playerIds.indexOf(b.playerId) < 0) return bad(res, 'That player is not on this team');
      team.captainId = b.playerId;
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Manual matchup override: put a specific team (or BYE/empty) into a match slot.
    // Only allowed on a match that hasn't been played yet, to fix seeding/placement edge cases.
    if (sub === 'set_match_team') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (m.status === 'done') return bad(res, 'That match is already played');
      if (m.bracket === 'ffa') return bad(res, 'Use the FFA controls for FFA lobbies');
      const slot = (parseInt(b.slot, 10) === 2) ? 2 : 1;
      let val = null;
      if (b.teamId === 'BYE') val = 'BYE';
      else if (b.teamId) { const tm = teamById(t, b.teamId); if (!tm) return bad(res, 'Team not found'); val = tm.id; }
      // set the slot directly and re-evaluate readiness
      m.status = 'waiting'; m.winner = null; m.loser = null;
      if (slot === 1) m.team1 = val; else m.team2 = val;
      // if both slots decided, mark ready (or bye)
      const other = slot === 1 ? m.team2 : m.team1;
      if (val !== null && other !== null) evaluate(t, m);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // ===== divisions (King/Prince split) =====
    // Auto-split the CURRENT full teams into N divisions by combined rating (division 1 = strongest).
    if (sub === 'split_divisions') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (t.status !== 'drafted') return bad(res, 'Split into divisions after forming teams and before starting the bracket');
      if (t.competition === 'ffa') return bad(res, 'Divisions are for bracket tournaments');
      const n = intIn(b.divisions, 1, 6, 2);
      if (n === 1) { for (const tm of t.teams) tm.division = 0; t.divisions = 0; saveDB(); return json(res, 200, { ok: true }); }
      // sort teams by combined rating (desc) and slice into n roughly-equal divisions
      const sorted = t.teams.slice().sort((a, b2) =>
        b2.playerIds.reduce((s, pid) => s + ((playerById(t, pid) || {}).rating || 0), 0) -
        a.playerIds.reduce((s, pid) => s + ((playerById(t, pid) || {}).rating || 0), 0)
      );
      const per = Math.ceil(sorted.length / n);
      sorted.forEach((tm, i) => { tm.division = Math.min(n, Math.floor(i / per) + 1); });
      t.divisions = n;
      saveDB();
      return json(res, 200, { ok: true, divisions: n });
    }

    // Manually set which division a team is in (organizer adjustment after auto-split).
    if (sub === 'set_division') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (t.status !== 'drafted') return bad(res, 'Divisions are locked once the bracket starts');
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      team.division = intIn(b.division, 0, 6, 0);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Claim organizer rights by opening the organizer link while logged in with FAF.
    if (sub === 'claim_organizer') {
      const sess = currentSession(req);
      if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
      // the link carries the admin token; that's what authorizes the claim
      if (!isAdmin(t, b.adminToken) && !(t.adminToken && b.adminToken === t.adminToken)) {
        return json(res, 403, { error: 'Invalid organizer link' });
      }
      if (!Array.isArray(t.organizerFafIds)) t.organizerFafIds = [];
    if (!Array.isArray(t.pendingCaptains)) t.pendingCaptains = [];
    if (t.divisions === undefined) t.divisions = 0;
    for (const tm of (t.teams || [])) { if (tm.division === undefined) tm.division = 0; }
      if (t.organizerFafIds.indexOf(sess.fafId) < 0) t.organizerFafIds.push(sess.fafId);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Replace one player with another SIGNED-UP player, preserving their spot/results.
    // Works at any stage. The replacement takes over the slot; they are removed from the pool.
    if (sub === 'replace_player') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const outP = playerById(t, b.playerId);
      if (!outP) return bad(res, 'Player to replace not found');
      const inP = playerById(t, b.replacementId);
      if (!inP) return bad(res, 'Replacement player not found');
      if (inP.id === outP.id) return bad(res, 'Pick a different player');
      // the replacement must not already be in the tournament (in a team) — they come from the pool
      if (inP.teamId) return bad(res, 'That player is already in the tournament');

      // Move the replacement's identity into the outgoing player's slot (keeps outP.id, so all
      // team.captainId / team.playerIds / match references stay valid and results are preserved).
      const keptId = outP.id;
      const keptTeamId = outP.teamId;
      const keptTeamName = outP.teamName;
      outP.name = inP.name;
      outP.rating = inP.rating;
      outP.fafId = inP.fafId || null;
      outP.manual = inP.manual || false;
      outP.replacedFrom = (outP.replacedFrom || 0) + 1;
      // remove the replacement's own pool record
      t.players = t.players.filter(p => p.id !== inP.id);
      // keep derived team names in sync (solo teams / "Team X")
      for (const team of t.teams) {
        if (team.captainId === keptId) {
          team.name = (t.teamSize === 1) ? outP.name : ('Team ' + outP.name);
        }
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'edit_player') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
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

    // edit format/settings (admin, before the bracket starts)
    if (sub === 'edit_format') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (['signup', 'draft', 'drafted'].indexOf(t.status) < 0) return bad(res, 'The format is locked once the bracket has started');
      const bo = (v, d) => BO_OK.indexOf(parseInt(v, 10)) >= 0 ? parseInt(v, 10) : d;

      // structural changes only while signups are open
      const structural = ['competition', 'teamSize', 'formation', 'draftOrder', 'seeding'].some(k => b[k] !== undefined);
      if (structural && t.status !== 'signup') return bad(res, 'Reopen signups to change the team setup');

      const competition = b.competition !== undefined ? (b.competition === 'ffa' ? 'ffa' : 'team') : t.competition;
      let teamSize = t.teamSize, formation = t.formation;
      if (competition === 'team') {
        teamSize = b.teamSize !== undefined ? intIn(b.teamSize, 1, 6, t.teamSize) : (t.competition === 'team' ? t.teamSize : 1);
        const wantForm = b.formation !== undefined ? b.formation : (t.formation === 'premade' ? 'premade' : 'draft');
        formation = (teamSize === 1) ? 'solo' : (wantForm === 'premade' ? 'premade' : 'draft');
      } else {
        teamSize = b.teamSize !== undefined ? intIn(b.teamSize, 1, 3, Math.min(t.teamSize, 3)) : Math.min(t.teamSize, 3);
        formation = (teamSize === 1) ? 'solo' : 'premade';
      }
      if (formation === 'premade' && teamSize > 1 &&
          (t.formation !== 'premade' || t.teamSize !== teamSize || t.competition !== competition) &&
          t.players.length > 0) {
        return bad(res, 'Remove the current signups first \u2014 premade tournaments register whole teams of the new size');
      }

      t.competition = competition;
      t.teamSize = teamSize;
      t.formation = formation;
      if (b.draftOrder !== undefined) t.draftOrder = b.draftOrder === 'snake' ? 'snake' : 'linear';
      if (b.seeding !== undefined) t.seeding = b.seeding === 'rating' ? 'rating' : 'random';
      if (b.maxTeams !== undefined) t.maxTeams = intIn(b.maxTeams, 0, 128, t.maxTeams);

      if (competition === 'team') {
        if (b.bracketType !== undefined && ['single', 'double', 'swiss'].indexOf(b.bracketType) >= 0) t.bracketType = b.bracketType;
        const pb = b.plan || {};
        const op = (t.plan && typeof t.plan === 'object') ? t.plan : {};
        if (t.bracketType === 'single') {
          t.plan = { early: bo(pb.early, op.early || 3), semi: bo(pb.semi, op.semi || 3), final: bo(pb.final, op.final || 5) };
        } else if (t.bracketType === 'double') {
          t.plan = { wb: bo(pb.wb, op.wb || 3), wbFinal: bo(pb.wbFinal, op.wbFinal || 3), lb: bo(pb.lb, op.lb || 3), lbFinal: bo(pb.lbFinal, op.lbFinal || 3), gf: bo(pb.gf, op.gf || 5), lbHandicap: pb.lbHandicap !== undefined ? (pb.lbHandicap ? 1 : 0) : (op.lbHandicap ? 1 : 0) };
        } else {
          t.plan = { bo: pb.bo !== undefined ? ((parseInt(pb.bo, 10) === 1) ? 1 : 3) : (op.bo || 3), final: pb.final !== undefined ? (pb.final ? 1 : 0) : (op.final !== undefined ? op.final : 1), finalBo: bo(pb.finalBo, op.finalBo || 5), fast: pb.fast !== undefined ? (pb.fast ? 1 : 0) : (op.fast ? 1 : 0) };
        }
        t.ffaCfg = null;
      } else {
        const oc = t.ffaCfg || {};
        t.ffaCfg = {
          perMatch: b.perMatch !== undefined ? intIn(b.perMatch, 2, 16, oc.perMatch || 6) : (oc.perMatch || 6),
          advance: b.advance !== undefined ? intIn(b.advance, 1, 4, oc.advance || 1) : (oc.advance || 1),
          mode: b.mode !== undefined ? (b.mode === 'points' ? 'points' : 'elim') : (oc.mode || 'points'),
          rounds: b.rounds !== undefined ? intIn(b.rounds, 1, 10, oc.rounds || 3) : (oc.rounds || 3),
          cutTo: b.cutTo !== undefined ? intIn(b.cutTo, 0, 64, oc.cutTo || 0) : (oc.cutTo || 0),
          finalSize: b.finalSize !== undefined ? intIn(b.finalSize, 0, 16, oc.finalSize || 0) : (oc.finalSize || 0)
        };
        if (t.ffaCfg.cutTo === 1) t.ffaCfg.cutTo = 2;
        if (t.ffaCfg.finalSize === 1) t.ffaCfg.finalSize = 2;
        t.plan = null;
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit tournament info (admin, any time)
    if (sub === 'edit_info') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (b.description !== undefined) t.description = cleanName(b.description, 500);
      if (b.lobbyOptions !== undefined) t.lobbyOptions = cleanName(b.lobbyOptions, 500);
      if (b.mods !== undefined) t.mods = cleanName(b.mods, 500);
      if (b.veto !== undefined) {
        if (t.status === 'running' || t.status === 'finished') return bad(res, 'Vetoes can only be changed before the bracket starts');
        t.veto = cleanVeto(b.veto);
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // set maps for a round (admin, any time)
    if (sub === 'set_maps') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
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
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const a = b.action;

      if (a === 'reopen_signups') {
        if (['signup', 'draft', 'drafted'].indexOf(t.status) < 0) return bad(res, 'Bracket already started');
        t.status = 'signup';
        t.teams = []; t.draft = null; t.subs = [];
        for (const p of t.players) p.teamId = null;
        saveDB();
        return json(res, 200, { ok: true });
      }

      // set the pending captain list (organizer toggles captains from the player list before drafting)
      if (a === 'set_captains') {
        if (t.formation !== 'draft') return bad(res, 'This tournament does not use a draft');
        if (t.status !== 'signup') return bad(res, 'Draft already started');
        const capIds = Array.isArray(b.captainIds) ? b.captainIds.filter(id => playerById(t, id)) : [];
        // dedupe
        const seen = {}; t.pendingCaptains = [];
        for (const id of capIds) { if (!seen[id]) { seen[id] = 1; t.pendingCaptains.push(id); } }
        saveDB();
        return json(res, 200, { ok: true, count: t.pendingCaptains.length });
      }

      if (a === 'start_draft') {
        if (t.formation !== 'draft') return bad(res, 'This tournament does not use a draft');
        if (t.status !== 'signup') return bad(res, 'Draft already started');
        // captains come from the pending list (or an explicit list for backward-compat)
        let capIds = Array.isArray(b.captainIds) ? b.captainIds : (t.pendingCaptains || []);
        capIds = capIds.filter(id => playerById(t, id));
        if (capIds.length < 2) return bad(res, 'Mark at least 2 captains in the player list first');
        buildDraft(t, capIds);
        finishDraftIfDone(t);
        t.pendingCaptains = [];
        saveDB();
        return json(res, 200, { ok: true });
      }

      if (a === 'form_teams') {
        if (t.formation === 'draft') return bad(res, 'This tournament drafts teams');
        if (t.status !== 'signup') return bad(res, 'Teams already formed');
        const err = (t.formation === 'open') ? finalizeOpenTeams(t) : formTeamsGrouped(t);
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
          const divs = (t.divisions && t.divisions > 1) ? t.divisions : 0;
          const R = log2i(nextPow2(n));
          t.cfg = { rounds: cleanBoList(c.rounds, R) };
          if (divs) {
            // validate each division has >= 2 teams
            for (let d = 1; d <= divs; d++) {
              const dn = t.teams.filter(x => (x.division || 0) === d).length;
              if (dn < 2) return bad(res, 'Division ' + d + ' needs at least 2 teams (adjust the split)');
            }
            for (let d = 1; d <= divs; d++) { _buildingDivision = d; buildSingle(t, t.cfg); }
            _buildingDivision = 0;
          } else {
            _buildingDivision = 0;
            buildSingle(t, t.cfg);
          }
          if (t.status !== 'finished') t.status = 'running';
        } else if (t.bracketType === 'double') {
          if (n < 3) return bad(res, 'Double elimination needs at least 3 teams');
          const divs = (t.divisions && t.divisions > 1) ? t.divisions : 0;
          const R = log2i(nextPow2(n));
          t.cfg = {
            wb: cleanBoList(c.wb, R),
            lb: cleanBoList(c.lb, 2 * R - 2),
            gf: BO_OK.indexOf(parseInt(c.gf, 10)) >= 0 ? parseInt(c.gf, 10) : 5,
            lbHandicap: c.lbHandicap ? 1 : 0
          };
          if (divs) {
            for (let d = 1; d <= divs; d++) {
              const dn = t.teams.filter(x => (x.division || 0) === d).length;
              if (dn < 3) return bad(res, 'Division ' + d + ' needs at least 3 teams for double elimination (adjust the split)');
            }
            for (let d = 1; d <= divs; d++) { _buildingDivision = d; buildDouble(t, t.cfg); }
            _buildingDivision = 0;
          } else {
            _buildingDivision = 0;
            buildDouble(t, t.cfg);
          }
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
      const admin = isAdmin(t, b.token) || isOrganizer(t, req);
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      if (!admin && (!capTeam || capTeam.id !== turnTeamId)) return json(res, 403, { error: 'Not your pick' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      if (p.teamId) return bad(res, 'Player already picked');
      const team = teamById(t, turnTeamId);
      p.teamId = team.id;
      team.playerIds.push(p.id);
      // remember the last pick so it can be undone (by that captain, if next hasn't picked; or by admin anytime)
      d.lastPick = { playerId: p.id, teamId: team.id, atIndex: d.current };
      d.current++;
      finishDraftIfDone(t);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'undo_pick') {
      if ((t.status !== 'draft' && t.status !== 'drafted') || !t.draft) return bad(res, 'No draft in progress');
      const d = t.draft;
      let lp = d.lastPick;
      // reconstruct for drafts started before pick-tracking existed: the last team to pick
      // is d.order[d.current-1], and their most recently appended player is that pick.
      if (!lp && d.current > 0) {
        const lastTeamId = d.order[d.current - 1];
        const lastTeam = teamById(t, lastTeamId);
        if (lastTeam && lastTeam.playerIds.length > 0) {
          lp = { playerId: lastTeam.playerIds[lastTeam.playerIds.length - 1], teamId: lastTeamId, atIndex: d.current - 1 };
        }
      }
      if (!lp) return bad(res, 'Nothing to undo');
      const admin = isAdmin(t, b.token) || isOrganizer(t, req);
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      // a captain may undo only their own last pick, and only if no one has picked after them
      if (!admin) {
        if (!capTeam || capTeam.id !== lp.teamId) return json(res, 403, { error: 'You can only undo your own pick' });
        if (d.current !== lp.atIndex + 1) return bad(res, 'Too late to undo \u2014 the next pick was already made');
      }
      const p = playerById(t, lp.playerId);
      const team = teamById(t, lp.teamId);
      if (!p || !team) { d.lastPick = null; saveDB(); return bad(res, 'Cannot undo (pick data missing)'); }
      // reverse it
      p.teamId = null;
      team.playerIds = team.playerIds.filter(id => id !== p.id);
      d.current = lp.atIndex;   // put the turn back to that pick
      d.lastPick = null;        // only one level of undo
      // if the draft had completed, it's active again
      if (d.done) { d.done = false; }
      if (t.status === 'drafted') { t.status = 'draft'; t.subs = []; }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // score report — supports running (partial) scores
    if (sub === 'veto_ban') {
      if (!t.veto || !t.veto.enabled) return bad(res, 'Vetoes are not enabled for this tournament');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (!m.veto) return bad(res, 'No veto in progress for this match');
      if (m.veto.done) return bad(res, 'Vetoes are already complete for this match');
      const admin = isAdmin(t, b.token) || isOrganizer(t, req);
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      // who is allowed to ban right now: the team whose turn it is (or the organizer acting for them)
      const actingTeam = admin ? (b.asTeam || m.veto.turn) : (capTeam && capTeam.id);
      if (!admin && !capTeam) return json(res, 403, { error: 'Only the match captains or the organizer can ban' });
      if (!admin && capTeam.id !== m.veto.turn) return bad(res, 'Not your turn to ban');
      if (admin && actingTeam !== m.veto.turn) return bad(res, 'It is the other team\u2019s turn to ban');
      const map = String(b.map || '').trim();
      const idx = m.veto.remaining.findIndex(x => x.toLowerCase() === map.toLowerCase());
      if (idx < 0) return bad(res, 'That map is not available to ban');
      // perform the ban
      const banned = m.veto.remaining.splice(idx, 1)[0];
      m.veto.banned.push({ map: banned, by: m.veto.turn });
      // advance turn to the other team
      m.veto.turn = (m.veto.turn === m.team1) ? m.team2 : m.team1;
      // complete?
      if (m.veto.banned.length >= m.veto.banCount || m.veto.remaining.length <= 1) {
        m.veto.done = true;
        m.veto.turn = null;
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'report') {
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      const admin = isAdmin(t, b.token) || isOrganizer(t, req);
      // a captain may report their own match: by token (legacy) or by FAF identity (new)
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);

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
  if (p === '/' || p === '/host' || p.startsWith('/t/')) p = '/index.html';
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
    if (url.pathname.startsWith('/auth/')) return await handleAuth(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Server error: ' + e.message });
  }
});

server.listen(PORT, () => console.log('FAF Tourney running on port ' + PORT));
