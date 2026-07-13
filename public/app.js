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
function siteAdmin() { return localStorage.getItem('siteAdmin') || null; }
// FAF login state, populated by refreshFafAuth() on load. fafAuth = { enabled, user:{fafId,fafName}|null }
let fafAuth = { enabled: false, user: null };
// the effective logged-in name: a verified FAF session wins over the manual name
function me() {
  if (fafAuth.user && fafAuth.user.fafName) return fafAuth.user.fafName;
  return localStorage.getItem('cmdrName') || '';
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

const VALID_TABS = ['overview', 'players', 'teams', 'bracket', 'standings', 'admin'];
function captureTokensFromURL() {
  const id = tourneyId();
  if (!id) return;
  const q = new URLSearchParams(location.search);
  if (q.get('admin')) localStorage.setItem('admin_' + id, q.get('admin'));
  if (q.get('cap')) localStorage.setItem('cap_' + id, q.get('cap'));
  // honor ?tab=bracket etc. for shareable deep links
  const tab = q.get('tab');
  if (tab && VALID_TABS.indexOf(tab) >= 0) currentTab = tab;
  // strip sensitive tokens from the URL but keep the tab for shareability
  if (q.get('admin') || q.get('cap')) {
    history.replaceState(null, '', '/t/' + id + (currentTab !== 'overview' ? '?tab=' + currentTab : ''));
  }
}

function teamName(id) {
  if (!id || id === 'BYE') return null;
  const t = T.teams.find(x => x.id === id);
  return t ? t.name : '?';
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
  const form = t.teamSize === 1 ? '1v1' : t.teamSize + 'v' + t.teamSize + ' · ' + (t.formation === 'draft' ? 'captains draft' : 'premade');
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

function modal(html, onMount) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="modal-bg"><div class="modal">' + html + '</div></div>';
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
  topbarRight.innerHTML =
    '<a class="btn amber small" href="/host">Host tournament</a>' +
    '<button class="btn ghost small" id="importBtn" title="Import a tournament from Challonge">Import</button>' +
    (me()
      ? '<button class="btn ghost small" id="cmdrBtn" title="Player account">' + esc(me()) + '</button>'
      : '<button class="btn primary small" id="cmdrBtn" title="Player login">Log in</button>') +
    (mode ? '<span>' + esc(mode) + '</span>' : '') +
    '<button class="gearbtn" id="lockBtn" title="Site admin">' + (siteAdmin() ? '\uD83D\uDD13' : '\uD83D\uDD12') + '</button>' +
    '<button class="gearbtn" id="gearBtn" title="Display settings">⚙</button>';
  document.getElementById('gearBtn').onclick = openSettings;
  document.getElementById('lockBtn').onclick = siteAdminFlow;
  document.getElementById('cmdrBtn').onclick = loginFlow;
  document.getElementById('importBtn').onclick = importFlow;
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
  // Already logged in — show status and the right logout control.
  if (me()) {
    const verified = isFafVerified();
    modal(`
      <h3>Logged in as ${esc(me())}${verified ? ' <span class="verifiedchip">FAF verified</span>' : ''}</h3>
      <p class="muted small">${verified ? 'Your FAF account is linked. Signup forms use your FAF name.' : 'Signup forms use this name automatically.'}</p>
      <div class="actions">
        <button class="btn ghost" id="lgClose">Close</button>
        <button class="btn danger" id="lgOut">Log out</button>
      </div>`, root => {
      root.querySelector('#lgClose').onclick = closeModal;
      root.querySelector('#lgOut').onclick = async () => {
        if (isFafVerified()) {
          try { await fetch('/auth/faf/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
          fafAuth.user = null;
        }
        localStorage.removeItem('cmdrName');
        closeModal(); route();
      };
    });
    return;
  }
  // Not logged in — offer FAF login (if configured) and/or the manual name.
  const fafBtn = fafAuth.enabled
    ? `<button class="btn faf" id="lgFaf">Log in with FAF</button>
       <div class="or-divider"><span>or</span></div>`
    : '';
  modal(`
    <h3>Log in</h3>
    ${fafAuth.enabled ? '<p class="muted small">Log in with your FAF account to verify your identity, or just enter a name.</p>' : '<p class="muted small">Your name pre-fills every signup form.</p>'}
    ${fafBtn}
    <label>FAF name</label>
    <input type="text" id="lgName" maxlength="30" autocomplete="off">
    <div class="actions">
      <button class="btn ghost" id="lgCancel">Cancel</button>
      <button class="btn primary" id="lgGo">Use this name</button>
    </div>`, root => {
    const faf = root.querySelector('#lgFaf');
    if (faf) faf.onclick = () => {
      const returnTo = location.pathname + location.search;
      location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(returnTo);
    };
    const inp = root.querySelector('#lgName');
    inp.focus();
    const go = () => {
      const n = inp.value.trim();
      if (!n) return toast('Enter your name', true);
      localStorage.setItem('cmdrName', n);
      closeModal();
      toast('Logged in as ' + n);
      route();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    root.querySelector('#lgCancel').onclick = closeModal;
    root.querySelector('#lgGo').onclick = go;
  });
}

function siteAdminFlow() {
  if (siteAdmin()) {
    localStorage.removeItem('siteAdmin');
    toast('Site admin off');
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

// ---------- home ----------

function pv(id) { return document.getElementById(id).value; }

async function renderHome() {
  setTitle(null);
  stopPoll();
  drawTopbar('');
  let list = [];
  try { list = await api('/api/tournaments'); } catch (e) {}

  const loginPanel = me() ? '' : `
    <div class="panel section">
      <h2>Log <span class="h2-strong">In</span></h2>
      <div class="row" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <label style="margin-top:0">FAF name</label>
          <input type="text" id="homeLgName" maxlength="30" placeholder="Your in-game name" autocomplete="off">
        </div>
        <button class="btn primary" id="homeLgGo" style="padding-top:10px;padding-bottom:10px">Log in</button>
      </div>
      <div class="muted small" style="margin-top:10px">Your name pre-fills every signup form.</div>
    </div>`;

  const completed = list.filter(t => t.status === 'finished')
    .sort((a, b) => tourneyDateMs(b) - tourneyDateMs(a)); // most recent first
  const groups = [
    ['Open for signups', list.filter(t => t.status === 'signup'), 'Nothing open right now.'],
    ['Ongoing', list.filter(t => ['draft', 'drafted', 'running'].indexOf(t.status) >= 0), 'No tournaments running.'],
    ['Completed', completed, 'No finished tournaments yet.']
  ];

  app.innerHTML = '<div class="page">' + loginPanel + groups.map((g, i) => `
    <div class="panel section">
      <h2>${esc(g[0])} <span class="h2-strong">(${g[1].length})</span></h2>
      <div id="tlist${i}">${g[1].length ? '' : '<div class="empty">' + esc(g[2]) + '</div>'}</div>
    </div>`).join('') + '</div>';

  const hlName = document.getElementById('homeLgName');
  if (hlName) {
    const go = () => {
      const n = hlName.value.trim();
      if (!n) return toast('Enter your name', true);
      localStorage.setItem('cmdrName', n);
      toast('Logged in as ' + n);
      route();
    };
    hlName.onkeydown = e => { if (e.key === 'Enter') go(); };
    document.getElementById('homeLgGo').onclick = go;
  }

  groups.forEach((g, i) => {
    const tl = document.getElementById('tlist' + i);
    for (const t of g[1]) {
      const div = document.createElement('div');
      div.className = 'tlist-item';
      const kind = t.competition === 'ffa' ? 'FFA' :
        (t.teamSize + 'v' + t.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[t.bracketType] || ''));
      div.innerHTML = `
        <div>
          <div class="tname"><a href="/t/${t.id}">${esc(t.name)}</a></div>
          <div class="tlist-meta">${esc(kind)}${t.imported ? '' : ' \u00b7 ' + t.players + ' signed up'}${tourneyDate(t) ? ' \u00b7 <span class="tdate">' + esc(fmtDateTime(tourneyDate(t))) + '</span>' : ''}</div>
        </div>
        <span style="display:flex;align-items:center;gap:10px">
          <span class="pill ${t.status}">${esc(statusLabel(t.status))}</span>
          ${siteAdmin() ? '<button class="btn danger small" data-del="' + t.id + '">Delete</button>' : ''}
        </span>`;
      const delBtn = div.querySelector('[data-del]');
      if (delBtn) delBtn.onclick = () => {
        modal(`<h3>Delete tournament</h3><p>Remove <strong>${esc(t.name)}</strong> permanently? This cannot be undone.</p>
          <div class="actions"><button class="btn ghost" id="dCancel">Cancel</button><button class="btn danger" id="dGo">Delete</button></div>`, root => {
          root.querySelector('#dCancel').onclick = closeModal;
          root.querySelector('#dGo').onclick = async () => {
            try { await api('/api/t/' + t.id + '/delete', { admin: siteAdmin() }); closeModal(); toast('Deleted'); renderHome(); }
            catch (e) { toast(e.message, true); }
          };
        });
      };
      tl.appendChild(div);
    }
  });
}

async function renderHost() {
  setTitle('Host a tournament');
  stopPoll();
  drawTopbar('');
  app.innerHTML = `
    <div class="page" style="max-width:640px">
      <p style="margin:0 0 16px"><a href="/">\u2190 Back to tournaments</a></p>
      <div class="panel section">
        <h2>Host a <span class="h2-strong">Tournament</span></h2>
        <label>Tournament name</label>
        <input type="text" id="cName" maxlength="60" placeholder="e.g. EPIC 3v3 double elim">
        <label>Event date &amp; time (UTC) <span class="muted" style="font-weight:400">(optional)</span></label>
        <div style="display:flex;gap:8px"><input type="date" id="cDate" style="flex:1"><input type="time" id="cTime" style="width:130px"></div>
        <label>Description (rules, schedule)</label>
        <textarea id="cDesc" maxlength="500" placeholder="Sunday 19:00 CEST. Check-in in Discord..."></textarea>
        <label>Lobby options</label>
        <textarea id="cLobby" maxlength="500" placeholder="e.g. 1500 unit cap, full share"></textarea>
        <label>Mods</label>
        <input type="text" id="cMods" maxlength="500" placeholder="e.g. M28 / Random events">

        <label>Competition</label>
        <select id="cComp">
          <option value="team">Team bracket (1v1 ... 6v6)</option>
          <option value="ffa">FFA</option>
        </select>

        <div id="teamOpts">
          <label>Team size</label>
          <select id="cSize">${[1,2,3,4,5,6].map(n => '<option value="'+n+'"'+(n===2?' selected':'')+'>'+n+'v'+n+'</option>').join('')}</select>
          <div id="formationWrap">
            <label>Team formation</label>
            <select id="cFormation">
              <option value="draft">Captains draft — captains pick from the signup pool</option>
              <option value="premade">Premade teams — players sign up with a team name</option>
            </select>
            <div id="draftOrderWrap">
              <label>Draft pick order</label>
              <select id="cDraftOrder">
                <option value="linear" selected>Bottom to top, every round</option>
                <option value="snake">Snake (1→N, N→1, 1→N, ...)</option>
              </select>
            </div>
          </div>
          <label>Bracket</label>
          <select id="cBracket">
            <option value="single">Single elimination</option>
            <option value="double">Double elimination</option>
            <option value="swiss">Swiss</option>
          </select>

          <div id="planSingle">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Early rounds</div><select id="pEarly"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Semifinal</div><select id="pSemi"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Final</div><select id="pFinal"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
          </div>
          <div id="planDouble" style="display:none">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Winners bracket rounds</div><select id="pWb"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Winners bracket final</div><select id="pWbFinal"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <div class="row" style="gap:10px;margin-top:8px">
              <div style="flex:1"><div class="muted small">Losers bracket rounds</div><select id="pLb"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Losers bracket final</div><select id="pLbFinal"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <div class="row" style="gap:10px;margin-top:8px">
              <div style="flex:1"><div class="muted small">Grand final</div><select id="pGf"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pHcap" checked> Upper bracket finalist starts the grand final 1-0 up
            </label>
          </div>
          <div id="planSwiss" style="display:none">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Each match</div><select id="pSwBo"><option value="1">Bo1</option><option value="3" selected>Bo3</option></select></div>
              <div style="flex:1"><div class="muted small">Final</div><select id="pSwFinalBo"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pSwFinal" checked> Final between the top 2 after the last round
            </label>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pSwFast"> Fast pairing \u2014 next matchup starts as soon as two teams are free
            </label>
          </div>
        </div>

        <div id="ffaOpts" style="display:none">
          <label>Entrants</label>
          <select id="cFfaSize">
            <option value="1">Solo players</option>
            <option value="2">Teams of 2</option>
            <option value="3">Teams of 3</option>
          </select>
          <label id="perMatchLabel">Players per FFA lobby</label>
          <select id="cPerMatch"></select>
          <label>Mode</label>
          <select id="cFfaMode">
            <option value="points" selected>Points over rounds \u2014 placement points each round, highest total wins</option>
            <option value="elim">Knockout \u2014 top finishers advance, rest are out</option>
          </select>
          <div id="ffaPointsOpts">
            <label>Number of rounds</label>
            <input type="number" id="cFfaRounds" min="1" max="10" value="3" autocomplete="off">
            <label>After each round</label>
            <div class="row" style="gap:10px;align-items:center">
              <select id="cFfaCutMode" style="flex:1"><option value="0">Everyone continues</option><option value="1">Cut to the top \u2026</option></select>
              <input type="number" id="cFfaCutTo" min="2" max="64" value="8" style="flex:0 0 90px;display:none" autocomplete="off">
            </div>
            <label>After the last round</label>
            <div class="row" style="gap:10px;align-items:center">
              <select id="cFfaFinalMode" style="flex:1"><option value="0">Highest points is champion</option><option value="1">Top \u2026 play a final lobby</option></select>
              <input type="number" id="cFfaFinalSize" min="2" max="16" value="4" style="flex:0 0 90px;display:none" autocomplete="off">
            </div>
          </div>
          <div id="ffaElimOpts" style="display:none">
            <label>Advancing per lobby</label>
            <select id="cAdvance"><option value="1">Winner only</option><option value="2">Top 2</option><option value="3">Top 3</option><option value="4">Top 4</option></select>
          </div>
        </div>

        <label>Max ${'\u200b'}teams / entrants (0 = unlimited)</label>
        <input type="number" id="cMaxTeams" min="0" max="128" value="0" autocomplete="off">

        <label>Seeding</label>
        <select id="cSeed">
          <option value="rating" selected>By rating (entered at signup)</option>
          <option value="random">Random</option>
        </select>
        <label style="display:flex;align-items:center;gap:8px;margin-top:16px;cursor:pointer">
          <input type="checkbox" id="cVeto" style="width:auto"> Enable map vetoes (captains ban maps before each match)
        </label>
        <div id="cVetoCfg" style="display:none;margin-top:10px;padding:12px;background:var(--panel2);border:1px solid var(--line-solid);border-radius:4px">
          <label>Map pool <span class="muted" style="font-weight:400">(one per line)</span></label>
          <textarea id="cVetoMaps" rows="5" placeholder="Seton's Clutch&#10;Theta Passage&#10;Twin Rivers&#10;..."></textarea>
          <label style="margin-top:10px">Maps to ban before each match</label>
          <input type="number" id="cVetoBan" min="0" max="20" value="2" style="width:100px">
          <div class="muted small" style="margin-top:6px">Captains alternate banning (higher seed first). Remaining map(s) are played.</div>
        </div>
        <div style="margin-top:20px">
          <button class="btn primary" id="cGo">Create tournament</button>
        </div>
      </div>
    </div>`;

  const cVeto = document.getElementById('cVeto');
  if (cVeto) cVeto.onchange = () => { document.getElementById('cVetoCfg').style.display = cVeto.checked ? 'block' : 'none'; };
  const comp = document.getElementById('cComp');
  const size = document.getElementById('cSize');
  const formation = document.getElementById('cFormation');
  const cBracket = document.getElementById('cBracket');
  const ffaSize = document.getElementById('cFfaSize');
  const ffaMode = document.getElementById('cFfaMode');
  const perMatch = document.getElementById('cPerMatch');
  const cutMode = document.getElementById('cFfaCutMode');
  const finalMode = document.getElementById('cFfaFinalMode');

  const syncPerMatch = () => {
    const es = parseInt(ffaSize.value, 10);
    const maxL = Math.max(2, Math.floor(16 / es));
    document.getElementById('perMatchLabel').textContent = (es === 1 ? 'Players' : 'Teams') + ' per FFA lobby';
    const cur = parseInt(perMatch.value, 10) || Math.min(6, maxL);
    perMatch.innerHTML = '';
    for (let n = 2; n <= maxL; n++) {
      const players = es === 1 ? '' : ' (' + (n * es) + ' players)';
      perMatch.innerHTML += '<option value="' + n + '"' + (n === Math.min(cur, maxL) ? ' selected' : '') + '>' + n + players + '</option>';
    }
  };
  const syncVis = () => {
    const isFfa = comp.value === 'ffa';
    document.getElementById('teamOpts').style.display = isFfa ? 'none' : '';
    document.getElementById('ffaOpts').style.display = isFfa ? '' : 'none';
    document.getElementById('formationWrap').style.display = size.value === '1' ? 'none' : '';
    document.getElementById('draftOrderWrap').style.display = (formation.value === 'draft' && size.value !== '1') ? '' : 'none';
    document.getElementById('planSingle').style.display = cBracket.value === 'single' ? '' : 'none';
    document.getElementById('planDouble').style.display = cBracket.value === 'double' ? '' : 'none';
    document.getElementById('planSwiss').style.display = cBracket.value === 'swiss' ? '' : 'none';
    document.getElementById('ffaPointsOpts').style.display = ffaMode.value === 'points' ? '' : 'none';
    document.getElementById('ffaElimOpts').style.display = ffaMode.value === 'elim' ? '' : 'none';
    document.getElementById('cFfaCutTo').style.display = cutMode.value === '1' ? '' : 'none';
    document.getElementById('cFfaFinalSize').style.display = finalMode.value === '1' ? '' : 'none';
    syncPerMatch();
  };
  comp.onchange = syncVis; size.onchange = syncVis; formation.onchange = syncVis;
  cBracket.onchange = syncVis; ffaSize.onchange = syncVis; ffaMode.onchange = syncVis;
  cutMode.onchange = syncVis; finalMode.onchange = syncVis;
  syncVis();

  document.getElementById('cGo').onclick = async () => {
    const name = document.getElementById('cName').value.trim();
    if (!name) return toast('Give the tournament a name', true);
    const isFfa = comp.value === 'ffa';
    const bt = cBracket.value;
    let plan = {};
    if (bt === 'single') plan = { early: pv('pEarly'), semi: pv('pSemi'), final: pv('pFinal') };
    else if (bt === 'double') plan = { wb: pv('pWb'), wbFinal: pv('pWbFinal'), lb: pv('pLb'), lbFinal: pv('pLbFinal'), gf: pv('pGf'), lbHandicap: document.getElementById('pHcap').checked };
    else plan = { bo: pv('pSwBo'), final: document.getElementById('pSwFinal').checked, finalBo: pv('pSwFinalBo'), fast: document.getElementById('pSwFast').checked };
    try {
      const r = await api('/api/tournaments', {
        name,
        description: document.getElementById('cDesc').value,
        lobbyOptions: document.getElementById('cLobby').value,
        mods: document.getElementById('cMods').value,
        competition: comp.value,
        teamSize: isFfa ? ffaSize.value : size.value,
        formation: formation.value,
        draftOrder: document.getElementById('cDraftOrder').value,
        bracketType: bt,
        plan,
        maxTeams: document.getElementById('cMaxTeams').value,
        perMatch: perMatch.value,
        advance: ffaMode.value === 'elim' ? document.getElementById('cAdvance').value : 1,
        mode: ffaMode.value,
        rounds: document.getElementById('cFfaRounds').value,
        cutTo: cutMode.value === '1' ? document.getElementById('cFfaCutTo').value : 0,
        finalSize: finalMode.value === '1' ? document.getElementById('cFfaFinalSize').value : 0,
        seeding: document.getElementById('cSeed').value,
        veto: (function() {
          const en = document.getElementById('cVeto');
          if (!en || !en.checked) return { enabled: false, mapPool: [], banCount: 0 };
          const maps = document.getElementById('cVetoMaps').value.split('\n').map(x => x.trim()).filter(x => x);
          const ban = parseInt(document.getElementById('cVetoBan').value, 10) || 0;
          return { enabled: true, mapPool: maps, banCount: ban };
        })(),
        eventDate: combineDateTimeUTC(document.getElementById('cDate'), document.getElementById('cTime'))
      });
      localStorage.setItem('admin_' + r.id, r.adminToken);
      history.pushState(null, '', '/t/' + r.id);
      route();
      toast('Tournament created — you are the organizer on this browser');
    } catch (e) { toast(e.message, true); }
  };

}

// ---------- tournament shell ----------

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function formHasFocus() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && app.contains(a);
}

async function loadTournament() {
  const tok = myToken();
  T = await api('/api/t/' + tourneyId() + (tok ? '?token=' + encodeURIComponent(tok) : ''));
}

async function renderTournament() {
  captureTokensFromURL();
  try { await loadTournament(); }
  catch (e) {
    app.innerHTML = '<div class="page"><div class="panel"><div class="empty">Tournament not found.</div><a href="/">← Back</a></div></div>';
    return;
  }
  drawTopbar(adminToken() ? 'ORGANIZER' : (capToken() ? 'CAPTAIN' : ''));
  lastSnapshot = JSON.stringify(T);
  drawTournament();
  stopPoll();
  pollTimer = setInterval(async () => {
    if (document.getElementById('modalRoot').innerHTML) return; // modal open
    if (formHasFocus()) return;                                  // user is typing
    try {
      const tok = myToken();
      const fresh = await api('/api/t/' + tourneyId() + (tok ? '?token=' + encodeURIComponent(tok) : ''));
      const snap = JSON.stringify(fresh);
      if (snap === lastSnapshot) return;                         // nothing changed
      T = fresh;
      lastSnapshot = snap;
      drawTournament();
    } catch (e) {}
  }, 4000);
}

function drawTournament() {
  setTitle(T && T.name);
  const admin = !!adminToken();
  const phaseIdx = { signup: 0, draft: 1, drafted: 1, running: 2, finished: 3 }[T.status];
  const midStep = T.competition === 'ffa' ? 'Teams' : (T.formation === 'draft' ? 'Draft' : 'Teams');
  const lastStep = T.bracketType === 'swiss' ? 'Rounds' : 'Bracket';
  const steps = ['Signups', midStep, lastStep, 'Results'];

  const tabs = ['overview', 'players', 'teams', 'bracket', 'standings'];
  if (admin) tabs.push('admin');
  if (!tabs.includes(currentTab)) currentTab = 'overview';

  const tabLabel = tb => {
    if (tb === 'teams' && T.status === 'draft') return 'Draft';
    if (tb === 'bracket') return T.competition === 'ffa' || T.bracketType === 'swiss' ? 'Rounds' : 'Bracket';
    return tb;
  };

  app.innerHTML = `
    <div class="page">
      <div class="headrow">
        <div>
          <h1>${esc(T.name)}</h1>
          <div class="muted small">${esc(typeLine(T))}</div>
        </div>
        <span class="pill ${T.status}">${esc(statusLabel(T.status))}</span>
      </div>
      <div class="stepper">
        ${steps.map((s, i) => `<div class="step ${i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}">${s}</div>`).join('')}
      </div>
      <div class="tabs">
        ${tabs.map(tb => `<button class="tab ${tb === currentTab ? 'active' : ''}" data-tab="${tb}">${esc(tabLabel(tb))}</button>`).join('')}
      </div>
    </div>
    <div id="tabBody" class="${currentTab === 'bracket' && T.competition !== 'ffa' && T.bracketType !== 'swiss' ? 'widepage' : 'page'}"></div>`;

  app.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; syncTabURL(); drawTournament(); });

  const body = document.getElementById('tabBody');
  if (currentTab === 'overview') drawOverview(body);
  else if (currentTab === 'players') drawPlayers(body);
  else if (currentTab === 'teams') drawTeams(body);
  else if (currentTab === 'bracket') drawBracket(body);
  else if (currentTab === 'standings') drawStandings(body);
  else if (currentTab === 'admin') drawAdmin(body);
}

// ----- overview -----

function gameInfoPanel() {
  const cells = [];
  cells.push(['Format', typeLine(T) + '\n' + planSummary(T)]);
  if (T.description) cells.push(['Briefing', T.description]);
  if (T.lobbyOptions) cells.push(['Lobby options', T.lobbyOptions]);
  if (T.mods) cells.push(['Mods', T.mods]);
  if (!cells.length) return '';
  return `<div class="panel section"><h2>Game <span class="h2-strong">Setup</span></h2><div class="infogrid">
    ${cells.map(c => `<div class="infocell"><div class="ic-label">${esc(c[0])}</div><div class="ic-body">${esc(c[1])}</div></div>`).join('')}
  </div></div>`;
}

function drawOverview(el) {
  let html = '';

  const canEditDate = viewerIsAdmin() || !!adminToken();
  const dv = tourneyDate(T);
  const dateLabel = T.imported ? 'Played' : 'Event date';
  if (dv || canEditDate) {
    html += `<div class="datebar">
      <span class="db-label">${esc(dateLabel)}</span>
      <span class="db-value">${dv ? esc(fmtDateTime(dv)) : '<span class="muted">not set</span>'}</span>
      ${canEditDate ? '<button class="btn ghost small" id="editDateBtn">' + (dv ? 'Change' : 'Set date') + '</button>' : ''}
    </div>`;
  }

  if (T.imported) {
    html += `<div class="panel section" style="border-left:3px solid var(--blue)">
      <div class="mono small" style="color:var(--blue);letter-spacing:1px">IMPORTED FROM CHALLONGE</div>
      <div class="muted small" style="margin-top:6px">This is an archived tournament imported for display. ${T.sourceUrl ? '<a href="' + esc(T.sourceUrl) + '" target="_blank" rel="noopener">View on Challonge \u2197</a>' : ''}</div>
    </div>`;
  }

  if (T.championTeamId) {
    html += `<div class="champ"><div class="champ-label">Champion</div><h1>${esc(teamName(T.championTeamId))}</h1></div>`;
  }

  html += gameInfoPanel();

  if (T.status === 'signup') {
    html += `<div class="panel section"><h2>Status</h2>
      <p>Signups are open — <strong>${T.players.length}</strong> player${T.players.length === 1 ? '' : 's'} in so far.
      Head to the <a href="#" data-goto="players">Players</a> tab to sign up.</p></div>`;
  }

  if (T.status === 'draft' && T.draft) {
    const turnTeam = teamName(T.draft.order[T.draft.current]);
    html += `<div class="draft-turn">Draft in progress — <strong>${esc(turnTeam)}</strong> is on the clock. Follow it in the <a href="#" data-goto="teams">Draft</a> tab.</div>`;
  }

  if (T.status === 'running' || T.status === 'finished') {
    const open = T.matches.filter(m => m.status === 'ready' || m.status === 'live')
      .sort((a, b) => brOrder(a) - brOrder(b) || a.round - b.round || a.index - b.index);
    const done = T.matches.filter(m => m.status === 'done')
      .sort((a, b) => b.round - a.round || a.index - b.index).slice(0, 8);
    html += `<div class="panel section"><h2>Launch <span class="h2-strong">Queue</span> — up next</h2><div class="queue" id="q1">
      ${open.length ? '' : '<div class="empty">Nothing waiting — all caught up.</div>'}</div></div>`;
    html += `<div class="panel section"><h2>Recent results</h2><div class="queue" id="q2">
      ${done.length ? '' : '<div class="empty">No results yet.</div>'}</div></div>`;
    el.innerHTML = html;
    fillQueue(document.getElementById('q1'), open, true);
    fillQueue(document.getElementById('q2'), done, false);
  } else {
    el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';
  }

  el.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => {
    e.preventDefault(); currentTab = a.dataset.goto; syncTabURL(); drawTournament();
  });

  const edb = document.getElementById('editDateBtn');
  if (edb) edb.onclick = () => {
    const cur = (!T.imported ? T.eventDate : (T.eventDate || '')) || '';
    const parts = splitDateTimeUTC(cur);
    modal(`<h3>${T.imported ? 'Set display date' : 'Event date &amp; time'}</h3>
      <p class="muted small">Enter the time in <strong>UTC</strong>. It'll display in each viewer's chosen time zone. Leave blank to clear.</p>
      <div style="display:flex;gap:8px">
        <input type="date" id="edDate" value="${esc(parts.date)}" style="flex:1">
        <input type="time" id="edTime" value="${esc(parts.time)}" style="width:130px">
      </div>
      <div class="muted small" style="margin-top:6px">Date only (no time) is fine — just leave the time blank.</div>
      <div class="actions"><button class="btn ghost" id="edCancel">Cancel</button><button class="btn primary" id="edSave">Save</button></div>`, root => {
      root.querySelector('#edCancel').onclick = closeModal;
      root.querySelector('#edSave').onclick = async () => {
        const v = combineDateTimeUTC(root.querySelector('#edDate'), root.querySelector('#edTime'));
        try {
          await api('/api/t/' + T.id + '/edit_date', { eventDate: v, admin: myToken() });
          closeModal();
          await refresh();
          toast(v ? 'Date updated' : 'Date cleared');
        } catch (e) { toast(e.message, true); }
      };
    });
  };
}

function brOrder(m) { return { wb: 0, lb: 1, sw: 0, ffa: 0, gf: 2 }[m.bracket] || 0; }

function fillQueue(el, matches, withReport) {
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'qitem' + (m.status === 'done' ? ' done' : '') + (m.status === 'live' ? ' live' : '');
    let inner = `<span class="qround">${roundLabel(m)}</span>`;
    if (m.bracket === 'ffa') {
      const names = m.entrants.map(id => {
        const won = m.winners && m.winners.indexOf(id) >= 0;
        return `<span class="${won ? 'qwin' : ''}">${esc(teamName(id))}</span>`;
      }).join('<span class="qvs">·</span>');
      inner += `<span class="qteams">${names}</span>`;
    } else {
      const w1 = m.winner && m.winner === m.team1, w2 = m.winner && m.winner === m.team2;
      inner += `<span class="qteams">
        <span class="${w1 ? 'qwin' : ''}">${esc(teamName(m.team1) || 'TBD')}</span><span class="qvs">VS</span>
        <span class="${w2 ? 'qwin' : ''}">${esc(teamName(m.team2) || 'TBD')}</span></span>`;
      if (m.score1 != null) inner += `<span class="qscore">${m.score1} — ${m.score2}</span>`;
      if (m.status === 'live') inner += `<span class="livechip">LIVE</span>`;
    }
    const maps = mapsFor(m.bracket, m.round);
    if (maps.length) inner += `<span class="mono small muted" title="Maps">${esc(maps.map((mp, i) => 'G' + (i + 1) + ': ' + mp).join(' · '))}</span>`;
    const showBtn = !T.imported && withReport && (m.status === 'done' ? viewerIsAdmin() : canReportMatch(m));
    if (showBtn) inner += `<button class="btn amber small" data-m="${m.id}">Report</button>`;
    div.innerHTML = inner;
    if (showBtn) div.querySelector('[data-m]').onclick = () => reportScore(m.id);
    el.appendChild(div);
  }
}

