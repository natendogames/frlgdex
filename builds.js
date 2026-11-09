'use strict';
// Competitive builds on each Pokémon page: Smogon's ADV (Gen 3) sets from data/builds.json, with how to get every move
// and item in this game. data/builds.json holds only Gen 3 facts so the Emerald app can share it; everything
// game-specific is in BUILD_GAME and in the app's own data. Loaded after features.js; renderMon calls buildsSection().

const BUILD_GAME = {
  name: 'FireRed and LeafGreen',
  short: 'FRLG',
  // where a Gen 3 tutor move this game doesn't teach can be learned instead
  otherTutors: 'Emerald or Pokémon XD',
  otherGames: 'Ruby, Sapphire or Emerald',
};
const FORMAT_INFO = {
  ubers: 'Ubers: anything goes, legendaries included',
  ou: 'OU (OverUsed): the main singles tier',
  uu: 'UU (UnderUsed): Pokémon not common enough for OU',
  ru: 'RU (RarelyUsed): below UU',
  nu: 'NU (NeverUsed): below RU',
  pu: 'PU: below NU',
  zu: 'ZU (ZeroUsed): the lowest tier',
  lc: 'LC (Little Cup): unevolved Pokémon at level 5',
  doublesou: 'Doubles OU: two Pokémon a side',
  nfe: 'NFE: not fully evolved, for in-game or friendly battles',
  ingame: 'No competitive set: in-game advice',
};
const STAT_KEYS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];

let buildsLoading = null;
function loadBuilds() {
  if (state.builds) return Promise.resolve(state.builds);
  return (buildsLoading ||= getJSON('data/builds.json').then(b => (state.builds = b)));
}

// the builds for one Pokémon in this game (Deoxys has a different form in each version)
function buildsFor(n) {
  const list = state.builds?.species[n] || [];
  const mine = list.filter(e => !e.versions || e.versions.includes(V()));
  return mine.length ? mine : list.filter(e => !e.versions);
}

const natureText = nat => {
  const n = NATURES.find(x => x[0] === nat);
  return n && n[1] ? `${nat} <span class="note">(+${STAT_SHORT[n[1]]} −${STAT_SHORT[n[2]]})</span>` : `${esc(nat)} <span class="note">(neutral)</span>`;
};
const evLine = evs => evs.map((v, i) => v ? `${v} ${STAT_KEYS[i]}` : '').filter(Boolean).join(' / ');
const ivLine = ivs => ivs.map((v, i) => v !== 31 ? `${v} ${STAT_KEYS[i]}` : '').filter(Boolean).join(' / ');
const baseMove = mv => mv.startsWith('Hidden Power') ? 'Hidden Power' : mv;
const sameMove = (a, b) => a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');

// How to teach a move to Pokémon n in this game. Checks n and everything it evolves from, using the game's own
// level-up, TM/HM and tutor data, then falls back to the Gen 3 sources in builds.json (egg move, another game's tutor,
// event). Returns { ok: learnable in this game without trading, text, href? }.
function moveHow(n, mv, letters = '') {
  const name = baseMove(mv), line = lineOf(n).slice(0, lineOf(n).indexOf(n) + 1).reverse();
  const as = d => (d === n ? '' : ` as ${esc(mon(d).name)}`);
  for (const d of line) {
    const lv = (mon(d).learnset || []).find(([, m]) => sameMove(m, name));
    if (lv) return { ok: true, text: `${lv[0] <= 1 ? 'Known at the start' : `Level ${lv[0]}`}${as(d)}` };
  }
  const tm = Object.entries(state.tms).find(([, t]) => sameMove(t.move, name));
  for (const d of line) {
    if (tm && (mon(d).tmhm || []).includes(tm[0])) {
      if (tm[1].sources.length) return { ok: true, text: `${tm[0]}${as(d)}`, href: `#/tm/${tm[0]}` };
      return { ok: false, text: `${tm[0]}, but ${tm[0]} isn't in ${BUILD_GAME.name}: teach it in ${BUILD_GAME.otherGames} and trade it over` };
    }
    const tut = (mon(d).tutor || []).find(m => sameMove(m, name)) && state.extras.tutors.find(t => sameMove(t.move, name));
    if (tut) return { ok: true, text: `Move tutor${as(d)}, ${esc(state.locations[tut.loc]?.name || tut.loc)} (one use)`, href: `#/loc/${tut.loc}` };
  }
  if (letters.includes('E')) return { ok: true, text: `Egg move: breed it from a father that knows ${esc(name)}`, href: '#/tools/breeding' };
  if (letters.includes('K')) return { ok: true, text: 'Sketch it from a Pokémon that uses it' };
  if (letters.includes('T')) return { ok: false, text: `Tutor in ${BUILD_GAME.otherTutors} only: teach it there and trade it over` };
  if (letters.includes('L') || letters.includes('M')) return { ok: false, text: `Only learned in ${BUILD_GAME.otherGames}: trade it over` };
  if (letters.includes('S') || letters.includes('R')) return { ok: false, text: 'Event-only move (from a Nintendo event Pokémon)' };
  return { ok: false, text: 'Not learnable in Gen 3' };
}
function itemHow(name) {
  const { out, held } = itemPlaces(name);
  if (out.length || held.length) return { ok: true, text: out.length ? `${out[0].kind === 'buy' ? 'Buy' : out[0].kind === 'prize' ? 'Game Corner' : 'Find'}: ${esc(out[0].loc.name)}` : `Held by wild ${esc(held[0].name)}` };
  return { ok: false, text: `Not in ${BUILD_GAME.name}: trade it over held by a Pokémon from ${BUILD_GAME.otherGames}` };
}

