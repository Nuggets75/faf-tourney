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
  return { id: m.id, name: m.name, image: m.image || null, description: m.description || '', published: m.published ? 1 : 0 };
}

module.exports = { mapById, resolveMaps, publicMapView };
