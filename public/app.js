/* FAF Tourney frontend v2 */
'use strict';

const app = document.getElementById('app');
const topbarRight = document.getElementById('topbarRight');

let T = null;
let currentTab = 'overview';
let pollTimer = null;
let lastSnapshot = '';
// Personal "streamer mode": hides match results and who's eliminated on THIS browser only, so a
// caster can reveal on stream. Persisted locally; never sent to the server or seen by others.
let streamerMode = (() => { try { return localStorage.getItem('faf_streamer_mode') === '1'; } catch (e) { return false; } })();
function setStreamerMode(on) {
  streamerMode = !!on;
  try { localStorage.setItem('faf_streamer_mode', streamerMode ? '1' : '0'); } catch (e) {}
}
// "View as player": when a site admin / organizer is really here as a participant, this hides the
// organizer & admin controls (Admin tab, Log, report/edit buttons, etc.) on THIS browser so the
// view isn't cluttered. It never changes actual permissions on the server.
let playerViewMode = (() => { try { return localStorage.getItem('faf_player_view') === '1'; } catch (e) { return false; } })();
function setPlayerViewMode(on) {
  playerViewMode = !!on;
  try { localStorage.setItem('faf_player_view', playerViewMode ? '1' : '0'); } catch (e) {}
}
// Bracket labels: show each team's players instead of the team name. Personal, per browser.
let showPlayerNames = (() => { try { return localStorage.getItem('faf_show_players') === '1'; } catch (e) { return false; } })();
function setShowPlayerNames(on) {
  showPlayerNames = !!on;
  try { localStorage.setItem('faf_show_players', showPlayerNames ? '1' : '0'); } catch (e) {}
}

// In streamer mode, individual matches can be temporarily "revealed" (show score + who advanced)
// so the caster can look at a result on demand. Persisted per-tournament so a refresh keeps them.
let revealedMatches = new Set();
function revealKey() { const id = tourneyId(); return id ? 'faf_reveal_' + id : null; }
function loadRevealed() {
  revealedMatches = new Set();
  try { const raw = localStorage.getItem(revealKey()); if (raw) JSON.parse(raw).forEach(x => revealedMatches.add(x)); } catch (e) {}
}
function saveRevealed() {
  try { const k = revealKey(); if (k) localStorage.setItem(k, JSON.stringify(Array.from(revealedMatches))); } catch (e) {}
}
// form state preserved across re-renders
const F = { capSel: {}, signup: { name: '', rating: '', team: '' }, reg: { team: '', p: [] } };

// ---------- utils ----------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3200);
}

async function api(path, opts) {
  const res = await fetch(path, opts ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts)
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function tourneyId() {
  const m = location.pathname.match(/^\/t\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

// "Which rating counts, and as of when" - the two things a player most needs before signing up
// and most easily missed. One helper so the Game Setup box, the signup panel and the players tab
// can never drift apart. Returns '' when the tournament has no FAF-pulled rating.
function ratingSourceHtml(t) {
  const T2 = t || (typeof T !== 'undefined' ? T : null);
  if (!T2 || !T2.ratingType || T2.ratingType === 'none') return '';
  const when = T2.ratingDate
    ? 'as of ' + esc(fmtDate(new Date(T2.ratingDate).toISOString()))
    : 'at signup time';
  return 'Uses your <strong>' + esc(ratingTypeLabel(T2.ratingType)) + '</strong> rating, taken <strong>'
    + when + '</strong><span class="muted"> \u2014 pulled from FAF automatically</span>';
}
function ratingTypeLabel(rt) {
  return rt === 'global' ? 'Global' : rt === '1v1' ? '1v1 / ladder'
       : rt === 'rc' ? "Fearghal's RC (best of 2v2/3v3/4v4/Global, blended to 300 games)"
       : rt || 'Global';
}

// Cross-tournament "waiting on you" banner: join requests to approve, your draft pick,
// your veto turn, check-in. The current tournament is excluded (its own in-page banner covers it).
async function refreshPending() {
  let bar = document.getElementById('pendingBar');
  if (!bar) {
    const app = document.getElementById('app');
    if (!app || !app.parentNode) return;
    bar = document.createElement('div'); bar.id = 'pendingBar';
    app.parentNode.insertBefore(bar, app);
  }
  if (!fafAuth.enabled || !me()) { bar.innerHTML = ''; return; }
  let items = [], alert = null;
  try {
    const d = await (await fetch('/api/my/pending', { credentials: 'same-origin' })).json();
    items = (d && d.pending) || [];
    alert = (d && d.alert) || null;
  }
  catch (e) { bar.innerHTML = ''; return; }
  const cur = tourneyId();
  const shown = items.filter(it => it.tId !== cur);
  // The alert points at the console, so it's noise while you're already in it.
  if (alert && location.pathname === '/siteadmin') alert = null;
  if (!shown.length && !alert) { bar.innerHTML = ''; return; }
  let html = '';
  if (shown.length) {
    const it = shown[0];
    const more = shown.length > 1 ? '<span class="pending-more">+' + (shown.length - 1) + ' more</span>' : '';
    html += '<div class="pending-bar"><span class="pending-text">\u26A1 ' + esc(it.text) + ' \u2014 <strong>' + esc(it.tName) + '</strong></span>' +
      '<button class="btn small" id="pendingGo">Go</button>' + more + '</div>';
  }
  // Only this row gets a dismiss button. It waits on a decision the admin is allowed to defer,
  // unlike the turn-based rows above (map ban/pick, draft picks), which block someone else and
  // must stay put until acted on.
  if (alert) {
    html += '<div class="pending-bar pending-admin"><span class="pending-text">\uD83D\uDD14 ' + esc(alert.text) + '</span>' +
      '<button class="btn small" id="alertGo">Review</button>' +
      (alert.dismissible ? '<button class="pending-x" id="alertX" title="Hide this until a new request comes in" aria-label="Dismiss">\u00D7</button>' : '') + '</div>';
  }
  bar.innerHTML = html;
  const goBtn = bar.querySelector('#pendingGo');
  if (goBtn) goBtn.onclick = () => {
    const it = shown[0];
    history.pushState(null, '', '/t/' + it.tId + (it.tab && it.tab !== 'overview' ? '?tab=' + it.tab : ''));
    route();
  };
  const alGo = bar.querySelector('#alertGo');
  if (alGo) alGo.onclick = () => { saTab = 'requests'; history.pushState(null, '', '/siteadmin'); route(); };
  const alX = bar.querySelector('#alertX');
  if (alX) alX.onclick = async () => {
    try { await api('/api/my/dismiss_requests', {}); } catch (e) { toast(e.message, true); }
    refreshPending();
  };
}
// A site admin is now a FAF account linked via the master password. This reflects that
// linked state (from /auth/faf/me). It returns a truthy marker string when the current
// account is a site admin, so existing `admin: siteAdmin()` calls still send something —
// the server authenticates by session cookie regardless of the value.
function siteAdmin() { return (fafAuth.user && fafAuth.user.siteAdmin) ? 'siteadmin' : null; }
// Is this account ON the site-admin list, regardless of whether they currently have the powers
// switched on? Only the stand-down toggle itself may ask - everything else asks siteAdmin().
function siteAdminAccount() { return !!(fafAuth.user && fafAuth.user.siteAdminAccount); }
function adminStoodDown() { return !!(fafAuth.user && fafAuth.user.adminStandDown); }
// Switch site-admin powers off or on for THIS account, everywhere, until switched back.
// The server holds the flag, so it survives reloads and follows the account across devices -
// and, more importantly, the server genuinely stops honouring the powers rather than the page
// merely hiding the buttons.
async function setAdminStandDown(on) {
  try {
    await api('/auth/faf/stand_down', { on: on ? 1 : 0 });
  } catch (e) { return toast(e.message, true); }
  await refreshFafAuth();
  toast(on
    ? 'Site-admin powers OFF - you now see the site as a normal player'
    : 'Site-admin powers ON');
  route();
}
// The bar above is otherwise only drawn on navigation, so its "your turn to ban/pick" text
// could go stale while a veto progresses elsewhere. Keep it current.
setInterval(() => { try { refreshPending(); } catch (e) {} }, 30000);
// The tournament and chat polls stand down while the tab is hidden. Catch up the instant it comes
// back, so returning to the tab never shows a stale bracket or a missing message. The 30s alert
// poll above deliberately keeps running in the background: someone waiting on their veto turn
// should still get the banner with the tab tucked away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  try { refreshPending(); } catch (e) {}
  try { if (typeof pollOnce === 'function') pollOnce(); } catch (e) {}
  try { if (typeof _chatPollNow === 'function' && _chatPollNow) _chatPollNow(); } catch (e) {}
});
// FAF login state, populated by refreshFafAuth() on load. fafAuth = { enabled, user:{fafId,fafName}|null }
let fafAuth = { enabled: false, user: null };
// the effective logged-in name: a verified FAF session wins over the manual name
function me() {
  // Identity comes only from FAF login. There is no name-based login anymore.
  return (fafAuth.user && fafAuth.user.fafName) || '';
}
function isFafVerified() { return !!(fafAuth.user && fafAuth.user.fafName); }
async function refreshFafAuth() {
  try {
    const r = await fetch('/auth/faf/me', { credentials: 'same-origin' });
    if (r.ok) fafAuth = await r.json();
  } catch (e) { /* leave defaults */ }
}
function adminToken() {
  const id = tourneyId();
  return (id ? localStorage.getItem('admin_' + id) : null) || siteAdmin();
}
function capToken() {
  const id = tourneyId();
  return id ? localStorage.getItem('cap_' + id) : null;
}
function myToken() { return adminToken() || capToken(); }
// token for read-style calls (tournament GET, chat). Caster access used to ride on a
// `?streamer=<token>` share link; it is a FAF-account role now, so there is nothing to carry.
function viewToken() { return myToken(); }

const VALID_TABS = ['overview', 'news', 'chat', 'players', 'teams', 'bracket', 'bracket2', 'bracket3', 'bracket4', 'matches', 'stats', 'maps', 'vetoes', 'standings', 'predictions', 'admin', 'log'];
let pendingOrganizerClaim = null; // { id, token } — set when an ?admin= link is opened
function captureTokensFromURL() {
  const id = tourneyId();
  if (!id) return;
  const q = new URLSearchParams(location.search);
  if (q.get('admin')) {
    // still store for legacy bearer-token use (pre-go-live / site-admin-less operation)
    localStorage.setItem('admin_' + id, q.get('admin'));
    // and queue the "claim organizer" confirmation to run once the tournament loads
    pendingOrganizerClaim = { id, token: q.get('admin') };
  }
  if (q.get('late')) pendingLateSignup = { id, token: q.get('late') };
  const tab = q.get('tab');
  if (tab && VALID_TABS.indexOf(tab) >= 0) currentTab = tab;
  if (q.get('admin') || q.get('late') || q.get('tab')) {
    history.replaceState(null, '', '/t/' + id + (currentTab !== 'overview' ? '?tab=' + currentTab : ''));
  }
}
let pendingLateSignup = null; // { id, token } — set when a late-signup link is opened

function teamName(id) {
  if (!id || id === 'BYE') return null;
  const t = T.teams.find(x => x.id === id);
  return t ? t.name : '?';
}
function teamRating(tm) {
  if (!tm || !tm.playerIds) return 0;
  return tm.playerIds.reduce((s, pid) => { const p = T.players.find(x => x.id === pid); return s + (p && p.rating || 0); }, 0);
}
function teamSeed(id) {
  const t = T.teams.find(x => x.id === id);
  return t ? t.seed : null;
}
function playerName(id) {
  const p = T.players.find(x => x.id === id);
  return p ? p.name : '?';
}

function mapsFor(bracket, round) {
  const own = (T.maps && T.maps[bracket + ':' + round]) || [];
  // A 3rd place match with no maps of its own is played on the semi-finals' maps.
  if (bracket === '3p' && !own.length) return (T.maps && T.maps['wb:' + (round - 1)]) || [];
  return own;
}
// resolve a map id to its DB object (or null)
function mapObj(id) {
  if (!T.mapDb) return null;
  for (const m of T.mapDb) if (m.id === id) return m;
  return null;
}
// resolve a map id to its display name (falls back to the raw value for legacy string data)
function mapName(id) {
  const m = mapObj(id);
  return m ? m.name : (id || '');
}
// Which "Hidden Map N" a map is, for the organizer who can see the real name and still needs to
// know what the players are calling it. Same rule as the server: position among the secret maps
// in database order. Only meaningful to a viewer who gets the unfiltered list, i.e. map prep.
function secretNoOf(id) {
  let n = 0;
  for (const m of (T.mapDb || [])) {
    if (!m.secret) continue;
    n++;
    if (m.id === id) return n;
  }
  return 0;
}
// A map the server masked has no picture to show and never will until it is played, so the tile
// says so instead of the generic "no image" - which would read as an organizer who forgot one.
function mapNoImgLabel(m) { return (m && m.masked) ? 'HIDDEN' : 'no image'; }

// a clickable map chip that opens the map's image/description (if any)
function mapChip(id, cls) {
  const m = mapObj(id);
  const name = m ? m.name : (id || '');
  const hasInfo = m && (m.image || m.description);
  return '<span class="veto-map ' + (cls || '') + (hasInfo ? ' has-info' : '') + '"' + (hasInfo ? ' data-map-info="' + esc(id) + '"' : '') + '>' + esc(name) + '</span>';
}
// ---------- structured map spec ----------
// Spawn layout stored as data rather than free text. Rendered as labelled lines above the
// free-text description; a field left empty is omitted entirely rather than printed as "none",
// so an unused option adds no clutter.
const MAP_SPAWN_MAX = 16;
const MAP_SIZES = ['5x5', '10x10', '20x20', '40x40', '81x81'];
const MAP_SPEC_FIELDS = [
  ['t1', 'Spawns Team 1'],
  ['t2', 'Spawns Team 2'],
  ['closed', 'Closed Spawns'],
  ['closedMex', 'Closed Spawns Mex']
];
function mapSpecLines(m) {
  const s = m && m.spec;
  if (!s) return [];
  const out = [];
  for (const f of MAP_SPEC_FIELDS) {
    const v = s[f[0]];
    if (Array.isArray(v) && v.length) out.push(f[1] + ': ' + v.join(', '));
  }
  if (s.size) out.push('Mapsize: ' + s.size + ' km');
  return out;
}
// The spec lines plus the free-text description, as safe HTML. Either part may be absent.
function mapSpecHTML(m, cls) {
  const lines = mapSpecLines(m);
  const spec = lines.length ? '<div class="' + cls + '-spec">' + lines.map(l => esc(l)).join('<br>') + '</div>' : '';
  const desc = (m && m.description) ? '<div class="' + cls + '">' + esc(m.description) + '</div>' : '';
  return spec + desc;
}

// open a lightbox with the map's preview image (enlargeable) and description
function showMapInfo(id) {
  const m = mapObj(id);
  if (!m) return;
  const hasImg = !!m.image;
  const info = mapSpecHTML(m, 'map-desc');
  const body = `
    <h3>${esc(m.name)}</h3>
    ${hasImg ? `<img src="/map-images/${esc(m.image)}" alt="${esc(m.name)}" class="map-lightbox-img" id="mapBig">` : ''}
    ${info || '<p class="muted small">No description.</p>'}
    <div class="actions"><button class="btn ghost" id="miClose">Close</button></div>`;
  modal(body, root => {
    root.querySelector('#miClose').onclick = closeModal;
    const big = root.querySelector('#mapBig');
    if (big) big.onclick = () => window.open('/map-images/' + m.image, '_blank');
  });
}
// delegate clicks on any [data-map-info] element to the lightbox — but NOT on the veto
// action buttons (those perform the ban/pick; info is reachable from non-actionable chips)
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-map-info]');
  if (el && !el.hasAttribute('data-veto-map')) {
    const id = el.getAttribute('data-map-info');
    if (id && mapObj(id)) { e.preventDefault(); showMapInfo(id); }
  }
});

