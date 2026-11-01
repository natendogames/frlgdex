'use strict';
// Team planner: finds the most viable six-Pokémon team for a FireRed or LeafGreen playthrough with the app's own
// battle engine, and writes a guide (where to catch each member, when it evolves, its moves over the game including
// TMs and HMs). Run with: node scripts/team_planner.js [--out docs/team-guide.md] [--json out.json]
//
// Model (same rules as the Battle plan tab, plus TMs):
// - Every trainer up to and including the Champion, in story order, at the point you can fight them (battleStage).
// - Your Pokémon are at the level of the trainer's strongest Pokémon (or the level you caught them at if higher),
//   with average IVs and no EVs. A team member only helps once you could have caught it by then.
// - Evolutions by level, and stones once Celadon sells them; no trade evolutions.
// - Moves: the strongest attack of each type it can know by then (level-up moves, the Move Reminder from Two Island,
//   and TMs/HMs you can have by then), best four. Found and gifted TMs are single use, so each goes to one member;
//   bought and Game Corner TMs can go to everyone.
// - A team "answers" a foe Pokémon when one member wins the one-on-one damage race (engine duel()).
// Scoring: share of each trainer's Pokémon answered (Gym Leaders, rivals, Giovanni, Elite Four and Champion count
// 4×), a bonus for answering in one hit, a penalty for any type that hits three or more members super effectively,
// and a bonus for covering the HMs the story needs (Cut, Strength, Surf, Rock Smash) without a spare HM user.
const fs = require('fs'), path = require('path');
const { loadApp } = require('../tests/harness');

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const KEY_WEIGHT = 4;
const PHYS = new Set(['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel']);
const STORY_HMS = ['HM01', 'HM04', 'HM03', 'HM06']; // Cut, Strength, Surf, Rock Smash; Flash and Fly are optional

