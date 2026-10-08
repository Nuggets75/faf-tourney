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
- Swiss **record cuts** (optional): instead of a fixed number of rounds, teams leave the stage the moment they reach a win or loss threshold - "3 wins advance, 3 losses eliminated", the format used by the FAF Invitational and LotS. The round count is then derived, not chosen: the longest anyone can play is (wins - 1) + (losses - 1) + 1, so 3/3 is five rounds. Pairing stays inside a score group, never repeats a matchup, and floats the odd player down a group the way Swiss always has. Measured behaviour: 16 teams at 3/3 never needs a repeat and always advances exactly 8. Below 2^(cut+1) teams the draw can run out of fresh opponents, and the organizer is warned at start rather than blocked.
- **The draw inside a score group is random**, not a fixed order. It is seeded from a draw seed
  stored on the tournament, so it is unpredictable in advance but reproducible afterwards - an
  organizer can always show that a round was drawn the way the record says. Byes are drawn at
  random too, among those who have not had one.
- **The draw depends on wins, losses and the seed, and nothing else.** Score groups are keyed on the
  win-loss record alone, and the shuffle inside a group starts from seed order - it used to start
  from the standings order, which is sorted by game difference, so a changed score could move the
  draw even though nobody's record changed. Measured over 4000 draws, like-with-like pairings come
  out at exactly the uniform rate. Game difference decides only which player floats down from an
  odd group, never who plays whom inside one.
- **Each Swiss match shows its score group** (`2-1`, `1-2`, or `2-1 vs 1-2` for a floated pairing),
  and each round is listed best group first. It is the record the players brought *into* that round,
  not their current one - once round 4 is played everyone in it is 2-2.
- **Every planned round gets a map-pool slot**, including rounds not yet opened, so the next round's
  pool can be set before it is played. With record cuts the planned count is derived (3/3 is five
  rounds); it used to fall back to log2 of the field and show four.
- **Round 1 can be arranged by hand, before the stage starts.** There are no records to pair on in
  the opening round, so the site draws it; an organizer can set the matchups on the Bracket tab as
  soon as the entrants are locked, or re-draw them at random. They are pinned and applied the
  instant the stage starts, so nobody can lock them by opening a veto first - which is exactly how
  they were lost in a live event when the editor only existed after the start. A pinned plan is
  checked again at the start and dropped (the normal draw takes over) if the field has changed;
  reopening signups clears it. After the start the same editor still works until the first result
  or veto action. Every player appears exactly once, with the leftover taking the bye in an odd field.
- **The deciding round pairs across the two streams.** The last score group is a merge: players
  who *fell* into it from a better record, and players who *climbed* into it from a worse one.
  That round puts the two against each other - "the 2-2 from the upper side plays the 2-2 from
  the lower side". Never at the cost of a rematch: rematch avoidance always wins, and a
  same-stream pairing only ever appears when no clean draw exists at all. Measured over 400
  randomised 16-player runs: 1190 of 1200 deciding-round matches crossed the streams, and every
  one of the other 10 was mathematically forced.
- **Deciding-match length** (optional, with record cuts): a match where a win qualifies someone or a loss knocks them out can be played at a different best-of from the rest. LotS runs Bo1 throughout and Bo3 for those.
- **Two stages in one tournament** (optional): a Swiss stage can cut its qualified field into a single- or double-elimination playoff bracket inside the same tournament - one page, one chat, one set of standings, no second event and no invites to accept. The playoff bracket is seeded from the Swiss standings and appears above the Swiss rounds on the Bracket tab. That tab is called **Rounds** while the Swiss is played and **Bracket** once the playoffs exist (the pick phase or the bracket), and the stage bar follows it.
- **Swiss standings rank wins, then fewer losses**, then game difference, then seed. Every qualifier
  has the same number of wins, so the losses term is what puts a 3-0 above a 3-1 above a 3-2. It
  used to go straight to game difference, and with Bo3 deciders a 3-2 who won three deciders 2-0
  (+4) out-ranked a 3-0 who won one 2-1 (+3) - and took the better playoff seed with it.
- **The tiebreak between equal records is a per-tournament choice**: game difference (the default,
  and what every existing tournament keeps), or the **sum of the Swiss scores of the opponents a
  player beat, then random** - the Invitational's rule ("highest sum of total score of the
  opponents you beat - if its equal then just random order"). A player's number is the current
  wins of everyone they beat; a bye beats nobody. The coin flip is seeded from the tournament's
  draw seed, so it cannot be predicted and always comes out the same. With a playoff stage it
  decides who goes through, the playoff seeds, and so who picks and in what order: with "the top
  half pick", the two 3-0s pick first and then the two best 3-1s by this number. Set it on the
  Format panel, or on the Playoffs panel while the Swiss runs (once the playoffs exist, changing it
  means redoing them). With it on, the standings show a **Beaten opp.** column so the order can be
  checked. The standings table takes its order from the server, so the page can never disagree
  with the seeds.
- **Correcting a Swiss result after the playoffs are set up** makes them again from the corrected
  standings, if the correction changed who went through, their order or their records (a score
  typo that changes none of that leaves them alone). Once a playoff match has started the Swiss
  results are locked, the same rule as a Swiss round with later rounds played on top of it. A
  correction the site refuses (a 3 in a Bo3, say) now changes nothing at all; it used to leave the
  match reopened.
- **3rd place match** (optional, single elimination and single-elimination playoffs): the two beaten
  semi-finalists play for 3rd, so the standings have a clear 3rd and 4th instead of two shared 3rds.
  It is shown under the final, in the final's column, and is as long as the semi-finals unless its
  own length is set there. With no map pool of its own it plays the semi-finals' pool. Choose it on
  the hosting window, the Format panel or the start dialog - or switch it on or off while the event
  runs: from the Bracket tab (above the bracket, or above the playoffs) or the Playoffs panel on the
  Admin tab. That works after the playoffs are locked and even after the semi-finals are played
  (their losers are brought back for it); it only stops being switchable once it has started
  itself. A final won before it is played crowns the champion, but the tournament finishes when
  the 3rd place match does. A two-stage event's Standings tab shows the playoff placings above the
  Swiss table. Not offered for double elimination (the losers bracket decides 3rd there), with
  divisions, or with fewer than four players.