// With divisions a match label says which one: "PRINCE · SEMIS".
function roundLabel(m) {
  const core = roundLabelCore(m);
  return (m && m.division && divisionsOnT()) ? divisionNameOf(m.division).toUpperCase() + ' \u00b7 ' + core : core;
}
function roundLabelCore(m) {
  if (m.bracket === 'gf') return T.bracketType === 'swiss' ? 'FINAL' : 'GRAND FINAL';
  if (m.bracket === '3p') return '3RD PLACE MATCH';
  if (m.bracket === 'sw') return 'ROUND ' + m.round;
  if (m.bracket === 'ffa') {
    const maxR = Math.max.apply(null, T.matches.map(x => x.round));
    const cnt = T.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
    return (cnt === 1 && m.round === maxR && m.round > 1) ? 'FINAL' : 'ROUND ' + m.round;
  }
  if (m.bracket === 'lb') return 'LOSERS BRACKET R' + m.round;
  // wb - each division has its own number of rounds
  const R = (m.division && divisionsOnT())
    ? (T.matches || []).filter(x => x.bracket === 'wb' && (x.division || 0) === m.division).reduce((a, x) => Math.max(a, x.round || 0), 0) || 1
    : (T.rounds || 1);
  const prefix = T.bracketType === 'double' ? 'WINNERS BRACKET ' : '';
  if (m.round === R) return prefix + (T.bracketType === 'double' ? 'FINAL' : 'FINAL');
  if (m.round === R - 1) return prefix + 'SEMIS';
  if (m.round === R - 2) return prefix + 'QUARTERS';
  return prefix + 'ROUND ' + m.round;
}

function colLabel(bracket, r, totalRounds) {
  const R = totalRounds || T.rounds || 1;
  if (bracket === 'wb') {
    if (T.bracketType === 'double') {
      // double elim: winners bracket rounds are just numbered; last is the WB final
      return r === R ? 'WB FINAL' : 'ROUND ' + r;
    }
    // single elim: real finals nomenclature
    if (r === R) return 'FINAL';
    if (r === R - 1) return 'SEMI-FINAL';
    return 'ROUND ' + r;
  }
  if (bracket === 'lb') {
    // last LB round is the losers-bracket final (winner advances to the grand final)
    if (totalRounds && r === totalRounds) return 'LB FINAL';
    return 'LB ROUND ' + r;
  }
  if (bracket === '3p') return '3RD PLACE';
  return 'ROUND ' + r;
}

// combine <input type=date> + optional <input type=time> as a UTC instant.
// If no date, returns ''. If date but no time, returns the bare date (date-only, no tz).
function combineDateTimeUTC(dateEl, timeEl) {
  const dv = dateEl ? dateEl.value : '';
  if (!dv) return '';
  const tv = timeEl ? timeEl.value : '';
  if (!tv) return dv; // date only
  // dv = 'YYYY-MM-DD', tv = 'HH:MM' — treat as UTC
  return dv + 'T' + tv + ':00Z';
}
// split a stored UTC ISO / date-only value back into {date, time} strings for form inputs,
// expressed in UTC (so editing round-trips the stored UTC instant).
function splitDateTimeUTC(v) {
  if (!v) return { date: '', time: '' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, time: '' };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const p = n => (n < 10 ? '0' : '') + n;
  return {
    date: d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()),
    time: p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
  };
}

// ---------- timezone ----------
// preferred display timezone: stored IANA name, or 'auto' (browser), or 'UTC'
function prefTZ() {
  return localStorage.getItem('displayTZ') || 'auto';
}
// 24-hour (default) or 12-hour clock, per browser
function prefTimeFmt() { return localStorage.getItem('timeFmt') === '12' ? '12' : '24'; }
// date style: 'text' = 7 Jul 2026 (default), 'dmy' = 07/07/2026, 'ymd' = 2026-07-07
function prefDateFmt() {
  const v = localStorage.getItem('dateFmt');
  return (v === 'dmy' || v === 'ymd') ? v : 'text';
}
// render a Date in the chosen date style, in a given timezone
function fmtDatePart(d, tz) {
  const style = prefDateFmt();
  const opts = { timeZone: tz };
  if (style === 'ymd') {
    const p = new Intl.DateTimeFormat('en-CA', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, opts)).format(d);
    return p;                                   // en-CA gives YYYY-MM-DD
  }
  if (style === 'dmy') {
    return new Intl.DateTimeFormat('en-GB', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, opts)).format(d);
  }
  return new Intl.DateTimeFormat('en-GB', Object.assign({ day: 'numeric', month: 'short', year: 'numeric' }, opts)).format(d);
}
// render the time part in the chosen clock
function fmtTimePart(d, tz) {
  const h12 = prefTimeFmt() === '12';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12
  }).format(d);
}
function resolvedTZ() {
  const p = prefTZ();
  if (p === 'auto') { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  return p;
}
// short label for the currently resolved zone (e.g. "CEST", "UTC")
function tzAbbrev(date) {
  const tz = resolvedTZ();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date || new Date());
    const p = parts.find(x => x.type === 'timeZoneName');
    return p ? p.value : tz;
  } catch (e) { return tz; }
}
// format a UTC ISO/date-only string into the preferred zone, with date + time (if the value has a time)
function fmtDateTime(v, opts) {
  if (!v) return '';
  opts = opts || {};
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = dateOnly ? new Date(v + 'T00:00:00Z') : new Date(v);
  if (isNaN(d.getTime())) return '';
  const tz = resolvedTZ();
  try {
    if (dateOnly && !opts.forceTime) {
      // no time component was set; show date only, no tz
      return fmtDatePart(d, 'UTC');
    }
    const dateStr = fmtDatePart(d, tz);
    const timeStr = fmtTimePart(d, tz);
    return dateStr + ', ' + timeStr + ' ' + tzAbbrev(d);
  } catch (e) {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }
}
// does this stored value carry a time component (ISO datetime) vs a bare date?
function hasTime(v) { return !!v && !/^\d{4}-\d{2}-\d{2}$/.test(v); }

function fmtDate(v) {
  if (!v) return '';
  // v may be 'YYYY-MM-DD' (event date) or an ISO datetime (challonge)
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const p = v.split('-'); d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  else { d = new Date(v); }
  if (isNaN(d.getTime())) return '';
  try { return fmtDatePart(d, 'UTC'); } catch (e) {}
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
// ---- multi-day events ----
// `eventDays` is a sorted list of 'YYYY-MM-DD'. One day (or none) means a normal single-day
// event and every label below returns '' so nothing changes on screen.
function eventDayList(t) {
  const d = (t && t.eventDays) || [];
  return Array.isArray(d) && d.length > 1 ? d.slice().sort() : [];
}
function dayAddUTC(ymd, n) {
  const p = String(ymd).split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Group a sorted day list into contiguous runs, so "two weekends" reads as two ranges rather
// than four loose dates - which is the whole point of the feature.
function dayRuns(days) {
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && dayAddUTC(last[last.length - 1], 1) === d) last.push(d);
    else runs.push([d]);
  }
  return runs;
}
// "12-13 Sep 2026" / "12-13 & 19-20 Sep 2026" / "31 Dec 2026-1 Jan 2027". '' when single-day.
// Each endpoint carries only as much as it needs: the last always shows month and year, and any
// earlier one shows the month (and year) only when the NEXT endpoint differs. That is what keeps
// "30 Sep-1 Oct 2026" from reading "30 Sep-1 Oct Oct 2026".
function eventDaysLabel(t) {
  const days = eventDayList(t);
  if (!days.length) return '';
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const runs = dayRuns(days);
  // flatten to the endpoints actually printed, in order
  const ends = [];
  for (const run of runs) {
    ends.push(run[0]);
    if (run.length > 1) ends.push(run[run.length - 1]);
  }
  const fmt = (ymd, i) => {
    const [y, m, d] = String(ymd).split('-');
    const next = ends[i + 1];
    const isLast = i === ends.length - 1;
    const needYear = isLast || (next && next.slice(0, 4) !== y);
    const needMon = isLast || needYear || (next && next.slice(5, 7) !== m);
    return (+d) + (needMon ? ' ' + MON[+m - 1] : '') + (needYear ? ' ' + y : '');
  };
  let i = 0;
  return runs.map(run => {
    if (run.length === 1) return fmt(run[0], i++);
    const a = fmt(run[0], i++), b = fmt(run[run.length - 1], i++);
    return a + '\u2013' + b;
  }).join(' & ');
}
function eventDaysCountLabel(t) {
  const days = eventDayList(t);
  return days.length ? days.length + ' days' : '';
}

// A month calendar for picking the days an event runs on. Standard multi-select semantics, the
// ones people already know from a file manager:
//   click        - select just that day (and set it as the anchor)
//   shift+click  - select the whole range from the anchor to that day
//   ctrl/cmd+click - add or remove that one day, keeping the rest
// It is wired two-way to the existing native date input, which stays the accessible way to type
// a start date: typing there re-selects that single day, and the earliest day picked here is
// written back as the start date. All dates are handled in UTC, like the rest of the site.
function mountDayPicker(host, opts) {
  const o = opts || {};
  let days = (o.days || []).slice().sort();
  let anchor = days[0] || o.startDay || new Date().toISOString().slice(0, 10);
  let view = (days[0] || anchor).slice(0, 7);            // 'YYYY-MM' currently on screen
  const fire = () => { if (o.onChange) o.onChange(days.slice()); };

  const draw = () => {
    const [vy, vm] = view.split('-').map(Number);
    const first = new Date(Date.UTC(vy, vm - 1, 1));
    const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][vm - 1];
    // Monday-first grid
    const lead = (first.getUTCDay() + 6) % 7;
    const nDays = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
    const todayYmd = new Date().toISOString().slice(0, 10);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="dp-cell dp-empty"></span>';
    for (let d = 1; d <= nDays; d++) {
      const ymd = vy + '-' + String(vm).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const on = days.indexOf(ymd) >= 0;
      const cls = ['dp-cell'];
      if (on) cls.push('on');
      if (on && days[0] === ymd) cls.push('first');
      if (ymd === todayYmd) cls.push('today');
      cells += '<button type="button" class="' + cls.join(' ') + '" data-dp="' + ymd + '">' + d + '</button>';
    }
    host.innerHTML = `<div class="daypicker">
      <div class="dp-head">
        <button type="button" class="dp-nav" data-dpmove="-1" title="Previous month">\u2039</button>
        <span class="dp-title">${esc(monthName)} ${vy}</span>
        <button type="button" class="dp-nav" data-dpmove="1" title="Next month">\u203A</button>
      </div>
      <div class="dp-grid dp-dow">${['Mo','Tu','We','Th','Fr','Sa','Su'].map(x => '<span class="dp-cell dp-dowc">' + x + '</span>').join('')}</div>
      <div class="dp-grid">${cells}</div>
      <div class="dp-foot">
        <span class="dp-sum">${days.length > 1
          ? esc(eventDaysLabel({ eventDays: days })) + ' <span class="muted">(' + days.length + ' days)</span>'
          : (days.length ? esc(fmtDate(days[0])) + ' <span class="muted">(single day)</span>' : '<span class="muted">No day selected</span>')}</span>
        ${days.length > 1 ? '<button type="button" class="dp-clear" data-dpclear>Just the first day</button>' : ''}
      </div>
      <div class="dp-hint muted small">Click a day \u00b7 <strong>Shift</strong>+click for a range \u00b7 <strong>Ctrl</strong>/<strong>Cmd</strong>+click to add single days</div>
    </div>`;
    host.querySelectorAll('[data-dpmove]').forEach(b => b.onclick = (e) => {
      e.preventDefault();
      const n = +b.dataset.dpmove;
      const d = new Date(Date.UTC(vy, vm - 1 + n, 1));
      view = d.toISOString().slice(0, 7);
      draw();
    });
    const clr = host.querySelector('[data-dpclear]');
    if (clr) clr.onclick = (e) => { e.preventDefault(); days = days.slice(0, 1); draw(); fire(); };
    host.querySelectorAll('[data-dp]').forEach(b => b.onclick = (e) => {
      e.preventDefault();
      const ymd = b.dataset.dp;
      if (e.shiftKey && anchor) {
        const lo = anchor <= ymd ? anchor : ymd, hi = anchor <= ymd ? ymd : anchor;
        const range = [];
        for (let cur = lo; cur <= hi; cur = dayAddUTC(cur, 1)) {
          range.push(cur);
          if (range.length > 31) break;              // hard cap, matching the server
        }
        days = range;
      } else if (e.ctrlKey || e.metaKey) {
        const i = days.indexOf(ymd);
        if (i >= 0) { if (days.length > 1) days.splice(i, 1); }   // never leave zero days
        else days.push(ymd);
        days.sort();
        anchor = ymd;
      } else {
        days = [ymd];
        anchor = ymd;
      }
      draw();
      fire();
    });
  };

  draw();
  return {
    get: () => days.slice(),
    // called when the native date input changes: that day becomes the whole selection
    setSingle: (ymd) => {
      if (!ymd) return;
      days = [ymd]; anchor = ymd; view = ymd.slice(0, 7); draw();
    },
    showMonthOf: (ymd) => { if (ymd) { view = ymd.slice(0, 7); draw(); } }
  };
}