function showdownText(e, st) {
  const lines = [`${e.name}${st.items[0] ? ` @ ${st.items[0]}` : ''}`, `Ability: ${st.abilities[0]}`];
  if (st.level !== 100) lines.push(`Level: ${st.level}`);
  if (evLine(st.evs)) lines.push(`EVs: ${evLine(st.evs)}`);
  if (st.natures[0]) lines.push(`${st.natures[0]} Nature`);
  const hp = st.moves.map(s => s[0]).find(m => m.startsWith('Hidden Power '));
  const ivs = st.ivs || (hp && st.hiddenPower?.[hp.slice(13)]?.ivs);
  if (ivs && ivLine(ivs)) lines.push(`IVs: ${ivLine(ivs)}`);
  for (const s of st.moves) lines.push(`- ${s[0]}`);
  return lines.join('\n');
}

const tally = (list) => {
  const c = new Map();
  for (const x of list) c.set(x, (c.get(x) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1]);
};
function buildSummary(n, entries) {
  const sets = entries.flatMap(e => e.sets);
  const real = sets.filter(s => !s.draft);
  const use = real.length ? real : sets;
  const top = (arr, k, fmt = esc) => tally(arr).slice(0, k).map(([x, c]) => `${fmt(x)}${use.length > 1 ? ` <span class="note">×${c}</span>` : ''}`).join(', ');
  const fmts = [...new Set(use.map(s => s.format))].map(f => `<span class="tag" title="${esc(FORMAT_INFO[f] || '')}">${esc(state.builds.formats[f] || f)}</span>`).join(' ');
  return `<table class="mini">
    <tr><td>Tiers</td><td>${fmts}</td></tr>
    <tr><td>Best natures</td><td>${top(use.flatMap(s => s.natures), 3, natureText)}</td></tr>
    <tr><td>Abilities</td><td>${top(use.flatMap(s => s.abilities), 2)}</td></tr>
    <tr><td>Items</td><td>${top(use.flatMap(s => s.items), 3, x => `<a href="${itemHref(x)}">${esc(x)}</a>`) || '—'}</td></tr>
    <tr><td>Top moves</td><td>${top(use.flatMap(s => [...new Set(s.moves.flat())]), 6, x => `<a href="#/move/${encodeURIComponent(baseMove(x))}">${esc(x)}</a>`)}</td></tr>
  </table>`;
}

function setCard(n, e, st, i) {
  const learn = e.learn || {};
  const moveRows = st.moves.map((slot, k) => `<div class="bmove"><span class="bslot">${k + 1}</span><span>${slot.map(mv => {
    const how = moveHow(n, mv, learn[baseMove(mv)]);
    const hpx = mv.startsWith('Hidden Power ') && st.hiddenPower?.[mv.slice(13)];
    return `<div><a href="#/move/${encodeURIComponent(baseMove(mv))}"><b>${esc(mv)}</b></a>${state.moves[baseMove(mv)]?.type && !hpx ? ` ${typeTag(state.moves[baseMove(mv)].type)}` : hpx ? ` ${typeTag(mv.slice(13))}` : ''}
      <div class="note ${how.ok ? '' : 'warn'}">${how.ok ? '' : '⚠ '}${how.href ? `<a href="${how.href}">${how.text}</a>` : how.text}${hpx ? ` · power ${hpx.power}, needs IVs ${ivLine(hpx.ivs) || 'all 31'}` : ''}</div></div>`;
  }).join('<div class="note bor">or</div>')}</span></div>`).join('');
  const items = st.items.map(x => { const h = itemHow(x); return `<a href="${itemHref(x)}">${esc(x)}</a> <span class="note ${h.ok ? '' : 'warn'}">${h.ok ? '' : '⚠ '}${h.text}</span>`; }).join('<br>or ');
  const label = `${state.builds.formats[st.format] || st.format} · ${st.name}`;
  return `<details class="card build"${i === 0 ? ' open' : ''}><summary><span class="tag" title="${esc(FORMAT_INFO[st.format] || '')}">${esc(state.builds.formats[st.format] || st.format)}</span> ${esc(st.name)}${st.draft ? ' <span class="tag draft">Draft</span>' : ''}${entriesNote(e)}</summary>
    ${st.note ? `<p class="note">${esc(st.note)}</p>` : ''}
    <table class="mini">
      <tr><td>Item</td><td>${items || '—'}</td></tr>
      <tr><td>Ability</td><td>${st.abilities.map(esc).join(' or ')}</td></tr>
      <tr><td>Nature</td><td>${st.natures.map(natureText).join(' or ') || '—'}</td></tr>
      <tr><td>EVs</td><td>${evLine(st.evs) || '<span class="note">None needed</span>'}</td></tr>
      ${st.ivs && ivLine(st.ivs) ? `<tr><td>IVs</td><td>${ivLine(st.ivs)} <span class="note">(others 31)</span></td></tr>` : ''}
      <tr><td>Level</td><td>${st.level}</td></tr>
    </table>
    <div class="bmoves">${moveRows}</div>
    <button class="btn wide" data-copy-build="${esc(n)}|${esc(e.name)}|${esc(label)}">Copy for Showdown</button>
  </details>`;
}
const entriesNote = e => (e.versions ? ` <span class="note">${esc(e.name)}</span>` : '');

