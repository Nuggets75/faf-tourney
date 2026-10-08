// NOTE: not yet `// @ts-check` (same reason as lib/match.js: untyped dynamic
// tournament objects). Behaviour verified by the runtime test suite.
// Swiss format: standings, round pairing, byes, completion, and the after-report
// progression hook. Imports the shared match primitives (newMatch, initMatchVetoes) from
// lib/match.js. lib/match.js calls swissAfterReport back via its injected hook, so
// there is no circular import (swiss -> match only).
//
// Two OPTIONAL layers sit on top of the classic round-count Swiss. Both are off unless
// explicitly configured, and when they are off every function here behaves exactly as it
// did before they existed:
//
//   1. RECORD CUTS (cfg.winCut / cfg.lossCut). A team leaves the stage the moment it
//      reaches either threshold instead of playing a fixed number of rounds - the format
//      used by CS/Valorant majors and by the FAF Invitational ("3 wins advance, 3 losses
//      eliminated"). cfg.rounds becomes a safety cap rather than the terminator.
//      cfg.decidingBo, if set, lengthens exactly those matches where a win qualifies
//      someone or a loss eliminates them.
//   2. STAGE 2 (t.stage2). Instead of crowning the top of the standings, the top N are
//      cut into a playoff bracket inside the SAME tournament. See stageTwoBuild below.
'use strict';

const { newMatch, initMatchVetoes, buildSingle, buildDouble } = require('./match');

// Injected by the host, same idiom as lib/match.js. openStagePicks(t, field) may take over the
// stage-2 build to run an opponent pick phase first; it returns true when it did.
const hooks = { openStagePicks: null };
function setSwissHooks(h) { Object.assign(hooks, h); }

// ---------- optional record cuts ----------

// Normalised view of the cut config. `on` is false for every tournament that does not
// explicitly set a cut, which is the gate every new code path below tests.
function swissCuts(t) {
  const c = (t && t.cfg) || {};
  const w = parseInt(c.winCut, 10);
  const l = parseInt(c.lossCut, 10);
  const win = (w > 0) ? w : 0;
  const loss = (l > 0) ? l : 0;
  return { on: !!(win || loss), win, loss };
}

// The most rounds any single team can play under a set of cuts: it takes (win-1) wins and
// (loss-1) losses to still be alive, and the next game decides it. Used to derive a sane
// safety cap so "Round r / N" still reads correctly in the UI.
function swissCutRounds(win, loss) {
  const w = (win > 0) ? win : 0;
  const l = (loss > 0) ? loss : 0;
  if (!w && !l) return 0;
  if (!w) return l;
  if (!l) return w;
  return w + l - 1;
}

// ONE walk of the matches, shared by standings, progress and pairing, so those three can
// never disagree about a team's record. `state` is the only new concept:
//   'active'     - still playing
//   'advanced'   - hit the win cut (cuts only)
//   'eliminated' - hit the loss cut (cuts only)
//   'done'       - played its full round quota (no cuts)
function swissRecord(t) {
  const cuts = swissCuts(t);
  const rec = {};
  for (const team of t.teams) {
    rec[team.id] = { teamId: team.id, seed: team.seed, wins: 0, losses: 0, gd: 0, byes: 0, played: 0, pending: false, state: 'active' };
  }
  for (const m of t.matches) {
    if (m.bracket !== 'sw') continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (rec[id]) { rec[id].wins++; rec[id].byes++; rec[id].gd += 1; rec[id].played++; }
    } else if (m.status === 'done') {
      const w = rec[m.winner], l = rec[m.loser];
      const ws = m.winner === m.team1 ? m.score1 : m.score2;
      const ls = m.winner === m.team1 ? m.score2 : m.score1;
      if (w) { w.wins++; w.gd += ws - ls; w.played++; }
      if (l) { l.losses++; l.gd -= ws - ls; l.played++; }
    } else {
      if (rec[m.team1]) rec[m.team1].pending = true;
      if (rec[m.team2]) rec[m.team2].pending = true;
    }
  }
  const quota = (t.cfg && t.cfg.rounds) || 0;
  for (const id of Object.keys(rec)) {
    const r = rec[id];
    if (cuts.on) {
      if (cuts.win && r.wins >= cuts.win) r.state = 'advanced';
      else if (cuts.loss && r.losses >= cuts.loss) r.state = 'eliminated';
      else if (quota && r.played >= quota) r.state = 'done';   // safety cap
    } else if (quota && r.played >= quota) {
      r.state = 'done';
    }
  }
  return rec;
}

