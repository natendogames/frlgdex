"""Build FRLG Completion Dex data files from the pret/pokefirered decompilation.

Usage: python3 -I build_data.py <pokefirered-dir> <app-data-dir>
"""
import json, re, sys, os, glob, collections

SRC, OUT = sys.argv[1], sys.argv[2]
P = lambda *a: os.path.join(SRC, *a)
VERSIONS = ('FR', 'LG')
VDEF = {'FR': 'FIRERED', 'LG': 'LEAFGREEN'}


def preprocess(text, ver):
    """Resolve .ifdef/.else/.endif and #if defined()/#elif/#else/#endif for one version."""
    out, stack = [], []  # stack of [active, taken]
    for line in text.split('\n'):
        s = line.strip()
        m = re.match(r'(?:\.ifdef|#ifdef)\s+(\w+)', s) or re.match(r'#if\s+defined\((\w+)\)', s)
        if m:
            cond = m.group(1) == VDEF[ver]
            parent = all(a for a, _ in stack)
            stack.append([parent and cond, cond]); continue
        m = re.match(r'#elif\s+defined\((\w+)\)', s)
        if m and stack:
            cond = m.group(1) == VDEF[ver] and not stack[-1][1]
            parent = all(a for a, _ in stack[:-1])
            stack[-1] = [parent and cond, stack[-1][1] or cond]; continue
        if s in ('.else', '#else') and stack:
            parent = all(a for a, _ in stack[:-1])
            stack[-1] = [parent and not stack[-1][1], True]; continue
        if s in ('.endif', '#endif') and stack:
            stack.pop(); continue
        if all(a for a, _ in stack):
            out.append(line)
    return '\n'.join(out)


# ---------- names ----------
SPECIAL_NAMES = {'NIDORAN_F': 'Nidoran♀', 'NIDORAN_M': 'Nidoran♂', 'MR_MIME': 'Mr. Mime', 'FARFETCHD': "Farfetch'd",
                 'HO_OH': 'Ho-Oh', 'PORYGON2': 'Porygon2'}

def title(s):
    s = s.replace('POKéMON', 'Pokémon').replace('POKé', 'Poké')
    return ' '.join(w if w in ('Pokémon', 'TM', 'HM', 'PP', 'HP', 'S.S.') or re.match(r'^(TM|HM)\d+$', w) else w.capitalize()
                    for w in s.split(' ')).replace('Pokémon', 'Pokémon')

species_const = {}
for line in open(P('src/data/text/species_names.h'), encoding='utf-8'):
    m = re.match(r'\s*\[SPECIES_(\w+)\]\s*=\s*_\("(.*)"\)', line)
    if m and m.group(1) != 'NONE':
        species_const[m.group(1)] = SPECIAL_NAMES.get(m.group(1)) or title(m.group(2))

natdex = {}
n = 0
for line in open(P('include/constants/pokedex.h')):
    m = re.match(r'\s*NATIONAL_DEX_(\w+),', line)
    if m:
        if m.group(1) == 'NONE': continue
        n += 1; natdex[m.group(1)] = n

def mon(const):
    key = const.replace('SPECIES_', '')
    return {'dex': natdex[key], 'name': species_const[key]}

items = {i['itemId']: i for i in json.load(open(P('src/data/items.json')))['items']}
ITEM_FIX = {'ITEM_PARALYZE_HEAL': 'Parlyz Heal', 'ITEM_TEACHY_TV': 'Teachy TV', 'ITEM_COIN': 'Coins', 'ITEM_NONE': 'Coins'}  # Game Corner hidden coins have no item

def item_name(c):
    if c in ITEM_FIX: return ITEM_FIX[c]
    m = re.match(r'ITEM_(TM|HM)(\d+)', c)
    if m: return f'{m.group(1)}{m.group(2)}'
    if c in items and '?' not in items[c]['english']: return title(items[c]['english'])
    return title(c.replace('ITEM_', '').replace('_', ' ')) if c != 'ITEM_COIN' else 'Coins'
    return title(items[c]['english']) if c in items else title(c.replace('ITEM_', '').replace('_', ' '))

move_names = {}
for line in open(P('src/data/text/move_names.h')):
    m = re.match(r'\s*\[MOVE_(\w+)\]\s*=\s*_\("(.*)"\)', line)
    if m: move_names[m.group(1)] = title(m.group(2))
move_types = {}
cur = None
for line in open(P('src/data/battle_moves.h')):
    m = re.match(r'\s*\[MOVE_(\w+)\]', line)
    if m: cur = m.group(1)
    m = re.match(r'\s*\.type = TYPE_(\w+)', line)
    if m and cur: move_types[cur] = m.group(1).capitalize()
    m = re.match(r'\s*\.power = (\d+)', line)
    if m and cur: move_types.setdefault('_power', {})[cur] = int(m.group(1))

# ---------- pokedex ----------
info, cur = {}, None
for line in open(P('src/data/pokemon/species_info.h')):
    m = re.match(r'\s*\[SPECIES_(\w+)\]\s*=', line)
    if m: cur = m.group(1); info[cur] = {}; continue
    if not cur: continue
    m = re.match(r'\s*\.(base\w+) = (\d+)', line)
    if m: info[cur][m.group(1)] = int(m.group(2))
    m = re.match(r'\s*\.types = \{TYPE_(\w+), TYPE_(\w+)\}', line)
    if m: info[cur]['types'] = sorted({m.group(1).capitalize(), m.group(2).capitalize()}, key=[m.group(1).capitalize(), m.group(2).capitalize()].index)
    m = re.match(r'\s*\.eggGroups = \{EGG_GROUP_(\w+), EGG_GROUP_(\w+)\}', line)
    if m: info[cur]['eggGroups'] = list(dict.fromkeys(g.replace('_', ' ').title().replace('Water ', 'Water ') for g in m.groups()))
    m = re.match(r'\s*\.genderRatio = (.*),', line)
    if m:
        g = m.group(1)
        info[cur]['gender'] = 'genderless' if 'GENDERLESS' in g else 'male' if g == 'MON_MALE' else 'female' if g == 'MON_FEMALE' else re.sub(r'PERCENT_FEMALE\((.*)\)', r'\1', g) + '% F'
    m = re.match(r'\s*\.eggCycles = (\d+)', line)
    if m: info[cur]['eggCycles'] = int(m.group(1))

