/* FAF Tourney frontend v2 */
'use strict';

const app = document.getElementById('app');
const topbarRight = document.getElementById('topbarRight');

let T = null;
let currentTab = 'overview';
let pollTimer = null;
let lastSnapshot = '';
// form state preserved across re-renders
const F = { capSel: {}, signup: { name: '', rating: '', team: '' } };

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
function adminToken() {
  const id = tourneyId();
  return id ? localStorage.getItem('admin_' + id) : null;
}
function capToken() {
  const id = tourneyId();
  return id ? localStorage.getItem('cap_' + id) : null;
}
function myToken() { return adminToken() || capToken(); }

function captureTokensFromURL() {
  const id = tourneyId();
  if (!id) return;
  const q = new URLSearchParams(location.search);
  if (q.get('admin')) localStorage.setItem('admin_' + id, q.get('admin'));
  if (q.get('cap')) localStorage.setItem('cap_' + id, q.get('cap'));
  if (q.get('admin') || q.get('cap')) history.replaceState(null, '', '/t/' + id);
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
  if (m.bracket === 'lb') return 'LB ROUND ' + m.round;
  // wb
  const R = T.rounds || 1;
  const prefix = T.bracketType === 'double' ? 'WB ' : '';
  if (m.round === R) return prefix + (T.bracketType === 'double' ? 'FINAL' : 'FINAL');
  if (m.round === R - 1) return prefix + 'SEMIS';
  if (m.round === R - 2) return prefix + 'QUARTERS';
  return prefix + 'ROUND ' + m.round;
}

function colLabel(bracket, r) {
  if (bracket === 'wb') {
    const R = T.rounds || 1;
    if (r === R) return T.bracketType === 'double' ? 'WB FINAL' : 'FINAL';
    if (r === R - 1) return 'SEMIS';
    if (r === R - 2) return 'QUARTERS';
    return 'ROUND ' + r;
  }
  if (bracket === 'lb') return 'LB R' + r;
  return 'ROUND ' + r;
}

function statusLabel(s) {
  return { signup: 'Signups open', draft: 'Drafting', drafted: 'Teams locked', running: 'In progress', finished: 'Finished' }[s] || s;
}

