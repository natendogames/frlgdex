'use strict';
// FRLG Completion Dex: route checklists, Pokédex tracker, battle planner and tools.
// Progress is stored in localStorage under STORE_KEY with a separate save for each version.
// Optional cloud sync (worker/) keys a copy of that progress by email address, with no password.

const STORE_KEY = 'frlg-dex-progress-v1';
const SYNC_KEY = 'frlg-dex-sync-v1';
// URL of the deployed sync worker (see worker/README.md). Leave empty to hide cloud sync.
const SYNC_URL = 'https://frlg-dex-sync.natendogames.workers.dev';
const METHOD_LABEL = {
  grass: 'Grass / cave', surf: 'Surf', 'old-rod': 'Old Rod', 'good-rod': 'Good Rod', 'super-rod': 'Super Rod',
  'rock-smash': 'Rock Smash', static: 'Static', gift: 'Gift', trade: 'In-game trade', 'game-corner': 'Game Corner', roaming: 'Roaming'
};
const EVO_LABEL = {
  level: p => `Level ${p}`, item: p => `Use ${p}`, trade: () => 'Trade', 'trade-item': p => `Trade holding ${p}`,
  friendship: () => 'High friendship', 'friendship-day': () => 'High friendship (day)', 'friendship-night': () => 'High friendship (night)',
  'level-atk-gt-def': p => `Level ${p} (Atk > Def)`, 'level-atk-eq-def': p => `Level ${p} (Atk = Def)`, 'level-atk-lt-def': p => `Level ${p} (Atk < Def)`,
  'level-silcoon': p => `Level ${p} (random)`, 'level-cascoon': p => `Level ${p} (random)`, 'level-ninjask': p => `Level ${p}`,
  'level-shedinja': p => `Level ${p} (empty slot)`, beauty: () => 'High Beauty'
};
const EVENT_ONLY = new Set([151, 251, 385, 386]);
const OTHER = { FR: 'LG', LG: 'FR' };
const VNAME = { FR: 'FireRed', LG: 'LeafGreen' };

// Either/or picks: the game lets you take only one option. Each choice counts as a single checklist item on its location,
// and the options you pass up can then only be had by trading. "linked" entries elsewhere only exist for one option
// (the Cinnabar lab revives the fossil you took; the roaming beast follows your starter).
const STARTER_BASE = { Bulbasaur: 1, Charmander: 4, Squirtle: 7 };
const RIVAL_OF = { Bulbasaur: 'Charmander', Charmander: 'Squirtle', Squirtle: 'Bulbasaur' };
const CHOICES = [
  { id: 'starter', loc: 'pallet-town', title: 'Starter Pokémon', where: "Professor Oak's Lab",
    note: 'You can only take one. Your rival takes the one that beats yours, and it decides which legendary beast roams Kanto after the game.',
    gifts: ['mon-professor-oaks-lab-starter-pok-mon-bulbasaur-charmander-or-squirtle'],
    options: [
      { key: 'Bulbasaur', dex: 1, linked: [{ loc: 'roaming', dex: 244 }] },
      { key: 'Charmander', dex: 4, linked: [{ loc: 'roaming', dex: 245 }] },
      { key: 'Squirtle', dex: 7, linked: [{ loc: 'roaming', dex: 243 }] }],
    linkedNote: { roaming: "Entei, Suicune or Raikou: which one roams depends on the starter you picked in Professor Oak's Lab." } },
  { id: 'fossil', loc: 'mt-moon', title: 'Fossil', where: 'B2F, after beating the Super Nerd',
    note: 'Take one and the Super Nerd keeps the other. Revive it at the Pokémon Lab on Cinnabar Island.',
    options: [
      { key: 'Helix', label: 'Helix Fossil', gift: 'item-b2f-helix-fossil', becomes: 138,
        linked: [{ loc: 'cinnabar-island', dex: 138, gift: 'mon-pok-mon-lab-experiment-room-omanyte-lv-5' }] },
      { key: 'Dome', label: 'Dome Fossil', gift: 'item-b2f-dome-fossil', becomes: 140,
        linked: [{ loc: 'cinnabar-island', dex: 140, gift: 'mon-pok-mon-lab-experiment-room-kabuto-lv-5' }] }],
    linkedNote: { 'cinnabar-island': 'Omanyte or Kabuto: the lab revives the fossil you picked at Mt. Moon.' } },
  { id: 'dojo', loc: 'saffron-city', title: 'Fighting Dojo prize', where: 'Dojo, after beating the Karate Master',
    note: 'You can only take one of the two.',
    options: [
      { key: 'Hitmonlee', dex: 106, gift: 'mon-dojo-hitmonlee-lv-25-choose-one' },
      { key: 'Hitmonchan', dex: 107, gift: 'mon-dojo-hitmonchan-lv-25-choose-one' }] }
];
for (const c of CHOICES) for (const o of c.options) o.label ||= o.key;
// `${loc}:dex:${n}` / `${loc}:gift:${id}` -> the choice (and option) that entry belongs to
const CHOICE_OF = {};
for (const c of CHOICES) {
  for (const g of c.gifts || []) CHOICE_OF[`${c.loc}:gift:${g}`] = { c };
  for (const o of c.options) {
    if (o.dex) CHOICE_OF[`${c.loc}:dex:${o.dex}`] = { c, o };
    if (o.gift) CHOICE_OF[`${c.loc}:gift:${o.gift}`] = { c, o };
    for (const l of o.linked || []) {
      if (l.dex) CHOICE_OF[`${l.loc}:dex:${l.dex}`] = { c, o, linked: true };
      if (l.gift) CHOICE_OF[`${l.loc}:gift:${l.gift}`] = { c, o, linked: true };
    }
  }
}

const state = { index: [], locations: {}, dex: [], trainers: [], types: {}, walk: {}, found: {}, progress: loadProgress(), dexFilter: { scope: 'kanto', missing: false, q: '' } };

function freshSave() { return { caught: {}, checks: {}, team: [], picks: {} }; }
// Saves from before choices existed kept a `starter` setting (always defaulting to Bulbasaur) and separate
// checkboxes for each option. Work out each pick from those, and leave it unpicked when the old save is ambiguous.
function migratePicks(s) {
  const picks = {}, caught = s.caught || {}, checks = s.checks || {};
  const one = list => (list.length === 1 ? list[0].key : null);
  for (const c of CHOICES) {
    const tiers = [
      o => o.gift && checks[`${c.loc}:gift:${o.gift}`],
      o => (o.linked || []).some(l => l.gift && checks[`${l.loc}:gift:${l.gift}`]),
      o => (o.dex ? caught[o.dex] : (o.linked || []).some(l => l.dex && caught[l.dex]))
    ];
    if (c.id === 'starter') {
      const line = n => Object.keys(STARTER_BASE).find(k => n >= STARTER_BASE[k] && n < STARTER_BASE[k] + 3);
      const onTeam = [...new Set((s.team || []).map(line).filter(Boolean))];
      // only a starter someone actually changed is a real answer; Bulbasaur was the default
      tiers.unshift(o => s.starter && s.starter !== 'Bulbasaur' && o.key === s.starter, o => onTeam.length === 1 && onTeam[0] === o.key);
    }
    for (const t of tiers) { const k = one(c.options.filter(t)); if (k) { picks[c.id] = k; break; } }
  }
  s.picks = picks;
  delete s.starter;
}
function normaliseProgress(p) {
  if (!p || typeof p.saves !== 'object' || !p.saves) return null;
  for (const v of ['FR', 'LG']) {
    const old = p.saves[v] && typeof p.saves[v] === 'object' ? p.saves[v] : {};
    if (!old.picks) migratePicks(old);
    p.saves[v] = Object.assign(freshSave(), old);
    delete p.saves[v].starter;
  }
  if (!['FR', 'LG'].includes(p.version)) p.version = 'FR';
  return p;
}
function loadProgress() {
  try {
    const p = normaliseProgress(JSON.parse(localStorage.getItem(STORE_KEY)));
    if (p) return p;
  } catch (e) { /* fall through to a fresh save */ }
  return { version: 'FR', hideDone: false, saves: { FR: freshSave(), LG: freshSave() } };
}
function writeLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.progress)); } catch (e) { /* storage blocked */ } }
function save() { writeLocal(); sync.changed(); }
const V = () => state.progress.version;
const cur = () => state.progress.saves[V()];
const inVersion = x => !x.versions || x.versions.includes(V());
const pickOf = id => cur().picks?.[id] || null;
const pickedOption = c => c.options.find(o => o.key === pickOf(c.id)) || null;
// Is this location entry an ordinary checklist row? Options at a choice are shown on the choice card instead,
// and linked entries only appear once their option is picked.
function freeRow(locId, kind, key) {
  const m = CHOICE_OF[`${locId}:${kind}:${key}`];
  return !m || (m.linked && pickOf(m.c.id) === m.o.key);
}
// Can you get this Pokémon from this entry, given what you picked? Unpicked choices are still open.
function allowed(w, dex) {
  const m = CHOICE_OF[`${w.loc}:dex:${dex}`];
  return !m?.o || !pickOf(m.c.id) || pickOf(m.c.id) === m.o.key;
}
function condText(w, dex) {
  const m = CHOICE_OF[`${w.loc}:dex:${dex}`];
  if (!m?.o || pickOf(m.c.id)) return '';
  return m.linked ? `if you pick ${m.o.label} at ${state.locations[m.c.loc].name}` : 'choose one';
}
// What a location's checklist holds once choices are folded in.
function locView(loc) {
  return {
    encs: loc.encounters.filter(e => inVersion(e) && freeRow(loc.id, 'dex', e.dex)),
    gifts: loc.gifts.filter(g => inVersion(g) && freeRow(loc.id, 'gift', g.id)),
    choices: CHOICES.filter(c => c.loc === loc.id),
    pending: CHOICES.filter(c => c.linkedNote?.[loc.id] && !pickOf(c.id)),
    trainers: loc.trainers || []
  };
}
const trainerKey = (locId, t) => `${locId}:trainer:${t.id}`;

const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
async function loadData() {
  const [idx, dex, trainers, types, walk, moves, tms, extras, items] = await Promise.all(['data/locations.json', 'data/pokedex.json', 'data/trainers.json', 'data/types.json', 'data/walkthrough.json', 'data/moves.json', 'data/tms.json', 'data/extras.json', 'data/items.json'].map(getJSON));
  Object.assign(state, { index: idx.locations, dex, trainers, types, walk, moves, tms, extras, items });
  await Promise.all(state.index.map(async l => { state.locations[l.id] = await getJSON('data/' + l.file); }));
  state.stage = Object.fromEntries(state.index.map((l, i) => [l.id, i]));
  for (const l of state.index) for (const e of state.locations[l.id].encounters) {
    (state.found[e.dex] ||= []).push({ loc: l.id, name: l.name, method: e.method, versions: e.versions, levels: e.levels,
      stage: encStage(l.id, e), later: encStage(l.id, e) > stageOf(l.id) });
  }
  for (const list of Object.values(state.found)) list.sort((a, b) => a.stage - b.stage);
}

