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
      <div style="flex:1"><label>${esc(teamName(m.team1))}</label><input type="number" id="rs1" min="${m.hcap ? 1 : 0}" max="${maxW}" value="${(m.score1 != null && m.score1 >= 0) ? m.score1 : (m.hcap ? 1 : 0)}"></div>
      <div style="flex:1"><label>${esc(teamName(m.team2))}</label><input type="number" id="rs2" min="0" max="${maxW}" value="${(m.score2 != null && m.score2 >= 0) ? m.score2 : 0}"></div>
    </div>
    <label style="margin-top:10px">Replay IDs <span class="muted small">(optional, comma-separated \u2014 one per game, kept for the archive)</span></label>
    <input type="text" id="rReplays" inputmode="numeric" value="${esc((m.replayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534001, 21534050">
    <label style="margin-top:10px">Draw replay IDs <span class="muted small">(optional \u2014 games that ended drawn and were replayed)</span></label>
    <input type="text" id="rDrawReplays" inputmode="numeric" value="${esc((m.drawReplayIds || []).join(', '))}" autocomplete="off" placeholder="e.g. 21534010">
    <div class="ff-block">
      <label>Winner <span class="muted small">(only needed if the score doesn't decide it \u2014 e.g. 1\u20131 and someone forfeited)</span></label>
      <div class="row" style="gap:8px">
        <button type="button" class="btn ghost small win-pick" data-win="${esc(m.team1)}">${esc(teamName(m.team1))}</button>
        <button type="button" class="btn ghost small win-pick" data-win="${esc(m.team2)}">${esc(teamName(m.team2))}</button>
        <button type="button" class="btn ghost small win-pick" data-win="">By score</button>
      </div>
      <label style="margin-top:8px"><input type="checkbox" id="rFfChk"> Mark this result as a forfeit</label>
    </div>
    <div class="actions">
      <button class="btn ghost" id="rCancel">Cancel</button>
      <button class="btn primary" id="rGo">Save score</button>
    </div>`, root => {
    root.querySelector('#rCancel').onclick = closeModal;
    // Replay IDs are FAF replay numbers. Keep digits and separators only, so pasting a URL or a
    // messy list drops the junk here instead of being silently stripped on save.
    ['#rReplays', '#rDrawReplays'].forEach(sel => {
      const inp2 = root.querySelector(sel);
      if (!inp2) return;
      const clean = () => {
        const before = inp2.value;
        const after = before.replace(/[^0-9,\s]/g, '').replace(/\s*,\s*/g, ', ');
        if (after !== before) {
          const atEnd = inp2.selectionStart === before.length;
          inp2.value = after;
          if (atEnd) inp2.setSelectionRange(after.length, after.length);
        }
      };
      inp2.addEventListener('input', clean);
      inp2.addEventListener('paste', () => setTimeout(clean, 0));
    });
    // winner picker: highlight the chosen team; '' means decide by score
    let chosenWinner = m.winner || '';
    const paintWin = () => root.querySelectorAll('.win-pick').forEach(b => b.classList.toggle('on', b.dataset.win === chosenWinner));
    root.querySelectorAll('.win-pick').forEach(b => b.onclick = () => { chosenWinner = b.dataset.win; paintWin(); });
    paintWin();
    const conf = async (accept) => {
      try { await api('/api/t/' + T.id + '/report_confirm', { matchId: m.id, accept: accept ? 1 : 0, admin: adminToken(), token: myToken() }); closeModal(); toast(accept ? 'Accepted' : 'Rejected'); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
    const ra = root.querySelector('#rAccept'); if (ra) ra.onclick = () => conf(true);
    const rr = root.querySelector('#rReject'); if (rr) rr.onclick = () => conf(false);
    root.querySelector('#rGo').onclick = async () => {
      try {
        const ff = root.querySelector('#rFfChk').checked;
        await api('/api/t/' + T.id + '/report', {
          matchId: m.id,
          score1: root.querySelector('#rs1').value,
          score2: root.querySelector('#rs2').value,
          winner: chosenWinner || undefined,
          forfeit: (ff && chosenWinner) ? (chosenWinner === m.team1 ? m.team2 : m.team1) : undefined,
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
    // `max` on a number input only constrains the spinner - typing 1000 sails straight past it,
    // and the old code then built 1000 replay fields and hung the browser. Clamp the values
    // themselves, and bound the field count by what the series can actually contain: draws are
    // recorded separately and score nothing, so wins per side can never exceed ceil(bo/2) and the
    // two together can never exceed bo.
    const clampInput = (el, lo, hi) => {
      const raw = parseInt(el.value, 10);
      if (!isFinite(raw)) return lo;
      const v = Math.max(lo, Math.min(hi, raw));
      if (String(v) !== el.value) el.value = String(v);
      return v;
    };
    const redraw = () => {
      const s1 = clampInput(root.querySelector('#ps1'), m.hcap ? 1 : 0, maxW);
      const s2 = clampInput(root.querySelector('#ps2'), 0, maxW);
      const n = Math.max(0, Math.min(m.bo, (s1 + s2) - (cur1 + cur2)));
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

// Challonge group-stage tables and final placements, for imported tournaments.
function importedTablesHTML() {
  let h = '';
  for (const g of (T.importedGroups || [])) {
    h += `<div class="panel section"><h2>${esc(g.name)}</h2>
      <table class="mt-table"><thead><tr><th>#</th><th>Player</th><th>W\u2013L</th><th>Games</th></tr></thead><tbody>
      ${g.rows.map((r, i) => `<tr>
        <td class="mt-fixed mono small muted">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td class="mt-fixed mono">${r.w}\u2013${r.l}</td>
        <td class="mt-fixed mono muted">${r.gw}\u2013${r.gl}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }
  if ((T.importedStandings || []).length) {
    h += `<div class="panel section"><h2>Final placings</h2>
      <div class="st-list">${T.importedStandings.map(r => `<div class="st-row">
        <span class="st-rank">${r.rank}</span><span class="st-name">${esc(r.name)}</span>
      </div>`).join('')}</div>
      <p class="muted small" style="margin-top:8px">Placings as recorded on Challonge.</p></div>`;
  }
  return h;
}

function drawStandings(el) {
  if (streamerMode) {
    el.innerHTML = '<div class="panel"><div class="empty">Standings are hidden while streamer mode is on (it would reveal results). Toggle it off in the header to view them.</div></div>';
    return;
  }
  // an imported event's own tables come first (and may be all there is)
  const impHtml = T.imported ? importedTablesHTML() : '';
  if (T.imported && impHtml) {
    el.innerHTML = impHtml;
    return;
  }
  if (T.status !== 'running' && T.status !== 'finished') {
    el.innerHTML = '<div class="panel"><div class="empty">Standings appear once matches begin.</div></div>';
    return;
  }

  if (T.bracketType === 'swiss' && T.competition === 'team') {
    const rows = swissTable(T);
    const cuts = swissCutCfg(T);
    const s2 = stageTwoCfgOf(T);
    // With record cuts the table has to say what a row's record MEANS, not just show it:
    // "2-1" is only readable if you also know that 3 wins is the finish line.
    const stateCell = r => {
      if (!cuts.on) return '';
      if (r.state === 'advanced') return '<td><span class="pill live">Qualified</span></td>';
      if (r.state === 'eliminated') return '<td><span class="pill">Eliminated</span></td>';
      const need = [];
      if (cuts.win) need.push((cuts.win - r.w) + ' more win' + (cuts.win - r.w === 1 ? '' : 's'));
      if (cuts.loss) need.push((cuts.loss - r.l) + ' loss' + (cuts.loss - r.l === 1 ? '' : 'es') + ' left');
      return '<td class="muted small">' + esc(need.join(' \u00b7 ')) + '</td>';
    };
    const head = cuts.on ? '<th>Status</th>' : '';
    const note = [];
    if (cuts.on) note.push(swissCutLabel(T));
    if (s2) note.push('top ' + s2.cutTo + ' go through to the playoff bracket');
    // The 'beaten' tiebreak is invisible unless its numbers are on the table.
    const byBeaten = T.tiebreak === 'beaten';
    const sbOf = id => (T.swissSB && T.swissSB[id] != null) ? T.swissSB[id] : 0;
    // Two stages: the playoffs decide the places, so they come first - champion, final, 3rd
    // place match and on down. The Swiss table below is how everyone got there.
    const field = (stageTwoLive() && Array.isArray(T.stage2.field)) ? T.stage2.field : [];
    const inField = T.teams.filter(x => field.indexOf(x.id) >= 0);
    const playoffHTML = inField.length
      ? `<div class="panel section"><h2>Playoff <span class="h2-strong">Standings</span></h2>${eliminationPlacingsTable(inField)}</div>` : '';
    el.innerHTML = playoffHTML + `<div class="panel section"><h2>Swiss <span class="h2-strong">Standings</span></h2>
      ${note.length ? `<p class="muted small" style="margin:-4px 0 10px">${esc(note.join(' \u00b7 '))}</p>` : ''}
      ${byBeaten ? `<p class="muted small" style="margin:-4px 0 10px">${esc(swissTiebreakText('beaten'))}</p>` : ''}
      <table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th>${byBeaten ? '<th title="Sum of the Swiss scores (wins) of the opponents this player beat">Beaten opp.</th>' : ''}<th>Game diff</th>${head}</tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.state === 'eliminated' ? 'row-out' : ''} ${i === 0 ? 'rank1' : i === 1 ? 'rank2' : i === 2 ? 'rank3' : ''}">
        <td class="mono">${i + 1}</td><td>${esc(teamName(r.id))}${T.championTeamId === r.id ? ' 🏆' : ''}</td>
        <td class="mono">${r.w}</td><td class="mono">${r.l}</td>${byBeaten ? `<td class="mono">${sbOf(r.id)}</td>` : ''}<td class="mono">${r.gd > 0 ? '+' : ''}${r.gd}</td>${stateCell(r)}</tr>`).join('')}
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

  // elimination formats: rank by how far each team got. With divisions, one table per division,
  // each with its own champion and places - the King bracket first.
  if (divisionsOnT()) {
    let html = '';
    for (let d = 1; d <= T.divisions; d++) {
      html += `<div class="panel section"><h2>${esc(divisionNameOf(d))} <span class="h2-strong">Standings</span></h2>${eliminationPlacingsTable(divisionTeamsOf(d), divisionChampionOf(d), d)}</div>`;
    }
    el.innerHTML = html;
    return;
  }
  el.innerHTML = `<div class="panel section"><h2>Standings</h2>${eliminationPlacingsTable(T.teams)}</div>`;
}

// Place, name and result of everyone in an elimination bracket, best first: by how far each got.
// A 3rd place match splits the two beaten semi-finalists (3rd and 4th); while it is still to be
// played they sit behind the beaten finalist, as "plays for 3rd place".
function eliminationPlacingsTable(teams, champ, division) {
  // `champ`/`division`: one division's table, with that division's champion and round names
  const champion = champ !== undefined ? champ : T.championTeamId;
  const m3 = division ? null : thirdPlaceMatchOf(T);
  const for3rd = id => !!(m3 && m3.status !== 'done' && m3.status !== 'bye' && (m3.team1 === id || m3.team2 === id));
  const stage = team => {
    if (champion === team.id) return 1e9;
    if (team.out && team.out.bracket === '3p') return (team.out.round - 1) + (team.out.place === 3 ? 0.6 : 0.5);
    if (!team.out) return for3rd(team.id) ? (m3.round - 1) + 0.55 : 1e8; // still alive
    if (team.out.bracket === 'gf') return 1e6;
    if (team.out.bracket === 'lb') return 1000 + team.out.round;
    return team.out.round; // wb (single elim) or ffa round
  };
  const rows = teams.slice().sort((a, b) => stage(b) - stage(a) || a.seed - b.seed);
  let rank = 0, prevStage = null, shown = 0;
  const html = rows.map(team => {
    shown++;
    const st = stage(team);
    if (st !== prevStage) { rank = shown; prevStage = st; }
    const label = champion === team.id ? '1' : (!team.out ? '—' : String(rank));
    const note = champion === team.id ? '🏆 Champion' : (!team.out ? (for3rd(team.id) ? 'Plays for 3rd place' : 'Still in') :
      team.out.bracket === '3p' ? (team.out.place === 3 ? 'Won the 3rd place match' : 'Lost the 3rd place match') :
      team.out.bracket === 'gf' || roundKeyLabel(team.out.bracket, team.out.round, division) === 'Final' ? 'Lost the final' :
      'Out in ' + roundKeyLabel(team.out.bracket, team.out.round, division).toLowerCase());
    return `<tr class="${label === '1' ? 'rank1' : label === '2' ? 'rank2' : (label === '3' ? 'rank3' : '')}">
      <td class="mono">${label}</td><td>${esc(team.name)}</td><td class="small muted">${esc(note)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Place</th><th>${T.teamSize === 1 ? 'Player' : 'Team'}</th><th>Result</th></tr></thead>
    <tbody>${html}</tbody></table>`;
}

// ----- admin -----

// Render the result of a rename check, and wire the picker it puts on screen. Split out of
// drawAdmin so it can redraw itself after an update without re-rendering the whole tab (which
// would scroll the organizer back to the top mid-task).
function drawRenameCheck(out, r) {
  // Say plainly what was NOT covered. "Every name is current" has to mean it, or the next
  // organizer to read it trusts a check that quietly skipped half the field.
  const notes = [];
  if (r.failed) notes.push(r.failed + ' could not be checked \u2014 FAF did not answer for them');
  if (r.manual) notes.push(r.manual + ' added by hand, with no FAF account to check');
  const note = notes.length ? '<p class="muted small" style="margin-top:10px">' + esc(notes.join('. ')) + '.</p>' : '';

  if (!r.changed || !r.changed.length) {
    out.innerHTML = '<p class="muted small">Checked ' + r.checked + ' player' + (r.checked === 1 ? '' : 's')
      + (r.checked ? ' \u2014 every name is current.' : '.') + '</p>' + note;
    return;
  }

  out.innerHTML = `<div class="ic-label" style="margin-top:4px">Renamed since signup (${r.changed.length} of ${r.checked})</div>
    <label class="muted small" style="display:block;margin:8px 0"><input type="checkbox" id="rnAll" checked> Select all</label>
    ${r.changed.map(c => `<div class="sa-req"><div class="sa-req-main">
      <label style="display:flex;gap:8px;align-items:baseline;cursor:pointer;margin:0">
        <input type="checkbox" class="rnPick" data-pid="${esc(c.playerId)}" checked>
        <span class="sa-req-name"><span class="muted">${esc(c.from)}</span> \u2192 <strong>${esc(c.to)}</strong></span>
      </label>
      ${c.team ? '<div class="muted small" style="margin-left:26px">also renames the entry \u201c' + esc(c.team) + '\u201d in the bracket</div>' : ''}
    </div></div>`).join('')}
    <div style="margin-top:12px"><button class="btn amber" id="rnApply">Update selected</button></div>${note}`;

  const picks = () => [...out.querySelectorAll('.rnPick')];
  const sync = () => {
    const on = picks().filter(x => x.checked).length;
    const b = out.querySelector('#rnApply');
    if (b) { b.disabled = !on; b.textContent = on ? 'Update selected (' + on + ')' : 'Update selected'; }
    const all = out.querySelector('#rnAll');
    if (all) all.checked = on === picks().length;
  };
  const all = out.querySelector('#rnAll');
  if (all) all.onchange = () => { picks().forEach(x => { x.checked = all.checked; }); sync(); };
  picks().forEach(x => { x.onchange = sync; });
  sync();

  const apply = out.querySelector('#rnApply');
  if (apply) apply.onclick = async () => {
    const ids = picks().filter(x => x.checked).map(x => x.dataset.pid);
    if (!ids.length) return;
    apply.disabled = true; apply.textContent = 'Updating\u2026';
    try {
      const res = await api('/api/t/' + T.id + '/apply_renames', { playerIds: ids, admin: adminToken() });
      const n = (res.updated || []).length;
      toast(n ? 'Updated ' + n + ' name' + (n === 1 ? '' : 's') : 'Nothing to update');
      await refresh();
      // refresh() redraws the tab, so re-run the check to leave the panel showing the truth
      // rather than a list of renames that have already been applied.
      const fresh = document.getElementById('rnOut');
      if (fresh) drawRenameCheck(fresh, await api('/api/t/' + T.id + '/check_renames', { admin: adminToken() }));
    } catch (e) {
      toast(e.message, true);
      apply.disabled = false; apply.textContent = 'Update selected';
    }
  };
}

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
    ${copyRow('Late-signup link — lets someone sign up after signups close (they must log in)', base + '?late=' + secrets.lateToken)}

  </div>`;

  { // Tournament details — name, dates, team counts — editable any time
    const dv = splitDateTimeUTC(T.eventDate || '');
    const su = splitDateTimeUTC(T.signupOpensAt || '');
    const sc = splitDateTimeUTC(T.signupClosesAt || '');
    // checkInDeadline is stored as an epoch ms number, unlike the other three (ISO strings).
    const ci = splitDateTimeUTC(T.checkInDeadline ? new Date(T.checkInDeadline).toISOString() : '');
    html += `<div class="panel section"><h2>Tournament details</h2>
      <p class="muted small">Times are in <strong>UTC</strong> and display in each viewer's own time zone. All editable at any time.</p>
      <label>Tournament name</label>
      <input type="text" id="td_name" maxlength="60" value="${esc(T.name || '')}">
      ${T.imported ? '' : `<label style="margin-top:12px">Event date &amp; time <span class="muted small">(pick more than one day below for an event that spans a weekend, or two)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_date" value="${esc(dv.date)}" style="flex:1"><input type="time" id="td_time" value="${esc(dv.time)}" style="width:130px"></div>
      <div id="td_dayPick" class="dp-host"></div>
      <label style="margin-top:12px">Signups open at <span class="muted small">(before this, only organizers can add players)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_sudate" value="${esc(su.date)}" style="flex:1"><input type="time" id="td_sutime" value="${esc(su.time)}" style="width:130px"></div>
      <label style="margin-top:12px">Signups close at <span class="muted small">(auto-closes signups; team forming &amp; picks still work. Empty = manual)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_scdate" value="${esc(sc.date)}" style="flex:1"><input type="time" id="td_sctime" value="${esc(sc.time)}" style="width:130px"></div>
      <label style="margin-top:12px">Check-in deadline <span class="muted small">(any member of a full team can check it in. Empty = no check-in; teams enter by signup order)</span></label>
      <div style="display:flex;gap:8px"><input type="date" id="td_cidate" value="${esc(ci.date)}" style="flex:1"><input type="time" id="td_citime" value="${esc(ci.time)}" style="width:130px"></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
        <div style="flex:1;min-width:150px"><label>Min teams / entrants <span class="muted small">(display only)</span></label><input type="number" id="td_min" min="0" max="128" value="${T.minTeams || 0}"></div>
        <div style="flex:1;min-width:150px"><label>Max teams / entrants <span class="muted small">(0 = unlimited)</span></label><input type="number" id="td_max" min="0" max="128" value="${T.maxTeams || 0}"></div>
      </div>`}
      <div style="margin-top:14px"><button class="btn amber" id="td_save">Save details</button></div>
    </div>`;
  }

  { // Organizers: always visible in the Admin tab, even when the identity list is empty
    const sa = !!siteAdmin();
    const orgs = T.organizers || [];
    // Qualifiers are a niche feature, so the controls stay collapsed behind a checkbox unless
    // this tournament already uses them.
    const isParent = (T.qualifiers || []).length > 0 || _qlPanelOpen;
    html += `<div class="panel section"><h2>Qualifiers</h2>
      <label class="ql-toggle"><input type="checkbox" id="qlEnable"${isParent ? ' checked' : ''}> This tournament takes qualifiers from other tournaments</label>
      <div id="qlBody" style="display:${isParent ? '' : 'none'}">
        <p class="muted small" style="margin:8px 0 10px">When a linked qualifier finishes, the entrants who meet the rule are <strong>invited</strong> automatically \u2014 they still have to accept. Manual invites and normal signups keep working.</p>
        ${(T.qualifiers || []).length ? '<div class="ql-list">' + T.qualifiers.map(q => `<div class="ql-row">
            <div>
              <div class="ql-name">${esc(q.name)}</div>
              <div class="muted small">${q.rule ? (q.rule.type === 'points' ? q.rule.n + '+ points advance' : 'Top ' + q.rule.n + ' advance') : ''}
                \u00b7 ${q.applied ? 'applied \u2014 ' + (q.qualified || []).length + ' qualified' : (q.status === 'finished' ? 'pending' : 'waiting for it to finish')}</div>
              ${(q.qualified || []).length ? '<div class="muted small">Qualified: ' + esc(q.qualified.join(', ')) + '</div>' : ''}
              ${(q.unreachable || []).length ? '<div class="warn small">No FAF account \u2014 invite manually: ' + esc(q.unreachable.join(', ')) + '</div>' : ''}
              <div class="muted small" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                Seed block:
                <input type="number" class="ql-seed" data-qlseed="${esc(q.id)}" min="0" max="128" value="${q.seedFrom || 0}" style="width:70px;margin:0">
                <span>${q.seedFrom ? 'arrivals take seeds ' + q.seedFrom + ' and down, in the order they qualified' : '0 = seed them normally with everyone else'}</span>
              </div>
            </div>
            <button class="btn ghost small" data-qlrm="${esc(q.id)}">Remove</button>
          </div>`).join('') + '</div>' : ''}
        <div class="ql-add">
          <div class="ql-pick">
            <label>Qualifier tournament <span class="muted small">(only tournaments you organize)</span></label>
            <input type="text" id="qlSearch" placeholder="Search your tournaments\u2026" autocomplete="off">
            <div class="ql-opts" id="qlOpts" style="display:none"></div>
          </div>
          <div style="width:150px"><label>Rule</label><select id="qlType"><option value="top">Top N advance</option><option value="points">N+ points</option></select></div>
          <div style="width:74px"><label>N</label><input type="number" id="qlN" min="1" max="128" value="4"></div>
          <div style="width:96px"><label>Seed from</label><input type="number" id="qlSeedFrom" min="0" max="128" value="0"></div>
          <button class="btn ghost" id="qlAdd">Add</button>
        </div>
      </div>
    </div>`;
    html += `<div class="panel section"><h2>Series</h2>
      <p class="muted small">Group this tournament with other editions of the same recurring event. Editions stay completely independent — this is only a link for browsing.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <select id="tSeriesSel" style="flex:1;min-width:220px"><option value="">— not part of a series —</option></select>
        <button class="btn ghost" id="tSeriesSave">Save</button>
        <a href="/series" data-serieslink class="muted small">Browse series</a>
      </div>
      ${T.seriesName ? '<p class="muted small" style="margin-top:8px">Currently in <strong>' + esc(T.seriesName) + '</strong>.</p>' : ''}
    </div>`;
    const meFid = (fafAuth.user && fafAuth.user.fafId) ? String(fafAuth.user.fafId) : '';
    const canDropLast = sa;   // only a site admin may leave a tournament with no organizers
    html += `<div class="panel section"><h2>Organizers <span class="h2-strong">(${orgs.length})</span></h2>
      <p class="muted small">Accounts with organizer rights on this tournament. <strong>Any organizer can add or remove any other organizer</strong>, or leave the team themselves - it is trust-based. Organizers are recognised by their FAF account; there is no organizer link.</p>
      <p class="muted small">Add an organizer below by FAF name or id. Players see the visible organizers on the Chat tab; hide one to keep them off that public list (default: shown).</p>
      ${orgs.length ? '' : '<div class="empty" style="margin:10px 0">No FAF account holds organizer rights here yet. Add one below by FAF name or id.</div>'}
      <div class="pick-rows" style="margin-top:10px">${orgs.map(o => {
        const mine = meFid && String(o.fafId) === meFid;
        const removable = orgs.length > 1 || canDropLast;
        return `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(o.name)}${mine ? ' <span class="idbadge verified">you</span>' : ''} <span class="muted small">FAF id ${esc(o.fafId)}</span> ${o.hidden ? '<span class="idbadge late" title="Not shown to players">hidden</span>' : ''}</span>
        <button class="btn ghost small" data-orgvis="${esc(o.fafId)}" data-hidden="${o.hidden ? 1 : 0}">${o.hidden ? 'Show to players' : 'Hide from players'}</button>
        ${removable ? '<button class="btn danger small" data-orgdel="' + esc(o.fafId) + '" data-orgname="' + esc(o.name) + '" data-orgself="' + (mine ? 1 : 0) + '">' + (mine ? 'Leave' : 'Remove') + '</button>'
          : '<span class="muted small" title="Add another organizer first">last organizer</span>'}
      </div>`;
      }).join('')}</div>
      <div style="margin-top:10px">
        ${fafAuth.user && (sa || (fafAuth.user.director && T.category === 'official')) && !orgs.some(o => o.fafId === fafAuth.user.fafId) ? '<button class="btn ghost small" id="orgClaimSelf" style="margin-bottom:10px">+ Add myself (' + esc(fafAuth.user.fafName || '') + ')</button>' : ''}
        <div id="orgAdd"></div>
      </div></div>`;

    const casters = T.casters || [];
    html += `<div class="panel section"><h2>Casters</h2>
      <p class="muted small">Read access to everything on this tournament: every chat room (and they can post in them), hidden maps and pools, and all vetoes. No organizer powers at all \u2014 no Admin tab, no Log, no player changes.</p>
      <p class="muted small">Bound to a FAF account, so it works in the desktop client too. Any organizer can add or remove a caster.</p>
      ${casters.length ? '' : '<div class="empty" style="margin:10px 0">No casters yet. Add one below by FAF name or id.</div>'}
      <div class="pick-rows" style="margin-top:10px">${casters.map(c => `<div class="pick-row on" style="cursor:default">
        <span class="pr-name">${esc(c.name)} <span class="muted small">FAF id ${esc(c.fafId)}</span></span>
        <button class="btn danger small" data-casterdel="${esc(c.fafId)}">Remove</button>
      </div>`).join('')}</div>
      <div style="margin-top:10px"><div id="casterAdd"></div></div></div>`;
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
          <select id="af_form"${dis}><option value="draft"${T.formation === 'draft' ? ' selected' : ''}>Captains draft</option><option value="open"${T.formation !== 'draft' ? ' selected' : ''}>Premade teams</option></select>
          <div id="af_orderWrap">
            <label>Draft pick order</label>
            <select id="af_order"${dis}><option value="linear"${T.draftOrder !== 'snake' ? ' selected' : ''}>Bottom to top, every round</option><option value="snake"${T.draftOrder === 'snake' ? ' selected' : ''}>Snake (1\u2192N, N\u21921, ...)</option></select>
          </div>
        </div>
        <label>Bracket</label>
        <select id="af_bt"><option value="single"${T.bracketType === 'single' ? ' selected' : ''}>Single elimination</option><option value="double"${T.bracketType === 'double' ? ' selected' : ''}>Double elimination</option><option value="swiss"${T.bracketType === 'swiss' ? ' selected' : ''}>Swiss</option></select>
        <label id="af_perRoundWrap" style="display:${T.bracketType === 'swiss' ? 'none' : 'flex'};align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
          <input type="checkbox" id="af_perRound"${T.perRoundBo ? ' checked' : ''}> Set a different Bo for every round individually (on the Bracket tab)
        </label>
        <div id="af_perRoundNote" class="muted small" style="display:${T.perRoundBo ? 'block' : 'none'};margin:4px 0 4px">Per-round Bo is managed on the <strong>Bracket</strong> tab \u2014 set each round there (works before and after the bracket is generated). The preset lengths below are hidden while this is on.</div>
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
        <label id="af_thirdWrap" style="display:${T.bracketType === 'single' ? 'flex' : 'none'};align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
          <input type="checkbox" id="af_third"${p.thirdPlace ? ' checked' : ''}> 3rd place match: the two beaten semi-finalists play for 3rd
        </label>
        ${(() => {
          // Divisions (King / Prince): their own brackets. Once a draft is under way it decides
          // them, so the number is fixed until signups are reopened; the names stay editable.
          const nDiv = T.divisions || 0;
          const divLocked = T.status === 'draft'
            || (T.status === 'drafted' && T.formation === 'draft' && !!T.draft && !!(T.draft.division || (T.draftDone || []).length));
          const names = T.divisionNamesSet || [];
          return `<div id="af_divWrap" style="display:${(T.bracketType === 'single' || T.bracketType === 'double') ? 'block' : 'none'}">
            <label>Divisions</label>
            <select id="af_divisions"${divLocked ? ' disabled' : ''}>${[0, 2, 3, 4].map(n => '<option value="' + n + '"' + (n === nDiv ? ' selected' : '') + '>' + (n ? n + ' divisions' : 'One bracket') + '</option>').join('')}</select>
            ${divLocked ? '<div class="muted small" style="margin-top:4px">The draft decides the divisions, so their number is fixed until signups are reopened. The names can still be changed.</div>'
              : (T.status === 'drafted' ? '<div class="muted small" style="margin-top:4px">Changing this splits the locked teams by rating again. Move single teams on the Teams tab.</div>' : '')}
            <div id="af_divNames" class="row" style="gap:10px;margin-top:8px;flex-wrap:wrap">
              ${[1, 2, 3, 4].map(d => '<div style="flex:1;min-width:110px" data-afdivname="' + d + '"><div class="muted small">Division ' + d + ' name</div><input type="text" id="af_divName' + d + '" maxlength="24" placeholder="' + DIVISION_DEFAULT_NAMES[d - 1] + '" value="' + esc(names[d - 1] || '') + '" autocomplete="off"></div>').join('')}
            </div>
          </div>`;
        })()}
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
          <div style="margin-top:8px"><div class="muted small">Order within the same record</div>
            <select id="af_tiebreak"><option value="gd"${T.tiebreak !== 'beaten' ? ' selected' : ''}>Game difference</option><option value="beaten"${T.tiebreak === 'beaten' ? ' selected' : ''}>Sum of the scores of the opponents beaten, then random</option></select>
            <div class="muted small" style="margin-top:4px">Decides the standings between equal records, and with a playoff stage who goes through, the playoff seeds and who picks first.</div></div>

          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
            <input type="checkbox" id="af_swcuts"${(p.winCut || p.lossCut) ? ' checked' : ''}> Finish on record instead of a round count
          </label>
          <div id="af_swCutBox" style="display:${(p.winCut || p.lossCut) ? 'block' : 'none'};padding:8px 0 0 22px">
            <p class="muted small" style="margin:0 0 8px">Teams leave the stage the moment they hit either mark. The stage ends when everyone is decided.</p>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Wins to advance</div><input type="number" id="af_swwin" min="0" max="15" value="${p.winCut || 3}"></div>
              <div style="flex:1"><div class="muted small">Losses to eliminate</div><input type="number" id="af_swloss" min="0" max="15" value="${p.lossCut || 3}"></div>
              <div style="flex:1"><div class="muted small">Deciding matches</div><select id="af_swdec"><option value="0"${!p.decidingBo ? ' selected' : ''}>same as above</option>${[1, 3, 5, 7].map(v => '<option value="' + v + '"' + (p.decidingBo === v ? ' selected' : '') + '>Bo' + v + '</option>').join('')}</select></div>
            </div>
            <p class="muted small" style="margin:8px 0 0">A deciding match is one where a win qualifies someone or a loss knocks them out.</p>
          </div>

          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
            <input type="checkbox" id="af_sw2"${p.stage2 ? ' checked' : ''}> Second stage: cut the qualifiers into a playoff bracket
          </label>
          <div id="af_sw2Box" style="display:${p.stage2 ? 'block' : 'none'};padding:8px 0 0 22px">
            <p class="muted small" style="margin:0 0 8px">One tournament, two stages: the Swiss stage runs first, then the teams that came through are seeded into a bracket on the same page.</p>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Teams through</div><input type="number" id="af_sw2cut" min="2" max="64" value="${p.s2CutTo || 8}"></div>
              <div style="flex:1"><div class="muted small">Bracket</div><select id="af_sw2type"><option value="single"${p.s2Type !== 'double' ? ' selected' : ''}>Single elimination</option><option value="double"${p.s2Type === 'double' ? ' selected' : ''}>Double elimination</option></select></div>
              <div style="flex:1"><div class="muted small">Playoff matches</div>${boSel('af_sw2bo', p.s2Bo || 3)}</div>
              <div style="flex:1"><div class="muted small">Playoff final</div>${boSel('af_sw2final', p.s2Final || 5)}</div>
            </div>
            <label id="af_sw2thirdWrap" style="display:${p.s2Type !== 'double' ? 'flex' : 'none'};align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:8px">
              <input type="checkbox" id="af_sw2third"${p.s2Third ? ' checked' : ''}> 3rd place match: the two beaten semi-finalists play for 3rd
            </label>
            <p class="muted small" style="margin:8px 0 0">The single top-2 final above is replaced by the bracket while this is on.</p>
          </div>
        </div>
      </div>
      <div id="af_stopAt">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:14px">
          <input type="checkbox" id="af_stopOn"${T.stopAtAlive ? ' checked' : ''}> End the tournament early, once a set number are left
        </label>
        <div id="af_stopBox" style="display:${T.stopAtAlive ? 'block' : 'none'};padding:8px 0 0 22px">
          <p class="muted small" style="margin:0 0 8px">For a qualifier: once the field is down to the number that qualifies there is nothing left worth playing. It ends by itself at that point, standings locked, no champion. Stated on the bracket from the moment it is generated so nobody is surprised. Single or double elimination only.</p>
          <div class="row" style="gap:10px;align-items:flex-end">
            <div style="width:150px"><div class="muted small">Stop when this many are left</div><input type="number" id="af_stopN" min="2" max="128" value="${T.stopAtAlive || 4}"></div>
            <div class="muted small" style="flex:1;padding-bottom:8px">You can still stop it by hand at any time from this tab.</div>
          </div>
        </div>
      </div>
      <div id="af_pickPhase">
        <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:14px">
          <input type="checkbox" id="af_pick"${T.pickOpponents ? ' checked' : ''}> Let the top seeds choose their own opponent
        </label>
        <div class="muted small" style="margin:4px 0 0 22px">${T.bracketType !== 'swiss'
          ? 'Runs on round one of the bracket.'
          : (swissStageTwoPlanned(T)
            ? 'On a Swiss this runs on the <strong>playoff bracket</strong>. Swiss round 1 is drawn by seed, and can be rearranged by hand once the rounds start.'
            : 'Does nothing on a Swiss with no second stage. Swiss round 1 is drawn by seed, and can be rearranged by hand once the rounds start.')}</div>
        <div id="af_pickBox" style="display:${T.pickOpponents ? 'block' : 'none'};padding:8px 0 0 22px">
          <p class="muted small" id="af_pickWhat" style="margin:0 0 8px">The top half of the seeds each pick who they play, in seed order. Needs a full bracket (4, 8, 16, 32...).</p>
          <div id="af_pickModeRow" style="display:none;margin:0 0 8px">
            <div class="muted small">Who picks</div>
            <select id="af_pickMode">
              <option value="half"${T.pickMode !== 'unbeaten' && T.pickMode !== 'bottom' ? ' selected' : ''}>The top half of the playoff seeds</option>
              <option value="unbeaten"${T.pickMode === 'unbeaten' ? ' selected' : ''}>Only the unbeaten; everyone else is drawn</option>
              <option value="bottom"${T.pickMode === 'bottom' ? ' selected' : ''}>Only the unbeaten, from the lowest record; everyone else is seeded</option>
            </select>
          </div>
          <div class="row" style="gap:10px;align-items:flex-end">
            <div style="width:170px"><div class="muted small">Time limit per pick</div><input type="number" id="af_pickMins" min="0" max="1440" value="${T.pickMinutes || 0}"></div>
            <div class="muted small" style="flex:1;padding-bottom:8px">Minutes. 0 means no limit. A pick that runs out of time gets the standard bracket matchup.</div>
          </div>
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
      <select id="af_seed"${dis}><option value="rating"${T.seeding === 'rating' ? ' selected' : ''}>By rating</option><option value="random"${T.seeding === 'random' ? ' selected' : ''}>Random</option>${T.seeding === 'manual' ? '<option value="manual" selected>Manual (set on the seeding list)</option>' : ''}</select>
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

  html += seedPanelHTML();

  // Player names: FAF has no rename webhook, so a name recorded at signup goes stale silently
  // and the bracket keeps showing it. Check is read-only; nothing is written until a box is
  // ticked, because the old name is sometimes the one the organizer wants to keep.
  html += `<div class="panel section"><h2>Player <span class="h2-strong">names</span></h2>
    <p class="muted small">FAF names are recorded when someone signs up. If they rename on FAF afterwards, this tournament keeps showing the old name until they next open it. Check here, then pick which ones to update.</p>
    <div style="margin:10px 0"><button class="btn ghost small" id="rnCheck">Check players for renames</button></div>
    <div id="rnOut"></div></div>`;

  html += `<div class="panel section"><h2>Game setup</h2>
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Description</label>
      <span class="muted small">Paste a screenshot straight in, or <a href="#" id="aiDescImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
    <textarea id="aiDesc" maxlength="20000" rows="8">${esc(T.description || '')}</textarea>
    <input type="file" id="aiDescImgFile" accept="image/*" style="display:none">
    <label style="margin-top:12px">Lobby options</label>
    ${mdToolbarHTML()}
    <textarea id="aiLobby" maxlength="20000" rows="6">${esc(T.lobbyOptions || '')}</textarea>
    <label style="margin-top:12px">Mods</label>
    ${mdToolbarHTML()}
    <textarea id="aiMods" maxlength="500" rows="2">${esc(T.mods || '')}</textarea>
    <div style="margin-top:14px"><button class="btn" id="aiSave">Save setup</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Rewards</h2>
    <p class="muted small">Shown prominently on the Overview tab. Editable at any time.</p>
    <div class="row" style="justify-content:space-between;align-items:center">
      <label style="margin:0">Rewards</label>
      <span class="muted small">Paste a screenshot straight in (e.g. an avatar), or <a href="#" id="aiRwImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
    <textarea id="aiRewards" maxlength="2000" rows="5" placeholder="e.g. 1st place: exclusive avatar + 500 credits...">${esc(T.rewards || '')}</textarea>
    <label style="margin-top:10px">Overall cash prize <span class="muted small">(shown as its own box at the top of Rewards)</span></label>
    <div class="prize-row">
      <select id="aiPrizeCur">
        <option value=""${!(T.prize && T.prize.currency) ? ' selected' : ''}>\u2014 none \u2014</option>
        <option value="USD"${(T.prize && T.prize.currency) === 'USD' ? ' selected' : ''}>USD $</option>
        <option value="EUR"${(T.prize && T.prize.currency) === 'EUR' ? ' selected' : ''}>EUR \u20ac</option>
        <option value="RUB"${(T.prize && T.prize.currency) === 'RUB' ? ' selected' : ''}>RUB \u20bd</option>
      </select>
      <input type="number" id="aiPrizeAmt" min="0" step="1" inputmode="numeric" placeholder="Amount" value="${(T.prize && T.prize.amount != null) ? T.prize.amount : ''}">
    </div>
    <input type="file" id="aiRwImgFile" accept="image/*" style="display:none">
    <div style="margin-top:14px"><button class="btn" id="aiRwSave">Save rewards</button></div>
  </div>`;

  html += `<div class="panel section"><h2>Sponsors</h2>
    <div class="row" style="justify-content:space-between;align-items:center">
      <p class="muted small" style="margin:0">Shown prominently on the Overview next to the rewards. Text, links, or images.</p>
      <span class="muted small">Paste a screenshot straight in, or <a href="#" id="aiSpImgBtn">insert an image</a>.</span>
    </div>
    ${mdToolbarHTML()}
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

    <div style="border-top:1px solid var(--line-solid);margin-top:16px;padding-top:14px">
      <label>Which rating counts <span class="muted small">(entry checks, the cap and seeding all use this board)</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select id="aiRatingType" style="flex:1;min-width:220px">
          ${[['global', 'Global (fetched from FAF)'], ['1v1', '1v1 / ladder (fetched)'], ['2v2', '2v2 (fetched)'], ['3v3', '3v3 (fetched)'], ['4v4', '4v4 (fetched)'],
             ['rc', "Fearghal's RC \u2014 best of 2v2/3v3/4v4/Global, blended to 300 games (fetched)"], ['none', 'None \u2014 players enter their own rating']]
            .map(o => '<option value="' + o[0] + '"' + ((T.ratingType || 'global') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('')}
        </select>
        <button class="btn" id="aiRatingTypeSave">Save</button>
      </div>
      <p class="muted small" style="margin-top:6px">Changing this does <strong>not</strong> re-pull anyone already signed up \u2014 they keep the rating they were admitted on until you re-pull below. New signups use the new board immediately.</p>
    </div>

    ${T.ratingType && T.ratingType !== 'none' ? `<div style="border-top:1px solid var(--line-solid);margin-top:16px;padding-top:14px">
      <label>Rating source date <span class="muted small">(FAF ratings are pulled as of this day; blank = whenever the player signs up)</span></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="date" id="aiRatingDate" value="${T.ratingDate ? new Date(T.ratingDate).toISOString().slice(0, 10) : ''}" style="flex:1;min-width:180px">
        <button class="btn" id="aiRatingDateSave">Save rating date</button>
      </div>
      <p class="muted small" style="margin-top:6px">Currently: <strong>${T.ratingDate ? new Date(T.ratingDate).toLocaleDateString() : 'taken at signup time'}</strong>. Changing this affects ratings pulled from now on; it doesn't retroactively re-pull players already signed up.</p>
    </div>
    <div style="border-top:1px solid var(--line-solid);margin-top:16px;padding-top:14px">
      <label>Re-pull every signed-up player's rating</label>
      <p class="muted small" style="margin:4px 0 8px">Fetches all <strong>${T.players.length}</strong> player${T.players.length === 1 ? '' : 's'} again on the board and date set above, and re-applies the cap. Use it after changing either. Anyone FAF can't answer for keeps the rating they already have.</p>
      <button class="btn amber" id="aiRepull">Re-pull ${T.players.length} rating${T.players.length === 1 ? '' : 's'} now</button>
    </div>` : ''}
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
        ${(T.mapDb || []).some(m => m.secret) ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:14px"><input type="checkbox" id="vtRevealBans" style="width:auto"${v.revealBans ? ' checked' : ''}> Reveal a secret map when it is <strong>banned</strong></label>
        <div class="muted small" style="margin:4px 0 0 24px">Off by default: banning blind is the point of secret maps, and revealing every ban hands the pool over one map at a time. A secret map is always revealed when it is picked for a game or left as the decider, whichever way this is set.</div>` : ''}

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

  // Faction vetoes: 1v1 only, since each side is one player choosing their own faction.
  if (T.status !== 'finished' && T.competition === 'team' && T.teamSize === 1) {
    const fv = T.fveto || { enabled: 0, bans: 1, picks: 2 };
    html += `<div class="panel section"><h2>Faction vetoes</h2>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fvEnabled" style="width:auto"${fv.enabled ? ' checked' : ''}> Enable faction vetoes</label>
      <div id="fvCfg" style="${fv.enabled ? '' : 'display:none;'}margin-top:12px">
        <p class="muted small">Runs per game of a series, in parallel with the map veto and independently of it. Each player bans factions (denying them to their opponent), then picks factions in order of preference. <strong>Nobody sees anyone else's choices \u2014 not the opponent, not you.</strong> You can see who still owes choices. Once both are done the result is shown to everyone.</p>
        <label style="margin-top:12px">Bans each</label>
        <select id="fvBans" style="max-width:200px">
          <option value="1"${fv.bans === 1 ? ' selected' : ''}>1 ban</option>
          <option value="2"${fv.bans === 2 ? ' selected' : ''}>2 bans</option>
        </select>
        <label style="margin-top:12px">Picks each</label>
        <select id="fvPicks" style="max-width:200px"></select>
        <div class="muted small" style="margin-top:6px" id="fvNote"></div>
      </div>
      <div style="margin-top:12px"><button class="btn amber" id="fvSave">Save faction vetoes</button></div>
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

  html += '<div class="panel section" id="tBanPanelHost"></div>';

  if (siteAdmin()) {
    html += `<div class="panel section"><h2>Category <span class="muted small">(site admin only)</span></h2>
      <p class="muted small">Organizers pick this once at creation; only site admins can change it afterwards.</p>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="catbox ${T.category === 'official' ? 'official' : 'community'}">${T.category === 'official' ? 'OFFICIAL' : 'COMMUNITY'}</span>
        <button class="btn ghost small" id="saCatSwap">Change to ${T.category === 'official' ? 'COMMUNITY' : 'OFFICIAL'}</button>
      </div></div>`;
  }

  // Who picks their playoff opponent, and redoing the playoffs, while a Swiss stage runs. The
  // Format panel is gone by now, and this is exactly when that decision gets made.
  if (T.status === 'running' && T.playoffs) html += playoffSetupPanelHTML();

  // Stop a running tournament where it stands. This is the qualifier control: a LotS qualifier
  // runs until the top 4 is settled, not until a champion exists.
  if (T.status === 'running' && T.competition !== 'ffa' && T.survivors) {
    const wb = T.survivors.wb || [], lb = T.survivors.lb || [];
    const alive = wb.length + lb.length;
    const nm = id => { const tm = (T.teams || []).find(x => x.id === id); return tm ? tm.name : id; };
    const split = T.bracketType === 'double'
      ? `<div class="muted small" style="margin:6px 0 0">Winners bracket: ${wb.length ? esc(wb.map(nm).join(', ')) : 'nobody'}<br>Losers bracket: ${lb.length ? esc(lb.map(nm).join(', ')) : 'nobody'}</div>`
      : `<div class="muted small" style="margin:6px 0 0">${esc(wb.map(nm).join(', ')) || 'nobody'}</div>`;
    const declared = parseInt(T.stopAtAlive, 10) || 0;
    const toGo = declared ? Math.max(0, alive - declared) : null;
    html += `<div class="panel section"><h2>End <span class="h2-strong">early</span></h2>
      ${declared
        ? '<p class="muted small" style="margin:6px 0 10px">This tournament is set to end by itself once <strong>' + declared + '</strong> are left'
          + (toGo === 0 ? ' \u2014 the next result will do it.' : ', ' + toGo + ' elimination' + (toGo === 1 ? '' : 's') + ' from now.')
          + ' Players can see that on the bracket. You can also stop it by hand right now:</p>'
        : '<p class="muted small" style="margin:6px 0 10px">Locks the standings exactly as they are and marks the tournament finished, without playing out the remaining matches. Nobody is crowned champion. Use this when the tournament exists to decide who qualifies, not who wins - any parent tournament drawing from this one will invite from the locked standings. To have it happen automatically instead, set a survivor count on the <strong>Format</strong> panel before the bracket starts.</p>'}
      <div class="infocell"><div class="mono small muted">STILL STANDING (${alive})</div>${split}</div>
      <div class="stop-set">
        <div class="ic-label">End automatically</div>
        <p class="muted small" style="margin:4px 0 8px">${declared
          ? 'Change the number, or clear it to play the tournament out in full. Players see this on the bracket.'
          : 'Set the number that qualifies and the tournament ends by itself when it gets there - and says so on the bracket from now on, so nobody is surprised by matches that never get played.'}</p>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="muted small">Stop when</span>
          <input type="number" id="stopAtN" min="2" max="128" value="${declared || Math.max(2, Math.min(4, alive - 1))}" style="width:80px;margin:0">
          <span class="muted small">are left</span>
          <button class="btn small" id="stopAtSave">${declared ? 'Update' : 'Set'}</button>
          ${declared ? '<button class="btn ghost small" id="stopAtClear">Clear</button>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn danger" id="finishEarlyBtn">End here and lock standings</button>
      </div></div>`;
  }
  if (T.earlyFinish) {
    html += `<div class="panel section"><h2>Ended <span class="h2-strong">early</span></h2>
      <p class="muted small" style="margin:6px 0 10px">${T.earlyFinish.auto ? 'Stopped automatically' : 'Stopped by ' + esc(T.earlyFinish.by || 'an organizer')} with ${T.earlyFinish.alive} still standing: ${esc((T.earlyFinish.names || []).join(', '))}.${T.earlyFinish.target && T.earlyFinish.alive < T.earlyFinish.target ? ' Two results landed close together, so it went one past the target of ' + T.earlyFinish.target + '.' : ''}</p>
      <button class="btn ghost" id="undoFinishEarlyBtn">Reopen the tournament</button></div>`;
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
  wirePlayoffSetup();

  // Multi-day picker, two-way bound to the native date input beside it (see mountDayPicker).
  let _tdDayPick = null;
  {
    const dateEl = document.getElementById('td_date');
    const host = document.getElementById('td_dayPick');
    if (dateEl && host) {
      const existing = (T.eventDays && T.eventDays.length) ? T.eventDays.slice() : (dateEl.value ? [dateEl.value] : []);
      _tdDayPick = mountDayPicker(host, {
        days: existing,
        onChange: (days) => { if (days.length) dateEl.value = days[0]; }
      });
      dateEl.addEventListener('change', () => _tdDayPick.setSingle(dateEl.value));
    }
  }

  // Per-tournament bans. Removing someone already worked; nothing stopped them signing back up,
  // which is the loop this closes.
  {
    const host = document.getElementById('tBanPanelHost');
    if (host) {
      banPanel(host, {
        title: 'Banned from this tournament',
        blurb: 'These accounts can\u2019t sign up, be added or be invited to <strong>this tournament</strong>. Use it when removing someone isn\u2019t enough because they can just sign up again. Other tournaments are unaffected \u2014 for a whole recurring event use a series ban, and only a site admin or tournament director can ban from official tournaments site-wide.',
        bans: T.bans || [],
        lookup: { tournamentId: T.id },
        addLabel: 'Ban from this tournament',
        onSet: (r) => api('/api/t/' + T.id + '/ban_set', Object.assign({ admin: adminToken() }, r)),
        onRemove: (fid) => api('/api/t/' + T.id + '/ban_remove', { fafId: fid, admin: adminToken() }),
        after: () => refresh()
      });
    }
  }

  const tdSave = document.getElementById('td_save');
  if (tdSave) tdSave.onclick = async () => {
    try {
      const info = { admin: adminToken() };
      const nm = document.getElementById('td_name'); if (nm && nm.value.trim()) info.name = nm.value.trim();
      const dd = document.getElementById('td_date');
      if (dd) {
        info.eventDate = combineDateTimeUTC(dd, document.getElementById('td_time'));
        info.eventDays = _tdDayPick ? _tdDayPick.get() : [];
        info.signupOpensAt = combineDateTimeUTC(document.getElementById('td_sudate'), document.getElementById('td_sutime'));
        info.signupClosesAt = combineDateTimeUTC(document.getElementById('td_scdate'), document.getElementById('td_sctime'));
        info.checkInDeadline = combineDateTimeUTC(document.getElementById('td_cidate'), document.getElementById('td_citime'));
        info.minTeams = document.getElementById('td_min').value;
        info.maxTeams = document.getElementById('td_max').value;
      }
      await api('/api/t/' + T.id + '/edit_info', info);
      toast('Details saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const claimSelf = document.getElementById('orgClaimSelf');
  if (claimSelf) claimSelf.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/add_organizer', { fafId: fafAuth.user.fafId, name: fafAuth.user.fafName || '', admin: adminToken() });
      toast('You are now listed as an organizer');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  // qualifier panel: reveal toggle + searchable picker limited to tournaments the viewer organizes
  {
    const enable = document.getElementById('qlEnable');
    const body = document.getElementById('qlBody');
    if (enable && body) enable.onchange = () => {
      _qlPanelOpen = enable.checked;
      body.style.display = enable.checked ? '' : 'none';
    };

    const search = document.getElementById('qlSearch');
    const opts = document.getElementById('qlOpts');
    if (search && opts) {
      let all = [], chosen = null;
      const linked = new Set((T.qualifiers || []).map(q => q.tournamentId));
      const render = (q) => {
        const term = (q || '').toLowerCase();
        const hits = all.filter(t2 => !term || t2.name.toLowerCase().includes(term)).slice(0, 12);
        if (!hits.length) {
          opts.innerHTML = '<div class="ql-opt muted">' + (all.length ? 'No match.' : 'You don\u2019t organize any other tournaments yet.') + '</div>';
        } else {
          opts.innerHTML = hits.map(t2 =>
            `<div class="ql-opt" data-qlpick="${esc(t2.id)}">${esc(t2.name)} <span class="muted small">${esc(t2.status === 'finished' ? 'finished' : t2.status)}</span></div>`).join('');
          opts.querySelectorAll('[data-qlpick]').forEach(d => d.onmousedown = (ev) => {
            ev.preventDefault();
            chosen = all.find(x => x.id === d.dataset.qlpick) || null;
            search.value = chosen ? chosen.name : '';
            opts.style.display = 'none';
          });
        }
        opts.style.display = '';
      };
      fetch('/api/my_tournaments').then(r => r.json()).then(d => {
        all = (d.tournaments || []).filter(t2 => t2.id !== T.id && !linked.has(t2.id));
      }).catch(() => {});
      search.addEventListener('focus', () => render(search.value));
      search.addEventListener('input', () => { chosen = null; render(search.value); });
      search.addEventListener('blur', () => setTimeout(() => { opts.style.display = 'none'; }, 150));

      const add = document.getElementById('qlAdd');
      if (add) add.onclick = async () => {
        // allow an exact typed name as well as a clicked suggestion
        if (!chosen) chosen = all.find(x => x.name.toLowerCase() === (search.value || '').trim().toLowerCase()) || null;
        if (!chosen) return toast('Pick one of your tournaments from the list', true);
        try {
          await api('/api/t/' + T.id + '/qualifier_add', {
            tournamentId: chosen.id,
            ruleType: document.getElementById('qlType').value,
            n: document.getElementById('qlN').value,
            seedFrom: document.getElementById('qlSeedFrom').value,
            admin: adminToken()
          });
          _qlPanelOpen = true;
          toast('Qualifier added'); await refresh();
        } catch (e) { toast(e.message, true); }
      };
    }
    el.querySelectorAll('[data-qlseed]').forEach(inp => inp.onchange = async () => {
      try {
        await api('/api/t/' + T.id + '/qualifier_seed', { id: inp.dataset.qlseed, seedFrom: inp.value, admin: adminToken() });
        toast(parseInt(inp.value, 10) > 0 ? 'Seed block set' : 'Seed block cleared');
        await refresh();
      } catch (e) { toast(e.message, true); }
    });
    el.querySelectorAll('[data-qlrm]').forEach(b => b.onclick = async () => {
      if (!confirm('Remove this qualifier link? Invites already sent are kept.')) return;
      try { await api('/api/t/' + T.id + '/qualifier_remove', { id: b.dataset.qlrm, admin: adminToken() }); toast('Removed'); await refresh(); }
      catch (e) { toast(e.message, true); }
    });
  }

  // series selector: fill from the series list, then save on demand
  const srSel = document.getElementById('tSeriesSel');
  if (srSel) {
    fetch('/api/series').then(r => r.json()).then(d => {
      for (const s2 of (d.series || [])) {
        const o = document.createElement('option');
        o.value = s2.id; o.textContent = s2.name + ' (' + s2.editions + ')';
        if (T.seriesId === s2.id) o.selected = true;
        srSel.appendChild(o);
      }
    }).catch(() => {});
    const svBtn = document.getElementById('tSeriesSave');
    if (svBtn) svBtn.onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/set_series', { seriesId: srSel.value, admin: adminToken() });
        toast(srSel.value ? 'Series set' : 'Removed from series');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }
  el.querySelectorAll('[data-serieslink]').forEach(a => a.onclick = (e) => { e.preventDefault(); nav(a.getAttribute('href')); });

  const orgAddBox = document.getElementById('orgAdd');
  if (orgAddBox) adminLookupBox(orgAddBox, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="orgAddGo">Make organizer</button>`;
    result.querySelector('#orgAddGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/add_organizer', { fafId: found.fafId, name: found.name, admin: adminToken() });
        toast('Organizer added'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }, { tournamentId: T.id });
  const casterAddBox = document.getElementById('casterAdd');
  if (casterAddBox) adminLookupBox(casterAddBox, (found, result) => {
    result.innerHTML = `Found <strong>${esc(found.name)}</strong> (id ${esc(found.fafId)}) <button class="btn primary small" id="casterAddGo">Make caster</button>`;
    result.querySelector('#casterAddGo').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/add_caster', { fafId: found.fafId, name: found.name, admin: adminToken() });
        toast('Caster added'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }, { tournamentId: T.id });
  el.querySelectorAll('[data-casterdel]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/remove_caster', { fafId: b.dataset.casterdel, admin: adminToken() });
      toast('Caster removed'); await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-orgvis]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/organizer_visibility', { fafId: b.dataset.orgvis, hidden: b.dataset.hidden === '1' ? 0 : 1, admin: adminToken() });
      toast(b.dataset.hidden === '1' ? 'Now visible to players' : 'Hidden from players');
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-orgdel]').forEach(b => b.onclick = async () => {
    const self = b.dataset.orgself === '1';
    const who = b.dataset.orgname || 'this account';
    const last = (T.organizers || []).length <= 1;
    const msg = self
      ? 'Leave the organizer team?\n\nYou lose organizer access to this tournament straight away. Another organizer can add you back.'
      : 'Remove ' + who + ' as an organizer?\n\nThey lose organizer access straight away.';
    if (!confirm(msg + (last ? '\n\nThis is the LAST organizer - afterwards only site admins can manage this tournament.' : ''))) return;
    try {
      const r = await api('/api/t/' + T.id + '/remove_organizer', { fafId: b.dataset.orgdel, admin: adminToken() });
      toast(self ? 'You left the organizer team' : who + ' is no longer an organizer');
      // Having left, the Admin tab is not ours any more - go somewhere that still exists.
      if (r && r.self) { currentTab = 'overview'; syncTabURL(); }
      await refresh();
    } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied'));
  });

  // The survivor count, editable while the tournament runs. The Format panel disappears once
  // the bracket starts, and mid-event is exactly when a TD decides a qualifier should stop.
  const saveStopAt = async (n) => {
    const send = force => api('/api/t/' + T.id + '/set_stop_at', { stopAtAlive: n, confirm: force ? 1 : 0, admin: adminToken() });
    try { const r = await send(false); toast(r.ended ? 'Tournament ended - standings locked' : (n ? 'Set: ends when ' + n + ' are left' : 'Early stop cleared')); }
    catch (e) {
      if (!/straight away/i.test(e.message)) return toast(e.message, true);
      if (!confirm(e.message)) return;
      try { const r2 = await send(true); toast(r2.ended ? 'Tournament ended - standings locked' : 'Set'); }
      catch (e2) { return toast(e2.message, true); }
    }
    await refresh();
  };
  const stopSave = document.getElementById('stopAtSave');
  if (stopSave) stopSave.onclick = () => saveStopAt(parseInt(document.getElementById('stopAtN').value, 10) || 0);
  const stopClear = document.getElementById('stopAtClear');
  if (stopClear) stopClear.onclick = () => {
    if (!confirm('Clear the early-stop rule? This tournament will then be played out in full.')) return;
    saveStopAt(0);
  };

  const feBtn = document.getElementById('finishEarlyBtn');
  if (feBtn) feBtn.onclick = async () => {
    const wb = (T.survivors && T.survivors.wb) || [], lb = (T.survivors && T.survivors.lb) || [];
    const alive = wb.length + lb.length;
    if (!confirm('End "' + T.name + '" now and lock the standings with ' + alive + ' still standing?\n\nNo champion will be recorded. Any tournament that draws qualifiers from this one will invite them straight away.')) return;
    const send = async force => api('/api/t/' + T.id + '/phase', { action: 'finish_early', force: force ? 1 : 0, admin: adminToken() });
    try { await send(false); }
    catch (e) {
      // the only soft refusal is "matches are still live" - offer to override rather than fail
      if (!/still being played/i.test(e.message)) return toast(e.message, true);
      if (!confirm(e.message + '\n\nStop anyway?')) return;
      try { await send(true); } catch (e2) { return toast(e2.message, true); }
    }
    toast('Standings locked');
    await refresh();
  };
  const ufeBtn = document.getElementById('undoFinishEarlyBtn');
  if (ufeBtn) ufeBtn.onclick = async () => {
    const send = async force => api('/api/t/' + T.id + '/phase', { action: 'undo_finish_early', force: force ? 1 : 0, admin: adminToken() });
    try { await send(false); }
    catch (e) {
      if (!/already gone out/i.test(e.message)) return toast(e.message, true);
      if (!confirm(e.message + '\n\nReopen anyway?')) return;
      try { await send(true); } catch (e2) { return toast(e2.message, true); }
    }
    toast('Tournament reopened');
    await refresh();
  };

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
  if (aiDescTa) { wireImagePaste(aiDescTa, descUploader, document.getElementById('aiDescImgBtn'), document.getElementById('aiDescImgFile')); wireMdToolbar(aiDescTa.previousElementSibling, aiDescTa); }
  const aiLobbyTa = document.getElementById('aiLobby');
  if (aiLobbyTa) { wireImagePaste(aiLobbyTa, descUploader, null, null); wireMdToolbar(aiLobbyTa.previousElementSibling, aiLobbyTa); }
  const aiModsTa = document.getElementById('aiMods');
  if (aiModsTa) wireMdToolbar(aiModsTa.previousElementSibling, aiModsTa);
  const aiRwTa = document.getElementById('aiRewards');
  if (aiRwTa) { wireImagePaste(aiRwTa, descUploader, document.getElementById('aiRwImgBtn'), document.getElementById('aiRwImgFile')); wireMdToolbar(aiRwTa.previousElementSibling, aiRwTa); }
  const aiSpTa = document.getElementById('aiSponsors');
  if (aiSpTa) { wireImagePaste(aiSpTa, descUploader, document.getElementById('aiSpImgBtn'), document.getElementById('aiSpImgFile')); wireMdToolbar(aiSpTa.previousElementSibling, aiSpTa); }
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
  const ratingTypeSave = document.getElementById('aiRatingTypeSave');
  if (ratingTypeSave) ratingTypeSave.onclick = async () => {
    const val = document.getElementById('aiRatingType').value;
    if (val !== (T.ratingType || 'global') && T.players.length
        && !confirm('Change the counting rating to "' + val + '"?\n\nThe ' + T.players.length + ' player(s) already signed up keep the rating they were admitted on until you re-pull. New signups use the new board straight away.')) return;
    try {
      await api('/api/t/' + T.id + '/edit_info', { ratingType: val, admin: adminToken() });
      toast('Rating type saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const repull = document.getElementById('aiRepull');
  if (repull) repull.onclick = async () => {
    if (!confirm('Re-pull ratings for all ' + T.players.length + ' player(s) from FAF?\n\nThis overwrites their stored ratings with the current board and date, and re-applies the cap.')) return;
    repull.disabled = true; const was = repull.textContent; repull.textContent = 'Asking FAF\u2026';
    try {
      const r = await api('/api/t/' + T.id + '/repull_ratings', { admin: adminToken() });
      toast('Re-pulled ' + r.updated + ' rating' + (r.updated === 1 ? '' : 's') + (r.failed && r.failed.length ? ' \u2014 ' + r.failed.length + ' could not be fetched' : ''));
      if (r.failed && r.failed.length) alert('Could not fetch a rating for:\n\n' + r.failed.join('\n') + '\n\nThey keep the rating they had.');
      await refresh();
    } catch (e) { toast(e.message, true); repull.disabled = false; repull.textContent = was; }
  };
  const ratingDateSave = document.getElementById('aiRatingDateSave');
  if (ratingDateSave) ratingDateSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', { ratingDate: document.getElementById('aiRatingDate').value || null, admin: adminToken() });
      toast('Rating date saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const rwSave = document.getElementById('aiRwSave');
  if (rwSave) rwSave.onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/edit_info', {
        rewards: aiRwTa.value,
        prizeCurrency: (document.getElementById('aiPrizeCur') || {}).value || '',
        prizeAmount: (document.getElementById('aiPrizeAmt') || {}).value || '',
        admin: adminToken()
      });
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
        lowerA: 'The lower rated team is Team A and takes the first step. Rating is the team\u2019s combined rating \u2014 the same number shown on the Teams tab.',
        lowerB: 'The lower rated team is Team B, so the higher rated team takes the first step. Rating is the team\u2019s combined rating \u2014 the same number shown on the Teams tab.',
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
      // The checkbox only renders when the tournament actually has secret maps; when it is
      // absent the stored setting must be carried through untouched rather than cleared.
      const rbEl = document.getElementById('vtRevealBans');
      const revealBans = rbEl ? (rbEl.checked ? 1 : 0) : ((T.veto && T.veto.revealBans) ? 1 : 0);
      if (enabled) {
        const pools = T.mapPools || [];
        const ready = pools.filter(p => (p.sequence || []).length && (p.sequence || []).length === (p.mapIds || []).length - 1);
        if (ready.length === 0) return toast('No pool has a valid ban/pick order yet — set one up on the Maps tab first', true);
      }
      try {
        await api('/api/t/' + T.id + '/edit_info', { veto: { enabled, mode, abMode, revealBans }, admin: adminToken() });
        await refresh();
        toast('Vetoes saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---- faction vetoes ----
  const fvEnabled = document.getElementById('fvEnabled');
  if (fvEnabled) {
    const cfg = document.getElementById('fvCfg');
    const bansSel = document.getElementById('fvBans');
    const picksSel = document.getElementById('fvPicks');
    const note = document.getElementById('fvNote');
    const cur = T.fveto || { bans: 1, picks: 2 };
    // Picks must exceed bans or an opponent could ban every faction you nominated, leaving the
    // game unresolvable. The options offered adapt so an invalid pair can't be chosen at all.
    const syncPicks = () => {
      const b = parseInt(bansSel.value, 10);
      const min = b + 1;
      const keep = parseInt(picksSel.value, 10) || cur.picks || min;
      picksSel.innerHTML = '';
      for (let n = min; n <= 3; n++) {
        const o = document.createElement('option');
        o.value = String(n); o.textContent = n + ' pick' + (n === 1 ? '' : 's');
        if (n === keep) o.selected = true;
        picksSel.appendChild(o);
      }
      if (!picksSel.value) picksSel.selectedIndex = 0;
      note.textContent = 'With ' + b + ' ban' + (b === 1 ? '' : 's') + ' each, at least ' + min +
        ' picks are needed so your opponent can never ban all of them. There are 4 factions.';
    };
    fvEnabled.onchange = () => { cfg.style.display = fvEnabled.checked ? '' : 'none'; };
    bansSel.onchange = syncPicks;
    syncPicks();
    document.getElementById('fvSave').onclick = async () => {
      try {
        await api('/api/t/' + T.id + '/fveto_config', {
          enabled: fvEnabled.checked ? 1 : 0,
          bans: parseInt(bansSel.value, 10),
          picks: parseInt(picksSel.value, 10),
          admin: adminToken()
        });
        await refresh();
        toast('Faction vetoes saved');
      } catch (e) { toast(e.message, true); }
    };
  }

  // ---- seeding editor (shared with the Players tab - see seedPanelHTML) ----
  wireSeedPanel();

  // ---- rename check ----
  const rnCheck = document.getElementById('rnCheck');
  if (rnCheck) rnCheck.onclick = async () => {
    const out = document.getElementById('rnOut');
    const label = rnCheck.textContent;
    rnCheck.disabled = true; rnCheck.textContent = 'Checking\u2026';
    out.innerHTML = '';
    try {
      drawRenameCheck(out, await api('/api/t/' + T.id + '/check_renames', { admin: adminToken() }));
    } catch (e) { toast(e.message, true); }
    rnCheck.disabled = false; rnCheck.textContent = label;
  };

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
      const bt = g('af_bt').value;
      const perRound = g('af_perRound') && g('af_perRound').checked;
      // the per-round toggle only applies to single/double elim
      if (g('af_perRoundWrap')) g('af_perRoundWrap').style.display = (isFfa || bt === 'swiss') ? 'none' : 'flex';
      if (g('af_perRoundNote')) g('af_perRoundNote').style.display = (!isFfa && bt !== 'swiss' && perRound) ? 'block' : 'none';
      g('af_pSingle').style.display = (bt === 'single' && !perRound) ? '' : 'none';
      g('af_pDouble').style.display = (bt === 'double' && !perRound) ? '' : 'none';
      g('af_pSwiss').style.display = bt === 'swiss' ? '' : 'none';
      if (g('af_thirdWrap')) g('af_thirdWrap').style.display = bt === 'single' ? 'flex' : 'none';
      if (g('af_divWrap')) {
        g('af_divWrap').style.display = (bt === 'single' || bt === 'double') ? 'block' : 'none';
        const nd = parseInt((g('af_divisions') || {}).value, 10) || 0;
        el.querySelectorAll('[data-afdivname]').forEach(x => { x.style.display = parseInt(x.dataset.afdivname, 10) <= nd ? '' : 'none'; });
        if (g('af_divNames')) g('af_divNames').style.display = nd > 1 ? 'flex' : 'none';
      }
      if (g('af_sw2thirdWrap')) g('af_sw2thirdWrap').style.display = (g('af_sw2type') && g('af_sw2type').value === 'double') ? 'none' : 'flex';
      if (g('af_swCutBox')) g('af_swCutBox').style.display = (g('af_swcuts') && g('af_swcuts').checked) ? 'block' : 'none';
      if (g('af_sw2Box')) g('af_sw2Box').style.display = (g('af_sw2') && g('af_sw2').checked) ? 'block' : 'none';
      if (g('af_swfinal')) g('af_swfinal').disabled = !!(g('af_sw2') && g('af_sw2').checked);
      if (g('af_stopBox')) g('af_stopBox').style.display = (g('af_stopOn') && g('af_stopOn').checked) ? 'block' : 'none';
      // a survivor cut-off is an elimination-bracket idea; swiss and FFA have no such count
      if (g('af_stopAt')) g('af_stopAt').style.display = (isFfa || bt === 'swiss') ? 'none' : '';
      if (g('af_pickBox')) g('af_pickBox').style.display = (g('af_pick') && g('af_pick').checked) ? 'block' : 'none';
      // WHO picks is a playoff question: it needs a Swiss stage to have produced records first.
      {
        const playoffs = g('af_bt') && g('af_bt').value === 'swiss' && g('af_sw2') && g('af_sw2').checked;
        if (g('af_pickModeRow')) g('af_pickModeRow').style.display = playoffs ? '' : 'none';
        const cutsOn = g('af_swcuts') && g('af_swcuts').checked;
        const win = cutsOn ? (parseInt((g('af_swwin') || {}).value, 10) || 0) : 0;
        const loss = cutsOn ? (parseInt((g('af_swloss') || {}).value, 10) || 0) : 0;
        const bottomRec = (win && loss) ? win + '-' + (loss - 1) : 'lowest record';
        if (g('af_pickMode') && g('af_pickMode').options[1]) {
          g('af_pickMode').options[1].textContent = 'Only the unbeaten (' + (win ? win + '-0' : 'no losses') + '); everyone else is drawn';
        }
        if (g('af_pickMode') && g('af_pickMode').options[2]) {
          g('af_pickMode').options[2].textContent = 'Only the unbeaten (' + (win ? win + '-0' : 'no losses') + '), from the ' + bottomRec + 's; everyone else is seeded';
        }
        const mode = playoffs && g('af_pick') && g('af_pick').checked && g('af_pickMode') ? g('af_pickMode').value : 'half';
        // that option always seeds by the beaten score, so the tiebreak follows it (and comes back after)
        const tbSel = g('af_tiebreak');
        if (tbSel) {
          if (mode === 'bottom') { if (!tbSel.disabled) tbSel.dataset.was = tbSel.value; tbSel.value = 'beaten'; tbSel.disabled = true; }
          else if (tbSel.disabled) { tbSel.disabled = false; if (tbSel.dataset.was) tbSel.value = tbSel.dataset.was; }
        }
        if (g('af_pickWhat')) {
          g('af_pickWhat').textContent = mode === 'bottom'
            ? 'Everyone who went through the Swiss without a loss chooses their playoff opponent from the ' + bottomRec + 's, in seed order. The rest are paired by seed, the best remaining against the lowest. Seeds follow the standings, then the sum of the scores of the opponents each player beat. Needs a playoff of 4, 8, 16 or 32. Can still be changed while the Swiss is played, on this tab.'
            : mode === 'unbeaten'
            ? 'Everyone who went through the Swiss without a loss chooses their playoff opponent, in seed order. The rest are drawn against each other, a different record against each other where possible. Needs a playoff of 4, 8, 16 or 32. Can still be changed while the Swiss is played, on this tab.'
            : 'The top half of the seeds each pick who they play, in seed order. Needs a full bracket (4, 8, 16, 32...).';
        }
      }
      // picking is a bracket concept; FFA has no round-one pairing to choose
      if (g('af_pickPhase')) g('af_pickPhase').style.display = isFfa ? 'none' : '';
      g('af_fpoints').style.display = g('af_fmode').value === 'points' ? '' : 'none';
      g('af_felim').style.display = g('af_fmode').value === 'elim' ? '' : 'none';
      g('af_fcutto').style.display = g('af_fcutmode').value === '1' ? '' : 'none';
      g('af_ffinalsize').style.display = g('af_ffinalmode').value === '1' ? '' : 'none';
      syncPm();
    };
    for (const id of ['af_comp', 'af_size', 'af_form', 'af_bt', 'af_fsize', 'af_fmode', 'af_fcutmode', 'af_ffinalmode', 'af_perRound', 'af_swcuts', 'af_sw2', 'af_pick', 'af_stopOn', 'af_pickMode', 'af_swwin', 'af_swloss', 'af_sw2type', 'af_divisions']) { const e = g(id); if (e) e.onchange = sync; }
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
        const stopOn = g('af_stopOn') && g('af_stopOn').checked;
        body.stopAtAlive = stopOn ? g('af_stopN').value : 0;
        const pickOn = g('af_pick') && g('af_pick').checked;
        body.pickOpponents = pickOn ? 1 : 0;
        body.pickMinutes = pickOn ? g('af_pickMins').value : 0;
        if (g('af_pickMode')) body.pickMode = g('af_pickMode').value;
        if (g('af_tiebreak') && g('af_bt').value === 'swiss') body.tiebreak = g('af_tiebreak').value;
        body.bracketType = g('af_bt').value;
        body.perRoundBo = (g('af_perRound') && g('af_perRound').checked) ? 1 : 0;
        if ((g('af_bt').value === 'single' || g('af_bt').value === 'double') && g('af_divisions')) {
          if (!g('af_divisions').disabled) body.divisions = g('af_divisions').value;
          body.divisionNames = [1, 2, 3, 4].map(d => ((g('af_divName' + d) || {}).value || '').trim());
        }
        if (g('af_bt').value === 'single') body.plan = { early: g('af_early').value, semi: g('af_semi').value, final: g('af_final').value, thirdPlace: (g('af_third') && g('af_third').checked) ? 1 : 0 };
        else if (g('af_bt').value === 'double') body.plan = { wb: g('af_wb').value, wbFinal: g('af_wbf').value, lb: g('af_lb').value, lbFinal: g('af_lbf').value, gf: g('af_gf').value, lbHandicap: g('af_hcap').checked };
        else {
          body.plan = { bo: g('af_swbo').value, final: g('af_swfinal').checked, finalBo: g('af_swfbo').value, fast: g('af_swfast').checked };
          const cutsOn = g('af_swcuts') && g('af_swcuts').checked;
          body.plan.winCut = cutsOn ? g('af_swwin').value : 0;
          body.plan.lossCut = cutsOn ? g('af_swloss').value : 0;
          body.plan.decidingBo = cutsOn ? g('af_swdec').value : 0;
          const s2On = g('af_sw2') && g('af_sw2').checked;
          body.plan.stage2 = s2On ? 1 : 0;
          if (s2On) {
            body.plan.s2CutTo = g('af_sw2cut').value;
            body.plan.s2Type = g('af_sw2type').value;
            body.plan.s2Bo = g('af_sw2bo').value;
            body.plan.s2Final = g('af_sw2final').value;
            body.plan.s2Gf = g('af_sw2final').value;
            body.plan.s2Third = (g('af_sw2type').value !== 'double' && g('af_sw2third') && g('af_sw2third').checked) ? 1 : 0;
          }
        }
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
// messages arrive quickly.
//
// Every mounted panel is its own INSTANCE: its own room, history, reply state and timer.
// This used to be module-level state, which meant a second mount silently killed the first —
// fine when only one chat could ever be on screen, fatal now that a chat can be pinned to the
// right while another one is open in the tab or a popup.
let _srOfficialOnly = false;   // series index: show only official series
let _qlPanelOpen = false;   // Qualifiers controls revealed on the Admin tab (per session)
let _chatActiveRoom = null;
let _chatCompletedOpen = false;   // completed-match chats collapsed by default
const _chatInstances = new Set();

// Drop a room's unread marker from the cached view and repaint just the affected badges.
function clearUnreadFor(room) {
  if (!T || !T.unreadByRoom) return;
  const had = T.unreadByRoom[room] || 0;
  if (!had) return;
  delete T.unreadByRoom[room];
  T.myUnreadCount = Math.max(0, (T.myUnreadCount || 0) - had);
  // room button in the list
  const btn = document.querySelector('.chat-room[data-room="' + (window.CSS && CSS.escape ? CSS.escape(room) : room) + '"] .unread-dot');
  if (btn) btn.remove();
  // the CHAT tab's quiet badge
  const tabBtn = document.querySelector('.tab[data-tab="chat"] .tab-badge.quiet');
  if (tabBtn) {
    if (T.myUnreadCount > 0) tabBtn.textContent = T.myUnreadCount > 9 ? '9+' : T.myUnreadCount;
    else tabBtn.remove();
  }
}

function destroyChat(inst) {
  if (!inst) return;
  inst.dead = true;
  if (inst.timer) { clearInterval(inst.timer); inst.timer = null; }
  _chatInstances.delete(inst);
}
// Kill whatever chat currently lives inside `host` (or anywhere under it).
function destroyChatIn(host) {
  if (!host) return;
  for (const inst of Array.from(_chatInstances)) {
    if (inst.host === host || host.contains(inst.host)) destroyChat(inst);
  }
}
// Tear down every transient chat panel — the tab's, or one in a popup — but never the pinned
// rail, which is the entire point of pinning. Kept under its old name because drawTournament
// calls it on every redraw and on every tab switch.
function stopChatPoll() {
  for (const inst of Array.from(_chatInstances)) if (!inst.pinned) destroyChat(inst);
}
// Poked from app.js the instant a hidden tab becomes visible again: catch every live panel up.
const _chatPollNow = () => { for (const inst of Array.from(_chatInstances)) inst.pollNow(); };

async function chatRooms() {
  const tok = viewToken();
  const r = await api('/api/t/' + T.id + '/chat_rooms' + (tok ? '?token=' + encodeURIComponent(tok) : ''));
  return r;
}

// ---------- pinned chat ----------
// One chat can be pinned to a rail on the right of the screen. It lives outside #app so a
// tournament redraw, a tab switch or a popup never disturbs it, and it survives everything
// except the four things that should genuinely end it (see syncPinnedChat).
let _pinnedChat = null;   // { tid, room, label }

function pinStoreKey() { const id = tourneyId(); return id ? 'faf_pinchat_' + id : null; }

// Is this room one of the "Completed matches" chats? Those are read-only history in practice:
// pinning one would be a dead end, since the rail closes itself the moment a match finishes.
// A room whose match has vanished entirely (bracket regenerated, tournament reset) counts too.
function chatRoomIsDone(room) {
  if (!room || room.indexOf('match:') !== 0) return false;   // global / captains / staff never complete
  if (!T || !T.matches) return false;                        // no data yet: don't guess, don't close
  const m = T.matches.find(x => x.id === room.slice(6));
  if (!m) return true;
  return m.status === 'done';
}
function chatRoomPinnable(room) { return !!room && !!tourneyId() && !chatRoomIsDone(room); }

// `prev` is the record being cleared. Keying off it rather than off tourneyId() matters when
// the pin is dropped BECAUSE the viewer has navigated to a different tournament: keying off the
// current page would clear the wrong tournament's stored pin.
function savePinned(prev) {
  const rec = _pinnedChat || prev;
  const tid = rec ? rec.tid : tourneyId();
  if (!tid) return;
  const key = 'faf_pinchat_' + tid;
  try {
    if (_pinnedChat) sessionStorage.setItem(key, JSON.stringify(_pinnedChat));
    else sessionStorage.removeItem(key);
  } catch (e) {}
}

// The rail is fixed to the viewport, so it has to start below the sticky top bar. offsetHeight
// (not getBoundingClientRect) because body carries a `zoom` from the UI-scale setting and both
// elements live in that same scaled coordinate space.
function positionPinRail() {
  const bar = document.querySelector('.topbar');
  // A zero reading means we were called before layout settled — fall back rather than tucking
  // the rail up underneath the bar.
  const h = (bar && bar.offsetHeight) ? bar.offsetHeight : 56;
  document.documentElement.style.setProperty('--pin-top', h + 'px');
}

function pinChat(room, label) {
  if (!room) return;
  if (!chatRoomPinnable(room)) { toast('That match is finished — its chat can’t be pinned.', true); return; }
  if (_pinnedChat && _pinnedChat.room === room) return;      // already there: don't remount and lose scroll
  _pinnedChat = { tid: tourneyId(), room, label: label || room };
  savePinned();
  renderPinRail();          // replaces whatever was pinned before
  refreshPinButtons();
}

function unpinChat(note) {
  if (!_pinnedChat) return;
  const prev = _pinnedChat;
  _pinnedChat = null;
  savePinned(prev);
  const el = document.getElementById('pinRail');
  if (el) { destroyChatIn(el); el.remove(); }
  document.body.classList.remove('chat-pinned');
  refreshPinButtons();
  if (note) toast(note);
}

function renderPinRail() {
  if (!_pinnedChat) return;
  let el = document.getElementById('pinRail');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'pinRail';
    el.className = 'pin-rail';
    document.body.appendChild(el);
  }
  destroyChatIn(el);
  el.innerHTML = '<div class="pin-rail-body"></div>';
  document.body.classList.add('chat-pinned');
  positionPinRail();
  mountChat(el.querySelector('.pin-rail-body'), _pinnedChat.room, _pinnedChat.label, { pinned: true });
}

// Restore a pin after a reload. Called once the tournament data is in, so chatRoomIsDone can
// actually judge the room; a stored pin for a match that finished meanwhile is simply dropped.
function restorePinnedChat() {
  const key = pinStoreKey();
  if (!key) return;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { saved = null; }
  if (!saved || !saved.room) return;
  if (saved.tid !== tourneyId() || !chatRoomPinnable(saved.room)) {
    try { sessionStorage.removeItem(key); } catch (e) {}
    return;
  }
  if (_pinnedChat && _pinnedChat.room === saved.room) return;
  _pinnedChat = saved;
  renderPinRail();
  refreshPinButtons();
}

// The single guard that keeps the rail honest. Runs on every redraw, on every tournament poll
// and on the rail's own 3.5s tick, so no route into a stale pin is left open:
//   - navigated off the tournament (or onto a different one) -> close
//   - the match finished, or no longer exists                -> close, and say why
//   - a room the viewer may no longer pin                    -> the buttons for it disappear
function syncPinnedChat() {
  if (_pinnedChat) {
    positionPinRail();          // the top bar wraps to two rows on narrow screens
    const tid = tourneyId();
    if (!tid || tid !== _pinnedChat.tid) unpinChat();
    else if (T && T.id === tid && chatRoomIsDone(_pinnedChat.room)) {
      unpinChat('Pinned chat closed — that match is complete.');
    }
  }
  refreshPinButtons();
}

// Repaint every pin control on screen from the one source of truth. Cheap, and it means no
// caller has to remember which buttons it just rendered.
function refreshPinButtons() {
  const pinnedRoom = _pinnedChat ? _pinnedChat.room : null;
  document.querySelectorAll('[data-pinbtn]').forEach(b => {
    const room = b.dataset.pinbtn;
    // a match that finished while this panel was open loses the button entirely
    if (!chatRoomPinnable(room)) { b.style.display = 'none'; return; }
    b.style.display = '';
    const on = room === pinnedRoom;
    b.classList.toggle('on', on);
    b.textContent = on ? '\u{1F4CC} Pinned on the right' : '\u{1F4CC} Pin this chat on the right';
    b.title = on ? 'Click to unpin it' : 'Keep this chat open in a panel on the right of the screen';
  });
  document.querySelectorAll('[data-pinroom]').forEach(b => {
    const room = b.dataset.pinroom;
    if (!chatRoomPinnable(room)) { b.style.display = 'none'; return; }
    b.style.display = '';
    const on = room === pinnedRoom;
    b.classList.toggle('on', on);
    b.title = on ? 'Unpin this chat' : 'Pin this chat on the right';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

window.addEventListener('resize', positionPinRail);

// Escape text, then visually highlight @mentions (word-initial @ followed by a name run).
// Purely cosmetic — matches loosely so "@Deli" or "@deli7961" both light up.
function highlightMentions(text) {
  const safe = esc(text || '');
  return safe.replace(/(^|\s)@([^\s@]{1,40})/g, (whole, pre, name) => pre + '<span class="chat-ping">@' + name + '</span>');
}

function renderChatMessages(container, msgs) {
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  // Timestamps used to be raw browser-local hours, which ignored the viewer's chosen time zone
  // and gave no clue what DAY a message was from. Now: a divider whenever the day changes, and
  // the full date/time on hover, both honouring the viewer's tz and format settings.
  let lastDay = '';
  container.innerHTML = msgs.map(m => {
    const iso = new Date(m.at).toISOString();
    const time = fmtTimePart(new Date(m.at), resolvedTZ());
    const full = fmtDateTime(iso);
    const day = fmtDatePart(new Date(m.at), resolvedTZ());
    let divider = '';
    if (day !== lastDay) { divider = `<div class="chat-day"><span>${esc(day)}</span></div>`; lastDay = day; }
    if (m.sys) return divider + `<div class="chat-sys">\u{1F3B2} ${esc(m.text)} <span class="chat-time" title="${esc(full)}">${esc(time)}</span></div>`;
    const org = viewerIsOrganizer();
    // The quoted parent is a snapshot taken when the reply was posted, so it still reads
    // correctly if the original was deleted or has scrolled out of the retained history.
    const quote = m.replyTo ? `<div class="chat-quote" data-jump="${esc(m.replyTo.id)}" title="Jump to the original">
      <span class="cq-who">${esc(m.replyTo.who)}</span><span class="cq-text">${esc(m.replyTo.text)}</span></div>` : '';
    return divider + `<div class="chat-msg${m.everyone ? ' chat-everyone' : ''}" data-mid="${esc(m.id)}">
      ${quote}
      <span class="chat-who">${esc(m.who)}</span>${(() => {
        const who = m.fafId && (T.players || []).find(p => p.fafId === m.fafId);
        return (who && who.discord) ? '<span class="chat-dc" title="' + esc(who.name) + ' on Discord">' + esc(who.discord) + '</span>' : '';
      })()}
      <span class="chat-time" title="${esc(full)}">${esc(time)}</span>
      <span class="chat-mod"><a href="#" data-chatreply="${esc(m.id)}" data-replywho="${esc(m.who)}" data-replytext="${esc(String(m.text || '').slice(0, 140))}" title="Reply to this message">reply</a>${org && m.fafId ? ` <a href="#" data-chatdel="${esc(m.id)}" title="Delete message">✕</a> <a href="#" data-chatmute="${esc(m.fafId)}" data-chatmutename="${esc(m.who)}" title="Mute ${esc(m.who)}">mute</a>` : ''}</span>
      <div class="chat-text">${highlightMentions(m.text)}</div>
    </div>`;
  }).join('') || '<div class="empty">No messages yet. Say hi, or type <code>!roll</code>.</div>';
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

// Build a chat panel into `host` for the given room. Reusable by the tab, the match popup and
// the pinned rail. Everything inside is addressed by CLASS, not id: two panels can be on screen
// at once and duplicate ids would have them fighting over the same nodes.
// opts: { pinned }      this panel IS the rail — offer a close X instead of a pin button
//       { closeOnPin }  pinning from here should dismiss the popup the panel sits in
async function mountChat(host, room, label, opts) {
  opts = opts || {};
  destroyChatIn(host);
  const inst = {
    host, room, label, pinned: !!opts.pinned,
    since: 0, msgs: [], replyTo: null, timer: null, dead: false,
    pollNow: () => {}
  };
  _chatInstances.add(inst);

  const headRight = inst.pinned
    ? `<span class="ch-actions">
         <button type="button" class="ch-icon" data-chatexpand title="Open this chat in the Chat tab">⤢</button>
         <button type="button" class="ch-icon ch-close" data-chatunpin title="Unpin and close this chat">✕</button>
       </span>`
    : (chatRoomPinnable(room)
        ? `<span class="ch-actions"><button type="button" class="chat-pin-btn" data-pinbtn="${esc(room)}">\u{1F4CC} Pin this chat on the right</button></span>`
        : '');

  host.innerHTML = `<div class="chat-panel${inst.pinned ? ' chat-panel-pinned' : ''}">
    <div class="chat-head">${inst.pinned ? '<span class="ch-pin-mark" title="Pinned chat">\u{1F4CC}</span>' : ''}<span class="ch-label" title="${esc(label)}">${esc(label)}</span>${headRight}</div>
    <div class="chat-log js-chatlog"><div class="empty">Loading…</div></div>
    <div class="chat-replybar js-replybar" style="display:none">
      <span class="crb-label">Replying to</span> <span class="crb-who js-replywho"></span>
      <span class="crb-text js-replytext"></span>
      <button type="button" class="crb-x js-replycancel" title="Cancel reply">×</button>
    </div>
    <div class="chat-input">
      <div class="chat-inwrap"><input type="text" class="js-chattext" maxlength="500" placeholder="${viewerIsOrganizer() ? 'Message… (@everyone to ping all entrants, @name to mention, !roll for 1–100)' : 'Message… (!roll for 1–100, !organizer to ping the organizers, @name to mention)'}" autocomplete="off"><div class="chat-mentions js-mentions" style="display:none"></div></div>
      <button class="btn primary small js-chatsend">Send</button>
      ${viewerIsOrganizer() ? '' : '<button class="btn ghost small js-chatping" title="Flags this chat for the organizers so they know you need help">🔔 Ping organizer</button>'}
    </div>
    <div class="muted small js-chatnote" style="margin-top:4px"></div>
  </div>`;
  const logEl = host.querySelector('.js-chatlog');
  const inp = host.querySelector('.js-chattext');
  const note = host.querySelector('.js-chatnote');

  // ---- pin / unpin controls in the header ----
  const pinBtn = host.querySelector('[data-pinbtn]');
  if (pinBtn) pinBtn.onclick = (e) => {
    e.preventDefault();
    if (_pinnedChat && _pinnedChat.room === room) { unpinChat(); return; }
    pinChat(room, label);
    if (opts.closeOnPin && _pinnedChat && _pinnedChat.room === room) { destroyChat(inst); closeModal(); }
  };
  const unpinBtn = host.querySelector('[data-chatunpin]');
  if (unpinBtn) unpinBtn.onclick = (e) => { e.preventDefault(); unpinChat(); };
  const expandBtn = host.querySelector('[data-chatexpand]');
  if (expandBtn) expandBtn.onclick = (e) => {
    e.preventDefault();
    // Only meaningful while the tournament page with a Chat tab is on screen.
    if (!document.querySelector('.tab[data-tab="chat"]')) { toast('The Chat tab isn’t open right now'); return; }
    _chatActiveRoom = room;
    currentTab = 'chat';
    syncTabURL();
    drawTournament();
  };

  const load = async (incremental) => {
    if (inst.dead) return;
    // The panel was torn out of the DOM (redraw, popup dismissed by Escape or a backdrop click).
    // Self-heal rather than polling forever against a detached node.
    if (!document.body.contains(host)) { destroyChat(inst); return; }
    try {
      const tok = viewToken();
      // Only the poll asks for what is newer than the last message; a full load asks for the
      // whole room. A full load used to send `since` too, got nothing back and emptied the
      // panel - which is what deleting (or muting) from it did.
      const since = incremental ? inst.since : 0;
      const r = await api('/api/t/' + T.id + '/chat_read?room=' + encodeURIComponent(room) + (since ? '&since=' + since : '') + (tok ? '&token=' + encodeURIComponent(tok) : ''));
      if (inst.dead) return;
      if (r.muted) note.textContent = 'You are muted by an organizer — you can read but not post.';
      // A message was deleted since this panel last loaded the room. The poll only ever sees
      // newer messages, so it would keep showing the deleted one: load the room again instead.
      if (incremental && r.rev !== undefined && inst.rev !== undefined && r.rev !== inst.rev) { await load(false); return; }
      if (r.rev !== undefined) inst.rev = r.rev;
      const incoming = r.messages || [];
      if (!incremental) {
        inst.msgs = incoming;
        inst.since = incoming.length ? incoming[incoming.length - 1].at : 0;
        renderChatMessages(logEl, inst.msgs);
      } else if (incoming.length) {
        inst.msgs = inst.msgs.concat(incoming);
        inst.since = inst.msgs[inst.msgs.length - 1].at;
        renderChatMessages(logEl, inst.msgs);
      }
      // Reading the room clears its unread server-side, but the badges come from the cached
      // tournament view, and the poll deliberately doesn't redraw while you're in chat. Clear
      // them locally so the marker disappears as you read instead of on the next tab switch.
      clearUnreadFor(room);
    } catch (e) {
      note.textContent = e.message;
      // Losing access (dropped from the team, caster role revoked, room gone) must not leave a
      // dead panel bolted to the screen. Anything else is a network blip: say so, keep the
      // panel up and let the next poll recover it.
      if (/no access/i.test(e.message || '')) {
        if (inst.pinned) unpinChat('Pinned chat closed — you no longer have access to it.');
        else destroyChat(inst);
      }
    }
  };
  await load(false);
  // Torn down while that first load was in flight (panel replaced, popup dismissed, access
  // lost). Stop here rather than wiring handlers and starting a timer on a dead instance.
  if (inst.dead) return inst;

  // ---- reply / quote ----
  const replyBar = host.querySelector('.js-replybar');
  const replyWho = host.querySelector('.js-replywho');
  const replyText = host.querySelector('.js-replytext');
  const clearReply = () => { inst.replyTo = null; if (replyBar) replyBar.style.display = 'none'; };
  const setReply = (id, who, text) => {
    inst.replyTo = id;
    if (replyWho) replyWho.textContent = who || '';
    if (replyText) replyText.textContent = text || '';
    if (replyBar) replyBar.style.display = '';
    inp.focus();
  };
  clearReply();
  const rc = host.querySelector('.js-replycancel');
  if (rc) rc.onclick = clearReply;
  // Escape cancels a reply before it does anything else.
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && inst.replyTo) { ev.stopPropagation(); clearReply(); }
  });

  const send = async () => {
    const text = inp.value.trim();
    if (!text) return;
    const replyTo = inst.replyTo;
    inp.value = '';
    try {
      await api('/api/t/' + T.id + '/chat_post', { room, text, replyTo: replyTo || undefined, token: viewToken() });
      clearReply();
      await load(true);
    } catch (e) { toast(e.message, true); inp.value = text; }
  };
  host.querySelector('.js-chatsend').onclick = send;

  // ---- @mention autocomplete (Discord-style) ----
  // Suggest from everyone signed up (players) plus team names, deduped. Typing "@" opens the
  // list; more letters filter it. Enter/Tab/click completes the current highlight.
  const mentionBox = host.querySelector('.js-mentions');
  const nameList = (() => {
    const set = new Map();
    // Organizers only: @everyone pings every signed-up account. Offered first so it is easy to
    // reach, and simply absent for anyone who isn't allowed to use it.
    if (viewerIsOrganizer()) set.set('everyone', 'everyone');
    for (const p of (T.players || [])) if (p && p.name) set.set(p.name.toLowerCase(), p.name);
    for (const tm of (T.teams || [])) if (tm && tm.name) set.set(tm.name.toLowerCase(), tm.name);
    return Array.from(set.values());
  })();
  let mMatches = [], mSel = 0, mStart = -1;

  const closeMentions = () => { mentionBox.style.display = 'none'; mMatches = []; mStart = -1; };
  const renderMentions = () => {
    if (!mMatches.length) { closeMentions(); return; }
    mentionBox.innerHTML = mMatches.map((nm, i) =>
      `<div class="chat-mention${i === mSel ? ' on' : ''}" data-mi="${i}">${esc(nm)}</div>`).join('');
    mentionBox.style.display = '';
    mentionBox.querySelectorAll('[data-mi]').forEach(d => {
      d.onmousedown = (ev) => { ev.preventDefault(); applyMention(+d.dataset.mi); };
    });
  };
  const applyMention = (i) => {
    const nm = mMatches[i];
    if (nm == null || mStart < 0) return;
    const before = inp.value.slice(0, mStart);
    const after = inp.value.slice(inp.selectionStart);
    // wrap names with spaces in the mention so it reads as one token
    const token = '@' + nm + ' ';
    inp.value = before + token + after;
    const pos = (before + token).length;
    inp.setSelectionRange(pos, pos);
    closeMentions();
    inp.focus();
  };
  const updateMentions = () => {
    const pos = inp.selectionStart;
    const upto = inp.value.slice(0, pos);
    // find the last "@" that starts a word and has no space since
    const at = upto.lastIndexOf('@');
    if (at < 0 || (at > 0 && !/\s/.test(upto[at - 1]))) { closeMentions(); return; }
    const frag = upto.slice(at + 1);
    if (/\s/.test(frag)) { closeMentions(); return; }   // already ended the mention
    mStart = at;
    const q = frag.toLowerCase();
    mMatches = nameList.filter(nm => nm.toLowerCase().includes(q)).slice(0, 8);
    mSel = 0;
    renderMentions();
  };
  inp.addEventListener('input', updateMentions);
  inp.addEventListener('click', updateMentions);

  inp.onkeydown = (e) => {
    if (mMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mSel = (mSel + 1) % mMatches.length; renderMentions(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mSel = (mSel - 1 + mMatches.length) % mMatches.length; renderMentions(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(mSel); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMentions(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  };
  inp.addEventListener('blur', () => setTimeout(closeMentions, 120));
  const pingBtn = host.querySelector('.js-chatping');
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
    const rep = e.target.closest('[data-chatreply]');
    const jump = e.target.closest('[data-jump]');
    if (rep) {
      e.preventDefault();
      setReply(rep.dataset.chatreply, rep.dataset.replywho, rep.dataset.replytext);
      return;
    }
    if (jump) {
      // Scroll the quoted original into view and flash it, if it is still in the loaded history.
      const target = logEl.querySelector('[data-mid="' + jump.dataset.jump.replace(/"/g, '') + '"]');
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('chat-flash');
        setTimeout(() => target.classList.remove('chat-flash'), 1200);
      } else { toast('That message is no longer in the loaded history'); }
      return;
    }
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

  inst.pollNow = () => { if (!inst.dead) load(true); };
  inst.timer = setInterval(() => {
    if (inst.dead) { clearInterval(inst.timer); return; }
    if (!document.body.contains(host)) { destroyChat(inst); return; }   // panel is gone
    // The rail is the only panel that outlives a redraw, so it is also the one that has to keep
    // checking whether it still has any business being on screen.
    if (inst.pinned) syncPinnedChat();
    if (document.hidden) return;                       // tab in the background
    load(true);
  }, 3500);
  refreshPinButtons();
  return inst;
}

async function drawChatTab(el) {
  stopChatPoll();
  el.innerHTML = '<div class="panel section"><div class="empty">Loading chats…</div></div>';
  let data;
  try { data = await chatRooms(); } catch (e) { el.innerHTML = '<div class="panel section"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const rooms = data.rooms || [];
  if (!rooms.length) { el.innerHTML = '<div class="panel section"><div class="empty">No chats available to you yet.</div></div>'; return; }
  // organizers listed one per row, with their Discord handle where they've set one
  const orgs = (T.organizersPublic || []).map(o => (typeof o === 'string' ? { name: o, discord: '' } : o));
  const orgLine = orgs.length
    ? `<div class="org-callout">
      <div class="org-callout-title">Organizer${orgs.length === 1 ? '' : 's'}</div>
      <div class="org-callout-list">${orgs.map(o => `<div class="org-row">
        ${o.discord
          ? '<span class="org-idpair"><span class="org-name">' + esc(o.name) + '</span><span class="org-discord" title="' + esc(o.name) + ' on Discord">' + esc(o.discord) + '</span></span>'
          : '<span class="org-name">' + esc(o.name) + '</span><span class="muted small">no Discord listed</span>'}
      </div>`).join('')}</div>
      <div class="org-callout-hint">Type <code>!organizer</code> or press 🔔 to ping them in that chat.</div>
    </div>`
    : '';

  // Before the bracket starts, organizers often aren't watching chat - say so up front.
  const preStartNote = (T.status === 'signup')
    ? `<div class="panel section chat-prestart">
        <strong>Organizers may not be around before the tournament starts.</strong>
        <p class="muted small" style="margin:6px 0 0">Chat here is mostly between players until the event begins. If you need something answered sooner, message an organizer on Discord${orgs.some(o => o.discord) ? ' (' + orgs.filter(o => o.discord).map(o => esc(o.discord)).join(', ') + ')' : ''}.</p>
      </div>`
    : '';
  // A room and, beside it, a pin toggle. The pin is a SIBLING of the room button, not a child:
  // nesting a button inside a button is invalid and swallows the click. Completed rooms get no
  // pin at all — there is nothing live left to follow.
  const roomBtn = (r) => {
    const badges = [];
    if (r.mention) badges.push('<span class="chat-mention-badge">1</span>');       // you were @mentioned
    else if (r.unread) badges.push('<span class="unread-dot">' + (r.unread > 9 ? '9+' : r.unread) + '</span>');
    if (r.ping && viewerIsOrganizer()) badges.push('🔔');                  // organizer attention
    const cnt = r.count ? ' <span class="muted small">(' + r.count + ')</span>' : '';
    const pin = r.done ? '' : `<button type="button" class="chat-pin-mini" data-pinroom="${esc(r.id)}" data-pinlabel="${esc(r.label)}" title="Pin this chat on the right">\u{1F4CC}</button>`;
    return `<div class="chat-room-row">
      <button class="chat-room ${r.mention ? 'mentioned' : ''} ${r.ping && viewerIsOrganizer() ? 'pinged' : ''}" data-room="${esc(r.id)}" data-label="${esc(r.label)}">${badges.length ? '<span class="chat-room-badges">' + badges.join(' ') + '</span> ' : ''}${esc(r.label)}${cnt}</button>
      ${pin}
    </div>`;
  };
  const active = rooms.filter(r => !r.done);
  const completed = rooms.filter(r => r.done);
  // any completed room the viewer was @mentioned in should surface the group even when collapsed
  const completedMention = completed.some(r => r.mention);
  const listHtml = active.map(roomBtn).join('')
    + (completed.length
        ? `<button class="chat-room-group chat-group-toggle ${_chatCompletedOpen ? 'open' : ''}" id="chatCompletedToggle">
             <span class="cg-caret">${_chatCompletedOpen ? '▾' : '▸'}</span> Completed matches <span class="muted small">(${completed.length})</span>${completedMention && !_chatCompletedOpen ? ' <span class="chat-mention-badge">!</span>' : ''}
           </button>
           <div class="chat-completed" id="chatCompletedWrap" style="display:${_chatCompletedOpen ? '' : 'none'}">${completed.map(roomBtn).join('')}</div>`
        : '');
  el.innerHTML = preStartNote + `<div class="chat-layout">
    <div class="chat-rooms panel section">
      <h2>Chats</h2>
      ${orgLine}
      ${data.muted ? '<div class="warn small" style="margin-bottom:8px">You are muted.</div>' : ''}
      <div class="chat-roomlist">${listHtml}</div>
      <p class="muted small chat-pin-hint">\u{1F4CC} keeps a chat open on the right while you browse the bracket, matches and vetoes. One at a time.</p>
    </div>
    <div class="chat-host" id="chatHost"></div>
  </div>`;
  const host = el.querySelector('#chatHost');
  const pick = (btn) => {
    if (!btn) return;
    _chatActiveRoom = btn.dataset.room;
    el.querySelectorAll('.chat-room').forEach(b => b.classList.toggle('active', b === btn));
    mountChat(host, btn.dataset.room, btn.dataset.label);
  };
  el.querySelectorAll('.chat-room').forEach(b => b.onclick = () => pick(b));
  el.querySelectorAll('[data-pinroom]').forEach(b => b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (_pinnedChat && _pinnedChat.room === b.dataset.pinroom) unpinChat();
    else pinChat(b.dataset.pinroom, b.dataset.pinlabel);
  });
  const cToggle = el.querySelector('#chatCompletedToggle');
  if (cToggle) cToggle.onclick = () => {
    _chatCompletedOpen = !_chatCompletedOpen;
    const wrap = el.querySelector('#chatCompletedWrap');
    if (wrap) wrap.style.display = _chatCompletedOpen ? '' : 'none';
    cToggle.classList.toggle('open', _chatCompletedOpen);
    const caret = cToggle.querySelector('.cg-caret');
    if (caret) caret.textContent = _chatCompletedOpen ? '▾' : '▸';
  };
  // Re-select the room the user was already in (if it still exists), not always Global — a
  // background refresh must not yank them back to the global chat.
  const prev = _chatActiveRoom && el.querySelector('.chat-room[data-room="' + (window.CSS && CSS.escape ? CSS.escape(_chatActiveRoom) : _chatActiveRoom) + '"]');
  pick(prev || el.querySelector('.chat-room'));
  refreshPinButtons();
}

function openMatchChat(m) {
  const label = mLabelFull(m) + ' - ' + teamName(m.team1) + ' vs ' + teamName(m.team2);
  const room = 'match:' + m.id;
  modal(`<h3>Match chat</h3><div id="mcHost" class="chat-compact"></div>
    <div class="actions"><button class="btn ghost" id="mcClose">Close</button></div>`, root => {
    const mcHost = root.querySelector('#mcHost');
    root.querySelector('#mcClose').onclick = () => { destroyChatIn(mcHost); closeModal(); };
    // Pinning from the popup puts the chat on the right, so the popup has done its job.
    mountChat(mcHost, room, label, { closeOnPin: true });
  }, { mid: true });
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
  // A pinned chat belongs to one tournament. Leaving it (home, series, another event) closes
  // the rail before the new page draws, so it can never hang around over unrelated content.
  syncPinnedChat();
  if (location.pathname === '/series') renderSeriesIndex();
  else if (location.pathname.startsWith('/series/')) renderSeries(location.pathname.slice(8));
  else if (location.pathname === '/host') renderHost();
  else if (location.pathname === '/siteadmin') renderSiteAdmin();
  else if (location.pathname === '/editor') renderEditor();
  else if (location.pathname === '/importer') renderImporter();
  else if (location.pathname === '/hall') renderHall();
  else if (location.pathname === '/faq') renderFaq();
  else if (tourneyId()) renderTournament();
  else renderHome();
  refreshPending();
}

// Hall of Fame: players only - a team's win counts for each of its players. Searchable by name or
// FAF id, 100 to a page. The search and page live in the address (/hall?q=&page=) so a result can
// be linked; the server does the filtering and paging.
let _hofTimer = null;
async function renderHall() {
  setTitle('Hall of Fame');
  drawTopbar('');
  const app = document.getElementById('app');
  const qs = new URLSearchParams(location.search);
  const q0 = qs.get('q') || '';
  app.innerHTML = `<div class="page"><h1 style="margin:0 0 14px">Hall of Fame</h1>
    <div class="panel section">
      <div class="hof-search"><input type="text" id="hofQ" placeholder="Search a player by name or FAF id" maxlength="60" autocomplete="off" value="${esc(q0)}"></div>
      <div id="hofBody"><div class="empty">Loading\u2026</div></div>
    </div></div>`;
  const inp = document.getElementById('hofQ');
  inp.oninput = () => {
    clearTimeout(_hofTimer);
    _hofTimer = setTimeout(() => loadHall(inp.value.trim(), 1), 250);
  };
  await loadHall(q0, parseInt(qs.get('page'), 10) || 1);
}
async function loadHall(q, page) {
  const body = document.getElementById('hofBody');
  if (!body) return;
  let data;
  try {
    const r = await fetch('/api/halloffame?q=' + encodeURIComponent(q || '') + '&page=' + (page || 1));
    data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load');
  } catch (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
  // keep the address in step, without adding a history entry per keystroke
  if (location.pathname === '/hall') {
    const p = new URLSearchParams();
    if (data.q) p.set('q', data.q);
    if (data.page > 1) p.set('page', String(data.page));
    history.replaceState(null, '', '/hall' + (p.toString() ? '?' + p.toString() : ''));
  }
  const players = data.players || [];
  if (!data.all) { body.innerHTML = '<div class="empty">No results yet - win a tournament to get on the board.</div>'; return; }
  const count = data.q
    ? '<p class="muted small" style="margin:0 0 8px">' + data.total + ' of ' + data.all + ' players match</p>'
    : '<p class="muted small" style="margin:0 0 8px">' + data.all + ' players, by championships</p>';
  if (!players.length) { body.innerHTML = count + '<div class="empty">No player matches \u201c' + esc(data.q) + '\u201d.</div>'; return; }
  const pager = data.pages > 1 ? `<div class="hof-pager">
      <button class="btn ghost small" data-hofpage="${data.page - 1}"${data.page <= 1 ? ' disabled' : ''}>\u2039 Previous</button>
      <span class="muted small">Page ${data.page} of ${data.pages}</span>
      <button class="btn ghost small" data-hofpage="${data.page + 1}"${data.page >= data.pages ? ' disabled' : ''}>Next \u203a</button>
    </div>` : '';
  body.innerHTML = count + '<table><thead><tr><th>#</th><th>Player</th><th>Wins</th><th>Entered</th></tr></thead><tbody>' +
    players.map(p => `<tr><td class="muted">${p.rank}</td><td>${esc(p.name)}</td><td class="mono">${p.wins}</td><td class="mono muted">${p.entered}</td></tr>`).join('') +
    '</tbody></table>' + pager;
  body.querySelectorAll('[data-hofpage]').forEach(b => b.onclick = () => {
    loadHall(data.q, parseInt(b.dataset.hofpage, 10) || 1);
    try { window.scrollTo(0, 0); } catch (e) {}
  });
}

async function renderFaq() {
  setTitle('FAQ / Rules');
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">FAQ / Rules</h1><div id="faqBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let arts;
  try { const r = await fetch('/api/articles'); arts = await r.json(); if (!r.ok) throw new Error('Failed to load'); }
  catch (e) { document.getElementById('faqBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  const body = document.getElementById('faqBody');
  if (!arts.length) {
    body.innerHTML = '<div class="panel"><div class="empty">Nothing here yet.' + (siteAdmin() ? ' Add articles from the site-admin console (Articles tab).' : '') + '</div></div>';
    return;
  }
  const childrenOf = (id) => arts.filter(a => a.parentId === id);
  const topLevel = arts.filter(a => !a.parentId);

  // ?p=<id> opens a single sub-page (or a parent) with a back link
  const wanted = new URLSearchParams(location.search).get('p');
  const focus = wanted ? arts.find(a => a.id === wanted) : null;
  if (focus) {
    const kids = childrenOf(focus.id);
    let h = `<div class="panel section"><a href="/faq" class="muted small">\u2190 Back to FAQ / Rules</a>
      <h2 style="margin-top:8px">${esc(focus.title)}</h2>
      <div class="ic-body" style="margin-top:8px">${renderArticleBody(focus.body)}</div></div>`;
    if (kids.length) h += '<div class="panel section"><h2>Sub-pages</h2><div class="faq-sublinks">' +
      kids.map(k => `<a class="faq-sublink" href="/faq?p=${encodeURIComponent(k.id)}">${esc(k.title)} \u2192</a>`).join('') + '</div></div>';
    body.innerHTML = h;
    return;
  }

  // main page: each top-level article, with links to its sub-pages beneath it
  body.innerHTML = topLevel.map(a => {
    const kids = childrenOf(a.id);
    const sub = kids.length
      ? '<div class="faq-sublinks" style="margin-top:12px">' + kids.map(k => `<a class="faq-sublink" href="/faq?p=${encodeURIComponent(k.id)}">${esc(k.title)} \u2192</a>`).join('') + '</div>'
      : '';
    return `<div class="panel section"><h2>${esc(a.title)}</h2><div class="ic-body" style="margin-top:8px">${renderArticleBody(a.body)}</div>${sub}</div>`;
  }).join('');
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

// ---------------------------------------------------------------------------
// Stats tab — a public wrap-up shown once a tournament is finished. Everything
// here is derived from data players can already see (bracket results, rosters,
// maps played). Ban statistics stay on the organiser-only Vetoes panel.
// ---------------------------------------------------------------------------
function drawStats(el) {
  const done = (T.matches || []).filter(m => m.status === 'done' && m.bracket !== 'ffa');
  const teams = T.teams || [];
  const players = T.players || [];

  // games actually played: negative scores are the forfeit sentinel, not games. A walkover
  // (no-score forfeit) awards the winner maxW without anyone playing, so it contributes nothing.
  let games = 0, forfeits = 0, decidedByFf = 0;
  for (const m of done) {
    const walkover = !!m.forfeit && ((m.score1 != null && m.score1 < 0) || (m.score2 != null && m.score2 < 0));
    if (m.forfeit) { forfeits++; if (walkover) decidedByFf++; }
    if (walkover) continue;
    const a = (m.score1 != null && m.score1 > 0) ? m.score1 : 0;
    const b = (m.score2 != null && m.score2 > 0) ? m.score2 : 0;
    games += a + b;
  }

  // maps actually played, from completed vetoes (picks + decider) and direct round maps
  const playCount = {};
  for (const m of done) {
    const v = m.veto;
    if (!v) continue;
    for (const pk of (v.picks || [])) if (pk.map) playCount[pk.map] = (playCount[pk.map] || 0) + 1;
    if (v.decider && v.decider.map) playCount[v.decider.map] = (playCount[v.decider.map] || 0) + 1;
  }
  const mapIds = Object.keys(playCount);
  const topMaps = mapIds.slice().sort((a, b) => playCount[b] - playCount[a]).slice(0, 10);

  // ratings
  const rated = players.filter(p => p.rating != null);
  const avgRating = rated.length ? Math.round(rated.reduce((s, p) => s + p.rating, 0) / rated.length) : null;
  const fullTeams = teams.filter(t => (t.playerIds || []).length);
  const teamTotals = fullTeams.map(t => ({ t, r: teamRating(t) })).sort((a, b) => b.r - a.r);

  // (the old "longest series" panel was removed: with several series tied on length it silently
  // showed just one of them, which read as if it were the only one)
  let longest = null, longestN = 0;
  for (const m of done) {
    const n = ((m.score1 > 0 ? m.score1 : 0) + (m.score2 > 0 ? m.score2 : 0));
    if (n > longestN) { longestN = n; longest = m; }
  }
  const vetoesDone = done.filter(m => m.veto && m.veto.done).length;
  const champ = T.championTeamId ? teamName(T.championTeamId) : null;
  const solo = T.teamSize === 1 || T.formation === 'solo';

  const card = (label, value, sub) => `<div class="st-card">
      <div class="st-val">${value}</div>
      <div class="st-lbl">${esc(label)}</div>
      ${sub ? '<div class="st-sub muted small">' + sub + '</div>' : ''}
    </div>`;

  let html = '';
  if (divisionsOnT()) {
    for (let d = 1; d <= T.divisions; d++) {
      const c = divisionChampionOf(d);
      if (c) html += `<div class="panel section st-champ"><div class="st-champ-lbl">${esc(divisionNameOf(d))} champion</div><h1 style="margin:4px 0 0">${esc(teamName(c))}</h1></div>`;
    }
  } else if (champ) {
    html += `<div class="panel section st-champ"><div class="st-champ-lbl">Champion</div><h1 style="margin:4px 0 0">${esc(champ)}</h1></div>`;
  }

  // Everyone who signed up, versus everyone who actually ended up on a team that played. In a
  // team event those differ whenever people sign up solo and never find a team, and conflating
  // them under one "Players" number was misleading.
  const onTeams = players.filter(p => p.teamId && fullTeams.some(tm => tm.id === p.teamId)).length;
  const avgSub = avgRating != null ? 'avg rating ' + avgRating + ' across ' + rated.length + ' rated' : '';

  html += '<div class="panel section"><h2>By the numbers</h2><div class="st-grid">';
  html += card(solo ? 'Individual signups' : 'Individual signups', players.length, avgSub);
  if (!solo) html += card('Players in teams', onTeams, 'actually played in the event');
  if (!solo) html += card('Teams', fullTeams.length);
  html += card('Series played', done.length);
  html += card('Games played', games, 'individual games across all series');
  if ((T.mapDb || []).length) html += card('Maps in the tournament', (T.mapDb || []).length);
  if (mapIds.length) html += card('Different maps played', mapIds.length);
  if (vetoesDone) html += card('Vetoes completed', vetoesDone);
  if (forfeits) html += card('Forfeits', forfeits, decidedByFf ? decidedByFf + ' with no games played' : '');
  html += '</div></div>';

  // podium / final standings, if the bracket produced them
  if (!solo && teamTotals.length) {
    html += `<div class="panel section"><h2>Team ratings</h2><div class="st-list">` +
      teamTotals.slice(0, 8).map((x, i) => `<div class="st-row">
        <span class="st-rank">${i + 1}</span>
        <span class="st-name">${esc(x.t.name)}</span>
        <span class="st-num mono">${x.r}</span></div>`).join('') +
      `</div><p class="muted small" style="margin-top:8px">Combined rating of each team's roster.</p></div>`;
  }

  // Map usage: every map that was available in this tournament, with how many times it was
  // actually played. Unplayed maps are listed too — "which maps never came up" is as interesting
  // as which ones did.
  const dbMaps = (T.mapDb || []).slice();
  if (dbMaps.length || mapIds.length) {
    // include any played map that is no longer in the database, so counts always add up
    const known = {};
    for (const m2 of dbMaps) known[m2.id] = m2.name;
    for (const id of mapIds) if (!known[id]) known[id] = mapName(id);
    const allIds = Object.keys(known);
    const playedIds = allIds.filter(id => playCount[id]);
    const unplayed = allIds.length - playedIds.length;
    const max = playedIds.length ? Math.max.apply(null, playedIds.map(id => playCount[id])) : 1;

    // distribution: how many maps were played N times
    const buckets = {};
    for (const id of allIds) { const n = playCount[id] || 0; buckets[n] = (buckets[n] || 0) + 1; }
    const bucketLine = Object.keys(buckets).map(Number).sort((a, b) => b - a).map(n =>
      buckets[n] + ' map' + (buckets[n] === 1 ? '' : 's') + ' ' + (n === 0 ? 'never played' : 'played ' + n + '\u00d7')
    ).join(' \u00b7 ');

    const sorted = allIds.sort((a, b) => (playCount[b] || 0) - (playCount[a] || 0) || String(known[a]).localeCompare(String(known[b])));
    html += `<div class="panel section"><h2>Map usage</h2>
      <p class="muted small" style="margin:-4px 0 10px"><strong>${allIds.length}</strong> map${allIds.length === 1 ? '' : 's'} available \u00b7 <strong>${playedIds.length}</strong> played \u00b7 <strong>${unplayed}</strong> never played<br>${esc(bucketLine)}</p>
      <div class="st-list">` +
      sorted.map(id => {
        const n = playCount[id] || 0;
        return `<div class="st-row${n ? '' : ' st-unused'}">
          <span class="st-name">${esc(known[id])}</span>
          <span class="st-bar"><span class="st-fill" style="width:${n ? Math.max(4, n / max * 100) : 0}%"></span></span>
          <span class="st-num mono">${n || '\u2014'}</span></div>`;
      }).join('') +
      `</div></div>`;
  }

  el.innerHTML = html || '<div class="panel"><div class="empty">No statistics available.</div></div>';
}

// ---------------------------------------------------------------------------
// Tournament series — a grouping label only. Editions are independent events
// that happen to share a name; there is no qualification between them.
// ---------------------------------------------------------------------------
async function renderSeriesIndex() {
  setTitle('Series');
  stopPoll();
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><h1 style="margin:0 0 14px">Tournament series</h1><div id="srBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/series'); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('srBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>'; return; }
  // creating a series needs tournament-hosting permission (which already includes admins/directors)
  const canEdit = !!(fafAuth.user && (fafAuth.user.allowed || fafAuth.user.siteAdmin || fafAuth.user.director));
  const list = data.series || [];
  let html = '';
  if (canEdit) {
    html += `<div class="panel section"><h2>New series</h2>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <input type="text" id="srName" placeholder="Series name (e.g. Monthly Blitz)" style="flex:1;min-width:220px">
        <button class="btn primary" id="srCreate">Create</button>
      </div>
      <p class="muted small" style="margin-top:8px">A series just groups editions together for browsing. Anyone who can host a tournament can create one; organizers attach their tournament to a series from its Admin tab. Only the creator (or a director / site admin) can rename or delete a series.</p></div>`;
  }
  const officialOnly = _srOfficialOnly;
  const shown = officialOnly ? list.filter(x => x.category === 'official') : list;
  const active = shown.filter(x => (x.activeCount || 0) > 0);
  const dormant = shown.filter(x => !(x.activeCount || 0));   // already newest-first from the server

  const row = (s) => `<a class="sr-item" href="/series/${esc(s.id)}" data-link>
      <div class="sr-item-main">
      <div class="sr-name c-${esc(s.color || 'amber')}">${esc(s.name)}${s.category ? ' <span class="idbadge ' + (s.category === 'official' ? 'verified' : 'late') + '">' + esc(s.category.toUpperCase()) + '</span>' : ''}</div>
      ${s.description ? '<div class="muted small sr-summary">' + esc(stripMd(s.description)) + '</div>' : ''}
      ${s.latestName ? '<div class="muted small">Latest: ' + esc(s.latestName) + (s.latestDate ? ' \u00b7 ' + esc(fmtDate(s.latestDate)) : '') + '</div>' : ''}</div>
      <span class="sr-right">
        ${(s.activeCount || 0) > 0 ? '<span class="sr-live">' + s.activeCount + ' running</span>' : ''}
        <span class="sr-count">${s.editions} edition${s.editions === 1 ? '' : 's'}</span>
      </span>
    </a>`;

  html += `<div class="panel section">
    <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <h2 style="margin:0">Series <span class="h2-strong">(${shown.length}${officialOnly ? ' of ' + list.length : ''})</span></h2>
      <label class="sr-filter"><input type="checkbox" id="srOfficial"${officialOnly ? ' checked' : ''}> Official only</label>
    </div>`;
  if (!shown.length) {
    html += '<div class="empty">' + (officialOnly && list.length ? 'No official series yet.' : 'No series yet.') + '</div>';
  } else {
    if (active.length) html += '<div class="sr-group">Running now</div><div class="sr-list">' + active.map(row).join('') + '</div>';
    if (dormant.length) html += '<div class="sr-group"' + (active.length ? ' style="margin-top:16px"' : '') + '>Nothing scheduled \u2014 most recent first</div><div class="sr-list">' + dormant.map(row).join('') + '</div>';
  }
  html += '</div>';
  document.getElementById('srBody').innerHTML = html;
  wireSeriesLinks();
  { const of = document.getElementById('srOfficial');
    if (of) of.onchange = () => { _srOfficialOnly = of.checked; renderSeriesIndex(); }; }
  const c = document.getElementById('srCreate');
  if (c) c.onclick = async () => {
    const name = (document.getElementById('srName').value || '').trim();
    if (!name) return toast('Enter a series name', true);
    try { await api('/api/series', { action: 'create', name }); toast('Series created'); renderSeriesIndex(); }
    catch (e) { toast(e.message, true); }
  };
}

async function renderSeries(id) {
  stopPoll();
  drawTopbar('');
  const app = document.getElementById('app');
  app.innerHTML = '<div class="page"><div id="srBody"><div class="panel"><div class="empty">Loading…</div></div></div></div>';
  let data;
  try { const r = await fetch('/api/series/' + encodeURIComponent(id)); data = await r.json(); if (!r.ok) throw new Error(data.error || 'Failed to load'); }
  catch (e) { document.getElementById('srBody').innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div><p><a href="/series" data-link>← All series</a></p></div>'; return; }
  const s = data.series, eds = data.editions || [];
  setTitle(s.name);
  const done = eds.filter(e => e.status === 'finished' && !e.abandoned);
  let html = `<p class="muted small" style="margin:0 0 6px"><a href="/series" data-link>← All series</a></p>
    <h1 class="sr-title c-${esc(s.color || 'amber')}" style="margin:0 0 4px">${esc(s.name)}${s.category ? ' <span class="idbadge ' + (s.category === 'official' ? 'verified' : 'late') + '" style="vertical-align:middle">' + esc(s.category.toUpperCase()) + '</span>' : ''}</h1>
    ${s.description ? '<div class="ic-body series-desc">' + renderArticleBody(s.description) + '</div>' : '<div style="height:10px"></div>'}
    <div class="panel section"><h2>Editions <span class="h2-strong">(${eds.length})</span></h2>`;
  if (!eds.length) html += '<div class="empty">No tournaments in this series yet.</div>';
  else html += '<div class="sr-eds">' + eds.map(e => {
    const kind = e.competition === 'ffa' ? 'FFA' : (e.teamSize + 'v' + e.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[e.bracketType] || ''));
    // statusPillLabel/Class, not statusLabel(e.status): `status` is 'signup' from creation, so
    // building the pill by hand here claimed "Signups open" on editions that had not opened yet.
    return `<a class="sr-ed" href="/t/${esc(e.id)}" data-link>
      <div class="sr-ed-main">
        <div class="sr-ed-name">${esc(e.name)}${e.published === 0 ? (e.canManage === 0
          ? ' <span class="idbadge late" title="Someone else\u2019s draft. Visible to you as a tournament director; you have no organizer rights on it.">draft \u00b7 view only</span>'
          : ' <span class="idbadge late" title="Draft \u2014 not public yet">draft</span>') : ''}</div>
        <div class="muted small">${esc(kind)}${e.eventDate ? ' \u00b7 ' + esc(fmtDate(e.eventDate)) : ''}${eventDaysLabel(e) ? ' <span class="tdays" title="Runs on ' + esc(eventDaysLabel(e)) + '">' + esc(eventDaysCountLabel(e)) + '</span>' : ''}${e.champion ? ' \u00b7 winner: ' + esc(e.champion) : ''}</div>
      </div>
      <span class="pill ${statusPillClass(e)}"${signupsNotOpenYet(e) ? ' title="Signups open ' + esc(fmtDateTime(e.signupOpensAt)) + '"' : ''}>${esc(statusPillLabel(e))}</span>
    </a>`;
  }).join('') + '</div>';
  html += '</div>';
  if (done.length) {
    const wins = {};
    for (const e of done) if (e.champion) wins[e.champion] = (wins[e.champion] || 0) + 1;
    const ranked = Object.keys(wins).sort((a, b) => wins[b] - wins[a]);
    if (ranked.length) {
      html += '<div class="panel section"><h2>Series winners</h2><div class="st-list">' +
        ranked.map((n, i) => `<div class="st-row"><span class="st-rank">${i + 1}</span><span class="st-name">${esc(n)}</span><span class="st-num mono">${wins[n]}</span></div>`).join('') +
        '</div></div>';
    }
  }
  if (data.canEdit) html += '<div class="panel section" id="srBanHost"></div>';
  if (data.canEdit) {
    html += `<div class="panel section"><h2>Manage</h2>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:200px"><label>Name</label><input type="text" id="srEdName" value="${esc(s.name)}"></div>
      </div>
      <label style="margin-top:10px">Type</label>
      <select id="srEdCat">
        <option value=""${!s.category ? ' selected' : ''}>\u2014 unset \u2014</option>
        <option value="official"${s.category === 'official' ? ' selected' : ''}>Official</option>
        <option value="community"${s.category === 'community' ? ' selected' : ''}>Community</option>
      </select>
      <label style="margin-top:10px">Name colour</label>
      <div class="sr-swatches" id="srColors">
        ${['amber','blue','green','red','purple','plain'].map(c =>
          `<button type="button" class="sr-swatch c-${c}${(s.color || 'amber') === c ? ' on' : ''}" data-srcolor="${c}" title="${c}">Aa</button>`).join('')}
      </div>
      <label style="margin-top:10px">Description</label>
      ${mdToolbarHTML()}
      <textarea id="srEdDesc" rows="10">${esc(s.description || '')}</textarea>
      <div class="actions"><button class="btn ghost" id="srDel">Delete series</button><button class="btn primary" id="srSave">Save</button></div>
      <p class="muted small">Deleting a series does not delete its tournaments — they simply stop being grouped.</p></div>`;
  }
  document.getElementById('srBody').innerHTML = html;
  wireSeriesLinks();
  // Series bans: the same record as a global ban, scoped to every edition of this series - the
  // natural unit when someone keeps turning up to a recurring event they were thrown out of.
  {
    const host = document.getElementById('srBanHost');
    if (host) {
      banPanel(host, {
        title: 'Banned from this series',
        blurb: 'These accounts can\u2019t sign up, be added or be invited to <strong>any tournament in this series</strong>, including future editions. Set an expiry or leave it open-ended. Organizers can also ban from a single tournament; only a site admin or tournament director can ban from official tournaments site-wide.',
        bans: data.bans || [],
        lookup: { seriesId: s.id },
        addLabel: 'Ban from this series',
        onSet: (r) => api('/api/series', Object.assign({ action: 'ban_set', id: s.id }, r)),
        onRemove: (fid) => api('/api/series', { action: 'ban_remove', id: s.id, fafId: fid }),
        after: () => renderSeries(s.id)
      });
    }
  }
  let srColor = s.color || 'amber';
  document.querySelectorAll('[data-srcolor]').forEach(b => b.onclick = () => {
    srColor = b.dataset.srcolor;
    document.querySelectorAll('[data-srcolor]').forEach(x => x.classList.toggle('on', x === b));
    const h1 = document.querySelector('.sr-title');
    if (h1) h1.className = 'sr-title c-' + srColor;   // live preview
  });
  const sv = document.getElementById('srSave');
  if (sv) sv.onclick = async () => {
    try {
      await api('/api/series', { action: 'update', id: s.id, name: document.getElementById('srEdName').value, description: document.getElementById('srEdDesc').value, color: srColor, category: document.getElementById('srEdCat').value });
      toast('Saved'); renderSeries(s.id);
    } catch (e) { toast(e.message, true); }
  };
  const dl = document.getElementById('srDel');
  if (dl) dl.onclick = async () => {
    if (!confirm('Delete the series "' + s.name + '"? Its tournaments stay, they just lose the grouping.')) return;
    try { await api('/api/series', { action: 'delete', id: s.id }); toast('Series deleted'); nav('/series'); }
    catch (e) { toast(e.message, true); }
  };
}

// intercept in-app links so series pages don't do a full page load
function wireSeriesLinks() {
  document.querySelectorAll('[data-link]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    nav(a.getAttribute('href'));
  });
}
