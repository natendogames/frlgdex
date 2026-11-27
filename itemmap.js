'use strict';
// "Show on map": a drawing of the map an item or trainer is on, with a marker on its exact tile. The maps are drawn at build time
// from the game's tile data (scripts/mapdraw.py writes data/itemmaps/<place>.json), not from its artwork. Shared by
// the FireRed/LeafGreen, Emerald and Seaglass apps. Page: #/spot/<place id>/<item id | trainer:<id> | gift:<id> | all>.
const SPOT_FILL = { '#': 'url(#sp-wall)', g: 'url(#sp-grass)', w: 'url(#sp-water)', f: 'url(#sp-fall)', s: 'url(#sp-sand)', i: 'var(--map-ice)', l: 'var(--map-ledge)' };
// our own simple tile drawings: grass tufts, water ripples, sand specks, a rough wall
const SPOT_DEFS = `<defs>
  <pattern id="sp-grass" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="var(--map-grass)"/><path d="M1.5 6.5l1-3 1 3M4.5 7.5l1-3 1 3" fill="none" stroke="var(--map-grass-ink)" stroke-width=".9"/></pattern>
  <pattern id="sp-water" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="var(--map-water)"/><path d="M0 3q2-1.5 4 0t4 0M0 7q2-1.5 4 0t4 0" fill="none" stroke="var(--map-water-ink)" stroke-width=".7"/></pattern>
  <pattern id="sp-fall" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="var(--map-water)"/><path d="M2 0v8M6 0v8" stroke="var(--map-water-ink)" stroke-width="1"/></pattern>
  <pattern id="sp-sand" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="var(--map-sand)"/><circle cx="2" cy="2" r=".6" fill="var(--map-sand-ink)"/><circle cx="6" cy="5" r=".6" fill="var(--map-sand-ink)"/></pattern>
  <pattern id="sp-wall" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="var(--map-wall)"/><path d="M0 8L8 0" stroke="var(--map-wall-ink)" stroke-width=".6"/></pattern>
</defs>`;
const spotCache = {};
const spotData = id => spotCache[id] ||= getJSON(`data/itemmaps/${id}.json`).catch(e => { delete spotCache[id]; throw e; });
// the button on an item row or trainer card (a trainer's target is "trainer:<id>")
function spotLink(locId, it) {
  return it && it.map ? ` <a class="tag catchlink spotlink" href="#/spot/${locId}/${encodeURIComponent(it.id)}">Show on map</a>` : '';
}
const spotHref = (locId, id) => `#/spot/${locId}/${encodeURIComponent(id)}`;
// a plain person: head and shoulders
const spotPerson = (cx, cy, col, big) => { const k = big ? 1.5 : 1; return `<circle cx="${cx}" cy="${cy - 2.2 * k}" r="${1.8 * k}" fill="${col}"/><path d="M${cx - 3 * k} ${cy + 3.6 * k}q0-4.6 ${3 * k}-4.6t${3 * k} 4.6z" fill="${col}"/>`; };
// an item: a plain ball with a shine
const spotBall = (cx, cy, col) => `<circle cx="${cx}" cy="${cy}" r="3.2" fill="${col}" stroke="var(--map-ink)" stroke-width=".5"/><circle cx="${cx - 1}" cy="${cy - 1.1}" r=".9" fill="#fff" opacity=".85"/>`;
// labels: things to collect (items, and people who give you something) numbered 1, 2, 3 and trainers lettered A, B, C
// in the order you come across them on a first visit. The build works them out (lbl) and the place page lists things
// in the same order with the same labels; they stay put as you tick things off.
const spotLetter = i => (i >= 26 ? spotLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + i % 26);
function spotLabels(m) {
  // o: the order you reach them on your first visit, worked out at build time (scripts/mapdraw.py)
  const byPos = (a, b) => (a.o ?? 1e9) - (b.o ?? 1e9) || a.y - b.y || a.x - b.x;
  const items = [...m.items].sort(byPos).map((it, i) => ({ ...it, label: it.lbl || String(i + 1) }));
  const trainers = [...(m.trainers || [])].sort(byPos).map((t, i) => ({ ...t, label: t.lbl || spotLetter(i) }));
  const gifts = [...(m.gifts || [])].sort(byPos).map(g => ({ ...g, label: g.lbl || '' }));
  return { items, trainers, gifts };
}
const spotBadge = (x, y, W, text, col, later) => {
  const bx = Math.min(Math.max(x + 7, 6), W - 6), by = Math.max(y - 6, 6), wd = text.length > 1 ? 5 + text.length * 4.6 : 11.5;
  return `<rect x="${bx - wd / 2}" y="${by - 5.75}" width="${wd}" height="11.5" rx="5.75" fill="var(--map-badge)" stroke="${col}" stroke-width="1"${later ? ' stroke-dasharray="2 1.5"' : ''}/><text x="${bx}" y="${by + 3.1}" text-anchor="middle" font-size="9" font-weight="700" fill="${col}">${text}</text>`;
};
function spotSvg(m, loc, target, checks) {
  const T = 8, W = m.w * T, H = m.h * T, locId = loc.id;
  let r = '';
  // one rectangle per run of the same tile along a row
  for (let y = 0; y < m.h; y++) {
    let x = 0;
    while (x < m.w) {
      const c = m.tiles[y * m.w + x];
      let e = x + 1;
      while (e < m.w && m.tiles[y * m.w + e] === c) e++;
      if (SPOT_FILL[c]) r += `<rect x="${x * T}" y="${y * T}" width="${(e - x) * T}" height="${T}" fill="${SPOT_FILL[c]}"/>`;
      if (c === 'l') for (let k = x; k < e; k++) r += `<path d="M${k * T + 1} ${y * T + 2}l3 4l3-4" fill="none" stroke="var(--map-ink)" stroke-width="1"/>`;
      x = e;
    }
  }
  for (const [x, y] of m.doors) r += `<rect x="${x * T + 1}" y="${y * T + 1}" width="6" height="6" rx="1" fill="var(--map-door)"/>`;
  for (const [x, y] of m.signs) r += `<rect x="${x * T + 2}" y="${y * T + 2}" width="4" height="4" fill="var(--map-sign)"/>`;
  for (const [x, y, k] of m.objects) {
    const cx = x * T + 4, cy = y * T + 4;
    if (k === 'cut') r += `<path d="M${cx} ${cy - 4}l4 7h-8z" fill="var(--map-tree)"/>`;
    else if (k === 'rock-smash' || k === 'strength') r += `<circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--map-rock)"/>`;
    else r += spotPerson(cx, cy, 'var(--map-person)');
  }
  const trainers = (loc.trainers || []), tk = typeof trainerKey === 'function' ? trainerKey : (l, t) => `${l}:trainer:${t.id}`;
  const L = spotLabels(m);
  let badges = '';
  for (const tr of L.trainers) {
    const id = 'trainer:' + tr.id, t = trainers.find(x => x.id === tr.id);
    const done = t && checks[tk(locId, t)], cx = tr.x * T + 4, cy = tr.y * T + 4;
    r += `<a href="${spotHref(locId, id)}"><title>${esc(tr.name)}${done ? ' (beaten)' : ''}</title><rect x="${tr.x * T - 4}" y="${tr.y * T - 4}" width="16" height="16" fill="transparent"/>${spotPerson(cx, cy, done ? 'var(--map-done)' : 'var(--map-trainer)', true)}</a>`;
    badges += `<a href="${spotHref(locId, id)}">${spotBadge(cx, cy, W, tr.label, done ? 'var(--map-done)' : 'var(--map-trainer)', tr.later)}</a>`;
  }
  for (const it of L.items) {
    const cx = it.x * T + 4, cy = it.y * T + 4, done = checks[`${locId}:item:${it.id}`];
    if (done && it.id !== target) continue;  // found items disappear (unless it's the one you opened)
    const col = 'var(--map-item)';
    r += `<a href="${spotHref(locId, it.id)}"><title>${esc(it.name)}${it.hidden ? ' (hidden)' : ''}${done ? ' (found)' : ''}</title><rect x="${it.x * T - 4}" y="${it.y * T - 4}" width="16" height="16" fill="transparent"/>` + (it.hidden
      ? `<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" transform="rotate(45 ${cx} ${cy})" fill="none" stroke="${col}" stroke-width="1.8"/>`
      : spotBall(cx, cy, col)) + '</a>';
    badges += `<a href="${spotHref(locId, it.id)}">${spotBadge(cx, cy, W, it.label, 'var(--map-ink)', it.later)}</a>`;
  }
  // people who give you something: one marker each, gone once you have everything they give
  const givers = {};
  for (const g of L.gifts) (givers[g.x + ',' + g.y] ||= []).push(g);
  for (const gs of Object.values(givers)) {
    const g = gs[0], cx = g.x * T + 4, cy = g.y * T + 4, id = 'gift:' + g.id;
    if (gs.every(x => checks[`${locId}:gift:${x.id}`]) && !gs.some(x => 'gift:' + x.id === target)) continue;
    r += `<a href="${spotHref(locId, id)}"><title>${esc(gs.map(x => x.name).join(', '))}${g.from ? ` (from ${esc(g.from)})` : ''}</title><rect x="${g.x * T - 4}" y="${g.y * T - 4}" width="16" height="16" fill="transparent"/>${spotPerson(cx, cy, 'var(--map-gift)', true)}${spotBall(cx + 4, cy + 3, 'var(--map-item)')}</a>`;
    if (g.label) badges += `<a href="${spotHref(locId, id)}">${spotBadge(cx, cy, W, g.label, 'var(--map-ink)', g.later)}</a>`;
  }
  const t = spotFind(m, target);
  if (t) {
    const cx = t.x * T + 4, cy = t.y * T + 4;
    r += `<circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="var(--map-target)" stroke-width="3" class="spotpulse"/>
      <line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="var(--map-target)" stroke-width=".6" stroke-dasharray="2 3"/>
      <line x1="0" y1="${cy}" x2="${W}" y2="${cy}" stroke="var(--map-target)" stroke-width=".6" stroke-dasharray="2 3"/>`;
  }
  // at least 7px a tile on a phone, so a wide map scrolls sideways instead of shrinking
  return `<div class="spotwrap"><svg class="spotmap" viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(m.w * 7, 2000)}px" role="img" aria-label="Map of ${esc(m.where)}">
    ${SPOT_DEFS}<rect width="${W}" height="${H}" fill="var(--map-floor)"/>${r}${badges}</svg></div>${spotKey(m, loc, target, checks)}`;
}
// the key under a map: each number or letter, what it is, and a box to tick it off (tap the name to circle it)
function spotKey(m, loc, target, checks) {
  const L = spotLabels(m), locId = loc.id, tk = typeof trainerKey === 'function' ? trainerKey : (l, t) => `${l}:trainer:${t.id}`;
  const rows = [], laterRows = [];
  // items and gifts together, in number order
  const got = [...L.items.map(it => ({ it })), ...L.gifts.map(g => ({ g }))].sort((a, b) => ((a.it || a.g).o ?? 1e9) - ((b.it || b.g).o ?? 1e9));
  for (const { it, g } of got) {
    if (g) {
      const k = `${locId}:gift:${g.id}`, lg = (loc.gifts || []).find(x => x.id === g.id);
      if (checks[k] && 'gift:' + g.id !== target) continue;  // gifts you have leave the key too
      (lg?.later ? laterRows : rows).push(checkRow(k, checks[k], `<b class="spotnum">${g.label}</b> ${esc(g.name)}`, (g.from ? `Gift from ${esc(g.from)}` : 'Gift') + (lg?.later && lg.need ? ` · needs ${esc(lg.need)}` : ''), `<a class="info" href="${spotHref(locId, 'gift:' + g.id)}">ⓘ</a>`));
      continue;
    }
    const k = `${locId}:item:${it.id}`;
    if (checks[k] && it.id !== target) continue;  // found items leave the key too
    const li = loc.items.find(x => x.id === it.id);
    (li?.later ? laterRows : rows).push(checkRow(k, checks[k], `<b class="spotnum">${it.label}</b> ${esc(it.name)}`, (it.hidden ? 'Hidden item' : 'Item ball') + (li?.later && li.need ? ` · needs ${esc(li.need)}` : ''), `<a class="info" href="${spotHref(locId, it.id)}">ⓘ</a>`));
  }
  for (const tr of L.trainers) {
    const t = (loc.trainers || []).find(x => x.id === tr.id);
    if (!t) continue;
    const k = tk(locId, t);
    (t.later ? laterRows : rows).push(checkRow(k, checks[k], `<b class="spotnum trainer">${tr.label}</b> ${esc(tr.name)}`, (checks[k] ? 'Trainer · beaten' : 'Trainer') + (t.later && t.reach ? ` · needs ${esc(t.reach)}` : ''), `<a class="info" href="${spotHref(locId, 'trainer:' + tr.id)}">ⓘ</a>`));
  }
  const n = rows.length + laterRows.length;
  return n ? `<details class="spotkey"${target ? '' : ' open'}><summary>Key: ${n} on this map</summary>${rows.join('') || '<p class="note">Nothing left here on your first visit.</p>'}${laterRows.length
    ? `<div class="spotlater"><b>Come back later (${laterRows.length})</b><span class="note"> · dashed labels on the map</span></div>${laterRows.join('')}` : ''}</details>` : '';
}
const spotFind = (m, target) => !target ? null : target.startsWith('trainer:') ? (m.trainers || []).find(t => 'trainer:' + t.id === target)
  : target.startsWith('gift:') ? (m.gifts || []).find(g => 'gift:' + g.id === target) : m.items.find(i => i.id === target);
