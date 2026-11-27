'use strict';
// Best wild Pokémon to train on (EXP grinding). On every location page, the one or two Pokémon you can find there on your
// first visit (or now, once the "come back later" ones open up) that give the most EXP per battle. EXP per wild battle
// uses the Gen 3 formula all three games share: floor(base EXP × level / 7), split between the Pokémon that took part.
// Each pick also says how often it shows up, which stats it trains (EVs), whether your Battle plan team knocks it out
// in one hit, and how far to train for the next Gym Leader. The same file is used by the FireRed/LeafGreen, Emerald and
// Seaglass apps; Seaglass also has the DexNav (search for one species directly) and soft level caps.
const GRIND_SKIP = new Set(['gift', 'trade', 'static', 'roaming', 'game-corner']);
// Seaglass's DexNav finds one species on demand in grass, caves and water
const grindSearchable = e => typeof METHOD_LABEL === 'object' && !!METHOD_LABEL.dexnav && /^(grass|surf|dexnav|dexnav-surf)$/.test(e.method);
const grindLevels = e => (e.levels || '').split('-').map(Number).filter(n => n > 0);
const grindExp = (dex, level) => Math.max(1, Math.floor((mon(dex).expYield || 0) * level / 7));
const grindEvText = dex => {
  const names = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  const ev = mon(dex).ev || [];
  return ev.map((n, i) => n ? `${n} ${names[i]}` : '').filter(Boolean).join(', ');
};
// The best one or two from a list of encounters: one entry per Pokémon (its best method), most EXP first.
function grindPicks(encs, n = 2) {
  const best = new Map();
  for (const e of encs) {
    if (GRIND_SKIP.has(e.method) || LEGENDARY.has(e.dex) || !mon(e.dex)?.expYield) continue;
    // too rare to train on, unless the DexNav can search for it directly
    if (e.rate && parseFloat(e.rate) < 5 && !grindSearchable(e)) continue;
    const lv = grindLevels(e);
    if (!lv.length) continue;
    const lo = Math.min(...lv), hi = Math.max(...lv), avg = (lo + hi) / 2;
    const x = { e, lo, hi, exp: grindExp(e.dex, avg), rate: parseFloat(e.rate) || 0 };
    const old = best.get(e.dex);
    if (!old || x.exp > old.exp || (x.exp === old.exp && x.rate > old.rate)) best.set(e.dex, x);
  }
  return [...best.values()].sort((a, b) => b.exp - a.exp || b.rate - a.rate).slice(0, n);
}
// The next Gym Leader (or Elite Four / Champion) after this point of the story that you haven't beaten, to say how far to train
function grindTarget(locId) {
  const s = cur(), here = stageOf(locId);
  for (const t of state.trainers || []) {
    if (!['Leader', 'Elite Four', 'Champion'].includes(t.class) || s.checks[trainerKey(t.location, t)] || battleStage(t, t.location) < here - 2) continue; // a gym in the last town or two may still be ahead of you
    const party = t.party || (typeof hvParty === 'function' ? hvParty(t) : null) || Object.values(t.byStarter || {})[0] || [];
    if (party.length) return { t, ace: Math.max(...party.map(p => p.level)), base: Math.max(...party.map(p => p.baseLevel ?? p.level)) };
  }
  return null;
}
// Can your Battle plan team knock it out in one hit?
function grindKO(dex, level) {
  const team = cur().team || [];
  if (!team.length) return '';
  const foe = battler(dex, level, 0, defaultMoves(dex, level));
  let best = null;
  for (const n of team) {
    const d = duel(myBattler(n, level), foe);
    if (!best || d.myHits < best.myHits) best = d;
  }
  return best && best.myHits === 1 ? `Your ${esc(mon(best.me.dex).name)} knocks it out in one hit (${esc(best.mine.name)}).`
    : best && best.myHits !== Infinity ? `Your best is ${esc(mon(best.me.dex).name)}: ${hitsText(best.myHits)} with ${esc(best.mine.name)}.` : '';
}
function grindRow(x, members = [], target = null) {
  const e = x.e;
  const how = [METHOD_LABEL[e.method] || e.method, `Lv ${x.lo === x.hi ? x.lo : `${x.lo}-${x.hi}`}`, e.rate && `${esc(e.rate)} of encounters`].filter(Boolean).join(' · ');
  const tips = [`About ${x.exp} EXP a battle${x.lo !== x.hi ? ` (${grindExp(e.dex, x.lo)}-${grindExp(e.dex, x.hi)})` : ''}`, grindEvText(e.dex) && `trains ${grindEvText(e.dex)} EV${(mon(e.dex).ev || []).reduce((a, b) => a + b, 0) > 1 ? 's' : ''}`]
    .filter(Boolean).join(', ') + '.';
  const ko = members.length ? '' : grindKO(e.dex, x.hi);  // with a team to check, the good-for lines say it better
  const nav = grindSearchable(e) ? ' Use the DexNav to search for it directly.' : '';
  return `<div class="grind"><a href="#/mon/${e.dex}"><b>${esc(e.name)}</b></a> ${types(e.dex)}<div class="sub">${how}</div>
    <div class="sub">${tips}${nav}${ko ? ` ${ko}` : ''}</div>${grindFit(x, members, target)}</div>`;
}
// Which of your team should train on it, and which shouldn't (a bad type matchup, or it loses one-on-one)
function grindFit(x, members, target) {
  if (!members.length) return '';
  const who = members[0].from === 'plan' && target ? `Team plan team for ${esc(target.name)}: ` : '';
  const good = [], bad = [];
  for (const m of members) {
    const v = grindVs(m, x.e.dex, x.hi), name = esc(mon(m.dex).name);
    if (v.ok) good.push(name);
    else bad.push(`${name} (${v.bad ? esc(v.bad) : `it can't win one-on-one at Lv ${m.level}`})`);
  }
  return (good.length ? `<div class="sub">${who}good for ${good.join(', ')}.</div>` : '') + (bad.length ? `<div class="sub bad">${good.length ? '' : who}Not for ${bad.join('; ')}.</div>` : '');
}
// Pick one team member to see the best matchup here for it: what it beats fastest for the most EXP, with no
// super-effective move or type against it (the same rules as the Training spots page)
function grindFor(members, now, target) {
  if (!members.length) return '';
  const sel = members.find(m => m.dex === state.trainFor);
  let html = `<div class="note" style="margin-top:6px">Best here for:</div><div class="chips">${members.map(m =>
    `<button class="chip ${sel === m ? 'on' : ''}" data-trf="${m.dex}">${esc(mon(m.dex).name)}</button>`).join('')}</div>`;
  if (!sel) return html;
  const opts = [];
  for (const x of grindPicks(now, 99)) {
    const v = grindVs(sel, x.e.dex, x.hi);
    if (!v.ok) continue;
    const risky = v.d.theirHits <= v.d.myHits + 1;
    opts.push({ ...x, d: v.d, perTurn: x.exp / v.d.myHits, score: x.exp / v.d.myHits * (risky ? 0.7 : 1) });
  }
  opts.sort((a, b) => b.score - a.score || b.d.theirHits - a.d.theirHits || b.rate - a.rate);
  const hurt = d => d.theirHits === Infinity ? "it can't hurt you" : d.theirHits >= d.myHits + 3 ? 'it barely scratches you' : d.theirHits <= d.myHits + 1 ? `watch out: it can hit back hard (${d.theirHits} hits beat you)` : `it needs ${d.theirHits} hits to beat you`;
  html += `<div class="grind trainfor"><b>${esc(mon(sel.dex).name)}</b> <span class="note">Lv ${sel.level}${target && sel.from === 'plan' ? ` on the way to ${esc(target.name)}` : ''} · ${sel.me.moves.map(esc).join(', ')}</span>${opts.length
    ? opts.slice(0, 2).map((o, k) => `<div class="sub">${k ? 'Or: ' : ''}<a href="#/mon/${o.e.dex}"><b>${esc(o.e.name)}</b></a> ${types(o.e.dex)} (${esc(METHOD_LABEL[o.e.method] || o.e.method)}, Lv ${o.lo === o.hi ? o.lo : `${o.lo}-${o.hi}`}${o.e.rate ? `, ${esc(o.e.rate)}` : ''}): ${esc(o.d.mine.name)}${o.d.mine.mult >= 2 ? ' (super effective)' : ''} ${hitsText(o.d.myHits)}, about ${Math.round(o.perTurn)} EXP a turn; ${hurt(o.d)}.</div>`).join('')
    : `<div class="sub">Nothing here is a good matchup for it on this visit. <a href="#/tools/train">See the best places for it</a>.</div>`}</div>`;
  return html;
}
// tapping a name picks it (tap again to clear)
view.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-trf]');
  if (!b) return;
  state.trainFor = state.trainFor === +b.dataset.trf ? null : +b.dataset.trf;
  const y = window.scrollY; route(true); window.scrollTo(0, y);
});
// The card on a location page: the best now, and a better spot here once more of the area opens up.
function grindCard(locId, now, later = []) {
  const picks = grindPicks(now);
  const laterBest = grindPicks(later, 1)[0];
  if (!picks.length && !laterBest) return '';
  const tg = grindTarget(locId);
  const cap = tg ? `<p class="note">Next ${tg.t.class === 'Leader' ? 'Gym Leader' : esc(tg.t.class)}: ${esc(tg.t.name)}, top Pokémon Lv ${tg.ace}.${typeof SOFT_LEVEL_CAP !== 'undefined' && SOFT_LEVEL_CAP
    ? ` Seaglass's level cap (on by default) cuts EXP once your Pokémon pass about Lv ${tg.base}, so training past that is slow.` : ` Training to about Lv ${tg.ace} makes that battle much easier.`}</p>` : '';
  let html = `<div class="card grindcard"><b>Best Pokémon to train on here</b>${picks.length ? '' : '<p class="note">Nothing to battle here on your first visit.</p>'}`;
  const members = grindMembers(tg && tg.t);
  html += grindFor(members, now, tg && tg.t);
  html += picks.map(x => grindRow(x, members, tg && tg.t)).join('') + cap;
  if (laterBest && (!picks.length || laterBest.exp > picks[0].exp * 1.25))
    html += `<details class="later"><summary>Better spot here: come back later</summary><p class="note">${esc(laterBest.e.name)} (${esc(METHOD_LABEL[laterBest.e.method] || laterBest.e.method)}, Lv ${laterBest.lo === laterBest.hi ? laterBest.lo : `${laterBest.lo}-${laterBest.hi}`}) gives about ${laterBest.exp} EXP a battle${typeof needText === 'function' && needText(laterBest.e) ? ` (${esc(needText(laterBest.e))})` : ''}.</p></details>`;
  html += `<p class="note"><a href="#/tools/train">Best training spots before your next battle</a></p>`;
  return html + `<p class="note">EXP is for one Pokémon beating it in a wild battle${typeof SOFT_LEVEL_CAP !== 'undefined' ? '; the Exp. Share (from Scott in Petalburg) gives EXP to the rest of your party too' : ', split between the Pokémon that battled'}. A Lucky Egg gives 1.5×.</p></div>`;
}

