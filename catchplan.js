'use strict';
// Catch plan for one Pokémon at one place (#/catch/<location>/<dex>): which balls you can buy by then, the odds with
// each one in the usual situations (full HP, red HP, 1 HP, asleep, paralysed), and a step-by-step plan for each ball
// using the moves your Battle plan team has. Only balls sold in shops by that point in the story are used; the Master
// Ball is never part of a plan. Loaded after tools.js (uses catchChance from features.js).

// Balls sold in shops, with the earliest story point you can buy each one
const SHOP_WHEN = { 'After rescuing Lostelle': () => stageOf('berry-forest') + 0.5, 'After you become Champion': () => stageOf('pokemon-league') + 0.5,
  'After linking with Ruby or Sapphire': () => stageOf('tanoby-ruins') };
const CATCH_BALLS = ['Poké Ball', 'Great Ball', 'Ultra Ball', 'Repeat Ball', 'Timer Ball'];
function ballShops() {
  if (state.ballShops) return state.ballShops;
  const out = {};
  for (const [loc, shops] of Object.entries(state.extras.shops)) for (const sh of shops) {
    if (sh.coins) continue;
    const at = SHOP_WHEN[sh.where] ? SHOP_WHEN[sh.where]() : stageOf(loc);
    for (const it of sh.items) if (CATCH_BALLS.includes(it.name) && (!out[it.name] || at < out[it.name].at)) out[it.name] = { at, loc, where: sh.where, price: it.price };
  }
  return (state.ballShops = out);
}
// Balls you can have by a story point. Poké Balls always count: Professor Oak hands you five before the first mart.
function ballsBy(stage) {
  const sh = ballShops();
  return CATCH_BALLS.filter(b => b === 'Poké Ball' || (sh[b] && sh[b].at <= stage)).map(b => ({ name: b, ...(sh[b] || { price: 200 }) }));
}
// The multiplier a ball gives against this Pokémon. Timer Ball: turns already passed in the battle.
function ballMult(ball, dex, turns = 0) {
  if (ball === 'Great Ball' || ball === 'Safari Ball') return 1.5;
  if (ball === 'Ultra Ball') return 2;
  if (ball === 'Repeat Ball') return isCaught(dex) ? 3 : 1;
  if (ball === 'Timer Ball') return Math.min(4, (turns + 10) / 10);
  return 1;
}

// Moves that help: accuracy in Gen 3, and who can't be hit by them
const SLEEP_MOVES = { Spore: 100, 'Sleep Powder': 75, 'Lovely Kiss': 75, Hypnosis: 60, Sing: 55, Grasswhistle: 55 };
const PARA_MOVES = { 'Thunder Wave': 100, 'Stun Spore': 75, Glare: 75 };
const TRAP_MOVES = ['Mean Look', 'Block', 'Spider Web'];
const NO_SLEEP = ['Insomnia', 'Vital Spirit'];
const SAFE_CUT = new Set(['explode', 'charge', 'recharge', 'ohko', 'counter', 'dream', 'multi', 'triple']);
const paraBlocked = (move, dex) => {
  const t = mon(dex).types;
  if (move === 'Thunder Wave' && t.includes('Ground')) return 'Ground types are immune to Thunder Wave';
  if (move === 'Glare' && t.includes('Ghost')) return "Glare can't hit Ghost types";
  return null;
};