// where it is in words, from the nearest door or sign
function spotWords(m, t) {
  const marks = [...m.doors.map(p => [...p, 'door']), ...m.signs.map(p => [...p, 'sign'])];
  if (!marks.length) return '';
  const [x, y, k] = marks.reduce((a, b) => Math.abs(b[0] - t.x) + Math.abs(b[1] - t.y) < Math.abs(a[0] - t.x) + Math.abs(a[1] - t.y) ? b : a);
  const dx = t.x - x, dy = t.y - y;
  if (!dx && !dy) return `Right on the ${k}.`;
  const parts = [dy && `${Math.abs(dy)} step${Math.abs(dy) > 1 ? 's' : ''} ${dy > 0 ? 'down' : 'up'}`, dx && `${Math.abs(dx)} step${Math.abs(dx) > 1 ? 's' : ''} ${dx > 0 ? 'right' : 'left'}`].filter(Boolean);
  return `About ${parts.join(' and ')} from the nearest ${k === 'door' ? 'doorway or exit' : 'sign'} (as the map is drawn: up is north).`;
}
const SPOT_LEGEND = `<div class="card spotlegend"><span><i style="background:var(--map-target)"></i>Selected</span><span><i class="dia"></i>Hidden item</span><span><i class="dot"></i>Item ball</span>
    <span><i class="dot" style="background:var(--map-gift)"></i>Gives you something</span><span><i class="dot" style="background:var(--map-trainer)"></i>Trainer</span><span><i class="dot" style="background:var(--map-done)"></i>Beaten trainer</span><span><i class="dot" style="background:var(--map-person)"></i>Other person</span>
    <span><i style="background:var(--map-grass)"></i>Tall grass</span><span><i style="background:var(--map-water)"></i>Water</span><span><i style="background:var(--map-wall)"></i>Wall, tree or rock</span>
    <span><i style="background:var(--map-door)"></i>Door or exit</span><span><i style="background:var(--map-sign)"></i>Sign</span><span><i style="background:var(--map-ledge)"></i>Ledge (jump down)</span>
    <span><i class="tri"></i>Tree to Cut</span><span><i class="dot" style="background:var(--map-rock)"></i>Rock or boulder</span></div>`;
