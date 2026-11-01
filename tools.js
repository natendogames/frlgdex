'use strict';
// Calculators: stats and IVs, catch odds, EXP and level forecast, EV yield and training. Loaded after features.js.

const NATURES = [['Hardy'], ['Lonely', 1, 2], ['Brave', 1, 5], ['Adamant', 1, 3], ['Naughty', 1, 4], ['Bold', 2, 1], ['Docile'], ['Relaxed', 2, 5],
  ['Impish', 2, 3], ['Lax', 2, 4], ['Timid', 5, 1], ['Hasty', 5, 2], ['Serious'], ['Jolly', 5, 3], ['Naive', 5, 4], ['Modest', 3, 1], ['Mild', 3, 2],
  ['Quiet', 3, 5], ['Bashful'], ['Rash', 3, 4], ['Calm', 4, 1], ['Gentle', 4, 2], ['Sassy', 4, 5], ['Careful', 4, 3], ['Quirky']];
const natureMult = (nat, i) => { const n = NATURES.find(x => x[0] === nat) || NATURES[0]; return n[1] === i ? 1.1 : n[2] === i ? 0.9 : 1; };
// Gen 3 stat formula (stat order HP, Atk, Def, SpA, SpD, Spe)
function statValue(base, i, level, iv, ev, nat) {
  const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100);
  return i === 0 ? (base === 1 ? 1 : core + level + 10) : Math.floor((core + 5) * natureMult(nat, i));
}
function ivRange(base, i, level, stat, ev, nat) {
  const ok = []; for (let iv = 0; iv <= 31; iv++) if (statValue(base, i, level, iv, ev, nat) === stat) ok.push(iv);
  return ok;
}
// EXP needed to reach a level, by growth rate (gExperienceTables)
function expAt(growth, n) {
  if (n <= 1) return 0;
  const c = n ** 3;
  switch (growth) {
    case 'fast': return Math.floor(4 * c / 5);
    case 'slow': return Math.floor(5 * c / 4);
    case 'medium-slow': return Math.floor(6 * c / 5) - 15 * n * n + 100 * n - 140;
    case 'erratic': return n <= 50 ? Math.floor((100 - n) * c / 50) : n <= 68 ? Math.floor((150 - n) * c / 100) : n <= 98 ? Math.floor(Math.floor((1911 - 10 * n) / 3) * c / 500) : Math.floor((160 - n) * c / 100);
    case 'fluctuating': return n <= 15 ? Math.floor((Math.floor((n + 1) / 3) + 24) * c / 50) : n <= 36 ? Math.floor((n + 14) * c / 50) : Math.floor((Math.floor(n / 2) + 32) * c / 50);
    default: return c;
  }
}
const levelFor = (growth, exp) => { let l = 1; while (l < 100 && expAt(growth, l + 1) <= exp) l++; return l; };
// EXP for beating one Pokémon (Gen 3): base EXP × level / 7, × 1.5 from a trainer, split between the Pokémon that fought
const expFor = (dex, level, trainer = true, split = 1) => Math.max(1, Math.floor(Math.floor(Math.floor((mon(dex).expYield || 0) * level / 7) / split) * (trainer ? 1.5 : 1)));

const monOptions = (sel) => state.dex.map(p => `<option value="${p.dex}" ${p.dex === sel ? 'selected' : ''}>${num3(p.dex)} ${esc(p.name)}</option>`).join('');
const numIn = (id, v, min, max, w = 64) => `<input type="number" id="${id}" value="${v}" min="${min}" max="${max}" inputmode="numeric" style="width:${w}px">`;
const val = (id, d = 0) => { const x = parseInt(document.getElementById(id)?.value, 10); return Number.isFinite(x) ? x : d; };

