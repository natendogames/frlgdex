'use strict';
// Auto team and auto levels (autoteam.js). Run with: node tests/autoteam.js
// - Ticking off a Pokémon the Team plan uses puts it on the Battle plan team (not one it doesn't use, not a second of
//   the same evolution line, not past six), and Undo takes it off again.
// - With auto levels on, every trainer card takes your team to be the level of that trainer's strongest Pokémon,
//   ignoring typed levels. With it off, typed levels count again.
const { loadApp } = require('./harness');
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; if (failures < 40) console.error('FAIL ' + m); } };
(async () => {
  const app = await loadApp(require('./files.json'));
  const { state, view } = app, get = app.get;
  const V = Object.keys(state.progress.saves)[0];
  state.progress.version = V;
  const s = app.cur();
  ok(get('autoTeamOn')() && get('autoLevelOn')(), 'both settings are on by default');
  // ---- auto team ----
  const starter = get('CHOICES').find(c => c.id === 'starter'), opt = starter.options[0];
  state.teamPlan = require('../data/team-plan.json');
  get('setPick')('starter', opt.key);
  const plan = app.planOf(V, opt.key), want = get('planWants')();
  const lineOf = app.lineOf, onTeamLine = n => s.team.some(t => lineOf(t)[0] === lineOf(n)[0]);
  const used = [...want].find(n => !onTeamLine(n) && !s.caught[n]);
  ok(used, 'the Team plan uses a Pokémon not on the team yet');
  s.caught[used] = true;
  ok(get('autoTeamAdd')(used) === 'added' && s.team.includes(used), `${app.mon(used).name}, which the Team plan uses, goes on the team`);
  const sameLine = [...want].concat(lineOf(used)).find(n => n !== used && lineOf(n)[0] === lineOf(used)[0]);
  if (sameLine) { s.caught[sameLine] = true; ok(get('autoTeamAdd')(sameLine) === '' && !s.team.includes(sameLine), 'no second Pokémon from the same evolution line'); }
  const unused = state.dex.find(p => !want.has(p.dex) && !onTeamLine(p.dex)).dex;
  s.caught[unused] = true;
  ok(get('autoTeamAdd')(unused) === '' && !s.team.includes(unused), `${app.mon(unused).name}, which the Team plan doesn't use, stays off the team`);
  // Undo after the toast takes it off the team again
  s.team = s.team.filter(n => n !== used); delete s.caught[used];
  get('showUndo')(`dex:${used}`, undefined, 'Ticked');
  s.caught[used] = true; get('autoTeamAdd')(used);
  ok(s.team.includes(used), 'added before undo');
  app.ctx.document.getElementById('undoBtn').onclick();
  ok(!s.team.includes(used) && !s.caught[used], 'Undo takes it off the team and unticks it');
  // a full team takes nobody else
  const six = state.dex.filter(p => !want.has(p.dex)).slice(0, 6).map(p => p.dex);
  const keep = s.team; s.team = six;
  s.caught[used] = true;
  ok(get('autoTeamAdd')(used) === 'full' && s.team.length === 6, 'a full team takes nobody else');
  state.progress.autoTeam = false; s.team = [];
  ok(get('autoTeamAdd')(used) === '' && !s.team.length, 'Auto team off adds nobody');
  state.progress.autoTeam = true; s.team = keep;
  // ---- auto levels ----
  s.team = s.team.length ? s.team : [plan.legs[0].team[0].dex];
  for (const n of s.team) (s.teamMeta ||= {})[n] = { level: 77 };
  let cards = 0;
  for (const t of state.trainers.concat(Object.values(state.locations).flatMap(l => l.trainers || []).slice(0, 80))) {
    const party = get('partyOf')(t);
    if (!party.length) continue;
    const ace = Math.max(5, ...party.map(p => p.level)); // your starter is Lv 5 at least
    const html = app.foeRow(party[0], app.battleStage(t, t.location), party);
    ok(html.includes(`Lv ${ace}*`) && !html.includes('Lv 77'), `${t.name}: team taken as Lv ${ace}, their strongest`);
    cards++;
  }
  ok(cards > 20, `checked ${cards} trainers`);
  app.ctx.location.hash = '#/planner'; app.route(true);
  ok(view.innerHTML.includes('id="autoLevel" checked') && view.innerHTML.includes('placeholder="auto" disabled'), 'Battle plan shows the settings and no level boxes to fill');
  state.progress.autoLevel = false;
  { const t = state.trainers[0], party = get('partyOf')(t);
    ok(app.foeRow(party[0], app.battleStage(t, t.location), party).includes('Lv 77'), 'Auto levels off: your typed levels count'); }
  app.ctx.location.hash = '#/settings'; app.route(true);
  ok(view.innerHTML.includes('id="autoTeam"') && view.innerHTML.includes('id="autoLevel"'), 'settings page has both settings');
  // picks: when two Pokémon both win in the same number of hits and take as many, the harder hitter goes first
  // (Nate: Pikachu's Thunder Shock 48-61% over Spearow's Peck 43-52% against Calvin's Hoothoot in Seaglass)
  { const rank = get('rankDuels'), avg = d => d.mine ? (d.mine.min + d.mine.max) / 2 : 0; let pairs = 0;
    const mons = state.dex.filter(p => p.dex <= 151).slice(0, 60).map(p => p.dex);
    for (const t of state.trainers.slice(0, 6)) for (const p of get('partyOf')(t)) {
      const foe = app.foeBattler(p), ds = mons.map(n => app.duel(app.battler(n, p.level, 15, app.defaultMoves(n, p.level)), foe)).sort(rank);
      for (let i = 1; i < ds.length; i++) { const x = ds[i - 1], y = ds[i];
        if (x.wins === y.wins && x.myHits === y.myHits && Math.min(x.theirHits, 99) === Math.min(y.theirHits, 99)) { pairs++; ok(avg(x) >= avg(y), `${t.name}'s ${p.name}: ${app.mon(x.me.dex).name} ranked over harder-hitting ${app.mon(y.me.dex).name}`); } } }
    ok(pairs > 0, 'tie-break pairs checked'); }
  if (failures) { console.error(`${failures} of ${checks} checks failed`); process.exit(1); }
  console.log(`autoteam: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
