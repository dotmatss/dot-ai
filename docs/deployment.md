# Deployment targets

This application was written for a **Node.js runtime**. Some of what it needs
cannot be expressed on an edge/V8-isolate runtime, and one of those things was a
security control - which has since been given up in order to target Cloudflare
Workers. Read the Cloudflare section below before changing anything here.

## What the runtime has to provide

| Requirement | Used by | Why it cannot move |
| --- | --- | --- |
| `dns.resolve4` / `dns.resolve6` | `src/server/http/egress-guard.ts` | Every outbound request to a customer-supplied destination is validated by resolving the name and checking **every** returned address, in both families, against the private-address policy. Works on Workers; `dns.lookup` does not |
| Long-lived TCP connection pool | `src/server/db/client.ts` (`pg.Pool`) | Transaction-scoped `set_config('app.workspace_id')` is how Row Level Security is applied, so a transaction must hold one connection |
| `node:crypto` scrypt | `src/server/auth/password.ts` | Password hashing with a stored work factor |

## Cloudflare

**Cloudflare Pages is not a target for this application.** For Next.js, Pages
now covers *static exports* only, and `@cloudflare/next-on-pages` is
deprecated. A dynamic Next.js app goes to **Workers**, via `vinext` (Cloudflare's
current recommendation, in beta, supports Next.js 16) or the OpenNext Cloudflare
adapter.

Both run on `workerd`, and that is where this breaks:

- **`dns.lookup()` throws "Not implemented"** under `nodejs_compat`. This is the
  exact call the egress guard makes. `dns.resolve4`/`resolve6` *do* work (over
  DNS-over-HTTPS to 1.1.1.1), so the **validation** half is portable.
- **The pinning half is not portable.** The platform `fetch` is the runtime's
  own and accepts no custom dispatcher, so there is no equivalent of
  `undici.Agent({ connect: { lookup } })` and no way to fix a connection to an
  address that was already checked.

So a Workers deployment would keep the URL policy, the per-address DNS check and
the per-hop redirect re-validation, but **reopen the DNS-rebinding
time-of-check-to-time-of-use window** that phase 2a exists to close. That is a
deliberate downgrade of an approved security control, not a configuration
detail.

**This decision has been taken.** The target is Cloudflare Workers, and the
pinning has been removed from `egress-guard.ts` accordingly: the guard now
resolves with `resolve4`/`resolve6`, validates every address across both
families, and connects by name. The window described above is open in
production. Do not re-introduce pinning without changing the deployment target
first - on Workers it cannot work.

`pg` would additionally need Hyperdrive, since per-isolate pooling is not the
same thing as a pool.

### Running on Cloudflare without the downgrade

**Cloudflare Containers** run an arbitrary image in a Linux-like environment
with a real runtime, fronted by a Worker. Everything in the table above works
unchanged, including the socket pinning that was removed for Workers. It
requires the Workers Paid plan, a Dockerfile, and a Worker to route to the
container. This is the option to take if the DNS-rebinding window above is ever
judged unacceptable while staying on Cloudflare.

## Anything with a Node runtime

Vercel, Fly, Railway, Render, a container on any host: the application runs as
written, with every security property intact. Cloudflare AI Gateway and R2 are
consumed over HTTPS and are unaffected by where the app itself runs — using them
does not imply hosting on Workers.

## Sources

- <https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/> — `lookup`,
  `lookupService` and `resolve` throw "Not implemented"
- <https://developers.cloudflare.com/workers/runtime-apis/nodejs/> — module
  support matrix
- <https://developers.cloudflare.com/pages/framework-guides/nextjs/> — Pages
  covers static Next.js; `next-on-pages` is deprecated
- <https://developers.cloudflare.com/containers/> — arbitrary images on the
  Workers Paid plan