// ---------- story progress ----------
// The location list is in story order, so a location's position is how far into the game you are when you first get there.
// Fishing, Surf and Rock Smash only open up once you have the rod or HM (and badge) for them.
const UNLOCK = {
  'old-rod': { at: 'vermilion-city', need: 'the Old Rod (Fishing Guru in Vermilion City)' },
  'good-rod': { at: 'fuchsia-city', need: 'the Good Rod (Fishing Guru in Fuchsia City)' },
  'super-rod': { at: 'route-12', need: "the Super Rod (Fishing Guru's brother on Route 12)" },
  surf: { at: 'safari-zone', need: 'Surf (HM03 from the Safari Zone Secret House, used with the Soul Badge)' },
  'rock-smash': { at: 'ember-spa', need: 'Rock Smash (HM06 from the Ember Spa on One Island, used with the Marsh Badge)' }
};
const stageOf = id => state.stage[id] ?? 0;
// Surf is handed over in the Safari Zone but only works once you beat Koga, who you can fight after the Safari Zone,
// so Surf encounters open half a step after it.
const unlockStage = m => stageOf(UNLOCK[m].at) + (m === 'surf' ? 0.5 : 0);
const encStage = (locId, e) => Math.max(stageOf(locId), UNLOCK[e.method] ? unlockStage(e.method) : -1);
// Gyms you can't (or needn't) take on as soon as you reach the city: everything up to this location is open before
// the gym. Misty: Routes 24 and 25 are open first. Lt. Surge: the gym is behind a Cut tree (HM01 on the S.S. Anne),
// and Route 11 and Diglett's Cave are open too. Koga: the Safari Zone. Sabrina: a Rocket blocks the gym door until
// Silph Co. is cleared. Blaine: the gym needs the Secret Key from the Pokémon Mansion.
const READY_BY = { 'cerulean-city:Gym': 'route-25', 'vermilion-city:Gym': 'digletts-cave', 'fuchsia-city:Gym': 'safari-zone',
  'saffron-city:Gym': 'silph-co', 'cinnabar-island:Gym': 'pokemon-mansion' };
// How far into the story you can be when you fight this trainer, for planning with what you could have caught by then.
const battleStage = (t, locId) => Math.max(stageOf(t.stage || locId), READY_BY[`${locId}:${t.area}`] ? stageOf(READY_BY[`${locId}:${t.area}`]) : 0);
const unlockName = m => state.index[stageOf(UNLOCK[m].at)].name;

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const view = document.getElementById('view');
const mon = n => state.dex[n - 1];
const typeTag = t => `<span class="type t-${t}">${t}</span>`;
const types = n => (mon(n).types || []).map(typeTag).join('');
const bar = (a, b) => `<div class="bar"><i style="width:${pct(a, b)}%"></i></div>`;
const eff = (atk, defTypes) => defTypes.reduce((m, d) => m * (state.types[atk]?.[d] ?? 1), 1);
const baseForm = n => { while (mon(n).evolvesFrom) n = mon(n).evolvesFrom; return n; };
const isCaught = n => !!cur().caught[n];

function availability(n) {
  const f = (state.found[n] || []);
  const ver = f.filter(inVersion);
  const here = ver.filter(w => allowed(w, n));
  if (here.length) return { kind: 'catch', where: here };
  const p = mon(n).evolvesFrom;
  const pa = p && availability(p);
  if (p) {
    const e = mon(p).evolutions.find(x => x.into === n);
    if (['catch', 'evolve'].includes(pa.kind)) return { kind: 'evolve', from: p, how: (EVO_LABEL[e.method] || (() => e.method))(e.param) };
  }
  // passed up because of a choice you made (the other starter, fossil or Dojo prize)
  if (ver.length) return { kind: 'missed', choice: CHOICE_OF[`${ver[0].loc}:dex:${n}`].c };
  if (pa?.kind === 'missed') return { kind: 'missed', choice: pa.choice, via: pa.via || p };
  if (f.length) return { kind: 'other', where: f };
  if (p && availability(p).kind === 'other') return { kind: 'other', where: [], via: p };
  if (EVENT_ONLY.has(n)) return { kind: 'event' };
  return { kind: 'none' };
}

function missedText(a) {
  const c = a.choice, o = pickedOption(c);
  return `<span class="bad">Passed up:</span> you picked ${esc(o.label)} at <a href="#/loc/${c.loc}">${esc(state.locations[c.loc].name)}</a>. Trade for ${a.via ? `${esc(mon(a.via).name)} and evolve it` : 'one'} from another game.`;
}
function availText(n) {
  const a = availability(n);
  if (a.kind === 'catch') {
    // a.where is sorted by when you can first catch it there, so the earliest chance comes first
    const uniq = [...new Map([...a.where].reverse().map(w => [w.loc, w])).values()].sort((x, y) => x.stage - y.stage);
    return uniq.slice(0, 4).map(w => `<a href="#/loc/${w.loc}">${esc(w.name)}</a> <span class="note">(${esc(METHOD_LABEL[w.method] || w.method)}${w.later ? `, after ${esc(unlockName(w.method))}` : ''}${condText(w, n) ? `, ${esc(condText(w, n))}` : ''})</span>`).join(', ') + (uniq.length > 4 ? ` +${uniq.length - 4} more` : '');
  }
  if (a.kind === 'evolve') return `Evolve ${esc(mon(a.from).name)}: ${esc(a.how)}`;
  if (a.kind === 'missed') return missedText(a);
  if (a.kind === 'other') return `<span class="bad">Not in ${VNAME[V()]}.</span> Trade from ${VNAME[OTHER[V()]]}${a.via ? ` (or trade for ${esc(mon(a.via).name)} and evolve it)` : ''}.`;
  if (a.kind === 'event') return 'Event only (Nintendo distribution).';
  return n > 151 ? 'Trade from Ruby, Sapphire, Emerald, Colosseum or XD.' : 'Not obtainable in this version.';
}

// ---------- progress maths ----------
function locStats(loc) {
  const s = cur(), v = locView(loc);
  const dex = [...new Set(v.encs.map(e => e.dex))];
  const keys = [...loc.items.map(i => `${loc.id}:item:${i.id}`), ...v.gifts.map(g => `${loc.id}:gift:${g.id}`), ...v.trainers.map(t => trainerKey(loc.id, t)), ...extraKeys(loc)];
  return { total: dex.length + keys.length + v.choices.length,
    done: dex.filter(d => s.caught[d]).length + keys.filter(k => s.checks[k]).length + v.choices.filter(c => pickOf(c.id)).length };
}
// Checklist rows added by features.js (shop TMs and prizes); none until it has loaded
const extraKeys = loc => (typeof shopRows === 'function' ? shopRows(loc) : []);
function globalStats() {
  const s = cur(); let items = 0, itemsDone = 0, gifts = 0, giftsDone = 0, trs = 0, trsDone = 0, shop = 0, shopDone = 0;
  for (const loc of Object.values(state.locations)) {
    const v = locView(loc);
    for (const k of extraKeys(loc)) { shop++; if (s.checks[k]) shopDone++; }
    for (const i of loc.items) { items++; if (s.checks[`${loc.id}:item:${i.id}`]) itemsDone++; }
    for (const g of v.gifts) { gifts++; if (s.checks[`${loc.id}:gift:${g.id}`]) giftsDone++; }
    for (const c of v.choices) { gifts++; if (pickOf(c.id)) giftsDone++; }
    for (const t of v.trainers) { trs++; if (s.checks[trainerKey(loc.id, t)]) trsDone++; }
  }
  let kanto = 0; for (let n = 1; n <= 151; n++) if (s.caught[n]) kanto++;
  return { dex: [kanto, 151], items: [itemsDone, items], gifts: [giftsDone, gifts], trainers: [trsDone, trs], shop: [shopDone, shop] };
}

// ---------- views ----------
function renderHome() {
  setHeader('FRLG Completion Dex', false, 'routes');
  const g = globalStats();
  const stat = (label, [a, b]) => `<div class="stat"><b>${a}/${b}</b><span>${label}</span>${bar(a, b)}</div>`;
  let html = `<a class="card stats linkcard" href="#/progress">${stat('Kanto Dex', g.dex)}${stat('Items', g.items)}${stat('NPC gifts', g.gifts)}${stat('Trainers', g.trainers)}</a>`;
  html += `<div class="chips" style="margin-bottom:4px"><a class="chip" href="#/map">Town map</a><a class="chip" href="#/missing">Still missing</a><a class="chip" href="#/progress">Progress</a>${typeof nuzOn === 'function' && nuzOn() ? '<a class="chip" href="#/nuzlocke">Nuzlocke</a>' : ''}</div>`;
  let region = '';
  for (const l of state.index) {
    const loc = state.locations[l.id];
    const { done, total } = locStats(loc);
    if (state.progress.hideDone && total && done === total) continue;
    if (l.region !== region) { region = l.region; html += `<h2>${esc(region)}</h2>`; }
    html += `<a class="card loc" href="#/loc/${l.id}"><div class="name">${esc(loc.name)}
        <div class="meta">${done}/${total} done</div>${bar(done, total)}</div><span>&rsaquo;</span></a>`;
  }
  view.innerHTML = html;
}

let rowSeq = 0;
// A row with an info link (a Pokémon or a TM) opens that page when tapped, and only the checkbox ticks it, so a stray
// tap can't mark something caught. Other rows tick when tapped anywhere.
function checkRow(key, checked, title, sub, tags = '') {
  const id = 'cb' + (rowSeq++);
  const box = `<input type="checkbox" id="${id}" data-key="${esc(key)}" ${checked ? 'checked' : ''}>`;
  const info = /<a class="info" href="([^"]+)"[^>]*>ⓘ<\/a>/.exec(tags);
  // a button (like Catch plan) goes on its own line under the details
  const rest = info ? tags.replace(info[0], '') : '', btn = (/ ?<a class="tag catchlink"[^>]*>[^<]*<\/a>/.exec(rest) || [''])[0];
  if (info) return `<div class="row linkrow ${checked ? 'checked' : ''}"><label class="cbhit" for="${id}" aria-label="Tick off">${box}</label>
    <div class="rowbody"><a class="rowlink" href="${info[1]}"><span>${title}</span></a>${rest.replace(btn, '')}<span class="sub">${sub}</span>${btn}</div></div>`;
  return `<div class="row ${checked ? 'checked' : ''}">
    ${box}
    <label for="${id}"><span>${title}</span>${tags}<span class="sub">${sub}</span></label></div>`;
}
const groupBy = (list, f) => list.reduce((m, x) => ((m[f(x) || ''] ||= []).push(x), m), {});

