// Opponent pick phase: the top half of the seeds choose who they play in round one, instead of
// the bracket pairing them automatically. LotS has always done this by DM to the TD; this is the
// same thing on the site, with a clock so one absent player cannot stall the event.
//
// Shape (only present when a tournament opts in):
//   t.pickPhase = {
//     status:'open'|'done', field:[teamId...seed order], half:N,
//     order:[teamId...], picks:{ picker: target }, log:[...],
//     perPickMs: number|null, turnStartedAt: ms|null, startedAt, doneAt
//   }
//
// Two ways to decide who picks. A phase with no `mode` is the original one and behaves exactly
// as it always has: the top half of the seeds pick, from the bottom half.
//   mode:'unbeaten' - only the players who came through the Swiss stage without a loss pick (the
//                     3-0s of a 3-wins/3-losses stage), and they may pick anyone else in the field.
//                     Everyone left over once they have picked is DRAWN against each other, on
//                     different records where possible (3-1 against 3-2). Extra fields:
//                     pool:[teamId...] who can be picked, records:{ teamId: 'W-L' },
//                     drawKey: the seed of the draw, so it is random but reproducible.
//                     Two optional narrowings of it, used together by "the 3-0s pick from the
//                     3-2s": poolRule (the pool was chosen by the host, e.g. only the lowest record
//                     that went through) and rest:'seed' (whoever nobody picked is paired BY SEED,
//                     best remaining against lowest, instead of drawn).
// There is no background timer anywhere in this app, so the deadline is swept lazily: every
// read of the phase applies any pick whose clock has run out. That is the same idiom as
// scheduled publishing and qualification.
'use strict';

const { seedOrder, nextPow2 } = require('./bracket');

function pickPhaseOf(t) {
  const p = t && t.pickPhase;
  return (p && p.status) ? p : null;
}

/** Is n a power of two (and at least 4)? */
function fullBracket(n) { return n >= 4 && (n & (n - 1)) === 0; }

/**
 * Open the phase for an ordered field (best seed first). The top half pick, in seed order.
 *
 * The field MUST be a full bracket (4, 8, 16, 32...). With any other size the bracket has byes,
 * and a bye is a free win that nobody chose and nobody can pick - there is no honest way to say
 * whose opponent it is. Refusing is better than inventing a rule the players did not agree to.
 */
function startPickPhase(t, fieldIds, opts) {
  const o = opts || {};
  const field = (fieldIds || []).slice();
  if (!fullBracket(field.length)) return null;
  const half = field.length / 2;
  t.pickPhase = {
    status: 'open',
    field: field,
    half: half,
    order: field.slice(0, half),
    picks: {},
    log: [],
    perPickMs: o.perPickMs || null,
    turnStartedAt: o.perPickMs ? Date.now() : null,
    startedAt: Date.now(),
    doneAt: null
  };
  if (o.mode === 'unbeaten') {
    const p = t.pickPhase;
    // Pickers are taken from the top half only, in seed order. Every top-half seed has its own
    // first-round slot in the standard layout, so each picker keeps a slot of their own and the
    // two best records stay on opposite sides of the bracket. The Swiss standings rank a 0-loss
    // record above every other, so the unbeaten ARE the top seeds; the filter only makes that a
    // guarantee instead of an assumption.
    const want = {};
    for (const id of (o.pickers || [])) want[id] = 1;
    p.mode = 'unbeaten';
    p.order = field.slice(0, half).filter(id => want[id]);
    p.pool = field.filter(id => p.order.indexOf(id) < 0);
    p.records = Object.assign({}, o.records || {});
    p.drawKey = String(o.drawKey || 'draw');
    if (Array.isArray(o.pool)) {
      // A narrower pool ("from the 3-2s"). A picker is never in it. If it cannot give every picker
      // someone to choose, the lowest remaining seeds top it up, so nobody is left with no option.
      const inField = {};
      for (const id of field) inField[id] = 1;
      let pool = o.pool.filter(id => inField[id] && p.order.indexOf(id) < 0);
      if (pool.length < p.order.length) {
        const extra = field.slice().reverse().filter(id => p.order.indexOf(id) < 0 && pool.indexOf(id) < 0);
        pool = pool.concat(extra.slice(0, p.order.length - pool.length));
      }
      p.pool = field.filter(id => pool.indexOf(id) >= 0);          // kept in seed order
      p.poolRule = String(o.poolRule || 'custom');
    }
    if (o.rest === 'seed') p.rest = 'seed';
    if (!p.order.length) {
      // Nobody went through unbeaten: there is nothing to pick, and the whole field is drawn.
      p.status = 'done'; p.doneAt = Date.now(); p.turnStartedAt = null;
    }
  }
  return t.pickPhase;
}