// the "Competitive builds" section of a Pokémon page
function buildsSection(n) {
  if (!state.builds) {
    loadBuilds().then(() => { const el = document.getElementById('builds'); if (el && location.hash === `#/mon/${n}`) el.innerHTML = buildsBody(n); }).catch(() => {
      const el = document.getElementById('builds'); if (el) el.innerHTML = '<div class="card note">Could not load the builds. Check your connection and try again.</div>';
    });
    return `<h2>Competitive builds</h2><div id="builds"><div class="card note">Loading builds…</div></div>`;
  }
  return `<h2>Competitive builds</h2><div id="builds">${buildsBody(n)}</div>`;
}
function buildsBody(n) {
  const entries = buildsFor(n);
  if (!entries.length) return '<div class="card note">No builds for this Pokémon.</div>';
  const draft = entries.every(e => e.draft);
  const smogon = entries.find(e => e.smogon)?.smogon;
  const GAME = { RS: 'Ruby/Sapphire', FR: 'FireRed', LG: 'LeafGreen', E: 'Emerald' };
  const formName = e => `${e.name.includes('-') ? e.name.split('-')[1] : 'Normal'} Forme`;
  const others = (state.builds.species[n] || []).filter(e => e.versions && !entries.includes(e));
  const forms = others.length ? `<p class="note">${VNAME[V()] || 'This game'}'s ${esc(mon(n).name)} is ${formName(entries[0])}. Other forms: ${others.map(e => `${formName(e)} (${e.versions.map(v => GAME[v] || v).join(', ')})`).join(', ')}.</p>` : '';
  let html = `<div class="card">${draft
    ? `<p class="note" style="margin-top:0"><span class="tag draft">Draft</span> Smogon has no Gen 3 set for ${esc(mon(n).name)}, so this is a suggestion, not a Smogon analysis.${(mon(n).evolutions || []).length ? ` See ${mon(n).evolutions.map(x => monA(x.into)).join(' or ')} for builds after it evolves.` : ''}</p>`
    : `<p class="note" style="margin-top:0">From Smogon's ADV (Gen 3) strategy dex. Moves and items marked ⚠ can't be had in ${BUILD_GAME.name} alone.</p>`}
    ${forms}${buildSummary(n, entries)}
    ${smogon ? `<a class="btn wide" href="https://www.smogon.com/dex/rs/pokemon/${esc(smogon)}/" target="_blank" rel="noopener">Read the analysis on Smogon ↗</a>` : ''}
    <details class="tiers"><summary class="note">What do the tiers mean?</summary><ul class="note">${[...new Set(entries.flatMap(e => e.sets.map(s => s.format)))].map(f => `<li>${esc(FORMAT_INFO[f] || f)}</li>`).join('')}</ul>
    <p class="note">Smogon battles are level 100 (level 5 in Little Cup) with up to 510 EVs. Gen 3 decides physical or special by the move's type.</p></details></div>`;
  let i = 0;
  for (const e of entries) for (const st of e.sets) html += setCard(n, e, st, i++);
  return html;
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-copy-build]');
  if (!b) return;
  const [n, name, label] = b.dataset.copyBuild.split('|');
  const entry = buildsFor(+n).find(x => x.name === name);
  const st = entry?.sets.find(s => `${state.builds.formats[s.format] || s.format} · ${s.name}` === label);
  if (!st) return;
  const text = showdownText(entry, st);
  const done = () => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy for Showdown'; }, 1500); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => prompt('Copy this set:', text));
  else prompt('Copy this set:', text);
});