// Teams still to be decided. Only meaningful with cuts on.
function swissActive(t, rec) {
  const r = rec || swissRecord(t);
  return t.teams.filter(x => r[x.id] && r[x.id].state === 'active').map(x => x.id);
}

// Everyone who cleared the win cut, best record first. This is the qualified field.
function swissAdvanced(t) {
  const rec = swissRecord(t);
  return swissSort(Object.values(rec).filter(r => r.state === 'advanced'), t, rec).map(r => r.teamId);
}

// ---------- the tiebreak between equal records ----------
// 'gd' (the default, and what every tournament has always used): game difference, then seed.
// 'beaten' (the Invitational's rule): the sum of the Swiss scores - wins - of the opponents a team
// BEAT, then a random order: "highest sum of total score (swiss score) of the opponents you beat -
// if its equal then just random order". The random order is seeded from the tournament's draw seed,
// so it is unpredictable beforehand and always the same afterwards, like the draw itself.
function swissTiebreakMode(t) { return (t && t.tiebreak === 'beaten') ? 'beaten' : 'gd'; }

// Sum of the current wins of every opponent each team has beaten in the Swiss. A bye beats nobody.
function beatenScores(t, rec) {
  const out = {};
  for (const id of Object.keys(rec)) out[id] = 0;
  for (const m of (t.matches || [])) {
    if (m.bracket !== 'sw' || m.status !== 'done') continue;
    if (!rec[m.winner] || !rec[m.loser]) continue;
    out[m.winner] += rec[m.loser].wins;
  }
  return out;
}
// A fixed pseudo-random number per team and tournament: the coin flip between equal records.
function tieRandom(t, teamId) {
  let x = 0x811c9dc5;
  const k = String((t && t.cfg && t.cfg.drawSeed) || (t && t.id) || 'seed') + '#tiebreak#' + teamId;
  for (let i = 0; i < k.length; i++) x = Math.imul(x ^ k.charCodeAt(i), 16777619) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
// The numbers the 'beaten' tiebreak ranks on, for showing on the standings table.
function swissTiebreakValues(t) {
  if (swissTiebreakMode(t) !== 'beaten') return null;
  return beatenScores(t, swissRecord(t));
}

// Wins first, then FEWER LOSSES, then game difference, then seed. The losses term only ever
// separates teams on the same wins, and there it is the one that matters: every qualifier has
// three wins, and a 3-0 is a better run than a 3-2 whatever the game difference says. Without it
// a 3-2 who won its three Bo3 deciders 2-0 (+4) out-ranked a 3-0 who won its one 2-1 (+3), and got the
// better playoff seed - and, with the opponent pick on, the pick that went with it.
// `t` selects the tiebreak; `recAll` is the full record (every team), which the 'beaten' tiebreak
// needs even when `rows` is only part of the table. Without `t` it is the default order.
function swissSort(rows, t, recAll) {
  if (swissTiebreakMode(t) !== 'beaten') {
    return rows.slice().sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.gd - a.gd || a.seed - b.seed);
  }
  const sb = beatenScores(t, recAll || swissRecord(t));
  const rnd = {};
  for (const r of rows) rnd[r.teamId] = tieRandom(t, r.teamId);
  return rows.slice().sort((a, b) => b.wins - a.wins || a.losses - b.losses
    || (sb[b.teamId] || 0) - (sb[a.teamId] || 0) || rnd[a.teamId] - rnd[b.teamId] || a.seed - b.seed);
}

function swissStandings(t) {
  const rec = swissRecord(t);
  return swissSort(Object.values(rec), t, rec);
}

