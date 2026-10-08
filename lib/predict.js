// Predictions ("pick'em"). Before a tournament's first match, anyone logged in with FAF can
// predict who wins every match; a win is a win, the score does not matter. The organizer can put
// up a prize for a prediction that gets everything right.
//
// A tournament has one or two prediction stages:
//   s1  single / double elimination (divisions included): the winner of every bracket match.
//       Swiss: every team's final Swiss record (3-0, 3-1 ...) - the pairings after round one
//       depend on results, so the matches themselves cannot be known in advance.
//       FFA: the champion.
//   s2  a Swiss with playoffs or a final: the winner of every match after the Swiss. Opens once
//       the Swiss stage is complete and those matches exist.
// A stage is open from the moment its matches can be known (the teams are locked) until its
// first match is played; the organizer can also close it early. Picks are private until the
// stage locks; after that everyone can see everyone's.
//
// Stored on the tournament, never sent whole to anyone:
//   t.predictions = { [fafId]: { name, s1: { at, layout, picks }, s2: { ... } } }
//   t.predict     = { off, prize, locked: { s1: { at, by, keys } } }   (absent = on, no prize)
// `layout` fingerprints what a prediction was made against (the opening matches, or the Swiss
// field and format). If the organizer reseeds before the start, older predictions no longer fit
// and are shown as out of date instead of being scored against a different draw.
'use strict';

const M = require('./match');
const SW = require('./swiss');

const ELIM = { wb: 1, lb: 1, gf: 1, '3p': 1 };

function posKey(m) { return (m.division || 0) + ':' + m.bracket + ':' + m.round + ':' + m.index; }

// FNV-1a, 32 bit, as 8 hex digits. Only a fingerprint, never a secret.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}

// Roughly when a position is played, for a stable order: the losers bracket between the winners
// rounds, the 3rd place match just before the final, a grand final last.
function rankOf(p) {
  if (p.b === 'gf') return 9999;
  if (p.b === 'lb') return p.r + 0.1;
  const w = p.r <= 1 ? 0.5 : 2 * p.r - 2;
  return p.b === '3p' ? w - 0.25 : w;
}

// ---------- the bracket as a graph ----------
// Every match is a position, keyed division:bracket:round:index - the same key whether the
// bracket is real or projected, so a prediction made before the start fits the bracket built at
// the start. Each position has two slots, filled by a fixed team ('BYE' for an empty seed) or by
// the winner or loser of another position. `order` lists them so that feeders come first.
function graphOf(matches, bracketType) {
  const byId = {};
  for (const m of matches) byId[m.id] = m;
  const pos = {};
  for (const m of matches) pos[posKey(m)] = { k: posKey(m), d: m.division || 0, b: m.bracket, r: m.round, i: m.index, s: [null, null], m };
  for (const m of matches) {
    for (const [to, w] of [[m.winnerTo, 1], [m.loserTo, 0]]) {
      if (!to || !byId[to.id]) continue;
      const p = pos[posKey(byId[to.id])];
      if (p && (to.slot === 1 || to.slot === 2)) p.s[to.slot - 1] = { f: posKey(m), w };
    }
  }
  for (const k of Object.keys(pos)) {
    const p = pos[k];
    for (let j = 0; j < 2; j++) {
      if (!p.s[j]) { const v = j === 0 ? p.m.team1 : p.m.team2; p.s[j] = { t: v || null }; }
    }
  }
  const all = Object.values(pos).sort((a, b) => a.d - b.d || rankOf(a) - rankOf(b) || a.i - b.i);
  const order = [], done = {};
  let guard = all.length + 2;
  while (order.length < all.length && guard-- > 0) {
    for (const p of all) {
      if (done[p.k]) continue;
      if (p.s.every(s => s.t !== undefined || done[s.f] || !pos[s.f])) { done[p.k] = 1; order.push(p); }
    }
  }
  for (const p of all) if (!done[p.k]) order.push(p);   // a cycle cannot happen; never lose a position
  const fixed = [];
  for (const p of Object.values(pos).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))) {
    p.s.forEach((s, j) => { if (s.t !== undefined) fixed.push(p.k + '/' + j + '=' + (s.t || '')); });
  }
  return { pos, order, layout: hash((bracketType || '') + '|' + fixed.join(';')) };
}

