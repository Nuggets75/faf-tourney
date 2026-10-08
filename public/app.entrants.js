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
      // Which rating counts, as of when, and whether you qualify - as one bordered callout rather
      // than three grey sentences competing with the Discord help text. Players were missing it.
      const ratingCalloutHTML = () => {
        const src = ratingSourceHtml(T);
        const req = (T.minRating != null || T.maxRating != null)
          ? 'Rating requirement: <strong>' + (T.minRating != null && T.maxRating != null
              ? T.minRating + '\u2013' + T.maxRating
              : T.minRating != null ? T.minRating + ' or higher' : 'up to ' + T.maxRating)
            + '</strong>. Signups outside the range are refused (organizer invites are exempt).'
          : '';
        if (!src && !req) return '';
        return '<div class="rating-callout">'
          + (src ? '<div class="rc-src">' + src + '</div>' : '')
          + (req ? '<div class="rc-req muted small">' + req + '</div>' : '')
          + '</div>';
      };
      // "Check my rating": people cannot see their own FAF rating from here, so without this the
      // only way to find out whether they qualify is to press Sign up and be refused. The button
      // asks the same question the signup gate asks, and answers it without signing anyone up.
      const ratingCheckOn = () => !!(T.ratingType && T.ratingType !== 'none' && (viewerLoggedIn() || !fafAuth.enabled));
      const ratingCheckHTML = (opts) => {
        if (!ratingCheckOn()) return '';
        const o = opts || {};
        return `<div class="rating-check" id="ratingCheckBox">
          <button class="btn ghost${o.small ? ' small' : ''}" id="rcGo">Check my rating for this tournament</button>
          <div class="muted small rc-note">Just a check \u2014 it does not sign you up.</div>
          <div id="rcOut" class="rc-out" hidden></div>
        </div>`;
      };

      // A banned viewer should be told before they press anything. T.myBan is set for whichever
      // scope caught them (tournament, series or the site-wide official ban).
      if (T.myBan && !viewerSignedUp()) {
        const scopeTxt = T.myBan.scope === 'global' ? 'official FAF tournaments'
          : T.myBan.scope === 'series' ? 'this series' : 'this tournament';
        html += `<div class="panel section ban-notice"><h2>You can\u2019t sign up</h2>
          <p>You are currently banned from <strong>${esc(scopeTxt)}</strong>.</p>
          ${T.myBan.reason ? '<p class="muted small">Reason: ' + esc(T.myBan.reason) + '</p>' : ''}
          <p class="muted small">${T.myBan.expires
            ? 'This ban expires on <strong>' + esc(fmtDate(T.myBan.expires)) + '</strong>.'
            : 'This ban has no expiry date.'}
            ${T.myBan.scope === 'global' ? 'For more information please contact the TD team.' : 'Contact the organizers if you think this is wrong.'}</p></div>`;
      }
      if (T.viewer && T.viewer.invited && !viewerSignedUp() && !admin) {
        html += `<div class="panel section" style="border-left:3px solid var(--amber)"><h2>You're invited</h2>
          <p class="muted small">The organizer invited you to this tournament. Sign up below, or decline so they can plan around it.</p>
          <button class="btn ghost small" id="sDeclineInv">Decline invite</button></div>`;
      }
      if (suNotOpen && !admin && !viewerSignedUp()) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="muted small">Signups haven\u2019t opened yet \u2014 they open <strong>${esc(fmtDateTime(T.signupOpensAt))}</strong>.</p>
          ${ratingCalloutHTML()}
          ${ratingCheckHTML()}</div>`;
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
          ${ratingCheckHTML({ small: 1 })}
          <button class="btn danger small" id="sWithdraw" style="margin-top:10px">Withdraw</button></div>`;
      } else if ((viewerLoggedIn() || !fafAuth.enabled) && T.signupMode === 'invite' && !(T.viewer && T.viewer.invited) && !admin) {
        html += `<div class="panel section"><h2>Sign up</h2>
          <p class="muted small">This tournament is <strong>invite only</strong>. Ask the organizer for an invite \u2014 once invited, you can sign up here.</p>
          ${ratingCalloutHTML()}
          ${ratingCheckHTML()}</div>`;
      } else if (viewerLoggedIn() || !fafAuth.enabled) {
        // logged in (or pre-go-live): self-signup, name is your FAF identity
        html += `<div class="panel section"><h2>Sign up</h2>
          <div class="grid2">
            <div>
              ${fafAuth.enabled ? '<p class="muted small">Signing up as <strong>' + esc(me()) + '</strong> (your FAF account).</p>' : '<label>FAF name</label><input type="text" id="sName" maxlength="30" placeholder="Your in-game name" autocomplete="off">'}
              ${ratingCalloutHTML()}
              ${(T.formation === 'premade' && T.teamSize > 1) ? '<label>Team name</label><input type="text" id="sTeam" maxlength="30" placeholder="Your team name" autocomplete="off">' : ''}
              ${fafAuth.enabled ? '<label>Discord handle <span class="muted small">(optional \u2014 so the organizer and teammates can reach you)</span></label><p class="muted small" style="margin:4px 0 6px">Your Discord <strong>username</strong> \u2014 the unique all-lowercase handle from Settings \u2192 My Account \u2014 not your display name. Saved to your account for all tournaments.</p><input type="text" id="sDiscord" maxlength="40" autocomplete="off" value="' + esc((fafAuth.user && fafAuth.user.discord) || '') + '">' : ''}
              ${(T.ratingType && T.ratingType !== 'none') ? '' : '<label>Rating</label><input type="number" id="sRating" min="0" max="4000" placeholder="e.g. 1500" autocomplete="off">'}
              ${T.signupMode === 'request' && !admin ? '<p class="muted small">This tournament is <strong>request only</strong>: an organizer approves your signup before you appear in the list.</p>' : ''}
              <div class="signup-actions"><button class="btn primary" id="sGo">${T.signupMode === 'request' && !admin ? 'Request to sign up' : 'Sign up'}${fafAuth.enabled ? ' as ' + esc(me()) : ''}</button>${ratingCheckHTML()}</div>
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
      <label>FAF player lookup <span class="muted small">(exact FAF name or FAF id \u2014 verified against FAF, rating pulled per this tournament's settings)</span></label>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="ogName" maxlength="40" autocomplete="off" style="max-width:240px">
        <button class="btn small" id="ogLookup">Look up</button>
      </div>
      <div id="ogResult" style="margin-top:8px"></div>
      ${(T.invites || []).length ? '<div style="margin-top:12px"><div class="ic-label">Invited (' + T.invites.length + ')</div><p class="muted small" style="margin:4px 0 6px">Pending and declined invites are cleared automatically when the tournament starts.</p>' + T.invites.map(i => {
        const chip = i.status === 'accepted' ? '<span class="invchip accepted">accepted</span>' : i.status === 'declined' ? '<span class="invchip declined">declined</span>' : '<span class="invchip pending">pending</span>';
        // invites created by qualification carry the tournament they came from
        const via = i.viaName ? '<span class="inv-via" title="Invited automatically by qualifying">via ' + esc(i.viaName) + '</span>' : '';
        return '<div class="sa-req"><div class="sa-req-main"><div class="sa-req-name">' + esc(i.name) + ' ' + chip + via + '</div></div><div class="sa-req-act">' + (i.status !== 'accepted' ? '<button class="btn ghost small" data-uninvite="' + esc(i.fafId) + '">Uninvite</button>' : '') + '</div></div>';
      }).join('') + '</div>' : ''}
      ${pendingReqs.length ? '<div style="margin-top:12px"><div class="ic-label">Signup requests (' + pendingReqs.length + ')</div>' + pendingReqs.map(pl => '<div class="sa-req"><div class="sa-req-main"><div class="sa-req-name">' + esc(pl.name) + (pl.rating != null ? ' <span class="muted mono small">' + pl.rating + '</span>' : '') + '</div></div><div class="sa-req-act"><button class="btn primary small" data-sapprove="' + pl.id + '">Accept</button><button class="btn ghost small" data-sdecline="' + pl.id + '">Decline</button></div></div>').join('') + '</div>' : ''}
    </div>`;
  }
  html += `<div class="panel section"><h2>Players <span class="h2-strong">(${T.players.filter(pl => !pl.pending).length}${T.teamSize === 1 && T.maxTeams ? ' of ' + T.maxTeams : ''}${T.teamSize === 1 && T.minTeams ? ', min ' + T.minTeams : ''})</span></h2>
    <table><thead><tr><th>#</th><th>Name</th><th>Rating</th>${T.teamSize > 1 ? '<th>Team</th>' : ''}${admin ? '<th></th>' : ''}</tr></thead>
    <tbody id="pRows"></tbody></table>
    ${T.players.length ? '' : '<div class="empty">No signups yet.</div>'}</div>`;

  // On a solo field the players list IS the entrant list, so the seeding order belongs here
  // rather than buried on the Admin tab ("on the players list, could you add an option to
  // choose their seedings"). Team events keep it next to the teams, which is what gets seeded.
  if (T.teamSize === 1) html += seedPanelHTML();

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
        <button class="btn ghost small" data-allrat="${p.id}" title="Show this player's rating on every leaderboard (organizers only)">Ratings</button>
        ${canReplace ? `<button class="btn ghost small" data-replace="${p.id}">Replace</button>` : ''}
        <button class="btn ghost small" data-edit="${p.id}">Edit</button>
        ${T.status === 'signup' || ((T.status === 'draft' || T.status === 'drafted') && !p.teamId) ? `<button class="btn danger small" data-del="${p.id}">${T.status === 'signup' && T.formation === 'premade' && T.teamSize > 1 ? 'Remove team' : 'Remove'}</button>` : ''}
        ${p.fafId ? `<button class="btn danger small" data-ban="${p.id}" data-banfid="${esc(p.fafId)}" data-banname="${esc(p.name)}" title="Ban from this tournament so they can't sign up again">Ban</button>` : ''}</td>` : ''}`;
    const arb = tr.querySelector('[data-allrat]');
    if (arb) arb.onclick = () => showAllRatings(p);
    const eb = tr.querySelector('[data-edit]');
    if (eb) eb.onclick = () => editPlayer(p);
    const rb = tr.querySelector('[data-replace]');
    if (rb) rb.onclick = () => replacePlayer(p);
    const db = tr.querySelector('[data-del]');
    if (db) db.onclick = async () => {
      try { await api('/api/t/' + T.id + '/remove', { playerId: p.id, admin: adminToken() }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    const bb = tr.querySelector('[data-ban]');
    if (bb) bb.onclick = () => banPlayerFromTournament(p);
    rows.appendChild(tr);
  });

  wireSeedPanel();   // no-op unless seedPanelHTML rendered above

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
    if (!name) return toast('Enter a FAF name or FAF id', true);
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

  // ---- read-only rating check ----
  // Deliberately renders the verdict AND the numbers behind it: "you qualify" alone is not
  // useful to someone who is trying to work out how far off they are.
  const rcBtn = document.getElementById('rcGo');
  if (rcBtn) rcBtn.onclick = async () => {
    const out = document.getElementById('rcOut');
    rcBtn.disabled = true;
    const label = rcBtn.textContent;
    rcBtn.textContent = 'Checking\u2026';
    if (out) { out.hidden = false; out.className = 'rc-out'; out.innerHTML = '<span class="muted small">Asking FAF\u2026</span>'; }
    let r;
    try { r = await api('/api/t/' + T.id + '/check_rating', {}); }
    catch (e) {
      rcBtn.disabled = false; rcBtn.textContent = label;
      if (out) { out.className = 'rc-out bad'; out.innerHTML = esc(e.message); }
      return;
    }
    rcBtn.disabled = false; rcBtn.textContent = label;
    if (!out) return;

    if (!r.rated) { out.className = 'rc-out'; out.innerHTML = esc(r.message || 'This tournament does not use FAF ratings.'); return; }
    if (r.rating == null) { out.className = 'rc-out warn'; out.innerHTML = esc(r.message || 'No rating found.'); return; }

    const board = r.ratingType === 'rc' ? 'RC' : r.ratingType;
    const asOf = r.asOf ? ' as of <strong>' + esc(fmtDate(r.asOf)) + '</strong>' : ' (current)';
    const bits = ['<div class="rc-num">Your <strong>' + esc(board) + '</strong> rating' + asOf + ': <strong>' + r.rating + '</strong></div>'];
    if (r.capped != null) bits.push('<div class="muted small">This tournament caps ratings, so you would be seeded as ' + r.capped + '.</div>');

    const range = (r.min != null && r.max != null) ? r.min + '\u2013' + r.max
      : r.min != null ? r.min + ' or higher'
      : r.max != null ? 'up to ' + r.max : null;
    if (range) bits.push('<div class="muted small">This tournament asks for <strong>' + esc(range) + '</strong>.</div>');

    let cls = 'rc-out good', verdict;
    if (r.banned) { cls = 'rc-out bad'; verdict = esc(r.banned); }
    else if (r.eligible === false) { cls = 'rc-out bad'; verdict = esc(r.message); }
    else if (r.alreadyIn) verdict = 'You qualify \u2014 and you are already signed up.';
    else if (r.exempt && range) verdict = 'You are invited, so the rating range does not apply to you. You can sign up.';
    else verdict = range ? 'You qualify \u2014 you can sign up here.' : 'Nothing is stopping you signing up here.';

    out.className = cls;
    out.innerHTML = '<div class="rc-verdict">' + verdict + '</div>' + bits.join('');
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
      maybeRemindDiscord();
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
  // Two ways in: someone already on the standby list, or anyone on FAF by name or id. The second
  // exists because the person who can actually play the next match is often not someone who
  // happened to sign up as a reserve - and with an empty standby list this used to be a dead end.
  const pool = T.players.filter(p => !p.teamId && p.id !== outP.id);
  const opts = pool.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .map(p => `<option value="${p.id}">${esc(p.name)}${p.rating != null ? ' (' + p.rating + ')' : ''}${p.late ? ' \u2014 late signup' : ''}</option>`).join('');
  const manualBoard = !T.ratingType || T.ratingType === 'none';
  modal(`<h3>Replace ${esc(outP.name)}</h3>
    <p class="muted small">The replacement takes over ${esc(outP.name)}'s exact spot \u2014 team, seed and every result so far stay with the slot.</p>
    ${pool.length ? `<label>From the standby list</label>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="rpSel" style="flex:1">${opts}</select>
        <button class="btn primary" id="rpGo">Replace</button>
      </div>
      <div class="muted small" style="margin:14px 0 2px">\u2026or bring in someone who is not signed up:</div>`
      : '<p class="muted small" style="margin-top:10px">Nobody is on the standby list, so look the replacement up on FAF.</p>'}
    <label>FAF name or FAF id</label>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" id="rpLook" maxlength="40" autocomplete="off" placeholder="exact FAF name, or the account id" style="flex:1">
      <button class="btn" id="rpFind">Look up</button>
    </div>
    <div id="rpFound" style="margin-top:10px"></div>
    <div class="actions"><button class="btn ghost" id="rpCancel">Cancel</button></div>`, root => {
    root.querySelector('#rpCancel').onclick = closeModal;
    const done = async (res) => {
      closeModal();
      toast('Replaced ' + ((res && res.from) || outP.name) + ' with ' + ((res && res.name) || 'the new player'));
      await refresh();
    };

    const go = root.querySelector('#rpGo');
    if (go) go.onclick = async () => {
      try { done(await api('/api/t/' + T.id + '/replace_player', { playerId: outP.id, replacementId: root.querySelector('#rpSel').value, admin: adminToken() })); }
      catch (e) { toast(e.message, true); }
    };

    const box = root.querySelector('#rpFound');
    const look = root.querySelector('#rpLook');
    const find = async () => {
      const q = look.value.trim();
      if (!q) return toast('Enter a FAF name or FAF id', true);
      box.innerHTML = '<span class="muted small">Asking FAF\u2026</span>';
      let r;
      try { r = await api('/api/t/' + T.id + '/faf_lookup', { name: q, admin: adminToken() }); }
      catch (e) { box.innerHTML = ''; return toast(e.message, true); }
      // Say it up front rather than let the swap bounce: somebody already in a slot cannot take
      // another one, and the player being replaced cannot replace themselves.
      const already = T.players.find(p => p.fafId && String(p.fafId) === String(r.fafId));
      const blocked = (already && already.id === outP.id) ? 'That is the player being replaced.'
        : (already && already.teamId) ? r.name + ' is already playing in this tournament.' : '';
      const needRating = r.rating == null && !(already && !already.teamId);
      box.innerHTML = `<div class="sa-req"><div class="sa-req-main">
          <div class="sa-req-name">${esc(r.name)} <span class="muted mono small">id ${esc(r.fafId)}</span>${already && !already.teamId ? ' <span class="idbadge verified">on the standby list</span>' : ''}</div>
          <div class="muted small">${r.rating != null ? 'Rating (' + esc(T.ratingType || 'global') + '): ' + r.rating
            : (manualBoard ? 'This tournament takes ratings by hand.' : 'FAF has no ' + esc(T.ratingType) + ' rating for this player \u2014 enter one.')}</div>
          ${blocked ? '<div class="warn small" style="margin-top:4px">' + esc(blocked) + '</div>' : ''}
        </div>
        <div class="sa-req-act">
          ${needRating && !blocked ? '<input type="number" id="rpRating" min="0" max="4000" placeholder="rating" style="width:90px">' : ''}
          ${blocked ? '' : '<button class="btn primary small" id="rpUse">Replace with ' + esc(r.name) + '</button>'}
        </div></div>`;
      const use = box.querySelector('#rpUse');
      if (use) use.onclick = async () => {
        const body = { playerId: outP.id, lookup: r.fafId, admin: adminToken() };
        const rEl = box.querySelector('#rpRating');
        if (rEl) {
          if (rEl.value === '') return toast('Enter a rating for ' + r.name, true);
          body.rating = rEl.value;
        }
        try { done(await api('/api/t/' + T.id + '/replace_player', body)); }
        catch (e) { toast(e.message, true); }
      };
    };
    root.querySelector('#rpFind').onclick = find;
    look.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
    setTimeout(() => { try { (pool.length ? root.querySelector('#rpSel') : look).focus(); } catch (e) {} }, 0);
  });
}

// Organizer-only: every leaderboard rating for one player. It is INFORMATION, nothing more -
// only the tournament's configured rating decided their entry, their cap and their seed, and the
// modal says so plainly so nobody mistakes a higher board for a problem.
const RAT_BOARDS = [
  ['global', 'Global'], ['1v1', '1v1 / ladder'],
  ['2v2', '2v2 (TMM)'], ['3v3', '3v3 (TMM)'], ['4v4', '4v4 (TMM)']
];
async function showAllRatings(p, refresh) {
  const load = async (root, doRefresh) => {
    const body = root.querySelector('#arBody');
    body.innerHTML = '<div class="empty">Asking FAF\u2026</div>';
    let d;
    try {
      const at = adminToken();
      d = await api('/api/t/' + T.id + '/player_ratings?playerId=' + encodeURIComponent(p.id)
        + (at ? '&admin=' + encodeURIComponent(at) : '') + (doRefresh ? '&refresh=1' : ''));
    } catch (e) { body.innerHTML = '<div class="warn small">' + esc(e.message) + '</div>'; return; }
    if (!d.allRatings || !d.allRatings.boards) {
      body.innerHTML = '<div class="empty">' + esc(d.reason || 'No ratings available for this player.') + '</div>';
      return;
    }
    const b = d.allRatings.boards;
    const counts = d.counts;
    const asOf = d.ratingDate ? fmtDate(new Date(d.ratingDate).toISOString()) : 'their signup time';
    body.innerHTML = `<p class="muted small" style="margin:0 0 10px">As of <strong>${esc(asOf)}</strong>.
        Only <strong>${esc(ratingTypeLabel(counts))}</strong> counted for entry, the rating cap and seeding \u2014
        everything else here is for your information only.</p>
      <table class="ar-table"><thead><tr><th>Leaderboard</th><th>Rating</th><th>Games</th></tr></thead><tbody>
      ${RAT_BOARDS.map(([k, label]) => {
        const row = b[k] || {};
        const isCounted = counts === k;
        return `<tr class="${isCounted ? 'ar-counted' : ''}">
          <td>${esc(label)}${isCounted ? ' <span class="ar-chip">counts</span>' : ''}</td>
          <td class="mono">${row.rating != null ? row.rating : '<span class="muted">\u2014</span>'}</td>
          <td class="mono muted">${row.games != null ? row.games : '\u2014'}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
      ${counts === 'rc' ? '<p class="muted small" style="margin-top:8px">This tournament uses <strong>Fearghal\u2019s RC</strong>, a blend of the 2v2/3v3/4v4/Global boards above rather than any single one.</p>' : ''}
      ${d.capped != null ? '<p class="muted small" style="margin-top:8px">Their ' + esc(ratingTypeLabel(counts)) + ' of <strong>' + d.countsRating + '</strong> is above this tournament\u2019s cap, so it counts as <strong>' + d.capped + '</strong>.</p>' : ''}`;
  };
  modal(`<h3>${esc(p.name)} <span class="muted" style="font-weight:400">\u2014 all ratings</span></h3>
    <div id="arBody"><div class="empty">Asking FAF\u2026</div></div>
    <div class="actions"><button class="btn ghost" id="arRefresh">Re-pull from FAF</button><button class="btn ghost" id="arClose">Close</button></div>`, root => {
    root.querySelector('#arClose').onclick = closeModal;
    root.querySelector('#arRefresh').onclick = () => load(root, true);
    load(root, !!refresh);
  }, { mid: true });
}

// "Remove" alone was a revolving door: the player just signed up again. This bans them from THIS
// tournament and, where removal is still allowed, takes them out in the same action - which is
// what an organizer actually means by "kick".
// The ban is written FIRST on purpose: if the removal then fails, they are banned but still
// listed, which an organizer can see and finish by hand. The other order could leave them removed
// and un-banned, i.e. free to walk straight back in.
function banPlayerFromTournament(p) {
  const removable = T.status === 'signup' || ((T.status === 'draft' || T.status === 'drafted') && !p.teamId);
  const today = new Date().toISOString().slice(0, 10);
  modal(`<h3>Ban ${esc(p.name)} from this tournament?</h3>
    <p class="muted small">They won't be able to sign up, be added or be invited to <strong>${esc(T.name)}</strong> again. Other tournaments are unaffected.</p>
    <label>Reason <span class="muted small">(optional, shown to them)</span></label>
    <input type="text" id="bpR" maxlength="300" placeholder="e.g. No show (SNO#8)">
    <label style="margin-top:10px">Ban expires <span class="muted small">(optional \u2014 blank means no expiry)</span></label>
    <input type="date" id="bpE" min="${today}">
    <p class="muted small" style="margin-top:10px">${removable
      ? 'They are signed up, so this will also <strong>remove them</strong> from the tournament.'
      : 'The bracket has started, so they stay in it \u2014 this only stops them entering again. Use Replace on the bracket if you need them out of a match.'}</p>
    <div class="actions"><button class="btn ghost" id="bpCancel">Cancel</button><button class="btn danger" id="bpGo">Ban${removable ? ' and remove' : ''}</button></div>`, root => {
    root.querySelector('#bpCancel').onclick = closeModal;
    root.querySelector('#bpGo').onclick = async () => {
      const reason = root.querySelector('#bpR').value;
      const expires = root.querySelector('#bpE').value || null;
      try {
        await api('/api/t/' + T.id + '/ban_set', { fafId: p.fafId, name: p.name, reason, expires, admin: adminToken() });
      } catch (e) { toast(e.message, true); return; }
      if (removable) {
        try { await api('/api/t/' + T.id + '/remove', { playerId: p.id, admin: adminToken() }); }
        catch (e) { toast('Banned, but removing them failed: ' + e.message, true); closeModal(); await refresh(); return; }
      }
      toast(removable ? 'Banned and removed' : 'Banned from this tournament');
      closeModal();
      await refresh();
    };
  }, { mid: true });
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

let _faSort = 'rating';   // free-agent list sort: rating | name | new

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

  // ---- check-in deadline (status only; the organizer sets it on the Admin tab) ----
  const canJoin = myPlayer && !myTeam;
  if (T.checkInDeadline) {
    const dl = new Date(T.checkInDeadline);
    const passed = Date.now() > T.checkInDeadline;
    html += `<div class="panel section"><h2>Check-in</h2>`;
    html += `<p class="${passed ? 'warn' : 'muted'} small">Deadline: <strong>${esc(fmtDateTime(dl.toISOString()))}</strong>${passed ? ' \u2014 passed' : ''}. Any member of a full team can check it in.</p>`;
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
  // WHO IS IN is first come first served: checked-in teams first (when check-in is in use), then
  // by when the team completed. Rating decides SEEDING, never who makes the cut - sorting the cut
  // by rating meant a newly-finished high-rated team bumped an existing one off the list.
  // This mirrors finalizeOpenTeams exactly, so the display can't disagree with what start does.
  const seeded = fullTeams.some(x => x.seed);
  const entryKey = tm => (tm.entryKey != null ? tm.entryKey : (tm.createdAt || 0));
  // Check-in deliberately does NOT reorder this list. Checking in is a confirmation that you are
  // there, not a way to jump the queue: a waiting team that checks in used to leapfrog every
  // participant who hadn't yet, which silently undid an organizer's swap. Check-in only decides
  // who is dropped when the tournament is launched.
  const orderedFull = fullTeams.slice().sort((a, b) => {
    if (seeded) return (a.seed || 9999) - (b.seed || 9999);
    return entryKey(a) - entryKey(b);
  });
  const participants = cap ? orderedFull.slice(0, cap) : orderedFull;
  const waitlist = cap ? orderedFull.slice(cap) : [];
  // Projected seed is the rating rank AMONG THOSE ACTUALLY ENTERING, so it matches the bracket.
  const seedFor = {};
  if (seeded) { orderedFull.forEach(tm => { seedFor[tm.id] = tm.seed; }); }
  else {
    participants.slice().sort((a, b) => teamRating(b) - teamRating(a))
      .forEach((tm, i) => { seedFor[tm.id] = i + 1; });
  }
  const forming = T.teams.filter(x => x.playerIds.length < size).slice().sort((a, b) => teamRating(b) - teamRating(a));

  const teamCard = (tm) => {
    const mems = tm.playerIds.map(pid => T.players.find(p => p.id === pid)).filter(Boolean);
    const full = tm.playerIds.length >= size;
    const openSlots = size - tm.playerIds.length;
    const seedBadge = (full && seedFor[tm.id]) ? `<span class="tc-seed" title="${seeded ? 'Seed' : 'Projected seed (by rating)'}">#${seedFor[tm.id]}</span> ` : '';
    return `<div class="teamcard ${full ? 'full' : 'open'}">
      <div class="tc-head"><span class="tc-name">${seedBadge}${esc(tm.name)}</span><span class="tc-counts">${T.maxTeamRating != null ? (() => { const sum = mems.reduce((a, m) => a + (m.rating || 0), 0); return '<span class="tc-count' + (sum > T.maxTeamRating ? ' over' : '') + '" title="Combined rating / maximum">' + sum + '/' + T.maxTeamRating + '</span>'; })() : (() => { const sum = mems.reduce((a, m) => a + (m.rating || 0), 0); return '<span class="tc-count" title="Combined rating">' + sum + '</span>'; })()}<span class="tc-count ${full ? 'ok' : ''}" title="Players / team size">${tm.playerIds.length}/${size}</span></span></div>
      <div class="tc-members">${mems.map(m => `<div>${esc(m.name)}${m.rating != null ? ' <span class="muted mono">' + m.rating + '</span>' : ''}${m.id === tm.captainId ? ' <span class="cap-tag">C</span>' : ''}${m.discord ? ' <span class="dctag" title="Discord">\uD83D\uDCAC ' + esc(m.discord) + '</span>' : ''}</div>`).join('')}</div>
      ${full ? `<div class="tc-checkin">${tm.checkedIn ? '<span class="idbadge verified">checked in</span>' : '<span class="idbadge late">not checked in</span>'}</div>` : ''}
      ${canJoin && !full ? ((tm.joinRequests || []).some(r => r.playerId === myPlayer.id)
        ? `<div class="tc-pending"><span class="muted small">Request pending</span> <button class="btn ghost small" data-cancel-join="${tm.id}">Cancel</button></div>`
        : `<button class="btn amber small tc-join" data-request-join="${tm.id}">Request to join (${openSlots} open)</button>`) : ''}
      ${(((myPlayer && tm.captainId === myPlayer.id) || admin) && (tm.joinRequests || []).length) ? `<div class="tc-requests">${tm.joinRequests.map(r => `<div class="tc-req"><span>${esc(r.name)} wants to join</span><span class="tc-req-btns"><button class="btn primary small" data-approve="${tm.id}:${r.playerId}">Accept</button> <button class="btn ghost small" data-decline="${tm.id}:${r.playerId}">Decline</button></span></div>`).join('')}</div>` : ''}
      ${((admin || (myPlayer && tm.captainId === myPlayer.id)) && tm.playerIds.length > 1)
        ? `<div class="tc-cap"><button class="btn ghost small" data-setcap="${tm.id}">Change captain</button></div>` : ''}
      ${admin ? `<div class="tc-admin">${full ? `<button class="btn ghost small" data-checkin="${tm.id}" data-val="${tm.checkedIn ? 0 : 1}">${tm.checkedIn ? 'Un-check' : 'Check in'}</button>` : ''}<button class="btn ghost small" data-arename="${tm.id}">Rename</button><button class="btn danger small" data-adisband="${tm.id}">Disband</button></div>` : ''}
    </div>`;
  };

  if (!T.teams.length) {
    html += '<div class="panel section"><h2>Teams</h2><div class="empty">No teams yet. Be the first to create one.</div></div>';
  } else {
    html += `<div class="panel section"><h2>Participants <span class="h2-strong">(${participants.length}${cap ? ' of ' + cap : ''}${T.minTeams ? ', min ' + T.minTeams : ''})</span></h2>${minMaxNote}`;
    html += participants.length ? `<p class="muted small" style="margin:-4px 0 10px">Places are <strong>first come, first served</strong> \u2014 by when a team filled up.${cap ? ' <strong>Sign up even if it looks full:</strong> anyone beyond the cap joins the waiting list, and teams that drop out or fail to check in are replaced from it, so waiting teams regularly get in.' : ''} The <span class="tc-seed" style="margin:0">#</span> is each team's ${seeded ? 'seed' : 'projected seed (by combined rating) — final seeds are set when the organizer locks teams'}.</p>` : '';
    html += participants.length ? '<div class="teamgrid">' + participants.map(teamCard).join('') + '</div>' : '<div class="empty">No full teams yet.</div>';
    html += '</div>';
    if (waitlist.length) {
      html += `<div class="panel section"><h2>Waiting list <span class="h2-strong">(${waitlist.length})</span></h2>
        <p class="muted small" style="margin-bottom:8px">Beyond the ${cap}-team cap, in the order they filled up. A waiting team can still check in \u2014 that keeps its place in the queue rather than moving it up. If a participant drops or misses check-in, the next waiting team takes the free slot when you start.${admin ? ' As organizer you can swap one in directly.' : ''}</p>
        <div class="teamgrid">${waitlist.map(tm => teamCard(tm) + (admin && participants.length
          ? `<div class="wl-swap"><button class="btn ghost small" data-swapin="${tm.id}">Swap in\u2026</button></div>`
          : '')).join('')}</div></div>`;
    }
    html += '<!--FREEAGENTS-->';
    if (forming.length) {
      html += `<div class="panel section"><h2>Forming <span class="h2-strong">(${forming.length})</span></h2>
        <p class="muted small" style="margin-bottom:8px">Not full yet — need ${size} players to enter.</p>
        <div class="teamgrid">${forming.map(teamCard).join('')}</div></div>`;
    }
  }

  // ---- free agents (players not on a team) ----
  // Kept prominent and explicitly sorted: these are the people captains are recruiting, so they
  // get a real card grid with a sort control rather than a wrapped list of chips.
  const unteamed = T.players.filter(p => !p.teamId);
  // the viewer can invite if they captain a team that still has room (or is an organizer)
  const myCapTeam = (myTeam && myPlayer && myTeam.captainId === myPlayer.id && myTeam.playerIds.length < size) ? myTeam : null;
  let freeAgentsHtml = '';
  if (unteamed.length) {
    const mode = _faSort || 'rating';
    const sorted = unteamed.slice().sort((a, b) => {
      if (mode === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
      if (mode === 'new') return (b.joinedAt || 0) - (a.joinedAt || 0);
      const ar = a.rating, br = b.rating;
      if (ar == null && br == null) return 0;
      if (ar == null) return 1; if (br == null) return -1; return br - ar;
    });
    const rated = unteamed.filter(p => p.rating != null);
    const avg = rated.length ? Math.round(rated.reduce((s2, p) => s2 + p.rating, 0) / rated.length) : null;
    const sortBtn = (v, lbl) => `<button class="btn ghost small fa-sort${mode === v ? ' on' : ''}" data-fasort="${v}">${lbl}</button>`;
    freeAgentsHtml = `<div class="panel section fa-panel"><div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <h2 style="margin:0">Free agents <span class="h2-strong">(${unteamed.length})</span></h2>
        <div class="row" style="gap:6px">${sortBtn('rating', 'Rating')}${sortBtn('name', 'Name')}${sortBtn('new', 'Newest')}</div>
      </div>
      <p class="muted small" style="margin:6px 0 10px">Looking for a team${avg != null ? ' \u00b7 average rating ' + avg : ''}.${myCapTeam ? ' You captain a team with room \u2014 invite someone below.' : ''}</p>
      <div class="fa-grid">${sorted.map(p => {
        const verified = p.fafId ? ' <span class="idbadge verified">\u2713</span>' : '';
        const invitedByMine = myCapTeam && (myCapTeam.invites || []).some(iv => iv.playerId === p.id);
        const inviteBtn = myCapTeam ? (invitedByMine
            ? '<button class="btn ghost small" data-cancel-invite="' + p.id + '">Cancel invite</button>'
            : '<button class="btn amber small" data-invite="' + p.id + '">Invite</button>')
          : '';
        const assignBtn = admin ? '<a href="#" class="assign-hint" data-assign="' + p.id + '">assign\u2192</a>' : '';
        return `<div class="fa-card">
          <div class="fa-top"><span class="fa-name">${esc(p.name)}${verified}</span><span class="fa-rating mono">${p.rating != null ? p.rating : '\u2014'}</span></div>
          ${(inviteBtn || assignBtn) ? '<div class="fa-actions">' + inviteBtn + assignBtn + '</div>' : ''}
        </div>`;
      }).join('')}</div>
      ${admin ? '<p class="muted small" style="margin-top:10px">\u201cAssign\u201d puts a player straight onto a team. \u201cInvite\u201d asks them to join your own team.</p><button class="btn ghost small" id="otOrgCreate">+ New team from a free agent</button>' : ''}</div>`;
  }

  // ---- organizer: form teams / divisions ----
  if (admin) {
    const fullCount = fullTeams.length;
    const ci = fullTeams.filter(x => x.checkedIn).length;
    html += `<div class="panel section"><h2>Start</h2>
      <p class="muted small">${fullCount} full team${fullCount === 1 ? '' : 's'}${useCheckin ? ', ' + ci + ' checked in' : ''}. ${cap ? 'Up to ' + cap + ' enter as participants (signup order)' + (useCheckin ? ', minus anyone who has not checked in by the time you start' : '') + '; the rest' : 'Incomplete teams and extras'} become reserves you can sub in later.</p>
      <button class="btn amber" id="otFormTeams">Close signups &amp; lock teams</button></div>`;
  }

  html = html.replace('<!--FREEAGENTS-->', freeAgentsHtml || '');
  el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';

  // ---- wire everything ----
  el.querySelectorAll('[data-fasort]').forEach(b => b.onclick = () => { _faSort = b.dataset.fasort; drawTournament(); });
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
  // Organizer: swap a waiting team in for one that is currently entering.
  // Hand the captaincy to another member. Real transfer: captain rights everywhere (invites,
  // approvals, veto actions, score reporting, the captains chat room) read team.captainId.
  el.querySelectorAll('[data-setcap]').forEach(b => b.onclick = () => {
    const tm = T.teams.find(x => x.id === b.dataset.setcap);
    if (!tm) return;
    const mems = (tm.playerIds || []).map(pid => T.players.find(p => p.id === pid)).filter(Boolean);
    const others = mems.filter(p => p.id !== tm.captainId);
    if (!others.length) return toast('No one else on this team', true);
    const curName = (mems.find(p => p.id === tm.captainId) || {}).name || '\u2014';
    modal(`<h3>Change captain of ${esc(tm.name)}</h3>
      <p class="muted small">Current captain: <strong>${esc(curName)}</strong>. The new captain takes over invites, approvals, map and faction vetoes, score reporting and the captains chat straight away.</p>
      <label>New captain</label>
      <select id="scWho">${others.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
      <div class="actions"><button class="btn ghost" id="scCancel">Cancel</button><button class="btn primary" id="scGo">Make captain</button></div>`, root => {
      root.querySelector('#scCancel').onclick = closeModal;
      root.querySelector('#scGo').onclick = async () => {
        try {
          await api('/api/t/' + T.id + '/set_captain', { teamId: tm.id, playerId: root.querySelector('#scWho').value, admin: adminToken() });
          closeModal(); toast('Captain changed'); await refresh();
        } catch (e) { toast(e.message, true); }
      };
    });
  });

  el.querySelectorAll('[data-swapin]').forEach(b => b.onclick = () => {
    const inTeam = T.teams.find(x => x.id === b.dataset.swapin);
    if (!inTeam) return;
    const opts = participants.map(tm => `<option value="${esc(tm.id)}">${esc(tm.name)}</option>`).join('');
    modal(`<h3>Swap in ${esc(inTeam.name)}</h3>
      <p class="muted small">Pick the team it replaces. That team moves to the waiting list; everyone else keeps their place. Swapping the two back undoes it.</p>
      <label>Team to move out</label>
      <select id="swOut">${opts}</select>
      <div class="actions"><button class="btn ghost" id="swCancel">Cancel</button><button class="btn primary" id="swGo">Swap</button></div>`, root => {
      root.querySelector('#swCancel').onclick = closeModal;
      root.querySelector('#swGo').onclick = async () => {
        try {
          await api('/api/t/' + T.id + '/swap_team', { inId: inTeam.id, outId: root.querySelector('#swOut').value, admin: adminToken() });
          closeModal(); toast('Swapped'); await refresh();
        } catch (e) { toast(e.message, true); }
      };
    });
  });

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

// ----- seeding (shared) -----
// One seeding list, rendered on more than one surface: the Players tab for a solo field (which
// IS the entrant list, and where organizers look for it), and the Admin tab for everything.
// It used to be knockout-only, which meant a Swiss qualifier had no way to set seeds at all.
// Seeds are read at different moments by the two shapes - the note under the heading says which.
function seedPanelOpen() {
  return T.status === 'drafted' && viewerIsOrganizer()
    && T.competition === 'team' && (T.teams || []).length > 1;
}

// Accepted invites are the only ones that can carry a seed: a pending or declined invite has
// nobody in the field to place. Organizer-only data, so this is never reachable from a player.
function seedInviteCount() {
  return (T.invites || []).filter(i => i.status === 'accepted').length;
}

function seedPanelHTML() {
  if (!seedPanelOpen()) return '';
  const swiss = T.bracketType === 'swiss';
  const solo = T.teamSize === 1;
  const noun = solo ? 'Players' : 'Teams';
  const bySeed = (a, b) => (a.seed || 0) - (b.seed || 0);
  const seeded = T.teams.slice().sort(bySeed);
  const invited = seedInviteCount();
  // With divisions every division is seeded on its own: one list each, top division first.
  const byDiv = divisionsOnT() && T.teams.some(x => x.division);
  // What a seed actually DOES differs by format, and getting this wrong is how an organizer
  // spends an evening reordering a list that the pairer stops consulting after round 1.
  const what = swiss
    ? 'Seed 1 is the top seed. Seeds set the <strong>opening round\u2019s draw</strong> and break ties in the standings \u2014 from round 2 on, pairing follows records. Once the rounds start you can still rearrange round 1 by hand.'
    : (byDiv ? 'Each division is seeded on its own: the top of each list is that division\u2019s seed 1. It decides that division\u2019s bracket, and is fixed once you start it.'
      : 'Seed 1 is the top seed. This determines the bracket \u2014 fixed once you start it.');
  const item = tm => `<li class="seeditem" draggable="true" data-tid="${tm.id}">
        <span class="seednum"></span>
        <span class="seedname">${esc(tm.name)}</span>
        <span class="seedbtns"><button class="seedup" title="Move up">\u25b2</button><button class="seeddown" title="Move down">\u25bc</button></span>
      </li>`;
  let lists = '';
  if (byDiv) {
    for (let d = 1; d <= T.divisions; d++) {
      const teams = divisionTeamsOf(d).slice().sort(bySeed);
      if (teams.length) lists += '<h3 class="div-draft-h">' + esc(divisionNameOf(d)) + '</h3><ol class="seedlist" data-seedlist="' + d + '">' + teams.map(item).join('') + '</ol>';
    }
    const loose = seeded.filter(x => !((x.division || 0) >= 1 && (x.division || 0) <= T.divisions));
    if (loose.length) lists += '<h3 class="div-draft-h">Not in a division</h3><ol class="seedlist" data-seedlist="0">' + loose.map(item).join('') + '</ol>';
  } else {
    lists = '<ol id="seedList" class="seedlist" data-seedlist="all">' + seeded.map(item).join('') + '</ol>';
  }
  return `<div class="panel section"><h2>Seeding</h2>
    <p class="muted small">Drag to reorder, or use the arrows. ${what}</p>
    <div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn ghost small" id="seedRandom">\ud83c\udfb2 Randomize</button>
      <button class="btn ghost small" id="seedByRating" title="Highest rating first. Unrated go last.">Order by rating</button>
      ${invited ? `<button class="btn ghost small" id="seedByInvite" title="Seed in the order the invites went out (${invited} accepted). ${noun} nobody invited keep their order and follow the invited ones.">Order by invite</button>` : ''}
    </div>
    ${lists}
    <div style="margin-top:12px"><button class="btn amber" id="seedSave">Save seeding</button> <span class="muted small" id="seedDirty"></span></div>
  </div>`;
}

function wireSeedPanel() {
  const lists = Array.from(document.querySelectorAll('ol.seedlist[data-seedlist]'));
  if (!lists.length) return;
  const renumber = (dirty) => {
    for (const list of lists) {
      let i = 1;
      list.querySelectorAll('.seeditem').forEach(li => { li.querySelector('.seednum').textContent = i++; });
    }
    const sd = document.getElementById('seedDirty'); if (sd) sd.textContent = dirty ? 'unsaved changes' : '';
  };
  renumber(false);
  for (const list of lists) wireSeedList(list, () => renumber(true));
  wireSeedButtons(lists);
}

// Arrows and drag-and-drop inside one list. A team never leaves its list: with divisions the list
// is its division, and moving between divisions is the Divisions panel's job.
function wireSeedList(seedList, changed) {
  seedList.querySelectorAll('.seedup').forEach(b => b.onclick = e => {
    const li = e.target.closest('.seeditem'); const prev = li.previousElementSibling;
    if (prev) { seedList.insertBefore(li, prev); changed(); }
  });
  seedList.querySelectorAll('.seeddown').forEach(b => b.onclick = e => {
    const li = e.target.closest('.seeditem'); const next = li.nextElementSibling;
    if (next) { seedList.insertBefore(next, li); changed(); }
  });
  let dragEl = null;
  seedList.querySelectorAll('.seeditem').forEach(li => {
    li.addEventListener('dragstart', () => { dragEl = li; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('dragging'); dragEl = null; changed(); });
  });
  seedList.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragEl || dragEl.parentNode !== seedList) return;
    const after = [...seedList.querySelectorAll('.seeditem:not(.dragging)')].reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = e.clientY - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, el: child };
      return closest;
    }, { offset: -Infinity, el: null }).el;
    if (after == null) seedList.appendChild(dragEl);
    else seedList.insertBefore(dragEl, after);
  });
}