// A match is "deciding" when a win qualifies someone or a loss knocks them out. Those are the
// matches LotS plays longer. Returns the tournament Bo unless cuts AND a decidingBo are set.
function swissBoFor(t, rec, aId, bId) {
  const cfg = t.cfg || {};
  const cuts = swissCuts(t);
  const dec = parseInt(cfg.decidingBo, 10);
  if (!cuts.on || !(dec > 0)) return cfg.bo;
  const onTheLine = id => {
    const r = rec[id];
    if (!r) return false;
    if (cuts.win && r.wins === cuts.win - 1) return true;    // a win qualifies them
    if (cuts.loss && r.losses === cuts.loss - 1) return true; // a loss eliminates them
    return false;
  };
  return (onTheLine(aId) || onTheLine(bId)) ? dec : cfg.bo;
}

// Perfect matching inside one score group, avoiding pairs that have already met.
// Exhaustive with backtracking, because a greedy walk corners itself: in a 1-1 group every
// player has exactly one forbidden partner, and picking wrong early forces a rematch at the
// end. Score groups never exceed half the field (8 in a 16-player stage), so this is instant.
// Cost of a rematch, large enough that ONE rematch always outranks every possible same-stream
// pairing in a group. That makes the search lexicographic: never repeat a matchup if there is
// any way not to, and only then worry about crossing the streams.
const REMATCH_COST = 1000;

/**
 * Perfect matching inside one score group.
 *   forbidden[a|b]   - these two have already played. Avoided at almost any price.
 *   discouraged[a|b] - these two arrived in this group from the same place (see pairAcross).
 *                      Avoided, but never at the cost of a rematch.
 * Exhaustive with backtracking, because a greedy walk corners itself: in a 1-1 group every
 * player has exactly one forbidden partner, and picking wrong early forces a rematch at the end.
 * Score groups never exceed half the field (8 in a 16-player stage), so this is instant.
 */
function matchGroup(ids, forbidden, discouraged) {
  const n = ids.length;
  if (n % 2 === 1) return null;
  if (!n) return [];
  const dis = discouraged || {};
  const pairCost = (a, b) => (forbidden[a + '|' + b] ? REMATCH_COST : 0) + (dis[a + '|' + b] ? 1 : 0);
  // Iterative deepening on total cost: a perfect draw first, then the least-bad one. A small
  // field eventually runs out of fresh opponents (an 8-player 3/3 stage does), and drawing a
  // round with one repeat beats refusing to draw it at all.
  const ceiling = REMATCH_COST * n + n;
  for (let allow = 0; allow <= ceiling; allow = (allow < n ? allow + 1 : allow + REMATCH_COST)) {
    const used = new Array(n).fill(false);
    const out = [];
    const walk = (count, spent) => {
      if (count === n) return true;
      let i = 0;
      while (i < n && used[i]) i++;
      if (i >= n) return true;
      used[i] = true;
      for (let j = i + 1; j < n; j++) {
        if (used[j]) continue;
        const cost = pairCost(ids[i], ids[j]);
        if (spent + cost > allow) continue;
        used[j] = true;
        out.push([ids[i], ids[j]]);
        if (walk(count + 2, spent + cost)) return true;
        out.pop();
        used[j] = false;
      }
      used[i] = false;
      return false;
    };
    if (walk(0, 0)) return out;
  }
  return null;
}