// The moves a team member has for catching. Uses the moves set in the Battle plan; without them, the moves it
// learns by its level (flagged, since you may have replaced some).
// Lowest level a Pokémon can be at: the level it evolves at, for evolved forms
function minLevelOf(dex) {
  const from = mon(dex).evolvesFrom;
  if (!from) return 1;
  const ev = mon(from).evolutions.find(x => x.into === dex);
  return Math.max(minLevelOf(from), ev?.method === 'level' ? ev.param : 1);
}
function teamTools(n, wildLvl) {
  const b = myBattler(n, Math.max(wildLvl, minLevelOf(n))), meta = teamMeta(n), set = (meta.moves || []).filter(Boolean);
  const known = set.length ? set : [...learnedBy(n, b.level).keys()];
  return { n, b, known, guessed: !set.length };
}
// Strongest move that can't knock it out (no critical hit), and how many hits of it are safe
function safeDamage(att, worst, avg, wildMax) {
  let best = null;
  for (const name of att.known) {
    const m = state.moves[name];
    if (!m?.power || SAFE_CUT.has(m.effect) || name === 'False Swipe') continue;
    const hw = hit(att.b, worst, name), ha = hit(att.b, avg, name);
    if (!hw || !hw.max || !ha) continue;
    let k = 0;
    if (m.effect === 'half') k = 3; // Super Fang halves what's left: it can never knock it out
    else while (k < 3 && (k + 1) * hw.max < worst.hp) k++;
    if (!k) continue;
    const left = m.effect === 'half' ? 1 / 2 ** k : Math.max(1 / avg.hp, 1 - k * (ha.min + ha.max) / 2 / avg.hp);
    const crit = m.effect === 'half' || ['level', 'fixed20', 'fixed40'].includes(m.effect) ? false : hit(att.b, worst, name, true).max >= worst.hp;
    if (!best || left < best.left) best = { att, name, k, left, crit, h: ha, fixed: ['half', 'level', 'fixed20', 'fixed40'].includes(m.effect), wildMax };
  }
  return best;
}
const fmtPct = p => p >= 0.9995 ? '100%' : p < 0.01 ? `${(p * 100).toFixed(1)}%` : `${Math.round(p * 100)}%`;
const avgThrows = p => p >= 0.9995 ? 1 : p <= 0 ? Infinity : Math.round(10 / p) / 10;
const throwsFor90 = p => p >= 0.9995 ? 1 : p <= 0 ? Infinity : Math.ceil(Math.log(0.1) / Math.log(1 - p));
const throwsN = p => { const n = avgThrows(p); return n <= 1.05 ? '1 throw' : `${n < 10 ? n : Math.round(n)} throws`; };
const throwsText = p => p <= 0 ? "can't catch" : `about ${throwsN(p)}`;
const cap = x => x[0].toUpperCase() + x.slice(1);

// What the wild Pokémon itself can do to end the fight or spoil the plan
function wildRisks(dex, lvl, e) {
  const mv = defaultMoves(dex, lvl), out = [], abs = mon(dex).abilities || [];
  if (mv.includes('Teleport')) out.push(`It can <b>Teleport</b> away on its first turn. Throw a ball straight away, or put it to sleep first if your lead is faster.`);
  for (const m of ['Roar', 'Whirlwind']) if (mv.includes(m)) out.push(`It can use <b>${m}</b> to end the battle. Work fast.`);
  for (const m of ['Selfdestruct', 'Explosion']) if (mv.includes(m)) out.push(`It can use <b>${m}</b>, which faints it and ends your chance. Put it to sleep first: a sleeping Pokémon can't use it.`);
  for (const m of ['Recover', 'Softboiled', 'Milk Drink', 'Rest', 'Synthesis', 'Moonlight', 'Morning Sun']) if (mv.includes(m)) out.push(`It can heal itself with <b>${m}</b>${m === 'Rest' ? ' (it also falls asleep, which helps you)' : ''}.`);
  for (const m of ['Double Team', 'Minimize', 'Sand-attack', 'Smokescreen', 'Flash']) if (mv.includes(m)) { out.push(`It knows <b>${m}</b>, so your sleep and paralysis moves will miss more often the longer it goes.`); break; }
  const cont = { Static: 'paralyse', 'Poison Point': 'poison', 'Effect Spore': 'poison, paralyse or put to sleep', 'Flame Body': 'burn' };
  for (const a of abs) if (cont[a]) out.push(`${abs.length > 1 ? 'It may have' : 'It has'} <b>${a}</b>: moves that touch it (like False Swipe) can ${cont[a]} your Pokémon.`);
  for (const a of abs) if (NO_SLEEP.includes(a)) out.push(`${abs.length > 1 ? 'It may have' : 'It has'} <b>${a}</b> and can't be put to sleep${abs.length > 1 ? ' if so' : ''}. Use paralysis instead.`);
  if (abs.includes('Limber')) out.push(`${abs.length > 1 ? 'It may have' : 'It has'} <b>Limber</b> and can't be paralysed${abs.length > 1 ? ' if so' : ''}.`);
  if (abs.includes('Shed Skin')) out.push(`It has <b>Shed Skin</b> and can shake off sleep or paralysis at the end of a turn. Throw as soon as it has a status.`);
  if (abs.includes('Soundproof')) out.push(`${abs.length > 1 ? 'It may have' : 'It has'} <b>Soundproof</b>: Sing and Grasswhistle won't work.`);
  if (e?.method === 'roaming') out.push(`It's a <b>roaming</b> Pokémon: it flees on its first turn. Trap it with Mean Look or Block, or put it to sleep or paralyse it first. Its HP and status stay as you left them when it runs, so you can wear it down over several meetings.`);
  if (e && ['static', 'roaming'].includes(e.method)) out.push(`<b>Save first</b>, so you can reset and try again if it faints.`);
  return out;
}

