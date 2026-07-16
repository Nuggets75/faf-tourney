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
      <p class="muted small" style="margin-bottom:10px">Log in with your FAF account to sign up and take part.</p>
      <button class="btn faf" id="homeLgFaf" style="max-width:280px">Log in with FAF</button>
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

  const hlFaf = document.getElementById('homeLgFaf');
  if (hlFaf) hlFaf.onclick = () => {
    const returnTo = location.pathname + location.search;
    location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(returnTo);
  };

  groups.forEach((g, i) => {
    const tl = document.getElementById('tlist' + i);
    for (const t of g[1]) {
      const div = document.createElement('div');
      div.className = 'tlist-item';
      const kind = t.competition === 'ffa' ? 'FFA' :
        (t.teamSize + 'v' + t.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[t.bracketType] || ''));
      div.innerHTML = `
        <div>
          <div class="tname"><a href="/t/${t.id}">${esc(t.name)}</a>${t.category ? ' <span class="tcat">\u2014 ' + (t.category === 'official' ? 'official' : 'community') + ' tourney</span>' : ''}</div>
          <div class="tlist-meta">${esc(kind)}${t.imported ? '' : ' \u00b7 ' + t.players + ' signed up'}${tourneyDate(t) ? ' \u00b7 <span class="tdate">' + esc(fmtDateTime(tourneyDate(t))) + '</span>' : ''}</div>
        </div>
        <span style="display:flex;align-items:center;gap:10px">
          ${t.published === 0 ? '<span class="idbadge late" title="Draft — only you can see this until you publish it">draft</span>' : ''}
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

        <label>Type <span class="req">*</span></label>
        <select id="cCategory">
          <option value="">Select Official or Community…</option>
          <option value="official">Official</option>
          <option value="community">Community</option>
        </select>

        <div id="teamOpts">
          <label>Team size</label>
          <select id="cSize">${[1,2,3,4,5,6].map(n => '<option value="'+n+'"'+(n===2?' selected':'')+'>'+n+'v'+n+'</option>').join('')}</select>
          <div id="formationWrap">
            <label>Team formation</label>
            <select id="cFormation">
              <option value="open">Open teams — players sign up, then form teams themselves</option>
              <option value="draft">Captains draft — organizer picks captains, they draft the pool</option>
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
          <option value="manual">Manual (organizer arranges the seeds)</option>
        </select>

        <label>Rating used</label>
        <select id="cRatingType">
          <option value="global" selected>Global (fetched from FAF)</option>
          <option value="1v1">1v1 / ladder (fetched)</option>
          <option value="2v2">2v2 (fetched)</option>
          <option value="3v3">3v3 (fetched)</option>
          <option value="4v4">4v4 (fetched)</option>
          <option value="rc">Fearghal's RC — best of 2v2/3v3/4v4/Global, blended to 300 games (fetched)</option>
          <option value="none">None — players enter their own rating</option>
        </select>

        <label>Rating date <span class="muted small">(rating taken as of this day; blank = at signup time)</span></label>
        <input type="date" id="cRatingDate">
        <label style="display:flex;align-items:center;gap:8px;margin-top:16px;cursor:pointer">
          <input type="checkbox" id="cVeto" style="width:auto"> Enable map vetoes (captains ban/pick maps before matches)
        </label>
        <div class="muted small" style="margin-top:6px">You'll build your maps, pools and ban/pick orders on the tournament's <strong>Maps</strong> tab afterwards. You can also turn this on or off later from the Admin tab.</div>
        <div style="margin-top:20px">
          <button class="btn primary" id="cGo">Create tournament</button>
        </div>
      </div>
    </div>`;

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
    const category = document.getElementById('cCategory').value;
    if (!category) return toast('Choose whether this is an Official or Community tournament', true);
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
        category,
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
        ratingType: document.getElementById('cRatingType').value,
        ratingDate: document.getElementById('cRatingDate').value || null,
        admin: siteAdmin() || undefined,
        veto: { enabled: document.getElementById('cVeto').checked, mode: 'upfront' },
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

// When someone opens an organizer link (?admin=), confirm they want to become an organizer.
function maybePromptOrganizerClaim() {
  const claim = pendingOrganizerClaim;
  if (!claim || claim.id !== tourneyId()) return;
  pendingOrganizerClaim = null;
  // already an organizer? nothing to do.
  if (viewerIsOrganizer()) return;
  // must be logged in to claim
  if (fafAuth.enabled && !isFafVerified()) {
    modal(`<h3>Organizer link</h3>
      <p class="muted small">Log in with FAF to become an organizer of <strong>${esc(T.name)}</strong>.</p>
      <div class="actions"><button class="btn ghost" id="ocCancel">Cancel</button><button class="btn faf" id="ocLogin">Log in with FAF</button></div>`, root => {
      root.querySelector('#ocCancel').onclick = closeModal;
      root.querySelector('#ocLogin').onclick = () => {
        // preserve the admin token through the login round-trip
        location.href = '/auth/faf/login?returnTo=' + encodeURIComponent('/t/' + claim.id + '?admin=' + claim.token);
      };
    });
    return;
  }
  modal(`<h3>Join as organizer?</h3>
    <p>Do you want to join <strong>${esc(T.name)}</strong> as an organizer?</p>
    <p class="muted small">You'll be able to manage signups, teams, the bracket, and replace players.</p>
    <div class="actions"><button class="btn ghost" id="ocNo">No thanks</button><button class="btn primary" id="ocYes">Yes, join as organizer</button></div>`, root => {
    root.querySelector('#ocNo').onclick = closeModal;
    root.querySelector('#ocYes').onclick = async () => {
      try {
        await api('/api/t/' + claim.id + '/claim_organizer', { adminToken: claim.token });
        closeModal();
        toast('You are now an organizer');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// When someone opens a late-signup link (?late=), confirm they want to sign up late.
function maybePromptLateSignup() {
  const late = pendingLateSignup;
  if (!late || late.id !== tourneyId()) return;
  pendingLateSignup = null;
  if (viewerSignedUp()) return; // already in
  if (fafAuth.enabled && !isFafVerified()) {
    modal(`<h3>Late signup</h3>
      <p class="muted small">Log in with FAF to sign up to <strong>${esc(T.name)}</strong> as a late entry.</p>
      <div class="actions"><button class="btn ghost" id="lsCancel">Cancel</button><button class="btn faf" id="lsLogin">Log in with FAF</button></div>`, root => {
      root.querySelector('#lsCancel').onclick = closeModal;
      root.querySelector('#lsLogin').onclick = () => {
        location.href = '/auth/faf/login?returnTo=' + encodeURIComponent('/t/' + late.id + '?late=' + late.token);
      };
    });
    return;
  }
  modal(`<h3>Sign up as a late entry?</h3>
    <p>Do you want to sign up to <strong>${esc(T.name)}</strong> as a late signup?</p>
    <p class="muted small">Signups are closed, but this link lets you join${fafAuth.enabled ? ' as <strong>' + esc(me()) + '</strong>' : ''}. Enter your rating:</p>
    <input type="number" id="lsRating" min="0" max="4000" placeholder="e.g. 1500" style="width:140px">
    <div class="actions"><button class="btn ghost" id="lsNo">Cancel</button><button class="btn primary" id="lsYes">Sign up</button></div>`, root => {
    root.querySelector('#lsNo').onclick = closeModal;
    root.querySelector('#lsYes').onclick = async () => {
      const rating = root.querySelector('#lsRating').value;
      if (rating === '') return toast('Enter your rating', true);
      const body = { rating, lateToken: late.token };
      if (!fafAuth.enabled) { const nm = prompt('Your FAF name:'); if (!nm) return; body.name = nm; }
      try {
        await api('/api/t/' + late.id + '/signup', body);
        closeModal();
        toast('Signed up as a late entry');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

async function renderTournament() {
  captureTokensFromURL();
  try { await loadTournament(); }
  catch (e) {
    app.innerHTML = '<div class="page"><div class="panel"><div class="empty">Tournament not found.</div><a href="/">← Back</a></div></div>';
    return;
  }
  drawTopbar(viewerIsOrganizer() ? 'ORGANIZER' : '');
  lastSnapshot = JSON.stringify(T);
  drawTournament();
  maybePromptOrganizerClaim();
  maybePromptLateSignup();
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

// ---- "it's your turn" banner ----
// Surfaces the two things a player can be on the clock for: a draft pick, or a veto step.
// Returns { text, tab, cta } or null.
function myTurnInfo() {
  const me = T.viewer || {};
  const myTeam = me.teamId || null;
  // 0. join requests awaiting the captain
  if (myTeam && T.status === 'signup' && T.teams) {
    const capT = T.teams.find(x => x.id === myTeam);
    if (capT && (capT.joinRequests || []).length) {
      const n = capT.joinRequests.length;
      return { text: n + ' player' + (n === 1 ? '' : 's') + ' want to join your team — accept or decline.', tab: 'teams', cta: 'Review requests' };
    }
  }
  // 1. captain's draft pick
  if (T.status === 'draft' && T.draft && T.draft.order) {
    const turnTeam = T.draft.order[T.draft.current];
    if (turnTeam && myTeam && turnTeam === myTeam) {
      return { text: "It's your pick — choose a player for your team.", tab: 'teams', cta: 'Go to the draft' };
    }
  }
  // 1b. organizer: vetoes are blocked until A/B is set (manual mode)
  if (viewerIsOrganizer() && T.veto && T.veto.enabled && T.veto.abMode === 'manual' && T.matches) {
    const waiting = T.matches.filter(m => m.veto && !m.veto.done && (!m.veto.teamA || !m.veto.teamB)).length;
    if (waiting > 0) {
      return {
        text: waiting + ' match' + (waiting === 1 ? '' : 'es') + ' need Team A / Team B set before the captains can veto.',
        tab: 'vetoes', cta: 'Set them now'
      };
    }
  }
  // 2. map veto step
  if (myTeam && T.matches) {
    for (const m of T.matches) {
      const v = m.veto;
      if (!v || v.done) continue;
      if (!v.teamA || !v.teamB) continue; // organizer hasn't set A/B yet
      const step = v.sequence[v.stepIndex];
      if (!step) continue;
      const turnTeam = step.team === 'A' ? v.teamA : v.teamB;
      if (turnTeam !== myTeam) continue;
      const opp = teamName(m.team1 === myTeam ? m.team2 : m.team1);
      return {
        text: "It's your turn to " + (step.action === 'ban' ? 'ban' : 'pick') + ' a map vs ' + opp + '.',
        tab: 'vetoes', cta: 'Go to the veto'
      };
    }
  }
  return null;
}

function turnBannerHTML() {
  const info = myTurnInfo();
  if (!info) return '';
  return `<div class="turn-banner" id="turnBanner">
    <span class="turn-dot"></span>
    <span class="turn-text">${esc(info.text)}</span>
    <button class="btn primary small" data-turn-tab="${info.tab}">${esc(info.cta)}</button>
  </div>`;
}

function drawTournament() {
  setTitle(T && T.name);
  // flag the browser tab too, so it's noticeable when the site isn't in focus
  if (T && myTurnInfo()) document.title = '\u25cf ' + document.title;
  const admin = viewerIsOrganizer();
  const phaseIdx = { signup: 0, draft: 1, drafted: 1, running: 2, finished: 3 }[T.status];
  const midStep = T.competition === 'ffa' ? 'Teams' : (T.formation === 'draft' ? 'Draft' : 'Teams');
  const lastStep = T.bracketType === 'swiss' ? 'Rounds' : 'Bracket';
  const steps = ['Signups', midStep, lastStep, 'Results'];

  const tabs = ['overview', 'players', 'teams', 'bracket'];
  // Vetoes tab appears once the bracket is running and vetoes are enabled
  const vetoActive = T.veto && T.veto.enabled && (T.status === 'running' || T.status === 'finished') && T.matches.some(m => m.veto);
  if (vetoActive) tabs.push('vetoes');
  // Maps tab: always available (useful overview of maps and where they're played)
  tabs.push('maps');
  tabs.push('standings');
  if (admin) tabs.push('admin');
  if (!tabs.includes(currentTab)) currentTab = 'overview';

  const tabLabel = tb => {
    if (tb === 'teams' && T.status === 'draft') return 'Draft';
    if (tb === 'bracket') return T.competition === 'ffa' || T.bracketType === 'swiss' ? 'Rounds' : 'Bracket';
    if (tb === 'vetoes') {
      const pending = T.matches.filter(m => m.veto && !m.veto.done).length;
      return pending > 0 ? 'Vetoes (' + pending + ')' : 'Vetoes';
    }
    return tb;
  };

  app.innerHTML = `
    <div class="page">
      <div class="headrow">
        <div>
          <h1>${esc(T.name)}</h1>
          <div class="muted small">${T.category ? '<span class="idbadge ' + (T.category === 'official' ? 'verified' : 'late') + '" style="margin-right:6px">' + T.category.toUpperCase() + '</span>' : ''}${esc(typeLine(T))}</div>
        </div>
        <span class="pill ${T.status}">${esc(statusLabel(T.status))}</span>
      </div>
      <div class="stepper">
        ${steps.map((s, i) => `<div class="step ${i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}">${s}</div>`).join('')}
      </div>
      <div class="tabs">
        ${tabs.map(tb => `<button class="tab ${tb === currentTab ? 'active' : ''}" data-tab="${tb}">${esc(tabLabel(tb))}</button>`).join('')}
      </div>
      ${admin && !T.published ? `<div class="panel" style="border-color:var(--amber);margin-top:12px">
        <strong>Draft — not public yet.</strong>
        <p class="muted small" style="margin:6px 0 10px">Only people with the link below can see this. Publish it to list it on the home page and open it up.</p>
        <div class="copybox"><input type="text" readonly value="${location.origin}/t/${T.id}"><button class="btn small" data-copy="${location.origin}/t/${T.id}">Copy share link</button></div>
        <div style="margin-top:10px"><button class="btn primary" id="pubBtn">Publish tournament</button></div>
      </div>` : ''}
    </div>
    <div id="tabBody" class="${currentTab === 'bracket' && T.competition !== 'ffa' && T.bracketType !== 'swiss' ? 'widepage' : 'page'}"></div>`;

  app.querySelectorAll('.tab').forEach(b => b.onclick = () => { currentTab = b.dataset.tab; syncTabURL(); drawTournament(); });

  const pubBtn = document.getElementById('pubBtn');
  if (pubBtn) pubBtn.onclick = async () => {
    if (!confirm('Publish this tournament? It will appear on the public home page for everyone.')) return;
    try { await api('/api/t/' + T.id + '/publish', { admin: adminToken() }); toast('Published'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied')));

  // "your turn" banner, above whatever tab is open
  const banner = turnBannerHTML();
  if (banner) {
    const host = document.createElement('div');
    host.className = currentTab === 'bracket' && T.competition !== 'ffa' && T.bracketType !== 'swiss' ? 'widepage' : 'page';
    host.style.paddingBottom = '0';
    host.innerHTML = banner;
    const tb = app.querySelector('#tabBody');
    tb.parentNode.insertBefore(host, tb);
    const go = host.querySelector('[data-turn-tab]');
    if (go) go.onclick = () => { currentTab = go.dataset.turnTab; syncTabURL(); drawTournament(); };
  }

  const body = document.getElementById('tabBody');
  if (currentTab === 'overview') drawOverview(body);
  else if (currentTab === 'players') drawPlayers(body);
  else if (currentTab === 'teams') drawTeams(body);
  else if (currentTab === 'bracket') drawBracket(body);
  else if (currentTab === 'vetoes') drawVetoes(body);
  else if (currentTab === 'maps') drawMaps(body);
  else if (currentTab === 'standings') drawStandings(body);
  else if (currentTab === 'admin') drawAdmin(body);
}

// ----- overview -----

function gameInfoPanel() {
  const cells = [];
  if (T.category) cells.push(['Type', T.category === 'official' ? 'Official' : 'Community']);
  if (T.ratingType && T.ratingType !== 'none') cells.push(['Rating', ratingTypeLabel(T.ratingType) + (T.ratingDate ? ', taken as of ' + new Date(T.ratingDate).toLocaleDateString() : ', taken at signup time') + ' — pulled from FAF']);
  else cells.push(['Rating', 'Entered by players']);
  cells.push(['Format', typeLine(T) + '\n' + planSummary(T)]);
  if (T.description) cells.push(['Briefing', T.description]);
  if (T.lobbyOptions) cells.push(['Lobby options', T.lobbyOptions]);
  if (T.mods) cells.push(['Mods', T.mods]);
  const imgs = (T.descImages || []);
  const gallery = imgs.length ? `<div class="desc-gallery">${imgs.map(f => `<a href="/desc-images/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="/desc-images/${encodeURIComponent(f)}" alt="" loading="lazy"></a>`).join('')}</div>` : '';
  if (!cells.length && !imgs.length) return '';
  return `<div class="panel section"><h2>Game <span class="h2-strong">Setup</span></h2><div class="infogrid">
    ${cells.map(c => `<div class="infocell"><div class="ic-label">${esc(c[0])}</div><div class="ic-body">${esc(c[1])}</div></div>`).join('')}
  </div>${gallery}</div>`;
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
    if (maps.length) inner += `<span class="mono small muted" title="Maps">${esc(maps.map((mp, i) => 'G' + (i + 1) + ': ' + mapName(mp)).join(' · '))}</span>`;
    const showBtn = !T.imported && withReport && (m.status === 'done' ? viewerIsAdmin() : canReportMatch(m));
    if (showBtn) inner += `<button class="btn amber small" data-m="${m.id}">Report</button>`;
    div.innerHTML = inner;
    if (showBtn) div.querySelector('[data-m]').onclick = () => reportScore(m.id);
    el.appendChild(div);
  }
}