// the date to display + sort by for a tournament (imported: challonge date; else event date)
function tourneyDate(t) {
  return t.imported ? (t.challongeDate || t.eventDate) : (t.eventDate || null);
}
function tourneyDateMs(t) {
  const v = tourneyDate(t);
  if (!v) return 0;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// After signing up, nudge people who haven't set a Discord handle - organizers use it to reach
// them. Dismissible, and only shown once per browser so it never becomes nagging.
function maybeRemindDiscord() {
  if (!fafAuth.enabled || !fafAuth.user) return;
  if (fafAuth.user.discord) return;
  try { if (localStorage.getItem('faf_discord_nag') === '1') return; } catch (e) {}
  modal(`<h3>Add your Discord handle?</h3>
    <p>You're signed up. Organizers often need to reach players about lobbies, delays or substitutions \u2014 and right now they have no way to contact you.</p>
    <p class="muted small">You can add it any time from the account menu in the top right. It's optional, and only organizers and fellow players in your tournaments can see it.</p>
    <div class="actions">
      <button class="btn ghost" id="dnLater">Not now</button>
      <button class="btn primary" id="dnGo">Add it now</button>
    </div>`, root => {
    const stop = () => { try { localStorage.setItem('faf_discord_nag', '1'); } catch (e) {} };
    root.querySelector('#dnLater').onclick = () => { stop(); closeModal(); };
    root.querySelector('#dnGo').onclick = () => { stop(); closeModal(); if (typeof loginFlow === 'function') loginFlow(); };
  });
}

// Small, quiet unread marker for a chat room. Deliberately much less loud than the red @mention
// badge: a mention needs you personally, unread just means "something was said".
function unreadDot(room) {
  const n = (T.unreadByRoom && T.unreadByRoom[room]) || 0;
  if (!n) return '';
  return '<span class="unread-dot" title="' + n + ' unread message' + (n === 1 ? '' : 's') + '">' + (n > 9 ? '9+' : n) + '</span>';
}

// navigate within the SPA (pushState + re-route), used by series pages and in-app links
function nav(path) { history.pushState(null, '', path); route(); }

// Render a headline prize: symbol in front for USD/EUR, suffix for RUB, thousands separated.
const PRIZE_SYMBOLS = { USD: '$', EUR: '€', RUB: '₽' };
function formatPrize(p) {
  if (!p || !p.currency || p.amount == null) return '';
  const n = Number(p.amount);
  const num = isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(p.amount);
  const sym = PRIZE_SYMBOLS[p.currency] || '';
  return p.currency === 'RUB' ? (num + ' ' + sym) : (sym + num);
}

function statusLabel(s) {
  return { signup: 'Signups open', draft: 'Drafting', drafted: 'Teams locked', running: 'In progress', finished: 'Finished' }[s] || s;
}
// `status` is 'signup' from the moment a tournament is created, including while it is waiting for
// a scheduled opening time - so the pill claimed "Signups open" when the server would in fact
// refuse a signup. Anything drawing the status pill should use these two, not statusLabel alone.
function signupsNotOpenYet(t) {
  return !!(t && t.status === 'signup' && !t.abandoned && t.signupOpensAt
            && new Date(t.signupOpensAt).getTime() > Date.now());
}
function statusPillLabel(t) {
  if (!t) return '';
  if (t.abandoned) return 'ABANDONED';
  if (signupsNotOpenYet(t)) return 'Signups not open yet';
  return statusLabel(t.status);
}
function statusPillClass(t) {
  if (!t) return '';
  if (t.abandoned) return 'abandoned';
  return signupsNotOpenYet(t) ? 'presignup' : t.status;
}

// ---- divisions (King / Prince ...) ----
// Each division is its own bracket on its own tab: 'bracket' for division 1, 'bracket2'... after.
const DIVISION_DEFAULT_NAMES = ['King', 'Prince', 'Duke', 'Baron'];
function divisionsOnT(t) {
  t = t || T;
  return !!t && t.competition === 'team' && (t.bracketType === 'single' || t.bracketType === 'double') && (parseInt(t.divisions, 10) || 0) > 1;
}
function divisionNameOf(d, t) {
  t = t || T;
  const names = (t && t.divisionNames) || [];
  return names[d - 1] || DIVISION_DEFAULT_NAMES[d - 1] || ('Division ' + d);
}
function divisionChampionOf(d, t) { t = t || T; return ((t && t.divisionChampions) || [])[d - 1] || null; }
function divisionTeamsOf(d, t) { t = t || T; return ((t && t.teams) || []).filter(x => (x.division || 0) === d); }
function divisionTab(d) { return d <= 1 ? 'bracket' : 'bracket' + d; }
function isBracketTab(tab) { return /^bracket[2-4]?$/.test(tab || ''); }
function tabDivision(tab) { const m = /^bracket([2-4])$/.exec(tab || ''); return m ? parseInt(m[1], 10) : 1; }
// The tab a match is shown on.
function bracketTabFor(m) { return (m && m.division && divisionsOnT()) ? divisionTab(m.division) : 'bracket'; }
// How many teams a division is going to have, before its teams exist: what the split or the draft
// will produce. Null when nobody can know yet (captains still to be picked by hand).
function plannedDivisionSize(d, t) {
  t = t || T;
  const n = parseInt(t.divisions, 10) || 0;
  if (!(n > 1) || d < 1 || d > n) return null;
  const made = divisionTeamsOf(d, t).length;
  if (made || (t.teams || []).some(x => x.division)) return made;
  if (t.formation === 'draft') {
    if (d === 1) return parseInt(t.captainCount, 10) || null;
    const c = (t.divCaptains || []).find(x => x.division === d);
    return (c && c.mode !== 'manual' && c.count) ? c.count : null;
  }
  const total = (typeof projectedTeamCount === 'function') ? projectedTeamCount() : (t.teams || []).length;
  if (!total) return null;
  const top = parseInt(t.divisionTop, 10) || 0;
  if (n === 2 && top > 0 && top < total) return d === 1 ? top : total - top;
  const per = Math.ceil(total / n);
  return Math.max(0, Math.min(per, total - per * (d - 1)));
}
// How many rounds a division's bracket is shifted against the largest one. The round lengths are
// set for the largest division and a smaller one plays them aligned back from the final, so its
// round r takes the length - and the map pool - of the largest division's round r + offset.
// Mirrors poolRoundKey in lib/match.js.
function divisionRoundOffset(division) {
  if (!division || !divisionsOnT()) return 0;
  const wbRounds = d => (T.matches || []).filter(x => x.bracket === 'wb' && (x.division || 0) === d).reduce((a, x) => Math.max(a, x.round || 0), 0);
  if (T.cfg) {
    if (!T.cfg.divAlign) return 0;
    const R = (Array.isArray(T.cfg.wb) ? T.cfg.wb : (T.cfg.rounds || [])).length;
    return Math.max(0, R - wbRounds(division));
  }
  const lg = n => { let r = 0; while ((1 << r) < n) r++; return r; };
  let maxN = 0;
  for (let d = 1; d <= T.divisions; d++) maxN = Math.max(maxN, plannedDivisionSize(d) || 0);
  const nd = plannedDivisionSize(division) || 0;
  return (maxN && nd) ? Math.max(0, lg(maxN) - lg(nd)) : 0;
}
function poolRoundOf(bracket, round, division) {
  const off = divisionRoundOffset(division);
  if (!off || (bracket !== 'wb' && bracket !== 'lb')) return round;
  return round + (bracket === 'wb' ? off : 2 * off);
}
function divisionListText(t) {
  t = t || T;
  const n = parseInt(t.divisions, 10) || 0;
  const names = [];
  for (let d = 1; d <= n; d++) names.push(divisionNameOf(d, t));
  return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names.join('');
}

// ---- playing order ----
// When a match is played, as a number: sorting by it lists a tournament in the order it is played.
// The Swiss rounds come first, then its playoffs or final. In an elimination bracket the losers
// bracket interleaves with the winners bracket (its round 2k is played alongside winners round
// k+1, just after it), the 3rd place match goes just before the final and a grand final last.
// Divisions line up from their final, the way their match lengths do.
function matchChrono(m) {
  if (!m) return 0;
  const b = m.bracket, r = m.round || 0;
  if (b === 'sw' || b === 'ffa') return r;
  const base = (T && T.bracketType === 'swiss') ? 10000 : 0;
  if (b === 'gf') return base + 9999;
  const off = m.division ? divisionRoundOffset(m.division) : 0;
  const wbAt = x => (x <= 1 ? 0.5 : 2 * x - 2);
  if (b === 'lb') return base + r + 2 * off + 0.1;
  if (b === '3p') return base + wbAt(r + off) - 0.25;
  return base + wbAt(r + off);
}
// A copy of `list` in playing order (newest first when asked), top of the bracket first within a
// round. The order is worked out once per match, not once per comparison.
function sortByPlay(list, newestFirst) {
  const at = new Map();
  for (const m of list) at.set(m, matchChrono(m));
  return list.slice().sort((a, b) => (newestFirst ? at.get(b) - at.get(a) : at.get(a) - at.get(b)) || (a.index || 0) - (b.index || 0));
}

function typeLine(t) {
  // Challonge doesn't tell us the team size or our formation options, so don't fabricate a
  // format for an imported event - say where it came from and what Challonge called it.
  if (t.imported) {
    const src = t.importedType ? ' \u00b7 ' + t.importedType : '';
    return 'Imported from Challonge' + src + (t.standingsOnly ? ' \u00b7 results only' : '');
  }
  if (t.competition === 'ffa') {
    const sz = t.teamSize === 1 ? 'solo' : t.teamSize + '-player teams';
    const md = t.ffaCfg.mode === 'points' ? 'points' : 'knockout';
    return 'FFA ' + md + ' (' + sz + ', ' + t.ffaCfg.perMatch + ' per lobby)' + (t.maxTeams ? ' · max ' + t.maxTeams : '');
  }
  const bt = { single: 'single elim', double: 'double elim', swiss: 'swiss' }[t.bracketType];
  const swissTail = (t.bracketType === 'swiss' && stageTwoOn(t))
    ? ' \u2192 ' + (t.stage2.type === 'double' ? 'double' : 'single') + '-elim playoffs' : '';
  const form = t.teamSize === 1 ? '1v1' : t.teamSize + 'v' + t.teamSize + ' · ' + (t.formation === 'draft' ? 'captains draft' : t.formation === 'open' ? 'open teams' : 'premade');
  // A tournament created from a named preset says so: it is the format's identity, and only a
  // global tournament director can have made it.
  const head = t.presetName ? t.presetName + ' · ' : '';
  const divTail = divisionsOnT(t) ? ' \u00b7 ' + divisionListText(t) + ' brackets' : '';
  return head + form + ' · ' + bt + swissTail + divTail + (t.maxTeams ? ' · max ' + t.maxTeams + ' teams' : '');
}

// ---- declared early stop (qualifiers) ----
// A qualifier that will stop at N survivors must SAY SO from the moment the bracket appears,
// or the bracket lies: it draws a grand final that nobody is ever going to play.
function stopAtOf(t) { return parseInt(((t || T) || {}).stopAtAlive, 10) || 0; }
function stopAtLine(t) {
  t = t || T;
  const n = stopAtOf(t);
  if (!n) return '';
  return 'Ends when ' + n + ' are left \u2014 all ' + n + ' qualify, and the remaining matches are not played.';
}
// How many eliminations still to go. Null when there is no declared stop or it has happened.
function stopAtRemaining(t) {
  t = t || T;
  const n = stopAtOf(t);
  if (!n || t.status !== 'running') return null;
  const alive = (t.aliveCount != null) ? t.aliveCount : (t.teams || []).filter(x => !x.eliminated).length;
  return Math.max(0, alive - n);
}
// A match that was still outstanding when the tournament stopped was never played, and should
// not sit on the bracket looking like it is coming up.
function neverPlayed(m, t) {
  t = t || T;
  const ef = t.earlyFinish;
  if (!ef) return false;
  if (m.status === 'done' || m.status === 'bye') return false;
  return Array.isArray(ef.unplayed) ? ef.unplayed.indexOf(m.id) >= 0 : true;
}

// ---- Swiss record cuts + stage 2 (the LotS / Invitational format) ----
// Every helper here answers "off" for a tournament that did not configure them, so a normal
// Swiss or elimination event renders exactly as it did before any of this existed.
function swissCutCfg(t) {
  const tt = (t || T) || {};
  // The live cfg is the truth once the bracket exists; before that the plan is all there is,
  // and the format summary has to be able to describe a tournament that has not started.
  const c = (tt.cfg && (tt.cfg.winCut || tt.cfg.lossCut)) ? tt.cfg : (tt.cfg || tt.plan || {});
  const src = (c.winCut || c.lossCut) ? c : (tt.plan || {});
  const win = parseInt(src.winCut, 10) || 0;
  const loss = parseInt(src.lossCut, 10) || 0;
  return { on: !!(win || loss), win: win, loss: loss, decidingBo: parseInt(src.decidingBo, 10) || 0 };
}
// How many rounds this Swiss can run to - the same number lib/swiss.js derives, and the only
// one worth laying map pools out against.
// With record cuts the count is DERIVED (a 3/3 cut is five rounds: two wins, two losses and the
// game that settles it), never typed in, so `plan.rounds` is simply absent. Reading it and
// falling back to log2(teams) gave FOUR for a sixteen-player 3/3 stage, which is why round five
// had no column to set a pool in.
function swissPlannedRounds(t, n) {
  const tt = (t || T) || {};
  const c = swissCutCfg(tt);
  if (c.on) return (c.win && c.loss) ? (c.win + c.loss - 1) : (c.win || c.loss);
  const r = parseInt((tt.cfg || {}).rounds, 10) || parseInt((tt.plan || {}).rounds, 10) || 0;
  if (r) return r;
  const teams = n || (tt.teams || []).length || 0;
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))));
}
function swissCutLabel(t) {
  const c = swissCutCfg(t);
  if (!c.on) return '';
  const bits = [];
  if (c.win) bits.push(c.win + ' win' + (c.win === 1 ? '' : 's') + ' advances');
  if (c.loss) bits.push(c.loss + ' loss' + (c.loss === 1 ? '' : 'es') + ' eliminates');
  return bits.join(', ');
}
function stageTwoCfgOf(t) { const s = ((t || T) || {}).stage2; return (s && s.cutTo) ? s : null; }
function stageTwoOn(t) { return !!stageTwoCfgOf(t); }
// Is a playoff stage CONFIGURED (not necessarily built yet)? stageTwoLive answers "is it
// running"; this answers "is one coming", which is what decides whether the opponent-pick
// setting will ever fire on a Swiss.
function swissStageTwoPlanned(t) {
  const tt = (t || T) || {};
  if (tt.bracketType !== 'swiss') return false;
  if (tt.stage2) return true;
  const src = (tt.cfg && tt.cfg.stage2 !== undefined) ? tt.cfg : (tt.plan || {});
  return !!src.stage2;
}
function stageTwoLive(t) { const s = stageTwoCfgOf(t); return !!(s && s.built); }

// ---- the 3rd place match (single elimination, or single-elimination playoffs) ----
function thirdPlaceMatchOf(t) {
  return ((t || T).matches || []).find(m => m.bracket === '3p' && !(m.division || 0)) || null;
}
// Has anything happened in it that removing it would destroy? Mirrors lib/match thirdPlaceStarted.
function thirdPlaceTouched(m) {
  if (!m) return false;
  if (m.status === 'done' || m.status === 'live' || (Array.isArray(m.games) && m.games.length) || m.pendingReport) return true;
  if (m.veto && ((m.veto.stepIndex || 0) > 0 || (m.veto.banned || []).length || (m.veto.picks || []).length)) return true;
  // faction choices stay secret until both sides are done; a side that is done is a start
  if (m.fveto && m.fveto.games && Object.values(m.fveto.games).some(g => g && (g.t1Done || g.t2Done))) return true;
  return false;
}
// Can this tournament have one at all, right now? Single elimination without divisions, or a
// Swiss whose playoffs are single elimination - in both cases with at least four players in it.
function thirdPlaceEligible(t) {
  t = t || T;
  if (!t || t.competition === 'ffa' || t.imported) return false;
  if (t.bracketType === 'single') return !((t.divisions || 0) > 1) && (t.teams || []).length >= 4;
  if (t.bracketType !== 'swiss') return false;
  const s2 = stageTwoCfgOf(t);
  if (!s2 || s2.type === 'double') return false;
  return (s2.built ? (s2.field || []).length : s2.cutTo) >= 4;
}
// Is it switched on (built, or waiting for the bracket to be built)?
function thirdPlaceOn(t) {
  t = t || T;
  if (thirdPlaceMatchOf(t)) return true;
  if (t.bracketType === 'swiss') { const s2 = stageTwoCfgOf(t); return !!(s2 ? s2.thirdPlace : (t.plan && t.plan.s2Third)); }
  return !!((t.cfg && t.cfg.thirdPlace) || (!t.cfg && t.plan && t.plan.thirdPlace));
}
// The tab the bracket lives on. A Swiss is a list of rounds - until its playoffs exist, and then
// the playoff bracket is what is on top of that tab, so it is called what it is.
function bracketTabName(t) {
  t = t || T;
  if (t.competition === 'ffa') return 'Rounds';
  if (t.bracketType !== 'swiss') return 'Bracket';
  return (t.playoffs && t.playoffs.made) || stageTwoLive(t) ? 'Bracket' : 'Rounds';
}

