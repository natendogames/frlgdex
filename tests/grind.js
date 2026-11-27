'use strict';
// Best Pokémon to train on (grind.js). Run with: node tests/grind.js
// Every location with wild Pokémon on a first visit shows the one or two that give the most EXP per battle. Picks come
// only from what you can battle there now (never gifts, trades, legendaries or "come back later" encounters), most EXP
// first, and the EXP matches the Gen 3 formula.
const { loadApp } = require('./harness');
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; if (failures < 40) console.error('FAIL ' + m); } };
(async () => {
  const app = await loadApp(require('./files.json'));
  const { state, view } = app, get = app.get;
  const V = Object.keys(state.progress.saves)[0];
  state.progress.version = V;
  const grindPicks = get('grindPicks'), grindSearchable = get('grindSearchable'), encStage = get('encStage'), LEGENDARY = get('LEGENDARY');
  let shown = 0;
  for (const l of state.index) {
    const encs = get('locView')(state.locations[l.id]).encs, here = app.stageOf(l.id); // this version's encounters, as the page shows them
    const now = encs.filter(e => encStage(l.id, e) <= here);
    const picks = grindPicks(now);
    // rare ones (under 5%) only count when the DexNav can search for them
    const wild = now.filter(e => !['gift', 'trade', 'static', 'roaming', 'game-corner'].includes(e.method) && !LEGENDARY.has(e.dex) && !(e.rate && parseFloat(e.rate) < 5 && !grindSearchable(e)));
    if (wild.length) ok(picks.length >= 1 && picks.length <= 2, `${l.id}: ${picks.length} picks from ${wild.length} wild encounters`);
    for (const x of picks) {
      ok(now.includes(x.e), `${l.id}: ${x.e.name} is not a first-visit encounter`);
      ok(!['gift', 'trade', 'static', 'roaming'].includes(x.e.method) && !LEGENDARY.has(x.e.dex), `${l.id}: ${x.e.name} (${x.e.method}) should not be a pick`);
      ok(x.exp === Math.max(1, Math.floor(app.mon(x.e.dex).expYield * ((x.lo + x.hi) / 2) / 7)), `${l.id}: ${x.e.name} EXP ${x.exp}`);
    }
    // nothing on the list gives more EXP than the top pick
    if (picks.length) for (const e of wild) {
      const lv = (e.levels || '').split('-').map(Number).filter(n => n > 0);
      if (!lv.length || !app.mon(e.dex).expYield) continue;
      const exp = Math.max(1, Math.floor(app.mon(e.dex).expYield * ((Math.min(...lv) + Math.max(...lv)) / 2) / 7));
      ok(exp <= picks[0].exp, `${l.id}: ${e.name} gives ${exp} EXP, more than the top pick ${picks[0].e.name} (${picks[0].exp})`);
    }
    app.ctx.location.hash = `#/loc/${l.id}`; app.route(true);
    const has = view.innerHTML.includes('Best Pokémon to train on here');
    if (picks.length) { shown++; ok(has, `${l.id}: the training card is on the page`); for (const x of picks) ok(view.innerHTML.includes(`About ${x.exp} EXP a battle`), `${l.id}: ${x.e.name} EXP shown`); }
  }
  ok(shown > 20, `training card shown on ${shown} places`);
  // the Training spots page: only places you reach before the battle, and an EV ranking only lists that stat
  const grindSpots = get('grindSpots');
  const first = state.trainers.find(t => ['Leader', 'Elite Four', 'Champion'].includes(t.class)), st = app.battleStage(first, first.location);
  const exp = grindSpots(st, -1);
  ok(exp.length > 0, 'training spots before the first gym');
  ok(exp.every(x => app.stageOf(x.loc) <= st && encStage(x.loc, x.e) <= st), 'training spots are all reachable before the first gym');
  ok(exp.every((x, i) => !i || exp[i - 1].exp >= x.exp), 'training spots sorted by EXP');
  for (let k = 0; k < 6; k++) ok(grindSpots(st + 10, k).every(x => (app.mon(x.e.dex).ev || [])[k] > 0), `EV ranking ${k} only lists Pokémon that give it`);
  app.ctx.location.hash = '#/tools/train'; app.route(true);
  ok(view.innerHTML.includes('Train for:') && view.innerHTML.includes(first.name), 'Training spots page names the next big battle');
  if (failures) { console.error(`${failures} of ${checks} checks failed`); process.exit(1); }
  console.log(`grind: ${checks} checks passed, training picks on ${shown} places`);
})().catch(e => { console.error(e); process.exit(1); });