// ---------- stats and IVs ----------
function renderStatsTool(arg) {
  const t = (state.statTool ||= { dex: parseInt(arg, 10) || cur().team[0] || 25, level: 50, nat: 'Hardy', ev: [0, 0, 0, 0, 0, 0], stat: ['', '', '', '', '', ''] });
  const p = mon(t.dex);
  const rows = STAT_NAMES.map((nm, i) => {
    const lo = statValue(p.stats[i], i, t.level, 0, t.ev[i], t.nat), hi = statValue(p.stats[i], i, t.level, 31, t.ev[i], t.nat);
    const r = t.stat[i] !== '' ? ivRange(p.stats[i], i, t.level, +t.stat[i], t.ev[i], t.nat) : null;
    const nm2 = natureMult(t.nat, i);
    return `<tr><td>${nm}${nm2 > 1 ? ' <span class="good">+</span>' : nm2 < 1 ? ' <span class="bad">−</span>' : ''}</td><td>${p.stats[i]}</td><td>${lo}–${hi}</td>
      <td>${numIn('ev' + i, t.ev[i], 0, 255, 56)}</td><td>${`<input type="number" id="st${i}" value="${t.stat[i]}" min="1" max="999" inputmode="numeric" style="width:64px">`}</td>
      <td>${r ? (r.length ? `<b>${r[0] === r[r.length - 1] ? r[0] : `${r[0]}–${r[r.length - 1]}`}</b>` : '<span class="bad">impossible</span>') : ''}</td></tr>`;
  }).join('');
  view.innerHTML = `<div class="card"><select id="stmon">${monOptions(t.dex)}</select>
    <div class="toolbar" style="margin-top:8px"><label class="note">Level ${numIn('stlvl', t.level, 1, 100)}</label>
    <label class="note">Nature <select id="stnat" style="width:auto">${NATURES.map(n => `<option ${n[0] === t.nat ? 'selected' : ''}>${n[0]}</option>`).join('')}</select></label></div></div>
    <div class="card scrollx"><table class="mini"><tr><th>Stat</th><th>Base</th><th>Range (IV 0–31)</th><th>EVs</th><th>Your stat</th><th>IV</th></tr>${rows}</table>
    <p class="note">Enter the stats from your summary screen to work out IVs. A level-up or two narrows the range. Uses the Gen 3 formula; EVs count a quarter each, max 255 per stat and 510 in total.</p></div>`;
  const go = () => { Object.assign(t, { dex: val('stmon', t.dex), level: Math.min(100, Math.max(1, val('stlvl', t.level))), nat: document.getElementById('stnat').value,
    ev: t.ev.map((_, i) => Math.min(255, Math.max(0, val('ev' + i)))), stat: t.stat.map((_, i) => document.getElementById('st' + i).value) }); renderStatsTool(); };
  view.querySelectorAll('select, input').forEach(el => el.onchange = go);
  document.getElementById('stmon').onchange = () => { t.stat = ['', '', '', '', '', '']; t.dex = val('stmon', t.dex); renderStatsTool(); };
}

// ---------- catch odds ----------
function renderCatchTool(arg) {
  const t = (state.catchTool ||= { dex: 25, level: 10, hp: 100, status: 1, turns: 1 });
  if (arg) t.dex = parseInt(arg, 10) || t.dex;
  const p = mon(t.dex), frac = Math.max(1, t.hp) / 100;
  const waterBug = p.types.some(x => x === 'Water' || x === 'Bug');
  const balls = [['Poké Ball', 1], ['Great Ball', 1.5], ['Ultra Ball', 2], ['Safari Ball', 1.5, 'Safari Zone only'], ['Net Ball', waterBug ? 3 : 1, waterBug ? 'Water or Bug: 3×' : 'only helps on Water and Bug'],
    ['Nest Ball', t.level < 40 ? Math.max(1, (40 - t.level) / 10) : 1, 'better the lower its level'], ['Repeat Ball', isCaught(t.dex) ? 3 : 1, isCaught(t.dex) ? 'you have one: 3×' : "3× once you've caught one"],
    ['Timer Ball', Math.min(4, (t.turns + 10) / 10), `after ${t.turns} turn${t.turns === 1 ? '' : 's'}`], ['Premier Ball', 1], ['Master Ball', 255, 'always']];
  const one = b => catchChance(p.catchRate, b, frac, t.status);
  view.innerHTML = `<div class="card"><select id="cmon">${monOptions(t.dex)}</select>
    <p class="note">Catch rate ${p.catchRate} (higher is easier; 255 is the easiest, 3 the hardest)</p>
    <label class="note">HP left: <b>${t.hp}%</b></label><input type="range" id="chp" min="1" max="100" value="${t.hp}" style="width:100%">
    <div class="chips" style="margin:8px 0">${[[1, 'No status'], [1.5, 'Paralysed / poisoned / burned'], [2, 'Asleep / frozen']].map(([v, l]) => `<button class="chip ${t.status === v ? 'on' : ''}" data-st="${v}">${l}</button>`).join('')}</div>
    <div class="toolbar"><label class="note">Its level ${numIn('clvl', t.level, 1, 100)}</label><label class="note">Turns so far ${numIn('cturn', t.turns, 1, 30)}</label></div></div>
    <div class="card"><table class="mini"><tr><th>Ball</th><th>Each throw</th><th>Within 5 throws</th></tr>${balls.map(([n, m, note]) => {
      const c = one(m); return `<tr><td>${n}${note ? `<div class="note">${note}</div>` : ''}</td><td><b>${(c * 100).toFixed(c < 0.1 ? 1 : 0)}%</b></td><td>${((1 - (1 - c) ** 5) * 100).toFixed(0)}%</td></tr>`;
    }).join('')}</table><p class="note">Gen 3 formula from the game code: four shake checks per throw. False Swipe leaves it at 1 HP; sleep is the best status.</p></div>`;
  document.getElementById('cmon').onchange = e => { t.dex = +e.target.value; renderCatchTool(); };
  document.getElementById('chp').oninput = e => { t.hp = +e.target.value; renderCatchTool(); };
  view.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { t.status = +b.dataset.st; renderCatchTool(); });
  document.getElementById('clvl').onchange = () => { t.level = val('clvl', t.level); renderCatchTool(); };
  document.getElementById('cturn').onchange = () => { t.turns = Math.max(1, val('cturn', t.turns)); renderCatchTool(); };
}

