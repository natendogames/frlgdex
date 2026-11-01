'use strict';
// FRLG Completion Dex: route checklists, Pokédex tracker, battle planner and tools.
// Progress is stored in localStorage under STORE_KEY with a separate save for each version.

const STORE_KEY = 'frlg-dex-progress-v1';
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

const state = { index: [], locations: {}, dex: [], trainers: [], types: {}, walk: {}, found: {}, progress: loadProgress(), dexFilter: { scope: 'kanto', missing: false, q: '' } };

function freshSave() { return { caught: {}, checks: {}, team: [], starter: 'Bulbasaur' }; }
function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE_KEY));
    if (p && p.saves) {
      for (const v of ['FR', 'LG']) p.saves[v] = Object.assign(freshSave(), p.saves[v]);
      if (!['FR', 'LG'].includes(p.version)) p.version = 'FR';
      return p;
    }
  } catch (e) { /* fall through to a fresh save */ }
  return { version: 'FR', hideDone: false, saves: { FR: freshSave(), LG: freshSave() } };
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.progress)); } catch (e) { /* storage blocked */ } }
const V = () => state.progress.version;
const cur = () => state.progress.saves[V()];
const inVersion = x => !x.versions || x.versions.includes(V());

const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
async function loadData() {
  const [idx, dex, trainers, types, walk] = await Promise.all(['data/locations.json', 'data/pokedex.json', 'data/trainers.json', 'data/types.json', 'data/walkthrough.json'].map(getJSON));
  Object.assign(state, { index: idx.locations, dex, trainers, types, walk });
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
const encStage = (locId, e) => Math.max(stageOf(locId), UNLOCK[e.method] ? stageOf(UNLOCK[e.method].at) : -1);
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
  const here = f.filter(inVersion);
  if (here.length) return { kind: 'catch', where: here };
  const p = mon(n).evolvesFrom;
  if (p) {
    const e = mon(p).evolutions.find(x => x.into === n);
    if (['catch', 'evolve'].includes(availability(p).kind)) return { kind: 'evolve', from: p, how: (EVO_LABEL[e.method] || (() => e.method))(e.param) };
  }
  if (f.length) return { kind: 'other', where: f };
  if (p && availability(p).kind === 'other') return { kind: 'other', where: [], via: p };
  if (EVENT_ONLY.has(n)) return { kind: 'event' };
  return { kind: 'none' };
}

function availText(n) {
  const a = availability(n);
  if (a.kind === 'catch') {
    // a.where is sorted by when you can first catch it there, so the earliest chance comes first
    const uniq = [...new Map([...a.where].reverse().map(w => [w.loc, w])).values()].sort((x, y) => x.stage - y.stage);
    return uniq.slice(0, 4).map(w => `<a href="#/loc/${w.loc}">${esc(w.name)}</a> <span class="note">(${esc(METHOD_LABEL[w.method] || w.method)}${w.later ? `, after ${esc(unlockName(w.method))}` : ''})</span>`).join(', ') + (uniq.length > 4 ? ` +${uniq.length - 4} more` : '');
  }
  if (a.kind === 'evolve') return `Evolve ${esc(mon(a.from).name)}: ${esc(a.how)}`;
  if (a.kind === 'other') return `<span class="bad">Not in ${VNAME[V()]}.</span> Trade from ${VNAME[OTHER[V()]]}${a.via ? ` (or trade for ${esc(mon(a.via).name)} and evolve it)` : ''}.`;
  if (a.kind === 'event') return 'Event only (Nintendo distribution).';
  return n > 151 ? 'Trade from Ruby, Sapphire, Emerald, Colosseum or XD.' : 'Not obtainable in this version.';
}

// ---------- progress maths ----------
function locStats(loc) {
  const s = cur();
  const dex = [...new Set(loc.encounters.filter(inVersion).map(e => e.dex))];
  const keys = [...loc.items.map(i => `${loc.id}:item:${i.id}`), ...loc.gifts.filter(inVersion).map(g => `${loc.id}:gift:${g.id}`)];
  return { total: dex.length + keys.length, done: dex.filter(d => s.caught[d]).length + keys.filter(k => s.checks[k]).length };
}
function globalStats() {
  const s = cur(); let items = 0, itemsDone = 0, gifts = 0, giftsDone = 0;
  for (const loc of Object.values(state.locations)) {
    for (const i of loc.items) { items++; if (s.checks[`${loc.id}:item:${i.id}`]) itemsDone++; }
    for (const g of loc.gifts.filter(inVersion)) { gifts++; if (s.checks[`${loc.id}:gift:${g.id}`]) giftsDone++; }
  }
  let kanto = 0; for (let n = 1; n <= 151; n++) if (s.caught[n]) kanto++;
  return { dex: [kanto, 151], items: [itemsDone, items], gifts: [giftsDone, gifts] };
}

