// ---------- home ----------

function pv(id) { return document.getElementById(id).value; }

// A caster opening a tournament that is under way gets streamer mode turned on for them, so they
// don't have to remember before going live. Deliberately a one-time default per tournament, not a
// forced state: streamer mode is a single global per-browser flag, so re-applying it on every
// render would make it impossible for a caster to switch it off. Once applied we record the
// tournament id and never touch it again, leaving the toggle (and the S key) fully theirs.
function maybeAutoStreamerMode() {
  try {
    if (!T || !T.id) return;
    if (!(T.viewer && T.viewer.caster)) return;      // casters only
    if (T.status !== 'running') return;              // only once it has actually started
    const key = 'faf_sm_auto_' + T.id;
    if (localStorage.getItem(key)) return;           // already defaulted for this tournament
    localStorage.setItem(key, '1');
    if (streamerMode) return;                        // already on - nothing to do, and no toast
    setStreamerMode(true);
    drawTopbar(viewerIsOrganizer() ? 'ORGANIZER' : 'CASTER');
    toast('Streamer mode on \u2014 results hidden for the cast. Turn it off any time with the toggle' +
      (hotkeyFor('streamer') ? ' or ' + hotkeyFor('streamer') : '') + '.');
  } catch (e) {}
}

// Home page: whether the completed archive is expanded, and how many rows are shown per year.
// Module level so a re-render (poll, delete, publish) doesn't collapse it under the user.
let completedOpen = false;
let completedShown = {};

// Images pasted into the host form before the tournament exists. Uploaded on create.
let _pendingCreateImages = [];

async function renderHome() {
  setTitle(null);
  stopPoll();
  drawTopbar('');
  let list = [];
  try {
    const r = await fetch('/api/tournaments', siteAdmin() ? { headers: { 'x-site-admin': siteAdmin() } } : undefined);
    list = await r.json();
    if (!r.ok) list = [];
  } catch (e) {}

  const loginPanel = me() ? '' : `
    <div class="panel section">
      <h2>Log <span class="h2-strong">In</span></h2>
      <p class="muted small" style="margin-bottom:10px">Log in with your FAF account to sign up and take part.</p>
      <button class="btn faf" id="homeLgFaf" style="max-width:280px">Log in with FAF</button>
    </div>`;

  // Unpublished tournaments are only returned to people who may see them (their organizers and
  // site admins), so anything with published===0 here belongs in the viewer's own drafts list.
  const drafts = list.filter(t => t.published === 0)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const live = list.filter(t => t.published !== 0);

  const completed = live.filter(t => t.status === 'finished' || t.abandoned)
    .sort((a, b) => tourneyDateMs(b) - tourneyDateMs(a)); // most recent first
  // Upcoming is sorted by how soon it starts, soonest first, so the next thing to sign up for is
  // at the top. Anything with no date set sorts to the bottom rather than jumping the queue.
  const upcoming = live.filter(t => t.status === 'signup' && !t.abandoned).sort((a, b) => {
    const am = tourneyDateMs(a), bm = tourneyDateMs(b);
    if (!am && !bm) return (b.createdAt || 0) - (a.createdAt || 0);
    if (!am) return 1;
    if (!bm) return -1;
    return am - bm;
  });
  const groups = [
    ['Ongoing', live.filter(t => ['draft', 'drafted', 'running'].indexOf(t.status) >= 0 && !t.abandoned), 'No tournaments running.'],
    ['Upcoming / Open', upcoming, 'Nothing upcoming right now.'],
    ['Completed', completed, 'No finished tournaments yet.']
  ];
  // drafts get their own section, shown first and only when the viewer actually has one
  if (drafts.length) groups.unshift(['My drafts', drafts, '']);

  // short "in 1 day, 17 hrs, 5 mnts" countdown for card badges
  const eta = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (!(ms > 0)) return null;
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), mn = Math.floor(ms % 3600000 / 60000);
    const parts = [];
    if (d) parts.push(d + ' day' + (d === 1 ? '' : 's'));
    if (h || d) parts.push(h + ' h');
    parts.push(mn + ' min');
    return parts.join(', ');
  };

  // Completed is collapsed by default and split by year, then paged. With years of archived and
  // imported events an open list would be thousands of rows nobody can scroll through.
  const COMPLETED_PAGE = 50;
  const yearOf = (t) => { const ms = tourneyDateMs(t); return ms ? new Date(ms).getUTCFullYear() : 0; };
  const completedYears = [];
  {
    const byYear = new Map();
    for (const t of completed) {
      const y = yearOf(t);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(t);
    }
    // newest year first; undated events last under their own heading
    for (const y of Array.from(byYear.keys()).sort((a, b) => (b || -1) - (a || -1))) {
      completedYears.push({ year: y, items: byYear.get(y) });
    }
  }

  app.innerHTML = '<div class="page page-wide">' + loginPanel + groups.map((g, i) => {
    if (g[0] === 'Completed') {
      return `<div class="panel section">
        <h2 class="collapsy" id="cmpToggle" role="button" tabindex="0" aria-expanded="${completedOpen ? 'true' : 'false'}">
          <span class="collapsy-caret">${completedOpen ? '\u25BE' : '\u25B8'}</span> ${esc(g[0])} <span class="h2-strong">(${g[1].length})</span>
          <span class="muted small" style="font-weight:400">${completedOpen ? '' : ' \u2014 click to show'}</span>
        </h2>
        <div id="cmpBody" style="${completedOpen ? '' : 'display:none'}">
          ${g[1].length ? '' : '<div class="empty">' + esc(g[2]) + '</div>'}
          ${completedYears.map((yg, yi) => `<div class="cmp-year">
            <h3 class="cmp-year-head">${yg.year ? yg.year : 'No date set'} <span class="muted small">(${yg.items.length})</span></h3>
            <div id="tlistC${yi}"></div>
            <div class="cmp-more" id="cmpMore${yi}"></div>
          </div>`).join('')}
        </div>
      </div>`;
    }
    return `<div class="panel section${g[0] === 'My drafts' ? ' draft-panel' : ''}">
      <h2>${esc(g[0])} <span class="h2-strong">(${g[1].length})</span></h2>
      ${g[0] === 'My drafts' ? '<p class="muted small" style="margin:-4px 0 10px">Not published yet \u2014 only you (and site admins) can see these. Publish one from its Admin tab, or schedule a publish date there.</p>' : ''}
      <div id="tlist${i}">${g[1].length ? '' : '<div class="empty">' + esc(g[2]) + '</div>'}</div>
    </div>`;
  }).join('') + '</div>';

  const hlFaf = document.getElementById('homeLgFaf');
  if (hlFaf) hlFaf.onclick = () => {
    const returnTo = location.pathname + location.search;
    location.href = '/auth/faf/login?returnTo=' + encodeURIComponent(returnTo);
  };

  // One card builder, used for the flat sections and for each year of the completed archive.
  const buildCard = (t) => {
      const div = document.createElement('div');
      div.className = 'tlist-item';
      const kind = t.competition === 'ffa' ? 'FFA' :
        (t.teamSize + 'v' + t.teamSize + ' ' + ({ single: 'SE', double: 'DE', swiss: 'Swiss' }[t.bracketType] || ''));
      let ratingLine = '';
      if (t.minRating != null || t.maxRating != null) {
        ratingLine = t.minRating != null && t.maxRating != null ? 'Rating ' + t.minRating + '\u2013' + t.maxRating
          : t.minRating != null ? 'Rating ' + t.minRating + '+' : 'Rating up to ' + t.maxRating;
      }
      if (t.maxTeamRating != null) ratingLine += (ratingLine ? ' \u00b7 ' : '') + 'Team cap ' + t.maxTeamRating;
      const unit = t.competition === 'ffa' ? 'players' : (t.teamSize === 1 ? 'players' : 'teams');
      let teamsLine = '';
      if (t.minTeams && t.maxTeams) teamsLine = t.minTeams + '\u2013' + t.maxTeams + ' ' + unit;
      else if (t.minTeams) teamsLine = 'min ' + t.minTeams + ' ' + unit;
      else if (t.maxTeams) teamsLine = 'max ' + t.maxTeams + ' ' + unit;
      const signupEta = (t.status === 'signup' && !t.abandoned && t.signupOpensAt) ? eta(t.signupOpensAt) : null;
      const eventEta = (!t.abandoned && ['signup', 'draft', 'drafted'].indexOf(t.status) >= 0 && t.eventDate) ? eta(t.eventDate) : null;
      // Once signups are actually open (status signup, not waiting to open) and a close time is
      // set, show how long until they close — without hiding the "signups open" status.
      const closeEta = (t.status === 'signup' && !t.abandoned && !signupEta && t.signupClosesAt) ? eta(t.signupClosesAt) : null;
      const countdown = signupEta
        ? '<span class="countchip">Signups start in: ' + esc(signupEta) + '</span>'
        : (eventEta ? '<span class="countchip">Event starts in: ' + esc(eventEta) + '</span>' : '');
      const closeChip = closeEta ? '<span class="countchip countchip-close">Signups close in: ' + esc(closeEta) + '</span>' : '';
      const pill = '<span class="pill ' + statusPillClass(t) + '">' + esc(statusPillLabel(t)) + '</span>';
      div.innerHTML = `
        <div>
          <div class="tname"><a href="/t/${t.id}">${esc(t.name)}</a>${t.category ? ' <span class="catbox ' + (t.category === 'official' ? 'official' : 'community') + '">' + (t.category === 'official' ? 'OFFICIAL' : 'COMMUNITY') + '</span>' : ''}</div>
          <div class="tlist-meta">${esc(kind)}${t.imported ? '' : ' \u00b7 ' + t.players + ' signed up'}${tourneyDate(t) ? ' \u00b7 <span class="tdate">' + esc(fmtDateTime(tourneyDate(t))) + '</span>' : ''}${eventDaysLabel(t) ? ' <span class="tdays" title="This event runs on ' + esc(eventDaysLabel(t)) + '">' + esc(eventDaysCountLabel(t)) + '</span>' : ''}${ratingLine ? ' \u00b7 ' + esc(ratingLine) : ''}${teamsLine ? ' \u00b7 ' + esc(teamsLine) : ''}${t.prize ? ' \u00b7 <span class="tprize">' + esc(formatPrize(t.prize)) + '</span>' : ''}</div>
        </div>
        <span style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end">
          ${t.published === 0 ? (t.canManage === 0
            ? '<span class="idbadge late" title="Someone else\u2019s draft. You can see it as a tournament director, but you have no organizer rights on it.">draft \u00b7 view only</span>'
            : '<span class="idbadge late" title="Draft — not listed publicly until you publish it">draft</span>') : ''}
          ${closeChip}
          ${closeChip ? pill : (countdown || pill)}
          ${siteAdmin() ? '<button class="btn danger small" data-del="' + t.id + '">Delete</button>' : ''}
        </span>`;
      const delBtn = div.querySelector('[data-del]');
      if (delBtn) delBtn.onclick = () => {
        modal(`<h3>Delete tournament</h3><p>Remove <strong>${esc(t.name)}</strong> permanently? This cannot be undone.</p>
          <div class="actions"><button class="btn ghost" id="dCancel">Cancel</button><button class="btn danger" id="dGo">Delete</button></div>`, root => {
          root.querySelector('#dCancel').onclick = closeModal;
          root.querySelector('#dGo').onclick = async () => {
            try { await api('/api/t/' + t.id + '/delete', { admin: siteAdmin() }); closeModal(); toast('Deleted'); renderHome(); }
            catch (e) { toast(e.message, true); }
          };
        });
      };
    return div;
  };

  // flat sections (drafts / ongoing / upcoming)
  groups.forEach((g, i) => {
    if (g[0] === 'Completed') return;
    const tl = document.getElementById('tlist' + i);
    if (!tl) return;
    for (const t of g[1]) tl.appendChild(buildCard(t));
  });

  // completed: one paged list per year, rendered lazily so a huge archive costs nothing until
  // the section is opened and nothing beyond the first page until "show more" is pressed.
  const paintYear = (yi) => {
    const yg = completedYears[yi];
    const tl = document.getElementById('tlistC' + yi);
    const more = document.getElementById('cmpMore' + yi);
    if (!yg || !tl) return;
    const shown = completedShown[yi] || COMPLETED_PAGE;
    tl.innerHTML = '';
    for (const t of yg.items.slice(0, shown)) tl.appendChild(buildCard(t));
    if (more) {
      const left = yg.items.length - shown;
      more.innerHTML = left > 0
        ? '<button class="btn ghost small" data-cmpmore="' + yi + '">Show ' + Math.min(left, COMPLETED_PAGE) + ' more of ' + yg.items.length + '</button>'
        : '';
      const btn = more.querySelector('[data-cmpmore]');
      if (btn) btn.onclick = () => { completedShown[yi] = shown + COMPLETED_PAGE; paintYear(yi); };
    }
  };
  const paintCompleted = () => { completedYears.forEach((_, yi) => paintYear(yi)); };
  if (completedOpen) paintCompleted();

  const cmpToggle = document.getElementById('cmpToggle');
  if (cmpToggle) {
    const flip = () => {
      completedOpen = !completedOpen;
      const body = document.getElementById('cmpBody');
      const caret = cmpToggle.querySelector('.collapsy-caret');
      if (body) body.style.display = completedOpen ? '' : 'none';
      if (caret) caret.textContent = completedOpen ? '\u25BE' : '\u25B8';
      cmpToggle.setAttribute('aria-expanded', completedOpen ? 'true' : 'false');
      if (completedOpen) paintCompleted();
    };
    cmpToggle.onclick = flip;
    cmpToggle.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  }
}

