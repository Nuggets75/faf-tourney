// ---------- Predictions tab ----------
// Before the first match anyone logged in predicts who wins every match (a win is a win; the score
// does not matter). A Swiss stage is predicted as every team's final record, since its later
// pairings depend on results; its playoffs or final open as a second stage once the Swiss is over.
// The organizer can put up a prize for a perfect prediction. The server (lib/predict.js) decides
// what is open, keeps only picks that fit the bracket, and scores; this file draws it.
//
// The response of /predictions is kept between the 4-second redraws (`_pred`), and so are the
// picks not saved yet (`_predDraft`, per stage), the stage shown and whose picks are being viewed.
let _pred = null;        // { tid, data }
let _predDraft = null;   // { tid, picks: { s1: {...}, s2: {...} } }
let _predStage = null;   // { tid, key }
let _predOf = null;      // { tid, fafId }

// Shown while there is something to predict or to look back on. Organizers keep it while the
// tournament runs, to set a prize or switch predictions off.
function predictTabVisible() {
  const p = T && T.predict;
  if (!p || T.imported) return false;
  const live = T.status !== 'finished';
  if (!p.on) return viewerIsOrganizer() && live;
  if (p.count > 0) return true;
  if (live && (p.stages || []).some(s => s.state === 'open' || s.state === 'upcoming')) return true;
  return viewerIsOrganizer() && live;
}
// Open stages this (logged-in) viewer has not predicted, or predicted for a draw that changed.
function predictBadgeCount() {
  const p = T && T.predict;
  if (!p || !p.on || !(T.viewer && T.viewer.loggedIn)) return 0;
  return (p.stages || []).filter(s => s.state === 'open' && (!p.mine || !p.mine[s.key] || p.mine[s.key] === 'stale' || p.mine[s.key] === 'part')).length;
}

async function drawPredictions(el) {
  const tid = T.id;
  if (_pred && _pred.tid === tid) renderPredictions(el, _pred.data);
  else el.innerHTML = '<div class="panel"><div class="empty">Loading\u2026</div></div>';
  const of = (_predOf && _predOf.tid === tid) ? _predOf.fafId : '';
  let data;
  try { data = await api('/api/t/' + tid + '/predictions' + (of ? '?of=' + encodeURIComponent(of) : '')); }
  catch (e) {
    if (!(_pred && _pred.tid === tid) && el.isConnected) el.innerHTML = '<div class="panel"><div class="empty">' + esc(e.message) + '</div></div>';
    return;
  }
  if (!T || T.id !== tid || currentTab !== 'predictions' || !el.isConnected) return;
  const same = _pred && _pred.tid === tid && JSON.stringify(_pred.data) === JSON.stringify(data);
  _pred = { tid, data };
  if (!same) renderPredictions(el, data);
}
// Fetch again and redraw (after a save or a setting): the page summary and, through the redraw,
// the tab itself.
async function reloadPredictions() {
  try { await refresh(); } catch (e) {}
}