// One client-side Swiss table, used by the standings tab and by any badge that needs a
// team's state. Mirrors lib/swiss.js swissRecord.
function swissTable(t) {
  t = t || T;
  const cuts = swissCutCfg(t);
  const S = {};
  for (const team of (t.teams || [])) S[team.id] = { id: team.id, w: 0, l: 0, gd: 0, byes: 0, played: 0, state: 'active' };
  for (const m of (t.matches || [])) {
    if (m.bracket !== 'sw') continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (S[id]) { S[id].w++; S[id].gd += 1; S[id].byes++; S[id].played++; }
    } else if (m.status === 'done') {
      const ws = m.winner === m.team1 ? m.score1 : m.score2;
      const ls = m.winner === m.team1 ? m.score2 : m.score1;
      if (S[m.winner]) { S[m.winner].w++; S[m.winner].gd += ws - ls; S[m.winner].played++; }
      if (S[m.loser]) { S[m.loser].l++; S[m.loser].gd -= ws - ls; S[m.loser].played++; }
    }
  }
  const quota = (t.cfg && t.cfg.rounds) || 0;
  for (const id of Object.keys(S)) {
    const r = S[id];
    if (cuts.on) {
      if (cuts.win && r.w >= cuts.win) r.state = 'advanced';
      else if (cuts.loss && r.l >= cuts.loss) r.state = 'eliminated';
      else if (quota && r.played >= quota) r.state = 'done';
    } else if (quota && r.played >= quota) r.state = 'done';
  }
  // The server sends the table in its own order (T.swissOrder) - that is the order the cut and the
  // playoff seeds come from, and its tiebreak can include a seeded coin flip this page cannot
  // repeat. The local sort is only a fallback for a view that does not carry the order.
  if (Array.isArray(t.swissOrder) && t.swissOrder.length) {
    const pos = {};
    t.swissOrder.forEach((id, i) => { pos[id] = i; });
    return Object.values(S).sort((a, b) => (pos[a.id] != null ? pos[a.id] : 1e9) - (pos[b.id] != null ? pos[b.id] : 1e9));
  }
  return Object.values(S).sort((a, b) => b.w - a.w || a.l - b.l || b.gd - a.gd || teamSeed(a.id) - teamSeed(b.id));
}
// How equal Swiss records are ordered, in words. One sentence, used wherever it is explained.
function swissTiebreakText(mode) {
  return mode === 'beaten'
    ? 'Equal records are ordered by the sum of the Swiss scores (wins) of the opponents each player beat, then at random.'
    : 'Equal records are ordered by game difference.';
}

// Each team's W-L as it stood going INTO `round` - i.e. the score group a pairing came out of.
// Mirrors recordsBefore in lib/swiss.js. It has to be the historical record, not the current
// one: by the time round 4 is over everyone in it has played round 4, so reading the standings
// would say 2-2 for a match that was a 2-1 pairing when it was drawn.
function swissRecordsBefore(round, t) {
  t = t || T;
  const out = {};
  for (const team of (t.teams || [])) out[team.id] = { w: 0, l: 0 };
  for (const m of (t.matches || [])) {
    if (m.bracket !== 'sw' || !(m.round < round)) continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (out[id]) out[id].w++;
    } else if (m.status === 'done') {
      if (out[m.winner]) out[m.winner].w++;
      if (out[m.loser]) out[m.loser].l++;
    }
  }
  return out;
}

// The score group a Swiss pairing came out of: "2-1" when both arrived on the same record, which
// is the normal case, and "2-1 vs 1-2" when an odd group floated its lowest player down into the
// next one. Null for anything that is not a head-to-head Swiss match.
function swissMatchRecord(m, t) {
  if (!m || m.bracket !== 'sw' || !m.round || m.round < 2) return null;
  if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') return null;
  const before = swissRecordsBefore(m.round, t);
  const a = before[m.team1], b = before[m.team2];
  if (!a || !b) return null;
  const lab = r => r.w + '-' + r.l;
  return lab(a) === lab(b) ? lab(a) : (lab(a) + ' vs ' + lab(b));
}

// Sort key for a round's matches: the score group they belong to, best first. A floated pairing
// is played in the LOWER group (that is where the float went), so it sorts with that one.
function swissMatchRank(m, t) {
  if (!m || m.bracket !== 'sw') return [-1, -1];
  const before = swissRecordsBefore(m.round, t);
  const a = before[m.team1] || { w: 0, l: 0 }, b = before[m.team2] || { w: 0, l: 0 };
  return [Math.min(a.w, b.w), Math.max(a.l, b.l)];
}
function swissQueueSort(list, t) {
  return list.slice().sort((x, y) => {
    const rx = swissMatchRank(x, t), ry = swissMatchRank(y, t);
    return (ry[0] - rx[0]) || (rx[1] - ry[1]) || ((x.index || 0) - (y.index || 0));
  });
}

function planSummary(t) {
  if (t.competition === 'ffa') {
    const c = t.ffaCfg;
    if (c.mode === 'points') {
      return c.rounds + ' round' + (c.rounds > 1 ? 's' : '') + ' · placement points each round' +
        (c.cutTo ? ' · cut to top ' + c.cutTo + ' after each round' : '') +
        (c.finalSize ? ' · top ' + c.finalSize + ' play a final lobby' : ' · highest points wins');
    }
    return 'Knockout · top ' + c.advance + ' advance' + (c.advance === 1 ? 's' : '') + ' from each lobby';
  }
  const p = t.plan;
  if (!p) return '';
  // Compact per-round rendering: "R1–2 Bo3 · R3 Bo5" — collapses consecutive equal Bo's.
  const compactRounds = (list, prefix) => {
    if (!Array.isArray(list) || !list.length) return '';
    const parts = [];
    let start = 0;
    for (let i = 1; i <= list.length; i++) {
      if (i === list.length || list[i] !== list[start]) {
        const label = (i - 1 === start) ? (prefix + (start + 1)) : (prefix + (start + 1) + '\u2013' + i);
        parts.push(label + ' Bo' + list[start]);
        start = i;
      }
    }
    return parts.join(' · ');
  };
  const third = thirdPlaceOn(t) ? ' \u00b7 3rd place match' : '';
  if (t.perRoundBo) {
    if (t.bracketType === 'single' && Array.isArray(p.roundsList) && p.roundsList.length) {
      return compactRounds(p.roundsList, 'R') + third;
    }
    if (t.bracketType === 'double' && (Array.isArray(p.wbList) || Array.isArray(p.lbList))) {
      const wb = compactRounds(p.wbList || [], 'WB R');
      const lb = compactRounds(p.lbList || [], 'LB R');
      return [wb, lb].filter(Boolean).join(' · ') + ' · GF Bo' + (p.gf || 5) + (p.lbHandicap ? ' (upper finalist starts 1-0 up)' : '');
    }
  }
  if (t.bracketType === 'single') return 'Bo' + p.early + ' rounds · Bo' + p.semi + ' semifinal · Bo' + p.final + ' final' + third;
  if (t.bracketType === 'double') return 'Winners bracket Bo' + p.wb + ' (final Bo' + p.wbFinal + ') · losers bracket Bo' + p.lb + ' (final Bo' + p.lbFinal + ') · grand final Bo' + p.gf + (p.lbHandicap ? ' (upper finalist starts 1-0 up)' : '');
  const cutTxt = swissCutLabel(t);
  const parts = ['Bo' + p.bo + ' matches'];
  if (cutTxt) {
    parts.push(cutTxt);
    if (p.decidingBo) parts.push('Bo' + p.decidingBo + ' when a win qualifies or a loss eliminates');
  }
  if (p.stage2) {
    parts.push('top ' + (p.s2CutTo || 8) + ' go to a ' + (p.s2Type === 'double' ? 'double' : 'single') + '-elimination playoff bracket'
      + (p.s2Type !== 'double' && thirdPlaceOn(t) ? ' with a 3rd place match' : ''));
  } else if (p.final) {
    parts.push('Bo' + p.finalBo + ' final between the top 2');
  } else if (!cutTxt) {
    parts.push('highest standing wins');
  }
  if (p.fast && !cutTxt) parts.push('fast pairing');
  return parts.join(' \u00b7 ');
}

function modal(html, onMount, opts) {
  const root = document.getElementById('modalRoot');
  const wide = opts && opts.wide ? ' modal-wide' : (opts && opts.mid ? ' modal-mid' : '');
  root.innerHTML = '<div class="modal-bg"><div class="modal' + wide + '">' + html + '</div></div>';
  root.querySelector('.modal-bg').addEventListener('mousedown', e => {
    if (e.target.classList.contains('modal-bg')) closeModal();
  });
  // pause background animations while the overlay covers the page (see style.css)
  document.body.classList.add('modal-open');
  if (onMount) onMount(root);
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
}

const BO_OPTS = [1, 3, 5, 7];
function boSelect(id, val) {
  return '<select id="' + id + '">' + BO_OPTS.map(o =>
    '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>Bo' + o + '</option>').join('') + '</select>';
}

// ---------- UI scale ----------

function applyScale() {
  const s = parseInt(localStorage.getItem('uiScale') || '100', 10);
  document.body.style.zoom = (s / 100);
}
const TZ_LIST = [
  ['auto', 'Automatic (your device)'],
  ['UTC', 'UTC'],
  ['Europe/London', 'London (GMT/BST)'],
  ['Europe/Berlin', 'Central Europe (Berlin, Paris)'],
  ['Europe/Athens', 'Eastern Europe (Athens, Helsinki)'],
  ['Europe/Moscow', 'Moscow'],
  ['America/New_York', 'US Eastern (New York)'],
  ['America/Chicago', 'US Central (Chicago)'],
  ['America/Denver', 'US Mountain (Denver)'],
  ['America/Los_Angeles', 'US Pacific (Los Angeles)'],
  ['America/Sao_Paulo', 'Brazil (Sao Paulo)'],
  ['Asia/Dubai', 'Gulf (Dubai)'],
  ['Asia/Kolkata', 'India (Kolkata)'],
  ['Asia/Shanghai', 'China (Shanghai)'],
  ['Asia/Tokyo', 'Japan (Tokyo)'],
  ['Australia/Sydney', 'Australia Eastern (Sydney)'],
  ['Pacific/Auckland', 'New Zealand (Auckland)']
];

function openSettings() {
  const s = parseInt(localStorage.getItem('uiScale') || '100', 10);
  const tz = prefTZ();
  const tzOpts = TZ_LIST.map(z => `<option value="${z[0]}"${z[0] === tz ? ' selected' : ''}>${esc(z[1])}</option>`).join('');
  modal(`
    <h3>Display settings</h3>
    <label>Time zone</label>
    <select id="tzSel" style="width:100%">${tzOpts}</select>
    <div class="muted small" style="margin-top:6px">Tournament times are stored in UTC and shown in this zone. Currently: <strong id="tzNow">${esc(resolvedTZ())} (${esc(tzAbbrev())})</strong></div>
    <label style="margin-top:16px">Date format</label>
    <select id="dfSel" style="width:100%">
      <option value="text"${prefDateFmt() === 'text' ? ' selected' : ''}>7 Jul 2026</option>
      <option value="dmy"${prefDateFmt() === 'dmy' ? ' selected' : ''}>07/07/2026 (DD/MM/YYYY)</option>
      <option value="ymd"${prefDateFmt() === 'ymd' ? ' selected' : ''}>2026-07-07 (YYYY-MM-DD)</option>
    </select>
    <label style="margin-top:16px">Time format</label>
    <select id="tfSel" style="width:100%">
      <option value="24"${prefTimeFmt() === '24' ? ' selected' : ''}>24-hour (18:30)</option>
      <option value="12"${prefTimeFmt() === '12' ? ' selected' : ''}>12-hour (6:30 pm)</option>
    </select>
    <div class="muted small" style="margin-top:6px">Preview: <strong id="fmtNow">${esc(fmtDateTime(new Date().toISOString()))}</strong></div>
    <label style="margin-top:18px">Keyboard shortcuts</label>
    <div class="muted small" style="margin-bottom:6px">Click a key, then press the one you want. These only change your own screen, and are ignored while you're typing.</div>
    <div class="hk-list" id="hkSettings">
      ${HOTKEY_ACTIONS.map(a => {
        const cur = hotkeyMap()[a.id];
        return `<div class="hk-row">
          <button class="hk-key" data-hkset="${a.id}">${cur ? esc(cur.toUpperCase()) : 'off'}</button>
          <span>${esc(a.label)}${a.note ? ' <span class="muted small">(' + esc(a.note) + ')</span>' : ''}</span>
          <button class="btn ghost small hk-clear" data-hkclear="${a.id}" title="Disable this shortcut">clear</button>
        </div>`;
      }).join('')}
    </div>
    <label style="margin-top:16px">UI scale — <span id="scaleVal">${s}%</span></label>
    <div class="scale-row">
      <span class="mono small">70</span>
      <input type="range" id="scaleRange" min="70" max="140" step="5" value="${s}">
      <span class="mono small">140</span>
    </div>
    <div class="actions">
      <button class="btn ghost" id="scaleReset">Reset</button>
      <button class="btn primary" id="scaleDone">Done</button>
    </div>`, root => {
    const range = root.querySelector('#scaleRange');
    range.oninput = () => {
      localStorage.setItem('uiScale', range.value);
      root.querySelector('#scaleVal').textContent = range.value + '%';
      applyScale();
    };
    root.querySelector('#tzSel').onchange = e => {
      localStorage.setItem('displayTZ', e.target.value);
      root.querySelector('#tzNow').textContent = resolvedTZ() + ' (' + tzAbbrev() + ')';
      root.querySelector('#fmtNow').textContent = fmtDateTime(new Date().toISOString());
    };
    root.querySelector('#dfSel').onchange = e => {
      localStorage.setItem('dateFmt', e.target.value);
      root.querySelector('#fmtNow').textContent = fmtDateTime(new Date().toISOString());
    };
    root.querySelector('#tfSel').onchange = e => {
      localStorage.setItem('timeFmt', e.target.value);
      root.querySelector('#fmtNow').textContent = fmtDateTime(new Date().toISOString());
    };
    // rebinding: arm a button, then capture the next single key
    let arming = null;
    const paintKeys = () => {
      const map = hotkeyMap();
      root.querySelectorAll('[data-hkset]').forEach(btn => {
        const id = btn.dataset.hkset;
        btn.textContent = arming === id ? 'press\u2026' : (map[id] ? map[id].toUpperCase() : 'off');
        btn.classList.toggle('arming', arming === id);
      });
    };
    root.querySelectorAll('[data-hkset]').forEach(btn => btn.onclick = () => {
      arming = arming === btn.dataset.hkset ? null : btn.dataset.hkset;
      paintKeys();
    });
    root.querySelectorAll('[data-hkclear]').forEach(btn => btn.onclick = () => {
      setHotkey(btn.dataset.hkclear, '');
      arming = null; paintKeys();
    });
    // capture happens on the modal itself so it can't leak to the global handler
    root.addEventListener('keydown', (ev) => {
      if (!arming) return;
      ev.preventDefault(); ev.stopPropagation();
      if (ev.key === 'Escape') { arming = null; paintKeys(); return; }
      const k = (ev.key || '').toLowerCase();
      // a single printable character only - no modifiers, no F-keys, no Space
      if (k.length !== 1 || !/[a-z0-9]/.test(k) || ev.ctrlKey || ev.metaKey || ev.altKey) {
        toast('Pick a single letter or number', true); return;
      }
      // don't let two actions share a key: clear the other one first
      const map = hotkeyMap();
      for (const a of HOTKEY_ACTIONS) if (a.id !== arming && map[a.id] === k) setHotkey(a.id, '');
      setHotkey(arming, k);
      arming = null; paintKeys();
    }, true);
    root.querySelector('#scaleReset').onclick = () => {
      localStorage.setItem('uiScale', '100');
      range.value = 100;
      root.querySelector('#scaleVal').textContent = '100%';
      applyScale();
    };
    root.querySelector('#scaleDone').onclick = () => { closeModal(); route(); };
  });
}

