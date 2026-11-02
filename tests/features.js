'use strict';
// Checks for the reference pages and trackers (features.js and friends): every page renders without gaps, the
// data they lean on hangs together, and the calculators match known Gen 3 numbers. Run: node tests/features.js
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

(async () => {
  const app = await loadApp(FILES);
  const g = app.get, state = app.state;
  const render = (hash) => {
    app.ctx.location.hash = hash;
    try { app.route(); } catch (e) { fail(`${hash}: ${e.stack.split('\n').slice(0, 3).join(' ')}`); return ''; }
    const html = app.view.innerHTML || '';
    if (/undefined|NaN|\[object Object\]/.test(strip(html))) fail(`${hash}: shows ${strip(html).match(/.{0,60}(undefined|NaN|\[object Object\]).{0,30}/)[0]}`);
    return html;
  };
  state.regionMap = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../data/region-map.json'), 'utf8'));
  for (const V of ['FR', 'LG']) {
    state.progress.version = V;
    for (const r of Object.keys(state.regionMap)) render(`#/map/${encodeURIComponent(r)}`);
    // every Pokémon, TM and location page renders
    for (let n = 1; n <= 386; n++) render(`#/mon/${n}`);
    for (const tm of Object.keys(state.tms)) render(`#/tm/${tm}`);
    for (const l of state.index) render(`#/loc/${l.id}`);
    for (const h of ['#/tms', '#/progress', '#/missing', '#/search', '#/move/Surf', '#/item/Nugget', '#/item/Rare%20Candy', '#/planner', '#/tools', '#/dex', '#/'])
      render(h);
    for (const t of g('TOOLS')) render(t.id.startsWith('#') ? t.id : `#/tools/${t.id}`);
  }
  state.progress.version = 'FR';

  // every TM or HM with a source has a checklist row that gives it to you (except HM08/TM10, not in FRLG)
  for (const [tm, t] of Object.entries(state.tms)) if (t.sources.length && !g('tmKeys')(tm).length) fail(`${tm} has sources but no checklist row`);
  if (!g('tmKeys')('TM24').some(k => k.includes(':buy:'))) fail('TM24 should be a Game Corner prize row');
  // bought TMs count as collected
  const s = app.cur();
  const k = g('tmKeys')('TM15').find(x => x.includes(':buy:'));
  s.checks[k] = true;
  if (!g('hasTM')('TM15')) fail('ticking the TM15 shop row should count as having TM15');
  delete s.checks[k];

  // search finds things by name, number and TM
  for (const [q, want] of [['pika', '#/mon/25'], ['25', '#/mon/25'], ['TM24', '#/tm/TM24'], ['thunderbolt', '#/tm/TM24'], ['nugget', '#/item/Nugget'], ['brock', '#/loc/pewter-city'], ['cerulean', '#/loc/cerulean-city']])
    if (!g('searchResults')(q).slice(0, 5).some(r => r.h === want)) fail(`search "${q}" should find ${want}`);

  // catch odds: worked by hand from the game's formula (handleballthrow in battle_script_commands.c)
  const cc = g('catchChance');
  for (const [rate, ball, hp, st, want] of [[190, 1, 1, 1, 0.2797], [45, 1, 1, 1, 0.0625], [255, 1, 1, 1, 0.3369], [45, 2, 1 / 300, 2, 0.7846], [3, 1, 1, 1, 0.0042]]) {
    const got = cc(rate, ball, hp, st);
    if (Math.abs(got - want) > 0.0005) fail(`catch rate ${rate} ball ${ball} hp ${hp} status ${st}: ${got.toFixed(4)}, expected ${want}`);
  }
  if (cc(3, 1e9) !== 1) fail('a Master Ball always catches');

  // stats: Gen 3 formula, known values (level 100, IV 31, EV 252, neutral/positive nature)
  const sv = g('statValue');
  for (const [base, i, lvl, iv, ev, nat, want] of [[108, 0, 100, 31, 252, 'Hardy', 420], [130, 1, 100, 31, 252, 'Adamant', 394], [100, 5, 50, 31, 252, 'Timid', 167], [100, 5, 50, 31, 0, 'Timid', 132], [45, 0, 5, 0, 0, 'Hardy', 19], [1, 0, 50, 31, 252, 'Hardy', 1]])
    if (sv(base, i, lvl, iv, ev, nat) !== want) fail(`stat base ${base} slot ${i} Lv ${lvl}: ${sv(base, i, lvl, iv, ev, nat)}, expected ${want}`);
  const ivr = g('ivRange')(130, 1, 100, 394, 252, 'Adamant');
  if (ivr.join() !== '31') fail(`IV range should be 31, got ${ivr}`);
  // EXP tables: level 100 totals per growth rate
  const ea = g('expAt');
  for (const [gr, want] of [['fast', 800000], ['medium-fast', 1000000], ['medium-slow', 1059860], ['slow', 1250000], ['erratic', 600000], ['fluctuating', 1640000]])
    if (ea(gr, 100) !== want) fail(`EXP to Lv 100 (${gr}): ${ea(gr, 100)}, expected ${want}`);
  if (g('levelFor')('medium-slow', g('expAt')('medium-slow', 36)) !== 36) fail('levelFor should invert expAt');
  // a trainer's Lv 14 Onix (base EXP 108): 108 * 14 / 7 = 216, x1.5 = 324
  if (g('expFor')(95, 14, true, 1) !== 324) fail(`Onix EXP ${g('expFor')(95, 14, true, 1)}, expected 324`);

  // save import: build a save the way the game lays it out and read it back
  {
    const map = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../data/save-map.json'), 'utf8'));
    const buf = new ArrayBuffer(0x20000), dv = new DataView(buf), SAV = g('SAV');
    // slot B is newer (counter 7); slot A is stale (counter 3) and must be ignored
    const sectorOff = (slot, id) => (slot * 14 + ((id + 5) % 14)) * 0x1000; // sectors are rotated in a real save
    for (const [slot, counter] of [[0, 3], [1, 7]]) for (let id = 0; id < 14; id++) {
      const o = sectorOff(slot, id); dv.setUint16(o + 0xFF4, id, true); dv.setUint32(o + 0xFF8, 0x08012025, true); dv.setUint32(o + 0xFFC, counter, true);
    }
    const sb2 = sectorOff(1, 0);
    const setBit = (base, n) => dv.setUint8(base + (n >> 3), dv.getUint8(base + (n >> 3)) | (1 << (n & 7)));
    setBit(sb2 + SAV.SB2.owned, 24); setBit(sb2 + SAV.SB2.owned, 251); // Pikachu, Treecko
    setBit(sectorOff(0, 0) + SAV.SB2.owned, 0); // Bulbasaur only in the stale slot
    [0xCC, 0xD9, 0xD8].forEach((c, i) => dv.setUint8(sb2 + i, c)); dv.setUint8(sb2 + 3, 0xFF); // "Red"
    const sb1At = off => { const id = 1 + Math.floor(off / 3968); return sectorOff(1, id) + off % 3968; };
    const itemKey = Object.keys(map.flags).find(k => k.includes(':item:')), trKey = 'pewter-city:trainer:leader-brock';
    for (const f of [map.flags[itemKey], ...[].concat(map.flags[trKey])].slice(0, 2)) { const off = SAV.SB1.flags + (f >> 3); dv.setUint8(sb1At(off), dv.getUint8(sb1At(off)) | (1 << (f & 7))); }
    dv.setUint32(sb1At(SAV.SB1.partyCount), 1, true);
    // one party Pokémon: Treecko (internal 277) Lv 17 knowing Pound and Absorb, encrypted with personality ^ OT ID
    const pid = 0x12345679, otid = 0xABCD1234, key = (pid ^ otid) >>> 0, order = g('SUB_ORDER')[pid % 24];
    const plain = new DataView(new ArrayBuffer(48));
    plain.setUint16(order.indexOf('G') * 12, map.species.indexOf(252), true);
    plain.setUint16(order.indexOf('A') * 12, map.moves.indexOf('Pound'), true);
    plain.setUint16(order.indexOf('A') * 12 + 2, map.moves.indexOf('Absorb'), true);
    const p0 = SAV.SB1.party;
    const put32 = (off, v) => { for (let b = 0; b < 4; b++) dv.setUint8(sb1At(off + b), (v >>> (8 * b)) & 0xFF); };
    put32(p0, pid); put32(p0 + 4, otid);
    for (let i = 0; i < 48; i += 4) put32(p0 + 0x20 + i, (plain.getUint32(i, true) ^ key) >>> 0);
    dv.setUint8(sb1At(p0 + 0x54), 17);
    const r = g('parseSave')(buf, map);
    if (r.name !== 'Red') fail(`save name ${r.name}`);
    if (r.owned.join() !== '25,252') fail(`save owned ${r.owned}`);
    if (!r.checks.includes(itemKey) || !r.checks.includes(trKey)) fail(`save checks ${r.checks}`);
    if (r.party.length !== 1 || r.party[0].dex !== 252 || r.party[0].level !== 17 || r.party[0].moves.join() !== 'Pound,Absorb') fail(`save party ${JSON.stringify(r.party)}`);
  }
  // every item and trainer row has a save flag
  {
    const map = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../data/save-map.json'), 'utf8'));
    for (const l of state.index) {
      const loc = state.locations[l.id];
      for (const i of loc.items) if (map.flags[`${l.id}:item:${i.id}`] === undefined && !/Coins/.test(i.name)) fail(`no save flag for ${l.id} ${i.name}`);
      for (const t of loc.trainers || []) if (!map.flags[`${l.id}:trainer:${t.id}`]?.length) fail(`no save flag for trainer ${l.id} ${t.id}`);
    }
  }

  // the still-missing list puts each uncaught Pokémon in exactly one group
  render('#/missing');

  // shop data: every Celadon TM for sale is in tms.json as a buy source
  for (const sh of state.extras.shops['celadon-city']) for (const it of sh.items) {
    const tm = /^(TM|HM)\d+/.exec(it.name)?.[0];
    if (tm && !state.tms[tm].sources.some(x => x.how === 'buy' || x.how === 'prize')) fail(`${tm} sold at Celadon but not a buy/prize source`);
  }

  // catch plans: every catchable encounter renders, with and without a team, using only shop balls by then and never
  // the Master Ball; the route page links each one
  {
    const sv = app.cur(), keepTeam = sv.team, keepMeta = sv.teamMeta, keepHere = sv.here;
    delete sv.here;
    const ballsBy = g('ballsBy'), sh = g('ballShops')(), stg = g('stageOf');
    const names = st => ballsBy(st).map(b => b.name);
    if (names(stg('route-1')).join() !== 'Poké Ball') fail(`Route 1 balls: ${names(stg('route-1'))}`);
    if (names(stg('lavender-town') - 1).includes('Great Ball')) fail('Great Ball before Lavender Town');
    if (!names(stg('lavender-town')).includes('Great Ball')) fail('no Great Ball at Lavender Town');
    if (names(stg('fuchsia-city') - 1).includes('Ultra Ball')) fail('Ultra Ball before Fuchsia City');
    if (names(stg('pokemon-league')).some(b => /Repeat|Timer/.test(b))) fail('Repeat/Timer Ball before linking with Ruby or Sapphire');
    if (!sh['Timer Ball'] || !sh['Repeat Ball']) fail('Two Island Repeat/Timer Balls missing from shop data');
    for (const team of [[], [12, 16, 25, 39, 83]]) {
      sv.team = team; sv.teamMeta = {};
      for (const V of ['FR', 'LG']) {
        state.progress.version = V;
        for (const l of state.index) for (const e of state.locations[l.id].encounters) {
          if (!g('inVersion')(e) || ['gift', 'trade', 'game-corner'].includes(e.method)) continue;
          const h = render(`#/catch/${l.id}/${e.dex}.${e.method}`), txt = strip(h);
          if (/Master Ball/.test(txt)) fail(`catch plan ${l.id}/${e.dex} mentions the Master Ball`);
          const allowed = names(Math.max(g('encStage')(l.id, e), g('currentStage')()));
          for (const b of ['Great Ball', 'Ultra Ball', 'Repeat Ball', 'Timer Ball']) if (!allowed.includes(b) && new RegExp(`With ${b}s|Use ${b}s`).test(txt)) fail(`catch plan ${l.id}/${e.dex} plans with ${b} before it's sold`);
          if (l.id !== 'safari-zone' && !/If you only have Poké Balls/.test(txt)) fail(`catch plan ${l.id}/${e.dex} has no Poké Ball plan`);
        }
      }
    }
    state.progress.version = 'FR';
    if (!render('#/loc/route-1').includes('#/catch/route-1/16.grass')) fail('Route 1 page has no catch plan link for Pidgey');
    // Abra teleports: with no faster sleep move, the plan is to throw at once
    sv.team = []; if (!/Throw on your very first turn/.test(strip(render('#/catch/route-24/63')))) fail('Abra plan should say throw on the first turn');
    // False Swipe on the team takes it to 1 HP
    sv.team = [83]; sv.teamMeta = { 83: { level: 30, moves: ['False Swipe', 'Peck', '', ''] } };
    if (!/False Swipe until it's at 1 HP/.test(strip(render('#/catch/safari-zone/128') + render('#/catch/route-12/143')))) fail('False Swipe plan missing for Snorlax');
    sv.team = keepTeam; sv.teamMeta = keepMeta; if (keepHere) sv.here = keepHere;
  }

  // Pokémon rows open the Pokémon page; only the checkbox ticks them (no label wrapping the name, no separate ⓘ)
  { const h = render('#/dex'); if (!h.includes('class="rowlink" href="#/mon/1"') || /class="info"/.test(h) || /<label for="[^"]+"><span>#001/.test(h)) fail('Pokédex rows should link to the Pokémon page and tick only from the checkbox'); }

  // item pages: every item in a checklist, shop or the Bag data renders with a description; shop sellers listed
  for (const it of Object.keys(state.items)) render(`#/item/${encodeURIComponent(it)}`);
  { const h = strip(render('#/item/Pok%C3%A9%20Ball'));
    if (!/A Ball thrown to catch/.test(h) || !/Viridian City/.test(h) || !/Sells for/.test(h)) fail(`Poké Ball page: ${h.slice(0, 200)}`);
    if (!/Held in battle: restores 30 HP/.test(strip(render('#/item/Sitrus%20Berry')))) fail('Sitrus Berry held effect missing');
    if (!/Evolves:.*Clefairy/.test(strip(render('#/item/Moon%20Stone')))) fail('Moon Stone page should list Clefairy');
    if (!render('#/loc/route-3').includes('class="rowlink" href="#/item/')) fail('Route item rows should open the item page'); }

  if (fails.length) { console.log(`FAIL (${fails.length})\n` + fails.slice(0, 60).map(f => ' - ' + f).join('\n')); process.exit(1); }
  console.log('OK: feature pages and data checks passed');
})().catch(e => { console.error(e); process.exit(1); });
