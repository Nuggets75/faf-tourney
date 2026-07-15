# FAF Tournaments

Self-hosted tournament manager for the FAF (Supreme Commander: Forged Alliance Forever) community.

Zero runtime dependencies: plain Node.js (built-in `http` only), JSON file storage, no build step, no `npm install` in production. The container clones the repo and runs `server.js` directly.

---

## Features

### Formats
- Team brackets 1v1 to 6v6, or FFA (solo, or teams).
- Single elimination, double elimination (with an optional "upper-bracket finalist starts the grand final 1-0 up"), Swiss, or FFA.
- FFA modes: points over rounds (placement points per lobby, optional cut after each round, optional final lobby between the top X) or knockout (top 1-4 advance per lobby).
- Swiss: Bo1/Bo3 rounds, optional final between the top 2, optional fast pairing (next matchup starts as soon as two teams are free).
- Best-of per round is configured at creation, visible to players before the bracket starts, and adjustable until the bracket is generated.
- Optional max teams/entrants cap.

### Identity and access (FAF login)
- FAF OAuth login (OpenID Connect via Ory Hydra). It stays dormant until the three `FAF_*` environment variables are set; without them the site runs the legacy name-only flow unchanged, so any build is safe to deploy at any time.
- With FAF login on, actions are gated by FAF identity: players carry their FAF account, and captains act by their FAF identity (no per-captain links to hand out).
- Hosting approval: when FAF login is on, creating a tournament requires per-account approval by the site admin (Requests tab). When it is off, anyone can create, as before.

### Teams and seeding
- Premade teams (one player registers the whole team), open teams (players sign up solo then self-organise; only full teams enter the bracket, incomplete ones become reserves), or captain draft.
- Captain draft with pick order (bottom-to-top every round, or snake) and a live pick-order display. A captain can undo their own most recent pick until the next captain picks; the organizer can undo the last pick at any time.
- Solo brackets: every signup is an entrant.
- Seeding by rating or random, with a manual seed override before the bracket starts (reorder, nudge, randomize, reset).
- King/Prince divisions: split full teams into skill divisions by combined rating, each playing its own bracket (single/double elim only).

### Team rename
- Organizers and site admins can rename any team, any time, as often as needed.
- In a team game (more than one player per team), a captain gets a single one-time rename of their own team. Solo tournaments have no captain rename. Duplicate names are rejected.

### Maps, pools, and vetoes
- A per-tournament map database with preview images, descriptions, and publish/hide.
- Named map pools, each with its own best-of and its own ban/pick order. A pool's sequence length is tied to its size so that exactly one map is left as the decider, which means one order cannot serve pools of different sizes even at the same best-of.
- Pools can be assigned to whole rounds or to specific matches, including before the bracket is generated (rounds are projected from the expected team count).
- Optional per-match veto engine: the two sides (Team A acts first) alternate bans and picks per the pool's order. A/B sides are decided per match by the captain's rating (random / lower-rated-is-A / lower-rated-is-B / manual). Vetoes can be enabled or disabled mid-bracket.
- Maps are referenced by id everywhere and resolved to names at display time, so renaming a map updates it everywhere and deleting one cascades cleanly.

### Running a tournament
- Launch queue shows what is next; running scores (e.g. 1-0 in a Bo3) display live.
- Captains report their own matches; the organizer can correct results.
- Player editing at any time (this is also the substitution mechanism).
- Standings tab: placements for elimination formats, W/L/game-diff for Swiss, points leaderboard for FFA.

### Dates and time zones
- Optional event date and time (entered in UTC) per tournament, editable any time.
- Stored in UTC, displayed in each viewer's chosen time zone (remembered per browser). The Completed list is ordered most-recent-first.

### Importing from Challonge
- Import a completed Challonge tournament (single or double elimination) as a read-only bracket via the Import button. Bracket topology, per-game series scores, and final placements are reconstructed.
- Gated by a separate import password so a trusted helper can import without full site-admin rights. A Challonge API v1 key is entered per import and never stored.

### Site admin
- `/siteadmin`, gated by `ADMIN_PASSWORD`.
- Requests tab: pending hosting requests (approve/deny), the allowed list (with revoke), and a direct grant by FAF id.
- Logs tab: the audit log, newest first (capped, trimmed oldest-first).

---

## Architecture

Plain `http` server, no framework, JSON file storage. Since the last refactor the code is split into small modules; there is still no build step and no runtime dependency.