/** Everyone who can still be chosen: the bottom half, or in 'unbeaten' mode everyone who is not picking. */
function availableTargets(t) {
  const p = pickPhaseOf(t);
  if (!p) return [];
  const taken = {};
  for (const k of Object.keys(p.picks)) taken[p.picks[k]] = 1;
  return (p.pool || p.field.slice(p.half)).filter(id => !taken[id]);
}

/** Whose turn it is, or null when every pick is in. */
function currentPicker(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open') return null;
  for (const id of p.order) if (!p.picks[id]) return id;
  return null;
}

/**
 * The opponent the standard bracket would have given this picker. Used as the automatic choice
 * when someone's clock runs out, so "not picking" lands you exactly where you would have been
 * anyway rather than punishing you.
 */
function defaultTargetFor(t, pickerId) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  const free = availableTargets(t);
  if (!free.length) return null;
  const size = nextPow2(p.field.length);
  const order = seedOrder(size);                        // 1-based seed positions
  const seedOf = id => p.field.indexOf(id) + 1;
  const mySeed = seedOf(pickerId);
  const at = order.indexOf(mySeed);
  if (at >= 0) {
    const partnerSeed = order[at % 2 === 0 ? at + 1 : at - 1];
    const partner = p.field[partnerSeed - 1];
    if (partner && free.indexOf(partner) >= 0) return partner;
  }
  // mirror already taken: the closest remaining seed to it
  const want = size + 1 - mySeed;
  return free.slice().sort((a, b) => Math.abs(seedOf(a) - want) - Math.abs(seedOf(b) - want))[0] || free[0];
}

/** ms left on the current pick, or null when there is no clock. */
function msLeft(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open' || !p.perPickMs || !p.turnStartedAt) return null;
  return Math.max(0, (p.turnStartedAt + p.perPickMs) - Date.now());
}

function recordPick(t, pickerId, targetId, byName, auto) {
  const p = pickPhaseOf(t);
  p.picks[pickerId] = targetId;
  p.log.push({ by: pickerId, byName: byName || '', target: targetId, at: Date.now(), auto: auto ? 1 : 0 });
  p.turnStartedAt = p.perPickMs ? Date.now() : null;
  if (!currentPicker(t)) { p.status = 'done'; p.doneAt = Date.now(); p.turnStartedAt = null; }
}

/**
 * Apply any pick whose clock has run out. Returns the list of automatic picks made, so the
 * caller can log them. Loops, because several clocks can have lapsed since the last read.
 */
function sweepPickDeadlines(t) {
  const p = pickPhaseOf(t);
  if (!p || p.status !== 'open' || !p.perPickMs) return [];
  const made = [];
  for (let guard = 0; guard < 64; guard++) {
    const who = currentPicker(t);
    if (!who) break;
    if (!p.turnStartedAt) { p.turnStartedAt = Date.now(); break; }
    if (Date.now() < p.turnStartedAt + p.perPickMs) break;
    const target = defaultTargetFor(t, who);
    if (!target) break;
    // The next picker's clock started the moment this one ran out, not now - otherwise a sweep
    // after a long gap would only ever resolve one lapsed pick per read.
    const lapsedAt = p.turnStartedAt + p.perPickMs;
    recordPick(t, who, target, 'Auto', true);
    if (p.status === 'open') p.turnStartedAt = lapsedAt;
    made.push({ by: who, target: target });
  }
  return made;
}

