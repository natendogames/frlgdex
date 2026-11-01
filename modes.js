'use strict';
// Play modes and collections: Nuzlocke run tracker, shiny hunt counter and living dex boxes. Loaded after trackers.js.

// ---------- Nuzlocke ----------
// Rules: only the first Pokémon you meet in each area may be caught (with the dupes clause, a species line you
// already have doesn't count as your first), a Pokémon that faints is dead, and you never go above the level cap:
// the ace of the next Gym Leader, Elite Four member or Champion. With the mode on, catch suggestions only offer
// areas you haven't used and Pokémon you could still get.
const NUZ_STATUS = { alive: 'Alive', boxed: 'Boxed', dead: 'Dead', missed: 'Missed (fled or fainted)' };
const nuzOn = () => !!cur().nuz?.on;
function nuzState() { const s = cur(); s.nuz ||= { on: false, dupes: true, areas: {} }; s.nuz.areas ||= {}; return s.nuz; }
const rootOf = n => lineOf(n)[0];
function nuzAllows(loc, dex) {
  const z = cur().nuz, a = z.areas[loc];
  if (a) return a.dex === dex && (a.status === 'alive' || a.status === 'boxed');
  if (z.dupes !== false && Object.values(z.areas).some(x => x.dex && rootOf(x.dex) === rootOf(dex))) return false;
  return true;
}
// The level cap: the strongest Pokémon of the next key battle you haven't won (story order).
function nuzCap() {
  const s = cur();
  const next = state.trainers.find(t => /^(leader|elite|champion)/.test(t.id) && !s.checks[trainerKey(t.location, t)]);
  if (!next) return null;
  const party = next.party || Object.values(next.byStarter || {})[0] || [];
  return { t: next, cap: Math.max(...party.map(p => p.level)) };
}
function nuzBanner() {
  if (!nuzOn()) return '';
  const c = nuzCap(), z = nuzState();
  const alive = Object.values(z.areas).filter(a => a.status === 'alive').length, dead = Object.values(z.areas).filter(a => a.status === 'dead').length;
  const over = c ? cur().team.filter(n => (teamMeta(n).level || 0) > c.cap) : [];
  return `<div class="card nuz"><b>Nuzlocke</b> · level cap <b>${c ? c.cap : '—'}</b>${c ? ` <span class="note">(${esc(c.t.name)})</span>` : ''} · ${alive} alive · ${dead} dead <a href="#/nuzlocke">run</a>
    ${over.length ? `<div class="bad">Over the cap: ${over.map(n => esc(mon(n).name)).join(', ')}</div>` : ''}</div>`;
}
// Pokémon you can meet first in an area at this point: wild, static or gift encounters in this version
function areaOptions(locId) {
  const loc = state.locations[locId];
  const seen = new Set();
  return loc.encounters.filter(e => inVersion(e) && !['trade', 'roaming'].includes(e.method) && !seen.has(e.dex) && seen.add(e.dex));
}
function nuzCard(loc) {
  if (!nuzOn() || !areaOptions(loc.id).length) return '';
  const z = nuzState(), a = z.areas[loc.id];
  return `<h2>Nuzlocke encounter</h2><div class="card">${nuzAreaRow(loc.id, a)}</div>`;
}
function nuzAreaRow(locId, a) {
  const opts = areaOptions(locId), z = nuzState();
  const dupe = e => z.dupes !== false && Object.entries(z.areas).some(([l, x]) => l !== locId && x.dex && rootOf(x.dex) === rootOf(e.dex));
  return `<div class="nuzrow" data-area="${locId}"><select data-nuzmon="${locId}"><option value="">${a ? '—' : 'First encounter…'}</option>${opts.map(e => `<option value="${e.dex}" ${a?.dex === e.dex ? 'selected' : ''}>${esc(e.name)}${dupe(e) ? ' (dupe: skip)' : ''}${e.method !== 'grass' ? ` · ${esc(METHOD_LABEL[e.method] || e.method)}` : ''}</option>`).join('')}</select>
    ${a?.dex ? `<div class="chips" style="margin-top:6px">${Object.entries(NUZ_STATUS).map(([k, l]) => `<button class="chip ${a.status === k ? 'on' : ''}" data-nuzst="${locId}:${k}">${l}</button>`).join('')}</div>` : ''}</div>`;
}
function bindNuz(after) {
  const z = nuzState();
  view.querySelectorAll('[data-nuzmon]').forEach(sel => sel.onchange = () => {
    const l = sel.dataset.nuzmon;
    if (!sel.value) delete z.areas[l]; else z.areas[l] = { dex: +sel.value, status: z.areas[l]?.status || 'alive' };
    if (sel.value && z.areas[l].status !== 'missed') cur().caught[sel.value] ||= true;
    for (const k in catchCache) delete catchCache[k];
    save(); after();
  });
  view.querySelectorAll('[data-nuzst]').forEach(b => b.onclick = () => {
    const [l, st] = b.dataset.nuzst.split(':');
    z.areas[l].status = st;
    if (st === 'dead' || st === 'missed') cur().team = cur().team.filter(n => n !== z.areas[l].dex);
    for (const k in catchCache) delete catchCache[k];
    save(); after();
  });
}
function renderNuzlocke() {
  setHeader('Nuzlocke run', true, 'tools');
  const z = nuzState(), here = currentStage();
  const used = Object.values(z.areas);
  let html = `<div class="card"><label class="row"><input type="checkbox" id="nuzon" ${z.on ? 'checked' : ''}><span>Nuzlocke mode on for ${VNAME[V()]}<span class="sub">Shows the level cap on route pages and Battle plan, and limits catch suggestions to areas you haven't used.</span></span></label>
    <label class="row"><input type="checkbox" id="nuzdupes" ${z.dupes !== false ? 'checked' : ''}><span>Dupes clause<span class="sub">If the first Pokémon in an area is a line you already have, the next new one counts instead.</span></span></label></div>
    ${nuzBanner()}
    <div class="card stats">${Object.entries(NUZ_STATUS).map(([k, l]) => `<div class="stat"><b>${used.filter(a => a.status === k).length}</b><span>${l}</span></div>`).join('')}</div>`;
  let region = '';
  for (const l of state.index) {
    if (stageOf(l.id) > here + 3 && !z.areas[l.id]) continue;
    if (!areaOptions(l.id).length) continue;
    if (l.region !== region) { region = l.region; html += `<h2>${esc(region)}</h2>`; }
    html += `<div class="card"><div class="mhead"><a href="#/loc/${l.id}"><b>${esc(l.name)}</b></a></div>${nuzAreaRow(l.id, z.areas[l.id])}</div>`;
  }
  html += `<p class="note">Areas up to a few stops past where you are (${esc(state.index[here].name)}) are listed. Set where you are on the <a href="#/progress">Progress</a> page.</p>
    <div class="card"><button class="btn" id="nuzreset">Start a new run</button></div>`;
  view.innerHTML = html;
  document.getElementById('nuzon').onchange = e => { z.on = e.target.checked; for (const k in catchCache) delete catchCache[k]; save(); renderNuzlocke(); };
  document.getElementById('nuzdupes').onchange = e => { z.dupes = e.target.checked; for (const k in catchCache) delete catchCache[k]; save(); renderNuzlocke(); };
  document.getElementById('nuzreset').onclick = () => { if (confirm('Clear every Nuzlocke encounter for this version? Your checklist stays.')) { z.areas = {}; for (const k in catchCache) delete catchCache[k]; save(); renderNuzlocke(); } };
  bindNuz(renderNuzlocke);
}

