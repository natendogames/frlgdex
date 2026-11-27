'use strict';
// High-value catches (highvalue.js). Run with: node tests/high_value.js
// Route, Pokédex and Pokémon pages flag a wild Pokémon when the Battle plan or Team plan wants it for one of the
// next key battles, up to the second Gym Leader-type battle you haven't beaten. Each starter is checked against
// every point of the game: a flag only names a battle in that window, never a legendary or a caught Pokémon, and only
// a Pokémon you can catch by that battle. Beating a battle moves the window on.
const fs = require('fs'), path = require('path');
const { loadApp } = require('./harness');
const FILES = require('./files.json');

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; if (failures < 40) console.error('FAIL ' + msg); } };

(async () => {
  const app = await loadApp(FILES);
  const { state, view } = app, get = app.get;
  const V = Object.keys(state.progress.saves)[0];
  state.progress.version = V;
  state.teamPlan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/team-plan.json'), 'utf8'));
  const highValue = get('highValue'), upcomingBattles = get('upcomingBattles'), LEGENDARY = get('LEGENDARY'), HV_GYM = get('HV_GYM');
  const s = () => state.progress.saves[V];
  const trainers = state.trainers;
  const gymIdx = trainers.map((t, i) => (HV_GYM.has(t.class) ? i : -1)).filter(i => i >= 0);
  let flagged = 0;

  for (const st of Object.keys(app.STARTER_BASE)) {
    // walk the story: beat every key battle before the k-th one, with the Team plan lineup for that point
    const plan = app.planOf(V, st);
    for (let k = 0; k < trainers.length; k++) {
      state.progress.saves[V] = { caught: {}, checks: {}, team: [], picks: { starter: st }, teamMeta: {} };
      for (let j = 0; j < k; j++) s().checks[app.trainerKey(trainers[j].location, trainers[j])] = true;
      const leg = plan?.legs.find(l => l.battle.id === trainers[k].id);
      if (leg) for (const m of leg.team) { s().team.push(m.dex); s().caught[m.dex] = 'team'; s().teamMeta[m.dex] = { level: m.level, moves: [0, 1, 2, 3].map(i => m.moves[i] || '') }; }
      s().here = trainers[k].location;
      const ups = upcomingBattles();
      ok(ups.length && ups[0].t.id === trainers[k].id, `${st} @${trainers[k].id}: the window starts at the next unbeaten battle`);
      const lastGym = gymIdx.filter(i => i >= k)[1];
      ok(ups.length === (lastGym === undefined ? trainers.length - k : lastGym - k + 1), `${st} @${trainers[k].id}: window runs to the second gym after (${ups.map(u => u.t.id).join(', ')})`);
      const names = new Set(ups.map(u => u.t.name));
      for (const [dex, reasons] of highValue()) {
        flagged++;
        ok(!LEGENDARY.has(dex), `${st} @${trainers[k].id}: legendary #${dex} flagged`);
        ok(!s().caught[dex], `${st} @${trainers[k].id}: caught #${dex} flagged`);
        for (const r of reasons) {
          ok(names.has(r.battle), `${st} @${trainers[k].id}: #${dex} flagged for ${r.battle}, outside the window`);
          const t = ups.find(u => u.t.name === r.battle)?.t;
          if (t && r.text.startsWith('Battle plan')) ok(app.catchableBy(app.battleStage(t, t.location)).some(c => c.dex === dex), `${st}: #${dex} can't be caught by ${t.name}`);
        }
      }
    }
  }
  ok(flagged > 0, 'something is flagged somewhere');

  // the flag shows on a route row, the Pokédex and the Pokémon page, and goes away once you catch it
  const st = Object.keys(app.STARTER_BASE)[0];
  state.progress.saves[V] = { caught: {}, checks: {}, team: [], picks: { starter: st }, teamMeta: {} };
  const [dex] = [...highValue().keys()].filter(d => state.index.some(l => state.locations[l.id].encounters.some(e => e.dex === d)));
  ok(dex, 'a flagged Pokémon has a route');
  if (dex) {
    const loc = state.index.find(l => state.locations[l.id].encounters.some(e => e.dex === dex)).id;
    const rowHas = () => { app.ctx.location.hash = `#/loc/${loc}`; app.route(true); const h = view.innerHTML, i = h.indexOf(`data-key="dex:${dex}"`); return i >= 0 && /class="tag hv/.test(h.slice(i, i + 1500).split(/<div class="row[ "]/)[0]); };
    ok(rowHas(), `route row for #${dex} on ${loc} has the ★ tag`);
    app.ctx.location.hash = '#/dex'; app.route(true);
    ok(view.innerHTML.includes('class="tag hv'), 'Pokédex shows the ★ tag');
    app.ctx.location.hash = `#/mon/${dex}`; app.route(true);
    ok(view.innerHTML.includes('Worth catching for your next battles'), 'Pokémon page shows the reasons');
    s().caught[dex] = true;
    ok(!highValue().has(dex), 'caught Pokémon is no longer flagged');
    ok(!rowHas(), 'route row loses the tag once caught');
  }

  if (failures) { console.error(`${failures} of ${checks} checks failed`); process.exit(1); }
  console.log(`high_value: ${checks} checks passed, ${flagged} flags across every point of the game`);
})().catch(e => { console.error(e); process.exit(1); });