evos = collections.defaultdict(list)
for line in open(P('src/data/pokemon/evolution.h')):
    m = re.match(r'\s*\[SPECIES_(\w+)\]\s*=\s*(.*)', line)
    if m: cur = m.group(1); rest = m.group(2)
    else: rest = line
    for method, param, target in re.findall(r'\{EVO_(\w+), (\w+), SPECIES_(\w+)\}', rest):
        p = param
        if p.startswith('ITEM_'): p = item_name(p)
        elif p.isdigit(): p = int(p)
        evos[cur].append({'method': method.lower().replace('_', '-'), 'param': p, 'into': natdex[target]})

pokedex = []
for key, dex in sorted(natdex.items(), key=lambda kv: kv[1]):
    if dex > 386: continue
    i = info.get(key, {})
    pokedex.append({'dex': dex, 'name': species_const[key], 'types': i.get('types'),
                    'stats': [i.get(k) for k in ('baseHP', 'baseAttack', 'baseDefense', 'baseSpAttack', 'baseSpDefense', 'baseSpeed')],
                    'eggGroups': i.get('eggGroups'), 'gender': i.get('gender'), 'eggCycles': i.get('eggCycles'),
                    'evolutions': evos.get(key, [])})
prevo = {}
for p in pokedex:
    for e in p['evolutions']: prevo[e['into']] = p['dex']
for p in pokedex:
    if p['dex'] in prevo: p['evolvesFrom'] = prevo[p['dex']]

# ---------- type chart ----------
bm = open(P('src/battle_main.c')).read()
chart = re.search(r'gTypeEffectiveness\[\d+\]\s*=\s*\{(.*?)\};', bm, re.S).group(1)
MUL = {'TYPE_MUL_NO_EFFECT': 0, 'TYPE_MUL_NOT_EFFECTIVE': 0.5, 'TYPE_MUL_SUPER_EFFECTIVE': 2}
type_chart = collections.defaultdict(dict)
for a, d, mul in re.findall(r'TYPE_(\w+), TYPE_(\w+), (TYPE_MUL_\w+)', chart):
    if a in ('FORESIGHT', 'ENDTABLE', 'MYSTERY') or d in ('FORESIGHT', 'ENDTABLE', 'MYSTERY'): continue
    type_chart[a.capitalize()][d.capitalize()] = MUL[mul]

# ---------- locations ----------
mapsec_name = {s['id']: s.get('name') for s in json.load(open(P('src/data/region_map/region_map_sections.json')))['map_sections']}
maps = {}
for f in glob.glob(P('data/maps/*/map.json')):
    m = json.load(open(f)); m['_dir'] = os.path.dirname(f); maps[m['name']] = m
by_const = {m['id']: m for m in maps.values()}

MERGE = {'MAPSEC_TRAINER_TOWER_2': 'MAPSEC_TRAINER_TOWER'}
for k in ('DILFORD', 'LIPTOO', 'MONEAN', 'RIXY', 'SCUFIB', 'VIAPOIS', 'WEEPTH'):
    MERGE[f'MAPSEC_{k}_CHAMBER'] = 'MAPSEC_TANOBY_RUINS'
SKIP = {'MAPSEC_SPECIAL_AREA', 'MAPSEC_SEVII_ISLE_6', 'MAPSEC_SEVII_ISLE_7', 'MAPSEC_SEVII_ISLE_8', 'MAPSEC_SEVII_ISLE_9'}

def loc_id(sec):
    sec = MERGE.get(sec, sec)
    return {'MAPSEC_UNDERGROUND_PATH': 'underground-path-north-south', 'MAPSEC_UNDERGROUND_PATH_2': 'underground-path-east-west',
            'MAPSEC_KANTO_SAFARI_ZONE': 'safari-zone', 'MAPSEC_KANTO_VICTORY_ROAD': 'victory-road',
            'MAPSEC_S_S_ANNE': 'ss-anne'}.get(sec, sec.replace('MAPSEC_', '').lower().replace('_', '-'))

def area_name(map_name, sec):
    """Human name for a sub-map, e.g. MtMoon_B1F -> 'B1F', PewterCity_Gym -> 'Gym'."""
    parts = map_name.split('_')
    words = [re.sub(r'(?<=[a-z])(?=[A-Z0-9])|(?<=[0-9])(?=[A-Z][a-z])', ' ', p) for p in parts[1:]] if len(parts) > 1 else []
    s = ' '.join(words).replace('Pokemon', 'Pokémon').replace('1 F', '1F')
    return s or 'Outside'

locs = {}
def L(sec):
    lid = loc_id(sec)
    if lid not in locs:
        nm = title(mapsec_name.get(MERGE.get(sec, sec)) or lid)
        nm = {'underground-path-north-south': 'Underground Path (Routes 5–6)', 'underground-path-east-west': 'Underground Path (Routes 7–8)',
              'ss-anne': 'S.S. Anne', 'pokemon-league': 'Pokémon League', 'mt-moon': 'Mt. Moon', 'mt-ember': 'Mt. Ember',
              'silph-co': 'Silph Co.', 'digletts-cave': "Diglett's Cave"}.get(lid, nm)
        locs[lid] = {'id': lid, 'name': nm, 'encounters': [], 'items': [], 'gifts': [], '_enc': {}}
    return locs[lid]