// ---------- views ----------
function renderHome() {
  setHeader('FRLG Completion Dex', false, 'routes');
  const g = globalStats();
  const stat = (label, [a, b]) => `<div class="stat"><b>${a}/${b}</b><span>${label}</span>${bar(a, b)}</div>`;
  let html = `<div class="card stats">${stat('Kanto Dex', g.dex)}${stat('Items', g.items)}${stat('NPC gifts', g.gifts)}</div>`;
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
function checkRow(key, checked, title, sub, tags = '') {
  const id = 'cb' + (rowSeq++);
  return `<div class="row ${checked ? 'checked' : ''}">
    <input type="checkbox" id="${id}" data-key="${esc(key)}" ${checked ? 'checked' : ''}>
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

  const trs = loc.trainers || [];
  if (trs.length) {
    html += `<h2>Trainers (${trs.length})</h2>${teamHint()}`;
    for (const [area, list] of Object.entries(groupBy(trs, t => t.area))) {
      if (area) html += `<div class="area">${esc(area)}</div>`;
      html += list.map(t => trainerCard(t, stageOf(t.stage || id))).join('');
    }
  }

  const encs = loc.encounters.filter(inVersion);
  const here = stageOf(id);
  const encList = (list, later) => {
    let out = '';
    for (const [area, grp] of Object.entries(groupBy(list, e => e.area))) {
      if (area) out += `<div class="area">${esc(area)}</div>`;
      out += grp.map(e => {
        const sub = [METHOD_LABEL[e.method] || e.method, e.levels && `Lv ${esc(e.levels)}`, e.rate && esc(e.rate), e.notes && esc(e.notes),
          later && `Needs ${esc(UNLOCK[e.method].need)}`].filter(Boolean).join(' · ');
        const excl = e.versions.length === 1 ? `<span class="tag">${e.versions[0]} only</span>` : '';
        return checkRow(`dex:${e.dex}`, s.caught[e.dex], `#${String(e.dex).padStart(3, '0')} ${esc(e.name)} ${types(e.dex)}`, sub, excl);
      }).join('');
    }
    return out;
  };
  const now = encs.filter(e => encStage(id, e) <= here), later = encs.filter(e => encStage(id, e) > here);
  html += `<h2>Pokémon</h2><div class="card">`;
  if (!encs.length) html += '<div class="empty">No Pokémon to catch here.</div>';
  else if (!now.length) html += '<div class="empty">Nothing to catch on your first visit.</div>';
  html += encList(now, false) + `</div>`;
  if (later.length) html += `<h2>Pokémon: come back later</h2><div class="card"><p class="note">You can't fish, Surf or Rock Smash here on your first visit. These open up later in the story.</p>${encList(later, true)}</div>`;

  const section = (title, list, kind, subFn) => {
    html += `<h2>${title} (${list.filter(x => s.checks[`${loc.id}:${kind}:${x.id}`]).length}/${list.length})</h2><div class="card">`;
    if (!list.length) html += '<div class="empty">None.</div>';
    for (const [area, grp] of Object.entries(groupBy(list, x => x.where))) {
      if (area && kind === 'item') html += `<div class="area">${esc(area)}</div>`;
      html += grp.map(x => { const k = `${loc.id}:${kind}:${x.id}`; return checkRow(k, s.checks[k], esc(x.name), subFn(x)); }).join('');
    }
    html += `</div>`;
  };
  section('Items', loc.items.filter(i => !i.hidden), 'item', () => 'On the ground');
  section('Hidden items', loc.items.filter(i => i.hidden), 'item', () => 'Hidden: use the Itemfinder');
  section('NPC gifts &amp; trades', loc.gifts.filter(inVersion), 'gift', g => [g.from && esc(g.from), esc(g.where)].filter(Boolean).join(' · '));
  view.innerHTML = html;
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
    <div class="card">${list.map(p => checkRow(`dex:${p.dex}`, isCaught(p.dex),
      `#${String(p.dex).padStart(3, '0')} ${esc(p.name)} ${types(p.dex)}`, availText(p.dex))).join('') || '<div class="empty">Nothing matches.</div>'}</div>`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    const [k, v] = b.dataset.f.split(':');
    if (k === 'scope') f.scope = v; else f.missing = !f.missing;
    renderDex();
  });
  const q = document.getElementById('dexq');
  q.oninput = () => { f.q = q.value; const pos = q.selectionStart; renderDex(); const n = document.getElementById('dexq'); n.focus(); n.setSelectionRange(pos, pos); };
}

// ---------- battle engine (route trainers and the Battle plan tab) ----------
// Matchups use type effectiveness only: your Pokémon's own types against theirs, and their damaging moves against yours.
const ALL_TYPES = () => Object.keys(state.types);
function attackTypes(foe) {
  const dmg = (foe.moves || []).filter(m => m.power && m.type).map(m => m.type);
  return new Set(dmg.length ? dmg : (foe.moves?.length ? [] : mon(foe.dex).types));
}
function matchupTypes(myTypes, foe) {
  const ft = mon(foe.dex).types;
  const offense = Math.max(...myTypes.map(t => eff(t, ft)));
  const defense = Math.max(0, ...[...attackTypes(foe)].map(t => eff(t, myTypes)));
  return { offense, defense, score: offense / Math.max(defense, 0.25) };
}
const matchup = (member, foe) => matchupTypes(mon(member).types, foe);
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
  const key = V() + ':' + stage;
  if (catchCache[key]) return catchCache[key];
  const out = [];
  for (const [dex, list] of Object.entries(state.found)) {
    const w = list.find(x => inVersion(x) && x.stage <= stage && !['trade', 'roaming'].includes(x.method) && !(x.loc === 'pallet-town' && x.method === 'gift'));
    if (w) out.push({ dex: +dex, ...w });
  }
  return (catchCache[key] = out);
}
function catchSuggestions(foe, stage, n = 2) {
  const team = cur().team;
  return catchableBy(stage).filter(c => !team.includes(c.dex))
    .map(c => ({ ...c, ...matchupTypes(mon(c.dex).types, foe), have: isCaught(c.dex), bst: mon(c.dex).stats.reduce((a, b) => a + b, 0) }))
    .filter(c => c.offense >= 2)
    .sort((a, b) => (a.defense >= 2) - (b.defense >= 2) || b.have - a.have || b.offense - a.offense || a.defense - b.defense || b.bst - a.bst)
    .slice(0, n);
}

function teamHint() {
  const team = cur().team;
  return `<p class="note">${team.length ? `Picks use your team from <a href="#/planner">Battle plan</a>: ${team.map(n => esc(mon(n).name)).join(', ')}.`
    : `Add your team in <a href="#/planner">Battle plan</a> to see who to send out against each trainer.`}
    When nobody on your team hits super effectively, you get a Pokémon you could catch by this point in the story.</p>`;
}

function foeRow(p, stage) {
  const team = cur().team;
  const name = n => esc(mon(n).name);
  const weak = weaknesses(p.dex);
  const ranked = team.map(n => ({ n, ...matchup(n, p) })).sort((a, b) => b.score - a.score || b.offense - a.offense);
  const best = ranked[0];
  let pick = '';
  if (best && best.offense >= 2) {
    pick = `Send out <b class="good">${name(best.n)}</b>${best.defense >= 2 ? ' <span class="note">(it can hit back super effectively)</span>' : ''}`;
  } else {
    if (best) pick = best.score >= 1 ? `<span class="meh">No super-effective hit. Best even match: ${name(best.n)}</span>` : `<span class="bad">Nobody on your team is super effective</span>`;
    const sug = catchSuggestions(p, stage);
    pick += sug.length ? `<div class="catch">${best ? 'Catch' : 'Good catch'}: ${sug.map(c => `<b>${esc(mon(c.dex).name)}</b> ${types(c.dex)} on <a href="#/loc/${c.loc}">${esc(c.name)}</a>
        <span class="note">(${esc(METHOD_LABEL[c.method] || c.method)}${c.levels ? `, Lv ${esc(c.levels)}` : ''}${c.have ? ', you have one' : ''})</span>`).join(' or ')}</div>`
      : `<div class="note">Nothing you can catch by now hits it super effectively.</div>`;
  }
  const threats = team.filter(n => matchup(n, p).defense >= 2).map(n => mon(n).name);
  return `<div class="foe"><div><b>${esc(p.name)}</b> Lv ${p.level} ${types(p.dex)}${p.item ? ` <span class="note">holding ${esc(p.item)}</span>` : ''}</div>
    ${p.moves?.length ? `<div class="moves">${p.moves.map(m => `<span class="mv">${esc(m.name)}${m.type ? ` <i class="t-${m.type}"></i>` : ''}</span>`).join('')}</div>` : ''}
    <div class="note">Weak to: ${weak.length ? weak.map(w => typeTag(w.t) + (w.m === 4 ? '×4' : '')).join(' ') : 'nothing'}</div>
    <div class="pick">${pick}${threats.length ? `<div class="note">Hits hard: ${esc(threats.join(', '))}</div>` : ''}</div></div>`;
}

const money = n => '₽' + Number(n).toLocaleString();
function trainerCard(t, stage, opts = {}) {
  const s = cur();
  const party = t.party || t.byStarter[s.starter];
  const prize = typeof t.prize === 'object' ? t.prize[s.starter] : t.prize;
  const ace = Math.max(...party.map(p => p.level));
  const head = opts.title || `${t.class} ${t.name}`;
  const meta = opts.meta || `${party.length} Pokémon · Lv ${ace} · ${money(prize)}`;
  const info = [t.rewards && `Reward: ${t.rewards.map(esc).join(', ')}`, t.uses && `Uses ${t.uses.map(esc).join(', ')}`,
    t.double && 'Double battle'].filter(Boolean).join(' · ');
  return `<details class="card trainer"><summary>${esc(head)} <span class="note">· ${esc(meta)}</span>${t.double ? ' <span class="tag">Double</span>' : ''}${t.rewards ? ' <span class="tag">Reward</span>' : ''}</summary>
    ${info ? `<p class="note">${info}</p>` : ''}
    ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}${opts.extra || ''}
    ${party.map(p => foeRow(p, stage)).join('')}</details>`;
}

function renderPlanner() {
  setHeader('Battle plan', false, 'planner');
  const s = cur();
  let html = `<div class="card"><b>Your team</b> <span class="note">(add up to 6)</span>
    <div class="team" style="margin-top:8px">${[0, 1, 2, 3, 4, 5].map(i => {
      const n = s.team[i];
      return n ? `<div class="slot"><button data-rm="${i}" aria-label="Remove">&times;</button><b>${esc(mon(n).name)}</b>${types(n)}</div>` : `<div class="slot note">Empty</div>`;
    }).join('')}</div>
    <input type="search" id="teamq" placeholder="Add a Pokémon by name" list="monlist" style="margin-top:10px">
    <datalist id="monlist">${state.dex.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <label class="note" style="display:block;margin-top:10px">Starter you picked (sets your rival's team):
      <select id="starter">${['Bulbasaur', 'Charmander', 'Squirtle'].map(x => `<option ${s.starter === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <p class="note">Gym Leaders, rival battles, Giovanni, the Elite Four and the Champion in story order. Every other trainer is on its route page.
      When nobody on your team is super effective, you get a Pokémon you could catch by that point in the story.</p>`;
  for (const t of state.trainers) {
    const party = t.party || t.byStarter[s.starter];
    const ace = Math.max(...party.map(p => p.level));
    html += trainerCard(t, stageOf(t.stage || t.location), {
      title: t.name, meta: `${t.where} · ${t.specialty} · ace Lv ${ace}`,
      extra: `<p class="note">Types that hit most of this team: ${bestTypesAgainst(party).map(g => typeTag(g.t)).join(' ')}</p>`
    });
  }
  html += `<p class="note">Matchups use type effectiveness only: your Pokémon's own types against theirs, and their damaging moves against yours. Levels and stats are not counted.</p>`;
  view.innerHTML = html;
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { s.team.splice(+b.dataset.rm, 1); save(); renderPlanner(); });
  document.getElementById('starter').onchange = e => { s.starter = e.target.value; save(); renderPlanner(); };
  const q = document.getElementById('teamq');
  q.onchange = () => {
    const p = state.dex.find(x => x.name.toLowerCase() === q.value.trim().toLowerCase());
    if (p && s.team.length < 6 && !s.team.includes(p.dex)) { s.team.push(p.dex); save(); renderPlanner(); }
  };
}

// ---------- tools ----------
function renderTools(tool) {
  setHeader(tool ? { breeding: 'Breeding helper', types: 'Type matchups', exclusives: 'Version exclusives' }[tool] : 'Tools', !!tool, 'tools');
  if (tool === 'breeding') return renderBreeding();
  if (tool === 'types') return renderTypes();
  if (tool === 'exclusives') return renderExclusives();
  view.innerHTML = [
    ['breeding', 'Breeding helper', 'Egg groups, compatible partners, what hatches and how many steps it takes'],
    ['types', 'Type matchups', 'Look up weaknesses for any type combination, plus the full chart'],
    ['exclusives', 'Version exclusives', `Pokémon you need to trade for from ${VNAME[OTHER[V()]]}`]
  ].map(([id, t, d]) => `<a class="card loc" href="#/tools/${id}"><div class="name">${t}<div class="meta">${d}</div></div><span>&rsaquo;</span></a>`).join('');
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
  view.innerHTML = `<div class="card note">Pokémon you can't catch or evolve in ${VNAME[V()]} but can in ${VNAME[OTHER[V()]]}. Trade for them, or evolve one you trade over.</div>
    <div class="card">${rows.map(p => checkRow(`dex:${p.dex}`, isCaught(p.dex), `#${String(p.dex).padStart(3, '0')} ${esc(p.name)} ${types(p.dex)}`,
      exclusiveWhere(p.dex))).join('') || '<div class="empty">None.</div>'}</div>`;
}

function renderSettings() {
  setHeader('Backup & settings', true, '');
  view.innerHTML = `
    <div class="card"><label class="row"><input type="checkbox" id="hideDone" ${state.progress.hideDone ? 'checked' : ''}><span>Hide completed locations</span></label></div>
    <h2>Backup</h2>
    <div class="card"><p class="note">Progress is saved on this device only. Export a backup file to move it to another phone or keep it safe.</p>
      <div class="toolbar"><button class="btn" id="export">Export backup</button>
      <label class="btn">Import backup<input type="file" id="import" accept="application/json" hidden></label></div></div>
    <h2>Reset</h2>
    <div class="card"><button class="btn" id="reset">Reset ${VNAME[V()]} progress</button></div>
    <p class="note">Pokémon, item, gift and trainer data come from the pret/pokefirered decompilation of the game. Walkthrough steps are written guidance.</p>`;
  document.getElementById('hideDone').onchange = e => { state.progress.hideDone = e.target.checked; save(); };
  document.getElementById('export').onclick = () => {
    const blob = new Blob([JSON.stringify(state.progress, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'frlg-dex-backup.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('import').onchange = async e => {
    try {
      const p = JSON.parse(await e.target.files[0].text());
      if (!p || typeof p.saves !== 'object' || !p.saves) throw new Error('not a backup');
      for (const v of ['FR', 'LG']) p.saves[v] = Object.assign(freshSave(), p.saves[v]);
      if (!['FR', 'LG'].includes(p.version)) p.version = 'FR';
      state.progress = p; save(); applyVersion(); renderSettings(); alert('Backup restored.');
    } catch (err) { alert('That file is not a valid backup.'); }
    e.target.value = '';
  };
  document.getElementById('reset').onclick = () => {
    if (confirm(`Erase all ${VNAME[V()]} progress? This cannot be undone.`)) { state.progress.saves[V()] = freshSave(); save(); alert('Progress reset.'); }
  };
}

// ---------- shell ----------
function setHeader(title, back, tab) {
  document.getElementById('title').textContent = title;
  document.getElementById('back').hidden = !back;
  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
}
function applyVersion() {
  document.documentElement.dataset.version = V();
  document.querySelectorAll('[data-version]').forEach(b => b.classList.toggle('on', b.dataset.version === V()));
}
function route() {
  const [, page, id] = location.hash.split('/');
  if (page === 'loc') renderLocation(id);
  else if (page === 'dex') renderDex();
  else if (page === 'planner') renderPlanner();
  else if (page === 'tools') renderTools(id);
  else if (page === 'settings') renderSettings();
  else renderHome();
  window.scrollTo(0, 0);
}

view.addEventListener('change', e => {
  const key = e.target.dataset?.key;
  if (!key) return;
  const s = cur();
  if (key.startsWith('dex:')) {
    const d = key.slice(4);
    if (e.target.checked) s.caught[d] = true; else delete s.caught[d];
    view.querySelectorAll(`[data-key="dex:${d}"]`).forEach(x => { x.checked = e.target.checked; x.closest('.row').classList.toggle('checked', e.target.checked); });
  } else if (e.target.checked) s.checks[key] = true; else delete s.checks[key];
  save();
  e.target.closest('.row').classList.toggle('checked', e.target.checked);
});
document.querySelectorAll('[data-version]').forEach(b => b.onclick = () => { state.progress.version = b.dataset.version; save(); applyVersion(); route(); });
document.getElementById('back').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/'; };
window.addEventListener('hashchange', route);

applyVersion();
loadData().then(route).catch(err => { view.innerHTML = `<div class="card">Could not load data: ${esc(err.message)}</div>`; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