function renderLocation(id) {
  const loc = state.locations[id];
  if (!loc) return renderHome();
  setHeader(loc.name, true, 'routes');
  const s = cur();
  let html = '';
  const steps = state.walk[id];
  if (loc.notes) html += `<div class="card note">${esc(loc.notes)}</div>`;
  if (steps?.length) html += `<h2>Walkthrough</h2><div class="card"><ol class="steps">${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;

  const v = locView(loc);
  if (v.choices.length) html += `<h2>Choose one</h2>${v.choices.map(choiceCard).join('')}`;
  for (const c of v.pending) html += `<div class="card note">${esc(c.linkedNote[id])} <a href="#/loc/${c.loc}">Pick it on the ${esc(state.locations[c.loc].name)} page</a> and the right one shows up here.</div>`;

  const trs = v.trainers;
  if (trs.length) {
    html += `<h2>Trainers (${trs.filter(t => s.checks[trainerKey(id, t)]).length}/${trs.length})</h2>${teamHint()}`;
    const cards = list => Object.entries(groupBy(list, t => t.area)).map(([area, grp]) =>
      (area ? `<div class="area">${esc(area)}</div>` : '') + grp.map(t => trainerCard(t, battleStage(t, id), { loc: id, open: !t.later })).join('')).join('');
    const firstVisit = trs.filter(t => !t.later), laterTrs = trs.filter(t => t.later);
    html += cards(firstVisit);
    // Trainers you only fight later in the story: collapsed, planned with what you can have caught by then
    for (const [stg, list] of Object.entries(groupBy(laterTrs, t => t.stage)))
      html += `<details class="later"><summary><h2>Trainers: come back later (${list.length})</h2></summary>
        <p class="note">You fight ${list.length === 1 ? 'this trainer' : 'these trainers'} around ${esc(state.locations[stg]?.name || stg)} in the story, so catch suggestions use everything you can have by then.</p>${cards(list)}</details>`;
  }

  const encs = v.encs;
  const here = stageOf(id);
  const encList = (list, later) => {
    let out = '';
    for (const [area, grp] of Object.entries(groupBy(list, e => e.area))) {
      if (area) out += `<div class="area">${esc(area)}</div>`;
      out += grp.map(e => {
        const sub = [METHOD_LABEL[e.method] || e.method, e.levels && `Lv ${esc(e.levels)}`, e.rate && esc(e.rate), e.notes && esc(e.notes),
          later && `Needs ${esc(UNLOCK[e.method].need)}`].filter(Boolean).join(' · ');
        const excl = e.versions.length === 1 ? `<span class="tag">${e.versions[0]} only</span>` : '';
        return checkRow(`dex:${e.dex}`, s.caught[e.dex], `#${String(e.dex).padStart(3, '0')} ${esc(e.name)} ${types(e.dex)}`, sub, excl + infoLink(e.dex) + (typeof catchLink === 'function' && !['gift', 'trade', 'game-corner'].includes(e.method) ? catchLink(id, e.dex, e.method) : ''));
      }).join('');
    }
    return out;
  };
  const now = encs.filter(e => encStage(id, e) <= here), later = encs.filter(e => encStage(id, e) > here);
  html += `<h2>Pokémon</h2><div class="card">`;
  if (!encs.length) html += '<div class="empty">No Pokémon to catch here.</div>';
  else if (!now.length) html += '<div class="empty">Nothing to catch on your first visit.</div>';
  html += encList(now, false) + `</div>`;
  if (later.length) html += `<details class="later"><summary><h2>Pokémon: come back later (${new Set(later.map(e => e.dex)).size})</h2></summary><div class="card"><p class="note">You can't fish, Surf or Rock Smash here on your first visit. These open up later in the story.</p>${encList(later, true)}</div></details>`;

  const section = (title, list, kind, subFn) => {
    html += `<h2>${title} (${list.filter(x => s.checks[`${loc.id}:${kind}:${x.id}`]).length}/${list.length})</h2><div class="card">`;
    if (!list.length) html += '<div class="empty">None.</div>';
    for (const [area, grp] of Object.entries(groupBy(list, x => x.where))) {
      if (area && kind === 'item') html += `<div class="area">${esc(area)}</div>`;
      html += grp.map(x => { const k = `${loc.id}:${kind}:${x.id}`; return checkRow(k, s.checks[k], esc(x.name), subFn(x), typeof itemInfoLink === 'function' ? itemInfoLink(x.name) : ''); }).join('');
    }
    html += `</div>`;
  };
  section('Items', loc.items.filter(i => !i.hidden), 'item', () => 'On the ground');
  section('Hidden items', loc.items.filter(i => i.hidden), 'item', () => 'Hidden: use the Itemfinder');
  section('NPC gifts &amp; trades', v.gifts, 'gift', g => [g.from && esc(g.from), esc(g.where)].filter(Boolean).join(' · '));
  for (const f of LOC_SECTIONS) html += f(loc);
  view.innerHTML = html;
}

// Extra location page sections (shops, move tutors...) registered by features.js and friends: loc -> html
const LOC_SECTIONS = [];
const infoLink = n => ` <a class="info" href="#/mon/${n}" aria-label="About ${esc(mon(n).name)}">ⓘ</a>`;
function choiceCard(c) {
  const p = pickOf(c.id), nm = `pick-${c.id}-${rowSeq++}`;
  const opt = o => {
    const title = o.dex ? `#${String(o.dex).padStart(3, '0')} ${esc(mon(o.dex).name)} ${types(o.dex)}`
      : `${esc(o.label)}${o.becomes ? ` <span class="note">revives into ${esc(mon(o.becomes).name)}</span>` : ''}`;
    const sub = [c.id === 'starter' && `Your rival takes ${RIVAL_OF[o.key]}`, p && p !== o.key && 'Not picked: trade for it'].filter(Boolean).join(' · ');
    return `<label class="row pick ${p === o.key ? 'checked' : ''}"><input type="radio" name="${nm}" data-pick="${c.id}" value="${esc(o.key)}" ${p === o.key ? 'checked' : ''}>
      <span><span>${title}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span></label>`;
  };
  return `<div class="card choice"><div><b>${esc(c.title)}</b> ${p ? '<span class="tag good">Picked</span>' : '<span class="tag">Not picked yet</span>'}</div>
    <p class="note">${esc(c.where)}. ${esc(c.note)}</p>${c.options.map(opt).join('')}
    ${p ? `<button class="btn small" data-unpick="${c.id}">Clear pick</button>` : ''}</div>`;
}
// The three starters as tap-to-pick chips (Battle plan and rival cards share the Oak's Lab pick).
function starterChips() {
  const p = pickOf('starter'), nm = `pick-starter-${rowSeq++}`;
  return `<div class="chips">${Object.keys(STARTER_BASE).map(k => `<label class="chip ${p === k ? 'on' : ''}"><input type="radio" class="vh" name="${nm}" data-pick="starter" value="${k}" ${p === k ? 'checked' : ''}>${k}</label>`).join('')}</div>`;
}
function setPick(id, key) {
  const s = cur(), c = CHOICES.find(x => x.id === id);
  const prev = pickedOption(c), next = c.options.find(o => o.key === key);
  if ((prev?.key || null) === (next?.key || null)) return;
  // a pick marks the Pokémon you got as caught; undo that if the pick changes
  if (prev?.dex && s.caught[prev.dex] === 'pick') delete s.caught[prev.dex];
  s.picks ||= {};
  if (next) { s.picks[id] = next.key; if (next.dex && !s.caught[next.dex]) s.caught[next.dex] = 'pick'; } else delete s.picks[id];
  if (id === 'starter') starterToTeam(prev?.key, next?.key);
  for (const k in catchCache) delete catchCache[k];
  save(); route(true);
}
// Keep the Battle plan team in step with the starter pick. Changing the pick swaps the old starter
// (or whatever it evolved into) for the same stage of the new one, keeping its level; clearing the pick takes it
// off the team. A slot you've changed to a Pokémon outside the old starter's line is left alone.
const starterLine = k => (STARTER_BASE[k] ? [0, 1, 2].map(i => STARTER_BASE[k] + i) : []);
const starterKeyOf = n => Object.keys(STARTER_BASE).find(k => starterLine(k).includes(n)) || null;
function starterToTeam(prev, next) {
  const s = cur();
  const i = prev ? s.team.findIndex(n => starterLine(prev).includes(n)) : -1;
  if (i >= 0) {
    const old = s.team[i];
    const nn = next ? STARTER_BASE[next] + (old - STARTER_BASE[prev]) : null;
    if (!nn || s.team.includes(nn)) { s.team.splice(i, 1); return; }
    s.team[i] = nn;
    const lvl = s.teamMeta?.[old]?.level;
    if (lvl) (s.teamMeta[nn] ||= {}).level ||= lvl;
  } else if (next && !s.team.some(starterKeyOf) && s.team.length < 6) s.team.unshift(STARTER_BASE[next]);
}

function renderDex() {
  setHeader('Pokédex', false, 'dex');
  const f = state.dexFilter;
  const max = f.scope === 'kanto' ? 151 : 386;
  const all = state.dex.slice(0, max);
  const list = all.filter(p => (!f.missing || !isCaught(p.dex)) && (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase()) || String(p.dex) === f.q));
  const caught = all.filter(p => isCaught(p.dex)).length;
  view.innerHTML = `<div class="card"><b>${caught}/${max}</b> caught ${bar(caught, max)}
    <div class="chips" style="margin-top:10px">
      <button class="chip ${f.scope === 'kanto' ? 'on' : ''}" data-f="scope:kanto">Kanto 151</button>
      <button class="chip ${f.scope === 'national' ? 'on' : ''}" data-f="scope:national">National 386</button>
      <button class="chip ${f.missing ? 'on' : ''}" data-f="missing">Missing only</button>
    </div>
    <input type="search" id="dexq" placeholder="Search name or number" value="${esc(f.q)}" style="margin-top:10px"></div>
    <p class="note"><a href="#/missing">Still missing: what you can catch now and where</a></p>
    <div class="card">${list.map(p => checkRow(`dex:${p.dex}`, isCaught(p.dex),
      `#${String(p.dex).padStart(3, '0')} ${esc(p.name)} ${types(p.dex)}`, availText(p.dex), infoLink(p.dex))).join('') || '<div class="empty">Nothing matches.</div>'}</div>`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    const [k, v] = b.dataset.f.split(':');
    if (k === 'scope') f.scope = v; else f.missing = !f.missing;
    renderDex();
  });
  const q = document.getElementById('dexq');
  q.oninput = () => { f.q = q.value; const pos = q.selectionStart; renderDex(); const n = document.getElementById('dexq'); n.focus(); n.setSelectionRange(pos, pos); };
}

// ---------- battle engine (route trainers and the Battle plan tab) ----------
// Estimates real damage with the Gen 3 formula: levels, base stats, IVs, move power, STAB and type effectiveness.
// Gen 3 decides physical or special by the move's type. Abilities a species is sure to have, type-boosting held items
// and healing berries are counted; critical hits and stat-changing moves are flagged as warnings.
const PHYSICAL = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const VARIES_POWER = { Return: 102, 'Hidden Power': 70, Magnitude: 70, Flail: 40, Present: 40, Revenge: 60 };
const PLAYER_IV = 15; // average IVs for your Pokémon; no EVs
const ALL_TYPES = () => Object.keys(state.types);
const HITS = { multi: 3, double: 2, triple: 6 }; // 2-5 hit moves average about 3; Triple Kick is 10+20+30 power

