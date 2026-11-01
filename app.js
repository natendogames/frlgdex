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
  const [idx, dex, trainers, types, walk, moves] = await Promise.all(['data/locations.json', 'data/pokedex.json', 'data/trainers.json', 'data/types.json', 'data/walkthrough.json', 'data/moves.json'].map(getJSON));
  Object.assign(state, { index: idx.locations, dex, trainers, types, walk, moves });
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
// Estimates real damage with the Gen 3 formula: levels, base stats, IVs, move power, STAB and type effectiveness.
// Gen 3 decides physical or special by the move's type. Critical hits, abilities, held items and stat changes are ignored.
const PHYSICAL = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const VARIES_POWER = { Return: 102, 'Hidden Power': 70, Magnitude: 70, Flail: 40, Present: 40, Revenge: 60 };
const PLAYER_IV = 15; // average IVs for your Pokémon; no EVs
const ALL_TYPES = () => Object.keys(state.types);

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
function battler(dex, level, iv, moves) {
  const st = calcStats(dex, level, iv);
  return { dex, level, iv, moves: moves.filter(m => state.moves[m]), hp: st[0], st };
}
const teamMeta = n => (cur().teamMeta ||= {})[n] || {};
function myBattler(n, foeLevel) {
  const meta = teamMeta(n);
  const level = meta.level || foeLevel;
  const moves = (meta.moves || []).filter(Boolean);
  return { ...battler(n, level, PLAYER_IV, moves.length ? moves : defaultMoves(n, level)), guessedLevel: !meta.level, guessedMoves: !moves.length };
}
const foeBattler = p => battler(p.dex, p.level, p.iv ?? 0, (p.moves || []).map(m => m.name));

// Damage range of one move, in HP. null for moves that don't deal direct damage.
function hit(att, def, name) {
  const m = state.moves[name];
  if (!m || !m.power || ['counter', 'dream', 'ohko'].includes(m.effect)) return null;
  const mult = eff(m.type, mon(def.dex).types);
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
  const A = att.st[phys ? 1 : 3];
  const D = Math.max(1, Math.floor(def.st[phys ? 2 : 4] / (m.effect === 'explode' ? 2 : 1)));
  let dmg = Math.floor(Math.floor(Math.floor(2 * att.level / 5 + 2) * power * A / D) / 50) + 2;
  if (mon(att.dex).types.includes(m.type)) dmg = Math.floor(dmg * 1.5);
  dmg = Math.floor(dmg * mult);
  const hits = m.effect === 'multi' ? 3 : m.effect === 'double' ? 2 : 1; // 2-5 hit moves average about 3
  return out(Math.max(1, Math.floor(dmg * 85 / 100)) * hits, dmg * hits);
}
function bestHit(att, def) {
  return att.moves.map(n => hit(att, def, n)).filter(Boolean).sort((a, b) => b.min + b.max - a.min - a.max)[0] || null;
}
// How a battle between one of your Pokémon and one of theirs goes, one-on-one.
function duel(me, foe) {
  const mine = bestHit(me, foe), theirs = bestHit(foe, me);
  const myHits = mine && mine.max ? Math.ceil(foe.hp / Math.max(1, mine.min)) : Infinity;
  const theirHits = theirs && theirs.max ? Math.ceil(me.hp / Math.max(1, theirs.max)) : Infinity;
  const faster = me.st[5] > foe.st[5];
  const wins = myHits < theirHits || (myHits === theirHits && faster && myHits !== Infinity);
  const se = me.moves.filter(n => { const h = hit(me, foe, n); return h && h.mult >= 2; });
  const threats = foe.moves.filter(n => { const h = hit(foe, me, n); return h && h.mult >= 2; });
  return { me, mine, theirs, myHits, theirHits, faster, wins, se, threats };
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
  const key = V() + ':' + stage;
  if (catchCache[key]) return catchCache[key];
  const out = [];
  for (const [dex, list] of Object.entries(state.found)) {
    const w = list.find(x => inVersion(x) && x.stage <= stage && !['trade', 'roaming'].includes(x.method) && !(x.loc === 'pallet-town' && x.method === 'gift'));
    if (w) out.push({ dex: +dex, ...w });
  }
  return (catchCache[key] = out);
}
// Catches that would have a super-effective level-up move if raised to the foe's level, best duel first.
// Anything the trainer's other Pokémon can hit super effectively is left out, so the pick isn't a liability later in the fight.
function catchSuggestions(foeMon, foe, stage, party, n = 2) {
  const team = cur().team;
  const others = party.map(foeBattler);
  return catchableBy(stage).filter(c => !team.includes(c.dex)).map(c => {
    const me = battler(c.dex, foe.level, PLAYER_IV, defaultMoves(c.dex, foe.level));
    return { c, d: duel(me, foe), exposed: others.some(o => o.moves.some(mv => { const h = hit(o, me, mv); return h && h.mult >= 2; })) };
  }).filter(x => x.d.se.length && x.d.wins && !x.exposed)
    .sort((a, b) => isCaught(b.c.dex) - isCaught(a.c.dex) || rankDuels(a.d, b.d)).slice(0, n);
}

const hpPct = (h, b) => `${Math.min(100, Math.round(100 * h.min / b.hp))}–${Math.min(100, Math.round(100 * h.max / b.hp))}%`;
const multTag = m => m >= 2 ? ` <span class="good">${m}×</span>` : m === 0 ? ' <span class="bad">no effect</span>' : m < 1 ? ` <span class="note">${m === 0.25 ? '¼' : '½'}×</span>` : '';
const hitsText = n => n === Infinity ? "can't KO" : n === 1 ? 'OHKO' : `${n} hits`;
function hitText(h, target, hits) {
  return h ? `${esc(h.name)}${multTag(h.mult)} ${hpPct(h, target)} (${hitsText(hits)})` : '<span class="note">no damaging move</span>';
}