// ---------- Training spots page (Tools) ----------
// Every place you can reach before a big battle (the next Gym Leader, Elite Four or Champion you haven't beaten, or
// one you pick), ranked by EXP per battle or by EVs of one stat, using what you can battle there by that point.
const GRIND_BIG = ['Leader', 'Elite Four', 'Champion'];
function grindSpots(stage, stat) {
  const best = new Map();
  for (const l of state.index) {
    if (stageOf(l.id) > stage) continue;
    const encs = locView(state.locations[l.id]).encs.filter(e => encStage(l.id, e) <= stage);
    for (const x of grindPicks(encs, 99)) {
      const ev = (mon(x.e.dex).ev || [])[stat] || 0;
      if (stat >= 0 && !ev) continue;
      const k = `${l.id}:${x.e.dex}`, y = { ...x, loc: l.id, locName: state.locations[l.id].name, ev };
      if (!best.has(k)) best.set(k, y);
    }
  }
  return [...best.values()].sort((a, b) => stat >= 0 ? b.ev - a.ev || b.exp - a.exp : b.exp - a.exp || b.rate - a.rate);
}
// ---------- Best training for each team member ----------
// For every Pokémon on your Team plan team at that battle (or your Battle plan team, if you haven't picked a starter),
// the wild Pokémon it trains on best: one it beats one-on-one with its own moves at its level, scored by EXP per turn
// (EXP for the KO ÷ turns to KO, so a weaker Pokémon you OHKO can beat a stronger one that takes three hits), and as a
// tie-break the one that hits it least hard. Uses the same damage engine as the Battle plan, so typing, STAB, abilities
// and levels all count.
// Your team on the way to a battle: the Team plan team for it, else your Battle plan team
function grindMembers(target) {
  const s = cur(), plan = target && state.teamPlan && pickOf('starter') && planOf(V(), pickOf('starter'));
  const legs = plan ? plan.legs : [], i = target ? legs.findIndex(l => l.battle.id === target.id) : -1;
  let members = [];
  if (i >= 0) {
    // the levels you have on the way to it: the last battle each one was in, else a couple below this battle's level
    members = legs[i].team.map(m => {
      const prev = legs.slice(0, i).reverse().map(l => l.team.find(x => x.dex === m.dex)).find(Boolean);
      return { dex: m.dex, level: prev ? prev.level : Math.max(2, m.level - 2), moves: m.moves || [], from: 'plan' };
    });
  } else members = (s.team || []).map(n => { const b = myBattler(n, typeof autoLevelOn === 'function' && autoLevelOn() ? autoLevelNow() : 10); return { dex: n, level: b.level, moves: b.moves, from: 'team', guessed: b.guessedLevel }; });
  return members.map(m => ({ ...m, me: battler(m.dex, m.level, PLAYER_IV, m.moves.length ? m.moves : bestMoves(m.dex, m.level)) }));
}
// One team member against one wild Pokémon: no good if it can't win one-on-one, or if the wild one has (or will soon
// have) a super-effective move on it: a move it knows now, or an attacking type of its own (Pikachu against Mudkip)
function grindVs(m, dex, level) {
  const d = duel(m.me, battler(dex, level, 0, defaultMoves(dex, level)));
  const mine = mon(m.dex).types || [];
  const seType = (mon(dex).types || []).find(t => eff(t, mine) >= 2);
  const bad = d.threats[0] ? `${d.threats[0]} is super effective on it` : seType ? `${seType} moves are super effective on it` : '';
  return { d, ok: d.wins && d.myHits !== Infinity && !!d.mine && !bad, bad };
}
function grindTeam(target, stage) {
  const spots = grindSpots(stage, -1);
  return grindMembers(target).map(m => {
    const me = m.me, opts = [];
    for (const x of spots) {
      const { d, ok } = grindVs(m, x.e.dex, x.hi);
      if (!ok) continue;
      // one that can hit back hard (it could beat you with a lucky crit or two) counts for less
      const risky = d.theirHits <= d.myHits + 1;
      opts.push({ ...x, d, risky, perTurn: x.exp / d.myHits, score: x.exp / d.myHits * (risky ? 0.7 : 1) });
    }
    opts.sort((a, b) => b.score - a.score || b.d.theirHits - a.d.theirHits || b.rate - a.rate);
    // one pick per place, so the second choice is somewhere else
    const picks = [];
    for (const o of opts) { if (!picks.some(p => p.loc === o.loc)) picks.push(o); if (picks.length === 2) break; }
    return { m, me, picks };
  });
}
function grindTeamHtml(target, stage) {
  const rows = grindTeam(target, stage);
  if (!rows.length) return `<div class="card"><p class="note">Pick your starter on the <a href="#/plan">Team plan</a> page, or add your team in <a href="#/planner">Battle plan</a>, to see the best training for each team member.</p></div>`;
  const src = rows[0].m.from === 'plan' ? `your <a href="#/plan">Team plan</a> team for ${esc(target.name)}` : `your <a href="#/planner">Battle plan</a> team`;
  const hurt = d => d.theirHits === Infinity ? "it can't hurt you" : d.theirHits >= d.myHits + 3 ? 'it barely scratches you' : d.theirHits <= d.myHits + 1 ? `watch out: it can hit back hard (${d.theirHits} hits beat you)` : `it needs ${d.theirHits} hits to beat you`;
  const one = (o, best) => `<div class="sub">${best ? '' : 'Or: '}<a href="#/mon/${o.e.dex}"><b>${esc(o.e.name)}</b></a> ${types(o.e.dex)} at <a href="#/loc/${o.loc}">${esc(o.locName)}</a>
    (${esc(METHOD_LABEL[o.e.method] || o.e.method)}, Lv ${o.lo === o.hi ? o.lo : `${o.lo}-${o.hi}`}): ${esc(o.d.mine.name)}${o.d.mine.mult >= 2 ? ' (super effective)' : ''} ${hitsText(o.d.myHits)}, about ${Math.round(o.perTurn)} EXP a turn; ${hurt(o.d)}.${grindEvText(o.e.dex) ? ` Trains ${grindEvText(o.e.dex)}.` : ''}</div>`;
  return `<h2>Best for each team member</h2><div class="card grindcard"><p class="note">For ${src}: the wild Pokémon each one beats fastest for the most EXP, with its own moves at its level.</p>${rows.map(({ m, me, picks }) =>
    `<div class="grind"><a href="#/mon/${m.dex}"><b>${esc(mon(m.dex).name)}</b></a> ${types(m.dex)} <span class="note">Lv ${m.level}${m.guessed ? ' (guessed)' : ''} · ${me.moves.map(esc).join(', ') || 'no moves'}</span>
    ${picks.length ? picks.map((o, k) => one(o, !k)).join('') : '<div class="sub">Nothing it beats one-on-one yet: train it with the Exp. Share or by switching it out.</div>'}</div>`).join('')}</div>`;
}
function renderTrainTool() {
  const s = cur(), t = (state.trainTool ||= { stat: -1, battle: null });
  // the Team plan loads on first use; draw again once it's here
  if (!state.teamPlan && pickOf('starter') && !state.trainPlanLoading) {
    state.trainPlanLoading = true;
    getJSON('data/team-plan.json').then(d => { state.teamPlan ||= d; if (location.hash.startsWith('#/tools/train')) renderTrainTool(); }).catch(() => {});
  }
  const ahead = (state.trainers || []).filter(x => GRIND_BIG.includes(x.class) && !s.checks[trainerKey(x.location, x)]);
  const target = ahead.find(x => x.id === t.battle) || ahead[0];
  if (!target) { view.innerHTML = '<div class="card"><p class="note">You have beaten every Gym Leader, the Elite Four and the Champion.</p></div>'; return; }
  const stage = battleStage(target, target.location);
  const party = target.party || (typeof hvParty === 'function' ? hvParty(target) : null) || Object.values(target.byStarter || {})[0] || [];
  const ace = party.length ? Math.max(...party.map(p => p.level)) : null;
  const names = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
  const spots = grindSpots(stage, t.stat).slice(0, 12);
  const row = x => `<div class="grind"><a href="#/mon/${x.e.dex}"><b>${esc(x.e.name)}</b></a> ${types(x.e.dex)} · <a href="#/loc/${x.loc}">${esc(x.locName)}</a>
    <div class="sub">${esc(METHOD_LABEL[x.e.method] || x.e.method)} · Lv ${x.lo === x.hi ? x.lo : `${x.lo}-${x.hi}`}${x.e.rate ? ` · ${esc(x.e.rate)} of encounters` : ''}</div>
    <div class="sub">About ${x.exp} EXP a battle${grindEvText(x.e.dex) ? `, ${grindEvText(x.e.dex)} EV${(mon(x.e.dex).ev || []).reduce((a, b) => a + b, 0) > 1 ? 's' : ''}` : ''}.${(() => { const k = grindKO(x.e.dex, x.hi); return k ? ' ' + k : ''; })()}</div></div>`;
  view.innerHTML = `<div class="card"><p class="note">The best wild Pokémon to battle in every place you can reach before this battle, using only what you can find there by then.</p>
    <div class="note" style="margin-top:6px">Train for:</div><div class="chips">${ahead.slice(0, 4).map(x => `<button class="chip ${x === target ? 'on' : ''}" data-trb="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>
    <div class="note" style="margin-top:6px">Rank by:</div><div class="chips"><button class="chip ${t.stat < 0 ? 'on' : ''}" data-trs="-1">Most EXP</button>${names.map((n, i) => `<button class="chip ${t.stat === i ? 'on' : ''}" data-trs="${i}">${n} EVs</button>`).join('')}</div>
    ${ace ? `<p class="note">${esc(target.name)}'s top Pokémon is Lv ${ace}.${typeof SOFT_LEVEL_CAP !== 'undefined' && SOFT_LEVEL_CAP ? " Seaglass's level cap cuts EXP once you pass it." : ''}</p>` : ''}</div>
    ${grindTeamHtml(target, stage)}
    <h2>Most ${t.stat < 0 ? 'EXP' : `${names[t.stat]} EVs`} overall</h2><div class="card grindcard">${spots.length ? spots.map(row).join('') : '<p class="note">Nothing to battle for that yet.</p>'}</div>
    <p class="note">EXP per wild battle for one Pokémon (base EXP × level ÷ 7). A Lucky Egg gives 1.5×; a Macho Brace or Pokérus doubles EVs. See also <a href="#/tools/ev">EV training</a>.</p>`;
  view.querySelectorAll('[data-trb]').forEach(b => b.onclick = () => { t.battle = b.dataset.trb; renderTrainTool(); });
  view.querySelectorAll('[data-trs]').forEach(b => b.onclick = () => { t.stat = +b.dataset.trs; renderTrainTool(); });
}
TOOLS.push({ id: 'train', title: 'Training spots', desc: 'The best wild Pokémon to battle for EXP or EVs before your next Gym Leader, and the best for each team member', render: renderTrainTool });