function calcStats(dex, level, iv) {
  return mon(dex).stats.map((b, i) => Math.floor((2 * b + iv) * level / 100) + (i === 0 ? level + 10 : 5));
}
function defaultMoves(dex, level) {
  const out = [];
  for (const [l, mv] of mon(dex).learnset || []) {
    if (l > level) break;
    if (out.includes(mv)) continue;
    if (out.length === 4) out.shift();
    out.push(mv);
  }
  return out;
}
// Moves a Pokémon of yours would sensibly know at a level: the strongest attack of each type it (or the Pokémon it
// evolved from) learns by level up by then, best four. The game's own default keeps only the last four moves
// learned, which drops early attacks like Pikachu's Thundershock for Tail Whip and Double Team; a player keeps them.
function lineOf(dex) { const out = [dex]; while (mon(out[0]).evolvesFrom) out.unshift(mon(out[0]).evolvesFrom); return out; }
// Level-up moves a Pokémon can know at `level`. `from` is the Pokémon you start with: the species you catch and its level
// (it arrives knowing the last four moves it learned by then, the game's default). Without one, the line starts at the
// first form you can find in the wild or be given, so baby forms like Cleffa (breeding only) don't count.
// Rules: a pre-evolution learns moves up to the level it evolves at; an evolved form only learns its moves from the
// level it evolved at onward, so Gyarados never gets its level 1 Thrash and Vileplume never gets Mega Drain. With
// `relearn` (the Move Reminder on Two Island) any move the species learns by this level is available.
function learnedBy(dex, level, from = {}, relearn = false) {
  const full = lineOf(dex);
  let i0 = from.dex ? full.indexOf(from.dex) : full.findIndex(d => state.found[d]?.length);
  if (i0 < 0) i0 = from.dex ? full.length - 1 : 0;
  const line = full.slice(i0), out = new Map();
  const add = (mv, l, d) => { if (!out.has(mv)) out.set(mv, { level: l, from: d }); };
  let since = from.level || 1; // level this form was reached at
  line.forEach((d, i) => {
    const next = line[i + 1];
    const evo = next && mon(d).evolutions.find(e => e.into === next);
    // level evolutions happen at their level; for stones and trades, evolve as late as possible to keep learning
    const until = Math.min(level, evo && evo.method.startsWith('level') ? evo.param : level);
    if (i === 0 && from.level) for (const mv of defaultMoves(d, from.level)) add(mv, mon(d).learnset.find(([, m]) => m === mv)[0], d);
    for (const [l, mv] of mon(d).learnset || []) if (l <= until && (i === 0 ? (from.level ? l > since : true) : l >= since)) add(mv, l, d);
    if (evo) since = Math.max(since, until);
  });
  if (relearn) for (const [l, mv] of mon(dex).learnset || []) if (l <= level) add(mv, l, dex);
  return out;
}
const relearnAt = () => stageOf('two-island');
function moveScore(dex, level, name) {
  const m = state.moves[name];
  if (!m || !m.power || ['counter', 'dream', 'ohko', 'explode', 'fakeout'].includes(m.effect)) return 0;
  let power = { level: level, fixed20: 20 * 1.5, fixed40: 40 * 1.5, half: 60 }[m.effect] ?? (m.power === 1 ? VARIES_POWER[name] || 0 : m.power);
  if (name === 'Low Kick') power = 60;
  if (!m.effect || !['level', 'fixed20', 'fixed40', 'half'].includes(m.effect)) {
    if (mon(dex).types.includes(m.type)) power *= 1.5;
    power *= HITS[m.effect] || 1;
  }
  return m.effect === 'charge' || m.effect === 'recharge' ? power / 2 : power;
}
// TMs and HMs you can have by a point in the story: found or given at a location you've reached, bought at the
// Celadon Department Store or won at the Game Corner. One handed over after a battle ("after winning") only counts
// once that battle is behind you, so Misty's TM03 is never planned for the fight with Misty.
const tmCache = {};
function tmStage(src, tm) {
  // the Cerulean City burglar is behind the house you can only get through after visiting Bill on Route 25
  if (src.loc === 'cerulean-city' && /Rocket Grunt/.test(src.from || '')) return stageOf('route-25') + 0.5;
  // a trainer who hands it over as a battle reward (Gym Leaders, Giovanni...): only after that battle
  const t = (state.locations[src.loc]?.trainers || []).find(x => (x.rewards || []).some(r => r.split(' ')[0] === tm));
  if (t) return battleStage(t, src.loc) + 0.5;
  return stageOf(src.loc) + (/after (winning|beating)/i.test(src.from || '') ? 0.5 : 0);
}
function tmsBy(stage) {
  if (tmCache[stage]) return tmCache[stage];
  const out = [];
  for (const [tm, t] of Object.entries(state.tms || {})) {
    const src = (t.sources || []).map(x => ({ ...x, stage: tmStage(x, tm) })).filter(x => x.stage <= stage).sort((a, b) => a.stage - b.stage)[0];
    if (src) out.push({ tm, move: t.move, src });
  }
  return (tmCache[stage] = out);
}
// Moves this Pokémon could be taught from the TMs and HMs you can have by then: move -> { tm, src }
function tmMovesBy(dex, stage) {
  const can = new Set(mon(dex).tmhm || []), out = new Map();
  for (const t of tmsBy(stage)) if (can.has(t.tm)) out.set(t.move, { tm: t.tm, src: t.src });
  return out;
}
const tmSourceText = x => `${x.tm} (${x.src.how === 'buy' ? `buy at ${state.locations[x.src.loc]?.name}` : x.src.how === 'prize' ? 'Game Corner prize' : state.locations[x.src.loc]?.name || x.src.loc})`;
function bestMoves(dex, level, from, relearn, extra) {
  const best = {};
  for (const name of new Set([...learnedBy(dex, level, from, relearn).keys(), ...(extra ? extra.keys() : [])])) {
    // Low Kick's power depends on the target's weight, so it doesn't crowd out the other Fighting move
    const sc = moveScore(dex, level, name), t = name === 'Low Kick' ? name : state.moves[name]?.type;
    if (sc && (!best[t] || sc > best[t].sc)) best[t] = { name, sc };
  }
  const out = Object.values(best).sort((a, b) => b.sc - a.sc).slice(0, 4).map(x => x.name);
  // a Pokémon that knows no attack yet still has whatever it learned
  return out.length ? out : defaultMoves(dex, level);
}
function battler(dex, level, iv, moves, item) {
  const st = calcStats(dex, level, iv);
  return { dex, level, iv, moves: moves.filter(m => state.moves[m]), hp: st[0], st, ...(item ? { item } : {}) };
}
// Abilities that change damage. A Pokémon whose species has two abilities could have either, so only a species with
// one possible ability is counted for sure; the other cases get a "may have" warning instead (abilityNote).
const soleAbility = dex => { const a = mon(dex).abilities || []; return a.length === 1 ? a[0] : null; };
const IMMUNE_AB = { Levitate: 'Ground', 'Flash Fire': 'Fire', 'Water Absorb': 'Water', 'Volt Absorb': 'Electric' };
// Held items that boost one type's moves by 10% in Gen 3
const TYPE_ITEM = { 'Black Belt': 'Fighting', Charcoal: 'Fire', 'Mystic Water': 'Water', 'Miracle Seed': 'Grass', Magnet: 'Electric',
  'Never-melt Ice': 'Ice', 'Poison Barb': 'Poison', 'Soft Sand': 'Ground', 'Sharp Beak': 'Flying', Twistedspoon: 'Psychic',
  Silverpowder: 'Bug', 'Hard Stone': 'Rock', 'Spell Tag': 'Ghost', 'Dragon Fang': 'Dragon', Blackglasses: 'Dark', 'Metal Coat': 'Steel', 'Silk Scarf': 'Normal' };
const BERRY_HEAL = { 'Sitrus Berry': 30, 'Oran Berry': 10 };
// Moves that change stats, so a long fight can swing: shown as a warning, not counted in the damage
const STAT_MOVES = { Growl: 'lowers your Attack', 'Tail Whip': 'lowers your Defense', Leer: 'lowers your Defense', Screech: 'sharply lowers your Defense',
  Charm: 'sharply lowers your Attack', 'Feather Dance': 'sharply lowers your Attack', 'Metal Sound': 'sharply lowers your Sp. Def', 'Fake Tears': 'sharply lowers your Sp. Def',
  'Swords Dance': 'sharply raises its Attack', 'Dragon Dance': 'raises its Attack and Speed', 'Bulk Up': 'raises its Attack and Defense', 'Calm Mind': 'raises its Sp. Atk and Sp. Def',
  Growth: 'raises its Sp. Atk', Meditate: 'raises its Attack', Sharpen: 'raises its Attack', 'Howl': 'raises its Attack', 'Belly Drum': 'maximises its Attack',
  Harden: 'raises its Defense', Withdraw: 'raises its Defense', 'Defense Curl': 'raises its Defense', 'Iron Defense': 'sharply raises its Defense',
  Barrier: 'sharply raises its Defense', 'Acid Armor': 'sharply raises its Defense', Amnesia: 'sharply raises its Sp. Def', Agility: 'sharply raises its Speed',
  'Double Team': 'raises its evasion', Minimize: 'raises its evasion', 'Sand-attack': 'lowers your accuracy', Smokescreen: 'lowers your accuracy',
  Flash: 'lowers your accuracy', Kinesis: 'lowers your accuracy', 'Cotton Spore': 'sharply lowers your Speed', 'String Shot': 'lowers your Speed', 'Scary Face': 'sharply lowers your Speed' };
const HIGH_CRIT = new Set(['Karate Chop', 'Razor Leaf', 'Crabhammer', 'Slash', 'Aeroblast', 'Cross Chop', 'Sky Attack', 'Blaze Kick', 'Poison Tail', 'Leaf Blade', 'Air Cutter']);
const teamMeta = n => (cur().teamMeta ||= {})[n] || {};
function myBattler(n, foeLevel) {
  const meta = teamMeta(n);
  const level = meta.level || foeLevel;
  const moves = (meta.moves || []).filter(Boolean);
  return { ...battler(n, level, PLAYER_IV, moves.length ? moves : bestMoves(n, level)), guessedLevel: !meta.level, guessedMoves: !moves.length };
}
const foeBattler = p => ({ ...battler(p.dex, p.level, p.iv ?? 0, (p.moves || []).map(m => m.name), p.item), foe: true });