// ---------- EXP and level forecast ----------
// Every trainer battle in story order with when you fight it, so EXP between two points can be totalled.
function allBattles() {
  if (state.allBattles) return state.allBattles;
  const out = [];
  for (const l of state.index) for (const t of state.locations[l.id].trainers || []) out.push({ t, loc: l.id, stage: battleStage(t, l.id) });
  return (state.allBattles = out.sort((a, b) => a.stage - b.stage));
}
const partyOf = t => t.party || (pickOf('starter') && t.byStarter?.[pickOf('starter')]) || (t.byStarter && Object.values(t.byStarter)[0]) || [];
function forecast(fromStage, toKey, split) {
  const target = state.trainers.find(t => t.id === toKey);
  const end = battleStage(target, target.location);
  const fights = allBattles().filter(b => b.stage >= fromStage && b.stage <= end && !(b.loc === target.location && b.t.id === target.id));
  const s = cur();
  let exp = 0, n = 0;
  for (const b of fights) { if (s.checks[trainerKey(b.loc, b.t)]) continue; n++; for (const p of partyOf(b.t)) exp += expFor(p.dex, p.level, true, split); }
  return { exp, n, target, ace: Math.max(...partyOf(target).map(p => p.level)) };
}
function renderXPTool() {
  const s = cur(), t = (state.xpTool ||= { to: null, split: Math.max(1, s.team.length) });
  const here = currentStage();
  const next = state.trainers.find(k => battleStage(k, k.location) >= here && !s.checks[trainerKey(k.location, k)]) || state.trainers[state.trainers.length - 1];
  t.to = t.to && state.trainers.some(k => k.id === t.to) ? t.to : next.id;
  const f = forecast(here, t.to, t.split);
  const rows = s.team.map(n => {
    const lvl = teamMeta(n).level || 5, g = mon(n).growth, after = levelFor(g, expAt(g, lvl) + f.exp);
    return `<tr><td>${monA(n)}</td><td>${lvl}${teamMeta(n).level ? '' : '*'}</td><td><b>${after}</b></td><td>${after >= f.ace ? '<span class="good">ready</span>' : `<span class="bad">${f.ace - after} short</span>`}</td></tr>`;
  }).join('');
  view.innerHTML = `<div class="card">${stagePicker('xphere')}
    <label class="note" style="display:block;margin-top:8px">Up to and including</label><select id="xpto">${state.trainers.map(k => `<option value="${k.id}" ${k.id === t.to ? 'selected' : ''}>${esc(k.name)} (ace Lv ${Math.max(...partyOf(k).map(p => p.level))})</option>`).join('')}</select>
    <div class="toolbar" style="margin-top:8px"><label class="note">Pokémon sharing the EXP ${numIn('xpsplit', t.split, 1, 6)}</label></div></div>
    <div class="card"><p><b>${f.exp.toLocaleString()} EXP</b> each from ${f.n} trainer battles you haven't ticked off, before ${esc(f.target.name)}.</p>
    ${s.team.length ? `<table class="mini"><tr><th>Team</th><th>Now</th><th>Then</th><th>vs ace Lv ${f.ace}</th></tr>${rows}</table>` : '<p class="note">Add your team (with levels) in <a href="#/planner">Battle plan</a> to see their levels then.</p>'}
    <p class="note">Gen 3 formula: base EXP × level ÷ 7, ×1.5 from trainers, split evenly between the Pokémon that battle. Wild battles, the EXP. All and Lucky Egg aren't counted, so this is the least you'll have. * = level not set.</p></div>`;
  bindStagePicker('xphere', renderXPTool);
  document.getElementById('xpto').onchange = e => { t.to = e.target.value; renderXPTool(); };
  document.getElementById('xpsplit').onchange = () => { t.split = Math.min(6, Math.max(1, val('xpsplit', 1))); renderXPTool(); };
}

