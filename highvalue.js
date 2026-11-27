'use strict';
// High-value catches: wild Pokémon that the Battle plan or the Team plan wants for your next key battles. These are
// the next two Gym Leaders (or Elite Four / Champion battles) you haven't beaten, and the rival and boss battles
// before them. Route, Pokédex and Pokémon pages flag these with a "★" tag and the reason, so you know to catch one
// while you're there. The same file is used by the FireRed/LeafGreen, Emerald and Seaglass apps.
const HV_GYM = new Set(['Leader', 'Elite Four', 'Champion']);

// Key battles still ahead of you, in story order, up to and including the second Gym Leader-type battle.
// gym is 1 for the next Gym Leader-type battle and the ones before it, and 2 for the one after that.
function upcomingBattles() {
  const s = cur(), now = typeof currentStage === 'function' ? currentStage() : 0, out = [];
  let gym = 1;
  for (const t of state.trainers || []) {
    if (s.checks[trainerKey(t.location, t)] || battleStage(t, t.location) < now) continue;
    out.push({ t, gym });
    if (HV_GYM.has(t.class) && ++gym > 2) break;
  }
  return out;
}
function hvParty(t) {
  if (t.party) return t.party;
  const mine = pickOf('starter');
  if (!mine) return null;
  return typeof rivalParty === 'function' ? rivalParty(t, mine) : t.byStarter?.[mine] || null;
}

let hvCache = { sig: null, map: null };
// dex -> [{ gym, battle, text }] for Pokémon you haven't caught yet, soonest battle first.
function highValue() {
  const s = cur(), ups = upcomingBattles();
  if (!state.teamPlan && pickOf('starter') && !state.hvPlanLoading) {
    state.hvPlanLoading = true;
    getJSON('data/team-plan.json').then(d => { state.teamPlan ||= d; hvCache.sig = null; }).catch(() => {});
  }
  const sig = JSON.stringify([V(), s.team, s.teamMeta, s.picks, ups.map(u => u.t.id), Object.keys(s.caught).filter(k => s.caught[k]), !!state.teamPlan, s.here]);
  if (hvCache.sig === sig) return hvCache.map;
  const map = new Map(), team = s.team || [];
  const add = (dex, u, text) => {
    if (isCaught(dex)) return;
    const list = map.get(dex) || [];
    if (!list.some(r => r.text === text)) list.push({ gym: u.gym, battle: u.t.name, text });
    map.set(dex, list);
  };
  for (const u of ups) {
    const party = hvParty(u.t);
    if (!party) continue;
    const stage = battleStage(u.t, u.t.location);
    for (const p of party) {
      const foe = foeBattler(p);
      const duels = team.map(n => duel(myBattler(n, p.level), foe)).sort(rankDuels), best = duels[0];
      // the same test the Battle plan uses to decide when to suggest a catch
      if (best && best.wins && (duels.some(d => d.se.length) || best.myHits <= 2)) continue;
      // only the best catch for each of their Pokémon (the Battle plan lists it first)
      for (const { c, f, d } of catchSuggestions(p, foe, stage, party, 1)) {
        if (isCaught(f.dex)) continue;
        const as = f.dex !== c.dex ? ` once it evolves into ${mon(f.dex).name}` : '';
        add(c.dex, u, `Battle plan: beats ${u.t.name}'s ${p.name}${as} (${d.mine.name}, ${hitsText(d.myHits)})`);
      }
    }
  }
  const plan = state.teamPlan && pickOf('starter') && state.teamPlan.plans[`${V()}:${pickOf('starter')}`];
  if (plan) for (const u of ups) {
    const leg = plan.legs.find(l => l.battle.id === u.t.id);
    for (const x of leg?.steps || []) if (x.kind === 'catch' && x.dex) add(x.dex, u, `Team plan: catch it before ${u.t.name}`);
  }
  for (const list of map.values()) list.sort((a, b) => a.gym - b.gym);
  hvCache = { sig, map };
  return map;
}
// The tag and one-line reason that go on a Pokémon's row
function hvTag(dex) {
  const r = highValue().get(+dex);
  if (!r) return '';
  return ` <span class="tag hv${r[0].gym === 1 ? ' soon' : ''}" title="${esc(r.map(x => x.text).join('\n'))}">★ ${r[0].gym === 1 ? 'Next gym' : 'Gym after next'}</span>`;
}
function hvSub(dex) {
  const r = highValue().get(+dex);
  if (!r) return '';
  return `<span class="hvwhy">★ ${esc(r[0].text)}${r.length > 1 ? ` (+${r.length - 1} more)` : ''}</span>`;
}
// A card on the Pokémon page listing every reason
function hvCard(dex) {
  const r = highValue().get(+dex);
  if (!r) return '';
  return `<div class="card hvcard"><b>★ Worth catching for your next battles</b>${r.map(x => `<div class="note">${x.gym === 1 ? 'Next gym' : 'Gym after next'}: ${esc(x.text)}</div>`).join('')}
    <p class="note">From your <a href="#/planner">Battle plan</a> team and the <a href="#/plan">Team plan</a>.</p></div>`;
}