// Damage range of one move, in HP. null for moves that don't deal direct damage.
function hit(att, def, name, crit = false) {
  const m = state.moves[name];
  if (!m || !m.power || ['counter', 'dream', 'ohko'].includes(m.effect)) return null;
  const aAb = soleAbility(att.dex), dAb = soleAbility(def.dex);
  let mult = eff(m.type, mon(def.dex).types);
  if (IMMUNE_AB[dAb] === m.type || (dAb === 'Wonder Guard' && mult < 2)) mult = 0;
  const out = (min, max) => ({ name, type: m.type, mult, min, max });
  if (mult === 0) return out(0, 0);
  if (m.effect === 'level') return out(att.level, att.level);
  if (m.effect === 'fixed20') return out(20, 20);
  if (m.effect === 'fixed40') return out(40, 40);
  if (m.effect === 'half') return out(Math.floor(def.hp / 2), Math.floor(def.hp / 2));
  // Low Kick's power depends on the target's weight (in 0.1 kg)
  const w = mon(def.dex).weight || 0;
  const power = name === 'Low Kick' ? (w < 100 ? 20 : w < 250 ? 40 : w < 500 ? 60 : w < 1000 ? 80 : w < 2000 ? 100 : 120) : m.power === 1 ? VARIES_POWER[name] : m.power;
  if (!power) return null;
  const phys = PHYSICAL.has(m.type);
  let A = att.st[phys ? 1 : 3];
  if (phys && ['Huge Power', 'Pure Power'].includes(aAb)) A *= 2;
  if (phys && aAb === 'Hustle') A = Math.floor(A * 1.5);
  if (phys && dAb === 'Intimidate' && !crit) A = Math.floor(A * 2 / 3); // their Intimidate on the way in: your Attack -1
  if (dAb === 'Thick Fat' && (m.type === 'Fire' || m.type === 'Ice')) A = Math.floor(A / 2);
  const D = Math.max(1, Math.floor(def.st[phys ? 2 : 4] / (m.effect === 'explode' ? 2 : 1)));
  const pw = TYPE_ITEM[att.item] === m.type ? Math.floor(power * 1.1) : power;
  let dmg = Math.floor(Math.floor(Math.floor(2 * att.level / 5 + 2) * pw * A / D) / 50);
  if (crit) dmg *= 2;
  dmg += 2;
  if (mon(att.dex).types.includes(m.type)) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * mult);
  const hits = HITS[m.effect] || 1;
  return out(Math.max(1, Math.floor(dmg * 85 / 100)) * hits, dmg * hits);
}
// Turns to KO with one move, using its low roll for your side and high roll for theirs. Charge moves (Solarbeam, Fly,
// Dig, Sky Attack...) take two turns per hit and Hyper Beam needs a turn to recharge between hits.
function turnsToKO(h, hp, low) {
  if (!h || !h.max) return Infinity;
  const n = Math.ceil(hp / Math.max(1, low ? h.min : h.max));
  const e = state.moves[h.name]?.effect;
  return e === 'charge' ? 2 * n : e === 'recharge' ? 2 * n - 1 : n;
}
function bestHit(att, def) {
  // don't plan around Selfdestruct, Explosion or Fake Out (first turn only) for your side
  const low = !att.foe;
  return att.moves.filter(n => state.moves[n]?.effect !== 'fakeout' && (att.foe || state.moves[n]?.effect !== 'explode')).map(n => hit(att, def, n)).filter(Boolean)
    .sort((a, b) => turnsToKO(a, def.hp, low) - turnsToKO(b, def.hp, low) || b.min + b.max - a.min - a.max)[0] || null;
}
// How a battle between one of your Pokémon and one of theirs goes, one-on-one.
// HP a Pokémon effectively has: a held Sitrus or Oran Berry heals it once
const effHP = b => b.hp + (BERRY_HEAL[b.item] || 0);
function duel(me, foe) {
  const mine = bestHit(me, foe), theirs = bestHit(foe, me);
  const myHits = turnsToKO(mine, effHP(foe), true);
  const theirHits = turnsToKO(theirs, effHP(me), false);
  const faster = me.st[5] > foe.st[5];
  const wins = myHits < theirHits || (myHits === theirHits && faster && myHits !== Infinity);
  const se = me.moves.filter(n => { const h = hit(me, foe, n); return h && h.mult >= 2; });
  const threats = foe.moves.filter(n => { const h = hit(foe, me, n); return h && h.mult >= 2; });
  // a critical hit (1 in 16, 1 in 8 for high-crit moves) doubles damage: could it KO you sooner?
  const critHit = theirs && hit(foe, me, theirs.name, true);
  const critHits = critHit ? turnsToKO(critHit, effHP(me), false) : Infinity;
  return { me, mine, theirs, myHits, theirHits, faster, wins, se, threats, critHits: critHits < theirHits ? critHits : null };
}
// What the damage numbers don't count for this foe: possible abilities, held items, stat moves
function foeNotes(p) {
  const out = [], abs = mon(p.dex).abilities || [];
  if (abs.length === 1) { if (['Levitate', 'Flash Fire', 'Water Absorb', 'Volt Absorb', 'Wonder Guard', 'Thick Fat', 'Intimidate', 'Huge Power', 'Hustle', 'Sturdy', 'Static', 'Poison Point', 'Flame Body', 'Effect Spore', 'Shed Skin', 'Swift Swim', 'Chlorophyll', 'Speed Boost'].includes(abs[0])) out.push(`Ability: ${abs[0]}`); }
  else if (abs.length > 1) out.push(`Ability: ${abs.join(' or ')}`);
  if (p.item) out.push(`Holding ${p.item}${BERRY_HEAL[p.item] ? ` (heals ${BERRY_HEAL[p.item]} HP once)` : TYPE_ITEM[p.item] ? ` (${TYPE_ITEM[p.item]} moves +10%)` : ''}`);
  const st = (p.moves || []).filter(m => STAT_MOVES[m.name]).map(m => `${m.name} ${STAT_MOVES[m.name]}`);
  if (st.length) out.push(`Watch for ${st.join('; ')}`);
  return out;
}
const rankDuels = (a, b) => b.wins - a.wins || a.myHits - b.myHits || (a.theirs?.max || 0) / a.me.hp - (b.theirs?.max || 0) / b.me.hp;

function weaknesses(dex) {
  return ALL_TYPES().map(t => ({ t, m: eff(t, mon(dex).types) })).filter(x => x.m > 1).sort((a, b) => b.m - a.m);
}
function bestTypesAgainst(party) {
  return ALL_TYPES().map(t => ({ t, n: party.filter(p => eff(t, mon(p.dex).types) > 1).length }))
    .filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 4);
}

// Pokémon you could have caught by a point in the story: one entry per species, at the earliest place you can get it.
const catchCache = {};
function catchableBy(stage) {
  // Nuzlocke mode (modes.js) limits each area to its first encounter
  const nuz = typeof nuzAllows === 'function' && nuzOn() ? nuzAllows : null;
  const key = V() + ':' + stage + ':' + JSON.stringify(cur().picks || {}) + (nuz ? JSON.stringify(cur().nuz.areas) : '');
  if (catchCache[key]) return catchCache[key];
  const out = [];
  for (const [dex, list] of Object.entries(state.found)) {
    const w = list.find(x => inVersion(x) && allowed(x, +dex) && x.stage <= stage && !['trade', 'roaming'].includes(x.method) && !(x.loc === 'pallet-town' && x.method === 'gift') && (!nuz || nuz(x.loc, +dex)));
    if (w) out.push({ dex: +dex, ...w });
  }
  return (catchCache[key] = out);
}
// What a catch can become by the foe's level: level-up evolutions at or below that level, and evolution stones
// once the Celadon Department Store sells them. Trade and friendship evolutions are left out.
function evoForms(dex, level, stage) {
  const out = [{ dex, via: [] }];
  for (let i = 0; i < out.length; i++) {
    for (const e of mon(out[i].dex).evolutions || []) {
      const ok = (e.method === 'level' && e.param <= level) || (e.method === 'item' && /Stone$/.test(e.param) && stage >= stageOf('celadon-city'));
      if (ok) out.push({ dex: e.into, via: [...out[i].via, e.method === 'level' ? `Lv ${e.param}` : e.param] });
    }
  }
  return out;
}
// Pokémon you could catch by the time of this battle that have a super-effective level-up move at the foe's level,
// evolved where you would have by then. Ones that win the one-on-one come first, and ones the rest of the trainer's
// team can't hit super effectively are preferred; any that can be are flagged with the move to watch for.
// Lowest level you can get this Pokémon at from that encounter (gifts and prizes have a fixed level)
const catchLevel = c => parseInt(String(c.levels || '').split('-')[0], 10) || 5;
function catchSuggestions(foeMon, foe, stage, party, n = 2) {
  const team = cur().team;
  const others = party.filter(x => x !== foeMon).map(x => ({ p: x, b: foeBattler(x) }));
  const seen = new Set(team);
  const out = [];
  const relearn = stage >= relearnAt();
  for (const c of catchableBy(stage)) {
    // trained up to the foe's level, or the level you catch it at if that's higher
    const from = { dex: c.dex, level: catchLevel(c) }, level = Math.max(foe.level, from.level);
    for (const f of evoForms(c.dex, level, stage)) {
      if (seen.has(f.dex)) continue;
      const learned = learnedBy(f.dex, level, from, relearn), tmm = tmMovesBy(f.dex, stage);
      for (const [mv, x] of tmm) if (!learned.has(mv)) learned.set(mv, x);
      const me = battler(f.dex, level, PLAYER_IV, bestMoves(f.dex, level, from, relearn, tmm));
      const d = duel(me, foe);
      if (!d.se.length || d.myHits === Infinity) continue;
      const risk = [];
      for (const o of others) for (const mv of o.b.moves) { const h = hit(o.b, me, mv); if (h && h.mult >= 2) risk.push(`${o.p.name}'s ${mv}`); }
      out.push({ c, f, d, level, learned, risk: [...new Set(risk)] });
    }
  }
  const picked = [], used = new Set();
  for (const x of out.sort((a, b) => b.d.wins - a.d.wins || (a.risk.length > 0) - (b.risk.length > 0) || isCaught(b.c.dex) - isCaught(a.c.dex) || rankDuels(a.d, b.d) || a.c.stage - b.c.stage)) {
    if (used.has(x.c.dex) || used.has(x.f.dex)) continue;
    used.add(x.c.dex).add(x.f.dex); picked.push(x);
  }
  return picked.slice(0, n);
}

const hpPct = (h, b) => `${Math.min(100, Math.round(100 * h.min / b.hp))}–${Math.min(100, Math.round(100 * h.max / b.hp))}%`;
const multTag = m => m >= 2 ? ` <span class="good">${m}×</span>` : m === 0 ? ' <span class="bad">no effect</span>' : m < 1 ? ` <span class="note">${m === 0.25 ? '¼' : '½'}×</span>` : '';
const hitsText = n => n === Infinity ? "can't KO" : n === 1 ? 'OHKO' : `${n} turns`;
function hitText(h, target, hits) {
  return h ? `${esc(h.name)}${multTag(h.mult)} ${hpPct(h, target)} (${hitsText(hits)})` : '<span class="note">no damaging move</span>';
}

function teamHint() {
  const team = cur().team;
  return `${typeof nuzBanner === 'function' ? nuzBanner() : ''}<p class="note">${team.length ? `Picks use your team from <a href="#/planner">Battle plan</a>: ${team.map(n => esc(mon(n).name)).join(', ')}. Set their levels and moves there for exact numbers.`
    : `Add your team in <a href="#/planner">Battle plan</a> to see who to send out against each trainer.`}
    Damage is estimated with the game's formula. When nobody on your team has a super-effective move, you get a Pokémon you could catch by this point in the story.</p>`;
}

