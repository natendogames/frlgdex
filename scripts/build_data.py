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
move_types, move_effects = {}, {}
cur = None
for line in open(P('src/data/battle_moves.h')):
    m = re.match(r'\s*\[MOVE_(\w+)\]', line)
    if m: cur = m.group(1)
    m = re.match(r'\s*\.type = TYPE_(\w+)', line)
    if m and cur: move_types[cur] = m.group(1).capitalize()
    m = re.match(r'\s*\.power = (\d+)', line)
    if m and cur: move_types.setdefault('_power', {})[cur] = int(m.group(1))
    m = re.match(r'\s*\.effect = EFFECT_(\w+)', line)
    if m and cur: move_effects[cur] = m.group(1)

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

item_flags = {}  # checklist key -> the save flag set when you pick it up (for save file import)
def add_item(loc, name, qty, hidden, where, ident, flag=None):
    loc['items'].append({'id': ident, 'name': name + (f' ×{qty}' if qty > 1 else ''), 'hidden': hidden, 'where': where})
    if flag: item_flags[f"{loc['id']}:item:{ident}"] = flag

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
            add_item(loc, item_name(it), q, False, area, uid(loc, f'{area}-{item_name(it)}'), ev.get('flag'))
    for ev in m.get('bg_events') or []:
        if ev.get('type') == 'hidden_item':
            add_item(loc, item_name(ev['item']), int(ev.get('quantity') or 1), True,
                     area + (' (underfoot)' if ev.get('underfoot') else ''), uid(loc, f'hidden-{area}-{item_name(ev["item"])}'), ev.get('flag'))

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
        lv = re.search(r'Lv (\d+)', nm)
        lvl = lv.group(1) if lv else '5' if 'Egg' in nm else None  # eggs hatch at Lv 5
        loc['encounters'].append({**mon('SPECIES_' + sp), 'method': method, 'versions': sorted(vs, key=VERSIONS.index), 'area': area,
                                  **({'levels': lvl} if lvl else {}), 'notes': nm + ' · ' + frm})
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
        iv = re.search(r'\.iv = (\d+)', body)
        mons.append({**mon('SPECIES_' + sp.group(1)), 'level': lvl, 'iv': int(iv.group(1)) * 31 // 255 if iv else 0,
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

# Walking distance from where you come in, on the map's own tile grid (collision and elevation from map.bin), so
# trainers are listed in the order you reach them even on winding routes. Routes start from the edge you enter by
# (WALK), buildings and caves from their lowest door. Ledges count as passable both ways; cut trees and boulders are
# objects, not tiles, so they don't block. Falls back to the plain direction sort when a trainer can't be reached.
ENTRY = {'RockTunnel_1F': (17, 2), 'DiglettsCave_B1F': (82, 71)}  # you come in at the top of Rock Tunnel; Diglett's Cave from Vermilion's side
layout_info = {l['id']: l for l in json.load(open(P('data/layouts/layouts.json')))['layouts'] if l.get('id')}
_dist = {}
def walk_dist(mapname):
    if mapname in _dist: return _dist[mapname]
    m = maps[mapname]; lay = layout_info.get(m['layout'])
    if not lay: _dist[mapname] = None; return None
    w, h = lay['width'], lay['height']
    raw = open(P(lay['blockdata_filepath']), 'rb').read()
    cells = [int.from_bytes(raw[i:i + 2], 'little') for i in range(0, len(raw), 2)]
    col = lambda x, y: (cells[y * w + x] >> 10) & 3
    elev = lambda x, y: cells[y * w + x] >> 12
    d = WALK.get(mapname)
    if d:
        edge = {'N': [(x, h - 1) for x in range(w)], 'S': [(x, 0) for x in range(w)], 'E': [(0, y) for y in range(h)], 'W': [(w - 1, y) for y in range(h)]}[d]
    else:
        warps = m.get('warp_events') or []
        sec = m['region_map_section']
        # the door in from outside (another location), else any door; the lowest one unless ENTRY says otherwise
        outside = [wp for wp in warps if wp['dest_map'] in by_const and by_const[wp['dest_map']]['region_map_section'] != sec] or warps
        edge = [ENTRY[mapname]] if mapname in ENTRY else [max(((wp['x'], wp['y']) for wp in outside), key=lambda p: p[1])] if outside else []
    start = [(x, y) for x, y in edge if 0 <= x < w and 0 <= y < h and col(x, y) == 0 and elev(x, y) not in (1,)] or [(x, y) for x, y in edge if 0 <= x < w and 0 <= y < h and col(x, y) == 0]
    dist = {p: 0 for p in start}
    q = collections.deque(start)
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in dist or col(nx, ny): continue
            e1, e2 = elev(x, y), elev(nx, ny)
            if e1 != e2 and e1 not in (0, 15) and e2 not in (0, 15): continue
            dist[(nx, ny)] = dist[(x, y)] + 1; q.append((nx, ny))
    _dist[mapname] = dist
    return dist

def sort_key(mapname, pos):
    if pos is None: return (1, 0)
    dist = walk_dist(mapname)
    if dist:
        x, y = pos
        near = [dist[p] for p in ((x, y), (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if p in dist]
        if near: return (0, min(near), 0)
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
trainer_consts = {}
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
    trainer_consts[(lid, rec['id'])] = list(b['consts'].values())
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
                     **({'note': 'Your rival takes the starter that beats yours.'} if 'byStarter' in t else {})})

# ---------- write ----------
os.makedirs(os.path.join(OUT, 'locations'), exist_ok=True)
for loc in locs.values():
    loc['verified'] = True
    loc['sources'] = ['https://github.com/pret/pokefirered']
    json.dump(loc, open(os.path.join(OUT, 'locations', loc['id'] + '.json'), 'w'), ensure_ascii=False, indent=1)
# level-up learnsets (for default moves), weight (for Low Kick) and a move table for the damage estimates
weights = {natdex[k]: int(w) for k, w in re.findall(r'\[NATIONAL_DEX_(\w+)\]\s*=\s*\{[^}]*?\.weight = (\d+)', open(P('src/data/pokemon/pokedex_entries.h')).read(), re.S) if k in natdex}
for p in pokedex:
    p['weight'] = weights.get(p['dex'])
    key = next(k for k, v in natdex.items() if v == p['dex'])
    p['learnset'] = [[l, move_names[mv]] for l, mv in learnsets[learnset_ptr[key]]]
EFFECT_KEEP = {'LEVEL_DAMAGE': 'level', 'SONICBOOM': 'fixed20', 'DRAGON_RAGE': 'fixed40', 'SUPER_FANG': 'half', 'OHKO': 'ohko',
               'MULTI_HIT': 'multi', 'DOUBLE_HIT': 'double', 'TWINEEDLE': 'double', 'PSYWAVE': 'level', 'COUNTER': 'counter', 'MIRROR_COAT': 'counter',
               'EXPLOSION': 'explode', 'RECHARGE': 'recharge', 'SOLAR_BEAM': 'charge', 'SEMI_INVULNERABLE': 'charge', 'FUTURE_SIGHT': 'charge', 'RAZOR_WIND': 'charge', 'SKY_ATTACK': 'charge', 'SKULL_BASH': 'charge',
               'DREAM_EATER': 'dream', 'FLAIL': 'varies', 'RETURN': 'varies', 'FRUSTRATION': 'varies', 'HIDDEN_POWER': 'varies', 'MAGNITUDE': 'varies',
               'PRESENT': 'varies', 'LOW_KICK': 'varies', 'SPIT_UP': 'varies', 'ERUPTION': 'varies', 'REVENGE': 'varies', 'FOCUS_PUNCH': 'varies',
               'FAKE_OUT': 'fakeout', 'SNORE': 'dream', 'TRIPLE_KICK': 'triple'}  # 'dream': only works on (or while) asleep
moves_out = {}
for k, nm in move_names.items():
    if k == 'NONE': continue
    e = EFFECT_KEEP.get(move_effects.get(k))
    moves_out[nm] = {'type': move_types.get(k), 'power': move_power.get(k, 0), **({'effect': e} if e else {})}
json.dump(moves_out, open(os.path.join(OUT, 'moves.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
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

# ---------- when you actually fight each trainer ----------
# Some trainers sit on early routes but are only reachable (or only meant to be fought) much later, like the
# Route 22 rival before Victory Road. Place each trainer at the first key battle (gym, rival, Giovanni, League)
# whose ace is within 5 levels of the trainer's own ace level, never before the location itself. Trainers placed past the
# next key battle after the location are marked 'later', so the app collapses them and plans with that point's Pokémon.
order_pos = {x['id']: i for i, x in enumerate(index)}
def ace_of(t):
    parties = [t['party']] if 'party' in t else list(t['byStarter'].values())
    return max(p['level'] for pty in parties for p in pty)
keys = sorted(((order_pos[t.get('stage') or t['location']], ace_of(t), t.get('stage') or t['location']) for t in trainers))
for loc in locs.values():
    if loc['id'] not in order_pos: continue
    here = order_pos[loc['id']]
    nxt = next((k for k in keys if k[0] >= here), None)
    for t in loc['trainers']:
        if t.get('stage'):
            t['later'] = order_pos[t['stage']] > here
            continue
        ace = ace_of(t)
        fit = next((k for k in keys if k[0] >= here and k[1] >= ace - 5), None)
        if fit and nxt and fit[0] > nxt[0] and fit[2] != loc['id']:
            t['stage'], t['later'] = fit[2], True
    json.dump(loc, open(os.path.join(OUT, 'locations', loc['id'] + '.json'), 'w'), ensure_ascii=False, indent=1)

print('index', len(index))

# ---------- TMs and HMs ----------
# Which machines each species can learn (tmhm_learnsets.h), what each one teaches, and every place you get one:
# found or given (from the location data above), bought at the Celadon Department Store, or won at the Game Corner.
# Bought and Game Corner TMs can be had again; the rest are single use in Gen 3 (HMs can be reused).
tm_moves = {}
tmhm_src = open(P('src/data/pokemon/tmhm_learnsets.h')).read()
for kind, num, mv in re.findall(r'TMHM\(((?:TM|HM))(\d+)_(\w+)\)', tmhm_src):
    tm_moves[f'{kind}{num}'] = move_names[mv]
by_species = {k: re.findall(r'TMHM\(((?:TM|HM)\d+)_', body)
              for k, body in re.findall(r'\[SPECIES_(\w+)\]\s*=\s*TMHM_LEARNSET\((.*?)\),\n', tmhm_src, re.S)}
for p in pokedex:
    key = next(k for k, v in natdex.items() if v == p['dex'])
    p['tmhm'] = sorted(set(by_species.get(key, [])))
tms = {k: {'move': tm_moves[k], 'reusable': k.startswith('HM'), 'sources': []} for k in sorted(tm_moves)}
for x in index:
    for kind in ('items', 'gifts'):
        for it in locs[x['id']].get(kind, []):
            m = re.match(r'((?:TM|HM)\d+)\b', it['name'])
            if m and m.group(1) in tms:
                tms[m.group(1)]['sources'].append({'loc': x['id'], 'how': 'gift' if kind == 'gifts' else 'found', 'where': it.get('where'),
                                                   **({'from': it['from']} if it.get('from') else {})})
mart = re.search(r'CeladonCity_DepartmentStore_2F_TMs::(.*?)ITEM_NONE', open(P('data/maps/CeladonCity_DepartmentStore_2F/scripts.inc')).read(), re.S).group(1)
for c in re.findall(r'ITEM_((?:TM|HM)\d+)', mart):
    tms[c]['reusable'] = True
    tms[c]['sources'].append({'loc': 'celadon-city', 'how': 'buy', 'where': 'Department Store 2F', 'cost': f"₽{items['ITEM_' + c]['price']:,}"})
prize = open(P('data/maps/CeladonCity_GameCorner_PrizeRoom/scripts.inc')).read()
for c, coins in re.findall(r'setvar VAR_TEMP_1, ITEM_((?:TM|HM)\d+)\n\tsetvar VAR_TEMP_2, (\d+)', prize):
    tms[c]['reusable'] = True
    tms[c]['sources'].append({'loc': 'celadon-city', 'how': 'prize', 'where': 'Game Corner Prize Room', 'cost': f'{int(coins):,} coins'})
json.dump(pokedex, open(os.path.join(OUT, 'pokedex.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(tms, open(os.path.join(OUT, 'tms.json'), 'w'), ensure_ascii=False, indent=1)
print('tms', len(tms), 'without a source:', [k for k, v in tms.items() if not v['sources']])

# ---------- extra species data: abilities, catch rate, EXP, EV yield, growth rate, wild held items ----------
ability_names = {}
for k, v in re.findall(r'\[ABILITY_(\w+)\] = _\("(.*?)"\)', open(P('src/data/text/abilities.h'), encoding='utf-8').read()):
    ability_names[k] = title(v)
GROWTH = {'MEDIUM_FAST': 'medium-fast', 'ERRATIC': 'erratic', 'FLUCTUATING': 'fluctuating', 'MEDIUM_SLOW': 'medium-slow', 'FAST': 'fast', 'SLOW': 'slow'}
extra, cur = {}, None
for line in open(P('src/data/pokemon/species_info.h')):
    m = re.match(r'\s*\[SPECIES_(\w+)\]\s*=', line)
    if m: cur = m.group(1); extra[cur] = {}; continue
    if not cur: continue
    m = re.match(r'\s*\.(catchRate|expYield|friendship|safariZoneFleeRate|evYield_\w+) = (\d+)', line)
    if m: extra[cur][m.group(1)] = int(m.group(2))
    m = re.match(r'\s*\.growthRate = GROWTH_(\w+)', line)
    if m: extra[cur]['growth'] = GROWTH[m.group(1)]
    m = re.match(r'\s*\.abilities = \{ABILITY_(\w+), ABILITY_(\w+)\}', line)
    if m: extra[cur]['abilities'] = [ability_names[a] for a in dict.fromkeys(m.groups()) if a != 'NONE']
    m = re.match(r'\s*\.item(Common|Rare) = (ITEM_\w+)', line)
    if m and m.group(2) != 'ITEM_NONE': extra[cur].setdefault('held', {})[m.group(1).lower()] = item_name(m.group(2))
tutor_list = re.findall(r'\[TUTOR_MOVE_(\w+)\] = MOVE_(\w+)', open(P('src/data/pokemon/tutor_learnsets.h')).read())
tutor_by_species = {k: [move_names[mv] for mv in re.findall(r'TUTOR\(MOVE_(\w+)\)', body)]
                    for k, body in re.findall(r'\[SPECIES_(\w+)\] = ((?:TUTOR\(MOVE_\w+\)\s*\|?\s*)+|0),', open(P('src/data/pokemon/tutor_learnsets.h')).read())}
for p in pokedex:
    key = next(k for k, v in natdex.items() if v == p['dex'])
    x = extra.get(key, {})
    p['abilities'] = x.get('abilities', [])
    p['catchRate'] = x.get('catchRate'); p['expYield'] = x.get('expYield'); p['growth'] = x.get('growth')
    p['ev'] = [x.get(f'evYield_{s}', 0) for s in ('HP', 'Attack', 'Defense', 'SpAttack', 'SpDefense', 'Speed')]
    if x.get('held'): p['held'] = x['held']
    if x.get('safariZoneFleeRate'): p['safariFlee'] = x['safariZoneFleeRate']
    if tutor_by_species.get(key): p['tutor'] = tutor_by_species[key]
json.dump(pokedex, open(os.path.join(OUT, 'pokedex.json'), 'w'), ensure_ascii=False, separators=(',', ':'))

# ---------- shops, tutors, VS Seeker rematches, Unown chambers ----------
def map_loc(mapname):
    return loc_id(maps[mapname]['region_map_section'])
shops = collections.defaultdict(list)
SHOP_NOTE = {'TwoIsland_Items_ShopInitial': 'Two Island shop at first', 'TwoIsland_Items_ShopExpanded1': 'After rescuing Lostelle',
             'TwoIsland_Items_ShopExpanded2': 'After you become Champion', 'TwoIsland_Items_ShopExpanded3': 'After linking with Ruby or Sapphire'}
for name in sorted(maps):
    f = os.path.join(maps[name]['_dir'], 'scripts.inc')
    if not os.path.exists(f) or maps[name]['region_map_section'] in SKIP: continue
    raw = open(f, encoding='utf-8').read()
    for lbl in re.findall(r'pokemart (\w+)', raw):
        body = re.search(re.escape(lbl) + r'::(.*?)ITEM_NONE', raw, re.S).group(1)
        lst = [{'name': item_name(c), 'price': items[c]['price']} for c in re.findall(r'(ITEM_\w+)', body)]
        where = SHOP_NOTE.get(lbl) or area_name(name, maps[name]['region_map_section'])
        if 'TMs' in lbl: where += ' (TMs)'
        if 'Vitamins' in lbl: where += ' (vitamins)'
        if 'XItems' in lbl: where += ' (battle items)'
        shops[map_loc(name)].append({'id': re.sub(r'[^a-z0-9]+', '-', lbl.lower()), 'where': where, 'items': lst})
shops['celadon-city'].append({'id': 'roof-vending', 'where': 'Department Store Roof (vending machines)', 'items': [
    {'name': 'Fresh Water', 'price': 200}, {'name': 'Soda Pop', 'price': 300}, {'name': 'Lemonade', 'price': 350}]})
prize_items = re.findall(r'setvar VAR_TEMP_1, (ITEM_\w+)\n\tsetvar VAR_TEMP_2, (\d+)', prize)
shops['celadon-city'].append({'id': 'game-corner-prizes', 'where': 'Game Corner Prize Room', 'coins': True,
    'items': [{'name': item_name(c), 'price': int(n)} for c, n in prize_items]})

TUTOR_WHERE = {'DoubleEdge': ('victory-road', '2F'), 'ThunderWave': ('silph-co', '2F'), 'RockSlide': ('rock-tunnel', 'B1F'),
    'Explosion': ('mt-ember', 'Exterior'), 'MegaPunch': ('route-4', 'Outside'), 'MegaKick': ('route-4', 'Outside'),
    'DreamEater': ('viridian-city', 'House'), 'Softboiled': ('celadon-city', 'Outside'), 'Substitute': ('fuchsia-city', 'Outside'),
    'SwordsDance': ('seven-island', 'Outside'), 'SeismicToss': ('pewter-city', 'Museum 1F'), 'Counter': ('celadon-city', 'Department Store 3F'),
    'Metronome': ('cinnabar-island', 'Pokémon Lab Research Room'), 'Mimic': ('saffron-city', 'Copycats House 2F'), 'BodySlam': ('four-island', 'House 1')}
tutor_src = open(P('data/scripts/move_tutors.inc')).read()
tutors = []
for label in re.findall(r'^(\w+Tutor)::', tutor_src, re.M):
    k = re.search(r'EventScript_(\w+)Tutor$', label).group(1)
    if k not in TUTOR_WHERE: continue
    mv = re.search(re.escape(label) + r'::.*?MOVETUTOR_(\w+)', tutor_src, re.S).group(1)
    lid, where = TUTOR_WHERE[k]
    tutors.append({'id': 'tutor-' + mv.lower().replace('_', '-'), 'move': move_names[mv], 'loc': lid, 'where': where,
                   'learners': [p['dex'] for p in pokedex if move_names[mv] in p.get('tutor', [])]})
tutors.sort(key=lambda t: order_pos[t['loc']])
tutors.append({'id': 'tutor-ultimate', 'move': 'Frenzy Plant / Blast Burn / Hydro Cannon', 'loc': 'cape-brink', 'where': 'House',
               'learners': [3, 6, 9], 'note': 'Once per starter line: Venusaur, Charizard or Blastoise with maximum friendship. Can be taught to each of the three.'})

rm_src = open(P('src/vs_seeker.c')).read()
rm_block = re.search(r'sRematches\[\] = \{(.*?)\n\};', rm_src, re.S).group(1)
TIER = ['First battle', 'After you get the VS Seeker', 'After you reach Celadon City', 'After you reach Fuchsia City', 'After you become Champion', 'After linking with Ruby or Sapphire']
rematches = collections.defaultdict(list)
for ids, mp in re.findall(r'\{\s*\{(.*?)\},\s*MAP\((MAP_\w+)\)\s*\}', rm_block, re.S):
    consts = [c.strip() for c in ids.split(',') if c.strip()]
    m = by_const.get(mp)
    if not m: continue
    lid = loc_id(m['region_map_section'])
    base = re.sub(r'[^a-z0-9]+', '-', consts[0].replace('TRAINER_', '').lower()).strip('-')
    tiers, seen_c = [], {consts[0]}
    for i, c in enumerate(consts[1:], 1):
        if c == 'SKIP' or c in seen_c or c not in tdefs: continue
        seen_c.add(c)
        tiers.append({'after': TIER[i], 'party': trainer_party(c)})
    if tiers: rematches[lid].append({'id': base, 'tiers': tiers})

unown = {'monean': 'A ?', 'liptoo': 'C D H U O', 'weepth': 'N S I E', 'dilford': 'P L J R Q', 'scufib': 'Y T G F K', 'rixy': 'V W X M B', 'viapois': 'Z !'}
json.dump({'shops': shops, 'tutors': tutors, 'rematches': rematches, 'unown': {k.title() + ' Chamber': v.split() for k, v in unown.items()}},
          open(os.path.join(OUT, 'extras.json'), 'w'), ensure_ascii=False, indent=1)
print('shops', sum(len(v) for v in shops.values()), 'tutors', len(tutors), 'rematch trainers', sum(len(v) for v in rematches.values()))

# ---------- save file import map ----------
# What the app needs to read a FireRed/LeafGreen .sav: the save flag behind each item and trainer checklist row,
# the game's internal species numbers (Hoenn Pokémon are out of National Dex order) and move numbers.
def defines(*files):
    out = {}
    for f in files:
        for name, val in re.findall(r'^#define\s+(\w+)\s+(.+?)\s*(?://.*)?$', open(P(f)).read(), re.M): out[name] = val
    return out
DEF = defines('include/constants/flags.h', 'include/constants/opponents.h', 'include/constants/species.h', 'include/constants/moves.h')
_ev = {}
def ev(name):
    if name in _ev: return _ev[name]
    expr = DEF[name]
    expr = re.sub(r'\b([A-Za-z_]\w*)\b', lambda m: str(ev(m.group(1))) if m.group(1) in DEF else m.group(1), expr)
    _ev[name] = int(eval(expr.replace('/', '//'), {'__builtins__': {}}))
    return _ev[name]
flag_map = {}
for k, f in item_flags.items():
    if f in DEF: flag_map[k] = ev(f)
TFS = ev('TRAINER_FLAGS_START')
for (lid, tid), consts in trainer_consts.items():
    flag_map[f'{lid}:trainer:{tid}'] = [TFS + ev(c) for c in consts if c in DEF]
species_index = [0] * (max(ev(k) for k in DEF if k.startswith('SPECIES_') and re.match(r'^\d+$', DEF[k])) + 1)
for k in DEF:
    if k.startswith('SPECIES_') and k[8:] in natdex and re.match(r'^\d+$', DEF[k]): species_index[ev(k)] = natdex[k[8:]]
moves_by_id = {}
for k in DEF:
    if k.startswith('MOVE_') and k[5:] in move_names and re.match(r'^\d+$', DEF[k]): moves_by_id[ev(k)] = move_names[k[5:]]
move_list = [moves_by_id.get(i, '') for i in range(max(moves_by_id) + 1)]
badges = [ev(f'FLAG_BADGE0{i}_GET') for i in range(1, 9)]
json.dump({'flags': flag_map, 'species': species_index, 'moves': move_list, 'badges': badges},
          open(os.path.join(OUT, 'save-map.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('save map:', len(flag_map), 'flags,', sum(1 for x in species_index if x), 'species')

# ---------- region map grid (for the tappable map) ----------
# The game's own town-map layout: a 22x15 grid per region, each cell naming a map section, with a second layer for
# caves and buildings. Cells are mapped to app locations; Pokémon Center stubs count as their route.
region_maps = {}
for key, f in (('Kanto', 'kanto'), ('Sevii Islands 1–3', 'sevii_123'), ('Sevii Islands 4–5', 'sevii_45'), ('Sevii Islands 6–7', 'sevii_67')):
    src = open(P(f'src/data/region_map/region_map_layout_{f}.h')).read()
    cells = []
    for layer in ('MAP', 'DUNGEON'):
        body = re.search(r'\[LAYER_' + layer + r'\]\s*=\s*\{(.*?)\n    \}', src, re.S).group(1)
        for y, row in enumerate(re.findall(r'\{([^{}]*)\}', body)):
            for x, sec in enumerate(c.strip() for c in row.split(',')):
                if sec == 'MAPSEC_NONE': continue
                lid = loc_id(re.sub(r'_POKECENTER$', '', sec))
                if lid in locs: cells.append([x, y, lid, layer.lower()])
    region_maps[key] = cells
json.dump(region_maps, open(os.path.join(OUT, 'region-map.json'), 'w'), separators=(',', ':'))
mapped = {c[2] for cs in region_maps.values() for c in cs}
print('region map: unplaced locations', sorted(set(x['id'] for x in index) - mapped))