// Walk the graph with a set of picks: who sits in each slot, who wins, which picks stand (a pick
// must be one of the two teams actually in that match) and how many matches need a pick. A bye is
// decided by itself. With `auto` every open match takes its first team - that counts the matches
// a complete prediction has to pick.
function cascade(g, picks, auto) {
  const W = {}, L = {}, occ = {}, valid = {};
  let need = 0, made = 0;
  for (const p of g.order) {
    const o = p.s.map(s => (s.t !== undefined ? s.t : (s.w ? W[s.f] : L[s.f])));
    occ[p.k] = o;
    let w, l;
    if (o[0] == null || o[1] == null) {
      // not known yet: an earlier match is still unpicked
    } else if (o[0] === 'BYE' || o[1] === 'BYE') {
      w = o[0] === 'BYE' ? o[1] : o[0]; l = 'BYE';
    } else {
      need++;
      const pk = auto ? o[0] : (picks && picks[p.k]);
      if (pk === o[0] || pk === o[1]) {
        if (!auto) valid[p.k] = pk;
        made++;
        w = pk; l = pk === o[0] ? o[1] : o[0];
      }
    }
    W[p.k] = w; L[p.k] = l;
  }
  return { W, L, occ, valid, need, made };
}
function pickableKeys(g) {
  const c = cascade(g, null, true);
  return g.order.filter(p => {
    const o = c.occ[p.k];
    return o[0] != null && o[1] != null && o[0] !== 'BYE' && o[1] !== 'BYE';
  }).map(p => p.k);
}

// Which teams can still win (or lose) each position, given the results so far.
function possible(g) {
  const PW = {}, PL = {};
  for (const p of g.order) {
    const m = p.m;
    if (m && (m.status === 'done' || m.status === 'bye') && m.winner) {
      PW[p.k] = new Set([m.winner]); PL[p.k] = new Set([m.loser]);
      continue;
    }
    const occ = p.s.map((s, j) => {
      const cur = m ? (j === 0 ? m.team1 : m.team2) : null;
      if (cur) return new Set([cur]);
      if (s.t !== undefined) return new Set(s.t ? [s.t] : []);
      return (s.w ? PW[s.f] : PL[s.f]) || new Set();
    });
    const u = new Set([...occ[0], ...occ[1]]);
    PW[p.k] = u; PL[p.k] = u;
  }
  return PW;
}

// ---------- the Swiss records stage ----------
// Every record a team can finish the Swiss stage on, best first. A record is final when it
// reaches the win cut, the loss cut or the round count, and it is reachable when the record
// before it was not final yet.
function recordChoices(plan) {
  const W = plan.win || 0, Lc = plan.loss || 0, N = plan.rounds || 0;
  const fin = (w, l) => (W && w >= W) || (Lc && l >= Lc) || (N && w + l >= N);
  const out = [];
  const cap = N || (W + Lc);
  for (let w = 0; w <= cap; w++) {
    for (let l = 0; l <= cap; l++) {
      if (!fin(w, l)) continue;
      if ((w > 0 && !fin(w - 1, l)) || (l > 0 && !fin(w, l - 1))) out.push([w, l]);
    }
  }
  return out.sort((a, b) => (b[0] - b[1]) - (a[0] - a[1]) || b[0] - a[0]).map(x => x[0] + '-' + x[1]);
}

// ---------- the stages of a tournament ----------
function playedMatch(m) {
  if (!m) return false;
  if (m.status === 'done' || m.status === 'live') return true;
  if (m.pendingReport) return true;
  return Array.isArray(m.games) && m.games.length > 0;
}
function stamp(t, key) { return (t.predict && t.predict.locked && t.predict.locked[key]) || null; }