// Save, randomize, by rating, by invite. The saved order is the lists one after another, so with
// divisions every division keeps its own order and the seeds stay unique across the field.
function wireSeedButtons(lists) {
  // `mode` picks which of the three the server should do; only one is ever sent.
  const saveOrder = async (order, mode) => {
    const body = { admin: adminToken() };
    if (mode === 'random') body.randomize = 1;
    else if (mode === 'invite') body.inviteOrder = 1;
    else body.order = order;
    try {
      await api('/api/t/' + T.id + '/reseed', body);
      await refresh();
      toast('Seeding saved');
    } catch (e) { toast(e.message, true); }
  };
  const idsOf = list => [...list.querySelectorAll('.seeditem')].map(li => li.dataset.tid);
  const save = document.getElementById('seedSave');
  if (save) save.onclick = () => saveOrder([].concat(...lists.map(idsOf)), null);
  const rnd = document.getElementById('seedRandom');
  if (rnd) rnd.onclick = () => saveOrder(null, 'random');
  const inv = document.getElementById('seedByInvite');
  if (inv) inv.onclick = () => saveOrder(null, 'invite');
  const byr = document.getElementById('seedByRating');
  if (byr) byr.onclick = () => {
    // Rating order is recomputed here rather than stored, so it always reflects the ratings
    // showing right now (an organizer edit to a rating lands immediately). Within each list.
    const r = id => { const tm = T.teams.find(x => x.id === id); return tm ? tm.playerIds.reduce((s, pid) => { const p = T.players.find(x => x.id === pid); return s + (p && p.rating || 0); }, 0) : 0; };
    saveOrder([].concat(...lists.map(list => idsOf(list).sort((a, b) => r(b) - r(a)))), null);
  };
}

