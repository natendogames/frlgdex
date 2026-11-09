"""Build data/builds.json: competitive builds for every Pokémon, from Smogon's ADV (Gen 3) strategy dex.

The same file serves FireRed/LeafGreen and Emerald (it only holds Gen 3 facts; each app works out how to get a
move or item in its own game from its own data).

Inputs:
  <sets.json>      Smogon's Gen 3 dex sets, as published by pkmn/smogon (data/sets/gen3.json)
  <showdown-dir>   a Pokémon Showdown checkout (data/learnsets.ts, data/items.ts, data/pokedex.ts), to check
                   every move is learnable in Gen 3 and every item exists in Gen 3
  <app-data-dir>   this app's data/ (pokedex.json, moves.json, items.json for names and abilities)
  scripts/draft_builds.txt  hand-written Draft builds for Pokémon Smogon has no set for

Usage:
  curl -sO https://raw.githubusercontent.com/pkmn/smogon/main/data/sets/gen3.json
  git clone --depth 1 https://github.com/smogon/pokemon-showdown /tmp/ps
  python3 -I scripts/build_builds.py gen3.json /tmp/ps data

The script fails (exit 1) on anything not legal in Gen 3: an unknown move, a move the Pokémon (or anything it evolves
from) can't learn in Gen 3, an ability it can't have, an item from a later generation, a bad nature or EV spread.
"""
import json, os, re, sys, datetime

sets_path, ps_dir, data_dir = sys.argv[1:4]
here = os.path.dirname(os.path.abspath(__file__))
errors = []
nid = lambda s: re.sub(r'[^a-z0-9]', '', s.lower().replace('♀', 'f').replace('♂', 'm'))


def ts_object(path):
    """Read a Showdown data/*.ts object literal as JSON (only for plain data files)."""
    src = open(path, encoding='utf8').read()
    body = src[src.index('= {') + 2:].rstrip().rstrip(';')
    body = re.sub(r'//[^\n]*', '', body)
    body = re.sub(r'(?m)^(\s*)([A-Za-z_][A-Za-z0-9_]*|"[^"]+"|\d+)\s*:', lambda m: m.group(1) + (m.group(2) if m.group(2).startswith('"') else f'"{m.group(2)}"') + ':', body)
    body = re.sub(r'([{,]\s*)([A-Za-z0-9_]+)\s*:', lambda m: f'{m.group(1)}"{m.group(2)}":', body)
    body = re.sub(r"'([^'\n]*)'", r'"\1"', body)
    body = re.sub(r',(\s*[}\]])', r'\1', body)
    return json.loads(body)


learnsets = ts_object(os.path.join(ps_dir, 'data/learnsets.ts'))
ps_dex = ts_object(os.path.join(ps_dir, 'data/pokedex.ts'))
item_gen = {}
for m in re.finditer(r'\n\t(\w+): \{\n\t\tname: "([^"]+)",(.*?)\n\t\}', open(os.path.join(ps_dir, 'data/items.ts'), encoding='utf8').read(), re.S):
    g = re.search(r'\bgen: (\d)', m.group(3))
    item_gen[nid(m.group(2))] = int(g.group(1)) if g else 0

dex = json.load(open(os.path.join(data_dir, 'pokedex.json'), encoding='utf8'))
moves = json.load(open(os.path.join(data_dir, 'moves.json'), encoding='utf8'))
items = json.load(open(os.path.join(data_dir, 'items.json'), encoding='utf8'))
by_name = {nid(p['name']): p for p in dex}
move_name = {nid(k): k for k in moves}
move_name.update({'feintattack': 'Faint Attack', 'highjumpkick': 'Hi Jump Kick', 'thunderpunch': 'Thunderpunch'})
item_name = {nid(k): k for k in items}
TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark']
NATURES = {'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
           'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'}
STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
# Showdown's usual IVs for each Hidden Power type in Gen 3 (the rest are 31): the highest-power spread
HP_IVS = {'Bug': {'atk': 30, 'def': 30, 'spd': 30}, 'Dark': {}, 'Dragon': {'atk': 30}, 'Electric': {'spa': 30}, 'Fighting': {'def': 30, 'spa': 30, 'spd': 30, 'spe': 30},
          'Fire': {'atk': 30, 'spa': 30, 'spe': 30}, 'Flying': {'hp': 30, 'atk': 30, 'def': 30, 'spa': 30, 'spd': 30}, 'Ghost': {'def': 30, 'spd': 30},
          'Grass': {'atk': 30, 'spa': 30}, 'Ground': {'spa': 30, 'spd': 30}, 'Ice': {'atk': 30, 'def': 30}, 'Poison': {'def': 30, 'spa': 30, 'spd': 30},
          'Psychic': {'atk': 30, 'spe': 30}, 'Rock': {'def': 30, 'spd': 30, 'spe': 30}, 'Steel': {'spd': 30}, 'Water': {'atk': 30, 'def': 30, 'spa': 30}}