// ---------- the draw of the players nobody picked ('unbeaten' mode) ----------
// Seeded xorshift, the same idiom as the Swiss draw: unpredictable in advance, reproducible after.
// FNV-1a for the seed and a short warm-up, because xorshift's first outputs from a small seed are
// tiny, and a Fisher-Yates fed tiny numbers barely moves anything.
function drawRng(key) {
  let x = 0x811c9dc5;
  const k = String(key || 'draw');
  for (let i = 0; i < k.length; i++) x = Math.imul(x ^ k.charCodeAt(i), 16777619) >>> 0;
  if (!x) x = 0x9e3779b9;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  for (let i = 0; i < 8; i++) next();
  return next;
}
function shuffled(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// The fewest same-record pairs ANY pairing of these players can have. None, unless one record is
// held by more than half of them - then the surplus has nobody else to play and pairs up among itself.
function minSameRecord(ids, rec) {
  const count = {};
  let most = 0;
  for (const id of ids) {
    const k = rec[id] || '';
    count[k] = (count[k] || 0) + 1;
    if (count[k] > most) most = count[k];
  }
  return Math.max(0, most - ids.length / 2);
}

/**
 * The players nobody picked, drawn against each other. Random (seeded by drawKey), with as many
 * pairs as possible between DIFFERENT records - 3-1 against 3-2 - because that is the stated
 * preference. Built one pair at a time in shuffled order, each taking the first partner that
 * still leaves the best possible result reachable: the preference is met exactly, the rest is chance.
 * Returns [[better seed, other], ...], best pair first. Empty until every pick is in.
 */
function drawRemainder(t) {
  const p = pickPhaseOf(t);
  if (!p || p.mode !== 'unbeaten' || p.status !== 'done') return [];
  if (p.rest === 'seed') return seededRest(p);
  const taken = {};
  for (const id of p.order) taken[id] = 1;
  for (const k of Object.keys(p.picks)) taken[p.picks[k]] = 1;
  const rec = p.records || {};
  const same = (a, b) => (rec[a] || '') === (rec[b] || '');
  let left = shuffled(p.field.filter(id => !taken[id]), drawRng(p.drawKey));
  let budget = minSameRecord(left, rec);
  const pairs = [];
  while (left.length >= 2) {
    const a = left[0];
    let at = -1;
    for (let j = 1; j < left.length && at < 0; j++) {
      const cost = same(a, left[j]) ? 1 : 0;
      if (cost > budget) continue;
      const rest = left.filter((_, k) => k !== 0 && k !== j);
      if (cost + minSameRecord(rest, rec) <= budget) at = j;
    }
    if (at < 0) at = 1;                     // unreachable: the budget is always achievable
    if (same(a, left[at])) budget--;
    pairs.push([a, left[at]]);
    left = left.filter((_, k) => k !== 0 && k !== at);
  }
  const seedOf = id => p.field.indexOf(id);
  return pairs.map(pr => pr.slice().sort((x, y) => seedOf(x) - seedOf(y)))
    .sort((x, y) => seedOf(x[0]) - seedOf(y[0]));
}

// Whoever nobody picked, paired BY SEED instead of drawn: the best remaining seed against the
// lowest remaining one, the next against the next-lowest - "seed the players in order of standing".
// With the 3-0s picking from the 3-2s that leaves 3, 4, 5 and one 3-2: 3 plays the 3-2, 4 plays 5,
// which is exactly where the standard bracket would have put them.
function seededRest(p) {
  const taken = {};
  for (const id of p.order) taken[id] = 1;
  for (const k of Object.keys(p.picks)) taken[p.picks[k]] = 1;
  const rest = p.field.filter(id => !taken[id]);                   // seed order
  const pairs = [];
  for (let i = 0, j = rest.length - 1; i < j; i++, j--) pairs.push([rest[i], rest[j]]);
  return pairs;
}

// 'unbeaten' mode as bracket slots. Each picker keeps the slot the standard layout gives their
// seed and meets the player they chose. The drawn pairs fill the other first-round matches, the
// pair with the best seed in it taking the best seed's usual slot, and so on - so the bracket is
// spread the way a seeded one is, and only the matchups themselves came from picks and the draw.
function unbeatenSlots(p, drawn) {
  const order = seedOrder(p.field.length);
  const base = order.map(sd => p.field[sd - 1]);
  const seedOf = id => p.field.indexOf(id) + 1;
  const picker = {};
  for (const id of p.order) picker[id] = 1;
  const slots = base.slice();
  const open = [];
  for (let i = 0; i < base.length; i += 2) {
    const top = seedOf(base[i]) <= seedOf(base[i + 1]) ? 0 : 1;   // which side holds the better seed
    const best = base[i + top];
    if (picker[best] && p.picks[best]) {
      slots[i + top] = best;
      slots[i + 1 - top] = p.picks[best];
    } else {
      open.push({ i: i, top: top, seed: seedOf(best) });
    }
  }
  open.sort((x, y) => x.seed - y.seed);
  drawn.forEach((pair, k) => {
    const o = open[k];
    if (!o) return;
    slots[o.i + o.top] = pair[0];
    slots[o.i + 1 - o.top] = pair[1];
  });
  return slots;
}

/**
 * The chosen pairings as first-round bracket slots. Takes the standard seeded layout and swaps
 * each top-half seed's partner for the opponent they picked, so the top seeds stay spread across
 * the bracket exactly as normal - only WHO they meet changes, not where they sit.
 */
function pickedSlots(t) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  if (p.mode === 'unbeaten') return unbeatenSlots(p, drawRemainder(t));
  const size = nextPow2(p.field.length);
  const order = seedOrder(size);
  const slots = order.map(sd => (sd <= p.field.length ? p.field[sd - 1] : 'BYE'));
  const topHalf = {};
  p.field.slice(0, p.half).forEach(id => { topHalf[id] = 1; });
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i], b = slots[i + 1];
    if (topHalf[a] && p.picks[a]) slots[i + 1] = p.picks[a];
    else if (topHalf[b] && p.picks[b]) slots[i] = p.picks[b];
  }
  return slots;
}

