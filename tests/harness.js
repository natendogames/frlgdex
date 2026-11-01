'use strict';
// Loads app.js in Node with a stub DOM so the battle logic can be tested without a browser.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

async function loadApp(extra = []) {
  const el = () => ({ addEventListener(t, f) { (this._l ||= {})[t] = f; }, querySelectorAll: () => [], classList: { toggle() {} }, dataset: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } });
  const els = {};
  const store = {};
  const ctx = {
    console, setTimeout, clearTimeout, Promise, JSON, Math, Object, Array, Set, Map, String, Number,
    document: { getElementById: id => (els[id] ||= el()), querySelectorAll: () => [], documentElement: { dataset: {}, classList: { toggle() {} } }, body: { appendChild() {} }, createElement: () => el(), addEventListener() {} },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hash: '#/none' }, history: { length: 1 }, navigator: {},
    fetch: async url => {
      if (/^https?:/.test(url)) throw new Error('offline');
      const body = fs.readFileSync(path.join(ROOT, url), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    }
  };
  ctx.window = { addEventListener() {}, scrollTo() {}, scrollY: 0 };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
    // don't render a page; expose the internals instead
    .replace(/loadData\(\)\.then\([^\n]*\n/, '')
    + '\nglobalThis.app = { state, loadData, cur, mon, stageOf, catchableBy, catchSuggestions, foeRow, foeBattler, myBattler, duel, defaultMoves, tmMovesBy: typeof tmMovesBy === "function" ? tmMovesBy : null, tmsBy: typeof tmsBy === "function" ? tmsBy : null, bestMoves: typeof bestMoves === "function" ? bestMoves : null, battleStage: typeof battleStage === "function" ? battleStage : null, evoForms, eff, lineOf: typeof lineOf === "function" ? lineOf : null, learnedBy: typeof learnedBy === "function" ? learnedBy : null, battler, hit, moveScore, relearnAt, catchLevel, allowed, inVersion, STARTER_BASE, route, renderPlan, view, trainerKey, pickOf, planOf, legKeys, copyLineup, TEAM_PLAN_KEY: planKey };';
  // later files (features.js...) see app.js's top-level names when run as one script, like separate <script> tags
  const more = extra.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^'use strict';/, '')).join('\n;\n');
  vm.runInContext(src.replace(/\nglobalThis\.app = /, () => `\n${more}\nglobalThis.__get = n => eval(n);\nglobalThis.app = `), ctx, { filename: 'app.js' });
  ctx.app.ctx = ctx;
  ctx.app.get = ctx.__get; // read any top-level name: app.get('renderMon')
  await ctx.app.loadData();
  return ctx.app;
}
module.exports = { loadApp };
