// ----- players -----

function drawPlayers(el) {
  const admin = viewerIsOrganizer();
  let html = '';

  if (T.status === 'signup') {
    const teamReg = (T.formation === 'premade' && T.teamSize > 1) && !fafAuth.enabled;
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
            : T.formation === 'open' ? 'After signing up here, go to the Teams tab to create or join a team.'
            : (T.formation === 'premade' && T.teamSize > 1) ? 'Sign up and enter your team name. Teammates enter the exact same name to be grouped together. You can also set or change it later on the Teams tab.'
            : 'Solo bracket — every signup is an entrant.';
      const suNotOpen = T.signupOpensAt && new Date(T.signupOpensAt).getTime() > Date.now();
      const ratReq = (T.minRating != null || T.maxRating != null)
        ? '<p class="muted small">Rating requirement: ' + (T.minRating != null && T.maxRating != null ? T.minRating + '\u2013' + T.maxRating : T.minRating != null ? T.minRating + ' or higher' : 'up to ' + T.maxRating) + '. Signups outside the range are refused (organizer invites are exempt).</p>'
        : '';
      if (T.viewer && T.viewer.invited && !viewerSignedUp() && !admin) {
        html += `<div class="panel section" style="border-left:3px solid var(--amber)"><h2>You're invited</h2>
          <p class="muted small">The organizer invited you to this tournament. Sign up below, or decline so they can plan around it.</p>
          <button class="btn ghost small" id="sDeclineInv">Decline invite</button></div>`;
      }
      if (suNotOpen && !admin && !viewerSignedUp()) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="muted small">Signups haven\u2019t opened yet \u2014 they open <strong>${esc(fmtDateTime(T.signupOpensAt))}</strong>.</p>
          ${ratReq}</div>`;
      } else if (viewerSignedUp() && (() => { const mine = T.players.find(pl => pl.id === T.viewer.signedUpPlayerId); return mine && mine.pending; })()) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="signed-in-note">Your signup request is <strong>waiting for organizer approval</strong>. You'll appear in the player list once accepted.</p>
          <button class="btn danger small" id="sWithdraw">Withdraw request</button></div>`;
      } else if (viewerSignedUp()) {
        const myDc = (fafAuth.user && fafAuth.user.discord) || '';
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="signed-in-note">You're signed up as <strong>${esc(me())}</strong>. ${esc(helpText)}</p>
          ${fafAuth.enabled ? (myDc
            ? '<p class="muted small">Discord: <span class="dctag">\uD83D\uDCAC ' + esc(myDc) + '</span> <a href="#" id="sDcEdit">change</a></p>'
            : `<div class="dc-nudge"><label>Discord handle <span class="muted small">(optional \u2014 so the organizer and your teammates can reach you)</span></label>
                 <p class="muted small" style="margin:4px 0 6px">Enter your Discord <strong>username</strong> \u2014 the unique all-lowercase handle from Settings \u2192 My Account \u2014 not your display name.</p>
                 <div class="row" style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" id="sDcAdd" maxlength="40" autocomplete="off" style="max-width:240px"><button class="btn small" id="sDcSave">Save</button></div></div>`) : ''}
          <button class="btn danger small" id="sWithdraw" style="margin-top:10px">Withdraw</button></div>`;
      } else if ((viewerLoggedIn() || !fafAuth.enabled) && T.signupMode === 'invite' && !(T.viewer && T.viewer.invited) && !admin) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="muted small">This tournament is <strong>invite only</strong>. Ask the organizer for an invite \u2014 once invited, you can sign up here.</p></div>`;
      } else if (viewerLoggedIn() || !fafAuth.enabled) {
        // logged in (or pre-go-live): self-signup, name is your FAF identity
        html += `<div class="panel section"><h2>Sign up</h2>
          <div class="grid2">
            <div>
              ${fafAuth.enabled ? '<p class="muted small">Signing up as <strong>' + esc(me()) + '</strong> (your FAF account).</p>' : '<label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name" autocomplete="off">'}
              ${(T.formation === 'premade' && T.teamSize > 1) ? '<label>Team name</label><input type="text" id="sTeam" maxlength="30" placeholder="Your team name" autocomplete="off">' : ''}
              ${fafAuth.enabled ? '<label>Discord handle <span class="muted small">(optional \u2014 so the organizer and teammates can reach you)</span></label><p class="muted small" style="margin:4px 0 6px">Your Discord <strong>username</strong> \u2014 the unique all-lowercase handle from Settings \u2192 My Account \u2014 not your display name. Saved to your account for all tournaments.</p><input type="text" id="sDiscord" maxlength="40" autocomplete="off" value="' + esc((fafAuth.user && fafAuth.user.discord) || '') + '">' : ''}
              ${(T.ratingType && T.ratingType !== 'none')
                ? '<p class="muted small">Rating for this tournament: <strong>' + esc(ratingTypeLabel(T.ratingType)) + '</strong>, taken <strong>' + (T.ratingDate ? 'as of ' + new Date(T.ratingDate).toLocaleDateString() : 'at signup time') + '</strong>. It is pulled from FAF automatically \u2014 you don\u2019t enter it.</p>'
                : '<label>Rating</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500" autocomplete="off">'}
              ${T.signupMode === 'request' && !admin ? '<p class="muted small">This tournament is <strong>request only</strong>: an organizer approves your signup before you appear in the list.</p>' : ''}
              ${ratReq}
              <div style="margin-top:16px"><button class="btn primary" id="sGo">${T.signupMode === 'request' && !admin ? 'Request to sign up' : 'Sign up'}${fafAuth.enabled ? ' as ' + esc(me()) : ''}</button></div>
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

  if (admin && T.status === 'signup') {
    const pendingReqs = T.players.filter(pl => pl.pending);
    html += `<div class="panel section"><h2>Organizer <span class="h2-strong">tools</span></h2>
      <label>FAF player lookup <span class="muted small">(exact FAF name \u2014 verified against FAF, rating pulled per this tournament's settings)</span></label>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="ogName" maxlength="40" autocomplete="off" style="max-width:240px">
        <button class="btn small" id="ogLookup">Look up</button>
      </div>
      <div id="ogResult" style="margin-top:8px"></div>
      ${(T.invites || []).length ? '<div style="margin-top:12px"><div class="ic-label">Invited (' + T.invites.length + ')</div><p class="muted small" style="margin:4px 0 6px">Pending and declined invites are cleared automatically when the tournament starts.</p>' + T.invites.map(i => {
        const chip = i.status === 'accepted' ? '<span class="invchip accepted">accepted</span>' : i.status === 'declined' ? '<span class="invchip declined">declined</span>' : '<span class="invchip pending">pending</span>';
        return '<div class="sa-req"><div class="sa-req-main"><div class="sa-req-name">' + esc(i.name) + ' ' + chip + '</div></div><div class="sa-req-act">' + (i.status !== 'accepted' ? '<button class="btn ghost small" data-uninvite="' + esc(i.fafId) + '">Uninvite</button>' : '') + '</div></div>';
      }).join('') + '</div>' : ''}
      ${pendingReqs.length ? '<div style="margin-top:12px"><div class="ic-label">Signup requests (' + pendingReqs.length + ')</div>' + pendingReqs.map(pl => '<div class="sa-req"><div class="sa-req-main"><div class="sa-req-name">' + esc(pl.name) + (pl.rating != null ? ' <span class="muted mono small">' + pl.rating + '</span>' : '') + '</div></div><div class="sa-req-act"><button class="btn primary small" data-sapprove="' + pl.id + '">Accept</button><button class="btn ghost small" data-sdecline="' + pl.id + '">Decline</button></div></div>').join('') + '</div>' : ''}
    </div>`;
  }
  html += `<div class="panel section"><h2>Players <span class="h2-strong">(${T.players.filter(pl => !pl.pending).length}${T.teamSize === 1 && T.maxTeams ? ' of ' + T.maxTeams : ''}${T.teamSize === 1 && T.minTeams ? ', min ' + T.minTeams : ''})</span></h2>
    <table><thead><tr><th>#</th><th>Name</th><th>Rating</th>${T.teamSize > 1 ? '<th>Team</th>' : ''}${admin ? '<th></th>' : ''}</tr></thead>
    <tbody id="pRows"></tbody></table>
    ${T.players.length ? '' : '<div class="empty">No signups yet.</div>'}</div>`;

  el.innerHTML = html;

  const rows = document.getElementById('pRows');
  // Always show the player list ranked by rating (highest first); unrated players sit at the
  // bottom. The "#" column is just the row position in this ranking.
  const orderedPlayers = T.players.slice().sort((a, b) => {
    const ar = a.rating, br = b.rating;
    if (ar == null && br == null) return 0;
    if (ar == null) return 1;
    if (br == null) return -1;
    return br - ar;
  });
  orderedPlayers.forEach((p, i) => {
    const tr = document.createElement('tr');
    const inTeam = p.teamId ? teamName(p.teamId) : (p.teamName || (T.subs && T.subs.includes(p.id) ? 'Substitute' : '—'));
    // identity badges
    let badge = '';
    if (p.manual) badge = ' <span class="idbadge manual" title="Added manually by organizer">M</span>';
    if (p.late) badge += ' <span class="idbadge late" title="Late signup">late</span>';
    // replace button: for players currently IN a team (mid-tournament drop-out replacement)
    const canReplace = admin && p.teamId;
    tr.innerHTML = `
      <td class="mono muted">${i + 1}</td>
      <td>${esc(p.name)}${p.note ? ' <span class="muted small">(' + esc(p.note) + ')</span>' : ''}${p.pending ? ' <span class="idbadge late" title="Signup request — awaiting organizer approval">pending</span>' : ''}${badge}${p.discord ? ' <span class="dctag" title="Discord — reach this player here">\uD83D\uDCAC ' + esc(p.discord) + '</span>' : ''}</td>
      <td class="mono">${p.rating != null ? p.rating : '<span class="muted">—</span>'}</td>
      ${T.teamSize > 1 ? `<td class="small muted" style="white-space:nowrap">${esc(inTeam)}</td>` : ''}
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

  // organizer tools: verified lookup -> add / invite; requests; uninvite
  const ogLookup = document.getElementById('ogLookup');
  if (ogLookup) ogLookup.onclick = async () => {
    const name = document.getElementById('ogName').value.trim();
    if (!name) return toast('Enter a FAF name', true);
    const box = document.getElementById('ogResult');
    box.innerHTML = '<span class="muted small">Looking up\u2026</span>';
    try {
      const r = await api('/api/t/' + T.id + '/faf_lookup', { name, admin: adminToken() });
      const needManualRating = !T.ratingType || T.ratingType === 'none';
      box.innerHTML = '<div class="sa-req"><div class="sa-req-main"><div class="sa-req-name">' + esc(r.name) + ' <span class="muted mono small">id ' + esc(r.fafId) + '</span></div>' +
        '<div class="muted small">' + (r.rating != null ? 'Rating (' + esc(T.ratingType || 'global') + '): ' + r.rating : 'No fetched rating') + (r.globalRating != null && T.ratingType !== 'global' ? ' \u00b7 global: ' + r.globalRating : '') + '</div></div>' +
        '<div class="sa-req-act">' + (needManualRating ? '<input type="number" id="ogRating" min="0" max="4000" placeholder="rating" style="width:90px">' : '') +
        (T.signupMode === 'invite' ? '<button class="btn amber small" id="ogInvite">Invite</button>' : '') +
        '<button class="btn primary small" id="ogAdd">Add to tournament</button></div></div>';
      const doCall = async (path, extra) => {
        try { await api('/api/t/' + T.id + '/' + path, Object.assign({ name: r.name, admin: adminToken() }, extra || {})); toast('Done'); await refresh(); }
        catch (e) { toast(e.message, true); }
      };
      const inv = document.getElementById('ogInvite'); if (inv) inv.onclick = () => doCall('invite_player');
      const add = document.getElementById('ogAdd'); if (add) add.onclick = () => {
        const rEl = document.getElementById('ogRating');
        doCall('org_add_player', rEl ? { rating: rEl.value } : {});
      };
    } catch (e) { box.innerHTML = ''; toast(e.message, true); }
  };
  const sdi = document.getElementById('sDeclineInv');
  if (sdi) sdi.onclick = async () => {
    if (!confirm('Decline the invite to this tournament?')) return;
    try { await api('/api/t/' + T.id + '/decline_invite', {}); toast('Invite declined'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-uninvite]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/uninvite_player', { fafId: b.dataset.uninvite, admin: adminToken() }); toast('Uninvited'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-sapprove]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/respond_signup', { playerId: b.dataset.sapprove, accept: 1, admin: adminToken() }); toast('Accepted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-sdecline]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/respond_signup', { playerId: b.dataset.sdecline, accept: 0, admin: adminToken() }); toast('Declined'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });

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
    const rEl = document.getElementById('sRating');  // absent when the rating is auto-fetched
    const body = {
      teamName: document.getElementById('sTeam') ? document.getElementById('sTeam').value : ''
    };
    if (rEl) body.rating = rEl.value;
    if (nameEl) {
      const name = (nameEl.value || '').trim();
      if (!name) return toast('Enter your FAF name', true);
      body.name = name;
    }
    if (rEl && rEl.value === '') return toast('Enter your rating — it is used for balancing and seeding', true);
    try {
      const dcEl = document.getElementById('sDiscord');
      if (dcEl) {
        const cur = (fafAuth.user && fafAuth.user.discord) || '';
        if (dcEl.value.trim() !== cur) { await api('/api/my/profile', { discord: dcEl.value }); await refreshFafAuth(); }
      }
      await api('/api/t/' + T.id + '/signup', body);
      toast('Signed up — good luck, commander');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

  const sDcSave = document.getElementById('sDcSave');
  if (sDcSave) sDcSave.onclick = async () => {
    const v = document.getElementById('sDcAdd').value.trim();
    if (!v) return toast('Enter your Discord username', true);
    try { await api('/api/my/profile', { discord: v }); await refreshFafAuth(); toast('Saved'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const sDcEdit = document.getElementById('sDcEdit');
  if (sDcEdit) sDcEdit.onclick = (e) => { e.preventDefault(); loginFlow(); };
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
  const canEditRating = !T.ratingType || T.ratingType === 'none';
  modal(`
    <h3>Edit player</h3>
    <p class="muted small">Names come from FAF and can't be changed. You can attach a note (shown in brackets after the name)${canEditRating ? ' and adjust the rating' : ''}.</p>
    <label>Note <span class="muted small">(optional, e.g. "sub for X" or "streamer")</span></label>
    <input type="text" id="epNote" maxlength="40" value="${esc(p.note || '')}" autocomplete="off">
    ${(T.formation === 'premade' && T.teamSize > 1 && T.status === 'signup')
      ? '<label>Team name <span class="muted small">(groups players with the same name; empty = substitute)</span></label><input type="text" id="epTeam" maxlength="30" value="' + esc((p.teamName || '').trim()) + '" autocomplete="off">'
      : ''}
    ${canEditRating
      ? '<label>Rating</label><input type="number" id="epRating" min="0" max="4000" value="' + (p.rating != null ? p.rating : '') + '" autocomplete="off">'
      : '<p class="muted small">Rating: <strong>' + (p.rating != null ? p.rating : '\u2014') + '</strong> \u2014 fetched from FAF, not editable.</p>'}
    <div class="actions">
      <button class="btn ghost" id="epCancel">Cancel</button>
      <button class="btn primary" id="epGo">Save</button>
    </div>`, root => {
    root.querySelector('#epCancel').onclick = closeModal;
    root.querySelector('#epGo').onclick = async () => {
      try {
        const body = { playerId: p.id, note: root.querySelector('#epNote').value, admin: adminToken() };
        const rEl = root.querySelector('#epRating');
        if (rEl) body.rating = rEl.value;
        const tEl = root.querySelector('#epTeam');
        if (tEl) body.teamName = tEl.value.trim();
        await api('/api/t/' + T.id + '/edit_player', body);
        closeModal();
        toast('Player updated');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// ----- teams / draft -----

function localDatetimeValue(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

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
      <div class="teammates">${mates.map(m => `<div class="teammate">${esc(m.name)}${m.id === myTeam.captainId ? ' <span class="cap-tag">captain</span>' : ''}${m.rating != null ? ' <span class="muted mono">' + m.rating + '</span>' : ''}${m.discord ? ' <span class="dctag" title="Discord">\uD83D\uDCAC ' + esc(m.discord) + '</span>' : ''}</div>`).join('')}</div>
      ${full ? `<div style="margin-top:10px">${myTeam.checkedIn ? '<span class="idbadge verified">Checked in \u2713</span> <button class="btn ghost small" id="otUncheck" style="margin-left:6px">Undo check-in</button>' : '<button class="btn primary small" id="otCheckin">Check in</button> <span class="muted small" style="margin-left:8px">Any team member can check in.</span>'}</div>` : ''}
      <div style="margin-top:12px">
        <button class="btn ghost small" id="otLeave">Leave team</button>
        ${isCap && !myTeam.captainRenamed ? '<button class="btn ghost small" id="otRename" style="margin-left:6px">Rename</button>' : ''}
        ${isCap ? '<button class="btn danger small" id="otDisband" style="margin-left:6px">Disband team</button>' : ''}
      </div>
      ${isCap && !full && (myTeam.invites || []).length ? `<div style="margin-top:12px"><div class="ic-label">Invites sent (${myTeam.invites.length})</div><div class="tc-requests">${myTeam.invites.map(iv => `<div class="tc-req"><span>${esc(iv.name)} <span class="muted small">\u2014 waiting for a reply</span></span><span class="tc-req-btns"><button class="btn ghost small" data-cancel-invite="${iv.playerId}">Cancel</button></span></div>`).join('')}</div></div>` : ''}
      </div>`;
  } else {
    // signed up, no team: show any invites received, then create-or-join
    const myInvites = T.teams.filter(tm => (tm.invites || []).some(iv => iv.playerId === myPlayer.id) && tm.playerIds.length < size);
    if (myInvites.length) {
      html += `<div class="panel section" style="border-left:3px solid var(--amber)"><h2>Invites to join a team <span class="h2-strong">(${myInvites.length})</span></h2>
        <div class="tc-requests">${myInvites.map(tm => {
          const sum = (tm.playerIds.map(pid => T.players.find(p => p.id === pid)).filter(Boolean)).reduce((a, m) => a + (m.rating || 0), 0);
          return `<div class="tc-req"><span><strong>${esc(tm.name)}</strong> <span class="muted small">${tm.playerIds.length}/${size}${T.maxTeamRating != null ? ' · rating ' + sum + '/' + T.maxTeamRating : ''}</span> invited you</span>
            <span class="tc-req-btns"><button class="btn primary small" data-accept-invite="${tm.id}">Accept</button> <button class="btn ghost small" data-decline-invite="${tm.id}">Decline</button></span></div>`;
        }).join('')}</div></div>`;
    }
    html += `<div class="panel section"><h2>Create a team</h2>
      <div class="row" style="gap:8px;max-width:420px">
        <input type="text" id="otNewName" maxlength="30" placeholder="Team name" autocomplete="off" style="flex:1">
        <button class="btn primary" id="otCreate">Create</button>
      </div>
      <p class="muted small" style="margin-top:8px">You'll be captain. Teams need ${size} players to enter the bracket. Once you have a team, invite players from the pool or approve requests to join.</p></div>`;
  }

  // ---- check-in deadline ----
  const canJoin = myPlayer && !myTeam;
  if (T.checkInDeadline || admin) {
    const dl = T.checkInDeadline ? new Date(T.checkInDeadline) : null;
    const passed = dl && Date.now() > T.checkInDeadline;
    html += `<div class="panel section"><h2>Check-in</h2>`;
    if (dl) html += `<p class="${passed ? 'warn' : 'muted'} small">Deadline: <strong>${esc(dl.toLocaleString())}</strong>${passed ? ' — passed' : ''}. Any member of a full team can check it in.</p>`;
    else html += `<p class="muted small">No check-in deadline set. Teams enter by signup order up to the cap.</p>`;
    if (admin) html += `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
      <input type="datetime-local" id="ciDeadline"${dl ? ` value="${localDatetimeValue(T.checkInDeadline)}"` : ''}>
      <button class="btn ghost small" id="ciSave">Set deadline</button>
      ${dl ? '<button class="btn ghost small" id="ciClear">Clear</button>' : ''}</div>`;
    html += '</div>';
  }

  // ---- teams: participants / waiting list / forming ----
  const cap = T.maxTeams > 0 ? T.maxTeams : 0;
  const unitWord = size === 1 ? 'players' : 'teams';
  const minMaxNote = (T.minTeams || cap)
    ? '<p class="muted small" style="margin:-4px 0 10px">'
      + (T.minTeams ? 'Minimum ' + T.minTeams + ' ' + unitWord + (cap ? ', maximum ' + cap : '') : 'Maximum ' + cap + ' ' + unitWord)
      + ' \u2014 minimum is a target; the organizer decides whether to start or abandon.</p>'
    : '';
  const fullTeams = T.teams.filter(x => x.playerIds.length >= size);
  const useCheckin = !!T.checkInDeadline || fullTeams.some(x => x.checkedIn);
  const orderedFull = fullTeams.slice().sort((a, b) => {
    if (useCheckin && !!a.checkedIn !== !!b.checkedIn) return a.checkedIn ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  const participants = cap ? orderedFull.slice(0, cap) : orderedFull;
  const waitlist = cap ? orderedFull.slice(cap) : [];
  const forming = T.teams.filter(x => x.playerIds.length < size).slice().sort((a, b) => a.name.localeCompare(b.name));

  const teamCard = (tm) => {
    const mems = tm.playerIds.map(pid => T.players.find(p => p.id === pid)).filter(Boolean);
    const full = tm.playerIds.length >= size;
    const openSlots = size - tm.playerIds.length;
    return `<div class="teamcard ${full ? 'full' : 'open'}">
      <div class="tc-head"><span class="tc-name">${esc(tm.name)}</span><span class="tc-counts">${T.maxTeamRating != null ? (() => { const sum = mems.reduce((a, m) => a + (m.rating || 0), 0); return '<span class="tc-count' + (sum > T.maxTeamRating ? ' over' : '') + '" title="Combined rating / maximum">' + sum + '/' + T.maxTeamRating + '</span>'; })() : ''}<span class="tc-count ${full ? 'ok' : ''}" title="Players / team size">${tm.playerIds.length}/${size}</span></span></div>
      <div class="tc-members">${mems.map(m => `<div>${esc(m.name)}${m.id === tm.captainId ? ' <span class="cap-tag">C</span>' : ''}${m.discord ? ' <span class="dctag" title="Discord">\uD83D\uDCAC ' + esc(m.discord) + '</span>' : ''}</div>`).join('')}</div>
      ${full ? `<div class="tc-checkin">${tm.checkedIn ? '<span class="idbadge verified">checked in</span>' : '<span class="idbadge late">not checked in</span>'}</div>` : ''}
      ${canJoin && !full ? ((tm.joinRequests || []).some(r => r.playerId === myPlayer.id)
        ? `<div class="tc-pending"><span class="muted small">Request pending</span> <button class="btn ghost small" data-cancel-join="${tm.id}">Cancel</button></div>`
        : `<button class="btn amber small tc-join" data-request-join="${tm.id}">Request to join (${openSlots} open)</button>`) : ''}
      ${(((myPlayer && tm.captainId === myPlayer.id) || admin) && (tm.joinRequests || []).length) ? `<div class="tc-requests">${tm.joinRequests.map(r => `<div class="tc-req"><span>${esc(r.name)} wants to join</span><span class="tc-req-btns"><button class="btn primary small" data-approve="${tm.id}:${r.playerId}">Accept</button> <button class="btn ghost small" data-decline="${tm.id}:${r.playerId}">Decline</button></span></div>`).join('')}</div>` : ''}
      ${admin ? `<div class="tc-admin">${full ? `<button class="btn ghost small" data-checkin="${tm.id}" data-val="${tm.checkedIn ? 0 : 1}">${tm.checkedIn ? 'Un-check' : 'Check in'}</button>` : ''}<button class="btn ghost small" data-arename="${tm.id}">Rename</button><button class="btn danger small" data-adisband="${tm.id}">Disband</button></div>` : ''}
    </div>`;
  };

  if (!T.teams.length) {
    html += '<div class="panel section"><h2>Teams</h2><div class="empty">No teams yet. Be the first to create one.</div></div>';
  } else {
    html += `<div class="panel section"><h2>Participants <span class="h2-strong">(${participants.length}${cap ? ' of ' + cap : ''}${T.minTeams ? ', min ' + T.minTeams : ''})</span></h2>${minMaxNote}`;
    html += participants.length ? '<div class="teamgrid">' + participants.map(teamCard).join('') + '</div>' : '<div class="empty">No full teams yet.</div>';
    html += '</div>';
    if (waitlist.length) {
      html += `<div class="panel section"><h2>Waiting list <span class="h2-strong">(${waitlist.length})</span></h2>
        <p class="muted small" style="margin-bottom:8px">Beyond the ${cap}-team cap. If a participant drops or misses check-in, the next checked-in waiting team moves up (signup order).</p>
        <div class="teamgrid">${waitlist.map(teamCard).join('')}</div></div>`;
    }
    if (forming.length) {
      html += `<div class="panel section"><h2>Forming <span class="h2-strong">(${forming.length})</span></h2>
        <p class="muted small" style="margin-bottom:8px">Not full yet — need ${size} players to enter.</p>
        <div class="teamgrid">${forming.map(teamCard).join('')}</div></div>`;
    }
  }

  // ---- unteamed players ----
  const unteamed = T.players.filter(p => !p.teamId);
  // the viewer can invite if they captain a team that still has room (or is an organizer)
  const myCapTeam = (myTeam && myPlayer && myTeam.captainId === myPlayer.id && myTeam.playerIds.length < size) ? myTeam : null;
  const canInvite = !!myCapTeam || admin;
  if (unteamed.length) {
    html += `<div class="panel section"><h2>Not on a team yet <span class="h2-strong">(${unteamed.length})</span></h2>
      <div class="unteamed">${unteamed.slice().sort((a, b) => {
        const ar = a.rating, br = b.rating;
        if (ar == null && br == null) return 0;
        if (ar == null) return 1; if (br == null) return -1; return br - ar;
      }).map(p => {
        let b = '';
        if (p.fafId) b = ' <span class="idbadge verified">\u2713</span>';
        const invitedByMine = myCapTeam && (myCapTeam.invites || []).some(iv => iv.playerId === p.id);
        const inviteBtn = (canInvite && !admin) ? (invitedByMine
            ? ' <button class="btn ghost small" data-cancel-invite="' + p.id + '">Cancel invite</button>'
            : ' <button class="btn amber small" data-invite="' + p.id + '">Invite</button>')
          : '';
        return `<span class="unteamed-chip" ${admin ? 'data-assign="' + p.id + '"' : ''}>${esc(p.name)}${p.rating != null ? ' <span class="mono muted">' + p.rating + '</span>' : ''}${b}${admin ? ' <span class="assign-hint">assign\u2192</span>' : inviteBtn}</span>`;
      }).join('')}</div>
      ${admin ? '<p class="muted small" style="margin-top:8px">Click a player to assign them to a team.</p><button class="btn ghost small" id="otOrgCreate">+ New team from a free agent</button>' : (myCapTeam ? '<p class="muted small" style="margin-top:8px">You\u2019re captain of a team with room \u2014 invite players above, or they can request to join.</p>' : '')}</div>`;
  }

  // ---- organizer: form teams / divisions ----
  if (admin) {
    const fullCount = fullTeams.length;
    const ci = fullTeams.filter(x => x.checkedIn).length;
    html += `<div class="panel section"><h2>Start</h2>
      <p class="muted small">${fullCount} full team${fullCount === 1 ? '' : 's'}${useCheckin ? ', ' + ci + ' checked in' : ''}. ${cap ? 'Up to ' + cap + ' enter as participants' + (useCheckin ? ' (checked-in first, then signup order)' : ' (signup order)') + '; the rest' : 'Incomplete teams and extras'} become reserves you can sub in later.</p>
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
  el.querySelectorAll('[data-request-join]').forEach(b => b.onclick = () => call('/request_join', { teamId: b.dataset.requestJoin }, 'Request sent — the captain will approve it'));
  el.querySelectorAll('[data-cancel-join]').forEach(b => b.onclick = () => call('/cancel_join', { teamId: b.dataset.cancelJoin }, 'Request withdrawn'));
  el.querySelectorAll('[data-invite]').forEach(b => b.onclick = () => call('/invite_to_team', { teamId: myCapTeam.id, playerId: b.dataset.invite }, 'Invite sent'));
  el.querySelectorAll('[data-cancel-invite]').forEach(b => b.onclick = () => call('/cancel_invite', { teamId: myCapTeam.id, playerId: b.dataset.cancelInvite }, 'Invite cancelled'));
  el.querySelectorAll('[data-accept-invite]').forEach(b => b.onclick = () => call('/respond_invite', { teamId: b.dataset.acceptInvite, accept: 1 }, 'Joined the team'));
  el.querySelectorAll('[data-decline-invite]').forEach(b => b.onclick = () => call('/respond_invite', { teamId: b.dataset.declineInvite, accept: 0 }, 'Invite declined'));
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => { const [teamId, playerId] = b.dataset.approve.split(':'); call('/respond_join', { teamId, playerId, accept: 1 }, 'Added to your team'); });
  el.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => { const [teamId, playerId] = b.dataset.decline.split(':'); call('/respond_join', { teamId, playerId, accept: 0 }, 'Declined'); });
  el.querySelectorAll('[data-adisband]').forEach(b => b.onclick = () => { if (confirm('Disband this team?')) call('/disband_team', { teamId: b.dataset.adisband }, 'Team disbanded'); });
  el.querySelectorAll('[data-arename]').forEach(b => b.onclick = () => {
    const tm = T.teams.find(x => x.id === b.dataset.arename);
    const name = prompt('New team name:', tm ? tm.name : '');
    if (name && name.trim()) call('/rename_team', { teamId: b.dataset.arename, name: name.trim(), admin: adminToken() }, 'Renamed');
  });
  el.querySelectorAll('[data-assign]').forEach(c => c.onclick = () => organizerAssignPlayer(c.dataset.assign));
  const otFormTeams = document.getElementById('otFormTeams');
  if (otFormTeams) otFormTeams.onclick = () => call('/phase', { action: 'form_teams', admin: adminToken() });

  // check-in (member checks in their own full team; organizer toggles any team)
  const otCheckin = document.getElementById('otCheckin');
  if (otCheckin) otCheckin.onclick = () => call('/checkin_team', { value: 1 }, 'Checked in');
  const otUncheck = document.getElementById('otUncheck');
  if (otUncheck) otUncheck.onclick = () => call('/checkin_team', { value: 0 }, 'Check-in undone');
  el.querySelectorAll('[data-checkin]').forEach(b => b.onclick = () => call('/checkin_team', { teamId: b.dataset.checkin, value: +b.dataset.val, admin: adminToken() }, 'Updated'));

  // check-in deadline (organizer)
  const ciSave = document.getElementById('ciSave');
  if (ciSave) ciSave.onclick = () => { const v = document.getElementById('ciDeadline').value; if (!v) return toast('Pick a date and time', true); call('/edit_info', { checkInDeadline: v, admin: adminToken() }, 'Deadline set'); };
  const ciClear = document.getElementById('ciClear');
  if (ciClear) ciClear.onclick = () => call('/edit_info', { checkInDeadline: '', admin: adminToken() }, 'Deadline cleared');

  // organizer: build a team around a free agent (#6)
  const otOrgCreate = document.getElementById('otOrgCreate');
  if (otOrgCreate) otOrgCreate.onclick = () => {
    const free = T.players.filter(p => !p.teamId);
    if (!free.length) return toast('No free agents to team up', true);
    modal(`<h3>New team from a free agent</h3>
      <label>Player (becomes captain)</label>
      <select id="ocPlayer">${free.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <label style="margin-top:10px">Team name <span class="muted small">(optional)</span></label>
      <input type="text" id="ocName" maxlength="30" autocomplete="off">
      <div class="actions"><button class="btn ghost" id="ocCancel">Cancel</button><button class="btn primary" id="ocSave">Create</button></div>`, root => {
      root.querySelector('#ocCancel').onclick = closeModal;
      root.querySelector('#ocSave').onclick = async () => {
        const playerId = root.querySelector('#ocPlayer').value;
        const name = root.querySelector('#ocName').value.trim();
        try { await api('/api/t/' + T.id + '/org_create_team', { playerId, name, admin: adminToken() }); closeModal(); toast('Team created'); await refresh(); }
        catch (e) { toast(e.message, true); }
      };
    });
  };
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
    } else if (!(T.formation === 'premade' && T.teamSize > 1)) {
      html += '<div class="panel section"><div class="empty">Teams appear here once the organizer closes signups.</div></div>';
    }
    // Premade: teams take shape during signups — show them live, and let a signed-up
    // player set or change their team name here (previously withdraw + re-signup was
    // the only way, which cost people their slot).
    if (T.formation === 'premade' && T.teamSize > 1) {
      const myPid = T.viewer && T.viewer.signedUpPlayerId;
      const myP = myPid ? T.players.find(p => p.id === myPid) : null;
      if (myP) {
        const cur = (myP.teamName || '').trim();
        html += `<div class="panel section"><h2>Your team name</h2>
          <p class="muted small">${cur ? 'You entered <strong>' + esc(cur) + '</strong>. Teammates must enter the exact same name to be grouped with you.' : 'You haven\u2019t entered a team name yet \u2014 without one you become a substitute when signups close. Enter the exact name your teammates use to join their team, or a new name to start one.'}</p>
          <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="text" id="pmName" maxlength="30" autocomplete="off" style="max-width:240px" value="${esc(cur)}" placeholder="Team name">
            <button class="btn primary small" id="pmSave">Save</button>
          </div></div>`;
      }
      // live grouping preview (players still pending approval are excluded)
      const eligible = T.players.filter(p => !p.pending);
      const groups = {};
      for (const p of eligible) {
        const key = (p.teamName || '').trim().toLowerCase();
        if (!key) continue;
        (groups[key] = groups[key] || []).push(p);
      }
      const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || a.localeCompare(b));
      const noTeam = eligible.filter(p => !(p.teamName || '').trim());
      if (keys.length) {
        html += `<div class="panel section"><h2>Forming <span class="h2-strong">(${keys.length})</span></h2>
          <p class="muted small" style="margin-bottom:8px">Grouped by team name as entered at signup. Teams need exactly ${T.teamSize} players; extras and players without a full team become substitutes when signups close.</p>
          <div class="teamgrid">`;
        for (const k of keys) {
          const mems = groups[k].slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
          const dispName = (mems[0].teamName || '').trim();
          const n = mems.length, sz = T.teamSize;
          const cls = n === sz ? 'full' : 'open';
          const over = n > sz;
          html += `<div class="teamcard ${cls}">
            <div class="tc-head"><span class="tc-name">${esc(dispName)}</span><span class="tc-counts">${T.maxTeamRating != null ? (() => { const sum = mems.reduce((a, m) => a + (m.rating || 0), 0); return '<span class="tc-count' + (sum > T.maxTeamRating ? ' over' : '') + '" title="Combined rating / maximum">' + sum + '/' + T.maxTeamRating + '</span>'; })() : ''}<span class="tc-count ${n === sz ? 'ok' : ''}" title="Players / team size">${n}/${sz}${over ? ' \u26A0' : ''}</span></span></div>
            <div class="tc-members">${mems.map(m => `<div><span class="tc-mem-name">${esc(m.name)}</span>${m.rating != null ? ' <span class="muted mono">' + m.rating + '</span>' : ''}${m.discord ? ' <span class="dctag" title="Discord">\uD83D\uDCAC ' + esc(m.discord) + '</span>' : ''}${admin ? ' <a href="#" class="muted small" data-pmedit="' + m.id + '">edit</a>' : ''}</div>`).join('')}</div>
            ${over ? '<div class="warn small" style="margin-top:6px">Too many players \u2014 only the first ' + sz + ' by signup order enter; the rest become substitutes.</div>' : ''}
          </div>`;
        }
        html += '</div></div>';
      }
      if (noTeam.length) {
        const noTeamSorted = noTeam.slice().sort((a, b) => {
          const ar = a.rating, br = b.rating;
          if (ar == null && br == null) return 0;
          if (ar == null) return 1;
          if (br == null) return -1;
          return br - ar;
        });
        html += `<div class="panel section"><h2>No team name yet <span class="h2-strong">(${noTeam.length})</span></h2>
          <p class="muted small" style="margin-bottom:8px">These players become substitutes unless they enter a team name before signups close.</p>
          <div class="unteamed">${noTeamSorted.map(p => `<span class="unteamed-chip">${esc(p.name)}${p.rating != null ? ' <span class="muted mono">' + p.rating + '</span>' : ''}${admin ? ' <a href="#" class="assign-hint" data-pmedit="' + p.id + '">set team\u2192</a>' : ''}</span>`).join('')}</div></div>`;
      }
      if (!keys.length && !noTeam.length && !myP) {
        html += '<div class="panel section"><div class="empty">No signups yet.</div></div>';
      }
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
    const subPs = T.subs.map(id => T.players.find(p => p.id === id)).filter(Boolean)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const anyR = subPs.some(p => p.rating != null);
    html += `<div class="panel section"><h2>Substitutes <span class="h2-strong">(${subPs.length})</span></h2>
      <table><thead><tr><th style="width:40px">#</th><th>Name</th>${anyR ? '<th style="width:90px">Rating</th>' : ''}</tr></thead><tbody>` +
      subPs.map((p, i) => `<tr><td class="mono muted">${i + 1}</td><td>${esc(p.name)}${p.fafId ? ' <span class="idbadge verified">\u2713</span>' : ''}${p.discord ? ' <span class="dctag" title="Discord \u2014 reach this player here">\uD83D\uDCAC ' + esc(p.discord) + '</span>' : ''}</td>${anyR ? '<td class="mono">' + (p.rating != null ? p.rating : '\u2014') + '</td>' : ''}</tr>`).join('') +
      '</tbody></table></div>';
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

  // premade: player sets/changes their own team name during signup
  const pmSave = document.getElementById('pmSave');
  if (pmSave) pmSave.onclick = async () => {
    const v = document.getElementById('pmName').value.trim();
    try {
      await api('/api/t/' + T.id + '/set_team_name', { teamName: v });
      toast(v ? 'Team name saved' : 'Team name cleared');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  // premade: organizer edits any player's team name from the preview
  el.querySelectorAll('[data-pmedit]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    const p = T.players.find(x => x.id === a.dataset.pmedit);
    if (!p) return;
    modal(`<h3>Team name \u2014 ${esc(p.name)}</h3>
      <label>Team name <span class="muted small">(empty makes them a substitute)</span></label>
      <input type="text" id="pmeName" maxlength="30" autocomplete="off" value="${esc((p.teamName || '').trim())}">
      <div class="actions"><button class="btn ghost" id="pmeCancel">Cancel</button><button class="btn primary" id="pmeGo">Save</button></div>`, root => {
      root.querySelector('#pmeCancel').onclick = closeModal;
      root.querySelector('#pmeGo').onclick = async () => {
        try {
          await api('/api/t/' + T.id + '/set_team_name', { playerId: p.id, teamName: root.querySelector('#pmeName').value.trim(), admin: adminToken() });
          closeModal(); toast('Saved'); await refresh();
        } catch (e2) { toast(e2.message, true); }
      };
    });
  });

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
        anyRatings ? '<div class="teamtotal"><span>TOTAL</span><span class="mono' + (T.maxTeamRating != null && total > T.maxTeamRating ? ' warn' : '') + '">' + total + (T.maxTeamRating != null ? ' / ' + T.maxTeamRating : '') + '</span></div>' : ''}`;
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

