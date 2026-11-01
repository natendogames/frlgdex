'use strict';
// Reference pages built on the game data: Pokémon, TM and item pages, search, progress, the "still missing" list,
// shop checklists and the HM helper. Loaded after app.js and uses its helpers; pages register in PAGES.

const STAT_NAMES = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
const STAT_SHORT = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
const GROWTH_LABEL = { 'medium-fast': 'Medium Fast', 'medium-slow': 'Medium Slow', fast: 'Fast', slow: 'Slow', erratic: 'Erratic', fluctuating: 'Fluctuating' };
const HMS = ['HM01', 'HM02', 'HM03', 'HM04', 'HM05', 'HM06', 'HM07'];
const num3 = n => '#' + String(n).padStart(3, '0');
const monA = n => `<a href="#/mon/${n}">${esc(mon(n).name)}</a>`;
const infoA = n => ` <a class="info" href="#/mon/${n}" aria-label="About ${esc(mon(n).name)}">ⓘ</a>`;
const evText = ev => ev.map((v, i) => v ? `${v} ${STAT_SHORT[i]}` : '').filter(Boolean).join(', ') || 'none';

// ---------- where you are in the story ----------
// The furthest location (in story order) where you've ticked anything off, unless you've set it yourself.
function autoStage() {
  const s = cur(); let best = 0;
  for (const k of Object.keys(s.checks)) {
    const loc = k.split(':')[0];
    if (state.locations[loc] && stageOf(loc) > best) best = stageOf(loc);
  }
  for (const c of CHOICES) if (pickOf(c.id) && stageOf(c.loc) > best) best = stageOf(c.loc);
  return best;
}
function currentStage() { const h = cur().here; return h && state.locations[h] ? stageOf(h) : autoStage(); }
function stagePicker(id = 'herePick') {
  const h = cur().here || '';
  return `<label class="note" for="${id}">Where you are in the story</label>
    <select id="${id}"><option value="">Work it out from my checklist (${esc(state.index[autoStage()].name)})</option>
    ${state.index.map(l => `<option value="${l.id}" ${h === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>`;
}
function bindStagePicker(id, after) {
  const el = document.getElementById(id);
  if (el) el.onchange = () => { if (el.value) cur().here = el.value; else delete cur().here; save(); after(); };
}

// ---------- TMs you own ----------
// Keys of the checklist rows that give you this TM or HM (found, given, bought or won).
function tmKeys(tm) {
  const out = [];
  for (const src of state.tms[tm]?.sources || []) {
    const loc = state.locations[src.loc];
    if (!loc) continue;
    if (src.how === 'found') for (const i of loc.items) if (i.name.split(' ')[0] === tm) out.push(`${loc.id}:item:${i.id}`);
    if (src.how === 'gift') for (const g of loc.gifts) if (g.name.split(' ')[0] === tm) out.push(`${loc.id}:gift:${g.id}`);
  }
  for (const [lid, shops] of Object.entries(state.extras.shops)) for (const sh of shops) for (const it of sh.items)
    if (it.name === tm) out.push(shopKey(lid, sh, it));
  return [...new Set(out)];
}
const hasTM = tm => tmKeys(tm).some(k => cur().checks[k]);

// ---------- shops ----------
// TMs and Game Corner prizes are things you collect, so they get checkboxes; everyday items are a price list.
const shopKey = (lid, sh, it) => `${lid}:buy:${sh.id}:${it.name}`;
const collectible = (sh, it) => sh.coins || /^(TM|HM)\d/.test(it.name);
function shopRows(loc) {
  return (state.extras.shops[loc.id] || []).flatMap(sh => sh.items.filter(it => collectible(sh, it)).map(it => shopKey(loc.id, sh, it)));
}
function shopSection(loc) {
  const shops = state.extras.shops[loc.id];
  if (!shops?.length) return '';
  const s = cur(), keys = shopRows(loc);
  let html = `<h2>Shops${keys.length ? ` (${keys.filter(k => s.checks[k]).length}/${keys.length})` : ''}</h2><div class="card">`;
  for (const sh of shops) {
    html += `<div class="area">${esc(sh.where)}</div>`;
    const coll = sh.items.filter(it => collectible(sh, it)), rest = sh.items.filter(it => !collectible(sh, it));
    html += coll.map(it => {
      const k = shopKey(loc.id, sh, it), tm = /^(TM|HM)\d+/.exec(it.name)?.[0];
      const price = sh.coins ? `${it.price.toLocaleString()} coins` : money(it.price);
      return checkRow(k, s.checks[k], `${esc(it.name)}${tm ? ` ${esc(state.tms[tm].move)}` : ''}`, price, tm ? ` <a class="info" href="#/tm/${tm}">ⓘ</a>` : '');
    }).join('');
    if (rest.length) html += `<p class="note">${rest.map(it => `${esc(it.name)} ${money(it.price)}`).join(' · ')}</p>`;
  }
  return html + '</div>';
}

// ---------- Pokémon page ----------
function evoChain(n) {
  const root = lineOf(n)[0];
  const walk = (d, depth) => {
    const kids = mon(d).evolutions || [];
    const self = d === n ? `<b>${esc(mon(d).name)}</b>` : monA(d);
    return `<li>${self}${kids.length ? `<ul>${kids.map(e => `<li class="note">${esc((EVO_LABEL[e.method] || (() => e.method))(e.param))} →</li>${walk(e.into, depth + 1)}`).join('')}</ul>` : ''}</li>`;
  };
  return (mon(root).evolutions || []).length ? `<ul class="evo">${walk(root, 0)}</ul>` : '<p class="note">Does not evolve.</p>';
}
function whereRows(n) {
  const list = (state.found[n] || []).filter(inVersion);
  if (!list.length) return `<p class="note">${availText(n)}</p>`;
  const here = currentStage();
  return `<table class="mini"><tr><th>Where</th><th>How</th><th>Lv</th><th>Rate</th></tr>${list.map(w => {
    const e = state.locations[w.loc].encounters.find(x => x.dex === n && x.method === w.method && x.levels === w.levels && (!x.versions || !w.versions || x.versions.join() === w.versions.join()));
    return `<tr><td><a href="#/loc/${w.loc}">${esc(w.name)}</a>${e?.area ? ` <span class="note">${esc(e.area)}</span>` : ''}${w.stage > here ? ' <span class="tag">ahead of you</span>' : ''}</td>
      <td>${esc(METHOD_LABEL[w.method] || w.method)}${w.later ? `<div class="note">needs ${esc(UNLOCK[w.method].need)}</div>` : ''}${condText(w, n) ? `<div class="note">${esc(condText(w, n))}</div>` : ''}</td>
      <td>${esc(w.levels || '')}</td><td>${esc(e?.rate || '')}</td></tr>`;
  }).join('')}</table>`;
}
function renderMon(id) {
  const n = parseInt(id, 10);
  if (!(n >= 1 && n <= state.dex.length)) return renderDexPage();
  const p = mon(n);
  setHeader(`${num3(n)} ${p.name}`, true, 'dex');
  const total = p.stats.reduce((a, b) => a + b, 0);
  const weak = ALL_TYPES().map(t => ({ t, m: eff(t, p.types) })).filter(x => x.m !== 1).sort((a, b) => b.m - a.m);
  const gl = m => weak.filter(x => x.m === m).map(x => typeTag(x.t)).join(' ');
  const tms = (p.tmhm || []).map(tm => `<a class="mv" href="#/tm/${tm}">${tm} ${esc(state.tms[tm]?.move || '')}${hasTM(tm) ? ' ✓' : ''}</a>`).join('');
  const genderText = { genderless: 'Genderless', male: 'Always male', female: 'Always female' }[p.gender] || String(p.gender).replace('% F', '% female');
  let html = `<div class="card">${checkRow(`dex:${n}`, isCaught(n), `Caught ${types(n)}`, availText(n))}
    <table class="mini">
      <tr><td>Abilities</td><td>${(p.abilities || []).map(esc).join(' or ') || '—'}</td></tr>
      <tr><td>Catch rate</td><td>${p.catchRate ?? '—'} <span class="note">(${catchPct(p.catchRate, 'Poké Ball')}% with a Poké Ball at full HP · <a href="#/tools/catch/${n}">catch odds</a>)</span></td></tr>
      <tr><td>EV yield</td><td>${evText(p.ev || [])}</td></tr>
      <tr><td>Base EXP · growth</td><td>${p.expYield ?? '—'} · ${esc(GROWTH_LABEL[p.growth] || '—')}</td></tr>
      ${p.held ? `<tr><td>Wild held item</td><td>${[p.held.common && `${esc(p.held.common)} (50%)`, p.held.rare && `${esc(p.held.rare)} (5%)`].filter(Boolean).join(', ')}</td></tr>` : ''}
      <tr><td>Egg groups</td><td>${(p.eggGroups || []).map(esc).join(', ')} · ${esc(genderText)} · ${(p.eggCycles * 256).toLocaleString()} steps <a href="#/tools/breeding">breeding</a></td></tr>
    </table></div>
    <h2>Where to get it in ${VNAME[V()]}</h2><div class="card">${whereRows(n)}</div>
    <h2>Base stats (total ${total})</h2><div class="card stats-bars">${p.stats.map((v, i) => `<div class="sb"><span>${STAT_SHORT[i]}</span><b>${v}</b><div class="bar"><i style="width:${Math.min(100, v / 1.6)}%"></i></div></div>`).join('')}</div>
    <h2>Type matchups</h2><div class="card"><table class="mini">
      ${gl(4) ? `<tr><td>Takes 4×</td><td>${gl(4)}</td></tr>` : ''}${gl(2) ? `<tr><td>Takes 2×</td><td>${gl(2)}</td></tr>` : ''}
      ${gl(0.5) ? `<tr><td>Takes ½×</td><td>${gl(0.5)}</td></tr>` : ''}${gl(0.25) ? `<tr><td>Takes ¼×</td><td>${gl(0.25)}</td></tr>` : ''}${gl(0) ? `<tr><td>Immune</td><td>${gl(0)}</td></tr>` : ''}</table></div>
    <h2>Evolution</h2><div class="card">${evoChain(n)}</div>
    <h2>Level-up moves</h2><div class="card"><table class="mini"><tr><th>Lv</th><th>Move</th><th>Type</th><th>Power</th></tr>
      ${(p.learnset || []).map(([l, mv]) => { const m = state.moves[mv] || {}; return `<tr><td>${l}</td><td>${esc(mv)}</td><td>${m.type ? typeTag(m.type) : ''}</td><td>${m.power > 1 ? m.power : m.power === 1 ? 'varies' : '—'}</td></tr>`; }).join('')}</table></div>
    <h2>TMs and HMs (${(p.tmhm || []).length})</h2><div class="card"><div class="moves">${tms || '<span class="note">None.</span>'}</div><p class="note">✓ = you have it.</p></div>`;
  if (p.tutor?.length) html += `<h2>Move tutors</h2><div class="card"><div class="moves">${p.tutor.map(mv => { const t = state.extras.tutors.find(x => x.move === mv); return `<span class="mv">${esc(mv)}${t ? ` <a href="#/loc/${t.loc}">${esc(state.locations[t.loc].name)}</a>` : ''}</span>`; }).join('')}</div></div>`;
  view.innerHTML = html;
}

// ---------- TM and item pages ----------
function sourceText(src) {
  const loc = state.locations[src.loc];
  const how = { found: 'Found', gift: 'Given', buy: `Buy for ${esc(src.cost)}`, prize: `Prize for ${esc(src.cost)}` }[src.how];
  return `${how} at <a href="#/loc/${src.loc}">${esc(loc?.name || src.loc)}</a>${src.where ? ` <span class="note">(${esc(src.where)}${src.from ? `, ${esc(src.from)}` : ''})</span>` : ''}`;
}
function renderTM(tm) {
  const t = state.tms[tm];
  if (!t) return renderTMList();
  setHeader(`${tm} ${t.move}`, true, 'tools');
  const m = state.moves[t.move] || {};
  const learners = state.dex.filter(p => (p.tmhm || []).includes(tm));
  const team = cur().team.filter(n => learners.some(p => p.dex === n));
  const caught = learners.filter(p => isCaught(p.dex));
  view.innerHTML = `<div class="card"><b>${esc(t.move)}</b> ${m.type ? typeTag(m.type) : ''} <span class="note">Power ${m.power > 1 ? m.power : m.power === 1 ? 'varies' : '—'} · ${PHYSICAL.has(m.type) ? 'physical' : 'special'}${m.power ? '' : ' (status move)'} · ${t.reusable ? 'can be had again' : 'single use'}</span>
      <p class="note">${hasTM(tm) ? '<span class="good">You have it.</span>' : "You haven't ticked it off yet."}</p>
      ${tmKeys(tm).map(k => checkRow(k, cur().checks[k], esc(k.split(':')[0] in state.locations ? state.locations[k.split(':')[0]].name : k), esc(k.split(':')[1] === 'buy' ? 'Shop' : k.split(':')[1] === 'gift' ? 'Gift' : 'Item'))).join('')}</div>
    <h2>Where to get it</h2><div class="card">${t.sources.map(x => `<p>${sourceText(x)}</p>`).join('') || '<p class="note">Not obtainable in FireRed or LeafGreen.</p>'}</div>
    <h2>Your team</h2><div class="card">${cur().team.length ? cur().team.map(n => `${monA(n)} ${team.includes(n) ? '<span class="good">can learn it</span>' : '<span class="note">can\'t</span>'}`).join('<br>') : '<p class="note">No team set in Battle plan.</p>'}</div>
    <h2>Caught Pokémon that can learn it (${caught.length})</h2><div class="card"><p>${caught.map(p => monA(p.dex)).join(', ') || '<span class="note">None yet.</span>'}</p></div>
    <h2>All Pokémon that can learn it (${learners.length})</h2><div class="card"><p class="note">${learners.map(p => monA(p.dex)).join(', ')}</p></div>`;
}
function renderTMList() {
  setHeader('TMs and HMs', true, 'tools');
  const s = cur();
  view.innerHTML = `<div class="card"><b>${Object.keys(state.tms).filter(hasTM).length}/${Object.keys(state.tms).length}</b> collected ${bar(Object.keys(state.tms).filter(hasTM).length, Object.keys(state.tms).length)}
    <p class="note">Ticking an item, gift or shop row for a TM counts it here.</p></div><div class="card">${Object.entries(state.tms).map(([tm, t]) => {
    const m = state.moves[t.move] || {}, src = t.sources[0];
    return `<a class="row linkrow" href="#/tm/${tm}"><span class="${hasTM(tm) ? 'good' : ''}">${hasTM(tm) ? '✓' : '○'}</span><span style="flex:1"><b>${tm}</b> ${esc(t.move)} ${m.type ? typeTag(m.type) : ''}<span class="sub">${src ? `${esc(state.locations[src.loc]?.name || '')}${t.sources.length > 1 ? ` +${t.sources.length - 1} more` : ''}` : 'Not in FRLG'}${t.reusable ? '' : ' · single use'}</span></span><span>&rsaquo;</span></a>`;
  }).join('')}</div>`;
  void s;
}
// Every place an item turns up: on the ground, hidden, given, sold, as a prize or held by wild Pokémon.
function itemPlaces(name) {
  const base = x => x.replace(/ ×\d+$/, '').replace(/ \(.*\)$/, '').toLowerCase();
  const q = base(name), out = [];
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const i of loc.items) if (base(i.name) === q) out.push({ key: `${loc.id}:item:${i.id}`, loc, text: `${i.hidden ? 'Hidden' : 'On the ground'}${i.where ? ` · ${i.where}` : ''}`, name: i.name });
    for (const g of loc.gifts) if (inVersion(g) && base(g.name) === q) out.push({ key: `${loc.id}:gift:${g.id}`, loc, text: `Given · ${[g.from, g.where].filter(Boolean).join(' · ')}`, name: g.name });
    for (const sh of state.extras.shops[loc.id] || []) for (const it of sh.items) if (base(it.name) === q)
      out.push({ key: collectible(sh, it) ? shopKey(loc.id, sh, it) : null, loc, text: `${sh.coins ? 'Prize' : 'Sold'} · ${sh.where} · ${sh.coins ? `${it.price.toLocaleString()} coins` : money(it.price)}`, name: it.name });
  }
  const held = state.dex.filter(p => p.held && Object.values(p.held).some(h => h.toLowerCase() === q));
  return { out, held };
}
function renderItem(name) {
  const tm = /^(TM|HM)\d+$/i.exec(name);
  if (tm) return renderTM(name.toUpperCase());
  setHeader(name, true, 'tools');
  const { out, held } = itemPlaces(name), s = cur();
  view.innerHTML = `<div class="card">${out.map(x => x.key ? checkRow(x.key, s.checks[x.key], `<a href="#/loc/${x.loc.id}">${esc(x.loc.name)}</a> ${esc(x.name)}`, esc(x.text))
    : `<div class="row"><span style="width:22px"></span><span><a href="#/loc/${x.loc.id}">${esc(x.loc.name)}</a><span class="sub">${esc(x.text)}</span></span></div>`).join('') || '<div class="empty">Not found anywhere.</div>'}</div>
    ${held.length ? `<h2>Held by wild Pokémon</h2><div class="card"><p>${held.map(p => `${monA(p.dex)} <span class="note">(${p.held.common?.toLowerCase() === name.toLowerCase() ? '50%' : '5%'})</span>`).join(', ')}</p><p class="note">Steal it with Thief or Covet, or catch the Pokémon. Compound Eyes on your lead raises the odds.</p></div>` : ''}`;
}

// ---------- search ----------
function searchIndex() {
  if (state.searchIdx) return state.searchIdx;
  const out = [];
  for (const p of state.dex) out.push({ k: 'Pokémon', t: `${num3(p.dex)} ${p.name}`, s: (p.types || []).join(' / '), h: `#/mon/${p.dex}`, q: `${p.name} ${p.dex}` });
  for (const l of state.index) out.push({ k: 'Place', t: l.name, s: l.region, h: `#/loc/${l.id}`, q: l.name });
  for (const [tm, t] of Object.entries(state.tms)) out.push({ k: 'TM', t: `${tm} ${t.move}`, s: state.moves[t.move]?.type || '', h: `#/tm/${tm}`, q: `${tm} ${t.move}` });
  const items = new Set();
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const i of [...loc.items, ...loc.gifts.filter(g => !/^(Trade|.* \(Lv \d+\)|.* Egg$)/.test(g.name))]) items.add(i.name.replace(/ ×\d+$/, '').replace(/ \(.*\)$/, ''));
    for (const sh of state.extras.shops[l.id] || []) for (const it of sh.items) items.add(it.name);
    for (const t of loc.trainers || []) out.push({ k: 'Trainer', t: t.class === t.name ? t.name : `${t.class} ${t.name}`, s: loc.name, h: `#/loc/${l.id}`, q: `${t.class} ${t.name}` });
  }
  for (const it of items) if (!/^(TM|HM)\d/.test(it)) out.push({ k: 'Item', t: it, s: '', h: `#/item/${encodeURIComponent(it)}`, q: it });
  for (const mv of Object.keys(state.moves)) out.push({ k: 'Move', t: mv, s: state.moves[mv].type, h: `#/move/${encodeURIComponent(mv)}`, q: mv });
  return (state.searchIdx = out);
}
function searchResults(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const score = x => { const s = x.q.toLowerCase(); return s === q ? 0 : s.startsWith(q) ? 1 : s.split(/\W+/).some(w => w.startsWith(q)) ? 2 : s.includes(q) ? 3 : 9; };
  return searchIndex().map(x => ({ x, sc: score(x) })).filter(r => r.sc < 9).sort((a, b) => a.sc - b.sc).slice(0, 60).map(r => r.x);
}
function renderSearch() {
  setHeader('Search', true, '');
  const q = state.searchQ || '';
  const res = searchResults(q);
  view.innerHTML = `<div class="card"><input type="search" id="sq" placeholder="Pokémon, place, item, TM, move or trainer" value="${esc(q)}" autofocus></div>
    <div class="card" id="sres">${res.map(r => `<a class="row linkrow" href="${r.h}"><span class="tag">${r.k}</span><span style="flex:1">${esc(r.t)}<span class="sub">${esc(r.s)}</span></span><span>&rsaquo;</span></a>`).join('') || `<div class="empty">${q ? 'Nothing matches.' : 'Start typing.'}</div>`}</div>`;
  const inp = document.getElementById('sq');
  inp.oninput = () => { state.searchQ = inp.value; const pos = inp.selectionStart; renderSearch(); const n = document.getElementById('sq'); n.focus(); n.setSelectionRange(pos, pos); };
  inp.focus?.();
}
function renderMove(name) {
  const m = state.moves[name];
  if (!m) return renderSearch();
  setHeader(name, true, '');
  const lv = state.dex.filter(p => (p.learnset || []).some(([, mv]) => mv === name));
  const tm = Object.entries(state.tms).find(([, t]) => t.move === name);
  const tut = state.extras.tutors.find(t => t.move === name);
  view.innerHTML = `<div class="card"><b>${esc(name)}</b> ${m.type ? typeTag(m.type) : ''} <span class="note">Power ${m.power > 1 ? m.power : m.power === 1 ? 'varies' : '—'} · ${PHYSICAL.has(m.type) ? 'physical' : 'special'} (Gen 3 splits by type)</span>
    ${tm ? `<p>Taught by <a href="#/tm/${tm[0]}">${tm[0]}</a></p>` : ''}${tut ? `<p>Move tutor at <a href="#/loc/${tut.loc}">${esc(state.locations[tut.loc].name)}</a> (${esc(tut.where)}), one use</p>` : ''}</div>
    <h2>Learned by level up (${lv.length})</h2><div class="card"><p class="note">${lv.map(p => `${monA(p.dex)} ${p.learnset.filter(([, mv]) => mv === name).map(([l]) => l).join('/')}`).join(', ') || 'None.'}</p></div>`;
}

