// FAF Tourney — zero-dependency tournament manager
// Node 18+ only. No npm install needed.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
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
const { swissPairRound, swissAfterReport } = require('./lib/swiss');
const { ffaCreateRound, ffaAfterReport } = require('./lib/ffa');
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
  if (!Array.isArray(db.auditLog)) db.auditLog = [];
  if (!Array.isArray(db.hostRequests)) db.hostRequests = [];
  if (!db.hostAllowed || typeof db.hostAllowed !== 'object') db.hostAllowed = {};
  if (!Array.isArray(db.articles)) db.articles = [];
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

// ---------- helpers ----------

function getT(id) { return db.tournaments[id] || null; }
function isAdmin(t, token) { return !!token && (token === t.adminToken || (GADMIN && token === GADMIN)); }

// ---------- audit log ----------
// A short, honest record of the things worth being able to answer later: who made this, and
// who deleted that. Capped so db.json can't grow without bound.
const AUDIT_MAX = 5000;
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '';
}
// Who is doing this? Prefer a real FAF identity; fall back to how they authenticated.
function actorOf(req, token) {
  const sess = currentSession(req);
  if (sess) return { kind: 'faf', fafId: sess.fafId, name: sess.fafName || ('FAF ' + sess.fafId) };
  if (token && GADMIN && token === GADMIN) return { kind: 'siteadmin', fafId: null, name: 'Site admin' };
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
}

// ---------- who may host ----------
// Before FAF login is configured, anyone can create (the legacy flow). Once it's on, a FAF
// account must be approved by the site admin — that's what stops spam and accidents.
function canHost(req, token) {
  if (GADMIN && token === GADMIN) return true;         // site admin always can
  if (!FAF_OAUTH_ON) return true;                       // pre-login: unchanged, open to all
  const sess = currentSession(req);
  if (!sess) return false;
  return !!db.hostAllowed[sess.fafId];
}

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