// ctx (from the host): divisionCheck(t) -> why the divisions cannot start yet, or null;
// swissPlan(t) -> { win, loss, rounds, final, stage2 } for a Swiss not started yet.
function stagesOf(t, ctx) {
  if (!t || t.imported) return [];
  const out = [];
  const st = t.status;
  const before = st === 'signup' || st === 'draft';
  const started = st === 'running' || st === 'finished';
  const lockOf = (key, ms, extra) => {
    if (st === 'finished') return { state: 'locked', by: 'finish' };
    const s = stamp(t, key);
    if (s) return { state: 'locked', by: s.by || 'start', at: s.at };
    if (ms.some(playedMatch)) return { state: 'locked', by: 'start' };
    return extra || { state: 'open' };
  };
  const teamIds = (t.teams || []).map(x => x.id);

  if (t.competition === 'ffa') {
    const ms = (t.matches || []).filter(m => m.bracket === 'ffa');
    const s = { key: 's1', kind: 'champion', label: 'Champion', teams: teamIds, matches: ms, layout: hash('champion|' + teamIds.slice().sort().join(',')) };
    if (before || teamIds.length < 2) Object.assign(s, { state: 'upcoming', why: 'Opens when the entrants are locked.' });
    else Object.assign(s, lockOf('s1', ms));
    out.push(s);
    return out;
  }

  if (t.bracketType === 'swiss') {
    const plan = started
      ? { win: (t.cfg && t.cfg.winCut) || 0, loss: (t.cfg && t.cfg.lossCut) || 0, rounds: (t.cfg && t.cfg.rounds) || 0, final: !!(t.cfg && t.cfg.final), stage2: !!(t.stage2 && t.stage2.cutTo) }
      : ((ctx && ctx.swissPlan) ? ctx.swissPlan(t) : { win: 0, loss: 0, rounds: 0, final: 0, stage2: 0 });
    const ms = (t.matches || []).filter(m => m.bracket === 'sw');
    const choices = recordChoices(plan);
    const s1 = {
      key: 's1', kind: 'records', label: 'Swiss stage', teams: teamIds, choices, plan, matches: ms,
      layout: hash('records|' + plan.win + '/' + plan.loss + '/' + plan.rounds + '|' + teamIds.slice().sort().join(','))
    };
    if (before || teamIds.length < 2) Object.assign(s1, { state: 'upcoming', why: 'Opens when the teams are locked.' });
    else Object.assign(s1, lockOf('s1', ms));
    out.push(s1);
    if (plan.stage2 || plan.final) {
      const ems = (t.matches || []).filter(m => ELIM[m.bracket]);
      const s2 = { key: 's2', kind: 'bracket', label: plan.stage2 ? 'Playoffs' : 'Final', matches: ems };
      if (!ems.length) Object.assign(s2, { state: st === 'finished' ? 'locked' : 'upcoming', why: 'Opens when the Swiss stage is complete.' });
      else {
        s2.graph = graphOf(ems, 'playoffs');
        s2.layout = s2.graph.layout;
        Object.assign(s2, lockOf('s2', ems));
      }
      out.push(s2);
    }
    return out;
  }

  // single / double elimination, divisions included
  const divs = M.divisionsOn(t) ? (parseInt(t.divisions, 10) || 0) : 0;
  const s1 = { key: 's1', kind: 'bracket', label: divs ? 'Brackets' : 'Bracket' };
  if (started) {
    const ems = (t.matches || []).filter(m => ELIM[m.bracket]);
    s1.matches = ems;
    if (!ems.length) Object.assign(s1, { state: 'upcoming', why: 'Opens when the bracket is made.' });
    else {
      s1.graph = graphOf(ems, t.bracketType);
      s1.layout = s1.graph.layout;
      Object.assign(s1, lockOf('s1', ems));
    }
  } else {
    s1.matches = [];
    const min = t.bracketType === 'double' ? 3 : 2;
    let why = null;
    if (before) why = 'Opens when the teams are locked.';
    else if (teamIds.length < min) why = 'Needs at least ' + min + ' teams.';
    else if (t.pickOpponents && !divs) why = 'Opens once the seeds have chosen their opening opponents.';
    else if (divs && ctx && ctx.divisionCheck) { const e = ctx.divisionCheck(t); if (e) why = 'Opens when the divisions are ready: ' + e; }
    if (why) Object.assign(s1, { state: 'upcoming', why });
    else {
      s1.graph = graphOf(projectBracket(t), t.bracketType);
      s1.layout = s1.graph.layout;
      s1.projected = 1;
      const s = stamp(t, 's1');
      Object.assign(s1, s ? { state: 'locked', by: s.by || 'organizer', at: s.at } : { state: 'open' });
    }
  }
  out.push(s1);
  return out;
}