// ---------- EV yield and training ----------
function evSpots(stat) {
  const out = [], here = currentStage();
  for (const l of state.index) {
    const loc = state.locations[l.id];
    for (const [k, list] of Object.entries(groupBy(loc.encounters.filter(e => e.rate && inVersion(e)), e => `${e.area || ''}|${e.method}`))) {
      const per = list.reduce((a, e) => a + parseInt(e.rate, 10) / 100 * (mon(e.dex).ev?.[stat] || 0), 0);
      if (per > 0) out.push({ loc: l.id, name: loc.name, area: k.split('|')[0], method: k.split('|')[1], per, stage: encStage(l.id, list[0]), mons: list.filter(e => mon(e.dex).ev?.[stat]).map(e => `${mon(e.dex).name} ${e.rate}`) });
    }
  }
  return out.sort((a, b) => b.per - a.per || a.stage - b.stage).map(x => ({ ...x, later: x.stage > here }));
}
function renderEVTool() {
  const t = (state.evTool ||= { stat: 5 }), s = cur();
  s.evs ||= {};
  const spots = evSpots(t.stat).slice(0, 15);
  const member = n => {
    const e = s.evs[n] || [0, 0, 0, 0, 0, 0], tot = e.reduce((a, b) => a + b, 0);
    return `<div class="member"><div class="mhead"><b>${esc(mon(n).name)}</b> <span class="note">${tot}/510</span></div>
      <div class="note">${e.map((v, i) => `${STAT_SHORT[i]} ${v}`).join(' · ')}</div>
      <div class="toolbar" style="margin:6px 0 0"><select data-evadd="${n}" style="flex:1"><option value="">Add a defeated Pokémon…</option>${state.dex.filter(p => p.ev?.some(Boolean)).map(p => `<option value="${p.dex}">${esc(p.name)} (${evText(p.ev)})</option>`).join('')}</select>
      <button class="btn small" data-evreset="${n}" style="margin-top:0">Reset</button></div></div>`;
  };
  view.innerHTML = `<div class="card"><p class="note">Best places to train one stat: EVs per wild battle, weighted by how often each Pokémon appears.</p>
    <div class="chips">${STAT_NAMES.map((n, i) => `<button class="chip ${t.stat === i ? 'on' : ''}" data-evs="${i}">${n}</button>`).join('')}</div></div>
    <div class="card"><table class="mini"><tr><th>Where</th><th>EVs per battle</th></tr>${spots.map(x => `<tr><td><a href="#/loc/${x.loc}">${esc(x.name)}</a>${x.area ? ` <span class="note">${esc(x.area)}</span>` : ''} <span class="note">· ${esc(METHOD_LABEL[x.method] || x.method)}</span>${x.later ? ' <span class="tag">ahead of you</span>' : ''}<div class="note">${esc(x.mons.join(', '))}</div></td><td><b>${x.per.toFixed(2)}</b></td></tr>`).join('')}</table>
    <p class="note">Macho Brace and Pokérus each double EVs. Vitamins from the Celadon Department Store add 10 each, up to 100.</p></div>
    <h2>EV counter</h2><div class="card">${s.team.length ? s.team.map(member).join('') : '<p class="note">Add your team in <a href="#/planner">Battle plan</a> to count EVs.</p>'}
    <label class="row"><input type="checkbox" id="evbrace" ${t.brace ? 'checked' : ''}><span>Holding a Macho Brace or has Pokérus (×2)</span></label></div>`;
  view.querySelectorAll('[data-evs]').forEach(b => b.onclick = () => { t.stat = +b.dataset.evs; renderEVTool(); });
  document.getElementById('evbrace').onchange = e => { t.brace = e.target.checked; };
  view.querySelectorAll('[data-evadd]').forEach(sel => sel.onchange = () => {
    const n = sel.dataset.evadd, y = mon(+sel.value).ev, e = (s.evs[n] ||= [0, 0, 0, 0, 0, 0]);
    let tot = e.reduce((a, b) => a + b, 0);
    y.forEach((v, i) => { const add = Math.min(v * (t.brace ? 2 : 1), 255 - e[i], 510 - tot); if (add > 0) { e[i] += add; tot += add; } });
    save(); renderEVTool();
  });
  view.querySelectorAll('[data-evreset]').forEach(b => b.onclick = () => { delete s.evs[b.dataset.evreset]; save(); renderEVTool(); });
}

TOOLS.push({ id: 'stats', title: 'Stats and IVs', desc: 'Stat ranges for any Pokémon and level, and IVs from your summary screen', render: renderStatsTool },
  { id: 'catch', title: 'Catch odds', desc: 'Chance per ball by HP, status and turns, from the game formula', render: renderCatchTool },
  { id: 'xp', title: 'Level forecast', desc: 'EXP from the trainers ahead and the levels your team will reach by the next big battle', render: renderXPTool },
  { id: 'ev', title: 'EV training', desc: 'Best places to train each stat, and an EV counter for your team', render: renderEVTool });