// ---------- progress ----------
const BADGES = [['pewter-city', 'leader-brock', 'Boulder'], ['cerulean-city', 'leader-misty', 'Cascade'], ['vermilion-city', 'leader-lt-surge', 'Thunder'],
  ['celadon-city', 'leader-erika', 'Rainbow'], ['fuchsia-city', 'leader-koga', 'Soul'], ['saffron-city', 'leader-sabrina', 'Marsh'],
  ['cinnabar-island', 'leader-blaine', 'Volcano'], ['viridian-city', 'leader-giovanni', 'Earth']];
function renderProgress() {
  setHeader('Progress', true, 'routes');
  const s = cur(), g = globalStats();
  let nat = 0; for (let n = 1; n <= 386; n++) if (s.caught[n]) nat++;
  const tmsHave = Object.keys(state.tms).filter(hasTM).length;
  const stat = (label, [a, b]) => `<div class="stat"><b>${a}/${b}</b><span>${label}</span>${bar(a, b)}<span>${pct(a, b)}%</span></div>`;
  const regions = {};
  for (const l of state.index) { const r = (regions[l.region] ||= [0, 0]); const x = locStats(state.locations[l.id]); r[0] += x.done; r[1] += x.total; }
  const next = state.index.find(l => { const x = locStats(state.locations[l.id]); return x.total && x.done < x.total; });
  view.innerHTML = `<div class="card stats">${stat('Kanto Dex', g.dex)}${stat('National Dex', [nat, 386])}${stat('Items', g.items)}${stat('NPC gifts', g.gifts)}${stat('Trainers', g.trainers)}${stat('Shop TMs & prizes', g.shop || [0, 0])}${stat('TMs & HMs', [tmsHave, Object.keys(state.tms).length])}${stat('Badges', [BADGES.filter(([l, t]) => s.checks[`${l}:trainer:${t}`]).length, 8])}</div>
    <h2>Badges</h2><div class="card chips">${BADGES.map(([l, t, b]) => `<a class="chip ${s.checks[`${l}:trainer:${t}`] ? 'on' : ''}" href="#/loc/${l}">${b}</a>`).join('')}</div>
    <h2>By part of the game</h2><div class="card">${Object.entries(regions).map(([r, [a, b]]) => `<div class="prog"><span>${esc(r)}</span><span class="note">${a}/${b}</span>${bar(a, b)}</div>`).join('')}</div>
    ${next ? `<h2>Up next</h2><a class="card loc" href="#/loc/${next.id}"><div class="name">${esc(next.name)}<div class="meta">The first place in story order with things left to do</div></div><span>&rsaquo;</span></a>` : ''}
    <div class="card">${stagePicker()}</div>
    <p class="note"><a href="#/missing">Still missing</a> lists every Pokémon you haven't caught and the earliest place to get it.</p>`;
  bindStagePicker('herePick', renderProgress);
}