FORMATS = {'ubers': 'Ubers', 'ou': 'OU', 'uu': 'UU', 'ru': 'RU', 'nu': 'NU', 'pu': 'PU', 'zu': 'ZU', 'lc': 'LC', 'doublesou': 'Doubles OU', 'nfe': 'NFE', 'ingame': 'In-game'}
# Deoxys has a different form in each Gen 3 game
DEOXYS = {'Deoxys': ['RS'], 'Deoxys-Attack': ['FR'], 'Deoxys-Defense': ['LG'], 'Deoxys-Speed': ['E']}


def hidden_power(ivs):
    """Gen 3 Hidden Power type and power from IVs (order HP, Atk, Def, SpA, SpD, Spe)."""
    hp, atk, df, spa, spd, spe = ivs
    bits = lambda n: [(v >> n) & 1 for v in (hp, atk, df, spe, spa, spd)]
    t = sum(b << i for i, b in enumerate(bits(0))) * 15 // 63
    p = sum(b << i for i, b in enumerate(bits(1))) * 40 // 63 + 30
    return TYPES[t], p


# Gen 3 move names that Showdown spells differently
PS_ID = {'Hi Jump Kick': 'highjumpkick', 'Faint Attack': 'feintattack', 'Smellingsalt': 'smellingsalts', 'Vicegrip': 'visegrip'}


def nearest_hp_ivs(want, t):
    """The set's IVs if they give Hidden Power t; otherwise the closest IVs that do (Smogon sometimes lists 0 Atk
    for a special attacker without fixing the Hidden Power bits), preferring the strongest Hidden Power."""
    if hidden_power(want)[0] == t:
        return want
    import itertools
    opts = [sorted({max(0, min(31, v + d)) for d in (-1, 0, 1, 2, 3)}) for v in want]
    best = None
    for iv in itertools.product(*opts):
        typ, power = hidden_power(iv)
        if typ == t:
            key = (sum(abs(a - b) for a, b in zip(iv, want)), -power)
            if best is None or key < best[0]:
                best = (key, list(iv))
    return best[1]


def line_of(sid):
    """This species and everything it evolves from (Gen 3 only)."""
    out = [sid]
    while ps_dex.get(out[-1], {}).get('prevo') and ps_dex.get(nid(ps_dex[out[-1]]['prevo']), {}).get('num', 999) <= 386:
        out.append(nid(ps_dex[out[-1]]['prevo']))
    return out


def gen3_sources(sid, move):
    """Letters for how the species line learns a move in Gen 3: L level-up, M TM/HM, T tutor, E egg, S event."""
    letters = set()
    for s in line_of(sid):
        ls = learnsets.get(s, {}).get('learnset') or learnsets.get(nid(ps_dex.get(s, {}).get('baseSpecies', '')), {}).get('learnset', {})
        if s == 'smeargle' and move not in ('Struggle',):
            letters.add('K')  # Sketch
        for src in ls.get(PS_ID.get(move, nid(move)), []):
            if src.startswith('3'):
                letters.add(src[1])
    return ''.join(sorted(letters, key='LMTEKSR'.index))


def as_list(x):
    return [] if x is None else [x] if isinstance(x, str) else list(x)


def make_set(who, sid, p, fmt, name, s, draft=False, note=None):
    where = f'{who} {fmt} "{name}"'
    out = {'format': fmt, 'name': name, 'level': 5 if fmt == 'lc' else 100}
    if draft:
        out['draft'] = True
    if note:
        out['note'] = note
    slots, hp_types = [], []
    for slot in s['moves']:
        opts = []
        for mv in as_list(slot):
            if mv.startswith('Hidden Power '):
                t = mv[13:]
                if t not in TYPES:
                    errors.append(f'{where}: unknown Hidden Power type {t}')
                hp_types.append(t)
                base = 'Hidden Power'
            else:
                base = move_name.get(nid(mv))
                if not base:
                    errors.append(f'{where}: unknown move {mv}')
                    continue
                mv = base
            if not gen3_sources(sid, base):
                errors.append(f'{where}: {p["name"]} can\'t learn {base} in Gen 3')
            opts.append(mv)
        slots.append(opts)
    out['moves'] = slots
    its = []
    for it in as_list(s.get('item')):
        if it in ('No Item', ''):
            continue
        if nid(it) not in item_name:  # the app's item list comes from the Gen 3 game itself
            errors.append(f'{where}: {it} is not a Gen 3 item')
            continue
        its.append(item_name[nid(it)])
    out['items'] = its
    legal_ab = {nid(a): a for a in p['abilities']}
    abs_ = []
    for a in as_list(s.get('ability')):
        if nid(a) not in legal_ab:
            errors.append(f'{where}: {p["name"]} can\'t have {a} in Gen 3')
        else:
            abs_.append(legal_ab[nid(a)])
    out['abilities'] = abs_ or list(p['abilities'])
    nats = as_list(s.get('nature'))
    for n in nats:
        if n not in NATURES:
            errors.append(f'{where}: bad nature {n}')
    out['natures'] = nats
    evs = [int(s.get('evs', {}).get(k, 0)) for k in STATS] if isinstance(s.get('evs'), dict) else [0] * 6
    if isinstance(s.get('evs'), list):  # a few sets list alternative spreads; keep the first
        evs = [int(s['evs'][0].get(k, 0)) for k in STATS]
    if sum(evs) > 510 or max(evs) > 255:
        errors.append(f'{where}: EVs {evs} over the limit')
    out['evs'] = evs
    ivs = s.get('ivs')
    if isinstance(ivs, list):
        ivs = ivs[0] if ivs else None
    if ivs:
        out['ivs'] = [int(ivs.get(k, 31)) for k in STATS]
    if hp_types:
        hp = {}
        for t in dict.fromkeys(hp_types):
            iv = [HP_IVS[t].get(k, 31) for k in STATS]
            if ivs and len(set(hp_types)) == 1:
                iv = nearest_hp_ivs(out['ivs'], t)
                out['ivs'] = iv
            got, power = hidden_power(iv)
            if got != t:
                errors.append(f'{where}: IVs {iv} give Hidden Power {got}, not {t}')
            hp[t] = {'ivs': iv, 'power': power}
        out['hiddenPower'] = hp
    return out