// ---------- the draw ----------
// Pairing used to be fully deterministic: the same field produced the same draw every single
// time. The format asks for equal-score opponents drawn RANDOMLY, so the group is shuffled
// before matching. The shuffle is seeded from the tournament's own draw seed plus the round
// number, which means it is unpredictable in advance but reproducible afterwards - an organizer
// can always show that a round was drawn the way the record says it was.
function drawRng(t, round) {
  let x = 0;
  const key = String((t.cfg && t.cfg.drawSeed) || t.id || 'seed') + '#' + round;
  for (let i = 0; i < key.length; i++) x = (x * 31 + key.charCodeAt(i)) >>> 0;
  if (!x) x = 0x9e3779b9;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Each team's record as it stood going INTO `round` - which stream they arrived in this score
// group from. Two players on 2-2 are not in the same situation if one fell from 2-1 and the
// other climbed from 1-2, and the deciding round is meant to put those two against each other.
function recordsBefore(t, round) {
  const out = {};
  for (const team of t.teams) out[team.id] = { wins: 0, losses: 0 };
  for (const m of t.matches) {
    if (m.bracket !== 'sw' || m.round >= round) continue;
    if (m.status === 'bye') {
      const id = m.team1 !== 'BYE' ? m.team1 : m.team2;
      if (out[id]) out[id].wins++;
    } else if (m.status === 'done') {
      if (out[m.winner]) out[m.winner].wins++;
      if (out[m.loser]) out[m.loser].losses++;
    }
  }
  const key = {};
  for (const id of Object.keys(out)) key[id] = out[id].wins + '-' + out[id].losses;
  return key;
}

// Draw one round of a record-cut Swiss: split the active field into score groups, float the
// odd player down a group (standard Swiss practice), and find a rematch-free pairing inside
// each group.
function pairRoundByRecord(t, r, rec, standings, played) {
  const active = standings.filter(s => rec[s.teamId].state === 'active').map(s => s.teamId);
  if (!active.length) return;
  const rnd = drawRng(t, r);
  // The deciding round is the one where the last score group is the merge of two streams: the
  // players who FELL into it and the players who CLIMBED into it. That round pairs across the
  // two, which is the "2-2 from the upper side plays the 2-2 from the lower side" rule.
  // Earlier rounds are left as a plain random draw among equal scores, exactly as specified.
  const lastRound = (t.cfg && t.cfg.rounds) ? (r >= t.cfg.rounds && r > 1) : false;
  // NOT the record entering this round - by then everyone left is on the same one, so it tells
  // you nothing. It is the record entering the PREVIOUS round that says which side they came
  // from: at round 5 a 2-2 was either 2-1 and lost, or 1-2 and won.
  const origin = lastRound ? recordsBefore(t, r - 1) : null;
  const groups = [];
  for (const id of active) {
    const k = rec[id].wins + '-' + rec[id].losses;
    let g = groups[groups.length - 1];
    if (!g || g.k !== k) { g = { k, ids: [] }; groups.push(g); }
    g.ids.push(id);
  }
  // An odd group sends its lowest-ranked player down to the next one. That can make the next
  // group odd in turn, which is correct - the imbalance cascades to the bottom of the table.
  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i].ids.length % 2 === 1) groups[i + 1].ids.unshift(groups[i].ids.pop());
  }
  const last = groups[groups.length - 1];
  if (last.ids.length % 2 === 1) {
    // Bye: lowest-ranked player who has not had one yet. Under cuts a bye is a free win, so
    // it goes to whoever has had the least luck so far, and never twice to the same team.
    // Random among those who have not had one yet, rather than always the bottom of the table.
    const noBye = last.ids.filter(id => !rec[id].byes);
    const from = noBye.length ? noBye : last.ids;
    const chosen = shuffled(from, rnd)[0];
    let pick = last.ids.indexOf(chosen);
    if (pick < 0) pick = last.ids.length - 1;
    const byeTeam = last.ids.splice(pick, 1)[0];
    const bm = newMatch(t, 'sw', r, 99, t.cfg.bo);
    bm.team1 = byeTeam; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = byeTeam; bm.loser = 'BYE';
    if (!last.ids.length) groups.pop();
  }
  let idx = 0;
  for (const g of groups) {
    // Random among equal scores: shuffle before matching, so the draw is not the standings order.
    // The shuffle runs on a CANONICAL order (seed), not on the standings order it arrived in.
    // Fisher-Yates on a different starting order gives a different permutation from the same
    // random stream, and the standings order is sorted by game difference - so without this the
    // draw, while still uniform, moved when a score changed even though nobody's win/loss did.
    // That is not bias, but it made "the draw depends on wins, losses and the seed, and nothing
    // else" untrue, and it was noticed: "worried that it may be also picking based on game diff".
    // Group MEMBERSHIP is still decided by record, and the float-down above still uses standings
    // order - game difference decides who changes group, never who plays whom inside one.
    const bySeed = g.ids.slice().sort((a, b) => (rec[a].seed || 0) - (rec[b].seed || 0));
    const pool = shuffled(bySeed, rnd);
    let discouraged = null;
    if (origin) {
      // same stream = same record going into this round. Discouraged, never forbidden: a
      // rematch is always the worse outcome, and matchGroup weighs them in that order.
      discouraged = {};
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          if (origin[pool[i]] === origin[pool[j]]) {
            discouraged[pool[i] + '|' + pool[j]] = 1;
            discouraged[pool[j] + '|' + pool[i]] = 1;
          }
        }
      }
    }
    const pairs = matchGroup(pool, played, discouraged) || [];
    for (const [a, b] of pairs) {
      const m = newMatch(t, 'sw', r, idx++, swissBoFor(t, rec, a, b));
      m.team1 = a; m.team2 = b; m.status = 'ready';
      initMatchVetoes(t, m);
    }
  }
}