// ---------- shiny hunts ----------
const SHINY_ODDS = 8192;
function renderShiny() {
  const s = cur(); s.shiny ||= [];
  const hunts = s.shiny;
  const chance = n => (1 - Math.pow(1 - 1 / SHINY_ODDS, n)) * 100;
  view.innerHTML = `<div class="card"><p class="note">Gen 3 shiny odds are 1 in ${SHINY_ODDS.toLocaleString()} for every wild encounter, egg, gift or soft reset. There's no Shiny Charm or Masuda method in FireRed and LeafGreen.</p>
    <div class="toolbar"><select id="shnew" style="flex:1"><option value="">Start a hunt for…</option>${monOptions(0)}</select></div></div>
    ${hunts.map((h, i) => `<div class="card shiny ${h.found ? 'checked' : ''}"><div class="mhead"><b>${esc(mon(h.dex).name)}</b> ${types(h.dex)} ${h.found ? `<span class="tag good">Found after ${h.count.toLocaleString()} · ${esc(h.found)}</span>` : ''}<button class="icon-x" data-shdel="${i}" aria-label="Delete hunt">&times;</button></div>
      <div class="shcount">${h.count.toLocaleString()}</div>
      <div class="note">${chance(h.count).toFixed(1)}% of hunts would have found one by now · ${h.count > SHINY_ODDS ? 'past the odds' : `${(SHINY_ODDS - h.count).toLocaleString()} to the odds`}</div>
      ${h.found ? '' : `<div class="toolbar" style="margin-top:8px"><button class="btn big" data-sh="${i}:1">+1</button><button class="btn" data-sh="${i}:10">+10</button><button class="btn" data-sh="${i}:-1">−1</button><button class="btn" data-shfound="${i}">Found it!</button></div>`}</div>`).join('') || '<div class="card empty">No hunts yet.</div>'}`;
  document.getElementById('shnew').onchange = e => { if (+e.target.value) { hunts.unshift({ dex: +e.target.value, count: 0 }); save(); renderShiny(); } };
  view.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.sh.split(':').map(Number); hunts[i].count = Math.max(0, hunts[i].count + d); save(); renderShiny(); });
  view.querySelectorAll('[data-shfound]').forEach(b => b.onclick = () => { const h = hunts[+b.dataset.shfound]; h.found = new Date().toLocaleDateString(); s.caught[h.dex] ||= true; save(); renderShiny(); });
  view.querySelectorAll('[data-shdel]').forEach(b => b.onclick = () => { if (confirm('Delete this hunt?')) { hunts.splice(+b.dataset.shdel, 1); save(); renderShiny(); } });
}