async function renderHost() {
  setTitle('Host a tournament');
  stopPoll();
  drawTopbar('');
  app.innerHTML = `
    <div class="page" style="max-width:900px">
      <p style="margin:0 0 16px"><a href="/">\u2190 Back to tournaments</a></p>
      <div class="panel section" id="copyFromPanel">
        <label>Copy from an existing tournament <span class="muted small">(optional \u2014 fills everything except dates; maps are copied later on the Maps tab)</span></label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="cCopyFrom" style="flex:1;min-width:220px"><option value="">\u2014 Start blank \u2014</option></select>
          <button class="btn ghost small" id="cCopyBtn">Fill from this</button>
        </div>
      </div>
      <div class="panel section">
        <h2>Host a <span class="h2-strong">Tournament</span></h2>
        <div id="presetPanel" style="display:none">
          <label>Format preset <span class="muted" style="font-weight:400">(optional)</span></label>
          <select id="cPreset"><option value="">Set everything up myself</option></select>
          <div id="presetInfo" class="infocell" style="display:none;margin:8px 0 4px"></div>
        </div>
        <label>Tournament name</label>
        <input type="text" id="cName" maxlength="60" placeholder="e.g. EPIC 3v3 double elim">
        <label>Event date &amp; time (UTC) <span class="muted" style="font-weight:400">(optional)</span></label>
        <div style="display:flex;gap:8px"><input type="date" id="cDate" style="flex:1"><input type="time" id="cTime" style="width:130px"></div>
        <div id="cDayPick" class="dp-host"></div>
        <label>Signups open at (UTC) <span class="muted" style="font-weight:400">(optional \u2014 before this, only organizers can add players)</span></label>
        <div style="display:flex;gap:8px"><input type="date" id="cSuDate" style="flex:1"><input type="time" id="cSuTime" style="width:130px"></div>
        <label>Signups close at (UTC) <span class="muted" style="font-weight:400">(optional \u2014 after this, signups auto-close; team forming &amp; captain picks still work. Leave empty to close manually)</span></label>
        <div style="display:flex;gap:8px"><input type="date" id="cScDate" style="flex:1"><input type="time" id="cScTime" style="width:130px"></div>
        <label>Check-in deadline (UTC) <span class="muted" style="font-weight:400">(optional \u2014 teams that have not checked in by then are dropped when you start. Leave empty for no check-in)</span></label>
        <div style="display:flex;gap:8px"><input type="date" id="cCiDate" style="flex:1"><input type="time" id="cCiTime" style="width:130px"></div>
        <label>Description (rules, schedule)</label>
        <span class="muted small">Paste a screenshot straight in, or <a href="#" id="cDescImgBtn">insert an image</a>.</span>
        <input type="file" id="cDescImgFile" accept="image/*" style="display:none">
        ${mdToolbarHTML()}
        <textarea id="cDesc" maxlength="20000" rows="6" placeholder="Sunday 19:00 CEST. Check-in in Discord... (supports **bold**, headings, lists, links)"></textarea>
        <label>Lobby options</label>
        ${mdToolbarHTML()}
        <textarea id="cLobby" maxlength="20000" rows="4" placeholder="e.g. 1500 unit cap, full share"></textarea>
        <label>Mods</label>
        ${mdToolbarHTML()}
        <textarea id="cMods" maxlength="500" rows="2" placeholder="e.g. M28 / Random events"></textarea>
        <label>Overall cash prize <span class="muted small">(optional)</span></label>
        <div class="prize-row">
          <select id="cPrizeCur"><option value="">\u2014</option><option value="USD">USD $</option><option value="EUR">EUR \u20ac</option><option value="RUB">RUB \u20bd</option></select>
          <input type="number" id="cPrizeAmt" min="0" step="1" inputmode="numeric" placeholder="Amount">
        </div>
        <div class="muted small" style="margin-top:4px">Just the number \u2014 describe the full prize breakdown in Rewards below.</div>
        <label>Rewards <span class="muted small">(optional)</span></label>
        <span class="muted small">Paste a screenshot straight in (e.g. an avatar), or <a href="#" id="cRwImgBtn">insert an image</a>.</span>
        <input type="file" id="cRwImgFile" accept="image/*" style="display:none">
        ${mdToolbarHTML()}
        <textarea id="cRewards" maxlength="2000" rows="3" placeholder="1st: avatar + 500 credits..."></textarea>
        <label>Sponsors <span class="muted small">(optional)</span></label>
        <span class="muted small">Paste a screenshot straight in, or <a href="#" id="cSpImgBtn">insert an image</a>.</span>
        <input type="file" id="cSpImgFile" accept="image/*" style="display:none">
        ${mdToolbarHTML()}
        <textarea id="cSponsors" maxlength="2000" rows="3" placeholder="Powered by [YourSponsor](https://...)"></textarea>
        <label>Livestream links <span class="muted small">(optional)</span></label>
        <div id="cStreamRows"></div>
        <button class="btn ghost small" id="cStreamAdd" type="button">+ Add another stream</button>

        <label>Competition</label>
        <select id="cComp">
          <option value="team">Team bracket (1v1 ... 6v6)</option>
          <option value="ffa">FFA</option>
        </select>

        <label>Type <span class="req">*</span></label>
        <select id="cCategory">
          <option value="">Select Official or Community…</option>
          <option value="official">Official</option>
          <option value="community">Community</option>
        </select>

        <label>Series <span class="muted small">(optional)</span></label>
        <select id="cSeries"><option value="">\u2014 not part of a series \u2014</option></select>
        <div class="muted small" style="margin-top:4px">Group this with other editions of a recurring event. You can also set or change this later on the Admin tab.</div>

        <div id="teamOpts">
          <label>Team size</label>
          <select id="cSize">${[1,2,3,4,5,6].map(n => '<option value="'+n+'"'+(n===2?' selected':'')+'>'+n+'v'+n+'</option>').join('')}</select>
          <div id="formationWrap">
            <label>Team formation</label>
            <select id="cFormation">
              <option value="open">Premade teams — players sign up, then create teams and invite / request to join</option>
              <option value="draft">Captains draft — organizer picks captains, they draft the pool</option>
            </select>
            <div id="draftOrderWrap">
              <label>Draft pick order</label>
              <select id="cDraftOrder">
                <option value="linear" selected>Bottom to top, every round</option>
                <option value="snake">Snake (1→N, N→1, 1→N, ...)</option>
              </select>
            </div>
          </div>
          <label>Bracket</label>
          <select id="cBracket">
            <option value="single">Single elimination</option>
            <option value="double">Double elimination</option>
            <option value="swiss">Swiss</option>
          </select>

          <div id="planSingle">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Early rounds</div><select id="pEarly"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Semifinal</div><select id="pSemi"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Final</div><select id="pFinal"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:10px">
              <input type="checkbox" id="pThird"> 3rd place match: the two beaten semi-finalists play for 3rd
            </label>
          </div>
          <div id="planDouble" style="display:none">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Winners bracket rounds</div><select id="pWb"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Winners bracket final</div><select id="pWbFinal"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <div class="row" style="gap:10px;margin-top:8px">
              <div style="flex:1"><div class="muted small">Losers bracket rounds</div><select id="pLb"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              <div style="flex:1"><div class="muted small">Losers bracket final</div><select id="pLbFinal"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <div class="row" style="gap:10px;margin-top:8px">
              <div style="flex:1"><div class="muted small">Grand final</div><select id="pGf"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pHcap" checked> Upper bracket finalist starts the grand final 1-0 up
            </label>
          </div>
          <div id="planSwiss" style="display:none">
            <label>Match lengths</label>
            <div class="row" style="gap:10px">
              <div style="flex:1"><div class="muted small">Each match</div><select id="pSwBo"><option value="1">Bo1</option><option value="3" selected>Bo3</option></select></div>
              <div style="flex:1"><div class="muted small">Final</div><select id="pSwFinalBo"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
            </div>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pSwFinal" checked> Final between the top 2 after the last round
            </label>
            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text)">
              <input type="checkbox" id="pSwFast"> Fast pairing \u2014 next matchup starts as soon as two teams are free
            </label>
            <div style="margin-top:8px"><div class="muted small">Order within the same record</div>
              <select id="pTiebreak"><option value="gd" selected>Game difference</option><option value="beaten">Sum of the scores of the opponents beaten, then random</option></select>
              <div class="muted small" style="margin-top:4px">Decides the standings between equal records, and with a playoff stage who goes through, the playoff seeds and who picks first.</div></div>

            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
              <input type="checkbox" id="pSwCuts"> Finish on record instead of a round count
            </label>
            <div id="swCutBox" style="display:none;padding:8px 0 0 22px">
              <p class="muted small" style="margin:0 0 8px">Teams leave the stage the moment they hit either mark, so the stage ends when everyone is decided rather than after a fixed number of rounds. Used by the FAF Invitational and LotS.</p>
              <div class="row" style="gap:10px">
                <div style="flex:1"><div class="muted small">Wins to advance</div><input type="number" id="pSwWinCut" min="0" max="15" value="3"></div>
                <div style="flex:1"><div class="muted small">Losses to eliminate</div><input type="number" id="pSwLossCut" min="0" max="15" value="3"></div>
                <div style="flex:1"><div class="muted small">Deciding matches</div><select id="pSwDecBo"><option value="0">same as above</option><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
              </div>
              <p class="muted small" style="margin:8px 0 0">A deciding match is one where a win qualifies someone or a loss knocks them out. Everything else uses the normal match length.</p>
              <p class="muted small" id="swCutHint" style="margin:6px 0 0"></p>
            </div>

            <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:12px">
              <input type="checkbox" id="pSwStage2"> Second stage: cut the qualifiers into a playoff bracket
            </label>
            <div id="swStage2Box" style="display:none;padding:8px 0 0 22px">
              <p class="muted small" style="margin:0 0 8px">One tournament, two stages. The Swiss stage runs first, then the teams that came through are seeded into a bracket on the same page - no second event, no invites to accept.</p>
              <div class="row" style="gap:10px">
                <div style="flex:1"><div class="muted small">Teams through</div><input type="number" id="pSwS2Cut" min="2" max="64" value="8"></div>
                <div style="flex:1"><div class="muted small">Bracket</div><select id="pSwS2Type"><option value="single" selected>Single elimination</option><option value="double">Double elimination</option></select></div>
                <div style="flex:1"><div class="muted small">Playoff matches</div><select id="pSwS2Bo"><option value="1">Bo1</option><option value="3" selected>Bo3</option><option value="5">Bo5</option><option value="7">Bo7</option></select></div>
                <div style="flex:1"><div class="muted small">Playoff final</div><select id="pSwS2Final"><option value="1">Bo1</option><option value="3">Bo3</option><option value="5" selected>Bo5</option><option value="7">Bo7</option></select></div>
              </div>
              <label id="pSwS2ThirdWrap" style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:8px">
                <input type="checkbox" id="pSwS2Third"> 3rd place match: the two beaten semi-finalists play for 3rd
              </label>
              <p class="muted small" style="margin:8px 0 0">The single top-2 final above is replaced by the bracket while this is on.</p>
            </div>
          </div>

          <div id="divOpts" style="display:none">
            <label>Divisions <span class="muted small">(optional - e.g. a King and a Prince bracket)</span></label>
            <select id="cDivisions">
              <option value="0" selected>One bracket</option>
              <option value="2">2 divisions</option>
              <option value="3">3 divisions</option>
              <option value="4">4 divisions</option>
            </select>
            <div id="divNamesRow" class="row" style="gap:10px;margin-top:8px;display:none;flex-wrap:wrap">
              ${[1, 2, 3, 4].map(d => '<div style="flex:1;min-width:120px" data-divnamebox="' + d + '"><div class="muted small">Division ' + d + ' name</div><input type="text" id="cDivName' + d + '" maxlength="24" placeholder="' + DIVISION_DEFAULT_NAMES[d - 1] + '" autocomplete="off"></div>').join('')}
            </div>
            <p class="muted small" id="divHow" style="margin:8px 0 0"></p>
          </div>
        </div>

        <div id="stopAtOpts">
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:14px">
            <input type="checkbox" id="pStopOn"> End the tournament early, once a set number are left
          </label>
          <div id="stopAtBox" style="display:none;padding:8px 0 0 22px">
            <p class="muted small" style="margin:0 0 8px">For a qualifier: once the field is down to the number that qualifies, there is nothing left worth playing. The tournament ends by itself at that point and the standings are locked - nobody is crowned champion.</p>
            <div class="row" style="gap:10px;align-items:flex-end">
              <div style="width:150px"><div class="muted small">Stop when this many are left</div><input type="number" id="pStopAt" min="2" max="128" value="4"></div>
              <div class="muted small" style="flex:1;padding-bottom:8px">Shown on the bracket from the moment it is generated, so players know which matches are never going to be played. Single or double elimination only.</div>
            </div>
          </div>
        </div>

        <div id="pickPhaseOpts">
          <label style="display:flex;align-items:center;gap:9px;cursor:pointer;text-transform:none;font-family:var(--body);font-size:13px;color:var(--text);margin-top:14px">
            <input type="checkbox" id="pPickPhase"> Let the top seeds choose their own opponent
          </label>
          <div class="muted small" id="pickPhaseWhere" style="margin:4px 0 0 22px"></div>
          <div id="pickPhaseBox" style="display:none;padding:8px 0 0 22px">
            <p class="muted small" id="pickPhaseWhat" style="margin:0 0 8px">The top half of the seeds each pick who they play, in seed order, instead of the bracket deciding. Needs a full bracket (4, 8, 16, 32...).</p>
            <div id="pickModeRow" style="display:none;margin:0 0 8px">
              <div class="muted small">Who picks</div>
              <select id="pPickMode">
                <option value="half">The top half of the playoff seeds</option>
                <option value="unbeaten">Only the unbeaten (3-0); everyone else is drawn</option>
                <option value="bottom">Only the unbeaten (3-0), from the 3-2s; everyone else is seeded</option>
              </select>
            </div>
            <div class="row" style="gap:10px;align-items:flex-end">
              <div style="width:170px"><div class="muted small">Time limit per pick</div><input type="number" id="pPickMins" min="0" max="1440" value="0"></div>
              <div class="muted small" style="flex:1;padding-bottom:8px">Minutes. 0 means no limit. When a pick runs out of time the standard bracket matchup is used, so one absent player cannot stall the event.</div>
            </div>
          </div>
        </div>

        <div id="ffaOpts" style="display:none">
          <label>Entrants</label>
          <select id="cFfaSize">
            <option value="1">Solo players</option>
            <option value="2">Teams of 2</option>
            <option value="3">Teams of 3</option>
          </select>
          <label id="perMatchLabel">Players per FFA lobby</label>
          <select id="cPerMatch"></select>
          <label>Mode</label>
          <select id="cFfaMode">
            <option value="points" selected>Points over rounds \u2014 placement points each round, highest total wins</option>
            <option value="elim">Knockout \u2014 top finishers advance, rest are out</option>
          </select>
          <div id="ffaPointsOpts">
            <label>Number of rounds</label>
            <input type="number" id="cFfaRounds" min="1" max="10" value="3" autocomplete="off">
            <label>After each round</label>
            <div class="row" style="gap:10px;align-items:center">
              <select id="cFfaCutMode" style="flex:1"><option value="0">Everyone continues</option><option value="1">Cut to the top \u2026</option></select>
              <input type="number" id="cFfaCutTo" min="2" max="64" value="8" style="flex:0 0 90px;display:none" autocomplete="off">
            </div>
            <label>After the last round</label>
            <div class="row" style="gap:10px;align-items:center">
              <select id="cFfaFinalMode" style="flex:1"><option value="0">Highest points is champion</option><option value="1">Top \u2026 play a final lobby</option></select>
              <input type="number" id="cFfaFinalSize" min="2" max="16" value="4" style="flex:0 0 90px;display:none" autocomplete="off">
            </div>
          </div>
          <div id="ffaElimOpts" style="display:none">
            <label>Advancing per lobby</label>
            <select id="cAdvance"><option value="1">Winner only</option><option value="2">Top 2</option><option value="3">Top 3</option><option value="4">Top 4</option></select>
          </div>
        </div>

        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px"><label>Min ${'\u200b'}teams / entrants <span class="muted small">(0 = none; display only)</span></label>
          <input type="number" id="cMinTeams" min="0" max="128" value="0" autocomplete="off"></div>
          <div style="flex:1;min-width:160px"><label>Max ${'\u200b'}teams / entrants <span class="muted small">(0 = unlimited)</span></label>
          <input type="number" id="cMaxTeams" min="0" max="128" value="0" autocomplete="off"></div>
        </div>

        <label>Seeding</label>
        <select id="cSeed">
          <option value="rating" selected>By rating (entered at signup)</option>
          <option value="random">Random</option>
          <option value="manual">Manual (organizer arranges the seeds)</option>
        </select>

        <label>Rating used</label>
        <select id="cRatingType">
          <option value="global" selected>Global (fetched from FAF)</option>
          <option value="1v1">1v1 / ladder (fetched)</option>
          <option value="2v2">2v2 (fetched)</option>
          <option value="3v3">3v3 (fetched)</option>
          <option value="4v4">4v4 (fetched)</option>
          <option value="rc">Fearghal's RC — best of 2v2/3v3/4v4/Global, blended to 300 games (fetched)</option>
          <option value="none">None — players enter their own rating</option>
        </select>

        <label>Rating date <span class="muted small">(rating taken as of this day; blank = at signup time)</span></label>
        <input type="date" id="cRatingDate">

        <label>Rating requirements <span class="muted small">(optional \u2014 self-signups outside the range are refused; organizer adds and invites bypass this)</span></label>
        <div style="display:flex;gap:8px">
          <input type="number" id="cMinRating" min="0" max="4000" placeholder="Min rating" style="flex:1">
          <input type="number" id="cMaxRating" min="0" max="4000" placeholder="Max rating" style="flex:1">
        </div>
        <div id="cTeamCapWrap">
          <label>Max team rating <span class="muted small">(optional \u2014 combined rating cap; players can't join a team past it, organizers can)</span></label>
          <input type="number" id="cMaxTeamRating" min="0" max="30000" placeholder="e.g. 3000">
        </div>
        <label>Rating cap <span class="muted small">(optional \u2014 clamp: a player above this counts as exactly this rating, not refused. e.g. 2200)</span></label>
        <input type="number" id="cRatingCap" min="0" max="4000" placeholder="off">

        <label>Signups</label>
        <select id="cSignupMode">
          <option value="open" selected>Open — anyone with a FAF login can sign up</option>
          <option value="request">Request only — players request, an organizer approves</option>
          <option value="invite">Invite only — only players you invite can sign up</option>
        </select>

        <label style="display:block;margin-top:10px"><input type="checkbox" id="cPlayerReporting" checked> Allow players to submit scores <span class="muted small">(must provide replay IDs and be confirmed by the opponent; organizers can always report)</span></label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:16px;cursor:pointer">
          <input type="checkbox" id="cVeto" style="width:auto"> Enable map vetoes (captains ban/pick maps before matches)
        </label>
        <div id="cVetoCfg" style="display:none;margin-top:12px;padding-left:12px;border-left:2px solid var(--line-solid)">
          <label>Who is Team A?</label>
          <select id="cVetoAb" style="max-width:420px">
            <option value="lowerA">Lower rated is Team A (acts first)</option>
            <option value="lowerB">Lower rated is Team B (higher rated acts first)</option>
            <option value="random">Random per match</option>
            <option value="manual">I set it myself for every match</option>
          </select>
          <label style="margin-top:12px">When is the veto done?</label>
          <select id="cVetoMode" style="max-width:420px">
            <option value="upfront">All upfront — captains complete the whole veto before game 1</option>
            <option value="continuous">Continuous — reveal steps as games are played</option>
          </select>
          <div class="muted small" style="margin-top:8px">You'll build your maps, pools and ban/pick orders on the tournament's <strong>Maps</strong> tab afterwards. Everything here is also changeable later from the Admin tab.</div>
        </div>
        <div style="margin-top:20px">
          <button class="btn primary" id="cGo">Create tournament</button>
        </div>
      </div>
    </div>`;

  // fill the optional series dropdown (series are created on the /series page)
  {
    const sel = document.getElementById('cSeries');
    if (sel) fetch('/api/series').then(r => r.json()).then(d => {
      for (const s2 of (d.series || [])) {
        const o = document.createElement('option');
        o.value = s2.id;
        o.textContent = s2.name + (s2.editions ? ' (' + s2.editions + ')' : '');
        sel.appendChild(o);
      }
    }).catch(() => {});
  }

  const comp = document.getElementById('cComp');
  const size = document.getElementById('cSize');
  const formation = document.getElementById('cFormation');
  const cBracket = document.getElementById('cBracket');
  const ffaSize = document.getElementById('cFfaSize');
  const ffaMode = document.getElementById('cFfaMode');
  const perMatch = document.getElementById('cPerMatch');
  const cutMode = document.getElementById('cFfaCutMode');
  const finalMode = document.getElementById('cFfaFinalMode');

  // Swiss record cuts + stage 2: show the sub-panels only when asked for, and tell the
  // organizer what the numbers they typed actually mean before they commit to them.
  // Where the picking actually happens depends on the bracket type, and on a Swiss with no
  // second stage it happens NOWHERE: the swiss start path has no round-one pick branch at all,
  // the flag is only ever read when the playoff bracket is built. Leaving a control that
  // silently does nothing is worse than a line of text saying so.
  const syncPickWhere = () => {
    const el = document.getElementById('pickPhaseWhere');
    if (!el) return;
    const sel = document.getElementById('cBracket');
    const bt = (sel && sel.value) || (typeof T !== 'undefined' && T && T.bracketType) || 'single';
    const st2 = document.getElementById('pSwStage2');
    const playoffs = bt === 'swiss' && !!(st2 && st2.checked);
    el.textContent = (bt !== 'swiss')
      ? 'Runs on round one of the bracket.'
      : (playoffs
        ? 'On a Swiss this runs on the PLAYOFF bracket, and it can still be changed while the Swiss is played (Admin tab). Swiss round 1 is drawn by seed, and can be rearranged by hand.'
        : 'Does nothing on a Swiss with no second stage. Swiss round 1 is drawn by seed, and can be rearranged by hand once the rounds start.');
    // Choosing WHO picks only means something when a Swiss stage decides the records first.
    const modeRow = document.getElementById('pickModeRow');
    const modeSel = document.getElementById('pPickMode');
    if (modeRow) modeRow.style.display = playoffs ? '' : 'none';
    const what = document.getElementById('pickPhaseWhat');
    if (what) {
      const win = parseInt((document.getElementById('pSwWinCut') || {}).value, 10) || 0;
      const cutsOn = !!(document.getElementById('pSwCuts') || {}).checked;
      const unb = (cutsOn && win) ? win + '-0' : 'no losses';
      const loss = parseInt((document.getElementById('pSwLossCut') || {}).value, 10) || 0;
      const bottomRec = (cutsOn && win && loss) ? win + '-' + (loss - 1) : 'lowest record';
      if (modeSel && modeSel.options[1]) modeSel.options[1].textContent = 'Only the unbeaten (' + unb + '); everyone else is drawn';
      if (modeSel && modeSel.options[2]) modeSel.options[2].textContent = 'Only the unbeaten (' + unb + '), from the ' + bottomRec + 's; everyone else is seeded';
      const pickOn = !!(document.getElementById('pPickPhase') || {}).checked;
      const mode = (playoffs && pickOn && modeSel) ? modeSel.value : 'half';
      // that option always seeds by the beaten score, so the tiebreak follows it (and comes back after)
      const tbSel = document.getElementById('pTiebreak');
      if (tbSel) {
        if (mode === 'bottom') { if (!tbSel.disabled) tbSel.dataset.was = tbSel.value; tbSel.value = 'beaten'; tbSel.disabled = true; }
        else if (tbSel.disabled) { tbSel.disabled = false; if (tbSel.dataset.was) tbSel.value = tbSel.dataset.was; }
      }
      what.textContent = mode === 'bottom'
        ? 'Everyone who went through the Swiss without a loss chooses their playoff opponent from the ' + bottomRec + 's, in seed order. The rest are paired by seed, the best remaining against the lowest. Seeds follow the standings, then the sum of the scores of the opponents each player beat. Needs a playoff of 4, 8, 16 or 32.'
        : mode === 'unbeaten'
        ? 'Everyone who went through the Swiss without a loss chooses their playoff opponent, in seed order. The rest are drawn against each other, a different record against each other where possible. Needs a playoff of 4, 8, 16 or 32.'
        : 'The top half of the seeds each pick who they play, in seed order, instead of the bracket deciding. Needs a full bracket (4, 8, 16, 32...).';
    }
  };

  const syncSwissExtras = () => {
    const box = document.getElementById('swCutBox');
    const s2box = document.getElementById('swStage2Box');
    if (!box || !s2box) return;
    const cuts = document.getElementById('pSwCuts');
    const st2 = document.getElementById('pSwStage2');
    const on = !!(cuts && cuts.checked);
    box.style.display = on ? '' : 'none';
    s2box.style.display = (st2 && st2.checked) ? '' : 'none';
    // double-elimination playoffs already decide 3rd place in the losers bracket
    const s2third = document.getElementById('pSwS2ThirdWrap');
    const s2type = document.getElementById('pSwS2Type');
    if (s2third) s2third.style.display = (s2type && s2type.value === 'double') ? 'none' : 'flex';
    // a plain top-2 final and a playoff bracket are two answers to the same question
    const finalRow = document.getElementById('pSwFinal');
    if (finalRow) finalRow.disabled = !!(st2 && st2.checked);
    const stopBox = document.getElementById('stopAtBox');
    const stopCk = document.getElementById('pStopOn');
    if (stopBox && stopCk) stopBox.style.display = stopCk.checked ? '' : 'none';
    const pickBox = document.getElementById('pickPhaseBox');
    const pickCk = document.getElementById('pPickPhase');
    if (pickBox && pickCk) pickBox.style.display = pickCk.checked ? '' : 'none';
    syncPickWhere();
    const hint = document.getElementById('swCutHint');
    if (hint && on) {
      const w = parseInt(document.getElementById('pSwWinCut').value, 10) || 0;
      const l = parseInt(document.getElementById('pSwLossCut').value, 10) || 0;
      const rounds = (w && l) ? (w + l - 1) : (w || l);
      const comfy = Math.pow(2, Math.max(w, l) + 1);
      const bits = [];
      if (rounds) bits.push('Longest anyone can play: ' + rounds + ' round' + (rounds === 1 ? '' : 's') + '.');
      if (comfy) bits.push('Works cleanly from ' + comfy + ' teams up; below that the draw may have to repeat a pairing.');
      hint.textContent = bits.join(' ');
    }
  };
  ['pStopOn'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.addEventListener('change', () => {
      const box = document.getElementById('stopAtBox');
      if (box) box.style.display = e.checked ? '' : 'none';
    });
  });
  ['pPickPhase'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.addEventListener('change', () => {
      const box = document.getElementById('pickPhaseBox');
      if (box) box.style.display = e.checked ? '' : 'none';
    });
  });
  ['pSwCuts', 'pSwStage2', 'pSwWinCut', 'pSwLossCut', 'pPickMode', 'pPickPhase', 'pSwS2Type'].forEach(id => {
    const e = document.getElementById(id);
    if (e) { e.addEventListener('change', syncSwissExtras); e.addEventListener('input', syncSwissExtras); }
  });

  const syncPerMatch = () => {
    const es = parseInt(ffaSize.value, 10);
    const maxL = Math.max(2, Math.floor(16 / es));
    document.getElementById('perMatchLabel').textContent = (es === 1 ? 'Players' : 'Teams') + ' per FFA lobby';
    const cur = parseInt(perMatch.value, 10) || Math.min(6, maxL);
    perMatch.innerHTML = '';
    for (let n = 2; n <= maxL; n++) {
      const players = es === 1 ? '' : ' (' + (n * es) + ' players)';
      perMatch.innerHTML += '<option value="' + n + '"' + (n === Math.min(cur, maxL) ? ' selected' : '') + '>' + n + players + '</option>';
    }
  };
  // Divisions: separate brackets for single or double elimination team events. How the teams get
  // into them depends on the formation, so the line under the choice says which.
  const syncDivOpts = () => {
    const box = document.getElementById('divOpts');
    if (!box) return;
    const allowed = comp.value === 'team' && (cBracket.value === 'single' || cBracket.value === 'double');
    box.style.display = allowed ? '' : 'none';
    const n = parseInt((document.getElementById('cDivisions') || {}).value, 10) || 0;
    const row = document.getElementById('divNamesRow');
    if (row) row.style.display = n > 1 ? 'flex' : 'none';
    document.querySelectorAll('[data-divnamebox]').forEach(el => { el.style.display = parseInt(el.dataset.divnamebox, 10) <= n ? '' : 'none'; });
    const how = document.getElementById('divHow');
    if (!how) return;
    if (n < 2) { how.textContent = 'Everyone plays in one bracket.'; return; }
    const nm = d => ((document.getElementById('cDivName' + d) || {}).value || '').trim() || DIVISION_DEFAULT_NAMES[d - 1];
    const draft = formation.value === 'draft' && size.value !== '1';
    how.textContent = draft
      ? 'The ' + nm(1) + ' captains draft first, and everyone they pick plays in the ' + nm(1) + ' bracket. Whoever is left is drafted into the ' + nm(2) + ' bracket by its own captains' + (n > 2 ? ', and so on down' : '') + '. You set how many captains each division gets on the Teams tab.'
      : 'When signups close, the teams are split by combined rating: the strongest into ' + nm(1) + ', the next into ' + nm(2) + (n > 2 ? ', and so on' : '') + '. You can move teams between divisions before the start. Each division plays its own bracket and has its own winner.';
  };

  const syncVis = () => {
    const isFfa = comp.value === 'ffa';
    document.getElementById('teamOpts').style.display = isFfa ? 'none' : '';
    document.getElementById('ffaOpts').style.display = isFfa ? '' : 'none';
    document.getElementById('formationWrap').style.display = size.value === '1' ? 'none' : '';
    document.getElementById('draftOrderWrap').style.display = (formation.value === 'draft' && size.value !== '1') ? '' : 'none';
    document.getElementById('planSingle').style.display = cBracket.value === 'single' ? '' : 'none';
    document.getElementById('planDouble').style.display = cBracket.value === 'double' ? '' : 'none';
    document.getElementById('planSwiss').style.display = cBracket.value === 'swiss' ? '' : 'none';
    syncSwissExtras();
    syncPickWhere();
    document.getElementById('ffaPointsOpts').style.display = ffaMode.value === 'points' ? '' : 'none';
    document.getElementById('ffaElimOpts').style.display = ffaMode.value === 'elim' ? '' : 'none';
    document.getElementById('cFfaCutTo').style.display = cutMode.value === '1' ? '' : 'none';
    document.getElementById('cFfaFinalSize').style.display = finalMode.value === '1' ? '' : 'none';
    syncDivOpts();
    syncPerMatch();
  };
  ['cDivisions', 'cDivName1', 'cDivName2', 'cDivName3', 'cDivName4'].forEach(id => {
    const e = document.getElementById(id);
    if (e) { e.addEventListener('change', syncDivOpts); e.addEventListener('input', syncDivOpts); }
  });
  comp.onchange = syncVis; size.onchange = syncVis; formation.onchange = syncVis;
  cBracket.onchange = syncVis; ffaSize.onchange = syncVis; ffaMode.onchange = syncVis;
  cutMode.onchange = syncVis; finalMode.onchange = syncVis;
  syncVis();

  // markdown toolbars for the two rich fields in the creation form
  const cDescTa = document.getElementById('cDesc');
  if (cDescTa) wireMdToolbar(cDescTa.previousElementSibling, cDescTa);
  // Images can't be uploaded yet - there is no tournament to attach them to. Hold each one as a
  // data URL behind a placeholder token, then upload and swap the tokens for real urls the moment
  // the tournament exists (see the create handler below).
  _pendingCreateImages = [];
  const deferredUploader = async (dataUrl) => {
    const token = 'pending-image-' + _pendingCreateImages.length;
    _pendingCreateImages.push({ token, dataUrl });
    return { url: token };
  };
  if (cDescTa) wireImagePaste(cDescTa, deferredUploader, document.getElementById('cDescImgBtn'), document.getElementById('cDescImgFile'));
  const cRwTa0 = document.getElementById('cRewards');
  if (cRwTa0) wireImagePaste(cRwTa0, deferredUploader, document.getElementById('cRwImgBtn'), document.getElementById('cRwImgFile'));
  const cSpTa0 = document.getElementById('cSponsors');
  if (cSpTa0) wireImagePaste(cSpTa0, deferredUploader, document.getElementById('cSpImgBtn'), document.getElementById('cSpImgFile'));
  const cLobbyTa0 = document.getElementById('cLobby');
  if (cLobbyTa0) wireImagePaste(cLobbyTa0, deferredUploader, null, null);
  const cLobbyTa = document.getElementById('cLobby');
  if (cLobbyTa) wireMdToolbar(cLobbyTa.previousElementSibling, cLobbyTa);
  const cModsTa = document.getElementById('cMods');
  if (cModsTa) wireMdToolbar(cModsTa.previousElementSibling, cModsTa);
  const cRewardsTa = document.getElementById('cRewards');
  if (cRewardsTa) wireMdToolbar(cRewardsTa.previousElementSibling, cRewardsTa);
  const cSponsorsTa = document.getElementById('cSponsors');
  if (cSponsorsTa) wireMdToolbar(cSponsorsTa.previousElementSibling, cSponsorsTa);
  const cVetoBox = document.getElementById('cVeto');
  const cVetoCfg = document.getElementById('cVetoCfg');
  if (cVetoBox && cVetoCfg) cVetoBox.onchange = () => { cVetoCfg.style.display = cVetoBox.checked ? '' : 'none'; };

  // livestream rows (same style as the Admin tab)
  const streamRows = document.getElementById('cStreamRows');
  const addStreamRow = (url, info) => {
    const div = document.createElement('div');
    div.className = 'row stream-row';
    div.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap';
    div.innerHTML = '<input type="text" class="stUrl" placeholder="https://twitch.tv/..." maxlength="300" style="flex:2;min-width:200px" autocomplete="off">'
      + '<input type="text" class="stInfo" placeholder="Info, e.g. Main stream (English)" maxlength="120" style="flex:2;min-width:200px" autocomplete="off">';
    if (url) div.querySelector('.stUrl').value = url;
    if (info) div.querySelector('.stInfo').value = info;
    streamRows.appendChild(div);
  };
  addStreamRow();
  document.getElementById('cStreamAdd').onclick = () => addStreamRow();

  // Format presets (LotS, Invitational). The server decides who may USE one - the picker only
  // reflects that decision, and the restricted entries are shown greyed rather than hidden so a
  // community organizer can see the format exists and why they cannot pick it.
  let _presets = [];
  (async () => {
    let r;
    try { r = await api('/api/presets'); } catch (e) { return; }
    _presets = (r && r.presets) || [];
    if (!_presets.length) return;
    const sel = document.getElementById('cPreset');
    const panel = document.getElementById('presetPanel');
    if (!sel || !panel) return;
    for (const p of _presets) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.allowed ? '' : ' \u2014 tournament directors only');
      o.disabled = !p.allowed;
      sel.appendChild(o);
    }
    panel.style.display = '';
    sel.onchange = () => applyPreset(sel.value);
  })();

  function applyPreset(id) {
    const info = document.getElementById('presetInfo');
    const p = _presets.find(x => x.id === id);
    if (!p) { if (info) info.style.display = 'none'; return; }
    if (!p.allowed || !p.apply) {
      if (info) {
        info.style.display = '';
        info.innerHTML = '<div class="mono small muted">RESTRICTED</div><div>' + esc(p.name)
          + ' can only be hosted by a global tournament director.</div>';
      }
      return;
    }
    const a = p.apply;
    const setv = (elId, v) => { const e = document.getElementById(elId); if (e != null && v != null) e.value = String(v); };
    const setc = (elId, v) => { const e = document.getElementById(elId); if (e) e.checked = !!v; };
    if (a.competition && comp) comp.value = a.competition;
    if (a.teamSize && size) size.value = String(a.teamSize);
    if (a.bracketType && cBracket) cBracket.value = a.bracketType;
    setv('cSeed', a.seeding); setv('cRatingType', a.ratingType);
    setv('cMaxTeams', a.maxTeams); setv('cSignupMode', a.signupMode);
    if (a.playerReporting !== undefined) setc('cPlayerReporting', a.playerReporting);
    // an official-only preset picks the category for you, and says so below
    setv('cCategory', 'official');
    const pl = a.plan || {};
    setv('pSwBo', pl.bo); setc('pSwFinal', pl.final); setv('pSwFinalBo', pl.finalBo); setc('pSwFast', pl.fast);
    setc('pSwCuts', pl.winCut || pl.lossCut);
    setv('pSwWinCut', pl.winCut || 3); setv('pSwLossCut', pl.lossCut || 3); setv('pSwDecBo', pl.decidingBo || 0);
    setc('pSwStage2', pl.stage2);
    setv('pSwS2Cut', pl.s2CutTo || 8); setv('pSwS2Type', pl.s2Type || 'single');
    setv('pSwS2Bo', pl.s2Bo || 3); setv('pSwS2Final', pl.s2Final || 5); setc('pSwS2Third', pl.s2Third);
    setc('pPickPhase', a.pickPhase); setv('pPickMins', a.pickMinutes || 0); setv('pPickMode', a.pickMode || 'half');
    setv('pTiebreak', a.tiebreak || 'gd');
    if (info) {
      info.style.display = '';
      info.innerHTML = '<div class="mono small muted">' + esc(p.name.toUpperCase()) + '</div>'
        + '<div style="margin:4px 0 0">' + esc(p.blurb) + '</div>'
        + (p.notes && p.notes.length
            ? '<ul class="muted small" style="margin:8px 0 0;padding-left:18px">'
              + p.notes.map(n => '<li style="margin:3px 0">' + esc(n) + '</li>').join('') + '</ul>'
            : '')
        + '<div class="muted small" style="margin:8px 0 0">Everything below is pre-filled and still editable \u2014 the preset is a starting point, not a lock.</div>';
    }
    syncVis();
    syncSwissExtras();
  }

  // Copy-from: list the tournaments this account organizes, then pre-fill on demand.
  const copySel = document.getElementById('cCopyFrom');
  (async () => {
    try {
      const r = await api('/api/my_tournaments');
      const list = (r.tournaments || []);
      if (!list.length) { document.getElementById('copyFromPanel').style.display = 'none'; return; }
      for (const t of list) {
        const o = document.createElement('option');
        o.value = t.id; o.textContent = t.name + (t.category ? ' (' + t.category + ')' : '');
        copySel.appendChild(o);
      }
    } catch (e) { document.getElementById('copyFromPanel').style.display = 'none'; }
  })();
  document.getElementById('cCopyBtn').onclick = async () => {
    const id = copySel.value;
    if (!id) return toast('Pick a tournament to copy from', true);
    let src;
    try { src = await api('/api/t/' + id + (siteAdmin() ? '?token=' + encodeURIComponent(siteAdmin()) : '')); }
    catch (e) { return toast(e.message, true); }
    prefillFromTournament(src);
    toast('Filled from "' + src.name + '" \u2014 review, then create. Maps are copied on the Maps tab afterwards.');
  };

  // Pre-fill every creation field from a source tournament EXCEPT event/signup dates.
  function prefillFromTournament(t) {
    const setv = (id, v) => { const el = document.getElementById(id); if (el != null && v != null) el.value = v; };
    const setc = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    setv('cName', t.name || '');
    setv('cDesc', t.description || ''); setv('cLobby', t.lobbyOptions || ''); setv('cMods', t.mods || '');
    setv('cRewards', t.rewards || ''); setv('cSponsors', t.sponsors || '');
    if (t.prize) { setv('cPrizeCur', t.prize.currency || ''); setv('cPrizeAmt', t.prize.amount != null ? t.prize.amount : ''); }
    if (document.getElementById('cCategory')) setv('cCategory', t.category || '');
    // copying a tournament is how the next edition of a series usually gets made, so inherit it.
    // The options may still be loading, so retry briefly rather than silently dropping it.
    if (t.seriesId) {
      const sel = document.getElementById('cSeries');
      if (sel) {
        const applySeries = (tries) => {
          if (Array.from(sel.options).some(o => o.value === t.seriesId)) { sel.value = t.seriesId; return; }
          if (tries > 0) setTimeout(() => applySeries(tries - 1), 150);
        };
        applySeries(10);
      }
    }
    setv('cRatingType', t.ratingType || 'none'); setv('cRatingDate', t.ratingDate ? new Date(t.ratingDate).toISOString().slice(0, 10) : '');
    setv('cSignupMode', t.signupMode || 'open'); setc('cPlayerReporting', t.playerReporting !== 0);
    setv('cMinRating', t.minRating != null ? t.minRating : ''); setv('cMaxRating', t.maxRating != null ? t.maxRating : '');
    setv('cMaxTeamRating', t.maxTeamRating != null ? t.maxTeamRating : ''); setv('cRatingCap', t.ratingCap != null ? t.ratingCap : '');
    setv('cMaxTeams', t.maxTeams || ''); setv('cMinTeams', t.minTeams || '');
    // competition / format
    if (comp) { comp.value = t.competition || 'team'; }
    if (t.competition === 'ffa') { if (ffaSize) ffaSize.value = t.teamSize; }
    else { if (size) size.value = t.teamSize; if (formation) formation.value = t.formation || 'draft'; if (cBracket) cBracket.value = t.bracketType || 'single'; }
    setv('cDraftOrder', t.draftOrder || 'linear');
    setv('cSeed', t.seeding || '');
    setv('cDivisions', String(t.divisions || 0));
    for (let d = 1; d <= 4; d++) setv('cDivName' + d, ((t.divisionNamesSet || [])[d - 1]) || '');
    setc('pPickPhase', t.pickOpponents); setv('pPickMins', t.pickMinutes || 0); setv('pPickMode', t.pickMode || 'half');
    setv('pTiebreak', t.tiebreak || 'gd');
    setc('pStopOn', t.stopAtAlive); setv('pStopAt', t.stopAtAlive || 4);
    // plan / Bo
    const pl = t.plan || {};
    if (t.bracketType === 'single') { setv('pEarly', pl.early); setv('pSemi', pl.semi); setv('pFinal', pl.final); setc('pThird', pl.thirdPlace); }
    else if (t.bracketType === 'double') { setv('pWb', pl.wb); setv('pWbFinal', pl.wbFinal); setv('pLb', pl.lb); setv('pLbFinal', pl.lbFinal); setv('pGf', pl.gf); setc('pHcap', pl.lbHandicap); }
    else if (t.bracketType === 'swiss') {
      setv('pSwBo', pl.bo); setc('pSwFinal', pl.final); setv('pSwFinalBo', pl.finalBo); setc('pSwFast', pl.fast);
      setc('pSwCuts', pl.winCut || pl.lossCut); setv('pSwWinCut', pl.winCut || 3); setv('pSwLossCut', pl.lossCut || 3);
      setv('pSwDecBo', pl.decidingBo || 0);
      setc('pSwStage2', pl.stage2); setv('pSwS2Cut', pl.s2CutTo || 8); setv('pSwS2Type', pl.s2Type || 'single');
      setv('pSwS2Bo', pl.s2Bo || 3); setv('pSwS2Final', pl.s2Final || 5); setc('pSwS2Third', pl.s2Third);
      syncSwissExtras();
    }
    if (t.competition === 'ffa' && t.ffa) {
      setv('cAdvance', t.ffa.advance); setv('cFfaRounds', t.ffa.rounds);
      if (perMatch) perMatch.value = t.ffa.perMatch; if (ffaMode) ffaMode.value = t.ffa.mode || 'elim';
    }
    // veto config (not the maps themselves)
    if (t.veto) { setc('cVeto', t.veto.enabled); setv('cVetoMode', t.veto.mode || 'upfront'); setv('cVetoAb', t.veto.abMode || 'lowerA'); if (cVetoCfg) cVetoCfg.style.display = t.veto.enabled ? '' : 'none'; }
    // Livestream links are deliberately NOT copied: they name the specific streamers and
    // co-casters of that edition, so carrying them to a new tournament credits the wrong people.
    streamRows.innerHTML = '';
    addStreamRow();
    // rich previews / dependent selects
    if (cDescTa) cDescTa.dispatchEvent(new Event('input'));
    syncVis();
  }

  // Multi-day picker, two-way bound to the native date input above it: typing a date there
  // makes that the single selected day, and picking days here writes the earliest back.
  let _cDayPick = null;
  {
    const dateEl = document.getElementById('cDate');
    const host = document.getElementById('cDayPick');
    if (dateEl && host) {
      _cDayPick = mountDayPicker(host, {
        days: dateEl.value ? [dateEl.value] : [],
        onChange: (days) => { if (days.length) dateEl.value = days[0]; }
      });
      dateEl.addEventListener('change', () => _cDayPick.setSingle(dateEl.value));
    }
  }

  document.getElementById('cGo').onclick = async () => {
    const presetSel = document.getElementById('cPreset');
    const presetId = presetSel ? presetSel.value : '';
    const name = document.getElementById('cName').value.trim();
    if (!name) return toast('Give the tournament a name', true);
    const category = document.getElementById('cCategory').value;
    if (!category) return toast('Choose whether this is an Official or Community tournament', true);
    const isFfa = comp.value === 'ffa';
    const bt = cBracket.value;
    let plan = {};
    if (bt === 'single') plan = { early: pv('pEarly'), semi: pv('pSemi'), final: pv('pFinal'), thirdPlace: (document.getElementById('pThird') || {}).checked ? 1 : 0 };
    else if (bt === 'double') plan = { wb: pv('pWb'), wbFinal: pv('pWbFinal'), lb: pv('pLb'), lbFinal: pv('pLbFinal'), gf: pv('pGf'), lbHandicap: document.getElementById('pHcap').checked };
    else {
      const ck = id => { const e = document.getElementById(id); return !!(e && e.checked); };
      plan = { bo: pv('pSwBo'), final: ck('pSwFinal'), finalBo: pv('pSwFinalBo'), fast: ck('pSwFast') };
      if (ck('pSwCuts')) { plan.winCut = pv('pSwWinCut'); plan.lossCut = pv('pSwLossCut'); plan.decidingBo = pv('pSwDecBo'); }
      if (ck('pSwStage2')) {
        plan.stage2 = 1; plan.s2CutTo = pv('pSwS2Cut'); plan.s2Type = document.getElementById('pSwS2Type').value;
        plan.s2Bo = pv('pSwS2Bo'); plan.s2Final = pv('pSwS2Final'); plan.s2Gf = pv('pSwS2Final');
        plan.s2Third = (plan.s2Type !== 'double' && ck('pSwS2Third')) ? 1 : 0;
      }
    }
    try {
      const stopOn = (document.getElementById('pStopOn') || {}).checked ? 1 : 0;
      const pickOn = (document.getElementById('pPickPhase') || {}).checked ? 1 : 0;
      const r = await api('/api/tournaments', {
        name,
        presetId: presetId || '',
        pickOpponents: pickOn,
        pickMinutes: pickOn ? pv('pPickMins') : 0,
        pickMode: (document.getElementById('pPickMode') || {}).value || 'half',
        tiebreak: bt === 'swiss' ? ((document.getElementById('pTiebreak') || {}).value || 'gd') : 'gd',
        stopAtAlive: stopOn ? pv('pStopAt') : 0,
        description: document.getElementById('cDesc').value,
        category,
        seriesId: (document.getElementById('cSeries') || {}).value || '',
        lobbyOptions: document.getElementById('cLobby').value,
        mods: document.getElementById('cMods').value,
        competition: comp.value,
        teamSize: isFfa ? ffaSize.value : size.value,
        formation: formation.value,
        draftOrder: document.getElementById('cDraftOrder').value,
        bracketType: bt,
        plan,
        divisions: (!isFfa && (bt === 'single' || bt === 'double')) ? ((document.getElementById('cDivisions') || {}).value || 0) : 0,
        divisionNames: [1, 2, 3, 4].map(d => ((document.getElementById('cDivName' + d) || {}).value || '').trim()),
        maxTeams: document.getElementById('cMaxTeams').value,
        minTeams: document.getElementById('cMinTeams').value,
        perMatch: perMatch.value,
        advance: ffaMode.value === 'elim' ? document.getElementById('cAdvance').value : 1,
        mode: ffaMode.value,
        rounds: document.getElementById('cFfaRounds').value,
        cutTo: cutMode.value === '1' ? document.getElementById('cFfaCutTo').value : 0,
        finalSize: finalMode.value === '1' ? document.getElementById('cFfaFinalSize').value : 0,
        seeding: document.getElementById('cSeed').value,
        ratingType: document.getElementById('cRatingType').value,
        ratingDate: document.getElementById('cRatingDate').value || null,
        signupMode: document.getElementById('cSignupMode').value,
        playerReporting: document.getElementById('cPlayerReporting').checked ? 1 : 0,
        admin: siteAdmin() || undefined,
        rewards: document.getElementById('cRewards').value,
        prizeCurrency: document.getElementById('cPrizeCur').value,
        prizeAmount: document.getElementById('cPrizeAmt').value,
        sponsors: document.getElementById('cSponsors').value,
        streams: Array.from(document.querySelectorAll('#cStreamRows .stream-row')).map(r => ({ url: r.querySelector('.stUrl').value.trim(), info: r.querySelector('.stInfo').value.trim() })).filter(x => x.url),
        veto: { enabled: document.getElementById('cVeto').checked, mode: document.getElementById('cVetoMode').value, abMode: document.getElementById('cVetoAb').value },
        eventDate: combineDateTimeUTC(document.getElementById('cDate'), document.getElementById('cTime')),
        eventDays: _cDayPick ? _cDayPick.get() : [],
        signupOpensAt: combineDateTimeUTC(document.getElementById('cSuDate'), document.getElementById('cSuTime')),
        signupClosesAt: combineDateTimeUTC(document.getElementById('cScDate'), document.getElementById('cScTime')),
        checkInDeadline: combineDateTimeUTC(document.getElementById('cCiDate'), document.getElementById('cCiTime')),
        minRating: document.getElementById('cMinRating').value,
        maxRating: document.getElementById('cMaxRating').value,
        maxTeamRating: document.getElementById('cMaxTeamRating').value,
        ratingCap: document.getElementById('cRatingCap').value
      });
      localStorage.setItem('admin_' + r.id, r.adminToken);
      // Now the tournament exists, so any images pasted during setup can finally be uploaded and
      // their placeholders swapped for real urls. A failure here is not fatal: the tournament is
      // already created, so we tell the organizer rather than losing their work.
      if (_pendingCreateImages.length) {
        const map = {};
        let failed = 0;
        for (const p of _pendingCreateImages) {
          try {
            const d = await api('/api/t/' + r.id + '/add_desc_image', { image: p.dataUrl, admin: r.adminToken });
            map[p.token] = d.url;
          } catch (e) { failed++; }
        }
        const swap = (s) => String(s || '').replace(/pending-image-\d+/g, tk => map[tk] || tk);
        try {
          await api('/api/t/' + r.id + '/edit_info', {
            admin: r.adminToken,
            description: swap(document.getElementById('cDesc').value),
            rewards: swap(document.getElementById('cRewards').value),
            sponsors: swap(document.getElementById('cSponsors').value),
            lobbyOptions: swap(document.getElementById('cLobby').value)
          });
        } catch (e) { failed++; }
        if (failed) toast(failed + ' image(s) could not be attached — add them again on the Admin tab', true);
        _pendingCreateImages = [];
      }
      history.pushState(null, '', '/t/' + r.id);
      route();
      toast('Tournament created — you are the organizer on this browser');
    } catch (e) { toast(e.message, true); }
  };

}