function swissPairRound(t, r) {
  // Opening matchups pinned before the stage started (see swissPlanRound1). Consumed here so
  // the cut path and the plain path both honour them, and cleared either way so a stale plan
  // can never be applied to a later round.
  if (r === 1 && t.plannedR1) {
    const plan = t.plannedR1;
    t.plannedR1 = null;
    if (applyPlannedRound1(t, plan)) return;
    // the field changed since it was pinned: fall through to the normal draw
  }
  const cuts = swissCuts(t);
  const rec = swissRecord(t);
  const standings = swissSort(Object.values(rec), t, rec);
  const played = {};
  for (const m of t.matches) {
    if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
      played[m.team1 + '|' + m.team2] = 1;
      played[m.team2 + '|' + m.team1] = 1;
    }
  }
  if (cuts.on) return pairRoundByRecord(t, r, rec, standings, played);
  const pool = standings.map(s => s.teamId);
  if (pool.length % 2 === 1) {
    let byeIdx = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      const st = standings.find(s => s.teamId === pool[i]);
      if (st && st.byes === 0) { byeIdx = i; break; }
    }
    const byeTeam = pool.splice(byeIdx, 1)[0];
    const bm = newMatch(t, 'sw', r, 99, t.cfg.bo);
    bm.team1 = byeTeam; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = byeTeam; bm.loser = 'BYE';
  }
  let idx = 0;
  while (pool.length) {
    const a = pool.shift();
    let j = 0;
    while (j < pool.length - 1 && played[a + '|' + pool[j]]) j++;
    const b = pool.splice(j, 1)[0];
    const m = newMatch(t, 'sw', r, idx++, swissBoFor(t, rec, a, b));
    m.team1 = a; m.team2 = b; m.status = 'ready';
    initMatchVetoes(t, m);
  }
}

// ---------- arranging round 1 by hand ----------
// Round 1 has no records to pair on, so it is drawn by seed and comes out the same every time.
// Some formats want the opening matchups chosen instead ("I need to be able to pick the first
// set of matchups"), so an organizer can rearrange them - but only while the round is untouched.

// Round 1 is still safe to rewrite: nothing reported, nothing live, no veto acted on.
function swissRound1Open(t) {
  const r1 = (t.matches || []).filter(m => m.bracket === 'sw' && m.round === 1);
  if (!r1.length) return false;
  for (const m of r1) {
    if (m.status === 'done' || m.status === 'live') return false;
    if (Array.isArray(m.games) && m.games.length) return false;
    if (m.veto && ((m.veto.banned || []).length || (m.veto.picks || []).length)) return false;
    if (m.pendingReport) return false;
  }
  return true;
}

/**
 * Replace round 1 with the given pairs. Returns an error string, or null on success, plus the
 * ids of the matches it removed so the host can tidy anything keyed on them.
 * `pairs` is [[teamId, teamId], ...]; any team left over takes the bye.
 */
// Validate a proposed round 1 against the CURRENT field. Split out because the same check has
// to run twice: once when an organizer pins the matchups before the stage starts, and again
// when the stage actually starts, by which time the field may have changed.
// Returns { err } or { clean, left } - `left` being the at most one player who takes the bye.
function r1Check(t, pairs) {
  const ids = {};
  for (const team of t.teams) ids[team.id] = 0;
  const clean = [];
  for (const p of (pairs || [])) {
    if (!Array.isArray(p) || p.length !== 2) return { err: 'Every matchup needs exactly two players' };
    const [a, b] = p;
    if (a === b) return { err: 'A player cannot be matched against themselves' };
    for (const x of [a, b]) {
      if (!(x in ids)) return { err: 'Unknown player in the matchups' };
      if (ids[x]) return { err: 'A player appears in more than one matchup' };
      ids[x] = 1;
    }
    clean.push([a, b]);
  }
  const left = t.teams.filter(x => !ids[x.id]).map(x => x.id);
  if (left.length > 1) return { err: left.length + ' players are not in any matchup' };
  if (left.length === 1 && t.teams.length % 2 === 0) return { err: 'One player is not in any matchup' };
  if (!clean.length && !left.length) return { err: 'No matchups given' };
  return { clean, left };
}