(async () => {
  const app = await loadApp();
  const { state, mon, stageOf, catchableBy, evoForms, learnedBy, battler, duel, foeBattler, moveScore, relearnAt, catchLevel, battleStage, lineOf, eff, STARTER_BASE } = app;
  const ROOT = path.join(__dirname, '..');
  const tms = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tms.json'), 'utf8'));
  const LEAGUE = stageOf('pokemon-league');
  const keyIds = new Set(state.trainers.map(t => t.id));
  const locName = id => state.index[stageOf(id)].name;

  // When each TM is first in hand. Surf is handed over in the Safari Zone; the Game Corner and the Department
  // Store open at Celadon.
  const tmStage = {}, tmSource = {};
  // A Gym Leader's TM comes when you can beat them (Giovanni's Earthquake is the eighth badge, not Viridian on day one).
  // The Cerulean Rocket Grunt only shows up after you visit Bill on Route 25.
  function srcStage(x) {
    if (x.loc === 'cerulean-city' && /Rocket Grunt/.test(x.from || '')) return stageOf('route-25');
    const t = x.from && (state.locations[x.loc].trainers || []).find(t => t.class === 'Leader' && x.from.startsWith(t.name));
    return t ? battleStage(t, x.loc) : stageOf(x.loc);
  }
  for (const [k, t] of Object.entries(tms)) {
    const s = t.sources.map(x => ({ ...x, stage: srcStage(x) })).sort((a, b) => a.stage - b.stage)[0];
    if (!s) continue;
    tmStage[k] = s.stage; tmSource[k] = t.sources;
  }
  // Game Corner TMs cost 3,500-4,500 coins (about ₽70,000-90,000 each), so plan on one of each; store TMs are cheap and HMs reusable.
  for (const [k, t] of Object.entries(tms)) t.reusable = k.startsWith('HM') || t.sources.some(x => x.how === 'buy');
  const tmOfMove = {};
  for (const [k, t] of Object.entries(tms)) if (tmStage[k] !== undefined) (tmOfMove[t.move] ||= []).push(k);
  const tmWhere = k => tmSource[k].map(s => `${locName(s.loc)}${s.where && s.where !== 'Outside' ? ' (' + s.where + ')' : ''}${s.cost ? ', ' + s.cost : ''}${s.from && s.how === 'gift' ? ', from ' + s.from : ''}`).join('; or ');

  for (const V of ['FR', 'LG']) for (const starter of Object.keys(STARTER_BASE)) await plan(V, starter);
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(RESULTS, null, 1));
  if (opt('--out')) fs.writeFileSync(opt('--out'), guide());
  else console.log(guide());

  async function plan(V, starter) {
    state.progress.version = V;
    state.progress.saves[V] = { caught: {}, checks: {}, team: [], picks: { starter } };
    // every trainer through the Champion, in the order you fight them
    const battles = [];
    state.index.forEach((l, i) => {
      for (const t of state.locations[l.id].trainers || []) {
        const party = t.party || t.byStarter?.[starter];
        if (!party) continue;
        const stage = battleStage(t, l.id);
        if (stage > LEAGUE) continue;
        battles.push({ t, loc: l.id, stage, order: i + (t.stage ? 0.5 : 0), party, key: keyIds.has(t.id), level: Math.max(...party.map(p => p.level)) });
      }
    });
    battles.sort((a, b) => a.stage - b.stage || a.order - b.order);
    const foes = [];
    battles.forEach((b, bi) => b.party.forEach(p => foes.push({ bi, p, b: foeBattler(p), w: (b.key ? KEY_WEIGHT : 1) / b.party.length })));

    // candidates: the starter, plus every catch you can make before the League and every non-trade form it reaches
    const avail = catchableBy(LEAGUE).filter(c => c.stage <= LEAGUE);
    const sources = [{ dex: STARTER_BASE[starter], stage: 0, loc: 'pallet-town', method: 'gift', levels: '5', name: 'Pallet Town' }, ...avail];
    const cands = [];
    for (const c of sources) {
      const forms = evoForms(c.dex, 100, LEAGUE);
      const finals = forms.filter(f => !forms.some(g => g.via.length > f.via.length && lineOf(g.dex).includes(f.dex)));
      for (const f of finals) cands.push({ id: cands.length, c, final: f.dex, path: lineOf(f.dex).slice(lineOf(f.dex).indexOf(c.dex)), starter: c === sources[0] });
    }

    // the form, level and moves a candidate has at a battle
    const cache = new Map();
    // Level-up moves this member can know. Like the engine's learnedBy(), except a stone evolution happens when the plan
    // evolves it (the first battle after Celadon, where stones are sold), so Staryu's Lv 46 Hydro Pump doesn't carry
    // over to a Starmie evolved at Lv 22.
    const stoneLv = {};
    function movesKnown(cd, dex, level, from, relearn) {
      const line = cd.path.slice(0, cd.path.indexOf(dex) + 1), out = new Map();
      const add = (mv, l) => { if (!out.has(mv)) out.set(mv, { level: l }); };
      for (const mv of app.defaultMoves(line[0], from.level)) add(mv, from.level);
      let since = from.level;
      line.forEach((d, i) => {
        const next = line[i + 1], evo = next && mon(d).evolutions.find(e => e.into === next);
        let until = level;
        if (evo) until = Math.min(level, evo.method === 'level' ? evo.param : (stoneLv[cd.id] ??= firstStoneLevel(cd, from)));
        for (const [l, mv] of mon(d).learnset || []) if (l <= until && (i === 0 ? l > since : l >= since)) add(mv, l);
        if (evo) since = Math.max(since, until);
      });
      if (relearn) for (const [l, mv] of mon(dex).learnset || []) if (l <= level) add(mv, l);
      return out;
    }
    function firstStoneLevel(cd, from) {
      const b = battles.find(b => b.stage >= Math.max(cd.c.stage, stageOf('celadon-city')));
      return Math.max(from.level, b ? b.level : 100);
    }
    function at(cd, b, banned) {
      if (cd.c.stage > b.stage) return null;
      const key = cd.id + ':' + b.stage + ':' + b.level + ':' + (banned ? [...banned].sort().join() : '');
      if (cache.has(key)) return cache.get(key);
      const from = { dex: cd.c.dex, level: cd.starter ? 5 : catchLevel(cd.c) }, level = Math.max(b.level, from.level);
      const forms = evoForms(cd.c.dex, level, b.stage).filter(f => cd.path.includes(f.dex));
      const dex = forms.sort((a, z) => z.via.length - a.via.length)[0].dex;
      const relearn = b.stage >= relearnAt();
      const learned = movesKnown(cd, dex, level, from, relearn);
      const pool = new Map([...learned.keys()].map(m => [m, { how: 'level', level: learned.get(m).level }]));
      const line = cd.path.slice(0, cd.path.indexOf(dex) + 1);
      for (const [k, t] of Object.entries(tms)) {
        if (tmStage[k] === undefined || tmStage[k] + (k === 'HM03' ? 0.5 : 0) > b.stage || banned?.has(k)) continue;
        if (!line.some(d => mon(d).tmhm?.includes(k))) continue;
        if (!pool.has(t.move)) pool.set(t.move, { how: 'tm', tm: k });
      }
      const best = {};
      for (const name of pool.keys()) {
        // weigh by the attacking stat the move uses, so a physical attacker doesn't pick special TMs
        const st = battler(dex, level, 15, []).st;
        const sc = moveScore(dex, level, name) * (PHYS.has(state.moves[name]?.type) ? st[1] : st[3]) / 100, ty = name === 'Low Kick' ? name : state.moves[name]?.type;
        if (sc && (!best[ty] || sc > best[ty].sc || (sc === best[ty].sc && pool.get(name).how === 'level'))) best[ty] = { name, sc };
      }
      let moves = Object.values(best).sort((a, z) => z.sc - a.sc).slice(0, 4).map(x => x.name);
      if (!moves.length) moves = [...learned.keys()].slice(-4);
      const out = { dex, level, moves, src: Object.fromEntries(moves.map(m => [m, pool.get(m)])), me: battler(dex, level, 15, moves) };
      cache.set(key, out);
      return out;
    }
    // value of one candidate against each foe Pokémon
    function values(cd, banned) {
      return foes.map(f => {
        const s = at(cd, battles[f.bi], banned);
        if (!s) return 0;
        const d = duel(s.me, f.b);
        return d.wins ? 1 + (d.myHits === 1 ? 0.25 : 0) + (d.faster ? 0.1 : 0) : 0;
      });
    }
    const V0 = cands.map(cd => values(cd));
    const starterIds = cands.filter(cd => cd.starter).map(cd => cd.id);
    const finalTypes = cd => mon(cd.final).types;
    const clash = (a, b) => a.path.some(d => b.path.includes(d)) || lineOf(a.final)[0] === lineOf(b.final)[0]
      || (a.c.loc === b.c.loc && a.c.method === 'gift' && b.c.method === 'gift' && ['saffron-city', 'cinnabar-island'].includes(a.c.loc) && a.c.dex !== b.c.dex && [106, 107, 138, 140].includes(a.c.dex) && [106, 107, 138, 140].includes(b.c.dex))
      || (lineOf(a.final)[0] === 133 && lineOf(b.final)[0] === 133); // one Eevee
    function score(team, vals = V0) {
      let s = 0;
      for (let j = 0; j < foes.length; j++) { let m = 0; for (const k of team) if (vals[k][j] > m) m = vals[k][j]; s += m * foes[j].w; }
      // shared weaknesses
      let pen = 0;
      for (const ty of Object.keys(state.types)) {
        const n = team.filter(k => eff(ty, finalTypes(cands[k])) > 1).length;
        if (n >= 3) pen += (n - 2) * 4;
      }
      const hms = STORY_HMS.filter(h => team.some(k => cands[k].path.some(d => mon(d).tmhm?.includes(h)))).length;
      return s - pen + hms * 2;
    }
    // search: greedy build from the starter, then swap one slot at a time until nothing improves; a few restarts
    const ok = (team, k) => !team.some(x => clash(cands[x], cands[k]));
    let best = null;
    for (const st of starterIds) {
      for (let restart = 0; restart < 6; restart++) {
        let team = [st];
        while (team.length < 6) {
          const opts = cands.filter(cd => !cd.starter && ok(team, cd.id)).map(cd => ({ k: cd.id, s: score([...team, cd.id]) })).sort((a, b) => b.s - a.s);
          team.push(opts[Math.min(restart === 0 ? 0 : Math.floor(rand() * 3), opts.length - 1)].k);
        }
        let improved = true;
        while (improved) {
          improved = false;
          for (let i = 1; i < 6; i++) {
            const base = score(team);
            for (const cd of cands) {
              if (cd.starter) continue;
              const rest = team.filter((_, j) => j !== i);
              if (!ok(rest, cd.id)) continue;
              const t2 = [...team]; t2[i] = cd.id;
              if (score(t2) > base + 1e-9) { team = t2; improved = true; break; }
            }
          }
        }
        const s = score(team);
        if (!best || s > best.s) best = { team: [...team], s };
      }
    }
    // hand out single-use TMs: when two members want the same one, the one who'd lose most keeps it
    const banned = Object.fromEntries(best.team.map(k => [k, new Set()]));
    const tmUse = () => {
      const use = {};
      for (const k of best.team) for (const b of battles) { const s = at(cands[k], b, banned[k]); if (s) for (const m of s.moves) { const src = s.src[m]; if (src.how === 'tm' && !tms[src.tm].reusable) (use[src.tm] ||= new Set()).add(k); } }
      return use;
    };
    for (let guard = 0; guard < 40; guard++) {
      const conflict = Object.entries(tmUse()).find(([, ks]) => ks.size > 1);
      if (!conflict) break;
      const [tm, ks] = conflict;
      const vals = Object.fromEntries(best.team.map(k => [k, values(cands[k], banned[k])]));
      let keep = null, keepLoss = -1;
      for (const k of ks) {
        const others = [...ks].filter(x => x !== k);
        const trial = { ...vals };
        for (const o of others) trial[o] = values(cands[o], new Set([...banned[o], tm]));
        const s = score(best.team, Object.assign([], trial));
        if (s > keepLoss) { keepLoss = s; keep = k; }
      }
      for (const k of ks) if (k !== keep) banned[k].add(tm);
    }
    // drop TMs that don't change any result, most expensive first, so the plan only spends coins and single-use TMs
    // where they matter (the engine otherwise fills empty move slots with any attack of a new type)
    const cost = k => tms[k].sources.some(x => x.how === 'prize') ? 0 : !tms[k].reusable ? 1 : k.startsWith('TM') ? 2 : 3;
    const curVals = Object.fromEntries(best.team.map(k => [k, values(cands[k], banned[k])]));
    for (const k of best.team) {
      const used = new Set();
      for (const b of battles) { const s = at(cands[k], b, banned[k]); if (s) for (const m of s.moves) if (s.src[m].how === 'tm') used.add(s.src[m].tm); }
      for (const tm of [...used].sort((a, b) => cost(a) - cost(b))) {
        const before = score(best.team, Object.assign([], curVals));
        const trialBan = new Set([...banned[k], tm]), trial = values(cands[k], trialBan);
        if (score(best.team, Object.assign([], { ...curVals, [k]: trial })) >= before - 0.05) { banned[k] = trialBan; curVals[k] = trial; }
      }
    }
    const finalVals = []; for (const k of best.team) finalVals[k] = values(cands[k], banned[k]);
    const total = score(best.team, finalVals);
    // per battle report
    const keyRows = [], misses = [];
    let answered = 0, foeCount = 0, keyAnswered = 0, keyCount = 0;
    battles.forEach((b, bi) => {
      const rows = b.party.map(p => {
        const fb = foeBattler(p);
        const opts = best.team.map(k => { const s = at(cands[k], b, banned[k]); return s && { k, s, d: duel(s.me, fb) }; }).filter(Boolean)
          .sort((x, y) => y.d.wins - x.d.wins || x.d.myHits - y.d.myHits || y.d.theirHits - x.d.theirHits);
        const top = opts[0];
        foeCount++; if (b.key) keyCount++;
        if (top?.d.wins) { answered++; if (b.key) keyAnswered++; } else misses.push({ b, p, top });
        return { p, top };
      });
      if (b.key) keyRows.push({ b, rows });
    });
    // move timeline per member at each key battle, plus its first availability
    const members = [...best.team].sort((a, b) => cands[a].c.stage - cands[b].c.stage).map(k => {
      const cd = cands[k];
      const steps = [];
      let prev = null, lvl = 0;
      for (const b of battles) {
        const s = at(cd, b, banned[k]);
        if (!s || s.level < lvl) continue;
        lvl = s.level;
        const sig = s.dex + '|' + s.moves.join(',');
        if (sig !== prev && (b.key || !prev)) { steps.push({ b, s }); prev = sig; }
      }
      const final = at(cd, { stage: LEAGUE, level: battles[battles.length - 1].level }, banned[k]);
      const hms = ['HM01', 'HM02', 'HM03', 'HM04', 'HM05', 'HM06', 'HM07'].filter(h => cd.path.some(d => mon(d).tmhm?.includes(h)));
      return { cd, steps, final, hms, vals: finalVals[k] };
    });
    RESULTS.push({ V, starter, total, best, members, keyRows, misses, answered, foeCount, keyAnswered, keyCount, battles,
      runnersUp: runnerUps(best.team) });

    function runnerUps(team) {
      // the best replacement for each slot, to show how close the alternatives are
      return team.slice(1).map((k, i) => {
        const rest = team.filter(x => x !== k);
        const alt = cands.filter(cd => !cd.starter && cd.id !== k && ok(rest, cd.id)).map(cd => ({ cd, s: score([...rest, cd.id]) })).sort((a, b) => b.s - a.s)[0];
        return { k, alt: alt?.cd, loss: score(team) - (alt?.s ?? 0) };
      });
    }
  }

  function guide() {
    const out = [];
    const nm = d => mon(d).name;
    const how = c => c.method === 'gift' && c.loc === 'pallet-town' ? "Professor Oak's Lab (your starter)" : `${locName(c.loc)}, ${c.method === 'gift' ? 'gift' : c.method}${c.levels ? ' (Lv ' + c.levels + ')' : ''}${c.later ? ', once you can (needs ' + c.method + ')' : ''}`;
    out.push('# Most viable team: FireRed and LeafGreen', '',
      'Generated by `node scripts/team_planner.js` from the app\'s own data (trainer parties and moves from the pret/pokefirered decomp) and battle engine. ' +
      'See the comment at the top of the script for the model and scoring.', '');
    for (const r of RESULTS) {
      out.push(`## ${r.V === 'FR' ? 'FireRed' : 'LeafGreen'}, ${r.starter}`, '');
      out.push(`Answers ${r.answered} of ${r.foeCount} trainer Pokémon (${Math.round(100 * r.answered / r.foeCount)}%) one-on-one; key battles ${r.keyAnswered} of ${r.keyCount}.`, '');
      for (const m of r.members) {
        const cd = m.cd;
        out.push(`### ${nm(cd.final)}${cd.path.length > 1 ? ' (' + cd.path.map(nm).join(' → ') + ')' : ''}`, '');
        out.push(`- Get it: ${how(cd.c)}`);
        const evo = [];
        for (let i = 0; i + 1 < cd.path.length; i++) { const e = mon(cd.path[i]).evolutions.find(x => x.into === cd.path[i + 1]); evo.push(`${nm(cd.path[i + 1])} at ${e.method === 'level' ? 'Lv ' + e.param : e.param}`); }
        if (evo.length) out.push(`- Evolves: ${evo.join(', ')}`);
        out.push(`- HMs it can carry: ${m.hms.map(h => tms[h].move).join(', ') || 'none'}`);
        out.push(`- Moves over the game:`);
        for (const st of m.steps) {
          const label = st.b.key ? `${st.b.t.name || st.b.t.class} (${locName(st.b.loc)})` : `when you get it`;
          out.push(`  - ${label}, Lv ${st.s.level} ${nm(st.s.dex)}: ${st.s.moves.map(mv => { const s = st.s.src[mv]; return s.how === 'tm' ? `${mv} (${s.tm})` : mv; }).join(', ')}`);
        }
        const tmsUsed = new Set(); for (const st of m.steps) for (const mv of st.s.moves) if (st.s.src[mv].how === 'tm') tmsUsed.add(st.s.src[mv].tm);
        for (const k of tmsUsed) out.push(`  - ${k} ${tms[k].move}: ${tmWhere(k)}${tms[k].reusable ? '' : ' (single use)'}`);
        out.push('');
      }
      out.push('Key battles (best lead per Pokémon):', '');
      for (const kr of r.keyRows) {
        out.push(`- ${kr.b.t.name || kr.b.t.class} (${locName(kr.b.loc)}): ` + kr.rows.map(x => `${x.p.name} ${x.p.level} → ${x.top ? nm(x.top.s.dex) + (x.top.d.wins ? '' : ' (no clean win)') + ' ' + (x.top.d.mine?.name || '') : 'nobody yet'}`).join('; '));
      }
      out.push('', 'Not answered one-on-one: ' + (r.misses.map(x => `${x.p.name} ${x.p.level} (${x.b.t.class === 'Rival' ? 'Rival' : x.b.t.class + ' ' + (x.b.t.name || '')}, ${locName(x.b.loc)})`).join('; ') || 'none'));
      out.push('', 'Closest alternative for each slot: ' + r.runnersUp.map(x => `${nm(r.best.team.length && RESULTS && x.alt ? x.alt.final : 0) || '-'} for ${nm(r.members.find(m => m.cd.id === x.k).cd.final)} (−${x.loss.toFixed(1)})`).join('; '), '');
    }
    return out.join('\n');
  }
})();
const RESULTS = [];
let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // repeatable restarts