// ---------- still missing ----------
function renderMissing() {
  setHeader('Still missing', true, 'dex');
  const f = (state.missingScope ||= 'kanto'), max = f === 'kanto' ? 151 : 386, here = currentStage();
  const groups = { now: [], later: [], evolve: [], trade: [], missed: [], event: [] };
  for (let n = 1; n <= max; n++) {
    if (isCaught(n)) continue;
    const a = availability(n);
    if (a.kind === 'catch') (a.where.some(w => w.stage <= here && !['roaming'].includes(w.method)) ? groups.now : groups.later).push(n);
    else if (a.kind === 'evolve') groups.evolve.push(n);
    else if (a.kind === 'missed') groups.missed.push(n);
    else if (a.kind === 'event') groups.event.push(n);
    else groups.trade.push(n);
  }
  const titles = { now: `Catch now (up to ${state.index[here].name})`, later: 'Later in the story', evolve: 'Evolve one you have', trade: `Trade (not in ${VNAME[V()]})`, missed: 'Passed up by your picks', event: 'Event only' };
  let html = `<div class="card"><div class="chips"><button class="chip ${f === 'kanto' ? 'on' : ''}" data-ms="kanto">Kanto 151</button><button class="chip ${f === 'national' ? 'on' : ''}" data-ms="national">National 386</button></div>
    <div style="margin-top:10px">${stagePicker('herePick2')}</div></div>`;
  for (const [k, list] of Object.entries(groups)) {
    if (!list.length) continue;
    html += `<details class="later"${k === 'now' || k === 'evolve' ? ' open' : ''}><summary><h2>${esc(titles[k])} (${list.length})</h2></summary><div class="card">${list.map(n => {
      let sub = availText(n);
      if (k === 'now') { const w = availability(n).where.filter(x => x.stage <= here).sort((a, b) => a.stage - b.stage)[0]; sub = `<a href="#/loc/${w.loc}">${esc(w.name)}</a> <span class="note">(${esc(METHOD_LABEL[w.method] || w.method)}${w.levels ? `, Lv ${esc(w.levels)}` : ''})</span>`; }
      return checkRow(`dex:${n}`, false, `${num3(n)} ${esc(mon(n).name)} ${types(n)}`, sub, infoA(n));
    }).join('')}</div></details>`;
  }
  view.innerHTML = html;
  view.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { state.missingScope = b.dataset.ms; renderMissing(); });
  bindStagePicker('herePick2', renderMissing);
}