// ---------- living dex ----------
// One of every Pokémon kept in your PC, box by box in National Dex order (30 per box). Evolved Pokémon need a
// second copy of the line, so the cell says how to get one.
function livingHow(n) {
  const a = availability(n);
  if (a.kind === 'catch') return 'catch';
  if (a.kind === 'evolve') return 'evolve';
  if (a.kind === 'event') return 'event';
  return 'trade';
}
function renderLiving() {
  const s = cur(), max = state.livingScope === 'kanto' ? 151 : 386;
  let have = 0; for (let n = 1; n <= max; n++) if (s.checks[`living:${n}`]) have++;
  let html = `<div class="card"><b>${have}/${max}</b> in your boxes ${bar(have, max)}
    <div class="chips" style="margin-top:8px"><button class="chip ${max === 151 ? 'on' : ''}" data-lv="kanto">Kanto 151</button><button class="chip ${max === 386 ? 'on' : ''}" data-lv="national">National 386</button></div>
    <p class="note">Tap a Pokémon when it's in your PC. Colours: <span class="lv catch">catch</span> <span class="lv evolve">evolve one</span> <span class="lv trade">trade</span> <span class="lv event">event</span>. Evolved ones need a second copy of the line.</p></div>`;
  for (let b = 0; b * 30 < max; b++) {
    html += `<h2>Box ${b + 1}</h2><div class="card boxgrid">`;
    for (let n = b * 30 + 1; n <= Math.min(max, b * 30 + 30); n++) {
      const on = s.checks[`living:${n}`];
      html += `<button class="cell ${on ? 'on' : livingHow(n)}" data-living="${n}" title="${esc(mon(n).name)}">${n}<small>${esc(mon(n).name.slice(0, 7))}</small></button>`;
    }
    html += '</div>';
  }
  view.innerHTML = html;
  view.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { state.livingScope = b.dataset.lv; renderLiving(); });
  view.querySelectorAll('[data-living]').forEach(b => b.onclick = () => {
    const k = `living:${b.dataset.living}`;
    if (s.checks[k]) delete s.checks[k]; else { s.checks[k] = true; s.caught[b.dataset.living] ||= true; }
    save(); renderLiving();
  });
}

LOC_SECTIONS.unshift(nuzCard);
// the Nuzlocke picker on a location page needs its handlers once the page is drawn
AFTER_RENDER.push(page => { if (page === 'loc' && nuzOn()) bindNuz(() => route(true)); });
TOOLS.push({ id: '#/nuzlocke', title: 'Nuzlocke run', desc: 'First encounter per area, alive and dead, dupes clause and the level cap' },
  { id: 'shiny', title: 'Shiny hunts', desc: 'Encounter counters with the odds so far', render: renderShiny },
  { id: 'living', title: 'Living dex', desc: 'One of every Pokémon in your PC, box by box', render: renderLiving });
Object.assign(PAGES, { nuzlocke: renderNuzlocke });
