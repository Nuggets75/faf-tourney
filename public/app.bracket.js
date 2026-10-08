// ----- bracket / rounds -----

function mapRows(maps) {
  return maps.map((id, i) => '<div class="maprow"><span class="mapg">GAME ' + (i + 1) + '</span><span>' + esc(mapName(id)) + '</span></div>').join('');
}

// Popup showing a pool's maps as thumbnails — a cutout of the Maps-tab pool card, used when a
// round's pool has too many maps to list inline in the bracket.
function showPoolPopup(pool) {
  if (!pool) return;
  const ids = pool.mapIds || [];
  const bo = pool.bo || 1;
  const thumbs = ids.map(id => {
    const mo = mapObj(id);
    if (!mo) return '';
    return `<div class="pool-thumb${mo.image ? '' : ' noimg'}"${mo.image ? ' data-map-info="' + esc(id) + '"' : ''}>
      ${mo.image ? `<img src="/map-images/${esc(mo.image)}" alt="${esc(mo.name)}" loading="lazy">` : '<span class="pool-thumb-noimg">' + mapNoImgLabel(mo) + '</span>'}
      <span class="pool-thumb-name">${esc(mo.name)}</span>
    </div>`;
  }).join('');
  // Spell out exactly how the veto will run, in plain order, so captains aren't seeing the
  // sequence for the first time when it is their turn to act.
  const seq = (pool.sequence || []);
  const vetoPlan = (() => {
    if (!(T.veto && T.veto.enabled)) return '<p class="muted small">Map vetoes are off for this tournament \u2014 the organizer sets the maps directly.</p>';
    if (!seq.length) return '<p class="muted small">No ban/pick order set for this pool yet.</p>';
    const abNote = {
      lowerA: 'the lower rated team is <strong>Team A</strong> and acts first',
      lowerB: 'the higher rated team is <strong>Team A</strong> and acts first',
      random: '<strong>Team A</strong> is picked at random per match',
      manual: '<strong>Team A</strong> is set by the organizer per match'
    }[(T.veto && T.veto.abMode) || 'lowerA'];
    const rows = seq.map((st, i) => `<div class="vp-step">
        <span class="vp-n">${i + 1}</span>
        <span class="veto-act veto-act-${st.action === 'ban' ? 'ban' : 'pick'}">${st.action === 'ban' ? 'BAN' : 'PICK'}</span>
        <span class="vp-team">Team ${esc(st.team)}</span>
      </div>`).join('');
    const bans = seq.filter(x => x.action === 'ban').length;
    const picks = seq.filter(x => x.action === 'pick').length;
    return `<div class="veto-plan">
      <p class="muted small" style="margin:0 0 6px">${ids.length} maps \u2014 ${bans} ban${bans === 1 ? '' : 's'} and ${picks} pick${picks === 1 ? '' : 's'}, then the single map left over is the decider. Rating decides sides: ${abNote}.</p>
      <div class="vp-steps">${rows}<div class="vp-step decider"><span class="vp-n">\u2605</span><span class="veto-act veto-act-pick">DECIDER</span><span class="vp-team">last map standing</span></div></div>
      <p class="muted small" style="margin:6px 0 0">${(T.veto && T.veto.timing === 'continuous') ? 'Steps are revealed as games are played.' : 'The whole sequence is completed before game 1.'}</p>
    </div>`;
  })();

  modal(`<div class="pool-card" style="border:none;padding:0">
    <div class="pool-card-head"><span class="pool-card-name">${esc(pool.name)}</span><span class="muted small">Bo${bo} &middot; ${ids.length} map${ids.length === 1 ? '' : 's'}</span></div>
    <div class="pool-card-maps pool-thumbs" style="margin-top:10px">${thumbs || '<span class="muted small">no maps</span>'}</div>
    <h4 class="vp-title">How the veto will run</h4>
    ${vetoPlan}
    <div class="actions"><button class="btn ghost" id="ppClose">Close</button></div>
  </div>`, root => {
    root.querySelectorAll('[data-map-info]').forEach(t => t.onclick = () => showMapInfo(t.dataset.mapInfo));
    root.querySelector('#ppClose').onclick = closeModal;
  });
}

function mapsLine(bracket, round, el) {
  if (T.imported) return;
  // assigning a pool to a round is a map action, so it follows map access, not organizer rights
  const admin = viewerCanMaps();

  // With vetoes on, a round's maps come from its assigned pool — show that instead of a
  // fixed list, and let the organizer change it right here (works in the preview too).
  if (T.veto && T.veto.enabled) {
    const key = bracket + ':' + round;
    const assigned = (T.poolAssign || {})[key];
    const pools = T.mapPools || [];
    const pool = assigned ? pools.find(p => p.id === assigned) : null;
    // A 3rd place match with no pool of its own plays the semi-finals' pool (lib/match poolForMatch).
    const semiId = (!pool && bracket === '3p') ? (T.poolAssign || {})['wb:' + (round - 1)] : null;
    const semiPool = semiId ? pools.find(p => p.id === semiId) : null;
    const fallback = (!pool && !semiPool && pools.length) ? pools[0] : null;
    const shown = pool || semiPool || fallback;
    if (!admin && !shown) return;
    const div = document.createElement('div');
    div.className = 'mapblock';
    const poolMaps = shown ? (shown.mapIds || []) : [];
    let sub;
    if (!shown) sub = '';
    else if (poolMaps.length > 3) {
      sub = '<div class="maprow mapsub"><button type="button" class="btn ghost small mapblock-showpool">Show pool (' + poolMaps.length + ' maps)</button></div>';
    } else {
      sub = '<div class="maprow mapsub">' + poolMaps.map(id => esc(mapName(id))).join(', ') + '</div>';
    }
    div.innerHTML = '<div class="mapblock-head"><span>MAP POOL</span>' + (admin ? '<a href="#">change</a>' : '') + '</div>' +
      (shown
        ? '<div class="maprow"><span>' + esc(shown.name) + (pool ? '' : semiPool
            ? ' <span class="muted" title="No pool is assigned to the 3rd place match, so it is played on the semi-finals\u2019 pool. Click change to pin one.">(as the semi-finals)</span>'
            : ' <span class="muted" title="No pool is assigned to this round, so the first pool is being used. Click change to pin one.">(default)</span>') + '</span></div>' + sub
        : '<div class="maprow muted">no pools yet \u2014 add them on the Maps tab</div>');
    const a = div.querySelector('a');
    if (a) a.onclick = e => { e.preventDefault(); pickPoolForRound(bracket, round); };
    const showBtn = div.querySelector('.mapblock-showpool');
    if (showBtn) showBtn.onclick = () => showPoolPopup(shown);
    el.appendChild(div);
    return;
  }

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

// Pick which pool a round uses (the round-first counterpart to assignPool).
function pickPoolForRound(bracket, round) {
  const key = bracket + ':' + round;
  const pools = T.mapPools || [];
  const cur = (T.poolAssign || {})[key] || '';
  if (!pools.length) {
    modal(`<h3>${esc(roundKeyLabel(bracket, round))}</h3>
      <p class="muted small">No map pools yet. Create them on the <strong>Maps</strong> tab, then assign one here.</p>
      <div class="actions"><button class="btn ghost" id="prClose">Close</button></div>`, root => {
      root.querySelector('#prClose').onclick = closeModal;
    });
    return;
  }
  // this round's best-of, if the bracket already exists
  const bos = {};
  for (const m of (T.matches || [])) if (m.bracket === bracket && m.round === round) bos[m.bo] = 1;
  const boList = Object.keys(bos).map(x => parseInt(x, 10));
  const rows = pools.map(p => {
    const mismatch = boList.length && boList.indexOf(p.bo || 1) < 0;
    return `<button type="button" class="pick-row${cur === p.id ? ' on' : ''}" data-pid="${p.id}">
      <span class="pr-name">${esc(p.name)}</span>
      <span class="muted small">Bo${p.bo || 1} &middot; ${(p.mapIds || []).length} maps</span>
      ${mismatch ? '<span class="warn small">not Bo' + boList.join('/') + '</span>' : ''}
      <span class="pr-tick"></span></button>`;
  }).join('');
  modal(`<h3>Map pool for ${esc(roundKeyLabel(bracket, round))}</h3>
    <p class="muted small">Captains in this round ban/pick from the pool you choose.${boList.length ? ' These matches are Bo' + boList.join('/') + '.' : ''}</p>
    <div class="pick-rows">${rows}</div>
    <div class="actions">
      <button class="btn ghost" id="prCancel">Cancel</button>
      <button class="btn ghost" id="prClear">Use default</button>
      <button class="btn primary" id="prSave">Save</button>
    </div>`, root => {
    let sel = cur;
    root.querySelectorAll('.pick-row').forEach(btn => btn.onclick = () => {
      root.querySelectorAll('.pick-row').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      sel = btn.dataset.pid;
    });
    root.querySelector('#prCancel').onclick = closeModal;
    const save = async poolId => {
      try {
        await api('/api/t/' + T.id + '/pool_assign', { key, poolId, admin: adminToken() });
        closeModal(); toast('Pool assigned'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
    root.querySelector('#prClear').onclick = () => save('');
    root.querySelector('#prSave').onclick = () => save(sel);
  });
}

// The best-of for a round when the bracket isn't generated yet (preview). Mirrors the
// preview's boForRound logic using the tournament plan, so the per-round map picker shows
// the right number of games (e.g. 1 for a Bo1 round, not a hardcoded 5).
function projectedBoFor(bracket, round) {
  const plan = T.plan || {};
  if (bracket === 'gf') return plan.gf || 5;
  const n = projectedTeamCount();
  const size = Math.max(2, Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2)))));
  const R = Math.round(Math.log2(size));
  if (T.bracketType === 'double') {
    if (bracket === 'lb') { const lbRounds = 2 * R - 2; return round >= lbRounds ? (plan.lbFinal || 3) : (plan.lb || 3); }
    return round >= R ? (plan.wbFinal || 3) : (plan.wb || 3);
  }
  if (T.bracketType === 'single') {
    return round >= R ? (plan.final || 5) : round === R - 1 ? (plan.semi || 3) : (plan.early || 3);
  }
  return plan.bo || 1;
}