// The bracket the start will build, built now on a copy: same seeds, same divisions, same shape.
// Match lengths do not matter to a prediction, so every match is a Bo3 here.
function projectBracket(t) {
  const c = {
    id: t.id, competition: t.competition, bracketType: t.bracketType, divisions: t.divisions, teamSize: t.teamSize,
    teams: (t.teams || []).map(x => ({ id: x.id, name: x.name, seed: x.seed, division: x.division || 0, playerIds: [] })),
    players: [], matches: [], veto: { enabled: false }, fveto: null, mapPools: [], poolAssign: {}, status: 'running', cfg: {}
  };
  const divs = M.divisionsOn(t) ? (parseInt(t.divisions, 10) || 0) : 0;
  const n = c.teams.length;
  if (t.bracketType === 'double') {
    if (divs) for (let d = 1; d <= divs; d++) M.buildDouble(c, { wb: [], lb: [], gf: 3 }, d);
    else M.buildDouble(c, { wb: [], lb: [], gf: 3 }, 0);
  } else {
    const third = !!(t.plan && t.plan.thirdPlace) && !divs && n >= 4;
    if (divs) for (let d = 1; d <= divs; d++) M.buildSingle(c, { rounds: [] }, d);
    else M.buildSingle(c, { rounds: [], thirdPlace: third ? 1 : 0 }, 0);
  }
  return c.matches;
}

// The keys a stage is scored on: what was there to pick when it locked.
function stageKeys(t, s) {
  const st = stamp(t, s.key);
  if (st && Array.isArray(st.keys)) return st.keys;
  if (s.kind === 'bracket') return s.graph ? pickableKeys(s.graph) : [];
  if (s.kind === 'records') return s.teams.slice();
  return ['champion'];
}

// Stamp a lock on every stage whose first match has just been played, so that taking a result
// back can never reopen a stage that somebody has already seen a result in.
function stampLocks(t, ctx) {
  if (!t || t.imported || (t.predict && t.predict.off)) return false;
  let changed = false;
  for (const s of stagesOf(t, ctx)) {
    if (stamp(t, s.key) || !s.matches || !s.matches.some(playedMatch)) continue;
    if (!t.predict) t.predict = {};
    if (!t.predict.locked) t.predict.locked = {};
    t.predict.locked[s.key] = { at: Date.now(), by: 'start', keys: stageKeys(t, s) };
    changed = true;
  }
  return changed;
}

// ---------- validating a submission ----------
// Returns { picks, count, total } with only the picks that stand, or { error }.
function cleanPicks(t, s, raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  if (s.kind === 'bracket') {
    const keep = {};
    for (const k of Object.keys(src)) if (s.graph.pos[k] && typeof src[k] === 'string') keep[k] = src[k];
    const c = cascade(s.graph, keep);
    return { picks: c.valid, count: c.made, total: pickableKeys(s.graph).length };
  }
  if (s.kind === 'records') {
    const ok = {};
    const teams = new Set(s.teams);
    for (const id of Object.keys(src)) if (teams.has(id) && s.choices.indexOf(src[id]) >= 0) ok[id] = src[id];
    return { picks: ok, count: Object.keys(ok).length, total: s.teams.length };
  }
  const id = String(src.champion || '');
  return s.teams.indexOf(id) >= 0 ? { picks: { champion: id }, count: 1, total: 1 } : { picks: {}, count: 0, total: 1 };
}

