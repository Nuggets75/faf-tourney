/* FAF Tourney frontend v2 */
'use strict';

const app = document.getElementById('app');
const topbarRight = document.getElementById('topbarRight');

let T = null;
let currentTab = 'overview';
let pollTimer = null;
let lastSnapshot = '';
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
  let items = [];
  try { const d = await (await fetch('/api/my/pending', { credentials: 'same-origin' })).json(); items = (d && d.pending) || []; }
  catch (e) { bar.innerHTML = ''; return; }
  const cur = tourneyId();
  const shown = items.filter(it => it.tId !== cur);
  if (!shown.length) { bar.innerHTML = ''; return; }
  const it = shown[0];
  const more = shown.length > 1 ? '<span class="pending-more">+' + (shown.length - 1) + ' more</span>' : '';
  bar.innerHTML = '<div class="pending-bar"><span class="pending-text">\u26A1 ' + esc(it.text) + ' \u2014 <strong>' + esc(it.tName) + '</strong></span>' +
    '<button class="btn small" id="pendingGo">Go</button>' + more + '</div>';
  bar.querySelector('#pendingGo').onclick = () => {
    history.pushState(null, '', '/t/' + it.tId + (it.tab && it.tab !== 'overview' ? '?tab=' + it.tab : ''));
    route();
  };
}
function siteAdmin() { return localStorage.getItem('siteAdmin') || null; }
// The bar above is otherwise only drawn on navigation, so its "your turn to ban/pick" text
// could go stale while a veto progresses elsewhere. Keep it current.
setInterval(() => { try { refreshPending(); } catch (e) {} }, 30000);
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

