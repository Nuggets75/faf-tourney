// ----- players -----

function drawPlayers(el) {
  const admin = viewerIsOrganizer();
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
      const helpText = T.competition === 'ffa' && T.teamSize === 1 ? 'Every player enters solo. Lobbies are grouped automatically.'
            : T.formation === 'draft' ? 'The organizer picks captains from the player list once signups close, then captains draft their teams.'
            : 'Solo bracket — every signup is an entrant.';
      if (viewerSignedUp()) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="signed-in-note">You're signed up as <strong>${esc(me())}</strong>. ${esc(helpText)}</p>
          <button class="btn ghost small" id="sWithdraw">Withdraw</button></div>`;
      } else if (viewerLoggedIn() || !fafAuth.enabled) {
        // logged in (or pre-go-live): self-signup, name is your FAF identity
        html += `<div class="panel section"><h2>Sign up</h2>
          <div class="grid2">
            <div>
              ${fafAuth.enabled ? '<p class="muted small">Signing up as <strong>' + esc(me()) + '</strong> (your FAF account).</p>' : '<label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name" autocomplete="off">'}
              <label>Rating</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500" autocomplete="off">
              <div style="margin-top:16px"><button class="btn primary" id="sGo">Sign up${fafAuth.enabled ? ' as ' + esc(me()) : ''}</button></div>
            </div>
            <div class="muted small" style="align-self:end">${esc(helpText)}</div>
          </div></div>`;
      } else {
        // not logged in
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="muted small">${esc(helpText)}</p>
          <button class="btn faf" id="sLogin" style="max-width:280px">Log in with FAF to sign up</button></div>`;
      }
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
    // identity badges
    let badge = '';
    if (p.fafId) badge = ' <span class="idbadge verified" title="Verified FAF account">\u2713</span>';
    else if (p.manual) badge = ' <span class="idbadge manual" title="Added manually by organizer">M</span>';
    if (p.late) badge += ' <span class="idbadge late" title="Late signup">late</span>';
    // replace button: for players currently IN a team (mid-tournament drop-out replacement)
    const canReplace = admin && p.teamId;
    tr.innerHTML = `
      <td class="mono muted">${i + 1}</td>
      <td>${esc(p.name)}${badge}</td>
      <td class="mono">${p.rating != null ? p.rating : '<span class="muted">—</span>'}</td>
      ${T.formation === 'premade' && T.teamSize > 1 ? `<td>${esc(p.teamName || '—')}</td>` : ''}
      <td class="small muted" style="white-space:nowrap">${esc(inTeam)}</td>
      ${admin ? `<td style="text-align:right;white-space:nowrap">
        ${canReplace ? `<button class="btn ghost small" data-replace="${p.id}">Replace</button>` : ''}
        <button class="btn ghost small" data-edit="${p.id}">Edit</button>
        ${T.status === 'signup' || ((T.status === 'draft' || T.status === 'drafted') && !p.teamId) ? `<button class="btn danger small" data-del="${p.id}">${T.status === 'signup' && T.formation === 'premade' && T.teamSize > 1 ? 'Remove team' : 'Remove'}</button>` : ''}</td>` : ''}`;
    const eb = tr.querySelector('[data-edit]');
    if (eb) eb.onclick = () => editPlayer(p);
    const rb = tr.querySelector('[data-replace]');
    if (rb) rb.onclick = () => replacePlayer(p);
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

  const sLogin = document.getElementById('sLogin');
  if (sLogin) sLogin.onclick = requireLoginThen;

  const sWithdraw = document.getElementById('sWithdraw');
  if (sWithdraw) sWithdraw.onclick = async () => {
    const pid = T.viewer && T.viewer.signedUpPlayerId;
    if (!pid) return;
    if (!confirm('Withdraw from this tournament?')) return;
    try { await api('/api/t/' + T.id + '/remove', { playerId: pid }); toast('Withdrawn'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };

  const go = document.getElementById('sGo');
  if (go) go.onclick = async () => {
    const nameEl = document.getElementById('sName'); // only present pre-go-live (no OAuth)
    const body = {
      rating: document.getElementById('sRating').value,
      teamName: document.getElementById('sTeam') ? document.getElementById('sTeam').value : ''
    };
    if (nameEl) {
      const name = (nameEl.value || '').trim();
      if (!name) return toast('Enter your FAF name', true);
      body.name = name;
    }
    if (document.getElementById('sRating').value === '') return toast('Enter your rating — it is used for balancing and seeding', true);
    try {
      await api('/api/t/' + T.id + '/signup', body);
      toast('Signed up — good luck, commander');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

function replacePlayer(outP) {
  // eligible replacements: signed-up players not currently in a team (the pool / late signups)
  const pool = T.players.filter(p => !p.teamId && p.id !== outP.id);
  if (pool.length === 0) {
    modal(`<h3>Replace ${esc(outP.name)}</h3>
      <p class="muted small">There are no available players to swap in. Add a player (or share the late-signup link from the Admin tab), then replace.</p>
      <div class="actions"><button class="btn ghost" id="rpClose">Close</button></div>`, root => {
      root.querySelector('#rpClose').onclick = closeModal;
    });
    return;
  }
  const opts = pool.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .map(p => `<option value="${p.id}">${esc(p.name)}${p.rating != null ? ' (' + p.rating + ')' : ''}${p.late ? ' — late signup' : ''}</option>`).join('');
  modal(`<h3>Replace ${esc(outP.name)}</h3>
    <p class="muted small">The replacement takes over ${esc(outP.name)}'s exact spot — team, seed, and match results are all preserved. ${esc(outP.name)}'s current record stays with the slot.</p>
    <label>Swap in</label>
    <select id="rpSel" style="width:100%">${opts}</select>
    <div class="actions"><button class="btn ghost" id="rpCancel">Cancel</button><button class="btn primary" id="rpGo">Replace</button></div>`, root => {
    root.querySelector('#rpCancel').onclick = closeModal;
    root.querySelector('#rpGo').onclick = async () => {
      const replacementId = root.querySelector('#rpSel').value;
      try {
        await api('/api/t/' + T.id + '/replace_player', { playerId: outP.id, replacementId, admin: adminToken() });
        closeModal();
        toast('Player replaced');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
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

function drawOpenTeams(el) {
  const admin = viewerIsOrganizer();
  const myPid = T.viewer && T.viewer.signedUpPlayerId;
  const myPlayer = myPid ? T.players.find(p => p.id === myPid) : null;
  const myTeam = myPlayer && myPlayer.teamId ? T.teams.find(x => x.id === myPlayer.teamId) : null;
  const size = T.teamSize;
  let html = '';

  // ---- viewer's own status / actions ----
  if (!viewerLoggedIn() && fafAuth.enabled) {
    html += `<div class="panel section"><h2>Teams</h2>
      <p class="muted small">Log in with FAF and sign up (Players tab) to create or join a team.</p>
      <button class="btn faf" id="otLogin" style="max-width:280px">Log in with FAF</button></div>`;
  } else if (!myPlayer) {
    html += `<div class="panel section"><h2>Teams</h2>
      <p class="muted small">Sign up first on the <a href="#" data-goto="players">Players</a> tab, then come back to create or join a team.</p></div>`;
  } else if (myTeam) {
    const mates = myTeam.playerIds.map(pid => T.players.find(p => p.id === pid)).filter(Boolean);
    const isCap = myTeam.captainId === myPlayer.id;
    const full = myTeam.playerIds.length >= size;
    html += `<div class="panel section"><h2>Your team: ${esc(myTeam.name)} ${full ? '<span class="idbadge verified">full</span>' : '<span class="idbadge late">' + myTeam.playerIds.length + '/' + size + '</span>'}</h2>
      <div class="teammates">${mates.map(m => `<div class="teammate">${esc(m.name)}${m.id === myTeam.captainId ? ' <span class="cap-tag">captain</span>' : ''}${m.rating != null ? ' <span class="muted mono">' + m.rating + '</span>' : ''}</div>`).join('')}</div>
      <div style="margin-top:12px">
        <button class="btn ghost small" id="otLeave">Leave team</button>
        ${isCap && !myTeam.captainRenamed ? '<button class="btn ghost small" id="otRename" style="margin-left:6px">Rename</button>' : ''}
        ${isCap ? '<button class="btn danger small" id="otDisband" style="margin-left:6px">Disband team</button>' : ''}
      </div></div>`;
  } else {
    // signed up, no team: create or join
    html += `<div class="panel section"><h2>Create a team</h2>
      <div class="row" style="gap:8px;max-width:420px">
        <input type="text" id="otNewName" maxlength="30" placeholder="Team name" autocomplete="off" style="flex:1">
        <button class="btn primary" id="otCreate">Create</button>
      </div>
      <p class="muted small" style="margin-top:8px">You'll be captain. Teams need ${size} players to enter the bracket.</p></div>`;
  }

  // ---- all teams ----
  const canJoin = myPlayer && !myTeam;
  html += `<div class="panel section"><h2>Teams <span class="h2-strong">(${T.teams.length})</span></h2>`;
  if (T.teams.length === 0) {
    html += '<div class="empty">No teams yet. Be the first to create one.</div>';
  } else {
    html += '<div class="teamgrid">';
    for (const tm of T.teams.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const mems = tm.playerIds.map(pid => T.players.find(p => p.id === pid)).filter(Boolean);
      const full = tm.playerIds.length >= size;
      const openSlots = size - tm.playerIds.length;
      html += `<div class="teamcard ${full ? 'full' : 'open'}">
        <div class="tc-head"><span class="tc-name">${esc(tm.name)}</span><span class="tc-count ${full ? 'ok' : ''}">${tm.playerIds.length}/${size}</span></div>
        <div class="tc-members">${mems.map(m => `<div>${esc(m.name)}${m.id === tm.captainId ? ' <span class="cap-tag">C</span>' : ''}${admin && !full && m.id !== tm.captainId ? '' : ''}</div>`).join('')}</div>
        ${canJoin && !full ? `<button class="btn amber small tc-join" data-join="${tm.id}">Join (${openSlots} open)</button>` : ''}
        ${admin ? `<div class="tc-admin"><button class="btn ghost small" data-arename="${tm.id}">Rename</button><button class="btn danger small" data-adisband="${tm.id}">Disband</button></div>` : ''}
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // ---- unteamed players ----
  const unteamed = T.players.filter(p => !p.teamId);
  if (unteamed.length) {
    html += `<div class="panel section"><h2>Not on a team yet <span class="h2-strong">(${unteamed.length})</span></h2>
      <div class="unteamed">${unteamed.map(p => {
        let b = '';
        if (p.fafId) b = ' <span class="idbadge verified">\u2713</span>';
        return `<span class="unteamed-chip" ${admin ? 'data-assign="' + p.id + '"' : ''}>${esc(p.name)}${p.rating != null ? ' <span class="mono muted">' + p.rating + '</span>' : ''}${b}${admin ? ' <span class="assign-hint">assign\u2192</span>' : ''}</span>`;
      }).join('')}</div>
      ${admin ? '<p class="muted small" style="margin-top:8px">Click a player to assign them to a team.</p>' : ''}</div>`;
  }

  // ---- organizer: form teams / divisions ----
  if (admin) {
    const fullCount = T.teams.filter(x => x.playerIds.length >= size).length;
    html += `<div class="panel section"><h2>Start</h2>
      <p class="muted small">${fullCount} full team${fullCount === 1 ? '' : 's'} ready. Only full teams (${size} players) enter the bracket; incomplete teams and un-teamed players become reserves you can sub in later.</p>
      <button class="btn amber" id="otFormTeams">Close signups &amp; lock teams</button></div>`;
  }

  el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';

  // ---- wire everything ----
  el.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); currentTab = a.dataset.goto; syncTabURL(); drawTournament(); });
  const otLogin = document.getElementById('otLogin'); if (otLogin) otLogin.onclick = requireLoginThen;

  const call = async (path, body, okMsg) => {
    try { await api('/api/t/' + T.id + path, body); if (okMsg) toast(okMsg); await refresh(); }
    catch (e) { toast(e.message, true); }
  };

  const otCreate = document.getElementById('otCreate');
  if (otCreate) otCreate.onclick = () => {
    const name = (document.getElementById('otNewName').value || '').trim();
    if (!name) return toast('Enter a team name', true);
    call('/create_team', { name }, 'Team created');
  };
  const otLeave = document.getElementById('otLeave');
  if (otLeave) otLeave.onclick = () => { if (confirm('Leave your team?')) call('/leave_team', {}, 'Left team'); };
  const otDisband = document.getElementById('otDisband');
  if (otDisband) otDisband.onclick = () => { if (confirm('Disband your team? Everyone goes back to the pool.')) call('/disband_team', { teamId: myTeam.id }, 'Team disbanded'); };
  const otRename = document.getElementById('otRename');
  if (otRename) otRename.onclick = () => {
    const name = prompt('New team name:', myTeam.name);
    if (name && name.trim()) call('/rename_team', { teamId: myTeam.id, name: name.trim(), admin: adminToken() }, 'Renamed');
  };
  el.querySelectorAll('[data-join]').forEach(b => b.onclick = () => call('/join_team', { teamId: b.dataset.join }, 'Joined team'));
  el.querySelectorAll('[data-adisband]').forEach(b => b.onclick = () => { if (confirm('Disband this team?')) call('/disband_team', { teamId: b.dataset.adisband }, 'Team disbanded'); });
  el.querySelectorAll('[data-arename]').forEach(b => b.onclick = () => {
    const tm = T.teams.find(x => x.id === b.dataset.arename);
    const name = prompt('New team name:', tm ? tm.name : '');
    if (name && name.trim()) call('/rename_team', { teamId: b.dataset.arename, name: name.trim(), admin: adminToken() }, 'Renamed');
  });
  el.querySelectorAll('[data-assign]').forEach(c => c.onclick = () => organizerAssignPlayer(c.dataset.assign));
  const otFormTeams = document.getElementById('otFormTeams');
  if (otFormTeams) otFormTeams.onclick = () => call('/phase', { action: 'form_teams', admin: adminToken() });
}

// organizer: assign an unteamed player to a team (or create context)
function organizerAssignPlayer(playerId) {
  const size = T.teamSize;
  const teamsWithSpace = T.teams.filter(x => x.playerIds.length < size);
  const p = T.players.find(x => x.id === playerId);
  if (!p) return;
  const opts = teamsWithSpace.map(x => `<option value="${x.id}">${esc(x.name)} (${x.playerIds.length}/${size})</option>`).join('');
  modal(`<h3>Assign ${esc(p.name)}</h3>
    ${teamsWithSpace.length ? `<label>Add to team</label><select id="apSel" style="width:100%">${opts}</select>`
      : '<p class="muted small">No teams have open slots. Create one first (as a player) or free up space.</p>'}
    <div class="actions"><button class="btn ghost" id="apCancel">Cancel</button>${teamsWithSpace.length ? '<button class="btn primary" id="apGo">Assign</button>' : ''}</div>`, root => {
    root.querySelector('#apCancel').onclick = closeModal;
    const go = root.querySelector('#apGo');
    if (go) go.onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/move_player', { playerId, teamId: root.querySelector('#apSel').value, admin: adminToken() });
        closeModal(); toast('Player assigned'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

function drawTeams(el) {
  const admin = viewerIsOrganizer();
  let html = '';

  // OPEN formation during signups: players form teams themselves; organizer manages.
  if (T.status === 'signup' && T.formation === 'open') {
    return drawOpenTeams(el);
  }

  if (T.status === 'signup') {
    if (admin) {
      if (T.formation === 'draft') {
        html += `<div class="panel section"><h2>Captains &amp; draft</h2>
          <p class="muted small">Mark who the captains are in the list below. The number of captains is the number of teams. Pick order: ${T.draftOrder === 'snake' ? 'snake (1\u2192N, N\u21921, ...)' : 'bottom seed to top seed, every round'}. Each captain fills a team of ${T.teamSize}.</p>
          <div class="pool" id="capPool"></div>
          <div id="capCount" class="cap-count"></div>
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

  // Divisions (King/Prince) — team single/double elim only, before the bracket starts
  if (T.status === 'drafted' && admin && T.competition === 'team' && (T.bracketType === 'single' || T.bracketType === 'double')) {
    const divs = T.divisions || 0;
    html += `<div class="panel section"><h2>Divisions</h2>
      <p class="muted small">Optionally split teams into skill divisions (e.g. King &amp; Prince) \u2014 each plays its own bracket. Auto-split by combined team rating, then adjust below.</p>
      <div class="row" style="gap:8px;align-items:center">
        <span class="muted small">Split into</span>
        <select id="divCount">${[1,2,3,4].map(n => '<option value="' + n + '"' + ((divs || 1) === n ? ' selected' : '') + '>' + (n === 1 ? 'One bracket (no split)' : n + ' divisions') + '</option>').join('')}</select>
        <button class="btn ghost small" id="divApply">Apply split</button>
      </div>`;
    if (divs > 1) {
      const divNames = ['', 'King', 'Prince', 'Duke', 'Baron', 'Knight', 'Squire'];
      html += '<div class="divgrid" style="margin-top:14px">';
      for (let d = 1; d <= divs; d++) {
        const dteams = T.teams.filter(x => (x.division || 0) === d)
          .sort((a, b) => teamRating(b) - teamRating(a));
        html += `<div class="divcol"><h3>${esc(divNames[d] || ('Division ' + d))} <span class="muted mono">(${dteams.length})</span></h3>`;
        for (const tm of dteams) {
          const opts = [];
          for (let dd = 1; dd <= divs; dd++) opts.push('<option value="' + dd + '"' + (dd === d ? ' selected' : '') + '>' + (divNames[dd] || ('Div ' + dd)) + '</option>');
          html += `<div class="divteam"><span>${esc(tm.name)} <span class="muted mono">${teamRating(tm)}</span></span>
            <select data-divteam="${tm.id}">${opts.join('')}</select></div>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
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
    // seed selection from the server's pendingCaptains (persisted across reloads)
    if (Object.keys(F.capSel).length === 0 && (T.pendingCaptains || []).length) {
      for (const id of T.pendingCaptains) F.capSel[id] = 1;
    }
    const nPlayers = T.players.length;
    const updateCount = () => {
      const n = Object.keys(F.capSel).length;
      const el = document.getElementById('capCount');
      if (!el) return;
      if (n < 2) { el.innerHTML = '<span class="muted">Mark at least 2 captains.</span>'; return; }
      const perTeam = T.teamSize;
      const needed = n * perTeam;
      const preview = 'Bracket preview: <strong>' + n + '</strong> team' + (n === 1 ? '' : 's') + ' (' + n + ' captain' + (n === 1 ? '' : 's') + ', ' + perTeam + ' per team = ' + needed + ' players needed).';
      const have = nPlayers >= needed ? '' : ' <span class="warn">You have ' + nPlayers + ' signed up; ' + (needed - nPlayers) + ' more needed to fill all teams.</span>';
      el.innerHTML = preview + have;
    };
    // debounced persistence of the captain set to the server
    let capSaveTimer = null;
    const persistCaptains = () => {
      clearTimeout(capSaveTimer);
      capSaveTimer = setTimeout(() => {
        api('/api/t/' + T.id + '/phase', { action: 'set_captains', captainIds: Object.keys(F.capSel), admin: adminToken() }).catch(() => {});
      }, 400);
    };
    const tbl = document.createElement('table');
    tbl.innerHTML = '<thead><tr><th style="width:40px">#</th><th>Name</th><th style="width:90px">Rating</th><th style="width:110px">Captain</th></tr></thead>';
    const tb = document.createElement('tbody');
    const sorted = T.players.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
    sorted.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono muted">${i + 1}</td><td>${esc(p.name)}</td><td class="mono">${p.rating != null ? p.rating : '\u2014'}</td>
        <td class="capcell"></td>`;
      const paint = () => {
        const on = !!F.capSel[p.id];
        tr.className = 'pickrow' + (on ? ' on' : '');
        tr.querySelector('.capcell').innerHTML = on ? '<span class="cap-yes">CAPTAIN</span>' : '<span class="cap-no">click to set</span>';
      };
      paint();
      tr.onclick = () => {
        if (F.capSel[p.id]) delete F.capSel[p.id]; else F.capSel[p.id] = 1;
        paint(); updateCount(); persistCaptains();
      };
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    capPool.appendChild(tbl);
    updateCount();
    document.getElementById('startDraft').onclick = async () => {
      const ids = Object.keys(F.capSel);
      if (ids.length < 2) return toast('Mark at least 2 captains', true);
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
      const canRename = admin || !!(T.viewer && T.viewer.teamId === team.id && T.teamSize > 1 && !team.captainRenamed);
      card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${team.seed}</span>${canRename ? '<button class="btn ghost small" data-rename="' + team.id + '" style="margin-left:6px">Rename</button>' : ''}</h3>
        <ul>${team.playerIds.map(pid => {
          const r = ratingOf(pid);
          return `<li style="display:flex;justify-content:space-between;gap:8px"><span>${esc(playerName(pid))}${pid === team.captainId && T.teamSize > 1 ? '<span class="captag">CAPTAIN</span>' : ''}</span>${anyRatings ? '<span class="mono muted">' + (r != null ? r : '\u2014') + '</span>' : ''}</li>`;
        }).join('')}${
          Array(openSlots).fill('<li class="openslot">\u2014 open \u2014</li>').join('')}</ul>${
        anyRatings ? '<div class="teamtotal"><span>TOTAL</span><span class="mono">' + total + '</span></div>' : ''}`;
      tg.appendChild(card);
    }
    tg.querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => {
      const tm = T.teams.find(x => x.id === b.dataset.rename);
      const name = prompt('New team name:', tm ? tm.name : '');
      if (!name || !name.trim()) return;
      try { await api('/api/t/' + T.id + '/rename_team', { teamId: b.dataset.rename, name: name.trim(), admin: adminToken() }); await refresh(); toast('Renamed'); }
      catch (e) { toast(e.message, true); }
    });
  }

  const divApply = document.getElementById('divApply');
  if (divApply) divApply.onclick = async () => {
    const n = parseInt(document.getElementById('divCount').value, 10) || 1;
    try { await api('/api/t/' + T.id + '/split_divisions', { divisions: n, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-divteam]').forEach(sel => sel.onchange = async () => {
    try { await api('/api/t/' + T.id + '/set_division', { teamId: sel.dataset.divteam, division: parseInt(sel.value, 10), admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });

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