smogon = json.load(open(sets_path, encoding='utf8'))
species = {}
for name, fmts in smogon.items():
    sid = nid(name)
    p = by_name.get(sid) or (by_name['deoxys'] if name.startswith('Deoxys') else None)
    if not p:
        errors.append(f'{name}: not a Gen 3 Pokémon')
        continue
    entry = {'name': name.replace('’', "'"), 'smogon': None, 'sets': []}
    if name in DEOXYS:
        entry['versions'] = DEOXYS[name]
        entry['smogon'] = {'Deoxys': 'deoxys', 'Deoxys-Attack': 'deoxys-attack', 'Deoxys-Defense': 'deoxys-defense', 'Deoxys-Speed': 'deoxys-speed'}[name]
    else:
        entry['smogon'] = re.sub(r'[^a-z0-9]+', '-', name.lower().replace('’', '').replace('.', '')).strip('-')
    for fmt in sorted(fmts, key=list(FORMATS).index):
        for sname, s in fmts[fmt].items():
            entry['sets'].append(make_set(name, sid if sid in learnsets else 'deoxys', p, fmt, sname, s))
    species.setdefault(str(p['dex']), []).append(entry)

# hand-written Draft builds for the rest
for line in open(os.path.join(here, 'draft_builds.txt'), encoding='utf8'):
    if not line.strip() or line.startswith('#'):
        continue
    f = [x.strip() for x in line.rstrip('\n').split('|')]
    sp, fmt, sname, item, ab, nat, evtxt, mvtxt = f[:8]
    note = f[8] if len(f) > 8 and f[8] else None
    p = by_name.get(nid(sp))
    if not p:
        errors.append(f'draft {sp}: unknown Pokémon')
        continue
    if str(p['dex']) in species:
        errors.append(f'draft {sp}: Smogon already has sets, remove the draft')
    evs = {}
    for part in filter(None, (x.strip() for x in evtxt.split('/'))):
        v, k = part.split()
        evs[{'HP': 'hp', 'Atk': 'atk', 'Def': 'def', 'SpA': 'spa', 'SpD': 'spd', 'Spe': 'spe'}[k]] = int(v)
    s = {'moves': [[o.strip() for o in slot.split('/')] for slot in mvtxt.split(';')], 'item': item, 'ability': ab, 'nature': nat, 'evs': evs}
    entry = {'name': p['name'], 'smogon': None, 'draft': True,
             'sets': [make_set(sp, nid(sp), p, fmt, sname, s, draft=True, note=note)]}
    species[str(p['dex'])] = [entry]

# every species' moves: how its line learns them in Gen 3 (the app adds how to get them in its own game)
for n, entries in species.items():
    for e in entries:
        sid = nid(e['name'])
        e['learn'] = {}
        for st in e['sets']:
            for slot in st['moves']:
                for mv in slot:
                    base = 'Hidden Power' if mv.startswith('Hidden Power') else mv
                    e['learn'][base] = gen3_sources(sid, base)

missing = [p['name'] for p in dex if str(p['dex']) not in species]
if missing:
    errors.append(f'no builds for {len(missing)} Pokémon: {", ".join(missing)}')
if errors:
    print('\n'.join(errors))
    sys.exit(1)

def stamp(path):
    try:
        return open(path).read().strip()
    except OSError:
        return None

out = {
    'about': 'Competitive builds from Smogon\'s ADV (Gen 3) strategy dex (smogon.com/dex/rs). Sets marked draft are Claude\'s own suggestions where Smogon has none. Built by scripts/build_builds.py.',
    'built': datetime.date.today().isoformat(),
    'sources': {'sets': 'https://github.com/pkmn/smogon/blob/main/data/sets/gen3.json', 'learnsets': 'https://github.com/smogon/pokemon-showdown/blob/master/data/learnsets.ts'},
    'formats': FORMATS,
    'species': {k: species[k] for k in sorted(species, key=int)},
}
with open(os.path.join(data_dir, 'builds.json'), 'w', encoding='utf8') as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
nsets = sum(len(e['sets']) for v in species.values() for e in v)
print(f'{len(species)} Pokémon, {nsets} sets ({sum(1 for v in species.values() for e in v if e.get("draft"))} Draft)')