function foeRow(p, stage, party) {
  const team = cur().team;
  const foe = foeBattler(p);
  const weak = weaknesses(p.dex);
  const duels = team.map(n => duel(myBattler(n, p.level), foe)).sort(rankDuels);
  const best = duels[0];
  let pick = '';
  if (best) {
    const nm = esc(mon(best.me.dex).name);
    pick = best.wins ? `Send out <b class="good">${nm}</b>: ${hitText(best.mine, foe, best.myHits)}`
      : `<span class="${best.myHits < Infinity ? 'meh' : 'bad'}">No sure win. Best bet: ${nm}</span>: ${hitText(best.mine, foe, best.myHits)}`;
    pick += `<table class="mini duel"><tr><th>Yours</th><th>Your best hit</th><th>Their best hit on you</th></tr>${duels.map(d => `<tr${d === best ? ' class="best"' : ''}>
        <td><b>${esc(mon(d.me.dex).name)}</b> Lv ${d.me.level}${d.me.guessedLevel ? '*' : ''}${d.faster ? ' <span class="note">faster</span>' : ''}</td>
        <td>${hitText(d.mine, foe, d.myHits)}</td>
        <td>${hitText(d.theirs, d.me, d.theirHits)}${d.critHits ? `<div class="meh">A critical hit could KO in ${hitsText(d.critHits).replace('OHKO', 'one hit')}</div>` : ''}${d.threats.length ? `<div class="bad">Super effective: ${d.threats.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}</table>`;
  }
  // Suggest a catch when you'd lose, or when nobody is super effective and the fight isn't a quick win anyway
  if (!best || !best.wins || (!duels.some(d => d.se.length) && best.myHits > 2)) {
    const sug = catchSuggestions(p, foe, stage, party);
    pick += sug.length ? `<div class="catch">${best ? (duels.some(d => d.se.length) ? 'Or catch' : 'Nobody on your team has a super-effective move. Catch') : 'Good catch'}: ${sug.map(({ c, f, d, level, learned, risk }) => {
      const learn = d.mine && learned.get(d.mine.name);
      const evo = f.dex !== c.dex ? `${esc(mon(c.dex).name)} and evolve it into <b>${esc(mon(f.dex).name)}</b> (${esc(f.via.join(', then '))})` : `<b>${esc(mon(c.dex).name)}</b>`;
      return `${evo} ${types(f.dex)} on <a href="#/loc/${c.loc}">${esc(c.name)}</a>
        <span class="note">(${esc(METHOD_LABEL[c.method] || c.method)}${c.levels ? `, Lv ${esc(c.levels)}` : ''}${isCaught(c.dex) ? ', you have one' : ''}).
        At Lv ${level}: ${hitText(d.mine, foe, d.myHits)}${learn?.tm ? `, teach it ${esc(tmSourceText(learn))}` : learn && learn.level > catchLevel(c) ? `, ${learn.from !== f.dex ? `${esc(mon(learn.from).name)} ` : ''}learns it at Lv ${learn.level}${learn.from !== f.dex && f.via.length ? ' (before evolving)' : ''}` : ''}${d.wins ? '' : ', but it may lose the one-on-one'}</span>${risk.length ? `<div class="bad">Watch out for ${esc(risk.slice(0, 3).join(', '))}</div>` : ''}`;
    }).join('<br>or ')}</div>`
      : `<div class="note">Nothing you can catch by ${esc(state.index[stage]?.name || 'now')} learns or can be taught (TM/HM) a super-effective move by Lv ${p.level}.</div>`;
  }
  return `<div class="foe"><div><b>${esc(p.name)}</b> Lv ${p.level} ${types(p.dex)} <span class="note">${foe.hp} HP</span></div>
    ${p.moves?.length ? `<div class="moves">${p.moves.map(m => `<span class="mv">${esc(m.name)}${m.type ? ` <i class="t-${m.type}"></i>` : ''}${m.power ? ` <small>${m.power === 1 ? '—' : m.power}</small>` : ''}</span>`).join('')}</div>` : ''}
    <div class="note">Weak to: ${weak.length ? weak.map(w => typeTag(w.t) + (w.m === 4 ? '×4' : '')).join(' ') : 'nothing'}</div>
    ${(() => { const n = foeNotes(p); return n.length ? `<div class="note">${n.map(esc).join(' · ')}</div>` : ''; })()}
    <div class="pick">${pick}</div></div>`;
}

const money = n => '₽' + Number(n).toLocaleString();
// One trainer, open by default, with a "defeated" checkbox that counts toward the route's progress.
// Rival battles depend on the starter you picked in Oak's Lab; with no pick yet the card asks for it.
function trainerCard(t, stage, opts = {}) {
  const s = cur(), mine = pickOf('starter');
  const party = t.party || (mine && t.byStarter[mine]);
  const prize = typeof t.prize === 'object' ? (mine ? t.prize[mine] : null) : t.prize;
  const ace = party ? Math.max(...party.map(p => p.level)) : null;
  const head = opts.title || (t.class === t.name ? t.name : `${t.class} ${t.name}`);
  const meta = opts.where ? [opts.where, ace && `ace Lv ${ace}`].filter(Boolean).join(' · ')
    : party ? `${party.length} Pokémon · Lv ${ace} · ${money(prize)}` : 'Team depends on your starter';
  const info = [t.rewards && `Reward: ${t.rewards.map(esc).join(', ')}`, t.uses && `Uses ${t.uses.map(esc).join(', ')}`,
    t.double && 'Double battle'].filter(Boolean).join(' · ');
  const key = trainerKey(opts.loc, t), done = !!s.checks[key];
  const rival = t.byStarter ? (mine ? `<p class="note">You picked ${esc(mine)}, so your rival has ${esc(RIVAL_OF[mine])}. <a href="#/loc/pallet-town">Change it in Oak's Lab</a>.</p>`
    : `<p class="note"><b>Pick your starter to see this team.</b> Your rival takes the one that beats yours. Which did you choose in Professor Oak's Lab?</p>${starterChips()}`) : '';
  return `<details class="card trainer ${done ? 'checked' : ''}"${opts.open === false ? '' : ' open'}><summary><input type="checkbox" class="tcheck" data-key="${esc(key)}" ${done ? 'checked' : ''} aria-label="Defeated ${esc(head)}"><span class="tname">${esc(head)}</span> <span class="note">· ${esc(meta)}</span>${t.double ? ' <span class="tag">Double</span>' : ''}${t.rewards ? ' <span class="tag">Reward</span>' : ''}</summary>
    ${info ? `<p class="note">${info}</p>` : ''}
    ${t.note && !t.byStarter ? `<p class="note">${esc(t.note)}</p>` : ''}${rival}${party ? opts.extra?.(party) || '' : ''}
    ${party ? party.map(p => foeRow(p, stage, party)).join('') : ''}
    ${opts.loc && typeof rematchBlock === 'function' ? rematchBlock(t, opts.loc) : ''}
    ${party && cur().team.some(n => !teamMeta(n).level) ? '<p class="note">* Level not set in Battle plan, so it is assumed to match theirs.</p>' : ''}</details>`;
}

function renderPlanner() {
  setHeader('Battle plan', false, 'planner');
  const s = cur();
  s.teamMeta ||= {};
  const moveNames = Object.keys(state.moves).sort();
  let html = `<div class="card"><b>Your team</b> <span class="note">(up to 6). Set each one's level and moves for exact damage; blank moves assume it kept the strongest attack of each type it learns by level up.</span>
    ${s.team.map((n, i) => {
      const meta = s.teamMeta[n] || {};
      const lvl = meta.level || '';
      const defaults = bestMoves(n, meta.level || 100);
      return `<div class="member"><div class="mhead"><b>${esc(mon(n).name)}</b> ${types(n)}
          <label class="note">Lv <input type="number" min="1" max="100" inputmode="numeric" data-lvl="${n}" value="${lvl}" placeholder="?"></label>
          <button class="icon-x" data-rm="${i}" aria-label="Remove ${esc(mon(n).name)}">&times;</button></div>
        <div class="mvgrid">${[0, 1, 2, 3].map(k => `<input list="movelist" data-mv="${n}:${k}" value="${esc(meta.moves?.[k] || '')}" placeholder="${meta.level ? esc(defaults[k] || 'Move') : 'Move'}">`).join('')}</div></div>`;
    }).join('') || '<p class="note">No Pokémon yet.</p>'}
    <input type="search" id="teamq" placeholder="Add a Pokémon by name" list="monlist" style="margin-top:10px" ${s.team.length >= 6 ? 'disabled' : ''}>
    <datalist id="monlist">${state.dex.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <datalist id="movelist">${moveNames.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <div class="note" style="margin-top:12px">Starter you picked in <a href="#/loc/pallet-town">Professor Oak's Lab</a> (sets your rival's team)${pickOf('starter') ? '' : ': <b class="bad">not picked yet</b>'}</div>
    ${starterChips()}</div>
    ${typeof hmHelper === 'function' ? hmHelper() : ''}
    <p class="note">Gym Leaders, rival battles, Giovanni, the Elite Four and the Champion in story order. Every other trainer is on its route page.</p>`;
  for (const t of state.trainers) {
    html += trainerCard(t, battleStage(t, t.location), {
      title: t.name, where: `${t.where} · ${t.specialty}`, loc: t.location,
      extra: party => `<p class="note">Types that hit most of this team: ${bestTypesAgainst(party).map(g => typeTag(g.t)).join(' ')}</p>`
    });
  }
  html += `<p class="note">Damage uses the Gen 3 formula with your levels and moves, their real moves and IVs, average IVs for yours and no EVs. Abilities are counted when the species can only have one (Levitate, Thick Fat, Intimidate...), held type boosters and berries are counted, and a critical hit that could KO you sooner is flagged. Stat-changing moves and two-ability Pokémon are shown as warnings, not counted.</p>`;
  view.innerHTML = html;
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { s.team.splice(+b.dataset.rm, 1); save(); renderPlanner(); });
  view.querySelectorAll('[data-lvl]').forEach(inp => inp.onchange = () => {
    const n = inp.dataset.lvl, v = Math.max(0, Math.min(100, parseInt(inp.value, 10) || 0));
    (s.teamMeta[n] ||= {}).level = v || undefined; save(); renderPlanner();
  });
  view.querySelectorAll('[data-mv]').forEach(inp => inp.onchange = () => {
    const [n, k] = inp.dataset.mv.split(':');
    const name = moveNames.find(m => m.toLowerCase() === inp.value.trim().toLowerCase()) || '';
    const meta = (s.teamMeta[n] ||= {});
    meta.moves = [0, 1, 2, 3].map(i => (meta.moves || [])[i] || '');
    meta.moves[k] = name; save(); renderPlanner();
  });
  const q = document.getElementById('teamq');
  q.onchange = () => {
    const p = state.dex.find(x => x.name.toLowerCase() === q.value.trim().toLowerCase());
    if (!p || s.team.length >= 6 || s.team.includes(p.dex)) return;
    s.team.push(p.dex);
    // the first starter-line Pokémon added with no starter picked yet is taken to be your starter
    const k = starterKeyOf(p.dex);
    if (k && !pickOf('starter') && s.team.filter(starterKeyOf).length === 1) return setPick('starter', k);
    save(); renderPlanner();
  };
}

