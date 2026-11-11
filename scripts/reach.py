"""When can you first reach each item on the map? A walker over the decomp's own map data.

Shared by the Emerald (natendogames/emeralddex) and FireRed/LeafGreen (natendogames/frlgdex) builders, so keep the two
copies the same. It reads every map's tile grid (collision, elevation and metatile behaviour from map.bin and the
tilesets' metatile_attributes.bin), the map connections, warps, dive/emerge links and the warps in map scripts
(ferries, boats, teleports), plus the objects that stand in the way (Cut trees, Rock Smash rocks, Strength boulders).

The story order of the app's locations is the clock: a map is open once the story reaches its location, and a field
move works once its HM and badge are in hand. One cheapest-path search ("how far into the story must you be to stand
on this tile?") gives every tile the earliest story point it can be reached at, and why: the move it needed, or the
place you have to come in from. An item is reachable when you can stand on it (hidden items you stand on) or next to it.
"""
import collections, glob, heapq, json, os, re

DIRS = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}


class World:
    def __init__(self, src, game, maps, stage_of_map, abilities, obstacles, gates=(), transports=(), tile_needs=None):
        """
        src: decomp root. game: 'emerald' or 'frlg'.
        maps: map name -> parsed map.json.
        stage_of_map(name): story stage at which this map is open (None: never, e.g. not part of the app).
        abilities: name -> (stage, label). Names used: surf, waterfall, dive, cut, rock-smash, strength, bike.
        obstacles: object graphics id -> ability that clears it.
        gates: tiles that stay shut until a story point (scripted blockers): (map, x0, y0, x1, y1, stage, reason) for a
            box of tiles, (map, script, stage, reason) for the coord events that run that script, or
            (map, 'lock:<script>', stage, reason) for the tiles that script walls off (locked doors).
        transports: [(from_map, to_map, x, y)] scripted trips (boats) the map scripts don't spell out as warps.
        tile_needs: behaviour name -> ability needed to enter such a tile (bike slopes and rails).
        """
        self.src, self.game, self.maps = src, game, maps
        self.stage_of_map, self.abilities, self.obstacles = stage_of_map, abilities, obstacles
        self.gates, self.transports = list(gates), list(transports)
        P = lambda *a: os.path.join(src, *a)
        self.P = P
        self.by_const = {m['id']: n for n, m in maps.items()}
        self._behaviours()
        self._tilesets()
        self.layouts = {l['id']: l for l in json.load(open(P('data/layouts/layouts.json')))['layouts'] if l.get('id')}
        self.tile_needs = {self.mb[k]: v for k, v in (tile_needs or {}).items() if k in self.mb}
        self.grids = {}

    # ---------- decomp tables ----------
    def _behaviours(self):
        text = open(self.P('include/constants/metatile_behaviors.h')).read()
        self.mb = {}
        if not re.search(r'enum\s*\{\s*MB_', text):
            for k, v in re.findall(r'#define (MB_\w+) (0x[0-9A-Fa-f]+|\d+)', text): self.mb[k] = int(v, 0)
        else:
            body = text[text.index('enum'):]
            n = 0
            for name, val in re.findall(r'^\s*(MB_\w+)\s*(?:=\s*(\w+))?\s*,', body, re.M):
                if val: n = int(val, 0)
                self.mb[name] = n; n += 1
        c = open(self.P('src/metatile_behavior.c')).read()
        if 'TILE_FLAG_SURFABLE' in c:
            surf = re.findall(r'\[(MB_\w+)\]\s*=[^\n]*TILE_FLAG_SURFABLE', c)
        else:
            tbl = re.search(r'sBehaviorSurfable\[[^\]]*\] = \{(.*?)\};', c, re.S).group(1)
            surf = re.findall(r'\[(MB_\w+)\]\s*=\s*TRUE', tbl)
        self.surfable = {self.mb[k] for k in surf if k in self.mb}
        self.waterfall = {self.mb['MB_WATERFALL']}
        self.diveable = {self.mb[k] for k in ('MB_INTERIOR_DEEP_WATER', 'MB_DEEP_WATER', 'MB_SOOTOPOLIS_DEEP_WATER') if k in self.mb}
        self.no_surfacing = {self.mb[k] for k in ('MB_NO_SURFACING', 'MB_SEAWEED_NO_SURFACING') if k in self.mb}
        self.counter = {self.mb[k] for k in ('MB_COUNTER',) if k in self.mb}
        self.jump = {self.mb['MB_JUMP_' + w]: d for w, d in (('EAST', 'E'), ('WEST', 'W'), ('NORTH', 'N'), ('SOUTH', 'S'))}
        # fast water is surfable in FRLG only with... nothing: it just pushes you. Treat as water.

    def _tilesets(self):
        heads = open(self.P('src/data/tilesets/headers.h')).read()
        self.ts_attr = dict(re.findall(r'const struct Tileset (\w+) =\s*\{[^}]*?\.metatileAttributes = (\w+)', heads, re.S))
        mt = open(self.P('src/data/tilesets/metatiles.h')).read()
        self.attr_file = {k: (w, f) for k, w, f in re.findall(r'(gMetatileAttributes_\w+)\[\] = INCBIN_U(16|32)\("([^"]+)"\)', mt)}
        fm = open(self.P('include/fieldmap.h')).read()
        self.num_primary = int(re.search(r'#define NUM_METATILES_IN_PRIMARY (\d+)', fm).group(1))
        self._attr_cache = {}

    def _attrs(self, tileset):
        if tileset in self._attr_cache: return self._attr_cache[tileset]
        sym = self.ts_attr.get(tileset)
        out = []
        if sym in self.attr_file:
            w, f = self.attr_file[sym]
            raw = open(self.P(f), 'rb').read(); size = int(w) // 8
            vals = [int.from_bytes(raw[i:i + size], 'little') for i in range(0, len(raw), size)]
            out = [v & (0x1FF if size == 4 else 0xFF) for v in vals]
        self._attr_cache[tileset] = out
        return out

    def layout_always(self, name):
        """A layout the map always swaps to on entry (Route 131's Sky Pillar version): a `setmaplayoutindex` in a
        script the map's on-transition script calls unconditionally."""
        f = self.P('data/maps', name, 'scripts.inc')
        if not os.path.exists(f): return None
        t = open(f, encoding='utf-8').read()
        m = re.search(r'map_script MAP_SCRIPT_ON_TRANSITION,\s*(\w+)', t)
        if not m: return None
        body = lambda l: (re.search(r'^' + re.escape(l) + r':+\n(.*?)(?=^\w+:|\Z)', t, re.S | re.M) or [None, ''])[1]
        on = body(m.group(1))
        for l in [m.group(1)] + re.findall(r'^\s*call\s+(\w+)\s*$', on, re.M):
            lm = re.search(r'^\s*setmaplayoutindex\s+(LAYOUT_\w+)', body(l), re.M)
            if lm and not re.search(r'goto_if|call_if', body(l)): return lm.group(1)
        return None

    def grid(self, name):
        """(width, height, cells) where a cell is (collision, elevation, behaviour)."""
        if name in self.grids: return self.grids[name]
        lay = self.layouts.get(self.layout_always(name) or self.maps[name]['layout'])
        if not lay: self.grids[name] = None; return None
        w, h = lay['width'], lay['height']
        raw = open(self.P(lay['blockdata_filepath']), 'rb').read()
        prim, sec = self._attrs(lay['primary_tileset']), self._attrs(lay['secondary_tileset'])
        cells = []
        for i in range(0, w * h * 2, 2):
            v = int.from_bytes(raw[i:i + 2], 'little')
            mid = v & 0x3FF
            a = prim if mid < self.num_primary else sec
            j = mid if mid < self.num_primary else mid - self.num_primary
            cells.append(((v >> 10) & 3, v >> 12, a[j] if j < len(a) else 0))
        g = (w, h, cells)
        self.grids[name] = g
        return g

    # ---------- the search ----------
    def ability_stage(self, ab):
        return self.abilities[ab][0] if ab in self.abilities else float('inf')

    def solve(self, start):
        """Cheapest story point to stand on every tile. Returns {(map, x, y): (stage, reason)}."""
        maps = self.maps
        objs = {}  # map -> {(x, y): ability}
        for n, m in maps.items():
            d = {}
            for o in m.get('object_events') or []:
                ab = self.obstacles.get(o.get('graphics_id'))
                if ab and isinstance(o.get('x'), int): d[(o['x'], o['y'])] = ab
            objs[n] = d
        gate = collections.defaultdict(dict)  # map -> {(x, y): (stage, reason)}
        for g in self.gates:
            mp, what, gs, reason = g[0], g[1], g[-2], g[-1]
            if isinstance(what, str) and what.startswith('lock:'):  # tiles a map script walls off with setmetatile ..., TRUE
                body = open(self.P('data/maps', mp, 'scripts.inc'), encoding='utf-8').read()
                m = re.search(r'^' + re.escape(what[5:]) + r'::\n(.*?)(?=^\w+::|\Z)', body, re.S | re.M)
                if not m: raise SystemExit(f'reach: gate {mp} {what} has no such script')
                tiles = [(int(x), int(y)) for x, y in re.findall(r'setmetatile\s+(\d+),\s*(\d+),\s*\w+,\s*(?:TRUE|1)\b', m.group(1))]
                if not tiles: raise SystemExit(f'reach: gate {mp} {what} locks no tiles')
            elif isinstance(what, str):  # the tiles of a map's coord events running this script (they turn you back)
                tiles = [(c['x'], c['y']) for c in maps[mp].get('coord_events') or [] if c.get('script') == what]
                if not tiles: raise SystemExit(f'reach: gate {mp} {what} matches no coord event')
            else:
                x0, y0, x1, y1 = g[1:5]
                tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
            for t in tiles: gate[mp][t] = (gs, reason)
        warps = {n: m.get('warp_events') or [] for n, m in maps.items()}
        warp_at = {n: {(w['x'], w['y']): w for w in ws} for n, ws in warps.items()}
        conns = {n: m.get('connections') or [] for n, m in maps.items()}
        script_warps = collections.defaultdict(list)
        for n in maps:
            f = self.P('data/maps', n, 'scripts.inc')
            if not os.path.exists(f): continue
            for cmd, dest, nums in re.findall(r'^\s*(warp\w*|setdivewarp)\s+(MAP_\w+)((?:\s*,\s*\w+)*)', open(f).read(), re.M):
                dn = self.by_const.get(dest)
                nums = [x.strip() for x in nums.split(',') if x.strip()]
                if not dn or dn == n: continue
                ab = 'dive' if cmd == 'setdivewarp' else None  # diving or surfacing where the map has no dive connection
                if len(nums) >= 2 and nums[-1].isdigit() and nums[-2].isdigit():
                    script_warps[n].append((dn, int(nums[-2]), int(nums[-1]), ab))
                elif len(nums) == 1 and nums[0].isdigit():
                    ws = warps.get(dn, [])
                    if int(nums[0]) < len(ws): script_warps[n].append((dn, ws[int(nums[0])]['x'], ws[int(nums[0])]['y'], ab))
        for a, b, x, y in self.transports:
            # a boat: step off onto the nearest dry tile next to where it moors
            g = self.grid(b)
            if g:
                w, h, cells = g
                land = lambda p: 0 <= p[0] < w and 0 <= p[1] < h and not cells[p[1] * w + p[0]][0] and cells[p[1] * w + p[0]][2] not in self.surfable
                ring = [(x + dx, y + dy) for r in range(0, 4) for dx in range(-r, r + 1) for dy in range(-r, r + 1) if max(abs(dx), abs(dy)) == r]
                x, y = next((p for p in ring if land(p)), (x, y))
            script_warps[a].append((b, x, y, None))

        open_at = {}
        def map_open(n):
            if n not in open_at:
                s = self.stage_of_map(n) if n in maps else None
                open_at[n] = float('inf') if s is None else s
            return open_at[n]

        best = {}
        heap = []
        tick = [0]
        def push(node, st, why):
            if st == float('inf'): return
            if node in best and best[node][0] <= st: return
            best[node] = (st, why)
            tick[0] += 1
            heapq.heappush(heap, (st, tick[0], node, why))

        def need(st, why, s2, why2):
            return (s2, why2) if s2 > st else (st, why)

        def cell(n, x, y):
            g = self.grid(n)
            if not g: return None
            w, h, cells = g
            if 0 <= x < w and 0 <= y < h: return cells[y * w + x]
            return None

        def enter_cost(n, x, y, st, why, from_cell, d, surfing):
            """Stage/reason to step onto (x, y) of map n from a neighbour, or None if you can't."""
            c = cell(n, x, y)
            if c is None: return None
            col, el, beh = c
            st, why = need(st, why, map_open(n), ('map', n))
            ab = objs[n].get((x, y))
            if ab: st, why = need(st, why, self.ability_stage(ab), ('ability', ab))
            gt = gate[n].get((x, y)) if n in gate else None
            if gt: st, why = need(st, why, gt[0], ('gate', gt[1]))
            t = self.tile_needs.get(beh)
            if t: st, why = need(st, why, self.ability_stage(t), ('ability', t))
            water = beh in self.surfable
            if (x, y) in warp_at[n]: return st, why  # doors and stairs: walk into them
            if col: return None
            if water:
                if beh in self.waterfall: st, why = need(st, why, self.ability_stage('waterfall'), ('ability', 'waterfall'))
                if not surfing:
                    # you can only start surfing from normal ground (elevation 3)
                    if from_cell is not None and from_cell[1] not in (3, 0, 15): return None
                    st, why = need(st, why, self.ability_stage('surf'), ('ability', 'surf'))
                return st, why
            if surfing and from_cell is not None and el not in (3, 0, 15): return None
            if from_cell is not None and not surfing:
                e1 = from_cell[1]
                if e1 != el and e1 not in (0, 15) and el not in (0, 15): return None
            return st, why

        sm, sx, sy = start
        push((sm, sx, sy), map_open(sm), ('start', sm))
        map_seen = set()
        while heap:
            st, _, node, why = heapq.heappop(heap)
            if best.get(node, (None,))[0] != st or best[node][1] != why: continue
            n, x, y = node
            c = cell(n, x, y)
            if c is None: continue
            surfing = c[2] in self.surfable
            if n not in map_seen:
                map_seen.add(n)
                for dn, dx, dy, ab in script_warps.get(n, ()):
                    s2, w2 = need(st, why, map_open(dn), ('map', dn))
                    if ab: s2, w2 = need(s2, w2, self.ability_stage(ab), ('ability', ab))
                    push((dn, dx, dy), s2, w2)
            # warps
            wp = warp_at[n].get((x, y))
            if wp:
                dn = self.by_const.get(wp['dest_map'])
                wid = str(wp['dest_warp_id'])
                if dn and wid.isdigit() and int(wid) < len(warps.get(dn, [])):
                    t = warps[dn][int(wid)]
                    s2, w2 = need(st, why, map_open(dn), ('map', dn))
                    push((dn, t['x'], t['y']), s2, w2)
            w, h, _ = self.grid(n)
            for dname, (dx, dy) in DIRS.items():
                nx, ny = x + dx, y + dy
                # off the edge: map connections
                if not (0 <= nx < w and 0 <= ny < h):
                    for cn in conns[n]:
                        side = {'up': 'N', 'down': 'S', 'right': 'E', 'left': 'W'}.get(cn['direction'])
                        if side != dname: continue
                        dm = self.by_const.get(cn['map'])
                        if not dm or dm not in maps or not self.grid(dm): continue
                        dw, dh, _ = self.grid(dm)
                        off = cn['offset']
                        tx, ty = {'N': (x - off, dh - 1), 'S': (x - off, 0), 'E': (0, y - off), 'W': (dw - 1, y - off)}[dname]
                        r = enter_cost(dm, tx, ty, st, why, c, dname, surfing)
                        if r: push((dm, tx, ty), *r)
                    continue
                nc = cell(n, nx, ny)
                # ledges: hop over the ledge tile in its own direction
                if nc and nc[2] in self.jump and not surfing:
                    if self.jump[nc[2]] == dname:
                        jx, jy = nx + dx, ny + dy
                        r = enter_cost(n, jx, jy, st, why, None, dname, False)
                        if r: push((n, jx, jy), *r)
                    continue
                r = enter_cost(n, nx, ny, st, why, c, dname, surfing)
                if r: push((n, nx, ny), *r)
            # dive and emerge
            for cn in conns[n]:
                if cn['direction'] not in ('dive', 'emerge'): continue
                dm = self.by_const.get(cn['map'])
                if not dm or dm not in maps: continue
                if cn['direction'] == 'dive' and c[2] not in self.diveable: continue
                if cn['direction'] == 'emerge' and c[2] in self.no_surfacing: continue
                tc = cell(dm, x, y)
                if tc is None: continue
                if cn['direction'] == 'emerge' and tc[2] not in self.diveable: continue
                s2, w2 = need(st, why, self.ability_stage('dive'), ('ability', 'dive'))
                s2, w2 = need(s2, w2, map_open(dm), ('map', dm))
                push((dm, x, y), s2, w2)
        self.best = best
        return best

    def item_reach(self, mapname, x, y, elevation=0, underfoot=False):
        """Earliest (stage, reason) to pick up an item at (x, y): standing on it (underfoot hidden items) or facing it
        from a neighbouring tile at a matching elevation."""
        spots = [(x, y)] if underfoot else [(x, y)] + [(x + dx, y + dy) for dx, dy in DIRS.values()]
        if not underfoot and self.grid(mapname):
            # shop clerks and nurses: you talk to them across the counter
            w, h, cells = self.grid(mapname)
            for dx, dy in DIRS.values():
                a, b = x + dx, y + dy
                if 0 <= a < w and 0 <= b < h and cells[b * w + a][2] in self.counter: spots.append((x + 2 * dx, y + 2 * dy))
        def ok(a, b):
            if (mapname, a, b) not in self.best: return False
            if underfoot or (a, b) == (x, y) or elevation in (0, 15): return True
            c = self.grid(mapname)[2][b * self.grid(mapname)[0] + a]
            return c[1] in (0, 15, elevation)
        got = [self.best[(mapname, a, b)] for a, b in spots if ok(a, b)]
        return min(got, key=lambda r: r[0]) if got else None


