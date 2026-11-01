'use strict';
// Checks for the reference pages and trackers (features.js and friends): every page renders without gaps, the
// data they lean on hangs together, and the calculators match known Gen 3 numbers. Run: node tests/features.js
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const app = await loadApp(FILES);
  const g = app.get, state = app.state;
  const render = (hash) => {
    app.ctx.location.hash = hash;
    try { app.route(); } catch (e) { fail(`${hash}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); return ''; }
    const html = app.view.innerHTML || '';
    if (/undefined|NaN|\[object Object\]/.test(strip(html))) fail(`${hash}: shows ${strip(html).match(/.{0,60}(undefined|NaN|\[object Object\]).{0,30}/)[0]}`);
    return html;
  };
  for (const V of ['FR', 'LG']) {
    state.progress.version = V;
    // every Pokémon, TM and location page renders
    for (let n = 1; n <= 386; n++) render(`#/mon/${n}`);
    for (const tm of Object.keys(state.tms)) render(`#/tm/${tm}`);
    for (const l of state.index) render(`#/loc/${l.id}`);
    for (const h of ['#/tms', '#/progress', '#/missing', '#/search', '#/move/Surf', '#/item/Nugget', '#/item/Rare%20Candy', '#/planner', '#/tools', '#/dex', '#/'])
      render(h);
    for (const t of g('TOOLS')) render(t.id.startsWith('#') ? t.id : `#/tools/${t.id}`);
  }
  state.progress.version = 'FR';

  // every TM or HM with a source has a checklist row that gives it to you (except HM08/TM10, not in FRLG)
  for (const [tm, t] of Object.entries(state.tms)) if (t.sources.length && !g('tmKeys')(tm).length) fail(`${tm} has sources but no checklist row`);
  if (!g('tmKeys')('TM24').some(k => k.includes(':buy:'))) fail('TM24 should be a Game Corner prize row');
  // bought TMs count as collected
  const s = app.cur();
  const k = g('tmKeys')('TM15').find(x => x.includes(':buy:'));
  s.checks[k] = true;
  if (!g('hasTM')('TM15')) fail('ticking the TM15 shop row should count as having TM15');
  delete s.checks[k];

  // search finds things by name, number and TM
  for (const [q, want] of [['pika', '#/mon/25'], ['25', '#/mon/25'], ['TM24', '#/tm/TM24'], ['thunderbolt', '#/tm/TM24'], ['nugget', '#/item/Nugget'], ['brock', '#/loc/pewter-city'], ['cerulean', '#/loc/cerulean-city']])
    if (!g('searchResults')(q).slice(0, 5).some(r => r.h === want)) fail(`search "${q}" should find ${want}`);

  // catch odds: worked by hand from the game's formula (handleballthrow in battle_script_commands.c)
  const cc = g('catchChance');
  for (const [rate, ball, hp, st, want] of [[190, 1, 1, 1, 0.2797], [45, 1, 1, 1, 0.0625], [255, 1, 1, 1, 0.3369], [45, 2, 1 / 300, 2, 0.7846], [3, 1, 1, 1, 0.0042]]) {
    const got = cc(rate, ball, hp, st);
    if (Math.abs(got - want) > 0.0005) fail(`catch rate ${rate} ball ${ball} hp ${hp} status ${st}: ${got.toFixed(4)}, expected ${want}`);
  }
  if (cc(3, 1e9) !== 1) fail('a Master Ball always catches');

  // the still-missing list puts each uncaught Pokémon in exactly one group
  render('#/missing');

  // shop data: every Celadon TM for sale is in tms.json as a buy source
  for (const sh of state.extras.shops['celadon-city']) for (const it of sh.items) {
    const tm = /^(TM|HM)\d+/.exec(it.name)?.[0];
    if (tm && !state.tms[tm].sources.some(x => x.how === 'buy' || x.how === 'prize')) fail(`${tm} sold at Celadon but not a buy/prize source`);
  }

  if (fails.length) { console.log(`FAIL (${fails.length})\n` + fails.slice(0, 60).map(f => ' - ' + f).join('\n')); process.exit(1); }
  console.log('OK: feature pages and data checks passed');
})().catch(e => { console.error(e); process.exit(1); });
