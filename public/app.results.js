// ----- report score -----

function reportScore(matchId) {
  const m = T.matches.find(x => x.id === matchId);
  if (!m) return;
  if (m.bracket === 'ffa') return reportFfa(matchId);
  if (viewerIsOrganizer()) return reportScoreAdmin(m);
  return reportScorePlayer(m);
}

// organizer: direct report (overrides anything, clears pending submissions)
function reportScoreAdmin(m) {
  const maxW = Math.ceil(m.bo / 2);
  const maps = mapsFor(m.bracket, m.round);
  const pr = m.pendingReport;
  modal(`
    <h3>Report score — ${esc(roundLabel(m))}</h3>
    <p class="muted small">Best of ${m.bo} — first to ${maxW}.${m.hcap ? ' Upper bracket finalist starts 1-0 up.' : ''} Organizer report: applies immediately and overrides player submissions.</p>
    ${pr ? '<p class="warn small">Pending player submission: ' + pr.score1 + '–' + pr.score2 + ' by ' + esc(pr.byName || '') + ' — <button class="btn primary small" id="rAccept">Accept it</button> <button class="btn ghost small" id="rReject">Reject it</button></p>' : ''}
    ${maps.length ? '<div class="mapblock"><div class="mapblock-head"><span>MAP POOL</span></div>' + mapRows(maps) + '</div>' : ''}
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="rs1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${m.score1 != null ? m.score1 : (m.hcap ? 1 : 0)}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="rs2" min="0" max="${maxW}" value="${m.score2 != null ? m.score2 : 0}"></div>
    </div>
    <label style="margin-top:10px">Replay IDs <span class="muted small">(optional, comma-separated \u2014 one per game, kept for the archive)</span></label>
    <input type="text" id="rReplays" value="${esc((m.replayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534001, 21534050">
    <label style="margin-top:10px">Draw replay IDs <span class="muted small">(optional \u2014 games that ended drawn and were replayed)</span></label>
    <input type="text" id="rDrawReplays" value="${esc((m.drawReplayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534010">
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save score</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    const conf = async (accept) => {
      try { await api('/api/t/' + T.id + '/report_confirm', { matchId: m.id, accept: accept ? 1 : 0, admin: adminToken(), token: myToken() }); closeModal(); toast(accept ? 'Accepted' : 'Rejected'); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    const ra = root.querySelector('#rAccept'); if (ra) ra.onclick = () => conf(true);
    const rr = root.querySelector('#rReject'); if (rr) rr.onclick = () => conf(false);
    root.querySelector('#rGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/report', {
          matchId: m.id,
          score1: root.querySelector('#rs1').value,
          score2: root.querySelector('#rs2').value,
          replayIds: root.querySelector('#rReplays').value.split(',').map(s => s.trim()).filter(Boolean),
          drawReplayIds: root.querySelector('#rDrawReplays').value.split(',').map(s => s.trim()).filter(Boolean),
          token: myToken()
        });
        closeModal();
        toast('Score saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// player: submit with replay IDs -> opponent confirms
function reportScorePlayer(m) {
  const mine = myMatchTeam(m);
  if (!mine) return;
  const pr = m.pendingReport;
  // pending against MY team -> confirm/reject screen
  if (pr && pr.byTeam !== mine) {
    modal(`
      <h3>Confirm score — ${esc(roundLabel(m))}</h3>
      <p><strong>${esc(teamName(pr.byTeam))}</strong> reported <strong>${esc(teamName(m.team1))} ${pr.score1} – ${pr.score2} ${esc(teamName(m.team2))}</strong>.</p>
      <p class="muted small">Replay ID${pr.replayIds.length === 1 ? '' : 's'}: ${pr.replayIds.map(esc).join(', ')}</p>
      ${(pr.drawReplayIds && pr.drawReplayIds.length) ? '<p class="muted small">Draw replay' + (pr.drawReplayIds.length === 1 ? '' : 's') + ' (replayed, no score): ' + pr.drawReplayIds.map(esc).join(', ') + '</p>' : ''}
      <div class="actions">
        <button class="btn ghost" id="rcNo">Reject</button>
        <button class="btn primary" id="rcYes">Confirm</button>
      </div>`, root => {
      const act = async (accept) => {
        try { await api('/api/t/' + T.id + '/report_confirm', { matchId: m.id, accept: accept ? 1 : 0, token: myToken() }); closeModal(); toast(accept ? 'Confirmed' : 'Rejected'); await refresh(); }
        catch (e) { toast(e.message, true); }
      };
      root.querySelector('#rcYes').onclick = () => act(true);
      root.querySelector('#rcNo').onclick = () => act(false);
    });
    return;
  }
  if (pr) {
    modal(`<h3>Score submitted</h3>
      <p class="muted small">Your team reported <strong>${pr.score1} – ${pr.score2}</strong>. Waiting for the opponent (or an organizer) to confirm. Submitting again replaces it.</p>
      <div class="actions"><button class="btn ghost" id="rcClose">Close</button><button class="btn primary" id="rcAgain">Submit a new score</button></div>`, root => {
      root.querySelector('#rcClose').onclick = closeModal;
      root.querySelector('#rcAgain').onclick = () => { closeModal(); openPlayerSubmit(m, mine); };
    });
    return;
  }
  openPlayerSubmit(m, mine);
}

function openPlayerSubmit(m, mine) {
  const maxW = Math.ceil(m.bo / 2);
  const cur1 = m.score1 != null ? m.score1 : (m.hcap ? 1 : 0);
  const cur2 = m.score2 != null ? m.score2 : 0;
  const maps = mapsFor(m.bracket, m.round);
  modal(`
    <h3>Submit score — ${esc(roundLabel(m))}</h3>
    <p class="muted small">Best of ${m.bo} — first to ${maxW}. Confirmed so far: <strong>${cur1} – ${cur2}</strong>.
    Enter the score as it stands now; you must give one <strong>replay ID</strong> per new game, and the opponent confirms before it counts.</p>
    ${maps.length ? '<div class="mapblock"><div class="mapblock-head"><span>MAP POOL</span></div>' + mapRows(maps) + '</div>' : ''}
    <div class="row">
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="ps1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${cur1}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="ps2" min="0" max="${maxW}" value="${cur2}"></div>
    </div>
    <div id="psReplays" style="margin-top:10px"></div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="psDraw"> A game ended in a draw (was replayed)</label>
    <div id="psDrawWrap" style="display:none;margin-top:6px">
      <label>Draw replay ID(s) <span class="muted small">(comma-separated — draws score nothing, but casters and the archive want the replays)</span></label>
      <input type="text" id="psDrawIds" autocomplete="off" placeholder="e.g. 21534010, 21534044">
    </div>
    <div class="actions">
      <button class="btn ghost" id="psCancel">Cancel</button>
      <button class="btn primary" id="psGo">Submit for confirmation</button>
    </div>`, root => {
    const drawCb = root.querySelector('#psDraw');
    drawCb.onchange = () => { root.querySelector('#psDrawWrap').style.display = drawCb.checked ? '' : 'none'; };
    const wrap = root.querySelector('#psReplays');
    const redraw = () => {
      const s1 = parseInt(root.querySelector('#ps1').value, 10) || 0;
      const s2 = parseInt(root.querySelector('#ps2').value, 10) || 0;
      const n = Math.max(0, (s1 + s2) - (cur1 + cur2));
      wrap.innerHTML = n ? '<label>Replay ID' + (n === 1 ? '' : 's') + ' <span class="muted small">(one per new game, from the FAF client or replay vault)</span></label>' +
        Array.from({ length: n }, (_, i) => '<input type="text" class="psRid" maxlength="24" placeholder="Replay ID for game ' + (cur1 + cur2 + i + 1) + '" autocomplete="off" style="margin-bottom:6px">').join('')
        : '<p class="muted small">Raise a score to report new games.</p>';
    };
    redraw();
    root.querySelector('#ps1').addEventListener('input', redraw);
    root.querySelector('#ps2').addEventListener('input', redraw);
    root.querySelector('#psCancel').onclick = closeModal;
    root.querySelector('#psGo').onclick = async () => {
      const replayIds = Array.from(root.querySelectorAll('.psRid')).map(i => i.value.trim());
      if (replayIds.some(v => !v)) return toast('Fill in every replay ID', true);
      try {
        await api('/api/t/' + T.id + '/report_submit', {
          matchId: m.id,
          score1: root.querySelector('#ps1').value,
          score2: root.querySelector('#ps2').value,
          replayIds,
          drawReplayIds: drawCb.checked ? root.querySelector('#psDrawIds').value.split(',').map(v => v.trim()).filter(Boolean) : [],
          token: myToken()
        });
        closeModal();
        toast('Submitted — waiting for the opponent to confirm');
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
    <div class="pick-list" id="ffaWinners">
      ${m.entrants.map(id => `<button type="button" class="pick-item${m.winners && m.winners.indexOf(id) >= 0 ? ' on' : ''}" data-tid="${id}">${esc(teamName(id))}</button>`).join('')}
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save result</button>
    </div>`, root => {
    // clicking a name toggles it; don't allow more than the number of winners needed
    root.querySelectorAll('#ffaWinners .pick-item').forEach(btn => btn.onclick = () => {
      if (!btn.classList.contains('on') && root.querySelectorAll('#ffaWinners .pick-item.on').length >= need) {
        return toast('Pick exactly ' + need + ' — unselect one first', true);
      }
      btn.classList.toggle('on');
    });
    root.querySelector('#rCancel').onclick = closeModal;
    root.querySelector('#rGo').onclick = async () => {
      const winners = Array.from(root.querySelectorAll('#ffaWinners .pick-item.on')).map(b => b.dataset.tid);
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
      'Out in ' + roundKeyLabel(team.out.bracket, team.out.round).toLowerCase());
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
  try {
    const at = adminToken();
    secrets = await api('/api/t/' + T.id + '/secrets' + (at ? '?admin=' + encodeURIComponent(at) : ''));
  }
  catch (e) { el.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }

  const base = location.origin + '/t/' + T.id;
  const copyRow = (label, value) => `
    <label>${esc(label)}</label>
    <div class="copybox"><input type="text" readonly value="${esc(value)}"><button class="btn small" data-copy="${esc(value)}">Copy</button></div>`;

  let html = `<div class="panel section"><h2>Share links</h2>
    ${copyRow('Public link — share with everyone', base)}
    ${copyRow('Organizer link — makes whoever opens it an organizer (they must log in). KEEP PRIVATE.', base + '?admin=' + secrets.adminToken)}
    ${copyRow('Late-signup link — lets someone sign up after signups close (they must log in)', base + '?late=' + secrets.lateToken)}
    ${secrets.streamerToken ? copyRow('Streamer/caster link — read access to EVERYTHING (all chats, hidden maps & pools) and can post in every chat, but zero organizer powers: no Admin tab, no Log, no player changes. For casters & production.', base + '?streamer=' + secrets.streamerToken) : ''}
  </div>`;

  { // Organizers: always visible in the Admin tab, even when the identity list is empty
    const sa = !!siteAdmin();
    const orgs = T.organizers || [];
    html += `<div class="panel section"><h2>Organizers <span class="h2-strong">(${orgs.length})</span></h2>
      <p class="muted small">Accounts with organizer rights on this tournament${sa ? ' — as site admin you can remove them' : ''}.</p>
      <p class="muted small">Players see the visible organizers listed on the Chat tab. Hide an organizer to keep them off that public list \u2014 by default everyone is shown.</p>
      ${orgs.length ? '' : '<div class="empty" style="margin:10px 0">No FAF account holds organizer rights here yet \u2014 this tournament predates identity tracking or was created without being logged in. Rights so far come only from the organizer link' + (sa ? ' or the site admin password' : '') + '. Use the buttons below to fix that.</div>'}
      <div class="pick-rows" style="margin-top:10px">${orgs.map(o => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(o.name)} <span class="muted small">FAF id ${esc(o.fafId)}</span> ${o.hidden ? '<span class="idbadge late" title="Not shown to players">hidden</span>' : ''}</span>
        <button class="btn ghost small" data-orgvis="${esc(o.fafId)}" data-hidden="${o.hidden ? 1 : 0}">${o.hidden ? 'Show to players' : 'Hide from players'}</button>
        ${sa ? '<button class="btn danger small" data-orgdel="' + esc(o.fafId) + '">Remove</button>' : ''}
      </div>`).join('')}</div>
      <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
        ${fafAuth.user && !orgs.some(o => o.fafId === fafAuth.user.fafId) ? '<button class="btn ghost small" id="orgClaimSelf">+ Add myself (' + esc(fafAuth.user.fafName || '') + ')</button>' : ''}
        ${sa ? '<button class="btn ghost small" id="orgAddId">+ Add by FAF id</button>' : ''}
      </div></div>`;
  }

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
      <label>Signups</label>
      <select id="af_signupMode">
        <option value="open"${(T.signupMode || 'open') === 'open' ? ' selected' : ''}>Open — anyone can sign up</option>
        <option value="request"${T.signupMode === 'request' ? ' selected' : ''}>Request only — organizer approves</option>
        <option value="invite"${T.signupMode === 'invite' ? ' selected' : ''}>Invite only</option>
      </select>
      <label style="display:block;margin-top:10px"><input type="checkbox" id="af_playerReporting"${T.playerReporting ? ' checked' : ''}> Allow players to submit scores <span class="muted small">(replay IDs + opponent confirmation)</span></label>
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
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Description</label>
      <span class="muted small">Paste a screenshot straight in, or <a href="#" id="aiDescImgBtn">insert an image</a>.</span>
    </div>
    <textarea id="aiDesc" maxlength="2000" rows="6">${esc(T.description || '')}</textarea>
    <input type="file" id="aiDescImgFile" accept="image/*" style="display:none">
    <label>Lobby options</label><textarea id="aiLobby" maxlength="500">${esc(T.lobbyOptions || '')}</textarea>
    <label>Mods</label><input type="text" id="aiMods" maxlength="500" value="${esc(T.mods || '')}">
    <div style="margin-top:14px"><button class="btn" id="aiSave">Save setup</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Rewards</h2>
    <p class="muted small">Shown prominently on the Overview tab. Editable at any time.</p>
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Rewards</label>
      <span class="muted small">Paste a screenshot straight in (e.g. an avatar), or <a href="#" id="aiRwImgBtn">insert an image</a>.</span>
    </div>
    <textarea id="aiRewards" maxlength="2000" rows="5" placeholder="e.g. 1st place: exclusive avatar + 500 credits...">${esc(T.rewards || '')}</textarea>
    <input type="file" id="aiRwImgFile" accept="image/*" style="display:none">
    <div style="margin-top:14px"><button class="btn" id="aiRwSave">Save rewards</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Sponsors</h2>
    <p class="muted small">Shown prominently on the Overview next to the rewards. Text, links as [name](https://\u2026), or paste a logo image straight in.</p>
    <textarea id="aiSponsors" maxlength="2000" rows="5" placeholder="e.g. Powered by [YourSponsor](https://sponsor.example) \u2014 thanks for the prize pool!">${esc(T.sponsors || '')}</textarea>
    <input type="file" id="aiSpImgFile" accept="image/*" style="display:none">
    <div style="margin-top:14px"><button class="btn" id="aiSpSave">Save sponsors</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Livestreams</h2>
    <p class="muted small">Where this tournament is streamed \u2014 shown near the top of the Overview with clickable links. Add one row per stream; leave a row's link empty to drop it.</p>
    <div id="aiStreams">${((T.streams && T.streams.length) ? T.streams : [{ url: '', info: '' }]).map(st => `
      <div class="row stream-row" style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <input type="text" class="stUrl" placeholder="https://twitch.tv/..." maxlength="300" value="${esc(st.url || '')}" style="flex:2;min-width:220px" autocomplete="off">
        <input type="text" class="stInfo" placeholder="Info, e.g. Main stream (English), casted by X" maxlength="120" value="${esc(st.info || '')}" style="flex:2;min-width:220px" autocomplete="off">
      </div>`).join('')}</div>
    <div style="display:flex;gap:10px;margin-top:6px">
      <button class="btn ghost small" id="aiStAdd">+ Add another stream</button>
      <button class="btn" id="aiStSave">Save livestreams</button>
    </div></div>`;

  if ((T.chatMutes || []).length) {
    html += `<div class="panel section"><h2>Muted in chat <span class="h2-strong">(${T.chatMutes.length})</span></h2>
      <p class="muted small">Muted accounts can read chat but not post. Mute anyone from the controls on their messages in any chat room.</p>
      <div class="pick-rows">${T.chatMutes.map(mu => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(mu.name)} <span class="muted small">FAF id ${esc(mu.fafId)}</span></span>
        <button class="btn ghost small" data-unmute="${esc(mu.fafId)}">Unmute</button>
      </div>`).join('')}</div></div>`;
  }

  html += `<div class="panel section"><h2>Rating requirements</h2>
    <p class="muted small">Min/Max <strong>refuse</strong> self-signups outside the range. The <strong>rating cap</strong> is different: it doesn\u2019t refuse anyone \u2014 a player above it is treated as exactly the cap value (displayed and calculated as the cap), e.g. cap 2200 makes a 2400 count as 2200. Organizer adds, replaces, moves and invited players bypass the min/max refusal but are still capped. All editable at any time; changing the cap re-applies to everyone instantly.</p>
    <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px"><label>Min player rating</label><input type="number" id="aiMinR" min="0" max="4000" value="${T.minRating != null ? T.minRating : ''}" placeholder="off"></div>
      <div style="flex:1;min-width:140px"><label>Max player rating</label><input type="number" id="aiMaxR" min="0" max="4000" value="${T.maxRating != null ? T.maxRating : ''}" placeholder="off"></div>
      ${T.teamSize > 1 ? '<div style="flex:1;min-width:140px"><label>Max team rating (combined)</label><input type="number" id="aiMaxTR" min="0" max="30000" value="' + (T.maxTeamRating != null ? T.maxTeamRating : '') + '" placeholder="off"></div>' : ''}
      <div style="flex:1;min-width:140px"><label>Rating cap (clamp)</label><input type="number" id="aiCapR" min="0" max="4000" value="${T.ratingCap != null ? T.ratingCap : ''}" placeholder="off"></div>
    </div>
    <div style="margin-top:12px"><button class="btn" id="aiRatSave">Save rating limits</button></div>
  </div>`;

  if (T.status !== 'finished' && T.competition === 'team') {
    const v = T.veto || { enabled: false, mode: 'upfront' };
    const pools = T.mapPools || [];
    const ready = pools.filter(p => (p.sequence || []).length && (p.sequence || []).length === (p.mapIds || []).length - 1);
    html += `<div class="panel section"><h2>Map vetoes</h2>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="vtEnabled" style="width:auto"${v.enabled ? ' checked' : ''}> Enable map vetoes</label>
      <div id="vtCfg" style="${v.enabled ? '' : 'display:none;'}margin-top:12px">
        <p class="muted small">Each match's captains ban/pick from the pool assigned to their match, following that pool's own ban/pick order. Build pools, their orders, and their round assignments on the <strong>Maps</strong> tab.</p>
        ${pools.length === 0
          ? '<p class="warn small">No map pools yet — create one on the Maps tab or no vetoes will run.</p>'
          : '<div class="pool-status">' + pools.map(p => {
              const steps = (p.sequence || []).length, need = (p.mapIds || []).length - 1;
              const picks = (p.sequence || []).filter(x => x.action === 'pick').length;
              const bo = p.bo || 1;
              const ok = steps > 0 && steps === need && picks === bo - 1;
              return '<div class="pool-status-row">' + (ok ? '<span class="idbadge verified">ready</span>' : '<span class="idbadge late">needs setup</span>') +
                ' <strong>' + esc(p.name) + '</strong> <span class="muted small">' + (p.mapIds || []).length + ' maps · ' +
                (ok ? 'Bo' + bo + ' matches' : (steps === 0 ? 'no ban/pick order set' : 'order needs ' + need + ' steps / ' + (bo - 1) + ' picks')) + '</span></div>';
            }).join('') + '</div>'}
        <label style="margin-top:14px">Who is Team A?</label>
        <select id="vtAb" style="max-width:420px">
          <option value="lowerA"${(v.abMode || 'lowerA') === 'lowerA' ? ' selected' : ''}>Lower rated is Team A (acts first)</option>
          <option value="lowerB"${v.abMode === 'lowerB' ? ' selected' : ''}>Lower rated is Team B (higher rated acts first)</option>
          <option value="random"${v.abMode === 'random' ? ' selected' : ''}>Random per match</option>
          <option value="manual"${v.abMode === 'manual' ? ' selected' : ''}>I set it myself for every match</option>
        </select>
        <div class="muted small" style="margin-top:6px" id="vtAbNote"></div>

        <label style="margin-top:14px">When is the veto done?</label>
        <select id="vtMode" style="max-width:420px">
          <option value="upfront"${v.mode !== 'continuous' ? ' selected' : ''}>All upfront — captains complete the whole veto before game 1</option>
          <option value="continuous"${v.mode === 'continuous' ? ' selected' : ''}>Continuous — reveal steps as games are played</option>
        </select>
        <div class="muted small" style="margin-top:8px">Whatever the rule, you can still override A/B on any match from the Vetoes tab before it starts.</div>
      </div>
      <div style="margin-top:12px"><button class="btn amber" id="vtSave">Save vetoes</button></div>
    </div>`;
  }

  html += `<div class="panel section"><h2>Organizer notes</h2>
    <ul class="muted small">
      <li>Substitutions: Players tab \u2192 "Replace" next to the player. The sub takes over their exact spot (team, seed, results). Subs come from unteamed signups \u2014 share the late-signup link from this tab if you need someone new mid-tournament.</li>
      <li>Maps: group maps into pools on the Maps tab, then assign a pool per round via the "change" link in each round's MAP POOL header on the Bracket tab (or per match from the Vetoes tab).</li>
      <li>Schedule changes: post them on the News tab with "highlight" ticked \u2014 players get an unread badge and see the latest update on the Overview.</li>
      <li>Running scores: reporting 1-0 in a Bo3 keeps the match LIVE; it completes when a team reaches the required wins.</li>
      <li>Corrections: you can fix a finished match as long as the follow-up match hasn't started.</li>
      <li>Data lives in the container volume \u2014 deleting the volume deletes tournaments.</li>
    </ul></div>`;

  if ((T.descImages || []).length) {
    const inlineRef = (T.description || '') + ' ' + (T.rewards || '');
    html += `<div class="panel section"><h2>Attached images <span class="muted small">(${(T.descImages || []).length}/10)</span></h2>
    <p class="muted small" style="margin:6px 0 10px">New images are added by pasting them straight into the Description or Rewards text above. Images referenced there are marked "in use"; unreferenced ones show in a gallery under the briefing. Removing an image deletes its file.</p>
    <div class="desc-gallery">${(T.descImages || []).map(f => { const used = inlineRef.indexOf('/desc-images/' + encodeURIComponent(f)) >= 0 || inlineRef.indexOf('/desc-images/' + f) >= 0; return `<div class="desc-thumb"><img src="/desc-images/${encodeURIComponent(f)}" alt="">${used ? '<div class="mono small" style="color:var(--green);text-align:center">in use</div>' : ''}<button class="btn danger small" data-descdel="${esc(f)}">Remove</button></div>`; }).join('')}</div></div>`;
  }

  if (siteAdmin()) {
    html += `<div class="panel section"><h2>Category <span class="muted small">(site admin only)</span></h2>
      <p class="muted small">Organizers pick this once at creation; only site admins can change it afterwards.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="catbox ${T.category === 'official' ? 'official' : 'community'}">${T.category === 'official' ? 'OFFICIAL' : 'COMMUNITY'}</span>
        <button class="btn ghost small" id="saCatSwap">Change to ${T.category === 'official' ? 'COMMUNITY' : 'OFFICIAL'}</button>
      </div></div>`;
  }

  html += `<div class="panel section" style="border-color:var(--danger,#e5484d)"><h2>Archive / Abandon</h2>
    <p class="muted small" style="margin:6px 0 10px"><strong>Archive</strong> hides this tournament from everyone (reversible by a site admin). <strong>Abandoned</strong> keeps it visible under Completed with a red ABANDONED badge — the honest label when it never actually happened, e.g. too few signups. Abandoning is reversible here.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn danger" id="archiveBtn">Archive tournament</button>
      ${T.abandoned
        ? '<button class="btn ghost" id="abandonBtn" data-undo="1">Undo abandoned</button>'
        : '<button class="btn danger" id="abandonBtn">Mark as abandoned</button>'}
    </div></div>`;

  el.innerHTML = html;
  const claimSelf = document.getElementById('orgClaimSelf');
  if (claimSelf) claimSelf.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/claim_organizer', { adminToken: secrets.adminToken });
      toast('You are now listed as an organizer');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const orgAdd = document.getElementById('orgAddId');
  if (orgAdd) orgAdd.onclick = () => {
    modal(`<h3>Add an organizer by FAF id</h3>
      <label>FAF id</label><input type="text" id="oaId" autocomplete="off">
      <label>Name <span class="muted small">(optional, for the list)</span></label><input type="text" id="oaName" maxlength="60" autocomplete="off">
      <div class="actions"><button class="btn ghost" id="oaCancel">Cancel</button><button class="btn primary" id="oaGo">Add</button></div>`, root => {
      root.querySelector('#oaCancel').onclick = closeModal;
      root.querySelector('#oaGo').onclick = async () => {
        const fafId = root.querySelector('#oaId').value.trim();
        if (!fafId) return toast('FAF id required', true);
        try {
          await api('/api/t/' + T.id + '/add_organizer', { fafId, name: root.querySelector('#oaName').value.trim(), admin: siteAdmin() });
          closeModal(); toast('Added'); await refresh();
        } catch (e) { toast(e.message, true); }
      };
    });
  };
  el.querySelectorAll('[data-orgvis]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/organizer_visibility', { fafId: b.dataset.orgvis, hidden: b.dataset.hidden === '1' ? 0 : 1, admin: adminToken() });
      toast(b.dataset.hidden === '1' ? 'Now visible to players' : 'Hidden from players');
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-orgdel]').forEach(b => b.onclick = async () => {
    const last = (T.organizers || []).length <= 1;
    if (!confirm('Remove organizer rights from this account?' + (last ? '\n\nThis is the LAST organizer — afterwards only the organizer link and site admins can manage this tournament.' : ''))) return;
    try {
      await api('/api/t/' + T.id + '/remove_organizer', { fafId: b.dataset.orgdel, admin: siteAdmin() });
      toast('Organizer removed');
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'));
  });

  const abandonBtn = document.getElementById('abandonBtn');
  if (abandonBtn) abandonBtn.onclick = async () => {
    const undo = abandonBtn.dataset.undo === '1';
    if (!confirm(undo
      ? 'Remove the ABANDONED mark from this tournament?'
      : 'Are you sure you want to mark this tournament as ABANDONED?\n\nIt stays visible under Completed with a red ABANDONED badge instead of "finished". You can undo this later.')) return;
    try {
      await api('/api/t/' + T.id + '/abandon', { undo: undo ? 1 : 0, admin: adminToken() });
      toast(undo ? 'Abandoned mark removed' : 'Marked as abandoned');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const archiveBtn = document.getElementById('archiveBtn');
  if (archiveBtn) archiveBtn.onclick = async () => {
    if (!confirm('Archive this tournament? It will be hidden from everyone. A site admin can restore it later.')) return;
    try { await api('/api/t/' + T.id + '/delete', { admin: adminToken() }); toast('Archived'); location.href = '/'; }
    catch (e) { toast(e.message, true); }
  };

  // paste-to-upload for description and rewards (images land in the shared attached set)
  const descUploader = async (dataUrl) => {
    const d = await api('/api/t/' + T.id + '/add_desc_image', { image: dataUrl, admin: adminToken() });
    return d;
  };
  const aiDescTa = document.getElementById('aiDesc');
  if (aiDescTa) wireImagePaste(aiDescTa, descUploader, document.getElementById('aiDescImgBtn'), document.getElementById('aiDescImgFile'));
  const aiRwTa = document.getElementById('aiRewards');
  if (aiRwTa) wireImagePaste(aiRwTa, descUploader, document.getElementById('aiRwImgBtn'), document.getElementById('aiRwImgFile'));
  const aiSpTa = document.getElementById('aiSponsors');
  if (aiSpTa) wireImagePaste(aiSpTa, descUploader, null, document.getElementById('aiSpImgFile'));
  const stAdd = document.getElementById('aiStAdd');
  if (stAdd) stAdd.onclick = () => {
    const wrap = document.getElementById('aiStreams');
    const div = document.createElement('div');
    div.className = 'row stream-row';
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap';
    div.innerHTML = '<input type="text" class="stUrl" placeholder="https://twitch.tv/..." maxlength="300" style="flex:2;min-width:220px" autocomplete="off">'
      + '<input type="text" class="stInfo" placeholder="Info, e.g. Main stream (English), casted by X" maxlength="120" style="flex:2;min-width:220px" autocomplete="off">';
    wrap.appendChild(div);
  };
  const stSave = document.getElementById('aiStSave');
  if (stSave) stSave.onclick = async () => {
    const rows = Array.from(el.querySelectorAll('.stream-row'));
    const streams = rows.map(r => ({ url: r.querySelector('.stUrl').value.trim(), info: r.querySelector('.stInfo').value.trim() })).filter(x => x.url);
    const badRow = streams.find(x => !/^https?:\/\//.test(x.url));
    if (badRow) return toast('Links must start with http:// or https://', true);
    try {
      await api('/api/t/' + T.id + '/edit_info', { streams, admin: adminToken() });
      toast('Livestreams saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const catSwap = document.getElementById('saCatSwap');
  if (catSwap) catSwap.onclick = async () => {
    const to = T.category === 'official' ? 'community' : 'official';
    if (!confirm('Change this tournament\u2019s category to ' + to.toUpperCase() + '?')) return;
    try {
      await api('/api/t/' + T.id + '/set_category', { category: to, admin: siteAdmin() });
      toast('Category changed');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-unmute]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/chat_mute', { fafId: b.dataset.unmute, unmute: 1, admin: adminToken() }); toast('Unmuted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  const ratSave = document.getElementById('aiRatSave');
  if (ratSave) ratSave.onclick = async () => {
    try {
      const body = { minRating: document.getElementById('aiMinR').value, maxRating: document.getElementById('aiMaxR').value, ratingCap: document.getElementById('aiCapR').value, admin: adminToken() };
      const tr = document.getElementById('aiMaxTR');
      if (tr) body.maxTeamRating = tr.value;
      await api('/api/t/' + T.id + '/edit_info', body);
      toast('Rating limits saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const rwSave = document.getElementById('aiRwSave');
  if (rwSave) rwSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', { rewards: aiRwTa.value, admin: adminToken() });
      toast('Rewards saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const spSave = document.getElementById('aiSpSave');
  if (spSave) spSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', { sponsors: aiSpTa.value, admin: adminToken() });
      toast('Sponsors saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-descdel]').forEach(b => b.onclick = async () => {
    try { await api('/api/t/' + T.id + '/remove_desc_image', { file: b.dataset.descdel, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });

  // ---- veto config (enable + mode; ban/pick orders live on each pool in the Maps tab) ----
  const vtEnabled = document.getElementById('vtEnabled');
  if (vtEnabled) {
    vtEnabled.onchange = () => { document.getElementById('vtCfg').style.display = vtEnabled.checked ? 'block' : 'none'; };
    const vtAb = document.getElementById('vtAb');
    const abNote = () => {
      const notes = {
        lowerA: 'The lower rated captain is Team A and takes the first step. Rating comes from the captain, not the team average.',
        lowerB: 'The lower rated captain is Team B, so the higher rated captain takes the first step. Rating comes from the captain, not the team average.',
        random: 'A coin flip per match, decided when the match is ready.',
        manual: 'Nobody can start their veto until you set Team A on that match (Vetoes tab). Use this when you want full control.'
      };
      document.getElementById('vtAbNote').textContent = notes[vtAb.value] || '';
    };
    if (vtAb) { vtAb.onchange = abNote; abNote(); }
    document.getElementById('vtSave').onclick = async () => {
      const enabled = vtEnabled.checked;
      const mode = document.getElementById('vtMode').value;
      const abMode = vtAb ? vtAb.value : 'lowerA';
      if (enabled) {
        const pools = T.mapPools || [];
        const ready = pools.filter(p => (p.sequence || []).length && (p.sequence || []).length === (p.mapIds || []).length - 1);
        if (ready.length === 0) return toast('No pool has a valid ban/pick order yet — set one up on the Maps tab first', true);
      }
      try {
        await api('/api/t/' + T.id + '/edit_info', { veto: { enabled, mode, abMode }, admin: adminToken() });
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
      const body = { admin: adminToken(), maxTeams: g('af_max').value,
        signupMode: g('af_signupMode').value, playerReporting: g('af_playerReporting').checked ? 1 : 0 };
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

// ---------- per-tournament activity log (organizers + site admin only) ----------

function drawTlog(el) {
  if (!viewerIsOrganizer()) {
    el.innerHTML = '<div class="panel section"><div class="empty">Organizers only.</div></div>';
    return;
  }
  const rows = T.tlog || [];
  let html = `<div class="panel section"><h2>Activity log <span class="h2-strong">(${rows.length})</span></h2>
    <p class="muted small">Everything that happens in this tournament, newest first. Visible to organizers and site admins only. The last 1000 entries are kept; the latest 300 are shown here.</p>`;
  if (!rows.length) {
    html += '<div class="empty">Nothing logged yet.</div>';
  } else {
    html += '<table><thead><tr><th style="width:150px">When</th><th style="width:160px">Who</th><th>What</th></tr></thead><tbody>' +
      rows.map(r => `<tr><td class="mono small muted" style="white-space:nowrap">${esc(fmtDateTime(new Date(r.at).toISOString()))}</td><td>${esc(r.by || '')}</td><td class="small" style="overflow-wrap:anywhere">${esc(r.text || '')}</td></tr>`).join('') +
      '</tbody></table>';
  }
  html += '</div>';
  el.innerHTML = html;
}

// ---------- chat ----------
// A lightweight polling chat that runs independently of the main tournament poll so
// messages arrive quickly. One active room at a time; its own timer, torn down on close.
let _chatRoom = null;
let _chatSince = 0;
let _chatTimer = null;
let _chatMsgs = [];

function stopChatPoll() { if (_chatTimer) { clearInterval(_chatTimer); _chatTimer = null; } }

async function chatRooms() {
  const tok = viewToken();
  const r = await api('/api/t/' + T.id + '/chat_rooms' + (tok ? '?token=' + encodeURIComponent(tok) : ''));
  return r;
}

function renderChatMessages(container) {
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  container.innerHTML = _chatMsgs.map(m => {
    const t = new Date(m.at);
    const time = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
    if (m.sys) return `<div class="chat-sys">\u{1F3B2} ${esc(m.text)} <span class="chat-time">${time}</span></div>`;
    const org = viewerIsOrganizer();
    return `<div class="chat-msg" data-mid="${esc(m.id)}">
      <span class="chat-who">${esc(m.who)}</span>
      <span class="chat-time">${time}</span>
      ${org && m.fafId ? `<span class="chat-mod"><a href="#" data-chatdel="${esc(m.id)}" title="Delete message">\u2715</a> <a href="#" data-chatmute="${esc(m.fafId)}" data-chatmutename="${esc(m.who)}" title="Mute ${esc(m.who)}">mute</a></span>` : ''}
      <div class="chat-text">${esc(m.text)}</div>
    </div>`;
  }).join('') || '<div class="empty">No messages yet. Say hi, or type <code>!roll</code>.</div>';
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

// Build a chat panel into `host` for the given room. Reusable by the tab and the match modal.
async function mountChat(host, room, label) {
  stopChatPoll();
  _chatRoom = room; _chatSince = 0; _chatMsgs = [];
  host.innerHTML = `<div class="chat-panel">
    <div class="chat-head">${esc(label)}</div>
    <div class="chat-log" id="chatLog"><div class="empty">Loading\u2026</div></div>
    <div class="chat-input">
      <input type="text" id="chatText" maxlength="500" placeholder="Message\u2026 (!roll for 1\u2013100, !organizer for help)" autocomplete="off">
      <button class="btn primary small" id="chatSend">Send</button>
      ${viewerIsOrganizer() ? '' : '<button class="btn ghost small" id="chatPing" title="Flags this chat for the organizers so they know you need help">\uD83D\uDD14 Ping organizer</button>'}
    </div>
    <div class="muted small" id="chatNote" style="margin-top:4px"></div>
  </div>`;
  const logEl = host.querySelector('#chatLog');
  const inp = host.querySelector('#chatText');
  const note = host.querySelector('#chatNote');

  const load = async (incremental) => {
    try {
      const tok = viewToken();
      const r = await api('/api/t/' + T.id + '/chat_read?room=' + encodeURIComponent(room) + (_chatSince ? '&since=' + _chatSince : '') + (tok ? '&token=' + encodeURIComponent(tok) : ''));
      if (r.muted) note.textContent = 'You are muted by an organizer \u2014 you can read but not post.';
      const incoming = r.messages || [];
      if (incoming.length) {
        if (incremental) _chatMsgs = _chatMsgs.concat(incoming);
        else _chatMsgs = incoming;
        _chatSince = _chatMsgs[_chatMsgs.length - 1].at;
        renderChatMessages(logEl);
      } else if (!incremental) {
        _chatMsgs = []; renderChatMessages(logEl);
      }
    } catch (e) { note.textContent = e.message; stopChatPoll(); }
  };
  await load(false);

  const send = async () => {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try {
      await api('/api/t/' + T.id + '/chat_post', { room, text, token: viewToken() });
      await load(true);
    } catch (e) { toast(e.message, true); inp.value = text; }
  };
  host.querySelector('#chatSend').onclick = send;
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  const pingBtn = host.querySelector('#chatPing');
  if (pingBtn) pingBtn.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/chat_post', { room, text: '!organizer ' + (inp.value.trim() || ''), token: viewToken() });
      inp.value = '';
      toast('Organizers pinged');
      await load(true);
    } catch (e) { toast(e.message, true); }
  };

  logEl.onclick = async (e) => {
    const del = e.target.closest('[data-chatdel]');
    const mute = e.target.closest('[data-chatmute]');
    if (del) {
      e.preventDefault();
      try { await api('/api/t/' + T.id + '/chat_delete', { room, id: del.dataset.chatdel, admin: adminToken() }); await load(false); }
      catch (er) { toast(er.message, true); }
    } else if (mute) {
      e.preventDefault();
      if (!confirm('Mute ' + mute.dataset.chatmutename + ' from all chat in this tournament?')) return;
      try { await api('/api/t/' + T.id + '/chat_mute', { fafId: mute.dataset.chatmute, name: mute.dataset.chatmutename, admin: adminToken() }); toast('Muted'); await load(false); }
      catch (er) { toast(er.message, true); }
    }
  };

  _chatTimer = setInterval(() => {
    if (_chatRoom !== room) { stopChatPoll(); return; }
    if (document.activeElement === inp && inp.value) { /* still poll, just don't steal focus */ }
    load(true);
  }, 3500);
}

async function drawChatTab(el) {
  stopChatPoll();
  el.innerHTML = '<div class="panel section"><div class="empty">Loading chats\u2026</div></div>';
  let data;
  try { data = await chatRooms(); } catch (e) { el.innerHTML = '<div class="panel section"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const rooms = data.rooms || [];
  if (!rooms.length) { el.innerHTML = '<div class="panel section"><div class="empty">No chats available to you yet.</div></div>'; return; }
  const orgLine = (T.organizersPublic && T.organizersPublic.length)
    ? '<div class="muted small" style="margin-bottom:8px">Organizer' + (T.organizersPublic.length === 1 ? '' : 's') + ': <strong>' + T.organizersPublic.map(esc).join(', ') + '</strong> \u2014 type <code>!organizer</code> in any chat to get their attention.</div>'
    : '<div class="muted small" style="margin-bottom:8px">Type <code>!organizer</code> in any chat to get the organizers\u2019 attention.</div>';
  el.innerHTML = `<div class="chat-layout">
    <div class="chat-rooms panel section">
      <h2>Chats</h2>
      ${orgLine}
      ${data.muted ? '<div class="warn small" style="margin-bottom:8px">You are muted.</div>' : ''}
      <div class="chat-roomlist">${rooms.map((r, i) => `<button class="chat-room ${i === 0 ? 'active' : ''} ${r.ping && viewerIsOrganizer() ? 'pinged' : ''}" data-room="${esc(r.id)}" data-label="${esc(r.label)}">${r.ping && viewerIsOrganizer() ? '\uD83D\uDD14 ' : ''}${esc(r.label)}${r.count ? ' <span class="muted small">(' + r.count + ')</span>' : ''}</button>`).join('')}</div>
    </div>
    <div class="chat-host" id="chatHost"></div>
  </div>`;
  const host = el.querySelector('#chatHost');
  const pick = (btn) => {
    el.querySelectorAll('.chat-room').forEach(b => b.classList.toggle('active', b === btn));
    mountChat(host, btn.dataset.room, btn.dataset.label);
  };
  el.querySelectorAll('.chat-room').forEach(b => b.onclick = () => pick(b));
  pick(el.querySelector('.chat-room'));
}

function openMatchChat(m) {
  const label = mLabel(m) + ' \u2014 ' + teamName(m.team1) + ' vs ' + teamName(m.team2);
  modal(`<h3>Match chat</h3><div id="mcHost"></div>
    <div class="actions"><button class="btn ghost" id="mcClose">Close</button></div>`, root => {
    root.querySelector('#mcClose').onclick = () => { stopChatPoll(); closeModal(); };
    mountChat(root.querySelector('#mcHost'), 'match:' + m.id, label);
  });
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
  else if (location.pathname === '/siteadmin') renderSiteAdmin();
  else if (location.pathname === '/editor') renderEditor();
  else if (location.pathname === '/hall') renderHall();
  else if (location.pathname === '/faq') renderFaq();
  else if (tourneyId()) renderTournament();
  else renderHome();
  refreshPending();
}

async function renderHall() {
  setTitle('Hall of Fame');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">Hall of Fame</h1><div id="hofBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/halloffame'); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('hofBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const players = data.players || [], teams = data.teams || [];
  let html = '<div class="panel section"><h2>Players <span class="muted small">(by championships)</span></h2>';
  if (!players.length) html += '<div class="empty">No results yet — win a tournament to get on the board.</div>';
  else html += '<table><thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Entered</th></tr></thead><tbody>' +
    players.map((p, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(p.name)}</td><td class="mono">${p.wins}</td><td class="mono muted">${p.entered}</td></tr>`).join('') + '</tbody></table>';
  html += '</div><div class="panel section"><h2>Teams <span class="muted small">(by championships)</span></h2>';
  if (!teams.length) html += '<div class="empty">No champions yet.</div>';
  else html += '<table><thead><tr><th>#</th><th>Team</th><th>Wins</th></tr></thead><tbody>' +
    teams.map((t, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(t.name)}</td><td class="mono">${t.wins}</td></tr>`).join('') + '</tbody></table>';
  html += '</div>';
  document.getElementById('hofBody').innerHTML = html;
}

async function renderFaq() {
  setTitle('FAQ / Rules');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">FAQ / Rules</h1><div id="faqBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let arts;
  try { const r = await fetch('/api/articles'); arts = await r.json(); if (!r.ok) throw new Error('Failed to load'); }
  catch (e) { document.getElementById('faqBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  let html;
  if (!arts.length) html = '<div class="panel"><div class="empty">Nothing here yet.' + (siteAdmin() ? ' Add articles from the site-admin console (Articles tab).' : '') + '</div></div>';
  else html = arts.map(a => `<div class="panel section"><h2>${esc(a.title)}</h2><div class="ic-body" style="margin-top:8px">${renderArticleBody(a.body)}</div></div>`).join('');
  document.getElementById('faqBody').innerHTML = html;
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
