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

**Teams**
- Captains draft (pick order: bottom-to-top every round, or snake) with live pick-order display
- Premade teams: one player registers the whole team at once (duplicate names rejected, team size enforced)
- Solo brackets: every signup is an entrant
- Seeding by rating (mandatory at signup) or random

**Running a tournament**
- Launch queue shows what's up next; running scores (e.g. 1-0 in a Bo3) display live
- Per-round map pools with per-game labels, editable by the organizer
- Captains report their own matches via private links; organizer can correct results
- Player editing at any time (doubles as the substitution mechanism)
- Format editor in the Admin tab until the bracket starts
- Standings tab: placements for elimination formats, W/L/game-diff for swiss, points leaderboard for FFA

**Site**
- Start page groups tournaments into Open for signups / Ongoing / Completed
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
| `ADMIN_PASSWORD` | Enables the site-admin login (lock icon, top right). Not set = disabled. Set it in your compose/stack config, never in the repo. |

## Updating

Overwrite the changed files on GitHub (web UI upload works — folder structure in update zips matches the repo), then restart the container. It re-clones on start.

## Roles

- **Site admin**: password from `ADMIN_PASSWORD`, manages everything on the server.
- **Organizer**: whoever creates the tournament gets an admin link (`?admin=TOKEN`). Keep it private.
- **Captains**: the organizer copies each captain's link (`?cap=TOKEN`) from the Admin tab and DMs it. It lets the captain draft on their turn and report their matches.
- **Everyone else**: the public link is read-only + signup.