// ---- the bracket, walked with a set of picks (mirrors lib/predict.js cascade) ----
function predCascade(positions, picks) {
  const W = {}, L = {}, occ = {}, valid = {};
  let need = 0, made = 0;
  for (const p of positions) {
    const o = p.s.map(s => (s.t !== undefined ? s.t : (s.w ? W[s.f] : L[s.f])));
    occ[p.k] = o;
    let w, l;
    if (o[0] == null || o[1] == null) {
      // not known yet
    } else if (o[0] === 'BYE' || o[1] === 'BYE') {
      w = o[0] === 'BYE' ? o[1] : o[0]; l = 'BYE';
    } else {
      need++;
      const pk = picks && picks[p.k];
      if (pk === o[0] || pk === o[1]) { valid[p.k] = pk; made++; w = pk; l = pk === o[0] ? o[1] : o[0]; }
    }
    W[p.k] = w; L[p.k] = l;
  }
  return { W, L, occ, valid, need, made };
}
function predSeedOf(stage, id) {
  const tm = (T.teams || []).find(x => x.id === id);
  if (!tm) return 999;
  return (stage.key === 's2' && tm.stage2Seed) || tm.seed || 999;
}
// Names for a stage's rounds: Final / Semi-finals ... for a plain bracket, Upper / Lower for double.
function predRoundName(stage, p) {
  const ps = stage.positions || [];
  const dbl = ps.some(x => x.b === 'lb');
  if (p.b === 'gf') return dbl ? 'Grand final' : 'Final';
  if (p.b === '3p') return '3rd place match';
  const max = b => ps.filter(x => x.b === b && x.d === p.d).reduce((a, x) => Math.max(a, x.r), 0);
  if (p.b === 'lb') return p.r === max('lb') ? 'Lower final' : 'Lower round ' + p.r;
  const R = max('wb');
  if (dbl) return p.r === R ? 'Upper final' : 'Upper round ' + p.r;
  if (p.r === R) return 'Final';
  if (p.r === R - 1) return 'Semi-finals';
  if (p.r === R - 2) return 'Quarter-finals';
  return 'Round ' + p.r;
}
// How the records of a Swiss come out when every score group splits evenly: exact only while
// every group has an even number of teams, otherwise null (byes and cross-group pairings).
function predSwissDist(n, plan) {
  const W = plan.win || 0, Lc = plan.loss || 0, N = plan.rounds || 0;
  const fin = (w, l) => (W && w >= W) || (Lc && l >= Lc) || (N && w + l >= N);
  let groups = { '0-0': n };
  const out = {};
  for (let r = 0; r < 40 && Object.keys(groups).length; r++) {
    const next = {};
    for (const key of Object.keys(groups)) {
      const c = groups[key];
      if (c % 2) return null;
      const [w, l] = key.split('-').map(Number);
      for (const [w2, l2] of [[w + 1, l], [w, l + 1]]) {
        const k2 = w2 + '-' + l2;
        if (fin(w2, l2)) out[k2] = (out[k2] || 0) + c / 2; else next[k2] = (next[k2] || 0) + c / 2;
      }
    }
    groups = next;
  }
  return out;
}

function predStageDefault(data) {
  const ss = data.stages || [];
  if (_predStage && _predStage.tid === T.id && ss.some(s => s.key === _predStage.key)) return _predStage.key;
  const open = ss.find(s => s.state === 'open');
  if (open) return open.key;
  const seen = ss.filter(s => s.state !== 'upcoming');
  return (seen.length ? seen[seen.length - 1] : ss[0] || {}).key;
}
function predDraftFor(stage) {
  if (!_predDraft || _predDraft.tid !== T.id) _predDraft = { tid: T.id, picks: {} };
  if (!_predDraft.picks[stage.key]) _predDraft.picks[stage.key] = Object.assign({}, (stage.mine && !stage.mine.stale && stage.mine.picks) || {});
  return _predDraft.picks[stage.key];
}
// After a save (or a removal) the kept response is brought up to date at once, so the redraw that
// follows never starts a fresh draft from what was there before.
function predSetMine(key, mine) {
  if (_predDraft && _predDraft.tid === T.id) delete _predDraft.picks[key];
  const s = _pred && _pred.tid === T.id ? (_pred.data.stages || []).find(x => x.key === key) : null;
  if (!s) return;
  if (mine) s.mine = mine; else delete s.mine;
}
function predDirty(stage) {
  const d = _predDraft && _predDraft.tid === T.id && _predDraft.picks[stage.key];
  if (!d) return false;
  const saved = (stage.mine && !stage.mine.stale && stage.mine.picks) || {};
  const a = Object.keys(d).filter(k => d[k]), b = Object.keys(saved);
  return a.length !== b.length || a.some(k => saved[k] !== d[k]);
}

