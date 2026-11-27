"""Place maps: a simple drawing of every map in a place, with its items and trainers, so the app can show exactly where
a hidden item or a trainer is.

Drawn from the game's own tile data (collision and tile behaviour), not its artwork: one letter per tile, plus markers
for doors, signs, people, trainers and items. Shared by the FireRed/LeafGreen, Emerald and Seaglass builds (same file
in each repo). Writes data/itemmaps/<location id>.json, which the app loads when you open a map, and marks each item
that has a spot with map: true.

Tile letters: # blocked (walls, trees, rocks, buildings), . walkable, g tall grass, w water, f waterfall, s sand,
i ice, l ledge (jump down).
"""
import collections, json, os

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

def walk_key(world, name):
    """How a player walks a map on a first visit: in at the entrance (the first tile the reach walk stands on), along
    the main route to the exit that leads on in the story, stepping into each side branch (a dead end, or a part that
    doesn't lead to the exit) as you pass it, before carrying on. Returns a sort key for a spot (x, y): where along the
    main route you'd turn off for it, side branches before the main route at the same point, then steps from there."""
    order, best = getattr(world, 'order', {}), getattr(world, 'best', {})
    tiles = {(x, y): o for (n, x, y), o in order.items() if n == name}
    if not tiles: return lambda x, y: (float('inf'), 1, 0)
    ent = min(tiles, key=tiles.get)
    st0 = best.get((name, *ent), (0,))[0]
    region = {p for p in tiles if best.get((name, *p), (0,))[0] == st0}  # what's open on the first visit
    nb = lambda p: [(p[0] + dx, p[1] + dy) for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)) if (p[0] + dx, p[1] + dy) in region]
    def bfs(srcs):
        dist, prev, q = {p: 0 for p in srcs}, {}, collections.deque(srcs)
        while q:
            p = q.popleft()
            for n2 in nb(p):
                if n2 not in dist: dist[n2], prev[n2] = dist[p] + 1, p; q.append(n2)
        return dist, prev
    dist, prev = bfs([ent])
    # the exit: a door or map edge you can reach that leads on (to a place later in the story if there is one, else
    # the one furthest from where you came in)
    m, g = world.maps[name], world.grid(name)
    w, h = g[0], g[1]
    exits = []
    for e in m.get('warp_events') or []:
        dn = world.by_const.get(e.get('dest_map'))
        if (e.get('x'), e.get('y')) in dist and dn: exits.append(((e['x'], e['y']), dn))
    for c in m.get('connections') or []:
        dn = world.by_const.get(c.get('map'))
        side = {'up': lambda p: p[1] == 0, 'down': lambda p: p[1] == h - 1, 'left': lambda p: p[0] == 0, 'right': lambda p: p[0] == w - 1}.get(c.get('direction'))
        if side and dn: exits += [(p, dn) for p in dist if side(p)]
    here = world.stage_of_map(name) or 0
    far = [e for e in exits if dist[e[0]] > 6]  # not the doorway you came in by
    ahead = [e for e in far if (world.stage_of_map(e[1]) or 0) > here]
    pick = max(ahead or far, key=lambda e: dist[e[0]], default=None) if (ahead or far) else None
    if not pick: return lambda x, y: (min((dist[q] for q in [(x, y)] + [(x + a, y + b) for a, b in ((0, 1), (0, -1), (1, 0), (-1, 0))] if q in dist), default=float('inf')), 1, 0)
    path, p = [], pick[0]
    while p != ent: path.append(p); p = prev[p]
    path.append(ent); path.reverse()
    on = {q: i for i, q in enumerate(path)}
    # for every tile, where along the main route you turn off for it and how far in it is
    anchor, q = {q: (i, 0) for q, i in on.items()}, collections.deque(path)
    while q:
        p = q.popleft()
        for n2 in nb(p):
            if n2 not in anchor: anchor[n2] = (anchor[p][0], anchor[p][1] + 1); q.append(n2)
    def key(x, y):
        c = [anchor[q] for q in [(x, y)] + [(x + a, y + b) for a, b in ((0, 1), (0, -1), (1, 0), (-1, 0))] if q in anchor]
        if not c: return (float('inf'), 1, 0)
        i, d = min(c)
        return (i, 0 if d else 1, d)  # a side branch before the main route at the same point
    return key

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
        # number things in the order you'd come across them walking through on a first visit (see walk_key); things
        # you can only reach later (Cut, Surf, a later story point) come after, and the app lists them in their own
        # "come back later" group
        key = walk_key(world, name)
        for group, src in ((items, names), (trainers, tnames)):
            for t in group:
                if src[t['id']].get('later'): t['later'] = True
            group.sort(key=lambda t: (bool(t.get('later')), key(t['x'], t['y']), t['y'], t['x']))
            for i, t in enumerate(group): t['o'] = i
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