function typeLine(t) {
  if (t.competition === 'ffa') {
    const sz = t.teamSize === 1 ? 'solo' : t.teamSize + '-player teams';
    return 'FFA (' + sz + ', ' + t.ffaCfg.perMatch + ' per lobby)';
  }
  const bt = { single: 'single elim', double: 'double elim', swiss: 'swiss' }[t.bracketType];
  const form = t.teamSize === 1 ? '1v1' : t.teamSize + 'v' + t.teamSize + ' · ' + (t.formation === 'draft' ? 'captains draft' : 'premade');
  return form + ' · ' + bt;
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
function openSettings() {
  const s = parseInt(localStorage.getItem('uiScale') || '100', 10);
  modal(`
    <h3>Display settings</h3>
    <label>UI scale — <span id="scaleVal">${s}%</span></label>
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
    root.querySelector('#scaleReset').onclick = () => {
      localStorage.setItem('uiScale', '100');
      range.value = 100;
      root.querySelector('#scaleVal').textContent = '100%';
      applyScale();
    };
    root.querySelector('#scaleDone').onclick = closeModal;
  });
}

function drawTopbar(modeText) {
  topbarRight.innerHTML = (modeText ? '<span>' + esc(modeText) + '</span>' : '') +
    '<button class="gearbtn" id="gearBtn" title="Display settings">⚙</button>';
  document.getElementById('gearBtn').onclick = openSettings;
}

// ---------- home ----------

async function renderHome() {
  stopPoll();
  drawTopbar('');
  let list = [];
  try { list = await api('/api/tournaments'); } catch (e) {}

  app.innerHTML = `
    <div class="grid2">
      <div class="panel section">
        <h2>Create <span class="h2-strong">Tournament</span></h2>
        <label>Tournament name</label>
        <input type="text" id="cName" maxlength="60" placeholder="e.g. Nuggets 2v2 Cup #1">
        <label>Description (rules, schedule)</label>
        <textarea id="cDesc" maxlength="500" placeholder="Sunday 19:00 CEST. Check-in in Discord..."></textarea>
        <label>Lobby options</label>
        <textarea id="cLobby" maxlength="500" placeholder="e.g. 1500 unit cap, no share until death, expansions allowed, timeouts 3x90s"></textarea>
        <label>Mods</label>
        <input type="text" id="cMods" maxlength="500" placeholder="e.g. No mods / BlackOps FAF + BrewLAN">

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
                <option value="linear" selected>Bottom to top, every round (balanced, most common)</option>
                <option value="snake">Snake (1→N, then N→1)</option>
              </select>
            </div>
          </div>
          <label>Bracket</label>
          <select id="cBracket">
            <option value="single">Single elimination</option>
            <option value="double">Double elimination</option>
            <option value="swiss">Swiss</option>
          </select>
          <div class="muted small" style="margin-top:6px">Best-of per round (and swiss settings) are configured when you start the bracket.</div>
        </div>

        <div id="ffaOpts" style="display:none">
          <label>Entrants</label>
          <select id="cFfaSize">
            <option value="1">Solo players</option>
            <option value="2">Teams of 2</option>
            <option value="3">Teams of 3</option>
          </select>
          <label>Entrants per FFA lobby</label>
          <select id="cPerMatch">${[3,4,5,6,7,8].map(n => '<option value="'+n+'"'+(n===6?' selected':'')+'>'+n+'</option>').join('')}</select>
          <label>Advancing per lobby</label>
          <select id="cAdvance"><option value="1">Winner only</option><option value="2">Top 2</option></select>
        </div>

        <label>Seeding</label>
        <select id="cSeed">
          <option value="random">Random</option>
          <option value="rating">By rating (self-reported at signup)</option>
        </select>
        <div style="margin-top:20px">
          <button class="btn primary" id="cGo">Create tournament</button>
        </div>
      </div>
      <div class="panel section">
        <h2>Tournaments</h2>
        <div id="tlist">${list.length ? '' : '<div class="empty">No tournaments yet. Create the first one.</div>'}</div>
      </div>
    </div>`;

  const comp = document.getElementById('cComp');
  const size = document.getElementById('cSize');
  const formation = document.getElementById('cFormation');
  const syncVis = () => {
    const isFfa = comp.value === 'ffa';
    document.getElementById('teamOpts').style.display = isFfa ? 'none' : '';
    document.getElementById('ffaOpts').style.display = isFfa ? '' : 'none';
    document.getElementById('formationWrap').style.display = size.value === '1' ? 'none' : '';
    document.getElementById('draftOrderWrap').style.display = (formation.value === 'draft' && size.value !== '1') ? '' : 'none';
  };
  comp.onchange = syncVis; size.onchange = syncVis; formation.onchange = syncVis;

  const tl = document.getElementById('tlist');
  for (const t of list) {
    const div = document.createElement('div');
    div.className = 'tlist-item';
    const kind = t.competition === 'ffa' ? 'FFA' :
      (t.teamSize + 'v' + t.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[t.bracketType] || ''));
    div.innerHTML = `
      <div>
        <div class="tname"><a href="/t/${t.id}">${esc(t.name)}</a></div>
        <div class="tlist-meta">${esc(kind)} · ${t.players} signed up</div>
      </div>
      <span class="pill ${t.status}">${esc(statusLabel(t.status))}</span>`;
    tl.appendChild(div);
  }

  document.getElementById('cGo').onclick = async () => {
    const name = document.getElementById('cName').value.trim();
    if (!name) return toast('Give the tournament a name', true);
    const isFfa = comp.value === 'ffa';
    try {
      const r = await api('/api/tournaments', {
        name,
        description: document.getElementById('cDesc').value,
        lobbyOptions: document.getElementById('cLobby').value,
        mods: document.getElementById('cMods').value,
        competition: comp.value,
        teamSize: isFfa ? document.getElementById('cFfaSize').value : size.value,
        formation: formation.value,
        draftOrder: document.getElementById('cDraftOrder').value,
        bracketType: document.getElementById('cBracket').value,
        perMatch: document.getElementById('cPerMatch').value,
        advance: document.getElementById('cAdvance').value,
        seeding: document.getElementById('cSeed').value
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
  T = await api('/api/t/' + tourneyId());
}

async function renderTournament() {
  captureTokensFromURL();
  try { await loadTournament(); }
  catch (e) {
    app.innerHTML = '<div class="panel"><div class="empty">Tournament not found.</div><a href="/">← Back</a></div>';
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
      const fresh = await api('/api/t/' + tourneyId());
      const snap = JSON.stringify(fresh);
      if (snap === lastSnapshot) return;                         // nothing changed
      T = fresh;
      lastSnapshot = snap;
      drawTournament();
    } catch (e) {}
  }, 4000);
}

function drawTournament() {
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
    <div id="tabBody"></div>`;

  app.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; drawTournament(); });

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
    e.preventDefault(); currentTab = a.dataset.goto; drawTournament();
  });
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
    if (maps.length) inner += `<span class="mono small muted" title="Maps">🗺 ${esc(maps.join(', '))}</span>`;
    if (withReport) inner += `<button class="btn amber small" data-m="${m.id}">Report</button>`;
    div.innerHTML = inner;
    if (withReport) div.querySelector('button').onclick = () => reportScore(m.id);
    el.appendChild(div);
  }
}

