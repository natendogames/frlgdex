'use strict';
// Checks the competitive builds (data/builds.json, builds.js): every Pokémon has builds, every move is legal in Gen 3
// for that Pokémon and the page says how to get it in this game, items and abilities exist, EV spreads are legal,
// Hidden Power IVs give the right type, and every Pokémon page renders its builds. Run: node tests/builds.js
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const app = await loadApp(FILES);
  const g = app.get, state = app.state;
  await g('loadBuilds')();
  const B = state.builds;
  const TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
  const hpType = iv => { const [h, a, d, sa, sd, s] = iv; const b = [h, a, d, s, sa, sd].map((v, i) => (v & 1) << i).reduce((x, y) => x + y); return TYPES[Math.floor(b * 15 / 63)]; };
  const natures = new Set(g('NATURES').map(x => x[0]));
  let sets = 0, drafts = 0;
  for (let n = 1; n <= 386; n++) {
    const p = app.mon(n), list = B.species[n];
    if (!list?.length) { fail(`${p.name} has no builds`); continue; }
    for (const e of list) for (const st of e.sets) {
      sets++; if (st.draft) drafts++;
      const where = `${e.name} ${st.format} "${st.name}"`;
      if (!B.formats[st.format]) fail(`${where}: unknown format`);
      if (st.moves.length < 1 || st.moves.length > 4) fail(`${where}: ${st.moves.length} move slots`);
      for (const slot of st.moves) for (const mv of slot) {
        const base = mv.startsWith('Hidden Power') ? 'Hidden Power' : mv;
        if (!state.moves[base]) fail(`${where}: unknown move ${mv}`);
        if (!e.learn[base]) fail(`${where}: no Gen 3 source for ${mv}`);
        const how = g('moveHow')(n, mv, e.learn[base]);
        if (!how.text || /not learnable/i.test(how.text)) fail(`${where}: ${mv}: ${how.text}`);
        if (mv.startsWith('Hidden Power ')) {
          const hp = st.hiddenPower?.[mv.slice(13)];
          if (!hp) fail(`${where}: ${mv} without IVs`);
          else if (hpType(hp.ivs) !== mv.slice(13)) fail(`${where}: IVs ${hp.ivs} give Hidden Power ${hpType(hp.ivs)}`);
        }
      }
      for (const it of st.items) if (!state.items[it]) fail(`${where}: unknown item ${it}`);
      for (const a of st.abilities) if (!p.abilities.includes(a)) fail(`${where}: ${p.name} can't have ${a}`);
      for (const nat of st.natures) if (!natures.has(nat)) fail(`${where}: bad nature ${nat}`);
      if (st.evs.length !== 6 || st.evs.some(v => v < 0 || v > 255) || st.evs.reduce((a, b) => a + b, 0) > 510) fail(`${where}: bad EVs ${st.evs}`);
      if (st.level !== (st.format === 'lc' ? 5 : 100)) fail(`${where}: level ${st.level}`);
      if (e.draft && !st.draft) fail(`${where}: a hand-written set must be marked Draft`);
    }
  }
  if (sets < 1000) fail(`only ${sets} sets`);

  // known moves resolve the way the game teaches them
  const how = (n, mv) => g('moveHow')(n, mv, B.species[n][0].learn[mv] || '');
  for (const [n, mv, want] of [[94, 'Thunderbolt', /^TM24/], [94, 'Ice Punch', /Emerald or Pokémon XD/], [94, 'Hypnosis', /Known at the start|Level/],
    [94, 'Explosion', /Move tutor/], [65, 'Hidden Power Fire', /TM10.*isn't in/], [235, 'Spore', /Sketch/], [3, 'Sleep Powder', /Level/]])
    if (!want.test(strip(how(n, mv).text))) fail(`#${n} ${mv}: "${strip(how(n, mv).text)}" should match ${want}`);
  if (!g('itemHow')('Leftovers').ok) fail('Leftovers should be obtainable in FRLG');

  // Deoxys shows the form from the player's version
  state.progress.version = 'FR';
  if (g('buildsFor')(386).map(e => e.name).join() !== 'Deoxys-Attack') fail('FireRed should show Deoxys-Attack');
  state.progress.version = 'LG';
  if (g('buildsFor')(386).map(e => e.name).join() !== 'Deoxys-Defense') fail('LeafGreen should show Deoxys-Defense');

  // every Pokémon page renders its builds, with no gaps
  for (const V of ['FR', 'LG']) {
    state.progress.version = V;
    for (let n = 1; n <= 386; n++) {
      app.ctx.location.hash = `#/mon/${n}`;
      try { app.route(); } catch (e) { fail(`#/mon/${n}: ${e.message}`); continue; }
      const html = app.view.innerHTML;
      if (!html.includes('Competitive builds') || !html.includes('Copy for Showdown')) fail(`#/mon/${n} (${V}): no builds shown`);
      if (/undefined|NaN|\[object Object\]/.test(strip(html))) fail(`#/mon/${n} (${V}): ${strip(html).match(/.{0,60}(undefined|NaN|\[object Object\]).{0,30}/)[0]}`);
    }
  }
  // Showdown export text
  const gengar = B.species[94][0];
  const txt = g('showdownText')(gengar, gengar.sets.find(s => s.moves.some(m => m.includes('Hidden Power Grass'))));
  for (const line of ['Gengar @ Leftovers', 'Ability: Levitate', 'Timid Nature', 'IVs: 30 Atk / 30 SpA']) if (!txt.includes(line)) fail(`Showdown text missing "${line}":\n${txt}`);

  console.log(`${sets} sets for 386 Pokémon (${drafts} Draft) checked`);
  if (fails.length) { console.log(fails.slice(0, 60).join('\n')); console.log(`${fails.length} failures`); process.exit(1); }
  console.log('builds: all checks passed');
})();