function drawTopbar(modeText) {
  const mode = siteAdmin() ? 'SITE ADMIN' : modeText;
  const loggedIn = isFafVerified() || !!me();
  topbarRight.innerHTML =
    '<button class="btn ghost small" id="navStart" title="Home">Overview</button>' +
    '<button class="btn ghost small" id="navHall" title="Hall of Fame">Hall of Fame</button>' +
    '<button class="btn ghost small" id="navSeries" title="Tournament series">Series</button>' +
    '<button class="btn ghost small" id="navFaq" title="FAQ / Rules">FAQ / Rules</button>' +
    '<button class="btn amber small" id="hostBtn" title="Host a tournament">Host tournament</button>' +
    ((siteAdmin() || (fafAuth.user && fafAuth.user.importer)) ? '<button class="btn ghost small" id="importBtn" title="Import a tournament from Challonge">Import</button>' : '') +
    (me()
      ? '<button class="btn ghost small" id="cmdrBtn" title="Your profile - set your Discord handle, log out">' + esc(me()) + (isFafVerified() ? ' \u2713' : '') + ((fafAuth.enabled && isFafVerified() && !(fafAuth.user && fafAuth.user.discord)) ? ' <span class="dcpill">\uD83D\uDCAC add Discord</span>' : '') + '</button>'
      : '<button class="btn primary small" id="cmdrBtn" title="Player login">Log in</button>') +
    // Roles are additive, not a precedence chain: someone who is both a director and an editor
    // must keep BOTH entry points. (Chaining these once hid the EDITOR button the moment an
    // editor was made a director, which looked exactly like losing FAQ access.)
    (() => {
      const u = fafAuth.user || {};
      const btns = [];
      if (siteAdmin()) btns.push('<button class="btn ghost small" id="saLink" title="Open the site admin console">SITE ADMIN</button>');
      else if (u.director) btns.push('<button class="btn ghost small" id="saLink" title="Open the tournament-director console">DIRECTOR</button>');
      // Directors can edit articles too, but via the console; only show EDITOR to actual editors.
      if (!siteAdmin() && u.editor) btns.push('<button class="btn ghost small" id="edLink" title="Open the articles editor">EDITOR</button>');
      if (!btns.length && mode) btns.push('<span>' + esc(mode) + '</span>');
      return btns.join('');
    })() +
    // Stand-down toggle. Shown to anyone ON the site-admin list, including while their powers
    // are off - otherwise switching off would be a one-way door. Separate from "View as player",
    // which is a per-tournament display toggle and changes no permissions at all.
    (siteAdminAccount()
      ? '<button class="btn ' + (adminStoodDown() ? 'amber' : 'ghost') + ' small" id="saPowerBtn" title="'
        + (adminStoodDown()
            ? 'Your site-admin powers are OFF. You are seeing the site exactly as a normal player, including map pools. Click to switch them back on.'
            : 'Your site-admin powers are ON. Click to switch them off site-wide, so you cannot see anything a normal player cannot.')
        + '">ADMIN ' + (adminStoodDown() ? 'OFF' : 'ON') + '</button>'
      : '') +
    '<button class="gearbtn" id="lockBtn" title="' + (siteAdmin() ? 'Open site admin console' : 'Link this account as site admin') + '">' + (siteAdmin() ? '\uD83D\uDD13' : '\uD83D\uDD12') + '</button>' +
    '<button class="gearbtn" id="gearBtn" title="Display settings">⚙</button>';
  document.getElementById('gearBtn').onclick = openSettings;
  { const sp = document.getElementById('saPowerBtn'); if (sp) sp.onclick = () => setAdminStandDown(!adminStoodDown()); }
  const saLink = document.getElementById('saLink');
  if (saLink) saLink.onclick = () => { history.pushState(null, '', '/siteadmin'); route(); };
  const edLink = document.getElementById('edLink');
  if (edLink) edLink.onclick = () => { history.pushState(null, '', '/editor'); route(); };
  const goTo = p => { history.pushState(null, '', p); route(); };
  document.getElementById('navStart').onclick = () => goTo('/');
  document.getElementById('navHall').onclick = () => goTo('/hall');
  { const ns = document.getElementById('navSeries'); if (ns) ns.onclick = () => goTo('/series'); }
  document.getElementById('navFaq').onclick = () => goTo('/faq');
  document.getElementById('lockBtn').onclick = () => {
    // Log in if logged out, log out if logged in. Opening the console is the "SITE ADMIN" link's job.
    siteAdminFlow();
  };
  document.getElementById('cmdrBtn').onclick = loginFlow;
  { const ib = document.getElementById('importBtn'); if (ib) ib.onclick = importFlow; }
  document.getElementById('hostBtn').onclick = async () => {
    // hosting requires FAF login (when configured)
    if (fafAuth.enabled && !isFafVerified() && !siteAdmin()) {
      toast('Log in with FAF to host a tournament', true);
      return requireLoginThen();
    }
    // ...and, once login is live, site-admin approval of the account
    if (fafAuth.enabled && !siteAdmin()) {
      let st = null;
      try { st = await (await fetch('/api/host_status')).json(); } catch (e) {}
      if (st && st.oauth && !st.allowed) return hostAccessFlow(st);
    }
    history.pushState(null, '', '/host'); route();
  };
}

// Ask the site admin for permission to host. Shown when an approved-only server turns
// someone away, so the next step is obvious rather than a dead end.
function hostAccessFlow(st) {
  if (st && st.pending) {
    return modal(`<h3>Request already sent</h3>
      <p class="muted small">Your request to host tournaments is waiting on the site admin. You'll be able to host as soon as it's approved.</p>
      <div class="actions"><button class="btn primary" id="haClose">OK</button></div>`, root => {
      root.querySelector('#haClose').onclick = closeModal;
    });
  }
  modal(`<h3>Request permission to host</h3>
    <p class="muted small">Hosting on this server is approved per FAF account. Send the site admin a short note about what you'd like to run and they'll take a look.</p>
    <label>Anything they should know? <span class="muted" style="font-weight:400">(optional)</span></label>
    <textarea id="haMsg" rows="3" maxlength="300" placeholder="e.g. I run the weekly 2v2 series and want to move it off Challonge"></textarea>
    <div class="actions">
      <button class="btn ghost" id="haCancel">Cancel</button>
      <button class="btn primary" id="haGo">Send request</button>
    </div>`, root => {
    root.querySelector('#haCancel').onclick = closeModal;
    root.querySelector('#haGo').onclick = async () => {
      try {
        await api('/api/host_request', { message: root.querySelector('#haMsg').value });
        closeModal();
        toast('Request sent — the site admin will review it');
      } catch (e) { toast(e.message, true); }
    };
  });
}

function importFlow() {
  if (!siteAdmin() && !(fafAuth.user && fafAuth.user.importer)) return toast('You don\u2019t have importer access', true);
  openImportWindow();
}

function openImportWindow() {
  modal(`<h3>Import from <span class="h2-strong">Challonge</span></h3>
    <p class="muted small">Pulls a completed Challonge tournament and adds it to the Completed list. Single &amp; double elimination.</p>
    <label>Challonge tournament link or ID</label>
    <input type="text" id="impUrl" placeholder="challonge.com/abc123" autocomplete="off" style="width:100%">
    <label>Your Challonge API key</label>
    <input type="password" id="impKey" placeholder="from challonge.com/settings/developer" autocomplete="off" style="width:100%">
    <div class="muted small" style="margin-top:6px">The key is sent once to fetch the data and is not stored.</div>
    <div class="actions"><button class="btn ghost" id="impWinCancel">Cancel</button><button class="btn primary" id="impWinGo">Import</button></div>`, root => {
    root.querySelector('#impWinCancel').onclick = closeModal;
    root.querySelector('#impWinGo').onclick = async () => {
      const urlv = root.querySelector('#impUrl').value.trim();
      const keyv = root.querySelector('#impKey').value.trim();
      if (!urlv) return toast('Enter the Challonge link or ID', true);
      if (!keyv) return toast('Enter your Challonge API key', true);
      const btn = root.querySelector('#impWinGo');
      btn.disabled = true; btn.textContent = 'Importing…';
      try {
        const r = await api('/api/import_challonge', { tournament: urlv, apiKey: keyv });
        closeModal();
        toast('Imported "' + r.name + '"');
        history.pushState(null, '', '/t/' + r.id);
        route();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false; btn.textContent = 'Import';
      }
    };
    setTimeout(() => { const el = root.querySelector('#impUrl'); if (el) el.focus(); }, 30);
  });
}

function loginFlow() {
  if (me()) {
    const curDc = (fafAuth.user && fafAuth.user.discord) || '';
    modal(`
      <h3>Your profile</h3>
      <p class="muted small">Logged in as <strong>${esc(me())}</strong> <span class="verifiedchip">FAF</span>. Signup forms use your FAF name.</p>
      <label>Discord handle <span class="muted small">(optional — shown to organizers and fellow signed-up players so they can reach you)</span></label>
      <p class="muted small" style="margin:4px 0 6px">Enter your Discord <strong>username</strong> — the unique all-lowercase handle shown under Settings → My Account in Discord — not your display name.</p>
      <input type="text" id="lgDiscord" maxlength="40" autocomplete="off" value="${esc(curDc)}">
      <div class="actions">
        <button class="btn ghost" id="lgClose">Close</button>
        <button class="btn primary" id="lgSaveDc">Save</button>
        <button class="btn danger" id="lgOut">Log out</button>
      </div>`, root => {
      root.querySelector('#lgClose').onclick = closeModal;
      root.querySelector('#lgSaveDc').onclick = async () => {
        try {
          await api('/api/my/profile', { discord: root.querySelector('#lgDiscord').value });
          await refreshFafAuth();
          closeModal(); toast('Saved'); route();
        } catch (e) { toast(e.message, true); }
      };
      root.querySelector('#lgOut').onclick = async () => {
        try { await fetch('/auth/faf/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
        fafAuth.user = null;
        closeModal(); route();
      };
    });
    return;
  }
  // Not logged in — FAF is the only way in.
  modal(`
    <h3>Log in</h3>
    <p class="muted small">Log in with your FAF account.</p>
    <button class="btn faf" id="lgFaf">Log in with FAF</button>
    <div class="actions"><button class="btn ghost" id="lgCancel">Cancel</button></div>`, root => {
    root.querySelector('#lgCancel').onclick = closeModal;
    root.querySelector('#lgFaf').onclick = () => {
      const returnTo = location.pathname + location.search;
      location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(returnTo);
    };
  });
}
let saTab = 'requests';
let saData = null;

async function renderSiteAdmin() {
  setTitle('Site admin');
  drawTopbar('');
  const app = document.getElementById('app');
  const isDirector = !!(fafAuth.user && fafAuth.user.director);
  if (!siteAdmin() && !isDirector) {
    // Being stood down is not the same as not being an admin, and saying "site admin only" to
    // someone who IS one would be baffling.
    app.innerHTML = adminStoodDown()
      ? `<div class="page"><div class="panel section"><h2>Powers are <span class="h2-strong">switched off</span></h2>
          <p class="muted small" style="margin:6px 0 12px">You are a site admin, but you have switched your powers off, so you are seeing the site exactly as a normal player would - map pools included. Switch them back on to use the console.</p>
          <button class="btn primary" id="saStandUp">Switch site-admin powers back on</button></div></div>`
      : `<div class="page"><div class="panel"><div class="empty">
          Site admin only - use the lock button in the top right to log in.</div></div></div>`;
    const su = document.getElementById('saStandUp');
    if (su) su.onclick = () => setAdminStandDown(false);
    return;
  }
  // Directors get the whole console EXCEPT Site Admins. Everything else here is at or below
  // what the role already carries (organizer rights on every official tournament, appointing
  // other directors); the site-admin list is the one real escalation, so it stays out.
  const director = !siteAdmin() && isDirector;
  const validTabs = director ? ['requests', 'directors', 'bans', 'logs', 'archived', 'articles'] : ['requests', 'siteadmins', 'directors', 'bans', 'logs', 'archived', 'articles'];
  if (validTabs.indexOf(saTab) < 0) saTab = validTabs[0];
  app.innerHTML = `<div class="page">
    <h1 style="margin:0 0 14px">Site admin${director ? ' <span class="muted" style="font-size:14px;font-weight:400">(tournament director)</span>' : ''}</h1>
    ${director ? '<p class="muted small" style="margin:-8px 0 12px">As a tournament director you have the whole console except <strong>Site Admins</strong>: access requests, the director roster, tournament bans, logs, archived tournaments and the FAQ / Rules articles.</p>' : ''}
    <div class="tabs" style="margin-bottom:14px">
      ${`<button class="tab ${saTab === 'requests' ? 'active' : ''}" data-satab="requests">Requests${(saData && ((saData.requests || []).filter(r => r.status === 'pending').length + (saData.editorRequests || []).filter(r => r.status === 'pending').length + (saData.importerRequests || []).filter(r => r.status === 'pending').length)) ? ' (' + ((saData.requests || []).filter(r => r.status === 'pending').length + (saData.editorRequests || []).filter(r => r.status === 'pending').length + (saData.importerRequests || []).filter(r => r.status === 'pending').length) + ')' : ''}</button>`}
      ${director ? '' : `<button class="tab ${saTab === 'siteadmins' ? 'active' : ''}" data-satab="siteadmins">Site Admins${(saData && (saData.siteAdmins || []).length) ? ' (' + saData.siteAdmins.length + ')' : ''}</button>`}
      <button class="tab ${saTab === 'directors' ? 'active' : ''}" data-satab="directors">Directors${(saData && (saData.directors || []).length) ? ' (' + saData.directors.length + ')' : ''}</button>
      <button class="tab ${saTab === 'bans' ? 'active' : ''}" data-satab="bans">Tournament bans${(saData && (saData.bans || []).length) ? ' (' + saData.bans.length + ')' : ''}</button>
      <button class="tab ${saTab === 'logs' ? 'active' : ''}" data-satab="logs">Logs</button>
      <button class="tab ${saTab === 'archived' ? 'active' : ''}" data-satab="archived">Archived${(saData && (saData.archived || []).length) ? ' (' + saData.archived.length + ')' : ''}</button>
      <button class="tab ${saTab === 'articles' ? 'active' : ''}" data-satab="articles">Articles</button>
    </div>
    <div id="saBody"><div class="panel"><div class="empty">Loading…</div></div></div>
  </div>`;
  app.querySelectorAll('[data-satab]').forEach(b => b.onclick = () => { saTab = b.dataset.satab; renderSiteAdmin(); });

  try {
    const r = await fetch('/api/siteadmin/data', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: siteAdmin() })
    });
    saData = await r.json();
    if (!r.ok) throw new Error(saData.error || 'Failed to load');
  } catch (e) {
    document.getElementById('saBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
    return;
  }
  const body = document.getElementById('saBody');
  if (saTab === 'requests') drawSaRequests(body);
  else if (saTab === 'siteadmins') drawSaSiteAdmins(body);
  else if (saTab === 'directors') drawSaDirectors(body);
  else if (saTab === 'bans') drawSaBans(body);
  else if (saTab === 'archived') drawSaArchived(body);
  else if (saTab === 'articles') drawSaArticles(body);
  else drawSaLogs(body);
}

