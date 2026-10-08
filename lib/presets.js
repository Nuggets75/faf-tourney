// @ts-check
// Named format presets. A preset is nothing but a bundle of settings the create form already
// understands - it configures features, it does not add any. Each one is a plain object so it
// can be validated, logged and shown to the organizer before they commit to it.
//
// `directorOnly` is enforced SERVER-SIDE at creation (see the create handler). Hiding an option
// in a dropdown stops nobody who can open a browser console, so the check lives with the data.
'use strict';

/**
 * @typedef {{
 *   id: string, name: string, blurb: string, notes: string[],
 *   directorOnly: boolean, forceCategory: string|null,
 *   apply: Record<string, any>
 * }} Preset
 */

// Shared shape of the FAF Swiss stage: 16 players, three wins in, three losses out, every
// match a single game unless it decides someone's tournament.
const swissStage = extra => Object.assign({
  bo: 1, final: 0, finalBo: 5, fast: 0,
  winCut: 3, lossCut: 3,
  stage2: 1, s2Type: 'single', s2CutTo: 8, s2Bo: 3, s2Final: 5, s2Gf: 5
}, extra || {});

/** @type {Preset[]} */
const PRESETS = [
  {
    id: 'invitational',
    name: 'Invitational',
    blurb: '16 invited players. Swiss stage where three wins qualify and three losses eliminate, every match Bo1, then the eight who came through play a single-elimination playoff bracket.',
    notes: [
      'Rematches are never drawn and players are always paired against someone on the same record.',
      'The Swiss stage ends when all 16 are decided, which takes at most 5 rounds.',
      'Playoff bracket: Bo3 through to a Bo5 final. Adjust on the Format panel if you want it longer.'
    ],
    directorOnly: true,
    forceCategory: 'official',
    apply: {
      competition: 'team', teamSize: 1, formation: 'solo',
      bracketType: 'swiss', seeding: 'rating', ratingType: '1v1',
      maxTeams: 16, signupMode: 'invite', playerReporting: true,
      plan: swissStage({})
    }
  },
  {
    id: 'lots',
    name: 'Legend of the Stars (LotS)',
    blurb: 'The Invitational format with longer deciders: a match that would qualify a player or knock them out is played as a Bo3 instead of a Bo1.',
    notes: [
      'Seeds 1-12 are the invited field; 13-16 are usually the four who came through the qualifier.',
      'To wire the qualifier up, add it under Qualifiers with rule "top 4" and seed block 13 - the two winners-bracket survivors take 13 and 14, the two losers-bracket survivors 15 and 16.',
      'Run the qualifier itself with "End here and lock standings" once the last four are settled, rather than playing it out.',
      'With the opponent pick phase on, choose who picks their quarter-final opponent: the top half of the playoff seeds (1-4 pick from 5-8), or only the players who went through 3-0, with the other matchups drawn. It can still be changed while the Swiss is played, on the Admin tab.'
    ],
    directorOnly: true,
    forceCategory: 'official',
    apply: {
      competition: 'team', teamSize: 1, formation: 'solo',
      bracketType: 'swiss', seeding: 'rating', ratingType: '1v1',
      maxTeams: 16, signupMode: 'invite', playerReporting: true,
      pickPhase: 1,
      plan: swissStage({ decidingBo: 3 })
    }
  }
];

/** @param {string} id */
function presetById(id) {
  return PRESETS.find(p => p.id === String(id || '')) || null;
}

/**
 * The list as one caller may see it. Everyone can SEE that a preset exists (so a community
 * organizer understands why they cannot pick it); only the allowed may use one.
 * @param {boolean} isDirector
 */
function presetsFor(isDirector) {
  return PRESETS.map(p => ({
    id: p.id, name: p.name, blurb: p.blurb, notes: p.notes.slice(),
    directorOnly: p.directorOnly,
    allowed: !p.directorOnly || !!isDirector,
    apply: (!p.directorOnly || isDirector) ? p.apply : null
  }));
}

module.exports = { PRESETS, presetById, presetsFor };