// ---- the division draft (King / Prince ...) ----
function divisionDraftIntro() {
  const n = T.divisions || 0;
  const nm = d => divisionNameOf(d);
  return 'This tournament has ' + n + ' divisions, each with its own bracket. The ' + nm(1) + ' captains draft first, and everyone they pick plays in the '
    + nm(1) + ' bracket. When their draft is over, the players nobody picked are drafted into the ' + nm(2) + ' bracket by the ' + nm(2) + ' captains'
    + (n > 2 ? ', and so on down' : '') + '. Set how each division\u2019s captains are chosen below.';
}
// How each later division's captains are chosen. The top division's are set with the controls above.
function laterDivisionsHTML() {
  let h = '';
  for (let d = 2; d <= (T.divisions || 0); d++) {
    const c = (T.divCaptains || []).find(x => x.division === d) || { mode: 'rating', count: 0 };
    h += `<div class="div-draft">
      <h3 class="div-draft-h">${esc(divisionNameOf(d))} captains</h3>
      <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:2;min-width:220px"><div class="muted small">Chosen when the ${esc(divisionNameOf(d - 1))} draft ends</div>
          <select data-divmode="${d}">
            <option value="rating"${c.mode !== 'manual' ? ' selected' : ''}>The highest rated of the players left (automatic)</option>
            <option value="manual"${c.mode === 'manual' ? ' selected' : ''}>I pick them myself at that point</option>
          </select></div>
        <div style="width:160px${c.mode === 'manual' ? ';display:none' : ''}" data-divnumwrap="${d}"><div class="muted small">How many captains</div>
          <input type="number" min="2" max="64" data-divnum="${d}" value="${c.count || ''}" placeholder="e.g. 4"></div>
      </div>
      <div class="muted small" data-divhint="${d}" style="margin-top:6px"></div>
    </div>`;
  }
  return h;
}
// Wire those settings (saved as they change) and keep a line under each saying how many players
// will be left for it. Returns the repaint function, so the top division's controls can call it.
function wireLaterDivisions(root) {
  const modes = Array.from(root.querySelectorAll('[data-divmode]'));
  if (!modes.length) return () => {};
  const per = T.teamSize || 1;
  const pool = T.players.filter(p => !p.pending).length;
  const topCount = () => {
    const sel = document.getElementById('capMode');
    if (sel && sel.value === 'rating') return parseInt((document.getElementById('capNum') || {}).value, 10) || 0;
    return Object.keys(F.capSel || {}).length;
  };
  const paint = () => {
    let left = pool - topCount() * per;
    for (let d = 2; d <= (T.divisions || 0); d++) {
      const modeEl = root.querySelector('[data-divmode="' + d + '"]');
      const numEl = root.querySelector('[data-divnum="' + d + '"]');
      const hint = root.querySelector('[data-divhint="' + d + '"]');
      const wrap = root.querySelector('[data-divnumwrap="' + d + '"]');
      if (!modeEl) continue;
      const manual = modeEl.value === 'manual';
      if (wrap) wrap.style.display = manual ? 'none' : '';
      const k = manual ? 0 : (parseInt(numEl && numEl.value, 10) || 0);
      const leftHere = Math.max(0, left);
      if (hint) {
        if (manual) hint.textContent = leftHere + ' would be left for it. You choose its captains from them when the ' + divisionNameOf(d - 1) + ' draft ends.';
        else if (k < 2) hint.textContent = leftHere + ' would be left for it. Enter how many captains it gets, or it waits for you to choose them.';
        else hint.innerHTML = esc(leftHere + ' would be left for it (' + k + ' teams of ' + per + ' need ' + (k * per) + ').')
          + (leftHere < k ? ' <span class="warn">Not enough for ' + k + ' captains - it will wait for you instead.</span>' : '');
      }
      left -= (manual ? 0 : k * per);
    }
  };
  let timer = {};
  const save = d => {
    clearTimeout(timer[d]);
    timer[d] = setTimeout(() => {
      const modeEl = root.querySelector('[data-divmode="' + d + '"]');
      const numEl = root.querySelector('[data-divnum="' + d + '"]');
      const body = { action: 'set_captain_mode', division: d, mode: modeEl.value, admin: adminToken() };
      const n = parseInt(numEl && numEl.value, 10);
      if (isFinite(n) && n >= 2) body.count = n;
      api('/api/t/' + T.id + '/phase', body).catch(e => toast(e.message, true));
    }, 400);
  };
  for (const m of modes) m.onchange = () => { paint(); save(parseInt(m.dataset.divmode, 10)); };
  root.querySelectorAll('[data-divnum]').forEach(n => { n.oninput = () => { paint(); save(parseInt(n.dataset.divnum, 10)); }; });
  paint();
  return paint;
}
// The division above has finished; this one waits for the organizer to choose its captains. The
// controls reuse the top division's ids, so the same wiring drives both.
function waitingDivisionHTML(admin) {
  const d = T.draft.division;
  const nm = divisionNameOf(d), prev = divisionNameOf(d - 1);
  const left = T.players.filter(p => !p.teamId && !p.pending).sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const lastDone = (T.draftDone || []).slice(-1)[0];
  let h = `<div class="draft-turn">The <strong>${esc(prev)}</strong> draft is complete. The <strong>${esc(nm)}</strong> draft starts once its captains are chosen.</div>`;
  if (admin) {
    const c = (T.divCaptains || []).find(x => x.division === d) || { mode: 'rating', count: 0 };
    h += `<div class="panel section"><h2>${esc(nm)} <span class="h2-strong">captains</span></h2>
      <p class="muted small">${left.length} player${left.length === 1 ? ' is' : 's are'} left for the ${esc(nm)} division. The number of captains is the number of ${esc(nm)} teams; each fills a team of ${T.teamSize}.</p>
      <label>How are captains chosen?</label>
      <select id="capMode">
        <option value="manual"${c.mode === 'manual' ? ' selected' : ''}>I pick them myself</option>
        <option value="rating"${c.mode !== 'manual' ? ' selected' : ''}>Top N by rating of the players left (automatic)</option>
      </select>
      <div id="capRatingWrap" style="${c.mode !== 'manual' ? '' : 'display:none'}">
        <label style="margin-top:12px">How many captains</label>
        <input type="number" id="capNum" min="2" max="64" step="1" value="${c.count || ''}" placeholder="e.g. 4" style="max-width:160px">
        <div id="capPreview" class="cap-count"></div>
      </div>
      <div id="capManualWrap" style="${c.mode === 'manual' ? '' : 'display:none'}">
        <p class="muted small" style="margin-top:12px">Mark who the captains are in the list below.</p>
        <div class="pool" id="capPool"></div>
        <div id="capCount" class="cap-count"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn amber" id="startDraft">Start the ${esc(nm)} draft</button>
        ${lastDone && lastDone.picks ? '<button class="btn ghost" id="undoPickBtn">\u21b6 Undo the last ' + esc(prev) + ' pick</button>' : ''}
      </div></div>`;
  } else {
    h += `<div class="panel section"><h2>Players left <span class="h2-strong">(${left.length})</span></h2>
      <p class="muted small">They are drafted into the ${esc(nm)} bracket once the organizer has chosen its captains.</p>
      <div class="unteamed">${left.map(p => `<span class="unteamed-chip">${esc(p.name)}${p.rating != null ? ' <span class="muted mono">' + p.rating + '</span>' : ''}</span>`).join('') || '<span class="muted">Nobody.</span>'}</div></div>`;
  }
  return h;
}
// The seed a team shows. With divisions, before the start every seed is unique across the field;
// the start numbers each division from 1, so the page shows the place within the division already.
function shownSeed(team) {
  if (!divisionsOnT() || !team.division || T.status === 'running' || T.status === 'finished') return team.seed;
  const list = divisionTeamsOf(team.division).slice().sort((a, b) => (a.seed || 0) - (b.seed || 0));
  const i = list.findIndex(x => x.id === team.id);
  return i >= 0 ? i + 1 : team.seed;
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
        const capMode = T.captainMode === 'rating' ? 'rating' : 'manual';
        const capN = T.captainCount || 0;
        // Rating mode resolves at draft start, so show a live preview of who it would pick now.
        const capRanked = T.players.filter(p => !p.pending).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
        const capWould = capN >= 2 ? capRanked.slice(0, capN) : [];
        const divs = divisionsOnT() ? T.divisions : 0;
        html += `<div class="panel section"><h2>Captains &amp; draft</h2>
          ${divs ? '<p class="muted small">' + esc(divisionDraftIntro()) + '</p>' : ''}
          <p class="muted small">The number of captains is the number of teams. Pick order: ${T.draftOrder === 'snake' ? 'snake (1\u2192N, N\u21921, ...)' : 'bottom seed to top seed, every round'}. Each captain fills a team of ${T.teamSize}.</p>
          ${divs ? '<h3 class="div-draft-h">' + esc(divisionNameOf(1)) + ' captains</h3>' : ''}
          <label>How are captains chosen?</label>
          <select id="capMode">
            <option value="manual"${capMode === 'manual' ? ' selected' : ''}>I pick them myself</option>
            <option value="rating"${capMode === 'rating' ? ' selected' : ''}>Top N by rating (automatic)</option>
          </select>
          <div id="capRatingWrap" style="${capMode === 'rating' ? '' : 'display:none'}">
            <label style="margin-top:12px">How many captains</label>
            <input type="number" id="capNum" min="2" max="64" step="1" value="${capN || ''}" placeholder="e.g. 8" style="max-width:160px">
            <p class="muted small" style="margin-top:6px">Editable until you start the draft. The highest-rated players become captains, worked out at the moment the draft starts, so late signups and rating corrections are included.</p>
            <div id="capPreview" class="cap-count"></div>
          </div>
          <div id="capManualWrap" style="${capMode === 'manual' ? '' : 'display:none'}">
            <p class="muted small" style="margin-top:12px">Mark who the captains are in the list below.</p>
            <div class="pool" id="capPool"></div>
            <div id="capCount" class="cap-count"></div>
          </div>
          ${divs ? laterDivisionsHTML() : ''}
          <div style="margin-top:16px"><button class="btn amber" id="startDraft">${divs ? 'Close signups &amp; start the ' + esc(divisionNameOf(1)) + ' draft' : 'Close signups &amp; start draft'}</button></div></div>`;
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

  if (T.status === 'draft' && T.draft && T.draft.waiting) {
    // the division above has finished drafting; this one waits for its captains
    html += waitingDivisionHTML(admin);
  } else if (T.status === 'draft' && T.draft) {
    const d = T.draft;
    const turnTeamId = d.order[d.current];
    // the team that made the most recent pick (authoritative: previous slot in the pick order)
    const lastTeamId = d.current > 0 ? d.order[d.current - 1] : null;
    let canUndo = false, undoName = '', undoLabel = '';
    if (lastTeamId) {
      undoName = teamName(lastTeamId);
      if (admin) canUndo = true;                                             // organizer: anytime
      else if (T.viewer && T.viewer.teamId === lastTeamId) canUndo = true;   // captain: only if they were last to pick
      undoLabel = 'Undo ' + undoName + '\u2019s last pick';
    } else if (admin && d.division && (T.draftDone || []).some(x => x.picks > 0)) {
      // nobody has picked in this division yet: the last pick made was the division above's
      canUndo = true;
      undoLabel = 'Undo the last ' + divisionNameOf(d.division - 1) + ' pick';
    }
    const divLbl = (d.division && divisionsOnT()) ? '<strong>' + esc(divisionNameOf(d.division)) + ' draft</strong> \u00b7 ' : '';
    html += `<div class="draft-turn">${divLbl}Pick ${d.current + 1} of ${d.order.length} - <strong>${esc(teamName(turnTeamId))}</strong> is picking.
      ${capToken() && !admin ? '<span class="muted small"> If it\u2019s your team\u2019s turn, the pick buttons below work for you.</span>' : ''}
      ${canUndo ? '<button class="btn ghost small" id="undoPickBtn" style="margin-left:10px">\u21b6 ' + esc(undoLabel) + '</button>' : ''}
    </div>`;
    const orderChips = d.order.map((tid, i) => {
      const cls = i < d.current ? 'po-done' : i === d.current ? 'po-now' : '';
      return `<span class="po-chip ${cls}"><span class="po-num">${i + 1}</span>${esc(teamName(tid))}</span>`;
    }).join('');
    html += `<div class="panel section"><h2>Pick order</h2><div class="pickorder">${orderChips}</div></div>`;
    html += `<div class="panel section"><h2>Player pool</h2><div class="pool" id="draftPool"></div></div>`;
  }

  if (T.teams.length) {
    if (divisionsOnT() && T.teams.some(x => x.division)) {
      // one grid per division, top division first
      for (let dv = 1; dv <= T.divisions; dv++) {
        const k = divisionTeamsOf(dv).length;
        if (k) html += `<div class="panel section"><h2>${esc(divisionNameOf(dv))} <span class="h2-strong">(${k})</span></h2><div class="teamgrid" data-tgrid="${dv}"></div></div>`;
      }
      const loose = T.teams.filter(x => !((x.division || 0) >= 1 && (x.division || 0) <= T.divisions)).length;
      if (loose) html += `<div class="panel section"><h2>Not in a division <span class="h2-strong">(${loose})</span></h2><div class="teamgrid" data-tgrid="0"></div></div>`;
    } else {
      html += `<div class="panel section"><h2>${T.teamSize === 1 ? 'Entrants' : 'Teams'}</h2><div class="teamgrid" id="tGrid" data-tgrid="all"></div></div>`;
    }
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

  // Divisions (King/Prince) - team single/double elim only, before the bracket starts
  if (T.status === 'drafted' && admin && T.competition === 'team' && (T.bracketType === 'single' || T.bracketType === 'double')) {
    const divs = divisionsOnT() ? T.divisions : 0;
    const fromDraft = T.formation === 'draft' && T.draft && (T.draft.division || (T.draftDone || []).length);
    html += `<div class="panel section"><h2>Divisions</h2>
      <p class="muted small">${fromDraft
        ? 'The draft decided the divisions: every team plays in the division its captain drafted for. You can still move a team below.'
        : 'Optionally split the teams into divisions (e.g. King and Prince). Each plays its own bracket, on its own tab, with its own champion. Split by combined team rating, then adjust below.'}</p>
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <span class="muted small">Split into</span>
        <select id="divCount" style="width:auto">${[1, 2, 3, 4].map(n => '<option value="' + n + '"' + ((divs || 1) === n ? ' selected' : '') + '>' + (n === 1 ? 'One bracket (no split)' : n + ' divisions') + '</option>').join('')}</select>
        <span id="divTopWrap" class="muted small" style="display:${(divs || 1) === 2 ? 'inline-flex' : 'none'};align-items:center;gap:6px">with the
          <input type="number" id="divTop" min="1" max="${Math.max(1, T.teams.length - 1)}" value="${T.divisionTop || ''}" placeholder="half" style="width:70px;margin:0">
          best in ${esc(divisionNameOf(1))}</span>
        <button class="btn ghost small" id="divApply">Apply split</button>
      </div>`;
    if (divs) {
      const loose = T.teams.filter(x => !((x.division || 0) >= 1 && (x.division || 0) <= divs));
      const col = (dv, list, title) => {
        let h = `<div class="divcol"><h3>${esc(title)} <span class="muted mono">(${list.length})</span></h3>`;
        for (const tm of list.slice().sort((a, b) => teamRating(b) - teamRating(a))) {
          const opts = (dv ? [] : ['<option value="0" selected>-</option>']);
          for (let dd = 1; dd <= divs; dd++) opts.push('<option value="' + dd + '"' + (dd === dv ? ' selected' : '') + '>' + esc(divisionNameOf(dd)) + '</option>');
          h += `<div class="divteam"><span>${esc(tm.name)} <span class="muted mono">${teamRating(tm)}</span></span>
            <select data-divteam="${tm.id}" style="width:auto">${opts.join('')}</select></div>`;
        }
        return h + '</div>';
      };
      html += '<div class="divgrid" style="margin-top:14px">';
      for (let dv = 1; dv <= divs; dv++) html += col(dv, divisionTeamsOf(dv), divisionNameOf(dv));
      if (loose.length) html += col(0, loose, 'Not in a division');
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

  // A later division waiting for its captains reuses the same controls; its captains come from
  // the players nobody has drafted, and its setting is stored for that division.
  const waitingDiv = (T.status === 'draft' && T.draft && T.draft.waiting) ? T.draft.division : 0;
  const capCandidates = waitingDiv ? T.players.filter(p => !p.teamId && !p.pending) : T.players;
  // the settings for division 2 and below, on the signup panel
  const paintDivHints = wireLaterDivisions(el);
  // captain-selection mode (manual vs top-N-by-rating)
  const capModeSel = document.getElementById('capMode');
  if (capModeSel) {
    const ratingWrap = document.getElementById('capRatingWrap');
    const manualWrap = document.getElementById('capManualWrap');
    const numEl = document.getElementById('capNum');
    const prevEl = document.getElementById('capPreview');
    const ranked = capCandidates.filter(p => !p.pending).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const paintPreview = () => {
      if (!prevEl) return;
      const n = parseInt(numEl.value, 10);
      if (!isFinite(n) || n < 2) { prevEl.innerHTML = '<span class="muted">Enter a number (2 or more) to preview.</span>'; return; }
      if (ranked.length < n) {
        prevEl.innerHTML = '<span class="warn">Only ' + ranked.length + (waitingDiv ? ' left for this division' : ' signed up so far') + '; ' + (n - ranked.length) + ' more needed before the draft can start.</span>';
        return;
      }
      const need = n * T.teamSize;
      const short = ranked.length < need ? ' <span class="warn">' + ranked.length + (waitingDiv ? ' left' : ' signed up') + '; ' + (need - ranked.length) + ' more needed to fill all ' + n + ' teams.</span>' : '';
      prevEl.innerHTML = 'Captains right now would be: ' + ranked.slice(0, n).map(p => '<strong>' + esc(p.name) + '</strong> (' + (p.rating != null ? p.rating : '\u2014') + ')').join(', ') + '.' + short;
    };
    let capCfgTimer = null;
    const persistCfg = () => {
      clearTimeout(capCfgTimer);
      capCfgTimer = setTimeout(() => {
        const body = { action: 'set_captain_mode', mode: capModeSel.value, admin: adminToken() };
        if (waitingDiv) body.division = waitingDiv;
        const n = parseInt(numEl.value, 10);
        if (isFinite(n) && n >= 2) body.count = n;
        api('/api/t/' + T.id + '/phase', body).catch(() => {});
      }, 400);
    };
    capModeSel.onchange = () => {
      const rating = capModeSel.value === 'rating';
      if (ratingWrap) ratingWrap.style.display = rating ? '' : 'none';
      if (manualWrap) manualWrap.style.display = rating ? 'none' : '';
      paintPreview(); persistCfg();
      if (typeof paintDivHints === 'function') paintDivHints();
    };
    if (numEl) numEl.oninput = () => { paintPreview(); persistCfg(); if (typeof paintDivHints === 'function') paintDivHints(); };
    paintPreview();
  }

  const capPool = document.getElementById('capPool');
  if (capPool) {
    // seed selection from the server's pendingCaptains (persisted across reloads)
    if (Object.keys(F.capSel).length === 0 && (T.pendingCaptains || []).length) {
      for (const id of T.pendingCaptains) F.capSel[id] = 1;
    }
    // a waiting division picks its captains from the players left; drop any stale marks
    if (waitingDiv) for (const id of Object.keys(F.capSel)) { if (!capCandidates.some(p => p.id === id)) delete F.capSel[id]; }
    const nPlayers = capCandidates.length;
    const updateCount = () => {
      const n = Object.keys(F.capSel).length;
      const el = document.getElementById('capCount');
      if (!el) return;
      if (typeof paintDivHints === 'function') paintDivHints();
      if (n < 2) { el.innerHTML = '<span class="muted">Mark at least 2 captains.</span>'; return; }
      const perTeam = T.teamSize;
      const needed = n * perTeam;
      const preview = 'Bracket preview: <strong>' + n + '</strong> team' + (n === 1 ? '' : 's') + ' (' + n + ' captain' + (n === 1 ? '' : 's') + ', ' + perTeam + ' per team = ' + needed + ' players needed).';
      const have = nPlayers >= needed ? '' : ' <span class="warn">You have ' + nPlayers + (waitingDiv ? ' left' : ' signed up') + '; ' + (needed - nPlayers) + ' more needed to fill all teams.</span>';
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
    const sorted = capCandidates.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0));
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
  }

  const startDraftBtn = document.getElementById('startDraft');
  if (startDraftBtn) startDraftBtn.onclick = async () => {
    const modeEl = document.getElementById('capMode');
    const rating = modeEl && modeEl.value === 'rating';
    const body = { action: 'start_draft', admin: adminToken() };
    const forDiv = waitingDiv ? { division: waitingDiv } : {};
    if (rating) {
      const n = parseInt((document.getElementById('capNum') || {}).value, 10);
      if (!isFinite(n) || n < 2) return toast('Enter how many captains (2 or more)', true);
      // Make sure the number the organizer is looking at is the one the server uses, even if
      // the debounced save hasn't fired yet.
      try { await api('/api/t/' + T.id + '/phase', Object.assign({ action: 'set_captain_mode', mode: 'rating', count: n, admin: adminToken() }, forDiv)); }
      catch (e) { return toast(e.message, true); }
    } else {
      const ids = Object.keys(F.capSel);
      if (ids.length < 2) return toast('Mark at least 2 captains', true);
      body.captainIds = ids;
      // a waiting division starts from the captains marked here, whatever its stored setting was
      if (waitingDiv) {
        try { await api('/api/t/' + T.id + '/phase', { action: 'set_captain_mode', mode: 'manual', division: waitingDiv, admin: adminToken() }); }
        catch (e) { return toast(e.message, true); }
      }
    }
    try {
      await api('/api/t/' + T.id + '/phase', body);
      F.capSel = {};
      await refresh();
    } catch (e) { toast(e.message, true); }
  };

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

  for (const tg of el.querySelectorAll('[data-tgrid]')) {
    const ratingOf = pid => { const p = T.players.find(x => x.id === pid); return p && p.rating != null ? p.rating : null; };
    // does ANY team have a rating? if not, hide the per-player rating column and TOTAL row
    const anyRatings = T.players.some(p => p.rating != null);
    const which = tg.dataset.tgrid;
    const inGrid = which === 'all' ? T.teams
      : (which === '0' ? T.teams.filter(x => !((x.division || 0) >= 1 && (x.division || 0) <= T.divisions)) : divisionTeamsOf(parseInt(which, 10)));
    for (const team of inGrid.slice().sort((a, b) => a.seed - b.seed)) {
      const card = document.createElement('div');
      card.className = 'teamcard' + ((team.eliminated && !streamerMode) ? ' elim' : '');

      // imported tournaments have no individual players/ratings — just show the team name
      if (T.imported) {
        card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${shownSeed(team)}</span></h3>` +
          (team.finalRank ? `<div class="teamtotal"><span>PLACED</span><span class="mono">#${team.finalRank}</span></div>` : '');
        tg.appendChild(card);
        continue;
      }

      const openSlots = (T.status === 'draft' || T.status === 'signup') ? Math.max(0, T.teamSize - team.playerIds.length) : 0;
      const total = team.playerIds.reduce((sum, pid) => sum + (ratingOf(pid) || 0), 0);
      const canRename = admin || !!(T.viewer && T.viewer.teamId === team.id && T.teamSize > 1 && !team.captainRenamed);
      card.innerHTML = `<h3><span>${esc(team.name)}</span><span class="seedtag">SEED ${shownSeed(team)}</span>${canRename ? '<button class="btn ghost small" data-rename="' + team.id + '" style="margin-left:6px">Rename</button>' : ''}</h3>
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

  const divCount = document.getElementById('divCount');
  if (divCount) divCount.onchange = () => {
    const w = document.getElementById('divTopWrap');
    if (w) w.style.display = divCount.value === '2' ? 'inline-flex' : 'none';
  };
  const divApply = document.getElementById('divApply');
  if (divApply) divApply.onclick = async () => {
    const n = parseInt(document.getElementById('divCount').value, 10) || 1;
    const body = { divisions: n, admin: adminToken() };
    const topEl = document.getElementById('divTop');
    if (n === 2 && topEl && topEl.value) body.top = parseInt(topEl.value, 10) || 0;
    try { await api('/api/t/' + T.id + '/split_divisions', body); await refresh(); toast(n > 1 ? 'Split into ' + n + ' divisions' : 'One bracket'); }
    catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll('[data-divteam]').forEach(sel => sel.onchange = async () => {
    const dv = parseInt(sel.value, 10);
    if (!dv) return;   // "-" is where a team without a division starts; it is not a choice
    try { await api('/api/t/' + T.id + '/set_division', { teamId: sel.dataset.divteam, division: dv, admin: adminToken() }); await refresh(); }
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

  // With divisions the lengths are set for the largest division; the others play the tail.
  const divs = divisionsOnT() ? T.divisions : 0;
  const sizes = [];
  for (let d = 1; d <= divs; d++) sizes.push(divisionTeamsOf(d).length);
  const R = log2i(nextPow2(divs ? Math.max.apply(null, sizes.concat([2])) : n));
  const divNote = divs ? '<p class="muted small">' + esc(sizes.map((k, i) => divisionNameOf(i + 1) + ' ' + k).join(', ') + ' teams.')
    + ' The lengths below are for the biggest division; a smaller one plays them counted back from the final: its final is the final below, its semi-finals the semi-finals below, and so on.</p>' : '';

  if (T.bracketType === 'single') {
    const rows = [];
    for (let r = 1; r <= R; r++) {
      const lbl = r === R ? 'Final' : r === R - 1 ? 'Semifinals' : r === R - 2 ? 'Quarterfinals' : 'Round ' + r;
      const p = T.plan || {};
      const dflt = (T.perRoundBo && Array.isArray(p.roundsList) && p.roundsList[r - 1] != null)
        ? p.roundsList[r - 1]
        : (r === R ? (p.final || 5) : r === R - 1 ? (p.semi || 3) : (p.early || 3));
      rows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_r' + r, dflt)}</div></div>`);
    }
    // A 3rd place match needs two real semi-finals, so four players, and no divisions.
    const thirdOK = n >= 4 && !((T.divisions || 0) > 1);
    return modal(`
      <h3>Bracket setup — single elimination</h3>
      <p class="muted small">${n} teams, ${R} round${R > 1 ? 's' : ''}. Set the best-of per round.</p>
      ${divNote}
      ${rows.join('')}
      ${thirdOK ? `<label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:10px">
        <input type="checkbox" id="cfgThird"${T.plan && T.plan.thirdPlace ? ' checked' : ''}> 3rd place match: the two beaten semi-finalists play for 3rd (same length as the semi-finals)
      </label>` : ''}
      <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Generate bracket</button></div>`,
      root => {
        root.querySelector('#cfgCancel').onclick = closeModal;
        root.querySelector('#cfgGo').onclick = () => {
          const rounds = [];
          for (let r = 1; r <= R; r++) rounds.push(parseInt(root.querySelector('#bo_r' + r).value, 10));
          const third = root.querySelector('#cfgThird');
          start({ rounds, thirdPlace: third && third.checked ? 1 : 0 });
        };
      });
  }

  if (T.bracketType === 'double') {
    if (n < 3) return toast('Double elimination needs at least 3 teams', true);
    const lbR = 2 * R - 2;
    const wbRows = [], lbRows = [];
    const p = T.plan || {};
    const pr = !!T.perRoundBo;
    const wbDflt = r => (pr && Array.isArray(p.wbList) && p.wbList[r - 1] != null) ? p.wbList[r - 1] : (r === R ? (p.wbFinal || 3) : (p.wb || 3));
    const lbDflt = q => (pr && Array.isArray(p.lbList) && p.lbList[q - 1] != null) ? p.lbList[q - 1] : (q === lbR ? (p.lbFinal || 3) : (p.lb || 3));
    for (let r = 1; r <= R; r++) {
      const lbl = r === R ? 'Final' : r === R - 1 ? 'Semis' : 'Round ' + r;
      wbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_wb' + r, wbDflt(r))}</div></div>`);
    }
    for (let q = 1; q <= lbR; q++) {
      const lbl = q === lbR ? 'Final' : 'Round ' + q;
      lbRows.push(`<div class="row" style="align-items:center;margin:6px 0"><div style="flex:1">${lbl}</div><div style="width:110px">${boSelect('bo_lb' + q, lbDflt(q))}</div></div>`);
    }
    return modal(`
      <h3>Bracket setup — double elimination</h3>
      <p class="muted small">${n} teams. Winners bracket: ${R} rounds, losers bracket: ${lbR} rounds.</p>
      ${divNote}
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
  // Record cuts and stage 2 are decided on the create form / format panel, not here. The
  // dialog reflects them so nobody starts a LotS bracket wondering where the settings went.
  const cutW = parseInt(sp.winCut, 10) || 0;
  const cutL = parseInt(sp.lossCut, 10) || 0;
  const cutsOn = !!(cutW || cutL);
  const cutRounds = (cutW && cutL) ? (cutW + cutL - 1) : (cutW || cutL);
  const s2On = !!sp.stage2;
  const s2Cut = parseInt(sp.s2CutTo, 10) || 8;
  const cutBits = [];
  if (cutW) cutBits.push(cutW + ' win' + (cutW === 1 ? '' : 's') + ' advances');
  if (cutL) cutBits.push(cutL + ' loss' + (cutL === 1 ? '' : 'es') + ' eliminates');
  const comfy = cutsOn ? Math.pow(2, Math.max(cutW, cutL) + 1) : 0;
  return modal(`
    <h3>Swiss setup</h3>
    <p class="muted small">${n} teams. ${cutsOn
      ? 'Teams leave the stage the moment they hit either mark; pairings stay inside a score group and rematches are avoided.'
      : 'Everyone plays every round; pairings by standings, rematches avoided.'}</p>
    ${cutsOn ? `<div class="infocell" style="margin:0 0 12px">
      <div class="mono small muted">FORMAT</div>
      <div>${esc(cutBits.join(' \u00b7 '))}</div>
      <div class="muted small" style="margin-top:4px">At most ${cutRounds} round${cutRounds === 1 ? '' : 's'} per team${sp.decidingBo ? ' \u00b7 Bo' + sp.decidingBo + ' when a win qualifies or a loss eliminates' : ''}</div>
      ${n < comfy ? `<div class="muted small" style="margin-top:6px">${n} teams is a small field for this - below ${comfy} the draw can run out of fresh opponents and may have to repeat a pairing.</div>` : ''}
      ${nextPow2(n) !== n ? `<div class="muted small" style="margin-top:6px">${n} is not a power of two, so some rounds need a bye. A bye is a free win, so the number reaching ${cutW || '-'} wins can vary.</div>` : ''}
    </div>` : ''}
    ${s2On ? `<div class="infocell" style="margin:0 0 12px">
      <div class="mono small muted">SECOND STAGE</div>
      <div>Top ${s2Cut} go through to a ${sp.s2Type === 'double' ? 'double' : 'single'}-elimination playoff bracket${sp.s2Type !== 'double' && sp.s2Third ? ' with a 3rd place match' : ''}</div>
      <div class="muted small" style="margin-top:4px">Built automatically in this same tournament when the Swiss stage ends.</div>
    </div>` : ''}
    <div id="swRoundsWrap" style="display:${cutsOn ? 'none' : ''}">
      <label>Number of rounds</label>
      <input type="number" id="swRounds" min="1" max="15" value="${defR}" autocomplete="off">
    </div>
    <label>Each match is</label>
    <select id="swBo"><option value="1"${sp.bo === 1 ? ' selected' : ''}>Bo1</option><option value="3"${sp.bo !== 1 ? ' selected' : ''}>Bo3</option></select>
    <div id="swFinalWrap" style="display:${s2On ? 'none' : ''}">
      <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:16px">
        <input type="checkbox" id="swFinal" ${sp.final === 0 ? '' : 'checked'}> Final between the top 2 after the last round
      </label>
      <div id="swFinalBoWrap"><label>Final is</label>${boSelect('swFinalBo', sp.finalBo || 5)}</div>
    </div>
    <label style="display:${cutsOn ? 'none' : 'flex'};align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
      <input type="checkbox" id="swFast" ${sp.fast ? 'checked' : ''}> Fast pairing \u2014 next matchup starts as soon as two teams are free
    </label>
    <div class="actions"><button class="btn ghost" id="cfgCancel">Cancel</button><button class="btn primary" id="cfgGo">Start round 1</button></div>`,
    root => {
      const fin = root.querySelector('#swFinal');
      fin.onchange = () => { root.querySelector('#swFinalBoWrap').style.display = fin.checked ? '' : 'none'; };
      root.querySelector('#cfgCancel').onclick = closeModal;
      root.querySelector('#cfgGo').onclick = () => {
        const cfg = {
          rounds: parseInt(root.querySelector('#swRounds').value, 10) || defR,
          bo: parseInt(root.querySelector('#swBo').value, 10),
          final: s2On ? false : fin.checked,
          finalBo: parseInt(root.querySelector('#swFinalBo').value, 10),
          fast: cutsOn ? false : root.querySelector('#swFast').checked
        };
        // pass the configured extras through explicitly so the server never has to guess
        if (cutsOn) { cfg.winCut = cutW; cfg.lossCut = cutL; cfg.decidingBo = parseInt(sp.decidingBo, 10) || 0; }
        if (s2On) {
          cfg.stage2 = 1; cfg.s2CutTo = s2Cut; cfg.s2Type = sp.s2Type || 'single';
          cfg.s2Bo = parseInt(sp.s2Bo, 10) || 3; cfg.s2Final = parseInt(sp.s2Final, 10) || 5; cfg.s2Gf = parseInt(sp.s2Gf, 10) || 5;
          cfg.s2Third = sp.s2Third ? 1 : 0;
        }
        start(cfg);
      };
    });
}