class Scripts:
    """Where on a map a script runs from: the NPCs, signs and trigger tiles whose script reaches a label (directly, or
    through goto/call in the same map's scripts.inc)."""
    JUMP = re.compile(r'\b(?:goto|call|goto_if\w*|call_if\w*|trainerbattle\w*|msgbox|setvar|switch|case)\b[^\n]*?\b(\w+_EventScript_\w+|EventScript_\w+)')

    def __init__(self, world):
        self.w = world
        self._bodies = {}

    def bodies(self, mapname):
        if mapname in self._bodies: return self._bodies[mapname]
        f = self.w.P('data/maps', mapname, 'scripts.inc')
        out, cur = {}, None
        if os.path.exists(f):
            for line in open(f, encoding='utf-8'):
                m = re.match(r'(\w+)::', line)
                if m: cur = m.group(1); out[cur] = ''; continue
                if cur: out[cur] += line
        self._bodies[mapname] = out
        return out

    def hidden_at_start(self):
        """Flags a new game sets (EventScript_ResetAllMapFlags): NPCs with these flags start hidden."""
        if hasattr(self, '_hidden'): return self._hidden
        files = [self.w.P('data/event_scripts.s')] + glob.glob(self.w.P('data/scripts/*.inc'))
        out = set()
        for f in files:
            if not os.path.exists(f): continue
            t = open(f, encoding='utf-8').read()
            m = re.search(r'^EventScript_ResetAllMapFlags::\n(.*?)(?=^\w+::|\Z)', t, re.S | re.M)
            if m: out |= set(re.findall(r'setflag (FLAG_\w+)', m.group(1)))
        self._hidden = out
        return out

    def clear_sites(self, flag):
        """[(map, label)] for every map script that clears a flag (makes a hidden NPC appear)."""
        if not hasattr(self, '_clears'):
            self._clears = collections.defaultdict(list)
            for n in self.w.maps:
                for l, body in self.bodies(n).items():
                    for fl in re.findall(r'clearflag (FLAG_\w+)', body): self._clears[fl].append((n, l))
        return self._clears.get(flag, [])

    def positions(self, mapname, label=None, contains=None):
        """[(x, y, elevation, kind)] for events whose script reaches `label`, or a label whose body matches `contains`."""
        b = self.bodies(mapname)
        want = {label} if label else set()
        if contains:
            want |= {l for l, body in b.items() if re.search(contains, body)}
        if not want: return []
        # labels that jump into a wanted label
        changed = True
        while changed:
            changed = False
            for l, body in b.items():
                if l in want: continue
                if any(t in want for t in re.findall(r'\b(\w+)\b', body) if t in b):
                    want.add(l); changed = True
        m = self.w.maps[mapname]
        out = []
        for kind in ('object_events', 'bg_events', 'coord_events'):
            for e in m.get(kind) or []:
                if e.get('script') in want and isinstance(e.get('x'), int):
                    out.append((e['x'], e['y'], e.get('elevation') or 0, kind, e.get('flag') if kind == 'object_events' else None))
        return out

    def reach(self, mapname, positions):
        """Earliest (stage, reason) at which you can talk to / step on any of these, or None."""
        got = []
        for x, y, el, kind, *rest in positions:
            r = self.w.item_reach(mapname, x, y, el, kind == 'coord_events')
            flag = rest[0] if rest else None
            if r and flag and flag in self.hidden_at_start():
                # an NPC that starts hidden only turns up once some script clears its flag
                seen = self.appears(flag)
                if seen is None: continue
                if seen[0] > r[0]: r = seen
            if r: got.append(r)
        return min(got, key=lambda r: r[0]) if got else None


def _appears(self, flag, _stack=set()):
    """Earliest (stage, ('after', map)) at which a script clearing this flag can run, or None if none can."""
    if not hasattr(self, '_appear'): self._appear = {}
    if flag in self._appear: return self._appear[flag]
    if flag in _stack: return None
    _stack.add(flag)
    best = None
    for n, l in self.clear_sites(flag):
        ps = self.positions(n, label=l)
        r = self.reach(n, ps) if ps else None
        if r is None:
            st = min((v[0] for (m, x, y), v in self.w.best.items() if m == n), default=None) if not ps else None
            if st is None: continue
            r = (st, None)
        r = (r[0], ('after', n))
        if best is None or r[0] < best[0]: best = r
    _stack.discard(flag)
    self._appear[flag] = best
    return best
Scripts.appears = _appears


def map_reach(world):
    """Earliest (stage, reason) at which you can stand anywhere on each map."""
    out = {}
    for (n, x, y), r in world.best.items():
        if n not in out or r[0] < out[n][0]: out[n] = r
    return out