// A small FAF-name search box shared by the Directors and Bans tabs. Resolves a name to a
// {fafId,name} via /api/admin_lookup, then calls onPick.
// Shared "add by FAF name or id" box. A purely numeric entry is taken as a FAF id directly
// (no lookup needed); anything else is resolved to an id via /api/admin_lookup by exact name.
function adminLookupBox(container, onPick, opts) {
  opts = opts || {};
  container.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap">
    <input type="text" class="alName" placeholder="FAF name or id" autocomplete="off" style="flex:1;min-width:200px">
    <button class="btn alGo">Look up</button></div>
  <div class="alResult muted small" style="margin-top:6px"></div>`;
  const name = container.querySelector('.alName');
  const result = container.querySelector('.alResult');
  const go = async () => {
    const v = name.value.trim();
    if (!v) return;
    // A bare number is a FAF id, but still ask the server so we get the real login back and
    // don't end up storing (and displaying) "FAF 123456".
    result.textContent = 'Looking up…';
    try {
      const payload = { name: v };
      if (opts.tournamentId) payload.tournamentId = opts.tournamentId;
      if (opts.seriesId) payload.seriesId = opts.seriesId;
      const rr = await fetch('/api/admin_lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await rr.json().catch(() => ({}));
      if (!rr.ok) throw new Error(d.error || 'Lookup failed');
      result.innerHTML = '';
      onPick(d, result);
    } catch (e) { result.textContent = e.message; }
  };
  container.querySelector('.alGo').onclick = go;
  name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
}

// One ban panel for all three scopes - the site-admin console (global), a tournament's Admin tab,
// and a series page. They differ only in wording and in where the two actions post to, so they
// share this rather than drifting into three near-identical tables.
// opts: { title, blurb, bans, lookup:{tournamentId|seriesId}, addLabel,
//         onSet({fafId,name,reason,expires}), onRemove(fafId), after() }
function banPanel(el, opts) {
  const bans = opts.bans || [];
  const today = new Date().toISOString().slice(0, 10);
  const active = bans.filter(b => !b.expired).length;
  let html = `<div class="panel section"><h2>${esc(opts.title)} <span class="h2-strong">(${active}${bans.length > active ? ' active, ' + (bans.length - active) + ' expired' : ''})</span></h2>
    <p class="muted small">${opts.blurb}</p>
    <div class="banAdd" style="margin:10px 0"></div>`;
  if (!bans.length) html += '<div class="empty">Nobody is banned.</div>';
  else html += '<div class="ban-table-wrap"><table class="ban-table"><thead><tr><th>Player</th><th>Reason</th><th>Banned by</th><th>Expires</th><th></th></tr></thead><tbody>' +
    bans.map(b => `<tr class="${b.expired ? 'ban-expired' : ''}">
      <td>${esc(b.name)} <span class="muted small">${esc(b.fafId)}</span></td>
      <td class="small">${esc(b.reason || '\u2014')}</td>
      <td class="small">${b.by ? esc(b.by) : '<span class="muted">\u2014</span>'}<div class="muted small">${b.at ? esc(fmtWhen(b.at)) : ''}</div></td>
      <td class="small"><input type="date" class="banExp" data-fid="${esc(b.fafId)}" data-name="${esc(b.name)}" value="${b.expires ? esc(b.expires.slice(0, 10)) : ''}">${b.expired ? ' <span class="idbadge late">expired</span>' : (b.expires ? '' : ' <span class="muted small">no expiry</span>')}</td>
      <td><button class="btn danger small" data-banrem="${esc(b.fafId)}">Lift ban</button></td>
    </tr>`).join('') + '</tbody></table></div>';
  html += '</div>';
  el.innerHTML = html;

  const done = async (msg) => { toast(msg); if (opts.after) await opts.after(); };
  adminLookupBox(el.querySelector('.banAdd'), (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)})
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
        <input type="text" class="bpReason" placeholder="Reason (optional)" maxlength="300" style="flex:1;min-width:180px">
        <label class="muted small">Expires <input type="date" class="bpExp" min="${today}"></label>
        <button class="btn danger small bpGo">${esc(opts.addLabel || 'Ban')}</button>
      </div>`;
    result.querySelector('.bpGo').onclick = async () => {
      try {
        await opts.onSet({ fafId: found.fafId, name: found.name,
          reason: result.querySelector('.bpReason').value,
          expires: result.querySelector('.bpExp').value || null });
        await done('Banned');
      } catch (e) { toast(e.message, true); }
    };
  }, opts.lookup || {});

  el.querySelectorAll('[data-banrem]').forEach(b => b.onclick = async () => {
    if (!confirm('Lift this ban?')) return;
    try { await opts.onRemove(b.dataset.banrem); await done('Ban lifted'); }
    catch (e) { toast(e.message, true); }
  });
  // changing the date in-place re-saves the same ban with a new expiry (blank = no expiry)
  el.querySelectorAll('.banExp').forEach(inp => inp.onchange = async () => {
    try {
      await opts.onSet({ fafId: inp.dataset.fid, name: inp.dataset.name, reason: '', expires: inp.value || null });
      await done(inp.value ? 'Expiry updated' : 'Expiry cleared');
    } catch (e) { toast(e.message, true); }
  });
}

