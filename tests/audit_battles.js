'use strict';
// Battle planner audit. Run with: node tests/audit_battles.js [--report out.txt]
// For every Gym Leader, rival, Giovanni, Elite Four and Champion battle, in both versions and for every starter,
// it checks the catch suggestions against an independent brute-force search over the same data and asserts
// known-good answers. It also checks the type chart and move data the damage estimates rely on.
const fs = require('fs');
const { loadApp } = require('./harness');

const GEN3_CHART = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5, Steel: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Steel: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5 }
};
const chart = (a, d) => GEN3_CHART[a]?.[d] ?? 1;
const chartEff = (a, types) => types.reduce((m, d) => m * chart(a, d), 1);

// Types one of the suggestions must be able to hit with, per battle (any foe Pokémon on that team).
const MUST = {
  Brock: ['Water', 'Grass', 'Fighting', 'Ground'],
  Misty: ['Electric', 'Grass'],
  'Lt. Surge': ['Ground'],
  Erika: ['Fire', 'Flying', 'Ice', 'Poison', 'Bug', 'Psychic'],
  Koga: ['Ground', 'Psychic'],
  Sabrina: ['Bug', 'Ghost', 'Dark', 'Fire', 'Flying', 'Rock', 'Psychic', 'Ice', 'Ground'],
  Blaine: ['Water', 'Ground', 'Rock'],
  Giovanni: ['Water', 'Grass', 'Ice']
};
// Specific catches the planner must offer (empty team), by battle and foe: [version, species name at the catch, foe name]
const MUST_SPECIES = [
  ['FR', 'Misty', 'Staryu', ['Pikachu', 'Oddish']],
  ['LG', 'Misty', 'Staryu', ['Pikachu', 'Bellsprout']],
  ['FR', 'Misty', 'Starmie', ['Pikachu', 'Oddish']],
  ['FR', 'Lt. Surge', 'Raichu', ['Diglett']],
  ['FR', 'Brock', 'Onix', ['Mankey', 'Nidoran♂', 'Nidoran♀']]
];