// ---------- team plan ----------
// The best team at every point of the game, from data/team-plan.json (written by scripts/team_planner.js): before
// each key battle, who to catch or box, who evolves, what to teach, the lineup and who to lead with. Steps are
// checkboxes saved per version and starter; the battle row shares its "defeated" check with the route page.
const planKey = id => `plan:${pickOf('starter')}:${id}`;
const STEP_TAG = { catch: 'Catch', box: 'Box', evolve: 'Evolve', teach: 'TM/HM', learn: 'Level up' };
function planOf(version, starter) { return state.teamPlan?.plans[`${version}:${starter}`] || null; }
function legKeys(leg) { return [...leg.steps.map(x => planKey(x.id)), trainerKey(leg.battle.loc, leg.battle)]; }
function renderPlan() {
  setHeader('Team plan', false, 'plan');
  if (!state.teamPlan) {
    view.innerHTML = '<div class="card">Loading the plan…</div>';
    getJSON('data/team-plan.json').then(d => { state.teamPlan = d; if (location.hash.startsWith('#/plan')) renderPlan(); })
      .catch(err => { view.innerHTML = `<div class="card">Could not load the plan: ${esc(err.message)}</div>`; });
    return;
  }
  const st = pickOf('starter'), s = cur();
  let html = `<div class="card"><b>The best team at every point of the game</b>
    <p class="note">Before each key battle: who to catch or box, who evolves, which moves and TMs to teach, your lineup and who to lead with. Tick steps off as you go. Levels assume your team is near the leader's ace level.</p>
    <div class="note">Your starter from <a href="#/loc/pallet-town">Professor Oak's Lab</a>${st ? '' : ': <b class="bad">not picked yet</b>'}</div>${starterChips()}</div>`;
  const plan = st && planOf(V(), st);
  if (!plan) {
    view.innerHTML = html + '<p class="note">Pick your starter to see its plan. Squirtle gives the strongest run in both versions.</p>';
    return;
  }
  const keys = plan.legs.flatMap(legKeys), done = keys.filter(k => s.checks[k]).length;
  const firstOpen = plan.legs.findIndex(l => legKeys(l).some(k => !s.checks[k]));
  html += `<div class="card"><b>End-game team</b><div class="chips" style="margin:6px 0">${plan.end.map(d => `<span class="chip">${esc(mon(d).name)}</span>`).join('')}</div>
    <div class="note">${done}/${keys.length} steps done · this plan wins ${plan.won} of ${plan.total} trainer Pokémon one-on-one</div>${bar(done, keys.length)}</div>`;
  plan.legs.forEach((leg, i) => {
    const lk = legKeys(leg), ld = lk.filter(k => s.checks[k]).length, b = leg.battle;
    html += `<details class="card leg ${ld === lk.length ? 'checked' : ''}" data-leg="${i}"${i === firstOpen ? ' open' : ''}>
      <summary>${i + 1}. ${esc(b.name)} <span class="note">· ${esc(b.where)} · ace Lv ${b.ace}</span> <span class="tag legcount">${ld}/${lk.length}</span></summary>`;
    for (const x of leg.steps) html += checkRow(planKey(x.id), !!s.checks[planKey(x.id)], esc(x.text), esc(x.sub), ` <span class="tag">${STEP_TAG[x.kind]}</span>` + (x.kind === 'catch' && x.loc && typeof catchLink === 'function' ? catchLink(x.loc, x.dex) : ''));
    const tk = trainerKey(b.loc, b);
    html += checkRow(tk, !!s.checks[tk], `Beat ${esc(b.name)}`, `${esc(b.where)}${b.loc ? ` · <a href="#/loc/${b.loc}">route page</a>` : ''}`, ' <span class="tag">Battle</span>');
    html += `<table class="mini lineup"><tr><th>Lineup</th><th>Lv</th><th>Moves</th></tr>${leg.team.map(m => `<tr><td>${esc(mon(m.dex).name)}</td><td>${m.level}</td><td>${esc(m.moves.join(', '))}</td></tr>`).join('')}</table>
      <p class="note">Lead with: ${leg.leads.map(l => `${esc(mon(l.foe).name)} ${l.level} → ${l.by ? `<b>${esc(mon(l.by).name)}</b>${l.move ? ` (${esc(l.move)})` : ''}${l.clean ? '' : ' <span class="bad">close</span>'}` : 'nobody yet'}`).join(' · ')}</p>
      <p class="note">This lineup wins ${leg.won} of ${leg.total} trainer Pokémon on the way.</p>
      <button class="btn small" data-copyteam="${i}">Use this lineup in the Battle plan</button></details>`;
  });
  html += '<p class="note">Made by the same damage engine as the Battle plan, against every trainer up to the Champion. It ignores accuracy, critical hits, abilities, held items and status moves, so treat close calls with care.</p>';
  view.innerHTML = html;
  view.querySelectorAll('[data-copyteam]').forEach(btn => btn.onclick = () => copyLineup(plan.legs[+btn.dataset.copyteam]));
}
// Put a leg's lineup, levels and moves into the Battle plan team.
function copyLineup(leg) {
  const s = cur();
  s.team = leg.team.map(m => m.dex);
  s.teamMeta ||= {};
  for (const m of leg.team) s.teamMeta[m.dex] = { level: m.level, moves: [0, 1, 2, 3].map(k => m.moves[k] || '') };
  save();
  location.hash = '#/planner';
}
// Keep a leg's done count current when a box is ticked.
function updateLegCount(el) {
  const leg = el?.closest?.('details.leg');
  if (!leg) return;
  const boxes = [...leg.querySelectorAll('input[type=checkbox]')], n = boxes.filter(x => x.checked).length;
  const tag = leg.querySelector('.legcount');
  if (tag) tag.textContent = `${n}/${boxes.length}`;
  leg.classList.toggle('checked', n === boxes.length);
}

// ---------- tools ----------
// More tools registered by other files: { id, title, desc, render(arg) }. An id starting with # is a link to another page.
const TOOLS = [];
function renderTools(tool, arg) {
  const ext = TOOLS.find(t => t.id === tool);
  setHeader(tool ? ext?.title || { breeding: 'Breeding helper', types: 'Type matchups', exclusives: 'Version exclusives' }[tool] : 'Tools', !!tool, 'tools');
  if (ext?.render) return ext.render(arg);
  if (tool === 'breeding') return renderBreeding();
  if (tool === 'types') return renderTypes();
  if (tool === 'exclusives') return renderExclusives();
  view.innerHTML = [
    ['breeding', 'Breeding helper', 'Egg groups, compatible partners, what hatches and how many steps it takes'],
    ['types', 'Type matchups', 'Look up weaknesses for any type combination, plus the full chart'],
    ['exclusives', 'Version exclusives', `Pokémon you need to trade for from ${VNAME[OTHER[V()]]}`],
    ...TOOLS.map(t => [t.id, t.title, t.desc])
  ].map(([id, t, d]) => `<a class="card loc" href="${id.startsWith('#') ? id : `#/tools/${id}`}"><div class="name">${t}<div class="meta">${d}</div></div><span>&rsaquo;</span></a>`).join('');
}

function renderBreeding() {
  const sel = state.breedSel || 1;
  const p = mon(sel);
  const groups = p.eggGroups || [];
  const undiscovered = groups.includes('Undiscovered');
  const isDitto = groups.includes('Ditto');
  // A pair needs one male and one female, so drop partners that can only be the same gender.
  const partners = undiscovered || isDitto ? [] : state.dex.filter(q => q.dex !== sel && q.eggGroups?.some(g => groups.includes(g))
    && !['genderless'].includes(q.gender) && !(q.gender === p.gender && ['male', 'female'].includes(p.gender)));
  // In Gen 3, Azurill and Wynaut only hatch if a parent holds Sea Incense or Lax Incense.
  const INCENSE = { 298: [183, 'Sea Incense'], 360: [202, 'Lax Incense'] }; // baby: [normal hatch, item]
  const base = baseForm(sel);
  const incense = INCENSE[base] && [base, INCENSE[base][1]];
  const hatch = incense ? INCENSE[base][0] : base;
  const genderText = { genderless: 'Genderless', male: 'Always male', female: 'Always female' }[p.gender] || p.gender.replace('% F', '% female');
  let html = `<div class="card"><input type="search" id="breedq" placeholder="Pick a Pokémon" list="monlist2" value="${esc(p.name)}">
    <datalist id="monlist2">${state.dex.map(x => `<option value="${esc(x.name)}">`).join('')}</datalist></div>
    <div class="card"><b>#${p.dex} ${esc(p.name)}</b> ${types(sel)}
    <table class="mini" style="margin-top:8px">
      <tr><td>Egg groups</td><td>${groups.map(esc).join(', ')}</td></tr>
      <tr><td>Gender</td><td>${esc(genderText)}</td></tr>
      <tr><td>Egg hatches into</td><td>${undiscovered ? '—' : isDitto ? "The partner's baby form" : esc(mon(hatch).name)}${incense ? ` <span class="note">(${esc(mon(incense[0]).name)} if a parent holds ${incense[1]})</span>` : ''}</td></tr>
      <tr><td>Steps to hatch</td><td>${undiscovered || isDitto ? '—' : `${(p.eggCycles * 256).toLocaleString()}`}</td></tr>
    </table></div>`;
  if (undiscovered) html += `<div class="card bad">This Pokémon can't breed.</div>`;
  else if (isDitto) html += `<div class="card">Ditto can breed with any Pokémon that can breed, including genderless ones, but not with another Ditto.</div>`;
  else if (p.gender === 'genderless') html += `<div class="card">Genderless: it can only breed with <b>Ditto</b>.</div>`;
  else html += `<div class="card"><b>Can breed with</b> Ditto, or any of these with the opposite gender:<p class="note">${partners.map(q => esc(q.name)).join(', ')}</p></div>`;
  html += `<div class="card note">Breeding happens at the Day Care on Four Island (post-game). The Route 5 Day Care only raises one Pokémon and can't make eggs. The baby learns any move both parents know that's in its level-up set, plus the father's TMs and egg moves.</div>`;
  view.innerHTML = html;
  const q = document.getElementById('breedq');
  q.onchange = () => { const m = state.dex.find(x => x.name.toLowerCase() === q.value.trim().toLowerCase()); if (m) { state.breedSel = m.dex; renderBreeding(); } };
}

function renderTypes() {
  const T = Object.keys(state.types);
  const pick = state.typePick || ['Water'];
  const mults = T.map(a => ({ a, m: eff(a, pick) }));
  const list = (f, label) => { const xs = mults.filter(f); return xs.length ? `<tr><td>${label}</td><td>${xs.map(x => typeTag(x.a) + (x.m === 4 ? '×4' : x.m === 0.25 ? '¼' : '')).join(' ')}</td></tr>` : ''; };
  let html = `<div class="card"><p class="note">Pick one or two defending types.</p><div class="chips">${T.map(t => `<button class="chip ${pick.includes(t) ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
    <table class="mini" style="margin-top:10px">${list(x => x.m > 1, 'Weak to')}${list(x => x.m > 0 && x.m < 1, 'Resists')}${list(x => x.m === 0, 'Immune to')}</table></div>`;
  html += `<h2>Full chart (attacker down, defender across)</h2><div class="card grid-chart"><table><tr><th></th>${T.map(t => `<th title="${t}">${t.slice(0, 3)}</th>`).join('')}</tr>
    ${T.map(a => `<tr><th>${a.slice(0, 3)}</th>${T.map(d => { const m = eff(a, [d]); return `<td class="${m === 2 ? 'x2' : m === 0.5 ? 'x05' : m === 0 ? 'x0' : ''}">${m === 1 ? '' : m === 0.5 ? '½' : m}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
  view.innerHTML = html;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const t = b.dataset.t;
    const p = pick.includes(t) ? pick.filter(x => x !== t) : [...pick, t].slice(-2);
    state.typePick = p.length ? p : [t]; renderTypes();
  });
}

function exclusiveWhere(n) {
  const a = availability(n);
  if (a.via) return `Evolve ${esc(mon(a.via).name)} (in ${VNAME[OTHER[V()]]})`;
  return [...new Set((state.found[n] || []).map(w => w.name))].slice(0, 3).map(esc).join(', ') + ` (in ${VNAME[OTHER[V()]]})`;
}
function renderExclusives() {
  const rows = state.dex.filter(p => availability(p.dex).kind === 'other');
  const missed = state.dex.filter(p => availability(p.dex).kind === 'missed');
  view.innerHTML = `<div class="card note">Pokémon you can't catch or evolve in ${VNAME[V()]} but can in ${VNAME[OTHER[V()]]}. Trade for them, or evolve one you trade over.</div>
    <div class="card">${rows.map(p => checkRow(`dex:${p.dex}`, isCaught(p.dex), `#${String(p.dex).padStart(3, '0')} ${esc(p.name)} ${types(p.dex)}`,
      exclusiveWhere(p.dex))).join('') || '<div class="empty">None.</div>'}</div>
    <h2>Passed up by your picks</h2>
    <div class="card"><p class="note">The starters, fossil and Dojo prize you didn't take. Trade for these from another game.</p>${missed.map(p => checkRow(`dex:${p.dex}`, isCaught(p.dex), `#${String(p.dex).padStart(3, '0')} ${esc(p.name)} ${types(p.dex)}`,
      missedText(availability(p.dex)))).join('') || '<div class="empty">Nothing yet. Picks you make in the game show up here.</div>'}</div>`;
}

function renderSettings() {
  setHeader('Backup & settings', true, '');
  view.innerHTML = `
    <div class="card"><label class="row"><input type="checkbox" id="hideDone" ${state.progress.hideDone ? 'checked' : ''}><span>Hide completed locations</span></label>
      <label class="row"><input type="checkbox" id="hideRows" ${state.progress.hideRows ? 'checked' : ''}><span>Hide ticked-off rows on location pages</span></label>
      <div class="row"><span>Theme</span><select id="theme" style="width:auto;margin-left:auto">${['auto', 'light', 'dark'].map(t => `<option ${(state.progress.theme || 'auto') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    ${SYNC_URL ? syncCard() : ''}
    <h2>Backup</h2>
    <div class="card"><p class="note">Progress is saved on this device${SYNC_URL ? ' (and in the cloud if you turn on sync above)' : ' only'}. Export a backup file to move it to another phone or keep it safe.</p>
      <div class="toolbar"><button class="btn" id="export">Export backup</button>
      <label class="btn">Import backup<input type="file" id="import" accept="application/json" hidden></label></div></div>
    <h2>Reset</h2>
    <div class="card"><button class="btn" id="reset">Reset ${VNAME[V()]} progress</button></div>
    <p class="note">Pokémon, item, gift and trainer data come from the pret/pokefirered decompilation of the game. Walkthrough steps are written guidance.</p>`;
  document.getElementById('hideDone').onchange = e => { state.progress.hideDone = e.target.checked; save(); };
  document.getElementById('hideRows').onchange = e => { state.progress.hideRows = e.target.checked; save(); applyVersion(); };
  document.getElementById('theme').onchange = e => { state.progress.theme = e.target.value; save(); applyVersion(); };
  document.getElementById('export').onclick = () => {
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'frlg-dex-backup.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('import').onchange = async e => {
    try {
      const p = normaliseProgress(JSON.parse(await e.target.files[0].text()));
      if (!p) throw new Error('not a backup');
      state.progress = p; save(); applyVersion(); renderSettings(); alert('Backup restored.');
    } catch (err) { alert('That file is not a valid backup.'); }
    e.target.value = '';
  };
  if (SYNC_URL) bindSyncCard();
  document.getElementById('reset').onclick = () => {
    if (confirm(`Erase all ${VNAME[V()]} progress? This cannot be undone.`)) { state.progress.saves[V()] = freshSave(); save(); alert('Progress reset.'); }
  };
}

// ---------- cloud sync ----------
// Local storage stays the main store. When signed in, every change is pushed a few seconds later,
// and the cloud copy is pulled on start and whenever the app comes back to the foreground.
const sync = {
  cfg: (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } })(),
  timer: null, busy: false, status: '',
  on() { return !!(SYNC_URL && this.cfg.email); },
  store() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(this.cfg)); } catch (e) { /* storage blocked */ } },
  setStatus(msg) { this.status = msg; const el = document.getElementById('syncStatus'); if (el) el.textContent = msg; },
  async call(path, body, keepalive = false) {
    const res = await fetch(SYNC_URL.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'server error ' + res.status);
    return data;
  },
  changed() {
    if (!this.on()) return;
    this.cfg.dirty = true; this.store();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 4000);
  },
  async push(keepalive = false) {
    if (!this.on() || this.busy) return;
    clearTimeout(this.timer);
    this.busy = true; this.setStatus('Saving to cloud…');
    try {
      const r = await this.call('/save', { email: this.cfg.email, progress: state.progress }, keepalive);
      this.cfg.syncedAt = r.updatedAt; this.cfg.dirty = false; this.store();
      this.setStatus('Saved to cloud ' + new Date(r.updatedAt).toLocaleTimeString());
    } catch (err) {
      this.setStatus('Cloud save failed (' + err.message + '). Your progress is still saved on this device.');
      if (/too often/.test(err.message)) this.timer = setTimeout(() => this.push(), 5000);
    } finally { this.busy = false; }
  },
  apply(remote, updatedAt) {
    const p = normaliseProgress(remote);
    if (!p) return false;
    state.progress = p; writeLocal();
    this.cfg.syncedAt = updatedAt; this.cfg.dirty = false; this.store();
    applyVersion(); route();
    this.setStatus('Loaded cloud save from ' + new Date(updatedAt).toLocaleString());
    return true;
  },
  async pull() {
    if (!this.on() || this.busy) return;
    this.busy = true;
    let r;
    try { r = await this.call('/load', { email: this.cfg.email }); }
    catch (err) { this.setStatus('Could not reach cloud save (' + err.message + ').'); return; }
    finally { this.busy = false; }
    if (!r.progress) return this.push();
    if (r.updatedAt === this.cfg.syncedAt) { if (this.cfg.dirty) this.push(); else this.setStatus('Cloud save is up to date.'); return; }
    if (!this.cfg.dirty || confirm('Your cloud save was changed on another device, and this device also has changes that were not uploaded.\n\nOK: load the cloud save (this device\'s new changes are lost).\nCancel: keep this device and overwrite the cloud save.')) this.apply(r.progress, r.updatedAt);
    else this.push();
  },
  async signIn(email) {
    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { alert('Enter a valid email address.'); return; }
    this.setStatus('Checking for a cloud save…');
    let r;
    try { r = await this.call('/load', { email }); }
    catch (err) { this.setStatus(''); alert('Could not reach the sync server: ' + err.message); return; }
    this.cfg = { email, syncedAt: null, dirty: false };
    if (r.progress && confirm(`Found a cloud save for ${email} from ${new Date(r.updatedAt).toLocaleString()}.\n\nOK: load it onto this device (replaces this device's progress).\nCancel: upload this device's progress over it.`)) {
      this.store(); this.apply(r.progress, r.updatedAt);
    } else { this.store(); await this.push(); }
    if (location.hash.startsWith('#/settings')) renderSettings();
  },
  signOut() {
    this.cfg = {}; this.store(); this.setStatus('');
    renderSettings();
  }
};

