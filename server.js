// FAF Tourney — zero-dependency tournament manager
// Node 18+ only. No npm install needed.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const challonge = require('./challonge');
// Leaf helpers now live in lib/util.js (see that file). Destructured here so
// existing call sites are unchanged.
const {
  uid, now, shuffle, cleanName, intIn, cleanDate,
  json, bad, readBody, b64url, randToken, pkcePair,
  playerById, teamById, matchById,
} = require('./lib/util');
// Pure bracket math (seeding, sizing, Bo validation) lives in lib/bracket.js.
const { BO_OK, seedOrder, nextPow2, log2i, seededSlots, cleanBoList } = require('./lib/bracket');
// Match core + veto engine (one cohesive unit) live in lib/match.js.
const {
  poolById, poolForMatch, poolMapIds, cleanSequence, cleanVeto, abRating, decideTeamA,
  initVeto, vetoCurrentStep, vetoAdvance,
  newMatch, routeVal, setSlot, evaluate, finalizeMatch, undoMatch, backfillMatchLinks,
  buildSingle, buildDouble,
} = require('./lib/match');
// Swiss and FFA formats (import the shared match primitives internally).
const { swissPairRound, swissAfterReport, swissStandings } = require('./lib/swiss');
const { ffaCreateRound, ffaAfterReport, ffaRank } = require('./lib/ffa');
// Team formation and map lookups.
const { buildDraft, finishDraftIfDone, finalizeOpenTeams, formTeamsGrouped } = require('./lib/teams');
const { mapById, publicMapView } = require('./lib/maps');
// Wire the Swiss progression hook into the match core (see lib/match.js). Must come
// after the swiss require above, since swissAfterReport is now imported, not hoisted.
require('./lib/match').setHooks({ swissAfterReport });

const PORT = parseInt(process.env.PORT || '8090', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
// Map preview images live in their own directory so they can be relocated to another
// drive later (or served from a CDN) without touching db.json, which stores only filenames.
const MAP_IMG_DIR = process.env.MAP_IMG_DIR || path.join(DATA_DIR, 'map-images');
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB per image
// Description/briefing images live in their own directory so they can be relocated to
// another drive independently (DESC_IMG_DIR). Capped per tournament.
const DESC_IMG_DIR = process.env.DESC_IMG_DIR || path.join(DATA_DIR, 'desc-images');
const MAX_DESC_IMAGES = 10;
// FAQ/Rules article images (own directory, relocatable like the others).
const ARTICLE_IMG_DIR = process.env.ARTICLE_IMG_DIR || path.join(DATA_DIR, 'article-images');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Site-wide admin password. Set via ADMIN_PASSWORD environment variable in the
// Dockhand stack — NOT in this repo, so it is never visible on GitHub.
const GADMIN = process.env.ADMIN_PASSWORD || '';

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
  if (!Array.isArray(db.auditLog)) db.auditLog = [];
  if (!Array.isArray(db.hostRequests)) db.hostRequests = [];
  if (!db.hostAllowed || typeof db.hostAllowed !== 'object') db.hostAllowed = {};
  if (!Array.isArray(db.editorRequests)) db.editorRequests = [];
  if (!db.editorAllowed || typeof db.editorAllowed !== 'object') db.editorAllowed = {};
  if (!Array.isArray(db.importerRequests)) db.importerRequests = [];
  if (!db.importerAllowed || typeof db.importerAllowed !== 'object') db.importerAllowed = {};   // fafId -> {name, at, by}: may use the Challonge importer, nothing else
  if (!db.siteAdmins || typeof db.siteAdmins !== 'object') db.siteAdmins = {};  // fafId -> {name, at, by}: FAF accounts linked as site admins
  if (!db.directors || typeof db.directors !== 'object') db.directors = {};   // fafId -> {name, at, by}: global TDs over all official tournaments
  if (!db.tourneyBans || typeof db.tourneyBans !== 'object') db.tourneyBans = {};  // fafId -> {name, reason, expires, at, by}
  if (!Array.isArray(db.articles)) db.articles = [];
  if (!db.profiles || typeof db.profiles !== 'object') db.profiles = {};   // per-FAF-account profile (e.g. discord handle)
  // Tournament series: a lightweight grouping label. Editions are fully independent of one
  // another (no qualification, no fixed cadence) — a series just links them for browsing.
  if (!db.series || typeof db.series !== 'object') db.series = {};   // id -> {id,name,description,at,by}
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
    if (!Array.isArray(t.mapDb)) t.mapDb = [];
    if (!Array.isArray(t.mapPools)) t.mapPools = [];
    if (!t.poolAssign || typeof t.poolAssign !== 'object') t.poolAssign = {};
    if (t.lobbyOptions === undefined) t.lobbyOptions = '';
    if (t.mods === undefined) t.mods = '';
    if (t.imported === undefined) t.imported = false;
    if (t.veto === undefined) t.veto = { enabled: false, mode: 'upfront' };
    if (!t.lateToken) t.lateToken = uid(12);
    if (!Array.isArray(t.organizerFafIds)) t.organizerFafIds = [];
    if (!Array.isArray(t.pendingCaptains)) t.pendingCaptains = [];
    // "Premade teams" now uses the create-team / request-to-join / invite system (the 'open'
    // formation). Migrate any legacy premade tournament to 'open'; while still in signup, drop
    // the free-text team names players typed, since teams now form through the UI.
    if (t.formation === 'premade') {
      t.formation = 'open';
      if (t.status === 'signup') { for (const p of (t.players || [])) { if (p.teamName) delete p.teamName; } }
    }
    if (t.divisions === undefined) t.divisions = 0;
    for (const tm of (t.teams || [])) { if (tm.division === undefined) tm.division = 0; }
    // Self-heal open-teams data: drop any team member ids that no longer point at a real player
    // (a past withdrawal that did not detach cleanly left ghost slots, e.g. 2/2 with 1 member).
    if (Array.isArray(t.teams) && Array.isArray(t.players)) {
      const _alive = new Set(t.players.map(p => p.id));
      for (const tm of t.teams) {
        if (Array.isArray(tm.playerIds)) tm.playerIds = tm.playerIds.filter(pid => _alive.has(pid));
        if (Array.isArray(tm.invites)) tm.invites = tm.invites.filter(iv => _alive.has(iv.playerId));
        if (Array.isArray(tm.joinRequests)) tm.joinRequests = tm.joinRequests.filter(r => _alive.has(r.playerId));
        if (tm.captainId && !_alive.has(tm.captainId)) tm.captainId = tm.playerIds[0] || null;
      }
      if (t.status === 'signup') t.teams = t.teams.filter(tm => (tm.playerIds || []).length > 0);
    }
    for (const m of (t.matches || [])) {
      if (!m.bracket) m.bracket = 'wb';
      if (!m.bo) m.bo = t.bestOf || 3;
    }
    if (backfillMatchLinks(t)) changed = true;
  }
  // Sessions created before token encryption hold plaintext access/refresh tokens. Re-wrap them
  // in place on first boot. Without a key (OAuth not configured) they are left untouched rather
  // than destroyed - there is nothing to protect them with and nothing using them either.
  if (TOKEN_KEY) {
    for (const sid of Object.keys(db.sessions || {})) {
      const s = db.sessions[sid];
      if (!s || !s.faf || s.faf.enc) continue;
      if (!s.faf.access && !s.faf.refresh) continue;
      setSessTokens(s, s.faf.access || null, s.faf.refresh || null, s.faf.exp || 0);
      changed = true;
    }
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
      fs.mkdirSync(MAP_IMG_DIR, { recursive: true });
      fs.mkdirSync(DESC_IMG_DIR, { recursive: true });
      fs.mkdirSync(ARTICLE_IMG_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('save failed:', e.message);
    }
  }, 150);
}

// ---------- FAF token encryption ----------
// A logged-in session carries the player's FAF access + refresh tokens so the server can read
// their rating on their behalf. Those are live credentials, so they are encrypted at rest:
// db.json (and any backup or copy of it) holds ciphertext only.
//
// The key is derived from FAF_CLIENT_SECRET, which is already required for OAuth to work at all
// and already lives only in the container environment, never on disk beside the data. Nothing new
// to configure. Consequence: rotating the FAF client secret makes existing session tokens
// undecryptable, which logs everyone out (they just log in again). Losing the key is never worse
// than that - tokens are disposable, no tournament data depends on them.
const TOKEN_KEY = FAF_CLIENT_SECRET
  ? crypto.createHash('sha256').update('faf-tourney:session-tokens:v1:' + FAF_CLIENT_SECRET).digest()
  : null;

// { access, refresh } -> "v1:iv:tag:ciphertext" (base64url). Null key (no OAuth configured) or
// nothing worth storing returns null, and the caller simply stores no tokens.
function encTokens(access, refresh) {
  if (!TOKEN_KEY || (!access && !refresh)) return null;
  try {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
    const body = Buffer.concat([c.update(JSON.stringify({ a: access || null, r: refresh || null }), 'utf8'), c.final()]);
    return 'v1:' + b64url(iv) + ':' + b64url(c.getAuthTag()) + ':' + b64url(body);
  } catch (e) { return null; }
}

// Inverse. Any failure (rotated secret, corrupted value, truncated file) returns empty tokens
// rather than throwing: callers already treat a missing token as "log out and back in", which is
// the correct outcome when we genuinely can no longer read the credential.
function decTokens(blob) {
  if (!TOKEN_KEY || typeof blob !== 'string' || blob.slice(0, 3) !== 'v1:') return { access: null, refresh: null };
  try {
    const p = blob.split(':');
    if (p.length !== 4) return { access: null, refresh: null };
    const d = crypto.createDecipheriv('aes-256-gcm', TOKEN_KEY, Buffer.from(p[1], 'base64url'));
    d.setAuthTag(Buffer.from(p[2], 'base64url'));
    const out = JSON.parse(Buffer.concat([d.update(Buffer.from(p[3], 'base64url')), d.final()]).toString('utf8'));
    return { access: out.a || null, refresh: out.r || null };
  } catch (e) { return { access: null, refresh: null }; }
}

// Read a session's tokens, transparently handling both the encrypted form and the legacy
// plaintext one (a session created before this change and not yet migrated).
function sessTokens(sess) {
  if (!sess || !sess.faf) return { access: null, refresh: null };
  if (sess.faf.enc) return decTokens(sess.faf.enc);
  return { access: sess.faf.access || null, refresh: sess.faf.refresh || null };
}

// Write tokens back in encrypted form, clearing any legacy plaintext fields.
function setSessTokens(sess, access, refresh, exp) {
  if (!sess) return;
  const enc = encTokens(access, refresh);
  sess.faf = enc ? { enc, exp } : { access, refresh, exp };
  return sess.faf;
}

// ---------- helpers ----------

function getT(id) { return db.tournaments[id] || null; }
// Admin rights via token. The site admin password (GADMIN) is its own identity and always
// works. The tournament's organizer-link token, however, only grants rights to a LOGGED-IN
// account while FAF login is on — an anonymous visitor holding the link can view, not act.
// (With FAF login off, legacy behaviour is unchanged: the token alone is enough.)
function isAdmin(t, token, req) {
  if (isSiteAdmin(req)) return true;        // linked site-admin session
  if (!token) return false;
  if (token !== t.adminToken) return false;
  if (FAF_OAUTH_ON && !currentSession(req)) return false;
  return true;
}
// Approved articles editor: a FAF account the site admin confirmed for FAQ/Rules editing only.
function editorSession(req) {
  const sess = currentSession(req);
  return (sess && db.editorAllowed[sess.fafId]) ? sess : null;
}
// A FAF account approved to use the Challonge importer (importer access only).
function isImporter(req) {
  const sess = currentSession(req);
  return !!(sess && db.importerAllowed[sess.fafId]);
}

// ---------- audit log ----------
// A short, honest record of the things worth being able to answer later: who made this, and
// who deleted that. Capped so db.json can't grow without bound.
const AUDIT_MAX = 5000;
function clientIp(req) {
  if (!req || !req.headers) return '';        // system-initiated (e.g. scheduled publish)
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}
// Who is doing this? Prefer a real FAF identity; fall back to how they authenticated.
function actorOf(req, token) {
  const sess = currentSession(req);
  if (sess) return { kind: 'faf', fafId: sess.fafId, name: sess.fafName || ('FAF ' + sess.fafId) };
  if (token) return { kind: 'token', fafId: null, name: 'Organizer link' };
  return { kind: 'anon', fafId: null, name: 'Anonymous' };
}
function audit(req, action, opts) {
  opts = opts || {};
  const a = opts.actor || actorOf(req, opts.token);
  db.auditLog.push({
    id: uid(8),
    at: Date.now(),
    action: action,
    actorKind: a.kind,
    actorFafId: a.fafId || null,
    actorName: a.name || '',
    ip: clientIp(req),
    tournamentId: opts.tournamentId || null,
    tournamentName: opts.tournamentName || '',
    detail: opts.detail || ''
  });
  if (db.auditLog.length > AUDIT_MAX) db.auditLog = db.auditLog.slice(-AUDIT_MAX);
  // Tournament-scoped audit entries also land in that tournament's own log,
  // so the per-tournament Log tab gets them for free.
  if (opts.tournamentId && db.tournaments[opts.tournamentId]) {
    tpush(db.tournaments[opts.tournamentId], a.name || 'Anonymous', action.replace(/_/g, ' ') + (opts.detail ? ': ' + opts.detail : ''));
  }
}

function tTeamName(t, id) { const tm = (t.teams || []).find(x => x.id === id); return tm ? tm.name : '?'; }

// ---------- per-tournament activity log (Log tab, organizers + site admin only) ----------
const TLOG_MAX = 1000;
function tpush(t, by, text) {
  t.log = t.log || [];
  t.log.push({ at: Date.now(), by: String(by || 'Anonymous').slice(0, 60), text: String(text || '').slice(0, 300) });
  if (t.log.length > TLOG_MAX) t.log = t.log.slice(-TLOG_MAX);
}
// Convenience: resolve the actor from the request/token and log in one call.
function tlog(t, req, token, text) {
  const a = actorOf(req, token);
  tpush(t, a.name, text);
}

// ---------- who may host ----------
// Before FAF login is configured, anyone can create (the legacy flow). Once it's on, a FAF
// account must be approved by the site admin — that's what stops spam and accidents.
function canHost(req, token) {
  if (isSiteAdmin(req)) return true;                    // site admin always can
  if (!FAF_OAUTH_ON) return true;                       // pre-login: unchanged, open to all
  const sess = currentSession(req);
  if (!sess) return false;
  if (db.directors && db.directors[sess.fafId]) return true;   // global directors can always host
  if (db.siteAdmins && db.siteAdmins[sess.fafId]) return true;  // site admins can always host
  return !!db.hostAllowed[sess.fafId];
}

// A tournament's authorized organizers: the creator's FAF id plus anyone who claimed the
// organizer link while logged in. Site admin always counts.
// A tournament is "official" only when explicitly tagged so (site admin sets this).
function isOfficial(t) { return t && t.category === 'official'; }
// Series name colours. A fixed palette rather than free-form hex, so a series can never end up
// unreadable against the dark theme. New series get one picked from their name, so a list of
// series isn't a wall of identical headings; the owner can change it.
function cleanSeriesCategory(c) {
  return (c === 'official' || c === 'community') ? c : null;
}
// A series counts as ACTIVE while any of its editions is still open or being played. Finished and
// abandoned editions don't count, so dormant series sink to the bottom of the list.
function seriesActivity(seriesId) {
  let active = 0, lastMs = 0, total = 0;
  for (const t of Object.values(db.tournaments || {})) {
    if (t.seriesId !== seriesId || t.archived || t.published === false) continue;
    total++;
    const ms = tourneyMs(t);
    if (ms > lastMs) lastMs = ms;
    if (!t.abandoned && ['signup', 'draft', 'drafted', 'running'].indexOf(t.status) >= 0) active++;
  }
  return { active, lastMs, total };
}