# wild encounters
we = json.load(open(P('src/data/wild_encounters.json')))['wild_encounter_groups'][0]
rates = {f['type']: f for f in we['fields']}
ROD = {'old_rod': 'old-rod', 'good_rod': 'good-rod', 'super_rod': 'super-rod'}
METH = {'land_mons': 'grass', 'water_mons': 'surf', 'rock_smash_mons': 'rock-smash'}
for e in we['encounters']:
    ver = 'FR' if e['base_label'].endswith('FireRed') else 'LG'
    m = by_const.get(e['map'])
    if not m or m['region_map_section'] in SKIP: continue
    loc = L(m['region_map_section'])
    area = area_name(m['name'], m['region_map_section'])
    for field, data in e.items():
        if not field.endswith('_mons'): continue
        slots = data['mons']; r = rates[field]['encounter_rates']
        for idx, slot in enumerate(slots):
            method = METH.get(field)
            if field == 'fishing_mons':
                method = next(ROD[k] for k, v in rates[field]['groups'].items() if idx in v)
            sp = slot['species'].replace('SPECIES_', '')
            key = (area, method, sp, ver)
            agg = loc['_enc'].setdefault(key, {'rate': 0, 'min': 999, 'max': 0})
            agg['rate'] += r[idx]; agg['min'] = min(agg['min'], slot['min_level']); agg['max'] = max(agg['max'], slot['max_level'])

# item balls
balls = {}
cur = None
for line in open(P('data/scripts/item_ball_scripts.inc')):
    m = re.match(r'(\w+)::', line)
    if m: cur = m.group(1)
    m = re.match(r'\s*finditem (ITEM_\w+)(?:,\s*(\d+))?', line)
    if m and cur: balls[cur] = (m.group(1), int(m.group(2) or 1))

def add_item(loc, name, qty, hidden, where, ident):
    loc['items'].append({'id': ident, 'name': name + (f' ×{qty}' if qty > 1 else ''), 'hidden': hidden, 'where': where})

seen_ids = collections.Counter()
def uid(loc, base):
    base = re.sub(r'[^a-z0-9]+', '-', base.lower()).strip('-')
    seen_ids[(loc['id'], base)] += 1
    c = seen_ids[(loc['id'], base)]
    return base if c == 1 else f'{base}-{c}'

for name in sorted(maps):
    m = maps[name]
    if m['region_map_section'] in SKIP: continue
    loc = L(m['region_map_section']); area = area_name(name, m['region_map_section'])
    for ev in m.get('object_events') or []:
        if ev.get('script') in balls:
            it, q = balls[ev['script']]
            add_item(loc, item_name(it), q, False, area, uid(loc, f'{area}-{item_name(it)}'))
    for ev in m.get('bg_events') or []:
        if ev.get('type') == 'hidden_item':
            add_item(loc, item_name(ev['item']), int(ev.get('quantity') or 1), True,
                     area + (' (underfoot)' if ev.get('underfoot') else ''), uid(loc, f'hidden-{area}-{item_name(ev["item"])}'))

# NPC gifts, static encounters, trades
trades_src = open(P('src/data/ingame_trades.h')).read()
trades = {v: {} for v in VERSIONS}
for v in VERSIONS:
    t = preprocess(trades_src, v)
    for k, body in re.findall(r'\[(INGAME_TRADE_\w+)\]\s*=\s*\{(.*?)\n    \}', t, re.S):
        trades[v][k] = (re.search(r'\.species = SPECIES_(\w+)', body).group(1), re.search(r'\.requestedSpecies = SPECIES_(\w+)', body).group(1),
                        re.search(r'\.nickname = _\("(.*?)"\)', body).group(1))

LEADERS = {'PewterCity_Gym': 'Brock', 'CeruleanCity_Gym': 'Misty', 'VermilionCity_Gym': 'Lt. Surge', 'CeladonCity_Gym': 'Erika',
           'FuchsiaCity_Gym': 'Koga', 'SaffronCity_Gym': 'Sabrina', 'CinnabarIsland_Gym': 'Blaine', 'ViridianCity_Gym': 'Giovanni'}
def who(label, mapname):
    if mapname in LEADERS: return LEADERS[mapname] + ' (after winning)'
    s = label.split('EventScript_')[-1] if 'EventScript_' in label else label
    s = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', s)
    return s

gifts = collections.OrderedDict()  # (lid, kind, name, area) -> {versions, ...}
statics = collections.OrderedDict()
NOT_CATCHABLE = {'MAROWAK'}
for name in sorted(maps):
    m = maps[name]
    sec = m['region_map_section']
    if sec in SKIP: continue
    f = os.path.join(m['_dir'], 'scripts.inc')
    if not os.path.exists(f): continue
    raw = open(f, encoding='utf-8').read()
    lid = loc_id(sec); area = area_name(name, sec)
    for v in VERSIONS:
        label = ''
        for line in preprocess(raw, v).split('\n'):
            lm = re.match(r'(\w+)::', line)
            if lm: label = lm.group(1); continue
            s = line.strip()
            gm = re.match(r'(?:giveitem|giveitem_msg|msgreceiveditem|additem)\s+(?:\w+,\s*)?(ITEM_\w+)(?:,\s*(\d+))?', s)
            if gm:
                it, q = gm.group(1), int(gm.group(2) or 1)
                nm = item_name(it) + (f' ×{q}' if q > 1 else '')
                k = (lid, 'item', nm, area, who(label, name))
                gifts.setdefault(k, set()).add(v); continue
            mm = re.match(r'givemon SPECIES_(\w+), (\d+)', s)
            if mm:
                k = (lid, 'mon', f'{species_const[mm.group(1)]} (Lv {mm.group(2)})', area, who(label, name), mm.group(1))
                gifts.setdefault(k, set()).add(v); continue
            mm = re.match(r'giveegg SPECIES_(\w+)', s)
            if mm:
                k = (lid, 'mon', f'{species_const[mm.group(1)]} Egg', area, who(label, name), mm.group(1))
                gifts.setdefault(k, set()).add(v); continue
            mm = re.match(r'(?:setwildbattle|seteventmon) SPECIES_(\w+), (\d+)', s)
            if mm and mm.group(1) not in NOT_CATCHABLE:
                statics.setdefault((lid, area, mm.group(1), mm.group(2)), set()).add(v); continue
            mm = re.match(r'setvar VAR_0x8008, (INGAME_TRADE_\w+)', s)
            if mm:
                get, give, nick = trades[v][mm.group(1)]
                k = (lid, 'trade', f'Trade: give {species_const[give]}, get {species_const[get]} ("{title(nick)}")', area, who(label, name), get)
                gifts.setdefault(k, set()).add(v)

