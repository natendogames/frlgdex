'use strict';
// Completion trackers: one-time encounters and gifts, move tutors, Unown forms, VS Seeker rematches and the
// Sevii Islands story. Loaded after tools.js.

// ---------- one-time Pokémon ----------
// Legendaries and other single encounters (miss them and they're gone), plus Pokémon you're given once.
const ONCE_NOTE = { 'route-12': 'Wake it with the Poké Flute. Save first.', 'route-16': 'Wake it with the Poké Flute. Save first.',
  'power-plant': 'Save first. The Electrode look like item balls.', 'seafoam-islands': 'Needs Strength to reach B4F. Save first.',
  'mt-ember': 'At the summit, after the Sevii story starts. Save first.', 'cerulean-cave': 'After you become Champion and finish the Sevii story. Save first.',
  'berry-forest': "Lostelle's Hypno: a battle, not a catch chance worth planning on.", 'navel-rock': 'Event only (Mystic Ticket).', 'birth-island': 'Event only (Aurora Ticket).' };
function onceList() {
  const out = [];
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const e of loc.encounters) {
      if (!inVersion(e)) continue;
      if (e.method === 'static' || e.method === 'roaming' || (e.method === 'gift' && !CHOICE_OF[`${l.id}:dex:${e.dex}`])) out.push({ loc: l.id, name: loc.name, e });
    }
  }
  return out;
}
function renderOnce() {
  const s = cur();
  const rows = onceList();
  const done = rows.filter(r => isCaught(r.e.dex)).length;
  view.innerHTML = `<div class="card"><b>${done}/${rows.length}</b> caught ${bar(done, rows.length)}<p class="note">Legendaries, Snorlax and Pokémon you only get once, in story order. Save before each one: if it faints or you run, it's gone for good.</p></div>
    <div class="card">${rows.map(({ loc, name, e }) => checkRow(`dex:${e.dex}`, isCaught(e.dex), `${esc(e.name)} ${types(e.dex)}`,
      `<a href="#/loc/${loc}">${esc(name)}</a> · ${esc(METHOD_LABEL[e.method] || e.method)}${e.levels ? ` · Lv ${esc(e.levels)}` : ''}${e.notes && e.method === 'roaming' ? ` · ${esc(e.notes)}` : ''}${ONCE_NOTE[loc] ? ` · ${esc(ONCE_NOTE[loc])}` : ''}`, infoA(e.dex))).join('')}</div>`;
  void s;
}

// ---------- move tutors ----------
const tutorKey = t => `${t.loc}:tutor:${t.id}`;
function tutorRow(t) {
  const s = cur(), team = s.team.filter(n => t.learners.includes(n));
  const sub = `${esc(t.where)}${t.note ? ` · ${esc(t.note)}` : ' · one use only'} · ${team.length ? `<span class="good">Your team: ${team.map(n => esc(mon(n).name)).join(', ')}</span>` : s.team.length ? 'nobody on your team can learn it' : `${t.learners.length} Pokémon can learn it`}`;
  return checkRow(tutorKey(t), s.checks[tutorKey(t)], `${esc(t.move)}${state.moves[t.move]?.type ? ` ${typeTag(state.moves[t.move].type)}` : ''}`, sub, ` <span class="tag">Tutor</span>`);
}
function tutorSection(loc) {
  const list = state.extras.tutors.filter(t => t.loc === loc.id);
  return list.length ? `<h2>Move tutors</h2><div class="card">${list.map(tutorRow).join('')}<p class="note">Tick one off once you've used it.</p></div>` : '';
}
function renderTutors() {
  const list = state.extras.tutors;
  view.innerHTML = `<div class="card"><p class="note">Each tutor teaches its move once per save file (the Cape Brink tutor once for each starter line). Pick who gets it with care.</p></div>
    <div class="card">${list.map(t => `<div class="area"><a href="#/loc/${t.loc}">${esc(state.locations[t.loc].name)}</a></div>${tutorRow(t)}`).join('')}</div>`;
}

// ---------- Unown ----------
function renderUnown() {
  const s = cur(), ch = state.extras.unown;
  const all = Object.values(ch).flat(), done = all.filter(x => s.checks[`unown:${x}`]).length;
  view.innerHTML = `<div class="card"><b>${done}/${all.length}</b> forms ${bar(done, all.length)}<p class="note">Unown live in the seven Tanoby Chambers on Seven Island, after you become Champion and solve the Tanoby Key puzzle. Each chamber has its own letters.</p>
    <a href="#/loc/tanoby-ruins">Tanoby Ruins page</a></div>
    ${Object.entries(ch).map(([name, letters]) => `<h2>${esc(name)}</h2><div class="card chips">${letters.map(x => `<label class="chip ${s.checks[`unown:${x}`] ? 'on' : ''}"><input type="checkbox" class="vh" data-key="unown:${x}" ${s.checks[`unown:${x}`] ? 'checked' : ''}>${x}</label>`).join('')}</div>`).join('')}`;
}