const SERIES_COLORS = ['amber', 'blue', 'green', 'red', 'purple', 'plain'];
function cleanSeriesColor(c) {
  const v = String(c || '').toLowerCase();
  return SERIES_COLORS.indexOf(v) >= 0 ? v : null;
}
function autoSeriesColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SERIES_COLORS[h % (SERIES_COLORS.length - 1)];   // never auto-pick 'plain'
}
// Chats close a couple of days after the event so nobody can dig up an old tournament and ping
// its organizers or players. Reading stays open; only posting stops.
const CHAT_LOCK_MS = 2 * 24 * 60 * 60 * 1000;
function chatLockAt(t) {
  // No finish stamp yet means we can't know when the clock started - never lock on a guess,
  // otherwise 0 + 2 days lands in 1970 and closes the chat the instant a tournament ends.
  if (!t || t.status !== 'finished' || !t.finishedAt) return null;
  return t.finishedAt + CHAT_LOCK_MS;
}
function chatLocked(t) {
  const at = chatLockAt(t);
  return !!(at && Date.now() >= at);
}
// Stamp when a tournament finished. Finishing happens deep in the bracket engine, so this is
// applied wherever we notice it instead of threading a callback through every format.
function noteFinished(t) {
  if (t && t.status === 'finished' && !t.finishedAt) { t.finishedAt = now(); return true; }
  return false;
}
// Midnight UTC on the tournament's event date - check-in can't happen before this. Null when no
// event date is set, in which case check-in is open whenever the organizer allows it.
function checkInOpensAt(t) {
  if (!t || !t.eventDate) return null;
  const d = String(t.eventDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ms = Date.parse(d + 'T00:00:00Z');
  return isNaN(ms) ? null : ms;
}
// Headline prize: a currency plus a plain number, kept separate from the free-text rewards so it
// can be shown on its own and reused elsewhere (calendars, listings).
const PRIZE_CURRENCIES = ['USD', 'EUR', 'RUB'];
function cleanPrize(cur, amt) {
  const c = PRIZE_CURRENCIES.indexOf(String(cur || '').toUpperCase()) >= 0 ? String(cur).toUpperCase() : null;
  const n = (amt === '' || amt === null || amt === undefined) ? null : Number(amt);
  if (!c || n === null || !isFinite(n) || n < 0) return { currency: null, amount: null };
  return { currency: c, amount: Math.round(n * 100) / 100 };
}
// ---------- qualification (parent / child tournaments) ----------
// A parent lists the qualifiers that feed it:
//   t.qualifiers = [ { id, tournamentId, rule:{type:'top'|'points', n}, applied, qualified:[], unreachable:[] } ]
// The link lives only on the parent; a child derives "feeds into X" by lookup, so the two sides
// can never disagree. Qualifying does NOT sign anyone up - it sends a normal invite to accept.

// Rank a FINISHED tournament's entrants best-first, so "top N" means something in every format.
function tournamentRanking(t) {
  if (!t) return [];
  if (t.competition === 'ffa') {
    try { const r = ffaRank(t, (t.teams || []).map(x => x.id)); return Array.isArray(r) ? r.slice() : []; }
    catch (e) { return []; }
  }
  if (t.bracketType === 'swiss') {
    try { return (swissStandings(t) || []).map(r => r.teamId).filter(Boolean); } catch (e) { return []; }
  }
  // Elimination: champion first, then by how late each team was knocked out. The stage key matches
  // the bracket's own ordering, so surviving longer always ranks higher.
  const stage = m => (m.bracket === 'gf' ? 1000 : 0) + ((m.round || 0) * 10) + (m.bracket === 'lb' ? 1 : 0);
  const out = {};
  for (const m of (t.matches || [])) {
    if (m.status !== 'done' || !m.loser || m.loser === 'BYE') continue;
    const k = stage(m);
    if (out[m.loser] == null || k > out[m.loser]) out[m.loser] = k;   // their FINAL loss
  }
  const seedOf = id => { const tm = (t.teams || []).find(x => x.id === id); return (tm && tm.seed) || 9999; };
  const losers = Object.keys(out).filter(id => id !== t.championTeamId)
    .sort((a, b) => out[b] - out[a] || seedOf(a) - seedOf(b));
  const ranked = [];
  if (t.championTeamId) ranked.push(t.championTeamId);
  for (const id of losers) if (ranked.indexOf(id) < 0) ranked.push(id);
  return ranked;
}

function qualifyingTeamIds(child, rule) {
  if (!child || child.status !== 'finished') return [];
  const r = rule || {};
  if (r.type === 'points') {
    const min = Number(r.n) || 0;
    if (child.bracketType === 'swiss') {
      try { return (swissStandings(child) || []).filter(x => (x.wins || 0) >= min).map(x => x.teamId).filter(Boolean); }
      catch (e) { return []; }
    }
    if (child.competition === 'ffa') {
      const totals = child.ffaTotals || child.points || null;
      const ranked = tournamentRanking(child);
      if (!totals) return ranked;
      return ranked.filter(id => (Number(totals[id]) || 0) >= min);
    }
    return [];
  }
  return tournamentRanking(child).slice(0, Math.max(1, Number(r.n) || 1));
}

// For a team tournament the TEAM qualifies, so every member is invited; solo = that player.
function qualifiedFafIds(child, teamId) {
  const tm = (child.teams || []).find(x => x.id === teamId);
  const ids = [];
  if (tm) for (const pid of (tm.playerIds || [])) {
    const p = (child.players || []).find(x => x.id === pid);
    if (p && p.fafId) ids.push({ fafId: p.fafId, name: p.name || ('FAF ' + p.fafId) });
  }
  return ids;
}

// Lazy sweep (same idiom as scheduled publishing): apply any link whose child has finished.
function sweepQualifications() {
  let changed = false;
  for (const par of Object.values(db.tournaments || {})) {
    if (!Array.isArray(par.qualifiers) || !par.qualifiers.length) continue;
    for (const link of par.qualifiers) {
      if (link.applied) continue;
      const child = db.tournaments[link.tournamentId];
      if (!child || child.status !== 'finished') continue;
      const teamIds = qualifyingTeamIds(child, link.rule);
      par.invites = par.invites || [];
      const named = []; let invited = 0; const unreachable = [];
      for (const tid of teamIds) {
        const tm = (child.teams || []).find(x => x.id === tid);
        named.push(tm ? tm.name : tid);
        const who = qualifiedFafIds(child, tid);
        // Invites are addressed to FAF accounts; a manually-added entrant has none.
        if (!who.length) { unreachable.push(tm ? tm.name : tid); continue; }
        for (const w of who) {
          if (par.invites.some(i => i.fafId === w.fafId)) continue;
          par.invites.push({ fafId: w.fafId, name: w.name, at: now(), via: child.id, viaName: child.name });
          invited++;
        }
      }
      link.applied = now(); link.qualified = named; link.unreachable = unreachable;
      changed = true;
      tpush(par, 'System', 'qualification from "' + child.name + '": ' + named.length + ' qualified' +
        (named.length ? ' (' + named.join(', ') + ')' : '') + ', ' + invited + ' invite(s) sent' +
        (unreachable.length ? '; no FAF account for ' + unreachable.join(', ') : ''));
      audit(null, 'qualifiers_invited', {
        tournamentId: par.id, tournamentName: par.name,
        actor: { kind: 'system', fafId: null, name: 'Qualification' },
        detail: named.length + ' from ' + child.name
      });
    }
  }
  if (changed) saveDB();
  return changed;
}

// Who may rename/delete a series: site admins, directors, whoever created it, and anyone who
// organizes one of the tournaments in it (they're running an edition, so they own the grouping).
function canManageSeries(req, ser) {
  if (!ser) return false;
  if (isSiteAdmin(req) || isDirector(req)) return true;
  const sess = currentSession(req);
  if (!sess) return false;
  if (ser.byFafId && ser.byFafId === sess.fafId) return true;
  for (const t of Object.values(db.tournaments || {})) {
    if (t.seriesId !== ser.id) continue;
    if (Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(sess.fafId) >= 0) return true;
  }
  return false;
}

// Which parent (if any) this tournament feeds - derived, never stored twice.
function feedsIntoFor(t) {
  for (const par of Object.values(db.tournaments || {})) {
    if (!Array.isArray(par.qualifiers)) continue;
    const link = par.qualifiers.find(q => q.tournamentId === t.id);
    if (link) return { parentId: par.id, parentName: par.name, rule: link.rule || null, applied: link.applied || null };
  }
  return null;
}

// Sort key for a tournament by its event date, falling back to creation time.
function tourneyMs(t) {
  if (!t) return 0;
  const v = t.eventDate || t.challongeDate || null;
  const ms = v ? new Date(v).getTime() : NaN;
  return isNaN(ms) ? (t.createdAt || 0) : ms;
}
// Scheduled publishing: a draft can carry publishAt (UTC ISO). There is no background timer in
// this app, so we sweep lazily whenever tournaments are listed or opened — that covers every way
// a tournament can become visible. Returns true if anything changed (caller saves).
function sweepScheduledPublishes() {
  const now = Date.now();
  let changed = false;
  // stamp finish times we haven't recorded yet (also backfills tournaments finished before this
  // existed - they simply start their two days from now)
  for (const t of Object.values(db.tournaments || {})) if (noteFinished(t)) changed = true;
  for (const t of Object.values(db.tournaments || {})) {
    if (t.published !== false || !t.publishAt) continue;
    const at = new Date(t.publishAt).getTime();
    if (!isNaN(at) && now >= at) {
      t.published = true;
      t.publishedAt = new Date(now).toISOString();
      t.publishAt = null;
      changed = true;
      audit(null, 'tournament_published', {
        tournamentId: t.id, tournamentName: t.name,
        actor: { kind: 'system', fafId: null, name: 'Scheduled' },
        detail: 'auto-published on schedule'
      });
    }
  }
  if (changed) saveDB();
  return changed;
}
// Site admin: a FAF account linked as site admin. The ADMIN_PASSWORD (GADMIN) is no longer an
// identity of its own — it is only a bootstrap that links the CURRENT logged-in account (see
// the /api/siteadmin link endpoint). So every site-admin check is now session-based.
function isSiteAdmin(req) {
  const sess = currentSession(req);
  return !!(sess && sess.fafId && db.siteAdmins && db.siteAdmins[sess.fafId]);
}
// Global tournament directors: organizer rights on every OFFICIAL tournament.
function isDirector(req) {
  const sess = currentSession(req);
  return !!(sess && sess.fafId && db.directors && db.directors[sess.fafId]);
}
function isOrganizer(t, req) {
  const sess = currentSession(req);
  if (sess && Array.isArray(t.organizerFafIds) && sess.fafId && t.organizerFafIds.indexOf(sess.fafId) >= 0) return true;
  if (isOfficial(t) && isDirector(req)) return true;   // global TD over all official tournaments
  return false;
}
// Active tournament ban for a FAF id (expired bans return null). Blocks official tournaments only.
function activeBan(fafId) {
  if (!fafId || !db.tourneyBans) return null;
  const b = db.tourneyBans[fafId];
  if (!b) return null;
  if (b.expires && Date.now() > new Date(b.expires).getTime()) return null;
  return b;
}
// Combined check most mutating endpoints use: site-admin token OR a logged-in authorized organizer.
function canOrganize(t, req, body) {
  if (isAdmin(t, body && body.admin, req)) return true;   // site admin, or organizer token (logged in)
  if (isOrganizer(t, req)) return true;              // logged-in claimed organizer
  return false;
}
// ---------- site-admin access requests (hosting / editor / importer) ----------
// The three queues share a shape ({ id, fafId, fafName, status }) and one console tab, so
// alerts treat them as a single stream. Returns only requests still awaiting a decision.
function pendingAccessRequests() {
  const out = [];
  const groups = [['hosting', db.hostRequests], ['editor', db.editorRequests], ['importer', db.importerRequests]];
  for (const g of groups) {
    for (const r of (g[1] || [])) {
      if (r && r.status === 'pending') out.push({ id: r.id, kind: g[0], name: r.fafName || '' });
    }
  }
  return out;
}

// A pool can be scheduled to reveal itself (e.g. maps go public the morning of the event). There
// is no background timer, mirroring how tournament scheduled publishing works: the sweep runs
// whenever the tournament is read, which covers every way a pool becomes visible.
function sweepPoolPublishes(t) {
  if (!t || !Array.isArray(t.mapPools)) return false;
  const now = Date.now();
  let changed = false;
  for (const pool of t.mapPools) {
    if (pool.published || !pool.publishAt) continue;
    const at = new Date(pool.publishAt).getTime();
    if (isNaN(at) || now < at) continue;
    pool.published = 1;
    pool.publishAt = null;
    // Same rule as a manual publish: a visible pool's maps must be visible too.
    for (const id of (pool.mapIds || [])) { const mp = mapById(t, id); if (mp && !mp.published) mp.published = true; }
    tpush(t, 'Scheduled', 'pool "' + pool.name + '" published on schedule');
    changed = true;
  }
  return changed;
}

// ---------- structured map spec ----------
// Spawn layout as data rather than free text, so it renders consistently and can be filtered on
// later. Everything is optional: an unset field is simply omitted when the description is shown,
// which is why empty arrays are stored as empty rather than as a literal "none".
const MAP_SPAWN_MAX = 16;
const MAP_SIZES = ['5x5', '10x10', '20x20', '40x40', '81x81'];
function cleanSpawnList(v) {
  if (!Array.isArray(v)) return [];
  const seen = {}, out = [];
  for (const x of v) {
    const n = parseInt(x, 10);
    if (!isFinite(n) || n < 1 || n > MAP_SPAWN_MAX || seen[n]) continue;
    seen[n] = 1; out.push(n);
  }
  return out.sort((a, b) => a - b);
}
function cleanMapSpec(v) {
  if (!v || typeof v !== 'object') return null;
  const spec = {
    t1: cleanSpawnList(v.t1),
    t2: cleanSpawnList(v.t2),
    closed: cleanSpawnList(v.closed),
    closedMex: cleanSpawnList(v.closedMex),
    size: MAP_SIZES.indexOf(String(v.size || '')) >= 0 ? String(v.size) : ''
  };
  // Nothing set at all -> store null rather than an object of empties.
  if (!spec.t1.length && !spec.t2.length && !spec.closed.length && !spec.closedMex.length && !spec.size) return null;
  return spec;
}

// ---------- map database ----------
// Each map: { id, name, image (filename in MAP_IMG_DIR or null), description, published }
// map ids -> display objects (for serialization); unknown ids are dropped
// what maps can appear in the veto pool / round pools: published ones (organizers see all)
// validate + persist an uploaded base64 image, return the stored filename (or throw)
const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
function saveMapImage(dataUrl) {
  // accepts a data URL: data:image/png;base64,....
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid image data');
  const mime = m[1].toLowerCase();
  const ext = IMG_EXT[mime];
  if (!ext) throw new Error('Only image files are allowed (png, jpg, gif, webp, bmp)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG_BYTES) throw new Error('Image exceeds 5MB');
  if (buf.length === 0) throw new Error('Empty image');
  const fname = 'map_' + uid(10) + '.' + ext;
  fs.mkdirSync(MAP_IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(MAP_IMG_DIR, fname), buf);
  return fname;
}
function deleteMapImage(fname) {
  if (!fname) return;
  try { fs.unlinkSync(path.join(MAP_IMG_DIR, path.basename(fname))); } catch (e) {}
}
// Duplicate a stored map image on disk so two tournaments don't share one file (a delete
// in one shouldn't blank the other). Returns the new filename, or null if the source is gone.
function copyMapImageFile(fname) {
  if (!fname) return null;
  const src = path.join(MAP_IMG_DIR, path.basename(fname));
  if (!fs.existsSync(src)) return null;
  const ext = (path.extname(src) || '.png').slice(1);
  const dest = 'map_' + uid(10) + '.' + ext;
  fs.mkdirSync(MAP_IMG_DIR, { recursive: true });
  fs.copyFileSync(src, path.join(MAP_IMG_DIR, dest));
  return dest;
}

// --- description/briefing images (separate directory, see DESC_IMG_DIR) ---
function saveDescImage(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid image data');
  const mime = m[1].toLowerCase();
  const ext = IMG_EXT[mime];
  if (!ext) throw new Error('Only image files are allowed (png, jpg, gif, webp, bmp)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG_BYTES) throw new Error('Image exceeds 5MB');
  if (buf.length === 0) throw new Error('Empty image');
  const fname = 'desc_' + uid(10) + '.' + ext;
  fs.mkdirSync(DESC_IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(DESC_IMG_DIR, fname), buf);
  return fname;
}
function deleteDescImage(fname) {
  if (!fname) return;
  try { fs.unlinkSync(path.join(DESC_IMG_DIR, path.basename(fname))); } catch (e) {}
}

// --- FAQ/Rules article images (separate directory) ---
function saveArticleImage(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid image data');
  const ext = IMG_EXT[m[1].toLowerCase()];
  if (!ext) throw new Error('Only image files are allowed (png, jpg, gif, webp, bmp)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMG_BYTES) throw new Error('Image exceeds 5MB');
  if (buf.length === 0) throw new Error('Empty image');
  const fname = 'art_' + uid(10) + '.' + ext;
  fs.mkdirSync(ARTICLE_IMG_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTICLE_IMG_DIR, fname), buf);
  return fname;
}
function deleteArticleImage(fname) {
  if (!fname) return;
  try { fs.unlinkSync(path.join(ARTICLE_IMG_DIR, path.basename(fname))); } catch (e) {}
}

// find the pool object by id
// resolve which pool a match should use: match-specific → round → tournament default (first pool)
// the map ids available for a match's veto (its pool's maps)

// Sanitize an ordered ban/pick step list.

// Veto config: just the on/off switch and when the veto is resolved. The ban/pick ORDER
// lives on each map pool (its length is tied to that pool's size), so pools of different
// sizes can each have their own order even at the same best-of.

// The rating that decides A/B for a team. For team tournaments this is the CAPTAIN's rating,
// not the team average — the captain is the one doing the banning and picking.

// Decide Team A for a match under the tournament's A/B rule. Returns null when the organizer
// must set it by hand ('manual'), which holds the veto until they do.

// The team the logged-in viewer is the CAPTAIN of (matched by FAF identity).
// Rating cap: players keep their true rating in ratingActual; p.rating is the value used
// everywhere (seeding, team sums, A/B, display) and is clamped to t.ratingCap if set. This
// keeps every downstream reader unchanged and lets the cap be changed live.
function cappedRating(t, raw) {
  if (raw == null) return null;
  if (t.ratingCap != null && raw > t.ratingCap) return t.ratingCap;
  return raw;
}
function applyRatingCap(t, p) {
  if (p.ratingActual == null && p.rating != null) p.ratingActual = p.rating;
  if (p.ratingActual != null) p.rating = cappedRating(t, p.ratingActual);
}
function recomputeAllRatings(t) {
  for (const p of (t.players || [])) applyRatingCap(t, p);
}

// Streamer/caster access: a share link that opens every chat room and marks the viewer
// as STREAMER, with zero organizer powers (no admin tab, no log, no mutations).
function isStreamer(t, token) {
  return !!(token && t.streamerToken && token === t.streamerToken);
}

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

// Rebuild the stored per-round Bo arrays from the actual matches, so the format summary and
// later reads reflect per-round edits. Rounds are per-round uniform by design, so the first
// match in each round represents that round's Bo.
function syncPlanFromMatches(t) {
  if (!Array.isArray(t.matches) || !t.matches.length) return;
  const firstBo = (bracket, round) => {
    const any = t.matches.find(x => x.bracket === bracket && x.round === round);
    return any ? any.bo : null;
  };
  const roundsOf = (bracket) => {
    const rs = [...new Set(t.matches.filter(x => x.bracket === bracket).map(x => x.round))].sort((a, b) => a - b);
    return rs.map(r => firstBo(bracket, r)).filter(v => v != null);
  };
  t.plan = t.plan || {};
  if (t.bracketType === 'single') {
    t.plan.roundsList = roundsOf('wb');
  } else if (t.bracketType === 'double') {
    t.plan.wbList = roundsOf('wb');
    t.plan.lbList = roundsOf('lb');
    const gf = t.matches.find(x => x.bracket === 'gf');
    if (gf) t.plan.gf = gf.bo;
  }
}

function matchLabel(t, m) {
  if (!m) return '';
  if (m.bracket === 'gf') return t.bracketType === 'swiss' ? 'Final' : 'Grand Final';
  if (m.bracket === 'sw') return 'Round ' + m.round + ' Match ' + (m.index + 1);
  if (m.bracket === 'ffa') return 'Round ' + m.round + ' Lobby ' + (m.index + 1);
  const p = m.bracket === 'lb' ? 'LB ' : (t.bracketType === 'double' ? 'WB ' : '');
  return p + 'Round ' + m.round + ' Match ' + (m.index + 1);
}

// ---------- tournament chat ----------
// Rooms: 'global' (everyone in the tournament + organizer) and 'match:<id>' (the two
// participating teams' members + organizer). Rooms are created lazily. A match room becomes
// reachable for a team as soon as that team is slotted into the match, so advancing to a
// new match (e.g. dropping to losers') adds its chat automatically.
const CHAT_MAX = 500;      // messages kept per room
const CHAT_MSG_LEN = 500;

function chatMuted(t, fafId) {
  return !!(t.chatMutes && fafId && t.chatMutes[fafId]);
}
// Which teams a logged-in viewer plays on / captains (by FAF identity).
function viewerTeamIds(t, req) {
  const sess = currentSession(req);
  if (!sess || !sess.fafId) return [];
  const ids = [];
  for (const tm of (t.teams || [])) {
    if ((tm.playerIds || []).some(pid => { const p = playerById(t, pid); return p && p.fafId === sess.fafId; })) ids.push(tm.id);
    else if (tm.captainId) { const c = playerById(t, tm.captainId); if (c && c.fafId === sess.fafId) ids.push(tm.id); }
  }
  return ids;
}
// Can this request read/write the given room? organizer => everything.
function chatAccess(t, req, room, token) {
  if (isAdmin(t, token, req) || isOrganizer(t, req)) return true;
  if (isStreamer(t, token)) return room === 'global' || (room.indexOf('match:') === 0 && !!matchById(t, room.slice(6)));
  const sess = currentSession(req);
  if (!sess || !sess.fafId) return false;
  // must be a participant of the tournament at all
  const signedUp = (t.players || []).some(p => p.fafId === sess.fafId);
  if (room === 'global') return signedUp;
  if (room.indexOf('match:') === 0) {
    const m = matchById(t, room.slice(6));
    if (!m) return false;
    const mine = viewerTeamIds(t, req);
    return mine.indexOf(m.team1) >= 0 || mine.indexOf(m.team2) >= 0;
  }
  return false;
}
// The list of rooms a viewer can see, with labels and unread counts.
function chatRoomsFor(t, req, token) {
  const organizer = isAdmin(t, token, req) || isOrganizer(t, req);
  const streamer = !organizer && isStreamer(t, token);
  const rooms = [];
  const store = t.chat || {};
  const rsess = currentSession(req);
  const myPings = (rsess && t.userPings && t.userPings[rsess.fafId]) || {};
  const mySeen = (rsess && t.chatSeen && t.chatSeen[rsess.fafId]) || {};
  const push = (id, label, done) => {
    const msgs = (store[id] || []);
    const seen = mySeen[id] || 0;
    // messages since this viewer last opened the room, ignoring their own
    const unread = rsess ? msgs.filter(mm => mm.at > seen && mm.fafId !== rsess.fafId).length : 0;
    rooms.push({
      id, label, count: msgs.length,
      last: msgs.length ? msgs[msgs.length - 1].at : 0,
      unread: unread,
      ping: (t.chatPings && t.chatPings[id]) ? 1 : 0,   // organizer attention flag
      mention: myPings[id] ? 1 : 0,                     // this viewer was @mentioned here
      done: done ? 1 : 0                                // match finished (for grouping)
    });
  };
  // global first
  if (organizer || streamer || (currentSession(req) && (t.players || []).some(p => { const sess = currentSession(req); return sess && p.fafId === sess.fafId; }))) {
    push('global', 'Global \u2014 everyone', false);
  }
  const mine = (organizer || streamer) ? null : viewerTeamIds(t, req);
  for (const m of (t.matches || [])) {
    // a match chat exists only once BOTH sides are known, real teams (not empty, BYE, or an
    // unresolved feeder placeholder) — otherwise the list fills with "? vs ?" rooms.
    const t1 = teamById(t, m.team1), t2 = teamById(t, m.team2);
    if (!t1 || !t2 || m.team1 === 'BYE' || m.team2 === 'BYE') continue;
    const canSee = organizer || streamer || (mine && (mine.indexOf(m.team1) >= 0 || mine.indexOf(m.team2) >= 0));
    if (!canSee) continue;
    push('match:' + m.id, matchLabel(t, m) + ' \u2014 ' + t1.name + ' vs ' + t2.name, m.status === 'done');
  }
  return rooms;
}

function teamOfCaptainToken(t, token) {
  if (!token) return null;
  for (const team of t.teams) if (team.captainToken === token) return team;
  return null;
}


function publicView(t) {
  return {
    id: t.id, name: t.name, description: t.description, rewards: t.rewards || '', prize: t.prize || { currency: null, amount: null }, sponsors: t.sponsors || '', category: t.category || null,
    published: t.published !== false ? 1 : 0, publishAt: t.publishAt || null, archived: t.archived ? 1 : 0, abandoned: t.abandoned ? 1 : 0,
    seriesId: t.seriesId || null,
    qualifiers: (t.qualifiers || []).map(q => {
      const c = db.tournaments[q.tournamentId];
      return {
        id: q.id, tournamentId: q.tournamentId,
        name: c ? c.name : '(deleted tournament)', status: c ? c.status : null,
        rule: q.rule || null, applied: q.applied || null,
        qualified: q.qualified || [], unreachable: q.unreachable || []
      };
    }),
    feedsInto: feedsIntoFor(t),
    seriesName: (t.seriesId && db.series[t.seriesId]) ? db.series[t.seriesId].name : null,
    seriesColor: (t.seriesId && db.series[t.seriesId]) ? (db.series[t.seriesId].color || autoSeriesColor(db.series[t.seriesId].name)) : null,
    signupOpensAt: t.signupOpensAt || null,
    signupClosesAt: t.signupClosesAt || null,
    minTeams: t.minTeams || 0,
    descImages: (t.descImages || []).slice(),
    news: (t.news || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0)),
    streams: (t.streams || []).slice(),
    // Name plus Discord handle (from the organizer's profile) so players can reach them when the
    // organizer isn't around in chat. Objects, but a plain name string is still derivable.
    organizersPublic: (t.organizerFafIds || []).filter(fid => !(t.organizerHidden && t.organizerHidden[fid])).map(fid => {
      const names = t.organizerNames || {};
      const viaPlayer = (t.players || []).find(pp => pp.fafId === fid);
      const nm = names[fid] || (t.organizerFafIds[0] === fid && t.createdByName) || (viaPlayer && viaPlayer.name) || 'Organizer';
      const prof = (db.profiles && db.profiles[fid]) || {};
      return { name: nm, discord: prof.discord || '' };
    }),
    minRating: t.minRating != null ? t.minRating : null,
    maxRating: t.maxRating != null ? t.maxRating : null,
    maxTeamRating: t.maxTeamRating != null ? t.maxTeamRating : null,
    ratingCap: t.ratingCap != null ? t.ratingCap : null,
    checkInDeadline: t.checkInDeadline || null,
    checkInOpensAt: checkInOpensAt(t),
    chatLockAt: chatLockAt(t),
    chatLocked: chatLocked(t) ? 1 : 0,
    lobbyOptions: t.lobbyOptions || '', mods: t.mods || '',
    competition: t.competition, formation: t.formation,
    teamSize: t.teamSize, draftOrder: t.draftOrder,
    bracketType: t.bracketType, ffaCfg: t.ffaCfg || null,
    plan: t.plan || null, maxTeams: t.maxTeams || 0, perRoundBo: t.perRoundBo ? 1 : 0,
    cfg: t.cfg || null, seeding: t.seeding, ratingType: t.ratingType || 'global', ratingDate: t.ratingDate || null,
    signupMode: t.signupMode || 'open',
    playerReporting: t.playerReporting === undefined ? 1 : (t.playerReporting ? 1 : 0),
    veto: t.veto || { enabled: false, mode: 'upfront' },
    status: t.status, createdAt: t.createdAt,
    eventDate: t.eventDate || null,
    challongeDate: t.challongeDate || null,
    rounds: t.rounds || 0,
    maps: t.maps || {},
    mapDb: (t.mapDb || []).map(publicMapView),
    mapPools: (t.mapPools || []).map(p => ({ id: p.id, name: p.name, mapIds: (p.mapIds || []).slice(), sequence: (p.sequence || []).slice(), bo: p.bo || ((p.sequence || []).filter(x => x.action === 'pick').length + 1), published: p.published ? 1 : 0, publishAt: p.publishAt || null })),
    poolAssign: t.poolAssign || {},
    players: t.players,
    teams: t.teams.map(x => ({
      id: x.id, name: x.name, seed: x.seed,
      captainId: x.captainId, playerIds: x.playerIds,
      division: x.division || 0,
      checkedIn: x.checkedIn ? 1 : 0, createdAt: x.createdAt || 0,
      captainRenamed: x.captainRenamed ? 1 : 0,
      joinRequests: (x.joinRequests || []).map(r => ({ playerId: r.playerId, name: r.name, at: r.at || 0 })),
      invites: (x.invites || []).map(iv => ({ playerId: iv.playerId, name: iv.name, at: iv.at || 0 })),
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
    // Challonge imports: source format, per-group tables, final placements, and whether the event
    // had no reproducible bracket (free-for-all / round robin / group-only).
    importedType: t.importedType || null,
    importedGroups: t.importedGroups || [],
    importedStandings: t.importedStandings || [],
    standingsOnly: t.standingsOnly ? 1 : 0,
    hasOrganizer: (Array.isArray(t.organizerFafIds) && t.organizerFafIds.length > 0) ? 1 : 0,
    createdByName: t.createdByName || '',
    source: t.source || null,
    sourceUrl: t.sourceUrl || null
  };
}

// ---------- generic elimination engine ----------
// slot values: null = pending, 'BYE' = confirmed empty, otherwise teamId

// Initialize the veto state for a match, if the tournament has vetoes enabled.
// The sequence is chosen by the match's BO; maps come from the match's assigned pool.
// A/B is set at generation (higher seed = A) and the organizer can reassign before it opens.

// which team's turn is it, and what action, at the current step? returns {team, action}|null

// advance the veto after a ban/pick; completes when the sequence is exhausted.






// undo a done match (admin correction). returns error string or null

// ---------- bracket construction ----------



// Reconstruct winnerTo/loserTo on existing brackets that were generated before those
// links were stored (older tournaments in db.json). Imported tournaments already carry
// their own links, so skip them. Idempotent: only runs when links are absent.





// per-team progress: how many swiss matches completed (incl. byes), any pending?




// ---------- FFA ----------


// total points per team across all FFA matches






// ---------- teams & draft ----------





// Finalize OPEN teams: only teams filled to exactly teamSize enter; incomplete teams and
// un-teamed players become reserves (subs). Existing teams are kept and seeded by combined rating.


// ---------- API plumbing ----------

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
// ---------- Bearer token sessions (desktop client) ----------
// The desktop client is a public OAuth client: it holds a FAF access token but can never receive
// our httpOnly cookie, so it authenticates with `Authorization: Bearer <faf access token>`.
// The token is validated against FAF itself, and the resulting session object has the same shape
// as a cookie session, so every downstream check (isSiteAdmin, canHost, canOrganize, fafValidToken)
// works unchanged. Nothing is written to db.json - these sessions live only for the request.
//
// Difference worth knowing: a Bearer session exists only while the client is making a request, so
// the server cannot act on that player's behalf while they are offline. Every current use of a
// token is inside a request handler, so this costs nothing today.
const BEARER_TTL_MS = 60 * 1000;      // re-validate a token with FAF at most once a minute
const bearerCache = new Map();        // token -> { sess, exp }

function bearerTokenOf(req) {
  const h = (req && req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1].trim() : null;
}

async function resolveBearerSession(req) {
  const token = bearerTokenOf(req);
  if (!token) return null;
  const now = Date.now();
  const hit = bearerCache.get(token);
  if (hit && hit.exp > now) return hit.sess;
  // Cheap guard against an unbounded map if a client ever churns tokens.
  if (bearerCache.size > 500) {
    for (const [k, v] of bearerCache) if (v.exp <= now) bearerCache.delete(k);
    if (bearerCache.size > 500) bearerCache.clear();
  }
  let ident = null;
  try { ident = await fafFetchIdentity(token); } catch (e) { ident = null; }
  if (!ident || !ident.fafId) {
    // Cache the rejection briefly too, so a bad or expired token can't hammer FAF on every request.
    bearerCache.set(token, { sess: null, exp: now + 10000 });
    return null;
  }
  const sess = {
    fafId: String(ident.fafId),
    fafName: ident.fafName || ('FAF ' + ident.fafId),
    exp: now + BEARER_TTL_MS,
    bearer: 1,
    // fafValidToken reads this. The client always sends a current token, so there is nothing to
    // refresh: hand back the token it arrived with.
    faf: { access: token, refresh: null, exp: now + BEARER_TTL_MS }
  };
  bearerCache.set(token, { sess, exp: now + BEARER_TTL_MS });
  return sess;
}

// Resolved once per request by the server entry point and cached on `req`, which keeps
// currentSession() synchronous and leaves all 55 of its call sites untouched.
async function attachSession(req) {
  if (req._sessionResolved) return req._session || null;
  req._sessionResolved = 1;
  req._session = bearerTokenOf(req) ? await resolveBearerSession(req) : null;
  return req._session;
}

function currentSession(req) {
  // A Bearer session resolved by attachSession wins; otherwise fall back to the cookie.
  if (req && req._session) return req._session;
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

// FAF leaderboard ids (from /data/leaderboard): global=1, ladder_1v1=2, tmm_2v2=3, tmm_3v3=6, tmm_4v4_full_share=4.
// FAF leaderboard technicalName per rating category (the working downloader filters by this).
const FAF_LEADERBOARD_NAME = { global: 'global', '1v1': 'ladder_1v1', '2v2': 'tmm_2v2', '3v3': 'tmm_3v3', '4v4': 'tmm_4v4_full_share' };

// End of the given UTC day, formatted like the downloader: "YYYY-MM-DDT23:59:59Z".
function fafDayEndIso(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T23:59:59Z';
}
function rsqlQuote(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

// Return a currently-valid FAF access token for this session, refreshing via the stored
// refresh token if it has expired. Null if the session predates token storage (re-login needed).
async function fafValidToken(sess) {
  if (!sess || !sess.faf) return null;
  // Tokens are stored encrypted; decrypt once here, at the only point that reads them.
  const cur = sessTokens(sess);
  if (cur.access && sess.faf.exp && Date.now() < sess.faf.exp - 30000) return cur.access;
  if (!cur.refresh) return cur.access || null;
  try {
    const form = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: cur.refresh,
      client_id: FAF_CLIENT_ID, client_secret: FAF_CLIENT_SECRET
    }).toString();
    const r = await httpsRequest({
      host: 'hydra.faforever.com', path: '/oauth2/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
    }, form);
    if (r.status !== 200) return cur.access || null;
    const j = JSON.parse(r.text);
    const access = j.access_token || cur.access;
    const refresh = j.refresh_token || cur.refresh;
    setSessTokens(sess, access, refresh, Date.now() + ((j.expires_in || 3600) * 1000));
    saveDB();
    return access;
  } catch (e) { return cur.access || null; }
}

// One journal lookup, mirroring the FAF downloader's Rating-lookup tab. rating = the entry's
// `rating` attribute if present, else round(mean - 3*deviation); newest entry on/before the cutoff.
// With page[totals], meta.page.totalRecords = number of journal entries up to the cutoff, i.e.
// the player's rated-game count on that board as of that date (each entry is one rated game).
async function fafJournalRating(playerFilter, lbName, cutoffIso, token) {
  const filter = playerFilter + ';leaderboard.technicalName==' + rsqlQuote(lbName) + ';createTime=le=' + rsqlQuote(cutoffIso);
  const path = '/data/leaderboardRatingJournal?filter=' + encodeURIComponent(filter) + '&sort=-createTime&page%5Bsize%5D=1&page%5Btotals%5D&include=leaderboard';
  const headers = { 'Accept': 'application/vnd.api+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsRequest({ host: 'api.faforever.com', path, method: 'GET', headers });
  let rating = null, games = null;
  try {
    if (r.status === 200) {
      const j = JSON.parse(r.text);
      const row = (j.data || [])[0];
      if (row && row.attributes) {
        const a = row.attributes;
        if (a.rating != null && isFinite(Number(a.rating))) rating = Math.round(Number(a.rating));
        else {
          const mean = Number(a.meanAfter), dev = Number(a.deviationAfter);
          if (isFinite(mean) && isFinite(dev)) rating = Math.max(0, Math.round(mean - 3 * dev));
        }
      }
      // the journal entry carries the running game count (proven live via the downloader);
      // page-totals meta is the backup
      if (row && row.attributes && row.attributes.totalGames != null && isFinite(Number(row.attributes.totalGames))) {
        games = Number(row.attributes.totalGames);
      }
      if (games == null) {
        const tot = j.meta && j.meta.page && j.meta.page.totalRecords;
        if (tot != null && isFinite(Number(tot))) games = Number(tot);
      }
    }
  } catch (e) {}
  return { filter, status: r.status, rating, games, body: (r.text || '').slice(0, 500) };
}

// Player path via gamePlayerStats (the downloader's confirmed filter), with a direct player.id
// fallback. Returns a detailed probe object used by the signup rating fetch.
async function fafRatingProbe(fafId, ratingType, asOfMs, token) {
  const lbName = FAF_LEADERBOARD_NAME[ratingType];
  const out = { fafId, ratingType, leaderboard: lbName || null, cutoff: null, hasToken: !!token, attempts: [], rating: null };
  if (!lbName || !fafId) return out;
  const cutoffIso = fafDayEndIso(asOfMs || Date.now());
  out.cutoff = cutoffIso;
  const filters = ['gamePlayerStats.player.id==' + fafId, 'player.id==' + fafId];
  for (const pf of filters) {
    let a;
    try { a = await fafJournalRating(pf, lbName, cutoffIso, token); }
    catch (e) { a = { filter: pf, status: 'error', rating: null, body: String(e && e.message) }; }
    out.attempts.push(a);
    if (a.rating != null) { out.rating = a.rating; break; }
  }
  return out;
}

async function fafFetchRating(fafId, ratingType, asOfMs, token) {
  try {
    if (ratingType === 'rc') return (await fafRcProbe(fafId, asOfMs, token)).rating;
    return (await fafRatingProbe(fafId, ratingType, asOfMs, token)).rating;
  }
  catch (e) { return null; }
}

// Look up a FAF player by exact login. Returns { fafId, name } or null. Needs a token.
async function fafLookupPlayer(login, token) {
  const path = '/data/player?filter=' + encodeURIComponent('login==' + rsqlQuote(login)) + '&page%5Bsize%5D=1';
  const headers = { 'Accept': 'application/vnd.api+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsRequest({ host: 'api.faforever.com', path, method: 'GET', headers });
  if (r.status !== 200) return { error: 'FAF lookup failed (' + r.status + ')' };
  let row;
  try { row = (JSON.parse(r.text).data || [])[0]; } catch (e) { return { error: 'FAF lookup failed' }; }
  if (!row) return null;
  return { fafId: String(row.id), name: (row.attributes && row.attributes.login) || login };
}

// Reverse lookup: FAF id -> login. Used when someone is added by raw id so we can store a real
// name instead of showing "FAF 123456" forever.
async function fafLookupById(fafId, token) {
  const id = String(fafId || '').replace(/\D/g, '');
  if (!id) return null;
  const headers = { 'Accept': 'application/vnd.api+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const r = await httpsRequest({ host: 'api.faforever.com', path: '/data/player/' + id, method: 'GET', headers });
    if (r.status !== 200) return null;
    const row = JSON.parse(r.text).data;
    const login = row && row.attributes && row.attributes.login;
    return login ? { fafId: id, name: login } : null;
  } catch (e) { return null; }
}

// Best-effort display name for a FAF id from data we already hold (no network): a linked profile,
// any tournament they've played in, or a live session.
function knownNameFor(fafId) {
  const fid = String(fafId || '');
  if (!fid) return null;
  const prof = db.profiles && db.profiles[fid];
  if (prof && prof.name) return prof.name;
  for (const t of Object.values(db.tournaments || {})) {
    const p = (t.players || []).find(x => x.fafId === fid);
    if (p && p.name) return p.name;
    if (t.organizerNames && t.organizerNames[fid] && !/^FAF \d+$/.test(t.organizerNames[fid])) return t.organizerNames[fid];
  }
  for (const sess of Object.values(db.sessions || {})) {
    if (sess && sess.fafId === fid && sess.fafName) return sess.fafName;
  }
  return null;
}

// Rating for a player per this tournament's settings (null for 'none' — organizer supplies it).
async function ratingPerSettings(t, fafId, token) {
  if (!t.ratingType || t.ratingType === 'none') return null;
  if (t.ratingType === 'rc') return (await fafRcProbe(fafId, t.ratingDate, token)).rating;
  return (await fafRatingProbe(fafId, t.ratingType, t.ratingDate, token)).rating;
}

// ---- Fearghal's RC rating ----
// The player's highest rating among 2v2 / 3v3 / 4v4 / (Global - 50); 1v1 is excluded.
// If the top board has fewer than 300 games, the next-highest boards' ratings are blended in,
// weighted by the games taken from each, until 300 games are covered (or history runs out).
const RC_BOARDS = ['2v2', '3v3', '4v4', 'global'];
const RC_TARGET_GAMES = 300;
const RC_GLOBAL_PENALTY = 50;

function computeRC(boards) {
  // boards: [{ rating, games }] with the global penalty already applied; ignore empty boards
  const usable = boards.filter(x => x && x.rating != null && x.games > 0)
    .sort((a, b) => b.rating - a.rating);
  if (!usable.length) return null;
  let sum = 0, used = 0;
  for (const x of usable) {
    if (used >= RC_TARGET_GAMES) break;
    const g = Math.min(x.games, RC_TARGET_GAMES - used);
    sum += x.rating * g;
    used += g;
  }
  // fewer than 300 total games: average over the history that exists
  return Math.round(sum / used);
}

async function fafRcProbe(fafId, asOfMs, token) {
  const out = { fafId, ratingType: 'rc', cutoff: null, boards: {}, rating: null };
  if (!fafId) return out;
  const cutoffIso = fafDayEndIso(asOfMs || Date.now());
  out.cutoff = cutoffIso;
  const collected = [];
  for (const key of RC_BOARDS) {
    const lbName = FAF_LEADERBOARD_NAME[key];
    let a = null;
    try {
      a = await fafJournalRating('gamePlayerStats.player.id==' + fafId, lbName, cutoffIso, token);
      if (a.rating == null && a.status !== 200) a = await fafJournalRating('player.id==' + fafId, lbName, cutoffIso, token);
    } catch (e) { a = { status: 'error', rating: null, games: null }; }
    let rating = a.rating, games = a.games;
    if (rating != null && key === 'global') rating -= RC_GLOBAL_PENALTY;
    // count unknown (shouldn't happen — the journal entry carries totalGames): assume a full
    // history so the board still counts (top board alone) rather than vanishing from the blend
    if (rating != null && (games == null || !isFinite(games))) games = RC_TARGET_GAMES;
    out.boards[key] = { rating, games, status: a.status };
    if (rating != null) collected.push({ rating, games });
  }
  out.rating = computeRC(collected);
  return out;
}

// ---------- auth routes ----------
async function handleAuth(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['auth','faf',...]
  const sub = parts[2] || '';

  // status endpoint always works (tells the client whether to show the FAF button + who's logged in)
  if (sub === 'me') {
    const sess = currentSession(req);
    const prof = sess ? (db.profiles[sess.fafId] || {}) : {};
    return json(res, 200, {
      enabled: FAF_OAUTH_ON,
      user: sess ? { fafId: sess.fafId, fafName: sess.fafName, discord: prof.discord || '', editor: db.editorAllowed[sess.fafId] ? 1 : 0, importer: db.importerAllowed[sess.fafId] ? 1 : 0, director: (db.directors && db.directors[sess.fafId]) ? 1 : 0, siteAdmin: (db.siteAdmins && db.siteAdmins[sess.fafId]) ? 1 : 0, allowed: (db.hostAllowed[sess.fafId] || (db.directors && db.directors[sess.fafId]) || (db.siteAdmins && db.siteAdmins[sess.fafId])) ? 1 : 0 } : null
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
    let tok;
    try { tok = JSON.parse(tokenResp.text); } catch (e) { return redirect(res, '/?login=error'); }
    const accessToken = tok.access_token;
    if (!accessToken) return redirect(res, '/?login=error');

    // resolve identity
    const ident = await fafFetchIdentity(accessToken);
    if (!ident.fafId && !ident.fafName) return redirect(res, '/?login=error');

    // create a server-side session, hand the browser an httpOnly cookie.
    // Keep the FAF token bundle so we can read the player's own data (e.g. rating) on their behalf.
    pruneSessions();
    const sid = randToken(32);
    db.sessions[sid] = { fafId: ident.fafId, fafName: ident.fafName, exp: Date.now() + SESSION_TTL_MS };
    setSessTokens(db.sessions[sid], accessToken, tok.refresh_token || null, Date.now() + ((tok.expires_in || 3600) * 1000));
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
    if (FAF_OAUTH_ON && !hostSess && !isSiteAdmin(req)) return json(res, 401, { error: 'Log in with FAF to host a tournament' });
    // Once FAF login is live, hosting is approval-only: the site admin grants it per account.
    if (!canHost(req, b.admin)) {
      const pending = (db.hostRequests || []).some(r => r.fafId === (hostSess && hostSess.fafId) && r.status === 'pending');
      return json(res, 403, {
        error: pending
          ? 'Your request to host is still waiting on the site admin.'
          : 'Your FAF account is not approved to host tournaments yet. Request access from the home page.',
        needsHostApproval: 1
      });
    }
    const name = cleanName(b.name, 60);
    if (!name) return bad(res, 'Name required');
    const category = (b.category === 'official' || b.category === 'community') ? b.category : null;
    if (!category) return bad(res, 'Choose whether this is an Official or Community tournament');
    const competition = b.competition === 'ffa' ? 'ffa' : 'team';
    let teamSize, formation, bracketType = 'single', ffaCfg = null, draftOrder = 'linear', plan = null;
    const pb = b.plan || {};
    const bo = (v, d) => BO_OK.indexOf(parseInt(v, 10)) >= 0 ? parseInt(v, 10) : d;
    if (competition === 'team') {
      teamSize = intIn(b.teamSize, 1, 6, 2);
      // "Premade teams" in the UI now uses the create-team / request-to-join / invite system,
      // which is the 'open' formation internally. Only 'draft' and 'open' remain as real modes.
      formation = (teamSize === 1) ? 'solo'
        : (b.formation === 'draft' ? 'draft' : 'open');
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
      formation = (teamSize === 1) ? 'solo' : 'open';
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
      id: uid(5), adminToken: uid(12), lateToken: uid(12), streamerToken: uid(12),
      name, description: cleanName(b.description, 20000),
      rewards: cleanName(b.rewards, 2000), sponsors: cleanName(b.sponsors, 2000),
      prize: cleanPrize(b.prizeCurrency, b.prizeAmount),
      streams: (Array.isArray(b.streams) ? b.streams.map(x => ({ url: String((x && x.url) || '').trim().slice(0, 300), info: cleanName((x && x.info) || '', 120) || '' })).filter(x => /^https?:\/\/[^\s"'<>]+$/.test(x.url)).slice(0, 10) : []),
      category,
      published: false, archived: false, descImages: [],
      // optional: attach to an existing series right away (unknown ids are simply ignored)
      seriesId: (b.seriesId && db.series[String(b.seriesId)]) ? String(b.seriesId) : null,
      lobbyOptions: cleanName(b.lobbyOptions, 20000),
      mods: cleanName(b.mods, 500),
      competition, formation, teamSize, draftOrder, bracketType, ffaCfg,
      plan, maxTeams,
      cfg: null, maps: {}, mapDb: [], mapPools: [], poolAssign: {},
      seeding: (['rating', 'random', 'manual'].indexOf(b.seeding) >= 0) ? b.seeding : 'rating',
      ratingType: (['global', '1v1', '2v2', '3v3', '4v4', 'rc'].indexOf(b.ratingType) >= 0) ? b.ratingType : (b.ratingType === 'none' ? 'none' : 'global'),
      ratingDate: b.ratingDate ? (new Date(b.ratingDate).getTime() || null) : null,
      signupMode: (['open', 'invite', 'request'].indexOf(b.signupMode) >= 0) ? b.signupMode : 'open',
      playerReporting: b.playerReporting === undefined ? true : !!b.playerReporting,
      invites: [],
      veto: cleanVeto(b.veto),
      eventDate: cleanDate(b.eventDate),
      signupOpensAt: cleanDate(b.signupOpensAt),
      signupClosesAt: cleanDate(b.signupClosesAt),
      minTeams: intIn(b.minTeams, 0, 128, 0),
      status: 'signup', createdAt: now(),
      minRating: (parseInt(b.minRating, 10) >= 0) ? parseInt(b.minRating, 10) : null,
      maxRating: (parseInt(b.maxRating, 10) > 0) ? parseInt(b.maxRating, 10) : null,
      maxTeamRating: (parseInt(b.maxTeamRating, 10) > 0) ? parseInt(b.maxTeamRating, 10) : null,
      ratingCap: (parseInt(b.ratingCap, 10) > 0) ? parseInt(b.ratingCap, 10) : null,
      organizerFafIds: (hostSess && hostSess.fafId) ? [hostSess.fafId] : [],
      organizerNames: (hostSess && hostSess.fafId) ? { [hostSess.fafId]: hostSess.fafName || '' } : {},
      createdByName: (hostSess && hostSess.fafName) || '',
      players: [], teams: [], matches: [], rounds: 0, draft: null, subs: []
    };
    db.tournaments[t.id] = t;
    saveDB();
    audit(req, 'tournament_created', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
    return json(res, 200, { id: t.id, adminToken: t.adminToken });
  }

  // Link the CURRENT logged-in FAF account as a site admin by entering the master password.
  // This is the only place the password is accepted, and it always re-adds you (even if
  // another admin removed you) — so the password holder can never be locked out.
  if (parts.length === 2 && parts[1] === 'siteadmin' && method === 'POST') {
    const b = await readBody(req);
    if (!GADMIN) return bad(res, 'Site admin is not configured on the server (ADMIN_PASSWORD env var not set)');
    const sess = currentSession(req);
    if (!sess || !sess.fafId) return json(res, 401, { error: 'Log in with FAF first, then enter the site-admin password to link this account.' });
    if (b.password !== GADMIN) return json(res, 403, { error: 'Wrong password' });
    if (!db.siteAdmins[sess.fafId]) {
      db.siteAdmins[sess.fafId] = { name: sess.fafName || ('FAF ' + sess.fafId), at: Date.now(), by: 'password' };
      saveDB();
      audit(req, 'siteadmin_linked', { actor: { kind: 'faf', fafId: sess.fafId, name: sess.fafName }, detail: 'via password' });
    }
    return json(res, 200, { ok: true, siteAdmin: 1 });
  }

  // ---- hosting access (only meaningful once FAF login is configured) ----

  // Where does the logged-in user stand? Drives the "request access" button.
  if (parts.length === 2 && parts[1] === 'host_status' && method === 'GET') {
    const sess = currentSession(req);
    if (!FAF_OAUTH_ON) return json(res, 200, { oauth: 0, allowed: 1, pending: 0, loggedIn: sess ? 1 : 0 });
    if (!sess) return json(res, 200, { oauth: 1, allowed: 0, pending: 0, loggedIn: 0 });
    const pending = (db.hostRequests || []).some(r => r.fafId === sess.fafId && r.status === 'pending');
    return json(res, 200, {
      oauth: 1,
      allowed: (db.hostAllowed[sess.fafId] || (db.directors && db.directors[sess.fafId])) ? 1 : 0,
      pending: pending ? 1 : 0,
      loggedIn: 1,
      name: sess.fafName || ''
    });
  }

  // Ask the site admin for hosting rights.
  if (parts.length === 2 && parts[1] === 'host_request' && method === 'POST') {
    const b = await readBody(req);
    const sess = currentSession(req);
    if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
    if (db.hostAllowed[sess.fafId]) return bad(res, 'You can already host tournaments');
    const existing = (db.hostRequests || []).find(r => r.fafId === sess.fafId && r.status === 'pending');
    if (existing) return bad(res, 'You already have a request waiting');
    db.hostRequests.push({
      id: uid(8),
      fafId: sess.fafId,
      fafName: sess.fafName || ('FAF ' + sess.fafId),
      message: cleanName(b.message, 300) || '',
      at: Date.now(),
      status: 'pending',
      decidedAt: null,
      decidedBy: null
    });
    saveDB();
    audit(req, 'host_access_requested', { detail: sess.fafName || sess.fafId });
    return json(res, 200, { ok: true });
  }

  // ---- articles editor access (mirrors hosting access; needs FAF login) ----

  if (parts.length === 2 && parts[1] === 'editor_status' && method === 'GET') {
    const sess = currentSession(req);
    if (!FAF_OAUTH_ON) return json(res, 200, { oauth: 0, allowed: 0, pending: 0, loggedIn: sess ? 1 : 0 });
    if (!sess) return json(res, 200, { oauth: 1, allowed: 0, pending: 0, loggedIn: 0 });
    const pending = (db.editorRequests || []).some(r => r.fafId === sess.fafId && r.status === 'pending');
    return json(res, 200, {
      oauth: 1,
      allowed: db.editorAllowed[sess.fafId] ? 1 : 0,
      pending: pending ? 1 : 0,
      loggedIn: 1,
      name: sess.fafName || ''
    });
  }

  if (parts.length === 2 && parts[1] === 'editor_request' && method === 'POST') {
    const b = await readBody(req);
    const sess = currentSession(req);
    if (!FAF_OAUTH_ON) return bad(res, 'FAF login is not configured on this server yet');
    if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
    if (db.editorAllowed[sess.fafId]) return bad(res, 'You already have articles access');
    const existing = (db.editorRequests || []).find(r => r.fafId === sess.fafId && r.status === 'pending');
    if (existing) return bad(res, 'You already have a request waiting');
    db.editorRequests.push({
      id: uid(8),
      fafId: sess.fafId,
      fafName: sess.fafName || ('FAF ' + sess.fafId),
      message: cleanName(b.message, 300) || '',
      at: Date.now(),
      status: 'pending',
      decidedAt: null,
      decidedBy: null
    });
    saveDB();
    audit(req, 'editor_access_requested', { detail: sess.fafName || sess.fafId });
    return json(res, 200, { ok: true });
  }

  // ---- Challonge importer access (mirrors editor access; needs FAF login) ----

  if (parts.length === 2 && parts[1] === 'importer_status' && method === 'GET') {
    const sess = currentSession(req);
    if (!FAF_OAUTH_ON) return json(res, 200, { oauth: 0, allowed: 0, pending: 0, loggedIn: sess ? 1 : 0 });
    if (!sess) return json(res, 200, { oauth: 1, allowed: 0, pending: 0, loggedIn: 0 });
    const pending = (db.importerRequests || []).some(r => r.fafId === sess.fafId && r.status === 'pending');
    return json(res, 200, {
      oauth: 1,
      allowed: db.importerAllowed[sess.fafId] ? 1 : 0,
      pending: pending ? 1 : 0,
      loggedIn: 1,
      name: sess.fafName || ''
    });
  }

  if (parts.length === 2 && parts[1] === 'importer_request' && method === 'POST') {
    const b = await readBody(req);
    const sess = currentSession(req);
    if (!FAF_OAUTH_ON) return bad(res, 'FAF login is not configured on this server yet');
    if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
    if (db.importerAllowed[sess.fafId]) return bad(res, 'You already have importer access');
    const existing = (db.importerRequests || []).find(r => r.fafId === sess.fafId && r.status === 'pending');
    if (existing) return bad(res, 'You already have a request waiting');
    db.importerRequests.push({
      id: uid(8),
      fafId: sess.fafId,
      fafName: sess.fafName || ('FAF ' + sess.fafId),
      message: cleanName(b.message, 300) || '',
      at: Date.now(),
      status: 'pending',
      decidedAt: null,
      decidedBy: null
    });
    saveDB();
    audit(req, 'importer_access_requested', { detail: sess.fafName || sess.fafId });
    return json(res, 200, { ok: true });
  }

  // FAF player lookup for the site-admin/director tools (ban list, director list) and for
  // organizers resolving a name to add a co-organizer. Uses the caller's own FAF token.
  if (parts.length === 2 && parts[1] === 'admin_lookup' && method === 'POST') {
    const b = await readBody(req);
    // site admins and directors may always look up; an organizer may look up for their own
    // tournament (b.tournamentId), since they're allowed to add co-organizers to it.
    let okAdmin = isSiteAdmin(req) || isDirector(req);
    if (!okAdmin && b.tournamentId) {
      const ot = db.tournaments[b.tournamentId];
      if (ot && isOrganizer(ot, req)) okAdmin = true;
    }
    if (!okAdmin) return json(res, 403, { error: 'Organizer, director, or site admin only' });
    const login = cleanName(b.name, 40);
    if (!login) return bad(res, 'Enter a FAF name');
    // A bare number is a FAF id: resolve it to the real login so callers store a name, not "FAF 123".
    if (/^\d+$/.test(login)) {
      const tk = await fafValidToken(currentSession(req));
      const byId = await fafLookupById(login, tk);
      if (byId) return json(res, 200, { ok: true, fafId: byId.fafId, name: byId.name });
      const known = knownNameFor(login);
      return json(res, 200, { ok: true, fafId: login, name: known || ('FAF ' + login) });
    }
    const token = await fafValidToken(currentSession(req));
    if (!token) return json(res, 409, { error: 'This lookup needs your FAF login. Log out and back in, then retry.', needsRelogin: 1 });
    const found = await fafLookupPlayer(login, token);
    if (found && found.error) return bad(res, found.error);
    if (!found) return bad(res, 'No FAF player named \u201c' + login + '\u201d \u2014 names are exact');
    return json(res, 200, { ok: true, fafId: found.fafId, name: found.name });
  }

  // ---- site admin data + decisions ----
  if (parts.length === 3 && parts[1] === 'siteadmin' && method === 'POST') {
    const b = await readBody(req, 8 * 1024 * 1024);   // article_image carries base64 images up to 5MB
    const fullAdmin = isSiteAdmin(req);
    const editorSess = fullAdmin ? null : editorSession(req);
    const editor = !!editorSess;
    // A global tournament director gets a subset of the console (logs, archived, articles,
    // tournament bans) — but NOT hosting requests, editor management, or the director list.
    const director = !fullAdmin && !editor && isDirector(req);
    if (!fullAdmin && !editor && !director) return json(res, 403, { error: b.password ? 'Wrong password' : 'Site admin, director, or approved editor only' });
    const act = parts[2];
    // Editors get the articles surface and nothing else.
    const EDITOR_ACTS = ['data', 'article_save', 'article_image', 'article_delete'];
    if (editor && EDITOR_ACTS.indexOf(act) < 0) return json(res, 403, { error: 'Site admin only' });
    // Directors: logs, archived, articles, and tournament bans — not requests/hosts/editors/directors.
    const DIRECTOR_ACTS = ['data', 'article_save', 'article_image', 'article_delete', 'ban_set', 'ban_remove'];
    if (director && DIRECTOR_ACTS.indexOf(act) < 0) return json(res, 403, { error: 'Directors can\u2019t do that \u2014 site admin only' });
    if (editor && act === 'data') {
      return json(res, 200, { role: 'editor', articles: (db.articles || []).slice().sort((a, c) => (a.order || 0) - (c.order || 0) || (a.createdAt || 0) - (c.createdAt || 0)).map(a => Object.assign({}, a, { archived: a.archived ? 1 : 0 })) });
    }

    if (act === 'data') {
      const bansList = Object.keys(db.tourneyBans || {}).map(fid => ({
        fafId: fid, name: db.tourneyBans[fid].name || fid, reason: db.tourneyBans[fid].reason || '',
        expires: db.tourneyBans[fid].expires || null, at: db.tourneyBans[fid].at || 0, by: db.tourneyBans[fid].by || ''
      })).sort((x, y) => y.at - x.at);
      if (director) {
        return json(res, 200, {
          role: 'director', oauth: FAF_OAUTH_ON ? 1 : 0,
          logs: db.auditLog.slice().reverse().slice(0, 500),
          archived: Object.values(db.tournaments).filter(t => t.archived).map(t => ({ id: t.id, name: t.name, status: t.status, at: t.archivedAt || 0, players: (t.players || []).length })).sort((x, y) => y.at - x.at),
          articles: (db.articles || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0)),
          bans: bansList
        });
      }
      const allowed = Object.keys(db.hostAllowed).map(fid => ({
        fafId: fid,
        name: db.hostAllowed[fid].name || '',
        at: db.hostAllowed[fid].at || 0,
        by: db.hostAllowed[fid].by || ''
      })).sort((x, y) => y.at - x.at);
      const editorAllowed = Object.keys(db.editorAllowed).map(fid => ({
        fafId: fid,
        name: db.editorAllowed[fid].name || '',
        at: db.editorAllowed[fid].at || 0,
        by: db.editorAllowed[fid].by || ''
      })).sort((x, y) => y.at - x.at);
      const importerAllowed = Object.keys(db.importerAllowed).map(fid => ({
        fafId: fid,
        name: db.importerAllowed[fid].name || '',
        at: db.importerAllowed[fid].at || 0,
        by: db.importerAllowed[fid].by || ''
      })).sort((x, y) => y.at - x.at);
      return json(res, 200, {
        role: 'admin',
        oauth: FAF_OAUTH_ON ? 1 : 0,
        logs: db.auditLog.slice().reverse().slice(0, 500),   // newest first
        requests: (db.hostRequests || []).slice().reverse(),
        allowed,
        editorRequests: (db.editorRequests || []).slice().reverse(),
        editorAllowed,
        importerRequests: (db.importerRequests || []).slice().reverse(),
        importerAllowed,
        archived: Object.values(db.tournaments).filter(t => t.archived).map(t => ({
          id: t.id, name: t.name, status: t.status, at: t.archivedAt || 0, players: (t.players || []).length
        })).sort((x, y) => y.at - x.at),
        articles: (db.articles || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0)),
        directors: Object.keys(db.directors || {}).map(fid => ({ fafId: fid, name: db.directors[fid].name || fid, at: db.directors[fid].at || 0, by: db.directors[fid].by || '' })).sort((x, y) => y.at - x.at),
        siteAdmins: Object.keys(db.siteAdmins || {}).map(fid => ({ fafId: fid, name: db.siteAdmins[fid].name || fid, at: db.siteAdmins[fid].at || 0, by: db.siteAdmins[fid].by || '' })).sort((x, y) => y.at - x.at),
        me: (currentSession(req) || {}).fafId || null,
        bans: bansList
      });
    }

    if (act === 'decide') {
      const r = (db.hostRequests || []).find(x => x.id === b.id);
      if (!r) return bad(res, 'Request not found');
      if (r.status !== 'pending') return bad(res, 'That request was already decided');
      r.status = b.approve ? 'approved' : 'denied';
      r.decidedAt = Date.now();
      r.decidedBy = 'site admin';
      if (b.approve) db.hostAllowed[r.fafId] = { name: r.fafName, at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, b.approve ? 'host_access_granted' : 'host_access_denied', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: r.fafName + ' (' + r.fafId + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'revoke') {
      const entry = db.hostAllowed[b.fafId];
      if (!entry) return bad(res, 'That account is not on the list');
      delete db.hostAllowed[b.fafId];
      saveDB();
      audit(req, 'host_access_revoked', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: (entry.name || '') + ' (' + b.fafId + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'article_save') {
      const title = cleanName(b.title, 120);
      if (!title) return bad(res, 'Title required');
      const body2 = String(b.body || '').slice(0, 20000);
      // Optional parent for sub-pages. A parent must be a real top-level article (no
      // grandchildren) and an article can't be its own parent.
      let parentId = b.parentId ? String(b.parentId) : null;
      if (parentId) {
        const par = (db.articles || []).find(x => x.id === parentId);
        if (!par || par.id === b.id) parentId = null;
        else if (par.parentId) return bad(res, 'Sub-pages can only be one level deep');
      }
      if (b.id) {
        const a = (db.articles || []).find(x => x.id === b.id);
        if (!a) return bad(res, 'Article not found');
        // don't let an article that already has children become a child itself
        if (parentId && (db.articles || []).some(x => x.parentId === a.id)) return bad(res, 'This page has sub-pages, so it can\u2019t become a sub-page itself');
        a.title = title; a.body = body2; a.updatedAt = Date.now();
        if (b.parentId !== undefined) a.parentId = parentId;
      } else {
        db.articles.push({ id: 'art' + uid(6), title, body: body2, parentId: parentId, order: db.articles.length, createdAt: Date.now(), updatedAt: Date.now() });
      }
      saveDB();
      audit(req, 'article_saved', {
        actor: editor ? { kind: 'editor', fafId: editorSess.fafId, name: editorSess.fafName || ('FAF ' + editorSess.fafId) } : { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: title + (b.id ? ' (edited)' : ' (created)') + (editor ? ' by articles editor' : '')
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'article_image') {
      let fname;
      try { fname = saveArticleImage(b.image); } catch (e) { return bad(res, e.message); }
      return json(res, 200, { ok: true, file: fname, url: '/article-images/' + fname });
    }

    if (act === 'article_delete') {
      const art = (db.articles || []).find(a => a.id === b.id);
      if (!art) return json(res, 200, { ok: true });
      art.archived = b.restore ? 0 : 1;
      art.archivedAt = b.restore ? null : Date.now();
      saveDB();
      audit(req, b.restore ? 'article_restored' : 'article_archived', {
        actor: editor ? { kind: 'editor', fafId: editorSess.fafId, name: editorSess.fafName || ('FAF ' + editorSess.fafId) } : { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: art.title + (editor ? ' by articles editor' : '')
      });
      return json(res, 200, { ok: true });
    }

    // grant directly by FAF id, without a request
    if (act === 'grant') {
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (db.hostAllowed[fid]) return bad(res, 'Already allowed');
      db.hostAllowed[fid] = { name: cleanName(b.name, 60) || ('FAF ' + fid), at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, 'host_access_granted', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: (db.hostAllowed[fid].name) + ' (' + fid + ') \u2014 added directly'
      });
      return json(res, 200, { ok: true });
    }

    // ---- articles editor management (full admin only; editors were filtered out above) ----

    if (act === 'editor_decide') {
      const r = (db.editorRequests || []).find(x => x.id === b.id);
      if (!r) return bad(res, 'Request not found');
      if (r.status !== 'pending') return bad(res, 'That request was already decided');
      r.status = b.approve ? 'approved' : 'denied';
      r.decidedAt = Date.now();
      r.decidedBy = 'site admin';
      if (b.approve) db.editorAllowed[r.fafId] = { name: r.fafName, at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, b.approve ? 'editor_access_granted' : 'editor_access_denied', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: r.fafName + ' (' + r.fafId + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'editor_revoke') {
      const fid = String(b.fafId || '').trim();
      if (!db.editorAllowed[fid]) return bad(res, 'Not an editor');
      const name = db.editorAllowed[fid].name || fid;
      delete db.editorAllowed[fid];
      saveDB();
      audit(req, 'editor_access_revoked', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: name + ' (' + fid + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'editor_grant') {
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (db.editorAllowed[fid]) return bad(res, 'Already an editor');
      db.editorAllowed[fid] = { name: cleanName(b.name, 60) || ('FAF ' + fid), at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, 'editor_access_granted', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: (db.editorAllowed[fid].name) + ' (' + fid + ') \u2014 added directly'
      });
      return json(res, 200, { ok: true });
    }

    // ---- Challonge importer management (full admin only) ----

    if (act === 'importer_decide') {
      const r = (db.importerRequests || []).find(x => x.id === b.id);
      if (!r) return bad(res, 'Request not found');
      if (r.status !== 'pending') return bad(res, 'That request was already decided');
      r.status = b.approve ? 'approved' : 'denied';
      r.decidedAt = Date.now();
      r.decidedBy = 'site admin';
      if (b.approve) db.importerAllowed[r.fafId] = { name: r.fafName, at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, b.approve ? 'importer_access_granted' : 'importer_access_denied', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: r.fafName + ' (' + r.fafId + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'importer_revoke') {
      const fid = String(b.fafId || '').trim();
      if (!db.importerAllowed[fid]) return bad(res, 'Not an importer');
      const name = db.importerAllowed[fid].name || fid;
      delete db.importerAllowed[fid];
      saveDB();
      audit(req, 'importer_access_revoked', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: name + ' (' + fid + ')'
      });
      return json(res, 200, { ok: true });
    }

    if (act === 'importer_grant') {
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (db.importerAllowed[fid]) return bad(res, 'Already an importer');
      db.importerAllowed[fid] = { name: cleanName(b.name, 60) || ('FAF ' + fid), at: Date.now(), by: 'site admin' };
      saveDB();
      audit(req, 'importer_access_granted', {
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: (db.importerAllowed[fid].name) + ' (' + fid + ') \u2014 added directly'
      });
      return json(res, 200, { ok: true });
    }

    // ---- global tournament directors (site admin only) ----
    // ---- site admins (site admin only): add/remove other site admins by FAF id ----
    if (act === 'siteadmin_grant') {
      if (!fullAdmin) return json(res, 403, { error: 'Site admin only' });
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (db.siteAdmins[fid]) return bad(res, 'Already a site admin');
      const me = (currentSession(req) || {});
      db.siteAdmins[fid] = { name: cleanName(b.name, 60) || ('FAF ' + fid), at: Date.now(), by: me.fafName || 'site admin' };
      saveDB();
      audit(req, 'siteadmin_granted', { actor: actorOf(req, null), detail: db.siteAdmins[fid].name + ' (' + fid + ')' });
      return json(res, 200, { ok: true });
    }
    if (act === 'siteadmin_revoke') {
      if (!fullAdmin) return json(res, 403, { error: 'Site admin only' });
      const fid = String(b.fafId || '').trim();
      if (!db.siteAdmins[fid]) return bad(res, 'Not a site admin');
      // You can remove anyone (including yourself); the password can always re-link. But keep at
      // least a soft guard against removing the very last admin by accident.
      if (Object.keys(db.siteAdmins).length <= 1) return bad(res, 'Can\u2019t remove the last site admin. Add another first (the password can always re-link you).');
      const nm = db.siteAdmins[fid].name || fid;
      delete db.siteAdmins[fid];
      saveDB();
      audit(req, 'siteadmin_revoked', { actor: actorOf(req, null), detail: nm + ' (' + fid + ')' });
      return json(res, 200, { ok: true });
    }

    if (act === 'director_grant') {
      if (!fullAdmin) return json(res, 403, { error: 'Site admin only' });
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (db.directors[fid]) return bad(res, 'Already a director');
      db.directors[fid] = { name: cleanName(b.name, 60) || ('FAF ' + fid), at: Date.now(), by: 'site admin' };
      if (!db.hostAllowed[fid]) db.hostAllowed[fid] = { name: db.directors[fid].name, at: Date.now(), by: 'director grant' };
      saveDB();
      audit(req, 'director_granted', { actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' }, detail: db.directors[fid].name + ' (' + fid + ')' });
      return json(res, 200, { ok: true });
    }
    if (act === 'director_revoke') {
      if (!fullAdmin) return json(res, 403, { error: 'Site admin only' });
      const fid = String(b.fafId || '').trim();
      if (!db.directors[fid]) return bad(res, 'Not a director');
      const nm = db.directors[fid].name || fid;
      delete db.directors[fid];
      saveDB();
      audit(req, 'director_revoked', { actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' }, detail: nm + ' (' + fid + ')' });
      return json(res, 200, { ok: true });
    }

    // ---- tournament bans (site admin OR director) ----
    if (act === 'ban_set') {
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      let expires = null;
      if (b.expires) { const d = new Date(b.expires); if (isNaN(d.getTime())) return bad(res, 'Invalid expiry date'); expires = d.toISOString(); }
      const existed = !!db.tourneyBans[fid];
      db.tourneyBans[fid] = {
        name: cleanName(b.name, 60) || (db.tourneyBans[fid] && db.tourneyBans[fid].name) || ('FAF ' + fid),
        reason: cleanName(b.reason, 300) || (db.tourneyBans[fid] && db.tourneyBans[fid].reason) || '',
        expires,
        at: (db.tourneyBans[fid] && db.tourneyBans[fid].at) || Date.now(),
        by: actorOf(req, b.password).name || 'Site admin'
      };
      saveDB();
      audit(req, existed ? 'tourney_ban_updated' : 'tourney_ban_set', { actor: actorOf(req, b.password), detail: db.tourneyBans[fid].name + ' (' + fid + ')' + (expires ? ' until ' + expires.slice(0, 10) : ' (no expiry)') });
      return json(res, 200, { ok: true });
    }
    if (act === 'ban_remove') {
      const fid = String(b.fafId || '').trim();
      if (!db.tourneyBans[fid]) return bad(res, 'Not banned');
      const nm = db.tourneyBans[fid].name || fid;
      delete db.tourneyBans[fid];
      saveDB();
      audit(req, 'tourney_ban_removed', { actor: actorOf(req, b.password), detail: nm + ' (' + fid + ')' });
      return json(res, 200, { ok: true });
    }

    return bad(res, 'Unknown site admin action');
  }

  // import a completed tournament from Challonge (site admin only)
  if (parts.length === 2 && parts[1] === 'import_challonge' && method === 'POST') {
    const b = await readBody(req);
    if (!isSiteAdmin(req) && !isImporter(req)) return json(res, 403, { error: 'Not authorized to import \u2014 ask a site admin for importer access' });
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

  // Tournaments the logged-in user organizes (or is a director over) — sources for "copy".
  if (parts.length === 2 && parts[1] === 'my_tournaments' && method === 'GET') {
    const sess = currentSession(req);
    if (!sess) return json(res, 200, { tournaments: [] });
    const mine = Object.values(db.tournaments).filter(t => !t.archived && (
      (Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(sess.fafId) >= 0) ||
      (isOfficial(t) && db.directors[sess.fafId])
    )).sort((a, c) => (c.createdAt || 0) - (a.createdAt || 0)).map(t => ({ id: t.id, name: t.name, category: t.category || null, status: t.status, eventDate: t.eventDate || null, mapCount: (t.mapDb || []).length, poolCount: (t.mapPools || []).length }));
    return json(res, 200, { tournaments: mine });
  }

  // ---------- tournament series ----------
  // A series is only a grouping label: editions are independent tournaments that share a name.
  // Anyone can read; site admins and directors create and edit them.
  if (parts.length === 2 && parts[1] === 'series' && method === 'GET') {
    sweepScheduledPublishes();
    const out = Object.values(db.series).map(s => {
      const eds = Object.values(db.tournaments).filter(t => t.seriesId === s.id && !t.archived && t.published !== false);
      const latest = eds.slice().sort((a, c) => (tourneyMs(c) - tourneyMs(a)))[0] || null;
      const act = seriesActivity(s.id);
      return {
        id: s.id, name: s.name, description: s.description || '',
        color: s.color || autoSeriesColor(s.name),
        category: s.category || null,
        editions: eds.length,
        activeCount: act.active,
        lastMs: act.lastMs,
        latestName: latest ? latest.name : null,
        latestId: latest ? latest.id : null,
        latestDate: latest ? (latest.eventDate || null) : null
      };
    // running series first, then by most recent activity (newest at the top), so dormant series
    // fall to the bottom instead of being mixed in.
    }).sort((a, b) => (b.activeCount > 0) - (a.activeCount > 0) || b.lastMs - a.lastMs || String(a.name).localeCompare(String(b.name)));
    return json(res, 200, { series: out });
  }

  if (parts.length === 3 && parts[1] === 'series' && method === 'GET') {
    sweepScheduledPublishes();
    const s = db.series[parts[2]];
    if (!s) return json(res, 404, { error: 'Series not found' });
    const canSeeDrafts = isSiteAdmin(req) || isDirector(req);
    const sess = currentSession(req);
    const myFid = sess && sess.fafId;
    const eds = Object.values(db.tournaments)
      .filter(t => t.seriesId === s.id && !t.archived)
      .filter(t => t.published !== false || canSeeDrafts || (myFid && Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(myFid) >= 0))
      .sort((a, c) => tourneyMs(c) - tourneyMs(a))
      .map(t => ({
        id: t.id, name: t.name, status: t.status, category: t.category || null,
        published: t.published !== false ? 1 : 0,
        competition: t.competition, bracketType: t.bracketType, teamSize: t.teamSize,
        players: (t.players || []).length, teams: (t.teams || []).length,
        eventDate: t.eventDate || null, abandoned: t.abandoned ? 1 : 0,
        championTeamId: t.championTeamId || null,
        champion: t.championTeamId ? ((t.teams || []).find(x => x.id === t.championTeamId) || {}).name || null : null
      }));
    return json(res, 200, {
      series: { id: s.id, name: s.name, description: s.description || '', color: s.color || autoSeriesColor(s.name), category: s.category || null },
      editions: eds,
      canEdit: canManageSeries(req, s)
    });
  }

  if (parts.length === 2 && parts[1] === 'series' && method === 'POST') {
    const b = await readBody(req);
    // Anyone allowed to host a tournament may create a series (that already covers site admins,
    // directors and the approved-host list). Renaming or deleting an existing series is limited
    // to whoever created it, plus site admins and directors — so a host can't rename or delete
    // somebody else's (e.g. an official) series.
    if (!canHost(req, null)) return json(res, 403, { error: 'Tournament hosting permission required' });
    const act = String(b.action || 'create');
    const sess = currentSession(req);
    const canManage = (s2) => canManageSeries(req, s2);
    if (act === 'create') {
      const name = cleanName(b.name, 80);
      if (!name) return bad(res, 'Enter a series name');
      if (Object.values(db.series).some(s2 => s2.name.toLowerCase() === name.toLowerCase())) return bad(res, 'A series with that name already exists');
      const id = uid(8);
      db.series[id] = {
        id, name, description: cleanName(b.description, 4000) || '',
        color: cleanSeriesColor(b.color) || autoSeriesColor(name),
        category: cleanSeriesCategory(b.category),
        at: now(), by: actorOf(req, null).name, byFafId: (sess && sess.fafId) || null
      };
      saveDB();
      audit(req, 'series_created', { detail: name });
      return json(res, 200, { ok: true, id });
    }
    if (act === 'update') {
      const s2 = db.series[String(b.id || '')];
      if (!s2) return bad(res, 'Series not found');
      if (!canManage(s2)) return json(res, 403, { error: 'Only an organizer of a tournament in this series (or its creator, a director, or a site admin) can edit it' });
      if (b.name !== undefined) { const n = cleanName(b.name, 80); if (!n) return bad(res, 'Enter a series name'); s2.name = n; }
      if (b.description !== undefined) s2.description = cleanName(b.description, 4000) || '';
      if (b.color !== undefined) { const c = cleanSeriesColor(b.color); if (c) s2.color = c; }
      if (b.category !== undefined) s2.category = cleanSeriesCategory(b.category);
      saveDB();
      audit(req, 'series_updated', { detail: s2.name });
      return json(res, 200, { ok: true });
    }
    if (act === 'delete') {
      const s2 = db.series[String(b.id || '')];
      if (!s2) return bad(res, 'Series not found');
      if (!canManage(s2)) return json(res, 403, { error: 'Only an organizer of a tournament in this series (or its creator, a director, or a site admin) can delete it' });
      for (const t of Object.values(db.tournaments)) if (t.seriesId === s2.id) t.seriesId = null;
      delete db.series[s2.id];
      saveDB();
      audit(req, 'series_deleted', { detail: s2.name });
      return json(res, 200, { ok: true });
    }
    return bad(res, 'Unknown action');
  }

  if (parts.length === 2 && parts[1] === 'tournaments' && method === 'GET') {
    sweepScheduledPublishes();   // flip any drafts whose scheduled publish time has passed
    sweepQualifications();       // invite qualifiers from any child that has finished
    const sess = currentSession(req);
    const myFid = sess && sess.fafId;
    const list = Object.values(db.tournaments)
      .filter(t => !t.archived && (t.published !== false
        || isSiteAdmin(req)   // site admin sees every draft
        || (myFid && Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(myFid) >= 0)))   // organizers see their own
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => ({
        id: t.id, name: t.name, status: t.status, category: t.category || null,
        published: t.published !== false ? 1 : 0,
        publishAt: t.publishAt || null,
        competition: t.competition, bracketType: t.bracketType,
        teamSize: t.teamSize, players: t.players.length,
        teams: t.teams.length, createdAt: t.createdAt,
        imported: t.imported || false,
        eventDate: t.eventDate || null,
        signupClosesAt: t.signupClosesAt || null,
        minTeams: t.minTeams || 0,
        challongeDate: t.challongeDate || null,
        abandoned: t.abandoned ? 1 : 0,
        signupOpensAt: t.signupOpensAt || null,
        minRating: t.minRating != null ? t.minRating : null,
        maxRating: t.maxRating != null ? t.maxRating : null,
        maxTeamRating: t.maxTeamRating != null ? t.maxTeamRating : null,
        ratingCap: t.ratingCap != null ? t.ratingCap : null,
        prize: (t.prize && t.prize.currency && t.prize.amount != null) ? t.prize : null
      }));
    return json(res, 200, list);
  }

  if (parts.length === 2 && parts[1] === 'halloffame' && method === 'GET') {
    // Aggregated across all published, non-archived tournaments. No schema change:
    // players are keyed by FAF id, teams by normalized name.
    const players = {};   // fafId -> { fafId, name, wins, entered }
    const teams = {};     // nameKey -> { name, wins }
    for (const t of Object.values(db.tournaments)) {
      if (t.published === false || t.archived) continue;
      for (const p of (t.players || [])) {
        if (!p.fafId) continue;
        if (!players[p.fafId]) players[p.fafId] = { fafId: p.fafId, name: p.name, wins: 0, entered: 0 };
        players[p.fafId].entered++;
        players[p.fafId].name = p.name;
      }
      if (t.status === 'finished' && t.championTeamId) {
        const champ = (t.teams || []).find(x => x.id === t.championTeamId);
        if (champ) {
          const key = (champ.name || '').trim().toLowerCase();
          if (key) { if (!teams[key]) teams[key] = { name: champ.name, wins: 0 }; teams[key].wins++; }
          for (const pid of (champ.playerIds || [])) {
            const p = (t.players || []).find(x => x.id === pid);
            if (p && p.fafId) {
              if (!players[p.fafId]) players[p.fafId] = { fafId: p.fafId, name: p.name, wins: 0, entered: 0 };
              players[p.fafId].wins++;
            }
          }
        }
      }
    }
    const playerList = Object.values(players)
      .filter(p => p.wins > 0 || p.entered > 0)
      .sort((a, b) => b.wins - a.wins || b.entered - a.entered || a.name.localeCompare(b.name));
    const teamList = Object.values(teams).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
    return json(res, 200, { players: playerList, teams: teamList });
  }

  if (parts.length === 2 && parts[1] === 'articles' && method === 'GET') {
    const archivedIds = new Set((db.articles || []).filter(a => a.archived).map(a => a.id));
    const arts = (db.articles || []).filter(a => !a.archived && !(a.parentId && archivedIds.has(a.parentId)))
      .slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    return json(res, 200, arts);
  }

  if (parts.length === 3 && parts[1] === 'my' && parts[2] === 'profile' && method === 'POST') {
    const sess = currentSession(req);
    if (!sess || !sess.fafId) return json(res, 401, { error: 'Log in with FAF first' });
    const b = await readBody(req);
    // permissive: Discord handles are 2-32 chars (legacy Name#1234 allowed); strip HTML-dangerous chars
    const discord = String(b.discord || '').trim().replace(/[<>"'&\\]/g, '').slice(0, 40);
    if (!db.profiles[sess.fafId]) db.profiles[sess.fafId] = {};
    db.profiles[sess.fafId].discord = discord;   // empty string clears it
    db.profiles[sess.fafId].updatedAt = Date.now();
    saveDB();
    return json(res, 200, { ok: true, discord });
  }

  if (parts.length === 3 && parts[1] === 'my' && parts[2] === 'pending' && method === 'GET') {
    const sess = currentSession(req);
    const out = [];
    if (sess && sess.fafId) {
      for (const t of Object.values(db.tournaments)) {
        if (t.archived || t.published === false) continue;
        const meP = (t.players || []).find(p => p.fafId === sess.fafId);
        // invited but not signed up yet
        if (!meP && t.status === 'signup' && (t.invites || []).some(i => i.fafId === sess.fafId)) {
          out.push({ tId: t.id, tName: t.name, type: 'invite', tab: 'players', text: 'You are invited \u2014 sign up now' });
        }
        // organizer: signup requests waiting for review
        if (Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(sess.fafId) >= 0) {
          const nReq = (t.players || []).filter(p => p.pending).length;
          if (nReq) out.push({ tId: t.id, tName: t.name, type: 'requests', tab: 'players', text: nReq + ' signup request' + (nReq === 1 ? ' awaits' : 's await') + ' your review' });
        }
        if (!meP) continue;
        // score submissions awaiting MY team's confirmation
        if (meP.teamId && Array.isArray(t.matches)) {
          for (const m of t.matches) {
            if (!m.pendingReport) continue;
            const other = m.pendingReport.byTeam === m.team1 ? m.team2 : m.team1;
            if (other === meP.teamId) {
              out.push({ tId: t.id, tName: t.name, type: 'confirm', tab: 'bracket', text: 'Confirm the reported score (' + m.pendingReport.score1 + '\u2013' + m.pendingReport.score2 + ')' });
              break;
            }
          }
        }
        const capTeam = (t.teams || []).find(tm => tm.captainId === meP.id);
        const myTeam = meP.teamId ? (t.teams || []).find(tm => tm.id === meP.teamId) : null;
        // join requests awaiting the captain
        if (capTeam && t.status === 'signup' && (capTeam.joinRequests || []).length) {
          const n = capTeam.joinRequests.length;
          out.push({ tId: t.id, tName: t.name, type: 'join', tab: 'teams', text: n + ' player' + (n === 1 ? '' : 's') + ' want to join ' + capTeam.name });
        }
        // captains-draft pick on the clock
        if (t.status === 'draft' && t.draft && t.draft.order && capTeam && t.draft.order[t.draft.current] === capTeam.id) {
          out.push({ tId: t.id, tName: t.name, type: 'draft', tab: 'teams', text: "It's your pick in the captains draft" });
        }
        // map-veto step
        if (capTeam && Array.isArray(t.matches)) {
          for (const m of t.matches) {
            // A match with a result can't be vetoed any more, even if older stored data still
            // has done:false on its veto (it was settled by a forfeit or an organizer score).
            if (m.status === 'done') continue;
            const v = m.veto; if (!v || v.done || !v.teamA || !v.teamB) continue;
            const step = v.sequence[v.stepIndex]; if (!step) continue;
            const turn = step.team === 'A' ? v.teamA : v.teamB;
            if (turn === capTeam.id) { out.push({ tId: t.id, tName: t.name, type: 'veto', tab: 'vetoes', text: 'Your turn to ' + (step.action === 'ban' ? 'ban' : 'pick') + ' a map' }); break; }
          }
        }
        // check-in before the deadline (any member of a full, unchecked team)
        if (myTeam && t.status === 'signup' && t.checkInDeadline && Date.now() < t.checkInDeadline && myTeam.playerIds.length >= t.teamSize && !myTeam.checkedIn) {
          out.push({ tId: t.id, tName: t.name, type: 'checkin', tab: 'teams', text: 'Check in ' + myTeam.name + ' before the deadline' });
        }
      }
    }

    // Site-admin access requests. These are the only pending items that aren't tournament-scoped,
    // and the only dismissible ones: they sit in the console until decided, so an admin who isn't
    // ready to decide can silence the alert. A request arriving AFTER a dismissal un-silences it,
    // which is the point - the alert exists because three hosting requests went unnoticed.
    let alert = null;
    if (sess && sess.fafId && isSiteAdmin(req)) {
      const pend = pendingAccessRequests();
      const seen = ((db.profiles[sess.fafId] || {}).seenRequests) || {};
      const fresh = pend.filter(r => !seen[r.id]);
      if (fresh.length) {
        const n = pend.length;
        alert = {
          type: 'access', dismissible: 1,
          text: n + ' access request' + (n === 1 ? '' : 's') + ' waiting for review' +
            (fresh.length < n ? ' (' + fresh.length + ' new)' : '')
        };
      }
    }
    return json(res, 200, { pending: out, alert });
  }

  // Silence the access-request alert until a NEW request arrives. Only ids that are still
  // pending are stored, so decided requests drop out and the map can't grow without bound.
  if (parts.length === 3 && parts[1] === 'my' && parts[2] === 'dismiss_requests' && method === 'POST') {
    const sess = currentSession(req);
    if (!sess || !sess.fafId) return json(res, 401, { error: 'Log in with FAF first' });
    if (!isSiteAdmin(req)) return json(res, 403, { error: 'Site admin only' });
    const seen = {};
    for (const r of pendingAccessRequests()) seen[r.id] = 1;
    db.profiles[sess.fafId] = db.profiles[sess.fafId] || {};
    db.profiles[sess.fafId].seenRequests = seen;
    saveDB();
    return json(res, 200, { ok: true, dismissed: Object.keys(seen).length });
  }

  if (parts.length >= 3 && parts[1] === 't') {
    const t = getT(parts[2]);
    if (!t) return json(res, 404, { error: 'Tournament not found' });
    const sub = parts[3] || '';

    if (method === 'GET' && !sub) {
      const tok = url.searchParams.get('token');
      sweepQualifications();   // opening a parent applies any qualifier whose child just finished
      let dirty = noteFinished(t);          // record when it ended (starts the chat-lock clock)
      if (sweepPoolPublishes(t)) dirty = true;   // reveal any pool whose scheduled time has passed
      if (dirty) saveDB();
      const view = publicView(t);
      const capTeam = teamOfCaptainToken(t, tok) || teamOfSession(t, req);
      const sess = currentSession(req);
      const organizer = isAdmin(t, tok, req) || isOrganizer(t, req);
      const streamer = !organizer && isStreamer(t, tok);
      // Who organizes a tournament is visible to its organizers and site admins only.
      if (!organizer) delete view.createdByName;
      if (organizer) {
        const names = t.organizerNames || {};
        view.organizers = (t.organizerFafIds || []).map(fid => {
          const viaPlayer = (t.players || []).find(p => p.fafId === fid);
          const name = names[fid]
            || (t.organizerFafIds[0] === fid && t.createdByName)
            || (viaPlayer && viaPlayer.name)
            || (db.hostAllowed[fid] && db.hostAllowed[fid].name)
            || ('FAF ' + fid);
          return { fafId: fid, name, hidden: (t.organizerHidden && t.organizerHidden[fid]) ? 1 : 0 };
        });
        view.chatPingCount = Object.keys(t.chatPings || {}).length;
      }
      // is the logged-in viewer already signed up (by FAF id)?
      let signedUpId = null;
      if (sess && sess.fafId) {
        const mine = t.players.find(p => p.fafId === sess.fafId);
        if (mine) signedUpId = mine.id;
      }
      // how many chat rooms have an unread @mention for this viewer (for the CHAT tab badge)
      view.myMentionCount = (sess && sess.fafId && t.userPings && t.userPings[sess.fafId])
        ? Object.keys(t.userPings[sess.fafId]).length : 0;
      // Unread per room for this viewer, so every place that links a chat can show a marker
      // without fetching the room list. Total is derived for the CHAT tab.
      view.unreadByRoom = {};
      view.myUnreadCount = 0;
      if (sess && sess.fafId) {
        for (const r of chatRoomsFor(t, req, tok)) {
          if (!r.unread) continue;
          view.unreadByRoom[r.id] = r.unread;
          view.myUnreadCount += r.unread;
        }
      }
      // Discord handles are contact info: visible to organizers and fellow signed-up players,
      // never to the anonymous public. Copy the player objects so the db is never mutated.
      const canSeeContacts = organizer || !!signedUpId;
      view.players = t.players
        .filter(p => !p.pending || organizer || (sess && p.fafId === sess.fafId))   // pending requests: organizer + the requester only
        .map(p => {
          const c = Object.assign({}, p);
          if (canSeeContacts && p.fafId && db.profiles[p.fafId] && db.profiles[p.fafId].discord) c.discord = db.profiles[p.fafId].discord;
          return c;
        });
      // team the viewer is a MEMBER of (reporting rights), as opposed to captain-of (viewer.teamId)
      let memberTeamId = null;
      if (sess && sess.fafId) {
        const mineM = t.players.find(p => p.fafId === sess.fafId);
        if (mineM && mineM.teamId) memberTeamId = mineM.teamId;
      }
      view.tlog = organizer ? (t.log || []).slice(-300).reverse() : undefined;
      view.chatMutes = organizer ? Object.keys(t.chatMutes || {}).map(fid => ({ fafId: fid, name: (t.chatMutes[fid].name || fid), at: t.chatMutes[fid].at || 0 })) : undefined;
      view.chatMutedMe = (sess && chatMuted(t, sess.fafId)) ? 1 : 0;
      view.invites = organizer ? (t.invites || []).map(i => ({
        fafId: i.fafId, name: i.name, at: i.at,
        via: i.via || null, viaName: i.viaName || null,   // set when the invite came from a qualifier
        status: (t.players || []).some(pl => pl.fafId === i.fafId) ? 'accepted' : (i.declined ? 'declined' : 'pending')
      })) : undefined;
      view.viewer = {
        admin: isAdmin(t, tok, req) ? 1 : 0,
        organizer: organizer ? 1 : 0,
        teamId: capTeam ? capTeam.id : null,
        loggedIn: sess ? 1 : 0,
        fafId: sess ? sess.fafId : null,
        fafName: sess ? sess.fafName : null,
        signedUpPlayerId: signedUpId,
        memberTeamId: memberTeamId,
        invited: (sess && (t.invites || []).some(i => i.fafId === sess.fafId)) ? 1 : 0,
        oauthEnabled: FAF_OAUTH_ON ? 1 : 0,
        streamer: streamer ? 1 : 0,
        newsReadAt: (sess && db.profiles[sess.fafId] && db.profiles[sess.fafId].newsRead && db.profiles[sess.fafId].newsRead[t.id]) || 0
      };
      // Hide prep from non-organizers: unpublished maps and unpublished pools.
      // Exception: a map that's already on screen somewhere (in a live veto or a round's
      // map pool) must keep its name, or players would see a raw id.
      if (!organizer && !streamer) {
        const inPlay = {};
        for (const m of (view.matches || [])) {
          if (!m.veto) continue;
          for (const id of (m.veto.remaining || [])) inPlay[id] = 1;
          for (const x of (m.veto.banned || [])) inPlay[x.map] = 1;
          for (const g of (m.veto.picks || [])) inPlay[g.map] = 1;
          if (m.veto.decider) inPlay[m.veto.decider.map] = 1;
        }
        for (const key of Object.keys(view.maps || {})) {
          for (const id of (view.maps[key] || [])) inPlay[id] = 1;
        }
        // maps inside a published pool are public by definition
        for (const p of (view.mapPools || [])) {
          if (p.published) for (const id of (p.mapIds || [])) inPlay[id] = 1;
        }
        view.mapDb = (view.mapDb || []).filter(m => m.published || inPlay[m.id]);
        view.mapPools = (view.mapPools || []).filter(p => p.published);
      }
      return json(res, 200, view);
    }

    // imported tournaments are display-only: only GET and site-admin delete are allowed
    if (t.imported && method === 'POST' && sub !== 'delete' && sub !== 'edit_date') {
      return bad(res, 'Imported tournaments are read-only.');
    }

    if (method === 'GET' && sub === 'secrets') {
      if (!isAdmin(t, url.searchParams.get('admin'), req) && !isOrganizer(t, req)) return json(res, 403, { error: 'Organizer rights required' });
      if (!t.streamerToken) { t.streamerToken = uid(12); saveDB(); }
      return json(res, 200, {
        adminToken: t.adminToken,
        lateToken: t.lateToken,
        streamerToken: t.streamerToken
      });
    }

    // ---- chat: list rooms, read a room, post, moderate ----
    if (sub === 'chat_rooms' && method === 'GET') {
      const tok = url.searchParams.get('token');
      return json(res, 200, { rooms: chatRoomsFor(t, req, tok), muted: chatMuted(t, (currentSession(req) || {}).fafId) ? 1 : 0 });
    }

    if (sub === 'chat_read' && method === 'GET') {
      const tok = url.searchParams.get('token');
      const room = String(url.searchParams.get('room') || '');
      if (!chatAccess(t, req, room, tok)) return json(res, 403, { error: 'No access to this chat' });
      const since = parseInt(url.searchParams.get('since'), 10) || 0;
      const all = (t.chat && t.chat[room]) || [];
      const msgs = since ? all.filter(mm => mm.at > since) : all.slice(-200);
      // an organizer reading the room acknowledges any pending organizer ping
      if (t.chatPings && t.chatPings[room] && (isAdmin(t, tok, req) || isOrganizer(t, req))) {
        delete t.chatPings[room];
        saveDB();
      }
      // remember how far this reader has got, so we can show an unread marker elsewhere
      const seenSess = currentSession(req);
      if (seenSess && seenSess.fafId) {
        const last = all.length ? all[all.length - 1].at : 0;
        t.chatSeen = t.chatSeen || {};
        t.chatSeen[seenSess.fafId] = t.chatSeen[seenSess.fafId] || {};
        if ((t.chatSeen[seenSess.fafId][room] || 0) < last) {
          t.chatSeen[seenSess.fafId][room] = last;
          saveDB();
        }
      }
      // the reader acknowledges any @mention ping addressed to them in this room
      const rsess = currentSession(req);
      if (rsess && t.userPings && t.userPings[rsess.fafId] && t.userPings[rsess.fafId][room]) {
        delete t.userPings[rsess.fafId][room];
        if (!Object.keys(t.userPings[rsess.fafId]).length) delete t.userPings[rsess.fafId];
        saveDB();
      }
      return json(res, 200, { room, messages: msgs, muted: chatMuted(t, (currentSession(req) || {}).fafId) ? 1 : 0 });
    }

    if (method !== 'POST') return bad(res, 'Unsupported');
    // allow up to ~8MB so map image uploads (base64 of a 5MB file ≈ 6.7MB) fit; the real
    // per-image 5MB cap is enforced when decoding in saveMapImage.
    const b = await readBody(req, 8 * 1024 * 1024);

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
      if (b.signupOpensAt !== undefined) t.signupOpensAt = cleanDate(b.signupOpensAt);
      if (b.signupClosesAt !== undefined) t.signupClosesAt = cleanDate(b.signupClosesAt);
      if (b.name !== undefined) { const nm = cleanName(b.name, 60); if (nm) t.name = nm; }
      if (b.minTeams !== undefined) t.minTeams = intIn(b.minTeams, 0, 128, 0);
      if (b.maxTeams !== undefined) t.maxTeams = intIn(b.maxTeams, 0, 128, 0);
      tlog(t, req, b.admin, 'changed the event date' + (t.eventDate ? ' to ' + t.eventDate : ' (cleared)'));
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'delete') {
      const siteAdmin = isSiteAdmin(req);
      if (!siteAdmin) {
        // Non-site-admins never hard-delete: they archive. Archiving hides the tournament from
        // the public and can be restored (or permanently removed) by the site admin.
        if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
        if (t.archived) return json(res, 200, { ok: true, archived: true });
        t.archived = true; t.archivedAt = now();
        saveDB();
        audit(req, 'tournament_archived', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: 'archived by organizer (restorable by site admin)' });
        return json(res, 200, { ok: true, archived: true });
      }
      const name = t.name, tid = t.id;
      delete db.tournaments[tid];
      saveDB();
      audit(req, 'tournament_deleted', {
        tournamentId: tid, tournamentName: name, token: b.admin,
        detail: siteAdmin ? 'removed by site admin' : 'removed by organizer during signups'
      });
      return json(res, 200, { ok: true });
    }

    // Mark a tournament as abandoned (e.g. too few signups): it stays visible under
    // Completed with an ABANDONED badge instead of pretending it finished. Reversible.
    if (sub === 'abandon') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      t.abandoned = b.undo ? 0 : 1;
      t.abandonedAt = b.undo ? null : now();
      saveDB();
      audit(req, b.undo ? 'tournament_unabandoned' : 'tournament_abandoned', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: b.undo ? '' : 'marked abandoned (too few signups or similar)' });
      return json(res, 200, { ok: true, abandoned: t.abandoned });
    }

    if (sub === 'restore') {
      if (!isSiteAdmin(req)) return json(res, 403, { error: 'Site admin only' });
      t.archived = false; t.archivedAt = null;
      saveDB();
      audit(req, 'tournament_restored', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: 'restored by site admin' });
      return json(res, 200, { ok: true });
    }

    // add a qualifier feeding THIS tournament: { tournamentId, ruleType:'top'|'points', n }
    if (sub === 'qualifier_add') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const cid = String(b.tournamentId || '').trim();
      const child = db.tournaments[cid];
      if (!child) return bad(res, 'Tournament not found');
      if (cid === t.id) return bad(res, 'A tournament cannot qualify into itself');
      if (Array.isArray(child.qualifiers) && child.qualifiers.some(q => q.tournamentId === t.id)) {
        return bad(res, 'That tournament already draws its qualifiers from this one');
      }
      t.qualifiers = t.qualifiers || [];
      if (t.qualifiers.some(q => q.tournamentId === cid)) return bad(res, 'That qualifier is already linked');
      const type = b.ruleType === 'points' ? 'points' : 'top';
      const n = Math.max(1, parseInt(b.n, 10) || 1);
      const link = { id: uid(8), tournamentId: cid, rule: { type, n }, applied: null, qualified: [], unreachable: [] };
      t.qualifiers.push(link);
      saveDB();
      tlog(t, req, b.admin, 'added "' + child.name + '" as a qualifier (' + (type === 'points' ? n + '+ points' : 'top ' + n) + ')');
      sweepQualifications();   // the child may already be finished
      return json(res, 200, { ok: true, id: link.id });
    }

    if (sub === 'qualifier_remove') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const i = (t.qualifiers || []).findIndex(q => q.id === String(b.id || ''));
      if (i < 0) return bad(res, 'Qualifier link not found');
      const gone = t.qualifiers.splice(i, 1)[0];
      const child = db.tournaments[gone.tournamentId];
      saveDB();
      tlog(t, req, b.admin, 'removed the qualifier link to "' + (child ? child.name : gone.tournamentId) + '" (invites already sent are kept)');
      return json(res, 200, { ok: true });
    }

    if (sub === 'set_series') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const sid = String(b.seriesId || '').trim();
      if (!sid) {
        t.seriesId = null;
        saveDB();
        tlog(t, req, b.admin, 'removed this tournament from its series');
        return json(res, 200, { ok: true, seriesId: null });
      }
      const s = db.series[sid];
      if (!s) return bad(res, 'Series not found');
      t.seriesId = sid;
      saveDB();
      tlog(t, req, b.admin, 'added this tournament to the "' + s.name + '" series');
      return json(res, 200, { ok: true, seriesId: sid });
    }

    if (sub === 'publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      // publishAt: schedule instead of publishing now. Empty/absent clears any schedule and
      // publishes immediately (the existing behaviour).
      if (b.publishAt !== undefined && b.publishAt) {
        const when = cleanDate(b.publishAt);
        if (!when) return bad(res, 'Invalid publish date');
        const ms = new Date(when).getTime();
        if (isNaN(ms)) return bad(res, 'Invalid publish date');
        if (ms <= Date.now()) {
          t.published = true; t.publishAt = null;
          saveDB();
          audit(req, 'tournament_published', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
          return json(res, 200, { ok: true, published: 1 });
        }
        t.publishAt = when;
        saveDB();
        audit(req, 'tournament_publish_scheduled', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: 'scheduled for ' + when });
        return json(res, 200, { ok: true, publishAt: when });
      }
      if (b.cancelSchedule) {
        t.publishAt = null;
        saveDB();
        audit(req, 'tournament_publish_unscheduled', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
        return json(res, 200, { ok: true, publishAt: null });
      }
      t.published = true;
      t.publishAt = null;
      saveDB();
      audit(req, 'tournament_published', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
      return json(res, 200, { ok: true, published: 1 });
    }

    if (sub === 'signup') {
      if (!FAF_OAUTH_ON && t.formation === 'premade' && t.teamSize > 1) return bad(res, 'This tournament uses whole-team registration \u2014 one player registers the full team');
      // signup mode gates (self-signups only; organizer direct-add uses org_add_player)
      const sessMode = currentSession(req);
      if (t.signupMode === 'invite' && !canOrganize(t, req, b)) {
        const inv = sessMode && (t.invites || []).some(i => i.fafId === sessMode.fafId);
        if (!inv) return json(res, 403, { error: 'This tournament is invite-only. Ask the organizer for an invite.' });
      }

      const sess = currentSession(req);
      const adminAdding = isAdmin(t, b.admin, req) || canOrganize(t, req, b);
      // Late signups (after signups close) require the organizer's late-signup token OR organizer rights.
      const lateOk = (b.lateToken && b.lateToken === t.lateToken) || adminAdding;
      if (t.status !== 'signup' && !lateOk) return bad(res, 'Signups are closed');
      // Scheduled signup opening: before that moment only organizers can add players.
      if (t.signupOpensAt && Date.now() < new Date(t.signupOpensAt).getTime() && !adminAdding) {
        return bad(res, 'Signups haven\u2019t opened yet \u2014 they open ' + new Date(t.signupOpensAt).toUTCString().replace(':00 GMT', ' UTC') + '.');
      }
      if (t.signupClosesAt && Date.now() > new Date(t.signupClosesAt).getTime() && !adminAdding && !lateOk) {
        return bad(res, 'Signups have closed for this tournament.');
      }

      let name, fafId = null, manual = false;
      if (!FAF_OAUTH_ON && adminAdding && b.name) {
        // Legacy (no FAF login): organizer could add an unverified player by name.
        // With FAF login on, this path is gone — everyone signs up as their own FAF identity.
        name = cleanName(b.name, 30);
        manual = true;
      } else {
        // self-signup: identity comes from the FAF login session
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

      let rating;
      if (t.ratingType && t.ratingType !== 'none') {
        // Rating is fetched from FAF (as the signing-up player) as of the tournament's date.
        // If it can't be fetched, the signup is refused rather than creating an unrated entry.
        if (!fafId) return bad(res, 'Your FAF identity is missing \u2014 please log in again');
        const token = await fafValidToken(sess);
        if (!token) return json(res, 409, { error: 'This tournament pulls your rating from FAF. Please log out and log back in (top-right), then sign up again.', needsRelogin: 1 });
        const probe = (t.ratingType === 'rc')
          ? await fafRcProbe(fafId, t.ratingDate, token)
          : await fafRatingProbe(fafId, t.ratingType, t.ratingDate, token);
        if (probe.rating == null) {
          const parts2 = probe.attempts || Object.values(probe.boards || {});
          const any200 = parts2.some(a => a.status === 200);
          if (any200) return bad(res, t.ratingType === 'rc'
            ? 'FAF has no rated 2v2/3v3/4v4/Global games for your account as of the tournament date, so no RC rating can be calculated.'
            : 'FAF has no ' + t.ratingType + ' rating for your account as of the tournament date \u2014 you may not have played ranked ' + t.ratingType + ' games by then.');
          return bad(res, 'Could not fetch your rating from FAF right now \u2014 please try again in a moment.');
        }
        rating = probe.rating;
      } else {
        rating = parseInt(b.rating, 10);
        if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter a FAF rating (0\u20134000)');
      }
      // Rating requirements apply to self-signups only. Organizer adds and invited
      // accounts bypass them (an invite IS the organizer's decision).
      // Tournament ban blocks official tournaments on every path (self-signup, organizer add,
      // invite acceptance). Organizers cannot override; only lifting/expiring the ban helps.
      if (isOfficial(t)) {
        const banFid = manual ? null : (fafId || (sess && sess.fafId));
        const ban = banFid ? activeBan(banFid) : null;
        if (ban) {
          return bad(res, 'You are currently banned from official FAF tournaments.' +
            (ban.expires ? ' Expires on: ' + new Date(ban.expires).toISOString().slice(0, 10) + '.' : ' This ban has no expiry date.') +
            ' For more information regarding your ban please contact the TD team.');
        }
      }
      const invitedHere = !!(sess && (t.invites || []).some(i => i.fafId === sess.fafId));
      if (!adminAdding && !invitedHere && rating != null) {
        if (t.minRating != null && rating < t.minRating) {
          return bad(res, 'You can\u2019t sign up here: your rating (' + rating + ') is below this tournament\u2019s minimum of ' + t.minRating + '.');
        }
        if (t.maxRating != null && rating > t.maxRating) {
          return bad(res, 'You can\u2019t sign up here: your rating (' + rating + ') is above this tournament\u2019s maximum of ' + t.maxRating + '.');
        }
      }
      const p = {
        id: 'p' + uid(4), name, rating: (rating != null ? rating : null), ratingActual: (rating != null ? rating : null), fafId: fafId, manual: manual,
        late: (t.status !== 'signup') ? 1 : 0,
        teamName: (t.formation === 'premade') ? cleanName(b.teamName, 30) : '',
        teamId: null, signedAt: now()
      };
      if (t.signupMode === 'request' && !canOrganize(t, req, b)) p.pending = 1;
      applyRatingCap(t, p);
      t.players.push(p);
      tlog(t, req, b.admin, (adminAdding && p.name !== (actorOf(req, b.admin).name) ? 'added player ' + p.name : p.name + ' signed up') + (p.rating != null ? ' (rating ' + p.rating + ')' : '') + (p.pending ? ' \u2014 awaiting approval' : '') + (p.late ? ' \u2014 late signup' : ''));
      saveDB();
      return json(res, 200, { ok: true, playerId: p.id, pending: p.pending ? 1 : 0 });
    }

    if (sub === 'signup_team') {
      if (FAF_OAUTH_ON) return bad(res, 'Whole-team registration is off. Each player signs up individually with their own FAF account, then teams are formed on the Teams tab.');
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
        const ip = { id: 'p' + uid(4), name: it.name, rating: it.rating, ratingActual: it.rating, teamName, teamId: null, signedAt: now() };
        applyRatingCap(t, ip);
        t.players.push(ip);
      }
      tlog(t, req, b.admin, 'registered team ' + cleanName(b.teamName, 30));
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Premade: a signed-up player sets or changes their team name while signups are open.
    // Entering the same name as someone else is how teammates group up, so matching an
    // existing name is deliberate and allowed. Empty clears it (player becomes a sub).
    if (sub === 'set_team_name') {
      if (t.formation !== 'premade' || t.teamSize < 2) return bad(res, 'This tournament does not use team names');
      if (t.status !== 'signup') return bad(res, 'Signups are closed \u2014 ask the organizer to move players instead');
      let p = null;
      if (b.playerId !== undefined) {
        if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
        p = playerById(t, b.playerId);
        if (!p) return bad(res, 'Player not found');
      } else {
        const sess = currentSession(req);
        if (sess) p = t.players.find(x => x.fafId === sess.fafId);
        if (!p) return bad(res, 'Sign up first, then set your team name');
      }
      p.teamName = cleanName(b.teamName, 30) || '';
      tlog(t, req, b.admin, (b.playerId !== undefined ? 'set team name of ' + p.name : p.name + ' set their team name') + (p.teamName ? ' to "' + p.teamName + '"' : ' to none (substitute)'));
      saveDB();
      return json(res, 200, { ok: true, teamName: p.teamName });
    }

    if (sub === 'remove') {
      const p0 = playerById(t, b.playerId);
      // a player may withdraw themselves (by FAF id) while signups are open; organizers can remove anyone
      const sess = currentSession(req);
      const selfWithdraw = p0 && sess && p0.fafId && p0.fafId === sess.fafId && t.status === 'signup';
      if (!selfWithdraw && !canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = p0;
      if (!p) return json(res, 200, { ok: true });
      tlog(t, req, b.admin, selfWithdraw ? p.name + ' withdrew' : 'removed player ' + p.name);
      if (t.status === 'signup') {
        if (t.formation === 'premade' && t.teamSize > 1 && p.teamName) {
          const key = p.teamName.toLowerCase();
          t.players = t.players.filter(x => (x.teamName || '').toLowerCase() !== key);
        } else {
          t.players = t.players.filter(x => x.id !== b.playerId);
        }
        // Open-teams cleanup: a withdrawing player must be pulled out of any team they were on,
        // or the team keeps a ghost slot (shows 2/2 with one real member and nobody can join).
        if (Array.isArray(t.teams)) {
          for (const tm of t.teams) {
            const was = tm.playerIds.length;
            tm.playerIds = tm.playerIds.filter(pid => pid !== p.id);
            if (tm.invites) tm.invites = tm.invites.filter(iv => iv.playerId !== p.id);
            if (tm.joinRequests) tm.joinRequests = tm.joinRequests.filter(r => r.playerId !== p.id);
            if (tm.playerIds.length !== was) {
              if (!tm.playerIds.length) {
                // team is now empty — remove it entirely
                tm._remove = true;
              } else if (tm.captainId === p.id) {
                // captain left — hand the armband to the next remaining member
                tm.captainId = tm.playerIds[0];
              }
            }
          }
          t.teams = t.teams.filter(tm => !tm._remove);
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
      clearJoinRequests(p.id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit player (admin, any time) — this is also the substitution mechanism:
    // rename the dropped player to the sub's FAF name and fix the rating
    // ===== open-team management (formation === 'open') =====
    // helper checks live here so they can reference the request session
    if (['create_team', 'join_team', 'leave_team', 'disband_team', 'move_player', 'set_captain', 'checkin_team', 'org_create_team', 'request_join', 'respond_join', 'cancel_join', 'invite_to_team', 'cancel_invite', 'respond_invite'].indexOf(sub) >= 0) {
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
      // A raw playerId is only trusted pre-go-live (no FAF login) or from an organizer.
      // Without this check anyone could act as any player just by sending their id.
      if (reqBody && reqBody.playerId && (!FAF_OAUTH_ON || canOrganize(t, req, reqBody))) return playerById(t, reqBody.playerId);
      return null;
    }

    // drop a player's pending join requests everywhere (they got a team, withdrew, or were removed)
    function clearJoinRequests(playerId) {
      (t.teams || []).forEach(tm => { if (tm.joinRequests) tm.joinRequests = tm.joinRequests.filter(r => r.playerId !== playerId); if (tm.invites) tm.invites = tm.invites.filter(iv => iv.playerId !== playerId); });
    }

    if (sub === 'create_team') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first, then create a team' });
      if (me.teamId) return bad(res, 'Leave your current team first');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Team name required');
      if (t.teams.some(x => (x.name || '').toLowerCase() === name.toLowerCase())) return bad(res, 'That team name is taken');
      // No hard cap here: teams beyond maxTeams are allowed and become the waiting list.
      // maxTeams caps PARTICIPANTS, resolved at launch (see finalizeOpenTeams).
      const team = { id: 't' + uid(4), name, seed: 0, captainId: me.id, playerIds: [me.id], captainToken: uid(10), eliminated: false, out: null, createdAt: now(), checkedIn: false };
      t.teams.push(team);
      me.teamId = team.id;
      clearJoinRequests(me.id);
      tlog(t, req, b.admin, me.name + ' created team "' + name + '"');
      saveDB();
      return json(res, 200, { ok: true, teamId: team.id });
    }

    if (sub === 'checkin_team') {
      // Any member of a full team can check it in (the captain may be running late).
      // Organizers can check in / un-check any team by id.
      const organizer = canOrganize(t, req, b);
      let team;
      if (organizer && b.teamId) team = teamById(t, b.teamId);
      else {
        const me = actingPlayer(b);
        if (!me || !me.teamId) return json(res, 401, { error: 'Join a team first' });
        team = teamById(t, me.teamId);
      }
      if (!team) return bad(res, 'Team not found');
      if (team.playerIds.length < t.teamSize) return bad(res, 'Only a full team can check in');
      // Check-in is for the day of the event. Trying earlier is the common confusion, so say
      // exactly when it opens rather than just refusing. Organizers can always check a team in.
      if (!canOrganize(t, req, b)) {
        const gate = checkInOpensAt(t);
        if (gate && Date.now() < gate) {
          return bad(res, 'Check-in opens on the day of the tournament (' + new Date(gate).toISOString().slice(0, 10) + ' UTC). Come back then \u2014 your signup is safe until it opens.');
        }
      }
      team.checkedIn = (b.value === undefined) ? true : !!b.value;
      team.checkedInAt = team.checkedIn ? now() : null;
      tlog(t, req, b.admin, (team.checkedIn ? 'checked in' : 'un-checked') + ' team "' + team.name + '"');
      saveDB();
      return json(res, 200, { ok: true, checkedIn: team.checkedIn });
    }

    if (sub === 'org_create_team') {
      // Organizer manually forms a team around an unteamed player (they become captain).
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      if (p.teamId) return bad(res, 'That player is already on a team');
      const name = cleanName(b.name, 30) || (p.name + "'s team");
      if (t.teams.some(x => (x.name || '').toLowerCase() === name.toLowerCase())) return bad(res, 'That team name is taken');
      const team = { id: 't' + uid(4), name, seed: 0, captainId: p.id, playerIds: [p.id], captainToken: uid(10), eliminated: false, out: null, createdAt: now(), checkedIn: false };
      t.teams.push(team);
      p.teamId = team.id;
      clearJoinRequests(p.id);
      saveDB();
      return json(res, 200, { ok: true, teamId: team.id });
    }

    if (sub === 'join_team') {
      // Instant self-join is gone: players request, the captain approves.
      return bad(res, 'Send a join request — the team captain approves it.');
    }

    // Would adding this player push the team past the max combined rating? Returns the
    // offending numbers or null. Only meaningful when maxTeamRating is set.
    const teamCapViolation = (team, joiner) => {
      if (t.maxTeamRating == null || !joiner || joiner.rating == null) return null;
      const cur = team.playerIds.reduce((sum, pid) => {
        const m = playerById(t, pid);
        return sum + ((m && m.rating) || 0);
      }, 0);
      if (cur + joiner.rating > t.maxTeamRating) return { cur, would: cur + joiner.rating, cap: t.maxTeamRating };
      return null;
    };

    if (sub === 'request_join') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first' });
      if (me.teamId) return bad(res, 'Leave your current team first');
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      if (team.playerIds.length >= t.teamSize) return bad(res, 'That team is full');
      const cap = teamCapViolation(team, me);
      if (cap) return bad(res, 'You can\u2019t join this team: its combined rating would become ' + cap.would + ', over the maximum of ' + cap.cap + ' (currently ' + cap.cur + ').');
      team.joinRequests = team.joinRequests || [];
      if (team.joinRequests.some(r => r.playerId === me.id)) return json(res, 200, { ok: true, already: 1 });
      team.joinRequests.push({ playerId: me.id, name: me.name, at: now() });
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'cancel_join') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first' });
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      team.joinRequests = (team.joinRequests || []).filter(r => r.playerId !== me.id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'respond_join') {
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      const me = actingPlayer(b);
      const isCap = !!(me && team.captainId === me.id);
      if (!isCap && !canOrganize(t, req, b)) return json(res, 403, { error: 'Only the team captain or an organizer can respond to join requests' });
      team.joinRequests = team.joinRequests || [];
      const idx = team.joinRequests.findIndex(r => r.playerId === b.playerId);
      if (idx < 0) return bad(res, 'That request is no longer pending');
      const jr = team.joinRequests.splice(idx, 1)[0];
      if (b.accept) {
        const p = playerById(t, jr.playerId);
        if (!p) return bad(res, 'That player is no longer signed up');
        if (p.teamId) return bad(res, 'That player already joined another team');
        if (team.playerIds.length >= t.teamSize) return bad(res, 'Your team is already full');
        // captains are bound by the team rating cap; organizers may override it
        if (!canOrganize(t, req, b)) {
          const cap = teamCapViolation(team, p);
          if (cap) return bad(res, 'Accepting would put the team\u2019s combined rating at ' + cap.would + ', over the maximum of ' + cap.cap + '.');
        }
        team.playerIds.push(p.id);
        p.teamId = team.id;
        // once they're on a team, drop their pending requests everywhere
        t.teams.forEach(tm => { if (tm.joinRequests) tm.joinRequests = tm.joinRequests.filter(r => r.playerId !== p.id); });
        tlog(t, req, b.admin, p.name + ' joined team "' + team.name + '" (accepted)');
      } else {
        const pd = playerById(t, jr.playerId);
        tlog(t, req, b.admin, 'declined join request of ' + (pd ? pd.name : '?') + ' for team "' + team.name + '"');
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // ---- captain-initiated invites (mirror of join requests, other direction) ----
    if (sub === 'invite_to_team') {
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      const me = actingPlayer(b);
      const isCap = !!(me && team.captainId === me.id);
      if (!isCap && !canOrganize(t, req, b)) return json(res, 403, { error: 'Only the team captain or an organizer can invite players' });
      const target = playerById(t, b.playerId);
      if (!target) return bad(res, 'Player not found');
      if (target.teamId) return bad(res, 'That player is already on a team');
      if (team.playerIds.length >= t.teamSize) return bad(res, 'Your team is already full');
      team.invites = team.invites || [];
      if (team.invites.some(iv => iv.playerId === target.id)) return json(res, 200, { ok: true, already: 1 });
      team.invites.push({ playerId: target.id, name: target.name, at: now() });
      tlog(t, req, b.admin, 'invited ' + target.name + ' to team "' + team.name + '"');
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'cancel_invite') {
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      const me = actingPlayer(b);
      const isCap = !!(me && team.captainId === me.id);
      if (!isCap && !canOrganize(t, req, b)) return json(res, 403, { error: 'Only the captain or an organizer can cancel an invite' });
      team.invites = (team.invites || []).filter(iv => iv.playerId !== b.playerId);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'respond_invite') {
      // the invited player accepts or declines
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first' });
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      team.invites = team.invites || [];
      const idx = team.invites.findIndex(iv => iv.playerId === me.id);
      if (idx < 0) return bad(res, 'That invite is no longer available');
      team.invites.splice(idx, 1);
      if (b.accept) {
        if (me.teamId) return bad(res, 'Leave your current team first');
        if (team.playerIds.length >= t.teamSize) return bad(res, 'That team is now full');
        const cap = teamCapViolation(team, me);
        if (cap) return bad(res, 'You can\u2019t join: the team\u2019s combined rating would become ' + cap.would + ', over the maximum of ' + cap.cap + '.');
        team.playerIds.push(me.id);
        me.teamId = team.id;
        // clear this player's other pending requests and invites
        t.teams.forEach(tm => {
          if (tm.joinRequests) tm.joinRequests = tm.joinRequests.filter(r => r.playerId !== me.id);
          if (tm.invites) tm.invites = tm.invites.filter(iv => iv.playerId !== me.id);
        });
        tlog(t, req, b.admin, me.name + ' joined team "' + team.name + '" (invite accepted)');
      } else {
        tlog(t, req, b.admin, me.name + ' declined the invite to team "' + team.name + '"');
      }
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
      tlog(t, req, b.admin, (organizer && b.targetPlayerId ? 'removed ' + target.name + ' from' : target.name + ' left') + ' team "' + team.name + '"');
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
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      const name = cleanName(b.name, 30);
      if (!name) return bad(res, 'Team name required');
      if (t.teams.some(x => x.id !== team.id && (x.name || '').toLowerCase() === name.toLowerCase())) return bad(res, 'That team name is taken');

      const organizer = canOrganize(t, req, b);   // site admin or organizer
      const me = actingPlayer(b);
      const isCap = !!(me && team.captainId === me.id);

      if (organizer) {
        // organizers and site admins can always rename any team, as often as needed.
        team.name = name;
        audit(req, 'team_renamed', { tournamentId: t.id, tournamentName: t.name, token: b.token || b.admin, detail: 'organizer renamed team ' + team.id + ' \u2192 ' + name });
      } else if (isCap) {
        // captains get a single rename, and only in team games (more than one player per team).
        if (!(t.teamSize > 1)) return json(res, 403, { error: 'Only an organizer can rename in this tournament' });
        if (team.captainRenamed) return bad(res, 'You have already used your one team rename \u2014 ask an organizer for any further change');
        team.name = name;
        team.captainRenamed = true;
        audit(req, 'team_renamed', { tournamentId: t.id, tournamentName: t.name, detail: 'captain renamed team ' + team.id + ' \u2192 ' + name });
      } else {
        return json(res, 403, { error: 'Only the team captain or an organizer can rename this team' });
      }
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
        clearJoinRequests(p.id);
        tlog(t, req, b.admin, 'moved ' + p.name + ' to team "' + dest.name + '"');
      } else {
        tlog(t, req, b.admin, 'moved ' + p.name + ' out of their team (to the pool)');
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

    // Toggle whether an organizer is shown to players (Chat tab list etc). Default: shown.
    if (sub === 'organizer_visibility') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const fid = String(b.fafId || '').trim();
      if (!Array.isArray(t.organizerFafIds) || t.organizerFafIds.indexOf(fid) < 0) return bad(res, 'Not an organizer of this tournament');
      t.organizerHidden = t.organizerHidden || {};
      if (b.hidden) t.organizerHidden[fid] = 1; else delete t.organizerHidden[fid];
      tlog(t, req, b.admin, (b.hidden ? 'hid' : 'made visible') + ' organizer ' + ((t.organizerNames || {})[fid] || fid) + ' ' + (b.hidden ? 'from' : 'to') + ' players');
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Official vs community is picked once at creation by the organizer; only the
    // site admin can change it afterwards.
    if (sub === 'set_category') {
      if (!isSiteAdmin(req)) return json(res, 403, { error: 'Site admin only' });
      const cat = (b.category === 'official' || b.category === 'community') ? b.category : null;
      if (!cat) return bad(res, 'Category must be official or community');
      const before = t.category || 'community';
      t.category = cat;
      saveDB();
      audit(req, 'category_changed', {
        tournamentId: t.id, tournamentName: t.name,
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: before + ' \u2192 ' + cat
      });
      return json(res, 200, { ok: true, category: t.category });
    }

    // Site admin attaches organizer rights to a FAF account directly (useful for
    // tournaments that predate identity tracking, where the list is empty).
    if (sub === 'add_organizer') {
      // Any organizer (or site admin) may add a co-organizer to their own tournament. Removal
      // stays site-admin-only (handled by remove_organizer).
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      if (!Array.isArray(t.organizerFafIds)) t.organizerFafIds = [];
      if (t.organizerFafIds.indexOf(fid) >= 0) return bad(res, 'Already an organizer');
      t.organizerFafIds.push(fid);
      t.organizerNames = t.organizerNames || {};
      t.organizerNames[fid] = cleanName(b.name, 60) || ('FAF ' + fid);
      saveDB();
      audit(req, 'organizer_added', {
        tournamentId: t.id, tournamentName: t.name,
        actor: actorOf(req, b.admin),
        detail: t.organizerNames[fid] + ' (' + fid + ') \u2014 added by an organizer'
      });
      return json(res, 200, { ok: true });
    }

    // Site admin strips organizer rights from a FAF account on this tournament.
    if (sub === 'remove_organizer') {
      if (!isSiteAdmin(req)) return json(res, 403, { error: 'Site admin only' });
      const fid = String(b.fafId || '').trim();
      if (!Array.isArray(t.organizerFafIds) || t.organizerFafIds.indexOf(fid) < 0) return bad(res, 'Not an organizer of this tournament');
      t.organizerFafIds = t.organizerFafIds.filter(x => x !== fid);
      const name = (t.organizerNames && t.organizerNames[fid]) || fid;
      if (t.organizerNames) delete t.organizerNames[fid];
      saveDB();
      audit(req, 'organizer_removed', {
        tournamentId: t.id, tournamentName: t.name,
        actor: { kind: 'siteadmin', fafId: null, name: 'Site admin' },
        detail: name + ' (' + fid + ')' + (t.organizerFafIds.length ? '' : ' \u2014 tournament now has no organizers')
      });
      return json(res, 200, { ok: true, remaining: t.organizerFafIds.length });
    }

    // Claim organizer rights by opening the organizer link while logged in with FAF.
    if (sub === 'claim_organizer') {
      const sess = currentSession(req);
      if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
      // the link carries the admin token; that's what authorizes the claim
      if (!isAdmin(t, b.adminToken, req) && !(t.adminToken && b.adminToken === t.adminToken)) {
        return json(res, 403, { error: 'Invalid organizer link' });
      }
      if (!Array.isArray(t.organizerFafIds)) t.organizerFafIds = [];
    if (!Array.isArray(t.pendingCaptains)) t.pendingCaptains = [];
    if (t.divisions === undefined) t.divisions = 0;
    for (const tm of (t.teams || [])) { if (tm.division === undefined) tm.division = 0; }
      if (t.organizerFafIds.indexOf(sess.fafId) < 0) t.organizerFafIds.push(sess.fafId);
      t.organizerNames = t.organizerNames || {};
      t.organizerNames[sess.fafId] = sess.fafName || t.organizerNames[sess.fafId] || '';
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
      outP.ratingActual = (inP.ratingActual != null ? inP.ratingActual : inP.rating);
      applyRatingCap(t, outP);
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
      tlog(t, req, b.admin, 'replaced a player with ' + outP.name + (keptTeamId ? ' in team "' + tTeamName(t, keptTeamId) + '"' : ''));
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'faf_lookup') {
      // Organizer looks up a FAF player by exact name; returns id + rating per this tournament's
      // settings (plus current global for context). Uses the organizer's own FAF token.
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const login = cleanName(b.name, 40);
      if (!login) return bad(res, 'Enter a FAF name');
      const token = await fafValidToken(currentSession(req));
      if (!token) return json(res, 409, { error: 'FAF lookups need your FAF login. Log out and back in, then retry.', needsRelogin: 1 });
      const found = await fafLookupPlayer(login, token);
      if (found && found.error) return bad(res, found.error);
      if (!found) return bad(res, 'No FAF player named \u201c' + login + '\u201d \u2014 names are exact');
      const rating = await ratingPerSettings(t, found.fafId, token);
      let globalRating = null;
      try { globalRating = (t.ratingType === 'global') ? rating : (await fafRatingProbe(found.fafId, 'global', null, token)).rating; } catch (e) {}
      return json(res, 200, { ok: true, fafId: found.fafId, name: found.name, rating, globalRating });
    }

    if (sub === 'org_add_player') {
      // Organizer adds a VERIFIED player (existence + rating checked against FAF) — no free-typed names.
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (t.status !== 'signup') return bad(res, 'Signups are closed \u2014 use the late-signup link instead');
      const login = cleanName(b.name, 40);
      if (!login) return bad(res, 'Enter a FAF name');
      const token = await fafValidToken(currentSession(req));
      if (!token) return json(res, 409, { error: 'Adding players needs your FAF login. Log out and back in, then retry.', needsRelogin: 1 });
      const found = await fafLookupPlayer(login, token);
      if (found && found.error) return bad(res, found.error);
      if (!found) return bad(res, 'No FAF player named \u201c' + login + '\u201d \u2014 names are exact');
      if (t.players.some(x => x.fafId === found.fafId)) return bad(res, found.name + ' is already signed up');
      let rating;
      if (t.ratingType && t.ratingType !== 'none') {
        rating = await ratingPerSettings(t, found.fafId, token);
        if (rating == null) return bad(res, 'Could not fetch a ' + t.ratingType + ' rating for ' + found.name + ' \u2014 they may have no ranked games for it');
      } else {
        rating = parseInt(b.rating, 10);
        if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter a rating (0\u20134000) for this player');
      }
      const p = { id: 'p' + uid(4), name: found.name, rating, fafId: found.fafId, manual: false,
        late: 0, teamName: cleanName(b.teamName, 30) || null, teamId: null, signedAt: now(), addedBy: 'organizer' };
      t.players.push(p);
      saveDB();
      return json(res, 200, { ok: true, playerId: p.id });
    }

    if (sub === 'invite_player') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const login = cleanName(b.name, 40);
      if (!login) return bad(res, 'Enter a FAF name');
      const token = await fafValidToken(currentSession(req));
      if (!token) return json(res, 409, { error: 'Invites need your FAF login. Log out and back in, then retry.', needsRelogin: 1 });
      const found = await fafLookupPlayer(login, token);
      if (found && found.error) return bad(res, found.error);
      if (!found) return bad(res, 'No FAF player named \u201c' + login + '\u201d \u2014 names are exact');
      t.invites = t.invites || [];
      if (t.invites.some(i => i.fafId === found.fafId)) return bad(res, found.name + ' is already invited');
      if (isOfficial(t) && activeBan(found.fafId)) return bad(res, found.name + ' is banned from official tournaments and can\u2019t be invited.');
      t.invites.push({ fafId: found.fafId, name: found.name, at: now() });
      tlog(t, req, b.admin, 'invited ' + found.name);
      saveDB();
      return json(res, 200, { ok: true, fafId: found.fafId, name: found.name });
    }

    // An invited player declines. The organizer keeps seeing it (as "declined") until
    // the tournament starts, at which point non-accepted invites are cleared.
    if (sub === 'decline_invite') {
      const sess = currentSession(req);
      if (!sess) return json(res, 401, { error: 'Log in with FAF first' });
      const inv = (t.invites || []).find(i => i.fafId === sess.fafId);
      if (!inv) return bad(res, 'You have no invite for this tournament');
      if ((t.players || []).some(pl => pl.fafId === sess.fafId)) return bad(res, 'You already signed up \u2014 withdraw instead');
      inv.declined = 1;
      inv.declinedAt = now();
      tlog(t, req, null, (sess.fafName || 'A player') + ' declined their invite');
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'uninvite_player') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const unv = (t.invites || []).find(i => i.fafId === String(b.fafId));
      t.invites = (t.invites || []).filter(i => i.fafId !== String(b.fafId));
      if (unv) tlog(t, req, b.admin, 'withdrew the invite for ' + unv.name);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'respond_signup') {
      // Organizer approves or declines a pending (request-mode) signup.
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = playerById(t, b.playerId);
      if (!p || !p.pending) return bad(res, 'That request is no longer pending');
      if (b.accept) { delete p.pending; }
      else { t.players = t.players.filter(x => x.id !== p.id); clearJoinRequests(p.id); }
      tlog(t, req, b.admin, (b.accept ? 'approved' : 'declined') + ' signup request of ' + p.name);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'edit_player') {
      // Renaming is gone: identity comes from FAF. Organizers can attach a visible note
      // (shown in brackets after the name) and can only edit the rating when the
      // tournament doesn't fetch ratings from FAF (ratingType 'none').
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const p = playerById(t, b.playerId);
      if (!p) return bad(res, 'Player not found');
      if (b.name !== undefined && cleanName(b.name, 30) !== p.name) {
        return bad(res, 'Players cannot be renamed \u2014 names come from FAF. Add a note instead.');
      }
      if (b.note !== undefined) p.note = cleanName(b.note, 40) || null;
      if (b.teamName !== undefined && t.formation === 'premade' && t.teamSize > 1 && t.status === 'signup') {
        p.teamName = cleanName(b.teamName, 30) || '';
      }
      tlog(t, req, b.admin, 'edited player ' + p.name);
      if (b.rating !== undefined && String(b.rating) !== String(p.rating)) {
        if (t.ratingType && t.ratingType !== 'none') return bad(res, 'Ratings are fetched from FAF for this tournament and cannot be edited');
        const rating = parseInt(b.rating, 10);
        if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Rating must be 0\u20134000');
        p.ratingActual = rating;
        applyRatingCap(t, p);
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // edit format/settings (admin, before the bracket starts)
    if (sub === 'edit_format') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (['signup', 'draft', 'drafted'].indexOf(t.status) < 0) return bad(res, 'The format is locked once the bracket has started');
      tlog(t, req, b.admin, 'changed the tournament format');
      const bo = (v, d) => BO_OK.indexOf(parseInt(v, 10)) >= 0 ? parseInt(v, 10) : d;

      // structural changes only while signups are open
      const structural = ['competition', 'teamSize', 'formation', 'draftOrder', 'seeding'].some(k => b[k] !== undefined);
      if (structural && t.status !== 'signup') return bad(res, 'Reopen signups to change the team setup');

      const competition = b.competition !== undefined ? (b.competition === 'ffa' ? 'ffa' : 'team') : t.competition;
      let teamSize = t.teamSize, formation = t.formation;
      if (competition === 'team') {
        teamSize = b.teamSize !== undefined ? intIn(b.teamSize, 1, 6, t.teamSize) : (t.competition === 'team' ? t.teamSize : 1);
        const wantForm = b.formation !== undefined ? b.formation : t.formation;
        formation = (teamSize === 1) ? 'solo' : (wantForm === 'draft' ? 'draft' : 'open');
      } else {
        teamSize = b.teamSize !== undefined ? intIn(b.teamSize, 1, 3, Math.min(t.teamSize, 3)) : Math.min(t.teamSize, 3);
        formation = (teamSize === 1) ? 'solo' : 'premade';
      }
      // Switching the team formation (premade <-> draft/captain-pick) is safe as long as no
      // teams have actually formed yet: no teams built, no captains chosen, no draft under way,
      // and nobody assigned to a team. In that state the signups are just loose individuals,
      // which is what BOTH formats look like before teams exist, so we keep the players. Only
      // block it once real team structure exists (then removing signups really is required).
      const formationChanging = (t.formation !== formation) || (t.teamSize !== teamSize) || (t.competition !== competition);
      const teamStructureExists =
        (t.teams || []).length > 0 ||
        (t.pendingCaptains || []).length > 0 ||
        !!t.draft ||
        (t.players || []).some(p => p.teamId);
      if (formation === 'premade' && teamSize > 1 && formationChanging && teamStructureExists && t.players.length > 0) {
        return bad(res, 'Teams have already started forming \u2014 remove the current signups first, or clear the teams, before switching to premade.');
      }
      // when we do switch formats with players kept, drop any empty leftover team scaffolding
      if (formationChanging && !teamStructureExists) {
        t.teams = [];
        t.pendingCaptains = [];
        t.draft = null;
        (t.players || []).forEach(p => { delete p.teamName; });
      }

      t.competition = competition;
      t.teamSize = teamSize;
      t.formation = formation;
      if (b.draftOrder !== undefined) t.draftOrder = b.draftOrder === 'snake' ? 'snake' : 'linear';
      if (b.seeding !== undefined) t.seeding = ['rating', 'random', 'manual'].indexOf(b.seeding) >= 0 ? b.seeding : t.seeding;
      if (b.maxTeams !== undefined) t.maxTeams = intIn(b.maxTeams, 0, 128, t.maxTeams);

      if (competition === 'team') {
        if (b.bracketType !== undefined && ['single', 'double', 'swiss'].indexOf(b.bracketType) >= 0) t.bracketType = b.bracketType;
        // per-round Bo is only meaningful for elimination brackets, never swiss/ffa
        if (b.perRoundBo !== undefined) t.perRoundBo = (b.perRoundBo && t.bracketType !== 'swiss') ? 1 : 0;
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

    if (sub === 'add_desc_image') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      t.descImages = t.descImages || [];
      if (t.descImages.length >= MAX_DESC_IMAGES) return bad(res, 'This tournament already has the maximum of ' + MAX_DESC_IMAGES + ' images');
      let fname;
      try { fname = saveDescImage(b.image); } catch (e) { return bad(res, e.message); }
      t.descImages.push(fname);
      saveDB();
      return json(res, 200, { ok: true, file: fname, url: '/desc-images/' + encodeURIComponent(fname), count: t.descImages.length });
    }

    if (sub === 'remove_desc_image') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const fname = path.basename(String(b.file || ''));
      t.descImages = (t.descImages || []).filter(f => f !== fname);
      deleteDescImage(fname);
      saveDB();
      return json(res, 200, { ok: true, count: t.descImages.length });
    }

    // edit tournament info (admin, any time)
    // ---- tournament news / updates: short posts by the organizer, newest first ----
    // Important posts (schedule moved, cancelled) are highlighted; routine ones are not.
    if (sub === 'news_post') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const body = cleanName(b.body, 1000);
      if (!body) return bad(res, 'Write something first');
      t.news = t.news || [];
      const item = { id: 'nw' + uid(6), at: Date.now(), by: actorOf(req, b.admin).name || 'Organizer', body, important: b.important ? 1 : 0 };
      t.news.push(item);
      saveDB();
      audit(req, 'news_posted', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: (item.important ? '[important] ' : '') + body.slice(0, 80) });
      return json(res, 200, { ok: true, id: item.id });
    }

    if (sub === 'news_edit') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const item = (t.news || []).find(n => n.id === b.id);
      if (!item) return bad(res, 'Post not found');
      const body = cleanName(b.body, 1000);
      if (!body) return bad(res, 'Write something first');
      item.body = body;
      if (b.important !== undefined) item.important = b.important ? 1 : 0;
      item.editedAt = Date.now();
      tlog(t, req, b.admin, 'edited a news update: ' + body.slice(0, 60));
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'news_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const item = (t.news || []).find(n => n.id === b.id);
      t.news = (t.news || []).filter(n => n.id !== b.id);
      saveDB();
      audit(req, 'news_deleted', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: item ? item.body.slice(0, 80) : b.id });
      return json(res, 200, { ok: true });
    }

    // Mark this tournament's news as read for the logged-in account, so the unread
    // badge clears on every device. Anonymous readers are handled via localStorage.
    if (sub === 'news_read') {
      const sess = currentSession(req);
      if (!sess) return json(res, 200, { ok: 0 });
      const latest = Math.max(0, ...(t.news || []).map(n => n.at || 0));
      db.profiles[sess.fafId] = db.profiles[sess.fafId] || {};
      db.profiles[sess.fafId].newsRead = db.profiles[sess.fafId].newsRead || {};
      db.profiles[sess.fafId].newsRead[t.id] = latest;
      saveDB();
      return json(res, 200, { ok: 1, readAt: latest });
    }

    if (sub === 'chat_post') {
      // reading an old tournament's chat is fine; posting into it is not
      if (chatLocked(t)) return bad(res, 'This tournament\u2019s chat is closed \u2014 it locks two days after the event ends.');
      const room = String(b.room || '');
      if (!chatAccess(t, req, room, b.token)) return json(res, 403, { error: 'No access to this chat' });
      const sess = currentSession(req);
      const organizer = isAdmin(t, b.token, req) || isOrganizer(t, req);
      const streamer = !organizer && isStreamer(t, b.token);
      // Everyone posting must be identifiable so muting and attribution work.
      if (!sess && !organizer && !streamer) return json(res, 401, { error: 'Log in to chat' });
      if (sess && chatMuted(t, sess.fafId)) return json(res, 403, { error: 'You are muted in this tournament\u2019s chat' });
      let text = String(b.text || '').trim().slice(0, CHAT_MSG_LEN);
      if (!text) return bad(res, 'Empty message');
      const who = (sess ? (sess.fafName || ('FAF ' + sess.fafId)) : (organizer ? 'Organizer' : 'Streamer')) + (streamer ? ' [caster]' : '');
      t.chat = t.chat || {};
      t.chat[room] = t.chat[room] || [];
      // !organizer — flag this room so organizers see it needs attention, without them
      // having to skim every chat. Cleared when an organizer opens the room.
      if (/^!organizer\b/i.test(text)) {
        const extra = text.replace(/^!organizer\b/i, '').trim();
        t.chatPings = t.chatPings || {};
        t.chatPings[room] = { at: now(), by: who };
        t.chat[room].push({ id: uid(8), at: now(), fafId: sess ? sess.fafId : null, who, sys: 1, ping: 1, text: who + ' pinged the organizers' + (extra ? ': ' + extra : '') + ' \u2014 they\u2019ve been notified.' });
        if (t.chat[room].length > CHAT_MAX) t.chat[room] = t.chat[room].slice(-CHAT_MAX);
        tlog(t, req, b.admin || b.token, who + ' pinged the organizers in ' + (room === 'global' ? 'the global chat' : 'a match chat') + (extra ? ': ' + extra : ''));
        saveDB();
        return json(res, 200, { ok: true, pinged: 1 });
      }
      // !roll — server rolls so nobody can fake it
      const rollMatch = /^!roll\b\s*(\d+)?(?:\s*-\s*(\d+))?/.exec(text);
      if (rollMatch) {
        let lo = 1, hi = 100;
        if (rollMatch[1] && rollMatch[2]) { lo = parseInt(rollMatch[1], 10); hi = parseInt(rollMatch[2], 10); }
        else if (rollMatch[1]) { hi = parseInt(rollMatch[1], 10); }
        if (!(hi > lo)) { lo = 1; hi = 100; }
        lo = Math.max(0, Math.min(lo, 1000000)); hi = Math.max(lo + 1, Math.min(hi, 1000000));
        const roll = lo + Math.floor(Math.random() * (hi - lo + 1));
        t.chat[room].push({ id: uid(8), at: now(), fafId: sess ? sess.fafId : null, who, sys: 1, text: who + ' rolled ' + roll + ' (' + lo + '\u2013' + hi + ')' });
      } else {
        t.chat[room].push({ id: uid(8), at: now(), fafId: sess ? sess.fafId : null, who, text });
        // @mention pings: resolve @name tokens to signed-up FAF players/captains and flag a
        // per-user, per-room ping. The mentioned person sees a red badge until they open the room.
        const mentions = (text.match(/(?:^|\s)@([^\s@]{1,40})/g) || []).map(s => s.replace(/^\s*@/, '').toLowerCase());
        if (mentions.length) {
          const byName = {};
          for (const p of (t.players || [])) {
            if (!p.fafId) continue;                       // only logged-in FAF players can be pinged
            if (p.name) byName[p.name.toLowerCase()] = p.fafId;
          }
          const pingedIds = new Set();
          for (const mraw of mentions) {
            // match a name that starts with the typed token (so "@nug" hits "nuggets3858")
            let hit = byName[mraw];
            if (!hit) { for (const nm of Object.keys(byName)) { if (nm.startsWith(mraw)) { hit = byName[nm]; break; } } }
            if (hit && !(sess && hit === sess.fafId)) pingedIds.add(hit);  // don't ping yourself
          }
          if (pingedIds.size) {
            t.userPings = t.userPings || {};
            for (const fid of pingedIds) {
              t.userPings[fid] = t.userPings[fid] || {};
              t.userPings[fid][room] = now();
            }
          }
        }
      }
      if (t.chat[room].length > CHAT_MAX) t.chat[room] = t.chat[room].slice(-CHAT_MAX);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Organizer moderation: mute/unmute a FAF account, or delete a message.
    if (sub === 'chat_mute') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const fid = String(b.fafId || '').trim();
      if (!fid) return bad(res, 'FAF id required');
      t.chatMutes = t.chatMutes || {};
      if (b.unmute) { delete t.chatMutes[fid]; }
      else { t.chatMutes[fid] = { at: now(), name: b.name || fid }; }
      tlog(t, req, b.admin, (b.unmute ? 'unmuted' : 'muted') + ' ' + (b.name || fid) + ' in chat');
      saveDB();
      return json(res, 200, { ok: true, muted: b.unmute ? 0 : 1 });
    }

    if (sub === 'chat_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const room = String(b.room || '');
      if (t.chat && t.chat[room]) t.chat[room] = t.chat[room].filter(mm => mm.id !== b.id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'edit_info') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const touched = ['description', 'rewards', 'prizeCurrency', 'prizeAmount', 'sponsors', 'streams', 'minRating', 'maxRating', 'maxTeamRating', 'ratingCap', 'lobbyOptions', 'mods', 'signupMode', 'playerReporting', 'checkInDeadline', 'veto'].filter(k => b[k] !== undefined);
      if (touched.length) tlog(t, req, b.admin, 'updated settings: ' + touched.join(', '));
      if (b.description !== undefined) t.description = cleanName(b.description, 20000);
      if (b.rewards !== undefined) t.rewards = cleanName(b.rewards, 2000);
      if (b.prizeCurrency !== undefined || b.prizeAmount !== undefined) {
        t.prize = cleanPrize(
          b.prizeCurrency !== undefined ? b.prizeCurrency : (t.prize && t.prize.currency),
          b.prizeAmount !== undefined ? b.prizeAmount : (t.prize && t.prize.amount)
        );
      }
      if (b.sponsors !== undefined) t.sponsors = cleanName(b.sponsors, 2000);
      if (Array.isArray(b.streams)) {
        t.streams = b.streams.map(x => ({
          url: String((x && x.url) || '').trim().slice(0, 300),
          info: cleanName((x && x.info) || '', 120) || ''
        })).filter(x => /^https?:\/\/[^\s"'<>]+$/.test(x.url)).slice(0, 10);
        if (!t.streams.length) delete t.streams;
      }
      if (b.minRating !== undefined) t.minRating = (parseInt(b.minRating, 10) >= 0 && b.minRating !== '') ? parseInt(b.minRating, 10) : null;
      if (b.maxRating !== undefined) t.maxRating = (parseInt(b.maxRating, 10) > 0) ? parseInt(b.maxRating, 10) : null;
      if (b.maxTeamRating !== undefined) t.maxTeamRating = (parseInt(b.maxTeamRating, 10) > 0) ? parseInt(b.maxTeamRating, 10) : null;
      if (b.ratingCap !== undefined) { t.ratingCap = (parseInt(b.ratingCap, 10) > 0) ? parseInt(b.ratingCap, 10) : null; recomputeAllRatings(t); }
      if (b.ratingDate !== undefined) t.ratingDate = b.ratingDate ? (new Date(b.ratingDate).getTime() || null) : null;
      if (b.lobbyOptions !== undefined) t.lobbyOptions = cleanName(b.lobbyOptions, 20000);
      if (b.mods !== undefined) t.mods = cleanName(b.mods, 500);
      if (b.signupMode !== undefined && ['open', 'invite', 'request'].indexOf(b.signupMode) >= 0) t.signupMode = b.signupMode;
      if (b.playerReporting !== undefined) t.playerReporting = !!b.playerReporting;
      if (b.name !== undefined) { const nm = cleanName(b.name, 60); if (nm) t.name = nm; }
      if (b.eventDate !== undefined) t.eventDate = cleanDate(b.eventDate);
      if (b.signupOpensAt !== undefined) t.signupOpensAt = cleanDate(b.signupOpensAt);
      if (b.signupClosesAt !== undefined) t.signupClosesAt = cleanDate(b.signupClosesAt);
      if (b.minTeams !== undefined) t.minTeams = intIn(b.minTeams, 0, 128, 0);
      if (b.maxTeams !== undefined) t.maxTeams = intIn(b.maxTeams, 0, 128, 0);
      if (b.checkInDeadline !== undefined) {
        if (!b.checkInDeadline) t.checkInDeadline = null;
        else { const ms = new Date(b.checkInDeadline).getTime(); t.checkInDeadline = isNaN(ms) ? null : ms; }
      }
      if (b.veto !== undefined) {
        if (t.status === 'finished') return bad(res, 'The tournament is finished');
        t.veto = cleanVeto(b.veto);
        if (t.veto.enabled) {
          // enabling (including mid-bracket): give every ready match without a veto one now,
          // so turning this on later is never a dead end.
          for (const m of t.matches) {
            if (m.status === 'ready' && !m.veto) initVeto(t, m);
          }
        } else {
          // disabling: drop vetoes that haven't been acted on; leave finished ones as a record
          for (const m of t.matches) {
            if (m.veto && !m.veto.done && m.veto.stepIndex === 0) m.veto = null;
          }
        }
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // set maps for a round (admin, any time)
    // ===== map pools (named sets of maps, assignable to rounds/matches) =====
    if (sub === 'pool_save') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const name = cleanName(b.name, 40);
      if (!name) return bad(res, 'Pool name required');
      const ids = Array.isArray(b.mapIds) ? b.mapIds.filter(id => mapById(t, id)) : [];
      // A pool is built for a specific series length. Two rules keep it coherent:
      //   steps  = maps - 1   (every map but one is consumed; the leftover is the decider)
      //   picks  = bo - 1     (each pick is a game; the decider is the last game)
      const bo = BO_OK.indexOf(parseInt(b.bo, 10)) >= 0 ? parseInt(b.bo, 10) : 1;
      const seq = cleanSequence(b.sequence);
      if (seq.length && ids.length && seq.length !== ids.length - 1) {
        return bad(res, 'This pool has ' + ids.length + ' maps, so its order needs exactly ' + (ids.length - 1) + ' steps (leaving 1 as the decider). It has ' + seq.length + '.');
      }
      const picks = seq.filter(x => x.action === 'pick').length;
      if (seq.length && picks !== bo - 1) {
        return bad(res, 'A Bo' + bo + ' pool needs exactly ' + (bo - 1) + ' pick step' + (bo - 1 === 1 ? '' : 's') + ' (plus the decider). This order has ' + picks + '.');
      }
      let pool;
      // A scheduled reveal. Stored as UTC; cleared automatically once it fires, and ignored
      // outright if the pool is already published (nothing left to reveal).
      const publishAt = b.publishAt !== undefined ? (cleanDate(b.publishAt) || null) : undefined;
      if (b.id) {
        pool = poolById(t, b.id);
        if (!pool) return bad(res, 'Pool not found');
        pool.name = name;
        pool.mapIds = ids;
        pool.sequence = seq;
        pool.bo = bo;
        if (b.published !== undefined) pool.published = b.published ? 1 : 0;
        if (publishAt !== undefined) pool.publishAt = publishAt;
      } else {
        pool = { id: 'pool' + uid(5), name, mapIds: ids, sequence: seq, bo: bo, published: b.published ? 1 : 0, publishAt: publishAt || null };
        t.mapPools.push(pool);
      }
      if (pool.published) {
        pool.publishAt = null;
        for (const id of (pool.mapIds || [])) { const mp = mapById(t, id); if (mp && !mp.published) mp.published = true; }
      }
      tlog(t, req, b.admin, (b.id ? 'edited pool "' : 'created pool "') + pool.name + '" (' + ids.length + ' maps, Bo' + pool.bo + ')');
      saveDB();
      return json(res, 200, { ok: true, id: pool.id });
    }

    // Copy one pool's ban/pick order onto others. Because the order length is welded to the
    // map count (steps = maps - 1), only pools with the SAME number of maps can receive it;
    // those are also the only ones where the pick count matches the same Bo. With applyAll,
    // every same-size pool gets it; otherwise just the given targetIds.
    // Import maps (and optionally whole pools) from another tournament the requester
    // organizes. Deduplicates by map name so repeat imports don't pile up copies.
    if (sub === 'copy_maps') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const src = db.tournaments[String(b.sourceId || '')];
      if (!src) return bad(res, 'Source tournament not found');
      const sess = currentSession(req);
      const mayRead = (Array.isArray(src.organizerFafIds) && sess && src.organizerFafIds.indexOf(sess.fafId) >= 0) ||
        (isOfficial(src) && isDirector(req)) || isAdmin(t, b.admin, req);
      if (!mayRead) return json(res, 403, { error: 'You must organize the source tournament to copy from it' });

      t.mapDb = t.mapDb || [];
      const byName = {};
      for (const m of t.mapDb) byName[(m.name || '').toLowerCase()] = m;
      const idMap = {};   // source map id -> our map id (existing or newly created)
      const wantMapIds = Array.isArray(b.mapIds) ? new Set(b.mapIds) : null;  // subset, or null = all referenced

      const ensureMap = (sm) => {
        if (!sm) return null;
        const key = (sm.name || '').toLowerCase();
        if (byName[key]) { idMap[sm.id] = byName[key].id; return byName[key].id; }
        // copy the image file so deletes in either tournament don't affect the other
        let img = null;
        if (sm.image) { try { img = copyMapImageFile(sm.image); } catch (e) { img = null; } }
        const nm = { id: 'map' + uid(5), name: sm.name || '', image: img, description: sm.description || '', published: 0 };
        t.mapDb.push(nm); byName[key] = nm; idMap[sm.id] = nm.id;
        return nm.id;
      };

      let importedMaps = 0, importedPools = 0;
      const poolIds = Array.isArray(b.poolIds) ? new Set(b.poolIds) : null;   // subset of pools, or null

      // pools first (they pull in their maps), unless caller only wants loose maps
      if (b.pools !== false && Array.isArray(src.mapPools)) {
        t.mapPools = t.mapPools || [];
        for (const sp of src.mapPools) {
          if (poolIds && !poolIds.has(sp.id)) continue;
          const mids = (sp.mapIds || []).map(mid => ensureMap((src.mapDb || []).find(m => m.id === mid))).filter(Boolean);
          // avoid duplicate pool by same name
          if ((t.mapPools || []).some(pp => (pp.name || '').toLowerCase() === (sp.name || '').toLowerCase())) continue;
          t.mapPools.push({ id: 'pool' + uid(5), name: sp.name, mapIds: mids, sequence: (sp.sequence || []).map(x => ({ action: x.action, team: x.team })), bo: sp.bo || 1, published: 0 });
          importedPools++;
        }
      }
      // loose maps: import the explicit subset if given; otherwise only sweep in ALL maps
      // on a genuine "import everything" (no pool subset and pools not disabled). When the
      // caller picked specific pools, we must NOT drag in every other map.
      const before = t.mapDb.length;
      const fullSweep = !wantMapIds && !poolIds && b.pools !== false;
      for (const sm of (src.mapDb || [])) {
        if (wantMapIds) { if (!wantMapIds.has(sm.id)) continue; }
        else if (!fullSweep) continue;   // only selected pools' maps (already handled above)
        ensureMap(sm);
      }
      importedMaps = t.mapDb.length - before;
      tlog(t, req, b.admin, 'imported ' + importedMaps + ' map' + (importedMaps === 1 ? '' : 's') + (importedPools ? ' and ' + importedPools + ' pool' + (importedPools === 1 ? '' : 's') : '') + ' from "' + src.name + '"');
      saveDB();
      return json(res, 200, { ok: true, importedMaps, importedPools });
    }

    if (sub === 'pool_copy_sequence') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const src = poolById(t, b.sourceId);
      if (!src) return bad(res, 'Source pool not found');
      const srcSize = (src.mapIds || []).length;
      if (!(src.sequence || []).length) return bad(res, 'The source pool has no ban/pick order to copy yet');
      if ((src.sequence || []).length !== srcSize - 1) return bad(res, 'Set a valid order on the source pool first');
      let targets;
      if (b.applyAll) {
        targets = (t.mapPools || []).filter(pl => pl.id !== src.id && (pl.mapIds || []).length === srcSize);
      } else {
        const ids = Array.isArray(b.targetIds) ? b.targetIds : [];
        targets = (t.mapPools || []).filter(pl => pl.id !== src.id && ids.indexOf(pl.id) >= 0);
      }
      const skipped = [];
      let applied = 0;
      for (const pl of targets) {
        if ((pl.mapIds || []).length !== srcSize) { skipped.push(pl.name + ' (' + (pl.mapIds || []).length + ' maps)'); continue; }
        pl.sequence = (src.sequence || []).map(x => ({ action: x.action, team: x.team }));
        pl.bo = src.bo;   // same size + same order => same Bo
        applied++;
      }
      tlog(t, req, b.admin, 'copied the ban/pick order from pool "' + src.name + '" to ' + applied + ' pool' + (applied === 1 ? '' : 's') + (b.applyAll ? ' (all with ' + srcSize + ' maps)' : ''));
      saveDB();
      return json(res, 200, { ok: true, applied, skipped });
    }

    if (sub === 'pool_publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const pool = poolById(t, b.id);
      if (!pool) return bad(res, 'Pool not found');
      pool.published = b.published ? 1 : 0;
      // A manual decision overrides a pending schedule either way: publishing fulfils it,
      // hiding means the organizer no longer wants it to appear on its own.
      pool.publishAt = null;
      let alsoPublished = 0;
      if (pool.published) {
        // A published pool is visible to players, so its maps must be visible too — otherwise
        // players would see raw ids. Publish any still-hidden maps in the pool.
        for (const id of (pool.mapIds || [])) {
          const mp = mapById(t, id);
          if (mp && !mp.published) { mp.published = true; alsoPublished++; }
        }
      }
      tlog(t, req, b.admin, (b.published ? 'published' : 'hid') + ' pool "' + pool.name + '"' + (alsoPublished ? ' (and published ' + alsoPublished + ' map' + (alsoPublished === 1 ? '' : 's') + ' in it)' : ''));
      saveDB();
      return json(res, 200, { ok: true, mapsPublished: alsoPublished });
    }

    if (sub === 'pool_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const delPool = poolById(t, b.id);
      if (delPool) tlog(t, req, b.admin, 'deleted pool "' + delPool.name + '"');
      t.mapPools = (t.mapPools || []).filter(p => p.id !== b.id);
      // clear any assignments pointing to this pool
      for (const key of Object.keys(t.poolAssign || {})) {
        if (t.poolAssign[key] === b.id) delete t.poolAssign[key];
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // assign a pool to a round ("bracket:round") or a specific match ("match:<id>"); empty clears it
    if (sub === 'pool_assign') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const key = String(b.key || '');
      if (!key) return bad(res, 'Missing assignment key');
      if (b.poolId) {
        if (!poolById(t, b.poolId)) return bad(res, 'Pool not found');
        t.poolAssign[key] = b.poolId;
        tlog(t, req, b.admin, 'assigned pool "' + poolById(t, b.poolId).name + '" to ' + key.replace(':', ' round ').replace('match round ', 'match '));
      } else {
        delete t.poolAssign[key];
        tlog(t, req, b.admin, 'cleared the pool assignment of ' + key.replace(':', ' round ').replace('match round ', 'match '));
      }
      // Re-run veto init for matches affected by this assignment. A match that already exists but
      // had no runnable veto (e.g. its old pool's Bo didn't match) can now get one. Matches whose
      // veto has already been acted on are left alone (initVeto guards stepIndex > 0).
      if (t.veto && t.veto.enabled && Array.isArray(t.matches)) {
        for (const m of t.matches) {
          if (m.bracket === 'ffa' || m.status === 'done') continue;
          if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') continue;
          const mk = 'match:' + m.id, rk = m.bracket + ':' + m.round;
          if (key !== mk && key !== rk) continue;               // not affected by this key
          if (key === rk && t.poolAssign['match:' + m.id]) continue;  // a per-match override wins
          if (m.veto && m.veto.stepIndex > 0) continue;         // veto already in progress
          m.veto = null;
          initVeto(t, m);
        }
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    // ===== map database =====
    // Add or update a map. Image comes as a base64 data URL (optional). Organizer only.
    if (sub === 'map_save') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const name = cleanName(b.name, 60);
      if (!name) return bad(res, 'Map name required');
      const description = String(b.description || '').slice(0, 1000);
      const published = b.published ? 1 : 0;

      // validate/save the image FIRST (before mutating the DB), so a bad image can't leave an orphan
      let newImageFile = null;
      let doRemoveImage = false;
      if (b.image && typeof b.image === 'string' && b.image.indexOf('data:') === 0) {
        try { newImageFile = saveMapImage(b.image); }
        catch (e) { return bad(res, e.message); }
      } else if (b.removeImage) {
        doRemoveImage = true;
      }

      let map;
      if (b.id) {
        map = mapById(t, b.id);
        if (!map) { deleteMapImage(newImageFile); return bad(res, 'Map not found'); }
      } else {
        map = { id: 'map' + uid(5), name: '', image: null, description: '', spec: null, published: 0 };
        t.mapDb.push(map);
      }
      map.name = name;
      map.description = description;
      map.spec = cleanMapSpec(b.spec);
      map.published = published;
      if (newImageFile) { deleteMapImage(map.image); map.image = newImageFile; }
      else if (doRemoveImage) { deleteMapImage(map.image); map.image = null; }
      tlog(t, req, b.admin, (b.id ? 'edited map ' : 'added map ') + map.name);
      saveDB();
      return json(res, 200, { ok: true, id: map.id });
    }

    // Toggle publish state (hide/publish for TD-team prep). Organizer only.
    // With all:1 it applies to every map in the database at once.
    if (sub === 'map_publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (b.all) {
        for (const m of (t.mapDb || [])) m.published = b.published ? 1 : 0;
        tlog(t, req, b.admin, (b.published ? 'published' : 'hid') + ' all maps (' + (t.mapDb || []).length + ')');
        saveDB();
        return json(res, 200, { ok: true, count: (t.mapDb || []).length });
      }
      const map = mapById(t, b.id);
      if (!map) return bad(res, 'Map not found');
      map.published = b.published ? 1 : 0;
      tlog(t, req, b.admin, (b.published ? 'published' : 'hid') + ' map ' + map.name);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Delete a map from the database. Also strips it from round pools and veto config.
    if (sub === 'map_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const map = mapById(t, b.id);
      if (!map) return json(res, 200, { ok: true });
      tlog(t, req, b.admin, 'deleted map ' + map.name);
      deleteMapImage(map.image);
      t.mapDb = t.mapDb.filter(m => m.id !== b.id);
      // remove from any round pools (legacy per-round map lists)
      for (const key of Object.keys(t.maps || {})) {
        t.maps[key] = (t.maps[key] || []).filter(id => id !== b.id);
      }
      // remove from all named map pools
      for (const pool of (t.mapPools || [])) {
        pool.mapIds = (pool.mapIds || []).filter(id => id !== b.id);
      }
      // remove from veto pool (legacy flat pool)
      if (t.veto && Array.isArray(t.veto.mapPool)) t.veto.mapPool = t.veto.mapPool.filter(id => id !== b.id);
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'set_maps') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const bracket = String(b.bracket || '');
      const round = parseInt(b.round, 10);
      if (['wb', 'lb', 'gf', 'sw', 'ffa'].indexOf(bracket) < 0 || !(round >= 1 && round <= 30)) return bad(res, 'Bad round');
      // maps are now map-DB IDs; keep only ids that exist in the database
      let ids = Array.isArray(b.maps) ? b.maps.filter(id => mapById(t, id)) : [];
      ids = ids.slice(0, 9);
      t.maps[bracket + ':' + round] = ids;
      tlog(t, req, b.admin, 'set the maps of ' + bracket + ' round ' + round + ' (' + ids.length + ' map' + (ids.length === 1 ? '' : 's') + ')');
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
        tlog(t, req, b.admin, 'reopened signups (teams reset)');
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
        tlog(t, req, b.admin, 'closed signups & started the captains draft (' + capIds.length + ' captains)');
        saveDB();
        return json(res, 200, { ok: true });
      }

      // request-mode signups that were never approved don't enter the tournament
      if (a === 'form_teams' || a === 'generate' || a === 'close') {
        const dropped = t.players.filter(p => p.pending);
        if (dropped.length) {
          dropped.forEach(p => clearJoinRequests(p.id));
          t.players = t.players.filter(p => !p.pending);
        }
        tlog(t, req, b.admin, 'closed signups & locked ' + (t.teamSize === 1 ? 'entrants' : 'teams'));
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
        // The tournament is starting: pending and declined invites are no longer relevant.
        t.invites = (t.invites || []).filter(i => (t.players || []).some(pl => pl.fafId === i.fafId));
        tlog(t, req, b.admin, 'started the bracket (' + n + ' teams)');
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
            for (let d = 1; d <= divs; d++) { buildSingle(t, t.cfg, d); }
          } else {
            buildSingle(t, t.cfg, 0);
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
            for (let d = 1; d <= divs; d++) { buildDouble(t, t.cfg, d); }
          } else {
            buildDouble(t, t.cfg, 0);
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
        // reflect the per-round Bos actually generated in the stored plan lists (for the summary)
        if (t.bracketType === 'single' || t.bracketType === 'double') syncPlanFromMatches(t);
        saveDB();
        return json(res, 200, { ok: true });
      }

      return bad(res, 'Unknown action');
    }

    // Pre-generation per-round Bo: before the bracket exists there are no matches, so the
    // per-round choices made on the preview are stored in draft arrays on the plan
    // (wbList / lbList / roundsList, plus gf). start_bracket's config is defaulted from these.
    if (sub === 'set_plan_round_bo') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (Array.isArray(t.matches) && t.matches.length) return bad(res, 'The bracket already exists \u2014 edit rounds on the bracket instead');
      const boVal = parseInt(b.bo, 10);
      if (BO_OK.indexOf(boVal) < 0) return bad(res, 'Bo must be 1, 3, 5, or 7');
      const which = String(b.list || '');   // 'wb' | 'lb' | 'rounds' | 'gf'
      t.plan = (t.plan && typeof t.plan === 'object') ? t.plan : {};
      if (which === 'gf') {
        t.plan.gf = boVal;
      } else {
        const key = which === 'wb' ? 'wbList' : which === 'lb' ? 'lbList' : which === 'rounds' ? 'roundsList' : null;
        if (!key) return bad(res, 'Bad list');
        const idx = parseInt(b.index, 10);
        if (!(idx >= 0)) return bad(res, 'Bad round index');
        if (!Array.isArray(t.plan[key])) t.plan[key] = [];
        t.plan[key][idx] = boVal;
      }
      t.perRoundBo = 1;
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Set the Bo for every match in one bracket+round (post-generation, per-round editing).
    // Only matches that haven't started yet are changed, so a live/finished match keeps its Bo.
    if (sub === 'set_round_bo') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const boVal = parseInt(b.bo, 10);
      if (BO_OK.indexOf(boVal) < 0) return bad(res, 'Bo must be 1, 3, 5, or 7');
      const bracket = String(b.bracket || '');
      const round = parseInt(b.round, 10);
      const division = b.division != null ? parseInt(b.division, 10) : null;
      let changed = 0, skipped = 0;
      for (const m of (t.matches || [])) {
        if (m.bracket !== bracket || m.round !== round) continue;
        if (division != null && (m.division || 0) !== division) continue;
        // don't disturb a match already under way or done
        if (m.status === 'live' || m.status === 'done' || (Array.isArray(m.games) && m.games.length)) { skipped++; continue; }
        if (m.bo !== boVal) { m.bo = boVal; changed++; }
      }
      // keep the stored plan arrays in sync so the format summary reflects the change too
      t.perRoundBo = 1;
      syncPlanFromMatches(t);
      tlog(t, req, b.admin, 'set ' + bracket.toUpperCase() + ' round ' + round + ' to Bo' + boVal + (skipped ? ' (' + skipped + ' in-progress match(es) left as-is)' : ''));
      saveDB();
      return json(res, 200, { ok: true, changed, skipped });
    }

    if (sub === 'pick') {
      if (t.status !== 'draft' || !t.draft) return bad(res, 'No draft in progress');
      const d = t.draft;
      if (d.current >= d.order.length) return bad(res, 'Draft is complete');
      const turnTeamId = d.order[d.current];
      const admin = isAdmin(t, b.token, req) || isOrganizer(t, req);
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
      tlog(t, req, b.token, tTeamName(t, team.id) + ' drafted ' + p.name);
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
      const admin = isAdmin(t, b.token, req) || isOrganizer(t, req);
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      // a captain may undo only their own last pick, and only if no one has picked after them
      if (!admin) {
        if (!capTeam || capTeam.id !== lp.teamId) return json(res, 403, { error: 'You can only undo your own pick' });
        if (d.current !== lp.atIndex + 1) return bad(res, 'Too late to undo \u2014 the next pick was already made');
      }
      const p = playerById(t, lp.playerId);
      const team = teamById(t, lp.teamId);
      if (!p || !team) { d.lastPick = null; saveDB(); return bad(res, 'Cannot undo (pick data missing)'); }
      tlog(t, req, b.token, 'undid the draft pick of ' + p.name + ' (' + team.name + ')');
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

    // Assign which team is A vs B for a match's veto (organizer only; before the veto starts).
    if (sub === 'veto_setab') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const m = matchById(t, b.matchId);
      if (!m || !m.veto) return bad(res, 'No veto for this match');
      if (m.veto.stepIndex > 0) return bad(res, 'The veto has already started');
      const aTeam = b.teamA;
      if (aTeam !== m.team1 && aTeam !== m.team2) return bad(res, 'teamA must be one of the two teams');
      m.veto.teamA = aTeam;
      m.veto.teamB = aTeam === m.team1 ? m.team2 : m.team1;
      tlog(t, req, b.admin, 'set the veto sides (A/B) of ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2));
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Perform the next veto step (a ban or a pick, per the sequence).
    if (sub === 'veto_action') {
      if (!t.veto || !t.veto.enabled) return bad(res, 'Vetoes are not enabled for this tournament');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (!m.veto) return bad(res, 'No veto in progress for this match');
      if (m.veto.done) return bad(res, 'The veto is already complete for this match');
      // Defence in depth: a match with a result can't be vetoed, even if stored data predates
      // vetoes being auto-closed at finalize time.
      if (m.status === 'done') return bad(res, 'This match already has a result \u2014 its veto is closed');
      if (!m.veto.teamA || !m.veto.teamB) return bad(res, 'The organizer has not set Team A / Team B for this match yet');
      const cur = vetoCurrentStep(m);
      if (!cur) return bad(res, 'No veto step pending');

      const admin = isAdmin(t, b.token, req) || isOrganizer(t, req);
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      if (!admin && !capTeam) return json(res, 403, { error: 'Only the match captains or the organizer can act' });
      // the acting team must be whoever's turn it is (organizer may act on their behalf)
      if (!admin && capTeam.id !== cur.team) return bad(res, 'Not your turn');
      if (admin && b.asTeam && b.asTeam !== cur.team) return bad(res, 'It is the other team\u2019s turn');

      const map = String(b.map || '').trim();
      const idx = m.veto.remaining.findIndex(x => x.toLowerCase() === map.toLowerCase());
      if (idx < 0) return bad(res, 'That map is not available');

      const taken = m.veto.remaining.splice(idx, 1)[0];
      if (cur.action === 'ban') {
        m.veto.banned.push({ map: taken, by: cur.team });
      } else { // pick -> next game slot
        const gameNum = m.veto.picks.length + 1;
        m.veto.picks.push({ map: taken, by: cur.team, game: gameNum });
      }
      const vMapName = (mapById(t, taken) || {}).name || taken;
      tlog(t, req, b.admin || b.token, tTeamName(t, cur.team) + ' ' + (cur.action === 'ban' ? 'banned' : 'picked') + ' ' + vMapName + ' (' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2) + ')');
      vetoAdvance(t, m);
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Undo the last veto step (organizer only) — for misclicks.
    if (sub === 'veto_undo') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const m = matchById(t, b.matchId);
      if (!m || !m.veto) return bad(res, 'No veto for this match');
      if (m.veto.stepIndex === 0 && !m.veto.done) return bad(res, 'Nothing to undo');
      // step back one
      if (m.veto.done) { m.veto.done = false; m.veto.decider = null; }
      if (m.veto.stepIndex > 0) m.veto.stepIndex--;
      const step = m.veto.sequence[m.veto.stepIndex];
      if (step) {
        // pull the map that was banned/picked at this step back into remaining
        let restored = null;
        if (step.action === 'ban' && m.veto.banned.length) restored = m.veto.banned.pop().map;
        else if (step.action === 'pick' && m.veto.picks.length) restored = m.veto.picks.pop().map;
        if (restored) m.veto.remaining.push(restored);
      }
      tlog(t, req, b.admin, 'undid the last veto step (' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2) + ')');
      saveDB();
      return json(res, 200, { ok: true });
    }

    // team of which the logged-in viewer (or captain token) is a MEMBER — reporting rights
    function memberTeamOf(reqBody) {
      const byTok = teamOfCaptainToken(t, reqBody && reqBody.token);
      if (byTok) return byTok;
      const sess = currentSession(req);
      if (!sess || !sess.fafId) return null;
      const mine = t.players.find(pl => pl.fafId === sess.fafId);
      if (!mine || !mine.teamId) return null;
      return teamById(t, mine.teamId);
    }

    if (sub === 'report_submit') {
      // A member of either team submits a (running) score with replay IDs for the new games.
      // It only counts once a member of the OTHER team (or the organizer) confirms it.
      if (t.playerReporting === false) return bad(res, 'Only the organizer reports scores in this tournament');
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (m.bracket === 'ffa') return bad(res, 'FFA results are reported by captains or the organizer directly');
      const myTeam = memberTeamOf(b);
      if (!myTeam || (myTeam.id !== m.team1 && myTeam.id !== m.team2)) {
        return json(res, 403, { error: 'Only players in this match can submit its score' });
      }
      if (m.status === 'done') return bad(res, 'The series is decided \u2014 only the organizer can correct it');
      if (m.status !== 'ready' && m.status !== 'live') return bad(res, 'Match not ready yet');
      const maxW = Math.ceil(m.bo / 2);
      const s1 = parseInt(b.score1, 10), s2 = parseInt(b.score2, 10);
      if (!(s1 >= 0 && s2 >= 0 && s1 <= maxW && s2 <= maxW)) return bad(res, 'Scores must be between 0 and ' + maxW);
      if (m.hcap && s1 < 1) return bad(res, 'This grand final starts 1-0 (upper bracket advantage)');
      if (s1 === maxW && s2 === maxW) return bad(res, 'Both teams cannot reach ' + maxW);
      const cur1 = m.score1 != null ? m.score1 : (m.hcap ? 1 : 0);
      const cur2 = m.score2 != null ? m.score2 : 0;
      if (s1 < cur1 || s2 < cur2) return bad(res, 'Scores can only go up from the confirmed ' + cur1 + '\u2013' + cur2 + ' \u2014 ask the organizer to correct a wrong score');
      const newGames = (s1 + s2) - (cur1 + cur2);
      if (newGames < 1) return bad(res, 'Nothing new to report \u2014 the confirmed score is already ' + cur1 + '\u2013' + cur2);
      // replay IDs: exactly one per newly reported game
      let ids = Array.isArray(b.replayIds) ? b.replayIds.map(x => String(x).trim().replace(/\D/g, '').slice(0, 24)).filter(Boolean) : [];
      if (ids.length !== newGames) return bad(res, 'Provide exactly ' + newGames + ' replay ID' + (newGames === 1 ? '' : 's') + ' \u2014 one for each newly reported game');
      // Optional: games that ended in a draw were replayed and produce no score, but their
      // replay IDs are still worth keeping (casters, archive). Any Bo, including Bo1.
      const drawIds = Array.isArray(b.drawReplayIds) ? b.drawReplayIds.map(x => String(x).trim().replace(/\D/g, '').slice(0, 24)).filter(Boolean).slice(0, 10) : [];
      m.pendingReport = { score1: s1, score2: s2, replayIds: ids, drawReplayIds: drawIds, byTeam: myTeam.id, byName: actorOf(req, b).name || myTeam.name, at: now() };
      tlog(t, req, b.token, 'submitted ' + s1 + '\u2013' + s2 + ' for ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2) + ' (awaiting confirmation)');
      saveDB();
      return json(res, 200, { ok: true, pending: 1 });
    }

    if (sub === 'report_confirm') {
      // A member of the OTHER team (or the organizer) accepts or rejects the pending submission.
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      if (!m.pendingReport) return bad(res, 'Nothing awaiting confirmation on this match');
      const admin = isAdmin(t, b.token, req) || isOrganizer(t, req);
      if (!admin) {
        const myTeam = memberTeamOf(b);
        const other = m.pendingReport.byTeam === m.team1 ? m.team2 : m.team1;
        if (!myTeam || myTeam.id !== other) return json(res, 403, { error: 'Only the opposing team (or the organizer) can confirm this score' });
      }
      const pr = m.pendingReport;
      m.pendingReport = null;
      if (!b.accept) {
        tlog(t, req, b.token, 'rejected the submitted score ' + pr.score1 + '\u2013' + pr.score2 + ' for ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2));
        saveDB();
        return json(res, 200, { ok: true, rejected: 1 });
      }
      tlog(t, req, b.token, 'confirmed ' + pr.score1 + '\u2013' + pr.score2 + ' for ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2));
      if (m.status === 'done') return bad(res, 'The series was decided in the meantime');
      m.replayIds = (m.replayIds || []).concat(pr.replayIds);
      if (pr.drawReplayIds && pr.drawReplayIds.length) m.drawReplayIds = (m.drawReplayIds || []).concat(pr.drawReplayIds).slice(0, 15);
      const maxW = Math.ceil(m.bo / 2);
      if (pr.score1 === maxW || pr.score2 === maxW) {
        finalizeMatch(t, m, pr.score1, pr.score2);
      } else {
        m.score1 = pr.score1; m.score2 = pr.score2;
        m.status = 'live';
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'report') {
      if (t.status !== 'running' && t.status !== 'finished') return bad(res, 'Bracket not running');
      const m = matchById(t, b.matchId);
      if (!m) return bad(res, 'Match not found');
      const admin = isAdmin(t, b.token, req) || isOrganizer(t, req);
      // Players no longer report directly: they submit via report_submit and the opponent
      // confirms (report_confirm). Direct /report is the organizer override. FFA keeps the
      // captain path (winner selection, no scores/replays).
      const capTeam = teamOfCaptainToken(t, b.token) || teamOfSession(t, req);
      if (!admin && m.bracket !== 'ffa') {
        return json(res, 403, { error: t.playerReporting === false
          ? 'Only the organizer reports scores in this tournament'
          : 'Submit your score with the report button \u2014 it needs replay IDs and your opponent\u2019s confirmation' });
      }

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

      // Forfeit shorthand: {forfeit: loserId} with no score/winner still works — derive the winner
      // as the other team and mark the loser FF (-1). A score and/or explicit winner can also be
      // supplied (handled by the normal path below), e.g. a 1-1 that ended in a forfeit.
      const noScore = (b.score1 === undefined || b.score1 === '') && (b.score2 === undefined || b.score2 === '');
      if (b.forfeit && !b.winner && noScore) {
        if (!admin) return json(res, 403, { error: 'Only the organizer can record a forfeit' });
        const ffId = String(b.forfeit);
        if (ffId !== m.team1 && ffId !== m.team2) return bad(res, 'Forfeiting team is not in this match');
        const winId = ffId === m.team1 ? m.team2 : m.team1;
        if (!winId || winId === 'BYE') return bad(res, 'The opponent is not set yet');
        m.forfeit = ffId;
        m.pendingReport = null;
        const fs1 = ffId === m.team1 ? -1 : maxW, fs2 = ffId === m.team1 ? maxW : -1;
        tlog(t, req, b.token, tTeamName(t, ffId) + ' forfeited vs ' + tTeamName(t, winId) + ' \u2014 win awarded to ' + tTeamName(t, winId) + (m.status === 'done' ? ' (correction)' : ''));
        finalizeMatch(t, m, fs1, fs2, winId);
        saveDB();
        return json(res, 200, { ok: true });
      }
      const s1 = parseInt(b.score1, 10), s2 = parseInt(b.score2, 10);
      if (!(s1 >= 0 && s2 >= 0 && s1 <= maxW && s2 <= maxW)) return bad(res, 'Scores must be between 0 and ' + maxW);
      if (m.hcap && s1 < 1) return bad(res, 'This grand final starts 1-0 (upper bracket advantage)');
      if (s1 === maxW && s2 === maxW) return bad(res, 'Both teams cannot reach ' + maxW);

      m.pendingReport = null;   // organizer word overrides any pending player submission
      tlog(t, req, b.token, 'set the score of ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2) + ' to ' + parseInt(b.score1, 10) + '\u2013' + parseInt(b.score2, 10) + (m.status === 'done' ? ' (correction)' : ''));
      // Optional: organizer can record/correct the replay IDs (kept for the archive).
      // Sending the key replaces the stored set; an empty list clears it.
      if (Array.isArray(b.replayIds)) {
        m.replayIds = b.replayIds.map(x => String(x).trim().replace(/\D/g, '').slice(0, 24)).filter(Boolean).slice(0, 15);
        if (!m.replayIds.length) delete m.replayIds;
      }
      if (Array.isArray(b.drawReplayIds)) {
        m.drawReplayIds = b.drawReplayIds.map(x => String(x).trim().replace(/\D/g, '').slice(0, 24)).filter(Boolean).slice(0, 15);
        if (!m.drawReplayIds.length) delete m.drawReplayIds;
      }
      // Optional explicit winner (organizer only). Lets a match be finalized with a winner even
      // when the score doesn't reach the normal threshold — e.g. it was 1-1 and one side forfeited,
      // or any inconclusive score the organizer needs to resolve. Replay IDs are kept as normal.
      let winOverride = null;
      if (b.winner) {
        if (!admin) return json(res, 403, { error: 'Only the organizer can set a winner directly' });
        if (b.winner !== m.team1 && b.winner !== m.team2) return bad(res, 'Winner must be one of the two teams');
        winOverride = String(b.winner);
      } else if (b.forfeit) {
        // forfeit with a played score but no explicit winner: the winner is the other team
        if (!admin) return json(res, 403, { error: 'Only the organizer can record a forfeit' });
        const ffId = String(b.forfeit);
        if (ffId !== m.team1 && ffId !== m.team2) return bad(res, 'Forfeiting team is not in this match');
        winOverride = ffId === m.team1 ? m.team2 : m.team1;
      }
      if (b.forfeit) { m.forfeit = String(b.forfeit); } else { delete m.forfeit; }

      if (winOverride) {
        finalizeMatch(t, m, s1, s2, winOverride);
        tlog(t, req, b.token, 'set ' + tTeamName(t, m.team1) + ' vs ' + tTeamName(t, m.team2) + ' to ' + s1 + '\u2013' + s2 + ', winner ' + tTeamName(t, winOverride) + (m.forfeit ? ' (forfeit)' : '') + (m.status === 'done' ? ' (correction)' : ''));
      } else if (s1 === maxW || s2 === maxW) {
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

// path -> gzipped buffer (or null if compression failed). Bounded by the number of files in
// public/, which is fixed at 7.
const GZ_CACHE = new Map();

function serveStatic(req, res, url) {
  let p = url.pathname;
  if (p === '/' || p === '/host' || p === '/siteadmin' || p === '/editor' || p === '/importer' || p === '/hall' || p === '/faq' || p === '/series' || p.startsWith('/series/') || p.startsWith('/t/')) p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    if (file.endsWith('index.html')) data = data.toString().replace(/__V__/g, BOOT);
    const h = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    };
    // The client pulls ~550 KB of JS/CSS on every load. gzip takes that to ~140 KB. The container
    // re-clones the repo on start, so these files cannot change while the process is alive -
    // compress each one once and serve the cached buffer from then on.
    if (/\bgzip\b/.test(String((req.headers && req.headers['accept-encoding']) || '')) && /\.(js|css|html|svg)$/.test(file)) {
      let gz = GZ_CACHE.get(file);
      if (gz === undefined) {
        try { gz = zlib.gzipSync(Buffer.from(data), { level: 6 }); } catch (e) { gz = null; }
        // index.html carries the per-boot cache-buster, so it is never worth caching compressed.
        if (!file.endsWith('index.html')) GZ_CACHE.set(file, gz);
      }
      if (gz) {
        h['Content-Encoding'] = 'gzip';
        h['Vary'] = 'Accept-Encoding';
        res.writeHead(200, h);
        return res.end(gz);
      }
    }
    res.writeHead(200, h);
    res.end(data);
  });
}

loadDB();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    // Resolve an Authorization: Bearer session once, before anything reads currentSession().
    // Only costs a FAF round trip when a token is present and uncached.
    if (req.headers.authorization) await attachSession(req);
    if (url.pathname.startsWith('/api/')) return await handleAPI(req, res, url);
    if (url.pathname.startsWith('/auth/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/map-images/')) return serveMapImage(req, res, url);
    if (url.pathname.startsWith('/desc-images/')) return serveDescImage(req, res, url);
    if (url.pathname.startsWith('/article-images/')) return serveArticleImage(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Server error: ' + e.message });
  }
});

// serve a stored map image by filename (read-only; filenames are opaque tokens we generated)
function serveMapImage(req, res, url) {
  const name = path.basename(decodeURIComponent(url.pathname.slice('/map-images/'.length)));
  if (!name || name.indexOf('..') >= 0) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(MAP_IMG_DIR, name);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = (name.split('.').pop() || '').toLowerCase();
    const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}
function serveDescImage(req, res, url) {
  const name = path.basename(decodeURIComponent(url.pathname.slice('/desc-images/'.length)));
  if (!name || name.indexOf('..') >= 0) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(DESC_IMG_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = (name.split('.').pop() || '').toLowerCase();
    const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}
function serveArticleImage(req, res, url) {
  const name = path.basename(decodeURIComponent(url.pathname.slice('/article-images/'.length)));
  if (!name || name.indexOf('..') >= 0) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(ARTICLE_IMG_DIR, name), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = (name.split('.').pop() || '').toLowerCase();
    const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    res.end(data);
  });
}

server.listen(PORT, () => console.log('FAF Tourney running on port ' + PORT));