// ---------- HM helper (Battle plan) ----------
// Who on your team can use each field move, and the caught Pokémon that would cover the most of the rest.
function hmHelper() {
  const team = cur().team;
  const learns = (n, hm) => (mon(n).tmhm || []).includes(hm);
  const rows = HMS.map(hm => {
    const who = team.filter(n => learns(n, hm));
    return `<tr><td><a href="#/tm/${hm}">${hm}</a> ${esc(state.tms[hm].move)}${hasTM(hm) ? ' ✓' : ''}</td><td>${who.length ? who.map(n => esc(mon(n).name)).join(', ') : '<span class="bad">nobody</span>'}</td></tr>`;
  }).join('');
  const missing = HMS.filter(hm => !team.some(n => learns(n, hm)));
  let tip = '';
  if (missing.length) {
    const cands = state.dex.filter(p => isCaught(p.dex) && !team.includes(p.dex)).map(p => ({ p, n: missing.filter(hm => learns(p.dex, hm)) })).filter(x => x.n.length).sort((a, b) => b.n.length - a.n.length).slice(0, 3);
    tip = cands.length ? `<p class="note">An HM carrier you've caught: ${cands.map(x => `${monA(x.p.dex)} (${x.n.map(h => state.tms[h].move).join(', ')})`).join('; ')}. HM moves can't be forgotten without the Move Deleter in Fuchsia City.</p>`
      : `<p class="note">None of your caught Pokémon can learn ${missing.map(h => state.tms[h].move).join(', ')}. Good carriers: Tentacool or Lapras (Surf, Cut, Waterfall), Paras (Cut, Flash, Rock Smash), Geodude (Strength, Rock Smash), Pidgey (Fly).</p>`;
  }
  return `<details class="card"><summary>HMs and field moves</summary><table class="mini" style="margin-top:8px"><tr><th>HM</th><th>Who on your team can learn it</th></tr>${rows}</table>${tip}<p class="note">✓ = you have it.</p></details>`;
}