// Pokémon you can have by now that could put it to sleep, paralyse it or False Swipe it, for when your team can't
function helpers(stage, lvl, mustOutspeed) {
  const out = [], team = new Set(cur().team);
  for (const c of catchableBy(stage)) {
    const from = { dex: c.dex, level: catchLevel(c) }, level = Math.max(lvl, from.level);
    for (const f of evoForms(c.dex, level, stage)) {
      if (LEGENDARY.has(c.dex) || LEGENDARY.has(f.dex) || team.has(f.dex) || (mustOutspeed && calcStats(f.dex, level, PLAYER_IV)[5] <= mustOutspeed)) continue;
      const learned = learnedBy(f.dex, level, from);
      const pick = ['False Swipe', ...Object.keys(SLEEP_MOVES), ...Object.keys(PARA_MOVES)].find(m => learned.has(m));
      if (pick) out.push({ c, f, move: pick, at: learned.get(pick).level, rank: pick === 'False Swipe' ? 0 : SLEEP_MOVES[pick] ? 1 - SLEEP_MOVES[pick] / 1000 : 2 });
    }
  }
  const seen = new Set();
  return out.sort((a, b) => a.rank - b.rank || a.c.stage - b.c.stage).filter(x => !seen.has(x.move) && seen.add(x.move)).slice(0, 4);
}