// ---------- tournament shell ----------

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function formHasFocus() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && app.contains(a);
}

async function loadTournament() {
  const tok = viewToken();
  T = await api('/api/t/' + tourneyId() + (tok ? '?token=' + encodeURIComponent(tok) : ''));
}

// Organizer links no longer exist - co-organizers are added by FAF name in the Organizers panel.
// Old ones are still out there in Discord history, and used to make whoever opened one an organizer
// automatically. Now the server refuses them, so say why here rather than fail silently.
async function maybePromptOrganizerClaim() {
  const claim = pendingOrganizerClaim;
  if (!claim || claim.id !== tourneyId()) return;
  pendingOrganizerClaim = null;
  if (viewerIsOrganizer()) return;          // already one - the link changes nothing
  modal(`<h3>Organizer links are no longer used</h3>
    <p class="muted small">This link used to make whoever opened it an organizer of <strong>${esc(T.name)}</strong>. It does nothing now.</p>
    <p class="muted small">If you should be organizing this tournament, ask one of its organizers to add you in the <strong>Organizers</strong> panel on the Admin tab, by your FAF name.</p>
    <div class="actions"><button class="btn primary" id="ocOk">OK</button></div>`, root => {
    root.querySelector('#ocOk').onclick = closeModal;
  });
}