async function renderSpot(locId, target) {
  const loc = state.locations[locId];
  if (!loc) return renderHome();
  setHeader(loc.name, true, 'routes');
  view.innerHTML = '<div class="card"><p class="note">Loading the map…</p></div>';
  let d;
  try { d = await spotData(locId); } catch (e) { view.innerHTML = '<div class="card"><p class="note">This map isn\'t available offline yet. Open it once while online.</p></div>'; return; }
  if (!location.hash.startsWith(`#/spot/${locId}`)) return;  // moved on while it loaded
  if (target === 'all') target = null;
  const s = cur();
  const maps = target ? d.maps.filter(m => spotFind(m, target)) : d.maps;
  const m0 = maps[0], t0 = m0 && spotFind(m0, target);
  let html = '', after = '';
  if (target?.startsWith('trainer:')) {
    const t = (loc.trainers || []).find(x => 'trainer:' + x.id === target);
    // the map first, then the full trainer card (team, counters) under it
    if (t) after = trainerCard(t, battleStage(t, locId), { loc: locId, open: false }).replace(/<a class="tag catchlink spotlink"[^>]*>Show on map<\/a>/, '');
    html += `<div class="card"><div class="spothead"><b>${esc(t0?.name || 'Trainer')}</b></div>${m0 && t0 ? `<p class="note">${esc(m0.where)} · ${spotWords(m0, t0)}</p>` : ''}</div>`;
  } else if (target?.startsWith('gift:')) {
    const g = (loc.gifts || []).find(x => 'gift:' + x.id === target);
    if (g) {
      const k = `${locId}:gift:${g.id}`;
      html += `<div class="card"><div class="spothead"><b>${esc(g.name)}</b>${g.from ? ` · from ${esc(g.from)}` : ''}</div>
        <p class="note">${esc(m0 ? m0.where : g.where)}${g.later && g.need ? ` · Come back later: ${esc(g.need)}` : ''}</p>${m0 && t0 ? `<p class="note">${spotWords(m0, t0)}</p>` : ''}
        ${checkRow(k, s.checks[k], 'Got it', 'Tick it off once you have it')}</div>`;
    }
  } else if (target) {
    const it = loc.items.find(i => i.id === target);
    if (it) {
      const k = `${locId}:item:${it.id}`;
      html += `<div class="card"><div class="spothead"><b>${esc(it.name)}</b> · ${it.hidden ? 'hidden: press A facing that tile, or use the Itemfinder' : 'on the ground (an item ball)'}</div>
        <p class="note">${esc(m0 ? m0.where : it.where)}${it.later && it.need ? ` · Come back later: ${esc(it.need)}` : ''}</p>${m0 && t0 ? `<p class="note">${spotWords(m0, t0)}</p>` : ''}
        ${checkRow(k, s.checks[k], 'Found it', it.hidden ? 'Tick it off once you have picked it up' : 'Tick it off once you have it')}</div>`;
    }
  } else {
    const ni = d.maps.reduce((a, m) => a + m.items.filter(i => !s.checks[`${locId}:item:${i.id}`]).length, 0), nt = d.maps.reduce((a, m) => a + (m.trainers || []).length, 0);
    const ng = d.maps.reduce((a, m) => a + (m.gifts || []).filter(g => !s.checks[`${locId}:gift:${g.id}`]).length, 0);
    html += `<div class="card"><p class="note">${ni} item${ni === 1 ? '' : 's'} left to find, ${ng ? `${ng} gift${ng === 1 ? '' : 's'} to collect, ` : ''}and ${nt} trainer${nt === 1 ? '' : 's'} here. Numbers are things to collect and letters are trainers, in the order the ${esc(loc.name)} page lists them. Things you tick off disappear from the map. Tap any marker for details.</p></div>`;
  }
  for (const m of maps) html += `${maps.length > 1 || !target ? `<h2>${esc(m.where)}</h2>` : ''}<div class="card spotcard">${spotSvg(m, loc, target, s.checks)}</div>`;
  html += after + SPOT_LEGEND + `<p class="note">Drawn from the game's map data. ${target ? `<a href="#/spot/${locId}/all">Whole map of ${esc(loc.name)}</a> · ` : ''}<a href="#/loc/${locId}">Back to ${esc(loc.name)}</a></p>`;
  view.innerHTML = html;
  // a big map scrolls inside its box: centre the selected marker there, and keep the page itself at the top
  const wrap = view.querySelector?.('.spotwrap'), svg = wrap?.querySelector('svg');
  if (wrap && svg && t0) {
    const k = svg.clientWidth / (m0.w * 8);
    wrap.scrollLeft = (t0.x * 8 + 4) * k - wrap.clientWidth / 2;
    wrap.scrollTop = (t0.y * 8 + 4) * k - wrap.clientHeight / 2;
  }
}
Object.assign(PAGES, { spot: renderSpot });
// ticking something off on a map page redraws it, so a found item disappears and a beaten trainer turns grey
view.addEventListener('change', e => {
  if (e.target.dataset?.key && location.hash.startsWith('#/spot/')) setTimeout(() => route(true), 0);
});
