/* FAF Tourney frontend */
'use strict';

const app = document.getElementById('app');
const topbarRight = document.getElementById('topbarRight');

let T = null;            // current tournament data
let currentTab = 'overview';
let pollTimer = null;

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
  if (!id) return null;
  const t = T.teams.find(x => x.id === id);
  return t ? t.name : '?';
}
function playerName(id) {
  const p = T.players.find(x => x.id === id);
  return p ? p.name : '?';
}
function myCaptainTeam() {
  const tok = capToken();
  if (!tok || !T) return null;
  // captain tokens are secret; we can't match locally — server enforces.
  // But for UI hints we store the teamId alongside when following a captain link? We don't know it.
  return null;
}

function roundLabel(r, rounds) {
  if (r === rounds) return 'FINAL';
  if (r === rounds - 1) return 'SEMIS';
  if (r === rounds - 2) return 'QUARTERS';
  return 'ROUND ' + r;
}

function statusLabel(s) {
  return { signup: 'Signups open', draft: 'Drafting', drafted: 'Teams locked', running: 'In progress', finished: 'Finished' }[s] || s;
}

// ---------- modal ----------

function modal(html, onMount) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = '<div class="modal-bg"><div class="modal">' + html + '</div></div>';
  root.querySelector('.modal-bg').addEventListener('click', e => {
    if (e.target.classList.contains('modal-bg')) closeModal();
  });
  if (onMount) onMount(root);
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

// ---------- home ----------