# Game Corner prize Pokémon (set via variables in the script, so listed from the script's values)
for v, lst in {'FR': [('ABRA', 9, 180), ('CLEFAIRY', 8, 500), ('DRATINI', 18, 2800), ('SCYTHER', 25, 5500), ('PORYGON', 26, 9999)],
               'LG': [('ABRA', 7, 120), ('CLEFAIRY', 12, 750), ('PINSIR', 18, 2500), ('DRATINI', 24, 4600), ('PORYGON', 18, 6500)]}.items():
    for sp, lvl, coins in lst:
        k = ('celadon-city', 'mon', f'{species_const[sp]} (Lv {lvl}) for {coins} coins', 'Game Corner Prize Room', 'Prize clerk', sp)
        gifts.setdefault(k, set()).add(v)
for sp in ('HITMONLEE', 'HITMONCHAN'):
    gifts.setdefault(('saffron-city', 'mon', f'{species_const[sp]} (Lv 25, choose one)', 'Dojo', 'Karate Master (after winning)', sp), set()).update(VERSIONS)

# Pokémon gifts/trades/statics also count as encounters so the Pokédex checklist shows them
EXTRA_GIFTS = [
    ('pallet-town', 'mon', 'Starter Pokémon (Bulbasaur, Charmander or Squirtle)', 'Professor Oaks Lab', 'Professor Oak', None),
    ('pallet-town', 'item', 'Pokédex', 'Professor Oaks Lab', 'Professor Oak (after delivering Oak\'s Parcel)', None),
    ('pallet-town', 'item', 'Potion (in your PC)', 'Players House 2F', 'Your bedroom PC', None),
    ('celadon-city', 'item', 'TM16 (give Fresh Water)', 'Department Store Roof', 'Thirsty girl', None),
    ('celadon-city', 'item', 'TM20 (give Soda Pop)', 'Department Store Roof', 'Thirsty girl', None),
    ('celadon-city', 'item', 'TM33 (give Lemonade)', 'Department Store Roof', 'Thirsty girl', None),
]
for k in EXTRA_GIFTS: gifts[k] = set(VERSIONS)
FROM_FIX = {'Eevee Ball': 'Poké Ball on the table', 'Grunt Defeated': 'Rocket Grunt (after beating him)', 'Exchange Bike Voucher': 'Bike Shop owner (trade the Bike Voucher)',
    'Give Omanyte': 'Lab scientist (revives Helix Fossil)', 'Give Kabuto': 'Lab scientist (revives Dome Fossil)', 'Give Aerodactyl': 'Lab scientist (revives Old Amber)',
    'Dome Fossil': 'Pick one fossil after beating the Super Nerd', 'Helix Fossil': 'Pick one fossil after beating the Super Nerd', 'Silph Scope': 'Giovanni drops it',
    'Lift Key': 'Rocket Grunt drops it', 'Meet Celio Scene': 'Celio', 'Receive Town Map': 'Celio', 'Give Rainbow Pass': 'Celio (after giving him the Ruby and Sapphire)',
    'Receive Dex Scene': 'Professor Oak', 'Give Town Map': 'Daisy', 'Battle Rocket': 'Rocket at the end of Nugget Bridge (after beating him)', 'Bill Give SSTicket': 'Bill',
    'Try Buy Magikarp': 'Magikarp salesman (500 Poké Dollars)', 'Give Super Rod': 'Fishing Guru', 'New Record Magikarp': 'Fishing Guru (show a record-size Magikarp)',
    'Give Good Rod': 'Fishing Guru', 'Give Old Rod': 'Fishing Guru', 'Give Gold Teeth': 'Safari Warden (return his Gold Teeth)', 'Mr Fuji': 'Mr. Fuji',
    'Returned For TM42': 'Man at the pillar (after giving Lemonade)', 'Ruby': 'Pick it up at the end of Ruby Path', 'Defeated Gideon': 'Gideon (after beating him)',
    'Give Full Restore': 'Grateful resident (after clearing the bikers)', 'Prospector Struck Gold': 'Prospector', 'Receive Moon Stone': 'Owner (after rescuing his granddaughter Lostelle)',
    'Chairman Story': 'Fan Club Chairman (listen to his story)', 'Do Tutorial Battle': 'Old man (after the catching tutorial)', 'Parcel Scene': 'Mart clerk',
    'Try Give Egg': 'Daycare man (needs an empty party slot)', 'Shown Big Heracross': 'Boy (show him a Heracross)', 'Mr Psychic': 'Mr. Psychic', 'Lapras Guy': 'Silph employee',
    'Captain': 'S.S. Anne Captain (cure his seasickness)', 'Attendant': 'Reward for reaching the Secret House', 'Woman': 'Woman in the house behind a Cut tree',
    'Lass': 'Girl upstairs', 'Rival': 'Your rival (after battling him)', 'Lostelle': 'Lostelle (when you find her)', 'Rock Smash Man': 'Man at the Ember Spa',
    'Tea Woman': 'Old woman', 'Coin Case Man': 'Man in the restaurant', 'Berry Powder Man': 'Berry Powder man', 'Old Amber Scientist': 'Scientist in the back room (behind a Cut tree)',
    'President': 'Silph President (after beating Giovanni)', 'Mart Clerk': 'Poké Mart employee handing out samples', 'Aide': "Professor Oak's aide (needs enough Pokédex entries)"}
