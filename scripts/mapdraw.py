"""Place maps: a simple drawing of every map in a place, with its items and trainers, so the app can show exactly where
a hidden item or a trainer is.

Drawn from the game's own tile data (collision and tile behaviour), not its artwork: one letter per tile, plus markers
for doors, signs, people, trainers and items. Shared by the FireRed/LeafGreen, Emerald and Seaglass builds (same file
in each repo). Writes data/itemmaps/<location id>.json, which the app loads when you open a map, and marks each item
that has a spot with map: true.

Tile letters: # blocked (walls, trees, rocks, buildings), . walkable, g tall grass, w water, f waterfall, s sand,
i ice, l ledge (jump down).
"""
import json, os

def _classes(world):
    names = {v: k for k, v in world.mb.items()}
    def cls(coll, beh):
        n = names.get(beh, '')
        if beh in world.waterfall: return 'f'
        if beh in world.surfable: return 'w'
        if beh in world.jump: return 'l'
        if coll: return '#'
        if 'TALL_GRASS' in n or 'LONG_GRASS' in n or n == 'MB_ASHGRASS': return 'g'
        if 'SAND' in n: return 's'
        if 'ICE' in n: return 'i'
        return '.'
    return cls

def write(world, item_pos, locs, out, place_maps, trainer_pos):
    """item_pos: (location id, item id) -> (map name, x, y, elevation, underfoot).
    place_maps: map name -> (location id, area name) for every map that belongs to a place in the app.
    trainer_pos: (location id, trainer id) -> (map name, [(x, y), ...]) where that trainer stands."""
    cls = _classes(world)
    items_on, trainers_on = {}, {}
    for (lid, iid), pos in item_pos.items(): items_on.setdefault(pos[0], []).append((lid, iid, pos))
    for (lid, tid), (name, spots) in trainer_pos.items():
        for x, y in spots: trainers_on.setdefault(name, []).append((lid, tid, x, y))
    obst = getattr(world, 'obstacles', {})
    files = {}
    for name in sorted(place_maps):
        lid, area = place_maps[name]
        if lid not in locs or name not in world.maps: continue
        loc = locs[lid]
        names = {i['id']: i for i in loc['items']}
        tnames = {t['id']: t for t in loc.get('trainers') or []}
        items = [{'id': iid, 'x': p[1], 'y': p[2], 'hidden': names[iid]['hidden'], 'name': names[iid]['name']}
                 for l, iid, p in sorted(items_on.get(name, []), key=lambda t: (t[2][2], t[2][1])) if l == lid and iid in names]
        seen, trainers = set(), []
        for l, tid, x, y in trainers_on.get(name, []):
            if l != lid or tid not in tnames or (x, y) in seen: continue
            seen.add((x, y))
            t = tnames[tid]
            trainers.append({'id': tid, 'x': x, 'y': y, 'name': f"{t.get('class', '')} {t.get('name', '')}".strip()})
        # a map with nothing to find or fight is left out (Pokémon Centers, Marts, plain houses), except the outdoors
        if not items and not trainers and area != 'Outside': continue
        g = world.grid(name)
        if not g: continue
        w, h, cells = g
        m = world.maps[name]
        spots = {(i['x'], i['y']) for i in items} | {(t['x'], t['y']) for t in trainers}
        objs = []
        for ev in m.get('object_events') or []:
            if not isinstance(ev.get('x'), int) or (ev['x'], ev['y']) in spots: continue
            kind = obst.get(ev.get('graphics_id'))
            if kind in ('cut', 'rock-smash', 'strength'): objs.append([ev['x'], ev['y'], kind])
            elif ev.get('trainer_type', 'TRAINER_TYPE_NONE') in ('TRAINER_TYPE_NONE', '0'): objs.append([ev['x'], ev['y'], 'person'])
        for i in items: names[i['id']]['map'] = True
        for t in trainers: tnames[t['id']]['map'] = True
        loc['mapCount'] = loc.get('mapCount', 0) + 1
        files.setdefault(lid, []).append({
            'map': name, 'where': area, 'w': w, 'h': h, 'tiles': ''.join(cls(c[0], c[2]) for c in cells),
            'items': items, 'trainers': trainers, 'objects': objs,
            'doors': [list(d) for d in sorted({(e['x'], e['y']) for e in m.get('warp_events') or [] if isinstance(e.get('x'), int)})],
            'signs': [list(s) for s in sorted({(e['x'], e['y']) for e in m.get('bg_events') or [] if e.get('type') == 'sign' and isinstance(e.get('x'), int)})]})
    d = os.path.join(out, 'itemmaps')
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.endswith('.json') and f[:-5] not in files: os.remove(os.path.join(d, f))
    for lid, ms in files.items():
        ms.sort(key=lambda x: (x['where'] != 'Outside', x['where'], x['map']))
        json.dump({'maps': ms}, open(os.path.join(d, lid + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    return sum(len(v) for v in files.values())