// When someone opens a late-signup link (?late=), confirm they want to sign up late.
function maybePromptLateSignup() {
  const late = pendingLateSignup;
  if (!late || late.id !== tourneyId()) return;
  pendingLateSignup = null;
  if (viewerSignedUp()) return; // already in
  if (fafAuth.enabled && !isFafVerified()) {
    modal(`<h3>Late signup</h3>
      <p class="muted small">Log in with FAF to sign up to <strong>${esc(T.name)}</strong> as a late entry.</p>
      <div class="actions"><button class="btn ghost" id="lsCancel">Cancel</button><button class="btn faf" id="lsLogin">Log in with FAF</button></div>`, root => {
      root.querySelector('#lsCancel').onclick = closeModal;
      root.querySelector('#lsLogin').onclick = () => {
        location.href = '/auth/faf/login?returnTo=' + encodeURIComponent('/t/' + late.id + '?late=' + late.token);
      };
    });
    return;
  }
  const autoRated = fafAuth.enabled && T.ratingType && T.ratingType !== 'none';
  const ratingInfo = autoRated
    ? '<p class="muted small">Your <strong>' + esc(ratingTypeLabel(T.ratingType)) + '</strong> rating will be pulled from FAF automatically' + (T.ratingDate ? ' as of <strong>' + new Date(T.ratingDate).toLocaleDateString() + '</strong>' : '') + ' \u2014 you don\u2019t enter it.</p>'
    : '<p class="muted small">Enter your FAF rating:</p><input type="number" id="lsRating" min="0" max="4000" placeholder="e.g. 1500" style="width:140px">';
  modal(`<h3>Sign up as a late entry?</h3>
    <p>Do you want to sign up to <strong>${esc(T.name)}</strong> as a late signup?</p>
    <p class="muted small">Signups are closed, but this link lets you join${fafAuth.enabled ? ' as <strong>' + esc(me()) + '</strong>' : ''}.</p>
    ${ratingInfo}
    <div class="actions"><button class="btn ghost" id="lsNo">Cancel</button><button class="btn primary" id="lsYes">Sign up</button></div>`, root => {
    root.querySelector('#lsNo').onclick = closeModal;
    root.querySelector('#lsYes').onclick = async () => {
      const body = { lateToken: late.token };
      if (!autoRated) {
        const rEl = root.querySelector('#lsRating');
        const rating = rEl ? rEl.value : '';
        if (rating === '') return toast('Enter your rating', true);
        body.rating = rating;
      }
      if (!fafAuth.enabled) { const nm = prompt('Your FAF name:'); if (!nm) return; body.name = nm; }
      try {
        await api('/api/t/' + late.id + '/signup', body);
        closeModal();
        toast('Signed up as a late entry');
        maybeRemindDiscord();
        await refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
}

async function renderTournament() {
  captureTokensFromURL();
  loadRevealed();
  try { await loadTournament(); }
  catch (e) {
    app.innerHTML = '<div class="page"><div class="panel"><div class="empty">Tournament not found.</div><a href="/">← Back</a></div></div>';
    return;
  }
  drawTopbar(viewerIsOrganizer() ? 'ORGANIZER' : (T.viewer && T.viewer.caster ? 'CASTER' : ''));
  maybeAutoStreamerMode();
  lastSnapshot = JSON.stringify(T);
  drawTournament();
  // A chat pinned before a reload comes back only now, with T loaded, so a match that finished
  // in the meantime is dropped instead of being restored as a dead panel.
  if (typeof restorePinnedChat === 'function') restorePinnedChat();
  maybePromptOrganizerClaim();
  maybePromptLateSignup();
  stopPoll();
  // A background tab polls nobody: it costs the server bandwidth and shows no one anything.
  pollTimer = setInterval(() => { if (!document.hidden) pollOnce(); }, 4000);
}

// One poll pass. Also fired the moment a hidden tab becomes visible again, so the pause below
// can never leave someone looking at a stale bracket.
async function pollOnce() {
  if (!tourneyId()) return;
  if (document.getElementById('modalRoot').innerHTML) return;   // modal open
  if (formHasFocus()) return;                                    // user is typing
  try {
    const tok = viewToken();
    const fresh = await api('/api/t/' + tourneyId() + (tok ? '?token=' + encodeURIComponent(tok) : ''));
    const snap = JSON.stringify(fresh);
    if (snap === lastSnapshot) return;                           // nothing changed
    T = fresh;
    lastSnapshot = snap;
    // Fresh data may mean the pinned match just finished. Check before the early return below,
    // which would otherwise leave the rail open on the chat tab until the next tab switch.
    if (typeof syncPinnedChat === 'function') syncPinnedChat();
    // The chat tab manages its own live updates and remembers the open room; a full redraw here
    // would rebuild the room list and yank the user back to Global. Keep data fresh, don't repaint.
    if (currentTab === 'chat') return;
    drawTournament();
  } catch (e) {}
}

// ---- "it's your turn" banner ----
// Surfaces the two things a player can be on the clock for: a draft pick, or a veto step.
// Returns { text, tab, cta } or null.
function myTurnInfo() {
  const me = T.viewer || {};
  const myTeam = me.teamId || null;
  // score submissions awaiting MY team's confirmation
  const memberTeam = me.memberTeamId || me.teamId;
  if (memberTeam && T.matches) {
    const pm = T.matches.find(m => m.pendingReport && (m.pendingReport.byTeam === m.team1 ? m.team2 : m.team1) === memberTeam && m.pendingReport.byTeam !== memberTeam);
    if (pm) return { text: 'Your opponent reported ' + pm.pendingReport.score1 + '\u2013' + pm.pendingReport.score2 + ' \u2014 confirm or reject it.', tab: bracketTabFor(pm), cta: 'Review score' };
  }
  // organizer: signup requests waiting
  if (me.organizer && T.status === 'signup') {
    const nReq = (T.players || []).filter(p => p.pending).length;
    if (nReq) return { text: nReq + ' signup request' + (nReq === 1 ? '' : 's') + ' await your review.', tab: 'players', cta: 'Review requests' };
  }
  // 0. join requests awaiting the captain
  if (myTeam && T.status === 'signup' && T.teams) {
    const capT = T.teams.find(x => x.id === myTeam);
    if (capT && (capT.joinRequests || []).length) {
      const n = capT.joinRequests.length;
      return { text: n + ' player' + (n === 1 ? '' : 's') + ' want to join your team — accept or decline.', tab: 'teams', cta: 'Review requests' };
    }
  }
  // 0a. your opponent pick. This outranks almost everything: the whole bracket is waiting on it.
  if (T.picks && T.picks.status === 'open') {
    if (T.picks.myTurn) {
      const left = T.picks.msLeft;
      const clock = left != null ? ' You have ' + Math.max(1, Math.round(left / 60000)) + ' minute(s) left.' : '';
      return { text: 'Choose your opponent \u2014 it is your pick.' + clock, tab: 'bracket', cta: 'Pick opponent' };
    }
    if (viewerIsOrganizer()) {
      const nm = (T.teams || []).find(x => x.id === T.picks.turn);
      return { text: 'Waiting on ' + ((nm && nm.name) || 'a seed') + ' to choose their opponent.', tab: 'bracket', cta: 'View picks' };
    }
  }
  // 1. captain's draft pick
  if (T.status === 'draft' && T.draft && T.draft.order && !T.draft.waiting) {
    const turnTeam = T.draft.order[T.draft.current];
    if (turnTeam && myTeam && turnTeam === myTeam) {
      return { text: "It's your pick — choose a player for your team.", tab: 'teams', cta: 'Go to the draft' };
    }
  }
  // 1. anyone: you were @mentioned in a chat
  if ((T.myMentionCount || 0) > 0) {
    const n = T.myMentionCount;
    return {
      text: n === 1 ? 'Someone mentioned you in chat.' : 'You were mentioned in ' + n + ' chats.',
      tab: 'chat', cta: 'Open chat'
    };
  }
  // 1a. organizer: someone has flagged a chat for attention
  if (viewerIsOrganizer() && (T.chatPingCount || 0) > 0) {
    const n = T.chatPingCount;
    return {
      text: n === 1 ? 'A player is asking for an organizer in chat.' : n + ' chats are asking for an organizer.',
      tab: 'chat', cta: 'Open chat'
    };
  }
  // 1b. organizer: vetoes are blocked until A/B is set (manual mode)
  if (viewerIsOrganizer() && T.veto && T.veto.enabled && T.veto.abMode === 'manual' && T.matches) {
    const waiting = T.matches.filter(m => m.veto && !m.veto.done && m.status !== 'done' && (!m.veto.teamA || !m.veto.teamB)).length;
    if (waiting > 0) {
      return {
        text: waiting + ' match' + (waiting === 1 ? '' : 'es') + ' need Team A / Team B set before the captains can veto.',
        tab: 'vetoes', cta: 'Set them now'
      };
    }
  }
  // 2. map veto step
  if (myTeam && T.matches) {
    for (const m of T.matches) {
      const v = m.veto;
      if (!v || v.done) continue;
      // The match already has a result (forfeit, or an organizer entered the score), so this
      // veto is dead even if older stored data still has done:false on it.
      if (m.status === 'done') continue;
      if (!v.teamA || !v.teamB) continue; // organizer hasn't set A/B yet
      const step = v.sequence[v.stepIndex];
      if (!step) continue;
      const turnTeam = step.team === 'A' ? v.teamA : v.teamB;
      if (turnTeam !== myTeam) continue;
      const opp = teamName(m.team1 === myTeam ? m.team2 : m.team1);
      return {
        text: "It's your turn to " + (step.action === 'ban' ? 'ban' : 'pick') + ' a map vs ' + opp + '.',
        tab: 'vetoes', cta: 'Go to the veto'
      };
    }
  }
  // 3. faction veto choices. Ranked just under the map veto because the map veto blocks the
  // whole match while a faction choice blocks one game, but it belongs here for the same
  // reason: only that player can do it, and until now literally nothing told them so.
  if (myTeam && T.matches && typeof myFactionTurnsAll === 'function') {
    const owed = myFactionTurnsAll();
    if (owed.length) {
      const steps = owed.reduce((n, x) => n + x.ft.games, 0);
      const m = owed[0].m;
      const opp = teamName(m.team1 === myTeam ? m.team2 : m.team1);
      const verb = owed[0].ft.next.action === 'ban' ? 'ban' : 'pick';
      return {
        text: steps === 1
          ? "It's your turn to " + verb + ' a faction vs ' + opp + '.'
          : 'You still need to set your factions for ' + steps + ' games' + (owed.length === 1 ? ' vs ' + opp : '') + '.',
        tab: 'vetoes', cta: 'Go to the faction veto'
      };
    }
  }
  return null;
}

function turnBannerHTML() {
  const info = myTurnInfo();
  if (!info) return '';
  return `<div class="turn-banner" id="turnBanner">
    <span class="turn-dot"></span>
    <span class="turn-text">${esc(info.text)}</span>
    <button class="btn primary small" data-turn-tab="${info.tab}">${esc(info.cta)}</button>
  </div>`;
}

function drawTournament() {
  setTitle(T && T.name);
  // flag the browser tab too, so it's noticeable when the site isn't in focus
  if (T && myTurnInfo()) document.title = '\u25cf ' + document.title;
  const admin = viewerIsOrganizer();
  const phaseIdx = { signup: 0, draft: 1, drafted: 1, running: 2, finished: 3 }[T.status];
  const midStep = T.competition === 'ffa' ? 'Teams' : (T.formation === 'draft' ? 'Draft' : 'Teams');
  // A Swiss is its rounds until its playoffs exist; then the step, like the tab, is the bracket.
  const lastStep = T.bracketType === 'swiss' ? bracketTabName(T) : (divisionsOnT() ? 'Brackets' : 'Bracket');
  const steps = ['Signups', midStep, lastStep, 'Results'];

  const tabs = ['overview', 'news', 'chat', 'players', 'teams', 'bracket'];
  // King / Prince: one bracket tab per division
  if (divisionsOnT()) for (let d = 2; d <= T.divisions; d++) tabs.push(divisionTab(d));
  // Vetoes tab appears once the bracket is running and vetoes are enabled - EITHER kind.
  // Faction vetoes are configured independently of map vetoes (`fveto_config` never looks at
  // `t.veto`), so a 1v1 with faction vetoes on and map vetoes off used to render no Vetoes tab
  // at all: the players had nowhere to go and no idea they owed anything.
  const vetoRunning = (T.status === 'running' || T.status === 'finished');
  const vetoActive = vetoRunning && (
    (T.veto && T.veto.enabled && T.matches.some(m => m.veto)) ||
    (T.fveto && T.fveto.enabled && T.matches.some(m => m.fveto))
  );
  if (!(T.viewer && (T.viewer.organizer || T.viewer.signedUpPlayerId || T.viewer.memberTeamId || T.viewer.caster))) {
    const ci = tabs.indexOf('chat'); if (ci >= 0) tabs.splice(ci, 1);
  }
  // Matches: a flat, observer/streamer-friendly list of every match. Only useful once the
  // bracket exists, so it appears alongside it.
  if ((T.matches || []).length) tabs.push('matches');
  // Stats: a public wrap-up, only once the tournament is over.
  if (T.status === 'finished') tabs.push('stats');
  if (vetoActive) tabs.push('vetoes');
  // Predictions: open to everyone logged in until the first match, the leaderboard after that.
  if (typeof predictTabVisible === 'function' && predictTabVisible()) tabs.push('predictions');
  // Maps tab: always available (useful overview of maps and where they're played)
  tabs.push('maps');
  tabs.push('standings');
  if (admin) { tabs.push('admin'); tabs.push('log'); }
  if (!tabs.includes(currentTab)) currentTab = 'overview';

  const tabLabel = tb => {
    if (tb === 'news') return 'News';
    if (tb === 'chat') return 'Chat';
    if (tb === 'log') return 'Log';
    if (tb === 'teams' && T.status === 'draft') return 'Draft';
    if (isBracketTab(tb) && divisionsOnT()) return divisionNameOf(tabDivision(tb)) + ' bracket';
    if (tb === 'bracket') return bracketTabName(T);
    if (tb === 'vetoes') {
      const pending = T.matches.filter(m => m.veto && !m.veto.done).length;
      return pending > 0 ? 'Vetoes (' + pending + ')' : 'Vetoes';
    }
    if (tb === 'predictions') return 'Predictions';
    return tb;
  };

  app.innerHTML = `
    <div class="page">
      <div class="headrow">
        <div>
          <h1>${esc(T.name)}</h1>
          <div class="muted small">${T.category ? '<span class="idbadge ' + (T.category === 'official' ? 'verified' : 'late') + '" style="margin-right:6px">' + T.category.toUpperCase() + '</span>' : ''}${esc(typeLine(T))}${eventDaysLabel(T) ? ' \u00b7 <span class="tdays" title="Days this event runs on">' + esc(eventDaysLabel(T)) + '</span>' : ''}</div>
        </div>
        <div class="headrow-right">
          ${viewerHasRights() ? `<button class="btn ghost small streamer-toggle ${playerViewMode ? 'on' : ''}" id="playerViewToggle" title="Hide organizer &amp; admin controls and browse as a regular player.${hotkeyFor('playerview') ? ' Shortcut: ' + hotkeyFor('playerview') + '.' : ''} Doesn't change your actual permissions.">${playerViewMode ? '\u25C9' : '\u25CB'} View as player</button>` : ''}
          <button class="btn ghost small streamer-toggle ${showPlayerNames ? 'on' : ''}" id="namesToggle" title="Show each team's players in the bracket instead of the team name.${hotkeyFor('players') ? ' Shortcut: ' + hotkeyFor('players') + '.' : ''} Only affects your own screen.">${showPlayerNames ? '\u25C9' : '\u25CB'} Show players</button>
          <button class="btn ghost small streamer-toggle ${streamerMode ? 'on' : ''}" id="streamerToggle" title="Hide match results and who's eliminated, for on-stream reveals.${hotkeyFor('streamer') ? ' Shortcut: ' + hotkeyFor('streamer') + '.' : ''} Only affects your own screen.">${streamerMode ? '\u25C9' : '\u25CB'} Streamer mode</button>
          <span class="pill ${statusPillClass(T)}"${signupsNotOpenYet(T) ? ' title="Signups open ' + esc(fmtDateTime(T.signupOpensAt)) + '"' : ''}>${esc(statusPillLabel(T))}</span>
        </div>
      </div>
      <div class="stepper" title="The tournament's progress through its stages">
        <span class="stepper-label">Stage</span>
        ${steps.map((s, i) => `<div class="step ${i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}" title="${i < phaseIdx ? 'Completed' : i === phaseIdx ? 'Current stage' : 'Upcoming'}">${s}</div>`).join('<span class="step-arrow">\u25B8</span>')}
      </div>
      <div class="tabs">
        ${tabs.map(tb => {
          let badge = (tb === 'news' && tb !== currentTab) ? newsUnreadCount() : 0;
          if (tb === 'chat' && tb !== currentTab && (T.myUnreadCount || 0) > 0) badge = { quiet: T.myUnreadCount };
          if (tb === 'chat' && tb !== currentTab && (T.myMentionCount || 0) > 0) badge = T.myMentionCount;
          if (tb === 'chat' && viewerIsOrganizer() && (T.chatPingCount || 0) > 0) badge = '\uD83D\uDD14' + T.chatPingCount;
          // Veto steps waiting on YOU, of either kind. Deliberately shown even while the tab is
          // open, unlike the unread badges: opening the tab reads a chat, but it does not do a
          // veto. The "(n)" in the label counts everyone's outstanding map vetoes; this counts
          // only what you personally still owe, which is the number a player actually needs.
          if (tb === 'vetoes' && typeof myVetoStepCount === 'function') {
            const owed = myVetoStepCount();
            if (owed > 0) badge = owed;
          }
          // an open prediction stage this viewer has not filled in yet
          if (tb === 'predictions' && tb !== currentTab && typeof predictBadgeCount === 'function') {
            const n = predictBadgeCount();
            if (n > 0) badge = { quiet: n };
          }
          const badgeHtml = !badge ? ''
            : (typeof badge === 'object'
                ? '<span class="tab-badge quiet">' + (badge.quiet > 9 ? '9+' : badge.quiet) + '</span>'
                : '<span class="tab-badge">' + badge + '</span>');
          return `<button class="tab ${tb === currentTab ? 'active' : ''}" data-tab="${tb}">${esc(tabLabel(tb))}${badgeHtml}</button>`;
        }).join('')}
      </div>
      ${admin && !T.published ? `<div class="panel" style="border-color:var(--amber);margin-top:12px">
        <strong>Draft — not public yet.</strong>
        <p class="muted small" style="margin:6px 0 10px">Only people with the link below can see this. Publish it to list it on the home page and open it up.</p>
        <div class="copybox"><input type="text" readonly value="${location.origin}/t/${T.id}"><button class="btn small" data-copy="${location.origin}/t/${T.id}">Copy share link</button></div>
        ${T.publishAt ? `<div class="pub-sched"><span>\u23F1 Scheduled to publish automatically on <strong>${esc(fmtDateTime(T.publishAt))}</strong></span>
          <button class="btn ghost small" id="pubCancel">Cancel schedule</button></div>` : ''}
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <button class="btn primary" id="pubBtn">Publish now</button>
          <div>
            <label class="muted small" style="display:block">Or schedule (UTC)</label>
            <div style="display:flex;gap:6px">
              <input type="date" id="pubDate"><input type="time" id="pubTime">
              <button class="btn ghost" id="pubSchedBtn">Schedule</button>
            </div>
          </div>
        </div>
      </div>` : ''}
    </div>
    <div id="tabBody" class="${isBracketTab(currentTab) && T.competition !== 'ffa' && T.bracketType !== 'swiss' ? 'widepage' : 'page'}"></div>`;

  if (typeof stopChatPoll === 'function' && currentTab !== 'chat') stopChatPoll();
  app.querySelectorAll('.tab').forEach(b => b.onclick = () => { if (typeof stopChatPoll === 'function') stopChatPoll(); currentTab = b.dataset.tab; syncTabURL(); drawTournament(); });
  const nmBtn = app.querySelector('#namesToggle');
  if (nmBtn) nmBtn.onclick = () => { setShowPlayerNames(!showPlayerNames); drawTournament(); };
  const stBtn = app.querySelector('#streamerToggle');
  if (stBtn) stBtn.onclick = () => { setStreamerMode(!streamerMode); drawTournament(); };
  const pvBtn = app.querySelector('#playerViewToggle');
  if (pvBtn) pvBtn.onclick = () => { setPlayerViewMode(!playerViewMode); drawTournament(); };

  const pubBtn = document.getElementById('pubBtn');
  if (pubBtn) pubBtn.onclick = async () => {
    if (!confirm('Publish this tournament? It will appear on the public home page for everyone.')) return;
    try { await api('/api/t/' + T.id + '/publish', { admin: adminToken() }); toast('Published'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  const pubSched = document.getElementById('pubSchedBtn');
  if (pubSched) pubSched.onclick = async () => {
    const dEl = document.getElementById('pubDate'), tEl = document.getElementById('pubTime');
    if (!dEl.value) return toast('Pick a date', true);
    const iso = combineDateTimeUTC(dEl, tEl);
    if (!iso) return toast('Invalid date/time', true);
    try {
      await api('/api/t/' + T.id + '/publish', { publishAt: iso, admin: adminToken() });
      toast('Publish scheduled'); await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const pubCancel = document.getElementById('pubCancel');
  if (pubCancel) pubCancel.onclick = async () => {
    try { await api('/api/t/' + T.id + '/publish', { cancelSchedule: 1, admin: adminToken() }); toast('Schedule cancelled'); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied')));
  app.querySelectorAll('[data-serieslink]').forEach(a => a.onclick = (e) => { e.preventDefault(); nav(a.getAttribute('href')); });

  // "your turn" banner, above whatever tab is open
  const banner = turnBannerHTML();
  if (banner) {
    const host = document.createElement('div');
    host.className = isBracketTab(currentTab) && T.competition !== 'ffa' && T.bracketType !== 'swiss' ? 'widepage' : 'page';
    host.style.paddingBottom = '0';
    host.innerHTML = banner;
    const tb = app.querySelector('#tabBody');
    tb.parentNode.insertBefore(host, tb);
    const go = host.querySelector('[data-turn-tab]');
    if (go) go.onclick = () => { currentTab = go.dataset.turnTab; syncTabURL(); drawTournament(); };
  }

  const body = document.getElementById('tabBody');
  if (currentTab === 'overview') drawOverview(body);
  else if (currentTab === 'news') drawNews(body);
  else if (currentTab === 'chat') drawChatTab(body);
  else if (currentTab === 'log') drawTlog(body);
  else if (currentTab === 'players') drawPlayers(body);
  else if (currentTab === 'teams') drawTeams(body);
  else if (isBracketTab(currentTab)) drawBracket(body, divisionsOnT() ? tabDivision(currentTab) : 0);
  else if (currentTab === 'matches') drawMatchesTab(body);
  else if (currentTab === 'stats') drawStats(body);
  else if (currentTab === 'vetoes') drawVetoes(body);
  else if (currentTab === 'predictions') drawPredictions(body);
  else if (currentTab === 'maps') drawMaps(body);
  else if (currentTab === 'standings') drawStandings(body);
  else if (currentTab === 'admin') drawAdmin(body);

  // The redraw has just rebuilt every pin button on the page; repaint them from the pin state,
  // and drop the rail if this redraw is the one that finished the pinned match.
  if (typeof syncPinnedChat === 'function') syncPinnedChat();
}

// ----- overview -----

function gameInfoPanel() {
  // Type + rating are one-liners: fixed text above the boxes, not boxes of their own.
  const typeTxt = T.category ? (T.category === 'official' ? 'Official' : 'Community') + ' tournament' : '';
  // The rating source used to live only in this grey headline, where it read as boilerplate.
  // It is now the first line of the Rating requirements cell instead - see ratingReqHtml below.
  const headline = typeTxt;
  // Format + rating requirements are always short — put them in a compact top row of their
  // own so they don't get stretched by a long Lobby options block underneath.
  // Entries are [label, HTML] - each pusher escapes its own text. They used to be plain strings
  // escaped at render time, which left nowhere to put the bold rating source.
  const topCells = [];
  topCells.push(['Format', esc(typeLine(T)) + '\n' + esc(planSummary(T))]);
  // Multi-day events: spell the days out. Advertising a two-weekend event as one 9-day block
  // reads as "we play midweek too" and puts entrants off, which is why this exists.
  if (eventDaysLabel(T)) {
    topCells.push(['Schedule', '<strong>' + esc(eventDaysLabel(T)) + '</strong>\n'
      + esc(eventDaysCountLabel(T)) + ' \u2014 no play on the days in between'
      + (T.eventDate ? '\nStarts ' + esc(fmtDateTime(T.eventDate)) : '')]);
  }
  // A declared early stop belongs in Game Setup, next to the format, because it changes what the
  // bracket MEANS - half the matches drawn on it will never be played.
  if (stopAtOf(T)) {
    const left = stopAtRemaining(T);
    const body = [esc(stopAtLine(T))];
    if (T.earlyFinish) {
      body.push('<span class="muted small">Reached \u2014 this tournament has ended.</span>');
    } else if (left != null) {
      body.push('<span class="muted small">' + (left === 0
        ? 'The last result will end it.'
        : left + ' more elimination' + (left === 1 ? '' : 's') + ' to go.') + '</span>');
    }
    topCells.push(['Ends early', body.join('<br>')]);
  }
  // Rating requirements. Shown whenever a rating is involved at all, not only when a min/max is
  // set, because WHICH rating counts and AS OF WHEN is itself a requirement players must know.
  {
    const parts = [];
    if (T.minRating != null && T.maxRating != null) parts.push('Player rating ' + T.minRating + '\u2013' + T.maxRating);
    else if (T.minRating != null) parts.push('Player rating ' + T.minRating + ' or higher');
    else if (T.maxRating != null) parts.push('Player rating up to ' + T.maxRating);
    if (T.maxTeamRating != null) parts.push('Max combined team rating ' + T.maxTeamRating);
    if (T.ratingCap != null) parts.push('Ratings above ' + T.ratingCap + ' count as ' + T.ratingCap + ' (capped)');
    if (viewerIsOrganizer() && (T.minRating != null || T.maxRating != null)) parts.push('(organizer invites/adds are exempt from min/max)');
    const src = ratingSourceHtml(T);
    // The rating is pulled from FAF automatically, so a player reading this box has no way to
    // know their own number or whether it clears the range. Point them at the check.
    const canCheck = T.ratingType && T.ratingType !== 'none' && (typeof viewerLoggedIn !== 'function' || viewerLoggedIn());
    const checkLink = canCheck
      ? '<div class="muted small" style="margin-top:8px">Don\u2019t know your rating? <a href="#" data-goto="players" data-focus="ratingCheckBox">Click here</a></div>'
      : '';
    if (src || parts.length) {
      topCells.push(['Rating requirements',
        (src ? '<div class="rating-source">' + src + '</div>' : '')
        + (parts.length ? '<div' + (src ? ' style="margin-top:8px"' : '') + '>' + parts.map(esc).join('<br>') + '</div>' : '')
        + checkLink]);
    }
  }
  // Lobby options and mods can be long and support formatting — their own row, rendered rich.
  const richCells = [];
  if (T.lobbyOptions) richCells.push(['Lobby options', renderArticleBody(T.lobbyOptions)]);
  if (T.mods) richCells.push(['Mods', renderArticleBody(T.mods)]);

  const inlineRef = (T.description || '') + ' ' + (T.rewards || '') + ' ' + (T.sponsors || '');
  const imgs = (T.descImages || []).filter(f => inlineRef.indexOf('/desc-images/' + encodeURIComponent(f)) < 0 && inlineRef.indexOf('/desc-images/' + f) < 0);
  const gallery = imgs.length ? `<div class="desc-gallery">${imgs.map(f => `<a href="/desc-images/${encodeURIComponent(f)}" target="_blank" rel="noopener"><img src="/desc-images/${encodeURIComponent(f)}" alt="" loading="lazy"></a>`).join('')}</div>` : '';
  if (!topCells.length && !richCells.length && !imgs.length && !T.description && !headline) return '';
  return `<div class="panel section"><h2>Game <span class="h2-strong">Setup</span></h2>
    ${headline ? '<p class="setup-headline">' + esc(headline) + '</p>' : ''}
    <div class="infogrid infogrid-top">
    ${topCells.map(c => `<div class="infocell"><div class="ic-label">${esc(c[0])}</div><div class="ic-body">${c[1]}</div></div>`).join('')}
  </div>
    ${richCells.length ? '<div class="infogrid">' + richCells.map(c => `<div class="infocell"><div class="ic-label">${esc(c[0])}</div><div class="ic-body">${c[1]}</div></div>`).join('') + '</div>' : ''}
    ${T.description ? '<div class="infocell briefing-wide"><div class="ic-label">Briefing</div><div class="ic-body">' + renderArticleBody(T.description) + '</div></div>' : ''}${gallery}</div>`
    + qualifyBlockHTML()
    + seriesBlockHTML()
    + `<div class="panel section"><h2>Links</h2><div class="ic-body">${faqLinksHTML()}</div></div>`;
}

// "Top N advance to X" block: on a qualifier it shows what players are competing for; on a
// parent it shows where its field comes from and who has qualified so far.
function qualifyBlockHTML() {
  const fi = T.feedsInto;
  const quals = T.qualifiers || [];
  if (!fi && !quals.length) return '';
  let h = '<div class="panel section qualify-block"><h2>Qualification</h2>';
  if (fi) {
    const rule = fi.rule
      ? (fi.rule.type === 'points' ? 'Everyone on <strong>' + fi.rule.n + ' points or more</strong>' : 'The <strong>top ' + fi.rule.n + '</strong>')
      : 'Qualifying entrants';
    h += `<p style="margin:0 0 6px">${rule} here ${fi.applied ? 'were' : 'will be'} invited to
      <a href="/t/${esc(fi.parentId)}" data-serieslink><strong>${esc(fi.parentName)}</strong></a>.
      ${fi.applied ? '' : '<span class="muted">Invites go out once this tournament finishes.</span>'}</p>`;
  }
  if (quals.length) {
    h += '<p style="margin:' + (fi ? '10px 0 6px' : '0 0 6px') + '">This tournament draws qualifiers from:</p><ul class="qb-list">';
    for (const q of quals) {
      const rule = q.rule ? (q.rule.type === 'points' ? q.rule.n + '+ points' : 'top ' + q.rule.n) : '';
      h += `<li><a href="/t/${esc(q.tournamentId)}" data-serieslink>${esc(q.name)}</a> <span class="muted">(${esc(rule)}${q.applied ? ' \u00b7 ' + (q.qualified || []).length + ' qualified' : ' \u00b7 pending'})</span>`;
      if ((q.qualified || []).length) h += '<div class="muted small">' + esc(q.qualified.join(', ')) + '</div>';
      h += '</li>';
    }
    h += '</ul>';
  }
  return h + '</div>';
}

// "Part of the X series" block, shown near the bottom of the overview above the links.
// Purely a browsing aid — editions are independent events.
function seriesBlockHTML() {
  if (!T.seriesId || !T.seriesName) return '';
  return `<div class="panel section series-block">
    <h2>Series</h2>
    <p style="margin:0">This tournament is part of the <strong class="sr-inline c-${esc(T.seriesColor || 'amber')}">${esc(T.seriesName)}</strong> series.
    <a href="/series/${esc(T.seriesId)}" data-serieslink>See all editions →</a></p>
  </div>`;
}

// Always-present FAQ / rules links under the briefing. Official tournaments also link the
// three governing articles directly (by article id, so a domain change doesn't break them).
function faqLinksHTML() {
  const rows = [`<div><a href="/faq">FAQ / Rules</a></div>`];
  if (T.category === 'official') {
    const arts = [
      ['FAF Official Tournament Payout Guidelines', '/faq?p=art33adc81d9f78'],
      ['Official FAF Tournament Rules', '/faq?p=art8f783c6882c5'],
      ['Tournament Code of Conduct', '/faq?p=art7e0d7816a012'],
    ];
    arts.forEach(a => rows.push(`<div><a href="${a[1]}">${esc(a[0])}</a></div>`));
  }
  return '<div class="faq-links">' + rows.join('') + '</div>';
}

// ---- tournament news: read tracking + rendering ----

// last-read timestamp: max of this browser (localStorage) and this FAF account (server),
// so reading on one device clears the badge on every other logged-in device too.
function newsLastRead() {
  const local = parseInt(localStorage.getItem('newsRead_' + T.id) || '0', 10) || 0;
  const acct = (T.viewer && T.viewer.newsReadAt) || 0;
  return Math.max(local, acct);
}
function newsUnreadCount() {
  const last = newsLastRead();
  return (T.news || []).filter(n => (n.at || 0) > last).length;
}
function newsMarkRead() {
  const latest = Math.max(0, ...(T.news || []).map(n => n.at || 0));
  if (!latest) return;
  localStorage.setItem('newsRead_' + T.id, String(latest));
  if (T.viewer && T.viewer.loggedIn && latest > ((T.viewer && T.viewer.newsReadAt) || 0)) {
    T.viewer.newsReadAt = latest; // keep the in-memory copy current for badge math
    api('/api/t/' + T.id + '/news_read', {}).catch(() => {});
  }
}

function newsPostHTML(n, admin) {
  return `<div class="panel section news-post${n.important ? ' news-important' : ''}">
    <div class="news-head">
      ${n.important ? '<span class="news-chip">Important</span>' : ''}
      <span class="muted small">${esc(fmtDateTime(n.at))} \u00b7 ${esc(n.by || 'Organizer')}${n.editedAt ? ' \u00b7 edited' : ''}</span>
      ${admin ? `<span class="news-actions"><a href="#" data-newsedit="${n.id}">edit</a> <a href="#" data-newsdel="${n.id}" class="danger-link">delete</a></span>` : ''}
    </div>
    <div class="news-body">${renderArticleBody(n.body)}</div>
  </div>`;
}

function drawNews(el) {
  const admin = viewerIsOrganizer();
  const news = T.news || [];
  let html = '';

  if (admin) {
    html += `<div class="panel section"><h2>Post an update</h2>
      <p class="muted small">Short updates for the players \u2014 newest shows on top and on the Overview. Tick "highlight" for things everyone must see (date moved, cancelled); leave it off for routine notes (player swap etc.).</p>
      ${mdToolbarHTML()}
      <textarea id="newsBody" rows="3" maxlength="1000" placeholder="e.g. Tourney moved from 18.07. to 20.07., same time. (supports **bold**, lists, links)"></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="newsImp"> Highlight as important (schedule change / cancellation)</label>
      <div style="margin-top:10px"><button class="btn primary" id="newsPost">Post update</button></div></div>`;
  }

  if (!news.length) {
    html += '<div class="panel section"><div class="empty">No news yet.</div></div>';
  } else {
    html += news.map(n => newsPostHTML(n, admin)).join('');
  }
  el.innerHTML = html;

  // opening the tab counts as reading everything currently posted
  newsMarkRead();

  const nbTa = document.getElementById('newsBody');
  if (nbTa) wireMdToolbar(nbTa.previousElementSibling, nbTa);
  const pb = document.getElementById('newsPost');
  if (pb) pb.onclick = async () => {
    const body = document.getElementById('newsBody').value.trim();
    if (!body) return toast('Write something first', true);
    try {
      await api('/api/t/' + T.id + '/news_post', { body, important: document.getElementById('newsImp').checked ? 1 : 0, admin: adminToken() });
      toast('Posted');
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  el.querySelectorAll('[data-newsedit]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    const n = (T.news || []).find(x => x.id === a.dataset.newsedit);
    if (!n) return;
    modal(`<h3>Edit update</h3>
      ${mdToolbarHTML()}
      <textarea id="neBody" rows="4" maxlength="1000">${esc(n.body)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="neImp" ${n.important ? 'checked' : ''}> Highlight as important</label>
      <div class="actions"><button class="btn ghost" id="neCancel">Cancel</button><button class="btn primary" id="neGo">Save</button></div>`, root => {
      const neTa = root.querySelector('#neBody');
      if (neTa) wireMdToolbar(neTa.previousElementSibling, neTa);
      root.querySelector('#neCancel').onclick = closeModal;
      root.querySelector('#neGo').onclick = async () => {
        try {
          await api('/api/t/' + T.id + '/news_edit', { id: n.id, body: root.querySelector('#neBody').value.trim(), important: root.querySelector('#neImp').checked ? 1 : 0, admin: adminToken() });
          closeModal(); toast('Saved'); await refresh();
        } catch (e2) { toast(e2.message, true); }
      };
    });
  });
  el.querySelectorAll('[data-newsdel]').forEach(a => a.onclick = async (e) => {
    e.preventDefault();
    if (!confirm('Delete this update?')) return;
    try { await api('/api/t/' + T.id + '/news_delete', { id: a.dataset.newsdel, admin: adminToken() }); toast('Deleted'); await refresh(); }
    catch (e2) { toast(e2.message, true); }
  });
}

function drawOverview(el) {
  let html = '';

  const canEditDate = viewerIsAdmin() || !!adminToken();
  const dv = tourneyDate(T);
  const dateLabel = T.imported ? 'Played' : 'Event date';
  if (dv || canEditDate) {
    html += `<div class="datebar">
      <span class="db-label">${esc(dateLabel)}</span>
      <span class="db-value">${dv ? esc(fmtDateTime(dv)) : '<span class="muted">not set</span>'}</span>
      ${canEditDate ? '<button class="btn ghost small" id="editDateBtn">' + (dv ? 'Edit details' : 'Set date &amp; details') + '</button>' : ''}
    </div>`;
  }

  if (T.imported) {
    html += `<div class="panel section" style="border-left:3px solid var(--blue)">
      <div class="mono small" style="color:var(--blue);letter-spacing:1px">IMPORTED FROM CHALLONGE</div>
      <div class="muted small" style="margin-top:6px">This is an archived tournament imported for display. ${T.sourceUrl ? '<a href="' + esc(T.sourceUrl) + '" target="_blank" rel="noopener">View on Challonge \u2197</a>' : ''}</div>
    </div>`;
  }

  if ((T.streams || []).length) {
    html += `<div class="panel section stream-panel"><h2>Livestream${T.streams.length === 1 ? '' : 's'}</h2>
      ${T.streams.map(st => {
        const safe = /^https?:\/\/[^\s"'<>]+$/.test(st.url);
        return `<div class="stream-line">\uD83D\uDCFA ${safe ? '<a href="' + esc(st.url) + '" target="_blank" rel="noopener">' + esc(st.url.replace(/^https?:\/\//, '')) + '</a>' : esc(st.url)}${st.info ? ' <span class="muted small">\u2014 ' + esc(st.info) + '</span>' : ''}</div>`;
      }).join('')}</div>`;
  }

  if ((T.news || []).length && T.status !== 'finished') {
    const n = T.news[0];
    const unread = newsUnreadCount();
    html += `<div class="panel section news-post${n.important ? ' news-important' : ''}">
      <div class="news-head">
        <span class="mono small" style="letter-spacing:1px;text-transform:uppercase;color:${n.important ? 'var(--amber)' : 'var(--muted)'}">Latest update</span>
        ${n.important ? '<span class="news-chip">Important</span>' : ''}
        <span class="muted small">${esc(fmtDateTime(n.at))}</span>
      </div>
      <div class="news-body">${renderArticleBody(n.body)}</div>
      <div class="muted small" style="margin-top:10px">To see all news for this tournament, <a href="#" data-goto="news">click here</a>${unread ? ' <span class="tab-badge">' + unread + '</span>' : ''}</div>
    </div>`;
  }

  if (divisionsOnT()) {
    // one champion per division, top division first
    const champs = [];
    for (let d = 1; d <= T.divisions; d++) { const c = divisionChampionOf(d); if (c) champs.push({ d, c }); }
    if (champs.length) {
      html += '<div class="champ-row">' + champs.map(x => `<div class="champ"><div class="champ-label">${esc(divisionNameOf(x.d))} champion</div><h1>${esc(teamName(x.c))}</h1></div>`).join('') + '</div>';
    }
  } else if (T.championTeamId) {
    html += `<div class="champ"><div class="champ-label">Champion</div><h1>${esc(teamName(T.championTeamId))}</h1></div>`;
  }

  const prize = T.prize && T.prize.currency && T.prize.amount != null ? T.prize : null;
  if (T.rewards || T.sponsors || prize) {
    // The headline cash prize gets its own boxed cell at the top of Rewards (like Format does in
    // Game setup) so it reads at a glance and can be lifted for calendars and listings.
    const prizeCell = prize ? `<div class="infocell prize-cell">
        <div class="ic-label">Overall cash prize</div>
        <div class="ic-body prize-amount">${esc(formatPrize(prize))}</div>
      </div>` : '';
    const rw = (T.rewards || prize) ? `<div class="panel section" style="flex:1;min-width:280px"><h2>Rewards</h2>
      ${prizeCell}
      ${T.rewards ? '<div class="ic-body reward-body">' + renderArticleBody(T.rewards) + '</div>' : ''}</div>` : '';
    const sp = T.sponsors ? `<div class="panel section" style="flex:1;min-width:280px"><h2>Sponsors</h2>
      <div class="ic-body reward-body">${renderArticleBody(T.sponsors)}</div></div>` : '';
    html += `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch">${rw}${sp}</div>`;
  }

  html += gameInfoPanel();

  if (T.status === 'signup') {
    const now = Date.now();
    const opensAt = T.signupOpensAt ? new Date(T.signupOpensAt).getTime() : null;
    const closesAt = T.signupClosesAt ? new Date(T.signupClosesAt).getTime() : null;
    const notYetOpen = opensAt && now < opensAt;
    const closed = closesAt && now > closesAt;
    let msg;
    if (notYetOpen) {
      msg = `Signups haven't opened yet — they open <strong>${esc(fmtDateTime(T.signupOpensAt))}</strong>. Until then, only organizers can add players. <strong>${T.players.length}</strong> ${T.players.length === 1 ? 'player' : 'players'} added so far.`;
    } else if (closed) {
      msg = `Signups have closed — <strong>${T.players.length}</strong> ${T.players.length === 1 ? 'player' : 'players'} in. Team forming and captain picks can still continue; the organizer starts the bracket when ready.`;
    } else {
      msg = `Signups are open — <strong>${T.players.length}</strong> player${T.players.length === 1 ? '' : 's'} in so far. Head to the <a href="#" data-goto="players">Players</a> tab to sign up.`;
    }
    html += `<div class="panel section"><h2>Status</h2><p>${msg}</p></div>`;
  }

  if (T.status === 'draft' && T.draft) {
    const divName = (T.draft.division && divisionsOnT()) ? divisionNameOf(T.draft.division) : '';
    if (T.draft.waiting) {
      html += `<div class="draft-turn">${esc(divName)} draft next - the organizer is choosing its captains. Follow it in the <a href="#" data-goto="teams">Draft</a> tab.</div>`;
    } else {
      const turnTeam = teamName(T.draft.order[T.draft.current]);
      html += `<div class="draft-turn">${divName ? esc(divName) + ' draft' : 'Draft'} in progress - <strong>${esc(turnTeam)}</strong> is on the clock. Follow it in the <a href="#" data-goto="teams">Draft</a> tab.</div>`;
    }
  }

  // Predictions open and this viewer has not made theirs (or it no longer fits the draw).
  if (typeof predictBadgeCount === 'function' && predictBadgeCount() > 0) {
    const pz = T.predict && T.predict.prize;
    html += `<div class="draft-turn">Predictions are open until the first match is played - <a href="#" data-goto="predictions">make yours</a>${pz ? '. Prize for a perfect prediction: <strong>' + esc(pz) + '</strong>' : ''}.</div>`;
  }

  if (T.status === 'running' || T.status === 'finished') {
    const open = T.matches.filter(m => m.status === 'ready' || m.status === 'live')
      .sort((a, b) => brOrder(a) - brOrder(b) || a.round - b.round || a.index - b.index);
    // newest first in playing order, so a Swiss round never lands above the playoffs after it
    const done = sortByPlay(T.matches.filter(m => m.status === 'done'), true).slice(0, 8);
    // The "up next" queue was removed: the Matches tab lists every match with far more detail,
    // filtered into My matches / ongoing / undecided / concluded, so this duplicated it.
    html += `<div class="panel section"><h2>Recent results</h2><div class="queue" id="q2">
      ${done.length ? '' : '<div class="empty">No results yet.</div>'}</div>
      <p class="muted small" style="margin:10px 0 0">Every match, including what is coming up, is on the <a href="#" data-goto="matches">Matches</a> tab.</p></div>`;
    el.innerHTML = html;
    fillQueue(document.getElementById('q2'), done, false);
  } else {
    el.innerHTML = html || '<div class="panel"><div class="empty">Nothing here yet.</div></div>';
  }

  el.querySelectorAll('[data-goto]').forEach(a => a.onclick = e => {
    e.preventDefault(); currentTab = a.dataset.goto; syncTabURL(); drawTournament();
    // data-focus: after the destination tab has rendered, scroll its target into view and flash
    // it, so "click here" lands ON the thing rather than merely on the right tab.
    const want = a.dataset.focus;
    if (!want) return;
    setTimeout(() => {
      const node = document.getElementById(want);
      if (!node) return;
      try { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (err) { node.scrollIntoView(); }
      node.classList.add('focus-flash');
      setTimeout(() => node.classList.remove('focus-flash'), 2000);
    }, 60);
  });

  const edb = document.getElementById('editDateBtn');
  if (edb) edb.onclick = () => {
    const cur = (!T.imported ? T.eventDate : (T.eventDate || '')) || '';
    const parts = splitDateTimeUTC(cur);
    const suParts = splitDateTimeUTC(T.signupOpensAt || '');
    const scParts = splitDateTimeUTC(T.signupClosesAt || '');
    modal(`<h3>Tournament details</h3>
      <label>Tournament name</label>
      <input type="text" id="edName" maxlength="60" value="${esc(T.name || '')}">
      <p class="muted small" style="margin-top:12px">Enter times in <strong>UTC</strong>. They display in each viewer's chosen time zone. Leave blank to clear.</p>
      <label>${T.imported ? 'Display date' : 'Event date &amp; time'}</label>
      <div style="display:flex;gap:8px">
        <input type="date" id="edDate" value="${esc(parts.date)}" style="flex:1">
        <input type="time" id="edTime" value="${esc(parts.time)}" style="width:130px">
      </div>
      ${T.imported ? '' : `<label style="margin-top:12px">Signups open at <span class="muted small">(optional — before this, only organizers can add players)</span></label>
      <div style="display:flex;gap:8px">
        <input type="date" id="edSuDate" value="${esc(suParts.date)}" style="flex:1">
        <input type="time" id="edSuTime" value="${esc(suParts.time)}" style="width:130px">
      </div>
      <label style="margin-top:12px">Signups close at <span class="muted small">(optional — auto-closes signups; team forming &amp; picks still work. Empty = manual)</span></label>
      <div style="display:flex;gap:8px">
        <input type="date" id="edScDate" value="${esc(scParts.date)}" style="flex:1">
        <input type="time" id="edScTime" value="${esc(scParts.time)}" style="width:130px">
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
        <div style="flex:1;min-width:150px"><label>Min teams / entrants <span class="muted small">(display only)</span></label><input type="number" id="edMinTeams" min="0" max="128" value="${T.minTeams || 0}"></div>
        <div style="flex:1;min-width:150px"><label>Max teams / entrants <span class="muted small">(0 = unlimited)</span></label><input type="number" id="edMaxTeams" min="0" max="128" value="${T.maxTeams || 0}"></div>
      </div>`}
      <div class="actions"><button class="btn ghost" id="edCancel">Cancel</button><button class="btn primary" id="edSave">Save</button></div>`, root => {
      root.querySelector('#edCancel').onclick = closeModal;
      root.querySelector('#edSave').onclick = async () => {
        const v = combineDateTimeUTC(root.querySelector('#edDate'), root.querySelector('#edTime'));
        try {
          // dates go through edit_date; name / close / team counts through edit_info
          const body = { eventDate: v, admin: myToken() };
          const sd = root.querySelector('#edSuDate');
          if (sd) body.signupOpensAt = combineDateTimeUTC(sd, root.querySelector('#edSuTime'));
          await api('/api/t/' + T.id + '/edit_date', body);
          const info = { admin: myToken() };
          const nm = root.querySelector('#edName').value.trim();
          if (nm) info.name = nm;
          const sc = root.querySelector('#edScDate');
          if (sc) { info.signupClosesAt = combineDateTimeUTC(sc, root.querySelector('#edScTime')); }
          const mn = root.querySelector('#edMinTeams'); if (mn) info.minTeams = mn.value;
          const mx = root.querySelector('#edMaxTeams'); if (mx) info.maxTeams = mx.value;
          await api('/api/t/' + T.id + '/edit_info', info);
          closeModal();
          await refresh();
          toast('Details updated');
        } catch (e) { toast(e.message, true); }
      };
    });
  };
}

function brOrder(m) { return { wb: 0, lb: 1, sw: 0, ffa: 0, gf: 2 }[m.bracket] || 0; }

function fillQueue(el, matches, withReport) {
  for (const m of matches) {
    const div = document.createElement('div');
    div.className = 'qitem' + (m.status === 'done' ? ' done' : '') + (m.status === 'live' ? ' live' : '');
    let inner = `<span class="qround">${roundLabel(m)}</span>`;
    // Which score group this Swiss pairing came out of. Asked for so a round can be read at a
    // glance ("whether they were 2-1 or 1-2 matches") without cross-referencing the standings -
    // and the standings cannot answer it anyway once the round has been played.
    const swRec = swissMatchRecord(m);
    if (swRec) inner += `<span class="qrec" title="Record both players brought into this round">${esc(swRec)}</span>`;
    if (m.bracket === 'ffa') {
      const names = m.entrants.map(id => {
        const won = m.winners && m.winners.indexOf(id) >= 0;
        return `<span class="${won ? 'qwin' : ''}">${esc(teamName(id))}</span>`;
      }).join('<span class="qvs">·</span>');
      inner += `<span class="qteams">${names}</span>`;
    } else {
      const w1 = m.winner && m.winner === m.team1, w2 = m.winner && m.winner === m.team2;
      inner += `<span class="qteams">
        <span class="${w1 ? 'qwin' : ''}">${esc(teamName(m.team1) || 'TBD')}</span><span class="qvs">VS</span>
        <span class="${w2 ? 'qwin' : ''}">${esc(teamName(m.team2) || 'TBD')}</span></span>`;
      if (m.score1 != null) inner += `<span class="qscore">${m.score1} — ${m.score2}</span>`;
      if (m.status === 'live') inner += `<span class="livechip">LIVE</span>`;
    }
    const maps = mapsFor(m.bracket, poolRoundOf(m.bracket, m.round, m.division));
    if (maps.length) inner += `<span class="mono small muted" title="Maps">${esc(maps.map((mp, i) => 'G' + (i + 1) + ': ' + mapName(mp)).join(' · '))}</span>`;
    const showBtn = !T.imported && withReport && (m.status === 'done' ? viewerIsAdmin() : canReportMatch(m));
    if (showBtn) inner += `<button class="btn amber small" data-m="${m.id}">Report</button>`;
    div.innerHTML = inner;
    if (showBtn) div.querySelector('[data-m]').onclick = () => reportScore(m.id);
    el.appendChild(div);
  }
}

