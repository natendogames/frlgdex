'use strict';
// Team plan checks. Run with: node tests/team_plan.js
// Checks data/team-plan.json (written by scripts/team_planner.js) against the game data: story order, legal
// catches, moves, evolutions and TMs, real battles, lead claims re-run through the damage engine, and the
// Team plan page's checkboxes.
const fs = require('fs'), path = require('path');
const { loadApp } = require('./harness');

let failures = 0, checks = 0;
const fail = msg => { failures++; console.error('FAIL ' + msg); };
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); };

(async () => {
  const app = await loadApp();
  const { state, mon, stageOf, catchableBy, battleStage, duel, foeBattler, battler } = app;
  const ROOT = path.join(__dirname, '..');
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/team-plan.json'), 'utf8'));
  const tms = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tms.json'), 'utf8'));
  const CELADON = stageOf('celadon-city');
  const learnset = d => typeof mon(d).learnset === 'string' ? [] : mon(d).learnset || [];
  const line = d => { const out = [d]; while (mon(out[0]).evolvesFrom) out.unshift(mon(out[0]).evolvesFrom); return out; };
  // When a TM is first in hand: a Gym Leader's after the win, the Cerulean Rocket Grunt's after Bill on Route 25.
  function tmStage(k) {
    return Math.min(...tms[k].sources.map(x => {
      if (x.loc === 'cerulean-city' && /Rocket Grunt/.test(x.from || '')) return stageOf('route-25');
      const t = x.from && (state.locations[x.loc].trainers || []).find(t => t.class === 'Leader' && x.from.startsWith(t.name));
      return t ? battleStage(t, x.loc) + 0.25 : stageOf(x.loc);
    }));
  }

  const want = ['FR', 'LG'].flatMap(v => ['Bulbasaur', 'Charmander', 'Squirtle'].map(s => `${v}:${s}`));
  ok(want.every(k => data.plans[k]), 'a plan for every version and starter');

  for (const [key, plan] of Object.entries(data.plans)) {
    const [V, starter] = key.split(':');
    state.progress.version = V;
    state.progress.saves[V] = { caught: {}, checks: {}, team: [], picks: { starter } };
    const startDex = app.STARTER_BASE[starter];
    let prevStage = -1, prevAce = 0;
    const got = new Set([startDex]), single = new Set(), level = {};
    ok(plan.legs.length >= 20, `${key}: has its key battles (${plan.legs.length})`);
    ok(plan.end.length === 6, `${key}: end-game team of six`);
    plan.legs.forEach((leg, i) => {
      const b = leg.battle, where = `${key} leg ${i + 1} (${b.name})`;
      const t = (state.locations[b.loc]?.trainers || []).find(t => t.id === b.id);
      ok(t, `${where}: battle ${b.loc}/${b.id} exists`);
      if (!t) return;
      const party = t.party || t.byStarter?.[starter];
      ok(party, `${where}: has a party for ${starter}`);
      if (!party) return;
      const stage = battleStage(t, b.loc);
      ok(stage >= prevStage, `${where}: in story order`);
      prevStage = stage;
      ok(b.ace === Math.max(...party.map(p => p.level)), `${where}: ace level matches the trainer`);
      ok(leg.team.length >= 1 && leg.team.length <= 6, `${where}: 1-6 in the lineup`);
      ok(leg.team.some(m => line(m.dex).includes(startDex)), `${where}: starter line is in the lineup`);
      const lv = Math.max(...leg.team.map(m => m.level));
      ok(lv >= prevAce, `${where}: levels never drop`);
      prevAce = lv;
      const reachable = new Set(catchableBy(stage).map(c => c.dex));
      for (const x of leg.steps) {
        if (x.kind === 'catch') {
          ok(reachable.has(x.dex), `${where}: ${mon(x.dex).name} can be caught by now`);
          got.add(x.dex);
        }
        if (x.kind === 'teach') {
          ok(tms[x.tm] && tms[x.tm].move === x.move, `${where}: ${x.tm} is ${x.move}`);
          ok(tmStage(x.tm) <= stage + 0.25, `${where}: ${x.tm} is in hand by now`);
          if (!tms[x.tm].reusable) { ok(!single.has(x.tm), `${where}: single-use ${x.tm} taught once`); single.add(x.tm); }
        }
      }
      const ids = leg.steps.map(x => x.id);
      ok(new Set(ids).size === ids.length, `${where}: step ids unique`);
      for (const m of leg.team) {
        const ln = line(m.dex);
        ok(ln.some(d => got.has(d)), `${where}: ${mon(m.dex).name} was caught first`);
        // evolution: each step of the line is a level evolution at or below this level, or a stone after Celadon
        for (let k = 1; k < ln.length; k++) {
          const e = (mon(ln[k - 1]).evolutions || []).find(e => e.into === ln[k]);
          ok(e && ((e.method === 'level' && e.param <= m.level) || (e.method === 'item' && /Stone$/.test(e.param) && stage >= CELADON)),
            `${where}: ${mon(ln[k - 1]).name} can become ${mon(ln[k]).name} by Lv ${m.level}`);
        }
        ok(m.level >= (level[m.dex] || 0), `${where}: ${mon(m.dex).name} level never drops`);
        level[m.dex] = m.level;
        ok(m.moves.length >= 1 && m.moves.length <= 4, `${where}: ${mon(m.dex).name} knows 1-4 moves`);
        for (const mv of m.moves) {
          const byLevel = ln.some(d => learnset(d).some(([l, n]) => n === mv && l <= m.level));
          const byTm = (mon(m.dex).tmhm || []).some(k => tms[k]?.move === mv && tmStage(k) <= stage + 0.25);
          ok(byLevel || byTm, `${where}: ${mon(m.dex).name} can know ${mv}`);
        }
      }
      // lead claims: re-run the one-on-one
      for (const l of leg.leads) {
        if (!l.by || !l.clean) continue;
        const foe = party.find(p => p.dex === l.foe && p.level === l.level);
        ok(foe, `${where}: lead foe ${mon(l.foe).name} Lv ${l.level} is in the party`);
        const m = leg.team.find(m => m.dex === l.by);
        ok(m, `${where}: lead ${mon(l.by).name} is in the lineup`);
        if (!foe || !m) continue;
        const r = duel(battler(m.dex, m.level, 15, m.moves), foeBattler(foe));
        ok(r.wins, `${where}: ${mon(m.dex).name} beats ${mon(l.foe).name}`);
      }
    });
    ok(plan.legs.at(-1).team.map(m => m.dex).sort().join() === [...plan.end].sort().join(), `${key}: last lineup is the end-game team`);
  }

  // ---- the page ----
  const { view } = app;
  state.teamPlan = data;
  state.progress.version = 'FR';
  state.progress.saves.FR = { caught: {}, checks: {}, team: [], picks: {} };
  app.renderPlan();
  ok(/Pick your starter/.test(view.innerHTML), 'page asks for a starter when none is picked');
  state.progress.saves.FR.picks.starter = 'Squirtle';
  app.renderPlan();
  const html = view.innerHTML, plan = data.plans['FR:Squirtle'];
  const keys = [...html.matchAll(/data-key="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const expected = plan.legs.flatMap(app.legKeys);
  ok(keys.length === expected.length && expected.every(k => keys.includes(k)), `page has a checkbox per step and battle (${keys.length}/${expected.length})`);
  ok(keys.includes('cerulean-city:trainer:rival-cerulean') || keys.some(k => k.includes(':trainer:')), 'battle boxes share the route page trainer keys');
  ok((html.match(/<details class="card leg/g) || []).length === plan.legs.length, 'one section per key battle');
  ok((html.match(/ open>/g) || []).length === 1, 'only the next leg is open');
  // ticking a box saves it
  const k = expected.find(x => x.startsWith('plan:')), change = view._l.change, cls = { classList: { toggle() {} } };
  change({ target: { dataset: { key: k }, checked: true, closest: s => (s === 'details.leg' ? null : cls) } });
  ok(state.progress.saves.FR.checks[k] === true, 'ticking a step saves it');
  app.renderPlan();
  ok(view.innerHTML.includes(`data-key="${k}" checked`), 'a ticked step stays ticked');
  change({ target: { dataset: { key: k }, checked: false, closest: s => (s === 'details.leg' ? null : cls) } });
  ok(!state.progress.saves.FR.checks[k], 'unticking a step clears it');
  // finishing the first leg opens the second
  for (const x of app.legKeys(plan.legs[0])) { if (x.startsWith('dex:')) state.progress.saves.FR.caught[x.slice(4)] = true; else state.progress.saves.FR.checks[x] = true; }
  app.renderPlan();
  ok(view.innerHTML.includes('data-leg="1" open>'), 'the next unfinished leg opens');
  // the lineup button fills the Battle plan
  app.copyLineup(plan.legs[5]);
  ok(state.progress.saves.FR.team.join() === plan.legs[5].team.map(m => m.dex).join(), 'lineup copied to the Battle plan team');
  const m0 = plan.legs[5].team[0];
  ok(state.progress.saves.FR.teamMeta[m0.dex].level === m0.level, 'lineup levels copied');

  console.log(`${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