/** A view for the client: whose turn, what is left, and the pairings so far. */
function pickView(t, myTeamIds) {
  const p = pickPhaseOf(t);
  if (!p) return null;
  const mine = {};
  for (const id of (myTeamIds || [])) mine[id] = 1;
  const turn = currentPicker(t);
  const view = {
    status: p.status,
    half: p.half,
    field: p.field.slice(),
    order: p.order.slice(),
    picks: Object.assign({}, p.picks),
    available: availableTargets(t),
    turn: turn,
    myTurn: !!(turn && mine[turn]),
    msLeft: msLeft(t),
    perPickMs: p.perPickMs || null,
    log: p.log.slice(-40),
    doneAt: p.doneAt || null
  };
  if (p.mode === 'unbeaten') {
    view.mode = 'unbeaten';
    view.rest = p.rest === 'seed' ? 'seed' : 'draw';
    view.pool = (p.pool || []).slice();
    if (p.poolRule) view.poolRule = p.poolRule;
    view.records = Object.assign({}, p.records || {});
    // The draw is only real once the bracket is built from it; before that there is nothing to show.
    view.drawn = (p.applied && Array.isArray(p.drawn)) ? p.drawn.map(x => x.slice()) : [];
  }
  return view;
}

module.exports = {
  fullBracket, pickPhaseOf, startPickPhase, availableTargets, currentPicker, defaultTargetFor,
  msLeft, recordPick, sweepPickDeadlines, pickedSlots, pickView, drawRemainder, minSameRecord
};