seen_gift = set()
GMETHOD = {'mon': 'gift', 'trade': 'trade'}
for k, vs in gifts.items():
    lid, kind, nm, area, frm = k[:5]
    if (lid, nm, area, tuple(sorted(vs))) in seen_gift: continue
    seen_gift.add((lid, nm, area, tuple(sorted(vs))))
    loc = locs[lid]
    frm = FROM_FIX.get(frm, frm)
    loc['gifts'].append({'id': uid(loc, f'{kind}-{area}-{nm}'), 'name': nm, 'from': frm, 'where': area,
                         **({'versions': sorted(vs, key=VERSIONS.index)} if len(vs) == 1 else {})})
    if kind in GMETHOD and k[5]:
        sp = k[5]
        method = 'game-corner' if 'coins' in nm else GMETHOD[kind]
        loc['encounters'].append({**mon('SPECIES_' + sp), 'method': method, 'versions': sorted(vs, key=VERSIONS.index), 'area': area, 'notes': nm + ' · ' + frm})
for sp in ('BULBASAUR', 'CHARMANDER', 'SQUIRTLE'):
    locs['pallet-town']['encounters'].append({**mon('SPECIES_' + sp), 'method': 'gift', 'versions': list(VERSIONS), 'levels': '5', 'area': 'Professor Oaks Lab',
                                              'notes': 'Starter: choose one. Get the other two by trading or breeding.'})
for (lid, area, sp, lvl), vs in statics.items():
    locs[lid]['encounters'].append({**mon('SPECIES_' + sp), 'method': 'static', 'versions': sorted(vs, key=VERSIONS.index), 'levels': lvl, 'area': area, 'notes': 'One chance: save first'})

# collapse wild encounters (merge identical FR/LG rows)
for loc in locs.values():
    rows = collections.OrderedDict()
    for (area, method, sp, ver), a in loc.pop('_enc').items():
        lv = str(a['min']) if a['min'] == a['max'] else f"{a['min']}-{a['max']}"
        rows.setdefault((area, method, sp, lv, a['rate']), []).append(ver)
    wild = []
    for (area, method, sp, lv, rate), vs in rows.items():
        wild.append({**mon('SPECIES_' + sp), 'method': method, 'versions': sorted(set(vs), key=VERSIONS.index), 'levels': lv, 'rate': f'{rate}%', 'area': area})
    order = ['grass', 'surf', 'old-rod', 'good-rod', 'super-rod', 'rock-smash']
    wild.sort(key=lambda e: (e['area'], order.index(e['method']), -int(e['rate'][:-1]), e['dex']))
    loc['encounters'] = wild + loc['encounters']
    if len({x.get('area') for x in loc['encounters']}) == 1:
        for e in loc['encounters']: e.pop('area', None)

# ---------- trainers ----------
# Every first-time trainer battle in the map scripts, with party, moves, prize money and rewards.
tsrc = open(P('src/data/trainers.h')).read()
psrc = open(P('src/data/trainer_parties.h')).read()
parties = {k: body for k, body in re.findall(r'static const struct \w+ (sParty_\w+)\[\] = \{\n(.*?)\n\};', psrc, re.S)}
tdefs = {k: body for k, body in re.findall(r'\[(TRAINER_\w+)\] = \{(.*?)\n    \},', tsrc, re.S)}
class_names = {}
for line in open(P('src/data/text/trainer_class_names.h'), encoding='utf-8'):
    m = re.match(r'\s*\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("(.*)"\)', line)
    if m: class_names[m.group(1)] = m.group(2)
CLASS_FIX = {'TRAINER_CLASS_PKMN_PROF': 'Pokémon Prof.', 'TRAINER_CLASS_COOLTRAINER': 'Cool Trainer', 'TRAINER_CLASS_PKMN_BREEDER': 'Pokémon Breeder',
             'TRAINER_CLASS_PKMN_RANGER': 'Pokémon Ranger', 'TRAINER_CLASS_SIS_AND_BRO': 'Sis and Bro', 'TRAINER_CLASS_CRUSH_KIN': 'Crush Kin',
             'TRAINER_CLASS_ELITE_FOUR': 'Elite Four', 'TRAINER_CLASS_SWIMMER_M': 'Swimmer', 'TRAINER_CLASS_SWIMMER_F': 'Swimmer',
             'TRAINER_CLASS_TEAM_ROCKET': 'Team Rocket', 'TRAINER_CLASS_POKEMANIAC': 'Poké Maniac', 'TRAINER_CLASS_LEADER': 'Leader',
             'TRAINER_CLASS_BOSS': 'Boss', 'TRAINER_CLASS_RIVAL_EARLY': 'Rival', 'TRAINER_CLASS_RIVAL_LATE': 'Rival', 'TRAINER_CLASS_CHAMPION': 'Champion'}
money_table = {c: int(v) for c, v in re.findall(r'\{(TRAINER_CLASS_\w+), (\d+)\}', bm)}

learnset_ptr = dict(re.findall(r'\[SPECIES_(\w+)\] = (s\w+LevelUpLearnset)', open(P('src/data/pokemon/level_up_learnset_pointers.h')).read()))
learnsets = {k: [(int(l), mv) for l, mv in re.findall(r'LEVEL_UP_MOVE\(\s*(\d+),\s*MOVE_(\w+)\)', body)]
             for k, body in re.findall(r'static const u16 (s\w+LevelUpLearnset)\[\] = \{(.*?)\};', open(P('src/data/pokemon/level_up_learnsets.h')).read(), re.S)}

def default_moves(sp, lvl):
    """The game fills a trainer Pokémon's moves with the last four it learns by level up at or below its level."""
    moves = []
    for l, mv in learnsets[learnset_ptr[sp]]:
        if l > lvl: break
        if mv in moves: continue
        if len(moves) == 4: moves.pop(0)
        moves.append(mv)
    return moves

