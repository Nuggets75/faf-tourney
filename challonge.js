// Challonge v1 API importer — converts a completed Challonge tournament into
// our internal tournament object shape (read-only, for display in Completed).
'use strict';

const https = require('https');

// fetch a tournament from Challonge v1 API
function fetchTournament(id, apiKey) {
  return new Promise((resolve, reject) => {
    const path = '/v1/tournaments/' + encodeURIComponent(id) +
      '.json?include_participants=1&include_matches=1&api_key=' + encodeURIComponent(apiKey);
    const req = https.request({ hostname: 'api.challonge.com', path, method: 'GET', headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('Challonge rejected the API key (401). Check the key.'));
        if (res.statusCode === 404) return reject(new Error('Tournament not found (404). Check the ID/URL, and that it is public.'));
        if (res.statusCode === 406) return reject(new Error('Challonge returned 406. Try again.'));
        if (res.statusCode >= 400) return reject(new Error('Challonge error ' + res.statusCode));
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Challonge returned invalid JSON')); }
      });
    });
    req.on('error', e => reject(new Error('Could not reach Challonge: ' + e.message)));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Challonge request timed out')); });
    req.end();
  });
}

// strip HTML tags to plain text (the description is Discord-copied HTML)
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// tally a Challonge scores_csv ("1-0,1-0,0-0") into a series score for player1/player2
// returns [wins1, wins2]. Each comma group is a game; the side with the higher game score wins that game.
function seriesScore(csv) {
  let w1 = 0, w2 = 0;
  if (!csv) return [w1, w2];
  for (const game of String(csv).split(',')) {
    const parts = game.split('-');
    if (parts.length !== 2) continue;
    const a = parseInt(parts[0], 10), b = parseInt(parts[1], 10);
    if (!(a >= 0) || !(b >= 0)) continue;
    if (a > b) w1++;
    else if (b > a) w2++;
    // ties/padding (0-0) count for neither
  }
  return [w1, w2];
}

function uid(n) { return require('crypto').randomBytes(n || 4).toString('hex'); }