function drawSaSiteAdmins(el) {
  const admins = saData.siteAdmins || [];
  const me = saData.me;
  let html = `<div class="panel section"><h2>Site Admins <span class="h2-strong">(${admins.length})</span></h2>
    <p class="muted small">Site admins have full control over every tournament and this console. Access is tied to a FAF account — a person links their account by entering the master password (lock icon, top right), which also always re-links them even if removed here. Add others by FAF name or id below.</p>
    <div id="saAdd" style="margin:10px 0"></div>`;
  if (!admins.length) html += '<div class="empty">No linked site admins yet.</div>';
  else html += '<div>' + admins.map(d => `<div class="sa-req">
    <div class="sa-req-main"><div class="sa-req-name">${esc(d.name)} <span class="muted small">FAF id ${esc(d.fafId)}</span>${d.fafId === me ? ' <span class="idbadge verified">you</span>' : ''}</div><div class="muted small">Linked ${esc(fmtWhen(d.at))}${d.by ? ' · by ' + esc(d.by) : ''}</div></div>
    <div class="sa-req-act"><button class="btn danger small" data-sarev="${esc(d.fafId)}">Remove</button></div>
  </div>`).join('') + '</div>';
  html += '</div>';
  el.innerHTML = html;
  adminLookupBox(el.querySelector('#saAdd'), (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="saGrantGo">Make site admin</button>`;
    result.querySelector('#saGrantGo').onclick = async () => {
      try { await saPost('siteadmin_grant', { fafId: found.fafId, name: found.name }); toast('Site admin added'); renderSiteAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
  el.querySelectorAll('[data-sarev]').forEach(b => b.onclick = async () => {
    const self = b.dataset.sarev === me;
    if (!confirm(self ? 'Remove YOUR OWN site-admin access? You can re-link with the password.' : 'Remove this site admin?')) return;
    try {
      await saPost('siteadmin_revoke', { fafId: b.dataset.sarev });
      toast('Removed');
      if (self) { await refreshFafAuth(); if (!siteAdmin()) { history.pushState(null, '', '/'); route(); return; } }
      renderSiteAdmin();
    } catch (e) { toast(e.message, true); }
  });
}

function drawSaDirectors(el) {
  const dirs = saData.directors || [];
  let html = `<div class="panel section"><h2>Global tournament directors <span class="h2-strong">(${dirs.length})</span></h2>
    <p class="muted small">Directors get organizer rights on every <strong>official</strong> tournament (not community ones), can <strong>see</strong> drafts of every tournament including community ones (without organizer rights on those), and get this console's Directors, Tournament bans, Logs, Archived and Articles tabs. Not Requests, and not Site Admins.</p>
    <p class="muted small">Directors can add and remove directors, so the team manages itself. Every change is logged with the name of whoever made it, and the last remaining director can't be removed.</p>
    <div id="dirAdd" style="margin:10px 0"></div>`;
  if (!dirs.length) html += '<div class="empty">No directors yet.</div>';
  else html += '<div>' + dirs.map(d => {
    const isMe = saData.me && d.fafId === saData.me;
    return `<div class="sa-req">
    <div class="sa-req-main"><div class="sa-req-name">${esc(d.name)} <span class="muted small">FAF id ${esc(d.fafId)}</span>${isMe ? ' <span class="idbadge verified">you</span>' : ''}</div><div class="muted small">Added ${esc(fmtWhen(d.at))}${d.by ? ' by ' + esc(d.by) : ''}</div></div>
    <div class="sa-req-act"><button class="btn danger small" data-dirrev="${esc(d.fafId)}"${isMe ? ' data-dirself="1"' : ''}>Remove</button></div>
  </div>`; }).join('') + '</div>';
  html += '</div>';
  el.innerHTML = html;
  adminLookupBox(el.querySelector('#dirAdd'), (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="dirGrantGo">Make director</button>`;
    result.querySelector('#dirGrantGo').onclick = async () => {
      try { await saPost('director_grant', { fafId: found.fafId, name: found.name }); toast('Director added'); renderSiteAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
  el.querySelectorAll('[data-dirrev]').forEach(b => b.onclick = async () => {
    // Standing yourself down is allowed, but it takes this console away from you, so say so.
    const msg = b.dataset.dirself
      ? 'Remove YOURSELF as a tournament director?\n\nYou will lose organizer rights on every official tournament and this console. Only a site admin can put you back.'
      : 'Remove this director? They will lose access to all official tournaments.';
    if (!confirm(msg)) return;
    try { await saPost('director_revoke', { fafId: b.dataset.dirrev }); toast('Removed'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
}

function drawSaBans(el) {
  banPanel(el, {
    title: 'Global tournament bans',
    blurb: "Banned accounts can't sign up, be added, or be invited to <strong>official</strong> tournaments (community tournaments are unaffected). This is the widest of the three scopes \u2014 organizers can also ban from a single tournament, and series owners from a whole series. Set an expiry date; it's changeable any time, and an expired ban stops applying automatically without losing the record of who set it.",
    bans: saData.bans || [],
    onSet: (r) => saPost('ban_set', r),
    onRemove: (fid) => saPost('ban_remove', { fafId: fid }),
    after: () => renderSiteAdmin()
  });
}

function drawSaRequests(el) {
  const reqs = saData.requests || [];
  const pending = reqs.filter(r => r.status === 'pending');
  const decided = reqs.filter(r => r.status !== 'pending');
  const allowed = saData.allowed || [];

  let html = '';
  if (!saData.oauth) {
    html += `<div class="panel section"><div class="muted small">FAF login isn't configured on this server yet, so hosting is open to everyone and nobody needs approval. This tab becomes active once the FAF environment variables are set.</div></div>`;
  }

  html += `<div class="panel section"><h2>Pending requests ${pending.length ? '(' + pending.length + ')' : ''}</h2>`;
  if (!pending.length) html += '<div class="empty">Nothing waiting.</div>';
  else html += pending.map(r => `<div class="sa-req">
      <div class="sa-req-main">
        <div class="sa-req-name">${esc(r.fafName)} <span class="muted small">FAF id ${esc(r.fafId)}</span></div>
        ${r.message ? `<div class="sa-req-msg">${esc(r.message)}</div>` : ''}
        <div class="muted small">${esc(fmtWhen(r.at))}</div>
      </div>
      <div class="sa-req-act">
        <button class="btn primary small" data-sadec="${r.id}" data-ok="1">Approve</button>
        <button class="btn ghost small" data-sadec="${r.id}" data-ok="0">Deny</button>
      </div>
    </div>`).join('');
  html += '</div>';

  html += `<div class="panel section">
    <h2 style="margin:0 0 8px">Allowed to host (${allowed.length})</h2>
    <p class="muted small" style="margin:0 0 8px">Add by FAF name or id:</p>
    <div id="saHostAdd" style="margin-bottom:10px"></div>`;
  if (!allowed.length) html += '<div class="empty" style="margin-top:10px">Nobody yet.</div>';
  else html += '<div class="pick-rows" style="margin-top:10px">' + allowed.map(a => `<div class="pick-row on" style="cursor:default">
      <span class="pr-name">${esc(a.name)} <span class="muted small">FAF id ${esc(a.fafId)}</span></span>
      <span class="muted small">${esc(fmtWhen(a.at))}</span>
      <button class="btn danger small" data-sarev="${esc(a.fafId)}">Revoke</button>
    </div>`).join('') + '</div>';
  html += '</div>';

  if (decided.length) {
    html += '<div class="panel section"><h2>Past decisions</h2><table><thead><tr><th>Who</th><th>Outcome</th><th>When</th></tr></thead><tbody>' +
      decided.map(r => `<tr><td>${esc(r.fafName)}</td><td class="${r.status === 'approved' ? 'ok-msg' : 'muted'}">${esc(r.status)}</td><td class="muted small">${esc(fmtWhen(r.decidedAt || r.at))}</td></tr>`).join('') +
      '</tbody></table></div>';
  }

  // ---- articles editor access (separate role: FAQ/Rules editing only) ----
  const edReqs = saData.editorRequests || [];
  const edPending = edReqs.filter(r => r.status === 'pending');
  const edDecided = edReqs.filter(r => r.status !== 'pending');
  const edAllowed = saData.editorAllowed || [];

  html += `<div class="panel section" style="border-left:3px solid var(--blue)">
    <h2>Articles editors</h2>
    <p class="muted small" style="margin:6px 0 10px">Editors can create and edit the public FAQ / Rules articles — nothing else. Share this link; people log in with FAF there and request access, which lands here for you to confirm:</p>
    <div class="copybox"><input type="text" readonly value="${location.origin}/editor"><button class="btn small" data-copy="${location.origin}/editor">Copy editor link</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Pending editor requests ${edPending.length ? '(' + edPending.length + ')' : ''}</h2>`;
  if (!edPending.length) html += '<div class="empty">Nothing waiting.</div>';
  else html += edPending.map(r => `<div class="sa-req">
      <div class="sa-req-main">
        <div class="sa-req-name">${esc(r.fafName)} <span class="muted small">FAF id ${esc(r.fafId)}</span> <span class="muted small">wants access to the articles</span></div>
        ${r.message ? `<div class="sa-req-msg">${esc(r.message)}</div>` : ''}
        <div class="muted small">${esc(fmtWhen(r.at))}</div>
      </div>
      <div class="sa-req-act">
        <button class="btn primary small" data-saeddec="${r.id}" data-ok="1">Approve</button>
        <button class="btn ghost small" data-saeddec="${r.id}" data-ok="0">Deny</button>
      </div>
    </div>`).join('');
  html += '</div>';

  html += `<div class="panel section">
    <h2 style="margin:0 0 8px">Approved editors (${edAllowed.length})</h2>
    <p class="muted small" style="margin:0 0 8px">Add by FAF name or id:</p>
    <div id="saEdAdd" style="margin-bottom:10px"></div>`;
  if (!edAllowed.length) html += '<div class="empty" style="margin-top:10px">Nobody yet.</div>';
  else html += '<div class="pick-rows" style="margin-top:10px">' + edAllowed.map(a => `<div class="pick-row on" style="cursor:default">
      <span class="pr-name">${esc(a.name)} <span class="muted small">FAF id ${esc(a.fafId)}</span></span>
      <span class="muted small">${esc(fmtWhen(a.at))}</span>
      <button class="btn danger small" data-saedrev="${esc(a.fafId)}">Revoke</button>
    </div>`).join('') + '</div>';
  html += '</div>';

  if (edDecided.length) {
    html += '<div class="panel section"><h2>Past editor decisions</h2><table><thead><tr><th>Who</th><th>Outcome</th><th>When</th></tr></thead><tbody>' +
      edDecided.map(r => `<tr><td>${esc(r.fafName)}</td><td class="${r.status === 'approved' ? 'ok-msg' : 'muted'}">${esc(r.status)}</td><td class="muted small">${esc(fmtWhen(r.decidedAt || r.at))}</td></tr>`).join('') +
      '</tbody></table></div>';
  }

  // ---- Challonge importer access (separate role: importing only) ----
  const imReqs = saData.importerRequests || [];
  const imPending = imReqs.filter(r => r.status === 'pending');
  const imDecided = imReqs.filter(r => r.status !== 'pending');
  const imAllowed = saData.importerAllowed || [];

  html += `<div class="panel section" style="border-left:3px solid var(--amber)">
    <h2>Tournament importers</h2>
    <p class="muted small" style="margin:6px 0 10px">Importers can pull completed tournaments in from Challonge — nothing else. Share this link; people log in with FAF there and request access, which lands here for you to confirm:</p>
    <div class="copybox"><input type="text" readonly value="${location.origin}/importer"><button class="btn small" data-copy="${location.origin}/importer">Copy importer link</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Pending importer requests ${imPending.length ? '(' + imPending.length + ')' : ''}</h2>`;
  if (!imPending.length) html += '<div class="empty">Nothing waiting.</div>';
  else html += imPending.map(r => `<div class="sa-req">
      <div class="sa-req-main">
        <div class="sa-req-name">${esc(r.fafName)} <span class="muted small">FAF id ${esc(r.fafId)}</span> <span class="muted small">wants importer access</span></div>
        ${r.message ? `<div class="sa-req-msg">${esc(r.message)}</div>` : ''}
        <div class="muted small">${esc(fmtWhen(r.at))}</div>
      </div>
      <div class="sa-req-act">
        <button class="btn primary small" data-saimdec="${r.id}" data-ok="1">Approve</button>
        <button class="btn ghost small" data-saimdec="${r.id}" data-ok="0">Deny</button>
      </div>
    </div>`).join('');
  html += '</div>';

  html += `<div class="panel section">
    <h2 style="margin:0 0 8px">Approved importers (${imAllowed.length})</h2>
    <p class="muted small" style="margin:0 0 8px">Add by FAF name or id:</p>
    <div id="saImAdd" style="margin-bottom:10px"></div>`;
  if (!imAllowed.length) html += '<div class="empty" style="margin-top:10px">Nobody yet.</div>';
  else html += '<div class="pick-rows" style="margin-top:10px">' + imAllowed.map(a => `<div class="pick-row on" style="cursor:default">
      <span class="pr-name">${esc(a.name)} <span class="muted small">FAF id ${esc(a.fafId)}</span></span>
      <span class="muted small">${esc(fmtWhen(a.at))}</span>
      <button class="btn danger small" data-saimrev="${esc(a.fafId)}">Revoke</button>
    </div>`).join('') + '</div>';
  html += '</div>';

  if (imDecided.length) {
    html += '<div class="panel section"><h2>Past importer decisions</h2><table><thead><tr><th>Who</th><th>Outcome</th><th>When</th></tr></thead><tbody>' +
      imDecided.map(r => `<tr><td>${esc(r.fafName)}</td><td class="${r.status === 'approved' ? 'ok-msg' : 'muted'}">${esc(r.status)}</td><td class="muted small">${esc(fmtWhen(r.decidedAt || r.at))}</td></tr>`).join('') +
      '</tbody></table></div>';
  }

  el.innerHTML = html;
  el.querySelectorAll('[data-sadec]').forEach(b => b.onclick = async () => {
    try {
      await saPost('decide', { id: b.dataset.sadec, approve: b.dataset.ok === '1' ? 1 : 0 });
      toast(b.dataset.ok === '1' ? 'Approved' : 'Denied');
      renderSiteAdmin();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-sarev]').forEach(b => b.onclick = async () => {
    if (!confirm('Revoke hosting rights for this account?')) return;
    try { await saPost('revoke', { fafId: b.dataset.sarev }); toast('Revoked'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-saeddec]').forEach(b => b.onclick = async () => {
    try {
      await saPost('editor_decide', { id: b.dataset.saeddec, approve: b.dataset.ok === '1' ? 1 : 0 });
      toast(b.dataset.ok === '1' ? 'Approved' : 'Denied');
      renderSiteAdmin();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-saedrev]').forEach(b => b.onclick = async () => {
    if (!confirm('Revoke articles access for this account?')) return;
    try { await saPost('editor_revoke', { fafId: b.dataset.saedrev }); toast('Revoked'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-saimdec]').forEach(b => b.onclick = async () => {
    try {
      await saPost('importer_decide', { id: b.dataset.saimdec, approve: b.dataset.ok === '1' ? 1 : 0 });
      toast(b.dataset.ok === '1' ? 'Approved' : 'Denied');
      renderSiteAdmin();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-saimrev]').forEach(b => b.onclick = async () => {
    if (!confirm('Revoke importer access for this account?')) return;
    try { await saPost('importer_revoke', { fafId: b.dataset.saimrev }); toast('Revoked'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied')));
  const edAdd = document.getElementById('saEdAdd');
  if (edAdd) adminLookupBox(edAdd, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="edGrantGo">Make editor</button>`;
    result.querySelector('#edGrantGo').onclick = async () => {
      try { await saPost('editor_grant', { fafId: found.fafId, name: found.name }); toast('Editor added'); renderSiteAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
  const imAdd = document.getElementById('saImAdd');
  if (imAdd) adminLookupBox(imAdd, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="imGrantGo">Make importer</button>`;
    result.querySelector('#imGrantGo').onclick = async () => {
      try { await saPost('importer_grant', { fafId: found.fafId, name: found.name }); toast('Importer added'); renderSiteAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
  const hostAdd = document.getElementById('saHostAdd');
  if (hostAdd) adminLookupBox(hostAdd, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="hostGrantGo">Allow to host</button>`;
    result.querySelector('#hostGrantGo').onclick = async () => {
      try { await saPost('grant', { fafId: found.fafId, name: found.name }); toast('Allowed to host'); renderSiteAdmin(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

const SA_ACTION_LABEL = {
  tournament_created: 'Created tournament',
  tournament_deleted: 'Deleted tournament',
  tournament_archived: 'Archived tournament',
  tournament_restored: 'Restored tournament',
  tournament_published: 'Published tournament',
  host_access_requested: 'Requested hosting access',
  host_access_granted: 'Granted hosting access',
  host_access_denied: 'Denied hosting access',
  host_access_revoked: 'Revoked hosting access'
};

// Render rich text safely (articles, briefing, rewards). Everything is HTML-escaped first,
// then a small markdown subset is applied:
//   **bold**  *italic*  __underline__  # / ## / ### headings  - bullet lines
//   [text](url) links (http/https)     ![alt](url) images (local upload dirs or http/https)
// Newlines are preserved via pre-wrap on the containers.
// Plain-text summary of a markdown body, for places that need one line rather than formatting
// (list previews). Strips the syntax instead of showing it raw.
function stripMd(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')     // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // links -> label
    .replace(/^#{1,6}\s+/gm, '')                    // headings
    .replace(/^[-*]\s+/gm, '')                      // bullets
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderArticleBody(text) {
  let s = esc(text || '');
  // images first so their ![..](..) doesn't get eaten by the link rule
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    if (/^\/(article|desc)-images\/[A-Za-z0-9_.%-]+$/.test(url) || /^https?:\/\/[^\s"'<>]+$/.test(url)) {
      return '<img src="' + url + '" alt="' + alt + '" class="art-img">';
    }
    return m;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    if (/^https?:\/\/[^\s"'<>]+$/.test(url)) return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
    return m;
  });
  s = s.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n][^_\n]*?)__/g, '<u>$1</u>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // line-level: headings and bullets (the trailing \n is consumed so pre-wrap doesn't double-space)
  s = s.replace(/^### (.*)$/gm, '<span class="art-h3">$1</span>');
  s = s.replace(/^## (.*)$/gm, '<span class="art-h2">$1</span>');
  s = s.replace(/^# (.*)$/gm, '<span class="art-h1">$1</span>');
  s = s.replace(/^- (.*)$/gm, '<span class="art-li">$1</span>');
  s = s.replace(/(<\/span>|<img[^>]*>)\n/g, '$1');
  return s;
}

// Formatting toolbar for rich-text textareas. Wraps the selection (or inserts a template)
// and keeps the caller's preview in sync via the textarea's input event.
function mdToolbarHTML() {
  return `<div class="md-toolbar">
    <button type="button" data-md="bold" title="Bold"><strong>B</strong></button>
    <button type="button" data-md="italic" title="Italic"><em>I</em></button>
    <button type="button" data-md="underline" title="Underline"><u>U</u></button>
    <button type="button" data-md="h1" title="Heading">H1</button>
    <button type="button" data-md="h2" title="Sub-heading">H2</button>
    <button type="button" data-md="list" title="Bullet list">\u2022 List</button>
    <button type="button" data-md="link" title="Link">\uD83D\uDD17 Link</button>
  </div>`;
}
function wireMdToolbar(root, ta) {
  const apply = (kind) => {
    const st = ta.selectionStart, en = ta.selectionEnd;
    const sel = ta.value.slice(st, en);
    let out, caretFromEnd = 0;
    if (kind === 'bold') out = '**' + (sel || 'bold text') + '**';
    else if (kind === 'italic') out = '*' + (sel || 'italic text') + '*';
    else if (kind === 'underline') out = '__' + (sel || 'underlined text') + '__';
    else if (kind === 'h1' || kind === 'h2') {
      const prefix = kind === 'h1' ? '# ' : '## ';
      const atLineStart = st === 0 || ta.value[st - 1] === '\n';
      out = (atLineStart ? '' : '\n') + prefix + (sel || 'Heading');
    } else if (kind === 'list') {
      const lines = (sel || 'item one\nitem two').split('\n');
      const atLineStart = st === 0 || ta.value[st - 1] === '\n';
      out = (atLineStart ? '' : '\n') + lines.map(l => '- ' + l).join('\n');
    } else if (kind === 'link') {
      out = '[' + (sel || 'link text') + '](https://)';
      caretFromEnd = 1;
    } else return;
    ta.value = ta.value.slice(0, st) + out + ta.value.slice(en);
    const pos = st + out.length - caretFromEnd;
    ta.selectionStart = ta.selectionEnd = pos;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  };
  root.querySelectorAll('[data-md]').forEach(b => b.onclick = (e) => { e.preventDefault(); apply(b.dataset.md); });
}

// Wire a textarea so pasted images (and an optional file-picker button) upload via
// `uploader(dataUrl) -> {url}` and insert an ![image](url) token at the cursor.
function wireImagePaste(ta, uploader, imgBtn, fileInput) {
  const insertAtCursor = (txt) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + txt.length;
    ta.dispatchEvent(new Event('input'));
    ta.focus();
  };
  const uploadImage = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read image')); r.readAsDataURL(file); });
      const d = await uploader(dataUrl);
      insertAtCursor('\n![image](' + d.url + ')\n');
      toast('Image added');
    } catch (err) { toast(err.message, true); }
  };
  ta.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) { e.preventDefault(); uploadImage(f); return; } }
    }
  });
  if (imgBtn && fileInput) {
    imgBtn.onclick = e => { e.preventDefault(); fileInput.click(); };
    fileInput.onchange = () => { uploadImage(fileInput.files[0]); fileInput.value = ''; };
  }
}

function drawSaArticles(el) {
  const arts = saData.articles || [];
  let html = `<div class="panel section"><div class="row" style="justify-content:space-between;align-items:center">
    <h2 style="margin:0">FAQ / Rules articles (${arts.length})</h2>
    <button class="btn primary small" id="saArtNew">+ New article</button></div>`;
  const active = arts.filter(a => !a.archived);
  const archived = arts.filter(a => a.archived);
  const childrenOf = (id) => active.filter(a => a.parentId === id);
  const top = active.filter(a => !a.parentId);
  const row = (a, isChild) => `<div class="sa-req" style="${isChild ? 'margin-left:24px;border-left:2px solid var(--line-solid)' : ''}">
      <div class="sa-req-main"><div class="sa-req-name">${isChild ? '\u21B3 ' : ''}${esc(a.title)}${isChild ? ' <span class="idbadge late">sub-page</span>' : ''}</div><div class="muted small">Updated ${esc(fmtWhen(a.updatedAt || a.createdAt))} \u00b7 <span class="mono">${esc(a.id)}</span></div></div>
      <div class="sa-req-act"><button class="btn ghost small" data-artedit="${a.id}">Edit</button><button class="btn ghost small" data-artarch="${a.id}">Archive</button></div>
    </div>`;
  if (!active.length) html += '<div class="empty" style="margin-top:10px">No articles yet. These show on the public Rules page. Make a top-level page, then attach sub-pages to it to keep things short.</div>';
  else html += '<div style="margin-top:10px">' + top.map(a => row(a, false) + childrenOf(a.id).map(c => row(c, true)).join('')).join('') + '</div>';
  html += '</div>';
  if (archived.length) {
    html += `<div class="panel section"><h2>Archived articles <span class="h2-strong">(${archived.length})</span></h2>
      <p class="muted small">Hidden from the public FAQ but kept. Restore to bring one back exactly as it was.</p>
      <div style="margin-top:10px">${archived.map(a => `<div class="sa-req" style="opacity:.8">
        <div class="sa-req-main"><div class="sa-req-name">${esc(a.title)}</div><div class="muted small">Archived ${esc(fmtWhen(a.archivedAt || a.updatedAt))} \u00b7 <span class="mono">${esc(a.id)}</span></div></div>
        <div class="sa-req-act"><button class="btn ghost small" data-artedit="${a.id}">Edit</button><button class="btn primary small" data-artrestore="${a.id}">Restore</button></div>
      </div>`).join('')}</div></div>`;
  }
  el.innerHTML = html;

  const editor = (art) => {
    modal(`<h3>${art ? 'Edit' : 'New'} article</h3>
      <label>Title</label>
      <input type="text" id="artTitle" maxlength="120" autocomplete="off" value="${art ? esc(art.title) : ''}">
      <label style="margin-top:12px">Parent page <span class="muted small">(optional \u2014 makes this a linked sub-page under another article)</span></label>
      <select id="artParent" style="width:100%">
        <option value="">\u2014 Top-level page \u2014</option>
        ${(saData.articles || []).filter(x => !x.parentId && (!art || (x.id !== art.id && !(saData.articles || []).some(k => k.parentId === (art && art.id))))).map(x => '<option value="' + x.id + '"' + (art && art.parentId === x.id ? ' selected' : '') + '>' + esc(x.title) + '</option>').join('')}
      </select>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px">
        <label style="margin:0">Body</label>
        <span class="muted small">Paste a screenshot straight in, or <a href="#" id="artImgBtn">insert an image</a>.</span>
      </div>
      ${mdToolbarHTML()}
      <textarea id="artBody" rows="16" style="width:100%;font-family:var(--mono);font-size:13px;line-height:1.5" placeholder="Write your rules / FAQ here. Paste images directly — they upload automatically.">${art ? esc(art.body) : ''}</textarea>
      <input type="file" id="artImgFile" accept="image/*" style="display:none">
      <div class="muted small" style="margin-top:14px;text-transform:uppercase;letter-spacing:1px">Preview</div>
      <div id="artPreview" class="ic-body art-preview"></div>
      <div class="actions"><button class="btn ghost" id="artCancel">Cancel</button><button class="btn primary" id="artSave">Save</button></div>`, root => {
      const ta = root.querySelector('#artBody');
      const prev = root.querySelector('#artPreview');
      const updatePreview = () => { prev.innerHTML = renderArticleBody(ta.value) || '<span class="muted small">Nothing yet.</span>'; };
      updatePreview();
      ta.addEventListener('input', updatePreview);
      wireMdToolbar(root, ta);

      const insertAtCursor = (txt) => {
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + txt + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + txt.length;
        updatePreview(); ta.focus();
      };
      const uploadImage = async (file) => {
        if (!file) return;
        try {
          const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read image')); r.readAsDataURL(file); });
          const d = await saPost('article_image', { image: dataUrl });
          insertAtCursor('\n![image](' + d.url + ')\n');
          toast('Image added');
        } catch (err) { toast(err.message, true); }
      };
      ta.addEventListener('paste', e => {
        const items = (e.clipboardData && e.clipboardData.items) || [];
        for (const it of items) {
          if (it.type && it.type.indexOf('image/') === 0) { const f = it.getAsFile(); if (f) { e.preventDefault(); uploadImage(f); return; } }
        }
      });
      const fileInput = root.querySelector('#artImgFile');
      root.querySelector('#artImgBtn').onclick = e => { e.preventDefault(); fileInput.click(); };
      fileInput.onchange = () => { uploadImage(fileInput.files[0]); fileInput.value = ''; };

      root.querySelector('#artCancel').onclick = closeModal;
      root.querySelector('#artSave').onclick = async () => {
        const title = root.querySelector('#artTitle').value.trim();
        if (!title) return toast('Title required', true);
        const parentId = root.querySelector('#artParent').value || null;
        try { await saPost('article_save', art ? { id: art.id, title, body: ta.value, parentId } : { title, body: ta.value, parentId }); closeModal(); toast('Saved'); saRefresh(); }
        catch (e) { toast(e.message, true); }
      };
    }, { wide: true });
  };
  const nb = document.getElementById('saArtNew'); if (nb) nb.onclick = () => editor(null);
  el.querySelectorAll('[data-artedit]').forEach(b => b.onclick = () => editor(arts.find(a => a.id === b.dataset.artedit)));
  el.querySelectorAll('[data-artarch]').forEach(b => b.onclick = async () => {
    if (!confirm('Archive this article? It will be hidden from the public FAQ but can be restored.')) return;
    try { await saPost('article_delete', { id: b.dataset.artarch }); toast('Archived'); saRefresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-artrestore]').forEach(b => b.onclick = async () => {
    try { await saPost('article_delete', { id: b.dataset.artrestore, restore: 1 }); toast('Restored'); saRefresh(); }
    catch (e) { toast(e.message, true); }
  });
}

function drawSaArchived(el) {
  const arch = saData.archived || [];
  let html = `<div class="panel section"><h2>Archived tournaments (${arch.length})</h2>
    <p class="muted small" style="margin:6px 0 10px">Archived by organizers and hidden from the public. Restore to bring one back to where it was, or delete it permanently.</p>`;
  if (!arch.length) html += '<div class="empty">Nothing archived.</div>';
  else html += '<table><thead><tr><th>Name</th><th>Status</th><th>Players</th><th>Archived</th><th></th></tr></thead><tbody>' +
    arch.map(t => `<tr><td>${esc(t.name)}</td><td class="muted">${esc(t.status)}</td><td class="muted">${t.players}</td><td class="muted small">${esc(fmtWhen(t.at))}</td>
      <td style="white-space:nowrap"><button class="btn primary small" data-sarestore="${t.id}">Restore</button><button class="btn danger small" data-sadelperm="${t.id}" style="margin-left:6px">Delete</button></td></tr>`).join('') +
    '</tbody></table>';
  html += '</div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-sarestore]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + b.dataset.sarestore + '/restore', { admin: siteAdmin() }); toast('Restored'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-sadelperm]').forEach(b => b.onclick = async () => {
    if (!confirm('Permanently delete this archived tournament? This cannot be undone.')) return;
    try { await api('/api/t/' + b.dataset.sadelperm + '/delete', { admin: siteAdmin() }); toast('Deleted'); renderSiteAdmin(); }
    catch (e) { toast(e.message, true); }
  });
}

function drawSaLogs(el) {
  const logs = saData.logs || [];
  const rows = logs.map(l => {
    const what = SA_ACTION_LABEL[l.action] || l.action;
    const target = l.tournamentName ? esc(l.tournamentName) : (l.detail ? esc(l.detail) : '\u2014');
    const cls = l.action === 'tournament_deleted' ? 'log-del' : (l.action === 'tournament_created' ? 'log-new' : '');
    return `<tr>
      <td class="muted small mono">${esc(fmtWhen(l.at))}</td>
      <td class="${cls}">${esc(what)}</td>
      <td>${target}</td>
      <td>${esc(l.actorName || '')} ${l.actorFafId ? '<span class="muted small">(' + esc(l.actorFafId) + ')</span>' : '<span class="muted small">' + esc(l.actorKind) + '</span>'}</td>
      <td class="muted small mono">${esc(l.ip || '')}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div class="panel section">
    <h2>Audit log</h2>
    <p class="muted small">Newest first. Records who created and deleted tournaments, and hosting-access decisions. Keeps the most recent 5000 entries.</p>
    ${logs.length ? `<table class="sa-log"><thead><tr><th style="width:150px">When</th><th style="width:190px">Action</th><th>Tournament</th><th style="width:200px">Who</th><th style="width:120px">IP</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Nothing logged yet.</div>'}
  </div>`;
}

async function saPost(action, body) {
  const r = await fetch('/api/siteadmin/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ password: siteAdmin() }, body))
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Failed');
  return d;
}

// The articles UI lives on two pages: the site admin console and the /editor page
// for approved editors. After an article action, redraw whichever one we're on.
function saRefresh() {
  if (location.pathname === '/editor') renderEditor();
  else renderSiteAdmin();
}

// ---------- /editor: articles editing for approved FAF accounts ----------
// Approval flow mirrors hosting access: log in with FAF, request access, the
// site admin confirms it on the Requests tab. Dormant until FAF login is live.
async function renderEditor() {
  setTitle('Articles editor');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = `<div class="page">
    <h1 style="margin:0 0 14px">FAQ / Rules articles</h1>
    <div id="saBody"><div class="panel"><div class="empty">Loading…</div></div></div>
  </div>`;
  const body = document.getElementById('saBody');

  // Site admins can use the console's Articles tab; still allow this page via password.
  if (siteAdmin()) {
    try {
      const r = await fetch('/api/siteadmin/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: siteAdmin() })
      });
      saData = await r.json();
      if (!r.ok) throw new Error(saData.error || 'Failed to load');
      return drawSaArticles(body);
    } catch (e) {
      body.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
      return;
    }
  }

  // Tournament directors may edit articles too (the server allows it, and the director console
  // has an Articles tab). Honour /editor for them instead of showing a "request access" screen.
  if (fafAuth.user && fafAuth.user.director) {
    try {
      const r = await fetch('/api/siteadmin/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
      saData = await r.json();
      if (!r.ok) throw new Error(saData.error || 'Failed to load');
      return drawSaArticles(body);
    } catch (e) {
      body.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
      return;
    }
  }

  let st = null;
  try { st = await (await fetch('/api/editor_status')).json(); } catch (e) {}
  if (!st || !st.oauth) {
    body.innerHTML = '<div class="panel"><div class="empty">FAF login isn\'t configured on this server yet, so editor accounts can\'t be confirmed. Ask the site admin.</div></div>';
    return;
  }
  if (!st.loggedIn) {
    body.innerHTML = `<div class="panel section"><h2>Log in first</h2>
      <p class="muted small">Editing the FAQ / Rules articles is tied to your FAF account. Log in, then request access here — the site admin confirms it.</p>
      <button class="btn primary" id="edLogin">Log in with FAF</button></div>`;
    document.getElementById('edLogin').onclick = () => {
      location.href = '/auth/faf/login?returnTo=' + encodeURIComponent('/editor');
    };
    return;
  }
  if (st.allowed) {
    try {
      const r = await fetch('/api/siteadmin/data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      saData = await r.json();
      if (!r.ok) throw new Error(saData.error || 'Failed to load');
      return drawSaArticles(body);
    } catch (e) {
      body.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
      return;
    }
  }
  if (st.pending) {
    body.innerHTML = `<div class="panel section"><h2>Request sent</h2>
      <p class="muted small">Your request for articles access is waiting for the site admin. This page unlocks once it\'s approved.</p></div>`;
    return;
  }
  body.innerHTML = `<div class="panel section"><h2>Request articles access</h2>
    <p class="muted small">Logged in as <strong>${esc(st.name || '')}</strong>. Articles access lets you edit the public FAQ / Rules pages — nothing else. The site admin confirms each account.</p>
    <label>Message <span class="muted small">(optional)</span></label>
    <input type="text" id="edMsg" maxlength="300" autocomplete="off" placeholder="Who are you / why do you need access?">
    <div style="margin-top:12px"><button class="btn primary" id="edReq">Request access</button></div></div>`;
  document.getElementById('edReq').onclick = async () => {
    try {
      await api('/api/editor_request', { message: document.getElementById('edMsg').value });
      toast('Request sent');
      renderEditor();
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- /importer: Challonge importer access for approved FAF accounts ----------
// Same approval flow as /editor: log in with FAF, request access, a site admin confirms it.
async function renderImporter() {
  setTitle('Tournament importer');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = `<div class="page">
    <h1 style="margin:0 0 14px">Import tournaments</h1>
    <div id="impBody"><div class="panel"><div class="empty">Loading…</div></div></div>
  </div>`;
  const body = document.getElementById('impBody');

  // Site admins always have importer access. Render the panel as well as opening the dialog,
  // so closing the dialog leaves a usable page instead of a blank one.
  if (siteAdmin()) {
    body.innerHTML = `<div class="panel section"><h2>You have importer access</h2>
      <p class="muted small">Site admins can always import. Pull a completed tournament in from Challonge.</p>
      <button class="btn primary" id="impOpen">Import from Challonge</button></div>`;
    document.getElementById('impOpen').onclick = openImportWindow;
    openImportWindow();
    return;
  }

  let st = null;
  try { st = await (await fetch('/api/importer_status')).json(); } catch (e) {}
  if (!st || !st.oauth) {
    body.innerHTML = '<div class="panel"><div class="empty">FAF login isn\'t configured on this server yet, so importer accounts can\'t be confirmed. Ask the site admin.</div></div>';
    return;
  }
  if (!st.loggedIn) {
    body.innerHTML = `<div class="panel section"><h2>Log in first</h2>
      <p class="muted small">Importing is tied to your FAF account. Log in, then request access here — a site admin confirms it.</p>
      <button class="btn primary" id="impLogin">Log in with FAF</button></div>`;
    document.getElementById('impLogin').onclick = () => {
      location.href = '/auth/faf/login?returnTo=' + encodeURIComponent('/importer');
    };
    return;
  }
  if (st.allowed) {
    body.innerHTML = `<div class="panel section"><h2>You have importer access</h2>
      <p class="muted small">Logged in as <strong>${esc(st.name || '')}</strong>. You can pull completed tournaments from Challonge.</p>
      <button class="btn primary" id="impOpen">Import from Challonge</button></div>`;
    document.getElementById('impOpen').onclick = openImportWindow;
    return;
  }
  if (st.pending) {
    body.innerHTML = `<div class="panel section"><h2>Request sent</h2>
      <p class="muted small">Your request for importer access is waiting for the site admin. This unlocks once it's approved.</p></div>`;
    return;
  }
  body.innerHTML = `<div class="panel section"><h2>Request importer access</h2>
    <p class="muted small">Logged in as <strong>${esc(st.name || '')}</strong>. Importer access lets you pull completed tournaments in from Challonge — nothing else. A site admin confirms each account.</p>
    <label>Message <span class="muted small">(optional)</span></label>
    <input type="text" id="impMsg" maxlength="300" autocomplete="off" placeholder="Who are you / why do you need access?">
    <div style="margin-top:12px"><button class="btn primary" id="impReq">Request access</button></div></div>`;
  document.getElementById('impReq').onclick = async () => {
    try {
      await api('/api/importer_request', { message: document.getElementById('impMsg').value });
      toast('Request sent');
      renderImporter();
    } catch (e) { toast(e.message, true); }
  };
}

function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function siteAdminFlow() {
  if (siteAdmin()) {
    // already a linked site admin — the lock button just opens the console
    history.pushState(null, '', '/siteadmin');
    route();
    return;
  }
  if (fafAuth.enabled && !isFafVerified()) {
    modal(`<h3>Site admin</h3>
      <p class="muted small">Site admin is now tied to your FAF account. Log in with FAF first, then enter the password to link this account.</p>
      <div class="actions"><button class="btn ghost" id="saCancel">Cancel</button><button class="btn faf" id="saLogin">Log in with FAF</button></div>`, root => {
      root.querySelector('#saCancel').onclick = closeModal;
      root.querySelector('#saLogin').onclick = () => { location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(location.pathname); };
    });
    return;
  }
  modal(`
    <h3>Link this account as site admin</h3>
    <p class="muted small">Enter the master password to link <strong>${esc((fafAuth.user && fafAuth.user.fafName) || 'your account')}</strong> as a site admin. You'll stay a site admin from then on (managed under the Site Admins tab); the password can always re-link you.</p>
    <label>Password</label>
    <input type="password" id="saPass" autocomplete="off">
    <div class="actions">
      <button class="btn ghost" id="saCancel">Cancel</button>
      <button class="btn primary" id="saGo">Link account</button>
    </div>`, root => {
    const inp = root.querySelector('#saPass');
    inp.focus();
    const go = async () => {
      try {
        await api('/api/siteadmin', { password: inp.value });
        await refreshFafAuth();          // refresh the linked flag
        closeModal();
        toast('This account is now a site admin');
        history.pushState(null, '', '/siteadmin');
        route();
      } catch (e) { toast(e.message, true); }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    root.querySelector('#saCancel').onclick = closeModal;
    root.querySelector('#saGo').onclick = go;
  });
}


// ---------------------------------------------------------------------------
// Keyboard shortcuts for the personal view toggles. Single keys with no modifiers
// (so they never fight the browser), rebindable from Display settings, and inert
// while the user is typing — otherwise they would fire from the chat box.
// ---------------------------------------------------------------------------
const HOTKEY_ACTIONS = [
  { id: 'players',    label: 'Show players / team names', def: 'f', note: '' },
  { id: 'streamer',   label: 'Streamer mode',             def: 's', note: '' },
  { id: 'playerview', label: 'View as player',            def: 'v', note: 'needs organizer rights' }
];

// stored bindings merged over the defaults; '' means that shortcut is switched off
function hotkeyMap() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('faf_hotkeys') || '{}') || {}; } catch (e) { saved = {}; }
  const out = {};
  for (const a of HOTKEY_ACTIONS) out[a.id] = (saved[a.id] === '' ? '' : (saved[a.id] || a.def));
  return out;
}
function setHotkey(id, key) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('faf_hotkeys') || '{}') || {}; } catch (e) { saved = {}; }
  saved[id] = key;                       // '' disables it
  try { localStorage.setItem('faf_hotkeys', JSON.stringify(saved)); } catch (e) {}
}
// what a given action is currently bound to, for tooltips
function hotkeyFor(id) { const k = hotkeyMap()[id]; return k ? k.toUpperCase() : null; }

function typingInField(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;          // leave browser/OS combos alone
  if (typingInField(e.target)) return;                      // never steal keys from a text field
  const modalOpen = !!document.getElementById('modalRoot').innerHTML;
  if (e.key === 'Escape' && modalOpen) { e.preventDefault(); closeModal(); return; }
  if (modalOpen) return;                                    // don't act behind an open dialog

  // these toggles only mean anything inside a tournament
  if (!(typeof T !== 'undefined' && T && T.id && location.pathname.startsWith('/t/'))) return;

  const keys = hotkeyMap();
  const k = (e.key || '').toLowerCase();
  if (!k) return;

  if (keys.players && k === keys.players) {
    e.preventDefault();
    setShowPlayerNames(!showPlayerNames);
    toast(showPlayerNames ? 'Showing players' : 'Showing team names');
    drawTournament();
  } else if (keys.streamer && k === keys.streamer) {
    e.preventDefault();
    setStreamerMode(!streamerMode);
    toast(streamerMode ? 'Streamer mode on' : 'Streamer mode off');
    drawTournament();
  } else if (keys.playerview && k === keys.playerview) {
    if (!viewerHasRights()) return;                         // nothing to hide for a normal player
    e.preventDefault();
    setPlayerViewMode(!playerViewMode);
    toast(playerViewMode ? 'Viewing as player' : 'Organizer view restored');
    drawTournament();
  }
});