// ----- players -----

function drawPlayers(el) {
  const admin = !!adminToken();
  let html = '';

  if (T.status === 'signup') {
    const teamField = (T.formation === 'premade' && T.teamSize > 1);
    html += `<div class="panel section"><h2>Sign up</h2>
      <div class="grid2">
        <div>
          <label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name">
          <label>Rating (optional, for seeding)</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500">
          ${teamField ? '<label>Team name</label><input type="text" id="sTeam" maxlength="30" placeholder="Same name = same team">' : ''}
          <div style="margin-top:16px"><button class="btn primary" id="sGo">Sign up</button></div>
        </div>
        <div class="muted small" style="align-self:end">
          ${T.competition === 'ffa' && T.teamSize === 1 ? 'Every player enters solo. Lobbies are grouped automatically.'
            : teamField ? 'Everyone who enters the same team name lands on the same team. First member to sign up becomes captain.'
            : T.formation === 'draft' ? 'The organizer will pick captains once signups close, then captains draft their teams.'
            : 'Solo bracket — every signup is an entrant.'}
        </div>
      </div></div>`;
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
      <td class="small muted">${esc(inTeam)}</td>
      ${admin ? `<td style="text-align:right;white-space:nowrap">
        <button class="btn ghost small" data-edit="${p.id}">Edit</button>
        ${T.status === 'signup' ? `<button class="btn danger small" data-del="${p.id}">Remove</button>` : ''}</td>` : ''}`;
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
  bindKeep('sName', 'name'); bindKeep('sRating', 'rating'); bindKeep('sTeam', 'team');

  const go = document.getElementById('sGo');
  if (go) go.onclick = async () => {
    const name = (document.getElementById('sName').value || '').trim();
    if (!name) return toast('Enter your FAF name', true);
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
    <label>FAF name</label><input type="text" id="epName" maxlength="30" value="${esc(p.name)}">
    <label>Rating</label><input type="number" id="epRating" min="0" max="4000" value="${p.rating != null ? p.rating : ''}">
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
    html += `<div class="draft-turn">Pick ${d.current + 1} of ${d.order.length} — <strong>${esc(teamName(turnTeamId))}</strong> is picking.
      ${capToken() && !admin ? '<span class="muted small"> If it\u2019s your team\u2019s turn, the pick buttons below work for you.</span>' : ''}
    </div>`;
    html += `<div class="panel section"><h2>Player pool</h2><div class="pool" id="draftPool"></div></div>`;
  }

  if (T.teams.length) {
    html += `<div class="panel section"><h2>${T.teamSize === 1 ? 'Entrants' : 'Teams'}</h2><div class="teamgrid" id="tGrid"></div></div>`;
  }
  if (T.subs && T.subs.length) {
    html += `<div class="panel section"><h2>Substitutes</h2><div>${T.subs.map(id => esc(playerName(id))).join(', ')}</div></div>`;
  }

  if (T.status === 'drafted' && admin) {
    html += `<div class="panel section"><h2>Ready</h2>
      <p class="muted small">${T.competition === 'ffa' ? 'Starting creates the round-1 FFA lobbies.' : 'Starting opens the best-of configuration for each round.'}</p>
      <button class="btn primary" id="startBracket">Start ${T.competition === 'ffa' || T.bracketType === 'swiss' ? 'rounds' : 'bracket'}</button>
      <button class="btn ghost" id="reopen" style="margin-left:10px">Reopen signups</button></div>`;
  }

  el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';

  const capPool = document.getElementById('capPool');
  if (capPool) {
    for (const p of T.players) {
      const chip = document.createElement('label');
      chip.className = 'poolchip';
      chip.style.cursor = 'pointer';
      chip.innerHTML = `<input type="checkbox" value="${p.id}"${F.capSel[p.id] ? ' checked' : ''}> ${esc(p.name)} <span class="rating">${p.rating != null ? p.rating : ''}</span>`;
      const cb = chip.querySelector('input');
      cb.onchange = () => { if (cb.checked) F.capSel[p.id] = 1; else delete F.capSel[p.id]; };
      capPool.appendChild(chip);
    }
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

  const dp = document.getElementById('draftPool');
  if (dp) {
    const free = T.players.filter(p => !p.teamId);
    if (!free.length) dp.innerHTML = '<div class="empty">Pool is empty.</div>';
    for (const p of free) {
      const chip = document.createElement('div');
      chip.className = 'poolchip';
      chip.innerHTML = `${esc(p.name)} <span class="rating">${p.rating != null ? p.rating : ''}</span> <button class="btn amber small">Pick</button>`;
      chip.querySelector('button').onclick = async () => {
        try { await api('/api/t/' + T.id + '/pick', { playerId: p.id, token: myToken() }); await refresh(); }
        catch (e) { toast(e.message, true); }
      };
      dp.appendChild(chip);
    }
  }

  const tg = document.getElementById('tGrid');
  if (tg) {
    for (const team of T.teams.slice().sort((a, b) => a.seed - b.seed)) {
      const card = document.createElement('div');
      card.className = 'teamcard' + (team.eliminated ? ' elim' : '');
      card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${team.seed}</span></h3>
        <ul>${team.playerIds.map(pid =>
          `<li>${esc(playerName(pid))}${pid === team.captainId && T.teamSize > 1 ? '<span class="captag">CAPTAIN</span>' : ''}</li>`).join('')}</ul>`;
      tg.appendChild(card);
    }
  }

  const sb = document.getElementById('startBracket');
  if (sb) sb.onclick = openStartConfig;
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
      rows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_r' + r, r === R ? 5 : 3)}</div></div>`);
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
    for (let r = 1; r <= R; r++) {
      const lbl = r === R ? 'WB Final' : r === R - 1 ? 'WB Semis' : 'WB Round ' + r;
      wbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_wb' + r, 3)}</div></div>`);
    }
    for (let q = 1; q <= lbR; q++) {
      const lbl = q === lbR ? 'LB Final' : 'LB Round ' + q;
      lbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_lb' + q, 3)}</div></div>`);
    }
    return modal(`
      <h3>Bracket setup — double elimination</h3>
      <p class="muted small">${n} teams. Winners bracket: ${R} rounds. Losers bracket: ${lbR} rounds.</p>
      <label>Winners bracket</label>${wbRows.join('')}
      <label>Losers bracket</label>${lbRows.join('')}
      <label>Grand final</label>
      <div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">Grand final</div><div style="width:110px">${boSelect('bo_gf', 5)}</div></div>
      <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
        <input type="checkbox" id="cfgHcap" checked> Upper bracket finalist starts the grand final 1-0 up
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
  return modal(`
    <h3>Swiss setup</h3>
    <p class="muted small">${n} teams. Everyone plays every round; pairings by standings, rematches avoided.</p>
    <label>Number of rounds</label>
    <input type="number" id="swRounds" min="1" max="15" value="${defR}">
    <label>Each match is</label>
    <select id="swBo"><option value="1">Bo1</option><option value="3" selected>Bo3</option></select>
    <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:16px">
      <input type="checkbox" id="swFinal" checked> Final between the top 2 after the last round
    </label>
    <div id="swFinalBoWrap"><label>Final is</label>${boSelect('swFinalBo', 5)}</div>
    <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Start round 1</button></div>`,
    root => {
      const fin = root.querySelector('#swFinal');
      fin.onchange = () => { root.querySelector('#swFinalBoWrap').style.display = fin.checked ? '' : 'none'; };
      root.querySelector('#cfgCancel').onclick = closeModal;
      root.querySelector('#cfgGo').onclick = () => start({
        rounds: parseInt(root.querySelector('#swRounds').value, 10),
        bo: parseInt(root.querySelector('#swBo').value, 10),
        final: fin.checked,
        finalBo: parseInt(root.querySelector('#swFinalBo').value, 10)
      });
    });
}

// ----- bracket / rounds -----

function mapsLine(bracket, round, el) {
  const admin = !!adminToken();
  const maps = mapsFor(bracket, round);
  const div = document.createElement('div');
  div.className = 'bcol-maps';
  div.innerHTML = (maps.length ? '🗺 ' + esc(maps.join(' · ')) : (admin ? '<span class="muted">no maps set</span>' : '')) +
    (admin ? ' <a href="#" class="small">edit</a>' : '');
  const a = div.querySelector('a');
  if (a) a.onclick = e => { e.preventDefault(); editMaps(bracket, round); };
  if (maps.length || admin) el.appendChild(div);
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

function matchBox(m) {
  const admin = !!adminToken();
  const box = document.createElement('div');
  box.className = 'bmatch ' + m.status;
  const row = (tid, score) => {
    const seed = tid && tid !== 'BYE' ? teamSeed(tid) : null;
    const win = m.winner && m.winner === tid && tid !== 'BYE';
    const nm = tid === 'BYE' ? 'bye' : (tid ? teamName(tid) : 'TBD');
    return `<div class="brow ${win ? 'winner' : ''}">
      <span class="bname ${tid && tid !== 'BYE' ? '' : 'tbd'}">${seed ? '<span class="seedtag">' + seed + '</span>' : ''}${esc(nm)}</span>
      <span class="bscore">${score != null ? score : ''}</span></div>`;
  };
  const canReport = m.status === 'ready' || m.status === 'live';
  box.innerHTML = `<div class="botag">BO${m.bo}${m.hcap ? ' · UB starts 1-0' : ''}${m.status === 'live' ? ' · <span class="livechip">LIVE</span>' : ''}</div>` +
    row(m.team1, m.score1) + row(m.team2, m.score2) +
    ((canReport || (m.status === 'done' && admin))
      ? `<div class="bfoot"><button class="btn ${canReport ? 'amber' : 'ghost'} small">${canReport ? 'Report score' : 'Correct'}</button></div>` : '');
  const btn = box.querySelector('.bfoot button');
  if (btn) btn.onclick = () => reportScore(m.id);
  return box;
}

function bracketColumns(el, bracket, title) {
  const ms = T.matches.filter(m => m.bracket === bracket);
  if (!ms.length) return;
  const rounds = Math.max.apply(null, ms.map(m => m.round));
  const sec = document.createElement('div');
  sec.className = 'bsection';
  if (title) sec.innerHTML = `<div class="bsection-title ${bracket}">${esc(title)}</div>`;
  const wrap = document.createElement('div');
  wrap.className = 'bracket';
  for (let r = 1; r <= rounds; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const head = document.createElement('div');
    head.className = 'bcol-title';
    head.textContent = colLabel(bracket, r);
    col.appendChild(head);
    mapsLine(bracket, r, col);
    for (const m of ms.filter(x => x.round === r).sort((a, b) => a.index - b.index)) {
      col.appendChild(matchBox(m));
    }
    wrap.appendChild(col);
  }
  sec.appendChild(wrap);
  el.appendChild(sec);
}

function drawBracket(el) {
  el.innerHTML = '';
  if (!T.matches.length) {
    el.innerHTML = '<div class="panel"><div class="empty">The bracket appears once the organizer starts it.</div></div>';
    return;
  }

  if (T.competition === 'ffa') return drawFfaRounds(el);

  if (T.bracketType === 'swiss') return drawSwissRounds(el);

  if (T.bracketType === 'double') {
    bracketColumns(el, 'wb', 'Winners bracket');
    bracketColumns(el, 'lb', 'Losers bracket');
    const gf = T.matches.find(m => m.bracket === 'gf');
    if (gf) {
      const sec = document.createElement('div');
      sec.className = 'bsection';
      sec.innerHTML = '<div class="bsection-title gf">Grand final</div>';
      const wrap = document.createElement('div');
      wrap.className = 'bracket';
      const col = document.createElement('div');
      col.className = 'bcol';
      mapsLine('gf', 1, col);
      col.appendChild(matchBox(gf));
      wrap.appendChild(col);
      sec.appendChild(wrap);
      el.appendChild(sec);
    }
    return;
  }

  bracketColumns(el, 'wb', '');
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
      const need = roundMs.length === 1 ? 1 : Math.min(T.ffaCfg.advance, m.entrants.length - 1);
      card.innerHTML = `<div class="mono small muted">LOBBY ${m.index + 1} · ${m.entrants.length} entrants · top ${need} advance${need === 1 ? 's' : ''}</div>
        <ul>${m.entrants.map(id => {
          const won = m.winners && m.winners.indexOf(id) >= 0;
          const cls = m.status === 'done' ? (won ? 'won' : 'lost') : '';
          return `<li class="${cls}"><span>${esc(teamName(id))}</span>${won ? '<span class="mono small">ADV</span>' : ''}</li>`;
        }).join('')}</ul>
        ${m.status === 'ready' || !!adminToken() ? `<div style="margin-top:10px;text-align:right"><button class="btn ${m.status === 'ready' ? 'amber' : 'ghost'} small">${m.status === 'ready' ? 'Report result' : 'Correct'}</button></div>` : ''}`;
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
    ${maps.length ? '<p class="mono small" style="color:var(--blue)">🗺 ' + esc(maps.join(' · ')) + '</p>' : ''}
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
  const roundCount = T.matches.filter(x => x.bracket === 'ffa' && x.round === m.round).length;
  const need = roundCount === 1 ? 1 : Math.min(T.ffaCfg.advance, m.entrants.length - 1);
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

  html += `<div class="panel section"><h2>Game setup</h2>
    <label>Description</label><textarea id="aiDesc" maxlength="500">${esc(T.description || '')}</textarea>
    <label>Lobby options</label><textarea id="aiLobby" maxlength="500">${esc(T.lobbyOptions || '')}</textarea>
    <label>Mods</label><input type="text" id="aiMods" maxlength="500" value="${esc(T.mods || '')}">
    <div style="margin-top:14px"><button class="btn" id="aiSave">Save setup</button></div>
  </div>`;

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

function route() {
  if (tourneyId()) renderTournament();
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

applyScale();
route();