move_power = move_types.pop('_power')
def move_info(x):
    return {'name': move_names[x], 'type': move_types.get(x), **({'power': move_power[x]} if move_power.get(x) else {})}

def trainer_party(tconst):
    t = tdefs[tconst]
    pk = re.search(r'\.party = \w+\((sParty_\w+)\)', t).group(1)
    mons = []
    for body in re.findall(r'\{(.*?)\}', parties[pk].replace('{MOVE', '[MOVE').replace('NONE}', 'NONE]'), re.S):
        sp = re.search(r'\.species = SPECIES_(\w+)', body)
        if not sp: continue
        lvl = int(re.search(r'\.lvl = (\d+)', body).group(1))
        mv = re.search(r'\.moves = \[(.*?)\]', body)
        held = re.search(r'\.heldItem = (ITEM_\w+)', body)
        moves = [x.strip().replace('MOVE_', '') for x in mv.group(1).split(',')] if mv else default_moves(sp.group(1), lvl)
        mons.append({**mon('SPECIES_' + sp.group(1)), 'level': lvl,
                     'moves': [move_info(x) for x in moves if x and x != 'NONE'],
                     **({'item': item_name(held.group(1))} if held and held.group(1) != 'ITEM_NONE' else {})})
    return mons

def trainer_record(tconst):
    t = tdefs[tconst]
    cls = re.search(r'\.trainerClass = (TRAINER_CLASS_\w+)', t).group(1)
    name = re.search(r'\.trainerName = _\("(.*?)"\)', t).group(1)
    double = '.doubleBattle = TRUE' in t
    used = [item_name(i) for i in re.findall(r'(ITEM_\w+)', re.search(r'\.items = \{(.*?)\}', t).group(1)) if i != 'ITEM_NONE']
    pty = trainer_party(tconst)
    prize = 4 * pty[-1]['level'] * money_table.get(cls, 1) * (2 if double else 1)
    rec = {'class': CLASS_FIX.get(cls) or title(class_names.get(cls, cls.replace('TRAINER_CLASS_', '').replace('_', ' '))),
           'name': title(name).replace(' & ', ' & '), 'prize': prize, 'party': pty}
    if double: rec['double'] = True
    if used: rec['uses'] = [f'{n} ×{c}' if c > 1 else n for n, c in collections.Counter(used).items()]
    return rec

# Scan scripts: label -> lines, and which trainer battles each label starts.
script_files = [(os.path.basename(os.path.dirname(f)), f) for f in glob.glob(P('data/maps/*/scripts.inc'))] + [(None, P('data/scripts/trainers.inc'))]
labels, label_map = {}, {}
map_names_by_len = sorted(maps, key=len, reverse=True)
for mapname, f in script_files:
    cur_label = None
    for line in open(f, encoding='utf-8'):
        lm = re.match(r'(\w+)::', line)
        if lm:
            cur_label = lm.group(1); labels[cur_label] = []
            label_map[cur_label] = mapname or next((n for n in map_names_by_len if cur_label.startswith(n + '_')), None)
            continue
        if cur_label: labels[cur_label].append(line.strip())

BATTLE_RE = re.compile(r'trainerbattle_(single|double|no_intro|earlyrival)\s+(TRAINER_\w+)(.*)')
def label_rewards(label, depth=0, seen=None):
    """Items handed over in a trainer's script and the scripts it jumps to (gym TMs, the Nugget Bridge prize...)."""
    seen = seen if seen is not None else set()
    if label in seen or label not in labels or depth > 2: return []
    seen.add(label)
    out = []
    for s in labels[label]:
        gm = re.match(r'(?:giveitem|giveitem_msg)\s+(?:\w+,\s*)?(ITEM_\w+)(?:,\s*(\d+))?', s)
        if gm: out.append(item_name(gm.group(1)) + (f' ×{gm.group(2)}' if gm.group(2) and gm.group(2) != '1' else ''))
        bm_ = re.match(r'setflag FLAG_BADGE0(\d)_GET', s)
        if bm_: out.append(['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'][int(bm_.group(1)) - 1] + ' Badge')
        for target in re.findall(r'(?:goto|call)(?:_if\w*)?\s+(?:[^,]+,\s*)*?(\w+_EventScript_\w+)', s):
            out += label_rewards(target, depth + 1, seen)
        bt = BATTLE_RE.match(s)
        if bt:
            for target in re.findall(r'(\w+_EventScript_\w+)', bt.group(3)):
                out += label_rewards(target, depth + 1, seen)
    return out

STARTER_COUNTER = {'Bulbasaur': 'CHARMANDER', 'Charmander': 'SQUIRTLE', 'Squirtle': 'BULBASAUR'}  # your starter -> your rival's
SKIP_TRAINER = re.compile(r'REMATCH|ELITE_FOUR_\w+_2$')
# Direction you normally walk each route in, so trainers are listed in the order you meet them.
WALK = {'Route2': 'N', 'Route3': 'E', 'Route4': 'E', 'Route24': 'N', 'Route25': 'E', 'Route5': 'S', 'Route6': 'S', 'Route11': 'E', 'Route9': 'E',
        'Route10': 'S', 'Route8': 'W', 'Route7': 'W', 'Route12': 'S', 'Route13': 'W', 'Route14': 'S', 'Route15': 'W', 'Route16': 'W', 'Route17': 'S',
        'Route18': 'E', 'Route19': 'S', 'Route20': 'W', 'Route21_North': 'N', 'Route21_South': 'N', 'Route22': 'W', 'Route23': 'N',
        'OneIsland_KindleRoad': 'N', 'OneIsland_TreasureBeach': 'S', 'ThreeIsland_BondBridge': 'W', 'SixIsland_WaterPath': 'N',
        'SevenIsland_SevaultCanyon': 'N', 'CeruleanCity': 'E', 'SevenIsland_TanobyRuins': 'W', 'FiveIsland_WaterLabyrinth': 'N'}