function teamHint() {
  const team = cur().team;
  return `<p class="note">${team.length ? `Picks use your team from <a href="#/planner">Battle plan</a>: ${team.map(n => esc(mon(n).name)).join(', ')}. Set their levels and moves there for exact numbers.`
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
        <td>${hitText(d.theirs, d.me, d.theirHits)}${d.threats.length ? `<div class="bad">Super effective: ${d.threats.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}</table>`;
  }
  if (!best || !duels.some(d => d.se.length) || !best.wins) {
    const sug = catchSuggestions(p, foe, stage, party);
    pick += sug.length ? `<div class="catch">${best ? (duels.some(d => d.se.length) ? 'Or catch' : 'Nobody on your team has a super-effective move. Catch') : 'Good catch'}: ${sug.map(({ c, d }) => {
      const learn = mon(c.dex).learnset.find(([, mv]) => mv === d.mine?.name);
      return `<b>${esc(mon(c.dex).name)}</b> ${types(c.dex)} on <a href="#/loc/${c.loc}">${esc(c.name)}</a>
        <span class="note">(${esc(METHOD_LABEL[c.method] || c.method)}${c.levels ? `, Lv ${esc(c.levels)}` : ''}${isCaught(c.dex) ? ', you have one' : ''}).
        At Lv ${p.level}: ${hitText(d.mine, foe, d.myHits)}${learn && learn[0] > 1 ? `, learned at Lv ${learn[0]}` : ''}</span>`;
    }).join(' or ')}</div>`
      : `<div class="note">Nothing you can catch by now has a super-effective move that wins this one-on-one without being weak to another of this trainer's moves.</div>`;
  }
  return `<div class="foe"><div><b>${esc(p.name)}</b> Lv ${p.level} ${types(p.dex)} <span class="note">${foe.hp} HP${p.item ? ` · holding ${esc(p.item)}` : ''}</span></div>
    ${p.moves?.length ? `<div class="moves">${p.moves.map(m => `<span class="mv">${esc(m.name)}${m.type ? ` <i class="t-${m.type}"></i>` : ''}${m.power ? ` <small>${m.power === 1 ? '—' : m.power}</small>` : ''}</span>`).join('')}</div>` : ''}
    <div class="note">Weak to: ${weak.length ? weak.map(w => typeTag(w.t) + (w.m === 4 ? '×4' : '')).join(' ') : 'nothing'}</div>
    <div class="pick">${pick}</div></div>`;
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
    ${party.map(p => foeRow(p, stage, party)).join('')}
    ${cur().team.some(n => !teamMeta(n).level) ? '<p class="note">* Level not set in Battle plan, so it is assumed to match theirs.</p>' : ''}</details>`;
}

function renderPlanner() {
  setHeader('Battle plan', false, 'planner');
  const s = cur();
  s.teamMeta ||= {};
  const moveNames = Object.keys(state.moves).sort();
  let html = `<div class="card"><b>Your team</b> <span class="note">(up to 6). Set each one's level and moves for exact damage; blank moves use what it learns by level up.</span>
    ${s.team.map((n, i) => {
      const meta = s.teamMeta[n] || {};
      const lvl = meta.level || '';
      const defaults = defaultMoves(n, meta.level || 100);
      return `<div class="member"><div class="mhead"><b>${esc(mon(n).name)}</b> ${types(n)}
          <label class="note">Lv <input type="number" min="1" max="100" inputmode="numeric" data-lvl="${n}" value="${lvl}" placeholder="?"></label>
          <button class="icon-x" data-rm="${i}" aria-label="Remove ${esc(mon(n).name)}">&times;</button></div>
        <div class="mvgrid">${[0, 1, 2, 3].map(k => `<input list="movelist" data-mv="${n}:${k}" value="${esc(meta.moves?.[k] || '')}" placeholder="${meta.level ? esc(defaults[k] || 'Move') : 'Move'}">`).join('')}</div></div>`;
    }).join('') || '<p class="note">No Pokémon yet.</p>'}
    <input type="search" id="teamq" placeholder="Add a Pokémon by name" list="monlist" style="margin-top:10px" ${s.team.length >= 6 ? 'disabled' : ''}>
    <datalist id="monlist">${state.dex.map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <datalist id="movelist">${moveNames.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
    <label class="note" style="display:block;margin-top:10px">Starter you picked (sets your rival's team):
      <select id="starter">${['Bulbasaur', 'Charmander', 'Squirtle'].map(x => `<option ${s.starter === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <p class="note">Gym Leaders, rival battles, Giovanni, the Elite Four and the Champion in story order. Every other trainer is on its route page.</p>`;
  for (const t of state.trainers) {
    const party = t.party || t.byStarter[s.starter];
    const ace = Math.max(...party.map(p => p.level));
    html += trainerCard(t, stageOf(t.stage || t.location), {
      title: t.name, meta: `${t.where} · ${t.specialty} · ace Lv ${ace}`,
      extra: `<p class="note">Types that hit most of this team: ${bestTypesAgainst(party).map(g => typeTag(g.t)).join(' ')}</p>`
    });
  }
  html += `<p class="note">Damage uses the Gen 3 formula with your levels and moves, their real moves and IVs, average IVs for yours and no EVs. Critical hits, abilities, held items and stat changes are not counted, so treat close calls with care.</p>`;
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