// Pin the opening matchups BEFORE the stage starts. The editor used to exist only once round 1
// had been drawn, which left a race an organizer could not win: start the stage, and a player
// who opens their veto in the next few seconds locks the matchups for good. Planning ahead
// removes the race rather than papering over it.
function swissPlanRound1(t, pairs) {
  const v = r1Check(t, pairs);
  if (v.err) return v.err;
  t.plannedR1 = v.clean.map(p => p.slice());
  return null;
}
function swissShufflePlan(t) {
  const rnd = drawRng(t, 'plan-' + Date.now());
  const pool = shuffled(t.teams.map(x => x.id), rnd);
  const pairs = [];
  while (pool.length > 1) pairs.push([pool.shift(), pool.shift()]);
  t.plannedR1 = pairs;
  return null;
}
// Build round 1 from a plan. Returns false when the plan no longer fits the field - an
// organizer who reopened signups and added a player must get the normal draw, not a round
// that silently leaves somebody out.
function applyPlannedRound1(t, pairs) {
  const v = r1Check(t, pairs);
  if (v.err) return false;
  let idx = 0;
  for (const [a, b] of v.clean) {
    const m = newMatch(t, 'sw', 1, idx++, t.cfg.bo);
    m.team1 = a; m.team2 = b; m.status = 'ready';
    initMatchVetoes(t, m);
  }
  if (v.left.length === 1) {
    const bm = newMatch(t, 'sw', 1, 99, t.cfg.bo);
    bm.team1 = v.left[0]; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = v.left[0]; bm.loser = 'BYE';
  }
  return true;
}

function swissSetRound1(t, pairs, removedOut) {
  if (!swissRound1Open(t)) return 'Round 1 has already started - the matchups are locked in';
  const v = r1Check(t, pairs);
  if (v.err) return v.err;
  const clean = v.clean, left = v.left;

  const removed = (t.matches || []).filter(m => m.bracket === 'sw' && m.round === 1).map(m => m.id);
  if (Array.isArray(removedOut)) for (const id of removed) removedOut.push(id);
  t.matches = (t.matches || []).filter(m => !(m.bracket === 'sw' && m.round === 1));
  let idx = 0;
  for (const [a, b] of clean) {
    const m = newMatch(t, 'sw', 1, idx++, t.cfg.bo);
    m.team1 = a; m.team2 = b; m.status = 'ready';
    initMatchVetoes(t, m);
  }
  if (left.length === 1) {
    const bm = newMatch(t, 'sw', 1, 99, t.cfg.bo);
    bm.team1 = left[0]; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = left[0]; bm.loser = 'BYE';
  }
  return null;
}

// A fresh random round 1, for the "shuffle" button.
function swissShuffleRound1(t, removedOut) {
  const rnd = drawRng(t, 'r1-' + Date.now());
  const pool = shuffled(t.teams.map(x => x.id), rnd);
  const pairs = [];
  while (pool.length >= 2) pairs.push([pool.shift(), pool.shift()]);
  return swissSetRound1(t, pairs, removedOut);
}

function swissMaxRound(t) {
  let r = 0;
  for (const m of t.matches) if (m.bracket === 'sw' && m.round > r) r = m.round;
  return r;
}

// Kept as-is for callers that only care about played/pending. Derived from the same walk
// as standings so the two can never drift.
function swissProgress(t) {
  const rec = swissRecord(t);
  const st = {};
  for (const team of t.teams) st[team.id] = { played: rec[team.id].played, pending: rec[team.id].pending };
  return st;
}