// Streamer mode hides results everywhere else, so this tab must not give them away either: no
// marks, no winners, no scores, no leaderboard order.
function predHideResults(data) {
  if (!streamerMode) return data;
  const d = Object.assign({}, data, { stages: (data.stages || []).map(s => {
    const c = Object.assign({}, s);
    delete c.actual;
    if (c.mine) { c.mine = Object.assign({}, c.mine); delete c.mine.marks; delete c.mine.score; }
    if (c.of) { c.of = Object.assign({}, c.of); delete c.of.marks; delete c.of.score; }
    return c;
  }) });
  d.board = (data.board || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(r => ({ fafId: r.fafId, name: r.name, stages: {} }));
  d.hidden = 1;
  return d;
}

function renderPredictions(el, raw) {
  const data = predHideResults(raw);
  const admin = viewerIsOrganizer();
  const stages = data.stages || [];
  const key = predStageDefault(data);
  const stage = stages.find(s => s.key === key) || null;
  const viewing = data.of && stage && stage.of ? data.of : null;
  let h = '';

  // ---- what this is ----
  const swiss = stages.some(s => s.kind === 'records');
  const ffa = stages.some(s => s.kind === 'champion');
  h += `<div class="panel section"><h2>Predictions</h2>
    <p class="muted small" style="margin:0">${ffa
      ? 'Predict who wins the tournament.'
      : 'Predict the winner of every match - a win is a win, the score does not matter.'}
      ${swiss ? ' The Swiss stage is predicted as every team\u2019s final record, because its later pairings depend on results. The matches after it open as a second stage once the Swiss is over.' : ''}
      Predictions close as soon as the first match ${stages.length > 1 ? 'of a stage ' : ''}is played, and stay private until then.</p>
    ${data.prize ? '<div class="pred-prize"><span class="pred-prize-k">Prize for a perfect prediction</span> ' + esc(data.prize) + '</div>' : ''}
    ${!data.on ? '<p class="warn small" style="margin:10px 0 0">Predictions are switched off for this tournament.</p>' : ''}
  </div>`;

  // ---- stage sub-pages ----
  if (stages.length > 1) {
    h += '<div class="subtabs" style="margin:0 0 12px">' + stages.map(s =>
      '<button class="subtab' + (s.key === key ? ' active' : '') + '" data-pstage="' + esc(s.key) + '">' + esc(s.label)
      + ' <span class="pred-state ' + s.state + '">' + (s.state === 'open' ? 'open' : s.state === 'upcoming' ? 'later' : 'closed') + '</span></button>').join('') + '</div>';
  }

  if (stage) h += predStageHTML(stage, data, viewing);
  if (admin) h += predOrgHTML(data);
  h += predBoardHTML(data, stages);
  el.innerHTML = h;
  wirePredictions(el, data, stage);
}

function predStageHTML(stage, data, viewing) {
  const editable = data.on && stage.state === 'open' && data.loggedIn && !viewing;
  let h = '<div class="panel section">';
  // the state line
  if (stage.state === 'upcoming') {
    h += '<h2>' + esc(stage.label) + '</h2><div class="empty">' + esc(stage.why || 'Not open yet.') + '</div></div>';
    return h;
  }
  const stateLine = stage.state === 'open'
    ? 'Open until the first match' + (stage.kind === 'records' ? ' of the Swiss stage' : '') + ' is played.'
    : (stage.by === 'organizer' ? 'Closed by the organizer.' : (stage.by === 'finish' ? 'The tournament is over.' : 'Closed - the first match has been played.'));
  h += '<div class="pred-head"><h2>' + esc(stage.label) + '</h2><span class="muted small">' + esc(stateLine) + '</span></div>';
  if (stage.projected && stage.state === 'open') {
    h += '<p class="muted small" style="margin:0 0 10px">This is the bracket the start will make from the seeding as it is now. If the seeding changes before the start, predictions made before that have to be made again.</p>';
  }
  if (stage.kind === 'records' && stage.state === 'open' && stage.plan) {
    const pl = stage.plan;
    const fmt = (pl.win || pl.loss)
      ? (pl.win ? pl.win + ' wins go through' : '') + (pl.win && pl.loss ? ', ' : '') + (pl.loss ? pl.loss + ' losses go out' : '')
      : pl.rounds + ' rounds';
    h += '<p class="muted small" style="margin:0 0 10px">Format: ' + esc(fmt) + '.' + (T.status !== 'running' ? ' If the organizer changes it at the start, predictions made before that have to be made again.' : '') + '</p>';
  }
  if (viewing) {
    h += '<div class="pred-viewing">Viewing <strong>' + esc(viewing.name) + '</strong>\u2019s prediction <button class="btn ghost small" data-pback>Back to mine</button></div>';
  }
  const own = viewing ? stage.of : stage.mine;
  const picks = editable ? predDraftFor(stage) : ((own && !own.stale && own.picks) || {});
  const marks = (own && own.marks) || {};

  // where the viewer stands
  if (!viewing) {
    if (!data.loggedIn && stage.state === 'open') {
      h += '<div class="pred-note">Log in with FAF (top right) to make your prediction.</div>';
    } else if (stage.mine && stage.mine.stale) {
      h += '<div class="pred-note warn">' + (stage.state === 'open'
        ? 'Your prediction was made for a different draw - the seeding or the format changed since. Make it again below.'
        : 'Your prediction was made for a different draw and does not count.') + '</div>';
    } else if (stage.mine && stage.state === 'open') {
      const have = stage.kind === 'bracket' ? predCascade(stage.positions || [], stage.mine.picks || {}).made : Object.keys(stage.mine.picks || {}).length;
      const left = (stage.total || 0) - have;
      h += '<div class="pred-note ' + (left > 0 ? 'warn' : 'ok') + '">Your prediction is saved (' + fmtDateTime(new Date(stage.mine.at).toISOString()) + ').'
        + (left > 0 ? ' ' + left + ' ' + (stage.kind === 'records' ? 'team' + (left === 1 ? '' : 's') : 'match' + (left === 1 ? '' : 'es')) + ' still to predict - a perfect prediction needs every one.' : '')
        + ' You can change it until the first match.</div>';
    } else if (data.loggedIn && stage.state !== 'open' && !stage.mine) {
      h += '<div class="pred-note">You did not predict this stage.</div>';
    }
    if (own && own.score) {
      const sc = own.score;
      h += '<div class="pred-score"><span class="ok">' + sc.correct + ' right</span> \u00b7 <span class="no">' + sc.wrong + ' wrong</span> \u00b7 ' + sc.pending + ' still to play'
        + (sc.missing ? ' <span class="muted">(' + sc.missing + ' not predicted)</span>' : '') + '</div>';
    }
  } else if (own && own.score) {
    h += '<div class="pred-score"><span class="ok">' + own.score.correct + ' right</span> \u00b7 <span class="no">' + own.score.wrong + ' wrong</span> \u00b7 ' + own.score.pending + ' still to play</div>';
  }

  if (stage.kind === 'bracket') h += predBracketHTML(stage, picks, marks, editable);
  else if (stage.kind === 'records') h += predRecordsHTML(stage, picks, marks, editable);
  else h += predChampionHTML(stage, picks, marks, editable);

  if (editable) {
    const c = stage.kind === 'bracket' ? predCascade(stage.positions || [], picks) : null;
    const made = c ? c.made : Object.keys(picks).filter(k => picks[k]).length;
    const total = stage.total || (c ? c.need : 0);
    const dirty = predDirty(stage);
    const dist = stage.kind === 'records' ? predSwissDist((stage.teams || []).length, stage.plan || {}) : null;
    const fill = stage.kind === 'bracket' ? 'Higher seed wins every match' : (stage.kind === 'records' && dist ? 'Fill in by seed' : '');
    h += `<div class="pred-actions">
      <button class="btn amber" data-psave${made ? '' : ' disabled'}>Save prediction</button>
      ${fill ? '<button class="btn ghost small" data-pfill>' + esc(fill) + '</button>' : ''}
      <button class="btn ghost small" data-pclear${made ? '' : ' disabled'}>Clear</button>
      <span class="muted small">${made} of ${total} ${stage.kind === 'records' ? 'teams' : (stage.kind === 'champion' ? 'chosen' : 'matches')}${dirty ? ' \u00b7 <span class="warn">not saved</span>' : ''}</span>
      ${stage.mine ? '<a href="#" class="small muted" data-pwithdraw style="margin-left:auto">Remove my prediction</a>' : ''}
    </div>`;
  }
  h += '</div>';
  return h;
}

// One card per match, round by round; each team is a button. A match whose teams depend on an
// earlier pick says so instead. Byes are decided by themselves and left out.
function predBracketHTML(stage, picks, marks, editable) {
  const ps = stage.positions || [];
  const c = predCascade(ps, picks);
  const actual = stage.actual || {};
  const divs = Array.from(new Set(ps.map(p => p.d))).sort((a, b) => a - b);
  const multi = divs.length > 1 || (divs[0] || 0) > 0;
  const label = p => predRoundName(stage, p) + ' M' + (p.i + 1);
  const byKey = {};
  for (const p of ps) byKey[p.k] = p;
  const tbd = (p, j) => {
    const s = p.s[j];
    if (s.t !== undefined) return 'TBD';
    const f = byKey[s.f];
    return (s.w ? 'Winner of ' : 'Loser of ') + (f ? label(f) : 'an earlier match');
  };
  let h = '';
  for (const d of divs) {
    if (multi && divs.length > 1) h += '<h3 class="pred-div">' + esc(divisionNameOf(d)) + ' bracket</h3>';
    const inDiv = ps.filter(p => p.d === d);
    // rounds in playing order, as the server listed them
    const groups = [];
    for (const p of inDiv) {
      const o = c.occ[p.k];
      if (o && (o[0] === 'BYE' || o[1] === 'BYE')) continue;
      const g = predRoundName(stage, p);
      let grp = groups.find(x => x.name === g);
      if (!grp) { grp = { name: g, list: [] }; groups.push(grp); }
      grp.list.push(p);
    }
    for (const g of groups) {
      h += '<div class="pred-round"><div class="pred-round-h">' + esc(g.name) + '</div><div class="pred-grid">';
      for (const p of g.list) {
        const o = c.occ[p.k] || [null, null];
        const a = actual[p.k];
        const mk = marks[p.k];
        const mark = mk === 1 ? '<span class="pred-mark ok" title="Right">\u2713</span>' : (mk === 0 ? '<span class="pred-mark no" title="Wrong">\u2717</span>' : '');
        const team = j => {
          const id = o[j];
          if (id == null) return '<div class="pred-tbd">' + esc(tbd(p, j)) + '</div>';
          const on = c.valid[p.k] === id;
          const won = a && a.w && a.w === id;
          const sd = predSeedOf(stage, id);
          return '<button type="button" class="pred-team' + (on ? ' on' : '') + (won ? ' won' : '') + '" data-pk="' + esc(p.k) + '" data-pt="' + esc(id) + '"' + (editable ? '' : ' disabled') + '>'
            + (sd < 999 ? '<span class="seedtag">' + sd + '</span>' : '') + '<span class="pt-name">' + esc(teamName(id) || id) + '</span>'
            + (won ? '<span class="pt-won" title="Won this match">WON</span>' : '') + '</button>';
        };
        h += '<div class="pred-match' + (mk === 1 ? ' ok' : mk === 0 ? ' no' : '') + '"><div class="pm-label"><span>M' + (p.i + 1) + '</span>' + mark + '</div>' + team(0) + team(1) + '</div>';
      }
      h += '</div></div>';
    }
  }
  return h || '<div class="empty">Nothing to predict.</div>';
}

// Every team's final record. Records are buttons; when the format splits evenly, the counts each
// record should end up with are shown beside what has been chosen.
function predRecordsHTML(stage, picks, marks, editable) {
  const teams = (stage.teams || []).map(id => (T.teams || []).find(x => x.id === id)).filter(Boolean).sort((a, b) => (a.seed || 0) - (b.seed || 0));
  const choices = stage.choices || [];
  const dist = predSwissDist(teams.length, stage.plan || {});
  const actual = stage.actual || {};
  const counts = {};
  for (const id of Object.keys(picks)) if (picks[id]) counts[picks[id]] = (counts[picks[id]] || 0) + 1;
  let h = '<div class="pred-dist">' + choices.map(rc => {
    const n = counts[rc] || 0, want = dist ? (dist[rc] || 0) : null;
    const off = want != null && n !== want;
    return '<span class="pd-item' + (off ? ' off' : '') + '"><strong>' + esc(rc) + '</strong> ' + n + (want != null ? ' / ' + want : '') + '</span>';
  }).join('') + '</div>';
  if (dist && editable) h += '<p class="muted small" style="margin:0 0 8px">With this field every record ends up with exactly the number of teams after the slash, so a perfect prediction matches it.</p>';
  h += '<div class="pred-recs">';
  for (const tm of teams) {
    const mk = marks[tm.id];
    const a = actual[tm.id];
    const fin = a && a.st && a.st !== 'active';
    const now = a ? (a.w + '-' + a.l) : '';
    const btns = choices.length > 8
      ? '<select data-precsel="' + esc(tm.id) + '"' + (editable ? '' : ' disabled') + '><option value="">-</option>' + choices.map(rc => '<option' + (picks[tm.id] === rc ? ' selected' : '') + '>' + esc(rc) + '</option>').join('') + '</select>'
      : choices.map(rc => '<button type="button" class="pred-rc' + (picks[tm.id] === rc ? ' on' : '') + '" data-prec="' + esc(tm.id) + '" data-rc="' + esc(rc) + '"' + (editable ? '' : ' disabled') + '>' + esc(rc) + '</button>').join('');
    h += '<div class="pred-recrow' + (mk === 1 ? ' ok' : mk === 0 ? ' no' : '') + '"><span class="seedtag">' + (tm.seed || '') + '</span><span class="pr-name">' + esc(tm.name) + '</span>'
      + '<span class="pred-rec">' + btns + '</span>'
      + '<span class="pr-now muted small">' + (a ? (fin ? 'went ' + esc(now) : 'now ' + esc(now)) : '') + '</span>'
      + (mk === 1 ? '<span class="pred-mark ok">\u2713</span>' : mk === 0 ? '<span class="pred-mark no">\u2717</span>' : '<span class="pred-mark"></span>') + '</div>';
  }
  return h + '</div>';
}

function predChampionHTML(stage, picks, marks, editable) {
  const teams = (stage.teams || []).map(id => (T.teams || []).find(x => x.id === id)).filter(Boolean).sort((a, b) => (a.seed || 0) - (b.seed || 0));
  const champ = stage.actual && stage.actual.champion;
  const mk = marks.champion;
  return '<div class="pred-grid">' + teams.map(tm => '<button type="button" class="pred-team' + (picks.champion === tm.id ? ' on' : '') + (champ === tm.id ? ' won' : '') + '" data-pchamp="' + esc(tm.id) + '"' + (editable ? '' : ' disabled') + '>'
    + '<span class="seedtag">' + (tm.seed || '') + '</span><span class="pt-name">' + esc(tm.name) + '</span>'
    + (champ === tm.id ? '<span class="pt-won">CHAMPION</span>' : '')
    + (picks.champion === tm.id && mk === 1 ? '<span class="pred-mark ok">\u2713</span>' : picks.champion === tm.id && mk === 0 ? '<span class="pred-mark no">\u2717</span>' : '') + '</button>').join('') + '</div>';
}

function predOrgHTML(data) {
  const stages = data.stages || [];
  const stale = (data.board || []).filter(r => Object.values(r.stages || {}).some(x => x.stale)).length;
  return `<div class="panel section"><h2>Predictions <span class="h2-strong">organizer</span></h2>
    <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:0">
      <input type="checkbox" id="predOn"${data.on ? ' checked' : ''}> Predictions on for this tournament
    </label>
    <label>Prize for a perfect prediction <span class="muted small">(optional - shown at the top of this tab)</span></label>
    <div style="display:flex;gap:8px;align-items:center"><input type="text" id="predPrize" maxlength="120" value="${esc(data.prize || '')}" placeholder="e.g. 50 USD, or a custom avatar" style="flex:1;min-width:0"><button class="btn ghost small" id="predPrizeSave" style="flex:none">Save prize</button></div>
    <p class="muted small" style="margin:10px 0 6px">${data.count} prediction${data.count === 1 ? '' : 's'} so far${stale ? ', ' + stale + ' made for an earlier draw' : ''}. A stage closes by itself when its first match is played; you can close it earlier.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${stages.filter(s => s.state !== 'upcoming').map(s => s.state === 'open'
      ? '<button class="btn ghost small" data-pclose="' + esc(s.key) + '">Close ' + esc(s.label) + ' predictions now</button>'
      : (s.by === 'organizer' ? '<button class="btn ghost small" data-preopen="' + esc(s.key) + '">Reopen ' + esc(s.label) + ' predictions</button>' : '')).join('')}</div>
  </div>`;
}

function predBoardHTML(data, stages) {
  const rows = data.board || [];
  const scored = stages.some(s => s.state === 'locked') && !data.hidden;
  let h = '<div class="panel section"><h2>' + (scored ? 'Leaderboard' : 'Predictions in') + ' <span class="h2-strong">(' + rows.length + ')</span></h2>';
  if (!rows.length) return h + '<div class="empty">Nobody has predicted yet.</div></div>';
  if (!scored) {
    h += '<p class="muted small" style="margin:0 0 8px">' + (data.hidden ? 'Results and scores are hidden in streamer mode.' : 'Everyone\u2019s picks stay private until the first match is played.') + '</p><div class="pred-names">'
      + rows.map(r => '<span class="unteamed-chip' + (r.fafId === data.me ? ' me' : '') + '">' + esc(r.name) + '</span>').join('') + '</div></div>';
    return h;
  }
  const perfectNames = rows.filter(r => r.perfect).map(r => r.name);
  if (data.finished) {
    h += perfectNames.length
      ? '<div class="pred-perfect-line">Perfect: <strong>' + perfectNames.map(esc).join(', ') + '</strong>' + (data.prize ? ' - ' + esc(data.prize) : '') + '</div>'
      : '<p class="muted small" style="margin:0 0 8px">Nobody got everything right.</p>';
  }
  h += '<table class="pred-board"><thead><tr><th>#</th><th>Predictor</th><th>Right</th><th>Wrong</th><th>To play</th><th></th></tr></thead><tbody>';
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    const keyNow = r.correct + '/' + r.wrong;
    if (keyNow !== prev) { rank = i + 1; prev = keyNow; }
    const tag = r.perfect ? '<span class="pred-badge perfect">PERFECT</span>'
      : (r.alive && !data.finished ? '<span class="pred-badge alive" title="Everything right so far">ALL RIGHT SO FAR</span>' : '');
    h += '<tr' + (r.fafId === data.me ? ' class="me"' : '') + '><td class="muted">' + rank + '</td><td>' + esc(r.name) + (r.fafId === data.me ? ' <span class="muted small">(you)</span>' : '') + ' ' + tag + '</td>'
      + '<td class="mono">' + r.correct + '</td><td class="mono">' + r.wrong + '</td><td class="mono muted">' + r.pending + '</td>'
      + '<td>' + (r.fafId !== data.me ? '<button class="btn ghost small" data-pview="' + esc(r.fafId) + '">View</button>' : '') + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}

function wirePredictions(el, data, stage) {
  const redraw = () => renderPredictions(el, (_pred && _pred.tid === T.id) ? _pred.data : data);
  el.querySelectorAll('[data-pstage]').forEach(b => b.onclick = () => { _predStage = { tid: T.id, key: b.dataset.pstage }; redraw(); });
  const back = el.querySelector('[data-pback]');
  if (back) back.onclick = () => { _predOf = null; reloadPredictions(); };
  el.querySelectorAll('[data-pview]').forEach(b => b.onclick = () => {
    _predOf = { tid: T.id, fafId: b.dataset.pview };
    reloadPredictions();
    try { window.scrollTo(0, 0); } catch (e) {}
  });
  if (stage) {
    const picks = () => predDraftFor(stage);
    el.querySelectorAll('[data-pk]').forEach(b => b.onclick = () => {
      if (b.disabled) return;
      const p = picks();
      p[b.dataset.pk] = b.dataset.pt;
      // a changed pick can leave later picks naming a team that no longer gets there; drop those
      const c = predCascade(stage.positions || [], p);
      for (const k of Object.keys(p)) if (!c.valid[k]) delete p[k];
      redraw();
    });
    el.querySelectorAll('[data-prec]').forEach(b => b.onclick = () => {
      const p = picks();
      if (p[b.dataset.prec] === b.dataset.rc) delete p[b.dataset.prec]; else p[b.dataset.prec] = b.dataset.rc;
      redraw();
    });
    el.querySelectorAll('[data-precsel]').forEach(s => s.onchange = () => {
      const p = picks();
      if (s.value) p[s.dataset.precsel] = s.value; else delete p[s.dataset.precsel];
      redraw();
    });
    el.querySelectorAll('[data-pchamp]').forEach(b => b.onclick = () => { const p = picks(); p.champion = b.dataset.pchamp; redraw(); });
    const fill = el.querySelector('[data-pfill]');
    if (fill) fill.onclick = () => {
      const p = picks();
      for (const k of Object.keys(p)) delete p[k];
      if (stage.kind === 'bracket') {
        // the better seed of the two teams that get there; a later match only knows its teams
        // once the earlier ones are picked, so walk again until nothing is left open
        const ps = stage.positions || [];
        for (let guard = 0; guard < 64; guard++) {
          const c = predCascade(ps, p);
          let added = 0;
          for (const pos of ps) {
            const o = c.occ[pos.k];
            if (!o || o[0] == null || o[1] == null || o[0] === 'BYE' || o[1] === 'BYE' || p[pos.k]) continue;
            p[pos.k] = predSeedOf(stage, o[0]) <= predSeedOf(stage, o[1]) ? o[0] : o[1];
            added++;
          }
          if (!added) break;
        }
      } else if (stage.kind === 'records') {
        const dist = predSwissDist((stage.teams || []).length, stage.plan || {});
        if (!dist) return;
        const teams = (stage.teams || []).map(id => (T.teams || []).find(x => x.id === id)).filter(Boolean).sort((a, b) => (a.seed || 0) - (b.seed || 0));
        let i = 0;
        for (const rc of stage.choices || []) for (let n = 0; n < (dist[rc] || 0) && i < teams.length; n++) p[teams[i++].id] = rc;
      }
      redraw();
    };
    const clr = el.querySelector('[data-pclear]');
    if (clr) clr.onclick = () => { const p = picks(); for (const k of Object.keys(p)) delete p[k]; redraw(); };
    const save = el.querySelector('[data-psave]');
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        const r = await api('/api/t/' + T.id + '/predict', { stage: stage.key, picks: picks() });
        toast('Prediction saved (' + r.count + ' of ' + r.total + ')');
        predSetMine(stage.key, { at: Date.now(), picks: r.picks || {}, stale: 0 });
        await reloadPredictions();
      } catch (e) { toast(e.message, true); save.disabled = false; }
    };
    const wd = el.querySelector('[data-pwithdraw]');
    if (wd) wd.onclick = async (e) => {
      e.preventDefault();
      if (!confirm('Remove your prediction for the ' + stage.label + '?')) return;
      try {
        await api('/api/t/' + T.id + '/predict', { stage: stage.key, clear: 1 });
        predSetMine(stage.key, null);
        toast('Prediction removed');
        await reloadPredictions();
      } catch (err) { toast(err.message, true); }
    };
  }
  // organizer
  const cfg = async (body, msg) => {
    try { await api('/api/t/' + T.id + '/predict_config', Object.assign({ admin: adminToken() }, body)); if (msg) toast(msg); await reloadPredictions(); }
    catch (e) { toast(e.message, true); }
  };
  const on = el.querySelector('#predOn');
  if (on) on.onchange = () => cfg({ on: on.checked ? 1 : 0 }, on.checked ? 'Predictions on' : 'Predictions off');
  const ps = el.querySelector('#predPrizeSave');
  if (ps) ps.onclick = () => cfg({ prize: (el.querySelector('#predPrize') || {}).value || '' }, 'Prize saved');
  el.querySelectorAll('[data-pclose]').forEach(b => b.onclick = () => {
    if (!confirm('Close predictions for this stage now? Nobody can predict or change a prediction after this.')) return;
    cfg({ close: b.dataset.pclose }, 'Predictions closed');
  });
  el.querySelectorAll('[data-preopen]').forEach(b => b.onclick = () => cfg({ reopen: b.dataset.preopen }, 'Predictions reopened'));
}