// ---------- VS Seeker rematches ----------
const TIER_AT = { 'After you get the VS Seeker': 'vermilion-city', 'After you reach Celadon City': 'celadon-city', 'After you reach Fuchsia City': 'fuchsia-city',
  'After you become Champion': 'pokemon-league', 'After linking with Ruby or Sapphire': 'tanoby-ruins' };
function rematchBlock(t, locId) {
  const r = (state.extras.rematches[locId] || []).find(x => x.id === t.id);
  if (!r) return '';
  return `<details class="later rematch"><summary><h2>VS Seeker rematches (${r.tiers.length})</h2></summary>${r.tiers.map(x => {
    const stage = Math.max(stageOf(locId), stageOf(TIER_AT[x.after] || locId));
    return `<div class="area">${esc(x.after)} · Lv ${Math.max(...x.party.map(p => p.level))}</div>${x.party.map(p => foeRow(p, stage, x.party)).join('')}`;
  }).join('')}<p class="note">Use the VS Seeker (from the Vermilion City Pokémon Center) near trainers you've beaten. Rematches are good EXP and money.</p></details>`;
}

// ---------- Sevii Islands story ----------
const QUESTS = [
  ['One Island', [['q-celio', 'one-island', 'After Blaine, Bill takes you to One Island. Meet Celio at the Pokémon Center.'],
    ['q-hm06', 'ember-spa', 'Get HM06 Rock Smash from the man at the Ember Spa on Kindle Road.'],
    ['q-mtember', 'mt-ember', 'Beat the two Rocket Grunts on Mt. Ember, then climb to the summit for Moltres (save first).'],
    ['q-ruby', 'mt-ember', 'Solve Ruby Path (needs Rock Smash and Strength) and take the Ruby.']]],
  ['Two and Three Island', [['q-bikers', 'three-island', 'Clear the bikers out of Three Island.'],
    ['q-lostelle', 'berry-forest', 'Find Lostelle in Berry Forest and bring her home to Two Island (the Two Island shop grows).'],
    ['q-givruby', 'one-island', 'Give Celio the Ruby, then head back to Kanto for the eighth badge and the League.']]],
  ['After you become Champion', [['q-natdex', 'pallet-town', 'Get the National Pokédex from Professor Oak (needs 60 Pokémon seen).'],
    ['q-rainbow', 'one-island', 'Celio gives you the Rainbow Pass for Four to Seven Island and asks for the Sapphire.'],
    ['q-icefall', 'icefall-cave', 'Help Lorelei drive Team Rocket out of Icefall Cave on Four Island; pick up HM07 Waterfall there.'],
    ['q-dotted', 'dotted-hole', 'Read the braille in Ruin Valley on Six Island to open the Dotted Hole and find the Sapphire. A Rocket scientist steals it.'],
    ['q-warehouse', 'rocket-warehouse', "Find the two Rocket Warehouse passwords on Five Island, then beat the Admins and Gideon to get the Sapphire back."],
    ['q-givsapph', 'one-island', 'Give Celio the Sapphire. You can now trade with Ruby, Sapphire and Emerald.']]],
  ['Everything else', [['q-selphy', 'lost-cave', 'Find Lady Selphy in the Lost Cave (Five Island) for her butler at Resort Gorgeous.'],
    ['q-trainertower', 'trainer-tower', 'Clear Trainer Tower on Seven Island.'],
    ['q-tanoby', 'tanoby-ruins', 'Open the Tanoby Chambers and collect Unown.'],
    ['q-mewtwo', 'cerulean-cave', 'Cerulean Cave opens: catch Mewtwo (save first).'],
    ['q-roam', 'roaming', 'Catch the roaming legendary beast (which one depends on your starter).'],
    ['q-daycare', 'four-island', 'Breed at the Four Island Day Care for the Pokémon you can only hatch.']]]
];
function renderQuests() {
  const s = cur(), all = QUESTS.flatMap(([, l]) => l), done = all.filter(([id]) => s.checks[`quest:${id}`]).length;
  view.innerHTML = `<div class="card"><b>${done}/${all.length}</b> steps ${bar(done, all.length)}<p class="note">The Sevii Islands story and the post-game, in order.</p></div>
    ${QUESTS.map(([title, list]) => `<h2>${esc(title)}</h2><div class="card">${list.map(([id, loc, text]) => checkRow(`quest:${id}`, s.checks[`quest:${id}`], esc(text), `<a href="#/loc/${loc}">${esc(state.locations[loc]?.name || loc)}</a>`)).join('')}</div>`).join('')}`;
}

LOC_SECTIONS.push(tutorSection);
TOOLS.push({ id: 'once', title: 'One-time Pokémon', desc: 'Legendaries, Snorlax and gift Pokémon you only get one chance at', render: renderOnce },
  { id: 'tutors', title: 'Move tutors', desc: 'All 16 one-use tutors, where they are and who on your team can learn each move', render: renderTutors },
  { id: 'unown', title: 'Unown forms', desc: 'All 28 forms by Tanoby chamber', render: renderUnown },
  { id: 'quests', title: 'Sevii Islands story', desc: 'Ruby, Sapphire and the post-game, step by step', render: renderQuests });
