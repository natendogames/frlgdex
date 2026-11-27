'use strict';
// ---------- Auto team and auto levels ----------
// Two settings, both on until you turn them off (Battle plan, or Backup & settings):
//  - Auto team: when you tick off a Pokémon your Team plan uses (on a route, in the Pokédex or in the Team plan), it goes
//    on your Battle plan team, if there's room and nobody from its evolution line is on the team already.
//  - Auto levels: you don't type levels. Against a trainer, your team is taken to be the level of that trainer's
//    strongest Pokémon. Anywhere else (catch plans, training, the EXP tool), it's the level of the strongest trainer
//    Pokémon you have reached by your point in the story.
const autoTeamOn = () => state.progress.autoTeam !== false;
const autoLevelOn = () => state.progress.autoLevel !== false;
// Level of a trainer's strongest Pokémon
const autoLevelFor = party => Math.max(5, ...(party || []).map(p => p.level || 0));
// Level of the strongest trainer Pokémon up to where you are in the story
function autoLevelNow() {
  const here = currentStage();
  let lv = 5;
  for (const b of allBattles()) {
    if (b.stage > here) break;
    for (const p of partyOf(b.t)) if (p.level > lv) lv = p.level;
  }
  return lv;
}
// Every Pokémon the Team plan still wants for battles you haven't won: its lineups, and what it says to catch or evolve
function planWants() {
  const plan = state.teamPlan && pickOf('starter') && planOf(V(), pickOf('starter'));
  if (!plan) return null;
  const s = cur(), out = new Set();
  for (const l of plan.legs) {
    if (s.checks[trainerKey(l.battle.loc, l.battle)]) continue;
    for (const m of l.team) out.add(+m.dex);
    for (const x of l.steps) if (['catch', 'evolve'].includes(x.kind) && x.dex) out.add(+x.dex);
  }
  return out;
}
// After you tick a Pokémon off as caught: put it on the Battle plan team if the Team plan uses it.
// Returns 'added', 'full' or ''. state.autoAdded remembers it so Undo takes it off the team again.
function autoTeamAdd(d, after) {
  const s = cur(), n = +d;
  if (!autoTeamOn() || !s.caught[n] || s.team.includes(n)) return '';
  if (!state.teamPlan) {
    // the Team plan loads the first time it's needed; try again once it's here
    if (pickOf('starter') && !state.autoPlanLoading) {
      state.autoPlanLoading = true;
      getJSON('data/team-plan.json').then(p => { state.teamPlan ||= p; const r = autoTeamAdd(n); if (r) { save(); after?.(r); } }).catch(() => {}).finally(() => { state.autoPlanLoading = false; });
    }
    return '';
  }
  const want = planWants();
  if (!want || !want.has(n)) return '';
  const base = lineOf(n)[0];
  if (s.team.some(t => lineOf(t)[0] === base)) return '';
  if (s.team.length >= 6) return 'full';
  s.team.push(n);
  state.autoAdded = n;
  return 'added';
}
const autoTeamNote = r => r === 'added' ? ' · added to your Battle plan team' : r === 'full' ? ' · Battle plan team is full' : '';
function autoSettingsHtml() {
  return `<label class="row"><input type="checkbox" id="autoTeam" ${autoTeamOn() ? 'checked' : ''}><span>Auto team: when I catch a Pokémon the Team plan uses, add it to my Battle plan team</span></label>
    <label class="row"><input type="checkbox" id="autoLevel" ${autoLevelOn() ? 'checked' : ''}><span>Auto levels: take my team to be the level of the trainer I'm up against (their strongest Pokémon), so I don't have to type levels</span></label>`;
}
function bindAutoSettings(after) {
  const t = document.getElementById('autoTeam'), l = document.getElementById('autoLevel');
  if (t) t.onchange = e => { e.stopPropagation(); state.progress.autoTeam = t.checked; save(); after?.(); };
  if (l) l.onchange = e => { e.stopPropagation(); state.progress.autoLevel = l.checked; if (typeof hvCache === 'object') hvCache.sig = null; save(); after?.(); };
}
