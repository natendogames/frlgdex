#!/usr/bin/env python3
"""Cross-check the app's location data and walkthrough against Bulbapedia.

Usage:
  python3 -I scripts/verify_bulbapedia.py extract <dir with Part_N.wikitext> data/verify/bulbapedia.json
  python3 -I scripts/verify_bulbapedia.py compare data/verify/bulbapedia.json docs/bulbapedia-check.md

`extract` reads raw wikitext of Bulbapedia's walkthrough parts (fetched with
action=raw) and keeps only facts: which items, hidden items and trainers each
section lists, and the order sections first appear. `compare` checks those
facts against data/locations/*.json and data/walkthrough.json.
"""
import json, os, re, sys, unicodedata

ALIASES = {'xdefense': 'xdefend', 'paralyzeheal': 'parlyzheal', 'tinymushroom': 'tinymushroom',
           'devonparts': 'devongoods', 'xspatk': 'xspecial', 'xspecialattack': 'xspecial',
           'oldrodiii': 'oldrod', 'pokeblockcase': 'pokeblockcase', 'balmmushroom': 'bigmushroom'}

def norm(s):
    k = _norm(s)
    return ALIASES.get(k, k)

def _norm(s):
    s = re.sub(r'\s*[×x]\s*\d+\s*$', '', s)
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(.*?\)', '', s.replace('&', ' and '))
    s = re.sub(r'\b(tm|hm)\s*0*(\d+)\b', r'\1\2', s)
    return re.sub(r'[^a-z0-9]+', '', s)

def strip_markup(s):
    for _ in range(4):
        s = re.sub(r'\{\{ho\|[^|{}]*\|([^|{}]*)\}\}', r'\1', s)
        s = re.sub(r'\{\{ball\|([^|{}]*)\}\}', r'\1 Ball', s)
        s = re.sub(r'\{\{(?:tt|tooltip)\|([^|{}]*)\|[^{}]*\}\}', r'\1', s)
        s = re.sub(r'\{\{[a-zA-Z]+\|([^|{}]*)(?:\|[^{}]*)?\}\}', r'\1', s)
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', s)
    return re.sub(r"'''?|<[^>]+>", '', s).strip()

def split_args(body):
    out, depth, cur = [], 0, ''
    i = 0
    while i < len(body):
        two = body[i:i+2]
        if two in ('{{', '[['): depth += 1; cur += two; i += 2; continue
        if two in ('}}', ']]'): depth -= 1; cur += two; i += 2; continue
        if body[i] == '|' and depth == 0: out.append(cur); cur = ''; i += 1; continue
        cur += body[i]; i += 1
    out.append(cur)
    return out

def templates(line, name):
    for m in re.finditer(r'\{\{\s*' + name + r'\s*\|', line, re.I):
        i, depth = m.end(), 1
        while i < len(line) and depth:
            if line.startswith('{{', i): depth += 1; i += 2
            elif line.startswith('}}', i): depth -= 1; i += 2
            else: i += 1
        yield split_args(line[m.end():i-2])

GAME_FLAG = re.compile(r'^(E|R|S|FR|LG)=', re.I)