function swissGiveBye(t, teamId, round) {
  const bm = newMatch(t, 'sw', round, 99, t.cfg.bo);
  bm.team1 = teamId; bm.team2 = 'BYE'; bm.status = 'bye'; bm.winner = teamId; bm.loser = 'BYE';
}

// ---------- stage 2 ----------
// t.stage2 = { type:'single'|'double', cutTo:N, rounds:[bo...]|wb/lb/gf, lbHandicap, built }
// The playoff bracket is built from the qualified field only, using a separate seed field so
// the Swiss seeds (which came from rating) are left untouched and still readable.

function stageTwoCfg(t) {
  const s = t && t.stage2;
  if (!s || !s.cutTo) return null;
  return s;
}

// Who goes through. With cuts on that is everyone who cleared the win cut, in standings
// order; without cuts it is simply the top N of the standings.
function stageTwoField(t) {
  const s = stageTwoCfg(t);
  if (!s) return [];
  const cuts = swissCuts(t);
  const n = Math.max(2, parseInt(s.cutTo, 10) || 0);
  if (cuts.on && cuts.win) {
    const adv = swissAdvanced(t);
    if (adv.length >= n) return adv.slice(0, n);
    // Short field (forfeits): top up from the standings so the bracket can still be built.
    const rest = swissStandings(t).map(r => r.teamId).filter(id => adv.indexOf(id) < 0);
    return adv.concat(rest).slice(0, n);
  }
  return swissStandings(t).map(r => r.teamId).slice(0, n);
}

function stageTwoBuild(t, slots) {
  const s = stageTwoCfg(t);
  if (!s || s.built) return false;
  const field = stageTwoField(t);
  if (field.length < 2) return false;
  field.forEach((id, i) => {
    const tm = t.teams.find(x => x.id === id);
    if (tm) tm.stage2Seed = i + 1;
  });
  const opts = { only: field, seedKey: 'stage2Seed' };
  if (Array.isArray(slots) && slots.length) opts.slots = slots;
  if (s.type === 'double') {
    buildDouble(t, {
      wb: s.wb, lb: s.lb, gf: s.gf, lbHandicap: s.lbHandicap ? 1 : 0
    }, 0, opts);
  } else {
    // thirdPlace: the two beaten semi-finalists play for 3rd (lib/match addThirdPlace)
    buildSingle(t, { rounds: s.rounds, thirdPlace: s.thirdPlace ? 1 : 0, thirdBo: s.thirdBo || 0 }, 0, opts);
  }
  s.built = Date.now();
  s.field = field.slice();
  return true;
}

// ---------- completion ----------

function swissStageDone(t) {
  const cuts = swissCuts(t);
  const rec = swissRecord(t);
  if (cuts.on) {
    // decided when nobody is still active and nothing is outstanding
    for (const team of t.teams) {
      const r = rec[team.id];
      if (r.state === 'active') return false;
      if (r.pending) return false;
    }
    return true;
  }
  return !t.teams.some(x => rec[x.id].played < t.cfg.rounds);
}

function swissFinishIfDone(t) {
  if (!swissStageDone(t)) return false;
  const s2 = stageTwoCfg(t);
  if (s2) {
    // When the playoff field picks its own matchups, the host opens that phase first and calls
    // stageTwoBuild itself once every pick is in. hooks.openStagePicks returns true if it took
    // over; nothing here knows how the pick phase works, only that it may exist.
    if (s2.pickPhase && !s2.built && hooks.openStagePicks && hooks.openStagePicks(t, stageTwoField(t))) return true;
    stageTwoBuild(t);        // no-op once built; the bracket crowns the champion from here
    return true;
  }
  const gfExisting = t.matches.find(m => m.bracket === 'gf');
  if (t.cfg.final) {
    if (!gfExisting) {
      const top = swissStandings(t);
      const gf = newMatch(t, 'gf', 1, 0, t.cfg.finalBo);
      gf.team1 = top[0].teamId; gf.team2 = top[1].teamId; gf.status = 'ready';
    }
  } else if (!t.championTeamId) {
    const top = swissStandings(t);
    t.championTeamId = top[0].teamId;
    t.status = 'finished';
  }
  return true;
}