// Map Challonge -> our tournament object. Supports single & double elimination.
function convert(challongeRoot, opts) {
  opts = opts || {};
  const t = challongeRoot && challongeRoot.tournament;
  if (!t) throw new Error('Unexpected Challonge response (no tournament).');
  if (t.state !== 'complete' && !opts.allowIncomplete) {
    throw new Error('That Challonge tournament is not complete yet (state: ' + t.state + '). Only finished tournaments can be imported.');
  }

  const ctype = (t.tournament_type || '').toLowerCase();
  let bracketType;
  if (ctype.indexOf('double') >= 0) bracketType = 'double';
  else if (ctype.indexOf('single') >= 0) bracketType = 'single';
  else if (ctype.indexOf('round robin') >= 0) throw new Error('Round robin tournaments are not supported yet — only single and double elimination.');
  else if (ctype.indexOf('swiss') >= 0) throw new Error('Swiss tournaments are not supported yet — only single and double elimination.');
  else throw new Error('Unsupported Challonge bracket type: ' + t.tournament_type);

  const parts = (t.participants || []).map(p => p.participant || p);
  const rawMatches = (t.matches || []).map(m => m.match || m);
  if (!parts.length) throw new Error('That tournament has no participants.');
  if (!rawMatches.length) throw new Error('That tournament has no matches.');

  // participant id -> our team
  const teamByCid = {};
  const teams = parts.map(p => {
    const id = 't' + uid(4);
    const team = {
      id, name: (p.name || p.display_name || ('Seed ' + (p.seed || '?'))).trim(),
      seed: p.seed || 0,
      captainId: null, playerIds: [],
      eliminated: false, out: null,
      finalRank: p.final_rank || null
    };
    teamByCid[p.id] = team;
    return team;
  });

  // create one player per team (name = team name) so teamName() / rosters render;
  // FAF logins later can expand this. Keeps our shape happy without inventing fake players.
  for (const team of teams) {
    const pid = 'p' + uid(4);
    team.playerIds = [pid];
    team.captainId = pid;
    team._playerName = team.name;
  }
  const players = teams.map(team => ({ id: team.captainId, name: team.name, rating: null, teamId: team.id, teamName: '' }));

  // classify + index matches per our bracket rounds.
  // Challonge: positive round = winners bracket; final positive round in DE = grand final.
  // negative round = losers bracket.
  const wbMatches = rawMatches.filter(m => m.round > 0).sort((a, b) => a.round - b.round || a.identifier.localeCompare(b.identifier));
  const lbMatches = rawMatches.filter(m => m.round < 0).sort((a, b) => Math.abs(a.round) - Math.abs(b.round) || a.identifier.localeCompare(b.identifier));

  const maxWbRound = wbMatches.reduce((mx, m) => Math.max(mx, m.round), 0);

  // In double elim, the highest positive round(s) are the grand final(s).
  // Challonge "single match" GF = one match at the top positive round.
  // We treat the top positive round as GF when double; everything below is WB.
  const matches = [];
  const cidToMatchId = {};

  const mkName = (bracket, round, index) => bracket + ':' + round + ':' + index;

  // assign our matches. We keep Challonge's round numbers but renumber per bracket to 1..N contiguous.
  function buildRounds(list, isLb) {
    // group by challonge round
    const byRound = {};
    for (const m of list) {
      const r = Math.abs(m.round);
      (byRound[r] = byRound[r] || []).push(m);
    }
    const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);
    const roundMap = {}; // challongeAbsRound -> our 1-based round
    rounds.forEach((cr, i) => { roundMap[cr] = i + 1; });
    return { byRound, rounds, roundMap };
  }

  let gfMatch = null;
  let wbForBuild = wbMatches;

  if (bracketType === 'double' && maxWbRound > 0) {
    // grand final = matches at the top positive round (usually 1, sometimes 2 for reset)
    const gfRoundMatches = wbMatches.filter(m => m.round === maxWbRound);
    // Heuristic: the GF has one prereq from WB side (non-loser) and one from LB side.
    // In practice with "single match" GF there is exactly 1 match at the top WB round
    // that pulls player2 from the LB final. We detect the top WB round as GF only if
    // its match count is 1 and there is an LB bracket.
    if (gfRoundMatches.length === 1 && lbMatches.length > 0) {
      gfMatch = gfRoundMatches[0];
      wbForBuild = wbMatches.filter(m => m.round < maxWbRound);
    }
  }

  const wbInfo = buildRounds(wbForBuild, false);
  const lbInfo = buildRounds(lbMatches, true);

  function pushMatches(info, bracket) {
    for (const cr of info.rounds) {
      const ourRound = info.roundMap[cr];
      const inRound = info.byRound[cr].slice().sort((a, b) => a.identifier.localeCompare(b.identifier));
      inRound.forEach((cm, idx) => {
        const [s1, s2] = seriesScore(cm.scores_csv);
        const team1 = teamByCid[cm.player1_id] ? teamByCid[cm.player1_id].id : null;
        const team2 = teamByCid[cm.player2_id] ? teamByCid[cm.player2_id].id : null;
        const winner = teamByCid[cm.winner_id] ? teamByCid[cm.winner_id].id : null;
        const loser = teamByCid[cm.loser_id] ? teamByCid[cm.loser_id].id : null;
        const myId = 'm' + uid(4);
        cidToMatchId[cm.id] = myId;
        // bo: infer from most games in the series (max of total games, odd-rounded)
        const totalGames = Math.max(1, (s1 + s2));
        const bo = totalGames <= 1 ? 1 : (totalGames % 2 === 0 ? totalGames + 1 : totalGames);
        matches.push({
          id: myId, bracket, round: ourRound, index: idx,
          bo: bo, hcap: 0,
          team1, team2, score1: (team1 ? s1 : null), score2: (team2 ? s2 : null),
          status: cm.state === 'complete' ? 'done' : 'ready',
          winner, loser, winnerTo: null, loserTo: null,
          _cid: cm.id, _identifier: cm.identifier
        });
      });
    }
  }

  pushMatches(wbInfo, 'wb');
  pushMatches(lbInfo, 'lb');

  let rounds = wbInfo.rounds.length; // our WB round count

  if (gfMatch) {
    const [s1, s2] = seriesScore(gfMatch.scores_csv);
    const team1 = teamByCid[gfMatch.player1_id] ? teamByCid[gfMatch.player1_id].id : null;
    const team2 = teamByCid[gfMatch.player2_id] ? teamByCid[gfMatch.player2_id].id : null;
    const winner = teamByCid[gfMatch.winner_id] ? teamByCid[gfMatch.winner_id].id : null;
    const loser = teamByCid[gfMatch.loser_id] ? teamByCid[gfMatch.loser_id].id : null;
    const totalGames = Math.max(1, s1 + s2);
    const bo = totalGames <= 1 ? 1 : (totalGames % 2 === 0 ? totalGames + 1 : totalGames);
    matches.push({
      id: 'm' + uid(4), bracket: 'gf', round: 1, index: 0,
      bo: bo, hcap: 0,
      team1, team2, score1: (team1 ? s1 : null), score2: (team2 ? s2 : null),
      status: gfMatch.state === 'complete' ? 'done' : 'ready',
      winner, loser, winnerTo: null, loserTo: null,
      _cid: gfMatch.id, _identifier: gfMatch.identifier
    });
    cidToMatchId[gfMatch.id] = matches[matches.length - 1].id;
  }

  // build forward links (winnerTo / loserTo) from Challonge's prereq structure.
  // For each Challonge match, each slot is fed by a prereq match's winner or loser.
  // Invert: on the feeding match, point winnerTo/loserTo at (this match, slot).
  const matchByCid = {};
  for (const mm of matches) matchByCid[mm._cid] = mm;
  const allRaw = rawMatches.slice();
  for (const cm of allRaw) {
    const targetOur = matchByCid[cm.id];
    if (!targetOur) continue;
    const linkSlot = (prereqCid, isLoser, slot) => {
      if (!prereqCid) return;
      const feeder = matchByCid[prereqCid];
      if (!feeder) return;
      const ref = { id: targetOur.id, slot };
      if (isLoser) feeder.loserTo = ref;
      else feeder.winnerTo = ref;
    };
    linkSlot(cm.player1_prereq_match_id, cm.player1_is_prereq_match_loser, 1);
    linkSlot(cm.player2_prereq_match_id, cm.player2_is_prereq_match_loser, 2);
  }

  // winner of the whole thing
  let championTeamId = null;
  const rank1 = teams.find(x => x.finalRank === 1);
  if (rank1) championTeamId = rank1.id;
  else if (gfMatch && teamByCid[gfMatch.winner_id]) championTeamId = teamByCid[gfMatch.winner_id].id;

  // out/eliminated from final_rank (so Standings renders placements)
  for (const team of teams) {
    if (team.id === championTeamId) { team.eliminated = false; team.out = null; }
    else {
      team.eliminated = true;
      // best-effort stage tag; Standings mostly uses finalRank for imported ones
      team.out = { bracket: 'imported', round: team.finalRank || 999 };
    }
  }

  const briefing = stripHtml(t.description_source || t.description || '');

  const out = {
    id: uid(5),
    adminToken: uid(12),
    name: t.name || 'Imported tournament',
    description: briefing,
    lobbyOptions: '', mods: '',
    competition: 'team',
    formation: 'premade',
    teamSize: 2, // display-only; imported teams show their full name
    draftOrder: 'linear',
    bracketType,
    ffaCfg: null,
    plan: null,
    maxTeams: 0,
    cfg: null,
    maps: {},
    seeding: 'rating',
    status: 'finished',
    createdAt: Date.now(),
    rounds,
    players,
    teams: teams.map(x => { const c = Object.assign({}, x); delete c._playerName; return c; }),
    draft: null,
    subs: [],
    matches: matches.map(m => { const c = Object.assign({}, m); delete c._cid; delete c._identifier; return c; }),
    championTeamId,
    imported: true,
    source: 'challonge',
    sourceUrl: t.full_challonge_url || ('https://challonge.com/' + t.url),
    importedAt: Date.now()
  };
  return out;
}

module.exports = { fetchTournament, convert, seriesScore, stripHtml };
