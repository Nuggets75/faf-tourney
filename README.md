# FAF Tournaments

Self-hosted tournament manager for FAF (Supreme Commander: Forged Alliance Forever).
Zero dependencies: plain Node.js, JSON file storage, no build step, no npm install.

## Features

**Formats**
- Team brackets 1v1 to 6v6, or FFA (solo, 2-player, or 3-player teams)
- Single elimination, double elimination (with optional "upper bracket finalist starts the grand final 1-0 up"), or swiss
- FFA modes: **points over rounds** (placement points per lobby, optional cut after each round, optional final lobby between the top X) or **knockout** (top 1–4 advance per lobby)
- Swiss: Bo1/Bo3 rounds, optional Bo1–Bo7 final between the top 2, optional **fast pairing** (next matchup starts as soon as two teams are free)
- Best-of per round is configured at creation and visible to players before the bracket starts; still adjustable until the bracket is generated
- Optional max teams/entrants cap

**Teams & seeding**
- Captains draft (pick order: bottom-to-top every round, or snake) with live pick-order display
- **Draft pick undo**: a captain can undo their own most recent pick as long as the next captain hasn't picked yet; the organizer can undo the last pick at any time
- Premade teams: one player registers the whole team at once (duplicate names rejected, team size enforced)
- Solo brackets: every signup is an entrant
- Seeding by rating (mandatory at signup) or random
- **Manual seed override**: before the bracket starts, the organizer can drag teams to reorder, nudge them up/down, randomize, or reset to rating order

**Running a tournament**
- Launch queue shows what's up next; running scores (e.g. 1-0 in a Bo3) display live
- Per-round map pools with per-game labels, editable by the organizer
- **Map veto system** (optional, per tournament): the organizer supplies a map pool and a ban count; before each match the two captains alternate banning maps (higher seed bans first) and the remaining map(s) are what they play. The organizer can ban on a captain's behalf.
- Captains report their own matches via private links; organizer can correct results
- Player editing at any time (doubles as the substitution mechanism)
- Format editor in the Admin tab until the bracket starts
- Standings tab: placements for elimination formats, W/L/game-diff for swiss, points leaderboard for FFA

**Dates & time zones**
- Optional event date + time (entered in UTC) on each tournament, editable at any time (including after it's created or mid-event for short-notice changes)
- Times are stored in UTC and displayed in each viewer's chosen time zone, with the zone shown; the setting lives in the gear menu and is remembered per browser
- The Completed list is ordered by date, most recent first; dates also show on the start-page cards and the overview

**Importing from Challonge**
- Import a completed Challonge tournament (single or double elimination) as a read-only bracket, via the **Import** button in the top bar
- Bracket topology, per-game series scores, and final placements are reconstructed; the tournament's completion date is pulled in automatically
- Imported tournaments are read-only (their date can still be adjusted)
- Access is gated by a separate **import password** (`IMPORT_PASSWORD`) so a trusted helper can import without full site-admin rights; site admins can import without it

**Site**
- Start page groups tournaments into Open for signups / Ongoing / Completed
- Browser tab title reflects the tournament you're viewing; **shareable deep links to a specific tab** (`/t/<id>?tab=bracket`, `?tab=standings`, etc.)
- Player login (name only, pre-fills signup forms; FAF OAuth planned)
- Site admin mode (password via `ADMIN_PASSWORD` env var): full control over every tournament, including deletion
- UI scale setting, no-cache asset delivery (updates show immediately after a container restart)

## Run it

Any Docker host:

```
docker compose up -d
```

Edit the repo URL in `docker-compose.yml` to point at your fork.
The container clones the repo at start and runs `server.js` — no image build needed.

App listens on port **8090**. Data lives in the `faf_tourney_data` volume and survives container restarts; deleting the volume deletes all tournaments.

Environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 8090) |
| `DATA_DIR` | Where `db.json` is stored (default `./data`) |
| `ADMIN_PASSWORD` | Enables the site-admin login (lock icon, top right). Full control. Not set = disabled. |
| `IMPORT_PASSWORD` | Enables the Challonge **Import** button for anyone with this password — importer access only, not full admin. Not set = only site admins can import. |

Set passwords in your compose/stack config, never in the repo. Importing also requires a Challonge API v1 key, which is entered per-import in the UI and not stored.

## Updating

Overwrite the changed files on GitHub (web UI upload works — folder structure in update zips matches the repo), then restart the container. It re-clones on start.

**If updates don't appear after a restart:** the static files are served with no-cache headers, but a reverse proxy in front (e.g. Nginx Proxy Manager) may cache CSS/JS itself. Turn OFF any "Cache Assets" option on the proxy host, then hard-refresh once (Ctrl+Shift+R). Favicons cache especially aggressively — reopen the tab if the icon looks stale.

## Roles

- **Site admin**: password from `ADMIN_PASSWORD`, manages everything on the server.
- **Importer**: password from `IMPORT_PASSWORD`, can use the Challonge importer and nothing else.
- **Organizer**: whoever creates the tournament gets an admin link (`?admin=TOKEN`). Keep it private.
- **Captains**: the organizer copies each captain's link (`?cap=TOKEN`) from the Admin tab and DMs it. It lets the captain draft on their turn (with undo), ban maps in the veto, and report their matches.
- **Everyone else**: the public link is read-only + signup.
