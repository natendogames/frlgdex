'use strict';
// Items split by when you can reach them (scripts/reach.py walks the decomp's map tiles at build time).
// Checks: every "come back later" item says what it needs and when; known cases (Route 103's east side) stay put;
// every item Bulbapedia's walkthrough marks "(requires Surf/Cut/...)" that you can't have on your first visit is
// "come back later" in the app; and the location page draws the split. Run: node tests/item_reach.js
const fs = require('fs'), path = require('path');
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const ROOT = path.join(__dirname, '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const fails = [];
const fail = m => fails.push(m);
const norm = s => String(s).toLowerCase().replace(/é/g, 'e').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

// Bulbapedia's words for each field move -> the build's ability names
const WORDS = { surf: 'surf', cut: 'cut', 'rock smash': 'rock-smash', strength: 'strength', dive: 'dive', waterfall: 'waterfall',
  'mach bike': 'mach-bike', 'acro bike': 'acro-bike', 'devon scope': 'devon-scope', 'poké flute': 'poke-flute', 'poke flute': 'poke-flute' };
// Bulbapedia items whose "requires" note the app answers differently on purpose (location id:item name -> why)
const KNOWN = J('tests/item_reach_known.json');
// Things Nate found listed as first visit that you can only get later (location, kind, name)
const LATER_CASES = J('tests/later_cases.json');

(async () => {
  const app = await loadApp(FILES);
  const state = app.state, stageOf = app.stageOf;
  const reach = J('data/verify/item-reach.json');
  let later = 0, total = 0;
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const i of loc.items) {
      total++;
      if (!i.later) continue;
      later++;
      if (!i.need) fail(`${l.id}: ${i.name} is "come back later" but says nothing about what it needs`);
      if (!state.locations[i.after]) fail(`${l.id}: ${i.name} opens after unknown place ${i.after}`);
      if (!(i.stage > stageOf(l.id))) fail(`${l.id}: ${i.name} is "come back later" at stage ${i.stage}, not after its own place (${stageOf(l.id)})`);
    }
  }
  // Known cases: Route 2's east side is behind a Cut tree; Route 10's hidden Max Ether is across the water
  for (const [lid, n] of [['route-2', 'Ether'], ['route-10', 'Max Ether']]) {
    const i = (state.locations[lid]?.items || []).find(x => x.name === n);
    if (!i) fail(`${lid}: no ${n}`); else if (!i.later) fail(`${lid}: ${n} should be "come back later"`);
  }
  // Everything else on a page that can wait (gifts, shops, move tutors) says what it needs and when
  for (const l of state.index) {
    const loc = state.locations[l.id];
    const things = [...loc.gifts.map(g => ['gift', g]), ...(state.extras.shops[l.id] || []).map(x => ['shop', x]), ...state.extras.tutors.filter(t => t.loc === l.id).map(t => ['tutor', t])];
    for (const [kind, x] of things) {
      total++;
      if (!x.later) continue;
      later++;
      if (!x.need || !state.locations[x.after] || !(x.stage > stageOf(l.id))) fail(`${l.id}: ${kind} ${x.name || x.move || x.where} is "come back later" without a reason or a later stage`);
    }
  }
  for (const [lid, kind, name] of LATER_CASES) {
    const loc = state.locations[lid];
    const x = kind === 'item' ? loc.items.find(i => i.name === name) : kind === 'gift' ? loc.gifts.find(g => g.name === name)
      : kind === 'tutor' ? state.extras.tutors.find(t => t.loc === lid && t.move === name) : (loc.trainers || []).find(t => t.name === name);
    if (!x) fail(`${lid}: no ${kind} ${name}`); else if (!x.later) fail(`${lid}: ${kind} ${name} should be under "come back later"`);
  }
  // Bulbapedia cross-check
  const bp = J(fs.existsSync(path.join(ROOT, 'data/verify/bulbapedia-emerald.json')) ? 'data/verify/bulbapedia-emerald.json' : 'data/verify/bulbapedia-frlg.json');
  let top = [], checked = 0;
  for (const s of bp.sections) {
    const ids = headingLocs(s.heading, state.index);
    const here = s.level === 2 ? (top = ids) : (ids.length ? ids : top);
    for (const it of s.items) {
      const m = /requires? ([^)]*)\)/i.exec(it.note || '');
      if (!m) continue;
      const needs = m[1].toLowerCase().split(/,\s*|\s+and\s+|\s*&\s*/).map(w => w.replace(/^and\s+/, '').trim()).filter(Boolean);
      const abil = needs.map(w => WORDS[w]);
      if (abil.some(a => !a || !reach.abilities[a])) continue; // a key, a ticket...: not a field move
      const at = Math.max(...abil.map(a => reach.abilities[a].stage));
      for (const lid of here) {
        const cands = (state.locations[lid]?.items || []).filter(x => norm(x.name.split(' ×')[0]) === norm(it.name) && !!x.hidden === !!it.hidden);
        if (!cands.length) continue;
        checked++;
        const key = `${lid}:${it.name}`;
        if (at <= reach.firstVisitUntil[lid]) continue; // you already have it on the first visit
        if (cands.some(x => x.later) || KNOWN[key]) continue;
        fail(`${key}: Bulbapedia says it requires ${m[1]} (not yours on a first visit), but the app lists it as first visit`);
      }
    }
  }
  // the page: first-visit lists, then a collapsed "Items: come back later" with the reason
  app.ctx.location.hash = '#/loc/route-2'; app.route();
  const html = app.view.innerHTML || '';
  const cut = html.indexOf('Items: come back later');
  if (cut < 0) fail('Route 2 page has no "Items: come back later" section');
  else {
    if (!/<details class="later">[^]*Items: come back later/.test(html)) fail('"Items: come back later" should be collapsed');
    const first = html.slice(0, cut);
    if (/Parlyz Heal/.test(first.slice(first.indexOf('<h2>Items')))) fail('Route 2 lists Parlyz Heal (behind a Cut tree) as a first-visit item');
  }
  // gift and trade Pokémon wait with their giver, and walkthrough steps about only later things wait too
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const g of loc.gifts.filter(g => g.later))
      for (const e of loc.encounters.filter(e => ['gift', 'trade'].includes(e.method) && (e.notes || '').startsWith(g.name)))
        if (app.encStage(l.id, e) <= stageOf(l.id)) fail(`${l.id}: ${e.name} (${g.name}) is a first-visit Pokémon row but its giver is "come back later"`);
  }
  {
    app.ctx.location.hash = '#/loc/route-2'; app.route();
    const page = app.view.innerHTML || '';
    const firstPart = (h, title) => h.slice(0, Math.max(0, h.indexOf(title)));
    if (/Mr\. Mime/.test(firstPart(page, 'Pokémon: come back later').split('<h2>Pokémon</h2>')[1] || '')) fail('Route 2 shows the Mr. Mime trade (behind a Cut tree) as a first-visit Pokémon');
    if (/HM05/.test(firstPart(page, 'Walkthrough: come back later'))) fail('Route 2 walkthrough shows the HM05 step (behind a Cut tree) as first visit');
  }
  if (fails.length) { console.log(fails.map(f => 'FAIL ' + f).join('\n')); process.exit(1); }
  console.log(`item reach OK: ${later} of ${total} items, gifts, shops and tutors are "come back later"; ${checked} Bulbapedia "requires" notes checked; ${reach.puzzles.length} puzzle items timed by their map`);
})();

// Location ids a Bulbapedia heading names ("Routes 105 and 106" -> two), as in scripts/verify_bulbapedia.py
function headingLocs(h, index) {
  const base = h.replace(/\s*\(.*?\)/g, '').trim();
  const nums = /^Routes? ([\d ,and]+)$/.exec(base);
  if (nums) return (nums[1].match(/\d+/g) || []).map(x => 'route-' + x);
  if (/^trick house/i.test(base)) return ['route-110'].filter(id => index.some(l => l.id === id));
  const b = base.replace(/^back to /i, '');
  return b.split('/').flatMap(piece => index.filter(l => norm(l.name) === norm(piece)).map(l => l.id));
}