// ---------- catch odds (Gen 3 formula, as in the game's handleballthrow) ----------
// ballMult: 1 Poké Ball, 1.5 Great/Safari, 2 Ultra, 3 Net (Water/Bug) or Repeat (already caught), Nest (40 - level) / 10...
// hpFrac: current HP / max HP; status: 2 asleep or frozen, 1.5 poisoned, burned or paralysed.
const BALLS = { 'Poké Ball': 1, 'Great Ball': 1.5, 'Ultra Ball': 2, 'Safari Ball': 1.5, 'Premier Ball': 1, 'Luxury Ball': 1 };
const isqrt = n => Math.floor(Math.sqrt(n));
function catchChance(rate, ballMult, hpFrac = 1, status = 1) {
  if (!rate) return 0;
  if (ballMult >= 255) return 1; // Master Ball
  const maxHP = 300, hp = Math.max(1, Math.round(maxHP * hpFrac));
  let odds = Math.floor(Math.floor(rate * Math.round(ballMult * 10) / 10) * (3 * maxHP - 2 * hp) / (3 * maxHP));
  if (status === 2) odds *= 2;
  else if (status === 1.5) odds = Math.floor(odds * 15 / 10);
  if (odds > 254) return 1;
  if (odds <= 0) return 0;
  const b = Math.floor(1048560 / isqrt(isqrt(Math.floor(16711680 / odds))));
  return Math.pow(Math.min(65536, b) / 65536, 4); // four shake checks against a 16-bit random number
}
const catchPct = (rate, ball, hpFrac = 1, status = 1) => {
  const p = catchChance(rate, BALLS[ball] ?? ball, hpFrac, status) * 100;
  return p >= 99.95 ? '100' : p < 1 ? p.toFixed(1) : Math.round(p).toString();
};

// ---------- dex links ----------
function renderDexPage() { location.hash = '#/dex'; }

LOC_SECTIONS.push(shopSection);
TOOLS.push({ id: '#/missing', title: 'Still missing', desc: "Every Pokémon you haven't caught, with the earliest place you can get it from where you are" },
  { id: '#/tms', title: 'TMs and HMs', desc: 'All 58 machines: where to get each one, which you have, who can learn them' },
  { id: '#/progress', title: 'Progress', desc: 'Completion by category and part of the game, badges, and what to do next' },
  { id: '#/search', title: 'Search', desc: 'Find any Pokémon, place, item, TM, move or trainer' });
Object.assign(PAGES, { mon: renderMon, tm: renderTM, tms: renderTMList, item: renderItem, search: renderSearch, move: renderMove, progress: renderProgress, missing: renderMissing });