```
server.js            HTTP layer: router, auth/OAuth, sessions, static + image serving,
                     storage (loadDB/saveDB), audit, hosting approval
challonge.js         Challonge import
lib/util.js          leaf helpers (ids, names, dates, base64url, entity lookups, ...)
lib/bracket.js       pure bracket math (seeding, sizing, best-of validation)
lib/match.js         match core + veto engine (create/route/evaluate/finalize, builders,
                     pools, ban/pick sequence, A/B)
lib/swiss.js         Swiss standings/pairing/progression
lib/ffa.js           FFA groups/points/ranking/rounds
lib/teams.js         team formation (manual/open/grouped, draft, seeding)
lib/maps.js          map lookups and the public (id-stripped) map view
public/index.html
public/app.js        client (loaded first)
public/app.home.js   client (home, tournament shell, overview)
public/app.entrants.js  client (players, teams/draft, start config)
public/app.bracket.js   client (bracket/rounds, veto)
public/app.results.js   client (report, standings, admin, routing)
public/style.css
docker-compose.yml
```

The client is delivered as several ordinary (non-module) scripts loaded in order; together they run in one shared global scope, exactly as a single file would.

### Storage
A single JSON file at `DATA_DIR/db.json`, keyed by `tournaments`, `sessions` (FAF login), `oauthPending`, `auditLog` (capped at 5000), `hostRequests`, and `hostAllowed`. Map preview images are written as binary to `MAP_IMG_DIR` and served from `/map-images/<file>`; `db.json` stores only the filename.

---

## Run it

Any Docker host:

```
docker compose up -d
```

Edit the repo URL in `docker-compose.yml` to point at your fork. The container clones the repo at start and runs `server.js` - no image build needed. It listens on port 8090. Data lives in the `faf_tourney_data` volume and survives restarts; deleting the volume deletes all tournaments.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 8090). |
| `DATA_DIR` | Where `db.json` is stored (default `./data`). |
| `ADMIN_PASSWORD` | Enables the site-admin console. Gates the whole admin area. Not set = disabled. |
| `IMPORT_PASSWORD` | Enables the Challonge Import button for anyone with this password (importer access only, not full admin). Not set = only site admins can import. |
| `FAF_CLIENT_ID` | FAF OAuth client id. |
| `FAF_CLIENT_SECRET` | FAF OAuth client secret (never in the repo). |
| `FAF_REDIRECT_URI` | Must exactly match what FAF registered, e.g. `https://your.host/auth/faf/callback`. |
| `MAP_IMG_DIR` | Optional. Where map images are written (default `DATA_DIR/map-images`). Set to relocate them to another drive. |

FAF login is active only when all three `FAF_*` variables are set. Removing them reverts to the legacy name-only flow (a safe rollback). Set secrets in your compose/stack config, never in the repo.

---

## Updating

Overwrite the changed files on GitHub (the web UI upload works; the folder structure in an update zip matches the repo), then restart the container - it re-clones on start.

If updates do not appear after a restart: static files are served with no-cache headers, but a reverse proxy in front (e.g. Nginx Proxy Manager) may cache CSS/JS itself. Turn OFF any "Cache Assets" option on the proxy host, then hard-refresh once (Ctrl+Shift+R). Favicons cache aggressively - reopen the tab if the icon looks stale.

---

## Development

No dependencies are needed to run the app. For editing there are optional dev-only tools (`typescript`, `@types/node`) declared in `package.json`; they never run in production (the container only clones and runs `node server.js`).

- Syntax check every source file: `npm run check`
- Type-check (JSDoc + `// @ts-check`, no emit): `npm run typecheck`

Type-checking is opt-in per file via a top-of-file `// @ts-check` comment; `lib/util.js` and `lib/bracket.js` are checked today, the larger modules are not yet annotated. There is no compile step - `@ts-check` catches bugs in the editor and CI without changing what runs.

---

## Roles

- Site admin: password from `ADMIN_PASSWORD`; manages everything on the server, including deletion.
- Importer: password from `IMPORT_PASSWORD`; can use the Challonge importer and nothing else.
- Organizer: whoever creates the tournament. With FAF login on, hosting requires site-admin approval first, and the organizer is recognised by their FAF identity.
- Captains: with FAF login on, captains act by their FAF identity - they draft on their turn, ban/pick in the veto, report their matches, and get one team rename in team games.
- Everyone else: the public view is read-only plus signup.
