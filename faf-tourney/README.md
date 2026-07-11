# FAF Tourney

Self-hosted tournament manager for FAF (Supreme Commander: Forged Alliance Forever).

- Create tournaments (1v1 to 4v4, Bo1–Bo7)
- Open signups, no accounts needed
- Two team formats: **captains draft** (snake picks) or **premade teams**
- Auto-generated single-elimination bracket with byes
- Captains report scores via private captain links; winners advance automatically
- "Launch queue" overview shows what's up next
- Zero dependencies: plain Node.js, JSON file storage

## Run it

Any Docker host:

```
docker compose up -d
```

Edit the `REPO` variable in `docker-compose.yml` to point at your fork.
The container clones this repo at start and runs `server.js` — no image build needed.

App listens on port **8090**. Data is stored in the `faf_tourney_data` volume.

## Roles (no login yet)

- **Organizer**: whoever creates the tournament gets an admin link (`?admin=TOKEN`). Keep it private.
- **Captains**: after teams form, the organizer copies each captain's link (`?cap=TOKEN`) from the Admin tab and DMs it to them. That link lets the captain draft on their turn and report their matches.
- **Everyone else**: the public link is read-only + signup.

FAF login-server integration is planned for later.
