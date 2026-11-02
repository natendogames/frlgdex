'use strict';
// Walkthrough checks: every place has steps, every {gift:}/{trainer:}/{loc:}/{mon:}/{item:} token in a step points at
// real game data on that page, and each page renders with no leftover braces. Run: node tests/walkthrough.js
const { loadApp } = require('./harness');
const FILES = require('./files.json');
const fails = [];
const fail = m => fails.push(m);

(async () => {
  const app = await loadApp(FILES);
  const g = app.get, state = app.state;
  const walkRef = g('walkRef'), walkStep = g('walkStep');
  const W = state.walk;
  let tokens = 0;
  for (const id of Object.keys(state.locations)) {
    const steps = W[id];
    if (!Array.isArray(steps) || !steps.length) { fail(`${id}: no walkthrough steps`); continue; }
    for (const s of steps) {
      for (const m of s.matchAll(/\{(\w+):([^}]*)\}/g)) {
        tokens++;
        if (!/^(gift|trainer|loc|mon|item)$/.test(m[1])) { fail(`${id}: unknown token ${m[0]}`); continue; }
        if (!walkRef(m[1], m[2], id)) fail(`${id}: ${m[0]} doesn't match anything${m[1] === 'gift' || m[1] === 'trainer' ? ' on this page' : ''}`);
      }
      const html = walkStep(s, id);
      if (/[{}]/.test(html.replace(/<[^>]+>/g, ''))) fail(`${id}: unrendered braces in "${s.slice(0, 60)}"`);
    }
  }
  for (const k of Object.keys(W)) if (!k.startsWith('_') && !state.locations[k]) fail(`walkthrough key ${k} is not a place`);
  for (const k of Object.keys(W._checked || {})) if (!state.locations[k]) fail(`_checked key ${k} is not a place`);
  // every route page still renders with the walkthrough and Before you leave card
  for (const id of Object.keys(state.locations)) {
    app.ctx.location.hash = `#/loc/${id}`;
    try { app.route(); } catch (e) { fail(`#/loc/${id}: ${e.message}`); continue; }
    const t = String(app.view.innerHTML || '').replace(/<[^>]+>/g, ' ');
    if (/undefined|NaN|\{(gift|trainer|loc|mon|item):/.test(t)) fail(`#/loc/${id}: shows ${t.match(/.{0,40}(undefined|NaN|\{\w+:).{0,30}/)[0]}`);
  }
  console.log(`${Object.keys(state.locations).length} places, ${tokens} tokens checked`);
  if (fails.length) { console.log(fails.join('\n')); console.log(`${fails.length} problems`); process.exit(1); }
  console.log('walkthrough OK');
})();
