'use strict';
// "Show on map": every item has a drawn map with its tile marked (data/itemmaps, from scripts/mapdraw.py), every item
// row and the "Before you leave" card link to it, and the map page renders for every item.
// Run: node tests/item_maps.js
const fs = require('fs'), path = require('path');
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);
(async () => {
  const app = await loadApp(FILES);
  const { state } = app, g = app.get;
  const renderSpot = g('renderSpot');
  let placed = 0, total = 0;
  for (const l of state.index) for (const t of state.locations[l.id].trainers || []) { total++; if (t.map) placed++; }
  console.log(`${placed}/${total} trainers placed on a map (the rest appear by script, not as a standing trainer)`);
  if (placed < total * 0.9) fail(`only ${placed}/${total} trainers placed`);
  let checked = 0;
  for (const l of state.index) {
    const loc = state.locations[l.id];
    if (!loc.items.length) continue;
    const f = path.join(__dirname, '..', 'data', 'itemmaps', l.id + '.json');
    const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { maps: [] };
    for (const it of loc.items) {
      checked++;
      if (!it.map) { fail(`${l.id}: ${it.name} has no map`); continue; }
      const m = d.maps.find(m => m.items.some(i => i.id === it.id));
      if (!m) { fail(`${l.id}: ${it.name} is not on any drawn map`); continue; }
      const t = m.items.find(i => i.id === it.id);
      if (m.tiles.length !== m.w * m.h) fail(`${l.id} ${m.map}: tiles ${m.tiles.length} != ${m.w}x${m.h}`);
      if (!(t.x >= 0 && t.y >= 0 && t.x < m.w && t.y < m.h)) fail(`${l.id}: ${it.name} at ${t.x},${t.y} is off the ${m.w}x${m.h} map`);
      if (t.hidden !== it.hidden) fail(`${l.id}: ${it.name} hidden flag differs on the map`);
      app.ctx.location.hash = `#/spot/${l.id}/${encodeURIComponent(it.id)}`;
      await renderSpot(l.id, it.id);
      const h = app.view.innerHTML || '';
      if (!h.includes('class="spotpulse"') || !h.includes(it.name.replace(/&/g, '&amp;'))) fail(`${l.id}: map page for ${it.name} has no marker`);
    }
    for (const t of loc.trainers || []) {
      if (!t.map) continue;
      checked++;
      const m = d.maps.find(m => (m.trainers || []).some(x => x.id === t.id)), x = m && m.trainers.find(x => x.id === t.id);
      if (!x || !(x.x >= 0 && x.y >= 0 && x.x < m.w && x.y < m.h)) { fail(`${l.id}: trainer ${t.name} marked map but not placed`); continue; }
      app.ctx.location.hash = `#/spot/${l.id}/${encodeURIComponent('trainer:' + t.id)}`;
      await renderSpot(l.id, 'trainer:' + t.id);
      if (!(app.view.innerHTML || '').includes('class="spotpulse"')) fail(`${l.id}: map page for trainer ${t.name} has no marker`);
    }
    if (d.maps.length) {
      if (!loc.mapCount) fail(`${l.id}: has maps but no Map button`);
      app.ctx.location.hash = `#/spot/${l.id}/all`; await renderSpot(l.id, 'all');
      const h = app.view.innerHTML || '';
      if ((h.match(/<svg class="spotmap"/g) || []).length !== d.maps.length) fail(`${l.id}: whole map shows ${(h.match(/<svg class="spotmap"/g) || []).length} of ${d.maps.length} maps`);
    }
    app.ctx.location.hash = `#/loc/${l.id}`; app.route();
    const h = app.view.innerHTML || '';
    for (const it of loc.items) if (!it.later && !h.includes(`#/spot/${l.id}/${encodeURIComponent(it.id)}"`)) fail(`${l.id}: no Show on map button for ${it.name}`);
    for (const t of loc.trainers || []) if (t.map && !t.later && !h.includes(`#/spot/${l.id}/${encodeURIComponent('trainer:' + t.id)}"`)) fail(`${l.id}: no Show on map button for trainer ${t.name}`);
    if (loc.mapCount && !h.includes(`#/spot/${l.id}/all"`)) fail(`${l.id}: no Map button on the page`);
  }
  console.log(`${checked} items checked`);
  if (fails.length) { console.log(fails.slice(0, 40).join('\n')); console.log(`${fails.length} failures`); process.exit(1); }
  console.log('all items and placed trainers have a map');
})();