const fails = [], report = [], counts = { trainers: 0 };
const fail = msg => fails.push(msg);
const strip = h => h.replace(/<table[\s\S]*?<\/table>/g, ' [duel table] ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

(async () => {
  const app = await loadApp();
  const { state, mon } = app;

  // ---- type chart ----
  const T = Object.keys(GEN3_CHART);
  for (const a of T) for (const d of T) {
    const got = state.types[a]?.[d] ?? 1;
    if (got !== chart(a, d)) fail(`type chart: ${a} -> ${d} is ${got}, expected ${chart(a, d)}`);
  }

  // ---- move data ----
  const MOVES = { Thundershock: ['Electric', 40], 'Vine Whip': ['Grass', 35], Absorb: ['Grass', 20], 'Water Gun': ['Water', 40], Ember: ['Fire', 40],
    'Low Kick': ['Fighting'], 'Karate Chop': ['Fighting', 50], 'Double Kick': ['Fighting', 30], Dig: ['Ground', 60], Earthquake: ['Ground', 100],
    Psychic: ['Psychic', 90], Confusion: ['Psychic', 50], 'Ice Beam': ['Ice', 95], Surf: ['Water', 95], Thunderbolt: ['Electric', 95], 'Razor Leaf': ['Grass', 55] };
  for (const [n, [t, p]] of Object.entries(MOVES)) {
    const m = state.moves[n];
    if (!m) { fail(`move ${n} missing`); continue; }
    if (m.type !== t || (p && m.power !== p)) fail(`move ${n}: ${m.type} ${m.power}, expected ${t} ${p}`);
  }
  for (const [n, e] of Object.entries({ Solarbeam: 'charge', Fly: 'charge', Dig: 'charge', 'Sky Attack': 'charge', 'Hyper Beam': 'recharge', 'Fake Out': 'fakeout', 'Triple Kick': 'triple', Explosion: 'explode' }))
    if (state.moves[n]?.effect !== e) fail(`move ${n} effect is ${state.moves[n]?.effect}, expected ${e}`);
  for (const p of state.dex) for (const [, mv] of p.learnset || []) if (!state.moves[mv]) fail(`${p.name} learns unknown move ${mv}`);

  // ---- move choice for your side ----
  for (const [dex, lvl, mv] of [[25, 18, 'Thundershock'], [43, 18, 'Absorb'], [69, 18, 'Vine Whip'], [44, 30, 'Absorb'], [56, 18, 'Karate Chop'], [56, 18, 'Low Kick']])
    if (!app.bestMoves(dex, lvl).includes(mv)) fail(`${mon(dex).name} Lv ${lvl} should keep ${mv}; got ${app.bestMoves(dex, lvl).join(', ')}`);

  // ---- story order ----
  const misty = state.trainers.find(t => t.name === 'Misty');
  if (app.battleStage(misty, misty.location) < app.stageOf('route-25')) fail('Misty should be planned after Routes 24 and 25');

  // Independent check: could anything catchable by this stage hit this foe super effectively with a level-up move?
  function oracle(foeMon, stage) {
    const out = [];
    for (const c of app.catchableBy(stage)) for (const f of app.evoForms(c.dex, foeMon.level, stage))
      for (const [mv] of app.learnedBy(f.dex, foeMon.level)) {
        const m = state.moves[mv];
        if (m && m.power && !['counter', 'dream', 'ohko', 'explode', 'fakeout'].includes(m.effect) && chartEff(m.type, mon(foeMon.dex).types) >= 2) out.push(`${mon(f.dex).name}:${mv}`);
      }
    return out;
  }

  for (const V of ['FR', 'LG']) for (const starter of ['Bulbasaur', 'Charmander', 'Squirtle']) {
    state.progress.version = V;
    const save = app.cur();
    save.picks = { starter }; save.team = []; save.teamMeta = {}; save.caught = {};
    // key battles (Battle plan tab) plus every trainer on every route, cave, building and Sevii Island page
    const all = [...state.trainers.map(t => ({ t, loc: t.location, key: true })),
      ...state.index.flatMap(l => (state.locations[l.id].trainers || []).map(t => ({ t, loc: l.id })))];
    for (const { t, loc, key } of all) {
      const party = t.party || t.byStarter[starter];
      if (!party) continue;
      if (t.party && starter !== 'Bulbasaur') continue; // non-rival teams don't depend on the starter
      const stage = app.battleStage(t, loc);
      if (stage < app.stageOf(loc)) fail(`${t.id} on ${loc} is planned before you can reach ${loc}`);
      const tag = `${V} ${key ? t.name : `${loc} ${t.class} ${t.name}`}${t.byStarter ? ` (${starter})` : ''}`;
      if (!key) counts.trainers++;
      const hitTypes = new Set();
      for (const p of party) {
        save.team = [];
        const foe = app.foeBattler(p);
        const sug = app.catchSuggestions(p, foe, stage, party, 3);
        for (const s of sug) {
          // each suggestion has to be catchable by then, evolve legally by this level and really hit super effectively
          const w = (state.found[s.c.dex] || []).find(x => (!x.versions || x.versions.includes(V)) && x.stage <= stage);
          if (!w) fail(`${tag} vs ${p.name}: ${mon(s.c.dex).name} is not catchable by ${state.index[stage].name}`);
          if (!app.evoForms(s.c.dex, s.level, stage).some(f => f.dex === s.f.dex)) fail(`${tag} vs ${p.name}: ${mon(s.c.dex).name} can't be ${mon(s.f.dex).name} by Lv ${s.level}`);
          if (s.level < p.level) fail(`${tag} vs ${p.name}: planned below the foe's level`);
          // moves must be ones it really has: from its catch moveset, learned after catching, or (from Two Island on) relearned
          const relearn = stage >= app.stageOf('two-island');
          const legal = app.learnedBy(s.f.dex, s.level, { dex: s.c.dex, level: parseInt(String(s.c.levels || '5'), 10) }, relearn);
          for (const mv of s.d.me.moves) if (!legal.has(mv)) fail(`${tag} vs ${p.name}: ${mon(s.f.dex).name} (caught as ${mon(s.c.dex).name}) can't know ${mv} at Lv ${s.level}`);
          for (const mv of s.d.se) {
            if (chartEff(state.moves[mv].type, mon(p.dex).types) < 2) fail(`${tag} vs ${p.name}: ${mv} is not super effective`);
            hitTypes.add(state.moves[mv].type);
          }
        }
        const or = oracle(p, stage);
        if (or.length && !sug.length) fail(`${tag} vs ${p.name} Lv ${p.level}: no catch suggested, but ${or.slice(0, 4).join(', ')} would hit it super effectively`);
        report.push(`${tag} vs ${p.name} Lv ${p.level} [planned at ${state.index[stage].name}]: ${sug.map(s => `${mon(s.f.dex).name}${s.f.dex !== s.c.dex ? ` (from ${mon(s.c.dex).name})` : ''} ${s.d.mine?.name} ${s.d.myHits} turns${s.d.wins ? '' : ' (may lose)'}${s.risk.length ? ' risk' : ''}`).join(' | ') || 'NONE'}`);
        for (const [v, who, foeName, names] of MUST_SPECIES)
          if (v === V && who === t.name && foeName === p.name && !app.catchableBy(stage).some(c => names.includes(mon(c.dex).name))) fail(`${tag}: none of ${names.join('/')} catchable before ${p.name}`);
        for (const [v, who, foeName, names] of MUST_SPECIES)
          if (v === V && who === t.name && foeName === p.name && !sug.some(s => names.includes(mon(s.c.dex).name)) && !app.catchSuggestions(p, foe, stage, party, 20).some(s => names.includes(mon(s.c.dex).name)))
            fail(`${tag} vs ${p.name}: expected ${names.join(' or ')} among the catch options`);

        // with a plausible team (starter line plus Pidgey line at the foe's level) the row should still render
        save.team = [app.lineOf(Object.values({ Bulbasaur: 3, Charmander: 6, Squirtle: 9 })[['Bulbasaur', 'Charmander', 'Squirtle'].indexOf(starter)])
          .filter(d => app.evoForms(app.lineOf(d)[0], p.level, stage).some(f => f.dex === d)).pop(), 16];
        const row = strip(app.foeRow(p, stage, party));
        if (/undefined|NaN/.test(row)) fail(`${tag} vs ${p.name}: row shows undefined/NaN: ${row.slice(0, 200)}`);
        report.push(`   with ${save.team.map(n => mon(n).name).join(' + ')}: ${row.replace(/^.*?Weak to:/, 'Weak to:').slice(0, 400)}`);
      }
      const want = key && MUST[t.name.replace(/ \(.*\)$/, '')];
      if (want && !want.some(x => hitTypes.has(x))) fail(`${tag}: no suggestion hits with ${want.join('/')}`);
    }
  }
  // Trainers you can only reach with an HM or later in the story must not be planned before you can get there
  const AFTER = [[/^(route-19|route-20|route-21|seafoam-islands|cinnabar-island|pokemon-mansion|power-plant)$/, 'safari-zone', 'Surf (after Koga)'],
    [/^(route-9|route-10|rock-tunnel)$/, 'ss-anne', 'Cut'], [/^(route-12|route-13|route-14|route-15)$/, 'pokemon-tower', 'the Poké Flute'],
    [/^(four-island|icefall-cave|five-island|five-isle-meadow|memorial-pillar|water-labyrinth|resort-gorgeous|rocket-warehouse|lost-cave|six-island|water-path|ruin-valley|green-path|pattern-bush|outcast-island|altering-cave|seven-island|trainer-tower|canyon-entrance|sevault-canyon|tanoby-ruins|cerulean-cave)$/, 'pokemon-league', 'becoming Champion']];
  for (const l of state.index) for (const t of state.locations[l.id].trainers || []) for (const [re, after, why] of AFTER)
    if (re.test(l.id) && app.battleStage(t, l.id) <= app.stageOf(after)) fail(`${l.id} ${t.id} is planned before ${why}`);

  // Surf encounters must not count before Koga; Old Rod not before Vermilion
  state.progress.version = 'FR';
  const koga = state.trainers.find(t => t.name === 'Koga');
  if (app.catchableBy(app.battleStage(koga, koga.location)).some(c => c.method === 'surf')) fail('Surf encounters counted before Koga');
  if (app.catchableBy(app.battleStage(misty, misty.location)).some(c => /rod|surf|rock-smash/.test(c.method))) fail('Fishing or Surf counted before Misty');

  const i = process.argv.indexOf('--report');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], report.join('\n') + '\n');
  if (fails.length) { console.log(`FAIL (${fails.length})\n` + fails.map(f => ' - ' + f).join('\n')); process.exit(1); }
  console.log(`OK: ${report.filter(r => !r.startsWith(' ')).length} foe Pokémon checked (key battles plus ${counts.trainers} route trainer battles) across both versions and all starters.`);
})().catch(e => { console.error(e); process.exit(1); });
