# Cloud sync worker

A tiny Cloudflare Worker that stores one progress file per email address in Workers KV, so the app can
sync between devices. There is no password: the email is just the key (stored as a SHA-256 hash), so
anyone who knows the email can load or overwrite that save. Everything fits Cloudflare's free plan.

Guards: 256 KB max save, one save per email every 2 seconds, 20 requests per IP per minute,
emails trimmed and lower-cased, and only the origins in `ALLOWED_ORIGINS` may call it.

## One-time setup (about 5 minutes)

1. Make a free account at https://dash.cloudflare.com/sign-up.
2. On a computer with Node.js, from this `worker/` folder:
   ```
   npx wrangler login
   npx wrangler kv namespace create SAVES
   ```
   Copy the `id` it prints into `wrangler.toml` in place of `PASTE_YOUR_KV_NAMESPACE_ID_HERE`.
3. `npx wrangler deploy`. It prints a URL like `https://frlg-dex-sync.<your-subdomain>.workers.dev`.
4. Put that URL in `SYNC_URL` near the top of `../app.js` and push. The "Sync across devices"
   section then appears on the app's settings page.

No Node? In the Cloudflare dashboard: Storage & Databases → KV → create a namespace named `SAVES`;
Workers & Pages → Create → Worker → paste `worker.js`, deploy; then in the worker's Settings add
a KV binding `SAVES` → that namespace and a text variable `ALLOWED_ORIGINS` =
`https://natendogames.github.io`. (The dashboard route skips the rate-limit binding; the worker
falls back to a simpler built-in limit.)

## Test locally

`npx wrangler dev --local --port 8787`, set `SYNC_URL` to `http://localhost:8787`, and serve the app
with `python3 -m http.server 8000`.
