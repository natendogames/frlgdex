'use strict';
// Read a FireRed/LeafGreen battery save (.sav, 128 KB) and tick off what it shows: Pokédex caught flags, items picked
// up (ground and hidden), trainers beaten, and your party (species, level, moves) into the Battle plan.
// Layout from the pret/pokefirered decompilation (include/global.h, include/save.h); flag numbers per checklist row
// come from data/save-map.json, written by scripts/build_data.py.

const SAV = {
  SECTOR: 0x1000, DATA: 3968, SLOT: 14, SIGNATURE: 0x08012025,
  SB2: { name: 0x00, tid: 0x0A, hours: 0x0E, minutes: 0x10, owned: 0x28, seen: 0x5C, key: 0xF20 },
  SB1: { partyCount: 0x34, party: 0x38, money: 0x290, flags: 0x0EE0, flagBytes: 0x120 }
};
const SUB_ORDER = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];
function gen3Text(bytes) {
  let out = '';
  for (const b of bytes) {
    if (b === 0xFF) break;
    out += b >= 0xBB && b <= 0xD4 ? String.fromCharCode(65 + b - 0xBB) : b >= 0xD5 && b <= 0xEE ? String.fromCharCode(97 + b - 0xD5)
      : b >= 0xA1 && b <= 0xAA ? String(b - 0xA1) : b === 0x00 ? ' ' : b === 0xAD ? '.' : b === 0xAE ? '-' : '?';
  }
  return out.trim();
}
// The newer of the two save slots: the one whose sectors carry the signature and the higher save counter.
function pickSlot(buf) {
  const dv = new DataView(buf);
  const slots = [0, 1].map(s => {
    const sectors = {};
    let counter = -1, ok = true;
    for (let i = 0; i < SAV.SLOT; i++) {
      const off = (s * SAV.SLOT + i) * SAV.SECTOR;
      if (off + SAV.SECTOR > buf.byteLength) { ok = false; break; }
      if (dv.getUint32(off + 0xFF8, true) !== SAV.SIGNATURE) { ok = false; break; }
      sectors[dv.getUint16(off + 0xFF4, true)] = off;
      counter = dv.getUint32(off + 0xFFC, true);
    }
    return ok && [0, 1, 2, 3, 4].every(id => id in sectors) ? { sectors, counter } : null;
  }).filter(Boolean);
  if (!slots.length) throw new Error("This doesn't look like a FireRed or LeafGreen save file.");
  return slots.sort((a, b) => b.counter - a.counter)[0];
}
function readBlock(buf, slot, ids) {
  const out = new Uint8Array(ids.length * SAV.DATA);
  ids.forEach((id, i) => out.set(new Uint8Array(buf, slot.sectors[id], SAV.DATA), i * SAV.DATA));
  return new DataView(out.buffer);
}
function readMon(sb1, off, map) {
  const pid = sb1.getUint32(off, true), otid = sb1.getUint32(off + 4, true), key = (pid ^ otid) >>> 0;
  const dec = new DataView(new ArrayBuffer(48));
  for (let i = 0; i < 48; i += 4) dec.setUint32(i, (sb1.getUint32(off + 0x20 + i, true) ^ key) >>> 0, true);
  const order = SUB_ORDER[pid % 24];
  const g = order.indexOf('G') * 12, a = order.indexOf('A') * 12;
  const internal = dec.getUint16(g, true);
  const moves = [0, 1, 2, 3].map(i => map.moves[dec.getUint16(a + i * 2, true)] || '').filter(Boolean);
  const nick = gen3Text([...new Uint8Array(sb1.buffer, off + 8, 10)]);
  return { dex: map.species[internal] || 0, level: sb1.getUint8(off + 0x54), moves, nick, internal };
}
function parseSave(buf, map) {
  const slot = pickSlot(buf);
  const sb2 = readBlock(buf, slot, [0]), sb1 = readBlock(buf, slot, [1, 2, 3, 4]);
  const bit = (dv, base, n) => (dv.getUint8(base + (n >> 3)) >> (n & 7)) & 1;
  const owned = [], seen = [];
  for (let n = 1; n <= 386; n++) { if (bit(sb2, SAV.SB2.owned, n - 1)) owned.push(n); if (bit(sb2, SAV.SB2.seen, n - 1)) seen.push(n); }
  const flag = n => n >= 0 && n < SAV.SB1.flagBytes * 8 && !!bit(sb1, SAV.SB1.flags, n);
  const checks = [];
  for (const [k, f] of Object.entries(map.flags)) if (Array.isArray(f) ? f.some(flag) : flag(f)) checks.push(k);
  const count = Math.min(6, sb1.getUint32(SAV.SB1.partyCount, true));
  const party = [];
  for (let i = 0; i < count; i++) { const m = readMon(sb1, SAV.SB1.party + i * 100, map); if (m.dex >= 1 && m.dex <= 386) party.push(m); }
  const key = sb2.getUint32(SAV.SB2.key, true);
  return {
    name: gen3Text([...new Uint8Array(sb2.buffer, SAV.SB2.name, 8)]), tid: sb2.getUint16(SAV.SB2.tid, true),
    time: `${sb2.getUint16(SAV.SB2.hours, true)}:${String(sb2.getUint8(SAV.SB2.minutes)).padStart(2, '0')}`,
    money: (sb1.getUint32(SAV.SB1.money, true) ^ key) >>> 0, owned, seen, checks, party,
    badges: map.badges.filter(flag).length
  };
}
function applySave(r, replace) {
  const s = cur();
  if (replace) { s.caught = {}; for (const k of Object.keys(s.checks)) if (/:(item|trainer):/.test(k)) delete s.checks[k]; }
  for (const n of r.owned) s.caught[n] ||= true;
  for (const k of r.checks) s.checks[k] = true;
  if (r.party.length) {
    s.team = [...new Set(r.party.map(m => m.dex))];
    s.teamMeta ||= {};
    for (const m of r.party) s.teamMeta[m.dex] = { level: m.level, moves: [0, 1, 2, 3].map(i => m.moves[i] || '') };
    const st = r.party.map(m => starterKeyOf(m.dex)).find(Boolean);
    if (st && !pickOf('starter')) { s.picks ||= {}; s.picks.starter = st; }
  }
  for (const k in catchCache) delete catchCache[k];
  save();
}
function renderImport() {
  const r = state.saveRead;
  view.innerHTML = `<div class="card"><p class="note">Load a battery save (.sav) from an emulator or a cartridge backup. The app reads it on this device only: nothing is uploaded.
    It ticks off Pokémon you've caught, items you've picked up, trainers you've beaten, and puts your party with levels and moves in the Battle plan.
    Gifts, shop TMs and choices aren't stored in a way the app can read, so tick those yourself.</p>
    <label class="btn">Choose .sav file<input type="file" id="savfile" accept=".sav,.srm,.fla,application/octet-stream" hidden></label>
    <p class="note">It's applied to the ${VNAME[V()]} checklist: switch FR/LG at the top first if this is the other game.</p></div>
    ${r ? `<div class="card"><b>${esc(r.name || 'Trainer')}</b> <span class="note">ID ${String(r.tid).padStart(5, '0')} · ${esc(r.time)} played · ₽${r.money.toLocaleString()} · ${r.badges} badges</span>
      <table class="mini" style="margin-top:8px"><tr><td>Pokédex</td><td>${r.owned.length} caught, ${r.seen.length} seen</td></tr>
      <tr><td>Items picked up</td><td>${r.checks.filter(k => k.includes(':item:')).length}</td></tr>
      <tr><td>Trainers beaten</td><td>${r.checks.filter(k => k.includes(':trainer:')).length}</td></tr>
      <tr><td>Party</td><td>${r.party.map(m => `${esc(mon(m.dex).name)} Lv ${m.level}`).join(', ') || '—'}</td></tr></table>
      <div class="toolbar" style="margin-top:10px"><button class="btn" id="savmerge">Add to my checklist</button><button class="btn" id="savreplace">Replace caught, items and trainers</button></div></div>` : ''}
    ${state.saveError ? `<div class="card bad">${esc(state.saveError)}</div>` : ''}`;
  document.getElementById('savfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      state.saveMap ||= await getJSON('data/save-map.json');
      state.saveRead = parseSave(await f.arrayBuffer(), state.saveMap); state.saveError = '';
    } catch (err) { state.saveRead = null; state.saveError = err.message; }
    renderImport();
  };
  const done = replace => { applySave(r, replace); state.saveRead = null; alert('Done. Your checklist is updated.'); location.hash = '#/progress'; };
  if (r) {
    document.getElementById('savmerge').onclick = () => done(false);
    document.getElementById('savreplace').onclick = () => { if (confirm(`Replace caught Pokémon, items and trainers on your ${VNAME[V()]} checklist with what's in this save?`)) done(true); };
  }
}
TOOLS.push({ id: 'import', title: 'Import a save file', desc: 'Read your .sav and tick off caught Pokémon, items and trainers automatically', render: renderImport });