function swissAfterReport(t) {
  if (swissFinishIfDone(t)) return;
  const cuts = swissCuts(t);

  if (cuts.on) {
    // Record cuts pair a whole round at a time. Everyone still active plays in every round,
    // so the score groups stay aligned and the draw can always stay inside a group. Eager
    // pairing cannot do that: it would pair whichever two players happened to finish first,
    // which in practice means re-pairing the two who just played each other.
    const maxR = swissMaxRound(t);
    const open = t.matches.some(m => m.bracket === 'sw' && m.round === maxR &&
      (m.status === 'ready' || m.status === 'live' || m.status === 'waiting'));
    if (open) return;
    const rec = swissRecord(t);
    const active = t.teams.filter(x => rec[x.id].state === 'active');
    if (active.length && maxR < t.cfg.rounds) swissPairRound(t, maxR + 1);
    swissFinishIfDone(t);
    return;
  }

  if (t.cfg.fast) {
    // eager pairing: match up free teams as soon as possible
    for (let guard = 0; guard < 200; guard++) {
      const rec = swissRecord(t);
      const standingsOrder = swissSort(Object.values(rec), t, rec).map(x => x.teamId);
      const pos = {};
      standingsOrder.forEach((id, i) => { pos[id] = i; });
      const pool = t.teams
        .filter(x => rec[x.id].played < t.cfg.rounds && !rec[x.id].pending)
        .map(x => x.id)
        .sort((a, b) => (rec[a].played - rec[b].played) || (pos[a] - pos[b]));
      if (pool.length >= 2) {
        const playedPairs = {};
        for (const m of t.matches) {
          if (m.bracket === 'sw' && m.team1 && m.team2 && m.team1 !== 'BYE' && m.team2 !== 'BYE') {
            playedPairs[m.team1 + '|' + m.team2] = 1;
            playedPairs[m.team2 + '|' + m.team1] = 1;
          }
        }
        const a = pool[0];
        const sameGroup = x => rec[x].played === rec[a].played;
        // prefer same group + no rematch, then same group, then no rematch, then anyone
        let b = pool.slice(1).find(x => sameGroup(x) && !playedPairs[a + '|' + x]);
        if (!b) b = pool.slice(1).find(x => sameGroup(x));
        if (!b) b = pool.slice(1).find(x => !playedPairs[a + '|' + x]);
        if (!b) b = pool[1];
        const m = newMatch(t, 'sw', Math.min(rec[a].played, rec[b].played) + 1, 98, swissBoFor(t, rec, a, b));
        m.team1 = a; m.team2 = b; m.status = 'ready';
        initMatchVetoes(t, m);
        continue; // try to pair more
      }
      if (pool.length === 1) {
        const lonely = pool[0];
        const othersPending = t.teams.some(x => x.id !== lonely &&
          rec[x.id].played < t.cfg.rounds && rec[x.id].pending);
        if (!othersPending) {
          // A bye is a free win. Under cuts that can carry a team over the win cut, so it is
          // only ever handed out when literally nobody else is available to play them.
          swissGiveBye(t, lonely, rec[lonely].played + 1);
          if (swissFinishIfDone(t)) return;
          continue;
        }
      }
      break;
    }
    swissFinishIfDone(t);
    return;
  }

  // classic: next round only when the current one is fully done
  const maxR = swissMaxRound(t);
  const open = t.matches.some(m => m.bracket === 'sw' && m.round === maxR &&
    (m.status === 'ready' || m.status === 'live' || m.status === 'waiting'));
  if (open) return;
  if (maxR < t.cfg.rounds) { swissPairRound(t, maxR + 1); return; }
  swissFinishIfDone(t);
}

module.exports = {
  swissStandings, swissPairRound, swissMaxRound, swissProgress, swissGiveBye,
  swissFinishIfDone, swissAfterReport,
  swissCuts, swissCutRounds, swissRecord, swissActive, swissAdvanced, swissBoFor,
  swissPlanRound1, swissShufflePlan, r1Check, swissTiebreakMode, swissTiebreakValues,
  swissStageDone, stageTwoCfg, stageTwoField, stageTwoBuild, setSwissHooks,
  swissRound1Open, swissSetRound1, swissShuffleRound1, recordsBefore,
};