function syncCard() {
  const on = sync.on();
  return `<h2>Sync across devices</h2>
    <div class="card">
      ${on ? `<p>Syncing as <strong>${esc(sync.cfg.email)}</strong></p>
        <div class="toolbar"><button class="btn" id="syncNow">Sync now</button><button class="btn" id="syncOut">Stop syncing</button></div>`
      : `<p class="note">Enter an email address to keep your progress in the cloud and load it on another phone or computer by entering the same email there.</p>
        <form id="syncForm" class="toolbar"><input type="email" id="syncEmail" placeholder="you@example.com" autocomplete="email" required><button class="btn">Start syncing</button></form>`}
      <p class="note" id="syncStatus">${esc(sync.status)}</p>
      <p class="note"><strong>There is no password.</strong> Anyone who knows or guesses this email can load or overwrite this save, so don't use it for anything you need to keep private. The email is only used as a key: it is stored as a one-way hash, and no emails are sent.</p>
    </div>`;
}
function bindSyncCard() {
  const form = document.getElementById('syncForm');
  if (form) form.onsubmit = e => { e.preventDefault(); sync.signIn(document.getElementById('syncEmail').value); };
  const now = document.getElementById('syncNow');
  if (now) now.onclick = () => (sync.cfg.dirty ? sync.push() : sync.pull());
  const out = document.getElementById('syncOut');
  if (out) out.onclick = () => { if (confirm('Stop syncing on this device? Your progress stays on this device and in the cloud.')) sync.signOut(); };
}
document.addEventListener('visibilitychange', () => {
  if (!sync.on()) return;
  if (document.visibilityState === 'hidden') { if (sync.cfg.dirty) sync.push(true); }
  else sync.pull();
});
window.addEventListener('online', () => { if (sync.on()) sync.cfg.dirty ? sync.push() : sync.pull(); });

// ---------- shell ----------
// Extra pages (features.js and friends) register themselves here: PAGES.mon = id => ..., reached at #/mon/<id>.
const PAGES = {};
const AFTER_RENDER = []; // (page, id) => void, run after every page is drawn
function setHeader(title, back, tab) {
  document.getElementById('title').textContent = title;
  document.getElementById('back').hidden = !back;
  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
}
function applyVersion() {
  document.documentElement.dataset.version = V();
  document.documentElement.dataset.theme = state.progress.theme || 'auto';
  document.documentElement.classList.toggle('hide-rows', !!state.progress.hideRows);
  document.querySelectorAll('[data-version]').forEach(b => b.classList.toggle('on', b.dataset.version === V()));
}
function route(keepScroll) {
  const y = window.scrollY;
  const [, page, id, arg] = location.hash.split('/');
  if (page === 'loc') renderLocation(id);
  else if (page === 'dex') renderDex();
  else if (page === 'planner') renderPlanner();
  else if (page === 'plan') renderPlan();
  else if (page === 'tools') renderTools(id, arg && decodeURIComponent(arg));
  else if (page === 'settings') renderSettings();
  else if (PAGES[page]) PAGES[page](id ? decodeURIComponent(id) : id, arg && decodeURIComponent(arg));
  else renderHome();
  for (const f of AFTER_RENDER) f(page, id);
  window.scrollTo(0, keepScroll ? y : 0);
}

// Undo for the last checkbox: a toast at the bottom for a few seconds
let undoTimer = null;
function showUndo(key, was, label) {
  let t = document.getElementById('toast');
  if (!t) { t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' }); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(label)}</span><button class="btn small" id="undoBtn">Undo</button>`;
  t.hidden = false;
  clearTimeout(undoTimer); undoTimer = setTimeout(() => { t.hidden = true; }, 5000);
  document.getElementById('undoBtn').onclick = () => {
    const s = cur();
    if (key.startsWith('dex:')) { if (was) s.caught[key.slice(4)] = was; else delete s.caught[key.slice(4)]; }
    else if (was) s.checks[key] = true; else delete s.checks[key];
    t.hidden = true; save(); route(true);
  };
}
view.addEventListener('change', e => {
  if (e.target.dataset?.pick) return setPick(e.target.dataset.pick, e.target.value);
  const key = e.target.dataset?.key;
  if (!key) return;
  const s = cur();
  const was = key.startsWith('dex:') ? s.caught[key.slice(4)] : s.checks[key];
  try {
    const box = e.target.closest('.row, .trainer, .chip');
    const span = box.querySelector('label > span, .rowlink > span, .tname');
    const lbl = (span ? [...span.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('') : box.textContent) || 'item';
    showUndo(key, was, `${e.target.checked ? 'Ticked' : 'Unticked'} ${lbl.trim().slice(0, 40)}`);
  } catch (err) { /* no toast without a page to show it on */ }
  if (key.startsWith('dex:')) {
    const d = key.slice(4);
    if (e.target.checked) s.caught[d] = true; else delete s.caught[d];
    view.querySelectorAll(`[data-key="dex:${d}"]`).forEach(x => { x.checked = e.target.checked; x.closest('.row').classList.toggle('checked', e.target.checked); });
  } else if (e.target.checked) s.checks[key] = true; else delete s.checks[key];
  save();
  e.target.closest('.row, .trainer')?.classList.toggle('checked', e.target.checked);
  e.target.closest('.chip')?.classList.toggle('on', e.target.checked);
  updateLegCount(e.target);
  if (key.includes(':trainer:')) { const h = [...view.querySelectorAll('h2')].find(x => x.textContent.startsWith('Trainers (')); if (h) h.textContent = h.textContent.replace(/\(\d+\//, `(${view.querySelectorAll('.tcheck:checked').length}/`); }
});
view.addEventListener('click', e => {
  const id = e.target.dataset?.unpick;
  if (id) setPick(id, null);
});
document.querySelectorAll('[data-version]').forEach(b => b.onclick = () => { state.progress.version = b.dataset.version; save(); applyVersion(); route(); });
document.getElementById('back').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/'; };
window.addEventListener('hashchange', route);

applyVersion();
loadData().then(() => { route(); sync.pull(); }).catch(err => { view.innerHTML = `<div class="card">Could not load data: ${esc(err.message)}</div>`; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