function renderCatchPlan(locId, dexArg) {
  const dex = parseInt(dexArg, 10);
  if (!mon(dex)) return renderHome();
  const p = mon(dex);
  const loc = state.locations[locId] || state.locations[state.found[dex]?.[0]?.loc];
  // the link can name the method (#/catch/route-25/60.super-rod): fishing with a better rod comes later in the story
  const how = String(dexArg).split('.')[1];
  const here = loc ? loc.encounters.filter(x => x.dex === dex) : [];
  const e = here.find(x => inVersion(x) && (!how || x.method === how)) || here.find(x => inVersion(x)) || here[0];
  setHeader(`Catch ${p.name}`, true, 'routes');
  const [lo, hi] = String(e?.levels || '5').split('-').map(x => parseInt(x, 10));
  const minL = lo || 5, maxL = hi || minL, midL = Math.round((minL + maxL) / 2);
  const stage = Math.max(loc ? (e ? encStage(loc.id, e) : stageOf(loc.id)) : 0, currentStage());
  const rate = p.catchRate || 0;
  let html = `<div class="card"><b>${esc(p.name)}</b> ${types(dex)}${infoLink(dex)}
    <div class="note">${loc ? `<a href="#/loc/${loc.id}">${esc(loc.name)}</a>` : ''}${e ? ` · ${esc(METHOD_LABEL[e.method] || e.method)}${e.levels ? ` · Lv ${esc(e.levels)}` : ''}${e.rate ? ` · ${esc(e.rate)}` : ''}` : ''}</div>
    <p class="note">Catch rate <b>${rate}</b> of 255 (${rate >= 190 ? 'easy' : rate >= 100 ? 'fairly easy' : rate >= 45 ? 'average' : rate >= 25 ? 'hard' : 'very hard'}).${isCaught(dex) ? ' You have one already.' : ''}</p></div>`;

  // Safari Zone: no battling, so only Safari Balls, rocks and bait
  if (loc?.id === 'safari-zone') {
    const c = catchChance(rate, 1.5, 1, 1), flee = Math.min(100, Math.floor((p.safariFlee || 0) * 100 / 1275) * 5);
    const rock = catchChance(Math.min(255, rate * 2), 1.5, 1, 1);
    html += `<h2>Safari Zone plan</h2><div class="card"><table class="mini"><tr><td>Safari Ball, each throw</td><td><b>${fmtPct(c)}</b> (${throwsText(c)})</td></tr>
      <tr><td>Chance it runs each turn</td><td><b>about ${flee}%</b></td></tr><tr><td>After a rock</td><td>about ${fmtPct(rock)} a throw, but it runs about twice as often</td></tr></table>
      <p class="note"><b>Recommended:</b> ${flee >= 40 && c < 0.3 ? 'it runs often, so throw a Safari Ball every turn and hope. Rocks make it run even sooner.' : flee <= 15 ? "it rarely runs, so a rock first, then Safari Balls, gives the best odds." : 'throw Safari Balls every turn. Bait makes it stay longer but halves the odds, so it rarely helps.'}
      You get 30 Safari Balls and 600 steps a visit. You can't battle or use your own balls here.</p></div>`;
    view.innerHTML = html;
    return;
  }

  const worst = battler(dex, minL, 0, []), avg = battler(dex, midL, 15, []);
  const balls = ballsBy(stage);
  const tools = cur().team.map(n => teamTools(n, maxL));
  const name = n => esc(mon(n).name);
  const guess = t => t.guessed ? ' <span class="note">(if it still knows it)</span>' : '';

  // What your team can do: False Swipe, sleep, paralysis, a safe weakening move
  const teleports = defaultMoves(dex, maxL).includes('Teleport');
  const swipe = tools.find(t => t.known.includes('False Swipe'));
  const sleepOpts = [], paraOpts = [];
  const sleepBlocked = (mon(dex).abilities || []).length === 1 && NO_SLEEP.includes(mon(dex).abilities[0]);
  const paraBlockedAb = (mon(dex).abilities || []).length === 1 && mon(dex).abilities[0] === 'Limber';
  for (const t of tools) for (const mv of t.known) {
    if (SLEEP_MOVES[mv] && !sleepBlocked && !(mv === 'Sing' || mv === 'Grasswhistle' ? (mon(dex).abilities || []).length === 1 && mon(dex).abilities[0] === 'Soundproof' : false)) sleepOpts.push({ t, mv, acc: SLEEP_MOVES[mv] });
    if (PARA_MOVES[mv] && !paraBlockedAb && !paraBlocked(mv, dex)) paraOpts.push({ t, mv, acc: PARA_MOVES[mv] });
  }
  sleepOpts.sort((a, b) => b.acc - a.acc); paraOpts.sort((a, b) => b.acc - a.acc);
  const sleep = sleepOpts[0], para = paraOpts[0];
  const dmg = tools.map(t => safeDamage(t, worst, avg, maxL)).filter(Boolean).sort((a, b) => a.left - b.left)[0];
  const trap = tools.find(t => t.known.some(m => TRAP_MOVES.includes(m)));
  const hpBest = swipe ? 1 / avg.hp : dmg ? dmg.left : 1;
  const status = sleep ? 2 : para ? 1.5 : 1;

  // Odds table: each ball you can buy by now, in the usual situations
  const red = Math.max(1 / avg.hp, 0.2);
  const rows = [['Full HP', 1, 1], ['Full HP, asleep', 1, 2], ['Red HP (about 1/5)', red, 1], ['Red HP, paralysed', red, 1.5], ['Red HP, asleep', red, 2], ['1 HP, asleep', 1 / avg.hp, 2]];
  const cell = (b, hp, st, turns) => { const c = catchChance(rate, ballMult(b.name, dex, turns), hp, st); return `<b>${fmtPct(c)}</b><div class="note">${avgThrows(c) === Infinity ? '—' : `~${throwsN(c)}`}</div>`; };
  const ballHead = b => `${esc(b.name)}${b.name === 'Repeat Ball' ? `<div class="note">${isCaught(dex) ? '3×: you have one' : 'no bonus yet'}</div>` : b.name === 'Timer Ball' ? '<div class="note">turn 1</div>' : ''}`;
  html += `<h2>Balls you can buy by now</h2><div class="card"><p class="note">Shops by ${esc(state.index[Math.min(state.index.length - 1, Math.floor(stage))].name)} in the story sell: ${balls.map(b => `${esc(b.name)} (${money(b.price)}${b.loc ? `, ${esc(state.locations[b.loc]?.name || b.loc)}` : ''})`).join(', ')}.</p>
    <div class="scrollx"><table class="mini catchtbl"><tr><th></th>${balls.map(b => `<th>${ballHead(b)}</th>`).join('')}</tr>
    ${rows.map(([label, hp, st]) => `<tr><td>${label}</td>${balls.map(b => `<td>${cell(b, hp, st, 0)}</td>`).join('')}</tr>`).join('')}</table></div>
    <p class="note">Each throw's chance, from the game's own formula. "~N throws" is the average. Its HP doesn't need to be exactly red: the lower the better, and 1 HP is the most it can help.</p></div>`;

  // Your team's tools
  let tl = '';
  if (!tools.length) tl = `<p class="note">Add your team in the <a href="#/planner">Battle plan</a> and this plan uses their moves.</p>`;
  else {
    const li = [];
    if (swipe) li.push(`<b>${name(swipe.n)}</b>'s False Swipe${guess(swipe)}: always leaves it with at least 1 HP, so use it until it's at 1 HP.`);
    if (dmg && !swipe) li.push(`<b>${name(dmg.att.n)}</b>'s ${esc(dmg.name)}${guess(dmg.att)}: ${dmg.name === 'Super Fang' ? 'halves its HP each time and can never knock it out' : dmg.fixed ? `does ${dmg.h.max} damage a hit` : `takes ${hpPct(dmg.h, avg)} a hit`}, so ${dmg.k === 1 ? 'one hit is' : `up to ${dmg.k} hits are`} safe and leave it at about ${Math.round(dmg.left * 100)}% HP.${dmg.crit ? ' A critical hit (1 in 16) could still knock it out.' : ''}`);
    if (sleep) li.push(`<b>${name(sleep.t.n)}</b>'s ${esc(sleep.mv)}${guess(sleep.t)} (${sleep.acc}% accurate): sleep doubles your odds. It lasts 1 to 4 turns, so use it again when it wakes up.`);
    if (para) li.push(`<b>${name(para.t.n)}</b>'s ${esc(para.mv)}${guess(para.t)} (${para.acc}% accurate): paralysis gives 1.5× and never wears off.`);
    if (trap) li.push(`<b>${name(trap.n)}</b>'s ${esc(trap.known.find(m => TRAP_MOVES.includes(m)))}${guess(trap)}: stops it running away.`);
    if (!li.length) li.push("Nobody on your team has a safe way to weaken it or a sleep or paralysis move. Your weakest attack still helps; see the Pokémon you could catch below.");
    tl = `<ul class="tips">${li.map(x => `<li>${x}</li>`).join('')}</ul>${tools.some(t => t.guessed) ? '<p class="note">Moves marked "if it still knows it" are guesses from its level. Set real moves in the <a href="#/planner">Battle plan</a>.</p>' : ''}`;
    if (tools.some(t => t.b.guessedLevel)) tl += `<p class="note">Levels not set in the Battle plan are taken as Lv ${maxL}.</p>`;
  }
  html += `<h2>What your team can do</h2><div class="card">${tl}</div>`;

  // A plan for each ball
  const steps = [];
  const wm = defaultMoves(dex, maxL);
  const risky = wm.some(m => ['Teleport', 'Selfdestruct', 'Explosion', 'Roar', 'Whirlwind'].includes(m)) || e?.method === 'roaming';
  const weaken = swipe ? `use ${name(swipe.n)}'s False Swipe until it's at 1 HP` : dmg ? `hit it ${dmg.k === 1 ? 'once' : `up to ${dmg.k} times`} with ${name(dmg.att.n)}'s ${esc(dmg.name)}` : null;
  const statusStep = sleep ? `put it to sleep with ${name(sleep.t.n)}'s ${esc(sleep.mv)}` : para ? `paralyse it with ${name(para.t.n)}'s ${esc(para.mv)}` : null;
  // A Pokémon that teleports on its first turn: only a faster sleep or paralysis move beats it, otherwise throw at once
  const stopper = sleep || para;
  const outspeeds = stopper && stopper.t.b.st[5] > avg.st[5];
  if (teleports) { if (outspeeds) steps.push(`lead with ${name(stopper.t.n)} and ${statusStep} on the first turn (it's faster)`); }
  else if (risky && statusStep) steps.push(`${statusStep} first, before it can get away`, weaken);
  else steps.push(weaken, statusStep);
  const planSteps = steps.filter(Boolean);
  const hpUsed = teleports ? 1 : hpBest, stUsed = teleports && !outspeeds ? 1 : status;
  const plain = b => catchChance(rate, ballMult(b.name, dex), 1, 1);
  const bestP = b => catchChance(rate, ballMult(b.name, dex, b.name === 'Timer Ball' ? planSteps.length : 0), hpUsed, stUsed);
  const join = list => cap(list.join(', then '));
  const cards = balls.map(b => {
    const p0 = plain(b), p1 = bestP(b), n90 = throwsFor90(p1);
    let text;
    if (teleports && !planSteps.length) text = `Throw on your very first turn: it will most likely Teleport away after that. That's ${fmtPct(p0)} a throw, so expect to meet a few before one stays in the ball.`;
    else if (p0 >= 0.75) text = `Just throw: it's already ${fmtPct(p0)} a throw at full HP.${p1 > p0 + 0.05 && planSteps.length ? ` ${join(planSteps)} for ${fmtPct(p1)} if you want to be sure.` : ''}`;
    else if (!planSteps.length) text = `With nothing to weaken it safely or make it sleep, it's ${fmtPct(p0)} a throw (${throwsText(p0)}).`;
    else text = `${join(planSteps)}, then throw. That's <b>${fmtPct(p1)}</b> a throw (${throwsText(p1)}), up from ${fmtPct(p0)} at full HP.`;
    if (b.name === 'Repeat Ball' && !isCaught(dex)) text += ' No bonus until you have caught one, so a Great or Ultra Ball is better.';
    if (b.name === 'Timer Ball') {
      const t10 = catchChance(rate, 2, hpUsed, stUsed), t30 = catchChance(rate, 4, hpUsed, stUsed);
      text += ` It gets better the longer the battle goes: ${fmtPct(t10)} after 10 turns, ${fmtPct(t30)} after 30. Best for long fights with hard catches.`;
    }
    const buy = Number.isFinite(n90) ? ` Bring <b>${n90}</b> to be 90% sure (${money(n90 * b.price)}).` : '';
    return { b, p1, html: `<div class="card"><b>${b.name === 'Poké Ball' ? 'If you only have Poké Balls' : `With ${esc(b.name)}s`}</b><p>${text}${buy}</p></div>` };
  });
  const usable = cards.filter(c => c.p1 > 0 && (c.b.name !== 'Repeat Ball' || isCaught(dex)));
  const fewest = usable.slice().sort((a, b) => b.p1 - a.p1)[0], cheapest = usable.slice().sort((a, b) => a.b.price / a.p1 - b.b.price / b.p1)[0];
  html += `<h2>Recommended plan</h2>`;
  // the cheapest ball is worth suggesting only when it doesn't take far more throws
  const alsoCheap = cheapest && cheapest !== fewest && fewest.p1 / cheapest.p1 <= 1.5;
  if (fewest) html += `<div class="card good-card"><p><b>${fewest.b.name === cheapest.b.name ? `Use ${esc(fewest.b.name)}s: fewest throws and cheapest per catch.` : `Use ${esc(fewest.b.name)}s: fewest throws.${alsoCheap ? ` ${esc(cheapest.b.name)}s take a few more throws but cost less per catch (about ${money(Math.round(cheapest.b.price / cheapest.p1))} against ${money(Math.round(fewest.b.price / fewest.p1))}).` : ''}`}</b></p>
    <ol class="steps">${planSteps.map(x => `<li>${cap(x)}.</li>`).join('')}<li>Throw ${esc(fewest.b.name)}s${teleports && !planSteps.length ? ' on your first turn' : ''}${sleep && planSteps.length ? ', and put it back to sleep when it wakes up' : ''}. About ${fmtPct(fewest.p1)} a throw.</li></ol></div>`;
  html += cards.map(c => c.html).join('');

  const risks = wildRisks(dex, maxL, e);
  if (risks.length) html += `<h2>Watch out for</h2><div class="card"><ul class="tips">${risks.map(x => `<li>${x}</li>`).join('')}</ul></div>`;

  // Helpers you could catch if your team lacks the tools
  if (!swipe && !sleep) {
    const hs = helpers(stage, maxL, teleports ? avg.st[5] : 0);
    if (hs.length) html += `<h2>Pokémon that would help</h2><div class="card"><p class="note">You can have these by now. Each learns a move that makes catching easier.</p>${hs.map(h =>
      `<div class="row"><span><a href="#/mon/${h.f.dex}">${name(h.f.dex)}</a> <span class="note">· ${esc(h.move)} at Lv ${h.at}${h.f.dex !== h.c.dex ? ` · evolve ${name(h.c.dex)} (${esc(h.f.via.join(', '))})` : ''} · catch at <a href="#/loc/${h.c.loc}">${esc(h.c.name)}</a></span></span></div>`).join('')}</div>`;
  }
  html += `<p class="note">Odds use the Gen 3 catch formula from the game code. Damage uses your Battle plan levels and moves against a wild ${esc(p.name)} with average stats. Only balls sold in shops by this point in the story are planned for.</p>`;
  view.innerHTML = html;
}
const catchLink = (locId, dex, method) => ` <a class="tag catchlink" href="#/catch/${locId}/${dex}${method ? `.${method}` : ''}" aria-label="Catch plan for ${esc(mon(dex).name)}">Catch plan</a>`;
Object.assign(PAGES, { catch: renderCatchPlan });