function editMaps(bracket, round) {
  const existing = mapsFor(bracket, round);
  const roundMatches = T.matches.filter(m => m.bracket === bracket && m.round === round);
  const maxBo = roundMatches.length ? Math.max.apply(null, roundMatches.map(m => m.bo)) : projectedBoFor(bracket, round);
  const count = Math.max(maxBo, existing.length, 1);
  const db = (T.mapDb || []);
  if (db.length === 0) {
    modal(`<h3>Maps — ${esc(bracket === 'gf' ? 'Grand final' : bracket === '3p' ? '3rd place match' : bracket.toUpperCase() + ' round ' + round)}</h3>
      <p class="muted small">No maps in the database yet. Add maps on the <strong>Maps</strong> tab first, then assign them here.</p>
      <div class="actions"><button class="btn ghost" id="mCancel">Close</button></div>`, root => {
      root.querySelector('#mCancel').onclick = closeModal;
    });
    return;
  }
  const opt = (sel) => '<option value="">— none —</option>' + db.map(m => `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}</option>`).join('');
  const selects = [];
  for (let i = 0; i < count; i++) {
    selects.push(`<label style="display:block;margin-bottom:7px">Game ${i + 1} <select class="mapSel" style="width:100%">${opt(existing[i] || '')}</select></label>`);
  }
  modal(`
    <h3>Maps — ${esc(bracket === 'gf' ? 'Grand final' : bracket === '3p' ? '3rd place match' : bracket.toUpperCase() + ' round ' + round)}</h3>
    <p class="muted small">Pick a map from the database for each game of the series (Bo${maxBo}). ${T.veto && T.veto.enabled ? 'Note: if map vetoes are enabled, captains pick the maps per match — this round pool is a fallback.' : 'Everyone in this round plays these maps.'}</p>
    ${selects.join('')}
    <div class="actions">
      <button class="btn ghost" id="mCancel">Cancel</button>
      <button class="btn primary" id="mGo">Save maps</button>
    </div>`, root => {
    root.querySelector('#mCancel').onclick = closeModal;
    root.querySelector('#mGo').onclick = async () => {
      const maps = Array.from(root.querySelectorAll('.mapSel')).map(s => s.value).filter(v => v);
      try {
        await api('/api/t/' + T.id + '/set_maps', { bracket, round, maps, admin: adminToken() });
        closeModal();
        toast('Maps saved');
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// Match chat is open to the two participating teams' members and to organizers.
function matchChatAllowed(m) {
  if (viewerIsOrganizer()) return true;
  if (T.viewer && T.viewer.caster) return true;   // caster role: every chat
  const mine = (T.viewer && T.viewer.memberTeamId) || (T.viewer && T.viewer.teamId) || null;
  return !!(mine && (mine === m.team1 || mine === m.team2));
}

// The label with the division in front ("PRINCE R1 M2"), for every place a match is shown away
// from its own bracket tab: the veto popup and cards, match details, the Matches tab, match chat.
function mLabelFull(m) {
  const core = mLabel(m);
  return (m && m.division && divisionsOnT()) ? divisionNameOf(m.division).toUpperCase() + ' ' + core : core;
}
function mLabel(m) {
  if (m.bracket === 'gf') return T.bracketType === 'swiss' ? 'FINAL' : 'GRAND FINAL';
  if (m.bracket === '3p') return '3RD PLACE';
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

// Does the viewer actually hold elevated rights here (ignoring the personal "view as player" toggle)?
function viewerHasRights() { return !!(T.viewer && (T.viewer.admin || T.viewer.organizer)); }
function viewerIsAdmin() { return !playerViewMode && !!(T.viewer && T.viewer.admin); }
function viewerIsOrganizer() { return !playerViewMode && !!(T.viewer && (T.viewer.admin || T.viewer.organizer)); }
// Map prep is its own permission, NARROWER than organizer rights: a global tournament director
// organizes every official tournament but competes in them too, so they get no map access unless
// they are a named organizer here. The server decides (viewer.maps / viewer.mapsView); this only
// mirrors it so the page does not offer buttons every action behind them would refuse.
// "View as player" still applies on top, exactly as it does for organizer controls.
function viewerCanMaps() { return !playerViewMode && !!(T.viewer && T.viewer.maps); }
function viewerSeesMapPrep() { return !playerViewMode && !!(T.viewer && T.viewer.mapsView); }
function viewerLoggedIn() { return !!(T.viewer && T.viewer.loggedIn) || isFafVerified(); }
function viewerSignedUp() { return !!(T.viewer && T.viewer.signedUpPlayerId); }
// helper: prompt login (kicks off FAF flow if configured, else the name modal)
function requireLoginThen() {
  if (fafAuth.enabled) {
    const returnTo = location.pathname + location.search;
    location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(returnTo);
  } else {
    loginFlow();
  }
}
function canReportMatch(m) {
  const v = T.viewer || {};
  if (v.admin || v.organizer) return true;
  if (m.bracket === 'ffa') return !!v.teamId && m.entrants.indexOf(v.teamId) >= 0;
  if (!T.playerReporting) return false;                 // players can't report at all
  const mine = v.memberTeamId || v.teamId;              // ANY member of a team may submit
  return !!mine && (m.team1 === mine || m.team2 === mine);
}
function myMatchTeam(m) {
  const v = T.viewer || {};
  const mine = v.memberTeamId || v.teamId;
  return mine && (m.team1 === mine || m.team2 === mine) ? mine : null;
}

// Popup listing a team's members (with ratings and captain), opened by clicking a team in the bracket.
function showTeamPopup(teamId) {
  const tm = T.teams && T.teams.find(t => t.id === teamId);
  if (!tm) return;
  const mems = (tm.playerIds || []).map(pid => T.players.find(p => p.id === pid)).filter(Boolean)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const total = mems.reduce((s, p) => s + (p.rating || 0), 0);
  const seed = tm.seed ? '<span class="tc-seed" style="margin-right:6px">#' + tm.seed + '</span>' : '';
  const rows = mems.length ? mems.map(p => `<div class="tp-row">
      <span class="tp-name">${p.id === tm.captainId ? '<span class="cap-tag">C</span> ' : ''}${esc(p.name)}${p.fafId ? ' <span class="idbadge verified">\u2713</span>' : ''}</span>
      <span class="tp-rating mono muted">${p.rating != null ? p.rating : '—'}</span>
    </div>`).join('') : '<div class="muted small">No members.</div>';
  modal(`<h3>${seed}${esc(tm.name)}</h3>
    <div class="tp-list">${rows}</div>
    <div class="tp-total"><span>Combined rating</span><span class="mono">${total}${T.maxTeamRating != null ? ' / ' + T.maxTeamRating : ''}</span></div>
    <div class="actions"><button class="btn ghost" id="tpClose">Close</button></div>`, root => {
    root.querySelector('#tpClose').onclick = closeModal;
  });
}

// A match with BYE on either side is not a real game: the team that "won" the bye has already
// been advanced into its next match. Byes also CASCADE — a phantom match routes BYE into the slot
// it feeds, so whole early losers-bracket rounds can be phantom too. The bracket hides these, and
// every other view must use the same rule or the counts disagree with what people can see.
// What to print for a team in the bracket: its name, or its players when the viewer has switched
// to player labels. Always a single line — the row truncates with an ellipsis rather than growing.
function bracketLabel(tid) {
  if (!showPlayerNames) return teamName(tid);
  const tm = T.teams && T.teams.find(x => x.id === tid);
  if (!tm) return teamName(tid);
  const names = (tm.playerIds || []).map(pid => {
    const p = T.players.find(x => x.id === pid);
    return p ? p.name : null;
  }).filter(Boolean);
  return names.length ? names.join(', ') : teamName(tid);
}

// Vetoes tab: who the page follows - 'all', 'mine', 't:<teamId>' or 'p:<playerId>' - remembered per
// tournament. Someone playing starts on their own matches, everyone else on all of them; the old
// site-wide "all vetoes" switch still decides a player's starting point.
function vetoFollowDefault() {
  const isOrg = viewerIsOrganizer() || (T.viewer && T.viewer.caster);
  const mine = (T.viewer && (T.viewer.memberTeamId || T.viewer.teamId)) || null;
  if (isOrg || !mine) return 'all';
  try { if (localStorage.getItem('faf_veto_all') === '1') return 'all'; } catch (e) {}
  return 'mine';
}
function getVetoFollow() {
  try { const v = localStorage.getItem('faf_veto_follow_' + T.id); if (v) return v; } catch (e) {}
  return vetoFollowDefault();
}
function setVetoFollow(v) {
  try { localStorage.setItem('faf_veto_follow_' + T.id, v); } catch (e) {}
}
// The sub-page picked by hand (Swiss stage / playoffs, or a division), for this visit only.
let _vetoStage = null;   // { tid, key }

// A replay id links to the FAF replay vault, but only the number is shown. Ids are digits-only
// server-side; anything odd in older data is rendered as plain text rather than a broken link.
function replayLink(id) {
  const n = String(id || '').replace(/\D/g, '');
  if (!n) return esc(String(id || ''));
  return '<a href="https://replay.faforever.com/' + n + '" target="_blank" rel="noopener" class="replay-link">' + esc(n) + '</a>';
}

function isPhantomMatch(m) {
  return !m || m.team1 === 'BYE' || m.team2 === 'BYE';
}

function matchBox(m) {
  const admin = viewerIsOrganizer();
  const box = document.createElement('div');
  // masked = hidden by streamer mode, unless this specific match has been revealed
  const masked = streamerMode && !revealedMatches.has(m.id);
  box.className = 'bmatch ' + (masked ? 'ready' : m.status) + (neverPlayed(m, T) ? ' notplayed' : '');
  const row = (tid, score, slot) => {
    const win = !masked && m.winner && m.winner === tid && tid !== 'BYE';
    let nm;
    if (tid === 'BYE') nm = 'bye';
    else if (tid) {
      // Streamer mode: if this slot was filled by a COMPLETED upstream match, showing the team
      // would reveal that result — UNLESS that feeder match has itself been revealed, in which
      // case the advancing team should now appear here.
      const feed = feeders[m.id + ':' + slot];
      if (masked && feed && feed.m && feed.m.status === 'done' && !revealedMatches.has(feed.m.id)) {
        nm = feed.type + ' of ' + mLabel(feed.m);
        tid = null;   // render as a TBD-style slot, not a clickable team
      } else {
        nm = bracketLabel(tid);
      }
    } else {
      const src = feeders[m.id + ':' + slot];
      nm = src ? src.type + ' of ' + mLabel(src.m) : 'TBD';
    }
    const seed = tid && tid !== 'BYE' ? teamSeed(tid) : null;
    const realTeam = tid && tid !== 'BYE' && T.teams && T.teams.some(t => t.id === tid);
    const isFf = m.forfeit && tid === m.forfeit && score != null && score < 0;
    const scoreTxt = masked ? '' : (isFf ? '<span class="ff-mark" title="Forfeit">FF</span>' : (score != null && score >= 0 ? score : ''));
    return `<div class="brow ${win ? 'winner' : ''}">
      <span class="bname ${tid && tid !== 'BYE' ? '' : 'tbd'}${realTeam ? ' bname-team' : ''}"${realTeam ? ' data-teamid="' + esc(tid) + '"' : ''}>${seed ? '<span class="seedtag">' + seed + '</span>' : ''}${esc(nm)}</span>
      <span class="bscore">${scoreTxt}</span></div>`;
  };
  const canReport = !T.imported && (m.status === 'ready' || m.status === 'live') && canReportMatch(m);
  const prMine = m.pendingReport && myMatchTeam(m) && m.pendingReport.byTeam !== myMatchTeam(m);
  const prTag = m.pendingReport ? '<span class="pr-tag" title="A score was submitted and awaits the opponent\u2019s confirmation">\u23F3 ' + m.pendingReport.score1 + '\u2013' + m.pendingReport.score2 + ' unconfirmed</span>' : '';
  const canCorrect = !T.imported && m.status === 'done' && viewerIsAdmin();
  box.dataset.mid = m.id;
  box.innerHTML = `<div class="botag">${mLabel(m)} · BO${m.bo}${m.hcap ? ' · UB starts 1-0' : ''}${(!masked && m.forfeit) ? ' · <span class="ff-mark">FORFEIT</span>' : ''}${(!masked && m.status === 'live') ? ' · <span class="livechip">LIVE</span>' : ''}</div>` +
    row(m.team1, m.score1, 1) + row(m.team2, m.score2, 2) +
    // chat first, then the veto link, on one row to keep the box compact
    (() => {
      const chat = (m.team1 && m.team2 && matchChatAllowed(m))
        ? '<a href="#" data-matchchat class="veto-mini-link">\u{1F4AC} Match chat' + unreadDot('match:' + m.id) + '</a>' : '';
      const veto = masked ? '' : vetoLinkHTML(m);
      // Your own outstanding faction choice goes FIRST: it is the only line here that is a job
      // rather than a link, and it only ever appears when you actually owe one.
      const fv = masked ? '' : myFvetoLinkHTML(m);
      return (fv || chat || veto) ? '<div class="mlinks">' + fv + chat + veto + '</div>' : '';
    })() +
    // Show replays as soon as games are confirmed, not only once the series ends. A Bo3 sitting
    // at 1-0 already has a replay worth watching, and casters need it while the match is live.
    // `masked` still hides them in streamer mode until the result is revealed.
    ((!masked && ((m.replayIds && m.replayIds.length) || (m.drawReplayIds && m.drawReplayIds.length)))
      ? '<div class="replayline" title="FAF replay IDs, in game order">' + ((m.replayIds && m.replayIds.length) ? 'Replays: ' + m.replayIds.map(replayLink).join(', ') : '') + ((m.drawReplayIds && m.drawReplayIds.length) ? ((m.replayIds && m.replayIds.length) ? ' \u00b7 ' : '') + 'Draws: ' + m.drawReplayIds.map(replayLink).join(', ') : '') + '</div>' : '') +
    ((streamerMode && m.status === 'done')
      ? `<div class="bfoot"><button class="btn ghost small" data-reveal="${m.id}">${revealedMatches.has(m.id) ? '\u25C9 Hide result' : '\u25CB Reveal result'}</button></div>` : '') +
    ((!masked && (canReport || canCorrect || m.pendingReport))
      ? `<div class="bfoot">${prTag}${(canReport || canCorrect) ? `<button class="btn ${canReport ? 'amber' : 'ghost'} small">${prMine ? 'Confirm score' : canReport ? (viewerIsOrganizer() ? 'Report score' : 'Submit score') : 'Correct'}</button>` : ''}</div>` : '');
  const btn = box.querySelector('.bfoot button:not([data-reveal])');
  if (btn) btn.onclick = () => reportScore(m.id);
  const revBtn = box.querySelector('[data-reveal]');
  if (revBtn) revBtn.onclick = () => {
    if (revealedMatches.has(m.id)) revealedMatches.delete(m.id); else revealedMatches.add(m.id);
    saveRevealed();
    drawTournament();
  };
  const vlink = box.querySelector('[data-veto-link]');
  if (vlink) vlink.onclick = (e) => { e.preventDefault(); showVetoPopup(m); };
  const mchat = box.querySelector('[data-matchchat]');
  if (mchat) mchat.onclick = (e) => { e.preventDefault(); openMatchChat(m); };
  const fvlink = box.querySelector('[data-fveto-link]');
  if (fvlink) fvlink.onclick = (e) => { e.preventDefault(); showVetoPopup(m); };
  box.querySelectorAll('[data-teamid]').forEach(nameEl => {
    nameEl.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showTeamPopup(nameEl.dataset.teamid); };
  });
  return box;
}

// compact in-bracket veto indicator: a link to the Vetoes tab (pending) or the chosen maps (done)
function vetoIndicator(m) {
  if (!m.veto) return '';
  const v = m.veto;
  return `<div class="veto-mini">${vetoLinkHTML(m)}</div>`;
}

// just the link, for rows that place it alongside other links
function vetoLinkHTML(m) {
  if (!m.veto) return '';
  const label = (m.status === 'done' && !vetoRanToCompletion(m.veto))
    ? 'Veto (not completed) →'
    : (m.veto.done ? 'Vetoed maps →' : 'Veto in progress →');
  return `<a href="#" data-veto-link="${m.id}" class="veto-mini-link">${label}</a>`;
}

// Popup showing a single match's veto (status or final maps), plus a link to that match's chat.
// Opened from the "See vetoed maps" link on a bracket match, so the user stays on the bracket.
function showVetoPopup(m) {
  // Faction-only matches have no m.veto at all. They used to fall out here, which meant the
  // popup could not be opened for them and there was nowhere to act from the bracket.
  if (!m || (!m.veto && !m.fveto)) return;
  const nameHtml = (tid) => {
    const real = T.teams && T.teams.some(t => t.id === tid);
    return `<span class="${real ? 'vteam-name' : ''}"${real ? ' data-teamid="' + esc(tid) + '"' : ''}>${esc(bracketLabel(tid))}</span>`;
  };
  const chatLink = matchChatAllowed(m) ? '<a href="#" id="vpChat" class="veto-mini-link">\u{1F4AC} Open match chat</a>' : '';
  modal(`<h3>${esc(mLabelFull(m))} <span class="muted" style="font-weight:400">${nameHtml(m.team1)} vs ${nameHtml(m.team2)}</span></h3>
    <div id="vpBody"></div>
    <div class="veto-pop-foot" style="margin-top:10px">${chatLink}</div>
    <div class="actions"><button class="btn ghost" id="vpClose">Close</button></div>`, root => {
    const body = root.querySelector('#vpBody');
    body.innerHTML = vetoHTML(m) || '<div class="muted small">Nothing to show for this match.</div>';
    wireVeto(body, m);
    wireFactionVeto(body);
    const chat = root.querySelector('#vpChat');
    if (chat) chat.onclick = (e) => { e.preventDefault(); closeModal(); openMatchChat(m); };
    root.querySelectorAll('[data-teamid]').forEach(nameEl => {
      nameEl.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showTeamPopup(nameEl.dataset.teamid); };
    });
    root.querySelector('#vpClose').onclick = closeModal;
  }, { wide: true });
}

// ---- Maps tab: the map database + where each map is played ----
// Add or edit a map in the tournament's map database. `map` is null for a new entry.
// Import maps and/or pools from another tournament the organizer runs. The server dedupes
// by map name, so re-importing never piles up copies.
async function openMapImport() {
  let sources;
  try { sources = (await api('/api/my_tournaments')).tournaments || []; }
  catch (e) { return toast(e.message, true); }
  // canCopyMaps comes from the server and is narrower than "appears in my tournaments": a
  // director sees every official tournament there, but may only copy maps out of the ones they
  // actually organize. Filtering here keeps the picker honest instead of offering a 403.
  sources = sources.filter(t => t.id !== T.id && t.canCopyMaps && (t.mapCount > 0 || t.poolCount > 0));
  if (!sources.length) return toast('No tournament you organize has maps to import', true);

  modal(`<h3>Import maps from another tournament</h3>
    <p class="muted small">Pick one of your tournaments, then choose whole pools or individual maps. Maps you already have (matched by name) won't be duplicated.</p>
    <label>Source tournament</label>
    <select id="miSrc" style="width:100%">${sources.map(t => `<option value="${t.id}">${esc(t.name)} (${t.mapCount} maps, ${t.poolCount} pools)</option>`).join('')}</select>
    <div id="miBody" style="margin-top:12px"><div class="empty">Loading\u2026</div></div>
    <div class="actions"><button class="btn ghost" id="miCancel">Cancel</button></div>`, root => {
    root.querySelector('#miCancel').onclick = closeModal;
    const sel = root.querySelector('#miSrc');
    const body = root.querySelector('#miBody');

    const loadSource = async () => {
      body.innerHTML = '<div class="empty">Loading\u2026</div>';
      let src;
      try { src = await api('/api/t/' + sel.value + (siteAdmin() ? '?token=' + encodeURIComponent(siteAdmin()) : '')); }
      catch (e) { body.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; return; }
      const maps = src.mapDb || [];
      const pools = src.mapPools || [];
      const haveNames = new Set((T.mapDb || []).map(m => (m.name || '').toLowerCase()));
      body.innerHTML = `
        <input type="text" id="miSearch" placeholder="Search maps\u2026" autocomplete="off" style="width:100%;margin-bottom:10px">
        ${pools.length ? '<div class="muted small" style="text-transform:uppercase;letter-spacing:1px;margin:6px 0">Pools</div><div id="miPools" class="pick-rows">' + pools.map(p => `<label class="pick-row" style="cursor:pointer"><span class="pr-name"><input type="checkbox" class="miPool" value="${p.id}" style="width:auto;margin-right:8px">${esc(p.name)} <span class="muted small">${(p.mapIds||[]).length} maps · Bo${p.bo||1}</span></span></label>`).join('') + '</div>' : ''}
        <div class="muted small" style="text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px">Individual maps</div>
        <div id="miMaps" class="pick-rows">${maps.map(m => `<label class="pick-row miMapRow" data-name="${esc((m.name||'').toLowerCase())}" style="cursor:pointer"><span class="pr-name"><input type="checkbox" class="miMap" value="${m.id}" style="width:auto;margin-right:8px">${esc(m.name || '(unnamed)')} ${haveNames.has((m.name||'').toLowerCase()) ? '<span class="idbadge verified" title="Already in this tournament">have it</span>' : ''}</span></label>`).join('') || '<div class="empty">No maps.</div>'}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn" id="miAll">Import everything</button>
          <button class="btn primary" id="miSelected">Import selected</button>
        </div>`;
      const search = body.querySelector('#miSearch');
      search.oninput = () => {
        const q = search.value.toLowerCase();
        body.querySelectorAll('.miMapRow').forEach(r => { r.style.display = r.dataset.name.indexOf(q) >= 0 ? '' : 'none'; });
      };
      const doImport = async (payload, msg) => {
        try {
          const r = await api('/api/t/' + T.id + '/copy_maps', Object.assign({ sourceId: sel.value, admin: adminToken() }, payload));
          closeModal();
          toast('Imported ' + r.importedMaps + ' map' + (r.importedMaps === 1 ? '' : 's') + (r.importedPools ? ' and ' + r.importedPools + ' pool' + (r.importedPools === 1 ? '' : 's') : '') + (r.importedMaps === 0 && r.importedPools === 0 ? ' (all already present)' : ''));
          await refresh();
        } catch (e) { toast(e.message, true); }
      };
      body.querySelector('#miAll').onclick = () => doImport({}, '');
      body.querySelector('#miSelected').onclick = () => {
        const poolIds = Array.from(body.querySelectorAll('.miPool:checked')).map(c => c.value);
        const mapIds = Array.from(body.querySelectorAll('.miMap:checked')).map(c => c.value);
        if (!poolIds.length && !mapIds.length) return toast('Select at least one pool or map, or use "Import everything"', true);
        doImport({ pools: poolIds.length ? undefined : false, poolIds: poolIds.length ? poolIds : undefined, mapIds: mapIds.length ? mapIds : undefined }, '');
      };
    };
    sel.onchange = loadSource;
    loadSource();
  }, { wide: true });
}

function editMapEntry(map) {
  const editing = !!map;
  const curImg = map && map.image ? '/map-images/' + encodeURIComponent(map.image) : '';
  const spec = (editing && map.spec) || {};
  // Spawn numbers are toggles rather than a <select multiple>: a map has at most 16 slots, and
  // clicking 1 and 3 is far quicker than ctrl-clicking a list.
  const chipRow = (key, label) => {
    const on = Array.isArray(spec[key]) ? spec[key] : [];
    let h = `<label style="margin-top:10px">${label} <span class="muted small">(optional)</span></label><div class="spawn-row" data-spawn="${key}">`;
    for (let i = 1; i <= MAP_SPAWN_MAX; i++) {
      h += `<button type="button" class="spawn-chip${on.indexOf(i) >= 0 ? ' on' : ''}" data-n="${i}">${i}</button>`;
    }
    return h + '</div>';
  };
  modal(`<h3>${editing ? 'Edit map' : 'Add map'}</h3>
    <label>Name</label>
    <input type="text" id="mName" maxlength="60" autocomplete="off" placeholder="e.g. Setons Clutch" value="${editing ? esc(map.name) : ''}">
    ${chipRow('t1', 'Spawns Team 1')}
    ${chipRow('t2', 'Spawns Team 2')}
    ${chipRow('closed', 'Closed spawns')}
    ${chipRow('closedMex', 'Closed spawn mexes')}
    <label style="margin-top:10px">Map size <span class="muted small">(optional)</span></label>
    <select id="mSize"><option value="">\u2014 not set \u2014</option>${MAP_SIZES.map(s => `<option value="${s}"${spec.size === s ? ' selected' : ''}>${s} km</option>`).join('')}</select>
    <label style="margin-top:10px">Description <span class="muted small">(optional \u2014 anything the fields above don't cover, e.g. reclaim or author)</span></label>
    <textarea id="mDesc" rows="6" style="width:100%">${editing ? esc(map.description || '') : ''}</textarea>
    <label style="margin-top:10px">Image <span class="muted small">(optional, 5MB max)</span></label>
    <div id="mImgWrap">${curImg ? `<img src="${curImg}" alt="" style="max-height:120px;border-radius:4px;display:block;margin:6px 0"><label class="muted small" style="display:block"><input type="checkbox" id="mRemoveImg"> Remove current image</label>` : ''}</div>
    <input type="file" id="mImg" accept="image/*">
    <label style="margin-top:10px;display:block"><input type="checkbox" id="mPub" ${editing && map.published ? 'checked' : ''}> Published (visible to players)</label>
    <label style="margin-top:6px;display:block"><input type="checkbox" id="mSecret" ${editing && map.secret ? 'checked' : ''}> Secret — players see “Hidden Map N” and no picture until it is played</label>
    <div class="muted small" style="margin:4px 0 0 22px">Different from Published: a secret map still appears in the pool and can be banned or picked, players just cannot see which map it is. It is revealed the moment it is picked for a game or left as the decider.</div>
    <div class="actions"><button class="btn ghost" id="mCancel">Cancel</button><button class="btn primary" id="mSave">Save map</button></div>`, root => {
    root.querySelectorAll('.spawn-chip').forEach(b => {
      b.onclick = () => b.classList.toggle('on');
    });
    const readSpawns = (key) => {
      const row = root.querySelector('[data-spawn="' + key + '"]');
      if (!row) return [];
      return Array.from(row.querySelectorAll('.spawn-chip.on')).map(b => parseInt(b.dataset.n, 10));
    };
    root.querySelector('#mCancel').onclick = closeModal;
    root.querySelector('#mSave').onclick = async () => {
      const name = root.querySelector('#mName').value.trim();
      if (!name) return toast('Map name required', true);
      const body = {
        name,
        description: root.querySelector('#mDesc').value,
        spec: {
          t1: readSpawns('t1'), t2: readSpawns('t2'),
          closed: readSpawns('closed'), closedMex: readSpawns('closedMex'),
          size: root.querySelector('#mSize').value
        },
        published: root.querySelector('#mPub').checked ? 1 : 0,
        secret: root.querySelector('#mSecret').checked ? 1 : 0,
        admin: adminToken()
      };
      if (editing) body.id = map.id;
      const fileInput = root.querySelector('#mImg');
      const removeChk = root.querySelector('#mRemoveImg');
      const file = fileInput && fileInput.files && fileInput.files[0];
      try {
        if (file) {
          body.image = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read image')); r.readAsDataURL(file); });
        } else if (removeChk && removeChk.checked) {
          body.removeImage = 1;
        }
        await api('/api/t/' + T.id + '/map_save', body);
        closeModal(); toast(editing ? 'Map updated' : 'Map added'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  }, { mid: true });
}

function drawMaps(el) {
  const admin = viewerCanMaps();
  const db = T.mapDb || [];

  // "Played in" should reflect only DIRECT round assignments of this specific map. Maps that
  // reach a round merely by being inside an assigned pool are shown via their pool badge instead
  // (otherwise every map in a pool lists every round the pool touches — too much noise).
  const directUse = {};
  const addDirect = (id, label) => {
    if (!directUse[id]) directUse[id] = [];
    if (directUse[id].indexOf(label) < 0) directUse[id].push(label);
  };
  for (const key of Object.keys(T.maps || {})) {
    const [bracket, round] = key.split(':');
    for (const id of (T.maps[key] || [])) addDirect(id, roundKeyLabel(bracket, round));
  }
  // which pools each map belongs to (for a badge)
  const inPool = {};
  for (const pool of (T.mapPools || [])) {
    for (const id of (pool.mapIds || [])) {
      if (!inPool[id]) inPool[id] = [];
      inPool[id].push(pool.name);
    }
  }

  let adminHead = '';
  let mapsHtml = '';
  let poolsHtml = '';

  if (admin) {
    const published = db.filter(m => m.published).length;
    adminHead += `<div class="panel section">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><h2 style="margin:0">Map database</h2><div class="muted small">${db.length} map${db.length === 1 ? '' : 's'} · ${published} published${db.length - published > 0 ? ' · ' + (db.length - published) + ' hidden (prep)' : ''}</div></div>
        <div style="display:flex;gap:8px">${db.length - published > 0 ? '<button class="btn ghost" id="mapPubAll">Publish all</button>' : ''}<button class="btn ghost" id="mapImport">Import from another tourney</button><button class="btn primary" id="mapAdd">+ Add map</button></div>
      </div>
      <p class="muted small" style="margin-top:8px">Add every map that might be played. Hidden maps are only visible to organizers — use that to prep a pool before revealing it. Group maps into pools below and assign each pool to rounds or matches; when vetoes are on, captains ban/pick from the pool assigned to their match.</p>
    </div>`;
  }

  const visible = admin ? db : db.filter(m => m.published);
  if (visible.length === 0) {
    mapsHtml += `<div class="panel"><div class="empty">${admin ? 'No maps yet. Click "Add map" to build your pool.' : 'No maps have been published yet.'}</div></div>`;
  } else {
    mapsHtml += '<div class="panel section"><h2 style="margin:0 0 12px">All maps</h2><div class="mapdb-grid">';
    for (const m of visible) {
      const used = directUse[m.id] || [];
      const badges = [];
      if (admin && !m.published) badges.push('<span class="idbadge late">hidden</span>');
      // "hidden" above means players cannot see the map at all; "secret" means they can see it
      // but not which map it is. Two different things, so two different badges.
      if (m.secret) badges.push('<span class="idbadge late" title="Players see &quot;Hidden Map ' + (secretNoOf(m.id) || '?') + '&quot; until it is played">secret \u00b7 Hidden Map ' + (secretNoOf(m.id) || '?') + '</span>');
      if (inPool[m.id]) badges.push('<span class="idbadge verified">' + esc(inPool[m.id].join(', ')) + '</span>');
      mapsHtml += `<div class="mapdb-card">
        <div class="mapdb-thumb${m.image ? '' : ' noimg'}" ${m.image ? 'data-map-info="' + esc(m.id) + '"' : ''}>
          ${m.image ? `<img src="/map-images/${esc(m.image)}" alt="${esc(m.name)}">` : '<span class="mapdb-noimg-label">' + mapNoImgLabel(m) + '</span>'}
        </div>
        <div class="mapdb-body">
          <div class="mapdb-name">${esc(m.name)} ${badges.join(' ')}</div>
          ${mapSpecHTML(m, 'mapdb-desc')}
          ${used.length
            ? `<div class="mapdb-used">Played in: ${used.map(u => esc(u)).join(', ')}</div>`
            : (inPool[m.id]
              ? `<div class="mapdb-used muted">In pool: ${esc(inPool[m.id].join(', '))}</div>`
              : (admin ? '<div class="mapdb-used muted">Not in any pool or round yet</div>' : ''))}
          ${admin ? `<div class="mapdb-actions">
            <button class="btn ghost small" data-mapedit="${m.id}">Edit</button>
            <button class="btn ghost small" data-mappub="${m.id}">${m.published ? 'Hide' : 'Publish'}</button>
            <button class="btn ghost small" data-mapsec="${m.id}">${m.secret ? 'Reveal' : 'Make secret'}</button>
            <button class="btn danger small" data-mapdel="${m.id}">Delete</button>
          </div>` : ''}
        </div>
      </div>`;
    }
    mapsHtml += '</div></div>';
  }

  // ---- map pools (players see published ones; organizers see all + controls) ----
  {
    const pools = T.mapPools || [];
    const showPools = admin || pools.length > 0;
    if (showPools) {
    poolsHtml += `<div class="panel section">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><h2 style="margin:0">Map pools</h2><div class="muted small">${admin ? 'Group maps into pools, then assign each pool to rounds or matches. A match\'s veto draws from its assigned pool.' : 'The maps in play for each stage of the tournament.'}</div></div>
        ${admin ? `<button class="btn primary" id="poolAdd"${db.length === 0 ? ' disabled title="Add maps first"' : ''}>+ New pool</button>` : ''}
      </div>`;
    if (pools.length === 0) {
      poolsHtml += '<div class="empty" style="margin-top:12px">No pools yet.' + (db.length === 0 ? ' Add maps first.' : ' Create one to group maps.') + '</div>';
    } else {
      poolsHtml += '<div class="pool-cards">';
      for (const pool of pools) {
        const names = (pool.mapIds || []).map(id => mapName(id));
        // where is this pool assigned?
        const assignedTo = [];
        for (const key of Object.keys(T.poolAssign || {})) {
          if (T.poolAssign[key] === pool.id) {
            const [bk, rd] = key.split(':');
            if (bk === 'match') assignedTo.push('a specific match');
            else assignedTo.push(roundKeyLabel(bk, rd));
          }
        }
        poolsHtml += `<div class="pool-card">
          <div class="pool-card-head"><span class="pool-card-name">${esc(pool.name)}${(admin && !pool.published) ? ' <span class="idbadge late">hidden</span>' : ''}${(admin && !pool.published && pool.publishAt) ? ' <span class="idbadge verified" title="Publishes automatically">scheduled</span>' : ''}</span><span class="muted small">Bo${pool.bo || 1} &middot; ${names.length} map${names.length === 1 ? '' : 's'}</span></div>
          ${(admin && !pool.published && pool.publishAt) ? `<div class="pool-card-assign">Publishes ${esc(fmtDateTime(pool.publishAt))}</div>` : ''}
          <div class="pool-card-maps pool-thumbs">${names.length ? (pool.mapIds || []).map(id => {
            const mo = mapObj(id);
            if (!mo) return '';
            return `<div class="pool-thumb${mo.image ? '' : ' noimg'}"${mo.image ? ' data-map-info="' + esc(id) + '"' : ''}>
              ${mo.image ? `<img src="/map-images/${esc(mo.image)}" alt="${esc(mo.name)}" loading="lazy">` : '<span class="pool-thumb-noimg">' + mapNoImgLabel(mo) + '</span>'}
              <span class="pool-thumb-name">${esc(mo.name)}</span>
            </div>`;
          }).join('') : '<span class="muted small">no maps</span>'}</div>
          ${admin ? (function(){
            const steps = (pool.sequence || []).length, need = names.length - 1;
            const picks = (pool.sequence || []).filter(x => x.action === 'pick').length;
            const bo = pool.bo || 1;
            if (!steps) return '<div class="pool-card-warn">No ban/pick order set — vetoes won\'t run</div>';
            if (steps !== need || picks !== bo - 1) return '<div class="pool-card-warn">Order doesn\'t match (needs ' + need + ' steps, ' + (bo - 1) + ' picks)</div>';
            return '';
          })() : ''}
          ${assignedTo.length ? '<div class="pool-card-assign">Used for: ' + assignedTo.map(a => esc(a)).join(', ') + '</div>' : (admin ? '<div class="pool-card-assign muted">Not assigned yet' + (pools.length === 1 ? ' (used as default)' : '') + '</div>' : '')}
          ${admin ? `<div class="pool-card-actions">
            <button class="btn ghost small" data-pooledit="${pool.id}">Edit</button>
            ${(pool.sequence || []).length === names.length - 1 && names.length > 1 ? '<button class="btn ghost small" data-poolcopyseq="' + pool.id + '">Copy order to\u2026</button>' : ''}
            <button class="btn ghost small" data-poolassign="${pool.id}">Assign to rounds</button>
            <button class="btn ghost small" data-poolpub="${pool.id}">${pool.published ? 'Hide' : 'Publish'}</button>
            <button class="btn danger small" data-pooldel="${pool.id}">Delete</button>
          </div>` : ''}
        </div>`;
      }
      poolsHtml += '</div>';
    }
    poolsHtml += '</div>';
    }
  }

  el.innerHTML = adminHead + poolsHtml + mapsHtml;

  const addBtn = document.getElementById('mapAdd');
  if (addBtn) addBtn.onclick = () => editMapEntry(null);
  const importBtn = document.getElementById('mapImport');
  if (importBtn) importBtn.onclick = () => openMapImport();
  const pubAllBtn = document.getElementById('mapPubAll');
  if (pubAllBtn) pubAllBtn.onclick = async () => {
    try { await api('/api/t/' + T.id + '/map_publish', { all: 1, published: 1, admin: adminToken() }); toast('All maps published'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  // A map is always editable. Pools and rounds only reference it by id, so a rename or a new
  // image shows up everywhere immediately - no confirmation needed, and being in a pool (with or
  // without vetoes) never blocks an edit.
  el.querySelectorAll('[data-mapedit]').forEach(b => b.onclick = () => {
    editMapEntry(mapObj(b.dataset.mapedit) || null);
  });
  el.querySelectorAll('[data-mappub]').forEach(b => b.onclick = async () => {
    const m = mapObj(b.dataset.mappub);
    try { await api('/api/t/' + T.id + '/map_publish', { id: m.id, published: m.published ? 0 : 1, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-mapsec]').forEach(b => b.onclick = async () => {
    const m = mapObj(b.dataset.mapsec);
    try { await api('/api/t/' + T.id + '/map_secret', { id: m.id, secret: m.secret ? 0 : 1, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-mapdel]').forEach(b => b.onclick = async () => {
    const m = mapObj(b.dataset.mapdel);
    const used = (directUse[m.id] || []).length || (inPool[m.id] && inPool[m.id].length);
    if (!confirm('Delete "' + m.name + '"?' + (used ? ' It will be removed from rounds and pools too.' : ''))) return;
    try { await api('/api/t/' + T.id + '/map_delete', { id: m.id, admin: adminToken() }); toast('Map deleted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  // pool controls
  const poolAdd = document.getElementById('poolAdd');
  if (poolAdd) poolAdd.onclick = () => editPool(null);
  el.querySelectorAll('[data-pooledit]').forEach(b => b.onclick = () => editPool((T.mapPools || []).find(p => p.id === b.dataset.pooledit)));
  el.querySelectorAll('[data-poolcopyseq]').forEach(b => b.onclick = () => copyPoolSequence((T.mapPools || []).find(p => p.id === b.dataset.poolcopyseq)));
  el.querySelectorAll('[data-poolassign]').forEach(b => b.onclick = () => assignPool((T.mapPools || []).find(p => p.id === b.dataset.poolassign)));
  el.querySelectorAll('[data-poolpub]').forEach(b => b.onclick = async () => {
    const pool = (T.mapPools || []).find(p => p.id === b.dataset.poolpub);
    try { await api('/api/t/' + T.id + '/pool_publish', { id: pool.id, published: pool.published ? 0 : 1, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-pooldel]').forEach(b => b.onclick = async () => {
    const pool = (T.mapPools || []).find(p => p.id === b.dataset.pooldel);
    if (!confirm('Delete pool "' + pool.name + '"? Round/match assignments to it are cleared.')) return;
    try { await api('/api/t/' + T.id + '/pool_delete', { id: pool.id, admin: adminToken() }); toast('Pool deleted'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
}

// How many teams the bracket will likely have, before it's generated.
// How many teams the bracket will actually be built from. This has to mirror the server's real
// selection rule (finalizeOpenTeams): only FULL teams enter, and maxTeams caps how many of them
// do - anything beyond that is a reserve. Counting every team, forming ones included, made the
// preview invent rounds that could never exist: 8 full teams plus 2 half-built ones projected a
// 10-team bracket with an extra round.
function projectedTeamCount() {
  const size = (T.competition === 'ffa') ? 1 : (T.teamSize || 1);
  const cap = T.maxTeams > 0 ? T.maxTeams : Infinity;
  if (T.teams && T.teams.length) {
    // Once the bracket is generated, t.teams IS the entering set - take it as-is.
    if (T.status !== 'signup') return Math.min(T.teams.length, cap);
    const full = T.teams.filter(tm => (tm.playerIds || []).length >= size).length;
    if (full) return Math.min(full, cap);
  }
  if (T.maxTeams) return T.maxTeams;
  return Math.min(Math.floor((T.players || []).length / Math.max(size, 1)), cap);
}

// The round keys this bracket will have. Uses real matches once generated, otherwise
// projects them from the expected team count so pools can be assigned during signups.
function projectedRoundKeys() {
  // real bracket wins
  const real = [], seen = {};
  for (const m of (T.matches || [])) {
    if (m.bracket === 'ffa') continue;
    const k = m.bracket + ':' + m.round;
    if (!seen[k]) { seen[k] = 1; real.push(k); }
  }
  if (real.length) return { keys: real, projected: false, teams: T.teams.length };

  const n = projectedTeamCount();
  if (n < 2 || T.competition === 'ffa') return { keys: [], projected: true, teams: n };
  const keys = [];
  if (T.bracketType === 'swiss') {
    // swiss round count is chosen at start; ceil(log2(teams)) is the usual default
    const r = Math.max(log2i(nextPow2(n)), 1);
    for (let i = 1; i <= r; i++) keys.push('sw:' + i);
    if (!T.plan || T.plan.final !== 0) keys.push('gf:1');
  } else {
    const R = log2i(nextPow2(n));
    for (let i = 1; i <= R; i++) keys.push('wb:' + i);
    if (T.bracketType === 'single' && thirdPlaceOn(T) && n >= 4 && !((T.divisions || 0) > 1)) keys.push('3p:' + R);
    if (T.bracketType === 'double') {
      const lbR = Math.max(2 * R - 2, 0);
      for (let i = 1; i <= lbR; i++) keys.push('lb:' + i);
      keys.push('gf:1');
    }
  }
  return { keys, projected: true, teams: n };
}

// a readable label for a round-assignment key - matches the names used in the bracket. With a
// division it is that division's own round (its final is "Final" however many rounds it has).
function roundKeyLabel(bracket, round, division) {
  round = parseInt(round, 10);
  if (bracket === 'gf') return 'Grand final';
  if (bracket === '3p') return '3rd place match';
  if (bracket === 'sw') return 'Swiss round ' + round;
  if (bracket === 'ffa') return 'FFA round ' + round;
  // deepest round in this bracket - from real matches, or projected during signups
  let maxR = 0;
  for (const m of (T.matches || [])) if (m.bracket === bracket && m.round > maxR && (!division || (m.division || 0) === division)) maxR = m.round;
  if (!maxR) {
    const n = projectedTeamCount();
    if (n >= 2) {
      const R = log2i(nextPow2(n));
      maxR = (bracket === 'lb') ? Math.max(2 * R - 2, 0) : R;
    }
  }
  if (bracket === 'lb') return round === maxR ? 'Losers final' : 'Losers round ' + round;
  if (bracket === 'wb') {
    if (T.bracketType === 'double') return round === maxR ? 'Winners final' : 'Winners round ' + round;
    if (round === maxR) return 'Final';
    if (round === maxR - 1) return 'Semifinals';
    if (round === maxR - 2) return 'Quarterfinals';
    return 'Round ' + round;
  }
  return bracket + ' ' + round;
}

// create/edit a map pool: name, which maps are in it, and its ban/pick order
// Copy this pool's ban/pick order onto other pools. Only pools with the same map count are
// eligible (the order length is fixed by map count), and those share the same Bo.
function copyPoolSequence(src) {
  if (!src) return;
  const srcSize = (src.mapIds || []).length;
  const eligible = (T.mapPools || []).filter(p => p.id !== src.id && (p.mapIds || []).length === srcSize);
  const others = (T.mapPools || []).filter(p => p.id !== src.id && (p.mapIds || []).length !== srcSize);
  const doCopy = async (body, msg) => {
    try {
      const r = await api('/api/t/' + T.id + '/pool_copy_sequence', Object.assign({ sourceId: src.id, admin: adminToken() }, body));
      closeModal();
      toast(msg(r));
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  if (!eligible.length) {
    modal(`<h3>Copy ban/pick order</h3>
      <p class="muted small">The order from <strong>${esc(src.name)}</strong> can only go to pools with the same number of maps (${srcSize}), because the order length is fixed by the map count. You have no other ${srcSize}-map pools right now.</p>
      ${others.length ? '<p class="muted small">Different-size pools (need their own order): ' + others.map(p => esc(p.name) + ' (' + (p.mapIds || []).length + ')').join(', ') + '</p>' : ''}
      <div class="actions"><button class="btn ghost" id="cpClose">Close</button></div>`, root => {
      root.querySelector('#cpClose').onclick = closeModal;
    });
    return;
  }
  modal(`<h3>Copy ban/pick order from "${esc(src.name)}"</h3>
    <p class="muted small">This copies the order (and Bo${src.bo || 1}) onto other <strong>${srcSize}-map</strong> pools. Pools with a different map count aren't shown \u2014 they need their own order.</p>
    <div class="pick-rows" style="margin-top:6px">${eligible.map(p => `<label class="pick-row" style="cursor:pointer">
      <span class="pr-name"><input type="checkbox" class="cpTarget" value="${p.id}" style="width:auto;margin-right:8px">${esc(p.name)} <span class="muted small">Bo${p.bo || 1}${(p.sequence || []).length ? '' : ' \u00b7 no order yet'}</span></span>
    </label>`).join('')}</div>
    ${others.length ? '<p class="muted small" style="margin-top:8px">Not eligible (different size): ' + others.map(p => esc(p.name) + ' (' + (p.mapIds || []).length + ')').join(', ') + '</p>' : ''}
    <div class="actions" style="flex-wrap:wrap;gap:8px">
      <button class="btn ghost" id="cpCancel">Cancel</button>
      <button class="btn" id="cpAll">Apply to all ${srcSize}-map pools (${eligible.length})</button>
      <button class="btn primary" id="cpSel">Apply to selected</button>
    </div>`, root => {
    root.querySelector('#cpCancel').onclick = closeModal;
    root.querySelector('#cpAll').onclick = () => doCopy({ applyAll: 1 }, r => 'Applied to ' + r.applied + ' pool' + (r.applied === 1 ? '' : 's'));
    root.querySelector('#cpSel').onclick = () => {
      const ids = Array.from(root.querySelectorAll('.cpTarget:checked')).map(c => c.value);
      if (!ids.length) return toast('Pick at least one pool, or use "Apply to all"', true);
      doCopy({ targetIds: ids }, r => 'Applied to ' + r.applied + ' pool' + (r.applied === 1 ? '' : 's'));
    };
  });
}

function editPool(existing) {
  const pool = existing || { name: '', mapIds: [], sequence: [] };
  const db = T.mapDb || [];
  let vseq = (pool.sequence || []).map(s => ({ action: s.action, team: s.team }));
  const pubAt = splitDateTimeUTC(pool.publishAt || '');
  const body = `
    <h3>${existing ? 'Edit pool' : 'New pool'}</h3>
    <label>Pool name</label>
    <input type="text" id="plName" maxlength="40" value="${esc(pool.name)}" placeholder="e.g. Finals pool" autocomplete="off">
    <label style="margin-top:12px">Maps in this pool <span id="plCountLbl" class="h2-strong"></span></label>
    <div class="pick-rows" id="plMaps">
      ${db.map(m => `<button type="button" class="pick-row${(pool.mapIds || []).indexOf(m.id) >= 0 ? ' on' : ''}" data-mapid="${m.id}"><span class="pr-name">${esc(m.name)}</span>${!m.published ? '<span class="idbadge late">hidden</span>' : ''}<span class="pr-tick"></span></button>`).join('')}
    </div>
    <div class="pick-count" id="plCount"></div>

    <label style="margin-top:14px">These matches are</label>
    <select id="plBo" style="max-width:220px">
      ${[1,3,5,7].map(n => `<option value="${n}"${(pool.bo || 1) === n ? ' selected' : ''}>Best of ${n}</option>`).join('')}
    </select>

    <label style="margin-top:14px">Ban / pick order for this pool</label>
    <p class="muted small">Captains work through these steps for any match using this pool. Every map but one is banned or picked; the last one left is the decider. So the order needs exactly <strong>(maps − 1)</strong> steps, and one pick per game except the decider.</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <span class="muted small" style="align-self:center">Fill with:</span>
      <button class="btn ghost small" id="plFillBans">Standard order</button>
      <button class="btn ghost small" id="plClear">Clear</button>
    </div>
    <div id="plSeq" class="vseq"></div>
    <div class="row" style="gap:6px;margin-top:8px">
      <button class="btn ghost small" data-plAdd="ban:A">+ A bans</button>
      <button class="btn ghost small" data-plAdd="ban:B">+ B bans</button>
      <button class="btn ghost small" data-plAdd="pick:A">+ A picks</button>
      <button class="btn ghost small" data-plAdd="pick:B">+ B picks</button>
    </div>
    <div id="plSummary" class="veto-summary"></div>

    <label style="margin-top:14px">Publish this pool at <span class="muted small">(UTC, optional \u2014 leave empty to publish it yourself)</span></label>
    <div style="display:flex;gap:8px"><input type="date" id="plPubDate" value="${esc(pubAt.date)}" style="flex:1"><input type="time" id="plPubTime" value="${esc(pubAt.time)}" style="width:130px"></div>
    <p class="muted small" style="margin:6px 0 0">${existing && existing.published
      ? 'Already published, so a schedule does nothing here.'
      : 'When the time passes, the pool and every map in it become visible to players.'}</p>

    <div class="actions"><button class="btn ghost" id="plCancel">Cancel</button><button class="btn primary" id="plSave">${existing ? 'Save' : 'Create pool'}</button></div>`;
  modal(body, root => {
    const selectedIds = () => Array.from(root.querySelectorAll('#plMaps .pick-row.on')).map(b => b.dataset.mapid);

    const renderSeq = () => {
      const host = root.querySelector('#plSeq');
      const nMaps = selectedIds().length;
      const need = Math.max(nMaps - 1, 0);
      if (vseq.length === 0) host.innerHTML = '<div class="muted small" style="padding:6px 0">No steps yet.</div>';
      else host.innerHTML = vseq.map((s, i) => `<div class="vstep">
        <span class="vstep-n">${i + 1}</span>
        <span class="vstep-team team-${s.team}">Team ${s.team}</span>
        <span class="vstep-act ${s.action}">${s.action === 'ban' ? 'BAN' : 'PICK'}</span>
        <span class="vstep-ctl">
          <button data-plup="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button data-pldown="${i}" ${i === vseq.length - 1 ? 'disabled' : ''}>▼</button>
          <button data-pldel="${i}" class="vstep-del">✕</button>
        </span></div>`).join('');
      const cnt = root.querySelector('#plCount');
      if (cnt) cnt.textContent = nMaps ? nMaps + ' map' + (nMaps === 1 ? '' : 's') + ' selected' : 'Click maps to add them to this pool';
      const cntLbl = root.querySelector('#plCountLbl');
      if (cntLbl) cntLbl.textContent = '(' + nMaps + ' selected \u2014 needs ' + need + ' ban/pick step' + (need === 1 ? '' : 's') + ')';
      const bo = parseInt(root.querySelector('#plBo').value, 10);
      const picks = vseq.filter(s => s.action === 'pick').length;
      const sum = root.querySelector('#plSummary');
      const problems = [];
      if (nMaps && vseq.length !== need) problems.push(`needs <strong>${need}</strong> step${need === 1 ? '' : 's'} for ${nMaps} maps, has <strong>${vseq.length}</strong>`);
      if (vseq.length && picks !== bo - 1) problems.push(`Bo${bo} needs <strong>${bo - 1}</strong> pick${bo - 1 === 1 ? '' : 's'}, has <strong>${picks}</strong>`);
      if (!nMaps) sum.innerHTML = '<span class="muted">Pick some maps first.</span>';
      else if (problems.length) sum.innerHTML = '<span class="warn">' + problems.join(' &middot; ') + '</span>';
      else sum.innerHTML = `<span class="ok-msg">Valid: ${vseq.length} step${vseq.length === 1 ? '' : 's'} over ${nMaps} maps &rarr; ${bo} game${bo === 1 ? '' : 's'} (Bo${bo}).</span>`;
      host.querySelectorAll('[data-pldel]').forEach(b => b.onclick = () => { vseq.splice(+b.dataset.pldel, 1); renderSeq(); });
      host.querySelectorAll('[data-plup]').forEach(b => b.onclick = () => { const i = +b.dataset.plup; if (i > 0) { [vseq[i-1], vseq[i]] = [vseq[i], vseq[i-1]]; renderSeq(); } });
      host.querySelectorAll('[data-pldown]').forEach(b => b.onclick = () => { const i = +b.dataset.pldown; if (i < vseq.length - 1) { [vseq[i+1], vseq[i]] = [vseq[i], vseq[i+1]]; renderSeq(); } });
    };

    root.querySelectorAll('#plMaps .pick-row').forEach(btn => btn.onclick = () => {
      btn.classList.toggle('on');
      renderSeq();
    });
    root.querySelector('#plBo').onchange = renderSeq;
    // standard order: alternate bans down to the picks, then alternate picks (last map = decider)
    root.querySelector('#plFillBans').onclick = () => {
      const need = Math.max(selectedIds().length - 1, 0);
      const bo = parseInt(root.querySelector('#plBo').value, 10);
      const wantPicks = bo - 1;
      if (need < wantPicks) { toast('Add more maps first — Bo' + bo + ' needs at least ' + (wantPicks + 1) + ' maps', true); return; }
      vseq = [];
      const bans = need - wantPicks;
      for (let i = 0; i < bans; i++) vseq.push({ action: 'ban', team: i % 2 === 0 ? 'A' : 'B' });
      for (let i = 0; i < wantPicks; i++) vseq.push({ action: 'pick', team: i % 2 === 0 ? 'A' : 'B' });
      renderSeq();
    };
    root.querySelector('#plClear').onclick = () => { vseq = []; renderSeq(); };
    root.querySelectorAll('[data-plAdd]').forEach(b => b.onclick = () => {
      const [action, team] = b.dataset.pladd.split(':');
      vseq.push({ action, team });
      renderSeq();
    });
    renderSeq();

    root.querySelector('#plCancel').onclick = closeModal;
    root.querySelector('#plSave').onclick = async () => {
      const name = root.querySelector('#plName').value.trim();
      if (!name) return toast('Pool name required', true);
      const mapIds = selectedIds();
      const bo = parseInt(root.querySelector('#plBo').value, 10);
      if (vseq.length && mapIds.length && vseq.length !== mapIds.length - 1) {
        return toast(mapIds.length + ' maps needs exactly ' + (mapIds.length - 1) + ' steps — you have ' + vseq.length, true);
      }
      const nPicks = vseq.filter(x => x.action === 'pick').length;
      if (vseq.length && nPicks !== bo - 1) {
        return toast('A Bo' + bo + ' pool needs exactly ' + (bo - 1) + ' pick step(s) — you have ' + nPicks, true);
      }
      try {
        await api('/api/t/' + T.id + '/pool_save', {
          id: existing ? pool.id : undefined, name, mapIds, sequence: vseq, bo,
          publishAt: combineDateTimeUTC(root.querySelector('#plPubDate'), root.querySelector('#plPubTime')),
          admin: adminToken()
        });
        closeModal(); toast(existing ? 'Pool saved' : 'Pool created'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// Assign a pool to rounds. Works before the bracket is generated by projecting the rounds
// from the expected team count, so organizers can prep everything during signups.
function assignPool(pool) {
  const proj = projectedRoundKeys();
  const roundKeys = proj.keys;
  if (roundKeys.length === 0) {
    modal(`<h3>Assign "${esc(pool.name)}"</h3>
      <p class="muted small">${T.competition === 'ffa'
        ? 'FFA rounds don\'t use map vetoes.'
        : 'Not enough signups yet to work out how many rounds there will be. Add players (or set a team cap on the Admin tab) and this will fill in.'}</p>
      <div class="actions"><button class="btn ghost" id="paClose">Close</button></div>`, root => {
      root.querySelector('#paClose').onclick = closeModal;
    });
    return;
  }
  const rows = roundKeys.map(k => {
    const [bk, rd] = k.split(':');
    const assignedHere = T.poolAssign[k] === pool.id;
    const assignedOther = T.poolAssign[k] && T.poolAssign[k] !== pool.id;
    const otherName = assignedOther ? ((T.mapPools.find(p => p.id === T.poolAssign[k]) || {}).name || '') : '';
    // the pool is built for one series length; flag rounds that don't match
    const rbos = {};
    for (const mm of (T.matches || [])) if (mm.bracket === bk && mm.round === parseInt(rd, 10)) rbos[mm.bo] = 1;
    const boList = Object.keys(rbos).map(x => parseInt(x, 10));
    const mismatch = boList.length && boList.indexOf(pool.bo || 1) < 0;
    return `<button type="button" class="pick-row${assignedHere ? ' on' : ''}" data-rkey="${k}"><span class="pr-name">${esc(roundKeyLabel(bk, rd))}</span>${boList.length ? '<span class="muted small">Bo' + boList.join('/') + '</span>' : ''}${mismatch ? '<span class="warn small">pool is Bo' + (pool.bo || 1) + '</span>' : ''}${assignedOther ? '<span class="muted small">(currently: ' + esc(otherName) + ')</span>' : ''}<span class="pr-tick"></span></button>`;
  }).join('');
  modal(`<h3>Assign "${esc(pool.name)}" to rounds</h3>
    <p class="muted small">Tick the rounds that use this pool. Unticking clears it (that round falls back to the default pool).</p>
    ${proj.projected ? '<p class="muted small">Planning ahead for <strong>' + proj.teams + ' teams</strong> — these are the rounds you\'ll get. If the entry count changes the bracket may gain or lose a round, so check back before you generate it.</p>' : ''}
    <div class="pick-rows">${rows}</div>
    <div class="actions"><button class="btn ghost" id="paCancel">Cancel</button><button class="btn primary" id="paSave">Save</button></div>`, root => {
    root.querySelectorAll('.pick-row').forEach(btn => btn.onclick = () => btn.classList.toggle('on'));
    root.querySelector('#paCancel').onclick = closeModal;
    root.querySelector('#paSave').onclick = async () => {
      const checked = {};
      root.querySelectorAll('.pick-row.on').forEach(b => { checked[b.dataset.rkey] = 1; });
      try {
        for (const k of roundKeys) {
          const want = !!checked[k];
          const isThis = T.poolAssign[k] === pool.id;
          if (want && !isThis) await api('/api/t/' + T.id + '/pool_assign', { key: k, poolId: pool.id, admin: adminToken() });
          else if (!want && isThis) await api('/api/t/' + T.id + '/pool_assign', { key: k, poolId: '', admin: adminToken() });
        }
        closeModal(); toast('Assignments saved'); await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

// Dedicated Vetoes page - each match with a veto gets its own card with the full ban/pick UI.
// A tournament played in parts gets a sub-page per part: the Swiss stage and its playoffs, or
// each division's bracket. Within a page: what needs action first, then the results, each in
// playing order with the newest on top. A follow box narrows the page to one team or player.
function vetoStageKey(m) {
  if (divisionsOnT() && m.division) return 'd' + m.division;
  if (T.bracketType === 'swiss') return m.bracket === 'sw' ? 'swiss' : 'playoffs';
  return 'all';
}
function vetoStageLabel(key) {
  if (key === 'swiss') return 'Swiss stage';
  if (key === 'playoffs') return T.stage2 ? 'Playoffs' : 'Final';
  if (key.charAt(0) === 'd') return divisionNameOf(parseInt(key.slice(1), 10) || 1);
  return 'All matches';
}
function vetoStageOrder(key) {
  if (key === 'swiss') return 0;
  if (key === 'playoffs') return 1;
  return key.charAt(0) === 'd' ? (parseInt(key.slice(1), 10) || 0) : 0;
}

function drawVetoes(el) {
  const myTeamId = (T.viewer && (T.viewer.memberTeamId || T.viewer.teamId)) || null;
  // A match belongs on this tab if it has a map veto OR a faction veto. With map vetoes off but
  // faction vetoes on, the card lists the series' game slots purely so the factions have rows.
  const allMatches = T.matches.filter(m => (m.veto || m.fveto) && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE');
  if (!allMatches.length) {
    el.innerHTML = '<div class="panel"><div class="empty">No vetoes are active right now. They appear here as matches become ready.</div></div>';
    return;
  }

  // ---- who the page follows ----
  const inMatches = new Set();
  for (const m of allMatches) { inMatches.add(m.team1); inMatches.add(m.team2); }
  const teams = (T.teams || []).filter(x => inMatches.has(x.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const solo = T.teamSize === 1;
  const players = solo ? [] : (T.players || []).filter(p => p.teamId && inMatches.has(p.teamId)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  let follow = getVetoFollow();
  let followTeam = null, followName = '';
  if (follow === 'mine') {
    if (myTeamId) { followTeam = myTeamId; followName = 'You'; } else follow = 'all';
  } else if (follow.indexOf('t:') === 0) {
    const tm = teams.find(x => x.id === follow.slice(2));
    if (tm) { followTeam = tm.id; followName = tm.name; } else follow = 'all';
  } else if (follow.indexOf('p:') === 0) {
    const p = players.find(x => x.id === follow.slice(2));
    if (p) { followTeam = p.teamId; followName = p.name; } else follow = 'all';
  } else follow = 'all';
  const inFollow = m => !followTeam || m.team1 === followTeam || m.team2 === followTeam;
  const countOf = id => allMatches.filter(m => m.team1 === id || m.team2 === id).length;
  const opt = (v, label) => '<option value="' + esc(v) + '"' + (v === follow ? ' selected' : '') + '>' + esc(label) + '</option>';
  const followBox = `<div class="veto-follow"><span class="muted small">Follow</span>
    <select id="vetoFollow" title="Show only the matches of one team or player">
      ${opt('all', 'All matches (' + allMatches.length + ')')}
      ${myTeamId ? opt('mine', 'My matches (' + countOf(myTeamId) + ')') : ''}
      <optgroup label="${solo ? 'Players' : 'Teams'}">${teams.map(x => opt('t:' + x.id, x.name + ' (' + countOf(x.id) + ')')).join('')}</optgroup>
      ${players.length ? '<optgroup label="Players">' + players.map(p => opt('p:' + p.id, p.name + ' - ' + teamName(p.teamId))).join('') + '</optgroup>' : ''}
    </select></div>`;

  // ---- which part of the tournament ----
  const keys = Array.from(new Set(allMatches.map(vetoStageKey))).sort((a, b) => vetoStageOrder(a) - vetoStageOrder(b));
  const shown = allMatches.filter(inFollow);
  const nIn = k => shown.filter(m => vetoStageKey(m) === k).length;
  let stage = (_vetoStage && _vetoStage.tid === T.id && keys.indexOf(_vetoStage.key) >= 0) ? _vetoStage.key : null;
  if (!stage) {
    // The latest part with something to show (the playoffs once they exist); for divisions the top
    // one that has anything.
    const withAny = keys.filter(k => nIn(k) > 0);
    const divs = keys[0].charAt(0) === 'd';
    stage = withAny.length ? (divs ? withAny[0] : withAny[withAny.length - 1]) : keys[keys.length - 1];
  }
  const stageBar = keys.length > 1 ? '<div class="subtabs">' + keys.map(k =>
    '<button class="subtab' + (k === stage ? ' active' : '') + '" data-vstage="' + esc(k) + '">' + esc(vetoStageLabel(k)) + ' (' + nIn(k) + ')</button>').join('') + '</div>' : '';
  const bar = '<div class="veto-bar">' + stageBar + followBox + '</div>';
  const inStage = allMatches.filter(m => vetoStageKey(m) === stage);
  const vetoMatches = inStage.filter(inFollow);

  const wireBar = () => {
    el.querySelectorAll('[data-vstage]').forEach(b => b.onclick = (e) => {
      e.preventDefault();
      _vetoStage = { tid: T.id, key: b.dataset.vstage };
      drawTournament();
    });
    const sel = el.querySelector('#vetoFollow');
    if (sel) sel.onchange = () => {
      setVetoFollow(sel.value);
      _vetoStage = null;   // land on the part where the new choice has matches
      sel.blur();
      drawTournament();
    };
    const all = el.querySelector('[data-vfollow-all]');
    if (all) all.onclick = (e) => { e.preventDefault(); setVetoFollow('all'); drawTournament(); };
  };

  if (!vetoMatches.length) {
    const where = keys.length > 1 ? ' in the ' + vetoStageLabel(stage) : '';
    const elsewhere = keys.filter(k => k !== stage && nIn(k) > 0)
      .map(k => '<a href="#" data-vstage="' + esc(k) + '">' + esc(vetoStageLabel(k)) + ' (' + nIn(k) + ')</a>');
    const who = follow === 'mine' ? 'You have' : esc(followName) + ' has';
    el.innerHTML = bar + '<div class="panel"><div class="empty">' + (followTeam
      ? who + ' no matches with a veto' + esc(where) + ' yet.'
        + (elsewhere.length ? ' See ' + elsewhere.join(', ') + '.' : '')
        + (inStage.length ? ' <a href="#" data-vfollow-all>Show all matches</a>' : '')
      : 'No vetoes' + esc(where) + ' yet.') + '</div></div>';
    wireBar();
    return;
  }
  // A veto is settled once it completes OR once the match has a result - a forfeit or an
  // organizer correction can decide a match mid-veto, and that veto can never be acted on again.
  const settled = m => (m.veto ? m.veto.done : factionAllDone(m)) || m.status === 'done';
  const pending = sortByPlay(vetoMatches.filter(m => !settled(m)), true);
  const done = sortByPlay(vetoMatches.filter(settled), true);

  let html = '';
  const card = (m) => {
    const label = mLabelFull(m);
    const chatLink = matchChatAllowed(m) ? `<a href="#" class="veto-mini-link" data-vchat="${m.id}">\u{1F4AC} Match chat${unreadDot('match:' + m.id)}</a>` : '';
    const nameHtml = (tid) => {
      const real = T.teams && T.teams.some(t => t.id === tid);
      return `<span class="${real ? 'vteam-name' : ''}"${real ? ' data-teamid="' + esc(tid) + '"' : ''}>${esc(bracketLabel(tid))}</span>`;
    };
    const unfinished = (m.status === 'done') && m.veto && (m.veto.abandoned || !vetoRanToCompletion(m.veto));
    const isDone = m.veto ? m.veto.done : factionAllDone(m);
    const doneTag = unfinished
      ? '<span class="veto-done-tag closed">CLOSED</span>'
      : (isDone ? '<span class="veto-done-tag">RESULT</span>' : '');
    return `<div class="panel section veto-card${isDone ? ' veto-done' : ''}" data-vmatch="${m.id}">
      <div class="veto-card-head"><h2>${doneTag}${esc(label)}</h2><span class="veto-card-teams">${nameHtml(m.team1)} <span class="muted">vs</span> ${nameHtml(m.team2)}</span></div>
      <div class="veto-card-body"></div>
      ${chatLink ? '<div class="veto-card-foot">' + chatLink + '</div>' : ''}
    </div>`;
  };

  // ---- veto statistics (finished tournament; organizers, official-tourney directors, site admins) ----
  // Over every veto on this page, whoever is followed: a stage usually has its own map pool.
  const canSeeStats = viewerIsOrganizer()
    || (fafAuth.user && fafAuth.user.director && T.category === 'official');
  if (T.status === 'finished' && canSeeStats) {
    const banCount = {}, playCount = {}, seen = {};
    for (const m of inStage) {
      const v = m.veto; if (!v) continue;
      for (const b of (v.banned || [])) { if (b.map) { banCount[b.map] = (banCount[b.map] || 0) + 1; seen[b.map] = 1; } }
      for (const pk of (v.picks || [])) { if (pk.map) { playCount[pk.map] = (playCount[pk.map] || 0) + 1; seen[pk.map] = 1; } }
      if (v.decider && v.decider.map) { playCount[v.decider.map] = (playCount[v.decider.map] || 0) + 1; seen[v.decider.map] = 1; }
    }
    const ids = Object.keys(seen);
    if (ids.length) {
      const totalBans = ids.reduce((s, id) => s + (banCount[id] || 0), 0);
      const totalPlays = ids.reduce((s, id) => s + (playCount[id] || 0), 0);
      const barRow = (id, n, denom, cls) => {
        return `<div class="vstat-row"><span class="vstat-name">${esc(mapName(id))}</span>
          <span class="vstat-bar"><span class="vstat-fill ${cls}" style="width:${denom ? Math.max(4, n / Math.max(1, denom) * 100) : 0}%"></span></span>
          <span class="vstat-num">${n}</span></div>`;
      };
      const banRows = ids.slice().filter(id => banCount[id]).sort((a, b) => (banCount[b] || 0) - (banCount[a] || 0))
        .map(id => barRow(id, banCount[id], Math.max(...ids.map(x => banCount[x] || 0)), 'ban')).join('');
      const playRows = ids.slice().filter(id => playCount[id]).sort((a, b) => (playCount[b] || 0) - (playCount[a] || 0))
        .map(id => barRow(id, playCount[id], Math.max(...ids.map(x => playCount[x] || 0)), 'play')).join('');
      const nDone = inStage.filter(m => m.veto && m.veto.done).length;
      html += `<div class="panel section vstat-panel">
        <div class="veto-card-head"><h2>Veto statistics</h2><span class="muted small">Organizers only</span></div>
        <p class="muted small">Across ${nDone} completed veto${nDone === 1 ? '' : 's'}${keys.length > 1 ? ' in the ' + esc(vetoStageLabel(stage)) : ''} - ${totalBans} bans, ${totalPlays} maps played.</p>
        <div class="vstat-cols">
          <div class="vstat-col"><div class="vstat-h">Most banned</div>${banRows || '<div class="muted small">No bans.</div>'}</div>
          <div class="vstat-col"><div class="vstat-h">Most played</div>${playRows || '<div class="muted small">No maps played.</div>'}</div>
        </div>
      </div>`;
    }
  }

  if (pending.length) {
    html += '<div class="veto-section-label">In progress - needs action</div>';
    html += pending.map(card).join('');
  }
  if (done.length) {
    html += '<div class="veto-section-label"' + (pending.length ? ' style="margin-top:20px"' : '') + '>Completed - maps decided</div>';
    html += done.map(card).join('');
  }
  el.innerHTML = bar + html;
  wireBar();

  // render the veto UI into each card body and wire it
  for (const m of vetoMatches) {
    const cardEl = el.querySelector(`[data-vmatch="${m.id}"]`);
    if (!cardEl) continue;
    const bodyEl = cardEl.querySelector('.veto-card-body');
    bodyEl.innerHTML = vetoHTML(m);
    wireVeto(bodyEl, m);
    wireFactionVeto(bodyEl);
    const vchat = cardEl.querySelector('[data-vchat]');
    if (vchat) vchat.onclick = (e) => { e.preventDefault(); openMatchChat(m); };
    // map thumbnails open the full preview. Only wired on the tab, not inside the match-details
    // popup, where opening another modal would replace the popup the user is reading.
    cardEl.querySelectorAll('[data-map-info]').forEach(t => t.onclick = () => showMapInfo(t.dataset.mapInfo));
    cardEl.querySelectorAll('[data-teamid]').forEach(nameEl => {
      nameEl.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showTeamPopup(nameEl.dataset.teamid); };
    });
  }
}

// veto section HTML for a match (empty string if no veto)
// Rebuild the veto's actions in the true order they happened. `banned` and `picks` are each
// appended in step order, but interleaved bans/picks lose their relative order across the two
// arrays — the sequence tells us which array the next completed step came from.
function vetoOrderedLog(v) {
  if (!v || !Array.isArray(v.sequence)) return [];
  const bans = (v.banned || []).slice();
  const picks = (v.picks || []).slice().sort((a, b) => a.game - b.game);
  let bi = 0, pi = 0;
  const out = [];
  const doneSteps = Math.min(v.done ? v.sequence.length : (v.stepIndex || 0), v.sequence.length);
  for (let i = 0; i < doneSteps; i++) {
    const st = v.sequence[i];
    if (!st) break;
    if (st.action === 'ban') {
      const b = bans[bi++];
      if (b) out.push({ n: i + 1, action: 'ban', by: b.by, map: b.map });
    } else {
      const p = picks[pi++];
      if (p) out.push({ n: i + 1, action: 'pick', by: p.by, map: p.map, game: p.game });
    }
  }
  return out;
}

// Ordered "who did what" list for a veto — the step number, the team, and the map.
// Did the captains actually work through the whole sequence, or was the veto cut short?
function vetoRanToCompletion(v) {
  if (!v || !Array.isArray(v.sequence)) return false;
  if (v.abandoned) return false;
  return (v.stepIndex || 0) >= v.sequence.length || !!v.decider;
}

function vetoLogHTML(v) {
  const log = vetoOrderedLog(v);
  if (!log.length) return '';
  // small map preview per row; banned maps are dimmed. Clicking opens the full map lightbox.
  const thumb = (id, banned) => {
    const mo = mapObj(id);
    if (mo && mo.image) {
      return `<img class="vlog-thumb${banned ? ' ban' : ''}" src="/map-images/${encodeURIComponent(mo.image)}" alt="" loading="lazy" decoding="async" width="34" height="34" data-map-info="${esc(id)}">`;
    }
    return `<span class="vlog-noimg"${mo ? ' data-map-info="' + esc(id) + '"' : ''}${mo && mo.masked ? ' title="Hidden until it is played"' : ''}></span>`;
  };
  const rows = log.map(e => `<div class="vlog-row with-thumb">
      <span class="vlog-n">${e.n}</span>
      <span class="vlog-act ${e.action}">${e.action === 'ban' ? 'BAN' : 'PICK'}</span>
      ${thumb(e.map, e.action === 'ban')}
      <span class="vlog-team" title="${esc(teamName(e.by))}">${esc(bracketLabel(e.by))}</span>
      <span class="vlog-map">${esc(mapName(e.map))}${e.action === 'pick' && e.game ? ' <span class="muted">(Game ' + e.game + ')</span>' : ''}</span>
    </div>`).join('');
  const dec = v.decider
    ? `<div class="vlog-row decider with-thumb"><span class="vlog-n">\u2605</span><span class="vlog-act dec">DECIDER</span>${thumb(v.decider.map, false)}<span class="vlog-team muted">last map standing</span><span class="vlog-map">${esc(mapName(v.decider.map))}${v.decider.game ? ' <span class="muted">(Game ' + v.decider.game + ')</span>' : ''}</span></div>`
    : '';
  return `<div class="veto-log"><div class="veto-head">Ban / pick order</div>${rows}${dec}</div>`;
}

// Are every game's factions resolved for this match?
function factionAllDone(m) {
  if (!m.fveto || !m.fveto.games) return false;
  const keys = Object.keys(m.fveto.games);
  if (!keys.length) return false;
  return keys.every(k => !!m.fveto.games[k].result);
}

// Card body when the tournament runs faction vetoes WITHOUT map vetoes: the series' game slots
// are listed as plain "1st map / 2nd map / ..." labels (no map is being chosen here) so the
// faction column has a row to sit beside.
function factionOnlyHTML(m) {
  const n = m.bo || 1;
  const rows = [];
  for (let g = 1; g <= n; g++) rows.push({ game: g });
  let h = '<div class="vetobox' + (factionAllDone(m) ? ' done' : '') + '">';
  h += '<div class="veto-head">Factions <span class="muted small">- no map veto for this match, so games are listed by number</span></div>';
  h += vetoGamesTableHTML(m, rows);
  h += '</div>';
  return h;
}

// The games of a series as one aligned table: the game, its map (marked if it was the decider),
// then each side's faction. The teams are named once, in the header, and every row lines up
// however long its map's name is. A faction choice still open spans both team columns.
function vetoGamesTableHTML(m, rows) {
  const hasMap = rows.some(r => r.map);
  const fv = !!(m.fveto && m.fveto.games);
  const teamTh = tid => '<th class="vgt-f" title="' + esc(teamName(tid) || '') + '">' + esc(bracketLabel(tid) || '') + '</th>';
  const head = '<thead><tr><th class="vgt-n">Game</th>' + (hasMap ? '<th class="vgt-map">Map</th>' : '') + (fv ? teamTh(m.team1) + teamTh(m.team2) : '') + '</tr></thead>';
  const body = rows.map(r => {
    let f = '';
    if (fv) {
      const g = m.fveto.games[String(r.game)];
      if (g && g.result) {
        f = '<td class="vgt-f">' + factionChip(g.result.t1, {}) + '</td><td class="vgt-f">' + factionChip(g.result.t2, {}) + '</td>';
      } else {
        const inner = factionGameHTML(m, r.game);
        f = '<td class="vgt-fwide" colspan="2">' + (inner || '<span class="muted small">-</span>') + '</td>';
      }
    }
    const map = hasMap ? '<td class="vgt-map">' + (r.map ? mapChip(r.map, 'play') : '') + (r.decider ? '<span class="vg-dec">decider</span>' : '') + '</td>' : '';
    return '<tr><td class="vgt-n">' + r.game + '</td>' + map + f + '</tr>';
  }).join('');
  return '<table class="vgt">' + head + '<tbody>' + body + '</tbody></table>';
}

function vetoHTML(m) {
  if (!m.veto) return m.fveto ? factionOnlyHTML(m) : '';
  const v = m.veto;
  // Treat a veto on a finished match as closed even if older stored data says otherwise - the
  // result is in, so nobody can ban or pick any more.
  const closedByResult = m.status === 'done' && !v.done;
  const myTeamId = (T.viewer && T.viewer.teamId) || null;
  const isOrg = viewerIsOrganizer();
  const nameA = v.teamA ? bracketLabel(v.teamA) : 'A';
  const nameB = v.teamB ? bracketLabel(v.teamB) : 'B';
  const banned = v.banned || [];
  const picks = (v.picks || []).slice().sort((a, b) => a.game - b.game);

  // the full ordered game list once done: picks in order, then decider
  const games = picks.slice();
  if (v.decider) games.push(v.decider);

  let h = '<div class="vetobox' + ((v.done || closedByResult) ? ' done' : '') + '">';

  const abSet = !!(v.teamA && v.teamB);

  // A/B legend
  h += `<div class="veto-ab">
    <span class="veto-abtag team-A">A: ${esc(nameA)}</span>
    <span class="veto-abtag team-B">B: ${esc(nameB)}</span>
  </div>`;
  // organizer picks A (required up front when the tournament is set to manual A/B)
  if (isOrg && v.stepIndex === 0 && !v.done) {
    h += `<div class="veto-abset${abSet ? '' : ' needed'}">
      <span class="muted small">${abSet ? 'Set Team A (acts first):' : 'Pick Team A to open this veto:'}</span>
      <button class="btn ${v.teamA === m.team1 ? 'primary' : 'ghost'} small" data-veto-seta="${m.id}" data-team="${m.team1}">${esc(teamName(m.team1))}</button>
      <button class="btn ${v.teamA === m.team2 ? 'primary' : 'ghost'} small" data-veto-seta="${m.id}" data-team="${m.team2}">${esc(teamName(m.team2))}</button>
    </div>`;
  }
  // nobody can act until A/B exists
  if (!abSet && !v.done) {
    h += '<div class="veto-wait">' + (isOrg
      ? 'Choose Team A above — the captains can\'t start until you do.'
      : 'Waiting for the organizer to set Team A / Team B for this match.') + '</div>';
    h += '</div>';
    return h;
  }

  if (v.done) {
    h += '<div class="veto-head">Maps</div>';
    h += vetoGamesTableHTML(m, games.map(g => ({ game: g.game, map: g.map, decider: g === v.decider })));
    h += vetoLogHTML(v);
    h += '</div>';
    return h;
  }

  // Settled by a result rather than by the captains: show what was decided so far, but no turn
  // prompt and no action buttons.
  if (closedByResult) {
    h += '<div class="veto-head">Veto closed \u2014 the match was decided before it finished.</div>';
    h += vetoLogHTML(v);
    h += '</div>';
    return h;
  }

  // in progress: show whose turn + what action
  const step = v.sequence[v.stepIndex];
  const turnTeam = step ? (step.team === 'A' ? v.teamA : v.teamB) : null;
  const turnName = turnTeam ? bracketLabel(turnTeam) : '';
  const actionWord = step ? (step.action === 'ban' ? 'ban' : 'pick') : '';
  const canActNow = (myTeamId && turnTeam === myTeamId) || isOrg;
  const stepsLeft = v.sequence.length - v.stepIndex;

  // BAN vs PICK is the thing captains misread, so it gets its own colour-coded badge rather than
  // being one lowercase word buried in a sentence.
  const actBadge = `<span class="veto-act veto-act-${actionWord}">${actionWord.toUpperCase()}</span>`;
  h += `<div class="veto-head veto-head-${actionWord}">Step ${v.stepIndex + 1} of ${v.sequence.length} · <strong>${esc(turnName)}</strong> to ${actBadge} <span class="muted">(${stepsLeft} left, then decider)</span></div>`;
  if (canActNow) {
    h += `<div class="veto-yourturn veto-act-${actionWord}">${myTeamId && turnTeam === myTeamId ? 'Your turn' : 'Acting for ' + esc(turnName)} \u2014 choose a map to <strong>${actionWord.toUpperCase()}</strong>. You'll be asked to confirm.</div>`;
  }

  // history so far: bans struck, picks as games
  if (banned.length || picks.length) {
    h += '<div class="veto-history">';
    if (banned.length) h += '<div class="veto-banned">' + banned.map(b => {
      const mo = mapObj(b.map);
      const th = (mo && mo.image) ? '<img class="vm-thumb dim" src="/map-images/' + encodeURIComponent(mo.image) + '" alt="" loading="lazy">' : '';
      return '<span class="veto-map vm-card banned" title="Banned by ' + esc(teamName(b.by)) + '">' + th + '<span class="vm-name">' + esc(mapName(b.map)) + '</span></span>';
    }).join('') + '</div>';
    if (picks.length) h += vetoGamesTableHTML(m, picks.map(g => ({ game: g.game, map: g.map })));
    h += '</div>';
    h += vetoLogHTML(v);
  }

  // remaining maps: clickable if it's the viewer's turn (ban or pick)
  const cls = step && step.action === 'pick' ? 'pick' : 'ban';
  // thumbnail so captains see WHICH map they're banning/picking without tab-switching
  const vThumb = (mp) => {
    const mo = mapObj(mp);
    return (mo && mo.image) ? '<img class="vm-thumb" src="/map-images/' + encodeURIComponent(mo.image) + '" alt="" loading="lazy">' : '';
  };
  h += '<div class="veto-remaining">' + (v.remaining || []).map(mp =>
    canActNow
      ? '<button class="veto-map vm-card act-' + cls + '" data-veto-map="' + esc(mp) + '">' + vThumb(mp) + '<span class="vm-name">' + esc(mapName(mp)) + '</span></button>'
      : '<span class="veto-map vm-card avail" data-map-info="' + esc(mp) + '">' + vThumb(mp) + '<span class="vm-name">' + esc(mapName(mp)) + '</span></span>'
  ).join('') + '</div>';

  // organizer undo
  if (isOrg && v.stepIndex > 0) h += '<div style="margin-top:8px"><button class="btn ghost small" data-veto-undo="' + m.id + '">↶ Undo last step</button></div>';

  h += '</div>';
  return h;
}

function wireVeto(box, m) {
  if (!m.veto) return;
  const v = m.veto;
  const step = v.sequence ? v.sequence[v.stepIndex] : null;
  const turnTeam = step ? (step.team === 'A' ? v.teamA : v.teamB) : null;

  // Two-step confirm, inline rather than a modal: the first click arms that map and turns it into
  // a "Confirm ban/pick" button, a second click commits. A misclick costs nothing - clicking any
  // other map moves the arming, and Cancel or Escape clears it. Deliberately not a popup, since a
  // dialog on every one of a dozen steps would be worse than the misclick it prevents.
  const actionWord = step ? (step.action === 'ban' ? 'ban' : 'pick') : '';
  const btns = Array.from(box.querySelectorAll('[data-veto-map]'));
  const label = (b) => {
    const tag = document.createElement('span');
    tag.className = 'vm-confirm';
    tag.textContent = 'Confirm ' + actionWord + '?';
    b.appendChild(tag);
  };
  const paint = () => {
    for (const b of btns) {
      const on = _vetoArmed && _vetoArmed.matchId === m.id && _vetoArmed.map === b.dataset.vetoMap;
      b.classList.toggle('armed', !!on);
      const lbl = b.querySelector('.vm-confirm');
      if (on && !lbl) label(b);
      if (!on && lbl) lbl.remove();
    }
  };
  const disarm = () => { _vetoArmed = null; paint(); };
  const commit = async (btn) => {
    const map = btn.dataset.vetoMap;
    btns.forEach(b => { b.disabled = true; });
    const body = { matchId: m.id, map: map, token: myToken() };
    // organizer acting on behalf of the team whose turn it is
    if (viewerIsOrganizer() && (!T.viewer || T.viewer.teamId !== turnTeam)) body.asTeam = turnTeam;
    try { _vetoArmed = null; await api('/api/t/' + T.id + '/veto_action', body); await refresh(); }
    catch (e) { toast(e.message, true); btns.forEach(b => { b.disabled = false; }); disarm(); }
  };
  for (const btn of btns) {
    btn.onclick = async () => {
      const on = _vetoArmed && _vetoArmed.matchId === m.id && _vetoArmed.map === btn.dataset.vetoMap;
      if (on) return commit(btn);
      _vetoArmed = { matchId: m.id, map: btn.dataset.vetoMap };
      paint();
    };
  }
  paint();
  // Escape or a click anywhere else clears the arming.
  box.addEventListener('keydown', e => { if (e.key === 'Escape') disarm(); });
  box.addEventListener('click', e => { if (!e.target.closest('[data-veto-map]')) disarm(); });
  box.querySelectorAll('[data-veto-seta]').forEach(btn => {
    btn.onclick = async () => {
      const teamA = btn.dataset.team;
      if (teamA === v.teamA) return; // already A
      try { await api('/api/t/' + T.id + '/veto_setab', { matchId: m.id, teamA, admin: adminToken() }); await refresh(); }
      catch (e) { toast(e.message, true); }
    };
  });
  const undo = box.querySelector('[data-veto-undo]');
  if (undo) undo.onclick = async () => {
    try { await api('/api/t/' + T.id + '/veto_undo', { matchId: m.id, admin: adminToken() }); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
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

// ---- the 3rd place match ----
// It hangs under the final, in the final's own column, the way brackets usually show it. A spacer
// of the same height above the final keeps the final centred between the semi-finals, so the
// connectors still meet it where they should. The spacer is sized after layout (and on resize),
// through the same redraw list the connectors use - and before them, since it moves the final.
function hangUnderFinal(mc, blk) {
  const stack = document.createElement('div');
  stack.className = 'bfinal-stack';
  const spacer = document.createElement('div');
  spacer.className = 'bthird-spacer';
  stack.appendChild(spacer);
  while (mc.firstChild) stack.appendChild(mc.firstChild);
  stack.appendChild(blk);
  mc.appendChild(stack);
  const size = () => { spacer.style.height = blk.offsetHeight + 'px'; };
  size();
  connectorRedraws.push(size);
}
function thirdPlaceBlock(m3) {
  const blk = document.createElement('div');
  blk.className = 'bthird';
  const head = document.createElement('div');
  head.className = 'bcol-title';
  head.textContent = '3RD PLACE';
  blk.appendChild(head);
  if (viewerIsOrganizer()) {
    const started = m3.status === 'live' || m3.status === 'done' || (Array.isArray(m3.games) && m3.games.length);
    const boWrap = document.createElement('div');
    if (!started) {
      boWrap.className = 'bcol-bo';
      boWrap.innerHTML = 'Bo <select class="bcol-bo-sel">' + [1, 3, 5, 7].map(v => '<option value="' + v + '"' + (v === m3.bo ? ' selected' : '') + '>Bo' + v + '</option>').join('') + '</select>';
      const sel = boWrap.querySelector('select');
      sel.onchange = async () => {
        try {
          await api('/api/t/' + T.id + '/set_round_bo', { bracket: '3p', round: m3.round, bo: parseInt(sel.value, 10), division: null, admin: adminToken() });
          toast('3rd place match set to Bo' + sel.value);
          await refresh();
        } catch (e) { toast(e.message, true); sel.value = m3.bo; }
      };
    } else {
      boWrap.className = 'bcol-bo muted';
      boWrap.textContent = 'Bo' + m3.bo;
    }
    blk.appendChild(boWrap);
  }
  mapsLine('3p', m3.round, blk);
  blk.appendChild(matchBox(m3));
  return blk;
}
// The organizer's switch for it, above the bracket. Only while it can still be switched: the
// tournament is running and the match itself has not started.
function thirdPlaceToolsHTML() {
  if (!viewerIsOrganizer() || T.status !== 'running' || T.earlyFinish || !thirdPlaceEligible(T)) return '';
  const m3 = thirdPlaceMatchOf(T);
  if (m3) {
    if (thirdPlaceTouched(m3)) return '';
    return `<div class="third-tools"><button class="btn ghost small" data-third="0">Remove the 3rd place match</button>
      <span class="muted small">The two beaten semi-finalists play for 3rd. It can be removed until it starts.</span></div>`;
  }
  const semis = (T.matches || []).filter(m => m.bracket === 'wb' && !(m.division || 0));
  const R = semis.reduce((a, m) => Math.max(a, m.round || 0), 0);
  const played = semis.filter(m => m.round === R - 1 && m.status === 'done').length;
  return `<div class="third-tools"><button class="btn ghost small" data-third="1">+ Add a 3rd place match</button>
    <span class="muted small">The two beaten semi-finalists play for 3rd place, so the standings have a clear 3rd and 4th.${played ? ' A semi-final already played sends its loser into it.' : ''}</span></div>`;
}
function wireThirdPlaceTools(root) {
  if (!root) return;
  root.querySelectorAll('[data-third]').forEach(b => b.onclick = async () => {
    const on = b.dataset.third === '1';
    b.disabled = true;
    try {
      await api('/api/t/' + T.id + '/third_place', { on: on ? 1 : 0, admin: adminToken() });
      toast(on ? '3rd place match added' : '3rd place match removed');
      await refresh();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  });
}

function bracketColumns(el, bracket, title, gfMatch, division) {
  const ms = T.matches.filter(m => m.bracket === bracket && (!division || (m.division || 0) === division));
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
    // Per-round Bo control (organizers only), when at least one match in the round hasn't started
    if (viewToken()) {
      const roundMs = ms.filter(x => x.round === r);
      const editable = roundMs.filter(m => m.status !== 'live' && m.status !== 'done' && !(Array.isArray(m.games) && m.games.length));
      const curBo = roundMs.length ? roundMs[0].bo : 3;
      if (editable.length) {
        const boWrap = document.createElement('div');
        boWrap.className = 'bcol-bo';
        boWrap.innerHTML = 'Bo <select class="bcol-bo-sel">' + [1, 3, 5, 7].map(v => '<option value="' + v + '"' + (v === curBo ? ' selected' : '') + '>Bo' + v + '</option>').join('') + '</select>';
        const sel = boWrap.querySelector('select');
        sel.onchange = async () => {
          try {
            await api('/api/t/' + T.id + '/set_round_bo', { bracket, round: r, bo: parseInt(sel.value, 10), division: division || null, admin: adminToken() });
            toast(colLabel(bracket, r, rounds) + ' set to Bo' + sel.value);
            await refresh();
          } catch (e) { toast(e.message, true); sel.value = curBo; }
        };
        col.appendChild(boWrap);
      } else if (roundMs.length) {
        const boWrap = document.createElement('div');
        boWrap.className = 'bcol-bo muted';
        boWrap.textContent = 'Bo' + curBo;
        col.appendChild(boWrap);
      }
    }
    mapsLine(bracket, poolRoundOf(bracket, r, division), col);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    for (const m of ms.filter(x => x.round === r).sort((a, b) => a.index - b.index)) {
      // Hide first-round byes: a match where one side is BYE is not a real game. The team that
      // "won" the bye has already been advanced into its next-round match, so it shows there.
      if (isPhantomMatch(m)) continue;
      mc.appendChild(matchBox(m));
    }
    if (bracket === 'wb' && r === rounds && !division && mc.children.length) {
      const m3 = thirdPlaceMatchOf(T);
      if (m3 && !isPhantomMatch(m3)) hangUnderFinal(mc, thirdPlaceBlock(m3));
    }
    col.appendChild(mc);
    if (mc.children.length) inner.appendChild(col);
  }
  if (gfMatch) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const head = document.createElement('div');
    head.className = 'bcol-title';
    head.textContent = 'GRAND FINAL';
    col.appendChild(head);
    if (viewToken() && gfMatch.status !== 'live' && gfMatch.status !== 'done' && !(Array.isArray(gfMatch.games) && gfMatch.games.length)) {
      const boWrap = document.createElement('div');
      boWrap.className = 'bcol-bo';
      boWrap.innerHTML = 'Bo <select class="bcol-bo-sel">' + [1, 3, 5, 7].map(v => '<option value="' + v + '"' + (v === gfMatch.bo ? ' selected' : '') + '>Bo' + v + '</option>').join('') + '</select>';
      const sel = boWrap.querySelector('select');
      sel.onchange = async () => {
        try {
          await api('/api/t/' + T.id + '/set_round_bo', { bracket: 'gf', round: 1, bo: parseInt(sel.value, 10), division: division || null, admin: adminToken() });
          toast('Grand Final set to Bo' + sel.value);
          await refresh();
        } catch (e) { toast(e.message, true); sel.value = gfMatch.bo; }
      };
      col.appendChild(boWrap);
    }
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

function drawBracket(el, division) {
  // Imported events with no reproducible bracket (free-for-all, round robin, group-only) have no
  // tree to draw - point at the results instead of rendering an empty frame.
  if (T.imported && T.standingsOnly) {
    el.innerHTML = '<div class="panel"><div class="empty">This tournament was imported from Challonge as <strong>'
      + esc(T.importedType || 'a non-bracket format') + '</strong>, which has no elimination bracket. '
      + 'See the <a href="#" data-goto="standings">Standings</a> tab for the results.</div></div>';
    const g = el.querySelector('[data-goto]');
    if (g) g.onclick = (e) => { e.preventDefault(); currentTab = 'standings'; syncTabURL(); drawTournament(); };
    return;
  }

  el.innerHTML = '';
  connectorRedraws = [];
  buildFeeders();
  drawStopNotice(el);
  // King / Prince: this tab shows one division's bracket.
  const one = divisionsOnT() ? (division || 1) : 0;
  // The opponent pick phase replaces round one, so while it is open it IS the bracket view.
  const pickOpen = T.picks && T.picks.status === 'open';
  if (pickOpen && T.picks.forWhat !== 'stage2') { drawPickPhase(el); drawBracketPreview(el, one); return; }
  if (!T.matches.length) {
    drawBracketPreview(el, one);
    return;
  }

  if (T.competition === 'ffa') return drawFfaRounds(el);

  if (T.bracketType === 'swiss') {
    if (pickOpen) drawPickPhase(el);
    // Two-stage: the playoff bracket sits above the Swiss stage that produced it, so the
    // live action is at the top and the Swiss rounds read as history below it.
    if (stageTwoLive()) {
      const hdr = document.createElement('div');
      hdr.className = 'division-header';
      hdr.innerHTML = '<h2 style="margin:0 0 10px">Playoffs <span class="h2-strong">'
        + esc(String(T.stage2.cutTo)) + '-team ' + (T.stage2.type === 'double' ? 'double' : 'single') + ' elimination</span></h2>'
        + '<p class="muted small" style="margin:0 0 12px">' + playoffOriginHTML() + '</p>'
        + playoffActionsHTML(true)
        + (T.stage2.type === 'double' ? '' : thirdPlaceToolsHTML());
      el.appendChild(hdr);
      wirePlayoffActions(hdr);
      wireThirdPlaceTools(hdr);
      if (T.stage2.type === 'double') {
        const gf = T.matches.find(m => m.bracket === 'gf');
        bracketColumns(el, 'wb', 'Winners bracket', gf, 0);
        bracketColumns(el, 'lb', 'Losers bracket', null, 0);
      } else {
        bracketColumns(el, 'wb', '');
      }
      const sep = document.createElement('div');
      sep.className = 'division-header';
      sep.innerHTML = '<h2 style="margin:22px 0 10px">Swiss stage</h2>';
      el.appendChild(sep);
      drawSwissRounds(el);
      alignBracketSections(el);
      for (const f of connectorRedraws) f();
      return;
    }
    drawSwissRound1Editor(el);
    return drawSwissRounds(el);
  }

  if (one) {
    const hdr = document.createElement('div');
    hdr.className = 'division-header';
    const champ = divisionChampionOf(one);
    hdr.innerHTML = '<h2 style="margin:0 0 4px">' + esc(divisionNameOf(one)) + ' <span class="h2-strong">bracket</span></h2>'
      + '<p class="muted small" style="margin:0 0 12px">' + divisionTeamsOf(one).length + ' teams'
      + (champ ? ' \u00b7 champion: <strong>' + esc(teamName(champ)) + '</strong>' : '') + '</p>';
    el.appendChild(hdr);
  }

  if (T.bracketType === 'double') {
    const gf = T.matches.find(m => m.bracket === 'gf' && (!one || (m.division || 0) === one));
    bracketColumns(el, 'wb', 'Winners bracket', gf, one);
    bracketColumns(el, 'lb', 'Losers bracket', null, one);
    alignBracketSections(el);
    for (const f of connectorRedraws) f();
    return;
  }

  // single elim
  if (!one) {
    const tools = thirdPlaceToolsHTML();
    if (tools) {
      const bar = document.createElement('div');
      bar.innerHTML = tools;
      el.appendChild(bar);
      wireThirdPlaceTools(bar);
    }
  }
  bracketColumns(el, 'wb', '', null, one);
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

// How many teams the bracket will have. There used to be a second, subtly different copy of this
// here, which is what drew the preview's seed list - it counted every team (forming ones included)
// and ignored maxTeams, so 8 full teams plus 2 half-built ones drew a 10-seed bracket. One
// implementation now, so the seeds, the round keys and the per-round Bo can never disagree.
function expectedTeamCount(division) {
  // one division of a split tournament: the teams it has, or the number it is going to get
  if (division && divisionsOnT()) return plannedDivisionSize(division) || 0;
  const n = projectedTeamCount();
  if (n >= 2) return n;
  // Nothing formed yet: fall back to a signup-based estimate, still capped.
  const cap = T.maxTeams > 0 ? T.maxTeams : Infinity;
  if (T.competition === 'ffa' || T.teamSize === 1) return Math.min(T.players.length, cap);
  if (T.formation === 'premade') {
    const names = {};
    for (const p of T.players) if (p.teamName) names[p.teamName.toLowerCase()] = 1;
    return Math.min(Object.keys(names).length, cap);
  }
  return Math.min(Math.floor(T.players.length / Math.max(T.teamSize, 1)), cap);
}

function seedLabelMap(division) {
  // maps seed number -> team name, when teams already exist
  const m = {};
  if (division && divisionsOnT()) {
    // seeds are unique across the field until the start, which numbers each division from 1
    divisionTeamsOf(division).slice().sort((a, b) => (a.seed || 0) - (b.seed || 0)).forEach((t, i) => { m[i + 1] = t.name; });
    return m;
  }
  if (T.teams) for (const t of T.teams) m[t.seed] = t.name;
  return m;
}
// The line under a division's preview: where its teams come from and how long its rounds are.
function divisionPreviewNote(division) {
  const nm = divisionNameOf(division);
  const n = divisionTeamsOf(division).length;
  const off = divisionRoundOffset(division);
  const bits = [];
  if (!n) bits.push(T.formation === 'draft' ? 'The ' + nm + ' bracket fills in once its teams are drafted.' : 'The ' + nm + ' bracket fills in once the teams are split into divisions.');
  else bits.push(n + ' team' + (n === 1 ? '' : 's') + ', seeded 1-' + n + ' within the division.');
  if (off) bits.push('It has fewer rounds than the biggest division and plays its round lengths counted back from the final: its final is the final, its semi-finals the semi-finals.');
  return bits.join(' ');
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

function drawBracketPreview(el, division) {
  const one = (division && divisionsOnT()) ? division : 0;
  const n = expectedTeamCount(one);

  // header with format + a clear "preview" note
  const head = document.createElement('div');
  head.className = 'panel section';
  const capNote = T.maxTeams ? ('capped at ' + T.maxTeams + ' teams') : 'uncapped';
  head.innerHTML = (one ? `<h2>${esc(divisionNameOf(one))} <span class="h2-strong">bracket preview</span></h2>
    <p class="muted small" style="margin:0 0 6px">${esc(divisionPreviewNote(one))}</p>` : `<h2>Format <span class="h2-strong">preview</span></h2>`)
    + `<p style="margin:0 0 4px">${esc(typeLine(T))}</p>
    <p class="muted" style="margin:0 0 8px">${esc(planSummary(T))}</p>
    <p class="muted small" style="margin:0">This is a preview \u2014 ${esc(capNote)}. Seeds fill in as teams are confirmed; the real bracket is generated when the organizer starts it.</p>`;
  el.appendChild(head);
  if (one && n < 2) return;

  if (T.competition === 'ffa') { drawFfaPreview(el, n); return; }
  if (T.bracketType === 'swiss') {
    drawSwissPreview(el, n);
    if (T.status === 'drafted') drawSwissRound1Editor(el);
    return;
  }
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
  const names = seedLabelMap(one);

  // slot label: real name if that seed is taken, "Seed N" if within team count, "bye" otherwise
  const slotLabel = seed => {
    if (seed > n) return { txt: 'bye', bye: true };
    if (names[seed]) return { txt: names[seed], seed, real: true };
    return { txt: 'Seed ' + seed, seed, tbd: true };
  };

  const plan = T.plan || {};
  const perRound = !!T.perRoundBo;
  // A smaller division plays the per-round lengths of the largest one counted back from the final.
  const offW = one ? divisionRoundOffset(one) : 0;
  const listBo = (list, i, fallback, isLb) => {
    const k = i + (isLb ? 2 * offW : offW);
    return (perRound && Array.isArray(list) && list[k] != null) ? list[k] : fallback;
  };
  const boForRound = r => {
    if (T.bracketType === 'double') {
      const fb = r === R ? (plan.wbFinal || 3) : (plan.wb || 3);
      return listBo(plan.wbList, r - 1, fb);
    }
    const fb = r === R ? (plan.final || 5) : r === R - 1 ? (plan.semi || 3) : (plan.early || 3);
    return listBo(plan.roundsList, r - 1, fb);
  };
  const canEditBo = viewerIsOrganizer() && perRound && !one;
  // a Bo <select> for a preview column that persists to the plan draft arrays
  const previewBoSelect = (listName, index, current) => {
    const wrap = document.createElement('div');
    wrap.className = 'bcol-bo';
    wrap.innerHTML = 'Bo <select class="bcol-bo-sel">' + [1, 3, 5, 7].map(v => '<option value="' + v + '"' + (v === current ? ' selected' : '') + '>Bo' + v + '</option>').join('') + '</select>';
    const sel = wrap.querySelector('select');
    sel.onchange = async () => {
      try {
        await api('/api/t/' + T.id + '/set_plan_round_bo', { list: listName, index, bo: parseInt(sel.value, 10), admin: adminToken() });
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
    return wrap;
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
  // First-round byes: figure out which R1 pairings are [realSeed, bye]. Those aren't real games,
  // so we don't draw them; instead the surviving seed is shown directly in its R2 match slot.
  // First-round byes aren't real games, so we don't draw them (the surviving seed shows up in
  // its round-2 match via the bye-aware slot labels below).
  const r1IsBye = [];
  roundSlots.forEach((pair, i) => {
    if (pair[0] > n || pair[1] > n) r1IsBye[i] = true;
  });

  // Bye-aware liveness over the virtual bracket. For each virtual match we work out how many
  // REAL teams actually reach it, so byes (and the phantom losers-bracket matches they create)
  // can be hidden. Memoized.
  const liveCache = {};
  const wbR1Real = idx => {
    const pair = roundSlots[idx] || [];
    return (pair[0] <= n ? 1 : 0) + (pair[1] <= n ? 1 : 0);
  };
  const wbR1Label = idx => {
    const pair = roundSlots[idx] || [];
    const live = pair[0] <= n ? pair[0] : pair[1];
    return slotLabel(live);
  };
  const feederLive = (f) => {
    const info = liveOf(f.m.id);
    if (f.type === 'Winner') return { exists: info.winnerExists, label: info.effLabel };
    return { exists: info.loserExists, label: { txt: 'Loser of ' + vLabel(f.m, isDouble), tbd: true } };
  };
  function liveOf(id) {
    if (liveCache[id]) return liveCache[id];
    const m = VB.byId[id];
    let res;
    if (m.bracket === 'wb' && m.round === 1) {
      const rc = wbR1Real(m.index);
      res = { winnerExists: rc >= 1, realGame: rc === 2, loserExists: rc === 2,
              effLabel: rc === 2 ? { txt: 'Winner of ' + vLabel(m, isDouble), tbd: true } : wbR1Label(m.index) };
    } else {
      const f1 = VB.fd[id + ':1'], f2 = VB.fd[id + ':2'];
      const a = f1 ? feederLive(f1) : { exists: false, label: null };
      const b = f2 ? feederLive(f2) : { exists: false, label: null };
      const rc = (a.exists ? 1 : 0) + (b.exists ? 1 : 0);
      const realGame = rc === 2;
      const effLabel = realGame ? { txt: 'Winner of ' + vLabel(m, isDouble), tbd: true }
                     : (a.exists ? a.label : b.label);
      res = { winnerExists: rc >= 1, realGame, loserExists: realGame, effLabel };
    }
    liveCache[id] = res;
    return res;
  }
  const liveFeederLabel = (destId, slot) => {
    const f = VB.fd[destId + ':' + slot];
    if (!f) return { txt: 'TBD', tbd: true };
    const fl = feederLive(f);
    return fl.exists ? fl.label : { txt: 'TBD', tbd: true };
  };

  for (let r = 1; r <= R; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = colLabel('wb', r, R);
    col.appendChild(h);
    if (canEditBo) col.appendChild(previewBoSelect(T.bracketType === 'double' ? 'wb' : 'rounds', r - 1, boForRound(r)));
    mapsLine('wb', poolRoundOf('wb', r, one), col);
    const mc = document.createElement('div');
    mc.className = 'bcol-matches';
    if (r === 1) {
      roundSlots.forEach((pair, i) => {
        if (r1IsBye[i]) return;   // don't draw first-round byes
        const box = previewBox(slotLabel(pair[0]), slotLabel(pair[1]), boForRound(r), wbTag(r, i));
        box.dataset.pid = idFor(r, i);
        mc.appendChild(box);
      });
    } else {
      const count = bracketSize / Math.pow(2, r);
      for (let i = 0; i < count; i++) {
        const destId = 'wb:' + r + ':' + i;
        if (!liveOf(destId).realGame) continue;
        const box = previewBox(liveFeederLabel(destId, 1), liveFeederLabel(destId, 2), boForRound(r), wbTag(r, i));
        box.dataset.pid = idFor(r, i);
        mc.appendChild(box);
      }
    }
    // the 3rd place match, under the final, when one is planned (it needs four real players)
    if (!isDouble && r === R && R >= 2 && n >= 4 && thirdPlaceOn(T) && !((T.divisions || 0) > 1) && mc.children.length) {
      const blk = document.createElement('div');
      blk.className = 'bthird';
      blk.innerHTML = '<div class="bcol-title">3RD PLACE</div>';
      blk.appendChild(previewBox({ txt: 'Loser of ' + wbTag(R - 1, 0), tbd: true }, { txt: 'Loser of ' + wbTag(R - 1, 1), tbd: true },
        (T.cfg && T.cfg.thirdBo) || boForRound(R - 1), '3RD PLACE'));
      hangUnderFinal(mc, blk);
    }
    col.appendChild(mc);
    if (mc.children.length) inner.appendChild(col); else col.remove();
  }
  // grand final placeholder for double
  if (T.bracketType === 'double') {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = 'GRAND FINAL';
    col.appendChild(h);
    if (canEditBo) col.appendChild(previewBoSelect('gf', 0, plan.gf || 5));
    mapsLine('gf', 1, col);
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
        const lbFb = q === lbRounds ? (plan.lbFinal || 3) : (plan.lb || 3);
        const lbBo = listBo(plan.lbList, q - 1, lbFb, true);
        if (canEditBo) col.appendChild(previewBoSelect('lb', q - 1, lbBo));
        mapsLine('lb', poolRoundOf('lb', q, one), col);
        const mc = document.createElement('div');
        mc.className = 'bcol-matches';
        const count = lbCountAt(q);
        lbCounts.push(count);
        for (let i = 0; i < count; i++) {
          const destId = 'lb:' + q + ':' + i;
          if (!liveOf(destId).realGame) continue;   // skip phantom LB matches created by WB byes
          const box = previewBox(liveFeederLabel(destId, 1), liveFeederLabel(destId, 2),
                                 lbBo, lbTag(q, i));
          box.dataset.pid = 'pl_' + q + '_' + i;
          mc.appendChild(box);
        }
        col.appendChild(mc);
        if (mc.children.length) linner.appendChild(col); else col.remove();
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
      // R1 can have gaps (byes are not drawn), so iterate a safe upper bound and skip absent
      // boxes rather than stopping at the first missing pid.
      const maxI = Math.pow(2, R - r);   // upper bound on matches in round r
      for (let i = 0; i < maxI; i++) {
        if (inner.querySelector('[data-pid="' + idFn(r, i) + '"]')) {
          link(idFn(r, i), idFn(r + 1, Math.floor(i / 2)));
        }
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
  const rounds = swissPlannedRounds(T, n);
  sec.innerHTML = `<h2>Swiss <span class="h2-strong">preview</span></h2>
    <p class="muted small" style="margin:0">${esc(String(n))} teams expected \u00b7 pairings are generated round by round once the tournament starts. Round 1 pairs by seed; later rounds by standings.</p>`;
  el.appendChild(sec);

  // let the organizer set up each round's maps ahead of time
  const setup = document.createElement('div');
  setup.className = 'panel section';
  setup.innerHTML = '<h2>Maps per round</h2>';
  const row = document.createElement('div');
  row.className = 'swiss-map-prep';
  for (let r = 1; r <= rounds; r++) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = 'ROUND ' + r;
    col.appendChild(h);
    mapsLine('sw', r, col);
    row.appendChild(col);
  }
  if (!T.plan || T.plan.final !== 0) {
    const col = document.createElement('div');
    col.className = 'bcol';
    const h = document.createElement('div');
    h.className = 'bcol-title';
    h.textContent = 'FINAL';
    col.appendChild(h);
    mapsLine('gf', 1, col);
    row.appendChild(col);
  }
  setup.appendChild(row);
  el.appendChild(setup);
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

// The declared early stop, stated on the bracket itself. Without this the bracket draws a grand
// final nobody will play and gives no hint of it, which is the whole complaint.
function drawStopNotice(el) {
  if (!stopAtOf(T)) return;
  const ef = T.earlyFinish;
  const box = document.createElement('div');
  const left = stopAtRemaining(T);
  if (ef) {
    const over = ef.target && ef.alive < ef.target;
    box.className = 'panel section stop-notice done';
    box.innerHTML = `<div class="mono small stop-head">TOURNAMENT ENDED</div>
      <div>${ef.auto ? 'Stopped automatically' : 'Stopped by ' + esc(ef.by || 'an organizer')} with
        <strong>${ef.alive}</strong> still standing: ${esc((ef.names || []).join(', '))}.</div>
      ${over ? '<div class="muted small" style="margin-top:4px">Two results landed close together, so the count went one past the target of ' + ef.target + '.</div>' : ''}
      <div class="muted small" style="margin-top:6px">Greyed-out matches below were never played.</div>`;
  } else {
    box.className = 'panel section stop-notice';
    box.innerHTML = `<div class="mono small stop-head">THIS TOURNAMENT ENDS EARLY</div>
      <div>${esc(stopAtLine(T))}</div>
      ${left != null ? '<div class="stop-count">' + (left === 0
        ? 'The next result ends it.'
        : '<strong>' + left + '</strong> more elimination' + (left === 1 ? '' : 's') + ' to go.') + '</div>' : ''}`;
  }
  el.appendChild(box);
}

// ---- opponent pick phase ----
// Seeds 1-N/2 choose who they play. Modelled on the veto flow: the site always says whose turn
// it is, shows that person a clear call to action, and lets an organizer act for anyone.
function drawPickPhase(el) {
  const p = T.picks;
  if (!p) return;
  const nm = id => { const tm = (T.teams || []).find(x => x.id === id); return tm ? tm.name : id; };
  const seedOf = id => p.field.indexOf(id) + 1;
  const org = viewerIsOrganizer();
  const sec = document.createElement('div');
  sec.className = 'panel section pickphase';

  const clock = () => {
    if (p.msLeft == null) return '';
    const secs = Math.max(0, Math.round(p.msLeft / 1000));
    const mm = Math.floor(secs / 60), ss = secs % 60;
    return `<span class="pick-clock${secs <= 30 ? ' urgent' : ''}">${mm}:${String(ss).padStart(2, '0')}</span>`;
  };

  const head = p.status === 'done'
    ? '<h2>Opponents <span class="h2-strong">chosen</span></h2>'
    : `<h2>Choosing <span class="h2-strong">opponents</span></h2>`;
  // 'unbeaten' mode: only the players with no Swiss loss pick, from anyone, and the rest are drawn.
  // Their records are what the rule is about, so they are shown next to every name.
  const unbeaten = p.mode === 'unbeaten';
  const recOf = id => (unbeaten && p.records && p.records[id]) ? p.records[id] : '';
  const tag = id => '<span class="muted mono small">(' + seedOf(id) + (recOf(id) ? ' · ' + esc(recOf(id)) : '') + ')</span>';

  let body = '';
  if (p.status === 'open') {
    const turnName = p.turn ? nm(p.turn) : '';
    const n = (p.order || []).length;
    const seededRest = unbeaten && p.rest === 'seed';
    // "from the 3-2s": the records of the players they may pick from, when the pool is narrowed
    const poolRecs = seededRest ? (p.pool || []).map(recOf).filter((v, i, a) => v && a.indexOf(v) === i) : [];
    const from = poolRecs.length ? ' from the ' + poolRecs.join(' / ') + 's' : '';
    const seedsLine = (T.tiebreak === 'beaten' && p.forWhat === 'stage2') ? ' Seeds come from the Swiss record, then the sum of the scores of the opponents each player beat.' : '';
    const who = unbeaten
      ? (n === 1 ? 'The one player who went through unbeaten chooses who they play' + from + '.'
        : 'The ' + n + ' players who went through unbeaten each choose who they play' + from + ', in seed order.')
        + (seededRest
          ? ' Everyone else is then paired by seed, the best remaining seed against the lowest.' + seedsLine
          : ' Everyone else is then drawn against each other at random, a different record against each other where possible.')
      : `The top ${p.half} seeds each choose who they play, in seed order.` + seedsLine;
    body += `<p class="muted small" style="margin:2px 0 12px">${esc(who)}
      ${p.perPickMs ? 'Each pick has a time limit; if it runs out, the standard bracket matchup is used.' : 'There is no time limit.'}</p>`;
    if (p.myTurn) {
      body += `<div class="pick-callout"><div class="pick-callout-h">Your pick ${clock()}</div>
        <div class="muted small">Choose your opponent below.</div></div>`;
    } else {
      body += `<div class="infocell"><div class="mono small muted">WAITING ON</div>
        <div>${esc(turnName)} <span class="muted small">(seed ${seedOf(p.turn)}${recOf(p.turn) ? ', ' + esc(recOf(p.turn)) : ''})</span> ${clock()}</div></div>`;
    }
  }

  // the pairings so far. Class names of their own (opp-*): as .pick-list / .pick-row they picked up
  // the compact clickable-list styles, a wrapping row of small chips, which cut every name off.
  const rows = p.order.map(id => {
    const pick = p.picks[id];
    const isTurn = p.status === 'open' && id === p.turn;
    return `<div class="opp-row${isTurn ? ' turn' : ''}">
      <span class="opp-seed mono">${seedOf(id)}</span>
      <span class="opp-name">${esc(nm(id))}${recOf(id) ? ' <span class="muted mono small">' + esc(recOf(id)) + '</span>' : ''}</span>
      <span class="opp-vs muted">vs</span>
      <span class="opp-target">${pick
        ? esc(nm(pick)) + ' ' + tag(pick)
        : (isTurn ? '<span class="opp-pending">choosing\u2026</span>' : '<span class="muted">\u2014</span>')}</span>
    </div>`;
  }).join('');
  body += `<div class="opp-list">${rows}</div>`;

  // the picker's own controls
  if (p.status === 'open' && (p.myTurn || org) && (p.available || []).length) {
    const who = p.turn ? nm(p.turn) : '';
    body += `<div class="pick-choose">
      <div class="mono small muted" style="margin-bottom:6px">${p.myTurn ? 'PICK YOUR OPPONENT' : 'PICK ON BEHALF OF ' + esc(who.toUpperCase())}</div>
      <div class="pick-opts">${p.available.map(id =>
        `<button class="btn ghost small" data-pickop="${esc(id)}">${esc(nm(id))} <span class="muted mono">${seedOf(id)}${recOf(id) ? ' \u00b7 ' + esc(recOf(id)) : ''}</span></button>`).join('')}</div>
    </div>`;
  }
  if (org && p.status === 'open' && (p.log || []).length) {
    body += '<div style="margin-top:10px"><button class="btn ghost small" id="pickUndo">Undo the last pick</button></div>';
  }
  if (p.forWhat === 'stage2') body += playoffActionsHTML(true);
  if ((p.log || []).some(l => l.auto)) {
    body += '<p class="muted small" style="margin:10px 0 0">Picks marked automatic were made by the clock running out, using the standard bracket matchup.</p>';
  }

  sec.innerHTML = head + body;
  el.appendChild(sec);
  wirePlayoffActions(sec);

  sec.querySelectorAll('[data-pickop]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    try {
      await api('/api/t/' + T.id + '/pick_opponent', { teamId: btn.dataset.pickop, admin: adminToken() });
      await refresh();
    } catch (e) { btn.disabled = false; toast(e.message, true); }
  });
  const undo = sec.querySelector('#pickUndo');
  if (undo) undo.onclick = async () => {
    try { await api('/api/t/' + T.id + '/undo_pick_opponent', { admin: adminToken() }); toast('Pick undone'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
}

// ---- the playoff setup of a Swiss stage (organizers) ----
// Who picks their playoff opponent, and the two ways back once the playoffs exist: undo the last
// pick, or redo the lot. Both stay possible until the first playoff match starts. Shown in two
// places: the Playoffs panel on the Admin tab, and above the playoff bracket, which is where an
// organizer is looking the moment the Swiss stage ends and the bracket appears.
function playoffUnbeatenLabel(t) {
  const c = swissCutCfg(t || T);
  return c.win ? c.win + '-0' : 'no losses';
}
// The lowest record that can go through: "3-2" when 3 wins qualify and 3 losses eliminate.
function playoffBottomLabel(t) {
  const c = swissCutCfg(t || T);
  return (c.win && c.loss) ? c.win + '-' + (c.loss - 1) : 'lowest record through';
}
function playoffPickText(pick, t) {
  if (pick === 'unbeaten') return 'Only the unbeaten (' + playoffUnbeatenLabel(t) + ') pick their opponent, everyone else is drawn';
  if (pick === 'bottom') return 'Only the unbeaten (' + playoffUnbeatenLabel(t) + ') pick, from the ' + playoffBottomLabel(t) + 's; everyone else is seeded';
  if (pick === 'half') return 'The top half of the playoff seeds pick their opponent';
  return 'Nobody picks: the bracket is seeded from the Swiss standings';
}
// "A's pick of B" for the pick an undo would take back, or '' when there is none.
function playoffLastPick() {
  const p = T.picks;
  if (!p || p.forWhat !== 'stage2' || !(p.log || []).length) return '';
  const last = p.log[p.log.length - 1];
  return teamName(last.by) + '’s pick of ' + teamName(last.target);
}
function playoffActionsHTML(onBracket) {
  const P = T.playoffs;
  if (!P || !P.made || P.locked || !viewerIsOrganizer()) return '';
  // While the picks are still open the pick panel has its own undo button.
  const undo = P.built && playoffLastPick();
  return `<div class="playoff-actions">
    ${undo ? '<button class="btn ghost small" data-poundo="1">Undo the last pick</button>' : ''}
    <button class="btn ghost small" data-poredo="1">Redo the playoffs</button>
    ${onBracket ? '<span class="muted small">Organizers only, until the first playoff match starts. Who picks is set on the Admin tab.</span>' : ''}
  </div>`;
}
async function playoffRedo(pick, minutes, tiebreak) {
  const what = pick === 'off'
    ? 'The playoff bracket is taken down and seeded again from the Swiss standings.'
    : 'The picks start again from the first picker' + (pick === 'unbeaten' ? ', and whoever nobody picks is drawn again.' : '.');
  if (!confirm('Redo the playoffs?\n\n' + what + '\n\nOnly possible while no playoff match has started.')) return false;
  try {
    const r = await api('/api/t/' + T.id + '/playoff_setup', { pick, minutes, tiebreak, redo: 1, admin: adminToken() });
    toast('Playoffs set up again' + (r.droppedPools ? ' (' + r.droppedPools + ' per-match map pool setting' + (r.droppedPools === 1 ? '' : 's') + ' cleared)' : ''));
    await refresh();
    return true;
  } catch (e) { toast(e.message, true); return false; }
}
function wirePlayoffActions(root) {
  const P = T.playoffs;
  if (!root || !P) return;
  root.querySelectorAll('[data-poundo]').forEach(b => b.onclick = async () => {
    if (!confirm('Undo ' + playoffLastPick() + '?\n\nThe playoff bracket is taken down again and that pick is open.')) return;
    try { await api('/api/t/' + T.id + '/undo_pick_opponent', { admin: adminToken() }); toast('Pick undone'); await refresh(); }
    catch (e) { toast(e.message, true); }
  });
  root.querySelectorAll('[data-poredo]').forEach(b => b.onclick = () => playoffRedo(P.pick, T.pickMinutes || 0));
}
// How the playoff matchups came about, for the line above the bracket. Everyone can read this.
function playoffOriginHTML() {
  const p = T.picks;
  if (!p || p.forWhat !== 'stage2' || p.status !== 'done') return esc('Seeded from the Swiss standings below.');
  const vs = pr => esc(teamName(pr[0])) + ' vs ' + esc(teamName(pr[1]));
  const chosen = (p.order || []).filter(id => p.picks[id]).map(id => [id, p.picks[id]]);
  if (p.mode === 'unbeaten') {
    const drawn = p.drawn || [];
    return (chosen.length ? 'Chosen by the unbeaten: ' + chosen.map(vs).join(' · ') + '. ' : 'Nobody went through unbeaten, so nothing was picked. ')
      + (drawn.length ? (p.rest === 'seed' ? 'Seeded: ' : 'Drawn: ') + drawn.map(vs).join(' · ') + '.' : '');
  }
  return 'The top seeds chose their opponents: ' + chosen.map(vs).join(' · ') + '.';
}

// The Playoffs panel on the Admin tab, for a Swiss stage that feeds a playoff bracket.
function playoffSetupPanelHTML() {
  const P = T.playoffs;
  if (!P || T.status !== 'running') return '';
  let state;
  if (P.locked) state = 'A playoff match has started, so the playoff setup is final.';
  else if (!P.made) state = 'The Swiss stage is still being played. When it ends, the playoffs are set up the way chosen here, and this can be changed at any time until then.';
  else if (!P.built) state = 'The players are choosing their playoff opponents right now (see the Bracket tab). The clock can still be changed, and the playoffs can be redone with a different setting.';
  else state = 'The playoff bracket is set up. Until the first playoff match starts - a result, a score, or a single map or faction ban - the last pick can be undone or the playoffs redone.';
  const opt = v => `<option value="${v}"${P.pick === v ? ' selected' : ''}>${esc(playoffPickText(v))}</option>`;
  return `<div class="panel section" id="playoffPanel"><h2>Playoffs</h2>
    <p class="muted small" style="margin:6px 0 10px">${esc(state)}</p>
    ${P.locked
      ? `<div class="infocell"><div class="mono small muted">SET UP AS</div><div>${esc(playoffPickText(P.pick))}</div><div class="muted small">${esc(swissTiebreakText(T.tiebreak))}</div></div>`
      : `<label>When the Swiss stage ends</label>
    <select id="po_pick">${opt('off')}${opt('half')}${opt('unbeaten')}${opt('bottom')}</select>
    <div id="po_help" class="muted small" style="margin:6px 0 0"></div>
    <label>Order within the same record</label>
    <select id="po_tb"><option value="gd"${T.tiebreak !== 'beaten' ? ' selected' : ''}>Game difference</option><option value="beaten"${T.tiebreak === 'beaten' ? ' selected' : ''}>Sum of the scores of the opponents beaten, then random</option></select>
    <div class="muted small" style="margin:6px 0 0">Decides who goes through, the playoff seeds and so who picks and in what order.</div>
    <div id="po_minsRow" class="row" style="gap:10px;align-items:flex-end;margin-top:8px">
      <div style="width:170px"><div class="muted small">Time limit per pick</div><input type="number" id="po_mins" min="0" max="1440" value="${T.pickMinutes || 0}"></div>
      <div class="muted small" style="flex:1;padding-bottom:8px">Minutes. 0 means no limit. A pick that runs out of time gets the standard bracket matchup.</div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn amber" id="po_save">Save</button></div>
    ${playoffActionsHTML(false)}`}
    ${playoffThirdHTML()}
  </div>`;
}
// The 3rd place match of the playoffs. A switch of its own, saved the moment it is clicked: it
// changes nobody's matchups, so it stays open after the playoffs are locked - until it starts itself.
function playoffThirdHTML() {
  const s2 = stageTwoCfgOf(T);
  if (!s2 || s2.type === 'double' || !thirdPlaceEligible(T)) return '';
  const m3 = thirdPlaceMatchOf(T);
  const fixed = !!(m3 && thirdPlaceTouched(m3));
  const note = fixed ? 'It has started, so it stays.'
    : m3 ? 'It is on the bracket, under the final. It can be removed until it starts.'
    : s2.built ? 'Ticking this adds it to the bracket straight away, the same length as the semi-finals (the length can be changed on the Bracket tab). A semi-final already played sends its loser into it.'
    : 'It is added when the playoff bracket is built.';
  return `<div class="po-third" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line-solid)">
    <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin:0">
      <input type="checkbox" id="po_third"${thirdPlaceOn(T) ? ' checked' : ''}${fixed ? ' disabled' : ''}> 3rd place match: the two beaten semi-finalists play for 3rd
    </label>
    <div class="muted small" style="margin:4px 0 0 22px">${esc(note)}</div>
  </div>`;
}
function wirePlayoffThird() {
  const ck = document.getElementById('po_third');
  if (!ck) return;
  ck.onchange = async () => {
    const on = ck.checked;
    ck.disabled = true;
    try {
      await api('/api/t/' + T.id + '/third_place', { on: on ? 1 : 0, admin: adminToken() });
      toast(on ? (stageTwoLive() ? '3rd place match added' : 'The playoffs will have a 3rd place match') : '3rd place match removed');
      await refresh();
    } catch (e) { toast(e.message, true); ck.checked = !on; ck.disabled = false; }
  };
}
function wirePlayoffSetup() {
  wirePlayoffThird();
  const P = T.playoffs;
  const sel = document.getElementById('po_pick');
  if (!P || !sel) return;
  const mins = document.getElementById('po_mins');
  const save = document.getElementById('po_save');
  const help = document.getElementById('po_help');
  const cut = (T.stage2 && T.stage2.cutTo) || 0;
  const full = cut >= 4 && (cut & (cut - 1)) === 0;
  const c = swissCutCfg(T);
  const example = (c.win && c.loss >= 3) ? ' (' + c.win + '-1 against ' + c.win + '-2)' : '';
  const tb = document.getElementById('po_tb');
  const changed = () => sel.value !== P.pick || (tb && tb.value !== (T.tiebreak === 'beaten' ? 'beaten' : 'gd'));
  const sync = () => {
    const v = sel.value;
    document.getElementById('po_minsRow').style.display = v === 'off' ? 'none' : '';
    // The 3-0s-from-the-3-2s option always seeds by the beaten score, so the choice below follows it.
    if (tb) {
      if (v === 'bottom') { if (!tb.disabled) tb.dataset.was = tb.value; tb.value = 'beaten'; tb.disabled = true; }
      else if (tb.disabled) { tb.disabled = false; if (tb.dataset.was) tb.value = tb.dataset.was; }
    }
    let h = v === 'bottom'
      ? 'Everyone who went through the Swiss without a loss chooses their opponent from the ' + playoffBottomLabel(T) + 's, in seed order. The players left over are then paired by seed, the best remaining seed against the lowest. Seeds follow the standings, then the sum of the scores of the opponents each player beat.'
      : v === 'unbeaten'
      ? 'Everyone who went through the Swiss without a loss chooses their opponent from the rest of the qualifiers, in seed order. The players left over are then drawn against each other at random, a different record against each other where possible' + example + '.'
      : v === 'half'
        ? 'Seeds 1-' + (cut / 2) + ' of the playoff choose their opponent from seeds ' + (cut / 2 + 1) + '-' + cut + ', in seed order.'
        : 'Standard seeding: the best Swiss record meets the lowest qualifier, and so on.';
    if (v !== 'off' && !full) h += ' Picking needs a playoff of 4, 8, 16 or 32 players; with ' + cut + ' it is seeded instead.';
    help.textContent = h;
    save.textContent = (P.made && changed()) ? 'Redo the playoffs with this setting' : 'Save';
  };
  sel.onchange = sync;
  if (tb) tb.onchange = sync;
  sync();
  save.onclick = async () => {
    const v = sel.value;
    const m = parseInt(mins.value, 10) || 0;
    const tbv = tb ? tb.value : undefined;
    if (P.made && changed()) { await playoffRedo(v, m, tbv); return; }
    try {
      await api('/api/t/' + T.id + '/playoff_setup', { pick: v, minutes: m, tiebreak: tbv, admin: adminToken() });
      toast('Playoff setup saved');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  wirePlayoffActions(document.getElementById('playoffPanel'));
}

// Round 1 has no records to pair on, so the site draws it by seed - the same every time. Some
// formats want the opening matchups chosen instead, so while the round is untouched an organizer
// can rearrange it here. It disappears the moment anything is reported.
// The round 1 matchup editor, on either side of the start.
// BEFORE the stage starts there are no matches yet, so the rows come from the pinned plan (or a
// seed-order proposal) and saving pins them. That path exists because the editor used to appear
// only after starting, which left a race an organizer could not win: start the stage, and a
// player opening their veto seconds later locked the matchups for good.
// AFTER the start it rewrites the real matches, and still locks once anyone has acted.
// What the pre-start editor starts from: the pinned plan when there is one that still fits the
// field, otherwise adjacent seed order (1v2, 3v4, ...), which is what a plain Swiss would draw.
// A plan naming players who are no longer entered is ignored rather than rendered with gaps.
function plannedPairsFor(teams) {
  const ids = {}; for (const x of teams) ids[x.id] = 1;
  const plan = T.plannedR1;
  if (Array.isArray(plan) && plan.length) {
    const seen = {}; let good = true;
    for (const p of plan) {
      if (!Array.isArray(p) || p.length !== 2) { good = false; break; }
      for (const x of p) { if (!ids[x] || seen[x]) { good = false; break; } seen[x] = 1; }
      if (!good) break;
    }
    const left = teams.filter(x => !seen[x.id]).map(x => x.id);
    if (good && left.length <= 1) return { pairs: plan.map(p => p.slice()), bye: left[0] || null };
  }
  const pool = teams.map(x => x.id);
  const pairs = [];
  while (pool.length > 1) pairs.push([pool.shift(), pool.shift()]);
  return { pairs, bye: pool[0] || null };
}

function drawSwissRound1Editor(el) {
  if (!viewerIsOrganizer() || T.bracketType !== 'swiss') return;
  const planning = T.status === 'drafted';
  if (!planning && !T.swissR1Open) return;

  const nm = id => { const tm = (T.teams || []).find(x => x.id === id); return tm ? tm.name : id; };
  let r1, bye;
  if (planning) {
    const teams = (T.teams || []).slice().sort((a, b) => (a.seed || 0) - (b.seed || 0));
    if (teams.length < 2) return;
    const plan = plannedPairsFor(teams);
    r1 = plan.pairs.map(p => ({ team1: p[0], team2: p[1] }));
    bye = plan.bye ? { team1: plan.bye } : null;
  } else {
    r1 = (T.matches || []).filter(m => m.bracket === 'sw' && m.round === 1 && m.team2 !== 'BYE');
    if (!r1.length) return;
    bye = (T.matches || []).find(m => m.bracket === 'sw' && m.round === 1 && m.team2 === 'BYE') || null;
  }
  const opts = sel => (T.teams || []).map(x =>
    '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');

  const sec = document.createElement('div');
  sec.className = 'panel section r1edit';
  sec.innerHTML = `<h2>Round 1 <span class="h2-strong">matchups</span></h2>
    <p class="muted small" style="margin:2px 0 10px">${planning
      ? 'There are no results to pair on in round 1, so set the opening matchups here before you start. They are applied the moment the stage starts, so nobody can lock them by opening a veto first.'
      : 'Round 1 is drawn by seed, because there are no results to pair on yet. Set the opening matchups here if you want to choose them. Locked as soon as the first result comes in.'}</p>
    <div class="r1rows">${r1.map((m, i) => `<div class="r1row">
      <span class="r1n mono">${i + 1}</span>
      <select data-r1a="${i}">${opts(m.team1)}</select>
      <span class="muted small">vs</span>
      <select data-r1b="${i}">${opts(m.team2)}</select>
    </div>`).join('')}</div>
    ${bye ? '<p class="muted small" style="margin:8px 0 0">' + esc(nm(bye.team1)) + ' has the bye.</p>' : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button class="btn primary small" id="r1save">Save matchups</button>
      <button class="btn ghost small" id="r1shuffle">Draw at random</button>
    </div>
    <div id="r1warn" class="muted small" style="margin-top:8px"></div>`;
  el.appendChild(sec);

  // live duplicate check, so a bad set is obvious before it is sent
  const readPairs = () => r1.map((m, i) => [
    sec.querySelector('[data-r1a="' + i + '"]').value,
    sec.querySelector('[data-r1b="' + i + '"]').value
  ]);
  const check = () => {
    const seen = {}, dupes = [];
    for (const [a, b] of readPairs()) for (const x of [a, b]) { if (seen[x]) dupes.push(nm(x)); seen[x] = 1; }
    const missing = (T.teams || []).filter(x => !seen[x.id] && !(bye && bye.team1 === x.id)).map(x => x.name);
    const w = sec.querySelector('#r1warn');
    if (dupes.length) w.innerHTML = '<span class="warn">Twice in the list: ' + esc([...new Set(dupes)].join(', ')) + '</span>';
    else if (missing.length) w.innerHTML = '<span class="warn">Not playing: ' + esc(missing.join(', ')) + '</span>';
    else w.textContent = '';
    return !dupes.length && !missing.length;
  };
  sec.querySelectorAll('select').forEach(x => x.onchange = check);
  check();

  sec.querySelector('#r1save').onclick = async () => {
    if (!check()) return toast('Every player has to appear exactly once', true);
    try {
      await api('/api/t/' + T.id + '/swiss_round1', { pairs: readPairs(), admin: adminToken() });
      toast('Round 1 matchups saved'); await refresh();
    } catch (e) { toast(e.message, true); }
  };
  sec.querySelector('#r1shuffle').onclick = async () => {
    try {
      await api('/api/t/' + T.id + '/swiss_round1', { shuffle: 1, admin: adminToken() });
      toast('Round 1 re-drawn'); await refresh();
    } catch (e) { toast(e.message, true); }
  };
}

function drawSwissRounds(el) {
  const ms = T.matches.filter(m => m.bracket === 'sw');
  const rounds = Math.max.apply(null, ms.map(m => m.round));

  // Rounds that have not opened yet still need their map pool set, and this list only ever
  // showed rounds that already had matches - so the pool for the next round could not be
  // prepared until that round was already being played ("I also need to set the pool to that
  // round and it doesnt come up"). Assigning a pool to a future round is already valid
  // server-side: initMatchVetoes reads poolAssign when the round is finally created.
  // Only while the Swiss stage is still producing rounds; once the playoffs are live the
  // remaining rounds will never be played and offering them would be a lie.
  const planned = swissPlannedRounds(T);
  if (T.status === 'running' && !stageTwoLive()) {
    for (let r = planned; r > rounds; r--) {
      const sec = document.createElement('div');
      sec.className = 'panel section';
      sec.innerHTML = `<h2>Round <span class="h2-strong">${r}</span> <span class="muted small" style="font-weight:400">not started yet</span></h2>
        <p class="muted small" style="margin:2px 0 0">Set its pool now and the veto is ready the moment the round opens.</p>`;
      mapsLine('sw', r, sec);
      el.appendChild(sec);
    }
  }

  for (let r = rounds; r >= 1; r--) {
    const sec = document.createElement('div');
    sec.className = 'panel section';
    const cuts = swissCutCfg(T);
    sec.innerHTML = `<h2>Round <span class="h2-strong">${r}${cuts.on ? '' : ' / ' + T.cfg.rounds}</span></h2>`
      + (r === rounds && cuts.on ? `<p class="muted small" style="margin:2px 0 0">${esc(swissCutLabel(T))}${cuts.decidingBo ? ' \u00b7 Bo' + cuts.decidingBo + ' when a win qualifies or a loss eliminates' : ''}</p>` : '');
    mapsLine('sw', r, sec);
    const q = document.createElement('div');
    q.className = 'queue';
    q.style.marginTop = '10px';
    sec.appendChild(q);
    fillQueue(q, swissQueueSort(ms.filter(m => m.round === r && m.team2 !== 'BYE')), true);
    for (const bm of ms.filter(m => m.round === r && m.team2 === 'BYE')) {
      const d = document.createElement('div');
      d.className = 'qitem done';
      const byeRec = (bm.round > 1) ? (swissRecordsBefore(bm.round)[bm.team1] || null) : null;
      d.innerHTML = `<span class="qround">BYE</span>`
        + (byeRec ? `<span class="qrec" title="Record brought into this round">${esc(byeRec.w + '-' + byeRec.l)}</span>` : '')
        + `<span class="qteams">${esc(teamName(bm.team1))}</span><span class="qscore muted">free win</span>`;
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


// ---------------------------------------------------------------------------
// Matches tab — a flat list of every match, for observers, casters and players
// who just want "what's on and what's done" without reading the bracket. It is
// an ALTERNATIVE view: it never replaces the bracket, vetoes or chat.
// ---------------------------------------------------------------------------

// Human status for the list. Mirrors the pipeline: waiting -> picks & bans -> live -> concluded.
function matchStateLabel(m, masked) {
  // The tournament stopped before this match was needed. Saying "Ready" here would be a lie.
  if (neverPlayed(m, T)) return { txt: 'Not played', cls: 'wait' };
  if (!m.team1 || !m.team2 || m.team1 === 'BYE' || m.team2 === 'BYE') return { txt: 'Waiting', cls: 'wait' };
  if (!masked && m.status === 'done') return { txt: 'Concluded', cls: 'done' };
  if (masked && m.status === 'done') return { txt: 'Played', cls: 'live' };
  if (m.veto && !m.veto.done) return { txt: 'Picks & bans', cls: 'veto' };
  // A faction veto is picks & bans too - it just isn't the map one. Saying "Ready" while two
  // players still owe faction choices is what made the whole step easy to miss.
  if (m.fveto && !factionAllDone(m)) return { txt: 'Picks & bans', cls: 'veto' };
  if (m.status === 'live') return { txt: 'Live', cls: 'live' };
  return { txt: 'Ready', cls: 'ready' };
}

function drawMatchesTab(el) {
  const all = (T.matches || []).filter(m => m.bracket !== 'ffa' && !isPhantomMatch(m));
  if (!all.length) {
    el.innerHTML = '<div class="panel"><div class="empty">No matches yet. They appear once the bracket is generated.</div></div>';
    return;
  }
  const myTeamId = (T.viewer && (T.viewer.memberTeamId || T.viewer.teamId)) || null;
  // playing order (Swiss rounds before the playoffs, the losers bracket between the winners
  // rounds); concluded matches newest first
  const known = m => m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE';
  const mine = myTeamId ? sortByPlay(all.filter(m => m.team1 === myTeamId || m.team2 === myTeamId)) : [];
  const concluded = sortByPlay(all.filter(m => m.status === 'done'), true);
  const ongoing = sortByPlay(all.filter(m => m.status !== 'done' && known(m)));
  const pending = sortByPlay(all.filter(m => m.status !== 'done' && !known(m)));

  const row = (m) => {
    const masked = streamerMode && !revealedMatches.has(m.id);
    const st = matchStateLabel(m, masked);
    // a slot fed by a completed-but-unrevealed match must stay hidden in streamer mode too
    const nameFor = (tid, slot) => {
      if (!tid || tid === 'BYE') {
        const src = feeders[m.id + ':' + slot];
        return '<span class="muted">' + (src ? esc(src.type + ' of ' + mLabel(src.m)) : 'TBD') + '</span>';
      }
      const feed = feeders[m.id + ':' + slot];
      if (masked && feed && feed.m && feed.m.status === 'done' && !revealedMatches.has(feed.m.id)) {
        return '<span class="muted">' + esc(feed.type + ' of ' + mLabel(feed.m)) + '</span>';
      }
      const win = !masked && m.winner === tid;
      return `<span class="mt-team${win ? ' win' : ''}" data-teamid="${esc(tid)}" title="${esc(teamName(tid))}">${esc(bracketLabel(tid))}</span>`;
    };
    const ff = (tid) => (m.forfeit && tid === m.forfeit && m.score1 != null && (tid === m.team1 ? m.score1 : m.score2) < 0);
    let result = '<span class="muted">—</span>';
    if (!masked && (m.score1 != null || m.score2 != null)) {
      const s1 = ff(m.team1) ? 'FF' : (m.score1 != null && m.score1 >= 0 ? m.score1 : 0);
      const s2 = ff(m.team2) ? 'FF' : (m.score2 != null && m.score2 >= 0 ? m.score2 : 0);
      result = `<span class="mono">${s1}:${s2}</span>${m.forfeit ? ' <span class="ff-mark">FF</span>' : ''}`;
    } else if (masked && m.status === 'done') {
      result = '<span class="muted">hidden</span>';
    }
    const revealBtn = (streamerMode && m.status === 'done')
      ? `<button class="btn ghost small" data-reveal="${m.id}">${revealedMatches.has(m.id) ? 'Hide' : 'Reveal'}</button>` : '';
    // A row you are in is tinted and marked, in every section - "My matches" only groups them at
    // the top, so without this your later-round matches were indistinguishable further down.
    const myTid = (T.viewer && (T.viewer.memberTeamId || T.viewer.teamId)) || null;
    const isMine = myTid && (m.team1 === myTid || m.team2 === myTid);
    return `<tr data-mrow="${m.id}"${isMine ? ' class="mt-mine" title="You are in this match"' : ''}>
      <td class="mono small muted mt-fixed">${esc(mLabelFull(m))}</td>
      <td class="mt-teamcell">${nameFor(m.team1, 1)}</td>
      <td class="mt-teamcell">${nameFor(m.team2, 2)}</td>
      <td class="mt-fixed"><span class="mt-state ${st.cls}">${esc(st.txt)}</span></td>
      <td class="mt-fixed">${result}</td>
      <td class="mt-actions mt-fixed">${myFactionTurn(m) ? '<button class="btn amber small" data-fvgo="' + esc(m.id) + '" title="You still owe faction choices on this match">\u26A1 Faction veto</button>' : ''}${revealBtn}<button class="btn ghost small" data-mdet="${m.id}">Details</button></td>
    </tr>`;
  };

  const table = (list) => `<table class="mt-table"><thead><tr>
      <th>Round</th><th>Team 1</th><th>Team 2</th><th>Status</th><th>Result</th><th></th>
    </tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;

  const section = (title, list, empty) => list.length
    ? `<div class="panel section"><h2>${esc(title)} <span class="h2-strong">(${list.length})</span></h2>${table(list)}</div>`
    : (empty ? `<div class="panel section"><h2>${esc(title)}</h2><div class="empty">${esc(empty)}</div></div>` : '');

  let html = '';
  if (mine.length) html += section('My matches', mine);
  html += section('Ongoing & upcoming', ongoing, 'Nothing live right now.');
  if (pending.length) html += section('Not yet decided', pending);
  html += section('Concluded', concluded, 'No matches finished yet.');
  el.innerHTML = html;

  el.querySelectorAll('[data-mdet]').forEach(b => b.onclick = () => {
    const m = T.matches.find(x => x.id === b.dataset.mdet);
    if (m) showMatchDetails(m);
  });
  el.querySelectorAll('[data-fvgo]').forEach(b => b.onclick = () => {
    const m = T.matches.find(x => x.id === b.dataset.fvgo);
    if (m) showVetoPopup(m);
  });
  el.querySelectorAll('[data-reveal]').forEach(b => b.onclick = () => {
    const id = b.dataset.reveal;
    if (revealedMatches.has(id)) revealedMatches.delete(id); else revealedMatches.add(id);
    saveRevealed();
    drawTournament();
  });
  el.querySelectorAll('[data-teamid]').forEach(nameEl => {
    nameEl.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showTeamPopup(nameEl.dataset.teamid); };
  });
}

// Match details popup opened from the Matches tab: teams with their players, the score, and the
// ban/pick history. Score reporting is offered here on exactly the same terms as on the bracket,
// so a captain allowed to submit there can submit here too.
function showMatchDetails(m) {
  const masked = streamerMode && !revealedMatches.has(m.id);
  const st = matchStateLabel(m, masked);
  const teamCol = (tid, score) => {
    const tm = T.teams && T.teams.find(x => x.id === tid);
    const hideName = masked && (() => {
      const feed = feeders[m.id + ':' + (tid === m.team1 ? 1 : 2)];
      return feed && feed.m && feed.m.status === 'done' && !revealedMatches.has(feed.m.id);
    })();
    if (!tm || hideName) {
      const feed = feeders[m.id + ':' + (tid === m.team1 ? 1 : 2)];
      return `<div class="md-team"><div class="md-tname muted">${esc(feed ? feed.type + ' of ' + mLabel(feed.m) : 'TBD')}</div></div>`;
    }
    const mems = (tm.playerIds || []).map(pid => T.players.find(p => p.id === pid)).filter(Boolean)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const win = !masked && m.winner === tid;
    const isFf = m.forfeit === tid && score != null && score < 0;
    return `<div class="md-team${win ? ' win' : ''}">
      <div class="md-tname" data-teamid="${esc(tid)}" title="${esc(tm.name)}">${esc(bracketLabel(tid))}${win ? ' <span class="md-wintag">WINNER</span>' : ''}${isFf ? ' <span class="ff-mark">FF</span>' : ''}</div>
      <div class="md-players">${mems.length
        ? mems.map(p => `<div class="md-p"><span>${p.id === tm.captainId ? '<span class="cap-tag">C</span> ' : ''}${esc(p.name)}</span><span class="mono muted">${p.rating != null ? p.rating : '\u2014'}</span></div>`).join('')
        : '<div class="muted small">No players listed.</div>'}</div>
    </div>`;
  };
  // Replays belong here too: casters and players open Details far more often than the bracket.
  const replayBlock = (!masked && ((m.replayIds && m.replayIds.length) || (m.drawReplayIds && m.drawReplayIds.length)))
    ? '<div class="md-replays"><span class="muted small">Replays</span> '
      + ((m.replayIds && m.replayIds.length) ? m.replayIds.map(replayLink).join(', ') : '')
      + ((m.drawReplayIds && m.drawReplayIds.length)
          ? ((m.replayIds && m.replayIds.length) ? ' &middot; ' : '') + '<span class="muted small">draws</span> ' + m.drawReplayIds.map(replayLink).join(', ')
          : '')
      + '</div>'
    : '';
  const s1 = (m.forfeit === m.team1 && m.score1 < 0) ? 'FF' : (m.score1 != null && m.score1 >= 0 ? m.score1 : 0);
  const s2 = (m.forfeit === m.team2 && m.score2 < 0) ? 'FF' : (m.score2 != null && m.score2 >= 0 ? m.score2 : 0);
  const scoreLine = masked
    ? '<div class="md-score muted">hidden</div>'
    : `<div class="md-score">${s1}<span class="md-colon">:</span>${s2}</div>`;

  const canReport = !T.imported && (m.status === 'ready' || m.status === 'live') && canReportMatch(m);
  const canCorrect = !T.imported && m.status === 'done' && viewerIsAdmin();
  const chatOk = matchChatAllowed(m);

  // Per-match Bo: an organizer can retune exactly this series while it has not started. The
  // per-round control on the bracket stays the bulk tool; this is the one-off escape hatch.
  const canSetBo = !T.imported && viewerIsOrganizer() && m.bracket !== 'ffa'
    && m.status !== 'done' && m.status !== 'live' && m.status !== 'bye'
    && !(Array.isArray(m.games) && m.games.length);
  const boBlock = canSetBo
    ? `<select id="mdBo" class="md-bo-sel" title="Change this match's length">${[1, 3, 5, 7].map(v =>
        '<option value="' + v + '"' + (v === m.bo ? ' selected' : '') + '>BO' + v + '</option>').join('')}</select>`
    : `<span class="muted" style="font-weight:400">BO${m.bo}</span>`;

  modal(`<h3>${esc(mLabelFull(m))} ${boBlock}
      <span class="mt-state ${st.cls}" style="margin-left:8px">${esc(st.txt)}</span></h3>
    <div class="md-grid">
      ${teamCol(m.team1, m.score1)}
      <div class="md-mid">${scoreLine}<div class="muted small">vs</div></div>
      ${teamCol(m.team2, m.score2)}
    </div>
    ${replayBlock}
    <div id="mdVeto"></div>
    <div class="md-foot">
      ${chatOk ? '<a href="#" id="mdChat" class="veto-mini-link">\u{1F4AC} Match chat' + unreadDot('match:' + m.id) + '</a>' : ''}
      ${(streamerMode && m.status === 'done') ? '<button class="btn ghost small" id="mdReveal">' + (revealedMatches.has(m.id) ? 'Hide result' : 'Reveal result') + '</button>' : ''}
    </div>
    <div class="actions">
      ${(canReport || canCorrect) ? '<button class="btn ' + (canReport ? 'amber' : 'ghost') + '" id="mdReport">' + (canReport ? 'Report score' : 'Correct result') + '</button>' : ''}
      <button class="btn ghost" id="mdClose">Close</button>
    </div>`, root => {
    // ban/pick history, hidden while masked so a caster doesn't spoil the maps
    const vh = root.querySelector('#mdVeto');
    if ((m.veto || m.fveto) && !masked) { vh.innerHTML = vetoHTML(m); wireVeto(vh, m); wireFactionVeto(vh); }
    else if ((m.veto || m.fveto) && masked) vh.innerHTML = '<div class="muted small" style="margin-top:10px">Veto hidden by streamer mode.</div>';
    root.querySelectorAll('[data-teamid]').forEach(n => n.onclick = (e) => {
      e.preventDefault(); closeModal(); showTeamPopup(n.dataset.teamid);
    });
    const boSel = root.querySelector('#mdBo');
    if (boSel) boSel.onchange = async () => {
      const want = parseInt(boSel.value, 10);
      try {
        await api('/api/t/' + T.id + '/set_match_bo', { matchId: m.id, bo: want, admin: adminToken() });
        toast(mLabelFull(m) + ' is now Bo' + want);
        closeModal();
        await refresh();
      } catch (e) { boSel.value = String(m.bo); toast(e.message, true); }
    };
    const c = root.querySelector('#mdChat');
    if (c) c.onclick = (e) => { e.preventDefault(); closeModal(); openMatchChat(m); };
    const rv = root.querySelector('#mdReveal');
    if (rv) rv.onclick = () => {
      if (revealedMatches.has(m.id)) revealedMatches.delete(m.id); else revealedMatches.add(m.id);
      saveRevealed(); closeModal(); drawTournament();
    };
    const rep = root.querySelector('#mdReport');
    if (rep) rep.onclick = () => { closeModal(); reportScore(m.id); };
    root.querySelector('#mdClose').onclick = closeModal;
  }, { wide: true });
}

// ---------- faction veto (1v1) ----------
// Rendered per game slot, to the right of the map that game will be played on. Runs in parallel
// with the map veto and independently of it: your own choices are the only ones you can ever see,
// because the server strips the opponent's out of the payload until both sides are finished.
// Pending "click again to confirm" state. Held at module level rather than inside the wiring
// functions so the 4-second poll redraw re-applies it instead of silently cancelling it.
let _vetoArmed = null;    // { matchId, map }
let _fvetoArmed = null;   // { matchId, game, faction }

const FACTION_META = {
  uef:      { label: 'UEF',      short: 'U', cls: 'uef' },
  aeon:     { label: 'Aeon',     short: 'A', cls: 'aeon' },
  cybran:   { label: 'Cybran',   short: 'C', cls: 'cybran' },
  seraphim: { label: 'Seraphim', short: 'S', cls: 'sera' }
};
const FACTION_ORDER = ['uef', 'aeon', 'cybran', 'seraphim'];

function factionChip(f, opts) {
  const meta = FACTION_META[f];
  if (!meta) return '';
  const o = opts || {};
  const cls = ['fchip', 'f-' + meta.cls];
  if (o.dim) cls.push('dim');
  if (o.on) cls.push('on');
  if (o.btn) cls.push('clickable');
  const attrs = o.btn ? ` data-fpick="${esc(f)}" data-fgame="${esc(String(o.game))}" data-fmatch="${esc(o.matchId)}"` : '';
  const title = o.title ? ` title="${esc(o.title)}"` : ` title="${esc(meta.label)}"`;
  return `<button type="button" class="${cls.join(' ')}"${attrs}${title}${o.btn ? '' : ' disabled'}><span class="fchip-glyph">${meta.short}</span><span class="fchip-name">${esc(meta.label)}</span></button>`;
}

// Does the VIEWER still owe faction choices on this match, and what is the next one?
// Returns { games, next:{game,action,index,of} } or null (not a competitor here, nothing left
// to do, or the match already has a result). This is the single source of truth behind the
// turn banner, the Vetoes tab badge, the bracket link and the Matches-tab button - before it
// existed, a faction veto announced itself nowhere at all.
function myFactionTurn(m) {
  if (!m || !m.fveto || !m.fveto.games) return null;
  if (m.status === 'done') return null;
  const myTeamId = (T.viewer && T.viewer.teamId) || null;
  if (!myTeamId || (myTeamId !== m.team1 && myTeamId !== m.team2)) return null;
  let games = 0, next = null;
  for (const k of Object.keys(m.fveto.games).sort((a, b) => Number(a) - Number(b))) {
    const g = m.fveto.games[k];
    // `mine` is only present for a competitor: the server strips it from everyone else.
    if (!g || !g.mine || g.mine.done || !g.next) continue;
    games++;
    if (!next) next = { game: k, action: g.next.action, index: g.next.index, of: g.next.of };
  }
  return games ? { games, next } : null;
}

// Every faction choice the viewer owes across the whole tournament, newest match first.
function myFactionTurnsAll() {
  const out = [];
  for (const m of (T && T.matches) || []) { const ft = myFactionTurn(m); if (ft) out.push({ m, ft }); }
  return out;
}
function myFactionStepCount() { return myFactionTurnsAll().reduce((n, x) => n + x.ft.games, 0); }

// The same question for the MAP veto: is it my team's turn on this match?
function myMapVetoTurn(m) {
  if (!m || !m.veto || m.veto.done || m.status === 'done') return null;
  const myTeamId = (T.viewer && T.viewer.teamId) || null;
  const v = m.veto;
  if (!myTeamId || !v.teamA || !v.teamB) return null;
  const step = v.sequence && v.sequence[v.stepIndex];
  if (!step) return null;
  return ((step.team === 'A' ? v.teamA : v.teamB) === myTeamId) ? step : null;
}
// What the Vetoes tab badge counts: everything on this viewer's plate, of either kind.
function myVetoStepCount() {
  let n = myFactionStepCount();
  for (const m of (T && T.matches) || []) if (myMapVetoTurn(m)) n++;
  return n;
}

// An amber call to action on the match itself. The map veto has had a link on the bracket box
// since it existed; the faction veto had none, so a player whose only outstanding job was a
// faction choice got no prompt anywhere on the page.
function myFvetoLinkHTML(m) {
  const ft = myFactionTurn(m);
  if (!ft) return '';
  const verb = ft.next.action === 'ban' ? 'ban' : 'pick';
  const more = ft.games > 1 ? ' <span class="fv-count">' + ft.games + '</span>' : '';
  return `<a href="#" data-fveto-link="${esc(m.id)}" class="veto-mini-link fveto-cta" title="${ft.games} game${ft.games === 1 ? '' : 's'} on this match still need your faction ban/picks">\u26A1 Your faction ${verb}${more} \u2192</a>`;
}

// The faction column for one game of one match. Returns '' when there is nothing to show.
function factionGameHTML(m, gameNum) {
  const fv = m.fveto;
  if (!fv) return '';
  const g = fv.games && fv.games[String(gameNum)];
  if (!g) return '';
  const myTeamId = (T.viewer && T.viewer.teamId) || null;
  const mySide = myTeamId ? (myTeamId === m.team1 ? 't1' : (myTeamId === m.team2 ? 't2' : null)) : null;
  const settled = m.status === 'done';

  // Both finished: everyone sees the outcome.
  if (g.result) {
    return `<div class="fveto-col done">
      <div class="fveto-res"><span class="fv-who">${esc(bracketLabel(m.team1))}</span>${factionChip(g.result.t1, {})}</div>
      <div class="fveto-res"><span class="fv-who">${esc(bracketLabel(m.team2))}</span>${factionChip(g.result.t2, {})}</div>
    </div>`;
  }

  // Not a competitor (organizer, caster, spectator): only who still owes choices.
  if (!mySide || !g.mine) {
    const pend = [];
    if (!g.t1Done) pend.push(bracketLabel(m.team1));
    if (!g.t2Done) pend.push(bracketLabel(m.team2));
    return `<div class="fveto-col">
      <div class="fveto-wait">${pend.length
        ? 'Waiting on ' + pend.map(esc).join(' and ')
        : 'Both done \u2014 resolving\u2026'}</div>
    </div>`;
  }

  const mine = g.mine;
  const oppDone = mySide === 't1' ? g.t2Done : g.t1Done;

  // Mine finished, opponent not.
  if (mine.done) {
    return `<div class="fveto-col">
      <div class="fveto-wait">${oppDone ? 'Resolving\u2026' : '\u2713 You\u2019re done \u2014 waiting on your opponent'}</div>
      <div class="fveto-mine">${mine.bans.map(f => factionChip(f, { dim: true, title: 'You banned ' + FACTION_META[f].label })).join('')}
        <span class="fv-arrow">\u2192</span>
        ${mine.picks.map((f, i) => factionChip(f, { on: true, title: 'Your pick ' + (i + 1) })).join('')}</div>
    </div>`;
  }

  if (settled) return '<div class="fveto-col"><div class="fveto-wait">Match decided \u2014 faction veto closed.</div></div>';

  // My turn: banning or picking.
  const step = g.next;
  if (!step) return '';
  const ord = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
  const banning = step.action === 'ban';
  // Already-used factions grey out: you can't ban the same one twice, or pick it twice. Banning a
  // faction you also pick is allowed - a ban denies it to your opponent, not to you.
  const used = banning ? mine.bans : mine.picks;
  const chips = FACTION_ORDER.map(f => used.indexOf(f) >= 0
    ? factionChip(f, { dim: true, title: banning ? 'Already banned' : 'Already picked' })
    : factionChip(f, { btn: true, game: gameNum, matchId: m.id })).join('');
  const soFar = (mine.bans.length ? '<div class="fveto-mine">' + mine.bans.map(f => factionChip(f, { dim: true, title: 'You banned ' + FACTION_META[f].label })).join('') + '</div>' : '')
    + (mine.picks.length ? '<div class="fveto-mine">' + mine.picks.map((f, i) => factionChip(f, { on: true, title: 'Your pick ' + (i + 1) })).join('') + '</div>' : '');
  // "1st faction to ban (1/1)" read like a status line, not a job. It is now an explicit
  // YOUR TURN pill with the same pulsing dot the tournament-wide turn banner uses, so the one
  // thing on this screen that needs the player's hands looks like it.
  return `<div class="fveto-col active">
    <div class="fveto-turn"><span class="turn-dot"></span>Your turn</div>
    <div class="fveto-prompt">${banning ? 'Ban a faction' : 'Pick a faction'}${step.of > 1 ? '<span class="muted small"> \u2014 ' + ord(step.index) + ' of ' + step.of + '</span>' : ''}</div>
    <div class="fveto-chips">${chips}</div>
    ${soFar}
    <div class="fveto-note muted small">${banning ? 'Bans deny that faction to your opponent.' : 'Picks are in order of preference \u2014 you get the highest one your opponent didn\u2019t ban.'} Nobody can see your choices.</div>
  </div>`;
}

// Wire the faction buttons inside a card body.
function wireFactionVeto(root) {
  const chips = Array.from(root.querySelectorAll('[data-fpick]'));
  if (!chips.length) return;
  // Same two-click confirm as the map veto. A faction choice is irreversible for the player
  // (only an organizer can reset it), so a stray click matters more here, not less.
  const paint = () => {
    for (const b of chips) {
      const armed = _fvetoArmed && _fvetoArmed.matchId === b.dataset.fmatch
        && _fvetoArmed.game === b.dataset.fgame && _fvetoArmed.faction === b.dataset.fpick;
      b.classList.toggle('armed', !!armed);
    }
    // The chips are too small for an inline label, so the prompt above them does the talking.
    const col = root.querySelector('.fveto-col.active .fveto-prompt');
    if (!col) return;
    if (!col.dataset.orig) col.dataset.orig = col.innerHTML;
    if (_fvetoArmed && chips.some(b => b.dataset.fmatch === _fvetoArmed.matchId && b.dataset.fgame === _fvetoArmed.game)) {
      const meta = FACTION_META[_fvetoArmed.faction];
      col.innerHTML = 'Click <strong>' + esc(meta ? meta.label : _fvetoArmed.faction) + '</strong> again to confirm'
        + ' <span class="muted small">(or pick another / press Esc)</span>';
    } else {
      col.innerHTML = col.dataset.orig;
    }
  };
  for (const b of chips) {
    b.onclick = async () => {
      const same = _fvetoArmed && _fvetoArmed.matchId === b.dataset.fmatch
        && _fvetoArmed.game === b.dataset.fgame && _fvetoArmed.faction === b.dataset.fpick;
      if (!same) {
        _fvetoArmed = { matchId: b.dataset.fmatch, game: b.dataset.fgame, faction: b.dataset.fpick };
        paint();
        return;
      }
      chips.forEach(x => { x.disabled = true; });
      try {
        await api('/api/t/' + T.id + '/fveto_action', {
          matchId: b.dataset.fmatch, game: parseInt(b.dataset.fgame, 10),
          faction: b.dataset.fpick, token: viewToken()
        });
        _fvetoArmed = null;
        await refresh();
      } catch (e) {
        chips.forEach(x => { x.disabled = false; });
        _fvetoArmed = null; paint();
        toast(e.message, true);
      }
    };
  }
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && _fvetoArmed) { _fvetoArmed = null; paint(); } });
  paint();   // survives the 4s poll redraw: re-applied from module state, not rebuilt from scratch
}