AREA_ORDER = {'route-21': ['South', 'North'], 'pokemon-league': ['Loreleis Room', 'Brunos Room', 'Agathas Room', 'Lances Room', 'Champions Room']}
# Battles that happen later in the story than your first visit to the location.
STAGE = {'ViridianCity_Gym': 'route-21', 'RIVAL_ROUTE22_LATE': 'route-23'}

found_battles = collections.OrderedDict()  # (map, key) -> info
for label, lines in labels.items():
    mapname = label_map.get(label)
    if not mapname or mapname not in maps or maps[mapname]['region_map_section'] in SKIP: continue
    for s in lines:
        bt = BATTLE_RE.match(s)
        if not bt or SKIP_TRAINER.search(bt.group(2)): continue
        tconst = bt.group(2)
        rm = re.match(r'TRAINER_(\w+)_(SQUIRTLE|BULBASAUR|CHARMANDER)$', tconst)
        key = rm.group(1) if rm else tconst
        b = found_battles.setdefault((mapname, key), {'consts': {}, 'labels': [], 'rival': bool(rm)})
        b['consts'][rm.group(2) if rm else None] = tconst
        b['labels'].append(label)

def position(mapname, lbls):
    m = maps[mapname]
    for ev in (m.get('object_events') or []) + (m.get('coord_events') or []):
        if ev.get('script') in lbls: return ev['x'], ev['y']
    # rival and Rocket scenes are started from a parent script; find the object or trigger that calls into it
    for ev in (m.get('object_events') or []) + (m.get('coord_events') or []):
        body = ' '.join(labels.get(ev.get('script'), []))
        if any(l in body for l in lbls): return ev['x'], ev['y']
    return None

def sort_key(mapname, pos):
    if pos is None: return (1, 0)
    x, y = pos
    d = WALK.get(mapname, 'N')  # buildings and caves: you enter from the bottom
    return (0, {'N': -y, 'S': y, 'E': x, 'W': -x}[d], {'N': x, 'S': x, 'E': y, 'W': y}[d])

def area_sort(lid, area):
    order = AREA_ORDER.get(lid)
    if order and area in order: return (0, order.index(area), '')
    if area == 'Outside': return (0, -1, '')
    m = re.match(r'(B?)(\d+)F', area)  # floors in walking order: 1F, 2F ... 11F, then B1F, B2F ...
    if m: return (1, (100 if m.group(1) else 0) + int(m.group(2)), area)
    return (2, 0, area)

per_loc = collections.defaultdict(list)
for (mapname, key), b in found_battles.items():
    sec = maps[mapname]['region_map_section']
    lid = loc_id(sec); area = area_name(mapname, sec)
    first = next(iter(b['consts'].values()))
    rec = trainer_record(first)
    if b['rival']:
        rec.pop('party'); rec['name'] = 'Rival'; rec['class'] = 'Rival' if 'CHAMPION' not in key else 'Champion'
        rec['byStarter'] = {mine: trainer_party(b['consts'][theirs]) for mine, theirs in STARTER_COUNTER.items()}
        rec['prize'] = {mine: 4 * p[-1]['level'] * money_table[re.search(r'\.trainerClass = (TRAINER_CLASS_\w+)', tdefs[b['consts'][STARTER_COUNTER[mine]]]).group(1)]
                        for mine, p in rec['byStarter'].items()}
        if len(set(rec['prize'].values())) == 1: rec['prize'] = next(iter(rec['prize'].values()))
    rewards = list(dict.fromkeys(r for l in b['labels'] for r in label_rewards(l)))
    if rewards: rec['rewards'] = rewards
    rec['id'] = re.sub(r'[^a-z0-9]+', '-', key.replace('TRAINER_', '').lower()).strip('-')
    rec['area'] = area
    st = STAGE.get(mapname) or next((v for k, v in STAGE.items() if k in key), None)
    if st: rec['stage'] = st
    leader_last = rec['class'] in ('Leader', 'Elite Four', 'Champion')  # gym trainers first, then the leader
    per_loc[lid].append((area_sort(lid, area), leader_last, sort_key(mapname, position(mapname, b['labels'])), rec))
for lid, lst in per_loc.items():
    lst.sort(key=lambda t: t[:3])
    locs[lid]['trainers'] = [t[3] for t in lst]
for loc in locs.values():
    loc.setdefault('trainers', [])
    if {t['area'] for t in loc['trainers']} <= {'Outside'} and len({e.get('area') for e in loc['encounters'] if e.get('area')}) <= 1:
        for t in loc['trainers']: t.pop('area', None)

# ---------- key battles for the Battle plan tab (same records as the route pages) ----------
def find_trainer(lid, tid):
    return next(t for t in locs[lid]['trainers'] if t['id'] == tid)
