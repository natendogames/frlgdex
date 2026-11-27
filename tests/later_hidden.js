'use strict';
// Every page keeps what you can't get on your first visit out of sight: anything marked "later" (items, hidden items,
// gifts and trades, either/or picks, trainers, shop stock, tutors, wild Pokémon) must only show inside a collapsed
// "come back later" section. Renders every place and checks each checkbox and pick outside those sections.
// Run: node tests/later_hidden.js
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);
// drop every <details class="later">…</details> block, with whatever <details> it holds (trainer cards)
function visible(h) {
  let out = '', depth = 0, laterAt = -1, i = 0;
  const re = /<details\b[^>]*>|<\/details>/g;
  let m;
  while ((m = re.exec(h))) {
    if (laterAt < 0) out += h.slice(i, m.index);
    if (m[0].startsWith('</')) { depth--; if (depth === laterAt) laterAt = -1; else if (laterAt < 0) out += m[0]; }
    else { if (laterAt < 0 && /class="later"/.test(m[0])) laterAt = depth; else if (laterAt < 0) out += m[0]; depth++; }
    i = re.lastIndex;
  }
  return laterAt < 0 ? out + h.slice(i) : out;
}

(async () => {
  const app = await loadApp(FILES);
  const { state } = app, g = app.get;
  const CHOICES = g('CHOICES'), choiceLater = g('choiceLater'), trainerKey = g('trainerKey'), encStage = g('encStage');
  let checked = 0, tocs = 0;
  for (const l of state.index) {
    const loc = state.locations[l.id];
    app.ctx.location.hash = `#/loc/${l.id}`; app.route();
    const h = visible(app.view.innerHTML || '');
    // every "come back later" section sits at the bottom, under one heading, after everything for this visit
    { const raw = app.view.innerHTML || '', head = raw.indexOf('class="laterhead"'), firstSect = raw.indexOf('data-sect');
      if (firstSect >= 0 && !(head >= 0 && head < firstSect)) fail(`${l.id}: a "come back later" section shows above the first-visit sections`);
      if (head >= 0) { // after the heading: only "come back later" sections
        let rest = raw.slice(raw.indexOf('</h2>', head) + 5), depth = 0, out = '', from = 0;
        for (const m of rest.matchAll(/<details\b[^>]*>|<\/details>/g)) {
          if (m[0] === '</details>') { if (--depth === 0) from = m.index + m[0].length; }
          else { if (depth === 0) { out += rest.slice(from, m.index); if (!/data-sect/.test(m[0])) out += 'x'; } depth++; }
        }
        if ((out + rest.slice(from)).trim()) fail(`${l.id}: a first-visit section shows below "Come back later"`);
      } }
    // the contents list at the top: one button per top-level section heading, each pointing at a heading on the page
    { const raw = app.view.innerHTML || '', jumps = [...raw.matchAll(/data-jump="([^"]+)"/g)].map(m => m[1]);
      const heads = (raw.match(/<h2 id="sec-\d+"/g) || []).length;
      if (heads >= 3 && !raw.startsWith('<nav class="toc')) fail(`${l.id}: no contents list at the top`);
      if (jumps.length !== heads) fail(`${l.id}: contents list has ${jumps.length} entries for ${heads} sections`);
      for (const j of jumps) if (!raw.includes(`<h2 id="${j}"`)) fail(`${l.id}: contents entry ${j} has no section`);
      if (raw.includes('class="laterhead"') && heads >= 3 && !/data-jump="[^"]+">Come back later</.test(raw)) fail(`${l.id}: contents list doesn't link to "Come back later"`);
      if (heads >= 3) tocs++; }
    const keys = new Set([...h.matchAll(/data-key="([^"]+)"/g)].map(m => m[1]));
    const picks = new Set([...h.matchAll(/data-pick="([^"]+)"/g)].map(m => m[1]));
    const bad = (what, x) => fail(`${l.id}: ${what} "${x.name || x.id}" shows on the first visit but is "come back later"${x.need ? ` (${x.need})` : ''}`);
    for (const it of loc.items) if (it.later && keys.has(`${l.id}:item:${it.id}`)) bad('item', it);
    for (const gf of loc.gifts) if (gf.later && keys.has(`${l.id}:gift:${gf.id}`)) bad('gift', gf);
    for (const t of loc.trainers || []) if (t.later && keys.has(trainerKey(l.id, t))) bad('trainer', t);
    for (const sh of state.extras.shops[l.id] || []) if (sh.later && sh.items.some(it => keys.has(`${l.id}:buy:${sh.id}:${it.name}`))) bad('shop', { name: sh.where, need: sh.need });
    for (const t of state.extras.tutors || []) if (t.loc === l.id && t.later && keys.has(`${t.loc}:tutor:${t.id}`)) bad('tutor', { name: t.move, need: t.need });
    for (const c of CHOICES) if (c.loc === l.id && choiceLater(c, loc) && picks.has(c.id)) bad('pick', { name: c.title, need: choiceLater(c, loc) });
    for (const e of loc.encounters) if (encStage(l.id, e) > app.stageOf(l.id) && new RegExp(`data-key="dex:${e.dex}"[^>]*>[\\s\\S]{0,400}?${e.name}`).test(h)
      && !loc.encounters.some(x => x.dex === e.dex && encStage(l.id, x) <= app.stageOf(l.id))) bad('Pokémon', e);
    // a gift Pokémon that only comes later (its Pokémon row waits) must have its gift row waiting too
    for (const e of loc.encounters) if (e.method === 'gift' && encStage(l.id, e) > app.stageOf(l.id)) {
      const gf = loc.gifts.find(x => (e.notes || '').startsWith(x.name));
      if (gf && !gf.later) fail(`${l.id}: gift "${gf.name}" isn't marked "come back later", but its Pokémon only comes later`);
    }
    checked++;
  }
  if (tocs < 20) fail(`contents list on only ${tocs} places`);
  if (fails.length) { console.log(fails.join('\n')); console.log(`${fails.length} failures`); process.exit(1); }
  console.log(`later_hidden: ${checked} places checked; nothing marked "come back later" shows on a first visit`);
})().catch(e => { console.error(e); process.exit(1); });