async function renderHome() {
  stopPoll();
  topbarRight.textContent = '';
  let list = [];
  try { list = await api('/api/tournaments'); } catch (e) {}

  app.innerHTML = `
    <div class="grid2">
      <div class="panel section">
        <h2>Create <span class="h2-strong">Tournament</span></h2>
        <label>Tournament name</label>
        <input type="text" id="cName" maxlength="60" placeholder="e.g. Nuggets 2v2 Cup #1">
        <label>Description (rules, maps, schedule)</label>
        <textarea id="cDesc" maxlength="500" placeholder="Bo3, map pool announced in lobby, Sunday 19:00 CEST..."></textarea>
        <label>Team format</label>
        <select id="cFormat">
          <option value="draft">Captains draft — captains pick teams from the signup pool</option>
          <option value="premade">Premade teams — players sign up with a team name</option>
        </select>
        <label>Team size</label>
        <select id="cSize">
          <option value="1">1v1</option>
          <option value="2" selected>2v2</option>
          <option value="3">3v3</option>
          <option value="4">4v4</option>
        </select>
        <label>Match length</label>
        <select id="cBo">
          <option value="1">Best of 1</option>
          <option value="3" selected>Best of 3</option>
          <option value="5">Best of 5</option>
          <option value="7">Best of 7</option>
        </select>
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

  const tl = document.getElementById('tlist');
  for (const t of list) {
    const div = document.createElement('div');
    div.className = 'tlist-item';
    div.innerHTML = `
      <div>
        <div class="tname"><a href="/t/${t.id}">${esc(t.name)}</a></div>
        <div class="tlist-meta">${t.teamSize}v${t.teamSize} · ${t.format === 'draft' ? 'captains draft' : 'premade teams'} · ${t.players} signed up</div>
      </div>
      <span class="pill ${t.status}">${esc(statusLabel(t.status))}</span>`;
    tl.appendChild(div);
  }

  document.getElementById('cGo').onclick = async () => {
    const name = document.getElementById('cName').value.trim();
    if (!name) return toast('Give the tournament a name', true);
    try {
      const r = await api('/api/tournaments', {
        name,
        description: document.getElementById('cDesc').value,
        format: document.getElementById('cFormat').value,
        teamSize: document.getElementById('cSize').value,
        bestOf: document.getElementById('cBo').value,
        seeding: document.getElementById('cSeed').value
      });
      localStorage.setItem('admin_' + r.id, r.adminToken);
      history.pushState(null, '', '/t/' + r.id);
      route();
      toast('Tournament created — you are the organizer on this browser');
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- tournament ----------

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

async function loadTournament() {
  const id = tourneyId();
  T = await api('/api/t/' + id);
}

async function renderTournament() {
  captureTokensFromURL();
  try { await loadTournament(); }
  catch (e) {
    app.innerHTML = '<div class="panel"><div class="empty">Tournament not found.</div><a href="/">← Back</a></div>';
    return;
  }
  topbarRight.textContent = adminToken() ? 'ORGANIZER MODE' : (capToken() ? 'CAPTAIN MODE' : '');
  drawTournament();
  stopPoll();
  pollTimer = setInterval(async () => {
    if (document.getElementById('modalRoot').innerHTML) return; // don't redraw under a modal
    try { await loadTournament(); drawTournament(); } catch (e) {}
  }, 4000);
}

function drawTournament() {
  const admin = !!adminToken();
  const phaseIdx = { signup: 0, draft: 1, drafted: 1, running: 2, finished: 3 }[T.status];
  const steps = ['Signups', T.format === 'draft' ? 'Draft' : 'Teams', 'Bracket', 'Done'];

  const tabs = ['overview', 'players', 'teams', 'bracket'];
  if (admin) tabs.push('admin');
  if (!tabs.includes(currentTab)) currentTab = 'overview';

  app.innerHTML = `
    <div class="headrow">
      <div>
        <h1>${esc(T.name)}</h1>
        <div class="muted small">${T.teamSize}v${T.teamSize} · ${T.format === 'draft' ? 'captains draft' : 'premade teams'} · best of ${T.bestOf}</div>
      </div>
      <span class="pill ${T.status}">${esc(statusLabel(T.status))}</span>
    </div>
    <div class="stepper">
      ${steps.map((s, i) => `<div class="step ${i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}">${s}</div>`).join('')}
    </div>
    <div class="tabs">
      ${tabs.map(t => `<button class="tab ${t === currentTab ? 'active' : ''}" data-tab="${t}">${t === 'teams' && T.status === 'draft' ? 'Draft' : t}</button>`).join('')}
    </div>
    <div id="tabBody"></div>`;

  app.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; drawTournament(); });

  const body = document.getElementById('tabBody');
  if (currentTab === 'overview') drawOverview(body);
  else if (currentTab === 'players') drawPlayers(body);
  else if (currentTab === 'teams') drawTeams(body);
  else if (currentTab === 'bracket') drawBracket(body);
  else if (currentTab === 'admin') drawAdmin(body);
}

// ----- overview -----

function drawOverview(el) {
  let html = '';

  if (T.championTeamId) {
    html += `<div class="champ"><div class="champ-label">Champion</div><h1>${esc(teamName(T.championTeamId))}</h1></div>`;
  }

  if (T.description) {
    html += `<div class="panel section"><h2>Briefing</h2><div>${esc(T.description).replace(/\n/g, '<br>')}</div></div>`;
  }

  if (T.status === 'signup') {
    html += `<div class="panel section"><h2>Status</h2>
      <p>Signups are open — <strong>${T.players.length}</strong> player${T.players.length === 1 ? '' : 's'} in so far.
      Head to the <a href="#" data-goto="players">Players</a> tab to sign up.</p></div>`;
  }

  if (T.status === 'draft') {
    const turnTeam = teamName(T.draft.order[T.draft.current]);
    html += `<div class="draft-turn">Draft in progress — <strong>${esc(turnTeam)}</strong> is on the clock. Follow it in the <a href="#" data-goto="teams">Draft</a> tab.</div>`;
  }

  if (T.status === 'running' || T.status === 'finished') {
    const ready = T.matches.filter(m => m.status === 'ready').sort((a, b) => a.round - b.round || a.index - b.index);
    const done = T.matches.filter(m => m.status === 'done').sort((a, b) => b.round - a.round || a.index - b.index);
    html += `<div class="panel section"><h2>Launch <span class="h2-strong">Queue</span> — up next</h2><div class="queue" id="q1">
      ${ready.length ? '' : '<div class="empty">Nothing waiting — all caught up.</div>'}</div></div>`;
    html += `<div class="panel section"><h2>Recent results</h2><div class="queue" id="q2">
      ${done.length ? '' : '<div class="empty">No results yet.</div>'}</div></div>`;
    el.innerHTML = html;
    fillQueue(document.getElementById('q1'), ready, true);
    fillQueue(document.getElementById('q2'), done.slice(0, 8), false);
  } else {
    el.innerHTML = html;
  }

  el.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => {
    e.preventDefault(); currentTab = a.dataset.goto; drawTournament();
  });
}

function fillQueue(el, matches, withReport) {
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'qitem' + (m.status === 'done' ? ' done' : '');
    const n1 = teamName(m.team1), n2 = teamName(m.team2);
    const w1 = m.winner && m.winner === m.team1, w2 = m.winner && m.winner === m.team2;
    div.innerHTML = `
      <span class="qround">${roundLabel(m.round, T.rounds || maxRound())}</span>
      <span class="qteams"><span class="${w1 ? 'qwin' : ''}">${esc(n1)}</span><span class="qvs">VS</span><span class="${w2 ? 'qwin' : ''}">${esc(n2)}</span></span>
      ${m.status === 'done' ? `<span class="qscore">${m.score1} — ${m.score2}</span>` : ''}
      ${withReport ? `<button class="btn amber small" data-m="${m.id}">Report score</button>` : ''}`;
    if (withReport) div.querySelector('button').onclick = () => reportScore(m.id);
    el.appendChild(div);
  }
}

function maxRound() { let r = 0; for (const m of T.matches) if (m.round > r) r = m.round; return r; }

// ----- players -----

function drawPlayers(el) {
  const admin = !!adminToken();
  let html = '';

  if (T.status === 'signup') {
    html += `<div class="panel section"><h2>Sign up</h2>
      <div class="grid2">
        <div>
          <label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name">
          <label>Rating (optional, for seeding)</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500">
          ${T.format === 'premade' ? '<label>Team name</label><input type="text" id="sTeam" maxlength="30" placeholder="Same name = same team">' : ''}
          <div style="margin-top:16px"><button class="btn primary" id="sGo">Sign up</button></div>
        </div>
        <div class="muted small" style="align-self:end">
          ${T.format === 'premade'
            ? 'Everyone who enters the same team name lands on the same team. First member to sign up becomes captain.'
            : 'The organizer will pick captains once signups close, then captains draft their teams.'}
        </div>
      </div></div>`;
  }

  html += `<div class="panel section"><h2>Players <span class="h2-strong">(${T.players.length})</span></h2>
    <table><thead><tr><th>#</th><th>Name</th><th>Rating</th>${T.format === 'premade' ? '<th>Team</th>' : ''}<th>Status</th>${admin && T.status === 'signup' ? '<th></th>' : ''}</tr></thead>
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
      ${T.format === 'premade' ? `<td>${esc(p.teamName || '—')}</td>` : ''}
      <td class="small muted">${esc(inTeam)}</td>
      ${admin && T.status === 'signup' ? `<td style="text-align:right"><button class="btn danger small" data-p="${p.id}">Remove</button></td>` : ''}`;
    const rb = tr.querySelector('button');
    if (rb) rb.onclick = async () => {
      try { await api('/api/t/' + T.id + '/remove', { playerId: p.id, admin: adminToken() }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    rows.appendChild(tr);
  });

  const go = document.getElementById('sGo');
  if (go) go.onclick = async () => {
    const name = document.getElementById('sName').value.trim();
    if (!name) return toast('Enter your FAF name', true);
    try {
      await api('/api/t/' + T.id + '/signup', {
        name,
        rating: document.getElementById('sRating').value,
        teamName: T.format === 'premade' ? document.getElementById('sTeam').value : ''
      });
      toast('Signed up — good luck, commander');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// ----- teams / draft -----

function drawTeams(el) {
  const admin = !!adminToken();
  let html = '';

  if (T.status === 'signup') {
    if (admin) {
      if (T.format === 'draft') {
        html += `<div class="panel section"><h2>Start the draft</h2>
          <p class="muted small">Tick the captains, then start. Snake order: 1→N then N→1. Each captain fills a team of ${T.teamSize}.</p>
          <div class="pool" id="capPool"></div>
          <div style="margin-top:16px"><button class="btn amber" id="startDraft">Close signups &amp; start draft</button></div></div>`;
      } else {
        html += `<div class="panel section"><h2>Form teams</h2>
          <p class="muted small">Teams are grouped by the team name players entered at signup. Players without a team name become substitutes.</p>
          <button class="btn amber" id="formTeams">Close signups &amp; form teams</button></div>`;
      }
    } else {
      html += '<div class="panel section"><div class="empty">Teams appear here once the organizer closes signups.</div></div>';
    }
  }

  if (T.status === 'draft' && T.draft) {
    const d = T.draft;
    const turnTeamId = d.order[d.current];
    const pickNo = d.current + 1, total = d.order.length;
    html += `<div class="draft-turn">Pick ${pickNo} of ${total} — <strong>${esc(teamName(turnTeamId))}</strong> is picking.
      ${capToken() && !admin ? '<span class="muted small"> If it\u2019s your team\u2019s turn, the pick buttons below will work for you.</span>' : ''}
    </div>`;
    html += `<div class="panel section"><h2>Player pool</h2><div class="pool" id="draftPool"></div></div>`;
  }

  if (T.teams.length) {
    html += `<div class="panel section"><h2>Teams</h2><div class="teamgrid" id="tGrid"></div></div>`;
  }
  if (T.subs && T.subs.length) {
    html += `<div class="panel section"><h2>Substitutes</h2><div>${T.subs.map(id => esc(playerName(id))).join(', ')}</div></div>`;
  }

  if (T.status === 'drafted' && admin) {
    html += `<div class="panel section"><h2>Ready</h2>
      <p class="muted small">Teams are locked. Generating the bracket seeds teams ${T.seeding === 'rating' ? 'by rating' : 'randomly'} and auto-assigns byes.</p>
      <button class="btn primary" id="startBracket">Generate bracket &amp; start</button>
      <button class="btn ghost" id="reopen" style="margin-left:10px">Reopen signups</button></div>`;
  }

  el.innerHTML = html || '<div class="empty">Nothing here yet.</div>';

  // captain selection
  const capPool = document.getElementById('capPool');
  if (capPool) {
    for (const p of T.players) {
      const chip = document.createElement('label');
      chip.className = 'poolchip';
      chip.style.cursor = 'pointer';
      chip.innerHTML = `<input type="checkbox" value="${p.id}"> ${esc(p.name)} <span class="rating">${p.rating != null ? p.rating : ''}</span>`;
      capPool.appendChild(chip);
    }
    document.getElementById('startDraft').onclick = async () => {
      const ids = Array.from(capPool.querySelectorAll('input:checked')).map(i => i.value);
      if (ids.length < 2) return toast('Pick at least 2 captains', true);
      try { await api('/api/t/' + T.id + '/phase', { action: 'start_draft', captainIds: ids, admin: adminToken() }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
  }

  const ft = document.getElementById('formTeams');
  if (ft) ft.onclick = async () => {
    try { await api('/api/t/' + T.id + '/phase', { action: 'form_teams', admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };

  // draft pool
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

  // team cards
  const tg = document.getElementById('tGrid');
  if (tg) {
    for (const team of T.teams.slice().sort((a, b) => a.seed - b.seed)) {
      const card = document.createElement('div');
      card.className = 'teamcard' + (team.eliminated ? ' elim' : '');
      card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${team.seed}</span></h3>
        <ul>${team.playerIds.map(pid =>
          `<li>${esc(playerName(pid))}${pid === team.captainId ? '<span class="captag">CAPTAIN</span>' : ''}</li>`).join('')}</ul>`;
      tg.appendChild(card);
    }
  }

  const sb = document.getElementById('startBracket');
  if (sb) sb.onclick = async () => {
    try { await api('/api/t/' + T.id + '/phase', { action: 'start_bracket', admin: adminToken() }); currentTab = 'bracket'; await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const ro = document.getElementById('reopen');
  if (ro) ro.onclick = async () => {
    try { await api('/api/t/' + T.id + '/phase', { action: 'reopen_signups', admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
}

// ----- bracket -----

function drawBracket(el) {
  if (!T.matches.length) {
    el.innerHTML = '<div class="panel"><div class="empty">The bracket appears once the organizer starts it.</div></div>';
    return;
  }
  const admin = !!adminToken();
  const rounds = maxRound();
  const wrap = document.createElement('div');
  wrap.className = 'bracket';
  for (let r = 1; r <= rounds; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    col.innerHTML = `<div class="bcol-title">${roundLabel(r, rounds)}</div>`;
    for (const m of T.matches.filter(x => x.round === r).sort((a, b) => a.index - b.index)) {
      const box = document.createElement('div');
      box.className = 'bmatch' + (m.status === 'ready' ? ' ready' : '');
      const row = (tid, score) => {
        const seed = tid ? T.teams.find(x => x.id === tid) : null;
        const win = m.winner && m.winner === tid;
        return `<div class="brow ${win ? 'winner' : ''}">
          <span class="bname ${tid ? '' : 'tbd'}">${seed ? '<span class="seedtag">' + seed.seed + '</span>' : ''}${tid ? esc(teamName(tid)) : (m.status === 'bye' ? 'bye' : 'TBD')}</span>
          <span class="bscore">${score != null ? score : ''}</span></div>`;
      };
      box.innerHTML = row(m.team1, m.score1) + row(m.team2, m.score2) +
        ((m.status === 'ready' || (m.status === 'done' && admin))
          ? `<div class="bfoot"><button class="btn ${m.status === 'ready' ? 'amber' : 'ghost'} small">${m.status === 'ready' ? 'Report score' : 'Correct'}</button></div>` : '');
      const btn = box.querySelector('button');
      if (btn) btn.onclick = () => reportScore(m.id);
      col.appendChild(box);
    }
    wrap.appendChild(col);
  }
  el.innerHTML = '';
  el.appendChild(wrap);
}

// ----- report score -----

function reportScore(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  const maxW = Math.ceil(T.bestOf / 2);
  modal(`
    <h3>Report score</h3>
    <p class="muted small">Best of ${T.bestOf} — winner needs ${maxW}. Only the two captains or the organizer can submit.</p>
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="rs1" min="0" max="${maxW}" value="0"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="rs2" min="0" max="${maxW}" value="0"></div>
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Submit result</button>
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
        toast('Result recorded');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
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

  if (secrets.captains.length) {
    html += `<div class="panel section"><h2>Captain links</h2>
      <p class="muted small">Send each captain their link (Discord DM works). It lets them draft on their turn and report their matches. Opening a link binds that browser as captain.</p>
      ${secrets.captains.map(c => copyRow(c.teamName + ' — ' + c.captainName, base + '?cap=' + c.token)).join('')}
    </div>`;
  }

  html += `<div class="panel section"><h2>Notes</h2>
    <ul class="muted small">
      <li>Anyone with the organizer link has full control. Anyone with a captain link can act for that team.</li>
      <li>You can correct an already-reported score from the Bracket tab, as long as the next match hasn't been played.</li>
      <li>Data lives on your server in the container volume — deleting the volume deletes tournaments.</li>
    </ul></div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'));
  });
}

// ---------- routing ----------

async function refresh() {
  await loadTournament();
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

route();
