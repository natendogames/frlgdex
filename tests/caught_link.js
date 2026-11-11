'use strict';
// One caught list everywhere. Run with: node tests/caught_link.js
// The Battle plan team, the Team plan's catch/evolve steps, route rows and the Pokédex all share s.caught, and the
// starter pick keeps syncing with the team.
const fs = require('fs'), path = require('path');
const { loadApp } = require('./harness');

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error('FAIL ' + msg); } };

(async () => {
  const app = await loadApp();
  const { state, view } = app;
  const get = app.get;
  const V = Object.keys(state.progress.saves)[0];
  state.progress.version = V;
  const starters = Object.keys(app.STARTER_BASE), [A, B] = starters;
  const fresh = () => (state.progress.saves[V] = { caught: {}, checks: {}, team: [], picks: {} });
  const s = () => state.progress.saves[V];
  const change = (key, checked) => view._l.change({ target: { dataset: { key }, checked, closest: () => null } });
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/team-plan.json'), 'utf8'));
  state.teamPlan = plan;
  const renderPlanner = get('renderPlanner'), setPick = get('setPick'), linkCaught = get('linkCaught');
  const boxTicked = (html, n) => html.includes(`data-key="dex:${n}" checked`);
  const boxShown = (html, n) => html.includes(`data-key="dex:${n}"`);

  // a non-starter that a route lists, to check route rows
  const locId = Object.keys(state.locations).find(l => (state.locations[l].encounters || []).some(e => e.dex && e.method === 'grass'));
  const wild = state.locations[locId].encounters.find(e => e.dex && e.method === 'grass').dex;
  const routeHtml = () => { app.ctx.location.hash = `#/loc/${locId}`; app.route(true); return view.innerHTML; };

  // 1. adding a Pokémon to the Battle plan marks it caught on its route and in the Pokédex
  fresh();
  s().team.push(wild); get('markCaught')(wild);
  ok(s().caught[wild], 'team member is caught');
  ok(boxTicked(routeHtml(), wild), 'team member is ticked on its route page');
  app.ctx.location.hash = '#/dex'; app.route(true);
  ok(boxTicked(view.innerHTML, wild), 'team member is ticked in the Pokédex');

  // 2. the Battle plan shows each member's caught box, in step with the route and Pokédex
  renderPlanner();
  ok(boxShown(view.innerHTML, wild) && boxTicked(view.innerHTML, wild), 'Battle plan shows the member as caught');
  change(`dex:${wild}`, false);
  ok(!s().caught[wild], 'unticking on any page clears caught');
  renderPlanner();
  ok(boxShown(view.innerHTML, wild) && !boxTicked(view.innerHTML, wild), 'Battle plan reflects a cleared caught box');
  change(`dex:${wild}`, true);
  renderPlanner();
  ok(boxTicked(view.innerHTML, wild), 'ticking on a route shows in the Battle plan');

  // 3. Team plan catch and evolve steps are the caught box itself
  fresh(); s().picks.starter = A;
  const pl = app.planOf(V, A);
  const step = pl.legs.flatMap(l => l.steps).find(x => x.kind === 'catch');
  const evo = pl.legs.flatMap(l => l.steps).find(x => x.kind === 'evolve');
  app.renderPlan();
  ok(boxShown(view.innerHTML, step.dex), 'catch step uses the shared caught box');
  ok(!evo || boxShown(view.innerHTML, evo.dex), 'evolve step uses the shared caught box');
  change(`dex:${step.dex}`, true);
  ok(s().caught[step.dex], 'ticking a catch step marks it caught');
  app.renderPlan();
  ok(boxTicked(view.innerHTML, step.dex), 'Team plan shows it ticked');
  ok(!Object.keys(s().checks).some(k => k.endsWith(`catch-${step.dex}`)), 'no separate step check is kept');

  // 4. copying a Team plan lineup marks the lineup caught
  fresh(); s().picks.starter = A;
  app.copyLineup(pl.legs[5]);
  ok(pl.legs[5].team.every(m => s().caught[m.dex]), 'copied lineup is caught');

  // 5. old saves: team members and ticked Team plan catch steps become caught
  const old = { caught: {}, checks: { [`plan:${A}:catch-${step.dex}`]: true }, team: [wild], picks: {} };
  linkCaught(old);
  ok(old.caught[wild] && old.caught[step.dex], 'old team and ticked catch steps are migrated to caught');
  ok(!old.checks[`plan:${A}:catch-${step.dex}`], 'old step check is folded in');

  // 6. starter pick and Battle plan stay in sync, and a swap moves the caught mark
  fresh();
  setPick('starter', A);
  const a0 = app.STARTER_BASE[A], b0 = app.STARTER_BASE[B];
  ok(s().team[0] === a0 && s().caught[a0], 'starter pick goes on the team as caught');
  s().team[0] = a0 + 1; s().caught[a0 + 1] = 'team'; // it evolved
  setPick('starter', B);
  ok(s().team[0] === b0 + 1, 'switching the pick swaps the evolved starter');
  ok(!s().caught[a0] && !s().caught[a0 + 1], 'the old starter line is no longer caught');
  ok(s().caught[b0] && s().caught[b0 + 1], 'the new starter (and its stage) is caught');
  s().team.push(wild); s().caught[wild] = true;
  setPick('starter', A);
  ok(s().team.includes(wild) && s().caught[wild], 'other members are left alone');

  console.log(`${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