// ----- players -----

function drawPlayers(el) {
  const admin = !!adminToken();
  let html = '';

  if (T.status === 'signup') {
    const teamReg = (T.formation === 'premade' && T.teamSize > 1);
    if (teamReg) {
      const rows = [];
      for (let i = 0; i < T.teamSize; i++) {
        rows.push(`<div class="row" style="gap:10px;margin-top:8px">
          <div style="flex:2"><input type="text" class="regName" data-i="${i}" maxlength="30" placeholder="Player ${i + 1}${i === 0 ? ' (captain — that\u2019s you)' : ''}" autocomplete="off"></div>
          <div style="flex:1"><input type="number" class="regRating" data-i="${i}" min="0" max="4000" placeholder="Rating" autocomplete="off"></div>
        </div>`);
      }
      html += `<div class="panel section"><h2>Register your team</h2>
        <div class="grid2">
          <div>
            <label>Team name</label><input type="text" id="rTeam" maxlength="30" placeholder="Unique team name" autocomplete="off">
            <label>Players (${T.teamSize})</label>
            ${rows.join('')}
            <div style="margin-top:16px"><button class="btn primary" id="rGo">Register team</button></div>
          </div>
          <div class="muted small" style="align-self:end">One player registers the whole team — nobody can join your team afterwards. The first player listed becomes captain. Need a roster change later? The organizer can edit players at any time.</div>
        </div></div>`;
    } else {
      html += `<div class="panel section"><h2>Sign up</h2>
      <div class="grid2">
        <div>
          <label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name" autocomplete="off">
          <label>Rating</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500" autocomplete="off">
          <div style="margin-top:16px"><button class="btn primary" id="sGo">Sign up</button></div>
        </div>
        <div class="muted small" style="align-self:end">
          ${T.competition === 'ffa' && T.teamSize === 1 ? 'Every player enters solo. Lobbies are grouped automatically.'
            : T.formation === 'draft' ? 'The organizer will pick captains once signups close, then captains draft their teams.'
            : 'Solo bracket — every signup is an entrant.'}
        </div>
      </div></div>`;
    }
  }

  html += `<div class="panel section"><h2>Players <span class="h2-strong">(${T.players.length})</span></h2>
    <table><thead><tr><th>#</th><th>Name</th><th>Rating</th>${T.formation === 'premade' && T.teamSize > 1 ? '<th>Signup team</th>' : ''}<th>Status</th>${admin ? '<th></th>' : ''}</tr></thead>
    <tbody id="pRows"></tbody></table>
    ${T.players.length ? '' : '<div class="empty">No signups yet.</div>'}</div>`;

  el.innerHTML = html;

  const rows = document.getElementById('pRows');
  T.players.forEach((p, i) => {
    const tr = document.createElement('tr');
    const inTeam = p.teamId ? teamName(p.teamId) : (T.subs && T.subs.includes(p.id) ? 'Substitute' : '—');
    tr.innerHTML = `
      <td class="mono muted">${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td class="mono">${p.rating != null ? p.rating : '<span class="muted">—</span>'}</td>
      ${T.formation === 'premade' && T.teamSize > 1 ? `<td>${esc(p.teamName || '—')}</td>` : ''}
      <td class="small muted" style="white-space:nowrap">${esc(inTeam)}</td>
      ${admin ? `<td style="text-align:right;white-space:nowrap">
        <button class="btn ghost small" data-edit="${p.id}">Edit</button>
        ${T.status === 'signup' || ((T.status === 'draft' || T.status === 'drafted') && !p.teamId) ? `<button class="btn danger small" data-del="${p.id}">${T.status === 'signup' && T.formation === 'premade' && T.teamSize > 1 ? 'Remove team' : 'Remove'}</button>` : ''}</td>` : ''}`;
    const eb = tr.querySelector('[data-edit]');
    if (eb) eb.onclick = () => editPlayer(p);
    const db = tr.querySelector('[data-del]');
    if (db) db.onclick = async () => {
      try { await api('/api/t/' + T.id + '/remove', { playerId: p.id, admin: adminToken() }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    rows.appendChild(tr);
  });

  // restore + track signup form values across re-renders
  const bindKeep = (id, key) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.value = F.signup[key] || '';
    inp.oninput = () => { F.signup[key] = inp.value; };
  };
  bindKeep('sName', 'name'); bindKeep('sRating', 'rating');
  const sn = document.getElementById('sName');
  if (sn && !sn.value && me()) { sn.value = me(); F.signup.name = me(); }

  // team registration form: preserve values + submit
  const rTeam = document.getElementById('rTeam');
  if (rTeam) {
    rTeam.value = F.reg.team || '';
    rTeam.oninput = () => { F.reg.team = rTeam.value; };
    document.querySelectorAll('.regName').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (!F.reg.p[i]) F.reg.p[i] = { n: '', r: '' };
      if (i === 0 && !F.reg.p[0].n && me()) F.reg.p[0].n = me();
      inp.value = F.reg.p[i].n;
      inp.oninput = () => { F.reg.p[i].n = inp.value; };
    });
    document.querySelectorAll('.regRating').forEach(inp => {
      const i = parseInt(inp.dataset.i, 10);
      if (!F.reg.p[i]) F.reg.p[i] = { n: '', r: '' };
      inp.value = F.reg.p[i].r;
      inp.oninput = () => { F.reg.p[i].r = inp.value; };
    });
    document.getElementById('rGo').onclick = async () => {
      const teamName = rTeam.value.trim();
      if (!teamName) return toast('Enter a team name', true);
      const players = [];
      for (let i = 0; i < T.teamSize; i++) {
        const n = (F.reg.p[i] && F.reg.p[i].n || '').trim();
        const r = F.reg.p[i] && F.reg.p[i].r;
        if (!n) return toast('Enter all ' + T.teamSize + ' player names', true);
        if (r === '' || r == null) return toast('Enter a rating for ' + n, true);
        players.push({ name: n, rating: r });
      }
      try {
        await api('/api/t/' + T.id + '/signup_team', { teamName, players });
        F.reg = { team: '', p: [] };
        toast('Team "' + teamName + '" registered');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  const go = document.getElementById('sGo');
  if (go) go.onclick = async () => {
    const name = (document.getElementById('sName').value || '').trim();
    if (!name) return toast('Enter your FAF name', true);
    if (document.getElementById('sRating').value === '') return toast('Enter your rating — it is used for balancing and seeding', true);
    try {
      await api('/api/t/' + T.id + '/signup', {
        name,
        rating: document.getElementById('sRating').value,
        teamName: document.getElementById('sTeam') ? document.getElementById('sTeam').value : ''
      });
      F.signup = { name: '', rating: '', team: '' };
      toast('Signed up — good luck, commander');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

function editPlayer(p) {
  modal(`
    <h3>Edit player</h3>
    <p class="muted small">To substitute a player who can't play, just overwrite the name and rating with the sub's — team spots and match history stay intact.</p>
    <label>FAF name</label><input type="text" id="epName" maxlength="30" value="${esc(p.name)}" autocomplete="off">
    <label>Rating</label><input type="number" id="epRating" min="0" max="4000" value="${p.rating != null ? p.rating : ''}" autocomplete="off">
    <div class="actions">
      <button class="btn ghost" id="epCancel">Cancel</button>
      <button class="btn primary" id="epGo">Save</button>
    </div>`, root => {
    root.querySelector('#epCancel').onclick = closeModal;
    root.querySelector('#epGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/edit_player', {
          playerId: p.id,
          name: root.querySelector('#epName').value,
          rating: root.querySelector('#epRating').value,
          admin: adminToken()
        });
        closeModal();
        toast('Player updated');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ----- teams / draft -----

function drawTeams(el) {
  const admin = !!adminToken();
  let html = '';

  if (T.status === 'signup') {
    if (admin) {
      if (T.formation === 'draft') {
        html += `<div class="panel section"><h2>Start the draft</h2>
          <p class="muted small">Tick the captains, then start. Pick order: ${T.draftOrder === 'snake' ? 'snake (1→N, N→1, ...)' : 'bottom seed to top seed, every round'}. Each captain fills a team of ${T.teamSize}.</p>
          <div class="pool" id="capPool"></div>
          <div style="margin-top:16px"><button class="btn amber" id="startDraft">Close signups &amp; start draft</button></div></div>`;
      } else {
        html += `<div class="panel section"><h2>Form ${T.teamSize === 1 ? 'entrants' : 'teams'}</h2>
          <p class="muted small">${T.teamSize === 1 ? 'Every signed-up player becomes an entrant.' : 'Teams are grouped by the team name players entered at signup. Players without a team name become substitutes.'}</p>
          <button class="btn amber" id="formTeams">Close signups &amp; lock ${T.teamSize === 1 ? 'entrants' : 'teams'}</button></div>`;
      }
    } else {
      html += '<div class="panel section"><div class="empty">Teams appear here once the organizer closes signups.</div></div>';
    }
  }

  if (T.status === 'draft' && T.draft) {
    const d = T.draft;
    const turnTeamId = d.order[d.current];
    // the team that made the most recent pick (authoritative: previous slot in the pick order)
    const lastTeamId = d.current > 0 ? d.order[d.current - 1] : null;
    let canUndo = false, undoName = '';
    if (lastTeamId) {
      undoName = teamName(lastTeamId);
      if (admin) canUndo = true;                                             // organizer: anytime
      else if (T.viewer && T.viewer.teamId === lastTeamId) canUndo = true;   // captain: only if they were last to pick
    }
    html += `<div class="draft-turn">Pick ${d.current + 1} of ${d.order.length} — <strong>${esc(teamName(turnTeamId))}</strong> is picking.
      ${capToken() && !admin ? '<span class="muted small"> If it\u2019s your team\u2019s turn, the pick buttons below work for you.</span>' : ''}
      ${canUndo ? '<button class="btn ghost small" id="undoPickBtn" style="margin-left:10px">\u21b6 Undo ' + esc(undoName) + '\u2019s last pick</button>' : ''}
    </div>`;
    const orderChips = d.order.map((tid, i) => {
      const cls = i < d.current ? 'po-done' : i === d.current ? 'po-now' : '';
      return `<span class="po-chip ${cls}"><span class="po-num">${i + 1}</span>${esc(teamName(tid))}</span>`;
    }).join('');
    html += `<div class="panel section"><h2>Pick order</h2><div class="pickorder">${orderChips}</div></div>`;
    html += `<div class="panel section"><h2>Player pool</h2><div class="pool" id="draftPool"></div></div>`;
  }

  if (T.teams.length) {
    html += `<div class="panel section"><h2>${T.teamSize === 1 ? 'Entrants' : 'Teams'}</h2><div class="teamgrid" id="tGrid"></div></div>`;
  }
  if (T.subs && T.subs.length) {
    html += `<div class="panel section"><h2>Substitutes</h2><div>${T.subs.map(id => esc(playerName(id))).join(', ')}</div></div>`;
  }

  if (T.status === 'drafted' && admin) {
    const canUndoLast = T.draft && T.draft.current > 0;
    html += `<div class="panel section"><h2>Ready</h2>
      <p class="muted small">${T.competition === 'ffa' ? 'Starting creates the round-1 FFA lobbies.' : 'Starting opens the best-of configuration for each round.'}</p>
      <button class="btn primary" id="startBracket">Start ${T.competition === 'ffa' || T.bracketType === 'swiss' ? 'rounds' : 'bracket'}</button>
      <button class="btn ghost" id="reopen" style="margin-left:10px">Reopen signups</button>
      ${canUndoLast ? '<button class="btn ghost" id="undoLastDrafted" style="margin-left:10px">\u21b6 Undo last pick</button>' : ''}</div>`;
  }

  el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';

  const capPool = document.getElementById('capPool');
  if (capPool) {
    const tbl = document.createElement('table');
    tbl.innerHTML = '<thead><tr><th style="width:40px">#</th><th>Name</th><th style="width:90px">Rating</th><th style="width:90px">Captain</th></tr></thead>';
    const tb = document.createElement('tbody');
    const sorted = T.players.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono muted">${i + 1}</td><td>${esc(p.name)}</td><td class="mono">${p.rating != null ? p.rating : '\u2014'}</td>
        <td><input type="checkbox" value="${p.id}"${F.capSel[p.id] ? ' checked' : ''}></td>`;
      const cb = tr.querySelector('input');
      cb.onchange = () => { if (cb.checked) F.capSel[p.id] = 1; else delete F.capSel[p.id]; };
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    capPool.appendChild(tbl);
    document.getElementById('startDraft').onclick = async () => {
      const ids = Object.keys(F.capSel);
      if (ids.length < 2) return toast('Pick at least 2 captains', true);
      try {
        await api('/api/t/' + T.id + '/phase', { action: 'start_draft', captainIds: ids, admin: adminToken() });
        F.capSel = {};
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }

  const ft = document.getElementById('formTeams');
  if (ft) ft.onclick = async () => {
    try { await api('/api/t/' + T.id + '/phase', { action: 'form_teams', admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };

  const undoBtn = document.getElementById('undoPickBtn');
  if (undoBtn) undoBtn.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/undo_pick', { token: myToken() });
      await refresh();
      toast('Pick undone');
    } catch (e) { toast(e.message, true); }
  };

  const dp = document.getElementById('draftPool');
  if (dp) {
    const turnTeam = T.draft ? T.draft.order[T.draft.current] : null;
    const canPick = viewerIsAdmin() || (T.viewer && T.viewer.teamId && T.viewer.teamId === turnTeam);
    const free = T.players.filter(p => !p.teamId).sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (!free.length) {
      dp.innerHTML = '<div class="empty">Pool is empty.</div>';
    } else {
      const tbl = document.createElement('table');
      tbl.innerHTML = '<thead><tr><th style="width:40px">#</th><th>Name</th><th style="width:90px">Rating</th><th style="width:90px"></th></tr></thead>';
      const tb = document.createElement('tbody');
      free.forEach((p, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="mono muted">${i + 1}</td><td>${esc(p.name)}</td><td class="mono">${p.rating != null ? p.rating : '\u2014'}</td>
          <td style="text-align:right">${canPick ? '<button class="btn amber small">Pick</button>' : ''}</td>`;
        const btn = tr.querySelector('button');
        if (btn) btn.onclick = async () => {
          try { await api('/api/t/' + T.id + '/pick', { playerId: p.id, token: myToken() }); await refresh(); }
          catch (e) { toast(e.message, true); }
        };
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      dp.appendChild(tbl);
    }
  }

  const tg = document.getElementById('tGrid');
  if (tg) {
    const ratingOf = pid => { const p = T.players.find(x => x.id === pid); return p && p.rating != null ? p.rating : null; };
    // does ANY team have a rating? if not, hide the per-player rating column and TOTAL row
    const anyRatings = T.players.some(p => p.rating != null);
    for (const team of T.teams.slice().sort((a, b) => a.seed - b.seed)) {
      const card = document.createElement('div');
      card.className = 'teamcard' + (team.eliminated ? ' elim' : '');

      // imported tournaments have no individual players/ratings — just show the team name
      if (T.imported) {
        card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${team.seed}</span></h3>` +
          (team.finalRank ? `<div class="teamtotal"><span>PLACED</span><span class="mono">#${team.finalRank}</span></div>` : '');
        tg.appendChild(card);
        continue;
      }

      const openSlots = (T.status === 'draft' || T.status === 'signup') ? Math.max(0, T.teamSize - team.playerIds.length) : 0;
      const total = team.playerIds.reduce((sum, pid) => sum + (ratingOf(pid) || 0), 0);
      card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${team.seed}</span></h3>
        <ul>${team.playerIds.map(pid => {
          const r = ratingOf(pid);
          return `<li style="display:flex;justify-content:space-between;gap:8px"><span>${esc(playerName(pid))}${pid === team.captainId && T.teamSize > 1 ? '<span class="captag">CAPTAIN</span>' : ''}</span>${anyRatings ? '<span class="mono muted">' + (r != null ? r : '\u2014') + '</span>' : ''}</li>`;
        }).join('')}${
          Array(openSlots).fill('<li class="openslot">\u2014 open \u2014</li>').join('')}</ul>${
        anyRatings ? '<div class="teamtotal"><span>TOTAL</span><span class="mono">' + total + '</span></div>' : ''}`;
      tg.appendChild(card);
    }
  }

  const sb = document.getElementById('startBracket');
  if (sb) sb.onclick = openStartConfig;
  const undoLast = document.getElementById('undoLastDrafted');
  if (undoLast) undoLast.onclick = async () => {
    try { await api('/api/t/' + T.id + '/undo_pick', { token: myToken() }); await refresh(); toast('Pick undone \u2014 draft reopened'); }
    catch (e) { toast(e.message, true); }
  };
  const ro = document.getElementById('reopen');
  if (ro) ro.onclick = async () => {
    try { await api('/api/t/' + T.id + '/phase', { action: 'reopen_signups', admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
}

// ----- start-bracket config -----

function log2i(n) { let r = 0; while ((1 << r) < n) r++; return r; }
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }

function openStartConfig() {
  const n = T.teams.length;
  if (n < 2) return toast('Need at least 2 teams', true);

  const start = async (config) => {
    try {
      await api('/api/t/' + T.id + '/phase', { action: 'start_bracket', config, admin: adminToken() });
      closeModal();
      currentTab = 'bracket';
      syncTabURL();
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  if (T.competition === 'ffa') {
    return modal(`
      <h3>Start FFA rounds</h3>
      <p class="muted small">${n} entrants → round 1 gets ${Math.ceil(n / T.ffaCfg.perMatch)} lobb${Math.ceil(n / T.ffaCfg.perMatch) === 1 ? 'y' : 'ies'} of up to ${T.ffaCfg.perMatch}. ${T.ffaCfg.advance === 2 ? 'Top 2 advance from each lobby.' : 'Winners advance.'}</p>
      <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Start</button></div>`,
      root => {
        root.querySelector('#cfgCancel').onclick = closeModal;
        root.querySelector('#cfgGo').onclick = () => start({});
      });
  }

  const R = log2i(nextPow2(n));

  if (T.bracketType === 'single') {
    const rows = [];
    for (let r = 1; r <= R; r++) {
      const lbl = r === R ? 'Final' : r === R - 1 ? 'Semifinals' : r === R - 2 ? 'Quarterfinals' : 'Round ' + r;
      const p = T.plan || {};
      const dflt = r === R ? (p.final || 5) : r === R - 1 ? (p.semi || 3) : (p.early || 3);
      rows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_r' + r, dflt)}</div></div>`);
    }
    return modal(`
      <h3>Bracket setup — single elimination</h3>
      <p class="muted small">${n} teams, ${R} round${R > 1 ? 's' : ''}. Set the best-of per round.</p>
      ${rows.join('')}
      <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Generate bracket</button></div>`,
      root => {
        root.querySelector('#cfgCancel').onclick = closeModal;
        root.querySelector('#cfgGo').onclick = () => {
          const rounds = [];
          for (let r = 1; r <= R; r++) rounds.push(parseInt(root.querySelector('#bo_r' + r).value, 10));
          start({ rounds });
        };
      });
  }

  if (T.bracketType === 'double') {
    if (n < 3) return toast('Double elimination needs at least 3 teams', true);
    const lbR = 2 * R - 2;
    const wbRows = [], lbRows = [];
    const p = T.plan || {};
    for (let r = 1; r <= R; r++) {
      const lbl = r === R ? 'Final' : r === R - 1 ? 'Semis' : 'Round ' + r;
      wbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_wb' + r, r === R ? (p.wbFinal || 3) : (p.wb || 3))}</div></div>`);
    }
    for (let q = 1; q <= lbR; q++) {
      const lbl = q === lbR ? 'Final' : 'Round ' + q;
      lbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_lb' + q, q === lbR ? (p.lbFinal || 3) : (p.lb || 3))}</div></div>`);
    }
    return modal(`
      <h3>Bracket setup — double elimination</h3>
      <p class="muted small">${n} teams. Winners bracket: ${R} rounds, losers bracket: ${lbR} rounds.</p>
      <label>Winners bracket</label>${wbRows.join('')}
      <label>Losers bracket</label>${lbRows.join('')}
      <label>Grand final</label>
      <div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">Grand final</div><div style="width:110px">${boSelect('bo_gf', (T.plan && T.plan.gf) || 5)}</div></div>
      <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
        <input type="checkbox" id="cfgHcap" ${T.plan && !T.plan.lbHandicap ? '' : 'checked'}> Upper bracket finalist starts the grand final 1-0 up
      </label>
      <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Generate bracket</button></div>`,
      root => {
        root.querySelector('#cfgCancel').onclick = closeModal;
        root.querySelector('#cfgGo').onclick = () => {
          const wb = [], lb = [];
          for (let r = 1; r <= R; r++) wb.push(parseInt(root.querySelector('#bo_wb' + r).value, 10));
          for (let q = 1; q <= lbR; q++) lb.push(parseInt(root.querySelector('#bo_lb' + q).value, 10));
          start({ wb, lb, gf: parseInt(root.querySelector('#bo_gf').value, 10), lbHandicap: root.querySelector('#cfgHcap').checked });
        };
      });
  }

  // swiss
  const defR = Math.max(1, R);
  const sp = T.plan || {};
  return modal(`
    <h3>Swiss setup</h3>
    <p class="muted small">${n} teams. Everyone plays every round; pairings by standings, rematches avoided.</p>
    <label>Number of rounds</label>
    <input type="number" id="swRounds" min="1" max="15" value="${defR}" autocomplete="off">
    <label>Each match is</label>
    <select id="swBo"><option value="1"${sp.bo === 1 ? ' selected' : ''}>Bo1</option><option value="3"${sp.bo !== 1 ? ' selected' : ''}>Bo3</option></select>
    <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:16px">
      <input type="checkbox" id="swFinal" ${sp.final === 0 ? '' : 'checked'}> Final between the top 2 after the last round
    </label>
    <div id="swFinalBoWrap"><label>Final is</label>${boSelect('swFinalBo', sp.finalBo || 5)}</div>
    <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
      <input type="checkbox" id="swFast" ${sp.fast ? 'checked' : ''}> Fast pairing \u2014 next matchup starts as soon as two teams are free
    </label>
    <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Start round 1</button></div>`,
    root => {
      const fin = root.querySelector('#swFinal');
      fin.onchange = () => { root.querySelector('#swFinalBoWrap').style.display = fin.checked ? '' : 'none'; };
      root.querySelector('#cfgCancel').onclick = closeModal;
      root.querySelector('#cfgGo').onclick = () => start({
        rounds: parseInt(root.querySelector('#swRounds').value, 10),
        bo: parseInt(root.querySelector('#swBo').value, 10),
        final: fin.checked,
        finalBo: parseInt(root.querySelector('#swFinalBo').value, 10),
        fast: root.querySelector('#swFast').checked
      });
    });
}

// ----- bracket / rounds -----

function mapRows(maps) {
  return maps.map((m, i) => '<div class="maprow"><span class="mapg">GAME ' + (i + 1) + '</span><span>' + esc(m) + '</span></div>').join('');
}

function mapsLine(bracket, round, el) {
  if (T.imported) return;
  const admin = !!adminToken();
  const maps = mapsFor(bracket, round);
  if (!maps.length && !admin) return;
  const div = document.createElement('div');
  div.className = 'mapblock';
  div.innerHTML = '<div class="mapblock-head"><span>MAP POOL</span>' + (admin ? '<a href="#">edit</a>' : '') + '</div>' +
    (maps.length ? mapRows(maps) : '<div class="maprow muted">no maps set</div>');
  const a = div.querySelector('a');
  if (a) a.onclick = e => { e.preventDefault(); editMaps(bracket, round); };
  el.appendChild(div);
}

function editMaps(bracket, round) {
  const existing = mapsFor(bracket, round);
  // suggest as many fields as the highest BO in that round, min existing
  const roundMatches = T.matches.filter(m => m.bracket === bracket && m.round === round);
  const maxBo = roundMatches.length ? Math.max.apply(null, roundMatches.map(m => m.bo)) : 5;
  const count = Math.max(maxBo, existing.length, 1);
  const inputs = [];
  for (let i = 0; i < count; i++) {
    inputs.push(`<input type="text" maxlength="50" class="mapInput" style="margin-bottom:7px" placeholder="Game ${i + 1} map" value="${esc(existing[i] || '')}">`);
  }
  modal(`
    <h3>Maps — ${esc(bracket === 'gf' ? 'Grand final' : bracket.toUpperCase() + ' round ' + round)}</h3>
    <p class="muted small">One map per game of the series (Bo${maxBo}). Everyone in this round plays the same maps. Leave fields empty to skip.</p>
    ${inputs.join('')}
    <div class="actions">
      <button class="btn ghost" id="mCancel">Cancel</button>
      <button class="btn primary" id="mGo">Save maps</button>
    </div>`, root => {
    root.querySelector('#mCancel').onclick = closeModal;
    root.querySelector('#mGo').onclick = async () => {
      const maps = Array.from(root.querySelectorAll('.mapInput')).map(i => i.value.trim()).filter(v => v);
      try {
        await api('/api/t/' + T.id + '/set_maps', { bracket, round, maps, admin: adminToken() });
        closeModal();
        toast('Maps saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function mLabel(m) {
  if (m.bracket === 'gf') return T.bracketType === 'swiss' ? 'FINAL' : 'GRAND FINAL';
  if (m.bracket === 'sw') return 'R' + m.round + ' M' + (m.index + 1);
  if (m.bracket === 'ffa') return 'R' + m.round + ' LOBBY ' + (m.index + 1);
  const p = m.bracket === 'lb' ? 'LB ' : (T.bracketType === 'double' ? 'WB ' : '');
  return p + 'R' + m.round + ' M' + (m.index + 1);
}

// feeders[destMatchId:slot] = { m: feederMatch, type: 'Winner'|'Loser' }
let feeders = {};
function buildFeeders() {
  feeders = {};
  for (const m of T.matches) {
    if (m.winnerTo) feeders[m.winnerTo.id + ':' + m.winnerTo.slot] = { m, type: 'Winner' };
    if (m.loserTo) feeders[m.loserTo.id + ':' + m.loserTo.slot] = { m, type: 'Loser' };
  }
}

function viewerIsAdmin() { return !!(T.viewer && T.viewer.admin); }
function canReportMatch(m) {
  const v = T.viewer || {};
  if (v.admin) return true;
  if (!v.teamId) return false;
  if (m.bracket === 'ffa') return m.entrants.indexOf(v.teamId) >= 0;
  return m.team1 === v.teamId || m.team2 === v.teamId;
}

function matchBox(m) {
  const admin = !!adminToken();
  const box = document.createElement('div');
  box.className = 'bmatch ' + m.status;
  const row = (tid, score, slot) => {
    const seed = tid && tid !== 'BYE' ? teamSeed(tid) : null;
    const win = m.winner && m.winner === tid && tid !== 'BYE';
    let nm;
    if (tid === 'BYE') nm = 'bye';
    else if (tid) nm = teamName(tid);
    else {
      const src = feeders[m.id + ':' + slot];
      nm = src ? src.type + ' of ' + mLabel(src.m) : 'TBD';
    }
    return `<div class="brow ${win ? 'winner' : ''}">
      <span class="bname ${tid && tid !== 'BYE' ? '' : 'tbd'}">${seed ? '<span class="seedtag">' + seed + '</span>' : ''}${esc(nm)}</span>
      <span class="bscore">${score != null ? score : ''}</span></div>`;
  };
  const canReport = !T.imported && (m.status === 'ready' || m.status === 'live') && canReportMatch(m);
  const canCorrect = !T.imported && m.status === 'done' && viewerIsAdmin();
  box.dataset.mid = m.id;
  box.innerHTML = `<div class="botag">${mLabel(m)} · BO${m.bo}${m.hcap ? ' · UB starts 1-0' : ''}${m.status === 'live' ? ' · <span class="livechip">LIVE</span>' : ''}</div>` +
    row(m.team1, m.score1, 1) + row(m.team2, m.score2, 2) +
    vetoHTML(m) +
    ((canReport || canCorrect)
      ? `<div class="bfoot"><button class="btn ${canReport ? 'amber' : 'ghost'} small">${canReport ? 'Report score' : 'Correct'}</button></div>` : '');
  const btn = box.querySelector('.bfoot button');
  if (btn) btn.onclick = () => reportScore(m.id);
  wireVeto(box, m);
  return box;
}

// veto section HTML for a match (empty string if no veto)
function vetoHTML(m) {
  if (!m.veto) return '';
  const v = m.veto;
  const myTeamId = (T.viewer && T.viewer.teamId) || null;
  const isAdminV = viewerIsAdmin();
  const banned = v.banned || [];
  const remaining = v.remaining || [];

  if (v.done) {
    // show final map(s)
    if (remaining.length === 0) return '';
    const label = remaining.length === 1 ? 'Map' : 'Maps';
    return `<div class="vetobox done"><div class="veto-head">${label}</div>
      <div class="veto-final">${remaining.map(mp => '<span class="veto-map play">' + esc(mp) + '</span>').join('')}</div></div>`;
  }

  const myTurn = (myTeamId && v.turn === myTeamId) || (isAdminV);
  const turnName = v.turn ? teamName(v.turn) : '';
  const canBanNow = (myTeamId && v.turn === myTeamId) || isAdminV;
  const left = (v.banCount || 0) - banned.length;

  let h = `<div class="vetobox"><div class="veto-head">Map veto \u00b7 ${esc(turnName)} to ban <span class="muted">(${left} left)</span></div>`;
  if (banned.length) {
    h += '<div class="veto-banned">' + banned.map(b => '<span class="veto-map banned">' + esc(b.map) + '</span>').join('') + '</div>';
  }
  h += '<div class="veto-remaining">' + remaining.map(mp =>
    canBanNow
      ? '<button class="veto-map ban" data-veto-map="' + esc(mp) + '">' + esc(mp) + '</button>'
      : '<span class="veto-map avail">' + esc(mp) + '</span>'
  ).join('') + '</div></div>';
  return h;
}

function wireVeto(box, m) {
  if (!m.veto || m.veto.done) return;
  box.querySelectorAll('[data-veto-map]').forEach(btn => {
    btn.onclick = async () => {
      const map = btn.dataset.vetoMap;
      const body = { matchId: m.id, map: map, token: myToken() };
      // if organizer is banning on behalf of the team whose turn it is
      if (viewerIsAdmin() && (!T.viewer || T.viewer.teamId !== m.veto.turn)) body.asTeam = m.veto.turn;
      try {
        await api('/api/t/' + T.id + '/veto_ban', body);
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

let connectorRedraws = [];
function drawConnectors(wrap) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connectors');
  wrap.prepend(svg);
  const draw = () => {
    svg.setAttribute('width', wrap.scrollWidth);
    svg.setAttribute('height', wrap.scrollHeight);
    let paths = '';
    for (const m of T.matches) {
      if (!m.winnerTo) continue;
      const a = wrap.querySelector('[data-mid="' + m.id + '"]');
      const b = wrap.querySelector('[data-mid="' + m.winnerTo.id + '"]');
      if (!a || !b) continue; // cross-section drops handled by "Winner/Loser of" text
      const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
      const mx = Math.round((x1 + x2) / 2);
      paths += '<path d="M ' + x1 + ' ' + y1 + ' L ' + mx + ' ' + y1 + ' L ' + mx + ' ' + y2 + ' L ' + x2 + ' ' + y2 + '"/>';
    }
    svg.innerHTML = paths;
  };
  draw();
  connectorRedraws.push(draw);
}

function bracketColumns(el, bracket, title, gfMatch) {
  const ms = T.matches.filter(m => m.bracket === bracket);
  if (!ms.length) return;
  const rounds = Math.max.apply(null, ms.map(m => m.round));
  const sec = document.createElement('div');
  sec.className = 'bsection';
  if (title) sec.innerHTML = `<div class="bsection-title ${bracket}">${esc(title)}</div>`;
  const wrap = document.createElement('div');
  wrap.className = 'bracket';
  const inner = document.createElement('div');
  inner.className = 'binner';
  for (let r = 1; r <= rounds; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const head = document.createElement('div');
    head.className = 'bcol-title';
    head.textContent = colLabel(bracket, r, rounds);
    col.appendChild(head);
    mapsLine(bracket, r, col);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    for (const m of ms.filter(x => x.round === r).sort((a, b) => a.index - b.index)) {
      mc.appendChild(matchBox(m));
    }
    col.appendChild(mc);
    inner.appendChild(col);
  }
  if (gfMatch) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const head = document.createElement('div');
    head.className = 'bcol-title';
    head.textContent = 'GRAND FINAL';
    col.appendChild(head);
    mapsLine('gf', 1, col);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    mc.appendChild(matchBox(gfMatch));
    col.appendChild(mc);
    inner.appendChild(col);
  }
  wrap.appendChild(inner);
  sec.appendChild(wrap);
  el.appendChild(sec);
  drawConnectors(inner);
}

function alignBracketSections(el) {
  const inners = Array.from(el.querySelectorAll('.binner'));
  let w = 0;
  for (const i of inners) { i.style.width = ''; w = Math.max(w, i.scrollWidth); }
  for (const i of inners) i.style.width = w + 'px';
  // align section titles with the bracket blocks
  for (const t of el.querySelectorAll('.bsection-title')) {
    t.style.width = w + 'px';
    t.style.maxWidth = '100%';
  }
}

function drawBracket(el) {
  el.innerHTML = '';
  connectorRedraws = [];
  buildFeeders();
  if (!T.matches.length) {
    drawBracketPreview(el);
    return;
  }

  if (T.competition === 'ffa') return drawFfaRounds(el);

  if (T.bracketType === 'swiss') return drawSwissRounds(el);

  if (T.bracketType === 'double') {
    const gf = T.matches.find(m => m.bracket === 'gf');
    bracketColumns(el, 'wb', 'Winners bracket', gf);
    bracketColumns(el, 'lb', 'Losers bracket');
    alignBracketSections(el);
    for (const f of connectorRedraws) f();
    return;
  }

  bracketColumns(el, 'wb', '');
  alignBracketSections(el);
  for (const f of connectorRedraws) f();
}

// ---- preview (before the bracket is generated) ----

function previewSeedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const next = [];
    const m = order.length * 2;
    for (const seed of order) { next.push(seed); next.push(m + 1 - seed); }
    order = next;
  }
  return order;
}

// how many teams the bracket will have: locked teams if formed, else cap, else current entrant estimate
function expectedTeamCount() {
  if (T.teams && T.teams.length) return T.teams.length;
  if (T.maxTeams && T.maxTeams > 0) return T.maxTeams;
  // estimate from signups
  if (T.competition === 'ffa' || T.teamSize === 1) return T.players.length;
  if (T.formation === 'premade') {
    const names = {};
    for (const p of T.players) if (p.teamName) names[p.teamName.toLowerCase()] = 1;
    return Object.keys(names).length;
  }
  // draft: one team per captain isn't known yet; fall back to players/teamSize
  return Math.floor(T.players.length / T.teamSize);
}

function seedLabelMap() {
  // maps seed number -> team name, when teams already exist
  const m = {};
  if (T.teams) for (const t of T.teams) m[t.seed] = t.name;
  return m;
}

// Build the same match/link topology the server's buildDouble/buildSingle produce,
// for a bracket of `size` (power of two). Returns { matches, feeders } where feeders is
// keyed 'bracket:round:index:slot' -> { type:'Winner'|'Loser', bracket, round, index }.
function virtualBracket(size, isDouble) {
  const R = Math.round(Math.log2(size));
  const mk = (bracket, round, index) => ({ bracket, round, index, id: bracket + ':' + round + ':' + index, winnerTo: null, loserTo: null });
  const all = [];
  const wb = {}, lb = {};
  for (let r = 1; r <= R; r++) {
    wb[r] = [];
    const count = size / Math.pow(2, r);
    for (let i = 0; i < count; i++) { const m = mk('wb', r, i); wb[r].push(m); all.push(m); }
  }
  let gf = null;
  if (isDouble) {
    const lbRounds = 2 * R - 2;
    for (let q = 1; q <= lbRounds; q++) {
      lb[q] = [];
      const k = (q % 2 === 1) ? (q + 3) / 2 : (q + 2) / 2;
      const count = size / Math.pow(2, k);
      for (let i = 0; i < count; i++) { const m = mk('lb', q, i); lb[q].push(m); all.push(m); }
    }
    gf = mk('gf', 1, 0); all.push(gf);
    for (let r = 1; r <= R; r++) {
      wb[r].forEach((m, i) => {
        if (r < R) m.winnerTo = { id: wb[r + 1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
        else m.winnerTo = { id: gf.id, slot: 1 };
        if (r === 1) m.loserTo = { id: lb[1][Math.floor(i / 2)].id, slot: (i % 2) + 1 };
        else {
          const q = 2 * r - 2;
          const cnt = lb[q].length;
          const j = (r % 2 === 0) ? (cnt - 1 - i) : i;
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
  } else {
    for (let r = 1; r < R; r++) wb[r].forEach((m, i) => { m.winnerTo = { id: wb[r + 1][Math.floor(i / 2)].id, slot: (i % 2) + 1 }; });
  }
  // build feeders keyed by destination id:slot
  const byId = {}; for (const m of all) byId[m.id] = m;
  const fd = {};
  for (const m of all) {
    if (m.winnerTo) fd[m.winnerTo.id + ':' + m.winnerTo.slot] = { type: 'Winner', m };
    if (m.loserTo) fd[m.loserTo.id + ':' + m.loserTo.slot] = { type: 'Loser', m };
  }
  return { all, byId, fd };
}

// human label for a virtual match, matching live mLabel style
function vLabel(m, isDouble) {
  if (m.bracket === 'gf') return 'GRAND FINAL';
  const p = m.bracket === 'lb' ? 'LB ' : (isDouble ? 'WB ' : '');
  return p + 'R' + m.round + ' M' + (m.index + 1);
}

function drawBracketPreview(el) {
  const n = expectedTeamCount();

  // header with format + a clear "preview" note
  const head = document.createElement('div');
  head.className = 'panel section';
  const capNote = T.maxTeams ? ('capped at ' + T.maxTeams + ' teams') : 'uncapped';
  head.innerHTML = `<h2>Format <span class="h2-strong">preview</span></h2>
    <p style="margin:0 0 4px">${esc(typeLine(T))}</p>
    <p class="muted" style="margin:0 0 8px">${esc(planSummary(T))}</p>
    <p class="muted small" style="margin:0">This is a preview \u2014 ${esc(capNote)}. Seeds fill in as teams are confirmed; the real bracket is generated when the organizer starts it.</p>`;
  el.appendChild(head);

  if (T.competition === 'ffa') { drawFfaPreview(el, n); return; }
  if (T.bracketType === 'swiss') { drawSwissPreview(el, n); return; }
  if (n < 2) {
    const p = document.createElement('div');
    p.className = 'panel section';
    p.innerHTML = '<div class="empty">Not enough teams yet to preview a bracket.</div>';
    el.appendChild(p);
    return;
  }

  const size = 1; let pw = 1; while (pw < n) pw *= 2; // nextPow2
  const bracketSize = pw;
  const R = Math.log2(bracketSize);
  const order = previewSeedOrder(bracketSize);
  const names = seedLabelMap();

  // slot label: real name if that seed is taken, "Seed N" if within team count, "bye" otherwise
  const slotLabel = seed => {
    if (seed > n) return { txt: 'bye', bye: true };
    if (names[seed]) return { txt: names[seed], seed, real: true };
    return { txt: 'Seed ' + seed, seed, tbd: true };
  };

  const plan = T.plan || {};
  const boForRound = r => {
    if (T.bracketType === 'double') return r === R ? (plan.wbFinal || 3) : (plan.wb || 3);
    return r === R ? (plan.final || 5) : r === R - 1 ? (plan.semi || 3) : (plan.early || 3);
  };

  const buildPreviewSection = (title, cls) => {
    const sec = document.createElement('div');
    sec.className = 'bsection';
    sec.innerHTML = title ? `<div class="bsection-title ${cls}">${esc(title)}</div>` : '';
    const wrap = document.createElement('div');
    wrap.className = 'bracket';
    const inner = document.createElement('div');
    inner.className = 'binner';
    return { sec, wrap, inner };
  };

  // WINNERS/MAIN bracket preview
  const { sec, wrap, inner } = buildPreviewSection(T.bracketType === 'double' ? 'Winners bracket' : '', 'wb');
  let roundSlots = [];
  for (let i = 0; i < bracketSize; i += 2) roundSlots.push([order[i], order[i + 1]]);

  const isDouble = T.bracketType === 'double';
  const VB = virtualBracket(bracketSize, isDouble);
  const idFor = (r, i) => 'pw_' + r + '_' + i;
  const wbTag = (r, i) => (isDouble ? 'WB ' : '') + 'R' + r + ' M' + (i + 1);
  // feeder text for a given destination match+slot, from the real topology
  const feederText = (destId, slot, seedFallback) => {
    const f = VB.fd[destId + ':' + slot];
    if (!f) return seedFallback || { txt: 'TBD', tbd: true };
    return { txt: f.type + ' of ' + vLabel(f.m, isDouble), tbd: true };
  };
  for (let r = 1; r <= R; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = colLabel('wb', r, R);
    col.appendChild(h);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    if (r === 1) {
      roundSlots.forEach((pair, i) => {
        const box = previewBox(slotLabel(pair[0]), slotLabel(pair[1]), boForRound(r), wbTag(r, i));
        box.dataset.pid = idFor(r, i);
        mc.appendChild(box);
      });
    } else {
      const count = bracketSize / Math.pow(2, r);
      for (let i = 0; i < count; i++) {
        const destId = 'wb:' + r + ':' + i;
        const box = previewBox(feederText(destId, 1), feederText(destId, 2), boForRound(r), wbTag(r, i));
        box.dataset.pid = idFor(r, i);
        mc.appendChild(box);
      }
    }
    col.appendChild(mc);
    inner.appendChild(col);
  }
  // grand final placeholder for double
  if (T.bracketType === 'double') {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = 'GRAND FINAL';
    col.appendChild(h);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    const gfbox = previewBox(feederText('gf:1:0', 1, { txt: 'Winner of winners bracket', tbd: true }),
                             feederText('gf:1:0', 2, { txt: 'Winner of losers bracket', tbd: true }), plan.gf || 5, 'GRAND FINAL');
    gfbox.dataset.pid = 'pw_gf';
    mc.appendChild(gfbox);
    col.appendChild(mc);
    inner.appendChild(col);
  }
  wrap.appendChild(inner);
  sec.appendChild(wrap);
  el.appendChild(sec);
  // connectors: WB round r box i -> round r+1 box floor(i/2); WB final -> GF
  drawPreviewConnectors(inner, (rr, ii) => idFor(rr, ii), R, 'pw_gf');

  // LOSERS bracket preview (structure only, all TBD)
  if (T.bracketType === 'double' && R >= 1) {
    const lbRounds = 2 * R - 2;
    if (lbRounds >= 1) {
      const { sec: lsec, wrap: lwrap, inner: linner } = buildPreviewSection('Losers bracket', 'lb');
      const lbCounts = [];
      const lbCountAt = q => {
        const k = (q % 2 === 1) ? (q + 3) / 2 : (q + 2) / 2;
        return bracketSize / Math.pow(2, k);
      };
      const lbTag = (q, i) => 'LB R' + q + ' M' + (i + 1);
      for (let q = 1; q <= lbRounds; q++) {
        const col = document.createElement('div');
        col.className = 'bcol';
        const h = document.createElement('div');
        h.className = 'bcol-title';
        h.textContent = colLabel('lb', q, lbRounds);
        col.appendChild(h);
        const mc = document.createElement('div');
        mc.className = 'bcol-matches';
        const count = lbCountAt(q);
        lbCounts.push(count);
        for (let i = 0; i < count; i++) {
          const destId = 'lb:' + q + ':' + i;
          const box = previewBox(feederText(destId, 1), feederText(destId, 2),
                                 (q === lbRounds ? (plan.lbFinal || 3) : (plan.lb || 3)), lbTag(q, i));
          box.dataset.pid = 'pl_' + q + '_' + i;
          mc.appendChild(box);
        }
        col.appendChild(mc);
        linner.appendChild(col);
      }
      lwrap.appendChild(linner);
      lsec.appendChild(lwrap);
      el.appendChild(lsec);
      // LB connectors: minor round (odd q, same count as next) -> same index; major round (even q, halves) -> floor(i/2)
      drawPreviewConnectorsLB(linner, lbCounts);
    }
  }

  alignBracketSections(el);
  // redraw connectors after alignment settles widths
  for (const f of connectorRedraws) f();
}

// generic preview connector: for each round r (1..R-1), link box i to next round's floor(i/2)
function drawPreviewConnectors(inner, idFn, R, gfId) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connectors');
  inner.prepend(svg);
  const draw = () => {
    svg.setAttribute('width', inner.scrollWidth);
    svg.setAttribute('height', inner.scrollHeight);
    let paths = '';
    const link = (fromId, toId) => {
      const a = inner.querySelector('[data-pid="' + fromId + '"]');
      const b = inner.querySelector('[data-pid="' + toId + '"]');
      if (!a || !b) return;
      const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
      const mx = Math.round((x1 + x2) / 2);
      paths += '<path d="M ' + x1 + ' ' + y1 + ' L ' + mx + ' ' + y1 + ' L ' + mx + ' ' + y2 + ' L ' + x2 + ' ' + y2 + '"/>';
    };
    for (let r = 1; r < R; r++) {
      let i = 0;
      while (inner.querySelector('[data-pid="' + idFn(r, i) + '"]')) {
        link(idFn(r, i), idFn(r + 1, Math.floor(i / 2)));
        i++;
      }
    }
    if (gfId && inner.querySelector('[data-pid="' + gfId + '"]')) {
      link(idFn(R, 0), gfId);
    }
    svg.innerHTML = paths;
  };
  draw();
  connectorRedraws.push(draw);
}

function drawPreviewConnectorsLB(inner, counts) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'connectors');
  inner.prepend(svg);
  const draw = () => {
    svg.setAttribute('width', inner.scrollWidth);
    svg.setAttribute('height', inner.scrollHeight);
    let paths = '';
    const link = (fromId, toId) => {
      const a = inner.querySelector('[data-pid="' + fromId + '"]');
      const b = inner.querySelector('[data-pid="' + toId + '"]');
      if (!a || !b) return;
      const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
      const mx = Math.round((x1 + x2) / 2);
      paths += '<path d="M ' + x1 + ' ' + y1 + ' L ' + mx + ' ' + y1 + ' L ' + mx + ' ' + y2 + ' L ' + x2 + ' ' + y2 + '"/>';
    };
    for (let q = 1; q < counts.length; q++) {
      const same = counts[q] === counts[q - 1];
      for (let i = 0; i < counts[q - 1]; i++) {
        const toIdx = same ? i : Math.floor(i / 2);
        link('pl_' + q + '_' + i, 'pl_' + (q + 1) + '_' + toIdx);
      }
    }
    svg.innerHTML = paths;
  };
  draw();
  connectorRedraws.push(draw);
}

function previewBox(a, b, bo, label) {
  const box = document.createElement('div');
  box.className = 'bmatch preview';
  const row = lbl => `<div class="brow"><span class="bname ${lbl.real ? '' : 'tbd'}">${lbl.seed ? '<span class="seedtag">' + lbl.seed + '</span>' : ''}${esc(lbl.txt)}</span><span class="bscore"></span></div>`;
  box.innerHTML = `<div class="botag">${label ? esc(label) + ' \u00b7 ' : ''}BO${bo}</div>` + row(a) + row(b);
  return box;
}

function drawSwissPreview(el, n) {
  const sec = document.createElement('div');
  sec.className = 'panel section';
  const rounds = (T.plan && T.plan.rounds) || Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
  sec.innerHTML = `<h2>Swiss <span class="h2-strong">preview</span></h2>
    <p class="muted small" style="margin:0">${esc(String(n))} teams expected \u00b7 pairings are generated round by round once the tournament starts. Round 1 pairs by seed; later rounds by standings.</p>`;
  el.appendChild(sec);
}

function drawFfaPreview(el, n) {
  const per = T.ffaCfg.perMatch;
  const lobbies = Math.max(1, Math.ceil(n / per));
  const sec = document.createElement('div');
  sec.className = 'panel section';
  sec.innerHTML = `<h2>Round 1 <span class="h2-strong">preview</span></h2>
    <p class="muted small" style="margin:0 0 10px">${esc(String(n))} entrants expected \u2192 ${lobbies} lobb${lobbies === 1 ? 'y' : 'ies'} of up to ${per}. Exact groupings are drawn when the tournament starts.</p>`;
  const grid = document.createElement('div');
  grid.className = 'ffagrid';
  for (let i = 0; i < lobbies; i++) {
    const card = document.createElement('div');
    card.className = 'ffacard preview';
    card.innerHTML = `<div class="mono small muted">LOBBY ${i + 1}</div><ul><li class="muted" style="font-style:italic">entrants assigned at start</li></ul>`;
    grid.appendChild(card);
  }
  sec.appendChild(grid);
  el.appendChild(sec);
}

function drawSwissRounds(el) {
  const ms = T.matches.filter(m => m.bracket === 'sw');
  const rounds = Math.max.apply(null, ms.map(m => m.round));
  for (let r = rounds; r >= 1; r--) {
    const sec = document.createElement('div');
    sec.className = 'panel section';
    sec.innerHTML = `<h2>Round <span class="h2-strong">${r} / ${T.cfg.rounds}</span></h2>`;
    mapsLine('sw', r, sec);
    const q = document.createElement('div');
    q.className = 'queue';
    q.style.marginTop = '10px';
    sec.appendChild(q);
    fillQueue(q, ms.filter(m => m.round === r && m.team2 !== 'BYE').sort((a, b) => a.index - b.index), true);
    for (const bm of ms.filter(m => m.round === r && m.team2 === 'BYE')) {
      const d = document.createElement('div');
      d.className = 'qitem done';
      d.innerHTML = `<span class="qround">BYE</span><span class="qteams">${esc(teamName(bm.team1))}</span><span class="qscore muted">free win</span>`;
      q.appendChild(d);
    }
    el.appendChild(sec);
  }
  const gf = T.matches.find(m => m.bracket === 'gf');
  if (gf) {
    const sec = document.createElement('div');
    sec.className = 'panel section';
    sec.innerHTML = '<h2>Final</h2>';
    mapsLine('gf', 1, sec);
    const q = document.createElement('div');
    q.className = 'queue';
    q.style.marginTop = '10px';
    sec.appendChild(q);
    fillQueue(q, [gf], true);
    el.prepend(sec);
  }
}

function drawFfaRounds(el) {
  const ms = T.matches.filter(m => m.bracket === 'ffa');
  const rounds = Math.max.apply(null, ms.map(m => m.round));
  for (let r = rounds; r >= 1; r--) {
    const roundMs = ms.filter(m => m.round === r).sort((a, b) => a.index - b.index);
    const isFinal = roundMs.length === 1 && r === rounds && r > 1;
    const sec = document.createElement('div');
    sec.className = 'panel section';
    sec.innerHTML = `<h2>${isFinal ? 'Final' : 'Round <span class="h2-strong">' + r + '</span>'}</h2>`;
    mapsLine('ffa', r, sec);
    const grid = document.createElement('div');
    grid.className = 'ffagrid';
    grid.style.marginTop = '10px';
    for (const m of roundMs) {
      const card = document.createElement('div');
      card.className = 'ffacard ' + m.status;
      const pointsMode = T.ffaCfg.mode === 'points' && !m.isFinal;
      let head;
      if (m.isFinal) head = 'FINAL LOBBY · winner takes the tournament';
      else if (pointsMode) head = 'LOBBY ' + (m.index + 1) + ' · ' + m.entrants.length + ' entrants · placement points';
      else {
        const need = roundMs.length === 1 ? 1 : Math.min(T.ffaCfg.advance, m.entrants.length - 1);
        head = 'LOBBY ' + (m.index + 1) + ' · ' + m.entrants.length + ' entrants · top ' + need + ' advance' + (need === 1 ? 's' : '');
      }
      let list = m.entrants.slice();
      if (pointsMode && m.status === 'done' && m.points) list.sort((a, b) => (m.points[b] || 0) - (m.points[a] || 0));
      card.innerHTML = `<div class="mono small muted">${head}</div>
        <ul>${list.map(id => {
          if (pointsMode) {
            const pts = m.status === 'done' && m.points ? m.points[id] : null;
            return `<li><span>${esc(teamName(id))}</span>${pts != null ? '<span class="mono small" style="color:var(--amber)">' + pts + ' pts</span>' : ''}</li>`;
          }
          const won = m.winners && m.winners.indexOf(id) >= 0;
          const cls = m.status === 'done' ? (won ? 'won' : 'lost') : '';
          return `<li class="${cls}"><span>${esc(teamName(id))}</span>${won ? '<span class="mono small">' + (m.isFinal ? 'CHAMPION' : 'ADV') + '</span>' : ''}</li>`;
        }).join('')}</ul>
        ${!T.imported && ((m.status === 'ready' && canReportMatch(m)) || (m.status === 'done' && viewerIsAdmin())) ? `<div style="margin-top:10px;text-align:right"><button class="btn ${m.status === 'ready' ? 'amber' : 'ghost'} small">${m.status === 'ready' ? 'Report result' : 'Correct'}</button></div>` : ''}`;
      const btn = card.querySelector('button');
      if (btn) btn.onclick = () => reportFfa(m.id);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    el.appendChild(sec);
  }
}

// ----- report score -----

function reportScore(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  if (m.bracket === 'ffa') return reportFfa(matchId);
  const maxW = Math.ceil(m.bo / 2);
  const maps = mapsFor(m.bracket, m.round);
  modal(`
    <h3>Report score — ${esc(roundLabel(m))}</h3>
    <p class="muted small">Best of ${m.bo} — first to ${maxW}.${m.hcap ? ' Upper bracket finalist starts 1-0 up.' : ''}
    You can save a running score (e.g. 1-0) so everyone can follow along — the match completes automatically when a team reaches ${maxW}.</p>
    ${maps.length ? '<div class="mapblock"><div class="mapblock-head"><span>MAP POOL</span></div>' + mapRows(maps) + '</div>' : ''}
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="rs1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${m.score1 != null ? m.score1 : (m.hcap ? 1 : 0)}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="rs2" min="0" max="${maxW}" value="${m.score2 != null ? m.score2 : 0}"></div>
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save score</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/report', {
          matchId,
          score1: root.querySelector('#rs1').value,
          score2: root.querySelector('#rs2').value,
          token: myToken()
        });
        closeModal();
        toast('Score saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function reportFfa(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  if (T.ffaCfg.mode === 'points' && !m.isFinal) return reportFfaPoints(m);
  const roundCount = T.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
  const need = m.isFinal ? 1 : (roundCount === 1 ? 1 : Math.min(T.ffaCfg.advance, m.entrants.length - 1));
  modal(`
    <h3>Report result — Lobby ${m.index + 1}</h3>
    <p class="muted small">Tick the ${need === 1 ? 'winner' : 'top ' + need}.</p>
    <div id="ffaWinners">
      ${m.entrants.map(id => `
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:14px;color:var(--text);margin:8px 0">
          <input type="checkbox" value="${id}"${m.winners && m.winners.indexOf(id) >= 0 ? ' checked' : ''}> ${esc(teamName(id))}
        </label>`).join('')}
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save result</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      const winners = Array.from(root.querySelectorAll('#ffaWinners input:checked')).map(i => i.value);
      if (winners.length !== need) return toast('Select exactly ' + need, true);
      try {
        await api('/api/t/' + T.id + '/report', { matchId, winners, token: myToken() });
        closeModal();
        toast('Result saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function reportFfaPoints(m) {
  modal(`
    <h3>Report result — Lobby ${m.index + 1}</h3>
    <p class="muted small">Enter each ${T.teamSize === 1 ? 'player' : 'team'}'s points for this round (e.g. by placement).</p>
    ${m.entrants.map(id => `
      <div class="row" style="align-items:center;gap:10px;margin:8px 0">
        <div style="flex:1">${esc(teamName(id))}</div>
        <input type="number" class="ffaPts" data-id="${id}" min="0" max="1000" style="flex:0 0 100px" value="${m.points && m.points[id] != null ? m.points[id] : ''}" placeholder="pts" autocomplete="off">
      </div>`).join('')}
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save result</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      const points = {};
      for (const inp of root.querySelectorAll('.ffaPts')) {
        if (inp.value === '') return toast('Enter points for everyone (0 is fine)', true);
        points[inp.dataset.id] = inp.value;
      }
      try {
        await api('/api/t/' + T.id + '/report', { matchId: m.id, points, token: myToken() });
        closeModal();
        toast('Result saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ----- standings -----

function drawStandings(el) {
  if (T.status !== 'running' && T.status !== 'finished') {
    el.innerHTML = '<div class="panel"><div class="empty">Standings appear once matches begin.</div></div>';
    return;
  }

  if (T.bracketType === 'swiss' && T.competition === 'team') {
    // recompute swiss table client-side
    const S = {};
    for (const team of T.teams) S[team.id] = { id: team.id, w: 0, l: 0, gd: 0 };
    for (const m of T.matches) {
      if (m.bracket !== 'sw') continue;
      if (m.status === 'bye') { const id = m.team1 !== 'BYE' ? m.team1 : m.team2; if (S[id]) { S[id].w++; S[id].gd += 1; } }
      else if (m.status === 'done') {
        const ws = m.winner === m.team1 ? m.score1 : m.score2;
        const ls = m.winner === m.team1 ? m.score2 : m.score1;
        if (S[m.winner]) { S[m.winner].w++; S[m.winner].gd += ws - ls; }
        if (S[m.loser]) { S[m.loser].l++; S[m.loser].gd -= ws - ls; }
      }
    }
    const rows = Object.values(S).sort((a, b) => b.w - a.w || b.gd - a.gd || teamSeed(a.id) - teamSeed(b.id));
    el.innerHTML = `<div class="panel section"><h2>Swiss <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>Game diff</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i === 0 ? 'rank1' : i === 1 ? 'rank2' : i === 2 ? 'rank3' : ''}">
        <td class="mono">${i + 1}</td><td>${esc(teamName(r.id))}${T.championTeamId === r.id ? ' 🏆' : ''}</td>
        <td class="mono">${r.w}</td><td class="mono">${r.l}</td><td class="mono">${r.gd > 0 ? '+' : ''}${r.gd}</td></tr>`).join('')}
      </tbody></table></div>`;
    return;
  }

  if (T.competition === 'ffa' && T.ffaCfg.mode === 'points') {
    const tot = {};
    for (const team of T.teams) tot[team.id] = 0;
    for (const m of T.matches) {
      if (m.bracket !== 'ffa' || !m.points) continue;
      for (const id of Object.keys(m.points)) if (tot[id] !== undefined) tot[id] += m.points[id];
    }
    const rows = T.teams.slice().sort((a, b) =>
      (T.championTeamId === b.id) - (T.championTeamId === a.id) || tot[b.id] - tot[a.id] || a.seed - b.seed);
    el.innerHTML = `<div class="panel section"><h2>Points <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>#</th><th>${T.teamSize === 1 ? 'Player' : 'Team'}</th><th>Points</th><th></th></tr></thead><tbody>
      ${rows.map((team, i) => `<tr class="${i === 0 ? 'rank1' : i === 1 ? 'rank2' : i === 2 ? 'rank3' : ''}">
        <td class="mono">${i + 1}</td><td>${esc(team.name)}${T.championTeamId === team.id ? ' \ud83c\udfc6' : ''}</td>
        <td class="mono">${tot[team.id]}</td>
        <td class="small muted">${team.out ? 'Cut after round ' + team.out.round : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    return;
  }

  // imported tournaments: use Challonge's final_rank directly (handles ties)
  if (T.imported) {
    const rows = T.teams.slice().sort((a, b) => (a.finalRank || 999) - (b.finalRank || 999) || a.seed - b.seed);
    const html = rows.map(team => {
      const rk = team.finalRank || '\u2014';
      const cls = rk === 1 ? 'rank1' : rk === 2 ? 'rank2' : rk === 3 ? 'rank3' : '';
      const note = team.id === T.championTeamId ? '\ud83c\udfc6 Champion' : '';
      return `<tr class="${cls}"><td class="mono">${rk}</td><td>${esc(team.name)}</td><td class="small muted">${note}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="panel section"><h2>Final <span class="h2-strong">Standings</span></h2>
      <table><thead><tr><th>Place</th><th>Team</th><th></th></tr></thead><tbody>${html}</tbody></table></div>`;
    return;
  }

  // elimination formats: rank by how far each team got
  const stage = team => {
    if (T.championTeamId === team.id) return 1e9;
    if (!team.out) return 1e8; // still alive
    if (team.out.bracket === 'gf') return 1e6;
    if (team.out.bracket === 'lb') return 1000 + team.out.round;
    return team.out.round; // wb (single elim) or ffa round
  };
  const rows = T.teams.slice().sort((a, b) => stage(b) - stage(a) || a.seed - b.seed);
  let rank = 0, prevStage = null, shown = 0;
  const html = rows.map(team => {
    shown++;
    const st = stage(team);
    if (st !== prevStage) { rank = shown; prevStage = st; }
    const label = T.championTeamId === team.id ? '1' : (!team.out ? '—' : String(rank));
    const note = T.championTeamId === team.id ? '🏆 Champion' : (!team.out ? 'Still in' :
      team.out.bracket === 'gf' ? 'Lost the final' :
      team.out.bracket === 'lb' ? 'Out in LB round ' + team.out.round :
      team.out.bracket === 'ffa' ? 'Out in round ' + team.out.round :
      'Out in round ' + team.out.round);
    return `<tr class="${label === '1' ? 'rank1' : label === '2' ? 'rank2' : (label === '3' ? 'rank3' : '')}">
      <td class="mono">${label}</td><td>${esc(team.name)}</td><td class="small muted">${esc(note)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="panel section"><h2>Standings</h2>
    <table><thead><tr><th>Place</th><th>${T.teamSize === 1 ? 'Player' : 'Team'}</th><th>Result</th></tr></thead>
    <tbody>${html}</tbody></table></div>`;
}

// ----- admin -----

async function drawAdmin(el) {
  el.innerHTML = '<div class="panel"><div class="empty">Loading…</div></div>';
  let secrets = null;
  try { secrets = await api('/api/t/' + T.id + '/secrets?admin=' + encodeURIComponent(adminToken())); }
  catch (e) { el.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }

  const base = location.origin + '/t/' + T.id;
  const copyRow = (label, value) => `
    <label>${esc(label)}</label>
    <div class="copybox"><input type="text" readonly value="${esc(value)}"><button class="btn small" data-copy="${esc(value)}">Copy</button></div>`;

  let html = `<div class="panel section"><h2>Share links</h2>
    ${copyRow('Public link — share with everyone', base)}
    ${copyRow('Organizer link — KEEP PRIVATE (full control)', base + '?admin=' + secrets.adminToken)}
  </div>`;

  if (['signup', 'draft', 'drafted'].indexOf(T.status) >= 0) {
    const locked = T.status !== 'signup';
    const boSel = (id, val) => `<select id="${id}">${[1,3,5,7].map(o => '<option value="' + o + '"' + (o === val ? ' selected' : '') + '>Bo' + o + '</option>').join('')}</select>`;
    const p = T.plan || {};
    const fc = T.ffaCfg || {};
    const dis = locked ? ' disabled' : '';
    html += `<div class="panel section"><h2>Format</h2>
      ${locked ? '<p class="muted small">Team setup fields are locked while the draft/teams exist \u2014 reopen signups to change them. Bracket, match lengths and caps stay editable until the bracket starts.</p>' : '<p class="muted small">Fix wrong options here. Everything is editable until the bracket starts.</p>'}
      <label>Competition</label>
      <select id="af_comp"${dis}><option value="team"${T.competition === 'team' ? ' selected' : ''}>Team bracket</option><option value="ffa"${T.competition === 'ffa' ? ' selected' : ''}>FFA</option></select>
      <div id="af_team">
        <label>Team size</label>
        <select id="af_size"${dis}>${[1,2,3,4,5,6].map(n => '<option value="' + n + '"' + (n === T.teamSize && T.competition === 'team' ? ' selected' : '') + '>' + n + 'v' + n + '</option>').join('')}</select>
        <div id="af_formWrap">
          <label>Team formation</label>
          <select id="af_form"${dis}><option value="draft"${T.formation !== 'premade' ? ' selected' : ''}>Captains draft</option><option value="premade"${T.formation === 'premade' ? ' selected' : ''}>Premade teams</option></select>
          <div id="af_orderWrap">
            <label>Draft pick order</label>
            <select id="af_order"${dis}><option value="linear"${T.draftOrder !== 'snake' ? ' selected' : ''}>Bottom to top, every round</option><option value="snake"${T.draftOrder === 'snake' ? ' selected' : ''}>Snake (1\u2192N, N\u21921, ...)</option></select>
          </div>
        </div>
        <label>Bracket</label>
        <select id="af_bt"><option value="single"${T.bracketType === 'single' ? ' selected' : ''}>Single elimination</option><option value="double"${T.bracketType === 'double' ? ' selected' : ''}>Double elimination</option><option value="swiss"${T.bracketType === 'swiss' ? ' selected' : ''}>Swiss</option></select>
        <div id="af_pSingle">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Early rounds</div>${boSel('af_early', p.early || 3)}</div>
            <div style="flex:1"><div class="muted small">Semifinal</div>${boSel('af_semi', p.semi || 3)}</div>
            <div style="flex:1"><div class="muted small">Final</div>${boSel('af_final', p.final || 5)}</div>
          </div>
        </div>
        <div id="af_pDouble" style="display:none">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Winners bracket rounds</div>${boSel('af_wb', p.wb || 3)}</div>
            <div style="flex:1"><div class="muted small">Winners bracket final</div>${boSel('af_wbf', p.wbFinal || 3)}</div>
          </div>
          <div class="row" style="gap:10px;margin-top:8px">
            <div style="flex:1"><div class="muted small">Losers bracket rounds</div>${boSel('af_lb', p.lb || 3)}</div>
            <div style="flex:1"><div class="muted small">Losers bracket final</div>${boSel('af_lbf', p.lbFinal || 3)}</div>
          </div>
          <div class="row" style="gap:10px;margin-top:8px"><div style="flex:1"><div class="muted small">Grand final</div>${boSel('af_gf', p.gf || 5)}</div></div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_hcap"${p.lbHandicap || p.lbHandicap === undefined ? ' checked' : ''}> Upper bracket finalist starts the grand final 1-0 up
          </label>
        </div>
        <div id="af_pSwiss" style="display:none">
          <label>Match lengths</label>
          <div class="row" style="gap:10px">
            <div style="flex:1"><div class="muted small">Each match</div><select id="af_swbo"><option value="1"${p.bo === 1 ? ' selected' : ''}>Bo1</option><option value="3"${p.bo !== 1 ? ' selected' : ''}>Bo3</option></select></div>
            <div style="flex:1"><div class="muted small">Final</div>${boSel('af_swfbo', p.finalBo || 5)}</div>
          </div>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_swfinal"${p.final === 0 ? '' : ' checked'}> Final between the top 2 after the last round
          </label>
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
            <input type="checkbox" id="af_swfast"${p.fast ? ' checked' : ''}> Fast pairing \u2014 next matchup starts as soon as two teams are free
          </label>
        </div>
      </div>
      <div id="af_ffa" style="display:none">
        <label>Entrants</label>
        <select id="af_fsize"${dis}>${[1,2,3].map(n => '<option value="' + n + '"' + (n === T.teamSize && T.competition === 'ffa' ? ' selected' : '') + '>' + (n === 1 ? 'Solo players' : 'Teams of ' + n) + '</option>').join('')}</select>
        <label id="af_pmLabel">Players per FFA lobby</label>
        <select id="af_pm"></select>
        <label>Mode</label>
        <select id="af_fmode"><option value="points"${fc.mode !== 'elim' ? ' selected' : ''}>Points over rounds</option><option value="elim"${fc.mode === 'elim' ? ' selected' : ''}>Knockout</option></select>
        <div id="af_fpoints">
          <label>Number of rounds</label>
          <input type="number" id="af_frounds" min="1" max="10" value="${fc.rounds || 3}" autocomplete="off">
          <label>After each round</label>
          <div class="row" style="gap:10px;align-items:center">
            <select id="af_fcutmode" style="flex:1"><option value="0"${!fc.cutTo ? ' selected' : ''}>Everyone continues</option><option value="1"${fc.cutTo ? ' selected' : ''}>Cut to the top \u2026</option></select>
            <input type="number" id="af_fcutto" min="2" max="64" value="${fc.cutTo || 8}" style="flex:0 0 90px;${fc.cutTo ? '' : 'display:none'}" autocomplete="off">
          </div>
          <label>After the last round</label>
          <div class="row" style="gap:10px;align-items:center">
            <select id="af_ffinalmode" style="flex:1"><option value="0"${!fc.finalSize ? ' selected' : ''}>Highest points is champion</option><option value="1"${fc.finalSize ? ' selected' : ''}>Top \u2026 play a final lobby</option></select>
            <input type="number" id="af_ffinalsize" min="2" max="16" value="${fc.finalSize || 4}" style="flex:0 0 90px;${fc.finalSize ? '' : 'display:none'}" autocomplete="off">
          </div>
        </div>
        <div id="af_felim" style="display:none">
          <label>Advancing per lobby</label>
          <select id="af_fadv">${[1,2,3,4].map(n => '<option value="' + n + '"' + (n === (fc.advance || 1) ? ' selected' : '') + '>' + (n === 1 ? 'Winner only' : 'Top ' + n) + '</option>').join('')}</select>
        </div>
      </div>
      <label>Seeding</label>
      <select id="af_seed"${dis}><option value="rating"${T.seeding === 'rating' ? ' selected' : ''}>By rating</option><option value="random"${T.seeding === 'random' ? ' selected' : ''}>Random</option></select>
      <label>Max teams / entrants (0 = unlimited)</label>
      <input type="number" id="af_max" min="0" max="128" value="${T.maxTeams || 0}" autocomplete="off">
      <div style="margin-top:16px"><button class="btn amber" id="af_save">Save format</button></div>
    </div>`;
  }

  if (T.status === 'drafted' && T.competition === 'team' && (T.bracketType === 'single' || T.bracketType === 'double')) {
    const seeded = T.teams.slice().sort((a, b) => a.seed - b.seed);
    html += `<div class="panel section"><h2>Seeding</h2>
      <p class="muted small">Drag to reorder, or use the arrows. Seed 1 is the top seed. This determines the bracket \u2014 fixed once you start it.</p>
      <div style="margin:10px 0"><button class="btn ghost small" id="seedRandom">\ud83c\udfb2 Randomize</button>
      ${T.seeding === 'rating' ? '<button class="btn ghost small" id="seedByRating" style="margin-left:8px">Reset to rating order</button>' : ''}</div>
      <ol id="seedList" class="seedlist">
        ${seeded.map(tm => `<li class="seeditem" draggable="true" data-tid="${tm.id}">
          <span class="seednum"></span>
          <span class="seedname">${esc(tm.name)}</span>
          <span class="seedbtns"><button class="seedup" title="Move up">\u25b2</button><button class="seeddown" title="Move down">\u25bc</button></span>
        </li>`).join('')}
      </ol>
      <div style="margin-top:12px"><button class="btn amber" id="seedSave">Save seeding</button> <span class="muted small" id="seedDirty"></span></div>
    </div>`;
  }

  html += `<div class="panel section"><h2>Game setup</h2>
    <label>Description</label><textarea id="aiDesc" maxlength="500">${esc(T.description || '')}</textarea>
    <label>Lobby options</label><textarea id="aiLobby" maxlength="500">${esc(T.lobbyOptions || '')}</textarea>
    <label>Mods</label><input type="text" id="aiMods" maxlength="500" value="${esc(T.mods || '')}">
    <div style="margin-top:14px"><button class="btn" id="aiSave">Save setup</button></div>
  </div>`;

  if (['signup', 'draft', 'drafted'].indexOf(T.status) >= 0 && T.competition === 'team') {
    const v = T.veto || { enabled: false, mapPool: [], banCount: 0 };
    html += `<div class="panel section"><h2>Map vetoes</h2>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="vtEnabled" style="width:auto"${v.enabled ? ' checked' : ''}> Enable map vetoes</label>
      <div id="vtCfg" style="${v.enabled ? '' : 'display:none;'}margin-top:10px">
        <label>Map pool <span class="muted" style="font-weight:400">(one per line, at least 2)</span></label>
        <textarea id="vtMaps" rows="6">${esc((v.mapPool || []).join('\n'))}</textarea>
        <label style="margin-top:10px">Maps to ban before each match</label>
        <input type="number" id="vtBan" min="0" max="20" value="${v.banCount || 0}" style="width:100px">
        <div class="muted small" style="margin-top:6px">Captains alternate banning (higher seed bans first). Remaining map(s) are what they play. Editable until the bracket starts.</div>
      </div>
      <div style="margin-top:12px"><button class="btn amber" id="vtSave">Save vetoes</button></div>
    </div>`;
  }

  if (secrets.captains.length) {
    html += `<div class="panel section"><h2>Captain links</h2>
      <p class="muted small">Send each captain their link (Discord DM works). It lets them draft on their turn and report their matches. Opening a link binds that browser as captain.</p>
      ${secrets.captains.map(c => copyRow(c.teamName + (c.captainName && c.captainName !== c.teamName ? ' — ' + c.captainName : ''), base + '?cap=' + c.token)).join('')}
    </div>`;
  }

  html += `<div class="panel section"><h2>Organizer notes</h2>
    <ul class="muted small">
      <li>Substitutions: Players tab → Edit next to any player → overwrite name and rating with the sub's. Works mid-tournament.</li>
      <li>Maps per round: on the Bracket/Rounds tab, each round header has an "edit" link next to the map list.</li>
      <li>Running scores: reporting 1-0 in a Bo3 keeps the match LIVE; it completes when a team reaches the required wins.</li>
      <li>Corrections: you can fix a finished match as long as the follow-up match hasn't started.</li>
      <li>Data lives in the container volume — deleting the volume deletes tournaments.</li>
    </ul></div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'));
  });

  // ---- veto config ----
  const vtEnabled = document.getElementById('vtEnabled');
  if (vtEnabled) {
    vtEnabled.onchange = () => { document.getElementById('vtCfg').style.display = vtEnabled.checked ? 'block' : 'none'; };
    document.getElementById('vtSave').onclick = async () => {
      const maps = document.getElementById('vtMaps').value.split('\n').map(x => x.trim()).filter(x => x);
      const ban = parseInt(document.getElementById('vtBan').value, 10) || 0;
      const enabled = vtEnabled.checked;
      if (enabled && maps.length < 2) return toast('Map pool needs at least 2 maps', true);
      try {
        await api('/api/t/' + T.id + '/edit_info', { veto: { enabled, mapPool: maps, banCount: ban }, admin: adminToken() });
        await refresh();
        toast('Vetoes saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---- seeding editor ----
  const seedList = document.getElementById('seedList');
  if (seedList) {
    const renumber = () => {
      let i = 1;
      seedList.querySelectorAll('.seeditem').forEach(li => { li.querySelector('.seednum').textContent = i++; });
      const sd = document.getElementById('seedDirty'); if (sd) sd.textContent = 'unsaved changes';
    };
    renumber();
    const sd0 = document.getElementById('seedDirty'); if (sd0) sd0.textContent = '';

    // arrow buttons
    seedList.querySelectorAll('.seedup').forEach(b => b.onclick = e => {
      const li = e.target.closest('.seeditem'); const prev = li.previousElementSibling;
      if (prev) { seedList.insertBefore(li, prev); renumber(); }
    });
    seedList.querySelectorAll('.seeddown').forEach(b => b.onclick = e => {
      const li = e.target.closest('.seeditem'); const next = li.nextElementSibling;
      if (next) { seedList.insertBefore(next, li); renumber(); }
    });

    // drag and drop
    let dragEl = null;
    seedList.querySelectorAll('.seeditem').forEach(li => {
      li.addEventListener('dragstart', () => { dragEl = li; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('dragging'); dragEl = null; renumber(); });
    });
    seedList.addEventListener('dragover', e => {
      e.preventDefault();
      const after = [...seedList.querySelectorAll('.seeditem:not(.dragging)')].reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = e.clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, el: child };
        return closest;
      }, { offset: -Infinity, el: null }).el;
      if (!dragEl) return;
      if (after == null) seedList.appendChild(dragEl);
      else seedList.insertBefore(dragEl, after);
    });

    const saveOrder = async (order, randomize) => {
      try {
        await api('/api/t/' + T.id + '/reseed', randomize ? { randomize: 1, admin: adminToken() } : { order, admin: adminToken() });
        await refresh();
        toast('Seeding saved');
      } catch (e) { toast(e.message, true); }
    };
    document.getElementById('seedSave').onclick = () => {
      const order = [...seedList.querySelectorAll('.seeditem')].map(li => li.dataset.tid);
      saveOrder(order, false);
    };
    const rnd = document.getElementById('seedRandom');
    if (rnd) rnd.onclick = () => saveOrder(null, true);
    const byr = document.getElementById('seedByRating');
    if (byr) byr.onclick = async () => {
      // reset: order teams by their players' avg rating (desc)
      const withR = T.teams.map(tm => ({ id: tm.id, r: tm.playerIds.reduce((s, pid) => { const p = T.players.find(x => x.id === pid); return s + (p && p.rating || 0); }, 0) }));
      withR.sort((a, b) => b.r - a.r);
      saveOrder(withR.map(x => x.id), false);
    };
  }

  const afComp = document.getElementById('af_comp');
  if (afComp) {
    const g = id => document.getElementById(id);
    const syncPm = () => {
      const es = parseInt(g('af_fsize').value, 10);
      const maxL = Math.max(2, Math.floor(16 / es));
      g('af_pmLabel').textContent = (es === 1 ? 'Players' : 'Teams') + ' per FFA lobby';
      const cur = parseInt(g('af_pm').value, 10) || (T.ffaCfg && T.ffaCfg.perMatch) || 6;
      g('af_pm').innerHTML = '';
      for (let n = 2; n <= maxL; n++) {
        const players = es === 1 ? '' : ' (' + (n * es) + ' players)';
        g('af_pm').innerHTML += '<option value="' + n + '"' + (n === Math.min(cur, maxL) ? ' selected' : '') + '>' + n + players + '</option>';
      }
    };
    const sync = () => {
      const isFfa = afComp.value === 'ffa';
      g('af_team').style.display = isFfa ? 'none' : '';
      g('af_ffa').style.display = isFfa ? '' : 'none';
      g('af_formWrap').style.display = g('af_size').value === '1' ? 'none' : '';
      g('af_orderWrap').style.display = (g('af_form').value === 'draft' && g('af_size').value !== '1') ? '' : 'none';
      g('af_pSingle').style.display = g('af_bt').value === 'single' ? '' : 'none';
      g('af_pDouble').style.display = g('af_bt').value === 'double' ? '' : 'none';
      g('af_pSwiss').style.display = g('af_bt').value === 'swiss' ? '' : 'none';
      g('af_fpoints').style.display = g('af_fmode').value === 'points' ? '' : 'none';
      g('af_felim').style.display = g('af_fmode').value === 'elim' ? '' : 'none';
      g('af_fcutto').style.display = g('af_fcutmode').value === '1' ? '' : 'none';
      g('af_ffinalsize').style.display = g('af_ffinalmode').value === '1' ? '' : 'none';
      syncPm();
    };
    for (const id of ['af_comp', 'af_size', 'af_form', 'af_bt', 'af_fsize', 'af_fmode', 'af_fcutmode', 'af_ffinalmode']) g(id).onchange = sync;
    sync();

    g('af_save').onclick = async () => {
      const isFfa = afComp.value === 'ffa';
      const body = { admin: adminToken(), maxTeams: g('af_max').value };
      if (T.status === 'signup') {
        body.competition = afComp.value;
        body.teamSize = isFfa ? g('af_fsize').value : g('af_size').value;
        body.formation = g('af_form').value;
        body.draftOrder = g('af_order').value;
        body.seeding = g('af_seed').value;
      }
      if (!isFfa) {
        body.bracketType = g('af_bt').value;
        if (g('af_bt').value === 'single') body.plan = { early: g('af_early').value, semi: g('af_semi').value, final: g('af_final').value };
        else if (g('af_bt').value === 'double') body.plan = { wb: g('af_wb').value, wbFinal: g('af_wbf').value, lb: g('af_lb').value, lbFinal: g('af_lbf').value, gf: g('af_gf').value, lbHandicap: g('af_hcap').checked };
        else body.plan = { bo: g('af_swbo').value, final: g('af_swfinal').checked, finalBo: g('af_swfbo').value, fast: g('af_swfast').checked };
      } else {
        body.perMatch = g('af_pm').value;
        body.mode = g('af_fmode').value;
        body.rounds = g('af_frounds').value;
        body.cutTo = g('af_fcutmode').value === '1' ? g('af_fcutto').value : 0;
        body.finalSize = g('af_ffinalmode').value === '1' ? g('af_ffinalsize').value : 0;
        body.advance = g('af_fadv').value;
      }
      try {
        await api('/api/t/' + T.id + '/edit_format', body);
        toast('Format saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  document.getElementById('aiSave').onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', {
        description: document.getElementById('aiDesc').value,
        lobbyOptions: document.getElementById('aiLobby').value,
        mods: document.getElementById('aiMods').value,
        admin: adminToken()
      });
      toast('Setup saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- routing ----------

async function refresh() {
  await loadTournament();
  lastSnapshot = JSON.stringify(T);
  drawTournament();
}

function syncTabURL() {
  const id = tourneyId();
  if (!id) return;
  const url = '/t/' + id + (currentTab && currentTab !== 'overview' ? '?tab=' + currentTab : '');
  history.replaceState(null, '', url);
}

function setTitle(name) {
  document.title = name ? (name + ' \u2014 FAF Tournaments') : 'FAF Tournaments';
}

function route() {
  if (location.pathname === '/host') renderHost();
  else if (tourneyId()) renderTournament();
  else renderHome();
}

window.addEventListener('popstate', route);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="/"]');
  if (a && !a.dataset.goto) {
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    route();
  }
});

window.addEventListener('resize', () => { for (const f of connectorRedraws) f(); });
// mousewheel over a focused number input changes the value and blocks page zoom/scroll
document.addEventListener('wheel', () => {
  const a = document.activeElement;
  if (a && a.tagName === 'INPUT' && a.type === 'number') a.blur();
}, { passive: true });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const f of connectorRedraws) f(); });

// handle the ?login=... param the OAuth callback appends, then clean it from the URL
function handleLoginParam() {
  const q = new URLSearchParams(location.search);
  const l = q.get('login');
  if (!l) return;
  q.delete('login');
  const clean = location.pathname + (q.toString() ? '?' + q.toString() : '');
  history.replaceState(null, '', clean);
  if (l === 'ok') toast('Logged in with FAF' + (me() ? ' as ' + me() : ''));
  else if (l === 'denied') toast('FAF login was cancelled', true);
  else if (l === 'expired') toast('Login timed out, please try again', true);
  else if (l === 'error') toast('FAF login failed, please try again', true);
}

applyScale();
refreshFafAuth().then(() => { handleLoginParam(); route(); });