- **Per-match best-of**: an organizer can retune one specific match from its Details popup, as long as it has not started. This is the escape hatch for a single series on the day; the per-round control below is still the bulk tool.
- Best-of per round: set presets at creation, or turn on **per-round Bo** to give every winners/losers/grand-final round its own best-of. Per-round Bo is editable on the Bracket tab both before generation (on the preview) and after (on the live bracket, affecting only rounds whose matches haven't started). The format summary collapses equal consecutive rounds, e.g. "WB R1-2 Bo3 - WB R3 Bo5 - LB R1-2 Bo1 - GF Bo5".
- First-round byes are not drawn. A seed with a bye appears directly in its round-2 match, which keeps large brackets compact. The losers bracket hides the phantom matches that byes would create, matching exactly what the engine generates.
- Optional max teams/entrants cap and optional minimum-teams target.

### Identity and access (FAF login)
- FAF OAuth login (OpenID Connect via Ory Hydra). It stays dormant until the three `FAF_*` environment variables are set; without them the site runs the legacy name-only flow unchanged, so any build is safe to deploy at any time.
- With FAF login on, actions are gated by FAF identity: players carry their FAF account, captains act by their FAF identity (no per-captain links), and the player's rating is pulled from FAF automatically at signup (see Ratings).
- Hosting approval: when FAF login is on, creating a tournament requires per-account approval by a site admin (Requests tab) or a directorship. When it is off, anyone can create, as before.

### Ratings
- A tournament's rating type (global, 1v1, 2v2, 3v3, 4v4, ranked-change, or none) is set at creation.
- For a rated tournament with FAF login on, the player's rating is fetched from FAF automatically at signup - the player never types it. An optional rating date pulls each player's rating as of that date rather than "now"; the date is editable on the Admin tab and shown to players.
- Only an unrated tournament (`none`) asks players to enter a rating manually. This applies to normal signups and to late signups via the late-signup link.

### Teams and seeding
- Places are **first come, first served**: a team claims its slot when it *fills up*, not when it was created and not by rating. Rating only decides seeding. Beyond the cap, teams queue on a waiting list in the order they completed. The Teams tab and the actual start use one shared rule, so the list can never show something different from what starting does.
- **Checking in never changes the queue.** A waiting team can check in and keeps its place; checking in is a confirmation that you are there, not a way to jump ahead. Check-in is applied only when the tournament is launched: if a check-in deadline was set, teams that never checked in drop out at that point and the queue closes up behind them, so waiting teams take the freed slots in signup order. If that would leave fewer than two teams the requirement is ignored, so a mis-set deadline cannot wipe out a tournament.
- An organizer can **swap a waiting team in** for one that is currently entering. The two exchange places and everyone else keeps theirs; swapping them back undoes it. It records an override rather than rewriting creation times, so history stays honest.
- **Premade teams** and **captain draft** are the two team modes. "Premade teams" uses a create-team / request-to-join / invite system: players sign up solo, then either create a team (becoming captain) or join one. Captains (and organizers) can invite pool players directly, and teamless players can request to join a team; the captain approves or declines. Only full teams enter the bracket; incomplete teams become reserves.
- A captain can **hand the captaincy to another member** of their team, and organizers can set it for any team, so a team never has to disband just to change who leads it. It is a real transfer, not a label: invites, approvals, map and faction vetoes, score reporting and the captains chat room all read `team.captainId`, so they follow immediately. Once the bracket has started only an organizer can change it.
- Captain draft with pick order (bottom-to-top every round, or snake) and a live pick-order display.
- **How captains are chosen** is an option on the Teams tab: either the organizer marks them by hand (the default), or the organizer sets a number and the highest-rated N players become captains automatically. The number is editable right up until the draft starts, and the automatic list is worked out at that moment, so late signups, withdrawals and rating corrections are all reflected. Players still awaiting approval in request-mode signups are never picked. A live preview shows exactly who would be captain. A captain can undo their own most recent pick until the next captain picks; the organizer can undo the last pick at any time.
- Solo brackets: every signup is an entrant.
- Seeding by rating or random, with a manual seed override before the bracket starts (reorder, nudge, randomize, reset to rating, or **order by invite** - the order the invites went out, with anyone never invited keeping their order after them). The override works on every bracket type, Swiss included, and on a solo field it sits on the **Players tab** as well as the Admin tab. It is open between locking the entrants and starting. On a Swiss a seed only sets the round-1 draw and the last standings tiebreak, and the panel says so. During team formation, the Teams tab lists teams by combined rating and shows each team's projected seed (its rank by rating) until real seeds are locked.
- **Divisions (King / Prince ...)**: a single or double elimination team event can be split into 2-4 divisions, each with its own bracket on its own tab, its own champion and its own placings. The default names are King, Prince, Duke and Baron; rename them on the hosting window or the Format panel. The tournament's champion (and its Hall of Fame win) is the top division's, and the tournament finishes when every division has its champion.
  - With **premade teams or a solo field**, the teams are split by combined rating when signups close - evenly, or "the N best in King" with two divisions - and can be moved between divisions until the start.
  - With a **captain draft**, the divisions are drafted one after the other. The King captains draft first and everyone they pick plays in the King bracket; the players nobody picked are then drafted into the Prince bracket by its own captains, and so on down. How each later division's captains are chosen is set on the Teams tab before the draft: the N highest rated of the players left (that draft then starts by itself the moment the one above ends), or by hand at that point (the draft waits for the organizer). The organizer can undo back across the boundary into the division above.
  - Seeds are unique across the field until the start, then run from 1 in each division. Round lengths are set once, for the biggest division; a smaller one plays them counted back from the final (its final is the final's length, its semi-finals the semi-finals'), and takes its map pools the same way.
  - Not available together with an early stop at a survivor count.
- Free agents (players not yet on a team) get their own prominent panel with a card per player, sortable by rating, name or newest, showing the pool's average rating and invite/assign actions.
- Withdrawing or removing a player detaches them cleanly from any team (captain reassigns to the next member; emptied teams are removed during signup), so teams never keep a "ghost" slot.

### Team rename
- Organizers and site admins can rename any team, any time, as often as needed.
- In a team game (more than one player per team), a captain gets a single one-time rename of their own team. Solo tournaments have no captain rename. Duplicate names are rejected.

### Maps, pools, and vetoes
- A per-tournament map database with preview images, descriptions, and publish/hide. On the Maps tab, pools are listed first, then an "All maps" grid. A map card shows "Played in [rounds]" only for direct round assignments, and "In pool: [name]" for pool membership.
- **Structured spawn info.** Each map optionally carries spawns for team 1 and team 2, closed spawns, closed spawn mexes (all picked as 1-16 toggles) and a map size. These render as labelled lines above the free-text description everywhere the map appears. A field left empty is omitted entirely rather than printed as "none", so unused options add no clutter. Anything the fields don't cover (reclaim, author, notes) still goes in the description.
- Pools can be **published on a schedule**: set a UTC date and time and the pool reveals itself, publishing every map inside it. As with tournament scheduled publishing there is no background timer - the sweep runs whenever the tournament is read. Publishing or hiding a pool by hand clears any pending schedule.
- Named map pools, each with its own best-of and its own ban/pick order. The edit-pool dialog shows a live map count and the number of ban/pick steps required. A pool's sequence length is tied to its size so that exactly one map is left as the decider, which means one order cannot serve pools of different sizes even at the same best-of.
- Publishing a pool also publishes every hidden map inside it (a published pool is shown to players, so its maps must be visible too).
- Pools can be assigned to whole rounds or to specific matches, including before the bracket is generated. The projected round count mirrors the real selection rule - only **full** teams enter, capped at max teams - so half-built teams and overflow signups never invent a round that cannot exist. A round with no pool assigned falls back to the first pool and is labelled "(default)"; deleting a pool clears its assignments and now names the affected rounds in the log. Reassigning a pool re-initialises the veto on affected ready matches, so a fixed pool takes effect immediately.
- Banning and picking take **two clicks**: the first arms a map and turns it into "Confirm ban?" / "Confirm pick?", the second commits. Clicking another map moves the arming, and Escape or a click elsewhere clears it. Inline rather than a dialog, since a popup on every step of a long sequence would be worse than the misclick it prevents. Faction bans and picks work the same way, with the prompt above the chips reading "Click Aeon again to confirm". A pending confirmation survives the background refresh rather than being silently cancelled by it.
- Whether it is a **BAN or a PICK** is shown as a colour-coded badge (red for ban, green for pick) with a matching bar down the side of the header and a "your turn" line, rather than one lowercase word in a sentence.
- Optional per-match veto engine: the two sides (Team A acts first) alternate bans and picks per the pool's order. A veto runs only when the assigned pool's best-of matches the match's best-of and both teams are known. A/B sides are decided per match by the team's **combined rating** - the same number the Teams tab shows - via random / lower-rated-is-A / lower-rated-is-B / manual. When there is nothing to compare (unrated tournament, or an exact tie) it falls back to seed order, and that fallback respects the chosen mode rather than always giving the first step to the better seed. "All upfront" completes the whole ban/pick before game 1; "continuous" reveals steps as games are played. Vetoes can be enabled or disabled mid-bracket.
- A veto is closed automatically when its match gets a result. A match settled mid-veto (a forfeit, or an organizer correction) leaves a veto that can never be acted on again, so it is marked **CLOSED** and moved out of the in-progress list rather than sitting there forever. Undoing the result reopens it.
- Every veto shows a numbered **ban / pick order** log - which team banned or picked which map, in the order it happened, ending with the decider. It is shown both while the veto is running and after it completes.
- Maps are referenced by id everywhere and resolved to names at display time, so renaming a map updates it everywhere and deleting one cascades cleanly.
- **Secret maps.** A map can be marked secret: it stays in the pool and can be banned or picked, but players see it as **"Hidden Map N"** with a blank tile until it is going to be played - picked for a game, left as the decider, pinned to a round, or in a result. From then on it is named everywhere. This is separate from publish/hide (a hidden map is not shown at all; a secret one is shown without its identity). The name, picture, description and spec are withheld **by the server**, so they never reach the browser. Revealing a secret map when it is *banned* is an option on the veto settings, off by default. Casters see it as players do; organizers see the real name with a badge saying which Hidden Map number players know it by. Secrecy is kept when maps are imported into another tournament.

### Running a tournament
- Running scores (e.g. 1-0 in a Bo3) display live. Everything upcoming lives on the Matches tab; the overview's old "up next" queue was removed as a duplicate of it.
- Captains report their own matches; the organizer can correct results.
- Replay IDs appear as soon as the games they belong to are confirmed, not only once the series ends, so casters can pull a replay while a Bo3 is still being played. Streamer mode still hides them until the result is revealed.
- Replay IDs are FAF replay numbers: the field accepts digits only, and pasting a URL or a messy list keeps just the numbers. In the bracket each one links to `replay.faforever.com` while still displaying only the number.
- Organizer score reporting supports an explicit winner and replay IDs together: you can record a match as, say, 1-1 with one team marked the winner (green) and keep the replay IDs - useful when a series was tied and decided by a forfeit. A pure forfeit (no games played) marks the losing side "FF" and awards the win; either way the correct team advances and the match is tagged FORFEIT.
- A personal **Show players** toggle swaps team names for that team's players everywhere they appear: the bracket, the Matches tab, the Vetoes tab (including the ban/pick log and A/B legend) and the match-details popup. Labels stay on one line and truncate with an ellipsis, with the full team name on hover. Labels stay on one line and truncate with an ellipsis, and the score is never pushed out of view.
- Clicking a team anywhere in the bracket opens a popup listing its members, ratings, captain, seed, and combined rating.
- Player editing at any time.
- **Replacing a player** keeps their slot - team, seed and every result so far - and puts someone else in it: either someone from the standby list, or **anyone on FAF, looked up by FAF name or FAF id**. An outside replacement is verified against FAF, checked against the ban list, refused if they already hold a slot, and taken from the standby list instead of duplicated if they are on it. Their rating comes from the tournament's board; a hand-typed one is accepted only when FAF has none. A team's own name ("Blue Squad") is kept when its captain is replaced; only a name derived from the captain follows. Both names go in the log.
- Standings tab: placements for elimination formats, W/L/game-diff for Swiss, points leaderboard for FFA.

### Matches tab
- Matches you are in are tinted in every section, not only grouped under "My matches", and the details popup lists the series' replay IDs.
- A flat, observer-friendly list of every match: **My matches** (if you are in one), Ongoing & upcoming, Not yet decided, and Concluded. Columns are round, both teams, status, and result.
- Status follows the pipeline: Waiting -> Picks & bans -> Ready/Live -> Concluded.
- Clicking a match opens details: both rosters with ratings and captain, the score, the winner, and the full ban/pick history, plus a match-chat link.
- Score reporting is offered here on exactly the same terms as on the bracket, so a captain who may submit there may submit here.
- Fully streamer-mode aware: results are masked, teams fed by an unrevealed match stay hidden, and each row (and the popup) has a Reveal/Hide button.
- This is an alternative view. It replaces nothing - the bracket, Vetoes tab and chat are unchanged.

### Statistics
- The numbers separate **individual signups** from **players in teams** (they differ whenever people sign up solo and never find a team), and count **series** separately from **games**. Average rating is shown alongside the signup count rather than as its own statistic.
- When a tournament finishes, a public **Stats** tab appears: entrants/players, teams, matches played, games played, different maps played, vetoes completed, forfeits, average rating, team ratings, highest-rated player, most-played maps, and the longest series.
- Games played counts only games that were actually played: a walkover forfeit (no games) contributes nothing, while a series that was played and then forfeited still counts its real games.
- Map *ban* statistics remain on the organiser-only panel in the Vetoes tab; the public page shows maps played, which is already visible from the bracket.

### Parent / child tournaments (qualification)
- A tournament can draw its field from one or more **qualifiers**. On the parent's Admin tab, add a qualifier and a rule: *top N advance* (any format) or *N+ points advance* (Swiss / FFA).
- When a qualifier finishes, the entrants who meet the rule are **invited automatically** - they are not signed up. Accepting is up to them, and the invite appears in the parent's Invited list tagged with the qualifier it came from. Manual invites and normal signups are unaffected.
- For a team tournament the **team** qualifies and every member is invited; for a solo bracket the player is invited. An entrant with no linked FAF account cannot be invited automatically and is listed so the organizer can chase them.
- Rankings come from the finished tournament: final placement for elimination brackets (ordered by how late a team was knocked out), Swiss standings, or the FFA leaderboard.
- Both sides show it: a qualifier displays "the top N here will be invited to X", and the parent lists where its field comes from and who has qualified.
- Seeding in the parent is by rating as usual, with the normal manual seed override. A link can also reserve a **seed block**: set "seed from" to 13 and the arrivals take seeds 13 and down in the order they qualified, with everyone else shuffling up. This is how LotS puts its four qualifiers at 13-16 without the organizer dragging them there by hand.
- **Ending a qualifier early**: a running tournament can be stopped where it stands from the Admin tab ("End here and lock standings"). No champion is recorded - nobody won it - and the locked standings are what any parent draws from. This is how a qualifier that exists to decide the top 4 stops once the top 4 is decided, instead of playing out a final nobody needs. Survivors outrank everyone who was knocked out, winners-bracket survivors first, so "top 4" from a stopped double elimination means the two who have not lost, then the two on one loss. It is reversible, with a warning if invites have already gone out.
- **Declaring it up front, and stopping automatically**: set a survivor count on the Format panel and the tournament ends *by itself* the moment that many are left. More importantly it is **announced from the moment the bracket is generated** - a banner on the bracket and a cell in Game Setup say "Ends when 4 are left, all 4 qualify, and the remaining matches are not played", with a live countdown of how many eliminations are still to come. Without that the bracket lies: it draws a grand final nobody is ever going to play and gives no hint of it. Once it stops, the matches that were never played are greyed out and read **Not played** rather than Ready. Single or double elimination only, and the count is validated against the field when the bracket starts.
- **Settable at any point, including mid-event.** The Format panel is locked once the bracket starts, but the survivor count is not part of the format - it changes nothing structural, it only declares when to stop. So it also lives in the **End early** panel on the Admin tab, where it can be set, changed or cleared while the tournament is running, and players are told in the tournament chat when it changes. If the number you set is already satisfied, the site says it would end the tournament straight away and asks you to confirm rather than doing it silently. If two results land close enough together to take the count one past the target, the site says so rather than quietly pretending it hit the number.
- The link is stored only on the parent, so the two sides can never disagree. Removing a link keeps invites already sent. Self-links and circular links are rejected.

### Checking your rating before you sign up
- The rating is pulled from FAF automatically, so a player has no way to see their own number or
  know whether it clears the range. **Check my rating for this tournament** sits beside the Sign up
  button and answers exactly that: it fetches the rating using *this* tournament's board and as-of
  date, then says whether they qualify, with the number and the requirement side by side so they
  can see how far off they are.
- **It is purely a check.** It creates no entrant, writes nothing, and signs nobody up. The button
  says so, and the suite asserts it - a check that quietly signed you up would be a trap.
- It reports the same verdict the signup gate would reach, from the same helper, so the two can
  never disagree. Bans, invite exemptions and the rating cap are all reflected.
- It also appears where signups are not yet open and where the tournament is invite-only: those are
  exactly the moments someone is deciding whether it is worth waiting for or asking for an invite.
- The **Rating requirements** box on the Overview carries a "Don't know your rating? Click here"
  link that switches to the Players tab and highlights the check. Both are hidden when the
  tournament does not use FAF ratings, or when the viewer is not logged in.
- Lightly rate-limited per account, because the button is one click from the FAF API.

### Player-chosen opponents
- Optional per tournament. Instead of the bracket pairing round one, the **top half of the seeds each choose who they play**, in seed order. LotS has always done this by DM to the tournament director; this is the same thing on the site.
- Whoever is on the clock sees a clear call to action on the Bracket tab and in the header alert, exactly like a veto turn. Everyone else can watch the pairings fill in. An organizer can pick on anyone's behalf, and can undo the last pick while the phase is still open.
- **"It is your pick" goes to the player on the clock and nobody else.** It used to be decided on every team the viewer is allowed to act for, which for an organizer or site admin is all of them - so they were told it was their pick whenever anyone was picking. Organizers now see who it is waiting on, with the "pick on behalf of" buttons.
- An optional **time limit per pick** stops one absent player stalling the event. When a clock runs out the site uses the matchup the standard bracket would have given them, so failing to pick lands you exactly where you would have been anyway rather than punishing you. There is no background timer: lapsed clocks are applied the next time anyone loads the page.
- It needs a **full bracket** (4, 8, 16, 32...). With any other field size the bracket has byes, and a bye is a free win nobody chose and nobody can pick, so there is no honest way to say whose opponent it is. Starting is refused with that explanation; if it happens mid-event on a playoff bracket the bracket is seeded normally and the reason is posted to the chat rather than stalling the tournament.
- On a two-stage tournament the pick phase runs on the **playoff bracket**, opening automatically when the Swiss stage ends. On a Swiss with no second stage it does nothing - Swiss round 1 is drawn or arranged by hand instead - and the setting says so on its label.
- **Who picks on a playoff bracket** is a choice: the **top half of the playoff seeds** (seeds 1-4 of
  8 pick from 5-8, the original rule), or **only the unbeaten** - the players who came through the
  Swiss without a loss, the 3-0s of a 3/3 stage. The unbeaten may pick anyone else who qualified.
  Everyone left over is then **drawn against each other at random, on different records where
  possible** (3-1 against 3-2), with as many such pairs as the leftovers allow - measured, the draw
  never pairs two 3-1s when a 3-1 v 3-2 split exists, and each possible draw comes up equally often.
  Each picker keeps their seed's usual slot, so the two 3-0s are on opposite sides and can only meet
  in the final; the drawn matches fill the other slots, best seed first. The draw is seeded like the
  Swiss draw: unpredictable beforehand, reproducible afterwards. If nobody went through unbeaten there
  is nothing to pick and every matchup is drawn. Both options need a playoff of 4, 8, 16 or 32.
- A third option, **only the unbeaten pick, and only from the lowest record that went through** - the
  3-0s choose among the 3-2s. Nobody else picks: everyone left is **paired by seed**, the best
  remaining seed against the lowest (with 3-0s taking two 3-2s that is seed 3 against the last 3-2,
  and 4 against 5 - where the standard bracket puts them anyway). Seeds follow the standings, then
  the sum of the scores of the opponents each player beat; choosing this option sets that tiebreak.
  A lapsed clock gives the standard matchup (1 v 8), which is a 3-2.
- **It stays open while the Swiss is played.** The Format panel locks when the stage starts, so the
  **Playoffs** panel on the Admin tab takes over: who picks (nobody, the top half, or the unbeaten)
  and the clock can be changed right up to the end of the Swiss.
- **And it can be undone after the Swiss is over.** Once the playoffs exist - a pick phase, or the
  bracket - an organizer can **undo the last pick** even after it built the bracket (the last pick is
  the one that builds it instantly, and the likeliest mis-click), or **redo the playoffs**: a fresh
  pick phase and a fresh draw, with a different setting if wanted. Both are on the Bracket tab above
  the playoffs and on the Admin tab, and both stay possible until the first playoff match starts - a
  result, a score, a pending report, or a single map or faction ban. A playoff round lengthened on
  the day keeps its length through a redo.

### Format presets
- A preset is a named bundle of settings that fills the create form in one click. It configures features; it never adds any.
- **Invitational**: 16 invited players, Swiss where three wins qualify and three losses eliminate, every match Bo1, then the eight who came through play a single-elimination playoff bracket (Bo3 to a Bo5 final).
- **Legend of the Stars (LotS)**: the same, plus Bo3 for any match that would qualify a player or knock them out, and opponent picking on the playoff bracket (the top half of the playoff seeds by default, or only the 3-0s with the rest drawn).
- Both are restricted to **global tournament directors and site admins**, and both force the tournament to the Official category. The restriction is enforced server-side when the tournament is created, not by hiding an option in a dropdown - posting the preset id directly gets a 403. Everyone can see the presets exist and what they are, so a community organizer understands why they cannot pick one.
- The preset id is stored on the tournament and its name is shown in the format line, so what a tournament claims to be is verifiable afterwards. Everything it filled in stays editable: a preset is a starting point, not a lock.

### Tournament series
- A **series** groups editions of a recurring event (e.g. a monthly cup) purely for browsing. Editions are completely independent: no qualification, no fixed cadence, no shared state.
- Anyone with tournament-hosting permission can create a series. Renaming or deleting one is limited to its creator, anyone who organizes a tournament in that series, directors, and site admins.
- A series can be chosen when creating a tournament (an optional field on the host form), or set and changed later from the Admin tab. Copying an existing tournament to make the next edition inherits its series. Livestream links are **not** copied, since they name that edition's streamers and co-casters.
- A series description supports the same formatting as other rich-text fields (headings, bold, lists, links) and is rendered on the series page. The series index shows a plain-text, two-line summary so a long description cannot swamp the list.
- Each series has a **name colour** from a fixed palette (amber, blue, green, red, purple, plain). A colour is picked automatically from the name so a list of series is not a wall of identical headings, and the owner can change it with a live preview. The colour is used on the series page, the index, and the "part of the X series" block on a tournament.
- A series can be tagged **Official** or **Community**, shown as the same green/blue badge tournaments use, with an "Official only" filter on the index.
- The index splits series into **Running now** (any edition still open or being played) and dormant ones, with dormant sorted by their most recent tournament, newest first - so inactive series sink to the bottom.
- `/series` lists every series with its edition count; `/series/<id>` shows that series' editions newest first, with each edition's format, date, status and winner, plus a "series winners" tally.
- A tournament that belongs to a series shows a "Part of the X series" block near the bottom of its overview, linking to the series page.
- Deleting a series never deletes tournaments - they simply stop being grouped.

### Status pill
- `status` is `signup` from the moment a tournament is created, **including while it waits for a scheduled opening time**, so the pill claimed "Signups open" when the server would in fact refuse a signup. It now shows a distinct, quiet **"Signups not open yet"** state (with the opening time on hover) until that moment passes.
- **Anything drawing the pill must use `statusPillLabel(t)` / `statusPillClass(t)`, never `statusLabel(status)` alone.** There are three sites - the home list, the tournament header and the series page - and the series one was missed on the first pass because it built `class="pill <status>"` and its label by hand. It also means abandoned editions there now read ABANDONED instead of their raw status. A pill needs `status`, `abandoned` and `signupOpensAt`, so any endpoint feeding one has to include `signupOpensAt` (the series editions list didn't).

### Draft visibility, and how it differs from rights
- A tournament that isn't published is hidden from **every listing**, though its page stays reachable by direct link (that's the share-link flow). So a **global tournament director had all the rights on an official event** - `isOrganizer()` has always returned true for a director on an official tournament - **but no way to find one that was still a draft**, and had to be added as an organizer just to get a link. The rights were never the problem; discovery was.
- **Visibility is deliberately wider than rights.** A director sees **every** draft on the site, community ones included, so they can keep an eye on what is being prepared. On a community draft they get a plain viewer's page: `viewer.organizer` is 0, there is no Admin tab, no Log, no `tlog`, no invites, no chat mutes, no `/secrets`, and every mutation is refused with "Organizer rights required". Look, don't touch.
- Two helpers keep that line sharp, and both take a context resolved once per request by `draftViewerCtx(req)` (these run inside filters over every tournament in the database, and `currentSession()` re-parses cookies):
  - **`ctxCanManage(t, ctx)`** - organizer RIGHTS. Mirrors `isOrganizer(t, req)` exactly, including "a director counts on official tournaments only". Keep the two in step if either changes.
  - **`canSeeDraft(t, ctx)`** - draft VISIBILITY: `ctxCanManage` OR "is a director", any category. `listVisible(t, ctx)` wraps it for listings.
- Listings covered: `GET /api/tournaments`, the series index (its edition count and "latest" were published-only for everyone) and the series detail, which previously let a director see every draft but had no notion that some were read-only. **Add any new listing to these helpers.**
- `GET /api/my_tournaments` deliberately does **not** widen: it is the "tournaments you organize" source list behind map/pool import and the qualifier picker, so it tracks rights, not visibility. A director does not see community tournaments there.
- Both listings ship a **`canManage`** flag, and a draft the viewer cannot manage is badged **"draft · view only"** with an explanation on hover. Without it a director opening someone else's community draft would just find the Admin tab missing and assume the site was broken.

### Bans: three scopes, one gate
Removing someone from a tournament was a revolving door - they just signed up again. There are now three ban scopes, sharing one record shape (`{name, reason, expires, at, by}`) and one enforcement path:

| Scope | Stored on | Set by | Applies to |
|---|---|---|---|
| **Global** | `db.tourneyBans` | site admins, tournament directors | every **official** tournament (community ones unaffected) |
| **Series** | `series.bans` | whoever can manage that series | every tournament carrying that `seriesId`, including future editions |
| **Tournament** | `t.bans` | that tournament's organizers | that one tournament |

- **`findEntryBan(t, fafId)` is the only thing that decides**, and every way into a tournament asks it: self-signup, the late-signup link, invite acceptance, an organizer adding by FAF name, and an organizer inviting. It checks widest scope first so the message names the broadest reason they are out. **Add any new entry path here, never re-derive it.**
- This closed a real hole: **`org_add_player` checked no ban at all**, so an organizer could add a globally-banned account straight into an official tournament - past a ban only a site admin or director can lift. Verified against the previous build, where that add returned `{ok:true}`.
- **Nobody can override a ban from an entry path.** An organizer who tries is told which scope caught it and where to lift it; a banned player gets a plain-English reason, an expiry if there is one, and who to contact. The tournament page also tells a banned viewer *before* they press anything (`viewer`-scoped `myBan` on the tournament GET).
- **An expired ban stops applying but is never deleted**, so the record of who banned whom and why survives. Panels keep the row, greyed and marked `expired`, and the header counts active versus expired separately.
- **Who set a ban is now shown** in all three panels. It was already stored on global bans and simply never displayed.
- The Players tab has a **Ban** action that bans and, where removal is still allowed, removes in one step - that is what an organizer means by "kick". The **ban is written first on purpose**: if the removal then fails they are banned but still listed, which is visible and fixable, whereas the other order could leave them removed and free to walk back in. Once the bracket is running it only blocks re-entry and says so.
- Only accounts with a FAF id can be banned, so a manually-added player (no `fafId`) shows no Ban button - there is nothing stable to ban.
- One client component, `banPanel()`, renders all three; the console, the tournament Admin tab and the series page differ only in wording and in where the two actions post.

### Map access is narrower than organizer rights
- A global tournament director has organizer rights on every official tournament - but they also
  **compete** in them, and seeing an unpublished map pool before it goes public is a real
  competitive advantage nobody agreed to hand them by making them a director.
- So map prep (hidden maps, unpublished pools) is gated on its own rule, not on organizer rights:

  | Who | Sees prep | Can edit maps |
  |---|---|---|
  | A named organizer of *that* tournament | yes | yes |
  | Someone holding the organizer share-link | yes | yes |
  | Caster | yes | no - the role has zero organizer powers |
  | Site admin | yes - a broken pool has to be diagnosable | yes |
  | Global tournament director (not an organizer there) | **no** | **no** |

- A director who is *also* added as an organizer of a specific tournament gets full map access
  there, as normal. Every other director power is untouched: they still organize official
  tournaments, see drafts, run the console, manage bans and the director roster.
- The **copy-maps** path is closed too. Copying reads the source tournament's pool, so it follows
  the same rule - otherwise a director could copy an official pool into their own tournament and
  read it there. The import picker only offers tournaments you may actually copy from, and the
  map counts of the others are not sent at all.
- Published maps and pools stay public to everyone, and maps already in a live veto keep their
  names, exactly as before. Nothing here changes what a normal player sees.

### Switching site-admin powers off
- Site admins compete too, and the same argument applies to them - except a site admin genuinely
  needs full access to diagnose and fix problems. So instead of restricting them, they get a
  switch: **ADMIN ON / ADMIN OFF** in the header, visible on every page.
- Switching off removes the powers **site-wide**, not for one tournament: no site-admin console,
  no admin rights on any tournament, and no map prep anywhere. It is the server that stops
  honouring them, not the page hiding buttons - a client-side flag would leave the data one
  devtools window away.
- The state lives on the account, so it survives reloads, restarts and other devices. It is
  reversible at any time by the admin themselves, and the toggle stays visible while the powers
  are off, so switching off is never a one-way door. Visiting the console while stood down
  explains the situation and offers the switch, rather than claiming you are not an admin.
- It changes **only** the site-admin role. A stood-down admin who is also a director keeps their
  director powers, and can still host. The master-password link does not undo a stand-down:
  picking the powers back up is a deliberate click, not a side effect of typing a password.
- Both switches are recorded in the audit log.
- It is **independent of "View as player"**, which remains a per-browser display toggle that hides
  organizer clutter and changes no permissions at all. The two can be used together.

### The tournament-director role, in full
A **global tournament director** is not a site admin. What the role grants:

- **Organizer rights on every official tournament** (`isOrganizer`), and hosting rights.
- **Sight of every draft on the site**, community ones included, but organizer rights only on the official ones - see Draft visibility above.
- On the site-admin console: **everything except Site Admins**. That means Requests (hosting, article editors, Challonge importers - approve, deny, revoke and grant on all three), Directors, Tournament bans, Logs, Archived and Articles. The site-admin list is the one genuine escalation left, since a site admin can do anything at all including removing directors, so it stays out - and the console's `data` payload for a director omits `siteAdmins` rather than merely hiding the tab.
- That payload is an **explicit allow-list**, not "the admin payload minus `siteAdmins`". An allow-list fails closed: a key added to the admin payload later is not silently handed to directors too.
- Because directors now own those queues, the **access-request alert** (the one that exists because three hosting requests once went unnoticed) reaches them as well, and they can dismiss it. Dismissals are per account, so silencing it for yourself does not silence it for a site admin.
- **The TD team manages its own roster.** A director can appoint and remove directors, so onboarding or removing a TD no longer waits on a site admin. Guards: the **last remaining director cannot be removed** (that would leave every official tournament without its global organizers), removing yourself warns that only a site admin can put you back, and **every grant and revoke is audited with the real account name**. That last part was previously wrong - both actions hardcoded the audit actor to the string "Site admin", so the log could not tell you who appointed whom. Harmless while only one role could do it; not harmless now.

### Chat
- Messages are grouped under a **day divider**, with the full date and time on hover. Timestamps follow the viewer's chosen time zone and time format like the rest of the site.
- A **Staff room** for organizers, casters and team captains, for official decisions without fifty players joining in. Access is enforced server-side, not just hidden: a non-captain gets 403 on both read and post. In a 1v1 event every entrant is their own captain, so it is only meaningfully narrower in team tournaments.
- **@everyone** pings every account that can open the room. Organizers only - anyone else's message is refused outright rather than quietly stripped. In the staff room it reaches captains, in a match room the two teams, so nobody is ever left a badge for a room they cannot open.
- **Replies**: any message can be quoted. The quote stores a snapshot of the parent's author and text, so it still reads correctly after the original is deleted or falls out of the retained history. Clicking a quote jumps to the original and flashes it.
- Per-tournament chat with a Global room and a room per match (created only once both teams are known). Match chats for finished matches collapse into a "Completed matches" group, minimised by default.
- `@name` mention autocomplete (Discord-style): type `@`, a filtered dropdown of players and team names appears, and the mention is highlighted in the message. A mentioned FAF player who is signed up gets a red badge on that room and on the CHAT tab until they read it.
- `!organizer` (or the ping button) flags a room for the organizers; `!roll` posts a 1-100 roll. A flagged room also raises a banner on the organizer's Overview, like a veto turn does.
- Before the bracket starts, the Chat tab carries a notice that organizers may not be around yet, with their Discord handles. It disappears once the tournament starts.
- Chats **lock two days after a tournament ends**: the history stays readable, but nobody can post into an old event to ping its organizers or players.
- A quiet unread marker appears wherever a chat is linked (the CHAT tab, match-chat links, and the room list) when there are messages you haven't seen. It is deliberately softer than the red @mention badge - a mention needs you personally, unread just means something was said.
- Being @mentioned also raises a banner on your Overview linking to the chat.
- Organizers are listed one per row with their Discord handle where they have set one.
- **Deleting a message** (organizers) leaves the rest of the room on screen - it used to empty the panel until the room was picked again - and every other open panel on that room drops the deleted message on its next poll: the room carries a revision that a deletion bumps, and a panel that sees it change loads the room again.
- Match chats are also linked from the Bracket and Vetoes tabs.
- **Pin a chat to the right.** Every chat panel carries a **"Pin this chat on the right"** button, and every non-completed room in the Chats list carries a 📌 next to it. Pinning docks that room to a rail down the right-hand side of the screen, so a match chat stays readable while the user works through the Bracket, Matches and Vetoes tabs. This is additive - every existing way of opening a chat still works exactly as before.
  - **One at a time.** Pinning a second chat replaces the first; no chat stack to manage.
  - **Closes itself when it should**, so a stale panel can never sit there: an ✕ in the rail header, when the match moves into "Completed matches", when the match disappears (bracket regenerated), when the viewer navigates to another tournament or off the tournament entirely, and when the server stops granting access to the room. Each of those says why in a toast rather than just vanishing.
  - **Completed chats are never pinnable.** No button in their panel, no 📌 in the list, and `pinChat` refuses the room even if something calls it directly - the rail would auto-close a second later anyway.
  - The rail survives what should not close it: tab switches, the 4-second tournament poll, and every full redraw. It lives outside `#app`, so a redraw cannot touch it.
  - The page is **padded out of the rail's way** rather than covered - an overlay would sit on top of match boxes and swallow clicks. On the bracket that just makes the (already horizontally scrollable) bracket narrower. Below 980px the rail becomes a bottom drawer instead.
  - The pin is remembered in `sessionStorage` per tournament, so a reload brings it back - unless the match finished meanwhile, in which case the stored pin is dropped rather than restored dead.
  - `⤢` in the rail header jumps to that room in the full Chat tab.

### Multi-day events
- An event can run on **several days that are not consecutive** - a Saturday and Sunday, or two whole weekends - without being advertised as one long block. Advertising a two-weekend cup as a nine-day span reads as "we play midweek too" and puts entrants off, which is the whole reason this exists.
- **`eventDate` is unchanged**: it stays the single start moment that every sort, countdown, "event starts in" chip and the check-in window use. The new `eventDays` is a sorted list of `YYYY-MM-DD` alongside it. One day, or none, behaves exactly as it always did, so nothing that reads `eventDate` needed touching.
- The **day picker** uses the multi-select everyone already knows: **click** selects just that day, **shift+click** takes the range from the last-clicked day, **ctrl/cmd+click** adds or removes one day while keeping the rest. It sits under the normal date field in both the create form and the Admin tab, and the two are bound together - typing a date selects that single day, and picking days writes the earliest one back as the start date.
- The server sorts, dedupes, drops anything that isn't a real date, caps the list at 31 days, and **forces the start date onto the earliest selected day** (keeping the time). A client can't leave the countdown pointing at a day the event doesn't run on.
- Displayed as a span rather than a list where it can be: "12-13 Sep 2026", "12-13 & 19-20 Sep 2026", "31 Dec 2026-1 Jan 2027". A chip on the home page shows the day count, the tournament header shows the span, and Game Setup gains a **Schedule** cell that says in words that there is no play on the days in between.

### Faction vetoes (1v1 only)
- An optional second veto that runs **per game of a series**, in parallel with the map veto and independently of it. Enabled on the Admin tab; only offered when `teamSize` is 1.
- The organizer sets two numbers globally: **bans each** (1 or 2) and **picks each** (up to 3). Each player bans factions - denying them to their opponent - then nominates factions in order of preference. Your faction is the highest preference your opponent did not ban.
- **Picks must exceed bans.** With four factions, N bans can eliminate at most N distinct picks, so pick N+1 always survives. The server rejects an invalid pair and the Admin tab only offers valid ones, which is what makes a result guaranteed.
- **Choices are secret, enforced server-side.** The tournament payload is filtered per viewer: a competitor sees only their own bans and picks, and everyone else - opponent, organizer, caster, site admin, spectator - sees only whether each side has finished. The raw record is never sent, so reading the network tab reveals nothing. The tournament log records that a choice was made, never which faction. Once both sides finish, the result is shown to everyone.
- Organizers deliberately **cannot** act on a player's behalf (unlike the map veto) - a proxy would defeat the secrecy. They can reset one side's choices after a misclick or a substitution.
- Shown on the Vetoes tab beside each game's map. With map vetoes off, the card lists the series' games as "1st map, 2nd map, ..." so the faction column still has a row. Changing the ban/pick counts mid-tournament clears in-flight choices, since half-finished work under the old numbers can't be reconciled; raising a round's Bo adds slots for the new games and keeps existing progress.
- **Being on the clock is announced, not left to be noticed.** Faction vetoes worked from day one but told nobody they were waiting, because every "it's your turn" surface on the site was written for the map veto only. All of them now cover both:
  - The **Vetoes tab is shown when faction vetoes are on**, whether or not map vetoes are. It used to require `T.veto.enabled` and a match with `m.veto`, so a 1v1 with faction vetoes on and map vetoes off rendered **no Vetoes tab at all** - the players had nowhere to go and nothing to click. (The tab's own body always handled the faction-only case; only its visibility test didn't.)
  - The **turn banner** at the top of every tab, which also stamps a ● on the browser tab title, now fires for a faction choice: "It's your turn to ban a faction vs Bravo", or "You still need to set your factions for 3 games vs Bravo".
  - The **Vetoes tab carries a red badge** with the number of games *you personally* still owe, map and faction together. This is separate from the "(n)" in the label, which counts everyone's outstanding map vetoes and is a workload number for organizers. The badge stays visible while the tab is open, unlike the unread badges: opening a chat reads it, opening the Vetoes tab does not do your veto.
  - The **cross-tournament bar** (`GET /api/my/pending`) lists faction choices, so a player sitting on another page or another tournament still sees "Set your factions for 3 games".
  - The **bracket match box** gets an amber "⚡ Your faction ban →" link with a count, and the **Matches tab** an amber "⚡ Faction veto" button on your row. Both open the veto popup, which now opens for a faction-only match (it used to bail out on `!m.veto`).
  - The Matches tab no longer reports a match as **Ready** while faction choices are outstanding; it says "Picks & bans", the same as a map veto in progress.
  - The panel itself now reads as a job rather than a status line: an amber **YOUR TURN** pill with the same pulsing dot the turn banner uses, and an imperative "Ban a faction" instead of "1st faction to ban (1/1)". Once you are finished it goes quiet and says "✓ You're done - waiting on your opponent".
  - Everything above is driven by one client helper, `myFactionTurn(m)`, and its server twin in `/api/my/pending`. Both key off `mine.done` plus `factionNextStep`, and both return nothing for a settled match or a non-competitor - so an organizer, caster or spectator is never nagged about a veto they cannot do.

### Ratings
- **Which rating counts, and as of when**, is stated where people actually look: as the first, bold line of the **Rating requirements** box in Game Setup, and as a bordered callout at the top of the signup panel. Both come from one helper (`ratingSourceHtml`) so they cannot drift apart. It used to be a grey sentence in the Game Setup headline and another buried below the Discord help text, and players missed both.
- **The counting rating is editable at any time** (`edit_info` takes `ratingType`), not only at creation. Changing it deliberately does **not** rewrite history: everyone already signed up keeps the rating they were admitted on, and new signups use the new board immediately. A **re-pull** button next to it (`repull_ratings`) refetches every signed-up player on the current board and date and re-applies the cap; anyone FAF can't answer for keeps the rating they have rather than being wiped to null.
- **Organizers can see a player's rating on every leaderboard** - Global, 1v1, 2v2, 3v3, 4v4 - from a Ratings button in the players tab. This is **information only**: the tournament's configured rating is the only number that decides entry, the cap and seeding, and the panel marks which board that was and says so.
  - Fetched at signup (in parallel, after every entry check, and wrapped so it can never delay or refuse a signup) and stored on the player as of the same cutoff date.
  - Served **only** by `GET /api/t/<id>/player_ratings`, which requires organizer rights. It is explicitly stripped from the tournament payload, so it never reaches a normal viewer and doesn't bloat the response by five boards per player. Players who signed up before this existed, and anyone wanting fresher numbers, are fetched on demand with the asking organizer's FAF token.

### FAF renames
- A player's display name used to be stamped on at signup and never looked at again, so anyone who renamed on FAF kept appearing under their old name - in the player list, the bracket, and the 1v1 team that was named after them. There is no rename webhook from FAF, so names now resync **opportunistically**: whenever that account opens a tournament they are in, and on the cross-tournament pending sweep, which already walks every tournament and so corrects all of them at once.
- A solo team named after the player follows the rename; a team the captain has **spent their one rename on** is left alone, because that name is theirs and not a mirror of the account. Chat history is deliberately not rewritten - each message records who said it at the time. The rename is written to the tournament log.
- Organizers can also **check for renames** on the Admin tab (Player names). The check is read-only: it lists everyone whose FAF name has changed since signup, with the entry that would move with them, and nothing is written until the organizer ticks who to update - sometimes the old name is the one to keep. A player FAF does not answer for is reported as unchecked, never as unchanged, and players added by hand are counted separately.

### Vetoes tab
- Opening a **map pool** shows exactly how its veto will run before it happens: the numbered ban/pick sequence, which side acts first and why, the decider, and whether the sequence completes upfront or step by step. Players no longer meet the sequence for the first time when it is their turn.
- A tournament played in parts gets a **sub-page per part**: the Swiss stage and its playoffs (or final), or each division's bracket. The playoffs page is the one that opens once it exists.
- Each page lists the vetoes that need action first, then the results, both **in playing order, newest on top**. A Swiss round never sorts above the playoffs that came after it, and a losers-bracket round sits between the winners rounds it is played alongside. The Matches tab and the Overview's recent results use the same order.
- A **Follow** box narrows the page to one team or player (in a team event, a player follows their team), or to your own matches. Someone playing starts on their own matches, everyone else on all of them; the choice is remembered per tournament in that browser. The sub-pages count what they hold for the current choice, and an empty page points to the one that has them.
- A veto's games are **one aligned table**: game, map (marked if it was the decider), then each side's faction under that team's name, so the rows line up however long a map's name is. The veto popup on the bracket is wide enough for it. On a phone the faction chips shrink to their letter and the ban/pick order puts the team above its map.
- On a **finished** tournament, a Veto statistics panel shows "most banned" and "most played" maps for the page's part of the tournament. It is visible only to organizers of that tournament, tournament directors (on official tournaments), and site admins.

### Predictions
- A **Predictions** tab lets anyone logged in with FAF predict who wins every match before the tournament starts. A win is a win; the score does not matter. Logged-out visitors can look but not predict.
- **When.** A stage opens as soon as its matches can be known: when the teams are locked (the bracket the start will make is projected from the seeding as it stands), or, with opponent picking, once the seeds have chosen their opening matches. It closes the moment its first match is played - a result, a live score or a submitted score - and taking that result back does not reopen it. The organizer can close a stage earlier, and reopen it as long as none of its matches has been played.
- **Every format.**
  - Single and double elimination, divisions included: the winner of every match, in a bracket that fills itself in as you pick, so a later match always shows the two teams your earlier picks put there. Changing an early pick drops the later picks it invalidates. Byes decide themselves.
  - Swiss: every team's final record (3-0, 3-1 ... 0-3), because the pairings after round one depend on results and cannot be predicted as matches. When the field splits evenly (16 at 3/3, say) the page shows how many teams each record will end up with.
  - A Swiss with playoffs or a final has a **second stage** for those matches, which opens only once the Swiss is complete and they exist.
  - FFA: the champion.
- **Private until closed.** Nobody's picks are sent to anyone, organizers included, until the stage closes; then everyone's can be viewed from the leaderboard.
- **Out of date predictions.** A prediction remembers the draw it was made for (the opening matches, or the Swiss field and format). If the organizer reseeds, moves a team between divisions or changes the format before the start, earlier predictions are flagged and have to be made again; one still out of date when the stage closes counts for nothing.
- **Scoring.** Right, wrong and still to play, per predictor. A pick is wrong as soon as it cannot come true (that team is already out), and a match left unpicked counts as wrong. A prediction is **perfect** when every stage was predicted and every pick came true; matches never played (an early finish) do not count. The organizer can put up a **prize for a perfect prediction**, shown at the top of the tab, and once the tournament is over the tab names everyone who earned it.
- The tab's badge and a line on the Overview remind a logged-in viewer whose prediction is missing, out of date or incomplete while a stage is open.
- Stored on the tournament (`predictions`, keyed by FAF id, and `predict` for the settings and locks) and never put in the tournament payload: the page gets a summary (what is open, how many have predicted, whether you have), and the tab reads `GET /api/t/<id>/predictions`.

### Hall of Fame
- Players only: a team's win counts for every player on it. With divisions, a tournament's win is the top division's.
- Ranked by championships, then tournaments entered. Search by name (any part of it) or exact FAF id, 100 players to a page. The search and page are kept in the address so a result can be linked, and the # column is always the place on the whole board.

### Keyboard shortcuts
- Single keys, no modifiers: **F** shows players instead of team names in the bracket, **S** toggles streamer mode, **V** toggles view-as-player (organizers only).
- All three are rebindable in Display settings: click the key, press the one you want, or clear it to switch that shortcut off. Two actions can't share a key - binding one takes it from the other.
- Shortcuts are ignored while you're typing in any field and while a dialog is open, and they only affect your own screen.

### Streamer mode and view-as-player (personal, per-browser toggles)
- A **caster** opening a tournament that is already under way gets streamer mode switched on automatically, so nobody has to remember before going live. It is a one-time default per tournament, not a forced state: switch it off and it stays off, because streamer mode is a single per-browser flag that re-applying would fight over. Casters keep the toggle and the shortcut key as normal.
- **Streamer mode** hides match results, scores, and who has advanced (a later slot shows "Winner of WB R1 M1" instead of the team), plus elimination styling and the standings table - for on-stream reveals. Each completed match has a "Reveal result" button to un-mask it one at a time; reveals persist across refreshes. Streamer mode only affects your own screen and never changes permissions.
- **View as player** (shown only to organizers/admins) hides the organizer and admin controls on your screen so you can browse a tournament as a regular participant. It is a display filter only and does not change your actual permissions.

### Drafts and scheduled publishing
- The home page lists **Ongoing** first, then **Upcoming / Open** sorted by whichever starts soonest (undated events last). **Completed** is collapsed by default, split into years automatically, and paged 50 at a time, so an archive of thousands stays usable.
- Unpublished tournaments are listed in a **My drafts** section at the top of the home page, visible only to their organizers and site admins.
- A draft can be published immediately or **scheduled**: enter a UTC date and time and it publishes itself. There is no background timer - the schedule is applied whenever tournaments are listed, which covers every way a tournament becomes visible. A pending schedule is shown on the draft banner and can be cancelled.

### Dates and time zones
- An optional **overall cash prize** (currency plus a number, USD/EUR/RUB) is stored separately from the free-text Rewards and shown as its own box at the top of them, so it reads at a glance and can be reused in listings. The amount accepts digits only. It also appears on every home-page listing, so a prize no longer has to be written into the tournament name.
- Description, Rewards, Sponsors and Lobby options accept **pasted screenshots and inserted images at creation time**, not only when editing later. There is no tournament to attach an image to until it exists, so images pasted on the host form are held in the browser and uploaded the moment the tournament is created.
- Event date, signup open/close and the **check-in deadline** are all set together on the Admin tab, in UTC. The Teams tab shows the deadline read-only to players.
- The **check-in deadline** can be set when creating a tournament as well as afterwards on the Admin tab.
- Optional event date and time (entered in UTC) per tournament, editable any time. When an event date is set, **check-in only opens on the day of the event** - trying earlier tells the player exactly when it opens rather than just failing. Organizers can always check a team in.
- Stored in UTC, displayed in each viewer's chosen time zone (remembered per browser). The Completed list is ordered most-recent-first.
- Display settings (the gear icon) also choose the **date format** (`7 Jul 2026`, `07/07/2026`, or `2026-07-07`) and the **time format** (24-hour or 12-hour). These are per browser. Note that the placeholder inside a native date-picker field follows the browser's own locale and cannot be overridden by the site.
- The overview's "latest update" news block is hidden once a tournament is finished.

### Importing from Challonge
- Import a completed Challonge tournament as a read-only archive via the Import button. Bracket topology, per-game series scores, and final placements are reconstructed.
- **Two-stage events** (group stage then playoff) are handled: only the final stage becomes the bracket, and each Challonge group is imported as its own standings table (W-L and game record). Previously the group matches were mixed into the bracket, producing a nonsense tree full of TBD matches.
- **Non-bracket formats** (free-for-all, round robin, swiss) import as a results table instead of being refused. The Bracket tab points at Standings for these.
- Challonge does not record team size, so an imported event is labelled "Imported from Challonge" with the original Challonge format, rather than guessing a format. Each participant becomes a one-slot team. (It used to hard-code 2, which mislabelled 1v1 events as 2v2.)
- A Challonge API v1 key is entered per import and never stored.

---

## Roles and access

Access is by FAF identity when FAF login is on. The roles:

- Adding someone by raw FAF id (directors, organizers, roles) resolves the id to their real FAF login, so lists show a name rather than "FAF 123456".
- **Site admin** - a FAF-linked identity with full control of the server, including deletion. Site admins are managed in the `/siteadmin` console (add/remove by FAF name or id, with a last-admin guard). The `ADMIN_PASSWORD` is not itself an admin login; it is used once to *link* the currently logged-in FAF account as a site admin (log in with FAF, then submit the password on `/siteadmin`). Because that link always re-adds, the password holder can never be locked out.
- **Tournament director** - has organizer rights on all official tournaments, plus a director console (bans, logs, archived tournaments, articles). Managed by site admins.
- **Organizer** - whoever creates a tournament, plus anyone an organizer adds. **Any organizer can add or remove any other organizer** in the Organizers panel (by FAF name or id), or leave the team themselves - it is trust-based. The one guard: an organizer cannot remove the *last* organizer and leave the event with nobody to run it; a site admin still can. Removals are written to the tournament log and the site audit log under the name of the organizer who did it.
- **There is no organizer link.** With FAF login on, organizers are recognised by their FAF account and only by that. The tournament's legacy admin token - which the old organizer link carried, and which the creator's browser is still handed at creation - grants nothing: no organizer rights, no map access, and no seat via `claim_organizer` (which now answers 410 and says to ask an organizer). That is also what makes a removal real. It used to keep working after the link left the UI, so an old link from Discord history made whoever opened it an organizer, and a removed organizer kept full power through it. With FAF login off the token is the only credential there is, so it still works there.
- **Editor** and **Importer** - request-or-grant roles. A user can request the role and a site admin approves in the Requests tab, or a site admin grants it directly. Importer allows using the Challonge importer; editor allows editing content as configured.
- **Captains** - with FAF login on, captains act by their FAF identity: they draft on their turn, invite/approve teammates, ban/pick in the veto, report their matches, and get one team rename in team games.
- **Bans** - site admins and directors can ban FAF accounts from participating.
- **Caster** - a FAF account granted read access to everything on one tournament: every chat room (and they may post in them), hidden maps and pools, and all vetoes. Zero organizer powers - no Admin tab, no Log, no mutations. Added and removed on the Admin tab by any of that tournament's organizers, by FAF name or id. Exposed to clients as `viewer.caster` on `GET /api/t/<id>`, granted with `add_caster` and revoked with `remove_caster`. This replaced the old `?streamer=<token>` share link, so access is bound to an account and a leaked URL grants nothing.
- **Everyone else** - the public view is read-only plus signup.

### API access for the desktop client
The FAF desktop client can't receive the site's httpOnly cookie, so requests may instead carry
`Authorization: Bearer <FAF access token>`. The token is validated against FAF itself, cached in
memory for 60 seconds per token, and turned into the same session object a cookie login produces -
so every permission check (site admin, director, organizer, captain) behaves identically and
nothing extra is written to `db.json`. The client sends a current token on every request, so the
rating lookups at signup and organizer add work as they do on the site.

The one limitation: a Bearer session exists only for the duration of a request, so the server
cannot act for that player while they are offline. Every current token use is inside a request
handler, so nothing is affected today; a future background job (e.g. a scheduled rating refresh)
would need its own solution.

---

## Architecture

Plain `http` server, no framework, JSON file storage. The code is split into small modules; there is still no build step and no runtime dependency.

### Bandwidth
The tournament page polls a full snapshot every 4 seconds, so three measures keep that cheap. All are transparent - no page looks or behaves differently:

- **gzip.** API responses over 1 KB and static JS/CSS are gzipped via Node's built-in `zlib` (no dependency). A 64-player bracket snapshot goes from ~24 KB to ~3.5 KB; the client bundle from ~550 KB to ~140 KB. Static files are compressed once and cached in memory, since the container re-clones on start and they cannot change while the process is alive.
- **ETag / 304.** Successful GETs carry an ETag hashed from the response body, so a poll that finds nothing changed (the common case) returns an empty 304. This needs `Cache-Control: private, no-cache` rather than `no-store`, which still forces revalidation on every use, so nothing stale is ever shown. The tag is computed from the response built for *that* viewer, so an organizer and a spectator can never share a cache entry.
- **Chat panels are independent instances.** `mountChat()` returns a self-contained panel with its own room, history, `since` cursor, reply state and poll timer, registered in `_chatInstances`. This used to be module-level state, so a second mount silently killed the first - fine when only one chat could be on screen, impossible once a chat can be pinned while another is open. Two consequences worth knowing: everything inside a panel is addressed by **class, not id** (two panels on screen would otherwise fight over the same nodes), and a panel whose host has left the DOM **reaps itself on its next tick**, which also fixed a long-standing leak where closing a chat popup with Escape or a backdrop click left its interval polling forever. `stopChatPoll()` still exists and still tears down every transient panel on redraw, but deliberately spares the pinned one.
- **Hidden tabs stand down.** The 4-second tournament poll and the chat poll skip while `document.hidden`, and fire immediately on `visibilitychange` so returning to the tab never shows a stale bracket. The 30-second alert poll deliberately keeps running in the background, so someone waiting on a veto turn still gets the banner.

```
server.js            HTTP layer: router, auth/OAuth, sessions, static + image serving,
                     storage (loadDB/saveDB with self-healing migrations), audit,
                     hosting approval, roles (site admins, directors, editors, importers, bans)
challonge.js         Challonge import
lib/util.js          leaf helpers (ids, names, dates, base64url, entity lookups, ...)
lib/bracket.js       pure bracket math (seeding, sizing, best-of validation, per-round Bo lists)
lib/match.js         match core + veto engine (create/route/evaluate/finalize with optional
                     forced winner, builders, pools, ban/pick sequence, A/B)
lib/swiss.js         Swiss standings/pairing/progression
lib/ffa.js           FFA groups/points/ranking/rounds
lib/teams.js         team formation (open create/join/invite, draft, divisions, seeding)
lib/predict.js       predictions: stages, the bracket as a graph, validation, locks, scoring
lib/maps.js          map lookups and the public (id-stripped) map view
public/index.html
public/app.js        client (loaded first; shared globals, helpers, streamer/player-view state)
public/app.home.js   client (home, tournament shell, overview, header toggles, poll loop)
public/app.entrants.js  client (players, teams/draft/open-team invites, start config)
public/app.bracket.js   client (bracket/rounds, per-round Bo, bye hiding, veto, veto stats, team popup)
public/app.results.js   client (report/forfeit, standings, chat, admin, routing)
public/app.predict.js   client (Predictions tab)
public/style.css
docker-compose.yml
```

The client is delivered as several ordinary (non-module) scripts loaded in order; together they run in one shared global scope, exactly as a single file would.

### Storage
A single JSON file at `DATA_DIR/db.json`, keyed by `tournaments`, `sessions` (FAF login), `oauthPending`, `auditLog` (capped at 5000), `hostRequests`, `hostAllowed`, `siteAdmins`, `directors`, `editorAllowed`/`editorRequests`, `importerAllowed`/`importerRequests`, `tourneyBans`, `profiles`, `articles`, and `series` (tournament series; each tournament may carry a `seriesId`). Per-user chat `@mention` pings are tracked per tournament. Map preview images are written as binary to `MAP_IMG_DIR` and served from `/map-images/<file>`; `db.json` stores only the filename.

**FAF tokens are encrypted at rest.** A logged-in session carries that player's FAF access and refresh tokens so the server can read their rating on their behalf. Those are live credentials, so they are stored as AES-256-GCM ciphertext (`session.faf.enc`) rather than plain text: a copy or backup of `db.json` exposes no usable token. The key is derived from `FAF_CLIENT_SECRET`, which is already required for OAuth and already lives only in the container environment, so there is nothing extra to configure. Sessions created before this change are re-wrapped automatically on first boot.

Consequence: **rotating the FAF client secret makes existing session tokens unreadable.** Nobody is logged out (identity is stored separately, in the clear) but rating lookups will ask affected users to log out and back in, which mints fresh tokens. Decryption failure is always handled this way rather than by throwing.

On load, `loadDB` runs small self-healing migrations: legacy "premade" tournaments are converted to the create/join/invite model, and teams with stale member ids (from an old withdrawal) are repaired. These only touch data during signup and never remove a team that has real players.

---

## Run it

Any Docker host:

```
docker compose up -d
```

Edit the repo URL in `docker-compose.yml` to point at your fork. The container clones the repo at start and runs `server.js` - no image build needed. It listens on port 8090. Data lives in the `faf_tourney_data` volume and survives restarts; deleting the volume deletes all tournaments.

### On FAF's cluster

FAF runs the site from the image in `Dockerfile` (deployment: `apps/faf-tournaments` in [FAForever/gitops-stack](https://github.com/FAForever/gitops-stack)).

- **Releasing is pushing to `main`.** The `Image` workflow checks the files parse, builds the image and publishes it to Docker Hub as `faforever/faf-tournaments:latest`. The cluster notices a new `latest` within a couple of minutes and swaps the container itself. No tag, no PR to FAF, no restart by hand.
- **Rolling back:** every image is also tagged with its commit (the first 12 characters of the hash). Point `latest` back at the previous one, or revert the commit on `main`.
- **Health:** `GET /healthz` answers `ok` while the process is up.
- **Shutdown:** the cluster stops the old container with `SIGTERM`; a save still waiting in its debounce is written first.
- Data is the same `db.json` plus image folders, on a persistent volume mounted at `/data`.

### Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 8090). |
| `DATA_DIR` | Where `db.json` is stored (default `./data`). |
| `ADMIN_PASSWORD` | Bootstrap for site admin: log in with FAF, then submit this password on `/siteadmin` to link your account as a site admin. Not set = the console can't be bootstrapped. |
| `FAF_CLIENT_ID` | FAF OAuth client id. |
| `FAF_CLIENT_SECRET` | FAF OAuth client secret (never in the repo). |
| `FAF_REDIRECT_URI` | Must exactly match what FAF registered, e.g. `https://your.host/auth/faf/callback`. |
| `MAP_IMG_DIR` | Optional. Where map images are written (default `DATA_DIR/map-images`). Set to relocate them to another drive. |
| `FAF_HYDRA_HOST` | Optional. FAF's login server (default `hydra.faforever.com`). `hydra.faforever.xyz` on FAF's test cluster. |
| `FAF_API_HOST` | Optional. FAF's API (default `api.faforever.com`). `api.faforever.xyz` on FAF's test cluster. |

FAF login is active only when all three `FAF_*` variables are set. Removing them reverts to the legacy name-only flow (a safe rollback). Set secrets in your compose/stack config, never in the repo.

`IMPORT_PASSWORD` is no longer used - importer access is now a role granted in the site-admin console. If it is still set in your environment it is simply ignored.

### First site admin
With FAF login on, do this once after deploy: log in with FAF, open `/siteadmin`, and submit `ADMIN_PASSWORD`. That links your FAF account as a site admin. From then on, manage admins, directors, and other roles from the console; the password is only ever needed to (re-)link an account.

---

## Updating

Overwrite the changed files on GitHub (the web UI upload works; the folder structure in an update zip matches the repo), then restart the container - it re-clones on start. On FAF's cluster the upload alone is enough: it goes live by itself (see *On FAF's cluster* above). Update zips may include files under `lib/`; make sure those land in the repo's `lib/` folder, not the root.

If updates do not appear after a restart: static files are served with no-cache headers, but a reverse proxy in front (e.g. Nginx Proxy Manager) may cache CSS/JS itself. Turn OFF any "Cache Assets" option on the proxy host, then hard-refresh once (Ctrl+Shift+R). Favicons cache aggressively - reopen the tab if the icon looks stale.

---

## Development

No dependencies are needed to run the app. For editing there are optional dev-only tools (`typescript`, `@types/node`) declared in `package.json`; they never run in production (the container only clones and runs `node server.js`).

- Syntax check every source file: `npm run check`
- Type-check (JSDoc + `// @ts-check`, no emit): `npm run typecheck`

Type-checking is opt-in per file via a top-of-file `// @ts-check` comment; `lib/util.js` and `lib/bracket.js` are checked today, the larger modules are not yet annotated. There is no compile step - `@ts-check` catches bugs in the editor and CI without changing what runs.