function publicView(t) {
  return {
    id: t.id, name: t.name, description: t.description, category: t.category || null,
    published: t.published !== false ? 1 : 0, archived: t.archived ? 1 : 0,
    descImages: (t.descImages || []).slice(),
    checkInDeadline: t.checkInDeadline || null,
    lobbyOptions: t.lobbyOptions || '', mods: t.mods || '',
    competition: t.competition, formation: t.formation,
    teamSize: t.teamSize, draftOrder: t.draftOrder,
    bracketType: t.bracketType, ffaCfg: t.ffaCfg || null,
    plan: t.plan || null, maxTeams: t.maxTeams || 0,
    cfg: t.cfg || null, seeding: t.seeding, ratingType: t.ratingType || 'global', ratingDate: t.ratingDate || null,
    veto: t.veto || { enabled: false, mode: 'upfront' },
    status: t.status, createdAt: t.createdAt,
    eventDate: t.eventDate || null,
    challongeDate: t.challongeDate || null,
    rounds: t.rounds || 0,
    maps: t.maps || {},
    mapDb: (t.mapDb || []).map(publicMapView),
    mapPools: (t.mapPools || []).map(p => ({ id: p.id, name: p.name, mapIds: (p.mapIds || []).slice(), sequence: (p.sequence || []).slice(), bo: p.bo || ((p.sequence || []).filter(x => x.action === 'pick').length + 1), published: p.published ? 1 : 0 })),
    poolAssign: t.poolAssign || {},
    players: t.players,
    teams: t.teams.map(x => ({
      id: x.id, name: x.name, seed: x.seed,
      captainId: x.captainId, playerIds: x.playerIds,
      division: x.division || 0,
      checkedIn: x.checkedIn ? 1 : 0, createdAt: x.createdAt || 0,
      captainRenamed: x.captainRenamed ? 1 : 0,
      joinRequests: (x.joinRequests || []).map(r => ({ playerId: r.playerId, name: r.name, at: r.at || 0 })),
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
  if (sess.faf.access && sess.faf.exp && Date.now() < sess.faf.exp - 30000) return sess.faf.access;
  if (!sess.faf.refresh) return sess.faf.access || null;
  try {
    const form = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: sess.faf.refresh,
      client_id: FAF_CLIENT_ID, client_secret: FAF_CLIENT_SECRET
    }).toString();
    const r = await httpsRequest({
      host: 'hydra.faforever.com', path: '/oauth2/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }
    }, form);
    if (r.status !== 200) return sess.faf.access || null;
    const j = JSON.parse(r.text);
    if (j.access_token) sess.faf.access = j.access_token;
    if (j.refresh_token) sess.faf.refresh = j.refresh_token;
    sess.faf.exp = Date.now() + ((j.expires_in || 3600) * 1000);
    saveDB();
    return sess.faf.access;
  } catch (e) { return sess.faf.access || null; }
}

// One journal lookup, mirroring the FAF downloader's Rating-lookup tab. rating = the entry's
// `rating` attribute if present, else round(mean - 3*deviation); newest entry on/before the cutoff.
async function fafJournalRating(playerFilter, lbName, cutoffIso, token) {
  const filter = playerFilter + ';leaderboard.technicalName==' + rsqlQuote(lbName) + ';createTime=le=' + rsqlQuote(cutoffIso);
  const path = '/data/leaderboardRatingJournal?filter=' + encodeURIComponent(filter) + '&sort=-createTime&page%5Bsize%5D=1&include=leaderboard';
  const headers = { 'Accept': 'application/vnd.api+json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await httpsRequest({ host: 'api.faforever.com', path, method: 'GET', headers });
  let rating = null;
  try {
    if (r.status === 200) {
      const row = (JSON.parse(r.text).data || [])[0];
      if (row && row.attributes) {
        const a = row.attributes;
        if (a.rating != null && isFinite(Number(a.rating))) rating = Math.round(Number(a.rating));
        else {
          const mean = Number(a.meanAfter), dev = Number(a.deviationAfter);
          if (isFinite(mean) && isFinite(dev)) rating = Math.max(0, Math.round(mean - 3 * dev));
        }
      }
    }
  } catch (e) {}
  return { filter, status: r.status, rating, body: (r.text || '').slice(0, 500) };
}

// Player path via gamePlayerStats (the downloader's confirmed filter), with a direct player.id
// fallback. Returns a detailed probe (used by signup and the /api/my/rating-debug diagnostic).
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
  try { return (await fafRatingProbe(fafId, ratingType, asOfMs, token)).rating; }
  catch (e) { return null; }
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
    db.sessions[sid] = {
      fafId: ident.fafId, fafName: ident.fafName, exp: Date.now() + SESSION_TTL_MS,
      faf: { access: accessToken, refresh: tok.refresh_token || null, exp: Date.now() + ((tok.expires_in || 3600) * 1000) }
    };
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
    if (FAF_OAUTH_ON && !hostSess && !(GADMIN && b.admin === GADMIN)) return json(res, 401, { error: 'Log in with FAF to host a tournament' });
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
      category,
      published: false, archived: false, descImages: [],
      lobbyOptions: cleanName(b.lobbyOptions, 500),
      mods: cleanName(b.mods, 500),
      competition, formation, teamSize, draftOrder, bracketType, ffaCfg,
      plan, maxTeams,
      cfg: null, maps: {}, mapDb: [], mapPools: [], poolAssign: {},
      seeding: (['rating', 'random', 'manual'].indexOf(b.seeding) >= 0) ? b.seeding : 'rating',
      ratingType: (['global', '1v1', '2v2', '3v3', '4v4'].indexOf(b.ratingType) >= 0) ? b.ratingType : (b.ratingType === 'none' ? 'none' : 'global'),
      ratingDate: b.ratingDate ? (new Date(b.ratingDate).getTime() || null) : null,
      veto: cleanVeto(b.veto),
      eventDate: cleanDate(b.eventDate),
      status: 'signup', createdAt: now(),
      organizerFafIds: (hostSess && hostSess.fafId) ? [hostSess.fafId] : [],
      createdByName: (hostSess && hostSess.fafName) || '',
      players: [], teams: [], matches: [], rounds: 0, draft: null, subs: []
    };
    db.tournaments[t.id] = t;
    saveDB();
    audit(req, 'tournament_created', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
    return json(res, 200, { id: t.id, adminToken: t.adminToken });
  }

  if (parts.length === 2 && parts[1] === 'siteadmin' && method === 'POST') {
    const b = await readBody(req);
    if (!GADMIN) return bad(res, 'Site admin is not configured on the server (ADMIN_PASSWORD env var not set)');
    if (b.password !== GADMIN) return json(res, 403, { error: 'Wrong password' });
    return json(res, 200, { ok: true });
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
      allowed: db.hostAllowed[sess.fafId] ? 1 : 0,
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

  // ---- site admin data + decisions ----
  if (parts.length === 3 && parts[1] === 'siteadmin' && method === 'POST') {
    const b = await readBody(req);
    if (!GADMIN) return bad(res, 'Site admin is not configured on the server (ADMIN_PASSWORD env var not set)');
    if (b.password !== GADMIN) return json(res, 403, { error: 'Wrong password' });
    const act = parts[2];

    if (act === 'data') {
      const allowed = Object.keys(db.hostAllowed).map(fid => ({
        fafId: fid,
        name: db.hostAllowed[fid].name || '',
        at: db.hostAllowed[fid].at || 0,
        by: db.hostAllowed[fid].by || ''
      })).sort((x, y) => y.at - x.at);
      return json(res, 200, {
        oauth: FAF_OAUTH_ON ? 1 : 0,
        logs: db.auditLog.slice().reverse().slice(0, 500),   // newest first
        requests: (db.hostRequests || []).slice().reverse(),
        allowed,
        archived: Object.values(db.tournaments).filter(t => t.archived).map(t => ({
          id: t.id, name: t.name, status: t.status, at: t.archivedAt || 0, players: (t.players || []).length
        })).sort((x, y) => y.at - x.at),
        articles: (db.articles || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0))
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
      if (b.id) {
        const a = (db.articles || []).find(x => x.id === b.id);
        if (!a) return bad(res, 'Article not found');
        a.title = title; a.body = body2; a.updatedAt = Date.now();
      } else {
        db.articles.push({ id: 'art' + uid(6), title, body: body2, order: db.articles.length, createdAt: Date.now(), updatedAt: Date.now() });
      }
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (act === 'article_image') {
      let fname;
      try { fname = saveArticleImage(b.image); } catch (e) { return bad(res, e.message); }
      return json(res, 200, { ok: true, file: fname, url: '/article-images/' + fname });
    }

    if (act === 'article_delete') {
      const art = (db.articles || []).find(a => a.id === b.id);
      if (art) {
        // remove any images this article referenced, so they don't orphan on disk
        const used = String(art.body || '').match(/\/article-images\/[A-Za-z0-9_.-]+/g) || [];
        used.forEach(u => deleteArticleImage(u.split('/').pop()));
      }
      db.articles = (db.articles || []).filter(a => a.id !== b.id);
      saveDB();
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

    return bad(res, 'Unknown site admin action');
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
    const sess = currentSession(req);
    const myFid = sess && sess.fafId;
    const list = Object.values(db.tournaments)
      .filter(t => !t.archived && (t.published !== false || (myFid && Array.isArray(t.organizerFafIds) && t.organizerFafIds.indexOf(myFid) >= 0)))   // drafts hidden from the public, but the organizer sees their own
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(t => ({
        id: t.id, name: t.name, status: t.status, category: t.category || null,
        published: t.published !== false ? 1 : 0,
        competition: t.competition, bracketType: t.bracketType,
        teamSize: t.teamSize, players: t.players.length,
        teams: t.teams.length, createdAt: t.createdAt,
        imported: t.imported || false,
        eventDate: t.eventDate || null,
        challongeDate: t.challongeDate || null
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
    const arts = (db.articles || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    return json(res, 200, arts);
  }

  if (parts.length === 3 && parts[1] === 'my' && parts[2] === 'rating-debug' && method === 'GET') {
    const sess = currentSession(req);
    if (!sess || !sess.fafId) return json(res, 401, { error: 'Log in with FAF first' });
    const type = url.searchParams.get('type') || 'global';
    const dateStr = url.searchParams.get('date');
    const asOfMs = dateStr ? (new Date(dateStr).getTime() || Date.now()) : Date.now();
    const token = await fafValidToken(sess);
    const probe = await fafRatingProbe(sess.fafId, type, asOfMs, token);
    return json(res, 200, probe);
  }

  if (parts.length === 3 && parts[1] === 'my' && parts[2] === 'pending' && method === 'GET') {
    const sess = currentSession(req);
    const out = [];
    if (sess && sess.fafId) {
      for (const t of Object.values(db.tournaments)) {
        if (t.archived || t.published === false) continue;
        const meP = (t.players || []).find(p => p.fafId === sess.fafId);
        if (!meP) continue;
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
    return json(res, 200, { pending: out });
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
      // Hide prep from non-organizers: unpublished maps and unpublished pools.
      // Exception: a map that's already on screen somewhere (in a live veto or a round's
      // map pool) must keep its name, or players would see a raw id.
      if (!organizer) {
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
      if (!isAdmin(t, url.searchParams.get('admin')) && !isOrganizer(t, req)) return json(res, 403, { error: 'Organizer rights required' });
      return json(res, 200, {
        adminToken: t.adminToken,
        lateToken: t.lateToken
      });
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
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'delete') {
      const siteAdmin = !!(GADMIN && b.admin === GADMIN);
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

    if (sub === 'restore') {
      if (!(GADMIN && b.admin === GADMIN)) return json(res, 403, { error: 'Site admin only' });
      t.archived = false; t.archivedAt = null;
      saveDB();
      audit(req, 'tournament_restored', { tournamentId: t.id, tournamentName: t.name, token: b.admin, detail: 'restored by site admin' });
      return json(res, 200, { ok: true });
    }

    if (sub === 'publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      t.published = true;
      saveDB();
      audit(req, 'tournament_published', { tournamentId: t.id, tournamentName: t.name, token: b.admin });
      return json(res, 200, { ok: true });
    }

    if (sub === 'signup') {
      if (!FAF_OAUTH_ON && t.formation === 'premade' && t.teamSize > 1) return bad(res, 'This tournament uses whole-team registration \u2014 one player registers the full team');

      const sess = currentSession(req);
      const adminAdding = isAdmin(t, b.admin) || canOrganize(t, req, b);
      // Late signups (after signups close) require the organizer's late-signup token OR organizer rights.
      const lateOk = (b.lateToken && b.lateToken === t.lateToken) || adminAdding;
      if (t.status !== 'signup' && !lateOk) return bad(res, 'Signups are closed');

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
        const probe = await fafRatingProbe(fafId, t.ratingType, t.ratingDate, token);
        if (probe.rating == null) {
          const any200 = probe.attempts.some(a => a.status === 200);
          if (any200) return bad(res, 'FAF has no ' + t.ratingType + ' rating for your account as of the tournament date \u2014 you may not have played ranked ' + t.ratingType + ' games by then.');
          return bad(res, 'Could not fetch your rating from FAF right now \u2014 please try again in a moment.');
        }
        rating = probe.rating;
      } else {
        rating = parseInt(b.rating, 10);
        if (!(rating >= 0 && rating <= 4000)) return bad(res, 'Enter a FAF rating (0\u20134000)');
      }
      const p = {
        id: 'p' + uid(4), name, rating: (rating != null ? rating : null), fafId: fafId, manual: manual,
        late: (t.status !== 'signup') ? 1 : 0,
        teamName: (t.formation === 'premade') ? cleanName(b.teamName, 30) : '',
        teamId: null, signedAt: now()
      };
      t.players.push(p);
      saveDB();
      return json(res, 200, { ok: true, playerId: p.id });
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
    if (['create_team', 'join_team', 'leave_team', 'disband_team', 'move_player', 'set_captain', 'checkin_team', 'org_create_team', 'request_join', 'respond_join', 'cancel_join'].indexOf(sub) >= 0) {
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
      // No hard cap here: teams beyond maxTeams are allowed and become the waiting list.
      // maxTeams caps PARTICIPANTS, resolved at launch (see finalizeOpenTeams).
      const team = { id: 't' + uid(4), name, seed: 0, captainId: me.id, playerIds: [me.id], captainToken: uid(10), eliminated: false, out: null, createdAt: now(), checkedIn: false };
      t.teams.push(team);
      me.teamId = team.id;
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
      team.checkedIn = (b.value === undefined) ? true : !!b.value;
      team.checkedInAt = team.checkedIn ? now() : null;
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
      saveDB();
      return json(res, 200, { ok: true, teamId: team.id });
    }

    if (sub === 'join_team') {
      // Instant self-join is gone: players request, the captain approves.
      return bad(res, 'Send a join request — the team captain approves it.');
    }

    if (sub === 'request_join') {
      const me = actingPlayer(b);
      if (!me) return json(res, 401, { error: 'Sign up first' });
      if (me.teamId) return bad(res, 'Leave your current team first');
      const team = teamById(t, b.teamId);
      if (!team) return bad(res, 'Team not found');
      if (team.playerIds.length >= t.teamSize) return bad(res, 'That team is full');
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
        team.playerIds.push(p.id);
        p.teamId = team.id;
        // once they're on a team, drop their pending requests everywhere
        t.teams.forEach(tm => { if (tm.joinRequests) tm.joinRequests = tm.joinRequests.filter(r => r.playerId !== p.id); });
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
      if (b.seeding !== undefined) t.seeding = ['rating', 'random', 'manual'].indexOf(b.seeding) >= 0 ? b.seeding : t.seeding;
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

    if (sub === 'add_desc_image') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      t.descImages = t.descImages || [];
      if (t.descImages.length >= MAX_DESC_IMAGES) return bad(res, 'This tournament already has the maximum of ' + MAX_DESC_IMAGES + ' images');
      let fname;
      try { fname = saveDescImage(b.image); } catch (e) { return bad(res, e.message); }
      t.descImages.push(fname);
      saveDB();
      return json(res, 200, { ok: true, file: fname, count: t.descImages.length });
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
    if (sub === 'edit_info') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      if (b.description !== undefined) t.description = cleanName(b.description, 500);
      if (b.lobbyOptions !== undefined) t.lobbyOptions = cleanName(b.lobbyOptions, 500);
      if (b.mods !== undefined) t.mods = cleanName(b.mods, 500);
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
      if (b.id) {
        pool = poolById(t, b.id);
        if (!pool) return bad(res, 'Pool not found');
        pool.name = name;
        pool.mapIds = ids;
        pool.sequence = seq;
        pool.bo = bo;
        if (b.published !== undefined) pool.published = b.published ? 1 : 0;
      } else {
        pool = { id: 'pool' + uid(5), name, mapIds: ids, sequence: seq, bo: bo, published: b.published ? 1 : 0 };
        t.mapPools.push(pool);
      }
      saveDB();
      return json(res, 200, { ok: true, id: pool.id });
    }

    if (sub === 'pool_publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const pool = poolById(t, b.id);
      if (!pool) return bad(res, 'Pool not found');
      pool.published = b.published ? 1 : 0;
      saveDB();
      return json(res, 200, { ok: true });
    }

    if (sub === 'pool_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
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
      } else {
        delete t.poolAssign[key];
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
        map = { id: 'map' + uid(5), name: '', image: null, description: '', published: 0 };
        t.mapDb.push(map);
      }
      map.name = name;
      map.description = description;
      map.published = published;
      if (newImageFile) { deleteMapImage(map.image); map.image = newImageFile; }
      else if (doRemoveImage) { deleteMapImage(map.image); map.image = null; }
      saveDB();
      return json(res, 200, { ok: true, id: map.id });
    }

    // Toggle publish state (hide/publish for TD-team prep). Organizer only.
    if (sub === 'map_publish') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const map = mapById(t, b.id);
      if (!map) return bad(res, 'Map not found');
      map.published = b.published ? 1 : 0;
      saveDB();
      return json(res, 200, { ok: true });
    }

    // Delete a map from the database. Also strips it from round pools and veto config.
    if (sub === 'map_delete') {
      if (!canOrganize(t, req, b)) return json(res, 403, { error: 'Organizer rights required' });
      const map = mapById(t, b.id);
      if (!map) return json(res, 200, { ok: true });
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
      if (!m.veto.teamA || !m.veto.teamB) return bad(res, 'The organizer has not set Team A / Team B for this match yet');
      const cur = vetoCurrentStep(m);
      if (!cur) return bad(res, 'No veto step pending');

      const admin = isAdmin(t, b.token) || isOrganizer(t, req);
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
  if (p === '/' || p === '/host' || p === '/siteadmin' || p === '/hall' || p === '/faq' || p.startsWith('/t/')) p = '/index.html';
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