def extract(src, out):
    parts = sorted((f for f in os.listdir(src) if f.startswith('Part_')),
                   key=lambda f: int(re.findall(r'\d+', f)[0]))
    sections = []
    for f in parts:
        n = int(re.findall(r'\d+', f)[0])
        cur = None
        for line in open(os.path.join(src, f), encoding='utf-8').read().replace('\r', '').split('\n'):
            h = re.match(r'^(=+)\s*(.*?)\s*\1\s*$', line)
            if h:
                cur = {'part': n, 'level': len(h.group(1)), 'heading': strip_markup(h.group(2)),
                       'items': [], 'trainers': [], 'rematch': False}
                sections.append(cur)
                continue
            if cur is None:
                continue
            if re.search(r'\{\{\s*catch/div\|[^}]*rematch', line, re.I):
                cur['rematch'] = True
            for a in templates(line, 'itemlist'):
                if len(a) < 2: continue
                note = strip_markup(a[1])
                games = [x.split('=')[0].upper() for x in a[2:] if GAME_FLAG.match(x) and x.split('=')[1].strip().lower() == 'yes']
                if games and 'E' not in games and 'FR' not in games and 'LG' not in games:
                    continue
                disp = next((x[8:] for x in a[2:] if x.startswith('display=')), '')
                tm = re.search(r'\{\{\s*(TM|HM)\|0*(\d+)', disp)
                name = (tm.group(1) + tm.group(2).zfill(2)) if tm else (strip_markup(disp) if disp else strip_markup(a[0]))
                name = re.sub(r'\s*[×x]\s*\d+$', '', name)
                if name == 'None': continue
                cur['items'].append({'name': name, 'note': note,
                                     'hidden': '(hidden)' in note.lower() or 'hidden' in note.lower().split('(')[-1]})
            for a in templates(line, 'trainerentry'):
                if len(a) < 3: continue
                cur['trainers'].append({'class': strip_markup(a[1]), 'name': re.sub(r'\{\{.*?\}\}', '', strip_markup(a[2])).strip(),
                                        'rematch': cur['rematch']})
            if re.search(r'\{\{\s*trainerfooter', line, re.I):
                cur['rematch'] = False
    for s in sections: s.pop('rematch')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'_about': 'Facts extracted from Bulbapedia walkthrough pages (raw wikitext) by scripts/verify_bulbapedia.py. Source: bulbapedia.bulbagarden.net, CC BY-NC-SA 2.5.',
               'sections': sections}, open(out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(len(sections), 'sections,', sum(len(s['items']) for s in sections), 'items,',
          sum(len(s['trainers']) for s in sections), 'trainers')

def load_app(root='data'):
    locs = json.load(open(os.path.join(root, 'locations.json')))['locations']
    app = {}
    for l in locs:
        app[l['id']] = json.load(open(os.path.join(root, l['file'])))
    return locs, app

def map_heading(h, locs):
    """Return location ids named in a heading ('Routes 105 and 106' -> two)."""
    base = re.sub(r'\s*\(.*?\)', '', h).strip()
    nums = re.match(r'^Routes? ([\d ,and]+)$', base)
    if nums:
        return ['route-' + x for x in re.findall(r'\d+', nums.group(1))]
    if base.lower().startswith('trick house'):
        return ['route-110']
    if base.lower().startswith('back to '):
        base = base[8:]
    out = []
    for piece in base.split('/'):
        key = norm(piece)
        for l in locs:
            if norm(l['name']) == key:
                out.append(l['id'])
    return out

def compare(ref, report, root='data'):
    locs, app = load_app(root)
    walk = json.load(open(os.path.join(root, 'walkthrough.json')))
    secs = json.load(open(ref, encoding='utf-8'))['sections']
    # assign sections to locations: a level-2 heading sets the place; a deeper
    # heading that names a place overrides it inside that block.
    bp = {}
    order = []
    top = []
    for s in secs:
        ids = map_heading(s['heading'], locs)
        if s['level'] == 2:
            top = ids
            here = ids
        else:
            here = ids or top
        for i in ids:
            if i not in order: order.append(i)
        for i in here:
            b = bp.setdefault(i, {'items': [], 'trainers': [], 'headings': []})
            b['headings'].append(s['heading'])
            b['items'] += s['items'] if len(here) == 1 else [dict(x, shared=True) for x in s['items']]
            b['trainers'] += s['trainers'] if len(here) == 1 else [dict(x, shared=True) for x in s['trainers']]
    item_index = {o: {norm(i['name']) for i in d.get('items', []) + d.get('gifts', [])} for o, d in app.items()}
    tr_index = {o: {norm(t['name']) for t in d.get('trainers', [])} for o, d in app.items()}
    results = {}
    for l in locs:
        lid = l['id']; a = app[lid]
        b = bp.get(lid)
        r = {'name': l['name'], 'in_bulbapedia': bool(b), 'missing_in_app': [], 'missing_in_bp': [],
             'trainers_missing_in_app': [], 'trainers_missing_in_bp': []}
        results[lid] = r
        if not b: continue
        app_items = [norm(i['name']) for i in a.get('items', [])] + [norm(g['name']) for g in a.get('gifts', [])]
        for t in a.get('trainers', []):
            for rw in t.get('rewards', []) or []:
                app_items.append(norm(rw if isinstance(rw, str) else rw.get('name', '')))
        pool = list(app_items)
        for it in b['items']:
            k = norm(it['name'])
            if k in pool: pool.remove(k)
            elif re.search(r'soft soil|berry tree|held by|battle tent|contest|consecutive|game corner', it['note'], re.I) or re.search(r'decoration|ribbon|coins|\bbp\b|trainer card|^none$|national pok', it['name'], re.I):
                r.setdefault('skipped', []).append(it['name'] + ' - ' + it['note'])
            elif not it.get('shared'):
                elsewhere = [o for o in app if o != lid and k in item_index.get(o, ())]
                r['missing_in_app'].append(it['name'] + (' (hidden)' if it['hidden'] else '') + ' - ' + it['note']
                                           + (' [app lists one at: ' + ', '.join(elsewhere[:3]) + ']' if elsewhere else ''))
        bpool = [norm(i['name']) for i in b['items']]
        for i in a.get('items', []):
            k = norm(i['name'])
            if k in bpool: bpool.remove(k)
            else: r['missing_in_bp'].append(i['name'] + (' (hidden)' if i.get('hidden') else ''))
        app_tr = {norm(t['class'] + t['name']) for t in a.get('trainers', [])}
        app_tr_names = {norm(t['name']) for t in a.get('trainers', [])}
        bp_tr = {norm(t['class'] + t['name']) for t in b['trainers']}
        bp_tr_names = {norm(t['name']) for t in b['trainers']}
        app_tr_classes = {norm(t['class'] + t['name']) for t in a.get('trainers', [])}
        for t in b['trainers']:
            if not t['name'] and any(norm(t['class']).endswith(norm(x['name'])) or norm(x['class'] + x['name']) in norm(t['class']) for x in a.get('trainers', [])):
                continue
            if norm(t['name']) not in app_tr_names and not t.get('shared'):
                elsewhere = [o for o in app if o != lid and norm(t['name']) in tr_index[o]] if t['name'] else []
                tag = (t['class'] + ' ' + t['name']).strip() + (' [app has this name at: ' + ', '.join(elsewhere[:3]) + ']' if elsewhere else '')
                if tag not in r['trainers_missing_in_app']: r['trainers_missing_in_app'].append(tag)
        for t in a.get('trainers', []):
            if norm(t['name']) not in bp_tr_names and not any(not x['name'] and norm(x['class']).endswith(norm(t['name'])) for x in b['trainers']):
                r['trainers_missing_in_bp'].append(t['class'] + ' ' + t['name'])
        r['clean'] = not (r['missing_in_app'] or r['trainers_missing_in_app'])
    # story order: walkthrough key order vs Bulbapedia first appearance
    wk = [k for k in walk if not k.startswith('_')]
    pos = {k: i for i, k in enumerate(order)}
    seq = [k for k in wk if k in pos]
    inversions = []
    for i in range(1, len(seq)):
        if pos[seq[i]] < pos[seq[i-1]] - 3:
            inversions.append((seq[i-1], seq[i]))
    lines = ['# Bulbapedia cross-check', '',
             'Generated by `scripts/verify_bulbapedia.py compare`. "Missing in app" lists things Bulbapedia\'s walkthrough names at a place that the app has nowhere on that page (items, hidden items, gifts, trainers). "Not on Bulbapedia" is informational: Bulbapedia\'s walkthrough often skips items.', '']
    clean = [k for k, r in results.items() if r.get('clean')]
    lines.append(f'Places matched: {len(clean)} of {sum(1 for r in results.values() if r["in_bulbapedia"])} covered by Bulbapedia ({len(results)} in the app).')
    lines.append('')
    lines.append('## Not covered by Bulbapedia\'s walkthrough')
    lines.append(', '.join(r['name'] for r in results.values() if not r['in_bulbapedia']) or 'none')
    lines.append('')
    lines.append('## Story order')
    if inversions:
        for x, y in inversions:
            lines.append(f'- app has {x} before {y}; Bulbapedia visits {y} first')
    else:
        lines.append('- matches (no place more than three steps out of Bulbapedia order)')
    lines.append('')
    lines.append('## Mismatches by place')
    for lid, r in results.items():
        if not r['in_bulbapedia'] or r.get('clean'): continue
        lines.append(f'### {r["name"]}')
        for x in r['missing_in_app']: lines.append(f'- item missing in app: {x}')
        for x in r['trainers_missing_in_app']: lines.append(f'- trainer missing in app: {x}')
        lines.append('')
    lines.append('## Not on Bulbapedia (informational)')
    for lid, r in results.items():
        extra = r['missing_in_bp'] + ['trainer ' + t for t in r['trainers_missing_in_bp']]
        if r['in_bulbapedia'] and extra:
            lines.append(f'- {r["name"]}: ' + ', '.join(extra))
    rv = ref.replace('.json', '-review.json')
    if os.path.exists(rv):
        rev = json.load(open(rv, encoding='utf-8'))
        lines += ['', '## Review notes', '', '### Mismatches']
        lines += [f'- {k}: {v}' for k, v in rev.get('mismatches', {}).items()]
        lines += ['', '### Story order'] + [f'- {k}: {v}' for k, v in rev.get('order', {}).items()]
        lines += ['', '### Not covered', rev.get('not_covered', ''), '', '### Corrections made to the app']
        lines += [f'- {c}' for c in rev.get('corrections', [])]
    open(report, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('clean', len(clean), 'mismatched', sum(1 for r in results.values() if r['in_bulbapedia'] and not r.get('clean')),
          'uncovered', sum(1 for r in results.values() if not r['in_bulbapedia']), 'order issues', len(inversions))

if __name__ == '__main__':
    if sys.argv[1] == 'extract': extract(sys.argv[2], sys.argv[3])
    else: compare(sys.argv[2], sys.argv[3])
