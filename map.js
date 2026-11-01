'use strict';
// Tappable town map: the game's own region-map grid (data/region-map.json), each square shaded by how much of that
// place you've done. Caves and buildings that share a square are listed when you tap it.

// Places with no square of their own, shown under the square they're in or next to
const MAP_HOST = { 'ember-spa': 'kindle-road', 'pokemon-league': 'indigo-plateau', 'rocket-hideout': 'celadon-city', 'rocket-warehouse': 'five-isle-meadow',
  'silph-co': 'saffron-city', 'ss-anne': 'vermilion-city', 'tanoby-key': 'sevault-canyon', 'three-isle-path': 'three-isle-port',
  'underground-path-east-west': 'route-7', 'underground-path-north-south': 'route-5' };
function mapGroups(cells) {
  // one square -> the locations on it (map layer first), plus the hosted places
  const sq = {};
  for (const [x, y, loc, layer] of cells) {
    const g = (sq[`${x},${y}`] ||= { x, y, locs: [] });
    if (!g.locs.includes(loc)) layer === 'map' ? g.locs.unshift(loc) : g.locs.push(loc);
  }
  for (const g of Object.values(sq)) for (const [k, host] of Object.entries(MAP_HOST)) if (g.locs[0] === host && !g.locs.includes(k)) g.locs.push(k);
  return Object.values(sq);
}
// Short labels inside town squares (routes stay blank)
const MAP_ABBR = { 'celadon-city': 'Cd', 'cerulean-city': 'Ce', 'cinnabar-island': 'Ci', 'indigo-plateau': 'IP', 'one-island': '1', 'two-island': '2',
  'three-island': '3', 'four-island': '4', 'five-island': '5', 'six-island': '6', 'seven-island': '7' };
function mapAbbr(loc) {
  if (MAP_ABBR[loc]) return MAP_ABBR[loc];
  return /-(city|town)$/.test(loc) ? state.locations[loc].name.slice(0, 2) : '';
}
function groupDone(locs) {
  let d = 0, t = 0;
  for (const l of locs) { const x = locStats(state.locations[l]); d += x.done; t += x.total; }
  return { d, t };
}
function renderMap(arg) {
  setHeader('Town map', true, 'routes');
  if (!state.regionMap) {
    view.innerHTML = '<div class="card">Loading the map…</div>';
    getJSON('data/region-map.json').then(d => { state.regionMap = d; if (location.hash.startsWith('#/map')) renderMap(arg); })
      .catch(err => { view.innerHTML = `<div class="card">Could not load the map: ${esc(err.message)}</div>`; });
    return;
  }
  const regions = Object.keys(state.regionMap), region = regions.includes(arg) ? arg : regions[0];
  const groups = mapGroups(state.regionMap[region]), here = state.index[currentStage()].id;
  const C = 16;
  const sel = state.mapSel && groups.find(g => `${g.x},${g.y}` === state.mapSel);
  const rects = groups.map(g => {
    const { d, t } = groupDone(g.locs), f = t ? d / t : 1;
    const fill = !t ? 'var(--line)' : f === 1 ? 'var(--done)' : f > 0 ? `color-mix(in srgb, var(--done) ${Math.round(25 + 60 * f)}%, var(--card))` : 'var(--card)';
    const isHere = g.locs.includes(here), isSel = sel === g;
    const name = g.locs.map(l => state.locations[l].name).join(', ');
    return `<rect x="${g.x * C + 1}" y="${g.y * C + 1}" width="${C - 2}" height="${C - 2}" rx="3" fill="${fill}" stroke="${isSel ? 'var(--accent)' : isHere ? 'var(--text)' : 'var(--muted)'}" stroke-width="${isSel || isHere ? 2 : 0.6}" data-sq="${g.x},${g.y}" tabindex="0" role="button" aria-label="${esc(name)}: ${d} of ${t} done"><title>${esc(name)} ${d}/${t}</title></rect>
      ${mapAbbr(g.locs[0]) ? `<text x="${g.x * C + C / 2}" y="${g.y * C + C / 2 + 2.2}" class="maplbl">${esc(mapAbbr(g.locs[0]))}</text>` : ''}
      ${g.locs.length > 1 ? `<circle cx="${g.x * C + C - 4}" cy="${g.y * C + 4}" r="2" fill="var(--accent)" pointer-events="none"/>` : ''}`;
  }).join('');
  // crop to the squares in use (with room for labels) so the map fills the screen
  const xs = groups.map(g => g.x), ys = groups.map(g => g.y);
  const X0 = Math.min(...xs) * C - 4, Y0 = Math.min(...ys) * C - 4, W = (Math.max(...xs) + 1) * C - X0 + 4, H = (Math.max(...ys) + 1) * C - Y0 + 10;
  view.innerHTML = `<div class="chips" style="margin-bottom:10px">${regions.map(r => `<a class="chip ${r === region ? 'on' : ''}" href="#/map/${encodeURIComponent(r)}">${esc(r)}</a>`).join('')}</div>
    <div class="card mapcard"><svg viewBox="${X0} ${Y0} ${W} ${H}" class="townmap" role="img" aria-label="${esc(region)} town map">${rects}</svg>
    <p class="note">Tap a square to open that place. Towns are labelled (Pa = Pallet, Cd = Celadon, Ce = Cerulean, Ci = Cinnabar, IP = Indigo Plateau). Darker green = more done; outlined = where you are; a red dot means a cave or building shares the square.</p></div>
    ${sel ? `<div class="card">${sel.locs.map(l => { const x = locStats(state.locations[l]); return `<a class="card loc" href="#/loc/${l}"><div class="name">${esc(state.locations[l].name)}<div class="meta">${x.done}/${x.total} done</div>${bar(x.done, x.total)}</div><span>&rsaquo;</span></a>`; }).join('')}</div>` : ''}`;
  view.querySelectorAll('[data-sq]').forEach(r => {
    const go = () => {
      const g = groups.find(x => `${x.x},${x.y}` === r.dataset.sq);
      if (g.locs.length === 1) { location.hash = `#/loc/${g.locs[0]}`; return; }
      state.mapSel = r.dataset.sq; renderMap(region);
    };
    r.onclick = go; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}
Object.assign(PAGES, { map: renderMap });
TOOLS.push({ id: '#/map', title: 'Town map', desc: 'Kanto and the Sevii Islands, shaded by how much of each place you have done' });
