// FRLG Completion Dex sync worker (Cloudflare Workers + KV).
// A save is keyed by a SHA-256 hash of the normalised email address. There is no password:
// anyone who knows the email can load or overwrite that save. That is by design.
//
// POST /load  {"email": "..."}                    -> {"progress": {...}|null, "updatedAt": number|null}
// POST /save  {"email": "...", "progress": {...}} -> {"ok": true, "updatedAt": number}

const MAX_BYTES = 256 * 1024;          // a full save is about 20 KB, so this is generous
const MIN_SAVE_GAP_MS = 2000;          // KV allows one write per key per second
const PER_IP_PER_MINUTE = 30;          // fallback limiter when no rate-limit binding is set
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const hits = new Map(); // best-effort per-isolate limiter

function normaliseEmail(e) {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}
async function keyFor(email) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('frlg-dex:' + email));
  return 'save:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin || '*' : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
async function limited(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: ip });
    return !success;
  }
  const now = Date.now();
  const h = hits.get(ip) || { start: now, n: 0 };
  if (now - h.start > 60000) { h.start = now; h.n = 0; }
  h.n++;
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > PER_IP_PER_MINUTE;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = cors(origin, env);
    const reply = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || (path !== '/load' && path !== '/save')) return reply({ error: 'not found' }, 404);

    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(origin)) return reply({ error: 'origin not allowed' }, 403);
    if (await limited(request, env)) return reply({ error: 'too many requests, try again in a minute' }, 429);

    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return reply({ error: 'save too large' }, 413);
    const text = await request.text();
    if (text.length > MAX_BYTES) return reply({ error: 'save too large' }, 413);

    let body;
    try { body = JSON.parse(text); } catch { return reply({ error: 'bad json' }, 400); }
    const email = normaliseEmail(body && body.email);
    if (!EMAIL_RE.test(email)) return reply({ error: 'enter a valid email address' }, 400);
    const key = await keyFor(email);

    if (path === '/load') {
      const stored = await env.SAVES.get(key, 'json');
      return reply(stored ? { progress: stored.progress, updatedAt: stored.updatedAt } : { progress: null, updatedAt: null });
    }

    const p = body.progress;
    if (!p || typeof p !== 'object' || typeof p.saves !== 'object' || !p.saves) return reply({ error: 'not a progress file' }, 400);
    const meta = await env.SAVES.getWithMetadata(key);
    const last = meta.metadata && meta.metadata.updatedAt;
    if (last && Date.now() - last < MIN_SAVE_GAP_MS) return reply({ error: 'saving too often' }, 429);
    const updatedAt = Date.now();
    await env.SAVES.put(key, JSON.stringify({ progress: p, updatedAt }), { metadata: { updatedAt } });
    return reply({ ok: true, updatedAt });
  }
};