// ---------- scoring ----------
// Marks for one prediction on one stage: { key: 1 correct | 0 wrong | null still open } plus
// counts. `void` keys (a match never played, or no longer there) count for nothing.
function score(t, s, pred, keys) {
  const marks = {};
  const out = { correct: 0, wrong: 0, pending: 0, missing: 0, total: 0, stale: 0 };
  const picks = (pred && pred.picks) || {};
  const stale = !!(pred && pred.layout && s.layout && pred.layout !== s.layout);
  if (stale) out.stale = 1;
  const finished = t.status === 'finished';
  if (s.kind === 'bracket') {
    if (!s.graph) return { marks, ...out };
    const PW = possible(s.graph);
    for (const k of keys) {
      const p = s.graph.pos[k];
      const m = p && p.m;
      const decided = m && (m.status === 'done') && m.winner && m.winner !== 'BYE';
      if (!p || (!decided && finished) || (m && m.status === 'bye')) continue;   // void
      out.total++;
      const pk = stale ? null : picks[k];
      if (!pk) { out.missing++; out.wrong++; marks[k] = 0; continue; }   // can never come right now
      if (decided) { if (m.winner === pk) { out.correct++; marks[k] = 1; } else { out.wrong++; marks[k] = 0; } }
      else if (PW[k] && !PW[k].has(pk)) { out.wrong++; marks[k] = 0; }
      else { out.pending++; marks[k] = null; }
    }
  } else if (s.kind === 'records') {
    const rec = SW.swissRecord(t);
    const swissOver = finished || (t.matches || []).some(m => m.bracket !== 'sw' && ELIM[m.bracket]);
    for (const id of keys) {
      const r = rec[id];
      if (!r) continue;
      out.total++;
      const pk = stale ? null : picks[id];
      const fin = swissOver || (r.state !== 'active' && !r.pending);
      if (!pk) { out.missing++; out.wrong++; marks[id] = 0; continue; }
      const [pw, pl] = pk.split('-').map(Number);
      if (fin) { if (r.wins === pw && r.losses === pl) { out.correct++; marks[id] = 1; } else { out.wrong++; marks[id] = 0; } }
      else if (r.wins > pw || r.losses > pl) { out.wrong++; marks[id] = 0; }
      else { out.pending++; marks[id] = null; }
    }
  } else {
    out.total = 1;
    const pk = stale ? null : picks.champion;
    const champ = finished ? t.championTeamId : null;
    const tm = pk ? (t.teams || []).find(x => x.id === pk) : null;
    if (!pk) { out.missing++; out.wrong++; marks.champion = 0; }
    else if (champ) { if (champ === pk) { out.correct++; marks.champion = 1; } else { out.wrong++; marks.champion = 0; } }
    else if (finished || (tm && tm.eliminated)) { out.wrong++; marks.champion = 0; }
    else { out.pending++; marks.champion = null; }
  }
  return { marks, ...out };
}

// The whole board, best first. A predictor is `perfect` when the tournament is over and every
// stage was predicted and right, and `alive` while that is still possible.
function board(t, stages) {
  const preds = t.predictions || {};
  const rows = [];
  for (const fid of Object.keys(preds)) {
    const pr = preds[fid] || {};
    const row = { fafId: fid, name: pr.name || ('FAF ' + fid), at: 0, correct: 0, wrong: 0, pending: 0, missing: 0, total: 0, stages: {}, alive: 1, perfect: 0 };
    let any = false;
    for (const s of stages) {
      const p = pr[s.key];
      if (p) { any = true; row.at = Math.max(row.at, p.at || 0); }
      if (s.state !== 'locked') {
        // still open: nothing to score yet; a missing or out-of-date prediction can still be made
        row.stages[s.key] = { submitted: p ? 1 : 0, stale: (p && p.layout && s.layout && p.layout !== s.layout) ? 1 : 0 };
        continue;
      }
      const sc = score(t, s, p, stageKeys(t, s));
      delete sc.marks;
      sc.submitted = p ? 1 : 0;
      row.stages[s.key] = sc;
      row.correct += sc.correct; row.wrong += sc.wrong; row.pending += sc.pending; row.missing += sc.missing; row.total += sc.total;
      if (sc.wrong || sc.missing || !p || sc.stale) row.alive = 0;
    }
    if (!any) continue;
    if (t.status === 'finished') row.perfect = (row.alive && stages.every(s => pr[s.key]) && !row.pending && row.total > 0) ? 1 : 0;
    rows.push(row);
  }
  rows.sort((a, b) => b.correct - a.correct || a.wrong - b.wrong || (a.at || 0) - (b.at || 0));
  return rows;
}

module.exports = { posKey, hash, graphOf, cascade, pickableKeys, possible, recordChoices, playedMatch,
  stagesOf, projectBracket, stageKeys, stampLocks, cleanPicks, score, board };