const VALID_TABS = ['overview', 'players', 'teams', 'bracket', 'maps', 'vetoes', 'standings', 'admin'];
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
  return (T.maps && T.maps[bracket + ':' + round]) || [];
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
// a clickable map chip that opens the map's image/description (if any)
function mapChip(id, cls) {
  const m = mapObj(id);
  const name = m ? m.name : (id || '');
  const hasInfo = m && (m.image || m.description);
  return '<span class="veto-map ' + (cls || '') + (hasInfo ? ' has-info' : '') + '"' + (hasInfo ? ' data-map-info="' + esc(id) + '"' : '') + '>' + esc(name) + '</span>';
}
// open a lightbox with the map's preview image (enlargeable) and description
function showMapInfo(id) {
  const m = mapObj(id);
  if (!m) return;
  const hasImg = !!m.image;
  const body = `
    <h3>${esc(m.name)}</h3>
    ${hasImg ? `<img src="/map-images/${esc(m.image)}" alt="${esc(m.name)}" class="map-lightbox-img" id="mapBig">` : ''}
    ${m.description ? `<div class="map-desc">${esc(m.description)}</div>` : '<p class="muted small">No description.</p>'}
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

function roundLabel(m) {
  if (m.bracket === 'gf') return T.bracketType === 'swiss' ? 'FINAL' : 'GRAND FINAL';
  if (m.bracket === 'sw') return 'ROUND ' + m.round;
  if (m.bracket === 'ffa') {
    const maxR = Math.max.apply(null, T.matches.map(x => x.round));
    const cnt = T.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
    return (cnt === 1 && m.round === maxR && m.round > 1) ? 'FINAL' : 'ROUND ' + m.round;
  }
  if (m.bracket === 'lb') return 'LOSERS BRACKET R' + m.round;
  // wb
  const R = T.rounds || 1;
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
      return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    }
    const dateStr = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
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

function statusLabel(s) {
  return { signup: 'Signups open', draft: 'Drafting', drafted: 'Teams locked', running: 'In progress', finished: 'Finished' }[s] || s;
}

function typeLine(t) {
  if (t.competition === 'ffa') {
    const sz = t.teamSize === 1 ? 'solo' : t.teamSize + '-player teams';
    const md = t.ffaCfg.mode === 'points' ? 'points' : 'knockout';
    return 'FFA ' + md + ' (' + sz + ', ' + t.ffaCfg.perMatch + ' per lobby)' + (t.maxTeams ? ' · max ' + t.maxTeams : '');
  }
  const bt = { single: 'single elim', double: 'double elim', swiss: 'swiss' }[t.bracketType];
  const form = t.teamSize === 1 ? '1v1' : t.teamSize + 'v' + t.teamSize + ' · ' + (t.formation === 'draft' ? 'captains draft' : t.formation === 'open' ? 'open teams' : 'premade');
  return form + ' · ' + bt + (t.maxTeams ? ' · max ' + t.maxTeams + ' teams' : '');
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
  if (t.bracketType === 'single') return 'Bo' + p.early + ' rounds · Bo' + p.semi + ' semifinal · Bo' + p.final + ' final';
  if (t.bracketType === 'double') return 'Winners bracket Bo' + p.wb + ' (final Bo' + p.wbFinal + ') · losers bracket Bo' + p.lb + ' (final Bo' + p.lbFinal + ') · grand final Bo' + p.gf + (p.lbHandicap ? ' (upper finalist starts 1-0 up)' : '');
  return 'Bo' + p.bo + ' matches' + (p.final ? ' · Bo' + p.finalBo + ' final between the top 2' : ' · highest standing wins') + (p.fast ? ' · fast pairing' : '');
}

function modal(html, onMount, opts) {
  const root = document.getElementById('modalRoot');
  const wide = opts && opts.wide ? ' modal-wide' : '';
  root.innerHTML = '<div class="modal-bg"><div class="modal' + wide + '">' + html + '</div></div>';
  root.querySelector('.modal-bg').addEventListener('mousedown', e => {
    if (e.target.classList.contains('modal-bg')) closeModal();
  });
  if (onMount) onMount(root);
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

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
    };
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
    '<button class="btn ghost small" id="navFaq" title="FAQ / Rules">Rules</button>' +
    '<button class="btn amber small" id="hostBtn" title="Host a tournament">Host tournament</button>' +
    '<button class="btn ghost small" id="importBtn" title="Import a tournament from Challonge">Import</button>' +
    (me()
      ? '<button class="btn ghost small" id="cmdrBtn" title="Your profile - set your Discord handle, log out">' + esc(me()) + (isFafVerified() ? ' \u2713' : '') + ((fafAuth.enabled && isFafVerified() && !(fafAuth.user && fafAuth.user.discord)) ? ' <span class="dcpill">\uD83D\uDCAC add Discord</span>' : '') + '</button>'
      : '<button class="btn primary small" id="cmdrBtn" title="Player login">Log in</button>') +
    (siteAdmin()
      ? '<button class="btn ghost small" id="saLink" title="Open the site admin console">SITE ADMIN</button>'
      : (mode ? '<span>' + esc(mode) + '</span>' : '')) +
    '<button class="gearbtn" id="lockBtn" title="' + (siteAdmin() ? 'Log out of site admin' : 'Site admin log in') + '">' + (siteAdmin() ? '\uD83D\uDD13' : '\uD83D\uDD12') + '</button>' +
    '<button class="gearbtn" id="gearBtn" title="Display settings">⚙</button>';
  document.getElementById('gearBtn').onclick = openSettings;
  const saLink = document.getElementById('saLink');
  if (saLink) saLink.onclick = () => { history.pushState(null, '', '/siteadmin'); route(); };
  const goTo = p => { history.pushState(null, '', p); route(); };
  document.getElementById('navStart').onclick = () => goTo('/');
  document.getElementById('navHall').onclick = () => goTo('/hall');
  document.getElementById('navFaq').onclick = () => goTo('/faq');
  document.getElementById('lockBtn').onclick = () => {
    // Log in if logged out, log out if logged in. Opening the console is the "SITE ADMIN" link's job.
    siteAdminFlow();
  };
  document.getElementById('cmdrBtn').onclick = loginFlow;
  document.getElementById('importBtn').onclick = importFlow;
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

let _importPw = null; // held in memory after a successful password check

function importFlow() {
  if (siteAdmin()) return openImportWindow();
  if (_importPw) return openImportWindow();
  modal(`<h3>Import tournaments</h3>
    <p class="muted small">Enter the import password to import tournaments from Challonge.</p>
    <input type="password" id="impPw" placeholder="Import password" style="width:100%" autocomplete="off">
    <div class="actions"><button class="btn ghost" id="impCancel">Cancel</button><button class="btn primary" id="impOk">Continue</button></div>`, root => {
    const submit = async () => {
      const pw = root.querySelector('#impPw').value;
      if (!pw) return toast('Enter the password', true);
      try {
        await api('/api/verify_import', { password: pw });
        _importPw = pw;
        closeModal();
        openImportWindow();
      } catch (e) { toast(e.message, true); }
    };
    root.querySelector('#impCancel').onclick = closeModal;
    root.querySelector('#impOk').onclick = submit;
    root.querySelector('#impPw').onkeydown = e => { if (e.key === 'Enter') submit(); };
    setTimeout(() => { const el = root.querySelector('#impPw'); if (el) el.focus(); }, 30);
  });
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
        const r = await api('/api/import_challonge', { tournament: urlv, apiKey: keyv, admin: siteAdmin(), importPw: _importPw });
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
  if (!siteAdmin()) {
    app.innerHTML = `<div class="page"><div class="panel"><div class="empty">
      Site admin only - use the lock button in the top right to log in.</div></div></div>`;
    return;
  }
  app.innerHTML = `<div class="page">
    <h1 style="margin:0 0 14px">Site admin</h1>
    <div class="tabs" style="margin-bottom:14px">
      <button class="tab ${saTab === 'requests' ? 'active' : ''}" data-satab="requests">Requests${(saData && (saData.requests || []).filter(r => r.status === 'pending').length) ? ' (' + saData.requests.filter(r => r.status === 'pending').length + ')' : ''}</button>
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
  else if (saTab === 'archived') drawSaArchived(body);
  else if (saTab === 'articles') drawSaArticles(body);
  else drawSaLogs(body);
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
    <div class="row" style="justify-content:space-between;align-items:center">
      <h2 style="margin:0">Allowed to host (${allowed.length})</h2>
      <button class="btn ghost small" id="saGrant">+ Add by FAF id</button>
    </div>`;
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
  const g = document.getElementById('saGrant');
  if (g) g.onclick = () => {
    modal(`<h3>Allow an account to host</h3>
      <label>FAF id</label><input type="text" id="sgId" autocomplete="off">
      <label style="margin-top:10px">Name <span class="muted" style="font-weight:400">(optional)</span></label><input type="text" id="sgName" autocomplete="off">
      <div class="actions"><button class="btn ghost" id="sgCancel">Cancel</button><button class="btn primary" id="sgGo">Allow</button></div>`, root => {
      root.querySelector('#sgCancel').onclick = closeModal;
      root.querySelector('#sgGo').onclick = async () => {
        const fafId = root.querySelector('#sgId').value.trim();
        if (!fafId) return toast('FAF id required', true);
        try {
          await saPost('grant', { fafId, name: root.querySelector('#sgName').value.trim() });
          closeModal(); toast('Allowed'); renderSiteAdmin();
        } catch (e) { toast(e.message, true); }
      };
    });
  };
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

// Render an article body safely: escape everything, then turn ![alt](url) image tokens
// into <img> (only local /article-images/, /desc-images/ or http(s) urls). Newlines via pre-wrap.
function renderArticleBody(text) {
  let s = esc(text || '');
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    if (/^\/(article|desc)-images\/[A-Za-z0-9_.%-]+$/.test(url) || /^https?:\/\/[^\s"'<>]+$/.test(url)) {
      return '<img src="' + url + '" alt="' + alt + '" class="art-img">';
    }
    return m;
  });
  return s;
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
  if (!arts.length) html += '<div class="empty" style="margin-top:10px">No articles yet. These show on the public Rules page.</div>';
  else html += '<div style="margin-top:10px">' + arts.map(a => `<div class="sa-req">
      <div class="sa-req-main"><div class="sa-req-name">${esc(a.title)}</div><div class="muted small">Updated ${esc(fmtWhen(a.updatedAt || a.createdAt))}</div></div>
      <div class="sa-req-act"><button class="btn ghost small" data-artedit="${a.id}">Edit</button><button class="btn danger small" data-artdel="${a.id}">Delete</button></div>
    </div>`).join('') + '</div>';
  html += '</div>';
  el.innerHTML = html;

  const editor = (art) => {
    modal(`<h3>${art ? 'Edit' : 'New'} article</h3>
      <label>Title</label>
      <input type="text" id="artTitle" maxlength="120" autocomplete="off" value="${art ? esc(art.title) : ''}">
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px">
        <label style="margin:0">Body</label>
        <span class="muted small">Paste a screenshot straight in, or <a href="#" id="artImgBtn">insert an image</a>.</span>
      </div>
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
        try { await saPost('article_save', art ? { id: art.id, title, body: ta.value } : { title, body: ta.value }); closeModal(); toast('Saved'); renderSiteAdmin(); }
        catch (e) { toast(e.message, true); }
      };
    }, { wide: true });
  };
  const nb = document.getElementById('saArtNew'); if (nb) nb.onclick = () => editor(null);
  el.querySelectorAll('[data-artedit]').forEach(b => b.onclick = () => editor(arts.find(a => a.id === b.dataset.artedit)));
  el.querySelectorAll('[data-artdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this article?')) return;
    try { await saPost('article_delete', { id: b.dataset.artdel }); toast('Deleted'); renderSiteAdmin(); }
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

function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function siteAdminFlow() {
  if (siteAdmin()) {
    localStorage.removeItem('siteAdmin');
    toast('Site admin off');
    if (location.pathname === '/siteadmin') { history.pushState(null, '', '/'); }
    route();
    return;
  }
  modal(`
    <h3>Site admin</h3>
    <p class="muted small">Full control over every tournament on this server.</p>
    <label>Password</label>
    <input type="password" id="saPass" autocomplete="off">
    <div class="actions">
      <button class="btn ghost" id="saCancel">Cancel</button>
      <button class="btn primary" id="saGo">Log in</button>
    </div>`, root => {
    const inp = root.querySelector('#saPass');
    inp.focus();
    const go = async () => {
      try {
        await api('/api/siteadmin', { password: inp.value });
        localStorage.setItem('siteAdmin', inp.value);
        closeModal();
        toast('Site admin on');
        route();
      } catch (e) { toast(e.message, true); }
    };
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    root.querySelector('#saCancel').onclick = closeModal;
    root.querySelector('#saGo').onclick = go;
  });
}

