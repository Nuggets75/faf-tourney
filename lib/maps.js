// NOTE: not yet `// @ts-check` (untyped dynamic map objects, like lib/match.js).
// Map lookups and the public (id-stripped) map view. Pure helpers over the
// tournament's map database. Image file I/O (saveMapImage/deleteMapImage) stays in
// server.js since it is bound to server config (MAP_IMG_DIR, size limits).
'use strict';

function mapById(t, id) {
  if (!t.mapDb) return null;
  for (const m of t.mapDb) if (m.id === id) return m;
  return null;
}

function resolveMaps(t, ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) { const m = mapById(t, id); if (m) out.push(m); }
  return out;
}

function publicMapView(m) {
  return {
    id: m.id, name: m.name, image: m.image || null,
    description: m.description || '',
    spec: m.spec || null,
    published: m.published ? 1 : 0,
    // `secret` is a SEPARATE axis from `published`: an unpublished map is invisible to players
    // (organizer prep), a secret one is visible but nameless until it is actually played.
    // The host redacts the fields above for viewers who may not see through it.
    secret: m.secret ? 1 : 0
  };
}

// Stable "Hidden Map N" numbering: position among the secret maps in the database. It has to be
// stable for the whole tournament, or an organizer cannot tell a player which one they mean, and
// a number that moved between rounds would leak that the pool changed.
function secretNumbers(t) {
  const out = {};
  let n = 0;
  for (const m of (t.mapDb || [])) if (m.secret) out[m.id] = ++n;
  return out;
}

// Which secret maps have stopped being secret. A secret map is revealed the moment it is going
// to be PLAYED - picked for a game, or left standing as the decider - which is exactly what was
// asked for ("when this map is picked it is revealed to the team which map they will play").
// Bans do not reveal unless the organizer turns that on: banning blind is the point of the
// format, and revealing every ban would hand the pool over one map at a time.
// Revealing is global and permanent within the tournament: a played map is on the bracket with
// its picture, so pretending it is still secret anywhere else would be theatre.
function revealedSecrets(t) {
  const out = {};
  const onBan = !!(t.veto && t.veto.revealBans);
  for (const m of (t.matches || [])) {
    if (m && m.veto) {
      for (const g of (m.veto.picks || [])) if (g && g.map) out[g.map] = 1;
      if (m.veto.decider && m.veto.decider.map) out[m.veto.decider.map] = 1;
      if (onBan) for (const x of (m.veto.banned || [])) if (x && x.map) out[x.map] = 1;
    }
    for (const g of (m && m.games) || []) if (g && g.map) out[g.map] = 1;
  }
  // A map pinned directly to a round (vetoes off) is the map that round is played on, so it is
  // as revealed as a picked one - otherwise players would be sent to "Hidden Map 3" with no way
  // to ever learn what it is.
  for (const key of Object.keys(t.maps || {})) {
    for (const id of (t.maps[key] || [])) out[id] = 1;
  }
  return out;
}

// The entry a viewer who may NOT see through secrecy gets for a still-secret map: a number, and
// nothing else. Built from the stored map rather than the public view, so no field can survive
// by being added to publicMapView later and forgotten here.
function maskedMapView(m, n) {
  return {
    id: m.id, name: 'Hidden Map ' + (n || '?'), image: null,
    description: '', spec: null,
    published: m.published ? 1 : 0,
    secret: 1, masked: 1
  };
}

module.exports = { mapById, resolveMaps, publicMapView, secretNumbers, revealedSecrets, maskedMapView };