KEY_BATTLES = [
    ('pallet-town', 'rival-oaks-lab', 'Rival (Oak\'s Lab)', None, 'Mixed'),
    ('route-22', 'rival-route22-early', 'Rival (Route 22)', None, 'Mixed'),
    ('pewter-city', 'leader-brock', 'Brock', 'Boulder Badge', 'Rock'),
    ('cerulean-city', 'rival-cerulean', 'Rival (Cerulean City)', None, 'Mixed'),
    ('cerulean-city', 'leader-misty', 'Misty', 'Cascade Badge', 'Water'),
    ('ss-anne', 'rival-ss-anne', 'Rival (S.S. Anne)', None, 'Mixed'),
    ('vermilion-city', 'leader-lt-surge', 'Lt. Surge', 'Thunder Badge', 'Electric'),
    ('celadon-city', 'leader-erika', 'Erika', 'Rainbow Badge', 'Grass'),
    ('rocket-hideout', 'boss-giovanni', 'Giovanni (Rocket Hideout)', None, 'Ground'),
    ('pokemon-tower', 'rival-pokemon-tower', 'Rival (Pokémon Tower)', None, 'Mixed'),
    ('fuchsia-city', 'leader-koga', 'Koga', 'Soul Badge', 'Poison'),
    ('silph-co', 'rival-silph', 'Rival (Silph Co.)', None, 'Mixed'),
    ('silph-co', 'boss-giovanni-2', 'Giovanni (Silph Co.)', None, 'Ground'),
    ('saffron-city', 'leader-sabrina', 'Sabrina', 'Marsh Badge', 'Psychic'),
    ('cinnabar-island', 'leader-blaine', 'Blaine', 'Volcano Badge', 'Fire'),
    ('viridian-city', 'leader-giovanni', 'Giovanni', 'Earth Badge', 'Ground'),
    ('route-22', 'rival-route22-late', 'Rival (Route 22, before Victory Road)', None, 'Mixed'),
    ('pokemon-league', 'elite-four-lorelei', 'Lorelei', None, 'Ice'),
    ('pokemon-league', 'elite-four-bruno', 'Bruno', None, 'Fighting'),
    ('pokemon-league', 'elite-four-agatha', 'Agatha', None, 'Ghost'),
    ('pokemon-league', 'elite-four-lance', 'Lance', None, 'Dragon'),
    ('pokemon-league', 'champion-first', 'Champion (your rival)', None, 'Mixed'),
]
trainers = []
for lid, tid, nm, badge, spec in KEY_BATTLES:
    t = find_trainer(lid, tid)
    trainers.append({**t, 'id': tid, 'name': nm, 'trainerName': t['name'], 'where': (locs[lid]['name'] + (f" {t['area']}" if t.get('area') and t['area'] != 'Outside' else '')),
                     'badge': badge, 'specialty': spec, 'location': lid,
                     **({'note': 'Your rival picks the starter that beats yours. Set the starter you picked above.'} if 'byStarter' in t else {})})

# ---------- write ----------
os.makedirs(os.path.join(OUT, 'locations'), exist_ok=True)
for loc in locs.values():
    loc['verified'] = True
    loc['sources'] = ['https://github.com/pret/pokefirered']
    json.dump(loc, open(os.path.join(OUT, 'locations', loc['id'] + '.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(pokedex, open(os.path.join(OUT, 'pokedex.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(type_chart, open(os.path.join(OUT, 'types.json'), 'w'), indent=1)
json.dump(trainers, open(os.path.join(OUT, 'trainers.json'), 'w'), ensure_ascii=False, indent=1)
print(len(locs), 'locations;', sum(len(l['items']) for l in locs.values()), 'items;', sum(len(l['gifts']) for l in locs.values()), 'gifts;',
      sum(len(l['encounters']) for l in locs.values()), 'encounter rows')
print(sorted(locs))

# ---------- roaming legendary + story order ----------
locs['roaming'] = {'id': 'roaming', 'name': 'Roaming Legendary', 'verified': True, 'sources': ['https://github.com/pret/pokefirered'],
    'notes': 'After you get the National Pokédex and finish the One-Three Island story, one legendary beast roams Kanto routes. Which one depends on your starter.',
    'encounters': [{**mon('SPECIES_ENTEI'), 'method': 'roaming', 'versions': list(VERSIONS), 'levels': '50', 'notes': 'If you chose Bulbasaur'},
                   {**mon('SPECIES_SUICUNE'), 'method': 'roaming', 'versions': list(VERSIONS), 'levels': '50', 'notes': 'If you chose Charmander'},
                   {**mon('SPECIES_RAIKOU'), 'method': 'roaming', 'versions': list(VERSIONS), 'levels': '50', 'notes': 'If you chose Squirtle'}],
    'items': [], 'gifts': [], 'trainers': []}
json.dump(locs['roaming'], open(os.path.join(OUT, 'locations', 'roaming.json'), 'w'), ensure_ascii=False, indent=1)

ORDER = [('Kanto: Badges 1–2', 'pallet-town route-1 viridian-city route-22 route-2 viridian-forest pewter-city route-3 mt-moon route-4 cerulean-city route-24 route-25'),
         ('Kanto: Badges 3–4', 'route-5 underground-path-north-south route-6 vermilion-city ss-anne route-11 digletts-cave route-9 route-10 rock-tunnel lavender-town route-8 underground-path-east-west route-7 celadon-city rocket-hideout pokemon-tower'),
         ('Kanto: Badges 5–7', 'route-12 route-13 route-14 route-15 route-16 route-17 route-18 fuchsia-city safari-zone saffron-city silph-co power-plant route-19 route-20 seafoam-islands cinnabar-island pokemon-mansion'),
         ('Sevii Islands 1–3', 'one-island kindle-road ember-spa treasure-beach mt-ember two-island cape-brink three-island bond-bridge berry-forest three-isle-port'),
         ('Kanto: Badge 8 & League', 'route-21 route-23 victory-road indigo-plateau pokemon-league'),
         ('Post-game', 'cerulean-cave roaming three-isle-path four-island icefall-cave five-island five-isle-meadow memorial-pillar water-labyrinth resort-gorgeous rocket-warehouse lost-cave six-island water-path ruin-valley dotted-hole green-path pattern-bush outcast-island altering-cave seven-island trainer-tower canyon-entrance sevault-canyon tanoby-key tanoby-ruins'),
         ('Event islands', 'navel-rock birth-island')]
walk = json.load(open(os.path.join(OUT, 'walkthrough.json')))
index = []
for region, ids in ORDER:
    for i in ids.split():
        assert i in locs, i
        index.append({'id': i, 'name': locs[i]['name'], 'region': region, 'file': f'locations/{i}.json'})
missing = set(locs) - {x['id'] for x in index}
assert not missing, missing
for i in walk:
    assert i.startswith('_') or i in locs, i
json.dump({'locations': index}, open(os.path.join(OUT, 'locations.json'), 'w'), ensure_ascii=False, indent=1)
print('index', len(index))
